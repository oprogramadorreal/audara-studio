#!/usr/bin/env bun
// Offline checks of the renderer's encoder/socket failure boundary and ffprobe preflight:
//   bun evals/tests/test_render_failures.ts
// Executes the actual functions from render.ts with controllable in-memory peers. No Chrome,
// ffmpeg, output files or network sockets are needed; a watchdog bounds regressions that hang.
import assert from 'node:assert/strict';
import path from 'node:path';

const source = await Bun.file(path.resolve(import.meta.dir, '../../skills/code-video/assets/template-webgl/scripts/render.ts')).text();
const transpiler = new Bun.Transpiler({ loader: 'ts' });
function extract(start: string, end: string) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert(a >= 0 && b > a, `renderer extraction markers changed: ${start}`);
  return transpiler.transformSync(source.slice(a, b));
}
const encodeJS = extract('async function encodeFrames(', '\n/** About how long a piece');
const checkJS = extract('function checkFfmpeg(', '\n/** x264');
const piecesJS = extract('async function videoInPieces(', '\n/** Browsers a --jobs run');
class Fail extends Error {}
const fail = (message: string): never => { throw new Fail(message); };
const makeEncode = new Function('Bun', 'x264', 'soundArgs', 'SAMPLES', 'SHUTTER', 'discard', 'fail', 'Fail', `${encodeJS}\nreturn encodeFrames;`);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Result = { kind: 'success'; value: unknown } | { kind: 'failure'; error: Error } | { kind: 'timeout' };
async function bounded(task: Promise<unknown>, ms = 500): Promise<Result> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      task.then((value): Result => ({ kind: 'success', value }), (error): Result => ({ kind: 'failure', error })),
      new Promise<Result>((r) => { timer = setTimeout(() => r({ kind: 'timeout' }), ms); }),
    ]);
  } finally { clearTimeout(timer!); }
}

type Scenario = 'success' | 'successful early exit' | 'early nonzero exit' | 'early zero exit'
  | 'write throws' | 'flush rejects' | 'drain rejects' | 'callbacks after abort';

async function encoderCase(scenario: Scenario) {
  const total = 12, releases: (() => void)[] = [], callbackErrors: Error[] = [];
  let acked = 0, reported = 0, writes = 0, flushes = 0;
  let pageClosed = false, stopped = false, discarded = false, killed = false, streamReturned = false;
  let code: number | null = null, socketOptions: any;
  let resolveExit!: (n: number) => void;
  const exited = new Promise<number>((r) => { resolveExit = r; });
  const exit = (n: number) => { if (code === null) { code = n; resolveExit(n); } };
  const pending = () => new Promise<void>((r) => releases.push(r));
  const ff = {
    stdin: {
      write(_bytes: Uint8Array) {
        writes++;
        if (scenario === 'write throws') throw new Error('EPIPE on write');
        if (writes === 1 && (scenario === 'early nonzero exit' || scenario === 'early zero exit'))
          queueMicrotask(() => exit(scenario === 'early nonzero exit' ? 17 : 0));
      },
      async flush() {
        const n = ++flushes;
        if (scenario === 'early nonzero exit' || scenario === 'early zero exit') return await pending();
        if (scenario === 'flush rejects') throw new Error('EPIPE on flush');
        if (scenario === 'callbacks after abort') {
          if (n > 1) return await pending();
          await sleep(1);
          throw new Error('EPIPE with other writes in flight');
        }
        if (scenario === 'drain rejects' && n === total) {
          await sleep(25);
          assert(streamReturned, 'drain failure should happen after the producer returns');
          throw new Error('EPIPE while draining');
        }
        if (scenario === 'successful early exit' && n === total) setTimeout(() => exit(0), 0);
      },
      end() { exit(0); },
    },
    get exitCode() { return code; },
    exited,
    kill() { killed = true; exit(137); },
  };
  const mockBun = {
    spawn() { return ff; },
    serve(options: any) { socketOptions = options; return { port: 12345, stop() { stopped = true; } }; },
    sleep,
  };
  const socket = { send(n: string) { acked = +n; } };
  const page = {
    async evaluate(_fn: unknown, _args: unknown) {
      for (let n = 0; n < total; n++) {
        while (n - acked >= 4) {
          if (pageClosed) throw new Error('Target page has been closed');
          await sleep(1);
        }
        if (pageClosed) throw new Error('Target page has been closed');
        // Like Bun, dispatch callbacks independently. A rejection here does not reject
        // the browser's stream; the renderer needs to carry it into the outer operation.
        void Promise.resolve(socketOptions.websocket.message(socket, new Uint8Array(16)))
          .catch((e) => callbackErrors.push(e));
      }
      await sleep(8); // last readback / seam hash can outlive the successful encoder
      if (pageClosed) throw new Error('Target page has been closed');
      streamReturned = true;
      return { 1: total };
    },
    async close() { pageClosed = true; },
    isClosed() { return pageClosed; },
  };
  const encode = makeEncode(mockBun, () => ({ preset: 'test', crf: '16', tune: 'grain', params: '' }),
    () => { throw new Error('this case has no soundtrack'); }, 1, 0.2,
    async () => { discarded = true; }, fail, Fail);
  const task = encode(page, { width: 2, height: 2 }, 0, total, 60, 'unused.part', null, () => { reported++; });
  try {
    const result = await bounded(task);
    assert.notEqual(result.kind, 'timeout', `${scenario}: encoder never settled`);
    const success = scenario === 'success' || scenario === 'successful early exit';
    if (success) {
      assert.equal(result.kind, 'success', result.kind === 'failure' ? result.error.message : scenario);
      assert.deepEqual(result.kind === 'success' ? result.value : null, { 1: total });
      assert.equal(reported, total);
      assert.equal(acked, total);
      assert.equal(pageClosed, false, 'successful page should remain reusable');
      assert.equal(discarded, false);
      assert.equal(killed, false);
    } else {
      assert.equal(result.kind, 'failure');
      assert.match(result.kind === 'failure' ? result.error.message : '', /ffmpeg|encoder|EPIPE|write|flush|exit/i);
      assert.equal(pageClosed, true, 'failed browser producer must be cancelled');
      assert.equal(discarded, true, 'failed encode must discard its partial output');
      assert.notEqual(code, null, 'failed encoder must be reaped');
      const before = { reported, acked };
      for (const release of releases.splice(0)) release();
      await sleep(8);
      assert.deepEqual({ reported, acked }, before, 'in-flight callbacks advanced progress after abort');
    }
    assert.equal(stopped, true, 'socket server must be stopped');
    assert.equal(callbackErrors.length, 0, 'socket callback failures escaped the operation');
  } finally {
    // A broken implementation must fail this check rather than hang the test process.
    await page.close();
    ff.kill();
    for (const release of releases.splice(0)) release();
    await bounded(task, 100);
  }
}

function checkCase(probe: 'missing' | 'broken' | 'working', required: boolean) {
  const calls: string[] = [];
  const mockBun = { spawnSync(args: string[]) {
    calls.push(args[0]!);
    if (args[0] === 'ffmpeg') return { exitCode: 0, stdout: Buffer.from('libx264'), stderr: Buffer.alloc(0) };
    assert.equal(args[0], 'ffprobe');
    if (probe === 'missing') throw new Error('ENOENT: ffprobe');
    return { exitCode: probe === 'broken' ? 1 : 0, stdout: Buffer.from('ffprobe version test'), stderr: Buffer.alloc(0) };
  } };
  const check = new Function('Bun', 'fail', `${checkJS}\nreturn checkFfmpeg;`)(mockBun, fail);
  if (required && probe !== 'working') assert.throws(() => check(true), /ffprobe/i);
  else assert.doesNotThrow(() => check(required));
  assert.deepEqual(calls, required ? ['ffmpeg', 'ffprobe'] : ['ffmpeg']);
}

const cases: [string, () => void | Promise<void>][] = [
  ...(['success', 'successful early exit', 'early nonzero exit', 'early zero exit', 'write throws', 'flush rejects', 'drain rejects', 'callbacks after abort'] as Scenario[])
    .map((name): [string, () => Promise<void>] => [name, () => encoderCase(name)]),
  ['required ffprobe is missing', () => checkCase('missing', true)],
  ['required ffprobe exits with an error', () => checkCase('broken', true)],
  ['required ffprobe works', () => checkCase('working', true)],
  ['serial video does not require ffprobe', () => checkCase('missing', false)],
  ['piece rendering checks ffprobe before doing work', async () => {
    const marker = new Error('probe preflight stopped the run');
    const render = new Function('checkFfmpeg', `${piecesJS}\nreturn videoInPieces;`)((probe: boolean) => {
      assert.equal(probe, true, 'piece rendering did not request ffprobe');
      throw marker;
    });
    await assert.rejects(render(), (e: unknown) => e === marker);
  }],
];

let passed = 0;
for (const [name, run] of cases) {
  try { await run(); passed++; console.log('PASS ' + name); }
  catch (e) { console.log('FAIL ' + name + ': ' + (e as Error).message); }
}
console.log(`${passed}/${cases.length} checks passed`);
process.exitCode = passed === cases.length ? 0 : 1;
