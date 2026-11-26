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
import { answerer, runsFrom, stopLeftRunning, stopTree, tree, within, words } from '../harness/left-running';

let passed = 0, failed = 0;
async function check(name: string, fn: () => unknown) {
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n  ${(e as Error).message.split('\n').join('\n  ')}`); }
}

const node = Bun.which('node');
if (!node) { console.log('SKIP node is not on the PATH (the previews a run leaves are node processes)'); process.exit(0); }

// (a space in the path where a command line says where an argument ends, as Windows' does with its quotes.
// Elsewhere ps joins the arguments with spaces, and a process running a script from a path with one is left
// running, not guessed at: the command-line checks below cover that)
const tmp = mkdtempSync(path.join(os.tmpdir(), process.platform === 'win32' ? 'audara left running ' : 'audara-left-running-'));
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

const alive = (pid: number) => { if (!(pid > 0)) return false; try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
const started: number[] = [];
/**
 * What a process printed, once it has printed `lines` lines, ended, or `ms` have passed, whichever comes first: a
 * process that stays up without printing would hold a plain read, and the test with it, for good.
 */
async function printed(out: ReadableStream<Uint8Array>, lines: number, ms: number) {
  const reader = out.getReader(), decoder = new TextDecoder();
  let text = '', timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((r) => { timer = setTimeout(() => r(null), ms); });
  try {
    while (text.split('\n').length <= lines) {
      const got = await Promise.race([reader.read(), late]);
      if (!got || got.done) break;
      text += decoder.decode(got.value, { stream: true });
    }
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => { /* closed already */ });
  }
  return text;
}
/** A dev server started from `dir` by a relative path: once it listens, its process and port. */
async function server(dir: string, pidSays?: string) {
  const p = Bun.spawn([node!, 'server.js'], { cwd: dir, env: { ...process.env, ...(pidSays ? { PID_SAYS: pidSays } : {}) }, stdout: 'pipe', stderr: 'ignore', stdin: 'ignore' });
  started.push(p.pid);
  const port = Number((await printed(p.stdout as ReadableStream<Uint8Array>, 1, 15_000)).trim());
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
  // (command lines as text, for folders that needn't exist: one with no space in its path, a sibling whose name
  // starts alike, and one with a space. `at` spells a path as this system does, a .. kept as written. Each form
  // is read both as Windows keeps a line, its quotes saying where an argument ends, and as ps joins one)
  const plain = path.resolve('/evals/results/dl-1-0'), near = `${plain}1`, spaced = path.resolve('/my evals/results/dl-1-0');
  const at = (...parts: string[]) => parts.join(path.sep);
  const both = (cmd: string, dir: string) => [runsFrom(cmd, dir, true), runsFrom(cmd, dir, false)].join();
  await check('a command line\'s arguments, as far as it says where each ends: by Windows\' quotes, or nowhere', () => {
    const line = String.raw`"C:\a b\node.exe" "C:\run dir\x.js" a\\b "c \"d\" e" "f\\" g "h ""i"" j" k"l m"n`;
    assert.deepEqual(words(line, true).map((w) => w.text), [String.raw`C:\a b\node.exe`, String.raw`C:\run dir\x.js`, String.raw`a\\b`, 'c "d" e', 'f\\', 'g', 'h "i" j', 'kl mn'],
      'quotes, a backslash before one, two backslashes before one, two quotes inside, and quotes in the middle of an argument');
    assert(words(line, true).every((w) => w.whole), 'every argument is whole, the program\'s name too when quoted');
    assert.deepEqual(words(String.raw`C:\tools\node.exe  x.js`, true), [{ text: String.raw`C:\tools\node.exe`, whole: false }, { text: 'x.js', whole: true }], 'an unquoted program\'s name ends at the first space, as far as the line says');
    assert.deepEqual(words('  node "/a b/x.js"\t--port 1 ', false), [{ text: 'node', whole: false }, { text: '"/a', whole: false }, { text: 'b/x.js"', whole: false }, { text: '--port', whole: false }, { text: '1', whole: false }],
      'as ps joins them: words, none known to be whole, a quote a character like any other');
    assert.deepEqual(words('', true), []);
    assert.deepEqual(words('   ', false), []);
  });
  await check('a command line runs a program from a folder: its executable there, or a runner\'s script, quoted or not', () => {
    const vite = at(plain, 'node_modules', 'vite', 'bin', 'vite.js');
    assert.equal(both(`node ${vite}`, plain), 'true,true', 'a script inside');
    assert.equal(both(`/usr/local/bin/node ${vite} --host 127.0.0.1`, plain), 'true,true', 'the runner by its path, the script\'s own options after it');
    assert.equal(both(`bun run ${at(plain, 'scripts', 'render.ts')} video`, plain), 'true,true', 'bun run');
    assert.equal(both(`uv run ${at(plain, 'shots', 'a', 'render.py')}`, plain), 'true,true', 'uv run');
    assert.equal(both(`${at(plain, '.venv', 'bin', 'python')} render.py`, plain), 'true,true', 'an executable inside, its script after it');
    assert.equal(both(at(plain, 'node_modules', '.bin', 'esbuild'), plain), 'true,true', 'an executable inside, alone');
    assert.equal(both(`python3.12 ${at(plain, 'a.py')} ${at(near, 'b')}`, plain), 'true,true', 'python by its version');
    assert(runsFrom(`"C:\\Program Files\\nodejs\\node.exe" "${vite}" --port 5180`, plain, true), 'both quoted, the runner by its path');
    assert(runsFrom(`node "${at(spaced, 'idle.js')}"`, spaced, true), 'a script of a folder whose path has a space, quoted');
    assert(runsFrom(`uv run "${at(spaced, 'shots', 'a', 'render.py')}"`, spaced, true), 'the same through uv');
    assert(runsFrom(`"${at(spaced, '.venv', 'Scripts', 'python.exe')}" render.py`, spaced, true), 'an executable inside it, quoted');
  });
  await check('a command line that only names the folder or a file of it runs nothing from it; nor does a sibling\'s', () => {
    assert.equal(both(`node ${at(near, 'x.js')}`, plain), 'false,false', 'a sibling whose name starts alike');
    assert.equal(both('node node_modules/vite/bin/vite.js --port 5240 --strictPort', plain), 'false,false', 'a relative path names no folder');
    assert.equal(both(`notepad.exe ${at(plain, 'AGENTS.md')}`, plain), 'false,false', 'an editor on a file of it');
    assert.equal(both(`vlc ${at(plain, 'out', 'a', 'a-draft.mp4')}`, plain), 'false,false', 'a player on its draft');
    assert.equal(both(`python grade.py ${at(plain, 'turn-1.jsonl')}`, plain), 'false,false', 'a script from elsewhere reading its files');
    assert.equal(both(`uv run grade.py --run ${at(plain, 'x')}`, plain), 'false,false', 'the same through uv');
    assert.equal(both(`node --require=${at(plain, 'hook.js')} elsewhere.js`, plain), 'false,false', 'the folder inside an option');
    assert.equal(both(`codex exec -C ${plain}`, plain), 'false,false', 'the folder itself, a session\'s: the runner stops that with its own tree');
    assert.equal(both(`node ${plain}`, plain), 'false,false', 'the folder itself, given to a runner');
    assert(!runsFrom(`"C:\\Program Files\\Microsoft VS Code\\Code.exe" "${at(spaced, 'videos')}"`, spaced, true), 'an editor on a folder of it, quoted');
    assert(!runsFrom(`node -e "setInterval(() => {}, 1000)" "${at(spaced, 'marker')}"`, spaced, true), 'code given inline, the folder an argument');
  });
  await check('a path after an option may be that option\'s value, or an argument of a program given inline: left alone', () => {
    assert.equal(both(`uv run --project ${at(plain, 'project')} grade.py`, plain), 'false,false', 'uv run --project <folder>/project grade.py: a grader from elsewhere');
    assert.equal(both(`node --require ${at(plain, 'hook.js')} elsewhere.js`, plain), 'false,false', 'node --require <folder>/hook.js elsewhere.js');
    assert.equal(both(`node -r "${at(plain, 'hook.js')}" elsewhere.js`, plain), 'false,false', 'the same, short and quoted');
    assert.equal(both(`node --eval=console.log(process.argv.slice(1)) ${at(plain, 'turn-1.jsonl')}`, plain), 'false,false', 'node --eval=... <folder>/turn-1.jsonl: the path is the inline program\'s argument');
    assert.equal(both(`bun --print=1 ${at(plain, 'turn-1.jsonl')}`, plain), 'false,false', 'the same in bun');
    assert.equal(both(`python -c pass ${at(plain, 'x')}`, plain), 'false,false', 'and in python');
    assert.equal(both(`/usr/local/bin/node --no-warnings --max-old-space-size=4096 ${at(plain, 'a.js')}`, plain), 'false,false', 'an option that carries its own value proves nothing about what follows');
    assert.equal(both(`python -u ${at(plain, 'render.py')}`, plain), 'false,false', 'an option that takes none is not told from one that does');
    assert.equal(both(`uv run --quiet ${at(plain, 'a.py')}`, plain), 'false,false', 'the same after run');
    assert.equal(both(`uv --quiet run ${at(plain, 'a.py')}`, plain), 'false,false', 'an option before run');
    assert.equal(both(`uv ${at(plain, 'a.py')}`, plain), 'false,false', 'uv without run');
    assert.equal(both(`node run ${at(plain, 'a.js')}`, plain), 'false,false', '"run" is a script\'s name to node');
    assert.equal(both(`python run ${at(plain, 'a.py')}`, plain), 'false,false', 'and to python');
  });
  await check('a path is one argument, never a stretch of the line: a space ends it unless the line says otherwise', () => {
    // (a grader elsewhere and its argument, read while cleaning a folder whose own path starts with the grader's)
    const grader = path.resolve('/review/grade.js'), under = `${grader} suite${path.sep}run`;
    assert.equal(both(`node ${grader} suite${path.sep}run${path.sep}log.txt`, under), 'false,false', 'node <grade.js> suite/run/log.txt, cleaning the folder "<grade.js> suite/run"');
    assert.equal(both(`${grader} suite${path.sep}run${path.sep}tool`, under), 'false,false', 'the same with the grader as the program');
    assert.equal(both(`node ${at(spaced, 'idle.js')}`, spaced), 'false,false', 'unquoted, a path of a folder with a space is no one argument: on Windows by its rules, elsewhere unknown');
    assert.equal(both(`${at(spaced, 'node_modules', '.bin', 'esbuild')} --watch`, spaced), 'false,false', 'the same as the program');
    assert(!runsFrom(`node "${at(plain, 'idle.js')}"`, plain, false) && !runsFrom(`"${at(plain, 'tool')}" x`, plain, false), 'as ps joins a line, a quote is part of the argument: not a path of the folder');
    assert(!runsFrom(`node "${at(spaced, 'idle.js')}"`, spaced, false), 'so a folder with a space matches nothing there, quoted or not');
  });
  await check('a path counts by where it leads: one that leaves the folder again through .. is another folder\'s program', () => {
    const out = at(plain, '..', 'dl-1-01', 'grade.js');
    assert.equal(both(`node ${out}`, plain), 'false,false', 'node <folder>/../sibling/grade.js: a sibling\'s grader');
    assert.equal(both(`uv run ${at(plain, 'shots', '..', '..', 'grade.py')}`, plain), 'false,false', 'down a folder first, then out');
    assert.equal(both(at(plain, '..', 'dl-1-01', 'tool'), plain), 'false,false', 'the same as the program');
    assert.equal(both(`node ${at(plain, 'scripts', '..', 'idle.js')}`, plain), 'true,true', 'a .. that stays inside is still the folder\'s program');
    assert(!runsFrom(`node "${out}" --run 3`, plain, true) && !runsFrom(`"${at(plain, '..', 'dl-1-01', 'tool.exe')}" x`, plain, true), 'quoted, as a script and as the program');
    assert(runsFrom(`node "${at(spaced, 'a b', '..', 'idle.js')}" ${at('..', 'notes')}`, spaced, true), 'quoted, the path ends at its quote: what follows is the script\'s own argument');
    assert.equal(both(`node ${at(plain, 'idle.js')} ${at('..', 'notes')}`, plain), 'true,false', 'unquoted: whole on Windows, an argument after the program\'s name; as ps joins it, the path may go on past the space, so with a .. further on it is left running');
    assert.equal(both(`${at(plain, 'my')} ${at('tools', '..', '..', 'dl-1-01', 'tool')} x`, plain), 'false,false', 'an unquoted program\'s path may go on past a space on Windows too');
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
    try {
      const said = await printed(p.stdout as ReadableStream<Uint8Array>, 3, 15_000);
      // (only what reads as a process's own number is kept: nothing printed reads as 0, which names this test's whole group)
      const pids = said.trim().split(/\s+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
      started.push(...pids);
      assert(pids.length === 3 && pids[0] === p.pid && pids.every(alive), `the chain did not start: ${JSON.stringify(said)}`);
      stopTree(p.pid);
      for (const until = Date.now() + 5000; pids.some(alive) && Date.now() < until;) await Bun.sleep(100);
      assert.deepEqual(pids.filter(alive), [], 'still running after its tree was stopped (the first is the process stopped, the last the child of its child)');
    } finally { stopTree(p.pid); }
  });
  await check('only a process\'s own number is stopped: 0 and the negative ones, which name groups, stop nothing', () => {
    for (const pid of [0, -1, -process.pid, NaN, 1.5]) stopTree(pid);
    assert(alive(process.pid), 'this process');
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
  for (const pid of started) if (Number.isInteger(pid) && pid > 0) try { process.kill(pid); } catch { /* stopped already */ }
  await Bun.sleep(200);
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
}

console.log(`${passed}/${passed + failed} checks passed`);
process.exit(failed ? 1 : 0);
