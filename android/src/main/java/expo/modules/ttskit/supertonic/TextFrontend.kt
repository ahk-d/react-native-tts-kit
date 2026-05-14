package expo.modules.ttskit.supertonic

import org.json.JSONArray
import java.io.File
import java.text.Normalizer

object TextFrontend {
  val AVAILABLE_LANGS = setOf(
    "en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et", "fi",
    "fr", "hi", "hr", "hu", "id", "it", "lt", "lv", "nl", "pl", "pt", "ro",
    "ru", "sk", "sl", "sv", "tr", "uk", "vi"
  )

  private val ABBREVIATIONS = setOf(
    "Dr.", "Mr.", "Mrs.", "Ms.", "Prof.", "Sr.", "Jr.",
    "St.", "Ave.", "Rd.", "Blvd.", "Dept.", "Inc.", "Ltd.",
    "Co.", "Corp.", "etc.", "vs.", "i.e.", "e.g.", "Ph.D."
  )

  fun maxChunkLength(lang: String): Int = if (lang == "ko" || lang == "ja") 120 else 300

  fun preprocess(text: String, lang: String): String {
    require(AVAILABLE_LANGS.contains(lang)) { "Unsupported language: $lang" }

    var s = Normalizer.normalize(text, Normalizer.Form.NFKD)

    // Strip emoji blocks.
    val sb = StringBuilder(s.length)
    var i = 0
    while (i < s.length) {
      val cp = s.codePointAt(i)
      val skip = (cp in 0x1F600..0x1F64F || cp in 0x1F300..0x1F5FF ||
        cp in 0x1F680..0x1F6FF || cp in 0x1F700..0x1F77F ||
        cp in 0x1F780..0x1F7FF || cp in 0x1F800..0x1F8FF ||
        cp in 0x1F900..0x1F9FF || cp in 0x1FA00..0x1FA6F ||
        cp in 0x1FA70..0x1FAFF || cp in 0x2600..0x26FF ||
        cp in 0x2700..0x27BF || cp in 0x1F1E6..0x1F1FF)
      if (!skip) sb.appendCodePoint(cp)
      i += Character.charCount(cp)
    }
    s = sb.toString()

    val replacements = mapOf(
      "–" to "-", "‑" to "-", "—" to "-",
      "_" to " ",
      "“" to "\"", "”" to "\"",
      "‘" to "'", "’" to "'",
      "´" to "'", "`" to "'",
      "[" to " ", "]" to " ", "|" to " ", "/" to " ", "#" to " ",
      "→" to " ", "←" to " "
    )
    for ((k, v) in replacements) s = s.replace(k, v)

    for (sym in listOf("♥", "☆", "♡", "©", "\\")) s = s.replace(sym, "")

    s = s.replace("@", " at ").replace("e.g.,", "for example, ").replace("i.e.,", "that is, ")

    val pSpacing = listOf(" ," to ",", " ." to ".", " !" to "!", " ?" to "?",
      " ;" to ";", " :" to ":", " '" to "'")
    for ((k, v) in pSpacing) s = s.replace(k, v)

    while (s.contains("\"\"")) s = s.replace("\"\"", "\"")
    while (s.contains("''"))   s = s.replace("''", "'")
    while (s.contains("``"))   s = s.replace("``", "`")

    s = s.replace(Regex("\\s+"), " ").trim()

    if (s.isNotEmpty() && !s.matches(Regex(".*[.!?;:,'\"\\u201C\\u201D\\u2018\\u2019)\\]}…。」』】〉》›»]\$"))) {
      s += "."
    }
    return "<$lang>$s</$lang>"
  }

  fun chunk(text: String, lang: String): List<String> {
    val maxLen = maxChunkLength(lang)
    val trimmed = text.trim(); if (trimmed.isEmpty()) return emptyList()

    val paragraphs = trimmed.split(Regex("\\n\\s*\\n")).map { it.trim() }.filter { it.isNotEmpty() }
    val chunks = mutableListOf<String>()
    val source = if (paragraphs.isEmpty()) listOf(trimmed) else paragraphs

    for (p in source) {
      if (p.length <= maxLen) { chunks.add(p); continue }
      chunks.addAll(greedyJoin(splitSentences(p), maxLen))
    }
    return if (chunks.isEmpty()) listOf(trimmed) else chunks
  }

  private fun splitSentences(text: String): List<String> {
    // Latin punctuation requires trailing whitespace; Asian terminal
    // punctuation (。！？) does not. Without the Asian branch, long ja/ko/zh
    // strings collapse into one oversized chunk which the model truncates.
    val regex = Regex("([.!?])\\s+|([。！？])")
    val matches = regex.findAll(text).toList()
    if (matches.isEmpty()) return listOf(text)

    val out = mutableListOf<String>()
    var lastEnd = 0
    for (m in matches) {
      val before = text.substring(lastEnd, m.range.first)
      val punc = text[m.range.first].toString()
      val combined = before.trim() + punc
      val isAbbrev = ABBREVIATIONS.any { combined.endsWith(it) }
      if (!isAbbrev) {
        out.add(text.substring(lastEnd, m.range.last + 1))
        lastEnd = m.range.last + 1
      }
    }
    if (lastEnd < text.length) out.add(text.substring(lastEnd))
    return if (out.isEmpty()) listOf(text) else out
  }

  private fun greedyJoin(pieces: List<String>, maxLen: Int): List<String> {
    val out = mutableListOf<String>()
    var current = ""
    for (raw in pieces) {
      val p = raw.trim(); if (p.isEmpty()) continue
      current = when {
        current.isEmpty() -> p
        current.length + 1 + p.length <= maxLen -> "$current $p"
        else -> { out.add(current); p }
      }
    }
    if (current.isNotEmpty()) out.add(current)
    return out
  }
}

class UnicodeIndexer(path: String) {
  private val table: LongArray

  init {
    val text = File(path).readText(Charsets.UTF_8)
    val arr = JSONArray(text)
    val out = LongArray(arr.length())
    for (i in 0 until arr.length()) out[i] = arr.getLong(i)
    table = out
  }

  fun encode(text: String): LongArray {
    val codepoints = mutableListOf<Int>()
    var i = 0
    while (i < text.length) {
      val cp = text.codePointAt(i)
      codepoints.add(cp)
      i += Character.charCount(cp)
    }
    val out = LongArray(codepoints.size)
    for ((j, cp) in codepoints.withIndex()) {
      out[j] = if (cp < table.size) table[cp] else -1L
    }
    return out
  }
}
