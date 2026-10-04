// The project's look in code: the palette every scene draws with and the project's post-processing
// defaults. docs/STYLE.md says the same in words; change them together.
//
// init writes the template's test card here, a calibration chart (grey, with cyan and magenta for the
// two emphases) that no one would ship as a style: replace it with the project's own. While all of it
// is still here, the preview and `render.ts verify` say so for any video but `example`.
// Every key becomes a GLSL constant (`accent2` -> C_ACCENT2, `deepRed` -> C_DEEP_RED, linear RGB),
// an entry of LIN (linear triplets for GL uniforms) and a name for rgba(key, alpha) in Canvas2D
// (src/engine/palette.ts). Keep `bg` and `fg` (the engine's flash, invert and crop marks use them);
// add or rename the others freely, scenes refer to them by name. The example video uses none of them:
// it draws with a test card of its own (videos/example/scenes/_palette.ts), whatever this palette becomes.
import type { PostParams } from './engine/post';

// (Calibration values with generic names, not roles a piece has to fill: rename, add or drop keys for this
// one. A frame need not be figures on a ground with one accent.)
export const PALETTE = {
  bg: '#3A3A3A',
  surface: '#474747',
  line: '#707070',
  muted: '#AEAEAE',
  fg: '#F5F5F5',
  accent: '#00B4E6',
  accent2: '#E6007E',
} as const;

/**
 * Project-wide overrides of the engine's neutral post-processing defaults (src/engine/post.ts:
 * exposure 1, bloom 0.35, everything else off). A scene's own overrides still win, per frame.
 * e.g. `{ grain: 0.04, vignette: 0.25 }` for a filmic project.
 */
export const POST: Partial<PostParams> = {};
