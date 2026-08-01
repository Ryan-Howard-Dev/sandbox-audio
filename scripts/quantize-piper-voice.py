#!/usr/bin/env python3
"""Shrink the Piper voice by quantising its weights to 8 bits.

The voice is 60 MB of 32-bit floats and the largest single thing in the app. Storing those
weights as 8-bit integers divides the file by roughly four, and on an ARM CPU integer matrix
multiplication is also faster than float, so this costs nothing at runtime.

Conv is quantised; ConvTranspose is not.

Measured, rather than assumed: 95.2% of this model's weight is in Conv, 4.3% in ConvTranspose,
and MatMul is a rounding error. Quantising MatMul alone — the cautious choice — saved nothing at
all, because there is nothing there. The size of a VITS voice is its convolutions, so shrinking
it means quantising them.

ConvTranspose is left in float deliberately. Transposed convolutions are the documented source
of metallic ringing in quantised neural speech: each output sample sums over many weights, so
the errors accumulate coherently instead of cancelling. They are 2.6 MB of 60, which makes
excluding them nearly free and worth it.

This is the one change here that can be heard. The float weights are kept beside the quantised
model so the comparison is a file copy rather than a download, and reverting is one command.

Usage:  python scripts/quantize-piper-voice.py [--check]
        --check reports what would happen without writing anything.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VOICE_DIR = ROOT / "android" / "app" / "src" / "main" / "assets" / "vits-piper-en_GB-alan-medium"
MODEL = VOICE_DIR / "en_GB-alan-medium.onnx"
# Outside the assets directory on purpose. Beside the model it would be packaged into the APK as
# well, shipping both copies and undoing the saving this script exists for.
ORIGINAL = ROOT / ".sherpa-build" / "en_GB-alan-medium.onnx.fp32"

# ConvTranspose is deliberately absent. See the module docstring.
OPS_TO_QUANTIZE = ["MatMul", "Conv"]


def megabytes(path: Path) -> float:
    return path.stat().st_size / 1024 / 1024


def already_quantised(path: Path) -> bool:
    """A quantised graph carries the operators the quantiser inserts."""
    import onnx

    model = onnx.load(str(path), load_external_data=False)
    return any(
        node.op_type in {"DynamicQuantizeLinear", "MatMulInteger", "QuantizeLinear"}
        for node in model.graph.node
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="report without writing")
    args = parser.parse_args()

    if not MODEL.exists():
        print(f"[quantize] no voice at {MODEL}")
        print("[quantize] run `npm run build:piper` first")
        return 1

    before = megabytes(MODEL)
    print(f"[quantize] model is {before:.1f} MB")

    if already_quantised(MODEL):
        print("[quantize] already quantised — nothing to do")
        return 0

    if args.check:
        print(f"[quantize] would quantise {OPS_TO_QUANTIZE} and leave convolutions in float")
        return 0

    from onnxruntime.quantization import QuantType, quantize_dynamic

    # Keep the float weights: quality is a judgement made by listening, and this makes the
    # comparison a file copy rather than a 60 MB download.
    if not ORIGINAL.exists():
        ORIGINAL.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(MODEL, ORIGINAL)
        print(f"[quantize] kept the original at {ORIGINAL.name}")

    output = MODEL.with_suffix(".onnx.int8")
    quantize_dynamic(
        model_input=str(ORIGINAL),
        model_output=str(output),
        op_types_to_quantize=OPS_TO_QUANTIZE,
        weight_type=QuantType.QInt8,
        # Piper graphs carry their own initialisers; leaving this on rewrites shapes the
        # runtime then disagrees with.
        extra_options={"EnableSubgraph": False},
    )

    after = megabytes(output)
    if after >= before:
        print(f"[quantize] result was no smaller ({after:.1f} MB) — keeping the original")
        output.unlink(missing_ok=True)
        return 1

    output.replace(MODEL)
    saved = before - after
    print(f"[quantize] {before:.1f} MB -> {after:.1f} MB, saving {saved:.1f} MB")
    print("[quantize] listen before shipping: restore with the .fp32 copy if it sounds wrong")
    return 0


if __name__ == "__main__":
    sys.exit(main())
