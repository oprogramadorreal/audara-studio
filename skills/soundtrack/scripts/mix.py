# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "numpy>=2.0,<3",
#     "scipy>=1.13,<2",
#     "soundfile>=0.12,<1",
#     "matplotlib>=3.8,<4",
# ]
# ///
"""Assemble and measure the soundtrack of an audara video.

  build    Mix narration, music and sound effects from a small JSON plan into videos/<video>/audio/mix.wav,
           always with music-only.wav beside it (the music exactly as it sits in the mix) and a record of the
           plan (mix.wav.request.json), normalized to a delivery loudness. Effects land by their measured onset
           and get their level inside their own frequency band against the music. Every placement and level
           it prints is measured on the output. An unchanged plan is not rebuilt; a changed one keeps the
           previous round in out/<video>/mix-rounds/ for A/B and prints what changed.
  measure  What a listener hears in any audio file: integrated loudness, loudness range, true peak,
           short-term (3 s) and momentary (400 ms) K-weighted loudness, loudness per section and the rise
           between sections, each hit's measured onset, its contrast with the 4 s before it and the build into
           it, at full range and through a phone-like 300 Hz high-pass, the first sound and dead tails. Writes a
           loudness-curve PNG and a JSON. Reports, not gates: a weak hit or a flat build is a warning.

Run it through uv (no pip):
  uv run <skill>/scripts/mix.py build --video launch
  uv run <skill>/scripts/mix.py measure videos/launch/audio/mix.wav --sections videos/launch/data/audio.json --hit 20

Files: with --video <video>, inside an audara project (the nearest folder above with videos/): the plan is
videos/<video>/mix.json, the mix goes to videos/<video>/audio/, review files to out/<video>/; a plan or an audio
file inside videos/<video>/ names its video by itself. Without a project: --out DIR (default: the current
folder) gets DIR/audio/ and DIR/out/, and timing data is read from DIR/data/. Inside a project, build needs its
video.

Length: the plan's "duration", else video.json's when it already plays a soundtrack, else the end of what
sounds (the voice's last sound + 0.5 s, the music's end, the last effect). Cutting voice that still sounds is an
error unless the plan's "duration" asks for it.

Loudness: a mono file plays on both channels at full level (dual mono), as a browser plays it and as eleven.py
measures it; sample and true peaks are the file's own.

Time origin: t = 0 is the first sample of ffmpeg's gapless decode (the encoder delay removed), which is what browsers
and ffmpeg play. The times are never shifted: a player that keeps the encoder delay plays every sound later, so it
gets a WAV of that decode instead (mix.wav and music-only.wav are WAVs already).

Exit codes: 0 ok, 1 error (ffmpeg missing, a file can't be decoded or written), 2 bad usage (the command
line or the plan is wrong: the message says what to fix). mix.py spends nothing, so it never exits 3 (missing
API key) or 4 (needs --yes to spend), the codes the ElevenLabs script uses. With --json every exit prints one
JSON object.
"""

from __future__ import annotations

import argparse
import datetime as dt
import difflib
import hashlib
import json
import math
import os
import re
import shutil
import stat
import subprocess
import sys
import time
import unicodedata
from dataclasses import dataclass
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
from scipy import signal  # noqa: E402
from scipy.ndimage import maximum_filter1d, minimum_filter1d, uniform_filter1d  # noqa: E402

# ------------------------------------------------------------------------------------------------ constants

SR = 48_000
# scripts/render.ts muxes the soundtrack at 48 kHz stereo and ElevenLabs music v2 arrives at 48 kHz, so the mix
# is made at the delivery rate: nothing is resampled after it, and a time measured here is a time in the MP4.
BLK = SR // 1000
# 1 ms analysis blocks (48 samples): fine enough for 400 ms windows, section edges and hit windows, and small in
# memory even for a 10-minute narration (600k blocks).
MIX_VERSION = 2
# Bump when a change in this file changes the audio a plan produces: every up-to-date mix then rebuilds once.
# (2: a mono file plays on both channels at full level; the music rises between a narration's paragraphs.)

TIME_ORIGIN = ("Time: t = 0 is the first sample of mix.wav and music-only.wav, as browsers and ffmpeg play them (PCM: "
               "no encoder delay): never shift these times; no offset is needed. Each input went in through ffmpeg's "
               "gapless decode (its encoder delay removed, as browsers play it), so times measured on an input hold in "
               "the mix, moved only by where the plan places it.")
# The build's note (mix-report.json and the record); measure writes time_note() of the file it measures.

# Delivery loudness (integrated, BS.1770 / EBU R128) by kind of piece. Streaming platforms (YouTube, Spotify)
# play everything at about -14 LUFS: louder uploads are turned down, quieter ones mostly stay quiet. A punchy
# piece delivered at -14 plays as mixed, as loud as its neighbours. A calm one (narration, ambient) sits better
# 2 dB lower, with more headroom for its transients. motion-video-kit's two client-approved mixes landed far
# quieter (-19 and -30 LUFS): clients judged the balance, not the loudness. So these are defaults: "loudness"
# in the plan overrides them, and the measured value is always reported.
LOUDNESS = {"punchy": -14.0, "calm": -16.0}
DEFAULT_KIND = "calm"  # the quieter default: a mix that is too quiet is fixed by one number, a squashed one is not
TRUE_PEAK = -1.0
# dBTP ceiling (EBU R128 and streaming delivery specs): lossy encoders (AAC in the MP4, every platform's
# re-encode) add inter-sample peaks, so a master at 0 dBTP clips once decoded.
TP_MARGIN = 0.1
# The limiter aims 0.1 dB under the ceiling: its 4x estimate and ffmpeg's true-peak meter (which the report
# quotes) differ by up to about that much. The written file is measured and limited again if it is still over.
MAX_LIMIT_DB = 4.0
# Most gain reduction the peak limiter may apply to reach the loudness target. Past ~3-4 dB a limiter audibly
# dulls hits (the S3 Claude baseline pushed its hit 3 dB into a limiter, triggered by a sub boom, which turned
# the chord and crash down): beyond this the mix stays under the target and says so ("max_limit_db" raises it).
TP_OVERSAMPLE = 4  # BS.1770-4 Annex 2: 4x oversampling estimates the true peak of a 48 kHz signal
LIM_LOOKAHEAD = 0.003
# The limiter's gain reaches its floor exactly at the peak, ramping there over 3 ms: long enough not to click,
# short enough not to soften the attack audibly.
LIM_RELEASE = 0.08
# Release time constant: a 50 Hz cycle lasts 20 ms, so a faster release would distort bass; a slower one would
# hold the beat after a hit down (pumping).
FADE_IN, FADE_OUT = 0.005, 0.01
# Master fades: a full-level first sample clicks (motion-video-kit: "a 5 ms fade-in"), and ending on digital
# zero keeps the player from clicking when it stops. Longer, musical fades are "fade_in"/"fade_out" in the plan.
ANTICLICK = 0.01
# Any file cut short (music "from"/"dur", or trimmed by the video's end) gets 10 ms raised-cosine edges: too short
# to hear as a fade, long enough to remove the click of a cut waveform.
END_PAD = 0.5
# With no music and no "duration", the mix ends 0.5 s after the last voice or effect sound (its last sample over
# -60 dBFS, so a file's trailing silence doesn't lengthen the mix): room for a ring-out.
SHORT_LU = 0.25
# "Short of the target" is only said past a quarter LU: below that nobody hears it, and ffmpeg prints 0.1 LU steps.

# Ducking: the music under the voice.
UNDER_VOICE_LU = 12.0
# Default music level while the voice speaks, in LU under the voice (K-weighted, both measured over the voice's
# active frames). Speech stays clear with the background about 10 dB or more under it, also for older listeners
# and phone speakers; 12 leaves a little margin. "gain_db" on the music sets its level directly instead.
DUCK_DEPTH_DB = 6.0
# How far the music comes up when the voice pauses: pdoom-video's approved explainer mix had its track rise 6 dB
# in the narration's pauses.
DUCK_ATTACK = 0.15
# Look-ahead: the music is already down when the first syllable starts (offline, the onset is known), so no
# onset is masked; 150 ms is too short to hear as anticipation.
DUCK_HOLD = 0.4
# Inside a paragraph the music stays down through pauses shorter than this: longer than most pauses between
# sentences (0.15-0.4 s in the S1 baselines' voices), so it doesn't pump. A paragraph break is not acoustically
# longer than a sentence break (pdoom-video's narration: 0.31-0.98 s between blocks, gaps inside blocks up to
# 0.68 s), so a pause length can't tell them apart: where data/words.json is this voice's narration (one line
# per paragraph, as eleven.py writes it), the music rises in every gap between lines instead.
DUCK_BLOCK_HOLD = 0.05
# Between paragraphs the music starts to rise 50 ms after the last word's measured end (its release), and is
# back down DUCK_ATTACK before the next paragraph: in eleven.py's 0.6 s gaps it swells about 3 dB, a breath, as
# pdoom-video's approved mix had its track come up in the narration's pauses.
DUCK_RELEASE = 0.6
# A slow return reads as the music swelling into the pause instead of snapping back.
VAD_WINDOW = 0.05  # 50 ms RMS frames every 10 ms: syllable resolution
VAD_REL_DB = 30.0
# A frame is speech when it is within 30 dB of the voice's loud frames (their 95th percentile): syllables sit
# within ~30 dB of the loudest ones, breaths and room tone below.
PAUSE_MEASURE_S = 1.0
# Music "in the pauses" is measured only where the duck has fully released for at least 1 s, so the number is the
# music's level between blocks, not a release ramp.

# Effects.
FX_TARGET_DB = 3.5
# In-band lift of (music + effect) over the music alone, in each effect's own band (loudest 50 ms), as
# motion-video-kit measured it against a music-only render: "+3-4 dB" was its client-approved range, its approved
# whooshes sat at +2-3. Checkable on the outputs by comparing mix.wav with music-only.wav.
FX_HF_CAP_DB = 4.0
# Cap on the lift in the ear-sensitive 2-8 kHz band (motion-video-kit): ticks that spiked 10+ dB there read as
# annoying even when their full-band level was modest.
FX_PEAK_CAP_DB = 6.0
# An effect's sample peak may sit at most this far over the music's local peak (motion-video-kit's PKCAP, after a
# client found louder effects "too loud"); 8 suits a signature hit ("peak_cap_db" per effect).
FX_FLOOR_DB = 20.0
# Over a dead stop, a sparse intro, or music with nothing in the effect's band (a tick over pads, a thump under
# strings), "+3.5 dB over the music in its band" would leave the effect inaudible: the solver's known collapse. So
# the music's in-band level (and its 2-8 kHz level) counts as at least its typical full-band level minus 20 dB (75th
# percentile of its 50 ms powers within +-10 s): motion-video-kit's fixed -50 dBFS in-band floor sat about 20 dB
# under its -30 LUFS music, and a floor relative to the music works at any input level.
FX_PEAK_FLOOR_DB = 8.0
# The peak cap counts the music's local peak as at least its typical 50 ms sample peak minus 8 dB, so over a dead
# stop an effect may peak up to 2 dB under the music's typical peaks (with the default 6 dB cap).
FX_CONTEXT_S = 10.0
FX_WINDOW = 0.4  # analysis window from the onset (motion-video-kit's offline mixer), at least one 50 ms window
FX_PEAK_WIN, FX_PEAK_HOP = 0.05, 0.025  # "loudest 50 ms": 50 ms windows, 25 ms hop
FX_PAD = 0.5  # filter pre-roll around the window; the music is zero-padded, so effects in the first 0.5 s align too
FX_GAIN_MIN, FX_GAIN_MAX, FX_GAIN_STEP = -60.0, 24.0, 0.05
# Gains searched in 0.05 dB steps. An effect still under its target at +24 dB is reported as unreachable and
# placed at +24 dB, never muted (motion-video-kit's solve-sfx-gains.py returned its starting 0.005 there).
FX_CLUSTER_S, FX_CLUSTER_GAIN = 0.15, 0.6
# Effects starting within 150 ms of an earlier one are softened x0.6 (-4.4 dB) so they don't stack
# (motion-video-kit audio rule 3).
ONSET_REL_DB = -30.0
# An effect's onset is its first sample within 30 dB of its peak: a lead-in of silence or faint noise is skipped
# (a 33 ms lead-in placed by the file start made every hit two frames late at 60 fps)...
ONSET_GUARD_DB, ONSET_GUARD_S = -24.0, 0.005
# ...provided the next 5 ms reach within 24 dB of the peak, so a lone click in the lead-in doesn't count.
PEAK_RMS_S = 0.01  # an effect's loudest moment ("align": "peak", for whooshes into a cut): 10 ms RMS maximum

# Measuring.
PHONE_HP_HZ = 300  # a phone speaker reproduces little below ~300 Hz: a 4th-order Butterworth high-pass stands in
HIT_BEFORE_S = 4.0  # a hit is compared with the loudest 400 ms in the 4 s before it...
HIT_AFTER_S = 0.6   # ...using the loudest 400 ms window inside [hit - 10 ms, hit + 0.6 s]
HIT_LU = 3.0
# A hit is a moment meant to land louder than the 4 s before it: under 3 LU of contrast, at full range or through the
# phone high-pass, it doesn't stand out (the S3 eval's bar) and the report warns. "hit_lu" in the plan or measure
# --hit-lu sets another bar; 0 turns the warning off.
BUILD_LU = 5.0
# The build into a hit: the stretch leading into it against the opening. Under 5 LU a build reads as flat (the S3
# eval's bar; the Codex run's +3.7 LU did) and the report warns. "build_lu" or --build-lu, as for hits.
BUILD_LEAD_S, BUILD_GAP_S = 8.0, 0.2
# The stretch leading into a hit at t is [t - 8, t - 0.2]: its last 200 ms, where a breath or a drop before the hit
# sits, is left out...
BUILD_OPEN_S, BUILD_OPEN_FRAC = 8.0, 2.5
# ...and the opening is [0, min(8, t / 2.5)]. From t = 13.3 s on the two don't overlap and each lasts 5.3 s or more;
# an earlier hit, or a silent stretch (under BS.1770's -70 LUFS gate), gets no build check.
PHONE_LOW_LU = 1.5
# A build that stays under the bar through the phone high-pass while its full-range figure is 1.5 LU or more higher
# is carried by the low end, which a phone doesn't play: the S3 Claude run built +5.7 LU at full range and +3.6 LU
# through this high-pass, with 68% of the build's energy under 150 Hz (kick and bass).
ONSET_SEARCH_S = 0.5  # a hit's attack is looked for within 0.5 s of its time
ARRIVAL_AFTER_S, ARRIVAL_BEFORE_S = 0.05, 0.03
# The hit's arrival is the step where the 50 ms after it gain the most K-weighted power over the 30 ms before: the
# loudest arrival, so a quiet bass note out of a gap doesn't win over the kick on top of it...
ARRIVAL_FAR_WEIGHT = 0.5
# ...with each gain weighted down linearly from the asked time to half at 0.5 s from it: a beat before or after the
# hit, about as loud as it (the drop's next beat), would otherwise win as often as not and read as the hit landing
# 0.45 s off (unweighted, the 87 downbeats of a 132 BPM song asked as hits read as the next or previous beat in 64)...
ATTACK_BACK_S, ATTACK_AFTER_S, ATTACK_BEFORE_S = 0.05, 0.01, 0.03
# ...and its attack starts at the step, within the 50 ms up to that one, where the next 10 ms rise most in dB over the
# 30 ms before: a rolled chord starts at its first note, not where it is fullest...
LEAD_IN_DB = 40.0
# ...counting what sits more than 40 dB under the arrival as silence, so a faint lead-in after digital silence (an
# effect's first milliseconds of noise over a dead stop) doesn't read as the attack.
SHARP_DB = 3.0
# An arrival that rises under 3 dB (the 50 ms after against the 30 ms before) is a swell: no attack to time.
DEAD_DBFS = -40.0
# Under -40 dBFS sample peak, a video's audio reads as silence on most speakers: "dead tail" is the time at the end
# that stays under it, "first sound" the first sample over it.
NOTE_DEAD_S = 1.0
# A ring-out or a fade to silence sits under -40 dBFS for well under a second; a second or more under an end card
# reads as the music dying early (motion-video-kit: reject early decay; the Codex S3 baseline: 1.05 s).
QUIET_INTRO_LU = 20.0
# The intro is near silent until the momentary loudness first comes within 20 LU of the integrated: twice
# BS.1770's -10 LU relative gate, under which blocks don't count as programme. Calm openings in the S3 baselines
# sat 2-6 LU under.
SYNC_TOL_S = 0.05
# A words.json line whose first word starts more than 50 ms from the voice's measured onset is flagged (the S1
# eval's tolerance: 1.5 frames at 30 fps).
ROUNDS_KEPT = 10
# Previous rounds kept in out/<video>/mix-rounds/ (FLAC, lossless): enough to A/B the last few notes without
# filling the disk (a minute of 48 kHz/24-bit stereo is ~17 MB as WAV, roughly half as FLAC).

# BS.1770-4 K-weighting at 48 kHz, coefficients from the standard: the high shelf (head effect), then the RLB
# high-pass.
K_SOS = np.array([
    [1.53512485958697, -2.69169618940638, 1.19839281085285, 1.0, -1.69065929318241, 0.73248077421585],
    [1.0, -2.0, 1.0, 1.0, -1.99004745483398, 0.99007225036621],
])
PHONE_SOS = signal.butter(4, PHONE_HP_HZ, "highpass", fs=SR, output="sos")
HF_SOS = signal.butter(4, [2000, 8000], "bandpass", fs=SR, output="sos")
SILENT = -120.0  # the dB / LUFS value reported for digital silence

EXIT_OK, EXIT_ERROR, EXIT_USAGE = 0, 1, 2
USAGE = EXIT_USAGE  # (the name the code shared with the other scripts raises)


class Fail(Exception):
    def __init__(self, code: int, msg: str):
        super().__init__(msg)
        self.code = code


def usage(msg: str) -> Fail:
    return Fail(EXIT_USAGE, msg)


def failure(msg: str) -> Fail:
    return Fail(EXIT_ERROR, msg)


# ------------------------------------------------------------------------------------------------ small helpers

def note(msg: str) -> None:
    """Progress and diagnostics go to stderr, so stdout stays the summary (or the JSON with --json)."""
    print(msg, file=sys.stderr, flush=True)


def dbv(x: float) -> float:
    return 20 * math.log10(x) if x > 0 else SILENT


def dbp(x: float) -> float:
    return 10 * math.log10(x) if x > 0 else SILENT


def to_lufs(ms: float) -> float:
    return max(SILENT, -0.691 + 10 * math.log10(ms)) if ms > 1e-15 else SILENT


def lufs_arr(ms: np.ndarray) -> np.ndarray:
    return np.maximum(SILENT, -0.691 + 10 * np.log10(np.maximum(ms, 1e-15)))


def r(x, nd=1):
    if x is None:
        return None
    x = float(x)
    return (round(x, nd) + 0.0) if math.isfinite(x) else None  # (+ 0.0 turns -0.0 into 0.0)


def clean(o):
    """JSON-safe: numpy scalars to Python, non-finite numbers to null."""
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return float(o) if math.isfinite(float(o)) else None
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, np.bool_):
        return bool(o)
    if isinstance(o, Path):
        return o.as_posix()
    return o


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def relpath(p: Path, root: Path | None) -> str:
    p = Path(p).resolve()
    for base in (root, Path.cwd()):
        if base is None:
            continue
        try:
            return p.relative_to(Path(base).resolve()).as_posix()
        except ValueError:
            pass
    return p.as_posix()


TIME_RE = re.compile(r"\s*(?:(\d+):)?(\d+(?:\.\d*)?)\s*")


def parse_time(v, where: str) -> float:
    """A time in seconds (12.5) or m:ss (0:12.5), as a director writes it."""
    if isinstance(v, bool) or v is None or not isinstance(v, (int, float, str)):
        raise usage(f"{where}: expected a time in seconds (12.5) or m:ss (\"0:12.5\"), got {json.dumps(v)}")
    if isinstance(v, str):
        m = TIME_RE.fullmatch(v)
        if not m:
            raise usage(f"{where}: {v!r} is not a time; write seconds (12.5) or m:ss (\"0:12.5\")")
        t = int(m.group(1) or 0) * 60 + float(m.group(2))
    else:
        t = float(v)
    if not math.isfinite(t) or t < 0:
        raise usage(f"{where}: a time must be a finite number >= 0, got {json.dumps(v)}")
    return t


def load_json(path: Path, what: str):
    try:
        txt = Path(path).read_text(encoding="utf-8-sig")  # tolerate a BOM on read; never write one
    except FileNotFoundError:
        raise usage(f"{what}: {relpath(path, None)} does not exist")
    except OSError as e:
        raise failure(f"cannot read {relpath(path, None)}: {e}")
    try:
        return json.loads(txt)
    except json.JSONDecodeError as e:
        raise usage(f"{relpath(path, None)}: not valid JSON (line {e.lineno}, column {e.colno}: {e.msg})")


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".part")
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:  # UTF-8 without BOM
        json.dump(clean(obj), f, indent=1, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)


# ------------------------------------------------------------------------------------------------ places

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


def mpl_cache(w: Where) -> Path | None:
    """matplotlib's font cache, the only cache mix.py writes, goes into the audara cache (cache_root). Returns
    the cache's folder when it is inside the project (its size is reported), else None."""
    if os.environ.get("MPLCONFIGDIR"):
        return None
    root, inside = cache_root(w)
    d = root / "matplotlib"
    d.mkdir(parents=True, exist_ok=True)
    os.environ["MPLCONFIGDIR"] = str(d)
    return root if inside else None


def cache_size_note(root: Path | None, w: Where) -> str | None:
    if root is None:
        return None
    size = folder_bytes(root)
    env = os.environ.get("UV_CACHE_DIR", "").strip()  # uv's cache inside this one (.audara-cache/uv): its note follows
    with_uv = bool(env) and Path(env).resolve().is_dir() and Path(env).resolve().is_relative_to(root.resolve())
    why = ("AUDARA_CACHE puts the cache" if root == user_cache() else  # (set inside the project: cache_root)
           "the user cache is not writable here, so the cache is")
    return (f"{why} inside the project, in {relpath(root, w.project)}/ ({size / 1e6:.2f} MB on disk"
            + (", uv's cache below included" if with_uv else "") + "; it ignores itself in git)")


# ------------------------------------------------------------------------------------------------ audio in and out

def need_ffmpeg() -> None:
    missing = [t for t in ("ffmpeg", "ffprobe") if not shutil.which(t)]
    if not missing:
        return
    how = {"win32": "winget install Gyan.FFmpeg", "darwin": "brew install ffmpeg"}.get(
        sys.platform, "your package manager, e.g. sudo apt install ffmpeg")
    raise failure(f"{' and '.join(missing)} not found: install ffmpeg ({how}), then reopen the terminal so it is on PATH")


def channels(path: Path) -> int | None:
    """The first audio stream's channel count (ffprobe), or None when it can't be read."""
    p = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels",
                        "-of", "csv=p=0", str(path)], capture_output=True, text=True)
    try:
        return int(p.stdout.strip().splitlines()[0])
    except (ValueError, IndexError):
        return None


# priming and time_note are the same code in beats.py, mix.py, align.py and eleven.py (mix.py runs ffprobe by name, as
# its other calls do): change all four together.


def priming(path: Path) -> float:
    """The encoder delay the gapless decode drops (s): the priming samples its first packet says to skip (an MP3's
    LAME header, AAC's edit list, Opus' pre-skip); 0 for PCM. A player that keeps them plays everything that late."""
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-read_intervals", "%+#1",
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


_decoded: dict[str, np.ndarray] = {}


def decode(path: Path, fresh: bool = False) -> np.ndarray:
    """Any audio file as float32 stereo at 48 kHz, through ffmpeg's gapless decode (the timeline Chrome plays).
    A mono file goes to both channels at full level (dual mono): that is how a browser plays it, and how
    eleven.py measures it, so one file reads the same loudness everywhere. More channels fold down by ffmpeg's
    matrix."""
    key = str(Path(path).resolve())
    if not fresh and key in _decoded:
        return _decoded[key]
    mono = channels(path) == 1
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-i", str(path), "-map", "0:a:0"] \
        + (["-af", "pan=stereo|c0=c0|c1=c0"] if mono else ["-ac", "2"]) \
        + ["-ar", str(SR), "-f", "f32le", "-c:a", "pcm_f32le", "-"]
    try:
        p = subprocess.run(cmd, capture_output=True)
    except OSError as e:
        raise failure(f"cannot run ffmpeg: {e}")
    if p.returncode != 0:
        lines = p.stderr.decode("utf-8", "replace").strip().splitlines()
        raise failure(f"cannot decode {path}: {lines[-1] if lines else 'ffmpeg failed'} (is it an audio file?)")
    x = np.frombuffer(p.stdout, dtype="<f4")
    if x.size < 2:
        raise failure(f"{path}: ffmpeg decoded no audio samples (an empty file?)")
    x = x[: x.size // 2 * 2].reshape(-1, 2).copy()
    if not fresh:
        _decoded[key] = x
    return x


def forget(path: Path) -> None:
    """Drop a decoded input from memory once it has been placed."""
    _decoded.pop(str(Path(path).resolve()), None)


def last_sound(x: np.ndarray) -> int:
    """Samples up to and including the last one over -60 dBFS (0 for silence)."""
    thr, step = 10 ** (-60 / 20), SR * 10
    for i0 in range(max(0, len(x) - step), -step, -step):
        idx = np.flatnonzero(np.abs(x[max(0, i0):i0 + step]).max(axis=1) > thr)
        if len(idx):
            return max(0, i0) + int(idx[-1]) + 1
    return 0


def peak_abs(x: np.ndarray) -> float:
    """max |x| in 10 s chunks (no full-length temporary)."""
    step = SR * 10
    return max((float(np.abs(x[i:i + step]).max()) for i in range(0, len(x), step)), default=0.0)


def ebur128(path: Path) -> dict:
    """ffmpeg's EBU R128 meter on the file as it is: integrated, LRA, and the file's own sample and true peak. A
    mono file is measured as dual mono (+3 LU over a plain mono reading), as it plays on two speakers."""
    mono = channels(path) == 1
    cmd = ["ffmpeg", "-nostdin", "-hide_banner", "-nostats", "-i", str(path), "-map", "0:a:0", "-af",
           f"ebur128=peak=true+sample:framelog=quiet{':dualmono=true' if mono else ''}", "-f", "null", "-"]
    p = subprocess.run(cmd, capture_output=True)
    txt = p.stderr.decode("utf-8", "replace")
    if p.returncode != 0 or "Summary:" not in txt:
        raise failure(f"ffmpeg's ebur128 meter failed on {path}: {txt.strip().splitlines()[-1] if txt.strip() else '?'}")
    s = txt[txt.rfind("Summary:"):]

    def grab(pat):
        m = re.search(pat, s)
        if not m:
            return None
        return SILENT if "inf" in m.group(1) else float(m.group(1))

    num = r"(-?inf|-?\d+(?:\.\d+)?)"
    return {"integrated_lufs": grab(r"I:\s*" + num + r"\s*LUFS"),
            "lra_lu": grab(r"LRA:\s*" + num + r"\s*LU\b"),
            "sample_peak_dbfs": grab(r"Sample peak:\s*Peak:\s*" + num),
            "true_peak_dbtp": grab(r"True peak:\s*Peak:\s*" + num),
            "convention": "dual mono" if mono else "as the file is"}


def write_wav(path: Path, x: np.ndarray) -> None:
    """48 kHz / 24-bit PCM WAV (no encoder delay: sample 0 is t = 0), written atomically."""
    import soundfile as sf
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".part")
    y = np.clip(x, -1.0, 1.0 - 2.0 ** -23, out=x if x.dtype == np.float32 else None).astype(np.float32, copy=False)
    try:
        sf.write(str(tmp), y, SR, subtype="PCM_24", format="WAV")
        os.replace(tmp, path)
    except PermissionError:
        tmp.unlink(missing_ok=True)
        raise failure(f"cannot replace {path}: the file is open somewhere (a player or editor?). Close it and run again.")
    except OSError as e:
        tmp.unlink(missing_ok=True)
        raise failure(f"cannot write {path}: {e}")


# ------------------------------------------------------------------------------------------------ loudness (BS.1770)

def blocksums(e: np.ndarray) -> np.ndarray:
    nb = -(-len(e) // BLK)
    if nb * BLK != len(e):
        e = np.concatenate([e, np.zeros(nb * BLK - len(e))])
    return e.reshape(nb, BLK).sum(axis=1)


class KEnergy:
    """K-weighted energy of a stereo signal in 1 ms blocks (channel weights 1, as BS.1770 gives L and R), at full
    range and optionally through the phone high-pass. Filters run in 10 s chunks with their state carried."""

    def __init__(self, x: np.ndarray, phone: bool = True):
        n = len(x)
        self.n, self.dur = n, n / SR
        nb = max(1, -(-n // BLK))
        self.cnt = np.full(nb, float(BLK))
        self.cnt[-1] = (n - (nb - 1) * BLK) or BLK
        self.E = {"full": np.zeros(nb)}
        if phone:
            self.E["phone"] = np.zeros(nb)
        zk = np.zeros((K_SOS.shape[0], 2, 2))
        zh = np.zeros((PHONE_SOS.shape[0], 2, 2))
        zkp = np.zeros((K_SOS.shape[0], 2, 2))
        step = BLK * 10_000
        for i0 in range(0, n, step):
            seg = np.asarray(x[i0:i0 + step], dtype=np.float64)
            b0 = i0 // BLK
            y, zk = signal.sosfilt(K_SOS, seg, axis=0, zi=zk)
            s = blocksums((y * y).sum(axis=1))
            self.E["full"][b0:b0 + len(s)] = s
            if phone:
                h, zh = signal.sosfilt(PHONE_SOS, seg, axis=0, zi=zh)
                y, zkp = signal.sosfilt(K_SOS, h, axis=0, zi=zkp)
                s = blocksums((y * y).sum(axis=1))
                self.E["phone"][b0:b0 + len(s)] = s
        self._cs: dict[str, tuple[np.ndarray, np.ndarray]] = {}

    def cs(self, which: str):
        if which not in self._cs:
            self._cs[which] = (np.concatenate([[0.0], np.cumsum(self.E[which])]),
                               np.concatenate([[0.0], np.cumsum(self.cnt)]))
        return self._cs[which]

    def blk(self, t: float) -> int:
        return int(min(max(round(t * 1000), 0), len(self.cnt)))

    def mean(self, a: float, b: float, which: str = "full") -> float | None:
        E, C = self.cs(which)
        i0, i1 = self.blk(a), self.blk(b)
        return (E[i1] - E[i0]) / (C[i1] - C[i0]) if i1 > i0 else None

    def lufs(self, a: float, b: float, which: str = "full") -> float | None:
        """Ungated loudness of [a, b]: the stretch as one long window (what a listener hears over it)."""
        m = self.mean(a, b, which)
        return None if m is None else to_lufs(m)

    def masked(self, mask_blocks: np.ndarray, which: str = "full") -> float:
        c = self.cnt[mask_blocks].sum()
        return to_lufs(self.E[which][mask_blocks].sum() / c) if c else SILENT

    def curve(self, win: float, hop: float, which: str = "full"):
        """Loudness of every `win` window ending every `hop` (times are the window ends, as ffmpeg reports)."""
        E, C = self.cs(which)
        W, H, nb = round(win * 1000), round(hop * 1000), len(self.cnt)
        ends = np.arange(W, nb + 1, H)
        if len(ends) == 0:
            return np.zeros(0), np.zeros(0)
        return ends / 1000.0, lufs_arr((E[ends] - E[ends - W]) / (C[ends] - C[ends - W]))

    def integrated(self, which: str = "full") -> float:
        """BS.1770-4 gated loudness: 400 ms blocks every 100 ms, -70 LUFS absolute and -10 LU relative gates."""
        E, C = self.cs(which)
        nb = len(self.cnt)
        if nb < 400:
            return to_lufs(E[-1] / C[-1])
        ends = np.arange(400, nb + 1, 100)
        z = (E[ends] - E[ends - 400]) / (C[ends] - C[ends - 400])
        lz = lufs_arr(z)
        keep = lz > -70.0
        if not keep.any():
            return SILENT
        gate = to_lufs(z[keep].mean()) - 10.0
        keep &= lz > gate
        return to_lufs(z[keep].mean())

    def loudest(self, a: float, b: float, win: float = 0.4, which: str = "full"):
        """The loudest `win` window lying inside [a, b]: (LUFS, window start)."""
        E, C = self.cs(which)
        i0, i1, W = self.blk(a), self.blk(b), round(win * 1000)
        if i1 - i0 < W:
            return None, None
        s = np.arange(i0, i1 - W + 1)
        z = (E[s + W] - E[s]) / (C[s + W] - C[s])
        k = int(np.argmax(z))
        return to_lufs(z[k]), s[k] / 1000.0


def tp_envelope(x: np.ndarray) -> np.ndarray:
    """Per-sample true-peak estimate (max over channels of the 4x-oversampled signal between this sample and the
    next), in 5 s chunks so a long mix doesn't need a 4x copy in memory."""
    n = len(x)
    out = np.empty(n, dtype=np.float32)
    step, pad = SR * 5, 64  # 64 samples > the interpolation filter's reach (~10 input samples)
    for i0 in range(0, n, step):
        a, b = max(0, i0 - pad), min(n, i0 + step + pad)
        up = signal.resample_poly(np.asarray(x[a:b], dtype=np.float64), TP_OVERSAMPLE, 1, axis=0)
        m = np.abs(up).max(axis=1)
        m = m[: len(m) // TP_OVERSAMPLE * TP_OVERSAMPLE].reshape(-1, TP_OVERSAMPLE).max(axis=1)
        k = min(step, n - i0)
        out[i0:i0 + k] = m[i0 - a:i0 - a + k]
    return np.maximum(out, np.abs(x).max(axis=1))


def limiter_gain(tp_env: np.ndarray, gain: float, ceiling_db: float) -> np.ndarray | None:
    """Gain curve (<= 1) keeping gain * signal under the ceiling at every true peak, or None if nothing exceeds it.
    The required gain is min-filtered forward over the look-ahead and averaged backward over the same length, so
    the curve ramps down over 3 ms and is exactly at the requirement at each peak; the release then recovers with a
    one-pole time constant at 1 ms resolution."""
    c = 10 ** (ceiling_db / 20)
    req = np.minimum(1.0, c / np.maximum(tp_env * gain, 1e-12)).astype(np.float32)
    if req.min() >= 1.0:
        return None
    L = max(1, int(round(LIM_LOOKAHEAD * SR)))
    m = minimum_filter1d(req, size=L, origin=-(L // 2), mode="nearest")  # min over [n, n+L-1]
    b = uniform_filter1d(m, size=L, origin=(L - 1) // 2, mode="nearest")  # mean over [n-L+1, n]: <= req at peaks
    nb = -(-len(b) // BLK)
    bdb = 20 * np.log10(np.maximum(np.minimum.reduceat(b, np.arange(0, len(b), BLK)), 1e-9))
    a = math.exp(-1.0 / (LIM_RELEASE * 1000))
    y = np.empty(nb)
    prev = 0.0
    for j in range(nb):
        prev = min(bdb[j], prev * a)
        y[j] = prev
    xc = np.arange(nb) * BLK + BLK / 2
    for i0 in range(0, len(b), SR * 10):
        i1 = min(len(b), i0 + SR * 10)
        b[i0:i1] = np.minimum(b[i0:i1], (10 ** (np.interp(np.arange(i0, i1), xc, y) / 20)).astype(np.float32))
    return b


# ------------------------------------------------------------------------------------------------ measuring

def hit_onset(k: KEnergy, t: float) -> tuple[float | None, float | None]:
    """Where a hit's attack starts, and how far its arrival rises (dB): (None, rise) when that is under SHARP_DB, a
    swell with nothing to time; (None, None) over silence. Read from the K-weighted power of both channels in 1 ms
    blocks, summed over the channels and averaged over 10 ms or more, so neither stereo cancellation nor a low
    note's zero crossings fake a jump: the level of single 1 ms blocks of the mono sum did, and put two hits that
    start exactly on time at -155 and +271 ms."""
    E, _ = k.cs("full")
    nb = len(k.cnt)

    def power(i0, i1):  # mean power of blocks [i0, i1) for arrays of block indices; silence outside the file
        return (E[np.clip(i1, 0, nb)] - E[np.clip(i0, 0, nb)]) / ((i1 - i0) * BLK)

    def ms(s: float) -> int:
        return round(s * 1000)

    s = np.arange(max(0, ms(t - ONSET_SEARCH_S)), min(nb, ms(t + ONSET_SEARCH_S)) + 1)
    if not len(s):
        return None, None
    after, before = power(s, s + ms(ARRIVAL_AFTER_S)), power(s - ms(ARRIVAL_BEFORE_S), s)
    near = 1 - (1 - ARRIVAL_FAR_WEIGHT) * np.abs(s / 1000 - t) / ONSET_SEARCH_S
    i = int(np.argmax((after - before) * near))
    if after[i] <= 0:
        return None, None
    rise = dbp(after[i]) - dbp(before[i])
    if rise < SHARP_DB:
        return None, rise
    floor = max(after[i] * 10 ** (-LEAD_IN_DB / 10), 1e-15)
    s = np.arange(max(0, s[i] - ms(ATTACK_BACK_S)), s[i] + 1)
    d = (np.log10(np.maximum(power(s, s + ms(ATTACK_AFTER_S)), floor))
         - np.log10(np.maximum(power(s - ms(ATTACK_BEFORE_S), s), floor)))
    return int(s[int(np.argmax(d))]) / 1000, rise


def build_check(k: KEnergy, t: float, bar: float) -> dict | None:
    """The build into a hit at t: the loudness of [t - 8, t - 0.2] against the opening, [0, min(8, t / 2.5)], at full
    range and through the phone high-pass. None when the two would overlap, either is empty or either is silent."""
    o0, o1 = 0.0, min(BUILD_OPEN_S, t / BUILD_OPEN_FRAC)
    l0, l1 = max(0.0, t - BUILD_LEAD_S), t - BUILD_GAP_S
    if o1 > l0 or l1 <= l0 or l1 > k.dur:  # (a hit at 0 s leaves both empty)
        return None
    lv = {w: (k.lufs(o0, o1, w), k.lufs(l0, l1, w)) for w in ("full", "phone")}
    if min(v for pair in lv.values() for v in pair) <= -70.0:
        return None
    rise, rise_p = r(lv["full"][1] - lv["full"][0]), r(lv["phone"][1] - lv["phone"][0])
    flat = bar > 0 and rise < bar
    low = bar > 0 and rise > 0 and rise_p < bar and r(rise - rise_p) >= PHONE_LOW_LU

    def span(a, b):
        return f"{round(a, 2):g}-{round(b, 2):g} s"

    line = f"build into the hit at {t:.2f} s: {rise:+.1f} LU ({span(o0, o1)} to {span(l0, l1)}), phone {rise_p:+.1f} LU"
    why = ([f"under {bar:g} LU, " + ("it reads as flat" if rise >= 0 else "the lead-in is quieter than the opening")]
           if flat else []) + (["the build is carried by the low end and barely builds on a phone"] if low else [])
    return {"opening_s": [round(o0, 3), round(o1, 3)], "lead_in_s": [round(l0, 3), round(l1, 3)],
            "opening_lufs": r(lv["full"][0]), "lead_in_lufs": r(lv["full"][1]), "rise_lu": rise,
            "opening_lufs_phone": r(lv["phone"][0]), "lead_in_lufs_phone": r(lv["phone"][1]), "rise_lu_phone": rise_p,
            "reads_flat": flat, "low_end_only": low, "summary": line + (": " + "; ".join(why) if why else "")}


def analyze(x: np.ndarray, sections: list[dict], hits: list[float], k: KEnergy | None = None,
            hit_lu: float = HIT_LU, build_lu: float = BUILD_LU):
    """Everything `measure` reports that is computed here (not by ffmpeg), plus the curves for the PNG."""
    k = k or KEnergy(x, phone=True)
    dur = len(x) / SR
    I = k.integrated()
    rep: dict = {"duration_s": round(dur, 3), "integrated_lufs_phone": r(k.integrated("phone"))}
    mt, mf = k.curve(0.4, 0.1)
    _, mp = k.curve(0.4, 0.1, "phone")
    st, sf_ = k.curve(3.0, 1.0)
    s10t, s10 = k.curve(3.0, 0.1)
    rep["short_term"] = {"window_s": 3.0, "end_s": [round(v, 3) for v in st], "lufs": [r(v) for v in sf_]}
    rep["momentary"] = {"window_s": 0.4, "hop_s": 0.1, "end_s": [round(v, 3) for v in mt],
                        "lufs": [r(v) for v in mf], "lufs_phone": [r(v) for v in mp]}
    secs = []
    prev = None
    for s in sections:
        a, b = max(0.0, s["start"]), min(dur, s["end"])
        full, ph = k.lufs(a, b), k.lufs(a, b, "phone")
        row = {"name": s["name"], "start": round(s["start"], 3), "end": round(s["end"], 3), "lufs": r(full),
               "lufs_phone": r(ph)}
        if prev is not None and full is not None and prev[0] is not None:
            row["rise_lu"] = r(full - prev[0])
            row["rise_vs"] = prev[1]
        secs.append(row)
        prev = (full, s["name"])
    rep["sections"] = secs
    hrows, warnings = [], []
    for t in hits:
        row = {"t": round(t, 3)}
        on, rise = hit_onset(k, t)
        if on is not None:
            row["onset_s"] = round(on, 3)
            row["onset_offset_ms"] = round((on - t) * 1000, 1)
        row["onset_rise_db"] = r(rise)
        for which in ("full", "phone"):
            hl, ha = k.loudest(t - 0.01, t + HIT_AFTER_S, 0.4, which)
            bl, ba = k.loudest(max(0.0, t - HIT_BEFORE_S), t - 0.02, 0.4, which)
            row[which] = {"hit_lufs": r(hl), "hit_window_start": r(ha, 3), "before_lufs": r(bl),
                          "before_window_start": r(ba, 3),
                          "contrast_lu": r(hl - bl) if hl is not None and bl is not None else None}
        f, p = row["full"]["contrast_lu"], row["phone"]["contrast_lu"]
        if hit_lu > 0 and f is not None and p is not None and min(f, p) < hit_lu:
            todo = ("make it land louder than what leads into it, or treat it as a cue (a soft resolve chord is a cue, "
                    "not a hit)") if f < hit_lu else \
                f"its weight is in the low end, which a phone doesn't play; give the hit more above {PHONE_HP_HZ} Hz"
            row["contrast_warning"] = (f"hit contrast under {hit_lu:g} LU{'' if f < hit_lu else ' on a phone'} at "
                                       f"{t:.2f} s: {f:+.1f} LU over the {HIT_BEFORE_S:g} s before it, phone "
                                       f"{p:+.1f} LU: {todo}")
            warnings.append(row["contrast_warning"])
        row["build"] = build_check(k, t, build_lu)
        if row["build"] and (row["build"]["reads_flat"] or row["build"]["low_end_only"]):
            warnings.append(row["build"]["summary"])
        hrows.append(row)
    rep["hits"] = hrows
    rep["warnings"] = warnings
    first = last = None
    for i0 in range(0, len(x), SR * 10):
        idx = np.flatnonzero(np.abs(x[i0:i0 + SR * 10]).max(axis=1) >= 10 ** (DEAD_DBFS / 20))
        if len(idx):
            first = i0 + int(idx[0]) if first is None else first
            last = i0 + int(idx[-1])
    if first is not None:
        rep["first_sound_s"] = round(first / SR, 3)
        rep["dead_tail_s"] = round((len(x) - 1 - last) / SR, 3)
    else:
        rep["first_sound_s"] = None
        rep["dead_tail_s"] = round(dur, 3)
    rep["quiet_intro_s"] = None
    if I > SILENT and len(mf):
        ok = np.flatnonzero(mf >= I - QUIET_INTRO_LU)
        if len(ok):
            rep["quiet_intro_s"] = round(max(0.0, mt[ok[0]] - 0.4), 3)
    if dur > 2.5:
        last = k.lufs(dur - 2.0, dur)
        rep["last_2s_lufs"] = r(last)
        rep["last_2s_under_integrated_lu"] = r(I - last) if last is not None and I > SILENT else None
    curves = {"m_full": (mt - 0.2, mf), "m_phone": (mt - 0.2, mp), "s_full": (s10t - 1.5, s10)}
    return rep, curves, k


def narration_tail(path: Path) -> tuple[float, str] | None:
    """(seconds, tool): the silence a narration leaves after its last word on purpose (--tail), as the settings
    beside narration.wav record it: standin.py's audio/standin/standin.json when it wrote this very file, else
    eleven.py's audio/narration/narration.json. None for any other file."""
    if path.name != "narration.wav":
        return None
    for rec, tool in ((path.parent / "standin" / "standin.json", "standin.py"),
                      (path.parent / "narration" / "narration.json", "eleven.py")):
        try:
            cfg = json.loads(rec.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError):
            continue
        if not isinstance(cfg, dict) or (tool == "standin.py" and cfg.get("narration_sha256") != sha256(path)):
            continue  # (a stand-in the real voice has replaced since)
        t = cfg.get("tail")  # (the record that made this file decides: --tail 0 asked for no silence)
        return (float(t), tool) if isinstance(t, (int, float)) and not isinstance(t, bool) and t > 0 else None
    return None


def tail_label(asked: dict) -> str:
    """What the silence at a narration's end is, when its tool was asked for it (measure's narration_tail): 'the
    narration's 1.0 s tail (eleven.py --tail)'."""
    secs = f"{asked['s']:.1f}" if asked["s"] == round(asked["s"], 1) else f"{asked['s']:g}"
    return f"the narration's {secs} s tail ({asked['by']} --tail)"


def summary_flags(rep: dict) -> list[str]:
    out = []
    if rep.get("dead_tail_s") is not None and rep["dead_tail_s"] >= NOTE_DEAD_S:
        asked = rep.get("narration_tail")  # (measure on a narration.wav: the tail its tool was asked for)
        out.append((tail_label(asked) if asked else "dead tail")
                   + f": the last {rep['dead_tail_s']:.2f} s stay under {DEAD_DBFS:.0f} dBFS")
    if rep.get("quiet_intro_s") is not None and rep["quiet_intro_s"] >= 1.0:
        out.append(f"near-silent intro: the first {rep['quiet_intro_s']:.2f} s sit more than {QUIET_INTRO_LU:.0f} LU "
                   "under the integrated loudness")
    return out


# ------------------------------------------------------------------------------------------------ the PNG

PALETTE = dict(surface="#fcfcfb", ink="#0b0b0b", ink2="#52514e", muted="#898781", grid="#e1e0d9",
               axis="#c3c2b7", band="#f0efec", full="#2a78d6", phone="#eb6834", music="#1baf7a", warn="#fab219")


def draw_png(path: Path, title: str, rep: dict, curves: dict, extra: dict | None = None) -> None:
    """Loudness over time, sections shaded and named, hits marked; for a mix also the music-only curve, the effects
    and a panel with the music's ducking gain under the voice."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.ticker import FuncFormatter

    C = PALETTE
    extra = extra or {}
    dur = rep["duration_s"]
    duck = extra.get("duck")
    rows = 2 if duck is not None else 1
    fig = plt.figure(figsize=(12, 6.3 if rows == 2 else 4.7), dpi=110, facecolor=C["surface"])
    gs = fig.add_gridspec(rows, 1, height_ratios=[3, 1.1][:rows], hspace=0.1)
    ax = fig.add_subplot(gs[0])
    axes = [ax]
    if rows == 2:
        axes.append(fig.add_subplot(gs[1], sharex=ax))
    for a in axes:
        a.set_facecolor(C["surface"])
        for side in ("top", "right"):
            a.spines[side].set_visible(False)
        for side in ("left", "bottom"):
            a.spines[side].set_color(C["axis"])
            a.spines[side].set_linewidth(0.8)
        a.tick_params(colors=C["muted"], labelsize=8, length=3, width=0.6)
        a.grid(True, axis="y", color=C["grid"], linewidth=0.6)
        a.set_axisbelow(True)
    vals = np.concatenate([np.asarray(curves[k][1]) for k in ("m_full", "m_phone", "s_full", "m_music")
                           if k in curves and len(curves[k][1])] or [np.zeros(0)])
    vals = vals[vals > SILENT + 1]
    I = rep.get("integrated_lufs")
    top = float(vals.max()) + 4 if len(vals) else 0.0
    floor = (I if I is not None and I > SILENT else top - 30) - 30
    bottom = max(float(vals.min()) - 2 if len(vals) else top - 40, floor, -100.0)
    if top - bottom < 20:
        bottom = top - 20
    for i, s in enumerate(rep.get("sections", [])):
        a, b = s["start"], s["end"]
        if i % 2 == 0:
            ax.axvspan(a, b, color=C["band"], lw=0, zorder=0)
        for edge in (a, b):
            if 0 < edge < dur:
                ax.axvline(edge, color=C["axis"], lw=0.6, zorder=1)
        if (b - a) >= 0.03 * dur:
            lab = s["name"] + (f"  {s['lufs']:.1f}" if s.get("lufs") is not None else "")
            ax.text(a + 0.004 * dur, 0.985, lab, transform=ax.get_xaxis_transform(), va="top", ha="left",
                    fontsize=8, color=C["ink2"], clip_on=True)
    tail, asked = rep.get("dead_tail_s"), rep.get("narration_tail")
    if tail is not None and tail >= NOTE_DEAD_S and asked:  # (silence on purpose: no warning colour)
        ax.axvspan(dur - tail, dur, color=C["muted"], alpha=0.12, lw=0, zorder=0)
        ax.text(dur, 0.08, tail_label(asked) + " ", transform=ax.get_xaxis_transform(), fontsize=8, color=C["ink2"],
                va="bottom", ha="right")
    elif tail is not None and tail >= NOTE_DEAD_S:
        ax.axvspan(dur - tail, dur, color=C["warn"], alpha=0.22, lw=0, zorder=0)
        ax.text(dur - tail, 0.08, f" dead tail {tail:.2f} s", transform=ax.get_xaxis_transform(), fontsize=8,
                color=C["ink2"], va="bottom", ha="left")
    qi = rep.get("quiet_intro_s")
    if qi is not None and qi >= 1.0:
        ax.axvspan(0, qi, color=C["warn"], alpha=0.22, lw=0, zorder=0)
        ax.text(0, 0.08, f" near-silent intro {qi:.2f} s", transform=ax.get_xaxis_transform(), fontsize=8,
                color=C["ink2"], va="bottom", ha="left")
    ax.plot(*curves["s_full"], color=C["full"], lw=2.6, alpha=0.4, label="short-term 3 s", zorder=2)
    if "m_music" in curves:
        ax.plot(*curves["m_music"], color=C["music"], lw=1.0, label="music-only, momentary", zorder=3)
    ax.plot(*curves["m_phone"], color=C["phone"], lw=1.0, label="momentary, 300 Hz high-pass (phone)", zorder=3)
    ax.plot(*curves["m_full"], color=C["full"], lw=1.1, label="momentary 400 ms", zorder=4)
    if I is not None and I > SILENT:
        ax.axhline(I, color=C["muted"], lw=0.8, zorder=1)
        ax.text(dur, I, f" integrated {I:.1f}", fontsize=8, color=C["ink2"], va="center", ha="left")
    ax.set_ylim(bottom, top)
    ax.set_xlim(0, dur)  # (before the hit labels: their overlap is measured where they will be drawn)
    renderer = fig.canvas.get_renderer()
    placed = []  # the hit labels drawn so far, in pixels: a label that would touch one goes a row lower
    for h in rep.get("hits", []):
        t = h["t"]
        ax.axvline(t, color=C["ink"], lw=1.0, zorder=5)
        f, p = h["full"].get("contrast_lu"), h["phone"].get("contrast_lu")
        lab = f"hit {t:.2f} s: {f:+.1f} LU" if f is not None else f"hit {t:.2f} s"
        if p is not None:
            lab += f", phone {p:+.1f} LU"
        right = t > 0.7 * dur  # keep the label inside the plot
        txt = ax.text(t + (-0.006 if right else 0.006) * dur, 0.90, lab, transform=ax.get_xaxis_transform(),
                      fontsize=8, color=C["ink"], va="top", ha="right" if right else "left", zorder=7,
                      bbox=dict(boxstyle="square,pad=0.15", fc=C["surface"], ec="none", alpha=0.85))
        for row in range(len(placed) + 1):
            txt.set_y(0.90 - 0.07 * row)
            box = txt.get_window_extent(renderer).padded(3)
            if not any(box.overlaps(b) for b in placed):
                break
        placed.append(box)
    for t, lab in extra.get("marks", []):
        ax.plot([t], [bottom + 1.2], marker="v", ms=6, color=C["ink2"], ls="none", zorder=6)
        ax.text(t, bottom + 2.4, lab, fontsize=7, color=C["ink2"], ha="center", va="bottom")
    ax.set_ylabel("LUFS (K-weighted)", fontsize=8, color=C["ink2"])
    ax.legend(loc="lower left", ncol=4, frameon=False, fontsize=8, labelcolor=C["ink2"],
              bbox_to_anchor=(0, 1.0, 1, 0.1), mode=None, borderaxespad=0.2)
    ax.set_title(title, loc="left", fontsize=10, color=C["ink"], pad=26)
    if duck is not None:
        a2 = axes[1]
        t, g, act = duck
        lo = min(float(np.min(g)) - 1.5, -3.0)
        a2.fill_between(t, lo, 0.8, where=act, color=C["band"], lw=0, step="mid", label="voice speaking")
        a2.plot(t, g, color=C["music"], lw=1.2, label="music gain from ducking (dB)")
        a2.set_ylim(lo, 1.0)
        a2.set_ylabel("dB", fontsize=8, color=C["ink2"])
        a2.legend(loc="lower right", ncol=2, frameon=True, facecolor=C["surface"], edgecolor="none", framealpha=0.9,
                  fontsize=8, labelcolor=C["ink2"])
    fmt = FuncFormatter(lambda v, _: f"{int(v // 60)}:{int(v % 60):02d}" if dur >= 60 else f"{v:g}")
    axes[-1].xaxis.set_major_formatter(fmt)
    axes[-1].set_xlabel("time (m:ss)" if dur >= 60 else "time (s)", fontsize=8, color=C["ink2"])
    if rows == 2:
        plt.setp(ax.get_xticklabels(), visible=False)
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, facecolor=C["surface"], bbox_inches="tight")
    plt.close(fig)


# ------------------------------------------------------------------------------------------------ timing data

def norm_word(s: str) -> str:
    """The engine's norm() (words.ts): accents stripped, lower case, only letters, digits and parentheses."""
    s = "".join(c for c in unicodedata.normalize("NFD", str(s)) if unicodedata.category(c) != "Mn").lower()
    return "".join(c for c in s if c.isalnum() or c in "()")


def fold(s: str) -> str:
    return str(s).lower().replace("\u2018", "'").replace("\u2019", "'").replace("\u201c", '"').replace("\u201d", '"')


class TimingData:
    """The video's data/audio.json and data/words.json, read only when a plan refers to them."""

    def __init__(self, data_dir: Path, root: Path | None):
        self.dir, self.root = data_dir, root
        self._cache: dict[str, dict] = {}
        self.used: dict[str, str] = {}
        # where each file's times sit in the mix: + (at - from) of the plan layer it was timed to (layer_shift)
        self.shift_audio = 0.0
        self.shift_words = 0.0

    def get(self, name: str, why: str) -> dict:
        if name not in self._cache:
            p = self.dir / name
            if not p.is_file():
                raise usage(f"{why} needs {relpath(p, self.root)}, which does not exist (beats.py writes audio.json; "
                            "the narration or alignment step writes words.json)")
            self._cache[name] = load_json(p, name)
            self.used[relpath(p, self.root)] = sha256(p)
        return self._cache[name]

    def exists(self, name: str) -> bool:
        return (self.dir / name).is_file()

    def cues(self, why: str) -> dict[str, float]:
        a = self.get("audio.json", why)
        out: dict[str, float] = {}
        c = a.get("cues")
        if isinstance(c, dict):
            for k, v in c.items():
                if isinstance(v, (int, float)):
                    out[str(k)] = float(v)
                elif isinstance(v, dict):
                    t = next((v[x] for x in ("t", "time", "at", "start") if isinstance(v.get(x), (int, float))), None)
                    if t is not None:
                        out[str(k)] = float(t)
        elif isinstance(c, list):
            for v in c:
                if isinstance(v, dict) and "name" in v:
                    t = next((v[x] for x in ("t", "time", "at", "start") if isinstance(v.get(x), (int, float))), None)
                    if t is not None:
                        out[str(v["name"])] = float(t)
        return out

    def cue(self, name: str, why: str) -> tuple[float, str]:
        cues = self.cues(why)
        if name in cues:
            return cues[name] + self.shift_audio, f'cue "{name}"'
        secs = self.get("audio.json", why).get("sections") or []
        for s in secs:
            if isinstance(s, dict) and s.get("name") == name and isinstance(s.get("start"), (int, float)):
                return float(s["start"]) + self.shift_audio, f'section "{name}" start'
        names = list(cues) + [s.get("name") for s in secs if isinstance(s, dict) and s.get("name")]
        close = difflib.get_close_matches(name, names, n=3)
        raise usage(f'{why}: no cue or section named "{name}" in data/audio.json'
                    + (f" (did you mean {', '.join(close)}?)" if close else f"; names there: {', '.join(names) or 'none'}"))

    def words(self, why: str) -> list[dict]:
        j = self.get("words.json", why)
        out = []
        for li, line in enumerate(j.get("lines") or []):
            for w in line.get("words") or []:
                if isinstance(w, dict) and isinstance(w.get("start"), (int, float)):
                    out.append({**w, "line": li})
        return out

    def word(self, text: str, nth: int, edge: str, why: str) -> tuple[float, str]:
        ws = self.words(why)
        q = [norm_word(t) for t in str(text).split() if norm_word(t)]
        if not q:
            raise usage(f"{why}: the word {text!r} has no letters or digits to match")
        keys = [norm_word(w.get("w", "")) for w in ws]
        spoken = [norm_word(w.get("spoken", "")) for w in ws]
        hits = [i for i in range(len(ws) - len(q) + 1)
                if all(keys[i + j] == q[j] or (spoken[i + j] and spoken[i + j] == q[j]) for j in range(len(q)))]
        if not hits:
            close = difflib.get_close_matches(q[0], sorted(set(keys)), n=3)
            raise usage(f"{why}: {text!r} is not in data/words.json"
                        + (f" (did you mean {', '.join(close)}?)" if close else ""))
        try:
            i = hits[nth]
        except IndexError:
            raise usage(f"{why}: {text!r} occurs {len(hits)} time(s) in data/words.json; nth {nth} is out of range")
        w0, w1 = ws[i], ws[i + len(q) - 1]
        t = float(w0["start"] if edge == "start" else w1["end"]) + self.shift_words
        return t, f'word "{text}"' + (f" #{nth}" if nth else "") + (" end" if edge == "end" else "")

    def line(self, text: str, nth: int, edge: str, why: str) -> tuple[float, str]:
        lines = self.get("words.json", why).get("lines") or []
        q = fold(text)
        src = [l for l in lines if l.get("sourceText") and q in fold(l["sourceText"])]
        found = src or [l for l in lines if q in fold(l.get("text", ""))]
        if not found:
            raise usage(f"{why}: no line in data/words.json contains {text!r}")
        try:
            l = found[nth]
        except IndexError:
            raise usage(f"{why}: {len(found)} line(s) contain {text!r}; nth {nth} is out of range")
        t = float(l["start"] if edge == "start" else l["end"]) + self.shift_words
        return t, f'line "{text}"' + (" end" if edge == "end" else "")

    def beat(self, kind: str, i: int, why: str) -> tuple[float, str]:
        arr = self.get("audio.json", why).get(kind + "s") or []
        try:
            return float(arr[i]) + self.shift_audio, f"{kind} {i}"
        except (IndexError, TypeError):
            raise usage(f"{why}: data/audio.json has {len(arr)} {kind}s; index {i} is out of range")


def layer_shift(data: TimingData, name: str, plan: dict, shas: dict) -> tuple[float, str | None, dict | None]:
    """Where data/<name>'s times sit in the mix: its audioSha256 names the plan file it was timed to (a voice block,
    or the music), and its times move with that layer's placement (at - from). Returns (shift, layer, document);
    a file timed to something else (the mix itself, music-only.wav) is taken as video time."""
    if not data.exists(name):
        return 0.0, None, None
    doc = data.get(name, "the mix")
    if not isinstance(doc, dict):
        return 0.0, None, None
    sha = doc.get("audioSha256")
    layers = [(f"voice[{i}]" if len(plan["voice"]) > 1 else "voice", b) for i, b in enumerate(plan["voice"])]
    if plan["music"]:
        layers.append(("music", plan["music"]))
    for label, lay in layers:
        if sha and shas.get(lay["file"]) == sha:
            return lay["at"] - lay["from"], label, doc
    return 0.0, None, doc


def block_gaps(doc: dict | None, layer: str | None, shift: float) -> list[tuple[float, float]]:
    """The silences between paragraphs, in mix time, when data/words.json is a narration of a voice layer (eleven.py
    tts writes one line per paragraph): where the music rises."""
    if not doc or not layer or not layer.startswith("voice") or (doc.get("source") or {}).get("kind") != "narration":
        return []
    lines = [l for l in doc.get("lines") or [] if isinstance(l, dict) and isinstance(l.get("start"), (int, float))
             and isinstance(l.get("end"), (int, float))]
    return [(a["end"] + shift, b["start"] + shift) for a, b in zip(lines, lines[1:]) if b["start"] > a["end"]]


# ------------------------------------------------------------------------------------------------ the plan

PLAN_KEYS = {"kind", "loudness", "true_peak", "max_limit_db", "duration", "fade_in", "fade_out", "voice", "music",
             "effects", "hits", "hit_lu", "build_lu", "note", "notes"}
VOICE_KEYS = {"file", "at", "from", "dur", "gain_db", "note"}
MUSIC_KEYS = {"file", "at", "from", "dur", "gain_db", "under_voice", "fade_in", "fade_out", "duck", "note"}
DUCK_KEYS = {"depth_db", "attack", "hold", "release", "note"}
FX_KEYS = {"file", "at", "cue", "word", "line", "beat", "downbeat", "nth", "edge", "offset", "align", "gain_db",
           "target_db", "peak_cap_db", "note"}
FX_WHEN = ("at", "cue", "word", "line", "beat", "downbeat")

PLAN_HELP = """\
The plan (videos/<video>/mix.json by default) is JSON. File paths are relative to the plan's folder, so a plan in
videos/<video>/ writes them the way video.json does ("audio/narration.wav"). Times are seconds (12.5) or m:ss
("0:12.5"). Every key is optional except the files; "note" is allowed anywhere for comments.

{
  "kind": "calm",                  calm (-16 LUFS, default) or punchy (-14 LUFS)
  "loudness": -16,                 integrated LUFS target; overrides kind
  "true_peak": -1.0,               dBTP ceiling
  "max_limit_db": 4,               most peak limiting allowed to reach the target (more dulls the hits)
  "duration": 30,                  default: video.json's duration, else the music's end, else the last sound + 0.5 s
  "fade_in": 0.005, "fade_out": 0.01,          master fades (s)
  "voice": "audio/narration.wav",              or {"file", "at", "from", "dur", "gain_db"},
                                               or blocks: [{"file": "audio/vo-1.wav", "at": 0.4}, ...]
  "music": {"file": "audio/music.mp3", "at": 0, "from": 0, "dur": null,
            "under_voice": 12,     LU under the voice while it speaks (default with a voice), or
            "gain_db": -6,         a fixed gain on the file instead
            "fade_in": 0, "fade_out": 2.5,
            "duck": {"depth_db": 6, "attack": 0.15, "hold": 0.4, "release": 0.6}},   or false; with a voice only
  "effects": [
    {"file": "audio/sfx/whoosh.wav", "cue": "chorus", "align": "peak", "offset": -0.05},
    {"file": "audio/sfx/hit.wav", "at": "0:20"},
    {"file": "audio/sfx/pop.wav", "word": "starter", "nth": 0, "edge": "start"},
    {"file": "audio/sfx/tick.wav", "downbeat": 8, "target_db": 2.5},
    {"file": "audio/sfx/bell.wav", "line": "see you", "gain_db": -12}
  ],
  "hits": [20, "drop"],            moments meant to land louder than the 4 s before them (seconds or cue names):
                                   each gets its measured onset, its contrast and the build into it. A soft
                                   resolve chord is a cue, not a hit.
  "hit_lu": 3, "build_lu": 5       the contrast and build under which the report warns (0: no warning)
}

Each effect lands by one of: "at" (time), "cue" (data/audio.json "cues", else a section's start), "word" (a word,
or several in a row, in data/words.json, found as the engine's findWords does; "nth" picks a later occurrence,
"edge": "end" its end), "line" (the first line containing the text, as words.get() finds it), "beat" or
"downbeat" (index into data/audio.json), plus "offset" seconds. "align": "onset" (default) puts the effect's
measured onset on that time; "peak" puts its loudest moment there (whooshes into a cut). Its level is solved in
its own band against the music: "target_db" (default 3.5 dB lift), "peak_cap_db" (default 6), or "gain_db" to
set it by hand."""


def check_keys(obj, allowed: set[str], where: str) -> dict:
    if not isinstance(obj, dict):
        raise usage(f"{where} must be an object {{...}}, got {json.dumps(obj)[:60]}")
    bad = [k for k in obj if k not in allowed]
    if bad:
        hints = []
        for k in bad:
            close = difflib.get_close_matches(k, sorted(allowed), n=1)
            hints.append(f'"{k}"' + (f' (did you mean "{close[0]}"?)' if close else ""))
        raise usage(f"{where}: unknown key {', '.join(hints)}; allowed: {', '.join(sorted(allowed))}")
    return obj


def num(obj: dict, key: str, where: str, default=None, lo=None, hi=None):
    if key not in obj or obj[key] is None:
        return default
    v = obj[key]
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise usage(f"{where}.{key} must be a number, got {json.dumps(v)}")
    if (lo is not None and v < lo) or (hi is not None and v > hi):
        raise usage(f"{where}.{key} must be between {lo} and {hi}, got {v}")
    return float(v)


def tkey(obj: dict, key: str, where: str, default=None):
    return default if key not in obj or obj[key] is None else parse_time(obj[key], f"{where}.{key}")


def need_file(obj: dict, where: str, base: Path) -> Path:
    f = obj.get("file")
    if not isinstance(f, str) or not f.strip():
        raise usage(f'{where} needs "file": a path relative to the plan\'s folder, e.g. "audio/narration.wav"')
    p = (base / f).resolve()
    if not p.is_file():
        raise usage(f'{where}.file: {f} does not exist (looked for {relpath(p, None)})')
    return p


def parse_plan(raw, base: Path) -> dict:
    check_keys(raw, PLAN_KEYS, "plan")
    plan: dict = {}
    kind = raw.get("kind", DEFAULT_KIND)
    if kind not in LOUDNESS:
        raise usage(f'plan.kind must be "calm" (-16 LUFS) or "punchy" (-14 LUFS), got {json.dumps(kind)}')
    plan["kind"] = kind
    plan["target"] = num(raw, "loudness", "plan", LOUDNESS[kind], -40, -5)
    plan["target_source"] = "loudness" if "loudness" in raw else f"kind {kind}"
    plan["ceiling"] = num(raw, "true_peak", "plan", TRUE_PEAK, -12, 0)
    plan["max_limit_db"] = num(raw, "max_limit_db", "plan", MAX_LIMIT_DB, 0, 24)
    plan["duration"] = tkey(raw, "duration", "plan")
    if plan["duration"] is not None and plan["duration"] <= 0:
        raise usage("plan.duration must be > 0")
    plan["fade_in"] = tkey(raw, "fade_in", "plan", FADE_IN)
    plan["fade_out"] = tkey(raw, "fade_out", "plan", FADE_OUT)

    voice = raw.get("voice")
    items = [] if voice is None else (voice if isinstance(voice, list) else [voice])
    plan["voice"] = []
    for i, b in enumerate(items):
        where = f"voice[{i}]" if isinstance(voice, list) else "voice"
        if isinstance(b, str):
            b = {"file": b}
        check_keys(b, VOICE_KEYS, where)
        if isinstance(voice, list) and len(items) > 1 and "at" not in b:
            raise usage(f'{where} needs "at": where this block starts in the video (s)')
        plan["voice"].append({"file": need_file(b, where, base), "at": tkey(b, "at", where, 0.0),
                              "from": tkey(b, "from", where, 0.0), "dur": tkey(b, "dur", where),
                              "gain_db": num(b, "gain_db", where, 0.0, -60, 40)})

    music = raw.get("music")
    plan["music"] = None
    if music is not None:
        if isinstance(music, str):
            music = {"file": music}
        check_keys(music, MUSIC_KEYS, "music")
        if "gain_db" in music and "under_voice" in music:
            raise usage('music: give "gain_db" (a fixed gain) or "under_voice" (LU under the voice), not both')
        duck = music.get("duck", True)
        if duck is False or duck is None:
            dk = None
        else:
            d = {} if duck is True else check_keys(duck, DUCK_KEYS, "music.duck")
            dk = {"depth_db": num(d, "depth_db", "music.duck", DUCK_DEPTH_DB, 0, 40),
                  "attack": num(d, "attack", "music.duck", DUCK_ATTACK, 0, 5),
                  "hold": num(d, "hold", "music.duck", DUCK_HOLD, 0, 10),
                  "release": num(d, "release", "music.duck", DUCK_RELEASE, 0.01, 10)}
        plan["music"] = {"file": need_file(music, "music", base), "at": tkey(music, "at", "music", 0.0),
                         "from": tkey(music, "from", "music", 0.0), "dur": tkey(music, "dur", "music"),
                         "gain_db": num(music, "gain_db", "music", None, -60, 40),
                         "under_voice": num(music, "under_voice", "music", None, -10, 60),
                         "fade_in": tkey(music, "fade_in", "music", 0.0),
                         "fade_out": tkey(music, "fade_out", "music", 0.0), "duck": dk}

    fx = raw.get("effects") or []
    if not isinstance(fx, list):
        raise usage("plan.effects must be a list of {\"file\": ..., \"at\" | \"cue\" | \"word\" | ...: ...}")
    plan["effects"] = []
    for i, e in enumerate(fx):
        where = f"effects[{i}]"
        if isinstance(e, str):
            raise usage(f'{where}: an effect needs a time too, e.g. {{"file": "{e}", "at": 12.0}}')
        check_keys(e, FX_KEYS, where)
        when = [k for k in FX_WHEN if k in e]
        if len(when) != 1:
            raise usage(f"{where} needs exactly one of {', '.join(FX_WHEN)} (it has {', '.join(when) or 'none'})")
        align = e.get("align", "onset")
        if align not in ("onset", "peak"):
            raise usage(f'{where}.align must be "onset" (default) or "peak", got {json.dumps(align)}')
        edge = e.get("edge", "start")
        if edge not in ("start", "end"):
            raise usage(f'{where}.edge must be "start" (default) or "end", got {json.dumps(edge)}')
        nth = e.get("nth", 0)
        if isinstance(nth, bool) or not isinstance(nth, int):
            raise usage(f"{where}.nth must be a whole number (0 = the first occurrence), got {json.dumps(nth)}")
        if "gain_db" in e and ("target_db" in e or "peak_cap_db" in e):
            raise usage(f'{where}: "gain_db" sets the level by hand; drop "target_db"/"peak_cap_db" (they steer the solver)')
        plan["effects"].append({"file": need_file(e, where, base), "when": when[0], "value": e[when[0]], "nth": nth,
                                "edge": edge, "offset": num(e, "offset", where, 0.0, -10, 10), "align": align,
                                "gain_db": num(e, "gain_db", where, None, -80, 40),
                                "target_db": num(e, "target_db", where, FX_TARGET_DB, -20, 30),
                                "peak_cap_db": num(e, "peak_cap_db", where, FX_PEAK_CAP_DB, -20, 40),
                                "where": where})
    hits = raw.get("hits") or []
    if not isinstance(hits, list):
        raise usage('plan.hits must be a list of times or cue names, e.g. [20, "drop"]')
    plan["hits"] = hits
    plan["hit_lu"] = num(raw, "hit_lu", "plan", HIT_LU, 0, 40)
    plan["build_lu"] = num(raw, "build_lu", "plan", BUILD_LU, 0, 40)
    if not plan["voice"] and plan["music"] is None and not plan["effects"]:
        raise usage('the plan has no "voice", "music" or "effects": nothing to mix')
    return plan


def resolve_when(e: dict, data: TimingData) -> tuple[float, str]:
    why, kind, v = e["where"], e["when"], e["value"]
    if kind == "at":
        t, src = parse_time(v, f"{why}.at"), "at"
    elif kind == "cue":
        t, src = data.cue(str(v), why)
    elif kind == "word":
        t, src = data.word(str(v), e["nth"], e["edge"], why)
    elif kind == "line":
        t, src = data.line(str(v), e["nth"], e["edge"], why)
    else:
        if isinstance(v, bool) or not isinstance(v, int):
            raise usage(f"{why}.{kind} must be a whole number (an index into data/audio.json {kind}s)")
        t, src = data.beat(kind, v, why)
    return t + e["offset"], src + (f" {e['offset']:+.3f} s" if e["offset"] else "")


def resolve_hit(h, data: TimingData | None, cues: dict[str, float], sections: list[dict], why: str) -> float:
    if isinstance(h, (int, float)) and not isinstance(h, bool):
        return parse_time(h, why)
    if isinstance(h, str):
        if TIME_RE.fullmatch(h):
            return parse_time(h, why)
        if h in cues:
            return cues[h]
        for s in sections:
            if s["name"] == h:
                return s["start"]
        if data is not None:
            return data.cue(h, why)[0]
    raise usage(f"{why}: {json.dumps(h)} is neither a time nor a cue or section name")


# ------------------------------------------------------------------------------------------------ building blocks

def raised_cos(n: int) -> np.ndarray:
    return (0.5 - 0.5 * np.cos(np.pi * np.arange(n) / max(1, n))).astype(np.float32)


def fade(x: np.ndarray, a: int, b: int, fin: float, fout: float, cut_in: bool, cut_out: bool) -> None:
    """In place, on x[a:b]: musical fades (power curves, gentle into silence) and 10 ms anti-click edges on cuts."""
    n = b - a
    if n <= 0:
        return
    fi = int(round(fin * SR)) if fin > 0 else (int(ANTICLICK * SR) if cut_in else 0)
    fo = int(round(fout * SR)) if fout > 0 else (int(ANTICLICK * SR) if cut_out else 0)
    fi, fo = min(fi, n), min(fo, n)
    if fi:
        ramp = raised_cos(fi) if fin <= 0 else ((np.arange(fi) / fi) ** 1.5).astype(np.float32)
        x[a:a + fi] *= ramp[:, None]
    if fo:
        ramp = raised_cos(fo)[::-1] if fout <= 0 else ((1 - (np.arange(1, fo + 1) / fo)) ** 1.5).astype(np.float32)
        x[b - fo:b] *= ramp[:, None]


def place(dst: np.ndarray, src: np.ndarray, start: int, gain: float = 1.0) -> tuple[int, int]:
    """Add gain * src into dst starting at sample `start` (negative = src starts before 0). Returns the dst span."""
    a, b = max(0, start), min(len(dst), start + len(src))
    if b > a:
        dst[a:b] += gain * src[a - start:b - start]
    return a, b


def voice_activity(v: np.ndarray):
    """Speech frames at 100 Hz from the placed voice: 50 ms RMS within VAD_REL_DB of its loud frames."""
    hop, win = SR // 100, int(VAD_WINDOW * SR)
    mono = v.mean(axis=1)
    e = np.maximum(uniform_filter1d(mono * mono, size=win, mode="constant"), 0.0)  # (running sums can dip below 0)
    centres = np.arange(0, len(v), hop)
    lv = 10 * np.log10(e[centres] + 1e-20)
    alive = lv > -70
    if not alive.any():
        return np.zeros(len(centres), bool), centres
    ref = np.percentile(lv[alive], 95)
    return lv >= ref - VAD_REL_DB, centres


def duck_curve(active: np.ndarray, depth: float, attack: float, hold: float, release: float,
               gaps: list[tuple[float, float]] = ()) -> np.ndarray:
    """The music's gain in dB per 10 ms frame: down by `depth` from `attack` before each spoken stretch (so it is
    fully down at the first syllable), through pauses shorter than `hold`, back up over `release`. Inside `gaps`
    (the silences between paragraphs, in seconds) it holds only DUCK_BLOCK_HOLD, so it rises there."""
    fa, fh = int(round(attack * 100)), int(round(hold * 100))
    cs = np.concatenate([[0], np.cumsum(active.astype(np.int64))])
    k = np.arange(len(active))
    want = (cs[np.minimum(len(active), k + fa + 1)] - cs[np.maximum(0, k - fh)]) > 0
    if len(gaps):
        fg = int(round(DUCK_BLOCK_HOLD * 100))
        want_gap = (cs[np.minimum(len(active), k + fa + 1)] - cs[np.maximum(0, k - fg)]) > 0
        for a, b in gaps:
            i0, i1 = max(0, int(a * 100)), min(len(active), int(math.ceil(b * 100)) + 1)
            want[i0:i1] = want_gap[i0:i1]
    up = 1.0 / max(1, round(attack * 100))
    down = 1.0 / max(1, round(release * 100))
    y = np.empty(len(active))
    prev = 0.0
    for i, w in enumerate(want):
        prev = min(1.0, prev + up) if w else max(0.0, prev - down)
        y[i] = prev
    return -depth * y


def frames_to_blocks(mask: np.ndarray, nb: int) -> np.ndarray:
    """A 100 Hz frame mask as a 1 ms block mask of length nb."""
    m = np.repeat(mask, 10)[:nb]
    return np.pad(m, (0, nb - len(m)))


def long_runs(mask: np.ndarray, min_len: int) -> np.ndarray:
    """The True runs of `mask` that last at least `min_len` frames."""
    d = np.diff(np.concatenate([[0], mask.astype(np.int8), [0]]))
    starts, ends = np.flatnonzero(d == 1), np.flatnonzero(d == -1)
    out = np.zeros(len(mask), bool)
    for a, b in zip(starts, ends):
        if b - a >= min_len:
            out[a:b] = True
    return out


def words_sync(v: np.ndarray, lines: list, video: dict, shift: float = 0.0) -> dict | None:
    """Each words.json line's start against the nearest onset of the placed voice: 5 ms RMS frames, an onset is a
    frame within 35 dB of the voice's loud frames that stays on for 20 ms after 150 ms of quiet."""
    hop = SR // 200
    mono = v.mean(axis=1)
    e = np.maximum(uniform_filter1d(mono * mono, size=hop, mode="constant"), 0.0)[hop // 2::hop]
    lv = 10 * np.log10(e + 1e-20)
    if not (lv > -70).any():
        return None
    on = lv >= np.percentile(lv[lv > -70], 95) - 35
    cs = np.concatenate([[0], np.cumsum(on)])
    i = np.arange(31, len(on) - 4)
    ok = on[i] & (cs[i + 4] - cs[i] == 4) & (cs[i] - cs[i - 30] == 0)  # on for 20 ms, after 150 ms of quiet
    ot = (i[ok] + 0.5) * hop / SR
    offs = []
    for li, line in enumerate(lines):
        if isinstance(line, dict) and isinstance(line.get("start"), (int, float)) and len(ot):
            t = line["start"] + shift
            d = float(ot[int(np.argmin(np.abs(ot - t)))] - t)
            offs.append((li, d if abs(d) <= 0.5 else None))
    found = [abs(d) for _, d in offs if d is not None]
    fps = video.get("fps") if isinstance(video.get("fps"), (int, float)) else 60
    worst = max(found, default=0.0)
    return {"lines": len(offs), "matched": len(found), "worst_ms": r(worst * 1000), "fps": fps,
            "worst_frames": r(worst * fps, 2),
            "flagged": [{"line": li, "offset_ms": r(d * 1000) if d is not None else None}
                        for li, d in offs if d is None or abs(d) > SYNC_TOL_S]}


def onset_and_peak(s: np.ndarray) -> tuple[int, int]:
    """(onset, loudest moment) of an effect, in samples from its file start (after decoding to 48 kHz)."""
    a = np.abs(s).max(axis=1)
    pk = float(a.max())
    if pk <= 0:
        return 0, 0
    over = np.flatnonzero(a >= pk * 10 ** (ONSET_REL_DB / 20))
    g = max(1, int(ONSET_GUARD_S * SR))
    fwd = maximum_filter1d(a, size=g, origin=-(g // 2), mode="constant", cval=0.0)  # max over [n, n+g-1]
    ok = over[fwd[over] >= pk * 10 ** (ONSET_GUARD_DB / 20)]
    onset = int(ok[0] if len(ok) else over[0])
    e = uniform_filter1d(s.astype(np.float64).__pow__(2).sum(axis=1), size=max(1, int(PEAK_RMS_S * SR)))
    return onset, int(np.argmax(e))


def band_of(sm: np.ndarray) -> tuple[float, float]:
    """The middle 60% of the effect's energy (20th to 80th percentile of its spectrum), at least an octave wide.
    A narrower band is widened around its geometric centre (motion-video-kit widened it upward only, which put a
    narrowband tick's own frequency on the filter's -3 dB edge)."""
    F = np.abs(np.fft.rfft(sm * np.hanning(len(sm)))) ** 2
    f = np.fft.rfftfreq(len(sm), 1 / SR)
    c = np.cumsum(F)
    if c[-1] <= 0:
        return 200.0, 4000.0
    c /= c[-1]
    lo = max(float(f[np.searchsorted(c, 0.2)]), 60.0)
    hi = max(float(f[np.searchsorted(c, 0.8)]), lo * 1.01)
    if hi < 2 * lo:
        centre = math.sqrt(lo * hi)
        lo, hi = centre / math.sqrt(2), centre * math.sqrt(2)
    lo = max(lo, 40.0)
    hi = min(hi, SR / 2 - 500)
    return lo, hi


def take(x: np.ndarray, a: int, b: int) -> np.ndarray:
    """x[a:b] with zeros where the range leaves the array."""
    out = np.zeros(b - a, dtype=np.float64)
    i0, i1 = max(a, 0), min(b, len(x))
    if i1 > i0:
        out[i0 - a:i1 - a] = x[i0:i1]
    return out


def window_stats(p: np.ndarray, q: np.ndarray, w0: int, W: int):
    """Per 50 ms window inside [w0, w0+W]: mean(p^2), mean(2pq), mean(q^2), so that the power of p + g*q in every
    window is A + g*C + g^2*D for any gain g without filtering again."""
    n, h = int(FX_PEAK_WIN * SR), int(FX_PEAK_HOP * SR)
    starts = np.arange(w0, w0 + max(W, n) - n + 1, h)
    A = np.array([np.mean(p[s:s + n] ** 2) for s in starts])
    C = np.array([np.mean(2 * p[s:s + n] * q[s:s + n]) for s in starts])
    D = np.array([np.mean(q[s:s + n] ** 2) for s in starts])
    return A, C, D


def typical_level(bed: np.ndarray, a: int, b: int) -> tuple[float, float]:
    """The bed's typical full-band level over [a, b): 75th percentile of its 50 ms window powers (dB) and of its
    50 ms window sample peaks (dB). SILENT when it is silent there."""
    n, h = int(FX_PEAK_WIN * SR), int(FX_PEAK_HOP * SR)
    y = np.asarray(bed[max(0, a):min(len(bed), b)], dtype=np.float64)
    if len(y) < n:
        return SILENT, SILENT
    s = np.arange(0, len(y) - n + 1, h)
    cs = np.concatenate([[0.0], np.cumsum(y * y)])
    pw = float(np.percentile(np.maximum((cs[s + n] - cs[s]) / n, 0.0), 75))
    pk = float(np.percentile(maximum_filter1d(np.abs(y), size=n, origin=-(n // 2), mode="constant")[s], 75))
    return (dbp(pw) if pw > 1e-14 else SILENT), (dbv(pk) if pk > 1e-7 else SILENT)


def floors(bed: np.ndarray, centre: int) -> tuple[float, float]:
    """(in-band/2-8 kHz power floor, sample-peak floor) in dB around `centre`: the typical level of the bed within
    +-10 s (of the whole bed when that stretch is silent) minus the margins. SILENT, SILENT when there is no bed."""
    pw, pk = typical_level(bed, centre - int(FX_CONTEXT_S * SR), centre + int(FX_CONTEXT_S * SR))
    if pw <= SILENT:
        pw, pk = typical_level(bed, 0, len(bed))
    if pw <= SILENT:
        return SILENT, SILENT
    return pw - FX_FLOOR_DB, pk - FX_PEAK_FLOOR_DB


def effect_metrics(bed: np.ndarray | None, contrib: np.ndarray, c0: int, onset_at: int, band: tuple[float, float],
                   W: int) -> dict:
    """Measured lift of one effect over the bed: in its band and at 2-8 kHz (loudest 50 ms in the window from its
    onset, against the bed's own level floored as the solver does) and its body (150 ms in-band RMS)."""
    if bed is None:
        return {}
    a, b = onset_at - int(FX_PAD * SR), onset_at + W + int(FX_PAD * SR)
    sb, sc = take(bed, a, b), take(contrib, a - c0, b - c0)  # contrib holds the effect's samples from c0 on
    B = signal.butter(4, band, "bandpass", fs=SR, output="sos")
    w0 = int(FX_PAD * SR)
    floor, _ = floors(bed, onset_at)
    out = {}
    for name, sos in (("band", B), ("hf", HF_SOS)):
        p, q = signal.sosfilt(sos, sb), signal.sosfilt(sos, sb + sc)
        A, _, _ = window_stats(p, np.zeros_like(p), w0, W)
        A2, _, _ = window_stats(q, np.zeros_like(q), w0, W)
        out[name] = dbp(A2.max()) - max(dbp(A.max()), floor)
    p, q = signal.sosfilt(B, sb), signal.sosfilt(B, sb + sc)
    nb = int(0.15 * SR)
    out["body"] = dbp(np.mean(q[w0:w0 + nb] ** 2)) - max(dbp(np.mean(p[w0:w0 + nb] ** 2)), floor)
    return out


def solve_effect(bed: np.ndarray, s: np.ndarray, start: int, onset: int, target: float, peak_cap: float,
                 band: tuple[float, float], W: int) -> dict:
    """motion-video-kit's per-event level solver, done right: the gain that lifts (bed + effect) `target` dB over
    the bed inside the effect's own band (loudest 50 ms from the onset), capped so the 2-8 kHz band lifts at most
    FX_HF_CAP_DB and the effect's peak sits at most `peak_cap` over the bed's local peak. The bed is zero-padded,
    so the window is aligned for effects in the first 0.5 s; an unreachable target returns the largest gain and
    says so (never a muted effect); over near-silent music the floors keep the effect audible."""
    t0 = start + onset
    pad = int(FX_PAD * SR)
    a, b = t0 - pad, t0 + W + pad
    sb = take(bed, a, b)
    sm = s.astype(np.float64).mean(axis=1)
    sc = np.zeros(b - a)
    place(sc[:, None], sm[:, None], start - a)
    B = signal.butter(4, band, "bandpass", fs=SR, output="sos")
    floor_b, floor_p = floors(bed, t0)
    floor_h = floor_b
    if floor_b <= SILENT:
        return {"gain": 1.0, "bound": "silent music (file level)", "unreachable": False}
    A, Cc, D = window_stats(signal.sosfilt(B, sb), signal.sosfilt(B, sc), pad, W)
    Ah, Ch, Dh = window_stats(signal.sosfilt(HF_SOS, sb), signal.sosfilt(HF_SOS, sc), pad, W)
    gdb = np.arange(FX_GAIN_MIN, FX_GAIN_MAX + 1e-9, FX_GAIN_STEP)
    g = 10 ** (gdb / 20)
    ref = max(dbp(A.max()), floor_b)
    lift = 10 * np.log10(np.maximum((A + g[:, None] * Cc + g[:, None] ** 2 * D).max(axis=1), 1e-30)) - ref
    href = max(dbp(Ah.max()), floor_h)
    hlift = 10 * np.log10(np.maximum((Ah + g[:, None] * Ch + g[:, None] ** 2 * Dh).max(axis=1), 1e-30)) - href
    i_t = np.flatnonzero(lift >= target)
    unreachable = len(i_t) == 0
    cand = {"target": gdb[i_t[0]] if len(i_t) else FX_GAIN_MAX}
    over = np.flatnonzero(hlift > FX_HF_CAP_DB)
    if len(over):
        cand["2-8 kHz cap"] = gdb[max(0, over[0] - 1)]
    local = float(np.abs(sb[pad:pad + W]).max()) if W > 0 else 0.0
    pk_ref = max(dbv(local), floor_p)
    spk = dbv(float(np.abs(s).max()))
    cand["peak cap"] = pk_ref + peak_cap - spk
    cand["+24 dB limit"] = FX_GAIN_MAX
    bound = min(cand, key=lambda k: cand[k])
    gd = float(cand[bound])
    if unreachable and bound == "target":
        bound = "+24 dB limit"
    return {"gain": 10 ** (gd / 20), "bound": bound, "unreachable": bool(unreachable),
            "floor_db": r(floor_b), "music_band_db": r(dbp(A.max()))}


# ------------------------------------------------------------------------------------------------ build

def locate_build(args) -> dict:
    plan_arg = Path(args.plan) if args.plan else None
    w = where(args.video, args.out, [plan_arg] if plan_arg is not None else [])
    if w.video_dir is not None:
        if plan_arg is None:
            plan = w.video_dir / "mix.json"
        elif not plan_arg.is_file() and not plan_arg.is_absolute() and (w.video_dir / plan_arg).is_file():
            plan = w.video_dir / plan_arg  # --plan mix.json with --video: the video's own
        else:
            plan = plan_arg
        if not plan.is_file():
            raise usage(f"no plan: {relpath(plan, w.project)} does not exist. Write one (format: mix.py build --help) "
                        "or pass --plan <file>.")
    else:
        if plan_arg is None:
            raise usage("build needs --video <video> (inside an audara project) or --plan <mix.json>")
        if not plan_arg.is_file():
            raise usage(f"--plan {args.plan}: no such file")
        plan = plan_arg
    return {"w": w, "project": w.project, "name": w.name, "vdir": w.video_dir, "plan": plan.resolve(),
            "audio": w.audio_dir, "data": w.data_dir, "out": w.review_dir}


def video_hints(ctx: dict, video: dict, dur: float, dsrc: str, data: TimingData) -> list[str]:
    """What video.json still needs for the preview and render.ts to play this mix at its length."""
    if ctx["vdir"] is None or not (ctx["vdir"] / "video.json").is_file():
        return []
    hints = []
    want = relpath(ctx["audio"] / "mix.wav", ctx["vdir"])
    if video.get("audio") != want:
        hints.append(f"set \"audio\": \"{want}\" in video.json to hear this mix in the preview (and reload it)")
    vd = video.get("duration") if isinstance(video.get("duration"), (int, float)) else None
    ad = None
    if data.exists("audio.json"):
        try:
            ad = load_json(data.dir / "audio.json", "audio.json").get("duration")
        except (Fail, AttributeError):
            ad = None
    if dsrc != "video.json":
        if vd is not None and abs(vd - dur) > 0.05:
            hints.append(f"set \"duration\": {dur:.3f} in video.json (its {vd:g} s, a placeholder, would "
                         f"{'cut' if vd < dur else 'pad'} the mix)")
        elif vd is None and isinstance(ad, (int, float)) and abs(ad - dur) > 0.05:
            hints.append(f"set \"duration\": {dur:.3f} in video.json: without it the video takes its length from "
                         f"data/audio.json ({ad:.3f} s), and render.ts refuses a soundtrack of another length")
    return hints


def applied_gain_db(written: np.ndarray, raw: np.ndarray, offset: int, a: int, b: int, gain_db: float) -> np.ndarray:
    """The gain the mix applied to a layer, per 20 ms window of [a, b): the written stem against the raw file placed
    at the same samples (raw sample = written sample - offset), less its fixed gain. Windows where either is
    silent are left out."""
    w = SR // 50
    out = []
    for s0 in range(max(a, 0), min(b, len(written)) - w + 1, w):
        r0 = s0 - offset
        if r0 < 0 or r0 + w > len(raw):
            continue
        er = float(np.mean(raw[r0:r0 + w].astype(np.float64) ** 2))
        eo = float(np.mean(written[s0:s0 + w].astype(np.float64) ** 2))
        if er > 1e-10 and eo > 1e-14:
            out.append(10 * math.log10(eo / er) - gain_db)
    return np.array(out)


def flat(o, prefix=""):
    out = {}
    if isinstance(o, dict):
        for k, v in o.items():
            out.update(flat(v, f"{prefix}.{k}" if prefix else str(k)))
    elif isinstance(o, list):
        for i, v in enumerate(o):
            out.update(flat(v, f"{prefix}[{i}]"))
    else:
        out[prefix] = o
    return out


def plan_diff(old: dict, new: dict) -> list[str]:
    a, b = flat(old), flat(new)
    out = []
    for k in sorted(set(a) | set(b)):
        if k not in a:
            out.append(f"{k}: added {json.dumps(b[k])}")
        elif k not in b:
            out.append(f"{k}: removed (was {json.dumps(a[k])})")
        elif a[k] != b[k]:
            out.append(f"{k}: {json.dumps(a[k])} -> {json.dumps(b[k])}")
    return out


def archive_round(ctx: dict, mix: Path, rec_path: Path, old: dict | None) -> str | None:
    """Keep the previous mix (lossless FLAC) and its record in out/<video>/mix-rounds/ before it is replaced."""
    if not mix.is_file():
        return None
    rnd = int(old.get("round", 0)) if old else 0
    d = ctx["out"] / "mix-rounds"
    d.mkdir(parents=True, exist_ok=True)
    stem = f"round-{rnd:02d}"
    p = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(mix), "-c:a", "flac",
                        str(d / f"{stem}-mix.flac")], capture_output=True)
    if p.returncode != 0:
        note(f"warning: could not keep the previous round as FLAC: {p.stderr.decode('utf-8', 'replace').strip()[-200:]}")
        return None
    if rec_path.is_file():
        shutil.copyfile(rec_path, d / f"{stem}-mix.wav.request.json")
    kept = sorted({f.name.split("-mix")[0] for f in d.glob("round-*-mix.flac")}, key=lambda s: int(s.split("-")[1]))
    for old_stem in kept[:-ROUNDS_KEPT]:
        for f in d.glob(old_stem + "-*"):
            f.unlink(missing_ok=True)
    return relpath(d / f"{stem}-mix.flac", ctx["project"])


def cmd_build(args) -> dict:
    need_ffmpeg()
    ctx = locate_build(args)
    root = ctx["project"]
    raw = load_json(ctx["plan"], "plan")
    base = ctx["plan"].parent
    plan = parse_plan(raw, base)
    data = TimingData(ctx["data"], root)
    vjson = (ctx["vdir"] / "video.json") if ctx["vdir"] else None
    video = load_json(vjson, "video.json") if vjson and vjson.is_file() else {}
    if not isinstance(video, dict):
        video = {}

    # Every input's hash: for the fingerprint, and to find the layer the timing data was made from (its times
    # move with that layer: music placed at 2 s moves its beats and cues by 2 s).
    shas = {}
    for p in [b["file"] for b in plan["voice"]] + ([plan["music"]["file"]] if plan["music"] else []) + \
             [e["file"] for e in plan["effects"]]:
        shas[p] = sha256(p)
    inputs = {relpath(p, root): h for p, h in shas.items()}
    notes: list[str] = []
    data.shift_audio, audio_layer, _ = layer_shift(data, "audio.json", plan, shas)
    data.shift_words, words_layer, words_doc = layer_shift(data, "words.json", plan, shas)
    gaps = block_gaps(words_doc, words_layer, data.shift_words)
    for name, layer, sh in (("audio.json", audio_layer, data.shift_audio), ("words.json", words_layer, data.shift_words)):
        if layer and abs(sh) > 0.0005:
            notes.append(f"data/{name} was timed to the {layer} file: its times move {sh:+.3f} s with it")

    # When each effect lands, and the hits to report: from the plan and the video's timing data (cheap: no audio).
    for e in plan["effects"]:
        e["t"], e["source"] = resolve_when(e, data)
    hit_times = [(h, resolve_hit(h, data, {}, [], f"plan.hits[{i}]")) for i, h in enumerate(plan["hits"])]

    # Up to date? The fingerprint covers the plan, every input file, the timing data it read and this script.
    # video.json's duration counts only once the video plays a soundtrack: init's 30 s placeholder sits beside
    # "audio": null, and is no length anyone chose for this mix.
    vdur = video.get("duration") if isinstance(video.get("duration"), (int, float)) else None
    vdur_used = float(vdur) if vdur and plan["duration"] is None and video.get("audio") is not None else None
    fp_src = {"version": MIX_VERSION, "plan": raw, "inputs": inputs, "data": data.used,
              "video_duration": vdur_used}
    fingerprint = hashlib.sha256(json.dumps(fp_src, sort_keys=True).encode("utf-8")).hexdigest()
    ctx["audio"].mkdir(parents=True, exist_ok=True)
    mix_path, mo_path = ctx["audio"] / "mix.wav", ctx["audio"] / "music-only.wav"
    rec_path = ctx["audio"] / "mix.wav.request.json"
    old = None
    if rec_path.is_file():
        try:
            old = load_json(rec_path, "the previous record")
        except Fail:
            old = None
    if (old and not args.force and old.get("fingerprint") == fingerprint and mix_path.is_file() and mo_path.is_file()
            and old.get("outputs", {}).get("mix.wav") == sha256(mix_path)
            and old.get("outputs", {}).get("music-only.wav") == sha256(mo_path)):
        rs = old.get("resolved") or {}
        return {"ok": True, "status": "up to date", "round": old.get("round"), "record": old, "ctx": ctx,
                "hints": video_hints(ctx, video, float(rs.get("duration") or 0), str(rs.get("duration_source")), data),
                "uv_cache": uv_cache()}

    # Decode everything once (ffmpeg's gapless decode, 48 kHz stereo).
    note(f"mix: decoding {len(inputs)} input file(s)")
    fx_info = []
    for e in plan["effects"]:
        s = decode(e["file"])
        onset, peak = onset_and_peak(s)
        land = onset if e["align"] == "onset" else peak
        fx_info.append({"s": s, "onset": onset, "peak": peak, "start": int(round(e["t"] * SR)) - land})
    M = decode(plan["music"]["file"]) if plan["music"] else None

    # Duration: the plan's; else video.json's, once the video plays a soundtrack (see vdur_used); else the end of
    # what sounds: the voice's last sound + END_PAD, the music's end, the last effect's last sound + END_PAD.
    voice_end = None
    for b in plan["voice"]:
        x = decode(b["file"])
        a0 = int(round(b["from"] * SR))
        a1 = min(len(x), a0 + int(round(b["dur"] * SR))) if b["dur"] is not None else len(x)
        if last_sound(x[a0:a1]):
            e_ = b["at"] + last_sound(x[a0:a1]) / SR
            voice_end = e_ if voice_end is None else max(voice_end, e_)
    if plan["duration"] is not None:
        dur, dsrc = plan["duration"], "plan"
    elif vdur_used:
        dur, dsrc = vdur_used, "video.json"
    else:
        ends = []
        if voice_end is not None:
            ends.append((voice_end + END_PAD, "the voice's end + 0.5 s"))
        if M is not None:
            mu = plan["music"]
            avail = len(M) / SR - mu["from"]
            ends.append((mu["at"] + (min(avail, mu["dur"]) if mu["dur"] is not None else avail), "the music's end"))
        ends += [((i["start"] + last_sound(i["s"])) / SR + END_PAD, "the last effect + 0.5 s") for i in fx_info
                 if last_sound(i["s"])]
        if not ends:
            raise usage("the plan's files are silent: nothing gives the mix a length (set \"duration\" in the plan)")
        dur, dsrc = max(ends)
        if vdur and video.get("audio") is None:
            notes.append(f"video.json's duration ({vdur:g} s) sits beside \"audio\": null, the placeholder of a video "
                         "with no soundtrack yet: not used")
    if voice_end is not None and voice_end > dur + 0.01 and dsrc != "plan":
        raise usage(f"the voice sounds until {voice_end:.2f} s, but the mix would end at {dur:.2f} s ({dsrc}): set "
                    f"\"duration\" to {voice_end + END_PAD:.2f} or more in video.json, or set \"duration\" in the plan "
                    f"to cut the voice on purpose")
    n = int(round(dur * SR))
    if n < SR // 10:
        raise usage(f"the mix would last {dur:.3f} s: set \"duration\" in the plan")

    # Voice (one file, or blocks each at its time). Decoded inputs are dropped once placed: a 10-minute stereo
    # 48 kHz layer is 230 MB, so the build keeps only the layers it needs.
    V = np.zeros((n, 2), np.float32)
    vrows = []
    for i, b in enumerate(plan["voice"]):
        x = decode(b["file"])
        a0 = int(round(b["from"] * SR))
        a1 = min(len(x), a0 + int(round(b["dur"] * SR))) if b["dur"] is not None else len(x)
        at = int(round(b["at"] * SR))
        pa, pb = place(V, x[a0:a1], at, 10 ** (b["gain_db"] / 20))
        fade(V, pa, pb, 0, 0, a0 > 0, a1 < len(x))  # anti-click edges only where the block is cut from its file
        cut = x[a0 + max(0, n - at):a1]
        if len(cut) and peak_abs(cut) > 10 ** (DEAD_DBFS / 20):  # only a cut that removes sound
            notes.append(f"voice{'' if len(plan['voice']) == 1 else f'[{i}]'} is still sounding at the end of the mix: "
                         f"{len(cut) / SR:.2f} s of it are cut")
        vrows.append({"file": relpath(b["file"], root), "at": round(b["at"], 3), "end": round(pb / SR, 3),
                      "gain_db": b["gain_db"]})
    for b in plan["voice"]:
        forget(b["file"])
    has_voice = bool(plan["voice"]) and peak_abs(V) > 0
    active = centres = None
    if has_voice:
        active, centres = voice_activity(V)

    # Music: placed, faded, ducked under the voice, then set to its level.
    Mx = np.zeros((n, 2), np.float32)
    has_music = M is not None
    mrow = None
    duck_db = None
    kv = None
    if has_music:
        mu = plan["music"]
        a0 = int(round(mu["from"] * SR))
        a1 = min(len(M), a0 + int(round(mu["dur"] * SR))) if mu["dur"] is not None else len(M)
        at = int(round(mu["at"] * SR))
        pa, pb = place(Mx, M[a0:a1], at)
        fade(Mx, pa, pb, mu["fade_in"], mu["fade_out"], a0 > 0, a1 < len(M) or at + (a1 - a0) > n)
        mend, avail = pb / SR, len(M) / SR - mu["from"]
        M = None
        forget(mu["file"])
        if mend - mu["at"] < avail - 0.001 and mu["fade_out"] <= 0 and mu["dur"] is None:
            notes.append(f"the music is cut at {mend:.2f} s ({avail:.2f} s available) with a 10 ms anti-click edge: "
                         "add music.fade_out for a musical ending")
        if mend < dur - 0.05:
            notes.append(f"the music ends at {mend:.2f} s, {dur - mend:.2f} s before the end of the mix")
        mrow = {"file": relpath(mu["file"], root), "at": round(mu["at"], 3), "from": round(mu["from"], 3),
                "end": round(mend, 3)}
        if has_voice and mu["duck"]:
            dk = mu["duck"]
            duck_db = duck_curve(active, dk["depth_db"], dk["attack"], dk["hold"], dk["release"], gaps)
            for i0 in range(0, n, SR * 10):
                i1 = min(n, i0 + SR * 10)
                Mx[i0:i1] *= (10 ** (np.interp(np.arange(i0, i1), centres, duck_db) / 20)).astype(np.float32)[:, None]
            mrow["duck"] = dk
        gain_db = mu["gain_db"]
        if gain_db is None and has_voice:
            want = mu["under_voice"] if mu["under_voice"] is not None else UNDER_VOICE_LU
            kv, km = KEnergy(V, phone=False), KEnergy(Mx, phone=False)
            mask = frames_to_blocks(active, len(kv.cnt))
            lv, lm = kv.masked(mask), km.masked(mask)
            if lm <= SILENT:
                gain_db = 0.0
                notes.append("the music is silent wherever the voice speaks, so under_voice can't set its level: "
                             "it stays at its file level (set music.gain_db)")
            else:
                gain_db = lv - want - lm
            mrow["under_voice_target"] = want
        elif gain_db is None:
            gain_db = 0.0
        Mx *= np.float32(10 ** (gain_db / 20))
        mrow["gain_db"] = round(gain_db, 2)

    if not has_music:
        notes.append("no music in the plan: music-only.wav is written anyway, as silence")

    # Effects: each lands by its measured onset (or loudest moment), its level solved against the music.
    bed = bed_name = None
    if has_music and peak_abs(Mx) > 0:
        bed, bed_name = Mx.mean(axis=1), "music"
    elif has_voice:
        bed, bed_name = V.mean(axis=1), "voice (no music)"
    FX = np.zeros((n, 2), np.float32)
    frows = []
    for e, info in zip(plan["effects"], fx_info):
        s, start = info["s"], info["start"]
        band = band_of(s.astype(np.float64).mean(axis=1))
        W = int(min(max(len(s) - info["onset"], FX_PEAK_WIN * SR), FX_WINDOW * SR))
        if e["gain_db"] is not None:
            sol = {"gain": 10 ** (e["gain_db"] / 20), "bound": "gain_db (by hand)", "unreachable": False}
        elif bed is None:
            sol = {"gain": 1.0, "bound": "no music or voice to set it against (file level)", "unreachable": False}
        else:
            sol = solve_effect(bed, s, start, info["onset"], e["target_db"], e["peak_cap_db"], band, W)
        frows.append({"file": relpath(e["file"], root), "where": e["where"], "time": round(e["t"], 4),
                      "source": e["source"], "align": e["align"], "onset_ms": round(info["onset"] / SR * 1000, 2),
                      "peak_ms": round(info["peak"] / SR * 1000, 2), "placed_at": round(start / SR, 4),
                      "band_hz": [round(band[0]), round(band[1])], "gain_db": dbv(sol["gain"]), "bound": sol["bound"],
                      "unreachable": sol["unreachable"], "target_db": e["target_db"] if e["gain_db"] is None else None,
                      "_g": sol["gain"], "_start": start, "_W": W, "_band": band})
        if start < 0:
            notes.append(f"{e['where']} would start {-start / SR * 1000:.0f} ms before 0 s; its first part is cut")
        tail = s[max(0, n - start):]
        if len(tail) and peak_abs(tail) > 10 ** (DEAD_DBFS / 20):
            notes.append(f"{e['where']} is still sounding at the end of the mix: {len(tail) / SR:.2f} s of it are cut")
    order = sorted(range(len(frows)), key=lambda i: frows[i]["time"])
    for j, i in enumerate(order):
        ti = frows[i]["time"]
        if any(0 <= ti - frows[k]["time"] < FX_CLUSTER_S for k in order[:j]):
            frows[i]["_g"] *= FX_CLUSTER_GAIN
            frows[i]["gain_db"] = dbv(frows[i]["_g"])
            frows[i]["bound"] += f", x{FX_CLUSTER_GAIN} (within {FX_CLUSTER_S * 1000:.0f} ms of another effect)"
    for row, info in zip(frows, fx_info):
        place(FX, info["s"], row["_start"], row["_g"])
    bed = None

    # Master: one gain to the target, then the true-peak limiter (if needed), iterated until the limited mix
    # measures on target or the limiting would exceed max_limit_db.
    S = V + Mx
    S += FX
    del FX
    if peak_abs(S) <= 0:
        raise usage("the mix is silent: check the files and gains in the plan")
    master = np.ones(n, np.float32)  # the master fades, also applied to the music-only stem
    fade(master[:, None], 0, n, plan["fade_in"], plan["fade_out"], False, False)
    S *= master[:, None]
    note("mix: normalizing and limiting")
    tp = tp_envelope(S)
    I0 = KEnergy(S, phone=False).integrated()
    target, ceiling, maxlim = plan["target"], plan["ceiling"], plan["max_limit_db"]
    aim = ceiling - TP_MARGIN
    tries = 0
    rnd_note = None
    while True:
        P0 = dbv(float(tp.max()))
        G = target - I0
        limited = False
        if G + P0 - aim > maxlim:
            G, limited = aim + maxlim - P0, True
        for _ in range(6):
            env = limiter_gain(tp, 10 ** (G / 20), aim)
            if env is None:  # a pure gain: the loudness moves by exactly G
                I = I0 + G
                break
            out = S * np.float32(10 ** (G / 20))
            out *= env[:, None]
            I = KEnergy(out, phone=False).integrated()
            del out
            if limited or abs(target - I) < 0.05:
                break
            G += target - I
            if G + P0 - aim > maxlim:
                G, limited = aim + maxlim - P0, True
        g_mix = np.full(n, np.float32(10 ** (G / 20)), np.float32) if env is None else env * np.float32(10 ** (G / 20))
        g_stem = g_mix * master  # S already carries the master fades; the music layer gets them here
        if tries == 0:
            rnd_note = archive_round(ctx, mix_path, rec_path, old)
        write_wav(mix_path, S * g_mix[:, None])
        write_wav(mo_path, Mx * g_stem[:, None])
        meas = ebur128(mix_path)
        if meas["true_peak_dbtp"] is not None and meas["true_peak_dbtp"] > ceiling and tries < 2:
            aim -= meas["true_peak_dbtp"] - ceiling + 0.05
            tries += 1
            note(f"mix: true peak measured {meas['true_peak_dbtp']:.1f} dBTP, over {ceiling:.1f}: limiting again")
            continue
        break

    # Read the written files back: everything below is measured on them (and on the voice and effect layers as
    # they went into them).
    mix_r = decode(mix_path, fresh=True)
    mo_r = decode(mo_path, fresh=True)
    if len(mix_r) != n or len(mo_r) != n:
        raise failure(f"read back {len(mix_r)} and {len(mo_r)} samples, expected {n}: the WAV writer misbehaved")
    resid = 0.0  # mix - music-only must be exactly voice + effects: the written files against the computed layers
    for i0 in range(0, n, SR * 10):
        i1 = min(n, i0 + SR * 10)
        d = (mix_r[i0:i1] - mo_r[i0:i1]) - (S[i0:i1] * g_mix[i0:i1, None] - Mx[i0:i1] * g_stem[i0:i1, None])
        resid = max(resid, float(np.abs(d).max()))
    del S, Mx
    lim = {"gain_db": round(G, 2), "limited": env is not None}
    if env is not None:
        kmin = int(np.argmin(env))
        lim.update({"max_reduction_db": round(-dbv(float(env[kmin])), 2), "at_s": round(kmin / SR, 3),
                    "seconds_over_1db": round(float((env < 10 ** (-1 / 20)).sum()) / SR, 3)})
    lim["stopped_short_of_target"] = bool(limited and target - I > SHORT_LU)

    k_mix = KEnergy(mix_r, phone=True)
    sections = []
    if data.exists("audio.json"):
        aj = data.get("audio.json", "the report's sections")
        for s in aj.get("sections") or []:
            if isinstance(s, dict) and isinstance(s.get("start"), (int, float)) and isinstance(s.get("end"), (int, float)):
                sections.append({"name": str(s.get("name", "?")), "start": float(s["start"]) + data.shift_audio,
                                 "end": float(s["end"]) + data.shift_audio})
    rep, curves, _ = analyze(mix_r, sections, [t for _, t in hit_times], k_mix, plan["hit_lu"], plan["build_lu"])
    rep.update(meas)
    del mix_r
    km_r = KEnergy(mo_r, phone=False)
    mt_m, mv_m = km_r.curve(0.4, 0.1)
    curves["m_music"] = (mt_m - 0.2, mv_m)

    # The balance as heard: the voice layer as it went into the mix against the written music-only stem, while the
    # voice speaks and in the pauses where the duck has fully released.
    V *= g_stem[:, None]
    balance = {}
    if has_voice:
        kv = KEnergy(V, phone=False)
        nb = len(kv.cnt)
        act_b = frames_to_blocks(active, nb)
        lv = kv.masked(act_b)
        balance["voice_lufs_speaking"] = r(lv)
        if has_music:
            lm = km_r.masked(act_b)
            balance["music_under_voice_lu"] = r(lv - lm) if lm > SILENT else None
            if duck_db is not None:
                runs = long_runs((duck_db >= -1e-6) & ~active, int(PAUSE_MEASURE_S * 100))
                if runs.any():
                    lp = km_r.masked(frames_to_blocks(runs, nb))
                    balance["music_in_pauses_under_voice_lu"] = r(lv - lp) if lp > SILENT else None
                    balance["pause_seconds_measured"] = round(float(runs.sum()) / 100, 2)
                balance["duck_depth_applied_db"] = r(-float(duck_db.min()))
                if gaps:  # measured on the written stem: music-only.wav against the raw music at the same samples
                    mu = plan["music"]
                    rawm = decode(mu["file"])
                    off = int(round(mu["at"] * SR)) - int(round(mu["from"] * SR))
                    gdb = mrow["gain_db"]
                    rises = []
                    for g0, g1 in gaps:
                        inside = applied_gain_db(mo_r, rawm, off, int(g0 * SR), int(g1 * SR), gdb)
                        before = applied_gain_db(mo_r, rawm, off, int((g0 - 1.0) * SR), int((g0 - 0.2) * SR), gdb)
                        if len(inside) and len(before):
                            rises.append(float(inside.max() - np.median(before)))
                    forget(mu["file"])
                    del rawm
                    if rises:
                        balance["block_gaps"] = len(gaps)
                        balance["music_rise_between_blocks_db"] = {"median": r(float(np.median(rises))),
                                                                   "min": r(min(rises)), "max": r(max(rises))}

    # Effects as they ended up: where each landed and its lift, measured on its placed samples against the written
    # music-only stem (local windows only).
    bed_r = mo_r.mean(axis=1) if bed_name == "music" else (V.mean(axis=1) if bed_name else None)
    del mo_r
    for row, info in zip(frows, fx_info):
        s, start = info["s"], row["_start"]
        a, b = max(0, start), min(n, start + len(s))
        if b <= a:
            row.update({"lands_at": None, "landing_error_ms": None, "lift_db": None, "hf_lift_db": None, "body_db": None})
            continue
        c = s[a - start:b - start].astype(np.float64).mean(axis=1) * row["_g"] * g_stem[a:b]
        on_c, pk_c = onset_and_peak(np.stack([c, c], axis=1))
        landed = (a + (on_c if row["align"] == "onset" else pk_c)) / SR
        row["lands_at"] = round(landed, 5)
        row["landing_error_ms"] = round((landed - row["time"]) * 1000, 2)
        m = effect_metrics(bed_r, c, a, start + info["onset"], row["_band"], row["_W"])
        row.update({"lift_db": r(m.get("band")), "hf_lift_db": r(m.get("hf")), "body_db": r(m.get("body"))})
        row["gain_db"] = r(row["gain_db"], 2)
    by_file: dict[str, list] = {}
    for row in frows:
        by_file.setdefault(row["file"], []).append(row["gain_db"])
    for f, gs in by_file.items():
        if len(gs) > 1 and max(gs) - min(gs) > 6:
            notes.append(f"{f} is used {len(gs)} times at gains {min(gs):+.1f} to {max(gs):+.1f} dB: set gain_db on "
                         "them if they should sound the same")

    # Sync of the narration with data/words.json (the picture finds words there): line starts vs voice onsets.
    sync = None
    if has_voice and data.exists("words.json") and (words_layer is None or words_layer.startswith("voice")):
        try:
            lines = load_json(data.dir / "words.json", "words.json").get("lines") or []
        except Fail:
            lines = []
        sync = words_sync(V, lines, video, data.shift_words)

    # The engine's view: which file video.json plays, and the length it gives the video.
    hints = video_hints(ctx, video, dur, dsrc, data)

    # PNG + JSON report, then the record.
    in_project_cache = mpl_cache(ctx["w"])
    tag = ctx["name"] or ctx["plan"].stem
    png = ctx["out"] / "mix-report.png"
    jpath = ctx["out"] / "mix-report.json"
    marks = [(row["time"], f"fx{i}") for i, row in enumerate(frows)]
    duck_panel = None
    if duck_db is not None:
        duck_panel = (centres / SR, duck_db, active)
    title = (f"{tag} / mix.wav   {dur:.2f} s   I {rep['integrated_lufs']:.1f} LUFS (target {target:g})   "
             f"LRA {rep['lra_lu']:.1f} LU   true peak {rep['true_peak_dbtp']:.1f} dBTP")
    draw_png(png, title, rep, curves, {"marks": marks, "duck": duck_panel})
    if in_project_cache:
        notes.append(cache_size_note(in_project_cache, ctx["w"]))
    rep_out = {"file": relpath(mix_path, root), **rep, "png": relpath(png, root), "time_origin": TIME_ORIGIN}
    write_json(jpath, rep_out)

    for row in frows:
        for k in [k for k in row if k.startswith("_")]:
            row.pop(k)
    rnd = int(old.get("round", 0)) + 1 if old else 1
    changes = plan_diff(old.get("plan", {}), raw) if old and isinstance(old.get("plan"), dict) else []
    if old:
        for f, h in inputs.items():
            if old.get("inputs", {}).get(f) not in (None, h):
                changes.append(f"{f}: the file changed")
        if old.get("version") != MIX_VERSION:
            changes.append(f"mix.py changed (version {old.get('version')} -> {MIX_VERSION})")
    record = {
        "tool": "audara-studio soundtrack/scripts/mix.py", "version": MIX_VERSION, "round": rnd,
        "built_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "fingerprint": fingerprint, "plan_file": relpath(ctx["plan"], root), "plan": raw, "inputs": inputs,
        "data": data.used, "changed_since_previous": changes,
        "resolved": {"duration": round(dur, 4), "duration_source": dsrc, "voice": vrows, "music": mrow,
                     "timing_data": {"audio.json": {"layer": audio_layer, "shift_s": round(data.shift_audio, 4)},
                                     "words.json": {"layer": words_layer, "shift_s": round(data.shift_words, 4)},
                                     "block_gaps": len(gaps)},
                     "effects": frows, "bed": bed_name,
                     "master": {"target_lufs": target, "target_source": plan["target_source"], "ceiling_dbtp": ceiling,
                                "max_limit_db": maxlim, **lim}},
        "measured": {k: rep.get(k) for k in ("integrated_lufs", "lra_lu", "true_peak_dbtp", "sample_peak_dbfs",
                                             "integrated_lufs_phone", "first_sound_s", "dead_tail_s",
                                             "quiet_intro_s", "last_2s_lufs")},
        "balance": balance, "hits": rep["hits"], "warnings": rep["warnings"], "sync": sync,
        "stems_residual_dbfs": r(dbv(resid)),
        "outputs": {"mix.wav": sha256(mix_path), "music-only.wav": sha256(mo_path)},
        "notes": notes, "time_origin": TIME_ORIGIN,
    }
    write_json(rec_path, record)
    return {"ok": True, "status": "built", "round": rnd, "record": record, "ctx": ctx, "rep": rep,
            "archived": rnd_note, "hints": hints, "png": png, "json": jpath, "files": [mix_path, mo_path, rec_path],
            "uv_cache": uv_cache()}


def print_build(res: dict) -> None:
    ctx, rec = res["ctx"], res["record"]
    root = ctx["project"]
    mix = relpath(ctx["audio"] / "mix.wav", root)
    if res["status"] == "up to date":
        m = rec.get("measured", {})
        print(f"mix: {mix} is up to date with {rec.get('plan_file')} (round {rec.get('round')}): nothing changed in the "
              "plan, its files or its timing data. --force rebuilds anyway.")
        print(f"  measured: I {m.get('integrated_lufs')} LUFS, LRA {m.get('lra_lu')} LU, true peak "
              f"{m.get('true_peak_dbtp')} dBTP; the full numbers are in {relpath(ctx['audio'] / 'mix.wav.request.json', root)}")
        png = ctx["out"] / "mix-report.png"
        print(f"  report: {relpath(png, root)}" if png.is_file() else
              f"  report: {relpath(png, root)} is gone (out/ is not kept): --force rebuilds it, or run measure on mix.wav")
        for s in rec.get("warnings") or []:
            print(f"  {s}")
        for s in (rec.get("notes") or []) + ([res["uv_cache"]["note"]] if res.get("uv_cache") else []):
            print(f"  note: {s}")
        for h in res.get("hints") or []:
            print(f"  next: {h}")
        return
    rs = rec["resolved"]
    m = rec["measured"]
    ms = rs["master"]
    print(f"mix: {mix}  {rs['duration']:.3f} s (from {rs['duration_source']}), 48 kHz 24-bit stereo, round {rec['round']}")
    if rec["changed_since_previous"]:
        print("  changed since the previous round: " + "; ".join(rec["changed_since_previous"]))
        if len([c for c in rec["changed_since_previous"] if "the file changed" not in c]) > 1:
            print("    (more than one change this round: if a note was about one thing, A/B them one at a time)")
    if res.get("archived"):
        print(f"  previous round kept: {res['archived']}")
    lim = ""
    if ms.get("limited"):
        lim = (f"; limiter at most {ms['max_reduction_db']:.1f} dB (at {ms['at_s']:.3f} s), "
               f"{ms['seconds_over_1db']:.2f} s over 1 dB")
    print(f"  loudness: I {m['integrated_lufs']} LUFS (target {ms['target_lufs']:g}, {ms['target_source']}), "
          f"LRA {m['lra_lu']} LU, true peak {m['true_peak_dbtp']} dBTP (ceiling {ms['ceiling_dbtp']:g}){lim}")
    if ms.get("stopped_short_of_target"):
        print(f"    short of the target: reaching it needs more than {ms['max_limit_db']:g} dB of peak limiting, which "
              "dulls the loudest moments; raise \"max_limit_db\" or lower \"loudness\" if that is fine")
    for v in rs["voice"]:
        print(f"  voice: {v['file']} at {v['at']:.3f} s, gain {v['gain_db']:+.1f} dB")
    b = rec["balance"]
    if rs["music"]:
        mu = rs["music"]
        s = f"  music: {mu['file']} at {mu['at']:.3f} s, gain {mu['gain_db']:+.1f} dB"
        if b.get("music_under_voice_lu") is not None:
            s += f"; measured {b['music_under_voice_lu']:.1f} LU under the voice while it speaks"
            if mu.get("under_voice_target") is not None:
                s += f" (asked {mu['under_voice_target']:g})"
        if b.get("duck_depth_applied_db") is not None:
            s += f"; ducked {b['duck_depth_applied_db']:.1f} dB"
            if b.get("music_in_pauses_under_voice_lu") is not None:
                s += (f", {b['music_in_pauses_under_voice_lu']:.1f} LU under the voice's level in "
                      f"{b['pause_seconds_measured']:.1f} s of pauses")
        print(s)
        if b.get("music_rise_between_blocks_db"):
            g = b["music_rise_between_blocks_db"]
            print(f"  between the narration's {b['block_gaps'] + 1} paragraphs (data/words.json lines) the music rises "
                  f"{g['median']:+.1f} dB on median ({g['min']:+.1f} to {g['max']:+.1f}; measured on music-only.wav)")
    if rs["effects"]:
        print(f"  effects (placed by measured onset; level in their own band against the {rs['bed'] or 'music'}):")
        for i, e in enumerate(rs["effects"]):
            what = "loudest moment" if e["align"] == "peak" else "onset"
            lead = e["peak_ms"] if e["align"] == "peak" else e["onset_ms"]
            line = (f"    fx{i} {e['file']}: {what} at {e['lands_at']:.4f} s ({e['source']}; "
                    f"{e['landing_error_ms']:+.2f} ms), {lead:.1f} ms into the file; gain {e['gain_db']:+.1f} dB")
            if e.get("lift_db") is not None:
                line += (f"; lift {e['lift_db']:+.1f} dB in {e['band_hz'][0]}-{e['band_hz'][1]} Hz, "
                         f"2-8 kHz {e['hf_lift_db']:+.1f} dB")
            line += f" [{e['bound']}]"
            if e["unreachable"]:
                line += f" (target {e['target_db']:g} dB unreachable: the effect is too weak in its band)"
            print(line)
    def lu(v):
        return "n/a" if v is None else f"{v:+.1f} LU"

    for h in rec["hits"]:
        f, p = h["full"], h["phone"]
        on = f", measured onset {h['onset_s']:.3f} s ({h['onset_offset_ms']:+.0f} ms)" if h.get("onset_s") is not None \
            else ", no sharp attack" if h.get("onset_rise_db") is not None else ""
        print(f"  hit {h['t']:.3f} s{on}: {lu(f['contrast_lu'])} over the loudest 400 ms of the 4 s before (full "
              f"range), {lu(p['contrast_lu'])} through a 300 Hz high-pass (phone)")
        if h.get("contrast_warning"):
            print(f"    {h['contrast_warning']}")
        if h.get("build"):
            print(f"  {h['build']['summary']}")
    sy = rec.get("sync")
    if sy:
        if sy["flagged"]:
            fl = ", ".join(f"line {x['line']} " + (f"{x['offset_ms']:+.0f} ms" if x["offset_ms"] is not None else "no voice onset within 0.5 s")
                           for x in sy["flagged"][:5])
            print(f"  words.json vs the voice: {len(sy['flagged'])} of {sy['lines']} lines start more than "
                  f"{SYNC_TOL_S * 1000:.0f} ms from the voice ({fl}): the narration sits elsewhere than words.json says")
        else:
            print(f"  words.json vs the voice: {sy['matched']}/{sy['lines']} lines start within {sy['worst_ms']:.0f} ms "
                  f"({sy['worst_frames']:.2f} frames at {sy['fps']:g} fps) of the voice's measured onset")
    print(f"  stems: music-only.wav is the music exactly as in the mix (same gain, ducking and limiter); mix minus it "
          f"leaves voice and effects (residual {rec['stems_residual_dbfs']} dBFS)")
    flags = summary_flags(res["rep"])
    for s in flags + rec["notes"] + ([res["uv_cache"]["note"]] if res.get("uv_cache") else []):
        print(f"  note: {s}")
    files = [relpath(p, root) for p in res["files"]]
    print(f"  wrote: {', '.join(files)}; {relpath(res['png'], root)} (+ .json)")
    for h in res.get("hints") or []:
        print(f"  next: {h}")


# ------------------------------------------------------------------------------------------------ measure

def parse_sections(spec: str | None, dur: float, default_json: Path | None, root: Path | None):
    """Sections from a JSON file with sections[] (data/audio.json; its cues come along), or inline:
    "name:start,..." (each ends where the next starts) or "name:start-end,..." (explicit spans)."""
    if spec is None:
        if default_json is None or not default_json.is_file():
            return [], {}, None
        spec = str(default_json)
    p = Path(spec)
    if p.suffix.lower() == ".json" or p.is_file():
        j = load_json(p, "--sections")
        secs = []
        for i, s in enumerate((j.get("sections") if isinstance(j, dict) else None) or []):
            if not (isinstance(s, dict) and isinstance(s.get("start"), (int, float)) and isinstance(s.get("end"), (int, float))):
                raise usage(f"{p}: sections[{i}] needs name, start and end")
            secs.append({"name": str(s.get("name", f"s{i}")), "start": float(s["start"]), "end": float(s["end"])})
        cues = {}
        if isinstance(j, dict):
            td = TimingData(p.parent, root)
            td._cache["audio.json"] = j
            cues = td.cues("--sections")
        return secs, cues, relpath(p, root)
    secs, explicit = [], None
    for part in [x.strip() for x in spec.split(",") if x.strip()]:
        if ":" not in part:
            raise usage(f"--sections: {part!r} should be name:start or name:start-end (e.g. calm:0,build:8 or calm:0-8)")
        name, rest = part.split(":", 1)
        if "-" in rest:
            a, b = rest.split("-", 1)
            secs.append({"name": name.strip(), "start": parse_time(a, f"--sections {name}"),
                         "end": parse_time(b, f"--sections {name}")})
            mode = True
        else:
            secs.append({"name": name.strip(), "start": parse_time(rest, f"--sections {name}"), "end": None})
            mode = False
        if explicit is None:
            explicit = mode
        elif explicit != mode:
            raise usage("--sections: use either name:start for every section or name:start-end for every one")
    if not explicit:
        secs.sort(key=lambda s: s["start"])
        for i, s in enumerate(secs):
            s["end"] = secs[i + 1]["start"] if i + 1 < len(secs) else dur
    for s in secs:
        if s["end"] <= s["start"]:
            raise usage(f"--sections: {s['name']} ends at or before it starts")
    return secs, {}, "inline"


def cmd_measure(args) -> dict:
    need_ffmpeg()
    path = Path(args.audio)
    if not path.is_file():
        raise usage(f"{args.audio}: no such file")
    w = where(args.video, args.out, [path], writes=False)  # measure writes review files only
    proj, out_dir = w.project, w.review_dir
    x = decode(path)
    dur = len(x) / SR
    sections, cues, ssrc = parse_sections(args.sections, dur, (w.data_dir / "audio.json") if w.video_dir else None,
                                          proj)
    hits = [resolve_hit(h, None, cues, sections, f"--hit {h}") for h in (args.hit or [])]
    for t in hits:
        if t > dur:
            raise usage(f"--hit {t:g}: past the end of the file ({dur:.3f} s)")
    for flag, v in (("--hit-lu", args.hit_lu), ("--build-lu", args.build_lu)):
        if not (math.isfinite(v) and 0 <= v <= 40):
            raise usage(f"{flag} must be between 0 (no warning) and 40 LU, got {v:g}")
    rep, curves, _ = analyze(x, sections, hits, hit_lu=args.hit_lu, build_lu=args.build_lu)
    rep = {"file": relpath(path, proj), **rep, **ebur128(path), "sections_from": ssrc}
    asked = narration_tail(path)
    if asked:
        rep["narration_tail"] = {"s": asked[0], "by": asked[1]}
    in_project_cache = mpl_cache(w)
    png = out_dir / f"loudness-{path.stem}.png"
    title = (f"{path.name}   {dur:.2f} s   I {rep['integrated_lufs']:.1f} LUFS   LRA {rep['lra_lu']:.1f} LU   "
             f"true peak {rep['true_peak_dbtp']:.1f} dBTP")
    draw_png(png, title, rep, curves)
    rep["png"] = relpath(png, proj)
    rep["uv_cache"] = uv_cache()
    rep["notes"] = (summary_flags(rep) + ([cache_size_note(in_project_cache, w)] if in_project_cache else [])
                    + ([rep["uv_cache"]["note"]] if rep["uv_cache"] else []))
    rep["time_origin"] = time_note(path.name, priming(path))
    jpath = out_dir / f"loudness-{path.stem}.json"
    write_json(jpath, rep)
    rep["json"] = relpath(jpath, proj)
    return rep


def print_measure(rep: dict) -> None:
    print(f"measure: {rep['file']}  {rep['duration_s']:.3f} s")
    mono = " (mono, measured as dual mono: as it plays on two speakers)" if rep.get("convention") == "dual mono" else ""
    print(f"  integrated {rep['integrated_lufs']} LUFS{mono}, range (LRA) {rep['lra_lu']} LU, true peak "
          f"{rep['true_peak_dbtp']} dBTP, sample peak {rep['sample_peak_dbfs']} dBFS (ffmpeg ebur128, the file's own "
          f"peaks); through a 300 Hz high-pass (phone): {rep['integrated_lufs_phone']} LUFS")
    st = rep["short_term"]["lufs"]
    if st:
        ends = rep["short_term"]["end_s"]
        if len(st) <= 40:
            print("  short-term (3 s, at each second from 3 s): " + " ".join("-" if v is None else f"{v:.1f}" for v in st))
        else:
            vals = [(v, t) for v, t in zip(st, ends) if v is not None]
            lo, hi = min(vals), max(vals)
            print(f"  short-term (3 s): {lo[0]:.1f} LUFS (lowest, ending {lo[1]:.0f} s) to {hi[0]:.1f} (highest, ending "
                  f"{hi[1]:.0f} s); every second is in the JSON")
    if rep["sections"]:
        print(f"  sections (from {rep.get('sections_from')}; ungated K-weighted loudness of each span):")
        for s in rep["sections"]:
            rise = f"   {s['rise_lu']:+.1f} LU vs {s['rise_vs']}" if s.get("rise_lu") is not None else ""
            lu = "silent" if s["lufs"] is None or s["lufs"] <= SILENT else f"{s['lufs']:.1f} LUFS"
            ph = "silent" if s["lufs_phone"] is None or s["lufs_phone"] <= SILENT else f"{s['lufs_phone']:.1f}"
            print(f"    {s['name']:<12} {s['start']:8.2f}-{s['end']:<8.2f} {lu:>12}   phone {ph:>7}{rise}")
    for h in rep["hits"]:
        on = f" (measured onset {h['onset_s']:.3f} s, {h['onset_offset_ms']:+.0f} ms)" if h.get("onset_s") is not None \
            else " (no sharp attack)" if h.get("onset_rise_db") is not None else ""
        print(f"  hit {h['t']:.3f} s{on}: loudest 400 ms from the hit vs the loudest 400 ms of the {HIT_BEFORE_S:g} s before")
        for label, k in (("full range", "full"), ("300 Hz high-pass (phone)", "phone")):
            v = h[k]
            if v["contrast_lu"] is None:
                print(f"    {label}: not enough audio around the hit")
                continue
            print(f"    {label:<25} {v['contrast_lu']:+.1f} LU   (hit {v['hit_lufs']:.1f} @ {v['hit_window_start']:.2f} s, "
                  f"before {v['before_lufs']:.1f} @ {v['before_window_start']:.2f} s)")
        if h.get("contrast_warning"):
            print(f"    {h['contrast_warning']}")
        if h.get("build"):
            print(f"  {h['build']['summary']}")
    fs = rep.get("first_sound_s")
    qi = rep.get("quiet_intro_s")
    print(f"  start: first sound over {DEAD_DBFS:.0f} dBFS at {fs:.3f} s" if fs is not None else "  start: silent",
          end="")
    print(f"; within {QUIET_INTRO_LU:.0f} LU of the integrated from {qi:.2f} s" if qi is not None else "")
    if rep.get("last_2s_lufs") is not None:
        under = rep.get("last_2s_under_integrated_lu")  # (None for a silent file)
        print(f"  end: under {DEAD_DBFS:.0f} dBFS for the last {rep['dead_tail_s']:.2f} s; the last 2 s at "
              f"{rep['last_2s_lufs']:.1f} LUFS"
              + (f" ({under:.1f} LU under the integrated)" if under is not None else ""))
    for s in rep.get("notes", []):
        print(f"  note: {s}")
    print(f"  wrote: {rep['png']}, {rep['json']}")


# ------------------------------------------------------------------------------------------------ CLI

BUILD_EPILOG = """\
examples:
  uv run <skill>/scripts/mix.py build --video launch
  uv run <skill>/scripts/mix.py build --video launch --plan mix-alt.json --json    (videos/launch/mix-alt.json)
  uv run <skill>/scripts/mix.py build --plan videos/launch/mix.json                (the video from the path)
  uv run <skill>/scripts/mix.py build --plan mix.json --out .     (no project: ./audio/mix.wav, ./out/)

writes (in a project):
  videos/<video>/audio/mix.wav                 48 kHz 24-bit stereo, at the delivery loudness
  videos/<video>/audio/music-only.wav          the music exactly as in the mix (same gain, ducking, limiter)
  videos/<video>/audio/mix.wav.request.json    the plan, input hashes, resolved times and levels, measurements
  out/<video>/mix-report.png, .json            loudness curves (mix, phone, music-only), ducking, effects, hits
  out/<video>/mix-rounds/round-NN-*            the previous round (FLAC) and its record, kept for A/B

""" + PLAN_HELP

MEASURE_EPILOG = """\
examples:
  uv run <skill>/scripts/mix.py measure videos/launch/audio/mix.wav
  uv run <skill>/scripts/mix.py measure cue.wav --sections "calm:0,build:8,hit:20,resolve:24" --hit 20
  uv run <skill>/scripts/mix.py measure cue.wav --sections "calm:0-8,build:12-19.8" --hit 0:20 --json

--sections takes data/audio.json (or any JSON with sections[]; its cues can then be named in --hit) or an inline
list: "name:start,..." (each section ends where the next starts) or "name:start-end,..." (explicit spans, gaps
allowed). Inside videos/<video>/, the video's data/audio.json is used by default.

A hit is a moment meant to land louder than the 4 s before it (a soft resolve chord is a cue, not a hit). Its
contrast: the loudest 400 ms window inside [hit - 10 ms, hit + 0.6 s] against the loudest inside the 4 s before,
K-weighted, at full range and through a 4th-order 300 Hz high-pass (a phone speaker). The build into a hit at t:
the loudness of [t - 8 s, t - 0.2 s] against the opening, [0, min(8 s, t / 2.5)], the same two ways (no build for
a hit before 13.3 s). The report warns under 3 LU of contrast or 5 LU of build (--hit-lu and --build-lu set other
bars, 0 none): reports, not gates. The measured onset is where the hit's attack starts: the loudest arrival within
0.5 s, weighted toward the hit's time (both channels' K-weighted power, 50 ms after against 30 ms before), traced
back to where it rises fastest; a swell (under 3 dB) has none. Section loudness is ungated (each span as one
window); "rise" is each section against the one before. Writes out/<video>/loudness-<file>.png and .json (outside
a project: ./out/ or --out)."""


TOP_EPILOG = """\
examples:
  uv run <skill>/scripts/mix.py build --video launch
  uv run <skill>/scripts/mix.py measure videos/launch/audio/mix.wav --hit 20
Each subcommand has its own --help with more examples."""


class UsageError(Exception):
    pass


class Parser(argparse.ArgumentParser):
    """argparse that raises on a usage error instead of exiting, so --json can report it as JSON too."""

    def error(self, message: str):
        raise UsageError(f"{self.format_usage().rstrip()}\n{self.prog}: error: {message}")


def main(argv=None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:
        pass
    argv = list(sys.argv[1:] if argv is None else argv)
    ap = Parser(prog="mix.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
                epilog=TOP_EPILOG)
    sub = ap.add_subparsers(dest="cmd", metavar="{build,measure}")
    b = sub.add_parser("build", help="mix voice, music and effects from a plan into mix.wav + music-only.wav",
                       description="Mix voice, music and effects from a JSON plan; measure the result.",
                       epilog=BUILD_EPILOG, formatter_class=argparse.RawDescriptionHelpFormatter)
    b.add_argument("--video", metavar="NAME", help="the video: videos/NAME/ in the nearest folder above that has videos/")
    b.add_argument("--plan", metavar="FILE", help="the plan (default videos/NAME/mix.json; a relative path is also "
                                                  "looked for in videos/NAME/)")
    b.add_argument("--out", metavar="DIR", help="without a project: the folder that gets audio/ (the mix) and out/ "
                                                "(review files), and holds data/ (default .)")
    b.add_argument("--force", action="store_true", help="rebuild even when the plan and its inputs are unchanged")
    b.add_argument("--json", action="store_true", help="print a machine-readable result instead of the summary")
    m = sub.add_parser("measure", help="loudness, sections, hit contrast, intros and tails of any audio file",
                       description="Measure what a listener hears in an audio file; write a PNG and a JSON.",
                       epilog=MEASURE_EPILOG, formatter_class=argparse.RawDescriptionHelpFormatter)
    m.add_argument("audio", help="any audio file ffmpeg can decode")
    m.add_argument("--sections", metavar="SPEC", help='data/audio.json, or "name:start,..." / "name:start-end,..."')
    m.add_argument("--hit", metavar="T", action="append", help="a moment meant to land louder than the 4 s before it: "
                                                              "a time (s or m:ss) or cue name; repeatable")
    m.add_argument("--hit-lu", metavar="LU", type=float, default=HIT_LU,
                   help=f"warn when a hit's contrast is under this (default {HIT_LU:g}; 0: never)")
    m.add_argument("--build-lu", metavar="LU", type=float, default=BUILD_LU,
                   help=f"warn when the build into a hit is under this (default {BUILD_LU:g}; 0: never)")
    m.add_argument("--video", metavar="NAME", help="the video whose out/NAME/ and data/audio.json to use (a file "
                                                   "inside videos/NAME/ names it by itself)")
    m.add_argument("--out", metavar="DIR", help="without a project: the folder whose out/ gets the PNG and JSON "
                                                "(default .)")
    m.add_argument("--json", action="store_true", help="print the measurements as JSON instead of the summary")
    try:
        args = ap.parse_args(argv)
    except UsageError as e:  # with --json the error is one JSON object too
        print(str(e), file=sys.stderr)
        if "--json" in argv:
            print(json.dumps({"ok": False, "exit": EXIT_USAGE, "error": str(e).splitlines()[-1]}, ensure_ascii=False))
        return EXIT_USAGE
    except SystemExit as e:  # --help
        return EXIT_USAGE if e.code not in (0, None) else EXIT_OK
    if not args.cmd:
        ap.print_help()
        if "--json" in argv:
            print(json.dumps({"ok": False, "exit": EXIT_USAGE, "error": "mix.py needs build or measure"}))
        return EXIT_USAGE
    try:
        if args.cmd == "build":
            res = cmd_build(args)
            if args.json:
                out = {"ok": True, "status": res["status"], "round": res["round"],
                       "record": relpath(res["ctx"]["audio"] / "mix.wav.request.json", res["ctx"]["project"])}
                if res["status"] == "built":
                    out.update({"files": [relpath(p, res["ctx"]["project"]) for p in res["files"]],
                                "png": relpath(res["png"], res["ctx"]["project"]),
                                "report": relpath(res["json"], res["ctx"]["project"])})
                out["hints"] = res.get("hints") or []
                out.update({k: res["record"].get(k) for k in ("measured", "balance", "hits", "warnings", "sync",
                                                              "notes", "changed_since_previous", "resolved")})
                out["uv_cache"] = res.get("uv_cache")
                print(json.dumps(clean(out), indent=1, ensure_ascii=False))
            else:
                print_build(res)
        else:
            rep = cmd_measure(args)
            if args.json:
                print(json.dumps(clean({"ok": True, **rep}), indent=1, ensure_ascii=False))
            else:
                print_measure(rep)
        return EXIT_OK
    except Fail as f:
        code, err = f.code, str(f)
    except KeyboardInterrupt:
        code, err = EXIT_ERROR, "interrupted"
    except Exception as e:  # a bug, not a usage problem: say where, briefly
        import traceback
        tb = traceback.extract_tb(e.__traceback__)[-1]
        code, err = EXIT_ERROR, f"unexpected {type(e).__name__}: {e} (mix.py line {tb.lineno}, in {tb.name})"
    print(f"mix.py {args.cmd}: {err}", file=sys.stderr)
    if getattr(args, "json", False):
        print(json.dumps({"ok": False, "exit": code, "error": err}, ensure_ascii=False))
    return code


if __name__ == "__main__":
    sys.exit(main())
