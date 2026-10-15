// A physically based sky and the light captured from it. The sky is single scattering in the style of Nishita
// (Rayleigh, Mie and ozone, 20 steps along the view and 8 toward the sun), a cloud layer lit through the same
// air, and an HDR sun disc; it follows whichever camera draws it (cube captures and mirrors too). captureEnv()
// turns a scene seen from a point into three's PMREM environment light: first the sky alone, then the built
// scene lit by it, which already holds one bounce. Adapted from golden-temple's src/core/sky.js and
// src/core/lighting.js (MIT, Leon Lin: see LICENSE).
import * as THREE from 'three';
import { NOISE } from './noise';
import type { Env } from './env';
import { withRenderer } from './light';

const SKY_GLSL = /* glsl */ `
${NOISE}
const float Re = 6360e3; const float Ra = 6420e3;
const vec3 bR = vec3(5.802e-6, 13.558e-6, 33.1e-6); const vec3 bO = vec3(0.650e-6, 1.881e-6, 0.085e-6);
const float bM = 11e-6; const float Hr = 7994.0; const float Hm = 1200.0; const float gM = 0.78;
uniform float uCloudCover; uniform float uCloudScale; uniform vec2 uCloudOffset;
vec2 raySphere(vec3 ro, vec3 rd, float r){ float b = dot(ro, rd); float c = dot(ro, ro) - r * r; float d = b * b - c;
  if (d < 0.0) return vec2(-1.0); d = sqrt(d); return vec2(-b - d, -b + d); }
vec3 sunTransmittance(vec3 p, vec3 sun){
  vec2 t = raySphere(p, sun, Ra); float L = max(t.y, 0.0); float odR = 0.0, odM = 0.0;
  for (int j = 0; j < 8; j++){ float s = (float(j) + 0.5) / 8.0; float tt = L * s * s; float dt = L * 2.0 * s / 8.0;
    float h = length(p + sun * tt) - Re; if (h < -50.0) return vec3(0.0); h = max(h, 0.0);
    odR += exp(-h / Hr) * dt; odM += exp(-h / Hm) * dt; }
  return exp(-(bR * odR + bO * odR * 2.0 + bM * 1.1 * odM));
}
vec3 atmosphere(vec3 dir, vec3 sun, float sunI){
  vec3 ro = vec3(0.0, Re + 60.0, 0.0); vec2 t = raySphere(ro, dir, Ra); float L = t.y;
  vec2 tg = raySphere(ro, dir, Re); if (tg.x > 0.0) L = tg.x;
  vec3 sumR = vec3(0.0), sumM = vec3(0.0); float odR = 0.0, odM = 0.0;
  for (int i = 0; i < 20; i++){ float s = (float(i) + 0.5) / 20.0; float tt = L * s * s; float dt = L * 2.0 * s / 20.0;
    vec3 p = ro + dir * tt; float h = max(length(p) - Re, 0.0); float hr = exp(-h / Hr) * dt; float hm = exp(-h / Hm) * dt;
    odR += hr; odM += hm; vec3 att = sunTransmittance(p, sun) * exp(-(bR * odR + bO * odR * 2.0 + bM * 1.1 * odM));
    sumR += att * hr; sumM += att * hm; }
  float mu = dot(dir, sun); float pR = 3.0 / (16.0 * 3.14159265) * (1.0 + mu * mu); float g2 = gM * gM;
  float pM = 3.0 / (8.0 * 3.14159265) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * gM * mu, 1.5));
  return sunI * (sumR * bR * pR + sumM * bM * pM);
}
// altocumulus: patches of puffy cells (p in km on a layer 2.6 km up)
float cloudDensity(vec2 p){
  vec2 q = p * uCloudScale;
  float cov = smoothstep(1.0 - uCloudCover - 0.12, 1.0 - uCloudCover + 0.28, n_fbm(q * vec2(0.16, 0.28) + 2.0, 4) * 0.5 + 0.5);
  vec2 w = vec2(n_snoise(q * 0.8 + 5.2), n_snoise(q * 0.8 + 1.3)) * 0.22;
  float puff = (1.0 - n_worley(q * 2.4 + w * 2.0).x * 1.2) * 0.72 + (1.0 - n_worley(q * 6.3 + w * 5.0 + 9.0).x) * 0.38;
  return clamp((cov * (puff + n_fbm(q * 11.0 + w * 4.0, 2) * 0.12) - 0.36) * 2.6, 0.0, 1.0);
}
vec3 skyColor(vec3 dir, vec3 sun, float sunI, float disc){
  vec3 d = dir; float below = 1.0 - smoothstep(-0.08, 0.0, d.y); d.y = max(d.y, 0.0005); d = normalize(d);
  vec3 col = atmosphere(d, sun, sunI);
  vec3 sunCol = sunTransmittance(vec3(0.0, Re + 60.0, 0.0), sun);
  float ang = acos(clamp(dot(d, sun), -1.0, 1.0)); float R = 0.0095;
  if (disc > 0.0) { // the disc with limb darkening, and a tight corona
    float m = 1.0 - smoothstep(R * 0.92, R, ang); float r = clamp(ang / R, 0.0, 1.0);
    col += sunCol * m * (1.0 - 0.6 * (1.0 - sqrt(max(1.0 - r * r, 0.0)))) * sunI * 700.0 * disc;
    col += sunCol * sunI * 0.9 * exp(-ang * 60.0) * disc;
  }
  if (dir.y > 0.003 && uCloudCover > 0.0) {
    float tc = 2600.0 / d.y; vec2 cp = (d.xz * tc) / 1000.0 + uCloudOffset; float den = cloudDensity(cp);
    if (den > 0.001) {
      vec2 sd = normalize(sun.xz + 1e-5); // self-shadowing: a few steps toward the sun through the layer
      float od = cloudDensity(cp + sd * 0.06) * 0.6 + cloudDensity(cp + sd * 0.16) + cloudDensity(cp + sd * 0.34) + cloudDensity(cp + sd * 0.65) * 0.8;
      float shadow = exp(-od * 1.15);
      vec3 sunAtCloud = sunTransmittance(vec3(0.0, Re + 2600.0, 0.0), sun) * vec3(1.0, 0.84, 0.64);
      float mu = dot(d, sun);
      float hg1 = (1.0 - 0.4225) / pow(1.0 + 0.4225 - 1.3 * mu, 1.5), hg2 = (1.0 - 0.04) / pow(1.0 + 0.04 + 0.4 * mu, 1.5);
      vec3 lit = sunAtCloud * sunI * 0.16 * (mix(hg2, hg1, 0.5) / 12.566 * 7.0 + 0.3) * (shadow * 0.9 + 0.1) * (0.4 + 0.6 * (1.0 - exp(-den * 3.0)));
      lit += sunAtCloud * sunI * 0.1 * pow(max(mu, 0.0), 10.0) * (1.0 - den) * 3.0; // silver lining
      vec3 amb = atmosphere(vec3(0.0, 1.0, 0.0), sun, sunI) * 0.95 + col * 0.2;
      vec3 ccol = mix(col, lit + amb * (0.35 + 0.5 * (1.0 - den)), exp(-tc / 52000.0));
      col = mix(col, ccol, smoothstep(0.0, 0.55, den) * smoothstep(0.003, 0.06, d.y));
    }
  }
  return mix(col, col * 0.55, below);
}`;

export interface Sky {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  /** Shared uniforms: uDisc (0 hides the sun disc), uCloudCover (0..1, 0 none), uCloudScale, uCloudOffset (km: drift it from t). */
  uniforms: Record<string, THREE.IUniform>;
  dispose(): void;
}

/** The sky dome for `env`. Add `sky.mesh` to the scene; it draws after the opaque objects, only where none is. */
export function createSky(env: Env, o: { clouds?: number } = {}): Sky {
  const uniforms: Record<string, THREE.IUniform> = {
    uSunDir: { value: env.sunDir.clone() }, uSunI: { value: env.skyIntensity }, uDisc: { value: 1 },
    uCloudCover: { value: o.clouds ?? 0.5 }, uCloudScale: { value: 1 }, uCloudOffset: { value: new THREE.Vector2() },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `varying vec3 vDir;
      void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w * 0.99999; }`,
    fragmentShader: /* glsl */ `uniform vec3 uSunDir; uniform float uSunI, uDisc; varying vec3 vDir; ${SKY_GLSL}
      void main(){ gl_FragColor = vec4(skyColor(normalize(vDir), normalize(uSunDir), uSunI, uDisc), 1.0); }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(4800, 64, 32), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1000;
  // centred on the camera's world position (a CubeCamera's face cameras sit at 0 inside their parent)
  const at = new THREE.Vector3();
  mesh.onBeforeRender = (_r, _s, cam) => {
    cam.getWorldPosition(at);
    if (mesh.parent) mesh.parent.worldToLocal(at);
    mesh.position.copy(at);
    mesh.updateMatrixWorld();
  };
  return { mesh, uniforms, dispose: () => { mesh.geometry.dispose(); mat.dispose(); } };
}

/** The sky of `env` alone as a PMREM environment (the first capture; the caller owns the target). */
export function captureSkyEnv(renderer: THREE.WebGLRenderer, env: Env, o: { clouds?: number } = {}) {
  const sky = createSky(env, o), scene = new THREE.Scene();
  scene.add(sky.mesh);
  try { return captureEnv(renderer, scene, new THREE.Vector3(0, 2, 0), { skies: [sky] }); } finally { sky.dispose(); }
}

/**
 * The scene seen from `pos`, as a PMREM environment: `scene.environment = target.texture`. The caller owns
 * the returned target (dispose it when replacing or retiring the environment). `skies` have their sun disc
 * hidden meanwhile: the sun already lights the scene as a DirectionalLight, and counted again in the
 * environment it would light everything twice. Shadow maps are on during the capture, and every renderer
 * setting it touches is restored, also if it throws.
 */
export function captureEnv(renderer: THREE.WebGLRenderer, scene: THREE.Scene, pos: THREE.Vector3, o: { skies?: Sky[]; size?: number } = {}) {
  const cube = new THREE.WebGLCubeRenderTarget(o.size ?? 256, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cam = new THREE.CubeCamera(0.1, 6000, cube);
  cam.position.copy(pos);
  const discs = (o.skies ?? []).map((s) => [s, s.uniforms.uDisc!.value as number] as const);
  const pm = new THREE.PMREMGenerator(renderer);
  try {
    for (const [s] of discs) s.uniforms.uDisc!.value = 0;
    withRenderer(renderer, { shadows: true, autoClear: true }, () => cam.update(renderer, scene));
    return withRenderer(renderer, {}, () => pm.fromCubemap(cube.texture));
  } finally {
    for (const [s, v] of discs) s.uniforms.uDisc!.value = v;
    pm.dispose();
    cube.dispose();
  }
}
