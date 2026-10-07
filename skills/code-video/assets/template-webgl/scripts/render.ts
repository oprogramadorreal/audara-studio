#!/usr/bin/env bun
// Offline renderer. Drives the preview page in headless Chrome (?export=1) for one video:
//   stills:  bun scripts/render.ts stills --t 1.5,8,12.2 [--only id1,id2] [--out dir]   (stills, sheets and posters
//            hold the pixels the video gets, the engine's final target, never a screenshot of the page)
//   sheet:   bun scripts/render.ts sheet [--from 0] [--to <end>] [--n 12] [--only ids] [--out file.png]
//            (the whole video by default), or --times a,b,c, or --cuts: frame 0, the last frame, and around every
//            cut (every time an entry starts or ends): 0.1 s before, the frame before, the cut frame, the frame
//            after, 0.1 s after, a cut per row; with --times, those frames come after them. Each thumbnail is
//            labelled with its time and scene. Thumbnails have about the area of 480x270 whatever the shape
//            (480 wide for 16:9, 270 for 9:16), in as many columns as fit ~1940 px; with --cuts a row holds the
//            five frames of a cut, so 16:9 thumbnails shrink to 383 px wide; [--cols N] [--thumb <px wide>].
//            A sheet taller than ~2000 px or bigger than 3.75 MiB goes on in <file>-2.png, <file>-3.png ..., so
//            each stays readable and reaches a model's image input as it is.
//   poster:  bun scripts/render.ts poster --t 9.5 [--out out/<video>/poster.png]   (one frame at full quality:
//            adaptive sub-frames, as the video renders it)
//   verify:  bun scripts/render.ts verify   (renders every word, cut and half second; scene, browser and WebGL errors;
//            the soundtrack against the timeline, and the timing data against the soundtrack (a song's window, in
//            the window's time, must be the file that plays); gaps; determinism: the same frame reached by
//            different seeks must give identical pixels; motion blur must not carry a scene across a hard cut)
//            -> out/<video>/verify.json, exit code 1 when it fails (warnings, such as a project still on the
//            template's test-card palette, don't fail it). Its renders are fixed (one sub-frame, and four over the
//            whole frame time at the cuts): --samples and --shutter don't apply.
//            It also says what changed since the verify whose report it replaces (or the one --since <report>
//            names, say a copy kept when a critic round started): the stretches whose frames differ, by the hash
//            of their pixels at every half second, cut and word start, and at the times the earlier report
//            sampled (a frame is a function of t, so an equal hash is an unchanged frame; between samples, a
//            short change can go unseen), with their scenes, a change of length (the time only one run has
//            isn't compared), and the timeline entries added, removed or moved
//   video:   bun scripts/render.ts video [--from 0] [--to <end>] [--out out/<video>/<video>.mp4]
//            first prints the file it will write: its size (the video's, times --scale), fps and length
//            the final render: --samples auto --shutter 0.2 --crf 16 --preset slow --tune grain --x264 aq-mode=3
//            [--noaudio] [--fps <video's>]. Only the whole video, with every entry and the full-quality path, is
//            written to <video>.mp4 by default; anything less says what it is in its name, so it can't replace
//            the final render: <video>-<from>-<to>.mp4 for a range, -only-<ids> with --only, -draft, -preview
//            --draft: a quick look instead: --samples 1 (no motion blur), --preset veryfast --crf 23, named -draft
//            (out/<video>/<video>-draft.mp4 for the whole video); any of those options given as well still wins
//            --samples N averages N sub-frames per frame over shutter×(1/fps): motion blur + temporal AA;
//            --samples auto picks the count per frame (4, 12, 36, 108 or 324, see Engine.render)
//            [--min-samples 4] [--max-samples 324] [--tol 3]. A stateful scene can't be sampled adaptively:
//            with --samples left out, a range that shows one renders with a fixed 12.
//   perf:    bun scripts/render.ts perf --from 0 --to 5 [--only ids] [--samples 1]   (ms per frame: what the preview pays,
//            on the scenes' preview path, the engine's own share of it, and what an export pays on their
//            full-quality path, with the readback; a video frame also pays the transfer to ffmpeg and the encode)
//   gpu:     bun scripts/render.ts gpu   (the GPU Chrome renders with)
//   link:    bun scripts/render.ts link [--video <video>] [--t <seconds>]   (the live preview's link, to give the
//            director: http://127.0.0.1:<port>/?v=<video>&t=<seconds>, no &t= without --t. <port> is the first of
//            5173-5199, where the preview serves, whose dev server serves this folder: 5173 is Vite's default, so
//            another app or another project's preview may hold it. Starts no server and no browser. Exit code 1
//            when none serves this project: run preview, which starts one)
//   preview: bun scripts/render.ts preview [--video <video>] [--t <seconds>] [--stop]   (link, starting this project's
//            preview first when none runs: the project's own Vite, in a process of its own that outlives this
//            command, your turn and the shell that ran it, on the first free port of 5173-5199, its output in
//            .audara-cache/preview.log. It waits until the server answers for this folder, 20 s at most (exit
//            code 1 and the end of that log when it doesn't), then prints the link, after a line asking the agent
//            to post it to the director (link prints the link alone). Starts no browser. --stop
//            ends this project's preview, the dev servers of this folder on those ports and nothing else)
// Every mode (link and preview take only --video and --size):
//   --video <video> which video (default: the only one, else the first that isn't `example`, else `example`)
//   --only a,b      load only these timeline entries (the others render black)
//   --scale N       N x the video's size (--scale 2: 3840x2160 for a 1920x1080 video): stills, posters and
//                   videos come out at that physical size
//   --fps N         another frame rate than video.json's (frameIdx() follows it)
//   --size WxH      the video in another format (--size 1080x1920: a vertical version of a 16:9 video): the
//                   same timeline, sound and data, its scenes laid out for that frame (they read W and H, so
//                   they recompose, never crop), and everything written under out/<video>/<W>x<H>/ (verify.json,
//                   stills, sheets, <video>.mp4), so nothing of the video's own format is replaced. link and
//                   preview give the preview's link to that format (&size=WxH). A size with the video's own
//                   shape is refused: that is the same picture at another size (--scale), not a format
//   --samples, --shutter  sub-frames per frame (default 1, but auto for video and poster) and the shutter
//                   they spread over, as a fraction of the frame time (default 0.2); every mode but verify
//   --as-preview    draw the scenes' preview path (ctx.export false, as the live preview does) instead of their
//                   full-quality one: put a heavy scene's cheaper preview beside its render, which must show the
//                   same picture, only cleaner (perf times both paths either way). Its output gets names of its
//                   own (stills-preview/, verify-preview.json, ...-preview.png and .mp4), so it lands beside
//                   the full-quality one instead of replacing it
//   --url <server>  render through a running dev server of this project instead of a private one (a private
//                   server never reloads: a file saved by anyone mid-run can't break the run)
//   --headed        show the browser
// Output goes under out/<video>/ unless --out says otherwise.
// (playwright-core itself is loaded by launch(), when a browser is needed: link and preview need none, and
// start in less than half the time without it)
import type { Browser, Page } from 'playwright-core';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const MODES = ['stills', 'sheet', 'poster', 'verify', 'video', 'perf', 'gpu', 'link', 'preview'];
const mode = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'stills';
const opt = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const flag = (k: string) => argv.includes(`--${k}`);
/**
 * Every option a mode reads (the header describes them). Anything else stops the run: ignored, an option this
 * copy doesn't know yet (--size on a render.ts older than it) would render something else under the same name.
 */
const OPTIONS = new Set(['as-preview', 'cols', 'crf', 'cuts', 'draft', 'fps', 'from', 'headed', 'max-samples', 'min-samples',
  'n', 'noaudio', 'only', 'out', 'preset', 'samples', 'scale', 'shutter', 'since', 'size', 'stop', 't', 'thumb', 'times',
  'to', 'tol', 'tune', 'url', 'video', 'x264']);
/** The options that take no value; every other one is followed by its value. */
const FLAGS = new Set(['as-preview', 'cuts', 'draft', 'headed', 'noaudio', 'stop']);
const PROJECT = path.resolve(import.meta.dir, '..');

class Fail extends Error {}
/** Stop with a message that says what to do (no stack trace). */
const fail = (msg: string): never => { throw new Fail(msg); };
/** A number option (or its default), or a message that says what's wrong with it. */
const num = (k: string, d: string) => {
  const s = opt(k, d) ?? '', x = Number(s);
  if (!s.trim() || !Number.isFinite(x)) fail(`--${k} ${s}: not a number`);
  return x;
};
/** A whole-number option of at least `min` (or its default). */
const int = (k: string, d: string, min = 1) => {
  const x = num(k, d);
  if (!Number.isInteger(x) || x < min) fail(`--${k} ${opt(k, d)}: a whole number${min > 0 ? ` from ${min} up` : ''}`);
  return x;
};
/** A comma-separated list of times in seconds. */
const timesOf = (k: string, s: string) => s.split(',').map((x) => {
  const v = Number(x.trim());
  if (!x.trim() || !Number.isFinite(v)) fail(`--${k} ${s}: '${x}' is not a time in seconds`);
  return v;
});

// ------------------------------------------------------------------ which video
function listVideos() {
  const dir = path.join(PROJECT, 'videos');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(dir, d.name, 'video.json')))
    .map((d) => d.name)
    .sort();
}
/**
 * A project file's text, without the byte-order mark Windows PowerShell 5.1 puts at the start of every file
 * it writes as UTF-8 (Set-Content -Encoding utf8), which JSON.parse refuses.
 */
const projectText = (rel: string) => readFileSync(path.join(PROJECT, rel), 'utf8').replace(/^\uFEFF/, '');
/** A video.json that isn't JSON stops here, by name (the page would only fail to boot). */
function checkVideoJson(name: string) {
  const f = `videos/${name}/video.json`;
  try { JSON.parse(projectText(f)); }
  catch (e) { fail(`${f} is not valid JSON: ${(e as Error).message}`); }
}
/** The preview's rule (src/video.ts): the only video, else the first that isn't `example`, else `example`. */
const defaultVideo = (names: string[]) => (names.length <= 1 ? names[0] : names.find((n) => n !== 'example') ?? 'example');

const SCALE = Math.max(1, Math.round(+opt('scale', '1')!));
/**
 * --size <w>x<h>: the video in another format (a 9:16 version of a 16:9 one, say): the same timeline, sound
 * and data, its scenes laid out for that frame (they read W and H), written under out/<video>/<w>x<h>/ so
 * nothing of the video's own format is replaced. The size video.json already has is no override. Set in
 * main(), where a bad value can be reported.
 */
let SIZE: [number, number] | null = null;
function parseSize(video: string) {
  const s = opt('size');
  if (s === undefined) return;
  const m = /^(\d+)x(\d+)$/.exec(s.trim()), w = m ? +m[1]! : 0, h = m ? +m[2]! : 0;
  if (!(w >= 16 && h >= 16 && w % 2 === 0 && h % 2 === 0)) fail(`--size ${s}: <width>x<height> in even whole pixels (H.264 needs even sizes), e.g. 1080x1920`);
  const own = (JSON.parse(projectText(`videos/${video}/video.json`)) as { size?: unknown }).size;
  const [ow, oh] = Array.isArray(own) && own.length === 2 ? (own as number[]) : [1920, 1080];
  if (w === ow && h === oh) return;
  // (the same shape at another size is the same picture bigger or smaller, not another format: scenes are
  // laid out in the video's own pixels, so --scale makes it bigger and nothing makes it smaller)
  if (Math.abs(w / h - ow! / oh!) < 0.001)
    fail(`--size ${w}x${h} has the video's own shape (${ow}x${oh}): that is the same picture at another size, not another format. --scale 2 renders it at twice the size; a smaller file is an encode of the render (ffmpeg -vf scale=...)`);
  SIZE = [w, h];
}
const sizeTag = () => (SIZE ? `${SIZE[0]}x${SIZE[1]}` : null);
/** A quick look at a video: one sub-frame, a fast encode (see the header). */
const DRAFT = flag('draft');
/** The scenes' preview path (ctx.export false) instead of their full-quality one. */
const AS_PREVIEW = flag('as-preview');
type Sampling = number | { min: number; max: number; tol: number };
/**
 * Sub-frames per frame: --samples N (fixed) or --samples auto [--min-samples 4] [--max-samples 324] [--tol 3]
 * (adaptive, see Engine.render). The modes that make the final picture (video, poster) default to auto, so
 * the final render gets real motion blur without anyone remembering a flag; a draft and the modes for
 * looking (stills, sheet, verify, perf) to 1: crisp, and fast. Set in main(), where a bad value can be reported.
 */
let SAMPLES: Sampling = 1;
/** The shutter, as a fraction of the frame time: 0.2 in every mode (sub-frames spread over a fifth of a frame). */
let SHUTTER = 0.2;
const SAMPLES_GIVEN = opt('samples') !== undefined;
/** A video with a stateful scene, rendered without --samples: this many fixed sub-frames instead of auto. */
const STATEFUL_SAMPLES = 12;
function parseSampling() {
  const s = opt('samples', (mode === 'video' && !DRAFT) || mode === 'poster' ? 'auto' : '1')!;
  SAMPLES = s === 'auto' ? { min: int('min-samples', '4'), max: int('max-samples', '324'), tol: num('tol', '3') } : int('samples', s);
  SHUTTER = num('shutter', '0.2');
  if (SHUTTER < 0 || SHUTTER > 1) fail(`--shutter ${SHUTTER}: a fraction of the frame time, from 0 to 1 (0.2 is a fifth of a frame)`);
}
/** How a sampling setting reads in a message. */
const describeSampling = (s: Sampling) => (typeof s === 'number'
  ? `${s} sub-frame${s === 1 ? ' per frame (no motion blur)' : `s per frame, shutter ${SHUTTER}`}`
  : `adaptive sub-frames (${s.min}–${s.max} per frame, tol ${s.tol}), shutter ${SHUTTER}`);
const hist = (h: Record<string, number>) => Object.entries(h).sort((a, b) => +a[0] - +b[0]).map(([k, v]) => `${k}:${v}`).join(' ');

/** What the page reports about the video (window.__audara). */
interface Info {
  video: string; title: string; duration: number; durationSource: string; fps: number;
  width: number; height: number; logicalWidth: number; logicalHeight: number; scale: number;
  audio: { file: string; at: number; from: number; dur: number; fadeOut?: number }[] | null;
  timeline: { id: string; start: number; end: number }[];
  errors: string[]; warnings: string[];
  /** What the scenes see as ctx.export (false with --as-preview). */
  exporting: boolean;
}

// ------------------------------------------------------------------ dev server
const samePath = (a: string, b: string) => {
  const n = (p: string) => path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
};

/**
 * What a server says at GET /__audara: the folder it serves and its process (a vite.config.ts older than
 * `preview` doesn't say), from a dev server of a project like this one (vite.config.ts); 'another app' from
 * anything else; 'no answer' when something took the connection but said nothing in time; null when nothing
 * listens there.
 */
type Served = { root: string; pid?: number };
type Answer = Served | 'another app' | 'no answer' | null;
/** Asks the server at `url`, waiting `ms` at most. */
async function askServer(url: string, ms: number): Promise<Answer> {
  try {
    const r = await fetch(`${url}/__audara`, { signal: AbortSignal.timeout(ms) });
    const j = r.ok && (r.headers.get('content-type') ?? '').includes('json') ? ((await r.json().catch(() => null)) as { root?: unknown; pid?: unknown } | null) : null;
    return typeof j?.root === 'string' ? { root: j.root, ...(typeof j.pid === 'number' ? { pid: j.pid } : {}) } : 'another app';
  } catch (e) { return (e as Error)?.name === 'TimeoutError' ? 'no answer' : null; }
}

/** true: a dev server of this project; false: a server of something else; null: nothing there. */
async function servesThisProject(url: string): Promise<boolean | null> {
  const a = await askServer(url, 1500);
  return a && typeof a === 'object' ? samePath(a.root, PROJECT) : a === 'another app' ? false : null;
}

/**
 * The dev server a run renders through. `deps()`: the version of its pre-bundled dependencies (the `?v=` on
 * their URLs), which changes when it re-bundles them in a way a loaded page can't follow; unknown (undefined)
 * for a server given with --url.
 */
interface Server { url: string; stop: () => void; deps: () => string | undefined }

async function ensureServer(): Promise<Server> {
  const given = opt('url')?.replace(/\/+$/, '');
  if (given) {
    const ok = await servesThisProject(given);
    if (ok === null) fail(`nothing answers at ${given} (--url): start the preview (bun scripts/render.ts preview) or leave --url out`);
    if (!ok) fail(`the server at ${given} serves another project, not ${PROJECT}: leave --url out to start a private server`);
    return { url: given, stop: () => {}, deps: () => undefined };
  }
  // A private server for every run: no live reload or file watching, so a file saved mid-run (by you, the
  // director or another agent) can't reload the page under it; a preview's server would. It runs in this
  // process through Vite's API (well under a second): a child `bunx vite` survives its parent on Windows
  // (bunx starts node, and killing bunx leaves node running), so nothing is spawned.
  process.env.AUDARA_NO_HMR = '1'; // (read by vite.config.ts)
  let vite: typeof import('vite');
  try { vite = await import('vite'); } catch { return fail(`vite is not installed in ${PROJECT}: run "bun install" there first`); }
  // A scene that doesn't parse or imports a package that isn't installed, in any video, stops Vite's
  // dependency scan (vite.config.ts), which says so with a stack trace: this run reports its own scenes'
  // errors, and loads its page again if a dependency turns up late (openPage).
  const logger = vite.createLogger('error');
  const logError = logger.error;
  logger.error = (msg, o) => { if (!msg.includes('Failed to run dependency scan')) logError(msg, o); };
  // (its own dependency cache: under Bun its config hash differs from `bunx vite`'s, and sharing
  // node_modules/.vite would re-optimize the deps under a running preview)
  const server = await vite.createServer({
    root: PROJECT, cacheDir: path.join(PROJECT, 'node_modules', '.vite-render'), logLevel: 'error', customLogger: logger, clearScreen: false,
    server: { port: 0, strictPort: true, watch: null },
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0]?.replace(/\/$/, '');
  if (!url || !(await servesThisProject(url))) fail('the private dev server did not start');
  // (not awaited: closing can stall under Bun, and the process exits right after)
  return { url: url!, stop: () => { void server.close(); }, deps: () => server.environments.client.depsOptimizer?.metadata.browserHash };
}

/**
 * Where the live preview serves: on 127.0.0.1 alone (vite.config.ts binds it there, so `localhost` may reach
 * another app on the same port), at 5173 or, when that is taken, the next free port.
 */
const PREVIEW_HOST = '127.0.0.1', PREVIEW_PORTS = Array.from({ length: 27 }, (_, i) => 5173 + i);
const PREVIEW_RANGE = `${PREVIEW_HOST}, ports ${PREVIEW_PORTS[0]}-${PREVIEW_PORTS.at(-1)}`;
/** What the preview started by `preview` prints (.audara-cache/ is git-ignored, and the preview doesn't watch it). */
const PREVIEW_LOG = path.join(PROJECT, '.audara-cache', 'preview.log');

/** Every preview port asked at once, each with a short timeout (one where nothing listens refuses at once). */
const askPorts = () => PREVIEW_PORTS.map((port) => askServer(`http://${PREVIEW_HOST}:${port}`, 500));
/** A dev server of this folder. */
const servesThis = (a: Answer): a is Served => !!a && typeof a === 'object' && samePath(a.root, PROJECT);
/**
 * A dev server of this folder, under this path or another: a server started in it by its 8.3 short name
 * (JOHNSM~1, common in %TEMP%) answers with that name, and refuses every page there (Vite's 403).
 */
const servesHere = (a: Answer): a is Served => { try { return !!a && typeof a === 'object' && samePath(realpathSync.native(a.root), PROJECT); } catch { return false; } };
/** This project's preview: the lowest port whose dev server serves this folder, and what it said; null when none does. */
async function thisPreview(asked = askPorts()) {
  for (const [i, a] of asked.entries()) {
    const r = await a;
    if (servesThis(r)) return { port: PREVIEW_PORTS[i]!, ...r };
  }
  return null;
}
/** --t: the one time a link starts at, or null. */
function linkTime() {
  const t = opt('t') === undefined ? null : timesOf('t', opt('t')!);
  if (t && (t.length !== 1 || t[0]! < 0)) fail(`--t ${opt('t')}: a link starts at one time, in seconds from 0`);
  return t ? t[0]! : null;
}
/** The link to give the director (t as the preview writes it into its own links). */
const linkTo = (port: number, video: string, t: number | null) =>
  `http://${PREVIEW_HOST}:${port}/?${new URLSearchParams({ v: video, ...(SIZE ? { size: sizeTag()! } : {}), ...(t === null ? {} : { t: String(+t.toFixed(3)) }) })}`;

/**
 * link: the address of this project's live preview, at --t when given; the lowest port that serves this
 * folder wins. When none does, exit code 1, with what holds those ports instead.
 */
async function link(video: string) {
  const t = linkTime(), asked = askPorts();
  const found = await thisPreview(asked);
  if (found) return void console.log(linkTo(found.port, video, t));
  const said = await Promise.all(asked);
  /** The ports whose answer `is` picks, in a few words ('5175 and 5176 are ...'), or nothing. */
  const held = (is: (a: Answer) => boolean, one: string, many: string) => {
    const ps = PREVIEW_PORTS.filter((_, i) => is(said[i]!));
    return !ps.length ? [] : [ps.length > 1 ? `${ps.slice(0, -1).join(', ')} and ${ps.at(-1)} ${many}` : `${ps[0]} ${one}`];
  };
  const stale = (it: string) => `(such as its 8.3 short name, under which Vite refuses every page): \`bun scripts/render.ts preview --stop\` stops ${it}`;
  const what = [
    ...held((a) => a === 'another app', 'serves another app', 'serve other apps'),
    ...held((a) => !!a && typeof a === 'object' && !servesHere(a), "is another project's preview", "are other projects' previews"),
    ...held((a) => a === 'no answer', 'took the connection but did not answer', 'took the connection but did not answer'),
    ...held(servesHere, `serves this folder through another path ${stale('it')}`, `serve this folder through other paths ${stale('them')}`),
  ];
  fail(`no preview of this project is running: run \`bun scripts/render.ts preview --video ${video}${SIZE ? ` --size ${sizeTag()}` : ''}${t === null ? '' : ` --t ${+t.toFixed(3)}`}\` yourself (the director doesn't run commands); it starts one that keeps running, and prints its link\n`
    + `  ${what.length ? `On ${PREVIEW_HOST}, ${what.join('; ')}.` : `Nothing answers on ${PREVIEW_RANGE}.`}`);
}

/** The last lines of a log, indented, for a message; stack frames left out (the error above them says more). */
function logTail(file: string, n = 15) {
  let lines: string[] = [];
  try { lines = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !/^\s+at /.test(l)); } catch {}
  return lines.length ? lines.slice(-n).map((l) => `  ${l}`).join('\n') : '  (empty)';
}

/**
 * Windows: makes every handle of this process non-inheritable, so the process it starts next gets its stdio
 * and nothing else. libuv starts a process with bInheritHandles=TRUE, which hands it every inheritable handle
 * of its parent. Bun makes its own std handles non-inheritable, but a shell that runs this command can pass
 * handles of its own: Windows PowerShell passes the pipe its caller reads the output from. A Vite that
 * inherited that pipe kept it open as long as it ran, so a caller that reads the output to its end (Codex
 * runs commands through PowerShell) waited for the preview to stop. Returns why it couldn't, or nothing.
 */
async function inheritNothing(): Promise<string | undefined> {
  try {
    const { dlopen, FFIType } = await import('bun:ffi');
    const k = dlopen('kernel32.dll', {
      GetProcessHandleCount: { args: [FFIType.i64, FFIType.ptr], returns: FFIType.bool },
      GetHandleInformation: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.bool },
      SetHandleInformation: { args: [FFIType.u64, FFIType.u32, FFIType.u32], returns: FFIType.bool },
    });
    try {
      // (the arrays themselves go to each call, which takes their address then: an address kept from ptr()
      // goes stale if the array's storage moves)
      const count = new Uint32Array(1), flags = new Uint32Array(1);
      if (!k.symbols.GetProcessHandleCount(-1, count)) return 'GetProcessHandleCount failed';
      // (handles are multiples of 4: the scan stops once it has met them all, or at a bound far past them)
      for (let h = 4, seen = 0; seen < count[0]! && h < 1 << 22; h += 4) {
        if (!k.symbols.GetHandleInformation(h, flags)) continue;
        seen++;
        if (flags[0]! & 1 && !k.symbols.SetHandleInformation(h, 1, 0)) return `handle 0x${h.toString(16)} stays inheritable`;
      }
    } finally { k.close(); }
  } catch (e) { return (e as Error).message; }
}

/**
 * preview: link, starting this project's preview first when none runs. It runs the project's own Vite
 * (node_modules/vite, on node when there is one, as `bunx vite` would, else on bun) in a process of its own:
 * detached (a process group of its own, and on Windows no console), its output in PREVIEW_LOG, not waited
 * for, and holding no handle of this process but that log (inheritNothing), so whatever reads this command's
 * output gets to its end when the command ends. A host ends a turn by killing the shell's process tree
 * (taskkill /T /F on Windows); once this command is done, Vite is no longer in that tree, and it keeps
 * serving. It is found as link finds it, by asking the ports until one answers for this folder.
 */
async function preview(video: string) {
  const t = linkTime();
  // (said where the link is printed, whether this started the server or found it running, as a new session
  // does: sessions that read it only in the skill often held it back for 20 to 90 minutes. The director runs
  // this too, so it names who it's for; the link stays the last line, for a `| tail -1`. `link` prints the
  // link alone)
  const share = (port: number) => {
    console.log('(For the agent at work here: post this link to the director in a message now; they watch the build grow there.)');
    console.log(linkTo(port, video, t));
  };
  const found = await thisPreview();
  if (found) return share(found.port);
  const vite = path.join(PROJECT, 'node_modules', 'vite');
  let bin: unknown;
  try { bin = (JSON.parse(readFileSync(path.join(vite, 'package.json'), 'utf8')) as { bin?: unknown }).bin; }
  catch { return fail(`vite is not installed in ${PROJECT}: run "bun install" there first`); }
  const entry = path.join(vite, typeof bin === 'string' ? bin : (bin as Record<string, string> | undefined)?.vite ?? 'bin/vite.js');
  let out: number;
  try { mkdirSync(path.dirname(PREVIEW_LOG), { recursive: true }); out = openSync(PREVIEW_LOG, 'w'); }
  catch (e) { return fail(`can't write the preview's log, ${PREVIEW_LOG}: ${(e as Error).message}`); }
  // (a log without color codes; and AUDARA_NO_HMR would stop the preview reloading when a file changes)
  const env: Record<string, string | undefined> = { ...process.env, NO_COLOR: '1' };
  delete env.AUDARA_NO_HMR;
  const kept = process.platform === 'win32' ? await inheritNothing() : undefined;
  if (kept) console.error(`render.ts: this process's handles stay inheritable (${kept}): whatever reads this command's output to its end may wait until the preview stops`);
  const server = Bun.spawn([Bun.which('node') ?? process.execPath, entry], { cwd: PROJECT, env, stdio: ['ignore', out, out], detached: true, windowsHide: true });
  closeSync(out);
  server.unref();
  const t0 = Date.now();
  for (;;) {
    await Bun.sleep(250);
    const up = await thisPreview();
    if (up) {
      // (--stop ends the process the server names: a vite.config.ts older than `preview` names none)
      const until = up.pid === undefined
        ? `until process ${server.pid} is ended (this project's vite.config.ts, older than render.ts's preview, doesn't say which process serves it, so \`preview --stop\` can't stop it)`
        : 'until `bun scripts/render.ts preview --stop`';
      console.log(`started this project's preview (Vite on port ${up.port}, process ${up.pid ?? server.pid}; its log: .audara-cache/preview.log). It keeps running after this command and your turn, ${until}.`);
      return share(up.port);
    }
    const code = server.exitCode;
    if (code === null && Date.now() - t0 < 20000) continue;
    if (code === null) server.kill();
    fail(`the preview did not start: ${code === null ? `Vite didn't answer for this folder on ${PREVIEW_RANGE} within 20 s, so it was stopped` : `Vite exited (code ${code})`}. The end of its log, .audara-cache/preview.log (stack frames left out):\n${logTail(PREVIEW_LOG)}`);
  }
}

/**
 * preview --stop: ends this project's preview: every dev server of this folder on the preview's ports (under
 * this path or another), through the process it names. Another app or project is never touched.
 */
async function stopPreview() {
  const said = await Promise.all(askPorts());
  const ours = PREVIEW_PORTS.flatMap((port, i) => { const a = said[i]!; return servesHere(a) ? [{ port, pid: a.pid }] : []; });
  if (!ours.length) return void console.log(`no preview of this project is running on ${PREVIEW_RANGE}: nothing to stop`);
  for (const { port, pid } of ours) {
    if (pid === undefined)
      fail(`the dev server on port ${port} serves this folder but doesn't say which process it is (its vite.config.ts is older than render.ts's preview): stop it where it was started, or end the process that listens on ${PREVIEW_HOST}:${port}`);
    try { process.kill(pid!); }
    catch (e) { fail(`could not stop this project's preview on port ${port} (process ${pid}): ${(e as Error).message}`); }
    for (let k = 0; servesHere(await askServer(`http://${PREVIEW_HOST}:${port}`, 500)); k++) {
      if (k === 50) fail(`process ${pid} was told to stop, but port ${port} still serves this folder`);
      await Bun.sleep(100);
    }
    console.log(`stopped this project's preview on port ${port} (process ${pid})`);
  }
}

// ------------------------------------------------------------------ browser
async function launch(): Promise<Browser> {
  const { chromium } = await import('playwright-core');
  const args = ['--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
  const exe = process.env.CHROME_PATH;
  try {
    return await chromium.launch({ ...(exe ? { executablePath: exe } : { channel: 'chrome' }), headless: !flag('headed'), args });
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (/not found|doesn't exist|no such file|ENOENT|executable/i.test(msg))
      fail(`Google Chrome not found${exe ? ` at CHROME_PATH=${exe}` : ''}. Install it (Windows: winget install Google.Chrome; macOS: brew install --cask google-chrome; Linux: the .deb or .rpm from https://www.google.com/chrome/), or set CHROME_PATH to a Chrome or Chromium executable.\n  (${msg.split('\n')[0]})`);
    throw e;
  }
}

/** three.js's warning when a second copy of it loads: instanceof fails between objects of the two. */
const SECOND_THREE = /Multiple instances of Three\.js/i;
/** What that warning means once the reload (openPage) didn't clear it, and how to fix it. */
const SECOND_THREE_FIX = "Two copies of three.js loaded, so objects made by one fail the other's instanceof checks (a model draws black): something imports three.js by a second path (three/src/..., a URL, a package that brings its own copy). Import it only as 'three', and its addons as 'three/addons/...'; for a package's own copy, add resolve: { dedupe: ['three'] } to vite.config.ts. If nothing does, delete node_modules/.vite-render (the renders' dependency cache) and run again.";
/**
 * Browser log lines that mean something went wrong: errors, failed requests, WebGL errors (a draw the GPU
 * refused), a second copy of three.js.
 */
const isProblem = (l: string) => /^\[(error|pageerror|http )/.test(l) || /GL_INVALID|WebGL: INVALID|CONTEXT_LOST/.test(l) || SECOND_THREE.test(l);

/** The page for one video, booted; `preview`: the scenes draw their preview path (ctx.export false). */
async function openPage(browser: Browser, server: Server, video: string, preview = AS_PREVIEW) {
  // (the viewport is set to the video's logical size once the page has said what it is)
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const logs: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  page.on('response', async (r) => {
    if (r.status() < 400) return;
    const i = logs.push(`[http ${r.status()}] ${r.url()}`) - 1;
    // (a module the dev server can't compile answers 500 with the compiler's message inside; the browser
    // doesn't keep the body of a failed module, so ask again)
    if (r.status() !== 500) return;
    const body = await fetch(r.url()).then((x) => x.text()).catch(() => '');
    try {
      const why = (JSON.parse(/const error = (\{.*\})\s*$/m.exec(body)?.[1] ?? '{}') as { message?: string }).message;
      if (why) logs[i] += `: ${why.replace(/\s+/g, ' ').slice(0, 300)}`;
    } catch {}
  });
  const q = new URLSearchParams({ export: '1', v: video });
  if (preview) q.set('preview', '1');
  if (opt('only')) q.set('only', opt('only')!);
  if (SCALE !== 1) q.set('scale', String(SCALE));
  if (opt('fps')) q.set('fps', opt('fps')!);
  if (SIZE) q.set('size', sizeTag()!);
  for (let load = 1; ; load++) {
    const deps = server.deps();
    await page.goto(`${server.url}/?${q}`);
    // ready, or an error the page reports; a page that never boots (a module that doesn't compile, a broken
    // import) says why only in the browser log: give up 30 s after the first problem there
    const t0 = Date.now();
    let problemAt = 0;
    for (;;) {
      const st: string = await page.evaluate(() => { const a = (window as any).__audara; return a?.ready ? 'ready' : a?.error ? 'error' : ''; }).catch(() => '');
      if (st) break;
      if (!problemAt && logs.some(isProblem)) problemAt = Date.now();
      if ((problemAt && Date.now() - problemAt > 30000) || Date.now() - t0 > 180000)
        fail(`the page did not start (${problemAt ? 'it hit errors' : 'nothing after 3 minutes'}). The browser log:\n${logs.join('\n') || '(empty)'}`);
      await Bun.sleep(200);
    }
    // A package a scene imports that the server's dependency cache didn't hold yet (on the first run after a
    // scene starts importing it, see vite.config.ts) is bundled while the page loads, after the page took
    // three.js from the cache: the scene then holds a second copy of three.js. The server has them in one
    // bundle now, so the next load gets one copy. (A server given with --url doesn't say when it re-bundles:
    // three.js's warning about a second copy does.)
    const late = deps === undefined ? logs.some((l) => SECOND_THREE.test(l)) : server.deps() !== deps;
    if (!late || load === 3) break;
    console.log('loading the page again: the dev server bundled a dependency a scene imports as the page loaded (two copies of three.js otherwise)');
    logs.length = 0; // (the discarded load's)
  }
  const err: string | undefined = await page.evaluate(() => (window as any).__audara.error);
  if (err) {
    await Bun.sleep(300); // (the failed requests' messages, still arriving)
    fail(`the video failed to load:\n${err}${logs.length ? `\n${logs.join('\n')}` : ''}`);
  }
  const info: Info = await page.evaluate(() => {
    const p = (window as any).__audara;
    return {
      video: p.video, title: p.title, duration: p.duration, durationSource: p.durationSource, fps: p.fps, width: p.width, height: p.height,
      logicalWidth: p.logicalWidth, logicalHeight: p.logicalHeight, scale: p.scale, audio: p.audio, timeline: p.timeline, errors: p.errors, warnings: p.warnings,
      exporting: p.exporting,
    };
  });
  if (info.width !== info.logicalWidth * SCALE || info.height !== info.logicalHeight * SCALE)
    fail(`the page renders ${info.width}x${info.height}, expected ${info.logicalWidth * SCALE}x${info.logicalHeight * SCALE} (--scale ${SCALE})`);
  if (SIZE && (info.logicalWidth !== SIZE[0] || info.logicalHeight !== SIZE[1]))
    fail(`the page lays out ${info.logicalWidth}x${info.logicalHeight}, not the ${sizeTag()} --size asked for (a src/video.ts older than --size: take the template's)`);
  // (a misspelled id would load nothing and render black, and verify would pass on black frames)
  const ids = info.timeline.map((e) => e.id), unknown = ONLY.filter((id) => !ids.includes(id));
  if (unknown.length) fail(`--only ${unknown.join(',')}: no such entry in videos/${video}/timeline.ts. Its entries: ${ids.join(', ') || 'none'}`);
  await page.setViewportSize({ width: info.logicalWidth, height: info.logicalHeight });
  return { page, logs, info };
}
const ONLY = (opt('only') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

// ------------------------------------------------------------------ modes
/**
 * Render each frame and save it as a PNG of the output's size. Returns the sub-frames each one used.
 * The pixels are the engine's final target, the ones the video encodes, at every scale (the page's canvas
 * shows them downscaled at --scale 2).
 */
async function stills(page: Page, shots: { t: number; file: string }[]) {
  const used: number[] = [];
  for (const { t, file } of shots) {
    mkdirSync(path.dirname(file), { recursive: true });
    const k: number = await page.evaluate(([t, s, sh]) => (window as any).__audara.still(t, s, sh), [t, SAMPLES, SHUTTER] as const);
    await Bun.write(file, Buffer.from(await page.evaluate(() => (window as any).__audara.png()), 'base64'));
    used.push(k);
  }
  return used;
}

/** A frame on a contact sheet: its time, and what it is in its row ('cut', '-1f' ... with --cuts). */
interface Tile { t: number; tag?: string }
/**
 * Contact-sheet geometry, in px of the sheet image. A sheet is looked at whole, and a viewer (a person, or a
 * model's image input) scales a big one down to fit: past about 2000 px a side the thumbnails stop being
 * readable. So a page is at most `maxW` x `maxH`, and a thumbnail has by default the area of a 480x270 one,
 * whatever the frame's shape, so every frame shows at the same scale (480x270 for 16:9, 270x480 for 9:16).
 * And a page reaches a model's image input as it is only up to 2000 px a side and `maxBytes` (Claude Code's
 * reader): past that, the reader re-encodes it first, as a 256-colour PNG without dithering, which turns the
 * soft glow and grain of a dark frame into flat grey blotches around everything bright, defects that aren't
 * in the video. So a page is an opaque (RGB) PNG, as stills are, and one over `maxBytes` is cut between rows.
 */
const SHEET = { maxW: 1940, maxH: 2000, maxBytes: 3.75 * 2 ** 20, area: 480 * 270, pad: 4, label: 22 };

/**
 * Contact sheets: each group of tiles starts a row of its own and wraps at `cols`; thumbnails `tw` px wide
 * (the height from the frame's aspect), each under a label with its time, its scene and its tag. Rows that
 * don't fit in SHEET.maxH go on further pages, out-2.png, out-3.png ..., as do those that would take a
 * page's PNG past SHEET.maxBytes. Returns the files written.
 */
async function sheet(page: Page, info: Info, groups: Tile[][], cols: number, tw: number, out: string) {
  const th = Math.max(1, Math.round((tw * info.logicalHeight) / info.logicalWidth));
  const rows: Tile[][] = [];
  for (const g of groups) for (let i = 0; i < g.length; i += cols) rows.push(g.slice(i, i + cols));
  const perPage = Math.max(1, Math.floor((SHEET.maxH - SHEET.pad) / (th + SHEET.label + SHEET.pad)));
  const pages: Tile[][][] = [];
  for (let i = 0; i < rows.length; i += perPage) pages.push(rows.slice(i, i + perPage));
  const ext = path.extname(out), base = out.slice(0, out.length - ext.length);
  const files: string[] = [];
  mkdirSync(path.dirname(out), { recursive: true });
  for (const pageRows of pages) {
    const pngs: string[] = await page.evaluate(async ({ rows, tw, th, pad, lab, samples, shutter, maxBytes }) => {
      const P = (window as any).__audara;
      const cv = document.createElement('canvas');
      cv.width = Math.max(...rows.map((r) => r.length)) * (tw + pad) + pad;
      cv.height = rows.length * (th + lab + pad) + pad;
      const c = cv.getContext('2d')!;
      c.fillStyle = '#222'; c.fillRect(0, 0, cv.width, cv.height);
      c.imageSmoothingQuality = 'high';
      // each frame as the video gets it, as stills() saves it, put on a canvas and scaled down from there
      const fc = document.createElement('canvas');
      fc.width = P.width; fc.height = P.height;
      const fx = fc.getContext('2d')!;
      for (const [r, row] of rows.entries()) for (const [k, tile] of row.entries()) {
        P.still(tile.t, samples, shutter);
        const x = pad + k * (tw + pad), y = pad + r * (th + lab + pad);
        fx.putImageData(await P.frame(), 0, 0);
        c.drawImage(fc, x, y + lab, tw, th);
        // the label: time and scene(s) on screen at the left, the tile's tag at the right (the cut frame brightest)
        c.font = '15px monospace';
        let room = tw - 4;
        if (tile.tag) {
          c.textAlign = 'right'; c.fillStyle = tile.tag === 'cut' ? '#fff' : '#9a9a9a';
          c.fillText(tile.tag, x + tw - 2, y + 16);
          room -= c.measureText(tile.tag).width + 10;
        }
        const on = P.timeline.filter((e: any) => tile.t >= e.start && tile.t < e.end).map((e: any) => e.id);
        c.textAlign = 'left'; c.fillStyle = '#ddd';
        c.fillText(`${tile.t.toFixed(3)}s  ${on.join('+') || '—'}`, x + 2, y + 16, Math.max(8, room));
      }
      // rows [r0, r1) as one opaque (RGB) PNG, as png() writes stills (toDataURL writes RGBA, a sixth bigger),
      // or, over maxBytes, halved between rows until each half fits
      const png = async (r0: number, r1: number): Promise<string[]> => {
        const part = new OffscreenCanvas(cv.width, (r1 - r0) * (th + lab + pad) + pad);
        part.getContext('2d', { alpha: false })!.drawImage(cv, 0, -r0 * (th + lab + pad));
        const blob = await part.convertToBlob({ type: 'image/png' }), m = (r0 + r1) >> 1;
        if (r1 - r0 > 1 && blob.size > maxBytes) return [...(await png(r0, m)), ...(await png(m, r1))];
        return [await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(r.result as string); r.readAsDataURL(blob); })];
      };
      return png(0, rows.length);
    }, { rows: pageRows, tw, th, pad: SHEET.pad, lab: SHEET.label, samples: SAMPLES, shutter: SHUTTER, maxBytes: SHEET.maxBytes });
    for (const url of pngs) {
      files.push(files.length ? `${base}-${files.length + 1}${ext}` : out);
      await Bun.write(files.at(-1)!, Buffer.from(url.split(',')[1]!, 'base64'));
    }
  }
  // pages left over from an earlier, longer sheet of the same name would pass for part of this one
  for (let i = files.length + 1; existsSync(`${base}-${i}${ext}`); i++) rmSync(`${base}-${i}${ext}`);
  return { files, th, rows: rows.length, cols: Math.max(...rows.map((r) => r.length)) };
}

/**
 * Adaptive sampling refuses stateful scenes (it renders sub-frames out of time order): before a render
 * meets one mid-way, take a fixed count instead, or stop when --samples auto was asked for by name.
 */
async function settleSampling(page: Page, from: number, to: number) {
  if (typeof SAMPLES === 'number') return;
  const ids: string[] = await page.evaluate(({ from, to }) => {
    const E = (window as any).__audara.engine;
    return E.timeline.filter((e: any) => e.start < to && e.end > from && E.loaded.get(e.id)?.scene?.stateful).map((e: any) => e.id);
  }, { from, to });
  if (!ids.length) return;
  const which = `${ids.map((x) => `'${x}'`).join(', ')} ${ids.length > 1 ? 'are' : 'is'} stateful`;
  if (SAMPLES_GIVEN) fail(`--samples auto: ${which}, and adaptive sampling renders sub-frames out of time order, which a simulation can't follow: give a fixed count, e.g. --samples ${STATEFUL_SAMPLES}`);
  SAMPLES = STATEFUL_SAMPLES;
  console.log(`sub-frames: a fixed ${STATEFUL_SAMPLES} per frame, since ${which} (adaptive sampling needs stateless scenes); --samples N sets another count`);
}

/**
 * ffmpeg inputs and filter for the soundtrack over [from, to): the segments trimmed and spliced with
 * silence between them (no mixing: each file as it is, with only the segments' own fade-outs).
 */
function spliceAudio(segs: NonNullable<Info['audio']>, from: number, to: number) {
  const files = [...new Set(segs.map((s) => s.file))];
  const inputs = files.flatMap((f) => ['-i', path.join(PROJECT, f)]);
  const parts: string[] = [];
  const labels: string[] = [];
  let t = from, k = 0;
  const fmt = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
  const silence = (d: number) => { parts.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${d.toFixed(6)},${fmt}[p${k}]`); labels.push(`[p${k++}]`); };
  for (const s of [...segs].sort((a, b) => a.at - b.at)) {
    const a = Math.max(t, s.at), b = Math.min(to, s.at + s.dur);
    if (b <= a) continue;
    if (a > t + 1e-6) silence(a - t);
    const fx: string[] = [];
    if (s.fadeOut) {
      const fadeAt = s.at + s.dur - s.fadeOut; // video time where the fade starts
      if (a >= fadeAt) {
        const remaining = s.at + s.dur - a;
        fx.push(`volume=${Math.min(1, remaining / s.fadeOut)}`, `afade=t=out:st=0:d=${remaining.toFixed(6)}`);
      } else if (b > fadeAt) fx.push(`afade=t=out:st=${(fadeAt - a).toFixed(6)}:d=${s.fadeOut}`);
    }
    const i = files.indexOf(s.file) + 1; // input 0 is the video pipe
    parts.push(`[${i}:a]atrim=start=${(s.from + a - s.at).toFixed(6)}:end=${(s.from + b - s.at).toFixed(6)},asetpts=PTS-STARTPTS,${fmt}${fx.length ? ',' + fx.join(',') : ''}[p${k}]`);
    labels.push(`[p${k++}]`);
    t = b;
  }
  if (to > t + 1e-6) silence(to - t);
  parts.push(`${labels.join('')}concat=n=${labels.length}:v=0:a=1[aout]`);
  return { inputs, filter: parts.join(';') };
}

/** ffmpeg with libx264, or a message that says how to get it. */
function checkFfmpeg() {
  let r: ReturnType<typeof Bun.spawnSync>;
  try { r = Bun.spawnSync(['ffmpeg', '-hide_banner', '-encoders']); }
  catch { return fail('ffmpeg not found. Install it (Windows: winget install Gyan.FFmpeg; macOS: brew install ffmpeg; Linux: sudo apt install ffmpeg), then open a new terminal so it is on PATH.'); }
  if (r.exitCode !== 0) fail(`ffmpeg does not run (ffmpeg -encoders exited with ${r.exitCode}): reinstall it.`);
  if (!/libx264/.test(String(r.stdout ?? ''))) fail('this ffmpeg has no libx264 (H.264) encoder: install a full build (Windows: winget install Gyan.FFmpeg; macOS: brew install ffmpeg; Linux: sudo apt install ffmpeg).');
}

async function video(page: Page, info: Info, from: number, to: number, fps: number, out: string) {
  checkFfmpeg();
  // the final render encodes slowly at a low CRF (fine grain and gradients survive); a draft is for judging motion
  const preset = opt('preset', DRAFT ? 'veryfast' : 'slow')!, crf = opt('crf', DRAFT ? '23' : '16')!;
  mkdirSync(path.dirname(out), { recursive: true });
  // written beside the target and renamed when complete: a failed render leaves no file that passes for one
  const part = `${out}.part`;
  const OW = info.width, OH = info.height;
  const segs = flag('noaudio') ? null : info.audio;
  const args = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${OW}x${OH}`, '-r', String(fps), '-i', 'pipe:0'];
  const frames0 = Math.round(from * fps), frames1 = Math.round(to * fps), total = frames1 - frames0;
  // what the file will be, before the minutes it takes: a size or length nobody wanted is stopped now, not found at the end
  const scaled = SCALE !== 1 ? ` (${SCALE}x the video's ${info.logicalWidth}x${info.logicalHeight})` : '';
  const shown = path.relative(process.cwd(), out);
  console.log(`-> ${shown.startsWith('..') || path.isAbsolute(shown) ? out : shown}: ${OW}x${OH}${scaled} at ${fps} fps, ${+(to - from).toFixed(3)} s (${total} frames)${segs?.length ? '' : ', no audio'}`);
  console.log(`${DRAFT ? 'DRAFT, a quick look, not the final render (leave out --draft for that): ' : ''}${describeSampling(SAMPLES)}; x264 ${preset}, CRF ${crf}`);
  if (segs?.length) {
    const s = segs[0]!;
    if (segs.length === 1 && s.at === 0 && s.from === 0 && !s.fadeOut && from < s.dur - 1e-3) {
      // one file from 0: read it straight for the clip's length (a file that ends sooner just ends, and
      // apad fills the rest with silence; the length the browser read from the file's header isn't trusted)
      args.push('-ss', String(from), '-t', String(to - from), '-i', path.join(PROJECT, s.file));
      args.push('-map', '0:v', '-map', '1:a', '-af', 'apad');
    } else {
      const splice = spliceAudio(segs, from, to);
      args.push(...splice.inputs, '-filter_complex', splice.filter, '-map', '0:v', '-map', '[aout]');
    }
  }
  // Frames are sRGB (toSRGB in the final pass): convert with the BT.709 matrix and tag the stream,
  // otherwise ffmpeg converts with BT.601 while players and YouTube decode untagged HD as BT.709.
  // scale tags the matrix and range; primaries and transfer need setparams (the -color_* output flags don't reach the stream).
  args.push('-vf', 'vflip,scale=out_color_matrix=bt709,setparams=color_primaries=bt709:color_trc=bt709', '-c:v', 'libx264', '-preset', preset, '-crf', crf, '-pix_fmt', 'yuv420p', '-tune', opt('tune', 'grain')!, '-x264-params', opt('x264', 'aq-mode=3')!);
  // (the picture sets the length: the sound is cut or padded to it)
  if (segs?.length) args.push('-c:a', 'aac', '-b:a', '320k', '-t', (total / fps).toFixed(6), '-shortest');
  args.push('-movflags', '+faststart', '-f', 'mp4', part);
  const ff = Bun.spawn(args, { stdin: 'pipe', stdout: 'inherit', stderr: 'inherit' });
  const discard = () => rmSync(part, { force: true });
  let frames = 0;
  const t0 = performance.now();
  const server = Bun.serve({
    port: 0,
    fetch(req, srv) { return srv.upgrade(req) ? undefined : new Response('ws only', { status: 400 }); },
    websocket: {
      maxPayloadLength: Math.max(64 * 1024 * 1024, OW * OH * 4 + 1024),
      async message(ws, msg) {
        ff.stdin.write(msg as Uint8Array);
        await ff.stdin.flush();
        frames++;
        ws.send(String(frames)); // ack: the page keeps at most a few frames ahead of ffmpeg (bounded memory at 4K)
        if (frames % Math.max(1, Math.round(fps)) === 0 || frames === total) {
          const el = (performance.now() - t0) / 1000;
          process.stdout.write(`\r${frames}/${total} frames  ${(frames / el).toFixed(1)} fps  eta ${((total - frames) / (frames / el)).toFixed(0)}s   `);
        }
      },
    },
  });
  let used: Record<string, number>;
  try {
    used = await page.evaluate((o) => (window as any).__audara.stream(o), { from, to, fps, ws: `ws://localhost:${server.port}`, samples: SAMPLES, shutter: SHUTTER, inflight: 4 });
    // wait for all frames to arrive (or for ffmpeg to give up)
    while (frames < total && ff.exitCode === null) await Bun.sleep(20);
  } catch (e) {
    // (no half-written video: stop the encoder and the socket, then say why)
    ff.kill();
    await ff.exited;
    server.stop(true);
    discard();
    throw e;
  }
  ff.stdin.end();
  const code = await ff.exited;
  server.stop();
  if (code !== 0) { discard(); fail(`ffmpeg failed with exit code ${code} (its message is above); nothing was written to ${out}`); }
  try { renameSync(part, out); }
  catch (e) { fail(`the video is complete in ${part}, but ${out} can't be replaced (open in a player?): ${(e as Error).message}`); }
  console.log(`\nwrote ${out} (${DRAFT ? 'a draft: ' : ''}${frames} frames in ${((performance.now() - t0) / 1000).toFixed(1)}s, ${OW}x${OH} @ ${fps} fps${segs?.length ? '' : ', no audio'})`);
  console.log(`sub-frames per frame (count:frames): ${hist(used)}`);
}

/**
 * verify: the checks that run in the page. Renders a frame at every word (start ±1 frame, middle, end),
 * every cut (±1 frame) and every half second; then the determinism probes; then the soundtrack's files.
 */
async function verifyInPage(page: Page, earlier: number[]) {
  return page.evaluate(async (earlier: number[]) => {
    const p = (window as any).__audara, E = p.engine;
    const fps: number = p.fps, D: number = p.duration, f1 = 1 / fps;
    const TL = p.timeline as { id: string; start: number; end: number }[];
    const words = E.words.words as { w: string; start: number; end: number }[];
    const yieldNow = () => new Promise((r) => setTimeout(r, 0));
    const at = (t: number) => TL.filter((e) => t >= e.start && t < e.end).map((e) => e.id);

    const N = p.width * p.height * 4;
    const ref = new Uint8Array(N), cur = new Uint8Array(N);
    /**
     * A 64-bit hash of a frame's pixels (two 32-bit xor-multiply-rotate lanes over its 32-bit words). A frame is
     * a function of t, so the same frame hashes the same in every run: equal hashes, unchanged pixels. (The
     * rotation matters: a multiply carries bits only upward, so without it a change to a pixel's green or blue,
     * the high bytes of its word, lived in a few top bits and often cancelled out: one level of blue over part
     * of a white frame hashed the same as the frame.) A change to it bumps HASH_VERSION.
     */
    const hash = (b: Uint8Array) => {
      const u = new Uint32Array(b.buffer, b.byteOffset, b.byteLength >> 2);
      let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
      for (let i = 0; i < u.length; i++) {
        const k = u[i]!;
        h1 = Math.imul(h1 ^ k, 2654435761); h1 = (h1 << 13) | (h1 >>> 19);
        h2 = Math.imul(h2 ^ k, 1597334677); h2 = (h2 << 17) | (h2 >>> 15);
      }
      h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
      return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
    };

    // 1. every word, cut and half second. The frames at every half second, frame 0 and the last, both sides of
    // every cut and each word's first are also hashed, for the next verify to compare (a readback waits for the
    // GPU, about 17 ms a frame at 1080p, so not every frame: a lyric video has four per word)
    const times = new Set<number>([0, D - f1]), hashed = new Set<number>([0, D - f1]);
    for (const w of words) for (const t of [w.start - f1, w.start + f1, (w.start + w.end) / 2, w.end]) times.add(t);
    for (const w of words) hashed.add(w.start + f1);
    for (const e of TL) for (const t of [e.start - f1, e.start + f1, e.end - f1]) { times.add(t); hashed.add(t); }
    for (let t = 0; t < D; t += 0.5) { times.add(t); hashed.add(t); }
    let frames = 0;
    const shots: { t: number; scenes: string[]; hash: string }[] = [];
    for (const t of [...times].sort((a, b) => a - b)) {
      if (t < 0 || t >= D) continue;
      p.still(t); frames++;
      if (hashed.has(t)) {
        await E.readPixelsAsync(ref);
        shots.push({ t, scenes: at(t), hash: hash(ref) });
      }
      if (frames % 20 === 0) await yieldNow();
    }
    // ...and the times the earlier report hashed that this run doesn't sample (a word that moved: its old start),
    // so a change there is compared too. They are compared, not kept in this report, so the list doesn't grow.
    const again: { t: number; scenes: string[]; hash: string }[] = [];
    for (const t of earlier) {
      if (!(t >= 0 && t < D) || hashed.has(t)) continue;
      p.still(t);
      await E.readPixelsAsync(ref);
      again.push({ t, scenes: at(t), hash: hash(ref) });
    }

    // 2. determinism: a frame must not depend on what was rendered before it. Each probe time is rendered
    // after seeking from 1 s before, from 1 s after and from 0, and (when no stateful scene is on screen)
    // straight after the previous frame, as the export renders it; the pixels must be identical.
    const snap = (t: number) => Math.round(t * fps) / fps;
    const probes = new Set<number>();
    for (const e of TL) { probes.add(snap(e.start)); if (e.start > 0) probes.add(snap(e.start) - f1); }
    const ws = words.length <= 8 ? words : Array.from({ length: 8 }, (_, i) => words[Math.floor((i * words.length) / 8)]!);
    for (const w of ws) probes.add(snap((w.start + w.end) / 2));
    for (let i = 0; i < 16; i++) probes.add(snap(D * ((0.5 + i * 0.6180339887) % 1))); // spread evenly, not on the beat grid
    const render = async (from: number, t: number, into: Uint8Array) => {
      E.render(from, f1, false, 1);
      E.render(t, f1, false, 1);
      await E.readPixelsAsync(into);
    };
    const statefulAt = (t: number) => at(t).some((id) => E.loaded.get(id)?.scene?.stateful);
    const probeResults: { t: number; scenes: string[]; variants: { from: number; how: string; differing: number; maxDiff: number }[] }[] = [];
    for (const t of [...probes].filter((t) => t >= 0 && t < D).sort((a, b) => a - b)) {
      const variants: { from: number; how: string }[] = [];
      if (t - 1 >= 0) variants.push({ from: t - 1, how: 'seek from 1 s before' });
      if (t + 1 < D) variants.push({ from: t + 1, how: 'seek from 1 s after' });
      // (near either end, a second seek from the other side, so frame 0 and the last frames are probed too)
      if (t - 1 < 0 && t + 2 < D) variants.push({ from: t + 2, how: 'seek from 2 s after' });
      if (t + 1 >= D && t - 2 >= 0) variants.push({ from: t - 2, how: 'seek from 2 s before' });
      if (t > 1.5) variants.push({ from: 0, how: 'seek from 0' });
      if (t - f1 >= 0 && !statefulAt(t)) variants.push({ from: t - f1, how: 'step from the previous frame' });
      if (variants.length < 2) continue;
      const res: { from: number; how: string; differing: number; maxDiff: number }[] = [];
      await render(variants[0]!.from, t, ref);
      res.push({ ...variants[0]!, differing: 0, maxDiff: 0 });
      for (const v of variants.slice(1)) {
        await render(v.from, t, cur);
        let differing = 0, maxDiff = 0;
        for (let i = 0; i < N; i += 4) {
          const d = Math.max(Math.abs(ref[i]! - cur[i]!), Math.abs(ref[i + 1]! - cur[i + 1]!), Math.abs(ref[i + 2]! - cur[i + 2]!));
          if (d) { differing++; if (d > maxDiff) maxDiff = d; }
        }
        res.push({ ...v, differing, maxDiff });
      }
      probeResults.push({ t, scenes: at(t), variants: res });
      await yieldNow();
    }

    // 3. motion blur at the hard cuts: no sub-frame of the frames either side of a cut may show a scene from
    // across it (it would double-expose the cut in every export with --samples); 4 sub-frames, widest shutter
    const leaks: { cut: number; t: number; entries: string[] }[] = [];
    for (const b of E.cuts as number[]) {
      const n = Math.ceil(b * fps - 1e-6); // the first frame at or after the cut
      for (const t of [(n - 1) / fps, n / fps]) {
        if (t < 0 || t >= D) continue;
        E.render(t, f1, false, 4, 1);
        const across = ([...E.lastEntries] as string[]).filter((id) => {
          const e = TL.find((x) => x.id === id)!;
          return t >= b ? e.end <= b : e.start >= b;
        });
        if (across.length) leaks.push({ cut: b, t, entries: across });
      }
    }

    // 4. the soundtrack: every file readable, every segment inside its file
    const segs = (p.audio ?? []) as { file: string; at: number; from: number; dur: number }[];
    const meta = (url: string) => new Promise<number | null>((resolve) => {
      const a = new Audio();
      a.preload = 'metadata';
      a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) ? a.duration : null);
      a.onerror = () => resolve(null);
      a.src = url;
    });
    const fileLengths: Record<string, number | null> = {};
    for (const s of segs) if (!(s.file in fileLengths)) fileLengths[s.file] = await meta('/' + s.file.split('/').map(encodeURIComponent).join('/'));
    return { frames, shots, again, probes: probeResults, cuts: E.cuts as number[], leaks, segments: segs, fileLengths };
  }, earlier);
}

/** A project file as JSON, or null when it is missing or isn't JSON. */
function readJson(rel: string): any {
  try { return JSON.parse(projectText(rel)); } catch { return null; }
}
/** The record the soundtrack skill's beats.py window writes into a window's audio.json and words.json. */
interface WindowRecord { song: string; from: number; to: number; file: string; fade?: number | null; name?: string; exact?: boolean }
const windowOf = (doc: any): WindowRecord | null => {
  const w = doc?.window;
  return w && typeof w === 'object' && typeof w.file === 'string' && Number.isFinite(w.from) && Number.isFinite(w.to) ? w : null;
};
/** The command that cuts the window again, from the whole song's data the soundtrack skill keeps in data/song/. */
const recut = (video: string, w: WindowRecord) =>
  `the soundtrack skill's beats.py window --video ${video} --from ${w.from} --to ${w.to}${w.fade ? ` --fade ${w.fade}` : ''}${w.name ? ` --name ${w.name}` : ''}${w.exact ? ' --exact' : ''}`;

/**
 * The timing data (data/audio.json, data/words.json) against what the video plays. A window of a song is in the
 * window's time, so the video has to play the window file (on its own, or as the music of a mix placed at 0) and
 * both files have to be that window's: otherwise every cut and lyric is off while each frame looks fine.
 * `lengthFix(file)`: what to do when data/audio.json's length isn't the one file the video plays.
 */
function checkTimingData(video: string, files: string[], duration: number) {
  const dir = `videos/${video}`, errors: string[] = [], warnings: string[] = [];
  const A = readJson(`${dir}/data/audio.json`), Wd = readJson(`${dir}/data/words.json`);
  const winA = windowOf(A), winW = windowOf(Wd);
  const named = (f: string) => (f.startsWith(`${dir}/`) ? f.slice(dir.length + 1) : f);
  if (winA) {
    const own = path.posix.normalize(`${dir}/${winA.file}`);
    const mix = files.map((f) => ({ f, m: readJson(`${f}.request.json`)?.resolved?.music }))
      .find(({ m }) => typeof m?.file === 'string' && path.posix.normalize(m.file) === own);
    if (!files.includes(own) && !mix)
      errors.push(`audio: data/audio.json is the window ${winA.from}–${winA.to} s of ${winA.song} (the soundtrack skill's beats.py window), in the window's time, but video.json ${files.length ? `plays ${files.map(named).join(', ')}` : 'plays no audio'}: set "audio": "${winA.file}" in ${dir}/video.json, with no "duration"`);
    else if (mix && Math.abs((+mix.m.at || 0) - (+mix.m.from || 0)) > 0.0005)
      warnings.push(`audio: ${named(mix.f)} holds the window from ${+mix.m.at || 0} s, but data/ is in the window's own time: place the window at 0 in mix.json`);
  }
  const lines: any[] = Array.isArray(Wd?.lines) ? Wd.lines : [];
  const timedTo = (doc: any) => (typeof doc?.audioSha256 === 'string' && doc.audioSha256 ? doc.audioSha256 : null);
  const sameWindow = (x: WindowRecord, y: WindowRecord) => x.file === y.file && x.from === y.from && x.to === y.to && x.song === y.song;
  // (a narration's words are timed to the narration, which a mix places: not the window's to match)
  if (lines.length && Wd?.source?.kind !== 'narration') {
    if (winA && !(winW && sameWindow(winA, winW)) && !(timedTo(Wd) && timedTo(Wd) === timedTo(A))) {
      const last = Math.max(0, ...lines.flatMap((l) => (Array.isArray(l?.words) ? l.words : []).map((x: any) => (Number.isFinite(x?.end) ? x.end : 0))));
      const what = winW ? `they are the window ${winW.from}–${winW.to} s's` : last > duration + 0.05 ? `they run to ${last.toFixed(2)} s, past the window's end at ${duration.toFixed(2)} s: the whole song's words, in the song's time` : 'it has no window record';
      errors.push(`words: data/words.json is not this window's words (${what}): if they are the song's, move the file to ${dir}/data/song/words.json; then cut the window again: ${recut(video, winA)}`);
    } else if (!winA && winW && !(timedTo(A) && timedTo(A) === timedTo(Wd)))
      errors.push(`words: data/words.json holds the words of the window ${winW.from}–${winW.to} s of ${winW.song}, in the window's time, but data/audio.json ${A ? `is not that window's data${typeof A.audioFile === 'string' ? ` (it was made from ${A.audioFile})` : ''}` : 'is missing'}: to play the window, cut it again (${recut(video, winW)}); to play the whole song, put ${dir}/data/song/words.json in its place`);
  }
  const win = winA ?? winW, made = typeof A?.audioFile === 'string' ? A.audioFile : null;
  const lengthFix = (file: string) => win ? `cut the window again: ${recut(video, win)}`
    : !made ? `the analysis was made from another file: analyze this one (the soundtrack skill's beats.py)`
    : path.posix.normalize(`${dir}/${made}`) === file ? `${made} has changed since it was analyzed: analyze it again (the soundtrack skill's beats.py)`
    : `the analysis was made from ${made}: play that file, or analyze this one (the soundtrack skill's beats.py)`;
  return { errors, warnings, lengthFix };
}

type Shot = { t: number; scenes: string[]; hash: string };
/**
 * How verifyInPage hashes a frame, kept in the report: a report hashed another way isn't compared, since every
 * frame would differ (2: the lanes rotate their state; 1, unmarked: they didn't).
 */
const HASH_VERSION = 2;
type Entry = { id: string; start: number; end: number };
/**
 * What changed since an earlier verify of the same video (`prev`, its report): the frames both rendered at the
 * same times, compared by the hash of their pixels, so a sampled frame that changed is known, not guessed (a frame is
 * a function of t); a change of length; and the timeline entries that were added, removed or moved. `lines` are
 * for the console, `report` for verify.json. A report from another size, scale, frame rate, path or --only isn't
 * compared.
 */
function changesSince(prev: any, from: string, shots: Shot[], info: Info, timeline: Entry[]) {
  const d = typeof prev?.at === 'string' ? new Date(prev.at) : null, two = (n: number) => String(n).padStart(2, '0');
  const when = d && !isNaN(+d) ? `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}` : 'an earlier run';
  const head = `changed since the verify of ${when} (${from})`;
  const was = (k: string, a: unknown, b: unknown) => (JSON.stringify(a) === JSON.stringify(b) ? null : `${k} ${JSON.stringify(a)}, now ${JSON.stringify(b)}`);
  const why = !Array.isArray(prev?.shots) ? 'it predates frame hashes'
    : (prev.hashVersion ?? 1) !== HASH_VERSION ? 'another copy of render.ts hashed its frames another way'
    : prev.video !== info.video ? `it is of video ${JSON.stringify(prev.video)}`
    : was('size', prev.size, [info.logicalWidth, info.logicalHeight]) ?? was('scale', prev.scale, SCALE) ?? was('fps', prev.fps, info.fps)
      ?? was('path', prev.path, info.exporting ? 'full quality (ctx.export)' : 'preview (--as-preview)') ?? was('--only', prev.only, ONLY.length ? ONLY : null);
  if (why) return { lines: [`changes: not compared with ${from} (${why})`], report: { since: from, compared: false, why } };
  // a change of length: the time only one run has can't be compared, so it is named (a video cut to half its
  // length with its timeline left as it was would otherwise show no sampled frame changed)
  const D = info.duration, D0 = typeof prev.duration === 'number' && Number.isFinite(prev.duration) ? prev.duration : D;
  const resized = Math.abs(D0 - D) > 1e-6, both = Math.min(D0, D);
  // (keyed by the exact time: both runs compute it the same way, and JSON keeps a number exactly; a rounded
  // key would merge a word's frame at 0.49997 s with the half second's at 0.5, two different frames)
  const before = new Map<number, string>((prev.shots as Shot[]).map((s) => [s.t, s.hash]));
  // stretches of changed frames: a run of them, broken by a frame that is the same (a time only one run
  // rendered, such as a word that moved, is neither)
  const runs: Shot[][] = [];
  let compared = 0, changed = 0, open = false;
  for (const s of [...shots].sort((a, b) => a.t - b.t)) {
    const h = before.get(s.t);
    if (h === undefined) continue;
    compared++;
    if (h === s.hash) { open = false; continue; }
    changed++;
    if (open) runs.at(-1)!.push(s); else { runs.push([s]); open = true; }
  }
  const stretches = runs.map((r) => ({ from: r[0]!.t, to: r.at(-1)!.t, scenes: [...new Set(r.flatMap((s) => s.scenes))] }));
  const named = (ids: string[]) => (ids.length ? ids.map((x) => `'${x}'`).join(', ') : 'no scene');
  const span = (s: { from: number; to: number }) => (s.from === s.to ? `${s.from.toFixed(3)} s` : `${s.from.toFixed(3)}–${s.to.toFixed(3)} s`);
  const old = new Map<string, Entry>(Array.isArray(prev.timeline) ? (prev.timeline as Entry[]).map((e) => [e.id, e]) : []);
  const now = new Map<string, Entry>(timeline.map((e) => [e.id, e]));
  const moved: string[] = [];
  const at = (e: Entry) => `${e.start.toFixed(3)}–${e.end.toFixed(3)}`;
  for (const [id, e] of now) {
    const o = old.get(id);
    if (!o) moved.push(`'${id}' added at ${at(e)} s`);
    else if (Math.abs(o.start - e.start) > 1e-6 || Math.abs(o.end - e.end) > 1e-6) moved.push(`'${id}' ${at(o)} → ${at(e)} s`);
  }
  for (const id of old.keys()) if (!now.has(id)) moved.push(`'${id}' removed`);
  const lines = [!changed
    ? `${head}: no sampled frame${resized ? ` in the 0–${both.toFixed(3)} s both runs have` : ''} (${compared} compared)`
    : `${head}: ${changed} of ${compared} sampled frames, in ${stretches.map((s) => `${span(s)} (${named(s.scenes)})`).join('; ')}`
      + (changed > 0.9 * compared && compared >= 10 ? ' — nearly every frame: as after a change to what every scene shares (src/look.ts, POST, the engine, a font); if nothing like that changed, the browser or the GPU did' : '')];
  if (resized) lines.push(`length since then: ${D0.toFixed(3)} → ${D.toFixed(3)} s (${both.toFixed(3)}–${Math.max(D0, D).toFixed(3)} s ${D < D0 ? 'removed' : 'added'}, not compared)`);
  if (moved.length) lines.push(`timeline since then: ${moved.join('; ')}`);
  return { lines, report: { since: from, at: prev.at ?? null, compared, changed, stretches, duration: resized ? { was: D0, now: D } : null, timeline: moved } };
}

async function verify(page: Page, info: Info, logs: string[], out: string) {
  const t0 = performance.now();
  // the earlier report to compare with: --since <report>, else the one this run replaces
  const since = opt('since') ? path.resolve(opt('since')!) : out;
  if (opt('since') && !existsSync(since)) fail(`--since ${opt('since')}: no such report (an earlier verify.json, kept for instance in a critic round's folder)`);
  let prev: any = null;
  try { prev = existsSync(since) ? JSON.parse(readFileSync(since, 'utf8')) : null; } catch {}
  // (the earlier report's sample times, so a frame it sampled that this run wouldn't, such as a moved word's, is compared too)
  const earlier: number[] = Array.isArray(prev?.shots) ? prev.shots.map((s: Shot) => s.t).filter((t: unknown) => typeof t === 'number' && Number.isFinite(t)) : [];
  const r = await verifyInPage(page, earlier);
  const errors: string[] = [], warnings: string[] = [...info.warnings];
  const D = info.duration;
  // scene and boot errors, as they stand after all those renders
  const sceneErrors: string[] = await page.evaluate(() => (window as any).__audara.errors);
  errors.push(...sceneErrors);
  // determinism
  const bad = r.probes.filter((p) => p.variants.some((v) => v.differing > 0));
  const perScene: Record<string, { probes: number; mismatches: number }> = {};
  for (const p of r.probes) for (const id of p.scenes.length ? p.scenes : ['(none)']) {
    const s = (perScene[id] ??= { probes: 0, mismatches: 0 });
    s.probes++;
    if (p.variants.some((v) => v.differing > 0)) s.mismatches++;
  }
  // (one line per scene; every probe and variant is in the report)
  const groups = new Map<string, typeof bad>();
  for (const p of bad) {
    const k = p.scenes.length ? p.scenes.map((s) => `'${s}'`).join(' + ') : 'no scene';
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  for (const [k, ps] of groups) {
    const all = r.probes.filter((p) => (p.scenes.length ? p.scenes.map((s) => `'${s}'`).join(' + ') : 'no scene') === k).length;
    const vs = ps.flatMap((p) => p.variants.filter((v) => v.differing > 0));
    const hows = [...new Set(vs.map((v) => v.how))];
    const ts = ps.map((p) => p.t.toFixed(3));
    errors.push(`determinism: ${k} renders the same t differently at ${ps.length} of ${all} probes (t=${ts.slice(0, 6).join(', ')}${ts.length > 6 ? ', …' : ''}; up to ${Math.max(...vs.map((v) => v.differing))} px differ, max ${Math.max(...vs.map((v) => v.maxDiff))}/255) when reached by ${hows.join(' / ')} instead of "${ps[0]!.variants[0]!.how}". A frame must depend on t only: look for Math.random(), Date.now(), performance.now(), state kept between render() calls, a render target not fully overwritten, or (a few pixels off by 1/255) additive blending of overlapping geometry, which some GPUs round differently from one render to the next (LineBatch blend 'add': use 'max').`);
  }
  // motion blur across the cuts
  for (const l of r.leaks)
    errors.push(`motion blur: with --samples, the frame at ${l.t.toFixed(3)} s blends in ${l.entries.map((x) => `'${x}'`).join(', ')} from across the cut at ${l.cut.toFixed(3)} s (a double exposure on the cut): the engine keeps sub-frames on their frame's side of a cut (Engine.render, sameSide), so look there`);
  // entries left out by --only render black: what verify checked is only what was loaded
  if (ONLY.length) {
    const left = info.timeline.map((e) => e.id).filter((id) => !ONLY.includes(id));
    if (left.length) warnings.push(`--only ${ONLY.join(',')}: ${left.join(', ')} not loaded (they rendered black; verify the whole video before calling it done)`);
  }
  // the soundtrack against the timeline
  for (const [file, len] of Object.entries(r.fileLengths)) if (len === null) errors.push(`audio: cannot read ${file}`);
  for (const s of r.segments) {
    const len = r.fileLengths[s.file];
    if (len != null && s.from + s.dur > len + 0.05) errors.push(`audio: a segment of ${s.file} plays ${s.from.toFixed(3)}–${(s.from + s.dur).toFixed(3)} s, past the file's end (${len.toFixed(3)} s)`);
  }
  // the timing data against what plays (one fix per problem: a window not played says so, not its length)
  const timing = checkTimingData(info.video, [...new Set(r.segments.map((s) => s.file))], D);
  errors.push(...timing.errors);
  warnings.push(...timing.warnings);
  if (r.segments.length) {
    const end = Math.max(...r.segments.map((s) => s.at + s.dur));
    const single = r.segments.length === 1 && r.segments[0]!.at === 0 && r.segments[0]!.from === 0;
    const len = single ? r.fileLengths[r.segments[0]!.file] : null;
    if (single && info.durationSource === 'data/audio.json' && len != null && Math.abs(len - D) > 0.1) {
      if (!timing.errors.length) errors.push(`audio: data/audio.json says the video is ${D.toFixed(3)} s but ${r.segments[0]!.file} is ${len.toFixed(3)} s: ${timing.lengthFix(r.segments[0]!.file)}`);
    } else if (Math.abs(end - D) > 0.1)
      warnings.push(end < D ? `audio: the soundtrack ends at ${end.toFixed(2)} s, the video at ${D.toFixed(2)} s (silence at the end)` : `audio: the video ends at ${D.toFixed(2)} s and cuts the soundtrack (which runs to ${end.toFixed(2)} s)`);
  } else warnings.push('audio: none (a silent video)');
  // gaps: time with no scene renders black
  const spans = [...info.timeline].sort((a, b) => a.start - b.start);
  let covered = 0;
  for (const e of spans) {
    if (e.start > covered + 1e-6) warnings.push(`no scene from ${covered.toFixed(3)} to ${Math.min(e.start, D).toFixed(3)} s (renders black)`);
    covered = Math.max(covered, e.end);
  }
  if (covered < D - 1e-6) warnings.push(`no scene from ${covered.toFixed(3)} to ${D.toFixed(3)} s (renders black)`);
  // (WebGL errors are console warnings: a draw the GPU refused leaves part of a frame missing)
  const browserErrors = logs.filter(isProblem);
  errors.push(...browserErrors.map((l) => `browser: ${l}${SECOND_THREE.test(l) ? ` ${SECOND_THREE_FIX}` : ''}`));
  const passed = errors.length === 0;
  const renders = r.probes.reduce((n, p) => n + p.variants.length, 0);
  const rel = path.relative(PROJECT, since), from = rel.startsWith('..') || path.isAbsolute(rel) ? since : rel.replace(/\\/g, '/');
  const changes = prev ? changesSince(prev, from, [...r.shots, ...r.again], info, info.timeline)
    : { lines: ['changes: none to compare (the first verify here: the next one names the stretches that change after it)'], report: null };
  const result = {
    passed, at: new Date().toISOString(), video: info.video, title: info.title, duration: D, durationSource: info.durationSource, fps: info.fps,
    size: [info.logicalWidth, info.logicalHeight], scale: SCALE, frames: r.frames, only: ONLY.length ? ONLY : null,
    path: info.exporting ? 'full quality (ctx.export)' : 'preview (--as-preview)',
    determinism: { probes: r.probes.length, renders, mismatches: bad.length, perScene, details: r.probes },
    cuts: { times: r.cuts, motionBlurLeaks: r.leaks },
    audio: { segments: r.segments, fileLengths: r.fileLengths },
    timeline: info.timeline, errors, warnings, browserLog: logs, seconds: +((performance.now() - t0) / 1000).toFixed(1),
    changes: changes.report,
    // (the frames step 1 hashed, with their scenes: what the next verify compares)
    hashVersion: HASH_VERSION, shots: r.shots,
  };
  mkdirSync(path.dirname(out), { recursive: true });
  await Bun.write(out, JSON.stringify(result, null, 2));
  console.log(`verify ${info.video}${info.exporting ? '' : " (the scenes' preview path)"}: ${passed ? 'PASS' : 'FAIL'}  ${r.frames} frames, ${r.probes.length} determinism probes (${renders} renders, ${bad.length} mismatched), ${r.cuts.length} cut${r.cuts.length === 1 ? '' : 's'} checked for motion-blur leaks (${r.leaks.length} leaking), ${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}  (${result.seconds}s)`);
  for (const e of errors) console.log(`  error: ${e}`);
  for (const w of warnings) console.log(`  warning: ${w}`);
  for (const l of changes.lines) console.log(`  ${l}`);
  console.log(`  report: ${out}`);
  return passed;
}

/** perf's timing loop, run in the page: ms per frame until the GPU is done (and with the readback). */
function measure(page: Page, o: { from: number; n: number; fps: number; bare: boolean; readback: boolean }) {
  return page.evaluate(async ({ from, n, fps, bare, readback, samples, shutter }) => {
    const P = (window as any).__audara, E = P.engine;
    const buf = new Uint8Array(P.width * P.height * 4);
    const stats = (ms: number[]) => {
      const s = [...ms].sort((a, b) => a - b);
      return { avg: s.reduce((a, b) => a + b, 0) / s.length, p50: s[s.length >> 1]!, p95: s[Math.floor(s.length * 0.95)]!, max: s[s.length - 1]! };
    };
    const frame: number[] = [], full: number[] = [], used: Record<number, number> = {};
    E.bare = bare; // (no scene at all: the engine's own post-processing and HUD)
    E.render(from, 1 / fps, false); E.sync(); // (the seek, outside the timing)
    for (let i = 0; i < n; i++) {
      const a = performance.now();
      const k = E.render(from + i / fps, 1 / fps, false, samples, shutter);
      E.sync();
      frame.push(performance.now() - a);
      if (readback) { await E.readPixelsAsync(buf); full.push(performance.now() - a); }
      used[k] = (used[k] ?? 0) + 1;
    }
    E.bare = false;
    return { frame: stats(frame), full: readback ? stats(full) : null, used };
  }, { ...o, samples: SAMPLES, shutter: SHUTTER });
}

// ------------------------------------------------------------------ main
async function main() {
  if (!MODES.includes(mode)) fail(`unknown mode '${mode}': use one of ${MODES.join(', ')}`);
  const unknown = argv.filter((a) => a.startsWith('--') && !OPTIONS.has(a.slice(2)));
  if (unknown.length)
    fail(`${unknown.join(', ')}: not an option of this render.ts (its header lists every one). An instruction that names it is for a newer copy: the code-video skill's scripts/init.ts run again with --force updates the project's scripts, keeping each old file as <file>.orig`);
  // (an option given without its value reads as not given: --size alone would render the video's own format
  // into its own folder, a bare --out would write to the default path)
  const bare = argv.filter((a, i) => a.startsWith('--') && !FLAGS.has(a.slice(2)) && (argv[i + 1] === undefined || argv[i + 1]!.startsWith('--')));
  if (bare.length) fail(`${bare.join(', ')}: no value after it (the header says what each option takes)`);
  if (DRAFT && mode !== 'video') fail(`--draft is for video (a quick look at the motion); ${mode} ${mode === 'poster' ? 'is the full-quality frame' : 'renders one sub-frame per frame already'}`);
  parseSampling();
  if (mode === 'verify' && (SAMPLES_GIVEN || opt('shutter') !== undefined))
    console.log("verify: --samples and --shutter don't apply (its renders are fixed: one sub-frame, and four over the whole frame time at the cuts)");
  // (stopping needs no video)
  if (mode === 'preview' && flag('stop')) return stopPreview();
  const videos = listVideos();
  const name = opt('video') ?? defaultVideo(videos);
  if (!name) fail(`no videos in ${PROJECT}: add videos/<video>/video.json`);
  if (!videos.includes(name!)) fail(`unknown video '${name}' (--video): the videos here are ${videos.join(', ') || 'none'}`);
  checkVideoJson(name!);
  parseSize(name!);
  if (mode === 'link') return link(name!);
  if (mode === 'preview') return preview(name!);
  const OUT = path.join(PROJECT, 'out', name!, ...(SIZE ? [sizeTag()!] : []));
  console.log(`video: ${name}${SIZE ? ` at ${sizeTag()} (--size: into out/${name}/${sizeTag()}/)` : ''}${opt('video') ? '' : ` (default; others: ${videos.filter((v) => v !== name).join(', ') || 'none'})`}`);
  // (an explicit --out wins over --size: one copied from a command for the video's own format, such as
  // --out out/<video>/sheet.png, would replace that format's file)
  if (SIZE && opt('out')) {
    const o = path.resolve(opt('out')!);
    const under = (dir: string) => { const r = path.relative(dir, o); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };
    if (under(path.join(PROJECT, 'out', name!)) && !under(OUT))
      console.log(`warning: --out ${opt('out')} is outside out/${name}/${sizeTag()}/, where --size keeps this format's files: if a file of the video's own format is there, this run replaces it`);
  }

  const server = await ensureServer();
  let browser: Browser | undefined;
  let ok = true;
  try {
    browser = await launch();
    // (perf opens the preview path's page itself: this one draws the full-quality path)
    const { page, logs, info } = await openPage(browser, server, name!, AS_PREVIEW && mode !== 'perf');
    if (mode !== 'verify' && info.errors.length) fail('SCENE ERRORS:\n' + info.errors.join('\n'));
    const fps = info.fps, D = info.duration;
    // the export's last frame (video() renders frames 0 .. round(D * fps) - 1)
    const lastFrame = Math.max(0, Math.round(D * fps) - 1);
    const inside = (t: number, k = 't') => {
      if (t < 0 || t >= D) fail(`--${k} ${t}: outside the video, which runs from 0 to ${D} s (its last frame is at ${(lastFrame / fps).toFixed(3)} s)`);
    };
    if (mode === 'verify') {
      // (the preview path's report gets its own name: qc.py --cuts and the delivery read verify.json)
      ok = await verify(page, info, logs, path.resolve(opt('out', path.join(OUT, AS_PREVIEW ? 'verify-preview.json' : 'verify.json'))!));
    } else if (mode === 'gpu') {
      console.log(await page.evaluate(() => {
        const gl = document.createElement('canvas').getContext('webgl2')!;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      }));
    } else if (mode === 'stills') {
      const times = timesOf('t', opt('t') ?? '0');
      for (const t of times) inside(t);
      const dir = path.resolve(opt('out', path.join(OUT, AS_PREVIEW ? 'stills-preview' : 'stills'))!);
      const shots = times.map((t) => ({ t, file: path.join(dir, `f_${t.toFixed(2).padStart(7, '0')}.png`) }));
      const used = await stills(page, shots);
      if (typeof SAMPLES !== 'number') shots.forEach((s, i) => console.log(`t=${s.t}: ${used[i]} sub-frames`));
      console.log(shots.map((s) => s.file).join('\n'));
    } else if (mode === 'poster') {
      if (opt('t') === undefined) fail('poster needs --t <seconds>: the moment that best stands for the video (that one frame is rendered at full quality)');
      const ts = timesOf('t', opt('t')!);
      if (ts.length !== 1) fail(`--t ${opt('t')}: a poster is one frame, so one time`);
      const t = ts[0]!;
      inside(t);
      const file = path.resolve(opt('out', path.join(OUT, `poster${AS_PREVIEW ? '-preview' : ''}.png`))!);
      if (path.extname(file).toLowerCase() !== '.png') fail(`--out ${opt('out')}: a poster is written as a .png file`);
      await settleSampling(page, t - 1 / fps, t + 1 / fps);
      const [k] = await stills(page, [{ t, file }]);
      console.log(`poster at ${t} s: ${k} sub-frame${k === 1 ? '' : 's'}, shutter ${SHUTTER}, ${info.width}x${info.height}`);
      console.log(file);
    } else if (mode === 'sheet') {
      const clampN = (m: number) => Math.min(Math.max(0, m), lastFrame);
      const groups: Tile[][] = [];
      const tags: string[] = [];
      if (flag('cuts')) {
        // where blank or broken frames hide: frame 0, the last frame, and every cut (every time an entry starts
        // or ends inside the video: a hard cut, either edge of a crossfade, a scene against black), each as the
        // frame at or after it with its neighbours and 0.1 s either side, on a row of its own
        groups.push([{ t: 0, tag: 'first' }, { t: lastFrame / fps, tag: 'last' }]);
        const k = Math.max(1, Math.round(0.1 * fps)), s = (k / fps).toFixed(2);
        const bounds = info.timeline.flatMap((e) => [e.start, e.end]).filter((b) => b > 1e-6 && b < D - 1e-6);
        const cutFrames = [...new Set(bounds.map((b) => Math.ceil(b * fps - 1e-6)))].sort((a, b) => a - b);
        for (const n of cutFrames) {
          const row: (Tile & { m: number })[] = [];
          for (const [m, tag] of [[n - k, `-${s}s`], [n - 1, '-1f'], [n, 'cut'], [n + 1, '+1f'], [n + k, `+${s}s`]] as const)
            if (!row.some((x) => x.m === clampN(m))) row.push({ m: clampN(m), t: clampN(m) / fps, tag });
          groups.push(row.map(({ t, tag }) => ({ t, tag })));
        }
        tags.push('cuts');
      }
      if (opt('times')) {
        const times = timesOf('times', opt('times')!);
        for (const t of times) inside(t, 'times');
        groups.push(times.map((t) => ({ t })));
        tags.push('times');
      }
      if (!groups.length) {
        // the whole video by default
        const from = num('from', '0'), to = num('to', String(D)), n = int('n', '12');
        if (!(to > from) && n > 1) fail(`--from ${from} --to ${to}: an empty range`);
        groups.push(Array.from({ length: n }, (_, i) => ({ t: clampN(Math.round((from + ((to - from) * i) / Math.max(1, n - 1)) * fps)) / fps })));
        tags.push(`${from}-${+to.toFixed(3)}`);
      }
      // thumbnails of the same area whatever the frame's shape, as many columns as fit (a cut per row with
      // --cuts), each thumbnail made narrower if the columns asked for wouldn't fit
      const aspect = info.logicalWidth / info.logicalHeight;
      let tw = opt('thumb') ? int('thumb', '480', 16) : Math.round(Math.sqrt(SHEET.area * aspect));
      const cols = opt('cols') ? int('cols', '4') : flag('cuts') ? 5 : Math.max(1, Math.floor((SHEET.maxW - SHEET.pad) / (tw + SHEET.pad)));
      if (!opt('thumb')) tw = Math.max(16, Math.min(tw, Math.floor((SHEET.maxW - SHEET.pad) / cols) - SHEET.pad));
      const out = path.resolve(opt('out', path.join(OUT, 'sheets', `sheet_${tags.join('+')}${AS_PREVIEW ? '-preview' : ''}.png`))!);
      if (path.extname(out).toLowerCase() !== '.png') fail(`--out ${opt('out')}: a sheet is written as a .png file`);
      const r = await sheet(page, info, groups, cols, tw, out);
      const frames = groups.reduce((a, g) => a + g.length, 0);
      console.log(`sheet: ${frames} frame${frames === 1 ? '' : 's'}, ${r.rows} row${r.rows === 1 ? '' : 's'} of up to ${r.cols}, thumbnails ${tw}x${r.th}${r.files.length > 1 ? `, on ${r.files.length} pages` : ''}`);
      console.log(r.files.join('\n'));
    } else if (mode === 'perf') {
      const from = num('from', '0'), to = num('to', String(Math.min(D, 5)));
      const n = Math.round((Math.min(to, D) - from) * fps); // (counted by index: adding 1/fps to t drifts)
      if (!(n > 0)) fail(`--from ${from} --to ${to}: nothing to measure`);
      // the scenes read ctx.export once, when they start: the preview's path is timed in a page of its own
      const pv = await openPage(browser, server, name!, true);
      if (pv.info.errors.length) fail("SCENE ERRORS (the scenes' preview path):\n" + pv.info.errors.join('\n'));
      const bare = await measure(pv.page, { from, n, fps, bare: true, readback: false });
      const pre = await measure(pv.page, { from, n, fps, bare: false, readback: false });
      const pvErrors: string[] = await pv.page.evaluate(() => (window as any).__audara.errors);
      if (pvErrors.length) fail("SCENE ERRORS (the scenes' preview path):\n" + pvErrors.join('\n'));
      logs.push(...pv.logs);
      await pv.page.close();
      const exp = await measure(page, { from, n, fps, bare: false, readback: true });
      const f = (x: number) => x.toFixed(1);
      console.log(`perf ${name}: ${n} frames from ${from} s, ${info.width}x${info.height}${SAMPLES === 1 ? '' : `, sub-frames per frame ${hist(exp.used)}`}`);
      console.log(`  preview  avg ${f(pre.frame.avg)} ms  p50 ${f(pre.frame.p50)}  p95 ${f(pre.frame.p95)}  max ${f(pre.frame.max)}   until the GPU is done, on the scenes' preview path: what the live preview pays`);
      console.log(`           = the engine alone ${f(bare.frame.avg)} (post-processing, every frame pays it) + the scenes ${f(Math.max(0, pre.frame.avg - bare.frame.avg))}`);
      console.log(`  export   avg ${f(exp.full!.avg)} ms  p95 ${f(exp.full!.p95)}   on their full-quality path (ctx.export), the frame read back too`);
      console.log(`           a video frame costs more: the run also sends each frame to ffmpeg and encodes it (time a few seconds of video --draft for that)${SAMPLES === 1 ? ', and by default renders it as several sub-frames' : ''}`);
    } else if (mode === 'video') {
      const from = num('from', '0'), to = Math.min(num('to', String(D)), D);
      if (!(to > from)) fail(`--from ${from} --to ${to}: nothing to render`);
      await settleSampling(page, from, to);
      // only the whole video, every entry, on the full-quality path takes the final render's name: anything
      // less is named for what it is, so a quick clip can't replace the delivery
      const whole = from <= 1e-9 && to >= D - 1e-9;
      const parts = [name!, ...(whole ? [] : [`${+from.toFixed(3)}-${+to.toFixed(3)}`]), ...(ONLY.length ? [`only-${ONLY.join('+')}`] : []), ...(DRAFT ? ['draft'] : []), ...(AS_PREVIEW ? ['preview'] : [])];
      await video(page, info, from, to, fps, path.resolve(opt('out', path.join(OUT, `${parts.join('-')}.mp4`))!));
    }
    if (mode !== 'verify') {
      const finalErrors: string[] = await page.evaluate(() => (window as any).__audara.errors);
      if (finalErrors.length) fail('SCENE ERRORS:\n' + finalErrors.join('\n'));
      if (logs.length) console.error('BROWSER LOG:\n' + logs.slice(0, 40).join('\n'));
      if (logs.some(isProblem)) fail(`browser or WebGL errors occurred; the render is incomplete (see the log above)${logs.some((l) => SECOND_THREE.test(l)) ? `\n${SECOND_THREE_FIX}` : ''}`);
    }
  } finally {
    await browser?.close();
    server.stop();
  }
  if (!ok) process.exitCode = 1;
}

try {
  await main();
} catch (e) {
  const msg = String((e as Error)?.message ?? e);
  if (e instanceof Fail) console.error(`render.ts: ${msg}`);
  // (a dev server given with --url reloads the page when a file changes)
  else if (/context was destroyed|navigation/i.test(msg))
    console.error(`render.ts: the page reloaded mid-run: a file changed and the dev server given with --url (${opt('url')}) reloads on changes. Run it again, or leave --url out: a private server never reloads.`);
  // an exception thrown in the page (e.g. adaptive sampling refusing a stateful scene): its message, without the stack
  else if (/^(page\.)?evaluate:/.test(msg)) console.error(`render.ts: ${msg.replace(/^(page\.)?evaluate:\s*(Error:\s*)?/, '').split('\n')[0]}`);
  else console.error(e);
  process.exitCode = 1;
}
// (explicit: an in-process dev server or a socket left open must not keep the process alive)
process.exit(process.exitCode ?? 0);
