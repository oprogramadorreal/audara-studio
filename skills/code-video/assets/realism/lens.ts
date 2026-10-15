// What a camera adds after the light: ambient occlusion in the creases, then a depth of field from a real
// lens (focal length, focus distance, f-stop on a 36 mm-wide sensor). Both run inside the scene, on its own
// depth, per sub-frame, before the scene hands its picture to the engine; the engine's post (bloom, grain,
// tone) then treats the whole frame. Adapted from golden-temple's src/core/post.js (SAO-style SSAO with a
// depth-aware blur, and a scatter-as-gather depth of field after Gustafsson) and its main.js lens maths
// (MIT, Leon Lin: see LICENSE).
//
// Sizes are in the video's logical px, so a blur looks the same at --scale 2 (the 4K render) as at 1x.
import * as THREE from 'three';
import { FSPass, makeRT } from '../engine/gl';

/** The largest blur allowed, logical px. */
const MAX_BLUR = 25;

// The targets are scratch: filled by a scene's draw and read by finish() in the same render, then free. Every
// Lens of one frame size shares one set, so a video of many kit shots (each entry's scene is built when the
// page opens) holds one set instead of one per shot: about 150 MB at 1080p, four times that at --scale 2.
interface Targets { rt: THREE.WebGLRenderTarget; aoA: THREE.WebGLRenderTarget; aoB: THREE.WebGLRenderTarget; cocRT: THREE.WebGLRenderTarget; tileRT: THREE.WebGLRenderTarget; users: number }
const POOL = new Map<string, Targets>();
const TILE = 16;

function acquire(W: number, H: number): Targets {
  let t = POOL.get(`${W}x${H}`);
  if (!t) {
    const rt = makeRT(W, H, { samples: 4 });
    rt.depthTexture = new THREE.DepthTexture(rt.width, rt.height, THREE.FloatType);
    t = {
      rt, aoA: makeRT(W / 2, H / 2, { depthBuffer: false }), aoB: makeRT(W / 2, H / 2, { depthBuffer: false }),
      cocRT: makeRT(W, H, { depthBuffer: false }),
      // the largest blur in each 16x16-logical-px tile: the gather stops where no blur nearby reaches further
      tileRT: makeRT(Math.ceil(W / TILE), Math.ceil(H / TILE), { depthBuffer: false, pxScale: 1, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }),
      users: 0,
    };
    POOL.set(`${W}x${H}`, t);
  }
  t.users++;
  return t;
}

function release(W: number, H: number, t: Targets) {
  if (--t.users > 0) return;
  POOL.delete(`${W}x${H}`);
  t.rt.depthTexture?.dispose();
  for (const x of [t.rt, t.aoA, t.aoB, t.cocRT, t.tileRT]) x.dispose();
}

const DEPTH = /* glsl */ `
uniform sampler2D tDepth; uniform mat4 uProjInv; uniform float cameraNear, cameraFar;
float lz(float d){ return (cameraNear * cameraFar) / ((cameraFar - cameraNear) * d - cameraFar); } // view z (negative)
vec3 vpos(vec2 uv){ float d = texture(tDepth, uv).x; vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return v.xyz / v.w; }`;

export interface LensSettings {
  /** Focal length, mm (36 mm-wide sensor: 24 wide, 50 normal, 85+ long). */
  focal: number;
  /** Focus distance, m. */
  focus: number;
  /** Aperture, f-stop (2.8 shallow, 8 deep). */
  fstop: number;
  /** Depth of field on (default true). */
  dof?: boolean;
  /** Largest blur, logical px (default 22 at 1920 wide, in proportion to the frame; at most 25). */
  maxBlur?: number;
  /** How much the occlusion darkens (0 none, default 0.75), and its reach in metres (default 0.9). */
  ao?: number;
  aoRadius?: number;
}

/** Vertical field of view (degrees) of a focal length on a 36 mm-wide sensor, for a frame of this aspect. */
export const focalToFov = (focal: number, aspect: number) => (2 * Math.atan(36 / aspect / (2 * focal)) * 180) / Math.PI;

export class Lens {
  /**
   * Draw the scene here (4x multisampled, HDR, with a depth texture), then call finish() in the same render:
   * every Lens of this frame size shares the target, so what it holds doesn't last past that.
   */
  readonly rt: THREE.WebGLRenderTarget;
  private aoA: THREE.WebGLRenderTarget;
  private aoB: THREE.WebGLRenderTarget;
  private cocRT: THREE.WebGLRenderTarget;
  private tileRT: THREE.WebGLRenderTarget;
  private targets: Targets | null;
  private passes: FSPass[];
  private ao: FSPass; private blur: FSPass; private coc: FSPass; private tile: FSPass; private dof: FSPass;
  private dofStep: number;

  /**
   * `W`, `H`: the logical frame (ctx.W, ctx.H). The rest is cost, for a cheaper preview path (`ctx.export`
   * false): `aoSamples` (16 for the render), `dofStep` (the spacing of the depth of field's spiral of taps,
   * 0.55 for the render; about 1.2 takes half the taps for a slightly grainier blur of the same size).
   */
  constructor(private W: number, private H: number, o: { aoSamples?: number; dofStep?: number } = {}) {
    const n = Math.max(4, Math.round(o.aoSamples ?? 16));
    this.dofStep = Math.max(0.3, o.dofStep ?? 0.55);
    // the spiral's radius grows by dofStep / radius a tap, so the largest blur takes MAX_BLUR² / (2 dofStep)
    // taps: the loop allows them all, so a finer spacing never cuts a blur short
    const taps = Math.ceil((MAX_BLUR * MAX_BLUR) / (2 * this.dofStep)) + 2;
    const t = (this.targets = acquire(W, H));
    ({ rt: this.rt, aoA: this.aoA, aoB: this.aoB, cocRT: this.cocRT, tileRT: this.tileRT } = t);
    const PS = Math.max(1, Math.round(this.cocRT.width / W));
    const depthU = () => ({ tDepth: { value: null }, uProjInv: { value: new THREE.Matrix4() }, cameraNear: { value: 0.1 }, cameraFar: { value: 1000 } });
    // (uPx: physical px per logical px of the occlusion's target, so its reach and its blur cover the same
    // part of the frame at --scale 2 as at 1x)
    this.ao = new FSPass(/* glsl */ `${DEPTH}
      uniform vec2 uRes; uniform float uRadius, uIntensity, uRot, uPx; uniform mat4 uProj;
      void main(){
        if (texture(tDepth, vUv).x >= 0.99999) { fragColor = vec4(1.0); return; }
        vec3 P = vpos(vUv); vec2 px = 1.0 / uRes;
        vec3 pr = vpos(vUv + vec2(px.x, 0.0)), pl = vpos(vUv - vec2(px.x, 0.0));
        vec3 pu = vpos(vUv + vec2(0.0, px.y)), pd = vpos(vUv - vec2(0.0, px.y));
        vec3 N = normalize(cross(abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl, abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd));
        float rpx = min(uRadius * uProj[1][1] * 0.5 * uRes.y / -P.z, 120.0 * uPx);
        // the spiral turns per pixel and by sub-frame (uRot), never by frame
        float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uRot);
        float ao = 0.0, r2 = uRadius * uRadius;
        for (int i = 0; i < ${n}; i++){
          float fi = (float(i) + 0.5) / ${n}.0, ang = float(i) * 2.39996 + noise * 6.2831;
          vec3 v = vpos(vUv + vec2(cos(ang), sin(ang)) * sqrt(fi) * rpx * px) - P;
          float vv = dot(v, v), f = max(r2 - vv, 0.0) / r2;
          ao += f * f * f * max((dot(v, N) - 0.01 * -P.z) / (vv + 0.01), 0.0);
        }
        ao = max(0.0, 1.0 - ao * uIntensity * 2.0 / ${n}.0);
        fragColor = vec4(ao, ao, ao, 1.0);
      }`, { ...depthU(), uRes: { value: new THREE.Vector2() }, uRadius: { value: 0.9 }, uIntensity: { value: 1.3 }, uRot: { value: 0 }, uPx: { value: this.aoA.width / (W / 2) }, uProj: { value: new THREE.Matrix4() } });
    this.blur = new FSPass(/* glsl */ `${DEPTH}
      uniform sampler2D tAO; uniform vec2 uDir, uRes; uniform float uPx;
      void main(){
        float d0 = -lz(texture(tDepth, vUv).x), sum = 0.0, ws = 0.0;
        for (int i = -4; i <= 4; i++){
          vec2 uv = vUv + uDir * float(i) * uPx / uRes;
          float w = exp(-float(i * i) / 10.0) * exp(-abs(-lz(texture(tDepth, uv).x) - d0) / (0.02 * d0 + 0.01));
          sum += texture(tAO, uv).x * w; ws += w;
        }
        float r = sum / max(ws, 1e-4); fragColor = vec4(r, r, r, 1.0);
      }`, { ...depthU(), tAO: { value: null }, uDir: { value: new THREE.Vector2() }, uRes: { value: new THREE.Vector2() }, uPx: { value: this.aoA.width / (W / 2) } });
    // the circle of confusion in logical px, signed (behind the focus plane positive), in alpha
    this.coc = new FSPass(/* glsl */ `${DEPTH}
      uniform sampler2D tColor; uniform sampler2D tAO; uniform float uAO, uFocus, uFocal, uFstop, uWidth, uMaxCoc, uDof;
      void main(){
        vec3 c = texture(tColor, vUv).rgb * mix(1.0, texture(tAO, vUv).x, uAO);
        float z = -lz(texture(tDepth, vUv).x), f = uFocal * 0.001, A = f / uFstop;
        float coc = A * f * (z - uFocus) / (z * (uFocus - f));
        fragColor = uDof > 0.5 ? vec4(c, clamp(coc / 0.036 * uWidth, -uMaxCoc, uMaxCoc)) : vec4(c, 1.0);
      }`, { ...depthU(), tColor: { value: null }, tAO: { value: null }, uAO: { value: 0.75 }, uFocus: { value: 10 }, uFocal: { value: 35 }, uFstop: { value: 4 }, uWidth: { value: W }, uMaxCoc: { value: 22 }, uDof: { value: 1 } });
    this.tile = new FSPass(/* glsl */ `
      uniform sampler2D tCoc;
      void main(){
        ivec2 size = textureSize(tCoc, 0), p0 = ivec2(gl_FragCoord.xy) * ${TILE * PS};
        float m = 0.0;
        for (int y = 0; y < ${TILE * PS}; y++) for (int x = 0; x < ${TILE * PS}; x++)
          m = max(m, abs(texelFetch(tCoc, min(p0 + ivec2(x, y), size - 1), 0).a));
        fragColor = vec4(m, 0.0, 0.0, 1.0);
      }`, { tCoc: { value: null } });
    // gather along a golden-angle spiral; a sample counts where its own blur reaches this far, so sharp
    // things in front keep their edges and blurred ones don't pull them in. The spiral stops at the largest
    // blur within two tiles (32 logical px, past the largest blur allowed): further taps would add nothing.
    this.dof = new FSPass(/* glsl */ `
      uniform sampler2D tCoc; uniform sampler2D tTile; uniform vec2 uRes; uniform float uMaxCoc, uStep;
      void main(){
        ivec2 ts = textureSize(tTile, 0), tc = ivec2(floor(vUv * uRes / ${TILE}.0));
        float near = 0.0;
        for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++)
          near = max(near, texelFetch(tTile, clamp(tc + ivec2(x, y), ivec2(0), ts - 1), 0).r);
        float reach = min(uMaxCoc, near + 1.0);
        vec4 c0 = texture(tCoc, vUv); float centre = abs(c0.a);
        vec3 col = c0.rgb; float tot = 1.0, radius = uStep, ang = 0.0;
        for (int i = 0; i < ${taps}; i++){
          if (radius >= reach) break;
          ang += 2.39996323;
          vec4 s = texture(tCoc, vUv + vec2(cos(ang), sin(ang)) * radius / uRes);
          float size = abs(s.a); if (s.a > c0.a) size = clamp(size, 0.0, centre * 2.0);
          col += mix(col / tot, s.rgb, smoothstep(radius - 0.5, radius + 0.5, size)); tot += 1.0;
          radius += uStep / radius;
        }
        fragColor = vec4(col / tot, 1.0);
      }`, { tCoc: { value: null }, tTile: { value: null }, uRes: { value: new THREE.Vector2(W, H) }, uMaxCoc: { value: 22 }, uStep: { value: 0.55 } });
    this.passes = [this.ao, this.blur, this.coc, this.tile, this.dof];
  }

  /**
   * After the scene was drawn into `rt` with `cam` (its projection as drawn, jitter included): occlusion,
   * then the depth of field, into `out`, every pixel of it, opaque. `rot`: this sub-frame's kernel turn
   * (sampling.ts jitter().rot), 0 for a single sample.
   */
  finish(renderer: THREE.WebGLRenderer, cam: THREE.PerspectiveCamera, out: THREE.WebGLRenderTarget, lens: LensSettings, rot = 0) {
    for (const p of [this.ao, this.blur, this.coc]) {
      p.u.tDepth!.value = this.rt.depthTexture;
      (p.u.uProjInv!.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
      p.u.cameraNear!.value = cam.near; p.u.cameraFar!.value = cam.far;
    }
    const a = this.ao.u;
    (a.uRes!.value as THREE.Vector2).set(this.aoA.width, this.aoA.height);
    (a.uProj!.value as THREE.Matrix4).copy(cam.projectionMatrix);
    a.uRadius!.value = lens.aoRadius ?? 0.9;
    a.uRot!.value = rot;
    this.ao.render(renderer, this.aoA);
    const b = this.blur.u;
    (b.uRes!.value as THREE.Vector2).set(this.aoA.width, this.aoA.height);
    b.tAO!.value = this.aoA.texture; (b.uDir!.value as THREE.Vector2).set(1, 0); this.blur.render(renderer, this.aoB);
    b.tAO!.value = this.aoB.texture; (b.uDir!.value as THREE.Vector2).set(0, 1); this.blur.render(renderer, this.aoA);
    const dofOn = lens.dof !== false;
    const maxCoc = Math.min(MAX_BLUR, lens.maxBlur ?? 22 * (this.W / 1920));
    const c = this.coc.u;
    c.tColor!.value = this.rt.texture; c.tAO!.value = this.aoA.texture; c.uAO!.value = lens.ao ?? 0.75;
    c.uFocus!.value = Math.max(lens.focus, lens.focal * 0.001 * 1.01); c.uFocal!.value = lens.focal; c.uFstop!.value = lens.fstop;
    c.uWidth!.value = this.W; c.uMaxCoc!.value = maxCoc; c.uDof!.value = dofOn ? 1 : 0;
    this.coc.render(renderer, dofOn ? this.cocRT : out);
    if (!dofOn) return;
    this.tile.u.tCoc!.value = this.cocRT.texture;
    this.tile.render(renderer, this.tileRT);
    this.dof.u.tCoc!.value = this.cocRT.texture;
    this.dof.u.tTile!.value = this.tileRT.texture;
    (this.dof.u.uRes!.value as THREE.Vector2).set(this.W, this.H);
    this.dof.u.uMaxCoc!.value = maxCoc;
    this.dof.u.uStep!.value = this.dofStep;
    this.dof.render(renderer, out);
  }

  /** Release the passes' materials, and the targets once no Lens of this size holds them (the engine's shared quad stays). */
  dispose() {
    if (this.targets) release(this.W, this.H, this.targets);
    this.targets = null;
    for (const p of this.passes) p.mat.dispose();
  }
}
