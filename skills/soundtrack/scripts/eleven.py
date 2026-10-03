# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "httpx>=0.28,<1",
#   "numpy>=2.0,<3",
# ]
# ///
"""ElevenLabs for the soundtrack skill: narration, music and sound effects as audio files, each
with its exact request beside it, plus the timing data the code-video engine reads.

  voices         The account's voices (id, name, labels, preview link), to choose one with the
                 director. Free.
  tts            Narration from a script: one paragraph = one block = one text-to-speech request
                 with timestamps. Writes the blocks, narration.wav (blocks + gaps) and words.json,
                 measures every phrase edge against the waveform and moves it onto the sound
                 (the same method and code as align.py check --fix; --no-snap keeps the API's times).
  music plan     A composition plan to review before paying (free endpoint).
  music compose  The music from a plan, as takes brought to the same loudness for comparison.
  sfx            Sound-effect candidates, screened by analysis before anyone listens.
  stt            Transcribes audio (scribe_v2) to check that it says what the text says.

Spending: every call that costs credits needs --yes. Without it the command prints what it would
make (characters or seconds, estimated credits, voice, model, length) and exits 4, so the director
can say yes first; a refused run writes nothing. Generated audio is an asset: written once with
<file>.request.json beside it, and made again only when that request changes (an unchanged request
makes no API call).

Files: with --video <video>, inside an audara project (the nearest folder above with videos/):
audio goes to videos/<video>/audio/, timing data to videos/<video>/data/, review files (comparison
copies, screening results, transcripts) to out/<video>/. An input inside videos/<video>/ (a script, a
plan, an audio file) names its video by itself. Without a project: --out DIR (default: the current
folder) gets DIR/audio/, DIR/data/ and DIR/out/. Inside a project a command that writes needs its
video, so nothing lands at the project's root. Nothing is cached anywhere else.

Time origin: t = 0 is the first sample of ffmpeg's gapless decode, which is what Chrome's
decodeAudioData plays.

Key: ELEVENLABS_API_KEY, from the environment only: never printed, written or passed on a
command line. ELEVENLABS_BASE_URL (default https://api.elevenlabs.io) points the script at a mock.
Without a key a paid command spends nothing: it prints what it would cost, what a key pays for and
the free paths, and exits 3 (tts needs no --voice for that). After a paid run the summary names the
account's plan and what audio made on it may be used for; each request record keeps the plan.

Exit codes: 0 ok, 1 error, 2 bad usage, 3 no usable API key (missing or rejected), 4 needs --yes
to spend credits (what it would make was printed; nothing was spent).
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
import unicodedata
import wave
from dataclasses import dataclass
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path

import httpx
import numpy as np

TOOL = "eleven.py"
OK, ERROR, USAGE, NO_KEY, CONFIRM = 0, 1, 2, 3, 4

KEY_ENV = "ELEVENLABS_API_KEY"  # the name the official SDK and skills use
BASE_ENV = "ELEVENLABS_BASE_URL"
DEFAULT_BASE = "https://api.elevenlabs.io"

# ---------------------------------------------------------------------------------------------
# Models, formats and prices: the one place they live (checked 2026-10-02)

TTS_MODEL = "eleven_multilingual_v2"  # documented on /with-timestamps, 29 languages, steadiest long-form
MUSIC_MODEL = "music_v2_5"  # always sent: the API still defaults to the deprecated music_v1
SFX_MODEL = "eleven_text_to_sound_v2"  # the only sound-effects model
STT_MODEL = "scribe_v2"  # scribe_v1 is deprecated
DEFAULT_FORMAT = "mp3_44100_128"  # every endpoint and plan takes it (192 kbps MP3 needs Creator,
#                                   44.1 kHz WAV/PCM needs Pro)

# characters per request (docs; GET /v1/models has the account's maximum_text_length_per_request)
TTS_MAX_CHARS = {"eleven_multilingual_v2": 10000, "eleven_v4": 10000, "eleven_v3": 5000,
                 "eleven_flash_v2_5": 40000, "eleven_flash_v2": 30000,
                 "eleven_turbo_v2_5": 40000, "eleven_turbo_v2": 30000}
# voice settings each model takes: v3 has no similarity, speaker boost or speed; v4 only stability
# and similarity; the others all five
SETTING_KEYS = ("stability", "similarity_boost", "style", "use_speaker_boost", "speed")
SETTING_DEFAULTS = {"stability": 0.5, "similarity_boost": 0.75, "style": 0.0, "use_speaker_boost": True, "speed": 1.0}

RATES_CHECKED = "2026-10-02"  # elevenlabs.io/pricing (FAQ), /pricing/api, the sound-effects page
# credits per character: 1 for Multilingual v2, v3, v4; Flash/Turbo "between 0.5 and 1" on the API
TTS_CREDITS = {"eleven_flash_v2_5": (0.5, 1.0), "eleven_flash_v2": (0.5, 1.0),
               "eleven_turbo_v2_5": (0.5, 1.0), "eleven_turbo_v2": (0.5, 1.0)}  # others: (1, 1)
TTS_USD_PER_1K = {"eleven_flash_v2_5": 0.04, "eleven_flash_v2": 0.04, "eleven_turbo_v2_5": 0.04,
                  "eleven_turbo_v2": 0.04}  # others: 0.08 (pay-as-you-go API, list price)
MUSIC_CREDITS_PER_MIN, MUSIC_USD_PER_MIN = 900, 0.15
SFX_CREDITS_PER_S, SFX_CREDITS_AUTO, SFX_USD_PER_MIN = 40, 200, 0.12  # 40/s with a duration, else 200
SFX_AUTO_S = 5.0  # dollars for an effect whose length the model picks are not documented: estimated as
#                   5 s, the length at which the two credit rates meet (200 credits = 5 s x 40)
STT_CREDITS_PER_MIN, STT_USD_PER_HOUR = 330, 0.22
CHARS_PER_S = 16.0  # speaking rate for length estimates: pdoom-video's Portuguese narration ran 15.8
#                     (its ROTEIRO) to 16.4 (measured median per block) characters per second

# what audio made on each plan may be used for (references/elevenlabs.md, "What each plan allows"; same
# check). /v1/user/subscription names the plan in "tier"; Scale was once Growing Business, so an older
# account may still say growing_business
PAID_TIERS = ("starter", "creator", "pro", "scale", "growing_business", "business", "enterprise")
MUSIC_USERS = {"starter": "individuals only", "creator": "individuals only", "pro": "individuals only",
               "scale": "organizations under 10 employees", "growing_business": "organizations under 10 employees",
               "business": "organizations under 50 employees"}  # enterprise: its contract

# ---------------------------------------------------------------------------------------------
# Measuring (the phrase-edge method and constants are align.py check's, so both report the same)

SR = 44100  # analysis and assembly rate: ElevenLabs' mp3_44100 rate, so narration is never resampled
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

# music takes (reports, not gates)
ARRIVE_LU = 10.0  # the music has arrived once a 400 ms window is within 10 LU of the integrated level
ARRIVE_MAX_S = 1.5  # later than that (window included) is a slow intro: the plan asked for none
DIP_LU = 6.0  # a dip: the 1 s loudness 6 LU under its own section's median, for 1 s or more
HOLD_LU = 8.0  # the ending holds while the 400 ms loudness stays within 8 LU of the integrated level
RINGOUT_S = 4.0  # a resolved chord rings for a few seconds; down 8 LU longer than this is early decay
MIN_CHUNK_S, MAX_CHUNK_S = 3.0, 120.0  # the API's limits for one chunk of a music_v2/v2.5 plan
MAX_CHUNKS = 30
CUT_AT = 0.4  # a narration chapter's music changes 40% into the silence before it (pdoom-video's cut)

# sound effects (motion-video-kit's screen, MIT (c) 2026 echris6, plus a noise test)
BOOM_SHARE = 0.50  # > 50% of the energy under 150 Hz reads as a boom (rejected whooshes had 35-83%)
HISS_SHARE = 0.40  # > 40% over 6 kHz reads as hiss or a harsh click
NOISE_FLAT = 0.30  # in-band spectral flatness over 0.3 is noise (white noise ~0.56, a pluck ~0.02)
NOISE_MIN_S = 0.15  # noise shorter than this is a click or a hit, not a whoosh
FLAT_BINS = 24  # flatness is measured over at least 24 FFT bins (517 Hz at 2048 points): over the 2-3 bins
#                 of a low thump's own band, any spectrum looks flat
LONG_S = 0.8  # longer than 0.8 s is too long for a transition that repeats
ONSET_DB = 30.0  # onset = first 5 ms within 30 dB of the loudest 5 ms (the sound's attack)
ACTIVE_DB = 26.0  # active = within 26 dB (5% amplitude) of the loudest moment
NOISY_WORDS = ("whoosh", "swoosh", "swish", "wind", "air", "noise", "static", "rain", "hiss", "breath")


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
    print(scrub(msg), file=sys.stderr, flush=True)


def scrub(text: str) -> str:
    k = os.environ.get(KEY_ENV, "").strip()
    return text.replace(k, "[key]") if len(k) >= 8 else text


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
# eleven.py, beats.py, mix.py and align.py: change all four together.


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


def ext_for(fmt: str, kind: str) -> str:
    ok = ("mp3_", "wav_") if kind == "tts" else ("mp3_",)
    if not re.fullmatch(r"[a-z0-9]+_\d+(_\d+)?", fmt or "") or not fmt.startswith(ok):
        raise Fail(USAGE, f"--format {fmt}: use {' or '.join(p + '...' for p in ok)} (e.g. {DEFAULT_FORMAT}); "
                          f"raw PCM, ulaw and alaw carry no header to keep")
    return "." + fmt.split("_")[0]


def retire(path: Path, sides: tuple[str, ...]) -> Path:
    """Move a generated file and its side files to older/ beside it: it cost credits, so a newer
    version never silently overwrites it (motion-video-kit keeps older versions the same way)."""
    older = path.parent / "older"
    older.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dst, k = older / f"{path.stem}.{stamp}{path.suffix}", 1
    while dst.exists():
        dst, k = older / f"{path.stem}.{stamp}-{k}{path.suffix}", k + 1
    try:
        os.replace(path, dst)
        for s in sides:
            if side(path, s).is_file():
                os.replace(side(path, s), side(dst, s))
    except OSError as e:  # Windows refuses to move a file a player or editor holds open
        raise Fail(ERROR, f"cannot move {rel(path)} to {rel(older)}/ ({e.strerror or e}): it is probably open in a "
                          f"player or an editor. Close it and run the same command again (files already made are "
                          f"kept; nothing more was spent)")
    return dst


def save_paid(path: Path, audio: bytes, records: dict[str, object], what: str) -> Path:
    """Write a paid response (the audio, then its side records) the moment it arrives. If it can't
    go where it belongs, it is kept beside it under a rescue name (the next run with the same request
    takes it from there, with no API call) and the run stops, saying so."""
    try:
        write_bytes(path, audio)
        for suffix, obj in records.items():
            write_json(side(path, suffix), obj)
        return path
    except OSError as e:
        # a short name: Windows refuses paths over 260 characters, and a project can sit deep in a folder tree
        alt, k = path.with_name(f"{path.stem}.rescued{path.suffix}"), 2
        while alt.exists():
            alt, k = path.with_name(f"{path.stem}.rescued{k}{path.suffix}"), k + 1
        try:
            alt.write_bytes(audio)
            for suffix, obj in records.items():
                side(alt, suffix).write_text(json.dumps(obj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8",
                                             newline="\n")
        except OSError as e2:
            raise Fail(ERROR, f"{what}: the paid audio could not be written ({e.strerror or e}; {e2.strerror or e2}). "
                              f"It was billed: free some disk space or fix the folder's permissions before running "
                              f"again")
        raise Fail(ERROR, f"{what}: could not write {rel(path)} ({e.strerror or e}). The paid audio is kept as "
                          f"{rel(alt)}: fix that, then run the same command again (it takes the file from there, no "
                          f"API call)")


def find_rescued(path: Path, req: dict) -> Path | None:
    """A file save_paid had to keep under a rescue name, for exactly this request."""
    for alt in sorted(path.parent.glob(f"{path.stem}.rescued*{path.suffix}")) if path.parent.is_dir() else []:
        rec = read_json(side(alt, ".request.json")) or {}
        if json.dumps(rec.get("request"), sort_keys=True) == json.dumps(req, sort_keys=True):
            return alt
    return None


def adopt_rescued(alt: Path, path: Path, sides: tuple[str, ...]) -> None:
    """Move a rescued file (find_rescued) into its place: it was paid for once already."""
    copy_set(alt, path, sides, {})
    for s in ("",) + sides:
        (alt if not s else side(alt, s)).unlink(missing_ok=True)
    note(f"{path.name}: taken from {alt.name}, saved by an earlier run (no API call)")


def keep_or_retire(main: Path, takes_dir: Path, sides: tuple[str, ...]) -> None:
    """Before a picked take replaces `main`: keep the current file unless a take already holds it."""
    if main.is_file():
        sha = sha256_file(main)
        if not any(sha256_file(t) == sha for t in takes_dir.glob(f"*{main.suffix}") if t.is_file()):
            retire(main, sides)


def copy_set(src: Path, dst: Path, sides: tuple[str, ...], update: dict) -> None:
    """Copy an audio file and its side files (request record first-class: it is updated)."""
    write_bytes(dst, src.read_bytes())
    for s in sides:
        a, b = side(src, s), side(dst, s)
        if not a.is_file():
            continue
        if s == ".request.json":
            rec = read_json(a) or {}
            rec.update(update)
            write_json(b, rec)
        else:
            write_bytes(b, a.read_bytes())


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
# Edge, Report, match, snap and fit_syl are the same code in eleven.py and align.py: change both.


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
# The API


def get_key() -> str | None:
    k = os.environ.get(KEY_ENV, "").strip()
    return k or None


def no_key(what: str, cost: list[str] | None = None, done: str = "generated") -> Fail:
    lines = [f"{KEY_ENV} is not set in this environment, so {what} was not {done} and nothing was spent."]
    if cost:
        lines += ["This request would cost: " + cost[0]] + ["  " + c for c in cost[1:]]
    lines += [
        f"What a key pays for (rates checked {RATES_CHECKED}; the account's plan decides):",
        "  narration (tts)  1 credit per character (Multilingual v2; Flash 0.5-1), word timings included",
        f"  music            plan free; about {MUSIC_CREDITS_PER_MIN} credits per minute of each take",
        f"  effects (sfx)    about {SFX_CREDITS_PER_S} credits per second ({SFX_CREDITS_AUTO} without --duration)",
        f"  checks (stt)     about {STT_CREDITS_PER_MIN} credits per minute of audio",
        "Commercial use needs a paid plan: free-plan output is non-commercial and must credit ElevenLabs.",
        f"To use a key: set {KEY_ENV} in this terminal's environment (never in a project file), then run the "
        "same command again.",
        "Without a key the picture doesn't wait. Go on with one of:",
        "  - the user's own audio (beats.py for a song, align.py for its words);",
        "  - a local stand-in voice under an open license, e.g. Kokoro-82M (Apache-2.0), named as a stand-in:",
        "    scenes find words by text, so they keep their sync when the real voice replaces it;",
        "  - a silent placeholder: \"audio\": null and \"duration\": <seconds> in the video's video.json.",
    ]
    return Fail(NO_KEY, "\n".join(lines), {"status": "no_key", "estimate": cost or []})


class Api:
    def __init__(self, key: str):
        self.base = (os.environ.get(BASE_ENV, "").strip() or DEFAULT_BASE).rstrip("/")
        # long read timeout: a whole song comes back in one response (httpx gives up after 5 s idle by default)
        self.client = httpx.Client(base_url=self.base, headers={"xi-api-key": key}, follow_redirects=False,
                                   timeout=httpx.Timeout(600.0, connect=15.0))

    def call(self, method: str, path: str, what: str, paid: bool = False, **kw) -> httpx.Response:
        billed = (" If the request reached ElevenLabs it may have been billed: check the account's history on "
                  "elevenlabs.io before running again." if paid else "")
        for attempt in range(4):
            try:
                r = self.client.request(method, path, **kw)
            except httpx.TimeoutException:
                raise Fail(ERROR, f"{what}: no answer from {self.base} in time." + (billed or " Try again."))
            except httpx.HTTPError as e:
                raise Fail(ERROR, f"{what}: the connection to {self.base} failed ({type(e).__name__}). Check the network"
                           + (f" and {BASE_ENV}" if os.environ.get(BASE_ENV) else "") + "." + billed)
            # 429 (rate or concurrency limit) and 503 (busy) mean the request was not processed: wait, retry
            if r.status_code in (429, 503) and attempt < 3:
                wait = 2.0 * 2 ** attempt
                note(f"{what}: the API is busy (HTTP {r.status_code}); retrying in {wait:.0f} s")
                time.sleep(wait)
                continue
            if r.is_success:
                return r
            raise api_error(r, what)
        raise Fail(ERROR, f"{what}: still busy after 4 tries")


def api_error(r: httpx.Response, what: str) -> Fail:
    code = status = msg = rid = None
    data: dict = {}
    try:
        body = r.json()
    except ValueError:
        body = None
    d = body.get("detail") if isinstance(body, dict) else None
    if isinstance(d, dict):
        code, status, msg, rid = d.get("code"), d.get("status"), d.get("message"), d.get("request_id")
        data = d.get("data") if isinstance(d.get("data"), dict) else {}
    elif isinstance(d, list):
        msg = "; ".join(f"{'.'.join(map(str, e.get('loc', [])))}: {e.get('msg')}" for e in d if isinstance(e, dict))
    elif isinstance(d, str):
        msg = d
    else:
        msg = (r.text or "")[:300]
    tags = {str(code), str(status)}
    head = (f"{what} failed: HTTP {r.status_code}" + (f" {code or status}" if (code or status) else "")
            + (f": {msg}" if msg else "") + (f" (request_id {rid})" if rid else ""))
    if tags & {"insufficient_credits", "quota_exceeded", "payment_required"} or r.status_code == 402:
        return Fail(ERROR, head + "\nOut of credits: top up or upgrade the plan on elevenlabs.io, then run the same "
                                  "command again (finished files are kept; only what is missing is made).")
    if r.status_code == 401:
        return Fail(NO_KEY, head + f"\nThe key was not accepted: set {KEY_ENV} to a valid key (elevenlabs.io, "
                                   "Developers > API keys) in this terminal's environment and run the same command again.",
                    {"status": "key_rejected"})
    if code in ("bad_prompt", "bad_composition_plan"):
        sug = data.get("prompt_suggestion") or data.get("composition_plan_suggestion")
        return Fail(ERROR, head + "\nThe music model refuses names of artists, bands, songs or brands and copyrighted "
                                  "lyrics: describe the sound instead (genre, instruments, tempo, mood)."
                    + (f"\nIts suggestion: {json.dumps(sug, ensure_ascii=False)[:600]}" if sug else ""))
    if r.status_code == 403:
        return Fail(ERROR, head + "\nThis plan or key can't do that: a key can be limited to some endpoints, music "
                                  "needs a paid plan, 192 kbps MP3 needs Creator and 44.1 kHz WAV needs Pro. Try "
                                  f"--format {DEFAULT_FORMAT}, or check the key's permissions.")
    if r.status_code == 404 and "voice" in str(code or status or msg):
        return Fail(ERROR, head + f"\nList the account's voices with: {me('voices')}")
    if tags & {"text_too_long", "max_character_limit_exceeded"}:
        return Fail(ERROR, head + "\nSplit the paragraph with a blank line (each paragraph is one request).")
    if r.status_code == 429:
        return Fail(ERROR, head + "\nToo many requests at once on this plan: wait a minute and run the same command "
                                  "again (finished files are kept).")
    return Fail(ERROR, head)


def subscription(api: Api) -> dict:
    """The account's subscription (free call; best effort: {} when it can't be read)."""
    try:
        s = api.call("GET", "/v1/user/subscription", "reading the subscription").json()
    except (Fail, ValueError):
        return {}
    return s if isinstance(s, dict) else {}


def account_line(s: dict, kind: str) -> list[str]:
    """Credits left this period, and the plan with what audio made on it may be used for."""
    if not s:
        return []
    lines = []
    try:
        used, limit = int(s.get("character_count", 0)), int(s.get("character_limit", 0))
        lines.append(f"Account: {num(max(0, limit - used))} of {num(limit)} credits left this period.")
    except (TypeError, ValueError):
        pass
    return lines + plan_terms(s.get("tier"), kind, status=s.get("status"))


def plan_terms(tier: str | None, kind: str, which: str = "", status: str | None = None) -> list[str]:
    """What audio made on this plan may be used for (references/elevenlabs.md, "What each plan allows"), for
    the director: the scripts' summaries are passed on almost word for word. `which` names the files when
    they were made on different plans; a status other than active is named too."""
    t = str(tier or "").strip().lower()
    free = "free-plan audio is non-commercial and must credit ElevenLabs"
    st = f"subscription {status}" if status and str(status) != "active" and t != "free" else ""
    tag = ", ".join(x for x in (which, st) if x)
    if not t:
        lines = [f"Plan not recorded{f' ({tag})' if tag else ''}: check the account's plan on elevenlabs.io before "
                 f"commercial use; {free}."]
    elif t == "free":
        lines = [f"Plan free{f' ({tag})' if tag else ''}: its audio is non-commercial and must credit ElevenLabs, even "
                 f"with a pay-as-you-go top-up; commercial use needs audio made on a paid plan."]
    elif t in PAID_TIERS:
        lines = [f"Plan {t} (paid{', ' + tag if tag else ''}): commercial use is covered for audio made while "
                 f"subscribed; {free}."]
    else:
        lines = [f"Plan {t}{f' ({tag})' if tag else ''}: not a plan eleven.py knows; check its terms on elevenlabs.io "
                 f"before commercial use ({free})."]
    if kind == "music" and t in PAID_TIERS:
        who = MUSIC_USERS.get(t)
        lines.append(f"Music on {t} follows its contract." if who is None else
                     f"Music on {t} is for {who}"
                     + (" (an agency or a company making the video needs scale or above)"
                        if who == "individuals only" else "")
                     + ", and for online video, not film, TV, radio or studio games"
                     + (", nor a release on streaming platforms." if t == "starter" else "."))
    if kind == "sfx":
        lines.append("ElevenLabs may sublicense generated effects to others unless the account opts out on its "
                     "sound-effects page.")
    return lines


def report_plan(out: Out, noun: str, made: list[tuple[int, Path]], kind: str) -> None:
    """The plan each file was made on (kept in its request record) with what it allows: audio keeps the terms
    of the plan it was made on, so files made on different plans are named."""
    by: dict[str | None, list[int]] = {}
    for n, p in made:
        by.setdefault((read_json(side(p, ".request.json")) or {}).get("tier"), []).append(n)
    if len(by) == 1:
        lines = plan_terms(next(iter(by)), kind)
    else:
        lines = [x for t, ns in by.items()
                 for x in plan_terms(t, kind, f"{noun}{'s' if len(ns) > 1 else ''} {', '.join(map(str, ns))}")]
        lines = list(dict.fromkeys(lines[::-1]))[::-1]  # a line every plan shares (the effects one): once, last
    for x in lines:
        out(x)
    out.data["license"] = lines


def confirm(out: Out, what: str, data: dict) -> Fail:
    out(f"Nothing was generated. Ask the director, then run the same command with --yes to {what}.")
    return Fail(CONFIRM, f"needs --yes to {what}", {"status": "needs_confirmation", **data})


# ---------------------------------------------------------------------------------------------
# Narration text: script, say map, blocks


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
# respell are the same code in eleven.py and align.py: change both together.


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
# voices


def cmd_voices(a, out: Out) -> None:
    key = get_key()
    if not key:
        raise no_key("the voice list", done="fetched")
    api = Api(key)
    voices: list[dict] = []
    token = None
    while len(voices) < a.limit:
        params = {"page_size": min(100, a.limit - len(voices)), "include_total_count": "false"}
        if a.search:
            params["search"] = a.search
        if token:
            params["next_page_token"] = token
        j = api.call("GET", "/v2/voices", "listing voices", params=params).json()
        voices += j.get("voices") or []
        token = j.get("next_page_token")
        if not j.get("has_more") or not token:
            break
    rows = []
    for v in voices:
        langs = sorted({str(x.get("language")) for x in (v.get("verified_languages") or []) if x.get("language")})
        labels = v.get("labels") or {}
        if a.language and a.language.lower() not in [x.lower() for x in langs] + [str(labels.get("language", "")).lower()]:
            continue
        rows.append({"voice_id": v.get("voice_id"), "name": v.get("name"), "category": v.get("category"),
                     "labels": labels, "languages": langs, "description": v.get("description"),
                     "preview_url": v.get("preview_url")})
    out.data["voices"] = rows
    if not rows:
        out("No voices matched." + (" Try without --language or --search." if (a.language or a.search) else ""))
        return
    out(f"{'voice_id':24s} {'name':22s} {'category':12s} labels / languages")
    for r in rows:
        lab = ", ".join(str(v) for k, v in r["labels"].items() if v and k != "language")
        out(f"{str(r['voice_id']):24s} {str(r['name'])[:22]:22s} {str(r['category'] or '')[:12]:12s} "
            f"{lab}{' / ' + ', '.join(r['languages']) if r['languages'] else ''}")
        if r["preview_url"]:
            out(f"{'':24s} preview: {r['preview_url']}")
    out()
    if any(r["category"] == "premade" for r in rows):
        out("ElevenLabs' default (premade) voices are retired on 2026-12-31: for a video that may be regenerated "
            "later, prefer a voice from the account's library.")
    if any(r["preview_url"] for r in rows):
        out("Share the preview links of two or three fitting voices with the director before the paid voice test "
            "(playing them costs nothing), then pass the chosen one to tts with --voice ID.")
    else:
        out("Pass one with --voice ID to tts.")


# ---------------------------------------------------------------------------------------------
# tts


def tts_settings(a, cfg: dict, model: str) -> dict:
    keys = setting_keys(model)
    vs = {k: v for k, v in (cfg.get("voice_settings") or {}).items() if k in keys}
    for k, flag in (("stability", a.stability), ("similarity_boost", a.similarity), ("style", a.style),
                    ("speed", a.speed), ("use_speaker_boost", a.speaker_boost)):
        if flag is None:
            continue
        if k not in keys:
            raise Fail(USAGE, f"{model} doesn't take {k} (it takes {', '.join(keys)})")
        vs[k] = flag
    for k, lo, hi in (("stability", 0, 1), ("similarity_boost", 0, 1), ("style", 0, 1), ("speed", 0.7, 1.2)):
        if k in vs and not lo <= float(vs[k]) <= hi:
            raise Fail(USAGE, f"{k} {vs[k]} is out of range ({lo}-{hi})")
    return vs


def setting_keys(model: str) -> tuple[str, ...]:
    if model.startswith("eleven_v4"):
        return ("stability", "similarity_boost")
    if model.startswith("eleven_v3"):
        return ("stability", "style")
    return SETTING_KEYS


def content(req: dict) -> str:
    """A request without its seed: the seed picks a take, it does not change what is said."""
    r = json.loads(json.dumps(req))
    (r.get("body") or {}).pop("seed", None)
    return json.dumps(r, sort_keys=True, ensure_ascii=False)


def tts_estimate(model: str, chars: int) -> tuple[str, dict]:
    lo, hi = TTS_CREDITS.get(model, (1.0, 1.0))
    usd = chars / 1000 * TTS_USD_PER_1K.get(model, 0.08)
    cr = f"{num(chars * lo)}" if lo == hi else f"{num(chars * lo)}-{num(chars * hi)}"
    text = (f"{num(chars)} characters = {cr} credits (about ${usd:.2f} at pay-as-you-go API prices), "
            f"about {chars / CHARS_PER_S:.0f} s of voice")
    return text, {"characters": chars, "credits_low": round(chars * lo), "credits_high": round(chars * hi),
                  "usd": round(usd, 3), "seconds_estimate": round(chars / CHARS_PER_S, 1)}


def tts_flags(a) -> list[str]:
    """The narration flags of this run, so a command it suggests repeats them (a refused run
    remembers nothing, so the suggestion must carry them)."""
    f: list[str] = []
    for flag, v in (("--voice", a.voice), ("--model", a.model), ("--format", a.format), ("--seed", a.seed),
                    ("--gap", a.gap), ("--lead", a.lead), ("--tail", a.tail), ("--stability", a.stability),
                    ("--similarity", a.similarity), ("--style", a.style), ("--speed", a.speed)):
        if v is not None:
            f += [flag, f"{v:g}" if isinstance(v, float) else str(v)]
    for s in a.say or []:
        f += ["--say", s]
    if a.lufs is not None:
        f += ["--lufs", a.lufs if isinstance(a.lufs, str) else f"{a.lufs:g}"]
    if a.snap is not None:
        f.append("--snap" if a.snap else "--no-snap")
    if a.speaker_boost is not None:
        f.append("--speaker-boost" if a.speaker_boost else "--no-speaker-boost")
    return f


def cmd_tts(a, out: Out) -> None:
    tool("ffmpeg")  # checked before anything is spent: every run ends by decoding what it made
    w = where(a.video, a.out, [a.script])
    base = ["tts", a.script, *place_args(a)]  # for the commands this run suggests next
    script = find_input(a.script, w, "", "script")
    paras = read_script(script)
    if not paras:
        raise Fail(USAGE, f"{rel(script)} has no text: write the narration as paragraphs separated by blank lines")
    ndir = w.audio_dir / "narration"
    tdir = ndir / "takes"
    cfg_path = ndir / "narration.json"
    cfg = read_json(cfg_path) or {}

    voice = a.voice or cfg.get("voice_id")
    if not voice and (get_key() or a.pick is not None):
        raise Fail(USAGE, f"choose a voice with --voice ID (list them with: {me('voices')}); it is then kept for "
                          f"this narration")
    # without a key nothing is sent, so the estimate needs no voice: a plain `tts script.txt` prints the cost,
    # what a key pays for and the free paths (exit 3) instead of stopping at the voice
    no_voice = not voice
    voice = voice or "<voice>"
    vname = cfg.get("voice_name") if voice == cfg.get("voice_id") else None
    model = a.model or cfg.get("model_id") or TTS_MODEL
    fmt = a.format or cfg.get("output_format") or DEFAULT_FORMAT
    ext = ext_for(fmt, "tts")
    seed = a.seed if a.seed is not None else int(cfg.get("seed", 1))
    gap = a.gap if a.gap is not None else float(cfg.get("gap", 0.6))
    lead = a.lead if a.lead is not None else float(cfg.get("lead", 0.5))
    tail = a.tail if a.tail is not None else float(cfg.get("tail", 1.0))
    # phrase edges go onto the measured sound unless --no-snap: it is free and deterministic, and the API's
    # phrase starts run early (the S1 baseline's voice led the sound by 108-123 ms at every sentence)
    snap_on = a.snap if a.snap is not None else bool(cfg.get("snap", True))
    lufs = cfg.get("lufs", -16.0) if a.lufs is None else (None if a.lufs == "native" else float(a.lufs))
    for nm, v in (("--gap", gap), ("--lead", lead), ("--tail", tail)):
        if not 0 <= v <= 30:
            raise Fail(USAGE, f"{nm} {v}: seconds between 0 and 30")
    say_items = a.say if a.say is not None else list(cfg.get("say") or [])
    entries, say_keep = read_say(say_items, w)
    vs = tts_settings(a, cfg, model)

    blocks: list[Block] = []
    width = max(2, len(str(len(paras))))
    for n, (para, chapter) in enumerate(paras, 1):
        toks, groups = respell(para, entries)
        blocks.append(Block(n, width, para, toks, groups, chapter))
    limit = TTS_MAX_CHARS.get(model, 5000)
    for b in blocks:
        if len(b.spoken) > limit:
            raise Fail(USAGE, f"paragraph {b.n} has {len(b.spoken)} characters; {model} takes at most {limit} per "
                              f"request: split it with a blank line")
    used = {k for b in blocks for k in b.said}
    unused = [" ".join(e.shown) for e in entries if " ".join(e.shown) not in used]

    N = len(blocks)
    if (a.takes is not None or a.pick is not None) and a.block is None:
        raise Fail(USAGE, "--takes and --pick need --block N (the paragraph's number, from 1)")
    if a.takes is not None and a.pick is not None:
        raise Fail(USAGE, "make the takes first, listen, then --pick one")
    if a.only is not None and (a.takes is not None or a.pick is not None):
        raise Fail(USAGE, "--only makes one block's main take; use --takes/--pick with --block for alternatives")
    for flag, v in (("--only", a.only), ("--block", a.block)):
        if v is not None and not 1 <= v <= N:
            raise Fail(USAGE, f"{flag} {v}: the script has {N} paragraph{'s' if N != 1 else ''} (1-{N})")
    if a.takes is not None and not 2 <= a.takes <= 10:
        raise Fail(USAGE, "--takes K: from 2 to 10")

    def req(b: Block, s: int) -> dict:
        body = {"text": b.spoken, "model_id": model, "voice_settings": dict(sorted(vs.items())), "seed": s}
        return {"method": "POST", "path": f"/v1/text-to-speech/{voice}/with-timestamps",
                "query": {"output_format": fmt}, "body": body}

    def main_path(b: Block) -> Path:
        return ndir / f"{b.name}{ext}"

    def take_path(b: Block, k: int) -> Path:
        return tdir / f"{b.name}.take{k}{ext}"

    # settings missing (first run, or narration.json deleted): adopt them from blocks already made, so
    # every block keeps the same settings; otherwise they come from the voice itself, before generating
    complete = all(k in vs for k in setting_keys(model))
    if not complete:
        for b in blocks:
            rec = read_json(side(main_path(b), ".request.json")) or {}
            body = (rec.get("request") or {}).get("body") or {}
            if body.get("model_id") == model and (rec.get("request") or {}).get("path", "").endswith(f"/{voice}/with-timestamps"):
                vs = {**{k: v for k, v in (body.get("voice_settings") or {}).items() if k in setting_keys(model)}, **vs}
                break
        complete = all(k in vs for k in setting_keys(model))

    def state(path: Path, b: Block, s: int | None) -> tuple[str, str]:
        """'ok', or what is missing/stale and why."""
        if not path.is_file():
            return "make", "new"
        rec = read_json(side(path, ".request.json"))
        if not rec or "request" not in rec:
            raise Fail(ERROR, f"{rel(path)} has no request record beside it: move the file away (or delete it) "
                              f"so it can be generated with its record")
        if not side(path, ".alignment.json").is_file():
            return "make", "timings missing"
        old, new = json.loads(content(rec["request"])), json.loads(content(req(b, s if s is not None else seed)))
        if not complete:  # the settings are not known yet: compare everything else
            old.get("body", {}).pop("voice_settings", None)
            new.get("body", {}).pop("voice_settings", None)
        if old != new:
            return "make", "text changed" if old.get("body", {}).get("text") != b.spoken else "voice or settings changed"
        if s is not None and (rec["request"].get("body") or {}).get("seed") != s:
            return "make", "other seed"
        return "ok", ""

    # what this run makes: (block, path, seed, label, reason)
    jobs: list[tuple[Block, Path, int, str, str]] = []
    if a.pick is None:
        if a.takes is not None:
            b = blocks[a.block - 1]
            for k in range(1, a.takes + 1):
                st, why = state(take_path(b, k), b, seed + k - 1)
                if st != "ok":
                    jobs.append((b, take_path(b, k), seed + k - 1, f"block {b.n} take {k}", why))
        else:
            for b in ([blocks[a.only - 1]] if a.only else blocks):
                st, why = state(main_path(b), b, None)
                if st != "ok":
                    jobs.append((b, main_path(b), seed, f"block {b.n}", why))

    # free reuse: the same request already generated under another name (a renumbered paragraph, take 1,
    # a file an earlier run had to save under a rescue name). A block's main file prefers an earlier main
    # file with the same text (it may be a picked take, whatever its seed); a take needs the same seed.
    # Only planned here: nothing is copied until the run is known to go ahead.
    reuse: list[tuple[Path, Path, Block, str]] = []
    if jobs and complete:
        index: list[tuple[str, int | None, bool, Path]] = []
        for is_take, rp in [(False, p) for p in ndir.glob("*.request.json")] + [(True, p) for p in tdir.glob("*.request.json")]:
            rec = read_json(rp) or {}
            src = rp.with_name(rp.name.replace(".request.json", ext))
            if "request" in rec and src.is_file() and side(src, ".alignment.json").is_file():
                index.append((content(rec["request"]), (rec["request"].get("body") or {}).get("seed"), is_take, src))
        left = []
        for b, path, s, label, why in jobs:
            c = content(req(b, s))
            hits = [x for x in index if x[0] == c and x[3] != path]
            main_job = path.parent == ndir
            hits = ([x[3] for x in hits if not x[2]] if main_job else []) + [x[3] for x in hits if x[1] == s]
            if hits:
                reuse.append((hits[0], path, b, label))
            else:
                left.append((b, path, s, label, why))
        jobs = left

    def cfg_doc(words_sha: str | None) -> dict:
        return {"voice_id": voice, "voice_name": vname, "model_id": model, "voice_settings": vs,
                "output_format": fmt, "seed": seed, "say": say_keep, "gap": gap, "lead": lead, "tail": tail,
                "snap": snap_on, "lufs": lufs, "script": rel_to(script, w.base), "words_sha256": words_sha,
                "notes": "Settings of this narration, kept by eleven.py tts: every block uses the same ones. Flags "
                         "change them; changing the voice or its settings makes every block again (after asking). "
                         "words_sha256 is the words.json eleven.py last wrote: a file edited since then is kept while "
                         "nothing it is made from changes."}

    def do_reuse() -> None:
        for src, path, b, label in reuse:
            copy_set(src, path, TTS_SIDES, {"block": b.n, "copied_from": rel_to(src, ndir)})
            out(f"{label}: same request as {rel(src)} (copied, no API call)")

    out.data["settings"] = {"voice_id": None if no_voice else voice, "model_id": model, "voice_settings": vs,
                            "output_format": fmt, "seed": seed, "gap": gap, "lead": lead, "tail": tail, "snap": snap_on,
                            "lufs": lufs, "say": say_keep}
    if jobs:
        chars = sum(len(b.spoken) for b, *_ in jobs)
        est_text, est = tts_estimate(model, chars)
        plan = [f"{label}: {len(b.spoken)} characters ({why}) -> {rel(p)}" for b, p, s, label, why in jobs]
        free = [f"{label}: same request as {rel(src)} (copied, free)" for src, _, _, label in reuse]
        key = get_key()
        if not key:
            voice_note = [f"no voice chosen yet: with a key, choose one with the director from {me('voices')} (its "
                          f"preview links play for free), then add --voice ID"] if no_voice else []
            raise no_key("the narration", [est_text] + plan + free + voice_note)
        api = Api(key)
        vinfo = api.call("GET", f"/v1/voices/{voice}", "looking up the voice").json()
        vname = vinfo.get("name") or voice
        if not complete:
            try:
                stored = api.call("GET", f"/v1/voices/{voice}/settings", "reading the voice's settings").json()
            except Fail:
                stored = {}
            for k in setting_keys(model):
                if k not in vs:
                    vs[k] = stored.get(k, SETTING_DEFAULTS[k]) if stored.get(k) is not None else SETTING_DEFAULTS[k]
            complete = True
            out.data["settings"]["voice_settings"] = vs
        out.data["estimate"] = est
        out.data["jobs"] = [{"label": label, "file": rel(p), "characters": len(b.spoken), "reason": why, "seed": s}
                            for b, p, s, label, why in jobs]
        if not a.yes:
            out(f"Would generate {len(jobs)} text-to-speech request{'s' if len(jobs) != 1 else ''}:")
            for x in plan + free:
                out("  " + x)
            out(f"Voice: {vname} ({voice}); model {model}; {settings_text(vs)}; {fmt}.")
            out(f"Cost: {est_text}.")
            out.data["account"] = account_line(subscription(api), "tts")
            for x in out.data["account"]:
                out(x)
            if any(why == "voice or settings changed" for *_, why in jobs):
                out("The voice or its settings changed: every block is made again, so they all match.")
            if a.only is None and a.takes is None and len(jobs) > 1 and \
                    not any(state(main_path(b), b, None)[0] == "ok" for b in blocks):
                b1 = blocks[0]
                test = me(*base, *tts_flags(a), "--only", "1", "--yes")
                c1, _ = tts_estimate(model, len(b1.spoken))
                out(f"No block has this voice and these settings yet. Approve the voice on one block first ({c1}):")
                out(f"  {test}")
                out(f"then, after the director has listened, the rest: {me(*base, '--yes')}")
                out("Nothing was generated.")
                raise Fail(CONFIRM, "needs --yes to spend: make the voice test (--only 1 --yes) first",
                           {"status": "needs_confirmation", "estimate": est, "jobs": out.data["jobs"], "next": test})
            raise confirm(out, "generate them", {"estimate": est, "jobs": out.data["jobs"]})
        do_reuse()
        write_json(cfg_path, cfg_doc(cfg.get("words_sha256")))  # the settings these blocks are paid for, first
        tier = subscription(api).get("tier")  # the plan they are made on: each record keeps it (its terms are theirs)
        for i, (b, path, s, label, why) in enumerate(jobs, 1):
            if path.is_file():  # moved aside before paying: a file a player holds open fails here, not after
                note(f"tts: the earlier {path.name} ({why}) moves to {rel(retire(path, TTS_SIDES))}")
            note(f"tts: {label} ({i}/{len(jobs)}, {len(b.spoken)} characters)")
            r = req(b, s)
            resp = api.call("POST", r["path"], f"text-to-speech for {label}", paid=True,
                            params=r["query"], json=r["body"])
            try:
                j = resp.json()
                audio = base64.b64decode(j["audio_base64"])
            except (ValueError, KeyError, TypeError):
                raise Fail(ERROR, f"text-to-speech for {label}: the response had no audio_base64 (it may still have "
                                  f"been billed; check the account's history)")
            al = j.get("alignment") or j.get("normalized_alignment")
            rec = {"kind": "tts", "request": r, "shown_text": b.display, "say": b.said or None, "block": b.n,
                   "voice_name": vname, "generated": now(), "tier": tier, "tool": TOOL,
                   "response": {"request_id": resp.headers.get("request-id"),
                                "character_cost": resp.headers.get("character-cost"),
                                "audio_sha256": sha256_bytes(audio), "bytes": len(audio)}}
            timings = {"alignment": j.get("alignment"), "normalized_alignment": j.get("normalized_alignment")}
            if not al:
                timings["missing"] = f"{model} returned no timings for this request"
            save_paid(path, audio, {".request.json": rec, ".alignment.json": timings}, f"text-to-speech for {label}")
            if not al:
                raise Fail(ERROR, f"{label}: {model} returned audio without timestamps (kept: {rel(path)}, so it is not "
                                  f"bought again). For word timings use --model {TTS_MODEL}, or time narration.wav with "
                                  f"align.py song --no-separate")
        out(f"Generated {len(jobs)} file{'s' if len(jobs) != 1 else ''} ({num(chars)} characters).")
    else:
        do_reuse()

    # the block's main file: --takes fills a missing one with take 1; --pick copies the chosen take
    if a.takes is not None:
        b = blocks[a.block - 1]
        if not main_path(b).is_file():
            copy_set(take_path(b, 1), main_path(b), TTS_SIDES, {"take": 1})
        report_takes(out, b, [take_path(b, k) for k in range(1, a.takes + 1)], base)
    if a.pick is not None:
        b = blocks[a.block - 1]
        tp = take_path(b, a.pick)
        st, why = state(tp, b, seed + a.pick - 1)
        if st != "ok":
            raise Fail(ERROR, f"take {a.pick} of block {b.n} {'does not exist' if why == 'new' else 'is stale (' + why + ')'}"
                              f": make takes first with --takes K --block {b.n}")
        keep_or_retire(main_path(b), tdir, TTS_SIDES)
        copy_set(tp, main_path(b), TTS_SIDES, {"take": a.pick, "picked": now()})
        out(f"Block {b.n}: take {a.pick} is now {rel(main_path(b))}.")

    # remember the narration's settings (flags change them; the next run reuses them)
    write_json(cfg_path, cfg_doc(cfg.get("words_sha256")))
    if unused:
        out(f"Say map entries not found in the script: {', '.join(unused)}.")

    missing = [b for b in blocks if state(main_path(b), b, None)[0] != "ok"]
    if missing:
        names = ", ".join(str(b.n) for b in missing)
        out(f"narration.wav and words.json are written once every block exists (missing or stale: {names}).")
        if a.only is not None:
            b = blocks[a.only - 1]
            out(f"Block {b.n}'s timings (the API's, per character) are already in "
                f"{rel(side(main_path(b), '.alignment.json'))}; {'snapped ' if snap_on else ''}word timings for every "
                f"block come with the rest in {rel(w.data_dir / 'words.json')}, so nothing needs exporting now.")
            report_takes(out, b, [main_path(b)], base, title=f"Block {b.n} (for approving the voice):")
            report_plan(out, "block", [(b.n, main_path(b))], "tts")
            out(f"Approve the voice by ear, then make the rest: {me(*base)} (shows the cost; add --yes)")
        elif a.takes is not None and jobs:  # takes just made: the plan they were made on
            b = blocks[a.block - 1]
            report_plan(out, "take", [(k, take_path(b, k)) for k in range(1, a.takes + 1)], "tts")
        out.data["missing_blocks"] = [b.n for b in missing]
        return
    tidy(out, ndir, [main_path(b) for b in blocks])
    made = [b.n for b, path, *_ in jobs if path.parent == ndir]  # main files paid for in this run: nobody heard them
    words_sha = assemble_narration(out, w, script, blocks, [main_path(b) for b in blocks], voice, vname, model, vs,
                                   gap, lead, tail, snap_on, lufs, base, cfg.get("words_sha256"), made)
    write_json(cfg_path, cfg_doc(words_sha))


TTS_SIDES = (".request.json", ".alignment.json")


def tidy(out: Out, ndir: Path, paths: list[Path]) -> None:
    """Generated narration files no paragraph uses any more (renumbered or deleted paragraphs, a file
    an earlier run rescued): a byte-identical copy of a current block is removed; anything else moves
    to older/."""
    current = {p.name for p in paths}
    shas = {sha256_file(p) for p in paths}
    gone, kept = [], []
    for f in sorted(ndir.iterdir()):
        if not f.is_file() or f.name in current or f.suffix not in (".mp3", ".wav"):
            continue
        rec = read_json(side(f, ".request.json")) or {}
        if rec.get("kind") != "tts":
            continue  # not made by this script: leave it alone
        try:
            if sha256_file(f) in shas:
                for s in ("",) + TTS_SIDES:
                    (f if not s else side(f, s)).unlink(missing_ok=True)
                gone.append(f.name)
            else:
                kept.append(rel(retire(f, TTS_SIDES)))
        except (OSError, Fail) as e:  # a file held open stays where it is; nothing depends on it
            out(f"Left in place (could not move it: {e}): {f.name}")
    if gone:
        out(f"Renamed with their paragraphs (the copies under the old numbers are removed): {', '.join(gone)}")
    if kept:
        out(f"No longer in the script, moved to {rel(ndir / 'older')}/: {', '.join(Path(k).name for k in kept)}")


def settings_text(vs: dict) -> str:
    return ", ".join(f"{k.replace('use_speaker_boost', 'speaker boost').replace('similarity_boost', 'similarity')} "
                     f"{('on' if v else 'off') if isinstance(v, bool) else v}" for k, v in sorted(vs.items()))


def take_words(path: Path, b: Block) -> tuple[list[dict], np.ndarray]:
    rec = read_json(side(path, ".alignment.json")) or {}
    al = rec.get("alignment") or rec.get("normalized_alignment")
    if not al:
        why = rec.get("missing") or "its .alignment.json is missing or empty"
        raise Fail(ERROR, f"{rel(path)} has no word timings ({why}): delete it with its .request.json and "
                          f".alignment.json to generate it again with --model {TTS_MODEL}, or time narration.wav with "
                          f"align.py song --no-separate")
    return block_words(b, al), decode(path)


def report_takes(out: Out, b: Block, paths: list[Path], base: list[str], title: str | None = None) -> None:
    """Measured facts per take of one block, to choose by ear with numbers beside it."""
    out(title or f"Takes of block {b.n} (same text and settings, different seeds):")
    out(f"  {'take':5s} {'voice':>7s} {'words/min':>9s} {'loudness':>9s} {'worst edge':>11s}  file")
    rows = []
    for i, p in enumerate(paths, 1):
        if not p.is_file():
            continue
        words, y = take_words(p, b)
        snd = analyze(y, SR)
        ws = [W(k, x["w"], x["start"], x["end"], 0, x) for k, x in enumerate(words)]
        stt = edge_stats(match(ws, snd).edges)
        span = (snd.last_off - snd.first_on) if snd.first_on is not None else 0.0
        wpm = len(words) / span * 60 if span > 0 else 0.0
        lo = loudness(y=y)
        rec = read_json(side(p, ".request.json")) or {}
        rows.append({"take": i, "file": rel(p), "seed": ((rec.get("request") or {}).get("body") or {}).get("seed"),
                     "voice_s": r3(span), "words_per_min": round(wpm), "lufs": round(lo["I"], 1) if math.isfinite(lo["I"]) else None,
                     "worst_edge_ms": stt.get("worst_ms")})
        out(f"  {i:<5d} {span:6.2f}s {wpm:9.0f} {fmt_lufs(lo['I']):>9s} "
            f"{(format(stt['worst_ms'], '+.0f') + ' ms') if stt.get('edges') else '-':>11s}  {rel(p)}")
    out.data.setdefault("takes", []).extend(rows)
    if len(paths) > 1:
        out(f"Listen, then keep one (no API call): {me(*base, '--pick', 'K', '--block', b.n)}")


def assemble_narration(out: Out, w: Where, script: Path, blocks: list[Block], paths: list[Path], voice: str,
                       vname: str | None, model: str, vs: dict, gap: float, lead: float, tail: float, snap_on: bool,
                       lufs: float | None, base: list[str], words_sha_prev: str | None, made: list[int]) -> str | None:
    """narration.wav and words.json from the blocks. Returns the sha256 of the words.json this script
    wrote (kept from before when the file on disk was edited and nothing it is made from changed).
    `made`: the blocks this run paid for, which nobody has heard yet."""
    ys, blk_words, ons, offs = [], [], [], []
    for b, p in zip(blocks, paths):
        words, y = take_words(p, b)
        snd = analyze(y, SR)
        if snd.first_on is None:
            raise Fail(ERROR, f"{rel(p)} is silent: delete it to generate it again")
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
    # level: the stem plays at a calm piece's loudness in the preview; mix.py sets the final balance
    gain_db = 0.0
    if lufs is not None:
        m = loudness(y=mix)
        if math.isfinite(m["I"]):
            gain_db = lufs - m["I"]
            if m["TP"] + gain_db > TP_MAX:
                gain_db = TP_MAX - m["TP"]
            mix *= np.float32(10 ** (gain_db / 20))
    wav_path = w.audio_dir / "narration.wav"
    pcm = to_pcm16(mix)
    data = wav_bytes(pcm)
    changed = write_bytes(wav_path, data)
    asha = sha256_bytes(data)
    y_out = pcm.astype(np.float32) / 32768.0  # the samples in the file, as ffmpeg (and align.py) decode them

    # words on the narration's timeline, then every phrase edge measured on the file just written
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
    m_out = loudness(path=wav_path)
    sil = []  # the silence heard between blocks: the longest quiet run around each join, on the file
    for i in range(len(blocks) - 1):
        a0 = (segs[i][0] + int(round(offs[i] * SR)) - segs[i][1]) / SR
        b0 = (segs[i + 1][0] + int(round(ons[i + 1] * SR)) - segs[i + 1][1]) / SR
        k0, k1 = np.searchsorted(snd.t, a0 - 0.1), np.searchsorted(snd.t, b0 + 0.1)
        sil.append(max((b - a for a, b in runs(snd.db[k0:k1] <= snd.thr)), default=0) * HOP_S)
    words_doc = {
        "lines": lines,
        "notes": (f"Narration by ElevenLabs text-to-speech with timestamps (eleven.py tts): voice "
                  f"{vname + ' (' + voice + ')' if vname else voice}, model {model}. One line per paragraph (block) of {script.name}, in order; each block is one request, "
                  f"and the blocks follow one another with {gap:g} s of silence between them, so the picture can cut "
                  f"there. Times are seconds on audio/narration.wav: t = 0 is its first sample, which is t = 0 of "
                  f"ffmpeg's gapless decode and of the browser's decodeAudioData. w is the word as shown; spoken is "
                  f"what the voice said when the say map respelled it (find words by w). Word times come from the "
                  f"API's character timings; phrase edges (words next to a pause of 150 ms or more) were measured "
                  f"against the waveform: {edge_line(before, 'before snapping' if snap_on else '')}"
                  + ("; snapped: those edges now sit on the measured sound." if snap_on and rep.edges else
                     "; not snapped (--no-snap)." if rep.edges else ".")),
        "audioSha256": asha,
        "source": {"kind": "narration", "tool": TOOL, "audio": "audio/narration.wav", "duration": r3(total),
                   "voice_id": voice, "model_id": model, "voice_settings": vs, "gap": gap, "lead": lead, "tail": tail,
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

    nwords = sum(len(l["words"]) for l in lines)
    out(f"Narration: {rel(wav_path)}  {total:.2f} s, {len(blocks)} blocks, {nwords} words"
        + ("" if changed else " (unchanged)"))
    out(f"  loudness {fmt_lufs(m_out['I'])} LUFS (mono, measured as dual mono: as it plays on two speakers), true "
        f"peak {m_out['TP']:.1f} dBTP, range {m_out['LRA']:.1f} LU (measured on the file; a stem: mix.py sets the "
        f"final balance" + (f"; levelled {gain_db:+.1f} dB toward {lufs:g} LUFS" if lufs is not None else "; native level")
        + ")")
    if sil:
        out(f"  silence between blocks: {min(sil):.2f}-{max(sil):.2f} s (measured; --gap {gap:g})")
    if words_state == "kept":
        out(f"Word timings: {rel(words_path)} was edited since eleven.py wrote it, and nothing it is made from has "
            f"changed: kept as it is (lines = blocks).")
    else:
        out(f"Word timings: {rel(words_path)} ({words_state}; lines = blocks; scenes find words by what is shown: "
            f"words.get('{lines[0]['words'][0]['w']}'), words.findWords('...'))")
        if kept_copy is not None:
            out(f"  it had been edited since eleven.py wrote it, and the narration changed, so it was rewritten: the "
                f"edited copy is {rel(kept_copy)}")
    out(f"Phrase edges vs the waveform: {edge_line(before, 'before snapping' if snap_on else '')}.")
    if snap_on and rep.edges:
        out(f"  snapped: moved {moved} words onto the measured sound; re-measured: {edge_line(after)}.")
    elif rep.edges and before.get("beyond_tolerance"):
        out(f"  Move them onto the sound (no API call): {me(*base, '--snap')}")
    for a0, b0, inside in rep.unexplained[:4]:
        out(f"  pause {a0:.2f}-{b0:.2f} s matches no gap between words" + (f" (inside '{inside}')" if inside else ""))
    if not snd.usable:
        out("  warning: the background is too close to the voice to see pauses reliably")
    out(f"Settings: voice {vname or voice}, {model}, {settings_text(vs)}; gap {gap:g} s, lead {lead:g} s, tail {tail:g} s "
        f"(kept in {rel(w.audio_dir / 'narration' / 'narration.json')}).")
    report_plan(out, "block", [(b.n, p) for b, p in zip(blocks, paths)], "tts")
    # outside a project the review files follow the run's --out, so they land beside the rest of the delivery
    place = ["--video", w.name] if w.name else (["--out", rel(w.base)] if rel(w.base) != "." else [])
    if Path(__file__).resolve().with_name("align.py").is_file():
        out(f"Review image of the words over the waveform: uv run {q(script_path('align.py'))} check {q(rel(wav_path))}"
            + ("" if w.name else f" --words {q(rel(words_path))}") + "".join(f" {q(x)}" for x in place))
    secs = n / SR
    # a transcript stt kept for this very file (named as cmd_stt names it; a --language one ends in .<code>)
    transcript = f"{wav_path.stem}.{asha[:12]}.{STT_MODEL}"
    done = sorted((w.review_dir / "stt").glob(f"{transcript}*.json"), key=lambda p: len(p.name))
    lang = done[0].name[len(transcript):-len(".json")].lstrip(".") if done else ""
    stt = me("stt", *([] if w.name else [rel(wav_path), "--expect", rel(words_path)]), *place,
             *(["--language", lang] if lang else []))
    ears = ("every block (all made just now)" if made and len(made) == len(blocks) else
            f"block{'s' if len(made) > 1 else ''} {', '.join(map(str, made))} (made just now) and any other block "
            f"nobody has heard" if made else "the blocks nobody has heard")
    if done:
        out(f"Not checked yet: by ear, {ears}; listen before handing it over. What the audio says was transcribed "
            f"already: {stt} shows the comparison again (free).")
    else:
        out(f"Not checked yet: what the audio says (words.json repeats the script) and, by ear, {ears}. Listen, or: "
            f"{stt} (about {num(STT_CREDITS_PER_MIN * secs / 60)} credits; asks first).")
    if w.video_dir is not None:
        out(f"Preview with it: \"audio\": \"audio/narration.wav\" in {rel(w.video_dir / 'video.json')} (or mix.py's mix).")
    out.data.update({
        "narration": {"file": rel(wav_path), "duration": r3(total), "lufs": round(m_out["I"], 1),
                      "loudness_convention": "dual mono", "true_peak": round(m_out["TP"], 1),
                      "lra": round(m_out["LRA"], 1), "sha256": asha,
                      "silence_between_blocks": [round(x, 3) for x in sil], "changed": changed},
        "words": {"file": rel(words_path), "lines": len(lines), "words": nwords, "state": words_state,
                  "edited_copy": rel(kept_copy) if kept_copy is not None else None},
        "edges": {"before": before, "snapped": bool(snap_on and rep.edges), "moved": moved, "after": after,
                  "unexplained_pauses": [{"start": r3(x), "end": r3(y), "inside": s} for x, y, s in rep.unexplained]},
        "blocks": [{"block": b.n, "file": rel(p), "start": l["start"], "end": l["end"]}
                   for b, p, l in zip(blocks, paths, lines)],
    })
    return written_sha


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


# ---------------------------------------------------------------------------------------------
# music


def parse_sections(spec: str, flag: str) -> list[tuple[str, float]]:
    out = []
    for part in [p.strip() for p in spec.split(",") if p.strip()]:
        m = re.fullmatch(r"(.+?)\s*:\s*(\d+(?:\.\d+)?)\s*s?", part)
        if not m:
            raise Fail(USAGE, f"{flag}: {part!r} is not name:seconds (e.g. \"intro:0,build:8,hit:20,resolve:22\")")
        out.append((m.group(1).strip(), float(m.group(2))))
    if not out:
        raise Fail(USAGE, f"{flag} is empty")
    return out


def fit_sections(secs: list[tuple[str, float]]) -> tuple[list[dict], list[str]]:
    """Section lengths -> chunks the API accepts (3-120 s, at most 30). A section under 3 s merges into
    the next one, so the chunk still starts where the short section starts (where its hit lands); a
    short last section merges back into the one before. Only then is a chunk over 120 s split into
    equal parts (each over 60 s), so no merge can push one past the limit. Boundaries are kept to the
    millisecond."""
    notes: list[str] = []
    bounds = np.round(np.cumsum([0.0] + [d for _, d in secs]) * 1000).astype(int)
    items = [(name, int(bounds[i]), int(bounds[i + 1])) for i, (name, _) in enumerate(secs)]
    merged: list[list] = []  # [names, start_ms, end_ms]
    carry: tuple[list[str], int] | None = None
    for name, s, e in items:
        names, s0 = (carry[0] + [name], carry[1]) if carry else ([name], s)
        carry = None
        if e - s0 < MIN_CHUNK_S * 1000:
            carry = (names, s0)
            continue
        if len(names) > 1:
            notes.append(f"{' + '.join(names)}: merged into one chunk of {(e - s0) / 1000:g} s (a chunk lasts at least "
                         f"{MIN_CHUNK_S:g} s); it starts at {s0 / 1000:g} s, where {names[0]} starts")
        merged.append([names, s0, e])
    if carry:
        if not merged:
            raise Fail(USAGE, f"the music must last at least {MIN_CHUNK_S:g} s")
        notes.append(f"{' + '.join(carry[0])} ({(items[-1][2] - carry[1]) / 1000:g} s) is under {MIN_CHUNK_S:g} s at "
                     f"the end: joined to {' + '.join(merged[-1][0])}")
        merged[-1][0] = merged[-1][0] + carry[0]
        merged[-1][2] = items[-1][2]
    res: list[list] = []
    for names, s, e in merged:
        label = " + ".join(names)
        if e - s <= MAX_CHUNK_S * 1000:
            res.append([label, s, e])
            continue
        k = math.ceil((e - s) / (MAX_CHUNK_S * 1000))
        cut = [s + round((e - s) * i / k) for i in range(k + 1)]
        res += [[f"{label} ({i + 1}/{k})", cut[i], cut[i + 1]] for i in range(k)]
        notes.append(f"{label} ({(e - s) / 1000:g} s) is longer than the {MAX_CHUNK_S:g} s a chunk can be: split in {k}")
    if len(res) > MAX_CHUNKS:
        raise Fail(USAGE, f"{len(res)} sections; a plan holds at most {MAX_CHUNKS}: group scenes into fewer sections")
    return [{"name": nm, "start": s / 1000, "end": e / 1000, "start_ms": s, "end_ms": e} for nm, s, e in res], notes


def narration_sections(w: Where, length: float | None) -> list[tuple[str, float]]:
    doc = read_json(w.data_dir / "words.json")
    if not isinstance(doc, dict) or not doc.get("lines"):
        raise Fail(USAGE, f"--from-narration needs {rel(w.data_dir / 'words.json')} from eleven.py tts")
    total = float((doc.get("source") or {}).get("duration") or 0)
    if not total:
        wav = w.audio_dir / "narration.wav"
        if not wav.is_file():
            raise Fail(USAGE, f"--from-narration: no duration in words.json and no {rel(wav)}")
        total = len(decode(wav)) / SR
    lines = doc["lines"]
    groups: list[list[dict]] = []
    for l in lines:  # chapters when the script has them (# headings), else one section per block
        if groups and l.get("chapter") is not None and groups[-1][0].get("chapter") == l.get("chapter"):
            groups[-1].append(l)
        else:
            groups.append([l])
    cuts = [0.0]
    for g0, g1 in zip(groups, groups[1:]):
        e, s = float(g0[-1]["end"]), float(g1[0]["start"])
        cuts.append(e + CUT_AT * max(0.0, s - e))
    end = max(total, length or 0.0)
    cuts.append(end)
    names = [g[0].get("chapter") or (f"block {g[0].get('block', g[0].get('i', 0) + 1)}") for g in groups]
    return [(nm, cuts[i + 1] - cuts[i]) for i, nm in enumerate(names)]


RULE_FIRST_NEG = ["long intro", "slow fade-in"]
RULE_LAST_POS = ["clear resolved final chord", "natural ring-out"]
RULE_LAST_NEG = ["fade-out", "abrupt ending"]


def add_styles(lst: list, items: list[str]) -> list:
    have = {s.lower() for s in lst}
    return (lst + [s for s in items if s.lower() not in have])[:50]


def lyric_lines(text: str) -> list[str]:
    """Sung lines of a chunk's text: not the [Section] label, not {cues}."""
    out = []
    for line in str(text).splitlines():
        s = re.sub(r"\{[^}]*\}", "", line).strip()
        if s and not re.fullmatch(r"\[[^\]]*\]", s):
            out.append(s)
    return out


def apply_rules(chunks: list[dict], vocals: bool) -> None:
    """The brief's music rules, written into the plan itself (a plan is sent without the prompt)."""
    for c in chunks:
        c.setdefault("positive_styles", [])
        c.setdefault("negative_styles", [])
        if not vocals:
            c["positive_styles"] = add_styles(c["positive_styles"], ["instrumental"])
            c["negative_styles"] = add_styles(c["negative_styles"], ["vocals"])
    chunks[0]["negative_styles"] = add_styles(chunks[0]["negative_styles"], RULE_FIRST_NEG)
    chunks[-1]["positive_styles"] = add_styles(chunks[-1]["positive_styles"], RULE_LAST_POS)
    chunks[-1]["negative_styles"] = add_styles(chunks[-1]["negative_styles"], RULE_LAST_NEG)


def validate_chunks(chunks: list) -> list[str]:
    bad = []
    if not isinstance(chunks, list) or not 1 <= len(chunks) <= MAX_CHUNKS:
        return [f"a plan needs 1-{MAX_CHUNKS} chunks"]
    total = 0
    for i, c in enumerate(chunks, 1):
        if not isinstance(c, dict):
            bad.append(f"chunk {i} is not an object")
            continue
        if "song_id" in c:  # an audio-reference chunk (inpainting) keeps a stored slice as it is
            continue
        d = c.get("duration_ms")
        if not isinstance(d, int) or not MIN_CHUNK_S * 1000 <= d <= MAX_CHUNK_S * 1000:
            bad.append(f"chunk {i}: duration_ms {d!r} must be a whole number from 3000 to 120000")
        else:
            total += d
        if len(str(c.get("text", ""))) > 6132:
            bad.append(f"chunk {i}: text over 6,132 characters")
        if not c.get("positive_styles"):
            bad.append(f"chunk {i}: positive_styles is empty")
        for k in ("positive_styles", "negative_styles"):
            if len(c.get(k) or []) > 50:
                bad.append(f"chunk {i}: more than 50 {k}")
    if total and not 3000 <= total <= 600000:
        bad.append(f"total {total / 1000:g} s: must be 3 s to 10 min")
    return bad


def cmd_music_plan(a, out: Out) -> None:
    w = where(a.video, a.out)
    modes = sum(bool(x) for x in (a.sections, a.lengths, a.from_narration))
    if modes > 1:
        raise Fail(USAGE, "use one of --sections, --lengths or --from-narration")
    secs: list[dict] = []
    notes: list[str] = []
    requested: list[tuple[str, float]] = []
    if a.sections:  # start times, the first at 0, as beats.py --sections takes them
        starts_in = parse_sections(a.sections, "--sections")
        starts = [t for _, t in starts_in]
        if starts[0] != 0:
            raise Fail(USAGE, f"--sections takes start times, the first at 0 (\"intro:0,build:8,hit:20,resolve:22\" "
                              f"with --length 30); {a.sections!r} looks like lengths: use --lengths for those")
        if any(b <= x for x, b in zip(starts, starts[1:])):
            raise Fail(USAGE, "--sections: the start times must increase")
        if not a.length or a.length <= starts[-1]:
            raise Fail(USAGE, f"--sections gives start times: add --length, the total in seconds (after "
                              f"{starts[-1]:g})")
        requested = [(nm, e - s) for (nm, s), e in zip(starts_in, starts[1:] + [a.length])]
    elif a.lengths:
        if a.length:
            raise Fail(USAGE, "--lengths add up to the total: leave out --length")
        requested = parse_sections(a.lengths, "--lengths")
        if any(d <= 0 for _, d in requested):
            raise Fail(USAGE, "--lengths: every section needs a length over 0 s")
    elif a.from_narration:
        requested = narration_sections(w, a.length)
    if requested:
        secs, notes = fit_sections(requested)
        total_ms = secs[-1]["end_ms"]
        bad = [f"{s['name']} lasts {(s['end_ms'] - s['start_ms']) / 1000:g} s" for s in secs
               if not MIN_CHUNK_S * 1000 <= s["end_ms"] - s["start_ms"] <= MAX_CHUNK_S * 1000]
        if bad:  # fit_sections makes this impossible; checked anyway before any call
            raise Fail(USAGE, f"a chunk lasts {MIN_CHUNK_S:g} to {MAX_CHUNK_S:g} s: " + "; ".join(bad))
    else:
        total_ms = int(round((a.length or 0) * 1000)) or None
    if total_ms is not None and not 3000 <= total_ms <= 600000:
        raise Fail(USAGE, f"the music must last 3 s to 10 min (asked: {total_ms / 1000:g} s)")
    if total_ms and total_ms > 300000:
        notes.append("over 5 minutes: ElevenLabs documents a 5-minute limit in places; split it if compose refuses")
    slug = a.name or slugify(a.prompt)
    plan_path = w.audio_dir / "music" / f"{slug}.plan.json"
    if plan_path.exists() and not a.replace:
        raise Fail(USAGE, f"{rel(plan_path)} exists (it may hold the director's edits): pass --replace to overwrite "
                          f"it, or --name for another plan")
    rules = ["Starts immediately on the first beat, no long intro.",
             "A clear, resolved final chord at the start of the last section, then a natural ring-out."]
    if not a.vocals:
        rules.append("Instrumental, no vocals.")
    if secs:
        rules.append("Structure: " + "; ".join(f"{s['name']} {(s['end_ms'] - s['start_ms']) / 1000:g} s" for s in secs) + ".")
    prompt = a.prompt.strip() + "\n" + " ".join(rules)
    if len(prompt) > 4100:
        raise Fail(USAGE, f"the prompt is {len(prompt)} characters with the rules added; the API takes 4,100")
    key = get_key()
    if not key:
        raise no_key("the composition plan (a free call, but it needs a key)", done="made")
    api = Api(key)
    body = {"prompt": prompt, "model_id": MUSIC_MODEL}
    if total_ms:
        body["music_length_ms"] = total_ms
    note("music plan: asking for a composition plan (free)")
    resp = api.call("POST", "/v1/music/plan", "music plan", json=body).json()
    chunks = resp.get("chunks") if isinstance(resp, dict) else None
    if not chunks:
        raise Fail(ERROR, f"music plan: the response has no chunks (got {str(resp)[:200]})")
    if secs:  # the director's sections, with the styles the model suggested for each part of the song
        api_total = sum(int(c.get("duration_ms", 0)) for c in chunks) or 1
        api_bounds = np.cumsum([0] + [int(c.get("duration_ms", 0)) for c in chunks])
        used_lyrics: set[int] = set()
        new = []
        for s in secs:
            mid = (s["start_ms"] + s["end_ms"]) / 2 * api_total / secs[-1]["end_ms"]
            k = int(min(len(chunks) - 1, max(0, np.searchsorted(api_bounds, mid, side="right") - 1)))
            src = chunks[k]
            lyr = lyric_lines(src.get("text", "")) if k not in used_lyrics else []
            used_lyrics.add(k)
            new.append({"text": "\n".join([f"[{s['name']}]"] + lyr), "duration_ms": s["end_ms"] - s["start_ms"],
                        "positive_styles": list(src.get("positive_styles") or []),
                        "negative_styles": list(src.get("negative_styles") or []),
                        "context_adherence": src.get("context_adherence", "high")})
        chunks = new
    apply_rules(chunks, a.vocals)
    bad = validate_chunks(chunks)
    if bad:
        raise Fail(ERROR, "music plan: the plan is not valid: " + "; ".join(bad))
    starts = np.cumsum([0] + [int(c["duration_ms"]) for c in chunks])
    sections = [{"name": (re.match(r"\[([^\]]+)\]", str(c.get("text", ""))) or [None, f"chunk {i + 1}"])[1],
                 "start": starts[i] / 1000, "end": starts[i + 1] / 1000} for i, c in enumerate(chunks)]
    doc = {"notes": ("Composition plan for review (eleven.py music plan; the plan call is free). Edit composition_plan "
                     "(chunk text, styles, durations) if needed, then: eleven.py music compose --plan <this file>. "
                     f"{MUSIC_MODEL} enforces chunk durations, so chunk i starts at the sum of the chunks before it."),
           "prompt": a.prompt, "prompt_sent": prompt, "model_id": MUSIC_MODEL, "vocals": a.vocals,
           "requested_sections": [{"name": nm, "seconds": d} for nm, d in requested] or None,
           "merged": notes or None, "sections": sections, "composition_plan": {"chunks": chunks},
           "api_plan": resp, "created": now(), "tool": TOOL}
    write_json(plan_path, doc)
    total = starts[-1] / 1000
    out(f"Plan: {rel(plan_path)}  {total:g} s in {len(chunks)} chunks, {MUSIC_MODEL} (free; nothing generated)")
    out(f"  {'#':>2s} {'start':>7s} {'end':>7s}  {'section':22s} styles")
    for i, (c, s) in enumerate(zip(chunks, sections), 1):
        out(f"  {i:2d} {s['start']:7.2f} {s['end']:7.2f}  {str(s['name'])[:22]:22s} "
            f"{', '.join(c['positive_styles'][:6])}{' ...' if len(c['positive_styles']) > 6 else ''}")
    for x in notes:
        out(f"  {x}")
    cost = MUSIC_CREDITS_PER_MIN * total / 60
    out(f"Composing it costs about {num(cost)} credits per take (about ${MUSIC_USD_PER_MIN * total / 60:.2f} at API "
        f"prices); two takes, {num(2 * cost)}. Review the plan with the director, then (shows the cost; add --yes):")
    out("  " + me("music", "compose", "--plan", rel(plan_path), *place_args(a), "--takes", "2"))
    out.data.update({"plan": rel(plan_path), "total_s": total, "chunks": len(chunks), "sections": sections,
                     "merged": notes, "credits_per_take": round(cost)})


def parse_multipart_mixed(content_type: str, body: bytes) -> list[tuple[dict, bytes]]:
    """multipart/mixed parts as (headers, payload). The payload ends before the CRLF that precedes
    the next delimiter, so no boundary bytes leak into the audio (the official Python SDK keeps them)."""
    m = re.search(r'boundary="?([^";\s]+)"?', content_type or "", re.I)
    delim = b"--" + m.group(1).encode() if m else body.split(b"\n", 1)[0].strip()
    first = body.find(delim)
    if first == -1:
        raise Fail(ERROR, "music compose: the response is not multipart (no boundary found)")
    nl = b"\r\n" if body[first + len(delim):first + len(delim) + 2] == b"\r\n" else b"\n"
    parts = []
    for chunk in body[first:].split(nl + delim):
        if chunk.startswith(delim):
            chunk = chunk[len(delim):]
        if chunk.startswith(b"--"):
            break
        if chunk.startswith(nl):
            chunk = chunk[len(nl):]
        sep = chunk.find(nl + nl)
        if sep == -1:
            continue
        raw, payload = chunk[:sep], chunk[sep + 2 * len(nl):]
        headers = {k.strip().lower(): v.strip() for k, v in
                   (ln.split(":", 1) for ln in raw.decode("latin-1").split(nl.decode()) if ":" in ln)}
        parts.append((headers, payload))
    return parts


def music_takes_report(out: Out, w: Where, slug: str, takes: list[tuple[int, Path]], sections: list[dict],
                       target: float) -> list[dict]:
    rows = []
    cmp_dir = w.review_dir / "music"
    for k, p in takes:
        lo = loudness(path=p, series=True)
        I, t, M = lo["I"], lo["t"], lo["M"]
        dur = len(decode(p)) / SR
        flags = []
        arrive = float(t[np.argmax(M >= I - ARRIVE_LU)]) if len(M) and (M >= I - ARRIVE_LU).any() else None
        if arrive is None or arrive > ARRIVE_MAX_S:
            flags.append(f"slow intro (music arrives at {arrive:.1f} s)" if arrive is not None else "never arrives")
        hold = float(t[np.flatnonzero(M >= I - HOLD_LU)[-1]]) if len(M) and (M >= I - HOLD_LU).any() else 0.0
        if dur - hold > RINGOUT_S:
            flags.append(f"early decay (down {HOLD_LU:g} LU from {hold:.1f} s, {dur - hold:.1f} s before the end)")
        planned = sections[-1]["end"] if sections else None
        if planned and abs(dur - planned) > 0.1:
            flags.append(f"length {dur:.2f} s, planned {planned:g} s")
        # 1 s loudness (energy mean of the 400 ms windows), dips against the section's own median
        pw = np.where(np.isfinite(M), 10 ** (M / 10), 0.0)
        k1 = 10  # 10 x 100 ms
        L1 = 10 * np.log10(np.convolve(pw, np.ones(k1) / k1, mode="same") + 1e-12)
        sec_lu = []
        for s in sections:
            sel = (t >= s["start"] + 0.5) & (t <= s["end"] - 0.1)
            if sel.sum() < 5:
                sec_lu.append(None)
                continue
            med = float(np.median(L1[sel]))
            sec_lu.append(round(med - I, 1) if math.isfinite(I) else None)
            low = sel & (L1 < med - DIP_LU)
            for a0, b0 in runs(low):
                if (b0 - a0) * 0.1 >= 1.0:
                    flags.append(f"dip in {s['name']} at {t[a0]:.1f}-{t[b0 - 1]:.1f} s")
        # the comparison copy: the same integrated loudness for every take (gain, then a limiter at
        # -1.5 dBFS sample peak so true peak stays near -1 dBTP), measured again after
        cmp_path = cmp_dir / f"{slug}.take{k}.compare.wav"
        made = level_copy(p, cmp_path, I, target) if math.isfinite(I) else None
        rows.append({"take": k, "file": rel(p), "seconds": r3(dur), "lufs": round(I, 1), "lra": round(lo["LRA"], 1),
                     "true_peak": round(lo["TP"], 1), "arrives_s": arrive, "holds_to_s": r3(hold),
                     "section_lu": dict(zip([s["name"] for s in sections], sec_lu)), "flags": flags,
                     "compare": rel(cmp_path) if made else None, "compare_lufs": made})
    return rows


def level_copy(src: Path, dst: Path, measured: float, target: float) -> float | None:
    gain = target - measured
    lim = 10 ** (-1.5 / 20)
    dst.parent.mkdir(parents=True, exist_ok=True)
    for _ in range(2):
        r = subprocess.run([tool("ffmpeg"), "-v", "error", "-nostdin", "-y", "-i", str(src), "-af",
                            f"volume={gain:.2f}dB,alimiter=limit={lim:.4f}:attack=5:release=50:level=disabled",
                            "-c:a", "pcm_s16le", str(dst)], capture_output=True)
        if r.returncode != 0:
            raise Fail(ERROR, f"ffmpeg could not level {rel(src)}: {r.stderr.decode(errors='replace')[-300:]}")
        got = loudness(path=dst)["I"]
        if not math.isfinite(got) or abs(got - target) <= 0.3:
            return round(got, 1) if math.isfinite(got) else None
        gain += target - got  # the limiter took some loudness: one correction pass
    return round(got, 1)


MUSIC_SIDES = (".request.json", ".meta.json")


def cmd_music_compose(a, out: Out) -> None:
    tool("ffmpeg")  # checked before anything is spent: every take is measured once it arrives
    plan_path = Path(a.plan)
    if not plan_path.is_file():
        raise Fail(USAGE, f"plan not found: {a.plan} (make one with: {me('music', 'plan')} \"<prompt>\" --sections ...)")
    plan_path = plan_path.resolve()
    w = where(a.video, a.out, [plan_path])  # a plan inside videos/<video>/ belongs to that video
    doc = read_json(plan_path) or {}
    plan = doc.get("composition_plan") if isinstance(doc, dict) and "composition_plan" in doc else doc
    chunks = plan.get("chunks") if isinstance(plan, dict) else None
    bad = validate_chunks(chunks) if chunks else ["no composition_plan.chunks"]
    if bad:
        raise Fail(USAGE, f"{rel(plan_path)}: " + "; ".join(bad))
    slug = plan_path.name[:-len(".plan.json")] if plan_path.name.endswith(".plan.json") else plan_path.stem
    fmt = a.format or DEFAULT_FORMAT
    ext = ext_for(fmt, "music")
    mdir = w.audio_dir / "music"
    tdir = mdir / "takes"
    lyrics = any(lyric_lines(c.get("text", "")) for c in chunks if "song_id" not in c)
    starts = np.cumsum([0] + [int(c.get("duration_ms") or (c.get("range", {}).get("end_ms", 0) -
                                                         c.get("range", {}).get("start_ms", 0))) for c in chunks])
    total = starts[-1] / 1000
    sections = [{"name": (re.match(r"\[([^\]]+)\]", str(c.get("text", ""))) or [None, f"chunk {i + 1}"])[1],
                 "start": starts[i] / 1000, "end": starts[i + 1] / 1000} for i, c in enumerate(chunks)]
    if a.pick is not None and a.takes is not None:
        raise Fail(USAGE, "compose the takes first, listen, then --pick one")
    ntakes = a.takes if a.takes is not None else 2
    if not 1 <= ntakes <= 5:
        raise Fail(USAGE, "--takes: 1 to 5 (2-3 to compare)")
    seed0 = a.seed if a.seed is not None else 1
    this_plan = json.dumps({"chunks": chunks}, sort_keys=True)

    def req(k: int) -> dict:
        body = {"composition_plan": {"chunks": chunks}, "model_id": MUSIC_MODEL, "seed": seed0 + k - 1}
        if lyrics:
            body["with_timestamps"] = True
        return {"method": "POST", "path": "/v1/music/detailed", "query": {"output_format": fmt}, "body": body}

    def tpath(k: int) -> Path:
        return tdir / f"{slug}.take{k}{ext}"

    def fresh(k: int) -> bool:
        rec = read_json(side(tpath(k), ".request.json")) or {}
        return tpath(k).is_file() and json.dumps(rec.get("request"), sort_keys=True) == json.dumps(req(k), sort_keys=True)

    def on_disk() -> list[dict]:
        """The takes of this slug that exist, whatever seed or format they were made with."""
        rows = []
        for p in sorted(tdir.glob(f"{slug}.take*")) if tdir.is_dir() else []:
            m = re.fullmatch(re.escape(slug) + r"\.take(\d+)\.(mp3|wav)", p.name)
            if not m:
                continue
            r = (read_json(side(p, ".request.json")) or {}).get("request") or {}
            body = r.get("body") or {}
            rows.append({"take": int(m.group(1)), "path": p, "seed": body.get("seed"),
                         "format": (r.get("query") or {}).get("output_format"),
                         "same_plan": json.dumps(body.get("composition_plan"), sort_keys=True) == this_plan,
                         "mtime": p.stat().st_mtime})
        return rows

    if a.pick is not None:
        # found by its file and its record, not by rebuilding the request: a take made with --seed or
        # --format is picked without repeating them
        have = on_disk()
        rows = [r for r in have if r["take"] == a.pick and (not a.format or r["format"] == a.format)]
        good = [r for r in rows if r["same_plan"]]
        if not good:
            listing = "; ".join(f"take {r['take']} (seed {r['seed']}, {r['format']}"
                                + ("" if r["same_plan"] else ", from an earlier version of the plan") + ")"
                                for r in have) or "none"
            if rows:
                raise Fail(ERROR, f"take {a.pick} of {slug} was composed from an earlier version of "
                                  f"{rel(plan_path)}: compose this version first (--takes), or pick another take. "
                                  f"Takes here: {listing}")
            raise Fail(ERROR, f"there is no take {a.pick} of {slug}" + (f" in {a.format}" if a.format else "")
                       + f". Takes here: {listing}")
        src = max(good, key=lambda r: r["mtime"])["path"]
        main = mdir / f"{slug}{src.suffix}"
        keep_or_retire(main, tdir, MUSIC_SIDES)
        copy_set(src, main, MUSIC_SIDES, {"take": a.pick, "picked": now()})
        meta = read_json(side(src, ".meta.json")) or {}
        used = (meta.get("composition_plan") or {}).get("chunks") or chunks
        st = np.cumsum([0] + [int(c.get("duration_ms", 0)) for c in used])
        secs = [{"name": (re.match(r"\[([^\]]+)\]", str(c.get("text", ""))) or [None, f"chunk {i + 1}"])[1],
                 "start": r3(st[i] / 1000), "end": r3(st[i + 1] / 1000)} for i, c in enumerate(used)]
        sec_path = w.data_dir / "music-sections.json"
        write_json(sec_path, {"sections": secs, "duration": r3(len(decode(main)) / SR), "audio": rel_to(main, w.video_dir or w.base),
                              "notes": f"Sections of {main.name} from its composition plan: {MUSIC_MODEL} enforces chunk "
                                       "durations, so these are the planned boundaries (not measured here; beats.py "
                                       "on the file shows where the music really changes). Times in seconds of the "
                                       "file's gapless decode (t = 0 = its first sample)."})
        out(f"Music: take {a.pick} is now {rel(main)}.")
        report_plan(out, "take", [(a.pick, main)], "music")
        out(f"Sections from the plan: {rel(sec_path)}.")
        if Path(__file__).resolve().with_name("beats.py").is_file():
            spec = ",".join(f"{re.sub(r'[,:]', ' ', s['name'])}:{s['start']:g}" for s in secs)
            cmd = ["uv", "run", q(script_path("beats.py")), q(rel(main)), *[q(x) for x in place_args(a)],
                   "--sections", q(spec)]
            out("Beats, envelopes and these sections (kept exactly where the plan put them) in data/audio.json: "
                + " ".join(cmd))
        out.data.update({"music": rel(main), "sections_file": rel(sec_path), "sections": secs})
        wt = meta.get("words_timestamps") or []
        if wt:
            wpath, nlines, nwords, matched = write_song_words(w, main, chunks, wt)
            out(f"Sung words: {rel(wpath)} ({nwords} words in {nlines} lines; {matched} placed by the API's word "
                f"timestamps, the rest between them).")
            out.data["words"] = {"file": rel(wpath), "lines": nlines, "words": nwords, "matched": matched}
        return

    todo = [k for k in range(1, ntakes + 1) if not fresh(k)]
    # a take an earlier run had to save under a rescue name comes back for free (once the run goes ahead)
    rescued = {k: p for k in todo if (p := find_rescued(tpath(k), req(k))) is not None}
    todo = [k for k in todo if k not in rescued]
    if not todo or a.yes:
        for k, p in rescued.items():
            adopt_rescued(p, tpath(k), MUSIC_SIDES)
    if todo:
        est = {"takes": len(todo), "seconds_each": total,
               "credits": round(MUSIC_CREDITS_PER_MIN * total / 60 * len(todo)),
               "usd": round(MUSIC_USD_PER_MIN * total / 60 * len(todo), 3)}
        cost = (f"{len(todo)} take{'s' if len(todo) != 1 else ''} of {total:g} s = about {num(est['credits'])} credits "
                f"(about ${est['usd']:.2f} at API prices)")
        key = get_key()
        if not key:
            raise no_key("the music", [cost])
        api = Api(key)
        if not a.yes:
            out(f"Would compose {cost}, {MUSIC_MODEL}, seeds {', '.join(str(seed0 + k - 1) for k in todo)}, "
                f"{'with sung words' if lyrics else 'instrumental'}:")
            for s, c in zip(sections, chunks):
                out(f"  {s['start']:6.2f}-{s['end']:6.2f} s  {s['name']}: {', '.join((c.get('positive_styles') or [])[:5])}")
            out.data["account"] = account_line(subscription(api), "music")
            for x in out.data["account"]:
                out(x)
            raise confirm(out, "compose them", {"estimate": est})
        tier = subscription(api).get("tier")  # the plan the takes are made on: each record keeps it
        for i, k in enumerate(todo, 1):
            if tpath(k).is_file():  # moved aside before paying: a file a player holds open fails here, not after
                note(f"music: the earlier take {k} (another plan or seed) moves to {rel(retire(tpath(k), MUSIC_SIDES))}")
            note(f"music: composing take {k} ({i}/{len(todo)}, {total:g} s; this can take a minute or more)")
            r = req(k)
            resp = api.call("POST", r["path"], f"music take {k}", paid=True, params=r["query"], json=r["body"])
            raw = tdir / f"{slug}.take{k}.response.bin"  # the paid body as it came, kept until it is read
            write_bytes(raw, resp.content)
            meta, audio, fname = None, None, None
            try:
                for h, payload in parse_multipart_mixed(resp.headers.get("content-type", ""), resp.content):
                    if h.get("content-type", "").startswith("application/json"):
                        meta = json.loads(payload.decode("utf-8"))
                    elif payload:
                        audio = payload
                        fm = re.search(r'filename="?([^";]+)"?', h.get("content-disposition", ""))
                        fname = fm.group(1) if fm else None
            except (ValueError, Fail) as e:  # (json.JSONDecodeError and UnicodeDecodeError are ValueErrors)
                raise Fail(ERROR, f"music take {k}: the response could not be read ({e}). It was billed: the raw "
                                  f"response is kept as {rel(raw)}")
            if not audio:
                raise Fail(ERROR, f"music take {k}: the response had no audio part (it may still have been billed; "
                                  f"the raw response is kept as {rel(raw)})")
            save_paid(tpath(k), audio, {
                ".meta.json": meta or {},
                ".request.json": {"kind": "music", "request": r, "plan_file": rel_to(plan_path, w.base), "take": k,
                                  "generated": now(), "tier": tier, "tool": TOOL,
                                  "response": {"song_id": resp.headers.get("song-id"), "filename": fname,
                                               "audio_sha256": sha256_bytes(audio), "bytes": len(audio)}}},
                f"music take {k}")
            raw.unlink(missing_ok=True)
        out(f"Composed {len(todo)} take{'s' if len(todo) != 1 else ''}.")
    takes = [(k, tpath(k)) for k in range(1, ntakes + 1)]
    rows = music_takes_report(out, w, slug, takes, sections, a.lufs)
    out(f"Takes of {slug} ({total:g} s, plan {rel(plan_path)}), measured:")
    out(f"  {'take':4s} {'length':>8s} {'LUFS':>6s} {'LRA':>5s} {'dBTP':>6s} {'arrives':>8s} {'holds to':>9s}  flags")
    for r in rows:
        out(f"  {r['take']:<4d} {r['seconds']:7.2f}s {r['lufs']:6.1f} {r['lra']:5.1f} {r['true_peak']:6.1f} "
            f"{(format(r['arrives_s'], '.1f') + ' s') if r['arrives_s'] is not None else '-':>8s} "
            f"{r['holds_to_s']:8.1f}s  {'; '.join(r['flags']) or 'ok'}")
    for r in rows:
        shape = " | ".join(f"{nm} {v:+.1f}" for nm, v in r["section_lu"].items() if v is not None)
        if shape:
            out(f"  take {r['take']} sections (LU from its integrated level): {shape}")
    made = [r for r in rows if r["compare"]]
    if made:
        out(f"Compare by ear at the same loudness ({a.lufs:g} LUFS target; measured "
            f"{', '.join(str(r['compare_lufs']) for r in made)}):")
        for r in made:
            out(f"  {r['compare']}")
    report_plan(out, "take", takes, "music")
    out(f"Then keep one (no API call): {me('music', 'compose', '--plan', rel(plan_path), *place_args(a), '--pick', 'K')}")
    out("A library track the user owns, edited to the picture, can still beat these.")
    out.data.update({"plan": rel(plan_path), "takes": rows})


def write_song_words(w: Where, main: Path, chunks: list[dict], wt: list[dict]) -> tuple[Path, int, int, int]:
    """The API's word timestamps placed on the plan's lyric lines (the plan's text is what is shown)."""
    heard = [(str(x.get("word", "")), float(x.get("start_ms", 0)) / 1000, float(x.get("end_ms", 0)) / 1000)
             for x in wt if str(x.get("word", "")).strip() and not re.fullmatch(r"[\[{].*[\]}]", str(x.get("word", "")).strip())]
    shown: list[tuple[int, str]] = []
    texts = []
    for c in chunks:
        for line in lyric_lines(c.get("text", "")):
            texts.append(line)
            shown += [(len(texts) - 1, t) for t in line.split()]
    sm = SequenceMatcher(None, [say_key(t) for _, t in shown], [say_key(h[0]) for h in heard], autojunk=False)
    times: list[tuple[float, float] | None] = [None] * len(shown)
    for a0, b0, size in sm.get_matching_blocks():
        for x in range(size):
            times[a0 + x] = (heard[b0 + x][1], heard[b0 + x][2])
    matched = sum(1 for x in times if x is not None)
    i = 0
    while i < len(times):  # words the model sang differently share the time around them
        if times[i] is not None:
            i += 1
            continue
        j = i
        while j < len(times) and times[j] is None:
            j += 1
        t0 = times[i - 1][1] if i else (times[j][0] if j < len(times) else 0.0)
        t1 = times[j][0] if j < len(times) else t0 + 0.3 * (j - i)
        step = max(0.01, (t1 - t0) / (j - i))
        for x in range(i, j):
            times[x] = (t0 + step * (x - i), t0 + step * (x - i + 1))
        i = j
    lines = []
    for li, text in enumerate(texts):
        ws = [{"w": t, "start": r3(times[k][0]), "end": r3(max(times[k][1], times[k][0] + 0.001))}
              for k, (l2, t) in enumerate(shown) if l2 == li]
        if ws:
            lines.append({"i": len(lines), "text": " ".join(x["w"] for x in ws), "start": ws[0]["start"],
                          "end": ws[-1]["end"], "words": ws})
    existing = read_json(w.data_dir / "words.json")
    narrated = isinstance(existing, dict) and (existing.get("source") or {}).get("kind") == "narration"
    path = w.data_dir / ("song-words.json" if narrated else "words.json")
    write_json(path, {"lines": lines, "audioSha256": sha256_file(main),
                      "notes": f"Sung words of {main.name}, from ElevenLabs music word timestamps placed on the plan's "
                               "lyric lines. Times in seconds of the file's gapless decode (t = 0 = its first sample).",
                      "source": {"kind": "song", "tool": TOOL, "audio": rel_to(main, w.video_dir or w.base)}})
    return path, len(lines), sum(len(l["words"]) for l in lines), matched


# ---------------------------------------------------------------------------------------------
# sfx


def screen(path: Path, prompt: str | None = None) -> dict:
    """Measure an effect before anyone listens: where it starts (its onset, for placement), how
    long it sounds, and whether it reads as a boom, hiss or noise."""
    y = decode(path)
    win, hop = int(0.005 * SR), int(0.001 * SR)
    c = np.concatenate([[0.0], np.cumsum(y.astype(np.float64) ** 2)])
    ends = np.arange(hop, len(y) + 1, hop)
    if len(y) < win:
        return {"file": rel(path), "error": "shorter than 5 ms"}
    # trailing 5 ms window (silence before the file's start): no early bias, and a sound that starts at
    # the first sample reads 0 ms
    db = 10 * np.log10((c[ends] - c[np.maximum(ends - win, 0)]) / win + 1e-20)
    top = float(db.max())
    if top < -70:
        return {"file": rel(path), "error": "silent"}
    onset = float(ends[np.argmax(db >= top - ONSET_DB)] - hop) / SR  # the 1 ms step in which it crossed
    act = np.flatnonzero(db >= top - ACTIVE_DB)
    a0, a1 = ends[act[0]] / SR, ends[act[-1]] / SR
    peak_t = float(ends[int(np.argmax(db))] / SR - WIN_S / 2)
    seg = y[int(onset * SR):int(a1 * SR) + 1].astype(np.float64)
    nfft = 2048
    if len(seg) < nfft:
        seg = np.pad(seg, (0, nfft - len(seg)))
    frames = np.lib.stride_tricks.sliding_window_view(seg, nfft)[::nfft // 2] * np.hanning(nfft)
    P = np.abs(np.fft.rfft(frames, axis=1)) ** 2
    fr = np.fft.rfftfreq(nfft, 1 / SR)
    spec = P.sum(0)
    tot = spec.sum() + 1e-20
    low, high = float(spec[fr < 150].sum() / tot), float(spec[fr > 6000].sum() / tot)
    cen = float((spec * fr).sum() / tot)
    cum = np.cumsum(spec) / tot  # the effect's own band: the middle 60% of its energy, at least an octave
    lo_f = max(fr[np.searchsorted(cum, 0.2)], 40.0)  # and at least FLAT_BINS wide, or flatness means nothing
    hi_f = min(max(fr[np.searchsorted(cum, 0.8)], 2 * lo_f, lo_f + FLAT_BINS * SR / nfft), SR / 2 - 200)
    band = (fr >= lo_f) & (fr <= hi_f)
    fe = P.sum(1)
    flat_f = np.exp(np.log(P[:, band] + 1e-20).mean(1)) / (P[:, band].mean(1) + 1e-20)
    flat = float((flat_f * fe).sum() / (fe.sum() + 1e-20))
    dur = float(a1 - a0)
    noisy_ok = bool(prompt) and any(x in prompt.lower() for x in NOISY_WORDS)
    flags = []
    if low > BOOM_SHARE:
        flags.append("boomy")
    if high > HISS_SHARE:
        flags.append("hissy/clicky")
    if flat > NOISE_FLAT and dur >= NOISE_MIN_S and not noisy_ok:
        flags.append("noise-like")
    info = []
    if dur > LONG_S:
        info.append("long for a repeated transition")
    if onset >= 1 / 60:
        info.append(f"starts {onset * 1000:.0f} ms in: place it at the event minus {onset:.3f} s")
    score = low / BOOM_SHARE + high / HISS_SHARE + (0 if noisy_ok else flat / NOISE_FLAT)
    return {"file": rel(path), "onset_s": r3(onset), "peak_s": r3(peak_t), "rise_ms": round((peak_t - onset) * 1000),
            "active_s": r3(dur), "peak_dbfs": round(20 * math.log10(float(np.abs(y).max()) + 1e-12), 1),
            "below_150hz": round(low, 3), "above_6khz": round(high, 3), "centroid_hz": round(cen),
            "flatness": round(flat, 3), "band_hz": [round(float(lo_f)), round(float(hi_f))], "flags": flags,
            "notes": info, "score": round(score, 3), "verdict": "reject: " + ", ".join(flags) if flags else "ok"}


def rank_print(out: Out, rows: list[dict]) -> list[dict]:
    good = [r for r in rows if "error" not in r]
    good.sort(key=lambda r: (bool(r["flags"]), r["score"]))
    out(f"  {'rank':4s} {'onset':>7s} {'active':>7s} {'<150Hz':>7s} {'>6kHz':>6s} {'flat':>5s}  verdict  file")
    for i, r in enumerate(good, 1):
        out(f"  {i:<4d} {r['onset_s'] * 1000:5.0f}ms {r['active_s']:6.2f}s {r['below_150hz'] * 100:6.0f}% "
            f"{r['above_6khz'] * 100:5.0f}% {r['flatness']:5.2f}  {r['verdict']}  {r['file']}")
        for x in r["notes"]:
            out(f"         {x}")
    for r in rows:
        if "error" in r:
            out(f"  -    {r['file']}: {r['error']}")
    return good


SFX_SIDES = (".request.json",)


def cmd_sfx(a, out: Out) -> None:
    if a.screen:
        rows = [screen(Path(p)) if Path(p).is_file() else {"file": p, "error": "not found"} for p in a.screen]
        out(f"Screened {len(rows)} file{'s' if len(rows) != 1 else ''} (measured; cleanest first):")
        out.data["ranked"] = rank_print(out, rows)
        out("Place each by its onset (the event time minus onset_s), not by its file start.")
        return
    if not a.prompt:
        raise Fail(USAGE, "sfx needs a prompt (\"soft short whoosh\") or --screen FILE ...")
    tool("ffmpeg")  # checked before anything is spent: every candidate is screened once it arrives
    w = where(a.video, a.out)
    if a.duration is not None and not 0.5 <= a.duration <= 30:
        raise Fail(USAGE, "--duration: 0.5 to 30 seconds")
    if not 0 <= a.influence <= 1:
        raise Fail(USAGE, "--influence: 0 to 1")
    if not 1 <= a.n <= 10:
        raise Fail(USAGE, "--n: 1 to 10 candidates")
    fmt = a.format or DEFAULT_FORMAT
    ext = ext_for(fmt, "sfx")
    slug = a.name or slugify(a.prompt)
    sdir = w.audio_dir / "sfx"
    tdir = sdir / "takes"
    body = {"text": a.prompt, "model_id": SFX_MODEL, "prompt_influence": a.influence, "loop": a.loop}
    if a.duration is not None:
        body["duration_seconds"] = a.duration
    r = {"method": "POST", "path": "/v1/sound-generation", "query": {"output_format": fmt}, "body": body}

    def cpath(k: int) -> Path:
        return tdir / f"{slug}.take{k}{ext}"

    def fresh(k: int) -> bool:  # the API takes no seed: candidates of one request differ by chance
        rec = read_json(side(cpath(k), ".request.json")) or {}
        return cpath(k).is_file() and json.dumps(rec.get("request"), sort_keys=True) == json.dumps(r, sort_keys=True)

    if a.pick is not None:
        if not fresh(a.pick):
            raise Fail(ERROR, f"candidate {a.pick} of {slug} does not exist for this prompt and settings")
        main = sdir / f"{slug}{ext}"
        res = screen(cpath(a.pick), a.prompt)
        keep_or_retire(main, tdir, SFX_SIDES)
        copy_set(cpath(a.pick), main, SFX_SIDES, {"take": a.pick, "picked": now(), "measured": res})
        out(f"Effect: candidate {a.pick} is now {rel(main)}; onset {res['onset_s'] * 1000:.0f} ms (place it at the "
            f"event minus {res['onset_s']:.3f} s), peak at {res['peak_s']:.3f} s.")
        report_plan(out, "candidate", [(a.pick, main)], "sfx")
        out.data.update({"effect": rel(main), "measured": res})
        return
    todo = [k for k in range(1, a.n + 1) if not fresh(k)]
    # a candidate an earlier run had to save under a rescue name comes back for free (once the run goes ahead)
    rescued = {k: p for k in todo if (p := find_rescued(cpath(k), r)) is not None}
    todo = [k for k in todo if k not in rescued]
    if not todo or a.yes:
        for k, p in rescued.items():
            adopt_rescued(p, cpath(k), SFX_SIDES)
    if todo:
        each = SFX_CREDITS_PER_S * a.duration if a.duration else SFX_CREDITS_AUTO
        est = {"candidates": len(todo), "credits": round(each * len(todo)),
               "usd": round(SFX_USD_PER_MIN * (a.duration or SFX_AUTO_S) / 60 * len(todo), 3)}
        cost = (f"{len(todo)} candidate{'s' if len(todo) != 1 else ''} of "
                f"{str(a.duration) + ' s' if a.duration else 'a length the model picks'} = about {num(est['credits'])} "
                f"credits (about ${est['usd']:.2f} at API prices"
                + ("" if a.duration else f", counting {SFX_AUTO_S:g} s each") + ")")
        key = get_key()
        if not key:
            raise no_key("the sound effect", [cost])
        api = Api(key)
        if not a.yes:
            out(f"Would generate {cost} for \"{a.prompt}\" ({SFX_MODEL}, prompt influence {a.influence:g}"
                f"{', loop' if a.loop else ''}).")
            out.data["account"] = account_line(subscription(api), "sfx")
            for x in out.data["account"]:
                out(x)
            raise confirm(out, "generate them", {"estimate": est})
        tier = subscription(api).get("tier")  # the plan the candidates are made on: each record keeps it
        for i, k in enumerate(todo, 1):
            if cpath(k).is_file():  # moved aside before paying: a file a player holds open fails here, not after
                note(f"sfx: the earlier candidate {k} (another prompt or settings) moves to "
                     f"{rel(retire(cpath(k), SFX_SIDES))}")
            note(f"sfx: candidate {k} ({i}/{len(todo)})")
            resp = api.call("POST", r["path"], f"sound effect candidate {k}", paid=True, params=r["query"], json=body)
            audio = resp.content
            if not audio:
                raise Fail(ERROR, f"sound effect candidate {k}: empty response (it may still have been billed)")
            save_paid(cpath(k), audio, {".request.json": {
                "kind": "sfx", "request": r, "take": k, "generated": now(), "tier": tier, "tool": TOOL,
                "response": {"character_cost": resp.headers.get("character-cost"),
                             "audio_sha256": sha256_bytes(audio), "bytes": len(audio)}}},
                f"sound effect candidate {k}")
    rows = [screen(cpath(k), a.prompt) for k in range(1, a.n + 1)]
    out(f"Candidates for \"{a.prompt}\" (measured before anyone listens; cleanest first):")
    ranked = rank_print(out, rows)
    report_plan(out, "candidate", [(k, cpath(k)) for k in range(1, a.n + 1)], "sfx")
    write_json(w.review_dir / "sfx" / f"{slug}.screen.json", {"prompt": a.prompt, "ranked": ranked, "tool": TOOL})
    if ranked and not ranked[0]["flags"]:
        best = int(re.search(r"\.take(\d+)\.", ranked[0]["file"]).group(1))
        same = (["--n", a.n] + (["--duration", f"{a.duration:g}"] if a.duration is not None else [])
                + (["--influence", f"{a.influence:g}"] if a.influence != 0.3 else []) + (["--loop"] if a.loop else [])
                + (["--name", a.name] if a.name else []) + (["--format", a.format] if a.format else []))
        out(f"Listen to the ok ones, then keep one (no API call): {me('sfx', a.prompt, *same, *place_args(a), '--pick', best)}")
    else:
        out("Every candidate has a problem: change the prompt (a shorter, softer description) or try a library sound.")
    out("Place an effect by its onset (the event time minus onset_s), not by its file start.")
    out.data.update({"ranked": ranked, "screen_file": rel(w.review_dir / "sfx" / f"{slug}.screen.json")})


# ---------------------------------------------------------------------------------------------
# stt


def expected_words(path: Path, w: Where) -> list[str]:
    doc = read_json(path) if path.suffix.lower() == ".json" else None
    if isinstance(doc, dict) and doc.get("lines"):
        out = []
        for l in doc["lines"]:
            for x in l.get("words", []):
                out += str(x.get("spoken") or x.get("w", "")).split()
        return out
    return " ".join(p for p, _ in read_script(path)).split()


def cmd_stt(a, out: Out) -> None:
    tool("ffmpeg")  # checked before anything is spent: the audio's length sets the cost
    w = where(a.video, a.out, [a.audio] if a.audio else [], writes=False)
    if a.audio:
        audio = find_input(a.audio, w, "audio", "audio file")
    elif (w.audio_dir / "narration.wav").is_file():
        audio = w.audio_dir / "narration.wav"
    else:
        raise Fail(USAGE, "stt needs an audio file (or --video <video> with audio/narration.wav)")
    if a.expect:
        exp_path = find_input(a.expect, w, "data", "expected text")
    elif (w.data_dir / "words.json").is_file() and audio.name == "narration.wav":
        exp_path = w.data_dir / "words.json"
    else:
        exp_path = None
    asha = sha256_file(audio)
    secs = len(decode(audio)) / SR
    cache = w.review_dir / "stt" / f"{audio.stem}.{asha[:12]}.{STT_MODEL}{'.' + a.language if a.language else ''}.json"
    j = read_json(cache)
    if j is None:
        est = {"seconds": r3(secs), "credits": round(STT_CREDITS_PER_MIN * secs / 60),
               "usd": round(STT_USD_PER_HOUR * secs / 3600, 4)}
        cost = f"{secs:.1f} s of audio = about {num(est['credits'])} credits"
        key = get_key()
        if not key:
            raise no_key("the transcription", [cost])
        api = Api(key)
        if not a.yes:
            out(f"Would transcribe {rel(audio)} with {STT_MODEL}: {cost}.")
            raise confirm(out, "transcribe it", {"estimate": est})
        note(f"stt: transcribing {rel(audio)} ({secs:.0f} s)")
        data = {"model_id": STT_MODEL, "timestamps_granularity": "word", "tag_audio_events": "false"}
        if a.language:
            data["language_code"] = a.language
        mime = "audio/wav" if audio.suffix.lower() == ".wav" else "audio/mpeg"
        with audio.open("rb") as fh:
            resp = api.call("POST", "/v1/speech-to-text", "speech-to-text", paid=True, data=data,
                            files={"file": (audio.name, fh, mime)})
        try:
            j = resp.json()
        except ValueError:
            raise Fail(ERROR, "speech-to-text: the response was not JSON (it may still have been billed)")
        try:
            write_json(cache, j)
        except OSError as e:  # the transcript is used below anyway; only the free re-run is lost
            note(f"stt: could not keep the transcript in {rel(cache)} ({e.strerror or e}): a re-run pays again")
    heard = [x for x in (j.get("words") or []) if x.get("type", "word") == "word"]
    out(f"Heard ({j.get('language_code', '?')}, {len(heard)} words): {str(j.get('text', '')).strip()[:400]}")
    res = {"audio": rel(audio), "transcript": j.get("text"), "language": j.get("language_code"),
           "words_heard": len(heard), "cache": rel(cache)}
    if exp_path is not None:
        exp = expected_words(exp_path, w)
        ek, hk = [say_key(x) for x in exp], [say_key(str(x.get("text", ""))) for x in heard]
        ek_i = [i for i, k in enumerate(ek) if k]
        hk_i = [i for i, k in enumerate(hk) if k]
        sm = SequenceMatcher(None, [ek[i] for i in ek_i], [hk[i] for i in hk_i], autojunk=False)
        same = sum(sz for *_, sz in sm.get_matching_blocks())
        diffs = []
        for op, i0, i1, j0, j1 in sm.get_opcodes():
            if op == "equal":
                continue
            said = " ".join(exp[ek_i[i]] for i in range(i0, i1))
            got = " ".join(str(heard[hk_i[k]].get("text", "")) for k in range(j0, j1))
            at = heard[hk_i[j0]].get("start") if j0 < len(hk_i) else None
            diffs.append({"expected": said, "heard": got, "at": at})
        out(f"Against {rel(exp_path)}: {same} of {len(ek_i)} words match ({100 * same / max(1, len(ek_i)):.1f}%).")
        for d in diffs[:20]:
            out(f"  expected \"{d['expected']}\", heard \"{d['heard']}\""
                + (f" at {float(d['at']):.2f} s" if d["at"] is not None else ""))
        if diffs:
            out("Numbers, names and respelled words can differ in writing and still sound right: listen at those times.")
        res.update({"expected": rel(exp_path), "matched": same, "expected_words": len(ek_i), "differences": diffs})
    out.data.update(res)


# ---------------------------------------------------------------------------------------------
# CLI


EXAMPLES = {
    "top": """examples:
  uv run scripts/eleven.py voices --language en
  uv run scripts/eleven.py tts videos/intro/script.md --voice VOICE_ID --only 1 --yes    (the voice test)
  uv run scripts/eleven.py music plan "warm felt piano, soft pulse" --from-narration --video intro
Every subcommand has its own --help with more examples.
""",
    "voices": """examples:
  uv run scripts/eleven.py voices
  uv run scripts/eleven.py voices --language pt --json
""",
    "tts": """examples:
  uv run scripts/eleven.py tts script.txt --video intro --voice VOICE_ID --only 1 --yes   (approve the voice)
  uv run scripts/eleven.py tts script.txt --video intro --yes                            (the other blocks)
  uv run scripts/eleven.py tts script.txt --video intro --takes 3 --block 2 --yes        (alternatives)
  uv run scripts/eleven.py tts script.txt --video intro --pick 2 --block 2               (keep take 2; free)
  uv run scripts/eleven.py tts script.md --video intro --say say.tsv --gap 0.8           (respell; longer pauses)
  uv run scripts/eleven.py tts videos/intro/script.md                                    (the video from the path)
The script is the shown text, one paragraph per block (blank lines between them); in a .md
script a # heading starts a chapter and is not spoken. The say map respells shown words for
the voice: 'shown<TAB>spoken' lines (P(doom)<TAB>pee doom), a JSON {"shown": "spoken"}, or a
pair 'IA=I-A'; words.json keeps w = shown and adds spoken. Phrase starts and ends are measured
on narration.wav and moved onto the sound (free; --no-snap keeps the API's times). An edit made
to words.json by hand is kept while nothing it is made from changes. The voice, model, settings,
say map, gap, lead, tail, snap and loudness are kept in audio/narration/narration.json.
Writes audio/narration/NN-<slug>.mp3 with .request.json and .alignment.json, takes under
audio/narration/takes/, audio/narration.wav and data/words.json.
""",
    "plan": """examples:
  uv run scripts/eleven.py music plan "warm felt piano, soft pulse, 86 BPM, D major" --lengths "intro:8,build:12,hit:2,resolve:8" --video promo
  uv run scripts/eleven.py music plan "warm felt piano" --sections "intro:0,build:8,hit:20,resolve:22" --length 30 --video promo
  uv run scripts/eleven.py music plan "ambient pads under a narration, gentle pulse" --from-narration --video intro
--sections takes start times, the first at 0, with --length (the form beats.py takes); --lengths
takes each section's length. Writes audio/music/<slug>.plan.json. Sections under 3 s merge into
the next one (the API's minimum chunk), and the rules go into the plan: starts on the first
beat, a resolved final chord with a natural ring-out, instrumental unless --vocals.
""",
    "compose": """examples:
  uv run scripts/eleven.py music compose --plan videos/promo/audio/music/warm-felt-piano.plan.json --takes 2 --yes
  uv run scripts/eleven.py music compose --plan videos/promo/audio/music/warm-felt-piano.plan.json --pick 1
Takes go to audio/music/takes/ with .request.json and .meta.json; same-loudness copies for
listening to out/<video>/music/; --pick copies one to audio/music/<slug>.mp3 and writes
data/music-sections.json (and the sung words when there are any). --pick finds the take by its
file, whatever seed or format it was made with.
""",
    "sfx": """examples:
  uv run scripts/eleven.py sfx "soft short whoosh, no low rumble" --n 4 --duration 0.6 --video promo --yes
  uv run scripts/eleven.py sfx "soft short whoosh, no low rumble" --n 4 --duration 0.6 --video promo --pick 3
  uv run scripts/eleven.py sfx --screen library/click.wav library/pop.mp3      (screen any files; free)
Candidates go to audio/sfx/takes/<slug>.takeK.mp3; --pick copies one to audio/sfx/<slug>.mp3
with its measured onset in the request record.
""",
    "stt": """examples:
  uv run scripts/eleven.py stt --video intro --yes                  (narration.wav against words.json)
  uv run scripts/eleven.py stt take.mp3 --expect script.txt --language pt --yes
""",
}


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
    RF = argparse.RawDescriptionHelpFormatter
    p = Parser(prog="eleven.py", description=__doc__, formatter_class=RF, epilog=EXAMPLES["top"])
    sub = p.add_subparsers(dest="cmd", required=True, metavar="{voices,tts,music,sfx,stt}")

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--json", action="store_true", help="print one JSON object instead of the summary")
    place = argparse.ArgumentParser(add_help=False)
    place.add_argument("--video", help="video name in this audara project (writes under videos/<video>/; an input "
                                       "inside videos/<video>/ names it by itself)")
    place.add_argument("--out", help="without a project: folder that gets audio/, data/ and out/ (default .)")
    yes = argparse.ArgumentParser(add_help=False)
    yes.add_argument("--yes", action="store_true", help="spend the credits (without it: print the plan, exit 4)")
    spend = argparse.ArgumentParser(add_help=False, parents=[yes])
    spend.add_argument("--format", help=f"output format (default {DEFAULT_FORMAT})")

    v = sub.add_parser("voices", parents=[common], help="list the account's voices (free)", formatter_class=RF,
                       description="List the account's voices (id, name, labels, languages, preview link) to choose "
                                   "one with the director. Free.",
                       epilog=EXAMPLES["voices"])
    v.add_argument("--search", help="filter by name, description or labels (the API's search)")
    v.add_argument("--language", help="only voices verified for this language code (e.g. pt, en)")
    v.add_argument("--limit", type=int, default=300, help="how many voices to fetch (default 300)")

    t = sub.add_parser("tts", parents=[common, place, spend], formatter_class=RF, epilog=EXAMPLES["tts"],
                       help="narration with word timings: one paragraph = one block",
                       description="Narration from a script with text-to-speech timestamps: blocks, narration.wav, "
                                   "words.json, and every phrase edge measured against the waveform and moved onto "
                                   "the sound.")
    t.add_argument("script", help="the narration as shown on screen (.txt or .md), paragraphs = blocks")
    t.add_argument("--voice", help="voice id (eleven.py voices); kept for this narration")
    t.add_argument("--model", help=f"text-to-speech model (default {TTS_MODEL})")
    t.add_argument("--say", action="append", help="respelling for the voice: a file of shown<TAB>spoken lines, a "
                                                   "JSON {\"shown\": \"spoken\"}, or 'shown=spoken'; repeatable")
    t.add_argument("--gap", type=float, help="seconds of silence between blocks (default 0.6)")
    t.add_argument("--lead", type=float, help="seconds before the first word (default 0.5)")
    t.add_argument("--tail", type=float, help="seconds after the last word (default 1.0)")
    t.add_argument("--only", type=int, help="make just block N (1 = the voice test before the rest)")
    t.add_argument("--takes", type=int, help="make K takes (seeds) of --block N, side by side")
    t.add_argument("--pick", type=int, help="make take K of --block N the block's file (no API call)")
    t.add_argument("--block", type=int, help="the block for --takes / --pick")
    t.add_argument("--seed", type=int, help="seed of the main takes (default 1; take k uses seed + k - 1)")
    t.add_argument("--snap", action=argparse.BooleanOptionalAction, default=None,
                   help="move phrase starts and ends in words.json onto the measured sound (the default; "
                        "--no-snap keeps the API's times; kept for the next run)")
    t.add_argument("--lufs", type=lufs_arg, help="level of narration.wav in LUFS (default -16, a calm piece), "
                                                 "or 'native'")
    t.add_argument("--stability", type=float, help="0-1 (default: the voice's own setting, then kept)")
    t.add_argument("--similarity", type=float, help="0-1 similarity boost (not on eleven_v3)")
    t.add_argument("--style", type=float, help="0-1 style exaggeration (not on eleven_v4)")
    t.add_argument("--speed", type=float, help="0.7-1.2 (not on eleven_v3 or eleven_v4)")
    t.add_argument("--speaker-boost", action=argparse.BooleanOptionalAction, default=None)

    m = sub.add_parser("music", help="music: a free plan, then takes composed from it", formatter_class=RF,
                       description="Music from a composition plan: plan (free), then compose (credits).")
    ms = m.add_subparsers(dest="music_cmd", required=True, metavar="{plan,compose}")
    mp = ms.add_parser("plan", parents=[common, place], formatter_class=RF, epilog=EXAMPLES["plan"],
                       help="a composition plan to review (free)",
                       description="Ask for a composition plan (free) with sections that match the edit, and write it "
                                   "for review.")
    mp.add_argument("prompt", help="the sound: genre, instruments, tempo, key, mood (no artist or brand names)")
    mp.add_argument("--sections", help="start times, the first at 0, with --length: \"intro:0,build:8,hit:20,"
                                       "resolve:22\" (the form beats.py takes)")
    mp.add_argument("--lengths", help="each section's length instead: \"intro:8,build:12,hit:2,resolve:8\"")
    mp.add_argument("--from-narration", action="store_true",
                    help="sections from the narration's chapters (# headings) or blocks, changing in the silences")
    mp.add_argument("--length", type=float, help="total seconds (with --sections, or alone; with --from-narration "
                                                 "it extends the last section to the video's length)")
    mp.add_argument("--vocals", action="store_true", help="allow vocals (default: instrumental)")
    mp.add_argument("--name", help="plan name (default: from the prompt)")
    mp.add_argument("--replace", action="store_true", help="overwrite an existing plan of that name")
    mc = ms.add_parser("compose", parents=[common, place, spend], formatter_class=RF, epilog=EXAMPLES["compose"],
                       help="compose takes from a plan (credits)",
                       description=f"Compose takes from a plan with {MUSIC_MODEL}, measure them, and level copies "
                                   "to the same loudness for comparison.")
    mc.add_argument("--plan", required=True, help="the plan file (music plan writes it)")
    mc.add_argument("--takes", type=int, help="how many takes, by seed (default 2)")
    mc.add_argument("--seed", type=int, help="first seed (default 1)")
    mc.add_argument("--pick", type=int, help="make take K the music (no API call)")
    mc.add_argument("--lufs", type=float, default=-16.0, help="loudness of the comparison copies (default -16)")

    s = sub.add_parser("sfx", parents=[common, place, spend], formatter_class=RF, epilog=EXAMPLES["sfx"],
                       help="sound-effect candidates, screened by analysis",
                       description="Generate sound-effect candidates and rank them by analysis (boom, hiss, noise, "
                                   "onset) before anyone listens; --screen measures any files.")
    s.add_argument("prompt", nargs="?", help="the effect, plainly (\"soft short whoosh, no low rumble\")")
    s.add_argument("--n", type=int, default=4, help="candidates (default 4)")
    s.add_argument("--duration", type=float, help="seconds, 0.5-30 (under 5 s it costs less than letting the "
                                                  "model choose)")
    s.add_argument("--influence", type=float, default=0.3, help="prompt influence 0-1 (default 0.3)")
    s.add_argument("--loop", action="store_true", help="a seamless loop")
    s.add_argument("--name", help="file name (default: from the prompt)")
    s.add_argument("--pick", type=int, help="make candidate K the effect (no API call)")
    s.add_argument("--screen", nargs="+", metavar="FILE", help="screen these files instead of generating (free)")

    x = sub.add_parser("stt", parents=[common, place, yes], formatter_class=RF, epilog=EXAMPLES["stt"],
                       help="transcribe audio to check what it says (credits)",
                       description=f"Transcribe with {STT_MODEL} and compare with the expected text.")
    x.add_argument("audio", nargs="?", help="audio file (default with --video: audio/narration.wav)")
    x.add_argument("--expect", help="expected text: a script or a words.json (default: data/words.json)")
    x.add_argument("--language", help="language code (default: detected)")
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
        print(scrub(str(e)), file=sys.stderr)
        if "--json" in args:
            print(json.dumps({"ok": False, "exit": USAGE, "error": str(e).splitlines()[-1]}, ensure_ascii=False))
        return USAGE
    except SystemExit as e:  # --help
        return int(e.code or 0)
    name = a.cmd + (f" {a.music_cmd}" if a.cmd == "music" else "")
    out = Out()
    code, err = OK, None
    try:
        fn = {"voices": cmd_voices, "tts": cmd_tts, "sfx": cmd_sfx, "stt": cmd_stt}.get(a.cmd)
        if a.cmd == "music":
            fn = cmd_music_plan if a.music_cmd == "plan" else cmd_music_compose
        fn(a, out)
    except Fail as e:
        code, err = e.code, str(e)
        out.data.update(e.data)
    except KeyboardInterrupt:
        code, err = ERROR, "interrupted (finished files are kept)"
    except Exception as e:  # a bug, not a usage problem: say where, briefly, and keep --json one object
        import traceback
        tb = traceback.extract_tb(e.__traceback__)[-1]
        code, err = ERROR, (f"unexpected {type(e).__name__}: {e} ({Path(tb.filename).name} line {tb.lineno}, in "
                            f"{tb.name}); files made so far are kept")
    if getattr(a, "json", False):
        out.data.update({"ok": code == OK, "exit": code})
        if err:
            out.data["error"] = err
        print(scrub(json.dumps(out.data, ensure_ascii=False, indent=1, default=str)))
    else:
        for line in out.lines:
            print(scrub(line))
    if err:
        print(scrub(f"{TOOL} {name}: {err}"), file=sys.stderr)
    return code


if __name__ == "__main__":
    sys.exit(main())
