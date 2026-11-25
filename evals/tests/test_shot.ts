#!/usr/bin/env bun
// Offline checks of the template's scripts/shot.ts (shots made by a program): bun evals/tests/test_shot.ts
// Each check makes a throwaway project (in a folder whose path has a space) holding the template's shot.ts,
// footage.ts and vite.config.ts, and a recipe whose program is a small bun script writing BMP frames; needs
// ffmpeg and ffprobe on the PATH, as shot.ts does. No browser, no network, nothing spent.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
import { writeFileSync, appendFileSync } from 'node:fs';
const e = process.env;
const [out, first, last, w, h, fps] = process.argv.slice(2);
const W = +(e.FORCE_W ?? w), H = +h, F = +fps;
if (e.LOG) appendFileSync(e.LOG, JSON.stringify({ first: +first, last: +last, env: { out: e.AUDARA_SHOT_OUT, first: e.AUDARA_SHOT_FIRST, last: e.AUDARA_SHOT_LAST, frames: e.AUDARA_SHOT_FRAMES, fps: e.AUDARA_SHOT_FPS, width: e.AUDARA_SHOT_WIDTH, height: e.AUDARA_SHOT_HEIGHT, scale: e.AUDARA_SHOT_SCALE, tmp: e.AUDARA_SHOT_TMP, name: e.AUDARA_SHOT_NAME } }) + '\n');
if (e.FAIL) process.exit(3);
if (e.SIDE) writeFileSync(out + '/events.json', '{"jump": [3]}');
if (e.TOUCH) writeFileSync(e.TOUCH, String(Date.now()));
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
  writeFileSync(out + '/' + String(k).padStart(6, '0') + '.bmp', px);
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
  const done = () => rmSync(root, { recursive: true, force: true });
  return { root, shot, json, versions, done };
}

test('status, make, then current: a version folder of full frames and proxies, made.json, and the manifest naming it last', () => {
  const p = project();
  try {
    check(/bars: not made yet/.test(p.shot(['status']).out), 'status before a make');
    const m = p.shot(['make']);
    check(m.code === 0, `make failed: ${m.out}`);
    const man = p.json('footage/bars/manifest.json'), made = p.json('footage/bars/made.json');
    check(man.frames === 12 && man.fps === 30 && man.size.join('x') === '64x36' && man.proxy.join('x') === '32x18', `manifest ${JSON.stringify(man)}`);
    check(/^g1-[0-9a-f]{8}$/.test(man.dir) && made.dir === man.dir && made.hashes.length === 12, `dir ${man.dir}, made ${made.dir}, ${made.hashes?.length} hashes`);
    const full = readdirSync(path.join(p.root, 'footage/bars', man.dir, 'full')), proxy = readdirSync(path.join(p.root, 'footage/bars', man.dir, 'proxy'));
    check(full.length === 12 && full[0] === '000001.jpg' && full[11] === '000012.jpg' && proxy.length === 12, `full ${full.length}, proxy ${proxy.length}`);
    check(existsSync(path.join(p.root, 'footage/bars/contact.jpg')), 'no contact sheet');
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
    check(p.shot(['make']).code === 0, 'make failed');
    const ok = p.shot(['check', 'bars']);
    check(ok.code === 0 && /match the shot pixel for pixel/.test(ok.out), `check: ${ok.out}`);
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
    check(/stale: its scale changed/.test(p.shot(['make', '--scale', '1']).out) || p.json('footage/bars/made.json').scale === 1, 'back to 1');
  } finally { p.done(); }
});

test('the recipe\'s own manifest fields changed alone rewrite the manifest, not the frames; the program\'s other files are published', () => {
  const p = project();
  try {
    check(p.shot(['make'], { SIDE: '1' }).code === 0, 'make failed');
    check(JSON.parse(readFileSync(path.join(p.root, 'footage/bars/events.json'), 'utf8')).jump[0] === 3, 'events.json not published');
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
    writeFileSync(engine, src.replace(/\bm\.dir\b/g, 'm.other'));
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

let passed = 0;
for (const [name, run] of cases) {
  try { await run(); passed++; console.log('PASS ' + name); }
  catch (e) { console.log('FAIL ' + name + ': ' + (e as Error).message); }
}
console.log(`${passed}/${cases.length} checks passed`);
process.exitCode = passed === cases.length ? 0 : 1;
