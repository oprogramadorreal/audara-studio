#!/usr/bin/env bun
// Offline checks of how the preview reads its soundtrack: bun evals/tests/test_soundtrack.ts
// Runs the template's actual readLength and loadSegments (src/engine/soundtrack.ts) with the browser's Audio
// and fetch stubbed; main.ts's actual retrySoundtrack with a stub engine and a hand-run clock; and the length
// main.ts gives a soundtrack read late, against what a fresh boot gives, with the engine's resolveDuration.
import assert from 'node:assert/strict';
import path from 'node:path';

const TEMPLATE = path.resolve(import.meta.dir, '../../skills/code-video/assets/template-webgl/src');
const transpiler = new Bun.Transpiler({ loader: 'ts' });
const soundtrackTS = await Bun.file(path.join(TEMPLATE, 'engine/soundtrack.ts')).text();
const mainTS = await Bun.file(path.join(TEMPLATE, 'main.ts')).text();

type Unread = 'missing' | 'not audio' | 'not read yet';
type Spec = { file: string; url: string; at: number; from: number; dur?: number; fadeOut?: number };
type Seg = { file: string; url: string; at: number; from: number; dur: number; fadeOut?: number };
type Video = { duration?: number; audio: Spec[] | null };

// ------------------------------------------------------------------ soundtrack.ts, with the browser stubbed
/** What each URL does: its metadata (a length), a media error (its code), no answer at all; and the probe's answer. */
type Behaviour = { media: { length: number } | { error: number } | 'hang'; probe?: { status: number; type: string } | 'throws' };
const world = new Map<string, Behaviour>();
const released: string[] = [], probes: { url: string; range: string | null }[] = [];
class FakeAudio {
  preload = '';
  duration = NaN;
  error: { code: number } | null = null;
  onloadedmetadata: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private url = '';
  set src(url: string) {
    this.url = url;
    const b = world.get(url)?.media ?? { error: 4 };
    if (b === 'hang') return;
    queueMicrotask(() => {
      if ('length' in b) { this.duration = b.length; this.onloadedmetadata?.(); }
      else { this.error = { code: b.error }; this.onerror?.(); }
    });
  }
  removeAttribute(name: string) { if (name === 'src') released.push(this.url); }
  load() {}
}
const fakeFetch = async (url: string, init?: { headers?: Record<string, string> }) => {
  probes.push({ url, range: init?.headers?.range ?? null });
  const p = world.get(url)?.probe ?? { status: 404, type: 'text/plain' };
  if (p === 'throws') throw new TypeError('Failed to fetch');
  return { status: p.status, ok: p.status >= 200 && p.status < 300, headers: { get: (h: string) => (h === 'content-type' ? p.type : null) }, body: { cancel: async () => {} } };
};
const engineJS = transpiler.transformSync(soundtrackTS).replace(/^export /gm, '');
assert(!/^import /m.test(engineJS), 'soundtrack.ts has an import this test does not stub');
const ST = new Function('Audio', 'fetch', 'AbortSignal', `${engineJS}\nreturn { readLength, loadSegments, resolveDuration };`)(
  FakeAudio, fakeFetch, { timeout: () => undefined },
) as {
  readLength(url: string, timeoutMs?: number): Promise<number | Unread>;
  loadSegments(specs: Spec[] | null): Promise<{ segments: Seg[] | null; problems: string[] }>;
  resolveDuration(v: Video, segments: Seg[] | null, analysis: number | null): { duration: number; source: string } | null;
};

const cases: [string, () => void | Promise<void>][] = [];
const test = (name: string, run: () => void | Promise<void>) => cases.push([name, run]);

test('readLength: a length, or why there is none', async () => {
  world.clear();
  world.set('/ok.wav', { media: { length: 17 } });
  world.set('/gone.wav', { media: { error: 4 }, probe: { status: 404, type: 'text/plain' } });
  world.set('/page.wav', { media: { error: 4 }, probe: { status: 200, type: 'text/html' } }); // (a dev server's page in its place)
  world.set('/junk.wav', { media: { error: 4 }, probe: { status: 206, type: 'audio/wav' } });
  world.set('/empty.wav', { media: { length: Infinity }, probe: { status: 200, type: 'audio/wav' } });
  world.set('/broke.wav', { media: { error: 2 } }); // (MEDIA_ERR_NETWORK: the read broke off)
  world.set('/slow.wav', { media: 'hang' });
  world.set('/flaky.wav', { media: { error: 4 }, probe: 'throws' });
  world.set('/teapot.wav', { media: { error: 4 }, probe: { status: 500, type: 'text/plain' } });
  const got: Record<string, number | Unread> = {};
  for (const u of world.keys()) got[u] = await ST.readLength(u, 30);
  assert.deepEqual(got, {
    '/ok.wav': 17, '/gone.wav': 'missing', '/page.wav': 'missing', '/junk.wav': 'not audio', '/empty.wav': 'not audio',
    '/broke.wav': 'not read yet', '/slow.wav': 'not read yet', '/flaky.wav': 'not read yet', '/teapot.wav': 'not read yet',
  });
  assert.deepEqual(released.sort(), [...world.keys()].sort(), 'every read lets its file go, the one that timed out too');
  assert(probes.every((p) => p.range === 'bytes=0-0'), 'the probe asks for one byte');
  assert(!probes.some((p) => ['/ok.wav', '/slow.wav', '/broke.wav'].includes(p.url)), 'only a refused file is probed');
});

test('loadSegments: the readable segments, and each unread file worded by why', async () => {
  world.clear();
  world.set('/a.wav', { media: { length: 10 } });
  world.set('/b.wav', { media: 'hang' });
  world.set('/c.wav', { media: { error: 4 }, probe: { status: 404, type: 'text/plain' } });
  world.set('/d.wav', { media: { error: 4 }, probe: { status: 200, type: 'audio/mpeg' } });
  const spec = (n: string, at: number, dur?: number): Spec => ({ file: `videos/v/audio/${n}.wav`, url: `/${n}.wav`, at, from: 0, ...(dur ? { dur } : {}) });
  const realTimeout = globalThis.setTimeout;
  // (the 15 s of the slow one, at once)
  (globalThis as any).setTimeout = (fn: () => void, ms: number) => realTimeout(fn, ms >= 15000 ? 0 : ms);
  try {
    const r = await ST.loadSegments([spec('a', 0, 4), spec('b', 5, 2), spec('c', 8, 1), spec('d', 10, 1), spec('a', 12, 3)]);
    assert.deepEqual(r.segments?.map((s) => [s.url, s.at, s.dur]), [['/a.wav', 0, 4], ['/a.wav', 12, 3]]);
    assert.deepEqual(r.problems, [
      "audio: videos/v/audio/b.wav (named in video.json) hasn't been read yet: the read didn't complete",
      'audio: videos/v/audio/c.wav (named in video.json) is missing',
      "audio: videos/v/audio/d.wav (named in video.json) isn't audio the browser can play",
    ]);
    const one = await ST.loadSegments([{ file: 'videos/v/audio/a.wav', url: '/a.wav', at: 0, from: 2 }]);
    assert.deepEqual(one.segments?.map((s) => s.dur), [8], "a single file plays to its own end");
    assert(!r.problems.some((p) => /is it audio/.test(p)));
  } finally { (globalThis as any).setTimeout = realTimeout; }
});

// ------------------------------------------------------------------ main.ts's retry, with a stub engine
function slice(src: string, start: string, end: string) {
  const a = src.indexOf(start), b = src.indexOf(end, a);
  assert(a >= 0 && b > a, `main.ts markers changed: ${start}`);
  return src.slice(a, b + end.length);
}
const retryJS = transpiler.transformSync(
  [slice(mainTS, 'const audioProblems = ', ';\n'), slice(mainTS, 'function retrySoundtrack(', '\n}\n')].join('\n'));

test('retrySoundtrack: tries until every file is read, the latest problems shown meanwhile', async () => {
  const timeline = 'videos/v/timeline.ts: two entries are called \'a\' (ids must be unique)';
  const engine = { bootErrors: ['audio: cannot read videos/v/audio/a.wav (named in video.json): is the file there, and is it audio?', timeline], errorsVersion: 0 };
  const VIDEO = { audio: [{ file: 'videos/v/audio/a.wav', url: '/a.wav', at: 0, from: 0 }] };
  const seg: Seg = { file: 'videos/v/audio/a.wav', url: '/a.wav', at: 0, from: 0, dur: 17 };
  const answers = [
    ...Array.from({ length: 6 }, () => ({ segments: null, problems: ["audio: videos/v/audio/a.wav (named in video.json) hasn't been read yet: the read didn't complete"] })),
    { segments: null, problems: ['audio: videos/v/audio/a.wav (named in video.json) is missing'] },
    { segments: [seg], problems: [] },
  ];
  let tries = 0;
  const loadSegments = async (specs: unknown) => { assert.equal(specs, VIDEO.audio, 'each try reads every file video.json names'); return answers[tries++]!; };
  const timers: { fn: () => void; ms: number }[] = [];
  const setTimeout = (fn: () => void, ms: number) => { timers.push({ fn, ms }); return timers.length; };
  const { retrySoundtrack } = new Function('engine', 'VIDEO', 'loadSegments', 'setTimeout', `${retryJS}\nreturn { retrySoundtrack };`)(engine, VIDEO, loadSegments, setTimeout);
  const read: Seg[][] = [];
  let shown = 0;
  retrySoundtrack((s: Seg[]) => read.push(s), () => shown++);
  assert.deepEqual(engine.bootErrors, [`${engine.bootErrors[0]!.replace(/ \(trying again\)$/, '')} (trying again)`, timeline], "the boot's own problem says it is tried again, at once");
  assert(shown === 1 && engine.errorsVersion === 1);
  const settle = () => new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
  const waits: number[] = [];
  for (let i = 0; i < 20 && !read.length; i++) {
    await settle();
    if (read.length) break;
    assert.equal(engine.bootErrors.length, 2);
    assert.match(engine.bootErrors[0]!, i < 6 ? /hasn't been read yet: the read didn't complete \(trying again\)$/ : /is missing \(trying again\)$/);
    assert.equal(engine.bootErrors[1], timeline, 'the other boot problems stay, after the audio ones as at boot');
    const t = timers.shift();
    assert(t, 'another try is planned');
    waits.push(t.ms);
    t.fn();
  }
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 15000, 15000, 15000], 'waits double up to 15 s');
  assert.deepEqual(read, [[seg]], 'onRead gets the segments once, when all are read');
  assert.deepEqual(engine.bootErrors, [timeline], 'and the audio problems are gone');
  assert.equal(timers.length, 0, 'no try after that');
});

// ------------------------------------------------------------------ the length a late read gives
// main.ts's own expression, run against the engine's resolveDuration: whatever the boot read, it gives what a
// fresh boot gives with every file read, and it differs from the boot's length only where main.ts reloads.
const lengthExpr = /const d = (resolveDuration\(VIDEO, segments, [^;]+\));/.exec(mainTS)?.[1];
assert(lengthExpr, "main.ts's recovered length moved");
const recovered = new Function('resolveDuration', 'VIDEO', 'segments', 'engine', 'D', `return ${lengthExpr};`) as
  (r: typeof ST.resolveDuration, v: Video, segments: Seg[], engine: { audio: { synthetic: boolean } }, D: number) => { duration: number } | null;

test('a soundtrack read late gets the length a fresh boot gives; only a changed length reloads', () => {
  const S = (file: string, at: number, dur?: number): Spec => ({ file, url: `/${file}`, at, from: 0, ...(dur ? { dur } : {}) });
  const one = [S('song.wav', 0)], list = [S('a.wav', 0, 8), S('b.wav', 9, 7)];
  const lengths: Record<string, number> = { '/song.wav': 17.2, '/a.wav': 10, '/b.wav': 10 };
  const segs = (specs: Spec[], read: string[]): Seg[] | null => {
    const out = specs.filter((s) => read.includes(s.file)).map((s) => ({ ...s, dur: s.dur ?? lengths[s.url]! - s.from }));
    return out.length ? out : null;
  };
  // [what, video.json, data/audio.json's length (null: none), files the boot read, does the page reload]
  const table: [string, Video, number | null, string[], boolean][] = [
    ['one file, with data/audio.json', { audio: one }, 17, [], false],
    ['one file, with a duration', { audio: one, duration: 20 }, null, [], false],
    ['a list with a duration', { audio: list, duration: 30 }, 16, ['a.wav'], false],
    ['a list missing its last file', { audio: list }, null, ['a.wav'], true],
    ['a list missing its first file', { audio: list }, null, ['b.wav'], false],
    ['a list not read, data/audio.json as long', { audio: list }, 16, [], false],
    ['a list not read, data/audio.json shorter', { audio: list }, 15.5, [], true],
  ];
  for (const [what, v, analysis, read, reloads] of table) {
    const boot = ST.resolveDuration(v, segs(v.audio!, read), analysis)!;
    const all = segs(v.audio!, v.audio!.map((s) => s.file))!;
    const fresh = ST.resolveDuration(v, all, analysis)!;
    const late = recovered(ST.resolveDuration, v, all, { audio: { synthetic: analysis === null } }, boot.duration)!;
    assert.equal(late.duration, fresh.duration, `${what}: the length of a fresh boot`);
    assert.equal(late.duration !== boot.duration, reloads, `${what}: ${reloads ? 'reloads' : 'plays in place'}`);
  }
  // (one file with nothing else to give the length: the boot can't start, and the page reloads once it is read)
  assert.equal(ST.resolveDuration({ audio: one }, null, null), null);
});

let failed = 0;
for (const [name, run] of cases) {
  try { await run(); console.log(`ok   ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).stack ?? e}`); }
}
console.log(failed ? `\n${failed} of ${cases.length} failed` : `\nall ${cases.length} passed`);
process.exit(failed ? 1 : 0);
