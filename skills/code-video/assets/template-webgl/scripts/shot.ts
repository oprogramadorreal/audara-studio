#!/usr/bin/env bun
// Shots made by a program: a picture drawn outside the browser (a Python or NumPy renderer, ModernGL, a path
// tracer, Blender, Manim, a native GPU program, a composition another framework renders to frames) played by
// the engine as a streamed shot (src/engine/footage.ts), so the preview, its ?t= links, stills, sheets, verify,
// the render and the QC report work on it as on any scene.
//
//   status [<shot>...]                each shot: current, stale (and what changed), not made yet, or footage
//                                     this script didn't make (a capture, cut footage: left as it is)
//   make [<shot>...] [--force] [--scale N]
//                                     runs the program of each stale shot (all shots with a recipe, or those
//                                     named; --force: current ones too), checks its frames, encodes them and
//                                     publishes them; a running preview reloads at its moment. --scale N: N times
//                                     the recipe's size (a 4K master from a 1080p one); the scale a shot was last
//                                     made at stays until another is given
//   check <shot> [--n 4]              the f(t) rule for a program: renders --n frames again, each alone in a run
//                                     of its own, and two neighbours in one run started mid-shot, and compares
//                                     their pixels with the shot's (exit code 1 when one differs). It samples:
//                                     a frame it didn't render again can still be wrong
//   clean [<shot>...]                 removes every version this script made of a shot but the one its manifest
//                                     names, and a copy of one cut short (a folder without this script's record
//                                     in it is never removed)
//
// A shot's recipe is shots/<shot>/shot.json at the project root, beside the program's own files. Its paths are
// the recipe folder's; one that starts with / is the project root's:
//   { "command": ["uv", "run", "render.py", "--out", "{out}", "--first", "{first}", "--last", "{last}"],
//     "fps": 30, "frames": 240,       (or "duration": 8, in seconds)
//     "size": [1920, 1080],           the frames' size at the 1x scale: the size the shot fills at its largest
//     "inputs": ["**"],               what the frames are made from (default: every file of the recipe folder,
//                                     hidden ones too, a .env the program reads; never a tool's own folders,
//                                     node_modules, .venv, __pycache__, .git, nor what a system or an editor
//                                     leaves, .DS_Store, a swap file); a change to one, or to any field above,
//                                     makes the shot stale. [] when the command is all there is
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
//   {tmp}    AUDARA_SHOT_TMP     a scratch folder for this run alone (the recipe folder is an input: write
//                                nothing there)
//   {shot}   AUDARA_SHOT_NAME
// Frame k (from 1) is the picture at (k - 1) / fps seconds into the shot, written as <out>/<k in six digits>.<ext>
// (frames {first}..{last}: 000001.png and on for a whole shot, 000120.png for a run that starts at 120; png, jpg,
// bmp, tif, ppm or webp, one kind per shot), each at exactly width x height, opaque (an alpha channel is dropped:
// a transparent layer goes in as images, references/contract.md). Any other file the program writes there (an
// events.json, the camera per frame), in a folder of its own or not, is kept with the frames, in their version's
// folder, where a scene reads it from the Footage that plays them (`${clip.base}/camera.json`); manifest.json,
// made.json, contact.jpg, full and proxy are this script's names there, in any case of letters, and two names
// that differ only by case are refused (one file on Windows and macOS). A link to a file is kept as a copy of
// that file, and a link to a folder is refused: a version holds its own files. A frame must not depend on the frames
// written before it in the same run: check renders frames alone and compares. A program that must step from the
// start (a simulation) steps there by itself, in every run, to the same pixels. Its command must be free and
// offline: make runs it whenever the shot is stale, and check runs it again (a generated clip is cut from its
// file, which is the input).
//
// Published, under footage/<shot>/: a version folder, never written again once it is there, holding full/ (the
// frames, JPEG), proxy/ (half the 1x size, for the preview), made.json (what they were made from: the inputs'
// hashes, each frame's pixel hash, the scale), contact.jpg and the program's other files; then manifest.json,
// written last, naming that folder ("dir"): the engine reads it, and it alone says which version is current. The
// version before stays (a render that opened it before keeps reading it), older ones are removed. The frames are
// made under .audara-cache/shots/ first, in a folder of that run's own, so a failed run leaves the shot as it was
// and a run that was ended shares nothing with the next. Everything that reads or writes a shot's state runs under
// one lock per shot (.audara-cache/shots/<shot>.lock).
import { copyFileSync, cpSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync, openSync, closeSync, unlinkSync, type Dirent } from 'node:fs';
import path from 'node:path';

const PROJECT = path.resolve(import.meta.dir, '..');
const SHOTS = path.join(PROJECT, 'shots');
const FOOTAGE = path.join(PROJECT, 'footage');
const CACHE = path.join(PROJECT, '.audara-cache', 'shots');
/**
 * The protocol between this script, the program and the engine: a change of it makes every shot stale. 2: the
 * files a program writes in folders beside its frames are published (1 dropped them, so a version made by it can
 * lack files its program wrote).
 */
const PROTOCOL = 2;
/** What a manifest this script published says it is ("made"); the engine reads "dir" only from such a manifest. */
const MADE_BY = 'scripts/shot.ts';
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const FRAME = /^(\d{6})\.(png|jpe?g|bmp|tiff?|ppm|webp)$/i;
const VERSION = /^g(\d+)-[0-9a-f]{8}$/;
/** A make's scratch folder under .audara-cache/shots/<shot>/: the version's name, then a part that is one run's own. */
const STAGE = /^g\d+-[0-9a-f]{8}(\.[0-9a-z-]+)?$/;
/** A copy of a version on its way into footage/<shot>/ (publishing across volumes): <version>.partial, which nothing reads. */
const PARTIAL = '.partial';
/**
 * Names in a version folder that are this script's: a program that writes one of them is stopped. Compared without
 * their case: CONTACT.JPG is contact.jpg where the file system ignores it (Windows, macOS).
 */
const RESERVED = new Set(['manifest.json', 'made.json', 'contact.jpg', 'full', 'proxy']);
/**
 * Never inputs, wherever a pattern reaches: folders a program, a tool or this script write into, and what a system
 * or an editor leaves beside the files it shows (Finder's .DS_Store, vim's swap file: one appearing during an hour's
 * make would stop it as an input changed). Any other hidden file is an input like the rest: a .env the program reads.
 */
const NEVER = /(^|\/)(node_modules|__pycache__|\.git|\.venv|\.audara-cache|\.cache|\.[a-z]+_cache|\.ipynb_checkpoints|out|footage)(\/|$)|(^|\/)(\.DS_Store|\._[^/]*|Thumbs\.db|desktop\.ini|\.[^/]*\.sw[a-p]|\.#[^/]*)$|\.pyc$/;

class Fail extends Error {}
const fail = (msg: string): never => { throw new Fail(msg); };
const rel = (p: string) => path.relative(PROJECT, p).split(path.sep).join('/');
const log = (s = '') => console.log(s);
const tail = (s: string) => s.trim().split('\n').slice(-3).join(' ');

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

const hasRecipe = (shot: string) => existsSync(path.join(SHOTS, shot, 'shot.json'));

/** The recipe as it is on disk now. */
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
  if (!Array.isArray(inputs) || !inputs.every((x: unknown) => typeof x === 'string' && x.trim()))
    fail(`${where}: "inputs" must be a list of paths or patterns (default: ["**"], the recipe folder; [] when the command is all there is)`);
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

/** Every file under a folder, hidden ones too, as project paths; a folder that is never an input isn't entered. */
function filesUnder(dir: string, take: (p: string) => void) {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, d.name), p = rel(f);
    if (NEVER.test(p)) continue;
    // (a link to a file counts as the file; a link to a folder isn't followed, as a pattern doesn't follow one)
    if (d.isDirectory()) filesUnder(f, take);
    else if ((d.isSymbolicLink() ? statSync(f, { throwIfNoEntry: false }) : d)?.isFile()) take(p);
  }
}

/**
 * The files a recipe's inputs name: sorted project paths. The recipe itself counts by what it asks for (keyOf),
 * not by its bytes, so a field of its own for the manifest changes the manifest alone. Hidden files count: a
 * program reads its .env or its dot-named settings as it reads any file. A pattern has to name a file (one that
 * names none is a path mistyped, and a shot that never goes stale), where the recipe is one: a folder holding
 * the recipe alone, its program all in the command, has no input files and needs none.
 */
function inputFiles(r: Recipe): string[] {
  const out = new Set<string>(), recipeFile = rel(r.file);
  for (const pattern of r.inputs) {
    const fromRoot = pattern.startsWith('/');
    const base = fromRoot ? PROJECT : r.dir;
    const pat = fromRoot ? pattern.slice(1) : pattern;
    let found = 0;
    const take = (p: string) => {
      if (p === recipeFile) found++;
      else if (!p.startsWith('..') && !NEVER.test(p)) { out.add(p); found++; }
    };
    if (!/[*?[{]/.test(pat) || pat === '**') {
      // (a folder, the default included, is walked without entering a tool's folders)
      const f = pat === '**' ? base : path.resolve(base, pat);
      const st = statSync(f, { throwIfNoEntry: false });
      if (st?.isFile()) take(rel(f));
      else if (st?.isDirectory()) filesUnder(f, take);
    } else {
      // (any other pattern is Bun's to scan, so it selects what it always did: its levels, a leading !, ../ and
      // Windows' separators. The scan enters a tool's folders, whose files are turned down one by one: 100,000
      // of them took it 90 ms here, where a matcher of our own over the walk chose other files for `!*.ts`)
      for (const g of new Bun.Glob(pat).scanSync({ cwd: base, onlyFiles: true, dot: true })) take(rel(path.resolve(base, g)));
    }
    if (!found) fail(`shots/${r.shot}/shot.json: the input ${pattern} names no file${fromRoot ? '' : ` in shots/${r.shot}/ (a path from the project root starts with /)`}`);
  }
  return [...out].sort();
}

/** sha256 of a file, read a piece at a time (an input can be a long clip). */
async function hashFile(file: string) {
  const h = new Bun.CryptoHasher('sha256');
  for await (const chunk of Bun.file(file).stream()) h.update(chunk);
  return h.digest('hex');
}
const sha = (data: string | Uint8Array) => new Bun.CryptoHasher('sha256').update(data).digest('hex');

type Key = Awaited<ReturnType<typeof keyOf>>;
/** What a shot's frames are made from, hashed: the protocol, the command as written, the fields that change the frames, the inputs' bytes. */
async function keyOf(r: Recipe, scale: number) {
  const files: [string, string][] = [];
  for (const f of inputFiles(r)) files.push([f, await hashFile(path.join(PROJECT, f))]);
  const what = { protocol: PROTOCOL, command: r.command, cwd: rel(r.cwd), inputs: r.inputs, fps: r.fps, frames: r.frames, size: r.size, scale, quality: r.quality };
  return { key: sha(JSON.stringify({ ...what, files })), files, what };
}

// ------------------------------------------------------------------ the published shot
interface Made {
  'shot.ts': number;
  shot: string;
  key: string;
  dir: string;
  /** The version the manifest named when this one was published (kept for a render that opened it). */
  previous: string | null;
  frames: number;
  fps: number;
  size: [number, number];
  scale: number;
  pixels: [number, number];
  hashes: string[];
  inputs: [string, string][];
  what: Record<string, unknown>;
  other: string[];
  at: string;
  seconds: number;
}

const shotDir = (shot: string) => path.join(FOOTAGE, shot);
function manifestOf(shot: string): Record<string, any> | null {
  const f = path.join(shotDir(shot), 'manifest.json');
  return existsSync(f) ? readJson(f) : null;
}
/** Whether a manifest is one this script published. */
const ours = (m: Record<string, any> | null) => !!m && m.made === MADE_BY && typeof m.dir === 'string' && VERSION.test(m.dir);
/** The record of the version the manifest names: the manifest is what says which version is current. */
function made(shot: string): Made | null {
  const man = manifestOf(shot);
  if (!ours(man)) return null;
  const f = path.join(shotDir(shot), man!.dir, 'made.json');
  if (!existsSync(f)) return null;
  const m = readJson(f);
  return m && m['shot.ts'] && m.dir === man!.dir ? (m as Made) : null;
}
/** Whether a version's folder holds every frame, full and proxy, numbered 1..frames, and the program's other files it recorded. */
function complete(shot: string, m: Made) {
  for (const kind of ['full', 'proxy']) {
    const dir = path.join(shotDir(shot), m.dir, kind);
    let have: Set<string>;
    try { have = new Set(readdirSync(dir)); } catch { return false; }
    for (let k = 1; k <= m.frames; k++) if (!have.has(`${String(k).padStart(6, '0')}.jpg`)) return false;
  }
  return (m.other ?? []).every((f) => existsSync(path.join(shotDir(shot), m.dir, f)));
}

type State =
  | { kind: 'current'; made: Made }
  | { kind: 'stale'; made: Made | null; why: string[] }
  | { kind: 'unmade' }
  | { kind: 'orphan'; made: Made }
  | { kind: 'foreign' };

async function stateOf(shot: string, scale?: number): Promise<State> {
  const m = made(shot), man = manifestOf(shot);
  if (!hasRecipe(shot)) return m ? { kind: 'orphan', made: m } : { kind: 'foreign' };
  if (man && !ours(man)) return { kind: 'foreign' };
  if (!m) return man ? { kind: 'stale', made: null, why: [`its version's record (footage/${shot}/${man.dir}/made.json) isn't there`] } : { kind: 'unmade' };
  const k = await keyOf(recipe(shot), scale ?? m.scale);
  const whole = complete(shot, m);
  if (k.key === m.key && whole) return { kind: 'current', made: m };
  return { kind: 'stale', made: m, why: whyStale(m, k, whole) };
}

function whyStale(m: Pick<Made, 'inputs' | 'what'>, k: Key, whole: boolean) {
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
  return [...new Set([...dirs(SHOTS).filter(hasRecipe), ...dirs(FOOTAGE)])].sort();
}

/** The folders named like a shot's versions, oldest first (a name taken: a new version never uses it). */
function versions(shot: string) {
  try {
    return readdirSync(shotDir(shot), { withFileTypes: true }).filter((d) => d.isDirectory() && VERSION.test(d.name)).map((d) => d.name)
      .sort((a, b) => Number(VERSION.exec(a)![1]) - Number(VERSION.exec(b)![1]));
  } catch { return []; }
}
/** The copies of a version cut short on their way in (a make that died while publishing across volumes): <version>.partial. */
function partials(shot: string) {
  try {
    return readdirSync(shotDir(shot), { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.endsWith(PARTIAL) && VERSION.test(d.name.slice(0, -PARTIAL.length))).map((d) => d.name);
  } catch { return []; }
}
/**
 * Whether a folder is a version this script made for this shot, or a copy of one cut short: its own record says
 * so (a copy's record is copied first). Only those are ever removed.
 */
function madeHere(shot: string, folder: string) {
  try {
    const m = JSON.parse(readFileSync(path.join(shotDir(shot), folder, 'made.json'), 'utf8'));
    return !!m && m['shot.ts'] && m.shot === shot && m.dir === (folder.endsWith(PARTIAL) ? folder.slice(0, -PARTIAL.length) : folder);
  } catch { return false; }
}
/**
 * Removes a folder this script made, its record last: a removal stopped halfway by a file held open (Windows)
 * leaves a folder still known as this script's, so the next make or clean finishes it. Throws what stopped it.
 */
function removeOwned(dir: string) {
  for (const f of readdirSync(dir)) if (f !== 'made.json') rmSync(path.join(dir, f), { recursive: true, force: true, maxRetries: 3 });
  rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
}
/**
 * Removes the folders named, of the shot's, that this script made (by their record). One it can't remove (a file
 * open in another program, on Windows) stays, named, for the next make or clean.
 */
function drop(shot: string, folders: string[]) {
  const removed: string[] = [], left: string[] = [];
  for (const v of folders) {
    const dir = path.join(shotDir(shot), v);
    if (!madeHere(shot, v)) {
      // (a copy that died before its record was written is an empty folder: removed as one, which removes nothing else)
      if (v.endsWith(PARTIAL)) try { rmdirSync(dir); removed.push(v); } catch { /* it holds something: not this script's to remove */ }
      continue;
    }
    try { removeOwned(dir); removed.push(v); }
    catch (e) { left.push(`${v} (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`); }
  }
  return { removed, left };
}
/**
 * Removes the shot's copies cut short and nothing else (run under the shot's lock, so no make is still writing
 * one). It lists only those: it never reads which versions there are, so no failed read of the folder can put a
 * published version among what it removes.
 */
const reclaim = (shot: string) => drop(shot, partials(shot));
/**
 * Removes the versions this script made for the shot but those in `keep`, and its copies cut short: what's
 * published is published already. `keep` comes from the manifest, never from a listing of the folder.
 */
function prune(shot: string, keep: (string | null | undefined)[]) {
  const a = drop(shot, versions(shot).filter((v) => !keep.includes(v))), b = reclaim(shot);
  return { removed: [...a.removed, ...b.removed], left: [...a.left, ...b.left] };
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
  try { renameRetry(tmp, file); }
  catch (e) { try { unlinkSync(tmp); } catch {} throw e; }
}

/** Whether the process a lock names is running. */
function alive(pid: number) {
  if (!(pid > 0)) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}
/** A lock file's owner: its process and the token that run wrote, or what was unreadable about it. */
function lockOwner(f: string) {
  try {
    const age = Date.now() - statSync(f).mtimeMs;
    try { const j = JSON.parse(readFileSync(f, 'utf8')); return { pid: Number(j.pid) || 0, token: String(j.token ?? ''), age }; }
    catch { return { pid: 0, token: '', age }; }
  } catch { return null; }
}
/**
 * Creates a lock file with `body` in it, or answers false when one is there. It appears whole (a hard link to a
 * file already written), so another run never finds it empty; where the drive can't link, it is made empty and
 * filled at once, and an empty one younger than a minute counts as held (lockOwner's age).
 */
function createLock(f: string, body: string) {
  const tmp = `${f}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    writeFileSync(tmp, body);
    try { linkSync(tmp, f); return true; }
    catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') return false;
      try { const fd = openSync(f, 'wx'); writeFileSync(fd, body); closeSync(fd); return true; }
      catch (e2) { if ((e2 as NodeJS.ErrnoException).code === 'EEXIST') return false; throw e2; }
    }
  } finally { try { unlinkSync(tmp); } catch {} }
}
const held = (o: { pid: number; age: number } | null) => !!o && (alive(o.pid) || (!o.pid && o.age < 60_000));
/** Removes a lock file only while it is still the one `owner` describes (its token), so a successor's is never removed. */
function removeIfStill(f: string, token: string) {
  const o = lockOwner(f);
  if (o && o.token === token) try { unlinkSync(f); } catch {}
}
/**
 * Takes the shot's lock, or stops: one process at a time reads or writes a shot's state. A lock whose process has
 * ended is taken back under a second, short-held lock (<shot>.lock.reclaim), which re-reads it before removing it:
 * two runs that both find it abandoned can't both take it, and none removes a lock another run has just taken.
 * Released, a lock is removed only if it is still this run's.
 */
function lock(shot: string) {
  mkdirSync(CACHE, { recursive: true });
  const f = path.join(CACHE, `${shot}.lock`), reclaim = `${f}.reclaim`;
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const body = JSON.stringify({ pid: process.pid, token, at: new Date().toISOString() });
  for (let i = 0; i < 50; i++) {
    if (createLock(f, body)) return () => removeIfStill(f, token);
    const o = lockOwner(f);
    if (held(o)) fail(`${shot} is being made by another run${o!.pid ? ` (process ${o!.pid})` : ''}; wait for it, or end it`);
    if (!o) continue; // (released meanwhile: try again)
    const rtoken = `${token}-r`;
    if (createLock(reclaim, JSON.stringify({ pid: process.pid, token: rtoken, at: new Date().toISOString() }))) {
      try {
        const again = lockOwner(f);
        if (again && !held(again) && again.token === o.token) try { unlinkSync(f); } catch {}
      } finally { removeIfStill(reclaim, rtoken); }
    } else {
      // (another run is taking it back: wait for it; one that died doing so leaves a reclaim lock to take back too)
      const r = lockOwner(reclaim);
      if (r && !held(r) && r.age > 10_000) removeIfStill(reclaim, r.token);
      Bun.sleepSync(100);
    }
  }
  return fail(`can't take ${rel(f)}`);
}

/**
 * What an entry a program wrote is: a file or a folder. A link to a file counts as that file, and is published
 * as a file of the version's own (make copies what it leads to). A link to a folder, or to nothing, is refused:
 * a version holds its own files, and none of them may change or go once it is published, as a link's would with
 * what it leads to ({tmp}, gone with the run; an input, edited later).
 */
function entryKind(dir: string, d: Dirent, name: string): 'file' | 'folder' {
  if (d.isDirectory()) return 'folder';
  if (d.isFile()) return 'file';
  let s;
  try { s = statSync(path.join(dir, d.name)); }
  catch { return fail(`the program wrote ${name}, a link that leads nowhere: write the file itself`); }
  if (s.isFile()) return 'file';
  return fail(s.isDirectory()
    ? `the program wrote ${name}, a link to a folder: a version holds its own files, so write them there (a link to a file is published as that file)`
    : `the program wrote ${name}, which is neither a file nor a folder`);
}
/** Every file under the folder `dir`, as paths from it with / (a folder holding none gives none); `name` is the folder's own path, for what is said of an entry. */
function filesIn(dir: string, name: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    (entryKind(dir, d, `${name}/${d.name}`) === 'folder' ? filesIn(path.join(dir, d.name), `${name}/${d.name}`).map((g) => `${d.name}/${g}`) : [d.name]));
}

/**
 * The frames a program wrote into `out`, for frames first..last: their extension as written, and the other files
 * there, those in folders by their path from `out` (meta/camera.json).
 */
function framesWritten(out: string, first: number, last: number) {
  const files = existsSync(out) ? readdirSync(out, { withFileTypes: true }) : [];
  const frames = new Map<number, string>(), other: string[] = [];
  const pad = (k: number) => String(k).padStart(6, '0');
  for (const d of files) {
    const f = d.name, folder = entryKind(out, d, f) === 'folder';
    const m = folder ? null : FRAME.exec(f);
    if (m) {
      const k = Number(m[1]);
      if (frames.has(k)) fail(`the program wrote frame ${pad(k)} twice (${pad(k)}.${frames.get(k)} and ${f}): one file per frame`);
      frames.set(k, m[2]!);
      continue;
    }
    if (RESERVED.has(f.toLowerCase())) fail(`the program wrote ${f}, a name this script keeps for itself (${[...RESERVED].join(', ')}, in any case of letters): name it otherwise`);
    other.push(...(folder ? filesIn(path.join(out, f), f).map((g) => `${f}/${g}`) : [f]));
  }
  // (two names that differ only by case are one file on Windows and macOS: a version has to read the same on every machine)
  const names = new Map<string, string>();
  for (const f of other) {
    for (let at = f.indexOf('/'); ; at = f.indexOf('/', at + 1)) {
      const part = at < 0 ? f : f.slice(0, at), was = names.get(part.toLowerCase());
      if (was !== undefined && was !== part) fail(`the program wrote ${was} and ${part}, names that differ only by the case of their letters: one file where the file system ignores it (Windows, macOS); name one otherwise`);
      names.set(part.toLowerCase(), part);
      if (at < 0) break;
    }
  }
  other.sort();
  const exts = new Set(frames.values());
  if (exts.size > 1) fail(`the program wrote frames of more than one kind (${[...exts].join(', ')}): one kind per shot`);
  const missing: number[] = [], extra: number[] = [];
  for (let k = first; k <= last; k++) if (!frames.has(k)) missing.push(k);
  for (const k of frames.keys()) if (k < first || k > last) extra.push(k);
  const show = (a: number[]) => a.slice(0, 5).map(pad).join(', ') + (a.length > 5 ? ` and ${a.length - 5} more` : '');
  if (!frames.size) fail(`the program wrote no frames into ${out} (it was asked for ${first}..${last}, as ${pad(first)}.png and on; {out} is that folder)`);
  if (missing.length) fail(`the program didn't write frame${missing.length > 1 ? 's' : ''} ${show(missing)} (asked for ${first}..${last})`);
  if (extra.length) fail(`the program wrote frame${extra.length > 1 ? 's' : ''} ${show(extra)}, outside the ${first}..${last} it was asked for`);
  return { ext: [...exts][0]!, other };
}

/** Each frame's size and pixel format, as ffprobe decodes them. */
async function probeFrames(out: string, ext: string, first: number, count: number, fps: number) {
  const r = await run(['ffprobe', '-v', 'error', '-f', 'image2', '-framerate', String(fps), '-start_number', String(first), '-i', path.join(out, `%06d.${ext}`),
    '-show_entries', 'frame=width,height,pix_fmt', '-of', 'csv=p=0'], { quiet: true });
  if (r.code !== 0) fail(`ffprobe can't read the frames in ${out}: ${tail(r.err)}`);
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
  const err = new Response(p.stderr as ReadableStream).text();
  for await (const chunk of p.stdout as ReadableStream<Uint8Array>) {
    let off = 0;
    while (off < chunk.length) {
      const take = Math.min(size - filled, chunk.length - off);
      hasher.update(chunk.subarray(off, off + take));
      filled += take; off += take;
      if (filled === size) { hashes.push(hasher.digest('hex')); hasher = new Bun.CryptoHasher('sha256'); filled = 0; }
    }
  }
  if ((await p.exited) !== 0 || hashes.length !== count || filled) fail(`ffmpeg couldn't decode the frames in ${out}: ${tail(await err) || `${hashes.length} of ${count}`}`);
  return hashes;
}

/** Runs the program for frames first..last at `scale` into `out`, its scratch in `tmp`; checks what it wrote. */
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
  if (!readFileSync(f, 'utf8').includes(`'${MADE_BY}'`))
    fail('this project\'s src/engine/footage.ts reads no "dir" from a manifest, which a shot made by a program needs: copy the code-video skill\'s template src/engine/footage.ts over it (keep what the project changed in it on purpose), then make the shot');
}
/** Whether this project's preview reloads when a shot's manifest is written (its vite.config.ts, from 0.17.0). */
/**
 * Whether this project's render.ts compares the shots' manifests before a --jobs render joins its pieces (from
 * 0.17.0): an older one, kept by a project that took this script and footage.ts alone, joins pieces that show two
 * versions of a shot made again meanwhile. A project without a render.ts renders nothing to warn about.
 */
const guards = () => {
  try { return readFileSync(path.join(PROJECT, 'scripts', 'render.ts'), 'utf8').includes('shotManifests'); } catch { return true; }
};
const reloads = () => {
  try { return readFileSync(path.join(PROJECT, 'vite.config.ts'), 'utf8').includes('SHOT_MANIFEST'); } catch { return false; }
};
const proxySize = (size: [number, number]): [number, number] => [Math.max(2, Math.round(size[0] / 2)), Math.max(2, Math.round(size[1] / 2))];
/** The manifest the engine reads: the recipe's own fields, then what the frames are (their version's folder in "dir"). */
function manifestFor(r: Recipe, m: Made) {
  return { ...r.manifest, frames: m.frames, fps: m.fps, size: m.pixels, proxy: proxySize(m.size), dir: m.dir, made: MADE_BY, recipe: `shots/${r.shot}/shot.json` };
}
/**
 * The scale a shot is at when its version's record is gone: read from the size the manifest gives against the
 * recipe's, when that is a whole multiple; otherwise make stops and asks for --scale rather than replace a bigger
 * master with a smaller one.
 */
function scaleOf(shot: string, man: Record<string, any> | null, r: Recipe) {
  if (!ours(man)) return 1;
  const [w, h] = Array.isArray(man!.size) ? man!.size.map(Number) : [NaN, NaN];
  const s = w / r.size[0];
  if (Number.isInteger(s) && s >= 1 && s <= 4 && h === r.size[1] * s) return s;
  return fail(`${shot}: its version's record is gone and its manifest's size (${man!.size}) isn't a whole multiple of the recipe's ${r.size.join('x')}: give --scale to make it again`);
}
const tidy = (shot: string) => { try { if (!readdirSync(path.join(CACHE, shot)).length) rmSync(path.join(CACHE, shot), { recursive: true, force: true }); } catch {} };
/**
 * Removes a scratch folder under .audara-cache/shots/ once its run is over. One that can't be removed (a file of
 * it open in another program, on Windows) is said and left: what the run did, a publish included, stands, and an
 * error here would report a make that published as one that failed.
 */
function discard(dir: string) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); }
  catch (e) { log(`  ${rel(dir)}/ couldn't be removed (${(e as NodeJS.ErrnoException).code ?? (e as Error).message}: open in another program?): scratch, free to delete`); }
}
/**
 * Removes the scratch folders that makes of this shot left behind: run under the shot's lock, so each one there
 * is a run's that ended before it could (ended by hand, a machine that went down). One still held, by that run's
 * program if it runs on, is said and left for the next make. A check's folder, kept for its frames to be compared,
 * is not a make's and stays.
 */
function sweep(shot: string) {
  let left: string[] = [];
  try { left = readdirSync(path.join(CACHE, shot)).filter((d) => STAGE.test(d)); } catch { return; }
  for (const d of left) discard(path.join(CACHE, shot, d));
  tidy(shot);
}

// ------------------------------------------------------------------ the modes
async function make(shot: string, force: boolean, scaleOpt?: number) {
  const unlock = lock(shot);
  try {
    const r = recipe(shot);
    const man = manifestOf(shot);
    if (man && !ours(man)) fail(`footage/${shot}/ holds footage this script didn't make (a capture, or cut footage): name the recipe's folder otherwise, or move that footage away`);
    // (copies a run before left cut short go first, whatever this make turns out to do: one can hold the space the
    // new version needs, and a shot that is current would otherwise keep it)
    const dead = reclaim(shot);
    if (dead.removed.length || dead.left.length)
      log(`  ${shot}: ${dead.removed.length ? `removed ${dead.removed.join(', ')}, the copy a run before left cut short` : ''}${dead.removed.length && dead.left.length ? '; ' : ''}${dead.left.length ? `${dead.left.join(', ')} couldn't be removed yet (open in another program?)` : ''}`);
    sweep(shot);
    const before = made(shot);
    // (the version on screen is the one the manifest names, its record there or not)
    const current: string | null = ours(man) ? man!.dir : null;
    const scale = scaleOpt ?? before?.scale ?? scaleOf(shot, man, r);
    const k = await keyOf(r, scale);
    if (!force && before && before.key === k.key && complete(shot, before)) {
      // (the recipe's own manifest fields changed alone: the frames stay, the manifest is written again)
      const want = manifestFor(r, before);
      if (JSON.stringify(man) !== JSON.stringify(want)) {
        writeAtomic(path.join(shotDir(shot), 'manifest.json'), JSON.stringify(want, null, 1) + '\n');
        log(`  ${shot}: current; its manifest written again for the recipe's own fields`);
      } else log(`  ${shot}: current (${before.dir}, ${before.frames} frames at ${before.pixels.join('x')}): nothing to make`);
      return;
    }
    // (a version's number is never used twice: past the highest folder there, or a run that died midway)
    const taken = versions(shot).map((v) => Number(VERSION.exec(v)![1]));
    let n = Math.max(0, ...taken) + 1, dir = `g${n}-${k.key.slice(0, 8)}`;
    while (existsSync(path.join(shotDir(shot), dir)) || existsSync(path.join(shotDir(shot), `${dir}${PARTIAL}`))) dir = `g${++n}-${k.key.slice(0, 8)}`;
    // (a scratch folder no other run was ever given: the program of a make that was ended may still be running,
    // and writing its frames into the folder that make gave it)
    const stage = path.join(CACHE, shot, `${dir}.${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
    const raw = path.join(stage, 'raw'), pub = path.join(stage, 'pub');
    try {
      const out = await render(r, scale, 1, r.frames, raw, path.join(stage, 'tmp'));
      if (out.alpha) log(`  ${shot}: the frames have an alpha channel, which a shot drops (it is opaque): a transparent layer goes in as images (references/contract.md, "Images and footage")`);
      const [w, h] = [r.size[0] * scale, r.size[1] * scale];
      const hashes = await pixelHashes(raw, out.ext, 1, r.frames, w, h);
      mkdirSync(path.join(pub, 'full'), { recursive: true });
      mkdirSync(path.join(pub, 'proxy'), { recursive: true });
      const input = ['-f', 'image2', '-framerate', String(r.fps), '-start_number', '1', '-i', path.join(raw, `%06d.${out.ext}`), '-frames:v', String(r.frames)];
      const [pw, ph] = proxySize(r.size);
      for (const [args, what] of [
        [[...input, '-pix_fmt', 'yuvj444p', '-q:v', String(r.quality), path.join(pub, 'full', '%06d.jpg')], 'full frames'],
        [[...input, '-vf', `scale=${pw}:${ph}:flags=lanczos`, '-q:v', '4', path.join(pub, 'proxy', '%06d.jpg')], 'proxies'],
      ] as [string[], string][]) {
        const e = await run(['ffmpeg', '-v', 'error', '-y', ...args], { quiet: true });
        if (e.code !== 0) fail(`${shot}: ffmpeg couldn't encode the ${what}: ${tail(e.err)}`);
      }
      const step = Math.max(1, Math.floor(r.frames / 12)), shown = Math.min(12, Math.ceil(r.frames / step)), cols = Math.min(4, shown), rows = Math.ceil(shown / cols);
      const c = await run(['ffmpeg', '-v', 'error', '-y', '-i', path.join(pub, 'full', '%06d.jpg'), '-vf', `select='not(mod(n,${step}))',scale=320:-2,tile=${cols}x${rows}`, '-frames:v', '1', '-q:v', '4', path.join(pub, 'contact.jpg')], { quiet: true });
      if (c.code !== 0) { rmSync(path.join(pub, 'contact.jpg'), { force: true }); log(`  ${shot}: no contact sheet (ffmpeg: ${tail(c.err)})`); }
      for (const f of out.other) {
        const from = path.join(raw, f);
        mkdirSync(path.dirname(path.join(pub, f)), { recursive: true });
        // (a link is published as the file it leads to, found first: a copy of the link itself would be a link)
        copyFileSync(lstatSync(from).isSymbolicLink() ? realpathSync(from) : from, path.join(pub, f));
      }
      // (the recipe and the inputs again, read afresh: a change while the program ran would publish frames of another one)
      const now = recipe(shot), again = await keyOf(now, scale);
      if (again.key !== k.key) fail(`${shot}: its recipe or inputs changed while it was being made (${whyStale({ inputs: k.files, what: k.what }, again, true).join('; ')}): nothing was published; make it again (a program writes its scratch files to {tmp}, never to its recipe folder)`);
      const record: Made = {
        'shot.ts': PROTOCOL, shot, key: k.key, dir, previous: current, frames: r.frames, fps: r.fps, size: r.size, scale, pixels: [w, h], hashes,
        inputs: k.files, what: k.what, other: out.other, at: new Date().toISOString(), seconds: Math.round(out.seconds * 10) / 10,
      };
      writeFileSync(path.join(pub, 'made.json'), JSON.stringify(record, null, 1) + '\n');
      // publish: the version's folder whole, under a name nothing has used, then the manifest that names it
      const folder = shotDir(shot), dest = path.join(folder, dir);
      mkdirSync(folder, { recursive: true });
      try { renameRetry(pub, dest); }
      catch {
        // (another volume, or a folder that won't move: copied in under a name nothing reads, then renamed. Its
        // record goes in first, so a copy cut short is known as this script's; one that fails here, a full disk
        // or a rename refused, is removed here, or it would keep the space its own retry needs. Only a folder
        // this run made is removed: one that appeared under the name while the program ran is somebody else's.
        // Its record goes last, as in any removal, so one stopped halfway is finished by the next make or clean)
        const part = path.join(folder, `${dir}${PARTIAL}`);
        let created = false;
        try {
          mkdirSync(part);
          created = true;
          cpSync(path.join(pub, 'made.json'), path.join(part, 'made.json'));
          cpSync(pub, part, { recursive: true });
          renameRetry(part, dest);
        } catch (e) {
          let kept = '';
          if (created) try { removeOwned(part); } catch { kept = `; footage/${shot}/${dir}${PARTIAL}/ couldn't be removed: the next make or clean removes it`; }
          fail(`${shot}: its new version couldn't be put in footage/${shot}/ (${(e as Error).message}); the shot is as it was${kept}`);
        }
      }
      try { writeAtomic(path.join(folder, 'manifest.json'), JSON.stringify(manifestFor(now, record), null, 1) + '\n'); }
      catch (e) {
        rmSync(dest, { recursive: true, force: true });
        fail(`${shot}: footage/${shot}/manifest.json couldn't be replaced (${(e as Error).message}: open in another program?); the shot is as it was`);
      }
      log(`  ${shot}: made ${dir}: ${r.frames} frames at ${w}x${h} in ${record.seconds} s (footage/${shot}/${dir}/, contact.jpg there to look at)${out.other.length ? `; with ${out.other.join(', ')}` : ''}`);
      // (the version before stays, for a render that opened it before this one was published; older ones go)
      const pruned = prune(shot, [dir, current]);
      if (pruned.left.length) log(`  ${shot}: published; ${pruned.left.join(', ')} couldn't be removed yet (open in another program?): the next make or clean removes it`);
      log(reloads() ? '  a running preview reloads at its moment' : '  reload the preview to see it (this project\'s vite.config.ts doesn\'t reload it on a new shot)');
    } finally {
      discard(stage);
      tidy(shot);
    }
  } finally { unlock(); }
}

async function check(shot: string, n: number) {
  const unlock = lock(shot);
  const dir = path.join(CACHE, shot, `check-${Date.now()}`);
  const bad: string[] = [];
  let count = 0;
  try {
    const st = await stateOf(shot);
    if (st.kind !== 'current') return fail(st.kind === 'stale' ? `${shot} is stale (${st.why.join('; ')}): make it first, then check it` : `${shot} has no frames made by this script to check: bun scripts/shot.ts make ${shot}`);
    const m = st.made, r = recipe(shot), N = m.frames;
    // single frames spread over the shot, the last first, each in a run of its own, then two neighbours in one run started mid-shot
    const c = Math.max(1, Math.min(n, N));
    const singles = [...new Set(Array.from({ length: c }, (_, i) => (c <= 1 ? 1 : 1 + Math.round((i * (N - 1)) / (c - 1)))))].reverse();
    const pairAt = Math.max(1, Math.min(N - 1, Math.floor(N / 2) + 1));
    const calls: [number, number][] = [...singles.map((k) => [k, k] as [number, number]), ...(N > 1 ? [[pairAt, pairAt + 1] as [number, number]] : [])];
    for (const [a, b] of calls) {
      const out = path.join(dir, `${a}-${b}`);
      const got = await render(r, m.scale, a, b, out, path.join(dir, `tmp-${a}-${b}`));
      const hashes = await pixelHashes(out, got.ext, a, b - a + 1, m.pixels[0], m.pixels[1]);
      hashes.forEach((h, i) => { if (h !== m.hashes[a - 1 + i]) bad.push(`frame ${a + i} (from a run of ${a}..${b})`); });
      count += b - a + 1;
    }
  } finally { unlock(); }
  if (bad.length) {
    log(`check ${shot}: ${bad.length} of the ${count} frames rendered again differ from the shot: ${bad.join(', ')}.`);
    log(`  A frame depends on more than its time: on what the program drew before it in the same run (state carried from frame to frame),`);
    log(`  on something that isn't an input (the clock, unseeded randomness, a file outside "inputs"), or on the GPU's rounding.`);
    log(`  The frames rendered again are in ${rel(dir)}/ to compare.`);
    process.exitCode = 1;
  } else {
    discard(dir);
    tidy(shot);
    log(`check ${shot}: the ${count} frames rendered again, alone and from the middle, agree with the shot pixel for pixel (a sample: a frame not rendered again isn't checked)`);
  }
}

async function status(shots: string[]) {
  if (!shots.length) { log('no shots: a shot made by a program has its recipe in shots/<shot>/shot.json (bun scripts/shot.ts --help)'); return; }
  for (const s of shots) {
    const st = await stateOf(s);
    const at = (m: Made) => `${m.dir}, ${m.frames} frames at ${m.pixels.join('x')}${m.scale > 1 ? ` (scale ${m.scale})` : ''}, made ${m.at.replace('T', ' ').slice(0, 16)}`;
    if (st.kind === 'current') log(`${s}: current (${at(st.made)})`);
    else if (st.kind === 'stale') log(`${s}: stale: ${st.why.join('; ')}${st.made ? ` (playing ${at(st.made)})` : ''}`);
    else if (st.kind === 'unmade') log(`${s}: not made yet (bun scripts/shot.ts make ${s})`);
    else if (st.kind === 'orphan') log(`${s}: plays as made (${at(st.made)}); its recipe, shots/${s}/shot.json, isn't here, so it can't be made again here`);
    else log(`${s}: footage this script didn't make (a capture or cut footage): left as it is`);
  }
}

function clean(shot: string) {
  const unlock = lock(shot);
  try {
    const man = manifestOf(shot);
    // (footage with a manifest that isn't this script's is left as it is. With no manifest yet, nothing says
    // which version is current: every version stays, and only copies cut short go, a first make's that died)
    if (man && !ours(man)) { log(`  ${shot}: no versions made by this script`); return; }
    const { removed, left } = man ? prune(shot, [man.dir]) : reclaim(shot);
    if (!man && !removed.length && !left.length) { log(`  ${shot}: no versions made by this script`); return; }
    log(`  ${shot}: ${removed.length ? `removed ${removed.join(', ')}` : 'no other version of its own to remove'}${left.length ? `; couldn't remove ${left.join(', ')} (open in another program?)` : ''}`);
    if (left.length) process.exitCode = 1;
  } finally { unlock(); }
}

try {
  if (!MODES.includes(mode)) fail(`unknown mode ${mode}: ${MODES.join(', ')} (bun scripts/shot.ts --help)`);
  for (const s of names) if (!NAME.test(s)) fail(`${s}: a shot's name is a folder name (letters, digits, . _ -)`);
  const scale = opts.has('scale') ? Number(opts.get('scale')) : undefined;
  if (scale !== undefined && !(Number.isInteger(scale) && scale >= 1 && scale <= 4)) fail(`--scale ${opts.get('scale')}: a whole number from 1 to 4`);
  if (mode === 'status') await status(names.length ? names : allShots());
  else if (mode === 'make') {
    needTools();
    const todo = names.length ? names : allShots().filter(hasRecipe);
    if (!todo.length) fail('no recipes: a shot made by a program has its recipe in shots/<shot>/shot.json (bun scripts/shot.ts --help)');
    engineCheck();
    for (const s of todo) await make(s, opts.has('force'), scale);
    if (!guards()) log("this project's scripts/render.ts is older than this script: a `video --jobs` render doesn't stop when a shot is made again while it runs, so make no shot during one (the code-video skill's scripts/init.ts --force updates render.ts, keeping the old one as render.ts.orig)");
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
