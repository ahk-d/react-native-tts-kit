import Foundation
import onnxruntime_objc

enum SupertonicError: LocalizedError {
    case modelMissing
    case voiceMissing(String)
    case textTooLong
    case cancelled
    case configMissing(String)

    var errorDescription: String? {
        switch self {
        case .modelMissing: return "Supertonic asset bundle is missing. Call SpeechKit.prefetchModel() first."
        case .voiceMissing(let id): return "Voice \(id) is not available."
        case .textTooLong: return "Input text exceeds the maximum length."
        case .cancelled: return "Synthesis cancelled."
        case .configMissing(let key): return "Required config key missing: \(key)."
        }
    }
}

private struct TTSConfig: Decodable {
    struct AE: Decodable { let sample_rate: Int; let base_chunk_size: Int }
    struct TTL: Decodable { let chunk_compress_factor: Int; let latent_dim: Int }
    let ae: AE
    let ttl: TTL
}

/// Real Supertonic inference pipeline (ported from `supertone-inc/supertonic/swift`).
///
/// Four ONNX sessions:
///   1. duration_predictor → per-chunk duration in seconds
///   2. text_encoder       → text embedding tensor
///   3. vector_estimator   → iterative diffusion denoising (totalStep iterations)
///   4. vocoder            → final waveform
final class SupertonicSession {
    private var env: ORTEnv?
    private var dpSession: ORTSession?
    private var encSession: ORTSession?
    private var vecSession: ORTSession?
    private var vocSession: ORTSession?
    private var indexer: UnicodeIndexer?
    private var voiceCache: [String: VoicePack] = [:]
    private var config: TTSConfig?

    private let cancelLock = NSLock()
    private var _cancelled = false

    var isReady: Bool { dpSession != nil && encSession != nil && vecSession != nil && vocSession != nil && indexer != nil && config != nil }
    var sampleRate: Int { config?.ae.sample_rate ?? 24_000 }

    func loadIfNeeded() throws {
        guard !isReady else { return }
        guard ModelLocator.modelExists() else { throw SupertonicError.modelMissing }

        let env = try ORTEnv(loggingLevel: .warning)
        let opts = try ORTSessionOptions()
        try opts.setIntraOpNumThreads(2)
        try opts.setGraphOptimizationLevel(.all)

        self.env = env

        // Per-file load + log. Without this, if one of the four sessions
        // throws (e.g. fp16 type mismatch on vector_estimator) it's hard to
        // tell from JS which file failed.
        func loadSession(_ filename: String) throws -> ORTSession {
            let path = ModelLocator.resolvedOnnxURL(for: filename).path
            do {
                let s = try ORTSession(env: env, modelPath: path, sessionOptions: opts)
                NSLog("[ST.load] ok %@ (%@)", filename, ModelLocator.precision.rawValue)
                return s
            } catch {
                NSLog("[ST.load] FAIL %@ (%@) at %@ — %@",
                      filename, ModelLocator.precision.rawValue, path,
                      String(describing: error))
                throw error
            }
        }

        self.dpSession  = try loadSession("duration_predictor.onnx")
        self.encSession = try loadSession("text_encoder.onnx")
        self.vecSession = try loadSession("vector_estimator.onnx")
        self.vocSession = try loadSession("vocoder.onnx")

        let cfgURL = ModelLocator.resolvedOnnxURL(for: "tts.json")
        let cfgData = try Data(contentsOf: cfgURL)
        self.config = try JSONDecoder().decode(TTSConfig.self, from: cfgData)

        let idxURL = ModelLocator.resolvedOnnxURL(for: "unicode_indexer.json")
        self.indexer = try UnicodeIndexer(url: idxURL)
    }

    func voicePack(for voiceId: String) throws -> VoicePack {
        if let cached = voiceCache[voiceId] { return cached }
        let url = ModelLocator.resolvedVoiceURL(for: voiceId)
        guard FileManager.default.fileExists(atPath: url.path) else {
            throw SupertonicError.voiceMissing(voiceId)
        }
        let pack = try VoicePack(voiceId: voiceId, url: url)
        // Bound the cache. With 10 total voices we never actually evict in
        // practice, but the cap means a future model expansion can't leak.
        if voiceCache.count >= 8 {
            voiceCache.removeAll()
        }
        voiceCache[voiceId] = pack
        return pack
    }

    /// Warm the JSON-decode + tensor-allocation path for the most likely
    /// first-tap voice. Called from `prefetch()` so the user's first `speak()`
    /// doesn't pay the 50–150 ms voice-load cost mid-tap.
    func prewarmDefaultVoice() {
        try? _ = voicePack(for: "F1")
    }

    /// Drop all loaded sessions, indexer, voice tensors. Called from
    /// `OnDestroy` so resources release deterministically rather than waiting
    /// for ARC.
    func tearDown() {
        voiceCache.removeAll()
        indexer = nil
        config = nil
        dpSession = nil
        encSession = nil
        vecSession = nil
        vocSession = nil
        env = nil
    }

    func beginRun() {
        cancelLock.lock(); _cancelled = false; cancelLock.unlock()
    }

    func cancel() {
        cancelLock.lock(); _cancelled = true; cancelLock.unlock()
    }

    private var isCancelled: Bool {
        cancelLock.lock(); defer { cancelLock.unlock() }
        return _cancelled
    }

    // MARK: - Inference

    /// Synthesize a single (already-chunked) input. Returns float32 PCM in [-1, 1].
    /// Use `synthesize` / `synthesizeStreaming` from the module layer; those handle chunking.
    func synthesizeOne(text: String, lang: String, voiceId: String, totalStep: Int, speed: Double) throws -> [Float] {
        // Per-stage timing. Logs once per call so the line count stays small;
        // remove or guard with a debug flag before tagging a release if it
        // turns out to be noisy.
        let t0 = CFAbsoluteTimeGetCurrent()
        func dMs(_ from: CFAbsoluteTime, _ to: CFAbsoluteTime) -> String {
            String(format: "%.0f", (to - from) * 1000)
        }

        try loadIfNeeded()
        let tLoad = CFAbsoluteTimeGetCurrent()
        guard let cfg = config, env != nil, let indexer = indexer,
              let dp = dpSession, let enc = encSession, let vec = vecSession, let voc = vocSession else {
            throw SupertonicError.modelMissing
        }
        let voice = try voicePack(for: voiceId)
        let tVoice = CFAbsoluteTimeGetCurrent()

        let processed = TextFrontend.preprocess(text, lang: lang)
        let textIds: [Int64] = indexer.encode(processed)
        if textIds.isEmpty { return [] }
        let bsz = 1
        let textLen = textIds.count
        let textMask: [Float] = Array(repeating: 1.0, count: textLen)
        let tText = CFAbsoluteTimeGetCurrent()

        if isCancelled { throw SupertonicError.cancelled }

        let textIdsValue = try ORTValue(
            tensorData: NSMutableData(bytes: textIds, length: textIds.count * MemoryLayout<Int64>.size),
            elementType: .int64,
            shape: [NSNumber(value: bsz), NSNumber(value: textLen)]
        )
        let textMaskValue = try ORTValue(
            tensorData: NSMutableData(bytes: textMask, length: textMask.count * MemoryLayout<Float>.size),
            elementType: .float,
            shape: [NSNumber(value: bsz), NSNumber(value: 1), NSNumber(value: textLen)]
        )

        let tTensors = CFAbsoluteTimeGetCurrent()

        // 1. Duration prediction.
        let dpOut = try dp.run(
            withInputs: ["text_ids": textIdsValue, "style_dp": voice.dpValue, "text_mask": textMaskValue],
            outputNames: ["duration"],
            runOptions: nil
        )
        guard let durValue = dpOut["duration"] else { throw SupertonicError.modelMissing }
        let durData = try durValue.tensorData() as Data
        var duration: [Float] = durData.withUnsafeBytes {
            Array(UnsafeBufferPointer(start: $0.bindMemory(to: Float.self).baseAddress, count: durData.count / 4))
        }
        for i in 0..<duration.count { duration[i] /= Float(speed) }
        let tDP = CFAbsoluteTimeGetCurrent()

        if isCancelled { throw SupertonicError.cancelled }

        // 2. Text encoder. Hold the ORTValue across the denoising loop —
        // Swift ARC keeps it alive; the upstream Helper.swift reference uses
        // the same pattern and works.
        let encOut = try enc.run(
            withInputs: ["text_ids": textIdsValue, "style_ttl": voice.ttlValue, "text_mask": textMaskValue],
            outputNames: ["text_emb"],
            runOptions: nil
        )
        guard let textEmb = encOut["text_emb"] else { throw SupertonicError.modelMissing }
        let tEnc = CFAbsoluteTimeGetCurrent()

        // 3. Sample initial noisy latent + mask.
        let baseChunk = cfg.ae.base_chunk_size
        let chunkCompress = cfg.ttl.chunk_compress_factor
        let latentDimBase = cfg.ttl.latent_dim
        let latentDim = latentDimBase * chunkCompress
        let chunkSize = baseChunk * chunkCompress
        let maxDur = duration.max() ?? 0
        let wavLenMax = Int(maxDur * Float(cfg.ae.sample_rate))
        let latentLen = (wavLenMax + chunkSize - 1) / chunkSize
        let wavLengths = duration.map { Int($0 * Float(cfg.ae.sample_rate)) }
        let latentLengths = wavLengths.map { ($0 + chunkSize - 1) / chunkSize }

        var noisy = [Float](repeating: 0, count: bsz * latentDim * latentLen)
        // Box-Muller -> gaussian noise, then masked.
        var idx = 0
        for b in 0..<bsz {
            let lLen = latentLengths[b]
            for d in 0..<latentDim {
                for t in 0..<latentLen {
                    if t < lLen {
                        let u1 = Float.random(in: 1e-7...1.0)
                        let u2 = Float.random(in: 0.0...1.0)
                        noisy[idx] = sqrt(-2.0 * log(u1)) * cos(2.0 * .pi * u2)
                    }
                    idx += 1
                }
                _ = d
            }
            _ = b
        }
        var latentMask = [Float](repeating: 0, count: bsz * 1 * latentLen)
        for b in 0..<bsz {
            for t in 0..<latentLengths[b] {
                latentMask[b * latentLen + t] = 1.0
            }
        }

        let latentMaskValue = try ORTValue(
            tensorData: NSMutableData(bytes: latentMask, length: latentMask.count * MemoryLayout<Float>.size),
            elementType: .float,
            shape: [NSNumber(value: bsz), NSNumber(value: 1), NSNumber(value: latentLen)]
        )
        let totalStepArr = [Float](repeating: Float(totalStep), count: bsz)
        let totalStepValue = try ORTValue(
            tensorData: NSMutableData(bytes: totalStepArr, length: totalStepArr.count * MemoryLayout<Float>.size),
            elementType: .float,
            shape: [NSNumber(value: bsz)]
        )
        let tNoise = CFAbsoluteTimeGetCurrent()

        // 4. Denoising loop. Per-step time logged so we can see if the bottleneck
        // is ramp-up (first step paying compile cost) vs. steady-state.
        var stepTimes: [Double] = []
        for step in 0..<totalStep {
            let tStepStart = CFAbsoluteTimeGetCurrent()
            if isCancelled { throw SupertonicError.cancelled }
            let xtValue = try ORTValue(
                tensorData: NSMutableData(bytes: noisy, length: noisy.count * MemoryLayout<Float>.size),
                elementType: .float,
                shape: [NSNumber(value: bsz), NSNumber(value: latentDim), NSNumber(value: latentLen)]
            )
            let curStepArr = [Float](repeating: Float(step), count: bsz)
            let curStepValue = try ORTValue(
                tensorData: NSMutableData(bytes: curStepArr, length: curStepArr.count * MemoryLayout<Float>.size),
                elementType: .float,
                shape: [NSNumber(value: bsz)]
            )
            let vecOut = try vec.run(
                withInputs: [
                    "noisy_latent": xtValue,
                    "text_emb": textEmb,
                    "style_ttl": voice.ttlValue,
                    "latent_mask": latentMaskValue,
                    "text_mask": textMaskValue,
                    "current_step": curStepValue,
                    "total_step": totalStepValue
                ],
                outputNames: ["denoised_latent"],
                runOptions: nil
            )
            guard let denoised = vecOut["denoised_latent"] else { throw SupertonicError.modelMissing }
            let dData = try denoised.tensorData() as Data
            noisy = dData.withUnsafeBytes {
                Array(UnsafeBufferPointer(start: $0.bindMemory(to: Float.self).baseAddress, count: dData.count / 4))
            }
            stepTimes.append((CFAbsoluteTimeGetCurrent() - tStepStart) * 1000)
        }
        let tDiffusion = CFAbsoluteTimeGetCurrent()

        if isCancelled { throw SupertonicError.cancelled }

        // 5. Vocoder.
        let finalLatent = try ORTValue(
            tensorData: NSMutableData(bytes: noisy, length: noisy.count * MemoryLayout<Float>.size),
            elementType: .float,
            shape: [NSNumber(value: bsz), NSNumber(value: latentDim), NSNumber(value: latentLen)]
        )
        let vocOut = try voc.run(
            withInputs: ["latent": finalLatent],
            outputNames: ["wav_tts"],
            runOptions: nil
        )
        guard let wav = vocOut["wav_tts"] else { throw SupertonicError.modelMissing }
        let wavData = try wav.tensorData() as Data
        var wavSamples: [Float] = wavData.withUnsafeBytes {
            Array(UnsafeBufferPointer(start: $0.bindMemory(to: Float.self).baseAddress, count: wavData.count / 4))
        }

        // Trim to actual duration to drop silence padding.
        let trimLen = min(wavSamples.count, Int(duration[0] * Float(cfg.ae.sample_rate)))
        if trimLen > 0 && trimLen < wavSamples.count {
            wavSamples = Array(wavSamples.prefix(trimLen))
        }
        let tVoc = CFAbsoluteTimeGetCurrent()

        // One-line summary so this is easy to grep in Xcode console: "[ST.timing]"
        let totalMs = (tVoc - t0) * 1000
        let stepSummary = stepTimes.enumerated()
            .map { String(format: "%d:%.0f", $0.offset, $0.element) }
            .joined(separator: " ")
        NSLog("[ST.timing] total=\(String(format: "%.0f", totalMs))ms "
            + "load=\(dMs(t0, tLoad)) voice=\(dMs(tLoad, tVoice)) "
            + "text=\(dMs(tVoice, tText)) tensors=\(dMs(tText, tTensors)) "
            + "dp=\(dMs(tTensors, tDP)) enc=\(dMs(tDP, tEnc)) "
            + "noise=\(dMs(tEnc, tNoise)) diffusion=\(dMs(tNoise, tDiffusion)) "
            + "voc=\(dMs(tDiffusion, tVoc)) "
            + "chars=\(textIds.count) latentLen=\(latentLen) steps=[\(stepSummary)]")
        return wavSamples
    }

    /// Single-shot synthesis with chunking + 0.3s silence between chunks.
    func synthesize(text: String, lang: String, voiceId: String, totalStep: Int, speed: Double) throws -> [Float] {
        beginRun()
        let chunks = TextFrontend.chunk(text, lang: lang)
        if chunks.isEmpty { return [] }
        let silenceSamples = Int(0.3 * Double(sampleRate))
        let silence = [Float](repeating: 0, count: silenceSamples)

        var out: [Float] = []
        for (i, c) in chunks.enumerated() {
            if isCancelled { throw SupertonicError.cancelled }
            let pcm = try synthesizeOne(text: c, lang: lang, voiceId: voiceId, totalStep: totalStep, speed: speed)
            if i > 0 { out.append(contentsOf: silence) }
            out.append(contentsOf: pcm)
        }
        return out
    }

    /// Streaming: emit one chunk per sentence-ish unit to keep TTFA low.
    func synthesizeStreaming(
        text: String,
        lang: String,
        voiceId: String,
        totalStep: Int,
        speed: Double,
        onChunk: ([Float]) -> Void
    ) throws {
        let tStart = CFAbsoluteTimeGetCurrent()
        try loadIfNeeded()
        beginRun()
        let chunks = TextFrontend.chunk(text, lang: lang)
        var firstChunkLogged = false
        for c in chunks {
            if isCancelled { throw SupertonicError.cancelled }
            let pcm = try synthesizeOne(text: c, lang: lang, voiceId: voiceId, totalStep: totalStep, speed: speed)
            if !pcm.isEmpty {
                if !firstChunkLogged {
                    let ttfa = (CFAbsoluteTimeGetCurrent() - tStart) * 1000
                    NSLog(String(format: "[ST.timing] TTFA=%.0fms (first chunk emitted, chunks=%d)", ttfa, chunks.count))
                    firstChunkLogged = true
                }
                onChunk(pcm)
            }
        }
    }

    // MARK: - Bridge helpers

    /// Converts float32 samples to little-endian PCM16 for transport across the JS bridge.
    static func toPCM16(samples: [Float]) -> Data {
        var out = Data(count: samples.count * 2)
        out.withUnsafeMutableBytes { (raw: UnsafeMutableRawBufferPointer) in
            let int16s = raw.bindMemory(to: Int16.self)
            for i in 0..<samples.count {
                let clamped = max(-1.0, min(1.0, samples[i]))
                int16s[i] = Int16(clamped * 32767.0).littleEndian
            }
        }
        return out
    }
}
