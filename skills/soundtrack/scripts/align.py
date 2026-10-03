# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "numpy>=2.0,<3",
#   "pillow>=10.1,<13",
# ]
# ///
"""Word timings from audio, in the engine's words.json format.

  check  Light, no models. Measures where every phrase starts and ends in the waveform (5 ms RMS:
         the onset after each pause, the offset before it) and reports the worst word-edge errors
         in ms and video frames. --fix snaps phrase-initial starts and phrase-final ends to the
         measured edges. For speech with pauses from any source: ElevenLabs or a local voice, the
         user's recording, align.py song --no-separate. Words inside a phrase (no pause between
         them) are not measured. On a song (sung vocals, music under the voice) the level can't
         show word edges, so check validates the structure only and refuses --fix.
  song   Heavy, optional. Forced alignment of a song (or a voice recording) to its lyrics:
         Demucs isolates the vocals, a CTC aligner places every word on CPU, and a Whisper
         transcription cross-checks it (it never replaces the lyrics). The model stages run in
         align_models.py's own environment (torch CPU, Demucs, faster-whisper), so `check`
         never installs them. Models download once (about 3 GB) into the user cache.

Files: with --video <video>, inside an audara project (the nearest folder above with videos/):
words.json goes to videos/<video>/data/, review images to out/<video>/. An audio file inside
videos/<video>/ names its video by itself. Without a project: --out DIR (default: the current
folder) gets DIR/data/words.json and DIR/out/. Inside a project, song needs its video. When the
video plays a window of the song (beats.py window: data/ is in the window's time), song writes the
song's words to data/song/words.json and prints the command that cuts the window again from them.
Caches, model weights and decoded audio go to the user cache (env AUDARA_CACHE, else the OS
user cache folder + /audara), never into the project.

Say map (--say): 'shown=spoken', a file of shown<TAB>spoken lines, or a JSON {"shown": "spoken"},
read the same way as eleven.py reads it (several-word entries; an all-capitals word matches only
all-capitals text).

Time origin: t = 0 is the first sample of ffmpeg's gapless decode, which is what Chrome's
decodeAudioData plays.

Exit codes: 0 ok, 1 error, or check found problems (edges beyond the tolerance, a broken
structure), 2 bad usage. align.py never calls a paid API, so 3 (missing API key) and 4 (needs
confirmation to spend) never occur. With --json every exit prints one JSON object.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import re
import shutil
import subprocess
import sys
import time
import unicodedata
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np

# ---------------------------------------------------------------------------------------------
# Constants (each with the reason for its value)

WIN_S = 0.005  # RMS window: 5 ms locates an edge far inside one video frame (33 ms at 30 fps)
HOP_S = 0.001  # 1 ms steps between RMS windows, so an edge is placed to the millisecond
LEVEL_PCT = 95  # speech level = 95th percentile of the 5 ms RMS: the loud vowels
FLOOR_PCT = 5  # noise floor = 5th percentile: the quietest stretches (digital zero in TTS)
BELOW_LEVEL_DB = 40.0  # silence = 40 dB under the speech level, low enough to keep soft
#                        fricatives (/f/, /h/, /th/ sit 25-35 dB under the vowels) as sound...
ABOVE_FLOOR_DB = 10.0  # ...but always 10 dB over the noise floor, so room noise is never "voice"
MIN_GAP_DB = 15.0  # if the threshold ends up within 15 dB of the speech level, the noise is too
#                    high to see pauses, and check says so instead of guessing
MIN_SOUND_S = 0.020  # a sound must stay above the threshold for 20 ms; shorter blips are clicks
MIN_PAUSE_S = 0.150  # a pause is >= 150 ms of silence; shorter dips are stop consonants inside
#                      words (/p t k/ closures last 50-120 ms) and are not phrase edges
MATCH_MAX_S = 0.40  # a pause is only attributed to a word gap claimed within 0.4 s of it; timings
#                     further off than that need re-alignment, not snapping
TEXT_BONUS_S = 0.05  # a gap after punctuation or at a line end is the likelier home for a pause
TOLERANCE_MS = 50.0  # verdict bar: about 1.5 frames at 30 fps, near the 45 ms at which viewers
#                      notice sound leading picture (ITU-R BT.1359)
MIN_WORD_S = 0.05  # shortest word duration kept after snapping ("a" spoken fast is ~50-80 ms)

ALPHA = "-abcdefghijklmnopqrstuvwxyz'"  # CTC alphabet shared with align_models.py; 0 = blank
STAR = len(ALPHA)  # garbage token between lines (pdoom-video ctcalign.py)
STAR_MARGIN = 1.5  # the star scores (best label's log-prob - 1.5): it absorbs ad-libs, backing
#                    vocals and the outro, while lyric words still win where they really match
FRAME_S = 0.02  # wav2vec2 / MMS emit one CTC frame per 320 samples at 16 kHz
HOLD_DROP_DB = 15.0  # a sung word ends when the voice drops 15 dB under the word's own level...
HOLD_DROP_S = 0.06  # ...for 60 ms (pdoom-video align.py); otherwise it runs on to the next word
LEGATO_JOIN_S = 0.03  # a gap under 30 ms before the next word is closed (legato)
SIB_BANDS = ((4000, 8000), (90, 1500))  # frication = 4-8 kHz energy over 90-1500 Hz (16 kHz audio)
SIB_GAIN_DB = 8.0  # a fricative shows as the ratio rising 8 dB over its recent floor (pdoom-video)
SIB_BACK_S = 0.30  # CTC emits a fricative at the END of its hiss; look up to 0.3 s back for its start
SIB_FLOOR_DB, SIB_OVER_FLOOR_DB = 45.0, 6.0  # a hiss is within 45 dB of the voice and 6 dB over the
#   floor. Measured: a gate at the silence threshold lost 3 points on pdoom's song (soft hisses sit
#   under it on a stem); no gate let TTS words start 136-246 ms early, inside the silence before them
FRICATIVE = {  # words whose first sound is a hiss, per language (others: the generic pattern)
    "en": re.compile(r"^(sh|ch|th|s|z|f|j|h|x|c[eiy])"),
    "*": re.compile(r"^(sch|sh|ch|s|z|f|j|x|c[eiy])"),
}
FRICATIVE_END = re.compile(r"(s|z|f|x|ce|se|ze|sh|ch)$")
VOICED_TH = {"the", "that", "thats", "they", "theyre", "there", "theres", "this", "then", "than", "those", "these",
             "though", "thus", "them", "their", "thee", "thou", "thy"}  # /ð/: no hiss to find
# Review flags. Either sign alone is weak on a song (each was right about 40% of the time on pdoom's
# reviewed timings, where Whisper's own starts are only 47% within 100 ms); words showing both come
# first, then by how far Whisper hears them. Of the ten words ranked first, 9 were > 100 ms off on
# pdoom's English song and 3 on its Portuguese one (Whisper pulls line starts into the gap before).
WHISPER_FAR_S = 0.20  # Whisper hears the word more than 0.2 s from where it was placed
REVIEW_CONF = 0.25  # the CTC posterior is under 0.25: the model hardly heard the word there
MAX_LIST = 60  # --json lists stop here (a harness cuts long tool output); the review files hold all
MAX_VITERBI_CELLS = 1.2e9  # frames x states of the alignment table (1 byte each); past this,
#                            align the piece in parts

LANG_ACOUSTIC = {  # default acoustic model per language: licenses that allow commercial use
    "en": "lv60k",  # torchaudio WAV2VEC2_ASR_LARGE_LV60K_960H, MIT, English only
    # jonatasgrosman/wav2vec2-large-xlsr-53-<language>: Apache-2.0 (checked on the Hugging Face
    # model cards, 2026-10-02). Their letters fold onto a-z, so they fit Latin-script lyrics.
    "pt": "hf:jonatasgrosman/wav2vec2-large-xlsr-53-portuguese",
    "es": "hf:jonatasgrosman/wav2vec2-large-xlsr-53-spanish",
    "fr": "hf:jonatasgrosman/wav2vec2-large-xlsr-53-french",
    "de": "hf:jonatasgrosman/wav2vec2-large-xlsr-53-german",
    "it": "hf:jonatasgrosman/wav2vec2-large-xlsr-53-italian",
    "nl": "hf:jonatasgrosman/wav2vec2-large-xlsr-53-dutch",
    "pl": "hf:jonatasgrosman/wav2vec2-large-xlsr-53-polish",
    "fi": "hf:jonatasgrosman/wav2vec2-large-xlsr-53-finnish",
    "hu": "hf:jonatasgrosman/wav2vec2-large-xlsr-53-hungarian",
}
ACOUSTIC_INFO = {
    "lv60k": ("wav2vec2 LV60K 960h (torchaudio)", "MIT"),
    "mms": ("MMS_FA multilingual (torchaudio)", "CC-BY-NC-4.0"),
}
NC_NOTICE = (
    "LICENSE: the MMS_FA weights are CC-BY-NC 4.0, for non-commercial use only. If this video is "
    "commercial, re-run with --acoustic hf:<repo> and a CTC model whose license allows it (the "
    "jonatasgrosman/wav2vec2-large-xlsr-53-<language> models are Apache-2.0), or use ElevenLabs' "
    "forced-alignment API (POST /v1/forced-alignment; paid, billed like speech-to-text)."
)


USAGE = 2  # the exit code for bad usage (the code shared with the other scripts raises it)


class Fail(Exception):
    def __init__(self, code: int, msg: str):
        super().__init__(msg)
        self.code = code


def say(msg: str = "") -> None:
    print(msg, flush=True)


def note(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------------------------
# Paths, cache, audio


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


def find_input(p: str, w: Where, subs: tuple[str, ...], what: str) -> Path:
    """`p` as given, else inside the video's folder (videos/<video>/<sub>/p for each sub)."""
    path = Path(p)
    if path.is_file():
        return path.resolve()
    tried = [w.video_dir / sub for sub in subs] if w.video_dir is not None else []
    for d in tried:
        if (d / p).is_file():
            return (d / p).resolve()
    extra = f" (also looked in {', '.join(str(d) for d in tried)})" if tried else ""
    raise Fail(2, f"{what} not found: {p}{extra}")


# The cache. user_cache and cache_root are the same code in beats.py, mix.py and align.py: change all
# three together.


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
    one self-ignoring .audara-cache/ in the project (or the --out folder) instead."""
    root = user_cache()
    try:
        root.mkdir(parents=True, exist_ok=True)
        probe = root / f".write-test-{os.getpid()}"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        return root, False
    except OSError as e:
        fb = w.base / ".audara-cache"
        fb.mkdir(parents=True, exist_ok=True)
        (fb / ".gitignore").write_text("*\n", encoding="utf-8", newline="\n")  # the folder ignores itself in git
        note(f"cache: {root} is not writable here ({e.strerror or e}); using {fb} instead (git-ignored)")
        return fb, True


def folder_bytes(p: Path) -> int:
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) if p.exists() else 0


def tool(name: str) -> str:
    p = shutil.which(name)
    if not p:
        raise Fail(1, f"{name} not found: install ffmpeg (winget install Gyan.FFmpeg, brew install ffmpeg "
                      f"or apt install ffmpeg), then reopen the terminal")
    return p


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def decode_mono(path: Path, sr: int | None = None) -> tuple[np.ndarray, int]:
    """ffmpeg's gapless decode (encoder delay trimmed, as Chrome's decodeAudioData plays it),
    mixed to mono, at the file's own rate unless `sr` is given."""
    if sr is None:
        r = subprocess.run([tool("ffprobe"), "-v", "error", "-select_streams", "a:0", "-show_entries",
                            "stream=sample_rate", "-of", "csv=p=0", str(path)], capture_output=True, text=True)
        try:
            sr = int(r.stdout.strip().splitlines()[0])
        except (ValueError, IndexError):
            raise Fail(1, f"{path.name}: no audio stream that ffprobe can read ({r.stderr.strip()[:200]})") from None
    r = subprocess.run([tool("ffmpeg"), "-v", "error", "-nostdin", "-i", str(path), "-map", "0:a:0", "-vn",
                        "-ac", "1", "-ar", str(sr), "-f", "f32le", "-c:a", "pcm_f32le", "-"], capture_output=True)
    if r.returncode != 0:
        raise Fail(1, f"ffmpeg could not decode {path.name}: {r.stderr.decode(errors='replace').strip()[:300]}")
    y = np.frombuffer(r.stdout, np.float32).copy()
    if len(y) == 0:
        raise Fail(1, f"{path.name}: decoded to zero samples")
    return y, sr


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


# ---------------------------------------------------------------------------------------------
# Word files: the engine's lines[].words[] format, or a flat words[] list from any tool


def load_words(path: Path) -> tuple[object, list[W], str]:
    try:
        doc = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as e:
        raise Fail(2, f"{path}: not a readable JSON file ({e})") from None
    ws: list[W] = []
    if isinstance(doc, dict) and isinstance(doc.get("lines"), list) and any(
            isinstance(l, dict) and isinstance(l.get("words"), list) for l in doc["lines"]):
        for li, line in enumerate(doc["lines"]):
            for w in line.get("words", []):
                ws.append(W(len(ws), str(w.get("w", "")), float(w["start"]), float(w["end"]), li, w))
        return doc, ws, "engine"
    items = doc.get("words") if isinstance(doc, dict) else doc
    if not isinstance(items, list) or not items:
        raise Fail(2, f"{path}: no words found. Expected the engine's format {{\"lines\": [{{\"text\", \"start\", "
                      f"\"end\", \"words\": [{{\"w\", \"start\", \"end\"}}]}}]}} or a flat \"words\" list.")
    for w in items:
        text = w.get("w", w.get("word", w.get("text", w.get("token", ""))))
        line = w.get("line", w.get("paragraph_index", w.get("paragraph", w.get("block"))))
        try:
            ws.append(W(len(ws), str(text), float(w["start"]), float(w["end"]), line, w))
        except (KeyError, TypeError, ValueError):
            raise Fail(2, f"{path}: word {len(ws)} has no numeric start/end: {json.dumps(w)[:120]}") from None
    return doc, ws, "flat"


def structure_issues(doc: object, ws: list[W], fmt: str, duration: float) -> list[str]:
    out = []
    for a, b in zip(ws, ws[1:]):
        if b.start < a.start - 1e-6:
            out.append(f"word {b.i} '{b.text}' starts at {b.start:.3f}, before '{a.text}' ({a.start:.3f})")
    for w in ws:
        if w.end <= w.start:
            out.append(f"word {w.i} '{w.text}' ends ({w.end:.3f}) at or before its start ({w.start:.3f})")
        if w.end > duration + 0.05:
            out.append(f"word {w.i} '{w.text}' ends at {w.end:.3f}, after the audio ({duration:.3f} s)")
    if fmt == "engine":
        for li, line in enumerate(doc["lines"]):
            words = line.get("words", [])
            if not words:
                out.append(f"line {li} has no words")
                continue
            if abs(float(line.get("start", -1)) - words[0]["start"]) > 0.0015 or abs(
                    float(line.get("end", -1)) - words[-1]["end"]) > 0.0015:
                out.append(f"line {li} start/end are not its first word's start and last word's end")
            if line.get("text") != " ".join(str(w.get("w", "")) for w in words):
                out.append(f"line {li} text is not its words joined by single spaces (karaoke wipes rely on it)")
            for w in words:
                syl = w.get("syl")
                if syl and not all(w["start"] - 1e-3 <= a < b <= w["end"] + 1e-3 for a, b in syl) or (
                        syl and any(syl[k][1] > syl[k + 1][0] + 1e-3 for k in range(len(syl) - 1))):
                    out.append(f"line {li} word '{w.get('w')}': syl spans are not ordered inside the word")
    return out[:20]


# ---------------------------------------------------------------------------------------------
# Reporting edges


def stats(edges: list[Edge], kind: str, tol_ms: float) -> dict:
    es = [e for e in edges if e.kind == kind]
    if not es:
        return {"n": 0}
    err = np.array([e.err for e in es]) * 1000
    worst = es[int(np.argmax(np.abs(err)))]
    return {"n": len(es), "median_ms": round(float(np.median(err)), 1), "worst_ms": round(worst.err * 1000, 1),
            "worst_word": worst.w.text, "beyond_tolerance": int((np.abs(err) > tol_ms).sum())}


def edge_json(e: Edge, fps: float) -> dict:
    return {"edge": e.kind, "word": e.w.text, "index": e.w.i, "line": e.w.line, "claimed": round(e.claimed, 3),
            "measured": round(e.measured, 3), "error_ms": round(e.err * 1000, 1),
            "error_frames": round(e.err * fps, 2)}


# ---------------------------------------------------------------------------------------------
# --fix


def write_back(doc: object, ws: list[W], fmt: str) -> None:
    for w in ws:
        w.ref["start"], w.ref["end"] = round(w.start, 3), round(w.end, 3)
        if "duration" in w.ref:
            w.ref["duration"] = round(w.end - w.start, 3)
        fit_syl(w.ref)  # syllable spans inside the word; a span the move emptied is dropped
    if fmt == "engine":
        for line in doc["lines"]:
            words = line.get("words", [])
            if words:
                line["start"], line["end"] = words[0]["start"], words[-1]["end"]


def dump_json(path: Path, doc: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")  # LF on every OS
    tmp.replace(path)


def window_of_song(w: Where, song_sha: str) -> dict | None:
    """The window record (beats.py window) when the video's data is a window of this audio: data/audio.json and
    data/words.json are then in the window's time, and the song's own words belong in data/song/ beside its
    analysis, for the window to be cut again from them."""
    for name in ("audio.json", "words.json"):
        try:
            d = json.loads((w.data_dir / name).read_text(encoding="utf-8-sig"))
        except (OSError, ValueError):
            continue
        rec = d.get("window") if isinstance(d, dict) else None
        if isinstance(rec, dict) and rec.get("songSha256") == song_sha:
            return rec
    return None


def recut_command(rec: dict, w: Where, song: Path) -> str:
    """beats.py window's command for the window `rec` again (a song outside the project is named by its path)."""
    found = isinstance(rec.get("song"), str) and ((w.video_dir or w.base) / rec["song"]).is_file()
    return (f"beats.py window {'' if found else f'{song} '}" + (f"--video {w.name}" if w.name else f"--out {w.base}")
            + f" --from {rec.get('from')} --to {rec.get('to')}" + (f" --fade {rec['fade']}" if rec.get("fade") else "")
            + (f" --name {rec['name']}" if rec.get("name") else ""))


# ---------------------------------------------------------------------------------------------
# Review images (Pillow)


def _font(size: int):
    """A system font that covers accented Latin (Pillow's own font draws "não" as "n□o")."""
    from PIL import ImageFont
    for name in ("segoeui.ttf", "arial.ttf", "DejaVuSans.ttf", "Arial.ttf", "Helvetica.ttc",
                 "LiberationSans-Regular.ttf", "NotoSans-Regular.ttf"):
        try:
            return ImageFont.truetype(name, size)  # Pillow looks in the OS font folders
        except OSError:
            continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow without FreeType: the fixed bitmap font
        return ImageFont.load_default()


def render(path: Path, title: str, panels: list[dict], width: int = 1700) -> Path:
    """panels: t0, t1, snd (Sound), words [(text, start, end, flag)], marks [(t, color)],
    lane [(text, start)] (a second row, e.g. Whisper), fps (frame grid), label."""
    from PIL import Image, ImageDraw
    ph, pad, top = 190, 14, 34
    img = Image.new("RGB", (width, top + len(panels) * (ph + pad)), "white")
    d = ImageDraw.Draw(img)
    f12, f11, f14 = _font(12), _font(11), _font(15)
    d.text((pad, 9), title, fill="#202020", font=f14)
    for k, p in enumerate(panels):
        y0 = top + k * (ph + pad)
        x0, x1 = pad + 4, width - pad
        t0, t1, snd = p["t0"], p["t1"], p["snd"]
        X = lambda t: x0 + (t - t0) / max(1e-9, t1 - t0) * (x1 - x0)  # noqa: E731
        env_top, env_bot = y0 + 18, y0 + 96
        lo_db, hi_db = snd.thr - 30, max(snd.level + 6, snd.thr + 20)
        Y = lambda v: env_bot - (min(max(v, lo_db), hi_db) - lo_db) / (hi_db - lo_db) * (env_bot - env_top)  # noqa: E731
        d.rectangle([x0, y0, x1, y0 + ph], outline="#d0d0d0")
        d.text((x0 + 4, y0 + 3), p.get("label", ""), fill="#303030", font=f12)
        shade = p.get("shade", True)  # pauses and the threshold mean something on speech, not on a stem
        for a, b in snd.pauses if shade else []:
            if b > t0 and a < t1:
                d.rectangle([X(max(a, t0)), env_top, X(min(b, t1)), env_bot], fill="#f4f0e4")
        if p.get("fps"):
            fr = 1.0 / p["fps"]
            t = math.ceil(t0 / fr) * fr
            while t < t1:
                d.line([X(t), env_top, X(t), env_bot], fill="#ececec")
                t += fr
        i0, i1 = np.searchsorted(snd.t, [t0, t1])
        step = max(1, (i1 - i0) // (x1 - x0))
        tt, vv = snd.t[i0:i1:step], snd.db[i0:i1:step]
        if len(tt) > 1:
            pts = [(X(a), Y(v)) for a, v in zip(tt, vv)]
            d.polygon(pts + [(pts[-1][0], env_bot), (pts[0][0], env_bot)], fill="#cfd8e3")
            d.line(pts, fill="#51657a", width=1)
        ty = Y(snd.thr)
        for x in range(int(x0), int(x1), 8) if shade else []:
            d.line([x, ty, x + 4, ty], fill="#9a9a9a")
        for t, color in p.get("marks", []):
            if t0 <= t <= t1:
                d.line([X(t), env_top - 4, X(t), env_bot + 70], fill=color, width=2)
        row = 0
        for text, s, e, flag in p.get("words", []):
            if e < t0 or s > t1:
                continue
            wy = y0 + 104 + (row % 2) * 24
            row += 1
            color = "#d4730b" if flag else ("#2a6fb0" if row % 2 else "#2a8f62")
            d.rectangle([X(max(s, t0)), wy, X(min(e, t1)), wy + 18], outline=color, fill="#ffffff")
            d.line([X(max(s, t0)), wy, X(max(s, t0)), wy + 18], fill=color, width=2)
            d.text((X(max(s, t0)) + 3, wy + 3), text, fill=color, font=f12)
        for text, s in p.get("lane", []):
            if t0 <= s <= t1:
                d.line([X(s), y0 + 156, X(s), y0 + 162], fill="#8a5a9a")
                d.text((X(s) + 2, y0 + 158), text, fill="#8a5a9a", font=f11)
        span = t1 - t0
        tick = next(v for v in (0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30) if span / v <= 14)
        t = math.ceil(t0 / tick) * tick
        while t <= t1:
            d.line([X(t), y0 + ph - 14, X(t), y0 + ph - 9], fill="#808080")
            d.text((X(t) + 2, y0 + ph - 15), f"{t:.2f}" if tick < 1 else f"{t:.0f}", fill="#808080", font=f11)
            t += tick
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)
    return path


# ---------------------------------------------------------------------------------------------
# check


def cached_vocals(w: Where, audio_sha: str) -> tuple[np.ndarray, int] | None:
    """The Demucs vocal stem align.py song left in the cache for this exact audio, if any (read
    only: check never creates a cache)."""
    for root in (user_cache(), w.base / ".audara-cache"):
        f = root / "work" / audio_sha[:12] / "vocals-htdemucs-16k.f32"
        if f.is_file():
            return np.fromfile(f, np.float32), 16000
    return None


def video_fps(w: Where) -> float:
    """The video's frame rate from its video.json (the engine's default, 60, when it has none); 30
    outside a video."""
    if w.video_dir is None:
        return 30.0
    try:
        v = json.loads((w.video_dir / "video.json").read_text(encoding="utf-8-sig")).get("fps")
    except (OSError, ValueError, AttributeError):
        v = None
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 else 60.0


def run_check(args) -> dict:
    w = where(args.video, args.out, [args.audio], writes=False)
    audio = find_input(args.audio, w, ("audio",), "audio file")
    if args.words:
        words_path = find_input(args.words, w, ("data",), "words file")
    elif w.video_dir is not None and (w.data_dir / "words.json").is_file():
        words_path = (w.data_dir / "words.json").resolve()
    else:
        raise Fail(2, "check needs --words <file> (or --video <video> with videos/<video>/data/words.json)")
    doc, ws, fmt = load_words(words_path)
    asha = sha256(audio)
    y, sr = decode_mono(audio)
    duration = len(y) / sr
    stem = cached_vocals(w, asha)
    prov = doc.get("provenance") if isinstance(doc, dict) else None
    sung = stem is not None or (isinstance(prov, dict) and bool(prov.get("separation")))
    if stem is not None:  # a song align.py song separated: show the words over its vocal stem
        y, sr = stem
    snd = analyze(y, sr, args.threshold_db, "vocal stem (Demucs, cached by align.py song)" if stem is not None else "audio")
    tol, fps = args.tolerance_ms, (args.fps if args.fps is not None else video_fps(w))
    issues = structure_issues(doc, ws, fmt, duration)
    warnings = []
    if isinstance(doc, dict) and doc.get("audioSha256") and doc["audioSha256"] != asha:
        warnings.append("the words file records a different audioSha256: it was made for another version of this audio")
    why_not = None
    if sung:
        why_not = ("sung vocals: held notes, breaths, reverb and the music left in a stem make the level a poor guide "
                   "to word edges (on pdoom-video's hand-reviewed timings it flagged 40 of 59 correct edges); for a "
                   "song, align.py song's review list and sheets are the check")
    elif not snd.usable:
        why_not = (f"music or noise under the voice: the quietest parts ({snd.floor:.0f} dBFS) are within "
                   f"{snd.level - snd.floor:.0f} dB of the voice ({snd.level:.0f} dBFS), so there are no silent pauses "
                   f"to measure")
    if why_not and args.fix:
        raise Fail(2, f"--fix needs phrase edges it can measure, and this audio has none: {why_not}")
    rep = match(ws, snd) if why_not is None else Report([], [], [], 0)
    if why_not is None and len(snd.pauses) < max(1, len(ws) // 40):
        warnings.append(f"only {len(snd.pauses)} pauses of {MIN_PAUSE_S * 1000:.0f} ms or more: most word edges here "
                        f"are inside phrases, which check does not measure")
    result = {
        "audio": {"path": str(audio), "duration": round(duration, 3), "sha256": asha, "measured_on": snd.source},
        "words": {"path": str(words_path), "format": fmt, "count": len(ws),
                  "lines": len(doc["lines"]) if fmt == "engine" else None},
        "sound": {"speech_level_db": round(snd.level, 1), "noise_floor_db": round(snd.floor, 1),
                  "threshold_db": round(snd.thr, 1), "pauses": len(snd.pauses)},
        "edges_measured": why_not is None, "not_measured_because": why_not,
        "tolerance_ms": tol, "fps": fps,
        "starts": stats(rep.edges, "start", tol), "ends": stats(rep.edges, "end", tol),
        "worst": [edge_json(e, fps) for e in sorted(rep.edges, key=lambda e: -abs(e.err))[:args.top]],
        "edges": [edge_json(e, fps) for e in rep.edges][:MAX_LIST], "edges_total": len(rep.edges),
        "unexplained_pauses": [{"start": round(a, 3), "end": round(b, 3), "inside": s} for a, b, s in rep.unexplained],
        "runs_on": rep.runs_on, "structure": issues, "warnings": warnings, "fixed": None,
    }
    beyond = sum(1 for e in rep.edges if abs(e.err) * 1000 > tol)
    # ok: True = every measured edge within tolerance and the structure sound; False = not;
    # None = no edge could be measured (the structure is still checked)
    result["ok"] = (beyond == 0 and not issues) if rep.edges else (None if not issues else False)
    before = rep
    ws_view, rep_view = ws, rep
    if args.fix and rep.edges:
        changes = snap(ws, rep)
        write_back(doc, ws, fmt)
        dump_json(words_path, doc)
        doc2, ws2, _ = load_words(words_path)
        rep2 = match(ws2, snd)
        issues2 = structure_issues(doc2, ws2, fmt, duration)
        after_beyond = sum(1 for e in rep2.edges if abs(e.err) * 1000 > tol)
        result["fixed"] = {
            "written": str(words_path), "moved": len(changes), "changes": changes,
            "after": {"starts": stats(rep2.edges, "start", tol), "ends": stats(rep2.edges, "end", tol),
                      "edges_measured": len(rep2.edges), "beyond_tolerance": after_beyond},
            "structure": issues2,
        }
        result["ok"] = after_beyond == 0 and bool(rep2.edges) and not issues2
        ws_view, rep_view = ws2, rep2
    if not args.no_sheet:
        result["sheet"] = str(sheet_for_check(w.review_dir / f"{words_path.stem}-check.png", audio.name,
                                              words_path.name, snd, ws_view, before, rep_view, fps, bool(args.fix)))
    return result


def sheet_for_check(path: Path, aname: str, wname: str, snd: Sound, ws: list[W], before: Report,
                    after: Report, fps: float, fixed: bool) -> Path:
    panels = []
    span = 10.0 if snd.duration <= 120 else 20.0
    rows = min(12, math.ceil(snd.duration / span))
    flagged = {e.w.i for e in before.edges if abs(e.err) * 1000 > TOLERANCE_MS}
    words = [(w.text, w.start, w.end, w.i in flagged) for w in ws]
    marks = [(e.measured, "#1f9d55") for e in after.edges]
    for r in range(rows):
        panels.append(dict(t0=r * span, t1=min(snd.duration, (r + 1) * span), snd=snd, words=words, marks=marks,
                           label=f"{r * span:.0f}-{min(snd.duration, (r + 1) * span):.0f} s"))
    for e in sorted(before.edges, key=lambda e: -abs(e.err))[:6]:
        c = e.measured
        panels.append(dict(t0=c - 0.35, t1=c + 0.35, snd=snd, words=words, fps=fps,
                           marks=[(e.claimed, "#d23c3c"), (e.measured, "#1f9d55")],
                           label=f"'{e.w.text}' {e.kind}: claimed {e.claimed:.3f} (red), sound {e.measured:.3f} (green), "
                                 f"{e.err * 1000:+.0f} ms = {e.err * fps:+.1f} frames at {fps:g} fps"
                                 + ("  [after --fix the box starts/ends at green]" if fixed else "")))
    title = (f"{wname} vs {aname}: 5 ms RMS over {snd.source} (threshold {snd.thr:.0f} dBFS dashed, pauses shaded), "
             f"word boxes (orange = edge off by > {TOLERANCE_MS:.0f} ms), measured edges green")
    return render(path, title, panels)


def print_check(r: dict) -> None:
    a, wd, s = r["audio"], r["words"], r["sound"]
    say(f"check: {Path(a['path']).name} ({a['duration']:.2f} s) vs {Path(wd['path']).name} "
        f"({wd['count']} words, {'engine format' if wd['format'] == 'engine' else 'flat list'})")
    say(f"sound ({a['measured_on']}): voice {s['speech_level_db']:.0f} dBFS, floor {s['noise_floor_db']:.0f} dBFS, "
        f"silence under {s['threshold_db']:.0f} dBFS (5 ms RMS); {s['pauses']} pauses of "
        f"{MIN_PAUSE_S * 1000:.0f} ms or more")
    st, en, fps, tol = r["starts"], r["ends"], r["fps"], r["tolerance_ms"]
    if r["edges_measured"]:
        say(f"measured {st['n']} phrase starts and {en['n']} phrase ends; tolerance ±{tol:.0f} ms = "
            f"±{tol * fps / 1000:.1f} frames at {fps:g} fps")
    else:
        say(f"phrase edges not measured: {r['not_measured_because']}")
    for name, x in (("starts", st), ("ends", en)):
        if x["n"]:
            say(f"  {name:6s} median {x['median_ms']:+.0f} ms, worst {x['worst_ms']:+.0f} ms ('{x['worst_word']}'), "
                f"{x['beyond_tolerance']} of {x['n']} beyond ±{tol:.0f} ms")
    if r["worst"]:
        say("worst edges (claimed - measured; negative = the word box comes before the sound):")
        for e in r["worst"]:
            say(f"  {e['word'][:18]:18s} {e['edge']:5s} {e['claimed']:8.3f}  sound {e['measured']:8.3f}  "
                f"{e['error_ms']:+6.0f} ms  {e['error_frames']:+5.1f} frames")
    for a0, b0, inside in [(u["start"], u["end"], u["inside"]) for u in r["unexplained_pauses"]][:6]:
        say(f"  pause {a0:.3f}-{b0:.3f} ({(b0 - a0) * 1000:.0f} ms) matches no gap between words"
            + (f": it sits inside '{inside}'" if inside else ""))
    if r["runs_on"]:
        say(f"  no pause after: {', '.join(r['runs_on'][:8])}" + (" ..." if len(r["runs_on"]) > 8 else ""))
    for x in r["structure"]:
        say(f"  structure: {x}")
    for x in r["warnings"]:
        say(f"  warning: {x}")
    if r["fixed"]:
        f = r["fixed"]
        say(f"fixed: moved {f['moved']} words; wrote {f['written']}")
        for c in f["changes"][:12]:
            say(f"  {c}")
        if len(f["changes"]) > 12:
            say(f"  ... and {len(f['changes']) - 12} more")
        af = f["after"]
        parts = [f"{k} worst {af[k]['worst_ms']:+.0f} ms" for k in ("starts", "ends") if af[k]["n"]]
        say(f"re-measured: {', '.join(parts)}; {af['beyond_tolerance']} of {af['edges_measured']} edges beyond ±{tol:.0f} ms")
        for x in f["structure"]:
            say(f"  structure after fix: {x}")
    if r.get("sheet"):
        say(f"sheet: {r['sheet']}")
    n_struct = len(r["fixed"]["structure"]) if r["fixed"] else len(r["structure"])
    if r["ok"] is None:
        say("verdict: structure sound; phrase edges not measured (see above)")
    elif r["ok"]:
        say(f"verdict: every measured phrase edge is within ±{tol:.0f} ms; structure sound")
    elif r["fixed"]:
        say("verdict: still off after --fix (see above)" + (f"; {n_struct} structure problems" if n_struct else ""))
    else:
        n = sum(1 for e in r["edges"] if abs(e["error_ms"]) > tol)
        parts = []
        if n:
            parts.append(f"{n} phrase edges are off by more than ±{tol:.0f} ms; run again with --fix to snap them "
                         f"to the sound")
        if n_struct:
            parts.append(f"{n_struct} structure problems (listed above)")
        say("verdict: " + "; ".join(parts))


# ---------------------------------------------------------------------------------------------
# song: text


def key(s: str) -> str:
    """Matching key: accents stripped, case folded, letters and digits only."""
    s = unicodedata.normalize("NFKD", s.casefold())
    return "".join(ch for ch in s if ch.isalnum() and not unicodedata.combining(ch))


def letters(s: str) -> list[str]:
    """Spoken parts of a token, in the aligner's alphabet (a-z and '): accents folded, hyphens
    and other punctuation split it ("super-dense" -> super, dense)."""
    s = s.casefold().replace("’", "'").replace("‘", "'")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    parts = re.sub(r"[^a-z']+", " ", s).split()
    return [p.strip("'") for p in parts if p.strip("'")]


def read_lyrics(path: Path) -> list[str]:
    if path.suffix.lower() == ".json":
        doc = json.loads(path.read_text(encoding="utf-8-sig"))
        lines = [str(l.get("text", "")) for l in doc.get("lines", [])] if isinstance(doc, dict) else []
    else:
        lines = [s for s in (r.strip() for r in path.read_text(encoding="utf-8-sig").splitlines())
                 if s and not s.startswith("#")]
    lines = [" ".join(l.split()) for l in lines if l.split()]
    if not lines:
        raise Fail(2, f"{path}: no lyric lines (one sung line per text line; blank lines and # comments are "
                      f"skipped; a words.json's lines[].text also works)")
    return lines


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


def lyric_tokens(lines: list[str], entries: list[SayEntry]) -> tuple[list, list[list[int]], list[str]]:
    """The lyric words to align, each with its spoken units (the say map applied, several-word entries
    included). A token with no letter or digit (a lone dash) joins the word before it, as eleven.py
    does. Returns (tokens, groups of tokens whose shared stretch is split by their letters once
    aligned, warnings)."""
    toks: list[Tok] = []
    shares: list[list[Tok]] = []
    warnings: list[str] = []
    for li, text in enumerate(lines):
        shown, groups = respell(text, entries)
        line: list[Tok] = []
        for g in groups:
            D = [shown[i] for i in g.idx]
            if len(D) == 1:
                tok = D[0]
                units = [u for part in g.spoken for u in letters(part)] if g.say else letters(tok)
                if any(ch.isdigit() for ch in tok) and g.say is None:
                    warnings.append(f"'{tok}' has digits, which the aligner cannot hear as written: add --say "
                                    f"'{tok.strip('.,;:!?')}=<how it is sung>'")
                line.append(Tok(li, 0, tok, units, g.say))
                continue
            # an entry over several shown words ("New York", "Opus 5.5" -> "Opus five point five"): words both
            # spellings share map one to one; the spoken words between them go to the shown words between
            S = g.spoken
            p = 0
            while p < min(len(D), len(S)) and say_key(D[p]) == say_key(S[p]):
                p += 1
            q = 0
            while q < min(len(D), len(S)) - p and say_key(D[-1 - q]) == say_key(S[-1 - q]):
                q += 1
            midD, midS = D[p:len(D) - q], S[p:len(S) - q]
            said = [u for sp in midS for u in letters(sp)]
            head = [Tok(li, 0, D[j], letters(S[j]), None) for j in range(p)]
            tail = [Tok(li, 0, D[len(D) - q + j], letters(S[len(S) - q + j]), None) for j in range(q)]
            mid: list[Tok] = []
            if len(midD) == len(midS):
                mid = [Tok(li, 0, d, letters(sp), sp if say_key(sp) != say_key(d) else None) for d, sp in zip(midD, midS)]
            elif len(midD) == 1:
                mid = [Tok(li, 0, midD[0], said, " ".join(midS))]
            elif not midD:  # spoken words with no shown word of their own: the shown word next to them says them
                host = head[-1] if head else tail[0]
                host.units = host.units + said if head else said + host.units
                host.spoken = g.say
            else:  # several shown words for a different number of spoken ones: they share one stretch
                mid = [Tok(li, 0, midD[0], said, " ".join(midS))] + [Tok(li, 0, d, [], None) for d in midD[1:]]
                shares.append(mid)
            line += head + mid + tail
        kept: list[Tok] = []
        lead = ""
        for tk in line:
            if not any(ch.isalnum() for ch in tk.text) and not tk.units:
                if kept:
                    kept[-1].text += " " + tk.text
                else:
                    lead += tk.text + " "
                continue
            if lead:
                tk.text, lead = lead + tk.text, ""
            kept.append(tk)
        for i, tk in enumerate(kept or line):
            tk.index = i
        toks += kept or line
    at = {id(tk): k for k, tk in enumerate(toks)}
    return toks, [[at[id(tk)] for tk in grp if id(tk) in at] for grp in shares], warnings


# ---------------------------------------------------------------------------------------------
# song: CTC Viterbi over the whole song (after pdoom-video analysis/ctcalign.py, MIT)


def viterbi(E: np.ndarray, tgt: np.ndarray) -> np.ndarray:
    """Best CTC path of the targets through log-probs E (T x V). Returns the state per frame:
    even = blank, odd s = target (s - 1) // 2. Vectorized over states, one step per frame."""
    T, L = E.shape[0], len(tgt)
    S = 2 * L + 1
    if T * S > MAX_VITERBI_CELLS:
        raise Fail(1, f"too long to align in one pass ({T} frames x {S} states); split the audio and lyrics "
                      f"into parts of a few minutes")
    tok = np.zeros(S, np.int64)
    tok[1::2] = tgt
    can_skip = np.zeros(S, bool)
    can_skip[3::2] = tgt[1:] != tgt[:-1]
    NEG = -1e30
    prev = np.full(S, NEG)
    prev[0], prev[1] = E[0, 0], E[0, tgt[0]]
    bp = np.zeros((T, S), np.int8)
    a1, a2 = np.full(S, NEG), np.full(S, NEG)
    for t in range(1, T):
        a1[1:] = prev[:-1]
        a2[2:] = np.where(can_skip[2:], prev[:-2], NEG)
        best = prev.copy()
        arg = np.zeros(S, np.int8)
        m = a1 > best
        best[m], arg[m] = a1[m], 1
        m = a2 > best
        best[m], arg[m] = a2[m], 2
        prev = best + E[t, tok]
        bp[t] = arg
    s = S - 1 if prev[S - 1] >= prev[S - 2] else S - 2
    if prev[s] <= NEG / 2:
        raise Fail(1, "the lyrics are longer than the audio can hold (no alignment path); check that the lyrics "
                      "file matches this recording")
    path = np.empty(T, np.int64)
    for t in range(T - 1, -1, -1):
        path[t] = s
        s -= int(bp[t, s])  # int(): NumPy 2 would keep int8 and overflow
    return path


@dataclass
class Tok:
    line: int
    index: int
    text: str
    units: list[str]
    spoken: str | None
    spans: list = field(default_factory=list)  # [(start, end, posterior)] per unit
    start: float = 0.0
    end: float = 0.0
    conf: float = 0.0
    whisper: float | None = None
    flags: list = field(default_factory=list)
    sev: float = 0.0  # review order: words showing both warning signs first


def align_tokens(E: np.ndarray, toks: list[Tok], nlines: int) -> None:
    Ex = np.concatenate([E, E.max(axis=1, keepdims=True) - STAR_MARGIN], axis=1)
    tgt, index = [STAR], []
    for li in range(nlines):
        for k, tk in enumerate(toks):
            if tk.line != li:
                continue
            for u in tk.units:
                a = len(tgt)
                tgt.extend(ALPHA.index(c) for c in u)
                index.append((k, a, len(tgt)))
        tgt.append(STAR)
    tgt = np.array(tgt, np.int64)
    path = viterbi(Ex, tgt)
    T = len(path)
    pos = np.where(path % 2 == 1, (path - 1) // 2, -1)
    P = np.exp(Ex[np.arange(T), np.where(pos >= 0, tgt[np.maximum(pos, 0)], 0)])
    order = np.argsort(pos, kind="stable")
    sorted_pos = pos[order]
    for k, a, b in index:
        lo, hi = np.searchsorted(sorted_pos, [a, b])
        fr = order[lo:hi]
        toks[k].spans.append((int(fr.min()) * FRAME_S, (int(fr.max()) + 1) * FRAME_S, float(P[fr].mean())))


def fricative_starts(toks: list[Tok], y: np.ndarray, sr: int, lang: str, snd: Sound) -> int:
    """CTC places a word that starts with a hiss (s, sh, f...) where the hiss ends; move its start
    back to where the 4-8 kHz energy rises (pdoom-video align.py refine(), rule 3). On pdoom's
    song this took word starts within 50 ms of the reviewed timings from 68% to 78%; on TTS phrase
    starts after silence it took "starts" and "Feed" from +34/+24 ms to -2/-8 ms of the onset."""
    n_fft, hop = 256, 80  # 16 ms windows every 5 ms
    nfr = 1 + (len(y) - n_fft) // hop
    if nfr < 10:
        return 0
    f = np.fft.rfftfreq(n_fft, 1 / sr)
    win = np.hanning(n_fft).astype(np.float32)
    hi = np.zeros(nfr)
    lo = np.zeros(nfr)
    (h0, h1), (l0, l1) = SIB_BANDS
    mh, ml = (f >= h0) & (f <= h1), (f >= l0) & (f <= l1)
    for a in range(0, nfr, 4096):  # in blocks: bounded memory on long songs
        b = min(nfr, a + 4096)
        idx = np.arange(n_fft)[None, :] + hop * np.arange(a, b)[:, None]
        S = np.abs(np.fft.rfft(y[idx] * win, axis=1)) ** 2
        hi[a:b], lo[a:b] = S[:, mh].sum(1), S[:, ml].sum(1)
    tt = (np.arange(nfr) * hop + n_fft / 2) / sr
    ratio = 10 * np.log10((hi + 1e-10) / (lo + 1e-10))
    # silence has no hiss, and its band ratio is noise: only frames within SIB_FLOOR_DB of the voice
    # and SIB_OVER_FLOOR_DB over the floor (on a stem, the music left in it) can be a hiss
    gate = max(snd.level - SIB_FLOOR_DB, snd.floor + SIB_OVER_FLOOR_DB)
    ratio[np.interp(tt, snd.t, snd.db) < gate] = -60.0
    sib = np.convolve(ratio, np.ones(3) / 3, "same")
    pat = FRICATIVE.get(lang, FRICATIVE["*"])
    moved = 0
    raw = [tk.start for tk in toks]
    for k, tk in enumerate(toks):
        u = tk.units[0] if tk.units else ""
        if not tk.spans or not pat.match(u) or (lang == "en" and key(tk.text) in VOICED_TH):
            continue
        s = raw[k]
        lo_t = max(s - SIB_BACK_S, 0.0)
        if k and toks[k - 1].spans:
            pu = toks[k - 1].units[-1] if toks[k - 1].units else ""
            prev_end = toks[k - 1].spans[-1][1]
            # a previous word that ends in a hiss ("its sparks") must keep it: start the search after it
            lo_t = max(lo_t, prev_end + 0.02 if FRICATIVE_END.search(pu) else prev_end - 0.10, raw[k - 1] + 0.10)
        i_lo = int(np.searchsorted(tt, lo_t))
        a, b = max(int(np.searchsorted(tt, s - 0.15)), i_lo), int(np.searchsorted(tt, s + 0.06))
        if b <= a:
            continue
        pk = a + int(np.argmax(sib[a:b]))
        base = float(np.percentile(sib[max(0, i_lo - 80):i_lo + 1], 25)) if i_lo > 0 else -40.0
        if sib[pk] < base + SIB_GAIN_DB:
            continue
        half, j = 0.5 * (base + sib[pk]), pk
        while j - 1 >= i_lo and sib[j - 1] > half:
            j -= 1
        if tt[j] < s - 0.02:
            tk.start = float(tt[j])
            moved += 1
    return moved


def syl_spans(tk: Tok, start: float, end: float) -> list | None:
    """Contiguous spans of a word's spoken parts (each part runs to the next part's start), inside
    the word, ordered and non-empty, as the engine's wordProgress() needs; None when they can't be."""
    if len(tk.spans) < 2:
        return None
    st = np.maximum.accumulate(np.clip([start] + [round(s, 3) for s, _, _ in tk.spans[1:]], start, end))
    edges = [float(x) for x in st] + [end]
    out = [[round(edges[i], 3), round(edges[i + 1], 3)] for i in range(len(st))]
    return out if all(b > a for a, b in out) else None


def word_ends(toks: list[Tok], t: np.ndarray, db: np.ndarray, duration: float) -> None:
    """A word runs on to the next word's start (legato), unless the voice drops HOLD_DROP_DB
    under the word's own level for HOLD_DROP_S first (pdoom-video align.py refine())."""
    need = max(1, round(HOLD_DROP_S / HOP_S))
    for k, tk in enumerate(toks):
        nxt = toks[k + 1].start if k + 1 < len(toks) else duration
        raw_end = tk.end
        i0, i1 = np.searchsorted(t, [tk.start, max(raw_end, tk.start + 0.08)])
        level = float(np.percentile(db[i0:max(i1, i0 + 1)], 90)) if i1 > i0 else float(db[min(i0, len(db) - 1)])
        j, jn = np.searchsorted(t, [raw_end, nxt])
        low = db[j:jn] < level - HOLD_DROP_DB
        end = nxt
        if len(low) >= need:
            # first index where `need` consecutive frames are low
            c = np.convolve(low.astype(np.int32), np.ones(need, np.int32), "valid")
            hit = np.flatnonzero(c == need)
            if len(hit):
                end = float(t[j + hit[0]])
        end = max(end, tk.start + MIN_WORD_S)
        if nxt - end < LEGATO_JOIN_S:
            end = nxt
        tk.end = min(end, nxt) if k + 1 < len(toks) else min(end, duration)


def whisper_map(toks: list[Tok], ww: list[dict]) -> tuple[int, set[int]]:
    """Whisper's word times onto the lyric words (same words in order). Returns (words with a time,
    indexes of the words Whisper heard as written)."""
    a = [key(tk.text) for tk in toks]  # Whisper writes words as they are shown, not as they are spelled for the aligner
    b = [key(x["w"]) for x in ww]
    sm = SequenceMatcher(a=a, b=b, autojunk=False)
    n, heard = 0, set()
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal" or (tag == "replace" and i2 - i1 == j2 - j1):
            for d in range(i2 - i1):
                x = ww[j1 + d]
                if tag == "equal":
                    heard.add(i1 + d)
                if abs(x["start"] - toks[i1 + d].start) <= 1.5:  # farther: a false match of a repeated word
                    toks[i1 + d].whisper = float(x["start"])
                    n += 1
    return n, heard


def whisper_prompt(lines: list[str]) -> str:
    """Rare tokens (acronyms, names, odd spellings) as Whisper's initial prompt, as pdoom-video did by hand."""
    seen, out = set(), []
    for li in lines:
        for i, tok in enumerate(li.split()):
            core = tok.strip(".,;:!?\"'“”‘’()[]")
            if not core or key(core) in seen:
                continue
            odd = (sum(ch.isupper() for ch in core) >= 2 or any(ch.isdigit() for ch in core)
                   or any(ch in "()-" for ch in core.strip("-")) or (i > 0 and core[:1].isupper()))
            if odd:
                seen.add(key(core))
                out.append(core)
    return ", ".join(out[:40])


def acoustic_label(acoustic: str, hf_license: str | None) -> tuple[str, str]:
    if acoustic in ACOUSTIC_INFO:
        return ACOUSTIC_INFO[acoustic]
    return (acoustic[3:] + " (Hugging Face)", hf_license or "unknown")


def run_models(args, audio: Path, work: Path, cache: Path, acoustic: str, prompt: str, lang: str) -> dict:
    worker = Path(__file__).with_name("align_models.py")
    if not worker.is_file():
        raise Fail(1, f"{worker} is missing: align.py song runs its models through it (reinstall the skill)")
    uv = os.environ.get("UV") or shutil.which("uv")
    if not uv:
        raise Fail(1, "uv not found: install it (https://docs.astral.sh/uv/), then reopen the terminal")
    cmd = [uv, "run", "--script", str(worker), "--audio", str(audio), "--work", str(work), "--cache", str(cache),
           "--acoustic", acoustic, "--whisper", args.whisper, "--lang", lang,
           "--separate" if not args.no_separate else "--no-separate", "--prompt", prompt]
    env = {k: v for k, v in os.environ.items() if k not in ("VIRTUAL_ENV", "PYTHONHOME", "PYTHONPATH")}
    note("align.py song: model stages (align_models.py). The first run installs torch CPU, Demucs and "
         "faster-whisper and downloads the models (about 3 GB, once); later runs reuse them.")
    r = subprocess.run(cmd, stdout=subprocess.PIPE, env=env)
    out = r.stdout.decode("utf-8", errors="replace").strip()
    if r.returncode != 0:
        raise Fail(1, f"the model stage failed (exit {r.returncode}); its messages are above")
    try:
        return json.loads(out.splitlines()[-1])
    except (json.JSONDecodeError, IndexError):
        raise Fail(1, f"align_models.py printed no result: {out[-300:]}") from None


def apply_corrections(path: Path, toks: list[Tok], asha: str) -> list[str]:
    doc = json.loads(path.read_text(encoding="utf-8-sig"))
    fixes = doc.get("fixes", doc) if isinstance(doc, dict) else doc
    rec = doc.get("audioSha256") if isinstance(doc, dict) else None
    if rec and rec != asha:
        raise Fail(1, f"{path.name} was written for another recording (audioSha256 {rec[:12]}, this audio "
                      f"{asha[:12]}): check each fix against this audio, then update audioSha256")
    applied, fixed = [], set()
    for f in fixes:
        li, wsel = f.get("line"), f.get("word")
        cand = [k for k, tk in enumerate(toks) if tk.line == li]
        if isinstance(wsel, int):
            cand = [k for k in cand if toks[k].index == wsel]
        else:
            cand = [k for k in cand if key(toks[k].text) == key(str(wsel))][int(f.get("nth", 0)):][:1]
        if not cand:
            raise Fail(2, f"{path.name}: no word {wsel!r} in line {li}")
        tk = toks[cand[0]]
        dur = tk.end - tk.start
        if "start" in f:
            tk.start = float(f["start"])
        if "end" in f:
            tk.end = float(f["end"])
        elif tk.end - tk.start < MIN_WORD_S:  # only the start moved, past the end: keep the length
            tk.end = tk.start + max(dur, MIN_WORD_S)
        if "start" not in f and tk.end - tk.start < MIN_WORD_S:
            tk.start = tk.end - max(dur, MIN_WORD_S)
        if "conf" in f:
            tk.conf = float(f["conf"])
        tk.flags, tk.sev = [], 0.0  # a hand fix settles the word
        fixed.add(cand[0])
        applied.append(f"L{li} '{tk.text}' -> {tk.start:.3f}-{tk.end:.3f}")
    # Words a fix now overlaps give way, keeping the order (20 ms apart), and go to the top of the
    # review: they need a fix too (a moved line usually means fixing all of its misplaced words).
    pushed: dict[int, str] = {}  # word index -> the fixed word that pushed it
    for k in range(1, len(toks)):  # words after a fix
        src = toks[k - 1].text if k - 1 in fixed else pushed.get(k - 1)
        if k not in fixed and src is not None and toks[k].start < toks[k - 1].start + 0.02:
            toks[k].start = toks[k - 1].start + 0.02
            toks[k].end = max(toks[k].end, toks[k].start + 0.02)
            pushed[k] = src
    for k in range(len(toks) - 2, -1, -1):  # words before a fix
        src = toks[k + 1].text if k + 1 in fixed else pushed.get(k + 1)
        if k not in fixed and src is not None and toks[k].start > toks[k + 1].start - 0.02:
            toks[k].start = toks[k + 1].start - 0.02
            pushed[k] = src
    for k, src in pushed.items():
        toks[k].flags.append(f"moved by the fix to '{src}': give it a fix too")
        toks[k].sev += 4.0
    for k, tk in enumerate(toks):  # ends: inside the word's own span, never past the next start
        nxt = toks[k + 1].start if k + 1 < len(toks) else math.inf
        tk.end = min(max(tk.end, tk.start + 0.001), nxt) if nxt > tk.start else tk.start + 0.001
    return applied


def run_song(args) -> dict:
    t_start = time.time()
    if sys.platform == "darwin" and platform.machine() == "x86_64":
        raise Fail(1, "align.py song needs PyTorch, which no longer ships for Intel Macs: run it on Apple Silicon, "
                      "Windows or Linux (check works everywhere)")
    w = where(args.video, args.out, [args.audio])
    audio = find_input(args.audio, w, ("audio",), "audio file")
    lyrics_path = find_input(args.lyrics, w, ("", "data"), "lyrics file")
    lines = read_lyrics(lyrics_path)
    entries, _ = read_say(args.say or [], w)
    lang = args.lang.lower().split("-")[0]
    acoustic = args.acoustic or LANG_ACOUSTIC.get(lang, "mms")
    if acoustic not in ("lv60k", "mms") and not acoustic.startswith("hf:"):
        raise Fail(2, f"--acoustic {acoustic}: use lv60k, mms or hf:<huggingface repo of a Wav2Vec2ForCTC model>")
    if acoustic == "lv60k" and lang != "en":
        note(f"warning: lv60k is an English model; for --lang {lang} pick another --acoustic")
    toks, shares, warnings = lyric_tokens(lines, entries)
    if not any(tk.units for tk in toks):
        raise Fail(2, "no letters to align: the lyrics need Latin letters (romanize other scripts, or give "
                      "spellings with --say)")
    asha = sha256(audio)
    cache, in_project = cache_root(w)
    work = cache / "work" / asha[:12]
    work.mkdir(parents=True, exist_ok=True)
    prompt = whisper_prompt(lines)
    res = run_models(args, audio, work, cache, acoustic, prompt, lang)
    E = np.load(res["emissions"]).astype(np.float64)
    y16 = np.fromfile(res["audio16k"], np.float32)
    duration = float(res["duration"])
    t0 = time.time()
    align_tokens(E, toks, len(lines))
    t_align = time.time() - t0
    for tk in toks:
        if tk.spans:
            tk.start, tk.end = tk.spans[0][0], tk.spans[-1][1]
            frames = [(e - s) / FRAME_S for s, e, _ in tk.spans]
            tk.conf = float(np.average([p for *_, p in tk.spans], weights=frames))
    for group in shares:  # several shown words said as one stretch: its time, split by their letters
        first = toks[group[0]]
        if first.spans:
            t0, t1, conf = first.start, first.end, first.conf
            lens = [max(1, len(key(toks[k].text))) for k in group]
            cum = np.cumsum([0] + lens) / sum(lens)
            for m, k in enumerate(group):
                a0, a1 = t0 + (t1 - t0) * cum[m], t0 + (t1 - t0) * cum[m + 1]
                toks[k].spans, toks[k].start, toks[k].end, toks[k].conf = [(a0, a1, conf)], a0, a1, conf
    for k, tk in enumerate(toks):  # tokens with nothing to hear sit between their neighbours
        if not tk.spans:
            prev_end = toks[k - 1].end if k else 0.0
            nxt = next((x.start for x in toks[k + 1:] if x.spans), prev_end + 0.2)
            tk.start, tk.end, tk.conf = prev_end, max(prev_end + MIN_WORD_S, nxt), 0.0
            tk.flags.append("nothing the aligner can hear (no letters): placed between its neighbours")
    snd = analyze(y16, 16000, None, "vocal stem" if res["source"] == "vocals" else "audio")
    n_fric = fricative_starts(toks, y16, 16000, lang, snd)
    # monotonic starts, then ends from the vocal level
    for k in range(1, len(toks)):
        toks[k].start = max(toks[k].start, toks[k - 1].start + 0.02)
    word_ends(toks, snd.t, snd.db, duration)
    # Clean speech (not separated, silent pauses): its phrase edges are measurable, so they snap to the
    # sound exactly as check --fix does. Not on a vocal stem: there the level misleads (see check).
    speech = res["source"] != "vocals" and snd.usable
    n_snap = 0
    if speech:
        # measured on the full-band decode, exactly as check does: at 16 kHz a soft /f/ lost its
        # energy above 8 kHz and crossed the threshold 20 ms late on the S1 voiceover
        snd = analyze(*decode_mono(audio), None, "audio")
        ws = [W(k, tk.text, tk.start, tk.end, tk.line, {}) for k, tk in enumerate(toks)]
        n_snap = len(snap(ws, match(ws, snd)))
        for tk, x in zip(toks, ws):
            tk.start, tk.end = x.start, x.end
    if res.get("whisper"):
        ww = json.loads(Path(res["whisper"]).read_text(encoding="utf-8"))["words"]
        n_match, heard = whisper_map(toks, ww)
    else:
        ww, n_match, heard = [], 0, set()
    for k, tk in enumerate(toks):
        # On clean speech the CTC path is sure of itself and Whisper's word times are not (on the S1
        # voiceovers it put sentence starts up to 1.3 s early), so there the cross-check is what was
        # said: a word Whisper did not hear may be skipped or garbled in the audio. On a song the
        # timing disagreement is the useful sign (Whisper mishears sung words too often to judge text).
        far = (not speech) and tk.whisper is not None and abs(tk.whisper - tk.start) > WHISPER_FAR_S
        if speech and ww and k not in heard:
            tk.flags.append("Whisper did not hear this word here: listen for a skipped or garbled word")
            tk.sev += 1.0
        low = bool(tk.spans) and tk.conf < REVIEW_CONF
        if low:
            tk.flags.append(f"low CTC posterior {tk.conf:.2f}")
        if far:
            tk.flags.append(f"Whisper hears it at {tk.whisper:.2f} ({(tk.whisper - tk.start) * 1000:+.0f} ms)")
        # float(): with NumPy scalars, bool + bool is a logical OR, not a count
        tk.sev += (float(far) + float(low) + (min(abs(tk.whisper - tk.start), 2.0) if far else 0.0)
                   + (3.0 if not tk.spans else 0.0))
    corrected = apply_corrections(find_input(args.corrections, w, ("", "data"), "corrections file"), toks, asha) \
        if args.corrections else []
    # assemble words.json
    out_lines = []
    for li, text in enumerate(lines):
        words = []
        for tk in (x for x in toks if x.line == li):
            item = {"w": tk.text, "start": round(tk.start, 3), "end": round(max(tk.end, tk.start + 0.001), 3),
                    "conf": round(tk.conf, 3)}
            syl = syl_spans(tk, item["start"], item["end"])
            if syl:
                item["syl"] = syl
            if tk.spoken:
                item["spoken"] = tk.spoken
            words.append(item)
        out_lines.append({"i": li, "text": text, "start": words[0]["start"], "end": words[-1]["end"], "words": words})
    label, lic = acoustic_label(acoustic, res.get("acoustic_license"))
    whisper_txt = (f"faster-whisper {args.whisper} transcribed the {res['source']} as a cross-check only (it never "
                   f"replaces the lyrics); ") if res.get("whisper") else ""
    notes = (f"Time origin: t = 0 is the first sample of ffmpeg's gapless decode of {audio.name}, which is what "
             f"Chrome's decodeAudioData plays. Made by align.py song: "
             + ("Demucs htdemucs isolated the vocals from that decode; " if res["source"] == "vocals" else "")
             + f"{label} CTC emissions (20 ms frames) and one Viterbi forced alignment of all {len(lines)} lines, with a "
             f"garbage token between lines for ad-libs and backing vocals; a word that starts with a hiss (s, f, sh...) "
             f"starts where the hiss does ({n_fric} moved; CTC marks its end); a word runs on to the next one unless the "
             f"voice drops {HOLD_DROP_DB:.0f} dB for {HOLD_DROP_S * 1000:.0f} ms; "
             + ("phrase starts and ends sit on the measured sound after and before each pause (5 ms RMS); "
                if speech else "") + f"{whisper_txt}"
             f"conf = mean CTC posterior of the word's frames (0..1, not a calibrated probability). syl = the spoken "
             f"parts of a word (spelled letters, hyphen parts). No human listening pass is claimed.")
    doc = {"lines": out_lines, "audio": audio.name, "audioSha256": asha, "notes": notes,
           "provenance": {"tool": "align.py song", "lyrics": lyrics_path.name, "lang": lang,
                          "acoustic": {"model": acoustic, "license": lic},
                          "separation": "htdemucs" if res["source"] == "vocals" else None,
                          "whisper": args.whisper if res.get("whisper") else None,
                          "say": {tk.text: tk.spoken for tk in toks if tk.spoken} or None,
                          "corrections": len(corrected) or None}}
    out_path = w.data_dir / "words.json"
    win = window_of_song(w, asha)
    if win:  # (data/words.json is the window's, in its time: these are the song's, in the song's)
        out_path = w.data_dir / "song" / "words.json"
    dump_json(out_path, doc)
    flagged = sorted((tk for tk in toks if tk.flags), key=lambda tk: -tk.sev)
    sheets = []
    if not args.no_sheet:
        for first in range(0, len(lines), 4):
            panels = []
            for li in range(first, min(first + 4, len(lines))):
                lt = [tk for tk in toks if tk.line == li]
                a, b = lt[0].start - 0.8, lt[-1].end + 0.6
                panels.append(dict(t0=a, t1=b, snd=snd, shade=speech,
                                   words=[(tk.text, tk.start, tk.end, bool(tk.flags)) for tk in toks],
                                   lane=[(x["w"], x["start"]) for x in ww], label=f"L{li}: {lines[li]}"))
            name = f"align-lines-{first:02d}-{min(first + 3, len(lines) - 1):02d}.png"
            sheets.append(str(render(w.review_dir / name, f"{audio.name}: {res['source']} level (5 ms RMS), words "
                                                         f"(orange = flagged), Whisper's words in purple", panels)))
    review = [{"line": tk.line, "word": tk.index, "w": tk.text, "start": round(tk.start, 3), "end": round(tk.end, 3),
               "conf": round(tk.conf, 3), "severity": round(tk.sev, 2), "why": tk.flags} for tk in flagged]
    if not args.no_sheet:
        dump_json(w.review_dir / "align-review.json", {"audioSha256": asha, "flagged": review,
                                                        "corrections_template": {"audioSha256": asha, "fixes": [
                                                            {"line": 0, "word": 0, "start": 0.0, "note": "why"}]}})
    downloads = res.get("downloads", [])
    result = {
        "ok": True, "audio": {"path": str(audio), "duration": round(duration, 3), "sha256": asha},
        "words_json": str(out_path), "lines": len(lines), "words": len(toks), "lang": lang,
        "models": {"vocals": "htdemucs (Demucs, MIT)" if res["source"] == "vocals" else None,
                   "acoustic": {"model": acoustic, "name": label, "license": lic},
                   "whisper": args.whisper if res.get("whisper") else None},
        "license_notice": NC_NOTICE if acoustic == "mms" else (
            None if lic.lower() in ("mit", "apache-2.0", "bsd-2-clause", "bsd-3-clause", "cc-by-4.0", "cc0-1.0")
            else f"LICENSE: {label} is under '{lic}': check that it allows your use before relying on it."),
        "downloads": downloads, "cache": str(cache),
        "cache_bytes_in_project": folder_bytes(cache) if in_project else None,
        "times_s": {**res.get("times", {}), "align": round(t_align, 1), "total": round(time.time() - t_start, 1)},
        "conf_median": round(float(np.median([tk.conf for tk in toks])), 3), "fricative_starts_moved": n_fric,
        "phrase_edges_snapped": n_snap if speech else None,
        "whisper_matched": n_match, "whisper_heard": len(heard), "flagged": review[:MAX_LIST],
        "flagged_total": len(review), "warnings": warnings, "corrections_applied": corrected,
        "sheets": sheets, "review": str(w.review_dir / "align-review.json") if not args.no_sheet else None,
        "window": {k: win.get(k) for k in ("song", "from", "to", "file")} if win else None,
        "next": [f"the video plays the window {win.get('from')}-{win.get('to')} s of {win.get('song')} "
                 f"({win.get('file')}): these are the whole song's words, in the song's time, kept in "
                 f"data/song/words.json; cut the window again so its words.json comes from them: "
                 f"{recut_command(win, w, audio)}"] if win else [],
    }
    return result


def human_bytes(n: float) -> str:
    if n >= 1e9:
        return f"{n / 1e9:.2f} GB"
    if n >= 1e6:
        return f"{n / 1e6:.0f} MB"
    return f"{n / 1e3:.0f} KB"


def print_song(r: dict) -> None:
    m = r["models"]
    say(f"song: {Path(r['audio']['path']).name} ({r['audio']['duration']:.2f} s), {r['lines']} lines / "
        f"{r['words']} words, lang {r['lang']}")
    say(f"models: vocals {m['vocals'] or 'not separated'} | acoustic {m['acoustic']['name']} "
        f"({m['acoustic']['license']}) | cross-check {('faster-whisper ' + m['whisper']) if m['whisper'] else 'none'}")
    if r["license_notice"]:
        say(r["license_notice"])
    if r["downloads"]:
        total = sum(d["bytes"] for d in r["downloads"])
        say(f"downloaded this run into {r['cache']} ({human_bytes(total)}), kept for next time:")
        for d in r["downloads"]:
            say(f"  {d['what']}: {human_bytes(d['bytes'])}" + (f" ({d['license']})" if d.get("license") else ""))
    if r["cache_bytes_in_project"] is not None:
        say(f"cache inside the project (git-ignored): {r['cache']} = {human_bytes(r['cache_bytes_in_project'])}")
    t = r["times_s"]
    say("time: " + ", ".join(f"{k} {v:.0f} s" if v >= 10 else f"{k} {v:.1f} s" for k, v in t.items()))
    heard = f"; Whisper heard {r['whisper_heard']} of the {r['words']} words as written" if m["whisper"] else ""
    say(f"wrote {r['words_json']} (median conf {r['conf_median']:.2f}{heard})")
    if r["phrase_edges_snapped"] is not None:
        say(f"clean speech: {r['phrase_edges_snapped']} words moved onto the measured sound at pauses (check --fix's "
            f"rule); align.py check measures the result")
    for x in r["warnings"]:
        say(f"warning: {x}")
    for x in r["corrections_applied"]:
        say(f"correction: {x}")
    fl = r["flagged"]
    if fl:
        say(f"review: {r['flagged_total']} words show a warning sign; most suspicious first (look at their lines in the sheets, "
            f"put fixes in a corrections file, re-run with --corrections):")
        for x in fl[:15]:
            say(f"  L{x['line']:02d} W{x['word']:<2d} {x['w'][:16]:16s} {x['start']:8.3f}  conf {x['conf']:.2f}  "
                f"{'; '.join(x['why'])}")
        if r["flagged_total"] > 15:
            say(f"  ... and {r['flagged_total'] - 15} more in {r['review'] or 'the --json output'}")
    if r["sheets"]:
        say(f"sheets: {len(r['sheets'])} images, {r['sheets'][0]} ...")
    for x in r.get("next") or []:
        say(f"next: {x}")


# ---------------------------------------------------------------------------------------------
# CLI


class UsageError(Exception):
    pass


class Parser(argparse.ArgumentParser):
    """argparse that raises on a usage error instead of exiting, so --json can report it as JSON too."""

    def error(self, message: str):
        raise UsageError(f"{self.format_usage().rstrip()}\n{self.prog}: error: {message}")


def main(argv: list[str] | None = None) -> int:
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    ex_check = """examples:
  uv run scripts/align.py check voice.wav --video intro           (videos/intro/data/words.json)
  uv run scripts/align.py check voice.wav --words data/words.json --fix --fps 30
  uv run scripts/align.py check song.mp3 --video clip --json      (a song: structure only)
The verdict compares each measured phrase edge with --tolerance-ms (50 ms, about 1.5 frames at
30 fps). --fix rewrites the words file in place; words inside a phrase keep their times unless a
moved edge would squeeze them. Frames are counted at the video's fps (video.json; --fps sets
another). The review image goes to out/<video>/<words file>-check.png. Narration from eleven.py
tts is snapped already: check is then the review image and a second opinion.
"""
    exit_codes = ("exit codes: 0 ok, 1 error or check found problems (edges beyond the tolerance, a broken "
                  "structure), 2 bad usage; align.py never spends credits, so 3 and 4 never occur")
    ex_song = """examples:
  uv run scripts/align.py song song.mp3 --lyrics lyrics.txt --video clip
  uv run scripts/align.py song song.mp3 --lyrics lyrics.txt --say "AGI=ay gee eye" --say say.json --video clip
  uv run scripts/align.py song cancao.mp3 --lyrics letra.txt --lang pt --out .
  uv run scripts/align.py song voice.wav --lyrics script.txt --no-separate --video intro   (a clean recording)
lyrics.txt: UTF-8, one sung line per text line (blank lines and # comments are skipped); each
line becomes one line of words.json. --say maps a shown word to how it is sung ("P(doom)" sung
"pee doom"); the word keeps its shown text and gets "spoken". On clean speech (--no-separate,
silent pauses) phrase starts and ends are snapped to the measured sound as check --fix does.
Review: the most suspicious words are listed first, with the sheets (4 lines per image) in
out/<video>/; fixes go in a corrections file and survive re-runs:
  {"audioSha256": "<from words.json>", "fixes": [{"line": 5, "word": "eat", "start": 20.27}]}
Measured against pdoom-video's reviewed timings, with --say spellings: English 79% of word starts
within 50 ms and 88% within 100 ms (default lv60k), 83% and 89% with --acoustic mms; Portuguese
74% and 83% (default Apache-2.0 model), 83% and 91% with mms (its reference was made with mms).
"""
    ex_top = """examples:
  uv run scripts/align.py check videos/intro/audio/narration.wav       (the video's data/words.json)
  uv run scripts/align.py song song.mp3 --lyrics lyrics.txt --video clip
Each subcommand has its own --help with more examples.
""" + exit_codes
    p = Parser(prog="align.py", description=__doc__.split("\n\n")[0] + "\n\n" + __doc__.split("\n\n")[1],
               formatter_class=argparse.RawDescriptionHelpFormatter, epilog=ex_top)
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check", help="measure phrase starts/ends against the waveform (light, no models)",
                       description="Measure every phrase's start and end against the waveform (speech with pauses) "
                                   "and report the worst word-edge errors in ms and frames; --fix snaps them. "
                                   "On a song it validates the structure only. " + exit_codes,
                       epilog=ex_check, formatter_class=argparse.RawDescriptionHelpFormatter)
    c.add_argument("audio", help="the audio the words were timed to (any format ffmpeg reads)")
    c.add_argument("--words", help="words file (default with --video: videos/<video>/data/words.json); the engine's "
                                   "format or a flat words[] list with w|word|text, start, end")
    c.add_argument("--video", help="video name in this audara project")
    c.add_argument("--out", help="without a project: folder for the review image (DIR/out/), default .")
    c.add_argument("--fix", action="store_true", help="snap phrase-initial starts and phrase-final ends to the "
                                                      "measured sound and rewrite the words file in place")
    c.add_argument("--fps", type=float, help="frame rate for errors in frames (default: the video's, from video.json; "
                                              "30 outside a video)")
    c.add_argument("--tolerance-ms", type=float, default=TOLERANCE_MS, help="verdict bar (default 50)")
    c.add_argument("--threshold-db", type=float, help="silence threshold in dBFS (default: 40 dB under the voice, "
                                                      "at least 10 dB over the noise)")
    c.add_argument("--top", type=int, default=8, help="how many worst edges to list (default 8)")
    c.add_argument("--no-sheet", action="store_true", help="skip the review image")
    c.add_argument("--json", action="store_true", help="print the result as JSON")
    s = sub.add_parser("song", help="force-align lyrics to a song (heavy: Demucs + CTC + Whisper, models cached)",
                       description="Forced alignment of a song the user brings: vocals isolated with Demucs, words "
                                   "placed by a CTC aligner on CPU, cross-checked by Whisper. Writes words.json and "
                                   "review sheets. The first run downloads about 3 GB of models into the user cache "
                                   "and says what it downloaded. " + exit_codes,
                       epilog=ex_song, formatter_class=argparse.RawDescriptionHelpFormatter)
    s.add_argument("audio", help="the song (any format ffmpeg reads)")
    s.add_argument("--lyrics", required=True, help="lyrics: one sung line per text line (or a words.json to re-align)")
    s.add_argument("--video", help="video name in this audara project (writes videos/<video>/data/words.json)")
    s.add_argument("--out", help="without a project: folder that gets data/words.json and out/ (default .)")
    s.add_argument("--lang", default="en", help="language of the lyrics (default en); picks the acoustic model")
    s.add_argument("--acoustic", help="lv60k (English, MIT), mms (multilingual, CC-BY-NC: non-commercial, a few "
                                      "points more accurate), or hf:<repo> (a Hugging Face Wav2Vec2ForCTC model). "
                                      "Default: by language, one whose license allows commercial use when there is "
                                      "one (en: lv60k; pt es fr de it nl pl fi hu: Apache-2.0 models; else mms, "
                                      "with a license notice)")
    s.add_argument("--say", action="append", help="how a shown word is sung: 'AGI=ay gee eye', a file of "
                                                   "shown<TAB>spoken lines (the say.tsv eleven.py takes) or a JSON "
                                                   "{\"shown\": \"spoken\"}; repeatable")
    s.add_argument("--no-separate", action="store_true", help="align on the audio as it is: a clean voice "
                                                              "recording (its phrase edges then snap to the sound)")
    s.add_argument("--whisper", default="large-v3-turbo", help="faster-whisper model for the cross-check "
                                                                "(default large-v3-turbo, 1.6 GB), or none")
    s.add_argument("--corrections", help="JSON of hand fixes applied after alignment (see the epilog)")
    s.add_argument("--no-sheet", action="store_true", help="skip the review images")
    s.add_argument("--json", action="store_true", help="print the result as JSON")
    argv = list(sys.argv[1:] if argv is None else argv)
    try:
        args = p.parse_args(argv)
    except UsageError as e:  # with --json the error is one JSON object too
        note(str(e))
        if "--json" in argv:
            print(json.dumps({"ok": False, "exit": USAGE, "error": str(e).splitlines()[-1]}, ensure_ascii=False))
        return USAGE
    except SystemExit as e:  # --help
        return int(e.code or 0)
    code, err = 0, None
    try:
        if args.cmd == "check":
            r = run_check(args)
            print(json.dumps(r, ensure_ascii=False, indent=1)) if args.json else print_check(r)
            code = 1 if r["ok"] is False else 0  # problems found: edges beyond the tolerance, a broken structure
        else:
            r = run_song(args)
            print(json.dumps(r, ensure_ascii=False, indent=1)) if args.json else print_song(r)
        return code
    except Fail as e:
        code, err = e.code, str(e)
    except KeyboardInterrupt:
        code, err = 1, "interrupted"
    except Exception as e:  # a bug, not a usage problem: say where, briefly
        import traceback
        tb = traceback.extract_tb(e.__traceback__)[-1]
        code, err = 1, f"unexpected {type(e).__name__}: {e} (align.py line {tb.lineno}, in {tb.name})"
    note(f"align.py {args.cmd}: {err}")
    if getattr(args, "json", False):
        print(json.dumps({"ok": False, "command": args.cmd, "exit": code, "error": err}, ensure_ascii=False))
    return code


if __name__ == "__main__":
    sys.exit(main())
