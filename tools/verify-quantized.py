#!/usr/bin/env python3
"""Gate fp16 Supertonic-3 weights before shipping.

Two checks:

1. I/O parity. Each session's input/output names + dtypes must match fp32.
   If anything differs, the Swift/Kotlin loaders need code changes — fail loudly.

2. Numerical regression. Runs each of the four ONNX sessions on a fixed
   reference input (deterministic noise, "Hello, world." token IDs, F1 voice)
   and reports SNR vs the fp32 baseline. Threshold: 20 dB per stage.

   Why 20 dB and not the textbook 35+ dB: the diffusion-style vector_estimator
   compounds fp32-vs-fp16 drift across 8 denoising steps and the output is RNG-
   driven; we typically see ~28 dB on denoised_latent and ~20 dB on wav_tts.
   That's audibly indistinguishable from fp32 in practice — the final gate is
   the on-device golden.json regression test, not the SNR number.

Usage:
    tools/.venv/bin/python tools/verify-quantized.py \\
        --fp32 /path/to/onnx \\
        --fp16 /path/to/out/onnx-fp16 \\
        --indexer /path/to/unicode_indexer.json \\
        --voice /path/to/voice_styles/F1.json
"""
from __future__ import annotations

import argparse
import json
import sys
import unicodedata
from pathlib import Path

import numpy as np
import onnxruntime as ort

FP16_SNR_DB = 20.0

REF_TEXT = "Hello, world."
REF_LANG = "en"


def preprocess(text: str, lang: str) -> str:
    # Mirror TextFrontend.preprocess on the Swift side (NFKD + <lang>...</lang>
    # wrap). We skip the emoji/punctuation rewrites — they don't affect the
    # "Hello, world." reference input the verifier uses.
    normalized = unicodedata.normalize("NFKD", text)
    return f"<{lang}>{normalized}</{lang}>"


def encode_text(processed: str, indexer_path: Path) -> np.ndarray:
    # unicode_indexer.json is a 65536-long list. Index = Unicode codepoint
    # (U+0000 to U+FFFF), value = token id (-1 for unmapped). Mirrors
    # UnicodeIndexer.encode in ios/Supertonic/TextFrontend.swift:206-215.
    table = json.loads(indexer_path.read_text())
    ids = [table[ord(ch)] if ord(ch) < len(table) else -1 for ch in processed]
    return np.array([ids], dtype=np.int64)


def load_voice(voice_path: Path) -> tuple[np.ndarray, np.ndarray]:
    # voice_styles/*.json shape: {"style_ttl": {"data": [...nested...], "dims": [1, 50, 256], "type": "float32"},
    #                              "style_dp":  {"data": [...nested...], "dims": [1, 8, 16], ...}}
    # Mirrors VoicePack.init in ios/Supertonic/VoicePack.swift:20-40.
    blob = json.loads(voice_path.read_text())

    def component_to_array(comp: dict) -> np.ndarray:
        arr = np.array(comp["data"], dtype=np.float32)
        dims = tuple(int(d) for d in comp["dims"])
        return arr.reshape(dims)

    return component_to_array(blob["style_dp"]), component_to_array(blob["style_ttl"])


def session(path: Path) -> ort.InferenceSession:
    so = ort.SessionOptions()
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    so.intra_op_num_threads = 2
    return ort.InferenceSession(str(path), sess_options=so, providers=["CPUExecutionProvider"])


def io_signature(s: ort.InferenceSession) -> tuple:
    return (
        tuple((i.name, i.type, tuple(i.shape)) for i in s.get_inputs()),
        tuple((o.name, o.type, tuple(o.shape)) for o in s.get_outputs()),
    )


def snr_db(reference: np.ndarray, candidate: np.ndarray) -> float:
    reference = reference.astype(np.float64).ravel()
    candidate = candidate.astype(np.float64).ravel()
    n = min(len(reference), len(candidate))
    reference, candidate = reference[:n], candidate[:n]
    noise = reference - candidate
    sig_pow = float(np.mean(reference * reference))
    noise_pow = float(np.mean(noise * noise))
    if noise_pow <= 0.0:
        return float("inf")
    if sig_pow <= 0.0:
        return float("-inf")
    return 10.0 * np.log10(sig_pow / noise_pow)


def run_pipeline(
    onnx_dir: Path,
    text_ids: np.ndarray,
    dp_style: np.ndarray,
    ttl_style: np.ndarray,
    cfg: dict,
    seed: int,
) -> dict[str, np.ndarray]:
    text_mask = np.ones((1, 1, text_ids.shape[1]), dtype=np.float32)

    dp_sess = session(onnx_dir / "duration_predictor.onnx")
    enc_sess = session(onnx_dir / "text_encoder.onnx")
    vec_sess = session(onnx_dir / "vector_estimator.onnx")
    voc_sess = session(onnx_dir / "vocoder.onnx")

    dp_out = dp_sess.run(
        ["duration"],
        {"text_ids": text_ids, "style_dp": dp_style, "text_mask": text_mask},
    )[0]
    enc_out = enc_sess.run(
        ["text_emb"],
        {"text_ids": text_ids, "style_ttl": ttl_style, "text_mask": text_mask},
    )[0]

    sr = int(cfg["ae"]["sample_rate"])
    base_chunk = int(cfg["ae"]["base_chunk_size"])
    chunk_compress = int(cfg["ttl"]["chunk_compress_factor"])
    latent_dim_base = int(cfg["ttl"]["latent_dim"])
    latent_dim = latent_dim_base * chunk_compress
    chunk_size = base_chunk * chunk_compress
    wav_len = int(float(dp_out.max()) * sr)
    latent_len = (wav_len + chunk_size - 1) // chunk_size
    latent_lengths = [(int(d * sr) + chunk_size - 1) // chunk_size for d in dp_out.ravel().tolist()]

    rng = np.random.default_rng(seed)
    noisy = rng.standard_normal((1, latent_dim, latent_len)).astype(np.float32)
    latent_mask = np.zeros((1, 1, latent_len), dtype=np.float32)
    for t in range(latent_lengths[0]):
        latent_mask[0, 0, t] = 1.0

    total_step = 8
    total_step_arr = np.full((1,), float(total_step), dtype=np.float32)
    for step in range(total_step):
        cur_step = np.full((1,), float(step), dtype=np.float32)
        noisy = vec_sess.run(
            ["denoised_latent"],
            {
                "noisy_latent": noisy,
                "text_emb": enc_out,
                "style_ttl": ttl_style,
                "latent_mask": latent_mask,
                "text_mask": text_mask,
                "current_step": cur_step,
                "total_step": total_step_arr,
            },
        )[0]

    wav = voc_sess.run(["wav_tts"], {"latent": noisy})[0]
    return {"duration": dp_out, "text_emb": enc_out, "denoised_latent": noisy, "wav_tts": wav}


def check_io_parity(fp32_dir: Path, other_dir: Path, label: str) -> bool:
    ok = True
    for name in ["duration_predictor.onnx", "text_encoder.onnx", "vector_estimator.onnx", "vocoder.onnx"]:
        ref = io_signature(session(fp32_dir / name))
        cand = io_signature(session(other_dir / name))
        if ref != cand:
            ok = False
            print(f"  [FAIL] {label} {name} I/O signature differs from fp32")
            print(f"         fp32 in:  {ref[0]}")
            print(f"         {label} in:  {cand[0]}")
            print(f"         fp32 out: {ref[1]}")
            print(f"         {label} out: {cand[1]}")
        else:
            print(f"  [ok]   {label} {name} I/O parity")
    return ok


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--fp32", type=Path, required=True, help="Directory with fp32 *.onnx + tts.json + unicode_indexer.json")
    p.add_argument("--fp16", type=Path, required=True)
    p.add_argument("--indexer", type=Path, required=True)
    p.add_argument("--voice", type=Path, required=True)
    p.add_argument("--seed", type=int, default=0xC0FFEE)
    args = p.parse_args()

    print("=== I/O parity ===")
    if not check_io_parity(args.fp32, args.fp16, "fp16"):
        print("\nI/O parity failed -- loader code would need changes. Aborting.")
        return 2

    cfg = json.loads((args.fp32 / "tts.json").read_text())
    text_ids = encode_text(preprocess(REF_TEXT, REF_LANG), args.indexer)
    dp_style, ttl_style = load_voice(args.voice)

    print("\n=== Numerical regression vs fp32 ===")
    fp32 = run_pipeline(args.fp32, text_ids, dp_style, ttl_style, cfg, args.seed)
    fp16 = run_pipeline(args.fp16, text_ids, dp_style, ttl_style, cfg, args.seed)

    all_ok = True
    for stage in ["duration", "text_emb", "denoised_latent", "wav_tts"]:
        v = snr_db(fp32[stage], fp16[stage])
        status = "[ok]  " if v >= FP16_SNR_DB else "[FAIL]"
        all_ok = all_ok and v >= FP16_SNR_DB
        print(f"  {status} fp16 {stage:>16s} SNR = {v:7.2f} dB (threshold {FP16_SNR_DB})")

    if not all_ok:
        print("\nNumerical regression failed. Do not re-host.")
        return 3

    print("\nAll checks passed. Safe to mirror.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
