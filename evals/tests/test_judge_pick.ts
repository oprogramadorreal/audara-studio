#!/usr/bin/env bun
// The comparison tools, offline: bun evals/tests/test_judge_pick.ts
// judge.ts --dry (which video it takes from a run, the packets and their marks, what it refuses) and pick.ts
// (the director's page), on two one-second test videos made with ffmpeg. No judge is started and no model is
// called, whatever breaks: every call here finds a stand-in `claude` first on its PATH, so the real one is out
// of reach. Started, the stand-in leaves a file saying so (on Windows it is a .cmd, which Bun won't hand a
// prompt to: the call throws instead), and the last check looks for either trace.
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = path.resolve(import.meta.dir, '../..');
const JUDGE = path.join(REPO, 'evals/harness/judge.ts'), PICK = path.join(REPO, 'evals/harness/pick.ts');
const tempRoot = realpathSync(os.tmpdir());
const scratch = mkdtempSync(path.join(tempRoot, 'audara-judge-pick-test-'));
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const cases: [string, () => void][] = [];
const test = (name: string, run: () => void) => cases.push([name, run]);

// The stand-in for the judge's CLI, ahead of the real one on PATH.
const STUB = path.join(scratch, 'stub'), STARTED = path.join(STUB, 'started');
mkdirSync(STUB);
if (process.platform === 'win32') writeFileSync(path.join(STUB, 'claude.cmd'), '@echo off\r\necho started> "%~dp0started"\r\nexit /b 3\r\n');
else { writeFileSync(path.join(STUB, 'claude'), '#!/bin/sh\necho started > "$(dirname "$0")/started"\nexit 3\n'); chmodSync(path.join(STUB, 'claude'), 0o755); }
const ENV: Record<string, string | undefined> = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== 'path'));
ENV.PATH = [STUB, process.env.PATH ?? process.env.Path ?? ''].join(path.delimiter);

/** A command's exit code and everything it printed (kept: the last check reads all of it). */
const SAID: string[] = [];
function call(cmd: string[]) {
  const p = Bun.spawnSync(cmd, { cwd: REPO, env: ENV, stdout: 'pipe', stderr: 'pipe' });
  const out = p.stdout.toString() + p.stderr.toString();
  SAID.push(out);
  return { code: p.exitCode, out };
}
const judge = (...args: string[]) => call([process.execPath, JUDGE, ...args]);
/** A one-second test video with a tone, the pattern named. */
function video(name: string, pattern: string) {
  const file = path.join(scratch, name);
  const r = call(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', `${pattern}=duration=1:size=320x180:rate=10`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-shortest', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-c:a', 'aac', file]);
  if (r.code !== 0) throw new Error(`ffmpeg could not make ${name}: ${r.out}`);
  return file;
}
/** A task run's folder: its request, turn by turn (null: no result.json), and videos in its project, the later listed the newer. */
function run(name: string, turns: string[] | null, files: Record<string, string>) {
  const dir = path.join(scratch, name);
  mkdirSync(path.join(dir, 'work'), { recursive: true });
  if (turns) writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ turns: turns.map((prompt) => ({ prompt })) }));
  let at = Date.now() / 1000 - 1000;
  for (const [rel, from] of Object.entries(files)) {
    const to = path.join(dir, 'work', rel);
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(from, to);
    utimesSync(to, at, at);
    at += 60;
  }
  return dir;
}
const picked = (out: string, side: 'a' | 'b') => new RegExp(`^${side}: (.+?) \\(`, 'm').exec(out)?.[1]?.replaceAll('\\', '/') ?? '';
const bytes = (file: string) => Bun.hash(readFileSync(file)).toString(36);
const VIDEOS = ['p0/X/video.mp4', 'p0/Y/video.mp4', 'p1/X/video.mp4', 'p1/Y/video.mp4'];
/** What a judging folder holds, to see that a call left it as it was: each packet video's time, the marks, the verdict. */
const state = (out: string) => JSON.stringify([
  ...VIDEOS.map((f) => statSync(path.join(out, f)).mtimeMs),
  ...['p0.mark', 'p1.mark', 'request.json', 'verdict.json'].map((f) => (existsSync(path.join(out, f)) ? readFileSync(path.join(out, f), 'utf8') : null)),
]);
const TURNS = ['make a short video', 'Go ahead.'];
let A = '', B = '', OUT = '', ONE = '', TWO = '';

test("a run's video is its delivery under out/, by its name before a newer render beside it", () => {
  const r = judge('--a', A, '--b', B, '--dry', '--out', path.join(scratch, 'j-named'));
  check(r.code === 0, r.out);
  check(picked(r.out, 'a').endsWith('work/out/v/v.mp4'), `took ${picked(r.out, 'a')}`);
});
test("a clip under out/ doesn't hide a finished video elsewhere in the project", () => {
  const r = judge('--a', A, '--b', B, '--dry', '--out', path.join(scratch, 'j-named'));
  check(picked(r.out, 'b').endsWith('work/final.mp4'), `took ${picked(r.out, 'b')}`);
});
test('--dry builds both orders, their marks and the request, with one judge too, and no verdict', () => {
  const r = judge('--a', A, '--b', B, '--n', '1', '--dry', '--out', OUT);
  check(r.code === 0, r.out);
  for (const f of [...VIDEOS, 'p0/X/sheet-01.png', 'p1/Y/sheet-01.png', 'p0.mark', 'p1.mark', 'request.json']) check(existsSync(path.join(OUT, f)), `${f} is missing`);
  // (packet 0 shows run a as X and packet 1 shows it as Y: the same two videos, changed places)
  const [x0, y0, x1, y1] = VIDEOS.map((f) => bytes(path.join(OUT, f)));
  check(x0 !== y0 && x0 === y1 && y0 === x1, 'the two packets are not the same two videos in opposite orders');
  check(JSON.stringify(JSON.parse(readFileSync(path.join(OUT, 'request.json'), 'utf8'))) === JSON.stringify(TURNS), 'request.json is not the request, turn by turn');
  check(!existsSync(path.join(OUT, 'verdict.json')), 'a --dry wrote a verdict');
  // (nothing a judge can read where it works names a run)
  for (const m of ['p0.mark', 'p1.mark']) check(!/run-|j-out|[\\/]/.test(readFileSync(path.join(OUT, m), 'utf8')), `${m} names a folder`);
});
test('a second call uses the packets again', () => {
  const before = state(OUT);
  const r = judge('--a', A, '--b', B, '--dry', '--out', OUT);
  check(r.code === 0, r.out);
  check(state(OUT) === before, 'a packet was built again, or a mark or the request changed');
});
test('a packet cut short is built again', () => {
  writeFileSync(path.join(OUT, 'p1.mark'), 'building');
  rmSync(path.join(OUT, 'p1/Y/video.mp4'));
  const r = judge('--a', A, '--b', B, '--dry', '--out', OUT);
  check(r.code === 0 && existsSync(path.join(OUT, 'p1/Y/video.mp4')) && readFileSync(path.join(OUT, 'p1.mark'), 'utf8') !== 'building', r.out);
  check(bytes(path.join(OUT, 'p1/Y/video.mp4')) === bytes(path.join(OUT, 'p0/X/video.mp4')), 'the packet built again holds another video');
});
test("a p0 folder the tool didn't make is refused and left as it is", () => {
  const out = path.join(scratch, 'j-other');
  mkdirSync(path.join(out, 'p0'), { recursive: true });
  writeFileSync(path.join(out, 'p0/notes.txt'), 'keep');
  const r = judge('--a', A, '--b', B, '--dry', '--out', out);
  check(r.code !== 0 && r.out.includes('did not make it'), r.out);
  check(readFileSync(path.join(out, 'p0/notes.txt'), 'utf8') === 'keep' && !existsSync(path.join(out, 'p0/X')), 'the folder was touched');
});
test('a video inside a packet folder is refused, whatever the case its path is typed in', () => {
  const inside = path.join(OUT, 'p0/X/video.mp4'), before = state(OUT);
  const typed = process.platform === 'win32' ? inside.toUpperCase() : inside;
  const r = judge('--a', A, '--b', B, '--a-video', typed, '--dry', '--out', OUT);
  check(r.code !== 0 && r.out.includes('is inside'), r.out);
  check(state(OUT) === before, 'the packets changed');
});
test('two runs told different things at a later turn are refused, and so is one with fewer turns', () => {
  const other = run('run-c', [TURNS[0]!, 'Make it red.'], { 'final.mp4': TWO });
  const r = judge('--a', A, '--b', other, '--dry', '--out', path.join(scratch, 'j-asked'));
  check(r.code !== 0 && r.out.includes('turn 2') && r.out.includes('Make it red.'), r.out);
  check(!existsSync(path.join(scratch, 'j-asked', 'p0')), 'packets were built for two requests');
  const short = run('run-d', [TURNS[0]!], { 'final.mp4': TWO });
  const s = judge('--a', A, '--b', short, '--dry', '--out', path.join(scratch, 'j-short'));
  check(s.code !== 0 && s.out.includes('run b stopped after turn 1') && s.out.includes('Go ahead.'), s.out);
  check(!existsSync(path.join(scratch, 'j-short', 'p0')), 'packets were built for a whole run and a stopped one');
});
test("a folder with no result.json takes the other run's request", () => {
  const bare = run('run-e', null, { 'final.mp4': TWO }), out = path.join(scratch, 'j-bare');
  const r = judge('--a', A, '--b', bare, '--dry', '--out', out);
  check(r.code === 0, r.out);
  check(JSON.stringify(JSON.parse(readFileSync(path.join(out, 'request.json'), 'utf8'))) === JSON.stringify(TURNS), 'the request kept is not the one run that has it');
});

/** pick.ts on a config's pairs: its page, each pair's reveal, its key, and the name the page keeps picks under. */
function page(name: string, pairs: Record<string, unknown>[]) {
  const out = path.join(scratch, name), cfg = path.join(scratch, `${name}.json`);
  writeFileSync(cfg, JSON.stringify({ out, pairs: pairs.map((p) => ({ dir: OUT, title: 'A pair', a: 'run a', b: 'run b', ...p })) }));
  const r = call([process.execPath, PICK, cfg]);
  if (r.code !== 0) throw new Error(r.out);
  const html = readFileSync(path.join(out, 'index.html'), 'utf8');
  const reveals = [...html.matchAll(/data-key="([^"]+)"/g)].map((m) => JSON.parse(Buffer.from(m[1]!, 'base64').toString('utf8')));
  type Key = { packet: number; X: { run: string; what: string }; Y: { run: string; what: string } };
  return { html, reveals, key: JSON.parse(readFileSync(path.join(out, 'key.json'), 'utf8')) as Key[], store: /const PAGE = "([^"]+)"/.exec(html)![1]! };
}
test('the page of packets no judge has voted on shows every turn of the request', () => {
  const p = page('page-dry', [{}]);
  for (const t of TURNS) check(p.html.includes(t), `the page lacks "${t}"`);
  check(!p.html.includes('(not recorded)') && p.reveals[0].tally === null && p.reveals[0].votes.length === 0, 'the page has no request, or votes nobody gave');
});
test('a page built again keeps its order, and one whose X and Y changed places keeps no earlier pick', () => {
  // (the first order is drawn: six rebuilds that all agree with it were not six more draws)
  const first = page('page-order', [{}]);
  for (let i = 0; i < 6; i++) {
    const again = page('page-order', [{}]);
    check(first.key[0]!.packet === again.key[0]!.packet && first.store === again.store, `the order changed on rebuild ${i + 1}`);
  }
  const zero = page('page-zero', [{ packet: 0 }]), one = page('page-one', [{ packet: 1 }]);
  check(zero.store !== one.store, 'picks are kept under one name whichever video is X');
  // (key.json is what the director's picks are read against)
  check(zero.key[0]!.X.run === 'a' && zero.key[0]!.X.what === 'run a' && zero.key[0]!.Y.run === 'b', `packet 0's key: ${JSON.stringify(zero.key[0])}`);
  check(one.key[0]!.X.run === 'b' && one.key[0]!.X.what === 'run b' && one.key[0]!.Y.run === 'a', `packet 1's key: ${JSON.stringify(one.key[0])}`);
  check(zero.html.includes('p0/X/video.mp4') && !zero.html.includes('p1/X/video.mp4') && one.html.includes('p1/X/video.mp4') && !one.html.includes('p0/X/video.mp4'), 'the packet asked for was not the one shown');
});
test('one folder listed twice keeps the order of each place on a rebuild', () => {
  const first = page('page-twice', [{ packet: 0 }, { packet: 1 }]), again = page('page-twice', [{}, {}]);
  check(JSON.stringify(again.key.map((k) => k.packet)) === '[0,1]', `rebuilt as ${JSON.stringify(again.key.map((k) => k.packet))}`);
  check(first.store === again.store, 'the picks of an unchanged page were dropped');
});
test('a folder that holds a judging: its packets stay, and the page turns the judges to its own letters', () => {
  // (a judge that saw run a as Y, and preferred it)
  writeFileSync(path.join(OUT, 'verdict.json'), JSON.stringify({
    request: TURNS, a: { run: 'run-a' }, b: { run: 'run-b' }, judge: { model: 'a-model' }, tally: { a: 1, b: 0, tie: 0, none: 0 },
    votes: [{ judge: 1, better: 'a', margin: 'clear', why: 'Y holds together; X does not.', seen: { X: 'b', Y: 'a' }, a: { best: 'Y at 0.5 s', worst: 'none' }, b: { best: 'X at 0.2 s', worst: 'X at 0.9 s' } }],
  }));
  const before = state(OUT);
  check(judge('--a', A, '--b', B, '--dry', '--out', OUT).code === 0 && state(OUT) === before, 'a --dry of the same videos was refused, or changed the folder');
  const swapped = judge('--a', B, '--b', A, '--dry', '--out', OUT);
  check(swapped.code !== 0 && swapped.out.includes('holds a judging') && state(OUT) === before, `other videos went under the verdict: ${swapped.out}`);
  const again = judge('--a', A, '--b', B, '--n', '1', '--out', OUT);
  check(again.code !== 0 && again.out.includes('already holds a judging') && state(OUT) === before, `a second judging was not refused: ${again.out}`);
  // (the verdict's request is the one shown, whatever a request.json beside it says)
  writeFileSync(path.join(OUT, 'request.json'), JSON.stringify(['a stale request']));
  const shown = page('page-judged-0', [{ packet: 0 }]);
  check(shown.html.includes(TURNS[1]!) && !shown.html.includes('a stale request'), "the page shows a request other than the verdict's");
  const asX = shown.reveals[0], asY = page('page-judged-1', [{ packet: 1 }]).reveals[0];
  check(asX.tally.X === 1 && asX.tally.Y === 0 && asX.votes[0].pick === 'X' && asX.votes[0].why === 'X holds together; Y does not.' && asX.votes[0].X.best === 'X at 0.5 s', JSON.stringify(asX.votes[0]));
  check(asY.tally.Y === 1 && asY.tally.X === 0 && asY.votes[0].pick === 'Y' && asY.votes[0].why === 'Y holds together; X does not.' && asY.votes[0].Y.best === 'Y at 0.5 s', JSON.stringify(asY.votes[0]));
});
test('no judge was started by any of the above', () => {
  check(!existsSync(STARTED) && !SAID.some((o) => /cmd.exe special character|ERR_INVALID_ARG_VALUE/.test(o)), 'a call reached the judge CLI: with the real one first on PATH it would have called a model');
});

let passed = 0;
try {
  ONE = video('one.mp4', 'testsrc');
  TWO = video('two.mp4', 'testsrc2');
  // (a: the delivery, then a check rendered after it; b: a finished file outside out/, a clip inside)
  A = run('run-a', TURNS, { 'out/v/v.mp4': ONE, 'out/v/motion-check.mp4': TWO });
  B = run('run-b', TURNS, { 'final.mp4': TWO, 'out/v/v-preview.mp4': ONE });
  OUT = path.join(scratch, 'j-out');
  for (const [name, fn] of cases) {
    try { fn(); passed++; console.log('PASS ' + name); }
    catch (e) { console.log('FAIL ' + name + ': ' + (e as Error).message); }
  }
} finally {
  const target = realpathSync(scratch);
  if (path.dirname(target) !== tempRoot || !path.basename(target).startsWith('audara-judge-pick-test-'))
    throw new Error('refusing to remove a scratch folder outside the test temp directory');
  rmSync(target, { recursive: true, force: true });
}
console.log(`${passed}/${cases.length} checks passed`);
process.exitCode = passed === cases.length ? 0 : 1;
