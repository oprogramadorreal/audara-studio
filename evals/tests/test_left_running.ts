#!/usr/bin/env bun
// What an eval run leaves running is stopped by its folder, and nothing else is (evals/harness/left-running.ts):
//   bun evals/tests/test_left_running.ts
// Starts four small node processes in a throwaway folder of the system's temp folder: a dev server started from
// the run's folder by a relative path (its command line names no folder; it answers /__audara with the folder,
// as a preview does, on a port of its own), a process whose command line names the run's folder, and the same two
// for a sibling folder whose name starts alike. Only the first two may be stopped.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { names, stopLeftRunning, within } from '../harness/left-running';

let passed = 0, failed = 0;
async function check(name: string, fn: () => unknown) {
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n  ${(e as Error).message.split('\n').join('\n  ')}`); }
}

const node = Bun.which('node');
if (!node) { console.log('SKIP node is not on the PATH (the previews a run leaves are node processes)'); process.exit(0); }

const tmp = mkdtempSync(path.join(os.tmpdir(), 'audara left running '));
const run = path.join(tmp, 'dl-1-0'), sibling = path.join(tmp, 'dl-1-01');
const SERVER = `
const http = require('node:http');
const root = process.cwd().split(require('node:path').sep).join('/');
const s = http.createServer((q, r) => {
  if (q.url === '/__audara') { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ root, pid: process.pid })); }
  else { r.statusCode = 404; r.end(); }
});
s.listen(0, '127.0.0.1', () => console.log(s.address().port));
`;
for (const d of [run, sibling]) { mkdirSync(d, { recursive: true }); writeFileSync(path.join(d, 'server.js'), SERVER); }

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
const started: number[] = [];
/** A dev server started from `dir` by a relative path: once it listens, its process and port. */
async function server(dir: string) {
  const p = Bun.spawn([node!, 'server.js'], { cwd: dir, stdout: 'pipe', stderr: 'ignore', stdin: 'ignore' });
  started.push(p.pid);
  const reader = (p.stdout as ReadableStream<Uint8Array>).getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  const port = Number(new TextDecoder().decode(value).trim());
  assert(port > 0, `the test's server in ${dir} did not say its port`);
  return { pid: p.pid, port };
}
/** A process that serves nothing, whose command line names a file in `dir`. */
function named(dir: string) {
  const p = Bun.spawn([node!, '-e', 'setInterval(() => {}, 1000)', path.join(dir, 'marker')], { stdout: 'ignore', stderr: 'ignore', stdin: 'ignore' });
  started.push(p.pid);
  return p.pid;
}

try {
  await check('a path is inside a folder or not, a sibling whose name starts alike is not', () => {
    assert(within(run, run) && within(run, path.join(run, 'videos', 'a')), 'the folder and what it holds');
    assert(within(run, run.split(path.sep).join('/')), 'spelled with /, as a preview answers');
    assert(!within(run, sibling) && !within(run, tmp), 'a sibling, and the folder above');
    if (process.platform === 'win32') assert(within(run.toUpperCase(), run.toLowerCase()), 'whatever the case, where the file system ignores it');
  });
  await check('a command line names a folder by a path in it, quoted or not, never by a longer name', () => {
    assert(names(`node ${path.join(run, 'node_modules', 'vite', 'bin', 'vite.js')}`, run), 'a file inside');
    assert(names(`"node" "${run}"`, run) && names(`codex exec -C ${run}`, run), 'the folder itself, quoted and last');
    assert(!names(`node ${path.join(sibling, 'x.js')}`, run), 'a sibling whose name starts alike');
    assert(!names('node node_modules/vite/bin/vite.js --port 5240 --strictPort', run), 'a relative path names no folder');
  });

  const mine = await server(run), mineNamed = named(run);
  const theirs = await server(sibling), theirsNamed = named(sibling);
  await Bun.sleep(300);
  let stopped: Awaited<ReturnType<typeof stopLeftRunning>> = [];
  await check('what the run left is stopped: a server found by the folder it serves, and a process by its command line', async () => {
    assert(alive(mine.pid) && alive(mineNamed) && alive(theirs.pid) && alive(theirsNamed), 'all four started');
    stopped = await stopLeftRunning(run);
    await Bun.sleep(500);
    assert(!alive(mine.pid), `the server started from the run's folder by a relative path (port ${mine.port}) still runs`);
    assert(!alive(mineNamed), 'the process whose command line names the run\'s folder still runs');
    assert(stopped.some((s) => s.pid === mine.pid && s.why.includes(String(mine.port))), `the server isn't in what it reports: ${JSON.stringify(stopped)}`);
  });
  await check('nothing else is: a sibling folder\'s server and process go on, and so does this process', () => {
    assert(alive(theirs.pid), 'the sibling folder\'s server was stopped');
    assert(alive(theirsNamed), 'the process naming the sibling folder was stopped');
    assert.deepEqual(stopped.map((s) => s.pid).sort(), [mine.pid, mineNamed].sort(), 'it stopped something else');
  });
  await check('a folder nothing runs from stops nothing', async () => {
    assert.deepEqual(await stopLeftRunning(path.join(tmp, 'nobody')), []);
    assert(alive(theirs.pid) && alive(theirsNamed));
  });
} finally {
  for (const pid of started) try { process.kill(pid); } catch { /* stopped already */ }
  await Bun.sleep(200);
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
}

console.log(`${passed}/${passed + failed} checks passed`);
process.exit(failed ? 1 : 0);
