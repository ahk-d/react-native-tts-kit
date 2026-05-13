#!/usr/bin/env bash
# Run the example app on an iOS device, drive the in-app Benchmark screen,
# and save the resulting CSV under benchmarks/results/.
#
# Usage: ./benchmarks/run-ios.sh <device-udid>

set -euo pipefail

UDID="${1:-}"
if [[ -z "$UDID" ]]; then
  echo "usage: $0 <device-udid>"
  echo "tip: xcrun xctrace list devices"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RESULTS_DIR="$ROOT/benchmarks/results"
mkdir -p "$RESULTS_DIR"

cd "$ROOT/example"

if [[ ! -d ios ]]; then
  npx expo prebuild --platform ios --clean
fi

xcrun simctl boot "$UDID" 2>/dev/null || true

echo "[bench] building example app for $UDID…"
npx expo run:ios --device "$UDID" --configuration Release

DATE=$(date +%Y-%m-%d)
DEVICE_NAME=$(xcrun xctrace list devices 2>&1 | grep "$UDID" | sed -E 's/^([^(]*) .*/\1/' | tr ' ' '-' | tr '[:upper:]' '[:lower:]' | head -n1)
DEVICE_NAME="${DEVICE_NAME:-ios-$UDID}"
OUT="$RESULTS_DIR/${DEVICE_NAME}-${DATE}.csv"

echo "[bench] open the app, tap 'Run benchmarks', then re-run this script after copying the on-screen table into:"
echo "        $OUT"
echo "[bench] schema: prompt,engine,ttfa_ms,total_ms,rtf"
