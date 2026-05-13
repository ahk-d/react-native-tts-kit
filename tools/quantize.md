# Quantizing Supertonic-3

`tools/quantize.py` converts the upstream fp32 ONNX bundle to fp16 weights for
the `ahk-d/supertonic-3` mirror's `onnx-fp16/` subdirectory. The existing
`onnx/` (fp32) set stays in place as a fallback tier.

## Why fp16 only

The default download is ~401 MB; fp16 halves it. Int8 was evaluated and
dropped — see "Why not int8" below.

Loaders don't change: `keep_io_types=True` preserves the float32 graph I/O
that [ios/Supertonic/SupertonicSession.swift](../ios/Supertonic/SupertonicSession.swift)
and the Kotlin equivalent are wired against. Attention sub-graphs are kept
in fp32 (blocked by node name) to work around an `onnxconverter_common` bug
that produces unloadable Cast patterns on the diffusion `vector_estimator`.

## Run on Colab

Open [`tools/quantize_colab.ipynb`](quantize_colab.ipynb) in Colab. Cells are
ordered: install deps → write quantize.py → write verify-quantized.py →
fetch fp32 → quantize → verify → upload → print hashes. Set a Colab secret
`HF_TOKEN` with write access to `ahk-d/supertonic-3` before running cell 7.

## Run locally

```bash
python3 -m venv tools/.venv
tools/.venv/bin/pip install onnx onnxruntime onnxconverter-common numpy

tools/.venv/bin/python tools/quantize.py \
  --src ~/supertonic-fp32/onnx \
  --out ~/supertonic-quantized

tools/.venv/bin/python tools/verify-quantized.py \
  --fp32 ~/supertonic-fp32/onnx \
  --fp16 ~/supertonic-quantized/onnx-fp16 \
  --indexer ~/supertonic-fp32/onnx/unicode_indexer.json \
  --voice   ~/supertonic-fp32/voice_styles/F1.json
```

Two gates:

1. **I/O signature parity.** Every session's inputs/outputs (names + dtypes +
   shapes) must match the fp32 graph.
2. **SNR vs fp32 baseline.** The full 4-stage pipeline runs on a fixed seed +
   "Hello, world." + voice F1; SNR ≥ 20 dB per stage. The threshold is set
   lower than textbook 35 dB because the diffusion loop compounds fp16 drift
   across 8 denoising steps — observed values are ~28 dB on `denoised_latent`
   and ~21 dB on `wav_tts`, audibly indistinguishable from fp32. The final
   real gate is the on-device `golden.json` check at
   [benchmarks/README.md:46-70](../benchmarks/README.md#L46-L70).

If both gates pass, upload `onnx-fp16/` to `ahk-d/supertonic-3`, note the new
commit SHA, then:

1. Paste the SHA into `mirrorRevision` in [ios/Supertonic/ModelLocator.swift](../ios/Supertonic/ModelLocator.swift)
   and `MIRROR_REVISION` in [android/.../ModelLocator.kt](../android/src/main/java/expo/modules/speechkit/supertonic/ModelLocator.kt).
2. Paste the 4 fp16 SHA-256 fingerprints into `expectedHashes` / `EXPECTED_HASHES`.
3. Confirm `precision = .fp16` / `PRECISION = FP16` is set in both locators.

## Why not int8

We tried `quantize_dynamic` with int8 weights. Two problems:

1. **iOS CPU EP rejects ConvInteger.** Letting it touch Conv layers emits
   `ConvInteger(opset-10)` ops that ORT's iOS CPU EP refuses with
   `NotImplemented`. Restricting to `op_types_to_quantize=["MatMul"]` works.

2. **Audio quality collapses.** MatMul-only int8 on the diffusion
   `vector_estimator` produces SNR of −1 dB vs fp32 — the output is
   essentially uncorrelated with the fp32 reference. And the size win is
   marginal because `vector_estimator` is attention-MatMul-heavy but its
   MatMuls are inside the attention blocks we already keep in fp32 for the
   fp16 conversion, so int8 only touches the FFN MatMuls — ~94% of fp32.

Not worth a separate tier. Removed from `quantize.py`, the locator's
`Precision` enum, and the Colab notebook.

## Why not the csukuangfj2 community int8 build

[`csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11`](https://huggingface.co/csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11)
ships int8 ONNX (vector_estimator 257→78 MB, vocoder 101→26 MB), but the
surrounding bundle is sherpa-onnx format: `unicode_indexer.bin` (binary LUT,
not JSON), single `voice.bin` blob instead of 10 voice JSONs, different
`tts.json` schema. Adopting it would force a tokenizer + voice-loader rewrite
on both platforms. Self-quantizing keeps the bundle layout identical.
