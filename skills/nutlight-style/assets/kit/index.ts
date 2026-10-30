// The Nutlight kit: scenes import from here only (`import { Stage, rig, Squirrel, … } from '../../../src/nutlight'`).
// README.md beside this file is the guide.
export * from './light';
export * from './squirrel';
export * from './props';
export * from './structures';
export * from './camera';
export { Stage, planetFrame, surfacePoint, type P, type Clip, type DrawOpts, type SpriteOpts, type MarkOpts, type LineOpts } from './stage';
export { bake, Atlas, label, layerArt, smooth, rr, polyPath, type Art, type Pt } from './art';
export { lin, hex, css, mixc, mixh, mixs, gain, type Col, type RGB, type Look } from './color';
export { Path, cam, camKeys, camLerp, frameRect, zoomThrough, glide, pop, spring, stagger, bob, sway, ballistic, shake, resample, morph, type Cam } from './motion';
export { StarField, Counter, drawSun, drawMoon, flare, fadeIn, corner } from './live';
export { FUR, GEAR, type FurPalette } from './palette';
export { ease, smoothKeys, smootherstep, smoothstep, clamp, lerp, invLerp, remap, prog, hash, mulberry32, frameIdx, frameTime, noise1, noise2, fbm1, window01, pulse, mod, TAU, type V2 } from '../engine/util';
