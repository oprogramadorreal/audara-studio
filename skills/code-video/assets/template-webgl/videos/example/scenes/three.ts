// Bars 3–4 of the example (../TREATMENT.md): a three.js scene. A slab of columns drawn as one
// InstancedMesh; their heights follow a wave in t and jump as a ring runs out from the centre on every
// kick. A PerspectiveCamera passes through a pose on every beat and lands looking straight down on the
// cut, flat like the page that follows. The inset plots the camera's speed: smoothKeys carries it
// through the poses, keys() would stop at each one.
//
// three.js under the engine's rules: everything is built in init(); render() sets every transform,
// colour and camera parameter from f.t (no THREE.Clock, no requestAnimationFrame, nothing carried from
// one frame to the next: the export renders sub-frames in any order); colours are linear (LIN); the
// result lands in `out`, every pixel of it. (A model would load in init() too and play with
// mixer.setTime(f.t); a physics or particle simulation needs `stateful = true`.)
import * as THREE from 'three';
import { Scene, type Frame } from '../../../src/engine/scene';
import { Layer2D, clearRT, makeRT } from '../../../src/engine/gl';
import { LIN, rgba } from '../../../src/engine/palette';
import { F, font } from '../../../src/engine/type';
import { keys, lerp, smoothKeys, smoothstep } from '../../../src/engine/util';
import { drawLabel } from './_label';

const LABEL = 'three.js · InstancedMesh · videos/example/scenes/three.ts';

const N = 25, SIDE = 0.5; // columns per side (odd: one stands on the centre), footprint (1 unit apart)
const RING = { speed: 14, width: 1, life: 0.8, lift: 2.4 }; // a kick's ring: units/s, units, decay (s), extra height

/**
 * The camera's poses on the beats of bars 3–4 and the downbeat of bar 5 (the cut): [beat from the
 * scene's start, azimuth°, elevation°, distance, fov°], around the slab's centre (elevation 90:
 * straight down). The steps between poses grow toward the middle and shrink toward the ends, so the
 * move starts and lands softly (see the inset); the slab stays clear of the label and the inset.
 */
const POSES: [number, number, number, number, number][] = [
  [0, -50, 14, 38, 33],
  [1, -46, 16, 40, 33],
  [2, -36, 24, 47, 32],
  [3, -25, 36, 58.5, 30.5],
  [4, -14, 51, 70, 28],
  [5, -6, 67, 79, 26.5],
  [6, -2, 80, 83, 25.5],
  [7, 0, 87, 84, 25],
  [8, 0, 90, 84, 25],
];
type Interp = (t: number, ks: [number, number][]) => number;
type Pose = { az: number; el: number; dist: number; fov: number };

/** Where a pose puts the camera: on a sphere around the slab's centre (angles in radians). */
const eye = ({ az, el, dist }: Pose, into: THREE.Vector3) =>
  into.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist);
/** A palette colour (a LIN triplet) as a THREE.Color, kept linear; mix() blends two into `c`. */
const lin = (a: readonly number[]) => new THREE.Color().setRGB(a[0]!, a[1]!, a[2]!, THREE.LinearSRGBColorSpace);
const mix = (c: THREE.Color, a: readonly number[], b: readonly number[], k: number) =>
  c.setRGB(lerp(a[0]!, b[0]!, k), lerp(a[1]!, b[1]!, k), lerp(a[2]!, b[2]!, k), THREE.LinearSRGBColorSpace);
const WHITE = new THREE.Color(1, 1, 1); // the lights are neutral: the palette colours the surfaces
const DEG = Math.PI / 180;

const PLOT = { w: 340, h: 92, base: 82 }; // the speed inset (logical px; `base`: its axis, on the label's baseline)
/**
 * How far below the slab's centre the camera looks: the slab sits higher in the frame, clear of the label
 * and the inset at the bottom, while the straight-down view at the cut stays centred (looking down at a
 * point under the centre is looking at the centre).
 */
const AIM = 1.4;

export default class Three extends Scene {
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(30, this.ctx.W / this.ctx.H, 1, 300);
  private fog = new THREE.Fog(lin(LIN.bg), 1, 2);
  private field!: THREE.InstancedMesh;
  // three.js draws without anti-aliasing into the engine's targets: a 4x multisampled target of our own
  // smooths the edges, then is copied into `out`
  private rt = makeRT(this.ctx.W, this.ctx.H, { samples: 4, resolveDepthBuffer: false });
  private tracks: [number, number][][] = []; // the poses as one [time, value] track per channel (azimuth, elevation, distance, fov)
  private label = new Layer2D();
  private plot = new Layer2D(PLOT.w, PLOT.h); // small: redrawn every frame, and its upload costs by the pixel
  private plotRect: [number, number, number, number] = [0, 0, PLOT.w, PLOT.h]; // where it goes (comp.draw's rect)
  private speed = { smooth: new Float32Array(0), stepped: new Float32Array(0), max: 1 };

  override init() {
    const { W, H, audio, start, end } = this.ctx;
    // fog fades the far side of the slab into the clear colour (its range follows the camera, in render())
    this.scene.fog = this.fog;
    // three.js lights are physical: a Lambert face square to a light of intensity π shows its own colour
    const sun = new THREE.DirectionalLight(WHITE, 0.8 * Math.PI);
    sun.position.set(-0.45, 1, 0.3); // (a direction: the light comes from there, toward the origin)
    this.scene.add(sun, new THREE.AmbientLight(WHITE, 0.25 * Math.PI));

    // one box with its base on the ground (y 0..1); each instance scales it to its footprint and height.
    // (No colour gradient over a face: with multisampling, a face seen edge-on is shaded at pixel centres
    // outside it, where a gradient extrapolates past its ends and lights a bright seam.)
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.field = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial(), N * N);
    // (three.js would compute the bounds once, from the first frame's heights, and cull with them later)
    this.field.frustumCulled = false;
    this.field.setColorAt(0, WHITE); // allocates instanceColor
    const slab = new THREE.Mesh(new THREE.BoxGeometry(N + 0.5, 0.3, N + 0.5).translate(0, -0.15, 0), new THREE.MeshLambertMaterial({ color: lin(LIN.line) }));
    this.scene.add(this.field, slab);

    // the poses' times come from the beat grid, so the move follows the music if the timing data changes
    const b0 = Math.round(audio.beatAt(start));
    this.tracks = [1, 2, 3, 4].map((c) => POSES.map((p) => [audio.timeOfBeat(b0 + p[0]), p[c]] as [number, number]));

    // the camera's speed over the scene, as smoothKeys moves it and as keys() would (for the inset)
    const S = 240, e = 1 / 480, a = new THREE.Vector3(), b = new THREE.Vector3();
    const speedOf = (fn: Interp) => Float32Array.from({ length: S + 1 }, (_, i) => {
      const t = lerp(start, end, i / S);
      return eye(this.pose(t + e, fn), a).distanceTo(eye(this.pose(t - e, fn), b)) / (2 * e);
    });
    const smooth = speedOf(smoothKeys), stepped = speedOf(keys);
    this.speed = { smooth, stepped, max: Math.max(...smooth, ...stepped) };

    // the label never changes: drawn and uploaded once, composited every frame; the inset sits at the
    // right edge of the title-safe area, its axis on the label's baseline, or above the label's right end
    // when the frame is too narrow for both on one line (a vertical video, where the label fills the width)
    this.label.clear();
    const lb = drawLabel(this.label.ctx, LABEL, W, H);
    this.label.upload();
    const px = W - lb.x - PLOT.w, gap = 24;
    this.plotRect = lb.x + lb.w + gap <= px ? [px, lb.y - PLOT.base, PLOT.w, PLOT.h] : [px, lb.top - gap - PLOT.h, PLOT.w, PLOT.h];
  }

  /** The camera's pose at t, interpolated through POSES with smoothKeys (or, for the inset, keys()). */
  private pose(t: number, fn: Interp = smoothKeys): Pose {
    const [az, el, dist, fov] = this.tracks.map((ks) => fn(t, ks)) as [number, number, number, number];
    return { az: az * DEG, el: el * DEG, dist, fov };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const { renderer, comp, audio, end } = this.ctx;
    const t = f.t, cam = this.cam;

    // The camera passes through a pose on every beat. smoothKeys carries its speed through them; keys()
    // would ease every step on its own and stop the camera dead on each beat (the inset shows both).
    const p = this.pose(t);
    eye(p, cam.position);
    // `up` perpendicular to the view (the vertical tipped toward where the camera looks): defined even
    // straight down, where lookAt's default up, the vertical itself, leaves the roll undefined
    cam.up.set(-Math.sin(p.az) * Math.sin(p.el), Math.cos(p.el), -Math.cos(p.az) * Math.sin(p.el));
    cam.lookAt(0, -AIM, 0);
    cam.fov = p.fov;
    cam.updateProjectionMatrix();
    // fog from the slab's centre outward: the near half stays clear, the far edge fades (straight down: none)
    this.fog.near = p.dist - 1;
    this.fog.far = p.dist + 26;

    // heights: a wave travelling across the slab, plus a ring from the centre for every kick still in
    // flight (rings older than 2 s have left the slab). Onsets come from the timing data, never from
    // audio playback, so any t renders the same.
    const kicks = audio.events('kick', t - 2, t + 1e-6);
    const settle = 1 - smoothstep(end - 0.75, end, t); // the columns lie flat for the top view at the cut
    const ph = f.beat * (Math.PI / 2); // a crest every 4 beats, locked to the tempo
    const m = new THREE.Matrix4(), col = new THREE.Color();
    for (let i = 0, k = 0; i < N; i++) for (let j = 0; j < N; j++, k++) {
      const x = i - (N - 1) / 2, z = j - (N - 1) / 2, r = Math.hypot(x, z);
      const wave = 0.5 + 0.5 * Math.sin(0.42 * (x - z) - ph);
      let ring = 0;
      for (const [tk, s] of kicks) {
        const age = t - tk, d = r - age * RING.speed;
        ring = Math.max(ring, s * Math.exp(-age / RING.life - (d * d) / (2 * RING.width * RING.width)));
      }
      ring *= settle;
      this.field.setMatrixAt(k, m.makeScale(SIDE, lerp(0.12, 0.5 + 0.8 * wave, settle) + RING.lift * ring, SIDE).setPosition(x, 0, z));
      // the rings in accent; the centre, which fires them, in accent2 on the kick
      this.field.setColorAt(k, r === 0 ? mix(col, LIN.muted, LIN.accent2, f.a.kick * settle) : mix(col, LIN.muted, LIN.accent, ring));
    }
    this.field.instanceMatrix.needsUpdate = true;
    this.field.instanceColor!.needsUpdate = true;

    // the engine's renderer never clears by itself (autoClear is off): colour and depth, so nothing is
    // left from the last frame
    clearRT(renderer, this.rt, LIN.bg);
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, cam);
    comp.draw(renderer, this.rt.texture, out, { mode: 'replace' }); // (the resolved samples, over every pixel of out)
    comp.draw(renderer, this.label.texture, out);
    this.drawPlot(t);
    comp.draw(renderer, this.plot.upload(), out, { rect: this.plotRect });
  }

  /** The inset: camera speed over the scene, smoothKeys (solid) against keys() (dashed), the poses' beats, now. */
  private drawPlot(t: number) {
    const { start, end } = this.ctx, c = this.plot.ctx, { smooth, stepped, max } = this.speed;
    const x0 = 1, x1 = PLOT.w - 1, y0 = 28, y1 = PLOT.base;
    const X = (u: number) => lerp(x0, x1, u), Y = (v: number) => lerp(y1, y0, v / max);
    const curve = (v: Float32Array) => { c.beginPath(); v.forEach((s, i) => c.lineTo(X(i / (v.length - 1)), Y(s))); c.stroke(); };
    const swatch = (x: number) => { c.beginPath(); c.moveTo(x, 7); c.lineTo(x + 16, 7); c.stroke(); };
    this.plot.clear(); // (it resets every style too: nothing carries over from the last frame)
    // legend
    c.font = font(F.mono(400), 15);
    c.textAlign = 'left';
    c.fillStyle = rgba('muted');
    c.fillText('camera speed', 0, 12);
    c.textAlign = 'right';
    c.fillText('keys', PLOT.w, 12);
    c.fillStyle = rgba('fg');
    c.fillText('smoothKeys', PLOT.w - 84, 12);
    c.textAlign = 'left';
    c.lineWidth = 1.5;
    c.strokeStyle = rgba('fg');
    swatch(PLOT.w - 196);
    // keys(), dashed: it eases each step on its own, so it stops on every beat and sprints in between
    c.strokeStyle = rgba('muted');
    c.setLineDash([3, 3]);
    swatch(PLOT.w - 60);
    c.lineWidth = 1.25;
    curve(stepped);
    c.setLineDash([]);
    c.strokeStyle = rgba('fg');
    c.lineWidth = 1.75;
    curve(smooth);
    // the axis, with a tick on each pose's beat
    c.strokeStyle = rgba('line');
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(x0, y1 + 0.5); c.lineTo(x1, y1 + 0.5);
    for (const [kt] of this.tracks[0]!) { const x = Math.round(X((kt - start) / (end - start))) + 0.5; c.moveTo(x, y1 + 1); c.lineTo(x, y1 + 7); }
    c.stroke();
    // now
    const u = Math.min(1, Math.max(0, (t - start) / (end - start))), i = u * (smooth.length - 1), i0 = Math.floor(i);
    const s = lerp(smooth[i0]!, smooth[Math.min(i0 + 1, smooth.length - 1)]!, i - i0);
    c.strokeStyle = rgba('muted', 0.6);
    c.beginPath(); c.moveTo(X(u), y0 - 4); c.lineTo(X(u), y1); c.stroke();
    c.fillStyle = rgba('fg');
    c.beginPath(); c.arc(X(u), Y(s), 3.5, 0, Math.PI * 2); c.fill();
  }

  override dispose() {
    this.rt.dispose();
    this.scene.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
    this.field.dispose();
    this.label.texture.dispose();
    this.plot.texture.dispose();
  }
}
