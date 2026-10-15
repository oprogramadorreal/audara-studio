// Samples spread over a frame's sub-frames. The render averages several sub-frames per frame for motion blur;
// golden-temple moves three more things across them: the camera by a fraction of a pixel (anti-aliasing with a
// wide, smooth filter, which keeps railings and tile edges from crawling in slow moves), the sun inside its
// disc (soft shadows) and the ambient-occlusion kernel (noise-free AO). The rule that keeps the result from
// flickering: every pattern depends on the sub-frame's index only, never on the frame's number or time, so
// with a fixed sample count a surface that doesn't move gets the same samples in every frame (golden-temple's
// docs/ARCHITECTURE.md, "Why the sub-frame sampling is temporally stable"; MIT, Leon Lin: see LICENSE). The
// adaptive sampler stops frames at different counts, which average different sets: render a jittered stretch
// with a fixed --samples.
//
// The index comes from the engine (src/engine/gl.ts SUBFRAME, audara 0.8.0 on; README.md says how to add it
// to an older engine). Without it, and in the preview, stills and verify's seek checks (one sample each),
// jitter() returns null and the scene renders its centred sample: it works, only without these extras.
import * as THREE from 'three';
import * as GL from '../engine/gl';

/** The sub-frame being rendered: its index within the frame, or -1 (one sample, or an engine without SUBFRAME). */
export function subframe(): number {
  const s = (GL as unknown as { SUBFRAME?: { k: number } }).SUBFRAME;
  return s ? s.k : -1;
}

const halton = (i: number, b: number) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

export interface Jitter {
  /** The sub-frame's index. */
  k: number;
  /** Sub-pixel camera offset, px (jitterCamera). */
  aa: [number, number];
  /** Offset inside the solar disc, radians (Sun.fit). */
  sun: [number, number];
  /** 0..1, a turn for an AO or other sampling kernel (Lens.finish takes it from k). */
  rot: number;
}

/**
 * This sub-frame's samples, or null for a single-sample frame. Halton points in bases 2 and 3 (camera) and 5
 * and 7 (sun) are evenly spread for any count, so they suit both fixed counts and the adaptive sampler's
 * nested sets. The camera offset follows a Gaussian (sigma 0.5 px) cut off at 1 px, drawn by its inverse
 * CDF: with the engine's equal weights the average is a Gaussian reconstruction filter, symmetric in every
 * direction. `sunRadius`: the Env's (radians).
 */
export function jitter(sunRadius: number, k = subframe()): Jitter | null {
  if (k < 0) return null;
  const S = 0.5, R = 1;
  const u1 = halton(k + 1, 2), u2 = halton(k + 1, 3);
  const r = S * Math.sqrt(-2 * Math.log(1 - u1 * (1 - Math.exp(-(R * R) / (2 * S * S)))));
  const a = 2 * Math.PI * u2;
  const rs = sunRadius * Math.sqrt(halton(k + 1, 5)), as = 2 * Math.PI * halton(k + 1, 7);
  return { k, aa: [r * Math.cos(a), r * Math.sin(a)], sun: [rs * Math.cos(as), rs * Math.sin(as)], rot: (k * 0.618034) % 1 };
}

/**
 * Shift the camera's projection by `aa` pixels of `target` (its physical size): call after
 * updateProjectionMatrix(), and draw into that target. The inverse is updated too, for passes that unproject.
 */
export function jitterCamera(cam: THREE.PerspectiveCamera, target: THREE.WebGLRenderTarget, aa: [number, number]) {
  cam.projectionMatrix.elements[8] += (2 * aa[0]) / target.width;
  cam.projectionMatrix.elements[9] += (2 * aa[1]) / target.height;
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
}
