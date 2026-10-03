# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = [
#   "numpy>=2.2,<2.6",
#   "soxr>=1.0,<1.2",
#   "soundfile>=0.13,<0.15",
#   # PyTorch ships no wheels for Intel Macs any more: there the torch stack is left out, and beats.py /
#   # align.py say what to do instead (the overrides below keep `uv lock --script` resolvable: demucs
#   # pins an old torch and numpy for that platform alone, which would otherwise fail every lock)
#   "torch>=2.11,<2.15; sys_platform != 'darwin' or platform_machine == 'arm64'",
#   "torchaudio>=2.11,<2.12; sys_platform != 'darwin' or platform_machine == 'arm64'",
#   "beat-this>=1.1,<1.2; sys_platform != 'darwin' or platform_machine == 'arm64'",
#   "demucs>=4.1,<4.2; sys_platform != 'darwin' or platform_machine == 'arm64'",
# ]
# [tool.uv]
# override-dependencies = ["numpy>=2.2,<2.6", "torch>=2.11,<2.15", "torchaudio>=2.11,<2.12"]  # the same ranges as above
# [tool.uv.sources]
# torch = { index = "pytorch-cpu" }
# torchaudio = { index = "pytorch-cpu" }
#
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
# ///
"""Model stages for beats.py: Beat This! frame logits and Demucs htdemucs stems, on CPU.

beats.py runs this script with `uv run --script`; there is no need to run it by hand. It keeps
torch out of beats.py's own environment, so `beats.py grid`, `beats.py check` and
`--tracker librosa` never install it.

  beats_models.py --work DIR [--beats CHECKPOINT] [--stems]

Input: PCM that beats.py decoded (ffmpeg's gapless decode, so every stage shares one timeline):
  DIR/pcm-mono22.f32     22.05 kHz mono float32 (Beat This! reads 22.05 kHz)
  DIR/pcm-stereo44.f32   44.1 kHz float32, channels interleaved (Demucs htdemucs works at 44.1 kHz)
Output:
  DIR/beat_this-<CHECKPOINT>.npz   frame logits at 50 fps (frame i centred at i/50 s): beat, downbeat
  DIR/htdemucs/<stem>.flac         drums, bass, other, vocals: 44.1 kHz mono, 24-bit, with scale.json
  one JSON line on stdout describing what ran, what was downloaded and where it lives.
Model weights go where TORCH_HOME and HF_HOME point (beats.py points both into the audara cache).

Licenses: Beat This! code and published weights are MIT ("The code and the published model
weights are released under the MIT license", github.com/CPJKU/beat_this). Demucs code is MIT;
the htdemucs weights carry no separate license statement (the Hugging Face card has no tag).

Exit codes: 0 ok, 1 error, 2 bad usage.
"""
from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

# Windows' 260 characters. long_paths_on, verbatim and long_path_imports are the same code in beats.py and
# beats_models.py: change both together.
DEEPEST = 100  # characters a package's own files reach below site-packages (scikit-learn's deepest module: 93,
#                torch's: 91)


def long_paths_on() -> bool:
    """Windows reads paths over 260 characters only when long paths are enabled (an admin setting)."""
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\FileSystem") as k:
            return winreg.QueryValueEx(k, "LongPathsEnabled")[0] == 1
    except (ImportError, OSError):
        return False


def verbatim(p: str) -> str:
    """`p` written the long way (\\\\?\\C:\\... or \\\\?\\UNC\\server\\...), which Windows reads past 260 characters."""
    p = os.path.abspath(p)
    if p.startswith("\\\\?\\"):
        return p
    return "\\\\?\\UNC\\" + p[2:] if p.startswith("\\\\") else "\\\\?\\" + p


def long_path_imports() -> None:
    """uv's environment for a script can lie deep in a project (UV_CACHE_DIR=<project>/.audara-cache/uv, for a
    sandbox): its module files then pass 260 characters, and Python cannot import them (an eval run: torch.fx's
    dispatcher at 261). Import from the same folders written the long way."""
    if sys.platform != "win32" or long_paths_on():
        return
    for i, p in enumerate(sys.path):
        if p and len(os.path.abspath(p)) + DEEPEST > 259 and os.path.isdir(verbatim(p)):
            sys.path[i] = verbatim(p)


long_path_imports()

import numpy as np  # noqa: E402 (after the import paths are set)

# one line of progress per stage instead of library progress bars and Hugging Face warnings (symlinks
# unsupported on Windows without developer mode, unauthenticated downloads): set before any import
for _k, _v in (("TQDM_DISABLE", "1"), ("HF_HUB_DISABLE_PROGRESS_BARS", "1"), ("HF_HUB_DISABLE_SYMLINKS_WARNING", "1"),
               ("HF_HUB_VERBOSITY", "error")):
    os.environ.setdefault(_k, _v)

BT_URL = "https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp"  # beat_this.inference.CHECKPOINT_URL
STEMS = ("drums", "bass", "other", "vocals")


def note(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def size_of(p: Path) -> int:
    if p.is_file():
        return p.stat().st_size
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) if p.exists() else 0


def download(url: str, dest: Path) -> None:
    """Stream `url` to `dest` (atomic rename), one progress line every 10%."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(url, timeout=60) as r, part.open("wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        got, shown = 0, -10
        while chunk := r.read(1 << 20):
            f.write(chunk)
            got += len(chunk)
            pct = int(100 * got / total) if total else 0
            if total and pct >= shown + 10:
                shown = pct - pct % 10
                note(f"  downloading {dest.name}: {got / 1e6:.0f} of {total / 1e6:.0f} MB")
    part.replace(dest)


def beat_logits(work: Path, checkpoint: str) -> dict:
    import torch
    import beat_this
    from beat_this.inference import Audio2Frames

    if checkpoint.endswith(".ckpt") or Path(checkpoint).is_file():
        ckpt, downloaded = Path(checkpoint).resolve(), False
        name = ckpt.stem
    else:
        name = checkpoint
        ckpt = Path(torch.hub.get_dir()) / "checkpoints" / f"beat_this-{name}.ckpt"  # torch.hub's own file name
        downloaded = not ckpt.is_file()
        if downloaded:
            note(f"beats_models: downloading the Beat This! checkpoint {name} (MIT) into {ckpt.parent}")
            download(f"{BT_URL}/{name}.ckpt", ckpt)
    t0 = time.time()
    a2f = Audio2Frames(checkpoint_path=str(ckpt), device="cpu")
    y = np.fromfile(work / "pcm-mono22.f32", np.float32)
    beat, down = a2f(y, 22050)
    out = work / f"beat_this-{name}.npz"
    np.savez(out, beat=beat.numpy().astype(np.float32), down=down.numpy().astype(np.float32),
             fps=np.float32(50.0), samples=np.int64(len(y)))
    return {"checkpoint": name, "file": str(ckpt), "bytes": size_of(ckpt), "downloaded": downloaded,
            "seconds": round(time.time() - t0, 2), "output": str(out), "frames": int(len(beat)),
            "beat_this": getattr(beat_this, "__version__", None) or _version("beat-this"),
            "torch": torch.__version__, "python": sys.version.split()[0]}


def _version(dist: str) -> str | None:
    try:
        from importlib.metadata import version
        return version(dist)
    except Exception:
        return None


def stems(work: Path) -> dict:
    import soundfile as sf
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    # demucs 4.1 fetches htdemucs from the Hugging Face hub, else from its old AWS copy via torch.hub
    # (it falls back silently, e.g. when a Windows path would pass 260 characters): measure both
    hf = Path(os.environ.get("HF_HOME", "")) / "hub" / "models--adefossez--HTDemucs"
    th = Path(torch.hub.get_dir()) / "checkpoints"

    def sizes() -> tuple[int, int]:
        return size_of(hf), sum(size_of(p) for p in th.glob("955717e8*"))

    hf0, aws0 = sizes()
    meta = json.loads((work / "pcm-stereo44.json").read_text(encoding="utf-8"))
    ch = int(meta["channels"])
    y = np.fromfile(work / "pcm-stereo44.f32", np.float32).reshape(-1, ch)
    if ch == 1:
        y = np.repeat(y, 2, axis=1)  # htdemucs takes stereo
    elif ch > 2:
        y = y[:, :2]
    t0 = time.time()
    if max(hf0, aws0) < 1e6:
        note(f"beats_models: downloading the Demucs htdemucs weights (84 MB, measured) into {hf.parents[1]}")
    note("beats_models: separating stems with Demucs htdemucs on CPU")
    chatter = io.StringIO()  # torch.hub forces a progress bar on its fallback download: shown only on failure
    try:
        with contextlib.redirect_stderr(chatter):
            model = get_model("htdemucs")
    except Exception:
        sys.stderr.write(chatter.getvalue()[-3000:])
        raise
    model.eval()
    wav = torch.from_numpy(np.ascontiguousarray(y.T))
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    with torch.inference_mode():  # demucs' own recipe: normalize, split into overlapping chunks
        sep = apply_model(model, ((wav - mean) / std)[None], device="cpu", shifts=0, split=True,
                          overlap=0.25, progress=False)[0]
    sep = (sep * std + mean).numpy()
    outdir = work / "htdemucs"
    outdir.mkdir(exist_ok=True)
    scales = {}
    for name, stem in zip(model.sources, sep):
        mono = stem.mean(axis=0).astype(np.float32)
        # 24-bit FLAC clips at full scale: store x/scale, beats.py multiplies back
        scale = float(max(1.0, np.abs(mono).max() / 0.999))
        sf.write(outdir / f"{name}.flac", mono / scale, 44100, subtype="PCM_24")
        scales[name] = scale
    (outdir / "scale.json").write_text(json.dumps({"scale": scales, "samples": int(y.shape[0]), "sr": 44100,
                                                   "model": "htdemucs"}), encoding="utf-8")
    hf1, aws1 = sizes()  # report the copy that grew (a download), else the one already there
    grew_hf, grew_aws = hf1 - hf0 > 1e6, aws1 - aws0 > 1e6
    where, size = (hf, hf1) if grew_hf or (not grew_aws and hf1 >= 1e6) else (th, aws1)
    return {"model": "htdemucs", "weights": str(where), "bytes": size, "downloaded": grew_hf or grew_aws,
            "seconds": round(time.time() - t0, 2), "output": str(outdir), "sources": list(model.sources)}


def main() -> int:
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    p = argparse.ArgumentParser(prog="beats_models.py", description=__doc__.split("\n\n")[0],
                                epilog="beats.py runs this; exit codes: 0 ok, 1 error, 2 bad usage")
    p.add_argument("--work", required=True, help="folder with the PCM beats.py decoded")
    p.add_argument("--beats", help="Beat This! checkpoint name (final0, small0 ...) or a .ckpt file")
    p.add_argument("--stems", action="store_true", help="separate drums/bass/other/vocals with Demucs htdemucs")
    try:
        a = p.parse_args()
    except SystemExit as e:
        return int(e.code or 0)
    work = Path(a.work)
    if not work.is_dir():
        note(f"beats_models: --work {work} is not a folder")
        return 2
    try:
        result = {}
        if a.beats:
            result["beats"] = beat_logits(work, a.beats)
        if a.stems:
            result["stems"] = stems(work)
    except Exception as e:  # report and exit 1: beats.py prints the advice
        note(f"beats_models: {type(e).__name__}: {e}")
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
