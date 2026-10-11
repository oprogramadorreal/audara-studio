#!/usr/bin/env bun
// Offline audit regressions: bun evals/tests/test_audit.ts
// Every fixture, Git object and subprocess cache stays in one disposable OS temp folder.
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const auditScript = path.resolve(import.meta.dir, '../../skills/video-repo/scripts/audit.ts');
const tempParent = await fs.realpath(os.tmpdir());
const scratch = await fs.mkdtemp(path.join(tempParent, 'audara-audit-test-'));
const emptyConfig = path.join(scratch, 'empty-config');
const gitConfig = path.join(scratch, 'git-config');
const emptyTemplate = path.join(scratch, 'empty-template');
const secrets = new Set<string>();
const tests: { name: string; run: () => Promise<void> }[] = [];
let nextRepo = 0;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function secret(value = 'fixture-' + randomUUID()): string {
  secrets.add(value);
  return value;
}
// Do not expose real credentials to fixtures or inherit a Git directory, index, hook or config.
const env: Record<string, string> = {};
for (const [name, value] of Object.entries(process.env)) {
  if (value !== undefined && !/^(GIT_|BUN_|NODE_OPTIONS$)|KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE/i.test(name))
    env[name] = value;
}
Object.assign(env, {
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_COUNT: '0',
  GIT_CEILING_DIRECTORIES: scratch, GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: 'file',
  GIT_NO_LAZY_FETCH: '1', GIT_ATTR_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Audit Fixture', GIT_COMMITTER_NAME: 'Audit Fixture',
  GIT_AUTHOR_EMAIL: 'audit@example.invalid', GIT_COMMITTER_EMAIL: 'audit@example.invalid',
  TMPDIR: scratch, TMP: scratch, TEMP: scratch,
  BUN_RUNTIME_TRANSPILER_CACHE_PATH: path.join(scratch, 'bun-cache'),
});

function run(command: string, args: string[], cwd: string, extraEnv: Record<string, string> = {}) {
  const result = spawnSync(command, args, {
    cwd, env: { ...env, ...extraEnv }, encoding: 'utf8', windowsHide: true,
    timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
  });
  check(!result.error, 'subprocess could not run (Git and Bun are required)');
  check(result.signal === null, 'subprocess was terminated');
  return result;
}
function git(dir: string, ...args: string[]): string {
  const result = run('git', args, dir);
  // Do not echo arbitrary child output on failure: these fixtures intentionally contain secrets.
  check(result.status === 0, 'fixture git ' + args[0] + ' failed');
  return result.stdout.trim();
}
async function repo(): Promise<string> {
  const dir = path.join(scratch, 'repo-' + ++nextRepo);
  await fs.mkdir(dir);
  git(dir, 'init', '-q', '-b', 'main', '--template=' + emptyTemplate);
  return dir;
}
async function write(dir: string, name: string, contents: string | Buffer) {
  const file = path.join(dir, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents);
}
function audit(dir: string, expectedExit: number, flags: string[] = [], extraEnv: Record<string, string> = {}): string {
  const result = run(process.execPath, [auditScript, dir, ...flags], dir, extraEnv);
  for (const value of secrets) {
    for (const form of new Set([value, JSON.stringify(value).slice(1, -1)])) {
      check(!result.stdout.includes(form), 'full synthetic secret leaked to audit stdout');
      check(!result.stderr.includes(form), 'full synthetic secret leaked to audit stderr');
    }
  }
  check(result.status === expectedExit, 'expected audit exit ' + expectedExit + ', got ' + result.status);
  const verdict = expectedExit === 0 ? 'NO BLOCKERS FOUND' : expectedExit === 1 ? 'BLOCKED' : 'INCOMPLETE';
  check(result.stdout.includes('VERDICT: ' + verdict), 'missing matching audit verdict');
  return result.stdout;
}
function has(output: string, text: string) {
  check(output.includes(text), 'missing expected finding: ' + text);
}
function test(name: string, run: () => Promise<void>) { tests.push({ name, run }); }

test('copied secret-named environment value beyond 8 KiB blocks', async () => {
  const dir = await repo(), value = secret();
  await write(dir, 'capture.txt', 'Captured response: ' + 'x'.repeat(8192) + '\n' + value + '\n');
  const extraEnv = { AUDIT_TEST_TOKEN: value };
  has(audit(dir, 1, [], extraEnv), '[working] capture.txt:2 — known environment/.env value');
  git(dir, 'add', 'capture.txt');
  has(audit(dir, 1, ['--staged'], extraEnv), '[index] capture.txt:2 — known environment/.env value');
});

test('copied ignored .env value blocks', async () => {
  const dir = await repo(), value = secret();
  await write(dir, '.gitignore', '.env*\n');
  // Nested .env is not automatically loaded by Bun; the audit has to learn it itself.
  await write(dir, 'config/.env', "export PRIVATE_TOKEN='" + value + "'\n");
  await write(dir, 'capture.txt', value + '\n');
  const out = audit(dir, 1);
  has(out, 'Learned literal values: 1;');
  has(out, '[working] capture.txt:1 — known environment/.env value');
  check(!out.includes('[working] config/.env'), 'ignored .env became part of the selected set');
});

test('NODE_ENV=production is not a secret in environment or .env', async () => {
  const dir = await repo();
  await write(dir, '.gitignore', '.env*\n');
  await write(dir, 'config/.env', 'NODE_ENV=production\n');
  await write(dir, 'settings.txt', 'NODE_ENV=production\nproduction\n');
  const out = audit(dir, 0, [], { NODE_ENV: 'production' });
  has(out, 'Learned literal values: 0;');
  has(out, 'Blockers: 0');
});

test('known credential formats block and are masked', async () => {
  const dir = await repo();
  // Assemble fake formats at runtime so this source contains no key-shaped literal.
  const body = 'Ab3d'.repeat(10);
  const formats: [string, string, string][] = [
    ['openai.txt', ['sk', body].join('-'), 'OpenAI key'],
    ['openai-project.txt', ['sk', 'proj', body].join('-'), 'OpenAI key'],
    ['openai-service.txt', ['sk', 'svcacct', body].join('-'), 'OpenAI key'],
    ['anthropic.txt', ['sk', 'ant', body].join('-'), 'Anthropic key'],
    ['elevenlabs.txt', ['sk', 'abcdef0123456789'.repeat(2)].join('_'), 'ElevenLabs key'],
    ['github.txt', ['ghp', body].join('_'), 'GitHub token'],
    ['github-fine.txt', ['github', 'pat', body].join('_'), 'GitHub token'],
    ['aws.txt', ['AK', 'IA', 'AB12'.repeat(4)].join(''), 'AWS access key ID'],
    ['aws-session.txt', ['AS', 'IA', 'CD34'.repeat(4)].join(''), 'AWS access key ID'],
    ['google.txt', ['AI', 'za', body.slice(0, 35)].join(''), 'Google API key'],
    ['slack.txt', ['xoxb', body].join('-'), 'Slack token'],
    ['huggingface.txt', ['hf', body].join('_'), 'Hugging Face token'],
    ['stripe.txt', ['sk', 'live', body].join('_'), 'Stripe live secret'],
    ['private.txt', ['-----BEGIN ', 'PRIVATE KEY', '-----'].join(''), 'PEM private key'],
    ['url.txt', ['https://', 'fixture', ':', body, '@'].join(''), 'URL credentials'],
    ['.npmrc', body, 'npm authentication token'],
  ];
  for (const [file, value] of formats)
    await write(dir, file, (file === '.npmrc' ? '_authToken=' : '') + secret(value) + '\n');
  const out = audit(dir, 1);
  for (const [file, , kind] of formats) has(out, '[working] ' + file + ':1 — ' + kind);
});

test('URL passwords stay masked and credential spans are not email addresses', async () => {
  const dir = await repo(), password = secret(), shortPassword = secret(['Z', '9', '!'].join(''));
  const urls = [
    'https://fixture:' + password + '@private.example/path',
    'https://fixture:' + shortPassword + '@short.example/path',
  ];
  git(dir, 'config', 'user.email', password + '@identity.example');
  await write(dir, password + '.txt', 'ordinary text\n');
  // This file sorts before the URLs: its extracted email still needs the password masked at output.
  await write(dir, 'contacts.txt', password + '@copied.example\n');
  await write(dir, 'urls.txt', urls.join('\n') + '\nMaintainer: maintainer@example.invalid\n');
  const verify = (out: string, scope: string, location = 'urls.txt') => {
    has(out, 'Learned literal values: 0;');
    has(out, '[' + scope + '] ' + location + ':1 — URL credentials');
    has(out, '[' + scope + '] ' + location + ':2 — URL credentials');
    has(out, '[' + scope + '] ' + location + ':3 — email address');
    for (const line of [1, 2])
      check(!out.includes(location + ':' + line + ' — email address'), 'URL credentials were treated as an email address');
    const emails = out.split('Unique email addresses found in scanned text')[1]?.split('Git object storage:')[0] ?? '';
    has(emails, 'maintainer@example.invalid');
    has(emails, '@copied.example');
    check(!emails.includes('@private.example') && !emails.includes('@short.example'),
      'URL credentials entered the email summary');
  };
  verify(audit(dir, 1), 'working');
  git(dir, 'add', '.');
  verify(audit(dir, 1, ['--staged']), 'index');
  git(dir, 'commit', '-qm', 'fixture with URLs');
  const oid = git(dir, 'rev-parse', 'HEAD:urls.txt');
  git(dir, 'rm', '-q', 'urls.txt');
  git(dir, 'commit', '-qm', 'remove URLs');
  // Only history now reveals the password printed in current filenames and the configured email.
  verify(audit(dir, 1, ['--history']), 'history', 'urls.txt [blob ' + oid.slice(0, 12) + ']');
});

test('npm environment placeholder is not a credential', async () => {
  const dir = await repo();
  await write(dir, '.npmrc', '_authToken=' + '$' + '{NPM_TOKEN}\n');
  has(audit(dir, 0), 'Blockers: 0');
});

test('masking covers filenames and JSON-escaped copies', async () => {
  const dir = await repo(), filenameValue = secret(), escapedValue = secret('fixture-' + randomUUID() + '"\n\\tail');
  await write(dir, filenameValue + '.txt', 'ordinary text\n');
  await write(dir, 'request.json', JSON.stringify({ captured: escapedValue }) + '\n');
  const out = audit(dir, 1, [], { AUDIT_TEST_KEY: filenameValue, AUDIT_TEST_SECRET: escapedValue });
  has(out, '(path):1 — known environment/.env value');
  has(out, '[working] request.json:1 — known environment/.env value (JSON escaped)');
  has(out, '… [length ');
});

test('detected npm tokens and generic assignment values stay masked in filenames', async () => {
  const dir = await repo(), token = secret(), assigned = secret('Gen' + randomUUID().replace(/-/g, ''));
  await write(dir, '.npmrc', '_authToken=' + token + '\n');
  await write(dir, 'settings.txt', 'api_key = ' + assigned + '\n');
  // The values also name files: the file listings print paths after the scan found them.
  await write(dir, token + '.txt', 'ordinary text\n');
  await write(dir, assigned + '.txt', 'ordinary text\n');
  const out = audit(dir, 1);
  has(out, '[working] .npmrc:1 — npm authentication token');
  has(out, '[working] settings.txt:1 — generic secret assignment');
});

test('--history keeps an .npmrc name when the blob was renamed before deletion', async () => {
  const dir = await repo(), token = secret();
  await write(dir, '.npmrc', '_authToken=' + token + '\n');
  git(dir, 'add', '.npmrc');
  git(dir, 'commit', '-qm', 'fixture with npm token');
  git(dir, 'mv', '.npmrc', 'backup.txt');
  git(dir, 'commit', '-qm', 'rename npmrc');
  git(dir, 'rm', '-q', 'backup.txt');
  git(dir, 'commit', '-qm', 'remove npmrc');
  audit(dir, 0);
  has(audit(dir, 1, ['--history']), ':1 — npm authentication token');
});

test('quoted .npmrc credentials block and stay masked', async () => {
  const dir = await repo(), token = secret(), password = secret();
  await write(dir, '.npmrc', '//registry.example/:_authToken="' + token + '"\n//registry.example/:_password=\'' + password + '\'\n');
  const out = audit(dir, 1);
  has(out, '[working] .npmrc:1 — npm authentication token');
  has(out, '[working] .npmrc:2 — npm authentication token');
});

test('--history keeps a key file name (.p12) when the blob was renamed before deletion', async () => {
  const dir = await repo();
  await write(dir, 'signing.P12', Buffer.from([0x30, 0x82, 0x01, 0x00, 0, 1, 2, 3]));
  git(dir, 'add', 'signing.P12');
  git(dir, 'commit', '-qm', 'fixture with a key file');
  git(dir, 'mv', 'signing.P12', 'backup.bin');
  git(dir, 'commit', '-qm', 'rename key file');
  git(dir, 'rm', '-q', 'backup.bin');
  git(dir, 'commit', '-qm', 'remove key file');
  audit(dir, 0);
  has(audit(dir, 1, ['--history']), 'signing.P12 [blob ');
});

test('--history keeps every credential name: an .npmrc renamed backup.key is both', async () => {
  const dir = await repo(), token = secret();
  await write(dir, '.npmrc', '_authToken=' + token + '\n');
  // A file named after the token: its path is printed, so the npm scan has to learn the token to mask it.
  await write(dir, token + '.txt', 'ordinary text\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'fixture with npm token');
  git(dir, 'mv', '.npmrc', 'backup.key');
  git(dir, 'commit', '-qm', 'rename npmrc to a key-file name');
  git(dir, 'rm', '-q', 'backup.key', token + '.txt');
  git(dir, 'commit', '-qm', 'remove both');
  audit(dir, 0);
  const out = audit(dir, 1, ['--history']);
  has(out, ':1 — npm authentication token');
  has(out, '— key/config file: inspect before committing');
});

test('unquoted .env values end at # with or without a space before it', async () => {
  const dir = await repo(), value = secret(), spaced = secret();
  await write(dir, '.gitignore', '.env*\n');
  // Nested, so Bun doesn't load it into the environment: the audit has to read it itself.
  await write(dir, 'config/.env', 'PRIVATE_TOKEN=' + value + '#note\nOTHER_SECRET=' + spaced + ' # note\n');
  await write(dir, 'capture.txt', value + '\n' + spaced + '\n');
  const out = audit(dir, 1);
  has(out, 'Learned literal values: 2;');
  has(out, '[working] capture.txt:1 — known environment/.env value');
  has(out, '[working] capture.txt:2 — known environment/.env value');
});

test('100 MiB boundary: exact size warns, one byte over blocks', async () => {
  const dir = await repo(), file = await fs.open(path.join(dir, 'large.bin'), 'w');
  try {
    // Extend an empty file without allocating a 100 MiB buffer or writing it byte by byte.
    await file.truncate(100 * 1024 * 1024);
    has(audit(dir, 0), 'WARN 104857600 bytes  large.bin');
    await file.truncate(100 * 1024 * 1024 + 1);
    const out = audit(dir, 1);
    has(out, 'BLOCK 104857601 bytes  large.bin');
    has(out, '[working] large.bin — file exceeds 100 MiB');
  } finally { await file.close(); }
});

test('duplicates include exactly 4 KiB and exclude smaller files', async () => {
  const dir = await repo();
  for (const name of ['logo-a.bin', 'logo-b.bin']) await write(dir, name, Buffer.alloc(4096));
  for (const name of ['tiny-a.bin', 'tiny-b.bin']) await write(dir, name, Buffer.alloc(4095));
  const out = audit(dir, 0);
  const duplicates = out.split('SHA-256 duplicate groups')[1]?.split('Blockers:')[0] ?? '';
  has(duplicates, '2 identical files, 4096 bytes each:');
  has(duplicates, 'logo-a.bin');
  has(duplicates, 'logo-b.bin');
  check(!duplicates.includes('tiny-'), 'sub-4-KiB files reported as duplicates');
});

test('media hashes include bytes after 8 KiB; location metadata stays unchecked', async () => {
  const dir = await repo(), clip = Buffer.alloc(12 * 1024);
  // A location atom is intentionally left to a separate metadata tool.
  clip.writeUInt32BE(clip.length);
  clip.write('\xa9xyz', 4, 'latin1');
  for (const name of ['clip-a.mov', 'clip-b.mov']) await write(dir, name, clip);
  const different = Buffer.from(clip);
  different[different.length - 1] = 1;
  await write(dir, 'different-tail.mov', different);
  await write(dir, 'photo.jpg', Buffer.alloc(128));
  git(dir, 'add', '.');
  for (const flags of [[], ['--staged']]) {
    const out = audit(dir, 0, flags);
    has(out, 'audara-studio Git audit (read-only)');
    has(out, 'Location metadata in photos and clips is not checked. Inspect it with a tool at hand, or report it unchecked.');
    has(out, 'photo.jpg');
    has(out, 'To review: 0');
    const duplicates = out.split('SHA-256 duplicate groups')[1]?.split('Blockers:')[0] ?? '';
    has(duplicates, '2 identical files, 12288 bytes each:');
    has(duplicates, 'clip-a.mov');
    has(duplicates, 'clip-b.mov');
    check(!duplicates.includes('different-tail.mov'), 'media hash ignored bytes after the binary prefix');
  }
});

test('--staged reads index bytes in both directions and leaves them unchanged', async () => {
  const dir = await repo(), value = secret(), extraEnv = { AUDIT_TEST_TOKEN: value };
  const clean = 'ordinary text\n';
  await write(dir, 'capture.txt', value + '\n');
  git(dir, 'add', 'capture.txt');
  await write(dir, 'capture.txt', clean);
  const indexBefore = await fs.readFile(path.join(dir, '.git/index'));
  audit(dir, 0, [], extraEnv);
  has(audit(dir, 1, ['--staged'], extraEnv), '[index] capture.txt:1 — known environment/.env value');
  check(indexBefore.equals(await fs.readFile(path.join(dir, '.git/index'))), 'audit changed the index');
  check(await fs.readFile(path.join(dir, 'capture.txt'), 'utf8') === clean, 'audit changed the working file');

  git(dir, 'add', 'capture.txt');
  await write(dir, 'capture.txt', value + '\n');
  has(audit(dir, 1, [], extraEnv), '[working] capture.txt:1 — known environment/.env value');
  has(audit(dir, 0, ['--staged'], extraEnv), 'Set: entire index (exact staged blobs)');
});

test('--history finds a known key removed in a later commit', async () => {
  const dir = await repo(), value = secret(['ghp', 'Hist0ry'.repeat(6)].join('_'));
  await write(dir, 'old.txt', value + '\n');
  git(dir, 'add', 'old.txt');
  git(dir, 'commit', '-qm', 'fixture with key');
  const oid = git(dir, 'rev-parse', 'HEAD:old.txt');
  git(dir, 'rm', '-q', 'old.txt');
  git(dir, 'commit', '-qm', 'remove key');
  audit(dir, 0);
  const out = audit(dir, 1, ['--history']);
  has(out, '[history] old.txt [blob ' + oid.slice(0, 12) + ']:1 — GitHub token');
});

test('--history learns old .env values even when the blob has a later alias', async () => {
  const dir = await repo(), value = secret();
  await write(dir, '.env', 'PRIVATE_TOKEN=' + value + '\n');
  await write(dir, 'capture.txt', value + '\n');
  git(dir, 'add', '.env', 'capture.txt');
  git(dir, 'commit', '-qm', 'fixture with env');
  const copiedOid = git(dir, 'rev-parse', 'HEAD:capture.txt');
  git(dir, 'mv', '.env', 'backup.txt');
  git(dir, 'commit', '-qm', 'rename env');
  git(dir, 'rm', '-q', 'backup.txt', 'capture.txt');
  git(dir, 'commit', '-qm', 'remove values');
  git(dir, 'config', 'log.showRoot', 'false');
  audit(dir, 0);
  const out = audit(dir, 1, ['--history']);
  has(out, 'Learned literal values: 1;');
  has(out, '[history] capture.txt [blob ' + copiedOid.slice(0, 12) + ']:1 — known environment/.env value');
});

test('a subfolder scan learns .env values from the whole repository', async () => {
  const dir = await repo(), value = secret();
  await write(dir, '.gitignore', '.env*\n');
  await write(dir, 'config/.env', 'PRIVATE_TOKEN=' + value + '\n');
  await write(dir, 'notes.txt', value + '\n');
  await write(dir, 'video/note.txt', value + '\n');
  git(dir, 'add', '.');
  const subdir = path.join(dir, 'video');
  has(audit(subdir, 1), '[working] video/note.txt:1 — known environment/.env value');
  has(audit(subdir, 1, ['--staged']), '[index] notes.txt:1 — known environment/.env value');
});

test('.env values are learned as Bun reads them (backticks, escapes), not only raw', async () => {
  const dir = await repo(), id = () => randomUUID().replace(/-/g, '');
  await write(dir, '.gitignore', '.env*\n');
  // Backticks, an escaped backslash before n, an escaped quote and a backslash in single quotes: Bun and the
  // raw text disagree on each. Nested, so Bun doesn't load it into the audit's own environment.
  const file = path.join(dir, 'config/.env');
  await write(dir, 'config/.env', 'A_TOKEN=`Bt' + id() + '`\nB_TOKEN="Dq' + id() + '\\\\n\\"x"\nC_TOKEN=\'Sq' + id() + '\\\\y\'\nD_TOKEN=Uq' + id() + '\\\\z\n');
  const parsed = run(process.execPath, ['--env-file=' + file, '-e',
    'console.log(JSON.stringify(["A","B","C","D"].map((k) => process.env[k + "_TOKEN"])))'], scratch);
  check(parsed.status === 0, 'bun could not parse the fixture .env');
  const values: string[] = JSON.parse(parsed.stdout);
  for (const v of values) secret(v);
  await write(dir, 'capture.txt', values.join('\n') + '\n');
  const out = audit(dir, 1);
  for (const line of [1, 2, 3, 4]) has(out, '[working] capture.txt:' + line + ' — known environment/.env value');
});

test('.env values are also learned as Node dotenv reads them ("\\\\n": a backslash, then a newline)', async () => {
  const dir = await repo(), head = 'Nd' + randomUUID().replace(/-/g, ''), tail = 'Tl' + randomUUID().replace(/-/g, '');
  await write(dir, '.gitignore', '.env*\n');
  await write(dir, 'config/.env', 'B_TOKEN="' + head + '\\\\n' + tail + '"\n');
  // dotenv's own steps: \n, then \r, replaced in the text between the double quotes, and nothing else
  const value = secret((head + '\\\\n' + tail).replace(/\\n/g, '\n').replace(/\\r/g, '\r'));
  check(value === head + '\\\n' + tail, 'the fixture is not the reading it means to test');
  await write(dir, 'capture.txt', 'copied: ' + value + '\n');
  has(audit(dir, 1), '[working] capture.txt:1 — known environment/.env value');
});

test('ancestor repo is announced; working scope is local and staged scope is whole repo', async () => {
  const dir = await repo(), value = secret(), extraEnv = { AUDIT_TEST_TOKEN: value };
  await write(dir, 'outside.txt', value + '\n');
  await write(dir, 'project/note.txt', 'ordinary text\n');
  git(dir, 'add', '.');
  const subdir = path.join(dir, 'project');
  const out = audit(subdir, 0, [], extraEnv);
  has(out, 'ATTENTION: Git root is ABOVE projectDir.');
  has(out, '--staged and --history cover the WHOLE repository.');
  has(out, 'Selected set\n1 files/blobs;');
  has(audit(subdir, 1, ['--staged'], extraEnv), '[index] outside.txt:1 — known environment/.env value');
});

test('home paths are review findings, not blockers', async () => {
  const dir = await repo();
  await write(dir, 'paths.txt', 'C:\\Users\\audit-fixture\\song.wav\n/Users/audit-fixture/song.wav\n/home/audit-fixture/song.wav\n');
  const out = audit(dir, 0);
  for (const line of [1, 2, 3])
    has(out, '[working] paths.txt:' + line + ' — personal home path / possible outside dependency');
});

test('outside a Git work tree exits 2 with an actionable fix', async () => {
  const dir = path.join(scratch, 'no-repo');
  await fs.mkdir(dir);
  const out = audit(dir, 2);
  has(out, 'Not inside a Git work tree');
  has(out, 'git init -b main');
  has(out, 'then run this audit again');
  check(!out.includes('NO BLOCKERS FOUND'), 'incomplete audit claimed a clean result');
});

let passed = 0;
try {
  await fs.writeFile(emptyConfig, '');
  // Keep these settings out of GIT_CONFIG_KEY_*: KEY-named env values are audit inputs.
  await fs.writeFile(gitConfig, '[core]\n  excludesFile = ' + JSON.stringify(emptyConfig.replaceAll('\\', '/')) +
    '\n  hooksPath = ' + JSON.stringify(emptyTemplate.replaceAll('\\', '/')) + '\n');
  await fs.mkdir(emptyTemplate);
  for (const entry of tests) {
    try {
      await entry.run();
      passed++;
      console.log('PASS ' + entry.name);
    } catch (error) {
      // All assertion messages are ours; child stdout/stderr and secret values stay out of diagnostics.
      console.error('FAIL ' + entry.name + ': ' + (error instanceof Error ? error.message : 'unknown failure'));
    }
  }
} finally {
  // Only remove the unique folder created above, never a computed parent or a redirected target.
  const resolved = await fs.realpath(scratch);
  check(path.dirname(resolved) === tempParent && path.basename(resolved).startsWith('audara-audit-test-'),
    'refusing cleanup outside the test temp folder');
  await fs.rm(resolved, { recursive: true, force: true });
}
console.log(passed + '/' + tests.length + ' checks passed');
process.exitCode = passed === tests.length ? 0 : 1;
