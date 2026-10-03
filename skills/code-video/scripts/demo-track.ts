#!/usr/bin/env bun
// The example video's demo track, synthesized here so a new project previews and renders before the
// user brings any audio, with nothing third-party in it: 8 bars at 120 BPM in 4/4 (16 s) plus a
// one-second ring-out. Kick on beats 1 and 3, snare on 2 and 4, hats on the eighths, one bass note per
// bar (the root moves every 2 bars: A, F, C, G), a last hit on the downbeat of bar 9 that rings out.
// Deterministic (seeded noise, no dependencies): the same bytes on every run.
//
// It writes, inside a video folder:
//   audio/demo.wav     48 kHz mono 16-bit
//   data/audio.json    exact beats, downbeats, 4 sections (A-D, 2 bars each), envelopes at 100 fps
//                      (rms low mid high drums bass, measured on the synthesized parts, 0..1; vocal and
//                      other 0) and onsets (kick snare hat, [t, strength]), in the engine's AudioJSON format
//   data/words.json    "Every frame / is a function / of time." on the beats of bars 5-6
//
//   bun demo-track.ts <videoDir>        e.g. bun demo-track.ts videos/example
// init.ts calls makeDemoTrack(videoDir).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SR = 48000; // sample rate (Hz)
const BPM = 120, BEAT = 60 / BPM, BAR = 4 * BEAT, BARS = 8;
const RING = 1.0; // seconds after the last bar: the final hit decays here
const DURATION = BARS * BAR + RING; // 17 s
const FPS = 100; // envelope frames per second (what the engine's AudioData reads)
const N = Math.round(DURATION * SR);
const ROOTS = [55.0, 43.654, 65.406, 48.999]; // A1 F1 C2 G1: one per 2 bars

/** Seeded noise (mulberry32): the track is identical on every run. */
function noise(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

/** The parts, separately (their envelopes are measured one by one), each as a Float64Array of N samples. */
function synthesize() {
  const kick = new Float64Array(N), snare = new Float64Array(N), hat = new Float64Array(N), bass = new Float64Array(N), crash = new Float64Array(N);
  const rnd = noise(20261002);
  /** Add `len` seconds of `fn(tau)` at time t0 into `buf`. */
  const add = (buf: Float64Array, t0: number, len: number, fn: (tau: number, n: number) => number) => {
    const n0 = Math.round(t0 * SR), n1 = Math.min(N, n0 + Math.round(len * SR));
    for (let n = n0; n < n1; n++) buf[n]! += fn((n - n0) / SR, n);
  };
  const kickAt = (t0: number, gain = 1) => {
    let ph = 0;
    add(kick, t0, 0.6, (tau) => {
      ph += (2 * Math.PI * (48 + 100 * Math.exp(-tau / 0.04))) / SR; // pitch drops fast: the thump
      return gain * (Math.sin(ph) * Math.exp(-tau / 0.22) + 0.25 * Math.exp(-tau / 0.003) * rnd());
    });
  };
  const snareAt = (t0: number) => {
    let prev = 0;
    add(snare, t0, 0.35, (tau) => {
      const w = rnd(), hp = w - prev; // first difference: a brighter noise
      prev = w;
      return (0.25 * w + 0.35 * hp) * Math.exp(-tau / 0.1) + 0.35 * Math.sin(2 * Math.PI * 185 * tau) * Math.exp(-tau / 0.06);
    });
  };
  const hatAt = (t0: number, gain: number) => {
    let prev = 0;
    add(hat, t0, 0.12, (tau) => { const w = rnd(), hp = w - prev; prev = w; return gain * hp * Math.exp(-tau / 0.022); });
  };
  const bassNote = (t0: number, f: number, len: number, env: (tau: number) => number) =>
    add(bass, t0, len, (tau) => {
      const p = 2 * Math.PI * f * tau;
      return env(tau) * (Math.sin(p) + 0.45 * Math.sin(2 * p) + 0.2 * Math.sin(3 * p) + 0.08 * Math.sin(4 * p));
    });
  for (let b = 0; b < BARS; b++) {
    const t0 = b * BAR;
    kickAt(t0); kickAt(t0 + 2 * BEAT);
    snareAt(t0 + BEAT); snareAt(t0 + 3 * BEAT);
    for (let e = 0; e < 8; e++) hatAt(t0 + (e * BEAT) / 2, e % 2 ? 0.55 : 0.8);
    // held for the bar, released just before the next note
    bassNote(t0, ROOTS[Math.floor(b / 2)]!, BAR, (tau) => Math.min(1, tau / 0.008) * (0.75 + 0.25 * Math.exp(-tau / 0.25)) * Math.min(1, Math.max(0, (BAR - 0.04 - tau) / 0.1)));
  }
  // the last hit, on the downbeat of bar 9: kick, the root and a soft cymbal, decaying through the ring-out
  const end = BARS * BAR;
  kickAt(end);
  bassNote(end, ROOTS[0]!, RING, (tau) => Math.min(1, tau / 0.008) * Math.exp(-tau / 0.35) * Math.min(1, (RING - tau) / 0.05));
  {
    let prev = 0;
    add(crash, end, RING, (tau) => { const w = rnd(), hp = w - prev; prev = w; return hp * Math.exp(-tau / 0.45) * Math.min(1, (RING - tau) / 0.05); });
  }
  return { kick, snare, hat, bass, crash };
}

/** RMS per envelope frame (a 20 ms window centred on each frame), normalized to 0..1 by its peak. */
function envelope(x: Float64Array, frames: number) {
  const out = new Array<number>(frames).fill(0), half = Math.round(0.01 * SR);
  for (let i = 0; i < frames; i++) {
    const c = Math.round((i / FPS) * SR);
    let s = 0, k = 0;
    for (let n = Math.max(0, c - half); n < Math.min(N, c + half); n++) { s += x[n]! * x[n]!; k++; }
    out[i] = k ? Math.sqrt(s / k) : 0;
  }
  const peak = Math.max(...out) || 1;
  return out.map((v) => Math.round((v / peak) * 1000) / 1000);
}

function wav(x: Float64Array): Uint8Array {
  const buf = new ArrayBuffer(44 + 2 * N), v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + 2 * N, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, 2 * N, true);
  for (let n = 0; n < N; n++) v.setInt16(44 + 2 * n, Math.round(Math.max(-1, Math.min(1, x[n]!)) * 32767), true);
  return new Uint8Array(buf);
}

/** Write the demo track and its timing data into `videoDir` (a video folder). Returns the files written. */
export function makeDemoTrack(videoDir: string): string[] {
  const p = synthesize();
  const L = { kick: 0.9, snare: 0.55, hat: 0.22, bass: 0.42, crash: 0.12 }; // mix levels
  const mix = new Float64Array(N), low = new Float64Array(N), mid = new Float64Array(N), high = new Float64Array(N), drums = new Float64Array(N), bass = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    const k = L.kick * p.kick[n]!, s = L.snare * p.snare[n]!, h = L.hat * p.hat[n]!, b = L.bass * p.bass[n]!, c = L.crash * p.crash[n]!;
    mix[n] = k + s + h + b + c;
    low[n] = k + b; mid[n] = s; high[n] = h + c; drums[n] = k + s + h + c; bass[n] = b;
  }
  // Level: a true peak under -1 dBTP (the mix rule: above it a lossy encode can clip, and qc.py says so)
  // without going quiet (qc.py notes anything under -18 LUFS). The kicks' attacks set the peak, so a soft
  // knee rounds off everything above half of it (tanh, slope 1 at the knee: a mild saturation of the
  // attack), then the sample peak goes to -1.8 dBFS. Measured: -1.5 dBTP in the WAV, -1.6 in render.ts's
  // 320 kb/s AAC, -17.7 LUFS. The last 20 ms fade to silence (no click at the file's end).
  let peak = 0;
  for (let n = 0; n < N; n++) peak = Math.max(peak, Math.abs(mix[n]!));
  const KNEE = 0.5;
  const soft = (x: number) => { const a = Math.abs(x); return a <= KNEE ? x : Math.sign(x) * (KNEE + (1 - KNEE) * Math.tanh((a - KNEE) / (1 - KNEE))); };
  let limited = 0;
  for (let n = 0; n < N; n++) { mix[n] = soft(mix[n]! / peak); limited = Math.max(limited, Math.abs(mix[n]!)); }
  const g = Math.pow(10, -1.8 / 20) / limited, fade = Math.round(0.02 * SR);
  for (let n = 0; n < N; n++) mix[n] = mix[n]! * g * Math.min(1, (N - 1 - n) / fade);

  const frames = Math.floor(DURATION * FPS) + 1;
  const zero = new Array<number>(frames).fill(0);
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const beats: number[] = [];
  for (let i = 0; i * BEAT < DURATION - 1e-9; i++) beats.push(r3(i * BEAT));
  const kicks: [number, number][] = [], snares: [number, number][] = [], hats: [number, number][] = [];
  for (let b = 0; b < BARS; b++) {
    const t0 = b * BAR;
    kicks.push([r3(t0), 1], [r3(t0 + 2 * BEAT), 1]);
    snares.push([r3(t0 + BEAT), 0.9], [r3(t0 + 3 * BEAT), 0.9]);
    for (let e = 0; e < 8; e++) hats.push([r3(t0 + (e * BEAT) / 2), e % 2 ? 0.4 : 0.6]);
  }
  kicks.push([r3(BARS * BAR), 1]);
  const audio = {
    duration: DURATION,
    bpm: BPM,
    beat_period: BEAT,
    time_signature: 4,
    fps: FPS,
    beats,
    downbeats: beats.filter((_, i) => i % 4 === 0),
    // (the last section runs through the ring-out: the engine's sections are contiguous from 0 to the duration)
    sections: ['A', 'B', 'C', 'D'].map((name, i) => ({ name, start: i * 2 * BAR, end: i === 3 ? DURATION : (i + 1) * 2 * BAR })),
    features: {
      rms: envelope(mix, frames), low: envelope(low, frames), mid: envelope(mid, frames), high: envelope(high, frames),
      vocal: zero, drums: envelope(drums, frames), bass: envelope(bass, frames), other: zero,
    },
    onsets: { kick: kicks, snare: snares, hat: hats },
    notes: 'Synthetic demo track (skills/code-video/scripts/demo-track.ts): exact grid, envelopes measured on the synthesized parts (low = kick + bass, mid = snare, high = hats + cymbal), each normalized to its peak.',
  };
  // one word per beat over bars 5-6 (8-12 s); two-syllable words carry their syllables
  const w = (text: string, start: number, end: number, syl?: [number, number][]) => ({ w: text, start, end, conf: 1, ...(syl ? { syl } : {}) });
  const line = (i: number, words: ReturnType<typeof w>[]) =>
    ({ i, text: words.map((x) => x.w).join(' '), start: words[0]!.start, end: words[words.length - 1]!.end, words });
  const words = {
    lines: [
      line(0, [w('Every', 8.0, 8.5, [[8.0, 8.25], [8.25, 8.5]]), w('frame', 8.5, 9.0)]),
      line(1, [w('is', 9.0, 9.5), w('a', 9.5, 10.0), w('function', 10.0, 10.5, [[10.0, 10.25], [10.25, 10.5]])]),
      line(2, [w('of', 10.5, 11.0), w('time.', 11.0, 11.75)]),
    ],
    notes: 'Demo words for the example video, timed to the beats of bars 5-6 (skills/code-video/scripts/demo-track.ts).',
  };
  const files = [path.join(videoDir, 'audio', 'demo.wav'), path.join(videoDir, 'data', 'audio.json'), path.join(videoDir, 'data', 'words.json')];
  mkdirSync(path.dirname(files[0]!), { recursive: true });
  mkdirSync(path.dirname(files[1]!), { recursive: true });
  writeFileSync(files[0]!, wav(mix));
  writeFileSync(files[1]!, JSON.stringify(audio));
  writeFileSync(files[2]!, JSON.stringify(words, null, 2));
  return files;
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: bun demo-track.ts <videoDir>   (e.g. videos/example: writes audio/demo.wav, data/audio.json, data/words.json)');
    process.exit(1);
  }
  for (const f of makeDemoTrack(path.resolve(dir))) console.log(f);
}
