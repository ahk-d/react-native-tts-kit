package expo.modules.speechkit.supertonic

import android.content.Context
import java.io.File
import java.net.URL
import java.security.MessageDigest

object ModelLocator {
  /**
   * Weight precision tier. fp16 is a smaller download but only lives on
   * the ahk-d mirror — the upstream Supertone repo ships fp32 only. See
   * `tools/quantize.md` for how the fp16 files are produced and validated.
   * ONNX graph I/O is float32 for both tiers (fp16 uses keep_io_types),
   * so SupertonicSession.kt does not need to change between them.
   *
   * Int8 was evaluated and dropped: MatMul-only int8 (required to avoid
   * ConvInteger ops the iOS CPU EP refuses) produced ~94%-of-fp32 sizes
   * AND -1 dB SNR vs fp32 — unusable. Not worth a separate tier.
   */
  enum class Precision(val onnxSubdir: String, val hasUpstreamFallback: Boolean) {
    FP32("onnx", true),
    FP16("onnx-fp16", false),
  }

  /**
   * Default tier shipped to users.
   *
   * Android: FP32. ONNX Runtime's XNNPACK EP and CPU EP do not have native
   * fp16 kernels — loading an fp16 model triggers a Cast-storm at every
   * fp16↔fp32 boundary (ORT issue #25824) that makes synthesis ~10× slower
   * AND introduces numerical error that garbles diffusion-model audio.
   * Instead we ship fp32 weights and use the NNAPI EP with USE_FP16 to get
   * runtime fp16 math on the device. See SupertonicSession.kt for the EP
   * config and tools/quantize.md for the full rationale.
   *
   * iOS uses FP16 because CoreML / iOS CPU EP has true end-to-end fp16
   * kernels — set in ModelLocator.swift, independent of this Kotlin value.
   */
  val PRECISION: Precision = Precision.FP32

  /**
   * Mirror sources, tried in order. We host a pinned mirror of the
   * Supertonic-3 multilingual weights so:
   *   - Upstream availability changes (deletes, renames, paywall) don't
   *     break installed copies of this package.
   *   - We control when consumers see new model versions; an unpinned
   *     `main` would let surprise upstream pushes change behavior.
   *
   * Both entries are pinned to commit SHAs. The fallback is the official
   * Supertone repo at the *same* logical version — never v2 / v1.
   *
   * The two SHAs differ because each repo has its own commit history,
   * but the file contents at these revisions are byte-identical at the
   * fp32 tier.
   */
  private const val MIRROR_REVISION   = "4cb89eb91e92e9a92b60cac890b464f55a5d0064"
  private const val UPSTREAM_REVISION = "724fb5abbf5502583fb520898d45929e62f02c0b"

  /**
   * Per-tier URL list. fp32 falls back to upstream; quantized tiers are
   * mirror-only because upstream does not host them.
   */
  private val BASES: List<String>
    get() = buildList {
      add("https://huggingface.co/ahk-d/supertonic-3/resolve/$MIRROR_REVISION")
      if (PRECISION.hasUpstreamFallback) {
        add("https://huggingface.co/Supertone/supertonic-3/resolve/$UPSTREAM_REVISION")
      }
    }

  val ONNX_FILES = listOf(
    "duration_predictor.onnx",
    "text_encoder.onnx",
    "vector_estimator.onnx",
    "vocoder.onnx",
    "tts.json",
    "unicode_indexer.json"
  )
  val VOICE_IDS = listOf("M1", "M2", "M3", "M4", "M5", "F1", "F2", "F3", "F4", "F5")

  /**
   * SHA-256 fingerprints of every shipped file at the pinned mirror commit.
   *
   * `download()` verifies each file post-download and rejects the
   * mirror+fallback pair if both serve corrupted or substituted bytes.
   * To regenerate when bumping MIRROR_REVISION/UPSTREAM_REVISION: run
   * `tools/fingerprint.sh` and paste output here. Cross-checked against
   * upstream — values are byte-identical between the two repos.
   */
  val EXPECTED_HASHES: Map<String, String> = mapOf(
    "onnx/duration_predictor.onnx" to "c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db",
    "onnx/text_encoder.onnx"       to "c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff",
    "onnx/vector_estimator.onnx"   to "883ac868ea0275ef0e991524dc64f16b3c0376efd7c320af6b53f5b780d7c61c",
    "onnx/vocoder.onnx"            to "085de76dd8e8d5836d6ca66826601f615939218f90e519f70ee8a36ed2a4c4ba",
    "onnx/tts.json"                to "42078d3aef1cd43ab43021f3c54f47d2d75ceb4e75f627f118890128b06a0d09",
    "onnx/unicode_indexer.json"    to "9bf7346e43883a81f8645c81224f786d43c5b57f3641f6e7671a7d6c493cb24f",
    "voice_styles/F1.json"         to "bbdec6ee00231c2c742ad05483df5334cab3b52fda3ba38e6a07059c4563dbc2",
    "voice_styles/F2.json"         to "7c722c6a72707b1a77f035d67f0d1351ba187738e06f7683e8c72b1df3477fc6",
    "voice_styles/F3.json"         to "12f6ef2573baa2defa1128069cb59f203e3ab67c92af77b42df8a0e3a2f7c6ab",
    "voice_styles/F4.json"         to "c2fa764c1225a76dfc3e2c73e8aa4f70d9ee48793860eb34c295fff01c2e032b",
    "voice_styles/F5.json"         to "45966e73316415626cf41a7d1c6f3b4c70dbc1ba2bee5c1978ef0ce33244fc8d",
    "voice_styles/M1.json"         to "e35604687f5d23694b8e91593a93eec0e4eca6c0b02bb8ed69139ab2ea6b0a5b",
    "voice_styles/M2.json"         to "b76cbf62bac707c710cf0ae5aba5e31eea1a6339a9734bfae33ab98499534a50",
    "voice_styles/M3.json"         to "ea1ac35ccb91b0d7ecad533a2fbd0eec10c91513d8951e3b25fbba99954e159b",
    "voice_styles/M4.json"         to "ca8eefad4fcd989c9379032ff3e50738adc547eeb5e221b82593a6d7b3bac303",
    "voice_styles/M5.json"         to "dd22b92740314321f8ae11c5e87f8dd60d060f15dd3a632b5adf77f471f77af2",

    // fp16 weights — produced by tools/quantize_colab.ipynb.
    // Attention sub-graphs kept in fp32 to work around an onnxconverter_common
    // bug; vector_estimator therefore ends up at ~54% of fp32 instead of 50%.
    // Paste new hashes here when re-quantizing; placeholder values must be
    // updated together with the MIRROR_REVISION SHA above.
    "onnx-fp16/duration_predictor.onnx" to "95bf8c2dd3affd6e40bb57ad1c76018e47abc7b56a7978fe211ebe1359e478f1",
    "onnx-fp16/text_encoder.onnx"       to "fdfb21cb1596a6ac84699a6a0e236add97f95bfb492264209807777dd6c2e046",
    "onnx-fp16/vector_estimator.onnx"   to "7df9169002c8b8af4990bb1370cbb1c6600bcffef9749d9a83200e1b30a7a8b8",
    "onnx-fp16/vocoder.onnx"            to "f409960b6e74ef6e51c32b2cc77047ffbd426179f341214f42efb2a61aa91e57",
  )

  private fun supportDir(ctx: Context): File =
    File(ctx.filesDir, "RNSpeechKit/Supertonic").apply {
      mkdirs(); File(this, PRECISION.onnxSubdir).mkdirs(); File(this, "voice_styles").mkdirs()
    }

  fun onnxDir(ctx: Context): File = File(supportDir(ctx), PRECISION.onnxSubdir)
  fun voicesDir(ctx: Context): File = File(supportDir(ctx), "voice_styles")

  /** Bundled lookup checks app assets at `assets/models/<rest-of-path>`. */
  private fun bundledStream(ctx: Context, relPath: String): java.io.InputStream? = try {
    ctx.assets.open("models/$relPath")
  } catch (_: Exception) {
    null
  }

  fun resolvedOnnxPath(ctx: Context, name: String): String {
    val packed = File(onnxDir(ctx), name)
    if (packed.exists()) return packed.absolutePath
    // Config files always live under onnx/ in pre-bundled assets too,
    // since quantization doesn't touch them.
    val isConfig = name.endsWith(".json")
    val assetRel = "${if (isConfig) "onnx" else PRECISION.onnxSubdir}/$name"
    bundledStream(ctx, assetRel)?.use {
      packed.parentFile?.mkdirs()
      packed.outputStream().use { dst -> it.copyTo(dst) }
      return packed.absolutePath
    }
    return packed.absolutePath
  }

  fun resolvedVoicePath(ctx: Context, voiceId: String): String {
    val packed = File(voicesDir(ctx), "$voiceId.json")
    if (packed.exists()) return packed.absolutePath
    bundledStream(ctx, "voice_styles/$voiceId.json")?.use {
      packed.parentFile?.mkdirs()
      packed.outputStream().use { dst -> it.copyTo(dst) }
      return packed.absolutePath
    }
    return packed.absolutePath
  }

  /**
   * Wipe every downloaded file under filesDir/RNSpeechKit/Supertonic (all
   * precision subdirs + voice_styles). Pre-bundled files in app assets are
   * NOT touched — they're read-only and don't live here. Next call to
   * `ensureModel()` will re-download from the mirror.
   */
  fun clearCache(ctx: Context) {
    val dir = File(ctx.filesDir, "RNSpeechKit/Supertonic")
    val ok = dir.deleteRecursively()
    if (ok) {
      android.util.Log.i("ST.locator", "cleared cache at ${dir.absolutePath}")
    } else {
      android.util.Log.w("ST.locator", "clearCache failed at ${dir.absolutePath}")
    }
  }

  fun modelExists(ctx: Context): Boolean {
    for (f in ONNX_FILES) {
      val p = resolvedOnnxPath(ctx, f); if (!File(p).exists()) return false
    }
    return VOICE_IDS.any { File(resolvedVoicePath(ctx, it)).exists() }
  }

  /** Build the candidate URL list for a relative path. Tried in order. */
  private fun candidateUrls(relativePath: String): List<String> =
    BASES.map { "$it/$relativePath" }

  /**
   * True if `file` is missing or its SHA-256 doesn't match EXPECTED_HASHES.
   * On hash mismatch, deletes the file so the caller re-downloads it. Covers:
   *   1. Mirror revision bumped to a new model build — stale cache invalidates.
   *   2. Partial/corrupted file from an interrupted download.
   * Files without a registered hash (configs not in EXPECTED_HASHES) are
   * trusted on cache hit; only missing/corrupt is detected.
   */
  private fun needsDownload(file: File, relativePath: String): Boolean {
    if (!file.exists()) return true
    val expected = EXPECTED_HASHES[relativePath] ?: return false
    val actual = sha256(file)
    if (actual.equals(expected, ignoreCase = true)) return false
    android.util.Log.w(
      "ST.locator",
      "cached $relativePath hash mismatch (have ${actual.take(12)}, want ${expected.take(12)}) — re-downloading"
    )
    file.delete()
    return true
  }

  suspend fun ensureModel(ctx: Context, onProgress: (Long, Long) -> Unit) {
    // (relative path, candidate URL list, destination). First-success-wins per file.
    data class Pending(val rel: String, val urls: List<String>, val dst: File)
    val pending = mutableListOf<Pending>()
    for (f in ONNX_FILES) {
      val dst = File(resolvedOnnxPath(ctx, f))
      // Config files (tts.json, unicode_indexer.json) only live under
      // upstream's onnx/ — quantization doesn't touch them. Pull from
      // the fp32 path regardless of the active precision tier.
      val isConfig = f.endsWith(".json")
      val rel = "${if (isConfig) "onnx" else PRECISION.onnxSubdir}/$f"
      if (needsDownload(dst, rel)) {
        pending.add(Pending(rel, candidateUrls(rel), dst))
      }
    }
    for (v in VOICE_IDS) {
      val dst = File(resolvedVoicePath(ctx, v))
      val rel = "voice_styles/$v.json"
      if (needsDownload(dst, rel)) {
        pending.add(Pending(rel, candidateUrls(rel), dst))
      }
    }
    if (pending.isEmpty()) {
      logCachedSize(ctx, "cache hit")
      onProgress(1, 1); return
    }
    android.util.Log.i("ST.locator", "downloading ${pending.size} file(s) (precision=${PRECISION.onnxSubdir})")
    // Discover sizes from whichever mirror responds first. Used for progress
    // accounting only — actual download will surface failures if all mirrors
    // are unreachable.
    val totals = LongArray(pending.size) { i -> firstSuccessfulSize(pending[i].urls) }
    val grandTotal = totals.sum()
    var alreadyDownloaded = 0L
    for ((i, p) in pending.withIndex()) {
      downloadWithFallback(p.urls, p.dst, p.rel) { fileBytes ->
        onProgress(alreadyDownloaded + fileBytes, grandTotal)
      }
      // Log each file's on-disk size so a download summary shows up incrementally.
      val sz = if (p.dst.exists()) p.dst.length() else -1L
      android.util.Log.i("ST.locator", "downloaded ${p.rel} (${formatBytes(sz)})")
      alreadyDownloaded += totals[i]
    }
    onProgress(grandTotal, grandTotal)
    logCachedSize(ctx, "downloaded")
  }

  /**
   * Sum every file under the active onnx subdir + voice_styles and emit a
   * one-line log. Called from `ensureModel()` whether bytes were pulled or
   * files were already on disk.
   */
  private fun logCachedSize(ctx: Context, prefix: String) {
    val dirs = listOf(onnxDir(ctx), voicesDir(ctx))
    var total = 0L
    var fileCount = 0
    for (dir in dirs) {
      dir.walkTopDown().forEach { f ->
        if (f.isFile) { total += f.length(); fileCount += 1 }
      }
    }
    android.util.Log.i(
      "ST.locator",
      "$prefix: ${formatBytes(total)} across $fileCount file(s) under ${supportDir(ctx).absolutePath}"
    )
  }

  /** "138.1 MB" / "1.9 MB" / "8.3 KB" / "—" so logs stay readable. */
  private fun formatBytes(bytes: Long): String {
    if (bytes < 0) return "—"
    val kb = bytes / 1024.0
    if (kb < 1024.0) return "%.1f KB".format(kb)
    val mb = kb / 1024.0
    if (mb < 1024.0) return "%.1f MB".format(mb)
    return "%.2f GB".format(mb / 1024.0)
  }

  private fun firstSuccessfulSize(urls: List<String>): Long {
    for (u in urls) {
      try {
        val conn = (URL(u).openConnection() as java.net.HttpURLConnection).apply {
          requestMethod = "HEAD"
          connectTimeout = 15_000
          readTimeout = 15_000
        }
        conn.connect()
        if (conn.responseCode in 200..299) {
          val len = conn.contentLengthLong
          conn.disconnect()
          if (len > 0) return len
        }
        conn.disconnect()
      } catch (_: Exception) {
        // try next mirror
      }
    }
    return 0
  }

  private fun downloadWithFallback(
    candidates: List<String>,
    destination: File,
    relativePath: String,
    onProgress: (Long) -> Unit
  ) {
    var lastError: Exception? = null
    for (url in candidates) {
      try {
        download(url, destination, onProgress)
        // Verify file integrity if we have an expected hash.
        val expected = EXPECTED_HASHES[relativePath]
        if (expected != null) {
          val actual = sha256(destination)
          if (actual.equals(expected, ignoreCase = true)) return
          // Mismatch — delete and try next mirror.
          destination.delete()
          lastError = RuntimeException(
            "Downloaded $relativePath failed SHA-256 check (mirror may be compromised or stale)."
          )
          continue
        }
        return
      } catch (e: Exception) {
        lastError = e
      }
    }
    throw lastError ?: RuntimeException("All mirrors failed for ${destination.name}")
  }

  /** Stream-hashes `file` without holding it in memory. */
  private fun sha256(file: File): String {
    val md = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buf = ByteArray(64 * 1024)
      while (true) {
        val n = input.read(buf); if (n <= 0) break
        md.update(buf, 0, n)
      }
    }
    return md.digest().joinToString("") { "%02x".format(it) }
  }

  private fun download(urlStr: String, destination: File, onProgress: (Long) -> Unit) {
    val tmp = File(destination.parentFile, destination.name + ".part")
    tmp.parentFile?.mkdirs()
    val conn = URL(urlStr).openConnection()
    conn.connect()
    var downloaded = 0L
    conn.getInputStream().use { input ->
      tmp.outputStream().use { output ->
        val buffer = ByteArray(64 * 1024)
        while (true) {
          val n = input.read(buffer); if (n <= 0) break
          output.write(buffer, 0, n)
          downloaded += n
          if (downloaded % (256 * 1024) < 64 * 1024) onProgress(downloaded)
        }
      }
    }
    if (destination.exists()) destination.delete()
    if (!tmp.renameTo(destination)) {
      throw RuntimeException("Failed to install ${destination.absolutePath}")
    }
    onProgress(downloaded)
  }
}
