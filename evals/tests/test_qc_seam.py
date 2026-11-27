# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy>=1.26,<3"]
# ///
"""qc.py --loop: how a loop's last frame leads into frame 0, on synthetic loops, offline (the end-to-end cases need
ffmpeg on PATH): uv run evals/tests/test_qc_seam.py.

The rules are tested on frames drawn at the analysis size (240 x 135, what qc.py compares), so each case says what
it means; a few are also encoded with x264 and read back through qc.py's run(), as a render would be."""
import contextlib
import importlib.util
import io
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

SCRIPT = Path(__file__).resolve().parents[2] / "skills/code-video/scripts/qc.py"
spec = importlib.util.spec_from_file_location("audara_qc", SCRIPT)
qc = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = qc
spec.loader.exec_module(qc)

W, H, N = 240, 135, 120  # the analysis frame; a loop of 120 frames (2 s at 60 fps)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
GROUND = 40 + 60 * xx / W + 30 * yy / H


def disc(cx: float, cy: float, r: float, level: float = 200.0, ground: np.ndarray = GROUND) -> np.ndarray:
    a = np.clip(r + 0.5 - np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2), 0, 1)  # an antialiased edge
    return ground * (1 - a) + level * a


def orbit(i: float, n: int = N, rad: float = 40, r: float = 12) -> np.ndarray:  # a disc round a circle, period n
    th = 2 * np.pi * i / n
    return disc(W / 2 + rad * np.cos(th), H / 2 + rad * np.sin(th), r)


def seam(frames: list[np.ndarray], uneven: str | None = None) -> dict | None:
    """qc.py's seam report on these frames, as analyze_picture collects them."""
    steps = [qc.seam_step(a, b) for a, b in zip(frames, frames[1:])]
    with contextlib.redirect_stderr(io.StringIO()):
        return qc.seam_report((steps, qc.seam_step(frames[-1], frames[0])), len(frames), uneven, "", [])


class Rules(unittest.TestCase):
    def test_a_closed_loop_is_smooth(self):
        self.assertEqual(seam([orbit(i) for i in range(N)])["kind"], "smooth")

    def test_a_last_frame_equal_to_the_first_repeats(self):
        # frames 0..N: the last is frame 0's picture again, so the motion stops for a frame at every wrap
        self.assertEqual(seam([orbit(i) for i in range(N + 1)])["kind"], "repeat")

    def test_a_slow_drift_that_repeats(self):
        self.assertEqual(seam([orbit(i, rad=4) for i in range(N + 1)])["kind"], "repeat")

    def test_a_move_that_does_not_come_back_jumps(self):
        r = seam([disc(30 + 180 * i / N, H / 2, 12) for i in range(N)])
        self.assertEqual(r["kind"], "jump")
        self.assertIn("% of the frame changes", r["why"])

    def test_a_small_part_jumping_is_found_by_its_strength(self):
        # a 3-cell dot drifting a third of a cell a frame: little area changes at the seam, but strongly
        r = seam([disc(100 + 36 * i / N, H / 2, 1.5, level=250) for i in range(N)])
        self.assertEqual(r["kind"], "jump")

    def test_the_strength_rule(self):
        # as much area as the steps around it, changed six times as strongly: a small part that jumps
        steps = [(0.001, 10.0)] * 20
        with contextlib.redirect_stderr(io.StringIO()):
            r = qc.seam_report((steps, (0.0012, 60.0)), 21, None, "", [])
        self.assertEqual(r["kind"], "jump")
        self.assertIn("is 60 levels, against 10", r["why"])

    def test_a_hard_cut_at_the_seam_jumps(self):
        # two shots: the second cut back to the first at the wrap (the treatment says so when it's meant)
        ground = GROUND[:, ::-1] * 0.6 + 50
        frames = [orbit(i) for i in range(N // 2)] + [disc(70 + i, 40, 18, 230, ground) for i in range(N // 2)]
        self.assertEqual(seam(frames)["kind"], "jump")

    def test_a_move_that_turns_back_at_the_seam_reads_smooth(self):
        # out and back: the position closes, the direction doesn't. The seam measures how much changes, not
        # which way, so this one is for the frames either side
        self.assertEqual(seam([disc(30 + 180 * (1 - abs(1 - 2 * i / N)), H / 2, 12) for i in range(N)])["kind"],
                         "smooth")

    def test_a_frame_missing_before_the_wrap_jumps(self):
        # frames 0..N-2 of a period of N: the step into frame 0 covers two frames' motion
        self.assertEqual(seam([orbit(i) for i in range(N - 1)])["kind"], "jump")

    def test_drawings_held_four_frames_are_smooth(self):
        # stepped animation (a drawing every 4 frames, a period that divides the length): the drawing changes on
        # frame 0, between still steps, as it does every 4 frames through the loop
        self.assertEqual(seam([orbit(4 * (i // 4)) for i in range(N)])["kind"], "smooth")

    def test_a_drawing_held_across_the_wrap_on_twos_is_smooth(self):
        # on twos, phased so the last frame and frame 0 show the same drawing: a hold between moving steps, as at
        # every other step of the loop, not a repeat
        self.assertEqual(seam([orbit(2 * ((i + 1) // 2) % N) for i in range(N)])["kind"], "smooth")

    def test_a_smaller_step_of_the_same_kind_is_no_repeat(self):
        # every step brightens the whole frame by 7 levels and the seam by 5: no cell crosses the 6-level line at
        # the seam, but it is a step like the others, not a picture shown twice
        levels = [100 + 7 * k for k in range(4)] + [100 + 7 * 3 + 5 + 7 * k for k in range(4)]
        frames = [np.full((H, W), x, np.float32) for x in levels]
        frames = frames[4:] + frames[:4]  # frame 0 is the fifth level: the seam is the 5-level step
        self.assertNotEqual(seam(frames)["kind"], "repeat")

    def test_a_still_picture_is_smooth(self):
        rng = np.random.default_rng(1)
        still = disc(W / 2, H / 2, 30)
        self.assertEqual(seam([still + rng.normal(0, 1.5, still.shape) for _ in range(N)])["kind"], "smooth")

    def test_a_drift_too_slow_for_any_step_jumps_back(self):
        # a fiftieth of a cell a frame: no step reaches the 6-level line, and the seam takes it all back at once
        r = seam([disc(W / 2 + 0.02 * i, H / 2, 12) for i in range(N)])
        self.assertEqual(r["kind"], "jump")
        self.assertIn("none of which changes", r["against"])

    def test_a_flash_on_frame_0_reads_like_the_flashes_around_it(self):
        # a flash on every beat, one of them on frame 0
        flash = [1 + 0.6 * np.exp(-(i % 30) / 4) for i in range(N)]
        self.assertEqual(seam([orbit(i) * f for i, f in enumerate(flash)])["kind"], "smooth")

    def test_too_few_frames(self):
        self.assertIsNone(seam([orbit(i) for i in range(2 * qc.SEAM_STEPS + 1)]))

    def test_uneven_frames_are_not_judged(self):
        r = seam([orbit(i) for i in range(N + 1)], uneven="the frames aren't evenly spaced")
        self.assertEqual(r["kind"], "unjudged")


class Timing(unittest.TestCase):
    """uneven_frames() on a file's packet times, given as ffprobe prints them (pts, duration)."""

    def uneven(self, rows: list[str], decoded: int, tick: float) -> str | None:
        done = subprocess.CompletedProcess([], 0, stdout="\n".join(rows) + "\n", stderr="")
        with mock.patch.object(qc, "need", return_value="ffprobe"), mock.patch.object(qc.subprocess, "run", return_value=done):
            return qc.uneven_frames(Path("loop.mkv"), 0, decoded, tick)

    def test_even_frames(self):
        self.assertIsNone(self.uneven([f"{i / 30:.6f},{1 / 30:.6f}" for i in range(20)], 20, 1 / 15360))

    def test_an_unknown_last_duration_is_not_judged(self):
        # regular gaps and the right count, but when the last frame ends (when the loop wraps) isn't in the file
        rows = [f"{i / 10:.6f},0.100000" for i in range(19)] + ["1.900000,N/A"]
        self.assertIn("last frame's duration couldn't be read", self.uneven(rows, 20, 0.001))

    def test_whole_millisecond_times_at_60_fps_are_even(self):
        # a 60 fps Matroska file: times round to 1 ms, so frames alternate 17 and 16 ms
        rows = [f"{round(i * 1000 / 60) / 1000:.6f},0.016000" for i in range(120)]
        self.assertIsNone(self.uneven(rows, 120, 0.001))
        self.assertIsNotNone(self.uneven(rows, 120, 0.0))  # the tick is what lets them through

    def test_a_count_the_decoder_changed(self):
        rows = [f"{i / 30:.6f},{1 / 30:.6f}" for i in range(20)]
        self.assertIn("decoder gave 21 frames", self.uneven(rows, 21, 1 / 15360))


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "needs ffmpeg and ffprobe")
class Encoded(unittest.TestCase):
    """Encoded as render.ts encodes a draft (x264, CRF 23, yuv420p) at 960 x 540, read back through qc.py. (Smaller
    frames average less encoder noise into each analysis cell: at 480 x 270 a draft's re-encoded frame 0 leaves a
    quarter of a moving step's share.)"""

    @classmethod
    def setUpClass(cls):
        cls.dir = Path(tempfile.mkdtemp(prefix="qc-seam-"))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.dir, ignore_errors=True)

    def encode(self, name: str, frames: list[np.ndarray], extra: list[str] | None = None, fps: int = 30,
               ext: str = "mp4") -> Path:
        path = self.dir / f"{name}.{ext}"
        big = [np.repeat(np.repeat(f, 4, 0), 4, 1) for f in frames]  # 960 x 540
        cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", "960x540", "-r", str(fps),
               "-i", "-", *(extra or []), "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
               str(path)]
        data = b"".join(np.clip(f, 0, 255).astype(np.uint8).tobytes() for f in big)
        subprocess.run(cmd, input=data, check=True)
        return path

    def kind(self, path: Path) -> str:
        with contextlib.redirect_stderr(io.StringIO()):
            return qc.run(path, [], loop=True)["seam"]["kind"]

    def test_smooth_repeat_and_jump(self):
        n = 60
        self.assertEqual(self.kind(self.encode("smooth", [orbit(i, n=n) for i in range(n)])), "smooth")
        self.assertEqual(self.kind(self.encode("repeat", [orbit(i, n=n) for i in range(n + 1)])), "repeat")
        self.assertEqual(self.kind(self.encode("jump", [disc(30 + 180 * i / n, H / 2, 12) for i in range(n)])), "jump")

    def test_a_variable_frame_rate_is_not_judged(self):
        # a gap in the timestamps: the decoder would fill it with repeated frames
        n = 60
        path = self.encode("vfr", [orbit(i, n=n) for i in range(n)],
                           ["-vf", "setpts='PTS+gte(N,30)*10'", "-fps_mode", "passthrough"])
        self.assertEqual(self.kind(path), "unjudged")

    def test_two_frames_moved_keeping_the_count_and_length_are_not_judged(self):
        # frame 1 half a frame early (in a time base fine enough to hold it): the length and the count still read
        # 30 fps, but two frames show for half a frame and one and a half
        n = 60
        path = self.encode("moved", [orbit(i, n=n) for i in range(n)],
                           ["-vf", "settb=1/15360,setpts='PTS-eq(N,1)*256'", "-fps_mode", "passthrough",
                            "-enc_time_base", "filter"])
        with contextlib.redirect_stderr(io.StringIO()):
            r = qc.run(path, [], loop=True)
        self.assertEqual(r["stream"]["video"]["frames"], n)
        self.assertEqual(r["seam"]["kind"], "unjudged")
        self.assertIn("aren't evenly spaced", r["seam"]["why"])
        self.assertIn("16.7-50.0 ms instead of 33.3", r["seam"]["why"])

    def test_a_60_fps_matroska_file_is_judged(self):
        # its times round to whole milliseconds (17 and 16 ms apart): even, within a tick of its time base
        n = 120
        self.assertEqual(self.kind(self.encode("mkv60", [orbit(i, n=n) for i in range(n)], fps=60, ext="mkv")),
                         "smooth")

    def test_without_loop_no_seam(self):
        path = self.encode("plain", [orbit(i, n=60) for i in range(60)])
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertIsNone(qc.run(path, [])["seam"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
