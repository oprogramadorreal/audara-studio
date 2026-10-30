// the earlier shared props (part of the Nutlight kit: scenes import from './index'): painters (Canvas2D, once, in a
// scene's fields or init()) and live draws (every frame, on the Stage) that every location uses — foliage and clouds,
// screens with illuminated code that types, a router, the glowing cable and conduits with their data packets, lamps
// with cones of light, plants, frames, a chair, a mug. Colours come from the rig (R.c.*), never typed here.
import { bake, smooth, rr, type Art, type Pt } from './art';
import { css, gain, lin, mixs, type Col } from './color';
import { Path } from './motion';
import type { Stage, DrawOpts } from './stage';
import { GLOW3, type Rig } from './light';
import { clamp, hash, lerp, mod, mulberry32, smootherstep, TAU, type V2 } from '../engine/util';

type C2 = CanvasRenderingContext2D;
export const ell = (x: number, y: number, rx: number, ry: number, rot = 0) => { const p = new Path2D(); p.ellipse(x, y, rx, ry, rot, 0, TAU); return p; };
export function lgrad(c: C2, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  for (const [k, col] of stops) g.addColorStop(k, col);
  return g;
}
export function rgrad(c: C2, x: number, y: number, r: number, stops: [number, string][], r0 = 0) {
  const g = c.createRadialGradient(x, y, r0, x, y, r);
  for (const [k, col] of stops) g.addColorStop(k, col);
  return g;
}

// ------------------------------------------------------------------------------------------------------------
// Foliage (the references: broad leaf shapes framing the shot, dark teal masses with lighter leaf edges, pines in the
// distance): clumps built of overlapping BROAD LEAVES (ovate, a pointed tip, a midrib, the half toward the light a
// step lighter) over a dark mass, so a near-black silhouette still reads as foliage
// ------------------------------------------------------------------------------------------------------------
/** A broad leaf's outline: base at (0, 0), tip at (0, −len), half-width about 0.78 × wid. */
export function leafPath(len: number, wid: number): Path2D {
  const p = new Path2D();
  p.moveTo(0, 0);
  p.bezierCurveTo(wid * 1.08, -len * 0.16, wid * 0.86, -len * 0.74, 0, -len);
  p.bezierCurveTo(-wid * 0.86, -len * 0.74, -wid * 1.08, -len * 0.16, 0, 0);
  p.closePath();
  return p;
}
/**
 * One broad leaf (bake time): at (x, y) its base, `rot` the turn of its tip from straight up, `col` its colour; `lit`
 * paints the half facing `light` a step lighter (the references' two-tone leaves), `rib` its midrib (null: none).
 */
export function paintLeaf(c: C2, x: number, y: number, len: number, wid: number, rot: number, col: string, o: { lit?: string; rib?: string | null; light?: Pt; litA?: number } = {}) {
  const p = leafPath(len, wid);
  c.save(); c.translate(x, y); c.rotate(rot);
  c.fillStyle = col; c.fill(p);
  if (o.lit) {
    const L = o.light ?? [0.3, -1], lxl = L[0] * Math.cos(rot) + L[1] * Math.sin(rot);
    c.save(); c.clip(p); c.globalAlpha *= o.litA ?? 0.7; c.fillStyle = o.lit;
    c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(wid * 0.1 * Math.sign(lxl || 1), -len * 0.5, 0, -len);
    c.lineTo(wid * 1.3 * Math.sign(lxl || 1), -len); c.lineTo(wid * 1.3 * Math.sign(lxl || 1), 0); c.closePath(); c.fill();
    c.restore();
  }
  if (o.rib !== null && len > 9) {
    c.strokeStyle = o.rib ?? css(mixs(col, o.lit ?? col, 0.5), 0.8); c.lineWidth = Math.max(0.8, wid * 0.07); c.lineCap = 'round';
    c.beginPath(); c.moveTo(0, -len * 0.04); c.quadraticCurveTo(wid * 0.06, -len * 0.5, 0, -len * 0.88); c.stroke();
  }
  c.restore();
}
export interface BushOpts { base: string; lit: string; edge?: string; seed?: number; n?: number; r?: [number, number]; light?: Pt; litK?: number; leaves?: boolean }
/** A bank of bushes filling (0..w, 0..h) from the bottom up, its top a bumpy line near y = top: a dark mass of
 * clumps, each crowned with broad overlapping leaves that catch the light on its side. */
export function paintBushes(c: C2, w: number, h: number, top: number, o: BushOpts) {
  const rnd = mulberry32(o.seed ?? 1), n = o.n ?? Math.ceil(w / 60), [r0, r1] = o.r ?? [40, 90], L = o.light ?? [0.3, -1];
  const lm = Math.hypot(L[0], L[1]), lx = L[0] / lm, ly = L[1] / lm;
  const blobs: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) / n * w + (rnd() - 0.5) * (w / n) * 0.8, r = lerp(r0, r1, rnd());
    blobs.push({ x, y: top + r * 0.55 + rnd() * (h - top) * 0.25, r });
  }
  for (let i = 0; i < n * 0.6; i++) blobs.push({ x: r1 + rnd() * (w - 2 * r1), y: top + (h - top) * (0.3 + 0.7 * rnd()), r: lerp(r0, r1, rnd()) * 1.2 });
  // the ends taper (no hard edge where the art stops): clumps sink toward both sides
  for (const b of blobs) { const e = Math.min(b.x, w - b.x) / (w * 0.18); if (e < 1) { b.y += (1 - Math.max(0, e)) * (h - top) * 0.45; b.r *= 0.75 + 0.25 * Math.max(0, e); } b.x = Math.min(Math.max(b.x, b.r), w - b.r); }
  // the back clumps first (higher on the bank = farther), so the near ones overlap them
  blobs.sort((a, b) => a.y - a.r * 0.3 - (b.y - b.r * 0.3));
  // (the leaves stay a step or two over the mass, only those facing the light lit: the bank keeps its near-black)
  const litK = o.litK ?? 1, mid = mixs(o.base, o.lit, 0.2 * litK), lit = mixs(o.base, o.lit, 0.62 * litK + 0.08), edge = o.edge ?? o.lit;
  // the dark mass
  c.fillStyle = o.base;
  for (const b of blobs) c.fill(ell(b.x, b.y, b.r, b.r * 0.92));
  const body = new Path2D(); body.moveTo(0, h); body.lineTo(0, h - (h - top) * 0.25);
  body.bezierCurveTo(w * 0.12, top + r1 * 0.6, w * 0.88, top + r1 * 0.6, w, h - (h - top) * 0.25); body.lineTo(w, h); body.closePath();
  c.fill(body);
  // soft volume: each clump turns toward the light (a broad, low-contrast plane, not a hard crescent)
  c.save();
  c.globalAlpha = 0.65 * litK;
  for (const b of blobs) {
    const p = ell(b.x, b.y, b.r, b.r * 0.92);
    c.save(); c.clip(p);
    c.fillStyle = mixs(o.base, o.lit, 0.55);
    c.fill(ell(b.x + lx * b.r * 0.34, b.y + ly * b.r * 0.34, b.r * 0.86, b.r * 0.78));
    c.fillStyle = o.base;
    c.fill(ell(b.x - lx * b.r * 0.1, b.y - ly * b.r * 0.1 + b.r * 0.2, b.r * 0.94, b.r * 0.86));
    c.restore();
  }
  c.restore();
  // the leaves: a crown of broad leaves along each clump's upper rim, pointing out; those facing the light lit
  if (o.leaves ?? true) {
    for (const b of blobs) {
      const nl = Math.max(4, Math.round(b.r / 8.5));
      // deep in the bank the leaves sink back into the mass: the lit ones ride the top contour (reference 05's foreground:
      // the dark bank carries its light along its upper edge)
      // (a clump the art's top edge cuts keeps its leaves dark: no lit leaf runs into that straight edge)
      const cut = b.y - b.r * 0.92 < 3 ? 0.25 : 1, lk = cut * (1 - 0.65 * smootherstep(0.2, 0.85, clamp((b.y - b.r * 0.4 - top) / Math.max(1, h - top))));
      for (let j = 0; j < nl; j++) {
        const a = -Math.PI / 2 + (rnd() - 0.5) * 2.7, len = clamp(b.r * (0.44 + 0.3 * rnd()), 11, 74), wid = len * (0.36 + 0.12 * rnd());
        const rr2 = b.r * (0.86 + 0.12 * rnd()) - len * 0.42, x = b.x + Math.cos(a) * rr2, y = b.y + Math.sin(a) * rr2 * 0.9;
        const tx = x + Math.cos(a) * len, ty = y + Math.sin(a) * len;
        if (ty < 2 || tx < 2 || tx > w - 2 || ty > h - 1) continue; // a leaf the art's edge would cut
        const face = Math.cos(a) * lx + Math.sin(a) * ly, pick = rnd();
        const tone = face > 0.4 && pick < 0.72 ? 2 : face > -0.25 && pick < 0.7 ? 1 : 0;
        if (tone === 0 && lk < 0.25) continue;
        const col0 = tone === 2 ? lit : tone === 1 ? mid : o.base, col = lk < 1 ? mixs(o.base, col0, 0.15 + 0.85 * lk) : col0;
        const lc = tone === 0 ? mid : tone === 1 ? lit : edge;
        paintLeaf(c, x, y, len, wid, a + Math.PI / 2 + (rnd() - 0.5) * 0.8, col, { lit: lc, light: [lx, ly], litA: (tone === 2 ? 0.5 : 0.38) * litK * lk, rib: tone === 0 ? null : css(o.base, 0.45) });
      }
    }
  }
}
/**
 * A stand of conifers (reference 05, 07: the pine silhouettes between the towers and on the hills) filling (0..w, 0..h)
 * from the bottom: each tree a column of drooping tiers, the side toward the light a step lighter, a dark ground
 * mass binding their feet. `hr` the trees' height range (px).
 */
export function paintPines(c: C2, w: number, h: number, o: { base: string; lit: string; seed?: number; n?: number; hr?: [number, number]; light?: Pt; litK?: number; ground?: number }) {
  const rnd = mulberry32(o.seed ?? 3), n = o.n ?? Math.max(2, Math.round(w / 46)), [h0, h1] = o.hr ?? [h * 0.45, h * 0.95], L = o.light ?? [0.4, -1];
  const litK = o.litK ?? 1, lit = mixs(o.base, o.lit, 0.8 * litK), side = L[0] >= 0 ? 1 : -1;
  const trees: { x: number; th: number }[] = [];
  for (let i = 0; i < n; i++) trees.push({ x: ((i + 0.2 + 0.6 * rnd()) / n) * w, th: lerp(h0, h1, rnd()) });
  trees.sort((a, b) => a.th - b.th).reverse(); // tall ones behind
  for (const tr of trees) {
    const tw = Math.min(tr.th * 0.36, (w / n) * 1.6), x = clamp(tr.x, tw * 0.5 + 2, w - tw * 0.5 - 2), tiers = Math.max(3, Math.round(tr.th / 26));
    c.fillStyle = o.base; c.fillRect(x - tw * 0.05, h - tr.th * 0.2, tw * 0.1, tr.th * 0.2);
    for (let i = 0; i < tiers; i++) {
      const u0 = i / tiers, u1 = (i + 1.35) / tiers, y0 = h - tr.th + tr.th * 0.9 * u0, y1 = h - tr.th + tr.th * 0.9 * Math.min(1, u1);
      const hw = tw * 0.5 * (0.25 + 0.75 * Math.min(1, u1)), p = new Path2D();
      p.moveTo(x, y0);
      p.quadraticCurveTo(x + hw * 0.45, y0 + (y1 - y0) * 0.55, x + hw, y1);
      p.quadraticCurveTo(x + hw * 0.5, y1 - (y1 - y0) * 0.12, x, y1 + (y1 - y0) * 0.04);
      p.quadraticCurveTo(x - hw * 0.5, y1 - (y1 - y0) * 0.12, x - hw, y1);
      p.quadraticCurveTo(x - hw * 0.45, y0 + (y1 - y0) * 0.55, x, y0);
      c.fillStyle = o.base; c.fill(p);
      c.save(); c.clip(p); c.fillStyle = css(lit, 0.85 * litK);
      c.beginPath(); c.moveTo(x, y0); c.lineTo(x + side * hw * 1.2, y1 + 2); c.lineTo(x + side * hw * 0.25, y1 + 2); c.closePath(); c.fill();
      c.restore();
    }
  }
  const g = o.ground ?? 0.16;
  if (g > 0) {
    c.fillStyle = o.base; c.beginPath(); c.moveTo(0, h); c.lineTo(0, h - h * g * 0.6);
    for (let x = 0; x <= w; x += 30) c.lineTo(x, h - h * g * (0.7 + 0.3 * Math.sin(x * 0.05 + (o.seed ?? 3))));
    c.lineTo(w, h); c.closePath(); c.fill();
  }
}
/** A plant pot (bake time), origin its bottom centre, `pw` its top width, `ph` its height: a tapered body lit on one
 * side, a rim with a lit top, the soil. Colour: the rig's pot, a cream glaze or terracotta (`kind`). */
function paintPot(c: C2, R: Rig, pw: number, ph: number, kind: 0 | 1 | 2) {
  const k = R.c, col = kind === 1 ? mixs(k.paper, k.wallShade, 0.22) : kind === 2 ? mixs(k.wood, k.rug, 0.45) : k.pot;
  const dark = mixs(col, k.woodDark, 0.45), lit = mixs(col, k.lampLight, 0.3);
  c.fillStyle = lgrad(c, -pw / 2, 0, pw / 2, 0, [[0, lit], [0.45, col], [1, dark]]);
  c.fill(smooth([[-pw * 0.47, -ph], [pw * 0.47, -ph], [pw * 0.38, 0], [-pw * 0.38, 0]], true, 0.12));
  c.fillStyle = css(k.woodDark, 0.25); c.fill(ell(0, -1, pw * 0.38, Math.max(1.5, ph * 0.05)));
  c.fillStyle = lgrad(c, -pw / 2, 0, pw / 2, 0, [[0, mixs(lit, k.lampLight, 0.25)], [0.5, mixs(col, lit, 0.5)], [1, dark]]);
  c.fill(rr(-pw * 0.53, -ph - ph * 0.16, pw * 1.06, ph * 0.2, Math.min(4, ph * 0.08)));
  c.fillStyle = css(k.lampLight, 0.35); c.fillRect(-pw * 0.5, -ph - ph * 0.16, pw * 0.7, Math.max(1, ph * 0.03));
  c.fillStyle = mixs(k.woodDark, k.rackGroove, 0.3); c.fill(ell(0, -ph - ph * 0.15, pw * 0.46, Math.max(1.5, ph * 0.05)));
}
/** A big leafy plant in a pot (the references' left corner, reference 05's floor plants), origin at the pot's bottom centre. */
export function paintPottedPlant(c: C2, R: Rig, s = 1, seed = 3) {
  const k = R.c, rnd = mulberry32(seed), dark = mixs(k.plant, k.leafNear, 0.35);
  c.save(); c.scale(s, s);
  // stems, then broad leaves fanning out (back ones darker), each two-toned with a midrib
  c.strokeStyle = mixs(k.plant, k.woodDark, 0.3); c.lineWidth = 3; c.lineCap = 'round';
  const leaves: { a: number; len: number; back: boolean }[] = [];
  for (let i = 0; i < 11; i++) leaves.push({ a: -Math.PI / 2 + (i / 10 - 0.5) * 2.5 + (rnd() - 0.5) * 0.25, len: 70 + 60 * rnd(), back: i % 2 === 0 });
  for (const back of [true, false]) for (const L of leaves) {
    if (L.back !== back) continue;
    const bx = Math.cos(L.a) * L.len * 0.45, by = -84 + Math.sin(L.a) * L.len * 0.45;
    c.beginPath(); c.moveTo(0, -80); c.quadraticCurveTo(bx * 0.4, -84 + (by + 84) * 0.2, bx, by); c.stroke();
    paintLeaf(c, bx, by, L.len * 0.7, L.len * 0.24, L.a + Math.PI / 2, back ? dark : k.plant, { lit: back ? k.plant : k.plantLit, light: [0.4, -1], litA: 0.8, rib: css(k.leafNear, 0.4) });
  }
  paintPot(c, R, 100, 80, (seed % 3) as 0 | 1 | 2);
  c.restore();
}
/** A small plant in a pot (desk, shelf), origin the pot's bottom centre; `trail` vines hang from it (ivy). */
export function paintSmallPlant(c: C2, R: Rig, s = 1, seed = 5, trail = 0) {
  const k = R.c, rnd = mulberry32(seed), dark = mixs(k.plant, k.leafNear, 0.3);
  c.save(); c.scale(s, s);
  for (let j = 0; j < trail; j++) { // a trailing vine: a stem swinging down, broad heart-shaped leaves along it
    const dir = j % 2 ? 1 : -1, pts: [number, number][] = [];
    let x = dir * 14, y = -20;
    for (let i = 0; i < 13; i++) { pts.push([x, y]); x += dir * (2 + rnd() * 5) * (i < 4 ? 1.4 : 0.6); y += 13; }
    c.strokeStyle = dark; c.lineWidth = 1.8; c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.stroke();
    pts.forEach((p, i) => { if (i === 0) return; const side = i % 2 ? 1 : -1, sz = 9 + 3 * rnd() - i * 0.25; paintLeaf(c, p[0], p[1], sz * 1.5, sz * 0.75, side * (1.9 + 0.4 * rnd()) + (dir > 0 ? 0.2 : -0.2), i % 3 ? k.plant : dark, { lit: k.plantLit, light: [0.4, -1], litA: 0.75, rib: null }); });
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 6 - 0.5) * 2.1 + (rnd() - 0.5) * 0.3, len = 26 + 16 * rnd();
    paintLeaf(c, 0, -26, len, len * 0.36, a, i % 2 ? k.plant : dark, { lit: k.plantLit, light: [0.4, -1], litA: 0.8, rib: css(k.leafNear, 0.35) });
  }
  paintPot(c, R, 36, 24, (seed % 3) as 0 | 1 | 2);
  c.restore();
}

// ------------------------------------------------------------------------------------------------------------
// Sky: clouds and the moon
// ------------------------------------------------------------------------------------------------------------
/** A bank of night clouds (0..w, 0..h): soft lobes, darker below, a moonlit top edge toward `light`. */
export function paintCloudBank(c: C2, w: number, h: number, R: Rig, o: { seed?: number; n?: number; base?: string; lit?: string; light?: Pt } = {}) {
  const rnd = mulberry32(o.seed ?? 7), n = o.n ?? Math.ceil(w / 70), base = o.base ?? R.c.cloud, lit = o.lit ?? R.c.cloudLit, L = o.light ?? [0.4, -1];
  const blobs: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n, r = lerp(h * 0.22, h * 0.48, Math.sin(Math.PI * u) * 0.7 + 0.3 * rnd());
    blobs.push({ x: u * w, y: h - r * 0.7 - rnd() * h * 0.12, r });
  }
  // small lobes riding on the big ones: the scalloped top of the references' stylised cumulus
  const tops: { x: number; y: number; r: number }[] = [];
  for (const b of blobs) if (rnd() < 0.7) { const a = -Math.PI / 2 + (rnd() - 0.5) * 1.6; tops.push({ x: b.x + Math.cos(a) * b.r * 0.72, y: b.y + Math.sin(a) * b.r * 0.62, r: b.r * (0.34 + 0.18 * rnd()) }); }
  c.fillStyle = lgrad(c, 0, 0, 0, h, [[0, mixs(lit, R.c.moon, 0.25)], [0.4, lit], [1, mixs(base, R.c.skyTop, 0.2)]]);
  for (const b of blobs) c.fill(ell(b.x, b.y, b.r * 1.15, b.r));
  for (const b of tops) c.fill(ell(b.x, b.y, b.r * 1.1, b.r));
  c.fillRect(0, h * 0.72, w, h * 0.28);
  c.save(); c.globalCompositeOperation = 'source-atop';
  // each lobe's body in the base colour, offset away from the light: a lit rim stays on its lit side
  c.fillStyle = base;
  for (const b of blobs) c.fill(ell(b.x - L[0] * b.r * 0.12, b.y - L[1] * b.r * 0.16, b.r * 1.08, b.r * 0.94));
  c.fillStyle = mixs(base, lit, 0.35);
  for (const b of tops) c.fill(ell(b.x - L[0] * b.r * 0.16, b.y - L[1] * b.r * 0.2, b.r * 1.02, b.r * 0.9));
  // the underside a step darker (a broad shadow plane, flat-bottomed), the sky showing a touch through the bottom edge
  c.fillStyle = lgrad(c, 0, h * 0.45, 0, h, [[0, css(mixs(base, R.c.skyTop, 0.35), 0)], [0.6, css(mixs(base, R.c.skyTop, 0.35), 0.55)], [1, css(mixs(base, R.c.skyTop, 0.5), 0.8)]]);
  c.fillRect(0, h * 0.45, w, h * 0.55);
  c.restore();
}
/** The moon: a pale disc with a soft halo, maria and a few small craters, its lit limb (live: a few marks). */
export function drawMoonR3(st: Stage, R: Rig, x: number, y: number, r: number, o0: DrawOpts & { k?: number } = {}) {
  // the moon keeps its own colour (reference 05's pale cream disc): a light source is never sunk into the haze its
  // depth would give it (that turned it the sky's blue)
  const o = { ...o0, haze: o0.haze ?? 0.06 };
  const k = o.k ?? 1, a = o.alpha ?? 1, sea = mixs(R.c.moon, R.c.skyMid, 0.2), crater = mixs(R.c.moon, R.c.skyMid, 0.12);
  st.glow(x, y, r * 4.2, R.c.moonGlow, { ...o, gain: 0.14 * k, k: 2.2 });
  st.glow(x, y, r * 1.7, R.c.moon, { ...o, gain: 0.3 * k, k: 3 });
  // the disc just under the bloom (a pale lamp in the sky, its seas readable), lit toward the upper left
  st.disc(x, y, r, mixs(R.c.moon, R.c.starCool, 0.2), { ...o, gain: Math.min(1.0, 0.62 + 0.25 * k) * GLOW3.moon * 0.9, lit: 0.35, shade: mixs(R.c.moon, R.c.skyMid, 0.35) });
  // maria: soft overlapping patches (the references' moon has its seas, not a pair of dots)
  for (const [dx, dy, rr2, aa] of [[-0.3, -0.15, 0.26, 0.6], [-0.08, -0.32, 0.17, 0.45], [0.25, 0.3, 0.18, 0.55], [0.1, 0.05, 0.13, 0.4], [-0.38, 0.22, 0.12, 0.4]] as const)
    st.disc(x + dx * r, y + dy * r, rr2 * r, sea, { ...o, alpha: aa * a, feather: r * 0.05, gain: 0.85 });
  for (const [dx, dy, rr2] of [[0.42, -0.3, 0.07], [-0.12, 0.5, 0.06], [0.5, 0.1, 0.05], [-0.55, -0.05, 0.05]] as const)
    st.disc(x + dx * r, y + dy * r, rr2 * r, crater, { ...o, alpha: 0.6 * a });
}

// ------------------------------------------------------------------------------------------------------------
// Illuminated code: a screen whose lines type themselves (live marks, no text rasterized per frame)
// ------------------------------------------------------------------------------------------------------------
export interface CodeLine { indent: number; toks: { w: number; c: number }[] }
/** A seeded page of code: lines of coloured tokens (widths in chars; colour index 0 cyan, 1 amber, 2 coral, 3 pale). */
export function codePage(seed: number, n = 40): CodeLine[] {
  const rnd = mulberry32(seed), out: CodeLine[] = [];
  let indent = 0;
  for (let i = 0; i < n; i++) {
    if (rnd() < 0.12) { out.push({ indent, toks: [] }); continue; }
    const toks: { w: number; c: number }[] = [];
    const m = 1 + Math.floor(rnd() * 4);
    for (let j = 0; j < m; j++) toks.push({ w: 2 + Math.floor(rnd() * 9), c: j === 0 ? (rnd() < 0.5 ? 0 : 2) : rnd() < 0.5 ? 3 : rnd() < 0.6 ? 1 : 0 });
    out.push({ indent, toks });
    if (rnd() < 0.25 && indent < 3) indent++; else if (rnd() < 0.3 && indent > 0) indent--;
  }
  return out;
}
export interface ScreenOpts extends DrawOpts {
  /** characters typed so far (a function of t: e.g. (t - t0) * 14); Infinity shows the page whole */
  typed?: number;
  /** char width and line height in world px */
  cw?: number; lh?: number;
  /** brightness */
  k?: number;
  /** a blinking cursor */
  cursor?: boolean; t?: number;
  /** highlight one line index (a found line, an error) in this colour */
  mark?: { line: number; col: Col; k: number } | null;
  /** first line shown (scroll) */
  scroll?: number;
  /** colours for token indices 0..3 (default the rig's code1..4) */
  palette?: Col[];
}
/** Draw lines of code into a screen rect (world px, top-left x, y, size w × h). */
export function drawCode(st: Stage, R: Rig, page: CodeLine[], x: number, y: number, w: number, h: number, o: ScreenOpts = {}) {
  const cw = o.cw ?? 7, lh = o.lh ?? 13, th = Math.max(2, lh * 0.38), pad = cw * 1.2, k = o.k ?? 1;
  const pal = o.palette ?? [R.c.code1, R.c.code2, R.c.code3, R.c.code4];
  const rows = Math.floor((h - pad) / lh), typed = o.typed ?? Infinity;
  // how far the typing has got: line by line, so the page scrolls when it fills
  let left = typed, last = 0, lastX = x + pad;
  const lens = page.map((l) => l.toks.reduce((s, t) => s + t.w + 1, 0) + 1);
  let total = 0; for (const n of lens) { if (left <= 0) break; left -= n; total++; }
  const scroll = o.scroll ?? Math.max(0, total - rows);
  left = typed;
  for (let i = 0; i < page.length && left > 0; i++) {
    const L = page[i]!, n = lens[i]!, row = i - scroll;
    const shown = Math.min(left, n);
    left -= n;
    if (row < 0) continue;
    if (row >= rows) break;
    const yy = y + pad * 0.6 + row * lh + lh * 0.5;
    let xx = x + pad + L.indent * cw * 2, used = 0;
    if (o.mark && o.mark.line === i && o.mark.k > 0) st.rect(x + w / 2, yy, w - pad, lh * 0.95, o.mark.col, { ...o, alpha: (o.alpha ?? 1) * 0.35 * o.mark.k, gain: 1.1 });
    for (const t of L.toks) {
      const vis = clamp(shown - used, 0, t.w);
      if (vis > 0 && xx < x + w - pad) {
        const ww = Math.min(vis * cw, x + w - pad - xx);
        st.rect(xx + ww / 2, yy, ww, th, pal[t.c]!, { ...o, r: th / 2, gain: GLOW3.code * k });
      }
      used += t.w + 1; xx += (t.w + 1) * cw;
    }
    last = row; lastX = x + pad + L.indent * cw * 2 + Math.min(shown, n) * cw;
  }
  if (o.cursor && (o.t ?? 0) % 1 < 0.55) st.rect(lastX + cw * 0.6, y + pad * 0.6 + last * lh + lh * 0.5, cw * 0.8, lh * 0.8, R.c.code4, { ...o, gain: 1.4 * k });
}

// ------------------------------------------------------------------------------------------------------------
// Devices: monitor, keyboard, router, desk lamp, pendant lamp, mug, chair
// ------------------------------------------------------------------------------------------------------------
/** A desktop monitor (screen w × h, its stand), origin the stand's foot. Returns the screen rect (art px from the
 * origin: x, y top-left). */
export function paintMonitor(c: C2, R: Rig, w: number, h: number, o: { light?: boolean } = {}): { x: number; y: number; w: number; h: number } {
  const k = R.c, b = 10, sx = -w / 2, sy = -h - 46, light = !!o.light;
  // the frame: dark and thin (reference 03), or a pale shell with a chin (05's desk monitor)
  const fr = light ? mixs(k.metalLit, k.paper, 0.55) : k.bezel, frLit = light ? mixs(k.paper, k.lampLight, 0.4) : mixs(k.bezel, k.metalLit, 0.35), frDark = light ? mixs(fr, k.metal, 0.45) : mixs(k.bezel, k.rackGroove, 0.5);
  c.fillStyle = css(k.rackGroove, 0.35); c.fill(ell(4, 1, 54, 5)); // the contact shadow
  // the stand: a neck lit on one edge, a flat oval foot with its top plane lit
  c.fillStyle = lgrad(c, -10, 0, 10, 0, [[0, frLit], [0.4, fr], [1, frDark]]);
  c.fill(rr(-10, -46 + b - 2, 20, 38 - b, 3));
  c.fillStyle = frDark; c.fill(rr(-44, -10, 88, 10, 5));
  c.fillStyle = mixs(fr, frLit, 0.5); c.fill(ell(0, -8, 42, 4));
  c.fillStyle = lgrad(c, 0, sy - b, 0, sy + h + b, [[0, frLit], [0.12, fr], [1, frDark]]);
  c.fill(rr(sx - b, sy - b, w + 2 * b, h + 2 * b + (light ? 6 : 0), 8));
  if (light) { c.fillStyle = mixs(fr, frDark, 0.35); c.fillRect(sx - b + 6, sy + h + 3, w + 2 * b - 12, 1.5); c.fillStyle = mixs(fr, frLit, 0.6); c.fill(ell(0, sy + h + 9, 3, 3)); }
  c.fillStyle = k.rackGroove; c.fill(rr(sx - 1.5, sy - 1.5, w + 3, h + 3, 4));
  c.fillStyle = lgrad(c, 0, sy, 0, sy + h, [[0, mixs(k.screen, k.screenGlow, 0.3)], [1, k.screen]]);
  c.fill(rr(sx, sy, w, h, 3));
  // the glass: a soft diagonal reflection (restrained), a title bar
  c.save(); c.clip(rr(sx, sy, w, h, 3));
  c.fillStyle = css(k.code4, 0.05); c.beginPath(); c.moveTo(sx + w * 0.55, sy); c.lineTo(sx + w * 0.8, sy); c.lineTo(sx + w * 0.45, sy + h); c.lineTo(sx + w * 0.2, sy + h); c.fill();
  c.restore();
  c.fillStyle = css(frLit, 0.85); c.fillRect(sx - b + 4, sy - b, w + 2 * b - 8, 1.6); // a top-edge highlight
  return { x: sx, y: sy, w, h };
}
export function paintKeyboard(c: C2, R: Rig, w = 150) {
  const k = R.c, keyC = mixs(k.device, k.metalLit, 0.45), keyLit = mixs(k.metalLit, k.code4, 0.35);
  c.fillStyle = css(k.rackGroove, 0.3); c.fill(ell(0, 2, w * 0.52, 3));
  c.fillStyle = mixs(k.device, k.rackGroove, 0.3); c.fill(rr(-w / 2, -10, w, 12, 3));
  c.fillStyle = mixs(k.device, k.metalLit, 0.18); c.fill(rr(-w / 2, -11, w, 9, 3));
  // two rows of keycaps (their tops lit), a space bar
  const n = 14, kw = (w - 12) / n;
  for (let r = 0; r < 2; r++) for (let i = 0; i < n - r; i++) {
    const x = -w / 2 + 6 + i * kw + r * kw * 0.5;
    if (r === 1 && i > 3 && i < 9) continue;
    c.fillStyle = keyC; c.fill(rr(x, -9.5 + r * 4, kw - 1.6, 3.4, 1));
    c.fillStyle = css(keyLit, 0.6); c.fillRect(x + 0.4, -9.5 + r * 4, kw - 2.4, 0.9);
  }
  c.fillStyle = keyC; c.fill(rr(-w / 2 + 6 + 4.5 * kw, -5.5, kw * 4.6, 3.4, 1));
}
/** A router: a low box with upright antennas glowing cyan along their edges (reference 05), a row of LEDs (their
 * positions returned: art px from the origin, its bottom centre). */
export function paintRouter(c: C2, R: Rig, w = 96): Pt[] {
  const k = R.c, h = 26, body = mixs(k.device, k.metal, 0.25), lit = mixs(k.device, k.metalLit, 0.45);
  c.fillStyle = css(k.rackGroove, 0.35); c.fill(ell(0, 1, w * 0.56, 4));
  // the antennas: dark rods with a luminous cyan strip and a soft painted halo (they read as lit without bloom)
  const ants: [number, number][] = [[-w / 2 + 14, 64], [-w / 2 + w * 0.36, 70], [w / 2 - w * 0.36, 70], [w / 2 - 22, 72]];
  for (const [ax, ah] of ants) {
    c.save(); c.translate(ax + 3, -h - ah * 0.55); c.scale(1, (ah * 0.62) / 13); // a soft elongated halo, fading at both ends
    c.fillStyle = rgrad(c, 0, 0, 13, [[0, css(k.slot, 0.22)], [1, css(k.slot, 0)]]); c.fillRect(-13, -13, 26, 26);
    c.restore();
    c.fillStyle = body; c.fill(rr(ax, -h - ah, 6, ah + 2, 3));
    c.fillStyle = css(k.slot, 0.85); c.fill(rr(ax + 3.5, -h - ah + 3, 1.8, ah - 6, 1));
    c.fillStyle = mixs(body, lit, 0.5); c.fill(rr(ax - 1.5, -h - 6, 9, 6, 2));
  }
  c.fillStyle = lgrad(c, 0, -h, 0, 0, [[0, lit], [0.25, body], [1, mixs(k.device, k.rackGroove, 0.4)]]);
  c.fill(rr(-w / 2, -h, w, h, 6));
  c.fillStyle = css(k.metalLit, 0.55); c.fillRect(-w / 2 + 5, -h, w - 10, 1.8);
  c.fillStyle = css(k.rackGroove, 0.6); c.fill(rr(-w / 2 + 8, -h * 0.62, w * 0.64, h * 0.34, 3)); // the LED strip's dark window
  c.fillStyle = css(k.rackGroove, 0.5); for (let i = 0; i < 5; i++) c.fillRect(w / 2 - 22 + i * 3.4, -h * 0.66, 1.6, h * 0.4); // a vent
  return [0, 1, 2, 3, 4].map((i) => [-w / 2 + 16 + i * 12, -h * 0.45] as Pt);
}
/** An arm desk lamp (reference 05: a dark cone shade on a jointed arm), origin its base; returns the bulb (art px). */
export function paintDeskLamp(c: C2, R: Rig, s = 1): Pt {
  const k = R.c, sh = k.lampShade, shLit = mixs(k.lampShade, k.wallLit, 0.4);
  c.save(); c.scale(s, s);
  // the base: a weighted disc, its top lit
  c.fillStyle = css(k.rackGroove, 0.3); c.fill(ell(2, 0, 30, 4));
  c.fillStyle = sh; c.fill(rr(-24, -10, 48, 10, 5));
  c.fillStyle = shLit; c.fill(ell(0, -9, 21, 3));
  // two arm segments, each a pair of rods (lit edge toward the lamp), joints as small discs with a glint
  c.lineCap = 'round';
  for (const [x0, y0, x1, y1] of [[0, -8, 10, -90], [10, -90, -28, -142]] as const) {
    c.strokeStyle = sh; c.lineWidth = 6.5; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    c.strokeStyle = css(shLit, 0.8); c.lineWidth = 1.6; c.beginPath(); c.moveTo(x0 + 2, y0); c.lineTo(x1 + 2, y1); c.stroke();
  }
  c.strokeStyle = sh; c.lineWidth = 1.5; c.beginPath(); c.moveTo(6, -14); c.quadraticCurveTo(24, -60, 14, -86); c.stroke(); // the spring
  for (const [jx, jy, jr] of [[0, -8, 5], [10, -90, 6], [-28, -142, 6]] as const) { c.fillStyle = sh; c.fill(ell(jx, jy, jr, jr)); c.fillStyle = css(shLit, 0.9); c.fill(ell(jx + jr * 0.3, jy - jr * 0.3, jr * 0.35, jr * 0.35)); }
  c.save(); c.translate(-28, -142); c.rotate(-0.5);
  const shade = smooth([[-10, -28], [14, -26], [40, 10], [-36, 10]], true, 0.2);
  c.fillStyle = lgrad(c, -36, -30, 40, 10, [[0, shLit], [0.45, sh], [1, mixs(sh, k.rackGroove, 0.4)]]); c.fill(shade);
  c.fillStyle = css(k.lampLight, 0.95); c.fill(ell(2, 10, 37, 4.5)); // the open mouth glowing
  c.strokeStyle = css(mixs(k.lampLight, k.wallLit, 0.3), 0.9); c.lineWidth = 1.6; c.beginPath(); c.ellipse(2, 10, 38, 5, 0, Math.PI, TAU); c.stroke();
  c.restore();
  c.restore();
  return [-28 * s - 4 * s, -142 * s + 14 * s];
}
/** A pendant lamp's shade (a dark dome, reference 05), origin the cord's end; the bulb sits under it at (0, 34). */
export function paintPendant(c: C2, R: Rig, s = 1) {
  const k = R.c, sh = k.lampShade, shLit = mixs(k.lampShade, k.wallLit, 0.32);
  c.save(); c.scale(s, s);
  c.fillStyle = sh; c.fill(rr(-7, -1, 14, 7, 2)); // the fitting
  const dome = new Path2D(); dome.moveTo(-8, 4); dome.lineTo(8, 4); dome.bezierCurveTo(30, 8, 58, 18, 62, 34); dome.lineTo(-62, 34); dome.bezierCurveTo(-58, 18, -30, 8, -8, 4); dome.closePath();
  c.fillStyle = lgrad(c, -62, 0, 62, 0, [[0, mixs(sh, k.rackGroove, 0.35)], [0.35, sh], [0.62, shLit], [0.78, sh], [1, mixs(sh, k.rackGroove, 0.3)]]); c.fill(dome);
  c.save(); c.clip(dome); c.fillStyle = css(mixs(shLit, k.lampLight, 0.3), 0.5); c.fill(ell(14, 8, 16, 4, -0.15)); c.restore(); // a narrow highlight
  c.strokeStyle = css(mixs(k.lampLight, k.wallLit, 0.25), 0.95); c.lineWidth = 2.2; c.beginPath(); c.moveTo(-62, 33.5); c.lineTo(62, 33.5); c.stroke(); // the lit rim
  c.fillStyle = k.lampLight; c.fill(ell(0, 34, 60, 6));
  c.restore();
}
/** A mug (reference 03-04: dark navy with a ringed planet on it, its ring tilted, the planet amber). */
export function paintMug(c: C2, R: Rig, s = 1) {
  const k = R.c, body = mixs(k.device, k.chairLit, 0.25), lit = mixs(body, k.metalLit, 0.4), dark = mixs(body, k.rackGroove, 0.45);
  c.save(); c.scale(s, s);
  c.fillStyle = css(k.rackGroove, 0.3); c.fill(ell(3, 1, 22, 3));
  c.strokeStyle = dark; c.lineWidth = 6; c.beginPath(); c.arc(19, -20, 10, -1.2, 1.2); c.stroke();
  c.strokeStyle = css(lit, 0.6); c.lineWidth = 1.5; c.beginPath(); c.arc(19, -20, 12, -1.1, 0.2); c.stroke();
  c.fillStyle = lgrad(c, -18, 0, 18, 0, [[0, lit], [0.3, body], [1, dark]]);
  c.fill(rr(-18, -40, 36, 40, [4, 4, 6, 6]));
  c.fillStyle = mixs(body, lit, 0.6); c.fill(ell(0, -40, 18, 3.5)); // the rim
  c.fillStyle = mixs(k.woodDark, k.rackGroove, 0.4); c.fill(ell(0, -39.6, 15, 2.4)); // the coffee
  // the ringed planet: the ring's back half, the disc (lit upper left), the ring's front half over it
  const px = 0, py = -21, pr = 7.5, ring = mixs(k.code4, k.paper, 0.3), planet = mixs(k.code2, k.brain, 0.5);
  c.strokeStyle = css(ring, 0.85); c.lineWidth = 1.8; c.beginPath(); c.ellipse(px, py, 15, 4.2, -0.3, Math.PI, TAU); c.stroke();
  c.fillStyle = lgrad(c, px - pr, py - pr, px + pr, py + pr, [[0, mixs(planet, k.lampLight, 0.35)], [0.6, planet], [1, mixs(planet, k.brainShade, 0.5)]]); c.fill(ell(px, py, pr, pr));
  c.strokeStyle = css(ring, 0.95); c.beginPath(); c.ellipse(px, py, 15, 4.2, -0.3, 0, Math.PI); c.stroke();
  c.restore();
}
/** An office chair seen from behind (its back toward us, the references), origin the floor under the seat. */
export function paintChairBack(c: C2, R: Rig, s = 1) {
  const k = R.c;
  c.save(); c.scale(s, s);
  c.strokeStyle = k.chair; c.lineWidth = 8; c.lineCap = 'round';
  c.beginPath(); c.moveTo(-50, 0); c.lineTo(-30, -70); c.moveTo(50, 0); c.lineTo(30, -70); c.moveTo(-10, 0); c.lineTo(-6, -70); c.stroke();
  c.fillStyle = lgrad(c, -70, 0, 70, 0, [[0, k.chairLit], [0.35, k.chair], [1, mixs(k.chair, k.rackGroove, 0.4)]]);
  c.fill(rr(-70, -100, 150, 34, 12)); // the seat
  c.fill(smooth([[-64, -96], [-72, -200], [-50, -232], [30, -238], [62, -210], [64, -100]], true, 0.35)); // the back
  c.fillStyle = css(k.chairLit, 0.6);
  c.fill(smooth([[-58, -110], [-64, -196], [-46, -222], [-30, -220], [-46, -190], [-44, -110]], true, 0.4));
  c.restore();
}

/** A high-backed chair seen from behind (the references), origin the floor under the seat. */
export function paintHighChair(c: C2, R: Rig) {
  const k = R.c, dark = mixs(k.chair, k.structDeep, 0.55), lit = k.chairLit;
  c.fillStyle = dark; c.fill(rr(-130, -150, 290, 70, 26));
  c.fillStyle = k.chair; c.fill(rr(90, -210, 70, 120, 18));
  c.fillStyle = css(lit, 0.8); c.fill(rr(96, -210, 58, 10, 5));
  const back = smooth([[-118, -110], [-132, -330], [-104, -440], [20, -458], [96, -420], [108, -110]], true, 0.32);
  c.fillStyle = k.chair; c.fill(back);
  c.save(); c.clip(back);
  c.fillStyle = dark; c.fill(smooth([[-150, -60], [-150, -480], [-80, -470], [-66, -60]], true, 0.3));
  c.fillStyle = css(lit, 0.75); c.fill(smooth([[-104, -440], [20, -458], [96, -420], [86, -416], [18, -446], [-100, -430]], true, 0.4));
  c.fillStyle = css(lit, 0.4); c.fill(smooth([[96, -420], [108, -110], [96, -110], [86, -410]], true, 0.4));
  c.strokeStyle = css(k.structDeep, 0.9); c.lineWidth = 5; c.beginPath(); c.moveTo(-120, -260); c.quadraticCurveTo(-20, -272, 100, -258); c.stroke();
  c.restore();
}
/** Which part of a seated character's chair to paint: the SEAT goes BEFORE her (she sits on it: its top plane shows
 * where her body doesn't), the BACK after her (it hides her lower back); 'all' both, for a chair with nobody in it. */
export type ChairPart = 'all' | 'seat' | 'back';
/** a flat quad with its corners eased a hair (a cushion's plane) */
const quad = (p: Pt[], r = 0.12) => smooth(p, true, r);
/**
 * A LOW-backed swivel chair turned THREE-QUARTER, seen from behind and above (the hub, the Moon base; the references): the back
 * a rounded pad on the left, its rear face toward us and its right edge's thickness showing; the seat reaching right
 * toward the desk, its TOP PLANE a parallelogram receding up and right, one value step lighter than its faces (it
 * catches the screens' light), the side face toward the desk a step down, the near face darkest; a gas post and a star
 * base. NO armrest: nothing crosses the typing forearm (the critic's rule: the chair never hides the action). Origin
 * the floor under the seat; the seat point 190 u up (`s` scales it).
 */
export function paintLowChair(c: C2, R: Rig, s = 1, part: ChairPart = 'all') {
  const k = R.c, dark = mixs(k.chair, k.structDeep, 0.5), body = k.chair, top = mixs(k.chair, k.chairLit, 0.42), lit = k.chairLit;
  c.save(); c.scale(s, s);
  if (part !== 'back') {
    // the star base and the post (in shadow under the seat), the far legs a step darker
    c.strokeStyle = mixs(dark, k.structDeep, 0.4); c.lineWidth = 12; c.lineCap = 'round';
    c.beginPath(); for (const [dx, dy] of [[-120, -4], [-60, 10], [70, 8], [128, -6], [10, -22]] as const) { c.moveTo(0, -34); c.lineTo(dx, dy - 6); } c.stroke();
    c.fillStyle = mixs(dark, k.structDeep, 0.4); for (const [dx, dy] of [[-120, -4], [-60, 10], [70, 8], [128, -6]] as const) c.fill(ell(dx, dy, 11, 8));
    c.fillStyle = dark; c.fillRect(-12, -160, 24, 128); c.fillStyle = css(lit, 0.25); c.fillRect(-12, -160, 5, 128);
    // the seat in three-quarter: near edge NL→NR, far edge FL→FR (up and to the right), 34 u thick
    const NL: Pt = [-150, -170], NR: Pt = [150, -180], FR: Pt = [214, -222], FL: Pt = [-86, -212], T = 34;
    c.fillStyle = mixs(body, dark, 0.35); c.fill(quad([NR, FR, [FR[0], FR[1] + T - 6], [NR[0], NR[1] + T]]));
    c.fillStyle = lgrad(c, 0, NL[1], 0, NL[1] + T, [[0, mixs(dark, body, 0.3)], [1, dark]]); c.fill(quad([NL, NR, [NR[0], NR[1] + T], [NL[0], NL[1] + T]]));
    c.fillStyle = lgrad(c, NL[0], NL[1], FR[0], FR[1], [[0, mixs(top, body, 0.4)], [0.65, top], [1, mixs(top, lit, 0.4)]]); c.fill(quad([NL, NR, FR, FL], 0.18));
    // the cushion's welt, inset, and the lit far edge (the light comes from the desk)
    c.strokeStyle = css(dark, 0.55); c.lineWidth = 3;
    c.beginPath(); c.moveTo(NL[0] + 22, NL[1] - 8); c.lineTo(NR[0] - 6, NR[1] - 8); c.lineTo(FR[0] - 26, FR[1] + 8); c.stroke();
    c.strokeStyle = css(lit, 0.7); c.lineWidth = 3;
    c.beginPath(); c.moveTo(FL[0] + 10, FL[1]); c.lineTo(FR[0] - 6, FR[1]); c.lineTo(FR[0] + 2, FR[1] + 10); c.stroke();
  }
  if (part !== 'seat') {
    // the back: its right edge's thickness (lit by the desk), then its rear face toward us, tilted back
    c.fillStyle = mixs(body, lit, 0.28);
    c.fill(smooth([[-62, -326], [-34, -314], [-22, -190], [-40, -172], [-52, -176]], true, 0.35));
    const back = smooth([[-172, -168], [-182, -262], [-162, -326], [-104, -344], [-58, -326], [-48, -172]], true, 0.4);
    c.fillStyle = lgrad(c, -182, 0, -48, 0, [[0, mixs(body, dark, 0.4)], [0.6, body], [1, mixs(body, lit, 0.2)]]); c.fill(back);
    c.save(); c.clip(back);
    c.fillStyle = dark; c.fill(smooth([[-200, -150], [-200, -350], [-128, -346], [-120, -150]], true, 0.3));
    c.strokeStyle = css(k.structDeep, 0.8); c.lineWidth = 3; c.beginPath(); c.moveTo(-172, -254); c.quadraticCurveTo(-110, -262, -50, -248); c.stroke();
    c.restore();
    c.strokeStyle = css(lit, 0.75); c.lineWidth = 3; c.beginPath(); c.moveTo(-150, -334); c.quadraticCurveTo(-104, -350, -54, -322); c.stroke();
  }
  c.restore();
}
/**
 * A lounge armchair turned THREE-QUARTER, seen from behind (the references): a tall rounded back on the left (its rear face
 * toward us, its right edge's thickness lit), the seat cushion reaching right toward the desk with its TOP PLANE showing
 * (one value step lighter than its faces), the far armrest a block at the seat's end, below the desk's edge and below
 * her forearm, short tapered legs. Origin the floor under the seat's middle. Lit from the upper right.
 */
export function paintArmchair(c: C2, R: Rig, s = 1, part: ChairPart = 'all') {
  const k = R.c, dark = mixs(k.chair, k.rackGroove, 0.35), lit = k.chairLit, top = mixs(k.chair, k.chairLit, 0.36);
  c.save(); c.scale(s, s);
  if (part !== 'back') {
    // the swivel base (reference 05's navy desk chair): a gas post, five spokes on casters, the far ones a step darker
    const metal = mixs(k.chair, k.metal, 0.35), mLit = mixs(metal, k.metalLit, 0.5);
    c.fillStyle = css(k.rackGroove, 0.35); c.fill(ell(26, 0, 150, 9));
    c.strokeStyle = mixs(metal, k.rackGroove, 0.4); c.lineWidth = 9; c.lineCap = 'round';
    c.beginPath(); for (const [dx, dy] of [[-70, -14], [110, -16]] as const) { c.moveTo(24, -26); c.lineTo(24 + dx, dy); } c.stroke();
    c.fillStyle = mixs(metal, k.rackGroove, 0.5); for (const [dx, dy] of [[-70, -14], [110, -16]] as const) c.fill(ell(24 + dx, dy + 6, 8, 6));
    c.fillStyle = lgrad(c, 14, 0, 34, 0, [[0, mLit], [0.5, metal], [1, mixs(metal, k.rackGroove, 0.4)]]); c.fillRect(16, -50, 16, 26);
    c.strokeStyle = metal; c.lineWidth = 10;
    c.beginPath(); for (const [dx, dy] of [[-104, -4], [-6, 6], [134, -2]] as const) { c.moveTo(24, -24); c.lineTo(24 + dx, dy - 4); } c.stroke();
    c.strokeStyle = css(mLit, 0.7); c.lineWidth = 2;
    c.beginPath(); for (const [dx, dy] of [[-104, -4], [-6, 6], [134, -2]] as const) { c.moveTo(24, -28); c.lineTo(24 + dx, dy - 8); } c.stroke();
    for (const [dx, dy] of [[-104, -4], [-6, 6], [134, -2]] as const) { c.fillStyle = mixs(k.chair, k.rackGroove, 0.5); c.fill(ell(24 + dx, dy + 2, 9, 7)); c.fillStyle = css(mLit, 0.6); c.fill(ell(24 + dx - 2, dy, 3, 2)); }
    c.fillStyle = mixs(metal, k.rackGroove, 0.3); c.fill(ell(24, -26, 16, 6));
    // the seat block (its near face dark, its side face toward the desk a step up) and the cushion's top plane, soft
    const NL: Pt = [-114, -88], NR: Pt = [128, -92], FR: Pt = [168, -122], FL: Pt = [-74, -118], T = 44;
    c.fillStyle = mixs(k.chair, dark, 0.4); c.fill(quad([NR, FR, [FR[0], FR[1] + T - 6], [NR[0], NR[1] + T]]));
    c.fillStyle = lgrad(c, 0, -88, 0, -44, [[0, mixs(dark, k.chair, 0.35)], [1, dark]]); c.fill(quad([NL, NR, [NR[0], NR[1] + T], [NL[0], NL[1] + T]]));
    c.fillStyle = lgrad(c, -100, -100, 160, -120, [[0, mixs(top, k.chair, 0.35)], [0.7, top], [1, mixs(top, lit, 0.45)]]); c.fill(quad([NL, NR, FR, FL], 0.2));
    // the cushion's piping along the near edge, the lit far edge
    c.strokeStyle = css(mixs(top, lit, 0.5), 0.6); c.lineWidth = 2.5; c.beginPath(); c.moveTo(NL[0] + 14, NL[1] + 3); c.lineTo(NR[0] - 6, NR[1] + 3); c.stroke();
    c.strokeStyle = css(lit, 0.75); c.lineWidth = 4;
    c.beginPath(); c.moveTo(FL[0] + 10, FL[1]); c.lineTo(FR[0] - 6, FR[1]); c.stroke();
    // the far armrest at the seat's end: a block, its top plane lit, its face toward us dark
    c.fillStyle = dark; c.fill(quad([[120, -132], [170, -136], [170, -84], [120, -80]], 0.2));
    c.fillStyle = k.chair; c.fill(quad([[170, -136], [196, -156], [196, -104], [170, -84]], 0.2));
    c.fillStyle = mixs(k.chair, lit, 0.55); c.fill(quad([[120, -132], [170, -136], [196, -156], [146, -152]], 0.25));
  }
  if (part !== 'seat') {
    // the back: its right edge's thickness (lit), then its rear face, tilted back, as high as the sitter's shoulder blades
    c.fillStyle = mixs(k.chair, lit, 0.3);
    c.fill(smooth([[-22, -228], [0, -214], [10, -84], [-10, -76], [-16, -80]], true, 0.35));
    const back = smooth([[-130, -70], [-142, -180], [-124, -236], [-62, -248], [-16, -224], [-6, -80]], true, 0.4);
    c.fillStyle = lgrad(c, -142, 0, -6, 0, [[0, mixs(k.chair, dark, 0.5)], [0.55, k.chair], [1, mixs(k.chair, lit, 0.22)]]); c.fill(back);
    c.save(); c.clip(back);
    c.fillStyle = css(dark, 0.85); c.fill(smooth([[-152, -40], [-152, -250], [-112, -244], [-104, -40]], true, 0.3));
    c.fillStyle = css(lit, 0.85); c.fill(smooth([[-124, -236], [-62, -248], [-16, -224], [-24, -222], [-64, -238], [-120, -226]], true, 0.4));
    // the upholstery: a stitched panel (a soft inset seam) and the lumbar seam
    c.strokeStyle = css(dark, 0.55); c.lineWidth = 2.5; c.beginPath(); c.moveTo(-116, -96); c.quadraticCurveTo(-128, -170, -110, -214); c.quadraticCurveTo(-66, -228, -30, -206); c.stroke();
    c.strokeStyle = css(dark, 0.9); c.lineWidth = 4; c.beginPath(); c.moveTo(-128, -160); c.quadraticCurveTo(-66, -168, -10, -156); c.stroke();
    c.strokeStyle = css(lit, 0.3); c.lineWidth = 2; c.beginPath(); c.moveTo(-124, -155); c.quadraticCurveTo(-66, -163, -12, -151); c.stroke();
    c.restore();
  }
  c.restore();
}

// ------------------------------------------------------------------------------------------------------------
// Light: a lamp's cone and pool, live
// ------------------------------------------------------------------------------------------------------------
/** A warm lamp: its bulb's glow, a cone of light down (dir radians), a pool where it lands. `k` its brightness. */
export function drawLampLight(st: Stage, R: Rig, x: number, y: number, o: DrawOpts & { k?: number; dir?: number; len?: number; spread?: number; pool?: { x: number; y: number; rx: number; ry: number } } = {}) {
  const k = o.k ?? 1;
  if (k <= 0) return;
  st.beam(x, y, o.dir ?? Math.PI / 2, o.len ?? 360, o.spread ?? 420, R.c.warmLight, { ...o, gain: 0.07 * k, apex: 0.15, feather: 30 });
  if (o.pool) st.glow(o.pool.x, o.pool.y, o.pool.rx, R.c.warmLight, { ...o, ry: o.pool.ry, gain: 0.12 * k, k: 2 });
  st.glow(x, y, 120, R.c.warmLight, { ...o, gain: 0.25 * k, k: 2.5 });
  st.glow(x, y, 26, R.c.lampLight, { ...o, gain: GLOW3.lamp * k, k: 3 });
}
/** Dust motes drifting in a cone of light (pure function of t; seeded). */
export function drawMotes(st: Stage, R: Rig, cx: number, cy: number, w: number, h: number, t: number, o: DrawOpts & { n?: number; seed?: number } = {}) {
  const n = o.n ?? 24, seed = o.seed ?? 3;
  for (let i = 0; i < n; i++) {
    const ph = hash(seed, i, 1), sp = 0.02 + 0.03 * hash(seed, i, 2);
    const u = mod(ph + t * sp, 1), x = cx + (hash(seed, i, 3) - 0.5) * w + 12 * Math.sin(TAU * (t * 0.07 + ph)), y = cy - h / 2 + u * h;
    const a = Math.sin(Math.PI * u) * (0.4 + 0.6 * hash(seed, i, 4));
    st.disc(x, y, 1.6 + 1.2 * hash(seed, i, 5), R.c.lampLight, { ...o, alpha: a * (o.alpha ?? 1), gain: 1.2, add: 1 });
  }
}

// ------------------------------------------------------------------------------------------------------------
// The cable and the conduits: glowing tubes that carry data packets
// ------------------------------------------------------------------------------------------------------------
export interface TubeOpts extends DrawOpts {
  /** tube width (world px) */
  width?: number;
  /** glow strength (0 dark: the city off) */
  k?: number;
  /** packets: n on the tube, speed (px/s), seeded */
  packets?: { n: number; speed: number; seed?: number; color?: Col; size?: number; k?: number } | null;
  /** couplings every `ring` px (the bright amber nodes of the references' conduits) */
  ring?: number;
  /** a pulse of light running along it (arc length, px) */
  pulse?: number | null;
  /** frayed (0..1): flickers and dims (the storm) */
  fray?: number; t?: number;
  /** draw only from s0 to s1 (px) */
  s0?: number; s1?: number;
  /** the glow's strength (1; 0.6 for conduits in the second plane, so the lit room stays the brightest thing) */
  glow?: number;
  /** the references' segmented light (the city's conduits): a cyan glow band with a warm-white rail in it (reference 05's lit
   * tracks), the couplings as clamps, the packets as short trains of cyan and golden squares */
  segments?: boolean;
  /** squares per packet (a lead and its followers; default 3 on a segmented conduit, else 1) */
  convoy?: number;
}
/** One data packet (reference 05): a glowing SQUARE with a bright core, turned along its path. */
export function drawPacket(st: Stage, R: Rig, x: number, y: number, sz: number, col: Col, k: number, o: DrawOpts & { rot?: number; glow?: number } = {}) {
  if (k <= 0) return;
  const g = o.glow ?? 1;
  st.glow(x, y, sz * 2.6, col, { ...o, gain: 0.34 * k * g, k: 3 });
  st.rect(x, y, sz, sz, col, { ...o, rot: o.rot, r: sz * 0.14, gain: GLOW3.packet * k * (0.7 + 0.3 * g) });
  st.rect(x, y, sz * 0.46, sz * 0.46, mixs(typeof col === 'string' ? col : R.c.packet, R.c.code4, 0.6), { ...o, rot: o.rot, r: sz * 0.08, gain: GLOW3.packet * 1.15 * k, alpha: (o.alpha ?? 1) * 0.85 });
}
/** A glowing data conduit along a path (reference 05): a dark translucent tube, a luminous core, couplings,
 * square packets. */
export function drawTube(st: Stage, R: Rig, path: Path, t: number, o: TubeOpts = {}) {
  const w = o.width ?? 14, k0 = o.k ?? 1, fr = o.fray ?? 0;
  const flick = fr > 0 ? 1 - fr * (0.5 + 0.5 * Math.sin(TAU * (t * 7.3 + hash(3, Math.floor(t * 9))))) : 1;
  const k = k0 * flick, s0 = o.s0 ?? 0, s1 = o.s1 ?? path.len;
  const pts = s0 > 0 || s1 < path.len ? path.slice(s0, s1) : path.pts;
  if (pts.length < 2) return;
  const base: DrawOpts = { depth: o.depth, haze: o.haze, alpha: o.alpha, screen: o.screen, clip: o.clip }, gl = o.glow ?? 1;
  // the halo: soft round lights along the tube (a wide feathered ribbon drew spikes at the bends)
  if (k * gl > 0.02) { const step = Math.max(10, w * 1.4), a0 = s0, a1 = s1; for (let s = a0 + step * 0.5; s < a1; s += step) { const q = path.at(s); st.glow(q.x, q.y, w * 2.1, R.c.conduitGlow, { ...base, gain: 0.075 * k * gl, k: 2.4 }); } }
  st.line(pts, w * 1.25, R.c.conduit, base);
  st.line(pts, w, gain(mixs(R.c.conduit, R.c.conduitGlow, 0.45 * k), 0.75 + 0.3 * k), { ...base, feather: 1 });
  const core = gain(mixs(R.c.conduitGlow, R.c.code4, 0.3), GLOW3.conduit * k * (0.55 + 0.45 * gl));
  if (o.segments) {
    // the lit track: a cyan band, and a warm-white rail running in it (the references' golden rails)
    st.line(pts, w * 0.56, gain(R.c.conduitGlow, 0.55 * GLOW3.conduit * k * (0.55 + 0.45 * gl)), { ...base, add: 0.6, feather: w * 0.14 });
    st.line(pts, w * 0.24, gain(mixs(R.c.packet, R.c.code4, 0.45), 1.15 * GLOW3.conduit * k * (0.6 + 0.4 * gl)), { ...base, add: 0.5, feather: w * 0.05 });
  } else st.line(pts, w * 0.42, core, { ...base, add: 0.6, feather: w * 0.08 });
  if (o.ring && k > 0.05) { let j = 0; for (let s = s0 + o.ring * 0.5; s < s1; s += o.ring, j++) {
    const p = path.at(s);
    if (o.segments) { // a clamp round the sleeve: a dark band, a lit edge, now and then a small amber marker light
      st.rect(p.x, p.y, w * 0.42, w * 1.42, mixs(R.c.conduit, R.c.rackGroove, 0.35), { ...base, rot: p.angle, r: w * 0.12 });
      st.rect(p.x - Math.cos(p.angle) * w * 0.14, p.y - Math.sin(p.angle) * w * 0.14, w * 0.1, w * 1.36, R.c.deckLit, { ...base, rot: p.angle, alpha: (o.alpha ?? 1) * 0.8 });
      if (j % 3 === 1) st.disc(p.x - Math.sin(p.angle) * w * 0.78, p.y + Math.cos(p.angle) * w * 0.78, w * 0.13, R.c.led, { ...base, gain: 1.9 * k * (0.6 + 0.4 * gl) });
      continue;
    }
    st.rect(p.x, p.y, w * 1.0, w * 1.0, R.c.packet, { ...base, rot: p.angle, r: w * 0.2, gain: 1.5 * k * (0.6 + 0.4 * gl) });
  } }
  if (o.packets && k > 0.05) {
    const P = o.packets, sz = P.size ?? w * (o.segments ? 1.2 : 0.95), nc = Math.max(1, Math.round(o.convoy ?? (o.segments ? 3 : 1))), gap = sz * 1.75;
    for (let i = 0; i < P.n; i++) {
      const s = mod((i / P.n) * path.len + t * P.speed + hash(P.seed ?? 1, i) * 30, path.len);
      for (let j = 0; j < nc; j++) {
        const sj = s - j * gap * Math.sign(P.speed || 1);
        if (sj < s0 || sj > s1 || (j > 0 && (sj < 0 || sj > path.len))) continue;
        const col = P.color ?? (nc > 1 && (i + j) % 2 === 1 ? R.c.conduitGlow : R.c.packet);
        const p = path.at(sj), fade = smootherstep(0, 40, sj - s0) * smootherstep(0, 40, s1 - sj), pk = P.k ?? 1;
        drawPacket(st, R, p.x, p.y, sz * (j === 0 ? 1 : 0.86), col, k * Math.max(pk, 0.3) * (j === 0 ? 1 : 0.85), { ...base, alpha: (o.alpha ?? 1) * fade * clamp(pk * 1.5), rot: p.angle, glow: o.glow ?? 1 });
      }
    }
  }
  if (o.pulse != null && o.pulse >= s0 && o.pulse <= s1) {
    const p = path.at(o.pulse);
    st.glow(p.x, p.y, w * 4, R.c.conduitGlow, { ...base, gain: 0.9 * k0 });
    st.disc(p.x, p.y, w * 0.6, R.c.conduitGlow, { ...base, gain: 3 * k0, add: 0.8 });
  }
}
/** A smooth path through points (world px). */
export const pathThrough = (pts: V2[], per = 20) => Path.through(pts, false, per);

/** A soft round glow texture-free halo for a light seen through haze (window, lamp from outside). */
export function drawWindowGlow(st: Stage, R: Rig, x: number, y: number, w: number, h: number, o: DrawOpts & { k?: number; col?: Col } = {}) {
  const k = o.k ?? 1;
  st.glow(x, y, Math.max(w, h) * 1.1, o.col ?? R.c.warmLight, { ...o, gain: 0.18 * k, ry: Math.max(w, h) * 0.9, k: 2 });
}

/**
 * A foreground tree, near-black against the night (the silhouette that motivates a wipe as the camera travels the
 * street): a trunk the height of the frame, branches, and a canopy of layered leaf clusters, each with a thin moonlit
 * edge on its upper right. Everything stays inside the bake (w × h): no clipped edge. Its trunk's centre line is at
 * x = w/2.
 */
export function paintWipeTree(c: C2, R: Rig, w: number, h: number, seed = 5) {
  const k = R.c, rnd = mulberry32(seed), cx = w / 2, base = k.leafNear, mid = mixs(k.leafNear, k.leafTeal, 0.5), edge = k.leafTealLit;
  // the trunk and its branches
  c.fillStyle = mixs(base, k.woodDark, 0.25);
  c.beginPath(); c.moveTo(cx - 64, h); c.bezierCurveTo(cx - 40, h * 0.62, cx - 50, h * 0.38, cx - 30, h * 0.22); c.lineTo(cx + 32, h * 0.22); c.bezierCurveTo(cx + 50, h * 0.4, cx + 40, h * 0.62, cx + 68, h); c.fill();
  c.strokeStyle = mixs(base, k.woodDark, 0.25); c.lineCap = 'round';
  for (let i = 0; i < 5; i++) { const y = h * (0.24 + 0.1 * i), d = i % 2 ? 1 : -1; c.lineWidth = 24 - i * 3; c.beginPath(); c.moveTo(cx, y + 50); c.quadraticCurveTo(cx + d * 90, y, cx + d * (130 + 50 * rnd()), y - 70); c.stroke(); }
  c.fillStyle = css(edge, 0.5); c.fillRect(cx + 26, h * 0.3, 4, h * 0.7);
  // the canopy: three layers of clusters (back: mid value, then near-black), every cluster inside the bake
  const clusters: { x: number; y: number; r: number; layer: number }[] = [];
  for (let layer = 0; layer < 3; layer++) for (let i = 0; i < 9; i++) {
    const r = (layer === 0 ? 70 : 54) + 40 * rnd();
    const a = rnd() * TAU, d = Math.sqrt(rnd());
    const x = clamp(cx + Math.cos(a) * d * (w / 2 - r - 8), r + 6, w - r - 6);
    const y = clamp(h * 0.2 + Math.sin(a) * d * h * 0.16 + layer * 30, r + 6, h * 0.5);
    clusters.push({ x, y, r, layer });
  }
  for (const L of [0, 1, 2]) for (const q of clusters.filter((z) => z.layer === L)) {
    const col = L === 0 ? mid : base;
    // a cluster: a few overlapping round leaves masses, a lit crescent on the upper right
    const blob = new Path2D();
    for (let j = 0; j < 5; j++) { const a = (j / 5) * TAU + rnd(), rr2 = q.r * (0.55 + 0.2 * rnd()); blob.addPath(ell(q.x + Math.cos(a) * q.r * 0.38, q.y + Math.sin(a) * q.r * 0.32, rr2, rr2 * 0.9)); }
    c.fillStyle = col; c.fill(blob);
    c.save(); c.clip(blob);
    c.fillStyle = css(edge, L === 0 ? 0.35 : 0.6); c.fill(ell(q.x + q.r * 0.2, q.y - q.r * 0.2, q.r * 0.95, q.r * 0.85));
    c.fillStyle = col; c.fill(ell(q.x + q.r * 0.08, q.y - q.r * 0.06, q.r * 0.98, q.r * 0.9));
    c.restore();
    // broad leaves on the rim (reference 07's tree: big ovate leaves breaking the canopy's edge), the ones up and
    // right catching the moon on their lit half
    for (let j = 0; j < 9; j++) {
      const a = -Math.PI * 0.95 + rnd() * Math.PI * 1.9, len = 22 + 18 * rnd(), wid = len * 0.42;
      const rr2 = q.r * 0.82 - len * 0.3, lx = clamp(q.x + Math.cos(a) * rr2, len + 4, w - len - 4), ly = clamp(q.y + Math.sin(a) * rr2 * 0.9, len + 4, h - len - 4);
      const up = Math.cos(a) * 0.45 - Math.sin(a) * 0.9;
      paintLeaf(c, lx, ly, len, wid, a + Math.PI / 2 + (rnd() - 0.5) * 0.6, col, { lit: up > 0.3 ? mixs(col, edge, L === 0 ? 0.45 : 0.6) : undefined, light: [0.45, -0.9], litA: 0.8, rib: up > 0.3 ? css(base, 0.5) : null });
    }
  }
}

/** Bake helper: an art whose origin (0, 0) is placed at (ox, oy) of a w × h canvas. */
export function bakeAt<T = unknown>(w: number, h: number, ox: number, oy: number, paint: (c: C2) => T, o: { res?: number; rim?: number; pad?: number } = {}): Art {
  return bake(w, h, (c) => { c.save(); c.translate(ox, oy); const d = paint(c); c.restore(); return d; }, { anchor: [ox / w, oy / h], res: o.res, rim: o.rim ?? 0, pad: o.pad ?? 4 });
}
export { lin };
