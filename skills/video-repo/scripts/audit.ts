#!/usr/bin/env bun
// Audit the files proposed for a video repository, without changing files, the index or history.
// Sizes and duplicate hashes help choose what to keep. Secret and personal-path checks catch common
// leaks before a commit; photo and clip metadata checks flag location information for review.
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
const META_LIMIT = 2 * MiB; // Per metadata payload; containers are walked without loading media.
const DETAIL_LIMIT = 100; // Counts stay complete; terminal output stays usable.
const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE/i;
type Scope = 'working' | 'index' | 'history';
type Entry = { name: string; location?: string; size: number; oid?: string; mode?: string; disk?: string; link?: Buffer };
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
  { kind: 'npm authentication token', re: /(?:_authToken|_auth)\s*=\s*([^\s"'#;]+)/gi },
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
function learnEnv(text: string) {
  // Read values, never run a shell or expand variables. Ordinary settings are not secret literals.
  const assignment = /(?:^|\n)[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_.-]*)[ \t]*=[ \t]*(?:"((?:\\.|[^"\\])*)"|'([^']*)'|([^\r\n]*))/g;
  for (const match of text.replace(/^\uFEFF/, '').matchAll(assignment)) {
    if (!SECRET_NAME.test(match[1])) continue;
    const value = match[2] !== undefined
      ? match[2].replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      : match[3] !== undefined ? match[3] : (match[4] ?? '').replace(/[ \t]+#.*$/, '').trim();
    if (value.length >= 8) literals.add(value);
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
    if (p.kind === 'npm authentication token' && path.posix.basename(entry.name) !== '.npmrc') continue;
    for (const match of text.matchAll(new RegExp(p.re.source, p.re.flags))) {
      if (p.kind === 'npm authentication token' && /^\$\{[^}]+\}$/.test(match[1] ?? '')) continue;
      if (p.kind === 'URL credentials') {
        maskedLiterals.add(match[1]);
        credentialSpans.push([match.index!, match.index! + match[0].length]);
      }
      find('blocker', scope, name, p.kind, lineAt(text, match.index!), match[1] ?? match[0]);
    }
  }
  const assignment = /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|passwd)\b["']?\s*[:=]\s*["']?([A-Za-z0-9_./+=:-]{12,})/gi;
  for (const m of text.matchAll(assignment))
    find('review', scope, name, 'generic secret assignment', lineAt(text, m.index!), m[1]);
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
  const base = path.posix.basename(entry.name.replace(/\\/g, '/'));
  if ((base.startsWith('.env') && base !== '.env.example') ||
      /\.(?:pem|key|p12|pfx)$/i.test(base) || /^id_(?:rsa|dsa|ecdsa|ed25519)/i.test(base))
    find('blocker', scope, entry.location ?? entry.name, 'key/config file: inspect before committing');
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

// Prefix caching permits header probes, then monotonic metadata reads. Hashing streams all bytes,
// including skipped media, without retaining the file. Git blob streams and ordinary files share it.
class Content {
  private reader: StreamReader;
  private position = 0;
  private prefix = Buffer.alloc(0);
  private recent = Buffer.alloc(0);
  private recentStart = 0;
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
  async at(offset: number, count: number): Promise<Buffer> {
    if (offset < 0 || count < 0 || offset + count > this.size || count > TEXT_LIMIT)
      throw new AuditError('Metadata read exceeds its bounds.');
    let result: Buffer;
    if (offset < this.position) {
      const usePrefix = offset < this.prefix.length;
      const cache = usePrefix ? this.prefix : this.recent;
      const start = usePrefix ? offset : offset - this.recentStart;
      const cached = start < 0 ? -1 : Math.min(count, cache.length - start);
      if (cached < 0 || offset + cached < this.position && cached < count)
        throw new AuditError('Metadata layout requires an unsupported backwards read.');
      const head = cache.subarray(start, start + cached);
      result = cached === count ? head : Buffer.concat([head, await this.consume(count - cached, true)]);
    } else {
      await this.consume(offset - this.position, false);
      result = await this.consume(count, true);
    }
    this.recent = result; this.recentStart = offset;
    return result;
  }
  async head(length: number): Promise<Buffer> {
    const n = Math.min(length, this.size);
    if (n > this.prefix.length)
      this.prefix = Buffer.concat([this.prefix, await this.at(this.prefix.length, n - this.prefix.length)]);
    return this.prefix.subarray(0, n);
  }
  async finish(): Promise<string> {
    await this.consume(this.size - this.position, false);
    if (!await this.reader.ended())
      throw new AuditError('A file changed size during the audit. Finish writes to the project, then run again.');
    return this.hashEnabled ? this.hasher.digest('hex') : '';
  }
}

function gpsTiff(data: Buffer): boolean {
  if (data.length < 8) return false;
  const little = data.subarray(0, 2).toString('ascii') === 'II';
  if (!little && data.subarray(0, 2).toString('ascii') !== 'MM') return false;
  const u16 = (p: number) => little ? data.readUInt16LE(p) : data.readUInt16BE(p);
  const u32 = (p: number) => little ? data.readUInt32LE(p) : data.readUInt32BE(p);
  if (u16(2) !== 42) return false;
  let offset = u32(4);
  const seen = new Set<number>();
  for (let depth = 0; offset && depth < 16; depth++) {
    if (seen.has(offset) || offset < 8 || offset + 2 > data.length) throw new AuditError('Invalid TIFF directory.');
    seen.add(offset);
    const count = u16(offset), end = offset + 2 + count * 12;
    if (end + 4 > data.length) throw new AuditError('Truncated TIFF directory.');
    for (let p = offset + 2; p < end; p += 12)
      if (u16(p) === 0x8825 && u16(p + 2) === 4 && u32(p + 4) === 1) return true;
    offset = u32(end);
  }
  if (offset) throw new AuditError('TIFF directory limit reached.');
  return false;
}
async function metadata(content: Content, entry: Entry, scope: Scope) {
  const ext = path.posix.extname(entry.name).toLowerCase();
  const gps = () => find('review', scope, entry.name, 'GPS metadata candidate');
  const location = () => find('review', scope, entry.name, 'QuickTime location metadata candidate');
  try {
    if (['.jpg', '.jpeg'].includes(ext)) {
      const signature = await content.at(0, Math.min(2, content.size));
      if (signature.length !== 2 || signature.readUInt16BE() !== 0xffd8) throw new AuditError('Invalid JPEG.');
      let pos = 2, segments = 0;
      while (pos + 2 <= content.size && ++segments <= 4096) {
        const h = await content.at(pos, 2); pos += 2;
        if (h[0] !== 0xff) throw new AuditError('Invalid JPEG marker.');
        let marker = h[1];
        while (marker === 0xff && pos < content.size) marker = (await content.at(pos++, 1))[0];
        if (marker === 0xda || marker === 0xd9) return;
        if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
        const len = (await content.at(pos, 2)).readUInt16BE(); pos += 2;
        if (len < 2 || pos + len - 2 > content.size) throw new AuditError('Invalid JPEG segment.');
        if (marker === 0xe1) {
          const b = await content.at(pos, len - 2);
          if (b.subarray(0, 6).equals(Buffer.from('Exif\0\0')) && gpsTiff(b.subarray(6))) gps();
        }
        pos += len - 2;
      }
      throw new AuditError('JPEG segment limit or incomplete structure.');
    } else if (ext === '.png') {
      const sig = await content.at(0, Math.min(8, content.size));
      if (!sig.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new AuditError('Invalid PNG.');
      let pos = 8, chunks = 0;
      while (pos + 12 <= content.size && ++chunks <= 10000) {
        const h = await content.at(pos, 8), size = h.readUInt32BE(), type = h.toString('ascii', 4, 8);
        if (pos + size + 12 > content.size) throw new AuditError('Invalid PNG chunk.');
        if (type === 'eXIf') {
          if (size > META_LIMIT) throw new AuditError('PNG EXIF exceeds metadata limit.');
          if (gpsTiff(await content.at(pos + 8, size))) gps();
        }
        pos += size + 12;
        if (type === 'IEND') return;
      }
      throw new AuditError('PNG chunk limit or incomplete structure.');
    } else if (['.heic', '.heif', '.hif'].includes(ext)) {
      find('review', scope, entry.name, 'HEIC/HEIF metadata not checked; inspect its location metadata separately');
    } else if (['.mp4', '.mov', '.m4v'].includes(ext)) {
      let boxes = 0, inspected = 0;
      const walk = async (start: number, end: number, depth: number): Promise<void> => {
        if (depth > 12) throw new AuditError('QuickTime nesting limit.');
        let pos = start;
        while (pos + 8 <= end) {
          if (++boxes > 20000) throw new AuditError('QuickTime box limit.');
          const h = await content.at(pos, 8);
          let size = h.readUInt32BE(), header = 8;
          const type = h.toString('latin1', 4, 8);
          if (size === 1) {
            const big = (await content.at(pos + 8, 8)).readBigUInt64BE();
            if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new AuditError('QuickTime box too large.');
            size = Number(big); header = 16;
          } else if (size === 0) size = end - pos;
          if (size < header || pos + size > end) throw new AuditError('Invalid QuickTime box.');
          if (type === '\xa9xyz') location();
          const payload = pos + header, stop = pos + size;
          if (['moov', 'udta', 'trak', 'ilst'].includes(type)) {
            await walk(payload, stop, depth + 1);
          } else if (type === 'meta') {
            // ISO meta is a full box. Legacy QuickTime omits the four version/flags bytes.
            const probe = await content.at(payload, Math.min(4, stop - payload));
            const full = probe.length === 4 && probe.readUInt32BE() === 0;
            await walk(payload + (full ? 4 : 0), stop, depth + 1);
          } else if (['keys', 'data', '\xa9xyz'].includes(type)) {
            const n = Math.min(size - header, META_LIMIT - inspected);
            if (n < size - header) addLimit('QuickTime metadata payloads exceeded 2 MiB budget');
            if (n > 0) {
              const data = await content.at(payload, n); inspected += n;
              if (data.includes(Buffer.from('com.apple.quicktime.location')) || data.includes(Buffer.from([0xa9, 0x78, 0x79, 0x7a]))) location();
            }
          }
          pos = stop;
        }
        if (pos !== end) throw new AuditError('Truncated QuickTime box header.');
      };
      await walk(0, content.size, 0);
    }
  } catch {
    addLimit('Metadata could not be fully inspected');
    find('review', scope, entry.name, 'metadata check incomplete; inspect it separately (malformed, unsupported or bounded)');
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
  else if (scope !== 'history') await metadata(content, entry, scope);
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

function historicalEnvEntries(entries: Entry[]): Entry[] {
  if (!entries.length) return [];
  // rev-list names a blob only once. A later copy named backup.txt must not hide its earlier .env role.
  const byId = new Map(entries.map(e => [e.oid!, e]));
  const result = new Map<string, Entry>();
  const records = nul(git(['log', '--all', '--full-history', '--root', '-m', '--raw', '-z', '--no-renames',
    '--no-abbrev', '--format=', '--', ':(glob)**/.env*', ':(glob).env*']));
  for (let i = 0; i < records.length; i++) {
    const m = /^:([0-7]+) ([0-7]+) ([a-f0-9]+) ([a-f0-9]+) [A-Z]\d*$/.exec(records[i].trimStart());
    if (!m) throw new AuditError("Cannot parse historical .env paths. Check git log --all --raw and retry with current Git.");
    const name = records[++i];
    if (!name || !envFile(name)) throw new AuditError("Cannot identify a historical .env path. Check git log --all --raw and repair missing objects.");
    for (const [mode, oid] of [[m[1], m[3]], [m[2], m[4]]]) {
      const e = byId.get(oid);
      if (e && mode !== '160000') {
        result.set(oid, { ...e, name });
        // Prefer a real .env path over an alias; .env.example alone remains a permitted filename.
        if (!envFile(e.name) || path.posix.basename(e.name) === '.env.example') e.name = name;
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
  // Collect literals first, so diagnostics and paths are always redacted.
  for (const name of new Set([...names, ...ignored].filter(envFile))) {
    const entry = await workEntry(name);
    if (entry && entry.mode !== '120000') await learnEntry(entry);
  }
  for (const entry of index.filter(e => envFile(e.name))) await learnEntry(entry);
  const past = history ? historyEntries() : [];
  for (const entry of historicalEnvEntries(past)) await learnEntry(entry);
  say('Audara Git audit (read-only)');
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
  say('Metadata: JPEG/PNG GPS tags and QuickTime location markers, for review. HEIC/HEIF metadata is not checked.');
  if (history) say('History checks text, key filenames and sizes, not historical media metadata or commit messages/author identities.');
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
