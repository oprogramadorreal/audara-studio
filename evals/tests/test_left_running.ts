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
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TELLS, answerer, fromWindows, runsFrom, stopLeftRunning, stopTree, tree, within, words } from '../harness/left-running';

let passed = 0, failed = 0;
async function check(name: string, fn: () => unknown) {
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n  ${(e as Error).message.split('\n').join('\n  ')}`); }
}

const node = Bun.which('node');
if (!node) { console.log('SKIP node is not on the PATH (the previews a run leaves are node processes)'); process.exit(0); }

// (a space in the path, as a run's folder may have: an argument is whole, spaces and all, where a system says
// a process's arguments one by one)
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
  // (what a system says of a process, written out: its arguments one by one and the file it runs, for folders that
  // needn't exist: one with no space in its path, a sibling whose name starts alike, and one with a space. `at`
  // spells a path as this system does, a .. kept as written)
  const plain = path.resolve('/evals/results/dl-1-0'), near = `${plain}1`, spaced = path.resolve('/my evals/results/dl-1-0');
  const at = (...parts: string[]) => parts.join(path.sep);
  const NODE = path.resolve('/tools/nodejs/node.exe'), PYTHON = path.resolve('/tools/python/python3.12.exe'), BUN = path.resolve('/tools/bun'), UV = path.resolve('/tools/uv.exe');
  const DENO = path.resolve('/tools/deno'), EDITOR = path.resolve('/tools/editor.exe'), GRADER = path.resolve('/review/bin/grader');
  await check('a Windows command line comes apart into its arguments by Windows\' own rules', () => {
    const line = String.raw`"C:\a b\node.exe" "C:\run dir\x.js" a\\b "c \"d\" e" "f\\" g "h ""i"" j" k"l m"n`;
    assert.deepEqual(words(line), [String.raw`C:\a b\node.exe`, String.raw`C:\run dir\x.js`, String.raw`a\\b`, 'c "d" e', 'f\\', 'g', 'h "i" j', 'kl mn'],
      'quotes, a backslash before one, two backslashes before one, two quotes inside, and quotes in the middle of an argument');
    assert.deepEqual(words(String.raw`C:\tools\node.exe  x.js`), [String.raw`C:\tools\node.exe`, 'x.js'], 'an unquoted program\'s name ends at the first space, and spaces, however many, are one gap');
    assert.deepEqual(words('node "" x.js'), ['node', '', 'x.js'], 'an empty argument is a pair of quotes, and keeps its place');
    assert.deepEqual(words('node\t"a b"\tc'), ['node', 'a b', 'c'], 'a tab parts arguments as a space does');
    assert.deepEqual(words(''), []);
    assert.deepEqual(words(' node x.js'), ['', 'node', 'x.js'], 'a line that starts with a space has an empty program\'s name: node there is the first argument, a script');
    assert.deepEqual(words('\t"a b" c  '), ['', 'a b', 'c'], 'the same with a tab, and spaces at the end are nothing');
    assert.deepEqual(words('   '), ['']);
  });
  await check('Windows\' processes are read as records, whatever a command line holds', () => {
    // (code given inline with a line break and tabs in it, its second line spelled as a process's record would be)
    const inline = 'node -e "setInterval(() => {}, 1000)\n4242\t1\tC:\\tools\\node.exe\tnode x.js"';
    const rows = fromWindows(JSON.stringify([
      { ProcessId: 0, ParentProcessId: 0, ExecutablePath: null, CommandLine: null },
      { ProcessId: 812, ParentProcessId: 4, ExecutablePath: 'C:\\tools\\node.exe', CommandLine: inline },
      { ProcessId: 900, ParentProcessId: 812, ExecutablePath: null, CommandLine: 'node x.js' },
      { ProcessId: '77', ParentProcessId: 1, ExecutablePath: 'C:\\x.exe', CommandLine: 'x' }, null,
    ]));
    assert.deepEqual(rows.map((r) => r.pid), [0, 812, 900], 'one process a record: no line of a command is another process, and a record without a whole number for its id is none');
    assert.deepEqual(rows[1], { pid: 812, ppid: 4, cmd: inline, args: ['node', '-e', 'setInterval(() => {}, 1000)\n4242\t1\tC:\\tools\\node.exe\tnode x.js'], exe: 'C:\\tools\\node.exe' }, 'its arguments, the line break and the tabs inside one');
    assert(rows[0]!.args === undefined && rows[2]!.args === undefined && rows[2]!.exe === undefined, 'a process Windows gives no file or no command line for has neither: never stopped by them');
    assert.deepEqual(fromWindows(JSON.stringify({ ProcessId: 5, ParentProcessId: 1, ExecutablePath: 'C:\\a.exe', CommandLine: 'a' })).map((r) => r.pid), [5], 'a single process, which PowerShell writes without the list around it');
    assert.deepEqual(fromWindows(''), []);
    assert.deepEqual(fromWindows('not json'), []);
  });
  await check('a process runs a program from a folder: the file it runs is there, or it is a runner with a script of it', () => {
    const vite = at(plain, 'node_modules', 'vite', 'bin', 'vite.js');
    assert(runsFrom(['node', vite], plain, NODE), 'a script inside');
    assert(runsFrom([NODE, vite, '--host', '127.0.0.1'], plain, NODE), 'the runner by its path, the script\'s own options after it');
    assert(runsFrom(['bun', 'run', at(plain, 'scripts', 'render.ts'), 'video'], plain, BUN), 'bun run');
    assert(runsFrom(['uv', 'run', at(plain, 'shots', 'a', 'render.py')], plain, UV), 'uv run');
    assert(runsFrom(['deno', 'run', at(plain, 'a.ts')], plain, DENO) && runsFrom(['deno', at(plain, 'a.ts')], plain, DENO), 'deno, with run and without');
    assert(runsFrom(['python3.12', at(plain, 'a.py'), at(near, 'b')], plain, PYTHON), 'python by its version');
    assert(runsFrom(['py', at(plain, 'a.py')], plain, PYTHON) && runsFrom(['nodejs', vite], plain, NODE), 'a runner by another of its names: py for python, nodejs for node');
    assert(runsFrom(['esbuild', '--service=0.25.0', '--ping'], plain, at(plain, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe')), 'the file it runs is inside, whatever its arguments say');
    assert(runsFrom([at(plain, '.venv', 'Scripts', 'python.exe'), 'render.py'], plain, at(plain, '.venv', 'Scripts', 'python.exe')), 'a venv\'s python, its script given from where it runs');
    assert(runsFrom(['node', at(spaced, 'idle.js')], spaced, NODE), 'a folder with a space in its path: an argument is whole, spaces and all');
    assert(runsFrom(words(`"C:\\Program Files\\nodejs\\node.exe" "${at(spaced, 'idle.js')}" --port 5180`), spaced, 'C:\\Program Files\\nodejs\\node.exe'), 'the same from a Windows command line, both quoted');
    assert(runsFrom(words(`uv run "${at(spaced, 'shots', 'a', 'render.py')}"`), spaced, UV), 'and through uv');
  });
  await check('a process that only names the folder or a file of it runs nothing from it; nor does a sibling\'s', () => {
    assert(!runsFrom(['node', at(near, 'x.js')], plain, NODE), 'a sibling whose name starts alike');
    assert(!runsFrom(['node', 'node_modules/vite/bin/vite.js', '--port', '5240', '--strictPort'], plain, NODE), 'a relative path names no folder');
    assert(!runsFrom(['notepad.exe', at(plain, 'AGENTS.md')], plain, EDITOR), 'an editor on a file of it');
    assert(!runsFrom(words(`"C:\\Program Files\\Microsoft VS Code\\Code.exe" "${at(spaced, 'videos')}"`), spaced, 'C:\\Program Files\\Microsoft VS Code\\Code.exe'), 'an editor on a folder of it');
    assert(!runsFrom(['vlc', at(plain, 'out', 'a', 'a-draft.mp4')], plain, path.resolve('/tools/vlc')), 'a player on its draft');
    assert(!runsFrom(['python', 'grade.py', at(plain, 'turn-1.jsonl')], plain, PYTHON), 'a script from elsewhere reading its files');
    assert(!runsFrom(['uv', 'run', 'grade.py', '--run', at(plain, 'x')], plain, UV), 'the same through uv');
    assert(!runsFrom(['node', `--require=${at(plain, 'hook.js')}`, 'elsewhere.js'], plain, NODE), 'the folder inside an option');
    assert(!runsFrom(['codex', 'exec', '-C', plain], plain, path.resolve('/tools/codex')), 'the folder itself, a session\'s: the runner stops that with its own tree');
    assert(!runsFrom(['node', plain], plain, NODE), 'the folder itself, given to a runner');
    assert(!runsFrom(['node', '-e', 'setInterval(() => {}, 1000)', at(plain, 'marker')], plain, NODE), 'code given inline, the folder an argument');
  });
  await check('a path after an option may be that option\'s value, or an argument of a program given inline: left alone', () => {
    assert(!runsFrom(['uv', 'run', '--project', at(plain, 'project'), 'grade.py'], plain, UV), 'uv run --project <folder>/project grade.py: a grader from elsewhere');
    assert(!runsFrom(['node', '--require', at(plain, 'hook.js'), 'elsewhere.js'], plain, NODE), 'node --require <folder>/hook.js elsewhere.js');
    assert(!runsFrom(['node', '-r', at(plain, 'hook.js'), 'elsewhere.js'], plain, NODE), 'the same, short');
    assert(!runsFrom(['node', '--eval=console.log(process.argv.slice(1))', at(plain, 'turn-1.jsonl')], plain, NODE), 'node --eval=... <folder>/turn-1.jsonl: the path is the inline program\'s argument');
    assert(!runsFrom(['bun', '--print=1', at(plain, 'turn-1.jsonl')], plain, BUN) && !runsFrom(['python', '-c', 'pass', at(plain, 'x')], plain, PYTHON), 'the same in bun and python');
    assert(!runsFrom([NODE, '--no-warnings', '--max-old-space-size=4096', at(plain, 'a.js')], plain, NODE), 'an option that carries its own value proves nothing about what follows');
    assert(!runsFrom(['python', '-u', at(plain, 'render.py')], plain, PYTHON) && !runsFrom(['uv', 'run', '--quiet', at(plain, 'a.py')], plain, UV), 'an option that takes none is not told from one that does');
    assert(!runsFrom(['uv', '--quiet', 'run', at(plain, 'a.py')], plain, UV) && !runsFrom(['uv', at(plain, 'a.py')], plain, UV), 'an option before run, and uv without run');
    assert(!runsFrom(['node', 'run', at(plain, 'a.js')], plain, NODE) && !runsFrom(['python', 'run', at(plain, 'a.py')], plain, PYTHON), '"run" is a script\'s name to node and python');
  });
  await check('an argument is what the system says it is, never a stretch of a line', () => {
    // (a grader elsewhere and its argument, while cleaning a folder whose own path starts with the grader's)
    const grader = path.resolve('/review/grade.js'), under = `${grader} suite${path.sep}run`;
    assert(!runsFrom(['node', grader, at('suite', 'run', 'log.txt')], under, NODE), 'node <grade.js> suite/run/log.txt, cleaning the folder "<grade.js> suite/run": two arguments');
    assert(!runsFrom(words(`node ${grader} suite${path.sep}run${path.sep}log.txt`), under, NODE), 'the same from a Windows command line, where a space ends an unquoted argument');
    assert(!runsFrom(words(`node ${at(spaced, 'idle.js')}`), spaced, NODE), 'so a path with a space, unquoted there, is two arguments and no path of the folder');
    // (node '' <folder>/log.txt runs the program it is given on its input; the path is that program's argument)
    assert(!runsFrom(['node', '', at(plain, 'log.txt')], plain, NODE) && !runsFrom(words(`node "" ${at(plain, 'log.txt')}`), plain, NODE), 'an empty argument keeps its place: the path is the second, not the script');
    assert(!runsFrom(['uv', 'run', '', at(plain, 'a.py')], plain, UV) && !runsFrom(['bun', '', 'run', at(plain, 'a.ts')], plain, BUN), 'after run, and before it');
    assert(!runsFrom(['', at(plain, 'tool'), 'x'], plain, GRADER) && !runsFrom([], plain, GRADER), 'an empty first argument, and none at all');
    // (a Windows line that starts with a space: its program's name is empty, so node there is a script's name)
    assert(!runsFrom(words(` node ${at(plain, 'input.txt')}`), plain, NODE), ' node <folder>/input.txt, the process node: a script called node, the file its input');
    assert(!runsFrom(words(` uv run ${at(plain, 'a.py')}`), plain, UV) && runsFrom(words(`node ${at(plain, 'idle.js')}`), plain, NODE), 'the same through run; and without the space, the script');
  });
  await check('left running knowingly: a script a shell runs, and one whose first line gives its interpreter an option', () => {
    // (as Linux gives them: the interpreter the script's first line names, what that line passes it, the script)
    assert(runsFrom(['/usr/bin/python3', at(plain, 'render.py'), '--out', 'x'], plain, PYTHON), 'a script started by #!/usr/bin/python3 is a runner and its script');
    assert(!runsFrom(['/usr/bin/python3', '-u', at(plain, 'render.py')], plain, PYTHON), '#!/usr/bin/python3 -u: an option before the path, as with any');
    assert(!runsFrom(['/bin/sh', at(plain, 'tool.sh')], plain, path.resolve('/usr/bin/dash')), '#!/bin/sh: a shell is no runner here');
    assert(!runsFrom(['bash', at(plain, 'tool.sh')], plain, path.resolve('/usr/bin/bash')), 'nor is bash, given the script by hand');
  });
  await check('the program is the file the system says the process runs, whatever its first argument says', () => {
    assert(!runsFrom([at(plain, 'log.txt'), 'TERM=xterm'], plain, GRADER), 'a file of the folder as first argument, the process a grader from elsewhere');
    assert(!runsFrom([at(plain, 'grader'), 'x'], plain, GRADER), 'even one named as the program is: another file');
    assert(!runsFrom(['node', at(plain, 'log.txt')], plain, GRADER), 'a runner by its first argument, something else by the file it runs');
    assert(!runsFrom(['grader', at(plain, 'log.txt')], plain, NODE), 'and the other way round');
    assert(!runsFrom(['python3', at(plain, 'log.txt')], plain, NODE), 'python3 <folder>/log.txt, the process node: a script called python3 reading the log');
    assert(!runsFrom(['node', at(plain, 'log.txt')], plain, BUN) && !runsFrom(['bun', 'run', at(plain, 'log.txt')], plain, UV), 'two runners are not one, with run or without');
    assert(!runsFrom(['node', at(plain, 'idle.js')], plain, '') && !runsFrom([at(plain, 'tool')], plain, ''), 'a process the system won\'t say the file of is left running');
    assert(runsFrom(words(`uv run "${at(spaced, 'a.py')}"`), spaced, 'C:\\Tools\\UV.EXE'), 'a name in another case, as Windows may give it');
    assert(!runsFrom(['tool'], plain, `${plain}1${path.sep}tool`) && !runsFrom(['tool'], plain, plain), 'a file of a sibling whose name starts alike, and the folder itself, are not files inside it');
  });
  await check('a first argument that is the running file under another name counts: a link in the folder to a program elsewhere', () => {
    // (real files: a venv in the folder whose python is the python elsewhere. A link to a file takes a right few
    // Windows accounts have, so there the venv's folder is the link, a junction, which anyone can make)
    const dir = mkdtempSync(path.join(os.tmpdir(), 'audara link ')), folder = path.join(dir, 'run'), real = path.join(dir, 'pythons');
    try {
      mkdirSync(path.join(real, 'bin'), { recursive: true });
      mkdirSync(folder);
      writeFileSync(path.join(real, 'bin', 'python3.12'), 'x');
      writeFileSync(path.join(folder, 'other'), 'x');
      let called: string;
      if (process.platform === 'win32') { symlinkSync(real, path.join(folder, '.venv'), 'junction'); called = path.join(folder, '.venv', 'bin', 'python3.12'); }
      else { mkdirSync(path.join(folder, '.venv', 'bin'), { recursive: true }); called = path.join(folder, '.venv', 'bin', 'python'); symlinkSync(path.join(real, 'bin', 'python3.12'), called); }
      const exe = path.join(real, 'bin', 'python3.12');
      assert(runsFrom([called, 'render.py'], folder, exe), 'called by its name in the folder, the file it runs elsewhere: one file');
      assert(!runsFrom([path.join(folder, 'other'), 'render.py'], folder, exe), 'another file of the folder is not the one running');
      assert(!runsFrom([path.join(folder, 'gone'), 'render.py'], folder, exe), 'nor one that isn\'t there');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  await check('a path counts by where it leads: one that leaves the folder again through .. is another folder\'s program', () => {
    const out = at(plain, '..', 'dl-1-01', 'grade.js');
    assert(!runsFrom(['node', out], plain, NODE), 'node <folder>/../sibling/grade.js: a sibling\'s grader');
    assert(!runsFrom(['uv', 'run', at(plain, 'shots', '..', '..', 'grade.py')], plain, UV), 'down a folder first, then out');
    assert(!runsFrom([at(plain, '..', 'dl-1-01', 'tool')], plain, at(plain, '..', 'dl-1-01', 'tool')), 'the same as the file it runs');
    assert(runsFrom(['node', at(plain, 'scripts', '..', 'idle.js')], plain, NODE), 'a .. that stays inside is still the folder\'s program');
    assert(runsFrom(words(`node "${at(spaced, 'a b', '..', 'idle.js')}" ${at('..', 'notes')}`), spaced, NODE), 'and what follows the script is the script\'s own argument, a .. in it or not');
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
    // (where the system says neither a process's arguments nor the file it runs, macOS, only servers are stopped)
    if (TELLS) assert(!alive(mineScript), 'the process running a script of the run\'s folder still runs');
    else assert(alive(mineScript), 'a process was stopped by its command line, on a system that says no process\'s arguments');
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
    assert.deepEqual(stopped.map((s) => s.pid).sort(), (TELLS ? [mine.pid, mineScript] : [mine.pid]).sort(), 'it stopped something else');
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
