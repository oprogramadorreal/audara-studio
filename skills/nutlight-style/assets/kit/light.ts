// the earlier light (part of the Nutlight kit: scenes import from './index'). A location's light (palette.ts
// LIGHTS) becomes a Rig: the Stage's Look (key light, rim, haze, post) plus the world's named colours under that
// light, `c` (hex, for painters and draws) — so a scene never types a colour: `R.c.slot`, `R.c.wallLit`,
// `R.fur.amber.base`, `R.gear.hardhat`. Rigs mix (mixRig) for a light that changes inside a scene (night falling,
// morning arriving) and across a transition. charLight(look): how a character takes that light (the squirrels do it
// by themselves: the key's colour, a counter rim, a contact shadow).
import { LIGHTS, FUR, GEAR, type LightKey, type SettingPalette, type FurPalette, type MaterialKey } from './palette';
import type { PostParams } from '../engine/post';
import { clamp, lerp } from '../engine/util';
import { hex, lin, mixc, mixLook, mixs, type Col, type Look, type RGB } from './color';

export type PalKey = keyof SettingPalette;
export interface Rig extends Look {
  /** the world's colours under this light (hex) */
  c: SettingPalette;
  /** the same, linear (GL) */
  cl: Record<PalKey, RGB>;
  /** which light this is ('mix' between two) */
  rig: LightKey | 'mix';
  fur: typeof FUR;
  gear: typeof GEAR;
}

function toLook(k: LightKey): Look {
  const t = LIGHTS[k], p = t.palette;
  const a = (t.angle * Math.PI) / 180, e = clamp(t.elevation, 0, 1);
  const L: [number, number] = [Math.cos(a), Math.sin(a)];
  const z = Math.sin(e * Math.PI * 0.5), r = Math.cos(e * Math.PI * 0.5);
  const mat: Record<MaterialKey, string> = {
    wall: p.wall, wallAlt: p.wallShade, roof: p.roof, wood: p.wood, metal: p.metal, foliage: p.leafMid, foliageDeep: p.leafNear,
    land: p.earthLand, water: p.earthOcean, cloud: p.cloudLit, cloudShade: p.cloud, window: p.windowWarm, lamp: p.lampLight,
    street: p.path, traffic: p.slot, city: p.earthCity, moon: p.moon,
  };
  const accents = [p.slot, p.led, p.motif, p.code3, p.netGold];
  const hx = {
    skyTop: p.skyTop, skyBottom: p.skyLow, horizon: p.skyLow, ground: p.ground, key: t.key, fill: t.fill, rim: t.rim,
    shadow: t.shadow, haze: p.haze, ink: p.ink, paper: p.paper, accents, mat,
  };
  const matL = {} as Record<MaterialKey, RGB>;
  for (const m of Object.keys(mat) as MaterialKey[]) matL[m] = lin(mat[m]);
  const sky = lin(p.skyTop), lum = 0.2126 * sky[0] + 0.7152 * sky[1] + 0.0722 * sky[2];
  return {
    key: 'mix', name: k, hex: hx,
    skyTop: lin(hx.skyTop), skyBottom: lin(hx.skyBottom), horizon: lin(hx.horizon), ground: lin(hx.ground), keyc: lin(t.key),
    fill: lin(t.fill), rim: lin(t.rim), shadow: lin(t.shadow), haze: lin(hx.haze), ink: lin(hx.ink), paper: lin(hx.paper),
    accents: accents.map((c) => lin(c)), mat: matL, night: (t as { night?: number }).night ?? clamp(1 - lum / 0.12),
    L, L3: [L[0] * r, L[1] * r, z], rimK: t.rimK, hazeK: t.hazeK, post: { ...(t.post as Partial<PostParams>) },
  };
}
function linPal(p: SettingPalette): Record<PalKey, RGB> {
  const o = {} as Record<PalKey, RGB>;
  for (const k of Object.keys(p) as PalKey[]) o[k] = lin(p[k]);
  return o;
}

const RIGS = new Map<LightKey, Rig>();
/** The rig of a location: 'cabin' | 'city' | 'hub' | 'office' | 'space' | 'moonbase' | 'morning' | 'dusk'. */
export function rig(k: LightKey): Rig {
  let r = RIGS.get(k);
  if (!r) {
    const p = LIGHTS[k].palette;
    r = { ...toLook(k), c: { ...p }, cl: linPal(p), rig: k, fur: FUR, gear: GEAR };
    RIGS.set(k, r);
  }
  return r;
}
/** Between two rigs (k 0 → a, 1 → b): the Look's light by angle, the colours in linear light. Bake with a pure
 * rig; mix only for live draws (glows, skies, tints) or for the Stage's look during a change of light. */
export function mixRig(a: Rig, b: Rig, k: number): Rig {
  k = clamp(k);
  if (k <= 0) return a;
  if (k >= 1) return b;
  const l = mixLook(a, b, k), c = {} as SettingPalette, cl = {} as Record<PalKey, RGB>;
  for (const key of Object.keys(a.c) as PalKey[]) { cl[key] = mixc(a.cl[key], b.cl[key], k); c[key] = hex(cl[key]); }
  return { ...l, c, cl, rig: 'mix', fur: FUR, gear: GEAR };
}

/**
 * Glow gains by role (×colour; the rigs' bloom thresholds sit at 0.85-1.2): what's lit stays under 1 and crisp,
 * a screen just touches it, slots and code glow, a lamp blooms, conduits and the network glow more, the core and
 * a spark most. `st.glow(x, y, r, R.c.slot, { gain: GLOW3.slot })`. (the grade: the night's bloom
 * threshold went up to 1.2, so only the lights bloom, and their gains went up by about a sixth: slot, led, conduit,
 * packet, node, core, code, link, window; lamp, star, moon and sun stay as the sunset has them.)
 */
export const GLOW3 = {
  matte: 0.9, screen: 1.1, code: 1.5, slot: 2.05, led: 2.25, window: 1.4, lamp: 1.8, conduit: 2.0, packet: 2.8,
  node: 2.4, link: 1.6, core: 2.9, spark: 3.0, star: 1.7, moon: 1.3, sun: 2.8,
} as const;

/** Value design in sRGB (k toward b): use for painters' shading (mixs in color.ts; re-exported for scenes). */
export const shadeOf = (c: Col, toward: Col, k: number) => mixs(c, toward, k);
/** A colour lit by a warm or cool light source of colour `light` (k 0..1): pushes value and hue toward it. */
export const litBy = (c: Col, light: Col, k: number) => mixs(c, light, k * 0.6);
/** Fur lit by the rig: the fur's base pushed a little toward the key light and, at night, toward the fill. */
export function furIn(r: Rig, f: FurPalette, k = 1): FurPalette {
  const n = r.night * 0.25 * k, key = r.hex.key;
  const t = (c: string) => mixs(mixs(c, r.hex.fill, n), key, 0.04 * k);
  return { ...f, base: t(f.base), light: t(f.light), shade: t(f.shade), deep: t(f.deep), cream: t(f.cream), creamShade: t(f.creamShade), inner: t(f.inner), tailBand: t(f.tailBand) };
}
/**
 * A character under the stage's light (the squirrels take it by themselves: Squirrel.draw reads `st.look`, the scene's
 * rig or a mix of two, so no scene passes anything): the references' characters carry the key light's colour, a thin
 * rim from the OTHER source of their location, and a soft contact shadow. From the look alone:
 *   tint     the key light's colour, its brightest channel 1 (linear): Squirrel.draw multiplies the fur by lerp(1,
 *            tint, CHAR_LIGHT.tint), so a warm lamp warms it; a cool key (the hub's screens, the city's moon) tints it
 *            only a third as much (references 01-03 keep the squirrels' warm identities vivid against the
 *            cyan world; the cool light reaches them as the counter rim instead)
 *   counter  the counter light (linear): the palette's `charRim`, the night world's cyan (the moon, the city, the
 *            screens), the sunset's gold (reference 07: golden light traces the ears and the tails), whatever the
 *            key: the warm side is the key's (a lamp, a window; the rim each scene passes on the key's side)
 *   dir      toward it on screen (unit, y down): from the side away from the key and from above (a back light: it
 *            catches the top and back of the head, the ears and the tail's plume, the edges against the sky), turning
 *            continuously as a mixed rig's key turns
 *   look     the look the counter rim is drawn under (its L is `dir`)
 */
export interface CharLight { tint: RGB; counter: RGB; dir: [number, number]; look: Look }
/** The strengths (Squirrel.draw; SqDrawOpts.light scales each per draw): the key tint's share, the counter rim (× the
 * rig's rimK) and its width in screen px at full scale, the contact shadow's darkness. */
export const CHAR_LIGHT = { tint: 0.22, rim: 1.4, rimPx: 1.6, contact: 0.7 } as const;
const CHAR = new WeakMap<Look, CharLight>();
export function charLight(l: Look): CharLight {
  const hit = CHAR.get(l);
  if (hit) return hit;
  const k = l.keyc, mx = Math.max(1e-3, k[0], k[1], k[2]);
  // a cool key (more blue than red) tints a third as much as a warm one, smoothly between
  const warm = clamp((k[0] - k[2]) / mx * 1.25 + 0.6), w = lerp(0.35, 1, warm);
  const tint: RGB = [lerp(1, k[0] / mx, w), lerp(1, k[1] / mx, w), lerp(1, k[2] / mx, w)];
  const pal = (l as Partial<Rig>).cl;
  const counter: RGB = pal ? pal.charRim : mixc(l.fill, l.rim, 0.6);
  // across from the key (saturating, so it turns smoothly when a mixed key passes overhead), from above
  const x = -l.L[0], sx = x / Math.max(Math.abs(x), 0.35), m = Math.hypot(sx, 0.55);
  const dir: [number, number] = [sx / m, -0.55 / m];
  const c: CharLight = { tint, counter, dir, look: { ...l, L: dir, rim: counter, rimK: 1 } };
  CHAR.set(l, c);
  return c;
}
/** Linear RGB multiply (tints: the far arm a step darker). */
export const tintK = (k: number): RGB => [k, k, k];
/** lerp of two linear triplets (for live colours that change with t). */
export const lerp3 = (a: RGB, b: RGB, k: number): RGB => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
