#!/usr/bin/env bun
// audara-studio: audit proposed repository files without changing files, the index or history.
// Sizes and duplicate hashes help choose what to keep. Secret, email and personal-path checks catch
// common leaks before a commit. Location metadata in photos and clips is not checked.
// Only secret-named environment/.env variables supply literal values (8+ characters). Output masks
// secrets, even in filenames. The checks are a net, not proof: their limits are listed under Coverage.
//
// Usage:
//   bun <skill>/scripts/audit.ts [projectDir=.] [--staged] [--history]
//   default    tracked + non-ignored untracked files under projectDir, excluding deleted files
//   --staged   the entire index, read as Git blobs, including entries outside projectDir
//   --history  also check every blob reachable from any ref, including old secrets and large files
//
// Exit 0: no blockers found; review findings and coverage limits may remain.
// Exit 1: a secret/key file or a file over 100 MiB was found.
// Exit 2: a command or file could not be read; the error says what to fix.
// Git warnings are notes under Coverage. No installation, network call or writes.

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

class AuditError extends Error {}
const MiB = 1024 * 1024;
const TEXT_LIMIT = 2 * MiB; // Bounded text, even when a file has the wrong extension.
const HEADER = 8192; // A NUL here identifies binary data; this deliberately excludes UTF-16.
const HASH_MIN = 4 * 1024; // Include small logos without reporting every tiny repeated snippet.
const DETAIL_LIMIT = 100; // Counts stay complete; terminal output stays usable.
const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE/i;
type Scope = 'working' | 'index' | 'history';
// (aliases: every credential-file name a historical blob ever had; each one's checks apply to it)
type Entry = { name: string; location?: string; size: number; oid?: string; mode?: string; disk?: string; link?: Buffer; aliases?: string[] };
type Finding = { severity: 'blocker' | 'review'; scope: Scope; name: string; line?: number; kind: string; sample?: string };
type Pattern = { kind: string; re: RegExp };
const patterns: Pattern[] = [
  { kind: 'OpenAI key', re: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g },
  { kind: 'Anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: 'ElevenLabs key', re: /\bsk_[a-fA-F0-9]{32,}\b/g },
  { kind: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { kind: 'AWS access key ID', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { kind: 'Google API key', re: /\bAIza[A-Za-z0-9_-]{35}\b/g },
  { kind: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { kind: 'Hugging Face token', re: /\bhf_[A-Za-z0-9]{20,}\b/g },
  { kind: 'Stripe live secret', re: /\bsk_live_[A-Za-z0-9]{16,}\b/g },
  { kind: 'PEM private key', re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g },
  { kind: 'URL credentials', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s\/:@"'<>]+:([^\s\/@"'<>]+)@/gi },
  // (npm reads a value quoted or not: a double-quoted one, group 1, as JSON; any other is group 2)
  { kind: 'npm authentication token', re: /(?:_authToken|_auth|_password)\s*=\s*(?:"((?:\\.|[^"\\\r\n])*)"|'?([^\s"'#;]+))/gi },
];
const literals = new Set<string>();
// URL passwords are redacted everywhere, without counting as environment/.env inputs.
const maskedLiterals = new Set<string>();
const findings: Finding[] = [];
const findingKeys = new Set<string>();
const limits = new Map<string, number>();
const gitWarnings = new Set<string>();
const emails = new Set<string>();
const duplicateGroups = new Map<string, Entry[]>();
let gitRoot = '';
let projectDir = '';
let gitEmail = '';
let batch: BlobBatch | undefined;

function addLimit(kind: string) { limits.set(kind, (limits.get(kind) ?? 0) + 1); }
function masked(value: string): string {
  const prefix = value.length > 3 ? value.slice(0, 3).replace(/[\x00-\x20\x7f]/g, '?') : '';
  return prefix + '… [length ' + value.length + ']';
}
function safe(value: string): string {
  let result = value;
  for (const literal of [...new Set([...literals, ...maskedLiterals])].sort((a, b) => b.length - a.length)) {
    if (!literal) continue; // (an empty one would split every character)
    result = result.split(literal).join(masked(literal));
    result = result.split(JSON.stringify(literal).slice(1, -1)).join(masked(literal));
  }
  for (const p of patterns) result = result.replace(new RegExp(p.re.source, p.re.flags), (m) => masked(m));
  return result.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,
    c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}
function say(value = '') {
  if (value.startsWith('\n')) { console.log(); value = value.slice(1); }
  console.log(safe(value));
}
function find(severity: Finding['severity'], scope: Scope, name: string, kind: string, line?: number, sample?: string) {
  const key = [severity, scope, name, kind, line ?? '', sample ?? ''].join('\0');
  if (findingKeys.has(key)) return;
  findingKeys.add(key);
  findings.push({ severity, scope, name, kind, line, sample: sample ? masked(sample) : undefined });
}
const gitEnvironment = () => ({
  ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0',
});
function git(args: string[], cwd = gitRoot || projectDir, allowUnset = false, input?: string): Buffer {
  const r = spawnSync('git', args, {
    cwd, input: input === undefined ? undefined : Buffer.from(input), encoding: 'buffer', windowsHide: true, maxBuffer: 128 * MiB, env: gitEnvironment(),
  });
  if (r.error || r.status !== 0) {
    if ((r.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT')
      throw new AuditError('git not found: install it (winget install Git.Git / brew install git / apt install git), reopen the terminal and run again.');
    if (allowUnset && !r.error && r.status === 1) return Buffer.alloc(0);
    // Classify known errors, never echo stderr: it can contain secrets in paths or URLs.
    const detail = r.stderr?.toString('utf8') ?? '';
    if (args[0] === 'rev-parse' && /not a git repository/i.test(detail))
      throw new AuditError('Not inside a Git work tree: run git init -b main in the project first, then run this audit again.');
    if (/dubious ownership/i.test(detail))
      throw new AuditError('Git refused repository ownership. Verify its owner, mark that repository safe if trusted, then retry.');
    throw new AuditError('Git ' + args[0] + ' failed. Check repository permissions and Git configuration; for missing objects, run git fsck and restore them before retrying.');
  }
  if (r.stderr.length) gitWarnings.add(args[0] ?? 'command');
  return r.stdout;
}
function nul(data: Buffer): string[] { return data.toString('utf8').split('\0').filter(Boolean); }
function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}
function envFile(name: string): boolean { return path.posix.basename(name.replace(/\\/g, '/')).startsWith('.env'); }
function npmrcFile(name: string): boolean { return path.posix.basename(name.replace(/\\/g, '/')) === '.npmrc'; }
const KEY_FILES = ['*.pem', '*.key', '*.p12', '*.pfx', 'id_rsa*', 'id_dsa*', 'id_ecdsa*', 'id_ed25519*'];
function keyFileName(name: string): boolean {
  const base = path.posix.basename(name.replace(/\\/g, '/'));
  return /\.(?:pem|key|p12|pfx)$/i.test(base) || /^id_(?:rsa|dsa|ecdsa|ed25519)/i.test(base);
}
/** A name some check depends on: a .env* file, an .npmrc, a key file. */
function credentialName(name: string): boolean { return envFile(name) || npmrcFile(name) || keyFileName(name); }
function allNames(entry: Entry): string[] { return [entry.name, ...(entry.aliases ?? [])]; }
function learnEnv(text: string) {
  // Read values, never run a shell or expand variables. Ordinary settings are not secret literals.
  // Readers differ on quotes and escapes, so a value is learned in every reading a copy could take, the raw
  // text included: a copy is found as a substring, and an extra reading costs nothing. Bun strips backticks
  // and turns \\ into \ even unquoted; in double quotes it reads \n \r \\ in one pass and keeps \" and \t.
  // Node's dotenv replaces \n, then \r, and nothing else ("\\n" becomes \ and a newline); python-dotenv also
  // reads \t \" \' \\ in one pass.
  const assignment = /(?:^|\n)[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_.-]*)[ \t]*=[ \t]*(?:"((?:\\.|[^"\\])*)"|'([^']*)'|`([^`]*)`|([^\r\n]*))/g;
  const onePass = (s: string, table: Record<string, string>) => s.replace(/\\(.)/g, (all, c: string) => table[c] ?? all);
  const bun = { n: '\n', r: '\r', '\\': '\\' }, python = { ...bun, t: '\t', '"': '"', "'": "'" };
  for (const match of text.replace(/^\uFEFF/, '').matchAll(assignment)) {
    if (!SECRET_NAME.test(match[1])) continue;
    // (unquoted, a # starts a comment with or without a space before it, as dotenv and Bun read it)
    const raw = match[2] ?? match[3] ?? match[4] ?? (match[5] ?? '').replace(/#.*$/, '').trim();
    const readings = new Set([raw, raw.replace(/\\\\/g, '\\')]);
    if (match[2] !== undefined) {
      readings.add(onePass(raw, bun));
      readings.add(raw.replace(/\\n/g, '\n').replace(/\\r/g, '\r'));
      readings.add(onePass(raw, python));
    }
    for (const value of readings) if (value.length >= 8) literals.add(value);
  }
}
let lineText = '';
let lineBreaks: number[] = [];
function lineAt(text: string, offset: number): number {
  if (text !== lineText) {
    lineText = text; lineBreaks = [];
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineBreaks.push(i);
  }
  let lo = 0, hi = lineBreaks.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (lineBreaks[mid] < offset) lo = mid + 1; else hi = mid;
  }
  return lo + 1;
}
function textScan(text: string, entry: Entry, scope: Scope) {
  const name = entry.location ?? entry.name;
  for (const value of literals) {
    const at = text.indexOf(value);
    if (at >= 0) find('blocker', scope, name, 'known environment/.env value', lineAt(text, at), value);
    // JSON-escaped values are common in request records.
    const escaped = JSON.stringify(value).slice(1, -1);
    const escapedAt = escaped === value ? -1 : text.indexOf(escaped);
    if (escapedAt >= 0) find('blocker', scope, name, 'known environment/.env value (JSON escaped)', lineAt(text, escapedAt), value);
  }
  const credentialSpans: [number, number][] = [];
  const inCredentials = (start: number, end: number) =>
    credentialSpans.some(([from, to]) => start < to && end > from);
  for (const p of patterns) {
    // _authToken is meaningful in npm config; avoid treating source code describing it as credentials.
    if (p.kind === 'npm authentication token' && !allNames(entry).some(npmrcFile)) continue;
    for (const match of text.matchAll(new RegExp(p.re.source, p.re.flags))) {
      const npm = p.kind === 'npm authentication token';
      const value = npm ? match[1] ?? match[2] ?? '' : match[1] ?? match[0];
      if (!value || (npm && /^\$\{[^}]+\}$/.test(value))) continue;
      // A detected value is masked wherever it shows up in the output, a file name included, and so is
      // npm's own reading of a double-quoted one (JSON: f is f).
      maskedLiterals.add(value);
      if (npm && match[1] !== undefined)
        try { maskedLiterals.add(JSON.parse('"' + match[1] + '"')); } catch { /* not JSON: npm keeps it as written */ }
      if (p.kind === 'URL credentials') credentialSpans.push([match.index!, match.index! + match[0].length]);
      find('blocker', scope, name, p.kind, lineAt(text, match.index!), value);
    }
  }
  const assignment = /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|passwd)\b["']?\s*[:=]\s*["']?([A-Za-z0-9_./+=:-]{12,})/gi;
  for (const m of text.matchAll(assignment)) {
    maskedLiterals.add(m[1]);
    find('review', scope, name, 'generic secret assignment', lineAt(text, m.index!), m[1]);
  }
  const home = os.homedir().replace(/\\/g, '/').replace(/\/$/, '');
  const homeForms = [...new Set([home, home.replace(/\//g, '\\'), home.replace(/\//g, '\\\\')])];
  for (const value of homeForms) {
    const at = text.toLowerCase().indexOf(value.toLowerCase());
    if (at >= 0) find('review', scope, name, 'current home directory', lineAt(text, at));
  }
  const personal = /(?:[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'<>;,)\]}]+|\/(?:Users|home)\/[^/\s"'<>;,)\]}]+)/g;
  for (const m of text.matchAll(personal))
    find('review', scope, name, 'personal home path / possible outside dependency', lineAt(text, m.index!));
  const email = /\b[A-Za-z0-9.!#$%&'*+/=?^_{}|~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}\b/g;
  for (const m of text.matchAll(email)) {
    // user:password@host contains an email-shaped substring, not a contact address.
    if (inCredentials(m.index!, m.index! + m[0].length)) continue;
    emails.add(m[0]);
    find('review', scope, name, m[0].toLowerCase() === gitEmail.toLowerCase() ? 'configured Git email' : 'email address', lineAt(text, m.index!));
  }
  if (gitEmail) {
    const at = text.indexOf(gitEmail);
    if (at >= 0 && !inCredentials(at, at + gitEmail.length))
      find('review', scope, name, 'configured Git email', lineAt(text, at));
  }
}
function keyFile(entry: Entry, scope: Scope) {
  const flagged = allNames(entry).some((n) => {
    const base = path.posix.basename(n.replace(/\\/g, '/'));
    return (envFile(base) && base !== '.env.example') || keyFileName(base);
  });
  if (flagged) find('blocker', scope, entry.location ?? entry.name, 'key/config file: inspect before committing');
}

// Shared buffered reader for files and Git's batch stream. Content adds only bounded samples and hashes.
class StreamReader {
  private iterator: AsyncIterator<Buffer>;
  private chunk = Buffer.alloc(0);
  private offset = 0;
  constructor(stream: AsyncIterable<Buffer>) { this.iterator = stream[Symbol.asyncIterator](); }
  private async ready(): Promise<boolean> {
    while (this.offset === this.chunk.length) {
      const next = await this.iterator.next();
      if (next.done) return false;
      this.chunk = Buffer.from(next.value); this.offset = 0;
    }
    return true;
  }
  async take(max: number): Promise<Buffer> {
    if (!await this.ready())
      throw new AuditError('Data ended early. Finish file writes and retry; for Git blobs, run git fsck and restore missing objects.');
    const end = Math.min(this.chunk.length, this.offset + max);
    const result = this.chunk.subarray(this.offset, end); this.offset = end;
    return result;
  }
  async line(): Promise<string> {
    const bytes: number[] = []; // Only Git's short headers use this, never file contents.
    for (let i = 0; i < 1024; i++) {
      const byte = (await this.take(1))[0];
      if (byte === 10) return Buffer.from(bytes).toString('ascii');
      bytes.push(byte);
    }
    throw new AuditError('Invalid Git object header. Run git fsck and restore damaged objects, then retry.');
  }
  async ended(): Promise<boolean> { return !await this.ready(); }
}
class BlobBatch {
  private child;
  private reader: StreamReader;
  private broken = false;
  constructor() {
    this.child = spawn('git', ['cat-file', '--batch'], {
      cwd: gitRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: gitEnvironment(),
    });
    this.child.on('error', () => { this.broken = true; });
    this.child.stdin.on('error', () => { this.broken = true; });
    this.child.stderr.on('data', () => gitWarnings.add('cat-file'));
    this.reader = new StreamReader(this.child.stdout);
  }
  async content(oid: string): Promise<{ size: number; chunks: AsyncIterable<Buffer> }> {
    if (this.broken || !/^[a-f0-9]{40,64}$/.test(oid)) throw new AuditError("Git object stream unavailable. Check Git runs, then run git fsck and retry.");
    this.child.stdin.write(oid + '\n');
    const header = await this.reader.line();
    const match = /^([a-f0-9]+) blob (\d+)$/.exec(header);
    if (!match || match[1] !== oid) throw new AuditError("Git blob missing. Run git fsck, restore missing objects and retry.");
    const size = Number(match[2]), reader = this.reader;
    if (!Number.isSafeInteger(size)) throw new AuditError("Git blob is too large for this audit. Use a tool that supports blobs above JavaScript's safe integer range.");
    return { size, chunks: (async function* () {
      let remaining = size;
      while (remaining) {
        const part = await reader.take(Math.min(65536, remaining));
        remaining -= part.length;
        yield part;
      }
      const end = await reader.take(1);
      if (end[0] !== 10) throw new AuditError("Invalid Git object data. Run git fsck, restore damaged objects and retry.");
    })() };
  }
  stop() { this.child.stdin.end(); this.child.kill(); }
}

// Cache only the prefix needed for text checks. Hash all bytes as they stream past, including
// skipped binary content, without retaining the file. Git blobs and ordinary files share this reader.
class Content {
  private reader: StreamReader;
  private position = 0;
  private prefix = Buffer.alloc(0);
  private hasher = createHash('sha256');
  private hashEnabled: boolean;
  constructor(readonly size: number, chunks: AsyncIterable<Buffer>, hash = true) {
    this.reader = new StreamReader(chunks); this.hashEnabled = hash && size >= HASH_MIN;
  }
  private async consume(count: number, keep: boolean): Promise<Buffer> {
    const pieces: Buffer[] = [];
    while (count) {
      const part = await this.reader.take(count);
      if (keep) pieces.push(part);
      if (this.hashEnabled) this.hasher.update(part);
      this.position += part.length; count -= part.length;
    }
    return keep ? Buffer.concat(pieces) : Buffer.alloc(0);
  }
  async head(length: number): Promise<Buffer> {
    const n = Math.min(length, this.size);
    if (n > this.prefix.length)
      this.prefix = Buffer.concat([this.prefix, await this.consume(n - this.prefix.length, true)]);
    return this.prefix.subarray(0, n);
  }
  async finish(): Promise<string> {
    await this.consume(this.size - this.position, false);
    if (!await this.reader.ended())
      throw new AuditError('A file changed size during the audit. Finish writes to the project, then run again.');
    return this.hashEnabled ? this.hasher.digest('hex') : '';
  }
}

async function workEntry(name: string): Promise<Entry | undefined> {
  const disk = path.join(gitRoot, name);
  if (!inside(gitRoot, disk)) throw new AuditError("A Git path escapes the work tree. Inspect git ls-files and correct the unexpected path before retrying.");
  let stat: fs.Stats;
  try { stat = await fsp.lstat(disk); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR') return;
    throw new AuditError("Cannot inspect a file. Grant read access, close software locking it and retry.");
  }
  const realParent = await fsp.realpath(path.dirname(disk));
  if (!inside(gitRoot, realParent)) throw new AuditError("File resolves outside the work tree. Make inputs local or exclude the external link, then retry.");
  if (stat.isSymbolicLink()) {
    const link = Buffer.from(await fsp.readlink(disk));
    return { name, disk, size: link.length, mode: '120000', link };
  }
  if (!stat.isFile()) return;
  return { name, disk, size: stat.size, mode: '100644' };
}
async function contentFor(entry: Entry, hash = true): Promise<Content> {
  if (entry.oid) {
    batch ??= new BlobBatch();
    const source = await batch.content(entry.oid);
    entry.size = source.size;
    return new Content(source.size, source.chunks, hash);
  }
  if (entry.link) {
    const value = entry.link;
    return new Content(value.length, (async function* () { yield value; })(), hash);
  }
  return new Content(entry.size, fs.createReadStream(entry.disk!, { highWaterMark: 65536 }), hash);
}
async function learnEntry(entry: Entry) {
  const content = await contentFor(entry, false);
  const h = await content.head(HEADER);
  if (!h.includes(0)) {
    const data = await content.head(TEXT_LIMIT);
    learnEnv(data.toString('utf8'));
    if (entry.size > TEXT_LIMIT) addLimit('.env literal collection truncated at 2 MiB');
  }
  await content.finish();
}
async function inspect(entry: Entry, scope: Scope, duplicates: boolean) {
  const content = await contentFor(entry, duplicates);
  keyFile(entry, scope);
  textScan(entry.name, { ...entry, location: (entry.location ?? entry.name) + ' (path)' }, scope);
  if (entry.size > 100 * MiB) find('blocker', scope, entry.location ?? entry.name, 'file exceeds 100 MiB');
  const h = await content.head(HEADER);
  if (h.includes(0)) addLimit(scope + ': binary content excluded from text checks');
  else {
    const data = await content.head(TEXT_LIMIT);
    textScan(data.toString('utf8'), entry, scope);
    if (entry.size > TEXT_LIMIT) {
      addLimit(scope + ': text scan truncated at 2 MiB');
      find('review', scope, entry.location ?? entry.name, 'text scan incomplete after 2 MiB');
    }
  }
  if (entry.mode === '120000') find('review', scope, entry.location ?? entry.name, 'symlink: target bytes checked, dependency not followed');
  const digest = await content.finish();
  if (duplicates && entry.size >= HASH_MIN) {
    const group = duplicateGroups.get(digest) ?? [];
    group.push(entry); duplicateGroups.set(digest, group);
  }
}
function indexEntries(): Entry[] {
  const result: Entry[] = [];
  for (const record of nul(git(['ls-files', '--stage', '-z']))) {
    const match = /^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/.exec(record);
    if (!match) throw new AuditError("Cannot parse the index. Check git status, repair index problems and retry with current Git.");
    if (match[3] !== '0') throw new AuditError("Unmerged index entries: finish the merge and stage the resolutions, then run this audit again.");
    if (match[1] === '160000') {
      find('review', 'index', match[4], 'submodule: external repository content not scanned');
      continue;
    }
    result.push({ name: match[4], oid: match[2], mode: match[1], size: 0 });
  }
  return result;
}
function historyEntries(): Entry[] {
  const listed = git(['-c', 'core.quotePath=false', 'rev-list', '--objects', '--all']).toString('utf8').trim();
  if (!listed) return [];
  const labels = new Map<string, string>();
  for (const line of listed.split('\n')) {
    const match = /^([a-f0-9]{40,64})(?: (.*))?$/.exec(line);
    if (match) labels.set(match[1], match[2] || '(no path recorded)');
  }
  const checked = git(['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
    gitRoot, false, [...labels.keys()].join('\n') + '\n').toString('utf8');
  const result: Entry[] = [];
  for (const line of checked.trim().split('\n')) {
    const m = /^([a-f0-9]+) (\w+) (\d+)$/.exec(line);
    if (!m) throw new AuditError("Historical object missing. Run git fsck, restore missing objects and retry.");
    if (m[2] === 'blob') result.push({ name: labels.get(m[1])!, oid: m[1], size: Number(m[3]) });
  }
  return result;
}

/** The .env blobs any ref reaches (to learn their values), after giving every blob that was ever a credential
 *  file (credentialName) each such name: rev-list names a blob only once, and a later copy named backup.txt
 *  must not hide the names its checks depend on (key files, .npmrc tokens). */
function historicalCredentialFiles(entries: Entry[]): Entry[] {
  if (!entries.length) return [];
  const byId = new Map(entries.map(e => [e.oid!, e]));
  const result = new Map<string, Entry>();
  const specs = [':(glob)**/.env*', ':(glob).env*', ':(glob)**/.npmrc', ':(glob).npmrc',
    ...KEY_FILES.flatMap((p) => [':(glob,icase)**/' + p, ':(glob,icase)' + p])];
  const records = nul(git(['log', '--all', '--full-history', '--root', '-m', '--raw', '-z', '--no-renames',
    '--no-abbrev', '--format=', '--', ...specs]));
  for (let i = 0; i < records.length; i++) {
    const m = /^:([0-7]+) ([0-7]+) ([a-f0-9]+) ([a-f0-9]+) [A-Z]\d*$/.exec(records[i].trimStart());
    if (!m) throw new AuditError("Cannot parse historical credential-file paths. Check git log --all --raw and retry with current Git.");
    const name = records[++i];
    if (!name || !credentialName(name)) throw new AuditError("Cannot identify a historical credential-file path. Check git log --all --raw and repair missing objects.");
    for (const [mode, oid] of [[m[1], m[3]], [m[2], m[4]]]) {
      const e = byId.get(oid);
      if (e && mode !== '160000') {
        if (envFile(name)) result.set(oid, { ...e, name });
        // Every credential name the blob had keeps its checks (an .npmrc renamed backup.key is both), and the
        // report shows one of them rather than an alias such as backup.txt (.env.example alone is permitted).
        if (!allNames(e).includes(name)) (e.aliases ??= []).push(name);
        if (!credentialName(e.name) || path.posix.basename(e.name) === '.env.example') e.name = name;
      }
    }
  }
  return [...result.values()];
}

function sizes(title: string, entries: Entry[]) {
  say('\n' + title);
  say(entries.length + ' files/blobs; ' + entries.reduce((sum, x) => sum + x.size, 0) + ' bytes');
  say('Largest 15:');
  for (const e of [...entries].sort((a, b) => b.size - a.size).slice(0, 15))
    say('  ' + e.size + ' bytes (' + (e.size / MiB).toFixed(2) + ' MiB)  ' + e.name + (e.oid ? ' [blob ' + e.oid.slice(0, 12) + ']' : ''));
  const large = entries.filter(e => e.size > 50 * MiB);
  say('Above 50 MiB: ' + large.length + ' (above 100 MiB blocks ordinary GitHub Git files)');
  for (const e of large) say('  ' + (e.size > 100 * MiB ? 'BLOCK' : 'WARN') + ' ' + e.size + ' bytes  ' + e.name);
}
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(fs.readFileSync(import.meta.path, 'utf8').split('\n').slice(1).filter((line, i, all) =>
      line.startsWith('//') && all.slice(0, i).every(x => x.startsWith('//'))).map(x => x.replace(/^\/\/ ?/, '')).join('\n'));
    return;
  }
  let staged = false, history = false, dir: string | undefined;
  for (const arg of args) {
    if (arg === '--staged') staged = true;
    else if (arg === '--history') history = true;
    else if (arg.startsWith('-') || dir !== undefined) throw new AuditError('Usage: audit.ts [projectDir=.] [--staged] [--history]');
    else dir = arg;
  }
  for (const [name, value] of Object.entries(process.env))
    if (SECRET_NAME.test(name) && value && value.length >= 8) literals.add(value);
  try { projectDir = await fsp.realpath(path.resolve(dir ?? '.')); }
  catch { throw new AuditError('Project folder is missing or unreadable. Pass an existing project directory and grant read access, then retry.'); }
  gitRoot = await fsp.realpath(git(['rev-parse', '--show-toplevel'], projectDir).toString('utf8').trim());
  if (!inside(gitRoot, projectDir)) throw new AuditError("Project is outside the detected Git work tree. Pass a directory within the repository, then retry.");
  gitEmail = git(['config', '--get', 'user.email'], gitRoot, true).toString('utf8').trim();
  const relative = path.relative(gitRoot, projectDir).replace(/\\/g, '/');
  const scopePath = relative ? ':(top,literal)' + relative : '.';
  const index = indexEntries();
  const names = [...new Set(nul(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', scopePath])))];
  const ignored = nul(git(['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--', scopePath]));
  const working: Entry[] = [];
  for (const name of names) {
    const entry = await workEntry(name);
    if (entry) working.push(entry);
  }
  // Collect literals first, so diagnostics and paths are always redacted. .env files anywhere in the
  // repository teach values, not only those under projectDir: --staged reads the whole index, and a copy of
  // a key kept in ../config/.env is still a copy.
  const envSpecs = ['--', ':(glob)**/.env*', ':(glob).env*'];
  const envFiles = [...nul(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', ...envSpecs])),
    ...nul(git(['ls-files', '-z', '--others', '--ignored', '--exclude-standard', ...envSpecs]))];
  for (const name of new Set(envFiles.filter(envFile))) {
    const entry = await workEntry(name);
    if (entry && entry.mode !== '120000') await learnEntry(entry);
  }
  for (const entry of index.filter(e => envFile(e.name))) await learnEntry(entry);
  const past = history ? historyEntries() : [];
  for (const entry of historicalCredentialFiles(past)) await learnEntry(entry);
  say('audara-studio Git audit (read-only)');
  say('Scanning contents...');
  const selected = staged ? index : working;
  for (const entry of selected) await inspect(entry, staged ? 'index' : 'working', true);
  for (const entry of past) {
    // Include the immutable object ID in findings; rev-list gives one representative historical path.
    await inspect({ ...entry, location: entry.name + ' [blob ' + entry.oid!.slice(0, 12) + ']' }, 'history', false);
  }
  // Finish all scans before reporting paths or addresses: a later URL can reveal a password to mask.
  say('Git root: ' + gitRoot);
  say('Project: ' + projectDir);
  if (relative) say('ATTENTION: Git root is ABOVE projectDir. Working inventory is project-scoped; --staged and --history cover the WHOLE repository.');
  say('Set: ' + (staged ? 'entire index (exact staged blobs)' : 'working files under projectDir, tracked + non-ignored untracked; deleted files omitted'));
  say('Git author email (configured, not changed): ' + (gitEmail || '(unset)'));
  say('Learned literal values: ' + literals.size + '; only secret-named environment/.env variables with values >=8 characters count.');
  sizes('Selected set', selected);
  if (history) {
    sizes('All-ref history (unique reachable blobs, not cumulative checkout bytes)', past);
    say('History locations use one representative path and blob ID; reflog-only/dangling objects and submodule histories are excluded.');
  }
  say('\nIgnored working files (under projectDir; not scanned except .env literal collection)');
  const ignoredGroups = new Map<string, { count: number; bytes: number }>();
  for (const name of ignored) {
    const e = await workEntry(name);
    if (!e) continue;
    const rel = path.relative(projectDir, path.join(gitRoot, name)).replace(/\\/g, '/');
    const folder = rel.includes('/') ? rel.split('/')[0] + '/' : '(project root)';
    const group = ignoredGroups.get(folder) ?? { count: 0, bytes: 0 };
    group.count++; group.bytes += e.size; ignoredGroups.set(folder, group);
  }
  for (const [folder, group] of [...ignoredGroups].sort((a, b) => b[1].bytes - a[1].bytes))
    say('  ' + folder + ': ' + group.count + ' files, ' + group.bytes + ' bytes');
  if (!ignoredGroups.size) say('  None');
  say('\nSHA-256 duplicate groups (selected set; files >=4 KiB)');
  const groups = [...duplicateGroups.values()].filter(group => group.length > 1);
  for (const group of groups) {
    say('  ' + group.length + ' identical files, ' + group[0].size + ' bytes each:');
    for (const e of group) say('    ' + e.name);
  }
  if (!groups.length) say('  None');
  for (const severity of ['blocker', 'review'] as const) {
    const items = findings.filter(f => f.severity === severity);
    say('\n' + (severity === 'blocker' ? 'Blockers' : 'To review') + ': ' + items.length);
    for (const f of items.slice(0, DETAIL_LIMIT))
      say('  [' + f.scope + '] ' + f.name + (f.line ? ':' + f.line : '') + ' — ' + f.kind + (f.sample ? ' (' + f.sample + ')' : ''));
    if (items.length > DETAIL_LIMIT) say('  ' + (items.length - DETAIL_LIMIT) + ' more findings omitted from display; counts include all.');
    const counts = new Map<string, number>();
    for (const f of items) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
    for (const [kind, count] of counts) say('  Count: ' + kind + ' = ' + count);
  }
  say('\nUnique email addresses found in scanned text');
  for (const email of [...emails].sort().slice(0, DETAIL_LIMIT)) say('  ' + email);
  if (emails.size > DETAIL_LIMIT) say('  ' + (emails.size - DETAIL_LIMIT) + ' more unique addresses omitted.');
  if (!emails.size) say('  None');
  const counts = git(['count-objects', '-v']).toString('utf8');
  const disk = (key: string) => Number(new RegExp('^' + key + ': (\\d+)$', 'm').exec(counts)?.[1] ?? 0) * 1024;
  say('\nGit object storage: ' + (disk('size') + disk('size-pack')) + ' bytes (Git-reported KiB converted; loose + pack storage, not checkout size).');
  if (Bun.which('gitleaks')) say('gitleaks is available. Optional extra: gitleaks git --redact . (run at Git root; not run by this audit).');
  say('\nCoverage');
  say('Text: first 2 MiB/file, skipping NUL in first 8 KiB. No binary/UTF-16 secrets, archives, image text or arbitrary key formats.');
  say('Location metadata in photos and clips is not checked. Inspect it with a tool at hand, or report it unchecked.');
  say('.env values are read as written, in each quoting reading: a value built from ${OTHER} references is not expanded.');
  if (history) say('History checks text, key filenames and sizes, not commit messages/author identities.');
  say('Working scans use current disk bytes; concurrent changes and Git filters can change staged bytes. Run --staged after staging.');
  for (const [kind, count] of limits) say('  ' + kind + ': ' + count);
  if (gitWarnings.size)
    say('Note: Git emitted warnings during ' + [...gitWarnings].join(', ') + '. Unreadable ignore files can expose additional files to this audit; warnings alone do not change its verdict.');
  const blockers = findings.filter(f => f.severity === 'blocker').length;
  const reviews = findings.filter(f => f.severity === 'review').length;
  process.exitCode = blockers ? 1 : 0;
  say('VERDICT: ' + (blockers ? 'BLOCKED' : 'NO BLOCKERS FOUND') +
    ' — ' + blockers + ' blocker(s), ' + reviews + ' review finding(s); exit ' + process.exitCode + '.');
}

try { await main(); }
catch (error) {
  // Do not echo arbitrary exception text: OS and Git errors can expose names or secret-bearing URLs.
  say('INCOMPLETE: ' + (error instanceof AuditError ? error.message : 'Cannot read the requested project or its files. Check paths and permissions.'));
  say('VERDICT: INCOMPLETE — exit 2; no clean result.');
  process.exitCode = 2;
} finally { batch?.stop(); }
