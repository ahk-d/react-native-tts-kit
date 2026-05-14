package expo.modules.ttskit.supertonic

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import org.json.JSONObject
import java.io.File
import java.nio.FloatBuffer

/**
 * Loads `voice_styles/<id>.json` from upstream Supertonic.
 * Each file contains two 3D float tensors: style_ttl and style_dp.
 */
class VoicePack(val voiceId: String, env: OrtEnvironment, path: String) {
  val ttl: OnnxTensor
  val dp: OnnxTensor

  init {
    val text = File(path).readText(Charsets.UTF_8)
    val root = JSONObject(text)
    ttl = parseComponent(env, root.getJSONObject("style_ttl"))
    dp  = parseComponent(env, root.getJSONObject("style_dp"))
  }

  fun close() {
    runCatching { ttl.close() }
    runCatching { dp.close() }
  }

  private fun parseComponent(env: OrtEnvironment, obj: JSONObject): OnnxTensor {
    val dimsArr = obj.getJSONArray("dims")
    val dims = LongArray(dimsArr.length()) { i -> dimsArr.getLong(i) }
    val total = dims.fold(1L) { acc, d -> acc * d }
    val flat = FloatArray(total.toInt())
    val data = obj.getJSONArray("data")
    var idx = 0
    for (a in 0 until data.length()) {
      val l1 = data.getJSONArray(a)
      for (b in 0 until l1.length()) {
        val l2 = l1.getJSONArray(b)
        for (c in 0 until l2.length()) {
          flat[idx++] = l2.getDouble(c).toFloat()
        }
      }
    }
    return OnnxTensor.createTensor(env, FloatBuffer.wrap(flat), dims)
  }
}
