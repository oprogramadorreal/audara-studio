# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "httpx>=0.28,<1",
#   "pillow>=11,<13",
# ]
# ///
"""Images for the code-video skill from OpenAI's image models, each with its exact request beside it: a
plate, a texture or a backdrop that a scene loads from the video's assets/ folder. Optional: most
pictures are drawn in code, and nothing here is needed to render.

  generate   An image from a prompt (--takes N: N of them to compare): POST /v1/images/generations,
             or with --ref the edits endpoint, which follows reference images (a master frame, an
             earlier asset) so one look holds across many images. --style puts a style block before
             every prompt, for the same reason.
  pick       Make take K the image (a copy: free).

Spending: every call costs money and needs --yes. Without it the command prints what it would make
(each image: model, size, quality, transparency, estimated cost; the total) and exits 4, so the
director can say yes first; a refused run writes nothing. An OPENAI_API_KEY set for other tools is not
that yes. Generated images are assets: the API takes no seed, so an image made again is a different
image. Each is written once with <file>.request.json beside it and made again only when that request
changes (an unchanged request makes no API call), never during a render; a changed request first moves
the old file and its record to assets/older/.

Files: with --video <video>, inside an audara project (the nearest folder above with videos/): images
go to videos/<video>/assets/<name>.png, takes to assets/takes/<name>.takeK.png, replaced versions to
assets/older/. Without a project: --out DIR (default: the current folder) gets them instead. A scene
loads an image in init() by URL: new URL('../assets/<name>.png', import.meta.url).href.

Size: by default the video's aspect at 4/3 of its size (1920x1080 -> 2560x1440), so a scene can crop,
pan or push in by a third before pixels are enlarged; any size is checked against the model's limits
before a call, and a bad one gets the nearest valid size.

Key: OPENAI_API_KEY, from the environment only: never printed, written or passed on a command line.
AUDARA_IMAGES_BASE_URL (default https://api.openai.com/v1) points it at another server (a proxy, the evals'
mock); OPENAI_BASE_URL is left alone, since other tools read it for themselves. Without a key
nothing is spent: it prints what the image would cost, what a key adds and the free paths, and exits 3.

Exit codes: 0 ok, 1 error (the API's message, with a fix when there is one), 2 bad usage (a bad size or
mask is caught here, before any call), 3 no usable API key (missing or rejected), 4 needs --yes to
spend (what it would make was printed; nothing was spent).
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from fractions import Fraction
from pathlib import Path

import httpx
from PIL import Image

TOOL = "imagegen.py"
OK, ERROR, USAGE, NO_KEY, CONFIRM = 0, 1, 2, 3, 4  # eleven.py's codes, so both skills' scripts read the same

KEY_ENV = "OPENAI_API_KEY"  # the name OpenAI's SDKs and Codex use
BASE_ENV = "AUDARA_IMAGES_BASE_URL"  # not OPENAI_BASE_URL: Codex and other tools read that one for themselves
DEFAULT_BASE = "https://api.openai.com/v1"

# ---------------------------------------------------------------------------------------------
# Models, sizes and prices: the one place they live (OpenAI's docs, checked 2026-10-04)

# --model name -> the id sent. Pinned snapshots, so every image of a video comes from the same model even after
# OpenAI moves an alias. There is no bare gpt-image-2.5 id; a full id of one of these families (a newer snapshot)
# is sent as given.
MODELS = {"flare": "gpt-image-2.5-flare-2026-09-08",  # fast everyday generation: the default
          "sunburst": "gpt-image-2.5-sunburst-2026-09-08",  # editing precision: for --ref and --mask
          "gpt-image-2": "gpt-image-2"}
DEFAULT_MODEL = "flare"
QUALITIES = {"2.5": ("low", "medium", "high", "xhigh", "max", "auto"), "2": ("low", "medium", "high", "auto")}
DEFAULT_QUALITY = "high"  # a plate fills the frame at 1080p or 4K: low and medium show their smoothing there
FORMATS = ("png", "webp")  # both keep an alpha channel (transparent needs one); JPEG can't, so it is left out

PRESETS = ("1024x1024", "1536x1024", "1024x1536")  # every model takes these, and auto
STEP = 16  # a custom size's sides are multiples of 16 (gpt-image-2 and 2.5)
MAX_EDGE = 3840  # no side over 3840
MAX_RATIO = 3  # long side over short side: 3:1 at most
MIN_PIXELS, MAX_PIXELS = 655_360, 8_294_400  # 1024x640 .. 3840x2160
EXPERIMENTAL_PIXELS = 2560 * 1440  # larger is "experimental" in OpenAI's docs: allowed, said in the plan
OVERSIZE = Fraction(4, 3)  # default size = the video's x 4/3: a scene can crop, pan or push in by a third before
#                            pixels are enlarged (1920x1080 -> 2560x1440, 1080x1920 -> 1440x2560)
FALLBACK_VIDEO = (1920, 1080)  # init's video size, used outside a project or when video.json has no size
MAX_REFS = 16  # image[] of the edits endpoint
MAX_TAKES = 10  # n of one request

PRICES_CHECKED = "2026-10-04"
USD_PER_M = {"image_out": 30.0, "image_in": 8.0, "text_in": 5.0}  # per 1M tokens; flare, sunburst, gpt-image-2 alike
# Output tokens per image, from OpenAI's own calculator: a grid of `base` cells on the image's long side and
# base x short/long (rounded half to even) on its short side; tokens = ceil(cells x (2e6 + W x H) / 4e6).
# Checks: 2.5 high 1536x1024 = 1,372 tokens ($0.041), 3840x2160 high = 3,336 ($0.100). OpenAI says the 2.5
# models may count differently: it is an estimate, and the response's usage is recorded as the real cost.
OUT_BASE = {"2.5": {"low": 16, "medium": 24, "high": 48, "xhigh": 64, "max": 96},
            "2": {"low": 16, "medium": 48, "high": 96}}
AUTO_QUALITY = "high"  # quality auto is estimated as high (the model picks; the usage has what it picked)
CHARS_PER_TOKEN = 4.0  # English prompt text runs about 4 characters a token: the text-input estimate
RATE_WAIT_S = 15.0  # usage tier 1 makes 5 images a minute (12 s each): a refused request waits 15 s, then 30, 60
TERMS = ("OpenAI's terms: the output is the customer's (Services Agreement 4.1); no likeness of a real person "
         "without their consent; no imitation of a specific brand, artist or artwork.")


# ---------------------------------------------------------------------------------------------
# Output, errors (eleven.py's)


class Fail(Exception):
    def __init__(self, code: int, msg: str, data: dict | None = None):
        super().__init__(msg)
        self.code = code
        self.data = data or {}


class Out:
    """What a command reports: human lines for stdout, and the same facts as JSON for --json."""

    def __init__(self) -> None:
        self.lines: list[str] = []
        self.data: dict = {}

    def __call__(self, line: str = "") -> None:
        self.lines.append(line)


def note(msg: str) -> None:
    """Progress for long work (stderr, so --json output stays one object)."""
    print(scrub(msg), file=sys.stderr, flush=True)


def scrub(text: str) -> str:
    k = os.environ.get(KEY_ENV, "").strip()
    return text.replace(k, "[key]") if len(k) >= 8 else text


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def rel(p: Path | str) -> str:
    try:
        r = os.path.relpath(p, Path.cwd())
    except ValueError:  # another drive on Windows
        r = str(p)
    return r.replace("\\", "/")


def rel_to(p: Path, base: Path) -> str:
    try:
        return Path(p).resolve().relative_to(base.resolve()).as_posix()
    except ValueError:
        return rel(p)


def q(s: str) -> str:
    """Quote an argument for the shell (double quotes work in bash and PowerShell alike)."""
    return f"\"{s}\"" if not s or re.search(r"[\s\"'&|<>()$;`]", s) else s


def me(*args) -> str:
    """This script's command line, runnable as printed from the current folder: the script relative when it is
    near, else absolute (an installed plugin usually sits far from the project)."""
    p = Path(__file__).resolve()
    r = rel(p)
    return "uv run " + " ".join(q(str(x)) for x in (r if not r.startswith("../../") else p.as_posix(), *args))


def usd(x: float) -> str:
    return f"${x:.3f}" if x < 1 else f"${x:.2f}"


def plural(n: int, word: str) -> str:
    return f"{n} {word}{'s' if n != 1 else ''}"


# ---------------------------------------------------------------------------------------------
# Files


@dataclass
class Where:
    project: Path | None  # the audara project, or None outside one
    video: str | None  # the video's name
    video_dir: Path | None  # videos/<video>/
    assets: Path  # videos/<video>/assets/, or the --out folder
    base: Path  # the project, or the --out folder


# has_videos, find_project and video_of are eleven.py's (Where and where differ: images go to assets/).


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


def where(video: str | None, out: str | None) -> Where:
    """--video NAME: videos/NAME/assets/ in the nearest project above the current folder. --out DIR: DIR,
    outside a project. Neither: the video the current folder lies in, else the current folder outside a
    project. Inside a project an image needs its video: at the project's root no scene would load it."""
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
        vd = proj / "videos" / video
        return Where(proj, video, vd, vd / "assets", proj)
    if out:
        base = Path(out).resolve()
        return Where(None, None, None, base, base)
    hit = video_of(Path.cwd() / "_")
    if hit:
        vd = hit[0] / "videos" / hit[1]
        return Where(hit[0], hit[1], vd, vd / "assets", hit[0])
    proj = find_project(Path.cwd())
    if proj is not None:
        names = sorted(p.name for p in (proj / "videos").iterdir() if p.is_dir())
        raise Fail(USAGE, f"{proj} is an audara project: name the video with --video <video> (videos here: "
                          f"{', '.join(names) or 'none'}), or write outside it with --out DIR")
    return Where(None, None, None, Path.cwd(), Path.cwd())


def find_input(p: str, w: Where, what: str) -> Path:
    """A file as given, else in the video's assets/, the video's folder or the project."""
    for d in [Path.cwd(), w.assets, w.video_dir, w.base]:
        if d is not None and (d / p).is_file():
            return (d / p).resolve()
    raise Fail(USAGE, f"{what} not found: {p} (looked in the current folder"
                      + (f", {rel(w.assets)}/ and {rel(w.video_dir)}/" if w.video_dir else "") + ")")


def read_json(p: Path) -> dict | list | None:
    try:
        return json.loads(p.read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        return None
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise Fail(ERROR, f"{rel(p)} is not valid JSON ({e}): fix it or delete it")


def write_bytes(path: Path, data: bytes) -> bool:
    """Write only when the bytes change, so an unchanged output keeps its mtime."""
    if path.is_file() and path.stat().st_size == len(data) and path.read_bytes() == data:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    try:
        os.replace(tmp, path)
    except OSError:
        tmp.unlink(missing_ok=True)
        raise
    return True


def write_json(path: Path, obj) -> bool:
    return write_bytes(path, (json.dumps(obj, ensure_ascii=False, indent=1) + "\n").encode("utf-8"))


def side(path: Path, suffix: str = ".request.json") -> Path:
    """The file beside an image: hero.png -> hero.request.json."""
    return path.with_name(path.stem + suffix)


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def canon(obj) -> str:
    """A request as one string: what "unchanged" compares (key order and spacing don't count)."""
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def retire(path: Path, older: Path) -> Path:
    """Move a generated image and its record to older/: it was paid for, so a newer version never silently
    overwrites it (motion-video-kit keeps older versions the same way)."""
    older.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")  # noqa: DTZ005 (local time: the name is for the director)
    dst, k = older / f"{path.stem}.{stamp}{path.suffix}", 1
    while dst.exists():
        dst, k = older / f"{path.stem}.{stamp}-{k}{path.suffix}", k + 1
    try:
        os.replace(path, dst)
        if side(path).is_file():
            os.replace(side(path), side(dst))
    except OSError as e:  # Windows refuses to move a file an image viewer or editor holds open
        raise Fail(ERROR, f"cannot move {rel(path)} to {rel(older)}/ ({e.strerror or e}): it is probably open in a "
                          f"viewer or an editor. Close it and run the same command again (files already made are "
                          f"kept; nothing more was spent)")
    return dst


def save_paid(path: Path, data: bytes, record: dict, what: str) -> Path:
    """Write a paid image, then its record, the moment it arrives. If it can't go where it belongs, it is
    kept beside it under a rescue name (the next run with the same request takes it from there, with no
    API call) and the run stops, saying so."""
    try:
        write_bytes(path, data)
        write_json(side(path), record)
        return path
    except OSError as e:
        # a short name: Windows refuses paths over 260 characters, and a project can sit deep in a folder tree
        alt, k = path.with_name(f"{path.stem}.rescued{path.suffix}"), 2
        while alt.exists():
            alt, k = path.with_name(f"{path.stem}.rescued{k}{path.suffix}"), k + 1
        try:
            alt.write_bytes(data)
            side(alt).write_text(json.dumps(record, ensure_ascii=False, indent=1) + "\n", encoding="utf-8",
                                 newline="\n")
        except OSError as e2:
            raise Fail(ERROR, f"{what}: the paid image could not be written ({e.strerror or e}; {e2.strerror or e2}). "
                              f"It was billed: free some disk space or fix the folder's permissions before running "
                              f"again")
        raise Fail(ERROR, f"{what}: could not write {rel(path)} ({e.strerror or e}). The paid image is kept as "
                          f"{rel(alt)}: fix that, then run the same command again (it takes the file from there, no "
                          f"API call)")


def find_rescued(path: Path, req: dict) -> Path | None:
    """An image save_paid had to keep under a rescue name, for exactly this request."""
    for alt in sorted(path.parent.glob(f"{path.stem}.rescued*{path.suffix}")) if path.parent.is_dir() else []:
        if canon((read_json(side(alt)) or {}).get("request")) == canon(req):
            return alt
    return None


def copy_set(src: Path, dst: Path, update: dict) -> None:
    """Copy an image and its record (updated with `update`)."""
    write_bytes(dst, src.read_bytes())
    rec = read_json(side(src)) or {}
    rec.update(update)
    write_json(side(dst), rec)


# ---------------------------------------------------------------------------------------------
# Images, sizes, cost


def image_info(p: Path) -> dict:
    """Measured from the file: format, pixel size, and how much of it is see-through."""
    try:
        with Image.open(p) as im:
            info = {"format": im.format, "width": im.width, "height": im.height, "alpha": False}
            if im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info):
                hist = im.convert("RGBA").getchannel("A").histogram()
                n = im.width * im.height
                info.update(alpha=True, clear=hist[0] / n, partly=sum(hist[1:255]) / n)
            return info
    except (OSError, ValueError) as e:  # (Pillow's UnidentifiedImageError is an OSError)
        raise Fail(USAGE, f"{rel(p)} is not an image Pillow can read ({e}): give a PNG, JPEG or WebP")


def describe(info: dict) -> str:
    s = f"{info['width']}x{info['height']} {str(info['format']).lower()}"
    if info.get("alpha"):
        s += f", {info['clear']:.0%} transparent" + (f" + {info['partly']:.0%} partly" if info["partly"] >= 0.005 else "")
    return s


def size_problems(w: int, h: int) -> list[str]:
    bad = []
    off = list(dict.fromkeys(str(x) for x in (w, h) if x % STEP))
    if off:
        bad.append(f"{' and '.join(off)} {'is not a multiple' if len(off) == 1 else 'are not multiples'} of {STEP}")
    if max(w, h) > MAX_EDGE:
        bad.append(f"no side may pass {MAX_EDGE}")
    if max(w, h) > MAX_RATIO * min(w, h):
        bad.append(f"the aspect {max(w, h) / min(w, h):.2f}:1 is past {MAX_RATIO}:1")
    if w * h < MIN_PIXELS:
        bad.append(f"{w * h:,} pixels is under the minimum {MIN_PIXELS:,} (1024x640)")
    if w * h > MAX_PIXELS:
        bad.append(f"{w * h:,} pixels is over the maximum {MAX_PIXELS:,} (3840x2160)")
    return bad


def nearest_size(w: int, h: int) -> tuple[int, int]:
    """The valid size closest to w x h in aspect and area (both as log ratios, the aspect counted twice: a frame
    keeps its shape before its pixel count, so 4000x2000 becomes 3840x1920, not 3840x1984)."""
    r = min(max(w / h, 1 / MAX_RATIO), MAX_RATIO)
    area = min(max(w * h, MIN_PIXELS), MAX_PIXELS)
    cw, ch = math.sqrt(area * r), math.sqrt(area / r)
    k = min(1.0, MAX_EDGE / max(cw, ch))
    cw, ch = int(cw * k) // STEP * STEP, int(ch * k) // STEP * STEP
    best, score = (1024, 1024), math.inf
    for x in range(max(STEP, cw - 4 * STEP), cw + 5 * STEP, STEP):
        for y in range(max(STEP, ch - 4 * STEP), ch + 5 * STEP, STEP):
            if not size_problems(x, y):
                s = 2 * abs(math.log((x / y) / (w / h))) + abs(math.log(x * y / (w * h)))
                if s < score:
                    best, score = (x, y), s
    return best


def parse_size(s: str) -> tuple[int, int] | None:
    """WxH -> (W, H), auto -> None; anything the model refuses is a usage error naming the nearest valid size."""
    s = s.strip().lower()
    if s == "auto":
        return None
    m = re.fullmatch(r"(\d+)\s*[x*×]\s*(\d+)", s)
    if not m or 0 in (int(m.group(1)), int(m.group(2))):
        raise Fail(USAGE, f"--size {s}: give WxH (e.g. 2560x1440) or one of {', '.join(PRESETS)}, auto")
    w, h = int(m.group(1)), int(m.group(2))
    bad = size_problems(w, h)
    if bad:
        nw, nh = nearest_size(w, h)
        raise Fail(USAGE, f"--size {w}x{h}: {'; '.join(bad)}. The nearest valid size is {nw}x{nh} (--size {nw}x{nh}). "
                          f"Sides are multiples of {STEP}, at most {MAX_EDGE}, the aspect within 1:3 and 3:1, and "
                          f"{MIN_PIXELS:,} to {MAX_PIXELS:,} pixels; nothing was sent.")
    return w, h


def default_size(w: Where) -> tuple[tuple[int, int], str]:
    """The video's size x 4/3 in multiples of 16, within the limits; and where it came from."""
    vw, vh, src = *FALLBACK_VIDEO, f"{FALLBACK_VIDEO[0]}x{FALLBACK_VIDEO[1]} (no video.json here)"
    if w.video_dir is not None:
        size = (read_json(w.video_dir / "video.json") or {}).get("size")
        if isinstance(size, list) and len(size) == 2 and all(isinstance(x, int) and x > 0 for x in size):
            vw, vh, src = size[0], size[1], f"the video's {size[0]}x{size[1]}"
        else:
            src = f"{FALLBACK_VIDEO[0]}x{FALLBACK_VIDEO[1]} ({rel(w.video_dir / 'video.json')} has no \"size\")"
    tw, th = round(vw * OVERSIZE / STEP) * STEP, round(vh * OVERSIZE / STEP) * STEP
    if size_problems(tw, th):
        tw, th = nearest_size(tw, th)
    return (tw, th), f"{src} x 4/3"


def out_tokens(family: str, quality: str, w: int, h: int) -> int:
    base = OUT_BASE[family][AUTO_QUALITY if quality == "auto" else quality]
    u = round(Fraction(base * min(w, h), max(w, h)))  # exact, and Python's round is half to even, as OpenAI's
    return math.ceil(base * u * (2_000_000 + w * h) / 4_000_000)


def est_dims(family: str, quality: str, dims: tuple[int, int] | None) -> tuple[int, int]:
    """The size an estimate counts: size auto counts the dearest preset (the model picks)."""
    if dims:
        return dims
    return max(((int(a), int(b)) for a, b in (p.split("x") for p in PRESETS)),
               key=lambda d: out_tokens(family, quality, *d))


def estimate(family: str, quality: str, dims: tuple[int, int] | None, prompt: str, n: int) -> tuple[float, float]:
    """(dollars per image, dollars for the call): output tokens by OpenAI's calculator plus the prompt's text
    tokens (references are not estimated: their input tokens are counted from the response)."""
    w, h = est_dims(family, quality, dims)
    image = out_tokens(family, quality, w, h) * USD_PER_M["image_out"] / 1e6
    text = math.ceil(len(prompt) / CHARS_PER_TOKEN) * USD_PER_M["text_in"] / 1e6
    return image + text / n, image * n + text


def usage_cost(u, refs: bool) -> float | None:
    """The call's cost from the response's usage (parsed defensively: None when it says nothing). Input with no
    text/image breakdown counts as image input when references were sent (the dearer rate), else as text;
    every output token counts as image output."""
    if not isinstance(u, dict):
        return None

    def n(x) -> int:
        try:
            return max(0, int(x))
        except (TypeError, ValueError):
            return 0

    out_t, in_t = n(u.get("output_tokens")), n(u.get("input_tokens"))
    d = u.get("input_tokens_details") if isinstance(u.get("input_tokens_details"), dict) else {}
    text_t, img_t = n(d.get("text_tokens")), n(d.get("image_tokens"))
    if not d:
        text_t, img_t = (0, in_t) if refs else (in_t, 0)
    elif text_t + img_t < in_t:
        text_t += in_t - text_t - img_t  # tokens the breakdown leaves out: text
    if not (out_t or in_t or text_t or img_t):
        return None
    return (out_t * USD_PER_M["image_out"] + img_t * USD_PER_M["image_in"] + text_t * USD_PER_M["text_in"]) / 1e6


def spent_here(assets: Path) -> tuple[int, float]:
    """Images generated into this folder so far (takes and older versions included, picked copies not) and
    what they cost by their records."""
    n, total = 0, 0.0
    for p in assets.rglob("*.request.json") if assets.is_dir() else []:
        try:
            rec = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(rec, dict) and rec.get("kind") == "image" and "picked" not in rec:
            c = rec.get("cost") or {}
            n += 1
            total += float(c.get("actual_usd") if c.get("actual_usd") is not None else c.get("estimated_usd") or 0)
    return n, total


# ---------------------------------------------------------------------------------------------
# The API


def get_key() -> str | None:
    k = os.environ.get(KEY_ENV, "").strip()
    return k or None


def no_key(what: str, plan: list[str]) -> Fail:
    hi = {d: estimate("2.5", "high", d, "", 1)[0] for d in ((1536, 1024), (2560, 1440), (3840, 2160))}
    lines = [f"{KEY_ENV} is not set in this environment, so {what} was not generated and nothing was spent.",
             "This request would make:"] + ["  " + x for x in plan] + [
        (f"What a key adds (prices checked {PRICES_CHECKED}: image output ${USD_PER_M['image_out']:g}, image input "
         f"${USD_PER_M['image_in']:g}, text input ${USD_PER_M['text_in']:g} per 1M tokens):"),
        ("  images from a prompt (photographic or painted plates, textures, backdrops), at quality high about "
         + ", ".join(f"{usd(v)} at {d[0]}x{d[1]}" for d, v in hi.items()) + " each;"),
        "  reference images (--ref) that hold one look across many images, and masked edits (--mask);",
        "  every file kept with its exact request: renders never call the API.",
        (f"To use a key: set {KEY_ENV} in this terminal's environment (never in a project file), then run the same "
         "command again (it shows the cost; --yes spends it)."),
        "Without a key the picture doesn't wait. Go on with one of:",
        "  - draw it in code (GLSL, three.js, Canvas2D): no asset, no cost, sharp at any size;",
        "  - the director's own images, copied into the video's assets/;",
        ("  - public-domain or openly licensed images (CC0, CC BY), each with a line in assets/SOURCES.md: what, "
         "where from, author, license;"),
        ("  - under Codex, after the director's yes: its built-in image generation (no key, but it spends the "
         "ChatGPT plan's image limits), the file copied into assets/ with a line in assets/SOURCES.md."),
    ]
    return Fail(NO_KEY, "\n".join(lines), {"status": "no_key", "plan": plan})


class Api:
    def __init__(self, key: str):
        self.base = (os.environ.get(BASE_ENV, "").strip() or DEFAULT_BASE).rstrip("/")
        # long read timeout: a large high-quality image can take a minute or two (httpx gives up after 5 s idle)
        self.client = httpx.Client(base_url=self.base + "/", headers={"Authorization": f"Bearer {key}"},
                                   follow_redirects=False, timeout=httpx.Timeout(600.0, connect=15.0))

    def post(self, path: str, what: str, **kw) -> httpx.Response:
        """POST to <base>/<path> (path as in OpenAI's docs, without /v1). 429 (a rate limit, not an empty
        balance) and 503 (busy) mean the request was not processed: wait and retry."""
        billed = (" If the request reached OpenAI it may have been billed: check platform.openai.com/usage before "
                  "running again.")
        for attempt in range(4):
            try:
                r = self.client.post(path.lstrip("/"), **kw)
            except httpx.ConnectError as e:  # nothing left this machine: no bill (a sandbox without network, often)
                raise Fail(ERROR, f"{what}: couldn't connect to {self.base} ({type(e).__name__}); nothing was sent or "
                           "billed. In a sandbox without network, run the command with network access"
                           + (f"; check {BASE_ENV}" if os.environ.get(BASE_ENV) else "") + ".")
            except httpx.TimeoutException:
                raise Fail(ERROR, f"{what}: no answer from {self.base} in time." + billed)
            except httpx.HTTPError as e:
                raise Fail(ERROR, f"{what}: the connection to {self.base} failed ({type(e).__name__}). Check the network"
                           + (f" and {BASE_ENV}" if os.environ.get(BASE_ENV) else "") + "." + billed)
            if r.status_code in (429, 503) and attempt < 3 and error_of(r)[1] != "insufficient_quota":
                try:
                    wait = min(120.0, float(r.headers.get("retry-after", "")))
                except ValueError:
                    wait = RATE_WAIT_S * 2 ** attempt
                note(f"{what}: the API is busy or rate-limited (HTTP {r.status_code}); retrying in {wait:.0f} s")
                time.sleep(wait)
                continue
            if r.is_success:
                return r
            raise api_error(r, what)
        raise Fail(ERROR, f"{what}: still refused after 4 tries")


def error_of(r: httpx.Response) -> tuple[str | None, str | None, str | None]:
    """(message, code, param) of an OpenAI error body: {"error": {"message", "type", "param", "code"}}."""
    try:
        e = r.json().get("error")
    except (ValueError, AttributeError):
        return (r.text or "")[:300] or None, None, None
    if isinstance(e, dict):
        return e.get("message"), e.get("code"), e.get("param")
    return (str(e) if e else None), None, None


def api_error(r: httpx.Response, what: str) -> Fail:
    msg, code, param = error_of(r)
    rid = r.headers.get("x-request-id")
    head = (f"{what} failed: HTTP {r.status_code}" + (f" {code}" if code else "") + (f": {msg}" if msg else "")
            + (f" (request id {rid})" if rid else ""))
    low = str(msg or "").lower()
    kept = " (finished files are kept)"
    if r.status_code == 401:
        return Fail(NO_KEY, head + f"\nThe key was not accepted: set {KEY_ENV} to a valid key (platform.openai.com, "
                                   "API keys) in this terminal's environment and run the same command again.",
                    {"status": "key_rejected"})
    if code == "moderation_blocked" or "safety system" in low:
        return Fail(ERROR, head + "\nOpenAI's safety system refused it, so no image was made. Change the prompt (the "
                                  "references are checked too): describe subject, light and mood plainly; no real "
                                  "person's likeness without consent, no brand, artist or artwork to imitate.",
                    {"status": "moderation_blocked"})
    if r.status_code == 403 and "verif" in low:
        return Fail(ERROR, head + "\nThis model needs API Organization Verification first: an owner of the OpenAI "
                                  "organization completes it in the organization's settings on platform.openai.com; "
                                  "access can take a few minutes to arrive. Or try --model gpt-image-2.")
    if code == "insufficient_quota" or "billing" in low:
        return Fail(ERROR, head + "\nOut of credit or over the budget: add credit or raise the limit on "
                                  "platform.openai.com (Settings, Billing), then run the same command again" + kept + ".")
    if r.status_code == 429:
        return Fail(ERROR, head + "\nRate limit: usage tier 1 makes 5 images a minute. Wait a minute and run the same "
                                  "command again" + kept + "; fewer --takes per run stay under it.")
    if r.status_code == 403:
        return Fail(ERROR, head + "\nThis key or its project can't use that: check the project's model permissions "
                                  "on platform.openai.com, or try another --model.")
    if r.status_code == 404 or code == "model_not_found":
        return Fail(ERROR, head + f"\nThe model id may be retired or not open to this account: pass a current one "
                                  f"with --model, or update MODELS at the top of {TOOL}.")
    if r.status_code == 400 and param:
        return Fail(ERROR, head + f"\nThe API refused {param}: {TOOL} checks requests against OpenAI's docs of "
                                  f"{PRICES_CHECKED}; if the limits changed, update the constants at its top.")
    if r.status_code >= 500:
        return Fail(ERROR, head + "\nA problem on OpenAI's side: run the same command again in a minute" + kept + ".")
    return Fail(ERROR, head)


def confirm(out: Out, what: str, data: dict) -> Fail:
    out(f"Nothing was generated. Ask the director, then run the same command with --yes to {what}.")
    return Fail(CONFIRM, f"needs --yes to {what}", {"status": "needs_confirmation", **data})


# ---------------------------------------------------------------------------------------------
# generate


NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}")


def check_name(name: str) -> str:
    if not NAME_RE.fullmatch(name) or re.fullmatch(r"(?i)con|prn|aux|nul|com\d|lpt\d", name):
        raise Fail(USAGE, f"{name!r}: name the image with letters, digits, - and _ (e.g. sky-plate); it becomes "
                          f"assets/<name>.png")
    return name


def pick_model(m: str | None) -> tuple[str, str]:
    """(the id sent, its family: "2.5" or "2")."""
    mid = MODELS.get((m or DEFAULT_MODEL).lower(), m or "")
    if mid.startswith(("gpt-image-2.5-flare", "gpt-image-2.5-sunburst")):
        return mid, "2.5"
    if mid == "gpt-image-2" or mid.startswith("gpt-image-2-"):
        return mid, "2"
    hint = " (there is no bare gpt-image-2.5 id)" if mid.startswith("gpt-image-2.5") else ""
    raise Fail(USAGE, f"--model {m}{hint}: use {', '.join(MODELS)} (pinned: {', '.join(MODELS.values())}), or a full "
                      f"id of those families")


def changes(rec: dict, new: dict, inputs: dict) -> str:
    """What differs between a file's recorded request and this one, in a few words (a style block is part of the
    prompt, named by itself)."""
    old = rec.get("request") or {}
    ob, nb = old.get("body") or {}, new.get("body") or {}
    keys = [k for k in sorted(set(ob) | set(nb)) if ob.get(k) != nb.get(k)]
    style = ((rec.get("inputs") or {}).get("style") or {}).get("sha256"), (inputs.get("style") or {}).get("sha256")
    if "prompt" in keys and style[0] != style[1]:
        keys[keys.index("prompt")] = "style"
    keys += [k for k in ("images", "mask") if old.get(k) != new.get(k)]
    keys += ["endpoint"] if old.get("path") != new.get("path") else []
    return ", ".join(keys) + " changed" if keys else "another request"


def cmd_generate(a, out: Out) -> None:
    w = where(a.video, a.out)
    name = check_name(a.name)
    model, family = pick_model(a.model)
    quality = (a.quality or DEFAULT_QUALITY).lower()
    if quality not in QUALITIES[family]:
        raise Fail(USAGE, f"--quality {quality}: {model} takes {', '.join(QUALITIES[family])}")
    fmt = (a.format or "png").lower()
    if a.compression is not None and (fmt != "webp" or not 0 <= a.compression <= 100):
        raise Fail(USAGE, "--compression: 0-100, with --format webp (PNG is lossless)")
    if not 1 <= a.takes <= MAX_TAKES:
        raise Fail(USAGE, f"--takes: 1 to {MAX_TAKES} (one request makes at most {MAX_TAKES} images)")
    if a.size:
        dims, size_from = parse_size(a.size), "--size"
    else:
        dims, size_from = default_size(w)
    size = f"{dims[0]}x{dims[1]}" if dims else "auto"

    if bool(a.prompt) == bool(a.prompt_file):
        raise Fail(USAGE, "give the image's description with --prompt \"...\" or --prompt-file FILE (one of them)")
    inputs: dict = {}
    prompt = a.prompt
    if a.prompt_file:
        pf = find_input(a.prompt_file, w, "--prompt-file")
        prompt = pf.read_text(encoding="utf-8-sig")
        inputs["prompt_file"] = {"path": rel_to(pf, w.base), "sha256": sha256_file(pf)}
    prompt = prompt.strip()
    if a.style:  # the same block before every prompt: how one look holds across a video's images
        sf = find_input(a.style, w, "--style")
        prompt = sf.read_text(encoding="utf-8-sig").strip() + "\n\n" + prompt
        inputs["style"] = {"path": rel_to(sf, w.base), "sha256": sha256_file(sf)}
    if not prompt:
        raise Fail(USAGE, "the prompt is empty")

    refs = [find_input(p, w, "--ref") for p in a.ref or []]
    if len(refs) > MAX_REFS:
        raise Fail(USAGE, f"--ref: at most {MAX_REFS} reference images per request (got {len(refs)})")
    ref_info = [image_info(p) for p in refs]
    for p, i in zip(refs, ref_info):
        if i["format"] not in ("PNG", "JPEG", "WEBP"):
            raise Fail(USAGE, f"--ref {rel(p)}: {i['format']} is not taken; convert it to PNG first")
    inputs["refs"] = [{"path": rel_to(p, w.base), "sha256": sha256_file(p), "size": [i["width"], i["height"]]}
                      for p, i in zip(refs, ref_info)]
    mask = find_input(a.mask, w, "--mask") if a.mask else None
    if mask:
        if not refs:
            raise Fail(USAGE, "--mask edits a reference: give the image to edit with --ref (the mask matches the first)")
        mi = image_info(mask)
        if mi["format"] != "PNG" or not mi["alpha"]:
            raise Fail(USAGE, f"--mask {rel(mask)}: a PNG with an alpha channel, transparent where the image should "
                              f"change (this one is {describe(mi)})")
        if (mi["width"], mi["height"]) != (ref_info[0]["width"], ref_info[0]["height"]):
            raise Fail(USAGE, f"--mask {rel(mask)} is {mi['width']}x{mi['height']}: make it the first reference's size, "
                              f"{ref_info[0]['width']}x{ref_info[0]['height']} ({rel(refs[0])})")
        inputs["mask"] = {"path": rel_to(mask, w.base), "sha256": sha256_file(mask)}

    body = {"model": model, "prompt": prompt, "size": size, "quality": quality,
            "background": "transparent" if a.transparent else "opaque", "output_format": fmt}
    if a.compression is not None:
        body["output_compression"] = a.compression
    # the request as compared: references by their bytes' hash (a file moved or renamed is the same request), and
    # without n (takes of one request are that request; a call for two missing takes asks for n=2)
    req = {"method": "POST", "path": "/v1/images/edits" if refs else "/v1/images/generations", "body": body}
    if refs:
        req["images"] = [r["sha256"] for r in inputs["refs"]]
    if mask:
        req["mask"] = inputs["mask"]["sha256"]

    ext = "." + fmt
    tdir, older = w.assets / "takes", w.assets / "older"
    targets = ([(None, w.assets / f"{name}{ext}")] if a.takes == 1 else
               [(k, tdir / f"{name}.take{k}{ext}") for k in range(1, a.takes + 1)])

    def fresh(p: Path) -> bool:
        return p.is_file() and canon((read_json(side(p)) or {}).get("request")) == canon(req)

    todo = [(k, p) for k, p in targets if not fresh(p)]
    rescued = {p: alt for _, p in todo if (alt := find_rescued(p, req)) is not None}
    if rescued and (a.yes or len(rescued) == len(todo)):
        for p, alt in rescued.items():  # paid once already: taken into place, no API call
            copy_set(alt, p, {})
            alt.unlink(missing_ok=True)
            side(alt).unlink(missing_ok=True)
            out(f"{rel(p)}: taken from {alt.name}, saved by an earlier run (no API call)")
        todo = [(k, p) for k, p in todo if p not in rescued]
    others = [p for e in FORMATS if a.takes == 1 and e != fmt and (p := w.assets / f"{name}.{e}").is_file()]
    out.data.update({"name": name, "model": model, "size": size, "quality": quality, "background": body["background"],
                     "endpoint": req["path"]})
    if not todo:
        for _, p in targets:
            out(f"{rel(p)}: unchanged request, kept ({describe(image_info(p))}; no API call).")
        out.data.update({"status": "unchanged", "files": [rel(p) for _, p in targets]})
        return

    each, call = estimate(family, quality, dims, prompt, len(todo))
    label = (f"{size} (counted as {'x'.join(map(str, est_dims(family, quality, dims)))}, the dearest preset)"
             if dims is None else size)
    plan = [f"{p.stem}  {model}  {label}  quality {quality}  {body['background']}  {fmt}  about {usd(each)}"
            f" -> {rel(p)}" for _, p in todo]
    plan.append(f"total about {usd(call)} (estimate: OpenAI's calculator"
                + ("; the 2.5 models may count tokens differently" if family == "2.5" else "")
                + (f"; plus the input tokens of {plural(len(refs), 'reference')} at ${USD_PER_M['image_in']:g} per 1M"
                   if refs else "") + "; the real cost is read from the response and recorded)")
    out.data["estimate"] = {"usd_each": round(each, 4), "usd_total": round(call, 4), "images": len(todo)}
    key = get_key()
    if not key:
        raise no_key(f"the image {name}", plan)
    replaced = [(p, changes(read_json(side(p)) or {}, req, inputs)) for _, p in todo if p.is_file()]
    replaced += [(p, "format changed") for p in others]
    if not a.yes:
        out(f"Would generate {plural(len(todo), 'image')} (POST {req['path']}" + (f", n={len(todo)}" if len(todo) > 1
                                                                               else "") + "):")
        for x in plan:
            out("  " + x)
        out(f"Size from {size_from}: {size}"
            + ("; above 2560x1440 is experimental in OpenAI's docs" if dims and dims[0] * dims[1] > EXPERIMENTAL_PIXELS
               else "") + ".")
        if refs:
            out(f"References ({req['path']}): " + ", ".join(rel(p) for p in refs) + (f"; mask {rel(mask)}" if mask else ""))
        for p, why in replaced:
            out(f"Replaces {rel(p)} ({why}): it moves to {rel(older)}/ first.")
        if len(todo) > 5:
            out("Usage tier 1 makes 5 images a minute: more in one call may be refused (the script waits and retries).")
        raise confirm(out, f"generate {'it' if len(todo) == 1 else 'them'}", {"plan": plan})

    for p, _ in replaced:  # moved aside before paying: a file a viewer holds open fails here, not after
        note(f"imagegen: the earlier {p.name} moves to {rel(retire(p, older))}")
    api = Api(key)
    n = len(todo)
    note(f"imagegen: {name}: {plural(n, 'image')}, {size} {quality}"
         + (" (a large image can take a minute or more)" if not dims or dims[0] * dims[1] > 2_000_000 else ""))
    what = f"image {name}"
    if refs:
        files = [("image[]", (p.name, p.read_bytes(), f"image/{i['format'].lower()}")) for p, i in zip(refs, ref_info)]
        if mask:
            files.append(("mask", (mask.name, mask.read_bytes(), "image/png")))
        resp = api.post("images/edits", what, files=files, data={**{k: str(v) for k, v in body.items()}, "n": str(n)})
    else:
        resp = api.post("images/generations", what, json={**body, "n": n})
    try:
        j = resp.json()
        items = [d for d in j.get("data") or [] if isinstance(d, dict) and d.get("b64_json")]
    except (ValueError, AttributeError):
        j, items = None, []
    if not items:
        raw = w.assets / f"{name}.response.txt"  # the paid body as it came: nothing is thrown away
        write_bytes(raw, resp.content)
        raise Fail(ERROR, f"{what}: the response had no image (it may still have been billed). It is kept as {rel(raw)}")
    usage = j.get("usage")
    actual = usage_cost(usage, bool(refs))
    got = min(len(items), n)  # the images the call's cost is shared by (fewer than asked, when the API says so)
    made = []
    for (k, p), item in zip(todo, items):
        data = base64.b64decode(item["b64_json"])
        rec = {"kind": "image", "request": req, "inputs": inputs, "model_snapshot": model, "size": size,
               "quality": quality, "background": body["background"], "output_format": fmt, "generated": now(),
               "tool": TOOL, "n_in_call": n,
               "response": {k2: j.get(k2) for k2 in ("created", "size", "quality", "background", "output_format")
                            if j.get(k2) is not None}
               | {"request_id": resp.headers.get("x-request-id"), "usage": usage,
                  "image_sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)},
               "revised_prompt": item.get("revised_prompt"),
               "cost": {"actual_usd": round(actual / got, 5) if actual is not None else None,
                        "call_actual_usd": round(actual, 5) if actual is not None else None,
                        "estimated_usd": round(each, 5),
                        "basis": f"actual: the response's usage at ${USD_PER_M['image_out']:g} (image output), "
                                 f"${USD_PER_M['image_in']:g} (image input) and ${USD_PER_M['text_in']:g} (text input) "
                                 f"per 1M tokens, shared by the call's {plural(got, 'image')}; estimated: OpenAI's "
                                 f"calculator (prices of {PRICES_CHECKED})"},
               "license": TERMS}
        if k is not None:
            rec["take"] = k
        if os.environ.get(BASE_ENV, "").strip().rstrip("/") not in ("", DEFAULT_BASE):
            rec["server"] = api.base
        made.append((k, save_paid(p, data, rec, f"{what}" + (f" take {k}" if k else ""))))
    report(out, w, name, made, todo, actual, each, a, dims)


def report(out: Out, w: Where, name: str, made: list, todo: list, actual: float | None, each: float, a,
           dims: tuple[int, int] | None) -> None:
    n = len(made)
    cost = (f"{usd(actual)} by the API's usage" if actual is not None else "the API reported no usage") + \
        f"; estimated {usd(each * len(todo))}"
    out(f"Generated {plural(n, 'image')} ({cost}):")
    rows = []
    for _, p in made:
        info = image_info(p)
        share = f"{usd(actual / n)}" if actual is not None else f"about {usd(each)} (estimated)"
        asked = f" (asked for {dims[0]}x{dims[1]})" if dims and (info["width"], info["height"]) != dims else ""
        out(f"  {rel(p)}  {describe(info)}{asked}, {share}")
        if a.transparent and not info.get("clear"):
            out("    asked for transparency, but no pixel is see-through: cut it out in code, or ask again")
        rows.append({"file": rel(p), **info, "usd": round(actual / n, 5) if actual is not None else None})
    if len(made) < len(todo):
        out(f"The API returned {n} of {len(todo)} images: run the same command again for the rest (it makes only "
            f"what is missing).")
    gen_n, gen_usd = spent_here(w.assets)
    out(f"Spent on images in {rel(w.assets)}/ so far: {usd(gen_usd)} for {plural(gen_n, 'image')} (from their records; "
        f"takes and older versions included). The account's own total: platform.openai.com/usage.")
    out(TERMS)
    if any(k is not None for k, _ in made):
        out(f"Measured, not looked at yet: look at each take, then keep one (no API call): "
            f"{me('pick', name, *place(a), 'K')}")
    else:
        out("Measured, not looked at yet: look at it before a scene uses it.")
        if w.video_dir is not None:
            out(f"A scene loads it in init(): new URL('../assets/{made[0][1].name}', import.meta.url).href")
    out.data.update({"status": "generated", "files": rows, "actual_usd": actual, "license": TERMS})


def place(a) -> list[str]:
    return (["--video", a.video] if a.video else []) + (["--out", a.out] if a.out else [])


# ---------------------------------------------------------------------------------------------
# pick


def cmd_pick(a, out: Out) -> None:
    w = where(a.video, a.out)
    name = check_name(a.name)
    tdir = w.assets / "takes"
    cands = [p for e in FORMATS if (p := tdir / f"{name}.take{a.take}.{e}").is_file()]
    if not cands:
        have = sorted(p.name for p in tdir.glob(f"{name}.take*.*") if p.suffix[1:] in FORMATS) if tdir.is_dir() else []
        raise Fail(ERROR, f"there is no take {a.take} of {name} in {rel(tdir)}/ (takes here: {', '.join(have) or 'none'})."
                          f" Make takes with: {me('generate', name, *place(a), '--prompt', '...', '--takes', 'N')}")
    src = max(cands, key=lambda p: p.stat().st_mtime)
    main = w.assets / f"{name}{src.suffix}"
    older = w.assets / "older"
    for p in [w.assets / f"{name}.{e}" for e in FORMATS]:
        # the current image (in either format) moves to older/, unless a take holds the same bytes (it was picked
        # before: the take keeps it)
        if not p.is_file():
            continue
        h = sha256_file(p)
        if any(sha256_file(t) == h for t in tdir.glob(f"{name}.take*{p.suffix}")):
            if p != main:
                p.unlink()
                side(p).unlink(missing_ok=True)
        else:
            note(f"imagegen: the earlier {p.name} moves to {rel(retire(p, older))}")
    copy_set(src, main, {"take": a.take, "picked": now()})
    info = image_info(main)
    rec = read_json(side(main)) or {}
    out(f"{name}: take {a.take} is now {rel(main)} ({describe(info)}; a copy, no API call).")
    if rec.get("generated"):
        prompt = ((rec.get("request") or {}).get("body") or {}).get("prompt", "")
        out(f"  generated {rec['generated']} by {rec.get('model_snapshot')}: \"{prompt[:90]}"
            f"{'...' if len(prompt) > 90 else ''}\"")
    out(TERMS)
    if w.video_dir is not None:
        out(f"A scene loads it in init(): new URL('../assets/{main.name}', import.meta.url).href")
    out.data.update({"status": "picked", "file": rel(main), "take": a.take, **info})


# ---------------------------------------------------------------------------------------------
# CLI


EXAMPLES = {
    "top": """examples:
  uv run scripts/imagegen.py generate night-sky --video intro --prompt "..."            (cost; exits 4)
  uv run scripts/imagegen.py generate night-sky --video intro --prompt "..." --yes      (makes it)
  uv run scripts/imagegen.py pick night-sky --video intro 2                             (keep take 2; free)
Each subcommand has its own --help with more examples.
""",
    "generate": """examples:
  uv run scripts/imagegen.py generate night-sky --video intro --prompt "a deep blue night sky over dunes, no text"
  uv run scripts/imagegen.py generate night-sky --video intro --prompt-file videos/intro/prompts/sky.txt --yes
  uv run scripts/imagegen.py generate dunes --video intro --style videos/intro/style.txt --prompt "..." --takes 3 --yes
  uv run scripts/imagegen.py generate logo-glow --video intro --prompt "..." --transparent --size 1024x1024 --yes
  uv run scripts/imagegen.py generate dunes-dusk --video intro --ref assets/dunes.png --model sunburst --prompt "the same dunes at dusk" --yes
  uv run scripts/imagegen.py generate poster --out . --prompt "..." --quality medium                (outside a project)
Writes assets/<name>.png with <name>.request.json (--takes N: assets/takes/<name>.takeK.png, to
pick from). A changed prompt, style, size, quality, model, reference or mask moves the old file to
assets/older/ before paying for the new one. --ref uses the edits endpoint (master frames or earlier
images hold the look); --mask limits the edit. sunburst is the editing model; flare, the default,
the fast one.
""",
    "pick": """examples:
  uv run scripts/imagegen.py pick dunes --video intro 2
Copies assets/takes/<name>.take2.png and its record to assets/<name>.png (the current image moves
to assets/older/ unless a take holds it). No API call.
""",
}


class UsageError(Exception):
    pass


class Parser(argparse.ArgumentParser):
    """argparse that raises on a usage error instead of exiting, so --json can report it as JSON too."""

    def error(self, message: str):
        raise UsageError(f"{self.format_usage().rstrip()}\n{self.prog}: error: {message}")


def build_parser() -> argparse.ArgumentParser:
    RF = argparse.RawDescriptionHelpFormatter
    p = Parser(prog="imagegen.py", description=__doc__, formatter_class=RF, epilog=EXAMPLES["top"])
    sub = p.add_subparsers(dest="cmd", required=True, metavar="{generate,pick}")
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--json", action="store_true", help="print one JSON object instead of the summary")
    common.add_argument("--video", help="video name in this audara project (writes videos/<video>/assets/)")
    common.add_argument("--out", help="without a project: the folder the images go in (default .)")

    g = sub.add_parser("generate", parents=[common], formatter_class=RF, epilog=EXAMPLES["generate"],
                       help="an image (or takes) from a prompt: costs money, needs --yes",
                       description="Generate an image with OpenAI's image models, its request kept beside it. "
                                   "Without --yes: the plan and its estimated cost (exit 4); without a key: what "
                                   "it would cost and the free paths (exit 3).")
    g.add_argument("name", help="the image's name: assets/<name>.png")
    g.add_argument("--prompt", help="what the image shows: subject, composition, light, palette, medium")
    g.add_argument("--prompt-file", help="the prompt from a text file instead")
    g.add_argument("--style", help="a style block (text file) put before the prompt: the same file for every "
                                   "image of a look")
    g.add_argument("--size", help="WxH, multiples of 16, up to 3840 a side, aspect 1:3-3:1, 655,360-8,294,400 px; "
                                  f"or {', '.join(PRESETS)}, auto (default: the video's size x 4/3)")
    g.add_argument("--quality", help="low, medium, high, auto; 2.5 models also xhigh, max "
                                     f"(default {DEFAULT_QUALITY})")
    g.add_argument("--model", help=f"{', '.join(MODELS)} (default {DEFAULT_MODEL}: {MODELS[DEFAULT_MODEL]})")
    g.add_argument("--transparent", action="store_true", help="transparent background (PNG or WebP)")
    g.add_argument("--format", choices=FORMATS, help="png (default) or webp")
    g.add_argument("--compression", type=int, help="WebP compression 0-100")
    g.add_argument("--takes", type=int, default=1, help=f"N images of the same request, 1-{MAX_TAKES}, to compare "
                                                        "(in assets/takes/; then pick one)")
    g.add_argument("--ref", nargs="+", action="extend", metavar="IMG",
                   help="reference images (up to 16): uses the edits endpoint; repeatable")
    g.add_argument("--mask", help="PNG with alpha, the first reference's size: transparent where it may change")
    g.add_argument("--yes", action="store_true", help="spend the money (without it: print the plan, exit 4)")

    k = sub.add_parser("pick", parents=[common], formatter_class=RF, epilog=EXAMPLES["pick"],
                       help="make take K the image (free)", description="Copy take K of an image to its main name.")
    k.add_argument("name", help="the image's name")
    k.add_argument("take", type=int, help="the take to keep (K in <name>.takeK.png)")
    return p


def main(argv: list[str] | None = None) -> int:
    for st in (sys.stdout, sys.stderr):
        try:
            st.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    args = list(sys.argv[1:] if argv is None else argv)
    try:
        a = build_parser().parse_args(args)
    except UsageError as e:  # with --json the error is one JSON object too
        print(scrub(str(e)), file=sys.stderr)
        if "--json" in args:
            print(json.dumps({"ok": False, "exit": USAGE, "error": str(e).splitlines()[-1]}, ensure_ascii=False))
        return USAGE
    except SystemExit as e:  # --help
        return int(e.code or 0)
    out = Out()
    code, err = OK, None
    try:
        {"generate": cmd_generate, "pick": cmd_pick}[a.cmd](a, out)
    except Fail as e:
        code, err = e.code, str(e)
        out.data.update(e.data)
    except KeyboardInterrupt:
        code, err = ERROR, "interrupted (finished files are kept)"
    except Exception as e:  # noqa: BLE001 (a bug, not a usage problem: say where, briefly, and keep --json one object)
        import traceback
        tb = traceback.extract_tb(e.__traceback__)[-1]
        code, err = ERROR, (f"unexpected {type(e).__name__}: {e} ({Path(tb.filename).name} line {tb.lineno}, in "
                            f"{tb.name}); files made so far are kept")
    if getattr(a, "json", False):
        out.data.update({"ok": code == OK, "exit": code})
        if err:
            out.data["error"] = err
        print(scrub(json.dumps(out.data, ensure_ascii=False, indent=1, default=str)))
    else:
        for line in out.lines:
            print(scrub(line))
    if err:
        print(scrub(f"{TOOL} {a.cmd}: {err}"), file=sys.stderr)
    return code


if __name__ == "__main__":
    sys.exit(main())
