// The palette, from the project's look (src/look.ts): hex for Canvas2D, linear RGB for GL.
// glsl/common.ts turns every key into a GLSL constant (C_BG, C_FG, C_ACCENT2 ...).
import { PALETTE } from '../look';
import { hexToLinear } from './util';

export const HEX = PALETTE;

export type PaletteKey = keyof typeof PALETTE;

/** Linear RGB triplets for GL uniforms (render targets hold linear colour). */
export const LIN: Record<PaletteKey, [number, number, number]> = Object.fromEntries(
  Object.entries(HEX).map(([k, v]) => [k, hexToLinear(v)]),
) as Record<PaletteKey, [number, number, number]>;

/** CSS rgba() for Canvas2D, from a palette key or any '#rrggbb'. */
export function rgba(key: PaletteKey | string, a = 1): string {
  const hex = (HEX as Record<string, string>)[key] ?? key;
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * The template's test card: the values the template's src/look.ts starts with (keep the two in step), a
 * calibration chart no one would ship as a style. Left in place, every video would inherit a look nobody
 * chose.
 */
export const TEST_CARD = {
  bg: '#3A3A3A', surface: '#474747', line: '#707070', muted: '#AEAEAE', fg: '#F5F5F5', accent: '#00B4E6', accent2: '#E6007E',
} as const;

/**
 * A reminder while PALETTE still holds every test-card value (keys added beside them don't count as a look
 * of its own), for any video but the template's `example`, whose card it is; null otherwise. The engine
 * adds it to its warnings (render.ts verify prints them) and the preview shows it under the video.
 */
export function testCardNote(video: string): string | null {
  if (video === 'example') return null;
  const p = HEX as Record<string, string>;
  const card = Object.entries(TEST_CARD).every(([k, v]) => p[k]?.toLowerCase() === v.toLowerCase());
  return card ? "src/look.ts still has the template's test-card palette: give the project its own look (docs/STYLE.md)" : null;
}
