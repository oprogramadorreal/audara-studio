// The world camera and the transitions (part of the Nutlight kit: scenes import from './index'). No hard cuts: every
// boundary is planned in both scenes.
//
// ONE WORLD, ONE CAMERA. Give every location of the video a place in world px and its named framings as Cams in that
// world (a project module of its own: `export const SHOT = { wide: cam(960, 540, 1), desk: cam(720, 650, 2) }`), so
// two scenes that meet on the same shot and draw the same modules agree by construction: the outgoing scene
// ends its move on SHOT.x, the incoming one starts on it (camKeys([[start, SHOT.x], …])) and nothing needs compositing
// at all — the cut is invisible. When the two scenes don't share a place, the incoming scene (handlesTransition =
// true) draws itself, then calls worldUnder(st, f, {…}) LAST to lay the outgoing frame (f.under) over it through a
// mask that a thing in the picture motivates, and the mask is derived from THAT THING (an anchor: camProject of a
// world rect under the outgoing scene's camera — never typed screen pixels):
//   iris     a circle opening from a point (a lit window, the moon, a lamp, a node of light)
//   rect     a window or a screen growing to the frame
//   through  a MATCHED zoom-through: the outgoing frame pushes into an object (a rack drawer, a monitor) while the
//            opening grows from that object's own rect into the frame, AND the incoming scene is drawn inside it at the
//            opening's scale (throughAt → st.withMagnify), so inside and outside move as one: kind 'through', rect
//   wipe     an edge crossing the frame that a passing silhouette covers (a tree as the camera travels the street):
//            both scenes run the SAME camera move meanwhile (handoff), so the two halves move as one
//   zoom     the outgoing frame keeps pushing into a point, which can travel (tx, ty) to where the same thing stands
//            in the incoming scene (a node of the network → the globe's node): add zoom: { x, y, to, tx, ty }
//   fade     a plain crossfade, only where nothing better carries it
// Everything is a pure function of f.tin (0 → 1 over the overlap, eased inside).
import * as THREE from 'three';
import { W, H } from '../engine/gl';
import type { Frame } from '../engine/scene';
import { QuadPass } from './stage-gl';
import { cam, camKeys, camLerp, type Cam } from './motion';
import type { Stage } from './stage';
import { clamp, ease, lerp, smootherstep } from '../engine/util';

/** A move between two shots (k 0..1, eased inside with smootherstep). */
export const shotMove = (a: Cam, b: Cam, k: number) => camLerp(a, b, smootherstep(0, 1, k));
export { cam, camKeys, camLerp };

/** A world point at depth d → screen px under camera c (the Stage's own projection, without it: for anchors that
 * one scene computes for another's camera). */
export function camProject(c: Cam, x: number, y: number, d = 1): { x: number; y: number; s: number } {
  const k = d === Infinity ? 0 : 1 / Math.max(d, 0.02), b = c.back ?? 0, z = Math.pow(c.zoom, k);
  const s = b === 0 || d === Infinity ? z : z * (Math.max(d, 0.02) / Math.max(1e-3, Math.max(d, 0.02) + b));
  const dx = (x - (W / 2 + (c.x - W / 2) * k)) * s, dy = (y - (H / 2 + (c.y - H / 2) * k)) * s, rc = Math.cos(c.rot), rs = Math.sin(c.rot);
  return { x: W / 2 + dx * rc - dy * rs, y: H / 2 + dx * rs + dy * rc, s };
}
/** A world rect at depth d → its screen rect under camera c (the anchor a transition opens from). */
export function camRect(c: Cam, r: { x: number; y: number; w: number; h: number }, d = 1): Rect {
  const P = [camProject(c, r.x, r.y, d), camProject(c, r.x + r.w, r.y, d), camProject(c, r.x, r.y + r.h, d), camProject(c, r.x + r.w, r.y + r.h, d)];
  const x0 = Math.min(...P.map((p) => p.x)), y0 = Math.min(...P.map((p) => p.y));
  return { x: x0, y: y0, w: Math.max(...P.map((p) => p.x)) - x0, h: Math.max(...P.map((p) => p.y)) - y0 };
}
/**
 * One camera across a wipe: the outgoing and the incoming scene apply the SAME move (dx world px of travel, a zoom
 * from z0 to 1) over the overlap, each around its own end / start camera, so both halves move as one. u: the overlap's
 * progress (the outgoing scene's f.tout, the incoming one's f.tin). `side`: 'out' gives the offset from where the
 * outgoing camera was when the overlap began, 'in' the offset back from where the incoming one arrives.
 */
export function handoff(base: Cam, u: number, side: 'out' | 'in', o: { dx: number; z0?: number; dy?: number }): Cam {
  const k = smootherstep(0, 1, clamp(u)), z0 = o.z0 ?? base.zoom, dy = o.dy ?? 0;
  if (side === 'out') return { ...base, x: base.x + o.dx * k, y: base.y + dy * k, zoom: Math.exp(lerp(Math.log(z0), 0, k)) };
  return { ...base, x: base.x - o.dx * (1 - k), y: base.y - dy * (1 - k), zoom: Math.exp(lerp(Math.log(z0), Math.log(base.zoom), k)) };
}

// ------------------------------------------------------------------------------------------------------------
// Compositing the outgoing frame
// ------------------------------------------------------------------------------------------------------------
let PASS: QuadPass | null = null;
function underPass() {
  return (PASS ??= new QuadPass(/* glsl */ `
    in vec2 vPx; in vec2 vQ;
    uniform sampler2D under; uniform vec4 m; uniform vec2 zc; uniform vec2 zt; uniform float kind, inside, invW, invHh, feather, rr, invZ, alphaAll, ringK;
    uniform vec3 ringC;
    out vec4 fragColor;
    void main() {
      vec2 p = zc + (vPx - zt) * invZ;
      vec4 c = texture(under, vec2(p.x * invW, 1.0 - p.y * invHh));
      float d;
      if (kind < 0.5) d = distance(vPx, m.xy) - m.z;
      else if (kind < 1.5) { vec2 q = abs(vPx - m.xy) - m.zw + rr; d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rr; }
      else if (kind < 2.5) d = dot(vPx - m.xy, m.zw);
      else d = 1.0e5;
      float k = smoothstep(-feather, feather, d);
      if (inside > 0.5) k = 1.0 - k;
      k *= alphaAll;
      // a thin glow on the edge (light spilling through the opening)
      float ring = ringK * exp(-abs(d) / max(feather * 2.0, 1.0));
      fragColor = vec4(c.rgb * k + ringC * ring, k);
    }`, {
    under: { value: null }, m: { value: new THREE.Vector4() }, zc: { value: new THREE.Vector2(W / 2, H / 2) }, zt: { value: new THREE.Vector2(W / 2, H / 2) },
    kind: { value: 0 }, inside: { value: 0 },
    invW: { value: 1 / W }, invHh: { value: 1 / H }, feather: { value: 2 }, rr: { value: 0 }, invZ: { value: 1 }, alphaAll: { value: 1 },
    ringK: { value: 0 }, ringC: { value: new THREE.Vector3() },
  }));
}

export interface Rect { x: number; y: number; w: number; h: number }
export type UnderOpts =
  | ({ kind: 'iris'; x: number; y: number; from: number; to?: number } & UnderCommon)
  | ({ kind: 'rect'; rect: Rect; to?: Rect; radius?: number } & UnderCommon)
  | ({ kind: 'through'; rect: Rect; radius?: number } & UnderCommon)
  | ({ kind: 'wipe'; angle?: number; /** how far past the frame the edge starts and ends (the silhouette's half-width) */ margin?: number } & UnderCommon)
  | ({ kind: 'fade' } & UnderCommon);
interface UnderCommon {
  /** the outgoing frame pushes into a point meanwhile (zoom-through): its scale reaches `to` at tin 1; that point
   * travels to (tx, ty) meanwhile (default: it stays) */
  zoom?: { x: number; y: number; to: number; tx?: number; ty?: number };
  /** soft edge (screen px; default 3) */
  feather?: number;
  /** progress shaping: the part of the overlap the opening takes (default [0, 1]) */
  span?: [number, number];
  /** a glow on the opening's edge (linear colour × strength) */
  ring?: { color: [number, number, number]; k: number };
  /** keep the outgoing frame inside the shape instead (a closing iris: the new scene comes from outside) */
  closing?: boolean;
}
/** The opening's progress at tin (0..1), eased (starts and ends at rest). */
export function openK(tin: number, span: [number, number] = [0, 1]) { return smootherstep(span[0], span[1], tin); }
/** The leading edge of a wipe at tin: a point on it (screen px) and its normal, for drawing the silhouette there. */
export function wipeEdge(tin: number, angle = 0, span: [number, number] = [0, 1], margin = 120): { x: number; y: number; nx: number; ny: number } {
  const k = openK(tin, span), nx = Math.cos(angle), ny = Math.sin(angle);
  const ext = Math.abs(nx) * W / 2 + Math.abs(ny) * H / 2 + margin; // from fully before the frame to fully past it
  const s = lerp(-ext, ext, k);
  return { x: W / 2 + nx * s, y: H / 2 + ny * s, nx, ny };
}
/**
 * A matched zoom-through at tin: the object's screen rect (at tin 0) grows into the frame. Returns the opening (its
 * rect now), the outgoing frame's zoom (scale `z` about the object's centre, which travels to the frame's centre),
 * and the magnifier the INCOMING scene draws itself under so it fills the opening: st.withMagnify(mag.x, mag.y,
 * mag.m, () => { …every draw… }) (mag null once it fills the frame).
 */
export function throughAt(tin: number, rect: Rect, span: [number, number] = [0, 1]) {
  const k = openK(tin, span), cx0 = rect.x + rect.w / 2, cy0 = rect.y + rect.h / 2;
  // the width grows exponentially (an even zoom) from the object's to the frame's; the aspect turns 16:9
  const w = Math.exp(lerp(Math.log(Math.max(4, rect.w)), Math.log(W), k));
  const a = lerp(rect.h / Math.max(1, rect.w), H / W, smootherstep(0, 1, k)), h = w * a;
  const z = w / Math.max(1, rect.w), u = smootherstep(0.05, 1, k);
  const cx = lerp(cx0, W / 2, u), cy = lerp(cy0, H / 2, u);
  const m = w / W;
  const mag = m > 0.999 ? null : { x: (cx - (W / 2) * m) / (1 - m), y: (cy - (H / 2) * m) / (1 - m), m };
  return { k, open: { x: cx - w / 2, y: cy - h / 2, w, h }, z, zc: { x: cx0, y: cy0 }, zt: { x: cx, y: cy }, mag };
}
/**
 * Lay the outgoing frame (f.under) over what the stage has drawn, through a mask (call it LAST in render(), then draw
 * any silhouette that motivates a wipe). Nothing happens outside a transition. Returns the opening's progress.
 */
export function worldUnder(st: Stage, f: Frame, o: UnderOpts): number {
  const tex = f.under;
  if (!tex || f.tin >= 1) return 1;
  st.flush();
  const p = underPass(), u = p.u, k = openK(f.tin, o.span);
  u.under!.value = tex;
  let z = o.zoom ? lerp(1, o.zoom.to, ease.inCubic(k) * 0.6 + k * 0.4) : 1;
  let zc = { x: o.zoom?.x ?? W / 2, y: o.zoom?.y ?? H / 2 }, zt = { x: lerp(zc.x, o.zoom?.tx ?? zc.x, smootherstep(0, 1, k)), y: lerp(zc.y, o.zoom?.ty ?? zc.y, smootherstep(0, 1, k)) };
  u.feather!.value = Math.max(0.5, o.feather ?? 3);
  u.alphaAll!.value = 1;
  u.inside!.value = o.closing ? 1 : 0;
  u.rr!.value = 0;
  const ring = o.ring ? o.ring.k * Math.sin(Math.PI * k) : 0;
  u.ringK!.value = ring; (u.ringC!.value as THREE.Vector3).set(o.ring?.color[0] ?? 0, o.ring?.color[1] ?? 0, o.ring?.color[2] ?? 0);
  if (o.kind === 'iris') {
    const to = o.to ?? Math.hypot(W, H);
    const r = o.closing ? lerp(to, o.from, k) : lerp(o.from, to, ease.inCubic(k) * 0.5 + k * 0.5);
    (u.m!.value as THREE.Vector4).set(lerp(o.x, zt.x, o.zoom?.tx !== undefined ? 1 : 0), lerp(o.y, zt.y, o.zoom?.ty !== undefined ? 1 : 0), r, 0); u.kind!.value = 0;
  } else if (o.kind === 'rect') {
    const a = o.rect, b = o.to ?? { x: -40, y: -40, w: W + 80, h: H + 80 }, kk = ease.inCubic(k) * 0.5 + k * 0.5;
    const x = lerp(a.x, b.x, kk), y = lerp(a.y, b.y, kk), w = lerp(a.w, b.w, kk), h = lerp(a.h, b.h, kk);
    (u.m!.value as THREE.Vector4).set(x + w / 2, y + h / 2, w / 2, h / 2); u.kind!.value = 1; u.rr!.value = Math.min(o.radius ?? 8, w / 2, h / 2);
  } else if (o.kind === 'through') {
    const T = throughAt(f.tin, o.rect, o.span), r = T.open;
    z = T.z; zc = T.zc; zt = T.zt;
    // past the frame's edges by the feather, so the end is clean
    const grow = smootherstep(0.9, 1, T.k) * 8;
    (u.m!.value as THREE.Vector4).set(r.x + r.w / 2, r.y + r.h / 2, r.w / 2 + grow, r.h / 2 + grow); u.kind!.value = 1; u.rr!.value = Math.min(o.radius ?? 6, r.w / 2, r.h / 2) * (1 - T.k);
  } else if (o.kind === 'wipe') {
    const e = wipeEdge(f.tin, o.angle ?? 0, o.span, o.margin);
    // the old frame stays ahead of the edge
    (u.m!.value as THREE.Vector4).set(e.x, e.y, e.nx, e.ny); u.kind!.value = 2;
  } else {
    u.kind!.value = 3; u.alphaAll!.value = 1 - k;
  }
  u.invZ!.value = 1 / z;
  (u.zc!.value as THREE.Vector2).set(zc.x, zc.y);
  (u.zt!.value as THREE.Vector2).set(zt.x, zt.y);
  p.place(W / 2, H / 2, [W / 2, 0], [0, H / 2]);
  p.render((st as unknown as { renderer: THREE.WebGLRenderer }).renderer, st.out);
  return k;
}
/** For the OUTGOING scene: how far into its exit it is (f.tout, eased), to start the move that the next scene picks up. */
export const exitK = (f: Frame, span: [number, number] = [0, 1]) => smootherstep(span[0], span[1], f.tout);
/** Clamp helper re-exported for scenes timing their transitions. */
export { clamp };
