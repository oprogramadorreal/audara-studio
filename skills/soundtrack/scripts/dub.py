# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "numpy>=2.0,<3",
#     "scipy>=1.13,<2",
#     "soundfile>=0.12,<1",
# ]
# ///
"""Dubbed audio tracks for an audara video: its narration in another language, in the same ElevenLabs voice, put
where the original narration sits, over the video's own music and effects, one complete track per language for
YouTube's audio tracks (YouTube Studio: Languages, the language, Dub: Add).

  source     the original narration's lines as paragraphs: the text a translation follows, one paragraph per line
  plan       what a batch of languages would cost (free); --approve writes the job, the one yes for the batch
  speak      a language's narration through eleven.py, inside the job: a ledger entry before each paid request
  place      each translated sentence where its original sentence sits, words the picture follows on their moment
  hear       the placed voice transcribed (paid, through the job) and compared with what it should say
  mix        the language's complete track (mix.py), the music and effects exactly as in the video's mix
  verify     every track against the video and the original mix: length, peaks, loudness, the bed, open issues
  status     where the job stands, what's next and what was spent against the cap: the point to resume from

Files, in an audara project (the nearest folder above with videos/):
  videos/<video>/youtube/<code>/narration.txt     the translation (yours): one paragraph per original line
  videos/<video>/dub/<code>/say.tsv               respellings for the voice (optional, as eleven.py reads them)
  videos/<video>/dub/<code>/anchors.tsv           words the picture follows (optional): line, original, translation
  videos/<video>/dub/<code>/levels.tsv            a line's level changed by hand (optional): line, dB, why
  videos/<video>/dub/<code>/audio/, data/         eleven.py's narration in that language (paid: keep it)
  videos/<video>/dub/<code>/audio/voice.wav       the voice placed in the video's time, as long as the video
  videos/<video>/dub/<code>/data/words-placed.json  its words at their times in the video (for subtitles and checks)
  videos/<video>/dub/<code>/placement.json        where each piece went and why, the open issues
  videos/<video>/youtube/<code>/mix.wav           the track to upload (and mix.wav.request.json, mix.py's record)
  videos/<video>/dub/job.json                     the approved scope: languages, voice, models, cap, ledger
  out/<video>/dub/                                review files (verify.json, mixes muxed on the render with --mp4)

The reference is the video's own mix (audio/mix.wav and its record, from mix.py build): the dubs copy its music and
effects, their times and gains, and are measured against it. Its data/words.json says where each original sentence
sits. Nothing here changes the video's files.

Spending: speak and hear spend credits only inside the job that `plan --approve` wrote with the director's words and
a credit cap. Before each paid request a ledger entry reserves its most it can cost; a request that fails in a way
that may have been billed stays reserved at that most ("possibly charged") and stops its language, never sent again
by itself. Each language has a share of the cap, so one language's retries can't use up another's.

Exit codes: 0 ok, 1 error, 2 usage, 3 no ElevenLabs key, 4 needs the director's yes (no job covers it), 5 outside
the approved scope (the cap, a stopped language, a changed voice): ask the director.
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
import subprocess
import sys
import unicodedata
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import lfilter

HERE = Path(__file__).resolve().parent
ELEVEN = HERE / "eleven.py"
MIX = HERE / "mix.py"
TOOL = "audara-studio soundtrack/scripts/dub.py"
VERSION = 2  # (placement's checks changed in 2: what an earlier version placed is placed again)
SR = 48000
OK, ERROR, USAGE, NO_KEY, CONFIRM, SCOPE = 0, 1, 2, 3, 4, 5

NAMES = {"en": "English", "es": "Spanish", "pt": "Portuguese", "hi": "Hindi", "ar": "Arabic", "ru": "Russian",
         "ja": "Japanese", "de": "German", "bn": "Bengali", "fr": "French", "vi": "Vietnamese", "tr": "Turkish",
         "id": "Indonesian", "ko": "Korean", "it": "Italian", "zh": "Chinese", "nl": "Dutch", "pl": "Polish",
         "uk": "Ukrainian", "th": "Thai", "fa": "Persian", "ur": "Urdu", "pa": "Punjabi", "ta": "Tamil",
         "te": "Telugu", "mr": "Marathi", "he": "Hebrew", "sv": "Swedish", "ro": "Romanian", "el": "Greek",
         "cs": "Czech", "fil": "Filipino", "ms": "Malay"}
# Characters of a narration in each language against the same narration in English (code points, what ElevenLabs
# bills): measured on an 8-minute pt-BR explainer translated whole into 8 languages (36 paragraphs each), and ten of
# its paragraphs translated into 7 more the way a dub's are (docs/history.md, 2026-11-17). Others are unmeasured.
CHAR_RATIO = {"en": 1.0, "pt": 0.98, "es": 1.04, "de": 1.03, "it": 1.03, "fr": 1.11, "ru": 0.90, "ja": 0.49,
              "ko": 0.48, "zh": 0.30, "hi": 0.91, "ar": 0.79, "bn": 0.88, "vi": 1.00, "tr": 0.95, "id": 1.04}
UNMEASURED_RATIO = 1.15
# Languages each model speaks (ElevenLabs' model pages, checked 2026-11-17): Multilingual v2's 29, Flash v2.5's 32;
# Eleven v3 (70+) and v4 (90+) speak every language here.
V2_LANGS = {"en", "ja", "zh", "de", "hi", "fr", "ko", "pt", "it", "es", "id", "nl", "tr", "fil", "pl", "sv", "bg",
            "ro", "ar", "cs", "el", "fi", "hr", "ms", "sk", "da", "ta", "uk", "ru"}
FLASH_LANGS = V2_LANGS | {"hu", "no", "vi"}
WIDE_MODELS = ("eleven_v3", "eleven_v4")
FALLBACK_MODEL = "eleven_v4"
CREDITS_PER_CHAR_MAX = 1.0  # list rate, the most a character costs (Flash bills 0.5-1): what a reservation holds
STT_CREDITS_PER_MIN = 330  # Scribe v2, as eleven.py estimates it
RETRY_SHARE = 0.25  # the estimate's allowance for retakes and shortened sentences, on top of one take of each block
PILOT_S = 30  # seconds of audio the estimate allows for each language's voice-test transcription

# Placement (seconds). Tested bounds, not proof of sync: verify and the director's eye are.
GAP_IN_LINE = 0.12  # between two pieces of one line, at least (less where the original's own pause was less)
GAP_LINES = 0.30  # between a line and the next, at least (likewise)
LEAD_MAX = 0.25  # a piece may start this much before its original sentence when the one before leaves room
TEMPO_MAX = 1.08  # a piece may be sped up this much (ffmpeg's atempo keeps the pitch)
SLIP_MAX = 0.40  # a piece may start this much after its original sentence when the one before runs long
ANCHOR_TOL = 0.30  # a word the picture follows lands this close to the original word's time
SPLIT_PAUSE = 0.08  # a pause this long before an anchored word lets the piece be cut there
PAD_IN, PAD_OUT = 0.08, 0.25  # sound kept before a piece's first word and after its last (breath, decay)
FADE = 0.006
LEVEL_CLAMP = 6.0  # dB: a line's level matched to the original line's, within this
END_ROOM = 0.25  # the last piece ends this long before the video does
FX_TOL = 0.00025  # s: a dub's effect lands where the video's does within this (a mix record keeps an effect's time to
# 0.1 ms, so its copy can land 3 samples away: 0.06 ms, far below anything heard)

TERM = re.compile(r"[.!?…。！？؟।॥]+[\"'”’»」』)\]]*$")
ABBR = {"mr.", "mrs.", "ms.", "dr.", "st.", "sr.", "sra.", "jr.", "vs.", "e.g.", "i.e.", "z.b.", "bzw.", "ca.", "nr.",
        "prof.", "u.a.", "d.h.", "approx.", "fig."}


class Fail(Exception):
    def __init__(self, code: int, msg: str, data: dict | None = None):
        super().__init__(msg)
        self.code, self.msg, self.data = code, msg, data or {}


def usage(msg: str) -> Fail:
    return Fail(USAGE, msg)


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256(p: Path) -> str | None:
    if not p.is_file():
        return None
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_json(p: Path, what: str | None = None):
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (ValueError, OSError) as e:
        raise Fail(ERROR, f"{what or p.name}: {p} is not readable JSON ({e})")


def write_json(p: Path, obj) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    os.replace(tmp, p)


def say(*lines: str) -> None:
    for x in lines:
        print(x, flush=True)


def note(msg: str) -> None:
    print(f"  ({msg})", file=sys.stderr, flush=True)


def base_lang(code: str) -> str:
    return code.split("-")[0].lower()


def lang_name(code: str) -> str:
    b = base_lang(code)
    return NAMES.get(b, code) + (f" ({code})" if code != b else "")


def num(x: float) -> str:
    return f"{int(round(x)):,}"


# ------------------------------------------------------------------------------------------------ the project

def find_project(start: Path) -> Path | None:
    for d in (start, *start.parents):
        if (d / "videos").is_dir():
            return d
    return None


class Video:
    def __init__(self, name: str):
        root = find_project(Path.cwd())
        if root is None:
            raise usage(f"no audara project (a folder with videos/) in {Path.cwd()} or above it: dubs work on a video "
                        "made in a project, whose mix.json keeps the voice apart from the music and effects")
        v = root / "videos" / name
        if not v.is_dir():
            names = sorted(p.name for p in (root / "videos").iterdir() if p.is_dir())
            raise usage(f"there is no videos/{name}/ (videos here: {', '.join(names) or 'none'})")
        self.root, self.name, self.dir = root, name, v
        self.dub = v / "dub"
        self.youtube = v / "youtube"
        self.job_path = self.dub / "job.json"
        self.review = root / "out" / name / "dub"

    def rel(self, p: Path) -> str:
        try:
            return Path(os.path.relpath(Path(p).resolve(), self.root)).as_posix()
        except ValueError:
            return str(p)


class Lang:
    def __init__(self, v: Video, code: str):
        if not re.fullmatch(r"[a-z]{2,3}(-[A-Za-z0-9]{2,8})?", code):
            raise usage(f"{code!r}: a language code such as es, pt-BR or zh-Hans")
        self.v, self.code, self.base = v, code, base_lang(code)
        self.dir = v.dub / code
        self.pkg = v.youtube / code
        self.narration_txt = self.pkg / "narration.txt"
        self.say = self.dir / "say.tsv"
        self.anchors = self.dir / "anchors.tsv"
        self.levels = self.dir / "levels.tsv"
        self.take_wav = self.dir / "audio" / "narration.wav"
        self.take_words = self.dir / "data" / "words.json"
        self.blocks = self.dir / "audio" / "narration"
        self.voice = self.dir / "audio" / "voice.wav"
        self.placed = self.dir / "data" / "words-placed.json"
        self.placement = self.dir / "placement.json"
        self.heard = self.dir / "heard.json"
        self.pilot = self.dir / "pilot.json"
        self.take = self.dir / "take.json"
        self.mix_plan = self.dir / "mix.json"
        self.mix_wav = self.pkg / "mix.wav"
        self.mix_rec = self.pkg / "mix.wav.request.json"
        self.review = v.review / code


# ------------------------------------------------------------------------------------------------ audio

def tool(name: str) -> None:
    if shutil.which(name) is None:
        raise Fail(ERROR, f"{name} is not installed (dubs decode, time-stretch and measure audio with it)")


def decode(p: Path, channels: int = 1) -> np.ndarray:
    r = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", str(p), "-f", "f32le", "-acodec", "pcm_f32le",
                        "-ac", str(channels), "-ar", str(SR), "-"], capture_output=True)
    if r.returncode:
        raise Fail(ERROR, f"ffmpeg could not decode {p}: {r.stderr.decode(errors='replace').strip()[-300:]}")
    x = np.frombuffer(r.stdout, np.float32).copy()
    return x if channels == 1 else x.reshape(-1, channels)


def stretch(x: np.ndarray, tempo: float) -> np.ndarray:
    """x played `tempo` times faster at the same pitch (ffmpeg's atempo)."""
    if abs(tempo - 1) < 1e-4 or not len(x):
        return x
    r = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-",
                        "-filter:a", f"atempo={tempo:.5f}", "-f", "f32le", "-acodec", "pcm_f32le", "-"],
                       input=x.astype(np.float32).tobytes(), capture_output=True)
    if r.returncode:
        raise Fail(ERROR, f"ffmpeg atempo failed: {r.stderr.decode(errors='replace').strip()[-300:]}")
    return np.frombuffer(r.stdout, np.float32).copy()


# BS.1770 K-weighting at 48 kHz: a high shelf, then a high-pass.
K1 = ([1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585])
K2 = ([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621])


def kpower(x: np.ndarray) -> np.ndarray:
    """K-weighted power per sample, summed over channels."""
    y = lfilter(*K2, lfilter(*K1, x, axis=0), axis=0)
    p = y.astype(np.float64) ** 2
    return p if p.ndim == 1 else p.sum(axis=1)


def lufs(x: np.ndarray) -> float | None:
    """Gated loudness (BS.1770: 400 ms blocks every 100 ms, -70 LUFS absolute and -10 LU relative gates)."""
    if len(x) < SR // 10:
        return None
    p = kpower(x)
    blk, hop = int(0.4 * SR), int(0.1 * SR)
    if len(p) < blk:
        ms = np.array([p.mean()])
    else:
        c = np.concatenate([[0.0], np.cumsum(p)])
        s = np.arange(0, len(p) - blk + 1, hop)
        ms = (c[s + blk] - c[s]) / blk
    lv = -0.691 + 10 * np.log10(np.maximum(ms, 1e-20))
    keep = lv > -70
    if not keep.any():
        return None
    rel = -0.691 + 10 * np.log10(ms[keep].mean()) - 10
    keep &= lv > rel
    return float(-0.691 + 10 * np.log10(ms[keep].mean())) if keep.any() else None


def short_term(x: np.ndarray, win: float = 3.0, hop: float = 1.0) -> tuple[np.ndarray, np.ndarray]:
    """Short-term loudness (3 s windows) every second: (window centres in s, LUFS)."""
    p = kpower(x)
    w, h = int(win * SR), int(hop * SR)
    if len(p) < w:
        return np.array([]), np.array([])
    c = np.concatenate([[0.0], np.cumsum(p)])
    s = np.arange(0, len(p) - w + 1, h)
    ms = (c[s + w] - c[s]) / w
    return (s + w / 2) / SR, -0.691 + 10 * np.log10(np.maximum(ms, 1e-20))


def frame_db(x: np.ndarray, a: int, b: int) -> np.ndarray:
    """RMS in dBFS of 10 ms frames over x[a:b]."""
    f = SR // 100
    seg = x[max(0, a):max(0, b)]
    n = len(seg) // f
    if n <= 0:
        return np.array([])
    e = (seg[:n * f].astype(np.float64).reshape(n, f) ** 2).mean(axis=1)
    return 10 * np.log10(np.maximum(e, 1e-20))


def quietest(x: np.ndarray, t0: float, t1: float) -> float:
    """The start of the quietest 10 ms frame between t0 and t1 (seconds), where a cut is least heard."""
    a, b = int(t0 * SR), int(t1 * SR)
    db = frame_db(x, a, b)
    if not len(db):
        return t0
    return (max(0, a) + int(np.argmin(db)) * (SR // 100)) / SR


# ------------------------------------------------------------------------------------------------ words

def norm(s: str) -> str:
    """For finding words by text, as the engine's findWords does: accents, case and punctuation ignored."""
    s = unicodedata.normalize("NFKD", s.lower())
    return "".join(c for c in s if unicodedata.category(c)[0] in "LN")


def sentences(words: list[dict]) -> list[list[dict]]:
    """A line's sentences: a word ending in . ! ? ... (or their CJK, Arabic and Devanagari forms) ends one; an
    abbreviation or a one- or two-digit ordinal ("8.") does not."""
    out, cur = [], []
    for w in words:
        cur.append(w)
        t = str(w.get("w", ""))
        if TERM.search(t) and t.lower() not in ABBR and not re.fullmatch(r"\d{1,2}\.", t):
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return out


def heard(a: float, b: float, window: tuple[float, float]) -> bool:
    """Whether the stretch a..b is heard in `window`: none of it is in an empty one (a voice block that starts after
    the video's end)."""
    lo, hi = window
    return hi > lo and b > lo and a < hi


def word_lines(doc: dict, shift: float = 0.0, window: tuple[float, float] | None = (0.0, math.inf)) -> list[dict]:
    """A words.json's lines in video time (+shift). Words outside `window`, the stretch of the video where the mix
    plays them (from 0 s; a narration placed before 0 s, cut by its block's "from" or "dur", or by the mix's end),
    aren't in the video: left out, and a word cut by an edge is cut there. None keeps every word."""
    lo, hi = window or (-math.inf, math.inf)
    lines = []
    for i, l in enumerate(doc.get("lines") or []):
        ws = [{**w, "start": max(lo, float(w["start"]) + shift), "end": min(hi, float(w["end"]) + shift)}
              for w in l.get("words") or [] if isinstance(w.get("start"), (int, float))
              and heard(float(w["start"]) + shift, float(w["end"]) + shift, (lo, hi))]
        text = l.get("text") if isinstance(l.get("text"), str) else " ".join(str(w.get("w", "")) for w in ws)
        lines.append({"i": i, "text": text, "words": ws,
                      "start": ws[0]["start"] if ws else None, "end": ws[-1]["end"] if ws else None})
    return lines


def find_seq(words: list[dict], text: str, nth: int) -> int | None:
    """Index of the first word of the nth (1-based) run of words reading `text`."""
    toks = [norm(t) for t in text.split() if norm(t)]
    if not toks:
        return None
    hits = [i for i in range(len(words) - len(toks) + 1)
            if all(norm(str(words[i + k].get("w", ""))) == toks[k] for k in range(len(toks)))]
    if len(toks) == 1 and not hits:  # a word inside a run with no spaces (Japanese, Chinese): by containment
        hits = [i for i, w in enumerate(words) if toks[0] in norm(str(w.get("w", "")))]
    return hits[nth - 1] if 0 < nth <= len(hits) else None


def split_nth(s: str) -> tuple[str, int]:
    m = re.fullmatch(r"(.*?)\s*#(\d+)", s.strip())
    return (m.group(1), int(m.group(2))) if m else (s.strip(), 1)


def read_tsv(p: Path, cols: int, what: str) -> list[list[str]]:
    if not p.is_file():
        return []
    rows = []
    for k, raw in enumerate(p.read_text(encoding="utf-8-sig").splitlines(), 1):
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        parts = raw.split("\t")
        if len(parts) < cols:
            raise usage(f"{p.name} line {k}: {cols} tab-separated columns expected ({what})")
        rows.append([x.strip() for x in parts])
    return rows


# ------------------------------------------------------------------------------------------------ the reference

def narration_words(v: Video) -> tuple[Path, dict]:
    """The video's timed narration, data/words.json."""
    wpath = v.dir / "data" / "words.json"
    doc = read_json(wpath, "data/words.json")
    if not isinstance(doc, dict) or not doc.get("lines"):
        raise usage(f"{v.rel(wpath)} has no narration lines: a dub puts each translated sentence where the "
                    "original's sits, so the video needs its words timed (eleven.py tts, or align.py)")
    return wpath, doc


def voice_window(res: dict, layer) -> tuple[float, float]:
    """Where the mix plays the voice block data/words.json was timed to, in video time: from its start (0 s at the
    earliest) to its end, as the mix record has them (its "from" and "dur", the file's end and the mix's end all cut
    it). Words timed to something else: the whole video from 0 s."""
    m = re.fullmatch(r"voice(?:\[(\d+)\])?", str(layer or ""))
    rows = res.get("voice") or []
    i = int(m.group(1) or 0) if m else -1
    if not 0 <= i < len(rows) or not isinstance(rows[i], dict):
        return 0.0, math.inf
    try:
        return max(0.0, float(rows[i].get("at") or 0.0)), float(rows[i]["end"])
    except (KeyError, TypeError, ValueError):
        return 0.0, math.inf


class Original:
    """The video's own mix and narration, which every dub copies and is measured against."""

    def __init__(self, v: Video):
        self.v = v
        rec_path = v.dir / "audio" / "mix.wav.request.json"
        rec = read_json(rec_path, "the video's mix record")
        if not isinstance(rec, dict):
            raise usage(f"{v.rel(rec_path)} doesn't exist: a dub copies the video's own mix (its music and effects, "
                        f"where and how loud), so build it first: mix.py build --video {v.name}")
        mix = v.dir / "audio" / "mix.wav"
        if (rec.get("outputs") or {}).get("mix.wav") != sha256(mix):
            raise usage(f"{v.rel(mix)} isn't the one its record describes: build it again (mix.py build --video "
                        f"{v.name}) so the dubs copy the mix the video plays")
        changed = [f for f, h in (rec.get("inputs") or {}).items() if sha256(v.root / f) != h]
        changed += [f for f, h in (rec.get("data") or {}).items() if sha256(v.root / f) != h]
        if changed:
            raise usage(f"the video's mix is older than {', '.join(changed)}: build it again (mix.py build --video "
                        f"{v.name}) before dubbing it")
        self.rec, self.rec_path = rec, rec_path
        res = rec.get("resolved") or {}
        self.duration = float(res.get("duration") or 0)
        self.render = v.root / "out" / v.name / f"{v.name}.mp4"
        self.words_path, doc = narration_words(v)
        tdata = (res.get("timing_data") or {}).get("words.json") or {}
        shift = float(tdata.get("shift_s") or 0.0)
        # what the video plays of the narration: its voice block, up to the video's end (a final render shorter
        # than the mix ends it sooner)
        lo, hi = voice_window(res, tdata.get("layer"))
        self.window = lo, min(hi, self.video_duration()[0])
        self.lines = word_lines(doc, shift, self.window)
        self.spoken = word_lines(doc, shift, None)  # (the whole narration, what a translation says and is billed for)
        # a line's sentences as spoken, before the video cuts any: a translation follows them one for one, so a
        # sentence the video leaves out whole is left out of the dub too, and one it cuts in part starts at the cut
        for l, full in zip(self.lines, self.spoken):
            l["sentences"] = sentences(full["words"])
            l["trimmed"] = any(not heard(w["start"], w["end"], self.window) for w in full["words"])
        self.plan_dir = (v.root / rec.get("plan_file", f"videos/{v.name}/mix.json")).parent
        vj = read_json(v.dir / "video.json", "video.json") or {}
        self.fps = float(vj.get("fps") or 30) if isinstance(vj, dict) else 30.0

    def chars(self) -> int:
        """The narration's characters, all of it: speak makes each translated paragraph whole, whatever part of it
        the video plays, so the estimate counts it whole."""
        return sum(len(" ".join(str(w.get("spoken") or w.get("w", "")) for w in l["words"])) for l in self.spoken)

    def voice_track(self) -> np.ndarray | None:
        """The original voice layer in video time (mono), from the plan as recorded: per-line levels come from it."""
        raw = (self.rec.get("plan") or {}).get("voice")
        items = [] if raw is None else (raw if isinstance(raw, list) else [raw])
        n = int(round(self.duration * SR))
        out = np.zeros(n, np.float32)
        for b in items:
            b = {"file": b} if isinstance(b, str) else b
            if not isinstance(b, dict) or not isinstance(b.get("file"), str):
                return None
            f = (self.plan_dir / b["file"]).resolve()
            if not f.is_file():
                return None
            x = decode(f)
            a0 = int(round(tsec(b.get("from", 0)) * SR))
            d = b.get("dur")
            a1 = min(len(x), a0 + int(round(tsec(d) * SR))) if d is not None else len(x)
            at = int(round(tsec(b.get("at", 0)) * SR))
            seg = x[a0:a1] * np.float32(10 ** (float(b.get("gain_db", 0)) / 20))
            if at < 0:
                seg, at = seg[-at:], 0
            seg = seg[:max(0, n - at)]
            out[at:at + len(seg)] += seg
        return out

    def narration_cfg(self) -> tuple[dict | None, Path | None]:
        """The eleven.py settings the original narration was made with (voice, model, settings)."""
        raw = (self.rec.get("plan") or {}).get("voice")
        items = [] if raw is None else (raw if isinstance(raw, list) else [raw])
        cands = []
        for b in items:
            f = b if isinstance(b, str) else (b.get("file") if isinstance(b, dict) else None)
            if isinstance(f, str):
                cands.append((self.plan_dir / f).resolve().parent / "narration" / "narration.json")
        cands += sorted(p for p in self.v.dir.rglob("narration/narration.json") if self.v.dub not in p.parents)
        for c in cands:
            j = read_json(c)
            if isinstance(j, dict) and j.get("voice_id"):
                return j, c
        return None, None

    def billed_rate(self, cfg_path: Path | None, voice_id: str) -> tuple[float | None, float | None]:
        """Credits billed per character for this voice on the original narration, from its request records (the
        account's own): on average, and the most one request cost (what a reservation holds)."""
        if cfg_path is None:
            return None, None
        billed = chars = 0
        top = None
        for r in list(cfg_path.parent.glob("*.request.json")) + list(cfg_path.parent.glob("takes/*.request.json")):
            j = read_json(r) or {}
            req = j.get("request") or {}
            if f"/{voice_id}/" not in str(req.get("path", "")):
                continue
            cc = (j.get("response") or {}).get("character_cost")
            text = (req.get("body") or {}).get("text")
            try:
                if cc is not None and isinstance(text, str) and text:
                    billed += int(cc)
                    chars += len(text)
                    top = max(top or 0.0, int(cc) / len(text))
            except (TypeError, ValueError):
                continue
        return (billed / chars if chars else None), top

    def video_duration(self) -> tuple[float, str]:
        """The length every track must have: the final render's, else the original mix's."""
        if self.render.is_file() and shutil.which("ffprobe"):
            r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                "stream=duration", "-of", "default=nw=1:nk=1", str(self.render)],
                               capture_output=True, text=True)
            try:
                return float(r.stdout.strip().splitlines()[0]), self.v.rel(self.render)
            except (ValueError, IndexError):
                pass
        return self.duration, "the video's mix (no final render in out/ yet)"

    def fingerprint(self) -> dict:
        """What a job's work depends on: if any of it changes, the dubs are placed and mixed again."""
        return {"words": sha256(self.words_path), "mix_record": sha256(self.rec_path),
                "render": sha256(self.render) if self.render.is_file() else None}


def tsec(v) -> float:
    if isinstance(v, (int, float)):
        return float(v)
    m = re.fullmatch(r"(?:(\d+):)?(\d+(?:\.\d+)?)", str(v).strip())
    if not m:
        raise usage(f"{v!r} is not a time")
    return int(m.group(1) or 0) * 60 + float(m.group(2))


def model_for(lang: str, orig_model: str) -> str:
    b = base_lang(lang)
    if orig_model.startswith(WIDE_MODELS):
        return orig_model
    if orig_model.startswith("eleven_multilingual_v2") and b in V2_LANGS:
        return orig_model
    if orig_model.startswith("eleven_flash_v2_5") and b in FLASH_LANGS:
        return orig_model
    return FALLBACK_MODEL


# ------------------------------------------------------------------------------------------------ eleven.py

def eleven(args: list[str], v: Video) -> tuple[int, dict]:
    """Run eleven.py with --json; (exit code, its JSON object)."""
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    r = subprocess.run(["uv", "run", "--quiet", str(ELEVEN), *args, "--json"], cwd=v.root, capture_output=True,
                       text=True, encoding="utf-8", errors="replace", env=env)
    out = r.stdout.strip()
    j = {}
    if out:
        try:
            j = json.loads(out[out.index("{"):])
        except ValueError:
            j = {"message": out[-800:]}
    if r.returncode and not j.get("message") and not j.get("error"):
        j["message"] = (r.stderr or out).strip()[-800:]
    return r.returncode, j


def msg_of(j: dict) -> str:
    return str(j.get("message") or j.get("error") or "")


def surely_not_billed(code: int, j: dict) -> bool:
    """A paid command that failed without its file: billed only if the request may have reached ElevenLabs and been
    processed. An answer with a 4xx status (out of credits, a voice not found, too many requests) or a refusal before
    anything was sent (usage, no key, no yes) is not; anything else (a timeout, a dropped connection, a crash, a 5xx)
    may have been, and counts as spent."""
    m = msg_of(j)
    return code in (USAGE, NO_KEY, CONFIRM) or bool(re.search(r"failed: HTTP 4\d\d|still busy after", m))


def tts_args(lang: Lang, job: dict, extra: list[str]) -> list[str]:
    ls = job["languages"][lang.code]
    model = ls["model"]
    a = ["tts", lang.v.rel(lang.narration_txt), "--out", lang.v.rel(lang.dir), "--voice", job["voice"]["id"],
         "--model", model]
    if not model.startswith("eleven_multilingual_v2"):
        a += ["--language", lang.base]
    if lang.say.is_file():
        a += ["--say", lang.v.rel(lang.say)]
    st = job.get("settings") or {}
    vs = st.get("voice_settings") or {}
    # only the settings the model takes (as eleven.py's setting_keys says: it refuses the others)
    takes = next((s for m, s in (("eleven_v4", {"stability", "similarity_boost"}),
                                 ("eleven_v3", {"stability", "style"})) if model.startswith(m)),
                 {"stability", "similarity_boost", "style", "speed", "use_speaker_boost"})
    for k, flag in (("stability", "--stability"), ("similarity_boost", "--similarity"), ("style", "--style"),
                    ("speed", "--speed")):
        if k in vs and k in takes and vs[k] is not None:
            a += [flag, str(vs[k])]
    if "use_speaker_boost" in vs and "use_speaker_boost" in takes:
        a += ["--speaker-boost" if vs["use_speaker_boost"] else "--no-speaker-boost"]
    if st.get("lufs") is not None:
        a += ["--lufs", str(st["lufs"])]
    return a + extra


# ------------------------------------------------------------------------------------------------ the job

def load_job(v: Video, need: bool = True) -> dict | None:
    job = read_json(v.job_path, "dub/job.json")
    if job is None and need:
        raise Fail(CONFIRM, f"no approved job: {v.rel(v.job_path)} doesn't exist. Show the director the batch "
                            f"(dub.py plan --video {v.name} --langs ... --from <code>) and, after their yes, write it "
                            f"with --approve \"<their words>\" --cap <credits>")
    return job


def ledger_totals(job: dict, lang: str | None = None) -> dict:
    t = {"billed": 0.0, "possibly": 0.0, "pending": 0.0}
    for e in job.get("ledger") or []:
        if lang is not None and e.get("lang") != lang:
            continue
        if e.get("status") == "done":
            t["billed"] += float(e.get("billed") if e.get("billed") is not None else e.get("max", 0))
        elif e.get("status") in ("unknown", "possibly charged"):
            t["possibly"] += float(e.get("max", 0))
        elif e.get("status") == "pending":
            t["pending"] += float(e.get("max", 0))
    t["committed"] = t["billed"] + t["possibly"] + t["pending"]
    return t


def char_rate(job: dict) -> float:
    """Credits a character may cost: the list rate, the most ElevenLabs states for these models on a voice the
    account owns or one of its own premade voices (the only voices a job takes); higher only if this voice was once
    billed more, which stopped the job."""
    r = job.get("rate") or {}
    if r.get("voice") == (job.get("voice") or {}).get("id") and r.get("credits_per_char"):
        return max(CREDITS_PER_CHAR_MAX, float(r["credits_per_char"]))
    return CREDITS_PER_CHAR_MAX


def learn_rate(job: dict, billed: float, chars: int) -> None:
    """A settled request billed more per character than the list rate: kept for this voice (and over_cap stops)."""
    if chars <= 0 or billed <= 0:
        return
    r = billed / chars
    if r > char_rate(job) + 1e-9:
        job["rate"] = {"voice": (job.get("voice") or {}).get("id"), "credits_per_char": round(r, 4),
                       "from": "a request of this job, billed past the stated rate"}


def voice_ok(info: dict | None) -> tuple[bool, str]:
    """Whether a cap can hold with this voice. ElevenLabs states a list rate per character, and credit multipliers
    only on Voice Library voices whose sharer set a custom rate (a legacy feature, varying by the user's plan, not in
    the API's voice fields): a voice the account owns, or one of ElevenLabs' premade voices, costs the list rate at
    most; any other voice may cost more by a factor nobody can read beforehand."""
    if info is None:
        return False, "the voice isn't among the account's voices (eleven.py voices), so its rate can't be known"
    if info.get("is_owner") is True:
        return True, "a voice the account owns"
    if info.get("category") == "premade":
        return True, "one of ElevenLabs' premade voices"
    return False, (f"a voice the account doesn't own ({info.get('category') or 'from the Voice Library'}): a Voice "
                   "Library voice can carry a credit multiplier that the API doesn't state, so no cap can be held "
                   "with it")


def voice_info(v: Video, voice_id: str) -> dict | None:
    """The voice as the account lists it (free): its category and whether the account owns it."""
    rc, j = eleven(["voices", "--limit", "1000"], v)
    if rc:
        raise Fail(rc, f"listing the account's voices: {msg_of(j)}")
    return next((x for x in j.get("voices") or [] if x.get("voice_id") == voice_id), None)


def stops(holder: dict) -> list[dict]:
    """A language's (or the job's) stops, each {"kind", "why"}: charge (a request that may have been billed without
    its audio), share (its share of the cap spent), cap (the cap passed), pilot (its voice test failed twice)."""
    return [x if isinstance(x, dict) else {"kind": "charge", "why": str(x)} for x in holder.get("stopped") or []]


def stop(holder: dict, why: str, kind: str) -> None:
    cur = stops(holder)
    if not any(x["why"] == why for x in cur):
        cur.append({"kind": kind, "why": why, "at": now()})
    holder["stopped"] = cur


def stop_lang(job: dict, lang: str, why: str, kind: str = "charge") -> None:
    ls = job["languages"].get(lang)
    if ls is not None:
        stop(ls, why, kind)


def settle_pending(v: Video, job: dict) -> list[str]:
    """A ledger entry left pending by a run that stopped mid-request may have been billed: it becomes "possibly
    charged" at its most, and its language stops. Only under the job's lock (no other run is mid-request then)."""
    found = []
    for e in job.get("ledger") or []:
        if e.get("status") == "pending":
            e["status"] = "possibly charged"
            e["settled"] = now()
            stop_lang(job, e["lang"], f"{e['what']}: the run stopped during the request, which may have been billed "
                                      f"(up to {num(e['max'])} credits, counted as spent); check the account's history "
                                      "on elevenlabs.io before making it again")
            found.append(e["what"])
    if found:
        write_json(v.job_path, job)
    return found


class JobLock:
    """The job's lock, across processes: whoever holds it reads the job fresh and writes it, and paid requests go one
    at a time, so the cap is checked against a ledger nobody else is writing."""

    def __init__(self, v: Video):
        self.p = v.dub / ".job.lock"

    def __enter__(self):
        self.p.parent.mkdir(parents=True, exist_ok=True)
        try:
            fd = os.open(self.p, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            raise Fail(SCOPE, f"{self.p} exists: another dub run is working on the job now (or one stopped without "
                              "cleaning up: if no other run is going, delete it; dub.py status then settles a request "
                              "it left pending as possibly charged)")
        with os.fdopen(fd, "w") as f:
            f.write(f"{os.getpid()} {now()}\n")
        return self

    def __exit__(self, *exc):
        try:
            self.p.unlink()
        except OSError:
            pass


def reserve(v: Video, job: dict, lang: str, what: str, kind: str, most: float) -> dict:
    """A ledger entry for a paid request, written before it is sent; refused past the cap or the language's share."""
    tot, mine = ledger_totals(job), ledger_totals(job, lang)
    cap, share = float(job["cap"]), float(job["languages"][lang].get("share") or job["cap"])
    if tot["committed"] + most > cap:
        raise Fail(SCOPE, f"{what} could cost up to {num(most)} credits; {num(cap - tot['committed'])} of the approved "
                          f"{num(cap)} are left. Going on is the director's call (a higher cap)")
    if mine["committed"] + most > share:
        why = (f"{what} would pass {lang_name(lang)}'s share of the cap ({num(mine['committed'])} of {num(share)} "
               "credits used): it stops here, the other languages go on; a higher cap the director approves lets it "
               "go on")
        stop_lang(job, lang, why, "share")
        write_json(v.job_path, job)
        raise Fail(SCOPE, why)
    e = {"id": len(job.get("ledger") or []) + 1, "lang": lang, "what": what, "kind": kind, "max": round(most, 1),
         "status": "pending", "at": now()}
    job.setdefault("ledger", []).append(e)
    write_json(v.job_path, job)
    return e


def settle(v: Video, job: dict, e: dict, status: str, billed: float | None = None, why: str = "") -> None:
    e["status"] = status
    e["settled"] = now()
    if billed is not None:
        e["billed"] = billed
    if why:
        e["why"] = why
    write_json(v.job_path, job)


def over_cap(v: Video, job: dict) -> None:
    """After a request billed more than it reserved (a voice dearer than measured): past the cap, everything stops."""
    tot = ledger_totals(job)
    if tot["committed"] > float(job["cap"]) + 1e-6:
        why = (f"the voice was billed more per character than reserved (up to {char_rate(job):.2f} credits a "
               f"character): {num(tot['committed'])} spent or reserved, past the approved {num(job['cap'])}")
        stop(job, why, "cap")
        write_json(v.job_path, job)
        raise Fail(SCOPE, why + ": going on is the director's call")


def unresolved(job: dict, lang: str) -> list[dict]:
    """The language's requests that may have been billed without arriving: from the ledger itself, so no new
    approval or change of the job's languages can lose them."""
    return [e for e in job.get("ledger") or [] if e.get("lang") == lang and e.get("status") in ("possibly charged", "unknown")]


def check_scope(v: Video, job: dict, lang: Lang) -> dict:
    if stops(job):
        raise Fail(SCOPE, "the job stopped: " + "; ".join(x["why"] for x in stops(job)))
    if not (job.get("voice") or {}).get("rate_known"):
        raise Fail(SCOPE, f"the job's voice: {(job.get('voice') or {}).get('why') or 'its rate is unknown'}")
    u = unresolved(job, lang.code)
    if u:
        raise Fail(SCOPE, f"{lang_name(lang.code)} stopped: {u[0]['what']} may have been billed without its audio "
                          "arriving (counted as spent); check the account's history on elevenlabs.io: going on is the "
                          "director's call")
    ls = job["languages"].get(lang.code)
    if ls is None or lang.code not in job.get("scope", list(job["languages"])):
        raise Fail(SCOPE, f"{lang_name(lang.code)} isn't in the approved job ({', '.join(job['languages'])}): adding it "
                          "is the director's call")
    if stops(ls):
        raise Fail(SCOPE, f"{lang_name(lang.code)} stopped: " + "; ".join(x["why"] for x in stops(ls)))
    return ls


# ------------------------------------------------------------------------------------------------ source and plan

def paragraphs(p: Path) -> list[str]:
    t = p.read_text(encoding="utf-8-sig").replace("\r\n", "\n")
    return [" ".join(x.split()) for x in re.split(r"\n\s*\n", t) if x.strip()]


def cmd_source(a) -> dict:
    v = Video(a.video)
    # (the narration as written, from its words alone: a translation for the subtitles needs no mix, nor a dub)
    lines = word_lines(narration_words(v)[1], 0.0, None)
    out = Path(a.out) if a.out else v.dub / "source.txt"
    text = "\n\n".join(l["text"] for l in lines) + "\n"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8", newline="\n")
    counts = [len(sentences(l["words"])) for l in lines]
    say(f"Wrote {v.rel(out)}: the narration's {len(lines)} lines as paragraphs, {sum(counts)} sentences.",
        "A translation (youtube/<code>/narration.txt) keeps them one for one: paragraph for paragraph, sentence for "
        "sentence where the language allows, so each sentence lands where its original sits.")
    return {"file": v.rel(out), "lines": len(lines), "sentences": counts}


def check_translation(o: Original, lang: Lang) -> list[str]:
    """The translation against the original: paragraphs one for one (an error), sentences (notes)."""
    if not lang.narration_txt.is_file():
        raise usage(f"{lang.v.rel(lang.narration_txt)} doesn't exist: the translation the subtitles and the dub are "
                    f"made from, one paragraph per original line (dub.py source --video {lang.v.name})")
    paras = paragraphs(lang.narration_txt)
    if len(paras) != len(o.lines):
        raise usage(f"{lang.v.rel(lang.narration_txt)} has {len(paras)} paragraphs and the narration {len(o.lines)} "
                    "lines: one paragraph per line, in order, so each lands where its original sits")
    notes = []
    for i, (p, l) in enumerate(zip(paras, o.lines)):
        ns = len(sentences([{"w": t} for t in p.split()]))
        if ns != len(l["sentences"]):
            notes.append(f"line {i + 1}: {ns} sentences against the original's {len(l['sentences'])} (placed as one "
                         "piece from the line's start, unless anchors place parts)")
    return notes


def cmd_plan(a) -> dict:
    v = Video(a.video)
    o = Original(v)
    cfg, cfg_path = o.narration_cfg()
    job = load_job(v, need=False)
    langs = [x.strip() for x in (a.langs or "").split(",") if x.strip()] or list((job or {}).get("scope") or (job or {}).get("languages") or [])
    if not langs:
        raise usage("name the languages: --langs es,en,hi (codes; the youtube-package skill's references/languages.md "
                    "has the preset)")
    voice_id = a.voice or (job or {}).get("voice", {}).get("id") or (cfg or {}).get("voice_id")
    voice_name = (cfg or {}).get("voice_name") if voice_id == (cfg or {}).get("voice_id") else None
    voice_name = voice_name or (job or {}).get("voice", {}).get("name")
    if not voice_id:
        raise usage("the narration wasn't made with eleven.py, so there is no voice to keep: a dub needs a voice from "
                    "the account (--voice ID, from eleven.py voices), which the director chooses")
    orig_model = a.model or (cfg or {}).get("model_id") or "eleven_multilingual_v2"
    src = a.source_lang or (job or {}).get("from")
    if not src:
        raise usage("--from <code>: the video's language (its narration's), which the estimate scales from")
    vdur, vsrc = o.video_duration()
    avg_rate, _ = o.billed_rate(cfg_path, voice_id)
    per_char = char_rate(job) if job and (job.get("voice") or {}).get("id") == voice_id else CREDITS_PER_CHAR_MAX
    orig_chars = o.chars()
    rows = []
    for code in langs:
        lang = Lang(v, code)
        if base_lang(code) == base_lang(src):
            raise usage(f"{lang_name(code)} is the video's own language: its package is the default one")
        model = ((job or {}).get("languages") or {}).get(code, {}).get("model") or model_for(code, orig_model)
        exact, notes = None, []
        if lang.narration_txt.is_file():
            notes = check_translation(o, lang)
            jtmp = {"voice": {"id": voice_id}, "settings": {"voice_settings": (cfg or {}).get("voice_settings") or {},
                                                            "lufs": (cfg or {}).get("lufs")},
                    "languages": {code: {"model": model}}}
            rc, j = eleven(tts_args(lang, jtmp, []), v)
            if rc == CONFIRM:
                exact = sum(int(x.get("characters", 0)) for x in j.get("jobs") or [])
            elif rc == OK:
                exact = 0  # every block exists already
            elif rc == NO_KEY:
                exact = sum(len(p) for p in paragraphs(lang.narration_txt))
                notes.append("no ElevenLabs key: characters counted from the text (say map not applied)")
            else:
                raise Fail(rc or ERROR, f"{lang_name(code)}: eleven.py couldn't price the narration: {msg_of(j)}")
        r_src = CHAR_RATIO.get(base_lang(src), UNMEASURED_RATIO)
        r_dst = CHAR_RATIO.get(base_lang(code), UNMEASURED_RATIO)
        chars = exact if exact is not None else orig_chars * r_dst / r_src
        tts = chars * per_char
        stt = math.ceil(STT_CREDITS_PER_MIN * vdur / 60) + math.ceil(STT_CREDITS_PER_MIN * PILOT_S / 60)
        allowance = RETRY_SHARE * (orig_chars * r_dst / r_src) * per_char
        done = ledger_totals(job, code)["committed"] if job else 0.0
        rows.append({"lang": code, "name": lang_name(code), "model": model, "chars": round(chars),
                     "exact": exact is not None, "measured_ratio": base_lang(code) in CHAR_RATIO,
                     "tts": round(tts), "stt": stt, "allowance": round(allowance),
                     "estimate": round(tts + stt + allowance), "spent_or_reserved": round(done), "notes": notes})
    total = sum(r["estimate"] for r in rows)
    spent = ledger_totals(job)["committed"] if job else 0.0
    cap_suggest = int(math.ceil((total + spent) / 1000.0) * 1000)
    account, problem = probe(v, voice_id, orig_model)
    if problem:
        raise Fail(problem[0], problem[1])
    vok, vwhy = voice_ok(voice_info(v, voice_id))
    say(f"Dubbed audio for {v.name}: the narration in {len(rows)} language{'s' if len(rows) != 1 else ''}, voice "
        f"{voice_name or voice_id} ({voice_id}), over the video's own music and effects; each track as long as the "
        f"video ({vdur:.2f} s, from {vsrc}).")
    for r in rows:
        how = "exact, from the translation" if r["exact"] else (
            "estimated from the original's length" + ("" if r["measured_ratio"] else ", ratio unmeasured"))
        say(f"  {r['name']:<22} {r['model']:<24} {num(r['chars']):>7} characters ({how}): about {num(r['estimate'])} "
            f"credits (speech {num(r['tts'])}, transcription checks {num(r['stt'])}, retries {num(r['allowance'])})")
        for n_ in r["notes"]:
            say(f"      {n_}")
    moved = [r for r in rows if r["model"] != orig_model]
    if moved:
        say(f"  The narration was made with {orig_model}, which doesn't speak {', '.join(r['name'] for r in moved)}: "
            f"{'they use' if len(moved) > 1 else 'it uses'} {', '.join(sorted({r['model'] for r in moved}))} with the same "
            "voice. The voice test is the first paid request there, and a language whose test fails stops.")
    rate_line = ("the list rate, 1 credit a character, the most ElevenLabs states for these models, at which every "
                 "request is reserved" + (f"; this account was billed {avg_rate:.2f} a character for the original "
                                          "narration, so it may cost less" if avg_rate and avg_rate < 0.95 else ""))
    if per_char > CREDITS_PER_CHAR_MAX:
        rate_line = f"{per_char:.2f} credits a character, what this voice was once billed"
    say(f"Estimate: about {num(total)} credits, at {rate_line}" + (f"; {num(spent)} spent or reserved so far." if spent
                                                                   else "."),
        f"A cap of {num(cap_suggest)} credits covers it" + (f" (the approved cap is {num(job['cap'])})." if job else "."))
    for x in account:
        say(x)
    if not vok:
        say(f"No dub with this voice can be approved: {vwhy}. Offer the packages; a dub needs a voice the account owns "
            "or one of ElevenLabs' own, and which is the director's choice.")
    res = {"video": v.name, "voice": {"id": voice_id, "name": voice_name, "rate_known": vok, "why": vwhy},
           "from": src, "model": orig_model, "duration": vdur, "rows": rows, "estimate": total, "spent": round(spent),
           "cap_suggested": cap_suggest, "billed_rate": avg_rate, "rate_reserved": per_char, "account": account}
    if a.approve is not None:
        if not a.approve.strip():
            raise usage("--approve takes the director's own words, as they gave their yes")
        if a.cap is None:
            raise usage("--approve needs --cap N: the most the batch may spend, as the director agreed it")
        if not vok:
            raise Fail(SCOPE, f"no job with this voice: {vwhy}")
        with JobLock(v):
            job = load_job(v, need=False)
            spent = ledger_totals(job)["committed"] if job else 0.0
            if a.cap < spent:
                raise usage(f"--cap {a.cap}: {num(spent)} credits are already spent or reserved")
            new = job or {"tool": TOOL, "version": VERSION, "ledger": []}
            new.update({"approved": now(), "words": a.approve.strip(), "from": src, "cap": int(a.cap),
                        "voice": {"id": voice_id, "name": voice_name, "rate_known": vok, "why": vwhy},
                        "settings": {"voice_settings": (cfg or {}).get("voice_settings") or {},
                                     "lufs": (cfg or {}).get("lufs"), "from": v.rel(cfg_path) if cfg_path else None},
                        "sources": o.fingerprint()})
            # a new yes with its cap lifts what stopped on the old cap; a request that may have been billed, or a voice
            # test that failed, stays stopped
            new["stopped"] = [x for x in stops(new) if x["kind"] not in ("cap", "share")]
            # every language the job ever had stays in it (its ledger and stops with it); the scope is this yes's
            new.setdefault("languages", {})
            for r in rows:
                ls = {**new["languages"].get(r["lang"], {}), "model": r["model"],
                      "estimate": r["estimate"] + r["spent_or_reserved"]}
                ls["stopped"] = [x for x in stops(ls) if x["kind"] != "share"]
                new["languages"][r["lang"]] = ls
            new["scope"] = [r["lang"] for r in rows]
            share_out(new)
            new.setdefault("history", []).append({"at": new["approved"], "words": new["words"], "cap": new["cap"],
                                                  "languages": list(new["languages"])})
            write_json(v.job_path, new)
        say(f"Approved: {v.rel(v.job_path)} ({len(rows)} languages, cap {num(a.cap)} credits, in the director's words: "
            f"\"{new['words']}\").")
        res["job"] = v.rel(v.job_path)
    elif job is not None and not a.langs:
        # after the translations: the updated estimate within the same approved cap, and the shares again
        with JobLock(v):
            job = load_job(v)
            spent = ledger_totals(job)["committed"]
            for r in rows:
                r["spent_or_reserved"] = round(ledger_totals(job, r["lang"])["committed"])
            if total + spent > float(job["cap"]):
                raise Fail(SCOPE, f"the updated estimate ({num(total)} credits, plus {num(spent)} spent) passes the "
                                  f"approved cap of {num(job['cap'])}: ask the director before spending")
            for r in rows:  # (what a language has spent or reserved stays in its share)
                job["languages"][r["lang"]]["estimate"] = r["estimate"] + r["spent_or_reserved"]
            share_out(job)
            write_json(v.job_path, job)
        say(f"An updated estimate within the approved cap of {num(job['cap'])} credits; each language's share updated "
            f"in {v.rel(v.job_path)}.")
    return res


def probe(v: Video, voice_id: str, model: str) -> tuple[list[str], tuple[int, str] | None]:
    """Free: the voice is in the account, and what the account has left (eleven.py prices a word, spends nothing)."""
    d = v.review / "probe"
    d.mkdir(parents=True, exist_ok=True)
    s = d / "probe.txt"
    s.write_text("Hello.\n", encoding="utf-8", newline="\n")
    rc, j = eleven(["tts", v.rel(s), "--out", v.rel(d), "--voice", voice_id, "--model", model], v)
    if rc in (CONFIRM, OK):
        return list(j.get("account") or []), None
    if rc == NO_KEY:
        return [], (NO_KEY, "no ElevenLabs key in the environment (ELEVENLABS_API_KEY): a dub can't be priced against "
                            "the account or made; the packages and subtitles need none")
    return [], (rc or ERROR, f"the voice {voice_id}: {msg_of(j)}")


def share_out(job: dict) -> None:
    """Each language's share of the cap, in proportion to its estimate (what it has spent counts in it); a language
    outside the scope keeps what it spent and no more."""
    scope = job.get("scope", list(job["languages"]))
    out = {c: ledger_totals(job, c)["committed"] for c in job["languages"] if c not in scope}
    total = sum(float(job["languages"][c].get("estimate") or 0) for c in scope) or 1.0
    room = float(job["cap"]) - sum(out.values())
    for code, x in job["languages"].items():
        x["share"] = round(room * float(x.get("estimate") or 0) / total, 1) if code in scope else round(out[code], 1)


# ------------------------------------------------------------------------------------------------ speak and hear

def cmd_speak(a) -> dict:
    v = Video(a.video)
    lang = Lang(v, a.lang)
    o = Original(v)
    notes = check_translation(o, lang)
    if a.pick is not None:  # free: a take already paid for becomes the block's file
        job = load_job(v)
        check_scope(v, job, lang)
        if a.block is None:
            raise usage("--pick K needs --block N")
        rc, j = eleven(tts_args(lang, job, ["--pick", str(a.pick), "--block", str(a.block)]), v)
        if rc:
            raise Fail(rc, msg_of(j))
        say(f"{lang_name(lang.code)}: take {a.pick} of block {a.block} kept (free).")
        return assemble(v, lang, job)
    made = []
    with JobLock(v):
        job = load_job(v)
        settle_pending(v, job)  # (a run that died mid-request: certain only now, holding the lock)
        ls = check_scope(v, job, lang)
        if job.get("sources") != o.fingerprint():
            note("the video's words, mix or render changed since the job was approved: placement and mixes are made "
                 "again (free); new narration only for paragraphs whose text changed")
        if a.takes is not None:
            if a.block is None:
                raise usage("--takes K needs --block N")
            plan_args = ["--takes", str(a.takes), "--block", str(a.block)]
            rc, j = eleven(tts_args(lang, job, plan_args), v)
            if rc == OK:
                say(f"{lang_name(lang.code)}: those takes of block {a.block} exist already (free).")
                return j
            if rc != CONFIRM:
                raise Fail(rc or ERROR, f"{lang_name(lang.code)}: {msg_of(j)}")
            files = [(x["file"], int(x.get("characters", 0))) for x in j.get("jobs") or []]
            e = reserve(v, job, lang.code, f"{lang.code} block {a.block}: {len(files)} more take(s)", "tts",
                        sum(c for _, c in files) * char_rate(job))
            run_paid(v, job, lang, e, plan_args, files)
            say(f"{lang_name(lang.code)}: takes of block {a.block} made; compare them (hear --test {a.block} after "
                f"picking one), then --pick K --block {a.block}.")
            return {"lang": lang.code, "takes": a.takes, "block": a.block}
        rc, j = eleven(tts_args(lang, job, []), v)
        if rc == NO_KEY:
            raise Fail(NO_KEY, f"no ElevenLabs key: {msg_of(j)}")
        if rc not in (OK, CONFIRM):
            raise Fail(rc or ERROR, f"{lang_name(lang.code)}: {msg_of(j)}")
        jobs = (j.get("jobs") or []) if rc == CONFIRM else []
        if a.test is not None:
            jobs = [x for x in jobs if block_of(x) == a.test]
            if not jobs:
                say(f"{lang_name(lang.code)}: block {a.test} exists already (free).")
        elif jobs:
            pilot = read_json(lang.pilot) or {}
            paras = paragraphs(lang.narration_txt)
            b = pilot.get("block")
            if (not pilot.get("pass") or sha256(Path(v.root / pilot.get("file", "-"))) != pilot.get("file_sha256")
                    or pilot.get("voice") != job["voice"]["id"] or pilot.get("model") != ls.get("model")
                    or any(block_of(x) == b for x in jobs)
                    or not isinstance(b, int) or not 1 <= b <= len(paras) or pilot.get("text") != paras[b - 1]):
                raise Fail(SCOPE, f"{lang_name(lang.code)}: the voice test hasn't passed yet. Make it on the hardest "
                                  f"paragraph (speak --lang {lang.code} --test N), check it (hear --lang {lang.code} "
                                  "--test N), then make the rest")
        for x in jobs:
            n, chars = block_of(x), int(x.get("characters", 0))
            e = reserve(v, job, lang.code, f"{lang.code} block {n}", "tts", chars * char_rate(job))
            run_paid(v, job, lang, e, ["--only", str(n)], [(x["file"], chars)])
            made.append(n)
            say(f"  {lang_name(lang.code)} block {n}: made ({chars} characters; ledger entry {e['id']}: "
                f"{e['status']}, {num(e.get('billed') or 0)} billed)")
        t, total = ledger_totals(job, lang.code), ledger_totals(job)
    res = assemble(v, lang, job) if a.test is None else {"lang": lang.code, "made": made}
    say(f"{lang_name(lang.code)}: {len(made)} block(s) made this run; {num(t['committed'])} of its "
        f"{num(ls.get('share') or 0)} credit share used ({num(total['committed'])} of the cap's {num(job['cap'])}).")
    if a.test is not None and made:
        say(f"  Next: hear --video {v.name} --lang {lang.code} --test {a.test} (what the take says, and in which "
            "language), before the rest.")
    for n_ in notes:
        say(f"  {n_}")
    return res


def block_of(job_row: dict) -> int:
    m = re.search(r"(?:^|/)(\d+)-[^/]*$", str(job_row.get("file", "")))
    if m:
        return int(m.group(1))
    m = re.search(r"(\d+)", str(job_row.get("label", "")))
    if not m:
        raise Fail(ERROR, f"eleven.py's plan names a block dub.py can't read: {job_row}")
    return int(m.group(1))


def run_paid(v: Video, job: dict, lang: Lang, e: dict, extra: list[str], files: list[tuple[str, int]]) -> None:
    """Send the reserved requests (eleven.py makes them in order and stops at the first that fails), then settle the
    ledger from what arrived: the files that came are billed as their records say; the first that didn't may have
    been billed unless the server answered no, and stays reserved; the rest were never sent."""
    rc, j = eleven(tts_args(lang, job, extra + ["--yes"]), v)
    why = msg_of(j)[:300]
    billed, made, chars_made = 0.0, [], 0
    for f, chars in files:
        p = v.root / f
        rec = read_json(p.with_name(p.stem + ".request.json"))
        if isinstance(rec, dict) and rec.get("generated", "") >= e["at"]:
            made.append(f)
            chars_made += chars
            try:
                billed += float((rec.get("response") or {}).get("character_cost"))
            except (TypeError, ValueError):
                billed += chars * char_rate(job)
    missing = [(f, c) for f, c in files if f not in made]
    # the whole settlement is made in memory and written once, so an interruption leaves either the reservation
    # (settled later as possibly charged) or all of it
    possibly = None
    if made:
        e.update(status="done", settled=now(), billed=billed, **({"why": why} if missing or rc else {}))
        learn_rate(job, billed, chars_made)
    if missing and not surely_not_billed(rc, j):
        f0, c0 = missing[0]
        most0 = round(c0 * char_rate(job), 1)
        if made:  # the requests that arrived stay billed; the one that failed gets an entry of its own
            possibly = {"id": len(job["ledger"]) + 1, "lang": lang.code, "what": f"{e['what']} ({Path(f0).name})",
                        "kind": "tts", "max": most0, "status": "possibly charged", "at": e["at"], "settled": now(),
                        "why": why}
            job["ledger"].append(possibly)
        else:
            e.update(status="possibly charged", settled=now(), max=most0, why=why)
            possibly = e
        stop_lang(job, lang.code, f"{possibly['what']}: {why[:200]} (counted as spent: up to {num(possibly['max'])} "
                                  "credits; never sent again by itself)")
    elif missing and not made:
        e.update(status="not charged", settled=now(), billed=0.0, why=why)
    out_of_credits = missing and surely_not_billed(rc, j) and ("insufficient" in why.lower() or "HTTP 402" in why)
    if out_of_credits:
        stop(job, f"the account is out of credits ({why[:160]})", "cap")
    write_json(v.job_path, job)
    if made:
        over_cap(v, job)
    if not missing:
        return
    if possibly is not None:
        raise Fail(SCOPE, f"{lang_name(lang.code)} stopped: {possibly['what']} may have been billed without its audio "
                          "arriving (counted as spent); the other languages go on")
    if out_of_credits:
        raise Fail(SCOPE, f"the account is out of credits ({why[:200]}): nothing more can be made until the director "
                          "tops it up")
    raise Fail(rc or ERROR, f"{lang_name(lang.code)}: {msg_of(j)}")


def take_inputs(lang: Lang, job: dict) -> dict:
    """What a language's narration is made from: the text, the respellings, the voice, its model and settings."""
    ls = (job.get("languages") or {}).get(lang.code) or {}
    return {"narration": sha256(lang.narration_txt), "say": sha256(lang.say), "voice": (job.get("voice") or {}).get("id"),
            "model": ls.get("model"), "settings": job.get("settings")}


def assemble(v: Video, lang: Lang, job: dict) -> dict:
    rc, j = eleven(tts_args(lang, job, []), v)
    if rc == OK and lang.take_wav.is_file() and lang.take_words.is_file():
        write_json(lang.take, {"tool": TOOL, "at": now(), "inputs": take_inputs(lang, job),
                               "narration_wav": sha256(lang.take_wav), "words": sha256(lang.take_words)})
        say(f"{lang_name(lang.code)}: {v.rel(lang.take_wav)} and {v.rel(lang.take_words)} are up to date.")
        return {"lang": lang.code, "narration": v.rel(lang.take_wav), "words": v.rel(lang.take_words)}
    missing = len(j.get("jobs") or [])
    say(f"{lang_name(lang.code)}: {missing} block(s) still to make before the narration is assembled.")
    return {"lang": lang.code, "missing": missing}


# ISO 639-1 to the 639-3 (and older 639-2/B) codes a transcriber may answer with, for every language the models
# here speak and a few more; 639-3 macrolanguages with their usual individual codes.
ISO3 = {"af": "afr", "am": "amh", "ar": "ara arb", "as": "asm", "az": "aze azj", "be": "bel", "bg": "bul", "bn": "ben",
        "bs": "bos", "ca": "cat", "cs": "ces cze", "cy": "cym wel", "da": "dan", "de": "deu ger", "el": "ell gre",
        "en": "eng", "es": "spa", "et": "est ekk", "fa": "fas per pes", "fi": "fin", "fr": "fra fre", "ga": "gle",
        "gl": "glg", "gu": "guj", "ha": "hau", "he": "heb", "hi": "hin", "hr": "hrv", "hu": "hun", "hy": "hye arm",
        "id": "ind", "is": "isl ice", "it": "ita", "ja": "jpn", "jv": "jav", "ka": "kat geo", "kk": "kaz", "kn": "kan",
        "ko": "kor", "ky": "kir", "lb": "ltz", "ln": "lin", "lt": "lit", "lv": "lav lvs", "mk": "mkd mac", "ml": "mal",
        "mn": "mon khk", "mr": "mar", "ms": "msa may zsm", "mt": "mlt", "my": "mya bur", "ne": "nep npi",
        "nl": "nld dut", "no": "nor nob nno", "nb": "nob nor", "pa": "pan", "pl": "pol", "ps": "pus pbt",
        "pt": "por", "ro": "ron rum", "ru": "rus", "sd": "snd", "sk": "slk slo", "sl": "slv", "so": "som", "sr": "srp",
        "sv": "swe", "sw": "swa swh", "ta": "tam", "te": "tel", "tg": "tgk", "th": "tha", "tr": "tur", "uk": "ukr",
        "ur": "urd", "uz": "uzb uzn", "vi": "vie", "zh": "zho chi cmn yue", "fil": "fil tgl", "tl": "tgl fil",
        "yue": "yue zho", "ceb": "ceb", "ast": "ast"}


def same_language(heard: str | None, base: str) -> bool | None:
    """Whether a transcriber's language code is this language: None when it can't tell (no code, or one this table
    doesn't know), so only a known other language fails a voice test."""
    if not heard:
        return None
    h = heard.lower().split("-")[0].split("_")[0]
    mine = {base, *ISO3.get(base, "").split()}
    if h in mine:
        return True
    known = {c for k, v in ISO3.items() for c in (k, *v.split())}
    return False if h in known else None


def paid_stt(v: Video, lang: Lang, args: list[str], what: str, secs: float) -> dict:
    """A transcription through the job: free when eleven.py has it already (it keeps each by the audio's hash)."""
    rc, j = eleven(args, v)
    if rc == OK:
        return j
    if rc != CONFIRM:
        raise Fail(rc or ERROR, msg_of(j))
    with JobLock(v):
        job = load_job(v)
        settle_pending(v, job)
        check_scope(v, job, lang)
        e = reserve(v, job, lang.code, what, "stt", math.ceil(STT_CREDITS_PER_MIN * secs / 60))
        rc, j = eleven(args + ["--yes"], v)
        if rc == OK:
            settle(v, job, e, "done", float(e["max"]))
            return j
        if surely_not_billed(rc, j):
            settle(v, job, e, "not charged", 0.0, why=msg_of(j)[:300])
            raise Fail(rc or ERROR, msg_of(j))
        settle(v, job, e, "possibly charged", why=msg_of(j)[:300])
        stop_lang(job, lang.code, f"{e['what']}: {msg_of(j)[:200]} (counted as spent)")
        write_json(v.job_path, job)
        raise Fail(SCOPE, f"{lang_name(lang.code)} stopped: the transcription may have been billed without an answer "
                          "(counted as spent)")


def cmd_hear(a) -> dict:
    v = Video(a.video)
    lang = Lang(v, a.lang)
    check_scope(v, load_job(v), lang)
    if a.test is not None:
        return hear_pilot(v, lang, a.test)
    if not lang.voice.is_file() or not lang.placed.is_file():
        raise usage(f"place the voice first: dub.py place --video {v.name} --lang {lang.code}")
    args = ["stt", v.rel(lang.voice), "--out", v.rel(lang.dir), "--expect", v.rel(lang.placed), "--language", lang.base]
    j = paid_stt(v, lang, args, f"{lang.code} transcription of the placed voice", float(sf.info(str(lang.voice)).duration))
    placed = read_json(lang.placed) or {}
    expected = " ".join(str(w.get("spoken") or w.get("w", "")) for l in placed.get("lines") or [] for w in l.get("words") or [])
    heard_text = str(j.get("transcript") or "")
    ratio = difflib.SequenceMatcher(None, norm(expected), norm(heard_text), autojunk=False).ratio()
    res = {"lang": lang.code, "similarity": round(ratio, 3), "language_heard": j.get("language"),
           "same_language": same_language(j.get("language"), lang.base),
           "matched_words": j.get("matched"), "expected_words": j.get("expected_words"),
           "differences": (j.get("differences") or [])[:60], "voice_sha256": sha256(lang.voice), "at": now()}
    write_json(lang.heard, res)
    say(f"{lang_name(lang.code)}: the placed voice heard as {j.get('language') or '?'}; its text matches what it should "
        f"say at {ratio * 100:.1f}% by characters" + (f", {j.get('matched')} of {j.get('expected_words')} words"
                                                       if j.get("expected_words") else "") + ".")
    for d in res["differences"][:12]:
        at = f" at {float(d['at']):.2f} s" if d.get("at") is not None else ""
        say(f"  expected \"{d.get('expected')}\", heard \"{d.get('heard')}\"{at}")
    if ratio < 0.85:
        say("  Under 85%: words may be missing, repeated or cut. Find the block (its time above), make it again on a "
            "new seed (speak --block N --takes 2) or shorten it, place, and hear again.")
    return res


def hear_pilot(v: Video, lang: Lang, n: int) -> dict:
    """The voice test checked before the rest is bought: block n transcribed, in its language, against its text."""
    paras = paragraphs(lang.narration_txt) if lang.narration_txt.is_file() else []
    if not 1 <= n <= len(paras):
        raise usage(f"block {n}: youtube/{lang.code}/narration.txt has {len(paras)} paragraphs")
    want = paras[n - 1]
    # the block's take of the paragraph as it reads now (a paragraph rewritten leaves its old take beside the new one
    # until the whole narration is assembled); the newest when there are several
    cands = []
    for p in lang.blocks.glob("*"):
        if p.suffix not in (".mp3", ".wav", ".pcm", ".opus") or not re.match(rf"0*{n}-", p.name):
            continue
        r = read_json(p.with_name(p.stem + ".request.json")) or {}
        if " ".join(str(r.get("shown_text") or "").split()) == want:
            cands.append((str(r.get("generated") or ""), p, r))
    if not cands:
        raise usage(f"block {n} isn't made for the paragraph as it reads now: speak --video {v.name} --lang {lang.code} "
                    f"--test {n}")
    _, f, rec = max(cands, key=lambda x: x[0])
    spoken = str(((rec.get("request") or {}).get("body") or {}).get("text") or rec.get("shown_text") or "")
    exp = lang.dir / "out" / f"pilot-{n}.txt"
    exp.parent.mkdir(parents=True, exist_ok=True)
    exp.write_text(spoken + "\n", encoding="utf-8", newline="\n")
    # (no language given: the transcriber's own detection is what tells a take in the wrong language)
    args = ["stt", v.rel(f), "--out", v.rel(lang.dir), "--expect", v.rel(exp)]
    j = paid_stt(v, lang, args, f"{lang.code} voice test, block {n}", float(sf.info(str(f)).duration)
                 if f.suffix in (".wav",) else len(decode(f)) / SR)
    ratio = difflib.SequenceMatcher(None, norm(spoken), norm(str(j.get("transcript") or "")), autojunk=False).ratio()
    same = same_language(j.get("language"), lang.base)
    ok = ratio >= 0.85 and same is not False
    old = read_json(lang.pilot) or {}
    fails = int(old.get("fails", 0)) + (0 if ok else 1) if old.get("file_sha256") != sha256(f) else int(old.get("fails", 0))
    body = (rec.get("request") or {}).get("body") or {}
    res = {"block": n, "file": v.rel(f), "file_sha256": sha256(f), "text": want, "similarity": round(ratio, 3),
           "voice": str((rec.get("request") or {}).get("path", "")).split("/")[3:4][0] if (rec.get("request") or {}).get("path") else None,
           "model": body.get("model_id"),
           "language_heard": j.get("language"), "same_language": same, "pass": ok, "fails": fails, "at": now()}
    write_json(lang.pilot, res)
    say(f"{lang_name(lang.code)}: the voice test (block {n}) heard as {j.get('language') or '?'}, its text at "
        f"{ratio * 100:.1f}%: " + ("passed; make the rest." if ok else "failed."))
    if not ok and fails >= 2:
        with JobLock(v):
            job = load_job(v)
            stop_lang(job, lang.code, f"the voice test failed twice (block {n}: {ratio * 100:.0f}% of its text, heard "
                                      f"as {j.get('language') or '?'}): another take, model or voice is the director's "
                                      "call", "pilot")
            write_json(v.job_path, job)
        raise Fail(SCOPE, f"{lang_name(lang.code)} stopped: its voice test failed twice; the other languages go on")
    if not ok:
        say(f"  Make another take (speak --lang {lang.code} --block {n} --takes 2, then --pick 2 --block {n}) and hear "
            "it again; a second failure stops this language.")
    return res


# ------------------------------------------------------------------------------------------------ place

def placement_inputs(o: Original, lang: Lang) -> dict:
    """Everything a placement is made from: if any of it changes, the voice is placed (and mixed) again."""
    return {"take": sha256(lang.take_wav), "take_words": sha256(lang.take_words), "original": o.fingerprint(),
            "anchors": sha256(lang.anchors), "levels": sha256(lang.levels), "tool": sha256(Path(__file__))}


def take_stale(lang: Lang, job: dict | None = None) -> str | None:
    """Whether the narration made in a language is still what its translation, respellings, voice and settings make
    (anything changed since: speak, which makes only what changed)."""
    if not lang.narration_txt.is_file() or not lang.take_words.is_file():
        return None
    job = job if job is not None else (read_json(lang.v.job_path) or {})
    t = read_json(lang.take) or {}
    if job and (t.get("inputs") != take_inputs(lang, job) or t.get("narration_wav") != sha256(lang.take_wav)
                or t.get("words") != sha256(lang.take_words)):
        changed = [k for k, val in take_inputs(lang, job).items() if (t.get("inputs") or {}).get(k) != val] or \
            ["the narration's files"]
        return f"the narration made in this language predates a change of its {', '.join(changed)}: speak again"
    said = ["".join(str(w.get("w", "")) for w in l.get("words") or []) for l in (read_json(lang.take_words) or {}).get("lines") or []]
    text = ["".join(p.split()) for p in paragraphs(lang.narration_txt)]
    if [re.sub(r"\s", "", x) for x in said] != text:
        k = next((i for i, (a_, b_) in enumerate(zip(said, text)) if re.sub(r"\s", "", a_) != b_), min(len(said), len(text)))
        return (f"the narration made in this language doesn't say youtube/{lang.code}/narration.txt any more (from paragraph "
                f"{k + 1}): speak again (only what changed is made)")
    return None


def freshness(o: Original, lang: Lang) -> list[str]:
    """What is out of date in a language's dub, step by step: [] when its track is made from what is there now."""
    out = []
    t = take_stale(lang)
    if t:
        out.append(t)
    pl = read_json(lang.placement) or {}
    if not lang.voice.is_file() or not pl:
        return out + ["the voice isn't placed yet (place)"]
    if pl.get("inputs") != placement_inputs(o, lang):
        changed = [k for k, val in placement_inputs(o, lang).items() if (pl.get("inputs") or {}).get(k) != val]
        out.append(f"placed before {', '.join(changed)} changed (place again)")
    if pl.get("voice_sha256") != sha256(lang.voice) or pl.get("words_sha256") != sha256(lang.placed):
        out.append("the placed voice or its words changed since placing (place again)")
    rec = read_json(lang.mix_rec) or {}
    if not lang.mix_wav.is_file() or not rec:
        return out + ["no track yet (mix)"]
    if (rec.get("outputs") or {}).get("mix.wav") != sha256(lang.mix_wav):
        out.append("mix.wav isn't the file its record describes (mix again)")
    if (rec.get("inputs") or {}).get(lang.v.rel(lang.voice)) != sha256(lang.voice) or \
            (rec.get("data") or {}).get(lang.v.rel(lang.placed)) != sha256(lang.placed):
        out.append("mixed from an earlier placement (mix again)")
    return out

def cmd_place(a) -> dict:
    tool("ffmpeg")
    v = Video(a.video)
    lang = Lang(v, a.lang)
    o = Original(v)
    if not lang.take_wav.is_file() or not lang.take_words.is_file():
        raise usage(f"{v.rel(lang.take_wav)} isn't made yet: dub.py speak --video {v.name} --lang {lang.code}")
    take = read_json(lang.take_words) or {}
    D = word_lines(take)
    if len(D) != len(o.lines):
        raise usage(f"the {lang_name(lang.code)} narration has {len(D)} paragraphs and the original {len(o.lines)} "
                    "lines: one paragraph per line, in order")
    inputs = placement_inputs(o, lang)
    stale = take_stale(lang)
    if stale:
        raise usage(f"{lang_name(lang.code)}: {stale}")
    old = read_json(lang.placement) or {}
    if (not a.force and old.get("inputs") == inputs and sha256(lang.voice) == old.get("voice_sha256")
            and sha256(lang.placed) == old.get("words_sha256")):
        report_place(v, lang, old, up_to_date=True)
        return old
    y = decode(lang.take_wav)
    dur, dur_from = o.video_duration()  # (the length verify holds the track to: the final render's, else the mix's)
    issues, notes = [], []
    if abs(dur - o.duration) > 1e-3:
        notes.append(f"the track is {dur:.3f} s long, as {dur_from} is; the video's mix is {o.duration:.3f} s")

    # pieces: sentence for sentence where the counts match, else the whole line; what the video doesn't play
    # (before 0 s, outside the narration's block, after the video's end) is left out
    plays_from, plays_to = o.window
    pieces = []
    for i, (ol, dl) in enumerate(zip(o.lines, D)):
        if not dl["words"]:
            continue
        ds, os_ = sentences(dl["words"]), ol["sentences"]
        if os_ and len(ds) == len(os_):
            for k, (src, dst) in enumerate(zip(os_, ds)):
                # (by its words: its span may reach into what the video plays through a pause, none of it heard)
                if not any(heard(w["start"], w["end"], o.window) for w in src):
                    notes.append(f"line {i + 1}, sentence {k + 1}: the video doesn't play it (its mix or its end "
                                 "cuts the narration there), so its translation isn't placed")
                    continue
                pieces.append({"line": i, "k": k, "words": dst, "target": max(plays_from, src[0]["start"]), "why": "sentence",
                               "orig_end": min(plays_to, src[-1]["end"])})
        else:
            if ol.get("trimmed") and ol["start"] is not None:
                issues.append(f"line {i + 1}: the video plays only part of it and its translation has {len(ds)} "
                              f"sentences against the original's {len(os_)}, so the part the video doesn't play can't "
                              "be left out: match them one for one")
                continue
            if ol["start"] is None:
                notes.append(f"line {i + 1}: the video plays none of the original line (its mix or its end cuts the "
                             "narration there), so its translation isn't placed")
                continue
            pieces.append({"line": i, "k": 0, "words": dl["words"], "target": ol["start"], "why": "line",
                           "orig_end": ol["end"]})
            if os_:
                notes.append(f"line {i + 1}: {len(ds)} sentences against the original's {len(os_)}: placed as one piece "
                             "from the line's start")

    # anchors: words the picture follows
    anchors = []
    for row in read_tsv(lang.anchors, 3, "line, original words, translated words"):
        try:
            li = int(row[0]) - 1
        except ValueError:
            raise usage(f"anchors.tsv: {row[0]!r} is not a line number (1 is the narration's first line)")
        if not 0 <= li < len(o.lines):
            raise usage(f"anchors.tsv: line {row[0]} doesn't exist (the narration has {len(o.lines)})")
        otext, on = split_nth(row[1])
        dtext, dn = split_nth(row[2])
        oi = find_seq(o.lines[li]["words"], otext, on)
        di = find_seq(D[li]["words"], dtext, dn)
        a_ = {"line": li + 1, "original": row[1], "translated": row[2]}
        if oi is None or di is None:
            issues.append(f"anchor on line {li + 1}: {'\"' + row[1] + '\" is not in the original line' if oi is None else ''}"
                          f"{' and ' if oi is None and di is None else ''}"
                          f"{'\"' + row[2] + '\" is not in the translated line' if di is None else ''}")
            continue
        a_.update(T=o.lines[li]["words"][oi]["start"], word=D[li]["words"][di])
        anchors.append(a_)
        for p in [p for p in pieces if p["line"] == li]:
            idx = next((k for k, w in enumerate(p["words"]) if w is a_["word"]), None)
            if idx is None:
                continue
            if idx == 0:
                p["target"], p["why"] = a_["T"], "anchor"
            else:
                gap = p["words"][idx]["start"] - p["words"][idx - 1]["end"]
                if gap >= SPLIT_PAUSE:
                    tail = {**p, "words": p["words"][idx:], "target": a_["T"], "why": "anchor", "k": p["k"] + 0.5}
                    p["words"] = p["words"][:idx]
                    pieces.insert(pieces.index(p) + 1, tail)
                else:
                    p["target"] = a_["T"] - (p["words"][idx]["start"] - p["words"][0]["start"])
                    p["why"] = "anchor (shifted)"
            break

    # place, in order
    take_words = [w for l in D for w in l["words"]]
    pos = {id(w): k for k, w in enumerate(take_words)}
    cursor = 0.0
    placed = []
    for j, p in enumerate(pieces):
        w0, w1 = p["words"][0], p["words"][-1]
        s0, s1 = w0["start"], w1["end"]
        k0, k1 = pos[id(w0)], pos[id(w1)]
        prev_end = take_words[k0 - 1]["end"] if k0 > 0 else 0.0
        next_start = take_words[k1 + 1]["start"] if k1 + 1 < len(take_words) else len(y) / SR
        cin = quietest(y, max(prev_end, s0 - PAD_IN - 0.05), max(s0 - 0.01, max(prev_end, s0 - PAD_IN - 0.05) + 0.011))
        cin = min(cin, s0)
        cout = quietest(y, min(s1 + 0.01, next_start), min(next_start, s1 + PAD_OUT) + 0.011)
        cout = max(cout, s1)
        nxt = pieces[j + 1] if j + 1 < len(pieces) else None
        same_line = nxt is not None and nxt["line"] == p["line"]
        if nxt is not None:
            og = nxt["target"] - p["orig_end"]
            gap = min(GAP_IN_LINE if same_line else GAP_LINES, max(0.06, og))
            limit = nxt["target"] - gap
        else:
            gap = 0.0
            limit = dur - END_ROOM
        sound = s1 - s0
        start = max(p["target"], cursor)
        lead, tempo = 0.0, 1.0
        if start + sound > limit:
            if start <= p["target"] + 1e-6:
                lead = min(LEAD_MAX, max(0.0, p["target"] - cursor), start + sound - limit)
                start -= lead
            if start + sound > limit and limit > start:
                tempo = min(TEMPO_MAX, sound / (limit - start))
        end = start + sound / tempo
        # (the next sentence may start a little late; the video's end may not move at all)
        slip_next = (end + gap - nxt["target"]) if nxt is not None else max(0.0, end - (dur - END_ROOM))
        allowed = SLIP_MAX if nxt is not None else 0.0
        row = {"line": p["line"] + 1, "piece": round(p["k"], 1), "why": p["why"], "text": " ".join(str(w["w"]) for w in p["words"]),
               "target": round(p["target"], 3), "start": round(start, 3), "end": round(end, 3),
               "lead": round(lead, 3), "slip": round(max(0.0, start - p["target"]), 3), "tempo": round(tempo, 4),
               "src": [round(cin, 3), round(s0, 3), round(s1, 3), round(cout, 3)]}
        if slip_next > allowed + 1e-6:
            need = slip_next - allowed
            cps = len(row["text"]) / max(0.2, sound)
            row["misfit"] = round(need, 2)
            issues.append(f"line {row['line']}: \"{short(row['text'])}\" runs {need:.2f} s too long for its place ("
                          + (f"it would push the next sentence {slip_next:.2f} s late, past {SLIP_MAX:g} s"
                             if nxt is not None else f"it would end {slip_next:.2f} s after the video leaves it room")
                          + f", even {int(round((tempo - 1) * 100))}% faster): about "
                          f"{max(1, int(round(need * cps * tempo)))} characters shorter, or anchors that give it room")
        peak_db = float(frame_db(y, int(s0 * SR), int(s1 * SR)).max()) if s1 > s0 + 0.01 else 0.0
        for edge, t_ in (("start", cin), ("end", cout)):
            at_db = frame_db(y, int(t_ * SR) - SR // 200, int(t_ * SR) + SR // 200)
            if len(at_db) and float(at_db.max()) > peak_db - 30:
                notes.append(f"line {row['line']}: \"{short(row['text'], 30)}\" is cut at its {edge} where the voice still "
                             f"sounds ({float(at_db.max()) - peak_db:+.0f} dB from its loudest): listen there")
        placed.append(row)
        p["placed"] = row
        cursor = end + gap

    # the anchors as placed
    for a_ in anchors:
        p = next((p for p in pieces if any(w is a_["word"] for w in p["words"])), None)
        if p is None or "placed" not in p:
            continue
        r = p["placed"]
        t = r["start"] + (a_["word"]["start"] - p["words"][0]["start"]) / r["tempo"]
        a_["placed"] = round(t, 3)
        a_["off"] = round(t - a_["T"], 3)
        if abs(t - a_["T"]) > ANCHOR_TOL:
            issues.append(f"anchor on line {a_['line']}: \"{a_['translated']}\" lands at {t:.2f} s, {t - a_['T']:+.2f} s "
                          f"from \"{a_['original']}\" ({a_['T']:.2f} s), past {ANCHOR_TOL:g} s")

    # levels: each line as loud as the original line, then any change by hand
    lifts = {}
    for row in read_tsv(lang.levels, 2, "line, dB, why"):
        try:
            lifts[int(row[0]) - 1] = float(row[1])
        except ValueError:
            raise usage(f"levels.tsv: {row[0]!r} {row[1]!r}: a line number and a level in dB (+1.5)")
    orig_voice = o.voice_track()
    if orig_voice is None:
        notes.append("the original voice couldn't be read from the mix plan: the lines keep the narration's own "
                     "levels (eleven.py made it at the original's loudness)")
    gains = {}
    for i, ol in enumerate(o.lines):
        segs = [y[int(r["src"][1] * SR):int(r["src"][2] * SR)] for p, r in ((p, p["placed"]) for p in pieces)
                if p["line"] == i and "placed" in p]
        ld = lufs(np.concatenate(segs)) if segs else None
        lo = lufs(orig_voice[int(ol["start"] * SR):int(ol["end"] * SR)]) if orig_voice is not None and ol["start"] is not None else None
        g = float(np.clip(lo - ld, -LEVEL_CLAMP, LEVEL_CLAMP)) if lo is not None and ld is not None else 0.0
        if lo is not None and ld is not None and abs(lo - ld) > LEVEL_CLAMP:
            notes.append(f"line {i + 1}: {lo - ld:+.1f} dB from the original line's level, held to {g:+.1f}")
        gains[i] = {"original_lufs": None if lo is None else round(lo, 2), "dub_lufs": None if ld is None else round(ld, 2),
                    "matched_db": round(g, 2), "by_hand_db": lifts.get(i, 0.0), "gain_db": round(g + lifts.get(i, 0.0), 2)}

    # render the voice and its words
    n = int(round(dur * SR))
    out = np.zeros(n, np.float32)
    words_out = [{"i": i, "text": dl["text"], "sourceText": ol["text"], "start": None, "end": None, "words": []}
                 for i, (ol, dl) in enumerate(zip(o.lines, D))]
    for p in pieces:
        if "placed" not in p:
            continue
        r = p["placed"]
        cin, s0, s1, cout = r["src"]
        seg = y[int(round(cin * SR)):int(round(cout * SR))].copy()
        seg = stretch(seg, r["tempo"])
        f = min(len(seg) // 2, int(FADE * SR))
        if f > 0:
            ramp = np.linspace(0, 1, f, dtype=np.float32)
            seg[:f] *= ramp
            seg[-f:] *= ramp[::-1]
        seg *= np.float32(10 ** (gains[p["line"]]["gain_db"] / 20))
        at = int(round((r["start"] - (s0 - cin) / r["tempo"]) * SR))
        if at < 0:
            seg, at = seg[-at:], 0
        cut = seg[max(0, n - at):]
        if len(cut) and float(np.max(np.abs(cut))) > 10 ** (-50 / 20):
            issues.append(f"line {r['line']}: \"{short(r['text'])}\" still sounds at the video's end: "
                          f"{len(cut) / SR:.2f} s of it would be cut")
        seg = seg[:max(0, n - at)]
        out[at:at + len(seg)] += seg
        line = words_out[p["line"]]
        for w in p["words"]:
            ws = r["start"] + (w["start"] - s0) / r["tempo"]
            we = r["start"] + (w["end"] - s0) / r["tempo"]
            line["words"].append({k: w[k] for k in w if k not in ("start", "end")} | {"start": round(ws, 3), "end": round(we, 3)})
    for line in words_out:
        if line["words"]:
            line["start"], line["end"] = line["words"][0]["start"], line["words"][-1]["end"]
            if line["end"] > dur + 1e-3:
                issues.append(f"line {line['i'] + 1}: its last word ends at {line['end']:.2f} s, after the video's end "
                              f"({dur:.2f} s)")
    peak = float(np.max(np.abs(out))) if len(out) else 0.0
    if peak > 0.98:
        out *= np.float32(0.98 / peak)
        notes.append(f"the placed voice peaked at {20 * math.log10(peak):+.1f} dBFS: lowered to -0.2 dBFS (the mix sets "
                     "its level)")
    lang.voice.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(lang.voice), out, SR, subtype="PCM_24")
    vsha = sha256(lang.voice)
    doc = {"lines": words_out, "audioSha256": vsha,
           "source": {"kind": "narration", "tool": TOOL, "dub": lang.code, "of": v.rel(o.words_path),
                      # (the text the take says, paragraph by paragraph: what subtitles check this placement
                      # against, since a sentence its mix trims is left out of the words on purpose)
                      "paragraphs": [dl["text"] for dl in D],
                      "note": "The dub's words at their times in the video (dub.py place); sourceText is the original "
                              "line, so scenes that find lines by the original's text still find them."}}
    write_json(lang.placed, doc)
    rec = {"tool": TOOL, "version": VERSION, "placed": now(), "lang": lang.code, "inputs": inputs,
           "duration": round(dur, 4), "voice_sha256": vsha, "words_sha256": sha256(lang.placed),
           "bounds": {"lead_max": LEAD_MAX, "tempo_max": TEMPO_MAX, "slip_max": SLIP_MAX, "anchor_tol": ANCHOR_TOL},
           "pieces": placed, "anchors": [{k: x[k] for k in x if k != "word"} for x in anchors],
           "levels": {str(i + 1): g for i, g in gains.items()}, "issues": issues, "notes": notes}
    write_json(lang.placement, rec)
    report_place(v, lang, rec)
    return rec


def short(s: str, n: int = 60) -> str:
    return s if len(s) <= n else s[:n - 1] + "…"


def report_place(v: Video, lang: Lang, rec: dict, up_to_date: bool = False) -> None:
    P = rec.get("pieces") or []
    lead = sum(1 for r in P if r["lead"] > 0)
    fast = [r for r in P if r["tempo"] > 1.0001]
    slip = [r for r in P if r["slip"] > 0]
    say(f"{lang_name(lang.code)}: {len(P)} pieces placed" + (" (up to date)" if up_to_date else "") +
        f" in {v.rel(lang.voice)}, words in {v.rel(lang.placed)}.",
        f"  {lead} start early (up to {LEAD_MAX:g} s), {len(fast)} sped up (most {max([r['tempo'] for r in fast] or [1]):.3f}x), "
        f"{len(slip)} start late (most {max([r['slip'] for r in slip] or [0]):.2f} s).")
    for x in rec.get("anchors") or []:
        if "off" in x:
            say(f"  anchor line {x['line']}: \"{x['translated']}\" {x['off']:+.2f} s from \"{x['original']}\"")
    for n_ in rec.get("notes") or []:
        say(f"  note: {n_}")
    if rec.get("issues"):
        say(f"  Open ({len(rec['issues'])}): the track isn't finished until these are:")
        for x in rec["issues"]:
            say(f"    - {x}")
    else:
        say("  No open issues: every sentence fits its place.")


# ------------------------------------------------------------------------------------------------ mix

def cmd_mix(a) -> dict:
    v = Video(a.video)
    lang = Lang(v, a.lang)
    o = Original(v)
    stale = [x for x in freshness(o, lang) if "(mix" not in x and not x.startswith("no track")]
    if stale:
        raise usage(f"{lang_name(lang.code)}: {'; '.join(stale)}: dub.py place --video {v.name} --lang {lang.code} first")
    rec = o.rec
    raw = rec.get("plan") or {}
    res = rec.get("resolved") or {}

    def rebase(f: str) -> str:
        return Path(os.path.relpath((o.plan_dir / f).resolve(), lang.dir)).as_posix()

    plan = {"note": f"Written by dub.py mix: the video's mix ({v.rel(o.rec_path)}, as built) with the "
                    f"{lang_name(lang.code)} voice. The music and effects keep their files, times and gains.",
            **{k: raw[k] for k in ("kind", "loudness", "true_peak", "max_limit_db", "fade_in", "fade_out", "hits",
                                   "hit_lu", "build_lu") if k in raw},
            "duration": o.video_duration()[0], "voice": "audio/voice.wav", "voice_words": "data/words-placed.json"}
    mu = raw.get("music")
    if mu is not None:
        mu = {"file": mu} if isinstance(mu, str) else dict(mu)
        mu["file"] = rebase(mu["file"])
        mu.pop("under_voice", None)
        mu["gain_db"] = (res.get("music") or {}).get("gain_db", mu.get("gain_db", 0.0))
        plan["music"] = mu
    fx_raw = raw.get("effects") or []
    frows = res.get("effects") or []
    if len(fx_raw) != len(frows):
        raise Fail(ERROR, f"the video's mix record lists {len(frows)} effects and its plan {len(fx_raw)}: build it again")
    plan["effects"] = [{"file": rebase(e["file"]), "at": fr["time"], "align": fr.get("align", "onset"),
                        "gain_db": round(fr["gain_db"] - cluster_db(fr), 3),
                        "note": f"{fr.get('where')}: {fr.get('source')}, in the video's mix"}
                       for e, fr in zip(fx_raw, frows)]
    write_json(lang.mix_plan, plan)
    lang.pkg.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    args = ["uv", "run", "--quiet", str(MIX), "build", "--video", v.name, "--plan", v.rel(lang.mix_plan),
            "--to", v.rel(lang.pkg), "--json"] + (["--force"] if a.force else [])
    r = subprocess.run(args, cwd=v.root, capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)
    try:
        out = json.loads(r.stdout[r.stdout.index("{"):])
    except ValueError:
        raise Fail(ERROR, f"mix.py build failed: {(r.stderr or r.stdout).strip()[-800:]}")
    if r.returncode:
        raise Fail(r.returncode, f"mix.py build: {out.get('message') or out.get('error') or r.stderr[-500:]}")
    drec = read_json(lang.mix_rec) or {}
    cmp_ = compare_lines(rec, drec)
    m, mo = drec.get("measured") or {}, (rec.get("measured") or {})
    say(f"{lang_name(lang.code)}: {v.rel(lang.mix_wav)} ({out.get('status', 'built')}): "
        f"{m.get('integrated_lufs')} LUFS (the original {mo.get('integrated_lufs')}), true peak {m.get('true_peak_dbtp')} "
        f"dBTP; review files in {v.rel(v.root / 'out' / v.name / ('mix-' + lang.code))}/.")
    if cmp_:
        say(f"  {len(cmp_)} line(s) where the voice sits closer to the music or effects than the same line does in the "
            "video's mix (which the director approved). Listen there; where a word is lost, lift the line in "
            f"{v.rel(lang.levels)} (line<TAB>dB<TAB>why), place and mix again:")
        for c in cmp_[:15]:
            say(f"    line {c['line']} at {c['start']:.1f} s: {c['what']}; to match the original: {c['lift']:+.1f} dB")
    else:
        say("  Every line keeps at least the margin over the music and effects that it has in the video's mix.")
    write_json(lang.review / "mix-compare.json", {"lang": lang.code, "lines": cmp_, "at": now()})
    return {"lang": lang.code, "mix": v.rel(lang.mix_wav), "status": out.get("status"), "lines": cmp_}


def cluster_db(frow: dict) -> float:
    """The cut mix.py made to an effect within 150 ms of another (its record's gain includes it, and mix.py makes it
    again on a plan that repeats that gain): taken out here, so the dub's effect sounds as the video's does."""
    m = re.search(r"x([0-9.]+) \(within", str(frow.get("bound", "")))
    return 20 * math.log10(float(m.group(1))) if m and float(m.group(1)) > 0 else 0.0


def compare_lines(orig_rec: dict, dub_rec: dict) -> list[dict]:
    """Lines whose voice-over-bed margin is worse in the dub than in the original by 2 LU on median or 3 LU in the
    worst 100 ms, and listed by mix.py: candidates to listen to, each with the lift that restores the original's."""
    o = {x["i"]: x for x in ((orig_rec.get("voice_over_bed") or {}).get("lines") or []) if "i" in x}
    out = []
    for d in ((dub_rec.get("voice_over_bed") or {}).get("lines") or []):
        x = o.get(d.get("i"))
        if x is None or not d.get("findings"):
            continue
        dm, dw = x["median_lu"] - d["median_lu"], x["worst_lu"] - d["worst_lu"]
        if dm >= 2 or dw >= 3:
            what = []
            if dm >= 2:
                what.append(f"{d['median_lu']:.1f} LU over the bed on median (the original line {x['median_lu']:.1f})")
            if dw >= 3:
                what.append(f"its worst 100 ms {d['worst_lu']:.1f} LU at {d.get('worst_at')} s (the original {x['worst_lu']:.1f})"
                            + (f", \"{d['worst_word']}\"" if d.get("worst_word") else ""))
            out.append({"line": d["i"] + 1, "start": d["start"], "what": "; ".join(what),
                        "lift": round(min(3.0, max(dm, dw if dw >= 3 else 0)) * 2) / 2})
    return out


# ------------------------------------------------------------------------------------------------ verify

def cmd_verify(a) -> dict:
    tool("ffmpeg")
    v = Video(a.video)
    o = Original(v)
    job = load_job(v, need=False) or {}
    codes = [x.strip() for x in (a.langs or "").split(",") if x.strip()] or sorted(
        set(job.get("languages") or {}) | {p.parent.name for p in v.youtube.glob("*/mix.wav")})
    if not codes:
        raise usage("no dubbed track to verify: youtube/<code>/mix.wav (dub.py mix) for at least one language")
    vdur, vsrc = o.video_duration()
    frame = 1.0 / (o.fps or 30.0)
    orig_mix = decode(v.dir / "audio" / "mix.wav", channels=2)
    ot, ol = short_term(orig_mix)
    om = o.rec.get("measured") or {}
    rows = []
    for code in codes:
        lang = Lang(v, code)
        fails, issues, diags, checked = [], [], [], []
        stopped = [x["why"] for x in stops((job.get("languages") or {}).get(code) or {})] + \
            [x["why"] for x in stops(job)]
        issues += [f"stopped: {x}" for x in stopped]
        if not lang.mix_wav.is_file():
            rows.append({"lang": code, "name": lang_name(code), "status": "incomplete" if not stopped else "stopped",
                         "fails": [], "issues": issues + ["no mix.wav yet"], "diagnostics": [], "checked": []})
            continue
        drec = read_json(lang.mix_rec) or {}
        if (drec.get("outputs") or {}).get("mix.wav") != sha256(lang.mix_wav):
            fails.append("mix.wav isn't the file its record describes: run dub.py mix again")
        info = sf.info(str(lang.mix_wav))
        d = info.frames / info.samplerate
        if abs(d - vdur) > frame + 1e-6:
            fails.append(f"{d:.3f} s long; the video is {vdur:.3f} s ({vsrc}): more than a frame apart")
        else:
            checked.append(f"length {d:.3f} s, the video's {vdur:.3f} s ({vsrc}) within a frame")
        if info.samplerate != 48000 or info.channels != 2:
            fails.append(f"{info.samplerate} Hz, {info.channels} channel(s): 48 kHz stereo expected")
        x = decode(lang.mix_wav, channels=2)
        sp = float(np.max(np.abs(x))) if len(x) else 0.0
        m = drec.get("measured") or {}
        ceiling = ((drec.get("resolved") or {}).get("master") or {}).get("ceiling_dbtp", -1.0)
        tp = m.get("true_peak_dbtp")
        if sp >= 0.9999:
            fails.append(f"samples at full scale ({20 * math.log10(max(sp, 1e-9)):+.2f} dBFS): clipped")
        if tp is not None and tp > ceiling + 0.05:
            fails.append(f"true peak {tp:+.2f} dBTP, over the ceiling {ceiling:+.1f}")
        elif tp is not None:
            checked.append(f"true peak {tp:+.2f} dBTP (ceiling {ceiling:+.1f}), highest sample {20 * math.log10(max(sp, 1e-9)):+.2f} dBFS")
        # the bed: the original's files, times and gains; the original voice nowhere in it
        ores, dres = o.rec.get("resolved") or {}, drec.get("resolved") or {}
        om_, dm_ = ores.get("music") or {}, dres.get("music") or {}
        for k in ("file", "at", "from"):
            if om_.get(k) != dm_.get(k):
                fails.append(f"the music's {k} is {dm_.get(k)!r}, the video's mix has {om_.get(k)!r}")
        # (its end within what both play: a track as long as a longer render runs the music on, a shorter one cuts it)
        common = min(o.duration, d)  # (the stretch both the video's mix and this track play)
        if isinstance(dm_.get("end"), (int, float)) and isinstance(om_.get("end"), (int, float)) and \
                abs(min(dm_["end"], common) - min(om_["end"], common)) > 1e-3:
            fails.append(f"the music ends at {dm_['end']} s, at {om_['end']} s in the video's mix")
        if om_.get("gain_db") != dm_.get("gain_db"):
            fails.append(f"the music's gain is {dm_.get('gain_db')} dB, {om_.get('gain_db')} in the video's mix")
        ofx = [(e.get("file"), e.get("placed_at"), e.get("gain_db")) for e in ores.get("effects") or []]
        dfx = [(e.get("file"), e.get("placed_at"), e.get("gain_db")) for e in dres.get("effects") or []]
        if [f for f, _, _ in ofx] != [f for f, _, _ in dfx] or any(
                not isinstance(t0, (int, float)) or not isinstance(t1, (int, float)) or abs(t1 - t0) > FX_TOL
                for (_, t0, _), (_, t1, _) in zip(ofx, dfx)):
            fails.append("the effects aren't the video's mix's (files or times differ)")
        elif [g for _, _, g in ofx] != [g for _, _, g in dfx]:
            fails.append("an effect's gain differs from the video's mix: " + "; ".join(
                f"{f} {g1} dB, {g0} in the video's mix" for (f, _, g0), (_, _, g1) in zip(ofx, dfx) if g0 != g1))
        else:
            checked.append(f"music and {len(ofx)} effect(s): the video's mix's files, times and gains")
        ovoice = {r.get("file") for r in ores.get("voice") or []}
        if ovoice & set(drec.get("inputs") or {}):
            fails.append("the original voice is among the track's inputs")
        # placement and words: made from what is there now, and its open issues
        pl = read_json(lang.placement) or {}
        stale = freshness(o, lang)
        fails += [f"not current: {x}" for x in stale]
        issues += pl.get("issues") or []
        late = [w for l in (read_json(lang.placed) or {}).get("lines") or [] for w in l.get("words") or []
                if float(w.get("end", 0)) > d + 1e-3]
        if late:
            fails.append(f"{len(late)} placed word(s) end after the track does (\"{late[0].get('w')}\" at "
                         f"{float(late[0]['end']):.2f} s)")
        heard = read_json(lang.heard) or {}
        if heard.get("voice_sha256") == sha256(lang.voice):
            sim = float(heard.get("similarity") or 0)
            (checked if sim >= 0.85 else issues).append(
                f"the placed voice transcribed: {sim * 100:.1f}% of its text as it should be"
                + ("" if sim >= 0.85 else " (under 85%: missing, repeated or cut words to find)"))
        else:
            issues.append("the placed voice isn't transcribed yet (dub.py hear): its words are unchecked")
        # loudness against the original: diagnostics
        di, oi = m.get("integrated_lufs"), om.get("integrated_lufs")
        if di is not None and oi is not None:
            (diags if abs(di - oi) > 1.0 else checked).append(
                f"integrated {di:.1f} LUFS, the video's mix {oi:.1f} ({di - oi:+.1f} LU)")
        dt_, dl_ = short_term(x)
        k = min(len(ol), len(dl_))
        if k:
            diff = dl_[:k] - ol[:k]
            loud = (ol[:k] > -50) | (dl_[:k] > -50)
            bad = np.abs(diff) > 3.0
            runs = []
            i = 0
            while i < k:
                if bad[i] and loud[i]:
                    j = i
                    while j + 1 < k and bad[j + 1] and loud[j + 1]:
                        j += 1
                    if j - i + 1 >= 3:
                        runs.append((ot[i], ot[j], float(np.mean(diff[i:j + 1]))))
                    i = j + 1
                else:
                    i += 1
            for t0, t1, dd in runs[:8]:
                diags.append(f"{t0:.0f}-{t1:.0f} s: {dd:+.1f} LU against the video's mix at the same moment")
        status = "failed" if fails else ("stopped" if stopped else ("incomplete" if issues else "ready"))
        row = {"lang": code, "name": lang_name(code), "status": status, "fails": fails, "issues": issues,
               "diagnostics": diags, "checked": checked, "integrated_lufs": di, "true_peak_dbtp": tp,
               "file": v.rel(lang.mix_wav)}
        if a.mp4 and o.render.is_file():
            mp4 = v.review / f"{code}.mp4"
            mp4.parent.mkdir(parents=True, exist_ok=True)
            rr = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(o.render), "-i", str(lang.mix_wav),
                                 "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k",
                                 str(mp4)], capture_output=True)
            row["mp4"] = v.rel(mp4) if rr.returncode == 0 else None
        rows.append(row)
    lv = [r["integrated_lufs"] for r in rows if r.get("integrated_lufs") is not None]
    spread = (max(lv + [om.get("integrated_lufs")]) - min(lv + [om.get("integrated_lufs")])) if lv and om.get(
        "integrated_lufs") is not None else None
    say(f"Dubbed tracks of {v.name}, against the video ({vdur:.3f} s, {vsrc}) and its mix ({om.get('integrated_lufs')} LUFS):")
    for r in rows:
        say(f"  {r.get('name', r['lang'])}: {r['status'].upper()}" + (f"  {r['file']}" if r.get("file") else ""))
        for f in r["fails"]:
            say(f"    FAIL {f}")
        for f in r["issues"]:
            say(f"    open {f}")
        for f in r["diagnostics"]:
            say(f"    listen {f}")
        for f in r["checked"]:
            say(f"    ok   {f}")
        if r.get("mp4"):
            say(f"    watch {r['mp4']}")
    if spread is not None:
        say(f"Across the languages and the original: {spread:.1f} LU between the loudest and quietest track" +
            (" (over 1 LU: a viewer switching tracks may hear it)" if spread > 1.0 else "."))
    say("Checked here: measurements and records. Not checked: how natural the voice sounds, its accent and "
        "pronunciation, and the translation's meaning; nobody has listened unless the director has.")
    res = {"video": v.name, "duration": vdur, "duration_from": vsrc, "rows": rows, "spread_lu": spread, "at": now()}
    write_json(v.review / "verify.json", res)
    if any(r["status"] == "failed" for r in rows):
        raise Fail(ERROR, "a track failed verification", res)
    return res


# ------------------------------------------------------------------------------------------------ status

def cmd_status(a) -> dict:
    v = Video(a.video)
    job = load_job(v)
    try:  # a request a stopped run left pending is settled, unless another run holds the job now
        with JobLock(v):
            job = load_job(v)
            settled = settle_pending(v, job)
        if settled:
            say(f"Settled as possibly charged (a run stopped mid-request): {', '.join(settled)}")
    except Fail as e:
        say(f"Another run holds the job ({v.rel(v.dub / '.job.lock')}): read as it stands. {e.msg}")
    try:
        o = Original(v)
    except Fail as e:
        o = None
        say(f"The reference: {e.msg}")
    tot = ledger_totals(job)
    say(f"Dub job for {v.name}: approved {job.get('approved')}, \"{job.get('words')}\"; voice "
        f"{job['voice'].get('name') or job['voice']['id']}; cap {num(job['cap'])} credits: {num(tot['billed'])} billed, "
        f"{num(tot['possibly'])} possibly charged, {num(tot['pending'])} pending, {num(job['cap'] - tot['committed'])} "
        f"left; reserved at {char_rate(job):.2f} credits a character.")
    for x in stops(job):
        say(f"  THE JOB STOPPED: {x['why']}")
    if o is not None and job.get("sources") != o.fingerprint():
        say("  The video's words, mix or render changed since the approval: each language is placed and mixed again "
            "(free) before it is delivered.")
    rows = []
    for code, ls in job["languages"].items():
        lang = Lang(v, code)
        n_par = len(paragraphs(lang.narration_txt)) if lang.narration_txt.is_file() else 0
        made = len(list(lang.blocks.glob("*.request.json"))) if lang.blocks.is_dir() else 0
        pilot = read_json(lang.pilot) or {}
        pilot_ok = bool(pilot.get("pass")) and sha256(v.root / pilot.get("file", "-")) == pilot.get("file_sha256")
        stale = freshness(o, lang) if o is not None else ["the reference can't be read"]
        heard = read_json(lang.heard) or {}
        h = lang.voice.is_file() and heard.get("voice_sha256") == sha256(lang.voice)
        pl = read_json(lang.placement) or {}
        st = [f"translation {'yes' if n_par else 'no'}", f"blocks {made}/{n_par or '?'}",
              f"voice test {'passed' if pilot_ok else ('failed' if pilot else 'not yet')}"]
        if not n_par:
            nxt = "translate (youtube/<code>/narration.txt, from dub.py source)"
        elif made == 0:
            nxt = "the voice test: speak --test N on the hardest paragraph, then hear --test N"
        elif not pilot_ok:
            nxt = "hear --test N (the voice test), or another take of it"
        elif made < n_par or take_stale(lang):
            nxt = "speak (the rest, or the paragraphs that changed)"
        elif stale:
            nxt = stale[0]
        elif pl.get("issues"):
            nxt = "the open placement issues (shorten a sentence, anchors), then speak, place and mix"
        elif not h:
            nxt = "hear (the placed voice transcribed)"
        else:
            nxt = "verify"
        if stale:
            st.append("not current: " + "; ".join(stale))
        if pl.get("issues"):
            st.append(f"{len(pl['issues'])} open in its placement")
        st.append(f"heard {'yes' if h else 'no'}")
        t = ledger_totals(job, code)
        st.append(f"{num(t['committed'])}/{num(ls.get('share') or 0)} credits")
        if stops(ls) or stops(job):
            st.insert(0, "STOPPED: " + "; ".join(x["why"] for x in stops(ls) + stops(job)))
            nxt = "the director's call (stopped)"
        rows.append({"lang": code, "state": st, "next": nxt})
        say(f"  {lang_name(code):<22} {', '.join(st)}; next: {nxt}")
    return {"video": v.name, "ledger": tot, "rows": rows}


# ------------------------------------------------------------------------------------------------ CLI

def main(argv: list[str] | None = None) -> int:
    RF = argparse.RawDescriptionHelpFormatter
    ap = argparse.ArgumentParser(prog="dub.py", description=__doc__, formatter_class=RF)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def P(name, help_):
        p = sub.add_parser(name, help=help_, description=help_, formatter_class=RF)
        p.add_argument("--video", required=True, metavar="NAME", help="the video: videos/NAME/")
        p.add_argument("--json", action="store_true", help="print one JSON object instead of the summary")
        return p

    p = P("source", "write the original narration's lines as paragraphs (the text a translation follows)")
    p.add_argument("--out", help="where (default videos/<video>/dub/source.txt)")
    p = P("plan", "what dubbing these languages would cost (free); --approve writes the job after the director's yes")
    p.add_argument("--langs", help="language codes, comma-separated (default: the job's)")
    p.add_argument("--from", dest="source_lang", help="the video's language code (its narration's)")
    p.add_argument("--voice", help="the voice id (default: the original narration's)")
    p.add_argument("--model", help="the original narration's model, if eleven.py didn't record it")
    p.add_argument("--approve", metavar="WORDS", help="the director's yes, in their words: writes dub/job.json")
    p.add_argument("--cap", type=int, help="with --approve: the most the batch may spend, in credits")
    p = P("speak", "make a language's narration (paid, inside the job)")
    p.add_argument("--lang", required=True)
    p.add_argument("--test", type=int, metavar="N", help="make only block N: the voice test (the hardest block)")
    p.add_argument("--block", type=int, help="the block for --takes / --pick")
    p.add_argument("--takes", type=int, help="more takes of --block N on new seeds (a retry)")
    p.add_argument("--pick", type=int, help="keep take K of --block N (free)")
    p = P("place", "put the translated sentences where the original's sit (free)")
    p.add_argument("--lang", required=True)
    p.add_argument("--force", action="store_true", help="place again even when nothing it reads changed")
    p = P("hear", "transcribe the placed voice and compare it with its text (paid, inside the job)")
    p.add_argument("--lang", required=True)
    p.add_argument("--test", type=int, metavar="N", help="the voice test instead: block N transcribed against its text "
                                                        "and its language, before the rest is made")
    p = P("mix", "the language's complete track, youtube/<code>/mix.wav (free)")
    p.add_argument("--lang", required=True)
    p.add_argument("--force", action="store_true", help="mix again even when nothing changed")
    p = P("verify", "check every track against the video and the original mix (free)")
    p.add_argument("--langs", help="language codes (default: the job's and every youtube/<code>/mix.wav)")
    p.add_argument("--mp4", action="store_true", help="also mux each track on the final render in out/<video>/dub/")
    P("status", "the job: done, next, spent against the cap (free)")

    a = ap.parse_args(argv)
    fn = {"source": cmd_source, "plan": cmd_plan, "speak": cmd_speak, "place": cmd_place, "hear": cmd_hear,
          "mix": cmd_mix, "verify": cmd_verify, "status": cmd_status}[a.cmd]
    real_stdout = sys.stdout
    if a.json:
        sys.stdout = sys.stderr
    try:
        res = fn(a)
        code, payload = OK, {"ok": True, **(res if isinstance(res, dict) else {})}
    except Fail as e:
        code, payload = e.code, {"ok": False, "code": e.code, "message": e.msg, **e.data}
        print(f"dub.py {a.cmd}: {e.msg}", file=sys.stderr)
    finally:
        sys.stdout = real_stdout
    if a.json:
        print(json.dumps(payload, ensure_ascii=False, default=str))
    return code


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    sys.exit(main())
