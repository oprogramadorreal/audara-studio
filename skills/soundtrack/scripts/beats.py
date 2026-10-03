# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = [
#   "numpy>=2.2,<2.6",
#   "scipy>=1.15,<1.19",
#   "librosa>=1.0,<1.1",
#   "numba>=0.61,<0.69",
#   "soundfile>=0.13,<0.15",
#   "soxr>=1.0,<1.2",
#   "matplotlib>=3.9,<3.12",
# ]
# ///
"""Beats, downbeats, sections, envelopes and onsets of a song, written as the engine's data/audio.json.

  analyze  (the default command) Beat This!, a neural beat and downbeat tracker, finds the beats on
           CPU (its model stages run in beats_models.py's own environment). When the tempo is steady
           the file gets a least-squares grid extrapolated over the whole song (the detections stay in
           beatsRaw); when it is not, the detected beats plus a tempo map. The phase is moved onto the
           measured attacks. Sections come from audio novelty (the first starts at 0 s, every later
           one on a downbeat; repeated lyric lines in words.json mark choruses), or from --sections,
           kept exactly where given.
           Envelopes and kick onsets come from the mix; --stems adds Demucs stems: vocal/drums/bass/
           other, snare, hat and vocal onsets, and pitchMidi. --tracker librosa analyzes without any
           model download.
  grid     A declared grid for audio whose structure is known by construction (procedural music, a
           composed cue): beats, bars, sections and named cues, no analysis; with --audio, the grid
           and the cues are compared with the audio's attacks.
  check    Validate an audio.json the way the engine reads it (and against its audio).
  window   A part of the song as the video's own soundtrack, for a video shorter than its song: moves
           an end that misses the downbeats onto the nearest one (--exact keeps it) and checks the
           window on the music (whole bars, what is sung at each end), cuts it to the sample as
           audio/<stem>-window.wav and writes its audio.json and words.json in video time from the
           whole song's, which stay in data/song/ for the next window (the song is analyzed there
           first when it has no analysis yet), and its click track.

Files: with --video <video>, inside an audara project (the nearest folder above with videos/):
audio.json goes to videos/<video>/data/, review files (beats.png, clicks.m4a, window.png) to
out/<video>/. An audio file anywhere inside videos/<video>/ (audio/music/take.mp3 too) names its
video by itself. Without a project: --out DIR (default: the current folder) gets DIR/data/audio.json
and DIR/out/. Inside a project, analyze, grid and window need their video, so no data/ lands at the
project's root.
Caches, model weights, stems, numba's compiled code and decoded audio go to the user cache (env
AUDARA_CACHE, else the OS user cache folder + /audara), never into the project (a cache that has to
sit inside it ignores itself in git). audio.json records what made it (model, checkpoint, license),
never paths, timings or versions of the machine that ran it.

Time origin: t = 0 is the first sample of ffmpeg's gapless decode (the encoder delay removed),
which is what browsers play. The times are never shifted: a player that keeps the encoder delay
gets a WAV of that decode instead.

Exit codes: 0 ok, 1 error (decode, model or validation failure, or check finding errors), 2 bad
usage. beats.py never calls a paid API, so 3 (missing API key) and 4 (needs confirmation to spend)
never occur. With --json every exit prints one JSON object.
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
import stat
import subprocess
import sys
import time
import unicodedata
from dataclasses import dataclass, field
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

# ---------------------------------------------------------------------------------------------
# Constants (each with the reason for its value)

FPS = 100  # envelope frames per second: what the engine's AudioData expects by default (audio.ts)
SR = 44100  # analysis rate: Demucs htdemucs works at 44.1 kHz, and pdoom-video's 2048-sample RMS
#             window is 46 ms there
SR_LOW = 22050  # Beat This!, HPSS proxies, chroma and sections: they read nothing above 11 kHz
BT_FPS = 50.0  # Beat This! frame rate: hop 441 at 22.05 kHz (beat_this/preprocessing.py)
WINDOW_BEATS = 16  # stability window: 4 bars of 4/4; its median averages out the tracker's
#                    +-5 ms jitter per beat
GRID_TOL = 0.010  # a fitted constant grid replaces the detections only if, in every 16-beat
#                   window, the detections' median sits within 10 ms of it: under one 60 fps
#                   frame (16.7 ms), and above the tracker's own wobble on a song recorded to a
#                   click (pdoom-video: -6.3..+6.0 ms)
START_SLACK = 0.025  # a beat up to 25 ms before the file starts is the music starting on a beat:
#                      it is kept, at t = 0 (an excerpt cut on a beat would otherwise lose its first bar)
MIN_GRID_BEATS = 8  # two bars: fewer detections cannot show whether the tempo holds
EXTRA_RATIO = 0.6  # a detection closer than 0.6 of the local beat to the previous one is a double
GAP_RATIO = 1.5  # an interval over 1.5 local beats hides missed beats, refilled evenly
ATTACK_TOL = 0.050  # attacks within 50 ms of a beat vote on its phase: the tracker lags real
#                     attacks by 7-25 ms (measured), and the nearest off-beat 16th at 200 BPM is 75 ms away
ATTACK_MIN_BEATS = 8  # the phase moves only when at least 8 beats...
ATTACK_MIN_FRAC = 0.25  # ...and a quarter of all beats have an attack near them
ATTACK_MAX_SHIFT = 0.040  # a larger median offset means the attacks are not on the beat: leave it
ON_BEAT = 0.020  # beats.png counts a beat as heard when an attack lies within 20 ms of it: at ATTACK_TOL's 50 ms (wide
#                  enough to vote on the phase) pdoom's drumless breakdown read 14 of its 16 beats, at 20 ms 6
JUMP_PENALTY = 12.0  # nats a bar-phase change costs: it takes about 3 bars of the tracker's
#                      confident contrary downbeats, so one stray detection never moves the bars
MIN_SECTION_BARS = 2  # audio-novelty boundaries closer than 2 bars merge (a fill is not a section)
MIN_BARS_TO_SEGMENT = 12  # shorter pieces get one section: too few bars to tell parts apart
TEMPO_STEADY_TOL = 0.012  # a run of beats is "steady" while its local tempo stays within 1.2%
#                           (about 6 standard errors of a 9-beat local fit) of the run's median
TEMPO_STEADY_MIN = 8  # beats a steady run needs before the report names it
MAX_CLUSTERS = 7  # Laplacian segmentation tries 7 kinds of passage, then fewer...
SECTION_MEDIAN_BARS = 6  # ...until sections last a median 6 bars or more. More clusters start
#                          splitting verses into halves (pdoom-video: 6 clusters give 6 exact
#                          boundaries on the EN song; on pt-BR, 5 already give 19 pieces, 4 give 8)
SECTIONS_PER_BARS = 8  # ...or N/8 bars on a piece of N bars (at least 3): a song (48+ bars) keeps the
#                        6-bar rule; on pdoom's 70-115 s excerpt (25 bars) the 6-bar rule kept 1 of its 4
#                        real boundaries, N/8 keeps 3 (and splits one verse in half)
TEMPO_EDGE_TOL = 0.004  # a stretch's edge beats keep within 0.4% of its tempo: two standard errors of
#                         a 9-beat local fit at the tracker's 8 ms jitter
TEMPO_CHANGE_MIN = 0.03  # steady stretches 3% apart are a tempo change (118 -> 126 BPM is 6.8%);
#                          smaller differences are drift (pdoom-video pt-BR wanders 132.9-136.2)
ENV_WIN = 2048  # RMS window at 44.1 kHz: 46 ms (pdoom-video analyze.py)
ATTACK_S, RELEASE_S = 0.010, 0.090  # envelope follower: fast attack, slower release (pdoom-video)
NORM_PCT = 99.0  # each envelope is divided by its 99th percentile: a few peaks clip, the body reads
LOW_HZ, MID_HZ, HIGH_HZ = 150, 2000, 4000  # band edges: low < 150, mid 150-2000, high > 4000 Hz
VOCAL_GATE = 0.06  # vocal stem frames under 6% of its 95th-percentile RMS are silence (pitchMidi
#                    0, no vocal onsets): pdoom-video pt_br.py
STRENGTH_FLOOR = 0.1  # onset strengths clip to [0.1, 1], so no detected event reads as 0
CLICK_KBPS = 96  # clicks.m4a: mono AAC at 96 kb/s is about 0.7 MB a minute
GRID_CHECK_MIN = 8  # grid --audio judges the phase from 8 or more attacks near beats; fewer (a pad, a drone)
#                     say nothing about a grid
GRID_CHECK_MS = 0.020  # a median offset over 20 ms (over one 60 fps frame) means the grid is shifted: the
#                        demo track and a 96 BPM cue read +0.2 and +1.8 ms on their true grids, -30 ms 30 ms off
GRID_TEMPO_TOL = 0.03  # the onset-periodicity tempo is coarse (97.5 BPM read on a 96 BPM cue: 1.6%); 3% apart
#                        means another tempo (90 declared for 96 reads 8.3%, 112 for 120 reads 7.3%)
AUDIO_EXT = (".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".aif", ".aiff", ".mp4", ".webm")


USAGE = 2  # the exit code for bad usage (the code shared with the other scripts raises it)


class Fail(Exception):
    def __init__(self, code: int, msg: str):
        super().__init__(msg)
        self.code = code


def say(msg: str = "") -> None:
    print(msg, flush=True)


def note(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def clock(t: float) -> str:
    """m:ss.ss for reports (times stay in seconds in the data)."""
    m = int(t // 60)
    return f"{m}:{t - 60 * m:05.2f}"


# ---------------------------------------------------------------------------------------------
# Paths, cache, audio


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


def video_json(w: Where) -> dict:
    """The video's video.json as a dict ({} when there is none or it can't be read)."""
    if w.video_dir is None:
        return {}
    try:
        j = json.loads((w.video_dir / "video.json").read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return {}
    return j if isinstance(j, dict) else {}


def plays(w: Where) -> list[dict]:
    """What the video plays, from video.json's "audio": a file ("audio/song.mp3") or a list of
    segments ({file, at, from, dur}); none for null. Each as {file: Path, at, from}."""
    a = video_json(w).get("audio")
    if isinstance(a, str) and a:
        return [{"file": (w.video_dir / a).resolve(), "at": 0.0, "from": 0.0}]
    out = []
    for seg in a if isinstance(a, list) else []:
        f = seg.get("file") if isinstance(seg, dict) else None
        if isinstance(f, str) and f:
            at, frm = seg.get("at", 0), seg.get("from", 0)
            out.append({"file": (w.video_dir / f).resolve(), "at": float(at) if isinstance(at, (int, float)) else 0.0,
                        "from": float(frm) if isinstance(frm, (int, float)) else 0.0})
    return out


def video_audio(w: Where) -> tuple[Path | None, str]:
    """The audio to analyze when none is given: the file video.json plays (a segment list counts when
    every segment is of one file), else, when video.json names none, the only audio file directly in
    audio/. Returns (file or None, how it was chosen or why none was)."""
    if w.video_dir is None:
        return None, "no video"
    segs = plays(w)
    files = list(dict.fromkeys(s["file"] for s in segs))
    if len(files) > 1:
        return None, (f"video.json splices {len(files)} files: pass the file to analyze (its times are that "
                      f"file's own), or analyze the mix")
    if files:
        f = files[0]
        if not f.is_file():
            return None, f"video.json plays {rel(f, w.project)}, which does not exist"
        return f, "video.json" if len(segs) == 1 else f"video.json (all {len(segs)} segments are of this file)"
    found = sorted(p for p in (w.video_dir / "audio").glob("*") if p.suffix.lower() in AUDIO_EXT) \
        if (w.video_dir / "audio").is_dir() else []
    if len(found) == 1:
        return found[0].resolve(), "the only audio file in audio/ (video.json names no audio)"
    return None, "video.json names no audio" + (f" and audio/ holds {len(found)} audio files" if found else "")


def mix_of(w: Where, audio: Path) -> tuple[Path, float, float] | None:
    """(the mix, at, from) when a file the video plays is mix.py's mix with `audio` as its music (the music row of
    the mix's request record): the video plays `audio` inside it, placed at `at` s from `from` s into it."""
    if w.project is None:
        return None
    audio = audio.resolve()
    for f in dict.fromkeys(s["file"] for s in plays(w)):
        try:
            rec = json.loads(f.with_name(f.name + ".request.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        mus = ((rec.get("resolved") or {}).get("music") or {}) if isinstance(rec, dict) else {}
        if mus.get("file") and (w.project / mus["file"]).resolve() == audio:
            return f, float(mus.get("at") or 0), float(mus.get("from") or 0)
    return None


def relation(w: Where, audio: Path) -> tuple[str, str] | None:
    """How an analyzed file stands to what the video plays: None when the video plays exactly it (or
    plays nothing yet), else ("note" | "warning", what to know). A mix (mix.py's mix.wav) that holds
    this music from its first sample at 0 s plays it on the same timeline: that is a note."""
    segs = plays(w)
    if not segs:
        return None
    audio = audio.resolve()
    if all(s["file"] == audio for s in segs):
        if all(abs(s["at"] - s["from"]) < 0.0005 for s in segs):
            return None
        return ("warning", f"video.json plays parts of {audio.name} at other times than the file's own: these "
                           f"times are the file's, not the video's")
    mix = mix_of(w, audio)
    if mix:
        f, at, frm = mix
        if abs(at) < 0.0005 and abs(frm) < 0.0005:
            return ("note", f"the video plays {rel(f, w.project)}, mix.py's mix of this music from 0 s: the same "
                            f"timeline")
        return ("warning", f"the video plays {rel(f, w.project)}, which holds this music at {at:.3f} s (from "
                           f"{frm:.3f} s into it): these times are the music file's; place the music at 0 in "
                           f"mix.json, or analyze music-only.wav, which has the mix's timeline")
    names = ", ".join(rel(f, w.project) for f in dict.fromkeys(s["file"] for s in segs))
    return ("warning", f"the video plays {names}, not {audio.name}: this analysis is for {audio.name}")


def find_input(p: str, w: Where, sub: str, what: str) -> Path:
    """`p` from the current folder, else from the video's sub/ folder, else from the video's folder (the way the
    data names files: "audio/song.mp3")."""
    path = Path(p)
    if path.is_file():
        return path.resolve()
    for d in ([w.video_dir / sub, w.video_dir] if w.video_dir is not None else []):
        if (d / p).is_file():
            return (d / p).resolve()
    extra = f" (also looked in {w.video_dir / sub} and {w.video_dir})" if w.video_dir is not None else ""
    raise Fail(2, f"{what} not found: {p}{extra}")


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


def use_cache(root: Path) -> None:
    """Point the model downloads (torch hub, Hugging Face) and numba's JIT cache at the audara cache.
    numba's own default is beside each module in uv's environment, which can lie deep in a project
    (UV_CACHE_DIR inside it, for a sandbox): an eval run failed there writing a 263-character path, so
    on Windows its folder is written the long way. A NUMBA_CACHE_DIR set by hand stays."""
    os.environ["TORCH_HOME"] = str(root / "torch")
    os.environ["HF_HOME"] = str(root / "hf")  # the layout align.py uses: one htdemucs download serves both
    os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
    if not os.environ.get("NUMBA_CACHE_DIR"):  # (read when numba is first imported, after this)
        nb = str((root / "numba").resolve())
        os.environ["NUMBA_CACHE_DIR"] = verbatim(nb) if sys.platform == "win32" else nb


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


def decode(path: Path) -> tuple[np.ndarray, int]:
    """ffmpeg's gapless decode (encoder delay trimmed, as Chrome's decodeAudioData plays it) at the
    file's own rate and channels: (samples x channels float32, rate)."""
    r = subprocess.run([tool("ffprobe"), "-v", "error", "-select_streams", "a:0", "-show_entries",
                        "stream=sample_rate,channels", "-of", "json", str(path)], capture_output=True, text=True)
    try:
        st = json.loads(r.stdout)["streams"][0]
        sr, ch = int(st["sample_rate"]), int(st["channels"])
    except (ValueError, KeyError, IndexError, TypeError):
        why = (r.stderr.strip().splitlines() or ["no audio stream"])[-1].replace(str(path), path.name)
        raise Fail(1, f"{path.name}: no audio stream that ffprobe can read ({why[:200]})")
    r = subprocess.run([tool("ffmpeg"), "-v", "error", "-nostdin", "-i", str(path), "-map", "0:a:0", "-vn",
                        "-f", "f32le", "-c:a", "pcm_f32le", "-"], capture_output=True)
    if r.returncode != 0:
        raise Fail(1, f"ffmpeg could not decode {path.name}: {r.stderr.decode(errors='replace').strip()[:300]}")
    y = np.frombuffer(r.stdout, np.float32)
    if len(y) < ch * sr * 0.5:
        raise Fail(1, f"{path.name}: decoded to {len(y) / max(ch, 1) / sr:.2f} s of audio; beats need at least a few seconds")
    return y[: len(y) // ch * ch].reshape(-1, ch).copy(), sr


# priming and time_note are the same code in beats.py, mix.py, align.py and eleven.py (mix.py runs ffprobe by name, as
# its other calls do): change all four together.
def priming(path: Path) -> float:
    """The encoder delay the gapless decode drops (s): the priming samples its first packet says to skip (an MP3's
    LAME header, AAC's edit list, Opus' pre-skip); 0 for PCM. A player that keeps them plays everything that late."""
    r = subprocess.run([tool("ffprobe"), "-v", "error", "-select_streams", "a:0", "-read_intervals", "%+#1",
                        "-show_packets", "-show_entries", "stream=sample_rate:packet_side_data=skip_samples", "-of",
                        "json", str(path)], capture_output=True, text=True)
    try:
        j = json.loads(r.stdout)
        sr = int(j["streams"][0]["sample_rate"])
        skip = sum(int(s.get("skip_samples") or 0) for p in j.get("packets", [])[:1]
                   for s in p.get("side_data_list", []))
    except (ValueError, KeyError, IndexError, TypeError):
        return 0.0
    return skip / sr


def time_note(name: str, delay: float) -> str:
    """The time origin, for notes and the summary: these times are the gapless decode's, never shifted; for a player
    that keeps the encoder delay, a WAV of that decode (a shift would only be right for that player)."""
    if delay <= 0:
        return (f"Time: t = 0 is the first sample of {name}, as browsers and ffmpeg play it: never shift these times; "
                f"no offset is needed.")
    q = (lambda s: s if re.fullmatch(r"[\w.,+=@-]+", s) else f'"{s}"')  # (quoted unless a shell reads it as one word)
    return (f"Time: t = 0 is the first sample of ffmpeg's gapless decode of {name} (its {delay * 1000:.1f} ms encoder "
            f"delay removed), which is what browsers and ffmpeg play: never shift these times. A player that keeps the "
            f"encoder delay plays every sound {delay * 1000:.1f} ms after them: give it a WAV of this decode instead "
            f"(ffmpeg -i {q(name)} {q(Path(name).stem + '.wav')}).")


@dataclass
class Audio:
    path: Path
    sha: str
    duration: float
    sr0: int
    channels: int
    multi44: np.ndarray  # samples x channels at 44.1 kHz
    mono44: np.ndarray
    mono22: np.ndarray
    delay: float = 0.0  # the encoder delay the decode dropped (s)


def load_audio(path: Path) -> Audio:
    import soxr

    y, sr0 = decode(path)
    duration = len(y) / sr0
    multi = soxr.resample(y, sr0, SR).astype(np.float32) if sr0 != SR else y
    mono44 = multi.mean(axis=1).astype(np.float32)
    mono22 = soxr.resample(mono44, SR, SR_LOW).astype(np.float32)
    return Audio(path, sha256(path), duration, sr0, y.shape[1], multi, mono44, mono22, priming(path))


# ---------------------------------------------------------------------------------------------
# Model stages (beats_models.py, in its own uv environment with torch)


def work_dir(root: Path, a: Audio) -> Path:
    d = root / "work" / a.sha[:12]
    d.mkdir(parents=True, exist_ok=True)
    return d


def deep_uv(uv: str) -> str | None:
    """uv's cache when the model stage's files in it (its environment, then torch's own folders) can pass the 260
    characters Windows allows while long paths are off; else None."""
    if sys.platform != "win32" or long_paths_on():
        return None
    d = os.environ.get("UV_CACHE_DIR") or subprocess.run([uv, "cache", "dir"], capture_output=True,
                                                         text=True).stdout.strip()
    if not d:
        return None
    d = os.path.abspath(d)
    return d if len(d) + len("\\environments-v2\\beats-models-0123456789abcdef\\Lib\\site-packages\\") + DEEPEST > 259 \
        else None


def run_models(a: Audio, root: Path, checkpoint: str | None, stems: bool) -> dict:
    worker = Path(__file__).with_name("beats_models.py")
    if not worker.is_file():
        raise Fail(1, f"{worker} is missing: beats.py runs its models through it (reinstall the skill), "
                      f"or analyze without models: --tracker librosa")
    uv = os.environ.get("UV") or shutil.which("uv")
    if not uv:
        raise Fail(1, "uv not found: install it (https://docs.astral.sh/uv/), then reopen the terminal")
    work = work_dir(root, a)
    tmp = []
    if checkpoint:
        f = work / "pcm-mono22.f32"
        a.mono22.astype(np.float32).tofile(f)
        tmp.append(f)
    if stems:
        f = work / "pcm-stereo44.f32"
        a.multi44.astype(np.float32).tofile(f)
        (work / "pcm-stereo44.json").write_text(json.dumps({"channels": a.multi44.shape[1]}), encoding="utf-8")
        tmp += [f, work / "pcm-stereo44.json"]
    cmd = [uv, "run", "--script", str(worker), "--work", str(work)]
    if checkpoint:
        cmd += ["--beats", checkpoint]
    if stems:
        cmd += ["--stems"]
    env = {k: v for k, v in os.environ.items() if k not in ("VIRTUAL_ENV", "PYTHONHOME", "PYTHONPATH")}
    note("beats.py: running the model stage (the first run installs torch CPU, Beat This! and Demucs into uv's "
         "cache once: a 625 MB environment)")
    try:
        r = subprocess.run(cmd, stdout=subprocess.PIPE, env=env)
    finally:
        for f in tmp:
            f.unlink(missing_ok=True)  # decoded PCM is an intermediate: never kept
    out = r.stdout.decode("utf-8", errors="replace").strip()
    if r.returncode != 0:
        deep = deep_uv(uv)
        raise Fail(1, f"the model stage failed (exit {r.returncode}); its messages are above. " + (
            f"If they name a file or module that could not be found or written, that is Windows' 260-character path "
            f"limit: the model stage runs from uv's cache at {deep} ({len(deep)} characters), where torch's files pass "
            f"260 characters, and long paths are off on this machine. Set UV_CACHE_DIR to a short folder such as "
            f"C:\\uvc (torch installs there again, about 625 MB), or enable long paths (LongPathsEnabled = 1, an admin "
            f"setting), then run again. " if deep else "")
                      + "To analyze without models: add --tracker librosa (no download; weaker on downbeats)")
    try:
        return json.loads(out.splitlines()[-1])
    except (json.JSONDecodeError, IndexError):
        raise Fail(1, f"beats_models.py printed no result: {out[-300:]}")


# ---------------------------------------------------------------------------------------------
# Beat tracking: detections -> cleaned beats -> steady-tempo test -> grid or detections


def pick_peaks(logit: np.ndarray, fps: float) -> tuple[np.ndarray, np.ndarray]:
    """Beat This!'s "minimal" peak picking (local maxima within +-70 ms where p > 0.5), plus a
    parabola through each peak and its neighbours: sub-frame times instead of 20 ms steps
    (measured on pdoom-video: beats within 17 ms of the truth went from 90% to 95%)."""
    from scipy.ndimage import maximum_filter1d

    x = np.asarray(logit, np.float64)
    mx = maximum_filter1d(x, 7, mode="constant", cval=-1e9)
    cand = np.flatnonzero((x == mx) & (x > 0))
    times, heights, i = [], [], 0
    while i < len(cand):
        j = i
        while j + 1 < len(cand) and cand[j + 1] - cand[j] <= 1:
            j += 1
        k, d = (cand[i] + cand[j]) / 2, 0.0  # a plateau: its middle
        if j == i and 0 < cand[i] < len(x) - 1:
            a, b, c = x[cand[i] - 1], x[cand[i]], x[cand[i] + 1]
            den = a - 2 * b + c
            if den < 0:
                d = float(np.clip(0.5 * (a - c) / den, -0.5, 0.5))
        times.append((k + d) / fps)
        heights.append(float(x[int(round(k))]))
        i = j + 1
    return np.array(times), np.array(heights)


def neighbour_median(x: np.ndarray, half: int = 4) -> np.ndarray:
    """Median of the `half` values on each side, leaving the value itself out (so an outlier at the
    edge of the list cannot set its own reference)."""
    return np.array([np.median(np.r_[x[max(0, i - half):i], x[i + 1:i + 1 + half]]) if len(x) > 1 else x[0]
                     for i in range(len(x))])


def clean_detections(t: np.ndarray, h: np.ndarray) -> tuple[np.ndarray, np.ndarray, int]:
    """Drop double detections, refill missed beats evenly. Returns (beats, refilled mask, dropped)."""
    t, h, dropped = list(map(float, t)), list(map(float, h)), 0
    while len(t) > 4:
        ibi = np.diff(t)
        loc = neighbour_median(ibi)
        bad = np.flatnonzero(ibi < EXTRA_RATIO * loc)
        if not len(bad):
            break
        i = int(bad[0])
        k = i if h[i] < h[i + 1] else i + 1
        del t[k], h[k]
        dropped += 1
    t = np.array(t)
    if len(t) <= 4:
        return t, np.zeros(len(t), bool), dropped
    ibi = np.diff(t)
    loc = neighbour_median(ibi)
    out, filled = [t[0]], [False]
    for i, g in enumerate(ibi):
        k = int(round(g / loc[i]))
        if g > GAP_RATIO * loc[i] and k >= 2:
            out += [t[i] + g * m / k for m in range(1, k)]
            filled += [True] * (k - 1)
        out.append(t[i + 1])
        filled.append(False)
    return np.array(out), np.array(filled), dropped


def ls_grid(t: np.ndarray) -> tuple[float, float, np.ndarray]:
    """Least-squares line through beat time vs beat index (one robust re-fit without outliers):
    (period, time of beat 0, residuals)."""
    i = np.arange(len(t), dtype=np.float64)
    P, a = np.polyfit(i, t, 1)
    r = t - (a + P * i)
    mad = float(np.median(np.abs(r - np.median(r))))
    keep = np.abs(r) <= max(0.015, 4 * 1.4826 * mad)
    if keep.sum() >= max(4, int(0.8 * len(t))):
        P, a = np.polyfit(i[keep], t[keep], 1)
        r = t - (a + P * i)
    return float(P), float(a), r


def window_devs(t: np.ndarray, r: np.ndarray) -> list[tuple[float, float]]:
    """Median residual per 16-beat window (hop 8): (window centre time, deviation)."""
    n, w = len(r), WINDOW_BEATS
    if n <= w:
        return [(float(np.median(t)), float(np.median(r)))]
    starts = list(range(0, n - w + 1, w // 2))
    if starts[-1] != n - w:
        starts.append(n - w)
    return [(float(t[s + w // 2]), float(np.median(r[s:s + w]))) for s in starts]


def local_tempo(t: np.ndarray, half: int = 4) -> np.ndarray:
    """BPM at each beat from a least-squares slope over the 9 beats around it."""
    n = len(t)
    out = np.empty(n)
    for i in range(n):
        a, b = max(0, i - half), min(n, i + half + 1)
        if b - a < 3:
            a, b = max(0, b - 3), min(n, a + 3)
        P = np.polyfit(np.arange(a, b, dtype=float), t[a:b], 1)[0]
        out[i] = 60.0 / P
    return out


def tempo_runs(t: np.ndarray, loc: np.ndarray) -> list[dict]:
    """Steady stretches and the changes between them, for the report and tempo.changes."""
    n, runs, i = len(t), [], 0
    while i < n:
        j = i + 1
        while j < n:
            seg = loc[i:j + 1]
            med = float(np.median(seg))
            if seg.max() - seg.min() > 2 * TEMPO_STEADY_TOL * med or abs(loc[j] - med) > TEMPO_STEADY_TOL * med:
                break
            j += 1
        runs.append((i, j))  # beats i..j-1
        i = j
    steady = [(a, b) for a, b in runs if b - a >= TEMPO_STEADY_MIN]
    merged: list[list[int]] = []
    for a, b in steady:  # neighbours at the same tempo (a stray beat between them) are one run
        if merged:
            pa, pb = merged[-1]
            pP = np.polyfit(np.arange(pa, pb, dtype=float), t[pa:pb], 1)[0]
            P = np.polyfit(np.arange(a, b, dtype=float), t[a:b], 1)[0]
            if abs(pP / P - 1) < TEMPO_STEADY_TOL:
                merged[-1][1] = b
                continue
        merged.append([a, b])
    def bpm_of(a: int, b: int) -> float:
        return 60.0 / float(np.polyfit(np.arange(a, b, dtype=float), t[a:b], 1)[0])

    # where the tempo moves between two stretches, pull their edges back to where the local tempo is
    # within TEMPO_EDGE_TOL of the stretch's own: the 1.2% band lets a stretch creep into a ramp
    for x, y in zip(merged, merged[1:]):
        bx, by = bpm_of(*x), bpm_of(*y)
        if abs(by / bx - 1) < TEMPO_CHANGE_MIN:
            continue
        while x[1] - x[0] > TEMPO_STEADY_MIN and abs(loc[x[1] - 1] / bx - 1) > TEMPO_EDGE_TOL:
            x[1] -= 1
        while y[1] - y[0] > TEMPO_STEADY_MIN and abs(loc[y[0]] / by - 1) > TEMPO_EDGE_TOL:
            y[0] += 1
    return [{"start": float(t[a]), "end": float(t[b - 1]), "bpm": bpm_of(a, b), "beats": b - a}
            for a, b in merged]


def extend(t: np.ndarray, duration: float) -> tuple[np.ndarray, int, int]:
    """Continue the beats to both ends of the file at the local period of the first/last 8 beats."""
    k = min(8, len(t))
    P0 = float(np.polyfit(np.arange(k, dtype=float), t[:k], 1)[0])
    P1 = float(np.polyfit(np.arange(k, dtype=float), t[-k:], 1)[0])
    before, x = [], t[0] - P0
    while x >= -START_SLACK:
        before.append(max(x, 0.0))
        x -= P0
    after, x = [], t[-1] + P1
    while x < duration:
        after.append(x)
        x += P1
    return np.r_[before[::-1], t, after], len(before), len(after)


def band_sos(lo, hi, sr):
    from scipy.signal import butter

    if lo and hi:
        return butter(4, [lo, hi], btype="band", fs=sr, output="sos")
    if hi:
        return butter(4, hi, btype="low", fs=sr, output="sos")
    return butter(4, lo, btype="high", fs=sr, output="sos")


def attacks(x: np.ndarray, sr: int, lo, hi, win=0.004, hop_s=0.001, rel_db=9.0, min_gap=0.06,
            rise_s=0.015) -> np.ndarray:
    """Onset times in one band: where a 4 ms causal window's log energy rises fastest, inside a
    rise of >= 9 dB over 15 ms that peaks >= 3 dB over the 1 s median floor. The causal window
    places an attack at its first millisecond (a centred window reads ~half a window early)."""
    from scipy.ndimage import median_filter
    from scipy.signal import find_peaks, sosfiltfilt

    xb = sosfiltfilt(band_sos(lo, hi, sr), x)
    h, w = int(round(hop_s * sr)), int(round(win * sr))
    c = np.concatenate([[0.0], np.cumsum(xb.astype(np.float64) ** 2)])
    idx = np.arange(w, len(xb) + 1, h)
    db = 10 * np.log10((c[idx] - c[idx - w]) / w + 1e-12)
    t_end = (idx - 1) / sr
    fps = sr / h
    d = np.diff(db, prepend=db[0])
    lag = int(rise_s * fps)
    rise = db - np.concatenate([np.full(lag, db[0]), db[:-lag]])
    floor = median_filter(db, int(1.0 * fps) | 1)
    pk, _ = find_peaks(rise, height=rel_db, distance=int(min_gap * fps))
    out = []
    for p in pk:
        a = max(0, p - lag)
        q = a + int(np.argmax(d[a:p + 1]))
        if db[p:p + int(0.03 * fps)].max() >= floor[p] + 3:
            out.append(t_end[q])
    return np.array(out)


def phase_shift(beats: np.ndarray, att: np.ndarray) -> tuple[float, int, bool]:
    """Median offset of the attacks near beats: (shift, beats with an attack, applied)."""
    if len(att) == 0 or len(beats) < 2:
        return 0.0, 0, False
    idx = np.clip(np.searchsorted(beats, att), 1, len(beats) - 1)
    left = np.abs(att - beats[idx - 1]) < np.abs(att - beats[idx])
    j = np.where(left, idx - 1, idx)
    r = att - beats[j]
    ok = np.abs(r) <= ATTACK_TOL
    hit = len(np.unique(j[ok]))
    if not ok.any():
        return 0.0, 0, False
    s = float(np.median(r[ok]))
    applied = hit >= max(ATTACK_MIN_BEATS, ATTACK_MIN_FRAC * len(beats)) and abs(s) <= ATTACK_MAX_SHIFT
    return s, hit, applied


@dataclass
class Beats:
    beats: np.ndarray
    raw: np.ndarray
    mode: str  # grid | detected | nominal
    bpm: float
    why: str
    fit: dict = field(default_factory=dict)
    devs: list = field(default_factory=list)
    extrap: tuple = (0, 0)
    filled: int = 0
    dropped: int = 0
    shift: float = 0.0
    shift_info: dict = field(default_factory=dict)
    tmap: list = field(default_factory=list)
    changes: list = field(default_factory=list)
    trange: tuple = ()
    runs: list = field(default_factory=list)
    level: str = ""  # "doubled" or "halved" by --tempo-hint
    att: np.ndarray = field(default_factory=lambda: np.zeros(0))  # the mix's attacks (s): the phase, beats.png's counts


def resolve_beats(det: np.ndarray, heights: np.ndarray, a: Audio, hint: float | None) -> Beats:
    """Detections -> delivered beats (see fit_beats); --tempo-hint first moves them to its metrical level."""
    if len(det) < 4:
        P = 60.0 / (hint or 120.0)
        b = np.arange(0.0, a.duration, P)
        att = np.sort(np.concatenate([attacks(a.mono44, SR, None, 150), attacks(a.mono44, SR, 1500, 5000),
                                      attacks(a.mono44, SR, 7000, None)]))  # (no phase to set: beats.png counts them)
        return Beats(b, det, "nominal", 60.0 / P, f"only {len(det)} beats found: a nominal {60 / P:.0f} BPM grid "
                     f"stands in (no pulse to follow). For music with a known tempo use: beats.py grid --bpm N",
                     att=att)
    lv, hv, level = to_level(det, heights, hint) if hint else (det, heights, "")
    out = fit_beats(lv, hv, a)
    out.raw, out.level = det, level  # beatsRaw stays the tracker's own output
    return out


def fit_beats(det: np.ndarray, heights: np.ndarray, a: Audio) -> Beats:
    """Clean the detections, test one least-squares grid against them per 16-beat window, and deliver
    the grid (steady) or the detections with a tempo map (not steady), phase-corrected on attacks."""
    duration = a.duration
    clean, filled, dropped = clean_detections(det, heights)
    P, a0, r = ls_grid(clean)
    devs = window_devs(clean, r)
    worst = max(devs, key=lambda d: abs(d[1]))
    rms = float(np.sqrt(np.mean(r ** 2)))
    fit = {"rmsMs": round(1000 * rms, 1), "maxMs": round(1000 * float(np.abs(r).max()), 1),
           "windowMs": [round(1000 * min(d for _, d in devs), 1), round(1000 * max(d for _, d in devs), 1)],
           "worstAt": round(worst[0], 2), "beats": len(clean)}
    att = np.sort(np.concatenate([attacks(a.mono44, SR, None, 150), attacks(a.mono44, SR, 1500, 5000),
                                  attacks(a.mono44, SR, 7000, None)]))
    if len(clean) >= MIN_GRID_BEATS and abs(worst[1]) <= GRID_TOL:
        k0, k1 = math.ceil((-START_SLACK - a0) / P), math.floor((duration - 1e-6 - a0) / P)
        grid = a0 + P * np.arange(k0, k1 + 1)
        s, hit, ok = phase_shift(grid, att)
        if ok:
            a0 += s
            k0, k1 = math.ceil((-START_SLACK - a0) / P), math.floor((duration - 1e-6 - a0) / P)
            grid = a0 + P * np.arange(k0, k1 + 1)
        grid = np.maximum(grid, 0.0)
        why = (f"steady: one least-squares grid fits the {fit['beats']} detected beats at {fit['rmsMs']} ms rms "
               f"({fit['maxMs']} ms at worst), and the median of every 16-beat window sits within "
               f"{fit['windowMs'][0]:+.1f}..{fit['windowMs'][1]:+.1f} ms of it (limit +-{GRID_TOL * 1000:.0f} ms), so "
               f"the grid replaces them and runs over the whole file")
        inside = (grid >= clean[0] - P / 2) & (grid <= clean[-1] + P / 2)
        out = Beats(grid, det, "grid", 60.0 / P, why, fit, devs, (int((grid < clean[0] - P / 2).sum()),
                    int((grid > clean[-1] + P / 2).sum())), int(filled.sum()), dropped,
                    s if ok else 0.0, {"medianMs": round(1000 * s, 1), "beatsWithAttack": hit, "applied": ok,
                                       "beatsConsidered": int(inside.sum())}, att=att)
        return out
    # not steady: keep the detections, write a tempo map
    s, hit, ok = phase_shift(clean, att)
    shifted = clean + (s if ok else 0.0)
    full, nb, na = extend(shifted, duration)
    full = full[(full >= 0) & (full < duration)]
    loc = local_tempo(full)
    loc_det = local_tempo(shifted)
    runs = tempo_runs(shifted, loc_det)
    changes = [{"from": round(x["end"], 3), "to": round(y["start"], 3), "bpmFrom": round(x["bpm"], 1),
                "bpmTo": round(y["bpm"], 1)} for x, y in zip(runs, runs[1:])
               if abs(y["bpm"] / x["bpm"] - 1) >= TEMPO_CHANGE_MIN]
    avg = 60.0 * (len(full) - 1) / (full[-1] - full[0])  # the delivered beats' average tempo
    why = (f"not steady: the median of the 16-beat window around {clock(worst[0])} sits "
           f"{abs(worst[1]) * 1000:.0f} ms from one least-squares grid through the detected beats (limit "
           f"+-{GRID_TOL * 1000:.0f} ms), so the detected beats are kept and bpm is their average"
           ) if len(clean) >= MIN_GRID_BEATS else (
        f"too short to test: {len(clean)} beats (a steady tempo needs {MIN_GRID_BEATS} to show), so the detected "
        f"beats are kept and bpm is their average")
    return Beats(full, det, "detected", avg, why, fit, devs, (nb, na), int(filled.sum()), dropped,
                 s if ok else 0.0, {"medianMs": round(1000 * s, 1), "beatsWithAttack": hit, "applied": ok,
                                    "beatsConsidered": len(clean)},
                 [[round(float(x), 3), round(float(b), 1)] for x, b in zip(full, loc)], changes,
                 (round(float(np.percentile(loc_det, 5)), 1), round(float(np.percentile(loc_det, 95)), 1)),
                 [{"start": round(x["start"], 3), "end": round(x["end"], 3), "bpm": round(x["bpm"], 2)}
                  for x in runs], att=att)


def to_level(det: np.ndarray, h: np.ndarray, hint: float) -> tuple[np.ndarray, np.ndarray, str]:
    """Double or halve the detections to the metrical level nearest --tempo-hint."""
    bpm = 60.0 / float(np.median(np.diff(det)))
    ratio = hint / bpm
    if ratio > 1.5:  # the tracker counted half-time: add the beat between each pair
        mids = (det[:-1] + det[1:]) / 2
        t = np.sort(np.r_[det, mids])
        hh = np.r_[h, np.full(len(mids), 0.1)][np.argsort(np.r_[det, mids])]
        return t, hh, "doubled"
    if ratio < 0.67:  # the tracker counted double-time: keep every other beat (the stronger set)
        k = 0 if h[0::2].sum() >= h[1::2].sum() else 1
        return det[k::2], h[k::2], "halved"
    return det, h, ""


def librosa_tempo(a: Audio) -> float:
    import librosa

    env = librosa.onset.onset_strength(y=a.mono22, sr=SR_LOW, hop_length=256)
    return float(np.atleast_1d(librosa.feature.tempo(onset_envelope=env, sr=SR_LOW, hop_length=256))[0])


def track_librosa(a: Audio) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """No-model tracker (pdoom-video digest): dynamic-programming beats on the percussive part's
    onset envelope (hop 64, tightness 300), seeded by librosa's own tempo estimate."""
    import librosa

    yh, yp = librosa.effects.hpss(a.mono22, margin=1.0)  # yh feeds the downbeat evidence
    seed = float(np.atleast_1d(librosa.beat.beat_track(y=a.mono22, sr=SR_LOW)[0])[0])
    env = librosa.onset.onset_strength(y=yp, sr=SR_LOW, hop_length=64)
    _, bt = librosa.beat.beat_track(onset_envelope=env, sr=SR_LOW, hop_length=64, start_bpm=seed,
                                    tightness=300, trim=False, units="time")
    bt = np.asarray(bt, float)
    fr = np.clip(np.round(bt * SR_LOW / 64).astype(int), 0, len(env) - 1)
    return bt, env[fr], yh


# ---------------------------------------------------------------------------------------------
# Bars


def beat_sync(X: np.ndarray, bf: np.ndarray, agg=np.median) -> np.ndarray:
    """Column j = feature frames from beat j to beat j+1 (explicit, so no padding shifts a beat)."""
    edges = np.r_[bf, X.shape[1]]
    out = np.empty((X.shape[0], len(bf)))
    for j in range(len(bf)):
        lo = min(int(edges[j]), X.shape[1] - 1)
        hi = max(int(edges[j + 1]), lo + 1)
        out[:, j] = agg(X[:, lo:hi], axis=1)
    return out


def harmonic_evidence(a: Audio, beats: np.ndarray, meter: int, yh: np.ndarray | None = None) -> np.ndarray:
    """No-model downbeat evidence (pdoom-video digest): chord change and bass-note change across each
    beat (chroma of the harmonic part, half a bar before vs after), z-scored and summed."""
    import librosa

    if yh is None:
        yh = librosa.effects.harmonic(a.mono22, margin=1.0)
    bf = librosa.time_to_frames(beats, sr=SR_LOW, hop_length=512)
    half = max(1, meter // 2)

    def change(C):
        S = beat_sync(C, np.minimum(bf, C.shape[1] - 1))
        n = S.shape[1]
        v = np.zeros(n)
        for i in range(1, n):
            x, y = S[:, max(0, i - half):i].mean(1), S[:, i:min(n, i + half)].mean(1)
            nx, ny = np.linalg.norm(x), np.linalg.norm(y)
            if nx > 0 and ny > 0:
                v[i] = 1 - float(x @ y / (nx * ny))
        return (v - v.mean()) / (v.std() + 1e-9)

    from scipy.signal import sosfiltfilt

    C = librosa.feature.chroma_cqt(y=yh, sr=SR_LOW, hop_length=512)
    yb = sosfiltfilt(band_sos(None, 250, SR_LOW), yh).astype(np.float32)
    Cb = librosa.feature.chroma_cqt(y=yb, sr=SR_LOW, hop_length=512, fmin=librosa.note_to_hz("C1"), n_octaves=4)
    return change(C) + change(Cb)


def bar_positions(ev: np.ndarray, m: int, jump: float) -> np.ndarray:
    """Viterbi over the position in the bar (0 = downbeat): each beat advances one position; a
    phase change costs `jump`. Emission: log p for position 0, log(1 - p) otherwise, p = sigmoid(ev)."""
    n = len(ev)
    lp1, lp0 = -np.logaddexp(0, -ev), -np.logaddexp(0, ev)
    D = np.empty((n, m))
    B = np.zeros((n, m), int)
    D[0] = lp0[0]
    D[0, 0] = lp1[0]
    adv = (np.arange(m) - 1) % m
    for i in range(1, n):
        prev = D[i - 1]
        best = int(np.argmax(prev))
        for s in range(m):
            stay = prev[adv[s]]
            if prev[best] - jump > stay:
                D[i, s], B[i, s] = prev[best] - jump, best
            else:
                D[i, s], B[i, s] = stay, adv[s]
            D[i, s] += lp1[i] if s == 0 else lp0[i]
    s = int(np.argmax(D[-1]))
    path = [s]
    for i in range(n - 1, 0, -1):
        s = int(B[i, s])
        path.append(s)
    return np.array(path[::-1])


def meter_from(beats_tl: np.ndarray, down_peaks: np.ndarray) -> tuple[int | None, int, int]:
    """Most common number of beats between the tracker's downbeats: (meter or None, support, bars)."""
    if len(down_peaks) < 3:
        return None, 0, 0
    j = np.unique([int(np.argmin(np.abs(beats_tl - d))) for d in down_peaks
                   if np.min(np.abs(beats_tl - d)) < 0.07])
    gaps = np.diff(j)
    gaps = gaps[(gaps >= 2) & (gaps <= 12)]
    if len(gaps) == 0:
        return None, 0, 0
    vals, cnt = np.unique(gaps, return_counts=True)
    k = int(np.argmax(cnt))
    return (int(vals[k]) if cnt[k] >= 0.5 * len(gaps) else None), int(cnt[k]), int(len(gaps))


# ---------------------------------------------------------------------------------------------
# Sections


def fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s).lower()).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s)).strip()


def laplacian_vectors(a: Audio, beats: np.ndarray) -> np.ndarray:
    """Laplacian segmentation (McFee & Ellis 2014, librosa's gallery recipe): the smoothed
    eigenvectors of the beat-level recurrence graph; cluster_labels() splits them into k kinds."""
    import librosa
    import scipy
    from scipy.ndimage import median_filter

    C = librosa.amplitude_to_db(np.abs(librosa.cqt(y=a.mono22, sr=SR_LOW, hop_length=512, bins_per_octave=36,
                                                   n_bins=7 * 36)), ref=np.max)
    M = librosa.feature.mfcc(y=a.mono22, sr=SR_LOW, hop_length=512, n_mfcc=13)
    bf = np.minimum(librosa.time_to_frames(beats, sr=SR_LOW, hop_length=512), C.shape[1] - 1)
    Cs, Ms = beat_sync(C, bf), beat_sync(M, bf, np.mean)
    R = librosa.segment.recurrence_matrix(Cs, width=3, mode="affinity", sym=True)
    Rf = librosa.segment.timelag_filter(median_filter)(R, size=(1, 7))
    pd = np.sum(np.diff(Ms, axis=1) ** 2, axis=0)
    ps = np.exp(-pd / max(float(np.median(pd)), 1e-9))
    Rp = np.diag(ps, k=1) + np.diag(ps, k=-1)
    dp, dr = Rp.sum(1), Rf.sum(1)
    mu = dp.dot(dp + dr) / max(float(np.sum((dp + dr) ** 2)), 1e-12)
    L = scipy.sparse.csgraph.laplacian(mu * Rf + (1 - mu) * Rp, normed=True)
    _, ev = scipy.linalg.eigh(L)
    return median_filter(ev, size=(9, 1))


def cluster_labels(ev: np.ndarray, k: int) -> np.ndarray:
    from scipy.cluster.vq import kmeans2

    X = ev[:, :k] / (np.cumsum(ev ** 2, axis=1)[:, k - 1:k] ** 0.5 + 1e-9)
    rng, best = np.random.default_rng(0), None
    for _ in range(10):
        cent, lab = kmeans2(X, k, minit="++", seed=rng)
        inertia = float(((X - cent[lab]) ** 2).sum())
        if best is None or inertia < best[0]:
            best = (inertia, lab)
    return best[1]


def snap(t: float, downs: np.ndarray) -> float:
    return float(downs[int(np.argmin(np.abs(downs - t)))])


def lyric_marks(words: dict, downs: np.ndarray, P: float) -> list[tuple[float, str]]:
    """Boundaries from words.json: the bar where singing starts, each chorus (the first line of a
    repeated block), and the bar after the last word. A line starting under 2 beats before a
    downbeat is a pickup: its section starts on that downbeat (pdoom-video's rule)."""
    lines = [l for l in words.get("lines", []) if l.get("words")]
    if not lines:
        return []
    texts = [fold(l.get("text", " ".join(w.get("w", "") for w in l["words"]))) for l in lines]
    rep = {t for t in texts if t and texts.count(t) > 1}

    def at_line(t: float) -> float:
        prev, nxt = downs[downs <= t + 0.03], downs[downs > t + 0.03]
        if len(nxt) and nxt[0] - t < 2 * P:
            return float(nxt[0])
        return float(prev[-1]) if len(prev) else 0.0

    marks = [(at_line(float(lines[0]["start"])), "vocal")]
    for i, l in enumerate(lines):
        if texts[i] in rep and (i == 0 or texts[i - 1] not in rep):
            marks.append((at_line(float(l["start"])), "chorus"))
    end = float(lines[-1]["end"])
    nxt = downs[downs > end + 0.03]
    if len(nxt):
        marks.append((float(nxt[0]), "outro"))
    return marks


def make_sections(a: Audio, beats: np.ndarray, downs: np.ndarray, P_bar: float, P_beat: float, words: dict | None,
                  manual: list[tuple[str, float]] | None, snap_manual: bool = False
                  ) -> tuple[list[dict], str, list[str], list[float]]:
    """Returns (sections, how they were made, report lines, boundaries the audio suggests that were
    not kept)."""
    dur, notes = a.duration, []
    if manual:
        # hand-given starts are kept exactly (a composed piece changes where its plan says, wherever the
        # downbeats fall); --snap-sections moves each to the nearest downbeat instead
        starts = []
        for name, t in manual:
            near = snap(t, downs) if len(downs) else t
            if snap_manual and t > 0:
                if abs(near - t) > 0.001:
                    notes.append(f"{name} {t:.3f} -> downbeat {near:.3f} (--snap-sections)")
                t = near
            elif t > 0 and abs(near - t) > 0.0015:
                notes.append(f"{name} at {t:.3f} s is {(t - near) * 1000:+.0f} ms from the nearest downbeat ({near:.3f} s): "
                             f"kept as declared (--snap-sections moves it)")
            starts.append((name, t))
        out, seen = [], set()
        for i, (name, s) in enumerate(starts):
            if round(s, 3) in seen:
                raise Fail(2, f"--sections: two sections start at {s:.3f} s; space them a bar apart")
            seen.add(round(s, 3))
            e = starts[i + 1][1] if i + 1 < len(starts) else dur
            out.append({"name": name, "start": round(s, 3), "end": round(e, 3)})
        return out, "manual", notes, []
    bars = len(downs)
    if bars < MIN_BARS_TO_SEGMENT or len(beats) < 32:
        return [{"name": "all", "start": 0.0, "end": round(dur, 3)}], "single", [f"one section: {bars} bars are "
                                                                              f"too few to tell parts apart"], []
    # sections last a median SECTION_MEDIAN_BARS bars, or fewer on a short piece: a piece of N bars is
    # split into about N / SECTIONS_PER_BARS parts at most, so a 25-bar excerpt keeps its 3-bar parts
    need = max(MIN_SECTION_BARS + 1.0, min(float(SECTION_MEDIAN_BARS), bars / SECTIONS_PER_BARS))
    ev = laplacian_vectors(a, beats)
    for k in range(MAX_CLUSTERS, 2, -1):
        lab = cluster_labels(ev, k)
        bnd = sorted({snap(beats[i], downs) for i in range(1, len(lab)) if lab[i] != lab[i - 1]})
        kept_a: list[float] = []
        for t in bnd:
            if MIN_SECTION_BARS * P_bar <= t <= dur - MIN_SECTION_BARS * P_bar and \
                    (not kept_a or t - kept_a[-1] >= MIN_SECTION_BARS * P_bar):
                kept_a.append(t)
        if np.median(np.diff(np.r_[0.0, kept_a, dur])) >= need * P_bar:
            break
    candidates = list(kept_a)  # the chosen clustering's boundaries: those merged away below are reported
    merged = 0  # still too fragmented with 3 kinds: merge the shortest section into its shorter neighbour
    while len(kept_a) >= 2 and np.median(np.diff(np.r_[0.0, kept_a, dur])) < need * P_bar:
        lens = np.diff(np.r_[0.0, kept_a, dur])
        i = int(np.argmin(lens))
        j = 0 if i == 0 else len(kept_a) - 1 if i == len(lens) - 1 else (i - 1 if lens[i - 1] <= lens[i + 1] else i)
        del kept_a[j]
        merged += 1
    rule = f"a median {need:g} bars or more" + ("" if need == SECTION_MEDIAN_BARS else f" (a {bars}-bar piece)")
    notes.append(f"{k} kinds of passage (the most whose sections last {rule})" if not merged else
                 f"{k} kinds of passage, and {merged} short section{'s' * (merged > 1)} merged into a neighbour so "
                 f"sections last {rule}")
    bnd = kept_a
    marks: dict[float, str] = {}
    rank = {"chorus": 3, "outro": 2, "vocal": 1}  # one boundary, two reasons: the stronger names it
    for t, kind in (lyric_marks(words, downs, P_beat) if words else []):
        key = round(t, 3)
        if 0.99 * P_bar <= t <= dur - P_bar and rank[kind] > rank.get(marks.get(key, ""), 0):
            marks[key] = kind
    sing = min(marks) if marks else None
    for t in sorted(snap(x, downs) for x in bnd):
        if t < MIN_SECTION_BARS * P_bar or t > dur - MIN_SECTION_BARS * P_bar:
            continue
        if any(abs(t - m) < MIN_SECTION_BARS * P_bar for m in marks):
            continue
        marks[round(t, 3)] = "audio"
    starts = sorted(marks)
    # merge audio boundaries closer than 2 bars to the previous kept one
    kept: list[float] = []
    for t in starts:
        if kept and t - kept[-1] < MIN_SECTION_BARS * P_bar and marks[t] == "audio":
            continue
        kept.append(t)
    dropped: list[float] = []  # one per bar at most: neighbouring proposals are one boundary
    for t in candidates:
        if all(abs(t - x) >= P_bar for x in kept) and all(abs(t - x) >= P_bar for x in dropped):
            dropped.append(round(t, 3))
    edges = [0.0] + kept + [dur]
    letters: dict[int, str] = {}
    count: dict[str, int] = {}
    chorus = 0
    out = []
    for i in range(len(edges) - 1):
        s, e = edges[i], edges[i + 1]
        kind = marks.get(round(s, 3), "start")
        if kind == "chorus":
            chorus += 1
            name = f"chorus{chorus}"
        elif kind == "outro" and words:
            name = "outro"
        elif i == 0 and sing is not None and len(edges) > 2 and abs(edges[1] - sing) < 1e-6:
            name = "intro"  # music before the first sung line
        else:
            sel = lab[(beats >= s) & (beats < e)]
            c = int(np.bincount(sel).argmax()) if len(sel) else 0
            letters.setdefault(c, "ABCDEFGHIJ"[len(letters) % 10])
            L = letters[c]
            count[L] = count.get(L, 0) + 1
            name = f"{L}{count[L]}"
        out.append({"name": name, "start": round(s, 3), "end": round(e, 3)})
    how = "audio novelty" + (" + repeated lyric lines" if words else "")
    return out, how, notes, dropped


def section_starts(secs: list[dict], downs) -> str:
    """Where the sections start, measured on the data: the first at 0 s, the later ones on downbeats or not (sections
    set by hand stay where given)."""
    later = [s["start"] for s in secs[1:]]
    if not later:
        return "one section, from 0 s"
    d = np.asarray(downs, float)
    on = sum(1 for t in later if len(d) and float(np.min(np.abs(d - t))) < 0.0015)
    return "the first starts at 0 s, " + ("every later one on a downbeat" if on == len(later) else
                                          f"{on} of the {len(later)} later ones on a downbeat")


def parse_sections(spec: str) -> list[tuple[str, float]]:
    """name:start,... in seconds, the first at 0, increasing (the engine's sections are contiguous from 0)."""
    out = []
    for part in [p.strip() for p in spec.split(",") if p.strip()]:
        if ":" not in part:
            raise Fail(2, f"--sections: '{part}' is not name:seconds (e.g. \"intro:0,verse:12.4,chorus:41.8\")")
        name, t = part.rsplit(":", 1)
        try:
            out.append((name.strip(), float(t)))
        except ValueError:
            raise Fail(2, f"--sections: '{t}' in '{part}' is not a time in seconds")
        if not name.strip():
            raise Fail(2, f"--sections: '{part}' has no name")
    if not out:
        raise Fail(2, "--sections is empty")
    if out[0][1] != 0:
        raise Fail(2, f"--sections takes start times, the first at 0 (\"intro:0,verse:12.4,chorus:41.8\"): "
                      f"{spec!r} looks like lengths. From lengths, the starts are their running sums")
    if any(b[1] <= a_[1] for a_, b in zip(out, out[1:])):
        raise Fail(2, "--sections: the start times must increase")
    return out


# ---------------------------------------------------------------------------------------------
# Envelopes and onsets (pdoom-video analysis/analyze.py, MIT, Giacomo Magnanini)


def frame_rms(x: np.ndarray, sr: int, n: int, win: int) -> np.ndarray:
    """RMS over `win` samples centred on each frame, frame i at i/FPS s."""
    hop = sr / FPS
    pad = np.pad(x.astype(np.float64), (win // 2, win // 2 + int(hop) + 2))
    idx = (np.arange(n) * hop).astype(int)
    c = np.concatenate([[0.0], np.cumsum(pad ** 2)])
    return np.sqrt(np.maximum((c[idx + win] - c[idx]) / win, 0))


def smooth_env(x: np.ndarray) -> np.ndarray:
    aa, ar = math.exp(-1 / (ATTACK_S * FPS)), math.exp(-1 / (RELEASE_S * FPS))
    y, s = np.empty_like(x), 0.0
    for i, v in enumerate(x):
        k = aa if v > s else ar
        s = k * s + (1 - k) * v
        y[i] = s
    return y


def env01(x: np.ndarray) -> list[float]:
    y = smooth_env(x)
    ref = float(np.percentile(y, NORM_PCT))
    return np.round(np.clip(y / (ref + 1e-12), 0, 1), 3).tolist()


def band_onsets(x, sr, lo, hi, win=0.010, hop_s=0.002, min_gap=0.08, rel_db=10.0):
    """Onsets in a band: steepest rise of the band's log energy; strength = the peak level (dB)."""
    from scipy.ndimage import median_filter, uniform_filter1d
    from scipy.signal import find_peaks, sosfiltfilt

    xb = sosfiltfilt(band_sos(lo, hi, sr), x)
    h, w = int(hop_s * sr), int(win * sr)
    e = np.convolve(xb.astype(np.float64) ** 2, np.ones(w) / w, mode="same")[::h]
    db = 10 * np.log10(e + 1e-10)
    fps = sr / h
    d = uniform_filter1d(np.diff(db, prepend=db[0]), 3)
    lag = int(0.02 * fps)
    rise = db - np.concatenate([np.full(lag, db[0]), db[:-lag]])
    floor = median_filter(db, int(1.0 * fps) | 1)
    pk, _ = find_peaks(rise, height=rel_db, distance=int(min_gap * fps))
    times, strength = [], []
    for p in pk:
        a = max(0, p - lag)
        q = a + int(np.argmax(d[a:p + 1]))
        peak = db[p:p + int(0.03 * fps)].max()
        if peak < floor[p] + 3:
            continue
        times.append(q / fps)
        strength.append(peak)
    return np.array(times), np.array(strength)


def drum_onsets(d, sr):
    """Kick < 120 Hz; snare = 1.5-5 kHz attack with a noisy 0.5-5 kHz tail 40-120 ms later; hat > 7 kHz
    away from snares and kicks (pdoom-video drum_onsets)."""
    from scipy.signal import sosfiltfilt

    kt, kdb = band_onsets(d, sr, None, 120, win=0.012, min_gap=0.15, rel_db=12)
    st, _ = band_onsets(d, sr, 1500, 5000, win=0.010, min_gap=0.15, rel_db=10)
    if len(st):
        xb = sosfiltfilt(band_sos(500, 5000, sr), d)
        e = np.sqrt(np.convolve(xb.astype(np.float64) ** 2, np.ones(441) / 441, mode="same"))
        tail = np.array([20 * np.log10(e[int((t + 0.04) * sr):int((t + 0.12) * sr)].mean() + 1e-9) for t in st])
        rel = np.array([tail[i] - tail[np.abs(st - st[i]) < 2.5].max() for i in range(len(st))])
        keep = (rel > -8) & (tail > np.percentile(tail, 95) - 25)
        st, sdb = st[keep], tail[keep]
    else:
        sdb = np.array([])
    ht, hdb = band_onsets(d, sr, 7000, None, win=0.006, min_gap=0.06, rel_db=9)
    for other, gap in ((st, 0.04), (kt, 0.03)):
        if len(other) and len(ht):
            keep = np.min(np.abs(ht[:, None] - other[None, :]), axis=1) > gap
            ht, hdb = ht[keep], hdb[keep]
    return (kt, kdb), (st, sdb), (ht, hdb)


def strength01(v: np.ndarray, lo_pct=5, hi_pct=95) -> np.ndarray:
    if len(v) == 0:
        return v
    lo, hi = np.percentile(v, lo_pct), np.percentile(v, hi_pct)
    return np.clip((v - lo) / (hi - lo + 1e-9) * 0.8 + 0.2, STRENGTH_FLOOR, 1)


def onset_list(t: np.ndarray, s: np.ndarray, duration: float) -> list[list[float]]:
    out, last = [], -1.0
    for x, y in sorted(zip(map(float, t), map(float, s))):
        x = round(x, 3)
        if x <= last or x < 0 or x >= round(duration, 3):
            continue
        out.append([x, round(float(np.clip(y, STRENGTH_FLOOR, 1)), 3)])
        last = x
    return out


def hpss_band(y: np.ndarray, n_fft: int, hop: int, top_hz: float, part: str) -> np.ndarray:
    """One part of librosa's HPSS (31-frame / 31-bin medians, margin 1), computed only on the bins
    up to `top_hz` plus 16: a bin's masks read at most 15 bins away, so the kept band comes out as
    in the full decomposition, at a fraction of the cost (on a 2.6 min song: 24.6 s for all three
    full decompositions)."""
    import librosa

    S = librosa.stft(y, n_fft=n_fft, hop_length=hop)
    nb = min(S.shape[0], int(math.ceil(top_hz * n_fft / SR_LOW)) + 16)
    H, P = librosa.decompose.hpss(S[:nb], kernel_size=31, margin=1.0)
    X = np.zeros_like(S)
    X[:nb] = H if part == "harmonic" else P
    return librosa.istft(X, hop_length=hop, length=len(y))


def mix_features(a: Audio, n: int) -> tuple[dict, dict, dict]:
    """rms/low/mid/high from the mix; drums/bass/vocal approximated from it; kick onsets."""
    from scipy.signal import sosfiltfilt

    x = a.mono44.astype(np.float64)
    f = {"rms": env01(frame_rms(x, SR, n, ENV_WIN))}
    for name, (lo, hi) in {"low": (None, LOW_HZ), "mid": (LOW_HZ, MID_HZ), "high": (HIGH_HZ, None)}.items():
        f[name] = env01(frame_rms(sosfiltfilt(band_sos(lo, hi, SR), x), SR, n, ENV_WIN))
    # approximations from the mix (Pearson r against Demucs stems on pdoom-video EN / pt-BR):
    # drums = percussive part < 200 Hz (0.91 / 0.87), bass = long-window harmonic part < 250 Hz
    # (0.63 / 0.53), vocal = harmonic part 300-3400 Hz (0.81 / 0.66)
    y, w22 = a.mono22, ENV_WIN // 2
    yp = hpss_band(y, 2048, 512, 200, "percussive")
    f["drums"] = env01(frame_rms(sosfiltfilt(band_sos(None, 200, SR_LOW), yp), SR_LOW, n, w22))
    yh = hpss_band(y, 4096, 512, 250, "harmonic")
    f["bass"] = env01(frame_rms(sosfiltfilt(band_sos(None, 250, SR_LOW), yh), SR_LOW, n, w22))
    yh = hpss_band(y, 1024, 256, 3400, "harmonic")
    f["vocal"] = env01(frame_rms(sosfiltfilt(band_sos(300, 3400, SR_LOW), yh), SR_LOW, n, w22))
    kt, kdb = band_onsets(x, SR, None, 120, win=0.012, min_gap=0.15, rel_db=12)
    onsets = {"kick": onset_list(kt, strength01(kdb), a.duration)}
    src = {"rms": "mix", "low": "mix < 150 Hz", "mid": "mix 150-2000 Hz", "high": "mix > 4 kHz",
           "drums": "approximation: percussive part of the mix < 200 Hz (use --stems for the drum stem)",
           "bass": "approximation: harmonic part of the mix < 250 Hz (use --stems for the bass stem)",
           "vocal": "approximation: harmonic part of the mix 300-3400 Hz, includes other instruments "
                    "(use --stems for the vocal stem)",
           "onsets.kick": "mix < 120 Hz attacks"}
    return f, onsets, src


def stem_features(a: Audio, stems: dict[str, np.ndarray], n: int) -> tuple[dict, dict, dict]:
    import librosa

    f = {("vocal" if k == "vocals" else k): env01(frame_rms(v.astype(np.float64), SR, n, ENV_WIN))
         for k, v in stems.items()}
    (kt, kdb), (st, sdb), (ht, hdb) = drum_onsets(stems["drums"].astype(np.float64), SR)
    on = {"kick": onset_list(kt, strength01(kdb), a.duration), "snare": onset_list(st, strength01(sdb), a.duration),
          "hat": onset_list(ht, strength01(hdb), a.duration)}
    v = stems["vocals"].astype(np.float32)
    vr = frame_rms(v, SR, n, ENV_WIN)
    gate = max(float(np.percentile(vr, 95)) * VOCAL_GATE, 0.002)
    vo = librosa.onset.onset_strength(y=v, sr=SR, hop_length=220)
    vf = librosa.onset.onset_detect(onset_envelope=vo, sr=SR, hop_length=220)
    p99 = max(float(np.percentile(vo, 99)), 1e-9)
    vt = [(f_ * 220 / SR, vo[f_] / p99) for f_ in vf if vr[min(n - 1, int(round(f_ * 220 / SR * FPS)))] > gate]
    on["vocal"] = onset_list(np.array([t for t, _ in vt]), np.array([s for _, s in vt]), a.duration)
    f0 = librosa.yin(v, fmin=65, fmax=1050, sr=SR, frame_length=2048, hop_length=441)
    pm = np.zeros(n)
    m = min(n, len(f0))
    pm[:m] = librosa.hz_to_midi(f0[:m])
    pm[vr < gate] = 0
    f["pitchMidi"] = np.round(np.clip(np.nan_to_num(pm), 0, 128), 2).tolist()
    src = {"vocal": "Demucs htdemucs vocal stem", "drums": "drum stem", "bass": "bass stem", "other": "other stem",
           "pitchMidi": "YIN on the vocal stem, 0 where it is quiet (an estimate, not a transcription)",
           "onsets.kick": "drum stem < 120 Hz", "onsets.snare": "drum stem 1.5-5 kHz attacks with a noise tail",
           "onsets.hat": "drum stem > 7 kHz", "onsets.vocal": "vocal stem spectral flux"}
    return f, on, src


def load_stems(work: Path, n_samples: int) -> dict[str, np.ndarray] | None:
    import soundfile as sf

    d = work / "htdemucs"
    meta = d / "scale.json"
    if not meta.is_file():
        return None
    sc = json.loads(meta.read_text(encoding="utf-8"))
    out = {}
    for k in ("drums", "bass", "other", "vocals"):
        f = d / f"{k}.flac"
        if not f.is_file():
            return None
        y, sr = sf.read(f, dtype="float32")
        if sr != SR or abs(len(y) - n_samples) > 2:
            return None
        y = np.pad(y, (0, max(0, n_samples - len(y))))[:n_samples]
        out[k] = y * float(sc["scale"].get(k, 1.0))
    return out


# ---------------------------------------------------------------------------------------------
# Validation (the engine's reader, plus pdoom-video's check-pt-br.ts invariants)


def validate(doc: dict, decoded: float | None = None, sha: str | None = None) -> tuple[list[str], list[str], int]:
    errs, warns, n = [], [], 0

    def check(ok: bool, msg: str, warn: bool = False):
        nonlocal n
        n += 1
        if not ok:
            (warns if warn else errs).append(msg)

    def num(x):
        return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)

    dur, bpm, fps = doc.get("duration"), doc.get("bpm"), doc.get("fps", 100)
    check(num(dur) and dur > 0, f"duration must be a positive number (got {dur!r})")
    check(num(bpm) and bpm > 0, f"bpm must be a positive number (got {bpm!r})")
    check(num(fps) and fps > 0, f"fps must be a positive number (got {fps!r})")
    if errs:
        return errs, warns, n
    beats, downs = doc.get("beats") or [], doc.get("downbeats") or []
    check(isinstance(beats, list) and len(beats) >= 2, "beats needs at least 2 times (the engine's timeOfBeat "
                                                       "returns NaN with fewer)")
    b = np.asarray(beats, float) if beats else np.zeros(0)
    d = np.asarray(downs, float) if downs else np.zeros(0)
    if len(b) >= 2:
        check(bool(np.all(np.diff(b) > 0)), "beats must be strictly increasing")
        check(b[0] >= 0 and b[-1] < dur, f"beats must lie in [0, duration): {b[0]:.3f}..{b[-1]:.3f} vs {dur}")
        ibi = np.diff(b)
        loc = neighbour_median(ibi)
        odd = np.flatnonzero(np.abs(ibi / loc - 1) > 0.15)
        check(len(odd) == 0, f"{len(odd)} beat intervals differ from their neighbours by over 15% (first at "
                              f"{b[odd[0]]:.2f} s): an extra or missing beat shifts every bar after it"
              if len(odd) else "", warn=True)
        if (doc.get("tempo") or {}).get("mode") in ("grid", "declared"):
            inner = b[1:-1] if len(b) > 4 else b  # a first beat kept at 0 (START_SLACK) is off the slope
            P = np.polyfit(np.arange(len(inner), dtype=float), inner, 1)[0]
            check(abs(60 / bpm - P) <= 0.0005, f"bpm {bpm} does not match the beats' slope ({60 / P:.3f} BPM)")
        else:
            avg = 60 * (len(b) - 1) / (b[-1] - b[0])
            check(abs(bpm / avg - 1) < 0.02, f"bpm {bpm} is not the beats' average tempo ({avg:.2f})", warn=True)
    check(len(d) >= 1, "downbeats is empty (the engine falls back to every 4th beat)", warn=True)
    if len(d):
        check(bool(np.all(np.diff(d) > 0)), "downbeats must be strictly increasing")
        if len(b):
            far = [x for x in d if np.min(np.abs(b - x)) > 0.001]
            check(not far, f"{len(far)} downbeats are not beats (first {far[0] if far else 0:.3f} s)")
    bib = doc.get("beatInBar")
    if bib is not None:
        check(len(bib) == len(b), f"beatInBar has {len(bib)} entries for {len(b)} beats")
        if len(bib) == len(b) and len(b):
            is_down = np.isin(np.round(b, 3), np.round(d, 3))
            check(bool(np.all((np.asarray(bib) == 1) == is_down)), "beatInBar 1 must mark exactly the downbeats")
    secs = doc.get("sections") or []
    check(len(secs) >= 1, "sections needs at least one {name, start, end}")
    if not all(isinstance(s, dict) and num(s.get("start")) and num(s.get("end")) for s in secs):
        check(False, "every section needs numeric start and end")
        secs = []
    if secs:
        check(abs(secs[0]["start"]) < 0.0015, "the first section must start at 0")
        check(abs(secs[-1]["end"] - dur) < 0.0015, f"the last section must end at duration ({dur})")
        for x, y in zip(secs, secs[1:]):
            if abs(x["end"] - y["start"]) >= 0.0015:
                check(False, f"sections {x['name']} and {y['name']} are not contiguous")
                break
        check(all(s["end"] > s["start"] and str(s.get("name", "")).strip() for s in secs),
              "every section needs a name and end > start")
    feats = dict(doc.get("features") or {})
    for k in ("rms", "low", "mid", "high", "vocal", "drums", "bass", "other", "pitchMidi"):
        if k not in feats and isinstance(doc.get(k), list):
            feats[k] = doc[k]
    want = math.ceil(dur * fps)
    for k, v in feats.items():
        if not v:
            continue
        arr = np.asarray(v, float)
        check(abs(len(arr) - want) <= 1, f"features.{k} has {len(arr)} values; ceil(duration*fps) = {want}")
        top = 128 if k == "pitchMidi" else 1
        check(bool(np.all(np.isfinite(arr)) and arr.min() >= 0 and arr.max() <= top),
              f"features.{k} must lie in [0, {top}]")
    for k, ev in (doc.get("onsets") or {}).items():
        arr = np.asarray(ev, float).reshape(-1, 2) if len(ev) else np.zeros((0, 2))
        if len(arr):
            check(bool(np.all(np.diff(arr[:, 0]) > 0)), f"onsets.{k} times must be strictly increasing (hit() "
                                                         f"binary-searches them)")
            check(bool(arr[0, 0] >= 0 and arr[-1, 0] < dur), f"onsets.{k} times must lie in [0, duration)")
            check(bool(arr[:, 1].min() >= 0 and arr[:, 1].max() <= 1), f"onsets.{k} strengths must lie in [0, 1]")
    for c in doc.get("cues") or []:
        check(num(c.get("t")) and 0 <= c["t"] <= dur and str(c.get("name", "")).strip(),
              f"cue {c!r} needs a name and a time in [0, duration]")
    if decoded is not None:
        check(abs(dur - decoded) <= 0.05, f"duration {dur} differs from the audio's decoded length {decoded:.3f} s")
    if sha is not None and doc.get("audioSha256"):
        check(doc["audioSha256"] == sha, "audioSha256 differs: this data was made for another version of the audio")
    return errs, warns, n


# ---------------------------------------------------------------------------------------------
# Review: beat sheet and click track


def pick_passages(dur: float, bar_s: float, rms: np.ndarray, devs: list, secs: list, tmap: list, mode: str,
                  phase_changes: list) -> list[tuple[str, float, float]]:
    """Up to six windows of ~4 bars: the start and the end always, then where trackers fail or where
    the decision was made (the quietest stretch, the largest grid deviation or the fastest tempo
    change, a bar-phase change), the loudest stretch, section starts."""
    L = float(np.clip(4 * bar_s, 4.0, 8.0))
    if dur <= 2 * L:
        return [("whole file", 0.0, dur)]
    out = [("start", 0.0, L), ("end", dur - L, dur)]

    def add(label, centre):
        t0 = float(np.clip(centre - L / 2, 0, dur - L))
        if len(out) < 6 and all(t0 + L <= x or t0 >= y for _, x, y in out):
            out.append((label, t0, t0 + L))

    w = int(L * FPS)
    wins = [(float(rms[i:i + w].mean()), (i + w / 2) / FPS) for i in range(w, max(w, len(rms) - 2 * w), max(1, w // 4))]
    if wins:
        add("quietest", min(wins)[1])
    if mode == "grid" and devs:
        c, d = max(devs, key=lambda x: abs(x[1]))
        add(f"largest grid deviation ({d * 1000:+.1f} ms)", c)
    elif mode == "detected" and len(tmap) > 2:
        bp = np.array([b for _, b in tmap])
        add("fastest tempo change", tmap[int(np.argmax(np.abs(np.gradient(bp))))][0])
    for t in phase_changes[:1]:
        add("bar-phase change", t)
    if wins:
        add("loudest", max(wins)[1])
    for s in secs[1:]:
        add(f"section {s['name']}", s["start"] + L / 2 - bar_s / 2)
    for frac in (0.5, 0.3, 0.7):
        add("middle", dur * frac)
    return [out[0]] + sorted(out[2:], key=lambda x: x[1]) + [out[1]]


def plot_review(path: Path, a: Audio, doc: dict, B: Beats, title: str, phase_changes: list) -> list[str]:
    import matplotlib

    matplotlib.use("Agg")
    import librosa
    import matplotlib.pyplot as plt

    beats, downs = np.asarray(doc["beats"]), np.asarray(doc["downbeats"])
    rms = np.asarray(doc["features"]["rms"])
    env = librosa.onset.onset_strength(y=a.mono22, sr=SR_LOW, hop_length=128)
    env = np.clip(env / (np.percentile(env, 99.5) + 1e-9), 0, 1.0)
    te = np.arange(len(env)) * 128 / SR_LOW
    tr = np.arange(len(rms)) / FPS
    bar_s = (downs[-1] - downs[0]) / max(1, len(downs) - 1) if len(downs) > 1 else 4 * 60 / doc["bpm"]
    raw = B.raw + B.shift if len(B.raw) else B.raw
    passages = pick_passages(a.duration, bar_s, rms, B.devs, doc["sections"], B.tmap, B.mode, phase_changes)
    rows = math.ceil(len(passages) / 2)
    H = 3.6 + 2.4 * rows
    fig = plt.figure(figsize=(16, H), dpi=100)
    gs = fig.add_gridspec(1 + rows, 2, height_ratios=[1.35] + [1] * rows, hspace=0.6, wspace=0.05,
                          left=0.05, right=0.94, top=1 - 0.55 / H, bottom=0.6 / H)
    red, blue, orange = "#c0392b", "#4a7fb5", "#e67e22"
    ax = fig.add_subplot(gs[0, :])
    ax.fill_between(tr, 0, rms, color="0.82", lw=0)
    ax.plot(tr, rms, color="0.45", lw=0.4)
    cols = ["#9ecae1", "#fdd0a2", "#a1d99b", "#dadaeb", "#fdae6b", "#c7e9c0", "#bcbddc", "#fee391"]
    for i, s in enumerate(doc["sections"]):
        ax.axvspan(s["start"], s["end"], ymin=0.88, ymax=1.0, color=cols[i % len(cols)], lw=0)
        ax.axvline(s["start"], color="0.3", lw=0.6, ymin=0.88)
        if s["end"] - s["start"] > 0.025 * a.duration:
            ax.text((s["start"] + s["end"]) / 2, 0.94, s["name"], fontsize=8, ha="center", va="center",
                    transform=ax.get_xaxis_transform())
    for k, (_, t0, t1) in enumerate(passages):
        ax.axvspan(t0, t1, ymin=0, ymax=0.06, color="k", lw=0)
        ax.text((t0 + t1) / 2, 0.075, str(k + 1), fontsize=7, ha="center", va="bottom",
                transform=ax.get_xaxis_transform())
    ax.set_xlim(0, a.duration)
    ax.set_ylim(0, 1.0 / 0.86)
    ax.set_yticks([0, 0.5, 1])
    ax.set_ylabel("rms (0..1)", fontsize=8)
    ax.tick_params(labelsize=8)
    ax.set_xlabel("time (s); numbered black marks: the passages below; coloured strip: sections", fontsize=8)
    ax2 = ax.twinx()
    if B.mode == "grid" and B.devs:
        ax2.step([c for c, _ in B.devs], [d * 1000 for _, d in B.devs], where="mid", color=red, lw=1.3)
        ax2.axhspan(-GRID_TOL * 1000, GRID_TOL * 1000, color=red, alpha=0.08, lw=0)
        ax2.axhline(0, color=red, lw=0.5, alpha=0.5)
        ax2.set_ylabel(f"detections - grid, ms (band +-{GRID_TOL * 1000:.0f})", color=red, fontsize=8)
        lim = max(GRID_TOL * 1000 * 1.8, max(abs(d) for _, d in B.devs) * 1000 * 1.25)
        ax2.set_ylim(-lim, lim)
    elif B.tmap:
        ax2.plot([t for t, _ in B.tmap], [b for _, b in B.tmap], color=red, lw=1.3)
        ax2.set_ylabel("local tempo (BPM, 9-beat fit)", color=red, fontsize=8)
    ax2.tick_params(labelsize=8, colors=red)
    ax.set_title(title, fontsize=10, loc="left", pad=6)
    att = np.asarray(B.att, float)
    rest = "the tracker places the rest" if B.mode == "detected" else "the grid carries the rest"
    shown, titles = [], []
    for k, (label, t0, t1) in enumerate(passages):
        axp = fig.add_subplot(gs[1 + k // 2, k % 2])
        m = (te >= t0) & (te <= t1)
        axp.fill_between(te[m], 0, env[m], color=blue, alpha=0.5, lw=0)
        mr = (tr >= t0) & (tr <= t1)
        axp.plot(tr[mr], rms[mr], color="0.3", lw=0.8)
        xt = axp.get_xaxis_transform()
        inp = beats[(beats >= t0) & (beats <= t1)]
        hit = sum(1 for t in inp if len(att) and float(np.min(np.abs(att - t))) <= ON_BEAT)
        on_att = f"attacks at {hit} of {len(inp)} beats" + (f"; {rest}" if hit < len(inp) else "")
        shown.append(f"{k + 1}. {label} {clock(t0)}: {on_att}")
        for t in inp:
            isd = bool(len(downs)) and np.min(np.abs(downs - t)) < 1e-6
            # a beat within 35 ms of a detection was heard (pdoom's grid beats sit within 22 ms of theirs); the
            # others, extrapolated past the detections or refilled between them, are dashed, grid or not
            heard = bool(len(raw)) and np.min(np.abs(raw - t)) < 0.035
            axp.axvline(t, color="k" if isd else "0.4", lw=1.9 if isd else 0.7, ls="-" if heard else (0, (3, 2)))
            if isd:
                axp.text(t, 1.01, str(int(np.searchsorted(downs, t + 1e-6))), fontsize=7, ha="center",
                         va="bottom", transform=xt)
        rr = raw[(raw >= t0) & (raw <= t1)] if len(raw) else []
        axp.plot(rr, np.full(len(rr), 1.1), "v", color=orange, ms=4.5, clip_on=False)
        for s in doc["sections"]:
            if t0 <= s["start"] <= t1 and s["start"] > 0:
                axp.axvline(s["start"], color=red, lw=1.6)
                axp.text(s["start"], 0.84, f" {s['name']}", color=red, fontsize=8, ha="left", va="center",
                         transform=xt, bbox=dict(fc="white", ec="none", pad=0.5))
        axp.set_xlim(t0, t1)
        axp.set_ylim(0, 1.18)
        axp.set_yticks([])
        axp.tick_params(labelsize=7, pad=1)
        titles.append((axp, axp.set_title(f"{k + 1}. {label}: {clock(t0)}-{clock(t1)}; {on_att}", fontsize=9,
                                          loc="left", pad=11)))
    renderer = fig.canvas.get_renderer()
    for axp, ttl in titles:  # a long label ("largest grid deviation (+7.5 ms)") would run into the next panel
        while ttl.get_window_extent(renderer).width > axp.get_window_extent(renderer).width and ttl.get_fontsize() > 6:
            ttl.set_fontsize(ttl.get_fontsize() - 0.5)
    stems = bool((doc.get("analysis") or {}).get("stems"))
    fig.text(0.05, 0.08 / H, "blue: onset strength of the whole mix ("
             + ("not the drum stem" if stems else "no drum stems without --stems") + "); grey line: rms; black lines: "
             "downbeats (bar numbers above); grey lines: beats (dashed = extrapolated or refilled)\norange triangles: "
             "the tracker's raw detections (phase-corrected); red: section starts; titles: the beats with an attack "
             f"within {ON_BEAT * 1000:.0f} ms (a fast rise in the mix's kick, snare or hat band)", fontsize=8,
             va="bottom", linespacing=1.4)
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=100)
    plt.close(fig)
    return shown


def write_clicks(path: Path, a: Audio, beats: list[float], downs: list[float]) -> None:
    song = a.mono44.astype(np.float64)
    song = 0.5 * song / max(float(np.abs(song).max()), 1e-9)
    out = song.copy()
    dset = set(np.round(downs, 3).tolist())

    def click(f, gain, dur=0.03):
        t = np.arange(int(dur * SR)) / SR
        return gain * np.sin(2 * np.pi * f * t) * np.exp(-t / 0.006)

    hi, lo = click(1760, 0.6), click(1100, 0.42)  # downbeats a sixth higher and louder
    for t in beats:
        c = hi if round(t, 3) in dset else lo
        i = int(round(t * SR))
        j = min(len(out), i + len(c))
        if i < len(out):
            out[i:j] += c[:j - i]
    pk = float(np.abs(out).max())
    if pk > 0.79:
        out *= 0.79 / pk  # -2 dBFS before AAC, whose overshoot measured +0.9 to +1.1 dB: true peak stays under -1 dBTP
    path.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run([tool("ffmpeg"), "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-",
                        "-c:a", "aac", "-b:a", f"{CLICK_KBPS}k", "-movflags", "+faststart", str(path)],
                       input=out.astype(np.float32).tobytes(), capture_output=True)
    if r.returncode != 0:
        raise Fail(1, f"ffmpeg could not write {path.name}: {r.stderr.decode(errors='replace')[:300]}")


def probe_duration(path: Path) -> float | None:
    r = subprocess.run([tool("ffprobe"), "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                        str(path)], capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return None


# ---------------------------------------------------------------------------------------------
# analyze


def rel(p: Path, base: Path | None) -> str:
    try:
        return p.resolve().relative_to(base.resolve()).as_posix() if base else str(p)
    except ValueError:
        return str(p)


def data_name(p: Path, w: Where) -> str:
    """How the data names a file: from the video's folder in a project (as video.json does), else from the --out
    folder; by its name alone when it lies outside both, so no machine's paths land in the data."""
    try:
        p.resolve().relative_to((w.project or w.base).resolve())
    except ValueError:
        return p.name
    return Path(os.path.relpath(p.resolve(), (w.video_dir or w.base).resolve())).as_posix()


def window_command(rec: dict, w: Where) -> str:
    """The command that cuts the window `rec` (a window record) again, from the song's data in data/song/."""
    song = rec.get("song")
    found = isinstance(song, str) and song and ((w.video_dir or w.base) / song).is_file()
    return (f"beats.py window {'' if found else f'<the file {song}> '}"
            + (f"--video {w.name}" if w.name else f"--out {w.base}") + f" --from {rec.get('from')} --to {rec.get('to')}"
            + (f" --fade {rec['fade']}" if rec.get("fade") else "") + (f" --name {rec['name']}" if rec.get("name") else "")
            + (" --exact" if rec.get("exact") else ""))


def window_cut_of(audio: Path, w: Where) -> dict | None:
    """The window record (beats.py window) when `audio` is the cut it describes: data/audio.json or data/words.json
    names it, or was made from it (its audioSha256)."""
    name, sha = data_name(audio, w), None
    for p in (w.data_dir / "audio.json", w.data_dir / "words.json"):
        try:
            d = json.loads(p.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError):
            continue
        rec = d.get("window") if isinstance(d, dict) else None
        if not isinstance(rec, dict):
            continue
        sha = sha or sha256(audio)
        if rec.get("file") == name or d.get("audioSha256") == sha:
            return rec
    return None


def dump_doc(doc: dict) -> str:
    """audio.json with one top-level key per line (each value compact): a change to the sections or the
    beats shows in a diff as that line, not as the whole file."""
    body = ",\n".join(f"{json.dumps(k)}:{json.dumps(v, ensure_ascii=False, separators=(',', ':'))}"
                      for k, v in doc.items())
    return "{\n" + body + "\n}\n"


def run_analyze(args, w: Where | None = None) -> dict:
    """`w`: where to write instead of the usual place (window passes data/song/ for the whole song's analysis)."""
    t_start = time.time()
    if sys.platform == "darwin" and platform.machine() == "x86_64" and (args.tracker == "beat-this" or args.stems):
        raise Fail(1, "Beat This! and Demucs need PyTorch, which no longer ships for Intel Macs: analyze with "
                      "--tracker librosa (no stems)")
    if w is None:
        w = where(args.video, args.out, [args.audio] if args.audio else [])
    for_window = getattr(args, "for_window", False)
    if args.audio:
        audio = find_input(args.audio, w, "audio", "audio file")
        chosen = None
    else:
        audio, chosen = video_audio(w)
        if audio is None:
            raise Fail(2, "give the audio file to analyze" + (f" ({chosen})" if w.video_dir is not None else
                                                             " (or --video <video> whose video.json names its audio)"))
    file_rel = data_name(audio, w) if w.video_dir else audio.name
    cut_of = None if for_window else window_cut_of(audio, w)
    if cut_of:  # (its bars would be counted and its sections named afresh, apart from the song's)
        raise Fail(2, f"{file_rel} is the window {cut_of.get('from')}-{cut_of.get('to')} s of {cut_of.get('song')} "
                      f"(beats.py window): its data comes from the song's analysis, in video time. Cut it again "
                      f"instead of analyzing the cut: {window_command(cut_of, w)}; to analyze with other options "
                      f"(--stems, --sections), analyze {cut_of.get('song')} first, then cut the window again")
    words_path, implicit = None, False
    if args.words:
        words_path = find_input(args.words, w, "data", "words file")
    elif w.video_dir is not None and (w.data_dir / "words.json").is_file():
        words_path, implicit = (w.data_dir / "words.json").resolve(), True
    words = None
    for _ in range(2):  # (a window's words.json, from beats.py window: the song's own words are in data/song/)
        if not words_path:
            break
        try:
            words = json.loads(words_path.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError) as e:
            raise Fail(2, f"{words_path}: not a readable words.json ({e})")
        if not isinstance(words, dict):
            raise Fail(2, f"{words_path}: not a words.json (expected {{\"lines\": [...]}})")
        if not (implicit and isinstance(words.get("window"), dict) and (w.data_dir / "song" / "words.json").is_file()):
            break
        words_path = (w.data_dir / "song" / "words.json").resolve()
    manual = None
    out_json = w.data_dir / "audio.json"
    previous = None
    if out_json.is_file():
        try:
            previous = json.loads(out_json.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError):
            previous = None
    kept_manual = False
    sec_pre: list[str] = []
    replaced_window = None
    # the sections set by hand to keep come from the previous analysis of this file: the song's in data/song/ when
    # data/audio.json holds a window of it (beats.py window keeps the song's data there)
    prev_sec, prev_label = previous, "the previous audio.json"
    if isinstance(previous, dict) and isinstance(previous.get("window"), dict) and not for_window:
        rec = previous["window"]
        replaced_window = (f"data/audio.json held the window {rec.get('from')}-{rec.get('to')} s of {rec.get('song')} "
                           f"(beats.py window), which this analysis replaces: the video plays that window, so cut it "
                           f"again from this analysis: {window_command(rec, w)}")
        try:
            song_doc = json.loads((w.data_dir / "song" / "audio.json").read_text(encoding="utf-8-sig"))
        except (OSError, ValueError):
            song_doc = None
        if isinstance(song_doc, dict):
            prev_sec, prev_label = song_doc, "data/song/audio.json (the song's analysis the window was cut from)"
    if args.sections and args.sections.strip().lower() != "auto":
        manual = parse_sections(args.sections)
    elif not args.sections and isinstance(prev_sec, dict) and isinstance(prev_sec.get("analysis"), dict) \
            and prev_sec["analysis"].get("sections") == "manual":
        if prev_sec.get("audioFile") in (None, file_rel):
            manual = [(s["name"], float(s["start"])) for s in prev_sec.get("sections", [])]
            kept_manual = True
        else:
            sec_pre.append(f"{prev_label} had hand-set sections for {prev_sec.get('audioFile')}: not carried over to "
                           f"{file_rel} (--sections sets them)")
    root, in_project = cache_root(w)
    use_cache(root)
    seconds = {}
    note(f"beats.py: decoding {audio.name}")
    t0 = time.time()
    a = load_audio(audio)
    seconds["decode"] = round(time.time() - t0, 2)
    warnings, notes_out = [], []
    if replaced_window:
        warnings.append(replaced_window)
    if chosen and chosen != "video.json":
        notes_out.append(f"analyzing {file_rel}: {chosen}")
    if words is not None:
        kind = (words.get("source") or {}).get("kind")
        other = bool(words.get("audioSha256")) and words["audioSha256"] != a.sha
        if implicit and (kind == "narration" or other):
            notes_out.append(f"data/words.json is {'the narration' if kind == 'narration' else 'timed to another file'}"
                             f": not used for the sections (they come from this audio)")
            words = None
        elif kind == "narration":
            warnings.append(f"{words_path.name} is a narration's words: its repeated lines are read as choruses")
        elif other:
            warnings.append(f"{words_path.name} was timed to another version of this audio (audioSha256 differs): "
                            f"its lines may not mark the choruses here")
    if w.video_dir is not None and not for_window and not replaced_window:  # (window analyzes the song while the
        #                                                                      video plays a part of it)
        rl = relation(w, audio)
        if rl:
            (warnings if rl[0] == "warning" else notes_out).append(rl[1])

    # ---- beats
    t0 = time.time()
    model = {}
    work = work_dir(root, a)
    need_stems = bool(args.stems) and load_stems(work, len(a.mono44)) is None
    if args.tracker == "beat-this":
        cache = work / f"beat_this-{Path(args.checkpoint).stem if args.checkpoint.endswith('.ckpt') else args.checkpoint}.npz"
        info = None
        if cache.is_file():
            z = np.load(cache)
            if int(z["samples"]) == len(a.mono22):
                info = {"checkpoint": args.checkpoint, "reused": str(cache)}
        if info is None or need_stems:  # one model run does whatever is missing
            model = run_models(a, root, args.checkpoint if info is None else None, need_stems)
            info = model.get("beats", info)
        z = np.load(cache)
        bl, dl = z["beat"].astype(np.float64), z["down"].astype(np.float64)
        det, hts = pick_peaks(bl, BT_FPS)
        dpk, _ = pick_peaks(dl, BT_FPS)
        tracker = {"name": "Beat This! (CPJKU, ISMIR 2024)", "checkpoint": args.checkpoint,
                   "license": "MIT (code and published weights)", "run": info}
    else:
        det, hts, yh_lib = track_librosa(a)
        bl = dl = dpk = None
        tracker = {"name": "librosa dynamic-programming tracker on the percussive part (no model)",
                   "license": "ISC (librosa)"}
    seconds["track"] = round(time.time() - t0, 2)
    t0 = time.time()
    B = resolve_beats(det, hts, a, args.tempo_hint)
    seconds["fit"] = round(time.time() - t0, 2)
    dur3 = round(a.duration, 3)  # the duration the file states: beats must stay under it once rounded
    beats = B.beats
    beats = beats[(beats >= 0) & (np.round(beats, 3) < dur3)]
    level = None
    if not args.tempo_hint and B.mode != "nominal" and args.tracker == "beat-this":
        lt = librosa_tempo(a)
        r = lt / B.bpm
        if abs(r - 2) < 0.16 or abs(r - 0.5) < 0.04:
            level = (f"the tracker counts {B.bpm:.1f} BPM; the onset periodicity suggests {lt:.1f} BPM. If the "
                     f"music feels {'twice as fast' if r > 1 else 'half as fast'}, re-run with --tempo-hint {lt:.0f}")
            warnings.append(level)

    # ---- bars
    if args.tracker == "beat-this" and dl is not None:
        tl = beats - B.shift  # the tracker's own timeline
        fr = np.round(tl * BT_FPS).astype(int)
        # evidence = the strongest downbeat logit within +-2 frames (40 ms); none outside the frames
        ev = np.array([dl[max(0, f - 2):f + 3].max() if 0 <= f < len(dl) else 0.0 for f in fr])
        m_inf, sup, tot = meter_from(tl, dpk)
        if m_inf and args.tempo_hint and B.level == "doubled" and m_inf % 2 == 0:
            m_inf //= 2  # the tracker's bars were counted in its half-time beats: two bars each
        jump = JUMP_PENALTY
    else:
        m_inf, sup, tot = None, 0, 0
        ev = None
        jump = 1e9  # no model: one bar phase for the whole piece
    meter = args.meter or m_inf or 4
    meter_src = ("--meter" if args.meter else
                 f"{sup} of {tot} bars between the tracker's downbeats have {m_inf} beats" if m_inf else
                 ("default 4 (the tracker found too few downbeats to count bars; --meter sets it)"
                  if args.tracker == "beat-this" else "default 4 (no downbeat model: --meter sets it)"))
    if ev is None:
        ev = harmonic_evidence(a, beats, meter, yh_lib) if len(beats) >= 2 * meter else np.zeros(len(beats))
    if args.first_downbeat is not None:
        i0 = int(np.argmin(np.abs(beats - args.first_downbeat)))
        pos = (np.arange(len(beats)) - i0) % meter
        bar_src = f"--first-downbeat {args.first_downbeat} (beat at {beats[i0]:.3f} s)"
    else:
        pos = bar_positions(ev, meter, jump)
        bar_src = "Beat This! downbeat activations (Viterbi over the bar position)" if dl is not None else \
            "chord and bass-note changes (one phase for the piece)"
    downs = beats[pos == 0]
    if len(downs) == 0:
        downs = beats[:1]
        pos = (np.arange(len(beats))) % meter
    phase_changes = [float(beats[i]) for i in range(1, len(pos)) if pos[i] != (pos[i - 1] + 1) % meter]
    agree = None
    if dpk is not None and len(dpk):
        dk = dpk + B.shift
        dk = dk[(dk >= beats[0] - 0.05) & (dk <= beats[-1] + 0.05)]
        hit = sum(1 for x in dk if np.min(np.abs(downs - x)) < 0.07)
        agree = (hit, len(dk))

    # ---- sections
    t0 = time.time()
    bar_s = float(np.median(np.diff(downs))) if len(downs) > 1 else meter * 60 / B.bpm
    beat_s = float(np.median(np.diff(beats)))
    secs, sec_how, sec_notes, dropped = make_sections(a, beats, downs, bar_s, beat_s, words, manual, args.snap_sections)
    sec_notes = sec_pre + sec_notes
    if kept_manual:
        sec_how = "manual"
        sec_notes.insert(0, f"kept the hand-set sections of {prev_label}; --sections auto recomputes them")
    seconds["sections"] = round(time.time() - t0, 2)

    # ---- envelopes and onsets
    t0 = time.time()
    n = math.ceil(round(a.duration, 3) * FPS)
    feats, onsets, sources = mix_features(a, n)
    stems_info = None
    if args.stems:
        st = load_stems(work, len(a.mono44))
        if st is None:  # --tracker librosa: the model stage has not run yet
            model = run_models(a, root, None, True)
            st = load_stems(work, len(a.mono44))
            if st is None:
                raise Fail(1, "Demucs ran but its stems are missing from the cache; re-run with --stems")
        stems_info = model.get("stems") or {"model": "htdemucs", "reused": str(work / "htdemucs")}
        f2, o2, s2 = stem_features(a, st, n)
        feats.update(f2)
        onsets.update(o2)
        sources.update(s2)
        v16 = work / "vocals-htdemucs-16k.f32"  # where align.py check looks for a vocal stem
        if not v16.is_file():
            import soxr

            soxr.resample(st["vocals"], SR, 16000).astype(np.float32).tofile(v16)
    seconds["features"] = round(time.time() - t0, 2)

    # ---- document
    beats_r = np.round(beats, 3)
    downs_r = np.round(downs, 3)
    sha = a.sha
    tempo = {"mode": B.mode, "why": B.why}
    if B.mode == "grid":
        tempo.update({"bpm": round(B.bpm, 4), "fit": B.fit, "phaseShiftMs": round(B.shift * 1000, 1)})
    elif B.mode == "detected":
        tempo.update({"bpmAverage": round(B.bpm, 3), "fit": B.fit, "phaseShiftMs": round(B.shift * 1000, 1),
                      "range": list(B.trange), "steady": B.runs, "changes": B.changes, "map": B.tmap})
    notes = [time_note(audio.name, a.delay)]
    if B.mode == "grid":
        notes.append(f"Beats: constant {B.bpm:.3f} BPM, a least-squares grid through the {B.fit['beats']} beats "
                     f"{'Beat This!' if args.tracker == 'beat-this' else 'the librosa tracker'} detected (residual "
                     f"{B.fit['rmsMs']} ms rms, {B.fit['maxMs']} ms at worst; the median of every 16-beat window "
                     f"within {B.fit['windowMs'][0]:+.1f}..{B.fit['windowMs'][1]:+.1f} ms of it), extrapolated over the "
                     f"whole file; the raw detections are in beatsRaw.")
    elif B.mode == "detected":
        notes.append("Beats: the tempo changes, so these are the detected beats (refilled where one was missed, "
                     "extrapolated past both ends at the local tempo); bpm is their average, tempo.map the local "
                     "tempo at each beat. The raw detections are in beatsRaw.")
    else:
        notes.append("Beats: no pulse found; a nominal grid stands in.")
    if B.shift:
        notes.append(f"Phase: moved {B.shift * 1000:+.1f} ms onto the attacks measured near "
                     f"{B.shift_info['beatsWithAttack']} beats (beatsRaw is the tracker's output before this shift).")
    notes.append(f"Bars: {meter} beats; bar phase from {bar_src}; beatInBar numbers each beat (1 = downbeat).")
    notes.append(f"Sections: {sec_how}; {section_starts(secs, downs_r)}; names are generic unless they come from the "
                 f"lyrics or from --sections.")
    notes.append("Envelopes: 100 fps, frame i centred at i/100 s, 46 ms RMS, one-pole smoothing (10 ms attack, "
                 "90 ms release), each divided by its 99th percentile and clipped to 0..1. Sources in analysis.sources.")
    doc = {
        "duration": round(a.duration, 3),
        "bpm": round(B.bpm, 3),
        "beat_period": round(60 / B.bpm, 5),
        "time_signature": int(meter),
        "fps": FPS,
        "beats": beats_r.tolist(),
        "downbeats": downs_r.tolist(),
        "beatInBar": (pos + 1).astype(int).tolist(),
        "sections": secs,
        "tempo": tempo,
        "features": feats,
        "onsets": onsets,
        "beatsRaw": np.round(B.raw, 3).tolist(),
        "analysis": {"tool": "audara-studio soundtrack/scripts/beats.py",
                     # what made it, not where or how fast: a committed file must not change with the machine
                     "tracker": {k: v for k, v in tracker.items() if k != "run"},
                     "stems": bool(args.stems), "sources": sources, "sections": "manual" if manual else sec_how,
                     "meter": meter_src, "downbeats": bar_src,
                     "phaseChanges": [round(x, 3) for x in phase_changes]},
        "audioFile": file_rel,
        "audioSha256": sha,
        "notes": " ".join(notes),
    }
    errs, warns, nchk = validate(doc, a.duration, sha)
    if errs:
        raise Fail(1, "the analysis failed its own checks (nothing written): " + "; ".join(errs))
    w.data_dir.mkdir(parents=True, exist_ok=True)
    out_json.write_text(dump_doc(doc), encoding="utf-8", newline="\n")
    back = json.loads(out_json.read_text(encoding="utf-8"))  # report from what was written
    errs2, warns2, nchk2 = validate(back, a.duration, sha)
    if errs2:
        raise Fail(1, f"{out_json} failed validation after writing: " + "; ".join(errs2))

    # ---- review files
    review = {}
    if not args.no_plot:
        t0 = time.time()
        png = w.review_dir / "beats.png"
        shown = plot_review(png, a, back, B, f"{audio.name}: {len(back['beats'])} beats, {len(back['downbeats'])} "
                                              f"downbeats, {back['bpm']:.3f} BPM ({B.mode})", phase_changes)
        review["png"] = {"path": str(png), "bytes": png.stat().st_size, "passages": shown}
        seconds["plot"] = round(time.time() - t0, 2)
    if args.clicks:
        m4a = w.review_dir / "clicks.m4a"
        write_clicks(m4a, a, back["beats"], back["downbeats"])
        review["clicks"] = {"path": str(m4a), "bytes": m4a.stat().st_size, "seconds": probe_duration(m4a)}

    # ---- result, measured on the written file
    bt = np.asarray(back["beats"])
    period = float(bt[-1] - bt[-2])  # the beat at the end of the file: tempo may move elsewhere
    P_fit = float(np.polyfit(np.arange(len(bt), dtype=float), bt, 1)[0])
    cache_info = {"root": str(root), "inProject": in_project, "uv": uv_cache()}
    if in_project:
        cache_info["bytes"] = folder_bytes(root)
    mdl = None
    if args.tracker == "beat-this":
        run = tracker.get("run") or {}
        mdl = {"checkpoint": args.checkpoint, "file": run.get("file"), "bytes": run.get("bytes"),
               "downloaded": run.get("downloaded", False), "reusedLogits": run.get("reused"),
               "seconds": run.get("seconds")}
    result = {
        "ok": True, "command": "analyze", "audio": str(audio), "output": str(out_json),
        "outputBytes": out_json.stat().st_size, "duration": back["duration"], "mode": B.mode,
        "bpm": back["bpm"], "bpmFromBeatsSlope": round(60 / P_fit, 3), "why": B.why, "fit": B.fit,
        "phase": {"shiftMs": round(B.shift * 1000, 1), **B.shift_info},
        "beats": len(bt), "detected": len(B.raw), "refilled": B.filled, "doublesDropped": B.dropped,
        "tempoHint": {"bpm": args.tempo_hint, "level": B.level or "kept"} if args.tempo_hint else None,
        "extrapolated": {"start": B.extrap[0], "end": B.extrap[1]},
        "firstBeat": float(bt[0]), "lastBeat": float(bt[-1]),
        "endGap": round(back["duration"] - float(bt[-1]), 3), "beatPeriod": round(period, 4),
        "coveredToEnd": back["duration"] - float(bt[-1]) <= period * 1.001,
        "downbeats": len(back["downbeats"]), "meter": meter, "meterFrom": meter_src, "barsFrom": bar_src,
        "phaseChanges": [round(x, 3) for x in phase_changes],
        "trackerDownbeatsAgree": list(agree) if agree else None,
        "tempoChanges": B.changes if B.mode == "detected" else [],
        "tempoRange": list(B.trange) if B.trange else None,
        "steady": B.runs if B.mode == "detected" else [],
        "sections": [{"name": s["name"], "start": s["start"]} for s in back["sections"]],
        "sectionsFrom": sec_how, "sectionStarts": section_starts(back["sections"], back["downbeats"]),
        "sectionNotes": sec_notes, "sectionCandidatesDropped": dropped,
        "features": {k: sources.get(k, "") for k in back["features"]},
        "onsets": {k: len(v) for k, v in back["onsets"].items()},
        "checks": {"passed": nchk2 - len(warns2), "of": nchk2, "warnings": warns2},
        "warnings": warnings, "notes": notes_out, "review": review, "cache": cache_info, "model": mdl,
        "stems": stems_info, "seconds": {**seconds, "total": round(time.time() - t_start, 1)},
        "timeOrigin": time_note(audio.name, a.delay), "encoderDelayMs": round(a.delay * 1000, 1),
    }
    return result


def kb(n: int) -> str:
    return f"{n / 1e6:.1f} MB" if n >= 1e6 else f"{n / 1e3:.0f} KB"


def print_analyze(r: dict) -> None:
    say(f"beats.py: {Path(r['audio']).name} -> {r['output']} ({kb(r['outputBytes'])})")
    if r["mode"] == "grid":
        say(f"  tempo      {r['bpm']:.3f} BPM, steady: fitted grid over the whole file")
    elif r["mode"] == "detected":
        say(f"  tempo      {r['bpm']:.2f} BPM on average: detected beats + tempo map"
            + (" (the tempo changes)" if r["why"].startswith("not steady") else " (too short to test)"))
    else:
        say(f"  tempo      nominal {r['bpm']:.0f} BPM grid (no pulse found)")
    say(f"             why: {r['why']}")
    if r["fit"]:
        f = r["fit"]
        say(f"             one-grid fit: residual {f['rmsMs']} ms rms, {f['maxMs']} ms at worst, over {f['beats']} "
            f"beats; the median of each 16-beat window within {f['windowMs'][0]:+.1f}..{f['windowMs'][1]:+.1f} ms of "
            f"the grid")
    if r["mode"] == "detected":
        lo, hi = r["tempoRange"]
        say(f"             local tempo (9-beat fits, 5th-95th percentile) {lo:.1f}..{hi:.1f} BPM"
            + ("" if r["tempoChanges"] else f"; no steady stretches {TEMPO_CHANGE_MIN:.0%} apart: the tempo drifts"))
        st = [x for x in r["steady"] if x["end"] - x["start"] >= 8 * 60 / x["bpm"]]
        if r["tempoChanges"] and st:
            say("             steady: " + "; ".join(f"{x['bpm']:.1f} BPM {clock(x['start'])}-{clock(x['end'])}" for x in st[:6]))
    for c in r["tempoChanges"]:
        verb = "speeds up" if c["bpmTo"] > c["bpmFrom"] else "slows down"
        say(f"             {verb} from {c['bpmFrom']:.1f} to {c['bpmTo']:.1f} BPM between {clock(c['from'])} and "
            f"{clock(c['to'])}")
    ph = r["phase"]
    if ph.get("applied") and abs(ph["shiftMs"]) >= 1:
        say(f"  phase      moved {ph['shiftMs']:+.1f} ms onto measured attacks near {ph['beatsWithAttack']} beats "
            f"(kick, snare and hat bands)")
    elif ph.get("applied"):
        say(f"  phase      already on the measured attacks (median {ph['medianMs']:+.1f} ms over "
            f"{ph['beatsWithAttack']} beats with an attack)")
    elif "beatsWithAttack" in ph:
        say(f"  phase      kept as tracked: attacks near only {ph['beatsWithAttack']} beats (median "
            f"{ph.get('medianMs', 0):+.1f} ms), too few or too far to move it")
    ex = r["extrapolated"]
    say(f"  beats      {r['beats']}: first {r['firstBeat']:.3f} s, last {r['lastBeat']:.3f} s; the file ends "
        f"{r['endGap']:.3f} s after the last beat ({'covered to the end' if r['coveredToEnd'] else 'NOT covered'}; "
        f"the last beat lasts {r['beatPeriod']:.3f} s)")
    say(f"             {r['detected']} detected, {r['refilled']} refilled, {r['doublesDropped']} doubles dropped; "
        f"{ex['start']} before and {ex['end']} after the detections"
        + (f"; {r['tempoHint']['level']} by --tempo-hint {r['tempoHint']['bpm']:g}" if r["tempoHint"] else ""))
    if r["mode"] != "nominal":
        say(f"             bpm {r['bpm']:.3f} vs the delivered beats' least-squares slope {r['bpmFromBeatsSlope']:.3f}"
            if r["mode"] == "grid" else f"             bpm {r['bpm']:.3f} = the delivered beats' average: 60 x "
            f"{r['beats'] - 1} intervals / ({r['lastBeat']:.3f} - {r['firstBeat']:.3f}) s")
    ag = r["trackerDownbeatsAgree"]
    say(f"  bars       {r['downbeats']} downbeats, {r['meter']} beats per bar ({r['meterFrom']})")
    if ag:
        say(f"             the tracker's own downbeats fall on these downbeats: {ag[0]} of {ag[1]}")
    if r["phaseChanges"]:
        say(f"             bar phase changes (a short or long bar) at: {', '.join(clock(x) for x in r['phaseChanges'][:8])}")
    secs = ", ".join(f"{s['name']} {clock(s['start'])}" for s in r["sections"])
    say(f"  sections   {secs} ({r['sectionsFrom']}; {r['sectionStarts']})")
    for n_ in r["sectionNotes"]:
        say(f"             {n_}")
    if r.get("sectionCandidatesDropped"):
        say("             other boundaries the audio suggests (merged away; --sections keeps any of them): "
            + ", ".join(f"{t:.3f} s" for t in r["sectionCandidatesDropped"][:8]))
    feats = r["features"]
    approx = [k for k, v in feats.items() if v.startswith("approximation")]
    exact = [k for k in feats if k not in approx]
    say(f"  envelopes  {' '.join(exact)}" + (f"; {' '.join(approx)} approximated from the mix" if approx else ""))
    missing = [k for k in ("vocal", "drums", "bass", "other", "pitchMidi") if k not in feats]
    if missing:
        say(f"             {' '.join(missing)}: need --stems")
    on = ", ".join(f"{k} {v}" for k, v in r["onsets"].items())
    say(f"  onsets     {on}" + ("" if "snare" in r["onsets"] else "; snare, hat and vocal need --stems"))
    ck = r["checks"]
    say(f"  checks     {ck['passed']} of {ck['of']} engine checks pass" + (f"; warnings: {'; '.join(ck['warnings'])}"
                                                                         if ck["warnings"] else ""))
    rv = r["review"]
    if "png" in rv:
        say(f"  review     {rv['png']['path']} ({kb(rv['png']['bytes'])}); its passages, counting an attack (a fast "
            f"rise in the mix's kick, snare or hat band) within {ON_BEAT * 1000:.0f} ms of a beat:")
        for x in rv["png"]["passages"]:
            say(f"               {x}")
    if "clicks" in rv:
        c = rv["clicks"]
        say(f"  {'review     ' if 'png' not in rv else '           '}{c['path']} ({kb(c['bytes'])}, "
            f"{c['seconds'] or 0:.1f} s): the song with a click on every beat, higher on downbeats")
    m = r["model"]
    if m:
        if m.get("reusedLogits"):
            say(f"  model      Beat This! {m['checkpoint']} (MIT code and weights): reused its cached output")
        else:
            say(f"  model      Beat This! {m['checkpoint']} (MIT code and weights), {kb(m['bytes'] or 0)} at {m['file']} "
                f"({'downloaded now' if m['downloaded'] else 'already cached'}); {m['seconds']} s on CPU")
    if r["stems"]:
        s = r["stems"]
        if s.get("reused"):
            say(f"  stems      Demucs htdemucs stems reused from {s['reused']}")
        else:
            say(f"  stems      Demucs htdemucs (MIT code; weights carry no separate license), {kb(s.get('bytes', 0))} "
                f"at {s.get('weights')} ({'downloaded now' if s.get('downloaded') else 'already cached'}); "
                f"{s.get('seconds')} s on CPU")
    c = r["cache"]
    with_uv = bool(c.get("uv")) and Path(c["uv"]["path"]).is_relative_to(Path(c["root"]).resolve())
    inside = ", uv's cache below included" if with_uv else ""  # (UV_CACHE_DIR=.audara-cache/uv, for a sandbox)
    say(f"  cache      {c['root']}" + (f" (inside the project, git-ignored, {kb(c['bytes'])} on disk{inside})"
                                       if c["inProject"] else ""))
    if c.get("uv"):
        say(f"             {c['uv']['note']}")
    for x in r.get("notes", []):
        say(f"  note       {x}")
    for x in r["warnings"]:
        say(f"  WARNING    {x}")
    say(f"  time       {r['timeOrigin'][len('Time: '):]}")
    say(f"  took       {r['seconds']['total']} s")


# ---------------------------------------------------------------------------------------------
# grid


def grid_vs_audio(a: Audio, beats: np.ndarray, bpm: float, cues: list[dict]) -> dict:
    """The declared grid against the audio itself: its own tempo (onset periodicity, folded to the declared
    octave) and where the attacks near each declared beat sit (median offset, as analyze measures the phase).
    A wrong --bpm or a shifted --offset shows; a grid shifted by exactly half a beat over music with off-beat
    attacks does not. Reports, not gates: a cue may sit on a swell rather than an attack."""
    out: dict = {"warnings": []}
    est = librosa_tempo(a)
    r = est / bpm
    while r >= 1.5:
        r /= 2
    while r < 0.75:
        r *= 2
    out["tempoRead"] = round(est, 1)
    att = np.sort(np.concatenate([attacks(a.mono44, SR, None, 150), attacks(a.mono44, SR, 1500, 5000),
                                  attacks(a.mono44, SR, 7000, None)]))
    att = att[att < a.duration]
    s, hit, _ = phase_shift(beats, att)
    out.update({"attacks": int(len(att)), "beatsWithAttack": int(hit), "beats": int(len(beats)),
                "medianMs": round(s * 1000, 1) if hit else None})
    out["summary"] = (f"attacks within {ATTACK_TOL * 1000:.0f} ms of {hit} of {len(beats)} declared beats"
                      + (f", median {s * 1000:+.1f} ms" if hit else "") + f"; the audio's own tempo reads about "
                      f"{est:.1f} BPM")
    if abs(r - 1) > GRID_TEMPO_TOL:
        out["warnings"].append(f"the audio's tempo reads about {bpm * r:.1f} BPM, not the declared {bpm:g} (onset "
                               f"periodicity): check --bpm (beats.py analyze measures it)")
    if len(att) >= GRID_CHECK_MIN and hit >= GRID_CHECK_MIN and abs(s) > GRID_CHECK_MS:
        out["warnings"].append(f"the attacks near the declared beats sit {s * 1000:+.0f} ms from them on median: check "
                               f"--offset (beats.py analyze measures the phase)")
    elif len(att) >= GRID_CHECK_MIN and hit < 0.25 * len(beats):
        out["warnings"].append(f"only {hit} of {len(beats)} declared beats have an attack within "
                               f"{ATTACK_TOL * 1000:.0f} ms: check --bpm and --offset")
    for c in cues:
        near = att[np.abs(att - c["t"]) <= 0.5] if len(att) else att
        if len(near):
            x = float(near[np.argmin(np.abs(near - c["t"]))])
            if abs(x - c["t"]) > GRID_CHECK_MS:
                out["warnings"].append(f"cue {c['name']} at {c['t']:.3f} s: the nearest attack is at {x:.3f} s "
                                       f"({(x - c['t']) * 1000:+.0f} ms)")
    return out


def run_grid(args) -> dict:
    w = where(args.video, args.out, [args.audio] if args.audio else [])
    a = None
    if args.audio:
        audio = find_input(args.audio, w, "audio", "audio file")
        root, _ = cache_root(w)
        use_cache(root)
        a = load_audio(audio)
    dur = args.duration if args.duration is not None else (a.duration if a else None)
    if dur is None or dur <= 0:
        raise Fail(2, "grid needs --duration SECONDS (or --audio FILE to measure it)")
    if a and args.duration is not None and abs(args.duration - a.duration) > 0.05:
        note(f"beats.py grid: --duration {args.duration} differs from the audio's {a.duration:.3f} s; using --duration")
    if args.bpm <= 0 or args.meter < 1:
        raise Fail(2, "--bpm must be > 0 and --meter >= 1")
    P = 60.0 / args.bpm
    off = args.offset
    if not 0 <= off < dur:
        raise Fail(2, f"--offset {off} must lie in [0, duration {dur})")
    k0 = -math.floor(off / P + 1e-9)
    idx = np.arange(k0, math.floor((dur - 1e-9 - off) / P) + 1)
    beats = off + P * idx
    keep = (beats >= -1e-9) & (np.round(beats, 3) < round(dur, 3))
    beats, idx = np.maximum(beats[keep], 0.0), idx[keep]
    pos = idx % args.meter
    downs = beats[pos == 0]
    secs = [{"name": "all", "start": 0.0, "end": round(dur, 3)}]
    sec_notes = []
    if args.sections:
        sp = parse_sections(args.sections)
        for name, t in sp:
            if not 0 <= t < dur:
                raise Fail(2, f"--sections: {name} at {t} s is outside [0, {dur})")
            near = beats[np.argmin(np.abs(beats - t))]
            if abs(near - t) > 0.0015:
                sec_notes.append(f"{name} at {t} s is not on a beat (nearest {near:.3f} s); kept as declared")
        secs = [{"name": n_, "start": round(t, 3), "end": round(sp[i + 1][1] if i + 1 < len(sp) else dur, 3)}
                for i, (n_, t) in enumerate(sp)]
    cues = []
    for c in args.cue or []:
        if "=" not in c:
            raise Fail(2, f"--cue '{c}' is not name=seconds (e.g. --cue hit=20)")
        name, t = c.split("=", 1)
        try:
            tt = float(t)
        except ValueError:
            raise Fail(2, f"--cue '{c}': '{t}' is not a time in seconds")
        if not 0 <= tt <= dur or not name.strip():
            raise Fail(2, f"--cue '{c}' needs a name and a time inside [0, {dur}]")
        cues.append({"name": name.strip(), "t": round(tt, 3)})
    cues.sort(key=lambda c: c["t"])
    feats, src = {}, {}
    if a:
        n = math.ceil(round(dur, 3) * FPS)
        from scipy.signal import sosfiltfilt

        x = a.mono44.astype(np.float64)
        need = int(math.ceil(dur * SR)) + ENV_WIN
        if len(x) < need:
            x = np.pad(x, (0, need - len(x)))
        feats["rms"] = env01(frame_rms(x, SR, n, ENV_WIN))
        for name, (lo, hi) in {"low": (None, LOW_HZ), "mid": (LOW_HZ, MID_HZ), "high": (HIGH_HZ, None)}.items():
            feats[name] = env01(frame_rms(sosfiltfilt(band_sos(lo, hi, SR), x), SR, n, ENV_WIN))
        src = {"rms": "mix", "low": "mix < 150 Hz", "mid": "mix 150-2000 Hz", "high": "mix > 4 kHz"}
    match_info = grid_vs_audio(a, beats, args.bpm, cues) if a else None
    doc = {
        "duration": round(dur, 3), "bpm": round(args.bpm, 4), "beat_period": round(P, 5),
        "time_signature": int(args.meter), "fps": FPS,
        "beats": np.round(beats, 3).tolist(), "downbeats": np.round(downs, 3).tolist(),
        "beatInBar": (pos + 1).astype(int).tolist(), "sections": secs,
        **({"cues": cues} if cues else {}),
        "tempo": {"mode": "declared", "why": "declared (beats.py grid): structure known by construction, not measured"},
        "features": feats, "onsets": {},
        "analysis": {"tool": "audara-studio soundtrack/scripts/beats.py grid", "sources": src,
                     "sections": "declared" if args.sections else "single"},
        # (named as analyze names it, from the video's folder, so that check finds it)
        **({"audioFile": data_name(a.path, w) if w.video_dir else a.path.name, "audioSha256": a.sha} if a else {}),
        "notes": (f"Declared grid: {args.bpm} BPM, {args.meter} beats per bar, first downbeat at {off} s; beats "
                  f"extrapolated over [0, {dur}). " + (time_note(a.path.name, a.delay) + " Envelopes measured on "
                  "that decode (100 fps, 46 ms RMS, smoothed, divided by their 99th percentile). " if a else
                  "No audio was read: envelopes and onsets are empty (the engine reads them as 0). ")
                 + "Cues are named hit points in seconds."),
    }
    errs, warns, nchk = validate(doc, a.duration if a else None, a.sha if a else None)
    if errs:
        raise Fail(1, "the grid failed its own checks (nothing written): " + "; ".join(errs))
    w.data_dir.mkdir(parents=True, exist_ok=True)
    out = w.data_dir / "audio.json"
    out.write_text(dump_doc(doc), encoding="utf-8", newline="\n")
    back = json.loads(out.read_text(encoding="utf-8"))
    errs2, warns2, nchk2 = validate(back, a.duration if a else None, a.sha if a else None)
    if errs2:
        raise Fail(1, f"{out} failed validation after writing: " + "; ".join(errs2))
    return {"ok": True, "command": "grid", "output": str(out), "outputBytes": out.stat().st_size,
            "duration": back["duration"], "bpm": back["bpm"], "meter": back["time_signature"],
            "beats": len(back["beats"]), "downbeats": len(back["downbeats"]),
            "firstBeat": back["beats"][0], "lastBeat": back["beats"][-1],
            "sections": [{"name": s["name"], "start": s["start"]} for s in back["sections"]],
            "sectionNotes": sec_notes, "cues": back.get("cues", []), "features": list(back["features"]),
            "audioMatch": match_info,
            "checks": {"passed": nchk2 - len(warns2), "of": nchk2, "warnings": warns2}}


def print_grid(r: dict) -> None:
    say(f"beats.py grid -> {r['output']} ({kb(r['outputBytes'])})")
    say(f"  grid       {r['bpm']:g} BPM, {r['meter']} beats per bar: {r['beats']} beats ({r['firstBeat']:.3f}.."
        f"{r['lastBeat']:.3f} s), {r['downbeats']} downbeats, over {r['duration']} s")
    say(f"  sections   {', '.join(f'{s['name']} {clock(s['start'])}' for s in r['sections'])}")
    for n_ in r["sectionNotes"]:
        say(f"             {n_}")
    if r["cues"]:
        say(f"  cues       {', '.join(f'{c['name']} {c['t']} s' for c in r['cues'])}")
    say(f"  envelopes  {' '.join(r['features']) if r['features'] else 'none (no --audio): the engine reads 0'}")
    m = r.get("audioMatch")
    if m:
        say(f"  vs audio   {m['summary']}")
        for x in m["warnings"]:
            say(f"  WARNING    {x}")
    ck = r["checks"]
    say(f"  checks     {ck['passed']} of {ck['of']} engine checks pass" + (f"; warnings: {'; '.join(ck['warnings'])}"
                                                                         if ck["warnings"] else ""))


# ---------------------------------------------------------------------------------------------
# check


def run_check(args) -> dict:
    fpath = Path(args.file) if args.file else None
    w = where(args.video, None, [fpath] if fpath else [], writes=False)
    path = fpath if fpath else (w.data_dir / "audio.json" if w.video_dir is not None else None)
    if path is None:
        raise Fail(2, "check needs an audio.json path (or --video <video>)")
    if not path.is_file():
        raise Fail(2, f"{path}: no such file")
    try:
        doc = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as e:
        raise Fail(1, f"{path}: not readable JSON ({e})")
    if not isinstance(doc, dict):
        raise Fail(1, f"{path}: not an audio.json (the top level must be an object)")
    # against the file the analysis was made from (its audioFile), else the one the video plays
    audio, how, notes = None, None, []
    if args.audio:
        audio, how = find_input(args.audio, w, "audio", "audio file"), "--audio"
    elif w.video_dir is not None:
        own = doc.get("audioFile")
        if isinstance(own, str) and own and (w.video_dir / own).is_file():
            audio, how = (w.video_dir / own).resolve(), "its audioFile"
        else:
            audio, why = video_audio(w)
            how = why if audio is not None else None
            if audio is None:
                notes.append(f"not compared with any audio: {why}")
    decoded, sha = None, None
    if audio:
        y, sr0 = decode(audio)
        decoded, sha = len(y) / sr0, sha256(audio)
    try:
        errs, warns, n = validate(doc, decoded, sha)
    except (ValueError, TypeError, KeyError, IndexError) as e:  # malformed beyond the checks
        errs, warns, n = [f"malformed: {type(e).__name__}: {e}"], [], 1
    win = doc.get("window") if isinstance(doc.get("window"), dict) else None
    if win and audio is not None and w.video_dir is not None and not any(s["file"] == audio for s in plays(w)) \
            and mix_of(w, audio) is None:  # a window the video does not play yet (on its own, or as a mix's music)
        n += 1
        own = rel(audio, w.video_dir)
        errs.append(f"this is the window {win.get('from')}-{win.get('to')} s of {win.get('song')} (beats.py window), "
                    f"but video.json does not play {own}: set \"audio\": \"{own}\" in video.json, with no \"duration\"")
    elif audio is not None and w.video_dir is not None:
        rl = relation(w, audio)
        if rl:
            (warns if rl[0] == "warning" else notes).append(rl[1])
        # the engine takes the video's length from audio.json when video.json sets none and plays one file;
        # render.ts then refuses a file of another length
        segs = plays(w)
        dur = doc.get("duration")
        if not video_json(w).get("duration") and len(segs) == 1 and isinstance(dur, (int, float)) \
                and segs[0]["file"].is_file():
            n += 1
            plen = probe_duration(segs[0]["file"]) if segs[0]["file"] != audio else decoded
            if plen is not None and abs(plen - dur) > 0.1:
                errs.append(f"the video takes its length from this file ({dur:.3f} s: video.json sets no duration) but "
                            f"plays {rel(segs[0]['file'], w.project)}, which lasts {plen:.3f} s: set \"duration\": "
                            f"{plen:.3f} in video.json")
    return {"ok": not errs, "command": "check", "file": str(path), "audio": str(audio) if audio else None,
            "comparedWith": how, "checks": n, "errors": errs, "warnings": warns, "notes": notes,
            "summary": {"duration": doc.get("duration"), "bpm": doc.get("bpm"), "beats": len(doc.get("beats") or []),
                        "downbeats": len(doc.get("downbeats") or []), "sections": len(doc.get("sections") or []),
                        "features": [k for k, v in (doc.get("features") or {}).items() if v] + [
                            k for k in ("rms", "low", "mid", "high", "vocal", "drums", "bass", "other", "pitchMidi")
                            if isinstance(doc.get(k), list) and doc[k] and not (doc.get("features") or {}).get(k)],
                        "onsets": {k: len(v) for k, v in (doc.get("onsets") or {}).items()},
                        "cues": len(doc.get("cues") or []), "mode": (doc.get("tempo") or {}).get("mode")}}


def print_check(r: dict) -> None:
    s = r["summary"]
    say(f"beats.py check: {r['file']}" + (f" against {Path(r['audio']).name} ({r['comparedWith']})" if r["audio"] else ""))
    say(f"  {s['duration']} s, {s['bpm']} BPM ({s['mode'] or 'mode not recorded'}), {s['beats']} beats, "
        f"{s['downbeats']} downbeats, {s['sections']} sections" + (f", {s['cues']} cues" if s.get("cues") else "")
        + f"; envelopes: {' '.join(s['features']) or 'none'}; "
        f"onsets: {', '.join(f'{k} {v}' for k, v in s['onsets'].items()) or 'none'}")
    if r["ok"]:
        say(f"  ok: {r['checks']} checks" + (f", {len(r['warnings'])} warnings" if r["warnings"] else ""))
    for e in r["errors"]:
        say(f"  ERROR    {e}")
    for x in r["warnings"]:
        say(f"  warning  {x}")
    for x in r.get("notes", []):
        say(f"  note     {x}")


# ---------------------------------------------------------------------------------------------
# window: a part of the song as the video's own audio and data


ON_DOWNBEAT = 0.0015  # a time within 1.5 ms of a downbeat is that downbeat: the data keeps times to the
#                       millisecond, so a time typed from it and the downbeat differ by both roundings at most
WORD_EDGE = 0.050  # under 50 ms of a word beyond a cut is within the word timings' own error (forced alignment
#                    places word edges to about 30-50 ms): it is not reported as cut, and not kept in the window
SAME_LENGTH = 0.05  # a data file that names no audio describes the song when its duration is the song's within
#                     50 ms, the tolerance validate() uses between a file's duration and its decoded audio
NEAR_BARS = 4  # a start or end suggested instead of one inside a word moves the window by 4 bars (a phrase) at most,
NEAR_FRAC = 0.25  # and by a quarter of its length at most: further is another window, not a fix of this one (on
#                   pdoom, sung through with align.py's words, the nearest end with nothing sung across it was 51 bars
#                   away: a 92.7 s window offered for a 30 s video)
CUT_MATCH = 1e-4  # the cut must equal the song's samples to 1e-4 (-80 dBFS): 24-bit rounding leaves 1.2e-7, and a
#                   cut one sample off differs by far more on any music
HALF_BAR_TIE = 0.010  # an end within 10 ms of the middle of its bar is a tie between the bar's downbeats: a length
#                       asked in seconds from a downbeat lands there (30 s at 132 BPM is 16.5 bars), give or take the
#                       data's millisecond rounding and times typed to the hundredth
VOICE_ON = 0.2  # without lyrics, the vocal stem (features.vocal: 0..1 of its 99th percentile) over 0.2 on both sides
#                 of an end is a voice sounding across it. On pdoom's beats, against its lyrics: 7 of the 315 with a
#                 word or a line sung across them read quiet, and 11 of the 28 with nothing sung across (most of the
#                 others are lines sung straight on); at 0.25, 17 sung ones read quiet (a quiet one is offered as a cut)
VOICE_S = 0.060  # ...as the mean over 60 ms on each side (the envelope releases over 90 ms: a voice that stopped
#                  before the cut has mostly faded within it)
HELD_SEMITONES = 0.5  # pitchMidi within half a semitone of its median over those 120 ms is a pitch held across the
#                       end (a sung note; YIN's octave slips and the gaps between words break it)
DRUMS_OFF = 0.05  # a bar whose drum stem stays under 0.05 of its loud level (the 90th percentile of the bar's frames,
#                   so one stray hit does not count) has no drums: on pdoom such bars read 0.001-0.009, the sparest
#                   drummed bar 0.075
ENVELOPES = ("rms", "low", "mid", "high", "vocal", "drums", "bass", "other", "pitchMidi")  # the engine's names
#                                                                                           (audio.ts), top-level or in features
LOUDNESS = ENVELOPES[:-1]  # the envelopes that measure level, which a fade scales (pitchMidi is a pitch)
WINDOW_TOOL = "audara-studio soundtrack/scripts/beats.py window"


def isnum(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def read_doc(path: Path) -> dict | None:
    """The JSON object in `path`, None when there is no file; a file that is not one stops the window (so
    nothing is replaced on a guess)."""
    if not path.is_file():
        return None
    try:
        d = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as e:
        raise Fail(1, f"{path}: not readable JSON ({e}): fix it or move it away, then run window again")
    if not isinstance(d, dict):
        raise Fail(1, f"{path}: not a JSON object: fix it or move it away, then run window again")
    return d


def describes(doc: dict, song_rel: str, sha: str, dur: float, words: bool) -> tuple[str, str]:
    """How a data file stands to the song: ("window" | "song" | "other" | "unknown", why). "unknown" is a
    words.json that names no audio: it belongs with the audio.json beside it."""
    rec = doc.get("window")
    if isinstance(rec, dict):
        return "window", f"the window {rec.get('from')}-{rec.get('to')} s of {rec.get('song')}"
    src = doc.get("source") if isinstance(doc.get("source"), dict) else {}
    if src.get("kind") == "narration":
        return "other", "a narration's words"
    if isinstance(doc.get("audioSha256"), str) and doc["audioSha256"]:
        return (("song", "its audioSha256 is the song's") if doc["audioSha256"] == sha else
                ("other", "made from another audio file, or another version of this one (its audioSha256 differs)"))
    named = next((x for x in (doc.get("audioFile"), src.get("audio"), doc.get("audio")) if isinstance(x, str) and x),
                 None)
    if named:
        same = named == song_rel if "/" in named else named == Path(song_rel).name
        return ("song", f"it names {named}") if same else ("other", f"made from {named}")
    if words:
        return "unknown", "it names no audio file"
    d = doc.get("duration")
    if isnum(d) and abs(d - dur) <= SAME_LENGTH:
        return "song", f"it names no audio file, and its duration ({d:g} s) is the song's"
    return "other", f"it names no audio file, and its duration ({d} s) is not the song's ({dur:.3f} s)"


def last_word_end(doc: dict) -> float:
    ends = [x["end"] for line in doc.get("lines") or [] if isinstance(line, dict)
            for x in line.get("words") or [] if isinstance(x, dict) and isnum(x.get("end"))]
    return max(ends, default=0.0)


def window_song(args, w: Where, cur_a: dict | None, sav_a: dict | None, cur_w: dict | None = None,
                sav_w: dict | None = None) -> tuple[Path, str]:
    """The song to cut: SONG, else the one the video's data names (the song's analysis, or a window's record, the
    words' too: they keep it when a new analysis has replaced the window's audio.json), else what video.json plays."""
    if args.song:
        return find_input(args.song, w, "audio", "song"), "given"
    base = w.video_dir or w.base
    for doc, label in ((sav_a, "data/song/audio.json"), (cur_a, "data/audio.json"), (cur_w, "data/words.json"),
                       (sav_w, "data/song/words.json")):
        if not doc:
            continue
        rec = doc.get("window") if isinstance(doc.get("window"), dict) else None
        f = rec.get("song") if rec else doc.get("audioFile") if label.endswith("audio.json") else None
        if isinstance(f, str) and f and (base / f).is_file() and not Path(f).stem.endswith("-window"):
            return (base / f).resolve(), f"named by {label}"
    audio, how = video_audio(w)
    if audio is not None and not audio.stem.endswith("-window"):
        return audio, how
    raise Fail(2, "give the song to cut a window of: beats.py window SONG --video <video> --from S --to S")


def nearest(xs: np.ndarray, t: float) -> int:
    return int(np.argmin(np.abs(xs - t)))


def bar_at(t: float, downs: np.ndarray) -> float:
    """Continuous bar index, 0 at the first downbeat (the engine's barAt)."""
    d = downs
    if len(d) < 2:
        return 0.0
    if t <= d[0]:
        return (t - d[0]) / (d[1] - d[0])
    if t >= d[-1]:
        return len(d) - 1 + (t - d[-1]) / (d[-1] - d[-2])
    i = int(np.searchsorted(d, t, side="right")) - 1
    return i + (t - d[i]) / (d[i + 1] - d[i])


def line_words(line: dict) -> list[dict]:
    return [x for x in line.get("words") or [] if isinstance(x, dict) and isnum(x.get("start")) and isnum(x.get("end"))]


def line_text(line: dict) -> str:
    return str(line.get("text") or " ".join(str(x.get("w", "")) for x in line_words(line)))


def sung_at(t: float, lines: list[dict], extras: list[dict], beat: float, runs_on=None) -> dict | None:
    """What is sung across time t (song time): a word (a held note when it lasts over two beats), a rest between
    two words of a line, or an extra (a backing vocal); None between lines. Within WORD_EDGE of an edge is
    outside (the timings' own error). `runs_on(word)`: its end is only where the next word starts (forced
    alignment that heard no rest), so its length says nothing of a held note."""
    for line in lines:
        ws = line_words(line)
        if not ws or not ws[0]["start"] + WORD_EDGE < t < ws[-1]["end"] - WORD_EDGE:
            continue
        info = {"line": line_text(line), "lineStart": ws[0]["start"], "lineEnd": ws[-1]["end"]}
        for x in ws:
            if x["start"] + WORD_EDGE < t < x["end"] - WORD_EDGE:
                on = bool(runs_on and runs_on(x))
                return {**info, "kind": "held note" if x["end"] - x["start"] > 2 * beat and not on else "word",
                        "w": x["w"], "start": x["start"], "end": x["end"], **({"runsOn": True} if on else {})}
        return {**info, "kind": "line", "before": " ".join(x["w"] for x in ws if x["end"] - WORD_EDGE <= t),
                "after": " ".join(x["w"] for x in ws if x["start"] + WORD_EDGE >= t)}
    for e in extras:
        if isnum(e.get("start")) and isnum(e.get("end")) and e["start"] + WORD_EDGE < t < e["end"] - WORD_EDGE:
            return {"kind": "extra", "desc": str(e.get("desc") or e.get("text") or "a backing vocal"),
                    "start": e["start"], "end": e["end"]}
    return None


def voice_at(t: float, vocal: np.ndarray, pitch: np.ndarray | None, fps: float) -> dict:
    """The vocal stem across time t (song time), for a song without lyrics: its mean level over VOICE_S before and
    after t, and when a pitch held across t started. "sounding": a voice is heard across t, so a cut there falls
    inside singing (which word, only lyrics can say)."""
    i, k = int(round(t * fps)), max(1, int(round(VOICE_S * fps)))
    lv = [float(np.mean(x)) if len(x) else 0.0 for x in (vocal[max(0, i - k):i], vocal[i:i + k])]
    held = None
    if pitch is not None and k <= i <= len(pitch) - k:
        seg = pitch[i - k:i + k]
        ref = float(np.median(seg))
        if ref > 0 and float(np.max(np.abs(seg - ref))) <= HELD_SEMITONES:
            j = i - k
            while j > 0 and abs(pitch[j - 1] - ref) <= HELD_SEMITONES:
                j -= 1
            held = round(j / fps, 2)
    return {"before": round(lv[0], 2), "after": round(lv[1], 2), "heldFrom": held,
            "sounding": min(lv) > VOICE_ON or held is not None}


def drum_changes(drums: np.ndarray, downs: np.ndarray, fps: float) -> list[tuple[float, str]]:
    """Where the drum stem stops for a whole bar or more after drummed bars ("out") and where it comes in again
    ("in"), bar by bar between the downbeats: (song time of that bar's downbeat, which)."""
    off = [float(np.percentile(seg, 90)) < DRUMS_OFF if len(seg) else False
           for seg in (drums[int(round(s * fps)):int(round(e * fps))] for s, e in zip(downs, downs[1:]))]
    return [(float(downs[i]), "out" if off[i] else "in") for i in range(1, len(off)) if off[i] != off[i - 1]]


def shift_span(s: float, e: float, a: float, b: float, dur3: float, keep_short: bool = False):
    """[s, e] in song time -> clipped to the window [a, b] and in window time, or None when less than
    WORD_EDGE of it is inside (an interval lying wholly inside is kept whatever its length)."""
    s2, e2 = max(s, a), min(e, b)
    inside = s >= a - 1e-9 and e <= b + 1e-9
    if e2 - s2 <= 0 or (not inside and not keep_short and e2 - s2 < WORD_EDGE):
        return None
    return max(0.0, round(s2 - a, 3)) + 0.0, min(dur3, round(e2 - a, 3))


def window_words(doc: dict, a: float, b: float, dur3: float, rec: dict, win_rel: str, win_sha: str) -> tuple[dict, dict]:
    """The song's words.json -> the window's: every time minus a, keeping what falls inside [a, b]. A word cut by
    an edge keeps its part inside; a line keeps its words inside (its text becomes them when some are left out)."""
    out_lines, cut, dropped_lines, total = [], [], 0, 0
    for line in doc.get("lines") or []:
        if not isinstance(line, dict):
            continue
        total += 1
        ws = line.get("words") or []
        if not ws:  # (a line without words: kept by its own span)
            if isnum(line.get("start")) and isnum(line.get("end")):
                sp = shift_span(line["start"], line["end"], a, b, dur3)
                if sp:
                    out_lines.append({**line, "start": sp[0], "end": sp[1]})
                    continue
            dropped_lines += 1
            continue
        kept, n_ok, clipped = [], 0, False
        for x in ws:
            if not (isinstance(x, dict) and isnum(x.get("start")) and isnum(x.get("end"))):
                continue
            n_ok += 1
            sp = shift_span(x["start"], x["end"], a, b, dur3)
            if sp is None:
                continue
            nx = dict(x)
            nx["start"], nx["end"] = sp
            if "duration" in nx:
                nx["duration"] = round(sp[1] - sp[0], 3)
            if isinstance(x.get("syl"), list):
                syl = []
                for y in x["syl"]:
                    if isinstance(y, (list, tuple)) and len(y) == 2 and isnum(y[0]) and isnum(y[1]):
                        ys = shift_span(max(y[0], x["start"]), min(y[1], x["end"]), a, b, dur3, keep_short=True)
                        if ys and ys[1] > ys[0]:
                            syl.append([max(ys[0], sp[0]), min(ys[1], sp[1])])
                nx["syl"] = syl
            if x["start"] < a - 1e-9 or x["end"] > b + 1e-9:
                clipped = True
                if x["start"] < a - WORD_EDGE or x["end"] > b + WORD_EDGE:  # (less is the timings' own error)
                    cut.append({"w": x["w"], "start": x["start"], "end": x["end"], "kept": list(sp)})
            kept.append(nx)
        if not kept:
            dropped_lines += 1
            continue
        nl = dict(line)
        nl["words"] = kept
        if len(kept) == n_ok and not clipped and isnum(line.get("start")) and isnum(line.get("end")):
            nl["start"], nl["end"] = shift_span(line["start"], line["end"], a, b, dur3, keep_short=True) or (
                kept[0]["start"], kept[-1]["end"])
        else:
            nl["start"], nl["end"] = kept[0]["start"], kept[-1]["end"]
            if len(kept) < n_ok:
                nl["text"] = " ".join(str(k.get("w", "")) for k in kept)
        if "i" in nl:
            nl["i"] = len(out_lines)
        out_lines.append(nl)
    out: dict = {}
    for k, v in doc.items():
        if k == "lines":
            out[k] = out_lines
        elif k == "extras" and isinstance(v, list):
            ex = []
            for e in v:
                if isinstance(e, dict) and isnum(e.get("start")) and isnum(e.get("end")):
                    sp = shift_span(e["start"], e["end"], a, b, dur3)
                    if sp:
                        ex.append({**e, "start": sp[0], "end": sp[1]})
            out[k] = ex
        elif k in ("audioSha256", "window"):
            continue
        elif k == "audio" and isinstance(v, str):
            out[k] = Path(win_rel).name
        elif k == "source" and isinstance(v, dict) and "audio" in v:
            out[k] = {**v, "audio": win_rel}
        elif k == "notes" and isinstance(v, str):
            out[k] = f"The song's notes, in song time: {v}"
        else:
            out[k] = v
    if "lines" not in out:
        out["lines"] = out_lines
    out["audioSha256"] = win_sha
    out["window"] = rec
    note_ = (f"Window: {rec['song']} {rec['from']:.3f}-{rec['to']:.3f} s; every time here is the song's minus "
             f"{rec['from']:.3f} s (beats.py window), and lines and words outside it are left out; a word cut by an "
             f"edge keeps its part inside. The whole song's words: {rec['data']}.")
    out["notes"] = note_ + (" " + out["notes"] if isinstance(out.get("notes"), str) else "")
    n_words = sum(len(line.get("words") or []) for line in out_lines)
    return out, {"lines": len(out_lines), "of": total, "dropped": dropped_lines, "words": n_words, "cut": cut,
                 "first": line_text(out_lines[0]) if out_lines else None,
                 "last": line_text(out_lines[-1]) if out_lines else None}


def window_audio_doc(doc: dict, a: float, b: float, dur3: float, i0: int, rec: dict, win_rel: str,
                     win_sha: str, gain=None) -> tuple[dict, dict]:
    """The song's audio.json -> the window's: every time minus a, keeping what falls inside [a, b); sections
    clipped to it; each envelope sliced from frame i0; duration the window's. `gain(t)`: the fade's gain at window
    time t, which scales the loudness envelopes and the onset strengths as it scales the audio (None: no fade)."""
    fps = doc.get("fps") or FPS

    def inside(t) -> bool:
        return isnum(t) and t - a > -1e-9 and b - t > 1e-9 and round(t - a, 3) < dur3

    def sh(t: float) -> float:
        return max(0.0, round(t - a, 3)) + 0.0

    beats = doc.get("beats") or []
    mask = [inside(t) for t in beats]
    info: dict = {"copied": [], "fadedFrames": 0, "fadedOnsets": 0}
    n_env = math.ceil(dur3 * fps)  # validate()'s own count, so the lengths agree with it exactly

    def faded(x, t: float) -> tuple:
        g = gain(t) if gain else 1.0
        return (round(x * g, 3) + 0.0, 1) if g < 1 and isnum(x) else (x, 0)

    def env(v: list, name: str) -> list:
        sl = list(v[i0:i0 + n_env])
        if len(sl) < n_env:  # (a window that ends with the song may need a frame past the song's last)
            sl += [sl[-1] if sl else 0.0] * (n_env - len(sl))
        if gain and name in LOUDNESS:  # (frame i is read at window time i / fps)
            for i, x in enumerate(sl):
                sl[i], hit = faded(x, i / fps)
                info["fadedFrames"] += hit
        return sl

    def onset(x) -> list:
        s, hit = faded(x[1], sh(x[0]))
        info["fadedOnsets"] += hit
        return [sh(x[0]), s]

    out: dict = {}
    for k, v in doc.items():
        if k == "duration":
            out[k] = dur3
        elif k in ("beats", "beatsRaw", "downbeats") and isinstance(v, list):
            out[k] = [sh(t) for t in v if inside(t)]
        elif k == "beatInBar" and isinstance(v, list) and len(v) == len(beats):
            out[k] = [x for x, m in zip(v, mask) if m]
        elif k == "sections" and isinstance(v, list):
            secs = []
            for s in v:
                if isinstance(s, dict) and isnum(s.get("start")) and isnum(s.get("end")):
                    s0, s1 = max(s["start"], a), min(s["end"], b)
                    if round(s1 - a, 3) - round(s0 - a, 3) >= 0.001:
                        secs.append({**s, "start": sh(s0), "end": round(s1 - a, 3)})
            if secs:
                secs[0]["start"], secs[-1]["end"] = 0.0, dur3
            out[k] = secs
            info["sectionsDropped"] = [s.get("name") for s in v if isinstance(s, dict) and s.get("name") not in
                                       {x.get("name") for x in secs}]
        elif k == "features" and isinstance(v, dict):
            out[k] = {name: env(arr, name) if isinstance(arr, list) else arr for name, arr in v.items()}
        elif k in ENVELOPES and isinstance(v, list):
            out[k] = env(v, k)
        elif k == "onsets" and isinstance(v, dict):
            out[k] = {kind: [onset(x) for x in ev if isinstance(x, (list, tuple)) and len(x) == 2 and inside(x[0])]
                      for kind, ev in v.items() if isinstance(ev, list)}
        elif k == "cues":
            items = list(v.items()) if isinstance(v, dict) else [(c.get("name"), c.get("t")) for c in v or []
                                                                 if isinstance(c, dict)]
            keep = [(n_, t) for n_, t in items if isnum(t) and -1e-9 < t - a and round(t - a, 3) <= dur3]
            out[k] = ({n_: sh(t) for n_, t in keep} if isinstance(v, dict) else
                      [{"name": n_, "t": sh(t)} for n_, t in keep])
            info["cuesDropped"] = [n_ for n_, _ in items if n_ not in {x for x, _ in keep}]
        elif k == "tempo" and isinstance(v, dict):
            tm = dict(v)
            if isinstance(tm.get("map"), list):
                tm["map"] = [[sh(x[0]), x[1]] for x in tm["map"] if isinstance(x, list) and len(x) == 2 and inside(x[0])]
            if isinstance(tm.get("steady"), list):
                tm["steady"] = [{**x, "start": sh(max(x["start"], a)), "end": round(min(x["end"], b) - a, 3)}
                                for x in tm["steady"] if isinstance(x, dict) and isnum(x.get("start")) and
                                isnum(x.get("end")) and min(x["end"], b) - max(x["start"], a) > 0]
            if isinstance(tm.get("changes"), list):
                tm["changes"] = [{**x, "from": sh(x["from"]), "to": sh(x["to"])} for x in tm["changes"]
                                 if isinstance(x, dict) and inside(x.get("from")) and inside(x.get("to"))]
            out[k] = tm
        elif k == "analysis" and isinstance(v, dict):
            an = dict(v)
            if isinstance(an.get("phaseChanges"), list):
                an["phaseChanges"] = [sh(t) for t in an["phaseChanges"] if inside(t)]
            out[k] = an
        elif k in ("audioFile", "audioSha256", "window"):
            continue
        elif k == "notes" and isinstance(v, str):
            out[k] = v
        else:
            out[k] = v
            if k not in ("bpm", "beat_period", "time_signature", "fps"):
                info["copied"].append(k)
    mode = (doc.get("tempo") or {}).get("mode") if isinstance(doc.get("tempo"), dict) else None
    bw = out.get("beats") or []
    if mode not in ("grid", "declared") and len(bw) >= 2 and isnum(out.get("bpm")):
        avg = 60 * (len(bw) - 1) / (bw[-1] - bw[0])
        if abs(avg / out["bpm"] - 1) >= 0.02:  # validate()'s bar: a drifting tempo's window has its own average
            out["bpm"] = round(avg, 3)
            if "beat_period" in out:
                out["beat_period"] = round(60 / avg, 5)
            info["bpm"] = f"the window's own average tempo, {avg:.2f} BPM (the song's: {doc.get('bpm')})"
    out["audioFile"] = win_rel
    out["audioSha256"] = win_sha
    out["window"] = rec
    note_ = (f"Window: {rec['song']} {rec['from']:.3f}-{rec['to']:.3f} s (samples {rec['samples'][0]}-"
             f"{rec['samples'][1]} at {rec['sampleRate']} Hz), cut as {win_rel} by beats.py window. Every time here "
             f"is the song's minus {rec['from']:.3f} s, keeping what falls inside; sections are clipped to the window; "
             f"each envelope starts at the song's frame {i0} (song time {i0 / fps:.3f} s)"
             + (f"; over the fade (the last {rec['fade']} s) the loudness envelopes (all but pitchMidi) and the onset "
                f"strengths are scaled by its gain, as the audio is" if gain and rec.get("fade") else "")
             + f". tempo.fit and analysis describe the song's analysis. The whole song's data: {rec['data']}.")
    out["notes"] = note_ + (f" The song's notes, in song time: {doc['notes']}" if isinstance(doc.get("notes"), str) else "")
    info["envelopes"] = sorted([k for k in ENVELOPES if isinstance(doc.get(k), list)] +
                               [k for k, x in (doc.get("features") or {}).items() if isinstance(x, list)])
    info["envelopeLength"] = n_env
    return out, info


def window_plot(path: Path, y: np.ndarray, sr: int, song_a: dict, lines: list[dict], a: float, b: float,
                fade: float | None, title: str) -> None:
    """The window on the whole song (loudness, sections, sung lines), and each edge up close: the waveform,
    beats and downbeats (song bar numbers), the words, the cut and the fade."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    mono = y.mean(axis=1) if y.ndim > 1 else y
    dur = len(mono) / sr
    fps = song_a.get("fps") or FPS
    rms = (song_a.get("features") or {}).get("rms") or song_a.get("rms")
    if not rms:
        hop = int(sr / fps)
        rms = np.sqrt(np.convolve(mono.astype(np.float64) ** 2, np.ones(hop) / hop, mode="same")[::hop])
        rms = np.clip(rms / (np.percentile(rms, NORM_PCT) + 1e-12), 0, 1)
    rms = np.asarray(rms, float)
    beats = np.asarray(song_a.get("beats") or [], float)
    downs = np.asarray(song_a.get("downbeats") or [], float)
    bar_s = float(np.median(np.diff(downs))) if len(downs) > 1 else 2.0
    orange, red, blue = "#e67e22", "#c0392b", "#4a7fb5"
    fig = plt.figure(figsize=(16, 7.6), dpi=100)
    gs = fig.add_gridspec(2, 2, height_ratios=[1, 1.6], hspace=0.42, wspace=0.05, left=0.04, right=0.99, top=0.92,
                          bottom=0.09)
    ax = fig.add_subplot(gs[0, :])
    tr = np.arange(len(rms)) / fps
    ax.fill_between(tr, 0, rms, color="0.82", lw=0)
    ax.plot(tr, rms, color="0.45", lw=0.4)
    ax.axvspan(a, b, color=orange, alpha=0.28, lw=0)
    for i, s in enumerate(song_a.get("sections") or []):
        if not (isinstance(s, dict) and isnum(s.get("start")) and isnum(s.get("end"))):
            continue
        ax.axvspan(s["start"], s["end"], ymin=0.88, ymax=1.0, color=("#9ecae1", "#fdd0a2")[i % 2], lw=0)
        if s["end"] - s["start"] > 0.03 * dur:
            ax.text((s["start"] + s["end"]) / 2, 0.94, str(s.get("name", "")), fontsize=8, ha="center", va="center",
                    transform=ax.get_xaxis_transform())
    for line in lines:
        ws = line_words(line)
        if ws:
            ax.plot([ws[0]["start"], ws[-1]["end"]], [-0.07, -0.07], color=blue, lw=4, solid_capstyle="butt")
    ax.set_xlim(0, dur)
    ax.set_ylim(-0.12, 1.0 / 0.86)
    ax.set_yticks([])
    ax.tick_params(labelsize=8)
    ax.set_xlabel("song time (s); orange: the window; grey: loudness (rms); blue: sung lines; top strip: sections",
                  fontsize=8)
    ax.set_title(title, fontsize=10, loc="left")
    for k, (edge, label) in enumerate(((a, "start"), (b, "end"))):
        axz = fig.add_subplot(gs[1, k])
        t0, t1 = max(0.0, edge - 2 * bar_s), min(dur, edge + 2 * bar_s)
        i0, i1 = int(t0 * sr), int(t1 * sr)
        seg = mono[i0:i1].astype(np.float64)
        step = max(1, len(seg) // 1500)
        m = len(seg) // step * step
        blk = seg[:m].reshape(-1, step)
        tt = t0 + (np.arange(len(blk)) * step + step / 2) / sr
        pk = max(float(np.abs(seg).max()), 1e-6)
        axz.fill_between(tt, blk.min(1) / pk, blk.max(1) / pk, color="0.6", lw=0)
        xt = axz.get_xaxis_transform()
        for t in beats[(beats >= t0) & (beats <= t1)]:
            isd = len(downs) and np.min(np.abs(downs - t)) < 1e-6
            axz.axvline(t, color="k" if isd else "0.55", lw=1.6 if isd else 0.6)
            if isd:
                axz.text(t, 1.01, str(nearest(downs, t) + 1), fontsize=7, ha="center", va="bottom", transform=xt)
        axz.axvspan(t0, a, color="0.25", alpha=0.25, lw=0) if label == "start" else axz.axvspan(b, t1, color="0.25",
                                                                                                 alpha=0.25, lw=0)
        axz.axvline(edge, color=red, lw=2.2)
        if label == "end" and fade:  # (the gain closing on the waveform)
            axz.plot([b - fade, b, b - fade], [1.0, 0.0, -1.0], color=orange, lw=2)
        row = 0
        for line in lines:
            for x in line_words(line):
                if x["end"] < t0 or x["start"] > t1:
                    continue
                cutw = x["start"] + WORD_EDGE < edge < x["end"] - WORD_EDGE
                yv = -1.18 - 0.2 * (row % 3)
                row += 1
                axz.plot([max(x["start"], t0), min(x["end"], t1)], [yv, yv], color=red if cutw else blue, lw=3,
                         solid_capstyle="butt")
                axz.text(max(x["start"], t0), yv + 0.07, str(x.get("w", "")), fontsize=7, ha="left", va="bottom",
                         color=red if cutw else "k", clip_on=True)
        axz.set_xlim(t0, t1)
        axz.set_ylim(-1.68, 1.12)
        axz.set_yticks([])
        axz.tick_params(labelsize=7)
        axz.set_title(f"{label}: {edge:.3f} s (red line); song bar numbers above the downbeats", fontsize=9, loc="left",
                      pad=12)
    fig.text(0.04, 0.015, "grey: the waveform; black lines: downbeats; grey lines: beats; blue: words (red: a word "
             "the cut falls inside); shaded: outside the window; orange line: the fade", fontsize=8)
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=100)
    plt.close(fig)


def cut_window(song: Path, tmp: Path, y: np.ndarray, sr: int, S0: int, S1: int, fade_n: int, beat: float,
               as_float: bool) -> dict:
    """Cut samples [S0, S1) of the song into `tmp` and check them against the song's decode. atrim counts samples
    from the first one of ffmpeg's gapless decode, as decode() and Chrome do, so there is no seek to land off and
    no first samples to lose; the fade (linear, in float: on a 16-bit source afade would round the faded samples
    to 16 bits) is inside the window. 24-bit WAV, or 32-bit float when the song's samples go over full scale."""
    N = S1 - S0
    codec, depth = ("pcm_f32le", "32-bit float") if as_float else ("pcm_s24le", "24-bit")
    af = f"atrim=start_sample={S0}:end_sample={S1},asetpts=PTS-STARTPTS"
    if fade_n:
        af += f",aformat=sample_fmts=fltp|flt,afade=t=out:start_sample={N - fade_n}:nb_samples={fade_n}"
    r = subprocess.run([tool("ffmpeg"), "-v", "error", "-nostdin", "-y", "-i", str(song), "-map", "0:a:0", "-vn",
                        "-af", af, "-c:a", codec, "-f", "wav", str(tmp)], capture_output=True)
    if r.returncode != 0:
        raise Fail(1, f"ffmpeg could not cut {song.name}: {r.stderr.decode(errors='replace').strip()[:300]}")
    yw, srw = decode(tmp)
    seg, unfaded = y[S0:S1], N - fade_n
    if srw != sr or len(yw) != N or yw.shape[1] != y.shape[1]:
        raise Fail(1, f"the cut is {len(yw)} samples at {srw} Hz, {yw.shape[1]} channels, not {N} at {sr} Hz, "
                      f"{y.shape[1]}: nothing was written. Report this with the ffmpeg version (ffmpeg -version)")
    diff = float(np.abs(yw[:unfaded] - seg[:unfaded]).max()) if unfaded else 0.0
    if diff > CUT_MATCH:
        raise Fail(1, f"the cut differs from the song's samples from {S0} by up to {diff:.2g}: nothing was written. "
                      f"Report this with the ffmpeg version (ffmpeg -version)")
    fade = None
    if fade_n:
        g = np.linspace(1, 0, fade_n, endpoint=False)  # (afade's linear curve: 1 - i/n over the fade's n samples)
        dev = float(np.abs(yw[unfaded:] - seg[unfaded:] * g[:, None]).max())
        fade = {"seconds": round(fade_n / sr, 3), "from": round(unfaded / sr, 3), "beats": round(fade_n / sr / beat, 2),
                "curve": "linear", "deviation": round(dev, 6), "lastSample": round(float(np.abs(yw[-1]).max()), 6)}
    return {"sha": sha256(tmp), "seconds": len(yw) / srw, "depth": depth, "unfaded": unfaded, "maxDifference": diff,
            "fade": fade}


def run_window(args) -> dict:
    t_start = time.time()
    a_req, b_req, fade = args.start, args.end, args.fade
    if not (isnum(a_req) and isnum(b_req)) or a_req < 0:
        raise Fail(2, f"--from {a_req}: a time in seconds, 0 or more (song time)")
    if b_req <= a_req:
        raise Fail(2, f"--to {b_req} must come after --from {a_req}")
    if fade is not None and not (isnum(fade) and fade > 0):
        raise Fail(2, f"--fade {fade}: a length in seconds over 0 (leave it out for a hard cut)")
    if args.name is not None and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,80}", args.name):
        raise Fail(2, f"--name {args.name!r}: letters, digits, '.', '_' and '-' only (the file is audio/<stem>-window.wav)")
    w = where(args.video, args.out, [args.song] if args.song else [])
    base = w.video_dir or w.base
    show = (lambda p: rel(p, w.project or w.base))

    def relv(p: Path) -> str:  # (as analyze names its audioFile)
        return data_name(p, w)

    song_dir = w.data_dir / "song"
    paths = {"audio": (w.data_dir / "audio.json", song_dir / "audio.json"),
             "words": (w.data_dir / "words.json", song_dir / "words.json")}
    cur_a, sav_a = read_doc(paths["audio"][0]), read_doc(paths["audio"][1])
    cur_w, sav_w = read_doc(paths["words"][0]), read_doc(paths["words"][1])
    song, chosen = window_song(args, w, cur_a, sav_a, cur_w, sav_w)
    song_rel = relv(song)
    stem = re.sub(r"-window$", "", args.name or song.stem) or song.stem
    win_path = (w.audio_dir / f"{stem}-window.wav").resolve()
    win_rel = relv(win_path)
    if isinstance(cur_a, dict) and isinstance(cur_a.get("window"), dict) and cur_a.get("audioFile") == song_rel:
        raise Fail(2, f"{song_rel} is a window of {cur_a['window'].get('song')} (beats.py window): cut the song itself "
                      f"(--from and --to are song times)")
    if win_path == song:
        raise Fail(2, f"the window file would replace the song ({song_rel}): name it with --name")

    # ---- the song
    note(f"beats.py window: decoding {song.name}")
    y, sr = decode(song)
    sha = sha256(song)
    n_song = len(y)
    song_dur = n_song / sr
    if a_req >= song_dur - ON_DOWNBEAT:
        raise Fail(2, f"--from {a_req} is at or past the song's end ({song_dur:.3f} s): the window lies inside "
                      f"{song.name}")
    if b_req > song_dur + ON_DOWNBEAT:
        raise Fail(2, f"--to {b_req} is past the song's end ({song_dur:.3f} s): the window lies inside {song.name}; "
                      f"end it at {song_dur:.3f} s at most")
    kinds = {k: (describes(cur, song_rel, sha, song_dur, k == "words") if cur is not None else None,
                 describes(sav, song_rel, sha, song_dur, k == "words") if sav is not None else None)
             for k, cur, sav in (("audio", cur_a, sav_a), ("words", cur_w, sav_w))}
    notes, warnings = [], []
    if chosen != "given":
        notes.append(f"the song: {song_rel} ({chosen})")
    if "/" not in song_rel and song.parent != base:
        notes.append(f"{song.name} lies outside {'the project' if w.project else 'the --out folder'}: give it again "
                     f"for the next window, or copy it into {show(w.audio_dir)}/")

    # ---- the whole song's words: data/words.json when it is the song's, else data/song/words.json
    (kw, ksw), (ka, ks) = kinds["words"], kinds["audio"]
    fits = (lambda d: last_word_end(d) <= song_dur + SAME_LENGTH)
    words_src, song_w, no_words = None, None, False
    if kw and (kw[0] == "song" or (kw[0] == "unknown" and (ka is None or ka[0] == "song") and fits(cur_w))):
        words_src, song_w = "moved", cur_w
    elif ksw and (ksw[0] == "song" or (ksw[0] == "unknown" and (ks is None or ks[0] == "song") and fits(sav_w))):
        words_src, song_w = "kept", sav_w
        if kw and kw[0] != "window":  # (the window's words would replace a file nothing else holds)
            raise Fail(2, f"data/words.json ({kw[1]}) would be replaced by the window's words: if it is the song's "
                          f"words, move it to data/song/words.json; if not, move it out of data/; then run window again")
    elif kw and kw[0] == "window":
        raise Fail(2, f"data/words.json holds the words of an earlier window ({kw[1]}), and the song's own words "
                      f"(data/song/words.json) are " + ("missing" if sav_w is None else f"not this song's ({ksw[1]})")
                      + ": put the song's words in data/song/words.json (align.py song writes them), or delete "
                        "data/words.json to cut a window without words")
    else:
        if kw:
            warnings.append(f"data/words.json is not this song's ({kw[1]}): left as it is, and the window has no words")
        if ksw:
            warnings.append(f"data/song/words.json is not this song's ({ksw[1]}): not used")
        no_words = not (kw or ksw)  # (said below, with what the song's data allows instead)

    # ---- the whole song's audio.json: data/audio.json when it is the song's, else data/song/audio.json, else
    # the normal analysis of the song, written to data/song/
    analysis = None
    if ka and ka[0] == "song":
        audio_src, song_a = "moved", cur_a
        if sav_a is not None and sav_a != cur_a:
            notes.append("data/audio.json held a newer analysis of the song than data/song/audio.json: it takes its "
                         "place there")
    elif ks and ks[0] == "song":
        audio_src, song_a = "kept", sav_a
    else:
        if ks:
            notes.append(f"data/song/audio.json was not this song's ({ks[1]}): the song is analyzed again")
        if ka and ka[0] == "other":
            notes.append(f"data/audio.json ({ka[1]}) is replaced by the window's")
        aargs = make_parser().parse_args(["analyze", str(song), "--tracker", args.tracker])
        aargs.video, aargs.out, aargs.for_window = args.video, args.out, True
        if song_w is not None:
            aargs.words = str(paths["words"][0] if words_src == "moved" else paths["words"][1])
        note(f"beats.py window: {song.name} has no analysis yet: analyzing it into {show(song_dir)}/ first")
        from dataclasses import replace

        analysis = run_analyze(aargs, w=replace(w, data_dir=song_dir))
        audio_src, song_a = "analyzed", read_doc(song_dir / "audio.json")
    errs, _, _ = validate(song_a)
    if errs:
        raise Fail(1, f"the song's audio.json ({'data/audio.json' if audio_src == 'moved' else 'data/song/audio.json'}) "
                      f"fails the engine's checks: {'; '.join(errs)}. Analyze the song again: beats.py {song_rel} "
                      f"--video {w.name}")
    if kinds["audio"][0] and kinds["audio"][0][1].startswith("it names no audio file") and audio_src == "moved":
        notes.append(f"data/audio.json is taken as the song's: {kinds['audio'][0][1]}")

    beats = np.asarray(song_a.get("beats") or [], float)
    downs = np.asarray(song_a.get("downbeats") or [], float)
    beat = float(np.median(np.diff(beats))) if len(beats) > 1 else 60 / float(song_a.get("bpm") or 120)
    lines = [x for x in (song_w or {}).get("lines") or [] if isinstance(x, dict)]
    extras = [x for x in (song_w or {}).get("extras") or [] if isinstance(x, dict)]

    # ---- the window on the music: ends on downbeats (or the song's own ends), a pickup start; moved there unless --exact
    a, b = float(a_req), min(float(b_req), song_dur)

    def on_down(t: float) -> bool:
        return bool(len(downs) and abs(downs[nearest(downs, t)] - t) <= ON_DOWNBEAT)

    if len(downs):  # within 1.5 ms of a downbeat is that downbeat, exactly as the data has it
        if on_down(a):
            a = float(downs[nearest(downs, a)])
        if on_down(b):
            b = float(downs[nearest(downs, b)])
    song_start, song_end = a <= ON_DOWNBEAT, b >= song_dur - ON_DOWNBEAT
    a, b = (0.0 if song_start else a), (song_dur if song_end else b)

    sung_words = sorted((x for line in lines for x in line_words(line)), key=lambda x: x["start"])
    # forced alignment (align.py song) runs a word on to the next one unless it heard the voice stop: a word that
    # ends where the next starts has no measured end, so its length is no sign of a held note
    aligned = str(((song_w or {}).get("provenance") or {}).get("tool", "")).startswith("align.py")
    starts = np.array([x["start"] for x in sung_words], float)

    def runs_on(x: dict) -> bool:  # (1.5 ms: both times are kept to the millisecond)
        i = int(np.searchsorted(starts, x["end"] - 0.0015))
        return aligned and i < len(starts) and abs(starts[i] - x["end"]) <= 0.0015

    def pickup_at(t: float) -> dict | None:
        """t is the beat before a sung pickup (the treatment's rule for a line that starts before its bar): on a
        beat, with a line's first word starting within a beat after it and before the next downbeat, after a rest
        of half a beat or more (a line sung straight on from the one before is not a pickup)."""
        if not (len(beats) and len(downs)) or on_down(t) or abs(beats[nearest(beats, t)] - t) > ON_DOWNBEAT:
            return None
        nxt = downs[downs > t + ON_DOWNBEAT]
        if not len(nxt):
            return None
        for line in lines:
            ws = line_words(line)
            first = next((x for x in ws if x["start"] >= t - WORD_EDGE), None)
            if first and first is ws[0] and first["start"] < nxt[0] - WORD_EDGE and first["start"] - t <= beat + WORD_EDGE:
                rest = first["start"] - max((x["end"] for x in sung_words if x["start"] < first["start"] and
                                             x is not first), default=-math.inf)
                if rest >= beat / 2:
                    return {"w": first["w"], "line": line_text(line), "downbeat": float(nxt[0]),
                            "beats": round((nxt[0] - t) / beat)}
        return None

    pickup = pickup_at(a)
    snapped = []  # (which end, asked, moved to, a half-bar tie)
    asked = b - a
    bar_s = float(np.median(np.diff(downs))) if len(downs) > 1 else 4 * beat
    if not args.exact and len(downs):
        # an end between downbeats moves to the nearest one (or to the song's own start or end), so the window is
        # whole bars; on a half-bar tie (in a bar, not in the scrap of one before the first downbeat or after the
        # last), the way that keeps it no longer than asked, give or take the tie's own 10 ms at each end (both ends
        # tied: both the same way, so the bars asked stay)
        def options(t: float, targets: list[float]) -> list[float]:
            near = [x for x in targets if x <= t][-1:] + [x for x in targets if x > t][:1]
            if len(near) == 2 and near[1] - near[0] > bar_s / 2 \
                    and abs((t - near[0]) - (near[1] - t)) <= 2 * HALF_BAR_TIE:
                return near
            return [min(near, key=lambda x: abs(x - t))]

        a_opts = [a] if on_down(a) or pickup or song_start else options(a, [0.0, *map(float, downs)])
        b_opts = [b] if on_down(b) or song_end else options(b, [*map(float, downs), song_dur])
        pairs = [(e - s > asked + 2 * HALF_BAR_TIE, abs(e - s - asked), s, e) for s in a_opts for e in b_opts
                 if e - s > ON_DOWNBEAT]
        if not pairs:
            raise Fail(2, f"the window {a:.3f}-{b:.3f} s is shorter than a bar: both ends move to the downbeat at "
                          f"{a_opts[0]:.3f} s. Give a window of a bar or more, or keep these times with --exact")
        _, _, a2, b2 = min(pairs)
        snapped = [(k, t0, t1, len(o) == 2) for k, t0, t1, o in (("start", a, a2, a_opts), ("end", b, b2, b_opts))
                   if abs(t1 - t0) > 1e-9]
        a, b = a2, b2
        song_start, song_end = a <= ON_DOWNBEAT, b >= song_dur - ON_DOWNBEAT
        pickup = pickup_at(a)
    S0 = math.floor(a * sr + 0.5)
    S1 = n_song if song_end else min(n_song, math.floor(b * sr + 0.5))
    N = S1 - S0
    dur_w = N / sr
    dur3 = round(dur_w, 3)
    if fade is not None and fade > dur_w + 1e-9:
        raise Fail(2, f"--fade {fade} is longer than the window ({dur_w:.3f} s)")
    fade_n = min(N, math.floor(fade * sr + 0.5)) if fade else 0

    def fade_gain(t: float) -> float:  # window time -> the fade's gain: cut_window's afade, 1 - i/n over its n samples
        return min(1.0, max(0.0, 1.0 - (t * sr - (N - fade_n)) / fade_n))
    nb_in = int(np.sum((beats - a > -1e-9) & (b - beats > 1e-9)))
    if nb_in < 2:
        raise Fail(2, f"the window {a:.3f}-{b:.3f} s holds {nb_in} beat{'s' * (nb_in != 1)}; the engine needs 2 or "
                      f"more: make it longer")

    # ---- the checks: bars, sections, what is sung at each end (warnings say how to fix; none stops the cut)
    def bar_no(t: float) -> int:
        return nearest(downs, t) + 1

    def span_text(t0: float, t1: float) -> str:
        return f"{t1 - t0:.3f} s" + (f", {bar_at(t1, downs) - bar_at(t0, downs):.4g} bars" if len(downs) >= 2 else "")

    def at_text(t: float) -> str:
        p = pickup_at(t)
        return (f"the beat before the pickup '{p['w']}', {t:.3f} s" if p else
                f"bar {bar_no(t)}'s downbeat, {t:.3f} s" if on_down(t) else
                f"the song's end, {t:.3f} s" if t >= song_dur - ON_DOWNBEAT else
                f"the song's start, {t:.3f} s" if t <= ON_DOWNBEAT else f"{t:.3f} s")

    first_down = None
    if len(downs):
        inw = downs[(downs - a > -1e-9) & (b - downs > 1e-9)]
        first_down = float(inw[0]) if len(inw) else None
    start: dict = {"t": round(a, 3), "onDownbeat": on_down(a), "songStart": song_start}
    end: dict = {"t": round(b, 3), "onDownbeat": on_down(b), "songEnd": song_end}
    bars = None
    if len(downs) >= 2 and first_down is not None:
        bars = round(bar_at(b, downs) - bar_at(first_down, downs), 2)
        start["bar"] = bar_no(first_down)
        end["bar"] = bar_no(b) if on_down(b) else math.floor(bar_at(b, downs)) + 1
    if not len(downs):
        notes.append("the song's data has no downbeats: the ends are not checked against bars")
    elif on_down(a):
        start["summary"] = f"on song bar {bar_no(a)}'s downbeat ({a:.3f} s)"
    elif pickup:
        start["pickupBeats"] = pickup["beats"]
        start["summary"] = (f"{pickup['beats']} beat{'s' * (pickup['beats'] != 1)} before song bar "
                            f"{bar_no(pickup['downbeat'])}'s downbeat, on the beat before the pickup '{pickup['w']}' "
                            f"(\"{pickup['line']}\")")
    elif song_start:
        start["summary"] = "with the song (0 s)" + (f"; its bar 1 starts at {downs[0]:.3f} s" if downs[0] > 0.05 else "")
    else:
        i = int(np.searchsorted(downs, a)) - 1
        near_ = [float(t) for t in (downs[i] if i >= 0 else None, downs[i + 1] if i + 1 < len(downs) else None)
                 if t is not None and t < b]
        start["summary"] = f"off the downbeats at {a:.3f} s"
        warnings.append(f"the window starts at {a:.3f} s, between downbeats (--exact): start on "
                        + " or ".join(f"{at_text(t)} ({span_text(t, b)})" for t in near_)
                        + " (without --exact it moves to the nearer), or on the beat before a sung pickup")
    if len(downs):
        if on_down(b):
            end["summary"] = f"on song bar {bar_no(b)}'s downbeat ({b:.3f} s)"
        elif song_end:
            end["summary"] = f"with the song ({b:.3f} s)"
        else:
            i = int(np.searchsorted(downs, b)) - 1
            near_ = [float(t) for t in (downs[i] if i >= 0 else None, downs[i + 1] if i + 1 < len(downs) else None)
                     if t is not None and t > a]
            end["summary"] = f"off the downbeats at {b:.3f} s"
            frac = bar_at(b, downs) - math.floor(bar_at(b, downs))
            warnings.append(f"the window ends {frac:.2f} of a bar into song bar {math.floor(bar_at(b, downs)) + 1} "
                            f"({b:.3f} s, {bars} bars, --exact): end on "
                            + " or ".join(f"{at_text(t)} ({span_text(a, t)})" for t in near_)
                            + ("" if fade else ", or with a --fade that lands there")
                            + " (without --exact it moves to the nearer); a length asked in seconds is no reason for "
                              "--exact: tell the director the whole-bar length")
    clean_starts, clean_ends = [], []
    if song_w is not None:
        def clean(t: float) -> bool:
            return sung_at(t, lines, extras, beat, runs_on) is None

        # where a window can start or end with nothing sung across it: downbeats, the beats before sung
        # pickups and the song's start (starts), the song's end (ends)
        clean_downs = [float(t) for t in downs if clean(float(t))]
        clean_starts = sorted(set(clean_downs) | {float(t) for t in beats if pickup_at(float(t)) and clean(float(t))}
                              | ({0.0} if clean(0.0) else set()))
        clean_ends = sorted(set(clean_downs) | {song_dur})
    # how far a suggested start or end may move the window (see NEAR_BARS), at least a bar
    reach = max(bar_s, min(NEAR_BARS * bar_s, NEAR_FRAC * (b - a)))
    for side_, t in (("start", a), ("end", b)):
        rec_ = start if side_ == "start" else end
        if song_w is None:
            continue
        s = None if (side_ == "start" and song_start) or (side_ == "end" and song_end) else \
            sung_at(t, lines, extras, beat, runs_on)
        rec_["sung"] = s
        if s is None:  # (a word up to WORD_EDGE across the edge is on it, within the word timings' error)
            if side_ == "start":
                nxt = [x for x in sung_words if x["start"] >= t - WORD_EDGE]
                rec_["sungSummary"] = "nothing is sung across it" + (
                    "" if not nxt else f"; the first word, '{nxt[0]['w']}', starts with the window ("
                    f"{a - nxt[0]['start']:.2f} s before it, within the word timings' error)" if nxt[0]["start"] < a else
                    f"; the first word, '{nxt[0]['w']}', comes at {nxt[0]['start'] - a:.2f} s")
            else:
                prv = sorted((x for x in sung_words if x["end"] <= t + WORD_EDGE), key=lambda x: x["end"])
                rec_["sungSummary"] = "nothing is sung across it" + (
                    "" if not prv else f"; the last word, '{prv[-1]['w']}', ends with the window ("
                    f"{prv[-1]['end'] - b:.2f} s after it, within the word timings' error)" if prv[-1]["end"] > b else
                    f"; the last word, '{prv[-1]['w']}', ends {b - prv[-1]['end']:.2f} s before it")
            continue
        what = (f"the {s['kind']} '{s['w']}' ({s['start']:.3f}-{s['end']:.3f} s, in \"{s['line']}\""
                + ("; its end is where the next word starts, as the aligner heard no rest, so it may stop sooner"
                   if s.get("runsOn") else "") + ")"
                if s["kind"] in ("word", "held note") else
                f"the line \"{s['line']}\" ({s['lineStart']:.3f}-{s['lineEnd']:.3f} s), between '"
                f"{s['before'].split()[-1] if s['before'] else ''}' and '{s['after'].split()[0] if s['after'] else ''}'"
                if s["kind"] == "line" else f"{s['desc']} ({s['start']:.3f}-{s['end']:.3f} s)")
        rec_["sungSummary"] = f"inside {what}"
        within = f"within {reach / bar_s:.3g} bars" if len(downs) > 1 else f"within {reach:.1f} s"
        if side_ == "end":
            gone = (f"\"{s['after']}\" is cut" if s["kind"] == "line" else f"its last {s['end'] - b:.2f} s are cut")
            near_ = ([x for x in clean_ends if max(a + beat, b - reach - ON_DOWNBEAT) < x < b - ON_DOWNBEAT][-1:]
                     + [x for x in clean_ends if b + ON_DOWNBEAT < x <= b + reach + ON_DOWNBEAT][:1])
            fade_out = f"fade it out over the last bar (--fade {bar_s:.3f})"
            warnings.append(f"the window ends inside {what}: {gone}"
                            + (" (--fade fades it out there, but still mid-word)" if fade and s["kind"] != "line" else "")
                            + (". The nearest ends with nothing sung across them: "
                               + " or ".join(f"{at_text(x)} ({span_text(a, x)})" for x in near_)
                               + ("" if fade else f"; or keep this end and {fade_out}") if near_ else
                               f". No end {within} has nothing sung across it"
                               + ("" if fade else f": keep this end and {fade_out}")))
        else:
            gone = (f"\"{s['before']}\" is cut" if s["kind"] == "line" else f"its first {a - s['start']:.2f} s are cut")
            near_ = ([x for x in clean_starts if a - reach - ON_DOWNBEAT <= x < a - ON_DOWNBEAT][-1:]
                     + [x for x in clean_starts if a + ON_DOWNBEAT < x < min(b - beat, a + reach + ON_DOWNBEAT)][:1])
            warnings.append(f"the window starts inside {what}: {gone}"
                            + (". The nearest starts with nothing sung across them: "
                               + " or ".join(f"{at_text(x)} ({span_text(x, b)})" for x in near_) if near_ else
                               f". No start {within} has nothing sung across it"))

    # without lyrics, the vocal stem (analyze --stems) hears whether a voice sounds across an end, not which word
    feats_ = song_a.get("features") if isinstance(song_a.get("features"), dict) else {}
    ons_ = song_a.get("onsets") if isinstance(song_a.get("onsets"), dict) else {}
    vocal_, pitch_ = feats_.get("vocal") or song_a.get("vocal"), feats_.get("pitchMidi") or song_a.get("pitchMidi")
    # the song analyzed with its stems (without them, vocal and drums are guesses from the mix, not used here)
    stems = (isinstance(pitch_, list) or "vocal" in ons_ or "snare" in ons_
             or isinstance(song_a.get("analysis"), dict) and song_a["analysis"].get("stems") is True)
    voiced = song_w is None and stems and isinstance(vocal_, list) and len(vocal_) > 0
    if no_words:
        notes.append("the song has no words.json: " + (
            "the window's ends are checked on the vocal stem only, which hears a voice but not its words (align.py "
            "song times the lyrics)" if voiced else "what is sung at the window's ends is not checked (align.py song "
            "times the lyrics; analyzing the song with --stems measures its vocal stem there)"))
    if voiced:
        fps_s = song_a.get("fps") or FPS
        vv, pp = np.asarray(vocal_, float), (np.asarray(pitch_, float) if isinstance(pitch_, list) else None)

        def quiet(t: float) -> bool:
            return not voice_at(t, vv, pp, fps_s)["sounding"]

        within = f"within {reach / bar_s:.3g} bars" if len(downs) > 1 else f"within {reach:.1f} s"
        for side_, t in (("start", a), ("end", b)):
            if (side_ == "start" and song_start) or (side_ == "end" and song_end):
                continue
            rec_ = start if side_ == "start" else end
            vx = rec_["voice"] = voice_at(t, vv, pp, fps_s)
            nums = (f"{vx['before']:.2f} | {vx['after']:.2f}"
                    + (f", a pitch held from {vx['heldFrom']:.2f} s" if vx["heldFrom"] is not None else ""))
            rec_["voiceSummary"] = ("a voice across it" if vx["sounding"] else "quiet across it") + f" ({nums})"
            if not vx["sounding"]:
                continue
            # the nearest downbeats (or the song's own start or end) where the stem is quiet, one each way
            if side_ == "start":
                cand = [0.0, *map(float, downs)]
                near_ = ([x for x in cand if a - reach - ON_DOWNBEAT <= x < a - ON_DOWNBEAT and quiet(x)][-1:]
                         + [x for x in cand if a + ON_DOWNBEAT < x < min(b - beat, a + reach + ON_DOWNBEAT)
                            and quiet(x)][:1])
                fix = ("The nearest downbeats where the vocal stem is quiet: "
                       + " or ".join(f"{at_text(x)} ({span_text(x, b)})" for x in near_) if near_ else
                       f"No downbeat {within} has the vocal stem quiet")
            else:
                cand = [*map(float, downs), song_dur]
                near_ = ([x for x in cand if max(a + beat, b - reach - ON_DOWNBEAT) < x < b - ON_DOWNBEAT
                          and quiet(x)][-1:]
                         + [x for x in cand if b + ON_DOWNBEAT < x <= b + reach + ON_DOWNBEAT and quiet(x)][:1])
                fade_out = f"fade it out over the last bar (--fade {bar_s:.3f})"
                fix = ("The nearest downbeats where the vocal stem is quiet: "
                       + " or ".join(f"{at_text(x)} ({span_text(a, x)})" for x in near_)
                       + ("" if fade else f"; or keep this end and {fade_out}") if near_ else
                       f"No downbeat {within} has the vocal stem quiet"
                       + ("" if fade else f": keep this end and {fade_out}"))
            warnings.append(f"a voice is sounding across the {side_} (vocal stem {nums}): the window likely "
                            f"{'opens' if side_ == 'start' else 'ends'} mid-word or mid-line; lyrics (align.py song) "
                            f"would name it. {fix}")

    # sections inside the window, with their bars
    secs_in = []
    for s in song_a.get("sections") or []:
        if not (isinstance(s, dict) and isnum(s.get("start")) and isnum(s.get("end"))):
            continue
        s0, s1 = max(s["start"], a), min(s["end"], b)
        if s1 - s0 < 0.001:
            continue
        nb = int(np.sum((downs >= s0 - 1e-9) & (downs < s1 - 1e-9))) if len(downs) else None
        full = int(np.sum((downs >= s["start"] - 1e-9) & (downs < s["end"] - 1e-9))) if len(downs) else None
        secs_in.append({"name": s.get("name"), "start": round(s0 - a, 3), "end": round(s1 - a, 3), "bars": nb,
                        "ofBars": full, "cut": [x for x, c in (("start", s["start"] < a - ON_DOWNBEAT),
                                                                ("end", s["end"] > b + ON_DOWNBEAT)) if c]})
    # a window of one section: where the drum stem stops for a bar or more and comes in again inside it, which may be
    # where its parts change (as boundaries in the song's sections they added 2 true ones and 2 false on pdoom)
    drums_ = feats_.get("drums") or song_a.get("drums")
    drum_marks = [{"t": round(t - a, 3), "song": round(t, 3), "drums": k}
                  for t, k in drum_changes(np.asarray(drums_, float), downs, song_a.get("fps") or FPS)
                  if a + ON_DOWNBEAT < t < b - ON_DOWNBEAT] if (
        len(secs_in) == 1 and stems and isinstance(drums_, list) and len(downs) > 2) else []
    # what is left where the drums stop, until they come in again or the window ends: the mix's level against the
    # drummed bar before (rms power), and the share of it where the vocal stem sounds (a line sung over a band stop
    # is not silence), from the song's envelopes
    rms_, fps_d = feats_.get("rms") or song_a.get("rms"), song_a.get("fps") or FPS
    for i, m in enumerate(drum_marks):
        if m["drums"] != "out":
            continue
        t, j = m["song"], nearest(downs, m["song"])
        end_ = next((x["song"] for x in drum_marks[i + 1:] if x["drums"] == "in"), b)
        m.update({"until": round(end_ - a, 3), "bars": round(float(bar_at(end_, downs) - bar_at(t, downs)), 2)})
        if isinstance(rms_, list) and j > 0:
            pw = [float(np.mean(np.square(np.asarray(rms_[int(round(x0 * fps_d)):int(round(x1 * fps_d))], float))))
                  for x0, x1 in ((float(downs[j - 1]), t), (t, end_))]
            m["mixDb"] = round(10 * math.log10(pw[1] / pw[0]), 1) if min(pw) > 0 else None
        if isinstance(vocal_, list):
            v = np.asarray(vocal_[int(round(t * fps_d)):int(round(end_ * fps_d))], float)
            m["voice"] = round(float(np.mean(v > VOICE_ON)), 2) if len(v) else None

    # ---- the window's data
    fps = song_a.get("fps") or FPS
    i0 = math.floor(round(a * fps, 6) + 0.5)
    rec = {"song": song_rel, "songSha256": sha, "from": round(a, 3), "to": round(b, 3), "duration": dur3,
           "samples": [S0, S1], "sampleRate": sr, "fade": round(fade, 3) if fade else None,
           **({"name": stem} if stem != song.stem else {}), "file": win_rel,
           "data": relv(song_dir / "audio.json"), "tool": WINDOW_TOOL, **({"exact": True} if args.exact else {})}

    # ---- cut the audio (the file goes in place only once the data is ready: nothing is half done on a failure)
    seg = y[S0:S1]
    overs = int(np.sum(np.abs(seg) > 1.0))
    w.audio_dir.mkdir(parents=True, exist_ok=True)
    tmp = win_path.with_name(win_path.stem + ".partial.wav")
    try:
        cut = cut_window(song, tmp, y, sr, S0, S1, fade_n, beat, as_float=overs > 0)
        win_a, ainfo = window_audio_doc(song_a, a, b, dur3, i0, rec, win_rel, cut["sha"],
                                        fade_gain if fade_n else None)
        if cut["fade"]:
            cut["fade"]["data"] = {"envelopeFrames": ainfo["fadedFrames"], "onsets": ainfo["fadedOnsets"]}
        errs, _, _ = validate(win_a, cut["seconds"], cut["sha"])
        if errs:
            raise Fail(1, "the window's audio.json fails the engine's checks (nothing written): " + "; ".join(errs))
        win_w, winfo = None, None
        if song_w is not None:
            win_w, winfo = window_words(song_w, a, b, dur3, {**rec, "data": relv(song_dir / "words.json")}, win_rel,
                                        cut["sha"])
        # ---- write: the song's data to data/song/ first (nothing is lost if a later step fails), then the window
        song_dir.mkdir(parents=True, exist_ok=True)
        moved = []
        for k, src in (("audio", audio_src), ("words", words_src)):
            if src == "moved":
                cur, sav = paths[k]
                t_ = sav.with_name(sav.name + ".tmp")
                t_.write_bytes(cur.read_bytes())
                t_.replace(sav)
                moved.append(show(sav))
        os.replace(tmp, win_path)
    finally:
        tmp.unlink(missing_ok=True)  # (already gone once the window is in place)
    out_a = paths["audio"][0]
    t_ = out_a.with_name(out_a.name + ".tmp")
    t_.write_text(dump_doc(win_a), encoding="utf-8", newline="\n")
    t_.replace(out_a)
    back = json.loads(out_a.read_text(encoding="utf-8"))
    errs2, warns2, nchk2 = validate(back, cut["seconds"], cut["sha"])
    if errs2:
        raise Fail(1, f"{out_a} failed validation after writing: " + "; ".join(errs2))
    out_w = None
    if win_w is not None:
        out_w = paths["words"][0]
        t_ = out_w.with_name(out_w.name + ".tmp")
        t_.write_text(json.dumps(win_w, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
        t_.replace(out_w)

    # ---- review image
    review = {}
    if not args.no_plot:
        png = w.review_dir / "window.png"
        window_plot(png, y, sr, song_a, lines, a, b, fade_n / sr if fade_n else None,
                    f"{song.name}: window {a:.3f}-{b:.3f} s = " + (f"{bars:g} bars, " if bars is not None else "")
                    + f"{dur_w:.3f} s -> {win_rel}")
        review["png"] = {"path": str(png), "bytes": png.stat().st_size}
    if not args.no_clicks:  # (the window as the video plays it, fade included, with a click on each of its beats)
        m4a = w.review_dir / "clicks.m4a"
        write_clicks(m4a, load_audio(win_path), back.get("beats") or [], back.get("downbeats") or [])
        review["clicks"] = {"path": str(m4a), "bytes": m4a.stat().st_size, "seconds": probe_duration(m4a)}

    # ---- what video.json still needs
    hints = []
    vjson = w.video_dir / "video.json" if w.video_dir is not None else None
    mix = mix_of(w, win_path) if vjson is not None else None
    if mix:
        hints.append(f"the video plays {show(mix[0])}, mix.py's mix of the window: build it again (mix.py build --video "
                     f"{w.name}) so it holds this cut")
    elif vjson is not None and vjson.is_file():
        vj = video_json(w)
        edits = ([f"\"audio\": \"{win_rel}\""] if [s["file"] for s in plays(w)] != [win_path] else []) + \
                (["no \"duration\""] if vj.get("duration") is not None else [])
        if edits:
            hints.append(f"in {show(vjson)} set " + " and ".join(edits)
                         + ": the video then plays the window and takes its length from it")
    elif vjson is not None:  # (cut before the video was set up: init reads the window from data/audio.json)
        hints.append(f"{show(vjson)} does not exist yet: give it \"audio\": \"{win_rel}\" and no \"duration\" (the "
                     f"code-video skill's init --video {w.name} writes it so)")
    moved = [{"end": k, "from": round(t0, 3), "to": round(t1, 3), "onto": at_text(t1), "tie": tie}
             for k, t0, t1, tie in snapped]
    if ainfo.get("cuesDropped"):
        warnings.append(f"cues outside the window: {', '.join(map(str, ainfo['cuesDropped']))} (audio.cue() throws for "
                        f"them in this video)")
    if ainfo.get("copied"):
        notes.append(f"copied unchanged (fields window does not know, so any times in them are the song's): "
                     f"{', '.join(ainfo['copied'])}")
    if ainfo.get("bpm"):
        notes.append(f"bpm: {ainfo['bpm']}")
    if overs:
        notes.append(f"{overs} samples of the window are over full scale: it is written as 32-bit float WAV so none clip")
    return {
        "ok": True, "command": "window", "project": str(w.project or w.base), "song": str(song), "songFile": song_rel,
        "songDuration": round(song_dur, 3),
        "window": {"from": round(a, 3), "to": round(b, 3), "duration": dur3, "seconds": round(dur_w, 6),
                   "samples": [S0, S1], "sampleRate": sr, "bars": bars, "fade": cut["fade"], "asked": [a_req, b_req],
                   "askedSeconds": round(asked, 3), "moved": moved},
        "start": start, "end": end, "sections": secs_in, "drums": drum_marks,
        "audio": {"path": str(win_path), "file": win_rel, "bytes": win_path.stat().st_size,
                  "format": f"WAV {cut['depth']} {sr} Hz, {y.shape[1]} channel{'s' * (y.shape[1] != 1)}",
                  "matchesSong": {"fromSample": S0, "samples": cut["unfaded"], "maxDifference": cut["maxDifference"]}},
        "data": {"audio.json": {"path": str(out_a), "beats": len(back.get("beats") or []),
                                "downbeats": len(back.get("downbeats") or []),
                                "sections": [s.get("name") for s in back.get("sections") or []],
                                "envelopes": ainfo["envelopes"], "envelopeFrame": i0,
                                "envelopeLength": ainfo["envelopeLength"],
                                "onsets": {k: len(v) for k, v in (back.get("onsets") or {}).items()},
                                "cues": len(back.get("cues") or []),
                                "sectionsLeftOut": ainfo.get("sectionsDropped", [])},
                 "words.json": ({"path": str(out_w), **{k: v for k, v in winfo.items()}} if winfo else None)},
        "songData": {"audio.json": {"path": str(paths["audio"][1]), "how": audio_src},
                     "words.json": ({"path": str(paths["words"][1]), "how": words_src} if words_src else None),
                     "moved": moved},
        "analysis": analysis and {k: analysis.get(k) for k in ("bpm", "mode", "beats", "downbeats", "sections", "review",
                                                               "warnings", "seconds")},
        "checks": {"passed": nchk2 - len(warns2), "of": nchk2, "warnings": warns2},
        "warnings": warnings, "notes": notes, "next": hints, "review": review,
        "seconds": round(time.time() - t_start, 1),
    }


def print_window(r: dict) -> None:
    wd, au = r["window"], r["audio"]

    def sh(p: str) -> str:  # (paths from the project, or the --out folder)
        return rel(Path(p), Path(r["project"]))

    say(f"beats.py window: {Path(r['song']).name} {wd['from']:.3f}-{wd['to']:.3f} s -> {au['file']} ({kb(au['bytes'])}, "
        f"{au['format']})")
    bars = f"{wd['bars']:g} bars, " if wd["bars"] is not None else ""
    m = au["matchesSong"]
    say(f"  window     {bars}{wd['duration']:.3f} s ({wd['samples'][1] - wd['samples'][0]} samples: {wd['samples'][0]}"
        f"-{wd['samples'][1]} of the song at {wd['sampleRate']} Hz); measured against the song from sample "
        f"{m['fromSample']}: {m['samples']} samples within {m['maxDifference']:.2g}"
        + (" (24-bit rounding)" if m["maxDifference"] <= 2 ** -23 + 1e-12 else ""))
    if wd.get("moved"):  # (whole bars: a length asked in seconds is approximate, and the director hears of the change)
        mv = "; ".join(f"the {x['end']} from {x['from']:.3f} s to {x['onto']} ("
                       + ("a half-bar tie: the way that keeps the window no longer than asked" if x["tie"] else
                          "the nearest") + ")" for x in wd["moved"])
        same = abs(wd["duration"] - wd["askedSeconds"]) < 0.0015
        say(f"  moved      {mv}. " + (f"The window keeps the length asked, {bars}{wd['duration']:.3f} s" if same else
                                      f"The window is now {bars}{wd['duration']:.3f} s, not the "
                                      f"{wd['askedSeconds']:.3f} s asked: tell the director the new length")
            + f" (--exact keeps {wd['asked'][0]:g}-{wd['asked'][1]:g} s, off the downbeats)")
    for side_ in ("start", "end"):
        s = r[side_]
        line = f"  {side_:<10} {s.get('summary') or ''}"
        if s.get("sungSummary"):
            line += ("; " if s.get("summary") else "") + f"sung: {s['sungSummary']}"
        if s.get("voiceSummary"):
            line += ("; " if s.get("summary") else "") + f"vocal stem: {s['voiceSummary']}"
        say(line)
    if wd["fade"]:
        f = wd["fade"]
        say(f"  fade       the last {f['seconds']:.3f} s ({f['beats']:g} beats, from {f['from']:.3f} s), {f['curve']} to "
            f"silence; measured: " + ("the song times that ramp, to 24-bit rounding" if f["deviation"] < 1e-6 else
                                      f"within {f['deviation']:.1g} of the song times that ramp")
            + (f"; the data fades with it ({f['data']['envelopeFrames']} envelope frames, {f['data']['onsets']} onsets "
               f"scaled by the same gain)" if f.get("data") and any(f["data"].values()) else ""))
    if r["sections"]:
        def sec(s):
            part = "" if not s["cut"] else (f" ({s['bars']} of its {s['ofBars']} bars)" if s["bars"] is not None
                                            else " (cut)")
            whole = f" ({s['bars']} bar{'s' * (s['bars'] != 1)})" if not s["cut"] and s["bars"] is not None else ""
            return f"{s['name']} {s['start']:.3f}{whole}{part}"
        say(f"  sections   {', '.join(sec(s) for s in r['sections'])} (window time)")
    if r.get("drums"):
        def drums(x):
            if x["drums"] != "out" or x.get("bars") is None:
                return f"{x['drums']} at {x['t']:.3f} s"
            left = ([] if x.get("mixDb") is None else
                    ["the mix as loud as the bar before" if abs(x["mixDb"]) < 0.5 else
                     f"the mix {abs(x['mixDb']):.0f} dB {'under' if x['mixDb'] < 0 else 'over'} the bar before"])
            if x.get("voice") is not None:
                left.append(f"a voice in {x['voice']:.0%} of it" if x["voice"] else "no voice")
            end_ = " to the window's end" if abs(x["until"] - wd["duration"]) < 0.0015 else ""
            return (f"out at {x['t']:.3f} s for {x['bars']:g} bar{'s' * (x['bars'] != 1)}{end_}"
                    + (": " + ", ".join(left) if left else ""))
        say("  drums      " + "; ".join(drums(x) for x in r["drums"])
            + f" (window time; bar by bar on the drum stem; the mix by its rms, a voice where the vocal stem is over "
              f"{VOICE_ON:g}: the window holds one section, and its parts may change at these)")
    da = r["data"]["audio.json"]
    on = ", ".join(f"{k} {v}" for k, v in da["onsets"].items())
    say(f"  data       {sh(da['path'])}: {da['beats']} beats, {da['downbeats']} downbeats, {len(da['sections'])} sections"
        + (f", {da['cues']} cues" if da["cues"] else "") + f"; envelopes {' '.join(da['envelopes']) or 'none'} from the "
        f"song's frame {da['envelopeFrame']}" + (f"; onsets {on}" if on else ""))
    dw = r["data"]["words.json"]
    if dw:
        cut = "; ".join(f"'{c['w']}' ({c['start']:.3f}-{c['end']:.3f} s, kept {c['kept'][0]:.3f}-{c['kept'][1]:.3f})"
                        for c in dw["cut"])
        say(f"             {sh(dw['path'])}: {dw['lines']} of the song's {dw['of']} lines, {dw['words']} words"
            + (f"; cut at an edge: {cut}" if cut else ""))
    sd = r["songData"]
    how = {"moved": "moved there from data/", "kept": "already there", "analyzed": "analyzed now"}
    say(f"  song data  {sh(sd['audio.json']['path'])} ({how[sd['audio.json']['how']]})"
        + (f", {sh(sd['words.json']['path'])} ({how[sd['words.json']['how']]})" if sd["words.json"] else ""))
    an = r.get("analysis")
    if an:
        say(f"  analysis   {an['bpm']} BPM ({an['mode']}), {an['downbeats']} downbeats, sections "
            + ", ".join(f"{s['name']} {s['start']:.1f}" for s in an["sections"]) + (
                f"; beat sheet {sh(an['review']['png']['path'])}" if (an.get("review") or {}).get("png") else ""))
        for x in an.get("warnings") or []:
            say(f"  WARNING    (analysis) {x}")
    ck = r["checks"]
    say(f"  checks     {ck['passed']} of {ck['of']} engine checks pass" + (f"; warnings: {'; '.join(ck['warnings'])}"
                                                                         if ck["warnings"] else ""))
    if r["review"].get("png"):
        p = r["review"]["png"]
        say(f"  review     {sh(p['path'])} ({kb(p['bytes'])}): the window on the song, and each cut up close")
    if r["review"].get("clicks"):
        c = r["review"]["clicks"]
        say(f"  {'           ' if r['review'].get('png') else 'review     '}{sh(c['path'])} ({kb(c['bytes'])}, "
            f"{c['seconds'] or 0:.1f} s): the window with a click on every beat, higher on downbeats (video time)")
    for x in r["notes"]:
        say(f"  note       {x}")
    for x in r["warnings"]:
        say(f"  WARNING    {x}")
    for h in r["next"]:
        say(f"  next: {h}")


# ---------------------------------------------------------------------------------------------
# CLI


EX_TOP = """examples:
  uv run scripts/beats.py videos/launch/audio/track.mp3            (beats, bars, sections -> its data/audio.json)
  uv run scripts/beats.py grid --bpm 96 --duration 30 --video promo
  uv run scripts/beats.py check --video launch
  uv run scripts/beats.py window --video teaser --from 22.055 --to 51.144
Each subcommand has its own --help with more examples.
exit codes: 0 ok, 1 error (or check found errors), 2 bad usage
"""
EX_ANALYZE = """examples:
  uv run scripts/beats.py videos/launch/audio/track.mp3            (inside a project: writes videos/launch/data/)
  uv run scripts/beats.py song.mp3 --video clip --clicks           (+ out/clip/clicks.m4a, an ear check)
  uv run scripts/beats.py song.mp3 --video clip --stems            (Demucs stems: vocal/drums/bass/other, snare,
                                                                    hat, vocal onsets, pitchMidi)
  uv run scripts/beats.py song.mp3 --out .                         (no project: ./data/audio.json, ./out/beats.png)
  uv run scripts/beats.py song.mp3 --video clip --sections "intro:0,verse:12.4,chorus:41.8"
  uv run scripts/beats.py song.mp3 --tracker librosa               (no model download; weaker downbeats)
--sections takes start times, the first at 0, kept exactly as given (the composed music's plan
times stay where the music changes); --snap-sections moves each to the nearest downbeat instead
(times typed by ear on the user's song). Re-running keeps the sections set by hand (--sections
auto recomputes them). The video's data/words.json, when it holds the song's lyrics, marks
choruses by repeated lines (a narration's words.json is not used).
"""
EX_GRID = """examples:
  uv run scripts/beats.py grid --bpm 96 --duration 30 --video promo
  uv run scripts/beats.py grid --bpm 96 --audio videos/promo/audio/cue.wav --video promo \\
      --sections "calm:0,build:8,hit:20,resolve:21" --cue hit=20
  uv run scripts/beats.py grid --bpm 120 --duration 17 --offset 0.5 --meter 3 --out .
--offset is the first downbeat (s); beats before it are a pickup. Sections (start times, the first
at 0) are kept where declared; cues are named hit points (the engine's audio.cue('hit')). --audio
adds the measured envelopes (rms low mid high) and the duration, and compares the declared grid
and cues with the audio's own attacks (a wrong --bpm or --offset is reported).
"""
EX_CHECK = """examples:
  uv run scripts/beats.py check videos/launch/data/audio.json --audio videos/launch/audio/track.mp3
  uv run scripts/beats.py check --video launch
With --video it compares the file with the audio it was made from (its audioFile) and says how
that stands to what the video plays (a mix that holds this music from 0 s is the same timeline).
"""
EX_WINDOW = """examples:
  uv run scripts/beats.py window --video teaser --from 22.055 --to 51.144
  uv run scripts/beats.py window videos/teaser/audio/song.mp3 --from 22 --to 52 --fade 1.818
  uv run scripts/beats.py window --video teaser --from 94.783 --to 124.783 --exact
--from and --to are song times; the window holds [from, to). The window is whole bars: an end between
downbeats moves to the nearest one (on a half-bar tie, the way that keeps the window no longer than
asked), and the new length is printed, to tell the director; --exact keeps the times as given. A
start on the beat before a sung pickup, and the song's own start and end, stay. From the whole song's
data (data/audio.json and data/words.json while they describe the song, which move to data/song/;
else data/song/; else the song is analyzed into data/song/ first) it writes, in video time:
  audio/<stem>-window.wav   the song's samples from round(from x rate) to round(to x rate), 24-bit
                            WAV at the song's rate (32-bit float when samples go over full scale);
                            atrim by sample count: no seek, so no offset and no lost first samples;
                            --fade ramps it linearly to silence over its last seconds
  data/audio.json           every time minus --from, keeping what falls inside (beats, downbeats,
                            onsets, cues), sections clipped, envelopes from frame round(from x fps),
                            duration the window's; a "window" record of where it came from; over a
                            --fade the loudness envelopes and onset strengths fade with the audio
  data/words.json           lines, words and syllables inside; a word cut by an edge keeps its part
  out/<video>/clicks.m4a    the window with a click on every beat, higher on downbeats, to hear the
                            grid with the brief (--no-clicks skips it); window.png beside it
Before cutting it checks the window on the music and warns, with the fix: an end left off the
downbeats by --exact, how many bars, the sections it holds, and a word, held note or line that an
edge cuts, naming starts or ends within 4 bars where nothing is sung (or the fade, when there are
none). Without words.json, a song analyzed with --stems is checked on its vocal stem instead: a
voice sounding across an end is reported, with the nearest downbeats where the stem is quiet; and
when the window holds one section, the bars where the drum stem stops and comes in are listed. It
ends with the video.json edit to make (next:). Run it again for another window: it starts from
data/song/. To analyze the song with other options (--stems, --sections), run beats.py on the song
first, then window: the new analysis moves to data/song/ (sections set by hand there are kept).
The window file itself is not analyzed: its data comes from the song's.
"""


class UsageError(Exception):
    pass


class Parser(argparse.ArgumentParser):
    """argparse that raises on a usage error instead of exiting, so --json can report it as JSON too."""

    def error(self, message: str):
        raise UsageError(f"{self.format_usage().rstrip()}\n{self.prog}: error: {message}")


def make_parser() -> Parser:
    doc = __doc__.split("\n\n")
    p = Parser(prog="beats.py", description=doc[0] + "\n\n" + doc[1],
               formatter_class=argparse.RawDescriptionHelpFormatter, epilog=EX_TOP)
    sub = p.add_subparsers(dest="cmd", required=True)
    an = sub.add_parser("analyze", help="analyze a song (the default command)",
                        description="Beats, downbeats, sections, envelopes and onsets of a song -> data/audio.json, "
                                    "plus out/<video>/beats.png. Run as `beats.py SONG ...` or `beats.py analyze SONG ...`.",
                        epilog=EX_ANALYZE, formatter_class=argparse.RawDescriptionHelpFormatter)
    an.add_argument("audio", nargs="?", help="the song (any format ffmpeg reads); default with --video: the "
                                             "audio its video.json names")
    an.add_argument("--video", help="video name in this audara project (writes videos/<video>/data/audio.json; an "
                                    "audio file inside videos/<video>/ names it by itself)")
    an.add_argument("--out", help="without a project: folder that gets data/audio.json and out/ (default .)")
    an.add_argument("--tracker", choices=("beat-this", "librosa"), default="beat-this",
                    help="beat-this (default: neural beats and downbeats, CPU, 77 MB model cached once) or "
                         "librosa (no model; downbeats from chord changes, one bar phase for the piece)")
    an.add_argument("--checkpoint", default="final0", help="Beat This! checkpoint: final0 (default, 77 MB) or "
                                                           "small0 (8 MB, less robust), or a .ckpt file")
    an.add_argument("--stems", action="store_true", help="separate stems with Demucs htdemucs (80 MB model, about "
                                                         "half a minute per song on CPU, cached) for vocal/drums/"
                                                         "bass/other envelopes, snare/hat/vocal onsets and pitchMidi")
    an.add_argument("--words", help="words.json (the engine's format) whose repeated lines mark choruses "
                                    "(default with --video: videos/<video>/data/words.json when it is this song's)")
    an.add_argument("--sections", help="name:start,... in seconds, the first at 0, to set the sections by hand "
                                       "(kept exactly), or auto")
    an.add_argument("--snap-sections", action="store_true", help="move each --sections start to the nearest "
                                                                 "downbeat (for times typed by ear)")
    an.add_argument("--meter", type=int, help="beats per bar (default: from the tracker's downbeats, else 4)")
    an.add_argument("--first-downbeat", type=float, help="time (s) of a beat that starts a bar: one bar phase "
                                                         "for the whole piece, overriding the tracker")
    an.add_argument("--tempo-hint", type=float, help="the tempo you hear (BPM): doubles or halves the tracker's "
                                                     "beats to that metrical level")
    an.add_argument("--clicks", action="store_true", help="also write out/<video>/clicks.m4a: the song with a click "
                                                          "on every beat (higher on downbeats), about 0.7 MB a minute")
    an.add_argument("--no-plot", action="store_true", help="skip out/<video>/beats.png")
    an.add_argument("--json", action="store_true", help="print the result as JSON instead of the summary")
    g = sub.add_parser("grid", help="write a declared grid (procedural music, a composed cue): no analysis",
                       description="Write audio.json for audio whose structure is known by construction: beats at "
                                   "--bpm from --offset, bars of --meter beats, declared sections and named cues.",
                       epilog=EX_GRID, formatter_class=argparse.RawDescriptionHelpFormatter)
    g.add_argument("--bpm", type=float, required=True, help="tempo (BPM)")
    g.add_argument("--duration", type=float, help="length (s); default: the --audio file's")
    g.add_argument("--offset", type=float, default=0.0, help="time of the first downbeat (s, default 0)")
    g.add_argument("--meter", type=int, default=4, help="beats per bar (default 4)")
    g.add_argument("--sections", help="name:start,... e.g. \"calm:0,build:8,hit:20,resolve:21\" (the first at 0; "
                                      "default: one section 'all')")
    g.add_argument("--cue", action="append", help="a named hit point, name=seconds (repeatable): --cue hit=20")
    g.add_argument("--audio", help="the audio: measures its envelopes and length, and checks the grid against it")
    g.add_argument("--video", help="video name in this audara project")
    g.add_argument("--out", help="without a project: folder that gets data/audio.json (default .)")
    g.add_argument("--json", action="store_true", help="print the result as JSON")
    c = sub.add_parser("check", help="validate an audio.json the way the engine reads it",
                       description="Validate an audio.json against the engine's reader and pdoom-video's invariants "
                                   "(and, with its audio, the duration and audioSha256).",
                       epilog=EX_CHECK, formatter_class=argparse.RawDescriptionHelpFormatter)
    c.add_argument("file", nargs="?", help="the audio.json (default with --video: videos/<video>/data/audio.json)")
    c.add_argument("--audio", help="the audio it describes (checks duration and audioSha256)")
    c.add_argument("--video", help="video name in this audara project")
    c.add_argument("--json", action="store_true", help="print the result as JSON")
    wn = sub.add_parser("window", help="a part of the song as the video's own audio and data (a video shorter "
                                       "than its song)",
                        description="Cut [--from, --to) of the song, to the sample, as audio/<stem>-window.wav, and "
                                    "write its data/audio.json and data/words.json in video time from the whole "
                                    "song's, kept in data/song/. Checks the window on the music first.",
                        epilog=EX_WINDOW, formatter_class=argparse.RawDescriptionHelpFormatter)
    wn.add_argument("song", nargs="?", help="the song (default: the one the video's data names, else the file "
                                            "video.json plays)")
    wn.add_argument("--from", dest="start", type=float, required=True, metavar="SECONDS",
                    help="start, in song time: a downbeat, or the beat before a sung pickup (else it moves to the "
                         "nearest downbeat)")
    wn.add_argument("--to", dest="end", type=float, required=True, metavar="SECONDS",
                    help="end, in song time: a downbeat (the window holds the bars before it), or the song's end (else "
                         "it moves to the nearest downbeat)")
    wn.add_argument("--fade", type=float, metavar="SECONDS", help="fade out over the window's last seconds, "
                                                                  "landing at --to (a bar's length fades the last bar)")
    wn.add_argument("--name", help="the window file's stem: audio/<stem>-window.wav (default: the song's)")
    ends = wn.add_mutually_exclusive_group()
    ends.add_argument("--exact", action="store_true", help="keep --from and --to where given, off the downbeats too "
                                                           "(by default an end between downbeats moves to the nearest)")
    ends.add_argument("--snap", action="store_true", help="move --from and --to to the nearest downbeats: the default "
                                                          "now, kept for older commands")
    wn.add_argument("--video", help="video name in this audara project")
    wn.add_argument("--out", help="without a project: folder with audio/ and data/ (default .)")
    wn.add_argument("--tracker", choices=("beat-this", "librosa"), default="beat-this",
                    help="the tracker for the song's analysis, when it has none yet (as in analyze)")
    wn.add_argument("--no-plot", action="store_true", help="skip out/<video>/window.png")
    wn.add_argument("--no-clicks", action="store_true", help="skip out/<video>/clicks.m4a: the window with a click on "
                                                             "every beat (higher on downbeats), in video time")
    wn.add_argument("--json", action="store_true", help="print the result as JSON")
    return p


def main(argv: list[str] | None = None) -> int:
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] not in ("analyze", "grid", "check", "window", "-h", "--help"):
        argv.insert(0, "analyze")  # analyze is the default command
    p = make_parser()
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
        if args.cmd == "analyze":
            if args.meter is not None and not 1 <= args.meter <= 16:
                raise Fail(2, "--meter must be between 1 and 16")
            if args.tempo_hint is not None and not 20 <= args.tempo_hint <= 400:
                raise Fail(2, "--tempo-hint must be a tempo in BPM (20-400)")
            r = run_analyze(args)
            print(json.dumps(r, ensure_ascii=False, indent=1)) if args.json else print_analyze(r)
        elif args.cmd == "grid":
            r = run_grid(args)
            print(json.dumps(r, ensure_ascii=False, indent=1)) if args.json else print_grid(r)
        elif args.cmd == "window":
            r = run_window(args)
            print(json.dumps(r, ensure_ascii=False, indent=1)) if args.json else print_window(r)
        else:
            r = run_check(args)
            print(json.dumps(r, ensure_ascii=False, indent=1)) if args.json else print_check(r)
            return 0 if r["ok"] else 1
        return 0
    except Fail as e:
        code, err = e.code, str(e)
    except KeyboardInterrupt:
        code, err = 1, "interrupted"
    except Exception as e:  # a bug, not a usage problem: say where, briefly
        import traceback
        tb = traceback.extract_tb(e.__traceback__)[-1]
        code, err = 1, f"unexpected {type(e).__name__}: {e} (beats.py line {tb.lineno}, in {tb.name})"
        long_ = str(getattr(e, "filename", None) or "")
        if sys.platform == "win32" and len(long_) > 259 and not long_.startswith("\\\\?\\") and not long_paths_on():
            err += (f". That path is {len(long_)} characters, past the 260 Windows allows while long paths are off: "
                    f"set UV_CACHE_DIR and AUDARA_CACHE to short folders (such as C:\\uvc), or enable long paths "
                    f"(LongPathsEnabled = 1, an admin setting), then run again")
    note(f"beats.py {args.cmd}: {err}")
    if getattr(args, "json", False):
        print(json.dumps({"ok": False, "command": args.cmd, "error": err, "exit": code}, ensure_ascii=False))
    return code


if __name__ == "__main__":
    sys.exit(main())
