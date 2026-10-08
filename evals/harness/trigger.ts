#!/usr/bin/env bun
// Trigger evals: does a fresh session load the skill for a realistic request, and leave near-misses alone?
// Each query runs in a fresh folder with the skills linked in (.claude/skills for Claude Code, .agents/skills
// for Codex: the "before the plugin exists" setup) or with the plugin loaded (--plugin, Claude Code only), in
// the user's real environment (their other skills compete, as they would in practice).
//
//   bun evals/harness/trigger.ts --tool claude|codex --set evals/trigger/code-video.json
//       [--runs 3] [--model opus] [-j 6] [--only cv-01,cv-04] [--description <file>] [--plugin] [--out <file>]
//
// A run counts as triggered when the session loads the skill (Claude: a Skill call naming it, or a read of
// its SKILL.md; Codex: a command reading <skill>/SKILL.md). Codex models often open a plausible skill just
// to decide, so a run also records whether the skill was *used*: a command running one of its scripts. A
// skill with no scripts (video-ideas) can't be seen being used: its use is reported as not measured (null),
// and its Codex near-misses fail on the load, as Claude's do. Every run also lists the script-use signals it
// saw before it stopped (usedSkills: code-video's init on a request for ideas only, say); a should-trigger
// run stops at the load, so the task cases, not this, check that an ideas request never reaches production.
// A should-trigger run stops at the load; a near-miss run keeps going for a few turns to see whether the
// skill is acted on. What matters is the decision, not the work. No run can reach the user's desktop or their
// own browser (see "no computer use" below), and the results name the model each run had, as its transcript
// (Claude's init event) or session file (Codex's) names it.
import { mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ensureFixtures } from './fixtures';
import { cleanCodexTrust } from './codex-trust-cleanup';
import { cleanClaudeProjects } from './claude-projects-cleanup';

const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = argv.findIndex((a) => a === `--${k}` || a === `-${k}`); return i >= 0 ? argv[i + 1] : d; };
const flag = (k: string) => argv.includes(`--${k}`);

const REPO = path.resolve(import.meta.dir, '..', '..');
const TOOL = opt('tool', 'claude') as 'claude' | 'codex';
const SET = JSON.parse(readFileSync(path.resolve(opt('set', 'evals/trigger/code-video.json')!), 'utf8')) as {
  skill: string; queries: { id: string; should_trigger: boolean; files: string[]; query: string }[];
};
const RUNS = +opt('runs', '3')!;
const MODEL = opt('model');
const J = +opt('j', TOOL === 'claude' ? '6' : '4')!;
const ONLY = opt('only')?.split(',');
// (every skill in the repo: they compete with each other, as they do once the plugin is installed)
const SKILLS = readdirSync(path.join(REPO, 'skills')).filter((s) => existsSync(path.join(REPO, 'skills', s, 'SKILL.md')));
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const WORK = path.resolve(opt('work', path.join(REPO, 'evals', 'results', 'trigger-runs', `${TOOL}-${SET.skill}-${STAMP}`))!);
const OUT = path.resolve(opt('out', path.join(REPO, 'evals', 'results', `trigger-${TOOL}-${MODEL ?? 'default'}-${SET.skill}-${STAMP}.json`))!);
// Claude: enough turns to look around before deciding (some models list files first); Codex has no turn
// limit, so a run stops after this many commands without touching a skill, or at the timeout.
const MAX_TURNS = 6, CODEX_MAX_COMMANDS = 10, TIMEOUT_MS = 240_000;

const fixtures = ensureFixtures(path.join(REPO, 'evals', 'results', 'fixtures'));

/** The skills folder a run links to: the repo's, or a copy whose SKILL.md carries an alternative description. */
function skillsSource(): string {
  const desc = opt('description');
  if (!desc) return path.join(REPO, 'skills');
  const dir = path.join(WORK, '_skills');
  for (const s of SKILLS) {
    const src = path.join(REPO, 'skills', s), dst = path.join(dir, s);
    mkdirSync(dst, { recursive: true });
    for (const e of readdirSync(src)) if (e !== 'SKILL.md') symlinkSync(path.join(src, e), path.join(dst, e), 'junction');
    let md = readFileSync(path.join(src, 'SKILL.md'), 'utf8');
    if (s === SET.skill) md = md.replace(/^description:.*$/m, `description: ${JSON.stringify(readFileSync(path.resolve(desc), 'utf8').trim())}`);
    writeFileSync(path.join(dst, 'SKILL.md'), md);
  }
  return dir;
}
const SRC = skillsSource();

function prepare(dir: string, files: string[]) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  Bun.spawnSync(['git', 'init', '-q'], { cwd: dir });
  for (const f of files) copyFileSync(path.join(fixtures, f), path.join(dir, f));
  if (flag('plugin')) return;
  const link = TOOL === 'claude' ? path.join(dir, '.claude', 'skills') : path.join(dir, '.agents', 'skills');
  mkdirSync(link, { recursive: true });
  for (const s of SKILLS) symlinkSync(path.join(SRC, s), path.join(link, s), 'junction');
}

/** Stop a run with its whole process tree: codex is a .cmd shim on Windows, and stopping the shim alone leaves
 *  the session running in the folder, holding the output open (so a timeout never ends the run). */
function stopTree(pid: number) {
  if (process.platform === 'win32') Bun.spawnSync(['taskkill', '/T', '/F', '/PID', String(pid)], { stdout: 'ignore', stderr: 'ignore' });
  else { Bun.spawnSync(['pkill', '-TERM', '-P', String(pid)]); try { process.kill(pid); } catch { /* it ended meanwhile */ } }
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
// (task.ts holds the same section: keep the two alike.)
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

// ---------------------------------------------------------------- the runs
// (built and checked once, before the first run: a Codex that would still reach a browser stops here)
mkdirSync(WORK, { recursive: true });
const OFF = TOOL === 'codex' ? codexOff(WORK) : claudeOff();
/** The model a Codex session ran, from its session file (`codex exec --json` doesn't name it). */
function codexModel(thread: string, since: number): string | null {
  const root = path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'sessions');
  for (let t = since - 86_400_000; t < Date.now() + 86_400_000; t += 86_400_000) {
    const d = new Date(t);
    const dir = path.join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
    const f = existsSync(dir) ? readdirSync(dir).find((x) => x.endsWith(`-${thread}.jsonl`)) : undefined;
    if (!f) continue;
    for (const line of readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line.includes('"turn_context"')) continue;
      try { const ev = JSON.parse(line); if (ev.type === 'turn_context' && ev.payload?.model) return ev.payload.model; } catch { /* cut short */ }
    }
  }
  return null;
}
// (set when a run finds a browser or the desktop within its reach: the eval stops there, since every run would)
let halt: string | null = null;

const skillRe = (s: string) => new RegExp(`(?:^|[^\\w-])(?:[\\w-]+:)?${s}(?:[/\\\\]+SKILL\\.md|["'\\s,}]|$)`, 'i');
// a command that runs one of the skill's own scripts (init, render, qc; beats, eleven, mix, align); a skill
// with no scripts has no entry
const useRe: Record<string, RegExp | undefined> = {
  'code-video': /code-video[/\\]+scripts[/\\]+\w+\.(ts|py)|scripts[/\\]+render\.ts|init\.ts/i,
  'soundtrack': /soundtrack[/\\]+scripts[/\\]+(beats|eleven|mix|align)\.py/i,
};

// (whether the skill under test has scripts, so that its use can be seen at all)
const SCRIPTED = !!useRe[SET.skill];

async function runOnce(q: (typeof SET.queries)[number], k: number) {
  const dir = path.join(WORK, `${q.id}-${k}`);
  prepare(dir, q.files);
  const cmd = TOOL === 'claude'
    ? ['claude', '-p', q.query, '--output-format', 'stream-json', '--verbose', '--max-turns', String(MAX_TURNS), '--permission-mode', 'auto', '--no-session-persistence',
       ...OFF, ...(MODEL ? ['--model', MODEL] : []), ...(flag('plugin') ? ['--plugin-dir', REPO] : [])]
    // (codex is a .cmd shim on Windows, which can't take arguments with quotes: the prompt goes on stdin)
    : ['codex', 'exec', '--json', '--skip-git-repo-check', '--approve-for-me', ...OFF, '-C', dir, ...(MODEL ? ['-m', MODEL] : []), '-'];
  const t0 = performance.now(), since = Date.now();
  // (no keys that spend: a near-miss run acts for up to MAX_TURNS, and a script it runs must not reach a paid API)
  const env = { ...process.env };
  delete env.ELEVENLABS_API_KEY;
  delete env.OPENAI_API_KEY;
  const p = Bun.spawn(cmd, { cwd: dir, env, stdin: TOOL === 'codex' ? new Blob([q.query]) : 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => stopTree(p.pid), TIMEOUT_MS);
  const seen = new Set<string>(), used = new Set<string>(), tools: string[] = [];
  let commands = 0, log = '', stop = false, blocked: string | null = null, model: string | null = null, thread: string | null = null;
  const dec = new TextDecoder();
  for await (const chunk of p.stdout) {
    const from = log.lastIndexOf('\n') + 1;
    log += dec.decode(chunk, { stream: true });
    // (whole lines only: one split across chunks, such as Claude's long init event, is read once it ends)
    for (const line of log.slice(from).split('\n').slice(0, -1)) {
      if (!line.trim()) continue;
      let ev: any; try { ev = JSON.parse(line); } catch { continue; }
      blocked ??= desktopIn(ev);
      if (TOOL === 'claude') {
        if (ev?.type === 'system' && ev.subtype === 'init' && typeof ev.model === 'string') model ??= ev.model;
        for (const c of ev?.message?.content ?? []) if (c?.type === 'tool_use') {
          tools.push(c.name);
          const blob = JSON.stringify(c.input ?? {});
          for (const s of SKILLS) {
            if ((c.name === 'Skill' && skillRe(s).test(String(c.input?.skill ?? c.input?.command ?? ''))) || (c.name === 'Read' && skillRe(s).test(blob))) seen.add(s);
            if (c.name === 'Bash' && useRe[s]?.test(blob)) used.add(s);
          }
        }
      } else {
        if (ev?.type === 'thread.started' && typeof ev.thread_id === 'string') thread ??= ev.thread_id;
        const item = ev?.item;
        if (item?.type === 'command_execution' && ev.type === 'item.started') {
          commands++; tools.push('cmd');
          for (const s of SKILLS) if (useRe[s]?.test(String(item.command ?? ''))) used.add(s);
        }
        for (const s of SKILLS) if (new RegExp(`${s}[/\\\\]+SKILL\\.md`, 'i').test(line)) seen.add(s);
        if (commands >= CODEX_MAX_COMMANDS) stop = true;
      }
    }
    if (blocked || (q.should_trigger && seen.has(SET.skill)) || used.has(SET.skill) || stop) { stopTree(p.pid); break; }
  }
  clearTimeout(timer);
  await p.exited;
  writeFileSync(path.join(dir, '_transcript.jsonl'), log);
  if (blocked) halt ??= `${q.id}#${k}: ${blocked}`;
  if (thread) model = codexModel(thread, since);
  return { k, triggered: seen.has(SET.skill), used: SCRIPTED ? used.has(SET.skill) : null, skills: [...seen], usedSkills: [...used], tools: tools.slice(0, 8), ms: Math.round(performance.now() - t0),
    model, ...(blocked ? { blocked } : {}) };
}

const queries = SET.queries.filter((q) => !ONLY || ONLY.includes(q.id));
const jobs = queries.flatMap((q) => Array.from({ length: RUNS }, (_, k) => ({ q, k })));
const results = new Map<string, Awaited<ReturnType<typeof runOnce>>[]>();
let next = 0, done = 0;
async function worker() {
  while (next < jobs.length && !halt) {
    const { q, k } = jobs[next++]!;
    const r = await runOnce(q, k).catch((e) => ({ k, triggered: false, used: SCRIPTED ? false : null, skills: [], usedSkills: [], tools: [`error: ${e}`], ms: 0, model: null }));
    (results.get(q.id) ?? results.set(q.id, []).get(q.id)!).push(r);
    done++;
    process.stderr.write(`\r${done}/${jobs.length}  ${q.id}#${k} ${r.triggered ? 'TRIGGERED' : '-'}   `);
  }
}
await Promise.all(Array.from({ length: J }, worker));
process.stderr.write('\n');
// every codex exec run trusted its throwaway folder in the user's config: take those entries out again
if (TOOL === 'codex') cleanCodexTrust(false, [], WORK);
// and every claude -p run left a (memory-only) project entry for its folder
if (TOOL === 'claude') cleanClaudeProjects(false, path.join(WORK, '_claude-sessions'), WORK);
if (halt) {
  console.error(`stopped: ${halt} put a browser or the desktop within a session's reach, so no results were written (see evals/README.md)`);
  process.exit(1);
}

// what fails a near-miss: Codex reads plausible skills to decide, so for a skill whose use shows (it has
// scripts) only using it fails; otherwise, and always in Claude Code, loading it does
const NEAR_MISS: 'script-use' | 'load' = TOOL === 'codex' && SCRIPTED ? 'script-use' : 'load';
const rows = queries.map((q) => {
  const rs = results.get(q.id) ?? [];
  const rate = rs.filter((r) => r.triggered).length / Math.max(1, rs.length);
  const useRate = SCRIPTED ? rs.filter((r) => r.used).length / Math.max(1, rs.length) : null;
  // near-misses: Claude loads a skill only when it means to follow it, so a load is the failure; Codex reads
  // plausible skills to decide (it then often declines in its next message), so there the failure is using
  // it, where using shows (NEAR_MISS above)
  const pass = q.should_trigger ? rate >= 0.5 : NEAR_MISS === 'script-use' ? useRate! < 0.5 : rate < 0.5;
  return { id: q.id, should_trigger: q.should_trigger, rate, useRate, pass, query: q.query, runs: rs };
});
// (the model as the runs' transcripts or session files name it; modelArg is what --model asked for)
const models = [...new Set([...results.values()].flat().flatMap((r) => r.model ?? []))];
const summary = {
  tool: TOOL, model: models.join(', ') || null, modelArg: MODEL ?? null, skill: SET.skill, runs: RUNS, plugin: flag('plugin'), description: opt('description') ?? null,
  nearMissCriterion: NEAR_MISS,
  desktopOff: OFF,
  passed: rows.filter((r) => r.pass).length, total: rows.length,
  recall: rows.filter((r) => r.should_trigger).reduce((a, r) => a + r.rate, 0) / Math.max(1, rows.filter((r) => r.should_trigger).length),
  falseRate: rows.filter((r) => !r.should_trigger).reduce((a, r) => a + r.rate, 0) / Math.max(1, rows.filter((r) => !r.should_trigger).length),
  // (null when the skill has no scripts: its use isn't measured)
  falseUseRate: SCRIPTED ? rows.filter((r) => !r.should_trigger).reduce((a, r) => a + r.useRate!, 0) / Math.max(1, rows.filter((r) => !r.should_trigger).length) : null,
};
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 1));
console.log(`${TOOL} ${summary.model ?? MODEL ?? '(model not named)'} ${SET.skill}: ${summary.passed}/${summary.total} pass · loaded on should ${(summary.recall * 100).toFixed(0)}% · loaded on near-misses ${(summary.falseRate * 100).toFixed(0)}% · used on near-misses ${summary.falseUseRate === null ? 'not measured' : `${(summary.falseUseRate * 100).toFixed(0)}%`} · near-misses fail on ${NEAR_MISS === 'load' ? 'a load' : 'script use'}`);
for (const r of rows) if (!r.pass) console.log(`  FAIL ${r.id} (${r.should_trigger ? 'should' : 'should not'}) load ${r.rate.toFixed(2)} use ${r.useRate === null ? 'not measured' : r.useRate.toFixed(2)}: ${r.query}`);
console.log(OUT);
