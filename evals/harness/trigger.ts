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
// to decide, so a run also records whether the skill was *used*: a command running one of its scripts.
// A should-trigger run stops at the load; a near-miss run keeps going for a few turns to see whether the
// skill is acted on. What matters is the decision, not the work.
import { mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
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
const SKILLS = ['code-video', 'soundtrack'];
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

const skillRe = (s: string) => new RegExp(`(?:^|[^\\w-])(?:[\\w-]+:)?${s}(?:[/\\\\]+SKILL\\.md|["'\\s,}]|$)`, 'i');
// a command that runs one of the skill's own scripts (init, render, qc; beats, eleven, mix, align)
const useRe: Record<string, RegExp> = {
  'code-video': /code-video[/\\]+scripts[/\\]+\w+\.(ts|py)|scripts[/\\]+render\.ts|init\.ts/i,
  'soundtrack': /soundtrack[/\\]+scripts[/\\]+(beats|eleven|mix|align)\.py/i,
};

async function runOnce(q: (typeof SET.queries)[number], k: number) {
  const dir = path.join(WORK, `${q.id}-${k}`);
  prepare(dir, q.files);
  const cmd = TOOL === 'claude'
    ? ['claude', '-p', q.query, '--output-format', 'stream-json', '--verbose', '--max-turns', String(MAX_TURNS), '--permission-mode', 'auto', '--no-session-persistence',
       ...(MODEL ? ['--model', MODEL] : []), ...(flag('plugin') ? ['--plugin-dir', REPO] : [])]
    // (codex is a .cmd shim on Windows, which can't take arguments with quotes: the prompt goes on stdin)
    : ['codex', 'exec', '--json', '--skip-git-repo-check', '--approve-for-me', '-C', dir, ...(MODEL ? ['-m', MODEL] : []), '-'];
  const t0 = performance.now();
  const p = Bun.spawn(cmd, { cwd: dir, stdin: TOOL === 'codex' ? new Blob([q.query]) : 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => p.kill(), TIMEOUT_MS);
  const seen = new Set<string>(), used = new Set<string>(), tools: string[] = [];
  let commands = 0, log = '', stop = false;
  const dec = new TextDecoder();
  for await (const chunk of p.stdout) {
    const text = dec.decode(chunk);
    log += text;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let ev: any; try { ev = JSON.parse(line); } catch { continue; }
      if (TOOL === 'claude') {
        for (const c of ev?.message?.content ?? []) if (c?.type === 'tool_use') {
          tools.push(c.name);
          const blob = JSON.stringify(c.input ?? {});
          for (const s of SKILLS) {
            if ((c.name === 'Skill' && skillRe(s).test(String(c.input?.skill ?? c.input?.command ?? ''))) || (c.name === 'Read' && skillRe(s).test(blob))) seen.add(s);
            if (c.name === 'Bash' && useRe[s]!.test(blob)) used.add(s);
          }
        }
      } else {
        const item = ev?.item;
        if (item?.type === 'command_execution' && ev.type === 'item.started') {
          commands++; tools.push('cmd');
          for (const s of SKILLS) if (useRe[s]!.test(String(item.command ?? ''))) used.add(s);
        }
        for (const s of SKILLS) if (new RegExp(`${s}[/\\\\]+SKILL\\.md`, 'i').test(line)) seen.add(s);
        if (commands >= CODEX_MAX_COMMANDS) stop = true;
      }
    }
    if ((q.should_trigger && seen.has(SET.skill)) || used.has(SET.skill) || stop) { p.kill(); break; }
  }
  clearTimeout(timer);
  await p.exited;
  writeFileSync(path.join(dir, '_transcript.jsonl'), log);
  return { k, triggered: seen.has(SET.skill), used: used.has(SET.skill), skills: [...seen], tools: tools.slice(0, 8), ms: Math.round(performance.now() - t0) };
}

const queries = SET.queries.filter((q) => !ONLY || ONLY.includes(q.id));
const jobs = queries.flatMap((q) => Array.from({ length: RUNS }, (_, k) => ({ q, k })));
const results = new Map<string, Awaited<ReturnType<typeof runOnce>>[]>();
let next = 0, done = 0;
async function worker() {
  while (next < jobs.length) {
    const { q, k } = jobs[next++]!;
    const r = await runOnce(q, k).catch((e) => ({ k, triggered: false, used: false, skills: [], tools: [`error: ${e}`], ms: 0 }));
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

const rows = queries.map((q) => {
  const rs = results.get(q.id) ?? [];
  const rate = rs.filter((r) => r.triggered).length / Math.max(1, rs.length);
  const useRate = rs.filter((r) => r.used).length / Math.max(1, rs.length);
  // near-misses: Claude loads a skill only when it means to follow it, so a load is the failure; Codex reads
  // plausible skills to decide (it then often declines in its next message), so there the failure is using it
  const pass = q.should_trigger ? rate >= 0.5 : TOOL === 'codex' ? useRate < 0.5 : rate < 0.5;
  return { id: q.id, should_trigger: q.should_trigger, rate, useRate, pass, query: q.query, runs: rs };
});
const summary = {
  tool: TOOL, model: MODEL ?? 'default', skill: SET.skill, runs: RUNS, plugin: flag('plugin'), description: opt('description') ?? null,
  passed: rows.filter((r) => r.pass).length, total: rows.length,
  recall: rows.filter((r) => r.should_trigger).reduce((a, r) => a + r.rate, 0) / Math.max(1, rows.filter((r) => r.should_trigger).length),
  falseRate: rows.filter((r) => !r.should_trigger).reduce((a, r) => a + r.rate, 0) / Math.max(1, rows.filter((r) => !r.should_trigger).length),
  falseUseRate: rows.filter((r) => !r.should_trigger).reduce((a, r) => a + r.useRate, 0) / Math.max(1, rows.filter((r) => !r.should_trigger).length),
};
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 1));
console.log(`${TOOL} ${summary.model} ${SET.skill}: ${summary.passed}/${summary.total} pass · loaded on should ${(summary.recall * 100).toFixed(0)}% · loaded on near-misses ${(summary.falseRate * 100).toFixed(0)}% · used on near-misses ${(summary.falseUseRate * 100).toFixed(0)}%`);
for (const r of rows) if (!r.pass) console.log(`  FAIL ${r.id} (${r.should_trigger ? 'should' : 'should not'}) load ${r.rate.toFixed(2)} use ${r.useRate.toFixed(2)}: ${r.query}`);
console.log(OUT);
