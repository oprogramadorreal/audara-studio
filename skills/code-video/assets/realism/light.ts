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
   * inside the solar disc in radians (sampling.ts jitter().sun), or null for the disc's centre.
   */
  fit(center: THREE.Vector3, radius: number, jitter: [number, number] | null = null) {
    const d = this.env.sunDir.clone();
    if (jitter) {
      const right = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(right, d).normalize();
      d.addScaledVector(right, jitter[0]).addScaledVector(up, jitter[1]).normalize();
    }
    const l = this.light;
    l.position.copy(center).addScaledVector(d, 400);
    l.target.position.copy(center);
    l.target.updateMatrixWorld();
    const c = l.shadow.camera;
    c.left = -radius; c.right = radius; c.top = radius; c.bottom = -radius;
    c.near = Math.max(1, 400 - radius * 1.6); c.far = 400 + radius * 1.6;
    c.updateProjectionMatrix();
    l.shadow.needsUpdate = true;
  }

  dispose() { this.light.shadow.dispose(); this.light.dispose(); }
}
