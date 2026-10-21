#!/usr/bin/env bun
// Offline render regressions: bun evals/tests/test_render_inputs.ts
// Exercise the template's actual helpers without starting Chrome, Vite or ffmpeg.
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const renderer = path.resolve(import.meta.dir, '../../skills/code-video/assets/template-webgl/scripts/render.ts');
const source = readFileSync(renderer, 'utf8');
function declaration(start: string, end: string): string {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error(`render.ts helper not found: ${start}`);
  return source.slice(a, b + end.length);
}
const seconds = source.match(/^const PIECE_SECONDS = [^\n]+/m)?.[0];
if (!seconds) throw new Error('render.ts PIECE_SECONDS not found');
const helperSource = [
  declaration('const samePath = ', '\n};'),
  seconds,
  declaration('function planPieces(', '\n}'),
  declaration('function inputsFingerprint(', '\n}'),
].join('\n');
const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(helperSource);
type Piece = [number, number];
type Helpers = {
  inputsFingerprint(browser: string, skip: string[]): string;
  planPieces(from: number, to: number, fps: number, cuts: number[], stateful: Piece[], shutter: number): Piece[];
};
const makeHelpers = new Function('path', 'existsSync', 'lstatSync', 'readdirSync', 'PROJECT', 'Bun', 'process',
  `${compiled}\nreturn { inputsFingerprint, planPieces };`) as (...args: unknown[]) => Helpers;
const tempRoot = realpathSync(os.tmpdir());
const scratch = mkdtempSync(path.join(tempRoot, 'audara-render-inputs-test-'));
const helpers = makeHelpers(path, existsSync, lstatSync, readdirSync, scratch, Bun,
  { platform: process.platform, env: { CHROME_FLAGS: '' } });
const out = path.join(scratch, 'videos', 'one', 'final.mp4');
const skipped = [out, `${out}.part`, `${out}.pieces`];
const fingerprint = () => helpers.inputsFingerprint('fixture-chrome', skipped);
function write(name: string, text: string) {
  const file = path.join(scratch, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}
function edit(name: string) {
  const file = path.join(scratch, name);
  writeFileSync(file, readFileSync(file, 'utf8') + '\nchanged');
}
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const cases: [string, () => void][] = [];
const test = (name: string, run: () => void) => cases.push([name, run]);
function plan(cuts: number[], scenes: Piece[], shutter = 0.2, end = 960) {
  const pieces = helpers.planPieces(0, end, 60, cuts, scenes, shutter);
  check(pieces.length > 0 && pieces[0]![0] === 0 && pieces.at(-1)![1] === end, 'range not covered');
  for (let i = 0; i < pieces.length; i++) {
    check(pieces[i]![1] > pieces[i]![0], 'empty or reversed piece');
    if (i) check(pieces[i - 1]![1] === pieces[i]![0], 'gap or duplicate frames');
  }
  return pieces;
}
function together(pieces: Piece[], first: number, last: number) {
  check(pieces.some(([a, b]) => a <= first && b > last), `stateful frames ${first}-${last} split: ${JSON.stringify(pieces)}`);
}

test('unchanged inputs keep the same fingerprint', () => {
  check(fingerprint() === fingerprint(), 'fingerprint changed without an input edit');
});
for (const name of ['tsconfig.json', 'tsconfig.scripts.json', 'tsconfig.base.json', 'bun.lockb']) {
  test(`${name} edit invalidates resume`, () => {
    const before = fingerprint();
    edit(name);
    check(fingerprint() !== before, 'edited input was ignored');
  });
}
test('scene and other-video source edits invalidate resume', () => {
  for (const name of ['src/look.ts', 'videos/two/scenes/shared.ts']) {
    const before = fingerprint();
    edit(name);
    check(fingerprint() !== before, `${name} was ignored`);
  }
});
test('video notes and its YouTube package stay excluded', () => {
  const before = fingerprint();
  edit('videos/one/TREATMENT.md');
  edit('videos/one/CRITIQUE.md');
  edit('videos/one/youtube/thumbnail.png');
  check(fingerprint() === before, 'notes or YouTube edits invalidated resume');
});
test('source Markdown and a nested youtube folder remain inputs', () => {
  for (const name of ['src/plate.md', 'videos/one/assets/youtube/plate.png']) {
    const before = fingerprint();
    edit(name);
    check(fingerprint() !== before, `${name} was incorrectly excluded`);
  }
});
test('actual output, partial file and pieces inside a video stay excluded', () => {
  const before = fingerprint();
  write('videos/one/final.mp4', 'delivery');
  write('videos/one/final.mp4.part', 'partial');
  write('videos/one/final.mp4.pieces/run.json', '{}');
  write('videos/one/final.mp4.pieces/0000000-0000240.mp4', 'piece');
  check(fingerprint() === before, 'render counted its own output as an input');
});
test('a similarly named source beside the output remains an input', () => {
  const before = fingerprint();
  write('videos/one/final.mp4.source', 'source');
  check(fingerprint() !== before, 'output exclusion also hid another source');
});
test('a leading exposure at 4.001 s stays with the stateful stretch', () => {
  // At 60 fps/shutter .2, frame 240 reaches the entry before its centre does.
  together(plan([], [[4.001, 10]]), 240, 600);
});
test('zero shutter preserves exact frame boundaries', () => {
  const pieces = plan([], [[4, 10]], 0);
  check(pieces.some(([a, b]) => a === 240 && b === 600), 'zero-shutter stateful span grew beyond its frames');
});
test('hard cuts keep the exact guarded boundaries', () => {
  const pieces = plan([4.001, 10], [[4.001, 10]]);
  check(pieces.some(([a, b]) => a === 241 && b === 600), 'hard-cut stateful span gained an unneeded exposure frame');
});
test('a trailing exposure remains in its stateful piece', () => {
  together(plan([], [[0, 4.001]]), 0, 240);
});
test('overlapping stateful stretches stay together', () => {
  together(plan([], [[0, 10], [8, 17]], 0.2, 1200), 0, 1020);
});
test('touching stateful stretches can split at a hard cut', () => {
  const pieces = plan([4, 8], [[0, 4], [4, 8]]);
  check(pieces.some(([, b]) => b === 240), 'touching hard-cut scenes were unnecessarily merged');
});

let passed = 0;
try {
  for (const name of [
    'src/look.ts', 'src/plate.md', 'videos/one/TREATMENT.md', 'videos/one/CRITIQUE.md',
    'videos/one/youtube/thumbnail.png', 'videos/one/assets/youtube/plate.png', 'videos/two/scenes/shared.ts',
    'tsconfig.json', 'tsconfig.scripts.json', 'tsconfig.base.json', 'bun.lockb',
  ]) write(name, 'fixture');
  for (const [name, run] of cases) {
    try { run(); passed++; console.log('PASS ' + name); }
    catch (e) { console.log('FAIL ' + name + ': ' + (e as Error).message); }
  }
} finally {
  const target = realpathSync(scratch);
  if (path.dirname(target) !== tempRoot || !path.basename(target).startsWith('audara-render-inputs-test-'))
    throw new Error('refusing to remove a scratch folder outside the test temp directory');
  rmSync(target, { recursive: true, force: true });
}
console.log(`${passed}/${cases.length} checks passed`);
process.exitCode = passed === cases.length ? 0 : 1;
