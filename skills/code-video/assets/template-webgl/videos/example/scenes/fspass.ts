// The example's first scene (bars 1–2): one fullscreen fragment shader, an FSPass, draws the whole frame.
// Each pixel measures its distance to a core shape (a signed distance field, SDF), and the picture is
// that field: its isolines every S px are the rings, drifting outward one spacing per bar. Each kick
// sends a front out across them and fills the core's hatching; the snare lights the ruler; the second
// bar's downbeat squares the core off, and every ring with it (a rounded square's isolines are rounded
// squares), with a flash of the drawing itself. The shader reads only uniforms, which render() sets from
// the Frame and the audio data, so the picture is a function of t.
import * as THREE from 'three';
import { Scene, type Frame } from '../../../src/engine/scene';
import { FSPass, Layer2D } from '../../../src/engine/gl';
import { ease, lerp, prog, pulse } from '../../../src/engine/util';
import { drawLabel } from './_label';

const LABEL = 'FSPass · fullscreen GLSL · videos/example/scenes/fspass.ts';

/** Ring spacing (logical px). */
const S = 60;
/** Half-size of the core (px): a disc of this radius in bar 1, then a square with ROUND px corners. */
const CORE = 2 * S, ROUND = 18;
/** Bar index from f.bar (+1e-6: a scene start computed a hair before its downbeat still counts as that bar). */
const barIndex = (bar: number) => Math.floor(bar + 1e-6);

const FRAG = /* glsl */ `
uniform vec2 uRes;       // the logical frame (px)
uniform float uPhase;    // ring drift (px): one spacing per bar
uniform float uRound;    // the core's corner radius (px): CORE is a disc
uniform float uKick;     // f.a.kick: 1 on the hit, decaying
uniform float uSnare;    // f.a.snare
uniform vec2 uFrontR;    // how far out the last two kicks' fronts are (px from the core)
uniform vec2 uFrontA;    // and their strength (0..1)
uniform float uStep;     // the flash of the drawing on the bar's step (1 on the downbeat, decaying)
uniform vec4 uClear;     // the label's box (centre, half-size; FRAG_PX units): the field keeps clear of it
const float S = ${S.toFixed(1)};
const float CORE = ${CORE.toFixed(1)};

// Distance from field value f to the nearest multiple of S, in physical px (what pxLine takes). It divides
// by the field's own gradient: fwidth(f) = |dx| + |dy| is 1.4x too large across the diagonals, and would
// draw a circle thicker at 45 degrees.
float isoPx(float f) {
  float g = length(vec2(dFdx(f), dFdy(f)));
  return abs(fract(f / S + 0.5) - 0.5) * S / max(g, 1e-6);
}

void main() {
  // logical px from the centre, y up. FRAG_PX (not gl_FragCoord) keeps every size here in logical px at
  // any output scale; the origin sits on a pixel centre, so the 1 px axes below land on whole pixels.
  vec2 p = FRAG_PX - floor(0.5 * uRes) - 0.5;
  // the core's SDF: < 0 inside, the distance to its edge outside
  float d = sdBox(p, vec2(CORE - uRound)) - uRound;

  // each kick's front pushes the rings it passes outward a little and lights them
  float push = 0.0, lit = 0.0;
  for (int i = 0; i < 2; i++) {
    float x = (d - uFrontR[i]) / 34.0;
    float g = exp(-x * x) * uFrontA[i];
    push += 16.0 * g;
    lit = max(lit, g);
  }
  float f = d - uPhase - push;
  // the field keeps clear of the label: it fades out over 28 px around the label's box (an SDF again), so
  // no line runs through the type
  float open = smoothstep(16.0, 44.0, sdBox(FRAG_PX - uClear.xy, uClear.zw));

  vec3 col = C_BG;
  // the rings: the field's isolines, 1.2 px at 1x and thicker where lit (pxLine keeps that ink at 4K,
  // with sharper edges), quieter toward the frame's edges; the step's flash turns them to fg for a moment
  float ring = pxLine(isoPx(f), 0.1, 1.1 + 1.4 * lit) * (1.0 - 0.65 * smoothstep(200.0, 900.0, d)) * open;
  col = mix(col, mix(mix(C_LINE, C_ACCENT, lit), C_FG, 0.8 * uStep), ring);

  // a still ruler to read the motion against: the axes, and a tick every S (domain repetition: one tick,
  // repeated with mod). On every downbeat the rings sit on the ticks. The snare lights it in the second
  // accent, so the two drums read as two channels.
  vec3 ruler = mix(C_LINE, C_ACCENT2, uSnare);
  float axes = max(pxLine(abs(p.x) * PX_SCALE, 0.0, 1.0), pxLine(abs(p.y) * PX_SCALE, 0.0, 1.0));
  vec2 qx = vec2(mod(p.x + 0.5 * S, S) - 0.5 * S, p.y), qy = vec2(p.x, mod(p.y + 0.5 * S, S) - 0.5 * S);
  float ticks = min(sdSegment(qx, vec2(0.0, -6.0), vec2(0.0, 6.0)), sdSegment(qy, vec2(-6.0, 0.0), vec2(6.0, 0.0)));
  col = mix(col, ruler, max(axes * 0.6, pxLine(ticks * PX_SCALE, 0.0, 1.0)) * open);

  // the core, over the rings: ground, a 45-degree hatch 9 px apart whose lines thicken on the kick
  // (hatch's darkness is the line width), an outline that thickens with the step's flash
  float h = hatch((p.x + p.y) * 0.70710678 / 9.0, 0.14 + 0.5 * uKick);
  vec3 core = mix(C_BG, mix(C_MUTED, C_ACCENT, uKick), h);
  col = mix(col, core, aaFill(d));
  col = mix(col, C_FG, aaStroke(d, 1.5 + 2.0 * uStep));

  fragColor = vec4(col, 1.0);
}`;

export default class FsPass extends Scene {
  private pass = new FSPass(FRAG, {
    uRes: { value: new THREE.Vector2(this.ctx.W, this.ctx.H) },
    uPhase: { value: 0 }, uRound: { value: CORE }, uKick: { value: 0 }, uSnare: { value: 0 },
    uFrontR: { value: new THREE.Vector2() }, uFrontA: { value: new THREE.Vector2() },
    uStep: { value: 0 }, uClear: { value: new THREE.Vector4() },
  });
  private label = new Layer2D();
  /** Kicks as [time, strength], for the fronts: f.a.kick says how hard the last kick was, not when it hit. */
  private kicks: [number, number][] = [];
  /** Index of the bar the scene starts in (f.bar counts from the first downbeat of the video). */
  private bar0 = 0;

  override init() {
    const { audio, W, H, start, end } = this.ctx;
    // from 2 s before the start, so a front launched just before the cut is still on its way (and with no
    // analysis yet there are no onsets: the beat grid stands in)
    const onsets = audio.events('kick', start - 2, end);
    this.kicks = onsets.length ? onsets : audio.beats.filter((b) => b >= start - 2 && b < end).map((b) => [b, 1]);
    this.bar0 = barIndex(audio.barAt(start));
    // drawn once: the label never changes, so it is uploaded once and only composited per frame
    this.label.clear();
    const b = drawLabel(this.label.ctx, LABEL, W, H);
    this.label.upload();
    // its box for the shader, which works in FRAG_PX (from the bottom-left corner, y up)
    (this.pass.u.uClear!.value as THREE.Vector4).set(b.x + b.w / 2, H - (b.top + b.bottom) / 2, b.w / 2, (b.bottom - b.top) / 2);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const { renderer, comp, audio } = this.ctx;
    const u = this.pass.u;
    // the bar we are in (n counts from the scene's first) and the time since its downbeat (past the
    // analysis' last downbeat there is none: the step just holds)
    const bar = barIndex(f.bar), n = bar - this.bar0;
    const since = f.t - (audio.downbeats[bar] ?? -Infinity);
    u.uPhase!.value = S * (f.bar - this.bar0);
    // the step: on each downbeat after the first, the core snaps from disc to rounded square (odd bars) or
    // back, with an ease that starts at full speed (right on a hit; the first frame is already finished)
    const e = n > 0 ? prog(since, 0, 0.3, ease.outCubic) : 1;
    u.uRound!.value = lerp(CORE, ROUND, n % 2 ? e : 1 - e);
    u.uKick!.value = f.a.kick;
    u.uSnare!.value = f.a.snare;
    // each kick sends a front out from the core, fast then slowing, fading as it goes (the last two: the
    // older one is still fading out when the next kick comes)
    const past = this.kicks.filter(([tk]) => tk <= f.t).slice(-2);
    const R = u.uFrontR!.value as THREE.Vector2, A = u.uFrontA!.value as THREE.Vector2;
    R.set(0, 0); A.set(0, 0);
    past.forEach(([tk, s], i) => {
      R.setComponent(i, 760 * (1 - Math.exp(-(f.t - tk) / 0.55)));
      A.setComponent(i, s * pulse(f.t, tk, 0.32));
    });
    // a brief flash of the drawing marks the step. (Not post's `flash`: it adds fg to the whole linear
    // frame before encoding, and even 0.025 of it lifts a dark ground to a grey veil.)
    u.uStep!.value = n > 0 ? pulse(since, 0, 0.06) : 0;
    this.pass.render(renderer, out); // writes every pixel of out
    comp.draw(renderer, this.label.texture, out);
  }

  override dispose() {
    this.pass.mat.dispose();
    this.label.texture.dispose();
  }
}
