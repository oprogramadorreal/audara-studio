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

/** Why an audio file's length wasn't read. */
export type Unread = 'missing' | 'not audio' | 'not read yet';

/**
 * Length (s) of an audio file, from its metadata, or why it wasn't read: 'not read yet' when no answer
 * came within `timeoutMs` or the read broke off (a dev server busy with a cold first load once took longer
 * than 15 s to answer a file that was there). A file the browser refuses is asked for once more, a byte of
 * it, to tell 'missing' (404, or a page served in its place) from 'not audio' (there, but nothing the
 * browser plays: an empty file, whose byte the server can't give (416), or one still being written).
 */
export async function readLength(url: string, timeoutMs = 15000): Promise<number | Unread> {
  const got = await new Promise<number | 'refused' | 'not read yet'>((resolve) => {
    const a = new Audio();
    a.preload = 'metadata';
    const done = (d: number | 'refused' | 'not read yet') => {
      clearTimeout(timer);
      a.onloadedmetadata = a.onerror = null;
      a.removeAttribute('src');
      a.load(); // (stops a read still under way, so a later try doesn't queue behind it)
      resolve(d);
    };
    const timer = setTimeout(() => done('not read yet'), timeoutMs);
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 'refused');
    a.onerror = () => done(a.error?.code === 2 ? 'not read yet' : 'refused'); // (2: MEDIA_ERR_NETWORK, the read broke off)
    a.src = url;
  });
  if (got !== 'refused') return got;
  try {
    const r = await fetch(url, { headers: { range: 'bytes=0-0' }, signal: AbortSignal.timeout(timeoutMs) });
    void r.body?.cancel();
    if (r.status === 404 || (r.headers.get('content-type') ?? '').includes('text/html')) return 'missing';
    return r.ok || r.status === 416 ? 'not audio' : 'not read yet';
  } catch {
    return 'not read yet';
  }
}

const UNREAD: Record<Unread, string> = {
  missing: 'is missing',
  'not audio': "isn't audio the browser can play",
  'not read yet': "hasn't been read yet: the read didn't complete",
};

/**
 * The video's segments with every length known (a single file: its own length, from its metadata).
 * `problems` names each file not read and why (readLength): the video plays silent there, the preview
 * (src/main.ts) reads it again until it is, and render.ts refuses.
 */
export async function loadSegments(specs: SegmentSpec[] | null): Promise<{ segments: Segment[] | null; problems: string[] }> {
  if (!specs?.length) return { segments: null, problems: [] };
  const problems: string[] = [];
  const lengths = new Map<string, number | Unread>();
  for (const s of specs) if (!lengths.has(s.url)) lengths.set(s.url, await readLength(s.url));
  const segments: Segment[] = [];
  for (const s of specs) {
    const len = lengths.get(s.url)!;
    if (typeof len !== 'number') { problems.push(`audio: ${s.file} (named in video.json) ${UNREAD[len]}`); continue; }
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

/** Seconds the clock may be off the sound before it is steered: about the noise in the audio element's position. */
export const STEER_DEADBAND = 0.02;
/** How much faster or slower the clock runs while it is steered back (0.005: a frame at 60 fps in 3.3 s). */
export const STEER_RATE = 0.005;

/**
 * Preview playback of the segments against one clock: performance.now(), or the time the caller gives
 * (the player passes requestAnimationFrame's timestamp, the display's refresh, which doesn't jitter the
 * way the moment a callback runs does), steered by the audio. While playing, the picture's time only
 * moves forward (a step back would count as a seek: stateful scenes would re-simulate mid-play). While a
 * segment plays, the positions its audio element reports are averaged (each is late by up to one of the
 * element's coarse steps), and only when the average is more than STEER_DEADBAND off does the clock run
 * STEER_RATE faster or slower, until it is back within a quarter of that: the picture's own pace never
 * wavers with the noise, and a drift is made up a frame at a time. (It ran up to 5% faster or slower on
 * every new position before: a preview that played 60 fps footage repeated or skipped a frame on 10-15%
 * of its refreshes.) A segment asked to play but not audible yet (play()'s start-up delay, a seek) holds
 * the picture where its sound will start, for up to a second. A clock more than 0.15 s off jumps to the
 * audio (a stall or a skip, the one case where time steps back). In silence (no audio, gaps, past a
 * file's end) the clock runs on its own.
 */
export class SoundtrackPlayer {
  private els: HTMLAudioElement[];
  /** Per element: the last position seen; since when it is starting (asked to play, not audible yet), and where the picture waits meanwhile. */
  private seen: { pos: number; starting: number; hold: number }[];
  /** The clock: video time t0 at performance.now() p0, running at `rate`. */
  private t0 = 0;
  private p0 = 0;
  private rate = 1;
  /** The clock's average error against the sound (s, + when the sound is ahead), and how many positions it averages so far. */
  private err = 0;
  private errN = 0;
  playing = false;

  constructor(private segs: Segment[], public duration: number) {
    this.els = segs.map((s) => { const a = new Audio(s.url); a.preload = 'auto'; return a; });
    this.seen = segs.map(() => ({ pos: -1, starting: 0, hold: 0 }));
  }

  /** The video time now, or at `at` (a performance.now() time; never before the clock was last set). */
  now(at = performance.now()) { return this.playing ? this.t0 + (Math.max(0, at - this.p0) / 1000) * this.rate : this.t0; }
  /** Set the clock (t at p, at `rate`); `fresh`: the sound is heard from another place, so its error is averaged anew. */
  private anchor(t: number, p = performance.now(), rate = 1, fresh = true) {
    this.t0 = t; this.p0 = p; this.rate = rate;
    if (fresh) this.errN = 0;
  }
  seek(t: number) { this.anchor(Math.max(0, Math.min(this.duration, t))); this.sync(true); }
  play() {
    this.anchor(this.t0 >= this.duration - 1e-3 ? 0 : this.t0); // (at the end: play from the start)
    this.playing = true; this.sync(true);
  }
  pause() { this.anchor(this.now()); this.playing = false; this.sync(true); }

  /**
   * Keep the elements in step with the clock and the clock on the audio (call once per frame before now(),
   * with the same `at`: the player gives both requestAnimationFrame's timestamp).
   */
  sync(force = false, at?: number) {
    const p = Math.max(at ?? performance.now(), this.playing ? this.p0 : -Infinity);
    let t = this.now(p);
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
      if (pos === seen.pos) return; // (the position moves in coarse steps: average each new one)
      seen.pos = pos;
      steered = true;
      const heard = s.at + pos - s.from, err = heard - t;
      if (Math.abs(err) > 0.15) { this.anchor(heard, p); return; }
      // (the mean of the first positions, then of about the latest 32)
      this.errN++;
      this.err = this.errN === 1 ? err : this.err + (err - this.err) / Math.min(this.errN, 32);
      if (this.errN < 8) return;
      const off = Math.abs(this.err), dir = Math.sign(this.err);
      const rate = off > STEER_DEADBAND ? 1 + dir * STEER_RATE // (off: steered back)
        : this.rate !== 1 && Math.sign(this.rate - 1) === dir && off > STEER_DEADBAND / 4 ? this.rate // (on its way back)
        : 1;
      if (rate !== this.rate) this.anchor(t, p, rate, false);
    });
    if (!audible && this.rate !== 1) this.anchor(t, p); // (silence: the clock's own pace)
  }
}
