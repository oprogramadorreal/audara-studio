# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx>=0.28,<1", "numpy>=2.0,<3"]
# ///
"""eleven.py's narration-take pitch diagnostic, offline: uv run evals/tests/test_eleven_pitch.py.

The F0 estimator on synthetic voices (harmonic tones with vibrato, jitter and shimmer, words with fricatives, pauses
and noise) whose true pitch is known sample by sample; a whisper and a clip too short, which get no verdict; and three
octave traps, each shown to catch a plainer picker or this one without its guard. Then the comparison with the kept
blocks around a take, on files with request records; and tts with --takes end to end against evals/mocks/elevenlabs.py,
served in-process (its cache and log in a temp folder), for the report's fields, the block's own file among its takes,
and takes reused for free after a paragraph is inserted before them. Needs ffmpeg (as eleven.py does); no network, no
paid call."""
import contextlib
import hashlib
import importlib.util
import io
import json
import math
import os
import shutil
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import numpy as np

REPO = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True  # (no __pycache__ beside the skill's scripts and the mock)


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


eleven = load("audara_eleven", REPO / "skills/soundtrack/scripts/eleven.py")
SR = eleven.PITCH_SR
HAS_FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


# ---------------------------------------------------------------------------------------------
# synthetic speech with a known pitch


def voice(f0: float, n: int, rng, vib=0.03, jitter=0.01, shimmer=0.06, amps=None, alt=None, odd=1.0):
    """n samples of a voiced sound: harmonics of an F0 that moves with a 5.5 Hz vibrato and a fresh random jitter
    every period (and shimmer: each period's loudness), plus its F0 sample by sample. `alt` scales alternate periods
    (a diplophonic voice: periodic at twice the period); `odd` scales the odd harmonics (near 0: an octave up)."""
    f_inst, gain, t, k = np.zeros(n), np.ones(n), 0.0, 0
    while t < n / SR:
        f = f0 * (1 + vib * np.sin(2 * np.pi * 5.5 * t)) * (1 + jitter * rng.standard_normal())
        a, b = int(t * SR), min(n, int((t + 1 / f) * SR))
        f_inst[a:b] = f
        gain[a:b] = (1 + shimmer * rng.standard_normal()) * (alt[k % 2] if alt else 1.0)
        t, k = t + 1 / f, k + 1
    phase = 2 * np.pi * np.cumsum(f_inst) / SR
    y = np.zeros(n)
    for h, amp in enumerate(amps or [h ** -1.2 for h in range(1, 40)], 1):
        if h * f0 * 1.1 > 7000:
            break
        y += amp * (odd if h % 2 else 1.0) * np.sin(h * phase + rng.uniform(0, 2 * np.pi))
    return y * gain, f_inst


def speech(f0: float, seed: int, total=4.0, whisper=False, snr_db=28.0, octave_words=0, **kw):
    """About 4 s of "words" (0.18-0.45 s, each at its own pitch within 4% of f0, half of them with a fricative)
    between pauses of 30 ms to 0.5 s, in noise snr_db under the voice. Returns the audio and the median of its true
    F0 over the voiced samples (None for a whisper: formant-shaped noise, nothing voiced)."""
    rng = np.random.default_rng(seed)
    y, truth, t, i = np.zeros(int(total * SR)), np.full(int(total * SR), np.nan), 0.3, 0
    while t < total - 0.6:
        w = rng.uniform(0.18, 0.45)
        a, b = int(t * SR), int((t + w) * SR)
        if whisper:
            spec = np.fft.rfft(rng.standard_normal(b - a))
            fr = np.fft.rfftfreq(b - a, 1 / SR)
            spec *= sum(np.exp(-((fr - c) / bw) ** 2) for c, bw in ((600, 200), (1400, 300), (2600, 400)))
            seg = np.fft.irfft(spec, b - a)
        else:
            seg, fi = voice(f0 * rng.uniform(0.96, 1.04), b - a, rng, odd=0.05 if i < octave_words else 1.0, **kw)
            truth[a:b] = fi
            if rng.random() < 0.5:  # a fricative inside the word: noise, no pitch
                c = int(rng.uniform(0.04, 0.09) * SR)
                s = int(rng.integers(0, max(1, len(seg) - c)))
                seg[s:s + c] = np.diff(rng.standard_normal(c), prepend=0) * 0.3 * np.abs(seg).max()
                truth[a + s:a + s + c] = np.nan
        edge = np.minimum(1, np.minimum(np.arange(b - a), np.arange(b - a)[::-1]) / (0.02 * SR))
        y[a:b] = seg / np.abs(seg).max() * edge * 0.3
        t += w + (rng.uniform(0.3, 0.5) if rng.random() < 0.25 else rng.uniform(0.03, 0.15))
        i += 1
    voiced = np.isfinite(truth)
    rms = np.sqrt(np.mean(y[voiced] ** 2)) if voiced.any() else np.sqrt(np.mean(y ** 2))
    y += rng.standard_normal(len(y)) * rms * 10 ** (-snr_db / 20)
    return y, (float(np.nanmedian(truth)) if voiced.any() else None)


def st(f: float, ref: float) -> float:
    return 12 * np.log2(f / ref)


def naive_nccf(y: np.ndarray) -> float:
    """A plain normalized-autocorrelation pitch picker: the strongest correlation in 60-400 Hz, no first-dip rule."""
    W, tmin, tmax, est = 400, int(SR / 400), int(np.ceil(SR / 60)), []
    for s in range(0, len(y) - W - tmax, 160):
        x = y[s:s + W + tmax]
        a = x[:W]
        if (a ** 2).mean() < 1e-4:
            continue
        r = [np.dot(a, x[t:t + W]) / np.sqrt(np.dot(a, a) * np.dot(x[t:t + W], x[t:t + W]) + 1e-12)
             for t in range(tmin, tmax + 1)]
        est.append(SR / (tmin + int(np.argmax(r))))
    return float(np.median(est))


def naive_peak(y: np.ndarray) -> float:
    """A plain spectral pitch picker: the strongest peak of each frame's spectrum in 60-400 Hz."""
    W, est = 1024, []
    win, f = np.hanning(W), np.fft.rfftfreq(8192, 1 / SR)
    band = (f >= 60) & (f <= 400)
    for s in range(0, len(y) - W, 160):
        x = y[s:s + W]
        if (x ** 2).mean() < 1e-4:
            continue
        est.append(f[band][int(np.argmax(np.abs(np.fft.rfft(x * win, 8192))[band]))])
    return float(np.median(est))


# ---------------------------------------------------------------------------------------------
# the estimator


class PitchEstimatorTest(unittest.TestCase):
    def test_voiced_speech_at_110_135_220_hz(self):
        for f0 in (110, 135, 220):
            for seed in range(3):
                with self.subTest(f0=f0, seed=seed):
                    y, truth = speech(f0, seed)
                    p = eleven.pitch(y, SR)
                    self.assertIsNotNone(p.f0, p.why)
                    self.assertLess(abs(st(p.f0, truth)), 0.25)  # within a quarter of a semitone of the true median
                    self.assertGreater(p.voiced, 0.5)  # (the fricatives and the word edges are not voiced)
                    self.assertLessEqual(p.voiced, 1.0)

    def test_more_jitter_and_vibrato_and_noise(self):
        for kw in ({"jitter": 0.02, "vib": 0.05}, {"snr_db": 15.0}):
            with self.subTest(**kw):
                y, truth = speech(135, 1, **kw)
                p = eleven.pitch(y, SR)
                self.assertIsNotNone(p.f0, p.why)
                self.assertLess(abs(st(p.f0, truth)), 0.25)

    def test_whisper_gets_no_verdict(self):
        for seed in range(3):
            with self.subTest(seed=seed):
                y, truth = speech(135, seed, whisper=True)
                self.assertIsNone(truth)
                p = eleven.pitch(y, SR)
                self.assertIsNone(p.f0)
                self.assertLess(p.voiced, 0.1)
                self.assertGreater(p.sound_s, 1.0)  # it was heard as sound, just not as voice
                self.assertIn("voiced", p.why)

    def test_short_clip_and_silence_get_no_verdict(self):
        rng = np.random.default_rng(0)
        y, _ = voice(135, int(0.35 * SR), rng)
        y = np.concatenate([np.zeros(3000), y / np.abs(y).max() * 0.3, np.zeros(3000)])
        y += rng.standard_normal(len(y)) * 1e-4
        p = eleven.pitch(y, SR)
        self.assertIsNone(p.f0)
        self.assertIn("of sound", p.why)
        self.assertIsNone(eleven.pitch(np.zeros(SR * 2), SR).f0)  # digital silence: no period, no crash
        self.assertIsNone(eleven.pitch(np.zeros(100), SR).f0)  # shorter than one frame

    def test_continuous_voice_without_pauses(self):
        y, f = voice(150, 2 * SR, np.random.default_rng(3))
        p = eleven.pitch(0.3 * y / np.abs(y).max(), SR)
        self.assertIsNotNone(p.f0, p.why)
        self.assertLess(abs(st(p.f0, float(np.median(f)))), 0.25)

    def test_octave_low_trap_alternating_periods(self):
        # every other period 40% weaker: the signal repeats exactly only every two periods, so the strongest
        # correlation is at twice the period (67 Hz), but the pitch heard is 135 Hz
        y, truth = speech(135, 0, alt=(1.0, 0.6))
        self.assertLess(naive_nccf(y), truth / 1.5)  # the trap is real: a plain picker lands near an octave low
        p = eleven.pitch(y, SR)
        self.assertLess(abs(st(p.f0, truth)), 0.25)
        self.assertLess(float(np.mean(p.hz < truth / 1.5)), 0.02)

    def test_octave_high_trap_weak_fundamental(self):
        # the first harmonic 20 dB under the second (a first formant sitting on the second harmonic): the strongest
        # harmonic is an octave up, but the period, and the pitch heard, is still 110 Hz
        y, truth = speech(110, 2, amps=[0.08, 1.0, 0.8, 0.5, 0.4, 0.3, 0.2, 0.15, 0.1, 0.08])
        self.assertGreater(naive_peak(y), truth * 1.5)  # the trap is real: a spectral-peak picker lands an octave up
        self.assertLess(abs(st(naive_peak(speech(110, 2)[0]), 110)), 0.5)  # (it reads a plain voice right)
        p = eleven.pitch(y, SR)
        self.assertLess(abs(st(p.f0, truth)), 0.25)
        self.assertLess(float(np.mean(p.hz > truth * 1.5)), 0.02)

    def test_octave_guard_folds_back_octave_jumps(self):
        # two words whose odd harmonics nearly vanish: frame by frame they read an octave up (270 Hz)
        y, truth = speech(135, 0, octave_words=2)
        with patch.object(eleven, "OCTAVE_ST", 99.0):  # the guard off: the jumps are there
            self.assertGreater(float(np.mean(eleven.pitch(y, SR).hz > truth * 1.5)), 0.15)
        p = eleven.pitch(y, SR)
        self.assertLess(float(np.mean(p.hz > truth * 1.5)), 0.02)
        self.assertLess(abs(st(p.f0, truth)), 0.25)

    def test_semitones_print_zero_without_a_sign(self):
        for d, text in ((-0.04, "0.0 st"), (0.04, "0.0 st"), (-0.06, "-0.1 st"), (2.26, "+2.3 st")):
            with self.subTest(d=d):
                self.assertEqual(eleven.st_text(d), text)
        self.assertEqual(math.copysign(1, eleven.st_round(-0.04)), 1)  # 0.0 in the JSON too, never -0.0


# ---------------------------------------------------------------------------------------------
# the comparison with the kept blocks around a take


VOICE, MODEL = "lLMLgpFODM2KlxUSCdcI", "eleven_multilingual_v2"
SETTINGS = {"similarity_boost": 0.8, "speed": 1.0, "stability": 0.45, "style": 0.1, "use_speaker_boost": True}


@unittest.skipUnless(HAS_FFMPEG, "needs ffmpeg")
class AroundTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(prefix="audara-pitch-test-", ignore_cleanup_errors=True)
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)

    def clip(self, name: str, f0: float, seed: int, settings: dict | None = None, **kw) -> Path:
        y, _ = speech(f0, seed, **kw)
        path = self.dir / f"{name}.wav"
        path.write_bytes(eleven.wav_bytes(eleven.to_pcm16(y), SR))
        req = {"method": "POST", "path": f"/v1/text-to-speech/{VOICE}/with-timestamps",
               "query": {"output_format": "mp3_44100_128"},
               "body": {"text": name, "model_id": MODEL, "voice_settings": settings or SETTINGS, "seed": 1}}
        eleven.write_json(eleven.side(path, ".request.json"), {"kind": "tts", "request": req})
        return path

    def test_neighbours_and_marks(self):
        files = {1: self.clip("b1", 135, 1), 2: self.clip("b2", 180, 2, settings={**SETTINGS, "stability": 0.3}),
                 4: self.clip("b4", 133, 4), 5: self.clip("b5", 137, 5), 6: self.clip("b6", 200, 6)}
        # the same narration: same voice, model and settings, whatever the text (block 2 was made with others)
        kept = [(n, p) for n, p in files.items() if eleven.same_narration(p, VOICE, MODEL, SETTINGS)]
        self.assertEqual([n for n, _ in kept], [1, 4, 5, 6])
        self.assertFalse(eleven.same_narration(files[1], VOICE, "eleven_v3", SETTINGS))
        self.assertFalse(eleven.same_narration(files[1], "another-voice", MODEL, SETTINGS))
        ar = eleven.pitch_around(3, kept)
        self.assertEqual([n for n, *_ in ar.files], [1, 4, 5])  # block 6 is 3 blocks away
        self.assertLess(abs(st(ar.hz, 135)), 0.4)
        self.assertRegex(eleven.around_text(ar), r"^blocks 1 \(\d+ Hz\), 4 \(\d+ Hz\) and 5 \(\d+ Hz\)$")
        for f0, mark in ((142, False), (128, False), (160, True), (218, True)):  # +0.9, -0.9, +2.9, +8.3 st
            with self.subTest(f0=f0):
                pp = eleven.pitch_of(self.clip(f"take{f0}", f0, 7))
                d, check = eleven.pitch_vs(pp, ar)
                self.assertLess(abs(d - st(f0, 135)), 0.5)  # (each word sits within 4% of f0: up to 0.7 st)
                self.assertEqual(check, mark)
        loose = eleven.Around(ar.hz, ar.files, tol=4.0)  # the tolerance is the director's to set
        self.assertFalse(eleven.pitch_vs(eleven.pitch_of(self.clip("take160b", 160, 7)), loose)[1])
        self.assertTrue(eleven.pitch_vs(eleven.pitch_of(self.clip("take218b", 218, 7)), loose)[1])
        whisper = eleven.pitch_of(self.clip("whisper", 135, 8, whisper=True))
        self.assertEqual(eleven.pitch_vs(whisper, ar), (None, False))  # no verdict, so no mark

    def test_nothing_around(self):
        ar = eleven.pitch_around(1, [(1, self.clip("b1", 135, 1))])
        self.assertIsNone(ar.hz)
        pp = eleven.pitch_of(self.clip("t", 218, 2))
        self.assertEqual(eleven.pitch_vs(pp, ar), (None, False))


# ---------------------------------------------------------------------------------------------
# tts --takes end to end, against the mock ElevenLabs server


# neutral lines, written for this test
SCRIPT = ["The kettle had been warm for an hour before anyone noticed.",
          "Rain moved slowly across the valley that afternoon.",
          "A small boat waited at the end of the wooden pier.",
          "By evening the market square was quiet again."]
INSERTED = "Somewhere a bell rang twice and then stopped."
SLUG2, SLUG3 = "rain-moved-slowly-across", "a-small-boat-waited"


@unittest.skipUnless(HAS_FFMPEG, "needs ffmpeg")
class TakesEndToEndTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        tmp = tempfile.TemporaryDirectory(prefix="audara-takes-test-", ignore_cleanup_errors=True)
        cls.addClassCleanup(tmp.cleanup)
        cls.tmp = Path(tmp.name)
        mock = load("audara_mock_elevenlabs", REPO / "evals/mocks/elevenlabs.py")
        mock.WORK, mock.LOG = cls.tmp / "mock", cls.tmp / "mock" / "log.jsonl"  # (not evals/results/)
        mock.LOG.parent.mkdir(parents=True)
        cls.log = mock.LOG
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), mock.H)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.addClassCleanup(cls.server.server_close)
        cls.addClassCleanup(cls.server.shutdown)
        env = {"MOCK_KEY": "eval-fake-key-0f3a9c", "ELEVENLABS_API_KEY": "eval-fake-key-0f3a9c",
               "ELEVENLABS_BASE_URL": f"http://127.0.0.1:{cls.server.server_address[1]}"}
        env_patch = patch.dict(os.environ, env)
        env_patch.start()
        cls.addClassCleanup(env_patch.stop)

    def setUp(self):  # a project of its own per test; the mock's log is shared, so paid() counts from here
        self.out = self.tmp / self._testMethodName
        self.ndir = self.out / "audio" / "narration"
        self.script = self.out / "script.txt"
        self.out.mkdir()
        self.write_script(SCRIPT)
        self.mark = len(self.all_paid())

    def write_script(self, paras: list[str]) -> None:
        self.script.write_text("\n\n".join(paras) + "\n", encoding="utf-8")

    def run_tts(self, *args) -> tuple[int, str]:
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(io.StringIO()):
            code = eleven.main(["tts", str(self.script), "--out", str(self.out), *args])
        return code, buf.getvalue()

    def tts(self, *args) -> dict:
        code, text = self.run_tts("--json", *args)
        data = json.loads(text)
        self.assertEqual(code, data["exit"], data.get("error"))
        return data

    def text(self, *args) -> str:
        """The report as a person reads it (no --json)."""
        code, text = self.run_tts(*args)
        self.assertIn(code, (0, 4), text)
        return text

    def all_paid(self) -> list[dict]:
        return [json.loads(x) for x in self.log.read_text(encoding="utf-8").splitlines()
                if '"/v1/text-to-speech/' in x and '"status": 200' in x] if self.log.is_file() else []

    def paid(self) -> list[int]:
        """The seeds of the text-to-speech requests this test has paid for, in order."""
        return [r["seed"] for r in self.all_paid()[self.mark:]]

    @staticmethod
    def sha(p: Path) -> str:
        return hashlib.sha256(p.read_bytes()).hexdigest()

    def take(self, n: int, slug: str, k: int) -> Path:
        return self.ndir / "takes" / f"{n:02d}-{slug}.take{k}.mp3"

    def test_takes_report_and_pick(self):
        made = self.tts("--voice", VOICE, "--yes")
        self.assertTrue(made["ok"], made.get("error"))
        self.assertEqual(self.paid(), [1, 1, 1, 1])
        main2 = self.ndir / f"02-{SLUG2}.mp3"
        first = self.sha(main2)

        # takes of a block that has its file: take k is seed k, so take 1 is that file, copied for free
        plan = self.tts("--takes", "4", "--block", "2")
        self.assertEqual(plan["exit"], 4)
        self.assertEqual([j["seed"] for j in plan["jobs"]], [2, 3, 4])
        self.assertIn(f"block 2 take 1: same request as {eleven.rel(main2)} (copied, free)",
                      self.text("--takes", "4", "--block", "2"))
        rep = self.tts("--takes", "4", "--block", "2", "--yes")
        self.assertTrue(rep["ok"], rep.get("error"))
        self.assertEqual(self.paid(), [1, 1, 1, 1, 2, 3, 4])
        self.assertEqual(self.sha(self.take(2, SLUG2, 1)), first)
        rows = {r["take"]: r for r in rep["takes"]}
        self.assertEqual([k for k in (1, 2, 3, 4) if rows[k]["block_file"]], [1])
        self.assertNotIn("block_file", rep)  # (a row of its own only when no take holds the file)
        # per take its median pitch, voiced share, distance from the blocks around it and the mark
        # (the mock's voice is 118 + 9 x (seed mod 5) Hz: the blocks at seed 1 sit at 127 Hz)
        for k, f0 in ((1, 127), (2, 136), (3, 145), (4, 154)):
            self.assertLess(abs(rows[k]["f0_hz"] - f0), 2)
            self.assertGreater(rows[k]["voiced_share"], 0.8)
            self.assertAlmostEqual(rows[k]["pitch_st"], st(f0, 127), delta=0.2)
        self.assertEqual(math.copysign(1, rows[1]["pitch_st"]), 1)  # the block's file against its own voice: 0.0
        self.assertEqual([k for k in (1, 2, 3, 4) if rows[k]["check_by_ear"]], [3, 4])  # +2.3, +3.3 st; +1.2 is not
        self.assertEqual(rep["pitch"]["check_by_ear"], [3, 4])
        self.assertEqual([x["block"] for x in rep["pitch"]["around"]], [1, 3, 4])
        self.assertAlmostEqual(rep["pitch"]["around_hz"], 127, delta=2)
        self.assertEqual(rep["pitch"]["tolerance_st"], 2.0)
        for words in ("not voice identity, accent or naturalness", "nobody has listened"):
            self.assertIn(words, rep["pitch"]["note"])

        # the same request again: nothing is bought, nothing is written; the report labels take 1
        again = self.tts("--takes", "4", "--block", "2", "--yes")
        self.assertEqual(self.paid(), [1, 1, 1, 1, 2, 3, 4])
        self.assertEqual(again["wrote"], [])
        self.assertEqual([r["seed"] for r in again["takes"]], [1, 2, 3, 4])
        report = self.text("--takes", "4", "--block", "2")
        line1 = next(x for x in report.splitlines() if x.lstrip().startswith("1 "))
        self.assertIn(f"02-{SLUG2}.take1.mp3 (the block's file)", line1)
        self.assertIn("0.0 st", line1)
        self.assertNotIn("-0.0", report)
        self.assertIn("Take 1 is the block's file", report)
        self.assertIn("--takes 5 --block 2", report)  # one more take, these kept

        # a wider tolerance marks fewer; --no-pitch leaves the diagnostic out, not the label
        wide = self.tts("--takes", "4", "--block", "2", "--pitch-tolerance", "3")
        self.assertEqual(wide["pitch"]["check_by_ear"], [4])
        off = self.tts("--takes", "4", "--block", "2", "--no-pitch")
        self.assertNotIn("pitch", off)
        self.assertNotIn("f0_hz", off["takes"][0])
        self.assertTrue(off["takes"][0]["block_file"])
        plain = self.text("--takes", "4", "--block", "2", "--no-pitch")
        self.assertIn("(the block's file)", plain)
        self.assertNotIn("vs around", plain)

        # pick take 2: the file heard first stays as take 1 (nothing goes to older/), and the pick says its pitch
        pick = self.tts("--pick", "2", "--block", "2")
        self.assertTrue(pick["ok"], pick.get("error"))
        self.assertEqual(self.sha(main2), self.sha(self.take(2, SLUG2, 2)))
        self.assertEqual(pick["pitch"]["picked"], 2)
        self.assertAlmostEqual(pick["pitch"]["pitch_st"], st(136, 127), delta=0.2)
        self.assertFalse(pick["pitch"]["check_by_ear"])
        self.assertEqual(list((self.ndir / "older").glob("02-*.mp3")), [])
        after = self.tts("--takes", "4", "--block", "2")
        self.assertEqual([r["take"] for r in after["takes"] if r["block_file"]], [2])
        # ...and --pick 1 brings it back
        self.assertTrue(self.tts("--pick", "1", "--block", "2")["ok"])
        self.assertEqual(self.sha(main2), first)

        # takes none of which is the block's file (a --seed it hasn't had): the file gets a row of its own
        other = self.tts("--takes", "2", "--block", "3", "--seed", "5", "--yes")
        self.assertTrue(other["ok"], other.get("error"))
        self.assertEqual(self.paid()[7:], [5, 6])
        self.assertFalse(any(r["block_file"] for r in other["takes"]))
        self.assertEqual((other["block_file"]["take"], other["block_file"]["seed"]), (None, 1))
        self.assertAlmostEqual(other["block_file"]["pitch_st"], 0.0, delta=0.2)
        self.assertTrue(other["block_file"]["block_file"])
        bare = self.text("--takes", "2", "--block", "3", "--seed", "5", "--no-pitch")
        self.assertTrue(any(x.lstrip().startswith("file ") and f"03-{SLUG3}.mp3" in x for x in bare.splitlines()))
        self.assertEqual(self.paid()[7:], [5, 6])

    def test_renumbered_paragraph_reuses_its_takes(self):
        self.assertTrue(self.tts("--voice", VOICE, "--yes")["ok"])
        self.assertTrue(self.tts("--takes", "3", "--block", "2", "--yes")["ok"])
        self.assertEqual(self.paid(), [1, 1, 1, 1, 2, 3])
        heard = [self.sha(self.take(2, SLUG2, k)) for k in (1, 2, 3)]

        # a paragraph inserted before block 2: only it is bought; the others are copied under their new numbers
        self.write_script([SCRIPT[0], INSERTED, *SCRIPT[1:]])
        self.assertTrue(self.tts("--yes")["ok"])
        self.assertEqual(self.paid(), [1, 1, 1, 1, 2, 3, 1])

        # its takes under the new number: the same requests, so copied for free, and take 2 can be picked
        rep = self.tts("--takes", "3", "--block", "3", "--yes")
        self.assertTrue(rep["ok"], rep.get("error"))
        self.assertNotIn("jobs", rep)
        self.assertEqual(self.paid(), [1, 1, 1, 1, 2, 3, 1])
        self.assertEqual([self.sha(self.take(3, SLUG2, k)) for k in (1, 2, 3)], heard)
        self.assertEqual([r["take"] for r in rep["takes"] if r["block_file"]], [1])
        pick = self.tts("--pick", "2", "--block", "3")
        self.assertTrue(pick["ok"], pick.get("error"))
        self.assertEqual(self.sha(self.ndir / f"03-{SLUG2}.mp3"), heard[1])


if __name__ == "__main__":
    unittest.main(verbosity=2)
