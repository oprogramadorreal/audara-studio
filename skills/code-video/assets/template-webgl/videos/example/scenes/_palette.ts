// The example's own palette, shared by its four scenes (named exports only: a helper, not a scene): the
// template's test card, the values a new project's src/look.ts starts with. It is the example's, not the
// project's, so the project can recolour its palette and rename or drop any key but `bg` and `fg` (the
// engine needs those), and the example still type-checks and looks the same. Only the example does this:
// the project's own videos draw with its palette (src/look.ts) through src/engine/palette.ts, and need no
// module like this one. The same three forms as there: LIN, rgba() and the GLSL constants (C_BG ...).
import { glslColorName } from '../../../src/engine/glsl/common';
import { hexToLinear } from '../../../src/engine/util';

/** The test card, by the job each colour does in the example (../TREATMENT.md, Palette). */
export const CARD = {
  bg: '#3A3A3A', // the ground
  line: '#707070', // structure: rings, rulers, grids, the slab
  muted: '#AEAEAE', // lighter structure (columns, hatching), labels and notes
  fg: '#F5F5F5', // marks: outlines, ink, sung words
  accent: '#00B4E6', // what reacts to the music
  accent2: '#E6007E', // one other channel per scene (the snare, the kick's source)
} as const;

export type CardKey = keyof typeof CARD;

/** Linear RGB triplets for GL uniforms and three.js (render targets hold linear colour). */
export const LIN = Object.fromEntries(
  Object.entries(CARD).map(([k, v]) => [k, hexToLinear(v)]),
) as Record<CardKey, [number, number, number]>;

/** CSS rgba() for Canvas2D. */
export function rgba(key: CardKey, a = 1): string {
  const n = parseInt(CARD[key].slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * The card for a fragment shader, as C_BG, C_LINE ... C_ACCENT2 (linear RGB): put it at the top of the
 * shader. The engine declares the project's own C_<KEY> constants ahead of every FSPass shader (GLSL_COMMON);
 * these are #defines, which take each name over for the code after them, whether the project has that key
 * or not.
 */
export const GLSL_PALETTE = Object.entries(LIN)
  .map(([k, c]) => `#define ${glslColorName(k)} vec3(${c.map((x) => x.toFixed(5)).join(',')})`)
  .join('\n');
