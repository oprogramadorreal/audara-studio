// One scene's light and air: where the sun is, its colour and strength, the sky's brightness and the haze.
// Materials (materials.ts), the sky (sky.ts) and the sun (light.ts) all read the same Env, so they agree,
// which is most of why golden-temple's frames hold together. The defaults are its golden hour (a sun 6.8°
// up, about 3300 K at the ground, metres as units): example choices, not rules. Make one per look.
import * as THREE from 'three';

export interface Haze {
  /** Scale height of the ground haze, m (it thins with height above y = 0). */
  height: number;
  /** Extinction per metre at y = 0, inside the haze layer. */
  ground: number;
  /** Extinction per metre everywhere: the long-distance blue of far hills. */
  air: number;
  /** The haze's colour away from the sun (linear RGB). */
  color: [number, number, number];
  /** The forward-scattered glow toward the sun: its colour (linear RGB) and strength. */
  glow: [number, number, number];
  glowStrength: number;
  /** Mie anisotropy of that glow (0 even, toward 1 tighter around the sun). */
  g: number;
}

export interface Env {
  /** Unit vector toward the sun (world space, +Y up). */
  sunDir: THREE.Vector3;
  /** Direct sunlight at the ground: colour (linear) and DirectionalLight intensity. */
  sunColor: THREE.Color;
  sunIntensity: number;
  /** The sky shader's sun radiance scale: the sky's brightness, and so the environment light's. */
  skyIntensity: number;
  /** Angular radius of the sun disc the shadow jitter spreads over, in radians (sampling.ts). */
  sunRadius: number;
  haze: Haze;
}

/** Toward the sun from an elevation and an azimuth in degrees (azimuth 0 = toward -Z, 90 = toward +X). */
export function sunFrom(elevationDeg: number, azimuthDeg: number) {
  const e = (elevationDeg * Math.PI) / 180, a = (azimuthDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize();
}

export function makeEnv(o: Partial<Omit<Env, 'haze'>> & { haze?: Partial<Haze> } = {}): Env {
  return {
    sunDir: (o.sunDir ?? sunFrom(6.8, -110)).clone().normalize(),
    sunColor: (o.sunColor ?? new THREE.Color().setRGB(1.0, 0.7, 0.43, THREE.LinearSRGBColorSpace)).clone(),
    sunIntensity: o.sunIntensity ?? 7,
    skyIntensity: o.skyIntensity ?? 20,
    sunRadius: o.sunRadius ?? 0.0065,
    haze: {
      height: 22, ground: 0.0013, air: 0.00022,
      color: [0.32, 0.35, 0.44], glow: [1.0, 0.62, 0.3], glowStrength: 0.9, g: 0.78,
      ...o.haze,
    },
  };
}

const f = (x: number) => x.toFixed(6);
const v3 = (a: ArrayLike<number>) => `vec3(${f(a[0]!)}, ${f(a[1]!)}, ${f(a[2]!)})`;

/**
 * GLSL `vec3 applyAerial(vec3 col, vec3 wpos, vec3 camPos)`: exponential height fog plus thin air, bluer
 * away from the sun and glowing toward it, from golden-temple's src/core/fog.js. The Env's values are baked
 * in as constants (a material made for one Env keeps it). materials.ts runs it inside every patched
 * material; a ShaderMaterial of your own (water, a backdrop) can include it too, so everything hazes alike.
 */
export function aerialGLSL(env: Env) {
  const h = env.haze;
  return /* glsl */ `
vec3 applyAerial(vec3 col, vec3 wpos, vec3 camPos){
  const vec3 SUN = ${v3(env.sunDir.toArray())};
  const float H = ${f(h.height)}, D0 = ${f(h.ground)}, DA = ${f(h.air)}, G = ${f(h.g)};
  vec3 V = wpos - camPos; float dist = length(V); vec3 dir = V / max(dist, 1e-4);
  float y0 = camPos.y, dy = V.y;
  // the haze's density integrated along the ray (it falls off with height)
  float hfac = abs(dy) > 0.01 ? (exp(-max(y0, -5.0) / H) - exp(-max(y0 + dy, -5.0) / H)) * H / dy : exp(-max(y0, -5.0) / H);
  float T = exp(-(D0 * hfac + DA) * dist);
  float mu = dot(dir, SUN);
  float hg = (1.0 - G * G) / pow(1.0 + G * G - 2.0 * G * mu, 1.5) / 12.566;
  float toward = pow(max(mu, 0.0) * 0.5 + 0.5, 3.0);
  vec3 amb = mix(${v3(h.color)}, ${v3(h.color)} * vec3(1.55, 1.12, 0.72), toward);
  // the glow is capped so a backlit silhouette keeps its outline
  vec3 inscatter = amb + ${v3(h.glow)} * ${f(h.glowStrength)} * min(hg * 4.0, 1.6) * (0.55 + 0.45 * smoothstep(300.0, 3000.0, dist));
  return col * T + inscatter * (1.0 - T);
}`;
}
