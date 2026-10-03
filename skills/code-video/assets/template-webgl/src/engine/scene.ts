// Scene API. A scene owns a time window of the video and renders HDR linear colour
// into the render target it is given. Everything must be a deterministic function of
// time (plus internal state advanced only through render() calls, see `stateful`).
import type * as THREE from 'three';
import type { AudioData, AudioSample } from './audio';
import type { Words } from './words';
import type { Compositor } from './gl';
import type { PostParams } from './post';

export interface SceneCtx {
  renderer: THREE.WebGLRenderer;
  /** Beats, sections, envelopes and onsets of the soundtrack (data/audio.json, or a synthetic beat grid). */
  audio: AudioData;
  /** Timed lines and words, sung or spoken (data/words.json; empty without one). */
  words: Words;
  comp: Compositor;
  /** The logical frame (the video's size): lay out in these px at every output scale. */
  W: number;
  H: number;
  /** Timeline entry id and its free-form params (lets one scene module serve several entries). */
  id: string;
  params: Record<string, any>;
  /** Entry window (video seconds). */
  start: number;
  end: number;
  /**
   * True when the page renders for scripts/render.ts (?export=1: stills, sheets, verify, the video), false
   * in the live preview. Its one use: a scene too heavy for real time may draw a cheaper version in the
   * preview (a lower internal resolution, fewer samples or raymarch steps). Cost, never content: the render
   * shows what the director approved in the preview, only cleaner.
   */
  export: boolean;
}

export interface Frame {
  /** Video time (s). */
  t: number;
  /**
   * Video time since this scene's previous render: the playhead's step in the preview (0 while paused),
   * 1/fps between the frames of a one-sample render, the sub-frame spacing inside a frame's shutter; 0 after
   * a seek. It depends on how the frames are drawn, so a simulation steps at its own fixed rate to where f.t
   * calls for rather than adding up dt (`stateful`, below; docs/ENGINE.md, "Stateful scenes").
   * Adaptive sub-frames run out of time order (stateless scenes only), so there it can be negative.
   */
  dt: number;
  /** Local time since this scene's start, and 0..1 progress through its window. */
  lt: number;
  p: number;
  start: number;
  end: number;
  /** True when time jumped (scrub/seek) — stateful scenes should reset. */
  seeked: boolean;
  /** True while the engine fast-forwards a stateful scene after a seek (skip non-essential work). */
  preroll: boolean;
  /** Continuous beat/bar indices from the beat grid, and their fractional phases. */
  beat: number;
  bar: number;
  beatPhase: number;
  barPhase: number;
  /** Audio features at t (envelopes 0..1 and decaying hit pulses). */
  a: AudioSample;
  /**
   * When this scene overlaps the previous one (a transition), the previous scene's
   * output texture for this frame; otherwise null. Scenes that set
   * `handlesTransition = true` composite it themselves.
   */
  under: THREE.Texture | null;
  /** 0..1 progress through the overlap with the previous scene (1 when not overlapping). */
  tin: number;
  /** 0..1 progress through the overlap with the next scene (0 when not overlapping). */
  tout: number;
  /**
   * Opt-in variations from the timeline entry (TimelineEntry.remix), e.g. when another video re-renders
   * this scene with another camera or without its text. Absent normally: a scene must render exactly
   * as designed without it, and read only the keys it documents.
   */
  remix?: Record<string, any>;
}

export type PostOverrides = Partial<PostParams>;

export abstract class Scene {
  /** If true, the engine fast-forwards (calls render with preroll=true) after seeks. */
  stateful = false;
  /** Max seconds of history the engine re-simulates when seeking into a stateful scene. */
  prerollMax = 6;
  /** If true, this scene composites `f.under` itself during its incoming transition. */
  handlesTransition = false;

  constructor(protected ctx: SceneCtx) {}

  /** Load/create resources. Called once before first render. */
  init(): Promise<void> | void {}

  /** Reset internal state (called on seeks for stateful scenes). */
  reset(): void {}

  /** Render into `out` (HalfFloat, linear HDR). Must fully overwrite/clear it. Return post-processing overrides. */
  abstract render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides | void;

  dispose(): void {}
}

export type SceneClass = new (ctx: SceneCtx) => Scene;
