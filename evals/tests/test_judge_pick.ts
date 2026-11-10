#!/usr/bin/env bun
// The comparison tools, offline: bun evals/tests/test_judge_pick.ts
// judge.ts --dry (which video it takes from a run, the packets and their marks, what it refuses) and pick.ts
// (the director's page), on two one-second test videos made with ffmpeg. No judge is started: no model call.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
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

/** A command's exit code and everything it printed. */
function call(cmd: string[], env?: Record<string, string | undefined>) {
  const p = Bun.spawnSync(cmd, { cwd: REPO, env: env ?? process.env, stdout: 'pipe', stderr: 'pipe' });
  return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
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
/** A task run's folder: its request, turn by turn, and videos in its project, the later listed the newer. */
function run(name: string, turns: string[], files: Record<string, string>) {
  const dir = path.join(scratch, name);
  mkdirSync(path.join(dir, 'work'), { recursive: true });
  writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ turns: turns.map((prompt) => ({ prompt })) }));
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
const TURNS = ['make a short video', 'Go ahead.'];
let A = '', B = '', OUT = '';

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
  for (const f of ['p0/X/video.mp4', 'p0/Y/video.mp4', 'p1/X/video.mp4', 'p1/Y/video.mp4', 'p0/X/sheet-01.png', 'p0.mark', 'p1.mark', 'request.json'])
    check(existsSync(path.join(OUT, f)), `${f} is missing`);
  check(JSON.stringify(JSON.parse(readFileSync(path.join(OUT, 'request.json'), 'utf8'))) === JSON.stringify(TURNS), 'request.json is not the request, turn by turn');
  check(!existsSync(path.join(OUT, 'verdict.json')), 'a --dry wrote a verdict');
  // (nothing a judge can read where it works names a run)
  check(!/j-out|run-a|run-b/.test(readFileSync(path.join(OUT, 'p0.mark'), 'utf8')), 'the mark names a folder');
});
test('a second call uses the packets again', () => {
  const before = statSync(path.join(OUT, 'p0/X/video.mp4')).mtimeMs, mark = readFileSync(path.join(OUT, 'p1.mark'), 'utf8');
  const r = judge('--a', A, '--b', B, '--dry', '--out', OUT);
  check(r.code === 0, r.out);
  check(statSync(path.join(OUT, 'p0/X/video.mp4')).mtimeMs === before && readFileSync(path.join(OUT, 'p1.mark'), 'utf8') === mark, 'the packets were built again');
});
test('a packet cut short is built again', () => {
  writeFileSync(path.join(OUT, 'p1.mark'), 'building');
  rmSync(path.join(OUT, 'p1/Y/video.mp4'));
  const r = judge('--a', A, '--b', B, '--dry', '--out', OUT);
  check(r.code === 0 && existsSync(path.join(OUT, 'p1/Y/video.mp4')) && readFileSync(path.join(OUT, 'p1.mark'), 'utf8') !== 'building', r.out);
});
test("a p0 folder the tool didn't make is refused and left as it is", () => {
  const out = path.join(scratch, 'j-other');
  mkdirSync(path.join(out, 'p0'), { recursive: true });
  writeFileSync(path.join(out, 'p0/notes.txt'), 'keep');
  const r = judge('--a', A, '--b', B, '--dry', '--out', out);
  check(r.code !== 0 && r.out.includes('did not make it'), r.out);
  check(readFileSync(path.join(out, 'p0/notes.txt'), 'utf8') === 'keep', 'the folder was touched');
});
test('a video inside a packet folder is refused, whatever the case its path is typed in', () => {
  const inside = path.join(OUT, 'p0/X/video.mp4');
  const typed = process.platform === 'win32' ? inside.toUpperCase() : inside;
  const r = judge('--a', A, '--b', B, '--a-video', typed, '--dry', '--out', OUT);
  check(r.code !== 0 && r.out.includes('is inside'), r.out);
  check(existsSync(inside), 'the video was removed');
});
test('two runs told different things at a later turn are refused', () => {
  const other = run('run-c', [TURNS[0]!, 'Make it red.'], { 'final.mp4': path.join(scratch, 'two.mp4') });
  const r = judge('--a', A, '--b', other, '--dry', '--out', path.join(scratch, 'j-asked'));
  check(r.code !== 0 && r.out.includes('turn 2') && r.out.includes('Make it red.'), r.out);
  check(!existsSync(path.join(scratch, 'j-asked', 'p0')), 'packets were built for two requests');
});

/** pick.ts on one judged or unjudged folder: its page, its key and the storage key the page keeps picks under. */
function page(name: string, pair: Record<string, unknown>) {
  const out = path.join(scratch, name), cfg = path.join(scratch, `${name}.json`);
  writeFileSync(cfg, JSON.stringify({ out, pairs: [{ dir: OUT, title: 'A pair', a: 'run a', b: 'run b', ...pair }] }));
  const r = call([process.execPath, PICK, cfg]);
  if (r.code !== 0) throw new Error(r.out);
  const html = readFileSync(path.join(out, 'index.html'), 'utf8');
  const reveal = JSON.parse(Buffer.from(/data-key="([^"]+)"/.exec(html)![1]!, 'base64').toString('utf8'));
  return { html, reveal, key: JSON.parse(readFileSync(path.join(out, 'key.json'), 'utf8'))[0], store: /const PAGE = "([^"]+)"/.exec(html)![1]! };
}
test('the page of packets no judge has voted on shows every turn of the request', () => {
  const p = page('page-dry', {});
  for (const t of TURNS) check(p.html.includes(t), `the page lacks "${t}"`);
  check(!p.html.includes('(not recorded)') && p.reveal.tally === null, 'the page has no request, or a tally nobody gave');
});
test('a page built again keeps its order, and one whose X and Y changed places keeps no earlier pick', () => {
  const first = page('page-order', {}), again = page('page-order', {});
  check(first.key.packet === again.key.packet && first.store === again.store, 'the order changed on a rebuild');
  const zero = page('page-zero', { packet: 0 }), one = page('page-one', { packet: 1 });
  check(zero.store !== one.store, 'picks are kept under one key whichever video is X');
  check(zero.html.includes('p0/X/video.mp4') && one.html.includes('p1/X/video.mp4'), 'the packet asked for was not shown');
});
test('a folder that holds a judging: its packets stay, and the page turns the judges to its own letters', () => {
  // (a judge that saw run a as Y, and preferred it)
  writeFileSync(path.join(OUT, 'verdict.json'), JSON.stringify({
    request: TURNS, a: { run: 'run-a' }, b: { run: 'run-b' }, judge: { model: 'a-model' }, tally: { a: 1, b: 0, tie: 0, none: 0 },
    votes: [{ judge: 1, better: 'a', margin: 'clear', why: 'Y holds together; X does not.', seen: { X: 'b', Y: 'a' }, a: { best: 'Y at 0.5 s', worst: 'none' }, b: { best: 'X at 0.2 s', worst: 'X at 0.9 s' } }],
  }));
  const mark = readFileSync(path.join(OUT, 'p0.mark'), 'utf8');
  check(judge('--a', A, '--b', B, '--dry', '--out', OUT).code === 0, 'a --dry of the same videos was refused');
  const swapped = judge('--a', B, '--b', A, '--dry', '--out', OUT);
  check(swapped.code !== 0 && swapped.out.includes('holds a judging') && readFileSync(path.join(OUT, 'p0.mark'), 'utf8') === mark, `other videos went under the verdict: ${swapped.out}`);
  // (a judging there is refused before any judge starts; PATH is cut down so that, were it not, no model is called)
  const bare = [...new Set(['ffmpeg', 'ffprobe'].map((n) => path.dirname(Bun.which(n) ?? '')).concat(path.dirname(process.execPath)))].join(path.delimiter);
  if (Bun.which('claude', { PATH: bare }) === null) {
    const again = call([process.execPath, JUDGE, '--a', A, '--b', B, '--n', '1', '--out', OUT], { ...process.env, PATH: bare, Path: bare });
    check(again.code !== 0 && again.out.includes('already holds a judging'), again.out);
  }
  const asX = page('page-judged-0', { packet: 0 }), asY = page('page-judged-1', { packet: 1 });
  check(asX.reveal.tally.X === 1 && asX.reveal.votes[0].pick === 'X' && asX.reveal.votes[0].why === 'X holds together; Y does not.', JSON.stringify(asX.reveal.votes[0]));
  check(asY.reveal.tally.Y === 1 && asY.reveal.votes[0].pick === 'Y' && asY.reveal.votes[0].why === 'Y holds together; X does not.', JSON.stringify(asY.reveal.votes[0]));
});

let passed = 0;
try {
  const one = video('one.mp4', 'testsrc'), two = video('two.mp4', 'testsrc2');
  // (a: the delivery, then a check rendered after it; b: a finished file outside out/, a clip inside)
  A = run('run-a', TURNS, { 'out/v/v.mp4': one, 'out/v/motion-check.mp4': two });
  B = run('run-b', TURNS, { 'final.mp4': two, 'out/v/v-preview.mp4': one });
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
