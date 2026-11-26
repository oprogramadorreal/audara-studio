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
// - every process that runs a program from the folder: its executable is inside it, or it is a runner (node, bun,
//   python, uv run ...) with the script right after it (`render.ts preview` runs the project's own
//   node_modules/vite that way, by its full path), by its command line and by the name the system itself has
//   for the program, which have to agree;
// - every dev server that answers /__audara with a folder inside it, on whatever port: one started by hand from
//   the folder (`node node_modules/vite/bin/vite.js --port 5240`) names it nowhere in its command line, and sits
//   outside the ports a preview is looked for on. Only ports a node or bun process listens on are asked, and the
//   process stopped is the one the answer names, when the system says it alone could have answered there.
// Neither touches this process or the ones it descends from, whatever their command lines name. And neither
// stops a process for naming the folder further on in its command line: that is something else looking at the
// run's files (an editor on one of them, a player on its draft, a grader's script reading its transcript), which
// a sweep by any mention would close with everything its tree holds. Where the evidence is short of that (an
// option before the path, a path that leaves the folder again through `..` or may, a path with a space in it
// where the command line doesn't say where an argument ends, an answer that names no process, or one that
// doesn't listen there, or two processes that could have answered), the process is left running and, for a
// server, the port is printed. So outside Windows a run in a folder whose path has a space keeps the first
// sweep's processes: `ps` joins a command's arguments with spaces and marks nothing. Its servers are still found.
import { realpathSync } from 'node:fs';
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

interface Proc { pid: number; ppid: number; name: string; cmd: string }
/**
 * Every process there is: its id, its parent's, its command line, and the name the system itself has for the
 * program it runs (Windows' image name; elsewhere the kernel's, `comm`, which macOS's ps calls `ucomm`, cut at
 * 15 or 16 characters): the one thing here a process's own arguments don't write. Empty when the system
 * doesn't say.
 */
function processes(): Proc[] {
  const rows: Proc[] = [];
  if (WIN) {
    const out = text(['powershell', '-NoProfile', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.Name)`t$($_.CommandLine)" }']);
    for (const line of out.split(/\r?\n/)) {
      const m = /^(\d+)\t(\d+)\t([^\t]*)\t(.*)$/.exec(line);
      if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), name: m[3]!, cmd: m[4]! });
    }
    return rows;
  }
  // (asked apart: a name may hold spaces, and only a line's last column can be told from the ones before it)
  const names = new Map<number, string>();
  for (const line of text(['ps', '-eo', `pid=,${process.platform === 'darwin' ? 'ucomm' : 'comm'}=`]).split('\n')) {
    const m = /^\s*(\d+) (.*)$/.exec(line);
    if (m) names.set(Number(m[1]), m[2]!.trimEnd());
  }
  for (const line of text(['ps', '-eo', 'pid=,ppid=,args=']).split('\n')) {
    // (ps puts one space between two columns: any more after the parent's number is the command's own, an empty
    // first argument, kept for `words`)
    const m = /^\s*(\d+)\s+(\d+) (.*)$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), name: names.get(Number(m[1])) ?? '', cmd: m[3]! });
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
/** One argument of a command line, and whether the line says where it ends. */
export interface Word { text: string; whole: boolean }
const blank = (ch: string | undefined) => ch === ' ' || ch === '\t';
/**
 * A command line's arguments, as far as its text says where each one ends.
 * - Windows keeps the line as it was given, quotes and all, and they are read here by the rules its programs read
 *   them by (CommandLineToArgvW): every argument after the program's name is whole. The name is whole when it is
 *   quoted; unquoted it is taken to the first space, though Windows may have run a path that goes on past it.
 * - Elsewhere ps joins the arguments with one space each and marks nothing: one with a space in it comes apart,
 *   so no word is known to be whole, and a quote is a character like any other. An empty argument stays, as the
 *   nothing between two spaces: `node '' <folder>/log.txt` runs what it is given on its input, the path its
 *   argument, and dropping the empty one would read the path as the script.
 */
export function words(cmd: string, windows = WIN): Word[] {
  if (!windows) return cmd ? cmd.split(' ').map((text) => ({ text, whole: false })) : [];
  const out: Word[] = [];
  let i = 0;
  while (blank(cmd[i])) i++;
  if (i >= cmd.length) return out;
  // (the program's name: to its closing quote or to the first space, and no backslash is special in it)
  if (cmd[i] === '"') {
    const j = cmd.indexOf('"', i + 1), end = j < 0 ? cmd.length : j;
    out.push({ text: cmd.slice(i + 1, end), whole: true });
    i = end + 1;
  } else {
    let j = i;
    while (j < cmd.length && !blank(cmd[j])) j++;
    out.push({ text: cmd.slice(i, j), whole: false });
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
    out.push({ text, whole: true });
  }
}

/** The programs that run the script given first: node, bun, deno, python (python3.12, pythonw, py). */
const RUNNER = /^(node|nodejs|bun|deno|python[\d.]*w?|py)(\.exe)?$/i;
/** The ones whose `run` takes the script next: `bun run`, `uv run`, `deno run`. */
const RUNS = /^(bun|uv|deno)(\.exe)?$/i;
/** A `..` among a path's parts. */
const UP = /(^|[\\/])\.\.([\\/]|$)/;
/**
 * Whether a command line runs a program from the folder `dir`: its executable is inside the folder (a venv's
 * python, a tool of node_modules), or it is a runner with the script right after it (`node <script>`, `python
 * <script>`), or right after its `run` (`bun run`, `uv run`, `deno run`). These are the forms known to execute the
 * path. With an option before it, the path may be that option's value (`uv run --project <folder>/project
 * grade.py`, `node --require <folder>/hook.js elsewhere.js`) or an argument of a program given inline (`node
 * --eval=... <folder>/turn-1.jsonl`): programs from elsewhere, a grader's. Which options do which differs by
 * runner and version, so a command line with any is left alone. A path of the folder anywhere later, or in any
 * other program's command line, is a file being looked at, not a program of the run; so is a sibling folder
 * whose name starts alike.
 *
 * The path is one argument of the line (`words`), never a stretch of its text, and it counts by where it leads:
 * - one that starts in the folder and leaves it again through `..` is another folder's program;
 * - where the line doesn't say where its arguments end, a path with a space in it is no one word, so a folder
 *   whose own path has a space matches nothing there (`node /review/grade.js suite/run/log.txt` is a grader and
 *   its argument, whatever a folder named "/review/grade.js suite/run" holds), and a word that may go on past a
 *   space, with a `..` further on, leads nobody knows where.
 *
 * And the line's first word is the program only when the system says so too. A command line is what a process
 * was given to show: its first argument can be empty, and macOS's ps then starts the line at the second, a file
 * of the folder that some other program is reading. So `name`, the system's own name for the program the process
 * runs (`processes`), has to agree: with the file the first word names (itself, or what it links to: a venv's
 * python) for an executable of the folder, and with a runner's name for a runner. A process the system gives no
 * name for is left running.
 *
 * `windows`: whether the line is one Windows kept as given (its quotes say where an argument ends) or one ps
 * joined; the system's own unless a test says.
 */
export function runsFrom(cmd: string, dir: string, name: string, windows = WIN) {
  // (spelled as the system compares paths: its separators, and its case where it ignores it)
  const spell = (s: string) => { const t = WIN ? s.replaceAll('\\', '/') : s; return caseless ? t.toLowerCase() : t; };
  const a = words(cmd, windows), d = spell(path.resolve(dir)).replace(/\/+$/, '');
  const leads = (k: number) => {
    const w = a[k];
    if (!w || !spell(w.text).startsWith(`${d}/`) || !within(dir, w.text)) return false;
    return w.whole || !a.slice(k + 1).some((x) => UP.test(x.text));
  };
  // (a file's name as a system has it for a process: the last part of its path, without Windows' .exe)
  const base = (p: string) => { const b = p.split(/[\\/]/).pop()!.replace(/\.exe$/i, ''); return caseless ? b.toLowerCase() : b; };
  const sys = base(name), first = a[0]?.text ?? '';
  if (!sys) return false;
  // (the kernel's name is cut at 15 characters, or 16: a name that long is the start of the file's)
  const named = (p: string) => { const b = base(p); return b === sys || (sys.length >= 15 && b.startsWith(sys)); };
  const linked = (p: string) => { try { return named(realpathSync(p)); } catch { return false; } };
  if (leads(0) && (named(first) || linked(first))) return true;
  return (RUNNER.test(sys) && RUNNER.test(base(first)) && leads(1)) || (RUNS.test(sys) && RUNS.test(base(first)) && a[1]?.text === 'run' && leads(2));
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
  for (const p of procs) if (runsFrom(p.cmd, dir, p.name)) stop(p.pid, 'it runs a program from the folder');
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
