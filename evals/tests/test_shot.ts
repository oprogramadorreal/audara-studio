#!/usr/bin/env bun
// Offline checks of the template's scripts/shot.ts (shots made by a program): bun evals/tests/test_shot.ts
// Each check makes a throwaway project (in a folder whose path has a space) holding the template's shot.ts,
// footage.ts and vite.config.ts, and a recipe whose program is a small bun script writing BMP frames; needs
// ffmpeg and ffprobe on the PATH, as shot.ts does. No browser, no network, nothing spent.
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TEMPLATE = path.resolve(import.meta.dir, '../../skills/code-video/assets/template-webgl');

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const cases: [string, () => void | Promise<void>][] = [];
const test = (name: string, run: () => void | Promise<void>) => cases.push([name, run]);

/** A test program: frames of a bar moving with time, as BMP. Its environment varies it (see `env` below). */
const PROGRAM = String.raw`
import { writeFileSync, appendFileSync, readFileSync, mkdirSync } from 'node:fs';
const e = process.env;
const [out, first, last, w, h, fps] = process.argv.slice(2);
if (e.SIDE_DIR) { mkdirSync(out + '/meta/deep', { recursive: true }); mkdirSync(out + '/empty'); writeFileSync(out + '/meta/camera.json', '{"fov": 40}'); writeFileSync(out + '/meta/deep/notes.txt', 'x'); }
if (e.OTHER) for (const f of e.OTHER.split(',')) { if (f.endsWith('/')) mkdirSync(out + '/' + f, { recursive: true }); else writeFileSync(out + '/' + f, 'x'); }
const W = +(e.FORCE_W ?? w), H = +h, F = +fps;
if (e.LOG) appendFileSync(e.LOG, JSON.stringify({ first: +first, last: +last, env: { out: e.AUDARA_SHOT_OUT, first: e.AUDARA_SHOT_FIRST, last: e.AUDARA_SHOT_LAST, frames: e.AUDARA_SHOT_FRAMES, fps: e.AUDARA_SHOT_FPS, width: e.AUDARA_SHOT_WIDTH, height: e.AUDARA_SHOT_HEIGHT, scale: e.AUDARA_SHOT_SCALE, tmp: e.AUDARA_SHOT_TMP, name: e.AUDARA_SHOT_NAME } }) + '\n');
if (e.FAIL) process.exit(3);
if (e.SIDE) writeFileSync(out + '/events.json', '{"jump": [3]}');
if (e.RESERVED) writeFileSync(out + '/manifest.json', '{}');
if (e.TOUCH) writeFileSync(e.TOUCH, String(Date.now()));
if (e.RECIPE) { const r = JSON.parse(readFileSync(e.RECIPE, 'utf8')); r.fps = 25; writeFileSync(e.RECIPE, JSON.stringify(r)); }
if (e.SLEEP) Bun.sleepSync(+e.SLEEP);
if (e.DUP) writeFileSync(out + '/' + String(+first).padStart(6, '0') + '.png', 'x');
const EXT = e.EXT ?? 'bmp';
let carried = 0;
for (let k = +first; k <= +last; k++) {
  if (e.SKIP && k === +e.SKIP) continue;
  const t = (k - 1) / F, row = (W * 3 + 3) & ~3, px = Buffer.alloc(54 + row * H);
  px.write('BM'); px.writeUInt32LE(px.length, 2); px.writeUInt32LE(54, 10); px.writeUInt32LE(40, 14);
  px.writeInt32LE(W, 18); px.writeInt32LE(H, 22); px.writeUInt16LE(1, 26); px.writeUInt16LE(24, 28); px.writeUInt32LE(row * H, 34);
  if (e.STATE) carried++;
  const x0 = Math.floor(((t * 0.5) % 1) * W), shade = +(e.SHADE ?? 200);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = 54 + y * row + x * 3, on = x >= x0 && x < x0 + W / 8;
    px[o] = on ? 40 : (shade * y) / H; px[o + 1] = on ? 140 : 30 + (carried % 7); px[o + 2] = on ? 250 : 20;
  }
  writeFileSync(out + '/' + String(k).padStart(6, '0') + '.' + EXT, px);
}
if (e.EXTRA) writeFileSync(out + '/' + String(+last + 1).padStart(6, '0') + '.bmp', 'x');
`;

const RECIPE = { command: ['bun', 'draw.ts', '{out}', '{first}', '{last}', '{width}', '{height}', '{fps}'], fps: 30, frames: 12, size: [64, 36] };

/** A throwaway project with the template's shot.ts, footage.ts and vite.config.ts, and the shot `bars`. */
function project(recipe: Record<string, unknown> = RECIPE) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'audara shot test-'));
  for (const f of ['scripts/shot.ts', 'src/engine/footage.ts', 'vite.config.ts']) {
    mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    cpSync(path.join(TEMPLATE, f), path.join(root, f));
  }
  mkdirSync(path.join(root, 'shots', 'bars'), { recursive: true });
  writeFileSync(path.join(root, 'shots', 'bars', 'draw.ts'), PROGRAM);
  writeFileSync(path.join(root, 'shots', 'bars', 'shot.json'), JSON.stringify(recipe));
  const shot = (args: string[], env: Record<string, string> = {}) => {
    const p = Bun.spawnSync(['bun', path.join(root, 'scripts', 'shot.ts'), ...args], { cwd: root, env: { ...process.env, ...env } });
    return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
  };
  const json = (f: string) => JSON.parse(readFileSync(path.join(root, f), 'utf8'));
  const versions = () => readdirSync(path.join(root, 'footage', 'bars')).filter((d) => /^g\d+-/.test(d)).sort();
  const done = () => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  return { root, shot, json, versions, done };
}

test('status, make, then current: a version folder of full frames and proxies, made.json, and the manifest naming it last', () => {
  const p = project();
  try {
    check(/bars: not made yet/.test(p.shot(['status']).out), 'status before a make');
    const m = p.shot(['make']);
    check(m.code === 0, `make failed: ${m.out}`);
    const man = p.json('footage/bars/manifest.json'), made = p.json(`footage/bars/${man.dir}/made.json`);
    check(man.frames === 12 && man.fps === 30 && man.size.join('x') === '64x36' && man.proxy.join('x') === '32x18', `manifest ${JSON.stringify(man)}`);
    check(/^g1-[0-9a-f]{8}$/.test(man.dir) && man.made === 'scripts/shot.ts' && made.dir === man.dir && made.hashes.length === 12, `dir ${man.dir}, made ${made.dir}, ${made.hashes?.length} hashes`);
    const full = readdirSync(path.join(p.root, 'footage/bars', man.dir, 'full')), proxy = readdirSync(path.join(p.root, 'footage/bars', man.dir, 'proxy'));
    check(full.length === 12 && full[0] === '000001.jpg' && full[11] === '000012.jpg' && proxy.length === 12, `full ${full.length}, proxy ${proxy.length}`);
    check(existsSync(path.join(p.root, 'footage/bars', man.dir, 'contact.jpg')), 'no contact sheet in the version');
    check(readdirSync(path.join(p.root, 'footage/bars')).sort().join() === [man.dir, 'manifest.json'].sort().join(), `footage/bars holds ${readdirSync(path.join(p.root, 'footage/bars')).join(', ')}`);
    check(!existsSync(path.join(p.root, '.audara-cache/shots/bars')), 'staging left behind');
    check(!existsSync(path.join(p.root, '.audara-cache/shots/bars.lock')), 'lock left behind');
    check(/current \(g1-/.test(p.shot(['status']).out), 'status after a make');
    const again = p.shot(['make']);
    check(/nothing to make/.test(again.out) && p.versions().length === 1, `a second make: ${again.out}`);
  } finally { p.done(); }
});

test('the program gets the placeholders and the same as environment variables; {out} and {tmp} are absolute', () => {
  const p = project({ ...RECIPE, command: [...RECIPE.command, '{frames}', '{scale}', '{shot}', '{tmp}'] });
  try {
    const log = path.join(p.root, 'calls.jsonl');
    check(p.shot(['make'], { LOG: log }).code === 0, 'make failed');
    const call = JSON.parse(readFileSync(log, 'utf8').trim().split('\n')[0]!);
    check(call.first === 1 && call.last === 12, `first/last ${call.first}/${call.last}`);
    const e = call.env;
    check(e.first === '1' && e.last === '12' && e.frames === '12' && e.fps === '30' && e.width === '64' && e.height === '36' && e.scale === '1' && e.name === 'bars', `env ${JSON.stringify(e)}`);
    check(path.isAbsolute(e.out) && path.isAbsolute(e.tmp) && e.out.includes('.audara-cache'), `out ${e.out}, tmp ${e.tmp}`);
  } finally { p.done(); }
});

test('check passes for a program whose frames depend on their time alone, and fails (exit 1) when one carries state or noise', () => {
  const p = project();
  try {
    const log = path.join(p.root, 'calls.jsonl');
    check(p.shot(['make']).code === 0, 'make failed');
    const ok = p.shot(['check', 'bars'], { LOG: log });
    check(ok.code === 0 && /agree with the shot pixel for pixel/.test(ok.out), `check: ${ok.out}`);
    const tmps = readFileSync(log, 'utf8').trim().split(/\r?\n/).map((l) => JSON.parse(l).env.tmp);
    check(tmps.length === 5 && new Set(tmps).size === 5, `each run of check gets its own {tmp}: ${tmps.join(', ')}`);
    check(p.shot(['make', '--force'], { STATE: '1' }).code === 0, 'make with state failed');
    const bad = p.shot(['check', 'bars'], { STATE: '1' });
    check(bad.code === 1 && /differ from the shot/.test(bad.out), `check with state: ${bad.code} ${bad.out}`);
  } finally { p.done(); }
});

test('an input changed makes the shot stale, naming it; the next make keeps the version before and removes older ones', () => {
  const p = project();
  try {
    check(p.shot(['make']).code === 0, 'make 1 failed');
    writeFileSync(path.join(p.root, 'shots/bars/draw.ts'), PROGRAM + '\n// changed\n');
    const st = p.shot(['status']).out;
    check(/stale: shots\/bars\/draw\.ts changed/.test(st), `status: ${st}`);
    check(/stale/.test(p.shot(['check', 'bars']).out), 'check of a stale shot should refuse');
    check(!existsSync(path.join(p.root, '.audara-cache/shots/bars.lock')), 'a refused check left its lock');
    check(p.shot(['make']).code === 0, 'make 2 failed');
    writeFileSync(path.join(p.root, 'shots/bars/draw.ts'), PROGRAM + '\n// changed again\n');
    check(p.shot(['make']).code === 0, 'make 3 failed');
    const v = p.versions();
    check(v.length === 2 && v[0]!.startsWith('g2-') && v[1]!.startsWith('g3-'), `versions ${v.join(', ')}`);
    check(p.json('footage/bars/manifest.json').dir === v[1], 'the manifest names the newest');
    check(p.shot(['clean']).code === 0 && p.versions().join() === v[1], `after clean: ${p.versions().join(', ')}`);
  } finally { p.done(); }
});

test('a failed program, a missing frame, an extra frame or a wrong size publishes nothing and leaves the shot as it was', () => {
  const p = project();
  try {
    check(p.shot(['make']).code === 0, 'make failed');
    const before = readFileSync(path.join(p.root, 'footage/bars/manifest.json'), 'utf8');
    for (const [env, says] of [
      [{ FAIL: '1' }, /exited with code 3/],
      [{ SKIP: '5' }, /didn't write frame 000005/],
      [{ EXTRA: '1' }, /outside the 1\.\.12/],
      [{ FORCE_W: '60' }, /is 60x36, not the 64x36/],
    ] as [Record<string, string>, RegExp][]) {
      const r = p.shot(['make', '--force'], env);
      check(r.code === 1 && says.test(r.out), `${JSON.stringify(env)}: ${r.code} ${r.out}`);
      check(readFileSync(path.join(p.root, 'footage/bars/manifest.json'), 'utf8') === before, `${JSON.stringify(env)} changed the manifest`);
      check(p.versions().length === 1, `${JSON.stringify(env)} left a version folder`);
      check(!existsSync(path.join(p.root, '.audara-cache/shots/bars')), `${JSON.stringify(env)} left its staging`);
    }
  } finally { p.done(); }
});

test('--scale 2 makes the frames twice the size with proxies at half the 1x size, and the scale stays for later makes and checks', () => {
  const p = project();
  try {
    check(p.shot(['make', '--scale', '2']).code === 0, 'make --scale 2 failed');
    const man = p.json('footage/bars/manifest.json');
    check(man.size.join('x') === '128x72' && man.proxy.join('x') === '32x18', `manifest ${JSON.stringify(man)}`);
    check(/nothing to make/.test(p.shot(['make']).out), 'a plain make after --scale 2 should be current');
    check(p.shot(['check', 'bars', '--n', '2']).code === 0, 'check at the kept scale');
    check(p.shot(['make', '--scale', '1']).code === 0, 'make --scale 1 failed');
    const back = p.json('footage/bars/manifest.json');
    check(back.size.join('x') === '64x36' && p.json(`footage/bars/${back.dir}/made.json`).scale === 1, `back to 1: ${JSON.stringify(back)}`);
  } finally { p.done(); }
});

test('the recipe\'s own manifest fields changed alone rewrite the manifest, not the frames; the program\'s other files are published', () => {
  const p = project();
  try {
    check(p.shot(['make'], { SIDE: '1' }).code === 0, 'make failed');
    check(JSON.parse(readFileSync(path.join(p.root, 'footage/bars', p.json('footage/bars/manifest.json').dir, 'events.json'), 'utf8')).jump[0] === 3, 'events.json not kept with its version');
    writeFileSync(path.join(p.root, 'shots/bars/shot.json'), JSON.stringify({ ...RECIPE, manifest: { title: 'a bar' } }));
    check(/current \(g1-/.test(p.shot(['status']).out), 'a title alone should leave the frames current');
    const r = p.shot(['make']);
    check(r.code === 0 && /manifest written again/.test(r.out), `make: ${r.out}`);
    check(p.json('footage/bars/manifest.json').title === 'a bar' && p.versions().length === 1, 'title not written, or the frames made again');
    writeFileSync(path.join(p.root, 'shots/bars/shot.json'), JSON.stringify({ ...RECIPE, fps: 24 }));
    check(/stale: its fps changed/.test(p.shot(['status']).out), 'a field that changes the frames should make it stale');
  } finally { p.done(); }
});

test('an input written while the program runs publishes nothing: the program\'s scratch goes to {tmp}', () => {
  const p = project();
  try {
    const r = p.shot(['make'], { TOUCH: path.join(p.root, 'shots/bars/scratch.txt') });
    // (scratch.txt is new: the first key didn't have it)
    check(r.code === 1 && /changed while it was being made/.test(r.out) && !existsSync(path.join(p.root, 'footage/bars/manifest.json')), `${r.code} ${r.out}`);
  } finally { p.done(); }
});

test('footage this script didn\'t make is left alone; an engine that can\'t read "dir" is refused with what to do; a live lock stops a second make', () => {
  const p = project();
  try {
    mkdirSync(path.join(p.root, 'footage/bars/full'), { recursive: true });
    writeFileSync(path.join(p.root, 'footage/bars/manifest.json'), '{"frames": 1, "fps": 30}');
    const foreign = p.shot(['make']);
    check(foreign.code === 1 && /didn't make/.test(foreign.out), `foreign: ${foreign.out}`);
    check(/didn't make/.test(p.shot(['status']).out), 'status of a capture');
    rmSync(path.join(p.root, 'footage'), { recursive: true });
    const engine = path.join(p.root, 'src/engine/footage.ts');
    const src = readFileSync(engine, 'utf8');
    // (an engine from before 0.17.0: its footage.ts doesn't know a manifest scripts/shot.ts wrote)
    writeFileSync(engine, src.split("'scripts/shot.ts'").join("'another'"));
    const old = p.shot(['make']);
    check(old.code === 1 && /reads no "dir"/.test(old.out), `old engine: ${old.out}`);
    writeFileSync(engine, src);
    mkdirSync(path.join(p.root, '.audara-cache/shots'), { recursive: true });
    writeFileSync(path.join(p.root, '.audara-cache/shots/bars.lock'), JSON.stringify({ pid: process.pid }));
    const locked = p.shot(['make']);
    check(locked.code === 1 && /being made by another run/.test(locked.out), `live lock: ${locked.out}`);
    writeFileSync(path.join(p.root, '.audara-cache/shots/bars.lock'), JSON.stringify({ pid: 999999 }));
    check(p.shot(['make']).code === 0, 'a dead process\'s lock should be taken over');
  } finally { p.done(); }
});

test('inputs from the project root (a leading /), an input that names nothing, and a recipe mistake are reported', () => {
  const p = project({ ...RECIPE, inputs: ['draw.ts', '/data/notes.txt'] });
  try {
    const missing = p.shot(['make']);
    check(missing.code === 1 && /\/data\/notes\.txt names no file/.test(missing.out), `missing: ${missing.out}`);
    mkdirSync(path.join(p.root, 'data'));
    writeFileSync(path.join(p.root, 'data/notes.txt'), 'a');
    check(p.shot(['make']).code === 0, 'make with a root input failed');
    writeFileSync(path.join(p.root, 'data/notes.txt'), 'b');
    check(/stale: data\/notes\.txt changed/.test(p.shot(['status']).out), 'a root input changed should make it stale');
    writeFileSync(path.join(p.root, 'shots/bars/shot.json'), JSON.stringify({ ...RECIPE, size: [64.5, 36] }));
    check(/"size" must be/.test(p.shot(['make']).out), 'a bad size should be reported');
  } finally { p.done(); }
});

test('a manifest that can\'t be replaced publishes nothing: the version it names stays, and clean keeps it', () => {
  const p = project();
  try {
    check(p.shot(['make']).code === 0, 'make failed');
    const g1 = p.json('footage/bars/manifest.json').dir;
    const manifest = path.join(p.root, 'footage/bars/manifest.json');
    // (a read-only file can't be replaced by a rename on Windows; elsewhere, a read-only folder stops the rename)
    const lockDown = process.platform === 'win32' ? manifest : path.join(p.root, 'footage/bars');
    chmodSync(lockDown, 0o555);
    let r;
    try { r = p.shot(['make', '--force']); } finally { chmodSync(lockDown, process.platform === 'win32' ? 0o644 : 0o755); }
    check(r.code === 1 && /couldn't be replaced|EPERM|EACCES/.test(r.out), `make over a locked manifest: ${r.code} ${r.out}`);
    check(p.json('footage/bars/manifest.json').dir === g1 && p.versions().join() === g1, `after the failure: manifest ${p.json('footage/bars/manifest.json').dir}, versions ${p.versions().join(', ')}`);
    check(p.shot(['clean']).code === 0 && p.versions().join() === g1, `clean removed the version on screen: ${p.versions().join(', ')}`);
    check(/current/.test(p.shot(['status']).out), 'status after the failure');
  } finally { p.done(); }
});

test('a version missing a proxy or a full frame is stale, not current, and make makes it again', () => {
  const p = project();
  try {
    check(p.shot(['make']).code === 0, 'make failed');
    const g1 = p.json('footage/bars/manifest.json').dir;
    rmSync(path.join(p.root, 'footage/bars', g1, 'proxy', '000001.jpg'));
    check(/stale: its frames aren't all there/.test(p.shot(['status']).out), 'a missing proxy should read as stale');
    const r = p.shot(['make']);
    check(r.code === 0 && p.json('footage/bars/manifest.json').dir !== g1, `make after a missing proxy: ${r.out}`);
  } finally { p.done(); }
});

test('a recipe edited while its program runs publishes nothing', () => {
  const p = project();
  try {
    const r = p.shot(['make'], { RECIPE: path.join(p.root, 'shots/bars/shot.json') });
    check(r.code === 1 && /changed while it was being made/.test(r.out) && /its fps changed/.test(r.out), `${r.code} ${r.out}`);
    check(!existsSync(path.join(p.root, 'footage/bars/manifest.json')), 'a manifest was published');
  } finally { p.done(); }
});

test('two files for one frame, or a file named like one of the script\'s own, stop the make; an upper-case extension works', () => {
  const p = project();
  try {
    const dup = p.shot(['make'], { DUP: '1' });
    check(dup.code === 1 && /wrote frame 000001 twice/.test(dup.out), `duplicate: ${dup.out}`);
    const reserved = p.shot(['make'], { RESERVED: '1' });
    check(reserved.code === 1 && /manifest\.json, a name this script keeps/.test(reserved.out), `reserved: ${reserved.out}`);
    check(p.shot(['make'], { EXT: 'BMP' }).code === 0, 'frames written as .BMP');
  } finally { p.done(); }
});

test('a second make of the same shot while one runs is refused; the first publishes', async () => {
  const p = project();
  try {
    const first = Bun.spawn(['bun', path.join(p.root, 'scripts', 'shot.ts'), 'make'], { cwd: p.root, env: { ...process.env, SLEEP: '3000' }, stdout: 'pipe', stderr: 'pipe' });
    for (let i = 0; i < 100 && !existsSync(path.join(p.root, '.audara-cache/shots/bars.lock')); i++) await Bun.sleep(50);
    const second = p.shot(['make', '--force']);
    check(second.code === 1 && /being made by another run/.test(second.out), `second make: ${second.code} ${second.out}`);
    check((await first.exited) === 0, 'the first make failed');
    check(p.versions().length === 1, `versions ${p.versions().join(', ')}`);
  } finally { p.done(); }
});

test('a folder named like a version that this script didn\'t make is never removed, by make or by clean', () => {
  const p = project();
  try {
    mkdirSync(path.join(p.root, 'footage/bars/g7-deadbeef'), { recursive: true });
    writeFileSync(path.join(p.root, 'footage/bars/g7-deadbeef/sentinel.txt'), 'keep');
    check(p.shot(['make']).code === 0, 'make failed');
    check(/^g8-/.test(p.json('footage/bars/manifest.json').dir), `a new version past the folder there: ${p.json('footage/bars/manifest.json').dir}`);
    writeFileSync(path.join(p.root, 'shots/bars/draw.ts'), PROGRAM + '\n// again\n');
    check(p.shot(['make']).code === 0 && p.shot(['clean']).code === 0, 'make or clean failed');
    check(existsSync(path.join(p.root, 'footage/bars/g7-deadbeef/sentinel.txt')), 'the folder this script did not make was removed');
  } finally { p.done(); }
});

test('a version that can\'t be removed after a publish is left for later, a frame or a proxy held: the make says so, clean finishes it', () => {
  if (process.platform !== 'win32') return; // (an open file holds a folder only on Windows)
  for (const kind of ['full', 'proxy']) {
  const p = project();
  try {
    check(p.shot(['make']).code === 0, 'make 1 failed');
    const g1 = p.json('footage/bars/manifest.json').dir;
    const held = path.join(p.root, 'footage/bars', g1, kind, '000001.jpg');
    // (a PowerShell holding a frame of the oldest version open, shared with nobody, as a viewer can)
    const holder = Bun.spawn(['powershell', '-NoProfile', '-Command', `$f = [IO.File]::Open('${held.replace(/'/g, "''")}', 'Open', 'Read', 'None'); Start-Sleep -Seconds 30; $f.Close()`], { stdout: 'ignore', stderr: 'ignore' });
    Bun.sleepSync(1500);
    try {
      writeFileSync(path.join(p.root, 'shots/bars/draw.ts'), PROGRAM + '\n// 2\n');
      check(p.shot(['make']).code === 0, 'make 2 failed');
      writeFileSync(path.join(p.root, 'shots/bars/draw.ts'), PROGRAM + '\n// 3\n');
      const r = p.shot(['make']);
      check(r.code === 0 && /couldn't be removed yet/.test(r.out), `make 3 with ${g1}'s ${kind} held: ${r.code} ${r.out}`);
      check(p.json('footage/bars/manifest.json').dir.startsWith('g3-'), 'the manifest did not advance');
    } finally { holder.kill(); }
    Bun.sleepSync(500);
    check(p.shot(['clean']).code === 0 && p.versions().length === 1, `clean afterwards (${kind} held before): ${p.versions().join(', ')}`);
  } finally { p.done(); }
  }
});

test('two runs that find one abandoned lock: one takes it and makes the shot, the other is refused', async () => {
  const p = project();
  try {
    mkdirSync(path.join(p.root, '.audara-cache/shots'), { recursive: true });
    writeFileSync(path.join(p.root, '.audara-cache/shots/bars.lock'), JSON.stringify({ pid: 999999, token: 'dead' }));
    const start = () => Bun.spawn(['bun', path.join(p.root, 'scripts', 'shot.ts'), 'make'], { cwd: p.root, env: { ...process.env, SLEEP: '2500' }, stdout: 'pipe', stderr: 'pipe' });
    const runs = [start(), start()];
    const codes = await Promise.all(runs.map((r) => r.exited));
    const outs = await Promise.all(runs.map(async (r) => `${await new Response(r.stdout as ReadableStream).text()}${await new Response(r.stderr as ReadableStream).text()}`));
    check(codes.filter((c) => c === 0).length === 1 && codes.filter((c) => c === 1).length === 1, `exit codes ${codes.join(', ')}: ${outs.join(' | ')}`);
    check(outs.some((o) => /being made by another run/.test(o)), `the refused run said: ${outs.join(' | ')}`);
    check(p.versions().length === 1 && !existsSync(path.join(p.root, '.audara-cache/shots/bars.lock')), `versions ${p.versions().join(', ')}`);
  } finally { p.done(); }
});

test('a version whose record is gone is made again at the scale its manifest says; a missing sidecar makes it stale', () => {
  const p = project();
  try {
    check(p.shot(['make', '--scale', '2'], { SIDE: '1' }).code === 0, 'make --scale 2 failed');
    const g1 = p.json('footage/bars/manifest.json').dir;
    rmSync(path.join(p.root, 'footage/bars', g1, 'made.json'));
    check(/stale: its version's record/.test(p.shot(['status']).out), 'a missing record should read as stale');
    check(p.shot(['make'], { SIDE: '1' }).code === 0, 'make after the record was lost failed');
    const man = p.json('footage/bars/manifest.json');
    check(man.size.join('x') === '128x72' && p.versions().includes(g1), `scale kept and the version on screen kept: ${JSON.stringify(man.size)}, ${p.versions().join(', ')}`);
    rmSync(path.join(p.root, 'footage/bars', man.dir, 'events.json'));
    check(/stale: its frames aren't all there/.test(p.shot(['status']).out), 'a missing sidecar should read as stale');
  } finally { p.done(); }
});

test('a hidden file of the recipe folder is an input; what a tool, a system or an editor leaves there is not', () => {
  const p = project();
  try {
    const dir = path.join(p.root, 'shots/bars');
    writeFileSync(path.join(dir, '.env'), 'SEED=1');
    mkdirSync(path.join(dir, '.settings'));
    writeFileSync(path.join(dir, '.settings/quality.json'), '{"spp": 64}');
    check(p.shot(['make']).code === 0, 'make failed');
    const inputs = p.json(`footage/bars/${p.json('footage/bars/manifest.json').dir}/made.json`).inputs.map((i: [string, string]) => i[0]);
    check(inputs.join() === 'shots/bars/.env,shots/bars/.settings/quality.json,shots/bars/draw.ts', `inputs ${inputs.join(', ')}`);
    writeFileSync(path.join(dir, '.env'), 'SEED=2');
    check(/stale: shots\/bars\/\.env changed/.test(p.shot(['status']).out), `a hidden input changed: ${p.shot(['status']).out}`);
    check(p.shot(['make']).code === 0, 'make 2 failed');
    for (const f of ['.DS_Store', '._draw.ts', 'Thumbs.db', 'desktop.ini', '.draw.ts.swp', '.#draw.ts']) writeFileSync(path.join(dir, f), 'x');
    for (const d of ['.venv/lib', '__pycache__', '.pytest_cache/v', '.ipynb_checkpoints', 'node_modules/a']) { mkdirSync(path.join(dir, d), { recursive: true }); writeFileSync(path.join(dir, d, 'x.py'), 'x'); }
    const st = p.shot(['status']).out;
    check(/bars: current/.test(st), `a tool's folders and a system's or an editor's files aren't inputs: ${st}`);
  } finally { p.done(); }
});

test('a recipe whose command is all there is needs no input file, by default or with "inputs": []; a pattern that names none is still refused', () => {
  const p = project({ ...RECIPE, command: ['bun', '../../tools/draw.ts', ...RECIPE.command.slice(2)] });
  try {
    const recipe = path.join(p.root, 'shots/bars/shot.json');
    mkdirSync(path.join(p.root, 'tools'));
    cpSync(path.join(p.root, 'shots/bars/draw.ts'), path.join(p.root, 'tools/draw.ts'));
    rmSync(path.join(p.root, 'shots/bars/draw.ts'));
    const m = p.shot(['make']);
    check(m.code === 0, `make with the recipe alone in its folder: ${m.out}`);
    const dir = p.json('footage/bars/manifest.json').dir;
    check(p.json(`footage/bars/${dir}/made.json`).inputs.length === 0 && /bars: current/.test(p.shot(['status']).out), 'no input files, and current');
    check(p.shot(['check', 'bars']).code === 0, 'check failed');
    writeFileSync(recipe, JSON.stringify({ ...RECIPE, command: ['bun', '../../tools/draw.ts', ...RECIPE.command.slice(2)], inputs: [] }));
    const none = p.shot(['make']);
    check(none.code === 0 && /bars: current/.test(p.shot(['status']).out), `"inputs": []: ${none.out}`);
    writeFileSync(recipe, JSON.stringify({ ...RECIPE, command: ['bun', '../../tools/draw.ts', ...RECIPE.command.slice(2)], fps: 25, inputs: [] }));
    check(/stale: its fps changed/.test(p.shot(['status']).out), 'the recipe\'s own fields still make it stale');
    writeFileSync(recipe, JSON.stringify({ ...RECIPE, command: ['bun', '../../tools/draw.ts', ...RECIPE.command.slice(2)], inputs: ['*.py'] }));
    const typo = p.shot(['make']);
    check(typo.code === 1 && /the input \*\.py names no file/.test(typo.out), `a pattern that names no file: ${typo.out}`);
  } finally { p.done(); }
});

test('files the program writes in folders beside its frames are published by their paths; one gone makes the shot stale', () => {
  const p = project();
  try {
    const m = p.shot(['make'], { SIDE_DIR: '1', SIDE: '1' });
    check(m.code === 0 && /with events\.json, meta\/camera\.json, meta\/deep\/notes\.txt/.test(m.out), `make: ${m.out}`);
    const dir = p.json('footage/bars/manifest.json').dir, at = (f: string) => path.join(p.root, 'footage/bars', dir, f);
    check(readFileSync(at('meta/camera.json'), 'utf8') === '{"fov": 40}' && existsSync(at('meta/deep/notes.txt')) && existsSync(at('events.json')), 'the files in folders aren\'t in the version');
    check(!existsSync(at('empty')), 'a folder holding nothing was published');
    check(p.json(`footage/bars/${dir}/made.json`).other.join() === 'events.json,meta/camera.json,meta/deep/notes.txt', `other ${p.json(`footage/bars/${dir}/made.json`).other}`);
    check(/bars: current/.test(p.shot(['status']).out), 'not current after the make');
    rmSync(at('meta/deep/notes.txt'));
    check(/stale: its frames aren't all there/.test(p.shot(['status']).out), 'a file gone from a folder of the version should read as stale');
  } finally { p.done(); }
});

test('a name of the script\'s own in another case, a folder named like one, or two names that differ only by case stop the make', () => {
  const p = project();
  try {
    for (const [other, says] of [['CONTACT.JPG', /wrote CONTACT\.JPG, a name this script keeps/], ['Made.json', /wrote Made\.json, a name this script keeps/], ['Full/', /wrote Full, a name this script keeps/]] as [string, RegExp][]) {
      const r = p.shot(['make'], { OTHER: other });
      check(r.code === 1 && says.test(r.out), `${other}: ${r.out}`);
      check(!existsSync(path.join(p.root, 'footage/bars')), `${other}: something was published`);
    }
    // (two files whose names differ only by case exist only where the file system tells them apart)
    writeFileSync(path.join(p.root, 'case'), 'x');
    if (!existsSync(path.join(p.root, 'CASE'))) {
      const r = p.shot(['make'], { OTHER: 'Camera.json,camera.json' });
      check(r.code === 1 && /names that differ only by the case/.test(r.out), `two names one case apart: ${r.out}`);
      const d = p.shot(['make'], { OTHER: 'Meta/,Meta/a.json,meta/,meta/b.json' });
      check(d.code === 1 && /wrote Meta and meta, names that differ only by the case/.test(d.out), `two folders one case apart: ${d.out}`);
    }
    check(p.shot(['make'], { OTHER: 'meta/,meta/a.json,meta/b.json,Camera.json' }).code === 0, 'names that don\'t collide were refused');
  } finally { p.done(); }
});

test('a copy of a version cut short (<version>.partial) is removed by clean and by the next make when its record says it is this script\'s', () => {
  const p = project();
  try {
    const folder = path.join(p.root, 'footage/bars');
    const partial = (name: string, record: object | null, file = true) => {
      mkdirSync(path.join(folder, `${name}.partial`, 'full'), { recursive: true });
      if (record) writeFileSync(path.join(folder, `${name}.partial`, 'made.json'), JSON.stringify(record));
      if (file) writeFileSync(path.join(folder, `${name}.partial`, 'full', '000001.jpg'), 'x'); else rmSync(path.join(folder, `${name}.partial`, 'full'), { recursive: true });
    };
    const mine = (name: string) => ({ 'shot.ts': 1, shot: 'bars', dir: name });
    // before any make, with no manifest: only the copies go
    partial('g1-0000aaaa', mine('g1-0000aaaa'));
    const first = p.shot(['clean']);
    check(first.code === 0 && /removed g1-0000aaaa\.partial/.test(first.out) && !existsSync(path.join(folder, 'g1-0000aaaa.partial')), `clean with no manifest: ${first.out}`);
    check(p.shot(['make']).code === 0, 'make failed');
    const g = p.json('footage/bars/manifest.json').dir;
    partial('g7-deadbeef', mine('g7-deadbeef'));
    partial('g8-deadbeef', null);
    partial('g9-deadbeef', null, false);
    partial('g10-deadbeef', { 'shot.ts': 1, shot: 'another', dir: 'g10-deadbeef' });
    const c = p.shot(['clean']);
    check(c.code === 0 && /g7-deadbeef\.partial/.test(c.out), `clean: ${c.out}`);
    const left = () => readdirSync(folder).filter((d) => d.endsWith('.partial')).sort().join();
    check(left() === 'g10-deadbeef.partial,g8-deadbeef.partial', `after clean: ${left()} (one without a record, one with another shot's: kept; an empty one and this script's: removed)`);
    check(existsSync(path.join(folder, g, 'full', '000001.jpg')) && /bars: current/.test(p.shot(['status']).out), 'clean touched the version on screen');
    partial('g7-deadbeef', mine('g7-deadbeef'));
    writeFileSync(path.join(p.root, 'shots/bars/draw.ts'), PROGRAM + '\n// changed\n');
    check(p.shot(['make']).code === 0, 'make 2 failed');
    check(left() === 'g10-deadbeef.partial,g8-deadbeef.partial', `after the next make: ${left()}`);
    check(/^g2-/.test(p.json('footage/bars/manifest.json').dir) && /bars: current/.test(p.shot(['status']).out), `the next version: ${p.json('footage/bars/manifest.json').dir}`);
  } finally { p.done(); }
});

test('a version that won\'t move into footage/ is copied in and renamed, its scratch left and said; a copy that fails is removed and the shot is as it was', async () => {
  if (process.platform !== 'win32') return; // (an open file keeps its folder from moving only on Windows; elsewhere it takes a second volume)
  // (a PowerShell that opens the new version's last frame as soon as it is encoded, in the staging folder, and holds
  // it: shared for reading, the folder can't be renamed but can be copied; shared with nobody, it can't be copied either)
  for (const share of ['Read', 'None']) {
    const p = project();
    try {
      check(p.shot(['make']).code === 0, 'make 1 failed');
      const g1 = p.json('footage/bars/manifest.json').dir;
      writeFileSync(path.join(p.root, 'shots/bars/draw.ts'), PROGRAM + '\n// 2\n');
      const staged = path.join(p.root, '.audara-cache', 'shots', 'bars', '*', 'pub', 'full', '000012.jpg').replace(/'/g, "''");
      const holder = Bun.spawn(['powershell', '-NoProfile', '-Command',
        `while (-not (Test-Path '${staged}')) { Start-Sleep -Milliseconds 20 }; $p = (Resolve-Path '${staged}' | Select-Object -First 1).Path; $f = $null; ` +
        `while (-not $f) { try { $f = [IO.File]::Open($p, 'Open', 'Read', '${share}') } catch { Start-Sleep -Milliseconds 20 } }; Start-Sleep -Seconds 40; $f.Close()`], { stdout: 'ignore', stderr: 'ignore' });
      Bun.sleepSync(1500);
      let r: ReturnType<typeof p.shot>;
      try { r = p.shot(['make']); } finally { holder.kill(); await holder.exited; }
      const partial = readdirSync(path.join(p.root, 'footage/bars')).filter((d) => d.endsWith('.partial'));
      check(!partial.length, `held shared with ${share}: ${partial.join(', ')} left in footage/bars (${r.out})`);
      const dir = p.json('footage/bars/manifest.json').dir;
      if (share === 'Read') {
        check(r.code === 0 && dir.startsWith('g2-') && p.json(`footage/bars/${dir}/made.json`).dir === dir, `copied in and renamed: ${r.code} ${dir} ${r.out}`);
        check(readdirSync(path.join(p.root, 'footage/bars', dir, 'full')).length === 12 && /bars: current/.test(p.shot(['status']).out), 'the version copied in isn\'t whole');
        check(/\.audara-cache\/shots\/bars\/g2-[0-9a-f]{8}\/ couldn't be removed/.test(r.out), `a scratch folder held open is said, and the make still succeeds: ${r.out}`);
      } else {
        check(r.code === 1 && /couldn't be put in footage\/bars\//.test(r.out) && /the shot is as it was/.test(r.out), `a copy that fails: ${r.code} ${r.out}`);
        check(dir === g1 && p.versions().join() === g1 && existsSync(path.join(p.root, 'footage/bars', g1, 'full', '000012.jpg')), `the shot isn't as it was: ${dir}, ${p.versions().join(', ')}`);
      }
    } finally { p.done(); }
  }
});

test('make says so when the project\'s render.ts is older than the check a --jobs render makes; not when it has it or there is none', () => {
  const p = project();
  try {
    const note = /scripts\/render\.ts is older than this script/;
    const none = p.shot(['make']);
    check(none.code === 0 && !note.test(none.out), `no render.ts: ${none.out}`);
    writeFileSync(path.join(p.root, 'scripts/render.ts'), '// a render.ts from before 0.17.0\n');
    const old = p.shot(['make', '--force']);
    check(old.code === 0 && note.test(old.out) && /--jobs/.test(old.out), `an older render.ts: ${old.out}`);
    cpSync(path.join(TEMPLATE, 'scripts/render.ts'), path.join(p.root, 'scripts/render.ts'));
    const now = p.shot(['make', '--force']);
    check(now.code === 0 && !note.test(now.out), `the template's render.ts: ${now.out}`);
  } finally { p.done(); }
});

let passed = 0;
for (const [name, run] of cases) {
  try { await run(); passed++; console.log('PASS ' + name); }
  catch (e) { console.log('FAIL ' + name + ': ' + (e as Error).message); }
}
console.log(`${passed}/${cases.length} checks passed`);
process.exitCode = passed === cases.length ? 0 : 1;
