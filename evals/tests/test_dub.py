# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=2.0,<3", "scipy>=1.13,<2", "soundfile>=0.12,<1"]
# ///
"""dub.py, offline: uv run evals/tests/test_dub.py.

A small audara project (music, two effects on a word 0.1 s apart, a three-paragraph English narration made by
eleven.py against evals/mocks/elevenlabs.py, served in-process, and its mix), dubbed. What it holds dub.py to: the
free steps spend nothing; nothing is paid for without an approved job, past its cap or past a language's share; the
rest of a language waits for its voice test to pass, and two failed tests stop it; a request billed without an
answer stays reserved, stops its language (only it) and is never sent again; a run that stopped mid-request is
settled the same way; a request billed then a later one refused keeps the first billed; a voice billed more per
character than reserved stops the job at the cap; a higher cap lifts a stop on a language's share but not one on a
possible charge; paid audio is never bought twice; sentences land on their original sentences and an anchored word
on its original word; a sentence too long for its place, or one running past the video's end, stays open and its
track is not "ready"; a track made before its inputs changed fails verify; the dub's music and effects (grouped
ones included) are the video's mix's, and the video's own mix.wav is untouched; mix.py refuses a mix with another
voice and nowhere else to go. Needs ffmpeg and uv; no network, no paid call. Two or three minutes."""
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

import numpy as np
import soundfile as sf

REPO = Path(__file__).resolve().parents[2]
SK = REPO / "skills" / "soundtrack" / "scripts"
sys.dont_write_bytecode = True
KEY = "eval-fake-key-0f3a9c"
VOICE = "lLMLgpFODM2KlxUSCdcI"  # the mock's "Graham", a professional voice in its account


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


dub = load("audara_dub", SK / "dub.py")

SCRIPT = ["Our journey begins here, a hundred kilometers above the surface. This is the edge of space.",
          "The colors come from real satellite photos. The clouds are real too.",
          "Put it all together, and this is our planet."]
ES = ["Nuestro viaje empieza aquí, a cien kilómetros sobre la superficie. Este es el borde del espacio.",
      "Los colores vienen de fotos satelitales reales. Las nubes también son reales.",
      "Júntalo todo, y este es nuestro planeta."]
DE = ["Unsere Reise beginnt hier, hundert Kilometer über der Oberfläche. Das ist der Rand des Weltraums.",
      "Die Farben stammen von echten Satellitenfotos. TRIGGER_DROP Auch die Wolken sind echt.",
      "Alles zusammen, und das ist unser Planet."]
# a first paragraph far too long for the second sentence's place
FR = ["Notre voyage commence ici, à cent kilomètres au-dessus de la surface. " + "C'est le bord de l'espace, la "
      "limite que l'on utilise d'habitude pour dire où commence l'espace, très loin au-dessus des nuages, des "
      "montagnes, des océans et des villes, là où le ciel devient noir et où les étoiles brillent en plein jour.",
      "Les couleurs viennent de vraies photos satellites. Les nuages aussi sont réels.",
      "On assemble tout, et voici notre planète."]
IT = ["Il nostro viaggio comincia qui, a cento chilometri sopra la superficie. Questo è il bordo dello spazio.",
      "I colori vengono da vere foto satellitari. Anche le nuvole sono vere.",
      "Mettiamo tutto insieme, ed ecco il nostro pianeta."]
PT = ["Nossa viagem começa aqui, a cem quilômetros acima da superfície. Esta é a borda do espaço.",
      "As cores vêm de fotos de satélite de verdade. As nuvens também são reais.",
      "Junte tudo, e este é o nosso planeta."]
# a last paragraph that can't end before the end of a video cut close after the narration
TIGHT = ES[:2] + ["Júntalo todo, y este es nuestro planeta, el único que conocemos, con sus océanos, sus nubes, sus "
                  "montañas y sus ciudades encendidas en la noche."]


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("uv"), "needs ffmpeg and uv")
class DubTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        tmp = tempfile.TemporaryDirectory(prefix="audara-dub-test-", ignore_cleanup_errors=True)
        cls.addClassCleanup(tmp.cleanup)
        cls.tmp = Path(tmp.name)
        cls.mock = mock = load("audara_mock_elevenlabs_dub", REPO / "evals/mocks/elevenlabs.py")
        mock.WORK, mock.LOG = cls.tmp / "mock", cls.tmp / "mock" / "log.jsonl"
        mock.LOG.parent.mkdir(parents=True)
        os.environ["MOCK_KEY"] = KEY
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), mock.H)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.addClassCleanup(cls.server.server_close)
        cls.addClassCleanup(cls.server.shutdown)
        cls.env = {**os.environ, "ELEVENLABS_API_KEY": KEY, "PYTHONIOENCODING": "utf-8",
                   "ELEVENLABS_BASE_URL": f"http://127.0.0.1:{cls.server.server_address[1]}"}
        cls.root = root = cls.tmp / "proj"
        v = cls.v = root / "videos" / "demo"
        (v / "audio").mkdir(parents=True)
        (v / "data").mkdir()
        sr, dur = 48000, 30.0
        t = np.arange(int(dur * sr)) / sr
        music = 0.12 * (np.sin(2 * np.pi * 220 * t) + 0.5 * np.sin(2 * np.pi * 330 * t))
        music *= 0.6 + 0.4 * np.sin(2 * np.pi * 0.25 * t) ** 2
        sf.write(v / "audio" / "music.wav", np.stack([music, music], 1).astype(np.float32), sr, subtype="PCM_16")
        k = np.arange(int(0.25 * sr)) / sr
        sf.write(v / "audio" / "click.wav", (0.6 * np.exp(-k * 25) * np.sin(2 * np.pi * 1800 * k)).astype(np.float32), sr)
        (v / "video.json").write_text(json.dumps({"fps": 30, "duration": dur, "audio": None}), encoding="utf-8")
        (v / "script.txt").write_text("\n\n".join(SCRIPT) + "\n", encoding="utf-8")
        cls.uv(SK / "eleven.py", "tts", "videos/demo/script.txt", "--video", "demo", "--voice", VOICE, "--yes")
        (v / "mix.json").write_text(json.dumps({
            "kind": "calm", "voice": "audio/narration.wav",
            "music": {"file": "audio/music.wav", "under_voice": 14, "fade_out": 2},
            "effects": [{"file": "audio/click.wav", "word": "clouds"},
                        {"file": "audio/click.wav", "word": "clouds", "offset": 0.1}]}), encoding="utf-8")
        cls.uv(SK / "mix.py", "build", "--video", "demo")
        cls.orig_mix = dub.sha256(v / "audio" / "mix.wav")
        for code, paras in (("es", ES), ("de", DE), ("fr", FR), ("it", IT), ("pt", PT)):
            (v / "youtube" / code).mkdir(parents=True)
            (v / "youtube" / code / "narration.txt").write_text("\n\n".join(paras) + "\n", encoding="utf-8")

    @classmethod
    def uv(cls, script: Path, *args, ok=(0,)) -> subprocess.CompletedProcess:
        r = subprocess.run(["uv", "run", "--quiet", str(script), *args], cwd=cls.root, env=cls.env, capture_output=True,
                           text=True, encoding="utf-8", errors="replace")
        if ok is not None and r.returncode not in ok:
            raise AssertionError(f"{script.name} {' '.join(args)} exited {r.returncode}:\n{r.stdout}\n{r.stderr}")
        return r

    def dub(self, *args, ok=(0,)) -> tuple[int, dict, str]:
        r = self.uv(SK / "dub.py", *args, "--json", ok=None)
        try:
            j = json.loads(r.stdout.strip().splitlines()[-1])
        except (ValueError, IndexError):
            j = {}
        if ok is not None:
            self.assertIn(r.returncode, ok, f"dub.py {' '.join(args)}: {r.stdout}\n{r.stderr}")
        return r.returncode, j, r.stderr

    def paid(self) -> int:
        """Text-to-speech and transcription requests the mock took as billed."""
        if not self.mock.LOG.is_file():
            return 0
        n = 0
        for line in self.mock.LOG.read_text(encoding="utf-8").splitlines():
            x = json.loads(line)
            if x.get("paid") and x.get("status") == 200:
                n += 1
        return n

    def job(self) -> dict:
        return json.loads((self.v / "dub" / "job.json").read_text(encoding="utf-8"))

    def pilot(self, code: str, block: int, heard: str) -> dict:
        """The voice test, block `block` made and heard (the mock's transcriber hears what it is given here)."""
        self.dub("speak", "--video", "demo", "--lang", code, "--test", str(block))
        self.mock.STATE["tts_texts"][:] = [heard]
        return self.dub("hear", "--video", "demo", "--lang", code, "--test", str(block), ok=(0, 5))[1]

    # ------------------------------------------------------------------------------------------- units

    def test_01_sentences_and_models(self):
        w = lambda s: [{"w": x} for x in s.split()]
        self.assertEqual(len(dub.sentences(w("Am 8. April war es so. Dann kam Dr. Who."))), 2)
        self.assertEqual(len(dub.sentences(w("これは月です。 あれは地球です。"))), 2)
        self.assertEqual(len(dub.sentences(w("هذا هو القمر؟ نعم."))), 2)
        self.assertEqual(len(dub.sentences(w("यह चाँद है। वह धरती है।"))), 2)
        self.assertEqual(len(dub.sentences(w("Ich bin nur ein... Programmierer..."))), 2)
        words = w("the clouds and the clouds again")
        self.assertEqual(dub.find_seq(words, "clouds", 2), 4)
        self.assertEqual(dub.find_seq(words, "the clouds", 1), 0)
        self.assertIsNone(dub.find_seq(words, "rain", 1))
        self.assertEqual(dub.model_for("bn", "eleven_multilingual_v2"), "eleven_v4")
        self.assertEqual(dub.model_for("vi", "eleven_multilingual_v2"), "eleven_v4")
        self.assertEqual(dub.model_for("es-419", "eleven_multilingual_v2"), "eleven_multilingual_v2")
        self.assertEqual(dub.model_for("bn", "eleven_v3"), "eleven_v3")
        # what failed without its audio counts as spent unless the server answered no, or nothing was sent
        self.assertTrue(dub.surely_not_billed(1, {"error": "text-to-speech for 02 failed: HTTP 402 insufficient_credits"}))
        self.assertTrue(dub.surely_not_billed(1, {"error": "text-to-speech for 02 failed: HTTP 404 voice_not_found"}))
        self.assertTrue(dub.surely_not_billed(4, {"error": "needs --yes"}))
        self.assertFalse(dub.surely_not_billed(1, {"error": "no answer from https://api.elevenlabs.io in time. If the "
                                                            "request reached ElevenLabs it may have been billed"}))
        self.assertFalse(dub.surely_not_billed(1, {"error": "failed: HTTP 502 bad gateway"}))
        self.assertFalse(dub.surely_not_billed(1, {"error": "Traceback (most recent call last): ..."}))
        # a cap holds only where the rate is stated: a voice the account owns, or ElevenLabs' premade
        self.assertTrue(dub.voice_ok({"is_owner": True, "category": "professional"})[0])
        self.assertTrue(dub.voice_ok({"is_owner": False, "category": "premade"})[0])
        self.assertFalse(dub.voice_ok({"is_owner": False, "category": "professional"})[0])
        self.assertFalse(dub.voice_ok(None)[0])
        job = {"cap": 1000, "languages": {"a": {"estimate": 300}, "b": {"estimate": 100}}}
        dub.share_out(job)
        self.assertEqual((job["languages"]["a"]["share"], job["languages"]["b"]["share"]), (750.0, 250.0))

    # ------------------------------------------------------------------------------------------- free steps

    def test_02_free_steps_spend_nothing(self):
        before = self.paid()
        code, j, _ = self.dub("source", "--video", "demo")
        self.assertEqual(j["lines"], 3)
        code, j, _ = self.dub("plan", "--video", "demo", "--langs", "es,de,fr,it,bn", "--from", "en")
        rows = {r["lang"]: r for r in j["rows"]}
        self.assertTrue(rows["es"]["exact"] and not rows["bn"]["exact"])
        self.assertEqual(rows["bn"]["model"], "eleven_v4")
        self.assertGreater(j["cap_suggested"], j["estimate"] - 1)
        self.assertFalse((self.v / "dub" / "job.json").exists(), "a plan without --approve wrote the job")
        code, j, _ = self.dub("speak", "--video", "demo", "--lang", "es", ok=(4,))
        self.assertIn("no approved job", j["message"])
        self.assertEqual(self.paid(), before, "a free step reached a paid endpoint")

    def test_03_mix_with_another_voice_needs_somewhere_else(self):
        plan = self.v / "mix-other.json"
        plan.write_text(json.dumps({"voice": "audio/narration.wav", "voice_words": "data/words.json",
                                    "music": {"file": "audio/music.wav", "gain_db": -6}}), encoding="utf-8")
        r = self.uv(SK / "mix.py", "build", "--video", "demo", "--plan", "mix-other.json", ok=(2,))
        self.assertIn("--to", r.stderr + r.stdout)
        r = self.uv(SK / "mix.py", "build", "--video", "demo", "--plan", "mix-other.json", "--to", "videos/demo/audio",
                    ok=(2,))
        self.assertIn("own audio folder", r.stderr + r.stdout)
        plan.unlink()
        self.assertEqual(dub.sha256(self.v / "audio" / "mix.wav"), self.orig_mix)

    # ------------------------------------------------------------------------------------------- the job

    def test_04_cap_refuses_before_sending(self):
        before = self.paid()
        self.dub("plan", "--video", "demo", "--langs", "es,de,fr,it,pt", "--from", "en", "--approve", "yes, up to 50",
                 "--cap", "50")
        code, j, _ = self.dub("speak", "--video", "demo", "--lang", "es", "--test", "1", ok=(5,))
        self.assertIn("approved", j["message"])
        self.assertEqual(self.paid(), before)
        self.assertEqual(self.job()["ledger"], [])
        # the director's second yes, a higher cap: the job's scope and history follow
        self.dub("plan", "--video", "demo", "--langs", "es,de,fr,it,pt", "--from", "en", "--approve",
                 "yes, all five, up to 6000 credits", "--cap", "6000")
        job = self.job()
        self.assertEqual((job["cap"], len(job["history"])), (6000, 2))
        self.assertEqual(job["voice"]["id"], VOICE)
        self.assertTrue(job["voice"]["rate_known"])  # (the mock's Graham is the account's own)

    def test_05_spanish_end_to_end(self):
        before = self.paid()
        self.dub("speak", "--video", "demo", "--lang", "es", "--test", "2")
        self.assertEqual(self.paid(), before + 1)
        led = [e for e in self.job()["ledger"] if e["lang"] == "es"]
        self.assertEqual([(e["status"], e["what"]) for e in led], [("done", "es block 2")])
        self.assertEqual(led[0]["billed"], len(ES[1]))  # the mock's character-cost header
        code, j, _ = self.dub("speak", "--video", "demo", "--lang", "es", ok=(5,))  # the rest waits for the test
        self.assertIn("voice test", j["message"])
        self.assertEqual(self.paid(), before + 1)
        self.mock.STATE["tts_texts"][:] = [ES[1]]
        code, pil, _ = self.dub("hear", "--video", "demo", "--lang", "es", "--test", "2")
        self.assertTrue(pil["pass"] and pil["same_language"], pil)
        self.assertEqual(self.paid(), before + 2)
        self.dub("speak", "--video", "demo", "--lang", "es")
        self.assertEqual(self.paid(), before + 4)
        self.dub("speak", "--video", "demo", "--lang", "es")  # made again: nothing bought twice
        self.assertEqual(self.paid(), before + 4)
        (self.v / "dub" / "es" / "anchors.tsv").write_text("2\tclouds\tnubes\n", encoding="utf-8")
        code, rec, _ = self.dub("place", "--video", "demo", "--lang", "es")
        self.assertEqual(rec["issues"], [])
        a = rec["anchors"][0]
        self.assertLessEqual(abs(a["off"]), dub.ANCHOR_TOL)
        orig = json.loads((self.v / "data" / "words.json").read_text(encoding="utf-8"))["lines"]
        for p in rec["pieces"]:
            if p["why"] == "sentence":
                self.assertTrue(-dub.LEAD_MAX - 1e-6 <= p["start"] - p["target"] <= dub.SLIP_MAX + 1e-6, p)
        self.assertAlmostEqual(sf.info(str(self.v / "dub" / "es" / "audio" / "voice.wav")).duration, 30.0, places=2)
        placed = json.loads((self.v / "dub" / "es" / "data" / "words-placed.json").read_text(encoding="utf-8"))
        self.assertEqual([l["sourceText"] for l in placed["lines"]], [l["text"] for l in orig])
        self.dub("mix", "--video", "demo", "--lang", "es")
        self.assertTrue((self.v / "youtube" / "es" / "mix.wav").is_file())
        self.assertEqual(dub.sha256(self.v / "audio" / "mix.wav"), self.orig_mix, "the video's own mix changed")
        drec = json.loads((self.v / "youtube" / "es" / "mix.wav.request.json").read_text(encoding="utf-8"))
        orec = json.loads((self.v / "audio" / "mix.wav.request.json").read_text(encoding="utf-8"))
        self.assertEqual([(e["file"], e["placed_at"], e["gain_db"]) for e in drec["resolved"]["effects"]],
                         [(e["file"], e["placed_at"], e["gain_db"]) for e in orec["resolved"]["effects"]])
        self.assertEqual(drec["resolved"]["music"]["gain_db"], orec["resolved"]["music"]["gain_db"])
        self.mock.STATE["tts_texts"][:] = ES  # (the mock's transcriber hears what it is given)
        before = self.paid()
        code, h, _ = self.dub("hear", "--video", "demo", "--lang", "es")
        self.assertGreater(h["similarity"], 0.85)
        self.assertEqual(self.paid(), before + 1)
        self.dub("hear", "--video", "demo", "--lang", "es")  # the same voice: its transcript is kept, free
        self.assertEqual(self.paid(), before + 1)
        code, v, _ = self.dub("verify", "--video", "demo", "--langs", "es")
        row = v["rows"][0]
        self.assertEqual(row["status"], "ready", row)
        self.assertEqual(row["fails"], [])
        # an anchor added after the mix: the track no longer comes from what is there, and verify says so
        anchors = self.v / "dub" / "es" / "anchors.tsv"
        anchors.write_text("2\tclouds\tnubes\n3\tplanet\tnubes\n", encoding="utf-8")
        code, v, _ = self.dub("verify", "--video", "demo", "--langs", "es", ok=(1,))
        self.assertEqual(v["rows"][0]["status"], "failed")
        self.assertTrue(any("anchors" in f for f in v["rows"][0]["fails"]), v["rows"][0])
        anchors.write_text("2\tclouds\tnubes\n", encoding="utf-8")
        code, v, _ = self.dub("verify", "--video", "demo", "--langs", "es")
        self.assertEqual(v["rows"][0]["status"], "ready")
        # a respelling added after the mix: the narration made no longer says what it would now
        (self.v / "dub" / "es" / "say.tsv").write_text("nubes\tnú-bes\n", encoding="utf-8")
        code, v, _ = self.dub("verify", "--video", "demo", "--langs", "es", ok=(1,))
        self.assertTrue(any("say" in f for f in v["rows"][0]["fails"]), v["rows"][0])
        (self.v / "dub" / "es" / "say.tsv").unlink()
        code, v, _ = self.dub("verify", "--video", "demo", "--langs", "es")
        self.assertEqual(v["rows"][0]["status"], "ready")

    def test_06_billed_without_an_answer_stops_only_its_language(self):
        self.assertTrue(self.pilot("de", 1, DE[0])["pass"])
        before = self.paid()
        code, j, _ = self.dub("speak", "--video", "demo", "--lang", "de", ok=(5,))
        self.assertIn("may have been billed", j["message"])
        led = [e for e in self.job()["ledger"] if e["lang"] == "de"]
        self.assertEqual([e["status"] for e in led], ["done", "done", "possibly charged"])  # (test, its check, block 2)
        self.assertTrue(self.job()["languages"]["de"]["stopped"])
        dropped = self.paid() - before
        code, j, _ = self.dub("speak", "--video", "demo", "--lang", "de", ok=(5,))
        self.assertEqual(self.paid() - before, dropped, "a possibly charged request was sent again")
        tot = dub.ledger_totals(self.job(), "de")
        self.assertEqual(tot["possibly"], led[2]["max"])
        code, s, _ = self.dub("status", "--video", "demo")
        st = {r["lang"]: r for r in s["rows"]}
        self.assertIn("STOPPED", " ".join(st["de"]["state"]))
        self.assertNotIn("STOPPED", " ".join(st["es"]["state"]))

    def test_07_a_run_stopped_mid_request_is_settled(self):
        job = self.job()
        job["ledger"].append({"id": 99, "lang": "it", "what": "it block 1", "kind": "tts", "max": 120,
                              "status": "pending", "at": dub.now()})
        (self.v / "dub" / "job.json").write_text(json.dumps(job), encoding="utf-8")
        before = self.paid()
        self.dub("status", "--video", "demo")
        job = self.job()
        self.assertEqual(job["ledger"][-1]["status"], "possibly charged")
        self.assertTrue(job["languages"]["it"]["stopped"])
        self.dub("speak", "--video", "demo", "--lang", "it", ok=(5,))
        self.assertEqual(self.paid(), before)

    def test_08_a_share_spent_stops_its_language_until_a_higher_cap(self):
        job = self.job()
        job["languages"]["fr"]["share"] = 30  # less than a paragraph costs
        (self.v / "dub" / "job.json").write_text(json.dumps(job), encoding="utf-8")
        before = self.paid()
        code, j, _ = self.dub("speak", "--video", "demo", "--lang", "fr", "--test", "1", ok=(5,))
        self.assertIn("share", j["message"])
        self.assertEqual(self.paid(), before)
        self.dub("speak", "--video", "demo", "--lang", "fr", "--test", "1", ok=(5,))  # stopped now
        # the director's yes to a higher cap: the share's stop lifts, a possible charge's doesn't
        self.dub("plan", "--video", "demo", "--from", "en", "--approve", "yes, go on, up to 8000", "--cap", "8000")
        job = self.job()
        self.assertEqual(job["languages"]["fr"]["stopped"], [])
        self.assertTrue(job["languages"]["de"]["stopped"] and job["languages"]["it"]["stopped"])
        self.assertGreater(job["languages"]["fr"]["share"], 30)
        # a yes to fewer languages, then to more again: German's possible charge still stops it
        self.dub("plan", "--video", "demo", "--langs", "es,fr", "--from", "en", "--approve", "only these two", "--cap", "8000")
        self.assertEqual(self.job()["scope"], ["es", "fr"])
        self.dub("speak", "--video", "demo", "--lang", "de", "--test", "1", ok=(5,))  # outside the yes
        self.dub("plan", "--video", "demo", "--langs", "es,de,fr,it,pt", "--from", "en", "--approve", "all five again",
                 "--cap", "8000")
        code, j, _ = self.dub("speak", "--video", "demo", "--lang", "de", "--test", "1", ok=(5,))
        self.assertIn("may have been billed", j["message"])

    def test_09_a_sentence_too_long_stays_open(self):
        self.assertTrue(self.pilot("fr", 1, FR[0])["pass"])
        self.dub("speak", "--video", "demo", "--lang", "fr")
        code, rec, _ = self.dub("place", "--video", "demo", "--lang", "fr")
        self.assertTrue(any("too long" in x for x in rec["issues"]), rec["issues"])
        self.assertTrue(any(p.get("misfit") for p in rec["pieces"]))
        self.dub("mix", "--video", "demo", "--lang", "fr")
        code, v, _ = self.dub("verify", "--video", "demo", "--langs", "fr,es")
        st = {r["lang"]: r["status"] for r in v["rows"]}
        self.assertEqual(st, {"fr": "incomplete", "es": "ready"})

    def test_10_a_voice_test_failing_twice_stops_its_language(self):
        before = self.paid()
        r = self.pilot("pt", 1, "something else entirely, said in another way")
        self.assertFalse(r["pass"])
        code, j, _ = self.dub("speak", "--video", "demo", "--lang", "pt", ok=(5,))  # nothing more is bought
        self.assertIn("voice test", j["message"])
        self.dub("speak", "--video", "demo", "--lang", "pt", "--block", "1", "--takes", "2")
        self.dub("speak", "--video", "demo", "--lang", "pt", "--block", "1", "--pick", "2")
        self.mock.STATE["tts_texts"][:] = ["still not what it should say"]
        code, j, _ = self.dub("hear", "--video", "demo", "--lang", "pt", "--test", "1", ok=(5,))
        self.assertIn("failed twice", j["message"])
        self.assertEqual([x["kind"] for x in self.job()["languages"]["pt"]["stopped"]], ["pilot"])
        self.assertEqual(self.paid() - before, 4)  # the test, its check, the second take, its check

    def test_11_ledger_from_what_arrived(self):
        """run_paid in-process, eleven.py replaced: a take billed then one refused, a voice dearer than reserved, a
        crash with nothing on disk."""
        cwd = os.getcwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, cwd)
        v = dub.Video("demo")
        lang = dub.Lang(v, "nl")
        tdir = lang.blocks / "takes"
        tdir.mkdir(parents=True, exist_ok=True)
        files = [(v.rel(tdir / "01-a.t2.mp3"), 100), (v.rel(tdir / "01-a.t3.mp3"), 100)]
        real = dub.eleven
        self.addCleanup(setattr, dub, "eleven", real)

        def fake(made: list[tuple[str, int]], rc: int, msg: str):
            def run(args, v_):
                for f, cost in made:
                    p = v_.root / f
                    p.write_bytes(b"audio")
                    p.with_name(p.stem + ".request.json").write_text(json.dumps(
                        {"generated": dub.now(), "response": {"character_cost": str(cost)}}), encoding="utf-8")
                return rc, ({"error": msg} if msg else {})
            return run

        def job(cap: int, rate: float | None) -> dict:
            j = {"cap": cap, "languages": {"nl": {"share": cap}}, "ledger": [], "voice": {"id": VOICE}, "settings": {}}
            if rate:
                j["rate"] = {"credits_per_char": rate}
            j["languages"]["nl"]["model"] = "eleven_multilingual_v2"
            return j

        jpath = self.tmp / "ledger-job.json"
        v.job_path = jpath
        # a take billed, then one refused for credits: the first stays billed
        dub.eleven = fake([(files[0][0], 100)], 1, "text-to-speech for 01 take 3 failed: HTTP 402 insufficient_credits")
        j = job(1000, 1.0)
        e = dub.reserve(v, j, "nl", "nl block 1: 2 more take(s)", "tts", 200)
        with self.assertRaises(dub.Fail) as cm:
            dub.run_paid(v, j, lang, e, [], files)
        self.assertEqual(cm.exception.code, dub.SCOPE)
        self.assertEqual((e["status"], e["billed"]), ("done", 100.0))
        self.assertEqual(dub.ledger_totals(j)["committed"], 100.0)
        # a bill past the list rate (which ElevenLabs states for the voices a job takes): the job stops at the cap
        for f, _ in files:
            (v.root / f).unlink(missing_ok=True)
            (v.root / f).with_name(Path(f).stem + '.request.json').unlink(missing_ok=True)
        dub.eleven = fake([(files[0][0], 200)], 0, "")
        j = job(150, 1.0)
        e = dub.reserve(v, j, "nl", "nl block 1", "tts", 100)
        with self.assertRaises(dub.Fail) as cm:
            dub.run_paid(v, j, lang, e, [], files[:1])
        self.assertIn("more per character than reserved", cm.exception.msg)
        self.assertEqual(j["rate"]["credits_per_char"], 2.0)
        self.assertEqual([x["kind"] for x in dub.stops(j)], ["cap"])
        self.assertEqual(dub.char_rate(j), 2.0)
        self.assertEqual(dub.char_rate(job(1000, None)), 1.0)  # (the list rate, for a voice billed nowhere yet)
        # a crash with nothing on disk: possibly charged, the language stopped
        for f, _ in files:
            (v.root / f).unlink(missing_ok=True)
            (v.root / f).with_name(Path(f).stem + '.request.json').unlink(missing_ok=True)
        dub.eleven = fake([], 1, "Traceback (most recent call last): KeyError")
        j = job(1000, 1.0)
        e = dub.reserve(v, j, "nl", "nl block 1", "tts", 100)
        with self.assertRaises(dub.Fail):
            dub.run_paid(v, j, lang, e, [], files[:1])
        self.assertEqual(e["status"], "possibly charged")
        self.assertEqual([x["kind"] for x in dub.stops(j["languages"]["nl"])], ["charge"])

    def test_12_speech_past_the_videos_end_stays_open(self):
        tight = self.root / "videos" / "tight"
        shutil.copytree(self.v, tight, ignore=shutil.ignore_patterns("dub", "youtube"))
        words = json.loads((tight / "data" / "words.json").read_text(encoding="utf-8"))
        end = words["lines"][-1]["end"]
        plan = json.loads((tight / "mix.json").read_text(encoding="utf-8"))
        plan["duration"] = round(end + 0.6, 2)
        (tight / "mix.json").write_text(json.dumps(plan), encoding="utf-8")
        self.uv(SK / "mix.py", "build", "--video", "tight")
        (tight / "youtube" / "es").mkdir(parents=True)
        (tight / "youtube" / "es" / "narration.txt").write_text("\n\n".join(TIGHT) + "\n", encoding="utf-8")
        self.dub("plan", "--video", "tight", "--langs", "es", "--from", "en", "--approve", "yes", "--cap", "3000")
        self.dub("speak", "--video", "tight", "--lang", "es", "--test", "1")
        self.mock.STATE["tts_texts"][:] = [TIGHT[0]]
        self.dub("hear", "--video", "tight", "--lang", "es", "--test", "1")
        self.dub("speak", "--video", "tight", "--lang", "es")
        code, rec, _ = self.dub("place", "--video", "tight", "--lang", "es")
        self.assertTrue(any("video" in x and ("end" in x or "room" in x) for x in rec["issues"]), rec["issues"])
        placed = json.loads((tight / "dub" / "es" / "data" / "words-placed.json").read_text(encoding="utf-8"))
        self.assertTrue(rec["issues"] or all(w["end"] <= plan["duration"] for l in placed["lines"] for w in l["words"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
