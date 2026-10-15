// A camera that moves like a real one through lens keys. From golden-temple's src/shots.js (MIT, Leon Lin:
// see LICENSE): the orientation is interpolated as a direction, not a look-at point, and the look distance and
// the focus distance in log space, so a close-up looking at something 1 m away and a wide shot looking 40 m
// away turn into each other smoothly, and a lens can rack focus and zoom during the move. The direction goes
// as a camera head turns it, pan and tilt (golden-temple blends its components, which bunches a wide turn
// into a few frames and has no direction half-way through a half turn). The keys' times come from the data,
// like every time in a video (beats, words, the entry's window). Each channel goes through util.ts
// smoothKeys by default: speed carries through the keys instead of stopping at each.
import * as THREE from 'three';
import { ease, keys as keyframes, smoothKeys, smoothstep } from '../engine/util';
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

export interface LensPose {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  /** Radians: the view's azimuth (0 toward -Z, π/2 toward +X, as env.ts sunFrom) and its elevation. */
  pan: number;
  tilt: number;
  focal: number;
  focus: number;
  fstop: number;
  roll: number;
}

type Interp = (t: number, ks: [number, number][]) => number;

/**
 * golden-temple's 'reveal' ease over 0..1: lingers on the close-up, accelerates into the move, lands softly.
 * Remap time with it and interpolate linearly: lensAt(start + reveal(p) * (end - start), keys, linearKeys).
 */
export const reveal = (u: number) => Math.pow(smoothstep(0, 1, u), 1.35);

/** Straight lines between keys (for a time already eased, as with reveal). */
export const linearKeys: Interp = (t, ks) => keyframes(t, ks.map(([kt, v]) => [kt, v, ease.linear]));

/** x wrapped into (-π, π]: a half turn goes the positive way. */
const wrap = (x: number) => Math.PI - (((Math.PI - x) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

/** The camera at time t through `keys` (in time order). */
export function lensAt(t: number, keys: LensKey[], interp: Interp = smoothKeys): LensPose {
  const ch = (v: (k: LensKey, i: number) => number) => interp(t, keys.map((k, i) => [k.t, v(k, i)] as [number, number]));
  const dirs = keys.map((k) => new THREE.Vector3(k.look[0] - k.pos[0], k.look[1] - k.pos[1], k.look[2] - k.pos[2]));
  const dist = dirs.map((d) => Math.max(d.length(), 0.01));
  const tilt = dirs.map((d) => Math.atan2(d.y, Math.hypot(d.x, d.z)));
  // each key's pan, unwrapped to the shorter turn from the key before; a key looking straight up or down
  // has none of its own and takes that of the nearest key that has one (the earlier on a tie)
  const own = dirs.map((d) => (Math.hypot(d.x, d.z) > 1e-6 * d.length() ? Math.atan2(d.x, -d.z) : NaN));
  const near = (i: number) => {
    for (let s = 1; s < keys.length; s++) for (const j of [i - s, i + s]) if (j >= 0 && j < keys.length && !Number.isNaN(own[j]!)) return own[j]!;
    return 0;
  };
  const pan = own.map((x, i) => (Number.isNaN(x) ? near(i) : x));
  for (let i = 1; i < pan.length; i++) pan[i] = pan[i - 1]! + wrap(pan[i]! - pan[i - 1]!);
  const pos = new THREE.Vector3(ch((k) => k.pos[0]), ch((k) => k.pos[1]), ch((k) => k.pos[2]));
  const p = ch((_, i) => pan[i]!), e = ch((_, i) => tilt[i]!);
  const dir = new THREE.Vector3(Math.sin(p) * Math.cos(e), Math.sin(e), -Math.cos(p) * Math.cos(e));
  const look = pos.clone().addScaledVector(dir, Math.exp(ch((_, i) => Math.log(dist[i]!))));
  return {
    pos, look, pan: p, tilt: e,
    focal: ch((k) => k.focal ?? 35),
    focus: Math.exp(ch((k, i) => Math.log(k.focus ?? dist[i]!))),
    fstop: ch((k) => k.fstop ?? 8),
    roll: ch((k) => k.roll ?? 0),
  };
}

/**
 * Put a PerspectiveCamera at a pose: position, aim (the pan about the world's +Y, the tilt, then the roll,
 * as a camera head: straight up or down included), the focal length's field of view.
 */
export function applyLens(cam: THREE.PerspectiveCamera, p: LensPose) {
  cam.position.copy(p.pos);
  cam.rotation.set(p.tilt, -p.pan, p.roll, 'YXZ');
  if (cam.parent) { // (the pose is in world space: under a parent, into the parent's)
    cam.parent.updateWorldMatrix(true, false);
    cam.parent.worldToLocal(cam.position);
    cam.quaternion.premultiply(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(cam.parent.matrixWorld)).invert());
  }
  cam.fov = focalToFov(p.focal, cam.aspect);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
}
