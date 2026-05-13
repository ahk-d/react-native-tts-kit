import ExpoModulesCore

public class RNSpeechKitModule: Module {
    private var session: SupertonicSession?
    private let audioEngine = AudioEngine()
    private var prefetchTask: Task<Void, Error>?

    public func definition() -> ModuleDefinition {
        Name("RNSpeechKit")

        Events(
            "onPrefetchProgress",
            "onStreamChunk",
            "onStreamEnd",
            "onStreamError",
            "onSpeakStart",
            "onSpeakDone"
        )

        OnCreate {
            self.session = SupertonicSession()
        }

        OnDestroy {
            self.session?.tearDown()
            self.session = nil
            self.audioEngine.tearDown()
        }

        AsyncFunction("isAvailable") { () -> Bool in
            return ModelLocator.modelExists()
        }

        AsyncFunction("prefetch") { (promise: Promise) in
            self.prefetchTask?.cancel()
            self.prefetchTask = Task { [weak self] in
                guard let self else { return }
                do {
                    try await ModelLocator.ensureModel { progress in
                        self.sendEvent("onPrefetchProgress", [
                            "bytesDownloaded": progress.bytesDownloaded,
                            "totalBytes": progress.totalBytes,
                            "percent": progress.percent
                        ])
                    }
                    try self.session?.loadIfNeeded()
                    // Pre-warm the default voice so first speak() after
                    // prefetch doesn't pay JSON-decode + tensor-alloc cost.
                    self.session?.prewarmDefaultVoice()
                    promise.resolve()
                } catch {
                    promise.reject("PREFETCH_FAILED", error.localizedDescription)
                }
            }
        }

        AsyncFunction("speak") { (id: String, text: String, voiceId: String, lang: String, totalStep: Int, speed: Double, volume: Double, promise: Promise) in
            Task { [weak self] in
                guard let self, let session = self.session else {
                    promise.reject("MODEL_NOT_LOADED", "Supertonic session unavailable")
                    return
                }
                do {
                    try session.loadIfNeeded()
                    self.sendEvent("onSpeakStart", ["id": id])
                    let samples = try session.synthesize(
                        text: text,
                        lang: lang,
                        voiceId: voiceId,
                        totalStep: totalStep,
                        speed: speed
                    )
                    try await self.audioEngine.play(pcm: samples, sampleRate: session.sampleRate, volume: Float(volume))
                    self.sendEvent("onSpeakDone", ["id": id])
                    promise.resolve()
                } catch {
                    promise.reject("SYNTHESIS_FAILED", error.localizedDescription)
                }
            }
        }

        AsyncFunction("stream") { (id: String, text: String, voiceId: String, lang: String, totalStep: Int, speed: Double, volume: Double, promise: Promise) in
            Task { [weak self] in
                guard let self, let session = self.session else {
                    promise.reject("MODEL_NOT_LOADED", "Supertonic session unavailable")
                    return
                }
                do {
                    try session.loadIfNeeded()
                    try self.audioEngine.beginStream(sampleRate: session.sampleRate, volume: Float(volume))
                    try session.synthesizeStreaming(
                        text: text,
                        lang: lang,
                        voiceId: voiceId,
                        totalStep: totalStep,
                        speed: speed
                    ) { samples in
                        let pcm16 = SupertonicSession.toPCM16(samples: samples)
                        self.sendEvent("onStreamChunk", ["id": id, "pcm": pcm16.base64EncodedString()])
                        self.audioEngine.feedStream(chunk: samples)
                    }
                    self.audioEngine.endStream()
                    self.sendEvent("onStreamEnd", ["id": id])
                    promise.resolve()
                } catch {
                    self.audioEngine.endStream()
                    self.sendEvent("onStreamError", ["id": id, "message": error.localizedDescription])
                    promise.reject("SYNTHESIS_FAILED", error.localizedDescription)
                }
            }
        }

        AsyncFunction("stop") { (promise: Promise) in
            self.audioEngine.stop()
            self.session?.cancel()
            promise.resolve()
        }

        AsyncFunction("clearCache") { (promise: Promise) in
            // Tear down loaded ORTSessions first — they hold references to the
            // files we're about to delete. Otherwise the next loadIfNeeded()
            // would short-circuit (isReady == true) and skip re-loading from
            // disk, masking whether the re-download actually worked.
            self.prefetchTask?.cancel()
            self.audioEngine.stop()
            self.session?.cancel()
            self.session?.tearDown()
            ModelLocator.clearCache()
            self.session = SupertonicSession()
            promise.resolve()
        }
    }
}
