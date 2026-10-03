// The soundtrack: the video's audio as segments, as video.json gives it. A single file is one segment
// from 0 for the file's own length; a list splices several files (each trimmed, placed at its video
// time, with an optional fade-out, silence between them: never a mix); no audio is a silent clock.
// The preview plays them with SoundtrackPlayer; the export never plays anything: scripts/render.ts
// builds the same splice with ffmpeg from the same list (window.__audara.audio).
import type { SegmentSpec, VideoConfig } from '../video';

export interface Segment {
  /** The audio file relative to the project root (what ffmpeg reads), and its URL on the dev server. */
  file: string;
  url: string;
  /** Video time (s) where the segment starts. */
  at: number;
  /** Where in the file it starts, and for how long it plays. */
  from: number;
  dur: number;
  /** Linear fade-out over the segment's last `fadeOut` seconds. */
  fadeOut?: number;
}

/** Video time where the last segment ends. */
export const segmentsEnd = (segs: Segment[]) => segs.reduce((m, s) => Math.max(m, s.at + s.dur), 0);

/** Gain of segment `s` at video time t (1 inside, ramping down over its fade-out). */
export const segmentGain = (s: Segment, t: number) =>
  s.fadeOut ? Math.max(0, Math.min(1, (s.at + s.dur - t) / s.fadeOut)) : 1;

/** Length (s) of an audio file, from its metadata; null when it can't be read. */
export function fileDuration(url: string, timeoutMs = 15000): Promise<number | null> {
  return new Promise((resolve) => {
    const a = new Audio();
    a.preload = 'metadata';
    const done = (d: number | null) => { clearTimeout(timer); a.onloadedmetadata = a.onerror = null; a.removeAttribute('src'); resolve(d); };
    const timer = setTimeout(() => done(null), timeoutMs);
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) && a.duration > 0 ? a.duration : null);
    a.onerror = () => done(null);
    a.src = url;
  });
}

/**
 * The video's segments with every length known (a single file: its own length, from its metadata).
 * `problems` names the files that can't be read: the video plays silent there, and render.ts refuses.
 */
export async function loadSegments(specs: SegmentSpec[] | null): Promise<{ segments: Segment[] | null; problems: string[] }> {
  if (!specs?.length) return { segments: null, problems: [] };
  const problems: string[] = [];
  const lengths = new Map<string, number | null>();
  for (const s of specs) if (!lengths.has(s.url)) lengths.set(s.url, await fileDuration(s.url));
  const segments: Segment[] = [];
  for (const s of specs) {
    const len = lengths.get(s.url);
    if (len == null) { problems.push(`audio: cannot read ${s.file} (named in video.json): is the file there, and is it audio?`); continue; }
    const dur = s.dur ?? Math.max(0, len - s.from);
    segments.push({ file: s.file, url: s.url, at: s.at, from: s.from, dur, ...(s.fadeOut ? { fadeOut: s.fadeOut } : {}) });
  }
  return { segments: segments.length ? segments : null, problems };
}

/** Where the video's length came from. */
export type DurationSource = 'video.json' | 'segments' | 'data/audio.json' | 'audio file';

/**
 * The video's length: video.json `duration` > the end of a segment list > data/audio.json `duration`
 * (`analysis`, null when there is none) > the single audio file's own length. null: nothing says.
 */
export function resolveDuration(v: VideoConfig, segments: Segment[] | null, analysis: number | null): { duration: number; source: DurationSource } | null {
  if (v.duration) return { duration: v.duration, source: 'video.json' };
  const list = !!v.audio && !(v.audio.length === 1 && v.audio[0]!.dur === undefined);
  if (list && segments) return { duration: segmentsEnd(segments), source: 'segments' };
  if (analysis && analysis > 0) return { duration: analysis, source: 'data/audio.json' };
  if (segments) return { duration: segmentsEnd(segments), source: 'audio file' };
  return null;
}

/**
 * Preview playback of the segments against one clock: performance.now(), steered by the audio. While
 * playing, the picture's time only moves forward (a step back would count as a seek: stateful scenes
 * would re-simulate mid-play). While a segment plays, each new position its audio element reports steers
 * the clock: it runs up to 5% faster or slower until it agrees with what is heard (over about half a
 * second). A segment asked to play but not audible yet (play()'s start-up delay, a seek) holds the picture
 * where its sound will start, for up to a second. A clock more than 0.15 s off jumps to the audio (a
 * stall or a skip, the one case where time steps back). In silence (no audio, gaps, past a file's end)
 * the clock runs on its own.
 */
export class SoundtrackPlayer {
  private els: HTMLAudioElement[];
  /** Per element: the last position seen; since when it is starting (asked to play, not audible yet), and where the picture waits meanwhile. */
  private seen: { pos: number; starting: number; hold: number }[];
  /** The clock: video time t0 at performance.now() p0, running at `rate`. */
  private t0 = 0;
  private p0 = 0;
  private rate = 1;
  playing = false;

  constructor(private segs: Segment[], public duration: number) {
    this.els = segs.map((s) => { const a = new Audio(s.url); a.preload = 'auto'; return a; });
    this.seen = segs.map(() => ({ pos: -1, starting: 0, hold: 0 }));
  }

  /** The video time now. */
  now() { return this.playing ? this.t0 + ((performance.now() - this.p0) / 1000) * this.rate : this.t0; }
  private anchor(t: number, p = performance.now(), rate = 1) { this.t0 = t; this.p0 = p; this.rate = rate; }
  seek(t: number) { this.anchor(Math.max(0, Math.min(this.duration, t))); this.sync(true); }
  play() {
    this.anchor(this.t0 >= this.duration - 1e-3 ? 0 : this.t0); // (at the end: play from the start)
    this.playing = true; this.sync(true);
  }
  pause() { this.anchor(this.now()); this.playing = false; this.sync(true); }

  /** Keep the elements in step with the clock and the clock on the audio (call once per frame before now()). */
  sync(force = false) {
    const p = performance.now();
    let t = this.now();
    if (this.playing && t >= this.duration) { this.anchor(this.duration, p); this.playing = false; t = this.duration; }
    let steered = false, audible = false;
    this.segs.forEach((s, i) => {
      const el = this.els[i]!, seen = this.seen[i]!;
      const inside = this.playing && t >= s.at && t < s.at + s.dur;
      const local = s.from + (t - s.at);
      // (a file shorter than its segment just ends: don't restart it every frame)
      if (!inside || (Number.isFinite(el.duration) && local >= el.duration - 0.02)) { if (!el.paused) el.pause(); seen.starting = 0; return; }
      el.volume = segmentGain(s, t);
      if (el.paused || force || Math.abs(el.currentTime - local) > 0.25) {
        el.currentTime = local;
        if (el.paused) el.play().catch(() => { seen.starting = 0; }); // (blocked autoplay: the picture runs on, silent)
        // (the element may round the position down a little: the picture never waits behind where it is)
        seen.pos = el.currentTime; seen.starting = p; seen.hold = Math.max(t, s.at + seen.pos - s.from);
        return;
      }
      audible = true;
      if (steered) return;
      const pos = el.currentTime;
      if (seen.starting) {
        // (rate 0: held exactly still, not re-anchored to a slightly different time each frame)
        if (pos === seen.pos && p - seen.starting < 1000) { this.anchor(seen.hold, p, 0); steered = true; return; }
        seen.starting = 0;
        this.anchor(t, p); // the sound started, or a second passed without it: the clock runs on from here
      }
      if (pos === seen.pos) return; // (the position moves in coarse steps: steer on each new one)
      seen.pos = pos;
      const heard = s.at + pos - s.from, err = heard - t;
      if (Math.abs(err) > 0.15) this.anchor(heard, p);
      else this.anchor(t, p, 1 + Math.max(-0.05, Math.min(0.05, err / 0.5)));
      steered = true;
    });
    if (!audible && this.rate !== 1) this.anchor(t, p); // (silence: the clock's own pace)
  }
}
