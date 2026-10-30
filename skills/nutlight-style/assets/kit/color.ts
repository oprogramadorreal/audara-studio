// The illustration kit's colour and light (part of the Nutlight kit: scenes import from './index').
// A palette becomes a Look: the same colours as hex (Canvas2D) and linear (GL), the key light as a screen direction,
// the post. Looks mix (mixLook) for a light that changes inside a scene and across a hand-over.
import { ACTS, THREAD, type ActKey, type ActTokens, type MaterialKey } from './palette';
import type { PostParams } from '../engine/post';
import { clamp, lerp } from '../engine/util';

export type RGB = [number, number, number];
/** A colour as the kit takes it: '#rrggbb' (sRGB) or a linear triplet (may exceed 1 to glow). */
export type Col = string | RGB;

// ---- colour maths ----
const s2l = (s: number) => (s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4));
const l2s = (l: number) => (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);
const LIN_CACHE = new Map<string, RGB>();
/** '#rrggbb' → linear RGB (cached). A triplet passes through. */
export function lin(c: Col): RGB {
  if (typeof c !== 'string') return c;
  let v = LIN_CACHE.get(c);
  if (!v) {
    const n = parseInt(c.replace('#', ''), 16);
    v = [s2l(((n >> 16) & 255) / 255), s2l(((n >> 8) & 255) / 255), s2l((n & 255) / 255)];
    LIN_CACHE.set(c, v);
  }
  return v;
}
/** Linear RGB (0..1) → '#rrggbb'. */
export function hex(c: Col): string {
  if (typeof c === 'string') return c;
  const b = (x: number) => Math.round(clamp(l2s(clamp(x)), 0, 1) * 255).toString(16).padStart(2, '0');
  return `#${b(c[0])}${b(c[1])}${b(c[2])}`;
}
/** CSS rgba() of a colour at alpha a (Canvas2D). */
export function css(c: Col, a = 1): string {
  const h = hex(c), n = parseInt(h.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
/** Mix two colours in linear light (k 0 → a, 1 → b). Returns linear. */
export function mixc(a: Col, b: Col, k: number): RGB {
  const x = lin(a), y = lin(b);
  return [lerp(x[0], y[0], k), lerp(x[1], y[1], k), lerp(x[2], y[2], k)];
}
/** Mix and return hex (for Canvas2D painters). */
export const mixh = (a: Col, b: Col, k: number) => hex(mixc(a, b, k));
/** Mix in sRGB (perceptual) and return hex: for value design, where "45 % toward the shadow" should look 45 %
 * darker (in linear light it looks much less: a dark mixed into linear light lifts little, a light lifts a lot). */
export function mixs(a: Col, b: Col, k: number): string {
  const x = hex(a), y = hex(b), n1 = parseInt(x.slice(1), 16), n2 = parseInt(y.slice(1), 16);
  const ch = (s: number) => Math.round(lerp((n1 >> s) & 255, (n2 >> s) & 255, clamp(k)));
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}
/** Scale a colour's linear value (gain > 1 glows: the engine's bloom takes values above ~0.9-1.1, per act). */
export function gain(c: Col, g: number): RGB {
  const x = lin(c);
  return [x[0] * g, x[1] * g, x[2] * g];
}

// ---- the Look: an act's tokens, ready to draw with ----
export interface Look {
  key: ActKey | 'mix';
  name: string;
  /** hex (Canvas2D painters) */
  hex: {
    skyTop: string; skyBottom: string; horizon: string; ground: string; key: string; fill: string; rim: string;
    shadow: string; haze: string; ink: string; paper: string; accents: string[];
    /** the act's materials (palette.ts MaterialKey): the same things in this act's light */
    mat: Record<MaterialKey, string>;
  };
  /** linear (GL) */
  skyTop: RGB; skyBottom: RGB; horizon: RGB; ground: RGB; keyc: RGB; fill: RGB; rim: RGB; shadow: RGB; haze: RGB;
  ink: RGB; paper: RGB; accents: RGB[];
  mat: Record<MaterialKey, RGB>;
  /** 0 day … 1 night (from the sky's top): painters dim what isn't a light source by it */
  night: number;
  /** unit vector on screen pointing TOWARD the key light (y down) */
  L: [number, number];
  /** the light in 3D (x right, y down, z toward the viewer), unit: spheres, lit marks */
  L3: [number, number, number];
  /** rim strength 0..1, haze per unit of depth past 1 */
  rimK: number;
  hazeK: number;
  post: Partial<PostParams>;
}

function fromTokens(k: ActKey | 'mix', t: ActTokens): Look {
  const a = (t.light.angle * Math.PI) / 180, e = clamp(t.light.elevation, 0, 1);
  const L: [number, number] = [Math.cos(a), Math.sin(a)];
  const z = Math.sin(e * Math.PI * 0.5), r = Math.cos(e * Math.PI * 0.5);
  return {
    key: k, name: t.name,
    hex: {
      skyTop: t.skyTop, skyBottom: t.skyBottom, horizon: t.horizon, ground: t.ground, key: t.key, fill: t.fill, rim: t.rim,
      shadow: t.shadow, haze: t.haze, ink: t.ink, paper: t.paper, accents: [...t.accents], mat: { ...t.mat },
    },
    skyTop: lin(t.skyTop), skyBottom: lin(t.skyBottom), horizon: lin(t.horizon), ground: lin(t.ground), keyc: lin(t.key),
    fill: lin(t.fill), rim: lin(t.rim), shadow: lin(t.shadow), haze: lin(t.haze), ink: lin(t.ink), paper: lin(t.paper),
    accents: t.accents.map((c) => lin(c)), mat: matLin(t.mat), night: nightOf(t.skyTop),
    L, L3: [L[0] * r, L[1] * r, z], rimK: t.light.rim, hazeK: t.light.haze, post: { ...t.post },
  };
}

function matLin(m: Readonly<Record<MaterialKey, string>>): Record<MaterialKey, RGB> {
  const o = {} as Record<MaterialKey, RGB>;
  for (const k of Object.keys(m) as MaterialKey[]) o[k] = lin(m[k]);
  return o;
}
function matHex(m: Record<MaterialKey, RGB>): Record<MaterialKey, string> {
  const o = {} as Record<MaterialKey, string>;
  for (const k of Object.keys(m) as MaterialKey[]) o[k] = hex(m[k]);
  return o;
}
const nightOf = (skyTop: Col) => { const c = lin(skyTop), y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; return clamp(1 - y / 0.12); };

const LOOKS = new Map<ActKey, Look>();
/** The Look of an act ('II'…'VI'). */
export function look(act: ActKey): Look {
  let l = LOOKS.get(act);
  if (!l) { l = fromTokens(act, ACTS[act]); LOOKS.set(act, l); }
  return l;
}

/** Between two looks (k 0 → a, 1 → b): colours in linear light, the light's direction by angle, post by value. */
export function mixLook(a: Look, b: Look, k: number): Look {
  k = clamp(k);
  if (k <= 0) return a;
  if (k >= 1) return b;
  const m = (x: RGB, y: RGB) => mixc(x, y, k);
  const ang = Math.atan2(a.L[1], a.L[0]) + angleDiff(Math.atan2(a.L[1], a.L[0]), Math.atan2(b.L[1], b.L[0])) * k;
  const L: [number, number] = [Math.cos(ang), Math.sin(ang)];
  const za = a.L3[2], zb = b.L3[2], z = lerp(za, zb, k), r = Math.sqrt(Math.max(0, 1 - z * z));
  const post: Partial<PostParams> = {};
  for (const key of new Set([...Object.keys(a.post), ...Object.keys(b.post)]) as Set<keyof PostParams>) {
    const x = a.post[key], y = b.post[key];
    if (typeof x === 'number' && typeof y === 'number') (post as Record<string, number>)[key] = lerp(x, y, k);
    else (post as Record<string, unknown>)[key] = k < 0.5 ? x ?? y : y ?? x;
  }
  const accents = a.accents.map((c, i) => m(c, b.accents[i] ?? c));
  const mat = {} as Record<MaterialKey, RGB>;
  for (const key of Object.keys(a.mat) as MaterialKey[]) mat[key] = m(a.mat[key], b.mat[key]);
  const out: Look = {
    key: 'mix', name: `${a.name}→${b.name}`,
    skyTop: m(a.skyTop, b.skyTop), skyBottom: m(a.skyBottom, b.skyBottom), horizon: m(a.horizon, b.horizon), ground: m(a.ground, b.ground),
    keyc: m(a.keyc, b.keyc), fill: m(a.fill, b.fill), rim: m(a.rim, b.rim), shadow: m(a.shadow, b.shadow), haze: m(a.haze, b.haze),
    ink: m(a.ink, b.ink), paper: m(a.paper, b.paper), accents, mat, night: lerp(a.night, b.night, k),
    L, L3: [L[0] * r, L[1] * r, z], rimK: lerp(a.rimK, b.rimK, k), hazeK: lerp(a.hazeK, b.hazeK, k), post,
    hex: {} as Look['hex'],
  };
  out.hex = {
    skyTop: hex(out.skyTop), skyBottom: hex(out.skyBottom), horizon: hex(out.horizon), ground: hex(out.ground), key: hex(out.keyc),
    fill: hex(out.fill), rim: hex(out.rim), shadow: hex(out.shadow), haze: hex(out.haze), ink: hex(out.ink), paper: hex(out.paper),
    accents: accents.map(hex), mat: matHex(mat),
  };
  return out;
}
const angleDiff = (a: number, b: number) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

/** A Look with its light turned to `angleDeg` (toward the light, screen degrees), e.g. a lamp in one scene. */
export function withLight(l: Look, angleDeg: number, elevation?: number): Look {
  const a = (angleDeg * Math.PI) / 180, e = elevation ?? Math.asin(clamp(l.L3[2])) / (Math.PI / 2);
  const z = Math.sin(e * Math.PI * 0.5), r = Math.cos(e * Math.PI * 0.5);
  return { ...l, L: [Math.cos(a), Math.sin(a)], L3: [Math.cos(a) * r, Math.sin(a) * r, z] };
}

/** The thread's colour for a role (linear), as light; `ink: true` for verify drawn on paper. */
export type ThreadRole = 'verify' | 'link' | 'route' | 'path';
export function threadColor(role: ThreadRole, ink = false): RGB {
  return lin(role === 'verify' && ink ? THREAD.verifyInk : THREAD[role]);
}

// ---- light, consistently -------------------------------------------------------------------------------------
/**
 * The faces of a box (a page building, a house, a crate) from the act's key light, so every painter gets the
 * same value structure: the roof (top) catches light from above, the front faces the camera a step darker, the
 * side turned toward the light lit, the side turned away darkest. `sideRight`: which side face the camera sees.
 * Returns hex for Canvas2D. Light from above → top lightest; at night the front sinks further (no fill).
 */
export function faces(l: Look, base: Col, o: { sideRight?: boolean } = {}): { top: string; front: string; side: string; edge: string; sideLit: boolean } {
  const up = clamp(-l.L[1]), sx = l.L[0], right = o.sideRight ?? true, sideLit = right ? sx > 0.15 : sx < -0.15;
  const top = mixs(base, l.keyc, 0.16 + 0.2 * up);
  const front = mixs(base, l.shadow, 0.1 + 0.32 * l.night);
  const side = sideLit ? mixs(base, l.keyc, 0.06 + 0.08 * Math.abs(sx)) : mixs(base, l.shadow, 0.38 + 0.2 * l.night);
  return { top, front, side, edge: mixs(base, l.keyc, 0.45 + 0.2 * up), sideLit };
}
/**
 * Named glow gains by role, so 19 scenes glow alike against the acts' bloom thresholds (0.9-1.1): ink and paper
 * stay under it (crisp), a lit window just touches it, a lamp blooms, a star and the thread bloom more, the sun most.
 * Use them as `gain:` on marks, sprites and threads: `st.rect(..., { gain: GLOW.window })`.
 */
export const GLOW = { ink: 0.85, paper: 0.92, window: 1.05, screen: 1.2, lamp: 1.4, star: 1.6, thread: 1.7, motif: 1.25, sun: 2.5 } as const;
/** A physical colour (a red roof, a teal cabinet) as it reads in this act's light: dimmed and cooled at night,
 * warmed a little by day. For painters, so one object keeps its identity across acts. */
export function inLight(l: Look, c: Col, k = 1): string {
  const n = l.night * k;
  return n > 0.02 ? mixs(mixs(c, l.shadow, 0.55 * n), l.fill, 0.3 * n) : mixs(c, l.keyc, 0.06 * k);
}

/** Value structure for painters: a colour lit by the key (k toward the key light) or shaded (k toward the shadow). */
export const lit = (l: Look, c: Col, k = 0.25) => mixh(c, l.keyc, k);
export const shade = (l: Look, c: Col, k = 0.4) => mixh(c, l.shadow, k);
/** A colour pushed into the act's haze (far things): k 0 none … 1 all haze. */
export const hazed = (l: Look, c: Col, k: number) => mixh(c, l.haze, k);
