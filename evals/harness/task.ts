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
//       "from": "<dir to copy>", "env": {...}, "mock": "elevenlabs" }, "turns": [{ "prompt": "..." }, ...],
//     "timeoutMinutes": 45, "assertions": ["..."] }
// The first turn starts a session; each later turn resumes it, as a director replying would. "mock":
// "elevenlabs" starts evals/mocks/elevenlabs.py on a free port and points ELEVENLABS_BASE_URL at it (with a
// fake key), so a case can check that nothing is spent before the user says yes.
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
  id: string; skill: string; setup?: { files?: string[]; project?: 'init' | null; from?: string; env?: Record<string, string>; mock?: 'elevenlabs' };
  turns: { prompt: string }[]; timeoutMinutes?: number; assertions: string[];
};
const TOOL = opt('tool', 'claude') as 'claude' | 'codex';
const MODEL = opt('model');
const ARM = flag('without') ? 'without' : 'with';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const RUN = path.resolve(opt('work', path.join(REPO, 'evals', 'results', 'tasks', `${CASE.id}-${TOOL}${MODEL ? '-' + MODEL : ''}-${ARM}-${STAMP}`))!);
const WORK = path.join(RUN, 'work');
const TIMEOUT_MS = (CASE.timeoutMinutes ?? 45) * 60_000;

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

// ---------------------------------------------------------------- turns
const env: Record<string, string | undefined> = { ...process.env, ...(CASE.setup?.env ?? {}) };
delete env.ELEVENLABS_API_KEY; // a case decides whether there is a key; never the real one
let mock: ReturnType<typeof Bun.spawn> | null = null;
if (CASE.setup?.mock === 'elevenlabs') {
  const port = 18000 + Math.floor(Math.random() * 2000);
  mock = Bun.spawn(['uv', 'run', path.join(REPO, 'evals', 'mocks', 'elevenlabs.py'), '--port', String(port), '--log', path.join(RUN, 'mock-requests.jsonl')], { stdout: 'ignore', stderr: 'pipe' });
  for (let i = 0; i < 100; i++) { try { await fetch(`http://127.0.0.1:${port}/v1/models`); break; } catch { await Bun.sleep(200); } }
  env.ELEVENLABS_BASE_URL = `http://127.0.0.1:${port}`;
  env.ELEVENLABS_API_KEY = 'eval-fake-key-0f3a9c';
}
let session: string | null = null;
const turns: { prompt: string; exit: number | null; seconds: number; transcript: string }[] = [];
for (const [i, t] of CASE.turns.entries()) {
  const first = i === 0;
  const cmd = TOOL === 'claude'
    ? ['claude', '-p', t.prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'auto',
       ...(MODEL ? ['--model', MODEL] : []), ...(first ? [] : ['--resume', session!])]
    // (codex is a .cmd shim on Windows: prompts go on stdin)
    : first
      ? ['codex', 'exec', '--json', '--skip-git-repo-check', '--approve-for-me', '-C', WORK, ...(MODEL ? ['-m', MODEL] : []), '-']
      : ['codex', 'exec', 'resume', '--json', '--skip-git-repo-check', ...(MODEL ? ['-m', MODEL] : []), session!, '-'];
  const t0 = performance.now();
  const p = Bun.spawn(cmd, { cwd: WORK, env, stdin: TOOL === 'codex' ? new Blob([t.prompt]) : 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => p.kill(), TIMEOUT_MS);
  const out = await new Response(p.stdout).text();
  const err = await new Response(p.stderr).text();
  const exit = await p.exited;
  clearTimeout(timer);
  const file = path.join(RUN, `turn-${i + 1}.jsonl`);
  writeFileSync(file, out);
  if (err.trim()) writeFileSync(path.join(RUN, `turn-${i + 1}.stderr.txt`), err);
  if (first) {
    for (const line of out.split('\n')) {
      try { const ev = JSON.parse(line); session ??= ev.session_id ?? ev.thread_id ?? null; } catch { /* not json */ }
    }
    if (!session) { console.error(`no session id in the first turn's output; see ${file}`); break; }
  }
  turns.push({ prompt: t.prompt, exit, seconds: Math.round((performance.now() - t0) / 1000), transcript: path.basename(file) });
  console.log(`turn ${i + 1}/${CASE.turns.length}: exit ${exit}, ${turns.at(-1)!.seconds}s`);
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
const status = Bun.spawnSync(['git', 'status', '--porcelain', '--untracked-files=all'], { cwd: WORK }).stdout.toString();
writeFileSync(path.join(RUN, 'result.json'), JSON.stringify({
  case: CASE.id, skill: CASE.skill, tool: TOOL, model: MODEL ?? 'default', arm: ARM, session, turns,
  gitStatus: status.split('\n').filter(Boolean), files: tree(WORK), assertions: CASE.assertions,
}, null, 1));

// ---------------------------------------------------------------- stop what the run left running
// The skill tells the agent to keep the preview running in the background, so a headless session ends with
// its dev server still up; and killing `uv` alone leaves the mock's Python running (on Windows a child
// outlives its parent), holding this process open. Stop every process started from the run's folder, and
// the mock with its whole tree.
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
stopUnder(WORK);

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
