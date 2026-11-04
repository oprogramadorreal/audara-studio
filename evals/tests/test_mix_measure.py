# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=2.0,<3", "scipy>=1.13,<2", "soundfile>=0.12,<1", "matplotlib>=3.8,<4"]
# ///
"""mix.py's voice-over-bed and music-join checks on synthetic stems built through a small mix.json, without network
or paid calls (needs ffmpeg on PATH): uv run evals/tests/test_mix_measure.py."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal

SCRIPT = Path(__file__).resolve().parents[2] / "skills/soundtrack/scripts/mix.py"
spec = importlib.util.spec_from_file_location("audara_mix", SCRIPT)
mix = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mix
spec.loader.exec_module(mix)

SR = 48_000
# Seven narration lines with 1 s pauses between them, and the length of the mix they give (the voice's end + 0.5 s).
LINES = [(0.8, 3.0), (4.0, 6.2), (7.2, 9.4), (10.4, 12.6), (13.6, 15.8), (16.8, 19.0), (20.0, 22.2)]
SYL, STEP = 0.16, 0.22  # a syllable's length and the step between syllables (about 4.5 a second, as speech)


def db(x: float) -> float:
    return 10 ** (x / 20)


def ramp(n: int) -> np.ndarray:
    return 0.5 - 0.5 * np.cos(np.pi * np.arange(n) / max(1, n))


def voice(rng: np.random.Generator, n: int):
    """A voice-like signal: voiced syllables (a gliding 120 Hz pitch, harmonics shaped by three formants) with a
    short noise consonant before every other one, grouped two syllables to a word; silence between the lines.
    Returns the signal and data/words.json's lines."""
    x = np.zeros(n)
    lines = []
    hp = signal.butter(4, 2500, "highpass", fs=SR, output="sos")
    for li, (a, b) in enumerate(LINES):
        t, syl = a, []
        while t + SYL <= b + 1e-9:
            L = int(SYL * SR)
            tau = np.arange(L) / SR
            f0 = 120 + 18 * np.sin(2 * np.pi * 1.3 * (t + tau))
            ph = 2 * np.pi * np.cumsum(f0) / SR
            s = np.zeros(L)
            for k in range(1, 30):
                f = k * 120
                w = sum(g * np.exp(-0.5 * (np.log(f / c) / 0.18) ** 2)
                        for c, g in ((600, 1.0), (1200, 0.6), (2500, 0.3)))
                s += w * np.sin(k * ph)
            n0 = int(round(t * SR))
            x[n0:n0 + L] += s * np.sin(np.pi * tau / SYL) ** 2
            if len(syl) % 2 == 0:  # a consonant: 25 ms of bright noise as the syllable starts
                c = signal.sosfilt(hp, rng.standard_normal(int(0.025 * SR))) * 0.25
                x[n0:n0 + len(c)] += c * ramp(len(c))[::-1]
            syl.append((t, t + SYL))
            t += STEP
        words = [{"w": f"w{li}{k}", "start": round(syl[2 * k][0], 3),
                  "end": round(syl[min(2 * k + 1, len(syl) - 1)][1], 3)} for k in range((len(syl) + 1) // 2)]
        lines.append({"text": f"line {li} " + " ".join(w["w"] for w in words), "start": words[0]["start"],
                      "end": words[-1]["end"], "words": words})
    speaking = np.abs(x) > 0
    x *= db(-20) / np.sqrt(np.mean(x[speaking] ** 2))  # about -20 dBFS RMS while it speaks
    return x, lines


def pad(n: int, chord, rng: np.random.Generator, phase0: float = 0.0) -> np.ndarray:
    """A sustained chord with a slow swell and a little low-passed noise: a music bed."""
    t = np.arange(n) / SR
    x = sum(np.sin(2 * np.pi * f * t + phase0 + i) / (1 + i * 0.3) for i, f in enumerate(chord))
    x = x * (1 + 0.15 * np.sin(2 * np.pi * 0.5 * t))
    x += signal.sosfilt(signal.butter(2, 2000, "lowpass", fs=SR, output="sos"), rng.standard_normal(n)) * 0.05
    return x / np.sqrt(np.mean(x ** 2)) * db(-18)


def drums(n: int, rng: np.random.Generator) -> np.ndarray:
    """A kick every 0.6 s (100 BPM) and a hat on the half beats: windows of 100 ms swing 10 dB or more."""
    x = np.zeros(n)
    k_len, h_len = int(0.25 * SR), int(0.02 * SR)
    tau = np.arange(k_len) / SR
    kick = np.sin(2 * np.pi * np.cumsum(50 + 90 * np.exp(-tau / 0.03)) / SR) * np.exp(-tau / 0.09)
    hat = signal.sosfilt(signal.butter(4, 6000, "highpass", fs=SR, output="sos"), rng.standard_normal(h_len))
    hat *= np.exp(-np.arange(h_len) / SR / 0.006)
    for t in np.arange(0, n / SR, 0.3):
        i = int(t * SR)
        src = kick if round(t / 0.3) % 2 == 0 else hat * 0.3
        j = min(n, i + len(src))
        x[i:j] += src[:j - i]
    return x * db(-8)


def envelope(n: int, points) -> np.ndarray:
    """A gain curve: (time, dB) points joined by 20 ms ramps; None is silence."""
    g = np.ones(n)
    for a, b, gain in points:
        i0, i1 = int(a * SR), int(b * SR)
        g[i0:i1] = 0.0 if gain is None else db(gain)
    return signal.convolve(g, np.ones(int(0.02 * SR)) / int(0.02 * SR), mode="same")


def crash(rng: np.random.Generator) -> np.ndarray:
    n = int(0.35 * SR)
    return rng.standard_normal(n) * np.exp(-np.arange(n) / SR / 0.08) * 0.5


def write(path: Path, x: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), np.clip(x, -1, 1).astype(np.float32), SR, subtype="PCM_24")


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def stereo(x: np.ndarray) -> np.ndarray:
    return np.stack([x, x], axis=1).astype(np.float32)


class JoinsTest(unittest.TestCase):
    """music_joins on arrays, without ffmpeg: what a stop meant in the plan carries, and what drums don't fake."""

    def setUp(self):
        self.rng = np.random.default_rng(11)
        self.n = 10 * SR
        self.active = np.zeros(1000, bool)  # the voice speaks from 1 s to 9 s (100 Hz frames)
        self.active[100:900] = True

    def joins(self, m: np.ndarray, points):
        x = mix.Power(stereo(m))
        return {p["t"]: p for p in mix.music_joins(x, x, self.active, points, self.n / SR, len(points))["points"]}

    def test_the_return_after_a_stop_is_as_meant_as_the_stop(self):
        m = pad(self.n, (110, 220, 330), self.rng)
        m[3 * SR:5 * SR] = 0  # a stop at 3 s, back at 5 s at full level
        for intended, status in (("a planned silence", "intended"), (None, "listed")):
            with self.subTest(intended=intended):
                pts = self.joins(m, [{"t": 3.0, "kind": "join", "source": "test", "intended": intended}])
                self.assertEqual(sorted(pts), [3.0, 5.0])
                self.assertEqual(pts[5.0]["kind"], "music back")
                self.assertIn("a surge", " ".join(pts[5.0]["findings"]))
                self.assertEqual((pts[3.0]["status"], pts[5.0]["status"]), (status, status))

    def test_an_intended_join_anywhere_in_a_silence_covers_its_stop_and_return(self):
        m = pad(self.n, (110, 220, 330), self.rng)
        m[3 * SR:5 * SR] = 0  # a silence from 3 s to 5 s; the join sits in its middle, 1 s from either end
        pts = self.joins(m, [{"t": 4.0, "kind": "join", "source": "test", "intended": "a planned silence"}])
        self.assertEqual(sorted(pts), [4.0, 5.0], json.dumps(list(pts.values()), indent=1))
        self.assertEqual(pts[4.0]["stop_at"], 3.0)
        self.assertEqual((pts[4.0]["status"], pts[5.0]["status"]), ("intended", "intended"))
        # The same join with no intent leaves the stop and the hard return listed, and is clear itself.
        pts = self.joins(m, [{"t": 4.0, "kind": "join", "source": "test", "intended": None}])
        self.assertEqual({t: p["status"] for t, p in pts.items()}, {3.0: "listed", 4.0: "clear", 5.0: "listed"})

    def test_drums_alone_read_as_no_hole_and_no_surge(self):
        m = pad(self.n, (110, 220, 330), self.rng) * 0.3 + drums(self.n, self.rng)
        pts = self.joins(m, [{"t": t, "kind": "join", "source": "test", "intended": None} for t in (2.0, 4.05, 6.3)])
        self.assertEqual([p for p in pts.values() if p["findings"]], [], json.dumps(list(pts.values()), indent=1))

    def test_the_two_joins_the_devlogs_measured_after_the_notes(self):
        t = np.arange(self.n) / SR
        bridge = pad(self.n, (110, 220, 330), self.rng) * db(-17 + 18)  # (pad() sits at -18 dBFS RMS)
        loud = pad(self.n, (98, 196, 294, 392), self.rng, 0.4) * db(-8.5 + 18)
        x = np.clip((t - 5.0) / 0.03, 0, 1)  # a 30 ms crossfade from a quiet bridge into a loud section at 5 s
        pts = self.joins(bridge * np.cos(x * np.pi / 2) + loud * np.sin(x * np.pi / 2),
                         [{"t": 5.0, "kind": "join", "source": "test", "intended": None}])
        self.assertIn("a surge", " ".join(pts[5.0]["findings"]))
        self.assertAlmostEqual(pts[5.0]["step_db"], 8.5, delta=1.0)
        # The old track fades out from 0.5 s before the cut to 0.5 s after it; the next one sits at -31 dBFS for
        # 0.3 s, then comes up 10 dB over 0.6 s, to the old one's level (that project gain-matched its tracks).
        old = pad(self.n, (110, 220, 330), self.rng) * db(-21 + 18) * np.clip((5.5 - t) / 1.0, 0, 1)
        new = pad(self.n, (98, 196, 294, 392), self.rng, 0.4) * db(-31 + 18) * np.where(
            t < 5.0, 0, db(np.clip((t - 5.3) / 0.6, 0, 1) * 10))
        pts = self.joins(old + new, [{"t": 5.0, "kind": "join", "source": "test", "intended": None}])
        self.assertIn("a hole", " ".join(pts[5.0]["findings"]), pts[5.0])

    def test_a_drum_groove_that_steps_up_at_the_join_surges(self):
        t = np.arange(self.n) / SR
        m = (pad(self.n, (110, 220, 330), self.rng) * 0.3 + drums(self.n, self.rng)) * db(np.where(t < 5.0, -8, 0))
        pts = self.joins(m, [{"t": 5.0, "kind": "join", "source": "test", "intended": None}])
        self.assertIn("a surge", " ".join(pts[5.0]["findings"]), pts[5.0])

    def test_a_rise_before_the_join_is_not_a_surge_there(self):
        # Up 8 dB over 0.6 s from 3.3 s (a duck's release in a long pause), then a hard 8 dB step at 6 s.
        t = np.arange(self.n) / SR
        g = np.interp(t, [0, 3.3, 3.9, 6.0, 6.001, 10], [-8, -8, 0, 0, 8, 8])
        m = pad(self.n, (110, 220, 330), self.rng) * 10 ** (g / 20) * 0.3
        pts = self.joins(m, [{"t": t, "kind": "join", "source": "test", "intended": None} for t in (4.0, 6.0)])
        self.assertEqual(pts[4.0]["findings"], [], pts[4.0])
        self.assertIn("a surge", " ".join(pts[6.0]["findings"]))


class VoiceOverBedTest(unittest.TestCase):
    def test_lines_over_silence_leave_the_video_median_to_the_others(self):
        # Six lines, music under the first two only, 12 LU under the voice: nothing is listed (a median over all six
        # would be the 40 LU of silence, and the two with music would read 28 LU closer than it).
        n = 14 * SR
        rng = np.random.default_rng(5)
        v = np.zeros(n)
        spans = [(0.5 + 2 * k, 2.0 + 2 * k) for k in range(6)]
        for a, b in spans:
            v[int(a * SR):int(b * SR)] = rng.standard_normal(int(b * SR) - int(a * SR)) * 0.1
        bed = pad(n, (110, 220, 330), rng)
        bed[int(4.2 * SR):] = 0
        active = np.zeros(n // 480, bool)
        for a, b in spans:
            active[int(a * 100):int(b * 100)] = True
        kv = mix.KEnergy(stereo(v))
        act_b = mix.frames_to_blocks(active, len(kv.cnt))
        first = act_b & (np.arange(len(act_b)) < 4200)  # the two lines with music
        bed *= 10 ** ((kv.masked(first) - 12 - mix.KEnergy(stereo(bed)).masked(first)) / 20)  # 12 LU under the voice
        kb = mix.KEnergy(stereo(bed))
        lines = [{"i": k, "start": a, "end": b, "text": f"line {k}"} for k, (a, b) in enumerate(spans)]
        out = mix.voice_over_bed(kv, kb, act_b, lines, [], "test", mix.UNDER_VOICE_LU)
        meds = [x["median_lu"] for x in out["lines"]]
        self.assertLess(max(meds[:2]), mix.VOB_CLEAR_LU)  # (the music sits within the bars' reach there)
        self.assertEqual(meds[2:], [mix.VOB_CAP_LU] * 4)
        self.assertAlmostEqual(out["video_median_lu"], float(np.median(meds[:2])), places=1)
        self.assertEqual(out["listed"], 0, json.dumps(out["lines"], indent=1))

    def steady(self, lines, target=mix.UNDER_VOICE_LU):
        """voice_over_bed on lines given as (start, end, margin): white noise as the voice, over a steady low-passed
        noise bed `margin` LU under it (None: silence under the line; False: no voice in the line either)."""
        rng = np.random.default_rng(9)
        n = int((max(b for _, b, _ in lines) + 0.5) * SR)
        v, bed = np.zeros(n), np.zeros(n)
        noise = signal.sosfilt(signal.butter(2, 4000, "lowpass", fs=SR, output="sos"), rng.standard_normal(n))
        active = np.zeros(n // 480, bool)
        for a, b, margin in lines:
            i0, i1 = int(a * SR), int(b * SR)
            if margin is False:
                continue
            v[i0:i1] = rng.standard_normal(i1 - i0) * 0.1
            active[int(a * 100):int(b * 100)] = True
            if margin is not None:
                lv = mix.KEnergy(stereo(v[i0:i1]), phone=False).lufs(0, (i1 - i0) / SR)
                lb = mix.KEnergy(stereo(noise[i0:i1]), phone=False).lufs(0, (i1 - i0) / SR)
                bed[i0:i1] = noise[i0:i1] * 10 ** ((lv - margin - lb) / 20)
        kv = mix.KEnergy(stereo(v))
        rows = [{"i": k, "start": a, "end": b, "text": f"line {k}"} for k, (a, b, _) in enumerate(lines)]
        return mix.voice_over_bed(kv, mix.KEnergy(stereo(bed)), mix.frames_to_blocks(active, len(kv.cnt)), rows,
                                  [], "test", target)

    def test_lines_over_room_tone_leave_the_video_median_to_the_others(self):
        # Three lines at the default 12 LU over music, four over room tone (-52 dBFS against a -20 voice, about
        # 30 LU): counted in, the room tone made a median of 30 and listed the three as 18 LU closer than it.
        out = self.steady([(0.5 + 2 * k, 2.0 + 2 * k, 12 if k < 3 else 30) for k in range(7)])
        self.assertAlmostEqual(out["video_median_lu"], 12, delta=0.3)
        self.assertEqual(out["listed"], 0, json.dumps(out["lines"], indent=1))

    def test_a_line_at_the_plans_under_voice_is_not_listed_against_the_median(self):
        # Three lines at 14.6 LU and one at 10.3, 4.3 LU closer: listed under the default 12 LU, not when the plan
        # sets under_voice to 10 (the line sits where the plan put the music).
        lines = [(0.5 + 2 * k, 2.0 + 2 * k, 14.6 if k < 3 else 10.3) for k in range(4)]
        for target, listed in ((mix.UNDER_VOICE_LU, [3]), (10.0, [])):
            with self.subTest(target=target):
                out = self.steady(lines, target)
                self.assertEqual([x["i"] for x in out["lines"] if x["findings"]], listed,
                                 json.dumps(out["lines"], indent=1))

    def test_a_line_shorter_than_a_window_is_not_measured(self):
        # A 40 ms line with no speech in it, just before the next one: its window reached into that line, and it
        # read -120 LUFS for the voice and a median 95 LU under zero, into the video's median.
        out = self.steady([(0.5, 2.0, 12), (2.46, 2.50, False), (2.50, 4.0, 12), (4.5, 4.56, 12)])
        self.assertEqual([x["i"] for x in out["lines"]], [0, 2], json.dumps(out["lines"], indent=1))
        self.assertEqual(out["unmeasured"], 2)
        self.assertEqual(out["listed"], 0)
        self.assertAlmostEqual(out["video_median_lu"], 12, delta=0.3)


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "needs ffmpeg and ffprobe on PATH")
class MixMeasureTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(prefix="audara-mix-test-")
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        os.environ["MPLCONFIGDIR"] = str(self.root / "mpl")  # (matplotlib's font cache stays in the temp folder)
        self.rng = np.random.default_rng(20261104)
        self.n_voice = int(23.0 * SR)

    def project(self, name: str, music: np.ndarray | None, plan_music: dict, effects=(), words=True) -> Path:
        """A folder outside any project: in/ holds the stems, data/words.json the narration's timing, mix.json the
        plan (built with --out, as a video made elsewhere is). No music array: a plan with no music."""
        d = self.root / name
        v, lines = voice(np.random.default_rng(7), self.n_voice)
        write(d / "in" / "voice.wav", v)
        if music is not None:
            write(d / "in" / "music.wav", music)
        write(d / "in" / "crash.wav", crash(np.random.default_rng(3)))
        if words:
            (d / "data").mkdir(parents=True, exist_ok=True)
            (d / "data" / "words.json").write_text(json.dumps({
                "lines": lines, "audioSha256": sha(d / "in" / "voice.wav"),
                "source": {"kind": "narration", "audio": "in/voice.wav"}}), encoding="utf-8")
        plan = {"voice": "in/voice.wav", "effects": list(effects)}
        if music is not None:
            plan["music"] = {"file": "in/music.wav", **plan_music}
        (d / "mix.json").write_text(json.dumps(plan), encoding="utf-8")
        return d

    def build(self, d: Path, *extra: str):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = mix.main(["build", "--plan", str(d / "mix.json"), "--out", str(d), *extra])
        self.assertEqual(code, 0, err.getvalue() + out.getvalue())
        report = json.loads((d / "out" / "mix-report.json").read_text(encoding="utf-8"))
        return report, out.getvalue()

    def test_planned_problems_are_listed_and_the_intended_ones_are_not(self):
        n = int(21.0 * SR)  # the music ends at 21 s, under the last line (marked intended_end on the music)
        m = pad(n, (110, 220, 261.6, 329.6, 440), self.rng) * envelope(n, [
            (3.40, 3.75, -18),  # a hole at a splice (3.5 s)
            (6.70, 9.90, 10),  # a surge into a loud section (6.7 s), back down at 9.9 s
            (12.0, 13.2, None),  # a stop under the voice (line 3 runs to 12.6 s), not in the plan
            (17.5, 19.5, None),  # a silence the plan marks as intended
        ])
        back = int(19.5 * SR), int(20.7 * SR)  # it comes back from the silence over a 1.2 s fade-in
        m[back[0]:back[1]] *= np.linspace(0, 1, back[1] - back[0])
        m[-int(0.02 * SR):] *= np.linspace(1, 0, int(0.02 * SR))
        d = self.project("planned", m, {
            "intended_end": "the music ends before the last line, to leave it bare",
            "joins": [{"at": 3.5, "note": "splice"}, 6.7, "0:09.9",
                      {"at": 17.5, "intended": "the music drops out under the punchline"},
                      {"word": "w60", "offset": -0.5}]},  # (the return, half a second before line 6's first word)
            effects=[{"file": "in/crash.wav", "at": 14.6, "gain_db": 0}])
        rep, printed = self.build(d)

        vob = rep["voice_over_bed"]
        self.assertEqual(vob["by"], "data/words.json lines")
        listed = {x["i"]: x for x in vob["lines"] if x["findings"]}
        self.assertEqual(sorted(listed), [2, 4], json.dumps(vob["lines"], indent=1))
        self.assertLess(listed[2]["median_lu"], mix.VOB_MEDIAN_LU)  # the loud section under line 2
        self.assertLess(listed[4]["worst_lu"], mix.VOB_WORST_LU)  # the crash over one word of line 4
        self.assertGreaterEqual(listed[4]["median_lu"], mix.VOB_MEDIAN_LU)  # ...not averaged into the line
        self.assertAlmostEqual(listed[4]["worst_at"], 14.6, delta=0.15)
        self.assertTrue(listed[4].get("worst_word"))
        self.assertTrue(listed[2]["text"].startswith("line 2"))

        pts = {round(p["t"], 1): p for p in rep["music_joins"]["points"]}
        back = [t for t, p in pts.items() if p["kind"] == "music back"]
        self.assertEqual(len(back), 1, json.dumps(list(pts.values()), indent=1))
        self.assertAlmostEqual(back[0], 13.2, delta=0.11)  # (the 100 ms window where the music sounds again)
        pts[13.2] = pts.pop(back[0])
        self.assertEqual(sorted(pts), [3.5, 6.7, 9.9, 12.0, 13.2, 17.5, 19.5, 21.0],
                         json.dumps(list(pts.values()), indent=1))
        self.assertEqual(pts[3.5]["status"], "listed")
        self.assertIn("a hole", " ".join(pts[3.5]["findings"]))
        self.assertEqual(pts[6.7]["status"], "listed")
        self.assertIn("a surge", " ".join(pts[6.7]["findings"]))
        self.assertEqual(pts[12.0]["kind"], "stop")
        self.assertEqual(pts[12.0]["status"], "listed")
        self.assertTrue(pts[12.0]["voice_after_stop"])
        self.assertEqual(pts[13.2]["kind"], "music back")  # its hard return under the narration
        self.assertEqual(pts[13.2]["status"], "listed")
        self.assertIn("a surge", " ".join(pts[13.2]["findings"]))
        for t in (17.5, 21.0):
            self.assertEqual(pts[t]["status"], "intended", pts[t])
            self.assertIn("stops", " ".join(pts[t]["findings"]))
        self.assertEqual(pts[9.9]["status"], "clear", pts[9.9])  # a step down is no hole and no surge
        self.assertEqual(pts[19.5]["status"], "clear", pts[19.5])  # a 1.2 s fade-in back is no surge
        self.assertEqual(pts[19.5]["source"], 'music.joins[4] (word "w60" -0.500 s)')
        self.assertEqual(rep["music_joins"]["listed"], 4)
        self.assertEqual(rep["music_joins"]["intended"], 2)
        prof = pts[3.5]["profile"]
        self.assertEqual(len(prof["bed_dbfs"]), 30)
        self.assertEqual(prof["from_s"], 2.0)

        self.assertIn("voice over the bed", printed)
        self.assertIn("music joins", printed)
        self.assertIn("intended (the music drops out under the punchline)", printed)
        self.assertIn("measurements, not a judgement of how it sounds", printed)
        rec = json.loads((d / "audio" / "mix.wav.request.json").read_text(encoding="utf-8"))
        self.assertEqual(rec["music_joins"]["listed"], 4)
        self.assertEqual(rec["voice_over_bed"]["listed"], 2)

        # An unchanged plan is up to date and prints the same lists from the record.
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(mix.main(["build", "--plan", str(d / "mix.json"), "--out", str(d)]), 0)
        self.assertIn("is up to date", out.getvalue())
        self.assertIn("a surge", out.getvalue())

        # measure gets only the finished file: it says these checks need the plan, and adds no keys for them.
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(mix.main(["measure", str(d / "audio" / "mix.wav"), "--out", str(d), "--json"]), 0)
        meas = json.loads(out.getvalue())
        self.assertIn(mix.MEASURE_NO_STEMS, meas["notes"])
        self.assertNotIn("voice_over_bed", meas)
        self.assertNotIn("music_joins", meas)

    def test_a_clean_mix_lists_nothing(self):
        # Two chords joined by a 50 ms equal-power crossfade at 9.9 s (listed in the plan), with drums whose 100 ms
        # windows swing 10 dB and more, and an effect the solver levels over line 4.
        n = int(23.5 * SR)
        a = pad(n, (110, 220, 261.6, 329.6, 440), self.rng) + drums(n, self.rng)
        b = pad(n, (87.3, 174.6, 220, 261.6, 349.2), self.rng, 0.7) + drums(n, self.rng)
        x0, xf = int(9.875 * SR), int(0.05 * SR)
        w = np.zeros(n)
        w[x0:x0 + xf] = np.linspace(0, 1, xf)
        w[x0 + xf:] = 1
        m = a * np.cos(w * np.pi / 2) + b * np.sin(w * np.pi / 2)
        effects = [{"file": "in/crash.wav", "at": 14.6}]
        for words in (True, False):
            with self.subTest(words=words):
                d = self.project(f"clean-{words}", m, {"joins": [{"at": 9.9, "note": "into the next chord"}]},
                                 effects=effects, words=words)
                rep, printed = self.build(d)
                vob = rep["voice_over_bed"]
                self.assertEqual(vob["by"].startswith("data/words.json"), words)
                self.assertEqual(len(vob["lines"]), len(LINES))
                self.assertEqual([x for x in vob["lines"] if x["findings"]], [], json.dumps(vob["lines"], indent=1))
                self.assertGreater(vob["video_median_lu"], mix.VOB_MEDIAN_LU)
                joins = rep["music_joins"]
                self.assertEqual([p for p in joins["points"] if p["status"] != "clear"], [],
                                 json.dumps(joins["points"], indent=1))
                self.assertEqual([p["t"] for p in joins["points"]], [9.9])  # (the music plays to the end of the mix)
                self.assertIn("none under the bars", printed)
                self.assertIn("nothing listed", printed)

    def test_no_line_with_a_bed_under_it_builds_and_rebuilds(self):
        # Every line over silence (the 40 LU cap) left no median line, and printing it crashed the build after its
        # files were written, then every up-to-date run of the same plan from the record.
        for name, music in (("voice-only", None),
                            ("music-before-the-voice", pad(int(0.6 * SR), (110, 220, 330), self.rng))):
            with self.subTest(name=name):
                d = self.project(name, music, {}, words=True)
                rep, printed = self.build(d)
                vob = rep["voice_over_bed"]
                self.assertEqual(len(vob["lines"]), len(LINES))
                self.assertIsNone(vob["video_median_lu"])
                self.assertEqual(vob["listed"], 0, json.dumps(vob["lines"], indent=1))
                self.assertIn("no line has music or effects within 15 LU of the voice", printed)
                _, again = self.build(d)
                self.assertIn("is up to date", again)
                self.assertIn("no line has music or effects within 15 LU of the voice", again)
                if music is None:
                    self.assertIsNone(rep["music_joins"])
                else:  # (the music stops 0.2 s before the first line: listed, as a stop under the voice)
                    self.assertEqual([(p["kind"], p["status"]) for p in rep["music_joins"]["points"]],
                                     [("music ends", "listed")])

    def test_the_music_start_and_end_take_their_own_intent(self):
        # The music comes in hard at 3.3 s, in the pause after the first line, and stops at 19.3 s, before the last
        # line. intended_start excuses the entrance's surge and leaves the stop under the voice listed.
        m = pad(int(16.0 * SR), (110, 220, 261.6, 329.6, 440), self.rng)
        m[-int(0.02 * SR):] *= np.linspace(1, 0, int(0.02 * SR))
        d = self.project("ends", m, {"at": 3.3, "intended_start": "the music comes in hard after the first line"})
        rep, printed = self.build(d)
        pts = {p["kind"]: p for p in rep["music_joins"]["points"]}
        self.assertEqual(sorted(pts), ["music ends", "music starts"], json.dumps(list(pts.values()), indent=1))
        self.assertIn("a surge", " ".join(pts["music starts"]["findings"]))
        self.assertEqual(pts["music starts"]["status"], "intended")
        self.assertTrue(pts["music ends"]["voice_after_stop"])
        self.assertEqual(pts["music ends"]["status"], "listed")
        # No music.joins: the note on joins inside the music prints on the music file's first build, not again.
        self.assertIn(rep["music_joins"]["inside_the_music"], printed)
        rep, printed = self.build(d, "--force")
        self.assertIn("inside_the_music", rep["music_joins"])
        self.assertNotIn(rep["music_joins"]["inside_the_music"], printed)

    def test_plan_mistakes_are_usage_errors(self):
        n = int(23.0 * SR)
        m = pad(n, (110, 220, 330), self.rng)
        for music, msg in (({"joins": [{"at": 3, "intended": True}]}, "intended takes the reason"),
                           ({"joins": [{"at": 3, "intendd": "x"}]}, 'did you mean "intended"'),
                           ({"joins": [{"note": "no time"}]}, "needs exactly one of"),
                           ({"joins": {"at": 3}}, "music.joins must be a list"),
                           ({"intended": "x"}, '"intended_start" (its entrance) or "intended_end" (its end)'),
                           ({"intended_end": ""}, "music.intended_end takes the reason")):
            with self.subTest(msg=msg):
                d = self.project("bad", m, music, words=False)
                err, out = io.StringIO(), io.StringIO()
                with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                    code = mix.main(["build", "--plan", str(d / "mix.json"), "--out", str(d)])
                self.assertEqual(code, mix.EXIT_USAGE)
                self.assertIn(msg, err.getvalue())


if __name__ == "__main__":
    unittest.main()
