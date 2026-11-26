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
//   node_modules/vite that way, by its full path);
// - every dev server that answers /__audara with a folder inside it, on whatever port: one started by hand from
//   the folder (`node node_modules/vite/bin/vite.js --port 5240`) names it nowhere in its command line, and sits
//   outside the ports a preview is looked for on. Only ports a node or bun process listens on are asked, and the
//   process stopped is the one the answer names, when the system says it alone could have answered there.
// Neither touches this process or the ones it descends from, whatever their command lines name. And neither
// stops a process for naming the folder further on in its command line: that is something else looking at the
// run's files (an editor on one of them, a player on its draft, a grader's script reading its transcript), which
// a sweep by any mention would close with everything its tree holds. Where the evidence is short of that (an
// option before the path, a path that leaves the folder again through `..` or may, an answer that names no
// process, or one that doesn't listen there, or two processes that could have answered), the process is left
// running and, for a server, the port is printed.
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
  if (WIN) { Bun.spawnSync(['taskkill', '/T', '/F', '/PID', String(pid)], { stdout: 'ignore', stderr: 'ignore' }); return; }
  for (const p of tree(processes(), pid)) try { process.kill(p); } catch { /* it ended meanwhile */ }
}

const text = (cmd: string[]) => { try { return Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'ignore' }).stdout.toString(); } catch { return ''; } };

interface Proc { pid: number; ppid: number; cmd: string }
/** Every process there is: its id, its parent's and its command line. */
function processes(): Proc[] {
  const out = WIN
    ? text(['powershell', '-NoProfile', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.CommandLine)" }'])
    : text(['ps', '-eo', 'pid=,ppid=,args=']);
  const rows: Proc[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = WIN ? /^(\d+)\t(\d+)\t(.*)$/.exec(line) : /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3]! });
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
/** The programs that run the script given first: node, bun, deno, python (python3.12, pythonw, py). */
const RUNNER = /^(node|nodejs|bun|deno|python[\d.]*w?|py)(\.exe)?$/i;
/** The ones whose `run` takes the script next: `bun run`, `uv run`, `deno run`. */
const RUNS = /^(bun|uv|deno)(\.exe)?$/i;
/**
 * Whether a command line runs a program from the folder `dir`: its executable is inside the folder (a venv's
 * python, a tool of node_modules), or it is a runner with the script right after it (`node <script>`, `python
 * <script>`), or right after its `run` (`bun run`, `uv run`, `deno run`). These are the forms known to execute the
 * path. With an option before it, the path may be that option's value (`uv run --project <folder>/project
 * grade.py`, `node --require <folder>/hook.js elsewhere.js`) or an argument of a program given inline (`node
 * --eval=... <folder>/turn-1.jsonl`): programs from elsewhere, a grader's. Which options do which differs by
 * runner and version, so a command line with any is left alone. A path of the folder anywhere later, or in any
 * other program's command line, is a file being looked at, not a program of the run; so is a sibling folder
 * whose name starts alike. The path counts by where it leads, not by how it starts: one that leaves the folder
 * again through `..` is another folder's program.
 */
export function runsFrom(cmd: string, dir: string) {
  const fold = (s: string) => (caseless ? s.toLowerCase() : s);
  const c = fold(cmd).replaceAll('\\', '/'), d = fold(path.resolve(dir)).split(path.sep).join('/').replace(/\/+$/, '');
  // (the first path inside the folder is the one that counts: a script comes before its own arguments)
  const i = c.indexOf(`${d}/`);
  if (i < 0) return false;
  const before = c.slice(0, i);
  // (the path as written, to its closing quote or the next space, and where it leads: <folder>/../sibling/grade.js
  // starts in the folder and is a sibling's program)
  const quote = /["']$/.exec(before)?.[0], rest = c.slice(i + d.length);
  const end = quote ? rest.indexOf(quote) : rest.search(/\s/);
  if (!within(d, d + (end < 0 ? rest : rest.slice(0, end)))) return false;
  // (unquoted, a path may go on past a space: ps joins a command's arguments with spaces, and Windows reads a
  // program's path that way. With a .. further on, where it leads isn't known)
  if (!quote && end >= 0 && /(^|[/\s])\.\.([/\s]|$)/.test(rest.slice(end))) return false;
  if (/^\s*["']?$/.test(before)) return true;
  const m = /^\s*(?:"([^"]+)"|'([^']+)'|(\S+))(\s+run)?\s+["']?$/.exec(before);
  if (!m) return false;
  const runner = (m[1] ?? m[2] ?? m[3])!.split('/').pop()!;
  return m[4] ? RUNS.test(runner) : RUNNER.test(runner);
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
  for (const p of procs) if (runsFrom(p.cmd, dir)) stop(p.pid, 'it runs a program from the folder');
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
