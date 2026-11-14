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
  world.set('/zero.wav', { media: { error: 4 }, probe: { status: 416, type: '' } }); // (an empty file: Vite can't give its byte)
  world.set('/empty.wav', { media: { length: Infinity }, probe: { status: 200, type: 'audio/wav' } });
  world.set('/broke.wav', { media: { error: 2 } }); // (MEDIA_ERR_NETWORK: the read broke off)
  world.set('/slow.wav', { media: 'hang' });
  world.set('/flaky.wav', { media: { error: 4 }, probe: 'throws' });
  world.set('/teapot.wav', { media: { error: 4 }, probe: { status: 500, type: 'text/plain' } });
  const got: Record<string, number | Unread> = {};
  for (const u of world.keys()) got[u] = await ST.readLength(u, 30);
  assert.deepEqual(got, {
    '/ok.wav': 17, '/gone.wav': 'missing', '/page.wav': 'missing', '/junk.wav': 'not audio', '/zero.wav': 'not audio', '/empty.wav': 'not audio',
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

// ------------------------------------------------------------------ the player that takes over
/** soundtrack.ts again, its SoundtrackPlayer on a hand-run clock with audio elements that only keep state. */
let clock = 0;
class PlayerAudio {
  preload = ''; paused = true; currentTime = 0; volume = 1; duration = NaN;
  constructor(public url: string) {}
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
}
const { SoundtrackPlayer } = new Function('Audio', 'fetch', 'AbortSignal', 'performance', `${engineJS}\nreturn { SoundtrackPlayer };`)(
  PlayerAudio, fakeFetch, { timeout: () => undefined }, { now: () => clock },
) as { SoundtrackPlayer: new (segs: Seg[], duration: number) => Player };
type Player = { now(): number; playing: boolean; seek(t: number): void; play(): void; pause(): void; sync(): void };
const { takeOver } = new Function('SoundtrackPlayer', `${transpiler.transformSync(slice(mainTS, 'function takeOver(', '\n}\n'))}\nreturn { takeOver };`)(SoundtrackPlayer) as
  { takeOver(old: Player, segments: Seg[], D: number): Player };

test('takeOver: the new player goes on from where the old one is, playing or paused', () => {
  const seg: Seg = { file: 'videos/v/audio/a.wav', url: '/a.wav', at: 0, from: 0, dur: 10 };
  const els = (p: Player) => (p as unknown as { els: PlayerAudio[] }).els;
  // playing, mid-video
  clock = 0;
  let old = new SoundtrackPlayer([], 10);
  old.seek(2); old.play();
  clock = 1500;
  let next = takeOver(old, [seg], 10);
  assert.equal(next.now(), 3.5);
  assert(next.playing && !els(next)[0]!.paused && els(next)[0]!.currentTime === 3.5, 'it plays, with sound, from 3.5 s');
  // paused
  clock = 0;
  old = new SoundtrackPlayer([], 10);
  old.seek(4);
  next = takeOver(old, [seg], 10);
  assert(next.now() === 4 && !next.playing && els(next)[0]!.paused, 'it stays paused, at 4 s');
  // the clock ran past the end since the last frame (a background tab): stopped there, not played again from 0
  clock = 0;
  old = new SoundtrackPlayer([], 10);
  old.seek(8); old.play();
  clock = 4000;
  next = takeOver(old, [seg], 10);
  assert(next.now() === 10 && !next.playing, `at the end, stopped (got ${next.now()}, ${next.playing ? 'playing' : 'paused'})`);
  // in its last millisecond: playing on, and stopped at the end by the next frame (play() would start again from 0)
  clock = 0;
  old = new SoundtrackPlayer([], 10);
  old.seek(9); old.play();
  clock = 999.5;
  next = takeOver(old, [seg], 10);
  assert(next.playing && Math.abs(next.now() - 9.9995) < 1e-9, `plays on from 9.9995 s (got ${next.now()}, ${next.playing ? 'playing' : 'paused'})`);
  clock = 1016;
  next.sync();
  assert(next.now() === 10 && !next.playing, 'and stops at the end');
  // a partial soundtrack's own sound stops
  clock = 0;
  old = new SoundtrackPlayer([{ ...seg, url: '/b.wav', at: 5, dur: 5 }], 10);
  old.seek(6); old.play(); old.sync();
  assert(!els(old)[0]!.paused);
  clock = 500;
  next = takeOver(old, [seg, { ...seg, url: '/b.wav', at: 5, dur: 5 }], 10);
  assert(els(old)[0]!.paused, "the old player's element is paused");
  assert(next.playing && next.now() === 6.5);
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

// ------------------------------------------------------------------ the clock at the display's refresh
type Steered = Player & { now(at?: number): number; sync(force?: boolean, at?: number): void };
const rateOf = (p: Player) => (p as unknown as { rate: number }).rate;

test('now(at): the time at a given moment, never before the clock was set; now() reads its own', () => {
  clock = 1000;
  const p = new SoundtrackPlayer([], 60) as Steered;
  p.seek(2); p.play();
  assert.equal(p.now(1500), 2.5);
  assert.equal(p.now(990), 2, 'a moment before play() (a refresh that began before the click) is its start');
  clock = 1250;
  assert.equal(p.now(), 2.25);
  p.pause();
  assert.equal(p.now(5000), 2.25, 'paused, the time stays');
});

/**
 * Plays one segment for `seconds` at 60 refreshes a second: the sound at `offset` s from the clock's start, its
 * element reporting the position in 10 ms steps (Chrome's are coarse) a refresh late or not. Returns each
 * refresh's clock time and rate.
 */
function playAgainst(offset: number, seconds: number, drift = 0) {
  clock = 1000; // (a page open a second: performance.now() is never 0)
  const seg: Seg = { file: 'a.wav', url: '/a.wav', at: 0, from: 0, dur: 600 };
  const p = new SoundtrackPlayer([seg], 600) as Steered;
  const el = (p as unknown as { els: PlayerAudio[] }).els[0]!;
  p.seek(10); p.play();
  const out: { t: number; rate: number }[] = [];
  let started = -1;
  for (let k = 1; k <= seconds * 60; k++) {
    const ts = 1000 + (k * 1000) / 60;
    clock = ts + 3; // (the callback runs a little after the refresh began)
    // the sound starts two refreshes after play(); then it runs at its own pace (1 + drift)
    if (k === 2) started = ts;
    if (started >= 0) el.currentTime = Math.floor((10 + offset + ((ts - started) / 1000) * (1 + drift)) * 100) / 100;
    p.sync(false, ts);
    out.push({ t: p.now(ts), rate: rateOf(p) });
  }
  return out;
}

test('a clock within 20 ms of the sound runs at its own pace, whatever the noise in the reported position', () => {
  for (const offset of [0, -0.012, 0.015]) {
    const run = playAgainst(offset, 20);
    const rates = new Set(run.slice(3).map((r) => r.rate));
    assert.deepEqual([...rates], [1], `offset ${offset * 1000} ms: the clock ran at ${[...rates].join(', ')}`);
  }
});

test('a clock 40 ms off is steered back at 0.5%, a frame at a time, and runs at its own pace once within 5 ms', () => {
  for (const offset of [0.04, -0.04]) {
    const run = playAgainst(offset, 20);
    // (the rates in turn)
    const rates = run.slice(3).map((r) => r.rate).filter((r, k, all) => k === 0 || r !== all[k - 1]);
    assert.deepEqual(rates, [1, 1 + Math.sign(offset) * 0.005, 1], `offset ${offset * 1000} ms: rates ${rates.join(', ')}`);
    const end = run.at(-1)!, heard = 10 + offset + (20 * 60 - 2) / 60;
    assert(Math.abs(heard - end.t) < 0.012, `offset ${offset * 1000} ms: ${((heard - end.t) * 1000).toFixed(1)} ms off after 20 s`);
    for (let k = 1; k < run.length; k++) assert(run[k]!.t >= run[k - 1]!.t, 'the clock stepped back');
  }
});

test('a sound running 0.1% fast is followed; one 0.2 s away is jumped to', () => {
  const run = playAgainst(0, 60, 0.001);
  const heard = 10 + (60 * 60 - 2) / 60 * 1.001;
  assert(Math.abs(heard - run.at(-1)!.t) < 0.025, `${((heard - run.at(-1)!.t) * 1000).toFixed(1)} ms off after a minute`);
  assert(run.filter((r, k) => k > 0 && r.rate !== run[k - 1]!.rate).length <= 8, 'the steering came and went more than a few times');
  const far = playAgainst(0.2, 1);
  assert(Math.abs(far.at(-1)!.t - (10.2 + 58 / 60)) < 0.02, `0.2 s off: at ${far.at(-1)!.t}`);
});

// ------------------------------------------------------------------ the frame the player shows
const { frameLock } = new Function(`${transpiler.transformSync(slice(mainTS, 'function frameLock(', '\n}\n'))}\nreturn { frameLock };`)() as
  { frameLock(fps: number): (t: number, ts: number, playing: boolean) => number };

/** A seeded random in [0, 1) (the same jitter every run). */
function rng(seed: number) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32); }

/**
 * A display at `hz` refreshing `n` times while playing (after a second paused), the clock's time at each refresh
 * clock(ts): the frames frameLock shows (time x fps), and, beside them, the frames rounding the clock gave.
 */
function show(fps: number, hz: number, n: number, clock: (ts: number, k: number) => number, gapAt: (k: number) => number = () => 1000 / hz) {
  const lock = frameLock(fps), shown: number[] = [], rounded: number[] = [], times: number[] = [];
  let ts = 0;
  for (let k = 0; k < hz; k++) { ts += 1000 / hz; lock(clock(0, 0), ts, false); }
  for (let k = 0; k < n; k++) {
    ts += gapAt(k);
    const t = clock(ts, k), at = lock(t, ts, true);
    times.push(at); shown.push(Math.round(at * fps)); rounded.push(Math.round(t * fps));
  }
  return { shown, rounded, times };
}
/** How many times each step (frames from one refresh to the next) happens. */
const steps = (ns: number[]) => {
  const h: Record<string, number> = {};
  for (let k = 1; k < ns.length; k++) h[ns[k]! - ns[k - 1]!] = (h[ns[k]! - ns[k - 1]!] ?? 0) + 1;
  return h;
};
/** How many refreshes each frame is held, start and end left out. */
const holds = (ns: number[]) => {
  const out: number[] = [];
  for (let k = 1, run = 1; k < ns.length; k++) {
    if (ns[k] === ns[k - 1]) run++;
    else { out.push(run); run = 1; }
  }
  return new Set(out.slice(1));
};

test('60 fps at 60 Hz: one frame a refresh, where rounding a jittery clock that sits on a boundary repeated and skipped', () => {
  // the clock read when the callback runs, up to 3 ms either side of the refresh (an engine before 0.13.2 reads
  // its own), with the frame boundary half way: as the measured preview did, 5-15% of its refreshes
  const r = rng(7), start = 100.5 / 60;
  const { shown, rounded } = show(60, 60, 1200, (ts) => start + (ts + (r() - 0.5) * 6) / 1000);
  assert.deepEqual(steps(shown), { 1: 1199 }, `frameLock stepped ${JSON.stringify(steps(shown))}`);
  const old = steps(rounded);
  assert((old[0] ?? 0) > 100 && (old[2] ?? 0) > 100, `rounding gave ${JSON.stringify(old)}`);
});

test('a 59.94 Hz display: the drift made up by single skips, the picture within ~0.75 frame of the clock', () => {
  const { shown, times } = show(60, 60000 / 1001, 3600, (ts) => 20 + ts / 1000);
  const h = steps(shown);
  assert(Object.keys(h).every((s) => s === '1' || s === '2') && (h[2] === 3 || h[2] === 4), `steps ${JSON.stringify(h)}`);
  for (let k = 1; k < times.length; k++) {
    const t = 20 + (k + 61) * 1001 / 60000;
    assert(Math.abs(times[k]! - t) <= 0.76 / 60, `refresh ${k}: shown ${times[k]} for ${t}`);
  }
});

test('a clock steered 0.5% slow: single repeats, never a skip', () => {
  const { shown } = show(60, 60, 1200, (ts) => 5 + (ts / 1000) * 0.995);
  const h = steps(shown);
  assert(!h[2] && (h[0] === 6 || h[0] === 5), `steps ${JSON.stringify(h)}`);
});

test('120 Hz, and a 30 fps video at 60 Hz: every frame held exactly two refreshes', () => {
  const r = rng(3);
  for (const [fps, hz] of [[60, 120], [30, 60]] as const) {
    const { shown } = show(fps, hz, 600, (ts) => 7.3 + (ts + (r() - 0.5) * 2) / 1000);
    assert.deepEqual([...holds(shown)], [2], `${fps} fps at ${hz} Hz held frames ${[...holds(shown)].join(', ')} refreshes`);
  }
});

test('144 Hz at 60 fps (no whole number of refreshes a frame): the frame the clock rounds to', () => {
  const { shown, rounded } = show(60, 144, 600, (ts) => 3 + ts / 1000);
  assert.deepEqual(shown, rounded);
  assert.deepEqual([...holds(shown)].sort(), [2, 3]);
});

test('a hold for the sound to start, a missed refresh, a seek: never before the moment played from, then one a refresh', () => {
  // paused at 10.004 s (between frames); play holds the clock 10 refreshes, then it runs (show() plays from
  // ts 1000 + 1000/60, so the 11th refresh is at 1000 + 11000/60)
  const t0 = 10.004, { times, shown } = show(60, 60, 300, (ts, k) => (k < 10 ? t0 : t0 + (ts - 1000 - 11000 / 60) / 1000 + 0.001),
    (k) => (k === 100 ? 2000 / 60 : 1000 / 60)); // (refresh 100 missed)
  assert(times.slice(0, 10).every((x) => x === t0), 'the held frames were not the moment played from');
  assert(times.every((x) => x >= t0), 'a frame before the moment played from was shown');
  const h = steps(shown.slice(10));
  assert(h[1] === 288 && h[2] === 1 && !h[0], `after the hold: ${JSON.stringify(h)}`);
  // a seek, playing: from where it lands, one a refresh
  const lock = frameLock(60);
  let ts = 0;
  for (let k = 0; k < 60; k++) lock(4, (ts += 1000 / 60), true);
  const jumped = lock(50.0123, (ts += 1000 / 60), true);
  assert(jumped >= 50.0123 && jumped <= 50.0123 + 0.5 / 60, `the first frame after a seek is ${jumped}, not the one at 50.0123`);
  const after = Array.from({ length: 60 }, (_, k) => Math.round(lock(50.0123 + (k + 1) / 60, (ts += 1000 / 60), true) * 60));
  assert.deepEqual(steps(after), { 1: 59 });
  assert.equal(lock(7.25, (ts += 1000 / 60), false), 7.25, 'paused, the time as it is');
});

let failed = 0;
for (const [name, run] of cases) {
  try { await run(); console.log(`ok   ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).stack ?? e}`); }
}
console.log(failed ? `\n${failed} of ${cases.length} failed` : `\nall ${cases.length} passed`);
process.exit(failed ? 1 : 0);
