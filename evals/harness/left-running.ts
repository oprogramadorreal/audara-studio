// What an eval run leaves running, and stopping it: used by trigger.ts after each run and by task.ts after its
// last turn.
//
// A session starts its project's preview with `render.ts preview`, which outlives the session on purpose: a
// process of its own, outside the tree the harness stops when a run ends. Left alone, each holds one of the
// preview's 27 ports (5173-5199) for as long as the machine stays up. One trigger eval of devlog's set left 22 of
// them serving its run folders for a week, with five projects' own previews the range was full, and every new
// project's `render.ts preview` failed: a task run's session then ran Vite by hand on a port of its own, and a
// video project had widened the range in its own render.ts (docs/history.md, 0.17.0).
//
// So two sweeps, by the run's folder alone:
// - every process that runs a program from the folder: the file it runs is inside it, or it is a runner (node,
//   bun, python, uv run ...) with the script right after it (`render.ts preview` runs the project's own
//   node_modules/vite that way, by its full path). By what the system itself says of the process, its arguments
//   one by one and the file it runs, where a system says them: Windows and Linux (`TELLS`). macOS's `ps` says
//   neither, so there this sweep stops nothing;
// - every dev server that answers /__audara with a folder inside it, on whatever port: one started by hand from
//   the folder (`node node_modules/vite/bin/vite.js --port 5240`) names it nowhere in its command line, and sits
//   outside the ports a preview is looked for on. Only ports a node or bun process listens on are asked, and the
//   process stopped is the one the answer names, when the system says it alone could have answered there.
// Neither touches this process or the ones it descends from, whatever their command lines name. And neither
// stops a process for naming the folder further on among its arguments: that is something else looking at the
// run's files (an editor on one of them, a player on its draft, a grader's script reading its transcript), which
// a sweep by any mention would close with everything its tree holds. Where the evidence is short of that (an
// option before the path, a path that leaves the folder again through `..`, a process the system won't say the
// arguments or the file of, an answer that names no process, or one that doesn't listen there, or two processes
// that could have answered), the process is left running and, for a server, the port is printed.
import { readFileSync, readlinkSync, realpathSync } from 'node:fs';
import path from 'node:path';

const WIN = process.platform === 'win32';
const caseless = WIN || process.platform === 'darwin';

/**
 * A process and every one that descends from it in a table of processes, the deepest first and itself last: a
 * child is listed before the parent that could notice it gone.
 */
export function tree(procs: { pid: number; ppid: number }[], pid: number): number[] {
  const kids = new Map<number, number[]>();
  for (const p of procs) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p.pid]);
  const out: number[] = [], seen = new Set<number>();
  const walk = (p: number) => {
    if (seen.has(p)) return;
    seen.add(p);
    for (const k of kids.get(p) ?? []) walk(k);
    out.push(p);
  };
  walk(pid);
  return out;
}

/**
 * Stops a process with its whole tree (a child outlives its parent). Elsewhere than Windows the tree is read
 * from the process table first: `pkill -P` reaches a process's own children only, so a worker started by a shell
 * the process started would outlive both, with no parent left to find it by.
 */
export function stopTree(pid: number) {
  // (a process's own number only: 0 and the negative ones name whole groups of processes, this one's among them)
  if (!(Number.isInteger(pid) && pid > 0)) return;
  if (WIN) { Bun.spawnSync(['taskkill', '/T', '/F', '/PID', String(pid)], { stdout: 'ignore', stderr: 'ignore' }); return; }
  for (const p of tree(processes(), pid)) if (p > 0) try { process.kill(p); } catch { /* it ended meanwhile */ }
}

const text = (cmd: string[]) => { try { return Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'ignore' }).stdout.toString(); } catch { return ''; } };

/**
 * Whether this system says of a process what the first sweep needs: its arguments one by one, and the file it
 * runs. Windows does (the command line as given, read by its own rules, and the executable's path), and so does
 * Linux (/proc). Elsewhere there is only `ps`, which joins a command's arguments with spaces and, on macOS,
 * starts the line at the second one when the first is empty: no way to tell where an argument ends or which
 * word is the program. There the first sweep stops nothing, and a run's servers are still found by the second.
 */
export const TELLS = WIN || process.platform === 'linux';

export interface Proc { pid: number; ppid: number; cmd: string; args?: string[]; exe?: string }
/**
 * Windows' processes, from what it wrote of them as JSON: each one a record of its own, whatever its command
 * line holds. Written a line a process, a command line with a line break in it (code given inline) would read
 * as more processes, with ids and files that are that command's own text.
 */
export function fromWindows(json: string): Proc[] {
  let list: unknown;
  try { list = JSON.parse(json); } catch { return []; }
  const rows: Proc[] = [];
  for (const p of (Array.isArray(list) ? list : [list]) as Record<string, unknown>[]) {
    if (!p || !Number.isInteger(p.ProcessId) || !Number.isInteger(p.ParentProcessId)) continue;
    const cmd = typeof p.CommandLine === 'string' ? p.CommandLine : '', exe = typeof p.ExecutablePath === 'string' ? p.ExecutablePath : '';
    rows.push({ pid: p.ProcessId as number, ppid: p.ParentProcessId as number, cmd, ...(cmd && exe ? { args: words(cmd), exe } : {}) });
  }
  return rows;
}
/**
 * Every process there is: its id, its parent's and its command line as text (looked at, never taken apart), and,
 * where the system says them (`TELLS`) of a process that is ours to read, its arguments and the file it runs.
 */
function processes(): Proc[] {
  const rows: Proc[] = [];
  if (WIN) return fromWindows(text(['powershell', '-NoProfile', '-Command',
    'try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}; Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, ExecutablePath, CommandLine | ConvertTo-Json -Compress']));
  // (one line a process: ps writes a line break inside an argument as other characters, never as one)
  for (const line of text(['ps', '-eo', 'pid=,ppid=,args=']).split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const row: Proc = { pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3]! };
    if (process.platform === 'linux') try {
      // (the arguments, each ended by an empty byte, and the file the process runs, a link the kernel keeps)
      const raw = readFileSync(`/proc/${row.pid}/cmdline`, 'utf8'), exe = readlinkSync(`/proc/${row.pid}/exe`);
      // (a file replaced since the process started, a tool updated, is marked so after its path)
      if (raw) { row.args = (raw.endsWith('\0') ? raw.slice(0, -1) : raw).split('\0'); row.exe = exe.replace(/ \(deleted\)$/, ''); }
    } catch { /* gone meanwhile, or not ours to read: left without them, so never stopped by them */ }
    rows.push(row);
  }
  return rows;
}

export interface Listener { port: number; pid: number; address: string }
/** Every local TCP port something listens on, with the process that does and the address it listens on. */
function listening(): Listener[] {
  const rows: Listener[] = [];
  if (WIN) {
    const out = text(['powershell', '-NoProfile', '-Command', 'Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object { "$($_.LocalAddress)`t$($_.LocalPort)`t$($_.OwningProcess)" }']);
    for (const line of out.split(/\r?\n/)) { const m = /^(\S+)\t(\d+)\t(\d+)$/.exec(line.trim()); if (m) rows.push({ address: m[1]!, port: Number(m[2]), pid: Number(m[3]) }); }
  } else {
    // (lsof -F: a "p<pid>" line, then an "n<address>:<port>" line for each socket of that process)
    let pid = 0;
    for (const line of text(['lsof', '-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn']).split('\n')) {
      if (line.startsWith('p')) pid = Number(line.slice(1));
      else if (line.startsWith('n')) { const m = /^n(.*):(\d+)$/.exec(line); if (m && pid) rows.push({ address: m[1]!.replace(/^\[|\]$/g, ''), port: Number(m[2]), pid }); }
    }
  }
  return rows;
}
/** The addresses whose listener may get what is sent to 127.0.0.1: that one, and each way of saying "every address". */
const LOOPBACK = new Set(['127.0.0.1', '0.0.0.0', '::', '*']);
/**
 * The process to stop for a server that answered on 127.0.0.1:<port> for the run's folder, naming `named` as its
 * process: `named`, when the system says it is the one process that could have answered, the only one listening
 * on that port at an address the request may reach. Any other answer stops nothing:
 * - one that names no process leaves a guess at the port's listeners, where a proxy on that address and an
 *   unrelated service on another are told apart by nothing;
 * - one that names a process that doesn't listen there is stale, wrong, or passed on by somebody else's proxy;
 * - with two processes there (one on 127.0.0.1 and one on `::`, which takes IPv4 or not by a setting the table
 *   doesn't show), the table can't say which of them answered, so the name is the answer's word alone.
 */
export function answerer(listeners: Listener[], port: number, named: number | undefined): number | undefined {
  const could = new Set(listeners.filter((l) => l.port === port && LOOPBACK.has(l.address)).map((l) => l.pid));
  return named !== undefined && could.size === 1 && could.has(named) ? named : undefined;
}

const norm = (p: string) => { const r = path.resolve(p).split(path.sep).join('/').replace(/\/+$/, ''); return caseless ? r.toLowerCase() : r; };
/** Whether `p` is the folder `dir` or inside it, compared as the file system compares paths. */
export function within(dir: string, p: string) {
  const d = norm(dir), x = norm(p);
  return x === d || x.startsWith(`${d}/`);
}
const blank = (ch: string | undefined) => ch === ' ' || ch === '\t';
/**
 * A Windows command line's arguments. Windows keeps the line as it was given, quotes and all, and they are read
 * here by the rules its programs read them by (CommandLineToArgvW): the program's name to its closing quote or to
 * the first space, then each argument, where a quote opens and closes a stretch that spaces don't end, a
 * backslash before a quote makes it a character, and two backslashes there are one.
 */
export function words(cmd: string): string[] {
  const out: string[] = [];
  let i = 0;
  if (!cmd.length) return out;
  // (the program's name: no backslash is special in it. A line that starts with a space has an empty one, and
  // its first word is then the first argument: ` node <file>` runs a script called node)
  if (blank(cmd[i])) out.push('');
  else if (cmd[i] === '"') {
    const j = cmd.indexOf('"', i + 1), end = j < 0 ? cmd.length : j;
    out.push(cmd.slice(i + 1, end));
    i = end + 1;
  } else {
    let j = i;
    while (j < cmd.length && !blank(cmd[j])) j++;
    out.push(cmd.slice(i, j));
    i = j;
  }
  for (;;) {
    while (blank(cmd[i])) i++;
    if (i >= cmd.length) return out;
    let text = '', quoted = false;
    for (; i < cmd.length; i++) {
      let ch = cmd[i]!;
      if (ch === '\\') {
        let n = 1;
        while (cmd[i + n] === '\\') n++;
        if (cmd[i + n] !== '"') { text += '\\'.repeat(n); i += n - 1; continue; }
        // (backslashes before a quote: each pair is one backslash, and one left over makes the quote a character)
        text += '\\'.repeat(n >> 1);
        i += n;
        if (n & 1) { text += '"'; continue; }
        ch = '"';
      }
      if (ch === '"') {
        // (two quotes inside a quoted stretch are one quote character)
        if (quoted && cmd[i + 1] === '"') { text += '"'; i++; continue; }
        quoted = !quoted;
        continue;
      }
      if (!quoted && blank(ch)) break;
      text += ch;
    }
    out.push(text);
  }
}

/** The programs that run the script given first: node, bun, deno, python (python3.12, pythonw, py). */
const RUNNER = /^(node|nodejs|bun|deno|python[\d.]*w?|py)$/;
/** The ones whose `run` takes the script next: `bun run`, `uv run`, `deno run`. */
const RUNS = /^(bun|uv|deno)$/;
/** Which runner a name is, the same for each name it goes by (python, python3.12, pythonw and py; node and nodejs), or none. */
const runner = (n: string) => { const m = RUNNER.exec(n)?.[1]; return !m ? '' : m.startsWith('py') ? 'python' : m === 'nodejs' ? 'node' : m; };
/** A program's name as its file gives it: the last part of the path, without Windows' .exe, in small letters. */
const nameOf = (p: string) => p.split(/[\\/]/).pop()!.replace(/\.exe$/i, '').toLowerCase();
/** Whether two paths are one file, links followed (a venv's python is a link to the python it was made from). */
function sameFile(a: string, b: string) {
  try { return norm(realpathSync(a)) === norm(realpathSync(b)); } catch { return false; }
}
/**
 * Whether a process runs a program from the folder `dir`, by what the system itself says of it: `args`, its
 * arguments one by one, and `exe`, the file it runs. Never by its command line read as text, which a path with a
 * space in it, an empty argument or a first argument that isn't the program's name each make say something else
 * (`node /review/grade.js suite/run/log.txt` holds the text of a folder named "/review/grade.js suite/run").
 *
 * It does when:
 * - the file it runs is inside the folder (a tool of node_modules), or its first argument leads into the folder
 *   and is that same file under another name (a venv's python, a link to the python elsewhere);
 * - it is a runner, by the file it runs and by its first argument alike, with a path into the folder as the
 *   argument right after (`node <script>`, `python <script>`), or right after its `run` (`bun run`, `uv run`,
 *   `deno run`). The two names have to be the same runner, by any name it goes by: a node process whose first
 *   argument is python3 runs a script called python3.
 * These are the forms known to execute the path. With an option before it, the path may be that option's value
 * (`uv run --project <folder>/project grade.py`, `node --require <folder>/hook.js elsewhere.js`) or an argument
 * of a program given inline (`node --eval=... <folder>/turn-1.jsonl`): programs from elsewhere, a grader's. Which
 * options do which differs by runner and version, so a process with any is left alone. A path of the folder
 * anywhere later, or among any other program's arguments, is a file being looked at; so is a sibling folder
 * whose name starts alike, and a path that starts in the folder and leaves it again through `..`.
 *
 * Left running knowingly, of the run's own: a script a shell runs (`sh <folder>/tool.sh`, or one whose first line
 * is `#!/bin/sh`: a shell is no runner here, since what a shell runs is as often a line of commands as a file),
 * and a script whose first line gives its interpreter an option (`#!/usr/bin/python3 -u`), which is an option
 * before the path like any other. If one of them serves the folder, the second sweep finds it.
 */
export function runsFrom(args: string[], dir: string, exe: string) {
  if (!exe) return false;
  // (spelled as the system compares paths: its separators, and its case where it ignores it)
  const spell = (s: string) => { const t = WIN ? s.replaceAll('\\', '/') : s; return caseless ? t.toLowerCase() : t; };
  const d = spell(path.resolve(dir)).replace(/\/+$/, '');
  const leads = (k: number) => { const t = args[k]; return t !== undefined && spell(t).startsWith(`${d}/`) && within(dir, t); };
  if (within(dir, exe) && norm(exe) !== norm(dir)) return true;
  if (leads(0) && sameFile(args[0]!, exe)) return true;
  const runs = nameOf(exe), first = nameOf(args[0] ?? '');
  if (runner(runs) && runner(runs) === runner(first) && leads(1)) return true;
  return RUNS.test(runs) && runs === first && args[1] === 'run' && leads(2);
}

/** The folder the dev server on 127.0.0.1:<port> says it serves (an audara preview's /__audara), and its process when it names one. */
async function served(port: number): Promise<{ root: string; pid?: number } | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/__audara`, { signal: AbortSignal.timeout(800) });
    if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) {
      const j = (await r.json()) as { root?: unknown; pid?: unknown };
      if (typeof j.root === 'string' && j.root) return { root: j.root, ...(typeof j.pid === 'number' ? { pid: j.pid } : {}) };
    } else await r.body?.cancel();
  } catch { /* nothing there, or not HTTP */ }
  return null;
}

/**
 * Stops what a run left running from its folder `dir`: the processes that run a program from it, and the dev
 * servers that serve it or a folder inside it. Returns what it stopped, for the run's record.
 */
export async function stopLeftRunning(dir: string): Promise<{ pid: number; why: string }[]> {
  const procs = processes(), byPid = new Map(procs.map((p) => [p.pid, p]));
  // (this process and the ones it descends from: a shell that started the harness with --work <dir> names it too)
  const mine = new Set<number>();
  for (let p: number | undefined = process.pid, n = 0; p && !mine.has(p) && n < 64; p = byPid.get(p)?.ppid, n++) mine.add(p);
  const stopped: { pid: number; why: string }[] = [];
  const stop = (pid: number, why: string) => {
    if (mine.has(pid) || stopped.some((s) => s.pid === pid)) return;
    stopTree(pid);
    stopped.push({ pid, why });
  };
  for (const p of procs) if (p.args && p.exe && runsFrom(p.args, dir, p.exe)) stop(p.pid, 'it runs a program from the folder');
  // (asked: the ports a node or bun process listens on, which a preview is; a port can have more listeners, of
  // any kind and on other addresses, and all of them count when the answer is matched to one)
  const listeners = listening();
  const ports = new Set(listeners.filter((l) => !mine.has(l.pid) && /\b(node|bun)(\.exe)?\b/i.test(byPid.get(l.pid)?.cmd ?? '')).map((l) => l.port));
  await Promise.all([...ports].map(async (port) => {
    const s = await served(port);
    if (!s || !within(dir, s.root)) return;
    const pid = answerer(listeners, port, s.pid);
    if (pid !== undefined) stop(pid, `it serves ${s.root} on port ${port}`);
    else console.error(`left running: port ${port} answers for ${s.root}, but ${s.pid === undefined ? 'its answer names no process' : `the process its answer names (${s.pid}) doesn't listen there on 127.0.0.1`}: stop it by hand if it is the run's`);
  }));
  return stopped;
}
