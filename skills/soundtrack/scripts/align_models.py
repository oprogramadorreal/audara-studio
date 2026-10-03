# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = [
#   "numpy>=1.26,<3",
#   "soxr>=0.5,<2",
#   # PyTorch ships no wheels for Intel Macs any more: there the torch stack is left out, and beats.py /
#   # align.py say what to do instead (the overrides below keep `uv lock --script` resolvable: demucs
#   # pins an old torch and numpy for that platform alone, which would otherwise fail every lock)
#   "torch>=2.11,<3; sys_platform != 'darwin' or platform_machine == 'arm64'",
#   "torchaudio>=2.10,<3; sys_platform != 'darwin' or platform_machine == 'arm64'",
#   "demucs>=4.1,<5; sys_platform != 'darwin' or platform_machine == 'arm64'",
#   "faster-whisper>=1.2,<2",
#   "transformers>=4.50,<6",
# ]
# [tool.uv]
# override-dependencies = ["torch>=2.11,<3", "torchaudio>=2.10,<3"]  # the same ranges as above
# [tool.uv.sources]
# torch = { index = "pytorch-cpu" }
# torchaudio = { index = "pytorch-cpu" }
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
# ///
"""Model stages of `align.py song`, in their own environment so `align.py check` never installs
torch. align.py runs this; run it yourself only to debug a stage.

Stages, each skipped when its result is already in --work (keyed by the audio's SHA-256):
  1. vocals: ffmpeg's gapless decode -> Demucs htdemucs on CPU -> vocal stem, mono 16 kHz
     (--no-separate: the decode itself, mono 16 kHz)
  2. emissions: CTC log-probabilities (20 ms frames) from --acoustic, mapped onto the shared
     alphabet "-abcdefghijklmnopqrstuvwxyz'" (0 = blank)
  3. whisper: faster-whisper words with times on the same audio (the cross-check)
Models download once into --cache (torch/, hf/, whisper/). Progress goes to stderr; the last
line on stdout is a JSON result for align.py.

  uv run align_models.py --audio song.mp3 --work <cache>/work/<sha12> --cache <cache> --acoustic lv60k

Exit codes: 0 ok, 1 error, 2 bad usage.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import unicodedata
from pathlib import Path

ALPHA = "-abcdefghijklmnopqrstuvwxyz'"  # must match align.py
SR = 16000  # every CTC model here and Whisper take 16 kHz mono
HOP = 320  # 20 ms CTC frames at 16 kHz
CHUNK_S, CONTEXT_S = 20.0, 3.0  # emissions in 20 s chunks with 3 s of context each side: bounded
#                                 memory, and no frame is computed without context (pdoom-video)
WHISPER_SIZES = {"tiny": "78 MB", "base": "145 MB", "small": "484 MB", "medium": "1.5 GB", "large-v3": "3.1 GB",
                 "large-v3-turbo": "1.6 GB", "turbo": "1.6 GB"}  # CTranslate2 int8-ready downloads
LICENSES = {  # what each model's weights are published under (model cards / torchaudio docs)
    "htdemucs": "MIT (Demucs)",
    "lv60k": "MIT",
    "mms": "CC-BY-NC-4.0 (non-commercial)",
    "whisper": "MIT",
}


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def snapshot(cache: Path) -> dict[str, int]:
    out = {}
    for sub in ("torch", "hf", "whisper"):
        d = cache / sub
        if d.exists():
            for p in d.rglob("*"):
                if p.is_file() and ".locks" not in p.parts and "logs" not in p.parts and not p.name.endswith(
                        (".lock", ".incomplete", ".log")):
                    out[str(p)] = p.stat().st_size
    return out


def describe(path: str) -> tuple[str, str | None]:
    """Which model a downloaded file belongs to, and its license."""
    p = path.replace("\\", "/")
    m = re.search(r"models--([^/]+)--([^/]+)", p)
    if m:
        repo = f"{m.group(1)}/{m.group(2)}"
        if "HTDemucs" in repo or "demucs" in repo.lower():
            return "Demucs htdemucs (vocals)", LICENSES["htdemucs"]
        if "whisper" in repo.lower():
            return f"faster-whisper ({repo})", LICENSES["whisper"]
        return repo, None
    if "lv60k" in p:
        return "wav2vec2 LV60K 960h (torchaudio)", LICENSES["lv60k"]
    # torch.hub keeps only the URL's file name: MMS_FA's .../ctc_alignment_mling_uroman/model.pt
    if "mling_uroman" in p or "mms" in p.lower() or p.endswith("/hub/checkpoints/model.pt"):
        return "MMS_FA (torchaudio)", LICENSES["mms"]
    if "demucs" in p.lower() or re.search(r"/[0-9a-f]{8}-[0-9a-f]{8}\.th$", p):
        return "Demucs htdemucs (vocals)", LICENSES["htdemucs"]
    return Path(p).name, None


def ffmpeg_decode(path: Path, sr: int, channels: int):
    import numpy as np
    exe = shutil.which("ffmpeg")
    if not exe:
        raise SystemExit("ffmpeg not found: install it (winget install Gyan.FFmpeg), then reopen the terminal")
    r = subprocess.run([exe, "-v", "error", "-nostdin", "-i", str(path), "-map", "0:a:0", "-vn", "-ac", str(channels),
                        "-ar", str(sr), "-f", "f32le", "-c:a", "pcm_f32le", "-"], capture_output=True)
    if r.returncode != 0:
        raise SystemExit(f"ffmpeg could not decode {path.name}: {r.stderr.decode(errors='replace')[:300]}")
    y = np.frombuffer(r.stdout, np.float32)
    return y.reshape(-1, channels).T.copy() if channels > 1 else y.copy()


def stage_audio(args, work: Path, times: dict) -> tuple[Path, str]:
    import numpy as np
    if args.separate:
        out = work / "vocals-htdemucs-16k.f32"
        if out.is_file():
            return out, "vocals"
        import soxr
        import torch
        from demucs.apply import apply_model
        from demucs.pretrained import get_model
        log("vocals: Demucs htdemucs on CPU (first use downloads 84 MB) ...")
        t0 = time.time()
        model = get_model("htdemucs").eval()
        x = torch.from_numpy(ffmpeg_decode(Path(args.audio), model.samplerate, 2))
        ref = x.mean(0)
        mean, std = ref.mean(), ref.std().clamp_min(1e-8)
        with torch.inference_mode():
            sep = apply_model(model, ((x - mean) / std)[None], device="cpu", shifts=0, split=True, overlap=0.25,
                              progress=False)[0]
        vocals = (sep[model.sources.index("vocals")] * std + mean).mean(0).numpy()
        y = soxr.resample(vocals, model.samplerate, SR).astype(np.float32)
        y.tofile(out)
        times["vocals"] = round(time.time() - t0, 1)
        return out, "vocals"
    out = work / "mix-16k.f32"
    if not out.is_file():
        ffmpeg_decode(Path(args.audio), SR, 1).astype(np.float32).tofile(out)
    return out, "mix"


def fold(label: str) -> str:
    return unicodedata.normalize("NFKD", label.casefold()).encode("ascii", "ignore").decode()


def project(logp, labels: list[str], blank_ids: list[int]):
    """Map a model's label set onto ALPHA: blank (+ word separator) -> 0, letters folded to a-z
    (accented letters merge into their base letter), everything else dropped; renormalized."""
    import numpy as np
    T = logp.shape[0]
    out = np.full((T, len(ALPHA)), -1e4, np.float64)
    out[:, 0] = np.logaddexp.reduce(logp[:, blank_ids], axis=1)
    groups: dict[int, list[int]] = {}
    for i, lab in enumerate(labels):
        if i in blank_ids or lab.startswith("<"):
            continue
        c = fold(lab)
        if len(c) == 1 and c in ALPHA[1:]:
            groups.setdefault(ALPHA.index(c), []).append(i)
    for j, ids in groups.items():
        out[:, j] = np.logaddexp.reduce(logp[:, ids], axis=1)
    missing = [ALPHA[j] for j in range(1, len(ALPHA)) if j not in groups]
    out -= np.logaddexp.reduce(out, axis=1, keepdims=True)
    return out.astype(np.float32), missing


def load_acoustic(acoustic: str, cache: Path):
    """Returns (forward(np 16 kHz chunk) -> log-probs [T, V], labels, blank ids, license)."""
    import numpy as np
    import torch
    if acoustic in ("lv60k", "mms"):
        import torchaudio
        quiet = {"progress": False}  # a tqdm bar would flood the agent's output; sizes are reported after
        if acoustic == "lv60k":
            bundle = torchaudio.pipelines.WAV2VEC2_ASR_LARGE_LV60K_960H
            model, labels = bundle.get_model(dl_kwargs=quiet), list(bundle.get_labels())
            blank_ids = [labels.index("-"), labels.index("|")]
        else:
            bundle = torchaudio.pipelines.MMS_FA
            model, labels = bundle.get_model(with_star=False, dl_kwargs=quiet), list(bundle.get_labels(star=None))
            blank_ids = [labels.index("-")]
        model.eval()

        def fwd(x):
            with torch.inference_mode():
                em, _ = model(torch.from_numpy(x)[None])
                return torch.log_softmax(em, dim=-1)[0].float().numpy()
        return fwd, labels, blank_ids, LICENSES[acoustic]
    repo = acoustic[3:]
    from huggingface_hub import HfApi, snapshot_download
    lic = None
    try:
        if os.environ.get("HF_HUB_OFFLINE") == "1":
            raise OSError("HF_HUB_OFFLINE=1")
        info = HfApi().model_info(repo)
        card = getattr(info, "card_data", None) or getattr(info, "cardData", None) or {}
        lic = card.get("license") if isinstance(card, dict) else getattr(card, "license", None)
        files = [s.rfilename for s in (info.siblings or [])]
        weights = "model.safetensors" if "model.safetensors" in files else "pytorch_model.bin"
        local = Path(snapshot_download(repo, allow_patterns=["config.json", "preprocessor_config.json", "vocab.json",
                                                              weights]))
    except Exception as e:  # offline: use what the cache has
        log(f"Hugging Face hub not reachable ({type(e).__name__}); trying the cached copy of {repo}")
        local = Path(snapshot_download(repo, local_files_only=True))
        lic = lic or "unknown (offline: check the model card)"
    from transformers import Wav2Vec2ForCTC
    model = Wav2Vec2ForCTC.from_pretrained(str(local)).eval()
    vocab = json.loads((local / "vocab.json").read_text(encoding="utf-8"))
    cfg = json.loads((local / "config.json").read_text(encoding="utf-8"))
    pre = json.loads((local / "preprocessor_config.json").read_text(encoding="utf-8"))
    labels = [""] * (max(vocab.values()) + 1)
    for lab, i in vocab.items():
        labels[i] = lab
    blank_ids = sorted({int(cfg.get("pad_token_id", vocab.get("<pad>", 0)))} | ({vocab["|"]} if "|" in vocab else set()))
    norm = bool(pre.get("do_normalize", True))

    def fwd(x):
        if norm:  # what Wav2Vec2FeatureExtractor does: zero mean, unit variance per input
            x = (x - x.mean()) / np.sqrt(x.var() + 1e-7)
        with torch.inference_mode():
            logits = model(torch.from_numpy(x.astype(np.float32))[None]).logits
            return torch.log_softmax(logits, dim=-1)[0].float().numpy()
    return fwd, labels, blank_ids, str(lic) if lic else "unknown (no license on the model card)"


def stage_emissions(args, y, work: Path, source: str, times: dict, cache: Path) -> tuple[Path, str | None]:
    import numpy as np
    slug = re.sub(r"[^A-Za-z0-9.-]+", "-", args.acoustic)
    out = work / f"ctc-{slug}-{source}.npy"
    meta = out.with_suffix(".json")
    if out.is_file() and meta.is_file():
        return out, json.loads(meta.read_text(encoding="utf-8")).get("license")
    import torch
    torch.set_num_threads(args.threads)
    log(f"emissions: {args.acoustic} on the {source} (first use downloads about 1.3 GB) ...")
    t0 = time.time()
    fwd, labels, blank_ids, lic = load_acoustic(args.acoustic, cache)
    x = (y / (np.abs(y).max() + 1e-9)).astype(np.float32)  # peak-normalized, as pdoom-video did
    n = len(x) // HOP
    chunk, ctx = int(CHUNK_S * SR), int(CONTEXT_S * SR)
    E = None
    for s in range(0, len(x), chunk):
        a, b = max(0, s - ctx), min(len(x), s + chunk + ctx)
        lp = fwd(x[a:b])
        if E is None:
            E = np.full((n, lp.shape[1]), np.nan, np.float32)
        lo, hi = s // HOP, min(n, (s + chunk) // HOP)
        part = lp[lo - a // HOP: hi - a // HOP]
        E[lo: lo + len(part)] = part
    last = int(np.flatnonzero(~np.isnan(E[:, 0])).max())
    E[last + 1:] = E[last]
    P, missing = project(E.astype(np.float64), labels, blank_ids)
    if missing:
        log(f"note: {args.acoustic} has no label for {' '.join(missing)}; those letters align on their neighbours")
    np.save(out, P)
    meta.write_text(json.dumps({"acoustic": args.acoustic, "license": lic, "frames": int(P.shape[0]),
                                "missing_letters": missing}), encoding="utf-8")
    times["emissions"] = round(time.time() - t0, 1)
    return out, lic


def stage_whisper(args, y, work: Path, source: str, times: dict, cache: Path) -> Path | None:
    if args.whisper == "none":
        return None
    tag = hashlib.sha256(args.prompt.encode("utf-8")).hexdigest()[:8]
    out = work / f"whisper-{args.whisper}-{source}-{args.lang}-{tag}.json"
    if out.is_file():
        return out
    from faster_whisper import WhisperModel
    size = WHISPER_SIZES.get(args.whisper, "its model")
    log(f"cross-check: faster-whisper {args.whisper} on the {source} (first use downloads {size}) ...")
    t0 = time.time()
    kw = dict(device="cpu", compute_type="int8", cpu_threads=args.threads, download_root=str(cache / "whisper"))
    try:  # cached: no network round trip (and works offline)
        model = WhisperModel(args.whisper, local_files_only=True, **kw)
    except Exception:
        model = WhisperModel(args.whisper, **kw)
    # a numpy array, not a path: PyAV 19 broke faster-whisper's own file decoding
    segs, info = model.transcribe(y, language=args.lang or None, beam_size=5, word_timestamps=True,
                                  vad_filter=False, condition_on_previous_text=False,
                                  initial_prompt=args.prompt or None)
    words = [{"w": w.word.strip(), "start": round(float(w.start), 3), "end": round(float(w.end), 3),
              "p": round(float(w.probability), 3)} for s in segs for w in (s.words or [])]
    out.write_text(json.dumps({"model": args.whisper, "language": info.language, "prompt": args.prompt,
                               "words": words}, ensure_ascii=False), encoding="utf-8")
    times["whisper"] = round(time.time() - t0, 1)
    return out


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--audio", required=True)
    p.add_argument("--work", required=True, help="per-audio work folder in the cache")
    p.add_argument("--cache", required=True, help="cache root (models go to torch/, hf/, whisper/)")
    p.add_argument("--acoustic", default="lv60k", help="lv60k | mms | hf:<repo>")
    p.add_argument("--separate", dest="separate", action="store_true", default=True)
    p.add_argument("--no-separate", dest="separate", action="store_false")
    p.add_argument("--whisper", default="large-v3-turbo", help="faster-whisper model, or none")
    p.add_argument("--lang", default="en")
    p.add_argument("--prompt", default="", help="Whisper initial prompt (rare words of the lyrics)")
    p.add_argument("--threads", type=int, default=os.cpu_count() or 4)
    try:
        args = p.parse_args()
    except SystemExit as e:
        return int(e.code or 0)
    cache, work = Path(args.cache), Path(args.work)
    work.mkdir(parents=True, exist_ok=True)
    # every download lands in the user cache, never in the project or the default home caches
    os.environ["TORCH_HOME"] = str(cache / "torch")
    os.environ["HF_HOME"] = str(cache / "hf")
    os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"  # Windows without symlinks: works, just copies
    os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"  # progress bars would flood the agent's output
    os.environ.setdefault("HF_HUB_VERBOSITY", "error")  # no "unauthenticated requests" nag: public models
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    before = snapshot(cache)
    times: dict = {}
    try:
        import numpy as np
        audio16k, source = stage_audio(args, work, times)
        y = np.fromfile(audio16k, np.float32)
        emissions, lic = stage_emissions(args, y, work, source, times, cache)
        whisper = stage_whisper(args, y, work, source, times, cache)
    except SystemExit as e:
        log(str(e))
        return 1
    except Exception as e:  # report the failing stage plainly
        log(f"model stage failed: {type(e).__name__}: {e}")
        return 1
    after = snapshot(cache)
    grown: dict[str, list] = {}
    for f, size in after.items():
        if size > before.get(f, 0):
            what, flic = describe(f)
            g = grown.setdefault(what, [0, flic])
            g[0] += size - before.get(f, 0)
    hf_repo = args.acoustic[3:] if args.acoustic.startswith("hf:") else None
    downloads = [{"what": k, "bytes": v[0], "license": v[1] or (lic if k == hf_repo else None)}
                 for k, v in grown.items() if v[0] > 0]
    print(json.dumps({"source": source, "audio16k": str(audio16k), "duration": round(len(y) / SR, 4),
                      "emissions": str(emissions), "frame_s": HOP / SR, "acoustic_license": lic,
                      "whisper": str(whisper) if whisper else None, "downloads": downloads, "times": times}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
