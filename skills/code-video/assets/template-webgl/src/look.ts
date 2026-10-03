// The project's look in code: the palette every scene draws with and the project's post-processing
// defaults. docs/STYLE.md says the same in words; change them together.
//
// The values below are the template's test card, a calibration chart (grey, with cyan and magenta for the
// two emphases) that no one would ship as a style: replace them with the project's own. While every one
// of them is still here, the preview and `render.ts verify` say so for any video but `example`.
// Every key becomes a GLSL constant (`accent2` -> C_ACCENT2, `deepRed` -> C_DEEP_RED, linear RGB),
// an entry of LIN (linear triplets for GL uniforms) and a name for rgba(key, alpha) in Canvas2D
// (src/engine/palette.ts). Keep `bg` and `fg` (the engine's flash, invert and crop marks use them);
// add or rename the others freely, scenes refer to them by name.
import type { PostParams } from './engine/post';

export const PALETTE = {
  bg: '#3A3A3A', // the background
  surface: '#474747', // raised areas: panels, cards
  line: '#707070', // rules, grids, dim lines
  muted: '#AEAEAE', // secondary text
  fg: '#F5F5F5', // primary text and marks
  accent: '#00B4E6', // the one emphasis colour
  accent2: '#E6007E', // a second, rarer emphasis
} as const;

/**
 * Project-wide overrides of the engine's neutral post-processing defaults (src/engine/post.ts:
 * exposure 1, bloom 0.35, everything else off). A scene's own overrides still win, per frame.
 * e.g. `{ grain: 0.04, vignette: 0.25 }` for a filmic project.
 */
export const POST: Partial<PostParams> = {};
