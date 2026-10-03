#!/usr/bin/env bun
// audara init: makes a folder a video project, or adds a video to one.
//
//   bun <skill>/scripts/init.ts [projectDir=.] [--video <video>] [--no-install] [--force]
//
//   projectDir      the project folder (created if missing); default: the current folder
//   --video <video> also scaffold videos/<video>/: video.json (silent, a placeholder duration; or, when the
//                   sound came first, playing the audio its data/audio.json describes: a song's window, or the
//                   song), a timeline.ts with the cut helpers and no entries, empty scenes/ audio/ data/.
//                   TREATMENT.md is yours to write. (--video example brings the example back into a project
//                   that removed it.)
//   --no-install    skip `bun install`
//   --force         replace project files that differ from the template's, keeping each old one beside it as
//                   <file>.orig. Never replaced: src/engine/, src/look.ts and docs/ENGINE.md (the project's own
//                   engine, look and guide: move one away to take the template's), what you wrote in
//                   AGENTS.md, CLAUDE.md and .gitignore, and every video but example.
//
// Steps: check the prerequisites (bun, Chrome, ffmpeg with libx264, uv, git) and say how to install what's
// missing; copy the template (../assets/template-webgl) without overwriting anything; generate the
// example's demo track and timing data (./demo-track.ts); scaffold --video; write docs/ENGINE.md (from
// ../references/engine-guide-template.md), the section of AGENTS.md between <!-- audara:begin --> and
// <!-- audara:end -->, CLAUDE.md (@AGENTS.md) and the missing .gitignore entries; run bun install.
// Running it again changes nothing but that AGENTS.md section, which lists the project's videos: run it
// again whenever a video is added. Exit code 1 when a step failed; the message says how to fix it.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeDemoTrack } from './demo-track.ts';

if (typeof Bun === 'undefined') {
  console.error('init runs on bun: bun <skill>/scripts/init.ts. Install bun (https://bun.sh): Windows: powershell -c "irm bun.sh/install.ps1 | iex"; macOS and Linux: curl -fsSL https://bun.sh/install | bash. Then open a new terminal.');
  process.exit(1);
}

// Everything is found from this script's own folder, so the skill works wherever it is installed.
const SKILL = path.resolve(import.meta.dir, '..');
const TEMPLATE = path.join(SKILL, 'assets', 'template-webgl');
const GUIDE = path.join(SKILL, 'references', 'engine-guide-template.md');
const BEGIN = '<!-- audara:begin -->', END = '<!-- audara:end -->';
const OS = process.platform === 'win32' || process.platform === 'darwin' ? process.platform : 'linux';
const USAGE = 'usage: bun <skill>/scripts/init.ts [projectDir=.] [--video <video>] [--no-install] [--force]';

/** Stop with a message that says what to do. */
function fail(msg: string): never {
  console.error(`\ninit: ${msg}`);
  process.exit(1);
}
/** Failed steps: reported as they happen, and they make the exit code 1. */
const problems: string[] = [];
const problem = (msg: string) => { problems.push(msg); console.log(`  ! ${msg}`); };
const log = (s = '') => console.log(s);
/** A project file's text, without the byte-order mark Windows PowerShell 5.1 writes at the start of UTF-8 files. */
const readText = (file: string) => readFileSync(file, 'utf8').replace(/^\uFEFF/, '');

// ------------------------------------------------------------------ arguments
const args = process.argv.slice(2);
let dirArg: string | undefined;
const newVideos: string[] = [];
let install = true, force = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === '--video' || a.startsWith('--video=')) {
    const v = a === '--video' ? args[++i] : a.slice('--video='.length);
    if (!v || v.startsWith('-')) fail(`--video needs a name, e.g. --video promo\n${USAGE}`);
    // (the folder videos/<video>/ and the preview's ?v=<video>: lowercase, so it means the same on every file system)
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(v) || /^(con|prn|aux|nul|com\d|lpt\d)$/.test(v))
      fail(`--video ${v}: use lowercase letters, digits, - and _ (e.g. promo, launch-30s); it names the folder videos/<video>/ and the preview's ?v=<video>`);
    newVideos.push(v);
  } else if (a === '--no-install') install = false;
  else if (a === '--force') force = true;
  else if (a === '-h' || a === '--help') {
    // (the header comment above is the help)
    const head = readFileSync(import.meta.path, 'utf8').split(/\r?\n/).slice(1);
    log(head.slice(0, head.findIndex((l) => !l.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(0);
  } else if (a.startsWith('-')) fail(`unknown option ${a}\n${USAGE}`);
  else if (dirArg === undefined) dirArg = a;
  else fail(`give one project folder (got "${dirArg}" and "${a}")\n${USAGE}`);
}
const P = path.resolve(dirArg ?? '.');

// ------------------------------------------------------------------ prerequisites
interface Check { tool: string; status: 'ok' | 'MISSING' | 'WARNING'; need: string; found: string; fix?: string }

/** How to install each tool on this OS (Windows: winget or Chocolatey; macOS: Homebrew; Linux: apt). */
const INSTALL: Record<'chrome' | 'ffmpeg' | 'uv' | 'git', Record<typeof OS, string>> = {
  chrome: {
    win32: 'winget install Google.Chrome  (or: choco install googlechrome)',
    darwin: 'brew install --cask google-chrome',
    linux: 'download the .deb from https://www.google.com/chrome/, then sudo apt install ./google-chrome-stable_current_amd64.deb',
  },
  ffmpeg: { win32: 'winget install Gyan.FFmpeg  (or: choco install ffmpeg)', darwin: 'brew install ffmpeg', linux: 'sudo apt install ffmpeg' },
  uv: {
    win32: 'winget install astral-sh.uv  (or: powershell -c "irm https://astral.sh/uv/install.ps1 | iex")',
    darwin: 'brew install uv',
    linux: 'curl -LsSf https://astral.sh/uv/install.sh | sh',
  },
  git: { win32: 'winget install Git.Git  (or: choco install git)', darwin: 'brew install git  (or: xcode-select --install)', linux: 'sudo apt install git' },
};
const ON_PATH = ', then open a new terminal so it is on PATH';

/** Run a tool and return its exit code and output (stdout + stderr); never throws. */
function run(cmd: string[]): { code: number; out: string } {
  try {
    const r = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe', timeout: 20_000 });
    return { code: r.exitCode ?? -1, out: `${r.stdout?.toString() ?? ''}${r.stderr?.toString() ?? ''}` };
  } catch (e) {
    return { code: -1, out: String(e) };
  }
}

/** Google Chrome where scripts/render.ts finds it: CHROME_PATH, else where Playwright's "chrome" channel looks. */
function checkChrome(): Check {
  const c = { tool: 'Chrome', need: 'stills, sheets, verify, videos (render.ts)' };
  const env = process.env.CHROME_PATH;
  if (env) {
    return existsSync(env)
      ? { ...c, status: 'ok', found: `${env} (CHROME_PATH)` }
      : { ...c, status: 'MISSING', found: `CHROME_PATH=${env} does not exist`, fix: 'point CHROME_PATH at a Chrome or Chromium executable, or unset it to use the installed Google Chrome' };
  }
  const e = process.env;
  const places = OS === 'win32'
    ? [e.LOCALAPPDATA, e.PROGRAMFILES, e['PROGRAMFILES(X86)'], e.HOMEDRIVE && `${e.HOMEDRIVE}\\Program Files`, e.HOMEDRIVE && `${e.HOMEDRIVE}\\Program Files (x86)`]
      .filter((p): p is string => !!p).map((p) => path.join(p, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    : OS === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] : ['/opt/google/chrome/chrome'];
  const hit = places.find((p) => existsSync(p));
  if (hit) return { ...c, status: 'ok', found: hit };
  // a Chrome or Chromium somewhere else works too, through CHROME_PATH
  const other = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome'].map((x) => Bun.which(x)).find((x): x is string => !!x)
    ?? (OS === 'darwin' ? [path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), '/Applications/Chromium.app/Contents/MacOS/Chromium'].find((p) => existsSync(p)) : undefined);
  if (other) return { ...c, status: 'WARNING', found: other, fix: `render.ts looks for Google Chrome in its standard place; to use ${other}, set the environment variable CHROME_PATH to it` };
  return { ...c, status: 'MISSING', found: '-', fix: `the preview works without it, render.ts needs it. Install: ${INSTALL.chrome[OS]}` };
}

function checkFfmpeg(): Check {
  const c = { tool: 'ffmpeg', need: 'videos (render.ts video)' };
  const exe = Bun.which('ffmpeg');
  if (!exe) return { ...c, status: 'MISSING', found: '-', fix: `only video renders need it (the preview, stills and verify don't). Install: ${INSTALL.ffmpeg[OS]}${ON_PATH}` };
  const r = run([exe, '-encoders']); // (the banner, with the version, goes to stderr; the encoder list to stdout)
  const ver = /ffmpeg version (\S+)/.exec(r.out)?.[1] ?? exe;
  if (r.code !== 0) return { ...c, status: 'WARNING', found: `${exe} does not run (exit ${r.code})`, fix: `reinstall it: ${INSTALL.ffmpeg[OS]}` };
  if (!/\blibx264\b/.test(r.out)) return { ...c, status: 'WARNING', found: `${ver}, without libx264`, fix: `this build has no libx264 (H.264) encoder, which video renders use. Install a full build: ${INSTALL.ffmpeg[OS]}${ON_PATH}` };
  return { ...c, status: 'ok', found: `${ver}, with libx264` };
}

/** A tool that only needs to be on PATH (its version is shown). */
function checkTool(tool: 'uv' | 'git', need: string, why: string, ver: RegExp): Check {
  const exe = Bun.which(tool);
  if (!exe) return { tool, status: 'MISSING', need, found: '-', fix: `${why}. Install: ${INSTALL[tool][OS]}${ON_PATH}` };
  return { tool, status: 'ok', need, found: ver.exec(run([exe, '--version']).out)?.[1] ?? exe };
}

function prerequisites() {
  const checks: Check[] = [
    { tool: 'bun', status: 'ok', need: 'init, the preview, render.ts', found: Bun.version },
    checkChrome(),
    checkFfmpeg(),
    checkTool('uv', 'soundtrack scripts, qc.py (optional)', 'the soundtrack scripts and qc.py run on it; picture work does not need it', /uv (\S+)/),
    checkTool('git', 'version history (optional)', 'optional, for the project\'s version history', /git version (\S+)/),
  ];
  log('Prerequisites');
  const rows = [['tool', 'status', 'needed for', 'found'], ...checks.map((c) => [c.tool, c.status, c.need, c.found])];
  const w = [0, 1, 2].map((i) => Math.max(...rows.map((r) => r[i]!.length)));
  for (const r of rows) log(`  ${r.map((x, i) => (i < 3 ? x.padEnd(w[i]!) : x)).join('  ')}`);
  const todo = checks.filter((c) => c.fix);
  if (todo.length) {
    log('');
    for (const c of todo) log(`  ${c.tool}: ${c.fix}`);
  }
  log('');
}

// ------------------------------------------------------------------ the project
interface VideoInfo { name: string; title: string; treatment: boolean }

/** The project's videos: every videos/<video>/ with a video.json, sorted like the preview sorts them. */
function listVideos(): VideoInfo[] {
  const dir = path.join(P, 'videos');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => existsSync(path.join(dir, n, 'video.json')))
    .sort()
    .map((name) => {
      let title = name;
      try {
        const j = JSON.parse(readText(path.join(dir, name, 'video.json')));
        if (typeof j?.title === 'string' && j.title.trim()) title = j.title.trim();
      } catch {
        title = `${name} (its video.json is not valid JSON)`;
      }
      return { name, title, treatment: existsSync(path.join(dir, name, 'TREATMENT.md')) };
    });
}
/** The preview's default (src/video.ts): the only video, else the first that isn't `example`, else `example`. */
const defaultVideo = (names: string[]) => (names.length <= 1 ? names[0] : names.find((n) => n !== 'example') ?? 'example');

/** Template files never copied: build output, caches, secrets, and what init writes itself (merged or generated). */
const SKIP_NAMES = new Set(['node_modules', 'out', 'dist', '.vite', '.cache', '.git', '.DS_Store', 'Thumbs.db']);
const SKIP_PATHS = new Set(['.gitignore', 'AGENTS.md', 'CLAUDE.md', 'docs', 'videos/example/audio', 'videos/example/data']);

/** The template's files, relative and '/'-separated; package.json last (a folder that has it was set up completely). */
function templateFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(path.join(TEMPLATE, dir))) {
      const r = dir ? `${dir}/${name}` : name;
      if (SKIP_NAMES.has(name) || name.startsWith('.env') || name.endsWith('.tsbuildinfo') || SKIP_PATHS.has(r)) continue;
      const st = statSync(path.join(TEMPLATE, r));
      if (st.isDirectory()) walk(r);
      else if (st.isFile()) out.push(r);
    }
  };
  walk('');
  out.sort();
  return [...out.filter((r) => r !== 'package.json'), ...out.filter((r) => r === 'package.json')];
}

/** What happened to each file: written new, already identical, kept because it differs, replaced (--force). */
interface Tally { copied: string[]; same: string[]; kept: string[]; replaced: string[] }
const tally = (): Tally => ({ copied: [], same: [], kept: [], replaced: [] });

/** A free name for a backup of `dest`: <file>.orig, else <file>.orig2, .orig3 ... */
function backupName(dest: string) {
  for (let i = 1; ; i++) if (!existsSync(`${dest}.orig${i > 1 ? i : ''}`)) return `${dest}.orig${i > 1 ? i : ''}`;
}

/** Write `data` to project path `r` if it's missing; an existing different file only when `replace` (backed up first). */
function put(r: string, data: Buffer | string, replace: boolean, t: Tally) {
  const dest = path.join(P, r);
  try {
    if (existsSync(dest)) {
      if (readFileSync(dest).equals(Buffer.from(data))) return void t.same.push(r);
      if (!replace) return void t.kept.push(r);
      const bak = backupName(dest);
      copyFileSync(dest, bak);
      t.replaced.push(`${r} (yours: ${path.basename(bak)})`);
    } else t.copied.push(r);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, data);
  } catch (e) {
    problem(`could not write ${r}: ${(e as Error).message}`);
  }
}

/** "a, b, c and 4 more" */
const some = (l: string[], n = 6) => (l.length > n ? `${l.slice(0, n).join(', ')} and ${l.length - n} more` : l.join(', '));

/** The npm package name for the folder (lowercase, URL-safe). */
function packageName(dir: string) {
  const n = path.basename(dir).toLowerCase().replace(/[^a-z0-9._~-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[._-]+|[._-]+$/g, '').slice(0, 214);
  return n || 'audara-project';
}

function copyTemplate(files: string[], hadEngine: boolean, withExample: boolean) {
  const name = packageName(P);
  // the package name is the folder's, in package.json and in bun.lock's root entry (its first "name"),
  // so bun install keeps the lockfile as it is (the template keeps its own)
  const setName = (r: string, buf: Buffer): Buffer | string =>
    !isTemplate && (r === 'package.json' || r === 'bun.lock') ? buf.toString('utf8').replace(/("name"\s*:\s*)"[^"]*"/, `$1${JSON.stringify(name)}`) : buf;
  const t = tally(), engineDiff: string[] = [];
  let ownLook = false;
  for (const r of files) {
    if (r.startsWith('videos/example/') && !withExample) continue;
    const data = setName(r, readFileSync(path.join(TEMPLATE, r)));
    const dest = path.join(P, r);
    if (hadEngine && r.startsWith('src/engine/')) {
      // the project's own engine: compared, for the report, never written
      if (!existsSync(dest) || !readFileSync(dest).equals(Buffer.from(data))) engineDiff.push(r.slice('src/engine/'.length));
      continue;
    }
    if (r === 'src/look.ts' && existsSync(dest) && !readFileSync(dest).equals(Buffer.from(data))) {
      ownLook = true; // (the project's palette and post: its look, never replaced, not even with --force)
      continue;
    }
    put(r, data, force, t);
  }
  const nFiles = (n: number) => `${n} file${n === 1 ? '' : 's'}`;
  const parts = [t.copied.length && `copied ${nFiles(t.copied.length)}`, t.same.length && `${nFiles(t.same.length)} already in place`, t.replaced.length && `replaced ${nFiles(t.replaced.length)} (--force)`].filter(Boolean);
  log(`  template: ${parts.join(', ') || 'nothing to copy'}`);
  if (t.replaced.length) log(`    replaced: ${some(t.replaced, 12)}`);
  if (t.kept.length) log(`    kept ${t.kept.length > 1 ? `${t.kept.length} existing files that differ` : '1 existing file that differs'} from the template's (--force replaces ${t.kept.length > 1 ? 'them, keeping each as <file>.orig' : 'it, keeping it as <file>.orig'}): ${some(t.kept)}`);
  if (ownLook) log(`  src/look.ts: the project's own look, kept (init never replaces it; the template's is ${path.join(TEMPLATE, 'src', 'look.ts')})`);
  if (hadEngine) {
    log(engineDiff.length
      ? `  src/engine/: the project's own engine, kept (it differs from the template's in ${some(engineDiff)}). init never replaces it: to take the template's, move src/engine/ away and run init again.`
      : `  src/engine/: kept (the same as the template's)`);
  }
  if (!withExample) log('  videos/example/: not in this project (removed?), so not added back; --video example restores it');
  if (t.kept.includes('package.json')) checkPackageJson();
}

/** A package.json that init didn't write: does it have what the engine needs? */
function checkPackageJson() {
  let mine: Record<string, Record<string, string> | undefined>;
  try { mine = JSON.parse(readText(path.join(P, 'package.json'))); }
  catch (e) { return problem(`package.json is not valid JSON (${(e as Error).message}): fix it, then run init again`); }
  const tpl = JSON.parse(readFileSync(path.join(TEMPLATE, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
  const has = (d: string) => [mine.dependencies, mine.devDependencies, mine.peerDependencies].some((x) => x?.[d]);
  const lack = (k: string) => Object.entries(tpl[k] ?? {}).filter(([d]) => !has(d));
  const deps = lack('dependencies'), dev = [...lack('devDependencies'), ...lack('peerDependencies')];
  const scripts = Object.keys(tpl.scripts ?? {}).filter((s) => !mine.scripts?.[s]);
  if (!deps.length && !dev.length && !scripts.length) return;
  const add = (l: [string, string][], flag: string) => (l.length ? [`bun add${flag} ${l.map(([d, v]) => `${d}@${v}`).join(' ')}`] : []);
  // (one command per line: Windows PowerShell 5.1 has no &&)
  problem(`package.json (yours, kept) lacks what the engine needs: ${[...deps, ...dev].map(([d]) => d).concat(scripts.map((s) => `the "${s}" script`)).join(', ')}. ` +
    `Add them: ${[...add(deps, ''), ...add(dev, ' -d')].join(', then ')}${scripts.length ? `${deps.length || dev.length ? '; and ' : ''}in "scripts": ${scripts.map((s) => `"${s}": "${tpl.scripts![s]}"`).join(', ')}` : ''}`);
}

/** The example's soundtrack and timing data (generated, not shipped): the missing files, or all with --force. */
function demoTrack() {
  const ex = path.join(P, 'videos', 'example');
  if (!existsSync(path.join(ex, 'video.json'))) return;
  const files = ['audio/demo.wav', 'data/audio.json', 'data/words.json'];
  if (!force && files.every((f) => existsSync(path.join(ex, f)))) return;
  // (made in a temporary folder, so an existing file is never overwritten without --force)
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'audara-demo-'));
  const t = tally();
  try {
    makeDemoTrack(tmp);
    for (const f of files) put(`videos/example/${f}`, readFileSync(path.join(tmp, f)), force, t);
  } catch (e) {
    problem(`could not generate the demo track: ${(e as Error).message} (to retry alone: bun ${path.join(import.meta.dir, 'demo-track.ts')} ${ex})`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  if (t.copied.length || t.replaced.length) log(`  example soundtrack: generated ${[...t.copied, ...t.replaced].map((f) => f.replace('videos/example/', '')).join(', ')} in videos/example/`);
}

/** videos/<video>/timeline.ts for a new video: the example's cut helpers, no entries yet. */
const timelineTs = (name: string) => `// The timeline of videos/${name}/: which scene plays when. Add an entry as each scene is written.
// Every time comes from the data, never typed seconds: the beat grid (data/audio.json, or the bpm in
// video.json while there is none) and the words (data/words.json), so the timeline follows the soundtrack.
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
  /** The last beat at or before the first word of the line containing q (a beat up to 20 ms after the word's start counts: the word lands on it). */
  const cut = (q: string, nth = 0) => audio.timeOfBeat(Math.floor(audio.beatAt(words.get(q, nth).words[0]!.start + 0.02)));
  /** The downbeat nearest the end of the line containing q. */
  const after = (q: string, nth = 0) => {
    const e = words.get(q, nth).end;
    return audio.downbeats.reduce((b, d) => (Math.abs(d - e) < Math.abs(b - e) ? d : b), audio.downbeats[0] ?? e);
  };
  /** An entry playing scenes/<file>.ts ('../../<video>/scenes/<file>' takes another video's scene, for a remix). */
  const E = (id: string, file: string, start: number, end: number, extra: Partial<TimelineEntry> = {}): TimelineEntry => {
    const m = scene(file);
    return { id, file: m.path, load: () => import(/* @vite-ignore */ m.url), start, end, ...extra };
  };
  void bar; void cut; void after; void E;

  return [
    // E('intro', 'intro', bar(1), bar(5)),
    // E('title', 'title', cut('words of a line'), after('words of a line')),
    // E('outro', 'outro', bar(9), audio.duration),   (the last entry ends with the video)
  ];
}
`;

/**
 * The audio a video's timing data was made from, when it is there: the window of a song that the soundtrack
 * skill's beats.py window records in data/audio.json, else the file data/audio.json analyzed (`audioFile`). A
 * video whose sound came before its setup plays that file: a silent placeholder would pass verify while every
 * time in the data belongs to audio the video doesn't play.
 */
function dataSoundtrack(dir: string): { file: string; why: string } | null {
  let a: { window?: { file?: unknown; from?: unknown; to?: unknown; song?: unknown }; audioFile?: unknown } | null;
  try { a = JSON.parse(readText(path.join(P, dir, 'data', 'audio.json'))); } catch { return null; }
  const w = a?.window;
  const [file, why] = typeof w?.file === 'string' ? [w.file, `the window ${w.from}–${w.to} s of ${w.song} in data/audio.json`] : [a?.audioFile, 'the file data/audio.json was made from'];
  // (a path inside the video's folder, as the data names it; a file elsewhere is named by its name alone)
  if (typeof file !== 'string' || !file || path.isAbsolute(file) || !existsSync(path.join(P, dir, file))) return null;
  return { file, why };
}

function scaffold(name: string) {
  if (name === 'example') return; // (the template's own example: copied with the template)
  const dir = `videos/${name}`;
  const existed = existsSync(path.join(P, dir));
  const title = name.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const t = tally();
  // silent, with a placeholder length, until the soundtrack exists (picture work never waits for audio); a video
  // whose sound came first plays the audio its data describes, and takes its length from it
  const snd = dataSoundtrack(dir);
  put(`${dir}/video.json`, snd
    ? `{ "title": ${JSON.stringify(title)}, "size": [1920, 1080], "fps": 60, "audio": ${JSON.stringify(snd.file)} }\n`
    : `{ "title": ${JSON.stringify(title)}, "size": [1920, 1080], "fps": 60, "audio": null, "duration": 30, "bpm": 120 }\n`, false, t);
  put(`${dir}/timeline.ts`, timelineTs(name), false, t);
  for (const d of ['scenes', 'audio', 'data']) mkdirSync(path.join(P, dir, d), { recursive: true });
  const plays = snd ? `playing ${snd.file}, ${snd.why}, at its length` : 'silent, 30 s placeholder duration';
  if (!existed) log(`  ${dir}/: created video.json (${plays}), timeline.ts (no entries yet), scenes/ audio/ data/`);
  else if (t.copied.length) log(`  ${dir}/: was there; added ${t.copied.map((f) => f.slice(dir.length + 1) + (f.endsWith('/video.json') ? ` (${plays})` : '')).join(', ')}`);
  else log(`  ${dir}/: already there, kept`);
  if (!existsSync(path.join(P, dir, 'TREATMENT.md'))) log(`    next: write ${dir}/TREATMENT.md (from the code-video skill's references/treatment-template.md)`);
}

function engineGuide() {
  const dest = path.join(P, 'docs', 'ENGINE.md');
  if (existsSync(dest)) return; // (the project's own: it follows the project's engine)
  if (!existsSync(GUIDE)) return log(`  docs/ENGINE.md: skipped (the skill has no references/engine-guide-template.md yet)`);
  const t = tally();
  put('docs/ENGINE.md', readFileSync(GUIDE), false, t);
  if (t.copied.length) log('  docs/ENGINE.md: written (the engine guide)');
}

/** AGENTS.md's generated section: what a later session in this folder needs to know. */
function agentsSection(): string {
  const vids = listVideos();
  const cell = (s: string) => s.replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');
  const rows = vids.length
    ? vids.map((v) => `| \`${v.name}\` | ${cell(v.title)} | \`videos/${v.name}/TREATMENT.md\` | \`<preview>/?v=${v.name}\` |`)
    : ['| (none yet) | | | |'];
  return [
    BEGIN,
    '<!-- Written by audara init (the code-video skill). Running init again rewrites only this section; anything outside it is kept. -->',
    '## Video project (audara)',
    '',
    'Videos made in code: an engine in `src/engine/` (WebGL/GLSL, three.js, Canvas2D) renders each video in `videos/<video>/`, previewed live in the browser and rendered to MP4. The code-video skill holds the method; the soundtrack skill makes audio and its timing data.',
    '',
    '| Video | Title | Treatment | Preview |',
    '|---|---|---|---|',
    ...rows,
    '',
    `- **Shared look:** \`docs/STYLE.md\` in words and \`src/look.ts\` in code (palette, post). **Engine guide:** \`docs/ENGINE.md\` (the scene API, its rules, the render commands; every option is in the header of \`scripts/render.ts\`).`,
    "- **Preview:** `bun scripts/render.ts preview --video <video> --t <seconds>` starts it unless it runs and prints its link, `<preview>/?v=<video>&t=<seconds>`, after checking the server is this project's: another app may hold Vite's default port, 5173. Run it yourself (the director doesn't run commands), before the first scene and again in a new session; the preview runs in a process of its own, so it outlives your turn, until `preview --stop`. Every change gets a link.",
    '- **Render:** `bun scripts/render.ts stills|sheet|verify|video|poster --video <video>` (into `out/<video>/`; `video --draft` for a quick look; a full `video` render takes minutes: wait for it before replying). Before calling work done: `bun run check` and `verify`.',
    '- **The f(t) rule:** every frame is a pure function of the time `t` (seeded randomness, `frameIdx(t)` for flicker, state only in `stateful` scenes), so any moment can be linked, previewed and rendered alike.',
    '- **What you owe the director:** for a new video, its treatment and nothing built before their yes; a one-line status during long work; a `?v=…&t=…` link for every change, with what moved; for a note that reads two ways (too fast: too soon or too quick?), the reading you took and the other on offer; for a change that moves something they set (a length), the version that keeps it; the work shown (the paths of the stills and sheets you checked, numbers, critic verdicts); a question before anything that costs money; the full render when they ask for it.',
    '',
    'Keep this file current as videos are added: running init again (`--video <video>` for a new one) rewrites this section from `videos/*/video.json`.',
    END,
  ].join('\n');
}

/** Add or update the generated section; everything else in AGENTS.md stays as it is. */
function writeAgents() {
  const file = path.join(P, 'AGENTS.md');
  const section = agentsSection();
  try {
    if (!existsSync(file)) {
      writeFileSync(file, `# ${path.basename(P)}\n\n${section}\n`);
      return log(`  AGENTS.md: written (videos: ${listVideos().map((v) => v.name).join(', ') || 'none yet'})`);
    }
    const cur = readFileSync(file, 'utf8');
    const eol = cur.includes('\r\n') ? '\r\n' : '\n';
    const sec = section.replace(/\n/g, eol);
    const nb = cur.split(BEGIN).length - 1, ne = cur.split(END).length - 1;
    const b = cur.indexOf(BEGIN), e = cur.indexOf(END);
    if (!nb && !ne) {
      writeFileSync(file, `${cur}${cur && !cur.endsWith('\n') ? eol : ''}${cur ? eol : ''}${sec}${eol}`);
      return log('  AGENTS.md: added the audara section (your content kept)');
    }
    if (nb !== 1 || ne !== 1 || e < b) return problem(`AGENTS.md: its ${BEGIN} / ${END} markers are broken (it needs one of each, begin first): fix or delete them, then run init again`);
    const next = cur.slice(0, b) + sec + cur.slice(e + END.length);
    if (next === cur) return log('  AGENTS.md: up to date');
    writeFileSync(file, next);
    log(`  AGENTS.md: updated its audara section (videos: ${listVideos().map((v) => v.name).join(', ') || 'none yet'})`);
  } catch (err) {
    problem(`could not write AGENTS.md: ${(err as Error).message}`);
  }
}

/** Two paths that are one file: a symbolic or a hard link between them. */
function sameFile(a: string, b: string) {
  try {
    if (realpathSync(a) === realpathSync(b)) return true;
    const x = statSync(a), y = statSync(b);
    return x.ino !== 0 && x.ino === y.ino && x.dev === y.dev;
  } catch {
    return false;
  }
}

/** CLAUDE.md imports AGENTS.md (Claude Code reads CLAUDE.md; Codex reads AGENTS.md). */
function writeClaude() {
  const file = path.join(P, 'CLAUDE.md'), agents = path.join(P, 'AGENTS.md');
  try {
    if (!existsSync(file)) { writeFileSync(file, '@AGENTS.md\n'); return log('  CLAUDE.md: written (@AGENTS.md)'); }
    if (sameFile(file, agents)) return; // (linked to AGENTS.md: it already has everything, and must not import itself)
    const cur = readFileSync(file, 'utf8');
    if (/^[ \t]*@(\.\/)?AGENTS\.md[ \t]*$/im.test(cur)) return;
    const eol = cur.includes('\r\n') ? '\r\n' : '\n';
    writeFileSync(file, `${cur}${cur && !cur.endsWith('\n') ? eol : ''}${cur ? eol : ''}@AGENTS.md${eol}`);
    log('  CLAUDE.md: added @AGENTS.md (your content kept)');
  } catch (err) {
    problem(`could not write CLAUDE.md: ${(err as Error).message}`);
  }
}

/** The template's .gitignore entries the project lacks (renders, dependencies, caches, secrets). */
function writeGitignore() {
  const src = path.join(TEMPLATE, '.gitignore'), file = path.join(P, '.gitignore');
  if (!existsSync(src)) return;
  const tpl = readFileSync(src, 'utf8');
  try {
    if (!existsSync(file)) { writeFileSync(file, tpl); return log('  .gitignore: written'); }
    const cur = readFileSync(file, 'utf8');
    // ("out", "/out" and "out/" all keep out/ out of git)
    const norm = (l: string) => l.trim().replace(/^\//, '').replace(/\/$/, '');
    const have = new Set(cur.split(/\r?\n/).map(norm));
    const missing = tpl.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !have.has(norm(l)));
    if (!missing.length) return;
    const eol = cur.includes('\r\n') ? '\r\n' : '\n';
    writeFileSync(file, `${cur}${cur && !cur.endsWith('\n') ? eol : ''}${cur ? eol : ''}# video project (audara)${eol}${missing.join(eol)}${eol}`);
    log(`  .gitignore: added ${missing.join(' ')}`);
  } catch (err) {
    problem(`could not write .gitignore: ${(err as Error).message}`);
  }
}

// ------------------------------------------------------------------ main
log(`audara init: ${P}\n`);
prerequisites();

if (!existsSync(TEMPLATE)) fail(`the template is missing (${TEMPLATE}): reinstall the code-video skill; its assets/template-webgl folder must come with it`);
if (existsSync(P) && !statSync(P).isDirectory()) fail(`${P} is a file: give a folder (it is created if missing)`);
const inTemplate = path.relative(TEMPLATE, P);
if (inTemplate && !inTemplate.startsWith('..') && !path.isAbsolute(inTemplate)) fail(`${P} is inside the template: run init on your project's folder`);
// (init on the template itself sets it up for developing the template: demo track, docs, AGENTS.md)
const isTemplate = !inTemplate;
const created = !existsSync(P);
mkdirSync(P, { recursive: true });

const files = templateFiles();
const hadEngine = existsSync(path.join(P, 'src', 'engine'));
// Another kind of project (a web app, say) already lives here: the video project brings its own
// package.json, index.html, vite.config.ts and src/, which would mix with that one's.
if (!force && !hadEngine && !listVideos().length && existsSync(path.join(P, 'package.json'))) {
  const clash = files.filter((r) => (!r.includes('/') || r.startsWith('src/')) && existsSync(path.join(P, r)));
  fail(`${P} already holds another project (${clash.join(', ')}). A video project brings its own package.json, index.html, vite.config.ts and src/, so it needs a folder of its own: ` +
    `run init on a new subfolder, e.g. bun ${import.meta.path} ${path.join(P, 'video')} (its videos can still use files from here). --force puts it here anyway and replaces those files (keeping each as <file>.orig).`);
}
// An initialized project that removed the example keeps it removed (--video example restores it). The example
// counts as there only with its video.json: a delete cut short (a sandbox that refused part of it) can leave a
// file or two behind.
const withExample = !hadEngine || existsSync(path.join(P, 'videos', 'example', 'video.json')) || newVideos.includes('example');

log(`Project${created ? ' (new folder)' : ''}`);
copyTemplate(files, hadEngine, withExample);
demoTrack();
for (const v of newVideos) scaffold(v);
engineGuide();
writeAgents();
writeClaude();
writeGitignore();

if (install) {
  log('\nbun install');
  // (the bun running this script, so it works even when bun isn't on PATH)
  const r = Bun.spawnSync([process.execPath, 'install'], { cwd: P, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
  if (r.exitCode !== 0) problem(`bun install failed (exit ${r.exitCode}): read its message above, fix it, then run "bun install" in ${P} (an old bun may not read the lockfile: bun upgrade)`);
}
const needInstall = !install && !existsSync(path.join(P, 'node_modules'));
if (!install) log(`\nbun install: skipped (--no-install)${needInstall ? '; run it in the project before the preview' : ''}`);

const vids = listVideos().map((v) => v.name);
const show = newVideos.at(-1) ?? defaultVideo(vids);
const here = path.relative(process.cwd(), P) === '';
// (one command per line: Windows PowerShell 5.1 has no &&)
log('\nNext: start the preview and get its link (it keeps running on its own, until `bun scripts/render.ts preview --stop`):');
if (!here) log(`  cd "${P}"`);
if (needInstall) log('  bun install');
log(`  bun scripts/render.ts preview --video ${show ?? '<video>'}`);
if (problems.length) {
  log(`\ninit finished with ${problems.length} problem${problems.length > 1 ? 's' : ''}:`);
  for (const p of problems) log(`  - ${p}`);
  process.exit(1);
}
