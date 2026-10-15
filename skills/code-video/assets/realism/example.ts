// An example scene that uses the whole kit: a small temple garden at golden hour, one shot in golden-temple's
// grammar, a macro on a gilt finial pulling back to reveal the gate. Play it from any video's timeline:
//   E('garden', '../../../src/realism/example', start, end)
// then copy it into videos/<video>/scenes/ as a starting point (the imports then become ../../../src/...).
// What it shows, in the order that matters: modelled detail where the lens is (the finial; the hills are
// deliberately rough, and read as CG in the wide frame), one Env for the sky, the sun, the environment light
// and the haze, procedural surfaces in three's PBR materials, the lens, and samples spread over sub-frames.
// It sets no post-processing of its own: grain, vignette or exposure belong to src/look.ts or the timeline
// entry, since the engine applies them to the whole frame, a crossfade partner included.
import * as THREE from 'three';
import { Scene, type Frame } from '../engine/scene';
import { clearRT } from '../engine/gl';
import { clamp } from '../engine/util';
import { makeEnv, sunFrom, type Env } from './env';
import { PROC, patch, type Hooks } from './materials';
import { captureEnv, captureSkyEnv, createSky, type Sky } from './sky';
import { Sun, withRenderer } from './light';
import { Lens } from './lens';
import { jitter, jitterCamera } from './sampling';
import { applyLens, lensAt, linearKeys, reveal, type LensKey } from './camera';

/** Seeded value noise for shaping geometry in init() (deterministic: no Math.random). */
function vnoise(x: number, y: number, seed: number) {
  const h = (i: number, j: number) => { let n = (i * 374761393 + j * 668265263 + seed * 2246822519) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967295; };
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return (h(i, j) * (1 - ux) + h(i + 1, j) * ux) * (1 - uy) + (h(i, j + 1) * (1 - ux) + h(i + 1, j + 1) * ux) * uy;
}
const fbm = (x: number, y: number, o: number, seed = 0) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * vnoise(x * f, y * f, seed + i); f *= 2.03; a *= 0.5; } return s; };

/** Raked gravel with moss islands: this scene's own surface, written like the kit's PROC ones. */
const GROUND: Hooks = {
  fragHead: `float g_h; float g_moss;`,
  fragColor: /* glsl */ `{
    vec2 p = vWPos.xz;
    vec2 c = n_worley(p * 9.0);
    float pebble = smoothstep(0.0, 0.5, c.y - c.x) * n_aa(0.06);
    float rake = (sin(p.y * 22.0 + n_fbm(p * 0.4, 2) * 2.0) * 0.5 + 0.5) * n_aa(0.29);
    vec3 col = vec3(0.50, 0.47, 0.42) * (0.75 + 0.3 * pebble) * (0.92 + 0.08 * rake);
    g_moss = smoothstep(0.55, 0.7, n_fbm(p * 0.35 + 3.0, 4) * 0.5 + 0.5);
    col = mix(col, mix(vec3(0.05, 0.08, 0.015), vec3(0.13, 0.17, 0.035), n_fbm(p * 3.0, 3) * 0.5 + 0.5), g_moss);
    diffuseColor.rgb *= col;
    g_h = mix(pebble * 0.6 + rake * 0.4, n_fbm(p * 6.0, 3) * 0.5, g_moss);
  }`,
  fragRough: `roughnessFactor = mix(0.85, 0.95, g_moss);`,
  fragNormal: `normal = n_bumpView(-vViewPosition, normal, g_h, 0.006);`,
};
const HILLS: Hooks = {
  fragColor: /* glsl */ `{
    float n = n_fbm(vWPos.xz * 0.02, 4);
    diffuseColor.rgb *= mix(vec3(0.025, 0.05, 0.02), vec3(0.06, 0.09, 0.03), n * 0.5 + 0.5);
  }`,
};

export default class Garden extends Scene {
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(40, this.ctx.W / this.ctx.H, 0.04, 6000);
  private env: Env = makeEnv({ sunDir: sunFrom(7, -80) });
  private sun = new Sun(this.env, { mapSize: this.ctx.export ? 4096 : 2048 }); // (a smaller map: the preview's cost, not its content)
  private sky!: Sky;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private lens = new Lens(this.ctx.W, this.ctx.H, { aoSamples: this.ctx.export ? 16 : 10 });
  private keys: LensKey[] = [];

  override init() {
    const { renderer: r, start, end } = this.ctx, S = this.scene, env = this.env;
    // the shot: a 45 mm macro at f/2.8 focused on the finial 0.74 m away, pulling back to a 24 mm wide at f/5.6
    this.keys = [
      { t: start, pos: [0.98, 1.36, 0.62], look: [0.6, 1.31, 0.0], focal: 45, focus: 0.74, fstop: 2.8 },
      { t: end, pos: [0.25, 1.65, 5.2], look: [0.0, 3.2, -8.0], focal: 24, focus: 13, fstop: 5.6 },
    ];
    const white = 0xffffff;
    const M = {
      lacquer: patch(new THREE.MeshPhysicalMaterial({ color: white, roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.4 }), PROC.lacquer(), env),
      black: patch(new THREE.MeshPhysicalMaterial({ color: new THREE.Color().setRGB(0.018, 0.016, 0.014, THREE.LinearSRGBColorSpace), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12 }), {}, env),
      gold: patch(new THREE.MeshStandardMaterial({ color: white, roughness: 0.22, metalness: 1 }), PROC.gold(), env),
      granite: patch(new THREE.MeshStandardMaterial({ color: white, roughness: 0.8 }), PROC.granite(0.7), env),
      ground: patch(new THREE.MeshStandardMaterial({ color: white, roughness: 0.9 }), GROUND, env),
      hills: patch(new THREE.MeshStandardMaterial({ color: white, roughness: 0.95 }), HILLS, env),
    };
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, cast = true) => {
      const o = new THREE.Mesh(g, m);
      o.position.set(x, y, z); o.castShadow = cast; o.receiveShadow = true;
      S.add(o);
      return o;
    };
    // the gate: columns on granite bases, a vermilion tie beam, a black capping beam with upturned ends
    for (const x of [-2.3, 2.3]) {
      add(new THREE.BoxGeometry(1.0, 0.5, 1.0), M.granite, x, 0.25, -8);
      add(new THREE.CylinderGeometry(0.27, 0.3, 4.85, 64), M.lacquer, x, 2.925, -8);
      add(new THREE.CylinderGeometry(0.33, 0.33, 0.12, 48), M.black, x, 0.56, -8);
    }
    add(new THREE.BoxGeometry(5.8, 0.34, 0.3), M.lacquer, 0, 4.35, -8);
    add(new THREE.BoxGeometry(6.6, 0.22, 0.42), M.lacquer, 0, 5.18, -8);
    const cap = new THREE.BoxGeometry(7.4, 0.36, 0.55, 64, 1, 1), cp = cap.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < cp.count; i++) cp.setY(i, cp.getY(i) + 0.18 * (cp.getX(i) / 3.7) ** 4);
    cap.computeVertexNormals();
    add(cap, M.black, 0, 5.45, -8);
    // the hero: two railing posts with gilt finials (an onion on a neck, on a collar), a smooth lathe profile
    const profile: [number, number][] = [[0, 0], [0.105, 0], [0.105, 0.03], [0.09, 0.035], [0.088, 0.06], [0.1, 0.07], [0.1, 0.085], [0.06, 0.1],
      [0.055, 0.12], [0.075, 0.14], [0.098, 0.17], [0.105, 0.2], [0.096, 0.235], [0.07, 0.27], [0.04, 0.3], [0.018, 0.33], [0.01, 0.36], [0, 0.375]];
    const lathe = new THREE.SplineCurve(profile.map(([rr, y]) => new THREE.Vector2(rr, y))).getSpacedPoints(160);
    for (const x of [0.6, -0.6]) {
      add(new THREE.BoxGeometry(0.16, 1.1, 0.16), M.lacquer, x, 0.55, 0);
      add(new THREE.LatheGeometry(lathe, 128), M.gold, x, 1.1, 0);
    }
    // stepping stones: flattened, lumpy icosahedra
    for (let i = 0; i < 7; i++) {
      const g = new THREE.IcosahedronGeometry(0.5, 4), p = g.attributes.position as THREE.BufferAttribute, v = new THREE.Vector3();
      for (let k = 0; k < p.count; k++) {
        v.fromBufferAttribute(p, k).multiplyScalar(0.82 + 0.35 * fbm(v.x * 2 + i * 7.3, v.z * 2 + v.y, 4, i));
        p.setXYZ(k, v.x * 1.1, v.y * 0.32, v.z * 0.85);
      }
      g.computeVertexNormals();
      add(g, M.granite, Math.sin(i * 1.7) * 0.35, 0.05, 2.5 - i * 1.45).rotation.y = i * 0.9;
    }
    // the ground, and hills far behind (rough on purpose: see the header)
    const ground = new THREE.PlaneGeometry(160, 160, 160, 160).rotateX(-Math.PI / 2), gp = ground.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < gp.count; i++) gp.setY(i, 0.04 * (fbm(gp.getX(i) * 0.5, gp.getZ(i) * 0.5, 3) - 0.5));
    ground.computeVertexNormals();
    add(ground, M.ground, 0, 0, 0, false);
    const hills = new THREE.PlaneGeometry(1600, 900, 320, 180).rotateX(-Math.PI / 2), hp = hills.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < hp.count; i++) {
      const x = hp.getX(i), z = hp.getZ(i) - 520;
      hp.setXYZ(i, x, Math.min(1, Math.max(0, -z - 60) / 260) * (40 + 150 * fbm(x * 0.004, z * 0.004, 6, 3)) - 2, z);
    }
    hills.computeVertexNormals();
    add(hills, M.hills, 0, 0, 0, false);

    // light: the sun, the sky, then the environment light, from the sky first and then from the built scene
    this.sun.addTo(S);
    this.sun.fit(new THREE.Vector3(0, 1, -3), 14);
    this.sky = createSky(env);
    S.add(this.sky.mesh);
    const skyEnv = captureSkyEnv(r, env);
    S.environment = skyEnv.texture;
    try {
      this.envTarget = captureEnv(r, S, new THREE.Vector3(0, 1.6, 2), { skies: [this.sky] });
      S.environment = this.envTarget.texture;
    } finally {
      skyEnv.dispose();
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const { renderer: r, start, end } = this.ctx;
    // the move: golden-temple's reveal over the entry's window
    const pose = lensAt(start + reveal(clamp((f.t - start) / (end - start))) * (end - start), this.keys, linearKeys);
    applyLens(this.cam, pose);
    const j = jitter(this.env.sunRadius); // null in the preview and in one-sample stills
    if (j) jitterCamera(this.cam, this.lens.rt, j.aa);
    // the shadow map over what the shot shows, the sun moved inside its disc for this sub-frame
    this.sun.fit(new THREE.Vector3(pose.look.x * 0.15, 1, -3), 14, j?.sun ?? null);
    withRenderer(r, { shadows: true }, () => {
      clearRT(r, this.lens.rt, [0, 0, 0]);
      r.setRenderTarget(this.lens.rt);
      r.render(this.scene, this.cam);
    });
    this.lens.finish(r, this.cam, out, { focal: pose.focal, focus: pose.focus, fstop: pose.fstop }, j?.rot ?? 0);
  }

  override dispose() {
    this.lens.dispose();
    this.sun.dispose();
    this.sky?.dispose();
    this.envTarget?.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh && o !== this.sky?.mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    });
  }
}
