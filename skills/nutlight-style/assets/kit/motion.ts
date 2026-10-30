// The illustration kit's motion (part of the Nutlight kit: scenes import from './index'). Every helper is a pure
// function of time: no state, no dt. Times come from the words (ctx.words), durations are craft.
import { W, H } from '../engine/gl';
import { clamp, ease, lerp, noise1, polylineLengths, pointAtLength, smootherstep, smoothKeys, springStep, TAU, type V2 } from '../engine/util';

// ------------------------------------------------------------------------------------------------------------
// Arrivals and secondary motion
// ------------------------------------------------------------------------------------------------------------
/** Eased progress 0..1 of t through [a, b] that starts and ends at rest (the default for anything mid-shot). */
export const glide = (t: number, a: number, b: number) => smootherstep(a, b, t);

export interface Pop { s: number; sx: number; sy: number; a: number; v: number }
/**
 * A "pop" arrival caused by something the viewer hears or sees (a word, a hit): scale 0 → 1 with an overshoot
 * (a damped spring), stretched along y while it rises fast and squashed as it overshoots (volume kept), alpha
 * up in the first 30 % of `dur`. Before t0: s = 0. Use sx, sy as the sprite's scale; `v` is the spring's speed.
 */
export function pop(t: number, t0: number, o: { dur?: number; over?: number; squash?: number } = {}): Pop {
  const dur = o.dur ?? 0.55, u = t - t0;
  if (u <= 0) return { s: 0, sx: 0, sy: 0, a: 0, v: 0 };
  // damping from the overshoot asked for; the first peak at 40 % of dur
  const lo = Math.log(clamp(o.over ?? 0.12, 0.005, 0.6)), damping = -lo / Math.sqrt(Math.PI * Math.PI + lo * lo);
  const freq = Math.PI / (0.4 * dur * Math.sqrt(1 - damping * damping)) / TAU;
  const s = springStep(u, freq, damping), h = 1 / 240;
  const v = (springStep(u + h, freq, damping) - springStep(Math.max(0, u - h), freq, damping)) / (2 * h) * dur;
  const st = clamp(v * (o.squash ?? 0.18) * 0.35, -0.3, 0.3);
  return { s, sx: s * (1 - st * 0.5), sy: s * (1 + st), a: clamp(u / (dur * 0.3)), v };
}
/** A damped spring from a to b, released at t0 (overshoots; zero before t0). */
export const spring = (t: number, t0: number, a = 0, b = 1, freq = 2, damping = 0.4) => lerp(a, b, springStep(t - t0, freq, damping));
/** Start time of item i of n when their entrances spread over `span` seconds from t0 (eased spacing). */
export function stagger(i: number, n: number, t0: number, span: number, e: (x: number) => number = ease.outQuad) {
  return t0 + span * (n > 1 ? e(i / (n - 1)) : 0);
}
/** A gentle float (px): a sine with a little seeded noise, for things that hover or breathe. */
export function bob(t: number, amp = 6, period = 3.2, seed = 0) {
  return amp * (0.82 * Math.sin((TAU * t) / period + seed * 2.39) + 0.18 * noise1(t / period * 1.7, seed + 11));
}
/** A slow sway (radians), out of phase with bob for the same seed. */
export function sway(t: number, amp = 0.03, period = 4.1, seed = 0) {
  return amp * (0.8 * Math.sin((TAU * t) / period + seed * 1.71 + 1.3) + 0.2 * noise1(t / period * 1.3, seed + 23));
}
/** Follow-through: the value of `f` a little earlier (a lag of `lag` s), for parts that trail the body. */
export const trail = (f: (t: number) => number, t: number, lag = 0.08) => f(t - lag);
/** Projectile motion from p0 with velocity v0 (px/s), gravity g (px/s², +y down), from t0; holds p0 before. */
export function ballistic(t: number, t0: number, p0: V2, v0: V2, g = 1800): V2 {
  const u = Math.max(0, t - t0);
  return { x: p0.x + v0.x * u, y: p0.y + v0.y * u + 0.5 * g * u * u };
}
/** A smooth camera shake (px) that fades in/out with `env` (0..1): noise, not a per-frame jitter. */
export function shake(t: number, amp: number, freq = 9, seed = 0): [number, number] {
  return [amp * noise1(t * freq, seed + 1), amp * noise1(t * freq, seed + 7)];
}

// ------------------------------------------------------------------------------------------------------------
// Paths
// ------------------------------------------------------------------------------------------------------------
/** A path: points with arc length, for motion along it (where) and draw-on (how much), set apart from timing (when). */
export class Path {
  readonly L: Float32Array;
  constructor(readonly pts: V2[]) { this.L = polylineLengths(pts); }
  get len() { return this.L[this.L.length - 1] ?? 0; }
  /** Point and tangent angle at arc length s (clamped). */
  at(s: number) { return pointAtLength(this.pts, this.L, s); }
  /** …at a fraction u of the length. */
  atU(u: number) { return this.at(clamp(u) * this.len); }
  /** The points between arc lengths s0 and s1 (for a partly drawn line). */
  slice(s0: number, s1: number): V2[] {
    s0 = clamp(s0, 0, this.len); s1 = clamp(s1, 0, this.len);
    if (s1 <= s0) return [];
    const out: V2[] = [this.at(s0)];
    for (let i = 0; i < this.pts.length; i++) if (this.L[i]! > s0 && this.L[i]! < s1) out.push(this.pts[i]!);
    out.push(this.at(s1));
    return out;
  }
  /** A straight segment. */
  static line(a: V2, b: V2, n = 2) { return new Path(Array.from({ length: n }, (_, i) => ({ x: lerp(a.x, b.x, i / (n - 1)), y: lerp(a.y, b.y, i / (n - 1)) }))); }
  /** A cubic Bézier. */
  static bezier(p0: V2, c0: V2, c1: V2, p1: V2, n = 64) {
    const pts: V2[] = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n, v = 1 - u;
      pts.push({ x: v * v * v * p0.x + 3 * v * v * u * c0.x + 3 * v * u * u * c1.x + u * u * u * p1.x, y: v * v * v * p0.y + 3 * v * v * u * c0.y + 3 * v * u * u * c1.y + u * u * u * p1.y });
    }
    return new Path(pts);
  }
  /** A circular or elliptical arc (radians, y down: positive angles turn clockwise on screen). */
  static arc(cx: number, cy: number, rx: number, a0: number, a1: number, n = 96, ry = rx) {
    return new Path(Array.from({ length: n + 1 }, (_, i) => { const a = lerp(a0, a1, i / n); return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry }; }));
  }
  /** A smooth curve through points (Catmull-Rom), `per` samples per span. */
  static through(points: V2[], closed = false, per = 24, tension = 0.5) {
    const n = points.length, P = (i: number) => (closed ? points[((i % n) + n) % n]! : points[clamp(i, 0, n - 1)]!);
    const out: V2[] = [];
    const spans = closed ? n : n - 1;
    for (let s = 0; s < spans; s++) {
      const p0 = P(s - 1), p1 = P(s), p2 = P(s + 1), p3 = P(s + 2), k = tension;
      for (let j = 0; j < per; j++) {
        const u = j / per, u2 = u * u, u3 = u2 * u;
        const m1x = (p2.x - p0.x) * k, m1y = (p2.y - p0.y) * k, m2x = (p3.x - p1.x) * k, m2y = (p3.y - p1.y) * k;
        out.push({
          x: (2 * u3 - 3 * u2 + 1) * p1.x + (u3 - 2 * u2 + u) * m1x + (-2 * u3 + 3 * u2) * p2.x + (u3 - u2) * m2x,
          y: (2 * u3 - 3 * u2 + 1) * p1.y + (u3 - 2 * u2 + u) * m1y + (-2 * u3 + 3 * u2) * p2.y + (u3 - u2) * m2y,
        });
      }
    }
    out.push(closed ? { ...points[0]! } : { ...points[n - 1]! });
    return new Path(out);
  }
}
/** Points spaced evenly by arc length (n of them; a closed shape doesn't repeat its first point). */
export function resample(pts: V2[], n: number, closed = true): V2[] {
  const ring = closed ? [...pts, pts[0]!] : pts;
  const L = polylineLengths(ring), len = L[L.length - 1]!;
  return Array.from({ length: n }, (_, i) => { const p = pointAtLength(ring, L, (len * i) / (closed ? n : n - 1)); return { x: p.x, y: p.y }; });
}
/** Morph between two closed shapes (any point counts): both resampled to n, aligned to the start that twists
 * least, then mixed. Draw the result with st.poly(). */
export function morph(a: V2[], b: V2[], k: number, n = 48): V2[] {
  const A = resample(a, n), B = resample(b, n);
  let best = 0, bestD = Infinity;
  for (let o = 0; o < n; o++) {
    let d = 0;
    for (let i = 0; i < n; i += 4) { const p = A[i]!, q = B[(i + o) % n]!; d += (p.x - q.x) ** 2 + (p.y - q.y) ** 2; }
    if (d < bestD) { bestD = d; best = o; }
  }
  return A.map((p, i) => { const q = B[(i + best) % n]!; return { x: lerp(p.x, q.x, k), y: lerp(p.y, q.y, k) }; });
}

// ------------------------------------------------------------------------------------------------------------
// The camera, and the moves that connect scenes
// ------------------------------------------------------------------------------------------------------------
/**
 * A 2D camera: the world point at the frame's centre, zoom (screen px per world px on the focal plane), roll,
 * and an optional dolly `back` (in focal-plane distances): pulled back by B, a layer at depth d shrinks by
 * d / (d + B), so near things fall away fast and the horizon slowly (a rise above a town). `zoom` alone is a push
 * that scales a layer by zoom^(1/depth).
 */
export interface Cam { x: number; y: number; zoom: number; rot: number; back?: number }
export const cam = (x = W / 2, y = H / 2, zoom = 1, rot = 0, back = 0): Cam => ({ x, y, zoom, rot, back });
/** Between two cameras (zoom in log space, so a zoom feels even; the dolly in log(1 + back)). */
export function camLerp(a: Cam, b: Cam, k: number): Cam {
  const B = Math.exp(lerp(Math.log(1 + (a.back ?? 0)), Math.log(1 + (b.back ?? 0)), k)) - 1;
  return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), zoom: Math.exp(lerp(Math.log(a.zoom), Math.log(b.zoom), k)), rot: lerp(a.rot, b.rot, k), back: B };
}
/** A camera move through keys without stopping at each (monotone cubic per component, zoom in log space). */
export function camKeys(t: number, ks: [number, Cam][], ends: 'rest' | 'free' = 'rest'): Cam {
  const comp = (f: (c: Cam) => number) => smoothKeys(t, ks.map(([tt, c]) => [tt, f(c)] as [number, number]), ends);
  return { x: comp((c) => c.x), y: comp((c) => c.y), zoom: Math.exp(comp((c) => Math.log(c.zoom))), rot: comp((c) => c.rot), back: Math.exp(comp((c) => Math.log(1 + (c.back ?? 0)))) - 1 };
}
/** The camera that frames a world rect (x, y, w, h: top-left and size) lying at `depth`, with a margin. */
export function frameRect(x: number, y: number, w: number, h: number, o: { depth?: number; pad?: number; rot?: number } = {}): Cam {
  const d = o.depth ?? 1, s = Math.min(W / w, H / h) * (1 - (o.pad ?? 0.08));
  const cx = x + w / 2, cy = y + h / 2;
  return { x: W / 2 + (cx - W / 2) * d, y: H / 2 + (cy - H / 2) * d, zoom: Math.pow(s, d), rot: o.rot ?? 0 };
}
/**
 * Zoom-through: from camera `from`, push into a world rect at `depth` until it covers the frame `fill` times
 * over (fill 1 frames it, 3 flies through it). Position settles early, zoom accelerates into the object: the
 * next scene starts inside it (match its first camera to the object's last pose). k: 0..1 progress.
 */
export function zoomThrough(k: number, from: Cam, rect: { x: number; y: number; w: number; h: number; depth?: number }, fill = 3): Cam {
  const d = rect.depth ?? 1, to = frameRect(rect.x, rect.y, rect.w, rect.h, { depth: d, pad: 0 });
  to.zoom *= Math.pow(fill, d);
  const kp = smootherstep(0, 0.75, k), kz = ease.inOutCubic(k) * 0.35 + ease.inCubic(k) * 0.65;
  const pos = camLerp(from, to, kp), z = camLerp(from, to, kz);
  return { x: pos.x, y: pos.y, zoom: z.zoom, rot: pos.rot };
}
