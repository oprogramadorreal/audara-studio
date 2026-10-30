// The illustration kit's GPU layer (lead-owned, part of index.ts; scenes use the Stage, not this file).
// Three instanced batches and a few shader quads, all drawing premultiplied colour over a linear HDR target in
// call order (painter's algorithm):
//   SpriteBatch  textured quads from baked art (atlases): parallax-projected on the CPU, shaded on the GPU with
//                the act's rim light (an alpha test toward the light), haze, tint/gain, soft focus (mip bias),
//                silhouette mode, an optional circle clip
//   MarkBatch    procedural SDF shapes (ellipse, rounded rect / capsule, ring, glow, sparkle, triangle), flat or
//                lit (a terminator toward the act's shadow colour and a rim on the lit edge), any size, crisp at 4K
//   RibbonBatch  polylines as triangle strips: round caps, miter joins, AA or feathered (glows), dashes
//   QuadPass     one-off shaders on a quad: the sky, a planet, a filled polygon (morphable), the previous scene's
//                frame through a mask (transitions)
// Output alpha: a = coverage × (1 − add), so one batch mixes alpha-over (add 0) and pure light (add 1).
import * as THREE from 'three';
import { GLSL_COMMON } from '../engine/glsl/common';
import { W, H, rtScale } from '../engine/gl';

function premultBlend(m: THREE.RawShaderMaterial) {
  m.side = THREE.DoubleSide; // quads are wound for y-down screen px: never cull them
  m.transparent = true;
  m.depthTest = false;
  m.depthWrite = false;
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
}

/** Logical size of a target (the frame for the engine's targets). */
export function targetSize(rt: THREE.WebGLRenderTarget | null): [number, number] {
  const s = rtScale(rt);
  return rt ? [rt.width / s, rt.height / s] : [W, H];
}

const HEAD = /* glsl */ `precision highp float;\nprecision highp int;\n`;
const CLIP_GLSL = /* glsl */ `
float clipMask(vec2 px, vec4 c) {
  if (c.z == 0.0) return 1.0;
  float d = distance(px, c.xy) - abs(c.z);
  float f = max(c.w, 0.5);
  float m = 1.0 - smoothstep(-f, f, d);
  return c.z < 0.0 ? 1.0 - m : m;
}`;

// ------------------------------------------------------------------------------------------------------------
// Instanced batch base
// ------------------------------------------------------------------------------------------------------------
abstract class InstBatch {
  data: Float32Array;
  count = 0;
  protected buf: THREE.InstancedInterleavedBuffer;
  protected geo = new THREE.InstancedBufferGeometry();
  mat: THREE.RawShaderMaterial;
  protected scene = new THREE.Scene();
  protected cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  constructor(public stride: number, public capacity: number, attrs: [string, number][], vert: string, frag: string, uniforms: Record<string, THREE.IUniform>) {
    this.data = new Float32Array(stride * capacity);
    this.buf = new THREE.InstancedInterleavedBuffer(this.data, stride, 1);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    let off = 0;
    for (const [name, size] of attrs) { this.geo.setAttribute(name, new THREE.InterleavedBufferAttribute(this.buf, size, off)); off += size; }
    if (off !== stride) throw new Error(`stage-gl.ts: stride ${stride} != attributes ${off}`);
    this.mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: HEAD + vert, fragmentShader: HEAD + GLSL_COMMON + frag, uniforms });
    premultBlend(this.mat);
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }
  get full() { return this.count >= this.capacity; }
  /** Index of the next instance's first float. */
  next() { return this.count++ * this.stride; }
  flush(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null) {
    if (this.count === 0) return;
    this.buf.clearUpdateRanges();
    this.buf.addUpdateRange(0, this.count * this.stride);
    this.buf.needsUpdate = true;
    this.geo.instanceCount = this.count;
    const [tw, th] = targetSize(target);
    (this.mat.uniforms.invRes!.value as THREE.Vector2).set(1 / tw, 1 / th);
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.cam);
    this.count = 0;
  }
  dispose() { this.geo.dispose(); this.mat.dispose(); }
}

// ------------------------------------------------------------------------------------------------------------
// Sprites
// ------------------------------------------------------------------------------------------------------------
// iC centre (screen px) · iAx, iAy half-extent axes (screen px) · iUV crop (u0 v0 u1 v1) · iCol tint×gain, alpha ·
// iFx haze, add, mip bias, flat · iRim rim tap offset (uv) · iRimC rim colour×strength · iClip circle clip
export const SPRITE_STRIDE = 2 + 2 + 2 + 4 + 4 + 4 + 2 + 3 + 4;
const SPRITE_VERT = /* glsl */ `
in vec3 position;
in vec2 iC; in vec2 iAx; in vec2 iAy; in vec4 iUV; in vec4 iCol; in vec4 iFx; in vec2 iRim; in vec3 iRimC; in vec4 iClip;
uniform vec2 invRes;
out vec2 vUV; out vec2 vPx; out vec4 vCol; out vec4 vFx; out vec2 vRim; out vec3 vRimC; out vec4 vClip; out vec4 vBox;
void main() {
  vec2 q = position.xy;
  vec2 p = iC + iAx * q.x + iAy * q.y;
  vPx = p;
  vUV = mix(iUV.xy, iUV.zw, q * 0.5 + 0.5);
  vBox = vec4(min(iUV.xy, iUV.zw), max(iUV.xy, iUV.zw));
  vCol = iCol; vFx = iFx; vRim = iRim; vRimC = iRimC; vClip = iClip;
  gl_Position = vec4(p.x * invRes.x * 2.0 - 1.0, 1.0 - p.y * invRes.y * 2.0, 0.0, 1.0);
}`;
const SPRITE_FRAG = /* glsl */ `
in vec2 vUV; in vec2 vPx; in vec4 vCol; in vec4 vFx; in vec2 vRim; in vec3 vRimC; in vec4 vClip; in vec4 vBox;
uniform sampler2D tex; uniform int srcMode; uniform vec3 hazeTop; uniform vec3 hazeBot; uniform float invH;
out vec4 fragColor;
${CLIP_GLSL}
void main() {
  float bias = vFx.z;
  // both taps before any branch or discard: implicit derivatives need the whole 2x2 quad
  vec4 s = texture(tex, vUV, bias);
  float a2 = texture(tex, clamp(vUV + vRim, vBox.xy, vBox.zw), bias).a;
  float a = s.a;
  if (a < 0.0015) discard;
  vec3 c = srcMode == 0 ? toLinear(s.rgb / a) : s.rgb;
  c *= vCol.rgb;
  if (vRimC.r + vRimC.g + vRimC.b > 0.0) {
    float rim = sat((a - a2) / max(a, 1e-3));
    c += vRimC * rim * (1.0 - min(c, vec3(1.0)) * 0.6);
  }
  c = mix(c, vCol.rgb, vFx.w);
  vec3 hz = mix(hazeTop, hazeBot, sat(vPx.y * invH));
  c = mix(c, hz, vFx.x);
  float A = a * vCol.a * clipMask(vPx, vClip);
  fragColor = vec4(c * A, A * (1.0 - vFx.y));
}`;

export class SpriteBatch extends InstBatch {
  constructor(capacity = 2048) {
    super(SPRITE_STRIDE, capacity,
      [['iC', 2], ['iAx', 2], ['iAy', 2], ['iUV', 4], ['iCol', 4], ['iFx', 4], ['iRim', 2], ['iRimC', 3], ['iClip', 4]],
      SPRITE_VERT, SPRITE_FRAG,
      { tex: { value: null }, srcMode: { value: 0 }, hazeTop: { value: new THREE.Vector3() }, hazeBot: { value: new THREE.Vector3() }, invH: { value: 1 / H }, invRes: { value: new THREE.Vector2(1 / W, 1 / H) } });
  }
  setTexture(tex: THREE.Texture, srcMode: number) { this.mat.uniforms.tex!.value = tex; this.mat.uniforms.srcMode!.value = srcMode; }
  setHaze(top: [number, number, number], bot: [number, number, number], h: number) {
    (this.mat.uniforms.hazeTop!.value as THREE.Vector3).set(top[0], top[1], top[2]);
    (this.mat.uniforms.hazeBot!.value as THREE.Vector3).set(bot[0], bot[1], bot[2]);
    this.mat.uniforms.invH!.value = 1 / h;
  }
}

// ------------------------------------------------------------------------------------------------------------
// Marks (procedural shapes)
// ------------------------------------------------------------------------------------------------------------
// iC centre · iH half size (shape frame) · iR (cos, sin) of its rotation · iShape kind, param, feather, lit ·
// iCol colour×gain, alpha · iCol2 shade colour, add · iRimC rim colour×strength, rim width (px) · iClip
export const MARK_STRIDE = 2 + 2 + 2 + 4 + 4 + 4 + 4 + 4;
export const MK = { ellipse: 0, rect: 1, ring: 2, glow: 3, sparkle: 4, tri: 5, beam: 6 } as const;
const MARK_VERT = /* glsl */ `
in vec3 position;
in vec2 iC; in vec2 iH; in vec2 iR; in vec4 iShape; in vec4 iCol; in vec4 iCol2; in vec4 iRimC; in vec4 iClip;
uniform vec2 invRes; uniform vec2 L;
out vec2 vP; out vec2 vH; out vec2 vPx; out vec4 vShape; out vec4 vCol; out vec4 vCol2; out vec4 vRimC; out vec4 vClip; out vec2 vL;
void main() {
  bool soft = (iShape.x > 2.5 && iShape.x < 4.5) || iShape.x > 5.5;
  vec2 ext = soft ? iH : iH + iShape.z + 1.5;
  vec2 lp = position.xy * ext;
  vec2 p = iC + vec2(lp.x * iR.x - lp.y * iR.y, lp.x * iR.y + lp.y * iR.x);
  vP = lp; vH = iH; vPx = p; vShape = iShape; vCol = iCol; vCol2 = iCol2; vRimC = iRimC; vClip = iClip;
  vL = vec2(L.x * iR.x + L.y * iR.y, -L.x * iR.y + L.y * iR.x); // the light in the shape's frame
  gl_Position = vec4(p.x * invRes.x * 2.0 - 1.0, 1.0 - p.y * invRes.y * 2.0, 0.0, 1.0);
}`;
const MARK_FRAG = /* glsl */ `
in vec2 vP; in vec2 vH; in vec2 vPx; in vec4 vShape; in vec4 vCol; in vec4 vCol2; in vec4 vRimC; in vec4 vClip; in vec2 vL;
out vec4 fragColor;
${CLIP_GLSL}
float sdEllipseApprox(vec2 p, vec2 h, out vec2 n) {
  vec2 q = p / h, g = p / (h * h);
  float k0 = length(q), k1 = max(length(g), 1e-6);
  n = g / k1;
  return k0 * (k0 - 1.0) / k1;
}
float sdRound(vec2 p, vec2 h, float r, out vec2 n) {
  r = min(r, min(h.x, h.y));
  vec2 q = abs(p) - h + r;
  vec2 sg = vec2(p.x < 0.0 ? -1.0 : 1.0, p.y < 0.0 ? -1.0 : 1.0);
  if (q.x > 0.0 && q.y > 0.0) n = normalize(q) * sg;
  else n = (q.x > q.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0)) * sg;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float sdTriUp(vec2 p, vec2 h) { // isosceles, apex at -h.y (up on screen), base at +h.y
  vec2 q = vec2(h.x, 2.0 * h.y);
  p.y += h.y;
  p.x = abs(p.x);
  vec2 a = p - q * clamp(dot(p, q) / dot(q, q), 0.0, 1.0);
  vec2 b = p - q * vec2(clamp(p.x / q.x, 0.0, 1.0), 1.0);
  float s = -sign(q.y);
  vec2 d = min(vec2(dot(a, a), s * (p.x * q.y - p.y * q.x)), vec2(dot(b, b), s * (p.y - q.y)));
  return -sqrt(d.x) * sign(d.y);
}
void main() {
  float kind = vShape.x;
  float aa = 1.0 / PX_SCALE;
  float A; vec3 c = vCol.rgb;
  if (kind > 2.5 && kind < 3.5) {                 // glow: a soft disc, zero at the quad's edge
    vec2 q = vP / vH; float r2 = dot(q, q);
    float k = vShape.y > 0.0 ? vShape.y : 4.0;
    float e = exp(-k);
    A = max(0.0, (exp(-k * r2) - e) / (1.0 - e));
  } else if (kind > 3.5 && kind < 4.5) {          // sparkle: a core and four rays
    vec2 q = vP / vH; float r2 = dot(q, q);
    float w = vShape.y > 0.0 ? vShape.y : 90.0;
    float rays = exp(-q.y * q.y * w) * max(0.0, 1.0 - abs(q.x)) + exp(-q.x * q.x * w) * max(0.0, 1.0 - abs(q.y));
    A = max(exp(-r2 * 14.0), rays * 0.85) * step(r2, 1.0);
  } else if (kind > 5.5) {                         // beam: a cone of light from an apex (top, before rot) opening down
    vec2 q = vP / vH;
    float u = q.y * 0.5 + 0.5;
    float hw = mix(vShape.y, 1.0, u);
    float across = abs(q.x) / max(hw, 1e-3);
    A = (1.0 - smoothstep(0.3, 1.0, across)) * smoothstep(0.0, 0.05, u) * (1.0 - u * u) * (0.55 + 0.45 * (1.0 - across * across));
  } else {
    vec2 n = vec2(0.0, -1.0); float d;
    if (kind < 0.5) d = sdEllipseApprox(vP, vH, n);
    else if (kind < 1.5) d = sdRound(vP, vH, vShape.y, n);
    else if (kind < 2.5) { float d0 = sdEllipseApprox(vP, vH, n); d = abs(d0 + vShape.y * 0.5) - vShape.y * 0.5; }
    else { d = sdTriUp(vP, vH); n = normalize(vP + vec2(0.0, 1e-4)); }
    A = sat(0.5 - d / (aa + vShape.z));
    float lit = vShape.w;
    if (lit > 0.0) {
      vec2 q = vP / max(vH, vec2(1e-3));
      float g = dot(q, vL);
      float sh = 1.0 - smoothstep(-0.62, 0.28, g);
      c = mix(c, vCol2.rgb, sh * lit);
      float rw = vRimC.w > 0.0 ? vRimC.w : max(1.5, 0.12 * min(vH.x, vH.y));
      float band = 1.0 - smoothstep(0.0, rw, -d);
      float facing = sat(dot(n, vL) * 1.3);
      c += vRimC.rgb * band * facing * lit * (1.0 - min(c, vec3(1.0)) * 0.5);
    }
  }
  float alpha = A * vCol.a * clipMask(vPx, vClip);
  fragColor = vec4(c * alpha, alpha * (1.0 - vCol2.a));
}`;

export class MarkBatch extends InstBatch {
  constructor(capacity = 8192) {
    super(MARK_STRIDE, capacity,
      [['iC', 2], ['iH', 2], ['iR', 2], ['iShape', 4], ['iCol', 4], ['iCol2', 4], ['iRimC', 4], ['iClip', 4]],
      MARK_VERT, MARK_FRAG, { invRes: { value: new THREE.Vector2(1 / W, 1 / H) }, L: { value: new THREE.Vector2(0, -1) } });
  }
  setLight(L: [number, number]) { (this.mat.uniforms.L!.value as THREE.Vector2).set(L[0], L[1]); }
}

// ------------------------------------------------------------------------------------------------------------
// Ribbons (polylines)
// ------------------------------------------------------------------------------------------------------------
// per vertex: pos (screen px) · across (px from the centre line, signed) · along (px from the start) · len (the
// polyline's length) · hw (half width) · feather · col (rgb×gain, alpha) · add · dash (on, off px) · clip
export const RIB_STRIDE = 2 + 1 + 1 + 1 + 1 + 1 + 4 + 1 + 2 + 4;
const RIB_VERT = /* glsl */ `
in vec2 pos; in float across; in float along; in float len; in float hw; in float feather; in vec4 col; in float add; in vec2 dash; in vec4 clip;
uniform vec2 invRes;
out float vAcross; out float vAlong; out float vLen; out float vHw; out float vFeather; out vec4 vCol; out float vAdd; out vec2 vDash; out vec4 vClip; out vec2 vPx;
void main() {
  vAcross = across; vAlong = along; vLen = len; vHw = hw; vFeather = feather; vCol = col; vAdd = add; vDash = dash; vClip = clip; vPx = pos;
  gl_Position = vec4(pos.x * invRes.x * 2.0 - 1.0, 1.0 - pos.y * invRes.y * 2.0, 0.0, 1.0);
}`;
const RIB_FRAG = /* glsl */ `
in float vAcross; in float vAlong; in float vLen; in float vHw; in float vFeather; in vec4 vCol; in float vAdd; in vec2 vDash; in vec4 vClip; in vec2 vPx;
out vec4 fragColor;
${CLIP_GLSL}
void main() {
  float aa = 1.0 / PX_SCALE;
  float cap = max(0.0, -vAlong) + max(0.0, vAlong - vLen);
  float d = length(vec2(cap, vAcross));
  float hw = max(vHw, 0.35);
  float a;
  if (vFeather > 0.0) a = 1.0 - smoothstep(max(0.0, hw - vFeather), hw + vFeather + aa * 0.5, d);
  else a = sat(0.5 + (hw - d) / aa);
  a *= min(1.0, vHw / 0.35);
  if (vDash.x > 0.0) {
    float per = vDash.x + vDash.y, m = mod(max(vAlong, 0.0), per);
    a *= sat(0.5 + min(m, vDash.x - m) / aa);
  }
  a *= vCol.a * clipMask(vPx, vClip);
  if (a <= 0.0) discard;
  fragColor = vec4(vCol.rgb * a, a * (1.0 - vAdd));
}`;

export class RibbonBatch {
  data: Float32Array;
  idx: Uint32Array;
  nv = 0;
  ni = 0;
  private buf: THREE.InterleavedBuffer;
  private ibuf: THREE.BufferAttribute;
  private geo = new THREE.BufferGeometry();
  mat: THREE.RawShaderMaterial;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  constructor(public capV = 32768) {
    this.data = new Float32Array(capV * RIB_STRIDE);
    this.idx = new Uint32Array(capV * 3);
    this.buf = new THREE.InterleavedBuffer(this.data, RIB_STRIDE);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    let off = 0;
    for (const [name, size] of [['pos', 2], ['across', 1], ['along', 1], ['len', 1], ['hw', 1], ['feather', 1], ['col', 4], ['add', 1], ['dash', 2], ['clip', 4]] as [string, number][]) {
      this.geo.setAttribute(name, new THREE.InterleavedBufferAttribute(this.buf, size, off));
      off += size;
    }
    this.ibuf = new THREE.BufferAttribute(this.idx, 1);
    this.ibuf.setUsage(THREE.DynamicDrawUsage);
    this.geo.setIndex(this.ibuf);
    this.mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: HEAD + RIB_VERT, fragmentShader: HEAD + GLSL_COMMON + RIB_FRAG, uniforms: { invRes: { value: new THREE.Vector2(1 / W, 1 / H) } } });
    premultBlend(this.mat);
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }
  room(nv: number) { return this.nv + nv <= this.capV && this.ni + (nv - 2) * 3 <= this.idx.length; }
  flush(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null) {
    if (this.ni === 0) { this.nv = 0; return; }
    this.buf.clearUpdateRanges(); this.buf.addUpdateRange(0, this.nv * RIB_STRIDE); this.buf.needsUpdate = true;
    this.ibuf.clearUpdateRanges(); this.ibuf.addUpdateRange(0, this.ni); this.ibuf.needsUpdate = true;
    this.geo.setDrawRange(0, this.ni);
    const [tw, th] = targetSize(target);
    (this.mat.uniforms.invRes!.value as THREE.Vector2).set(1 / tw, 1 / th);
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.cam);
    this.nv = 0; this.ni = 0;
  }
  dispose() { this.geo.dispose(); this.mat.dispose(); }
}

// ------------------------------------------------------------------------------------------------------------
// Shader quads
// ------------------------------------------------------------------------------------------------------------
const QUAD_VERT = /* glsl */ `
in vec3 position;
uniform vec2 uC; uniform vec2 uAx; uniform vec2 uAy; uniform vec2 invRes;
out vec2 vPx; out vec2 vQ;
void main() {
  vQ = position.xy;
  vec2 p = uC + uAx * position.x + uAy * position.y;
  vPx = p;
  gl_Position = vec4(p.x * invRes.x * 2.0 - 1.0, 1.0 - p.y * invRes.y * 2.0, 0.0, 1.0);
}`;
let quadGeo: THREE.BufferGeometry | null = null;
function quadGeometry() {
  if (!quadGeo) {
    quadGeo = new THREE.BufferGeometry();
    quadGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    quadGeo.setIndex([0, 1, 2, 0, 2, 3]);
  }
  return quadGeo;
}
export class QuadPass {
  mat: THREE.RawShaderMaterial;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  constructor(frag: string, uniforms: Record<string, THREE.IUniform>, opaque = false) {
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: HEAD + QUAD_VERT, fragmentShader: HEAD + GLSL_COMMON + frag,
      uniforms: { uC: { value: new THREE.Vector2() }, uAx: { value: new THREE.Vector2(1, 0) }, uAy: { value: new THREE.Vector2(0, 1) }, invRes: { value: new THREE.Vector2(1 / W, 1 / H) }, ...uniforms },
    });
    if (opaque) { this.mat.blending = THREE.NoBlending; this.mat.depthTest = false; this.mat.depthWrite = false; this.mat.side = THREE.DoubleSide; }
    else premultBlend(this.mat);
    const mesh = new THREE.Mesh(quadGeometry(), this.mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }
  get u() { return this.mat.uniforms; }
  /** Place the quad: centre and half axes in screen px. */
  place(cx: number, cy: number, ax: [number, number], ay: [number, number]) {
    (this.u.uC!.value as THREE.Vector2).set(cx, cy);
    (this.u.uAx!.value as THREE.Vector2).set(ax[0], ax[1]);
    (this.u.uAy!.value as THREE.Vector2).set(ay[0], ay[1]);
  }
  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null) {
    const [tw, th] = targetSize(target);
    (this.u.invRes!.value as THREE.Vector2).set(1 / tw, 1 / th);
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.cam);
  }
  dispose() { this.mat.dispose(); }
}

const v3 = () => ({ value: new THREE.Vector3() });
const v2 = () => ({ value: new THREE.Vector2() });
const f1 = (x = 0) => ({ value: x });

/** The sky: a vertical gradient (top → bottom between two screen ys), a horizon glow band, a sun's glow and an
 * optional nebula (two colours of soft fbm cloud). Opaque: it also clears the target (the post dithers). Under a
 * clip (a lens drawing the world again) it blends instead, premultiplied, and keeps what the clip keeps. */
export function skyPass(opaque = true) {
  return new QuadPass(/* glsl */ `
    in vec2 vPx; in vec2 vQ;
    uniform vec3 top, bot, hor, sunCol, neb1, neb2;
    uniform float yTop, invSpan, horY, horInvW, horK, sunInvR, sunK, nebK, nebScale, nebSeed;
    uniform vec2 sun, nebOff;
    // the stage's magnifier (its centre, and 1/m: q is the sky's point shown at vPx) and its clip
    uniform vec3 mag; uniform vec4 clip;
    ${CLIP_GLSL}
    out vec4 fragColor;
    void main() {
      vec2 q = mag.xy + (vPx - mag.xy) * mag.z;
      float v = sat((q.y - yTop) * invSpan);
      vec3 c = mix(top, bot, v * v * (3.0 - 2.0 * v)); // flat at both ends: no kink where the gradient meets its clamp
      float dh = (q.y - horY) * horInvW;
      c += hor * horK * exp(-dh * dh) ;
      if (sunK > 0.0) {
        float sd = distance(q, sun) * sunInvR;
        c += sunCol * sunK * (exp(-sd * sd * 2.0) + 0.28 * exp(-sd * 0.9));
      }
      if (nebK > 0.0) {
        vec2 p = (q + nebOff) * nebScale + nebSeed;
        float n1 = fbm(p, 5), n2 = fbm(p * 1.7 + 19.3, 4);
        float m1 = smoothstep(-0.05, 0.6, n1), m2 = smoothstep(0.0, 0.7, n2) * smoothstep(-0.3, 0.4, n1);
        c += nebK * (neb1 * m1 * 0.6 + neb2 * m2 * 0.45);
      }
      fragColor = vec4(max(c, 0.0), 1.0) * clipMask(vPx, clip);
    }`, {
    top: v3(), bot: v3(), hor: v3(), sunCol: v3(), neb1: v3(), neb2: v3(),
    yTop: f1(), invSpan: f1(1 / H), horY: f1(H), horInvW: f1(0.01), horK: f1(), sunInvR: f1(0.01), sunK: f1(), nebK: f1(), nebScale: f1(0.002), nebSeed: f1(),
    sun: v2(), nebOff: v2(), mag: { value: new THREE.Vector3(0, 0, 1) }, clip: { value: new THREE.Vector4() },
  }, opaque);
}

/** A planet: a shaded sphere (soft terminator toward the night colour, latitude bands, craters), a fresnel
 * atmosphere inside the limb and a glow outside it, warm where the sun grazes it; optional rings. */
export function planetPass() {
  return new QuadPass(/* glsl */ `
    in vec2 vPx; in vec2 vQ;
    // every value made from uniforms alone comes from the CPU (docs/ENGINE.md, Rules): reciprocals, the light's 2D
    // direction, the AA widths
    uniform vec2 pc; uniform float invR, r, atm, invAtm, soft, invSoft2, bandK, craterK, seed, ringIn, ringOut, ringInvTilt, ringK, alpha, rimK, glowK, invAA, invAAr;
    uniform vec3 L3, cDay, cDay2, cNight, cAtm, cWarm, cRing; uniform vec2 ringCS, Lxy;
    uniform float rimFloor, glowFloor, nightAtm; uniform vec4 clip;
    ${CLIP_GLSL}
    // the surface (surfK > 0): continents, oceans and clouds on the sphere (in its own frame, rotM), coastal city
    // lights on the night side, a hot cluster, the sun's glint on the oceans (glintH: the half vector, from the CPU)
    uniform float surfK, landLevel, surfScale, cloudK, cloudScale, cityK, cityScale, hotK, hotR2inv, glintK, pxCell;
    uniform vec3 cLand, cLand2, cOcean, cCloud, cCloudSh, cCity, hotDir, glintH; uniform mat3 rotM;
    // close to the ground: fields (a patchwork on a fine lattice), roads on some of their borders, a river; the land
    // raised around the hot point (the launch site is on land), the town as pale specks by day. Fades from the CPU.
    uniform float fieldK, fieldScale, roadW, riverK, riverW, hotLand, speckK; uniform vec3 cField, cRoad, cSpeck;
    float ramp(float x) { x = sat(x); return x * x * (3.0 - 2.0 * x); }
    out vec4 fragColor;
    vec4 over(vec4 top, vec4 under) { return top + under * (1.0 - top.a); }
    vec4 ringAt(vec2 p, float front) {
      if (ringK <= 0.0) return vec4(0.0);
      vec2 q = vec2(p.x * ringCS.x + p.y * ringCS.y, -p.x * ringCS.y + p.y * ringCS.x);
      if ((q.y > 0.0 ? 1.0 : 0.0) != front) return vec4(0.0);
      float rr = length(vec2(q.x, q.y * ringInvTilt));
      float m = ramp((rr - ringIn) * invAAr + 0.5) * (1.0 - ramp((rr - ringOut) * invAAr + 0.5));
      float bands = 0.65 + 0.35 * sin(rr * 61.0 + seed) * sin(rr * 23.0);
      float a = m * ringK * bands;
      vec3 c = cRing * (0.75 + 0.5 * sat(dot(normalize(vec3(p, 0.2)), L3)));
      return vec4(c * a, a);
    }
    void main() {
      vec2 p = (vPx - pc) * invR;
      float r2 = dot(p, p), rr = sqrt(r2);
      vec2 dir = rr > 1e-5 ? p / rr : vec2(0.0, -1.0);
      float sunSide = sat(dot(dir, Lxy) * 0.5 + 0.5); // (clamped: a hair below 0 makes pow() NaN on the anti-sun line)
      // the glow outside the limb
      float out1 = max(rr - 1.0, 0.0) * invAtm;
      float g = exp(-out1 * 2.2) * ramp((rr - 1.0) * invAA + 0.5);
      vec3 gc = mix(cAtm, cWarm, pow(sunSide, 6.0)) * (glowFloor + 1.15 * pow(sunSide, 1.6));
      vec4 glow = vec4(gc * g * glowK, 0.0);
      // the body
      float cov = sat((1.0 - rr) * invAA + 0.5);
      vec4 body = vec4(0.0);
      if (cov > 0.0) {
        vec3 n = vec3(p, sqrt(max(0.0, 1.0 - r2)));
        float lam = dot(n, L3);
        float day = ramp((lam + soft) * invSoft2);
        float lat = n.y, lon = atan(n.x, n.z);
        float bnd = bandK * (0.5 + 0.5 * sin(lat * 9.0 + 1.7 * sin(lon * 2.0 + seed) + seed * 3.0));
        vec3 dc = mix(cDay, cDay2, bnd);
        dc *= 0.82 + 0.3 * sat(lam);
        if (craterK > 0.0) {
          vec2 uv = vec2(lon * 2.2, lat * 3.2) + seed;
          vec2 cell = floor(uv), f = fract(uv);
          vec2 o = hash22(cell) * 0.6 + 0.2;
          float cr = 0.12 + 0.18 * hash12(cell + 7.0);
          float dd = length(f - o) / cr;
          float crater = (1.0 - smoothstep(0.85, 1.0, dd)) * step(0.45, hash12(cell + 3.1));
          float lip = smoothstep(0.7, 0.95, dd) * (1.0 - smoothstep(0.95, 1.1, dd));
          dc *= 1.0 - craterK * crater * 0.22;
          dc += craterK * lip * 0.06 * cDay;
        }
        vec3 nightC = cNight;
        float lights = 0.0, spec = 0.0;
        if (surfK > 0.0) {
          vec3 q = rotM * n;
          vec3 dq = q - hotDir;
          float h = fbm(q * surfScale + seed, 5) + hotLand * exp(-dot(dq, dq) * hotR2inv * 0.02);
          float land = smoothstep(landLevel - 0.012, landLevel + 0.012, h);
          float h2 = fbm(q * surfScale * 3.3 + 7.0 + seed, 3);
          vec3 ground = mix(cLand, cLand2, sat(0.5 + h2 * 1.4));
          ground = mix(ground, cField, smoothstep(landLevel + 0.24, landLevel + 0.42, h) * 0.4); // high inland: ochre
          if (fieldK > 0.0) {
            vec3 gf = q * fieldScale, cf = floor(gf), ff = fract(gf);
            float hv = hash13(cf + 2.3);
            vec3 fc = hv < 0.34 ? cLand : hv < 0.62 ? cLand2 : hv < 0.86 ? cField : mix(cLand, cField, 0.5);
            ground = mix(ground, fc * (0.9 + 0.2 * hash13(cf + 8.1)), fieldK * 0.8);
            vec3 e3 = min(ff, 1.0 - ff);
            float ed = min(min(e3.x, e3.y), e3.z);
            float isRoad = step(0.55, hash13(cf + 4.4));
            ground = mix(ground, cRoad, fieldK * isRoad * (1.0 - smoothstep(roadW * 0.5, roadW, ed)));
          }
          vec3 sea = cOcean * (0.8 + 0.5 * smoothstep(landLevel - 0.25, landLevel, h));
          vec3 surf = mix(sea, ground, land);
          if (riverK > 0.0) {
            float rv = abs(snoise(q * 38.0 + snoise(q * 11.0 + 5.0 + seed) * 0.7 + seed));
            surf = mix(surf, cOcean * 1.1, riverK * land * (1.0 - smoothstep(riverW, riverW * 1.6, rv)));
          }
          float cl = fbm(vec3(q.x * 1.1, q.y * 3.0, q.z * 1.1) * cloudScale + 31.0 + seed, 4);
          float cloud = smoothstep(0.16, 0.26, cl) * cloudK;
          vec3 cloudC = mix(cCloudSh, cCloud, sat(lam * 1.6 + 0.2));
          dc = mix(surf * (0.8 + 0.32 * sat(lam)), cloudC, cloud);
          nightC = mix(cNight * (0.8 + 0.3 * land), cNight * 1.5 + cCloudSh * 0.06, cloud * 0.6);
          spec = pow(sat(dot(n, glintH)), 70.0) * (1.0 - land) * (1.0 - cloud) * glintK;
          // cities: one candidate point per cell of a 3D lattice on the sphere, kept on land near the coast
          float coast = land * (1.0 - smoothstep(landLevel + 0.01, landLevel + 0.16, h));
          float hot = exp(-dot(q - hotDir, q - hotDir) * hotR2inv) * hotK;
          vec3 g = q * cityScale, cc = floor(g), f = fract(g);
          vec3 o = hash33(cc) * 0.6 + 0.2;
          float keep = step(hash13(cc + 5.1), coast * 0.85 + hot * 1.4);
          float d = length(f - o) * pxCell;   // px from the point (pxCell: px per cell, from the CPU)
          float b = 0.45 + 0.9 * hash13(cc + 9.7) + hot * 1.6;
          lights = keep * b * sat(1.6 - d) * (1.0 - cloud * 0.7);
          // a finer grid of fainter lights in the hot cluster: the town seen from orbit
          vec3 g2 = q * cityScale * 3.0, c2 = floor(g2), f2 = fract(g2);
          float d2 = length(f2 - (hash33(c2 + 3.3) * 0.6 + 0.2)) * pxCell * 3.0;
          float fine = step(hash13(c2 + 1.7), hot * 0.9) * (0.6 + 0.8 * hash13(c2 + 4.2)) * sat(1.3 - d2);
          lights += fine;
          dc = mix(dc, cSpeck, speckK * sat(fine + keep * hot * sat(1.6 - d)));
        }
        vec3 col = mix(nightC, dc, day);
        col += cCity * lights * cityK * (1.0 - day);
        col += cWarm * spec * day;
        // the atmosphere seen through, a band inside the limb as thick as the glow outside it
        float inside = (1.0 - rr) * invAtm;
        float fres = exp(-inside * 1.4);
        col += cAtm * fres * (nightAtm + 0.6 * day);
        float crescent = exp(-inside * 2.4) * (rimFloor + (1.0 - rimFloor) * smoothstep(0.1, 0.97, dot(dir, Lxy)));
        col += cWarm * crescent * rimK;
        body = vec4(col * cov, cov);
      }
      vec4 c = over(ringAt(p, 1.0), over(body, over(glow, ringAt(p, 0.0) * (1.0 - cov))));
      fragColor = c * (alpha * clipMask(vPx, clip));
    }`, {
    clip: { value: new THREE.Vector4() },
    rimFloor: f1(0.03), glowFloor: f1(0.05), nightAtm: f1(0.12),
    fieldK: f1(), fieldScale: f1(300), roadW: f1(0.02), riverK: f1(), riverW: f1(0.01), hotLand: f1(), speckK: f1(), cField: v3(), cRoad: v3(), cSpeck: v3(),
    surfK: f1(), landLevel: f1(0.05), surfScale: f1(1.6), cloudK: f1(), cloudScale: f1(2.2), cityK: f1(), cityScale: f1(60), hotK: f1(), hotR2inv: f1(400), glintK: f1(), pxCell: f1(10),
    cLand: v3(), cLand2: v3(), cOcean: v3(), cCloud: v3(), cCloudSh: v3(), cCity: v3(), hotDir: v3(), glintH: v3(), rotM: { value: new THREE.Matrix3() },
    pc: v2(), invR: f1(), r: f1(), atm: f1(0.08), invAtm: f1(12.5), soft: f1(0.12), invSoft2: f1(4), invAA: f1(1), invAAr: f1(1), Lxy: { value: new THREE.Vector2(0, -1) }, bandK: f1(0.3), craterK: f1(), seed: f1(), ringIn: f1(1.4), ringOut: f1(2.1), ringInvTilt: f1(4), ringK: f1(), alpha: f1(1), rimK: f1(1), glowK: f1(1),
    L3: v3(), cDay: v3(), cDay2: v3(), cNight: v3(), cAtm: v3(), cWarm: v3(), cRing: v3(), ringCS: { value: new THREE.Vector2(1, 0) },
  });
}

/** A filled polygon (up to MAX_POLY points, screen px) by its signed distance: AA edges, optionally lit like a mark. */
export const MAX_POLY = 64;
export function polyPass() {
  return new QuadPass(/* glsl */ `
    in vec2 vPx; in vec2 vQ;
    uniform vec2 pts[${MAX_POLY}]; uniform int n; uniform vec3 col, col2, rimC; uniform float lit, invEdge, alpha, add, rimW;
    uniform vec2 L, cen, invHalf; uniform vec4 clip;
    out vec4 fragColor;
    ${CLIP_GLSL}
    void main() {
      vec2 p = vPx;
      float d = 1e20, s = 1.0; vec2 best = vec2(0.0, -1.0);
      int j = n - 1;
      for (int i = 0; i < ${MAX_POLY}; i++) {
        if (i >= n) break;
        vec2 a = pts[i], b = pts[j];
        vec2 e = b - a, w = p - a;
        vec2 q = w - e * clamp(dot(w, e) / max(dot(e, e), 1e-9), 0.0, 1.0);
        float qq = dot(q, q);
        if (qq < d) { d = qq; best = q; }
        bool c1 = p.y >= a.y, c2 = p.y < b.y, c3 = e.x * w.y > e.y * w.x;
        if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
        j = i;
      }
      float sd = s * sqrt(d);
      vec2 nrm = s * best / max(sqrt(d), 1e-5); // outward
      float A = sat(0.5 - sd * invEdge); // invEdge = 1 / (AA + feather), from the CPU
      vec3 c = col;
      if (lit > 0.0) {
        vec2 qn = (p - cen) * invHalf;
        float g = dot(qn, L);
        c = mix(c, col2, (1.0 - smoothstep(-0.62, 0.28, g)) * lit);
        float band = 1.0 - smoothstep(0.0, rimW, -sd);
        c += rimC * band * sat(dot(nrm, L) * 1.3) * lit * (1.0 - min(c, vec3(1.0)) * 0.5);
      }
      A *= alpha * clipMask(vPx, clip);
      if (A <= 0.0) discard;
      fragColor = vec4(c * A, A * (1.0 - add));
    }`, {
    pts: { value: Array.from({ length: MAX_POLY }, () => new THREE.Vector2()) }, n: f1(0), col: v3(), col2: v3(), rimC: v3(), lit: f1(), invEdge: f1(1), alpha: f1(1), add: f1(), rimW: f1(3),
    L: v2(), cen: v2(), invHalf: v2(), clip: { value: new THREE.Vector4() },
  });
}

/** The previous scene's frame (f.under) through a mask: kind 0 circle (cx, cy, r, feather), 1 a straight wipe
 * (a point on the edge, the edge's normal; feather). `keep` 'outside' shows it outside the circle / ahead of the
 * edge (the new scene opens through it), 'inside' within. Full frame, premultiplied over. */
export function underPass() {
  return new QuadPass(/* glsl */ `
    in vec2 vPx; in vec2 vQ;
    uniform sampler2D under; uniform vec4 m; uniform vec2 nrm; uniform float kind, inside, invW, invHh, feather;
    out vec4 fragColor;
    void main() {
      vec4 c = texture(under, vec2(vPx.x * invW, 1.0 - vPx.y * invHh));
      float d = kind < 0.5 ? distance(vPx, m.xy) - m.z : dot(vPx - m.xy, nrm);
      float k = smoothstep(-feather, feather, d);
      if (inside > 0.5) k = 1.0 - k;
      fragColor = vec4(c.rgb * k, k);
    }`, { under: { value: null }, m: { value: new THREE.Vector4() }, nrm: v2(), kind: f1(), inside: f1(), invW: f1(1 / W), invHh: f1(1 / H), feather: f1(1) });
}
