// Example scene 'layer2d' (bars 5–6): Canvas2D type on Layer2Ds, synced to data/words.json.
// A karaoke of three lines found by their text (their times come from the data): each word lights as it
// is sung and steps through Archivo's widths and weights while it is; a ruler below plots the same words
// and the drum onsets on the beat grid, under a playhead that flashes on every hit.
// It shows: words.get() and Words.wordProgress(); glyphX() to split a word into differently coloured
// pieces without losing its kerning; the gap between runs in different fonts set by eye; discrete steps
// taken at the frame's own time (frameTime) while the layout glides; and how to keep Canvas2D cheap. An
// upload costs in proportion to the layer's area, so what never changes is drawn once, each line only
// when it changes, and what moves every frame sits in a small layer.
import type * as THREE from 'three';
import { Scene, type Frame } from '../../../src/engine/scene';
import { Layer2D, clearRT } from '../../../src/engine/gl';
import { LIN, rgba } from '../../../src/engine/palette';
import { F, font, glyphX, measure } from '../../../src/engine/type';
import { Words, type Line, type Word } from '../../../src/engine/words';
import { frameTime, pulse, smootherstep } from '../../../src/engine/util';
import { drawLabel } from './_label';

const LABEL = 'Layer2D · Canvas2D type · videos/example/scenes/layer2d.ts';
/** The lines this scene sets, looked up in data/words.json by their text. */
const QUERIES = ['Every frame', 'is a function', 'of time'];
/**
 * Archivo [width, weight]: unsung (0), being sung (1→3, a step per quarter of the word), sung (3).
 * The fonts are static instances (type.ts), so the width steps: there is nothing in between to tween.
 */
const STEPS = [[62, 300], [75, 500], [87.5, 700], [100, 900]] as const;
const MONO = F.mono(400);
/** The note under the word being sung: the call that picks its font. */
const NOTE = (step: number) => `F.archivo(${STEPS[step]!.join(', ')})`;
/** Title-safe left edge: karaoke text stays >= 96 px from the frame's edges. */
const X0 = 120;
/** How long the words after a stepping word take to make room for it (s, ending on the step). */
const GLIDE = 0.1;

/**
 * A word at t: unsung (0), being sung (1) or sung (2); its font step; how many of its glyphs the voice
 * has reached (lit from the word's start, all of them by its end: never ahead of the voice). It steps
 * from its start on, the moment the words after it have finished making room for it (see layout()).
 */
function wordState(w: Word, t: number) {
  const p = Words.wordProgress(w, t), n = Array.from(w.w).length;
  const phase = t < w.start ? 0 : p < 1 ? 1 : 2;
  return { phase, step: phase === 0 ? 0 : Math.min(3, 1 + Math.floor(p * 4)), lit: phase === 2 ? n : Math.ceil(p * n) };
}

/**
 * A Layer2D over one rect of the frame (logical px), drawn in frame coordinates. An upload costs what
 * the layer's area does, so a layer only as big as what it holds is cheaper to redraw.
 */
class Patch extends Layer2D {
  constructor(public x: number, public y: number, w: number, h: number) { super(w, h); }
  /** Clear it and return its context, set up to draw in frame coordinates. */
  begin() { this.clear(); this.ctx.setTransform(1, 0, 0, 1, -this.x, -this.y); return this.ctx; }
  /** Where it goes in the frame: comp.draw(..., { rect: patch.rect }). */
  get rect(): [number, number, number, number] { return [this.x, this.y, this.w, this.h]; }
}

/** A word's sizes in each font step, and when it steps (the times its wordProgress crosses 0, 1/4, 1/2). */
interface Metrics { w: Word; width: number[]; space: number[]; at: number[] }
/** A lyric line: its words, baseline, layer and the key of what the layer shows now. */
interface Row { line: Line; words: Metrics[]; y: number; layer: Patch; key: string }

export default class Layer2DType extends Scene {
  /** Drawn once: the label and the ruler's axis, track names and empty tracks. */
  private still = new Layer2D();
  /** One layer per line, redrawn only when one of its words changes font, lights a glyph or moves. */
  private rows: Row[] = [];
  /** The ruler's moving parts (playhead, fills, hits): a strip redrawn every frame. */
  private band!: Patch;
  private words: Word[] = [];
  private kicks: [number, number][] = [];
  private snares: [number, number][] = [];
  private size = 0;
  /** The ruler: the scene's window mapped onto [rx0, rx1], its axis at ry. */
  private rx0 = 0;
  private rx1 = 0;
  private ry = 0;

  override init() {
    const { words, audio, W, H, start, end } = this.ctx;
    const lines = QUERIES.map((q) => words.get(q)); // throws if words.json lacks a line: loud while authoring
    this.words = lines.flatMap((l) => l.words);
    this.kicks = audio.events('kick', start, end);
    this.snares = audio.events('snare', start, end);
    // a line is widest once all its words are sung (widest, heaviest): the size at which the widest fits
    const full = F.archivo(...STEPS[3]), wd = (s: string, size: number) => measure(s, full, size);
    const width = (l: Line, size: number) => l.words.reduce((a, w) => a + wd(w.w, size), 0) + (l.words.length - 1) * wd(' ', size);
    const S = (this.size = Math.min(184, Math.floor(((W - 2 * X0) / Math.max(...lines.map((l) => width(l, 100)))) * 100)));
    const asc = Math.ceil(S * 0.95), pitch = Math.round(S * 1.2);
    const note = Math.max(...STEPS.map((_, i) => measure(NOTE(i), MONO, 15)));
    // when a word's wordProgress reaches p (by bisection: with syllables it is piecewise)
    const when = (w: Word, p: number) => {
      let a = w.start, b = w.end;
      for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if (Words.wordProgress(w, m) < p) a = m; else b = m; }
      return b;
    };
    this.rows = lines.map((line, i) => {
      const y = Math.round(96 + 40 + S * 0.69 + i * pitch); // the first line's caps start 40 px below title-safe
      const ms: Metrics[] = line.words.map((w) => {
        const fams = STEPS.map((s) => F.archivo(...s));
        return { w, width: fams.map((f) => measure(w.w, f, S)), space: fams.map((f) => measure(' ', f, S)), at: [w.start, when(w, 0.25), when(w, 0.5)] };
      });
      // from above the ascenders to below the notes, as far right as a word (sung: widest) or its note reaches
      let x = X0, right = 0;
      for (const w of line.words) { right = Math.max(right, x + Math.max(wd(w.w, S), note)); x += wd(w.w, S) + wd(' ', S); }
      return { line, words: ms, y, key: '', layer: new Patch(96, y - asc, Math.ceil(Math.min(W - 96, right + 24) - 96), asc + 80) };
    });
    // the ruler: track names in the first 110 px, above the label
    this.rx0 = X0 + 110; this.rx1 = W - X0; this.ry = H - 230;
    this.band = new Patch(this.rx0 - 16, this.ry - 40, this.rx1 - this.rx0 + 32, 140);
    this.drawStill();
  }

  /** Video time → x on the ruler. */
  private x(t: number) { return this.rx0 + ((this.rx1 - this.rx0) * (t - this.ctx.start)) / (this.ctx.end - this.ctx.start); }

  /**
   * Where each word of a row starts at t. A word steps to a wider font at once (static instances: nothing
   * in between), but the words after it don't jump: they make room over the GLIDE seconds before the step
   * (its time is known from the data), so the wider word lands in space already open. A step widens a
   * word by up to ~115 px here, more than the word space, so room made after it would mean overlaps.
   */
  private layout(r: Row, t: number) {
    const eased = (m: Metrics, v: number[]) => {
      let x = v[0]!;
      m.at.forEach((a, k) => { x += (v[k + 1]! - v[k]!) * smootherstep(a - GLIDE, a, t); });
      return x;
    };
    const xs: number[] = [];
    let x = X0;
    r.words.forEach((m, i) => {
      // (neighbours in different fonts have no kerning between them: a word space set by eye, the mean of both fonts')
      if (i) x += (eased(r.words[i - 1]!, r.words[i - 1]!.space) + eased(m, m.space)) / 2;
      xs.push(x);
      x += eased(m, m.width);
    });
    return xs;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const { renderer, comp } = this.ctx;
    // The font steps and lit glyphs come from the frame's own time, so all of a frame's motion-blur
    // sub-frames agree (a step landing on a frame would otherwise show both fonts at once); the layout
    // glides with t itself, and blurs like any motion.
    const tf = frameTime(f.t);
    clearRT(renderer, out, LIN.bg);
    comp.draw(renderer, this.still.texture, out);
    for (const r of this.rows) {
      const st = r.line.words.map((w) => wordState(w, tf)), xs = this.layout(r, f.t);
      // the key names everything the line's layer shows, so redrawing it only when the key changes
      // keeps the frame a function of t alone (it never shows what an earlier frame drew)
      const key = st.map((s, i) => `${s.phase}${s.step}${s.lit}@${xs[i]!.toFixed(2)}`).join();
      if (key !== r.key) { r.key = key; this.drawLine(r, st, xs); r.layer.upload(); }
      comp.draw(renderer, r.layer.texture, out, { rect: r.layer.rect });
    }
    this.drawBand(f);
    comp.draw(renderer, this.band.upload(), out, { rect: this.band.rect });
  }

  private drawLine(r: Row, st: ReturnType<typeof wordState>[], xs: number[]) {
    const c = r.layer.begin(), S = this.size, y = r.y;
    r.line.words.forEach((w, i) => {
      const s = st[i]!, x = xs[i]!, fam = F.archivo(...STEPS[s.step]!), chars = Array.from(w.w);
      c.font = font(fam, S);
      if (s.lit > 0) { c.fillStyle = rgba(s.phase === 2 ? 'fg' : 'accent'); c.fillText(chars.slice(0, s.lit).join(''), x, y); }
      // the unsung rest starts where its first glyph sits in the whole word: glyphX keeps the kern
      // across the split (measuring the lit part alone would drop it)
      if (s.lit < chars.length) { c.fillStyle = rgba('fg', 0.3); c.fillText(chars.slice(s.lit).join(''), x + glyphX(w.w, s.lit, fam, S), y); }
      // the word's start time under it; the word being sung also names its font
      c.font = font(MONO, 15);
      c.fillStyle = rgba(s.phase === 1 ? 'accent' : 'muted');
      c.fillText(w.start.toFixed(2), x, y + 46);
      if (s.phase === 1) c.fillText(NOTE(s.step), x, y + 68);
    });
  }

  private drawStill() {
    const { audio, W, H, start, end } = this.ctx, c = this.still.ctx, ry = this.ry;
    this.still.clear();
    drawLabel(c, LABEL, W, H);
    c.font = font(MONO, 14);
    c.fillStyle = rgba('muted');
    c.fillText('words', X0, ry + 30);
    c.fillText('kick', X0, ry + 64);
    c.fillText('snare', X0, ry + 88);
    // the axis: a tick per beat of the data's grid, taller on downbeats, which carry the bar number
    c.strokeStyle = rgba('line');
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(this.rx0, ry + 0.5); c.lineTo(this.rx1, ry + 0.5); // (half-pixel: a 1 px line covers one row)
    for (const b of audio.beats) {
      if (b < start - 1e-6 || b > end + 1e-6) continue;
      const x = Math.round(this.x(b)) + 0.5, down = audio.downbeats.some((d) => Math.abs(d - b) < 1e-3);
      c.moveTo(x, ry - (down ? 12 : 0)); c.lineTo(x, ry + 6);
      if (down && b < end - 1e-6) c.fillText(`bar ${Math.round(audio.barAt(b)) + 1}`, x + 6, ry - 6);
    }
    c.stroke();
    // the empty tracks: a bar per word, a box per onset
    c.fillStyle = rgba('line');
    for (const w of this.words) c.fillRect(Math.round(this.x(w.start)) + 2, ry + 38, Math.round(this.x(w.end)) - Math.round(this.x(w.start)) - 4, 4);
    for (const [t] of this.kicks) c.strokeRect(Math.round(this.x(t)) - 5.5, ry + 53.5, 11, 11);
    for (const [t] of this.snares) c.strokeRect(Math.round(this.x(t)) - 3.5, ry + 79.5, 7, 7);
    this.still.upload();
  }

  private drawBand(f: Frame) {
    // (what moves follows t; what reads as a state, a word's colour or the time readout, the frame's time)
    const c = this.band.begin(), ry = this.ry, t = f.t, tf = frameTime(t);
    // words: the sung part of each bar (accent while it is being sung), the word above it, and its
    // syllable boundaries (wordProgress moves through syllables piecewise)
    c.font = font(MONO, 14);
    let cur: Word | null = null;
    for (const w of this.words) {
      const p = Words.wordProgress(w, t), x0 = Math.round(this.x(w.start)) + 2, x1 = Math.round(this.x(w.end)) - 2;
      if (w.start <= tf) cur = w;
      const ps = Words.wordProgress(w, tf);
      c.fillStyle = rgba(ps <= 0 ? 'muted' : ps < 1 ? 'accent' : 'fg');
      c.fillText(w.w, x0, ry + 30);
      if (p > 0) c.fillRect(x0, ry + 38, (x1 - x0) * p, 4);
      if (w.syl && w.syl.length > 1) for (const [a] of w.syl.slice(1)) c.fillRect(Math.round(this.x(a)), ry + 35, 1, 10);
    }
    // onsets: played ones filled; the hit flashes in the accent and fades with the drum
    const hits = (list: [number, number][], y: number, s: number) => {
      for (const [te] of list) {
        if (t < te) continue;
        const x = Math.round(this.x(te)) - s / 2, k = pulse(t, te, 0.12);
        c.fillStyle = rgba('muted');
        c.fillRect(x, y, s, s);
        if (k > 0.01) { c.fillStyle = rgba('accent', k); c.fillRect(x - 3 * k, y - 3 * k, s + 6 * k, s + 6 * k); }
      }
    };
    hits(this.kicks, ry + 53, 12);
    hits(this.snares, ry + 79, 8);
    // the playhead flashes on every drum hit (the frame's own decaying pulses, f.a), with the time and
    // the progress of the word under it
    const px = Math.round(this.x(t)) + 0.5, hit = Math.max(f.a.kick, f.a.snare);
    if (hit > 0.01) { c.fillStyle = rgba('accent', hit); c.fillRect(px - 0.5 - 2 * hit, ry - 22, 1 + 4 * hit, 118); }
    c.strokeStyle = c.fillStyle = rgba('fg');
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(px, ry - 22); c.lineTo(px, ry + 96); c.stroke();
    const p = cur ? Words.wordProgress(cur, tf) : 0;
    const txt = `${tf.toFixed(3)} s${cur && p < 1 ? ` · p ${p.toFixed(2)}` : ''}`;
    const flip = px + 6 + c.measureText(txt).width > this.band.x + this.band.w; // near the end it reads leftwards
    c.textAlign = flip ? 'right' : 'left';
    c.fillText(txt, flip ? px - 6 : px + 6, ry - 26);
  }

  override dispose() { for (const l of [this.still, this.band, ...this.rows.map((r) => r.layer)]) l.texture.dispose(); }
}
