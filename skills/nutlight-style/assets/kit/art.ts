// The illustration kit's baked art (part of the Nutlight kit: scenes import from './index').
// Everything that doesn't change from frame to frame is painted ONCE, in init(), with Canvas2D into a texture
// (an Art), and the Stage draws it every frame as a lit, parallax-projected sprite. Painters below share one
// shape language: geometric, rounded, bold silhouettes; 2-4 values per object (a base, a lit side toward the key
// light, a form shadow away from it, small dark accents) plus a soft gradient; the rim light is added by the
// Stage's shader on the silhouette, so painters never draw it.
//
// Rules for painters (yours too): draw in the art's own px (0..w, 0..h), with save()/translate()/restore(),
// never setTransform() (the context is pre-scaled to the bake's resolution); no shadowBlur; colours from the Look.
import * as THREE from 'three';
import { SCALE, scaleContext2D } from '../engine/gl';
import { F, font, measure } from '../engine/type';
import { clamp, hash, lerp, mulberry32 } from '../engine/util';
import { css, faces, hex, lin, mixh, mixs, type Col, type Look } from './color';
import { ACTS } from './palette';

// ------------------------------------------------------------------------------------------------------------
// Art: a baked region of a texture
// ------------------------------------------------------------------------------------------------------------
export interface Art {
  tex: THREE.Texture;
  /** the padded region in the texture (u right, v down) */
  u0: number; v0: number; u1: number; v1: number;
  /** content size (art px, = world px at scale 1) and the transparent margin around it */
  w: number; h: number; pad: number;
  /** default anchor (0..1 of the content): where (x, y) of st.sprite() lands */
  ax: number; ay: number;
  /** 0: baked (premultiplied sRGB bytes), 1: a hardware-decoded texture (Layer2D) */
  srcMode: 0 | 1;
  /** the rim light this art takes by default (1; 0 for ground, text, flat backdrops): st.sprite's `rim` overrides */
  rim?: number;
  /** what the painter returned (window rects, joints …), in art px from the content's top-left */
  data?: any;
}
export interface BakeOpts {
  /** texels per art px over the output scale (default 1; 2 for art the camera pushes into, 0.5 for soft far layers) */
  res?: number;
  /** transparent margin (art px, default 6): room for the rim tap, soft edges and blur */
  pad?: number;
  /** default anchor (default [0.5, 0.5]; [0.5, 1] for things that stand on the ground) */
  anchor?: [number, number];
  /** the art's default rim light (default 1): 0 for ground, mounds, backdrops and text, which must not outline
   * like glass (the rim is for silhouettes against the sky or what is behind) */
  rim?: number;
}

/** Texel accounting: physical texels baked and still held (all scenes; a stage's dispose() gives its own back). */
export const BUDGET = { texels: 0 };

/** Who owns what is baked now: the Stage made or begun last (a scene's stage is its first field, so its fields'
 * and init()'s bakes are its own). The owner frees them on dispose and counts them against the budget. */
export interface ArtOwner { own(tex: THREE.Texture, texels: number): void }
let OWNER: ArtOwner | null = null;
export function setArtOwner(o: ArtOwner | null) { OWNER = o; }

function makeCanvas(pw: number, ph: number) {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.ceil(pw));
  cv.height = Math.max(1, Math.ceil(ph));
  return cv;
}
function texOf(cv: HTMLCanvasElement) {
  BUDGET.texels += cv.width * cv.height;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace; // sRGB bytes, decoded in the shader after un-premultiplying
  tex.premultiplyAlpha = true;
  tex.flipY = false;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  OWNER?.own(tex, cv.width * cv.height);
  return tex;
}

/** Paint one piece of art into its own texture. `draw` paints in art px, 0..w × 0..h. */
export function bake<T = unknown>(w: number, h: number, draw: (c: CanvasRenderingContext2D) => T, o: BakeOpts = {}): Art {
  const res = (o.res ?? 1) * SCALE, pad = o.pad ?? 6;
  const cv = makeCanvas((w + 2 * pad) * res, (h + 2 * pad) * res);
  const c = scaleContext2D(cv.getContext('2d', { willReadFrequently: true })!, res);
  c.save();
  c.translate(pad, pad);
  const data = draw(c);
  c.restore();
  const [ax, ay] = o.anchor ?? [0.5, 0.5];
  return { tex: texOf(cv), u0: 0, v0: 0, u1: ((w + 2 * pad) * res) / cv.width, v1: ((h + 2 * pad) * res) / cv.height, w, h, pad, ax, ay, srcMode: 0, data, rim: o.rim };
}

/**
 * Many pieces of art in one texture (one draw call for all of them when drawn one after another): a town's
 * buildings, a set of words, a kit of props. `add()` paints a piece and returns its Art. Shelf-packed.
 */
export class Atlas {
  private cv: HTMLCanvasElement;
  private c: CanvasRenderingContext2D;
  readonly tex: THREE.Texture;
  private x = 0; private y = 0; private rowH = 0;
  private res: number;
  constructor(public w = 2048, public h = 2048, res = 1) {
    this.res = res * SCALE;
    this.cv = makeCanvas(w * this.res, h * this.res);
    this.c = scaleContext2D(this.cv.getContext('2d', { willReadFrequently: true })!, this.res);
    this.tex = texOf(this.cv);
  }
  add<T = unknown>(w: number, h: number, draw: (c: CanvasRenderingContext2D) => T, o: BakeOpts = {}): Art {
    const pad = o.pad ?? 6, gw = Math.ceil(w + 2 * pad) + 2, gh = Math.ceil(h + 2 * pad) + 2;
    if (gw > this.w) throw new Error(`Atlas: a ${w}×${h} piece doesn't fit a ${this.w}-wide atlas`);
    if (this.x + gw > this.w) { this.x = 0; this.y += this.rowH; this.rowH = 0; }
    if (this.y + gh > this.h) throw new Error(`Atlas full (${this.w}×${this.h}): make it bigger or use a second one`);
    const x0 = this.x + 1, y0 = this.y + 1;
    this.x += gw; this.rowH = Math.max(this.rowH, gh);
    const c = this.c;
    c.save();
    c.beginPath(); c.rect(x0, y0, w + 2 * pad, h + 2 * pad); c.clip();
    c.translate(x0 + pad, y0 + pad);
    const data = draw(c);
    c.restore();
    this.tex.needsUpdate = true;
    const [ax, ay] = o.anchor ?? [0.5, 0.5];
    return { tex: this.tex, u0: x0 / this.w, v0: y0 / this.h, u1: (x0 + w + 2 * pad) / this.w, v1: (y0 + h + 2 * pad) / this.h, w, h, pad, ax, ay, srcMode: 0, data, rim: o.rim };
  }
}

/** A Layer2D (or any sRGB CanvasTexture with flipY) as an Art, for text that changes: redraw it only when it changes. */
export function layerArt(layer: { texture: THREE.Texture; w: number; h: number }, anchor: [number, number] = [0.5, 0.5]): Art {
  return { tex: layer.texture, u0: 0, v0: 1, u1: 1, v1: 0, w: layer.w, h: layer.h, pad: 0, ax: anchor[0], ay: anchor[1], srcMode: 1 };
}

/**
 * A soft shadow of an art's silhouette (black, blurred by `blur` art px), baked at low resolution: draw it with
 * st.sprite(shadowArt, …, { flat: 1, tint: look.shadow, alpha: 0.4 }) offset away from the light.
 */
export function softShadow(src: Art, blur = 18, res = 0.35): Art {
  const img = src.tex.image as HTMLCanvasElement;
  const sw = (src.u1 - src.u0) * img.width, sh = (src.v1 - src.v0) * img.height;
  const pw = src.w + 2 * src.pad, ph = src.h + 2 * src.pad;
  const pad = src.pad + blur * 1.5;
  return bake(src.w, src.h, (c) => {
    const tmp = document.createElement('canvas');
    tmp.width = Math.ceil(sw); tmp.height = Math.ceil(sh);
    const t = tmp.getContext('2d', { willReadFrequently: true })!;
    t.drawImage(img, src.u0 * img.width, src.v0 * img.height, sw, sh, 0, 0, sw, sh);
    t.globalCompositeOperation = 'source-in';
    t.fillStyle = '#000';
    t.fillRect(0, 0, tmp.width, tmp.height);
    c.filter = `blur(${blur * 0.5}px)`;
    c.drawImage(tmp, -src.pad, -src.pad, pw, ph);
    c.filter = 'none';
  }, { res, pad, anchor: [src.ax, src.ay] });
}

// ------------------------------------------------------------------------------------------------------------
// Text: labels and honesty tags (Archivo for labels, IBM Plex Mono for data; >= 36 px labels, >= 48 px story text)
// ------------------------------------------------------------------------------------------------------------
export interface LabelOpts {
  size?: number;            // px (default 40; never under 36)
  family?: string;          // default F.archivo(87.5, 700)
  color?: Col;              // default the look's paper
  bg?: Col | null;          // a pill behind it (default none)
  bgAlpha?: number;
  padX?: number; padY?: number; radius?: number;
  tracking?: number;        // px between letters
  res?: number;
  dot?: Col;                // a small dot before the text (honesty tags)
}
/** A one-line label as an Art (anchored at its centre). */
export function label(text: string, o: LabelOpts = {}, atlas?: Atlas): Art {
  const size = Math.max(36, o.size ?? 40), fam = o.family ?? F.archivo(87.5, 700), tr = o.tracking ?? 0;
  const tw = measure(text, fam, size, tr), padX = o.bg ? o.padX ?? size * 0.55 : 2, padY = o.bg ? o.padY ?? size * 0.3 : 2;
  const dotW = o.dot ? size * 0.62 : 0;
  const w = Math.ceil(tw + dotW + 2 * padX), h = Math.ceil(size * 1.18 + 2 * padY);
  const draw = (c: CanvasRenderingContext2D) => {
    if (o.bg) {
      c.fillStyle = css(o.bg, o.bgAlpha ?? 1);
      c.beginPath(); c.roundRect(0, 0, w, h, o.radius ?? h / 2); c.fill();
    }
    if (o.dot) { c.fillStyle = css(o.dot); c.beginPath(); c.arc(padX + size * 0.2, h / 2, size * 0.14, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = css(o.color ?? '#FFFFFF');
    c.font = font(fam, size);
    (c as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${tr}px`;
    c.textBaseline = 'middle';
    c.fillText(text, padX + dotW, h / 2 + size * 0.04);
  };
  return atlas ? atlas.add(w, h, draw, { pad: 4, rim: 0 }) : bake(w, h, draw, { pad: 4, res: o.res ?? 1.25, rim: 0 });
}


// ------------------------------------------------------------------------------------------------------------
// Shape language for painters
// ------------------------------------------------------------------------------------------------------------
export type Pt = [number, number];
/** A rounded rectangle path. */
export function rr(x: number, y: number, w: number, h: number, r: number | number[]): Path2D {
  const p = new Path2D();
  p.roundRect(x, y, w, h, r);
  return p;
}
/** A closed smooth path through points (Catmull-Rom as Béziers): organic but controlled silhouettes. */
export function smooth(pts: Pt[], closed = true, tension = 0.5): Path2D {
  const p = new Path2D(), n = pts.length;
  if (n < 2) return p;
  const P = (i: number) => (closed ? pts[(i + n) % n]! : pts[clamp(i, 0, n - 1)]!);
  p.moveTo(pts[0]![0], pts[0]![1]);
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2), k = tension / 3;
    p.bezierCurveTo(p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k, p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k, p2[0], p2[1]);
  }
  if (closed) p.closePath();
  return p;
}
/** A polygon path. */
export function polyPath(pts: Pt[]): Path2D {
  const p = new Path2D();
  pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  p.closePath();
  return p;
}
/** A linear gradient along the key light across a box: lit side → base → shade side. */
export function litGrad(c: CanvasRenderingContext2D, l: Look, base: Col, x: number, y: number, w: number, h: number, k = 0.5): CanvasGradient {
  const cx = x + w / 2, cy = y + h / 2, r = Math.hypot(w, h) / 2;
  const g = c.createLinearGradient(cx + l.L[0] * r, cy + l.L[1] * r, cx - l.L[0] * r, cy - l.L[1] * r);
  g.addColorStop(0, mixs(base, l.keyc, 0.2 * k));
  g.addColorStop(0.5, hex(base));
  g.addColorStop(1, mixs(base, l.shadow, 0.3 * k));
  return g;
}
/**
 * The kit's form fill: the base colour as a soft gradient along the light, a form shadow (a crescent of the shade
 * colour on the side away from the light, `shadow` of the size) and a lit crescent toward it (`light`). The rim
 * itself comes from the Stage. Bounds (x, y, w, h) size the crescents.
 */
export function formFill(c: CanvasRenderingContext2D, path: Path2D, base: Col, l: Look, x: number, y: number, w: number, h: number,
  o: { shadow?: number; light?: number; shadeCol?: Col; litCol?: Col; grad?: number } = {}) {
  const s = Math.min(w, h), sh = o.shadow ?? 0.16, li = o.light ?? 0.07;
  const ax = l.L[0] * s, ay = l.L[1] * s;
  c.save();
  c.clip(path);
  c.fillStyle = css(o.shadeCol ?? mixs(base, l.shadow, 0.3));
  c.fill(path);
  // what the path covers when moved toward the light by `shadow`: all but the far crescent
  c.translate(ax * sh, ay * sh); c.clip(path); c.translate(-ax * sh, -ay * sh);
  c.fillStyle = css(o.litCol ?? mixs(base, l.keyc, 0.2));
  c.fill(path);
  // and moved away by `light`: all but the near crescent, which stays lit
  c.translate(-ax * li, -ay * li); c.clip(path); c.translate(ax * li, ay * li);
  c.fillStyle = litGrad(c, l, base, x, y, w, h, o.grad ?? 0.5);
  c.fill(path);
  c.restore();
}
/** A plain fill with the light's gradient (small things, far things). */
export function gradFill(c: CanvasRenderingContext2D, path: Path2D, base: Col, l: Look, x: number, y: number, w: number, h: number, k = 0.5) {
  c.fillStyle = litGrad(c, l, base, x, y, w, h, k);
  c.fill(path);
}

// ------------------------------------------------------------------------------------------------------------
// Painters: land, sea, the town of pages
// ------------------------------------------------------------------------------------------------------------
/** The top edge of a range of rounded hills across w (y of the edge at each x): smooth, seeded. */
export function hillEdge(w: number, h: number, seed: number, o: { bumps?: number; amp?: number; level?: number } = {}): Pt[] {
  const rnd = mulberry32(seed), n = o.bumps ?? 4, amp = (o.amp ?? 0.35) * h, level = (o.level ?? 0.55) * h;
  const hs = Array.from({ length: n }, () => ({ c: rnd(), wdt: 0.12 + rnd() * 0.22, a: 0.45 + rnd() * 0.55 }));
  const pts: Pt[] = [];
  for (let i = 0; i <= 64; i++) {
    const u = i / 64;
    let y = level;
    for (const b of hs) { const d = (u - b.c) / b.wdt; y -= amp * b.a * Math.exp(-d * d); }
    pts.push([u * w, y]);
  }
  return pts;
}
/** A layer of hills (or dunes, or a far shore): rounded top edge, lit top, darker foot, optional lollipop trees. */
export function paintHills(c: CanvasRenderingContext2D, w: number, h: number, l: Look, o: { seed?: number; base?: Col; bumps?: number; amp?: number; level?: number; trees?: number; treeCol?: Col } = {}) {
  const base = o.base ?? l.hex.ground, edge = hillEdge(w, h, o.seed ?? 1, o);
  const p = new Path2D();
  p.moveTo(0, h);
  for (const [x, y] of edge) p.lineTo(x, y);
  p.lineTo(w, h); p.closePath();
  const top = Math.min(...edge.map((e) => e[1]));
  const g = c.createLinearGradient(0, top, 0, h);
  g.addColorStop(0, mixh(base, l.keyc, 0.18));
  g.addColorStop(0.35, hex(base));
  g.addColorStop(1, mixh(base, l.shadow, 0.45));
  c.fillStyle = g;
  c.fill(p);
  // a lit lip along the crest, on the light's side of each bump
  c.save(); c.clip(p);
  c.strokeStyle = css(mixh(base, l.keyc, 0.4), 0.55);
  c.lineWidth = Math.max(2, h * 0.012);
  c.beginPath(); edge.forEach(([x, y], i) => (i ? c.lineTo(x, y + 1) : c.moveTo(x, y + 1))); c.stroke();
  c.restore();
  const rnd = mulberry32((o.seed ?? 1) * 31 + 7);
  for (let i = 0; i < (o.trees ?? 0); i++) {
    const u = rnd(), x = u * w, y = edge[Math.round(u * 64)]![1] + 4;
    const s = h * (0.05 + rnd() * 0.05), col = o.treeCol ?? mixh(base, l.shadow, 0.3);
    c.fillStyle = css(mixh(col, l.shadow, 0.3)); c.fillRect(x - s * 0.08, y - s * 1.2, s * 0.16, s * 1.2);
    const crown = new Path2D(); crown.ellipse(x, y - s * 1.45, s * 0.55, s * 0.7, 0, 0, Math.PI * 2);
    formFill(c, crown, col, l, x - s * 0.55, y - s * 2.15, s * 1.1, s * 1.4);
  }
  return edge;
}
/** Sea bands: horizontal rounded strokes, lighter toward the horizon, for a harbour or a far ocean. */
export function paintSea(c: CanvasRenderingContext2D, w: number, h: number, l: Look, o: { base?: Col; seed?: number } = {}) {
  const base = o.base ?? l.hex.accents[2] ?? l.hex.ground;
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, mixh(base, l.haze, 0.45)); g.addColorStop(1, mixh(base, l.shadow, 0.35));
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  const rnd = mulberry32(o.seed ?? 3);
  for (let i = 0; i < 26; i++) {
    const y = h * Math.pow(rnd(), 1.4), x = rnd() * w, len = (30 + rnd() * 110) * (0.4 + y / h);
    c.strokeStyle = css(mixh(base, l.keyc, 0.35), 0.35 + 0.3 * (1 - y / h));
    c.lineWidth = 2 + 3 * (y / h); c.lineCap = 'round';
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + len, y); c.stroke();
  }
}

/** A window that is a line of text: a rect in art px, and its words (x ranges inside it); `tag` what rowWords gave;
 * `k` its brightness as painted (0.45 dim … 1 … 1.3 bright). */
export interface TextLine { x: number; y: number; w: number; h: number; words: [number, number][]; tag?: string; k: number }
export interface PageBuildingOpts {
  seed?: number;
  /** the facade's base colour (default: the look's ground, lifted) */
  wall?: Col;
  /** the roof face's visible rise and the side face's visible width (art px; 0 none): a projection's numbers */
  roof?: number; side?: number;
  /** roof shape on top of the facade: 'flat' (a parapet), 'gable', 'page' (a folded top-right corner) */
  top?: 'flat' | 'gable' | 'page';
  /** text lines: rows, line height and the text lines' colour (`unlit`; at night, a lit window colour) */
  rows?: number; lineH?: number; unlit?: Col;
  /** words of a given row (widths in line heights, from the left), e.g. a motif phrase; `tag` names it in data */
  rowWords?: (row: number) => { widths: number[]; tag: string } | undefined;
  /** a doorway at the foot (where a road arrives) */
  door?: boolean;
  /** which side face the camera sees (default the right one: the camera stands right of the building) */
  sideRight?: boolean;
  /** a heading (a thicker, shorter first line; default with 4+ rows) and a picture block on the page (default by seed) */
  heading?: boolean; image?: boolean;
  /** shares of dim and of brighter lines (default 0.15 and 0.08): no two windows alike */
  dim?: number; bright?: number;
  /** the folded corner's size for top 'page', as a share of the facade's width (default 0.3) */
  ear?: number;
}
/**
 * A page building: a sheet of text standing up, whose windows are its lines. Front facade (the page) + an oblique
 * roof face (we see the town from above) + a side face, all three from faces(): the roof catches the key light,
 * the front sits a step darker so its lit lines read, the side away from the light darkest. A big folded corner
 * (top 'page'), a heading and a picture block make it a page, not an office block. The text lines are painted at
 * their own brightness (no two windows alike); their rects come back in art.data.lines (art px, from the content's
 * top-left) so the scene can light some per frame (st.rect, a motif). Content box: w × h, the roof inside it above
 * the facade (pass h including `roof`).
 */
export function paintPageBuilding(c: CanvasRenderingContext2D, w: number, h: number, l: Look, o: PageBuildingOpts = {}): { lines: TextLine[]; face: [number, number, number, number] } {
  const rnd = mulberry32((o.seed ?? 1) * 977 + 13);
  const roof = o.roof ?? Math.round(w * 0.28), side = o.side ?? Math.round(w * 0.16);
  const right = o.sideRight ?? true;
  const fx = right ? 0 : side, fw = w - side, fy = roof, fh = h - roof;
  const wall = o.wall ?? l.hex.mat.wall;
  const top = o.top ?? 'flat';
  const F = faces(l, wall, { sideRight: right });
  // side face
  const sx = right ? fw : 0;
  const sp = right
    ? polyPath([[sx, fy], [sx + side, fy - roof], [sx + side, fy + fh - roof], [sx, fy + fh]])
    : polyPath([[side, fy], [0, fy - roof], [0, fy + fh - roof], [side, fy + fh]]);
  c.fillStyle = css(F.side); c.fill(sp);
  // roof face: the facade's top edge pushed back, lit
  const rx0 = fx, rx1 = fx + fw, dx = right ? side : -side;
  const ear = top === 'page' ? Math.min(fw * (o.ear ?? 0.3), fh * 0.3) : 0;
  if (top === 'gable') {
    const peak = Math.min(roof, fw * 0.45);
    const gp = polyPath([[rx0, fy], [rx1, fy], [rx1 + dx * 0.6, fy - peak * 0.5], [(rx0 + rx1) / 2 + dx * 0.5, fy - peak], [rx0 + dx * 0.4, fy - peak * 0.5]]);
    c.fillStyle = css(F.top); c.fill(gp);
    c.fillStyle = css(mixh(F.top, F.front, 0.55)); c.fill(polyPath([[(rx0 + rx1) / 2, fy], [rx1, fy], [rx1 + dx * 0.6, fy - peak * 0.5], [(rx0 + rx1) / 2 + dx * 0.5, fy - peak]]));
  } else {
    const rx1e = rx1 - ear; // a page's top edge stops where its corner folds
    const rp = polyPath([[rx0, fy], [rx1e, fy], [rx1e + dx, fy - roof], [rx0 + dx, fy - roof]]);
    c.fillStyle = css(F.top); c.fill(rp);
    if (top === 'flat' && roof > 5) {
      // the parapet's back edge in shade (a thin band), and now and then a roof box (a stair housing, a tank)
      c.fillStyle = css(mixh(F.top, F.front, 0.45));
      c.fill(polyPath([[rx0 + dx, fy - roof], [rx1 + dx, fy - roof], [rx1 + dx * 0.88, fy - roof * 0.88], [rx0 + dx * 0.95, fy - roof * 0.88]]));
      if (rnd() < 0.45 && fw > 30) {
        const bw = fw * (0.18 + rnd() * 0.14), bx = rx0 + fw * (0.2 + rnd() * 0.45) + dx * 0.4, by = fy - roof * 0.4, bh = Math.max(3, roof * 0.55);
        c.fillStyle = css(F.front); c.fillRect(bx, by - bh, bw, bh);
        c.fillStyle = css(F.top); c.fill(polyPath([[bx, by - bh], [bx + bw, by - bh], [bx + bw + dx * 0.18, by - bh - roof * 0.18], [bx + dx * 0.18, by - bh - roof * 0.18]]));
      }
    }
    // the lit front edge of the roof (where the moon or the sun catches it)
    c.fillStyle = css(F.edge); c.fillRect(rx0, fy - Math.max(1.2, roof * 0.08), rx1e - rx0, Math.max(1.2, roof * 0.08));
  }
  // facade: the page (its top-right corner folded for 'page')
  const rad = Math.min(8, fw * 0.06);
  const facePath = ear > 0
    ? polyPath([[fx, fy], [fx + fw - ear, fy], [fx + fw, fy + ear], [fx + fw, fy + fh], [fx, fy + fh]])
    : rr(fx, fy, fw, fh, [rad, rad, 3, 3]);
  formFill(c, facePath, F.front, l, fx, fy, fw, fh, { shadow: 0.04, light: l.night > 0.5 ? 0 : 0.015, grad: l.night > 0.5 ? 0.22 : 0.55, litCol: l.night > 0.5 ? F.front : undefined });
  if (ear > 0) { // the flap: the page's back, lit, folded down over the face, with its shadow
    c.fillStyle = css(mixh(F.front, l.shadow, 0.35));
    c.fill(polyPath([[fx + fw - ear, fy + ear * 0.12], [fx + fw - ear * 0.12, fy + ear * 1.1], [fx + fw - ear * 1.05, fy + ear * 1.12]]));
    c.fillStyle = css(mixh(F.top, l.keyc, 0.2));
    c.fill(polyPath([[fx + fw - ear, fy], [fx + fw, fy + ear], [fx + fw - ear, fy + ear]]));
  }
  // the text: lines of word-bars, like a printed page; a heading, a picture
  const lineH = o.lineH ?? Math.max(5, Math.round(fw * 0.075));
  const marginX = Math.max(4, fw * 0.12), y0 = fy + Math.max(6, fh * 0.07) + (ear > 0 ? ear * 0.35 : 0);
  const maxRows = Math.floor((fh * (o.door ? 0.76 : 0.88) - (y0 - fy)) / (lineH * 1.9));
  const rows = Math.min(o.rows ?? maxRows, maxRows);
  const lines: TextLine[] = [];
  const unlit = o.unlit ?? mixh(wall, l.shadow, 0.45);
  const dim = o.dim ?? 0.15, bright = o.bright ?? 0.08;
  const heading = (o.heading ?? rows >= 4) && rows >= 2;
  const image = (o.image ?? rnd() < 0.35) && rows >= 7 && fw > 24;
  const imgRow = image ? 1 + Math.floor(rnd() * Math.max(1, rows - 5)) : -1, imgRows = 3;
  const avail = fw - 2 * marginX - (ear > 0 ? ear * 0.2 : 0);
  let r = 0;
  for (let row = 0; row < rows; row++) {
    const y = y0 + row * lineH * 1.9;
    if (image && row >= imgRow && row < imgRow + imgRows) {
      if (row === imgRow) { // a picture on the page: a framed block with a hill and a sun, in the page's own values
        const iw = avail * (0.55 + rnd() * 0.3), ih = lineH * 1.9 * imgRows - lineH * 0.9, ix = fx + marginX;
        c.fillStyle = css(mixh(unlit, F.front, 0.62)); c.beginPath(); c.roundRect(ix, y, iw, ih, lineH * 0.35); c.fill();
        c.fillStyle = css(mixh(unlit, F.front, 0.25));
        c.beginPath(); c.moveTo(ix, y + ih); c.lineTo(ix + iw * 0.38, y + ih * 0.42); c.lineTo(ix + iw * 0.62, y + ih * 0.7); c.lineTo(ix + iw * 0.78, y + ih * 0.52); c.lineTo(ix + iw, y + ih); c.closePath(); c.fill();
        c.beginPath(); c.arc(ix + iw * 0.75, y + ih * 0.28, Math.max(1, ih * 0.14), 0, Math.PI * 2); c.fill();
      }
      continue;
    }
    const given = row === 0 && heading ? undefined : o.rowWords?.(r);
    const isHead = row === 0 && heading;
    const lh = isHead ? lineH * 1.5 : lineH, yy = isHead ? y - lineH * 0.35 : y;
    const lw = isHead ? avail * (0.45 + rnd() * 0.25) : given ? avail * (0.85 + rnd() * 0.15) : row === rows - 1 || rnd() < 0.15 ? avail * (0.35 + rnd() * 0.4) : avail * (0.82 + rnd() * 0.18);
    const words: [number, number][] = [];
    let x = 0;
    if (given) for (const g of given.widths) { const ww = Math.min(avail - x, g * lineH); if (ww > 1) words.push([x, x + ww]); x += ww + lineH * 0.7; }
    while (x < lw - 4) {
      const ww = Math.min(lw - x, lh * (isHead ? 2.2 + rnd() * 2 : 1.3 + rnd() * 3.2));
      words.push([x, x + ww]);
      x += ww + lineH * 0.7;
    }
    const q = rnd(), k = given || isHead ? 1.1 : q < dim ? 0.45 : q > 1 - bright ? 1.3 : 0.82 + 0.22 * rnd();
    const tl: TextLine = { x: fx + marginX, y: yy, w: lw, h: lh, words, tag: given?.tag, k };
    lines.push(tl);
    if (!isHead) r++;
    c.fillStyle = css(k < 1 ? mixh(unlit, F.front, (1 - k) * 0.9) : mixh(unlit, l.hex.paper, (k - 1) * 1.1));
    for (const [a, b] of words) { c.beginPath(); c.roundRect(tl.x + a, yy, b - a, lh, lh * 0.35); c.fill(); }
  }
  if (o.door) {
    const dw = Math.max(8, fw * 0.2), dh = Math.max(12, fh * 0.12);
    c.fillStyle = css(mixh(F.front, l.shadow, 0.6));
    c.beginPath(); c.roundRect(fx + fw / 2 - dw / 2, fy + fh - dh, dw, dh, [dw / 2, dw / 2, 0, 0]); c.fill();
  }
  return { lines, face: [fx, fy, fw, fh] };
}

/** A small house (yours): a gable roof, a chimney, a warm lit window, a door. Content w × h, anchored at its foot. */
export function paintHouse(c: CanvasRenderingContext2D, w: number, h: number, l: Look, o: { wall?: Col; roofCol?: Col; windowCol?: Col } = {}) {
  const wall = o.wall ?? l.hex.mat.wall, roofCol = o.roofCol ?? l.hex.mat.roof;
  const bodyY = h * 0.42, bw = w * 0.84, bx = (w - bw) / 2;
  // chimney behind the roof
  c.fillStyle = css(mixh(roofCol, l.shadow, 0.35)); c.fillRect(bx + bw * 0.68, h * 0.1, bw * 0.11, h * 0.25);
  const body = rr(bx, bodyY, bw, h - bodyY, [4, 4, 6, 6]);
  formFill(c, body, wall, l, bx, bodyY, bw, h - bodyY, { shadow: 0.12 });
  const roof = smooth([[0, bodyY + 4], [w / 2, h * 0.04], [w, bodyY + 4], [w * 0.5, bodyY + 1]], true, 0.12);
  formFill(c, roof, roofCol, l, 0, 0, w, bodyY, { shadow: 0.1 });
  // eaves shadow
  c.fillStyle = css(l.shadow, 0.35); c.fillRect(bx, bodyY + 2, bw, Math.max(3, h * 0.03));
  // window and door
  const win = o.windowCol ?? l.hex.mat.lamp;
  const ww = bw * 0.34, wh = (h - bodyY) * 0.36, wx = bx + bw * 0.12, wy = bodyY + (h - bodyY) * 0.22;
  c.fillStyle = css(mixh(wall, l.shadow, 0.5)); c.beginPath(); c.roundRect(wx - 3, wy - 3, ww + 6, wh + 6, 5); c.fill();
  c.fillStyle = css(win); c.beginPath(); c.roundRect(wx, wy, ww, wh, 3); c.fill();
  c.fillStyle = css(mixh(wall, l.shadow, 0.5)); c.fillRect(wx + ww / 2 - 1.5, wy, 3, wh); c.fillRect(wx, wy + wh / 2 - 1.5, ww, 3);
  const dw = bw * 0.2, dh = (h - bodyY) * 0.55;
  c.fillStyle = css(mixh(roofCol, l.shadow, 0.45)); c.beginPath(); c.roundRect(bx + bw * 0.66, h - dh, dw, dh, [dw / 2, dw / 2, 0, 0]); c.fill();
  return { window: [wx, wy, ww, wh] as [number, number, number, number] };
}

/** A document card: paper, rounded corners, a title bar and lines of text as bars (no fake readable text). */
export function paintCard(c: CanvasRenderingContext2D, w: number, h: number, l: Look, o: { paper?: Col; ink?: Col; lines?: number; title?: boolean; seed?: number; accent?: Col } = {}) {
  const paper = o.paper ?? l.hex.paper, ink = o.ink ?? mixh(l.hex.ink, paper, 0.55), r = Math.min(w, h) * 0.06;
  const p = rr(0, 0, w, h, r);
  formFill(c, p, paper, l, 0, 0, w, h, { shadow: 0.035, light: 0.01, grad: 0.35 });
  const rnd = mulberry32(o.seed ?? 5), m = w * 0.1, lh = Math.max(4, h * 0.045);
  let y = h * 0.12;
  if (o.title ?? true) { c.fillStyle = css(o.accent ?? ink); c.beginPath(); c.roundRect(m, y, w * (0.35 + rnd() * 0.2), lh * 1.5, lh * 0.5); c.fill(); y += lh * 3.2; }
  const n = o.lines ?? Math.floor((h - y - m) / (lh * 2));
  c.fillStyle = css(ink, 0.8);
  for (let i = 0; i < n; i++) {
    const lw = (w - 2 * m) * (i === n - 1 ? 0.45 + rnd() * 0.3 : 0.8 + rnd() * 0.2);
    c.beginPath(); c.roundRect(m, y, lw, lh, lh * 0.45); c.fill();
    y += lh * 2;
  }
}

// ------------------------------------------------------------------------------------------------------------
// The crystal vault (the picture of the model) and the lens
// ------------------------------------------------------------------------------------------------------------
/** The crystal's own colour (Act III's cyan light): the same vault in every act. */
export const CRYSTAL_TINT = ACTS.III.accents[0];
/** The crystal's outline in its content box (a quartz point: hexagonal prism with a faceted top and foot). */
export function crystalOutline(w: number, h: number): Pt[] {
  return [[w * 0.5, 0], [w * 0.9, h * 0.2], [w, h * 0.3], [w, h * 0.78], [w * 0.5, h], [0, h * 0.78], [0, h * 0.3], [w * 0.1, h * 0.2]];
}
/**
 * The crystal vault: cool, faceted, premium, lit from inside. Facets in 3-4 values of the act's cool light, edge
 * glints, an inner glow; `inner` paints a miniature (the town, a page) inside it, blurred like a lossy copy
 * (`innerBlur` art px). Draw it with gain ~1.15 and a live glow (crystalGlow in live.ts) for the light inside.
 */
export function paintCrystal(c: CanvasRenderingContext2D, w: number, h: number, l: Look, o: { tint?: Col; inner?: (c: CanvasRenderingContext2D, w: number, h: number) => void; innerBlur?: number } = {}) {
  const tint = o.tint ?? CRYSTAL_TINT; // the model is cool in every act: its own colour, not the act's first accent
  const out = crystalOutline(w, h), body = polyPath(out);
  const deep = mixh(tint, l.ink, 0.72), mid = mixh(tint, l.ink, 0.45), bright = mixh(tint, '#FFFFFF', 0.35);
  // body
  const g = c.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, mid); g.addColorStop(1, deep);
  c.fillStyle = g; c.fill(body);
  // the miniature, inside, soft
  c.save(); c.clip(body);
  if (o.inner) {
    c.save();
    c.filter = `blur(${o.innerBlur ?? 3}px)`;
    c.globalAlpha = 0.85;
    o.inner(c, w, h);
    c.restore();
  }
  // inner light
  const ig = c.createRadialGradient(w * 0.5, h * 0.55, 0, w * 0.5, h * 0.55, w * 0.62);
  ig.addColorStop(0, css(bright, 0.75)); ig.addColorStop(0.55, css(tint, 0.25)); ig.addColorStop(1, css(tint, 0));
  c.fillStyle = ig; c.fillRect(0, 0, w, h);
  // facets: three faces of the prism, the top's facets, the foot
  const facet = (pts: Pt[], col: Col, a: number) => { c.fillStyle = css(col, a); c.fill(polyPath(pts)); };
  const litLeft = l.L[0] < 0;
  facet([[0, h * 0.3], [w * 0.3, h * 0.36], [w * 0.3, h * 0.86], [0, h * 0.78]], litLeft ? bright : deep, litLeft ? 0.32 : 0.38);
  facet([[w, h * 0.3], [w * 0.7, h * 0.36], [w * 0.7, h * 0.86], [w, h * 0.78]], litLeft ? deep : bright, litLeft ? 0.38 : 0.32);
  facet([[w * 0.3, h * 0.36], [w * 0.7, h * 0.36], [w * 0.7, h * 0.86], [w * 0.3, h * 0.86]], tint, 0.12);
  facet([[w * 0.5, 0], [w * 0.1, h * 0.2], [0, h * 0.3], [w * 0.3, h * 0.36]], bright, 0.42);
  facet([[w * 0.5, 0], [w * 0.3, h * 0.36], [w * 0.7, h * 0.36]], '#FFFFFF', 0.22);
  facet([[w * 0.5, 0], [w * 0.7, h * 0.36], [w, h * 0.3], [w * 0.9, h * 0.2]], mid, 0.3);
  facet([[0, h * 0.78], [w * 0.3, h * 0.86], [w * 0.5, h], [w * 0.7, h * 0.86], [w, h * 0.78], [w * 0.5, h]], deep, 0.5);
  c.restore();
  // edges: thin light lines, brighter toward the light
  c.lineJoin = 'round';
  c.strokeStyle = css(bright, 0.85); c.lineWidth = Math.max(1.5, w * 0.012);
  c.stroke(body);
  c.strokeStyle = css('#FFFFFF', 0.45); c.lineWidth = Math.max(1, w * 0.007);
  c.beginPath();
  for (const [a, b] of [[[w * 0.3, h * 0.36], [w * 0.3, h * 0.86]], [[w * 0.7, h * 0.36], [w * 0.7, h * 0.86]], [[w * 0.3, h * 0.36], [w * 0.7, h * 0.36]], [[w * 0.5, 0], [w * 0.3, h * 0.36]], [[w * 0.5, 0], [w * 0.7, h * 0.36]], [[0, h * 0.3], [w * 0.3, h * 0.36]], [[w, h * 0.3], [w * 0.7, h * 0.36]]] as [Pt, Pt][]) {
    c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]);
  }
  c.stroke();
  // a glint on the lit top edge
  c.fillStyle = css('#FFFFFF', 0.9);
  const gx = litLeft ? w * 0.22 : w * 0.78, gy = h * 0.12;
  c.beginPath(); c.ellipse(gx, gy, w * 0.05, w * 0.012, litLeft ? -0.6 : 0.6, 0, Math.PI * 2); c.fill();
  return { outline: out };
}

/** A magnifying lens: a thick rim with a lit edge and a short handle (the glass itself is drawn live). Content
 * box 2r+handle; data.centre = the glass centre, data.r = its radius. */
export function paintLens(c: CanvasRenderingContext2D, r: number, l: Look, o: { rim?: Col; handle?: number; angle?: number } = {}) {
  const rimCol = o.rim ?? mixh(l.hex.ink, l.hex.paper, 0.3), hl = o.handle ?? r * 1.1, a = o.angle ?? Math.PI * 0.75;
  const cx = r + 10, cy = r + 10;
  // handle
  const hx = cx + Math.cos(a) * (r + 6), hy = cy + Math.sin(a) * (r + 6);
  c.save(); c.translate(hx, hy); c.rotate(a);
  const hp = rr(0, -r * 0.12, hl, r * 0.24, r * 0.12);
  formFill(c, hp, mixh(l.hex.ink, l.hex.fill, 0.45), l, 0, -r * 0.12, hl, r * 0.24);
  c.fillStyle = css(rimCol); c.fillRect(-2, -r * 0.14, r * 0.18, r * 0.28);
  c.restore();
  // rim
  const ring = new Path2D(); ring.arc(cx, cy, r + 8, 0, Math.PI * 2); ring.arc(cx, cy, r - 2, 0, Math.PI * 2, true);
  formFill(c, ring, rimCol, l, cx - r - 8, cy - r - 8, 2 * r + 16, 2 * r + 16, { shadow: 0.03, light: 0.01 });
  return { centre: [cx, cy] as Pt, r };
}

// ------------------------------------------------------------------------------------------------------------
// A small machine vocabulary
// ------------------------------------------------------------------------------------------------------------
/** A conveyor: a belt over rollers on a frame with legs. The belt's moving marks are live (beltMarks). */
export function paintConveyor(c: CanvasRenderingContext2D, w: number, h: number, l: Look, o: { frame?: Col; belt?: Col } = {}) {
  const frame = o.frame ?? l.hex.accents[1] ?? '#F2B84B', belt = o.belt ?? mixh(l.hex.ink, l.hex.ground, 0.25);
  const bh = h * 0.22;
  for (const x of [w * 0.12, w * 0.88]) { const leg = rr(x - w * 0.02, bh, w * 0.04, h - bh, 4); formFill(c, leg, mixh(frame, l.shadow, 0.25), l, x - w * 0.02, bh, w * 0.04, h - bh); }
  const bp = rr(0, 0, w, bh, bh / 2);
  formFill(c, bp, belt, l, 0, 0, w, bh, { shadow: 0.2 });
  const side = rr(w * 0.02, bh * 0.55, w * 0.96, bh * 0.45, bh * 0.2);
  formFill(c, side, frame, l, 0, bh * 0.55, w, bh * 0.45);
  const n = Math.max(3, Math.round(w / (bh * 1.6)));
  for (let i = 0; i < n; i++) {
    const x = bh / 2 + (i * (w - bh)) / (n - 1);
    c.fillStyle = css(mixh(frame, l.shadow, 0.5)); c.beginPath(); c.arc(x, bh * 0.77, bh * 0.12, 0, Math.PI * 2); c.fill();
  }
}
/** A press: two pillars, a top beam and a base plate (the ram is separate: paintPressRam). */
export function paintPress(c: CanvasRenderingContext2D, w: number, h: number, l: Look, o: { col?: Col } = {}) {
  const col = o.col ?? l.hex.accents[0] ?? '#E8553E';
  const pw = w * 0.12, beam = h * 0.14, base = h * 0.1;
  for (const x of [0, w - pw]) formFill(c, rr(x, beam * 0.5, pw, h - beam * 0.5 - base * 0.5, 6), mixh(col, l.shadow, 0.15), l, x, 0, pw, h);
  formFill(c, rr(0, 0, w, beam, beam * 0.3), col, l, 0, 0, w, beam);
  formFill(c, rr(-w * 0.03, h - base, w * 1.06, base, base * 0.3), mixh(col, l.ink, 0.45), l, 0, h - base, w, base);
}
export function paintPressRam(c: CanvasRenderingContext2D, w: number, h: number, l: Look, o: { col?: Col } = {}) {
  const col = o.col ?? mixh(l.hex.paper, l.hex.ink, 0.35);
  formFill(c, rr(w * 0.38, 0, w * 0.24, h * 0.7, 6), col, l, w * 0.38, 0, w * 0.24, h * 0.7);
  formFill(c, rr(0, h * 0.62, w, h * 0.38, h * 0.1), mixh(col, l.keyc, 0.1), l, 0, h * 0.62, w, h * 0.38);
}

// ------------------------------------------------------------------------------------------------------------
// The kitchen
// ------------------------------------------------------------------------------------------------------------
/**
 * A retro toaster seen from the front, a little from above: a chrome body (a bright band, the room's reflection,
 * a warm floor reflection), two slots on its top face, a lever slot on its side, a dial, feet. Content w × h,
 * anchored at its feet. data: slots (centre x of each, the top face's y), lever (x, y top, y bottom), dial (x, y, r).
 * part 'back' paints only the top face with its slots and 'front' everything else: draw back, the toast, front,
 * and the toast sits in its slot.
 */
export function paintToaster(c: CanvasRenderingContext2D, w: number, h: number, l: Look, o: { body?: Col; accent?: Col; part?: 'all' | 'back' | 'front' } = {}) {
  const body = o.body ?? mixh(l.hex.paper, l.hex.fill, 0.35), accent = o.accent ?? l.hex.accents[0] ?? '#E8553E';
  const topH = h * 0.16, feet = h * 0.06, bh = h - feet, part = o.part ?? 'all';
  const slots: number[] = [];
  const topFace = () => {
    c.fillStyle = css(mixh(body, '#FFFFFF', 0.4)); c.beginPath(); c.roundRect(w * 0.07, topH * 0.15, w * 0.86, topH * 0.8, topH * 0.4); c.fill();
    for (const k of [0.33, 0.67]) {
      const x = w * k; slots.push(x);
      c.fillStyle = css(mixh(l.hex.ink, body, 0.15)); c.beginPath(); c.roundRect(x - w * 0.14, topH * 0.35, w * 0.28, topH * 0.36, topH * 0.18); c.fill();
      c.fillStyle = css(l.hex.accents[1] ?? '#FFD24D', 0.55); c.beginPath(); c.roundRect(x - w * 0.12, topH * 0.5, w * 0.24, topH * 0.12, topH * 0.06); c.fill();
    }
  };
  if (part === 'back') { topFace(); return { slots, top: topH * 0.5, lever: [0, 0, 0] as [number, number, number], dial: [0, 0, 0] as [number, number, number] }; }
  // feet
  for (const x of [w * 0.16, w * 0.84]) { c.fillStyle = css(mixh(l.hex.ink, body, 0.25)); c.beginPath(); c.roundRect(x - w * 0.06, bh - 4, w * 0.12, feet + 4, 4); c.fill(); }
  // the body
  const p = rr(0, topH * 0.45, w, bh - topH * 0.45, [w * 0.22, w * 0.22, w * 0.12, w * 0.12]);
  c.save(); c.clip(p);
  // enamel in hard-edged values, the flat style's chrome: a lit shoulder, the base, the form turning under, a warm
  // floor reflection, the side away from the light; the window's reflection as two hard bars on the lit side
  const y0 = topH * 0.45, bodyH = bh - y0;
  c.fillStyle = css(body); c.fill(p);
  c.fillStyle = css(mixh(body, l.keyc, 0.38)); c.fillRect(0, y0, w, bodyH * 0.2);
  c.fillStyle = css(mixh(body, l.shadow, 0.16)); c.fillRect(0, y0 + bodyH * 0.64, w, bodyH * 0.2);
  c.fillStyle = css(mixh(body, l.hex.ground, 0.5)); c.fillRect(0, y0 + bodyH * 0.84, w, bodyH * 0.16);
  const litRight = l.L[0] > 0;
  c.fillStyle = css(mixh(body, l.shadow, 0.3)); c.fillRect(litRight ? 0 : w * 0.9, y0, w * 0.1, bodyH);
  const sx = litRight ? w * 0.66 : w * 0.22;
  c.fillStyle = css(mixh(body, l.hex.paper, 0.42));
  c.beginPath(); c.roundRect(sx, y0 + bodyH * 0.1, w * 0.085, bodyH * 0.6, w * 0.04); c.fill();
  c.beginPath(); c.roundRect(sx + w * 0.115, y0 + bodyH * 0.1, w * 0.03, bodyH * 0.6, w * 0.015); c.fill();
  c.restore();
  // the top face with two slots (in 'front', the scene draws it behind the toast with part 'back')
  if (part === 'all') topFace(); else for (const k of [0.33, 0.67]) slots.push(w * k);
  // the lever slot and the dial on the front
  const lx = w * 0.88, ly0 = bh * 0.38, ly1 = bh * 0.74;
  c.fillStyle = css(mixh(l.hex.ink, body, 0.25)); c.beginPath(); c.roundRect(lx - w * 0.018, ly0, w * 0.036, ly1 - ly0, w * 0.018); c.fill();
  const dx = w * 0.14, dy = bh * 0.7, dr = w * 0.06;
  c.fillStyle = css(mixh(body, l.shadow, 0.3)); c.beginPath(); c.arc(dx, dy + 2, dr * 1.12, 0, Math.PI * 2); c.fill();
  formFill(c, (() => { const q = new Path2D(); q.arc(dx, dy, dr, 0, Math.PI * 2); return q; })(), accent, l, dx - dr, dy - dr, 2 * dr, 2 * dr);
  // a stripe of the accent along the foot
  c.fillStyle = css(accent); c.beginPath(); c.roundRect(w * 0.06, bh * 0.86, w * 0.88, bh * 0.04, bh * 0.02); c.fill();
  return { slots, top: topH * 0.5, lever: [lx, ly0, ly1] as [number, number, number], dial: [dx, dy, dr] as [number, number, number] };
}
/** The toaster's lever knob (live: it moves along the lever slot). */
export function paintKnob(c: CanvasRenderingContext2D, w: number, h: number, l: Look, o: { col?: Col } = {}) {
  formFill(c, rr(0, 0, w, h, h / 2), o.col ?? mixh(l.hex.ink, l.hex.paper, 0.2), l, 0, 0, w, h);
}
/** A slice of toast: the classic bread silhouette (a domed top over a square foot), crust, toasted crumb. */
export function toastOutline(w: number, h: number): Pt[] {
  return [[w * 0.12, h], [w * 0.08, h * 0.42], [w * 0.0, h * 0.22], [w * 0.1, h * 0.04], [w * 0.5, h * 0.0], [w * 0.9, h * 0.04], [w * 1.0, h * 0.22], [w * 0.92, h * 0.42], [w * 0.88, h]];
}
export function paintToast(c: CanvasRenderingContext2D, w: number, h: number, l: Look, o: { done?: number; seed?: number } = {}) {
  const done = o.done ?? 0.6;
  const crust = mixh('#B8692E', '#5A2D14', done * 0.6), crumb = mixh('#F6D9A0', '#D9913F', done);
  const outer = smooth(toastOutline(w, h), true, 0.55);
  formFill(c, outer, crust, l, 0, 0, w, h, { shadow: 0.1 });
  const iw = w * 0.82, ih = h * 0.84, ix = (w - iw) / 2, iy = h * 0.075;
  const inner = smooth(toastOutline(iw, ih).map(([x, y]) => [x + ix, y + iy] as Pt), true, 0.55);
  c.save(); c.clip(inner);
  const g = c.createRadialGradient(w * 0.5, h * 0.48, w * 0.05, w * 0.5, h * 0.5, w * 0.6);
  g.addColorStop(0, mixh(crumb, '#FFF1C8', 0.35)); g.addColorStop(0.65, crumb); g.addColorStop(1, mixh(crumb, crust, 0.55));
  c.fillStyle = g; c.fill(inner);
  const rnd = mulberry32(o.seed ?? 11);
  c.fillStyle = css(mixh(crumb, crust, 0.5), 0.45);
  for (let i = 0; i < 26; i++) { c.beginPath(); c.ellipse(ix + rnd() * iw, iy + rnd() * ih, 1 + rnd() * w * 0.025, 1 + rnd() * w * 0.015, rnd() * 3, 0, Math.PI * 2); c.fill(); }
  c.restore();
  return { outline: toastOutline(w, h) };
}
/** A plate seen a little from above: a rim, a well, a highlight. */
export function paintPlate(c: CanvasRenderingContext2D, w: number, h: number, l: Look, o: { col?: Col } = {}) {
  const col = o.col ?? l.hex.paper;
  const outer = new Path2D(); outer.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  formFill(c, outer, col, l, 0, 0, w, h, { shadow: 0.06 });
  const well = new Path2D(); well.ellipse(w / 2, h * 0.52, w * 0.33, h * 0.3, 0, 0, Math.PI * 2);
  c.fillStyle = css(mixh(col, l.shadow, 0.12)); c.fill(well);
  c.strokeStyle = css(mixh(col, l.keyc, 0.6), 0.8); c.lineWidth = 2;
  c.beginPath(); c.ellipse(w / 2, h / 2, w * 0.46, h * 0.42, 0, Math.PI * 1.1, Math.PI * 1.65); c.stroke();
}
/** A butter knife, pointing right: a rounded blade with a lit edge, a handle. */
export function paintKnife(c: CanvasRenderingContext2D, w: number, h: number, l: Look, o: { handle?: Col } = {}) {
  const steel = mixh(l.hex.paper, l.hex.fill, 0.4), handle = o.handle ?? l.hex.accents[1] ?? '#2FA39A';
  const blade = smooth([[w * 0.38, h * 0.32], [w * 0.92, h * 0.18], [w, h * 0.45], [w * 0.92, h * 0.72], [w * 0.38, h * 0.7]], true, 0.3);
  formFill(c, blade, steel, l, w * 0.38, 0, w * 0.62, h);
  formFill(c, rr(0, h * 0.25, w * 0.42, h * 0.5, h * 0.25), handle, l, 0, h * 0.25, w * 0.42, h * 0.5);
}

// ------------------------------------------------------------------------------------------------------------
// The blueprint: a floor plan as light lines
// ------------------------------------------------------------------------------------------------------------
/**
 * Re-colour a channel-coded drawing (R ink, G fine ink, B stamp) into light lines on
 * transparency: R → `line`, G → `fine` at `fineAlpha`, B dropped. Paint the coded drawing with `draw` (it gets a
 * context cleared to black); the result is an Art to draw with add 1 and a little gain.
 */
export function blueprint(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, o: { line: Col; fine: Col; fineAlpha?: number; res?: number;
  /** the lines warm toward `col` along a direction (art px, from a to b: 0 at a, `k` at b): the side facing the sun */
  warm?: { col: Col; a: [number, number]; b: [number, number]; k?: number } }): Art {
  return bake(w, h, (c) => {
    const tmp = document.createElement('canvas');
    const res = (o.res ?? 1.5) * SCALE;
    tmp.width = Math.ceil(w * res); tmp.height = Math.ceil(h * res);
    const t = scaleContext2D(tmp.getContext('2d', { willReadFrequently: true })!, res);
    t.fillStyle = '#000'; t.fillRect(0, 0, w, h);
    t.save(); t.lineCap = 'round'; t.lineJoin = 'round'; draw(t); t.restore();
    const img = t.getImageData(0, 0, tmp.width, tmp.height), d = img.data;
    const L = lin(o.line), Fi = lin(o.fine), fa = o.fineAlpha ?? 0.55, wm = o.warm, Wc = wm ? lin(wm.col) : L;
    const wdx = wm ? wm.b[0] - wm.a[0] : 1, wdy = wm ? wm.b[1] - wm.a[1] : 0, wl2 = wdx * wdx + wdy * wdy || 1, wk = wm?.k ?? 0.7;
    const enc = (x: number) => Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055));
    const tw = tmp.width;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i]! / 255, g = (d[i + 1]! / 255) * fa;
      const a = Math.min(1, r + g * (1 - r));
      if (a <= 0) { d[i + 3] = 0; continue; }
      const k = r / Math.max(a, 1e-4);
      let cr = lerp(Fi[0], L[0], k), cg = lerp(Fi[1], L[1], k), cb = lerp(Fi[2], L[2], k);
      if (wm) {
        const px = ((i >> 2) % tw) / res, py = Math.floor((i >> 2) / tw) / res;
        const u = clamp(((px - wm.a[0]) * wdx + (py - wm.a[1]) * wdy) / wl2) * wk;
        cr = lerp(cr, Wc[0], u); cg = lerp(cg, Wc[1], u); cb = lerp(cb, Wc[2], u);
      }
      d[i] = enc(cr); d[i + 1] = enc(cg); d[i + 2] = enc(cb); d[i + 3] = Math.round(a * 255);
    }
    t.putImageData(img, 0, 0);
    c.drawImage(tmp, 0, 0, w, h);
  }, { res: o.res ?? 1.5, pad: 4, rim: 0 });
}
/** A blueprint's paper: a faint sheet of the act's fill with a lit edge and one corner curling up toward the light.
 * Draw it under the blueprint's lines, alpha ~0.3: the plan is a drawing on something, not lines in the void. */
export function paintBlueprintSheet(c: CanvasRenderingContext2D, w: number, h: number, l: Look, o: { curl?: number } = {}) {
  const k = Math.min(w, h) * (o.curl ?? 0.16);
  const body = polyPath([[0, 0], [w, 0], [w, h - k], [w - k, h], [0, h]]);
  const g = c.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, mixh(l.hex.fill, l.hex.ground, 0.3)); g.addColorStop(1, mixh(l.hex.ground, l.hex.shadow, 0.3));
  c.fillStyle = g; c.fill(body);
  c.strokeStyle = css(mixh(l.hex.fill, l.hex.key, 0.5), 0.7); c.lineWidth = 2; c.stroke(body);
  // the curl: the sheet's back, lit, rolled over at the bottom-right corner, its shadow under it
  c.fillStyle = css(l.hex.shadow, 0.45); c.fill(polyPath([[w, h - k], [w - k, h], [w - k * 1.15, h - k * 1.05]]));
  c.fillStyle = css(mixh(l.hex.fill, l.hex.key, 0.45)); c.fill(smooth([[w, h - k], [w - k * 0.92, h - k * 0.92], [w - k, h]], true, 0.3));
}


/** Seeded scatter of n points in a box (deterministic layouts: stars, crumbs, windows). */
export function scatter(n: number, seed: number, x: number, y: number, w: number, h: number): Pt[] {
  return Array.from({ length: n }, (_, i) => [x + hash(seed, i, 1) * w, y + hash(seed, i, 2) * h] as Pt);
}
