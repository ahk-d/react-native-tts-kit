#!/usr/bin/env bash
#
# Workaround for the fmt + Xcode 26 consteval incompatibility that breaks
# React Native 0.79.x builds. Xcode 26.5's clang enforces stricter consteval
# semantics that fmt's `basic_format_string` constructor doesn't satisfy
# when called from non-constexpr contexts inside fmt's own implementation.
#
# The fix: disable fmt's consteval path via its public toggle FMT_USE_CONSTEVAL=0.
# This is fmt's own escape hatch, not a downstream hack — see
# https://github.com/fmtlib/fmt/blob/master/include/fmt/base.h.
# With consteval disabled, fmt's basic_format_string is a regular constexpr
# function (still compile-time-evaluable where possible), and the build
# succeeds. Runtime behavior is identical.
#
# CocoaPods regenerates Pods/ from scratch on every `pod install` / `npx expo
# run:ios`, which means this patch has to be re-applied after each install.
# Run this script manually OR wire it into a post-pod-install hook in CI.
#
# This issue does NOT affect consumers of react-native-tts-kit who are on
# RN >= 0.80 (fmt upgrade landed upstream). It only affects this example app
# locally because we're pinned to Expo SDK 53 / RN 0.79.5.

set -euo pipefail

PODS_FMT_BASE="$(cd "$(dirname "$0")/../ios" && pwd)/Pods/fmt/include/fmt/base.h"

if [ ! -f "$PODS_FMT_BASE" ]; then
  echo "fmt headers not found at $PODS_FMT_BASE — did you run 'pod install'?"
  exit 1
fi

if grep -q '^#define FMT_USE_CONSTEVAL 0 // patched' "$PODS_FMT_BASE"; then
  echo "fmt already patched, nothing to do."
  exit 0
fi

# CocoaPods installs pod headers read-only. Allow writes for the patch.
chmod u+w "$PODS_FMT_BASE"

# Force FMT_USE_CONSTEVAL=0. The header has an autodetect block that sets
# FMT_USE_CONSTEVAL based on compiler version; we override the result.
# Inserted right before the `#if FMT_USE_CONSTEVAL` block that uses it.
python3 - "$PODS_FMT_BASE" <<'PY'
import sys, re, pathlib
p = pathlib.Path(sys.argv[1])
src = p.read_text()
marker = "#if FMT_USE_CONSTEVAL\n#  define FMT_CONSTEVAL consteval"
patched = "#undef FMT_USE_CONSTEVAL\n#define FMT_USE_CONSTEVAL 0 // patched: Xcode 26 consteval incompat\n" + marker
if marker not in src:
    sys.exit("expected marker not found in fmt/base.h — fmt version may have changed; update patch-fmt.sh")
p.write_text(src.replace(marker, patched, 1))
PY

echo "✓ fmt patched at $PODS_FMT_BASE"
