// The example's scene labels, shared by its four scenes (named exports only: a helper, not a scene).
// Each label names the technique on screen and the file that draws it. It sits at the lower left of the
// title-safe area (5% in from the edges: 96 px at the sides and 54 px at the bottom of a 1920x1080 frame)
// at 36 px, the project's smallest size for text meant to be read at 1920x1080 (docs/STYLE.md).
import { F, font, measure } from '../../../src/engine/type';
import { rgba } from '../../../src/engine/palette';

const SIZE = 36;
const FAMILY = F.mono(400);

/** Where a label goes in a W x H frame: its baseline origin, size, CSS font and ink box (logical px, top-left origin). */
export function labelBox(text: string, W: number, H: number) {
  const x = Math.round(0.05 * W), bottom = H - Math.round(0.05 * H);
  // (a label too long for a narrow frame gets smaller rather than leaving the safe area)
  const size = Math.min(SIZE, Math.floor((SIZE * (W - 2 * x)) / measure(text, FAMILY, SIZE)));
  const y = bottom - Math.ceil(0.25 * size); // the baseline: descenders (about 0.23 em in Plex Mono) end at title-safe
  return { x, y, size, font: font(FAMILY, size), w: measure(text, FAMILY, size), top: y - Math.ceil(0.78 * size), bottom };
}

/** Draw a label into a frame-sized Canvas2D context (in muted, like every annotation of the test card). */
export function drawLabel(c: CanvasRenderingContext2D, text: string, W: number, H: number) {
  const b = labelBox(text, W, H);
  c.font = b.font;
  c.fillStyle = rgba('muted');
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  c.fillText(text, b.x, b.y);
  return b;
}
