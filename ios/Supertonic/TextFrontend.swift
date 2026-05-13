import Foundation

/// Self-contained text frontend for Supertonic.
///
/// Ported from `supertone-inc/supertonic/swift/Sources/Helper.swift` —
/// keep this file in sync if upstream's preprocessing changes.
///
/// Key behaviors:
///   1. NFKD-decompose text (`decomposedStringWithCompatibilityMapping`).
///   2. Strip emoji + symbols, collapse whitespace, normalize punctuation spacing.
///   3. Wrap with `<lang>...</lang>` markers.
///   4. Tokenize: codepoint -> indexer[codepoint] -> Int64 token id.
///      The `unicode_indexer.json` shipped alongside the model is a flat
///      `[Int64]` array of length 2^16 (BMP); index by codepoint, get token id.
///      Codepoints outside the array become -1 (the model's PAD/UNK).
enum TextFrontend {
    static let availableLangs: Set<String> = [
        "en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et", "fi",
        "fr", "hi", "hr", "hu", "id", "it", "lt", "lv", "nl", "pl", "pt", "ro",
        "ru", "sk", "sl", "sv", "tr", "uk", "vi"
    ]

    /// Per-language max chunk length (matches upstream).
    static func maxChunkLength(for lang: String) -> Int {
        return (lang == "ko" || lang == "ja") ? 120 : 300
    }

    /// Apply upstream's text normalization rules and wrap with `<lang>...</lang>`.
    static func preprocess(_ text: String, lang: String) -> String {
        precondition(availableLangs.contains(lang), "Unsupported language: \(lang)")

        var s = text.decomposedStringWithCompatibilityMapping

        // Strip wide-Unicode emoji blocks.
        s = String(String.UnicodeScalarView(s.unicodeScalars.filter { scalar in
            let v = scalar.value
            return !((0x1F600...0x1F64F).contains(v) ||
                     (0x1F300...0x1F5FF).contains(v) ||
                     (0x1F680...0x1F6FF).contains(v) ||
                     (0x1F700...0x1F77F).contains(v) ||
                     (0x1F780...0x1F7FF).contains(v) ||
                     (0x1F800...0x1F8FF).contains(v) ||
                     (0x1F900...0x1F9FF).contains(v) ||
                     (0x1FA00...0x1FA6F).contains(v) ||
                     (0x1FA70...0x1FAFF).contains(v) ||
                     (0x2600...0x26FF).contains(v) ||
                     (0x2700...0x27BF).contains(v) ||
                     (0x1F1E6...0x1F1FF).contains(v))
        }))

        let replacements: [(String, String)] = [
            ("\u{2013}", "-"), ("\u{2011}", "-"), ("\u{2014}", "-"),
            ("_", " "),
            ("\u{201C}", "\""), ("\u{201D}", "\""),
            ("\u{2018}", "'"), ("\u{2019}", "'"),
            ("´", "'"), ("`", "'"),
            ("[", " "), ("]", " "),
            ("|", " "), ("/", " "), ("#", " "),
            ("→", " "), ("←", " ")
        ]
        for (k, v) in replacements { s = s.replacingOccurrences(of: k, with: v) }

        for sym in ["♥", "☆", "♡", "©", "\\"] {
            s = s.replacingOccurrences(of: sym, with: "")
        }

        for (k, v) in [("@", " at "), ("e.g.,", "for example, "), ("i.e.,", "that is, ")] {
            s = s.replacingOccurrences(of: k, with: v)
        }

        let punctSpacing = [(" ,", ","), (" .", "."), (" !", "!"), (" ?", "?"),
                            (" ;", ";"), (" :", ":"), (" '", "'")]
        for (k, v) in punctSpacing { s = s.replacingOccurrences(of: k, with: v) }

        while s.contains("\"\"") { s = s.replacingOccurrences(of: "\"\"", with: "\"") }
        while s.contains("''")   { s = s.replacingOccurrences(of: "''",   with: "'") }
        while s.contains("``")   { s = s.replacingOccurrences(of: "``",   with: "`") }

        let ws = try! NSRegularExpression(pattern: "\\s+")
        s = ws.stringByReplacingMatches(
            in: s,
            range: NSRange(s.startIndex..., in: s),
            withTemplate: " "
        ).trimmingCharacters(in: .whitespacesAndNewlines)

        if !s.isEmpty {
            let endsWithPunct = try! NSRegularExpression(
                pattern: "[.!?;:,'\"\\u201C\\u201D\\u2018\\u2019)\\]}…。」』】〉》›»]$"
            )
            if endsWithPunct.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) == nil {
                s += "."
            }
        }
        return "<\(lang)>\(s)</\(lang)>"
    }

    /// Sentence-aware chunking, mirrors `chunkText` in upstream Helper.swift.
    /// Chunks at hard sentence boundaries; falls back to commas / spaces for
    /// pathologically long inputs.
    private static let abbreviations: Set<String> = [
        "Dr.", "Mr.", "Mrs.", "Ms.", "Prof.", "Sr.", "Jr.",
        "St.", "Ave.", "Rd.", "Blvd.", "Dept.", "Inc.", "Ltd.",
        "Co.", "Corp.", "etc.", "vs.", "i.e.", "e.g.", "Ph.D."
    ]

    static func chunk(_ text: String, lang: String) -> [String] {
        let maxLen = maxChunkLength(for: lang)
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return [] }

        let paragraphs = splitParagraphs(trimmed)

        var chunks: [String] = []
        for p in paragraphs.isEmpty ? [trimmed] : paragraphs {
            if p.count <= maxLen { chunks.append(p); continue }
            chunks.append(contentsOf: greedyJoin(splitSentences(p), maxLen: maxLen))
        }
        return chunks.isEmpty ? [trimmed] : chunks
    }

    /// Split on `\n\s*\n+` — blank-line paragraph boundaries, mirroring
    /// upstream Helper.swift / helper.py. The previous implementation used a
    /// no-op ternary that never invoked the regex.
    private static func splitParagraphs(_ text: String) -> [String] {
        let regex = try! NSRegularExpression(pattern: "\\n\\s*\\n+")
        let nsText = text as NSString
        let fullRange = NSRange(location: 0, length: nsText.length)
        let matches = regex.matches(in: text, range: fullRange)
        if matches.isEmpty {
            return [text].filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        }
        var out: [String] = []
        var cursor = 0
        for m in matches {
            let piece = nsText.substring(with: NSRange(location: cursor, length: m.range.location - cursor))
            let trimmed = piece.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { out.append(trimmed) }
            cursor = m.range.location + m.range.length
        }
        if cursor < nsText.length {
            let tail = nsText.substring(from: cursor).trimmingCharacters(in: .whitespacesAndNewlines)
            if !tail.isEmpty { out.append(tail) }
        }
        return out
    }

    /// Split into sentences. Now recognises Asian terminal punctuation
    /// (`。！？`) which doesn't require trailing whitespace, so long
    /// Japanese / Chinese strings actually chunk instead of collapsing into a
    /// single oversized chunk that the model truncates.
    private static func splitSentences(_ text: String) -> [String] {
        // Latin-style: sentence-ender + whitespace.
        // Asian-style: 。！？ — whitespace optional.
        let regex = try! NSRegularExpression(pattern: "([.!?])\\s+|([。！？])")
        let range = NSRange(text.startIndex..., in: text)
        let matches = regex.matches(in: text, range: range)
        if matches.isEmpty { return [text] }

        var sentences: [String] = []
        var lastEnd = text.startIndex

        for m in matches {
            guard let r = Range(m.range, in: text) else { continue }
            let before = String(text[lastEnd..<r.lowerBound])
            let punc = String(text[Range(NSRange(location: m.range.location, length: 1), in: text)!])
            let combined = before.trimmingCharacters(in: .whitespaces) + punc
            let isAbbrev = abbreviations.contains { combined.hasSuffix($0) }
            if !isAbbrev {
                sentences.append(String(text[lastEnd..<r.upperBound]))
                lastEnd = r.upperBound
            }
        }
        if lastEnd < text.endIndex { sentences.append(String(text[lastEnd...])) }
        return sentences.isEmpty ? [text] : sentences
    }

    private static func greedyJoin(_ pieces: [String], maxLen: Int) -> [String] {
        var out: [String] = []
        var current = ""
        for piece in pieces {
            let p = piece.trimmingCharacters(in: .whitespacesAndNewlines)
            if p.isEmpty { continue }
            if current.isEmpty {
                current = p
            } else if current.count + 1 + p.count <= maxLen {
                current += " " + p
            } else {
                out.append(current)
                current = p
            }
        }
        if !current.isEmpty { out.append(current) }
        return out
    }
}

/// Loads `unicode_indexer.json` and turns text into Int64 token IDs.
final class UnicodeIndexer {
    private let table: [Int64]

    init(url: URL) throws {
        let data = try Data(contentsOf: url, options: .mappedIfSafe)
        self.table = try JSONDecoder().decode([Int64].self, from: data)
    }

    /// Encode a single string into Int64 token ids using NFKD codepoint indexing.
    func encode(_ text: String) -> [Int64] {
        var out: [Int64] = []
        out.reserveCapacity(text.unicodeScalars.count)
        for scalar in text.unicodeScalars {
            let v = Int(scalar.value)
            out.append(v < table.count ? table[v] : -1)
        }
        return out
    }
}
