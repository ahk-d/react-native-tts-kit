package expo.modules.ttskit.supertonic

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.nio.LongBuffer
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt
import kotlin.random.Random

class SupertonicSession(private val context: Context) {
  private var env: OrtEnvironment? = null
  private var dp: OrtSession? = null
  private var enc: OrtSession? = null
  private var vec: OrtSession? = null
  private var voc: OrtSession? = null
  private var indexer: UnicodeIndexer? = null
  private val voiceCache = HashMap<String, VoicePack>()
  private var sampleRateValue: Int = 24_000
  private var baseChunkSize: Int = 0
  private var chunkCompressFactor: Int = 0
  private var latentDimBase: Int = 0
  @Volatile private var cancelled = false

  val isReady: Boolean
    get() = dp != null && enc != null && vec != null && voc != null && indexer != null && baseChunkSize > 0
  val sampleRate: Int get() = sampleRateValue

  fun loadIfNeeded() {
    if (isReady) return
    val ortEnv = OrtEnvironment.getEnvironment()

    // EP strategy on Android: NNAPI with USE_FP16, then XNNPACK as fallback.
    //
    //   NNAPI + USE_FP16: takes the fp32 graph and relaxes it to fp16 inside
    //   the device's neural accelerator (Hexagon / Mali / etc.). This is the
    //   documented path to fp16 speed on Android; XNNPACK EP and the default
    //   CPU EP have no native fp16 kernels and produce a Cast-storm on fp16
    //   models (ORT issue #25824 — ~50% of time in casts, garbled outputs in
    //   diffusion models). That's why ModelLocator ships fp32 to Android.
    //
    //   If NNAPI rejects ops it can't handle, ORT auto-partitions them to the
    //   CPU EP — fine for stragglers. If addNnapi() itself throws (older
    //   Android with no NNAPI 1.2+, emulator), we fall through to XNNPACK
    //   which handles fp32 Conv/MatMul/Gemm quickly.
    val cpuCount = Runtime.getRuntime().availableProcessors()
    val xnnpackThreads = minOf(4, maxOf(2, cpuCount))

    fun OrtSession.SessionOptions.applyEps() {
      val nnapiOk = runCatching {
        // USE_FP16 = relax float32 → float16 at runtime where supported.
        // CPU_DISABLED stays unset so unsupported ops auto-fall-back to CPU EP.
        addNnapi(java.util.EnumSet.of(ai.onnxruntime.providers.NNAPIFlags.USE_FP16))
      }.isSuccess
      if (!nnapiOk) {
        android.util.Log.w("ST", "NNAPI EP unavailable, falling back to XNNPACK")
        runCatching { addXnnpack(mapOf("intra_op_num_threads" to xnnpackThreads.toString())) }
          .onFailure { android.util.Log.w("ST", "XNNPACK also unavailable, using CPU EP: ${it.message}") }
      } else {
        android.util.Log.i("ST", "NNAPI EP loaded with USE_FP16")
      }
    }

    // Toggle this to VERBOSE briefly when investigating NNAPI partitioning.
    // VERBOSE makes ORT log every op it placed on each EP and every "this op
    // is unsupported by NNAPI, falling back to CPU" decision. Helpful when
    // synthesis is unexpectedly slow on Android — we want to see what NNAPI
    // rejected. Leave at WARNING for release.
    val sessLogLevel = ai.onnxruntime.OrtLoggingLevel.ORT_LOGGING_LEVEL_WARNING

    val opts = OrtSession.SessionOptions().apply {
      setIntraOpNumThreads(1)
      setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
      setSessionLogLevel(sessLogLevel)
      applyEps()
    }
    // Diffusion graph (vec) sees varying input shapes per call. ORT's memory-
    // pattern optimizer pre-allocates buffers from a profiled shape and then
    // emits "Shape mismatch attempting to re-use buffer" warnings + reallocs
    // every step at runtime. Disabling the optimizer for this one session
    // skips the wasted alloc/free on the hot path. The text encoder, duration
    // predictor and vocoder have stable enough shapes that we leave it on.
    val vecOpts = OrtSession.SessionOptions().apply {
      setIntraOpNumThreads(1)
      setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
      setMemoryPatternOptimization(false)
      setSessionLogLevel(sessLogLevel)
      applyEps()
    }
    android.util.Log.i("ST", "Loading sessions with ortIntraOp=1 cpuCount=$cpuCount")

    env = ortEnv
    dp  = ortEnv.createSession(ModelLocator.resolvedOnnxPath(context, "duration_predictor.onnx"), opts)
    enc = ortEnv.createSession(ModelLocator.resolvedOnnxPath(context, "text_encoder.onnx"), opts)
    vec = ortEnv.createSession(ModelLocator.resolvedOnnxPath(context, "vector_estimator.onnx"), vecOpts)
    voc = ortEnv.createSession(ModelLocator.resolvedOnnxPath(context, "vocoder.onnx"), opts)

    val cfgPath = ModelLocator.resolvedOnnxPath(context, "tts.json")
    val cfg = JSONObject(File(cfgPath).readText())
    val ae = cfg.getJSONObject("ae")
    val ttl = cfg.getJSONObject("ttl")
    sampleRateValue = ae.getInt("sample_rate")
    baseChunkSize = ae.getInt("base_chunk_size")
    chunkCompressFactor = ttl.getInt("chunk_compress_factor")
    latentDimBase = ttl.getInt("latent_dim")

    val idxPath = ModelLocator.resolvedOnnxPath(context, "unicode_indexer.json")
    indexer = UnicodeIndexer(idxPath)
  }

  fun beginRun() { cancelled = false }
  fun cancel() { cancelled = true }

  private fun voicePack(voiceId: String): VoicePack {
    voiceCache[voiceId]?.let { return it }
    val path = ModelLocator.resolvedVoicePath(context, voiceId)
    require(File(path).exists()) { "Voice $voiceId not available" }
    val pack = VoicePack(voiceId, env!!, path)
    // Bound the cache. With 10 total voices we don't actually evict in
    // practice, but the cap means a future model expansion can't leak.
    if (voiceCache.size >= 8) {
      voiceCache.values.forEach { runCatching { it.close() } }
      voiceCache.clear()
    }
    voiceCache[voiceId] = pack
    return pack
  }

  /** Pre-warm the JSON-decode + tensor-allocation path for the most likely
   *  first-tap voice. Called from `prefetch()` so the user's first speak()
   *  doesn't pay 50–150 ms of voice-load cost mid-tap. */
  fun prewarmDefaultVoice() {
    runCatching { voicePack("F1") }
  }

  /** Drop all loaded sessions, indexer, voice tensors. Called from OnDestroy
   *  so resources release deterministically rather than waiting for GC. */
  fun tearDown() {
    voiceCache.values.forEach { runCatching { it.close() } }
    voiceCache.clear()
    indexer = null
    runCatching { dp?.close() }; dp = null
    runCatching { enc?.close() }; enc = null
    runCatching { vec?.close() }; vec = null
    runCatching { voc?.close() }; voc = null
    env = null
    baseChunkSize = 0
    chunkCompressFactor = 0
    latentDimBase = 0
  }

  fun synthesizeOne(text: String, lang: String, voiceId: String, totalStep: Int, speed: Double): FloatArray {
    val t0 = System.nanoTime()
    fun dMs(from: Long, to: Long) = ((to - from) / 1_000_000.0).toInt()

    loadIfNeeded()
    val tLoad = System.nanoTime()
    val ortEnv = env ?: error("env not initialized")
    val voice = voicePack(voiceId)
    val tVoice = System.nanoTime()

    val processed = TextFrontend.preprocess(text, lang)
    val ids = indexer!!.encode(processed)
    if (ids.isEmpty()) return FloatArray(0)
    val bsz = 1
    val textLen = ids.size
    val mask = FloatArray(textLen) { 1f }
    val tText = System.nanoTime()

    val textIdsT = OnnxTensor.createTensor(ortEnv, LongBuffer.wrap(ids), longArrayOf(bsz.toLong(), textLen.toLong()))
    val textMaskT = OnnxTensor.createTensor(ortEnv, FloatBuffer.wrap(mask), longArrayOf(bsz.toLong(), 1, textLen.toLong()))

    val tTensors = System.nanoTime()
    val dpInputs = mapOf("text_ids" to textIdsT, "style_dp" to voice.dp, "text_mask" to textMaskT)
    val dpOutput = dp!!.run(dpInputs)
    val durArr = (dpOutput.get(0).value as FloatArray).copyOf()
    dpOutput.close()
    for (i in durArr.indices) durArr[i] = (durArr[i] / speed.toFloat())
    val tDP = System.nanoTime()

    if (cancelled) throw RuntimeException("Synthesis cancelled")

    val encInputs = mapOf("text_ids" to textIdsT, "style_ttl" to voice.ttl, "text_mask" to textMaskT)
    val encOutput = enc!!.run(encInputs)
    // CRITICAL: Java ONNX Runtime ties child tensor lifetimes to the parent
    // OrtSession.Result. If we hold the raw `textEmb` across the denoising
    // loop and then close `encOutput`, every iteration after the first sees
    // an invalidated tensor and produces garbage audio. Clone into a fresh
    // owned tensor immediately and close the parent right away.
    val textEmb: OnnxTensor = encOutput.use { out ->
      val src = out.get(0) as OnnxTensor
      val shape = src.info.shape.copyOf()
      val total = shape.fold(1L) { acc, d -> acc * d }.toInt()
      val flat = FloatArray(total)
      val buf = src.floatBuffer
      buf.rewind()
      buf.get(flat)
      OnnxTensor.createTensor(ortEnv, FloatBuffer.wrap(flat), shape)
    }
    val tEnc = System.nanoTime()

    try {
      val latentDim = latentDimBase * chunkCompressFactor
      val chunkSize = baseChunkSize * chunkCompressFactor
      val maxDur = durArr.max()
      val wavLenMax = (maxDur * sampleRateValue).toInt()
      val latentLen = (wavLenMax + chunkSize - 1) / chunkSize
      val wavLengths = durArr.map { (it * sampleRateValue).toInt() }
      val latentLengths = wavLengths.map { (it + chunkSize - 1) / chunkSize }

      val noisy = FloatArray(bsz * latentDim * latentLen)
      var idx = 0
      for (b in 0 until bsz) {
        val lLen = latentLengths[b]
        for (d in 0 until latentDim) {
          for (t in 0 until latentLen) {
            if (t < lLen) {
              val u1 = max(1e-7f, Random.nextFloat())
              val u2 = Random.nextFloat()
              noisy[idx] = sqrt(-2f * ln(u1)) * cos(2f * Math.PI.toFloat() * u2)
            }
            idx++
          }
        }
      }
      val latentMask = FloatArray(bsz * latentLen)
      for (b in 0 until bsz) {
        for (t in 0 until latentLengths[b]) latentMask[b * latentLen + t] = 1f
      }

      val latentMaskT = OnnxTensor.createTensor(ortEnv, FloatBuffer.wrap(latentMask), longArrayOf(bsz.toLong(), 1, latentLen.toLong()))
      val totalStepArr = FloatArray(bsz) { totalStep.toFloat() }
      val totalStepT = OnnxTensor.createTensor(ortEnv, FloatBuffer.wrap(totalStepArr), longArrayOf(bsz.toLong()))
      val tNoise = System.nanoTime()

      var current = noisy
      val stepTimes = IntArray(totalStep)
      for (step in 0 until totalStep) {
        val tStepStart = System.nanoTime()
        if (cancelled) throw RuntimeException("Synthesis cancelled")
        val xt = OnnxTensor.createTensor(
          ortEnv,
          FloatBuffer.wrap(current),
          longArrayOf(bsz.toLong(), latentDim.toLong(), latentLen.toLong())
        )
        val curStepT = OnnxTensor.createTensor(ortEnv, FloatBuffer.wrap(FloatArray(bsz) { step.toFloat() }), longArrayOf(bsz.toLong()))
        val vecOut = vec!!.run(mapOf(
          "noisy_latent" to xt,
          "text_emb" to textEmb,
          "style_ttl" to voice.ttl,
          "latent_mask" to latentMaskT,
          "text_mask" to textMaskT,
          "current_step" to curStepT,
          "total_step" to totalStepT
        ))
        @Suppress("UNCHECKED_CAST")
        val raw = vecOut.get(0).value
        current = flatten3D(raw)
        vecOut.close()
        xt.close()
        curStepT.close()
        stepTimes[step] = ((System.nanoTime() - tStepStart) / 1_000_000).toInt()
      }
      val tDiffusion = System.nanoTime()

      if (cancelled) throw RuntimeException("Synthesis cancelled")

      val finalLatent = OnnxTensor.createTensor(
        ortEnv,
        FloatBuffer.wrap(current),
        longArrayOf(bsz.toLong(), latentDim.toLong(), latentLen.toLong())
      )
      val vocOut = voc!!.run(mapOf("latent" to finalLatent))
      @Suppress("UNCHECKED_CAST")
      val wavRaw = vocOut.get(0).value
      val wav = (wavRaw as Array<FloatArray>)[0]
      vocOut.close()
      finalLatent.close()
      latentMaskT.close()
      totalStepT.close()

      val tVoc = System.nanoTime()
      val trimLen = min(wav.size, (durArr[0] * sampleRateValue).toInt())
      val outArr = if (trimLen > 0 && trimLen < wav.size) wav.copyOfRange(0, trimLen) else wav

      val totalMs = dMs(t0, tVoc)
      val stepSummary = stepTimes.withIndex().joinToString(" ") { "${it.index}:${it.value}" }
      android.util.Log.i("ST.timing",
        "total=${totalMs}ms " +
        "load=${dMs(t0, tLoad)} voice=${dMs(tLoad, tVoice)} " +
        "text=${dMs(tVoice, tText)} tensors=${dMs(tText, tTensors)} " +
        "dp=${dMs(tTensors, tDP)} enc=${dMs(tDP, tEnc)} " +
        "noise=${dMs(tEnc, tNoise)} diffusion=${dMs(tNoise, tDiffusion)} " +
        "voc=${dMs(tDiffusion, tVoc)} " +
        "chars=${ids.size} latentLen=$latentLen steps=[$stepSummary]")
      return outArr
    } finally {
      runCatching { textEmb.close() }
      runCatching { textIdsT.close() }
      runCatching { textMaskT.close() }
    }
  }

  fun synthesize(text: String, lang: String, voiceId: String, totalStep: Int, speed: Double): FloatArray {
    beginRun()
    val chunks = TextFrontend.chunk(text, lang); if (chunks.isEmpty()) return FloatArray(0)
    val silence = FloatArray((0.3 * sampleRateValue).toInt())
    val out = ArrayList<Float>()
    for ((i, c) in chunks.withIndex()) {
      if (cancelled) throw RuntimeException("Synthesis cancelled")
      val pcm = synthesizeOne(c, lang, voiceId, totalStep, speed)
      if (i > 0) for (s in silence) out.add(s)
      for (s in pcm) out.add(s)
    }
    return FloatArray(out.size) { out[it] }
  }

  fun synthesizeStreaming(
    text: String, lang: String, voiceId: String, totalStep: Int, speed: Double,
    onChunk: (FloatArray) -> Unit
  ) {
    val tStart = System.nanoTime()
    loadIfNeeded()
    beginRun()
    val chunks = TextFrontend.chunk(text, lang)
    var firstChunkLogged = false
    for (c in chunks) {
      if (cancelled) return
      val pcm = synthesizeOne(c, lang, voiceId, totalStep, speed)
      if (pcm.isNotEmpty()) {
        if (!firstChunkLogged) {
          val ttfa = ((System.nanoTime() - tStart) / 1_000_000).toInt()
          android.util.Log.i("ST.timing", "TTFA=${ttfa}ms (first chunk emitted, chunks=${chunks.size})")
          firstChunkLogged = true
        }
        onChunk(pcm)
      }
    }
  }

  /** Flatten the ONNX float[B][D][T] result into a single FloatArray. */
  @Suppress("UNCHECKED_CAST")
  private fun flatten3D(raw: Any): FloatArray {
    val outer = raw as Array<Array<FloatArray>>
    val b = outer.size; val d = outer[0].size; val t = outer[0][0].size
    val out = FloatArray(b * d * t)
    var idx = 0
    for (i in 0 until b) for (j in 0 until d) for (k in 0 until t) {
      out[idx++] = outer[i][j][k]
    }
    return out
  }

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
