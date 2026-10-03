#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy>=1.26,<3"]
# ///
"""qc.py: measured checks on a finished video: holds, blank frames, loudness and stream facts.

Usage (from the project folder; <skill> is the code-video skill's folder):
  uv run <skill>/scripts/qc.py VIDEO [--cuts TIMES|FILE] [--offset S] [--json] [--out FILE]

  VIDEO        any video ffmpeg reads: render.ts output, HyperFrames, Remotion, an edit
  --cuts       the video's cut times, so blank frames next to a cut are flagged: "2.2,4.4,6.5", or a file:
               render.ts's out/<video>/verify.json (its timeline), a JSON list of seconds, or a text file
  --offset S   VIDEO is a clip that starts S seconds into the video (render.ts video --from S): the cut
               times are moved back by S, so they land where they are in the clip
  --json       print the report as JSON instead of text
  --out FILE   also write the report to FILE (JSON when FILE ends in .json, text otherwise)

Examples:
  uv run <skill>/scripts/qc.py out/teaser/teaser.mp4 --cuts out/teaser/verify.json --out out/teaser/qc.json
  uv run <skill>/scripts/qc.py out/teaser/wip/clip.mp4 --cuts out/teaser/verify.json --offset 10
  uv run <skill>/scripts/qc.py promo.mp4 --cuts 3.9,8.1,12.4 --json

It reports and doesn't judge: a hold or a fade to black can be the point of a piece, so the numbers say
where they are and the reply says why. Exit codes: 0 report made; 1 the video couldn't be read (the
message says why); 2 bad arguments. Needs ffmpeg and ffprobe on PATH.

The frozen-time and loudness checks follow motion-video-kit's frozen-time.sh and loudness.sh (MIT,
(c) 2026 echris6, https://github.com/echris6/motion-video-kit), rebuilt so that grain can't hide a hold.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import subprocess
import sys
import threading
from collections import deque
from pathlib import Path

import numpy as np

# ---------------------------------------------------------------- the analysis frame
# Each frame is decoded as full-range luma (0-255 whatever the file's range) and area-averaged down to
# FINE x ANALYSIS_LONG px on its long side, which divides per-pixel grain by 4 or more. The blank-frame
# tests use it averaged 2x2 again (8x8 source pixels per cell at 1080p, 16x16 at 4K) and blurred a little
# (binomial, sigma ~1 cell), which also takes out most encoder block noise. (ffmpeg's freezedetect, run on
# full frames, finds no hold in a grainy video.)
ANALYSIS_LONG = 240
FINE = 2              # the hold test's sharp view: 4x4-px cells at 1080p, see below

# ---------------------------------------------------------------- holds
# A frame is held when no part of the picture varied (beyond the area allowed) over the HOLD_SPAN before
# it, judged by each cell's range over that window rather than frame to frame: motion too slow to show
# between two frames adds up over half a second, while grain, which doesn't add up, can't pass for it. A
# hold is the time those windows cover, merged where they overlap. For this test the frames are also
# averaged over 3 consecutive frames, which divides grain by another 1.7, and a part of the picture has
# changed when it varied in either of two views:
# - blurred (the 8x8-px cells above): grain and block noise are lowest there, so a faint change spread
#   over a large area shows;
# - sharp (4x4-px cells, unblurred): a cell's mean changes only when a line crosses its edge, and the blur
#   cuts a thin line's change about 7 times (a 2-px line bending in one baseline moved its 8x8 cells by
#   10 levels, 1.5 after the blur), so a moving hairline, the kind LineBatch and the stroke fonts draw,
#   shows only here (a synthetic hairline stepping 1 px a frame was invisible in 8x8 cells, seen in 4x4).
HOLD_SPAN = 0.5       # s: also the shortest hold; a shorter pause reads as a beat landing, not as a hold
CHANGE_LEVELS = 1.5   # blurred view: a cell has changed when it varied by more than 1.5 of 255 levels (0.6%):
                      # several times what grain and encoder flicker leave after the averaging (0.05-0.3
                      # measured on grainy renders), and less than any movement a viewer notices
SHARP_CHANGE_LEVELS = 3.0  # sharp view: 3 levels (1.2%). Encoding leaves under that on a detailed still (up to
                      # 3.5 in 2 cells of 130,000, at CRF 23 with a keyframe every second; render.ts encodes at
                      # CRF 16), and a 1-px line crossing a cell edge moves 1/4 of its contrast, so a line of 5%
                      # contrast or more counts. Around CRF 35 a detailed still pumps at keyframes by more than
                      # that: its holds split there (the total stays about right, the longest comes out short)
NOISE_K = 6.3         # ...unless the video is noisier than that: each view's threshold rises to 6.3x its noise
                      # (the median second difference in time, in the quietest 10% of frames), which keeps
                      # grain from flipping more than about 1 cell in 10,000 over a half-second window
LADDER = (1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0, 8.0)  # blurred thresholds measured per frame; picked after
SHARP_LADDER = (3.0, 3.5, 4.0, 5.0, 6.0, 8.0, 10.0, 12.0, 16.0, 20.0, 24.0, 32.0)  # sharp cells: 1.6-7.4x the
                      # blurred view's noise on the grainy files measured
FROZEN_AREA = 0.0001  # frozen: at most 0.01% of the frame changed (a ~15 px square at 1080p): nothing moves
NEARLY_AREA = 0.005   # nearly frozen: at most 0.5% changed (a ~100 px square at 1080p): only a small detail
                      # moves (a pulse, a cursor, a progress bar) while the picture stands
LONG_HOLD = 1.0       # s: holds longer than this are listed one by one

# ---------------------------------------------------------------- blank frames
BLACK_LEVEL = 25.5    # near-black: the brightest 0.1% of the frame is under 10% gray (25.5 of 255), the
                      # level ffmpeg's blackdetect uses; on most screens, phones outdoors above all, it reads
                      # as black
DETAIL_LEVELS = 8.0   # detail: a cell that stands out from the mean of its surroundings (a window 1/14 of the
                      # frame wide) by more than 8 levels (3%). Type, edges and shapes do; gradients,
                      # vignettes, soft glows, faint textures and grain don't
EMPTY_DETAIL = 0.005  # near-empty: detail covers under 0.5% of the frame (a bare background, or one small
                      # mark on it)...
DIP_RATIO = 0.25      # ...or the frame holds under a quarter of the detail of the fullest frames on both
DIP_CEILING = 0.05    # sides of it (within DIP_WINDOW) and under 5% overall: the picture empties out between
DIP_WINDOW = 0.5      # two fuller ones (s), as when a scene ends before the next one appears. This catches an
                      # empty frame that still shows a header or a logo, which never is "a bare background"
SPARSE_RATIO = 0.25   # a sparse video (a hairline on a bare ground, its typical frame near EMPTY_DETAIL) would be
                      # "near-empty" half the time, flickering in and out frame by frame: there a frame is
                      # near-empty only under a quarter of the typical (median) frame's detail
EMPTY_MIN = 0.1       # s: a near-empty stretch mid-video (not black, away from t=0, cuts and the end) shorter than
                      # this, with other near-empty frames within DIP_WINDOW of it, is the picture flickering
                      # around the threshold (a hairline moving across the analysis cells), not a blank; alone,
                      # it stays (a single empty frame between two scenes)
CUT_TOUCH = 0.25      # s: a blank range this close to a cut belongs to it (a fade-in's first frames, too)

# ---------------------------------------------------------------- sound and stream
TRUE_PEAK_MAX = -1.0  # dBTP: above it, decoding a lossy encode (AAC, MP3) can clip
QUIET_LUFS = -18.0    # integrated loudness outside these is noted: platforms play online video at about
LOUD_LUFS = -12.0     # -14 LUFS (2026), so a louder mix is turned down and only loses its dynamics, and a much
                      # quieter one sounds weak next to what plays around it (defaults: -14 punchy, -16 calm)
SILENCE_DB = -50      # dBFS: quieter than this for SILENCE_MIN s counts as silence (first and last sound)
SILENCE_MIN = 0.5
AV_TOLERANCE = 0.05   # s: audio and picture lengths within 50 ms is normal packaging (AAC frames are 21 ms)
BT709 = {"bt709"}     # what HD SDR video should be tagged with; untagged files are decoded by guesswork,
                      # and players disagree (colors and contrast shift between them)


class Unreadable(Exception):
    """The video can't be analyzed; the message says why and what to do."""


def say(msg: str) -> None:
    print(f"qc.py: {msg}", file=sys.stderr, flush=True)


# ---------------------------------------------------------------- probing
def need(tool: str) -> str:
    exe = shutil.which(tool)
    if not exe:
        raise Unreadable(f"{tool} not found on PATH. Install ffmpeg (Windows: winget install Gyan.FFmpeg; "
                         "macOS: brew install ffmpeg; Linux: sudo apt install ffmpeg), then open a new terminal.")
    return exe


def frac(s: str | None) -> float | None:
    try:
        a, b = (s or "").split("/")
        return float(a) / float(b) if float(b) else None
    except ValueError:
        try:
            return float(s)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return None


def num(x) -> float | None:
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def probe(path: Path) -> dict:
    r = subprocess.run([need("ffprobe"), "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise Unreadable(f"ffprobe can't read {path}: {(r.stderr.strip().splitlines() or ['unknown error'])[-1]}")
    return json.loads(r.stdout or "{}")


def stream_facts(path: Path, p: dict) -> tuple[dict, list[str]]:
    notes: list[str] = []
    fmt = p.get("format", {})
    streams = p.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic")), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    duration = num(fmt.get("duration")) or num((v or {}).get("duration")) or 0.0
    size = num(fmt.get("size")) or (path.stat().st_size if path.exists() else 0)
    facts: dict = {"container": fmt.get("format_name"), "bytes": int(size), "duration": round(duration, 3),
                   "bitrate_kbps": round((num(fmt.get("bit_rate")) or 0) / 1000), "video": None, "audio": None}
    if v:
        w, h = int(v.get("width", 0)), int(v.get("height", 0))
        fps = frac(v.get("avg_frame_rate")) or frac(v.get("r_frame_rate")) or 0.0
        vdur = num(v.get("duration")) or duration
        vbr = num(v.get("bit_rate")) or num(fmt.get("bit_rate"))
        rot = 0
        for sd in v.get("side_data_list", []) or []:
            if "rotation" in sd:
                rot = int(num(sd["rotation"]) or 0)
        color = {"matrix": v.get("color_space", "unknown"), "primaries": v.get("color_primaries", "unknown"),
                 "transfer": v.get("color_transfer", "unknown"), "range": v.get("color_range", "unknown")}
        untagged = [k for k in ("primaries", "transfer", "matrix") if color[k] not in BT709]
        facts["video"] = {
            "codec": v.get("codec_name"), "profile": v.get("profile"), "width": w, "height": h, "rotation": rot,
            "fps": round(fps, 3), "frames": int(v["nb_frames"]) if str(v.get("nb_frames", "")).isdigit() else None,
            "duration": round(vdur, 3), "pix_fmt": v.get("pix_fmt"),
            "bitrate_kbps": round(vbr / 1000) if vbr else None,
            "bits_per_pixel": round(vbr / (w * h * fps), 3) if vbr and w and h and fps else None,
            "color": color, "bt709": not untagged,
        }
        if untagged:
            notes.append(f"color not tagged BT.709 ({', '.join(f'{k} {color[k]}' for k in untagged)}): players guess "
                         "and colors shift between them. render.ts tags it; elsewhere add "
                         "-vf setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709 when encoding")
        if v.get("pix_fmt") not in ("yuv420p", "yuvj420p"):
            notes.append(f"pixel format {v.get('pix_fmt')}: only yuv420p plays in every browser and phone")
        if w % 2 or h % 2:
            notes.append(f"odd frame size {w}x{h}: H.264 4:2:0 needs even sizes and some players refuse it")
    if a:
        adur = num(a.get("duration")) or duration
        facts["audio"] = {"codec": a.get("codec_name"), "sample_rate": int(num(a.get("sample_rate")) or 0),
                          "channels": a.get("channels"), "duration": round(adur, 3),
                          "bitrate_kbps": round((num(a.get("bit_rate")) or 0) / 1000) or None}
        if facts["video"] and abs(adur - facts["video"]["duration"]) > AV_TOLERANCE:
            vd = facts["video"]["duration"]
            notes.append(f"the sound runs {adur:.3f} s and the picture {vd:.3f} s: "
                         + ("the sound ends early" if adur < vd else "the sound runs past the picture"))
    return facts, notes


# ---------------------------------------------------------------- picture analysis
def blur(y: np.ndarray) -> np.ndarray:
    """Binomial 1-4-6-4-1 blur in both directions (about a gaussian of sigma 1 cell), edges held."""
    p = np.pad(y, 2, mode="edge")
    v = (p[:-4] + 4 * p[1:-3] + 6 * p[2:-2] + 4 * p[3:-1] + p[4:]) * (1 / 16)
    return (v[:, :-4] + 4 * v[:, 1:-3] + 6 * v[:, 2:-2] + 4 * v[:, 3:-1] + v[:, 4:]) * (1 / 16)


def local_mean(y: np.ndarray, r: int) -> np.ndarray:
    """Mean over a (2r+1)-cell square around each cell (summed-area table, mirrored edges)."""
    p = np.pad(y.astype(np.float64), r, mode="reflect")
    c = np.pad(p.cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    n = 2 * r + 1
    return (c[n:, n:] - c[:-n, n:] - c[n:, :-n] + c[:-n, :-n]) / (n * n)


class SlidingRange:
    """Each cell's max - min over the last w frames pushed, in a few array operations per frame instead of
    2w (van Herk / Gil-Werman): frames go in blocks of w, and a window's part in the previous, finished
    block comes from that block's suffix extremes, its part in the current block from running extremes."""

    def __init__(self, w: int, shape: tuple[int, int]):
        self.w, self.i = w, 0
        self.block = np.empty((w, *shape), np.float32)  # the current block's frames
        self.smax, self.smin = np.empty((w, *shape), np.float32), np.empty((w, *shape), np.float32)
        self.pmax, self.pmin = np.empty(shape, np.float32), np.empty(shape, np.float32)

    def push(self, x: np.ndarray) -> np.ndarray | None:
        """Add a frame; the range over the last w frames, once there are w."""
        w, pos = self.w, self.i % self.w
        self.block[pos] = x
        if pos == 0:
            self.pmax[...], self.pmin[...] = x, x
        else:
            np.maximum(self.pmax, x, out=self.pmax)
            np.minimum(self.pmin, x, out=self.pmin)
        out = None
        if self.i >= w - 1:
            if pos == w - 1:  # the window is this block
                out = self.pmax - self.pmin
            else:
                out = np.maximum(self.smax[pos + 1], self.pmax) - np.minimum(self.smin[pos + 1], self.pmin)
        if pos == w - 1:  # the block is done: its suffix extremes, for the next block's windows
            self.smax[-1], self.smin[-1] = self.block[-1], self.block[-1]
            for q in range(w - 2, -1, -1):
                np.maximum(self.block[q], self.smax[q + 1], out=self.smax[q])
                np.minimum(self.block[q], self.smin[q + 1], out=self.smin[q])
        self.i += 1
        return out


def analyze_picture(path: Path, w: int, h: int, fps: float, expect_frames: int | None) -> dict:
    if w >= h:
        aw, ah = ANALYSIS_LONG, max(2, round(ANALYSIS_LONG * h / w))
    else:
        aw, ah = max(2, round(ANALYSIS_LONG * w / h)), ANALYSIS_LONG
    fw, fh = FINE * aw, FINE * ah  # the sharp view; averaged FINE x FINE, it is the blurred view's grid
    radius = max(2, round(ANALYSIS_LONG / 30))  # the detail window: 17 cells of 240, 1/14 of the frame
    cmd = [need("ffmpeg"), "-v", "error", "-nostdin", "-noautorotate", "-i", str(path), "-map", "0:v:0",
           "-an", "-sn", "-vf", f"scale={fw}:{fh}:flags=area,format=gray16le", "-f", "rawvideo", "-"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    errs: list[bytes] = []
    drain = threading.Thread(target=lambda: errs.extend(proc.stderr), daemon=True)  # never let stderr fill up
    drain.start()
    size = fw * fh * 2
    span = max(1, round(HOLD_SPAN * fps))
    sharp_ladder, blur_ladder = np.array(SHARP_LADDER, np.float32), np.array(LADDER, np.float32)
    ns, nb = len(SHARP_LADDER), len(LADDER)
    recent: deque[tuple[np.ndarray, np.ndarray]] = deque(maxlen=3)  # the last 3 frames: (sharp, blurred)
    rng_s, rng_b = SlidingRange(span + 1, (fh, fw)), SlidingRange(span + 1, (ah, aw))  # over the last HOLD_SPAN
    detail, top, noise_s, noise_b, moved = [], [], [], [], []
    k999 = int(0.999 * (aw * ah - 1))
    n = 0
    step = max(1, (expect_frames or 0) // 10)

    def push(s: np.ndarray, b: np.ndarray) -> None:  # averaged frame number len(moved)
        rs, rb = rng_s.push(s), rng_b.push(b)
        if rs is None or rb is None:  # (the first HOLD_SPAN)
            moved.append(None)
            return
        # how many of its ladder's thresholds each cell's range passes, in each view (the blurred cells
        # spread over the sharp grid); at the pair of thresholds (j, k) a sharp cell has changed when it
        # passes SHARP_LADDER[j] or its blurred cell passes LADDER[k]. Only cells past the lowest pair can
        # count, and in a still stretch there are few of them.
        rb = rb.repeat(FINE, 0).repeat(FINE, 1)
        idx = np.flatnonzero((rs > SHARP_LADDER[0]) | (rb > LADDER[0]))
        ps = np.searchsorted(sharp_ladder, rs.ravel()[idx])
        pb = np.searchsorted(blur_ladder, rb.ravel()[idx])
        hist = np.bincount(ps * (nb + 1) + pb, minlength=(ns + 1) * (nb + 1)).reshape(ns + 1, nb + 1)
        hist[0, 0] += rs.size - idx.size
        moved.append(1.0 - hist.cumsum(0).cumsum(1)[:ns, :nb] / rs.size)  # the share that changed, per pair

    try:
        while True:
            buf = proc.stdout.read(size)
            if len(buf) < size:
                break
            ys = np.frombuffer(buf, "<u2").reshape(fh, fw).astype(np.float32) * (1 / 257)
            yb = blur(ys.reshape(ah, FINE, aw, FINE).mean((1, 3)))
            detail.append(float(np.count_nonzero(np.abs(yb - local_mean(yb, radius)) > DETAIL_LEVELS)) / yb.size)
            top.append(float(np.partition(yb.ravel(), k999)[k999]))
            recent.append((ys, yb))
            if len(recent) == 3:  # frame n-1, now that its successor is known
                (s0, b0), (s1, b1), (s2, b2) = recent
                # what doesn't move smoothly (grain, flicker), in each view (every other sharp cell is plenty)
                noise_s.append(float(np.median(np.abs(s1[::2, ::2] - 0.5 * (s0[::2, ::2] + s2[::2, ::2])))))
                noise_b.append(float(np.median(np.abs(b1 - 0.5 * (b0 + b2)))))
                push((s0 + s1 + s2) * (1 / 3), (b0 + b1 + b2) * (1 / 3))
            elif len(recent) == 2:
                push((recent[0][0] + recent[1][0]) * 0.5, (recent[0][1] + recent[1][1]) * 0.5)
            n += 1
            if expect_frames and expect_frames > 1800 and n % step == 0:
                say(f"{100 * n // expect_frames}% of {expect_frames} frames")
    finally:
        proc.stdout.close()
        proc.wait()
        drain.join(timeout=5)
    if n == 0:
        raise Unreadable(f"ffmpeg decoded no frames from {path}: {b''.join(errs).decode('utf-8', 'replace').strip()[:300]}")
    if len(recent) == 1:  # the last frame
        push(*recent[-1])
    else:
        push((recent[-2][0] + recent[-1][0]) * 0.5, (recent[-2][1] + recent[-1][1]) * 0.5)

    def threshold(ladder: tuple, floor: float, noise: list[float]) -> tuple[int, float]:
        level = float(np.percentile(noise, 10)) if noise else 0.0
        want = max(floor, NOISE_K * level)
        return next((j for j, t in enumerate(ladder) if t >= want), len(ladder) - 1), level

    j, level_s = threshold(SHARP_LADDER, SHARP_CHANGE_LEVELS, noise_s)
    k, level_b = threshold(LADDER, CHANGE_LEVELS, noise_b)
    moved_a = np.array([math.nan if m is None else m[j, k] for m in moved])  # (NaN compares false: not held)

    def holds(area: float) -> list[tuple[int, int, float]]:
        # A held frame i vouches for frames [i - span, i]: they looked alike. A run of held frames [a, b)
        # is a hold over [a - span, b), and runs whose holds overlap are one hold (the moving share hovering
        # at the limit splits a long, slowly changing stretch into runs a few frames apart). Holds that only
        # touch stay apart: that is what a small instant change leaves (an element popping in, a keyframe's
        # pump), since the 3-frame average dilutes the step and the windows either side meet at it.
        out: list[list] = []
        for a, b in ranges(moved_a <= area):
            peak = float(np.max(moved_a[a:b]))
            if out and a - span < out[-1][1]:
                out[-1][1], out[-1][2] = b, max(out[-1][2], peak)
            else:
                out.append([max(0, a - span), b, peak])
        return [(a, b, p) for a, b, p in out]

    return {"frames": n, "size": [aw, ah], "detail": np.array(detail), "top": np.array(top),
            "noise": level_b, "change_levels": LADDER[k], "noise_sharp": level_s,
            "change_levels_sharp": SHARP_LADDER[j], "frozen": holds(FROZEN_AREA), "nearly": holds(NEARLY_AREA),
            "decoder_errors": b"".join(errs).decode("utf-8", "replace").strip()}


def ranges(mask: np.ndarray) -> list[tuple[int, int]]:
    """[start, end) index ranges where mask is true."""
    m = np.r_[False, mask, False].astype(np.int8)
    d = np.flatnonzero(np.diff(m))
    return list(zip(d[0::2].tolist(), d[1::2].tolist()))


def blank_frames(pic: dict, fps: float, cuts: list[float]) -> dict:
    detail, n = pic["detail"], pic["frames"]
    black = pic["top"] < BLACK_LEVEL
    w = max(1, round(DIP_WINDOW * fps))
    dip = np.zeros(n, bool)
    for i in np.flatnonzero(detail < DIP_CEILING):
        sides = [s.max() for s in (detail[max(0, i - w):i], detail[i + 1:i + 1 + w]) if len(s)]
        dip[i] = bool(sides) and detail[i] < DIP_RATIO * min(sides)
    median = float(np.median(detail))
    empty_level = min(EMPTY_DETAIL, SPARSE_RATIO * median)  # (a sparse video: against its own typical frame)
    empty = black | (detail < empty_level) | dip
    flagged = empty.copy()
    out = []
    for a, b in ranges(flagged):
        t0, t1 = a / fps, b / fps
        where = (["t=0"] if a == 0 else []) + [f"cut {c:.3f}" for c in cuts if t0 - CUT_TOUCH <= c <= t1 + CUT_TOUCH]
        where += ["end"] if b == n else []
        if not where and (b - a) / fps < EMPTY_MIN and not black[a:b].any() and (flagged[max(0, a - w):a].any() or flagged[b:b + w].any()):
            empty[a:b] = False  # (flicker around the threshold, not a blank)
            continue
        out.append({"start": round(t0, 3), "end": round(t1, 3), "frames": b - a,
                    "kind": "near-black" if black[a:b].all() else "near-empty",
                    "black_frames": int(black[a:b].sum()), "where": where or ["mid-video"]})

    def state(i: int) -> str:
        return "near-black" if black[i] else "near-empty" if empty[i] else "ok"

    return {"ranges": out, "frame0": state(0), "last_frame": state(n - 1),
            "median_detail_pct": round(100 * median, 2), "empty_below_pct": round(100 * empty_level, 3)}


def holds_report(pic: dict, fps: float, duration: float, notes: list[str]) -> dict:
    def hold(a: int, b: int, peak: float, kind: str) -> dict:
        return {"start": round(a / fps, 3), "end": round(b / fps, 3), "seconds": round((b - a) / fps, 3),
                "kind": kind, "moving_pct": round(100 * peak, 3), "to_end": b == pic["frames"]}

    rep = {"analysis": {"size": pic["size"], "change_levels": pic["change_levels"], "noise_levels": round(pic["noise"], 3),
                        "change_levels_sharp": pic["change_levels_sharp"], "noise_levels_sharp": round(pic["noise_sharp"], 3)}}
    for key, kind in (("frozen", "frozen"), ("nearly", "nearly frozen")):
        hs = [hold(a, b, p, kind) for a, b, p in pic[key]]
        total = sum(x["seconds"] for x in hs)
        rep[key.replace("nearly", "nearly_frozen")] = {
            "seconds": round(total, 2), "pct": round(100 * total / duration, 1) if duration else None,
            "longest": max(hs, key=lambda x: x["seconds"]) if hs else None,
            "over_1s": [x for x in hs if x["seconds"] > LONG_HOLD]}
    if pic["change_levels"] > CHANGE_LEVELS or pic["change_levels_sharp"] > SHARP_CHANGE_LEVELS:
        notes.append(f"the picture is noisy (grain or flicker of about {pic['noise']:.2f} levels after averaging), so a "
                     f"change counted from {pic['change_levels']:g} levels instead of {CHANGE_LEVELS:g} (and "
                     f"{pic['change_levels_sharp']:g} instead of {SHARP_CHANGE_LEVELS:g} in sharp cells): faint motion may count as held")
    return rep


# ---------------------------------------------------------------- sound
def loudness(path: Path, duration: float, notes: list[str]) -> dict:
    cmd = [need("ffmpeg"), "-nostats", "-hide_banner", "-nostdin", "-i", str(path), "-map", "0:a:0", "-vn",
           "-af", f"ebur128=peak=true,silencedetect=noise={SILENCE_DB}dB:d={SILENCE_MIN}", "-f", "null", "-"]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    log = r.stderr
    if r.returncode != 0 or "Summary:" not in log:
        notes.append(f"loudness could not be measured: {(log.strip().splitlines() or ['no output'])[-1][:200]}")
        return {}
    head, summary = log.rsplit("Summary:", 1)

    def find(pat: str, text: str) -> float | None:
        m = re.search(pat, text)
        return num(m.group(1)) if m else None

    # one line every 100 ms; S is the short-term loudness of the 3 s ending there
    by_tenth = {round(float(t) * 10): num(s) for t, s in re.findall(r"t:\s*([\d.]+)\s+TARGET:.*?S:\s*(-?[\d.]+|-?inf)", head)}
    per_second = []
    for sec in range(1, int(duration + 1e-6) + 1):
        s = by_tenth.get(sec * 10)
        per_second.append(round(s, 1) if s is not None and s > -70 else None)  # -120.7: window not yet full
    starts = [float(x) for x in re.findall(r"silence_start:\s*(-?[\d.]+)", head)]
    ends = [float(x) for x in re.findall(r"silence_end:\s*(-?[\d.]+)", head)]
    first = next((e for s, e in zip(starts, ends) if s <= 0.01), 0.0)
    last = next((s for s, e in zip(starts, ends + [duration]) if e >= duration - 0.05 and s > first), duration)
    if starts and len(starts) > len(ends) and starts[-1] > first:  # a silence still open at the end
        last = starts[-1]
    rep = {"integrated_lufs": find(r"I:\s+(-?[\d.]+) LUFS", summary), "lra_lu": find(r"LRA:\s+(-?[\d.]+) LU", summary),
           "true_peak_dbtp": find(r"Peak:\s+(-?[\d.]+|-inf) dBFS", summary),
           "first_sound": round(first, 2), "last_sound": round(last, 2), "short_term_per_second": per_second}
    i, tp = rep["integrated_lufs"], rep["true_peak_dbtp"]
    if tp is not None and tp > TRUE_PEAK_MAX:
        notes.append(f"true peak {tp:+.1f} dBTP, over {TRUE_PEAK_MAX:.0f}: a lossy encode of it can clip")
    if i is not None and i < QUIET_LUFS:
        notes.append(f"integrated {i:.1f} LUFS is quiet for online video (platforms play at about -14): "
                     "it will sound weaker than what plays around it")
    if i is not None and i > LOUD_LUFS:
        notes.append(f"integrated {i:.1f} LUFS is louder than platforms play it (about -14): "
                     "they turn it down and it only loses dynamics")
    if duration - last > 1.0:
        notes.append(f"the sound stops at {last:.2f} s and the picture runs to {duration:.2f} s")
    if first > 1.0:
        notes.append(f"silence until {first:.2f} s")
    return rep


# ---------------------------------------------------------------- cuts
def parse_cuts(arg: str | None) -> list[float]:
    """Cut times in seconds from "2.2,4.4", render.ts's verify.json, a JSON list or a text file."""
    if not arg:
        return []
    p = Path(arg)
    if p.is_file():
        text = p.read_text(encoding="utf-8")
        if p.suffix.lower() == ".json":
            data = json.loads(text)
            if isinstance(data, dict) and isinstance(data.get("timeline"), list):  # render.ts verify.json
                raw = [e.get(k) for e in data["timeline"] if isinstance(e, dict) for k in ("start", "end")]
            elif isinstance(data, dict) and isinstance(data.get("cuts"), list):
                raw = data["cuts"]
            elif isinstance(data, list):
                raw = data
            else:
                raise ValueError(f"{arg}: expected render.ts's verify.json (a 'timeline' list), "
                                 "{\"cuts\": [...]} or a list of seconds")
        else:
            raw = re.split(r"[\s,;]+", text.strip())
    elif re.search(r"[A-DF-Za-df-z/\\]", arg):  # letters other than an exponent's e, or a path separator
        raise ValueError(f"no such file: {arg}")
    else:
        raw = re.split(r"[\s,;]+", arg.strip())
    try:
        return sorted({round(float(x), 4) for x in raw if x is not None and str(x).strip() != ""})
    except (TypeError, ValueError):
        raise ValueError(f"{arg}: not a list of seconds") from None


# ---------------------------------------------------------------- report
def run(path: Path, cuts: list[float]) -> dict:
    if not path.is_file():
        raise Unreadable(f"no such file: {path}")
    p = probe(path)
    facts, notes = stream_facts(path, p)
    v = facts["video"]
    duration = (v or {}).get("duration") or facts["duration"]
    cuts = [t for t in cuts if 1e-3 < t < duration - 1e-3]  # a scene starting at 0 or ending at the end is no cut
    report: dict = {"file": str(path), "stream": facts, "cuts": cuts, "motion": None, "blank": None, "loudness": None}
    if v:
        fps = v["fps"] or 30.0
        w, h = (v["height"], v["width"]) if v["rotation"] % 180 else (v["width"], v["height"])
        expect = v["frames"] or round(duration * fps)
        say(f"decoding {path.name} ({expect} frames)")
        pic = analyze_picture(path, v["width"], v["height"], fps, expect)
        if abs(pic["frames"] - duration * fps) > 1.5:
            notes.append(f"{pic['frames']} frames decoded for {duration:.3f} s at {fps:g} fps: a variable frame "
                         "rate? times below assume a constant one")
        if pic["decoder_errors"]:
            notes.append(f"the decoder reported errors: {pic['decoder_errors'].splitlines()[0][:200]}")
        report["motion"] = holds_report(pic, fps, duration, notes)
        report["blank"] = blank_frames(pic, fps, cuts)
        facts["video"]["display"] = [w, h]
    else:
        notes.append("no video stream: only the sound was measured")
    if facts["audio"]:
        report["loudness"] = loudness(path, duration, notes) or None
    else:
        notes.append("no audio stream (a silent video)")
    flagged = [r for r in (report["blank"] or {}).get("ranges", []) if r["where"] != ["mid-video"]]
    if flagged:
        notes.append("blank frames at " + "; ".join(f"{', '.join(r['where'])} ({r['start']:.3f}-{r['end']:.3f})"
                                                    for r in flagged[:8])
                     + ": a scene that starts late or ends early, or a fade. Say why if it is meant")
    report["notes"] = notes
    report["look_at"] = look_at(report)
    return report


def look_at(rep: dict) -> list[float]:
    """Times worth looking at in a sheet: blank ranges, long holds, the first and the last frame."""
    v = rep["stream"]["video"]
    if not v:
        return []
    ts = {0.0, round(v["duration"] - 1 / (v["fps"] or 30), 3)}
    for r in (rep["blank"] or {}).get("ranges", []):
        ts.add(r["start"])
        ts.add(round((r["start"] + r["end"]) / 2, 3))
    m = rep["motion"] or {}
    for k in ("frozen", "nearly_frozen"):
        for x in (m.get(k) or {}).get("over_1s", []):
            ts.add(round((x["start"] + x["end"]) / 2, 3))
    return sorted(ts)[:16]


def text_report(rep: dict) -> str:
    out = [f"qc {rep['file']}"]
    s, v, a = rep["stream"], rep["stream"]["video"], rep["stream"]["audio"]
    mb = s["bytes"] / 1e6
    if v:
        frames = f"{v['frames']} frames" if v["frames"] else "frames unknown"
        bpp = f" ({v['bits_per_pixel']} bit/px)" if v["bits_per_pixel"] is not None else ""
        rate = f"{v['bitrate_kbps'] / 1000:.2f} Mb/s{bpp}" if v["bitrate_kbps"] else "bitrate unknown"
        out.append(f"stream    {v['width']}x{v['height']}{' rotated %d' % v['rotation'] if v['rotation'] else ''}, "
                   f"{v['fps']:g} fps, {v['duration']:.3f} s ({frames}), {v['codec']} {v['profile'] or ''}, "
                   f"{v['pix_fmt']}, {rate}, {mb:.1f} MB")
        c = v["color"]
        out.append(f"          color: matrix {c['matrix']}, primaries {c['primaries']}, transfer {c['transfer']}, "
                   f"range {c['range']} -> {'BT.709 tagged' if v['bt709'] else 'NOT tagged BT.709'}")
    else:
        out.append(f"stream    no video, {s['duration']:.3f} s, {mb:.1f} MB")
    out.append(f"          audio: {a['codec']}, {a['sample_rate']} Hz, {a['channels']} ch, {a['duration']:.3f} s"
               if a else "          audio: none")
    m = rep["motion"]
    if m:
        def line(key: str, label: str) -> str:
            x = m[key]
            lg = x["longest"]
            longest = f", longest {lg['seconds']:.2f} s at {lg['start']:.2f}-{lg['end']:.2f}" if lg else ""
            return f"{label} {x['seconds']:.2f} s ({x['pct'] or 0:.0f}%){longest}"
        out.append(f"motion    {line('frozen', 'frozen')}   (nothing visibly changes)")
        out.append(f"          {line('nearly_frozen', 'nearly frozen')}   (under 0.5% of the frame moves; includes frozen)")
        longs = m["frozen"]["over_1s"] + m["nearly_frozen"]["over_1s"]
        for x in sorted(longs, key=lambda x: (x["start"], x["kind"]))[:12]:
            moving = "" if x["kind"] == "frozen" else f", up to {x['moving_pct']:.2f}% of the frame moves"
            out.append(f"          hold {x['start']:.2f}-{x['end']:.2f} ({x['seconds']:.2f} s) {x['kind']}{moving}"
                       f"{' (to the end)' if x['to_end'] else ''}")
        if len(longs) > 12:
            out.append(f"          (+{len(longs) - 12} more holds over 1 s: see --json)")
    b = rep["blank"]
    if b:
        out.append(f"blank     frame 0: {b['frame0']}; last frame: {b['last_frame']}; "
                   f"{len(b['ranges'])} blank range{'s' if len(b['ranges']) != 1 else ''} "
                   f"(typical frame: detail in {b['median_detail_pct']:.1f}% of it"
                   + (f"; a sparse picture, so near-empty means under {b['empty_below_pct']:.2f}%)"
                      if b["empty_below_pct"] < 100 * EMPTY_DETAIL else ")"))
        for r in b["ranges"][:12]:
            part = f", {r['black_frames']} near-black" if r["kind"] == "near-empty" and r["black_frames"] else ""
            out.append(f"          {r['start']:.3f}-{r['end']:.3f} {r['kind']} ({r['frames']} frame{'s' if r['frames'] != 1 else ''}"
                       f"{part}) {', '.join(r['where'])}")
        if len(b["ranges"]) > 12:
            out.append(f"          (+{len(b['ranges']) - 12} more: see --json)")
    lo = rep["loudness"]
    if lo:
        out.append(f"loudness  {lo['integrated_lufs']} LUFS integrated, LRA {lo['lra_lu']} LU, true peak "
                   f"{lo['true_peak_dbtp']} dBTP; sound from {lo['first_sound']:.2f} to {lo['last_sound']:.2f} s")
        st = " ".join(f"{i + 1}:{x:g}" for i, x in enumerate(lo["short_term_per_second"]) if x is not None)
        out.append(f"          short-term LUFS by second: {st or 'n/a'}")
    if rep["cuts"]:
        out.append(f"cuts      {', '.join(f'{c:g}' for c in rep['cuts'][:24])}{' ...' if len(rep['cuts']) > 24 else ''}")
    for i, note in enumerate(rep["notes"]):
        out.append(f"{'notes' if i == 0 else '':9s} - {note}")
    if rep["look_at"]:
        out.append(f"look at   {','.join(f'{t:g}' for t in rep['look_at'])}")
    return "\n".join(out)


def main() -> int:
    for stream in (sys.stdout, sys.stderr):  # a file name the console's code page can't show must not crash it
        stream.reconfigure(errors="replace")
    ap = argparse.ArgumentParser(prog="qc.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video", type=Path, help="the video file")
    ap.add_argument("--cuts", help='cut times: "2.2,4.4" or a file (verify.json, a JSON list, or text)')
    ap.add_argument("--offset", type=float, default=0.0,
                    help="the clip starts this many seconds into the video (render.ts --from): cut times move back by it")
    ap.add_argument("--json", action="store_true", help="print JSON instead of text")
    ap.add_argument("--out", type=Path, help="also write the report here (.json: JSON, else text)")
    args = ap.parse_args()
    try:
        cuts = [round(t - args.offset, 4) for t in parse_cuts(args.cuts)]
    except (OSError, ValueError) as e:
        say(f"--cuts: {e}")
        return 2
    try:
        rep = run(args.video, cuts)
    except Unreadable as e:
        say(str(e))
        return 1
    text = text_report(rep)
    print(json.dumps(rep, indent=1) if args.json else text)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(rep, indent=1) if args.out.suffix.lower() == ".json" else text + "\n",
                            encoding="utf-8")
        say(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
