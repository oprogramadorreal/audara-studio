# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=2.0,<3"]
# ///
"""A local stand-in for the ElevenLabs endpoints eleven.py calls, with the documented response
shapes (OpenAPI / docs, digest of 2026-10-02). Never contacts the real API.

  GET  /v2/voices, /v1/voices/{id}, /v1/voices/{id}/settings, /v1/user/subscription
  POST /v1/text-to-speech/{voice}/with-timestamps   JSON: audio_base64 + character alignment
  POST /v1/music/plan                               JSON: CompositionPlan (chunks)
  POST /v1/music/detailed                           multipart/mixed: JSON part + audio part
  POST /v1/sound-generation                         audio/mpeg (rotates 4 synthesized sounds)
  POST /v1/speech-to-text                           JSON: words[] (fake transcript of what TTS said)

The TTS audio is speech-like (voiced tones per letter, real silences at , and .) and its
alignment has the biases real TTS timestamps show: the first character starts at 0.0 although
the voice starts 150 ms in, a word after a pause is reported 90 ms early, a word before a pause
ends 50 ms late, and the last character runs to the end of the file. Every request is logged to
the --log file (method, path, whether the key matched, and a text-to-speech request's request id;
never the key itself). The key it accepts is $MOCK_KEY (default: the eval harness fake key).

What a session sees looks like a real creator account: voice names, ids and labels, preview links,
request ids and song metadata in ElevenLabs' formats. Agents that spotted a mock (voices named
"(mock)") held back and left out what a real hand-off says. The preview links point at ElevenLabs'
storage bucket, where these files don't exist: fetched, they answer 404.

Triggers for error tests: TTS text containing TRIGGER_402 -> 402 insufficient_credits;
TRIGGER_429 -> 429 once, then success.
"""
import argparse
import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import numpy as np

HERE = Path(__file__).resolve().parent
SR = 44100
# generated sounds and the request log stay out of the repo (evals/results/ is git-ignored)
WORK = HERE.parent / "results" / "mock-elevenlabs"
LOG = WORK / "mock_log.jsonl"
LOCK = threading.Lock()
STATE = {"tts_texts": [], "sfx_calls": {}, "seen_429": set(), "audio_sha": {}}

# a default (premade) voice, one added from the Voice Library (professional) and one made with Voice
# Design (generated); preview links have the bucket paths each kind has there
PREVIEWS = "https://storage.googleapis.com/eleven-public-prod"
VOICES = [
    {"voice_id": "7pw50oSJb9NWQ0HJBBuM", "name": "Camila", "category": "premade",
     "description": "A calm, clear Brazilian Portuguese voice for narration and audiobooks.",
     "labels": {"accent": "brazilian", "descriptive": "calm", "age": "young", "gender": "female", "language": "pt",
                "use_case": "narrative_story"},
     "verified_languages": [{"language": "pt", "model_id": "eleven_multilingual_v2", "accent": "brazilian",
                             "locale": "pt-BR"}],
     "preview_url": f"{PREVIEWS}/premade/voices/7pw50oSJb9NWQ0HJBBuM/ae2156f9-d9fa-4042-b60d-4505f3d38841.mp3"},
    {"voice_id": "lLMLgpFODM2KlxUSCdcI", "name": "Graham - Warm Narrator", "category": "professional",
     "description": "A warm, steady American narrator in his forties: clear and trustworthy, for explainers, "
                    "product videos and documentaries.",
     "labels": {"accent": "american", "descriptive": "warm", "age": "middle_aged", "gender": "male", "language": "en",
                "use_case": "narrative_story"},
     "verified_languages": [{"language": "en", "model_id": "eleven_multilingual_v2", "accent": "american",
                             "locale": "en-US"}],
     "preview_url": f"{PREVIEWS}/database/user/AIUIKYiRBwkRR26g44VZyKyilmnV/voices/lLMLgpFODM2KlxUSCdcI/"
                    "cTczOGjY24UT3zJATqtC.mp3"},
    {"voice_id": "f38bgdzGogYQ5UizvbaJ", "name": "Hannah - British Host", "category": "generated",
     "description": "A bright, upbeat young British voice for social media, ads and short videos.",
     "labels": {"accent": "british", "descriptive": "upbeat", "age": "young", "gender": "female", "language": "en",
                "use_case": "social_media"},
     "verified_languages": [{"language": "en", "model_id": "eleven_multilingual_v2", "accent": "british",
                             "locale": "en-GB"},
                            {"language": "pt", "model_id": "eleven_multilingual_v2", "locale": "pt-BR"}],
     "preview_url": f"{PREVIEWS}/UJeUIFMzeGXX9WpLtQoWnZIpJBcq/voices/f38bgdzGogYQ5UizvbaJ/"
                    "31ecfd4d-415a-499e-97f8-7fe8a1d48843.mp3"},
]


def request_id() -> str:
    """A request id as the API gives one, in error bodies and the request-id header: 32 hex digits."""
    return os.urandom(16).hex()


def err(code: int, typ: str, ecode: str, msg: str, status: str | None = None) -> tuple[int, dict]:
    return code, {"detail": {"type": typ, "code": ecode, "message": msg, "status": status or ecode,
                             "request_id": request_id()}}


def mp3(y: np.ndarray, channels: int = 1) -> bytes:
    r = subprocess.run(["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(SR), "-ac", str(channels), "-i", "-",
                        "-c:a", "libmp3lame", "-b:a", "128k", "-f", "mp3", "-"],
                       input=np.ascontiguousarray(y, dtype="<f4").tobytes(), capture_output=True)
    if r.returncode:
        raise RuntimeError(r.stderr.decode())
    return r.stdout


# ---------------------------------------------------------------------------------------------
# text-to-speech


def synth_tts(text: str, seed: int) -> tuple[np.ndarray, dict]:
    rng = np.random.default_rng((seed or 0) * 7919 + len(text))
    lead, tail = 0.15, 0.40
    f0 = 118.0 + 9.0 * ((seed or 0) % 5)
    segs = []  # (char, start, end, kind) kind: v voiced, c consonant, w weak (space), s silence
    t = lead
    prev_pause = False
    for c in text:
        if c.isalnum():
            dur = 0.055 + 0.03 * rng.random()
            kind = "c" if c.lower() in "stkpfhcxzç" else "v"
        elif c == " ":
            dur, kind = 0.03, ("s" if prev_pause else "w")
        elif c in ",;:—":
            dur, kind = 0.26, "s"
        elif c in ".?!…":
            dur, kind = 0.45, "s"
        else:
            dur, kind = 0.02, "w"
        segs.append((c, t, t + dur, kind))
        prev_pause = c in ",;:—.?!…"
        t += dur
    total = t + tail
    n = int(round(total * SR))
    amp = np.zeros(n)
    noise_amp = np.zeros(n)
    for c, a, b, kind in segs:
        i0, i1 = int(round(a * SR)), int(round(b * SR))
        if kind == "v":
            amp[i0:i1] = 1.0
        elif kind == "c":
            amp[i0:i1] = 0.35
            noise_amp[i0:i1] = 0.5
        elif kind == "w":
            amp[i0:i1] = 0.4
    k = int(0.004 * SR)  # 4 ms smoothing: no clicks, edges stay sharp
    ker = np.ones(k) / k
    amp, noise_amp = np.convolve(amp, ker, "same"), np.convolve(noise_amp, ker, "same")
    tt = np.arange(n) / SR
    vib = 1 + 0.03 * np.sin(2 * np.pi * 5 * tt)
    ph = 2 * np.pi * np.cumsum(f0 * vib) / SR
    voice = sum(np.sin(h * ph) / h for h in range(1, 12)) * 0.12
    y = amp * voice + noise_amp * rng.standard_normal(n) * 0.05
    # alignment as the API reports it, with real TTS biases
    chars, st, en = [], [], []
    for i, (c, a, b, kind) in enumerate(segs):
        chars.append(c)
        st.append(a)
        en.append(b)
    alnum = [i for i, s in enumerate(segs) if s[0].isalnum()]
    for idx, i in enumerate(alnum):
        prev = alnum[idx - 1] if idx else None
        gap_before = segs[i][1] - (segs[prev][2] if prev is not None else 0.0)
        if prev is not None and gap_before >= 0.2:  # first letter after a pause: reported 90 ms early
            st[i] -= 0.09
            for j in range(prev + 1, i):
                en[j] = min(en[j], st[i])
                st[j] = min(st[j], en[j])
        nxt = alnum[idx + 1] if idx + 1 < len(alnum) else None
        gap_after = (segs[nxt][1] if nxt is not None else total) - segs[i][2]
        if nxt is not None and gap_after >= 0.2:  # last letter before a pause: reported 50 ms late
            en[i] += 0.05
            for j in range(i + 1, nxt):
                st[j] = max(st[j], en[i])
                en[j] = max(en[j], st[j])
    st[0] = 0.0  # the first character absorbs the leading silence
    en[-1] = total  # the last character absorbs the tail
    al = {"characters": chars, "character_start_times_seconds": [round(x, 3) for x in st],
          "character_end_times_seconds": [round(x, 3) for x in en]}
    return y.astype(np.float32), al


# ---------------------------------------------------------------------------------------------
# music


def synth_music(total_ms: int, nchunks: list[int], seed: int) -> np.ndarray:
    n = int(total_ms / 1000 * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    bpm = 120.0
    beat = 60 / bpm
    chord = sum(np.sin(2 * np.pi * f * t) for f in (146.83, 220.0, 293.66, 369.99)) * 0.05
    ph = (t % beat) / beat
    kick = np.sin(2 * np.pi * (50 + 60 * np.exp(-ph * 30)) * t) * np.exp(-ph * 12) * 0.5
    hat = rng.standard_normal(n) * np.exp(-((t + beat / 2) % beat) / beat * 40) * 0.03
    gain = np.ones(n)
    starts = np.cumsum([0] + nchunks) / 1000
    for i in range(len(nchunks)):  # each chunk 3 dB up on the one before: a build
        sel = (t >= starts[i]) & (t < starts[i + 1])
        gain[sel] = 10 ** ((-6 + 3 * i) / 20)
    y = (chord + kick + hat) * gain
    if seed == 2:  # a near-silent intro, and 5 dB quieter overall
        y[t < 2.5] *= 0.003
        y *= 10 ** (-5 / 20)
    if seed == 3:  # dies 6 s before the end
        y[t > total_ms / 1000 - 6] *= 0.002
    fade = np.minimum(1, (total_ms / 1000 - t) / 0.8)  # a short natural ring-out
    y = y * np.clip(fade, 0, 1)
    st = np.stack([y, y * 0.98], 1)
    return st.astype(np.float32).reshape(-1)


def plan_for(prompt: str, length_ms: int | None) -> dict:
    total = length_ms or 30000
    if total < 9000:
        parts = [("Main", total)]
    else:
        a = int(round(total * 0.25 / 1000)) * 1000
        b = int(round(total * 0.25 / 1000)) * 1000
        parts = [("Intro", a), ("Main", total - a - b), ("Outro", b)]
    sung = "vocals" in prompt.lower() and "no vocals" not in prompt.lower()
    # the styles echo the prompt's first line (eleven.py puts its rules on the lines after it)
    styles = [s.strip() for s in (prompt.strip().splitlines() or [""])[0].split(",") if s.strip()][:4]
    role = {"Intro": "sparse intro", "Main": "full arrangement", "Outro": "gentle resolve"}
    chunks = []
    for name, d in parts:
        text = f"[{name}]"
        if sung and name == "Main":
            text += "\nEvery frame is a function of time\nand the time is ours"
        chunks.append({"text": text, "duration_ms": d,
                       "positive_styles": (styles or ["warm analog pads", "soft pulse"]) + [role[name]],
                       "negative_styles": ["harsh"], "context_adherence": "high"})
    return {"chunks": chunks}


# ---------------------------------------------------------------------------------------------
# sound effects (synthesized with ffmpeg)

SFX = {
    "boomy": "aevalsrc=exprs='0.9*sin(2*PI*55*t)*exp(-6*t)+0.25*sin(2*PI*110*t)*exp(-8*t)':d=0.6:s=44100",
    "hissy": "anoisesrc=d=0.25:c=white:a=0.6:s=44100,highpass=f=6500,highpass=f=6500,afade=t=out:st=0.05:d=0.2",
    "clean33": ("aevalsrc=exprs='if(lt(t,0.033),0,0.6*sin(2*PI*880*(t-0.033))*exp(-18*(t-0.033))"
                "+0.3*sin(2*PI*1760*(t-0.033))*exp(-24*(t-0.033)))':d=0.5:s=44100"),
    "whoosh": ("anoisesrc=d=0.7:c=pink:a=0.6:s=44100,bandpass=f=1500:width_type=o:w=2,"
               "afade=t=in:d=0.35:curve=qsin,afade=t=out:st=0.4:d=0.3"),
}
SFX_ORDER = ["boomy", "hissy", "clean33", "whoosh"]


def make_sfx() -> None:
    d = WORK / "sfx"
    d.mkdir(parents=True, exist_ok=True)
    for name, src in SFX.items():
        wav, mp = d / f"{name}.wav", d / f"{name}.mp3"
        if not wav.exists():
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", src, "-ac", "1", "-c:a", "pcm_s16le",
                            str(wav)], check=True)
        if not mp.exists():
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-c:a", "libmp3lame", "-b:a", "128k",
                            str(mp)], check=True)


# ---------------------------------------------------------------------------------------------
# server


class H(BaseHTTPRequestHandler):
    def version_string(self) -> str:  # the Server header: a common API server's, not this file's name
        return "uvicorn"

    def log_message(self, *a):  # quiet console
        pass

    def _log(self, status: int, paid: bool, extra: dict | None = None) -> None:
        key = self.headers.get("xi-api-key")
        auth = "missing" if key is None else ("ok" if key == os.environ.get("MOCK_KEY") else "bad")
        rec = {"t": round(time.time(), 3), "method": self.command, "path": urlparse(self.path).path,
               "query": parse_qs(urlparse(self.path).query), "auth": auth, "paid": paid, "status": status}
        rec.update(extra or {})
        with LOCK, LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec) + "\n")

    def _send(self, code: int, body: bytes, ctype: str, headers: dict | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj, headers: dict | None = None) -> None:
        self._send(code, json.dumps(obj).encode(), "application/json", headers)

    def _auth(self, paid: bool) -> bool:
        key = self.headers.get("xi-api-key")
        if key is None:
            c, b = err(401, "authentication_error", "unauthorized",
                       "Neither authorization header nor xi-api-key received, please provide one.", "needs_authorization")
        elif key != os.environ.get("MOCK_KEY"):
            c, b = err(401, "authentication_error", "unauthorized", "Invalid API key", "invalid_api_key")
        else:
            return True
        self._log(c, paid)
        self._json(c, b)
        return False

    def _body(self) -> bytes:
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def do_GET(self):
        u = urlparse(self.path)
        if not self._auth(False):
            return
        q = parse_qs(u.query)
        if u.path == "/v2/voices":
            size = min(int(q.get("page_size", ["10"])[0]), 2)  # small pages, so clients must paginate
            off = int(q.get("next_page_token", ["0"])[0])
            vs = VOICES
            if "search" in q:
                vs = [v for v in vs if q["search"][0].lower() in json.dumps(v).lower()]
            page = vs[off:off + size]
            more = off + size < len(vs)
            self._log(200, False)
            return self._json(200, {"voices": page, "has_more": more,
                                    "next_page_token": str(off + size) if more else None, "total_count": len(vs)})
        m = re.fullmatch(r"/v1/voices/([^/]+)(/settings)?", u.path)
        if m:
            v = next((v for v in VOICES if v["voice_id"] == m.group(1)), None)
            if v is None:
                c, b = err(404, "not_found", "voice_not_found", f"A voice with voice_id {m.group(1)} was not found.")
                self._log(c, False)
                return self._json(c, b)
            self._log(200, False)
            if m.group(2):
                return self._json(200, {"stability": 0.45, "similarity_boost": 0.8, "style": 0.1,
                                        "use_speaker_boost": True, "speed": 1.0})
            return self._json(200, v)
        if u.path == "/v1/user/subscription":
            self._log(200, False)
            return self._json(200, {"tier": "creator", "status": "active", "character_count": 21000,
                                    "character_limit": 121000})
        self._log(404, False)
        self._json(404, {"detail": "Not Found"})

    def do_POST(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        paid = not u.path.endswith("/music/plan")
        if not self._auth(paid):
            return
        raw = self._body()
        m = re.fullmatch(r"/v1/text-to-speech/([^/]+)/with-timestamps", u.path)
        if m:
            body = json.loads(raw)
            text = body["text"]
            if m.group(1) not in [v["voice_id"] for v in VOICES]:
                c, b = err(404, "not_found", "voice_not_found", f"A voice with voice_id {m.group(1)} was not found.")
                self._log(c, True)
                return self._json(c, b)
            if "TRIGGER_402" in text:
                c, b = err(402, "payment_required", "insufficient_credits", "You do not have enough credits.")
                self._log(c, True)
                return self._json(c, b)
            if "TRIGGER_429" in text and text not in STATE["seen_429"]:
                STATE["seen_429"].add(text)
                c, b = err(429, "rate_limit_error", "concurrent_limit_exceeded", "Too many concurrent requests.")
                self._log(c, True)
                return self._json(c, b)
            y, al = synth_tts(text, int(body.get("seed") or 0))
            audio = mp3(y)
            with LOCK:
                if text not in STATE["tts_texts"]:
                    STATE["tts_texts"].append(text)
            rid = request_id()  # (eleven.py keeps it in the block's request record)
            self._log(200, True, {"chars": len(text), "seed": body.get("seed"), "model": body.get("model_id"),
                                  "voice_settings": body.get("voice_settings"), "format": q.get("output_format"),
                                  "request_id": rid})
            return self._json(200, {"audio_base64": base64.b64encode(audio).decode(), "alignment": al,
                                    "normalized_alignment": al},
                              {"request-id": rid, "character-cost": str(len(text))})
        if u.path == "/v1/music/plan":
            body = json.loads(raw)
            if body.get("model_id") != "music_v2_5":
                c, b = err(422, "validation_error", "invalid_parameters",
                           f"Unsupported model_id {body.get('model_id')!r}: use music_v2_5.")
                self._log(c, False)
                return self._json(c, b)
            if "Beatles" in body.get("prompt", ""):
                c, b = err(400, "invalid_request", "bad_prompt", "The prompt references copyrighted material.")
                b["detail"]["data"] = {"prompt_suggestion": "upbeat 60s British guitar pop, jangly guitars"}
                self._log(c, False)
                return self._json(c, b)
            self._log(200, False, {"music_length_ms": body.get("music_length_ms")})
            return self._json(200, plan_for(body.get("prompt", ""), body.get("music_length_ms")))
        if u.path == "/v1/music/detailed":
            body = json.loads(raw)
            if body.get("model_id") != "music_v2_5" or "composition_plan" not in body:
                c, b = err(422, "validation_error", "invalid_parameters",
                           f"model_id {body.get('model_id')!r}: this request needs music_v2_5 and a composition_plan.")
                self._log(c, True)
                return self._json(c, b)
            chunks = body["composition_plan"]["chunks"]
            durs = [int(c["duration_ms"]) for c in chunks]
            seed = int(body.get("seed") or 0)
            audio = mp3(synth_music(sum(durs), durs, seed), channels=2)
            words = None
            if body.get("with_timestamps"):
                words = []
                t0 = 0
                for c, d in zip(chunks, durs):
                    lines = [l for l in c["text"].splitlines() if l.strip() and not l.startswith("[")]
                    if lines:
                        words.append({"word": "[" + c["text"].splitlines()[0].strip("[]") + "]",
                                      "start_ms": t0, "end_ms": t0 + 10})
                        k = t0 + 500
                        for line in lines:
                            for wd in line.split():
                                words.append({"word": wd, "start_ms": k, "end_ms": k + 350})
                                k += 400
                    t0 += d
            # a title and description made from the plan's styles (the model writes its own from the request)
            styles = [s.strip() for s in chunks[0].get("positive_styles") or []
                      if isinstance(s, str) and s.strip() and s.strip().lower() != "instrumental"] or ["ambient"]
            title = " ".join(w[:1].upper() + w[1:] for w in styles[0].split())
            sung = any(l.strip() and not l.startswith("[") for c in chunks for l in str(c.get("text", "")).splitlines())
            about = ", ".join(styles[:3] + ([] if sung else ["instrumental"]))
            meta = {"composition_plan": body["composition_plan"],
                    "song_metadata": {"title": title, "description": about[:1].upper() + about[1:] + ".",
                                      "genres": ["ambient"], "languages": ["en"] if sung else [], "is_explicit": False},
                    "words_timestamps": words}
            boundary = os.urandom(16).hex()
            fname = re.sub(r"[^a-z0-9]+", "_", title.lower()).strip("_") + ".mp3"
            payload = (f"--{boundary}\r\nContent-Type: application/json\r\n\r\n{json.dumps(meta)}\r\n"
                       f"--{boundary}\r\nContent-Type: audio/mpeg\r\n"
                       f"Content-Disposition: attachment; filename=\"{fname}\"\r\n\r\n").encode() + audio + \
                      f"\r\n--{boundary}--\r\n".encode()
            sha = hashlib.sha256(audio).hexdigest()
            self._log(200, True, {"seed": seed, "audio_sha256": sha, "with_timestamps": body.get("with_timestamps")})
            return self._send(200, payload, f"multipart/mixed; boundary={boundary}", {"song-id": "song_" + sha[:10]})
        if u.path == "/v1/sound-generation":
            body = json.loads(raw)
            key = body.get("text", "")
            with LOCK:
                k = STATE["sfx_calls"].get(key, 0)
                STATE["sfx_calls"][key] = k + 1
            name = SFX_ORDER[k % len(SFX_ORDER)]
            audio = (WORK / "sfx" / f"{name}.mp3").read_bytes()
            self._log(200, True, {"sound": name, "duration_seconds": body.get("duration_seconds")})
            return self._send(200, audio, "audio/mpeg", {"character-cost": "48"})
        if u.path == "/v1/speech-to-text":
            ctype = self.headers.get("Content-Type", "")
            fields = dict(re.findall(rb'name="([^"]+)"\r\n\r\n([^\r]*)\r\n', raw))
            model = fields.get(b"model_id", b"").decode()
            if model != "scribe_v2":
                c, b = err(422, "validation_error", "invalid_parameters",
                           f"Unsupported model_id {model!r}: use scribe_v2.")
                self._log(c, True)
                return self._json(c, b)
            text = " ".join(STATE["tts_texts"]).replace("dum", "doom")
            lang = "por" if re.search(r"[ãõçáéíóúâêô]", text.lower()) else "eng"  # the language it detects
            words, t = [], 0.4
            for wd in text.split():
                words.append({"text": wd, "type": "word", "start": round(t, 3), "end": round(t + 0.3, 3),
                              "logprob": -0.1})
                words.append({"text": " ", "type": "spacing", "start": round(t + 0.3, 3), "end": round(t + 0.35, 3)})
                t += 0.35
            self._log(200, True, {"multipart": "multipart/form-data" in ctype, "bytes": len(raw)})
            return self._json(200, {"language_code": lang, "language_probability": 0.98, "text": text,
                                    "words": words})
        self._log(404, paid)
        self._json(404, {"detail": "Not Found"})


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--log", help="request log (JSON lines); default evals/results/mock-elevenlabs/mock_log.jsonl")
    a = ap.parse_args()
    global LOG
    if a.log:
        LOG = Path(a.log)
    LOG.parent.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("MOCK_KEY", "eval-fake-key-0f3a9c")
    make_sfx()
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), H)
    print(f"PORT {srv.server_address[1]}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
