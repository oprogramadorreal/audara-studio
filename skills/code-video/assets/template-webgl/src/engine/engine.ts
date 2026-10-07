// The engine: owns the renderer, loads scenes for the timeline, renders any video time
// deterministically (with preroll for stateful scenes), composites transitions, HUD, post.
import * as THREE from 'three';
import { AudioData } from './audio';
import { Words } from './words';
import { Compositor, FSPass, W, H, PW, PH, SCALE, SS_TAP, makeRT, clearRT } from './gl';
import { DEFAULT_POST, Post, SHOULDER_GLSL, type PostParams } from './post';
import { Hud } from './hud';
import type { Frame, Scene, SceneClass, SceneCtx, PostOverrides } from './scene';
import { loadFonts } from './type';
import { loadStrokeFonts } from './stroke';
import { loadSegments, resolveDuration, type DurationSource, type Segment } from './soundtrack';
import { testCardNote } from './palette';
import { DATA_URLS, VIDEO, type MakeTimeline } from '../video';

export interface TimelineEntry {
  id: string;
  /** Lazy module loader; the module's default export is the Scene class. */
  load: () => Promise<{ default: SceneClass }>;
  start: number;
  end: number;
  /** Default post overrides for this entry (the scene's own overrides win). */
  post?: PostOverrides;
  /** Free-form params handed to the scene as ctx.params. */
  params?: Record<string, any>;
  /** Cap on adaptive motion-blur sub-frames while this entry is on screen (for noise that converges slowly). */
  maxSamples?: number;
  /**
   * Opt-in variations handed to every Frame of this entry as `f.remix` (another camera, a part hidden...):
   * lets a video re-render a scene, its own or another video's, without copying it.
   */
  remix?: Record<string, any>;
  /**
   * The scene module's path in the project ('videos/<video>/scenes/<name>.ts'; the timelines' E() helper
   * sets it), or just its name ('<name>', in this video's scenes/): saving that file, or a helper it
   * imports, hot-swaps this entry in the preview. Without it, the id is taken as the name.
   */
  file?: string;
}

/** A loaded timeline entry: its scene, or the error that keeps it from rendering. */
interface Loaded { entry: TimelineEntry; scene: Scene | null; error?: string; lastT: number }

/**
 * Per-frame adaptive motion-blur sampling (see Engine.render): the sub-frame count steps through
 * 4, 12, 36, 108, 324 … from `min` up to at most `max` (both rounded to that series) until the frame's
 * estimated remaining sampling error is below `tol` 8-bit levels everywhere (worst 2x2-logical-px block).
 */
export interface AdaptiveSampling { min: number; max: number; tol: number }

/**
 * Shutter offsets (-0.5..0.5) of an adaptive run's sub-frames in rendering order: 4 evenly spread, then
 * each step splits every interval in three, adding a sub-frame either side of each old one. Every
 * prefix of 4·3^l is then evenly spread and centred on the frame's time, and so is each step's new set:
 * comparing the new set's average with the old one's measures sampling error, not a shift in time
 * (with doublings the new half sits half a step later, and any motion at all would read as error).
 */
function ternaryOffsets(steps: number) {
  const u = [0, 1, 2, 3].map((i) => (i + 0.5) / 4 - 0.5);
  for (let l = 0, n = 4; l < steps; l++, n *= 3)
    for (let m = 0; m < n; m++) u.push((3 * m + 0.5) / (3 * n) - 0.5, (3 * m + 2.5) / (3 * n) - 0.5);
  return u;
}

/** The time step from a to b: exactly `step` when that is what it is (so a re-simulation matches playback bit for bit). */
const stepBetween = (a: number, b: number, step: number) => (Math.abs(b - a - step) < 1e-9 ? step : b - a);

export class Engine {
  renderer: THREE.WebGLRenderer;
  ctx!: SceneCtx;
  audio!: AudioData;
  words!: Words;
  /** The soundtrack's segments (null: silent), with every length known. */
  soundtrack: Segment[] | null = null;
  hud!: Hud;
  post!: Post;
  comp = new Compositor();
  loaded = new Map<string, Loaded>();
  private rts = [makeRT(), makeRT(), makeRT()];
  // crossfade targets, used in turn: with three entries on screen the second crossfade reads the first
  // one's result, and a pass can't sample the target it draws into (the second one is made when needed)
  private mixRTs: THREE.WebGLRenderTarget[] = [makeRT(W, H, { depthBuffer: false })];
  // motion-blur sub-frame sums (float: up to hundreds of sub-frames), their average, and the error estimate
  private sumRT = makeRT(W, H, { depthBuffer: false, type: THREE.FloatType });
  private newRT = makeRT(W, H, { depthBuffer: false, type: THREE.FloatType });
  private avgRT = makeRT(W, H, { depthBuffer: false });
  private errRT: THREE.WebGLRenderTarget;
  private maxRT: THREE.WebGLRenderTarget;
  private errPass: FSPass;
  private maxPass: FSPass;
  private errBuf: Float32Array;
  /** Sub-frames used for the last rendered frame, and its estimated sampling error after each step. */
  lastSamples = 1;
  lastErrors: number[] = [];
  private finalRT = new THREE.WebGLRenderTarget(PW, PH, { type: THREE.UnsignedByteType, depthBuffer: false });
  private blit: FSPass;
  private xfade: FSPass;
  private accum: FSPass;
  private lastT = -1;
  lastPost: PostParams = { ...DEFAULT_POST };
  /** Problems found at boot that are not a scene's (an unreadable audio file); they stay until a reload. */
  bootErrors: string[] = [];
  /** Notes about fallbacks in use (no analysis, no words): worth knowing, not errors. */
  warnings: string[] = [];
  /** Bumped whenever the current errors change (the preview redraws its error list then). */
  errorsVersion = 0;
  /**
   * Hard cuts: the times where the picture goes from one set of entries to another with none in common
   * (a scene ends as the next one starts, or a scene starts or ends against black). Motion blur keeps every
   * sub-frame on its frame's side of them (render()); overlaps crossfade, which is continuous.
   */
  cuts: number[] = [];
  /** The entries composited by the last render() (any sub-frame): verify checks that none leaks across a cut. */
  lastEntries = new Set<string>();
  /** Render no scene at all: the engine's own cost (post, HUD), the baseline `render.ts perf` prints. */
  bare = false;
  private px1 = new Uint8Array(4);

  timeline: TimelineEntry[] = [];
  /** Rendering for scripts/render.ts rather than the live preview: scenes read it as ctx.export (see SceneCtx). */
  readonly exporting: boolean;

  constructor(public canvas: HTMLCanvasElement, private makeTimeline: MakeTimeline, opts: { export?: boolean } = {}) {
    this.exporting = opts.export ?? false;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(PW, PH, false);
    this.renderer.autoClear = false;
    this.blit = new FSPass(`uniform sampler2D src; void main(){ fragColor = texture(src, vUv); }`, { src: { value: null } });
    this.xfade = new FSPass(`uniform sampler2D a; uniform sampler2D b; uniform float k;
      void main(){ fragColor = mix(texture(a, vUv), texture(b, vUv), k); }`, { a: { value: null }, b: { value: null }, k: { value: 0 } });
    // adds a sub-frame to a sum; a non-finite pixel (a stray NaN from some shader in one sub-frame out of
    // hundreds) is dropped, or it would poison the average and bloom into a disc
    this.accum = new FSPass(`uniform sampler2D src;
      void main() {
        vec4 c = texture(src, vUv);
        bool ok = abs(c.r) <= 6e4 && abs(c.g) <= 6e4 && abs(c.b) <= 6e4 && abs(c.a) <= 6e4;
        fragColor = ok ? c : vec4(0.0);
      }`, { src: { value: null } }, { blending: THREE.CustomBlending, transparent: true });
    const am = this.accum.mat;
    am.blendEquation = THREE.AddEquation;
    am.blendSrc = THREE.OneFactor; am.blendDst = THREE.OneFactor;
    am.blendSrcAlpha = THREE.ZeroFactor; am.blendDstAlpha = THREE.OneFactor;
    // sampling error: per block of B x B physical px (2x2 logical), how far the displayed average moves when a
    // step's new sub-frames (2n, summed in b) are merged with the n before them (summed in a): 2/3 of the gap,
    // through as much of the tone shoulder as the frame's post applies (it flattens the highlights' gaps)
    const B = 2 * SCALE, ew = Math.ceil(PW / B), eh = Math.ceil(PH / B), R = 16;
    const small = { depthBuffer: false, type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, pxScale: 1 } as const;
    this.errRT = makeRT(ew, eh, small);
    this.maxRT = makeRT(Math.ceil(ew / R), Math.ceil(eh / R), small);
    this.errBuf = new Float32Array(this.maxRT.width * this.maxRT.height * 4);
    this.errPass = new FSPass(/* glsl */ `
      uniform sampler2D a; uniform sampler2D b; uniform float invA, invB, shoulderAmt;
      ${SHOULDER_GLSL}
      vec3 disp(vec3 x) { x = max(x, 0.0); return toSRGB(sat(mix(x, shoulder(x), shoulderAmt))); }
      void main() {
        ivec2 p0 = ivec2(gl_FragCoord.xy) * ${B}, lim = ivec2(${PW - 1}, ${PH - 1});
        vec3 sa = vec3(0.0), sb = vec3(0.0);
        for (int y = 0; y < ${B}; y++) for (int x = 0; x < ${B}; x++) {
          ivec2 p = min(p0 + ivec2(x, y), lim);
          sa += texelFetch(a, p, 0).rgb; sb += texelFetch(b, p, 0).rgb;
        }
        vec3 e = abs(disp(sa * (invA / ${B * B}.0)) - disp(sb * (invB / ${B * B}.0)));
        fragColor = vec4(170.0 * max(e.r, max(e.g, e.b)), 0.0, 0.0, 1.0);
      }`, { a: { value: null }, b: { value: null }, invA: { value: 1 }, invB: { value: 1 }, shoulderAmt: { value: 1 } });
    this.maxPass = new FSPass(/* glsl */ `
      uniform sampler2D e;
      void main() {
        ivec2 p0 = ivec2(gl_FragCoord.xy) * ${R};
        float m = 0.0;
        for (int y = 0; y < ${R}; y++) for (int x = 0; x < ${R}; x++) {
          ivec2 p = p0 + ivec2(x, y);
          if (p.x < ${ew} && p.y < ${eh}) m = max(m, texelFetch(e, p, 0).r);
        }
        fragColor = vec4(m, 0.0, 0.0, 1.0);
      }`, { e: { value: null } });
  }

  /**
   * Load the selected video: its soundtrack (a single file's length read from its metadata), its timing
   * data (or a beat grid), the fonts, its timeline (timeline.ts) and its scenes. `only`: load just these
   * entries (render.ts --only); the others render black.
   */
  async init(only?: (e: TimelineEntry) => boolean) {
    const [{ segments, problems }] = await Promise.all([loadSegments(VIDEO.audio), loadFonts(), loadStrokeFonts()]);
    this.soundtrack = segments;
    this.bootErrors.push(...problems);
    const noLength = () => new Error(`Nothing gives this video's length (no readable audio, no data/audio.json): set "duration" in ${VIDEO.dir}/video.json.`);
    [this.audio, this.words] = await Promise.all([
      AudioData.load(DATA_URLS.audio, () => {
        const d = resolveDuration(VIDEO, segments, null);
        if (!d) throw noLength();
        return { bpm: VIDEO.bpm, duration: d.duration };
      }),
      Words.load(DATA_URLS.words),
    ]);
    // the video's length (video.json duration > segment list > data/audio.json > the audio file)
    const d = resolveDuration(VIDEO, segments, this.audio.synthetic ? null : this.audio.duration);
    if (!d) throw noLength();
    this.durationOverride = d.duration;
    this.durationSource = d.source;
    // (timelines end their last entry at audio.duration: make it the video's length)
    this.audio.duration = d.duration;
    if (this.audio.synthetic) this.warnings.push(`no ${VIDEO.dir}/data/audio.json: a ${VIDEO.bpm} BPM beat grid stands in (beats and bars only; envelopes and onsets read 0)`);
    const card = testCardNote(VIDEO.name);
    if (card) this.warnings.push(card);
    this.timeline = this.makeTimeline(this.words, this.audio);
    this.checkTimeline();
    this.cuts = this.findCuts();
    this.ctx = { renderer: this.renderer, audio: this.audio, words: this.words, comp: this.comp, W, H, id: '', params: {}, start: 0, end: 0, export: this.exporting };
    this.post = new Post();
    this.hud = new Hud();
    const entries = only ? this.timeline.filter(only) : this.timeline;
    await Promise.all(entries.map(async (e) => { this.loaded.set(e.id, await this.loadEntry(e)); }));
    this.errorsVersion++;
  }

  /** The timeline's own mistakes, named: a duplicate id, an empty or inverted window, a time that isn't a number. */
  private checkTimeline() {
    const ids = new Set<string>();
    for (const e of this.timeline) {
      if (ids.has(e.id)) this.bootErrors.push(`${VIDEO.dir}/timeline.ts: two entries are called '${e.id}' (ids must be unique)`);
      ids.add(e.id);
      if (!Number.isFinite(e.start) || !Number.isFinite(e.end) || !(e.end > e.start))
        this.bootErrors.push(`${VIDEO.dir}/timeline.ts: entry '${e.id}' has start ${e.start} and end ${e.end} (need finite numbers, end > start)`);
    }
  }

  /** See `cuts`. */
  private findCuts() {
    const TL = this.timeline;
    const times = [...new Set(TL.flatMap((e) => [e.start, e.end]))].filter((b) => b > 0 && b < this.duration).sort((a, b) => a - b);
    return times.filter((b) => {
      const before = TL.filter((e) => e.start < b && e.end >= b), after = TL.filter((e) => e.start <= b && e.end > b);
      return (before.length || after.length) && !before.some((e) => after.includes(e));
    });
  }

  /** A sub-frame time moved onto its frame's side of every hard cut between them: to the cut, or just before it. */
  private sameSide(t: number, ts: number) {
    for (const b of this.cuts) {
      if (t < b && ts >= b) ts = b - 1e-6;
      else if (t >= b && ts < b) ts = b;
    }
    return ts;
  }

  /** Instantiate and init one entry's scene (`load`: a fresh module, when the preview hot-swaps it). */
  private async loadEntry(e: TimelineEntry, load = e.load): Promise<Loaded> {
    const rec: Loaded = { entry: e, scene: null, lastT: -1 };
    try {
      const mod = await load();
      if (typeof mod?.default !== 'function') throw new Error(`the scene module of '${e.id}' has no default export (a class extending Scene)`);
      const s = new mod.default({ ...this.ctx, id: e.id, params: e.params ?? {}, start: e.start, end: e.end });
      await s.init();
      rec.scene = s;
    } catch (err) {
      rec.error = String((err as Error)?.stack ?? err);
      console.error(`scene ${e.id} failed`, err);
    }
    return rec;
  }

  /**
   * Hot-swap an entry's scene (the preview calls this when its module is saved). The old scene keeps
   * rendering until the new one is ready; the entry's error record is replaced (cleared on success).
   */
  async reload(id: string, load?: TimelineEntry['load']) {
    const e = this.timeline.find((x) => x.id === id);
    if (!e) return;
    const rec = await this.loadEntry(e, load);
    const old = this.loaded.get(id);
    this.loaded.set(id, rec);
    old?.scene?.dispose();
    this.lastT = -1;
    this.errorsVersion++;
  }

  /**
   * Draw every entry once off screen, at its start, middle and end, so each scene's shaders are compiled
   * before the player needs them. WebGL compiles a program at its first draw, and a heavy scene's compile
   * stalls the page where that scene first plays: two showreels froze 1.0 s and 2.35 s there on a first
   * play, then played at 60 fps the second time. The player calls this once before it plays; `onEntry`
   * reports progress, and the page gets a frame before each entry to show it.
   */
  async warm(onEntry?: (i: number, n: number, id: string) => void) {
    const es = this.timeline.filter((e) => this.loaded.get(e.id)?.scene);
    try {
      for (let i = 0; i < es.length; i++) {
        const e = es[i]!;
        onEntry?.(i, es.length, e.id);
        await new Promise((r) => requestAnimationFrame(r));
        for (const f of [0, 0.5, 1]) this.render(Math.max(0, Math.min(e.start + (e.end - e.start) * f, e.end, this.duration) - 1e-3 * f), 1 / VIDEO.fps, false);
      }
    } finally {
      // every scene starts again as if never drawn, so its first frame in the player counts as a seek: a
      // stateful entry shorter than the 0.25 s seek window would otherwise play on from the state warming
      // left at its end, and the preview would no longer match the render
      this.lastT = -1;
      for (const rec of this.loaded.values()) rec.lastT = -1;
    }
  }

  /**
   * Current errors: boot problems, then every entry whose scene failed to load or threw while rendering
   * (`[id] message`; a render error is recorded once, until the scene reloads).
   */
  get errors(): string[] {
    const out = [...this.bootErrors];
    for (const [id, r] of this.loaded) if (r.error) out.push(`[${id}] ${r.error}`);
    return out;
  }

  /** Add what is known about why an entry failed to its error (the dev server's message for its module). */
  explain(id: string, why: string) {
    const r = this.loaded.get(id);
    if (!r?.error || r.error.includes(why)) return;
    r.error = `${r.error}\n${why}`;
    this.errorsVersion++;
  }

  /** The video's length, set at init from video.json, the soundtrack or the analysis (see soundtrack.ts resolveDuration). */
  durationOverride: number | null = null;
  durationSource: DurationSource | null = null;
  get duration() { return this.durationOverride ?? this.audio.duration; }

  private frameFor(e: TimelineEntry, t: number, dt: number, seeked: boolean, preroll: boolean, under: THREE.Texture | null, tin: number, tout: number): Frame {
    const beat = this.audio.beatAt(t), bar = this.audio.barAt(t);
    return {
      t, dt, lt: t - e.start, p: (t - e.start) / (e.end - e.start), start: e.start, end: e.end, seeked, preroll,
      beat, bar, beatPhase: beat - Math.floor(beat), barPhase: bar - Math.floor(bar),
      a: this.audio.sample(t), under, tin, tout,
      ...(e.remix ? { remix: e.remix } : {}),
    };
  }

  /**
   * Render video time t. `dt` is the nominal frame step (1/fps). A non-sequential t counts as a
   * seek: stateful scenes are reset and fast-forwarded. Each scene gets as f.dt the video time since its
   * own last render (see composite).
   *
   * Motion blur (offline export; the preview uses 1 sample): `samples` > 1 renders that many sub-frames
   * spread evenly over `shutter` x dt (default 0.2: a fifth of the frame time) around t and averages them
   * before post-processing, which gives real motion blur plus temporal anti-aliasing. With an
   * AdaptiveSampling the count is chosen per frame:
   * sub-frames are added in nested steps (4, 12, 36 … each set evenly spread over the shutter, see
   * ternaryOffsets) until the estimated remaining error is below `tol` levels. Stepped copies of a moving
   * edge shrink as 1/count, so when a step changes the frame by e, what is left is about e/2
   * (e·(1/3 + 1/9 + …)). A still frame stops at 3 x min; a whip pan goes on until its streaks are
   * continuous instead of stepped copies.
   * No sub-frame crosses a hard cut (`cuts`): the frame on a cut shows only the scene after it, the frame
   * before it only the scene before it, as on film, where a cut falls between two exposures.
   * Returns the number of sub-frames used.
   */
  render(t: number, dt = 1 / VIDEO.fps, toScreen = true, samples: number | AdaptiveSampling = 1, shutter = 0.2): number {
    const r = this.renderer;
    const seeked = this.lastT < 0 || t < this.lastT - 1e-6 || t - this.lastT > Math.max(0.25, dt * 4);
    this.lastT = t;
    this.lastEntries.clear();
    let outTex: THREE.Texture;
    let post: PostParams = { ...DEFAULT_POST };
    let n = 1;
    if (samples === 1) {
      SS_TAP.value = -1;
      ({ outTex, post } = this.composite(t, dt, seeked));
    } else {
      const adaptive = typeof samples !== 'number';
      let maxAdaptive = adaptive ? samples.max : 0;
      if (adaptive) {
        // sub-frames are rendered out of time order: fine for pure functions of t, not for scenes that integrate state
        const w = dt * shutter;
        const on = this.timeline.filter((e) => t + w / 2 >= e.start && t - w / 2 < e.end);
        const st = on.find((e) => this.loaded.get(e.id)?.scene?.stateful);
        if (st) throw new Error(`adaptive sampling needs stateless scenes; '${st.id}' is stateful (use a fixed --samples)`);
        for (const e of on) if (e.maxSamples) maxAdaptive = Math.min(maxAdaptive, e.maxSamples);
      }
      // shaders that supersample share their 4 taps across the sub-frames when every set holds a multiple
      // of 4 (rotated by k/4 so a tap doesn't always land in the same part of the shutter)
      const cycle = adaptive || samples % 4 === 0;
      // post parameters (shake, flash, zoom, fades, the HUD's paper mode) are read at one point of the shutter,
      // 1/8 of it after t: where the video was tuned (4 sub-frames, the third) and a point every adaptive set
      // includes. (A flash that starts between t and there shows at its peak on this frame, not one frame on.)
      const POST_U = 0.125;
      let nearest = Infinity;
      // sub-frame k at shutter offset u (-0.5..0.5), summed into `into`; `step` = the nominal sub-frame spacing
      const sub = (k: number, u: number, into: THREE.WebGLRenderTarget, step: number) => {
        SS_TAP.value = cycle ? (k + (k >> 2)) % 4 : -1;
        // (clamped at 0, where no scene is active before, and to the frame's side of every hard cut: a frame
        // on a cut would otherwise average both scenes into a double exposure)
        const res = this.composite(this.sameSide(t, Math.max(0, t + dt * shutter * u)), step, seeked && k === 0);
        this.accum.u.src!.value = res.outTex;
        this.accum.render(r, into);
        const d = Math.abs(u - POST_U);
        if (d < nearest - 1e-9 || (d < nearest + 1e-9 && u > POST_U)) { nearest = d; post = res.post; }
      };
      clearRT(r, this.sumRT, [0, 0, 0], 0);
      if (!adaptive) {
        n = samples;
        for (let k = 0; k < n; k++) sub(k, (k + 0.5) / n - 0.5, this.sumRT, (dt * shutter) / n);
      } else {
        const lg3 = (x: number) => Math.log(x / 4) / Math.log(3);
        const lo = Math.max(0, Math.round(lg3(samples.min))), hi = Math.max(lo, Math.floor(lg3(maxAdaptive) + 1e-9));
        const u = ternaryOffsets(hi);
        n = 4 * 3 ** lo;
        this.lastErrors = [];
        for (let k = 0; k < n; k++) sub(k, u[k]!, this.sumRT, (dt * shutter) / n);
        for (let l = lo; l < hi; l++) {
          clearRT(r, this.newRT, [0, 0, 0], 0);
          for (let k = n; k < 3 * n; k++) sub(k, u[k]!, this.newRT, (dt * shutter) / (3 * n));
          // (the post is the frame's already: the first set holds the sub-frame at POST_U)
          const err = this.sampleError(n, post.shoulder) / 2;
          this.lastErrors.push(err);
          this.comp.draw(r, this.newRT.texture, this.sumRT, { mode: 'add', opacity: 1, premult: false });
          n *= 3;
          if (err < samples.tol) break;
        }
      }
      SS_TAP.value = -1;
      this.comp.draw(r, this.sumRT.texture, this.avgRT, { mode: 'replace', opacity: 1 / n, premult: false });
      outTex = this.avgRT.texture;
    }
    this.lastSamples = n;
    const hudTex = this.hud.draw(t, { opacity: post.hud, frame: post.frame, paper: post.paper, extra: post.hudDraw });
    this.post.render(r, outTex, hudTex, this.finalRT, post, t);
    this.lastPost = post;
    if (toScreen) {
      // over the whole canvas: renderer.setViewport, setScissor and setScissorTest set the canvas's own
      // viewport and scissor, and a scene that used them (a split screen drawn into `out`) would otherwise
      // squeeze this frame and every later one into part of the preview
      r.setViewport(0, 0, PW, PH);
      r.setScissorTest(false);
      this.blit.u.src!.value = this.finalRT.texture;
      this.blit.render(r, null);
    }
    return n;
  }

  /**
   * How far the displayed frame (8-bit levels, worst block) moves when the 2n sub-frames summed in newRT
   * are merged with the n summed in sumRT, through the frame's tone shoulder (`shoulder`, its post's).
   * Stepped copies of a fast edge differ between the two interleaved sets; a converged streak does not.
   */
  private sampleError(n: number, shoulder: number) {
    const r = this.renderer;
    this.errPass.u.a!.value = this.sumRT.texture;
    this.errPass.u.b!.value = this.newRT.texture;
    this.errPass.u.invA!.value = 1 / n;
    this.errPass.u.invB!.value = 1 / (2 * n);
    this.errPass.u.shoulderAmt!.value = shoulder;
    this.errPass.render(r, this.errRT);
    this.maxPass.u.e!.value = this.errRT.texture;
    this.maxPass.render(r, this.maxRT);
    r.readRenderTargetPixels(this.maxRT, 0, 0, this.maxRT.width, this.maxRT.height, this.errBuf);
    let m = 0;
    for (let i = 0; i < this.errBuf.length; i += 4) m = Math.max(m, this.errBuf[i]!);
    return m;
  }

  /**
   * Render and composite all scenes active at t into an HDR texture (no post). `dt` is the nominal step (the
   * frame step, or the sub-frame spacing): a scene's f.dt is exactly that when its last render was that far
   * back. `seeked` says time jumped before this call.
   */
  private composite(t: number, dt: number, seeked: boolean): { outTex: THREE.Texture; post: PostParams } {
    const r = this.renderer;

    const active = this.bare ? [] : this.timeline.filter((e) => t >= e.start && t < e.end).sort((a, b) => a.start - b.start);
    let post: PostParams = { ...DEFAULT_POST };
    let under: THREE.Texture | null = null;
    let outTex: THREE.Texture | null = null;

    active.forEach((e, idx) => {
      const rec = this.loaded.get(e.id);
      const rt = this.rts[idx % this.rts.length]!;
      this.lastEntries.add(e.id);
      const prev = active[idx - 1], next = active[idx + 1];
      const tin = prev ? Math.min(1, (t - e.start) / Math.max(1e-3, prev.end - e.start)) : 1;
      const tout = next ? Math.max(0, (t - next.start) / Math.max(1e-3, e.end - next.start)) : 0;
      if (!rec?.scene) {
        // dark red: a scene that failed to load (its error is in `errors`); black: an entry left out by --only
        clearRT(r, rt, rec ? [0.25, 0.0, 0.0] : [0, 0, 0]);
        under = rt.texture; outTex = rt.texture;
        return;
      }
      const s = rec.scene;
      // (sub-frames of one frame may step back within its shutter: not a seek)
      const sceneSeeked = seeked || rec.lastT < 0 || Math.abs(t - rec.lastT) > 0.25;
      // f.dt is the video time since this scene last rendered: 0 while the preview is paused, the playhead's
      // step while it plays, the sub-frame spacing inside a frame's shutter (exactly `dt` when it is that,
      // so a re-simulation after a seek matches playback bit for bit)
      let fdt = sceneSeeked ? 0 : stepBetween(rec.lastT, t, dt);
      if (s.stateful && sceneSeeked) {
        // Re-simulate what playing from the entry's start (or prerollMax before t) renders on the way to t:
        // that start, then every frame of the video's frame grid, each with the step playback gives it.
        // A seek then ends in the state an export reaches, and t itself gets the last step (not 0).
        s.reset();
        const step = 1 / VIDEO.fps, from = Math.max(e.start, t - s.prerollMax);
        let last = -1;
        const sim = (pt: number) => {
          s.render(this.frameFor(e, pt, last < 0 ? 0 : stepBetween(last, pt, step), last < 0, true, null, 1, 0), rt);
          last = pt;
        };
        if (from < t - 1e-9) sim(from);
        for (let n = Math.floor(from * VIDEO.fps + 1e-6) + 1; n * step < t - 1e-9; n++) sim(n * step);
        fdt = last < 0 ? 0 : stepBetween(last, t, step);
      }
      let ov: PostOverrides | void = undefined;
      try {
        ov = s.render(this.frameFor(e, t, fdt, sceneSeeked && !s.stateful, false, idx > 0 ? under : null, tin, tout), rt);
      } catch (err) {
        // dark red for this frame; the error is recorded once (until the scene reloads), so the preview
        // and render.ts report it while the other scenes keep playing
        if (!rec.error) {
          rec.error = `render error at t=${t.toFixed(3)}: ${String((err as Error)?.stack ?? err)}`;
          this.errorsVersion++;
          console.error(`scene ${e.id} render error`, err);
        }
        clearRT(r, rt, [0.25, 0.0, 0.0]);
      }
      rec.lastT = t;
      post = { ...post, ...(e.post ?? {}), ...(ov ?? {}) };
      if (idx > 0 && !s.handlesTransition && under) {
        // default: crossfade from the previous scene over the overlap (into the mix target `under` isn't)
        const mix = (this.mixRTs[(idx - 1) & 1] ??= makeRT(W, H, { depthBuffer: false }));
        this.xfade.u.a!.value = under;
        this.xfade.u.b!.value = rt.texture;
        this.xfade.u.k!.value = tin;
        this.xfade.render(r, mix);
        outTex = mix.texture;
      } else outTex = rt.texture;
      under = outTex;
    });

    if (!outTex) { clearRT(r, this.rts[0]!, [0, 0, 0]); outTex = this.rts[0]!.texture; }
    return { outTex, post };
  }

  /** Wait for the GPU to finish the last frame (a 1-pixel read): what a frame costs without reading it back. */
  sync() {
    this.renderer.readRenderTargetPixels(this.finalRT, 0, 0, 1, 1, this.px1);
  }

  /** RGBA8 pixels of the last rendered frame (bottom-up rows), PW x PH. */
  readPixels(buf?: Uint8Array) {
    const out = buf ?? new Uint8Array(PW * PH * 4);
    this.renderer.readRenderTargetPixels(this.finalRT, 0, 0, PW, PH, out);
    return out;
  }

  /**
   * Same pixels as readPixels(), read through a pixel-pack buffer and a fence instead of a blocking
   * readPixels: several times faster in Chrome (~15 ms instead of ~40 ms at 1080p, ~150 ms at 4K).
   */
  async readPixelsAsync(buf?: Uint8Array) {
    const out = buf ?? new Uint8Array(PW * PH * 4);
    await this.renderer.readRenderTargetPixelsAsync(this.finalRT, 0, 0, PW, PH, out);
    return out;
  }
}
