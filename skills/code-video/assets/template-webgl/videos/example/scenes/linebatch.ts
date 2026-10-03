// The example's 'linebatch' scene (bars 7–8 and the ring-out): GPU lines (LineBatch) and pen writing in a
// single-stroke font (stroke.ts). One pen runs a small plotter program timed on the beat grid: it plots a
// Lissajous figure (three beats), lifts and moves (one beat), then writes "f(t)", one glyph per beat, so the
// last stroke ends on the final hit. Everything on screen but the labels is LineBatch segments: a lattice of
// registration crosses re-coloured around the pen every frame, a dashed preview of the program, the inked
// lines, and the pen's head, brighter than 1.0 (linear) so the bloom gives it a glow.
// A test card, not a style to copy: neutral palette, plain geometry, small labels.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../../../src/engine/scene';
import { Layer2D, clearRT } from '../../../src/engine/gl';
import { LineBatch } from '../../../src/engine/lines';
import { LIN, rgba } from '../../../src/engine/palette';
import { strokeText, writtenLength, type StrokeText } from '../../../src/engine/stroke';
import { F, font } from '../../../src/engine/type';
import { ease, frameIdx, hash, lerp, pointAtLength, polylineLengths, prog, smootherstep, type V2 } from '../../../src/engine/util';
import { drawLabel, labelBox } from './_label';

const LABEL = 'LineBatch + stroke font · videos/example/scenes/linebatch.ts';

type RGB = [number, number, number];
/** A polyline in frame px with its cumulative lengths: what the pen inks part-way. */
interface Path { pts: V2[]; lens: Float32Array; total: number }
const toPath = (pts: V2[]): Path => { const lens = polylineLengths(pts); return { pts, lens, total: lens[lens.length - 1] ?? 0 }; };
const mix = (a: RGB, b: RGB, k: number): RGB => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const mul = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];

const PITCH = 40; // the lattice's spacing (px); the figure and the word's baseline sit on it
const WORD = 'f(t)';
const FONT = 'readable'; // EMS Readability: a plain single-line sans, one pen stroke per glyph here
const HOT = 90; // px of fresh ink behind the head that still glows

/**
 * Progress through one beat for the pen: a surge on the beat that eases off before the next one. (An ease
 * that starts at full speed pops anywhere else; here every beat is a hit, so the snap lands with it.)
 */
const surge = (x: number) => lerp(x, ease.outCubic(x), 0.7);

/** Ink the first `len` px of a path as segments coloured by `col(s)` (s: length along it); returns the pen's point. */
function inkPath(lb: LineBatch, p: Path, len: number, width: number, col: (s: number) => RGB): V2 | null {
  if (len <= 0) return null;
  const { pts, lens } = p;
  for (let j = 1; j < pts.length; j++) {
    const a = pts[j - 1]!, b = pts[j]!;
    if (lens[j]! <= len) { lb.seg2(a.x, a.y, b.x, b.y, width, col(lens[j]!)); continue; }
    const u = (len - lens[j - 1]!) / Math.max(1e-6, lens[j]! - lens[j - 1]!);
    const h = { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) };
    lb.seg2(a.x, a.y, h.x, h.y, width, col(len));
    return h;
  }
  return pts[pts.length - 1]!;
}

/** The program's preview: a dash of `on` px every `period` px along a path, as [ax, ay, bx, by] runs. */
function dashes(p: Path, on: number, period: number, out: number[]) {
  for (let s = 0; s < p.total; s += period) {
    const a = pointAtLength(p.pts, p.lens, s), b = pointAtLength(p.pts, p.lens, Math.min(p.total, s + on));
    out.push(a.x, a.y, b.x, b.y);
  }
}

export default class LineBatchPen extends Scene {
  // One batch (made in init(), sized to the geometry), blend 'max' (the default, written out because it
  // matters): the capsules of a polyline overlap at every joint, and 'add' would bead them. Max is also exact
  // in any order, so a frame comes out identical however it is reached; overlapping 'add' fragments can round
  // differently from one render to the next on some GPUs, and `render.ts verify` reports that. The glow is
  // the bloom's: values above 1.0 (linear) bloom.
  private lines!: LineBatch;
  private label = new Layer2D();

  // static geometry, built once in init(): only colours and inked lengths change per frame
  private crosses: V2[] = [];
  private figure!: Path;
  private st!: StrokeText; // the word as the stroke font lays it out (lengths for writtenLength)
  private strokes: Path[] = []; // its strokes, moved into the frame
  private preview: number[] = [];
  private guides: number[] = [];
  private marks: number[] = [];
  // the program, in video seconds from the beat grid
  private tFig0 = 0; private tFig1 = 0; private tWord = 0; private tEnd = 0;
  private charTimes: [number, number][] = [];

  override init() {
    const { W, H, audio, start } = this.ctx;
    // the program starts on the beat that opens the scene (the timeline cuts on bar 7's downbeat)
    const b0 = Math.round(audio.beatAt(start)), T = (b: number) => audio.timeOfBeat(b0 + b);
    [this.tFig0, this.tFig1, this.tWord, this.tEnd] = [T(0), T(3), T(4), T(8)];
    this.charTimes = Array.from(WORD, (_, i) => [T(4 + i), T(5 + i)]); // glyph i on beat 4 + i

    // layout on the lattice: the figure in a square of half-size A, the word beside it (below it in a square or
    // tall frame). Lattice points sit on half pixels: a 1 px line on a whole coordinate straddles two pixels at
    // half strength
    const snap = (v: number) => Math.round(v / PITCH) * PITCH + 0.5;
    const wide = W >= 1.25 * H;
    const A = PITCH * Math.max(2, Math.round((wide ? Math.min(H * 0.22, W * 0.125) : Math.min(W * 0.22, H * 0.115)) / PITCH));
    const cx = snap(wide ? W * 0.3 : W / 2), cy = snap(wide ? H * 0.47 : H * 0.3);
    // a 3:2 Lissajous (x = sin 3θ, y = sin 2θ): one closed loop from the origin back to it
    this.figure = toPath(Array.from({ length: 1601 }, (_, i) => {
      const th = (i / 1600) * Math.PI * 2;
      return { x: cx + A * Math.sin(3 * th), y: cy - A * Math.sin(2 * th) };
    }));
    // the word: strokes from the font's origin (left end of the baseline, y down), centred on their ink
    const size = A * 1.75;
    this.st = strokeText(WORD, FONT, size);
    let top = Infinity, bottom = -Infinity;
    for (const s of this.st.strokes) for (const p of s) { top = Math.min(top, p.y); bottom = Math.max(bottom, p.y); }
    const wx = wide ? W * 0.71 : W / 2, wy = wide ? cy : snap(H * 0.68);
    const x0 = wx - this.st.width / 2, base = snap(wy - (top + bottom) / 2);
    this.strokes = this.st.strokes.map((s) => toPath(s.map((p) => ({ x: x0 + p.x, y: base + p.y }))));

    // what the program will draw, dashed: the first frame already shows the whole composition
    dashes(this.figure, 6, 12, this.preview);
    for (const s of this.strokes) dashes(s, 6, 12, this.preview);
    // the figure's axes with graticule ticks (five per lattice cell), the word's baseline
    const g = this.guides, e = A + PITCH;
    g.push(cx - e, cy, cx + e, cy, cx, cy - e, cx, cy + e);
    for (let d = -e; d <= e + 1e-6; d += PITCH / 5) {
      const r = Math.abs(d % PITCH) < 1e-6 ? 6 : 3;
      g.push(cx + d, cy - r, cx + d, cy + r, cx - r, cy + d, cx + r, cy + d);
    }
    g.push(x0 - PITCH / 2, base, x0 + this.st.width + PITCH / 2, base);
    // corner marks of the figure's box
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const x = cx + sx * A, y = cy + sy * A;
      this.marks.push(x, y, x - sx * 14, y, x, y, x, y - sy * 14);
    }
    // the lattice: registration crosses over the frame, clear of the edges and of the label (a cross within
    // 24 px of its box is left out)
    const lb = labelBox(LABEL, W, H);
    const nearLabel = (x: number, y: number) => x > lb.x - 24 && x < lb.x + lb.w + 24 && y > lb.top - 24 && y < lb.bottom + 24;
    for (let y = 2 * PITCH; y <= H - 2 * PITCH; y += PITCH) for (let x = 2 * PITCH; x <= W - 2 * PITCH; x += PITCH) if (!nearLabel(x, y)) this.crosses.push({ x: x + 0.5, y: y + 0.5 });
    // capacity: every segment one frame can add (past it, seg() drops them silently)
    const inked = this.figure.pts.length + this.strokes.reduce((n, s) => n + s.pts.length, 0);
    this.lines = new LineBatch(2 * this.crosses.length + (this.preview.length + g.length + this.marks.length) / 4 + inked + 2, { blend: 'max' });

    // the labels never change: drawn and uploaded once, only composited per frame
    const c = this.label.ctx;
    this.label.clear();
    drawLabel(c, LABEL, W, H);
    c.font = font(F.mono(400), 15);
    c.fillStyle = rgba('muted', 0.8);
    c.textAlign = 'center';
    const ly = cy + e + 26;
    c.fillText('Lissajous 3:2 · three beats', cx, ly);
    c.fillText('strokeText + writtenLength · a glyph per beat', wx, wide ? ly : base + size * 0.22 + 40);
    this.label.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio } = this.ctx;
    const t = f.t, kick = f.a.kick, L = this.lines;
    L.clear();
    // the pen's clock: video time with every beat surging (beat times map to themselves)
    const b = audio.beatAt(t), tb = audio.timeOfBeat(Math.floor(b) + surge(b - Math.floor(b)));

    // ---- ink: fresh ink near the head runs hot (> 1, it blooms) and cools to fg; the final hit lights it all once
    const hit = t >= this.tEnd ? kick : 0;
    const trail = mul(LIN.fg, 0.85 * (1 + 1.5 * hit)), hot = mul(LIN.accent, 3);
    const tint = (lead: number, cool: number) => (s: number) => mix(trail, hot, Math.exp(-(lead - s) / HOT) * cool);
    const lenFig = this.figure.total * prog(tb, this.tFig0, this.tFig1);
    const figHead = inkPath(L, this.figure, lenFig, 1.25, tint(lenFig, Math.exp(-Math.max(0, t - this.tFig1) / 0.12)));
    // the word: writtenLength() spreads each glyph's strokes over its beat (charTimes); the pen lifts between strokes
    const lenWord = writtenLength(this.st, this.charTimes, tb);
    const wordTint = tint(lenWord, Math.exp(-Math.max(0, t - this.tEnd) / 0.25));
    let wordHead: V2 | null = null;
    this.strokes.forEach((s, i) => {
      const s0 = this.st.startLen[i]!;
      wordHead = inkPath(L, s, lenWord - s0, 2.5, (x) => wordTint(s0 + x)) ?? wordHead;
    });

    // ---- the pen, by the program's phase: plotting (down), moving to the word on beat 4 (up), writing
    const first = this.strokes[0]!.pts[0]!, fig = this.figure.pts;
    let head: V2, down = 1;
    if (t < this.tFig1) head = figHead ?? fig[0]!;
    else if (t < this.tWord) {
      const k = smootherstep(this.tFig1, this.tWord, t), from = fig[fig.length - 1]!;
      head = { x: lerp(from.x, first.x, k), y: lerp(from.y, first.y, k) };
      down = 0;
    } else head = wordHead ?? first;
    const lift = 1 - prog(t, this.tEnd + 0.1, this.tEnd + 0.6, ease.inOutCubic); // after the final hit the pen leaves

    // ---- the lattice: lit in a pool around the pen (a kick widens and tints it), swept by a ring on the final hit
    const R = 150 + 170 * kick, since = t - this.tEnd;
    const ringR = since * 1500, ringA = since >= 0 ? Math.exp(-since / 0.4) : 0;
    const light = lerp(0.45, 1, down) * lift;
    for (const p of this.crosses) {
      const d = Math.hypot(p.x - head.x, p.y - head.y);
      const k = light * Math.max(0, 1 - d / R) ** 2, ring = ringA * Math.exp(-(((d - ringR) / 80) ** 2));
      const c = mix(mix(LIN.line, LIN.muted, k), LIN.accent, Math.min(1, k * kick + ring));
      const r = 3.5 + 2.5 * Math.max(k, ring);
      L.seg2(p.x - r, p.y, p.x + r, p.y, 1, c);
      L.seg2(p.x, p.y - r, p.x, p.y + r, 1, c);
    }
    const segs = (a: number[], w: number, c: RGB) => { for (let i = 0; i < a.length; i += 4) L.seg2(a[i]!, a[i + 1]!, a[i + 2]!, a[i + 3]!, w, c); };
    segs(this.preview, 1, mul(LIN.muted, 0.45));
    segs(this.guides, 1, mix(LIN.line, LIN.muted, 0.5));
    segs(this.marks, 1.25, LIN.muted);

    // ---- the pen's head: a disc (a segment of length ~0) and a core far above 1.0 for the bloom; a kick
    // flares it. The shimmer changes per output frame (frameIdx), never per sub-frame, so each exported frame
    // shows one state
    const I = lerp(0.45, 1, down) * lift * (1 + 2 * kick) * (0.9 + 0.1 * hash(frameIdx(t), 7));
    if (I > 0.002) {
      const dot = (w: number, c: RGB) => L.seg2(head.x, head.y, head.x + 0.01, head.y, w, c);
      dot(lerp(7, 10, down) + 6 * kick, mul(LIN.accent, 0.8 * I));
      dot(lerp(3, 4.5, down), mul(mix(LIN.accent, LIN.fg, 0.6), 8 * I));
    }

    clearRT(renderer, out, LIN.bg);
    L.render(renderer, out);
    comp.draw(renderer, this.label.texture, out);
    // the ring-out holds the finished drawing; fade on the last half second
    return { fade: prog(t, this.ctx.end - 0.5, this.ctx.end, ease.inOutCubic) };
  }

  override dispose() {
    this.lines.geo.dispose();
    this.lines.mat.dispose();
    this.label.texture.dispose();
  }
}
