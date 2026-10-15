// A camera that moves like a real one through lens keys. From golden-temple's src/shots.js (MIT, Leon Lin:
// see LICENSE): the orientation is interpolated as a direction, not a look-at point, and the look distance and
// the focus distance in log space, so a close-up looking at something 1 m away and a wide shot looking 40 m
// away turn into each other smoothly, and a lens can rack focus and zoom during the move. The keys' times come
// from the data, like every time in a video (beats, words, the entry's window). Each channel goes through
// util.ts smoothKeys by default: speed carries through the keys instead of stopping at each.
import * as THREE from 'three';
import { smoothKeys, smoothstep } from '../engine/util';
import { focalToFov } from './lens';

export interface LensKey {
  /** Video time, s. */
  t: number;
  /** Camera position and the point it looks at, m. */
  pos: [number, number, number];
  look: [number, number, number];
  /** mm on a 36 mm-wide sensor (default 35). */
  focal?: number;
  /** m (default: the distance to `look`). */
  focus?: number;
  /** f-stop (default 8). */
  fstop?: number;
  /** Roll about the view axis, radians (default 0). */
  roll?: number;
}

export interface LensPose { pos: THREE.Vector3; look: THREE.Vector3; focal: number; focus: number; fstop: number; roll: number }

type Interp = (t: number, ks: [number, number][]) => number;

/**
 * golden-temple's 'reveal' ease over 0..1: lingers on the close-up, accelerates into the move, lands softly.
 * Remap time with it and interpolate linearly: lensAt(start + reveal(p) * (end - start), keys, linearKeys).
 */
export const reveal = (u: number) => Math.pow(smoothstep(0, 1, u), 1.35);

/** Straight lines between keys (for a time already eased, as with reveal). */
export const linearKeys: Interp = (t, ks) => {
  if (t <= ks[0]![0]) return ks[0]![1];
  for (let i = 1; i < ks.length; i++) if (t <= ks[i]![0]) {
    const [t0, v0] = ks[i - 1]!, [t1, v1] = ks[i]!;
    return v0 + (v1 - v0) * ((t - t0) / Math.max(1e-9, t1 - t0));
  }
  return ks[ks.length - 1]![1];
};

/** The camera at time t through `keys` (in time order). */
export function lensAt(t: number, keys: LensKey[], interp: Interp = smoothKeys): LensPose {
  const ch = (f: (k: LensKey) => number) => interp(t, keys.map((k) => [k.t, f(k)] as [number, number]));
  const dirs = keys.map((k) => new THREE.Vector3(k.look[0] - k.pos[0], k.look[1] - k.pos[1], k.look[2] - k.pos[2]));
  const dist = dirs.map((d) => Math.max(d.length(), 0.01));
  dirs.forEach((d) => d.normalize());
  const at = (k: LensKey) => keys.indexOf(k);
  const pos = new THREE.Vector3(ch((k) => k.pos[0]), ch((k) => k.pos[1]), ch((k) => k.pos[2]));
  const dir = new THREE.Vector3(ch((k) => dirs[at(k)]!.x), ch((k) => dirs[at(k)]!.y), ch((k) => dirs[at(k)]!.z)).normalize();
  const look = pos.clone().addScaledVector(dir, Math.exp(ch((k) => Math.log(dist[at(k)]!))));
  return {
    pos, look,
    focal: ch((k) => k.focal ?? 35),
    focus: Math.exp(ch((k) => Math.log(k.focus ?? dist[at(k)]!))),
    fstop: ch((k) => k.fstop ?? 8),
    roll: ch((k) => k.roll ?? 0),
  };
}

/** Put a PerspectiveCamera at a pose: position, aim (up the world's +Y, then the roll), the focal length's field of view. */
export function applyLens(cam: THREE.PerspectiveCamera, p: LensPose) {
  cam.position.copy(p.pos);
  cam.up.set(0, 1, 0);
  cam.lookAt(p.look);
  if (p.roll) cam.rotateZ(p.roll);
  cam.fov = focalToFov(p.focal, cam.aspect);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
}
