package expo.modules.speechkit.supertonic

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Streams float32 PCM through AudioTrack. The model emits float32 samples in
 * [-1, 1]; we feed those straight into AudioTrack's `ENCODING_PCM_FLOAT` so we
 * skip a conversion on the hot path.
 *
 * `play()` blocks until the buffer has actually been rendered (not just
 * enqueued) so the JS-side `onSpeakDone` event fires accurately.
 */
class AudioEngine {
  private var track: AudioTrack? = null
  private var configuredSampleRate: Int = 0
  private val streaming = AtomicBoolean(false)
  // Frames written via feedStream() since the last beginStream(). Used by
  // endStream() to wait for the playback head to catch up so the caller's
  // "done" callback fires after the user actually hears the last samples.
  private var streamFramesWritten: Long = 0
  // playbackHeadPosition value at beginStream(). Used as a baseline because
  // the track is reused across calls (ensureTrack returns the existing track
  // when the sample rate matches) and the head counter is monotonic across
  // its lifetime, not per-stream.
  private var streamHeadBaseline: Long = 0

  private fun ensureTrack(sampleRate: Int): AudioTrack {
    val existing = track
    if (existing != null && configuredSampleRate == sampleRate) return existing

    existing?.runCatching { release() }
    track = null

    val minBuf = AudioTrack.getMinBufferSize(
      sampleRate,
      AudioFormat.CHANNEL_OUT_MONO,
      AudioFormat.ENCODING_PCM_FLOAT
    ).coerceAtLeast(32 * 1024)

    val t = AudioTrack.Builder()
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ASSISTANT)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
      )
      .setAudioFormat(
        AudioFormat.Builder()
          .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
          .setSampleRate(sampleRate)
          .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
          .build()
      )
      .setBufferSizeInBytes(minBuf)
      .setTransferMode(AudioTrack.MODE_STREAM)
      .build()
    track = t
    configuredSampleRate = sampleRate
    return t
  }

  /** Blocking playback. Returns once playback has actually drained, not just enqueued. */
  fun play(samples: FloatArray, sampleRate: Int, volume: Float) {
    if (samples.isEmpty()) return
    val t = ensureTrack(sampleRate)
    t.setVolume(volume.coerceIn(0f, 1f))
    if (t.playState != AudioTrack.PLAYSTATE_PLAYING) t.play()

    var written = 0
    while (written < samples.size) {
      val n = t.write(samples, written, samples.size - written, AudioTrack.WRITE_BLOCKING)
      if (n <= 0) break
      written += n
    }

    // Wait for playback head to reach the end — write() returns when buffered, not played.
    val totalFrames = written
    val pollIntervalMs = 20L
    var safety = 0
    while (t.playbackHeadPosition < totalFrames && safety < 5_000) {
      Thread.sleep(pollIntervalMs)
      safety++
    }
    t.stop()
    t.flush()
  }

  fun beginStream(sampleRate: Int, volume: Float) {
    val t = ensureTrack(sampleRate)
    t.setVolume(volume.coerceIn(0f, 1f))
    if (t.playState != AudioTrack.PLAYSTATE_PLAYING) t.play()
    streamFramesWritten = 0
    streamHeadBaseline = t.playbackHeadPosition.toLong() and 0xFFFFFFFFL
    streaming.set(true)
  }

  fun feedStream(chunk: FloatArray) {
    if (!streaming.get()) return
    val t = track ?: return
    var written = 0
    while (written < chunk.size && streaming.get()) {
      val n = t.write(chunk, written, chunk.size - written, AudioTrack.WRITE_BLOCKING)
      if (n <= 0) break
      written += n
    }
    streamFramesWritten += written
  }

  /**
   * Wait for the AudioTrack to actually play out the frames we've written
   * before returning, so the caller's "done" callback fires after the user
   * hears the last samples — not just when we've finished enqueueing them.
   */
  fun endStream() {
    val t = track
    if (t != null && streaming.get() && streamFramesWritten > 0) {
      val targetFrames = streamHeadBaseline + streamFramesWritten
      val deadline = System.currentTimeMillis() + 10_000
      while (System.currentTimeMillis() < deadline) {
        val played = t.playbackHeadPosition.toLong() and 0xFFFFFFFFL
        if (played >= targetFrames) break
        Thread.sleep(20)
      }
    }
    streaming.set(false)
    streamFramesWritten = 0
    streamHeadBaseline = 0
  }

  fun stop() {
    streaming.set(false)
    track?.runCatching { pause(); flush() }
  }

  fun tearDown() {
    stop()
    track?.runCatching { release() }
    track = null
    configuredSampleRate = 0
  }

  /** Convert float32 samples to little-endian PCM16 for the JS bridge. */
  companion object {
    fun toPcm16(samples: FloatArray): ByteArray {
      val out = ByteBuffer.allocate(samples.size * 2).order(ByteOrder.LITTLE_ENDIAN)
      for (s in samples) {
        val clamped = if (s > 1f) 1f else if (s < -1f) -1f else s
        out.putShort((clamped * 32767f).toInt().toShort())
      }
      return out.array()
    }
  }
}
