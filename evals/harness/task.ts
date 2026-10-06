#!/usr/bin/env bun
// Task evals: run a realistic multi-turn request in a fresh folder, headless, with the skills linked in
// (or without them, for the baseline arm), and keep everything a grader needs: each turn's transcript,
// the folder as it ends up, and timings. Grading is separate (evals/README.md).
//
//   bun evals/harness/task.ts --case evals/tasks/<id> --tool claude|codex [--model <id>] [--effort <level>]
//       [--without] [--work <dir>] [--keep-sessions]
// --effort sets the reasoning effort the user's settings would otherwise pick: Claude Code's --effort (low ..
// max), Codex's model_reasoning_effort (low .. ultra), e.g. --effort ultra for a Codex run like the user's own.
//
// A case folder holds case.json:
//   { "id", "skill", "setup": { "files": [fixture name | "<path, $ENV allowed> => <name>"], "project": "init" | null,
//       "from": "<dir to copy>", "env": {...}, "mock": "elevenlabs", "key": false, "decoy": <port> },
//     "turns": [{ "prompt": "...", "newSession": true? }, ...], "timeoutMinutes": 45, "assertions": ["..."] }
// The first turn starts a session; each later turn resumes it, as a director replying would, unless it has
// "newSession": true (a later session in the same folder, which knows only what the project wrote down). "mock":
// "elevenlabs" starts evals/mocks/elevenlabs.py on a free port and points ELEVENLABS_BASE_URL at it (with a
// fake key), so a case can check that nothing is spent before the user says yes; with "key": false the session
// has no key, and the mock logs any request made without one (a key found elsewhere reaches the mock, not
// ElevenLabs). "openai-images" (or a list of both) starts evals/mocks/openai_images.py the same way, for
// skills/code-video/scripts/imagegen.py (AUDARA_IMAGES_BASE_URL, and a fake OPENAI_API_KEY in Claude Code
// runs only, to keep a fake key away from Codex's own sign-in; its built-in image generation can't be mocked). "decoy": <port> keeps an unrelated Vite app answering on 127.0.0.1:<port> for the whole run, so
// a case can check that the agent links its own project's preview, not whatever answers on the port.
//
// Claude Code turns run with no MCP servers (--strict-mcp-config, and without the claude.ai connectors), so the
// user's connectors don't ask for authorization in the replies. No run of either tool can reach the user's
// desktop or their own browser: computer use and browser automation are off (see "no computer use" below).
// Both tools keep the user's caches (uv's, and AUDARA_CACHE's models): a fresh one per run would download
// gigabytes each time.
//
// result.json also lists the audara previews that answered during the run and the folder each serves (the
// harness stops this run's at the end), and the model each turn ran, as the transcripts name it (Claude's
// init event; Codex's session file). A Codex run's session files, its sub-agents' included, are copied to
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
type Mock = 'elevenlabs' | 'openai-images';
const CASE = JSON.parse(readFileSync(path.join(CASE_DIR, 'case.json'), 'utf8')) as {
  id: string; skill: string; setup?: { files?: string[]; project?: 'init' | null; from?: string; env?: Record<string, string>;
    mock?: Mock | Mock[]; key?: false; decoy?: number };
  turns: { prompt: string; newSession?: boolean }[]; timeoutMinutes?: number; assertions: string[];
};
const TOOL = opt('tool', 'claude') as 'claude' | 'codex';
const MODEL = opt('model');
const EFFORT = opt('effort');
const ARM = flag('without') ? 'without' : 'with';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const T0 = Date.now();
const RUN = path.resolve(opt('work', path.join(REPO, 'evals', 'results', 'tasks', `${CASE.id}-${TOOL}${MODEL ? '-' + MODEL : ''}${EFFORT ? '-' + EFFORT : ''}-${ARM}-${STAMP}`))!);
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
// for every 10 s during the turns and once after the last: one started in a background shell dies with the
// turn (Claude Code stops its background shells when `claude -p` exits), one started by `render.ts preview`
// runs until the harness stops it, and runs going at once can reach each other's previews, so only the root
// tells this run's apart.
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

// ---------------------------------------------------------------- no computer use, no browser automation
// A run must not reach the user's desktop or their own browser. With the user's own Codex config, one run did:
// through Codex's computer-use plugin it read the titles of the user's open Chrome tabs, pressed play in a
// background tab and left a tab open. So every run turns off what could: in Codex, the features and plugins
// named for computer use or a browser, every MCP server whose name, command or environment names one (the
// Codex app's node_repl, in config.toml, carries both services) and the turn-end notify program (the user's
// calls the computer-use helper); in Claude Code, Claude in Chrome and the plugins named for a browser
// (Playwright's MCP server). The rest of the user's setup loads as before. What a session can reach is then
// checked: Codex's plugin and server lists with these flags, before a turn starts; each Claude turn's tools
// and servers, from its init event, before the model acts; and a Codex call to such a server stops the run.
// (trigger.ts holds the same section: keep the two alike.)
const DESKTOP = /computer[-_ ]?use|browser|chrome|chromium|playwright|puppeteer|selenium|webdriver|\bcua|_cua|node_repl/i;

/** Codex flags that turn computer use and browser automation off, built from what this Codex reports (an
 *  override for a feature or a server it doesn't have is an error), then checked with the flags applied. */
function codexOff(cwd: string): string[] {
  const codex = (...a: string[]) => {
    const r = Bun.spawnSync(['codex', ...a], { cwd, stdout: 'pipe', stderr: 'pipe' });
    if (r.exitCode !== 0) throw new Error(`codex ${a.join(' ')} failed:\n${r.stderr}`);
    return r.stdout.toString();
  };
  const flags = ['-c', 'notify=[]'];
  for (const [, name, stage, on] of codex('features', 'list').matchAll(/^(\S+)\s+(.+?)\s+(true|false)\s*$/gm)) {
    if (on === 'true' && stage !== 'removed' && DESKTOP.test(name!)) flags.push('--disable', name!);
  }
  type Plugin = { pluginId: string; name: string; enabled: boolean };
  const plugins = () => (JSON.parse(codex('plugin', 'list', '--json', ...flags)).installed as Plugin[])
    .filter((p) => p.enabled && DESKTOP.test(p.name));
  for (const p of plugins()) flags.push('-c', `plugins.${p.pluginId}.enabled=false`);
  type Server = { name: string; enabled: boolean; transport?: { command?: string; args?: string[]; env?: Record<string, string> | null } };
  const servers = () => (JSON.parse(codex('mcp', 'list', '--json', ...flags)) as Server[]).filter((s) => s.enabled
    && DESKTOP.test([s.name, s.transport?.command, ...(s.transport?.args ?? []), ...Object.keys(s.transport?.env ?? {})].join(' ')));
  for (const s of servers()) flags.push('-c', `mcp_servers.${s.name}.enabled=false`);
  const left = [...plugins().map((p) => `the plugin ${p.pluginId}`), ...servers().map((s) => `the MCP server ${s.name}`)];
  if (left.length) throw new Error(`Codex would still reach a browser or the desktop: ${left.join(', ')}`);
  return flags;
}

/** Claude Code flags: no Claude in Chrome, the plugins the user's settings enable that are named for a
 *  browser turned off for the run (their other plugins stay on), and this repo's own CLAUDE.md and
 *  AGENTS.md left out: Claude Code reads them from every folder above the run's, and evals/results/ is
 *  inside the repo (Codex stops at the run's own git root). */
function claudeOff(): string[] {
  let on: Record<string, unknown> = {};
  try {
    const dir = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');
    on = JSON.parse(readFileSync(path.join(dir, 'settings.json'), 'utf8')).enabledPlugins ?? {};
  } catch { /* no settings */ }
  const off = Object.keys(on).filter((p) => on[p] && DESKTOP.test(p));
  const settings = {
    claudeMdExcludes: [path.join(REPO, 'CLAUDE.md'), path.join(REPO, 'AGENTS.md')],
    ...(off.length ? { enabledPlugins: Object.fromEntries(off.map((p) => [p, false])) } : {}),
  };
  return ['--no-chrome', '--settings', JSON.stringify(settings)];
}

/** What, in one transcript event, puts a browser or the desktop within the session's reach: a tool or MCP
 *  server in Claude's init event (it comes before the model acts), or a Codex call to such a server. */
function desktopIn(ev: any): string | null {
  if (ev?.type === 'system' && ev.subtype === 'init') {
    const hit = [...(ev.mcp_servers ?? []).map((s: any) => s?.name), ...(ev.tools ?? [])].filter((n) => typeof n === 'string' && DESKTOP.test(n));
    return hit.length ? hit.slice(0, 4).join(', ') + (hit.length > 4 ? ` and ${hit.length - 4} more` : '') : null;
  }
  const it = ev?.item;
  return ev?.type === 'item.started' && it?.type === 'mcp_tool_call' && DESKTOP.test(`${it.server} ${it.tool}`) ? `${it.server} ${it.tool}` : null;
}

// ---------------------------------------------------------------- the model that ran
/** From one Claude turn's stream-json: the model its init event names, and every model its usage counts
 *  (a sub-agent may run another). */
function claudeTurnModels(out: string) {
  let model: string | undefined;
  const used = new Set<string>();
  for (const line of out.split('\n')) {
    let ev: any;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev?.type === 'system' && ev.subtype === 'init' && typeof ev.model === 'string') model ??= ev.model;
    if (ev?.type === 'result') for (const m of Object.keys(ev.modelUsage ?? {})) used.add(m);
  }
  return { model, used: [...used] };
}

/** A Codex session file: its thread, the folder it ran in, and each turn's start, model and effort (a resumed
 *  session adds its turns to the same file; a sub-agent has a file of its own). */
function codexSessionFile(file: string) {
  const lines = readFileSync(file, 'utf8').split('\n');
  let meta: any;
  try { meta = JSON.parse(lines[0]!).payload; } catch { return null; }
  const turns: { at: string; model?: string; effort?: string }[] = [];
  for (const l of lines) {
    if (!l.includes('"turn_context"')) continue;
    try {
      const ev = JSON.parse(l);
      if (ev.type === 'turn_context') turns.push({ at: ev.timestamp, model: ev.payload?.model, effort: ev.payload?.effort });
    } catch { /* a line cut short */ }
  }
  return { id: meta?.id as string | undefined, cwd: meta?.cwd as string | undefined, turns };
}

// ---------------------------------------------------------------- turns
const env: Record<string, string | undefined> = { ...process.env, ...(CASE.setup?.env ?? {}) };
delete env.ELEVENLABS_API_KEY; // a case decides whether there is a key; never the real one
delete env.OPENAI_API_KEY;
// (and no claude.ai connectors, which Claude Code fetches itself: --strict-mcp-config is documented for
// configured servers only)
if (TOOL === 'claude') env.ENABLE_CLAUDEAI_MCP_SERVERS = 'false';
// (built and checked before anything starts: a Codex that would still reach a browser stops the run here)
const OFF = TOOL === 'codex' ? codexOff(WORK) : claudeOff();
const mocks: ReturnType<typeof Bun.spawn>[] = [];
/** Start one of evals/mocks/ on a free port, logging to <RUN>/<log>; its port, once it listens. */
async function startMock(script: string, log: string, what: string) {
  // (there from the start, so an empty log reads as a mock nobody asked anything)
  writeFileSync(path.join(RUN, log), '');
  const m = Bun.spawn(['uv', 'run', path.join(REPO, 'evals', 'mocks', script), '--port', '0', '--log', path.join(RUN, log)], { stdout: 'pipe', stderr: 'pipe' });
  mocks.push(m);
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
  if (!port) { stopTree(m.pid); throw new Error(`the ${what} mock did not start:\n${await new Response(m.stderr).text()}`); }
  return port;
}
const MOCKS = [CASE.setup?.mock ?? []].flat();
if (MOCKS.includes('elevenlabs')) {
  const port = await startMock('elevenlabs.py', 'mock-requests.jsonl', 'ElevenLabs');
  env.ELEVENLABS_BASE_URL = `http://127.0.0.1:${port}`;
  if (CASE.setup!.key !== false) env.ELEVENLABS_API_KEY = 'eval-fake-key-0f3a9c';
}
if (MOCKS.includes('openai-images')) {
  const port = await startMock('openai_images.py', 'mock-images.jsonl', 'OpenAI images');
  env.AUDARA_IMAGES_BASE_URL = `http://127.0.0.1:${port}/v1`;
  if (CASE.setup!.key !== false && TOOL === 'claude') env.OPENAI_API_KEY = 'eval-fake-key-0f3a9c'; // (the mock's MOCK_KEY default)
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
const sessions: string[] = []; // every session the run started, in order (a newSession turn starts another)
const turns: { prompt: string; newSession?: boolean; started: string; ended: string; exit: number | null; seconds: number; transcript: string;
  model?: string; effort?: string; timedOut?: boolean; blocked?: string }[] = [];
const alsoRan = new Set<string>(); // every model the transcripts name, sub-agents' included
// (no quotes around the value: codex is a .cmd shim, which Bun won't hand a quote; Codex reads a bare word as a string)
const CODEX_EFFORT = EFFORT ? ['-c', `model_reasoning_effort=${EFFORT}`] : [];
for (const [i, t] of CASE.turns.entries()) {
  const first = i === 0 || t.newSession === true;
  if (first) session = null;
  const cmd = TOOL === 'claude'
    ? ['claude', '-p', t.prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'auto', '--strict-mcp-config', ...OFF,
       ...(MODEL ? ['--model', MODEL] : []), ...(EFFORT ? ['--effort', EFFORT] : []), ...(first ? [] : ['--resume', session!])]
    // (codex is a .cmd shim on Windows: prompts go on stdin)
    : first
      ? ['codex', 'exec', '--json', '--skip-git-repo-check', '--approve-for-me', ...OFF, '-C', WORK, ...(MODEL ? ['-m', MODEL] : []), ...CODEX_EFFORT, '-']
      : ['codex', 'exec', 'resume', '--json', '--skip-git-repo-check', ...OFF, ...(MODEL ? ['-m', MODEL] : []), ...CODEX_EFFORT, session!, '-'];
  const t0 = performance.now(), started = new Date().toISOString();
  const p = Bun.spawn(cmd, { cwd: WORK, env, stdin: TOOL === 'codex' ? new Blob([t.prompt]) : 'ignore', stdout: 'pipe', stderr: 'pipe' });
  let timedOut = false, blocked: string | null = null;
  // (the whole tree: stopping codex's .cmd shim alone leaves the session running, and the turn waiting for it)
  const timer = setTimeout(() => { timedOut = true; try { stopTree(p.pid); } catch { /* it ended meanwhile */ } }, TIMEOUT_MS);
  const watch = setInterval(() => void lookForPreviews(i + 1), 10_000);
  const errText = new Response(p.stderr).text();
  // (read as it comes: a browser or the desktop within the session's reach stops the turn there)
  let out = '';
  const dec = new TextDecoder();
  for await (const chunk of p.stdout) {
    const from = out.lastIndexOf('\n') + 1;
    out += dec.decode(chunk, { stream: true });
    for (const line of blocked ? [] : out.slice(from).split('\n').slice(0, -1)) {
      let ev: unknown;
      try { ev = JSON.parse(line); } catch { continue; }
      blocked = desktopIn(ev);
      if (blocked) { try { stopTree(p.pid); } catch { /* it ended meanwhile */ } break; }
    }
  }
  out += dec.decode();
  const err = await errText;
  const exit = await p.exited;
  // (the times themselves, to the millisecond: a request the mock logged belongs to the turn whose window holds it)
  const ended = new Date().toISOString();
  clearTimeout(timer);
  clearInterval(watch);
  const file = path.join(RUN, `turn-${i + 1}.jsonl`);
  writeFileSync(file, out);
  if (err.trim()) writeFileSync(path.join(RUN, `turn-${i + 1}.stderr.txt`), err);
  // (Claude's init event names the model each turn; a Codex turn's comes from its session file, after the turns)
  const ran = TOOL === 'claude' ? claudeTurnModels(out) : null;
  for (const m of ran?.used ?? []) alsoRan.add(m);
  // (marked: a turn stopped at the timeout has no reply, and the next prompt answers one nobody saw)
  turns.push({ prompt: t.prompt, ...(i > 0 && first ? { newSession: true } : {}), started, ended, exit, seconds: Math.round((performance.now() - t0) / 1000), transcript: path.basename(file),
    ...(ran?.model ? { model: ran.model } : {}), ...(timedOut ? { timedOut } : {}), ...(blocked ? { blocked } : {}) });
  console.log(`turn ${i + 1}/${CASE.turns.length}: exit ${exit}, ${turns.at(-1)!.seconds}s${timedOut ? ', stopped at the timeout' : ''}`);
  if (blocked) { console.error(`turn ${i + 1} stopped: ${blocked} put a browser or the desktop within the session's reach (see evals/README.md)`); break; }
  if (first) {
    for (const line of out.split('\n')) {
      try { const ev = JSON.parse(line); session ??= ev.session_id ?? ev.thread_id ?? null; } catch { /* not json */ }
    }
    if (!session) { console.error(`no session id in turn ${i + 1}'s output; see ${file}`); break; }
    sessions.push(session);
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

// Codex's own record of the session: `codex exec --json` leaves some tool calls out of the transcripts
// (spawn_agent, view_image) and doesn't name the model, and each sub-agent keeps a session of its own. Every
// session file written during the run whose session ran in the run's folder (the main thread's and its
// sub-agents') is copied to codex-sessions/ at the end; the main thread's gives each turn's model and effort.
const CODEX_SESSIONS = path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'sessions');
const codexFiles: { file: string; id?: string; turns: { at: string; model?: string; effort?: string }[] }[] = [];
if (TOOL === 'codex') {
  // (in YYYY/MM/DD folders of the local date each session started: the run's days, and a day either side)
  const days = new Set<string>();
  for (let t = T0 - 86_400_000; t < Date.now() + 86_400_000; t += 3_600_000) {
    const d = new Date(t);
    days.add(path.join(CODEX_SESSIONS, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')));
  }
  for (const dir of days) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      const file = path.join(dir, f);
      if (!/^rollout-.*\.jsonl$/.test(f) || statSync(file).mtimeMs < T0) continue;
      const s = codexSessionFile(file);
      if (s && typeof s.cwd === 'string' && isWork(s.cwd)) codexFiles.push({ file, id: s.id, turns: s.turns });
    }
  }
  for (const tc of codexFiles.filter((s) => s.id && sessions.includes(s.id)).flatMap((s) => s.turns)) {
    const turn = turns.find((u) => Date.parse(u.started) <= Date.parse(tc.at) && Date.parse(tc.at) <= Date.parse(u.ended));
    if (turn && !turn.model && tc.model) Object.assign(turn, { model: tc.model, ...(tc.effort ? { effort: tc.effort } : {}) });
  }
  for (const s of codexFiles) for (const tc of s.turns) if (tc.model) alsoRan.add(tc.model);
}
const ranModels = [...new Set(turns.flatMap((u) => u.model ?? []))];
const efforts = [...new Set(turns.flatMap((u) => u.effort ?? []))];
const otherModels = [...alsoRan].filter((m) => !ranModels.includes(m));
writeFileSync(path.join(RUN, 'result.json'), JSON.stringify({
  case: CASE.id, skill: CASE.skill, tool: TOOL,
  // (the model as the transcripts name it, each turn's in turns[]; modelArg is what --model asked for)
  model: ranModels.join(', ') || null, ...(efforts.length ? { effort: efforts.join(', ') } : {}), modelArg: MODEL ?? null, effortArg: EFFORT ?? null,
  ...(otherModels.length ? { otherModels } : {}), arm: ARM, session: sessions[0] ?? null, ...(sessions.length > 1 ? { sessions } : {}),
  ...(CASE.setup?.from ? { from: path.resolve(CASE_DIR, expand(CASE.setup.from)) } : {}), desktopOff: OFF, turns,
  ...(decoy ? { decoy } : {}), previews: [...previews.values()],
  gitStatus: status.split('\n').filter(Boolean), files: tree(WORK), assertions: CASE.assertions,
}, null, 1));

// ---------------------------------------------------------------- stop what the run left running
// The skill keeps the preview running after the session (`render.ts preview` starts the project's own
// node_modules/vite, so its command line names the run's folder); and killing `uv` alone leaves the mock's
// Python running (on Windows a child outlives its parent), holding this process open. Stop every process
// started from the run's folder, the mock with its whole tree, and the decoy.
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
for (const m of mocks) if (m.pid) stopTree(m.pid);
clearInterval(decoyRetry);
decoyServer?.stop(true);
stopUnder(WORK);
// (a preview of this run that still answers, started by a command line that doesn't name the folder: stopped
// through its port, so previews left over from earlier runs don't fill 5173-5199)
const still: number[] = [];
for (const p of previews.values()) {
  const root = p.thisRun ? await previewRoot(p.port) : null;
  if (root && isWork(root)) still.push(p.port);
}
if (still.length) {
  const pids = process.platform === 'win32'
    ? Bun.spawnSync(['powershell', '-NoProfile', '-Command',
        `Get-NetTCPConnection -State Listen -LocalPort ${still.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { $_.OwningProcess }`]).stdout.toString()
    : Bun.spawnSync(['lsof', '-t', '-sTCP:LISTEN', ...still.flatMap((p) => ['-i', `TCP:${p}`])]).stdout.toString();
  for (const p of new Set(pids.split(/\s+/).filter(Boolean).map(Number))) if (p !== process.pid) stopTree(p);
}

// ---------------------------------------------------------------- Codex's own record of the session
// (the session files found above, copied now that nothing of the run writes to them any more)
if (TOOL === 'codex') {
  for (const s of codexFiles) {
    mkdirSync(path.join(RUN, 'codex-sessions'), { recursive: true });
    copyFileSync(s.file, path.join(RUN, 'codex-sessions', path.basename(s.file)));
  }
  const n = codexFiles.length;
  console.log(n ? `codex-sessions/: ${n} session file${n === 1 ? '' : 's'} (the main thread's and any sub-agents')` : `no Codex session file under ${CODEX_SESSIONS} ran in ${WORK}`);
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
