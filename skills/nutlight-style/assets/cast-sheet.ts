// The kit's cast sheet: the squirrel in its views and poses, under one rig's light.
import type * as THREE from 'three';
import { Scene, type Frame } from '../../../src/engine/scene';
import { Stage, Squirrel, CAST, POSE, alive, typing, walk, withPose, express, rig, cam, mixs, type SqPose } from '../../../src/nutlight';

const R = rig('hub');
const COLS = 6, X0 = 230, DX = (1920 - 2 * X0) / (COLS - 1);

export default class Cast extends Scene {
  st = new Stage(this.ctx, R);
  a = new Squirrel(CAST.amber, { res: 0.9 });
  b = new Squirrel(CAST.coral, { res: 0.9 });
  override dispose() { this.st.dispose(); }
  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const st = this.st, t = f.lt;
    st.cam = cam();
    st.begin(out);
    st.sky({ top: R.c.hubBg, bottom: R.c.struct });
    for (const y of [470, 1010]) st.rect(960, y + 6, 1800, 4, R.c.structLit, { alpha: 0.6 });
    // row 1: the full front and the head turned three-quarter (references 01 and 02), large
    this.a.draw(st, 300, 470, alive(POSE.stand, t, 1), { scale: 0.62, view: 'front' });
    this.a.draw(st, 760, 470, alive(withPose(POSE.stand, { turn: 1 }), t, 2), { scale: 0.62, view: 'front' });
    this.b.draw(st, 1200, 470, alive(express(POSE.stand, 'smile', 0.6), t, 3), { scale: 0.62, view: 'front' });
    this.b.draw(st, 1640, 470, alive(withPose(POSE.stand, { turn: 1 }), t, 4), { scale: 0.62, view: 'front', face: -1 });
    // row 2: the side poses
    const poses: { p: SqPose; view?: 'back' }[] = [
      { p: alive(POSE.stand, t, 5) },
      { p: alive(typing(withPose(POSE.sitType, { reachN: [150, -150], reachF: [110, -146] }), t, 1, 6), t, 6), view: 'back' },
      { p: alive(POSE.point, t, 7) },
      { p: alive(POSE.cheer, t, 8) },
      { p: alive(walk(t * 0.9), t, 9) },
      { p: alive(express(POSE.shrug, 'skeptical', 0.6), t, 10) },
    ];
    poses.forEach((q, i) => {
      const sq = i % 2 ? this.b : this.a, sit = q.view === 'back';
      sq.draw(st, X0 + i * DX, sit ? 970 : 1010, q.p, { scale: 0.36, face: 1, view: q.view ?? 'side' });
    });
    void mixs;
    return st.end({ vignette: 0.15 });
  }
}
