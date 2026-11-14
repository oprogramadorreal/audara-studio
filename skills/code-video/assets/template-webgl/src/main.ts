// Entry: the preview player (default) or the export API (?export=1, driven by scripts/render.ts).
// URL: ?v=<video> (see video.ts), ?t=<seconds> to start there, ?scale=2 for 4K, ?only=a,b to load
// just those timeline entries, ?fps=<n> to export at another rate, ?size=<w>x<h> for the video in another
// format (its scenes laid out for that frame), and with ?export=1, ?preview=1 to draw
// the scenes' preview path (ctx.export false, as in the player: render.ts --as-preview).
import { Engine, type AdaptiveSampling, type TimelineEntry } from './engine/engine';
import { PW, PH, W, H, SCALE } from './engine/gl';
import { testCardNote } from './engine/palette';
import { loadSegments, resolveDuration, SoundtrackPlayer, type Segment } from './engine/soundtrack';
import { VIDEO, VIDEOS, VIDEO_ERROR, loadTimeline } from './video';

const params = new URLSearchParams(location.search);
const EXPORT = params.has('export');
const ONLY = params.get('only'); // comma-separated entry ids to load (faster stills)
const FROM = params.get('t') ? parseFloat(params.get('t')!) : null;

/** The dev server's latest errors (a module that fails to compile): the browser itself only says it couldn't fetch the module. */
const serverErrors: { msg: string; at: number }[] = [];
let onServerError = () => {};
import.meta.hot?.on('vite:error', ({ err }) => {
  serverErrors.push({ msg: [err.message, err.frame].filter(Boolean).join('\n').trim(), at: performance.now() });
  if (serverErrors.length > 4) serverErrors.shift();
  onServerError();
});

document.title = `${VIDEO.title} · preview`;
const canvas = document.getElementById('c') as HTMLCanvasElement;
// physical size: the video's size times ?scale= (the page shows it at the logical size, or smaller)
canvas.width = PW;
canvas.height = PH;

declare global {
  interface Window { __audara: any }
}

let engine: Engine;

/**
 * Engine.prepare (streamed footage: what the scenes on screen in [t0, t1] need loaded; `ahead`, a look-ahead
 * nobody waits for), or nothing to wait for with an engine from before it: init --force updates this file
 * but never src/engine/.
 */
const prepare = (t0: number, t1: number, ahead = false): Promise<void> => {
  const p = (engine as unknown as { prepare?: (t0: number, t1: number, ahead?: boolean) => Promise<void> }).prepare;
  return typeof p === 'function' ? p.call(engine, t0, t1, ahead) : Promise.resolve();
};

/** This page's address, at this video (`?v=`) and time t (`?t=`). */
const link = (t: number) => {
  const u = new URL(location.href);
  u.searchParams.set('v', VIDEO.name);
  u.searchParams.set('t', String(+t.toFixed(3)));
  return u.toString();
};

/** The boot's problems with the soundtrack (loadSegments'): one per audio file it didn't read. */
const audioProblems = () => (engine as Engine | undefined)?.bootErrors.filter((e) => e.startsWith('audio: ')) ?? [];

/**
 * The preview reads a soundtrack the boot didn't read again, until every file video.json names is read:
 * the boot asks once and gives up after 15 s, and a cold first load once kept a page silent for good with a
 * file that was there. Each try's problems replace the last ones on the page (`shown` redraws them), and
 * `onRead` gets the segments as a fresh boot would have them. It uses only loadSegments, which every engine
 * has: init --force updates this file but never src/engine/.
 */
function retrySoundtrack(onRead: (segments: Segment[]) => void, shown = () => {}) {
  const list = (problems: string[]) => {
    const rest = engine.bootErrors.filter((e) => !e.startsWith('audio: '));
    engine.bootErrors.splice(0, engine.bootErrors.length, ...problems.map((p) => `${p} (trying again)`), ...rest);
    engine.errorsVersion++;
    shown();
  };
  let wait = 1000;
  const attempt = async () => {
    const { segments, problems } = await loadSegments(VIDEO.audio);
    if (segments && !problems.length) { list([]); onRead(segments); return; }
    list(problems);
    setTimeout(attempt, wait);
    wait = Math.min(2 * wait, 15000);
  };
  list(audioProblems());
  void attempt();
}

/**
 * A player for `segments` that takes over from `old` where it is, playing or paused. `old` is synced first:
 * a clock that ran past the end since the last frame (a background tab) stops there, as the next frame
 * would have it, and isn't played again from 0.
 */
function takeOver(old: SoundtrackPlayer, segments: Segment[], D: number) {
  old.sync();
  const t = old.now(), playing = old.playing;
  old.pause();
  const next = new SoundtrackPlayer(segments, D);
  next.seek(t);
  // (not play(): in its last millisecond it starts again from 0. Playing on from t, the next frame wraps a
  // loop or stops at the end as it would have.)
  if (playing) { next.playing = true; next.sync(true); }
  return next;
}

/**
 * The time the player shows at each refresh of the display, from the clock's time t there (the soundtrack's
 * at requestAnimationFrame's timestamp ts). Playing, it is a frame of the video's own, n/fps as render.ts
 * renders it: round(t·fps + phase), the phase (within half a frame) keeping the frame boundaries midway
 * between refreshes, so a display that shows a whole number of refreshes per frame (60 Hz at 60 fps, 120 Hz,
 * a 30 fps video at 60 Hz) holds every frame exactly that long, however much the moment the callback runs
 * wavers. Rounding the clock alone, a clock that sat near a boundary flickered between a frame repeated and
 * one skipped: measured on a project's live preview of 60 fps footage, 5-15% of the refreshes stepped 0 or
 * 2 frames. When the clock drifts from the refreshes (a 59.94 Hz display, the clock steered to the sound),
 * the phase follows it until it would pass half a frame, and then one frame is held one refresh longer or
 * shorter: a single repeat or skip. A jump (a seek, the clock set to the sound, a loop, a background tab)
 * starts it again, never before t; a display whose refreshes don't line up with the frames (144 Hz at
 * 60 fps) gets round(t·fps). Between jumps it never goes back, so a change of refresh rate (the window
 * moved to another screen) at worst holds a frame: a step back would re-simulate stateful scenes. Paused,
 * it is t as it is. A slow frame still drops frames: the time is the clock's.
 */
function frameLock(fps: number) {
  const gaps: number[] = []; // (the latest refresh intervals, ms)
  let phase = 0, lastX = NaN, lastTs = NaN, from = 0;
  /** The part of a frame one refresh takes when they line up (1/2 at 120 Hz and 60 fps; 1 when a refresh takes a frame or more), else 0. */
  const cell = () => {
    if (gaps.length < 8) return 0;
    const g = ([...gaps].sort((a, b) => a - b)[gaps.length >> 1]! * fps) / 1000; // (frames per refresh)
    const k = g < 1 ? 1 / g : g, whole = Math.round(k);
    return Math.abs(k - whole) < 0.03 * whole ? (g < 1 ? 1 / whole : 1) : 0;
  };
  return (t: number, ts: number, playing: boolean) => {
    const gap = ts - lastTs, x = t * fps;
    if (gap > 2 && gap < 100) { gaps.push(gap); if (gaps.length > 15) gaps.shift(); }
    // (a steady clock moves about as far as the refresh: a hold for the sound to start moves it 0)
    const steady = gap > 0 && gap < 250 && Math.abs(x - lastX - (gap * fps) / 1000) <= 2;
    lastTs = ts;
    lastX = playing ? x : NaN;
    if (!playing) return t;
    if (!steady) { from = t; phase = 0; }
    const u = cell();
    if (!u) phase = 0;
    else {
      const d = ((((x + 0.5 + phase) / u) % 1) + 1) % 1; // (where in its refresh's part of a frame the clock is, 0..1)
      if (!steady || d < 0.25 || d > 0.75) phase += (0.5 - d) * u; // (back to the middle: the same frame)
      if (phase > 0.5) phase -= u; // (the picture half a frame ahead: one refresh more on this frame)
      else if (phase < -0.5) phase += u; // (behind: one less)
    }
    return (from = Math.max(from, Math.floor(x + 0.5 + phase) / fps));
  };
}

/** The player's clock: an engine's SoundtrackPlayer from before 0.13.2 takes no time and reads its own (init --force updates this file but never src/engine/). */
type Clock = { now(at?: number): number; sync(force?: boolean, at?: number): void };
type Player = Clock & { playing: boolean; seek(t: number): void };

/**
 * The player brought up to ts (once per frame, before now(); requestAnimationFrame's timestamp, or now), the
 * loop first: a loop that ends with the video must wrap before the player stops at the end.
 */
function bringUp(track: Player, ts: number, loop: [number, number] | null) {
  if (loop && track.playing && track.now(ts) >= loop[1]) track.seek(loop[0]);
  track.sync(false, ts);
}

/**
 * The time the player shows at refresh ts: frameLock's, the player brought up to ts first. A loop wraps on the
 * frame shown too, since frameLock may put it up to half a frame past the clock: on the loop's end, where the
 * next scene starts, it would show that scene for a refresh.
 */
function showAt(track: Player, lock: (t: number, ts: number, playing: boolean) => number, ts: number, loop: [number, number] | null) {
  bringUp(track, ts, loop);
  const t = lock(track.now(ts), ts, track.playing);
  if (!(loop && track.playing && t >= loop[1])) return t;
  track.seek(loop[0]);
  return lock(track.now(ts), ts, true);
}

// A lost GL context takes with it what scenes made on the GPU when they were built (a captured environment
// light, a baked texture), and nothing makes it again: when the context comes back, the preview reloads at
// the moment it was on, paused (the link's own while the scenes are still loading; the player sets these)
let playhead = () => FROM ?? 0, pausePlayer = () => {};
if (!EXPORT) {
  let lostAt = 0;
  canvas.addEventListener('webglcontextlost', () => { lostAt = playhead(); pausePlayer(); });
  canvas.addEventListener('webglcontextrestored', () => location.replace(link(lostAt)));
}

async function boot() {
  if (VIDEO_ERROR) throw new Error(VIDEO_ERROR);
  // (ctx.export: the scenes draw their full-quality path for render.ts, unless it asks for the preview's)
  engine = new Engine(canvas, await loadTimeline(), { export: EXPORT && !params.has('preview') });
  const onlySet = ONLY ? new Set(ONLY.split(',')) : null;
  await engine.init(onlySet ? (e) => onlySet.has(e.id) : undefined);
  // (a misspelled id would load nothing and render black without a word)
  const unknown = [...(onlySet ?? [])].filter((id) => !engine.timeline.some((e) => e.id === id));
  if (unknown.length) engine.bootErrors.push(`?only=${ONLY}: ${VIDEO.dir}/timeline.ts has no entry ${unknown.map((x) => `'${x}'`).join(', ')} (its entries: ${engine.timeline.map((e) => e.id).join(', ')})`);
  for (const w of engine.warnings) console.info(`[audara] ${w}`);
  if (EXPORT) setupExport();
  else {
    // the frame the link asks for first, then every scene compiled before anything plays (Engine.warm). An
    // engine from before it has no warm(): init --force updates this file but never src/engine/, so such a
    // project plays as it did. The warm-up only saves a stall, so it never keeps the player from starting.
    engine.render(Math.max(0, Math.min(FROM ?? 0, engine.duration - 0.001)));
    const info = document.getElementById('info');
    // (typed as optional, so this file also typechecks against an engine without it)
    const warm = (engine as unknown as { warm?: (onEntry: (i: number, n: number, id: string) => void) => Promise<void> }).warm;
    if (typeof warm === 'function') {
      try {
        await warm.call(engine, (i, n, id) => { if (info) info.textContent = `preparing the scenes to play smoothly: ${i + 1} of ${n} (${id})`; });
      } catch (err) {
        console.warn('[audara] scene warm-up stopped; scenes compile as they first play', err);
      }
    }
    setupPlayer();
  }
}

// ------------------------------------------------------------------ export API
/** A hash of a frame's pixels (two 32-bit lanes over its 32-bit words): equal frames hash the same. */
function hashPixels(b: Uint8Array) {
  const w = new Uint32Array(b.buffer, b.byteOffset, b.byteLength >> 2);
  let h1 = 0x811c9dc5, h2 = 0x9e3779b9;
  for (let i = 0; i < w.length; i++) {
    h1 = Math.imul(h1 ^ w[i]!, 0x01000193);
    h2 = Math.imul(h2 ^ w[i]!, 0x5bd1e995) ^ (h2 >>> 13);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

function setupExport() {
  document.body.classList.add('export');
  // the canvas at the logical size, top-left (what --headed shows; render.ts reads frame() instead)
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const dt = 1 / VIDEO.fps;
  /**
   * The last rendered frame, PW x PH, top-down, read from the engine's final target: the pixels stream()
   * sends to the video, at every scale (the canvas shows them downscaled at scale > 1).
   */
  const frame = async () => {
    const px = await engine.readPixelsAsync(), row = PW * 4;
    const img = new ImageData(PW, PH);
    for (let y = 0; y < PH; y++) img.data.set(px.subarray((PH - 1 - y) * row, (PH - y) * row), y * row); // bottom-up -> top-down
    return img;
  };
  window.__audara = {
    engine,
    video: VIDEO.name,
    title: VIDEO.title,
    /** The soundtrack as segments (file relative to the project root), or null for silence: render.ts gives it to ffmpeg. */
    audio: engine.soundtrack?.map(({ file, at, from, dur, fadeOut }) => ({ file, at, from, dur, ...(fadeOut ? { fadeOut } : {}) })) ?? null,
    duration: engine.duration,
    /** What set the length: 'video.json' | 'segments' | 'data/audio.json' | 'audio file'. */
    durationSource: engine.durationSource,
    fps: VIDEO.fps,
    /** Current errors (boot problems, scenes that failed to load or threw while rendering). */
    get errors() { return engine.errors; },
    warnings: engine.warnings,
    /** What the scenes see as ctx.export: true for their full-quality path, false for the preview's (?preview=1). */
    exporting: engine.exporting,
    /** Output size in px (the logical size times scale); stream() sends frames of width*height*4 bytes. */
    scale: SCALE,
    width: PW,
    height: PH,
    logicalWidth: W,
    logicalHeight: H,
    timeline: engine.timeline.map(({ id, start, end }) => ({ id, start, end })),
    /**
     * Render a single frame at t (seeks as needed), once what it shows is loaded (streamed footage: the frames
     * of t and its neighbours, the shutter's reach). Returns the sub-frames used. A scene whose prepare failed
     * has the error in `errors`, which render.ts reports, and draws what it can.
     */
    async still(t: number, samples: number | AdaptiveSampling = 1, shutter = VIDEO.shutter) {
      await prepare(t - dt, t + dt).catch(() => {});
      return engine.render(t, dt, true, samples, shutter);
    },
    /** The last rendered frame as ImageData (see frame above): render.ts draws contact sheets from it. */
    frame,
    /** The last rendered frame as a PNG (PW x PH, opaque), base64: render.ts saves stills and posters from it. */
    async png() {
      const oc = new OffscreenCanvas(PW, PH);
      oc.getContext('2d', { alpha: false })!.putImageData(await frame(), 0, 0);
      const b = new Uint8Array(await (await oc.convertToBlob({ type: 'image/png' })).arrayBuffer());
      let s = '';
      for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
      return btoa(s);
    },
    /**
     * Render [from, to) at fps and stream raw RGBA frames (bottom-up) over a WebSocket.
     * Returns when all frames were sent, with a histogram of sub-frames per frame. With `inflight`, the
     * receiver acknowledges each frame it has handed on (a text message with its running count) and at
     * most `inflight` frames are unacknowledged: backpressure from the encoder, so a slow encode (4K)
     * cannot pile frames up in the receiver's memory. With `ends` (render.ts video --jobs, a piece of the
     * video each), it also leaves in `streamEnds` a hash of its first frame, rendered after a jump (`first`),
     * and of the frame after its last, rendered straight on from it (`after`): where one piece ends and the
     * next starts, the two must be equal, or a scene there depends on what was rendered before it.
     * Each frame waits for what it shows to be loaded (streamed footage), the next half second of the range
     * loading meanwhile; a frame that fails to load stops the stream with its error.
     */
    async stream(opts: { from: number; to: number; fps: number; ws: string; samples?: number | AdaptiveSampling; shutter?: number; inflight?: number; ends?: { first?: boolean; after?: boolean } }) {
      const ws = new WebSocket(opts.ws);
      ws.binaryType = 'arraybuffer';
      let acked = 0;
      ws.onmessage = (e) => { if (typeof e.data === 'string') acked = Math.max(acked, +e.data || 0); };
      await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = (e) => rej(e); });
      const dt = 1 / opts.fps;
      const n0 = Math.round(opts.from * opts.fps), n1 = Math.round(opts.to * opts.fps);
      const buf = new Uint8Array(PW * PH * 4);
      // warm-up: render one frame before the range so the first frame is sequential for stateful scenes
      const S = opts.samples ?? 1, SH = opts.shutter ?? VIDEO.shutter;
      // (adaptive sampling only runs stateless scenes: one sample is enough for the warm-up)
      // (streamed footage: each prepare here reaches only frames this call renders, the warm-up's to the
      // last, so a range needs no footage frame outside it, the shutter's sub-frames staying within theirs)
      if (n0 > 0) {
        await prepare((n0 - 1) * dt, n0 * dt);
        engine.render((n0 - 1) * dt, dt, false, typeof S === 'number' ? S : 1, SH);
      }
      const used: Record<number, number> = {}; // sub-frames per frame -> frames
      const ends: { first?: string; after?: string } = {};
      for (let n = n0; n < n1; n++) {
        // (the next half second, loading without waiting; then this frame's, waited for, which reports a
        // frame that fails to load)
        if ((n - n0) % 15 === 0) prepare(n * dt, Math.min(n + 30, n1 - 1) * dt, true).catch(() => {});
        await prepare((n - 1) * dt, Math.min(n + 1, n1 - 1) * dt);
        const k = engine.render(n * dt, dt, false, S, SH);
        used[k] = (used[k] ?? 0) + 1;
        await engine.readPixelsAsync(buf);
        if (opts.ends?.first && n === n0) ends.first = hashPixels(buf);
        if (opts.inflight) while (n - n0 - acked >= opts.inflight) await new Promise((r) => setTimeout(r, 2));
        while (ws.bufferedAmount > 64 * 1024 * 1024) await new Promise((r) => setTimeout(r, 2));
        ws.send(buf);
        if (n % 30 === 0) await new Promise((r) => setTimeout(r, 0)); // let the socket flush
      }
      if (opts.ends?.after && n1 < Math.round(engine.duration * opts.fps)) {
        await prepare((n1 - 1) * dt, n1 * dt);
        engine.render(n1 * dt, dt, false, S, SH);
        await engine.readPixelsAsync(buf);
        ends.after = hashPixels(buf);
      }
      window.__audara.streamEnds = ends;
      while (ws.bufferedAmount > 0) await new Promise((r) => setTimeout(r, 5));
      ws.close();
      return used;
    },
  };
  window.__audara.ready = true;
}

// ------------------------------------------------------------------ preview player
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** The project path of an entry's scene module: TimelineEntry.file, a bare name in this video's scenes/, or the id as that name. */
const modulePath = (e: TimelineEntry) => {
  const f = e.file ?? e.id;
  return f.includes('/') ? f : `${VIDEO.dir}/scenes/${f}.ts`;
};

/** The video picker (a project with several videos): switching loads the other video from its start. */
function setupPicker() {
  const pick = $<HTMLSelectElement>('pick');
  if (VIDEOS.length < 2) return;
  for (const v of VIDEOS) pick.add(new Option(v, v, false, v === VIDEO.name));
  pick.style.display = 'block';
  pick.onchange = () => {
    const p = new URLSearchParams(location.search);
    p.set('v', pick.value);
    p.delete('t');
    p.delete('size'); // (another video opens in its own format)
    location.search = p.toString();
  };
}

/** '1080x1920' -> '1080x1920 9:16': a size, and its shape when that is in small numbers. */
const formatName = (size: string) => {
  const [w, h] = size.split('x').map(Number) as [number, number];
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a), d = gcd(w, h);
  return w / d <= 32 && h / d <= 32 ? `${size} ${w / d}:${h / d}` : size;
};

/**
 * The format menu (a video made in another format too, docs/ENGINE.md "Another format"): the video's own
 * format, each folder out/<video>/<W>x<H>/, which the dev server lists, and the one on screen. render.ts
 * makes such a folder for every --size, and a page opened at another format asks the server for its own
 * until it is listed, so leaving it for another format doesn't lose it. The list is read again every few seconds: a
 * format made while the page is open shows up. Switching keeps the moment, the timeline being the same.
 */
function setupFormats() {
  const menu = document.getElementById('fmt') as HTMLSelectElement | null;
  if (!menu || !VIDEOS.includes(VIDEO.name)) return;
  const [ow, oh] = VIDEO.ownSize, own = `${ow}x${oh}`, on = `${W}x${H}`;
  // (a size that was read, in another shape: the same shape at another size is no format, as render.ts says)
  let ask = params.has('size') && !VIDEO_ERROR && Math.abs(W / H - ow / oh) >= 0.001 ? `?${new URLSearchParams({ v: VIDEO.name, size: on })}` : '';
  let listed = '';
  const read = async () => {
    let made: unknown = [];
    try {
      const r = await fetch(`/__audara/formats${ask}`, ask ? { method: 'POST' } : {});
      if (r.ok) made = ((await r.json()) as Record<string, unknown>)?.[VIDEO.name] ?? [];
      // (asked until the folder is listed: one that couldn't be made is asked for again)
      if (Array.isArray(made) && made.includes(on)) ask = '';
    } catch {}
    const sizes = [...new Set([own, ...(Array.isArray(made) ? made : []).filter((s): s is string => typeof s === 'string' && /^\d+x\d+$/.test(s)), on])];
    if (sizes.join() === listed) return;
    listed = sizes.join();
    menu.replaceChildren(...sizes.map((s) => new Option(formatName(s), s, false, s === on)));
    menu.style.display = sizes.length > 1 ? 'block' : 'none';
  };
  void read();
  setInterval(() => void read(), 3000);
  menu.onchange = () => {
    const u = new URL(link(playhead()));
    if (menu.value === own) u.searchParams.delete('size');
    else u.searchParams.set('size', menu.value);
    location.search = u.search;
  };
}

function setupPlayer() {
  const ui = $('ui'), scrub = $<HTMLInputElement>('scrub'), info = $('info'), marks = $('marks'), errs = $('errs'), toast = $('toast');
  const TL = engine.timeline, D = engine.duration, fps = VIDEO.fps;
  const byStart = [...TL].sort((a, b) => a.start - b.start); // ([ and ] step through the entries in time)
  let track = new SoundtrackPlayer(engine.soundtrack ?? [], D);
  playhead = () => track.now();
  pausePlayer = () => track.pause();
  window.__audara = { preview: true, engine, track }; // (a handle for the browser console)
  setupPicker();
  setupFormats();
  canvas.style.aspectRatio = `${W} / ${H}`;
  scrub.max = String(D);
  scrub.step = '0.001';
  info.title = engine.warnings.join('\n');
  // a soft warning under the video, never over it: the project still wears the template's test card
  const card = testCardNote(VIDEO.name);
  if (card) {
    const warn = $('warn');
    warn.textContent = warn.title = card;
    warn.style.display = 'block';
  }

  const markEls = TL.map((e) => {
    const m = document.createElement('div');
    m.className = 'mark';
    m.style.left = `${(e.start / D) * 100}%`;
    m.style.width = `${((e.end - e.start) / D) * 100}%`;
    m.title = `${e.id}  ${e.start.toFixed(2)}–${e.end.toFixed(2)}  (${modulePath(e)})`;
    m.textContent = e.id;
    m.onclick = () => seek(e.start);
    marks.appendChild(m);
    return m;
  });

  // the URL's ?t follows the playhead whenever it moves without playing, so the address bar is always
  // a link to what is on screen (throttled: browsers limit history updates)
  let urlTimer = 0, urlT = 0;
  const syncUrl = (t: number) => {
    urlT = t;
    if (!urlTimer) urlTimer = window.setTimeout(() => { urlTimer = 0; history.replaceState(history.state, '', link(urlT)); }, 200);
  };
  let toastTimer = 0;
  const say = (msg: string) => {
    toast.textContent = msg;
    toast.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('on'), 1400);
  };
  const copyLink = async () => {
    const s = link(track.now());
    try { await navigator.clipboard.writeText(s); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = s; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
    }
    syncUrl(track.now());
    say('link copied');
  };

  let loop: [number, number] | null = null;
  /** The time of the frame on screen (frameLock's, while playing). */
  let shown = 0;
  const seek = (x: number) => { track.seek(Math.max(0, Math.min(D - 0.001, x))); syncUrl(track.now()); };
  // (paused, the player stays on the frame it was showing, not the clock's moment within it)
  const toggle = () => { if (track.playing) { track.pause(); seek(shown); } else track.play(); };
  /** The entry on screen at t (the player stops at D, where the last frame shown is D - 0.001's). */
  const entryAt = (t: number) => { const c = Math.min(t, D - 0.001); return TL.find((x) => c >= x.start && c < x.end); };
  seek(FROM ?? 0);
  canvas.onclick = toggle;
  scrub.oninput = () => seek(parseFloat(scrub.value));
  scrub.onchange = () => scrub.blur(); // (keys go back to the player)
  window.addEventListener('keydown', (ev) => {
    if (ev.target instanceof HTMLSelectElement || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const t = track.now(), k = ev.key;
    const frame = Math.round(t * fps);
    if (k === ' ') toggle();
    else if (k === 'ArrowRight') seek(t + (ev.shiftKey ? 5 : 1));
    else if (k === 'ArrowLeft') seek(t - (ev.shiftKey ? 5 : 1));
    else if (k === '.') seek((frame + 1) / fps); // one frame, on the export's frame grid
    else if (k === ',') seek((frame - 1) / fps);
    else if (k === 'l') { const e = entryAt(t); loop = loop ? null : e ? [e.start, e.end] : null; say(loop ? `loop ${e!.id}` : 'loop off'); }
    else if (k === 'h') ui.classList.toggle('hidden');
    else if (k === ']') { const e = byStart.find((x) => x.start > t + 0.01); if (e) seek(e.start); }
    else if (k === '[') { const es = byStart.filter((x) => x.start < t - 0.3); const e = es[es.length - 1]; if (e) seek(e.start); }
    else if (k === 'c') void copyLink();
    else return;
    ev.preventDefault();
  });

  // errors, live: a scene that fails shows here and renders dark red while the others keep playing
  let shownErrors = -1;
  const showErrors = () => {
    const list = engine.errors;
    errs.style.display = list.length ? 'block' : 'none';
    errs.textContent = list.length ? `${list.length} error${list.length > 1 ? 's' : ''} (the rest of the video keeps playing)\n\n${list.join('\n\n')}` : '';
  };

  // Hot reload (vite.config.ts makes scene modules self-accepting). Saving a scene module, or a helper it
  // imports, sends an update for the scene: the entries using it are re-instantiated from the new module.
  // That also brings back a scene that failed to load (its module never ran, and Vite alone would drop
  // the update); a module that fails now (a syntax error, a bad import, a throw at its top level) shows
  // its error here, with the dev server's message, while the rest of the video plays on.
  if (import.meta.hot) {
    const hot = import.meta.hot;
    // (the browser only says it couldn't fetch the module: add what the dev server said, if it said it lately)
    onServerError = () => {
      const s = serverErrors.at(-1);
      if (!s || performance.now() - s.at > 20000) return;
      for (const e of TL) if (/dynamically imported module/i.test(engine.loaded.get(e.id)?.error ?? '')) engine.explain(e.id, `The dev server says: ${s.msg}`);
    };
    onServerError(); // (scenes that failed at boot)
    hot.on('vite:beforeUpdate', ({ updates }) => {
      for (const u of updates) {
        const hits = u.type === 'js-update' ? TL.filter((e) => `/${modulePath(e)}` === u.path) : [];
        if (!hits.length) continue;
        // (the URL Vite's own client imports too: the browser runs the new module once for both)
        const url = new URL(`${import.meta.env.BASE_URL}${u.path.slice(1)}?t=${u.timestamp}`, location.href).href;
        for (const e of hits) void engine.reload(e.id, () => import(/* @vite-ignore */ url)).then(() => onServerError());
        say(`reloaded ${hits.map((e) => e.id).join(', ')}`);
      }
    });
    // a change the page can't take in place (the timeline, the look, video.json, timing data) reloads it: at this moment
    hot.on('vite:beforeFullReload', () => history.replaceState(history.state, '', link(track.now())));
  }

  // A soundtrack the boot didn't read, once read: heard from where the player is, playing or paused as it
  // was. One that gives the video another length (a segment list's end, with no "duration" in video.json)
  // reloads the page at this moment instead: the timeline, the beat grid and the scrub bar are made for it.
  /** The player brought up to now (bringUp). */
  const advance = () => bringUp(track, performance.now(), loop);
  if (audioProblems().length) {
    retrySoundtrack((segments) => {
      advance();
      // (the boot replaced data/audio.json's own length with D, and it decides only a single file's, which is D)
      const d = resolveDuration(VIDEO, segments, engine.audio.synthetic ? null : D);
      if (!d || d.duration !== D) return location.replace(link(track.now()));
      track = takeOver(track, segments, D);
      window.__audara.track = track;
      engine.soundtrack = segments;
      engine.durationSource = d.source;
      say('soundtrack loaded');
    });
  }

  let frames = 0, fpsT = performance.now(), fpsNow = 0, wasPlaying = false, prefetchT = -Infinity;
  // A paused frame whose scenes all ask for it (`refine = true` on the scene: the realism kit's; none of them
  // stateful) is rendered once more with the render's sampling, 12 sub-frames over the shutter, when the
  // playhead has rested 0.3 s and what the frame shows is loaded, then held until something changes (the
  // playhead, or a scene it shows hot-swapped; one saved elsewhere in the video leaves it). Every other frame,
  // a crossfade with any other scene included, is drawn as it always was. (Loaded: streamed footage shows
  // another frame it has until the exact one arrives, and a frame refined before then would hold that one.)
  let rest = { t: NaN, since: 0, scenes: [] as unknown[], asked: false, loaded: false }, refined = false;
  const half = (VIDEO.shutter / fps) / 2; // (the video's shutter, 0.2 of a frame by default, either side of t)
  // the entries the frame's sub-frames draw: its shutter, up to a hard cut, where the engine keeps every
  // sub-frame on the frame's side (an engine without sameSide: the whole shutter)
  const sameSide = (engine as unknown as { sameSide?: (t: number, ts: number) => number }).sameSide;
  const side = (t: number, ts: number) => (typeof sameSide === 'function' ? sameSide.call(engine, t, ts) : ts);
  const onAt = (t: number) => {
    const lo = side(t, Math.max(0, t - half)), hi = side(t, t + half);
    return TL.filter((x) => hi >= x.start && lo < x.end);
  };
  const scenesAt = (t: number) => onAt(t).map((x) => engine.loaded.get(x.id)?.scene);
  const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  const wantsRefine = (t: number) => {
    if (t + half >= D) return false; // (past the video's end nothing draws: the end's frame stays as it is)
    const on = onAt(t);
    return on.length > 0 && on.every((x) => {
      const s = engine.loaded.get(x.id)?.scene as { refine?: unknown; stateful?: unknown } | null | undefined;
      return s?.refine === true && !s.stateful;
    });
  };
  const lock = frameLock(fps);
  const tick = (ts: number) => {
    const t = (shown = showAt(track, lock, ts, loop));
    if (wasPlaying && !track.playing) syncUrl(t); // (reached the end)
    wasPlaying = track.playing;
    // streamed footage: the next two seconds loading, from the frame on screen, without holding up playback
    // (a frame not there yet shows the latest one loaded before it until it arrives); again once the
    // playhead has moved half a second
    if (Math.abs(t - prefetchT) > 0.5) { prefetchT = t; prepare(t, t + 2, true).catch(() => {}); }
    const tc = Math.min(t, D - 0.001), scenes = scenesAt(tc);
    if (track.playing || tc !== rest.t || !same(scenes, rest.scenes)) {
      rest = { t: tc, since: performance.now(), scenes, asked: false, loaded: false };
      refined = false;
    } else if (!refined && performance.now() - rest.since > 300 && wantsRefine(tc) && !engine.renderer.getContext().isContextLost()) {
      // what the frame's sub-frames show, loaded first (a frame that fails to load has its error listed, and
      // the frame is refined as it stands)
      if (!rest.asked) {
        const r = rest;
        r.asked = true;
        prepare(tc - half, tc + half, true).catch(() => {}).then(() => { r.loaded = true; });
      }
      if (rest.loaded) {
        engine.render(tc, 1 / fps, true, 12, VIDEO.shutter);
        refined = true;
      }
    }
    if (!refined) engine.render(tc, 1 / fps);
    scrub.value = String(t);
    frames++;
    const now = performance.now();
    if (now - fpsT > 500) { fpsNow = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now; }
    const e = entryAt(t);
    markEls.forEach((m, i) => m.classList.toggle('on', TL[i] === e));
    const l = engine.words.lineAt(t);
    info.textContent = `${VIDEO.name}${params.has('size') ? ` ${W}x${H}` : ''}  ${t.toFixed(2)}s  beat ${engine.audio.beatAt(t).toFixed(2)}  bar ${engine.audio.barAt(t).toFixed(2)}  [${e ? e.id : '—'}]  ${fpsNow.toFixed(0)}fps${l ? `   “${l.text}”` : ''}${loop ? '   LOOP' : ''}${refined ? '   refined (12 sub-frames)' : ''}`;
    if (engine.errorsVersion !== shownErrors) { shownErrors = engine.errorsVersion; showErrors(); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

boot().catch((e) => {
  console.error(e);
  const msg = String(e?.stack ?? e);
  if (EXPORT) { window.__audara = { error: msg }; return; }
  const errs = $('errs');
  const show = () => { errs.textContent = [`The preview could not start:`, msg, ...audioProblems()].join('\n\n'); };
  show();
  errs.style.display = 'block';
  setupPicker();
  setupFormats(); // (back to a format that starts, say)
  // (a soundtrack not read may be all that stopped it, when nothing else gives the video's length: once
  // read, the page starts again at its moment)
  if (audioProblems().length) retrySoundtrack(() => location.replace(link(playhead())), show);
});
