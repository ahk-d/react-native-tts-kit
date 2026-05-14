import CryptoKit
import Foundation

struct PrefetchProgressInfo {
    let bytesDownloaded: Int64
    let totalBytes: Int64
    var percent: Double {
        guard totalBytes > 0 else { return 0 }
        return Double(bytesDownloaded) / Double(totalBytes) * 100.0
    }
}

/// Resolves and downloads the Supertonic asset bundle.
///
/// Upstream layout (https://huggingface.co/Supertone/supertonic-3,
/// `opensource-multilingual` split — 31 languages):
///   onnx/
///     duration_predictor.onnx     (3.7 MB)
///     text_encoder.onnx           (36 MB)
///     vector_estimator.onnx       (257 MB — cross-lingual weights, the bulk)
///     vocoder.onnx                (101 MB)
///     tts.json                    (8 KB config)
///     unicode_indexer.json        (~280 KB codepoint -> token id map)
///   voice_styles/
///     M1.json  M2.json … F5.json  (~290 KB each, 10 voices)
/// Grand total: ~401 MB on the wire (~382 MiB).
///
/// We mirror that layout under Application Support/RNTTSKit/Supertonic/.
/// Pinning to a specific commit SHA so model updates can't silently break us.
enum ModelLocator {
    /// Weight precision tier. fp16 is a smaller download but only lives on
    /// the ahk-d mirror — the upstream Supertone repo ships fp32 only. See
    /// `tools/quantize.md` for how the fp16 files are produced and validated.
    /// ONNX graph I/O is float32 for both tiers (fp16 uses keep_io_types),
    /// so SupertonicSession.swift does not need to change between them.
    ///
    /// Int8 was evaluated and dropped: MatMul-only int8 (required to avoid
    /// ConvInteger ops the iOS CPU EP refuses) produced ~94%-of-fp32 sizes
    /// AND −1 dB SNR vs fp32 — unusable. Not worth a separate tier.
    enum Precision: String {
        case fp32, fp16
        /// Relative path under the mirror for this tier's ONNX files.
        var onnxSubdir: String {
            switch self {
            case .fp32: return "onnx"
            case .fp16: return "onnx-fp16"
            }
        }
        /// Whether the upstream `Supertone/supertonic-3` repo also serves
        /// this tier. Only fp32 is upstream; fp16 is mirror-only.
        var hasUpstreamFallback: Bool { self == .fp32 }
    }

    /// Default tier shipped to users. Flip to `.fp16` after on-device
    /// audio regression passes (benchmarks/golden.json).
    static let precision: Precision = .fp16

    /// Mirror sources, tried in order. We host a pinned mirror of the
    /// Supertonic-3 multilingual weights (`opensource-multilingual` split, 31
    /// languages) so that:
    ///   - Upstream availability changes (deletes, renames, paywall) don't
    ///     break installed copies of this package.
    ///   - We control when consumers see new model versions; an unpinned
    ///     `main` would let surprise upstream pushes change behavior.
    ///
    /// Both entries are pinned to commit SHAs. The fallback is the official
    /// Supertone repo at the *same* logical version — if the mirror is down
    /// we still want to serve v3, never v2 or v1 (English-only).
    ///
    /// `MIRROR_REVISION` and `UPSTREAM_REVISION` happen to be different
    /// commits because each repo has its own commit history, but the file
    /// contents at these revisions are byte-identical at the fp32 tier.
    static let mirrorRevision   = "4cb89eb91e92e9a92b60cac890b464f55a5d0064"
    static let upstreamRevision = "724fb5abbf5502583fb520898d45929e62f02c0b"

    /// Per-tier URL list. fp32 falls back to upstream; quantized tiers are
    /// mirror-only because upstream does not host them.
    static var baseURLs: [String] {
        var urls = ["https://huggingface.co/ahk-d/supertonic-3/resolve/\(mirrorRevision)"]
        if precision.hasUpstreamFallback {
            urls.append("https://huggingface.co/Supertone/supertonic-3/resolve/\(upstreamRevision)")
        }
        return urls
    }

    static let onnxFiles = [
        "duration_predictor.onnx",
        "text_encoder.onnx",
        "vector_estimator.onnx",
        "vocoder.onnx",
        "tts.json",
        "unicode_indexer.json"
    ]

    static let voiceIds = ["M1", "M2", "M3", "M4", "M5", "F1", "F2", "F3", "F4", "F5"]

    /// SHA-256 fingerprints of every shipped file at the pinned mirror commit.
    ///
    /// `download()` verifies each file post-download and rejects the
    /// mirror+fallback pair if both serve corrupted or substituted bytes.
    /// To regenerate when bumping mirrorRevision/upstreamRevision: run
    /// `tools/fingerprint.sh` and paste output here. Cross-checked against
    /// upstream — values are byte-identical between the two repos.
    static let expectedHashes: [String: String] = [
        "onnx/duration_predictor.onnx": "c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db",
        "onnx/text_encoder.onnx":       "c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff",
        "onnx/vector_estimator.onnx":   "883ac868ea0275ef0e991524dc64f16b3c0376efd7c320af6b53f5b780d7c61c",
        "onnx/vocoder.onnx":            "085de76dd8e8d5836d6ca66826601f615939218f90e519f70ee8a36ed2a4c4ba",
        "onnx/tts.json":                "42078d3aef1cd43ab43021f3c54f47d2d75ceb4e75f627f118890128b06a0d09",
        "onnx/unicode_indexer.json":    "9bf7346e43883a81f8645c81224f786d43c5b57f3641f6e7671a7d6c493cb24f",
        "voice_styles/F1.json":         "bbdec6ee00231c2c742ad05483df5334cab3b52fda3ba38e6a07059c4563dbc2",
        "voice_styles/F2.json":         "7c722c6a72707b1a77f035d67f0d1351ba187738e06f7683e8c72b1df3477fc6",
        "voice_styles/F3.json":         "12f6ef2573baa2defa1128069cb59f203e3ab67c92af77b42df8a0e3a2f7c6ab",
        "voice_styles/F4.json":         "c2fa764c1225a76dfc3e2c73e8aa4f70d9ee48793860eb34c295fff01c2e032b",
        "voice_styles/F5.json":         "45966e73316415626cf41a7d1c6f3b4c70dbc1ba2bee5c1978ef0ce33244fc8d",
        "voice_styles/M1.json":         "e35604687f5d23694b8e91593a93eec0e4eca6c0b02bb8ed69139ab2ea6b0a5b",
        "voice_styles/M2.json":         "b76cbf62bac707c710cf0ae5aba5e31eea1a6339a9734bfae33ab98499534a50",
        "voice_styles/M3.json":         "ea1ac35ccb91b0d7ecad533a2fbd0eec10c91513d8951e3b25fbba99954e159b",
        "voice_styles/M4.json":         "ca8eefad4fcd989c9379032ff3e50738adc547eeb5e221b82593a6d7b3bac303",
        "voice_styles/M5.json":         "dd22b92740314321f8ae11c5e87f8dd60d060f15dd3a632b5adf77f471f77af2",

        // fp16 weights — produced by tools/quantize_colab.ipynb.
        // Attention sub-graphs kept in fp32 to work around an onnxconverter_common
        // bug; vector_estimator therefore ends up at ~54% of fp32 instead of 50%.
        // Paste new hashes here when re-quantizing; placeholder values must be
        // updated together with the mirrorRevision SHA above.
        "onnx-fp16/duration_predictor.onnx": "95bf8c2dd3affd6e40bb57ad1c76018e47abc7b56a7978fe211ebe1359e478f1",
        "onnx-fp16/text_encoder.onnx":       "fdfb21cb1596a6ac84699a6a0e236add97f95bfb492264209807777dd6c2e046",
        "onnx-fp16/vector_estimator.onnx":   "7df9169002c8b8af4990bb1370cbb1c6600bcffef9749d9a83200e1b30a7a8b8",
        "onnx-fp16/vocoder.onnx":            "f409960b6e74ef6e51c32b2cc77047ffbd426179f341214f42efb2a61aa91e57",
    ]

    /// Lookup for a relative path. Returns nil if no fingerprint is registered
    /// (in which case verification is skipped for that file).
    static func expectedHash(forRelativePath path: String) -> String? {
        return expectedHashes[path]
    }

    /// True if `url` is missing or its bytes don't match `expectedHash(forRelativePath:)`.
    /// On hash mismatch, deletes the file so the caller re-downloads it. This
    /// covers two real-world cases:
    ///   1. The mirror revision was bumped to a new model build (e.g. an fp16
    ///      bugfix). Old cached file's SHA no longer matches.
    ///   2. The file was partially written / corrupted by an interrupted download.
    /// Files without a registered hash (configs not in `expectedHashes`) are
    /// trusted on cache hit; only missing/corrupt is detected.
    static func needsDownload(at url: URL, relativePath: String) -> Bool {
        guard FileManager.default.fileExists(atPath: url.path) else { return true }
        guard let expected = expectedHash(forRelativePath: relativePath) else { return false }
        let actual = sha256(of: url)?.lowercased() ?? ""
        if actual == expected.lowercased() { return false }
        NSLog("[ST.locator] cached %@ hash mismatch (have %@, want %@) — re-downloading",
              relativePath, actual.prefix(12) as CVarArg, expected.prefix(12) as CVarArg)
        try? FileManager.default.removeItem(at: url)
        return true
    }

    static var supportDirectory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = base.appendingPathComponent("RNTTSKit/Supertonic", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: dir.appendingPathComponent(precision.onnxSubdir), withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: dir.appendingPathComponent("voice_styles"), withIntermediateDirectories: true)
        return dir
    }

    static var onnxDirectory: URL { supportDirectory.appendingPathComponent(precision.onnxSubdir) }
    static var voicesDirectory: URL { supportDirectory.appendingPathComponent("voice_styles") }

    /// Search every loaded bundle (main app, Pod resource bundles, frameworks) for a
    /// model file the host has pre-shipped alongside the package.
    static func bundledFile(named name: String, ext: String) -> URL? {
        let baseName = (name as NSString).deletingPathExtension
        for bundle in Bundle.allBundles + Bundle.allFrameworks {
            if let url = bundle.url(forResource: baseName, withExtension: ext),
               FileManager.default.fileExists(atPath: url.path) {
                return url
            }
        }
        return nil
    }

    static func resolvedOnnxURL(for filename: String) -> URL {
        let ext = (filename as NSString).pathExtension
        let base = (filename as NSString).deletingPathExtension
        if let bundled = bundledFile(named: base, ext: ext) { return bundled }
        return onnxDirectory.appendingPathComponent(filename)
    }

    static func resolvedVoiceURL(for voiceId: String) -> URL {
        if let bundled = bundledFile(named: voiceId, ext: "json") { return bundled }
        return voicesDirectory.appendingPathComponent("\(voiceId).json")
    }

    /// Wipe every downloaded file under Application Support/RNTTSKit/Supertonic
    /// (all precision subdirs + voice_styles). Pre-bundled files in the app
    /// resource bundle are NOT touched — they're read-only and don't live here.
    /// Next call to `ensureModel()` will re-download from the mirror.
    static func clearCache() {
        let dir = supportDirectory
        do {
            try FileManager.default.removeItem(at: dir)
            NSLog("[ST.locator] cleared cache at %@", dir.path)
        } catch {
            NSLog("[ST.locator] clearCache failed at %@: %@", dir.path, String(describing: error))
        }
    }

    /// True iff every ONNX/config file is on disk (bundled or downloaded).
    static func modelExists() -> Bool {
        for f in onnxFiles {
            if !FileManager.default.fileExists(atPath: resolvedOnnxURL(for: f).path) { return false }
        }
        // At least one voice must exist.
        return voiceIds.contains { FileManager.default.fileExists(atPath: resolvedVoiceURL(for: $0).path) }
    }

    /// Build the per-mirror URL list for a given relative path (e.g. "onnx/tts.json").
    private static func candidateURLs(for relativePath: String) -> [URL] {
        baseURLs.compactMap { URL(string: "\($0)/\(relativePath)") }
    }

    static func ensureModel(progress: @escaping (PrefetchProgressInfo) -> Void) async throws {
        // Skip already-present files (bundled or previously downloaded).
        // Each entry: (relative path, candidate URL list, destination on disk).
        var pending: [(String, [URL], URL)] = []
        for f in onnxFiles {
            let dst = resolvedOnnxURL(for: f)
            // Config files (tts.json, unicode_indexer.json) only live under
            // upstream's onnx/ — quantization doesn't touch them. Pull from
            // the fp32 path regardless of the active precision tier.
            let isConfig = f.hasSuffix(".json")
            let rel = "\(isConfig ? "onnx" : precision.onnxSubdir)/\(f)"
            if needsDownload(at: dst, relativePath: rel) {
                pending.append((rel, candidateURLs(for: rel), dst))
            }
        }
        for v in voiceIds {
            let dst = resolvedVoiceURL(for: v)
            let rel = "voice_styles/\(v).json"
            if needsDownload(at: dst, relativePath: rel) {
                pending.append((rel, candidateURLs(for: rel), dst))
            }
        }
        if pending.isEmpty {
            logCachedSize(prefix: "cache hit")
            progress(PrefetchProgressInfo(bytesDownloaded: 1, totalBytes: 1))
            return
        }
        NSLog("[ST.locator] downloading %d file(s) (precision=%@)",
              pending.count, precision.rawValue)
        // Discover sizes from whichever mirror responds first. Used only for
        // progress accounting; if no mirror responds to HEAD the download
        // itself will surface the failure.
        var fileTotals: [Int64] = []
        for (_, urls, _) in pending {
            fileTotals.append(await firstSuccessfulSize(urls: urls))
        }
        let grandTotal = fileTotals.reduce(0, +)
        var alreadyDownloaded: Int64 = 0
        for (i, (rel, urls, dst)) in pending.enumerated() {
            try await downloadWithFallback(candidates: urls, to: dst, relativePath: rel) { fileBytes in
                progress(PrefetchProgressInfo(
                    bytesDownloaded: alreadyDownloaded + fileBytes,
                    totalBytes: grandTotal
                ))
            }
            // Log each file's on-disk size after it lands so a download summary
            // shows up incrementally, not only after the slow vector_estimator.
            let sz = (try? FileManager.default.attributesOfItem(atPath: dst.path)[.size] as? Int64) ?? -1
            NSLog("[ST.locator] downloaded %@ (%@)", rel, formatBytes(sz))
            alreadyDownloaded += fileTotals[i]
        }
        progress(PrefetchProgressInfo(bytesDownloaded: grandTotal, totalBytes: grandTotal))
        logCachedSize(prefix: "downloaded")
    }

    /// Sums every file under the current precision's onnx dir + voice_styles
    /// and emits a one-line log. Called from `ensureModel()` after a successful
    /// pass (whether bytes were pulled or files were already on disk).
    private static func logCachedSize(prefix: String) {
        let dirs = [onnxDirectory, voicesDirectory]
        var total: Int64 = 0
        var fileCount = 0
        for dir in dirs {
            guard let it = FileManager.default.enumerator(at: dir, includingPropertiesForKeys: [.fileSizeKey]) else { continue }
            for case let url as URL in it {
                if let sz = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) {
                    total += Int64(sz)
                    fileCount += 1
                }
            }
        }
        NSLog("[ST.locator] %@: %@ across %d file(s) under %@",
              prefix, formatBytes(total), fileCount, supportDirectory.path)
    }

    /// "138.1 MB" / "1.9 MB" / "8.3 KB" / "—" — small helper so the log lines
    /// don't dump raw byte counts that nobody reads.
    private static func formatBytes(_ bytes: Int64) -> String {
        if bytes < 0 { return "—" }
        let f = ByteCountFormatter()
        f.allowedUnits = [.useKB, .useMB, .useGB]
        f.countStyle = .file
        return f.string(fromByteCount: bytes)
    }

    private static func firstSuccessfulSize(urls: [URL]) async -> Int64 {
        for url in urls {
            var req = URLRequest(url: url); req.httpMethod = "HEAD"
            do {
                let (_, resp) = try await URLSession.shared.data(for: req)
                if let http = resp as? HTTPURLResponse, !(200...299).contains(http.statusCode) { continue }
                if resp.expectedContentLength > 0 { return resp.expectedContentLength }
            } catch {
                continue
            }
        }
        return 0
    }

    private static func downloadWithFallback(
        candidates: [URL],
        to destination: URL,
        relativePath: String,
        progress: @escaping (Int64) -> Void
    ) async throws {
        var lastError: Error? = nil
        for url in candidates {
            do {
                try await download(from: url, to: destination, progress: progress)
                // Verify file integrity if we have an expected hash.
                if let expected = expectedHash(forRelativePath: relativePath) {
                    if let actual = sha256(of: destination), actual.lowercased() == expected.lowercased() {
                        return
                    }
                    // Hash mismatch — delete and try next mirror.
                    try? FileManager.default.removeItem(at: destination)
                    lastError = NSError(
                        domain: "ttskit.modellocator", code: -2,
                        userInfo: [NSLocalizedDescriptionKey:
                            "Downloaded \(relativePath) failed SHA-256 check (mirror may be compromised or stale)."]
                    )
                    continue
                }
                return
            } catch {
                lastError = error
                // Try the next mirror.
            }
        }
        throw lastError ?? URLError(.cannotConnectToHost)
    }

    /// Stream-hashes the file at `url` without holding it in memory.
    private static func sha256(of url: URL) -> String? {
        guard let stream = InputStream(url: url) else { return nil }
        stream.open()
        defer { stream.close() }
        var hasher = SHA256()
        let bufSize = 1 << 16 // 64 KiB
        let buf = UnsafeMutablePointer<UInt8>.allocate(capacity: bufSize)
        defer { buf.deallocate() }
        while stream.hasBytesAvailable {
            let n = stream.read(buf, maxLength: bufSize)
            if n <= 0 { break }
            hasher.update(bufferPointer: UnsafeRawBufferPointer(start: buf, count: n))
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    /// Streamed download with periodic progress callbacks. Drains in 1 MiB chunks.
    private static func download(
        from url: URL,
        to destination: URL,
        progress: @escaping (Int64) -> Void
    ) async throws {
        try? FileManager.default.createDirectory(
            at: destination.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let (bytes, _) = try await URLSession.shared.bytes(from: url)
        let tmp = destination.appendingPathExtension("part")
        try? FileManager.default.removeItem(at: tmp)
        FileManager.default.createFile(atPath: tmp.path, contents: nil)
        let handle = try FileHandle(forWritingTo: tmp)
        defer { try? handle.close() }

        let drainEvery = 1 << 20 // 1 MiB
        var pending = Data(); pending.reserveCapacity(drainEvery)
        var written: Int64 = 0
        var lastReport: Int64 = 0
        let reportEvery: Int64 = 256 * 1024

        for try await byte in bytes {
            pending.append(byte)
            if pending.count >= drainEvery {
                try handle.write(contentsOf: pending)
                written += Int64(pending.count)
                pending.removeAll(keepingCapacity: true)
                if written - lastReport >= reportEvery {
                    progress(written)
                    lastReport = written
                }
            }
        }
        if !pending.isEmpty {
            try handle.write(contentsOf: pending)
            written += Int64(pending.count)
        }
        try handle.close()
        try? FileManager.default.removeItem(at: destination)
        try FileManager.default.moveItem(at: tmp, to: destination)
        progress(written)
    }
}
