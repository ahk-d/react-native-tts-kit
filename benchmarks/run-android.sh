#!/usr/bin/env bash
# Run the example app on an Android device, drive the in-app Benchmark screen,
# and save the resulting CSV under benchmarks/results/.
#
# Usage: ./benchmarks/run-android.sh <device-serial>

set -euo pipefail

SERIAL="${1:-}"
if [[ -z "$SERIAL" ]]; then
  echo "usage: $0 <device-serial>"
  echo "tip: adb devices"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RESULTS_DIR="$ROOT/benchmarks/results"
mkdir -p "$RESULTS_DIR"

cd "$ROOT/example"

if [[ ! -d android ]]; then
  npx expo prebuild --platform android --clean
fi

echo "[bench] building example app for $SERIAL…"
ANDROID_SERIAL="$SERIAL" npx expo run:android --device --variant release

DATE=$(date +%Y-%m-%d)
MODEL=$(adb -s "$SERIAL" shell getprop ro.product.model | tr -d '\r' | tr ' ' '-' | tr '[:upper:]' '[:lower:]')
OUT="$RESULTS_DIR/${MODEL:-android-$SERIAL}-${DATE}.csv"

echo "[bench] open the app, tap 'Run benchmarks', then copy the on-screen table into:"
echo "        $OUT"
echo "[bench] schema: prompt,engine,ttfa_ms,total_ms,rtf"
