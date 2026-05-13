#!/usr/bin/env bash
#
# Compute SHA-256 fingerprints for every model file at the pinned mirror
# revision. Output is shell-friendly and can be pasted (with light editing)
# into `expectedHashes` (Swift) and `EXPECTED_HASHES` (Kotlin) in the
# ModelLocator files.
#
# Run this when you bump MIRROR_REVISION / UPSTREAM_REVISION. Always cross-check
# the mirror's hashes against the upstream Supertone repo at the same logical
# version — if they diverge, do not bake; investigate why.
#
# Files are streamed through curl|shasum so nothing persists on disk; safe
# to run on a small VM. ~382 MiB is fetched in one pass.
#
# Requires: curl, shasum (BSD/macOS) or sha256sum (GNU).
#
# Usage:
#   ./tools/fingerprint.sh                # uses the SHA from ModelLocator.swift
#   ./tools/fingerprint.sh <revision-sha> # override

set -euo pipefail

REV="${1:-}"
if [[ -z "$REV" ]]; then
  REV=$(grep -E 'mirrorRevision\s*=' \
    "$(dirname "$0")/../ios/Supertonic/ModelLocator.swift" \
    | head -n1 | sed -E 's/.*"([0-9a-f]+)".*/\1/')
fi
if [[ -z "$REV" ]]; then
  echo "Could not determine mirror revision SHA." >&2
  exit 1
fi

BASE="https://huggingface.co/ahk-d/supertonic-3/resolve/$REV"

if command -v sha256sum >/dev/null 2>&1; then
  SHA="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  SHA="shasum -a 256"
else
  echo "Need sha256sum or shasum on PATH." >&2
  exit 1
fi

FILES=(
  "onnx/duration_predictor.onnx"
  "onnx/text_encoder.onnx"
  "onnx/vector_estimator.onnx"
  "onnx/vocoder.onnx"
  "onnx/tts.json"
  "onnx/unicode_indexer.json"
  "voice_styles/M1.json" "voice_styles/M2.json" "voice_styles/M3.json"
  "voice_styles/M4.json" "voice_styles/M5.json"
  "voice_styles/F1.json" "voice_styles/F2.json" "voice_styles/F3.json"
  "voice_styles/F4.json" "voice_styles/F5.json"
)

echo "# SHA-256 fingerprints for revision $REV"
echo "# (~382 MiB total fetch — runs entirely streamed, nothing written to disk.)"
echo ""

# Hash each file once, hold the result in HASHES[]; emit both Swift and Kotlin
# forms from the cached values so we don't re-fetch the 382 MiB twice.
declare -a HASHES
i=0
for f in "${FILES[@]}"; do
  HASHES[$i]=$(curl -sSL --max-time 600 "$BASE/$f" | $SHA | awk '{print $1}')
  i=$((i + 1))
done

echo "# --- Swift form (paste into expectedHashes in ModelLocator.swift) ---"
i=0
for f in "${FILES[@]}"; do
  printf '        "%s": "%s",\n' "$f" "${HASHES[$i]}"
  i=$((i + 1))
done
echo ""
echo "# --- Kotlin form (paste into EXPECTED_HASHES in ModelLocator.kt) ---"
i=0
for f in "${FILES[@]}"; do
  printf '    "%s" to "%s",\n' "$f" "${HASHES[$i]}"
  i=$((i + 1))
done
