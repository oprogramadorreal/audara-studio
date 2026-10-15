// The sun and the renderer settings its shadows need. One DirectionalLight whose shadow frustum is fitted around
// what the shot shows (golden-temple fits it per shot: with an 8192² map over 22 m a texel is 5 mm), and whose
// direction moves inside the solar disc from one sub-frame to the next, so penumbrae widen with distance from
// the occluder as under the real sun. Adapted from golden-temple's src/core/lighting.js (MIT, Leon Lin: see
// LICENSE).
//
// The renderer is shared by every scene and by the engine: a scene that draws with shadows turns them on
// around its own draws and puts everything back after, even when a draw throws (the engine catches a scene's
// error and keeps rendering the others). withRenderer() does that. Keep one shadow type in a project: three
// rebuilds every shadowed material when the type changes, so this kit uses PCF, as the engine's default does.
import * as THREE from 'three';
import type { Env } from './env';

/**
 * Run `draw` with these renderer settings, then restore every one it touched, and the render target (with its
 * cube face and mip level), whatever happens. `shadows`: shadow maps on, PCF, updated on this draw (a project
 * that set `shadowMap.autoUpdate = false` would otherwise skip them). `autoClear`: three's own clears (cube
 * captures need them; the engine keeps them off).
 */
export function withRenderer<T>(r: THREE.WebGLRenderer, o: { shadows?: boolean; autoClear?: boolean }, draw: () => T): T {
  const sm = r.shadowMap;
  const saved = { enabled: sm.enabled, type: sm.type, autoUpdate: sm.autoUpdate, needsUpdate: sm.needsUpdate, autoClear: r.autoClear,
    target: r.getRenderTarget(), face: r.getActiveCubeFace(), mip: r.getActiveMipmapLevel() };
  try {
    if (o.shadows) { sm.enabled = true; sm.type = THREE.PCFShadowMap; sm.autoUpdate = true; sm.needsUpdate = true; }
    if (o.autoClear !== undefined) r.autoClear = o.autoClear;
    return draw();
  } finally {
    sm.enabled = saved.enabled; sm.type = saved.type; sm.autoUpdate = saved.autoUpdate; sm.needsUpdate = saved.needsUpdate;
    r.autoClear = saved.autoClear;
    r.setRenderTarget(saved.target, saved.face, saved.mip);
  }
}

// The shadow maps kept: those of the two Suns fitted last. Every entry's scene is built when the page opens,
// and a 4096² map is about 128 MB (three gives it a colour and a depth texture), so a video of many kit shots
// would otherwise hold one per shot. Two cover a crossfade; a Sun pushed out drops its map, and three
// allocates a new one at its next shadowed draw (three 0.186 does when the map is null, as when the shadow
// type changes).
const KEEP_MAPS = 2;
const RECENT: Sun[] = [];

function dropMap(l: THREE.DirectionalLight) {
  const m = l.shadow.map;
  if (!m) return;
  m.depthTexture?.dispose();
  m.depthTexture = null;
  m.dispose();
  l.shadow.map = null;
}

/** The two axes across the light (the shadow camera's own, up to their sign: three aims it with +Y up). */
function across(d: THREE.Vector3) {
  const right = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0));
  if (right.lengthSq() < 1e-12) right.set(1, 0, 0); // (a sun straight overhead)
  right.normalize();
  return { right, up: new THREE.Vector3().crossVectors(right, d).normalize() };
}

export class Sun {
  readonly light: THREE.DirectionalLight;
  /** `mapSize`: the shadow map's side (4096 is plenty for a 15 m region; the preview path may use less). */
  constructor(private env: Env, o: { mapSize?: number } = {}) {
    const l = (this.light = new THREE.DirectionalLight(env.sunColor, env.sunIntensity));
    l.castShadow = true;
    const s = o.mapSize ?? 4096;
    l.shadow.mapSize.set(s, s);
    l.shadow.bias = -0.00015;
    l.shadow.normalBias = 0.025;
    l.shadow.radius = 1; // the softness comes from the disc jitter, not the filter
  }

  /** Add the light and its target to a scene. */
  addTo(scene: THREE.Scene) { scene.add(this.light, this.light.target); return this; }

  /**
   * Aim at `center` with the shadow frustum fitted around a sphere of `radius` (m): spend the map where the
   * camera looks, the smallest radius that holds what casts and receives in the shot. `jitter`: an offset
   * inside the solar disc in radians (sampling.ts jitter().sun), or null for the disc's centre. Call it
   * before every shadowed draw, as the example does (in each render(), and before an environment capture):
   * it also marks the map in use, and the maps of Suns not fitted lately are released.
   */
  fit(center: THREE.Vector3, radius: number, jitter: [number, number] | null = null) {
    const i = RECENT.indexOf(this);
    if (i !== 0) {
      if (i > 0) RECENT.splice(i, 1);
      RECENT.unshift(this);
      for (const old of RECENT.splice(KEEP_MAPS)) dropMap(old.light);
    }
    const d = this.env.sunDir.clone();
    if (jitter) {
      const a = across(d);
      d.addScaledVector(a.right, jitter[0]).addScaledVector(a.up, jitter[1]).normalize();
    }
    // the centre on whole texels across the light, on a grid fixed in the world: a frustum that follows the
    // shot would otherwise slide the map's texels over still surfaces, and their shadow edges would swim
    const { right, up } = across(d), texel = (2 * radius) / this.light.shadow.mapSize.x;
    const snap = (v: number) => Math.round(v / texel) * texel - v;
    const c = center.clone();
    c.addScaledVector(right, snap(c.dot(right))).addScaledVector(up, snap(c.dot(up)));
    const l = this.light;
    l.position.copy(c).addScaledVector(d, 400);
    l.target.position.copy(c);
    l.target.updateMatrixWorld();
    const cam = l.shadow.camera;
    cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius;
    cam.near = Math.max(1, 400 - radius * 1.6); cam.far = 400 + radius * 1.6;
    cam.updateProjectionMatrix();
    l.shadow.needsUpdate = true;
  }

  dispose() {
    const i = RECENT.indexOf(this);
    if (i >= 0) RECENT.splice(i, 1);
    this.light.shadow.dispose();
    this.light.dispose();
  }
}
