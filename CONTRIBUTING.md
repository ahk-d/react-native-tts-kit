# Contributing

## Architecture overview

The package wraps Supertonic-3, an open-source on-device TTS model published by
Supertone Inc. under the BigScience OpenRAIL-M license. The pipeline:

```
text → preprocess (NFKD, lang tag) → unicode_indexer → token IDs
   ↓
duration_predictor.onnx   → seconds-of-audio per chunk
text_encoder.onnx          → text embedding
vector_estimator.onnx × 8  → iterative diffusion denoising of a noisy latent
vocoder.onnx               → float32 waveform @ 44.1 kHz
```

Native sources of truth:

- iOS: [`ios/Supertonic/`](ios/Supertonic/) — Swift port of the upstream
  reference at `supertone-inc/supertonic/swift/Sources/Helper.swift`.
- Android: [`android/src/main/java/expo/modules/ttskit/supertonic/`](android/src/main/java/expo/modules/ttskit/supertonic/) —
  Kotlin port of the same upstream.

Public TS API: [`src/`](src/). The native side is event-driven through
`expo-modules-core`'s `addListener`.

## Model weights

We **do not vendor** the `.onnx` files in this repo. They're downloaded on
first launch from a HuggingFace mirror.

### Mirror policy

The package fetches from two sources, in order:

1. **Primary (mirror):** [`ahk-d/supertonic-3`](https://huggingface.co/ahk-d/supertonic-3) — a byte-identical copy we control.
2. **Fallback (upstream):** [`Supertone/supertonic-3`](https://huggingface.co/Supertone/supertonic-3) — the official source.

Both are pinned to specific commit SHAs in [`ios/Supertonic/ModelLocator.swift`](ios/Supertonic/ModelLocator.swift) and [`android/.../ModelLocator.kt`](android/src/main/java/expo/modules/ttskit/supertonic/ModelLocator.kt). Pinning means an upstream push can never silently change behavior; mirror means an upstream delete can't break installed apps.

### Updating the mirror to a new upstream release

When Supertone publishes a new commit (a v3.1 fix, etc.) and we want to adopt it:

1. **Verify the new upstream release works** — clone Supertone's repo at the new SHA, run the upstream Python `example_onnx.py` locally to confirm audio quality.
2. **Update our mirror** — on HuggingFace, in `ahk-d/supertonic-3`, sync from upstream by either:
   - Re-running "Duplicate this model" from `Supertone/supertonic-3` (creates a new mirror at fresh SHAs), or
   - `git pull upstream main && git push origin main` if you've configured an upstream remote.
3. **Bump the SHAs in code** — both `mirrorRevision` (Swift) / `MIRROR_REVISION` (Kotlin) and `upstreamRevision` / `UPSTREAM_REVISION`. They're independent commit hashes but represent the same logical version.
4. **Test on real devices** — iOS + Android. New commits sometimes have I/O graph changes that break our port; the audit process below catches them.

### Audit process when upstream changes

If a new release modifies the ONNX graph or text frontend:

1. Clone upstream at the new SHA: `git clone --branch <sha> https://github.com/supertone-inc/supertonic.git`
2. Diff `py/helper.py` and `swift/Sources/Helper.swift` against the previous version.
3. Replicate any text-preprocessing changes in [`TextFrontend.swift`](ios/Supertonic/TextFrontend.swift) and [`TextFrontend.kt`](android/src/main/java/expo/modules/ttskit/supertonic/TextFrontend.kt).
4. Replicate any ONNX I/O changes in [`SupertonicSession.swift`](ios/Supertonic/SupertonicSession.swift) and [`SupertonicSession.kt`](android/src/main/java/expo/modules/ttskit/supertonic/SupertonicSession.kt).

## Local development

```bash
# Build the TS package
npm install
npm run build

# Build & run the example on a real iPhone
cd example
npm install
npx expo prebuild --platform ios       # NO --clean to preserve Podfile patches
cd ios && pod install && cd ..
npx expo run:ios --device <udid>

# Subsequent JS edits hot-reload via Metro
npx expo start --dev-client --clear

# Android
npx expo prebuild --platform android
npx expo run:android --device
```

### Xcode 26 / fmt build issue

iOS builds against Xcode 26 hit a `fmt` consteval error in the React Native pods. Two patches in [`example/ios/Podfile`](example/ios/Podfile) handle it:

1. Inject `FMT_USE_CONSTEVAL=0` and `FMT_USE_NONTYPE_TEMPLATE_ARGS=0` into the `fmt`/`glog`/`RCT-Folly` xcconfig files.
2. Patch `Pods/fmt/include/fmt/base.h` so its compiler-detection macro respects the preprocessor flag.

Both run automatically in `pod install`. If you wipe the Pods directory you need to re-run `pod install` to re-patch.

## Verification gates before tagging a release

1. Type-check: `npx tsc --noEmit -p tsconfig.json`
2. iOS Release build on at least one real device, airplane-mode test passes for English, Japanese, and one paragraph-length input.
3. Android Release build on at least one real device, same matrix.
4. Benchmark suite ([`./benchmarks/run-ios.sh`](benchmarks/run-ios.sh) and [`./benchmarks/run-android.sh`](benchmarks/run-android.sh)) — all rows green for at least one flagship.
5. Memory profile during a 100× synthesis loop: no leaks, peak RSS <500 MB.
6. Cold-start <2 s on flagship from app launch to first audible sample.
7. [`ATTRIBUTIONS.md`](ATTRIBUTIONS.md) reviewed; OpenRAIL-M notice + use restrictions still accurate.
8. `licenses/OpenRAIL-M.txt` is byte-identical to upstream.

## Adding a new engine

The multi-engine abstraction is the package's moat. To add an engine:

1. Implement [`src/engines/Engine.ts`](src/engines/Engine.ts) — the interface.
2. Register it in [`src/index.ts`](src/index.ts) (or have the user call `TTSKit.registerEngine(...)` for opt-in engines that pull heavy native deps).
3. Keep the public API stable — no engine should leak its capabilities into the call sites of `speak()` / `stream()`.
