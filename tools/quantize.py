#!/usr/bin/env python3
"""Convert Supertonic-3 fp32 ONNX weights to fp16 for smaller mobile downloads.

Reads upstream fp32 ONNX files from --src and writes --out/onnx-fp16/*.onnx.

Uses keep_io_types=True so the Swift/Kotlin loaders at
ios/Supertonic/SupertonicSession.swift and android .../SupertonicSession.kt
do not need to change tensor-construction code.

Attention sub-graphs in vector_estimator are blocked by node name —
onnxconverter_common produces a graph with inconsistent Cast nodes there,
making ORT refuse to load the model. Blocking those keeps attention layers
in fp32, costs ~10 MB on vector_estimator but the model actually loads.

Int8 was evaluated and dropped: quantize_dynamic with MatMul-only (required
to avoid ConvInteger ops the iOS CPU EP refuses) produces ~94%-of-fp32 sizes
on vector_estimator AND destroys audio quality (SNR ~-1 dB vs fp32). Not
worth maintaining a separate tier.

After running, hand the output to tools/verify-quantized.py to confirm
I/O parity and audio SNR before re-hosting on the ahk-d/supertonic-3 mirror.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import onnx
from onnx import ModelProto
from onnxconverter_common import float16

ALL_MODELS = [
    "duration_predictor.onnx",
    "text_encoder.onnx",
    "vector_estimator.onnx",
    "vocoder.onnx",
]


def io_signature(model: ModelProto) -> list[tuple[str, int, tuple]]:
    """Stable representation of a model's inputs+outputs for parity checks."""
    sig = []
    for tensor in list(model.graph.input) + list(model.graph.output):
        shape = tuple(
            d.dim_value if d.HasField("dim_value") else d.dim_param or "?"
            for d in tensor.type.tensor_type.shape.dim
        )
        sig.append((tensor.name, tensor.type.tensor_type.elem_type, shape))
    return sig


def convert_fp16(src_path: Path, dst_path: Path) -> None:
    print(f"  fp16: {src_path.name}")
    model = onnx.load(str(src_path))
    pre_sig = io_signature(model)

    attn_nodes = [
        n.name for n in model.graph.node
        if "/attn/" in n.name or "/attention/" in n.name
    ]
    fp16_model = float16.convert_float_to_float16(
        model,
        keep_io_types=True,
        node_block_list=attn_nodes,
    )
    post_sig = io_signature(fp16_model)
    if pre_sig != post_sig:
        raise SystemExit(
            f"fp16 conversion changed I/O signature for {src_path.name}:\n"
            f"  before: {pre_sig}\n  after:  {post_sig}"
        )

    onnx.save(fp16_model, str(dst_path))
    onnx.checker.check_model(str(dst_path))
    pct = 100.0 * dst_path.stat().st_size / src_path.stat().st_size
    print(f"    -> {dst_path.stat().st_size / 1e6:6.1f} MB ({pct:.1f}% of fp32)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--src",
        type=Path,
        required=True,
        help="Directory containing fp32 *.onnx files (upstream Supertonic-3 onnx/).",
    )
    parser.add_argument(
        "--out",
        type=Path,
        required=True,
        help="Destination directory. Will create onnx-fp16/ inside.",
    )
    args = parser.parse_args()

    for name in ALL_MODELS:
        if not (args.src / name).exists():
            print(f"missing fp32 model: {args.src / name}", file=sys.stderr)
            return 1

    fp16_dir = args.out / "onnx-fp16"
    fp16_dir.mkdir(parents=True, exist_ok=True)

    print(f"fp16 conversion ({args.src} -> {fp16_dir})")
    for name in ALL_MODELS:
        convert_fp16(args.src / name, fp16_dir / name)

    print("\nDone. Next: run tools/verify-quantized.py to gate before re-hosting.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
