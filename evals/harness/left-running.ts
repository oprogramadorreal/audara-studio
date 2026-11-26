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
//   python, uv ...) whose script is (`render.ts preview` runs the project's own node_modules/vite by its full
//   path);
// - every dev server that answers /__audara with a folder inside it, on whatever port: one started by hand from
//   the folder (`node node_modules/vite/bin/vite.js --port 5240`) names it nowhere in its command line, and sits
//   outside the ports a preview is looked for on. Only ports a node or bun process listens on are asked, and the
//   process stopped is the one the answer names, when the system says it listens there on the address asked.
// Neither touches this process or the ones it descends from, whatever their command lines name. And neither
// stops a process for naming the folder further on in its command line: that is something else looking at the
// run's files (an editor on one of them, a player on its draft, a grader's script reading its transcript), which
// a sweep by any mention would close with everything its tree holds. Where the evidence is short of that (an
// option before the path that may take it as its value, an answer that names no process or one that doesn't
// listen there), the process is left running and, for a server, the port is printed.
import path from 'node:path';

const WIN = process.platform === 'win32';
const caseless = WIN || process.platform === 'darwin';

/** Stops a process with its whole tree (on Windows a child outlives its parent). */
export function stopTree(pid: number) {
  if (WIN) Bun.spawnSync(['taskkill', '/T', '/F', '/PID', String(pid)], { stdout: 'ignore', stderr: 'ignore' });
  else { Bun.spawnSync(['pkill', '-TERM', '-P', String(pid)]); try { process.kill(pid); } catch { /* it ended meanwhile */ } }
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
/** The addresses whose listener gets what is sent to 127.0.0.1: that one, and each way of saying "every address". */
const LOOPBACK = new Set(['127.0.0.1', '0.0.0.0', '::', '*']);
/**
 * The process to stop for a server that answered on 127.0.0.1:<port> for the run's folder, naming `named` as its
 * process: `named`, when the system says it listens on that port at an address the request could reach. Any other
 * answer stops nothing. One that names no process leaves the choice to a guess at the port's listeners, where a
 * proxy on that address and an unrelated service on another are told apart by nothing. One that names a process
 * that doesn't listen there is stale, wrong, or passed on by somebody else's proxy.
 */
export function answerer(listeners: Listener[], port: number, named: number | undefined): number | undefined {
  return named !== undefined && listeners.some((l) => l.port === port && l.pid === named && LOOPBACK.has(l.address)) ? named : undefined;
}

const norm = (p: string) => { const r = path.resolve(p).split(path.sep).join('/').replace(/\/+$/, ''); return caseless ? r.toLowerCase() : r; };
/** Whether `p` is the folder `dir` or inside it, compared as the file system compares paths. */
export function within(dir: string, p: string) {
  const d = norm(dir), x = norm(p);
  return x === d || x.startsWith(`${d}/`);
}
/** The programs that run a script: node, bun, deno, python (python3.12, pythonw, py), uv. */
const RUNNER = /^(node|nodejs|bun|deno|python[\d.]*w?|py|uv|uvx)(\.exe)?$/i;
/** The runners whose `run` takes the script next: `bun run`, `uv run`, `deno run`. */
const RUNS = /^(bun|uv|deno)(\.exe)?$/i;
/**
 * Whether a command line runs a program from the folder `dir`: its executable is inside the folder (a venv's
 * python, a tool of node_modules), or it is a runner whose script is. The script is told from an option's value
 * by what stands right before it: the runner itself, its `run` (`bun run`, `uv run`), or an option that carries
 * its own value (`--max-old-space-size=4096`). After any other option the path may be that option's value
 * (`uv run --project <folder>/project grade.py`, `node --require <folder>/hook.js elsewhere.js`: programs from
 * elsewhere), and which options take one differs by runner and version, so such a command line is left alone. A
 * path of the folder anywhere later, or in any other program's command line, is a file being looked at, not a
 * program of the run; so is a sibling folder whose name starts alike.
 */
export function runsFrom(cmd: string, dir: string) {
  const fold = (s: string) => (caseless ? s.toLowerCase() : s);
  const c = fold(cmd).replaceAll('\\', '/'), d = fold(path.resolve(dir)).split(path.sep).join('/').replace(/\/+$/, '');
  // (the first path inside the folder is the one that counts: a script comes before its own arguments)
  const i = c.indexOf(`${d}/`);
  if (i < 0) return false;
  const before = c.slice(0, i);
  if (/^\s*["']?$/.test(before)) return true;
  const m = /^\s*(?:"([^"]+)"|'([^']+)'|(\S+))((?:\s+\S+)*)\s+["']?$/.exec(before);
  if (!m) return false;
  const runner = (m[1] ?? m[2] ?? m[3])!.split('/').pop()!;
  if (!RUNNER.test(runner)) return false;
  const between = m[4]!.trim().split(/\s+/).filter(Boolean), last = between.at(-1);
  if (!between.every((t) => t.startsWith('-') || t === 'run')) return false;
  return last === undefined || /^--?[^=]+=./.test(last) || (last === 'run' && RUNS.test(runner) && between.indexOf('run') === between.length - 1);
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
