import AVFoundation
import Foundation

/// Streams float32 PCM through AVAudioEngine. Used for both blocking `speak()`
/// (one-shot enqueue + wait) and `stream()` (chunk-by-chunk feeding).
///
/// We keep PCM as float32 internally — that's what Supertonic emits and what
/// `AVAudioPlayerNode` natively consumes. The Int16 conversion only happens
/// at the JS bridge boundary (when emitting `onStreamChunk`).
final class AudioEngine {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private var configuredSampleRate: Double = 0
    private var attached = false
    private var streaming = false
    private let queue = DispatchQueue(label: "speechkit.audioengine", qos: .userInitiated)

    /// Configure (or reconfigure) the player for the given sample rate.
    private func ensureAttached(sampleRate: Int) throws {
        let target = Double(sampleRate)
        if attached && configuredSampleRate == target { return }

        if attached {
            engine.disconnectNodeOutput(player)
        } else {
            engine.attach(player)
        }
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: target, channels: 1, interleaved: false)
        engine.connect(player, to: engine.mainMixerNode, format: format)

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try session.setActive(true, options: [])

        if !engine.isRunning {
            try engine.start()
        }
        configuredSampleRate = target
        attached = true
    }

    /// One-shot playback that resolves only when the buffer has finished playing.
    func play(pcm: [Float], sampleRate: Int, volume: Float) async throws {
        try ensureAttached(sampleRate: sampleRate)
        player.volume = volume
        guard let buffer = makeBuffer(from: pcm, sampleRate: sampleRate) else { return }

        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            player.scheduleBuffer(buffer, at: nil, options: []) {
                cont.resume()
            }
            if !player.isPlaying { player.play() }
        }
    }

    func beginStream(sampleRate: Int, volume: Float) throws {
        try ensureAttached(sampleRate: sampleRate)
        player.volume = volume
        streaming = true
        if !player.isPlaying { player.play() }
    }

    func feedStream(chunk: [Float]) {
        // Only refuse work if we've been fully stopped — not on endStream(),
        // which only signals "no more chunks coming." Pending buffers that are
        // already in the async pipeline must still play out.
        guard streaming else { return }
        let sr = Int(configuredSampleRate)
        queue.async { [weak self] in
            guard let self, let buffer = self.makeBuffer(from: chunk, sampleRate: sr) else { return }
            self.player.scheduleBuffer(buffer, at: nil, options: [], completionHandler: nil)
        }
    }

    /// Signals that no more chunks will be fed. Does NOT cancel pending audio —
    /// `feedStream` may have enqueued buffers on the audio queue that haven't
    /// scheduled yet. Those must play out so the user hears the audio they
    /// synthesized. Use `stop()` to interrupt actual playback.
    func endStream() {
        // Intentionally leaves `streaming = true` so any feedStream() calls
        // still in flight from the synthesis callback complete normally.
        // The flag is reset by `stop()` or by the next `beginStream()`.
    }

    func stop() {
        streaming = false
        if player.isPlaying { player.stop() }
    }

    func tearDown() {
        stop()
        if engine.isRunning { engine.stop() }
        attached = false
        configuredSampleRate = 0
    }

    private func makeBuffer(from pcm: [Float], sampleRate: Int) -> AVAudioPCMBuffer? {
        guard !pcm.isEmpty,
              let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: Double(sampleRate), channels: 1, interleaved: false),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(pcm.count))
        else { return nil }
        buffer.frameLength = AVAudioFrameCount(pcm.count)
        if let dst = buffer.floatChannelData?.pointee {
            pcm.withUnsafeBufferPointer { src in
                dst.update(from: src.baseAddress!, count: pcm.count)
            }
        }
        return buffer
    }
}
