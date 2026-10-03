#!/usr/bin/env bun
// Task evals: run a realistic multi-turn request in a fresh folder, headless, with the skills linked in
// (or without them, for the baseline arm), and keep everything a grader needs: each turn's transcript,
// the folder as it ends up, and timings. Grading is separate (evals/README.md).
//
//   bun evals/harness/task.ts --case evals/tasks/<id> --tool claude|codex [--model <id>] [--without]
//       [--work <dir>] [--keep-sessions]
//
// A case folder holds case.json:
//   { "id", "skill", "setup": { "files": [fixture name | "<path, $ENV allowed> => <name>"], "project": "init" | null,
//       "from": "<dir to copy>", "env": {...}, "mock": "elevenlabs", "decoy": <port> }, "turns": [{ "prompt": "..." }, ...],
//     "timeoutMinutes": 45, "assertions": ["..."] }
// The first turn starts a session; each later turn resumes it, as a director replying would. "mock":
// "elevenlabs" starts evals/mocks/elevenlabs.py on a free port and points ELEVENLABS_BASE_URL at it (with a
// fake key), so a case can check that nothing is spent before the user says yes. "decoy": <port> keeps an
// unrelated Vite app answering on 127.0.0.1:<port> for the whole run, so a case can check that the agent
// links its own project's preview, not whatever answers on the port.
//
// result.json also lists the audara previews that answered during the run and the folder each serves (they
// die with the session). A Codex run's session files, its sub-agents' included, are copied to
// codex-sessions/: `codex exec --json` leaves some tool calls out of the transcripts.
import { mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync, copyFileSync, cpSync, existsSync, readdirSync, statSync, renameSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ensureFixtures } from './fixtures';
import { cleanCodexTrust } from './codex-trust-cleanup';
import { cleanClaudeProjects } from './claude-projects-cleanup';

const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const flag = (k: string) => argv.includes(`--${k}`);

const REPO = path.resolve(import.meta.dir, '..', '..');
const CASE_DIR = path.resolve(opt('case')!);
const CASE = JSON.parse(readFileSync(path.join(CASE_DIR, 'case.json'), 'utf8')) as {
  id: string; skill: string; setup?: { files?: string[]; project?: 'init' | null; from?: string; env?: Record<string, string>; mock?: 'elevenlabs'; decoy?: number };
  turns: { prompt: string }[]; timeoutMinutes?: number; assertions: string[];
};
const TOOL = opt('tool', 'claude') as 'claude' | 'codex';
const MODEL = opt('model');
const ARM = flag('without') ? 'without' : 'with';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const T0 = Date.now();
const RUN = path.resolve(opt('work', path.join(REPO, 'evals', 'results', 'tasks', `${CASE.id}-${TOOL}${MODEL ? '-' + MODEL : ''}-${ARM}-${STAMP}`))!);
const WORK = path.join(RUN, 'work');
const TIMEOUT_MS = (CASE.timeoutMinutes ?? 45) * 60_000;
// (a dev server or Codex may spell the folder's path in another case, which names the same folder on Windows)
const isWork = (p: string) => {
  const n = (x: string) => path.resolve(x).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? n(p).toLowerCase() === n(WORK).toLowerCase() : n(p) === n(WORK);
};

// ---------------------------------------------------------------- setup
mkdirSync(WORK, { recursive: true });
const fixtures = ensureFixtures(path.join(REPO, 'evals', 'results', 'fixtures'));
const expand = (s: string) => s.replace(/\$(\w+)/g, (_, k) => {
  if (!process.env[k]) throw new Error(`this case needs the environment variable ${k} (see evals/README.md)`);
  return process.env[k]!;
});
// a project made earlier, as a user would have it: without its dependencies, renders, history or the skill
// links an earlier eval run put in it
if (CASE.setup?.from) cpSync(path.resolve(CASE_DIR, expand(CASE.setup.from)), WORK, {
  recursive: true, filter: (s) => !/[\\/](node_modules|out|\.git|\.claude[\\/]skills|\.agents[\\/]skills)([\\/]|$)/.test(s),
});
for (const f of CASE.setup?.files ?? []) {
  const [src, as] = f.includes('=>') ? f.split('=>').map((x) => x.trim()) as [string, string] : [f, path.basename(f)];
  const from = expand(src);
  copyFileSync(path.isAbsolute(from) ? from : existsSync(path.join(CASE_DIR, from)) ? path.join(CASE_DIR, from) : path.join(fixtures, from), path.join(WORK, as));
}
if (CASE.setup?.project === 'init') {
  const p = Bun.spawnSync(['bun', path.join(REPO, 'skills', 'code-video', 'scripts', 'init.ts'), WORK], { stdout: 'pipe', stderr: 'pipe' });
  if (p.exitCode !== 0) throw new Error(`init failed:\n${p.stdout}\n${p.stderr}`);
}
if (CASE.setup?.from || CASE.setup?.project === 'init') {
  if (existsSync(path.join(WORK, 'package.json')) && !existsSync(path.join(WORK, 'node_modules'))) Bun.spawnSync(['bun', 'install'], { cwd: WORK });
}
Bun.spawnSync(['git', 'init', '-q'], { cwd: WORK });
Bun.spawnSync(['git', 'add', '-A'], { cwd: WORK });
Bun.spawnSync(['git', '-c', 'user.name=eval', '-c', 'user.email=eval@local', 'commit', '-qm', 'eval setup', '--allow-empty'], { cwd: WORK });
if (ARM === 'with') {
  const link = TOOL === 'claude' ? path.join(WORK, '.claude', 'skills') : path.join(WORK, '.agents', 'skills');
  mkdirSync(link, { recursive: true });
  for (const s of ['code-video', 'soundtrack']) symlinkSync(path.join(REPO, 'skills', s), path.join(link, s), 'junction');
  // the links are the harness's, not the work's: keep them out of git status
  writeFileSync(path.join(WORK, '.git', 'info', 'exclude'), '.claude/skills/\n.agents/skills/\n');
}

// ---------------------------------------------------------------- previews
// The audara previews on Vite's ports (5173-5199), each with the folder it serves (its /__audara), looked
// for every 10 s during the turns and once after the last: a session's preview dies with it (Claude Code
// stops its background shells when `claude -p` exits), and runs going at once can reach each other's
// previews, so only the root tells this run's apart.
const previews = new Map<string, { port: number; root: string; thisRun: boolean; turns: number[]; atEnd: boolean }>();
/** The folder the audara preview on 127.0.0.1:<port> serves; null when nothing, or another kind of server, answers. */
async function previewRoot(port: number) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/__audara`, { signal: AbortSignal.timeout(3000) });
    if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) {
      const { root } = (await r.json()) as { root?: unknown };
      return typeof root === 'string' && root ? root : null;
    }
    await r.body?.cancel();
  } catch { /* nothing there */ }
  return null;
}
/** What answers on 127.0.0.1:<port>: an audara preview and the folder it serves, or another server's page title. */
async function answerAt(port: number) {
  const root = await previewRoot(port);
  if (root) return { audara: true, root, thisRun: isWork(root) };
  try {
    const page = await (await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(3000) })).text();
    return { audara: false, title: /<title>([^<]*)<\/title>/i.exec(page)?.[1]?.trim() ?? page.slice(0, 80) };
  } catch {
    return { audara: false, title: '(no HTTP answer)' };
  }
}
async function lookForPreviews(turn: number | 'end') {
  await Promise.all(Array.from({ length: 27 }, async (_, i) => {
    const port = 5173 + i, root = await previewRoot(port);
    if (!root) return;
    const p = previews.get(`${port} ${root}`) ?? { port, root, thisRun: isWork(root), turns: [], atEnd: false };
    if (turn === 'end') p.atEnd = true;
    else if (!p.turns.includes(turn)) p.turns.push(turn);
    previews.set(`${port} ${root}`, p);
  }));
}

// ---------------------------------------------------------------- turns
const env: Record<string, string | undefined> = { ...process.env, ...(CASE.setup?.env ?? {}) };
delete env.ELEVENLABS_API_KEY; // a case decides whether there is a key; never the real one
let mock: ReturnType<typeof Bun.spawn> | null = null;
if (CASE.setup?.mock === 'elevenlabs') {
  const m = Bun.spawn(['uv', 'run', path.join(REPO, 'evals', 'mocks', 'elevenlabs.py'), '--port', '0', '--log', path.join(RUN, 'mock-requests.jsonl')], { stdout: 'pipe', stderr: 'pipe' });
  mock = m;
  // it prints "PORT <n>" once it listens: waiting for that line rather than sending a request keeps the
  // harness out of the request log, which then holds only the session's requests
  const port = await Promise.race([
    (async () => {
      let said = '';
      for await (const chunk of m.stdout) {
        said += new TextDecoder().decode(chunk);
        const hit = /PORT (\d+)/.exec(said);
        if (hit) return hit[1];
      }
      return null;
    })(),
    // (unref'd: once the mock is up, this wait mustn't keep the run open at the end)
    new Promise<null>((done) => setTimeout(done, 120_000, null).unref()),
  ]);
  if (!port) { stopTree(m.pid); throw new Error(`the ElevenLabs mock did not start:\n${await new Response(m.stderr).text()}`); }
  env.ELEVENLABS_BASE_URL = `http://127.0.0.1:${port}`;
  env.ELEVENLABS_API_KEY = 'eval-fake-key-0f3a9c';
}

// "decoy": what another project's Vite dev server, left running on a developer's machine, answers: its
// index.html with Vite's client script for every path (the single-page fallback), /__audara included, where
// an audara preview answers JSON with the folder it serves. A port that is taken already stays with what
// holds it, which is recorded, and the decoy takes it over if it frees up (another run's decoy ending).
const DECOY_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <script type="module" src="/@vite/client"></script>

    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vite + TS</title>
  </head>
  <body>
    <div id="app"><h1>Vite + TypeScript</h1><button type="button">count is 0</button></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`;
const decoy = CASE.setup?.decoy ? { port: CASE.setup.decoy } as { port: number; heldBy?: Awaited<ReturnType<typeof answerAt>>; servedFrom?: string } : null;
let decoyServer = null as ReturnType<typeof Bun.serve> | null;
let decoyRetry: ReturnType<typeof setInterval> | undefined;
if (decoy) {
  const take = (from: string) => {
    try {
      decoyServer = Bun.serve({
        hostname: '127.0.0.1', port: decoy.port,
        fetch(req) {
          const p = new URL(req.url).pathname;
          // (its scripts answer as scripts, so a browser shows a page rather than errors)
          return p === '/@vite/client' || /\.[jt]s$/.test(p)
            ? new Response('export {};\n', { headers: { 'content-type': 'text/javascript' } })
            : new Response(DECOY_PAGE, { headers: { 'content-type': 'text/html', 'cache-control': 'no-cache' } });
        },
      });
    } catch { return false; }
    decoy.servedFrom = from;
    return true;
  };
  if (!take('start of run')) {
    decoy.heldBy = await answerAt(decoy.port);
    const h = decoy.heldBy;
    console.log(`decoy: 127.0.0.1:${decoy.port} is taken (by ${'root' in h ? `the audara preview of ${h.root}` : `"${h.title}"`}), so the session meets that there until the port frees up`);
    decoyRetry = setInterval(() => { if (take(new Date().toISOString())) clearInterval(decoyRetry); }, 1000);
  }
}

let session: string | null = null;
const turns: { prompt: string; started: string; exit: number | null; seconds: number; transcript: string; timedOut?: boolean }[] = [];
for (const [i, t] of CASE.turns.entries()) {
  const first = i === 0;
  const cmd = TOOL === 'claude'
    ? ['claude', '-p', t.prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'auto',
       ...(MODEL ? ['--model', MODEL] : []), ...(first ? [] : ['--resume', session!])]
    // (codex is a .cmd shim on Windows: prompts go on stdin)
    : first
      ? ['codex', 'exec', '--json', '--skip-git-repo-check', '--approve-for-me', '-C', WORK, ...(MODEL ? ['-m', MODEL] : []), '-']
      : ['codex', 'exec', 'resume', '--json', '--skip-git-repo-check', ...(MODEL ? ['-m', MODEL] : []), session!, '-'];
  const t0 = performance.now(), started = new Date().toISOString();
  const p = Bun.spawn(cmd, { cwd: WORK, env, stdin: TOOL === 'codex' ? new Blob([t.prompt]) : 'ignore', stdout: 'pipe', stderr: 'pipe' });
  let timedOut = false;
  // (the whole tree: stopping codex's .cmd shim alone leaves the session running, and the turn waiting for it)
  const timer = setTimeout(() => { timedOut = true; try { stopTree(p.pid); } catch { /* it ended meanwhile */ } }, TIMEOUT_MS);
  const watch = setInterval(() => void lookForPreviews(i + 1), 10_000);
  const out = await new Response(p.stdout).text();
  const err = await new Response(p.stderr).text();
  const exit = await p.exited;
  clearTimeout(timer);
  clearInterval(watch);
  const file = path.join(RUN, `turn-${i + 1}.jsonl`);
  writeFileSync(file, out);
  if (err.trim()) writeFileSync(path.join(RUN, `turn-${i + 1}.stderr.txt`), err);
  // (marked: a turn stopped at the timeout has no reply, and the next prompt answers one nobody saw)
  turns.push({ prompt: t.prompt, started, exit, seconds: Math.round((performance.now() - t0) / 1000), transcript: path.basename(file), ...(timedOut ? { timedOut } : {}) });
  console.log(`turn ${i + 1}/${CASE.turns.length}: exit ${exit}, ${turns.at(-1)!.seconds}s${timedOut ? ', stopped at the timeout' : ''}`);
  if (first) {
    for (const line of out.split('\n')) {
      try { const ev = JSON.parse(line); session ??= ev.session_id ?? ev.thread_id ?? null; } catch { /* not json */ }
    }
    if (!session) { console.error(`no session id in the first turn's output; see ${file}`); break; }
  }
}

// ---------------------------------------------------------------- what the folder looks like now
function tree(dir: string, base = dir, out: { path: string; bytes: number }[] = []) {
  for (const e of readdirSync(dir)) {
    if (['node_modules', '.git'].includes(e)) continue;
    const p = path.join(dir, e), s = statSync(p, { throwIfNoEntry: false });
    if (!s) continue;
    if (s.isDirectory()) { if (!/^\.(claude|agents)$/.test(e) || dir !== base) tree(p, base, out); }
    else out.push({ path: path.relative(base, p).replaceAll('\\', '/'), bytes: s.size });
  }
  return out;
}
await lookForPreviews('end');
const status = Bun.spawnSync(['git', 'status', '--porcelain', '--untracked-files=all'], { cwd: WORK }).stdout.toString();
writeFileSync(path.join(RUN, 'result.json'), JSON.stringify({
  case: CASE.id, skill: CASE.skill, tool: TOOL, model: MODEL ?? 'default', arm: ARM, session,
  ...(CASE.setup?.from ? { from: path.resolve(CASE_DIR, expand(CASE.setup.from)) } : {}), turns,
  ...(decoy ? { decoy } : {}), previews: [...previews.values()],
  gitStatus: status.split('\n').filter(Boolean), files: tree(WORK), assertions: CASE.assertions,
}, null, 1));

// ---------------------------------------------------------------- stop what the run left running
// The skill tells the agent to keep the preview running in the background, so a headless session ends with
// its dev server still up; and killing `uv` alone leaves the mock's Python running (on Windows a child
// outlives its parent), holding this process open. Stop every process started from the run's folder, the
// mock with its whole tree, and the decoy.
function stopTree(pid: number) {
  if (process.platform === 'win32') Bun.spawnSync(['taskkill', '/T', '/F', '/PID', String(pid)], { stdout: 'ignore', stderr: 'ignore' });
  else Bun.spawnSync(['pkill', '-TERM', '-P', String(pid)]), process.kill(pid);
}
function stopUnder(dir: string) {
  const needle = dir.toLowerCase().replaceAll("'", "''");
  const pids = process.platform === 'win32'
    ? Bun.spawnSync(['powershell', '-NoProfile', '-Command',
        `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains('${needle}') } | ForEach-Object { $_.ProcessId }`]).stdout.toString()
    : Bun.spawnSync(['pgrep', '-f', dir]).stdout.toString();
  for (const p of pids.split(/\s+/).filter(Boolean).map(Number)) if (p !== process.pid) stopTree(p);
}
if (mock?.pid) stopTree(mock.pid);
clearInterval(decoyRetry);
decoyServer?.stop(true);
stopUnder(WORK);

// ---------------------------------------------------------------- Codex's own record of the session
// `codex exec --json` leaves some tool calls out of the transcripts (spawn_agent, view_image), and each
// sub-agent keeps a session of its own: copy every session file written during the run whose session ran
// in the run's folder, the main thread's and its sub-agents', to codex-sessions/.
if (TOOL === 'codex') {
  const root = path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'sessions');
  // (in YYYY/MM/DD folders of the local date each session started: the run's days, and a day either side)
  const days = new Set<string>();
  for (let t = T0 - 86_400_000; t < Date.now() + 86_400_000; t += 3_600_000) {
    const d = new Date(t);
    days.add(path.join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')));
  }
  let n = 0;
  for (const dir of days) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      const file = path.join(dir, f);
      if (!/^rollout-.*\.jsonl$/.test(f) || statSync(file).mtimeMs < T0) continue;
      let cwd: unknown;
      try { cwd = JSON.parse(readFileSync(file, 'utf8').split('\n', 1)[0]!).payload?.cwd; } catch { continue; }
      if (typeof cwd !== 'string' || !isWork(cwd)) continue;
      mkdirSync(path.join(RUN, 'codex-sessions'), { recursive: true });
      copyFileSync(file, path.join(RUN, 'codex-sessions', f));
      n++;
    }
  }
  console.log(n ? `codex-sessions/: ${n} session file${n === 1 ? '' : 's'} (the main thread's and any sub-agents')` : `no Codex session file under ${root} ran in ${WORK}`);
}

// ---------------------------------------------------------------- leave the user's config as it was
if (TOOL === 'codex') cleanCodexTrust(false, [], RUN);
if (TOOL === 'claude' && !flag('keep-sessions')) {
  // headless sessions are saved under ~/.claude/projects/<folder slug>: move this run's next to its results
  const projects = path.join(os.homedir(), '.claude', 'projects');
  const slug = WORK.replace(/[^A-Za-z0-9]/g, '-');
  for (const d of readdirSync(projects)) if (d.toLowerCase() === slug.toLowerCase()) renameSync(path.join(projects, d), path.join(RUN, 'claude-session'));
  // (subagents and tools may have opened sessions in subfolders of the run: those go too)
  cleanClaudeProjects(false, path.join(RUN, 'claude-sessions-other'), RUN);
}
console.log(RUN);
