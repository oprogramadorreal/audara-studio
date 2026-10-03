// The example's timeline: one scene per way of drawing, two bars each, hard cuts on downbeats.
// Every cut comes from the beat grid (data/audio.json, or the bpm grid without it), never from typed
// seconds, so the timeline follows the music when the data changes.
import type { TimelineEntry } from '../../src/engine/engine';
import type { Words } from '../../src/engine/words';
import type { AudioData } from '../../src/engine/audio';

// Scenes load by URL when the video boots, so a missing or broken one is reported without stopping the
// page. Nothing ties this file to them for the dev server (an import.meta.glob would tie every file in
// scenes/ to the timeline), so saving a scene, or a helper it imports, hot-swaps just that scene.
const HERE = import.meta.url;
/** The scene module scenes/<file>.ts: its URL, and its path in the project (TimelineEntry.file). */
const scene = (file: string) => {
  const url = new URL('./scenes/' + file + '.ts', HERE);
  return { url: url.href, path: decodeURIComponent(url.pathname).slice(1) };
};

export default function timeline(words: Words, audio: AudioData): TimelineEntry[] {
  /** Time of the first beat of bar n (1-based, as the music counts); past the grid, its tempo carries on. */
  const bar = (n: number) => audio.downbeats[n - 1] ?? audio.timeOfBeat((n - 1) * 4);
  // For a song or narration, anchor cuts to the words, still snapped to the grid (unused here: the
  // example cuts on bars only, so it keeps working without data/words.json):
  /** The last beat at or before the first word of the line containing `q` (a beat up to 20 ms after the word's start counts: the word lands on it). */
  const cut = (q: string, nth = 0) => audio.timeOfBeat(Math.floor(audio.beatAt(words.get(q, nth).words[0]!.start + 0.02)));
  /** The downbeat nearest the end of the line containing `q`. */
  const after = (q: string, nth = 0) => {
    const e = words.get(q, nth).end;
    return audio.downbeats.reduce((b, d) => (Math.abs(d - e) < Math.abs(b - e) ? d : b), audio.downbeats[0] ?? e);
  };
  void cut; void after;

  /** An entry playing scenes/<file>.ts ('../../<video>/scenes/<file>' takes another video's scene, for a remix). */
  const E = (id: string, file: string, start: number, end: number, extra: Partial<TimelineEntry> = {}): TimelineEntry => {
    const m = scene(file);
    return { id, file: m.path, load: () => import(/* @vite-ignore */ m.url), start, end, ...extra };
  };

  return [
    E('fspass', 'fspass', bar(1), bar(3)),
    E('three', 'three', bar(3), bar(5)),
    E('layer2d', 'layer2d', bar(5), bar(7)),
    // (to the end of the video: over the last bars and the track's ring-out)
    E('linebatch', 'linebatch', bar(7), audio.duration),
  ];
}
