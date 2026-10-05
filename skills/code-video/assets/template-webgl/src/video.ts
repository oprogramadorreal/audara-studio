// The project's videos. Every folder videos/<video>/ with a video.json is one video: its timeline
// (timeline.ts), its scenes, audio and timing data. The preview picks one with ?v=<video>,
// scripts/render.ts with --video <video>; without one, both take the only video, else the first one
// (alphabetically) that isn't `example`, else `example`.
// Engine modules read the selected video's size and fps when they load (gl.ts sizes its targets at
// module load), so the selection is synchronous: the video.json files are bundled (eager glob), as text,
// so a broken one is reported by name instead of stopping the page.
// Only types are imported from the engine, so engine modules can import this one without a cycle.
import type { TimelineEntry } from './engine/engine';
import type { Words } from './engine/words';
import type { AudioData } from './engine/audio';

/** One piece of a soundtrack as video.json writes it; `file` is relative to the video's folder. */
export interface SegmentJSON {
  file: string;
  /** Video time (s) where it starts. */
  at: number;
  /** Where in the file it starts (s, default 0), and for how long it plays. */
  from?: number;
  dur: number;
  /** Linear fade-out over the segment's last `fadeOut` seconds. */
  fadeOut?: number;
}

/** videos/<video>/video.json (every field optional). */
export interface VideoJSON {
  title?: string;
  /** The logical frame scenes lay out in, [width, height] px (default [1920, 1080]). */
  size?: [number, number];
  /** The export's frame rate and the rate frameIdx() counts in (default 60). */
  fps?: number;
  /** One file played from 0 ('audio/song.mp3'), a list of segments, or null/absent for silence. */
  audio?: string | SegmentJSON[] | null;
  /** The video's length in seconds; wins over everything (needed when there is no audio and no analysis). */
  duration?: number;
  /** Tempo of the beat grid used when data/audio.json is missing (default 120). */
  bpm?: number;
}

/**
 * A soundtrack segment, normalized: `file` relative to the project root (what ffmpeg reads), `url` to
 * fetch it from the dev server. A single-file soundtrack is one segment from 0 without `dur`: it plays
 * for the file's own length (read from its metadata at boot, see engine/soundtrack.ts).
 */
export interface SegmentSpec { file: string; url: string; at: number; from: number; dur?: number; fadeOut?: number }

/** The selected video's config with defaults applied. */
export interface VideoConfig {
  name: string;
  /** Project-relative folder ('videos/example'), which is also its URL path on the dev server. */
  dir: string;
  title: string;
  size: [number, number];
  fps: number;
  audio: SegmentSpec[] | null;
  duration?: number;
  bpm: number;
}

/** A video's timeline: the default export of videos/<video>/timeline.ts. */
export type MakeTimeline = (words: Words, audio: AudioData) => TimelineEntry[];

const CONFIGS = import.meta.glob<string>('/videos/*/video.json', { eager: true, query: '?raw', import: 'default' });
const TIMELINES = import.meta.glob<{ default: MakeTimeline }>('/videos/*/timeline.ts');
// (keys only, nothing is loaded: which data files exist, so a missing one is never requested)
const DATA_FILES = new Set(Object.keys(import.meta.glob('/videos/*/data/*.json')));
const BASE = import.meta.env.BASE_URL;

/** Every video in the project (folder names, sorted). */
export const VIDEOS: string[] = Object.keys(CONFIGS).map((k) => k.split('/')[2]!).sort();

/** The default rule shared with scripts/render.ts: the only video, else the first that isn't `example`, else `example`. */
export function defaultVideo(names: string[]): string | undefined {
  if (names.length <= 1) return names[0];
  return names.find((n) => n !== 'example') ?? 'example';
}

const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);

/** Why the selected video can't play (an unknown ?v=, no videos, a broken video.json), or null. */
export let VIDEO_ERROR: string | null = null;

/** `a/b/../c` -> `a/c`; null if the path leaves the project. */
function joinPath(dir: string, rel: string): string | null {
  const out: string[] = [];
  for (const p of `${dir}/${rel}`.split(/[\\/]+/)) {
    if (p === '' || p === '.') continue;
    if (p === '..') { if (!out.length) return null; out.pop(); } else out.push(p);
  }
  return out.join('/');
}

function normalize(name: string, j: VideoJSON): VideoConfig {
  const dir = `videos/${name}`, where = `${dir}/video.json`;
  const bad: string[] = [];
  const pos = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;
  let size: [number, number] = [1920, 1080];
  if (j.size !== undefined) {
    const s = j.size as unknown;
    if (Array.isArray(s) && s.length === 2 && s.every((x) => Number.isInteger(x) && x >= 16 && x % 2 === 0)) size = [s[0], s[1]];
    else bad.push(`"size" must be [width, height] in even whole pixels (H.264 needs even sizes), e.g. [1920, 1080] or [1080, 1920]`);
  }
  let fps = 60;
  if (j.fps !== undefined) { if (pos(j.fps)) fps = j.fps; else bad.push(`"fps" must be a positive number, e.g. 60`); }
  let bpm = 120;
  if (j.bpm !== undefined) { if (pos(j.bpm)) bpm = j.bpm; else bad.push(`"bpm" must be a positive number`); }
  let duration: number | undefined;
  if (j.duration !== undefined && j.duration !== null) { if (pos(j.duration)) duration = j.duration; else bad.push(`"duration" must be a positive number of seconds`); }
  const seg = (file: unknown, at: number, from: number, dur?: number, fadeOut?: number): SegmentSpec | null => {
    const f = typeof file === 'string' && file ? joinPath(dir, file) : null;
    if (!f) { bad.push(`audio file ${JSON.stringify(file)} must be a path inside the project, relative to ${dir}/ (e.g. "audio/song.mp3")`); return null; }
    return { file: f, url: BASE + f.split('/').map(encodeURIComponent).join('/'), at, from, ...(dur !== undefined ? { dur } : {}), ...(fadeOut ? { fadeOut } : {}) };
  };
  let audio: SegmentSpec[] | null = null;
  if (typeof j.audio === 'string') {
    const s = seg(j.audio, 0, 0);
    audio = s ? [s] : null;
  } else if (Array.isArray(j.audio)) {
    audio = [];
    j.audio.forEach((x, i) => {
      const ok = x && typeof x === 'object' && typeof x.at === 'number' && x.at >= 0 && pos(x.dur) && (x.from === undefined || (typeof x.from === 'number' && x.from >= 0)) && (x.fadeOut === undefined || (typeof x.fadeOut === 'number' && x.fadeOut >= 0));
      if (!ok) { bad.push(`audio[${i}] must be { "file": "audio/a.mp3", "at": <video s>, "from": <file s, default 0>, "dur": <s>, "fadeOut"?: <s> }`); return; }
      const s = seg(x.file, x.at, x.from ?? 0, x.dur, x.fadeOut);
      if (s) audio!.push(s);
    });
    audio.sort((a, b) => a.at - b.at);
    // segments follow one another (silence between them is fine): the preview would play an overlap as a
    // mix, the export would cut it, and a soundtrack is spliced, never mixed (mix the files first)
    for (let i = 1; i < audio.length; i++) {
      const a = audio[i - 1]!, b = audio[i]!;
      if (b.at < a.at + a.dur! - 1e-6) bad.push(`audio segments must not overlap: ${b.file} starts at ${b.at} s, before ${a.file} (from ${a.at} s) ends at ${+(a.at + a.dur!).toFixed(6)} s`);
    }
    if (!audio.length) audio = null;
  } else if (j.audio !== undefined && j.audio !== null) bad.push(`"audio" must be a file ("audio/song.mp3"), a list of segments, or null`);
  if (bad.length) VIDEO_ERROR = `${where}:\n  ${bad.join('\n  ')}`;
  return { name, dir, title: typeof j.title === 'string' && j.title ? j.title : name, size, fps, audio, duration, bpm };
}

function select(): VideoConfig {
  const asked = params.get('v');
  const name = asked ?? defaultVideo(VIDEOS);
  const placeholder: VideoConfig = { name: name ?? '', dir: `videos/${name ?? ''}`, title: 'audara', size: [1920, 1080], fps: 60, audio: null, bpm: 120 };
  if (!VIDEOS.length) { VIDEO_ERROR = 'No videos in this project: add videos/<video>/video.json (see docs/ENGINE.md).'; return placeholder; }
  if (!name || !VIDEOS.includes(name)) {
    VIDEO_ERROR = `Unknown video ${JSON.stringify(asked)} (?v=). The videos here: ${VIDEOS.join(', ')}.`;
    return placeholder;
  }
  let j: VideoJSON = {};
  try {
    // (without the byte-order mark Windows PowerShell 5.1 puts at the start of a file it writes as UTF-8,
    // which the text keeps and JSON.parse refuses)
    const parsed: unknown = JSON.parse((CONFIGS[`/videos/${name}/video.json`] ?? '{}').replace(/^\uFEFF/, ''));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) j = parsed as VideoJSON;
    else VIDEO_ERROR = `videos/${name}/video.json must hold an object, e.g. { "title": "Teaser", "size": [1920, 1080], "fps": 60, "audio": "audio/song.mp3" }`;
  } catch (e) {
    VIDEO_ERROR = `videos/${name}/video.json is not valid JSON: ${(e as Error).message}`;
  }
  const v = normalize(name, j);
  // ?fps= (scripts/render.ts --fps): export at another rate, with frameIdx() counting in it
  const fps = Number(params.get('fps'));
  if (params.has('fps') && Number.isFinite(fps) && fps > 0) v.fps = fps;
  // ?size=<w>x<h> (scripts/render.ts --size): the video in another format, on the same timeline, sound and
  // data, its scenes laid out for that frame (they read W and H from engine/gl.ts)
  const size = params.get('size');
  if (size !== null) {
    const m = /^(\d+)x(\d+)$/.exec(size.trim()), w = m ? +m[1]! : 0, h = m ? +m[2]! : 0;
    if (w >= 16 && h >= 16 && w % 2 === 0 && h % 2 === 0) v.size = [w, h];
    else VIDEO_ERROR ??= `?size=${size}: <width>x<height> in even whole pixels (H.264 needs even sizes), e.g. 1080x1920`;
  }
  return v;
}

/** The selected video. */
export const VIDEO: VideoConfig = select();

/** Its timing data, or null where the file doesn't exist (no analysis yet: a beat grid at `bpm`; no lines). */
export const DATA_URLS: { audio: string | null; words: string | null } = {
  audio: DATA_FILES.has(`/${VIDEO.dir}/data/audio.json`) ? `${BASE}${VIDEO.dir}/data/audio.json` : null,
  words: DATA_FILES.has(`/${VIDEO.dir}/data/words.json`) ? `${BASE}${VIDEO.dir}/data/words.json` : null,
};

/** The selected video's timeline (videos/<video>/timeline.ts, loaded lazily so a broken one is reported, not fatal to the page). */
export async function loadTimeline(): Promise<MakeTimeline> {
  const load = TIMELINES[`/${VIDEO.dir}/timeline.ts`];
  if (!load) throw new Error(`${VIDEO.dir}/timeline.ts not found: every video needs one (default export: (words, audio) => TimelineEntry[]).`);
  const m = await load();
  if (typeof m.default !== 'function') throw new Error(`${VIDEO.dir}/timeline.ts must default-export a function (words, audio) => TimelineEntry[].`);
  return m.default;
}
