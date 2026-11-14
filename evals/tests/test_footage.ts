#!/usr/bin/env bun
// Offline checks of streamed footage's pure parts: bun evals/tests/test_footage.ts
// Runs the template's actual shotFrame (which frame of a shot a video time shows), framesShown (which frames
// a prepare over a stretch loads), keptFrom and framesToDrop (which decoded frames the memory budget lets
// go, over many shots played one after another too), taken from src/engine/footage.ts, without a browser.
import path from 'node:path';

const file = path.resolve(import.meta.dir, '../../skills/code-video/assets/template-webgl/src/engine/footage.ts');
const source = await Bun.file(file).text();
function declaration(start: string) {
  const a = source.indexOf(start), b = source.indexOf('\n}\n', a);
  if (a < 0 || b < 0) throw new Error(`footage.ts helper not found: ${start}`);
  return source.slice(a, b + 2);
}
/** A one-line declaration (`export const x = ...;`). */
function line(start: string) {
  const a = source.indexOf(start), b = source.indexOf(';\n', a);
  if (a < 0 || b < 0) throw new Error(`footage.ts helper not found: ${start}`);
  return source.slice(a, b + 2);
}
const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(
  [...['export function shotFrame(', 'export function framesShown(', 'export function keptFrom(', 'export function framesToDrop<K>(', 'export function nextJob<J extends Job>(']
    .map(declaration), line('export const stale = ')].join('\n').replace(/^export /gm, ''));
type Shot = { start: number; fps: number; rate: number; offset: number; frames: number };
/** (`used`: the latest round its Footage was asked for or drawn in; 0 when left out) */
type Held = { key: string; asked: number; shown: boolean; used?: number };
type Job = { asked: number; seq: number; urgent: boolean; ahead: boolean };
const { shotFrame, framesShown, keptFrom, framesToDrop, nextJob, stale } = new Function(`${compiled}\nreturn { shotFrame, framesShown, keptFrom, framesToDrop, nextJob, stale };`)() as {
  shotFrame(t: number, videoFps: number, o: Shot): number;
  framesShown(t0: number, t1: number, videoFps: number, o: Shot, max: number): number[];
  keptFrom(round: number, protect: number, waited: number[], pending: Iterable<number>): number;
  framesToDrop<K>(held: { key: K; asked: number; shown: boolean; used: number }[], cap: number, from: number): K[];
  nextJob<J extends Job>(jobs: Iterable<J>): J | null;
  stale(j: Job, from: number): boolean;
};
/** framesToDrop with keptFrom's answer: the latest round `round`, the latest 4 kept (PROTECT). */
const drop = (held: Held[], cap: number, round: number, waited: number[] = [], pending: number[] = []) =>
  framesToDrop(held.map((h) => ({ ...h, used: h.used ?? 0 })), cap, keptFrom(round, 4, waited, pending));

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const cases: [string, () => void | Promise<void>][] = [];
const test = (name: string, run: () => void | Promise<void>) => cases.push([name, run]);

/**
 * The whole of footage.ts, with three, the video's settings, fetch and the image decoder stubbed: the real Footage
 * class and its budget, for what only they decide together (which frames stay when one arrives). A frame's
 * "bitmap" is its URL.
 */
function realFootage(o: { rendering?: boolean; manual?: boolean; missing?: Set<number> } = {}) {
  const ts = source
    .replace("import * as THREE from 'three';", "const THREE = { Texture: class { image: unknown = null; needsUpdate = false; version = 0; colorSpace = ''; minFilter = 0; magFilter = 0; generateMipmaps = true; flipY = true; dispose() {} }, SRGBColorSpace: 'srgb', NearestFilter: 1, LinearFilter: 2 };")
    .replace("import { VIDEO } from '../video';", 'const VIDEO = { fps: 60 };')
    .replace('import.meta.env.BASE_URL', "'/'");
  check(!/^import /m.test(ts), 'footage.ts has an import this test does not stub');
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(ts).replace(/^export /gm, '');
  /** Every fetch started, in order; `manual`: each waits until the test answers it (answer()). */
  const fetched: string[] = [], waiting: { url: string; answer(): void }[] = [];
  const fetchStub = (url: string) => {
    fetched.push(url);
    const gone = o.missing?.has(frameOf(url));
    const r = { ok: !gone, status: gone ? 404 : 200, blob: async () => url };
    if (!o.manual) return Promise.resolve(r);
    return new Promise((resolve) => waiting.push({ url, answer: () => resolve(r) }));
  };
  const decode = async (blob: string) => ({ url: blob, close() {} });
  // (render.ts's page has ?export=1)
  const location = o.rendering ? { search: '?export=1' } : undefined;
  const mod = new Function('fetch', 'createImageBitmap', 'location', `${js}\nreturn { Footage, footageRound, BUDGET, FETCHES, footageStats };`)(fetchStub, decode, location);
  return { ...mod, fetched, waiting } as {
    Footage: new (o: { base: string; frames: number; fps?: number; full: boolean }) => {
      prepare(t0: number, t1: number): Promise<void>; frame(t: number): { image: unknown }; frameAt(i: number): { image: unknown }; index(t: number): number;
      has(i: number): boolean; held(): unknown[]; dispose(): void; askedIn(i: number): number;
    };
    footageRound(ask: () => void, waited?: boolean): () => void;
    BUDGET: { full: number; proxy: number };
    FETCHES: number;
    footageStats: { draws: number; standIns: number; blank: number };
    fetched: string[];
    waiting: { url: string; answer(): void }[];
  };
}
/** The frame number in a stub frame's URL (…/000123.jpg is frame 122). */
const frameOf = (url: string) => Number(/(\d{6})\.jpg$/.exec(url)![1]) - 1;
const settle = () => new Promise((r) => setTimeout(r, 20));
const shot = (o: Partial<Shot> = {}): Shot => ({ start: 0, fps: 60, rate: 1, offset: 0, frames: 100000, ...o });
/** The frame shown at video frame n of a video at `fps`, and at every sub-frame of it (offsets -0.5..0.5 at shutter 1). */
function framesAt(n: number, fps: number, o: Shot) {
  return [-0.49, -0.375, -0.1, 0, 0.1, 0.375, 0.49].map((u) => shotFrame((n + u) / fps, fps, o));
}

test('rate 1 at the video rate shows frame n at video frame n, for every sub-frame', () => {
  for (let n = 0; n < 20000; n++) {
    const got = framesAt(n, 60, shot());
    check(got.every((i) => i === n), `video frame ${n} showed ${got.join(',')}`);
  }
});
test('half rate shows each frame twice, from the first', () => {
  const got = Array.from({ length: 8 }, (_, n) => shotFrame(n / 60, 60, shot({ rate: 0.5 })));
  check(got.join(',') === '0,0,1,1,2,2,3,3', `got ${got.join(',')}`);
});
test('a shot at twice the video rate skips every other frame', () => {
  const got = Array.from({ length: 5 }, (_, n) => shotFrame(n / 30, 30, shot()));
  check(got.join(',') === '0,2,4,6,8', `got ${got.join(',')}`);
});
test('29.97 fps footage in a 29.97 fps video stays frame for frame', () => {
  const r = 30000 / 1001;
  for (let n = 0; n < 20000; n++) {
    const got = framesAt(n, r, shot({ fps: r }));
    check(got.every((i) => i === n), `video frame ${n} showed ${got.join(',')}`);
  }
});
test('an entry starting between frames shows frame 0 on its first frame', () => {
  const start = 75.5 / 60, o = shot({ start });
  check(shotFrame(76 / 60, 60, o) === 0 && shotFrame(77 / 60, 60, o) === 1, 'the first frame after the start is not frame 0');
  for (let n = 76; n < 2000; n++) {
    const got = framesAt(n, 60, o);
    check(got.every((i) => i === got[0]), `sub-frames of video frame ${n} showed ${got.join(',')}`);
  }
});
test('offset and start place the shot, held at both ends', () => {
  const o = shot({ start: 4, offset: 200, rate: 0.5, frames: 300 });
  check(shotFrame(4, 60, o) === 200, 'start does not show the offset frame');
  check(shotFrame(6, 60, o) === 260, '2 s at half rate is not 60 frames on');
  check(shotFrame(-100, 60, o) === 0, 'long before the start is not held at frame 0');
  check(shotFrame(1000, 60, o) === 299, 'past the end is not held at the last frame');
});
test('a frozen shot holds its offset frame', () => {
  const o = shot({ rate: 0, offset: 42 });
  check([0, 1.5, 99].every((t) => shotFrame(t, 60, o) === 42), 'rate 0 moved');
});
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
test('a prepare at rate 1 loads every frame of its stretch', () => {
  const got = framesShown(1, 1.5, 60, shot(), 72);
  check(got.join(',') === range(60, 90).join(','), `got ${got.join(',')}`);
});
test('at rates 4 and 8 a prepare loads only the frames shown, one per video frame', () => {
  for (const rate of [4, 8]) {
    const got = framesShown(0.5, 1.5, 60, shot({ rate }), 72);
    check(got.join(',') === range(30, 90).map((n) => n * rate).join(','), `rate ${rate}: got ${got.length} frames, ${got.slice(0, 4).join(',')}...`);
    // stream()'s look-ahead, 31 video frames: 31 shot frames, within one call's 72
    check(framesShown(2, 2.5, 60, shot({ rate }), 72).length === 31, `rate ${rate}: the look-ahead isn't 31 frames`);
  }
});
test("60 consecutive stills fetch the same 62 frames at rates 1, 4 and 8 (the review's count was 62, 245, 488)", () => {
  for (const rate of [1, 4, 8]) {
    const o = shot({ rate, frames: 720 }), all = new Set<number>();
    // each still(t) prepares t - dt to t + dt (main.ts)
    for (let n = 30; n < 90; n++) for (const i of framesShown((n - 1) / 60, (n + 1) / 60, 60, o, 72)) all.add(i);
    check(all.size === 62, `rate ${rate}: ${all.size} frames`);
  }
});
test('at a very high rate the frame shown is among those loaded', () => {
  const o = shot({ rate: 80 });
  for (const n of [1, 7, 33]) check(framesShown((n - 1) / 60, (n + 1) / 60, 60, o, 72).includes(shotFrame(n / 60, 60, o)), `video frame ${n}`);
});
test('half rate loads each frame once; a frozen shot and the held end, one frame', () => {
  check(framesShown(0, 1, 60, shot({ rate: 0.5 }), 72).join(',') === range(0, 30).join(','), 'half rate');
  check(framesShown(0, 5, 60, shot({ rate: 0, offset: 42 }), 72).join(',') === '42', 'rate 0');
  check(framesShown(100, 101, 60, shot({ frames: 300 }), 72).join(',') === '299', 'past the end');
});
test('a stretch given backwards loads the same frames, and at most `max`, from the earliest', () => {
  check(framesShown(2, 1, 60, shot(), 72).join(',') === framesShown(1, 2, 60, shot(), 72).join(','), 'backwards differs');
  check(framesShown(1, 2, 60, shot(), 10).join(',') === range(60, 69).join(','), 'max');
});
test('within the budget, nothing is dropped', () => {
  const held = Array.from({ length: 10 }, (_, i) => ({ key: `f${i}`, asked: i, shown: false }));
  check(drop(held, 10, 100).length === 0, 'dropped frames under the cap');
});
test('over the budget, the least recently asked go first', () => {
  const held = [5, 1, 9, 3, 7].map((asked) => ({ key: `r${asked}`, asked, shown: false }));
  const got = drop(held, 3, 100);
  check(got.join(',') === 'r1,r3', `dropped ${got.join(',')}`);
});
test('the latest rounds are never dropped, even over the budget', () => {
  // rounds 97-100 are the latest 4: of these, only the two from older rounds can go
  const held = [100, 99, 98, 97, 96, 95].map((asked) => ({ key: `r${asked}`, asked, shown: false }));
  const got = drop(held, 1, 100);
  check(got.join(',') === 'r95,r96', `dropped ${got.join(',')}`);
});
test('the frame on screen stays while its shot is in use (asked for or drawn in the latest rounds)', () => {
  const held = [{ key: 'shown', asked: 1, shown: true, used: 98 }, { key: 'a', asked: 2, shown: false }, { key: 'b', asked: 3, shown: false }];
  const got = drop(held, 2, 100);
  check(got.join(',') === 'a', `dropped ${got.join(',')}`);
});
test('a shot that has played lets the frame on its texture go like any other', () => {
  // drawn last in round 50, the latest 4 being 97-100: least recently asked, so first
  const held = [{ key: 'shown', asked: 1, shown: true, used: 50 }, { key: 'a', asked: 2, shown: false }, { key: 'b', asked: 3, shown: false }];
  const got = drop(held, 2, 100);
  check(got.join(',') === 'shown', `dropped ${got.join(',')}`);
});
test('frames never asked for (loaded to stand in) go before any asked one', () => {
  const held = [{ key: 'asked', asked: 50, shown: false }, { key: 'stand-in', asked: 0, shown: false }];
  const got = drop(held, 1, 100);
  check(got.join(',') === 'stand-in', `dropped ${got.join(',')}`);
});
/**
 * The review's case: a frame's waited prepare began as round 10, and its scene awaited each of eleven clips
 * before asking for the next, so clip k's three frames were asked in round 10 + k; 40 frames from rounds 1-9
 * are held too, over a budget of 30.
 */
const awaited = () => [
  ...range(0, 39).map((i) => ({ key: `old${i}`, asked: 1 + (i % 9), shown: false })),
  ...range(0, 32).map((i) => ({ key: `clip${Math.floor(i / 3)}`, asked: 10 + Math.floor(i / 3), shown: false })),
];
test('a waited prepare not settled yet keeps every frame asked since it began, however many rounds came after', () => {
  const got = drop(awaited(), 30, 20, [10], [10]);
  check(got.length === 40 && got.every((k) => k.startsWith('old')), `dropped ${got.filter((k) => !k.startsWith('old')).join(',') || got.length + ' old'}`);
  // (by the latest 4 rounds alone, the first clips' frames went: "frame 1 wasn't prepared")
  check(drop(awaited(), 30, 20).some((k) => k.startsWith('clip')), 'the latest rounds alone kept them');
});
test('a settled waited prepare stays kept while one of the latest 4 waited (verify: two moments, then both rendered)', () => {
  // the first moment prepared as round 10, the second as round 11, its clips asked in rounds 11 to 21
  const held = [{ key: 'old', asked: 3, shown: false }, { key: 'first', asked: 10, shown: false }, ...range(11, 21).map((r) => ({ key: `second${r}`, asked: r, shown: false }))];
  const got = drop(held, 1, 21, [10, 11]);
  check(got.join(',') === 'old', `dropped ${got.join(',')}`);
});
test('four waited prepares later, its frames can go', () => {
  check(keptFrom(60, 4, [10, 30, 40, 50, 60], []) === 30, `kept from ${keptFrom(60, 4, [10, 30, 40, 50, 60], [])}`);
  check(keptFrom(60, 4, [30, 40, 50, 60], [10]) === 10, 'a waited prepare still running was let go');
});

/**
 * Footage's bookkeeping in miniature: `shots` shots of `len` frames each, one after another as render.ts
 * plays them, every video frame a waited prepare round asking for the frames of its window (the frame before
 * to the frame after) of each shot in it, then drawn, strictly (a frame not loaded fails); every load followed
 * by framesToDrop over every shot, as evict() does, a dropped frame on a texture taking the texture's picture
 * with it. Then a still back in the first shot, which has to load its frames again. `pinned`: the rule
 * before, the frame on a texture kept whatever its shot.
 */
function playShots(shots: number, len: number, cap: number, pinned = false) {
  type Shot = { cache: Set<number>; asked: Map<number, number>; shown: number; used: number };
  const S: Shot[] = Array.from({ length: shots }, () => ({ cache: new Set(), asked: new Map(), shown: -1, used: 0 }));
  const waited: number[] = [], pending: number[] = [];
  let round = 0, most = 0;
  const heldNow = () => S.reduce((n, s) => n + s.cache.size, 0);
  const evict = () => {
    const held = S.flatMap((s, k) => [...s.cache].map((i) => ({ key: `${k}:${i}`, asked: s.asked.get(i) ?? 0, shown: i === s.shown, used: pinned ? Infinity : s.used })));
    for (const key of framesToDrop(held, cap, keptFrom(round, 4, waited, pending))) {
      const [k, i] = key.split(':').map(Number) as [number, number], s = S[k]!;
      s.cache.delete(i);
      s.asked.delete(i);
      if (s.shown === i) s.shown = -1;
    }
    most = Math.max(most, heldNow());
  };
  const at = (n: number) => ({ s: S[Math.floor(n / len)]!, i: n % len });
  const still = (n: number) => {
    round++;
    waited.push(round);
    if (waited.length > 4) waited.shift();
    pending.push(round);
    const want: { s: Shot; i: number }[] = [];
    for (let m = Math.max(0, n - 1); m <= Math.min(shots * len - 1, n + 1); m++) {
      const w = at(m);
      w.s.used = round;
      w.s.asked.set(w.i, round);
      want.push(w);
    }
    for (const { s, i } of want) if (!s.cache.has(i)) { s.cache.add(i); evict(); }
    pending.length = 0;
    const { s, i } = at(n);
    if (!s.cache.has(i)) throw new Error(`video frame ${n}: frame ${i} of shot ${Math.floor(n / len)} wasn't loaded`);
    s.used = round;
    s.shown = i;
  };
  for (let n = 0; n < shots * len; n++) still(n);
  const end = heldNow(), pictures = S.filter((s) => s.shown >= 0).length, firstKept = S[0]!.cache.size;
  still(0);
  return { most, end, pictures, firstKept, firstAgain: S[0]!.shown === 0 };
}
test('150 shots played one after another stay within the budget, and a still back in the first loads it again', () => {
  const r = playShots(150, 10, 72);
  check(r.most <= 72 && r.end <= 72, `held up to ${r.most} decoded frames, ${r.end} at the end (budget 72)`);
  // (only the latest shots' textures, those whose frames the budget still holds: 72 frames, 10 a shot)
  check(r.pictures <= 8, `${r.pictures} textures still hold a picture`);
  check(r.firstKept === 0, `the first shot kept ${r.firstKept} frames`);
  check(r.firstAgain, 'the still back in the first shot did not show its frame');
  // (the rule before kept the frame on every texture: one a shot, past the budget)
  const before = playShots(150, 10, 72, true);
  check(before.end >= 150 + 2 && before.pictures === 150, `the rule before held ${before.end}, ${before.pictures} pictures`);
});

test('a frame the preview loads on demand stays: a step back after four seeks shows it', async () => {
  const { Footage, footageRound, BUDGET, fetched } = realFootage();
  const clip = new Footage({ base: '/footage/s', frames: 100000, fps: 60, full: false });
  // the preview's look-ahead after four seeks (main.ts: prepare(t, t + 2, true)), a round each: 121 proxies
  // apiece, all four protected, past the budget of 360 together
  for (const t of [10, 20, 30, 40]) {
    let p: Promise<void> = Promise.resolve();
    footageRound(() => { p = clip.prepare(t, t + 2); });
    await p;
  }
  check(clip.held().length > BUDGET.proxy, `the four look-aheads held ${clip.held().length} proxies, within ${BUDGET.proxy}`);
  // a step back of 0.4 s, under the 0.5 s that starts another look-ahead: only frame() asks for it
  const i = clip.index(39.6), url = `/footage/s/proxy/${String(i + 1).padStart(6, '0')}.jpg`;
  check(!clip.has(i), `frame ${i} was loaded already`);
  clip.frame(39.6); // (the nearest loaded frame stands in while it loads)
  await settle();
  check(clip.has(i), `frame ${i} was let go as soon as it arrived`);
  check((clip.frame(39.6).image as { url: string }).url === url, 'the texture does not show it');
  await settle();
  check(fetched.filter((u) => u === url).length === 1, `frame ${i} was fetched ${fetched.filter((u) => u === url).length} times`);
});

test('the fetch queue: a frame a draw waits for first (the latest first), then the latest round in its order, then older rounds', () => {
  const jobs = [
    { key: 'old-a', asked: 3, seq: 1, urgent: false, ahead: true },
    { key: 'old-b', asked: 3, seq: 2, urgent: false, ahead: true },
    { key: 'draw-1', asked: 4, seq: 5, urgent: true, ahead: false },
    { key: 'new-a', asked: 5, seq: 10, urgent: false, ahead: true },
    { key: 'new-b', asked: 5, seq: 11, urgent: false, ahead: false },
    { key: 'draw-2', asked: 5, seq: 12, urgent: true, ahead: false },
  ];
  const left = new Set(jobs), order: string[] = [];
  while (left.size) { const j = nextJob(left)!; order.push(j.key); left.delete(j); }
  check(order.join(',') === 'draw-2,draw-1,new-a,new-b,old-a,old-b', `fetched ${order.join(',')}`);
  check(nextJob([]) === null, 'an empty queue gave a job');
});
test('a waiting frame is stale only when look-aheads alone asked for it, before the rounds the budget keeps', () => {
  const j = (o: Partial<Job>): Job => ({ asked: 3, seq: 1, urgent: false, ahead: true, ...o });
  check(stale(j({}), 4), 'an old look-ahead frame was kept');
  check(!stale(j({ asked: 4 }), 4), 'a kept round was dropped');
  check(!stale(j({ ahead: false }), 4), 'a frame a prepare that is waited for (or no round) asked was dropped');
  check(!stale(j({ urgent: true }), 4), 'a frame a draw waits for was dropped');
});

/** Answers every fetch under way, and those it starts, until none is left. */
async function drain(w: { waiting: { answer(): void }[] }) {
  for (let k = 0; k < 1000 && w.waiting.length; k++) {
    for (const x of w.waiting.splice(0)) x.answer();
    await new Promise((r) => setTimeout(r, 0));
  }
}

test('six frames are fetched at once; after a seek the frames there go before the rest of the look-ahead before it', async () => {
  const w = realFootage({ manual: true });
  const clip = new w.Footage({ base: '/footage/s', frames: 100000, fps: 60, full: false });
  let first: Promise<void> = Promise.resolve();
  w.footageRound(() => { first = clip.prepare(10, 12); }); // (the look-ahead at 10 s: 121 frames from 600)
  check(w.FETCHES === 6 && w.fetched.length === 6, `${w.fetched.length} fetches at once`);
  check(w.fetched.map(frameOf).join(',') === range(600, 605).join(','), `the first fetches were ${w.fetched.map(frameOf).join(',')}`);
  w.footageRound(() => { void clip.prepare(50, 52); }); // (a seek to 50 s)
  for (const x of w.waiting.splice(0)) x.answer();
  await settle();
  check(w.waiting.length === 6, `${w.waiting.length} fetches at once`);
  check(w.fetched.slice(6).map(frameOf).join(',') === range(3000, 3005).join(','), `after the seek: ${w.fetched.slice(6).map(frameOf).join(',')}`);
  await drain(w);
  await first;
  check(w.fetched.length === 242, `${w.fetched.length} fetched (two look-aheads of 121)`);
});

test('in the preview, a look-ahead four rounds old leaves its waiting frames unfetched; render.ts fetches every one', async () => {
  for (const rendering of [false, true]) {
    const w = realFootage({ manual: true, rendering });
    const clip = new w.Footage({ base: '/footage/s', frames: 100000, fps: 60, full: false });
    const asked: Promise<void>[] = [];
    // a scrub: five look-aheads, one after another, the first one's frames still waiting; one of those frames is
    // asked for by a prepare outside the look-aheads too (a scene's init), so it is fetched whatever happens
    w.footageRound(() => { asked.push(clip.prepare(10, 12)); });
    asked.push(clip.prepare(11, 11));
    for (const t of [20, 30, 40, 50]) w.footageRound(() => { asked.push(clip.prepare(t, t + 2)); });
    await drain(w);
    await Promise.all(asked); // (none of them hangs)
    const firstOnes = w.fetched.map(frameOf).filter((i) => i >= 600 && i <= 720);
    if (rendering) check(firstOnes.length === 121 && w.fetched.length === 605, `render.ts fetched ${w.fetched.length}, ${firstOnes.length} of the first look-ahead`);
    else {
      // (the six under way when the others came, and frame 660, the other prepare's)
      check(firstOnes.join(',') === [...range(600, 605), 660].join(','), `the preview fetched ${firstOnes.length} of the first look-ahead: ${firstOnes.join(',')}`);
      check(w.fetched.length === 6 + 1 + 4 * 121, `the preview fetched ${w.fetched.length}`);
    }
  }
});

test('a frame not decoded yet: the latest one before it stands in, one after it only when none is before', async () => {
  const w = realFootage();
  const clip = new w.Footage({ base: '/footage/s', frames: 100000, fps: 60, full: false });
  const shows = (i: number) => frameOf((clip.frameAt(i).image as { url: string }).url);
  check(clip.frameAt(5).image === null && w.footageStats.blank === 1, 'with nothing loaded, the texture did not stay empty');
  await settle(); // (frame 5, asked for by that draw, arrives)
  await clip.prepare(1, 1); // (frame 60)
  await clip.prepare(2, 2); // (frame 120)
  const at100 = shows(100), at30 = shows(30), at3 = shows(3);
  check(at100 === 60, `frame 100 showed ${at100}, not 60, the latest before it`); // (the nearest is 120)
  check(at30 === 5, `frame 30 showed ${at30}, not 5`);
  check(at3 === 5, `frame 3 showed ${at3}: with none before it, the first after it stands in`);
  const s = w.footageStats;
  check(s.draws === 4 && s.standIns === 3 && s.blank === 1, `counted ${JSON.stringify(s)}`);
  await settle();
  check(shows(100) === 100 && shows(30) === 30 && shows(3) === 3, 'the frames asked for did not arrive');
  check(s.draws === 7 && s.standIns === 3, `counted ${JSON.stringify(s)} once they arrived`);
  clip.dispose();
});

test('a frame that fails to load fails its prepare with the reason, and frees its turn for the rest', async () => {
  for (const rendering of [false, true]) {
    const w = realFootage({ manual: true, rendering, missing: new Set([603]) });
    const clip = new w.Footage({ base: '/footage/s', frames: 100000, fps: 60, full: true });
    let failure: unknown = null;
    const p = clip.prepare(10, 10.5).catch((e) => { failure = e; });
    await drain(w);
    await p;
    check(/footage \/footage\/s\/full\/000604\.jpg: HTTP 404/.test(String((failure as Error)?.message)), `the prepare gave ${String(failure)}`);
    check(range(600, 630).every((i) => i === 603 || clip.has(i)), 'the other frames did not load');
    // (every turn free again: six of the next prepare's frames start at once)
    void clip.prepare(20, 21);
    check(w.waiting.length === 6, `${w.waiting.length} fetches started after the failure`);
    await drain(w);
    check(range(1200, 1260).every((i) => clip.has(i)), 'a prepare after the failure did not load');
  }
});

test('a disposed Footage lets its waiting frames go; another Footage fetches on', async () => {
  const w = realFootage({ manual: true });
  const a = new w.Footage({ base: '/footage/a', frames: 100000, fps: 60, full: false });
  const b = new w.Footage({ base: '/footage/b', frames: 100000, fps: 60, full: false });
  const p = a.prepare(10, 12); // (121 frames: six under way, the rest waiting)
  a.dispose(); // (a hot-swapped scene)
  void b.prepare(10, 10.2);
  await drain(w);
  await p; // (settles: nobody waits for a disposed shot forever)
  const fromA = w.fetched.filter((u) => u.startsWith('/footage/a/')).length, fromB = w.fetched.filter((u) => u.startsWith('/footage/b/')).length;
  check(fromA === 6 && fromB === 13, `fetched ${fromA} of the disposed one's frames, ${fromB} of the other's`);
  check(!a.has(600) && b.has(612), 'the disposed one kept a frame, or the other did not load');
});

test('a frame let go unfetched is fetched when asked again; its mark goes with it', async () => {
  const w = realFootage({ manual: true });
  const clip = new w.Footage({ base: '/footage/s', frames: 100000, fps: 60, full: false });
  for (const t of [10, 20, 30, 40, 50]) w.footageRound(() => { void clip.prepare(t, t + 2); });
  await drain(w);
  check(!clip.has(650) && clip.askedIn(650) === 0, `frame 650: ${clip.has(650) ? 'fetched' : 'not fetched'}, marked in round ${clip.askedIn(650)}`);
  // (only decoded frames keep a mark: a scrub's let-go frames left thousands)
  const marks = (clip as unknown as { asked: Map<number, number> }).asked.size;
  check(marks === clip.held().length, `${marks} marks for ${clip.held().length} decoded frames`);
  let again: Promise<void> = Promise.resolve();
  w.footageRound(() => { again = clip.prepare(10, 12); });
  await drain(w);
  await again;
  check(range(600, 720).every((i) => clip.has(i)), 'the frames let go were not fetched when asked again');
});

let passed = 0;
for (const [name, run] of cases) {
  try { await run(); passed++; console.log('PASS ' + name); }
  catch (e) { console.log('FAIL ' + name + ': ' + (e as Error).message); }
}
console.log(`${passed}/${cases.length} checks passed`);
process.exitCode = passed === cases.length ? 0 : 1;
