// Global overlay, drawn after the scenes and before post's shoulder/grain: the crop-mark frame
// (post.frame) and a scene's own steady overlay (post.hudDraw). Both stay put under the image's shake,
// zoom, inversion and colour fringes. Off by default (frame 0, no hudDraw).
import { Layer2D, W, H } from './gl';
import { rgba } from './palette';
import { clamp, ease, lerp } from './util';

export interface HudState {
  /** Opacity multiplier (post.hud). */
  opacity: number;
  /** 0..1 the crop-mark frame: 1 in place, 0 flown out past the edges (post.frame). */
  frame: number;
  /** 0..1: the frame is light (post.paper): marks in the palette's bg colour instead of fg. */
  paper: number;
  /** Extra drawing over the crop marks (post.hudDraw), in logical px. */
  extra?: (c: CanvasRenderingContext2D) => void;
}

export class Hud {
  layer = new Layer2D();
  /** The layer was left empty last frame: nothing to clear or upload while it stays empty. */
  private empty = false;

  draw(_t: number, st: HudState) {
    const L = this.layer;
    const visible = st.opacity > 0.001 && (st.frame > 0.001 || !!st.extra);
    // (a Canvas2D upload costs a few ms per frame: skip it while the overlay stays empty)
    if (!visible) {
      if (!this.empty) { L.clear(); L.upload(); this.empty = true; }
      return L.texture;
    }
    this.empty = false;
    L.clear();
    const c = L.ctx;
    c.globalAlpha = st.opacity;
    if (st.frame > 0.001) this.cropMarks(c, st.frame, st.paper > 0.5);
    if (st.extra) { c.save(); st.extra(c); c.restore(); }
    return L.upload();
  }

  /** Corner marks; as `k` drops they fly out along the diagonals and past the edges. */
  private cropMarks(c: CanvasRenderingContext2D, k: number, paper: boolean) {
    const e = ease.inOutCubic(clamp(k));
    c.save();
    c.globalAlpha *= clamp(k * 3);
    c.strokeStyle = paper ? rgba('bg', 0.45) : rgba('fg', 0.34);
    c.lineWidth = 1.25;
    const m = lerp(-40, 36, e), l = 22;
    c.beginPath();
    for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]] as const) {
      c.moveTo(x + sx * l, y + 0.5 * sy); c.lineTo(x, y + 0.5 * sy); c.lineTo(x, y + sy * l);
    }
    c.stroke();
    c.restore();
  }
}
