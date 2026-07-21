"""Minimal Demucs HTTP service for tier34 stem separation (docker compose --profile stems)."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Sandbox Demucs Service", version="1.0.0")
STORAGE_ROOT = Path(os.environ.get("TIER34_STORAGE_PATH", "/data/storage"))


class SeparateRequest(BaseModel):
    inputPath: str
    outputDir: str


def find_stems(output_dir: Path) -> dict[str, str]:
    for model_dir in output_dir.iterdir():
        if not model_dir.is_dir():
            continue
        for track_dir in model_dir.iterdir():
            if not track_dir.is_dir():
                continue
            out: dict[str, str] = {}
            for kind in ("vocals", "drums", "bass", "other"):
                wav = track_dir / f"{kind}.wav"
                mp3 = track_dir / f"{kind}.mp3"
                if wav.exists():
                    out[kind] = str(wav)
                elif mp3.exists():
                    out[kind] = str(mp3)
            if len(out) == 4:
                return out
    raise HTTPException(status_code=500, detail="Demucs produced no complete stem set")


@app.get("/health")
def health():
    return {"ok": True, "service": "demucs"}


@app.post("/separate")
def separate(req: SeparateRequest):
    input_path = Path(req.inputPath)
    output_dir = Path(req.outputDir)
    if not input_path.is_file():
        raise HTTPException(status_code=400, detail=f"input not found: {input_path}")
    output_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable,
        "-m",
        "demucs",
        "-n",
        "htdemucs",
        "--out",
        str(output_dir),
        str(input_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "demucs failed").strip()
        raise HTTPException(status_code=500, detail=detail[:2000])
    return find_stems(output_dir)
