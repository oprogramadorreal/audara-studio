// Entry: the preview player (default) or the export API (?export=1, driven by scripts/render.ts).
// URL: ?v=<video> (see video.ts), ?t=<seconds> to start there, ?scale=2 for 4K, ?only=a,b to load
// just those timeline entries, ?fps=<n> to export at another rate, ?size=<w>x<h> for the video in another
// format (its scenes laid out for that frame), and with ?export=1, ?preview=1 to draw
// the scenes' preview path (ctx.export false, as in the player: render.ts --as-preview).
import { Engine, type AdaptiveSampling, type TimelineEntry } from './engine/engine';
import { PW, PH, W, H, SCALE } from './engine/gl';
import { testCardNote } from './engine/palette';
import { SoundtrackPlayer } from './engine/soundtrack';
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
    if (typeof engine.warm === 'function') {
      try {
        await engine.warm((i, n, id) => { if (info) info.textContent = `preparing the scenes to play smoothly: ${i + 1} of ${n} (${id})`; });
      } catch (err) {
        console.warn('[audara] scene warm-up stopped; scenes compile as they first play', err);
      }
    }
    setupPlayer();
  }
}

// ------------------------------------------------------------------ export API
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
    /** Render a single frame at t (seeks as needed). Returns the sub-frames used. */
    still(t: number, samples: number | AdaptiveSampling = 1, shutter = 0.2) { return engine.render(t, dt, true, samples, shutter); },
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
     * cannot pile frames up in the receiver's memory.
     */
    async stream(opts: { from: number; to: number; fps: number; ws: string; samples?: number | AdaptiveSampling; shutter?: number; inflight?: number }) {
      const ws = new WebSocket(opts.ws);
      ws.binaryType = 'arraybuffer';
      let acked = 0;
      ws.onmessage = (e) => { if (typeof e.data === 'string') acked = Math.max(acked, +e.data || 0); };
      await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = (e) => rej(e); });
      const dt = 1 / opts.fps;
      const n0 = Math.round(opts.from * opts.fps), n1 = Math.round(opts.to * opts.fps);
      const buf = new Uint8Array(PW * PH * 4);
      // warm-up: render one frame before the range so the first frame is sequential for stateful scenes
      const S = opts.samples ?? 1, SH = opts.shutter ?? 0.2;
      // (adaptive sampling only runs stateless scenes: one sample is enough for the warm-up)
      if (n0 > 0) engine.render((n0 - 1) * dt, dt, false, typeof S === 'number' ? S : 1, SH);
      const used: Record<number, number> = {}; // sub-frames per frame -> frames
      for (let n = n0; n < n1; n++) {
        const k = engine.render(n * dt, dt, false, S, SH);
        used[k] = (used[k] ?? 0) + 1;
        await engine.readPixelsAsync(buf);
        if (opts.inflight) while (n - n0 - acked >= opts.inflight) await new Promise((r) => setTimeout(r, 2));
        while (ws.bufferedAmount > 64 * 1024 * 1024) await new Promise((r) => setTimeout(r, 2));
        ws.send(buf);
        if (n % 30 === 0) await new Promise((r) => setTimeout(r, 0)); // let the socket flush
      }
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

function setupPlayer() {
  const ui = $('ui'), scrub = $<HTMLInputElement>('scrub'), info = $('info'), marks = $('marks'), errs = $('errs'), toast = $('toast');
  const TL = engine.timeline, D = engine.duration, fps = VIDEO.fps;
  const byStart = [...TL].sort((a, b) => a.start - b.start); // ([ and ] step through the entries in time)
  const track = new SoundtrackPlayer(engine.soundtrack ?? [], D);
  window.__audara = { preview: true, engine, track }; // (a handle for the browser console)
  setupPicker();
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
  const link = (t: number) => {
    const u = new URL(location.href);
    u.searchParams.set('v', VIDEO.name);
    u.searchParams.set('t', String(+t.toFixed(3)));
    return u.toString();
  };
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
  const seek = (x: number) => { track.seek(Math.max(0, Math.min(D - 0.001, x))); syncUrl(track.now()); };
  const toggle = () => { if (track.playing) { track.pause(); syncUrl(track.now()); } else track.play(); };
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

  let frames = 0, fpsT = performance.now(), fpsNow = 0, wasPlaying = false;
  const tick = () => {
    // (the loop first: a loop that ends with the video must wrap before the player stops at the end)
    if (loop && track.playing && track.now() >= loop[1]) track.seek(loop[0]);
    track.sync();
    const t = track.now();
    if (wasPlaying && !track.playing) syncUrl(t); // (reached the end)
    wasPlaying = track.playing;
    engine.render(Math.min(t, D - 0.001), 1 / fps);
    scrub.value = String(t);
    frames++;
    const now = performance.now();
    if (now - fpsT > 500) { fpsNow = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now; }
    const e = entryAt(t);
    markEls.forEach((m, i) => m.classList.toggle('on', TL[i] === e));
    const l = engine.words.lineAt(t);
    info.textContent = `${VIDEO.name}${params.has('size') ? ` ${W}x${H}` : ''}  ${t.toFixed(2)}s  beat ${engine.audio.beatAt(t).toFixed(2)}  bar ${engine.audio.barAt(t).toFixed(2)}  [${e ? e.id : '—'}]  ${fpsNow.toFixed(0)}fps${l ? `   “${l.text}”` : ''}${loop ? '   LOOP' : ''}`;
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
  errs.textContent = `The preview could not start:\n\n${msg}`;
  errs.style.display = 'block';
  setupPicker();
});
