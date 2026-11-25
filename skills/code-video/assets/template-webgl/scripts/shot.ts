#!/usr/bin/env bun
// Shots made by a program: a picture drawn outside the browser (a Python or NumPy renderer, ModernGL, a path
// tracer, Blender, Manim, a native GPU program, a composition another framework renders to frames) played by
// the engine as a streamed shot (src/engine/footage.ts), so the preview, its ?t= links, stills, sheets, verify,
// the render and the QC report work on it as on any scene.
//
//   status [<shot>...]                each shot: current, stale (and what changed), not made yet, or footage
//                                     this script didn't make (a capture, cut footage: left as it is)
//   make [<shot>...] [--force] [--scale N]
//                                     runs the program of each shot whose inputs changed since it was made (all
//                                     shots with a recipe, or those named; --force: whatever changed), checks its
//                                     frames, encodes them, and publishes them; a running preview reloads at its
//                                     moment. --scale N: N times the recipe's size (a 4K master from a 1080p
//                                     one); the scale a shot was last made at stays until another is given
//   check <shot> [--n 4]              the f(t) rule for a program: renders --n frames again, each alone in a run
//                                     of its own, and two neighbours in one run started mid-shot, and compares
//                                     their pixels with the shot's (exit code 1 when one differs)
//   clean [<shot>...]                 removes every version of a shot's frames but the current one
//
// A shot's recipe is shots/<shot>/shot.json at the project root, beside the program's own files. Its paths are
// the recipe folder's; one that starts with / is the project root's:
//   { "command": ["uv", "run", "render.py", "--out", "{out}", "--first", "{first}", "--last", "{last}"],
//     "fps": 30, "frames": 240,       (or "duration": 8, in seconds)
//     "size": [1920, 1080],           the frames' size at the 1x scale: the size the shot fills at its largest
//     "inputs": ["**"],               what the frames are made from (default: every file of the recipe folder,
//                                     the recipe included); a change to one makes the shot stale
//     "cwd": ".",                     where the command runs (default: the recipe folder)
//     "quality": 2,                   the full frames' JPEG quality, 2 (best) to 31 (default 2)
//     "manifest": { ... } }           fields of your own for the published manifest (a title, settings)
// The command is run as it is written (no shell), with these in its arguments and as environment variables:
//   {out}    AUDARA_SHOT_OUT     the folder to write the frames to (absolute)
//   {first}  AUDARA_SHOT_FIRST   the first frame to write, from 1
//   {last}   AUDARA_SHOT_LAST    the last frame to write (inclusive)
//   {frames} AUDARA_SHOT_FRAMES  how many frames the whole shot has
//   {fps}    AUDARA_SHOT_FPS     their rate
//   {width} {height}  AUDARA_SHOT_WIDTH, AUDARA_SHOT_HEIGHT  the pixels to write: the recipe's size times the scale
//   {scale}  AUDARA_SHOT_SCALE
//   {tmp}    AUDARA_SHOT_TMP     a scratch folder for this run (the recipe folder is an input: write nothing there)
//   {shot}   AUDARA_SHOT_NAME
// Frame k (from 1) is the picture at (k - 1) / fps seconds into the shot, written as <out>/<k, six digits>.<ext>
// (000001.png ...; png, jpg, bmp, tif, ppm or webp), each at exactly width x height, opaque (an alpha channel is
// dropped: a transparent layer goes in as images, references/contract.md). Any other file the program writes
// there (events.json, the camera per frame) is published beside the manifest. A frame must not depend on the
// frames written before it in the same run: check renders frames alone and compares. A program that must step
// from the start (a simulation) steps there by itself, in every run, to the same pixels. Its command must be
// free and offline: make and check run it again (a generated clip is cut from its file, which is the input).
//
// Published, under footage/<shot>/: <version>/full/ (the frames, JPEG) and <version>/proxy/ (half the 1x size,
// for the preview) in a folder of their own that is never written again, made.json (what they were made from:
// the inputs' hashes, each frame's pixel hash, the scale), contact.jpg, the program's other files, then
// manifest.json last, naming the version ("dir"), which the engine reads; the version before stays for a
// render that opened it, older ones are removed. The frames are made under .audara-cache/shots/ first, so a
// failed run leaves the shot as it was. One make at a time per shot (.audara-cache/shots/<shot>.lock).
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const PROJECT = path.resolve(import.meta.dir, '..');
const SHOTS = path.join(PROJECT, 'shots');
const FOOTAGE = path.join(PROJECT, 'footage');
const CACHE = path.join(PROJECT, '.audara-cache', 'shots');
/** The protocol between this script, the program and the engine: a change of it makes every shot stale. */
const PROTOCOL = 1;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const FRAME = /^(\d{6})\.(png|jpe?g|bmp|tiff?|ppm|webp)$/i;
const VERSION = /^g(\d+)-[0-9a-f]{8}$/;
/** Never inputs, wherever a pattern reaches: folders a program, a tool or this script write into. */
const NEVER = /(^|\/)(node_modules|__pycache__|\.git|\.venv|\.audara-cache|out|footage)(\/|$)|\.pyc$/;

class Fail extends Error {}
const fail = (msg: string): never => { throw new Fail(msg); };
const rel = (p: string) => path.relative(PROJECT, p).split(path.sep).join('/');
const log = (s = '') => console.log(s);

// ------------------------------------------------------------------ arguments
const argv = process.argv.slice(2);
const MODES = ['status', 'make', 'check', 'clean'];
const mode = argv[0] ?? '';
if (mode === '-h' || mode === '--help' || !mode) {
  const head = readFileSync(import.meta.path, 'utf8').split(/\r?\n/).slice(1);
  log(head.slice(0, head.findIndex((l) => !l.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(mode ? 0 : 1);
}
const names: string[] = [];
const opts = new Map<string, string | true>();
for (let i = 1; i < argv.length; i++) {
  const a = argv[i]!;
  if (a === '--force') opts.set('force', true);
  else if (a === '--scale' || a === '--n') { const v = argv[++i]; if (v === undefined) fail(`${a} needs a value`); opts.set(a.slice(2), v!); }
  else if (a.startsWith('-')) fail(`unknown option ${a} (bun scripts/shot.ts --help)`);
  else names.push(a);
}

// ------------------------------------------------------------------ recipes
interface Recipe {
  shot: string;
  dir: string;
  file: string;
  command: string[];
  cwd: string;
  inputs: string[];
  fps: number;
  frames: number;
  size: [number, number];
  quality: number;
  manifest: Record<string, unknown>;
}

function readJson(file: string): any {
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  try { return JSON.parse(text); } catch (e) { return fail(`${rel(file)} is not valid JSON: ${(e as Error).message}`); }
}

function recipe(shot: string): Recipe {
  const dir = path.join(SHOTS, shot), file = path.join(dir, 'shot.json');
  if (!existsSync(file)) fail(`no recipe for ${shot}: write shots/${shot}/shot.json (bun scripts/shot.ts --help)`);
  const r = readJson(file);
  const where = `shots/${shot}/shot.json`;
  if (!r || typeof r !== 'object') fail(`${where}: not a JSON object`);
  if (!Array.isArray(r.command) || !r.command.length || !r.command.every((x: unknown) => typeof x === 'string'))
    fail(`${where}: "command" must be a list of strings, the program and its arguments (no shell)`);
  const fps = Number(r.fps);
  if (!(fps > 0)) fail(`${where}: "fps" must be a number above 0`);
  const frames = r.frames !== undefined ? Number(r.frames) : Math.round(Number(r.duration) * fps);
  if (!(Number.isInteger(frames) && frames > 0)) fail(`${where}: needs "frames" (a whole number above 0) or "duration" in seconds`);
  const size = r.size;
  if (!Array.isArray(size) || size.length !== 2 || !size.every((x: unknown) => Number.isInteger(x) && (x as number) >= 2))
    fail(`${where}: "size" must be [width, height] in whole pixels: the shot's size at the 1x scale, at its largest on screen`);
  const inputs = r.inputs === undefined ? ['**'] : r.inputs;
  if (!Array.isArray(inputs) || !inputs.length || !inputs.every((x: unknown) => typeof x === 'string' && x.trim()))
    fail(`${where}: "inputs" must be a list of paths or patterns (default: ["**"], the recipe folder)`);
  const quality = r.quality === undefined ? 2 : Number(r.quality);
  if (!(Number.isInteger(quality) && quality >= 2 && quality <= 31)) fail(`${where}: "quality" must be a whole number from 2 (best) to 31`);
  const cwd = resolveIn(dir, typeof r.cwd === 'string' ? r.cwd : '.');
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) fail(`${where}: "cwd" ${r.cwd} isn't a folder`);
  const manifest = r.manifest === undefined ? {} : r.manifest;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail(`${where}: "manifest" must be an object`);
  return { shot, dir, file, command: r.command, cwd, inputs, fps, frames, size: [size[0], size[1]], quality, manifest };
}

/** A recipe path: the recipe folder's, or the project root's when it starts with /. */
const resolveIn = (dir: string, p: string) => (p.startsWith('/') ? path.join(PROJECT, p.slice(1)) : path.resolve(dir, p));

/** The files a recipe's inputs name, the recipe included: sorted project paths. */
function inputFiles(r: Recipe): string[] {
  const out = new Set<string>([rel(r.file)]);
  for (const pattern of r.inputs) {
    const fromRoot = pattern.startsWith('/');
    const base = fromRoot ? PROJECT : r.dir;
    const pat = fromRoot ? pattern.slice(1) : pattern;
    let found = 0;
    if (!/[*?[{]/.test(pat)) {
      const f = path.resolve(base, pat);
      if (existsSync(f) && statSync(f).isFile()) { out.add(rel(f)); found++; }
      else if (existsSync(f) && statSync(f).isDirectory()) {
        for (const g of new Bun.Glob('**').scanSync({ cwd: f, onlyFiles: true, dot: false })) {
          const p = rel(path.join(f, g));
          if (!NEVER.test(p)) { out.add(p); found++; }
        }
      }
    } else {
      for (const g of new Bun.Glob(pat).scanSync({ cwd: base, onlyFiles: true, dot: false })) {
        const p = rel(path.resolve(base, g));
        if (p.startsWith('..')) continue;
        if (!NEVER.test(p)) { out.add(p); found++; }
      }
    }
    if (!found) fail(`shots/${r.shot}/shot.json: the input ${pattern} names no file${fromRoot ? '' : ` in shots/${r.shot}/`} (a path from the project root starts with /)`);
  }
  return [...out].sort();
}

const sha = (data: string | Uint8Array) => new Bun.CryptoHasher('sha256').update(data).digest('hex');

/** What a shot's frames are made from, hashed: the protocol, the command as written, the frames asked for, the inputs' bytes. */
function keyOf(r: Recipe, scale: number) {
  const files = inputFiles(r).map((f) => [f, sha(readFileSync(path.join(PROJECT, f)))] as [string, string]);
  const what = { protocol: PROTOCOL, command: r.command, cwd: rel(r.cwd), fps: r.fps, frames: r.frames, size: r.size, scale, quality: r.quality };
  return { key: sha(JSON.stringify({ ...what, files })), files, what };
}

// ------------------------------------------------------------------ the published shot
interface Made {
  'shot.ts': number;
  shot: string;
  key: string;
  dir: string;
  n: number;
  frames: number;
  fps: number;
  size: [number, number];
  scale: number;
  pixels: [number, number];
  hashes: string[];
  inputs: [string, string][];
  what: Record<string, unknown>;
  at: string;
  seconds: number;
}

const shotDir = (shot: string) => path.join(FOOTAGE, shot);
function made(shot: string): Made | null {
  const f = path.join(shotDir(shot), 'made.json');
  if (!existsSync(f)) return null;
  const m = readJson(f);
  return m && m['shot.ts'] ? (m as Made) : null;
}
function manifestOf(shot: string): Record<string, any> | null {
  const f = path.join(shotDir(shot), 'manifest.json');
  return existsSync(f) ? readJson(f) : null;
}
/** Whether the version a manifest names is all there: its full/ holds every frame. */
function published(shot: string, m: Made | null) {
  const man = manifestOf(shot);
  if (!m || !man || man.dir !== m.dir) return false;
  const full = path.join(shotDir(shot), m.dir, 'full');
  if (!existsSync(full)) return false;
  return readdirSync(full).filter((f) => /^\d{6}\.jpg$/.test(f)).length === m.frames;
}

type State =
  | { kind: 'current'; made: Made }
  | { kind: 'stale'; made: Made | null; why: string[] }
  | { kind: 'unmade' }
  | { kind: 'orphan'; made: Made }
  | { kind: 'foreign' };

function stateOf(shot: string, scale?: number): State {
  const hasRecipe = existsSync(path.join(SHOTS, shot, 'shot.json'));
  const m = made(shot);
  if (!hasRecipe) return m ? { kind: 'orphan', made: m } : { kind: 'foreign' };
  if (!m && manifestOf(shot)) return { kind: 'foreign' };
  if (!m) return { kind: 'unmade' };
  const r = recipe(shot);
  const k = keyOf(r, scale ?? m.scale);
  if (k.key === m.key && published(shot, m)) return { kind: 'current', made: m };
  return { kind: 'stale', made: m, why: whyStale(m, k, published(shot, m)) };
}

function whyStale(m: Made, k: ReturnType<typeof keyOf>, whole: boolean) {
  const why: string[] = [];
  if (!whole) why.push('its frames aren\'t all there');
  const was = new Map(m.inputs), now = new Map(k.files);
  for (const [f, h] of now) if (!was.has(f)) why.push(`${f} is new`); else if (was.get(f) !== h) why.push(`${f} changed`);
  for (const f of was.keys()) if (!now.has(f)) why.push(`${f} is gone`);
  for (const key of Object.keys(k.what) as (keyof typeof k.what)[])
    if (JSON.stringify(k.what[key]) !== JSON.stringify((m.what as any)?.[key])) why.push(`its ${key} changed`);
  return why.length ? why : ['its recipe changed'];
}

/** Every shot there is: a recipe in shots/, or a folder in footage/. */
function allShots() {
  const dirs = (p: string) => { try { return readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory() && NAME.test(d.name)).map((d) => d.name); } catch { return []; } };
  return [...new Set([...dirs(SHOTS).filter((s) => existsSync(path.join(SHOTS, s, 'shot.json'))), ...dirs(FOOTAGE)])].sort();
}

// ------------------------------------------------------------------ tools
async function run(cmd: string[], o: { cwd?: string; env?: Record<string, string>; quiet?: boolean } = {}) {
  let p;
  try {
    p = Bun.spawn(cmd, { cwd: o.cwd ?? PROJECT, env: { ...process.env, ...o.env }, stdout: o.quiet ? 'pipe' : 'inherit', stderr: o.quiet ? 'pipe' : 'inherit', stdin: 'ignore' });
  } catch (e) {
    return fail(`can't start ${cmd[0]}: ${(e as Error).message}`);
  }
  const [out, err] = o.quiet ? await Promise.all([new Response(p.stdout as ReadableStream).text(), new Response(p.stderr as ReadableStream).text()]) : ['', ''];
  const code = await p.exited;
  return { code, out, err };
}

function needTools() {
  for (const t of ['ffmpeg', 'ffprobe']) if (!Bun.which(t)) fail(`${t} isn't on the PATH (it comes with ffmpeg: https://ffmpeg.org/download.html)`);
}

/** Retries a rename that Windows refuses for a moment (a file open in the preview's server, an antivirus scan). */
function renameRetry(from: string, to: string) {
  for (let i = 0; ; i++) {
    try { renameSync(from, to); return; }
    catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i >= 20 || !['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '')) throw e;
      Bun.sleepSync(50 + i * 50);
    }
  }
}
function writeAtomic(file: string, text: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameRetry(tmp, file);
}

function lock(shot: string) {
  mkdirSync(CACHE, { recursive: true });
  const f = path.join(CACHE, `${shot}.lock`);
  for (let i = 0; i < 2; i++) {
    try {
      const fd = openSync(f, 'wx');
      writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      closeSync(fd);
      return () => { try { unlinkSync(f); } catch {} };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let pid = 0;
      try { pid = Number(JSON.parse(readFileSync(f, 'utf8')).pid); } catch {}
      let alive = false;
      try { if (pid) { process.kill(pid, 0); alive = true; } } catch {}
      if (alive) fail(`${shot} is being made by another run (process ${pid}); wait for it, or end it`);
      try { unlinkSync(f); } catch {}
    }
  }
  return fail(`can't take ${rel(f)}`);
}

/** The frames a program wrote into `out`, for frames first..last: their extension, and the other files there. */
function framesWritten(out: string, first: number, last: number) {
  const files = existsSync(out) ? readdirSync(out) : [];
  const frames = new Map<number, string>(), other: string[] = [];
  for (const f of files) {
    const m = FRAME.exec(f);
    if (m) frames.set(Number(m[1]), m[2]!.toLowerCase());
    else if (statSync(path.join(out, f)).isFile()) other.push(f);
  }
  const exts = new Set(frames.values());
  if (exts.size > 1) fail(`the program wrote frames of more than one kind (${[...exts].join(', ')}): one kind per shot`);
  const missing: number[] = [], extra: number[] = [];
  for (let k = first; k <= last; k++) if (!frames.has(k)) missing.push(k);
  for (const k of frames.keys()) if (k < first || k > last) extra.push(k);
  const show = (a: number[]) => a.slice(0, 5).map((k) => String(k).padStart(6, '0')).join(', ') + (a.length > 5 ? ` and ${a.length - 5} more` : '');
  if (!frames.size) fail(`the program wrote no frames into ${out} (it was asked for ${first}..${last} as 000001.png and so on; {out} is that folder)`);
  if (missing.length) fail(`the program didn't write frame${missing.length > 1 ? 's' : ''} ${show(missing)} (asked for ${first}..${last})`);
  if (extra.length) fail(`the program wrote frame${extra.length > 1 ? 's' : ''} ${show(extra)}, outside the ${first}..${last} it was asked for`);
  return { ext: [...exts][0]!, other };
}

/** Each frame's size and pixel format, as ffprobe decodes them. */
async function probeFrames(out: string, ext: string, first: number, count: number, fps: number) {
  const r = await run(['ffprobe', '-v', 'error', '-f', 'image2', '-framerate', String(fps), '-start_number', String(first), '-i', path.join(out, `%06d.${ext}`),
    '-show_entries', 'frame=width,height,pix_fmt', '-of', 'csv=p=0'], { quiet: true });
  if (r.code !== 0) fail(`ffprobe can't read the frames in ${out}: ${r.err.trim().split('\n').slice(-3).join(' ')}`);
  const rows = r.out.trim().split(/\r?\n/).filter(Boolean).map((l) => { const [w, h, f] = l.split(','); return { w: Number(w), h: Number(h), fmt: f ?? '' }; });
  if (rows.length !== count) fail(`ffprobe read ${rows.length} of the ${count} frames in ${out}: one can't be decoded`);
  return rows;
}

/** sha256 of each frame's decoded pixels (RGB, 8 bits), so metadata and encoders don't count, only the picture. */
async function pixelHashes(out: string, ext: string, first: number, count: number, w: number, h: number) {
  const p = Bun.spawn(['ffmpeg', '-v', 'error', '-f', 'image2', '-start_number', String(first), '-i', path.join(out, `%06d.${ext}`),
    '-frames:v', String(count), '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
  const size = w * h * 3, hashes: string[] = [];
  let hasher = new Bun.CryptoHasher('sha256'), filled = 0;
  for await (const chunk of p.stdout as ReadableStream<Uint8Array>) {
    let off = 0;
    while (off < chunk.length) {
      const take = Math.min(size - filled, chunk.length - off);
      hasher.update(chunk.subarray(off, off + take));
      filled += take; off += take;
      if (filled === size) { hashes.push(hasher.digest('hex')); hasher = new Bun.CryptoHasher('sha256'); filled = 0; }
    }
  }
  const err = await new Response(p.stderr as ReadableStream).text();
  if ((await p.exited) !== 0 || hashes.length !== count || filled) fail(`ffmpeg couldn't decode the frames in ${out}: ${err.trim().split('\n').slice(-3).join(' ') || `${hashes.length} of ${count}`}`);
  return hashes;
}

/** Runs the program for frames first..last at `scale` into a new folder; returns the folder, the frames' kind, the other files. */
async function render(r: Recipe, scale: number, first: number, last: number, out: string, tmp: string) {
  const [w, h] = [r.size[0] * scale, r.size[1] * scale];
  mkdirSync(out, { recursive: true });
  mkdirSync(tmp, { recursive: true });
  const vars: Record<string, string> = {
    out: path.resolve(out), first: String(first), last: String(last), frames: String(r.frames), fps: String(r.fps),
    width: String(w), height: String(h), scale: String(scale), tmp: path.resolve(tmp), shot: r.shot,
  };
  const cmd = r.command.map((a) => a.replace(/\{(out|first|last|frames|fps|width|height|scale|tmp|shot)\}/g, (_, k: string) => vars[k]!));
  const env = Object.fromEntries(Object.entries(vars).map(([k, v]) => [`AUDARA_SHOT_${k === 'shot' ? 'NAME' : k.toUpperCase()}`, v]));
  log(`  ${r.shot}: frames ${first}..${last} at ${w}x${h}: ${cmd.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
  const t0 = Date.now();
  const res = await run(cmd, { cwd: r.cwd, env });
  if (res.code !== 0) fail(`${r.shot}: the program exited with code ${res.code} (its output is above); the shot is as it was`);
  const { ext, other } = framesWritten(out, first, last);
  const rows = await probeFrames(out, ext, first, last - first + 1, r.fps);
  const wrong = rows.findIndex((x) => x.w !== w || x.h !== h);
  if (wrong >= 0) fail(`${r.shot}: frame ${String(first + wrong).padStart(6, '0')}.${ext} is ${rows[wrong]!.w}x${rows[wrong]!.h}, not the ${w}x${h} asked for ({width}x{height}: the recipe's size times the scale)`);
  const alpha = rows.some((x) => /rgba|bgra|argb|abgr|gbrap|yuva|^ya/.test(x.fmt));
  return { ext, other, alpha, seconds: (Date.now() - t0) / 1000 };
}

/** Engine support for a shot's versions (manifest "dir"): this project's src/engine/footage.ts. */
function engineCheck() {
  const f = path.join(PROJECT, 'src', 'engine', 'footage.ts');
  if (!existsSync(f)) fail('this project\'s engine has no streamed footage (src/engine/footage.ts): the code-video skill\'s references/contract.md, "Images and footage", says how to take it');
  if (!/\bm\.dir\b/.test(readFileSync(f, 'utf8')))
    fail('this project\'s src/engine/footage.ts reads no "dir" from a manifest, which a shot made by a program needs: copy the code-video skill\'s template src/engine/footage.ts over it (keep what the project changed in it on purpose), then make the shot');
}
/** Whether this project's preview reloads when a shot's manifest is written (its vite.config.ts, from 0.17.0). */
const reloads = () => {
  try { return readFileSync(path.join(PROJECT, 'vite.config.ts'), 'utf8').includes('SHOT_MANIFEST'); } catch { return false; }
};

// ------------------------------------------------------------------ the modes
async function make(shot: string, force: boolean, scaleOpt?: number) {
  const r = recipe(shot);
  const before = made(shot);
  if (!before && manifestOf(shot)) fail(`footage/${shot}/ holds footage this script didn't make (a capture, or cut footage): name the recipe's folder otherwise, or move that footage away`);
  const scale = scaleOpt ?? before?.scale ?? 1;
  const k = keyOf(r, scale);
  if (!force && before && before.key === k.key && published(shot, before)) {
    // (the recipe's own manifest fields changed alone: the frames stay, the manifest is written again)
    const want = manifestFor(r, before);
    if (JSON.stringify(manifestOf(shot)) !== JSON.stringify(want)) {
      writeAtomic(path.join(shotDir(shot), 'manifest.json'), JSON.stringify(want, null, 1) + '\n');
      log(`  ${shot}: current; its manifest written again for the recipe's own fields`);
    } else log(`  ${shot}: current (${before.dir}, ${before.frames} frames at ${before.pixels.join('x')}): nothing to make`);
    return;
  }
  const unlock = lock(shot);
  try {
    const n = (before?.n ?? 0) + 1, dir = `g${n}-${k.key.slice(0, 8)}`;
    const stage = path.join(CACHE, shot, dir);
    rmSync(stage, { recursive: true, force: true });
    const raw = path.join(stage, 'raw'), pub = path.join(stage, 'pub');
    try {
      const out = await render(r, scale, 1, r.frames, raw, path.join(stage, 'tmp'));
      if (out.alpha) log(`  ${shot}: the frames have an alpha channel, which a shot drops (it is opaque): a transparent layer goes in as images (references/contract.md, "Images and footage")`);
      const [w, h] = [r.size[0] * scale, r.size[1] * scale];
      const hashes = await pixelHashes(raw, out.ext, 1, r.frames, w, h);
      mkdirSync(path.join(pub, 'full'), { recursive: true });
      mkdirSync(path.join(pub, 'proxy'), { recursive: true });
      const input = ['-f', 'image2', '-framerate', String(r.fps), '-start_number', '1', '-i', path.join(raw, `%06d.${out.ext}`), '-frames:v', String(r.frames)];
      const pw = Math.max(2, Math.round(r.size[0] / 2)), ph = Math.max(2, Math.round(r.size[1] / 2));
      for (const [args, what] of [
        [[...input, '-pix_fmt', 'yuvj444p', '-q:v', String(r.quality), path.join(pub, 'full', '%06d.jpg')], 'full frames'],
        [[...input, '-vf', `scale=${pw}:${ph}:flags=lanczos`, '-q:v', '4', path.join(pub, 'proxy', '%06d.jpg')], 'proxies'],
      ] as [string[], string][]) {
        const e = await run(['ffmpeg', '-v', 'error', '-y', ...args], { quiet: true });
        if (e.code !== 0) fail(`${shot}: ffmpeg couldn't encode the ${what}: ${e.err.trim().split('\n').slice(-3).join(' ')}`);
      }
      const step = Math.max(1, Math.floor(r.frames / 12)), cols = Math.min(4, Math.ceil(r.frames / step)), rows = Math.ceil(Math.min(12, Math.ceil(r.frames / step)) / cols);
      await run(['ffmpeg', '-v', 'error', '-y', '-i', path.join(pub, 'full', '%06d.jpg'), '-vf', `select='not(mod(n,${step}))',scale=320:-2,tile=${cols}x${rows}`, '-frames:v', '1', '-q:v', '4', path.join(stage, 'contact.jpg')], { quiet: true });
      // (what the frames were made from, again: a file changed while the program ran would publish frames of another one)
      const again = keyOf(r, scale);
      if (again.key !== k.key) fail(`${shot}: its inputs changed while it was being made (${whyStale({ ...(before ?? {}), inputs: k.files, what: k.what } as Made, again, true).join('; ')}): nothing was published; make it again (a program writes its scratch files to {tmp}, never to its recipe folder)`);
      // publish: the frames' folder, then what describes them, then the manifest that names them
      const folder = shotDir(shot), dest = path.join(folder, dir);
      mkdirSync(folder, { recursive: true });
      rmSync(dest, { recursive: true, force: true });
      try { renameRetry(pub, dest); }
      catch {
        const part = path.join(folder, `${dir}.partial`);
        rmSync(part, { recursive: true, force: true });
        cpSync(pub, part, { recursive: true });
        renameRetry(part, dest);
      }
      for (const f of out.other) cpSync(path.join(raw, f), path.join(folder, f));
      if (existsSync(path.join(stage, 'contact.jpg'))) cpSync(path.join(stage, 'contact.jpg'), path.join(folder, 'contact.jpg'));
      const record: Made = {
        'shot.ts': PROTOCOL, shot, key: k.key, dir, n, frames: r.frames, fps: r.fps, size: r.size, scale, pixels: [w, h], hashes,
        inputs: k.files, what: k.what, at: new Date().toISOString(), seconds: Math.round(out.seconds * 10) / 10,
      };
      writeAtomic(path.join(folder, 'made.json'), JSON.stringify(record, null, 1) + '\n');
      writeAtomic(path.join(folder, 'manifest.json'), JSON.stringify(manifestFor(r, record), null, 1) + '\n');
      // (the version before stays, for a render that opened it before this one was published)
      const old = versions(shot).filter((v) => v !== dir && v !== before?.dir);
      for (const v of old) rmSync(path.join(folder, v), { recursive: true, force: true });
      log(`  ${shot}: made ${dir}: ${r.frames} frames at ${w}x${h} in ${record.seconds} s (footage/${shot}/, contact.jpg to look at)${out.other.length ? `; also ${out.other.join(', ')}` : ''}`);
      log(reloads() ? '  a running preview reloads at its moment' : '  reload the preview to see it (this project\'s vite.config.ts doesn\'t reload it on a new shot)');
    } finally {
      rmSync(stage, { recursive: true, force: true });
      try { if (!readdirSync(path.join(CACHE, shot)).length) rmSync(path.join(CACHE, shot), { recursive: true, force: true }); } catch {}
    }
  } finally { unlock(); }
}

/** The manifest the engine reads: the recipe's own fields, then what the frames are (their version's folder in "dir"). */
function manifestFor(r: Recipe, m: Made) {
  return {
    ...r.manifest, frames: m.frames, fps: m.fps, size: m.pixels, proxy: [Math.max(2, Math.round(m.size[0] / 2)), Math.max(2, Math.round(m.size[1] / 2))],
    dir: m.dir, made: 'scripts/shot.ts', recipe: `shots/${r.shot}/shot.json`,
  };
}

/** The folders of a shot's versions, oldest first. */
function versions(shot: string) {
  try {
    return readdirSync(shotDir(shot), { withFileTypes: true }).filter((d) => d.isDirectory() && VERSION.test(d.name)).map((d) => d.name)
      .sort((a, b) => Number(VERSION.exec(a)![1]) - Number(VERSION.exec(b)![1]));
  } catch { return []; }
}

async function check(shot: string, n: number) {
  const st = stateOf(shot);
  if (st.kind !== 'current') return fail(st.kind === 'stale' ? `${shot} is stale (${st.why.join('; ')}): make it first, then check it` : `${shot} has no frames made by this script to check: bun scripts/shot.ts make ${shot}`);
  const m = st.made, r = recipe(shot);
  const N = m.frames;
  // single frames spread over the shot, the last first, each in a run of its own, then two neighbours in one run started mid-shot
  const c = Math.max(1, Math.min(n, N)), singles = [...new Set(Array.from({ length: c }, (_, i) => (c <= 1 ? 1 : 1 + Math.round((i * (N - 1)) / (c - 1)))))].reverse();
  const pairAt = Math.max(1, Math.min(N - 1, Math.floor(N / 2) + 1));
  const calls: [number, number][] = [...singles.map((k) => [k, k] as [number, number]), ...(N > 1 ? [[pairAt, pairAt + 1] as [number, number]] : [])];
  const dir = path.join(CACHE, shot, `check-${Date.now()}`);
  const bad: string[] = [];
  const unlock = lock(shot);
  try {
    for (const [a, b] of calls) {
      const out = path.join(dir, `${a}-${b}`);
      const got = await render(r, m.scale, a, b, out, path.join(dir, 'tmp'));
      const hashes = await pixelHashes(out, got.ext, a, b - a + 1, m.pixels[0], m.pixels[1]);
      hashes.forEach((h, i) => { if (h !== m.hashes[a - 1 + i]) bad.push(`frame ${a + i} (from a run of ${a}..${b})`); });
    }
  } finally { unlock(); }
  if (bad.length) {
    log(`check ${shot}: ${bad.length} frame${bad.length > 1 ? 's' : ''} rendered again differ from the shot: ${bad.join(', ')}.`);
    log(`  A frame depends on more than its time: on what the program drew before it in the same run (state carried from frame to frame),`);
    log(`  on something that isn't an input (the clock, unseeded randomness, a file outside "inputs"), or on the GPU's rounding.`);
    log(`  The frames rendered again are in ${rel(dir)}/ to compare.`);
    process.exitCode = 1;
  } else {
    rmSync(dir, { recursive: true, force: true });
    try { if (!readdirSync(path.join(CACHE, shot)).length) rmSync(path.join(CACHE, shot), { recursive: true, force: true }); } catch {}
    log(`check ${shot}: ${calls.reduce((s, [a, b]) => s + b - a + 1, 0)} frames rendered again, alone and from the middle, match the shot pixel for pixel`);
  }
}

function status(shots: string[]) {
  if (!shots.length) { log('no shots: a shot made by a program has its recipe in shots/<shot>/shot.json (bun scripts/shot.ts --help)'); return; }
  for (const s of shots) {
    const st = stateOf(s);
    const at = (m: Made) => `${m.dir}, ${m.frames} frames at ${m.pixels.join('x')}${m.scale > 1 ? ` (scale ${m.scale})` : ''}, made ${m.at.replace('T', ' ').slice(0, 16)}`;
    if (st.kind === 'current') log(`${s}: current (${at(st.made)})`);
    else if (st.kind === 'stale') log(`${s}: stale: ${st.why.join('; ')}${st.made ? ` (playing ${at(st.made)})` : ''}`);
    else if (st.kind === 'unmade') log(`${s}: not made yet (bun scripts/shot.ts make ${s})`);
    else if (st.kind === 'orphan') log(`${s}: plays as made (${at(st.made)}); its recipe, shots/${s}/shot.json, isn't here, so it can't be made again here`);
    else log(`${s}: footage this script didn't make (a capture or cut footage): left as it is`);
  }
}

function clean(shot: string) {
  const m = made(shot);
  if (!m) { log(`  ${shot}: no versions made by this script`); return; }
  const unlock = lock(shot);
  try {
    const old = versions(shot).filter((v) => v !== m.dir);
    for (const v of old) rmSync(path.join(shotDir(shot), v), { recursive: true, force: true });
    log(`  ${shot}: ${old.length ? `removed ${old.join(', ')}` : 'only the current version is there'}`);
  } finally { unlock(); }
}

try {
  if (!MODES.includes(mode)) fail(`unknown mode ${mode}: ${MODES.join(', ')} (bun scripts/shot.ts --help)`);
  for (const s of names) if (!NAME.test(s)) fail(`${s}: a shot's name is a folder name (letters, digits, . _ -)`);
  const scale = opts.has('scale') ? Number(opts.get('scale')) : undefined;
  if (scale !== undefined && !(Number.isInteger(scale) && scale >= 1 && scale <= 4)) fail(`--scale ${opts.get('scale')}: a whole number from 1 to 4`);
  if (mode === 'status') status(names.length ? names : allShots());
  else if (mode === 'make') {
    needTools();
    const todo = names.length ? names : allShots().filter((s) => existsSync(path.join(SHOTS, s, 'shot.json')));
    if (!todo.length) fail('no recipes: a shot made by a program has its recipe in shots/<shot>/shot.json (bun scripts/shot.ts --help)');
    engineCheck();
    for (const s of todo) await make(s, opts.has('force'), scale);
  } else if (mode === 'check') {
    needTools();
    if (names.length !== 1) fail('check one shot: bun scripts/shot.ts check <shot>');
    const n = opts.has('n') ? Number(opts.get('n')) : 4;
    if (!(Number.isInteger(n) && n >= 1)) fail(`--n ${opts.get('n')}: a whole number from 1`);
    await check(names[0]!, n);
  } else {
    for (const s of names.length ? names : allShots()) clean(s);
  }
} catch (e) {
  if (e instanceof Fail) { console.error(`shot: ${e.message}`); process.exit(1); }
  throw e;
}
