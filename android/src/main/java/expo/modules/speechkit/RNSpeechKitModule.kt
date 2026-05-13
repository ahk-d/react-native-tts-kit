package expo.modules.speechkit

import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.speechkit.supertonic.AudioEngine
import expo.modules.speechkit.supertonic.ModelLocator
import expo.modules.speechkit.supertonic.SupertonicSession
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class RNSpeechKitModule : Module() {
  private var session: SupertonicSession? = null
  private val audio = AudioEngine()
  private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
  private var prefetchJob: Job? = null

  override fun definition() = ModuleDefinition {
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
      session = SupertonicSession(appContext.reactContext!!)
    }

    OnDestroy {
      runCatching { session?.tearDown() }
      session = null
      audio.tearDown()
      scope.cancel()
    }

    AsyncFunction("isAvailable") {
      val ctx = appContext.reactContext ?: return@AsyncFunction false
      ModelLocator.modelExists(ctx)
    }

    AsyncFunction("prefetch") { promise: Promise ->
      val ctx = appContext.reactContext
      if (ctx == null) {
        promise.reject("CONTEXT_UNAVAILABLE", "React context unavailable", null)
        return@AsyncFunction
      }
      prefetchJob?.cancel()
      prefetchJob = scope.launch {
        try {
          ModelLocator.ensureModel(ctx) { downloaded, total ->
            sendEvent("onPrefetchProgress", mapOf(
              "bytesDownloaded" to downloaded,
              "totalBytes" to total,
              "percent" to if (total > 0) (downloaded.toDouble() / total * 100.0) else 0.0
            ))
          }
          session?.loadIfNeeded()
          // Pre-warm default voice so first speak() after prefetch doesn't
          // pay JSON-decode + tensor-alloc cost.
          session?.prewarmDefaultVoice()
          promise.resolve(null)
        } catch (e: Exception) {
          promise.reject("PREFETCH_FAILED", e.message ?: "prefetch failed", e)
        }
      }
    }

    AsyncFunction("speak") { id: String, text: String, voiceId: String, lang: String, totalStep: Int, speed: Double, volume: Double, promise: Promise ->
      scope.launch {
        try {
          val s = session ?: throw IllegalStateException("session not initialized")
          s.loadIfNeeded()
          // Pipe chunks through AudioTrack as they finish synthesizing rather
          // than synthesizing the whole utterance first. With multi-sentence
          // input this drops perceived TTFA from O(total-synthesis) to
          // O(first-sentence). For a single short input it's the same as
          // before. onSpeakStart fires when the first chunk hits the speaker.
          audio.beginStream(s.sampleRate, volume.toFloat())
          var startEmitted = false
          s.synthesizeStreaming(text, lang, voiceId, totalStep, speed) { samples ->
            if (!startEmitted) {
              sendEvent("onSpeakStart", mapOf("id" to id))
              startEmitted = true
            }
            audio.feedStream(samples)
          }
          audio.endStream()
          sendEvent("onSpeakDone", mapOf("id" to id))
          promise.resolve(null)
        } catch (e: Exception) {
          audio.endStream()
          promise.reject("SYNTHESIS_FAILED", e.message ?: "synthesis failed", e)
        }
      }
    }

    AsyncFunction("stream") { id: String, text: String, voiceId: String, lang: String, totalStep: Int, speed: Double, volume: Double, promise: Promise ->
      scope.launch {
        val s = session ?: run {
          promise.reject("MODEL_NOT_LOADED", "session not initialized", null)
          return@launch
        }
        try {
          s.loadIfNeeded()
          audio.beginStream(s.sampleRate, volume.toFloat())
          s.synthesizeStreaming(text, lang, voiceId, totalStep, speed) { samples ->
            val pcm16 = SupertonicSession.toPcm16(samples)
            val b64 = Base64.encodeToString(pcm16, Base64.NO_WRAP)
            sendEvent("onStreamChunk", mapOf("id" to id, "pcm" to b64))
            audio.feedStream(samples)
          }
          audio.endStream()
          sendEvent("onStreamEnd", mapOf("id" to id))
          promise.resolve(null)
        } catch (e: Exception) {
          audio.endStream()
          sendEvent("onStreamError", mapOf("id" to id, "message" to (e.message ?: "stream failed")))
          promise.reject("SYNTHESIS_FAILED", e.message ?: "stream failed", e)
        }
      }
    }

    AsyncFunction("stop") { promise: Promise ->
      audio.stop()
      session?.cancel()
      promise.resolve(null)
    }

    AsyncFunction("clearCache") { promise: Promise ->
      // Tear down the loaded ONNX sessions before deleting the files they
      // reference. Otherwise the next loadIfNeeded() would short-circuit
      // (isReady == true) and skip re-loading from disk. Then build a fresh
      // session so subsequent prefetch/speak calls have a non-null target.
      val ctx = appContext.reactContext
      prefetchJob?.cancel()
      audio.stop()
      runCatching { session?.cancel() }
      runCatching { session?.tearDown() }
      if (ctx != null) {
        ModelLocator.clearCache(ctx)
        session = SupertonicSession(ctx)
      } else {
        session = null
      }
      promise.resolve(null)
    }
  }
}
