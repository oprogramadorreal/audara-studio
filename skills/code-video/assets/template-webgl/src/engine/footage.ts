// Streamed footage: an image sequence played as a texture, frame by frame, loaded as the video reaches it
// instead of decoded at boot, so a video can show minutes of footage (a capture of a game, a screen
// recording, the director's own clips cut into frames). A minute of 1080p at 60 fps is about 30 GB decoded;
// the boot-decoded path (the code-video skill's references/contract.md, "Images and footage") is for seconds.
//
// A shot is a folder, footage/<shot>/ at the project root by default (the dev server serves the root, so its
// URL is /footage/<shot>: footageUrl(); any other URL works too):
//   full/000001.jpg ...   the frames at the size they're shown: what render.ts reads
//   proxy/000001.jpg ...  the same frames at half that size: what the preview reads
//   manifest.json         { "frames": <how many>, "fps": <their rate> } ("proxy": false: there is no proxy/,
//                         and the preview reads full/ too)
//
// Frames load asynchronously (fetch, then createImageBitmap) and render() can't wait, so the engine calls each
// scene's prepare(t0, t1) before it renders that stretch (Engine.prepare): render.ts waits for it before every
// frame, and the preview calls it ahead of the playhead without waiting, showing the nearest frame it has
// until the exact one arrives. When render.ts renders (?export=1), a frame that wasn't prepared throws
// (strict), so a missing prepare is an error, never a stale frame in the video; a frame that fails to load
// fails the run.
//
// Time: the shot's frame at video time t is picked at frameTime(t), the time of the video frame t falls in,
// so every motion-blur sub-frame of a frame shows the same footage frame (its motion is in the picture
// already): floor((frameTime(t) - start) * fps * rate + offset), held at the shot's first and last frames.
// A scene that maps time its own way (a freeze, a ramp, a loop) asks by index: prepareFrames, prepareSet,
// frameAt.
//
// Memory: a decoded 1080p frame takes about 8 MB, a proxy 2 MB. One budget over every Footage on the page
// (BUDGET, in frames, full and proxy counted apart) drops the frames least recently asked for, but never the
// one on screen, one asked in the latest PROTECT prepare rounds (an Engine.prepare is one round, whatever
// its scenes ask for), nor one asked since a prepare render.ts waits for began, until that prepare settles and
// then while it is one of the latest PROTECT such (footageRound): verify prepares two moments, then renders
// both, and a scene whose prepare awaits its clips one after another asks for the later ones after its
// round's first call. It only decides what stays loaded: what a frame shows never depends on it.
//
// A Footage has one texture: draw it before asking it for another frame (two moments of one shot on screen
// at once take two Footage). dispose() it in the scene's dispose(), or a hot-swapped scene's frames stay
// loaded.
import * as THREE from 'three';
import { VIDEO } from '../video';

export interface FootageOptions {
  /** The shot folder's URL (it holds full/ and proxy/): footageUrl('<shot>'), or any other. */
  base: string;
  /** Frames in the shot: full/000001.jpg to full/<frames>.jpg. */
  frames: number;
  /** Their rate (default 60). */
  fps?: number;
  /** The video time at which frame `offset` shows (default 0; openFootage: the entry's start). */
  start?: number;
  /** The shot's frame (0-based) shown at `start`: the frames skipped (default 0). */
  offset?: number;
  /** Playback rate: 1 plays it as it was captured, 0.5 shows each frame twice as long, 0 holds one (default 1). */
  rate?: number;
  /** Full frames (render.ts: pass ctx.export) or proxies (the preview). */
  full: boolean;
  /** Nearest-neighbour sampling instead of linear (pixel art shown bigger). */
  nearest?: boolean;
  /** A frame not prepared throws instead of showing the nearest one (default: when render.ts renders, ?export=1). */
  strict?: boolean;
}

/** Most decoded frames kept at once over every Footage on the page: about 600 MB of 1080p full frames, 750 MB of proxies. */
export const BUDGET = { full: 72, proxy: 360 };
/** The prepare rounds whose frames are never dropped: the latest PROTECT, and the latest PROTECT waited ones (footageRound). */
export const PROTECT = 4;

/**
 * Whether the page renders for render.ts (?export=1, main.ts's own test, --as-preview included): what
 * `strict` defaults to, and whether Engine.prepare leaves a look-ahead's failure to the frame's own prepare.
 */
export const RENDERING = typeof location !== 'undefined' && new URLSearchParams(location.search).has('export');
const LIVE = new Set<Footage>();
/** The latest prepare round, and whether one is open (footageRound). */
let ROUND = 0, inRound = false;
/** The latest PROTECT waited rounds (footageRound's `waited`), and the waited rounds not settled yet. */
const WAITED: number[] = [], PENDING = new Set<number>();

/**
 * Runs `ask` as one prepare round: every frame a Footage is asked for inside it carries the same mark, so a
 * window with many shots on screen counts as one round (a prepare outside any is a round of its own).
 * Engine.prepare calls its scenes' prepare() inside one. A `waited` round, one its caller waits for before it
 * renders (render.ts's), keeps every frame asked from its start on, inside it or after it, until it settles
 * (the function returned is called then) and after that while it is one of the latest PROTECT waited
 * rounds: a scene whose prepare awaits one clip before it asks for the next asks for the later ones outside
 * the round, and a look-ahead running alongside asks for frames meanwhile.
 */
export function footageRound(ask: () => void, waited = false): () => void {
  if (inRound) { ask(); return () => {}; }
  const round = ++ROUND;
  if (waited) {
    WAITED.push(round);
    if (WAITED.length > PROTECT) WAITED.shift();
    PENDING.add(round);
  }
  const settled = () => { PENDING.delete(round); };
  inRound = true;
  try { ask(); } catch (e) { settled(); throw e; } finally { inRound = false; }
  return settled;
}

/**
 * The earliest round whose frames the budget keeps: the latest `protect` rounds (up to `round`), and every
 * frame asked since the earliest of the latest `protect` waited rounds began, or since a waited round not
 * settled yet began (footageRound).
 */
export function keptFrom(round: number, protect: number, waited: number[], pending: Iterable<number>) {
  let k = round - protect + 1;
  for (const r of waited.slice(-protect)) k = Math.min(k, r);
  for (const r of pending) k = Math.min(k, r);
  return k;
}

/**
 * The shot's frame (0-based) at video time t, in a video at `videoFps`: t is taken at its video frame's time
 * first (frameTime), so every sub-frame of a frame gets the same one; held at the shot's first and last frames.
 */
export function shotFrame(t: number, videoFps: number, o: { start: number; fps: number; rate: number; offset: number; frames: number }) {
  const tf = Math.round(t * videoFps) / videoFps;
  // (1e-6: a frame boundary computed as 4.9999999 is frame 5)
  const i = Math.floor((tf - o.start) * o.fps * o.rate + o.offset + 1e-6);
  return Math.max(0, Math.min(o.frames - 1, i));
}

/**
 * The shot's frames (0-based) shown by the video frames from t0 to t1 (either order), each once, in the
 * order they show, at most `max`: one per video frame at most, so a shot played fast loads what is on
 * screen, not every frame it passes over.
 */
export function framesShown(t0: number, t1: number, videoFps: number, o: { start: number; fps: number; rate: number; offset: number; frames: number }, max: number) {
  const out = new Set<number>();
  const a = Math.round(Math.min(t0, t1) * videoFps), b = Math.round(Math.max(t0, t1) * videoFps);
  for (let n = a; n <= b && out.size < max; n++) out.add(shotFrame(n / videoFps, videoFps, o));
  return [...out];
}

/**
 * The frames to drop to bring `held` within `cap`: least recently asked first, never one asked in round
 * `from` or later (keptFrom), nor one on screen. Fewer than that when the rest are protected.
 */
export function framesToDrop<K>(held: { key: K; asked: number; shown: boolean }[], cap: number, from: number): K[] {
  let over = held.length - cap;
  const out: K[] = [];
  if (over <= 0) return out;
  for (const h of [...held].sort((a, b) => a.asked - b.asked)) {
    if (over <= 0 || h.asked >= from) break;
    if (h.shown) continue;
    out.push(h.key);
    over--;
  }
  return out;
}

export class Footage {
  readonly texture = new THREE.Texture();
  private o: Required<FootageOptions>;
  private cache = new Map<number, ImageBitmap>();
  /** (frame -> the round that last asked for it) */
  private asked = new Map<number, number>();
  private loading = new Map<number, Promise<void>>();
  private shown = -1;
  private disposed = false;

  constructor(opts: FootageOptions) {
    const o = opts;
    this.o = {
      base: o.base.replace(/\/+$/, ''), frames: o.frames, fps: o.fps ?? 60, start: o.start ?? 0, offset: o.offset ?? 0,
      rate: o.rate ?? 1, full: o.full, nearest: o.nearest ?? false, strict: o.strict ?? RENDERING,
    };
    if (!(Number.isInteger(o.frames) && o.frames > 0)) throw new Error(`footage ${this.o.base}: frames must be a whole number above 0 (got ${o.frames})`);
    if (!(this.o.fps > 0) || !Number.isFinite(this.o.rate) || !Number.isFinite(this.o.start) || !Number.isFinite(this.o.offset))
      throw new Error(`footage ${this.o.base}: fps must be above 0, and rate, start and offset numbers`);
    const filter = this.o.nearest ? THREE.NearestFilter : THREE.LinearFilter, tex = this.texture;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = filter;
    tex.magFilter = filter;
    tex.generateMipmaps = false;
    // (the frames are decoded upside down instead: WebGL ignores flipY for an ImageBitmap)
    tex.flipY = false;
    LIVE.add(this);
  }

  get frames() { return this.o.frames; }
  get fps() { return this.o.fps; }
  get start() { return this.o.start; }
  get full() { return this.o.full; }
  /** Seconds of video the shot fills from `start` at its rate, to its last frame. */
  get duration() { return (this.o.frames - this.o.offset) / (this.o.fps * this.o.rate); }

  /** The shot's frame (0-based) shown at video time t. */
  index(t: number) { return shotFrame(t, VIDEO.fps, this.o); }
  private clamp(i: number) { return Math.max(0, Math.min(this.o.frames - 1, Math.round(i))); }
  /** The URL of frame i (0-based). */
  url(i: number) { return `${this.o.base}/${this.o.full ? 'full' : 'proxy'}/${String(i + 1).padStart(6, '0')}.jpg`; }
  private get cap() { return this.o.full ? BUDGET.full : BUDGET.proxy; }

  /**
   * Load the frames the video frames over [t0, t1] show: what a scene's prepare(t0, t1) asks of it. At a
   * rate above 1 that skips the frames passed over; at most a budget's worth, from the first.
   */
  prepare(t0: number, t1: number) { return this.want(framesShown(t0, t1, VIDEO.fps, this.o, this.cap)); }

  /** Load frames i0 to i1 (0-based, either order, clamped to the shot): at most a budget's worth, from the first. */
  prepareFrames(i0: number, i1: number) {
    const a = this.clamp(Math.min(i0, i1)), b = this.clamp(Math.max(i0, i1)), ks: number[] = [];
    for (let i = a; i <= b && ks.length < this.cap; i++) ks.push(i);
    return this.want(ks);
  }

  /** Load these frames (0-based, clamped) as one request: a freeze, a loop, a ramp. */
  prepareSet(indices: Iterable<number>) {
    return this.want([...new Set([...indices].map((i) => this.clamp(i)))].slice(0, this.cap));
  }

  /** prepare() without waiting or failing: the preview, ahead of the playhead. */
  prefetch(t0: number, t1: number) { this.prepare(t0, t1).catch(() => {}); }

  // (marked before the first await, so the frames carry the round they were asked in)
  private async want(ks: number[]) {
    const round = inRound ? ROUND : ++ROUND;
    for (const k of ks) this.asked.set(k, round);
    await Promise.all(ks.map((k) => this.load(k)));
  }

  private load(i: number): Promise<void> {
    if (this.cache.has(i)) return Promise.resolve();
    let p = this.loading.get(i);
    if (!p) {
      const url = this.url(i);
      p = (async () => {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`footage ${url}: HTTP ${r.status} (frame ${i + 1} of ${this.o.frames})`);
        let bmp: ImageBitmap;
        try { bmp = await createImageBitmap(await r.blob(), { imageOrientation: 'flipY' }); }
        catch (e) { throw new Error(`footage ${url}: can't decode it (${(e as Error).message})`); }
        if (this.disposed) return void bmp.close();
        this.cache.set(i, bmp);
        evict(this.o.full);
      })().finally(() => this.loading.delete(i));
      this.loading.set(i, p);
    }
    return p;
  }

  /** The texture, showing the frame at video time t (see frameAt). */
  frame(t: number, strict = this.o.strict): THREE.Texture { return this.frameAt(this.index(t), strict); }

  /**
   * The texture, showing frame i (0-based, clamped). One not loaded: with `strict` (render.ts) it throws, since
   * the scene's prepare() should have asked for it; otherwise the nearest loaded frame stands in, and frame i
   * starts loading.
   */
  frameAt(index: number, strict = this.o.strict): THREE.Texture {
    const i = this.clamp(index);
    let use = this.cache.has(i) ? i : -1;
    if (use < 0) {
      if (strict)
        throw new Error(`footage ${this.o.base}: frame ${i + 1} (${this.url(i)}) wasn't prepared: the scene's prepare() must ask for every time it shows (a stateful scene's preroll too, unless it skips the footage while f.preroll is true), and one call loads at most ${this.cap} frames (BUDGET)`);
      let best = Infinity;
      for (const k of this.cache.keys()) if (Math.abs(k - i) < best) { best = Math.abs(k - i); use = k; }
      this.load(i).catch(() => {});
    }
    if (use >= 0 && use !== this.shown) {
      this.texture.image = this.cache.get(use)!;
      this.texture.needsUpdate = true;
      this.shown = use;
    }
    return this.texture;
  }

  /** Whether frame i (0-based) is decoded. */
  has(i: number) { return this.cache.has(this.clamp(i)); }
  /** Whether any frame is decoded yet (until then the texture has no picture: a scene may draw something else). */
  get ready() { return this.cache.size > 0; }

  /** (what the budget sees, see evict) */
  held() { return [...this.cache.keys()].map((i) => ({ key: [this, i] as [Footage, number], asked: this.asked.get(i) ?? 0, shown: i === this.shown })); }
  drop(i: number) {
    this.cache.get(i)?.close();
    this.cache.delete(i);
    this.asked.delete(i);
  }

  dispose() {
    this.disposed = true;
    for (const b of this.cache.values()) b.close();
    this.cache.clear();
    this.asked.clear();
    this.shown = -1;
    this.texture.dispose();
    LIVE.delete(this);
  }
}

/** Keeps the decoded frames of every live Footage of one kind (full or proxy) within BUDGET. */
function evict(full: boolean) {
  const held = [...LIVE].filter((f) => f.full === full).flatMap((f) => f.held());
  for (const [f, i] of framesToDrop(held, full ? BUDGET.full : BUDGET.proxy, keptFrom(ROUND, PROTECT, WAITED, PENDING))) f.drop(i);
}

/** What a shot's manifest.json says. */
export interface FootageInfo {
  frames: number;
  fps: number;
  /** The full frames' size in px, when the manifest gives it ("size": [w, h]). */
  size: [number, number] | null;
  /** Whether the shot has proxy/ ("proxy": false says it hasn't: the preview reads full/). */
  proxy: boolean;
  /** The manifest as written (a project may keep fields of its own there). */
  manifest: Record<string, unknown>;
}

/** The FootageInfo of a manifest already read: "frames" (or "duration" in seconds), "fps" (default 60), "size", "proxy". */
export function infoOf(m: Record<string, any>, base = ''): FootageInfo {
  const fps = Number(m.fps ?? 60);
  if (!(fps > 0)) throw new Error(`footage ${base}: manifest.json's "fps" must be a number above 0`);
  const frames = Number(m.frames ?? Math.round(Number(m.duration ?? 0) * fps));
  if (!(Number.isInteger(frames) && frames > 0)) throw new Error(`footage ${base}: manifest.json needs "frames", how many files full/ holds`);
  const size: [number, number] | null = Array.isArray(m.size) && m.size.length === 2 ? [Number(m.size[0]), Number(m.size[1])] : null;
  return { frames, fps, size, proxy: m.proxy !== false, manifest: m };
}

/** Reads the manifest.json of the shot folder at `base`. */
export async function footageInfo(base: string): Promise<FootageInfo> {
  const b = base.replace(/\/+$/, ''), url = `${b}/manifest.json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`footage ${b}: no manifest.json (HTTP ${r.status} for ${url})`);
  let m: unknown;
  // (text() decodes as UTF-8 and drops a byte-order mark, which Windows PowerShell 5.1 writes and JSON.parse refuses)
  try { m = JSON.parse(await r.text()); }
  catch (e) { throw new Error(`footage ${url} is not valid JSON: ${(e as Error).message}`); }
  if (!m || typeof m !== 'object') throw new Error(`footage ${url}: not a JSON object`);
  return infoOf(m as Record<string, any>, b);
}

/** The URL of a project file by its path from the project root ('footage/intro/manifest.json'): the dev server serves the root. */
export const projectUrl = (path: string) => import.meta.env.BASE_URL + path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
/** The URL of the shot folder footage/<shot>/ at the project root. */
export const footageUrl = (shot: string) => projectUrl(`footage/${shot}`);

/**
 * A scene's Footage of `shot`, a folder in footage/ (or a shot folder's URL: one that starts with '/' or a
 * scheme), from its manifest: full frames in the export and proxies in the preview (full ones when the shot
 * has none), from the entry's start; `o` sets the rest (rate, offset, another start). Call it in init(); it
 * loads the frame the entry starts on, so the preview's first draw has a picture.
 */
export async function openFootage(ctx: { start: number; export: boolean }, shot: string, o: Partial<Omit<FootageOptions, 'base' | 'frames'>> = {}) {
  const base = /^(\/|[a-z][a-z0-9+.-]*:)/i.test(shot) ? shot : footageUrl(shot);
  const info = await footageInfo(base);
  const f = new Footage({ ...o, base, frames: info.frames, fps: o.fps ?? info.fps, start: o.start ?? ctx.start, full: o.full ?? (ctx.export || !info.proxy) });
  try { await f.prepare(ctx.start, ctx.start); }
  catch (e) { f.dispose(); throw e; }
  return f;
}
