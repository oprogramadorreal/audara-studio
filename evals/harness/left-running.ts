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
// - every process whose command line names the folder (`render.ts preview` runs the project's own
//   node_modules/vite by its full path);
// - every dev server that answers /__audara with a folder inside it, on whatever port: one started by hand from
//   the folder (`node node_modules/vite/bin/vite.js --port 5240`) names it nowhere in its command line, and sits
//   outside the ports a preview is looked for on. Only ports a node or bun process listens on are asked.
// Neither touches this process or the ones it descends from, whatever their command lines name.
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

/** Every local TCP port something listens on, with the process that does. */
function listening(): { port: number; pid: number }[] {
  const rows: { port: number; pid: number }[] = [];
  if (WIN) {
    const out = text(['powershell', '-NoProfile', '-Command', 'Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object { "$($_.LocalPort)`t$($_.OwningProcess)" }']);
    for (const line of out.split(/\r?\n/)) { const m = /^(\d+)\t(\d+)$/.exec(line.trim()); if (m) rows.push({ port: Number(m[1]), pid: Number(m[2]) }); }
  } else {
    // (lsof -F: a "p<pid>" line, then an "n<address>:<port>" line for each socket of that process)
    let pid = 0;
    for (const line of text(['lsof', '-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn']).split('\n')) {
      if (line.startsWith('p')) pid = Number(line.slice(1));
      else if (line.startsWith('n')) { const m = /:(\d+)$/.exec(line); if (m && pid) rows.push({ port: Number(m[1]), pid }); }
    }
  }
  return rows;
}

const norm = (p: string) => { const r = path.resolve(p).split(path.sep).join('/').replace(/\/+$/, ''); return caseless ? r.toLowerCase() : r; };
/** Whether `p` is the folder `dir` or inside it, compared as the file system compares paths. */
export function within(dir: string, p: string) {
  const d = norm(dir), x = norm(p);
  return x === d || x.startsWith(`${d}/`);
}
/** Whether a command line names the folder `dir` or a path inside it (and not a sibling whose name starts alike). */
export function names(cmd: string, dir: string) {
  const fold = (s: string) => (caseless ? s.toLowerCase() : s);
  const c = fold(cmd).replaceAll('\\', '/'), d = fold(path.resolve(dir)).split(path.sep).join('/').replace(/\/+$/, '');
  for (let i = c.indexOf(d); i >= 0; i = c.indexOf(d, i + 1)) {
    const after = c[i + d.length];
    if (after === undefined || /[\/"'\s]/.test(after)) return true;
  }
  return false;
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
 * Stops what a run left running from its folder `dir`: the processes whose command line names it, and the dev
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
  for (const p of procs) if (names(p.cmd, dir)) stop(p.pid, 'its command line names the folder');
  const servers = listening().filter((l) => /\b(node|bun)(\.exe)?\b/i.test(byPid.get(l.pid)?.cmd ?? '') && !mine.has(l.pid));
  const ports = [...new Map(servers.map((s) => [s.port, s.pid])).entries()];
  await Promise.all(ports.map(async ([port, owner]) => {
    const s = await served(port);
    if (s && within(dir, s.root)) stop(s.pid ?? owner, `it serves ${s.root} on port ${port}`);
  }));
  return stopped;
}
