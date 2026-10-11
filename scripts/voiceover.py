"""Voiceover for the video brief, spoken by Kokoro (an open-source text-to-speech model, Apache-2.0).

    pip install -r requirements-video.txt
    python3 scripts/voiceover.py --in narration.json --out voice/ [--voice af_heart] [--speed 1.0]

narration.json is a list of {"id": ..., "say": ...}. Writes one WAV per line plus durations.json
({"lines": [{"id", "file", "seconds"}], ...}). The model files (~350 MB) download once into
~/.cache/world-pulse/kokoro and are verified by SHA-256. Runs on CPU at roughly twice real time.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path

RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
MODELS = {
    "kokoro-v1.0.onnx": "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5",
    "voices-v1.0.bin": "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
}
DEFAULT_CACHE = Path(os.environ.get("WORLDPULSE_MODEL_CACHE", Path.home() / ".cache" / "world-pulse" / "kokoro"))


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def ensure_models(cache: Path) -> dict[str, Path]:
    cache.mkdir(parents=True, exist_ok=True)
    paths = {}
    for name, digest in MODELS.items():
        path = cache / name
        if not path.exists() or sha256(path) != digest:
            print(f"  downloading {name}…", file=sys.stderr)
            part = path.with_suffix(path.suffix + ".part")
            req = urllib.request.Request(f"{RELEASE}/{name}", headers={"User-Agent": "WorldPulse/1.0"})
            with urllib.request.urlopen(req, timeout=120) as resp, open(part, "wb") as out:
                while chunk := resp.read(1 << 20):
                    out.write(chunk)
            if sha256(part) != digest:
                part.unlink()
                raise SystemExit(f"{name}: checksum mismatch, refusing to use it")
            part.replace(path)
        paths[name] = path
    return paths


def trim(samples, sample_rate: int, threshold: float = 0.004, pad: float = 0.06):
    """Cut leading and trailing silence, keeping a short natural pad."""
    import numpy as np

    loud = np.flatnonzero(np.abs(samples) > threshold)
    if loud.size == 0:
        return samples
    keep = int(pad * sample_rate)
    return samples[max(0, loud[0] - keep): min(len(samples), loud[-1] + keep)]


def main(argv=None) -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--in", dest="src", required=True, type=Path, help="narration JSON: [{id, say}]")
    p.add_argument("--out", required=True, type=Path, help="directory for the WAV files and durations.json")
    p.add_argument("--voice", default="af_heart", help="Kokoro voice, e.g. af_heart, am_michael, bf_emma, bm_george")
    p.add_argument("--speed", type=float, default=1.15)
    p.add_argument("--models", type=Path, default=DEFAULT_CACHE, help="model cache directory")
    args = p.parse_args(argv)

    import soundfile as sf
    from kokoro_onnx import Kokoro

    lines = json.loads(args.src.read_text(encoding="utf-8"))
    models = ensure_models(args.models)
    tts = Kokoro(str(models["kokoro-v1.0.onnx"]), str(models["voices-v1.0.bin"]))
    if args.voice not in tts.get_voices():
        raise SystemExit(f"unknown voice {args.voice!r}; choose from: {', '.join(sorted(tts.get_voices()))}")
    lang = "en-gb" if args.voice.startswith("b") else "en-us"

    args.out.mkdir(parents=True, exist_ok=True)
    result, sample_rate = [], 24000
    for line in lines:
        text = (line.get("say") or "").strip()
        if not text:
            continue
        samples, sample_rate = tts.create(text, voice=args.voice, speed=args.speed, lang=lang)
        samples = trim(samples, sample_rate)
        file = args.out / f"{line['id']}.wav"
        sf.write(file, samples, sample_rate)
        result.append({"id": line["id"], "file": str(file), "seconds": round(len(samples) / sample_rate, 3)})
        print(f"  {line['id']:<10} {result[-1]['seconds']:5.2f}s  {text[:70]}", file=sys.stderr)
    (args.out / "durations.json").write_text(json.dumps({"voice": args.voice, "sample_rate": sample_rate, "lines": result}, indent=1))


if __name__ == "__main__":
    main()
