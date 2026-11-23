// Nutlight, 16-bit: the kit's own Stage, squirrels, props and rigs, shown the way a 16-bit console would draw them
// (the skill's references/16-bit.md has the craft). A scene draws with the kit exactly as before, but inside layers;
// each layer is turned into pixel art on a low-resolution grid and the layers are put together as that hardware did:
//
//   tiles    a background plane: a small palette, ordered dithering where a gradient crosses two of its colours,
//            scrolled in whole pixels (its `depth` makes it scroll slower: parallax)
//   sprites  characters and things that move: a palette of 15 colours each, a 1 px outline
//   sky      a gradient in 15-bit colour, no palette (the scanline gradient those skies were)
//   raw      what is already pixel art (icons, stars, status lights set on the grid): 15-bit colour, no palette
//   light    added to the picture (colour math): glows, lamps and screens' halos, in a few flat steps
//   shade    a translucent shadow toward the setting's deep colour
//
// and the frame leaves in 15-bit colour, every pixel a whole block of the output (10×10 at `--scale 2`). The
// conversion knows nothing about squirrels: it takes whatever the Stage draws. The helpers at the end time the
// squirrels' drawings as drawn frames are timed. `hd: true` renders the same scene in the kit's own look.
import * as THREE from 'three';
import type { SceneCtx } from '../engine/scene';
import { SHOULDER_GLSL, type PostParams } from '../engine/post';
import { FSPass, makeRT, W, H } from '../engine/gl';
import { frameTime, hash } from '../engine/util';
import { cam as mkCam, type Cam } from './motion';
import { lin, type Col } from './color';
import type { Stage } from './stage';
import { alive, blink, hop as kitHop, withPose, type SqPose } from './squirrel';

// ------------------------------------------------------------------------------------------------------------
// Colour: sRGB bytes <-> linear <-> Oklab, and 15-bit colour (5 bits a channel)
// ------------------------------------------------------------------------------------------------------------
type V3 = [number, number, number];
const toLin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const toS = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055);
const snap5 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 31) / 31;
function oklab(r: number, g: number, b: number): V3 {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function unOklab(L: number, a: number, b: number): V3 {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
const hex2 = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');

/** A palette: up to 48 colours in 15-bit colour (sRGB 0..1, three a colour), darkest first. */
export interface Palette { n: number; srgb: Float32Array; lab: Float32Array; hex: string[] }
const PN = 48;
/** How much a difference of hue or chroma counts against one of lightness when a colour looks for its palette entry. */
const CHROMA = 1.6;

/** A palette from colours you name (any order; snapped to 15-bit, duplicates dropped, sorted dark to light). */
export function paletteOf(cols: readonly Col[]): Palette {
  const seen = new Map<string, V3>();
  for (const c of cols) {
    const l = lin(c), s: V3 = [snap5(toS(l[0])), snap5(toS(l[1])), snap5(toS(l[2]))];
    seen.set(s.join(), s);
  }
  const list = [...seen.values()].map((s) => ({ s, lab: oklab(toLin(s[0]), toLin(s[1]), toLin(s[2])) })).sort((a, b) => a.lab[0] - b.lab[0]).slice(0, PN);
  const srgb = new Float32Array(PN * 3), lab = new Float32Array(PN * 3);
  list.forEach((e, i) => { srgb.set(e.s, i * 3); lab.set(e.lab, i * 3); });
  return { n: list.length, srgb, lab, hex: list.map((e) => '#' + hex2(e.s[0]) + hex2(e.s[1]) + hex2(e.s[2])) };
}
/** Two palettes as one (a sprite layer with two characters). */
export const joinPalettes = (...ps: Palette[]) => paletteOf(ps.flatMap((p) => p.hex));

/**
 * Choose `n` colours for a picture (sRGB bytes with alpha, as the extract pass reads them back): k-means in Oklab
 * over the picture's 15-bit histogram. A colour's weight is its pixel count to the power `gamma` (0.5), so a small
 * thing that matters (an eye's glint, a status light) gets a colour of its own instead of dissolving into the
 * big areas. `pins` are colours the palette must hold as they are. Deterministic: no random start.
 */
export function choosePalette(bytes: Uint8Array, n: number, o: { pins?: readonly Col[]; gamma?: number } = {}): Palette {
  const hist = new Map<number, number>();
  for (let i = 0; i < bytes.length; i += 4) {
    if (bytes[i + 3]! < 128) continue;
    const key = ((bytes[i]! >> 3) << 10) | ((bytes[i + 1]! >> 3) << 5) | (bytes[i + 2]! >> 3);
    hist.set(key, (hist.get(key) ?? 0) + 1);
  }
  const pts: { lab: V3; w: number }[] = [];
  for (const [key, count] of [...hist.entries()].sort((a, b) => a[0] - b[0])) {
    const r = ((key >> 10) & 31) / 31, g = ((key >> 5) & 31) / 31, b = (key & 31) / 31;
    pts.push({ lab: oklab(toLin(r), toLin(g), toLin(b)), w: Math.pow(count, o.gamma ?? 0.5) });
  }
  const pp = paletteOf(o.pins ?? []); // the pins in 15-bit colour, each once
  const pins: V3[] = Array.from({ length: pp.n }, (_, i) => [pp.lab[i * 3]!, pp.lab[i * 3 + 1]!, pp.lab[i * 3 + 2]!]);
  if (pins.length > Math.min(n, PN)) throw new Error(`choosePalette: ${pins.length} pinned colours for a palette of ${n}`);
  const d2 = (a: V3, b: V3) => (a[0] - b[0]) ** 2 + CHROMA * ((a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
  const cen: V3[] = pins.map((p) => [...p] as V3);
  const want = Math.min(PN, Math.max(n, pins.length));
  if (pts.length) {
    // farthest-point start: the heaviest colour, then whichever is worst served so far
    if (!cen.length) cen.push([...pts.reduce((a, b) => (b.w > a.w ? b : a)).lab] as V3);
    while (cen.length < want) {
      let best = -1, bv = 0;
      for (let i = 0; i < pts.length; i++) {
        let m = Infinity;
        for (const c of cen) m = Math.min(m, d2(pts[i]!.lab, c));
        if (m * pts[i]!.w > bv) { bv = m * pts[i]!.w; best = i; }
      }
      if (best < 0) break;
      cen.push([...pts[best]!.lab] as V3);
    }
    for (let it = 0; it < 32; it++) {
      const sum = cen.map(() => [0, 0, 0, 0]);
      for (const p of pts) {
        let bi = 0, bd = Infinity;
        for (let c = 0; c < cen.length; c++) { const d = d2(p.lab, cen[c]!); if (d < bd) { bd = d; bi = c; } }
        const s = sum[bi]!; s[0]! += p.lab[0] * p.w; s[1]! += p.lab[1] * p.w; s[2]! += p.lab[2] * p.w; s[3]! += p.w;
      }
      let moved = 0;
      for (let c = pins.length; c < cen.length; c++) {
        const s = sum[c]!;
        if (s[3]! <= 0) continue;
        const nx: V3 = [s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!];
        moved += d2(nx, cen[c]!); cen[c] = nx;
      }
      if (moved < 1e-9) break;
    }
  }
  return paletteOf(cen.map((c) => { const l = unOklab(c[0], c[1], c[2]); return [Math.min(1, Math.max(0, l[0])), Math.min(1, Math.max(0, l[1])), Math.min(1, Math.max(0, l[2]))] as V3; }));
}

// ------------------------------------------------------------------------------------------------------------
// The passes
// ------------------------------------------------------------------------------------------------------------
const GLSL_PIX = /* glsl */ `
vec3 oklab(vec3 c) {
  float l = pow(max(0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b, 0.0), 1.0 / 3.0);
  float m = pow(max(0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b, 0.0), 1.0 / 3.0);
  float s = pow(max(0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b, 0.0), 1.0 / 3.0);
  return vec3(0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s);
}
vec3 snap5(vec3 c) { return floor(clamp(c, 0.0, 1.0) * 31.0 + 0.5) / 31.0; }
// ordered dither thresholds in -0.5..0.5: the 2x2 checker family of the era's hand dithering, or the finer 4x4
float bayer2(vec2 p) { vec2 q = mod(p, 2.0); return q.y < 0.5 ? (q.x < 0.5 ? 0.0 : 2.0) : (q.x < 0.5 ? 3.0 : 1.0); }
float bayer(vec2 p, float size) {
  if (size < 3.0) return (bayer2(p) + 0.5) / 4.0 - 0.5;
  return (4.0 * bayer2(p) + bayer2(floor(p / 2.0)) + 0.5) / 16.0 - 0.5;
}`;

/** The layer as the kit drew it (full size, premultiplied linear light) -> pixel art on the grid. */
const PIX_FRAG = /* glsl */ `
uniform sampler2D src; uniform vec2 grid; uniform int mode; uniform int n;
uniform vec3 palLab[${PN}]; uniform vec3 palRGB[${PN}];
uniform float dither, ditherSize, bias, cover, hazeK, levels, gain, chroma, tone; uniform vec3 hazeC; uniform vec4 shade; uniform vec2 scroll;
uniform vec4 holes[4]; uniform int nHoles;
${SHOULDER_GLSL}
${GLSL_PIX}
const int N = 4; const int S = 16;
int nearest(vec3 lab) {
  int bi = 0; float bd = 1e9;
  for (int i = 0; i < ${PN}; i++) {
    if (i >= n) break;
    vec3 d = lab - palLab[i];
    float e = d.x * d.x + chroma * (d.y * d.y + d.z * d.z);
    if (e < bd) { bd = e; bi = i; }
  }
  return bi;
}
void main() {
  vec2 cell = floor(vUv * grid);
  vec3 rgb[S]; float ok[S];
  vec3 mean = vec3(0.0), sum = vec3(0.0); float cnt = 0.0, asum = 0.0;
  for (int j = 0; j < N; j++) for (int i = 0; i < N; i++) {
    vec4 s = texture(src, (cell + (vec2(float(i), float(j)) + 0.5) / float(N)) / grid);
    int k = j * N + i;
    sum += s.rgb; asum += s.a;
    ok[k] = step(0.5, s.a);
    vec3 c = s.rgb / max(s.a, 1e-4);
    rgb[k] = clamp(tone > 0.5 ? shoulder(c) : c, 0.0, 1.0);
    mean += rgb[k] * ok[k]; cnt += ok[k];
  }
  // the dither's pattern belongs to the layer, not to the screen: it scrolls with what it shades (a pattern fixed to
  // the screen makes every dithered pixel flip when the layer moves by an odd number of pixels)
  float b = bayer(vec2(cell.x, grid.y - 1.0 - cell.y) + scroll, ditherSize);
  if (mode == 2) { // light: what the layer adds, in a few flat steps of one intensity (its hue kept)
    vec2 cd = vec2(cell.x, grid.y - 1.0 - cell.y);
    for (int i = 0; i < 4; i++) {
      if (i >= nHoles) break;
      if (cd.x >= holes[i].x && cd.y >= holes[i].y && cd.x < holes[i].z && cd.y < holes[i].w) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    }
    vec3 l = toSRGB(1.0 - exp(-sum / float(S) * gain));
    float v = max(max(l.r, l.g), l.b);
    float q = floor(v * levels + 0.5 + dither * b) / levels;
    fragColor = vec4(v > 1e-4 ? clamp(l * (q / v), 0.0, 1.0) : vec3(0.0), 1.0);
    return;
  }
  if (mode == 3) { // shade: a translucent shadow in the setting's deep colour
    float a = (asum > 0.0 ? step(cover, asum / float(S)) : 0.0) * shade.a;
    fragColor = vec4(shade.rgb * a, a);
    return;
  }
  if (cnt < 0.5 || cnt / float(S) < cover) { fragColor = vec4(0.0); return; }
  mean /= cnt;
  if (mode == 4) { fragColor = vec4(toSRGB(mean), 1.0); return; } // extract: the colours a palette is chosen from
  if (mode == 1) { // 15-bit colour, no palette
    vec3 c = toSRGB(mean);
    fragColor = vec4(snap5(floor(c * 31.0 + 0.5 + dither * b) / 31.0), 1.0);
    return;
  }
  // a palette: every sample takes its nearest colour, the pixel takes the colour most of them chose
  float Lm = oklab(mean).x;
  int idx[S]; float wt[S];
  for (int k = 0; k < S; k++) {
    if (ok[k] > 0.5) {
      vec3 lab = oklab(rgb[k]);
      wt[k] = max(0.05, 1.0 + bias * (lab.x - Lm) * 10.0);
      lab.x += dither * b;
      idx[k] = nearest(lab);
    } else { idx[k] = -1; wt[k] = 0.0; }
  }
  int best = 0; float bw = -1.0;
  for (int k = 0; k < S; k++) {
    if (idx[k] < 0) continue;
    float w = 0.0;
    for (int m = 0; m < S; m++) if (idx[m] == idx[k]) w += wt[m];
    if (w > bw) { bw = w; best = idx[k]; }
  }
  fragColor = vec4(snap5(mix(palRGB[best], hazeC, hazeK)), 1.0);
}`;

/** A pixel layer over the frame so far, with a sprite's outline. */
const BLIT_FRAG = /* glsl */ `
uniform sampler2D src; uniform vec2 texel; uniform vec4 outline; uniform float selout, clean;
void main() {
  vec4 c = texture(src, vUv);
  vec4 l = texture(src, vUv - vec2(texel.x, 0.0)), r = texture(src, vUv + vec2(texel.x, 0.0));
  vec4 d = texture(src, vUv - vec2(0.0, texel.y)), u = texture(src, vUv + vec2(0.0, texel.y));
  if (c.a < 0.5) {
    float a = l.a + r.a + d.a + u.a;
    if (outline.a > 0.5 && a > 0.5) {
      // the outline takes the setting's dark, pulled toward the colour it borders (a coloured outline, not a black one)
      vec3 near = (l.rgb * l.a + r.rgb * r.a + d.rgb * d.a + u.rgb * u.a) / a;
      c = vec4(floor(mix(outline.rgb, near * outline.rgb * 2.2, selout) * 31.0 + 0.5) / 31.0, 1.0);
    }
  } else if (clean > 0.0) {
    // a stray pixel: none of its eight neighbours has its colour, and it barely differs from the one beside it
    // (a glint in an eye differs a lot and stays). It takes that neighbour's colour.
    vec4 q[8];
    q[0] = l; q[1] = r; q[2] = d; q[3] = u;
    q[4] = texture(src, vUv + texel * vec2(-1.0, -1.0)); q[5] = texture(src, vUv + texel * vec2(1.0, -1.0));
    q[6] = texture(src, vUv + texel * vec2(-1.0, 1.0)); q[7] = texture(src, vUv + texel * vec2(1.0, 1.0));
    bool alone = true; float bd = 1e9; vec3 bc = c.rgb;
    for (int i = 0; i < 8; i++) {
      if (q[i].a < 0.5) continue;
      vec3 e = q[i].rgb - c.rgb; float dd = dot(e, e);
      if (dd < 1e-5) alone = false;
      if (i < 4 && dd < bd) { bd = dd; bc = q[i].rgb; }
    }
    if (alone && bd < clean * clean) c.rgb = bc;
  }
  fragColor = c;
}`;

/** The frame on the grid -> the output: whole blocks, 15-bit colour, and the hardware's own effects. */
const FINAL_FRAG = /* glsl */ `
uniform sampler2D src; uniform vec2 grid; uniform float mosaic, bright; uniform vec4 iris; uniform vec3 irisC;
void main() {
  vec2 p = floor(vUv * grid);
  if (mosaic > 1.0) p = min(floor(p / mosaic) * mosaic + floor(mosaic * 0.5), grid - 1.0);
  vec3 c = floor(texture(src, (p + 0.5) / grid).rgb * 31.0 + 0.5) / 31.0;
  c = floor(c * 31.0 * bright + 0.001) / 31.0; // the screen-brightness register: 16 steps
  if (iris.w > 0.5) {
    vec2 q = vec2(p.x + 0.5, grid.y - p.y - 0.5) - iris.xy;
    if (dot(q, q) > iris.z * iris.z) c = irisC;
  }
  fragColor = vec4(toLinear(c), 1.0);
}`;

export interface LayerOpts {
  /** what the layer is (default 'tiles') */
  kind?: 'tiles' | 'sprites' | 'sky' | 'raw' | 'light' | 'shade';
  /** parallax: the layer scrolls 1/depth as fast as the camera, in whole pixels (default 1; Infinity: fixed) */
  depth?: number;
  /** its colours (tiles, sprites); none for sky, raw, light and shade */
  palette?: Palette;
  /** ordered dithering where a gradient passes between two palette colours, in Oklab lightness (0 none; 0.05 a
   * band of checker between neighbours of a ramp); for sky and light, in steps of the colour depth */
  dither?: number;
  /** the dither's cell: 2 (the checker family, default) or 4 (finer, 16 thresholds) */
  ditherSize?: 2 | 4;
  /** which small details survive: above 0 the bright ones (status lights, stars, a glint), below 0 the dark ones
   * (a mouth, a seam) */
  bias?: number;
  /** the share of a pixel a shape must cover to take it (default 0.5; lower fattens thin things) */
  cover?: number;
  /** sprites: the outline's colour (the setting's deep colour; null for none) and how far it takes the hue of
   * what it borders (0 one flat colour … 1) */
  outline?: Col | null; selout?: number;
  /** stray pixels: one alone among its eight neighbours takes its neighbour's colour when it differs from it by
   * less than this (sRGB distance; default 0.22: a ramp's steps go, a glint stays; 0 keeps every pixel) */
  clean?: number;
  /** sky and raw: the colours through the kit's tone shoulder, as its post would show them (default true); false
   * keeps them exactly as named (a palette's own swatches) */
  tone?: boolean;
  /** a far layer's palette, shifted toward the haze */
  haze?: number; hazeColor?: Col;
  /** light: its steps of intensity (default 4) and the strength it is added at */
  levels?: number; gain?: number;
  /** light: rectangles it leaves alone (world px under the layer's camera; up to 4): a lit screen's face, a lamp's
   * shade, so a glow never dithers the thing it comes from */
  holes?: readonly { x: number; y: number; w: number; h: number }[];
  /** shade: its colour and darkness */
  color?: Col; alpha?: number;
}
export interface FrameFx {
  /** the mosaic register: every block of n × n pixels shows one of them (1 none) */
  mosaic?: number;
  /** screen brightness, 0..1, in 16 steps (a fade the hardware's way) */
  bright?: number;
  /** a window: only a circle shows (centre in logical px, radius in logical px), the rest in `color` */
  iris?: { x: number; y: number; r: number; color?: Col } | null;
}

/** What the engine's post does to a pixel frame: nothing. The pixels arrive as they were made. */
export const PIXEL_POST: Partial<PostParams> = { exposure: 1, shoulder: 0, bloom: 0, halation: 0, ca: 0, grain: 0, vignette: 0, fade: 0, flash: 0, zoom: 1, shake: [0, 0], invert: 0, hud: 0, frame: 0 };

/** The full-size target a layer is drawn into before it is turned into pixels: one per renderer, shared by every
 * PixelStage (scenes render one at a time, and each layer is drawn and converted before the next begins), so a
 * video of many 16-bit scenes holds one, not one per scene (about 100 MB each at 4K). */
const SCRATCH = new WeakMap<THREE.WebGLRenderer, { rt: THREE.WebGLRenderTarget; users: number }>();
function takeScratch(r: THREE.WebGLRenderer) {
  let e = SCRATCH.get(r);
  if (!e) { e = { rt: makeRT(), users: 0 }; SCRATCH.set(r, e); }
  e.users++;
  return e.rt;
}
function giveScratch(r: THREE.WebGLRenderer) {
  const e = SCRATCH.get(r);
  if (e && --e.users <= 0) { e.rt.dispose(); SCRATCH.delete(r); }
}

function lowRT(w: number, h: number) {
  return new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
}
function over(p: FSPass, add = false) {
  const m = p.mat;
  m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor; m.blendDst = add ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = add ? THREE.ZeroFactor : THREE.OneFactor; m.blendDstAlpha = add ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor;
  return p;
}

export class PixelStage {
  /** logical px per pixel of the picture (6: 320×180, about a 16-bit console's pixel count; 5: 384×216, about its
   * line count) */
  readonly px: number;
  readonly gw: number; readonly gh: number;
  /** the camera (a pan: whole pixels; the grid has no zoom) */
  cam: Cam = mkCam();
  private full: THREE.WebGLRenderTarget;
  private low: THREE.WebGLRenderTarget; private acc: THREE.WebGLRenderTarget;
  private pix: FSPass; private blit: FSPass; private blitAdd: FSPass; private fin: FSPass;
  private out: THREE.WebGLRenderTarget | null = null;
  private black = new Float32Array(PN * 3);
  /** (a check) show only the nth layer of the frame, over black: a layer alone must come out the same from frame to
   * frame, moved by whole pixels */
  solo: number | null = null;
  private nth = 0;
  /** the same scene as the kit draws it, unconverted (to compare the two): layers go straight to the frame under
   * the rig's post, with no grid, palettes, outlines or shade layers */
  readonly hd: boolean;

  constructor(private ctx: SceneCtx, readonly st: Stage, o: { px?: number; hd?: boolean } = {}) {
    this.px = o.px ?? 5;
    this.hd = !!o.hd;
    this.gw = Math.round(W / this.px); this.gh = Math.round(H / this.px);
    if (this.gw * this.px !== W || this.gh * this.px !== H) throw new Error(`PixelStage: ${this.px} px doesn't divide the ${W}×${H} frame`);
    this.full = takeScratch(ctx.renderer);
    this.low = lowRT(this.gw, this.gh); this.acc = lowRT(this.gw, this.gh);
    const grid = new THREE.Vector2(this.gw, this.gh), texel = new THREE.Vector2(1 / this.gw, 1 / this.gh);
    this.pix = new FSPass(PIX_FRAG, {
      src: { value: this.full.texture }, grid: { value: grid }, mode: { value: 0 }, n: { value: 0 },
      palLab: { value: this.black }, palRGB: { value: this.black }, dither: { value: 0 }, ditherSize: { value: 2 }, bias: { value: 0 },
      cover: { value: 0.5 }, hazeK: { value: 0 }, hazeC: { value: new THREE.Vector3() }, levels: { value: 12 }, gain: { value: 1 },
      chroma: { value: CHROMA }, tone: { value: 1 }, shade: { value: new THREE.Vector4() }, scroll: { value: new THREE.Vector2() },
      holes: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] }, nHoles: { value: 0 },
    });
    const bu = () => ({ src: { value: this.low.texture }, texel: { value: texel }, outline: { value: new THREE.Vector4() }, selout: { value: 0 }, clean: { value: 0 } });
    this.blit = over(new FSPass(BLIT_FRAG, bu(), { transparent: true }));
    this.blitAdd = over(new FSPass(BLIT_FRAG, bu(), { transparent: true }), true);
    this.fin = new FSPass(FINAL_FRAG, { src: { value: this.acc.texture }, grid: { value: grid }, mosaic: { value: 1 }, bright: { value: 1 }, iris: { value: new THREE.Vector4() }, irisC: { value: new THREE.Vector3() } });
  }
  private disposed = false;
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    giveScratch(this.ctx.renderer);
    this.low.dispose(); this.acc.dispose();
    for (const p of [this.pix, this.blit, this.blitAdd, this.fin]) p.mat.dispose(); // (the fullscreen triangle is the engine's, shared)
  }

  /** A length or a position on the pixel grid (things that move take whole pixels, or their edges crawl). */
  snap(v: number) { return this.hd ? v : Math.round(v / this.px) * this.px; }
  /** The camera a layer at `depth` is drawn under: the pan divided by the depth, in whole pixels. */
  camAt(depth = 1): Cam {
    const k = depth === Infinity ? 0 : 1 / Math.max(depth, 0.02);
    return mkCam(W / 2 + this.snap((this.cam.x - W / 2) * k), H / 2 + this.snap((this.cam.y - H / 2) * k), 1);
  }
  /** The cameras a layer at `depth` is seen from while the camera pans from x0 to x1 (for extract's `views`). */
  views(x0: number, x1: number, depth = 1, n = 5): Cam[] {
    const k = depth === Infinity ? 0 : 1 / Math.max(depth, 0.02);
    return Array.from({ length: n }, (_, i) => mkCam(W / 2 + this.snap((x0 + ((x1 - x0) * i) / Math.max(1, n - 1) - W / 2) * k), H / 2, 1));
  }

  /** Start a frame. */
  begin(out: THREE.WebGLRenderTarget, c: Cam = mkCam()) {
    this.out = out; this.cam = c; this.nth = 0;
    if (this.hd) { this.st.begin(out); return this; }
    this.st.begin(this.full);
    const r = this.ctx.renderer;
    r.setRenderTarget(this.acc); r.setClearColor(0x000000, 1); r.clear(true, false, false);
    return this;
  }

  private sRGB(c: Col): V3 { const l = lin(c); return [toS(l[0]), toS(l[1]), toS(l[2])]; }
  private pixelize(o: LayerOpts, mode: number) {
    const u = this.pix.u, p = o.palette;
    u.mode!.value = mode;
    u.n!.value = p?.n ?? 0; u.palLab!.value = p?.lab ?? this.black; u.palRGB!.value = p?.srgb ?? this.black;
    u.dither!.value = o.dither ?? 0; u.ditherSize!.value = o.ditherSize ?? 2; u.bias!.value = o.bias ?? 0; u.cover!.value = o.cover ?? 0.5;
    u.hazeK!.value = o.haze ?? 0; (u.hazeC!.value as THREE.Vector3).set(...this.sRGB(o.hazeColor ?? this.st.look.haze));
    u.levels!.value = o.levels ?? 4; u.gain!.value = o.gain ?? 1; u.tone!.value = o.tone === false ? 0 : 1;
    const hs = (o.holes ?? []).slice(0, 4), ox = this.st.cam.x - W / 2, oy = this.st.cam.y - H / 2, px = this.px;
    hs.forEach((h, i) => (u.holes!.value as THREE.Vector4[])[i]!.set(Math.round((h.x - ox) / px), Math.round((h.y - oy) / px), Math.round((h.x + h.w - ox) / px), Math.round((h.y + h.h - oy) / px)));
    u.nHoles!.value = hs.length;
    (u.shade!.value as THREE.Vector4).set(...this.sRGB(o.color ?? this.st.look.shadow), o.alpha ?? 0.45);
    this.pix.render(this.ctx.renderer, this.low);
  }

  /** Draw a layer with the kit (inside `draw`, at depth 1 under the layer's own camera) and add it to the frame. */
  layer(o: LayerOpts, draw: () => void) {
    const st = this.st, kind = o.kind ?? 'tiles';
    st.cam = this.camAt(o.depth ?? 1);
    (this.pix.u.scroll!.value as THREE.Vector2).set(Math.round((st.cam.x - W / 2) / this.px), Math.round((st.cam.y - H / 2) / this.px));
    if (this.hd) { if (kind !== 'shade') { draw(); st.flush(); } return; }
    if (this.solo !== null && this.nth++ !== this.solo) return;
    st.target(this.full);
    draw();
    st.flush();
    if ((kind === 'tiles' || kind === 'sprites') && !o.palette) throw new Error(`PixelStage: a ${kind} layer needs a palette`);
    this.pixelize(o, kind === 'light' ? 2 : kind === 'shade' ? 3 : kind === 'sky' || kind === 'raw' ? 1 : 0);
    const b = kind === 'light' ? this.blitAdd : this.blit;
    const ol = kind === 'sprites' && o.outline !== null ? this.sRGB(o.outline ?? this.st.look.shadow) : null;
    (b.u.outline!.value as THREE.Vector4).set(ol?.[0] ?? 0, ol?.[1] ?? 0, ol?.[2] ?? 0, ol ? 1 : 0);
    b.u.selout!.value = o.selout ?? 0.5;
    b.u.clean!.value = kind === 'tiles' || kind === 'sprites' ? o.clean ?? 0.22 : 0;
    b.render(this.ctx.renderer, this.acc);
  }

  /** Finish the frame: the grid to the output, with the hardware's effects; returns the post overrides. */
  end(fx: FrameFx = {}, extra: Partial<PostParams> = {}): Partial<PostParams> {
    if (this.hd) return { ...this.st.end(), ...extra };
    this.st.end();
    const u = this.fin.u;
    u.mosaic!.value = Math.max(1, Math.round(fx.mosaic ?? 1));
    u.bright!.value = Math.round(Math.min(1, Math.max(0, fx.bright ?? 1)) * 15) / 15;
    const ir = fx.iris;
    (u.iris!.value as THREE.Vector4).set((ir?.x ?? 0) / this.px, (ir?.y ?? 0) / this.px, (ir?.r ?? 0) / this.px, ir ? 1 : 0);
    const ic: V3 = ir?.color ? this.sRGB(ir.color) : [0, 0, 0];
    (u.irisC!.value as THREE.Vector3).set(snap5(ic[0]), snap5(ic[1]), snap5(ic[2]));
    this.fin.render(this.ctx.renderer, this.out);
    return { ...PIXEL_POST, ...extra };
  }

  /**
   * Choose a palette for what `draw` draws (call it in init(), never inside a frame): the layer's colours as the
   * kit lights them, reduced to `n`. `views`: the cameras to look from (a layer wider than the frame is seen
   * from several); `pins`: colours it must keep.
   */
  extract(draw: () => void, n: number, o: { views?: Cam[]; pins?: readonly Col[]; gamma?: number; cover?: number } = {}): Palette {
    if (this.hd) return paletteOf([]);
    const st = this.st, r = this.ctx.renderer, buf = new Uint8Array(this.gw * this.gh * 4);
    const all: Uint8Array[] = [];
    st.begin(this.full);
    for (const v of o.views ?? [mkCam()]) {
      st.cam = v;
      st.target(this.full);
      draw();
      st.flush();
      this.pixelize({ cover: o.cover }, 4);
      r.readRenderTargetPixels(this.low, 0, 0, this.gw, this.gh, buf);
      all.push(buf.slice());
    }
    st.end();
    const bytes = new Uint8Array(all.length * buf.length);
    all.forEach((a, i) => bytes.set(a, i * buf.length));
    return choosePalette(bytes, n, o);
  }

  // ----------------------------------------------------------------------------------------------------------
  // Drawn frames. A sprite redrawn from a pose that changes a little every frame is a new picture every frame,
  // and its outline crawls; drawn animation repeats a few drawings instead. (Under `hd`, the kit's own motion.)
  // ----------------------------------------------------------------------------------------------------------
  /** The time a sprite's drawing shows at `t`: the drawings change `fps` times a second (12, as animation is drawn
   * on twos and threes), and positions still move every frame. */
  drawing(t: number, fps = 12) { return this.hd ? t : Math.floor(frameTime(t) * fps + 1e-6) / fps; }

  /** A character at rest: alive()'s breathing, head drift and tail sway at three moments of their cycle, played as
   * the loop 0, 1, 2, 1 three times a second (the same three drawings every time round), and blinks of two drawings
   * at the kit's own seeded times. Call it last, on the pose the scene has acted. */
  idle(p: SqPose, t: number, seed = 0): SqPose {
    if (this.hd) return alive(p, t, seed);
    const k = IDLE_LOOP[Math.floor(t * 3 + 4 * hash(seed, 1)) % 4]!;
    const q = alive(p, 0.9 * k + 3 * hash(seed, 2), seed);
    return { ...q, eye: p.eye * (blink(t, seed) < 0.5 ? 0.06 : 1) };
  }

  /** A hop from `t0`, `dur` s long: the height moves every frame (draw the sprite at `snap(y - lift)`), the drawings
   * are a crouch before it, a stretch in the air and a landing. `air` (0..1) shrinks its shadow. Under `hd`, the
   * kit's hop(). */
  hop(p: SqPose, t: number, t0: number, height = 85, dur = 0.5): { pose: SqPose; lift: number; air: number } {
    const u = (t - t0) / dur, air = u > 0 && u < 1 ? Math.sin(Math.PI * u) : 0;
    if (this.hd) return { pose: kitHop(p, t, t0, height, dur), lift: 0, air };
    const ua = (this.drawing(t) - t0) / dur;
    const pose = ua >= -0.17 && ua < 0 ? withPose(p, { sy: p.sy * 0.9 })
      : ua >= 0 && ua < 1 ? withPose(p, { sy: p.sy * 1.05, tail: p.tail - 0.12 })
      : ua >= 1 && ua < 1.17 ? withPose(p, { sy: p.sy * 0.9 }) : p;
    return { pose, lift: height * air, air };
  }

  /** A block of `w` × `h` pixels of the grid, its top-left at (x, y) (world px, snapped). Small lights, cursors,
   * keys: detail smaller than a pixel turns to noise, so it is set on the grid by hand. */
  cell(x: number, y: number, w: number, h: number, col: Col) {
    const u = this.px;
    this.st.rect(this.snap(x) + (w * u) / 2, this.snap(y) + (h * u) / 2, w * u, h * u, col);
  }

  /** A hand-drawn icon: a string a row, a character a pixel ('.' for none), each character's colour in `colors`,
   * its top-left at (x, y) on the grid. `clipX` keeps it inside a screen's face as it slides; `map` changes a
   * colour on the way (a flash). An icon is pixel art in either look. */
  icon(rows: readonly string[], colors: Record<string, Col>, x: number, y: number, o: { clipX?: readonly [number, number]; map?: (ch: string, col: Col) => Col } = {}) {
    const u = this.px, x0 = Math.round(x / u) * u, y0 = Math.round(y / u) * u;
    rows.forEach((row, j) => [...row].forEach((ch, i) => {
      if (ch === '.') return;
      const px = x0 + i * u, col = colors[ch];
      if (col === undefined) throw new Error(`PixelStage.icon: no colour for '${ch}'`);
      if (o.clipX && (px < o.clipX[0] || px + u > o.clipX[1])) return;
      this.st.rect(px + u / 2, y0 + j * u + u / 2, u, u, o.map ? o.map(ch, col) : col);
    }));
  }
}
/** The idle's loop of drawings. */
const IDLE_LOOP = [0, 1, 2, 1];
