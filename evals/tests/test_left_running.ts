#!/usr/bin/env bun
// What an eval run leaves running is stopped by its folder, and nothing else is (evals/harness/left-running.ts):
//   bun evals/tests/test_left_running.ts
// Starts small node processes in a throwaway folder of the system's temp folder. The run's own: a dev server
// started from the run's folder by a relative path (its command line names no folder; it answers /__audara with
// the folder and its process, as a preview does, on a port of its own), and a process running a script of the
// folder by its full path. Not the run's, or not known to be: the same server and script for a sibling folder
// whose name starts alike, a process that only names a file of the run's folder (as an editor showing it does),
// a bystander, a server in the run's folder whose answer names the bystander, and one whose answer names no
// process. Only the run's own may be stopped.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { answerer, runsFrom, stopLeftRunning, stopTree, tree, within } from '../harness/left-running';

let passed = 0, failed = 0;
async function check(name: string, fn: () => unknown) {
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n  ${(e as Error).message.split('\n').join('\n  ')}`); }
}

const node = Bun.which('node');
if (!node) { console.log('SKIP node is not on the PATH (the previews a run leaves are node processes)'); process.exit(0); }

const tmp = mkdtempSync(path.join(os.tmpdir(), 'audara left running '));
const run = path.join(tmp, 'dl-1-0'), sibling = path.join(tmp, 'dl-1-01');
// (PID_SAYS: the process its answer names, "none" for an answer without one; its own when unset)
const SERVER = `
const http = require('node:http');
const root = process.cwd().split(require('node:path').sep).join('/');
const says = process.env.PID_SAYS;
const s = http.createServer((q, r) => {
  if (q.url === '/__audara') { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify(says === 'none' ? { root } : { root, pid: says ? Number(says) : process.pid })); }
  else { r.statusCode = 404; r.end(); }
});
s.listen(0, '127.0.0.1', () => console.log(s.address().port));
`;
const IDLE = 'setInterval(() => {}, 1000);\n';
for (const d of [run, sibling]) {
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, 'server.js'), SERVER);
  writeFileSync(path.join(d, 'idle.js'), IDLE);
}

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
const started: number[] = [];
/** A dev server started from `dir` by a relative path: once it listens, its process and port. */
async function server(dir: string, pidSays?: string) {
  const p = Bun.spawn([node!, 'server.js'], { cwd: dir, env: { ...process.env, ...(pidSays ? { PID_SAYS: pidSays } : {}) }, stdout: 'pipe', stderr: 'ignore', stdin: 'ignore' });
  started.push(p.pid);
  const reader = (p.stdout as ReadableStream<Uint8Array>).getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  const port = Number(new TextDecoder().decode(value).trim());
  assert(port > 0, `the test's server in ${dir} did not say its port`);
  return { pid: p.pid, port };
}
/** A process that serves nothing, running a script of `dir` by its full path (as `render.ts preview` runs the project's Vite). */
function script(dir: string) {
  const p = Bun.spawn([node!, path.join(dir, 'idle.js')], { cwd: tmp, stdout: 'ignore', stderr: 'ignore', stdin: 'ignore' });
  started.push(p.pid);
  return p.pid;
}
/** A process that runs nothing of the run's folder: one naming a file of it (an editor showing the file), or naming nothing (a bystander). */
function other(file?: string) {
  // (code on one line: a command line is read up to its first line break)
  const p = Bun.spawn([node!, '-e', IDLE.trim(), ...(file ? [file] : [])], { cwd: tmp, stdout: 'ignore', stderr: 'ignore', stdin: 'ignore' });
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
  await check('a command line runs a program from a folder: its executable there, or a runner\'s script, quoted or not', () => {
    const vite = path.join(run, 'node_modules', 'vite', 'bin', 'vite.js');
    assert(runsFrom(`node ${vite}`, run), 'a script inside');
    assert(runsFrom(`"C:\\Program Files\\nodejs\\node.exe" "${vite}" --port 5180`, run), 'both quoted, the runner by its path');
    assert(runsFrom(`/usr/local/bin/node ${vite} --host 127.0.0.1`, run), 'the runner by its path, the script\'s own options after it');
    assert(runsFrom(`bun run ${path.join(run, 'scripts', 'render.ts')} video`, run), 'bun run');
    assert(runsFrom(`uv run "${path.join(run, 'shots', 'a', 'render.py')}"`, run), 'uv run');
    assert(runsFrom(`"${path.join(run, '.venv', 'Scripts', 'python.exe')}" render.py`, run), 'an executable inside, quoted');
    assert(runsFrom(path.join(run, 'node_modules', '.bin', 'esbuild'), run), 'an executable inside');
    assert(runsFrom(`python3.12 ${path.join(run, 'a.py')} ${path.join(sibling, 'b')}`, run), 'python by its version');
  });
  await check('a command line that only names the folder or a file of it runs nothing from it; nor does a sibling\'s', () => {
    assert(!runsFrom(`node ${path.join(sibling, 'x.js')}`, run), 'a sibling whose name starts alike');
    assert(!runsFrom('node node_modules/vite/bin/vite.js --port 5240 --strictPort', run), 'a relative path names no folder');
    assert(!runsFrom(`notepad.exe ${path.join(run, 'AGENTS.md')}`, run), 'an editor on a file of it');
    assert(!runsFrom(`"C:\\Program Files\\Microsoft VS Code\\Code.exe" "${path.join(run, 'videos')}"`, run), 'an editor on a folder of it, quoted');
    assert(!runsFrom(`vlc "${path.join(run, 'out', 'a', 'a-draft.mp4')}"`, run), 'a player on its draft');
    assert(!runsFrom(`python grade.py ${path.join(run, 'turn-1.jsonl')}`, run), 'a script from elsewhere reading its files');
    assert(!runsFrom(`uv run grade.py --run "${path.join(run, 'x')}"`, run), 'the same through uv');
    assert(!runsFrom(`node -e "setInterval(() => {}, 1000)" ${path.join(run, 'marker')}`, run), 'code given inline, the folder an argument');
    assert(!runsFrom(`node --require=${path.join(run, 'hook.js')} elsewhere.js`, run), 'the folder inside an option');
    assert(!runsFrom(`codex exec -C ${run}`, run) && !runsFrom(`"node" "${run}"`, run), 'the folder itself: the session, which the runner stops with its own tree');
  });
  await check('a path after an option may be that option\'s value, or an argument of a program given inline: left alone', () => {
    assert(!runsFrom(`uv run --project ${path.join(run, 'project')} grade.py`, run), 'uv run --project <folder>/project grade.py: a grader from elsewhere');
    assert(!runsFrom(`node --require ${path.join(run, 'hook.js')} elsewhere.js`, run), 'node --require <folder>/hook.js elsewhere.js');
    assert(!runsFrom(`node -r "${path.join(run, 'hook.js')}" elsewhere.js`, run), 'the same, short and quoted');
    assert(!runsFrom(`node --eval=console.log(process.argv.slice(1)) ${path.join(run, 'turn-1.jsonl')}`, run), 'node --eval=... <folder>/turn-1.jsonl: the path is the inline program\'s argument');
    assert(!runsFrom(`bun --print=1 ${path.join(run, 'turn-1.jsonl')}`, run) && !runsFrom(`python -c pass ${path.join(run, 'x')}`, run), 'the same in bun and python');
    assert(!runsFrom(`/usr/local/bin/node --no-warnings --max-old-space-size=4096 ${path.join(run, 'a.js')}`, run), 'an option that carries its own value proves nothing about what follows');
    assert(!runsFrom(`python -u ${path.join(run, 'render.py')}`, run) && !runsFrom(`uv run --quiet ${path.join(run, 'a.py')}`, run), 'an option that takes none is not told from one that does');
    assert(!runsFrom(`uv --quiet run ${path.join(run, 'a.py')}`, run) && !runsFrom(`uv ${path.join(run, 'a.py')}`, run), 'an option before run, and uv without run');
    assert(!runsFrom(`node run ${path.join(run, 'a.js')}`, run) && !runsFrom(`python run ${path.join(run, 'a.py')}`, run), '"run" is a script\'s name to node and python');
  });
  await check('a path counts by where it leads: one that leaves the folder again through .. is another folder\'s program', () => {
    // (written out: path.join would resolve the .. away)
    const s = path.sep, out = `${run}${s}..${s}dl-1-01${s}grade.js`;
    assert(!runsFrom(`node ${out}`, run), 'node <folder>/../sibling/grade.js: a sibling\'s grader');
    assert(!runsFrom(`node "${out}" --run 3`, run) && !runsFrom(`"${run}${s}..${s}dl-1-01${s}tool.exe" x`, run), 'the same quoted, and as the executable');
    assert(!runsFrom(`uv run ${run}${s}shots${s}..${s}..${s}grade.py`, run), 'down a folder first, then out');
    assert(runsFrom(`node ${run}${s}scripts${s}..${s}idle.js`, run), 'a .. that stays inside is still the folder\'s program');
    assert(runsFrom(`node "${run}${s}a b${s}..${s}idle.js" ..${s}notes`, run), 'quoted, the path ends at its quote: what follows is the script\'s own argument');
    assert(!runsFrom(`${run}${s}my tools${s}..${s}..${s}dl-1-01${s}tool x`, run), 'unquoted, a path may go on past a space: with a .. further on, where it leads isn\'t known');
    assert(!runsFrom(`node ${run}${s}idle.js ..${s}notes`, run), 'the same for a script: left running rather than guessed');
  });
  await check('a process\'s tree is itself and all that descends from it, the deepest first', () => {
    const table = [{ pid: 1, ppid: 0 }, { pid: 10, ppid: 1 }, { pid: 11, ppid: 10 }, { pid: 12, ppid: 11 }, { pid: 13, ppid: 10 }, { pid: 20, ppid: 1 }, { pid: 21, ppid: 20 }];
    assert.deepEqual(tree(table, 10), [12, 11, 13, 10], 'a runner, the shell it started, that shell\'s worker, and a second child: the worker first');
    assert.deepEqual(tree(table, 21), [21], 'a process with no children');
    assert.deepEqual(tree(table, 99), [99], 'one the table doesn\'t list is still stopped itself');
    assert.deepEqual(tree([{ pid: 5, ppid: 6 }, { pid: 6, ppid: 5 }], 5), [6, 5], 'a table that loops ends');
  });
  await check('stopping a process stops what its children started too, not only its own children', async () => {
    // (three node processes, each started by the one before: the last has no parent left once the second is stopped)
    writeFileSync(path.join(tmp, 'chain.js'), `
const depth = Number(process.argv[2]);
console.log(process.pid);
if (depth > 0) require('node:child_process').spawn(process.execPath, [__filename, String(depth - 1)], { stdio: ['ignore', 'inherit', 'ignore'] });
setInterval(() => {}, 1000);
`);
    const p = Bun.spawn([node!, path.join(tmp, 'chain.js'), '2'], { cwd: tmp, stdout: 'pipe', stderr: 'ignore', stdin: 'ignore' });
    started.push(p.pid);
    const reader = (p.stdout as ReadableStream<Uint8Array>).getReader(), decoder = new TextDecoder();
    let said = '';
    for (const until = Date.now() + 15_000; said.split('\n').length < 4 && Date.now() < until;) {
      const { value, done } = await reader.read();
      if (done) break;
      said += decoder.decode(value, { stream: true });
    }
    reader.releaseLock();
    const pids = said.trim().split(/\s+/).map(Number);
    started.push(...pids);
    assert(pids.length === 3 && pids[0] === p.pid && pids.every(alive), `the chain did not start: ${JSON.stringify(said)}`);
    stopTree(p.pid);
    for (const until = Date.now() + 5000; pids.some(alive) && Date.now() < until;) await Bun.sleep(100);
    assert.deepEqual(pids.filter(alive), [], 'still running after its tree was stopped (the first is the process stopped, the last the child of its child)');
  });
  await check('a server is stopped as the process its answer names, when that one alone could have answered on the port', () => {
    const table = [
      { port: 5180, pid: 11, address: '127.0.0.1' }, { port: 5181, pid: 12, address: '0.0.0.0' }, { port: 5181, pid: 12, address: '::' }, { port: 5182, pid: 13, address: '::' },
      { port: 5183, pid: 21, address: '127.0.0.1' }, { port: 5183, pid: 22, address: '192.168.1.5' }, { port: 5184, pid: 23, address: '::1' },
      { port: 5185, pid: 31, address: '127.0.0.1' }, { port: 5185, pid: 32, address: '::' },
    ];
    assert.equal(answerer(table, 5180, 11), 11, 'named, and listening on 127.0.0.1');
    assert.equal(answerer(table, 5181, 12), 12, 'on every address, IPv4 and IPv6: one process');
    assert.equal(answerer(table, 5182, 13), 13, 'on every address, as IPv6 says it, alone there');
    assert.equal(answerer(table, 5183, 21), 21, 'another process on an address the request can\'t reach doesn\'t count');
    assert.equal(answerer(table, 5185, 32), undefined, 'one on 127.0.0.1 and another on ::, which takes IPv4 or not: the one on :: named, though only the other may have answered');
    assert.equal(answerer(table, 5185, 31), undefined, 'the same with the other named: the table can\'t say which answered');
    assert.equal(answerer(table, 5180, undefined), undefined, 'an answer that names no process, one listener or not');
    assert.equal(answerer(table, 5183, undefined), undefined, 'a proxy on 127.0.0.1 and a service on another address: nothing to tell them apart');
    assert.equal(answerer(table, 5183, 22), undefined, 'named, but listening on an address the request couldn\'t reach');
    assert.equal(answerer(table, 5184, 23), undefined, 'the same, on IPv6\'s loopback');
    assert.equal(answerer(table, 5180, 21), undefined, 'named, but listening on another port');
    assert.equal(answerer(table, 5180, 99), undefined, 'named, and listening nowhere');
  });

  const mine = await server(run), mineScript = script(run);
  const theirs = await server(sibling), theirsScript = script(sibling);
  const editor = other(path.join(run, 'AGENTS.md')), bystander = other();
  const liar = await server(run, String(bystander)), quiet = await server(run, 'none');
  await Bun.sleep(300);
  const all = [mine.pid, mineScript, theirs.pid, theirsScript, editor, bystander, liar.pid, quiet.pid];
  let stopped: Awaited<ReturnType<typeof stopLeftRunning>> = [];
  await check('what the run left is stopped: a server found by the folder it serves, and a process running a script of it', async () => {
    assert(all.every(alive), 'all eight started');
    stopped = await stopLeftRunning(run);
    await Bun.sleep(500);
    assert(!alive(mine.pid), `the server started from the run's folder by a relative path (port ${mine.port}) still runs`);
    assert(!alive(mineScript), 'the process running a script of the run\'s folder still runs');
    assert(stopped.some((s) => s.pid === mine.pid && s.why.includes(String(mine.port))), `the server isn't in what it reports: ${JSON.stringify(stopped)}`);
  });
  await check('a process that names a file of the run\'s folder and runs nothing from it goes on (an editor showing it)', () => {
    assert(alive(editor), 'the process naming a file of the run\'s folder was stopped');
  });
  await check('an answer naming a process that doesn\'t listen on the port stops neither it nor the listener; one naming none stops nothing', () => {
    assert(alive(bystander), 'the process the answer named, which listens nowhere, was stopped');
    assert(alive(liar.pid), 'the server whose answer named another process was stopped on its word');
    assert(alive(quiet.pid), 'the server whose answer named no process was stopped as its port\'s listener, a guess');
  });
  await check('nothing else is: a sibling folder\'s server and process go on, and so does this process', () => {
    assert(alive(theirs.pid), 'the sibling folder\'s server was stopped');
    assert(alive(theirsScript), 'the process running the sibling folder\'s script was stopped');
    assert.deepEqual(stopped.map((s) => s.pid).sort(), [mine.pid, mineScript].sort(), 'it stopped something else');
  });
  await check('a folder nothing runs from stops nothing', async () => {
    assert.deepEqual(await stopLeftRunning(path.join(tmp, 'nobody')), []);
    assert(alive(theirs.pid) && alive(theirsScript));
  });
} finally {
  for (const pid of started) try { process.kill(pid); } catch { /* stopped already */ }
  await Bun.sleep(200);
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
}

console.log(`${passed}/${passed + failed} checks passed`);
process.exit(failed ? 1 : 0);
