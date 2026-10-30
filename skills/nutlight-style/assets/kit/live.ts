// The illustration kit's live things (part of the Nutlight kit: scenes import from './index'): what is drawn every
// frame from t, on a Stage. Built in init() (layouts, seeded tables, baked parts), drawn in render().
import { clamp, hash, lerp, mod, prog, smootherstep, TAU, type V2 } from '../engine/util';
import { F, font, measure } from '../engine/type';
import { Atlas, bake, CRYSTAL_TINT, paintCrystal, paintLens, type Art } from './art';
import { gain, GLOW, lin, mixc, type Col, type Look, type RGB } from './color';
import { Path, pop } from './motion';
import type { Stage, DrawOpts } from './stage';

// ------------------------------------------------------------------------------------------------------------
// Stars
// ------------------------------------------------------------------------------------------------------------
interface Star { x: number; y: number; r: number; c: RGB; b: number; f: number; ph: number; tw: number; sp: boolean }
/** A Milky Way: a band of sky (world px, from a to b, `width` across) where stars crowd and a faint glow lies. */
export interface StarBand { a: V2; b: V2; width: number; share?: number }
/**
 * A seeded star field over a world box (at `depth`, default Infinity: fixed in the sky). Sizes follow a steep
 * power law (most are pinpricks), colours lean cool or warm, a few of the brightest carry a sparkle. Twinkle is a
 * smooth sine of t per star. "A few stars" is n ≈ 20-40; open space 200-500. A `band` gives the sky a structure
 * (a share of the stars crowd along it: a Milky Way that can lead the eye), `bright` a few big stars.
 */
export class StarField {
  stars: Star[] = [];
  constructor(public o: { seed: number; n: number; x?: number; y?: number; w?: number; h?: number; depth?: number; size?: [number, number]; sparkle?: number; band?: StarBand; bright?: number }) {
    const [x, y, w, h] = [o.x ?? 0, o.y ?? 0, o.w ?? 1920, o.h ?? 1080], [r0, r1] = o.size ?? [0.7, 2.6];
    const B = o.band, share = B ? B.share ?? 0.55 : 0;
    for (let i = 0; i < o.n; i++) {
      const u = hash(o.seed, i, 3), temp = hash(o.seed, i, 4);
      const c = temp < 0.33 ? mixc('#FFFFFF', '#FFD9A8', 0.6) : temp < 0.75 ? mixc('#FFFFFF', '#BFD8FF', 0.55) : lin('#FFFFFF');
      const b = 0.45 + 1.4 * Math.pow(hash(o.seed, i, 5), 3);
      let sx = x + hash(o.seed, i, 1) * w, sy = y + hash(o.seed, i, 2) * h;
      if (B && hash(o.seed, i, 9) < share) { // along the band: gaussian across it
        const k = hash(o.seed, i, 10), g = (hash(o.seed, i, 11) + hash(o.seed, i, 12) + hash(o.seed, i, 13) - 1.5) * 0.9;
        const dx = B.b.x - B.a.x, dy = B.b.y - B.a.y, m = Math.hypot(dx, dy) || 1;
        sx = B.a.x + dx * k - (dy / m) * g * B.width; sy = B.a.y + dy * k + (dx / m) * g * B.width;
      }
      this.stars.push({
        x: sx, y: sy, r: r0 + (r1 - r0) * Math.pow(u, 4.5), c, b,
        f: 0.15 + 0.7 * hash(o.seed, i, 6), ph: TAU * hash(o.seed, i, 7), tw: 0.08 + 0.3 * hash(o.seed, i, 8),
        sp: u > 1 - (o.sparkle ?? 0.025),
      });
    }
    for (let i = 0; i < (o.bright ?? 0); i++) { // a few bright stars, spread out
      const c = hash(o.seed, i, 21) < 0.5 ? mixc('#FFFFFF', '#FFE2B8', 0.5) : mixc('#FFFFFF', '#CFE0FF', 0.5);
      this.stars.push({ x: x + (0.08 + 0.84 * hash(o.seed, i, 22)) * w, y: y + (0.06 + 0.8 * hash(o.seed, i, 23)) * h, r: r1 * 1.25, c, b: 1.7, f: 0.2 + 0.3 * hash(o.seed, i, 24), ph: TAU * hash(o.seed, i, 25), tw: 0.12, sp: true });
    }
  }
  /** The band's faint glow (a Milky Way): a row of very soft, broad lights along it, gain kept low. */
  drawBand(st: Stage, o: { alpha?: number; depth?: number; color?: Col; gain?: number; mask?: (x: number, y: number) => number } = {}) {
    const B = this.o.band;
    if (!B) return;
    const d = o.depth ?? this.o.depth ?? Infinity, col = o.color ?? mixc(st.look.fill, st.look.horizon, 0.5), g = o.gain ?? 0.022;
    for (let i = 0; i <= 14; i++) {
      const k = i / 14, px = lerp(B.a.x, B.b.x, k), py = lerp(B.a.y, B.b.y, k), m = o.mask ? o.mask(px, py) : 1;
      if (m <= 0.01) continue;
      const ang = Math.atan2(B.b.y - B.a.y, B.b.x - B.a.x), wob = 0.75 + 0.5 * hash(this.o.seed, i, 31);
      st.glow(px, py, B.width * 2.6 * wob, col, { depth: d, gain: g * m * (0.7 + 0.6 * hash(this.o.seed, i, 32)), alpha: o.alpha, ry: B.width * 1.1 * wob, rot: ang, k: 2.4 });
    }
  }
  /** Draw (alpha 0..1 fades the field; `mask(x, y)` → 0..1 thins it where a glow or the horizon is). */
  draw(st: Stage, t: number, o: { alpha?: number; depth?: number; twinkle?: number; mask?: (x: number, y: number) => number; gain?: number } = {}) {
    const a0 = o.alpha ?? 1;
    if (a0 <= 0) return;
    const d = o.depth ?? this.o.depth ?? Infinity, tk = o.twinkle ?? 1, g0 = o.gain ?? 1;
    for (const s of this.stars) {
      const m = o.mask ? o.mask(s.x, s.y) : 1;
      if (m <= 0.01) continue;
      const tw = 1 + tk * s.tw * Math.sin(TAU * s.f * t + s.ph), a = a0 * m, g = s.b * tw * g0;
      st.glow(s.x, s.y, s.r * 4.5, s.c, { depth: d, gain: 0.16 * g, alpha: a });
      st.disc(s.x, s.y, s.r, s.c, { depth: d, gain: 1.1 * g, alpha: a, add: 0.6 });
      if (s.sp) st.sparkle(s.x, s.y, s.r * 9, s.c, { depth: d, gain: 0.55 * g, alpha: a });
    }
  }
}

// ------------------------------------------------------------------------------------------------------------
// Traffic: hyperlinks are roads, and their traffic flows
// ------------------------------------------------------------------------------------------------------------
/** Positions of n vehicles flowing along a path at time t (both ways: odd ones run back, on the other lane);
 * `angle` is the road's direction there (the way they face is angle + π for dir −1). */
export function traffic(path: Path, t: number, o: { n?: number; speed?: number; seed?: number; lane?: number; oneWay?: boolean } = {}): (V2 & { dir: number; u: number; angle: number })[] {
  const n = o.n ?? 8, len = path.len, out: (V2 & { dir: number; u: number; angle: number })[] = [];
  if (len <= 0) return out;
  for (let i = 0; i < n; i++) {
    const back = !o.oneWay && i % 2 === 1, sp = (o.speed ?? 90) * (0.8 + 0.4 * hash(o.seed ?? 0, i, 9));
    let s = mod(hash(o.seed ?? 0, i, 8) * len + sp * t, len);
    if (back) s = len - s;
    const p = path.at(s), lane = (o.lane ?? 0) * (back ? -1 : 1);
    out.push({ x: p.x - Math.sin(p.angle) * lane, y: p.y + Math.cos(p.angle) * lane, dir: back ? -1 : 1, u: s / len, angle: p.angle });
  }
  return out;
}
/** Draw a road's traffic (the links' life): small elongated capsules lying along the road, in the act's traffic
 * light (white/cyan, never a motif's amber or coral), a faint glow, entering and leaving the road softly. */
export function drawTraffic(st: Stage, path: Path, t: number, o: DrawOpts & { color?: Col; n?: number; speed?: number; seed?: number; r?: number; len?: number; lane?: number; gain?: number; oneWay?: boolean } = {}) {
  const col = o.color ?? st.look.mat.traffic, r = o.r ?? 3, L = o.len ?? r * 3.2, g = o.gain ?? GLOW.window, a0 = o.alpha ?? 1;
  for (const p of traffic(path, t, o)) {
    const a = a0 * smootherstep(0, 0.06, p.u) * smootherstep(1, 0.94, p.u);
    const cx = Math.cos(p.angle) * L / 2, cy = Math.sin(p.angle) * L / 2;
    st.glow(p.x, p.y, L * 1.2, col, { ...o, alpha: a, gain: 0.22 * g, ry: r * 2.5, rot: p.angle });
    st.capsule(p.x - cx, p.y - cy, p.x + cx, p.y + cy, r, col, { ...o, alpha: a, gain: g });
  }
}

// ------------------------------------------------------------------------------------------------------------
// Chat bubble with word-synced typing
// ------------------------------------------------------------------------------------------------------------
export interface WordTime { start: number; end?: number }
interface WordBox { text: string; art: Art; x: number; line: number; w: number }
/**
 * A chat bubble that types its text in time with the words (karaoke from word times: pass the narration's or the
 * quote's word objects). The text is set once in init() (IBM Plex Mono, ≥ 48 px: story text), word by word into
 * an atlas; the bubble grows a line as each line's first word arrives; each word lands with a small rise; a caret
 * waits after the last word while typing goes on. A generic chat window: no product's interface imitated.
 */
export class ChatBubble {
  words: WordBox[] = [];
  lines = 0;
  readonly lineH: number;
  readonly padX: number; readonly padY: number;
  readonly width: number;
  private sender: Art | null = null;
  constructor(text: string, public look: Look, o: { width?: number; size?: number; family?: string; sender?: string; atlas?: Atlas } = {}) {
    const size = Math.max(48, o.size ?? 48), fam = o.family ?? F.mono(500), maxW = o.width ?? 1100;
    this.lineH = size * 1.32; this.padX = size * 0.62; this.padY = size * 0.5;
    const atlas = o.atlas ?? new Atlas(2048, 1024);
    const space = measure(' ', fam, size);
    let x = 0, line = 0, widest = 0;
    for (const wd of text.split(/\s+/).filter(Boolean)) {
      const w = measure(wd, fam, size);
      if (x > 0 && x + w > maxW - 2 * this.padX) { line++; x = 0; }
      const art = atlas.add(Math.ceil(w) + 2, Math.ceil(size * 1.25), (c) => {
        c.fillStyle = '#FFFFFF'; c.font = font(fam, size); c.textBaseline = 'middle'; c.fillText(wd, 1, size * 0.66);
      }, { pad: 3, anchor: [0, 0.5] });
      this.words.push({ text: wd, art, x, line, w });
      x += w + space; widest = Math.max(widest, x - space);
    }
    this.lines = line + 1;
    this.width = Math.min(maxW, widest + 2 * this.padX);
    if (o.sender) this.sender = bakeSender(o.sender, look);
  }
  /**
   * Draw with its top-left at world (x, y). `times`: one per word (the voice's words), or null to type at `rate`
   * words/s from `t0`. Returns the bubble's current height.
   */
  draw(st: Stage, x: number, y: number, t: number, times: readonly WordTime[] | null, o: DrawOpts & { t0?: number; rate?: number; ink?: Col; paper?: Col; tail?: 'left' | 'right' | null; caret?: boolean } = {}) {
    const l = this.look, n = this.words.length;
    const T = (i: number) => (times ? times[Math.min(i, times.length - 1)]!.start : (o.t0 ?? 0) + i / (o.rate ?? 5));
    const first = T(0), last = T(n - 1);
    const appear = smootherstep(first - 0.35, first, t);
    if (appear <= 0) return 0;
    // the bubble grows a line when the line's first word arrives
    let lines = 1;
    for (let k = 1; k < this.lines; k++) {
      const i = this.words.findIndex((w) => w.line === k);
      lines += smootherstep(T(i) - 0.12, T(i) + 0.16, t);
    }
    const h = this.padY * 2 + this.lineH * lines, w = this.width;
    const paper = o.paper ?? l.hex.paper, ink = o.ink ?? l.hex.ink;
    const a = (o.alpha ?? 1) * appear, base: DrawOpts = { depth: o.depth, haze: o.haze, screen: o.screen, clip: o.clip };
    const sc = lerp(0.92, 1, appear);
    st.contact(x + w / 2, y + h + 6, w * 0.95, 26, { ...base, alpha: 0.28 * a });
    st.rect(x + w / 2, y + h / 2, w * sc, h * sc, paper, { ...base, alpha: a, r: 28, lit: 0.35 });
    const tail = o.tail === undefined ? 'left' : o.tail;
    if (tail) {
      const tx = tail === 'left' ? x + 46 : x + w - 46;
      st.tri(tx, y + h + 10, 34, 30, paper, { ...base, alpha: a, rot: Math.PI + (tail === 'left' ? 0.35 : -0.35) });
    }
    if (this.sender) st.sprite(this.sender, x + 8, y - 34, { ...base, anchor: [0, 0.5], alpha: a, rim: 0 });
    let lastX = x + this.padX, lastY = y + this.padY + this.lineH / 2;
    for (let i = 0; i < n; i++) {
      const wd = this.words[i]!, ti = T(i);
      if (t < ti - 0.02) break;
      const p = pop(t, ti - 0.02, { dur: 0.3, over: 0.06 });
      const wx = x + this.padX + wd.x, wy = y + this.padY + this.lineH * (wd.line + 0.5);
      st.sprite(wd.art, wx, wy + (1 - p.s) * 10, { ...base, tint: ink, alpha: a * clamp(p.a), rim: 0 });
      lastX = wx + wd.w + 6; lastY = wy;
    }
    if ((o.caret ?? true) && t > first - 0.3 && t < last + 0.8) {
      const blink = 0.55 + 0.45 * Math.cos(TAU * 1.7 * (t - first));
      st.rect(lastX + 4, lastY, 5, this.lineH * 0.62, ink, { ...base, alpha: a * blink, r: 2 });
    }
    return h;
  }
}
function bakeSender(name: string, l: Look) {
  const size = 36, fam = F.archivo(87.5, 600), w = Math.ceil(measure(name, fam, size)) + 4;
  return bake(w, Math.ceil(size * 1.2), (c) => { c.fillStyle = l.hex.paper; c.globalAlpha = 0.85; c.font = font(fam, size); c.textBaseline = 'middle'; c.fillText(name, 2, size * 0.62); }, { anchor: [0, 0.5] });
}

// ------------------------------------------------------------------------------------------------------------
// Light: the sun, a cable with a pulse, the crystal's inner light, the lens
// ------------------------------------------------------------------------------------------------------------
/** The sun: a white-hot disc with warm layered glows (gain feeds the bloom). Its rim light on things is the look's. */
export function drawSun(st: Stage, x: number, y: number, r: number, o: DrawOpts & { color?: Col; gain?: number } = {}) {
  const c = o.color ?? st.look.keyc, g = o.gain ?? 1;
  st.glow(x, y, r * 16, c, { ...o, gain: 0.12 * g, k: 3 });
  st.glow(x, y, r * 6, c, { ...o, gain: 0.35 * g, k: 3.5 });
  st.glow(x, y, r * 2.4, mixc(c, '#FFFFFF', 0.4), { ...o, gain: 1.2 * g, k: 4 });
  st.disc(x, y, r, mixc(c, '#FFFFFF', 0.7), { ...o, gain: 3.2 * g, add: 0.6 });
}
/** The moon: a pale disc with soft seas, a cool halo (a light source: it blooms a little), the night's key light. */
export function drawMoon(st: Stage, x: number, y: number, r: number, o: DrawOpts & { color?: Col; gain?: number; phase?: number } = {}) {
  const c = o.color ?? st.look.mat.moon, g = o.gain ?? 1;
  st.glow(x, y, r * 9, st.look.keyc, { ...o, gain: 0.08 * g, k: 2.6 });
  st.glow(x, y, r * 3, c, { ...o, gain: 0.3 * g, k: 3 });
  st.disc(x, y, r, c, { ...o, gain: GLOW.lamp * g });
  const sea = mixc(c, st.look.fill, 0.35);
  for (const [dx, dy, rr] of [[-0.3, -0.2, 0.28], [0.25, 0.15, 0.2], [-0.05, 0.38, 0.16], [0.32, -0.32, 0.12]] as const)
    st.disc(x + dx * r, y + dy * r, rr * r, sea, { ...o, gain: GLOW.lamp * g * 0.92, alpha: (o.alpha ?? 1) * 0.55, feather: rr * r * 0.25 });
}
/** A hanging cable from a to b (sag px at the middle), as a Path. */
export function cablePath(a: V2, b: V2, sag: number, n = 40): Path {
  return new Path(Array.from({ length: n + 1 }, (_, i) => { const u = i / n; return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) + sag * 4 * u * (1 - u) }; }));
}
/**
 * Draw a cable: a dark core with a lit edge, an optional light pulse travelling along it (pulse 0..1 along the
 * path, or null), and an optional fray (0..1: at its middle the strands part and thin out).
 */
export function drawCable(st: Stage, path: Path, o: DrawOpts & { width?: number; color?: Col; pulse?: number | null; pulseColor?: Col; fray?: number } = {}) {
  const w = o.width ?? 5, col = o.color ?? mixc(st.look.ink, st.look.fill, 0.4), fray = o.fray ?? 0;
  if (fray <= 0) {
    st.line(path.pts, w, col, o);
    st.line(path.pts.map((p) => ({ x: p.x, y: p.y - w * 0.22 })), w * 0.3, mixc(col, st.look.rim, 0.5), { ...o, alpha: (o.alpha ?? 1) * 0.6 });
  } else {
    const L = path.len, gap = L * 0.5;
    for (const k of [-1, 0, 1]) {
      const pts = path.pts.map((p, i) => {
        const s = path.L[i]!, near = Math.exp(-(((s - gap) / (L * 0.12)) ** 2));
        return { x: p.x, y: p.y + k * near * fray * w * 2.6 };
      });
      st.line(pts, w * (k === 0 ? lerp(1, 0.35, fray) : 0.38), col, o);
    }
  }
  if (o.pulse != null && o.pulse >= 0 && o.pulse <= 1) {
    const p = path.atU(o.pulse), pc = o.pulseColor ?? '#BFF4FF', fade = Math.sin(Math.PI * o.pulse);
    st.glow(p.x, p.y, w * 3.5, pc, { ...o, gain: 0.55 * fade });
    st.disc(p.x, p.y, w * 0.6, pc, { ...o, gain: 1.8, add: 0.6, alpha: (o.alpha ?? 1) * fade });
  }
}

/** The crystal vault, baked: its body (with the blurry miniature inside) and its outline. */
export interface Crystal { body: Art; w: number; h: number }
export function makeCrystal(l: Look, w: number, h: number, inner?: (c: CanvasRenderingContext2D, w: number, h: number) => void, o: { tint?: Col; innerBlur?: number; res?: number } = {}): Crystal {
  const body = bake(w, h, (c) => paintCrystal(c, w, h, l, { tint: o.tint, inner, innerBlur: o.innerBlur }), { res: o.res ?? 1.5, pad: 8, anchor: [0.5, 1] });
  return { body, w, h };
}
/** Draw the crystal standing at (x, y) (its foot), glowing from inside: a breathing core light, a pool on the table,
 * glints that travel up its edges. k 0..1 its light. */
export function drawCrystal(st: Stage, cr: Crystal, x: number, y: number, t: number, o: DrawOpts & { k?: number; scale?: number; tint?: Col } = {}) {
  const k = o.k ?? 1, s = o.scale ?? 1, tint = o.tint ?? lin(CRYSTAL_TINT), breathe = 0.85 + 0.15 * Math.sin(TAU * t / 3.1);
  const cx = x, cy = y - cr.h * 0.48 * s;
  st.glow(x, y + 2, cr.w * 1.5 * s, tint, { ...o, ry: cr.w * 0.32 * s, gain: 0.45 * k });
  st.glow(cx, cy, cr.w * 1.7 * s, tint, { ...o, gain: 0.22 * k * breathe, k: 3 });
  st.sprite(cr.body, x, y, { ...o, scale: s, gain: 1 + 0.25 * k, rimColor: mixc(tint, '#FFFFFF', 0.5), rim: 1.2 });
  st.glow(cx, cy + cr.h * 0.05 * s, cr.w * 0.55 * s, mixc(tint, '#FFFFFF', 0.5), { ...o, gain: 0.7 * k * breathe });
  for (let i = 0; i < 2; i++) {
    const u = mod(t * 0.23 + i * 0.5, 1), side = i ? 1 : -1;
    const gx = cx + side * cr.w * 0.5 * s * (1 - Math.abs(u - 0.5) * 0.2), gy = y - cr.h * s * lerp(0.22, 0.7, u);
    st.sparkle(gx, gy, cr.w * 0.16 * s, '#FFFFFF', { ...o, gain: 0.8 * k * Math.sin(Math.PI * u) });
  }
}

/** A magnifying lens, baked (its rim and handle: `handle` long, at `angle`, down and to the left by default). */
export interface Lens { rim: Art; r: number }
export function makeLens(l: Look, r: number, o: { handle?: number; angle?: number } = {}): Lens {
  // the bounds hold the rim and the handle's far end, on whichever side the handle points (paintLens puts the glass's
  // centre at (r + 10, r + 10): it moves to the bounds' origin)
  const hl = o.handle ?? r * 1.1, a = o.angle ?? Math.PI * 0.75, e = r + 6 + hl, hw = r * 0.14, R = r + 8, c0 = r + 10;
  const x0 = Math.min(-R, Math.cos(a) * e - hw), x1 = Math.max(R, Math.cos(a) * e + hw);
  const y0 = Math.min(-R, Math.sin(a) * e - hw), y1 = Math.max(R, Math.sin(a) * e + hw);
  const w = x1 - x0, h = y1 - y0;
  const rim = bake(w, h, (c) => { c.translate(-x0 - c0, -y0 - c0); paintLens(c, r, l, o); }, { pad: 12, res: 1.25, anchor: [-x0 / w, -y0 / h] });
  return { rim, r };
}
/**
 * Draw the lens with its glass centre at world (x, y): `inside` draws the world again (the same calls as the
 * scene's) and the lens shows it magnified `m` times, clipped to the glass; then a cool glass tint, a highlight
 * and the rim. Magnification is exact in screen space, for every depth.
 */
export function drawLens(st: Stage, lens: Lens, x: number, y: number, inside: () => void, o: DrawOpts & { m?: number; tint?: Col; scale?: number } = {}) {
  const p = st.project(x, y, o.depth ?? 1), s = (o.scale ?? 1) * p.s, r = lens.r * s, m = o.m ?? 1.6;
  st.withClip({ x: p.x, y: p.y, r, feather: 1.2 }, () => st.withMagnify(p.x, p.y, m, inside));
  const tint = o.tint ?? st.look.accents[0]!, a = o.alpha ?? 1;
  st.disc(p.x, p.y, r, tint, { screen: true, alpha: 0.08 * a, add: 0.6 });
  st.ring(p.x, p.y, r, r * 0.16, tint, { screen: true, alpha: 0.16 * a, add: 1, feather: r * 0.08 });
  // a crescent of reflected sky on the glass, toward the light, and a small hot glint
  const lx = st.look.L[0], ly = st.look.L[1];
  st.glow(p.x + lx * r * 0.42, p.y + ly * r * 0.42, r * 0.5, '#FFFFFF', { screen: true, gain: 0.22 * a, ry: r * 0.2, rot: Math.atan2(ly, lx) + Math.PI / 2 });
  st.disc(p.x + lx * r * 0.6, p.y + ly * r * 0.6, r * 0.045, '#FFFFFF', { screen: true, gain: 1.6, alpha: a, add: 0.5 });
  st.sprite(lens.rim, p.x, p.y, { screen: true, scale: s, alpha: o.alpha, rim: 1.3 });
}

// ------------------------------------------------------------------------------------------------------------
// The contrail and the counter
// ------------------------------------------------------------------------------------------------------------
/** One sample of a trail: where the thing was, and how long ago (s). */
export interface TrailPt { x: number; y: number; age: number }
/**
 * A contrail (a plume): what something leaves behind as it flies. Young, it is a narrow bright core; with age it
 * widens and fades, and past `life` it is gone, so the trail never ties the flyer to where it started (a kite's
 * string). Samples newest first (age 0 at the flyer). Soft (feathered), alpha-over in the act's cloud colours.
 */
export function drawPlume(st: Stage, pts: readonly TrailPt[], o: DrawOpts & { w0?: number; w1?: number; life?: number; color?: Col; core?: Col; coreK?: number; px?: boolean } = {}) {
  const life = o.life ?? 1.2, w0 = o.w0 ?? 6, w1 = o.w1 ?? 46, col = o.color ?? st.look.mat.cloud;
  const live = pts.filter((p) => p.age < life && p.age >= 0);
  if (live.length < 2) return;
  const wMax = w1;
  const body = live.map((p) => { const k = p.age / life; return { x: p.x, y: p.y, w: lerp(w0, w1, Math.sqrt(k)) / wMax, a: Math.pow(1 - k, 1.6) * smootherstep(0, 0.04, p.age + 0.02) }; });
  st.line(body, wMax, col, { ...o, feather: wMax * 0.35, px: o.px });
  const coreK = o.coreK ?? 1, young = live.filter((p) => p.age < life * 0.35);
  if (coreK > 0 && young.length > 1)
    st.line(young.map((p) => { const k = p.age / (life * 0.35); return { x: p.x, y: p.y, w: lerp(1, 0.4, k), a: (1 - k) * coreK }; }), w0 * 0.8, o.core ?? st.look.paper, { ...o, feather: w0 * 0.3, gain: GLOW.paper, px: o.px });
}

/**
 * A rolling counter (a value that changes on screen: 1 %, 100 : 1, 300 MB, 115 MB) in IBM Plex Mono, ≥ 48 px: the
 * digits 0-9 are baked once as a vertical strip and every digit is a crop of it, so a value rolls like an odometer
 * (each digit turns only while the one below it passes 9 → 0) and nothing is redrawn in render(). Other characters
 * (` :,.%` and letters) come from the same atlas.
 */
export class Counter {
  private strip: Art; private glyphs = new Map<string, Art>();
  readonly adv: number; readonly lineH: number;
  constructor(public look: Look, o: { size?: number; family?: string; chars?: string; atlas?: Atlas } = {}) {
    const size = Math.max(48, o.size ?? 56), fam = o.family ?? F.mono(500);
    this.adv = measure('0', fam, size); this.lineH = Math.round(size * 1.2);
    const lh = this.lineH, w = Math.ceil(this.adv) + 2, chars = [...new Set(o.chars ?? ' :,.%MBGkx')].filter((ch) => ch !== ' ');
    // (the strip is the first shelf's height, so every glyph fits beside it when the atlas is wide enough for all)
    const wide = chars.reduce((sum, ch) => sum + Math.ceil(measure(ch, fam, size)) + 12, w + 16);
    const atlas = o.atlas ?? new Atlas(Math.max(160, wide), lh * 12 + 40, 1.5);
    this.strip = atlas.add(w, lh * 11, (c) => {
      c.fillStyle = '#FFFFFF'; c.font = font(fam, size); c.textBaseline = 'middle';
      for (let i = 0; i <= 10; i++) c.fillText(String(i % 10), 1, lh * i + lh * 0.54);
    }, { pad: 2, rim: 0 });
    for (const ch of chars) {
      const cw = Math.ceil(measure(ch, fam, size)) + 2;
      this.glyphs.set(ch, atlas.add(cw, lh, (c) => { c.fillStyle = '#FFFFFF'; c.font = font(fam, size); c.textBaseline = 'middle'; c.fillText(ch, 1, lh * 0.54); }, { pad: 2, rim: 0 }));
    }
  }
  /** Width (px) of a text of n characters. */
  width(n: number) { return n * this.adv; }
  /**
   * Draw `text` with its left edge at x, centred on y. Each '#' in it is a digit of `value` (the last '#' the
   * units; a ',' or '.' inside the run splits off `decimals`): "### : 1" with value 100 → "100 : 1". The value may
   * be fractional while it rolls. Leading zeros are dropped (blank) unless `pad`.
   */
  draw(st: Stage, x: number, y: number, text: string, value: number, o: DrawOpts & { color?: Col; gain?: number; decimals?: number; pad?: boolean } = {}) {
    const col = o.color ?? st.look.paper, g = o.gain ?? GLOW.paper, dec = o.decimals ?? 0;
    const slots = [...text].filter((ch) => ch === '#').length, V = Math.max(0, value) * Math.pow(10, dec);
    let k = slots - 1; // the power of ten of the next '#'
    const base: DrawOpts = { depth: o.depth, haze: o.haze, alpha: o.alpha, screen: o.screen, clip: o.clip };
    const A = this.strip, H2 = A.h + 2 * A.pad;
    [...text].forEach((ch, i) => {
      const cx = x + (i + 0.5) * this.adv;
      if (ch === '#') {
        const kk = k--, p10 = Math.pow(10, kk), whole = Math.floor(V / p10), rest = V - whole * p10;
        let pos = (whole % 10) + (kk === 0 ? V - Math.floor(V) : Math.max(0, rest - (p10 - 1)));
        if (!o.pad && whole === 0 && kk > dec && pos < 0.02) return; // a leading zero: blank
        pos = mod(pos, 10);
        const v0 = (A.pad + pos * this.lineH) / H2, v1 = (A.pad + (pos + 1) * this.lineH) / H2, vc = (v0 + v1) / 2;
        st.sprite(A, cx, y - (vc - 0.5) * H2, { ...base, crop: [0, v0, 1, v1], tint: col, gain: g, rim: 0 });
      } else if (ch >= '0' && ch <= '9') { // a fixed digit, from the strip
        const pos = +ch, v0 = (A.pad + pos * this.lineH) / H2, v1 = (A.pad + (pos + 1) * this.lineH) / H2, vc = (v0 + v1) / 2;
        st.sprite(A, cx, y - (vc - 0.5) * H2, { ...base, crop: [0, v0, 1, v1], tint: col, gain: g, rim: 0 });
      } else if (ch !== ' ') {
        const gl = this.glyphs.get(ch);
        if (gl) st.sprite(gl, cx, y, { ...base, tint: col, gain: g, rim: 0 });
      }
    });
  }
}

/** Where a corner tag sits (screen px, inside the title-safe area), for st.sprite(tag, x, y, { screen: true, anchor }). */

export function corner(which: 'tl' | 'tr' | 'bl' | 'br', W = 1920, H = 1080): { x: number; y: number; anchor: [number, number] } {
  const x = which[1] === 'l' ? 96 : W - 96, y = which[0] === 't' ? 54 + 24 : H - 54 - 24;
  return { x, y, anchor: [which[1] === 'l' ? 0 : 1, which[0] === 't' ? 0 : 1] };
}

/** A gentle glow pulse 0..1 that follows a word or an event: rises fast on t0, decays over `hl` s. */
export const flare = (t: number, t0: number, hl = 0.35) => (t < t0 ? 0 : Math.exp(-(t - t0) / hl) * clamp((t - t0) / 0.05));
/** Fade in/out window. */
export const fadeIn = (t: number, a: number, d = 0.4) => prog(t, a, a + d, (x) => x * x * (3 - 2 * x));

