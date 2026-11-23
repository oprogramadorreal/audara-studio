// The kit's cast sheet in 16-bit: cast-sheet.ts's views and poses through the kit's PixelStage (pixel.ts), each
// character in its own 15 colours and outline, its drawings timed as drawn frames are, and the palettes as
// swatches between the rows. `params: { px }` sets the grid's pixel in logical px (default 5: a 384×216 picture).
import type * as THREE from 'three';
import { Scene, type Frame } from '../../../src/engine/scene';
import { Stage, Squirrel, CAST, POSE, typing, walk, withPose, express, rig, cam, PixelStage, type Palette, type SqPose } from '../../../src/nutlight';

const R = rig('hub');
const COLS = 6, X0 = 230, DX = (1920 - 2 * X0) / (COLS - 1);

export default class Cast16 extends Scene {
  st = new Stage(this.ctx, R);
  P = new PixelStage(this.ctx, this.st, { px: this.ctx.params.px ?? 5 });
  a = new Squirrel(CAST.amber, { res: 0.9 });
  b = new Squirrel(CAST.coral, { res: 0.9 });
  pal: Palette[] = [];
  override dispose() { this.st.dispose(); this.P.dispose(); }

  override async init() {
    const st = this.st, o = { light: { contact: 0, rim: 0 } } as const;
    // a palette per character, chosen from the views and expressions a video shows of it
    for (const sq of [this.a, this.b]) this.pal.push(this.P.extract(() => {
      sq.draw(st, 330, 620, POSE.stand, { scale: 1, view: 'front', ...o });
      sq.draw(st, 960, 620, express(POSE.cheer, 'delighted', 1), { scale: 1, ...o });
      sq.draw(st, 1560, 620, express(POSE.startled, 'surprised', 1), { scale: 1, face: -1, ...o });
      sq.draw(st, 500, 1060, POSE.sitType, { scale: 0.8, view: 'back', ...o });
      sq.draw(st, 1300, 1060, withPose(POSE.stand, { turn: 1 }), { scale: 0.8, ...o });
    }, 15));
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const st = this.st, P = this.P, t = f.lt, ta = P.drawing(t), o = { light: { contact: 0, rim: 0 } } as const;
    // at rest a loop of three drawings and blinks of two; typing and walking stepped 12 times a second
    const live = (p: SqPose, seed: number) => P.idle(p, t, seed);
    const row1 = [
      { sq: this.a, x: 300, p: live(POSE.stand, 1), face: 1 as const },
      { sq: this.a, x: 760, p: live(withPose(POSE.stand, { turn: 1 }), 2), face: 1 as const },
      { sq: this.b, x: 1200, p: live(express(POSE.stand, 'smile', 0.6), 3), face: 1 as const },
      { sq: this.b, x: 1640, p: live(withPose(POSE.stand, { turn: 1 }), 4), face: -1 as const },
    ];
    const poses: { p: SqPose; view?: 'back' }[] = [
      { p: live(POSE.stand, 5) },
      { p: live(typing(withPose(POSE.sitType, { reachN: [150, -150], reachF: [110, -146] }), ta, 1, 6), 6), view: 'back' },
      { p: live(POSE.point, 7) },
      { p: live(POSE.cheer, 8) },
      { p: live(walk(ta * 0.9), 9) },
      { p: live(express(POSE.shrug, 'skeptical', 0.6), 10) },
    ];
    P.begin(out, cam());
    P.layer({ kind: 'sky' }, () => {
      st.sky({ top: R.c.hubBg, bottom: R.c.struct });
      for (const y of [470, 1010]) st.rect(960, y + 6, 1800, 4, R.c.structLit, { alpha: 0.6 });
    });
    // row 1: the full front and the head turned three-quarter (references 01 and 02), large; row 2: the side poses
    [this.a, this.b].forEach((sq, k) => P.layer({ kind: 'sprites', palette: this.pal[k]!, outline: R.c.frame, selout: 0.3, bias: -0.25 }, () => {
      for (const q of row1) if (q.sq === sq) sq.draw(st, P.snap(q.x), P.snap(470), q.p, { scale: 0.62, view: 'front', face: q.face, ...o });
      poses.forEach((q, i) => {
        if (i % 2 === k) sq.draw(st, P.snap(X0 + i * DX), P.snap(q.view === 'back' ? 970 : 1010), q.p, { scale: 0.36, face: 1, view: q.view ?? 'side', ...o });
      });
    }));
    // the palettes as swatches, in their own colours (tone: false keeps them as chosen)
    P.layer({ kind: 'raw', tone: false }, () => this.pal.forEach((pal, r) => pal.hex.forEach((h, i) => P.cell(60 + i * 4 * P.px, 560 + r * 5 * P.px, 4, 4, h))));
    return P.end();
  }
}
