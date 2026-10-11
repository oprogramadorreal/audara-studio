#!/usr/bin/env bun
// Offline checks of how init merges its entries into a project's own .gitignore:
//   bun evals/tests/test_init_gitignore.ts
// Each case writes a .gitignore, runs skills/code-video/scripts/init.ts --no-install on the folder, creates the
// files in question and asks git (with no global or system config) whether the merged rules ignore them.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const INIT = path.resolve(import.meta.dir, '../../skills/code-video/scripts/init.ts');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'audara-init-test-'));
const emptyConfig = path.join(scratch, 'empty-gitconfig');
writeFileSync(emptyConfig, '');
const env = { ...process.env, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_CEILING_DIRECTORIES: scratch };

function project(name: string, gitignore: string) {
  const dir = path.join(scratch, name);
  mkdirSync(dir);
  writeFileSync(path.join(dir, '.gitignore'), gitignore);
  Bun.spawnSync(['git', 'init', '-q', '-b', 'main'], { cwd: dir, env });
  // (init's exit code also counts missing prerequisites, such as Chrome, which these checks don't need)
  const r = Bun.spawnSync([process.execPath, INIT, dir, '--no-install'], { env, stdout: 'pipe', stderr: 'pipe' });
  if (!r.stdout.toString().includes('.gitignore')) throw new Error('init did not report its .gitignore step:\n' + r.stdout + r.stderr);
  return dir;
}
function ignored(dir: string, file: string) {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), 'x\n');
  return Bun.spawnSync(['git', 'check-ignore', '-q', file], { cwd: dir, env }).exitCode === 0;
}

const cases: [string, () => void][] = [
  ['a rooted /out/ still gets out/, so a video\'s own out/ is ignored', () => {
    const dir = project('rooted-out', 'node_modules/\n/out/\n');
    if (!ignored(dir, 'out/v/v.mp4')) throw new Error('out/v/v.mp4 is not ignored');
    if (!ignored(dir, 'videos/v/intro/out/mix-report.json')) throw new Error('a nested out/ is not ignored');
  }],
  ['entries go before the first exception, so "!.env.example" keeps working', () => {
    const dir = project('exception', '/.env.*\n!.env.example\n');
    if (ignored(dir, '.env.example')) throw new Error('.env.example became ignored');
    if (!ignored(dir, '.env.local')) throw new Error('.env.local is not ignored');
    if (!ignored(dir, 'config/.env.local')) throw new Error('a nested .env.local is not ignored');
    const text = readFileSync(path.join(dir, '.gitignore'), 'utf8');
    if (text.indexOf('!.env.example') < text.indexOf('# video project (audara)')) throw new Error('the exception no longer comes last');
  }],
  ['with no exception, entries are appended and the project\'s own rules kept', () => {
    const dir = project('plain', '# mine\n*.psd\n');
    const text = readFileSync(path.join(dir, '.gitignore'), 'utf8');
    if (!text.startsWith('# mine\n*.psd\n')) throw new Error('the project\'s own rules moved');
    if (!ignored(dir, 'art/cover.psd') || !ignored(dir, '.env')) throw new Error('a rule stopped working');
  }],
];

let passed = 0;
try {
  for (const [name, run] of cases) {
    try { run(); passed++; console.log('PASS ' + name); }
    catch (e) { console.log('FAIL ' + name + ': ' + (e as Error).message); }
  }
} finally { rmSync(scratch, { recursive: true, force: true }); }
console.log(passed + '/' + cases.length + ' checks passed');
process.exitCode = passed === cases.length ? 0 : 1;
