// Claude Code keeps a folder per working directory under ~/.claude/projects (a session transcript, and a
// memory/ folder created at start even with --no-session-persistence). The eval harness runs in hundreds
// of throwaway folders, so this takes their entries out again: an entry with no files in it is deleted,
// one that holds a transcript is moved next to the run's results.
//   bun evals/harness/claude-projects-cleanup.ts [--dry-run]
import { readdirSync, rmSync, statSync, renameSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const hasFiles = (dir: string): boolean =>
  readdirSync(dir, { withFileTypes: true }).some((e) => e.isFile() || (e.isDirectory() && hasFiles(path.join(dir, e.name))));

/**
 * Remove (or move to `keepIn`) the ~/.claude/projects entries of folders under `under` (default: all of
 * audara-studio's evals/results/). Pass the run's own folder while other runs may still be going: their
 * live sessions must stay where `--resume` looks for them.
 */
export function cleanClaudeProjects(dryRun = false, keepIn?: string, under?: string) {
  const root = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'projects');
  // the entry name is the folder path with every non-alphanumeric character turned into '-'
  const slug = (p: string) => path.resolve(p).replace(/[^A-Za-z0-9]/g, '-').toLowerCase();
  const match = under ? (n: string) => n.toLowerCase().startsWith(slug(under)) : (n: string) => n.toLowerCase().includes('-audara-studio-evals-results-');
  let removed = 0, moved = 0;
  for (const name of readdirSync(root)) {
    if (!match(name)) continue;
    const p = path.join(root, name);
    if (!statSync(p).isDirectory()) continue;
    if (dryRun) { hasFiles(p) ? moved++ : removed++; continue; }
    if (hasFiles(p) && keepIn) { mkdirSync(keepIn, { recursive: true }); renameSync(p, path.join(keepIn, name)); moved++; }
    else if (!hasFiles(p)) { rmSync(p, { recursive: true }); removed++; }
  }
  return { removed, moved };
}

if (import.meta.main) {
  const dry = process.argv.includes('--dry-run');
  const keep = path.join(import.meta.dir, '..', 'results', 'claude-sessions');
  console.log(cleanClaudeProjects(dry, keep), dry ? '(dry run)' : '');
}
