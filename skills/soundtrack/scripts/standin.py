# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = [
#   "numpy>=2.0,<3",
#   # PyTorch ships no wheels for Intel Macs any more: there the voice is left out, and standin.py says what to do
#   # instead (kokoro 0.9 itself runs on Python 3.10 to 3.12)
#   "kokoro>=0.9.4,<0.10; sys_platform != 'darwin' or platform_machine == 'arm64'",
#   "misaki[en]>=0.9.4,<0.10; sys_platform != 'darwin' or platform_machine == 'arm64'",
#   # without this floor uv can settle on transformers 4.12, whose tokenizers builds only with a Rust compiler
#   "transformers>=4.45,<6; sys_platform != 'darwin' or platform_machine == 'arm64'",
#   "torch>=2.11,<3; sys_platform != 'darwin' or platform_machine == 'arm64'",
#   # misaki reads English with spaCy's small model, and would run pip (absent from uv's environments) to fetch it
#   "en-core-web-sm @ https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl ; sys_platform != 'darwin' or platform_machine == 'arm64'",
# ]
# [tool.uv]
# # num2words (misaki's numbers) lists docopt for its command line alone: docopt ships no wheel, and building it fails
# # past Windows' 260-character paths (an eval run, with UV_CACHE_DIR inside the project)
# exclude-dependencies = ["docopt"]
# [tool.uv.sources]
# torch = { index = "pytorch-cpu" }
#
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
# ///
"""A stand-in narration from a local open voice, Kokoro-82M (Apache-2.0: commercial use allowed), for a video with
no ElevenLabs key yet or nothing to spend: the same blocks, gaps, lead and tail as `eleven.py tts`, assembled and
levelled the same way into audio/narration.wav, and data/words.json with every phrase edge measured against the
waveform and moved onto the sound (the same method and code as eleven.py and align.py check --fix). Scenes find
words by their text, so they keep their sync when `eleven.py tts ... --yes` replaces it.

  uv run standin.py script.txt --video intro                   (af_heart, American English)
  uv run standin.py roteiro.md --video intro --voice pf_dora   (Brazilian Portuguese)

The script is the shown text, one paragraph per block (blank lines between them); in a .md script a # heading
starts a chapter and is not spoken; --say respells shown words for the voice, read as eleven.py reads it. Each
block is made once, on the CPU: audio/standin/NN-<slug>.wav with its .request.json (standin: true; the model and
its pinned revision, the voice, the license, the settings) and its .alignment.json (the word times Kokoro's
predicted phoneme durations give). A block is made again only when its request changes, so a run with nothing
changed writes nothing and never loads the model. The voice, language, speed, seed, say map, gap, lead, tail, snap
and loudness are kept in audio/standin/standin.json.

Languages: Kokoro's own codes, a voice's first letter (--lang also takes en, en-gb, es, fr, hi, it, pt, ja, zh).
a American English (default voice af_heart), b British English, e Spanish, f French, h Hindi, i Italian and
p Brazilian Portuguese run as installed (English through misaki and spaCy, the others through espeak-ng, which the
packages bundle); z Mandarin Chinese needs misaki's Chinese packages and j Japanese a C++ compiler: it says how.

Files: with --video <video>, inside an audara project (the nearest folder above with videos/): audio goes to
videos/<video>/audio/, timing data to videos/<video>/data/; an input inside videos/<video>/ names its video by
itself. Without a project: --out DIR (default: the current folder) gets DIR/audio/ and DIR/data/. It never writes
over a narration it did not make (eleven.py's, whose request records carry no standin: true; a recording; another
tool's words.json): it says how to keep both instead.

Downloads: the model (327 MB) and a voice (0.5 MB) of a pinned revision, once, into the user cache (env
AUDARA_CACHE, else the OS user cache folder + /audara; a git-ignored .audara-cache/ in the project when that is not
writable); files already in the user's own Hugging Face cache are used from there. The packages (about 940 MB on
disk, torch for the most part) live in uv's environment for this script. Every run says where both are and their
size on disk.

Time origin: t = 0 is the first sample of narration.wav, as browsers and ffmpeg play it.

Exit codes: 0 ok, 1 error, 2 bad usage or a narration standin.py did not make in the way. standin.py never calls a
paid API, so 3 (missing API key) and 4 (needs confirmation to spend) never occur. With --json every exit prints one
JSON object.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import io
import json
import logging
import math
import os
import platform
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import unicodedata
import warnings
import wave
from dataclasses import dataclass
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path

# Windows' 260 characters. long_paths_on, verbatim and long_path_imports are the same code in beats.py,
# beats_models.py, align.py, align_models.py, mix.py, eleven.py and standin.py: change all seven together.
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

TOOL = "standin.py"
OK, ERROR, USAGE = 0, 1, 2

# ---------------------------------------------------------------------------------------------
# The voice (hf.co/hexgrad/Kokoro-82M: its model card, VOICES.md and config.json, checked 2026-10-03)

MODEL_NAME = "Kokoro-82M"
MODEL_REPO = "hexgrad/Kokoro-82M"
MODEL_REVISION = "f3ff3571791e39611d31c381e3a41a3af07b4987"  # main on 2026-10-03 (v1.0, unchanged since 2025-04-10):
#                                                              pinned, so a block made again uses the same weights
MODEL_FILE = "kokoro-v1_0.pth"  # the weights, 327 MB; config.json and each voice (0.5 MB) beside them
MODEL_MB = 328  # what a first run downloads: the weights, config.json and one voice
LICENSE = "Apache-2.0"  # the model card's license, for the weights and the voices: commercial use allowed
LICENSE_LINE = ("{model} {voice}, {license}: commercial use allowed. A stand-in: cues that find words by their text "
                "(as audara scenes do), not copied times, keep their sync when `eleven.py tts ... --yes` replaces it")
DEFAULT_VOICE = "af_heart"  # the voice the model card grades highest (A)
SR = 24000  # Kokoro's output rate: blocks and narration.wav keep it, so nothing is resampled
FRAME = 600  # samples per predicted duration step (25 ms): a part's audio is exactly sum(durations) x 600 samples
CONTEXT = 510  # phonemes Kokoro reads at once (its 512 positions, less the two ends); a longer paragraph goes in parts
CHUNK_CHARS = 400  # Kokoro's own pipeline reads espeak-ng languages in sentences grouped up to 400 characters
SOUND_LEAD_S = 0.050  # a word's sound starts about 50 ms before its first phoneme's duration step (the decoder blurs
#                       each boundary): +45 to +53 ms (median per voice) over 65 phrase starts of five English voices,
#                       measured with the detector below. Placed that much earlier, the words inside phrases sit a
#                       median 10 ms before a CTC forced alignment's (align.py song: 39 of 40 within 50 ms)
GAP, LEAD, TAIL, LUFS = 0.6, 0.5, 1.0, -16.0  # eleven.py tts's defaults, so the blocks fall where its voice's will

LANGS = {  # Kokoro's language codes (a voice's first letter): the language, its default voice, how its text is read
    "a": ("American English", "af_heart", "misaki (spaCy)"),
    "b": ("British English", "bf_emma", "misaki (spaCy)"),
    "e": ("Spanish", "ef_dora", "espeak-ng es"),
    "f": ("French", "ff_siwis", "espeak-ng fr-fr"),
    "h": ("Hindi", "hf_alpha", "espeak-ng hi"),
    "i": ("Italian", "if_sara", "espeak-ng it"),
    "p": ("Brazilian Portuguese", "pf_dora", "espeak-ng pt-br"),
    "j": ("Japanese", "jf_alpha", "misaki[ja] (pyopenjtalk, fugashi)"),
    "z": ("Mandarin Chinese", "zf_xiaobei", "misaki[zh] (jieba, pypinyin)"),
}
LANG_ALIASES = {"en": "a", "en-us": "a", "en-gb": "b", "es": "e", "fr": "f", "fr-fr": "f", "hi": "h", "it": "i",
                "pt": "p", "pt-br": "p", "ja": "j", "zh": "z"}
VOICES = ("af_alloy af_aoede af_bella af_heart af_jessica af_kore af_nicole af_nova af_river af_sarah af_sky am_adam "
          "am_echo am_eric am_fenrir am_liam am_michael am_onyx am_puck am_santa bf_alice bf_emma bf_isabella bf_lily "
          "bm_daniel bm_fable bm_george bm_lewis ef_dora em_alex em_santa ff_siwis hf_alpha hf_beta hm_omega hm_psi "
          "if_sara im_nicola jf_alpha jf_gongitsune jf_nezumi jf_tebukuro jm_kumo pf_dora pm_alex pm_santa zf_xiaobei "
          "zf_xiaoni zf_xiaoxiao zf_xiaoyi zm_yunjian zm_yunxi zm_yunxia zm_yunyang").split()
CC_BY = {  # voices the model card credits CC BY training audio for
    "ff_siwis": "the SIWIS corpus (CC BY 4.0)", "jf_gongitsune": "Koniwa tnc (CC BY 3.0)",
    "jf_nezumi": "Koniwa tnc (CC BY 3.0)", "jf_tebukuro": "Koniwa tnc (CC BY 3.0)", "jm_kumo": "Koniwa tnc (CC BY 3.0)",
}
EXTRA_PIN = ">=0.9.4,<0.10"  # misaki's extras for Mandarin and Japanese, run with --with: the same misaki as above
PAUSE_PHONEMES = set(';:,.!?—…"()“” ')  # Kokoro's punctuation and space: what it makes pauses of, never part of a word
SENTENCE_END = re.compile(r"[.!?…。！？]+[\"'”’)»\]]*$")  # a word that ends a sentence

# ---------------------------------------------------------------------------------------------
# Measuring (the phrase-edge method and constants are align.py check's and eleven.py's, so all three report the same)

WIN_S = 0.005  # RMS window: 5 ms locates an edge far inside one video frame (33 ms at 30 fps)
HOP_S = 0.001  # 1 ms steps between RMS windows, so an edge is placed to the millisecond
LEVEL_PCT = 95  # speech level = 95th percentile of the 5 ms RMS: the loud vowels
FLOOR_PCT = 5  # noise floor = 5th percentile: the quietest stretches (digital zero in TTS)
BELOW_LEVEL_DB = 40.0  # silence = 40 dB under the speech level (soft fricatives sit 25-35 dB under)
ABOVE_FLOOR_DB = 10.0  # ...but always 10 dB over the noise floor, so room noise is never "voice"
MIN_GAP_DB = 15.0  # a threshold within 15 dB of the speech level means the noise hides the pauses
MIN_SOUND_S = 0.020  # a sound must last 20 ms; shorter blips are clicks
MIN_PAUSE_S = 0.150  # a pause is >= 150 ms of silence; shorter dips are stop consonants in a word
MATCH_MAX_S = 0.40  # a pause belongs to a word gap claimed within 0.4 s of it, or to none
TEXT_BONUS_S = 0.05  # a gap after punctuation or at a line end is the likelier home for a pause
TOLERANCE_MS = 50.0  # about 1.5 frames at 30 fps, near where viewers notice sound leading picture
MIN_WORD_S = 0.05  # shortest word kept after snapping ("a" spoken fast is ~50-80 ms)
PAD_BEFORE = 0.05  # audio kept before a block's first sound when blocks are placed: soft attacks
PAD_AFTER = 0.15  # ...and after its last sound: releases fade under the threshold while still audible
TP_MAX = -1.0  # true-peak ceiling (dBTP) for anything this script levels: streaming platforms' bar


# ---------------------------------------------------------------------------------------------
# Output, errors


class Fail(Exception):
    def __init__(self, code: int, msg: str, data: dict | None = None):
        super().__init__(msg)
        self.code = code
        self.data = data or {}


class Out:
    """What a command reports: human lines for stdout, and the same facts as JSON for --json."""

    def __init__(self) -> None:
        self.lines: list[str] = []
        self.data: dict = {}

    def __call__(self, line: str = "") -> None:
        self.lines.append(line)


def note(msg: str) -> None:
    """Progress for long work (stderr, so --json output stays one object)."""
    print(msg, file=sys.stderr, flush=True)


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def rel(p: Path | str) -> str:
    try:
        r = os.path.relpath(p, Path.cwd())
    except ValueError:  # another drive on Windows
        r = str(p)
    return r.replace("\\", "/")


def q(s: str) -> str:
    """Quote an argument for the shell (double quotes work in bash and PowerShell alike)."""
    return f"\"{s}\"" if not s or re.search(r"[\s\"'&|<>()$;`]", s) else s


def script_path(name: str = "") -> str:
    """A script of this skill as a command argument: relative when it is near the current folder,
    else absolute (an installed plugin usually sits far from the project)."""
    p = Path(__file__).resolve()
    p = p.with_name(name) if name else p
    r = rel(p)
    return r if not r.startswith("../../") else str(p).replace("\\", "/")


def me(*args) -> str:
    """This script's command line, runnable as printed from the current folder."""
    return "uv run " + " ".join(q(str(x)) for x in (script_path(), *args))


def place_args(a) -> list[str]:
    return (["--video", a.video] if getattr(a, "video", None) else []) + (["--out", a.out] if getattr(a, "out", None) else [])


def r3(x: float) -> float:
    return round(float(x), 3)


def num(n: float) -> str:
    return f"{n:,.0f}"


# ---------------------------------------------------------------------------------------------
# Files


# Where files go. Where, has_videos, find_project, video_of, in_video and where are the same code in
# eleven.py, beats.py, mix.py, align.py and standin.py: change all five together.


@dataclass
class Where:
    project: Path | None  # the audara project, or None outside one
    name: str | None  # the video's name
    video_dir: Path | None  # videos/<video>/
    audio_dir: Path  # videos/<video>/audio/, or <out>/audio/
    data_dir: Path  # videos/<video>/data/, or <out>/data/
    review_dir: Path  # out/<video>/ (git-ignored), or <out>/out/
    base: Path  # the project, or the --out folder (the current folder by default)


def has_videos(d: Path) -> bool:
    """d holds a folder named exactly "videos". Windows and macOS match names whatever their case, and
    the home folder's own Videos is not a project: the home folder counts only when one of its
    videos/*/ has a video.json."""
    try:
        if not any(e.name == "videos" and e.is_dir() for e in os.scandir(d)):
            return False
        if d.resolve() == Path.home().resolve():
            return any((p / "video.json").is_file() for p in (d / "videos").iterdir() if p.is_dir())
    except OSError:
        return False
    return True


def find_project(start: Path) -> Path | None:
    """The nearest folder at or above `start` that has videos/: an audara project."""
    start = Path(start).resolve()
    for d in (start, *start.parents):
        if has_videos(d):
            return d
    return None


def video_of(path: Path) -> tuple[Path, str] | None:
    """(project, video name) when `path` lies inside <project>/videos/<video>/."""
    p = Path(path).resolve()
    proj = find_project(p.parent)
    if proj is None:
        return None
    try:
        parts = p.relative_to(proj / "videos").parts
    except ValueError:
        return None
    return (proj, parts[0]) if len(parts) > 1 else None


def in_video(proj: Path, name: str) -> Where:
    vd = proj / "videos" / name
    return Where(proj, name, vd, vd / "audio", vd / "data", proj / "out" / name, proj)


def where(video: str | None, out: str | None, inputs=(), writes: bool = True) -> Where:
    """Where a command reads and writes. --video NAME: videos/NAME/ in the nearest project above the
    current folder. --out DIR: DIR/audio/, DIR/data/ and DIR/out/, outside a project. Neither: the
    video an input file lies in (<project>/videos/<video>/...), else the video the current folder
    lies in, else the current folder outside a project. Inside a project a command that writes
    audio or timing data needs its video, or the files would land at the project's root, where the
    engine never reads them; review files alone go to the project's out/."""
    if video and out:
        raise Fail(USAGE, "use --video <video> inside an audara project, or --out DIR without one, not both")
    if video:
        proj = find_project(Path.cwd())
        if proj is None:
            raise Fail(USAGE, f"--video {video}: no audara project (a folder with videos/) in {Path.cwd()} or "
                              f"above it. Run from inside the project, or use --out DIR to write outside one.")
        if not (proj / "videos" / video).is_dir():
            names = sorted(p.name for p in (proj / "videos").iterdir() if p.is_dir())
            raise Fail(USAGE, f"--video {video}: there is no videos/{video}/ in {proj} (videos here: "
                              f"{', '.join(names) or 'none'})")
        return in_video(proj, video)
    if out:
        base = Path(out).resolve()
        return Where(None, None, None, base / "audio", base / "data", base / "out", base)
    for p in [*inputs, Path.cwd() / "_"]:  # an input inside videos/<video>/, else the current folder inside one
        hit = video_of(Path(p)) if p else None
        if hit:
            return in_video(*hit)
    proj = find_project(Path.cwd())
    if proj is not None:
        if writes:
            names = sorted(p.name for p in (proj / "videos").iterdir() if p.is_dir())
            raise Fail(USAGE, f"{proj} is an audara project: name the video with --video <video> (videos here: "
                              f"{', '.join(names) or 'none'}), or write outside it with --out DIR")
        return Where(proj, None, None, proj / "audio", proj / "data", proj / "out", proj)
    base = Path.cwd()
    return Where(None, None, None, base / "audio", base / "data", base / "out", base)


def find_input(p: str, w: Where, sub: str, what: str) -> Path:
    path = Path(p)
    if path.is_file():
        return path.resolve()
    for d in ([w.video_dir / sub, w.video_dir] if w.video_dir is not None else []) + [w.base / sub]:
        if (d / p).is_file():
            return (d / p).resolve()
    raise Fail(USAGE, f"{what} not found: {p}")


def read_json(p: Path, what: str = "") -> dict | list | None:
    try:
        return json.loads(p.read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        return None
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise Fail(ERROR, f"{rel(p)} is not valid JSON ({e}): fix it or delete it{what}")


def write_bytes(path: Path, data: bytes) -> bool:
    """Write only when the bytes change, so an unchanged output keeps its mtime."""
    if path.is_file() and path.stat().st_size == len(data) and path.read_bytes() == data:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    try:
        os.replace(tmp, path)
    except OSError:
        tmp.unlink(missing_ok=True)
        raise
    return True


def write_json(path: Path, obj) -> bool:
    return write_bytes(path, (json.dumps(obj, ensure_ascii=False, indent=1) + "\n").encode("utf-8"))


def side(path: Path, suffix: str) -> Path:
    """The file beside an audio file: 01-intro.mp3 -> 01-intro.request.json."""
    return path.with_name(path.stem + suffix)


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def slugify(s: str, words: int = 4, maxlen: int = 32) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    parts = re.findall(r"[A-Za-z0-9]+", s.lower())[:words]
    return "-".join(parts)[:maxlen].strip("-") or "untitled"


# The cache. CACHE_DIRS, user_cache, cache_root, SIZE_BUDGET_S, file_sizes, folder_bytes and uv_cache are the same
# code in beats.py, mix.py, align.py and standin.py: change all four together.

CACHE_DIRS = ("work", "torch", "hf", "whisper", "matplotlib", "numba",  # what the scripts keep in the cache,
              "uv")  # and uv's, which SKILL.md puts in .audara-cache/uv for a sandbox


def user_cache() -> Path:
    """env AUDARA_CACHE, else the OS user cache folder + /audara (nothing is created here)."""
    env = os.environ.get("AUDARA_CACHE", "").strip()
    if env and sys.platform == "win32" and re.match(r"^/[a-zA-Z]/", env):
        env = f"{env[1].upper()}:{env[2:]}"  # a Git Bash path (/c/Users/...) would otherwise land in C:\c\Users\...
    if env:
        return Path(env)
    if sys.platform == "win32":
        return Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "audara"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Caches" / "audara"
    return Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "audara"


def cache_root(w: Where) -> tuple[Path, bool]:
    """The user cache, created; (folder, inside the project). When a sandbox forbids writing there,
    one self-ignoring .audara-cache/ in the project (or the --out folder) instead. An AUDARA_CACHE set
    inside the project (or the folder worked in) ignores itself the same way."""
    root = user_cache()
    try:
        root.mkdir(parents=True, exist_ok=True)
        probe = root / f".write-test-{os.getpid()}"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
    except OSError as e:
        fb = w.base / ".audara-cache"
        fb.mkdir(parents=True, exist_ok=True)
        (fb / ".gitignore").write_text("*\n", encoding="utf-8", newline="\n")  # the folder ignores itself in git
        note(f"cache: {root} is not writable here ({e.strerror or e}); using {fb} instead (git-ignored)")
        return fb, True
    r = root.resolve()
    base = next((d for d in (w.base.resolve(), Path.cwd().resolve()) if d in r.parents), None)
    if not os.environ.get("AUDARA_CACHE", "").strip() or base is None:
        return root, False
    if not (root / ".gitignore").exists():
        other = [e.name for e in root.iterdir() if e.name not in CACHE_DIRS and not e.name.startswith(".write-test-")]
        if other:  # (a folder of the project's own: its files must stay visible to git)
            note(f"cache: AUDARA_CACHE ({root}) lies inside {base} and holds other files ({', '.join(other[:3])}), so "
                 f"it is not git-ignored: point AUDARA_CACHE at a folder of its own")
            return root, False
        (root / ".gitignore").write_text("*\n", encoding="utf-8", newline="\n")  # as the fallback's
        note(f"cache: AUDARA_CACHE ({root}) lies inside {base}: it ignores itself in git (a '*' .gitignore there)")
    return root, True


SIZE_BUDGET_S = 5.0  # uv's cache is counted for 5 s at most: one that every project shares can hold millions of files
#                      (19 GB in 1.8 million took 57 s here); a sandbox's (1.1 GB in 48,000 files) takes about 1 s


def file_sizes(p: Path):
    """The size of every file under p, each file once: uv hard-links its environments to its archive, so a sum over
    every path counts most of a uv cache twice (an eval run read 2.04 GB for a folder of 1.08 GB). Walked the long
    way on Windows: a cache in a deep project holds paths past 260 characters, which a plain walk skips (in one 181
    characters deep, 4,137 of its 8,354 files)."""
    seen = set()
    for d, _, names in os.walk(verbatim(str(p)) if sys.platform == "win32" else str(p)):
        for name in names:
            try:
                st = os.stat(os.path.join(d, name))
            except OSError:  # (removed meanwhile, or unreadable)
                continue
            if stat.S_ISREG(st.st_mode) and not (st.st_ino and (st.st_dev, st.st_ino) in seen):
                seen.add((st.st_dev, st.st_ino))
                yield st.st_size


def folder_bytes(p: Path) -> int:
    return sum(file_sizes(p))


def uv_cache() -> dict | None:
    """uv's cache when UV_CACHE_DIR moves it (for a sandbox, or a short path: SKILL.md): where it is and its size on
    disk, for the hand-off. None when UV_CACHE_DIR is not set: uv's own cache is shared by every project."""
    env = os.environ.get("UV_CACHE_DIR", "").strip()
    d = Path(env).resolve() if env else None  # (a relative one from the current folder, as uv reads it)
    if d is None or not d.is_dir():
        return None
    n, done, stop = 0, True, time.monotonic() + SIZE_BUDGET_S
    for size in file_sizes(d):
        n += size
        if time.monotonic() > stop:
            done = False
            break
    size = f"{n / 1e9:.2f} GB" if n >= 1e9 else f"{n / 1e6:.0f} MB" if n >= 1e6 else f"{n / 1e3:.0f} KB"
    return {"path": str(d), "bytes": n, "counted": done,
            "note": f"uv's cache (UV_CACHE_DIR): {d}, {size if done else 'over ' + size} on disk"
                    + ("" if done else f" (counting stopped after {SIZE_BUDGET_S:g} s)")
                    + ", each file counted once (its environments share their files with its downloads); it can be "
                      "deleted once no script is running, and uv downloads what it needs again"}


def human_bytes(n: float) -> str:
    if n >= 1e9:
        return f"{n / 1e9:.2f} GB"
    if n >= 1e6:
        return f"{n / 1e6:.0f} MB"
    return f"{n / 1e3:.0f} KB"


# ---------------------------------------------------------------------------------------------
# Audio: ffmpeg decode, loudness, the waveform


def tool(name: str) -> str:
    p = shutil.which(name)
    if not p:
        raise Fail(ERROR, f"{name} not found: install ffmpeg (winget install Gyan.FFmpeg, brew install ffmpeg or "
                          f"apt install ffmpeg), then reopen the terminal")
    return p


def decode(path: Path, sr: int = SR) -> np.ndarray:
    """ffmpeg's gapless decode (encoder delay trimmed, as Chrome's decodeAudioData plays it), mono."""
    r = subprocess.run([tool("ffmpeg"), "-v", "error", "-nostdin", "-i", str(path), "-map", "0:a:0", "-vn",
                        "-ac", "1", "-ar", str(sr), "-f", "f32le", "-c:a", "pcm_f32le", "-"], capture_output=True)
    if r.returncode != 0:
        raise Fail(ERROR, f"ffmpeg could not decode {rel(path)}: {r.stderr.decode(errors='replace').strip()[:300]}")
    y = np.frombuffer(r.stdout, np.float32).copy()
    if len(y) == 0:
        raise Fail(ERROR, f"{rel(path)}: decoded to zero samples")
    return y


def to_pcm16(y: np.ndarray) -> np.ndarray:
    return np.clip(np.round(y.astype(np.float64) * 32767.0), -32768, 32767).astype("<i2")


def wav_bytes(pcm: np.ndarray, sr: int = SR) -> bytes:
    """16-bit mono WAV, deterministic (no timestamps in the header), so re-runs compare equal."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm.tobytes())
    return buf.getvalue()


FRAME_RE = re.compile(r"t:\s*([\d.]+)\s+TARGET:.*?M:\s*(-?inf|nan|-?[\d.]+)\s+S:\s*(-?inf|nan|-?[\d.]+)")


def loudness(path: Path | None = None, y: np.ndarray | None = None, sr: int = SR, series: bool = False) -> dict:
    """EBU R128 by ffmpeg: integrated (LUFS), range (LU), true peak (dBTP), and with series=True the
    400 ms (M) and 3 s (S) loudness every 100 ms. A mono file is measured as dual mono: it plays on
    both speakers, which is how a listener hears it."""
    cmd = [tool("ffmpeg"), "-hide_banner", "-nostats", "-loglevel", "verbose" if series else "info"]
    data = None
    if path is not None:
        cmd += ["-nostdin", "-i", str(path)]
    else:
        cmd += ["-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "-"]
        data = np.ascontiguousarray(y, dtype="<f4").tobytes()
    cmd += ["-af", "ebur128=peak=true:dualmono=true", "-f", "null", "-"]
    r = subprocess.run(cmd, input=data, capture_output=True, stdin=None if data is not None else subprocess.DEVNULL)
    err = r.stderr.decode("utf-8", "replace")
    if r.returncode != 0:
        raise Fail(ERROR, f"ffmpeg could not measure loudness{' of ' + rel(path) if path else ''}: {err.strip()[-300:]}")
    summ = err[err.rfind("Summary:"):]

    def grab(pat: str) -> float:
        m = re.search(pat, summ)
        if not m or m.group(1) in ("-inf", "inf", "nan"):
            return float("-inf")
        return float(m.group(1))

    res = {"I": grab(r"I:\s+(-?inf|-?[\d.]+) LUFS"), "LRA": grab(r"LRA:\s+(-?[\d.]+) LU"),
           "TP": grab(r"Peak:\s+(-?inf|-?[\d.]+) dBFS")}
    if series:
        t, m, s = [], [], []
        for mm in FRAME_RE.finditer(err):
            t.append(float(mm.group(1)))
            m.append(float(mm.group(2)) if mm.group(2) not in ("nan",) else float("-inf"))
            s.append(float(mm.group(3)) if mm.group(3) not in ("nan",) else float("-inf"))
        res.update(t=np.array(t), M=np.array(m), S=np.array(s))
    return res


def fmt_lufs(x: float) -> str:
    return "silent" if not math.isfinite(x) else f"{x:.1f}"


# ---------------------------------------------------------------------------------------------
# Phrase edges: the waveform's pauses matched to the gaps between words. Sound, runs, analyze, W,
# Edge, Report, match, snap and fit_syl are the same code in eleven.py, align.py and standin.py: change all three;
# edge_stats, signed, edge_line and check_lines are eleven.py's.


@dataclass
class Sound:
    t: np.ndarray  # frame centres (s)
    db: np.ndarray  # 5 ms RMS in dBFS
    duration: float
    level: float
    floor: float
    thr: float
    pauses: list  # [(offset before, onset after)], interior pauses only
    first_on: float | None
    last_off: float | None
    usable: bool
    source: str = "audio"


def runs(mask: np.ndarray) -> list[tuple[int, int]]:
    m = np.concatenate([[False], mask, [False]]).astype(np.int8)
    d = np.diff(m)
    return list(zip(np.flatnonzero(d == 1).tolist(), np.flatnonzero(d == -1).tolist()))


def analyze(y: np.ndarray, sr: int, thr_db: float | None = None, source: str = "audio") -> Sound:
    win, hop = max(1, round(WIN_S * sr)), max(1, round(HOP_S * sr))
    n = max(1, (len(y) - win) // hop + 1)
    c = np.concatenate([[0.0], np.cumsum(y.astype(np.float64) ** 2)])
    idx = np.arange(n) * hop
    e = (c[np.minimum(idx + win, len(y))] - c[idx]) / win
    db = 10 * np.log10(np.maximum(e, 1e-12))
    t = (idx + win / 2) / sr
    floor = float(np.percentile(db, FLOOR_PCT))
    active = db[db > floor + 20]
    level = float(np.percentile(active, LEVEL_PCT)) if len(active) > 50 else float(db.max())
    thr = float(thr_db) if thr_db is not None else max(level - BELOW_LEVEL_DB, floor + ABOVE_FLOOR_DB)
    usable = level - thr >= MIN_GAP_DB
    snd = db > thr
    for a, b in runs(snd):  # clicks: sounds shorter than MIN_SOUND_S are silence
        if (b - a) * HOP_S < MIN_SOUND_S:
            snd[a:b] = False
    islands = runs(snd)
    pauses = []
    for (_, b0), (a1, _) in zip(islands, islands[1:]):
        if t[a1] - t[b0 - 1] >= MIN_PAUSE_S:
            pauses.append((float(t[b0 - 1]), float(t[a1])))
    first_on = float(t[islands[0][0]]) if islands else None
    last_off = float(t[islands[-1][1] - 1]) if islands else None
    return Sound(t, db, len(y) / sr, level, floor, thr, pauses, first_on, last_off, usable and bool(islands), source)


PUNCT_END = (",", ".", ";", ":", "!", "?", "…", "—", "–", "-")


@dataclass
class W:
    i: int
    text: str
    start: float
    end: float
    line: int | None
    ref: dict

    @property
    def ends_phrase(self) -> bool:
        return self.text.rstrip("\"'”’)»]").endswith(PUNCT_END)

    @property
    def sounds(self) -> bool:
        """A token with no letter or digit (a dash between spaces) is not a sound to measure."""
        return any(ch.isalnum() for ch in self.text)


@dataclass
class Edge:
    kind: str  # "start" (of the word after a pause) or "end" (of the word before one)
    w: W
    claimed: float
    measured: float
    pause: tuple[float, float] | None  # None = lead-in or tail of the file

    @property
    def err(self) -> float:  # claimed - measured; negative = the word box comes before the sound
        return self.claimed - self.measured


@dataclass
class Report:
    edges: list[Edge]
    unexplained: list[tuple[float, float, str]]  # pauses no word gap explains
    runs_on: list[str]  # punctuation where the voice does not pause
    matched: int


def match(ws: list[W], snd: Sound) -> Report:
    ws = [w for w in ws if w.sounds]
    n, P = len(ws), snd.pauses
    edges: list[Edge] = []
    if n == 0:
        return Report([], [], [], 0)
    # lead-in and tail: the first and last sounds against the first word's start and last word's end
    if snd.first_on is not None and abs(ws[0].start - snd.first_on) <= MATCH_MAX_S:
        edges.append(Edge("start", ws[0], ws[0].start, snd.first_on, None))
    if snd.last_off is not None and abs(ws[-1].end - snd.last_off) <= MATCH_MAX_S:
        edges.append(Edge("end", ws[-1], ws[-1].end, snd.last_off, None))
    m, nb = len(P), n - 1
    pairs: list[tuple[int, int]] = []
    if m and nb:
        lo = np.array([min(ws[i].end, ws[i + 1].start) for i in range(nb)])
        hi = np.array([max(ws[i].end, ws[i + 1].start) for i in range(nb)])
        textual = np.array([ws[i].ends_phrase or (ws[i].line is not None and ws[i].line != ws[i + 1].line)
                            for i in range(nb)])
        # DP over (pauses x word gaps), non-crossing: each pause takes at most one gap and vice versa;
        # an unmatched pause costs MATCH_MAX_S, an unmatched gap costs nothing.
        D = np.zeros(nb + 1)
        choice = np.zeros((m, nb + 1), np.int8)
        src = np.zeros((m, nb + 1), np.int32)
        for j, (a, b) in enumerate(P):
            dist = np.maximum(0.0, np.maximum(lo - b, a - hi))  # gap between the two intervals
            # distance first; the centres only break ties (capped, so a long instrumental pause still
            # matches a word gap that touches it), and punctuation or a line end wins a close call
            centre = np.minimum(np.abs((lo + hi) / 2 - (a + b) / 2), 0.5)
            cost = dist + 0.2 * centre - TEXT_BONUS_S * textual
            cost = np.where(dist <= MATCH_MAX_S, cost, np.inf)
            X = np.empty(nb + 1)
            X[0] = D[0] + MATCH_MAX_S
            skip = D[1:] + MATCH_MAX_S
            take = D[:-1] + cost
            X[1:] = np.minimum(skip, take)
            choice[j, 1:] = take < skip
            # prefix minimum (skipping word gaps is free), remembering where each minimum came from
            best = np.minimum.accumulate(X)
            pos = np.arange(nb + 1)
            src[j] = np.maximum.accumulate(np.where(X == best, pos, 0))
            D = best
        i = nb
        for j in range(m - 1, -1, -1):
            i = int(src[j, i])
            if choice[j, i]:
                pairs.append((j, i - 1))
                i -= 1
        pairs.reverse()
    used_p, used_b = {j for j, _ in pairs}, {i for _, i in pairs}
    for j, i in pairs:
        a, b = P[j]
        edges.append(Edge("end", ws[i], ws[i].end, a, (a, b)))
        edges.append(Edge("start", ws[i + 1], ws[i + 1].start, b, (a, b)))
    unexplained = []
    for j, (a, b) in enumerate(P):
        if j in used_p:
            continue
        mid = (a + b) / 2
        inside = [w.text for w in ws if w.start < mid < w.end]
        unexplained.append((a, b, ", ".join(inside[:3])))
    runs_on = [f"'{ws[i].text}' {ws[i].end:.2f}" for i in range(n - 1)
               if i not in used_b and (ws[i].ends_phrase or (ws[i].line is not None and ws[i].line != ws[i + 1].line))]
    edges.sort(key=lambda e: (e.measured, e.kind != "end"))
    return Report(edges, unexplained, runs_on, len(pairs))


def snap(ws: list[W], rep: Report) -> list[str]:
    """Phrase-initial starts and phrase-final ends move to the measured sound (they are pinned).
    The words between them are not measured and stay where they are, unless a snapped word would
    get shorter than MIN_WORD_S: then its other edge moves along (keeping its old length), and a
    neighbour it now overlaps gives way, word by word, in that direction only."""
    orig = {w.i: (w.start, w.end) for w in ws}
    pin_s, pin_e = set(), set()
    for e in rep.edges:
        if e.kind == "start":
            e.w.start = e.measured
            pin_s.add(e.w.i)
        else:
            e.w.end = e.measured
            pin_e.add(e.w.i)
    n = len(ws)
    for k in range(n):  # pushes to the right (a start moved later)
        w = ws[k]
        if w.i in pin_s and w.i not in pin_e and w.end - w.start < MIN_WORD_S:
            w.end = w.start + max(MIN_WORD_S, orig[w.i][1] - orig[w.i][0])
        if k + 1 < n and ws[k + 1].start < w.end and ws[k + 1].i not in pin_s and w.i not in pin_e:
            nx = ws[k + 1]
            nx.start = w.end
            if nx.end - nx.start < MIN_WORD_S and nx.i not in pin_e:
                nx.end = nx.start + MIN_WORD_S
    for k in range(n - 1, -1, -1):  # pushes to the left (an end moved earlier)
        w = ws[k]
        if w.i in pin_e and w.i not in pin_s and w.end - w.start < MIN_WORD_S:
            w.start = w.end - max(MIN_WORD_S, orig[w.i][1] - orig[w.i][0])
        if k > 0 and ws[k - 1].end > w.start and ws[k - 1].i not in pin_e and w.i not in pin_s:
            pv = ws[k - 1]
            pv.end = w.start
            if pv.end - pv.start < MIN_WORD_S and pv.i not in pin_s:
                pv.start = pv.end - MIN_WORD_S
    changes = []
    for w in ws:
        o0, o1 = orig[w.i]
        if abs(w.start - o0) >= 0.0005 or abs(w.end - o1) >= 0.0005:
            changes.append(f"'{w.text}' {o0:.3f}-{o1:.3f} -> {w.start:.3f}-{w.end:.3f} "
                           f"({(w.start - o0) * 1000:+.0f} / {(w.end - o1) * 1000:+.0f} ms)")
    return changes


def fit_syl(word: dict) -> None:
    """A word's syllable spans after its edges moved: clamped inside the word, empty spans dropped,
    the first starting with the word and the last ending with it (the engine's wordProgress() needs
    them ordered and non-empty); fewer than two left means no syl at all."""
    syl = word.get("syl")
    if not isinstance(syl, list):
        return
    a, b = word["start"], word["end"]
    spans = [[round(min(max(float(s), a), b), 3), round(min(max(float(e), a), b), 3)] for s, e in syl]
    spans = [s for s in spans if s[1] > s[0]]
    if len(spans) > 1:
        spans[0][0], spans[-1][1] = a, b
        word["syl"] = spans
    else:
        word.pop("syl", None)


def edge_stats(edges: list[Edge]) -> dict:
    if not edges:
        return {"edges": 0}
    worst = max(edges, key=lambda e: abs(e.err))
    starts = [e.err for e in edges if e.kind == "start"]
    # the edges beyond tolerance by kind and direction: a phrase start or end, early (the word box before the
    # sound) or late
    beyond = {}
    for kind in ("start", "end"):
        for way, early in (("early", True), ("late", False)):
            errs = [e.err for e in edges
                    if e.kind == kind and abs(e.err) * 1000 > TOLERANCE_MS and (e.err < 0) == early]
            beyond[f"{kind}s_{way}"] = {"n": len(errs),
                                        "median_ms": round(float(np.median(errs)) * 1000, 1) if errs else None}
    # phrases = matched pauses + 1 (each pause gives an end and a start; the lead-in and tail may go unmatched)
    return {"edges": len(edges), "phrases": sum(1 for e in edges if e.pause is not None) // 2 + 1,
            "worst_ms": round(worst.err * 1000, 1), "worst_word": worst.w.text,
            "worst_edge": worst.kind, "worst_at": r3(worst.measured),
            "worst_frames_30": round(worst.err * 30, 2), "worst_frames_60": round(worst.err * 60, 2),
            "median_start_ms": round(float(np.median(starts)) * 1000, 1) if starts else None,
            "beyond_tolerance": sum(1 for e in edges if abs(e.err) * 1000 > TOLERANCE_MS), "beyond": beyond}


def signed(ms: float) -> str:
    return "0" if round(ms) == 0 else f"{ms:+.0f}"


def edge_line(s: dict, when: str = "") -> str:
    """The worst edge, then which edges are beyond tolerance and which way: '7 of 14 phrase edges (7 phrases)
    beyond ±50 ms before snapping: 7 starts early (median -112 ms), 0 ends'."""
    if not s.get("edges"):
        return "no phrase edge could be measured"
    line = (f"worst {signed(s['worst_ms'])} ms at '{s['worst_word']}' ({s['worst_edge']}, {s['worst_at']:.2f} s) = "
            f"{abs(s['worst_frames_30']):.1f} frames at 30 fps, {abs(s['worst_frames_60']):.1f} at 60 fps; "
            f"{s['beyond_tolerance']} of {s['edges']} phrase edge{'s' if s['edges'] != 1 else ''} ({s['phrases']} "
            f"phrase{'s' if s['phrases'] != 1 else ''}) beyond ±{TOLERANCE_MS:.0f} ms" + (f" {when}" if when else ""))
    if not s["beyond_tolerance"]:
        return line
    parts = []
    for kind in ("start", "end"):
        groups = [(way, s["beyond"][f"{kind}s_{way}"]) for way in ("early", "late")]
        parts += [f"{g['n']} {kind}{'s' if g['n'] != 1 else ''} {way} ({'median ' if g['n'] > 1 else ''}"
                  f"{signed(g['median_ms'])} ms)" for way, g in groups if g["n"]] or [f"0 {kind}s"]
    return line + ": " + ", ".join(parts)


# ---------------------------------------------------------------------------------------------
# Narration text: script, say map, blocks (Block, read_script and the say map are eleven.py's, and so is how a
# block's timings become its words: bare, spoken_times, block_words and attach_marks)


@dataclass
class Block:
    n: int
    width: int
    display: str
    tokens: list[str]
    groups: list[Group]
    chapter: str | None

    @property
    def spoken(self) -> str:
        return " ".join(s for g in self.groups for s in g.spoken)

    @property
    def name(self) -> str:
        return f"{self.n:0{self.width}d}-{slugify(self.display)}"

    @property
    def said(self) -> dict:
        return {g.shown: g.say for g in self.groups if g.shown}


MD_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
MD_CODE = re.compile(r"`([^`]*)`")
MD_STRONG = re.compile(r"(\*\*|__)(?=\S)(.+?)(?<=\S)\1")
MD_EM = re.compile(r"(?<![\w*])([*_])(?=\S)(.+?)(?<=\S)\1(?![\w*])")


def read_script(path: Path) -> list[tuple[str, str | None]]:
    """Paragraphs (blank-line separated) with their chapter. In a .md script, a # heading starts a
    chapter and is not spoken, and emphasis, links and code marks are dropped from the text."""
    try:
        text = path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        raise Fail(USAGE, f"{rel(path)} is not UTF-8 text: save it as UTF-8 and run again")
    md = path.suffix.lower() in (".md", ".markdown")
    if md:
        text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    paras: list[tuple[str, str | None]] = []
    cur: list[str] = []
    chapter = None

    def flush():
        if cur:
            p = " ".join(" ".join(cur).split())
            if p:
                paras.append((p, chapter))
            cur.clear()

    for line in text.splitlines():
        s = line.strip()
        if not s:
            flush()
            continue
        if md and s.startswith("#"):
            flush()
            chapter = s.lstrip("#").strip() or None
            continue
        if md:
            s = re.sub(r"^>\s?", "", s)
            s = MD_LINK.sub(r"\1", s)
            s = MD_CODE.sub(r"\1", s)
            s = MD_STRONG.sub(r"\2", s)
            s = MD_EM.sub(r"\2", s)
        cur.append(s)
    flush()
    return paras


# The say map. Group, say_key, is_acronym, SayEntry, rel_to, read_say, edges_of, sentence_punct and
# respell are the same code in eleven.py, align.py and standin.py: change all three together.


@dataclass
class Group:
    idx: list[int]  # the shown words it covers
    spoken: list[str]  # the words said (the shown sentence punctuation kept on them, for the voice)
    shown: str | None = None  # the say-map entry that applied
    say: str | None = None


def say_key(s: str) -> str:
    """Matching key: accents stripped, case folded, letters and digits only."""
    s = unicodedata.normalize("NFKD", s.casefold())
    return "".join(ch for ch in s if ch.isalnum() and not unicodedata.combining(ch))


def is_acronym(s: str) -> bool:
    letters = [c for c in s if c.isalpha()]
    return len(letters) >= 2 and all(c.isupper() for c in letters)


@dataclass
class SayEntry:
    shown: list[str]
    keys: list[str]
    caps: list[bool]  # an all-capitals shown word matches only all-capitals text ("IA", not the verb "ia")
    spoken: list[str]


def rel_to(p: Path, base: Path) -> str:
    try:
        return os.path.relpath(p, base).replace("\\", "/")
    except ValueError:  # another drive on Windows
        return str(p)


def read_say(items: list[str], w: Where) -> tuple[list[SayEntry], list[str]]:
    """--say items: a file of 'shown<TAB>spoken' lines, a JSON file {"shown": "spoken"}, or a pair
    'shown=spoken'. An entry may span several words ("New York", "Opus 5.5"); an all-capitals word
    matches only all-capitals text ("IA", not the Portuguese verb "ia"), any other matches whatever
    the case. Returns the entries and the items to remember (files relative to the project, so the
    next run finds them from anywhere in it)."""
    pairs: list[tuple[str, str, str]] = []
    keep: list[str] = []
    for it in items:
        places = [Path(it)] + ([w.video_dir / it, w.video_dir / "data" / it] if w.video_dir is not None else []) \
            + [w.base / it]
        cand = next((p for p in places if p.is_file()), None)
        if cand is not None:
            keep.append(rel_to(cand.resolve(), w.base))
            name = rel_to(cand, Path.cwd())
            text = cand.read_text(encoding="utf-8-sig")
            if cand.suffix.lower() == ".json":
                try:
                    data = json.loads(text)
                    found = data.items() if isinstance(data, dict) else [tuple(x) for x in data]
                    pairs += [(str(k), str(v), name) for k, v in found]
                except (json.JSONDecodeError, TypeError, ValueError) as e:
                    raise Fail(USAGE, f"--say {it}: not a JSON object of shown -> spoken words ({e})")
                continue
            for n, line in enumerate(text.splitlines(), 1):
                if not line.strip() or line.lstrip().startswith("#"):
                    continue
                if "\t" not in line:
                    raise Fail(USAGE, f"{name} line {n}: write 'shown<TAB>spoken' (e.g. P(doom)<TAB>pee doom), "
                                      f"or use a JSON file {{\"shown\": \"spoken\"}}")
                a, b = line.split("\t", 1)
                pairs.append((a.strip(), b.strip(), f"{name} line {n}"))
        elif "=" in it:
            keep.append(it)
            a, b = it.split("=", 1)
            pairs.append((a.strip(), b.strip(), f"--say {it!r}"))
        else:
            raise Fail(USAGE, f"--say {it!r}: give a file (shown<TAB>spoken lines, or JSON {{\"shown\": \"spoken\"}}) "
                              f"or a pair like 'AGI=ay gee eye'")
    entries: list[SayEntry] = []
    seen: dict[tuple, str] = {}
    for shown, spoken, src in pairs:
        sw, sp = shown.split(), spoken.split()
        if not sw or not sp:
            raise Fail(USAGE, f"{src}: both the shown and the spoken text are needed")
        k = tuple(say_key(x) for x in sw)
        if not all(k):
            raise Fail(USAGE, f"{src}: {shown!r} has a word without letters or digits to match")
        if k in seen:
            raise Fail(USAGE, f"{src}: {shown!r} is already in the map ({seen[k]}); keep one")
        seen[k] = src
        entries.append(SayEntry(sw, list(k), [is_acronym(x) for x in sw], sp))
    entries.sort(key=lambda e: -len(e.keys))  # several-word entries first
    return entries, keep


SENT_TRAIL = ",.;:!?…—–"
SENT_LEAD = "¿¡"


def edges_of(s: str) -> tuple[str, str]:
    i, j = 0, len(s)
    while i < j and not s[i].isalnum():
        i += 1
    while j > i and not s[j - 1].isalnum():
        j -= 1
    return s[:i], s[j:]


def sentence_punct(first_tok: str, last_tok: str, shown_first: str, shown_last: str) -> tuple[str, str]:
    """The sentence punctuation around respelled words, kept on the spoken form for the voice's
    phrasing; punctuation that belongs to the map entry itself ("U.S." keeps its dot) is not."""
    lead_t, _ = edges_of(first_tok)
    _, trail_t = edges_of(last_tok)
    lead_k, _ = edges_of(shown_first)
    _, trail_k = edges_of(shown_last)
    lead = lead_t[:len(lead_t) - len(lead_k)] if lead_k and lead_t.endswith(lead_k) else lead_t
    trail = trail_t[len(trail_k):] if trail_k and trail_t.startswith(trail_k) else trail_t
    return "".join(c for c in lead if c in SENT_LEAD), "".join(c for c in trail if c in SENT_TRAIL)


def respell(display: str, entries: list[SayEntry]) -> tuple[list[str], list[Group]]:
    toks = display.split()
    groups: list[Group] = []
    i = 0
    while i < len(toks):
        hit = None
        for e in entries:
            m = len(e.keys)
            if i + m <= len(toks) and all(
                    say_key(toks[i + j]) == e.keys[j] and (not e.caps[j] or is_acronym(toks[i + j]))
                    for j in range(m)):
                hit = e
                break
        if hit is None:
            groups.append(Group([i], [toks[i]]))
            i += 1
            continue
        m = len(hit.keys)
        lead, trail = sentence_punct(toks[i], toks[i + m - 1], hit.shown[0], hit.shown[-1])
        sp = list(hit.spoken)
        sp[0], sp[-1] = lead + sp[0], sp[-1] + trail
        groups.append(Group(list(range(i, i + m)), sp, " ".join(hit.shown), " ".join(hit.spoken)))
        i += m
    return toks, groups


def bare(s: str) -> str:
    i, j = 0, len(s)
    while i < j and not s[i].isalnum():
        i += 1
    while j > i and not s[j - 1].isalnum():
        j -= 1
    return s[i:j] or s


def spoken_times(text: str, al: dict) -> list[tuple[float, float]]:
    """(start, end) of every whitespace-separated word of `text` from the API's character timings.
    A word's times come from its letters and digits only: the API stretches punctuation and spaces
    over the pauses, which would push word edges into the silence."""
    chars = al.get("characters") or []
    st = al.get("character_start_times_seconds") or []
    en = al.get("character_end_times_seconds") or []
    n = min(len(chars), len(st), len(en))
    flat, owner = [], []
    for k in range(n):
        for ch in str(chars[k]):
            flat.append(ch)
            owner.append(k)
    joined = "".join(flat)
    if joined == text:
        tmap: list[int | None] = list(owner)
    else:  # the API changed the text a little: map what still matches
        tmap = [None] * len(text)
        for a, b, size in SequenceMatcher(None, text, joined, autojunk=False).get_matching_blocks():
            for x in range(size):
                tmap[a + x] = owner[b + x]
    times: list[tuple[float, float] | None] = []
    for m in re.finditer(r"\S+", text):
        ks = [tmap[x] for x in range(m.start(), m.end()) if tmap[x] is not None and text[x].isalnum()]
        if not ks:
            ks = [tmap[x] for x in range(m.start(), m.end()) if tmap[x] is not None]
        times.append((float(min(st[k] for k in ks)), float(max(en[k] for k in ks))) if ks else None)
    i = 0
    while i < len(times):  # words the timings missed share the time between their neighbours
        if times[i] is not None:
            i += 1
            continue
        j = i
        while j < len(times) and times[j] is None:
            j += 1
        a = times[i - 1][1] if i else (times[j][0] if j < len(times) else 0.0)
        b = times[j][0] if j < len(times) else a
        step = max(0.0, b - a) / (j - i)
        for x in range(i, j):
            times[x] = (a + step * (x - i), a + step * (x - i + 1))
        i = j
    return times  # type: ignore[return-value]


def block_words(b: Block, al: dict) -> list[dict]:
    """The shown words of a block with block-relative times. A word the voice said differently
    carries `spoken`; several spoken words under one shown word give it `syl` spans."""
    tt = spoken_times(b.spoken, al)
    words: list[dict | None] = [None] * len(b.tokens)
    k = 0
    for g in b.groups:
        t = tt[k:k + len(g.spoken)]
        k += len(g.spoken)
        if len(g.idx) == 1:
            w = {"w": b.tokens[g.idx[0]], "start": t[0][0], "end": t[-1][1]}
            if len(t) > 1:
                w["syl"] = [[x0, x1] for x0, x1 in t]
            if g.say:
                w["spoken"] = g.say
            words[g.idx[0]] = w
            continue
        # a several-word entry ("Opus 5.5" -> "Opus cinco ponto cinco"): words both spellings share map
        # one to one, the rest share the remaining time in proportion to their length
        D, S = g.idx, [bare(s) for s in g.spoken]
        p = 0
        while p < min(len(D), len(S)) and say_key(b.tokens[D[p]]) == say_key(S[p]):
            p += 1
        q = 0
        while q < min(len(D), len(S)) - p and say_key(b.tokens[D[-1 - q]]) == say_key(S[-1 - q]):
            q += 1
        for j in range(p):
            words[D[j]] = {"w": b.tokens[D[j]], "start": t[j][0], "end": t[j][1]}
        for j in range(q):
            words[D[-1 - j]] = {"w": b.tokens[D[-1 - j]], "start": t[-1 - j][0], "end": t[-1 - j][1]}
        midD, midT, midS = D[p:len(D) - q], t[p:len(t) - q], S[p:len(S) - q]
        if not midD:
            if midT:  # spoken words with no shown word of their own: the shown word before them carries them
                host = words[D[p - 1]] if p else words[D[len(D) - q]]
                host["start"], host["end"] = min(host["start"], midT[0][0]), max(host["end"], midT[-1][1])
                host["spoken"] = g.say
            continue
        if len(midD) == len(midT):
            for d, tm, s in zip(midD, midT, midS):
                w = {"w": b.tokens[d], "start": tm[0], "end": tm[1]}
                if say_key(s) != say_key(b.tokens[d]):
                    w["spoken"] = s
                words[d] = w
            continue
        if len(midD) == 1:  # one shown word said as several ("5.5" -> "five point five")
            w = {"w": b.tokens[midD[0]], "start": midT[0][0], "end": midT[-1][1], "spoken": " ".join(midS)}
            if len(midT) > 1:
                w["syl"] = [[x0, x1] for x0, x1 in midT]
            words[midD[0]] = w
            continue
        t0, t1 = midT[0][0], midT[-1][1]
        lens = [max(1, len(say_key(b.tokens[d]))) for d in midD]
        cum = np.cumsum([0] + lens) / sum(lens)
        for j, d in enumerate(midD):
            w = {"w": b.tokens[d], "start": t0 + (t1 - t0) * cum[j], "end": t0 + (t1 - t0) * cum[j + 1]}
            if j == 0:
                w["spoken"] = " ".join(midS)
            words[d] = w
    return attach_marks(words)  # type: ignore[arg-type]


def attach_marks(words: list[dict]) -> list[dict]:
    """A token with no letter or digit (a dash between spaces) is nothing anyone says: it joins the
    word before it ("P(doom) —"), or the one after when it opens the block. The line's text stays its
    words joined by spaces, findWords() finds the word as before, and no phrase edge is measured on
    the pause the API stretched the dash over."""
    out: list[dict] = []
    lead = ""
    for x in words:
        if not any(ch.isalnum() for ch in x["w"]):
            if out:
                out[-1]["w"] += " " + x["w"]
            else:
                lead += x["w"] + " "
            continue
        if lead:
            x, lead = {**x, "w": lead + x["w"]}, ""
        out.append(x)
    return out if out else words


# ---------------------------------------------------------------------------------------------
# The voice: Kokoro on the CPU


@contextlib.contextmanager
def quiet():
    """Kokoro's libraries print and warn as they load and run: their lines go to stderr (so --json output stays one
    object), and warnings meant for their developers (deprecations) are dropped."""
    with contextlib.redirect_stdout(sys.stderr), warnings.catch_warnings():
        warnings.simplefilter("ignore")
        logging.getLogger("phonemizer").setLevel(logging.ERROR)  # word-count notes: words are matched here (difflib)
        yield


def voice_file(voice: str) -> str:
    return f"voices/{voice}.pt"


def langs_text() -> str:
    return ", ".join(f"{k} {v[0]}" for k, v in LANGS.items())


def with_extra(extra: str, args: list[str]) -> str:
    """This run's command line with one of misaki's extras added for the run (uv run --with)."""
    return (f"uv run --with {q(f'misaki[{extra}]{EXTRA_PIN}')} "
            + " ".join(q(str(x)) for x in (script_path(), *args)))


def need_packages(lang: str, args: list[str]) -> None:
    """Kokoro and the reading of this language (text to phonemes), or what would make them work here."""
    from importlib.util import find_spec

    if find_spec("kokoro") is None:
        if sys.platform == "darwin" and platform.machine() == "x86_64":
            raise Fail(ERROR, "Kokoro needs PyTorch, which no longer ships for Intel Macs: run standin.py on Apple "
                              "Silicon, Windows or Linux, or go on with a silent placeholder (\"audio\": null and a "
                              "\"duration\" in video.json)")
        raise Fail(ERROR, f"kokoro is not installed in this Python: run standin.py through uv ({me(*args)}), which "
                          f"installs the packages listed at its top")
    if lang == "z" and any(find_spec(m) is None for m in ("jieba", "pypinyin", "cn2an", "ordered_set")):
        raise Fail(ERROR, f"Mandarin Chinese (z) is read by misaki's Chinese packages (pure Python), which this "
                          f"environment leaves out. Run it with them: {with_extra('zh', args)}")
    if lang == "j" and any(find_spec(m) is None for m in ("pyopenjtalk", "fugashi")):
        raise Fail(ERROR, f"Japanese (j) can't run here as installed: misaki reads it with pyopenjtalk, which ships "
                          f"only as source code and builds with CMake and a C++ compiler (on Windows, Visual Studio's "
                          f"C++ build tools), and with fugashi's UniDic dictionary (`python -m unidic download`). With "
                          f"those in place: {with_extra('ja', args)}")


ESPEAK_ROOM = 230 if sys.platform == "win32" else 160  # characters espeak-ng keeps of its data folder's path
#                                                      (N_PATH_HOME in its source)
ESPEAK_DEEPEST = 30  # characters its own files reach below that folder (voices/!v/..., lang/roa/pt-BR)
HF_DEEPEST = 130  # characters a Hugging Face cache's own files reach below it (a snapshot's voice: 98, a blob being
#                   downloaded: 111)


def long_way(p: Path) -> Path:
    """p written the long way on Windows while long paths are off, when the Hugging Face cache's own files would pass
    260 characters in it (a cache inside a deep project)."""
    if sys.platform == "win32" and len(os.path.abspath(p)) + HF_DEEPEST > 259 and not long_paths_on():
        return Path(verbatim(str(p)))
    return p


def snapshot_file(cache: Path, name: str) -> Path | None:
    """The pinned revision's file in a Hugging Face cache (models--<org>--<name>/snapshots/<revision>/<file>), or
    None. Looked up here: huggingface_hub joins a file's '/' onto the folder, which a long-way path refuses."""
    p = cache / f"models--{MODEL_REPO.replace('/', '--')}" / "snapshots" / MODEL_REVISION / Path(*name.split("/"))
    return p if p.is_file() else None


def long_path_fixes() -> None:
    """A package that joins a '/' onto its own folder breaks when the environment is imported the long way
    (long_path_imports, for a deep uv cache), since a long-way path takes no '/': language_tags (phonemizer ->
    segments -> csvw -> language_tags) reads its data from 'json/'. Its data module is loaded first, with the
    separator Windows takes; nothing changes for an environment imported the usual way."""
    from importlib.util import find_spec, module_from_spec, spec_from_file_location

    spec = find_spec("language_tags")
    if spec is None or not str(spec.origin or "").startswith("\\\\?\\") or "language_tags.data" in sys.modules:
        return
    d = os.path.join(os.path.dirname(spec.origin), "data")
    ds = spec_from_file_location("language_tags.data", os.path.join(d, "__init__.py"), submodule_search_locations=[d])
    if ds is None or ds.loader is None:
        return
    m = module_from_spec(ds)
    ds.loader.exec_module(m)
    if getattr(m, "data_dir", None) == "json/":
        m.data_dir = "json" + os.sep
    sys.modules["language_tags.data"] = m


def plain(p: Path) -> Path:
    """p as people write it (without the long way's prefix), for messages."""
    s = str(p)
    return Path("\\\\" + s[8:] if s.startswith("\\\\?\\UNC\\") else s[4:] if s.startswith("\\\\?\\") else s)


def model_files(root: Path, voice: str, fetch: bool) -> tuple[dict[str, Path | None], list[str]]:
    """The pinned revision's config.json, weights and voice: from the audara cache, else from the user's own Hugging
    Face cache when they are there already (read only), else, with `fetch`, downloaded into the audara cache.
    Returns each file (None: not cached anywhere) and the ones downloaded now."""
    for k in ("HF_HUB_DISABLE_PROGRESS_BARS", "HF_HUB_DISABLE_SYMLINKS_WARNING", "HF_HUB_DISABLE_TELEMETRY"):
        os.environ.setdefault(k, "1")  # (read when huggingface_hub is imported, just below)
    from huggingface_hub import constants, hf_hub_download

    own = root / "hf" / "hub"  # the layout beats.py and align.py use (HF_HOME = <cache>/hf)
    names = ("config.json", MODEL_FILE, voice_file(voice))
    files: dict[str, Path | None] = {}
    for name in names:
        files[name] = next((f for c in dict.fromkeys((long_way(own), long_way(Path(constants.HF_HUB_CACHE))))
                            if (f := snapshot_file(c, name)) is not None), None)
    fetched = [name for name in names if files[name] is None] if fetch else []
    if fetched:
        mb = MODEL_MB if MODEL_FILE in fetched else 0.5
        note(f"standin: downloading {', '.join(fetched)} of {MODEL_REPO} (about {mb} MB, once) into {plain(own)}")
    for name in fetched:
        try:
            files[name] = Path(hf_hub_download(MODEL_REPO, name, revision=MODEL_REVISION,
                                               cache_dir=str(long_way(own))))
        except Exception as e:  # the network, the disk, the Hub: nothing is made without the model
            raise Fail(ERROR, f"could not download {MODEL_REPO}/{name} ({type(e).__name__}: {str(e)[:200]}): check the "
                              f"network, then run the same command again (finished blocks are kept)")
    return files, fetched


def versions() -> dict:
    """The packages that made a block, for its record (a later version may say the same text a little differently)."""
    from importlib import metadata

    found = {}
    for p in ("kokoro", "misaki", "torch", "transformers", "spacy", "en-core-web-sm", "espeakng-loader",
              "phonemizer-fork"):
        try:
            found[p] = metadata.version(p)
        except metadata.PackageNotFoundError:
            pass
    return found


Part = tuple[str, list[tuple[str, str]], list[int | None], set[int]]  # see english_parts


def english_parts(pipe, text: str) -> list[Part]:
    """misaki's English reading of a paragraph: spaCy's words and marks, each with its phonemes, split where Kokoro's
    own pipeline splits a long text (at punctuation, CONTEXT phonemes at most). Per part: its phonemes, its tokens
    (text, whitespace after), the token each phoneme belongs to (None: a space) and the tokens with no phonemes
    (misaki could not read them: nothing is said for them)."""
    _, tokens = pipe.g2p(text)
    parts = []
    for _, _, tks in pipe.en_tokenize(tokens):
        ps, owner = "", []
        for k, t in enumerate(tks):
            ph = t.phonemes or ""
            ps += ph + (" " if t.whitespace else "")
            owner += [k] * len(ph) + ([None] if t.whitespace else [])
        cut = len(ps) - len(ps.lstrip())
        ps = ps.strip()
        parts.append((ps, [(t.text, t.whitespace) for t in tks], owner[cut:cut + len(ps)],
                      {k for k, t in enumerate(tks) if not t.phonemes}))
    return parts


def context_parts(g2p, text: str) -> list[Part]:
    """Any other language: the paragraph's words (split at spaces, as eleven.py splits them) read in sentences, the
    way Kokoro's own pipeline reads them (grouped up to CHUNK_CHARS characters, CONTEXT phonemes at most), so each word
    is said in its context. Each word read alone says how many phoneme words it makes ("2026" makes five), so the
    sentence's phoneme words are dealt out in that order, whatever a word sounds like in context ("e" alone is the
    letter, "i" in a sentence); when espeak-ng joined or split words in context, the letters are matched instead
    (difflib) and a word left unmatched gets the time between its neighbours. The same parts as english_parts."""
    words = text.split()
    alone = [g2p(wd)[0] for wd in words]
    sentences, cur = [], []
    for k, wd in enumerate(words):
        cur.append(k)
        if SENTENCE_END.search(wd):
            sentences.append(cur)
            cur = []
    if cur:
        sentences.append(cur)
    chunks: list[list[int]] = []
    for s in sentences:
        if chunks and len(" ".join(words[i] for i in chunks[-1] + s)) <= CHUNK_CHARS:
            chunks[-1] += s
        else:
            chunks.append(s)
    parts: list[Part] = []

    def read(ks: list[int]) -> None:
        ps = g2p(" ".join(words[i] for i in ks))[0]
        if len(ps) > CONTEXT and len(ks) > 1:  # too long at once: split at the comma nearest the middle, else there
            at = [j for j in range(1, len(ks))
                  if words[ks[j - 1]].rstrip("\"'”’)»").endswith((",", ";", ":", "—"))]
            j = min(at, key=lambda j: abs(j - len(ks) / 2)) if at else len(ks) // 2
            read(ks[:j])
            read(ks[j:])
            return
        owner: list[int | None] = [None] * len(ps)
        pws = [(m.start(), m.end()) for m in re.finditer(r"\S+", ps)]
        counts = [len(alone[i].split()) for i in ks]
        if sum(counts) == len(pws):  # word for word
            j = 0
            for t, c in enumerate(counts):
                for a0, b0 in pws[j:j + c]:
                    owner[a0:b0] = [t] * (b0 - a0)
                j += c
        else:
            joined, own = "", []
            for t, i in enumerate(ks):
                if own:
                    joined += " "
                    own.append(None)
                joined += alone[i]
                own += [t] * len(alone[i])
            for a0, b0, size in SequenceMatcher(None, ps, joined, autojunk=False).get_matching_blocks():
                owner[a0:a0 + size] = own[b0:b0 + size]
        parts.append((ps, [(words[i], " " if i < len(words) - 1 else "") for i in ks], owner,
                      {t for t, i in enumerate(ks) if not alone[i].strip()}))

    for ks in chunks:
        read(ks)
    return parts


def espeak_copies(root: Path) -> list[Path]:
    """Where espeak_data may have put a short copy of espeak-ng's data (the audara cache, else the temp folder)."""
    try:
        from importlib import metadata

        name = f"espeak-ng-data-{metadata.version('espeakng-loader')}"
    except Exception:  # (no espeakng-loader: no copy)
        return []
    return [base / name for base in (root, Path(tempfile.gettempdir()))]


def espeak_data(root: Path) -> None:
    """espeak-ng (misaki's reader for most languages, and English's fallback for words it doesn't know) keeps its data
    folder's path in ESPEAK_ROOM characters: from a uv environment that lies deep it can't find its data, and then it
    ends the whole process. Its data (19 MB) is then copied once to a short folder and read from there."""
    import espeakng_loader
    from phonemizer.backend.espeak.wrapper import EspeakWrapper

    src = Path(espeakng_loader.get_data_path())
    if len(str(src)) + ESPEAK_DEEPEST < ESPEAK_ROOM:
        return
    for dst in espeak_copies(root):
        if len(str(dst)) + ESPEAK_DEEPEST >= ESPEAK_ROOM:
            continue
        if not (dst / "phontab").is_file():
            tmp = dst.with_name(f"{dst.name}.tmp-{os.getpid()}")
            try:
                shutil.rmtree(tmp, ignore_errors=True)
                shutil.copytree(verbatim(str(src)) if sys.platform == "win32" else src, tmp)
                if not (dst / "phontab").is_file():  # (another run may have finished the same copy meanwhile)
                    os.replace(tmp, dst)
            except OSError:
                continue
            finally:
                shutil.rmtree(tmp, ignore_errors=True)
            note(f"standin: espeak-ng's data copied to {dst} (19 MB): its path in uv's environment is longer than "
                 f"espeak-ng reads")
        EspeakWrapper.set_data_path(str(dst))
        return
    raise Fail(ERROR, f"espeak-ng can't read its data at {plain(src)} ({len(str(src))} characters; it reads "
                      f"{ESPEAK_ROOM}), and no short folder could hold a copy: set UV_CACHE_DIR to a short folder "
                      f"(such as C:\\uvc), then run again")


class Kokoro:
    """Kokoro-82M on the CPU, loaded once and only when a block is to be made (a run with nothing to make never
    imports torch)."""

    def __init__(self, voice: str, lang: str, files: dict[str, Path], root: Path):
        note(f"standin: loading {MODEL_NAME} with voice {voice} ({LANGS[lang][0]})")
        long_path_fixes()
        with quiet():
            import torch
            from kokoro import KModel, KPipeline

            self.torch, self.infer = torch, KPipeline.infer
            self.model = KModel(repo_id=MODEL_REPO, config=str(files["config.json"]),
                                model=str(files[MODEL_FILE])).eval()
            self.pack = torch.load(str(files[voice_file(voice)]), weights_only=True)
            espeak_data(root)  # (before the pipeline starts espeak-ng)
            try:
                self.pipe = KPipeline(lang_code=lang, repo_id=MODEL_REPO, model=False)
            except Exception as e:  # espeak-ng (bundled by espeakng-loader) or a G2P package that would not start
                raise Fail(ERROR, f"{LANGS[lang][0]} ({lang}) is read by {LANGS[lang][2]}, which did not start here: "
                                  f"{type(e).__name__}: {str(e)[:300]}")
        self.lang = lang

    def say(self, text: str, speed: float, seed: int) -> tuple[np.ndarray, dict, list[str], list[str]]:
        """One block: its audio; its word timings as ElevenLabs' alignment (each character of the text with its
        word's time, which block_words reads exactly as eleven.py does); the phonemes of each part; the words
        Kokoro gave no sound (they get the time between their neighbours)."""
        with quiet():
            parts = english_parts(self.pipe, text) if self.lang in ("a", "b") else context_parts(self.pipe.g2p, text)
        self.torch.manual_seed(seed)  # the decoder adds noise: seeded, the same request gives the same audio (to
        #                               one 16-bit step: the CPU's arithmetic can differ that much between runs)
        ys, chars, st, en, unsaid, t0 = [], [], [], [], [], 0.0
        vocab = self.model.vocab
        for ps, tokens, owner, silent in parts:
            prev = t0
            if len(ps) > CONTEXT:
                raise Fail(USAGE, f"a sentence of {len(ps)} phonemes, more than {MODEL_NAME} reads at once "
                                  f"({CONTEXT}): split it with a comma or a full stop ('{text[:60]}...')")
            first: list[int | None] = [None] * len(tokens)
            last: list[int | None] = [None] * len(tokens)
            cum = np.zeros(1)
            if ps:
                with quiet():
                    o = self.infer(self.model, ps, self.pack, speed)
                y = o.audio.numpy().astype(np.float32).reshape(-1)
                steps = o.pred_dur.numpy().astype(np.int64).reshape(-1)
                cum = np.concatenate([[0], np.cumsum(steps)]) * FRAME / SR
                k = 0  # the input position of each phoneme Kokoro reads (0 is its start token; characters outside
                for ch, tk in zip(ps, owner):  # its vocabulary are skipped, as KModel skips them)
                    if vocab.get(ch) is None:
                        continue
                    k += 1
                    if tk is not None and ch not in PAUSE_PHONEMES:
                        first[tk] = k if first[tk] is None else first[tk]
                        last[tk] = k
                if k + 2 != len(steps):
                    raise Fail(ERROR, f"{MODEL_NAME} gave {len(steps)} durations for {k} phonemes: this kokoro version "
                                      f"reads phonemes differently; pin kokoro to 0.9.4 in standin.py's header")
                ys.append(y)
            for t, ((word, space), f, l) in enumerate(zip(tokens, first, last)):
                if f is not None:
                    a0 = max(0.0, t0 + float(cum[f]) - SOUND_LEAD_S)
                    a1 = prev = max(a0 + 0.001, t0 + float(cum[l + 1]) - SOUND_LEAD_S)
                elif any(ch.isalnum() for ch in word):  # a word with no phonemes (nothing said), or none matched: left
                    if t in silent:  # out, so that block_words places it between its neighbours
                        unsaid.append(word)
                    continue
                else:  # a mark: its pause is no word's
                    a0 = a1 = prev
                chars += list(word + space)
                st += [a0] * len(word) + [a1] * len(space)
                en += [a1] * (len(word) + len(space))
            t0 += len(ys[-1]) / SR if ps else 0.0
        if not ys:
            raise Fail(USAGE, f"{MODEL_NAME} found nothing to say in '{text[:60]}'")
        al = {"characters": chars, "character_start_times_seconds": [round(x, 4) for x in st],
              "character_end_times_seconds": [round(x, 4) for x in en]}
        return np.concatenate(ys), al, [p[0] for p in parts], unsaid


# ---------------------------------------------------------------------------------------------
# standin


TTS_SIDES = (".request.json", ".alignment.json")  # the files beside each block, named as eleven.py's


def pick_voice(a, cfg: dict) -> tuple[str, str]:
    """The voice and its language: the flags, else what this narration was made with, else af_heart. A language
    alone picks its default voice; a voice alone speaks its own language (its first letter)."""
    lang = None
    if a.lang:
        lang = LANG_ALIASES.get(a.lang.strip().lower(), a.lang.strip().lower())
        if lang not in LANGS:
            raise Fail(USAGE, f"--lang {a.lang}: {MODEL_NAME} speaks {langs_text()}")
    kept = cfg.get("voice") if cfg.get("voice") in VOICES else None
    voice = a.voice or (kept if kept and (lang is None or kept[0] == lang) else None) \
        or (LANGS[lang][1] if lang else DEFAULT_VOICE)
    if voice not in VOICES:
        same = [v for v in VOICES if v[0] == voice[:1]]
        raise Fail(USAGE, f"--voice {voice}: not a {MODEL_NAME} voice. "
                          + (f"Its {LANGS[voice[0]][0]} voices: {', '.join(same)}" if same and voice[0] in LANGS else
                             "Its default voice per language: "
                             + ", ".join(f"{v[1]} ({v[0]})" for v in LANGS.values())))
    if lang is None:
        lang = cfg.get("lang") if voice == kept and cfg.get("lang") in LANGS else voice[0]
    return voice, lang


def standin_flags(a) -> list[str]:
    """This run's flags, so a command it suggests repeats them."""
    f: list[str] = []
    for flag, v in (("--voice", a.voice), ("--lang", a.lang), ("--speed", a.speed), ("--seed", a.seed),
                    ("--gap", a.gap), ("--lead", a.lead), ("--tail", a.tail)):
        if v is not None:
            f += [flag, f"{v:g}" if isinstance(v, float) else str(v)]
    for s in a.say or []:
        f += ["--say", s]
    if a.lufs is not None:
        f += ["--lufs", a.lufs if isinstance(a.lufs, str) else f"{a.lufs:g}"]
    if a.snap is not None:
        f.append("--snap" if a.snap else "--no-snap")
    return f


def guard(w: Where, cfg: dict, args: list[str], script: str) -> None:
    """standin.py writes audio/narration.wav and data/words.json only over its own: never over eleven.py's paid
    narration (its request records carry no standin: true), a recording, or another tool's word timings."""
    wav, words = w.audio_dir / "narration.wav", w.data_dir / "words.json"
    try:
        doc = json.loads(words.read_text(encoding="utf-8-sig")) if words.is_file() else None
    except (ValueError, UnicodeDecodeError):
        doc = "unreadable"
    src = doc.get("source") if isinstance(doc, dict) and isinstance(doc.get("source"), dict) else {}
    words_mine = doc is None or (sha256_file(words) == cfg.get("words_sha256")
                                 or (src.get("tool") == TOOL and src.get("standin") is True))
    wav_sha = sha256_file(wav) if wav.is_file() else None
    wav_mine = wav_sha is None or wav_sha == cfg.get("narration_sha256") or (
        doc is not None and words_mine and isinstance(doc, dict) and doc.get("audioSha256") == wav_sha)
    foreign = [p for p, mine in ((wav, wav_mine), (words, words_mine)) if not mine]
    if not foreign:
        return
    ndir = w.audio_dir / "narration"
    paid = [r for r in (read_json(p) or {} for p in sorted(ndir.glob("*.request.json")))
            if r.get("kind") == "tts" and not r.get("standin")]
    prov = doc.get("provenance") if isinstance(doc, dict) and isinstance(doc.get("provenance"), dict) else {}
    names = " and ".join(rel(p) for p in foreign)
    it = "it" if len(foreign) == 1 else "them"
    if str(prov.get("tool", "")).startswith("align.py"):
        what = (f"{'a recording and ' if wav in foreign else ''}word timings {prov.get('tool')} made (of a recording or "
                f"a song), so standin.py leaves {it} alone")
    elif paid or src.get("tool") == "eleven.py":
        what = (f"eleven.py's narration (its request records in {rel(ndir)}/ have no standin: true): paid for, so "
                f"standin.py leaves {it} alone")
    else:
        what = f"not standin.py's (a recording, or files from elsewhere), so standin.py leaves {it} alone"
    keep = me(script, "--out", rel(w.review_dir / "standin"), *args)
    raise Fail(USAGE, f"{names} {'is' if len(foreign) == 1 else 'are'} {what}. To keep both, make the stand-in in a "
                      f"folder of its own: {keep} (the video keeps what it plays now). To put the stand-in in "
                      f"{'its' if len(foreign) == 1 else 'their'} place, move {names} aside first; moving {it} back "
                      f"restores {it}.", {"status": "refused", "in_the_way": [rel(p) for p in foreign]})


def take_words(path: Path, b: Block) -> tuple[list[dict], np.ndarray]:
    rec = read_json(side(path, ".alignment.json")) or {}
    al = rec.get("alignment")
    if not al:
        raise Fail(ERROR, f"{rel(path)} has no word timings (its .alignment.json is missing or empty): delete it with "
                          f"its .request.json to make it again")
    return block_words(b, al), decode(path)


def tidy(out: Out, sdir: Path, paths: list[Path]) -> None:
    """Block files no paragraph uses any more (renumbered or deleted paragraphs): free to make again, so removed.
    Files standin.py did not make stay."""
    current = {p.name for p in paths}
    gone = []
    for f in sorted(sdir.glob("*.wav")) if sdir.is_dir() else []:
        if f.name in current:
            continue
        try:
            rec = json.loads(side(f, ".request.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not (isinstance(rec, dict) and rec.get("standin") and rec.get("tool") == TOOL):
            continue
        try:
            for s in ("",) + TTS_SIDES:
                (f if not s else side(f, s)).unlink(missing_ok=True)
            gone.append(f.name)
        except OSError as e:  # a file held open stays where it is; nothing depends on it
            out(f"Left in place (could not remove it: {e.strerror or e}): {f.name}")
    if gone:
        out(f"Removed block files no paragraph uses any more: {', '.join(gone)}")


def cmd_standin(a, out: Out) -> None:
    tool("ffmpeg")  # checked first: every run ends by decoding and measuring what it made
    w = where(a.video, a.out, [a.script])
    flags = standin_flags(a)
    script = find_input(a.script, w, "", "script")
    paras = read_script(script)
    if not paras:
        raise Fail(USAGE, f"{rel(script)} has no text: write the narration as paragraphs separated by blank lines")
    sdir = w.audio_dir / "standin"
    cfg_path = sdir / "standin.json"
    cfg = read_json(cfg_path) or {}
    voice, lang = pick_voice(a, cfg)
    speed = a.speed if a.speed is not None else float(cfg.get("speed", 1.0))
    seed = a.seed if a.seed is not None else int(cfg.get("seed", 1))
    gap = a.gap if a.gap is not None else float(cfg.get("gap", GAP))
    lead = a.lead if a.lead is not None else float(cfg.get("lead", LEAD))
    tail = a.tail if a.tail is not None else float(cfg.get("tail", TAIL))
    snap_on = a.snap if a.snap is not None else bool(cfg.get("snap", True))
    lufs = cfg.get("lufs", LUFS) if a.lufs is None else (None if a.lufs == "native" else float(a.lufs))
    for nm, v in (("--gap", gap), ("--lead", lead), ("--tail", tail)):
        if not 0 <= v <= 30:
            raise Fail(USAGE, f"{nm} {v}: seconds between 0 and 30")
    if not 0.5 <= speed <= 2.0:
        raise Fail(USAGE, f"--speed {speed:g}: from 0.5 to 2 (1 is the voice's own pace)")
    say_items = a.say if a.say is not None else list(cfg.get("say") or [])
    entries, say_keep = read_say(say_items, w)
    blocks: list[Block] = []
    width = max(2, len(str(len(paras))))
    for n, (para, chapter) in enumerate(paras, 1):
        toks, groups = respell(para, entries)
        blocks.append(Block(n, width, para, toks, groups, chapter))
    for b in blocks:  # (marks alone, a '---' rule in a .md: no word for words.json to time)
        if not any(ch.isalnum() for ch in b.display):
            raise Fail(USAGE, f"paragraph {b.n} ('{b.display[:60]}') has no word to say: remove it, or join it to the "
                              f"paragraph next to it")
    used = {k for b in blocks for k in b.said}
    unused = [" ".join(e.shown) for e in entries if " ".join(e.shown) not in used]
    guard(w, cfg, flags, rel(script))  # before anything is made (the script as found: --out looks for it from here)
    root, _ = cache_root(w)
    before = snapshot(w, sdir)  # (the summary ends with what this run wrote)

    def req(b: Block) -> dict:
        return {"model": MODEL_REPO, "revision": MODEL_REVISION, "voice": voice, "lang": lang, "speed": speed,
                "seed": seed, "text": b.spoken}

    def main_path(b: Block) -> Path:
        return sdir / f"{b.name}.wav"

    def key(r: dict) -> str:
        return json.dumps(r, sort_keys=True, ensure_ascii=False)

    def state(b: Block) -> str:
        """'' when the block's file is this request's, else why it is made."""
        path = main_path(b)
        if not path.is_file():
            return "new"
        rec = read_json(side(path, ".request.json")) or {}
        if not rec.get("standin") or not isinstance(rec.get("request"), dict):
            return "no request record"
        if not side(path, ".alignment.json").is_file():
            return "timings missing"
        if key(rec["request"]) != key(req(b)):
            return "text changed" if rec["request"].get("text") != b.spoken else "voice or settings changed"
        return ""

    jobs = [(b, main_path(b), why) for b in blocks if (why := state(b))]
    # a request already made under another name (a renumbered paragraph): copied, not made again
    index = {}
    for rp in sorted(sdir.glob("*.request.json")) if sdir.is_dir() else []:
        rec = read_json(rp) or {}
        src = rp.with_name(rp.name.replace(".request.json", ".wav"))
        if rec.get("standin") and isinstance(rec.get("request"), dict) and src.is_file() and \
                side(src, ".alignment.json").is_file():
            index.setdefault(key(rec["request"]), src)
    reuse = [(index[key(req(b))], path, b) for b, path, _ in jobs
             if key(req(b)) in index and index[key(req(b))] != path]
    copies = [(src.read_bytes(), {s: side(src, s).read_bytes() for s in TTS_SIDES}, path, b, src)
              for src, path, b in reuse]
    for data, sides_, path, b, src in copies:  # (read first: two blocks may trade names)
        write_bytes(side(path, ".alignment.json"), sides_[".alignment.json"])
        write_bytes(path, data)
        rec = json.loads(sides_[".request.json"])
        rec.update({"block": b.n, "copied_from": src.name})
        write_json(side(path, ".request.json"), rec)
        out(f"block {b.n}: same request as {rel(src)} (copied, not made again)")
    jobs = [(b, path, why) for b, path, why in jobs if path not in {p for _, p, _ in reuse}]

    args = [a.script, *place_args(a), *flags]  # this run, for the commands it suggests
    made: list[int] = []
    if jobs:
        need_packages(lang, args)
        files, fetched = model_files(root, voice, fetch=True)
        t_start = time.time()
        kok = Kokoro(voice, lang, files, root)  # type: ignore[arg-type]
        pkgs = versions()
        for i, (b, path, why) in enumerate(jobs, 1):
            note(f"standin: block {b.n} ({i}/{len(jobs)}, {len(b.spoken)} characters, {why})")
            y, al, phonemes, unsaid = kok.say(b.spoken, speed, seed)
            data = wav_bytes(to_pcm16(y))
            write_json(side(path, ".alignment.json"), {
                "alignment": al, "phonemes": phonemes, "unsaid": unsaid or None,
                "notes": f"Word times from {MODEL_NAME}'s predicted phoneme durations (25 ms steps), each word placed "
                         f"{SOUND_LEAD_S * 1000:.0f} ms before its first phoneme's step, where its sound starts; marks "
                         f"and spaces are no word's time. Every character of the text carries its word's span "
                         f"(ElevenLabs' alignment form, read by eleven.py's block_words)."})
            write_bytes(path, data)
            write_json(side(path, ".request.json"), {  # last: a block is done once its record is there
                "kind": "standin", "standin": True, "request": req(b), "shown_text": b.display,
                "say": b.said or None, "block": b.n, "voice_language": LANGS[voice[0]][0],
                "license": LICENSE, "commercial_use": True,
                "license_line": LICENSE_LINE.format(model=MODEL_NAME, voice=voice, license=LICENSE),
                "credit": CC_BY.get(voice), "generated": now(), "tool": TOOL, "packages": pkgs, "phonemes": phonemes,
                "output": {"audio_sha256": sha256_bytes(data), "sample_rate": SR, "seconds": r3(len(y) / SR)}})
            made.append(b.n)
        out(f"Made {len(made)} block{'s' if len(made) != 1 else ''} ({num(sum(len(b.spoken) for b, *_ in jobs))} "
            f"characters) with {MODEL_NAME} {voice} in {time.time() - t_start:.0f} s on the CPU.")
    else:
        files, fetched = model_files(root, voice, fetch=False)
    tidy(out, sdir, [main_path(b) for b in blocks])
    if unused:
        out(f"Say map entries not found in the script: {', '.join(unused)}.")

    def cfg_doc(words_sha: str | None, wav_sha: str | None) -> dict:
        return {"voice": voice, "lang": lang, "speed": speed, "seed": seed, "say": say_keep, "gap": gap, "lead": lead,
                "tail": tail, "snap": snap_on, "lufs": lufs, "script": rel_to(script, w.base),
                "words_sha256": words_sha, "narration_sha256": wav_sha,
                "notes": "Settings of this stand-in narration, kept by standin.py: every block uses the same ones, and "
                         "flags change them. words_sha256 and narration_sha256 are the files standin.py last wrote: "
                         "it writes over those alone, and a words.json edited since is kept while nothing it is made "
                         "from changes."}

    write_json(cfg_path, cfg_doc(cfg.get("words_sha256"), cfg.get("narration_sha256")))  # the settings, first
    paths = [main_path(b) for b in blocks]
    words_sha, wav_sha = assemble(out, w, script, blocks, paths, voice, lang, speed, seed, gap, lead, tail, snap_on,
                                  lufs, cfg.get("words_sha256"))
    write_json(cfg_path, cfg_doc(words_sha, wav_sha))

    out(f"Settings: voice {voice} ({LANGS[voice[0]][0]}"
        + (f", reading {LANGS[lang][0]}: expect its accent" if voice[0] != lang else "")
        + f"), speed {speed:g}, seed {seed}; gap {gap:g} s, lead {lead:g} s, tail {tail:g} s (kept in "
          f"{rel(cfg_path)}).")
    line = LICENSE_LINE.format(model=MODEL_NAME, voice=voice, license=LICENSE)
    out(line + "." + (f" The model card credits {CC_BY[voice]} for this voice's training audio." if voice in CC_BY
                      else ""))
    tts = [a.script, *place_args(a), "--voice", "VOICE_ID"]
    for flag, v, d in (("--gap", gap, GAP), ("--lead", lead, LEAD), ("--tail", tail, TAIL)):
        if v != d:
            tts += [flag, f"{v:g}"]
    tts += [x for s in say_keep for x in ("--say", s)]
    if lufs != LUFS:
        tts += ["--lufs", "native" if lufs is None else f"{lufs:g}"]
    if not snap_on:
        tts.append("--no-snap")
    out(f"  the final voice, once there is a key: uv run {q(script_path('eleven.py'))} tts "
        + " ".join(q(str(x)) for x in tts) + " (prints what it costs; spends nothing without --yes)")
    report_cache(out, root, files, fetched)
    place = ["--video", w.name] if w.name else (["--out", rel(w.base)] if rel(w.base) != "." else [])
    wav_path, words_path = w.audio_dir / "narration.wav", w.data_dir / "words.json"
    if Path(__file__).resolve().with_name("align.py").is_file():
        out(f"Review image of the words over the waveform: uv run {q(script_path('align.py'))} check {q(rel(wav_path))}"
            + ("" if w.name else f" --words {q(rel(words_path))}") + "".join(f" {q(x)}" for x in place))
    ears = ("every block (all made just now)" if made and len(made) == len(blocks) else
            f"block{'s' if len(made) > 1 else ''} {', '.join(map(str, made))} (made just now) and any other block "
            f"nobody has heard" if made else "the blocks nobody has heard")
    names = list(dict.fromkeys(x for b in blocks for x in names_to_hear(b)))
    out(f"Not checked yet: by ear, {ears}; listen for "
        + (f"the names ({', '.join(names)}), " if names else "")
        + "numbers and abbreviations, which a stand-in may say oddly (--say 'shown=spoken' respells them).")
    if w.video_dir is not None:
        out(f"Preview with it: \"audio\": \"audio/narration.wav\" in {rel(w.video_dir / 'video.json')} (or mix.py's mix).")
    out.data.update({
        "voice": {"model": MODEL_NAME, "repo": MODEL_REPO, "revision": MODEL_REVISION, "voice": voice, "lang": lang,
                  "language": LANGS[lang][0], "license": LICENSE, "commercial_use": True, "standin": True,
                  "line": line, "credit": CC_BY.get(voice)},
        "settings": {"voice": voice, "lang": lang, "speed": speed, "seed": seed, "gap": gap, "lead": lead, "tail": tail,
                     "snap": snap_on, "lufs": lufs, "say": say_keep},
        "made": made, "settings_file": rel(cfg_path), "names": names,
    })
    report_wrote(out, before, snapshot(w, sdir))


def assemble(out: Out, w: Where, script: Path, blocks: list[Block], paths: list[Path], voice: str, lang: str,
             speed: float, seed: int, gap: float, lead: float, tail: float, snap_on: bool, lufs: float | None,
             words_sha_prev: str | None) -> tuple[str | None, str]:
    """narration.wav and words.json from the blocks: placed, levelled, measured and snapped by eleven.py tts's own
    steps (its assemble_narration), at Kokoro's 24 kHz. Returns the sha256 of the words.json this script wrote (kept
    from before when the file on disk was edited and nothing it is made from changed) and of narration.wav."""
    ys, blk_words, ons, offs = [], [], [], []
    for b, p in zip(blocks, paths):
        words, y = take_words(p, b)
        snd = analyze(y, SR)
        if snd.first_on is None:
            raise Fail(ERROR, f"{rel(p)} is silent: delete it to make it again")
        ys.append(y)
        blk_words.append(words)
        ons.append(snd.first_on)
        offs.append(snd.last_off)
    # place the blocks: block i's first sound starts `gap` after block i-1's last sound; each is trimmed
    # to its sound plus a little air (PAD_BEFORE/PAD_AFTER), so the gap is the silence actually heard
    segs, t_on, off_abs = [], lead, lead
    for y, on, off in zip(ys, ons, offs):
        ts, te = max(0.0, on - PAD_BEFORE), min(len(y) / SR, off + PAD_AFTER)
        s0, s1 = int(round(ts * SR)), int(round(te * SR))
        at = max(0, int(round(t_on * SR)) - (int(round(on * SR)) - s0))
        segs.append((at, s0, s1))
        off_abs = (at + int(round(off * SR)) - s0) / SR
        t_on = off_abs + gap
    n = max(int(round((off_abs + tail) * SR)), max(at + s1 - s0 for at, s0, s1 in segs))
    mix = np.zeros(n, np.float32)
    f = int(0.005 * SR)
    ramp = (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, f))).astype(np.float32)
    for (at, s0, s1), y in zip(segs, ys):
        seg = y[s0:s1].copy()
        if len(seg) > 2 * f:  # 5 ms fades: the cuts sit in silence, this keeps them click-free regardless
            seg[:f] *= ramp
            seg[-f:] *= ramp[::-1]
        mix[at:at + len(seg)] += seg
    # level: the stem plays at a calm piece's loudness in the preview; mix.py sets the final balance. One linear gain,
    # toward `lufs` as measured on two speakers, never past the true-peak ceiling
    gain_db, capped = 0.0, False
    if lufs is not None:
        m = loudness(y=mix)
        if math.isfinite(m["I"]):
            gain_db = lufs - m["I"]
            if m["TP"] + gain_db > TP_MAX:
                gain_db, capped = TP_MAX - m["TP"], True
            mix *= np.float32(10 ** (gain_db / 20))
    peak_t = float(np.argmax(np.abs(mix))) / SR  # where the loudest sample is (what the ceiling holds)
    wav_path = w.audio_dir / "narration.wav"
    pcm = to_pcm16(mix)
    data = wav_bytes(pcm)
    asha = sha256_bytes(data)
    y_out = pcm.astype(np.float32) / 32768.0  # the samples in the file, as ffmpeg (and align.py) decode them

    # words on the narration's timeline, then every phrase edge measured on the file's samples
    lines = []
    for li, (b, words, (at, s0, s1)) in enumerate(zip(blocks, blk_words, segs)):
        off = (at - s0) / SR
        ws2 = []
        for x in words:
            x = dict(x)
            x["start"], x["end"] = x["start"] + off, x["end"] + off
            if "syl" in x:
                x["syl"] = [[s + off, e + off] for s, e in x["syl"]]
            ws2.append(x)
        line = {"i": li, "text": " ".join(b.tokens), "start": 0.0, "end": 0.0, "words": ws2, "block": b.n,
                "file": rel_to(paths[li], w.video_dir or w.base)}
        if b.chapter:
            line["chapter"] = b.chapter
        lines.append(line)
    snd = analyze(y_out, SR)
    ws: list[W] = []
    for li, l in enumerate(lines):
        for x in l["words"]:
            ws.append(W(len(ws), x["w"], x["start"], x["end"], li, x))
    rep = match(ws, snd)
    before = edge_stats(rep.edges)
    moved = len(snap(ws, rep)) if snap_on and rep.edges else 0
    for wd in ws:  # round, keep every word positive and its syllables inside it
        wd.ref["start"], wd.ref["end"] = r3(max(0.0, wd.start)), r3(max(wd.end, wd.start + 0.001))
        fit_syl(wd.ref)
    for l in lines:
        l["start"], l["end"] = l["words"][0]["start"], l["words"][-1]["end"]
    after = None
    if snap_on and rep.edges:
        ws_after = [W(x.i, x.text, x.ref["start"], x.ref["end"], x.line, x.ref) for x in ws]
        after = edge_stats(match(ws_after, snd).edges)
    problems = check_lines(lines, n / SR)
    if problems:
        raise Fail(ERROR, "internal check of words.json failed: " + "; ".join(problems[:5]))

    total = n / SR
    sil = []  # the silence heard between blocks: the longest quiet run around each join, on the file
    for i in range(len(blocks) - 1):
        a0 = (segs[i][0] + int(round(offs[i] * SR)) - segs[i][1]) / SR
        b0 = (segs[i + 1][0] + int(round(ons[i + 1] * SR)) - segs[i + 1][1]) / SR
        k0, k1 = np.searchsorted(snd.t, a0 - 0.1), np.searchsorted(snd.t, b0 + 0.1)
        sil.append(max((b - a for a, b in runs(snd.db[k0:k1] <= snd.thr)), default=0) * HOP_S)
    unsaid = [(b.n, x) for b, p in zip(blocks, paths)
              for x in (read_json(side(p, ".alignment.json")) or {}).get("unsaid") or []]
    words_doc = {
        "lines": lines,
        "notes": (f"Stand-in narration by {MODEL_NAME}, a local open voice ({LICENSE}: commercial use allowed), voice "
                  f"{voice}, made by standin.py: cues that find words by their text, not copied times, keep their sync "
                  f"when eleven.py tts replaces it. One line per paragraph (block) of {script.name}, in order; each block "
                  f"is one synthesis, and the blocks follow one another with {gap:g} s of silence between them, so the "
                  f"picture can cut there. Times are seconds on audio/narration.wav: t = 0 is its first sample, as "
                  f"browsers and ffmpeg play it: never shift these times; no offset is needed. w is the word as shown; "
                  f"spoken is what the voice said when the say map respelled it (find words by w). Word times come "
                  f"from {MODEL_NAME}'s predicted phoneme durations (25 ms steps, each word "
                  f"{SOUND_LEAD_S * 1000:.0f} ms before its first step, where its sound starts); phrase edges (words "
                  f"next to a pause of 150 ms or more) were measured against the waveform: "
                  f"{edge_line(before, 'before snapping' if snap_on else '')}"
                  + ("; snapped: those edges now sit on the measured sound." if snap_on and rep.edges else
                     "; not snapped (--no-snap)." if rep.edges else ".")),
        "audioSha256": asha,
        "source": {"kind": "narration", "tool": TOOL, "standin": True, "audio": "audio/narration.wav",
                   "duration": r3(total), "model": MODEL_REPO, "revision": MODEL_REVISION, "voice": voice, "lang": lang,
                   "license": LICENSE, "speed": speed, "seed": seed, "gap": gap, "lead": lead, "tail": tail,
                   "snap": snap_on, "blocks": [rel_to(p, w.video_dir or w.base) for p in paths]},
    }
    # words.json: an edit made since this script last wrote it (a hand fix) is kept while nothing it is made
    # from changes; when something did, the edited copy goes to the review folder and the new one replaces it
    words_path = w.data_dir / "words.json"
    new_bytes = (json.dumps(words_doc, ensure_ascii=False, indent=1) + "\n").encode("utf-8")
    new_sha = sha256_bytes(new_bytes)
    disk = words_path.read_bytes() if words_path.is_file() else None
    disk_sha = sha256_bytes(disk) if disk is not None else None
    edited = disk is not None and words_sha_prev is not None and disk_sha not in (words_sha_prev, new_sha)
    kept_copy = None
    if edited and new_sha == words_sha_prev:
        words_state, written_sha = "kept", words_sha_prev
    else:
        if edited:
            kept_copy = w.review_dir / f"words.edited-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
            write_bytes(kept_copy, disk)
        words_state = "unchanged" if disk_sha == new_sha else ("written" if disk is None else "updated")
        write_bytes(words_path, new_bytes)
        written_sha = new_sha
    # narration.wav last: a run cut short before it leaves the earlier narration.wav, which standin.json still names,
    # so the next run knows both files as its own (guard) instead of refusing them
    changed = write_bytes(wav_path, data)
    m_out = loudness(path=wav_path)

    nwords = sum(len(l["words"]) for l in lines)
    out(f"Narration: {rel(wav_path)}  {total:.2f} s, {len(blocks)} blocks, {nwords} words"
        + ("" if changed else " (unchanged)"))
    held = next((x["w"] for l in lines for x in l["words"] if x["start"] - 0.05 <= peak_t <= x["end"] + 0.05), None)
    out(f"  loudness {fmt_lufs(m_out['I'])} LUFS (mono, measured as dual mono: as it plays on two speakers), true "
        f"peak {m_out['TP']:.1f} dBTP, range {m_out['LRA']:.1f} LU (measured on the file; a stem: mix.py sets the "
        f"final balance" + ((f"; levelled {gain_db:+.1f} dB toward {lufs:g} LUFS"
                             + (f", held under it by the {TP_MAX:g} dBTP true-peak ceiling: the loudest peak is "
                                + (f"'{held}' at " if held else "at ") + f"{peak_t:.2f} s" if capped else ""))
                            if lufs is not None else "; native level") + ")")
    if sil:
        out(f"  silence between blocks: {min(sil):.2f}-{max(sil):.2f} s (measured; --gap {gap:g})")
    if words_state == "kept":
        out(f"Word timings: {rel(words_path)} was edited since standin.py wrote it, and nothing it is made from has "
            f"changed: kept as it is (lines = blocks).")
    else:
        out(f"Word timings: {rel(words_path)} ({words_state}; lines = blocks; scenes find words by what is shown: "
            f"words.get('{lines[0]['words'][0]['w']}'), words.findWords('...'))")
        if kept_copy is not None:
            out(f"  it had been edited since standin.py wrote it, and the narration changed, so it was rewritten: the "
                f"edited copy is {rel(kept_copy)}")
    try:  # each line's span as the file the picture reads has it (a hand-edited one when it was kept)
        in_use = json.loads(disk) if words_state == "kept" else words_doc
    except ValueError:
        in_use = None
    in_use = in_use if isinstance(in_use, dict) else words_doc
    spans = [(x.get("block", k + 1), x.get("start"), x.get("end")) for k, x in enumerate(in_use.get("lines") or [])
             if isinstance(x, dict)]
    out("  lines: " + "; ".join(f"{n} {s:.2f}-{e:.2f} s" for n, s, e in spans
                                if isinstance(s, (int, float)) and isinstance(e, (int, float))))
    out(f"Phrase edges vs the waveform (a phrase: speech between pauses): {edge_line(before, 'before snapping' if snap_on else '')}.")
    if snap_on and rep.edges:
        out(f"  snapped: moved {moved} words onto the measured sound; re-measured: {edge_line(after)}.")
    elif rep.edges and before.get("beyond_tolerance"):
        out("  Move them onto the sound: run the same command with --snap")
    for a0, b0, inside in rep.unexplained[:4]:
        out(f"  pause {a0:.2f}-{b0:.2f} s matches no gap between words" + (f" (inside '{inside}')" if inside else ""))
    if not snd.usable:
        out("  warning: the background is too close to the voice to see pauses reliably")
    if unsaid:
        out(f"  {MODEL_NAME} said nothing for: " + ", ".join(f"'{x}' (block {n})" for n, x in unsaid)
            + "; they sit between their neighbours: respell them with --say 'shown=spoken'")
    out.data.update({
        "narration": {"file": rel(wav_path), "duration": r3(total), "lufs": round(m_out["I"], 1),
                      "loudness_convention": "dual mono", "true_peak": round(m_out["TP"], 1),
                      "lra": round(m_out["LRA"], 1), "sha256": asha, "gain_db": round(gain_db, 2),
                      "held_by_true_peak": capped, "peak_at": r3(peak_t),
                      "silence_between_blocks": [round(x, 3) for x in sil],
                      "changed": changed},
        "words": {"file": rel(words_path), "lines": len(lines), "words": nwords, "state": words_state,
                  "edited_copy": rel(kept_copy) if kept_copy is not None else None,
                  "unsaid": [{"block": n, "word": x} for n, x in unsaid]},
        "edges": {"before": before, "snapped": bool(snap_on and rep.edges), "moved": moved, "after": after,
                  "unexplained_pauses": [{"start": r3(x), "end": r3(y), "inside": s} for x, y, s in rep.unexplained]},
        "blocks": [{"block": b.n, "file": rel(p), "start": l["start"], "end": l["end"]}
                   for b, p, l in zip(blocks, paths, lines)],
    })
    return written_sha, asha


# check_lines, snapshot, report_wrote and names_to_hear are eleven.py's, as they are there (snapshot reads
# audio/standin/ here where eleven.py passes audio/narration/).


def check_lines(lines: list[dict], duration: float) -> list[str]:
    """The engine's words.json invariants (pdoom-video's check-pt-br.ts)."""
    bad = []
    prev_end = -1.0
    for l in lines:
        ws = l["words"]
        if not ws:
            bad.append(f"line {l['i']} has no words")
            continue
        if l["text"] != " ".join(x["w"] for x in ws):
            bad.append(f"line {l['i']} text is not its words joined by spaces")
        for x in ws:
            if not x["end"] > x["start"]:
                bad.append(f"'{x['w']}' ends at or before its start")
            if x["start"] < prev_end - 0.025:
                bad.append(f"'{x['w']}' starts before the previous word ends")
            prev_end = x["end"]
            if x["end"] > duration + 0.05:
                bad.append(f"'{x['w']}' ends after the audio")
    return bad


def snapshot(w: Where, ndir: Path) -> dict[Path, int]:
    """The narration's files as they stand (path -> mtime), so the run can say which it wrote: words.json,
    narration.wav, the blocks, takes and settings in audio/narration/, an edited words.json kept aside."""
    files = [w.data_dir / "words.json", w.audio_dir / "narration.wav", *sorted(ndir.glob("*")),
             *sorted((ndir / "takes").glob("*")), *sorted(w.review_dir.glob("words.edited-*.json"))]
    return {p: p.stat().st_mtime_ns for p in files if p.is_file()}


def report_wrote(out: Out, before: dict[Path, int], now: dict[Path, int]) -> None:
    """The run's last line: every file it created or rewrote, the data file first, then the narration, its
    settings and the audio files (their request records and timings said once, when every one has both)."""
    first = {"words.json": 0, "narration.wav": 1, "narration.json": 2}  # (then other files, the audio files last:
    #                                                                       the phrase on their records follows them)
    new = sorted((p for p in now if before.get(p) != now[p]),
                 key=lambda p: (first.get(p.name, 4 if p.suffix in (".mp3", ".wav") else 3), str(p)))
    audio = [p for p in new if p.suffix in (".mp3", ".wav") and p.name != "narration.wav"]
    both = bool(audio) and all(side(p, s) in new for p in audio for s in TTS_SIDES)
    shown = [p for p in new if not (both and any(p == side(x, s) for x in audio for s in TTS_SIDES))]
    out.data["wrote"] = [rel(p) for p in new]
    if not new:
        out("Wrote nothing: every file was up to date.")
        return
    out("Wrote: " + ", ".join(rel(p) for p in shown) + (
        "" if not both else " (with its .request.json and .alignment.json)" if len(audio) == 1 else
        " (each audio file with its .request.json and .alignment.json)") + ".")


def names_to_hear(b: Block) -> list[str]:
    """What the director should hear said before approving the voice on block b: its capitalised words that don't
    start a sentence (names, products, acronyms) and the say map's entries, as respelled."""
    said = {i: g for g in b.groups if g.shown for i in g.idx}
    found: list[str] = []
    for i, tok in enumerate(b.tokens):
        g = said.get(i)
        if g is not None:
            if i == g.idx[0]:
                found.append(f"{g.shown} (said \"{g.say}\")")
            continue
        word = bare(tok)
        if word.count("(") > word.count(")") and tok[tok.find(word) + len(word):].startswith(")"):
            word += ")"  # P(doom), not P(doom
        after_stop = i == 0 or b.tokens[i - 1].rstrip("\"'”’)»]").endswith((".", "!", "?", "…"))
        if word[:1].isupper() and not after_stop and not re.fullmatch(r"I(['’](m|ll|ve|d))?", word):
            found.append(word)
    return list(dict.fromkeys(found))


def env_of(module: str) -> Path | None:
    """The environment (the folder with pyvenv.cfg) a package is imported from, or None. Under `uv run --with` the
    script's packages and the added ones lie in two environments of uv's cache, and sys.prefix is a temporary overlay
    that holds neither."""
    from importlib.util import find_spec

    spec = find_spec(module)
    if spec is None or not spec.origin:
        return None
    return next((d for d in plain(Path(spec.origin)).parents if (d / "pyvenv.cfg").is_file()), None)


def report_cache(out: Out, root: Path, files: dict[str, Path | None], fetched: list[str]) -> None:
    """Where the model and the packages are, with their size on disk."""
    folders: dict[Path, list[str]] = {}
    for name, p in files.items():
        if p is not None:
            repo = next((d for d in p.parents if d.name.startswith("models--")), p.parent)
            folders.setdefault(repo, []).append(name)
    rows = []
    out("Cached (each can be deleted: standin.py fetches it again when it next needs it):")
    for d, names in folders.items():
        size = folder_bytes(d)
        how = "downloaded now" if any(x in fetched for x in names) else "already there"
        mine = plain(root) in plain(d).parents
        out(f"  model     {plain(d)}  {human_bytes(size)} on disk ({how}"
            + ("" if mine else "; the user's own Hugging Face cache") + ")")
        rows.append({"what": "model", "path": str(plain(d)), "bytes": size, "downloaded": how == "downloaded now",
                     "files": names})
    missing = [name for name, p in files.items() if p is None]
    if missing:
        out(f"  model     {', '.join(missing)} not cached: the next run that makes a block downloads "
            f"{'it' if len(missing) == 1 else 'them'} ({'about ' + str(MODEL_MB) if MODEL_FILE in missing else '0.5'} "
            f"MB) into {root / 'hf' / 'hub'}")
    env = env_of("kokoro") or Path(sys.prefix)
    extra = env_of("jieba") or env_of("pyopenjtalk")  # (misaki's Chinese or Japanese packages, added by uv run --with)
    for d in dict.fromkeys(x for x in (env, extra) if x is not None):
        size = folder_bytes(d)
        out(f"  packages  {d}  {human_bytes(size)} on disk (" + (
            "uv's environment for standin.py: torch, kokoro, misaki, spaCy's English model; uv builds it again from "
            "its cache when needed)" if d == env else
            "misaki's packages for this language, added by uv run --with; uv keeps them in its cache)"))
        rows.append({"what": "packages", "path": str(d), "bytes": size})
    uvc = uv_cache()
    if uvc:
        out(f"  {uvc['note']}")
        rows.append({"what": "uv cache", "path": uvc["path"], "bytes": uvc["bytes"], "counted": uvc["counted"]})
    for d in espeak_copies(root):
        if (d / "phontab").is_file():
            size = folder_bytes(d)
            out(f"  espeak-ng {d}  {human_bytes(size)} on disk (a short copy of its data: uv's environment lies too "
                f"deep for espeak-ng)")
            rows.append({"what": "espeak-ng data", "path": str(d), "bytes": size})
    out.data["cache"] = rows


# ---------------------------------------------------------------------------------------------
# CLI


EXAMPLES = """examples:
  uv run scripts/standin.py script.txt --video intro                      (af_heart, American English)
  uv run scripts/standin.py script.txt --out .                            (outside a project)
  uv run scripts/standin.py roteiro.md --video intro --voice pf_dora      (Brazilian Portuguese)
  uv run scripts/standin.py script.md --video intro --say say.tsv --gap 0.8
The script is the shown text, one paragraph per block (blank lines between them); in a .md
script a # heading starts a chapter and is not spoken. The say map respells shown words for
the voice ('shown<TAB>spoken' lines, a JSON {"shown": "spoken"}, or 'IA=I-A'), as in eleven.py.
Voices (the first letter is the language): af_heart (default), af_bella, am_michael, bf_emma,
bm_george, ef_dora, em_alex, ff_siwis, hf_alpha, if_sara, im_nicola, pf_dora, pm_alex, and more
in hf.co/hexgrad/Kokoro-82M (VOICES.md).
Writes audio/standin/NN-<slug>.wav with .request.json and .alignment.json, audio/narration.wav
and data/words.json; the settings stay in audio/standin/standin.json.
exit codes: 0 ok, 1 error, 2 bad usage or a narration standin.py did not make in the way;
standin.py never spends credits, so 3 and 4 never occur
"""


class UsageError(Exception):
    pass


class Parser(argparse.ArgumentParser):
    """argparse that raises on a usage error instead of exiting, so --json can report it as JSON too."""

    def error(self, message: str):
        raise UsageError(f"{self.format_usage().rstrip()}\n{self.prog}: error: {message}")


def lufs_arg(s: str):
    if s.strip().lower() == "native":
        return "native"
    try:
        v = float(s)
    except ValueError:
        raise argparse.ArgumentTypeError(f"{s!r}: give a loudness in LUFS (e.g. -16) or 'native'")
    if not -40 <= v <= -5:
        raise argparse.ArgumentTypeError(f"{s}: a loudness from -40 to -5 LUFS, or 'native'")
    return v


def build_parser() -> argparse.ArgumentParser:
    p = Parser(prog="standin.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
               epilog=EXAMPLES)
    p.add_argument("script", help="the narration as shown on screen (.txt or .md), paragraphs = blocks")
    p.add_argument("--video", help="video name in this audara project (writes under videos/<video>/; a script inside "
                                   "videos/<video>/ names it by itself)")
    p.add_argument("--out", help="without a project: folder that gets audio/ and data/ (default .)")
    p.add_argument("--voice", help=f"a {MODEL_NAME} voice (default {DEFAULT_VOICE}); its first letter is its language")
    p.add_argument("--lang", help="language: a, b, e, f, h, i, p, j, z or en, en-gb, es, fr, hi, it, pt, ja, zh "
                                  "(default: the voice's own)")
    p.add_argument("--speed", type=float, help="0.5-2 (default 1, the voice's own pace)")
    p.add_argument("--seed", type=int, help="seed of the voice's variations (default 1)")
    p.add_argument("--say", action="append", help="respelling for the voice: a file of shown<TAB>spoken lines, a "
                                                   "JSON {\"shown\": \"spoken\"}, or 'shown=spoken'; repeatable")
    p.add_argument("--gap", type=float, help=f"seconds of silence between blocks (default {GAP:g}, as eleven.py's)")
    p.add_argument("--lead", type=float, help=f"seconds before the first word (default {LEAD:g})")
    p.add_argument("--tail", type=float, help=f"seconds after the last word (default {TAIL:g})")
    p.add_argument("--snap", action=argparse.BooleanOptionalAction, default=None,
                   help="move phrase starts and ends in words.json onto the measured sound (the default; --no-snap "
                        "keeps Kokoro's times; kept for the next run)")
    p.add_argument("--lufs", type=lufs_arg, help=f"level of narration.wav in LUFS (default {LUFS:g}, as eleven.py's), "
                                                 f"or 'native'")
    p.add_argument("--json", action="store_true", help="print one JSON object instead of the summary")
    return p


def main(argv: list[str] | None = None) -> int:
    for st in (sys.stdout, sys.stderr):
        try:
            st.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    args = list(sys.argv[1:] if argv is None else argv)
    p = build_parser()
    try:
        a = p.parse_args(args)
    except UsageError as e:  # with --json the error is one JSON object too
        print(str(e), file=sys.stderr)
        if "--json" in args:
            print(json.dumps({"ok": False, "exit": USAGE, "error": str(e).splitlines()[-1]}, ensure_ascii=False))
        return USAGE
    except SystemExit as e:  # --help
        return int(e.code or 0)
    out = Out()
    code, err = OK, None
    try:
        cmd_standin(a, out)
    except Fail as e:
        code, err = e.code, str(e)
        out.data.update(e.data)
    except KeyboardInterrupt:
        code, err = ERROR, "interrupted (finished blocks are kept)"
    except Exception as e:  # a bug, not a usage problem: say where, briefly, and keep --json one object
        import traceback
        tb = traceback.extract_tb(e.__traceback__)[-1]
        code, err = ERROR, (f"unexpected {type(e).__name__}: {e} ({Path(tb.filename).name} line {tb.lineno}, in "
                            f"{tb.name}); finished blocks are kept")
        long_ = str(getattr(e, "filename", None) or "")
        if sys.platform == "win32" and len(long_) > 259 and not long_.startswith("\\\\?\\") and not long_paths_on():
            err += (f". That path is {len(long_)} characters, past the 260 Windows allows while long paths are off: "
                    f"set UV_CACHE_DIR and AUDARA_CACHE to short folders (such as C:\\uvc), or enable long paths "
                    f"(LongPathsEnabled = 1, an admin setting), then run again")
        elif sys.platform == "win32" and long_.startswith("\\\\?\\") and "/" in long_:
            err += (". A package joined a '/' onto a folder written the long way (as standin.py imports a uv "
                    "environment that lies deep), which Windows refuses: set UV_CACHE_DIR to a short folder (such as "
                    "C:\\uvc), or enable long paths (LongPathsEnabled = 1, an admin setting), then run again")
    if a.json:
        out.data.update({"ok": code == OK, "exit": code})
        if err:
            out.data["error"] = err
        print(json.dumps(out.data, ensure_ascii=False, indent=1, default=str))
    else:
        for line in out.lines:
            print(line)
    if err:
        print(f"{TOOL}: {err}", file=sys.stderr)
    return code


if __name__ == "__main__":
    sys.exit(main())
