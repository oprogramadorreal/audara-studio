# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=2.0,<3", "pillow>=11,<13"]
# ///
"""A local stand-in for the OpenAI image endpoints imagegen.py calls, with the documented request and
response shapes (OpenAI's docs, checked 2026-10-04). Never contacts the real API.

  POST /v1/images/generations   JSON in; JSON out: data[].b64_json, size, quality, background, usage
  POST /v1/images/edits         multipart in (image[] up to 16, an optional mask); the same out

The images are drawn here: a two-colour gradient and a few shapes, seeded by the prompt's hash and the
image's place in the response, at the requested size and format. background=transparent leaves all but
the shapes see-through (real alpha, soft edges). An edit's gradient starts from the first reference's
mean colour, so a test can see that the reference arrived. usage counts output tokens with OpenAI's
calculator (imagegen.py's estimate), 4% more for the 2.5 models (OpenAI says they may count
differently, so a test sees the recorded cost come from usage, not from the estimate), text at about 4
characters a token and a reference at 1 token per 1,024 pixels once fitted inside 1536x1536.

Every request is logged to the --log file (JSON lines): path, model, size, quality, n, background,
output format, how many references and whether a mask came, whether an Authorization header came and
whether its key matched, paid (a generation or edit sent with the right key: what a real key would be
charged for, whatever the outcome) and the status; never the key itself. The key it accepts is
$MOCK_KEY (default: the eval harness fake key). It checks what the API checks: the model id (there is no
bare gpt-image-2.5), size (presets, auto, or multiples of 16 within the limits), quality per model,
transparent needing png or webp, n 1-10, up to 16 references, a mask with alpha at the first
reference's size.

Triggers for error tests, in the prompt: BLOCKME -> 400 moderation_blocked; RATELIMITME -> 429
rate_limit_exceeded once (retry-after: 1), then success; VERIFYME -> 403 organization verification.
"""
import argparse
import base64
import hashlib
import io
import json
import math
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
# the request log stays out of the repo (evals/results/ is git-ignored)
LOG = HERE.parent / "results" / "mock-openai" / "mock_log.jsonl"
LOCK = threading.Lock()
STATE = {"seen_429": set()}

MODELS = {"gpt-image-2.5-flare-2026-09-08": "2.5", "gpt-image-2.5-sunburst-2026-09-08": "2.5",
          "gpt-image-2.5-flare": "2.5", "gpt-image-2.5-sunburst": "2.5", "gpt-image-2": "2"}
QUALITIES = {"2.5": ("low", "medium", "high", "xhigh", "max", "auto"), "2": ("low", "medium", "high", "auto")}
OUT_BASE = {"2.5": {"low": 16, "medium": 24, "high": 48, "xhigh": 64, "max": 96},
            "2": {"low": 16, "medium": 48, "high": 96}}
PRESETS = ("1024x1024", "1536x1024", "1024x1536")


def request_id() -> str:
    return "req_" + os.urandom(16).hex()


def err(code: int, msg: str, typ: str = "invalid_request_error", ecode: str | None = None,
        param: str | None = None) -> tuple[int, dict]:
    return code, {"error": {"message": msg, "type": typ, "param": param, "code": ecode}}


def size_error(size: str) -> str | None:
    if size == "auto" or size in PRESETS:
        return None
    m = re.fullmatch(r"(\d+)x(\d+)", size or "")
    if not m:
        return f"Invalid size '{size}'. Use WxH, one of {', '.join(PRESETS)}, or auto."
    w, h = int(m.group(1)), int(m.group(2))
    if w % 16 or h % 16 or max(w, h) > 3840 or max(w, h) > 3 * min(w, h) or not 655_360 <= w * h <= 8_294_400:
        return (f"Invalid size '{size}'. Both sides must be multiples of 16, no side over 3840, the aspect ratio "
                f"within 1:3 and 3:1, and the total between 655,360 and 8,294,400 pixels.")
    return None


def out_tokens(family: str, quality: str, w: int, h: int) -> int:
    base = OUT_BASE[family]["high" if quality == "auto" else quality]
    u = round(base * min(w, h) / max(w, h))
    t = math.ceil(base * u * (2_000_000 + w * h) / 4_000_000)
    return math.ceil(t * 1.04) if family == "2.5" else t


def draw(prompt: str, k: int, w: int, h: int, transparent: bool, tint=None) -> Image.Image:
    seed = int.from_bytes(hashlib.sha256(f"{prompt}\n{k}".encode()).digest()[:8], "big")
    rng = np.random.default_rng(seed)
    c0 = np.array(tint if tint is not None else rng.integers(0, 256, 3), np.float32)
    c1 = rng.integers(0, 256, 3).astype(np.float32)
    ang = rng.uniform(0, 2 * np.pi)
    x = (np.arange(w, dtype=np.float32) / w - 0.5)[None, :]
    y = (np.arange(h, dtype=np.float32) / h - 0.5)[:, None]
    t = np.clip((x * np.cos(ang) + y * np.sin(ang)) + 0.5, 0, 1)[..., None]
    rgb = c0 * (1 - t) + c1 * t
    alpha = np.full((h, w), 0.0 if transparent else 255.0, np.float32)
    for _ in range(int(rng.integers(3, 7))):  # circles and rectangles, 2-px soft edges
        col = rng.integers(0, 256, 3).astype(np.float32)
        cx, cy = rng.uniform(0.15, 0.85) * w, rng.uniform(0.15, 0.85) * h
        r = rng.uniform(0.05, 0.2) * min(w, h)
        xs, ys = np.arange(w, dtype=np.float32)[None, :] - cx, np.arange(h, dtype=np.float32)[:, None] - cy
        if rng.random() < 0.5:
            d = np.sqrt(xs * xs + ys * ys) - r
        else:
            d = np.maximum(np.abs(xs) - r * 1.4, np.abs(ys) - r * 0.8)
        cover = np.clip(0.5 - d / 2, 0, 1)[..., None]
        rgb = rgb * (1 - cover) + col * cover
        alpha = np.maximum(alpha, cover[..., 0] * 255)
    px = np.dstack([np.clip(rgb, 0, 255), alpha]).astype(np.uint8)
    im = Image.fromarray(px, "RGBA")
    return im if transparent else im.convert("RGB")


def encode(im: Image.Image, fmt: str, compression: int | None) -> bytes:
    buf = io.BytesIO()
    if fmt == "png":
        im.save(buf, "PNG", compress_level=3)
    elif fmt == "webp":
        im.save(buf, "WEBP", quality=100 - (compression if compression is not None else 20))
    else:
        im.convert("RGB").save(buf, "JPEG", quality=100 - (compression if compression is not None else 20))
    return buf.getvalue()


def multipart(ctype: str, raw: bytes) -> tuple[dict[str, str], list[tuple[str, str, bytes]]]:
    """(fields, files as (field name, file name, bytes)) of a multipart/form-data body."""
    m = re.search(r'boundary="?([^";]+)"?', ctype)
    fields: dict[str, str] = {}
    files: list[tuple[str, str, bytes]] = []
    if not m:
        return fields, files
    for part in raw.split(b"--" + m.group(1).encode())[1:]:
        if part.startswith(b"--"):
            break
        head, _, data = part.partition(b"\r\n\r\n")
        data = data[:-2] if data.endswith(b"\r\n") else data
        name = re.search(rb'name="([^"]*)"', head)
        fname = re.search(rb'filename="([^"]*)"', head)
        if not name:
            continue
        if fname:
            files.append((name.group(1).decode(), fname.group(1).decode(errors="replace"), data))
        else:
            fields[name.group(1).decode()] = data.decode("utf-8", "replace")
    return fields, files


class H(BaseHTTPRequestHandler):
    def version_string(self) -> str:  # the Server header OpenAI's API answers with
        return "cloudflare"

    def log_message(self, *a):  # quiet console
        pass

    def _auth(self) -> str:
        h = self.headers.get("Authorization")
        if h is None:
            return "missing"
        return "ok" if h == f"Bearer {os.environ.get('MOCK_KEY')}" else "bad"

    def _log(self, status: int, auth: str, paid: bool, extra: dict | None = None) -> None:
        rec = {"t": round(time.time(), 3), "method": self.command, "path": urlparse(self.path).path,
               "authorization": auth != "missing", "auth": auth, "paid": paid, "status": status}
        rec.update(extra or {})
        with LOCK, LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec) + "\n")

    def _json(self, code: int, obj, headers: dict | None = None) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("x-request-id", request_id())
        self.send_header("openai-version", "2020-10-01")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._log(404, self._auth(), False)
        self._json(*err(404, f"Invalid URL (GET {urlparse(self.path).path})"))

    def do_POST(self):
        path = urlparse(self.path).path
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        auth = self._auth()
        kind = {"/v1/images/generations": "generations", "/v1/images/edits": "edits"}.get(path)
        if kind is None:
            self._log(404, auth, False)
            return self._json(*err(404, f"Invalid URL (POST {path})"))
        if auth != "ok":
            self._log(401, auth, False)
            if auth == "missing":
                return self._json(*err(401, "You didn't provide an API key. You need to provide your API key in an "
                                            "Authorization header using Bearer auth (i.e. Authorization: Bearer "
                                            "YOUR_KEY). You can obtain an API key from "
                                            "https://platform.openai.com/account/api-keys."))
            return self._json(*err(401, "Incorrect API key provided. You can find your API key at "
                                        "https://platform.openai.com/account/api-keys.", ecode="invalid_api_key"))
        refs, mask = [], None
        if kind == "edits":
            if "multipart/form-data" not in self.headers.get("Content-Type", ""):
                self._log(400, auth, True)
                return self._json(*err(400, "The edits endpoint takes multipart/form-data."))
            body, files = multipart(self.headers.get("Content-Type", ""), raw)
            refs = [d for f, _, d in files if f in ("image[]", "image")]
            mask = next((d for f, _, d in files if f == "mask"), None)
        else:
            try:
                body = json.loads(raw)
            except ValueError:
                self._log(400, auth, True)
                return self._json(*err(400, "We could not parse the JSON body of your request."))
        model, prompt = body.get("model", ""), str(body.get("prompt", ""))
        size, quality = str(body.get("size", "auto")), str(body.get("quality", "auto"))
        bg, fmt = str(body.get("background", "auto")), str(body.get("output_format", "png"))
        try:
            n = int(body.get("n", 1))
            comp = int(body["output_compression"]) if body.get("output_compression") not in (None, "") else None
        except (TypeError, ValueError):
            n, comp = -1, None
        info = {"model": model, "size": size, "quality": quality, "n": n, "background": bg, "output_format": fmt,
                "refs": len(refs), "mask": mask is not None, "prompt_chars": len(prompt),
                "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest()[:16]}

        def fail(c: int, b: dict, headers: dict | None = None):
            self._log(c, auth, True, info)
            return self._json(c, b, headers)

        fam = MODELS.get(model)
        if fam is None:
            return fail(*err(404, f"The model `{model}` does not exist or you do not have access to it.",
                             ecode="model_not_found"))
        if not prompt.strip():
            return fail(*err(400, "Missing required parameter: 'prompt'.", ecode="missing_required_parameter",
                             param="prompt"))
        if (e := size_error(size)) is not None:
            return fail(*err(400, e, ecode="invalid_value", param="size"))
        if quality not in QUALITIES[fam]:
            return fail(*err(400, f"Invalid value: '{quality}'. Supported values are: "
                                  f"{', '.join(repr(x) for x in QUALITIES[fam])}.", ecode="invalid_value",
                             param="quality"))
        if bg not in ("transparent", "opaque", "auto") or fmt not in ("png", "webp", "jpeg"):
            return fail(*err(400, f"Invalid background '{bg}' or output_format '{fmt}'.", ecode="invalid_value",
                             param="background" if bg not in ("transparent", "opaque", "auto") else "output_format"))
        if bg == "transparent" and fmt == "jpeg":
            return fail(*err(400, "Transparent background requires output_format png or webp.",
                             ecode="invalid_value", param="background"))
        if not 1 <= n <= 10:
            return fail(*err(400, "n must be between 1 and 10.", ecode="invalid_value", param="n"))
        if kind == "edits" and not 1 <= len(refs) <= 16:
            return fail(*err(400, "Provide 1 to 16 images in image[].", ecode="invalid_value", param="image"))
        ref_ims = []
        for d in refs + ([mask] if mask is not None else []):
            try:
                ref_ims.append(Image.open(io.BytesIO(d)))
            except OSError:
                return fail(*err(400, "Invalid image file or mode for image or mask.", ecode="invalid_image",
                                 param="image"))
        if mask is not None:
            m, first = ref_ims[-1], ref_ims[0]
            if m.format != "PNG" or m.mode not in ("RGBA", "LA") or m.size != first.size:
                return fail(*err(400, "Invalid mask: it must be a PNG with an alpha channel, the same size as the "
                                      "first image.", ecode="invalid_value", param="mask"))
        if "BLOCKME" in prompt:
            return fail(*err(400, "Your request was rejected as a result of our safety system. Your request may "
                                  "contain content that is not allowed by our safety system.",
                             typ="image_generation_user_error", ecode="moderation_blocked"))
        if "VERIFYME" in prompt:
            return fail(*err(403, f"Your organization must be verified to use the model `{model}`. Please go to: "
                                  "https://platform.openai.com/settings/organization/general and click on Verify "
                                  "Organization. If you just verified, it can take up to 15 minutes for access to "
                                  "propagate."))
        if "RATELIMITME" in prompt and prompt not in STATE["seen_429"]:
            STATE["seen_429"].add(prompt)
            return fail(*err(429, f"Rate limit reached for {model} on images per minute (IPM): Limit 5, Used 5, "
                                  "Requested 1. Please try again in 12s.", typ="requests",
                             ecode="rate_limit_exceeded"), {"retry-after": "1"})
        w, h = (1024, 1024) if size == "auto" else map(int, size.split("x"))
        tint = None
        if ref_ims:  # an edit starts from the first reference's mean colour
            tint = np.asarray(ref_ims[0].convert("RGB").resize((16, 16))).reshape(-1, 3).mean(0)
        transparent = bg == "transparent"
        data = [{"b64_json": base64.b64encode(encode(draw(prompt, k, w, h, transparent, tint), fmt, comp)).decode()}
                for k in range(n)]
        q = "high" if quality == "auto" else quality
        img_in = 0
        for im in ref_ims[:len(refs)]:
            s = min(1.0, 1536 / max(im.size))
            img_in += math.ceil(im.size[0] * s * im.size[1] * s / 1024)
        text_in = math.ceil(len(prompt) / 4)
        out = out_tokens(fam, q, w, h) * n
        usage = {"input_tokens": text_in + img_in, "input_tokens_details": {"text_tokens": text_in,
                                                                            "image_tokens": img_in},
                 "output_tokens": out, "total_tokens": text_in + img_in + out}
        self._log(200, auth, True, {**info, "usage": usage})
        return self._json(200, {"created": int(time.time()), "background": "transparent" if transparent else "opaque",
                                "data": data, "output_format": fmt, "quality": q, "size": f"{w}x{h}",
                                "usage": usage}, {"openai-processing-ms": "4210"})


def main() -> None:
    ap = argparse.ArgumentParser(description="Mock of OpenAI's image endpoints for imagegen.py tests.")
    ap.add_argument("--port", type=int, default=0, help="port (0: any free one; printed as PORT <n>)")
    ap.add_argument("--log", help="request log (JSON lines); default evals/results/mock-openai/mock_log.jsonl")
    a = ap.parse_args()
    global LOG
    if a.log:
        LOG = Path(a.log)
    LOG.parent.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("MOCK_KEY", "eval-fake-key-0f3a9c")
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), H)
    print(f"PORT {srv.server_address[1]}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
