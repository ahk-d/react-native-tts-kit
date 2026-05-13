# Benchmarks

Reproducible TTFA / RTF measurements for the launch thread. Methodology:

1. **TTFA** (time-to-first-audio) is measured from the JS-side `speak()` call to the first audio chunk being decoded in JS. For the system engine we use `onStart`.
2. **Total** is wall-clock from `speak()` to the synthesis promise resolving.
3. **Audio duration** is computed from the cumulative PCM16 byte count and the configured sample rate (44.1 kHz, read from `tts.json`).
4. **RTF** = total / audio duration. Values below 1.0 mean the model is faster than real-time.

Numbers below should be **independently reproducible** by anyone with the example app installed and the model prefetched.

## How to run

```bash
# iOS
./benchmarks/run-ios.sh <device-udid>

# Android
./benchmarks/run-android.sh <device-serial>
```

Both scripts will install the example app, drive the in-app `Benchmark` screen, and dump CSV to `benchmarks/results/`.

## Targets

| Metric | Flagship | Mid-tier |
|---|---|---|
| TTFA (1 sentence) | <200 ms | <500 ms |
| RTF | <0.5× | <1.0× |
| Cold-start (first speak after boot) | <1.5 s | <2.5 s |

If a row goes red on a flagship, ship a fix before launch.

## Results

Drop CSVs in `results/` named `<device>-<date>.csv`. Example:

```
results/iphone-15-pro-2026-05-07.csv
results/pixel-8-2026-05-07.csv
```

The README chart in the repo root pulls from these.

## Reference-audio regression check (`golden.json`)

[`golden.json`](golden.json) holds a fingerprint of one canonical synthesis
("Hello, world." in English, voice F1, 8 denoising steps). Use it to detect
silent regressions when the model SHA, text frontend, or inference loop
changes.

**Capture workflow** (run after a verified-good build):

1. In the example app, run synthesis with the canonical input from `golden.json`.
2. Note `sampleCount` (length of returned PCM in samples), `rmsLevel`,
   `peakLevel`, and `durationMs` from the on-screen benchmark output.
3. Update `golden.json.expected` with the captured values + `captured_at`
   timestamp + `captured_device` model identifier.
4. Commit the updated `golden.json`.

**Verification workflow** (run on every release candidate):

1. Run the same canonical synthesis on a known-good device.
2. Compare captured values to `expected` within `tolerance` percentages.
3. If outside tolerance, audio has regressed — bisect recent changes.

This is intentionally a manual workflow rather than a CI job because:
- ONNX Runtime + a 400 MB model on a CI runner is unworkable.
- Diffusion uses RNG, so exact byte-match isn't possible — only statistical fingerprints make sense.
- A device-side comparison is the only way to validate "this still sounds right" pre-release.
