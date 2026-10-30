// The illustration kit's Stage (part of the Nutlight kit: scenes import from './index'). One per scene: a 2D camera
// with parallax depth, the act's Look (palette, key light, haze, post), and an immediate-mode draw API that
// batches on the GPU in call order. See index.ts for the guide.
import * as THREE from 'three';
import type { SceneCtx } from '../engine/scene';
import type { PostParams } from '../engine/post';
import type { ActKey } from './palette';
import { W, H, SCALE, clearRT } from '../engine/gl';
import { smootherstep } from '../engine/util';
import { MarkBatch, MK, MAX_POLY, QuadPass, RibbonBatch, RIB_STRIDE, SpriteBatch, planetPass, polyPass, skyPass, underPass } from './stage-gl';
import { BUDGET, setArtOwner, type Art, type ArtOwner } from './art';
import { gain as gainc, lin, look as lookOf, mixc, threadColor, type Col, type Look, type RGB, type ThreadRole } from './color';
import { cam as mkCam, type Cam, type Path } from './motion';

/** A point: {x, y} or [x, y], with an optional own depth (d / third element) for lines that recede (each point
 * then fades into the haze by its own depth), and (objects only) a width multiplier w (a road narrowing with
 * distance) and an alpha multiplier a (a contrail thinning with age). */
export type P = { x: number; y: number; d?: number; w?: number; a?: number } | readonly [number, number] | readonly [number, number, number];
/** A circle clip in screen px: draws keep what is inside it (or outside, with outside: true). */
export interface Clip { x: number; y: number; r: number; feather?: number; outside?: boolean }

export interface DrawOpts {
  /** parallax depth: 1 the focal plane (default), 2 twice as far (pans half as much, zooms less), Infinity the sky,
   * 0.5 a near foreground (pans twice as much). */
  depth?: number;
  /** 0..1 atmospheric fade toward the look's haze (default from depth: look.hazeK × (depth − 1), up to 0.92). */
  haze?: number;
  alpha?: number;
  /** coordinates are screen px (tags, HUD-like labels): no camera, no parallax */
  screen?: boolean;
  /** a circle clip for this draw (default the stage's current `clip`) */
  clip?: Clip | null;
}
export interface SpriteOpts extends DrawOpts {
  scale?: number; sx?: number; sy?: number; rot?: number;
  /** 0..1 of the art: the point that lands on (x, y) (default the art's own anchor) */
  anchor?: readonly [number, number];
  tint?: Col; gain?: number;
  /** rim light multiplier (× the act's rim; 0 off), width in screen px (default 3), colour (default look.rim) */
  rim?: number; rimWidth?: number; rimColor?: Col;
  /** 0 alpha-over … 1 pure light (added) */
  add?: number;
  /** soft focus: mip bias (0 sharp … 3 very soft): far layers, the blurry copy inside the crystal */
  blur?: number;
  /** 0..1: the silhouette in the tint colour (cast shadows, colour-match cuts) */
  flat?: number;
  /** a part of the art, 0..1 of its padded region [u0, v0, u1, v1] */
  crop?: readonly [number, number, number, number];
}
export interface MarkOpts extends DrawOpts {
  rot?: number;
  /** 0 flat … 1 lit: a terminator toward `shade` away from the key light and a rim on the lit edge */
  lit?: number;
  shade?: Col;
  rim?: number;
  /** soft edge (world px) */
  feather?: number;
  add?: number;
  gain?: number;
}
export interface LineOpts extends DrawOpts {
  feather?: number; add?: number; gain?: number;
  /** round sharp corners (turns past ~100°) with a fillet as wide as the line, so wide or glowing lines never fold
   * into a wedge (default true) */
  fillet?: boolean;
  /** width and feather in screen px, whatever the depth's scale (a trajectory seen from far away) */
  px?: boolean;
  /** dashes: [on, off] in screen px */
  dash?: readonly [number, number];
  closed?: boolean;
}
export interface ThreadOpts extends DrawOpts {
  role?: ThreadRole;
  /** width in screen px, whatever the depth's scale */
  px?: boolean;
  /** colour override (linear or hex) */
  color?: Col;
  /** drawn from arc length s0 (default 0) */
  s0?: number;
  width?: number;
  /** halo strength (0 none) and core gain */
  glow?: number; gain?: number;
  /** a glowing head at the drawn end (default true while drawing) */
  head?: boolean;
  /** on paper (verify red as ink): no halo, alpha-over */
  ink?: boolean;
}
export interface PlanetOpts extends DrawOpts {
  day?: Col; day2?: Col; night?: Col; atmosphere?: Col; warm?: Col;
  /** atmosphere glow thickness as a fraction of the radius (default 0.08) */
  atm?: number;
  /** terminator softness (default 0.14), band strength (0.3), craters (0) */
  soft?: number; bands?: number; craters?: number; seed?: number;
  /** the light in 3D (x right, y down, z toward you); default the look's */
  light?: readonly [number, number, number];
  ring?: { inner: number; outer: number; tilt: number; angle?: number; color?: Col; k?: number };
  rimK?: number; glowK?: number;
  /** the lit limb and the outer glow away from the sun (default 0.03, 0.05): the limb is gold near the sun, dark
   * blue away from it */
  rimFloor?: number; glowFloor?: number;
  /** a world's surface: continents, oceans, clouds, coastal city lights on the night side, a glint on the oceans */
  surface?: PlanetSurface;
}
export interface PlanetSurface {
  land?: Col; land2?: Col; ocean?: Col; cloud?: Col; cloudShade?: Col; city?: Col;
  /** the sea level in noise units (−0.2 mostly land … 0.2 mostly sea; default 0.05), the continents' size (1.6) */
  level?: number; scale?: number;
  /** cloud cover 0..1 (default 0.8) and its scale; city lights' strength (0 none) and density (cells per radius) */
  clouds?: number; cloudScale?: number; cities?: number; cityScale?: number;
  /** the planet's turn (radians about its axis) and its axis's tilt toward the viewer: which face we see */
  spin?: number; tilt?: number; roll?: number;
  /** a bright cluster of lights at this point of the surface (unit vector in the planet's frame; see surfacePoint) */
  hot?: readonly [number, number, number]; hotK?: number; hotR?: number;
  /** the sun's glint on the oceans (default 1) */
  glint?: number;
  /** close to the ground (they fade out by themselves as the planet shrinks on screen): fields on a lattice of
   * `fields` cells per radius with roads on some borders, a river; `field` the third field colour (default the
   * act's accents[3]: ochre); the land raised around `hot` (hotLand, 0..1: the place is on land); the hot cluster
   * by day as pale specks (`specks` 0..1: a town seen from high up) */
  fields?: number; field?: Col; road?: Col; river?: number; hotLand?: number; specks?: number; speck?: Col;
}
export interface SkyOpts {
  top?: Col; bottom?: Col;
  /** the gradient runs from yTop to yBottom (screen px; default the frame) */
  yTop?: number; yBottom?: number;
  horizon?: { y: number; width?: number; color?: Col; k?: number };
  sun?: { x: number; y: number; r: number; color?: Col; k?: number };
  nebula?: { k: number; c1?: Col; c2?: Col; scale?: number; seed?: number; offset?: readonly [number, number] };
}

// Shared GPU pools: one scene renders at a time (a crossfade renders its scenes one after the other).
type Pools = { sprites: SpriteBatch[]; marks: MarkBatch[]; ribs: RibbonBatch[]; sky?: QuadPass; planet?: QuadPass; poly?: QuadPass; under?: QuadPass };
const POOLS: Pools = { sprites: [], marks: [], ribs: [] };

/** The stage of each timeline entry (by id): a stage made for an entry frees the textures of the one before it (a
 * hot reload), and in export the least recently drawn stages give their textures back to the GPU (re-uploaded from
 * their canvases if drawn again: the same pixels). */
const LIVE = new Map<string, Stage>();
const LRU: Stage[] = [];
/** Baked texels a scene may hold (at --scale 1; ×4 at --scale 2), and what the export keeps resident at once. */
export const TEXEL_BUDGET = { perScene: 12e6, resident: 40e6 };

const ONE: RGB = [1, 1, 1];

export class Stage implements ArtOwner {
  /** the camera (set it every frame: a pure function of t) */
  cam: Cam = mkCam();
  look: Look;
  /** a clip applied to every draw that doesn't pass its own (set it, draw, set it back to null) */
  clip: Clip | null = null;
  /** extra post overrides merged into end()'s result */
  post: Partial<PostParams> = {};
  out: THREE.WebGLRenderTarget | null = null;
  /** begin()'s target, which target(null) returns to */
  private frameOut: THREE.WebGLRenderTarget | null = null;
  private renderer: THREE.WebGLRenderer;
  private si = 0; private mi = 0; private ri = 0;
  private cur: { kind: 'sprite'; b: SpriteBatch; tex: THREE.Texture } | { kind: 'mark'; b: MarkBatch } | { kind: 'ribbon'; b: RibbonBatch } | null = null;
  // derived from the camera's roll and the look's light (recomputed when either changes)
  private k0 = { rc: 1, rs: 0, Lx: 0, Ly: -1, rot: NaN, L: null as null | readonly number[] };
  /** a screen-space magnifier applied after projection (withMagnify) */
  private mag: { x: number; y: number; m: number } | null = null;
  /** the baked textures this stage's scene made (bake / Atlas / label … register themselves) */
  private owned: { tex: THREE.Texture; texels: number }[] = [];
  /** physical texels baked by this scene */
  texels = 0;
  private disposed = false; private warned = false;

  constructor(protected ctx: SceneCtx, act: ActKey | Look) {
    this.renderer = ctx.renderer;
    this.look = typeof act === 'string' ? lookOf(act) : act;
    const prev = LIVE.get(ctx.id);
    if (prev && prev.ctx !== ctx) prev.dispose(); // the scene was reloaded: its old textures go
    LIVE.set(ctx.id, this);
    setArtOwner(this); // what the scene bakes from here on (its fields, its init()) is this stage's
  }

  // ---- what the scene baked ------------------------------------------------------------------------------------
  /** (called by bake / Atlas) a texture this stage's scene made */
  own(tex: THREE.Texture, texels: number) {
    this.owned.push({ tex, texels });
    this.texels += texels;
    const budget = TEXEL_BUDGET.perScene * SCALE * SCALE;
    if (!this.warned && this.texels > budget) {
      this.warned = true;
      console.warn(`[illo budget] scene '${this.ctx.id}' has baked ${(this.texels / SCALE / SCALE / 1e6).toFixed(1)} megatexels (the budget is ${TEXEL_BUDGET.perScene / 1e6} per scene at --scale 1): bake far layers at res 0.5, share an Atlas, crop`);
    }
  }
  /** Free this scene's baked textures on the GPU (call it from the scene's dispose()). */
  dispose() {
    for (const o of this.owned) o.tex.dispose();
    if (!this.disposed) BUDGET.texels -= this.texels;
    this.disposed = true;
    const i = LRU.indexOf(this); if (i >= 0) LRU.splice(i, 1);
    if (LIVE.get(this.ctx.id) === this) LIVE.delete(this.ctx.id);
  }
  /** In export, keep the most recently drawn stages' textures resident (TEXEL_BUDGET.resident) and release the rest. */
  private touch() {
    if (!this.ctx.export) return;
    const i = LRU.indexOf(this);
    if (i >= 0) LRU.splice(i, 1);
    LRU.push(this);
    let sum = LRU.reduce((n, s) => n + s.texels, 0);
    const cap = TEXEL_BUDGET.resident * SCALE * SCALE;
    while (sum > cap && LRU.length > 2) {
      const old = LRU.shift()!;
      for (const o of old.owned) o.tex.dispose();
      sum -= old.texels;
    }
  }

  // ---- frame ------------------------------------------------------------------------------------------------
  /** Start a frame into `out`. Set `cam` (and `look`, if it changes) before or right after. */
  begin(out: THREE.WebGLRenderTarget, l?: Look) {
    if (l) this.look = l;
    this.out = out; this.frameOut = out;
    setArtOwner(this); // art baked lazily in render() is this scene's too
    this.touch();
    this.si = 0; this.mi = 0; this.ri = 0; this.cur = null;
    this.prepare();
    return this;
  }
  /** Flush everything and return the post overrides for this frame: the act's, then `post`, then `extra`. */
  end(extra: Partial<PostParams> = {}): Partial<PostParams> {
    this.flush();
    return { ...this.look.post, ...this.post, ...extra };
  }
  /** Draw into another target from here on (an offscreen pass); begin()'s target again with target(null). */
  target(rt: THREE.WebGLRenderTarget | null, keep = false) {
    this.flush();
    if (rt && !keep) clearRT(this.renderer, rt, [0, 0, 0], 0);
    this.out = rt ?? this.frameOut;
  }
  private prepare() {
    const r = this.cam.rot, L = this.look.L;
    this.k0.rc = Math.cos(r); this.k0.rs = Math.sin(r);
    this.k0.Lx = L[0] * this.k0.rc - L[1] * this.k0.rs; this.k0.Ly = L[0] * this.k0.rs + L[1] * this.k0.rc;
    this.k0.rot = r; this.k0.L = L;
  }
  private sync() { if (this.cam.rot !== this.k0.rot || this.look.L !== this.k0.L) this.prepare(); }
  /** Fill the target with one colour (instead of a sky). */
  clear(col: Col) { this.flush(); clearRT(this.renderer, this.out, lin(col)); }

  // ---- the camera ---------------------------------------------------------------------------------------------
  /** World point at depth d → screen px, and the scale there (screen px per world px). */
  project(x: number, y: number, d = 1): { x: number; y: number; s: number } {
    const p = this.proj(x, y, d, false);
    return { x: p[0], y: p[1], s: p[2] };
  }
  /** Screen px → the world point at depth d under it. */
  unproject(sx: number, sy: number, d = 1): { x: number; y: number } {
    const c = this.cam, k = d === Infinity ? 0 : 1 / Math.max(d, 0.02), s = this.scaleK(k, d);
    const dx = sx - W / 2, dy = sy - H / 2, rc = Math.cos(-c.rot), rs = Math.sin(-c.rot);
    const ux = (dx * rc - dy * rs) / s, uy = (dx * rs + dy * rc) / s;
    return { x: ux + W / 2 + (c.x - W / 2) * k, y: uy + H / 2 + (c.y - H / 2) * k };
  }
  /** Scale (screen px per world px) of things at depth d. */
  scaleAt(d = 1) { return this.scaleK(d === Infinity ? 0 : 1 / Math.max(d, 0.02), d); }
  /** zoom^(1/d), times the dolly's d / (d + back) */
  private scaleK(k: number, d: number) {
    const b = this.cam.back ?? 0;
    const z = Math.pow(this.cam.zoom, k);
    return b === 0 || d === Infinity ? z : z * (Math.max(d, 0.02) / Math.max(1e-3, Math.max(d, 0.02) + b));
  }
  private proj(x: number, y: number, d: number, screen: boolean | undefined): [number, number, number] {
    let px: number, py: number, s: number;
    if (screen) { px = x; py = y; s = 1; }
    else {
      this.sync();
      const c = this.cam, k = d === Infinity ? 0 : 1 / Math.max(d, 0.02);
      s = this.scaleK(k, d);
      const dx = (x - (W / 2 + (c.x - W / 2) * k)) * s, dy = (y - (H / 2 + (c.y - H / 2) * k)) * s;
      px = W / 2 + dx * this.k0.rc - dy * this.k0.rs; py = H / 2 + dx * this.k0.rs + dy * this.k0.rc;
    }
    const m = this.mag;
    if (m) { px = m.x + (px - m.x) * m.m; py = m.y + (py - m.y) * m.m; s *= m.m; }
    return [px, py, s];
  }
  private hazeOf(o: DrawOpts) {
    if (o.haze !== undefined) return o.haze;
    const d = o.depth ?? 1;
    return d > 1 && d !== Infinity ? Math.min(0.92, this.look.hazeK * (d - 1)) : 0;
  }
  /** Nothing of a draw (bounding circle at px, py, radius R) is inside the clip that keeps the inside. */
  private culledByClip(px: number, py: number, R: number, o: DrawOpts) {
    const c = o.clip === undefined ? this.clip : o.clip;
    return !!c && !c.outside && Math.hypot(px - c.x, py - c.y) > c.r + R + (c.feather ?? 1);
  }
  private clipOf(o: DrawOpts): [number, number, number, number] {
    const c = o.clip === undefined ? this.clip : o.clip;
    if (!c) return [0, 0, 0, 0];
    return [c.x, c.y, c.outside ? -Math.max(c.r, 0.01) : Math.max(c.r, 0.01), c.feather ?? 1];
  }
  /** Run `fn` with another camera (a lens's magnified view, an inset), then restore. */
  withCam(c: Cam, fn: () => void) {
    const old = this.cam; this.cam = c; this.prepare();
    try { fn(); } finally { this.cam = old; this.prepare(); }
  }
  /** Run `fn` with everything magnified m times around screen point (x, y) (a lens: combine with a clip). */
  withMagnify(x: number, y: number, m: number, fn: () => void) {
    const old = this.mag; this.mag = { x, y, m };
    try { fn(); } finally { this.mag = old; }
  }
  /** Run `fn` with a clip on every draw, then restore. */
  withClip(c: Clip | null, fn: () => void) {
    const old = this.clip; this.clip = c;
    try { fn(); } finally { this.clip = old; }
  }

  // ---- batching -------------------------------------------------------------------------------------------------
  /** Flush what is pending (the next draw of another kind does it by itself). */
  flush() {
    this.sync();
    const c = this.cur;
    if (!c || !this.out) { this.cur = null; return; }
    if (c.kind === 'sprite') { const l = this.look; c.b.setHaze(l.haze, l.haze, H); c.b.flush(this.renderer, this.out); }
    else if (c.kind === 'mark') { c.b.setLight([this.k0.Lx, this.k0.Ly]); c.b.flush(this.renderer, this.out); }
    else c.b.flush(this.renderer, this.out);
    this.cur = null;
  }
  private spriteBatch(tex: THREE.Texture, srcMode: number): SpriteBatch {
    const c = this.cur;
    if (c && c.kind === 'sprite' && c.tex === tex && !c.b.full) return c.b;
    this.flush();
    const b = POOLS.sprites[this.si] ?? (POOLS.sprites[this.si] = new SpriteBatch(1024));
    this.si++;
    b.setTexture(tex, srcMode);
    this.cur = { kind: 'sprite', b, tex };
    return b;
  }
  private markBatch(): MarkBatch {
    const c = this.cur;
    if (c && c.kind === 'mark' && !c.b.full) return c.b;
    this.flush();
    const b = POOLS.marks[this.mi] ?? (POOLS.marks[this.mi] = new MarkBatch(4096));
    this.mi++;
    this.cur = { kind: 'mark', b };
    return b;
  }
  private ribbonBatch(nv: number): RibbonBatch {
    const c = this.cur;
    if (c && c.kind === 'ribbon' && c.b.room(nv)) return c.b;
    this.flush();
    const b = POOLS.ribs[this.ri] ?? (POOLS.ribs[this.ri] = new RibbonBatch(16384));
    this.ri++;
    this.cur = { kind: 'ribbon', b };
    return b;
  }

  // ---- sprites (baked art) -----------------------------------------------------------------------------------
  /** Draw an Art at world (x, y): parallax, rim light, haze, tint/gain, soft focus, silhouette. */
  sprite(a: Art, x: number, y: number, o: SpriteOpts = {}) {
    const alpha = o.alpha ?? 1;
    if (alpha <= 0) return;
    const d = o.depth ?? 1, sc = o.scale ?? 1, sx = (o.sx ?? 1) * sc, sy = (o.sy ?? 1) * sc;
    if (sx === 0 || sy === 0) return;
    const rot = o.rot ?? 0, [axn, ayn] = o.anchor ?? [a.ax, a.ay];
    const lcx = a.w * (0.5 - axn) * sx, lcy = a.h * (0.5 - ayn) * sy, cr = Math.cos(rot), sr = Math.sin(rot);
    const [px, py, s] = this.proj(x + lcx * cr - lcy * sr, y + lcx * sr + lcy * cr, d, o.screen);
    const hx = (a.w / 2 + a.pad) * sx * s, hy = (a.h / 2 + a.pad) * sy * s;
    const tr = rot + (o.screen ? 0 : this.cam.rot), c2 = Math.cos(tr), s2 = Math.sin(tr);
    const R = Math.abs(hx) + Math.abs(hy);
    if (px + R < -2 || px - R > W + 2 || py + R < -2 || py - R > H + 2) return; // off screen
    if (this.culledByClip(px, py, R, o)) return;
    let u0 = a.u0, v0 = a.v0, u1 = a.u1, v1 = a.v1;
    let qx = hx, qy = hy, ox = 0, oy = 0;
    if (o.crop) { // a part: shrink the quad to it, move its centre
      const [c0, c1, c3, c4] = o.crop;
      const nu0 = u0 + (u1 - u0) * c0, nv0 = v0 + (v1 - v0) * c1, nu1 = u0 + (u1 - u0) * c3, nv1 = v0 + (v1 - v0) * c4;
      ox = ((c0 + c3) / 2 - 0.5) * 2 * hx; oy = ((c1 + c4) / 2 - 0.5) * 2 * hy;
      qx = hx * (c3 - c0); qy = hy * (c4 - c1);
      u0 = nu0; v0 = nv0; u1 = nu1; v1 = nv1;
    }
    const cx = px + ox * c2 - oy * s2, cy = py + ox * s2 + oy * c2;
    const b = this.spriteBatch(a.tex, a.srcMode), D = b.data, i = b.next();
    D[i] = cx; D[i + 1] = cy;
    D[i + 2] = qx * c2; D[i + 3] = qx * s2;
    D[i + 4] = -qy * s2; D[i + 5] = qy * c2;
    D[i + 6] = u0; D[i + 7] = v0; D[i + 8] = u1; D[i + 9] = v1;
    const tint = o.tint === undefined ? ONE : lin(o.tint), g = o.gain ?? 1;
    D[i + 10] = tint[0] * g; D[i + 11] = tint[1] * g; D[i + 12] = tint[2] * g; D[i + 13] = alpha;
    D[i + 14] = this.hazeOf(o); D[i + 15] = o.add ?? 0; D[i + 16] = o.blur ?? 0; D[i + 17] = o.flat ?? 0;
    const rimK = (o.rim ?? a.rim ?? 1) * this.look.rimK;
    if (rimK > 0 && !(o.flat && o.flat >= 1) && qx !== 0 && qy !== 0) {
      const lx0 = this.k0.Lx, ly0 = this.k0.Ly;
      const lx = (lx0 * c2 + ly0 * s2) * Math.sign(sx), ly = (-lx0 * s2 + ly0 * c2) * Math.sign(sy);
      const rw = o.rimWidth ?? 3;
      D[i + 18] = (lx * rw) / (2 * Math.abs(qx)) * (u1 - u0);
      D[i + 19] = (ly * rw) / (2 * Math.abs(qy)) * (v1 - v0);
      const rc = lin(o.rimColor ?? this.look.rim);
      D[i + 20] = rc[0] * rimK; D[i + 21] = rc[1] * rimK; D[i + 22] = rc[2] * rimK;
    } else { D[i + 18] = 0; D[i + 19] = 0; D[i + 20] = 0; D[i + 21] = 0; D[i + 22] = 0; }
    const cl = this.clipOf(o);
    D[i + 23] = cl[0]; D[i + 24] = cl[1]; D[i + 25] = cl[2]; D[i + 26] = cl[3];
  }

  // ---- marks (procedural shapes) ----------------------------------------------------------------------------
  private mark(kind: number, x: number, y: number, hx: number, hy: number, param: number, col: Col, o: MarkOpts, defAdd = 0) {
    const alpha = o.alpha ?? 1;
    if (alpha <= 0) return;
    const [px, py, s] = this.proj(x, y, o.depth ?? 1, o.screen);
    const sx = hx * s, sy = hy * s, R = Math.abs(sx) + Math.abs(sy) + (o.feather ?? 0) * s + 2;
    if (px + R < 0 || px - R > W || py + R < 0 || py - R > H) return;
    if (this.culledByClip(px, py, R, o)) return;
    const tr = (o.rot ?? 0) + (o.screen ? 0 : this.cam.rot);
    const g = o.gain ?? 1, hz = this.hazeOf(o), l = this.look;
    let c = lin(col);
    if (hz > 0) c = mixc(c, l.haze, hz);
    const b = this.markBatch(), D = b.data, i = b.next();
    D[i] = px; D[i + 1] = py; D[i + 2] = Math.max(0.01, sx); D[i + 3] = Math.max(0.01, sy);
    D[i + 4] = Math.cos(tr); D[i + 5] = Math.sin(tr);
    const lit = o.lit ?? 0;
    D[i + 6] = kind; D[i + 7] = param * (kind === MK.rect || kind === MK.ring ? s : 1); D[i + 8] = (o.feather ?? 0) * s; D[i + 9] = lit;
    D[i + 10] = c[0] * g; D[i + 11] = c[1] * g; D[i + 12] = c[2] * g; D[i + 13] = alpha;
    let sh: RGB = ONE;
    if (lit > 0) { sh = o.shade !== undefined ? lin(o.shade) : mixc(c, l.shadow, 0.45); if (hz > 0 && o.shade !== undefined) sh = mixc(sh, l.haze, hz); }
    D[i + 14] = sh[0] * g; D[i + 15] = sh[1] * g; D[i + 16] = sh[2] * g; D[i + 17] = o.add ?? defAdd;
    const rk = lit > 0 ? (o.rim ?? 1) * l.rimK : 0;
    D[i + 18] = l.rim[0] * rk; D[i + 19] = l.rim[1] * rk; D[i + 20] = l.rim[2] * rk; D[i + 21] = 0;
    const cl = this.clipOf(o);
    D[i + 22] = cl[0]; D[i + 23] = cl[1]; D[i + 24] = cl[2]; D[i + 25] = cl[3];
  }
  /** A disc (radius r) or, with ry, an ellipse. */
  disc(x: number, y: number, r: number, col: Col, o: MarkOpts & { ry?: number } = {}) { this.mark(MK.ellipse, x, y, r, o.ry ?? r, 0, col, o); }
  /** A rectangle centred on (x, y), corner radius `r` (world px; min(w,h)/2 makes a capsule). */
  rect(x: number, y: number, w: number, h: number, col: Col, o: MarkOpts & { r?: number } = {}) { this.mark(MK.rect, x, y, w / 2, h / 2, o.r ?? 0, col, o); }
  /** A capsule from a to b, radius r (limbs, pills, rounded bars). */
  capsule(ax: number, ay: number, bx: number, by: number, r: number, col: Col, o: MarkOpts = {}) {
    const len = Math.hypot(bx - ax, by - ay);
    this.mark(MK.rect, (ax + bx) / 2, (ay + by) / 2, len / 2 + r, r, r, col, { ...o, rot: Math.atan2(by - ay, bx - ax) + (o.rot ?? 0) });
  }
  /** A ring (an ellipse's outline) of thickness `th` (world px) inside radius r. */
  ring(x: number, y: number, r: number, th: number, col: Col, o: MarkOpts & { ry?: number } = {}) { this.mark(MK.ring, x, y, r, o.ry ?? r, th, col, o); }
  /** Soft light (added by default): a gaussian disc of radius r, `gain` > 1 to bloom; k sharpens (default 4). */
  glow(x: number, y: number, r: number, col: Col, o: MarkOpts & { ry?: number; k?: number } = {}) { this.mark(MK.glow, x, y, r, o.ry ?? r, o.k ?? 4, col, o, 1); }
  /** A four-pointed sparkle (the brightest stars, a glint). */
  sparkle(x: number, y: number, r: number, col: Col, o: MarkOpts = {}) { this.mark(MK.sparkle, x, y, r, r, 0, col, o, 1); }
  /** An isosceles triangle, apex up before `rot`, w wide and h tall, centred. */
  tri(x: number, y: number, w: number, h: number, col: Col, o: MarkOpts = {}) { this.mark(MK.tri, x, y, w / 2, h / 2, 0, col, o); }
  /** A cone of light from an apex at (x, y) toward angle `dir` (radians, 0 = right, π/2 = down), `len` long and
   * `spread` wide at its end, `apex` (0..1 of spread) wide at the apex: a search beam, a lamp's cone. Added. */
  beam(x: number, y: number, dir: number, len: number, spread: number, col: Col, o: MarkOpts & { apex?: number } = {}) {
    const cx = x + Math.cos(dir) * len / 2, cy = y + Math.sin(dir) * len / 2;
    this.mark(MK.beam, cx, cy, spread / 2, len / 2, o.apex ?? 0.08, col, { ...o, rot: dir - Math.PI / 2 + (o.rot ?? 0) }, 1);
  }
  /**
   * Puffs that merge into one stylized cloud (smoke, steam, clouds): every puff's shade disc first, then every lit
   * disc shifted toward the key light and a little smaller, so the set reads as one opaque, two-tone body with no
   * seams inside. A puff fades by shrinking (r → 0); `alpha` applies to each disc (keep it 1 while puffs overlap).
   */
  puffs(list: readonly { x: number; y: number; r: number }[], lit: Col, shade: Col, o: MarkOpts & { k?: number; hi?: Col } = {}) {
    const k = o.k ?? 0.2, L = this.look.L, base: MarkOpts = { depth: o.depth, haze: o.haze, alpha: o.alpha, screen: o.screen, clip: o.clip, gain: o.gain };
    for (const p of list) if (p.r > 0.3) this.disc(p.x, p.y, p.r, shade, { ...base, feather: o.feather ?? p.r * 0.03 });
    for (const p of list) if (p.r > 0.3) this.disc(p.x + L[0] * p.r * k, p.y + L[1] * p.r * k, p.r * (1 - k * 0.85), lit, { ...base, feather: o.feather ?? p.r * 0.03 });
    if (o.hi) for (const p of list) if (p.r > 6) this.disc(p.x + L[0] * p.r * 0.42, p.y + L[1] * p.r * 0.42, p.r * 0.3, o.hi, { ...base, alpha: (o.alpha ?? 1) * 0.6, feather: p.r * 0.1 });
  }
  /** A soft contact shadow on the ground under something (ellipse w × h, centred at its foot). */
  contact(x: number, y: number, w: number, h: number, o: MarkOpts = {}) {
    this.mark(MK.glow, x, y, w / 2, h / 2, 2.6, this.look.shadow, { alpha: 0.5, ...o, add: 0 });
  }

  // ---- lines (ribbons) --------------------------------------------------------------------------------------
  /** A polyline of width `width` (world px at its depth): round caps, mitred joins, AA; feather for soft glows. */
  line(pts: readonly P[], width: number, col: Col, o: LineOpts = {}) {
    const alpha = o.alpha ?? 1;
    if (alpha <= 0 || pts.length < 2) return;
    const d0 = o.depth ?? 1, X: number[] = [], Y: number[] = [], S: number[] = [], AL: number[] = [], HZ: number[] = [];
    const l = this.look, hz0 = this.hazeOf(o), perHaze = o.haze === undefined && !o.screen;
    for (const p of pts) {
      const arr = Array.isArray(p), x = arr ? (p as number[])[0]! : (p as { x: number }).x, y = arr ? (p as number[])[1]! : (p as { y: number }).y;
      const d = arr ? ((p as number[])[2] ?? d0) : ((p as { d?: number }).d ?? d0);
      const q = this.proj(x, y, d, o.screen);
      const n = X.length;
      if (n && Math.abs(q[0] - X[n - 1]!) < 0.01 && Math.abs(q[1] - Y[n - 1]!) < 0.01) continue;
      X.push(q[0]); Y.push(q[1]); S.push((o.px ? 1 : q[2]) * (arr ? 1 : ((p as { w?: number }).w ?? 1)));
      AL.push(arr ? 1 : ((p as { a?: number }).a ?? 1));
      HZ.push(perHaze && d !== d0 ? this.hazeOf({ depth: d }) : hz0);
    }
    const fea = o.feather ?? 0;
    if ((o.fillet ?? true) && X.length > 2) filletSharp(X, Y, S, AL, HZ, width / 2, fea);
    const closed = !!o.closed && X.length > 2;
    if (closed) { X.push(X[0]!); Y.push(Y[0]!); S.push(S[0]!); AL.push(AL[0]!); HZ.push(HZ[0]!); }
    const n = X.length;
    if (n < 2) return;
    const b = this.ribbonBatch(n * 2), D = b.data;
    const g = o.gain ?? 1, c0 = lin(col);
    const add = o.add ?? 0, dash = o.dash ?? [0, 0], cl = this.clipOf(o);
    // arc length in screen px
    const A: number[] = [0];
    for (let i = 1; i < n; i++) A.push(A[i - 1]! + Math.hypot(X[i]! - X[i - 1]!, Y[i]! - Y[i - 1]!));
    const len = A[n - 1]!;
    const base = b.nv;
    for (let i = 0; i < n; i++) {
      // tangent and miter
      let tx0 = 0, ty0 = 0, tx1 = 0, ty1 = 0;
      const ip = closed && i === 0 ? n - 2 : i - 1, inx = closed && i === n - 1 ? 1 : i + 1;
      if (ip >= 0) { const dx = X[i]! - X[ip]!, dy = Y[i]! - Y[ip]!, m = Math.hypot(dx, dy) || 1; tx0 = dx / m; ty0 = dy / m; }
      if (inx < n) { const dx = X[inx]! - X[i]!, dy = Y[inx]! - Y[i]!, m = Math.hypot(dx, dy) || 1; tx1 = dx / m; ty1 = dy / m; }
      if (ip < 0) { tx0 = tx1; ty0 = ty1; }
      if (inx >= n) { tx1 = tx0; ty1 = ty0; }
      let tx = tx0 + tx1, ty = ty0 + ty1; const tm = Math.hypot(tx, ty);
      if (tm < 1e-6) { tx = tx1; ty = ty1; } else { tx /= tm; ty /= tm; }
      const nx = -ty, ny = tx, cosh = Math.max(0.4, nx * -ty1 + ny * tx1);
      const hw = (width / 2) * S[i]!, fe = fea * S[i]!, ext = hw + fe + 1.5, mit = ext / cosh;
      let px = X[i]!, py = Y[i]!, along = A[i]!;
      if (!closed && i === 0) { px -= tx * ext; py -= ty * ext; along = -ext; }
      if (!closed && i === n - 1) { px += tx * ext; py += ty * ext; along = len + ext; }
      const hz = HZ[i]!, c = hz > 0 ? mixc(c0, l.haze, hz) : c0, ai = alpha * AL[i]!;
      for (const side of [-1, 1]) {
        const j = b.nv++ * RIB_STRIDE;
        D[j] = px + nx * mit * side; D[j + 1] = py + ny * mit * side;
        D[j + 2] = ext * side; D[j + 3] = along; D[j + 4] = closed ? 1e9 : len; D[j + 5] = hw; D[j + 6] = fe;
        D[j + 7] = c[0] * g; D[j + 8] = c[1] * g; D[j + 9] = c[2] * g; D[j + 10] = ai; D[j + 11] = add;
        D[j + 12] = dash[0]; D[j + 13] = dash[1];
        D[j + 14] = cl[0]; D[j + 15] = cl[1]; D[j + 16] = cl[2]; D[j + 17] = cl[3];
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2;
      b.idx[b.ni++] = a; b.idx[b.ni++] = a + 1; b.idx[b.ni++] = a + 2;
      b.idx[b.ni++] = a + 1; b.idx[b.ni++] = a + 3; b.idx[b.ni++] = a + 2;
    }
  }
  /**
   * The thread: a luminous line drawn along `path` up to arc length `s1` (world px), with a soft halo, a glowing
   * head while it draws, its colour by role (verify red, link cyan, route gold, path warm white).
   */
  thread(path: Path, s1: number, o: ThreadOpts = {}) {
    const s0 = o.s0 ?? 0, pts = path.slice(s0, s1);
    if (pts.length < 2) return;
    const col = o.color !== undefined ? lin(o.color) : threadColor(o.role ?? 'route', o.ink), w = o.width ?? 4, glow = o.glow ?? 1, g = o.gain ?? 1.6;
    const base: DrawOpts = { depth: o.depth, haze: o.haze, alpha: o.alpha, screen: o.screen, clip: o.clip }, px = !!o.px;
    if (!o.ink && glow > 0) {
      this.line(pts, w * 6, gainc(col, 0.22 * glow), { ...base, px, feather: w * 3, add: 1 });
      this.line(pts, w * 2.2, gainc(col, 0.45 * glow), { ...base, px, feather: w * 0.9, add: 1 });
    }
    this.line(pts, w, o.ink ? col : gainc(col, g), { ...base, px, add: o.ink ? 0 : 0.5 });
    if ((o.head ?? true) && s1 < path.len - 0.5 && !o.ink) {
      const p = path.at(s1), q = this.project(p.x, p.y, o.depth ?? 1), k = px ? 1 / Math.max(q.s, 1e-4) : 1;
      this.glow(p.x, p.y, w * 9 * k, col, { ...base, gain: 1.3 * glow });
      this.disc(p.x, p.y, w * 1.05 * k, gainc(col, 2.6), { ...base, add: 0.7 });
    }
  }

  // ---- shader quads -------------------------------------------------------------------------------------------
  /** The sky (opaque: it also clears). Colours default to the look's sky; positions are screen px. */
  sky(o: SkyOpts = {}) {
    this.flush();
    const p = POOLS.sky ?? (POOLS.sky = skyPass()), u = p.u, l = this.look;
    const set3 = (k: string, c: RGB) => (u[k]!.value as THREE.Vector3).set(c[0], c[1], c[2]);
    set3('top', lin(o.top ?? l.skyTop)); set3('bot', lin(o.bottom ?? l.skyBottom));
    const y0 = o.yTop ?? 0, y1 = o.yBottom ?? H;
    u.yTop!.value = y0; u.invSpan!.value = 1 / Math.max(1, y1 - y0);
    if (o.horizon) {
      set3('hor', lin(o.horizon.color ?? l.horizon)); u.horY!.value = o.horizon.y; u.horInvW!.value = 1 / Math.max(1, o.horizon.width ?? 160); u.horK!.value = o.horizon.k ?? 0.6;
    } else u.horK!.value = 0;
    if (o.sun) {
      set3('sunCol', lin(o.sun.color ?? l.keyc)); (u.sun!.value as THREE.Vector2).set(o.sun.x, o.sun.y); u.sunInvR!.value = 1 / Math.max(1, o.sun.r); u.sunK!.value = o.sun.k ?? 1;
    } else u.sunK!.value = 0;
    if (o.nebula && o.nebula.k > 0) {
      set3('neb1', lin(o.nebula.c1 ?? l.accents[1]!)); set3('neb2', lin(o.nebula.c2 ?? l.accents[2]!));
      u.nebK!.value = o.nebula.k; u.nebScale!.value = o.nebula.scale ?? 0.0016; u.nebSeed!.value = o.nebula.seed ?? 0;
      (u.nebOff!.value as THREE.Vector2).set(o.nebula.offset?.[0] ?? 0, o.nebula.offset?.[1] ?? 0);
    } else u.nebK!.value = 0;
    p.place(W / 2, H / 2, [W / 2, 0], [0, H / 2]);
    p.render(this.renderer, this.out);
  }
  /** A planet of radius r at world (x, y): shaded sphere, atmosphere, optional rings. */
  planet(x: number, y: number, r: number, o: PlanetOpts = {}) {
    if ((o.alpha ?? 1) <= 0) return;
    this.flush();
    const p = POOLS.planet ?? (POOLS.planet = planetPass()), u = p.u, l = this.look;
    const [px, py, s] = this.proj(x, y, o.depth ?? 1, o.screen);
    const R = r * s, atm = o.atm ?? 0.08, ext = R * Math.max(1 + atm * 5, o.ring ? o.ring.outer * 1.05 : 0);
    if (px + ext < 0 || px - ext > W || py + ext < 0 || py - ext > H) return;
    const set3 = (k: string, c: RGB) => (u[k]!.value as THREE.Vector3).set(c[0], c[1], c[2]);
    (u.pc!.value as THREE.Vector2).set(px, py); u.invR!.value = 1 / R; u.r!.value = R;
    const soft = Math.max(1e-3, o.soft ?? 0.14);
    u.atm!.value = atm; u.invAtm!.value = 1 / Math.max(atm, 1e-4); u.soft!.value = soft; u.invSoft2!.value = 1 / (2 * soft);
    u.invAA!.value = R * SCALE; u.invAAr!.value = (R * SCALE) / 3; // one physical px (and 1.5 for the rings' two edges)
    u.bandK!.value = o.bands ?? 0.3; u.craterK!.value = o.craters ?? 0; u.seed!.value = o.seed ?? 0;
    u.rimFloor!.value = o.rimFloor ?? 0.03; u.glowFloor!.value = o.glowFloor ?? 0.05;
    let L3 = o.light ? [...o.light] : [...l.L3];
    if (!o.light) { const rc = this.k0.rc, rs = this.k0.rs; L3 = [L3[0]! * rc - L3[1]! * rs, L3[0]! * rs + L3[1]! * rc, L3[2]!]; }
    const m3 = Math.hypot(L3[0]!, L3[1]!, L3[2]!) || 1;
    set3('L3', [L3[0]! / m3, L3[1]! / m3, L3[2]! / m3]);
    const lm = Math.hypot(L3[0]!, L3[1]!);
    (u.Lxy!.value as THREE.Vector2).set(lm > 1e-4 ? L3[0]! / lm : 0, lm > 1e-4 ? L3[1]! / lm : -1);
    const hz = this.hazeOf(o), hzc = (c: RGB) => (hz > 0 ? mixc(c, l.haze, hz) : c);
    set3('cDay', hzc(lin(o.day ?? l.ground))); set3('cDay2', hzc(lin(o.day2 ?? o.day ?? l.fill))); set3('cNight', hzc(lin(o.night ?? l.shadow)));
    set3('cAtm', lin(o.atmosphere ?? l.horizon)); set3('cWarm', lin(o.warm ?? l.keyc));
    u.alpha!.value = o.alpha ?? 1; u.rimK!.value = o.rimK ?? 1; u.glowK!.value = o.glowK ?? 1;
    const sf = o.surface;
    if (sf) {
      const mt = l.mat, cs = sf.cityScale ?? 60;
      u.surfK!.value = 1; u.landLevel!.value = sf.level ?? 0.05; u.surfScale!.value = sf.scale ?? 1.6;
      u.cloudK!.value = sf.clouds ?? 0.8; u.cloudScale!.value = sf.cloudScale ?? 2.2;
      u.cityK!.value = sf.cities ?? 0; u.cityScale!.value = cs; u.pxCell!.value = R / cs; // logical px per lattice cell
      set3('cLand', hzc(lin(sf.land ?? mt.land))); set3('cLand2', hzc(lin(sf.land2 ?? mt.foliageDeep))); set3('cOcean', hzc(lin(sf.ocean ?? mt.water)));
      set3('cCloud', hzc(lin(sf.cloud ?? mt.cloud))); set3('cCloudSh', hzc(lin(sf.cloudShade ?? mt.cloudShade))); set3('cCity', lin(sf.city ?? mt.city));
      const hp = sf.hot ?? [0, 0, 1]; set3('hotDir', [hp[0], hp[1], hp[2]]); u.hotK!.value = sf.hotK ?? 0; u.hotR2inv!.value = 1 / Math.max(1e-4, (sf.hotR ?? 0.05) ** 2);
      u.glintK!.value = sf.glint ?? 1;
      const fs = sf.fields ?? 0, cellPx = fs > 0 ? R / fs : 0;
      u.fieldK!.value = fs > 0 ? smootherstep(30, 110, cellPx) : 0; u.fieldScale!.value = fs || 1; u.roadW!.value = cellPx > 0 ? Math.min(0.08, 1.3 / cellPx) : 0;
      const rw = (0.012 * R) / 38; // the river's width in px at this size
      u.riverK!.value = (sf.river ?? 0) * smootherstep(0.6, 2.2, rw); u.riverW!.value = 0.012;
      u.hotLand!.value = sf.hotLand ?? 0; u.speckK!.value = sf.specks ?? 0;
      set3('cField', hzc(lin(sf.field ?? l.accents[3]!))); set3('cRoad', hzc(lin(sf.road ?? mt.street))); set3('cSpeck', hzc(lin(sf.speck ?? mt.wall)));
      // the half vector between the light and the viewer (0, 0, 1), from the CPU
      const hx = L3[0]! / m3, hy = L3[1]! / m3, hz2 = L3[2]! / m3 + 1, hm = Math.hypot(hx, hy, hz2) || 1;
      set3('glintH', [hx / hm, hy / hm, hz2 / hm]);
      (u.rotM!.value as THREE.Matrix3).copy(planetFrame(sf.spin ?? 0, sf.tilt ?? 0.35, sf.roll ?? 0));
    } else u.surfK!.value = 0;
    if (o.ring) {
      u.ringIn!.value = o.ring.inner; u.ringOut!.value = o.ring.outer; u.ringInvTilt!.value = 1 / Math.max(0.02, o.ring.tilt); u.ringK!.value = o.ring.k ?? 0.8;
      const a = (o.ring.angle ?? 0) + this.cam.rot; (u.ringCS!.value as THREE.Vector2).set(Math.cos(a), Math.sin(a));
      set3('cRing', lin(o.ring.color ?? l.paper));
    } else u.ringK!.value = 0;
    p.place(px, py, [ext, 0], [0, ext]);
    p.render(this.renderer, this.out);
  }
  /** A filled polygon (world points, up to 64; more are resampled by the caller), crisp, optionally lit. */
  poly(pts: readonly P[], col: Col, o: MarkOpts = {}) {
    if ((o.alpha ?? 1) <= 0 || pts.length < 3) return;
    if (pts.length > MAX_POLY) throw new Error(`st.poly: ${pts.length} points (max ${MAX_POLY}; resample() first)`);
    this.flush();
    const p = POOLS.poly ?? (POOLS.poly = polyPass()), u = p.u, l = this.look;
    const arr = u.pts!.value as THREE.Vector2[];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, sMax = 0;
    pts.forEach((q, i) => {
      const x = Array.isArray(q) ? (q as number[])[0]! : (q as { x: number }).x, y = Array.isArray(q) ? (q as number[])[1]! : (q as { y: number }).y;
      const r = this.proj(x, y, o.depth ?? 1, o.screen);
      arr[i]!.set(r[0], r[1]);
      x0 = Math.min(x0, r[0]); y0 = Math.min(y0, r[1]); x1 = Math.max(x1, r[0]); y1 = Math.max(y1, r[1]); sMax = Math.max(sMax, r[2]);
    });
    if (x1 < 0 || x0 > W || y1 < 0 || y0 > H) return;
    u.n!.value = pts.length;
    const hz = this.hazeOf(o), g = o.gain ?? 1;
    let c = lin(col); if (hz > 0) c = mixc(c, l.haze, hz);
    const sh = o.shade !== undefined ? lin(o.shade) : mixc(c, l.shadow, 0.45);
    (u.col!.value as THREE.Vector3).set(c[0] * g, c[1] * g, c[2] * g);
    (u.col2!.value as THREE.Vector3).set(sh[0] * g, sh[1] * g, sh[2] * g);
    const rk = (o.rim ?? 1) * l.rimK;
    (u.rimC!.value as THREE.Vector3).set(l.rim[0] * rk, l.rim[1] * rk, l.rim[2] * rk);
    u.lit!.value = o.lit ?? 0; u.invEdge!.value = 1 / (1 / SCALE + (o.feather ?? 0) * sMax); u.alpha!.value = o.alpha ?? 1; u.add!.value = o.add ?? 0;
    u.rimW!.value = Math.max(1.5, 0.06 * Math.min(x1 - x0, y1 - y0));
    (u.L!.value as THREE.Vector2).set(this.k0.Lx, this.k0.Ly);
    (u.cen!.value as THREE.Vector2).set((x0 + x1) / 2, (y0 + y1) / 2);
    (u.invHalf!.value as THREE.Vector2).set(2 / Math.max(1, x1 - x0), 2 / Math.max(1, y1 - y0));
    const cl = this.clipOf(o); (u.clip!.value as THREE.Vector4).set(cl[0], cl[1], cl[2], cl[3]);
    const m = 2 + (o.feather ?? 0) * sMax;
    p.place((x0 + x1) / 2, (y0 + y1) / 2, [(x1 - x0) / 2 + m, 0], [0, (y1 - y0) / 2 + m]);
    p.render(this.renderer, this.out);
  }
  /**
   * The previous scene's frame (f.under, in a scene with handlesTransition = true) through a mask, over what this
   * scene has drawn so far: `circle` (screen px) keeps it outside the circle (an iris opening from an object; inside
   * with keep 'inside'); `wipe` keeps it ahead of an edge through (x, y) with normal (nx, ny).
   */
  under(tex: THREE.Texture | null, m: { circle?: { x: number; y: number; r: number }; wipe?: { x: number; y: number; nx: number; ny: number }; feather?: number; keep?: 'outside' | 'inside' }) {
    if (!tex) return;
    this.flush();
    const p = POOLS.under ?? (POOLS.under = underPass()), u = p.u;
    u.under!.value = tex;
    if (m.circle) { (u.m!.value as THREE.Vector4).set(m.circle.x, m.circle.y, m.circle.r, 0); u.kind!.value = 0; }
    else if (m.wipe) { (u.m!.value as THREE.Vector4).set(m.wipe.x, m.wipe.y, 0, 0); const k = Math.hypot(m.wipe.nx, m.wipe.ny) || 1; (u.nrm!.value as THREE.Vector2).set(m.wipe.nx / k, m.wipe.ny / k); u.kind!.value = 1; }
    u.inside!.value = m.keep === 'inside' ? 1 : 0; u.feather!.value = Math.max(0.5, m.feather ?? 2);
    u.invW!.value = 1 / W; u.invHh!.value = 1 / H;
    p.place(W / 2, H / 2, [W / 2, 0], [0, H / 2]);
    p.render(this.renderer, this.out);
  }

}

/** The rotation from the view's frame (x right, y down, z toward you) to a planet's own: its turn about its axis
 * (spin), the axis's tilt toward the viewer, a roll in the picture plane. */
export function planetFrame(spin: number, tilt: number, roll: number): THREE.Matrix3 {
  const cr = Math.cos(roll), sr = Math.sin(roll), ct = Math.cos(tilt), st = Math.sin(tilt), cs = Math.cos(spin), ss = Math.sin(spin);
  const Rr = new THREE.Matrix3().set(cr, sr, 0, -sr, cr, 0, 0, 0, 1);
  const Rt = new THREE.Matrix3().set(1, 0, 0, 0, ct, -st, 0, st, ct);
  const Rs = new THREE.Matrix3().set(cs, 0, ss, 0, 1, 0, -ss, 0, cs);
  return Rs.multiply(Rt).multiply(Rr);
}
/** A point on a planet's visible face (u, v in −1..1 across its disc, as seen) in the planet's own frame: where a
 * surface's `hot` cluster goes so it shows there, for the same spin, tilt and roll. */
export function surfacePoint(u: number, v: number, spin: number, tilt = 0.35, roll = 0): [number, number, number] {
  const z = Math.sqrt(Math.max(0, 1 - u * u - v * v));
  const p = new THREE.Vector3(u, v, z).applyMatrix3(planetFrame(spin, tilt, roll));
  return [p.x, p.y, p.z];
}

/**
 * Round the sharp corners of a projected polyline in place (turns past ~100°): a fillet as wide as the line's
 * extent, so a glowing or wide ribbon doesn't fold its inner side into a wedge. Arrays are screen px.
 */
function filletSharp(X: number[], Y: number[], S: number[], A: number[], Z: number[], hw: number, fe: number) {
  for (let i = X.length - 2; i >= 1; i--) {
    const ax = X[i]! - X[i - 1]!, ay = Y[i]! - Y[i - 1]!, bx = X[i + 1]! - X[i]!, by = Y[i + 1]! - Y[i]!;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < 1e-3 || lb < 1e-3) continue;
    const cosT = (ax * bx + ay * by) / (la * lb);
    if (cosT > -0.17) continue; // gentler than ~100°: the miter holds
    const phi = Math.max(0.05, Math.PI - Math.acos(Math.max(-1, Math.min(1, cosT)))); // the corner's own angle
    const ext = (hw + fe) * S[i]! + 1.5;
    const td = Math.min(ext / Math.tan(phi / 2), 0.48 * la, 0.48 * lb), rf = td * Math.tan(phi / 2);
    const ux = ax / la, uy = ay / la, vx = bx / lb, vy = by / lb;
    const p0x = X[i]! - ux * td, p0y = Y[i]! - uy * td, p1x = X[i]! + vx * td, p1y = Y[i]! + vy * td;
    // the fillet's centre: from p0 along the normal toward the turn
    const turn = Math.sign(ux * vy - uy * vx) || 1, nx = -uy * turn, ny = ux * turn;
    const cx = p0x + nx * rf, cy = p0y + ny * rf;
    const a0 = Math.atan2(p0y - cy, p0x - cx), a1 = Math.atan2(p1y - cy, p1x - cx);
    let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    const k = Math.max(3, Math.ceil(Math.abs(da) / 0.2));
    const nX: number[] = [], nY: number[] = [];
    for (let j = 0; j <= k; j++) { const a = a0 + (da * j) / k; nX.push(cx + Math.cos(a) * rf); nY.push(cy + Math.sin(a) * rf); }
    const s0 = S[i]!, a0v = A[i]!, z0 = Z[i]!;
    X.splice(i, 1, ...nX); Y.splice(i, 1, ...nY);
    S.splice(i, 1, ...nX.map(() => s0)); A.splice(i, 1, ...nX.map(() => a0v)); Z.splice(i, 1, ...nX.map(() => z0));
  }
}

