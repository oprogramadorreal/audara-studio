// The structural kit (part of the Nutlight kit: scenes import from './index'): the shapes the references build their
// depth from, as Canvas2D painters (bake them once). Every one paints in the references' value ladder: deep structure
// and crevices near black (R.c.structDeep, R.c.rackGroove), lit planes in the mid values, a 1-3 px lit edge on the
// light's side, and warm accents (window slits, lamp rows) that carry the warm share of a night frame.
//
//   ARCHITECTURE (the references' hub, the city's far layers)
//   paintCylinder(c, R, o)     a round tower: cel-shaded bands (dark side, mid, lit strip), window slits, tiers
//   paintBalcony(c, R, o)      a curved balcony ring seen from below or above: its lip, face, underside, a lamp row
//   paintArches(c, R, o)       a viaduct: a deck carried on arches over piers (the references' bridges), lamps on the deck
//   paintArchWall(c, R, o)     a massive wall with an arch opening (the opening is cut out: what is behind shows)
//   paintSpire(c, R, o)        a thin spire on a stepped base
//   hazeOf(R, col, k)          a colour sunk k into the haze (far layers)
//
//   THE LIT INTERIOR (the office, the site office at dusk, the workshop, the school, the prize hall)
//   paintInterior(c, R, o)     a cut-open room: back wall, ceiling and side walls as planes in shadow, a floor, a
//                              lamp's pool of light that falls off in steps to dark corners, an optional window;
//                              returns the room's planes so props can sit on them
//   paintSlabEdge(c, R, …)     the thick cut edge of a floor or roof slab (the cross-section's frame)
//
//   THE MACHINE KIT (workshops and machines: crates, conveyors, presses, shelves, gears)
//   paintCrate(c, R, w, h, o)  a wooden crate, three-quarter
//   paintConveyor(c, R, w, o)  a conveyor belt on legs with rollers (the belt's dashes animate live: conveyorDashes)
//   paintPress(c, R, w, h, o)  a press frame with its ram (the ram is a separate part: paintPressRam)
//   paintMoldShelf(c, R, w, h, o)  shelves of molds (rounded trays with a shape cut in them)
//   paintGear(c, R, r, o)      a cog (spin it live as a sprite)
import { smooth, rr, type Pt } from './art';
import { css, mixs } from './color';
import type { Stage, DrawOpts } from './stage';
import type { Rig } from './light';
import { ell, lgrad, rgrad } from './props';
import { clamp, lerp, mulberry32, TAU } from '../engine/util';

type C2 = CanvasRenderingContext2D;

/** A colour sunk k (0..1) into the rig's haze (far layers: their lights painted in, never live). */
// (the painters sink a far layer's lights less than its bodies, far * 0.4: reference 03's distant lamps and LEDs stay
// points of light in the haze)
export const hazeOf = (R: Rig, col: string, k: number) => (k > 0 ? mixs(col, R.c.towerHaze, k) : col);

// ------------------------------------------------------------------------------------------------------------
// Architecture
// ------------------------------------------------------------------------------------------------------------
export interface CylOpts {
  x: number; top: number; w: number; bottom: number;
  /** 0 crisp … 1 sunk into the haze */
  far?: number;
  /** the lit side: 'right' (default: the references' light from the upper right) or 'left' */
  lit?: 'left' | 'right';
  /** window slit columns (0 none), their warmth 0..1 (amber share), density 0..1 */
  slits?: number; warm?: number; density?: number;
  /** horizontal tier seams (y list) where the tower steps in by `step` px each */
  tiers?: number[]; step?: number;
  /** a domed or flat cap */
  cap?: 'dome' | 'flat' | 'none';
  seed?: number;
}
/** A round tower, front-on (reference 03: a drum of server cabinets): a broad shadow plane turning softly into the body
 * and a narrow lit strip, a rim light on its lit edge, curved seams that read it as round, and columns of rack bays
 * (each a dark recess with a cyan top bar and small amber and cyan unit lights; far off, window slits). */
export function paintCylinder(c: C2, R: Rig, o: CylOpts) {
  const k = R.c, far = o.far ?? 0, rnd = mulberry32(o.seed ?? 7), right = (o.lit ?? 'right') === 'right';
  const body = hazeOf(R, k.struct, far), dark = hazeOf(R, k.structDeep, far * 0.8), lit = hazeOf(R, k.structLit, far), slitC = hazeOf(R, k.led, far * 0.4), cyan = hazeOf(R, k.slotDim, far * 0.4), cyanB = hazeOf(R, k.slot, far * 0.4);
  const tiers = [o.top, ...(o.tiers ?? []), o.bottom].sort((a, b) => a - b), step = o.step ?? o.w * 0.08, near = far < 0.5;
  for (let i = 0; i < tiers.length - 1; i++) {
    const y0 = tiers[i]!, y1 = tiers[i + 1]!, inset = (tiers.length - 2 - i) * step, x = o.x + inset, w = o.w - inset * 2;
    if (w < 8) continue;
    // the volume: a broad shadow plane, a short soft turn into the body, the lit strip, back to the body at the edge
    const st0: [number, string][] = [[0, dark], [0.24, dark], [0.36, body], [0.7, body], [0.82, mixs(body, lit, 0.5)], [0.9, mixs(body, lit, 0.35)], [1, body]];
    c.fillStyle = lgrad(c, right ? x : x + w, 0, right ? x + w : x, 0, st0); c.fillRect(x, y0, w, y1 - y0);
    c.fillStyle = css(lit, 0.9); c.fillRect(right ? x + w - 2.5 : x, y0, 2.5, y1 - y0);
    // curved seams (front half-ellipses): a dark line, a lit line under it
    if (near && w > 40) for (let y = y0 + 46; y < y1 - 20; y += 64) {
      c.strokeStyle = css(dark, 0.6); c.lineWidth = 1.6; c.beginPath(); c.ellipse(x + w / 2, y, w / 2, Math.max(2, w * 0.04), 0, 0, Math.PI); c.stroke();
      c.strokeStyle = css(lit, 0.3); c.lineWidth = 1; c.beginPath(); c.ellipse(x + w / 2, y + 2, w / 2, Math.max(2, w * 0.04), 0, 0.2, Math.PI - 0.2); c.stroke();
    }
    // the tier's lip: a thin lit ellipse edge, its shadow under it
    c.fillStyle = mixs(body, lit, 0.4); c.fill(ell(x + w / 2, y0, w / 2 + 4, Math.max(3, w * 0.05)));
    c.fillStyle = css(lit, 0.7); c.fill(ell(x + w / 2 + (right ? w * 0.12 : -w * 0.12), y0 - 1, w * 0.3, Math.max(1, w * 0.012)));
    c.fillStyle = css(dark, 0.9); c.fill(ell(x + w / 2, y0 + Math.max(3, w * 0.05) + 2, w / 2 + 2, Math.max(2, w * 0.03)));
    // the bays: columns spaced round the drum (foreshortened toward its edges)
    const cols = o.slits ?? 0;
    for (let j = 0; j < cols; j++) {
      const th = (-0.5 + (j + 0.5) / cols) * 1.7, cs = Math.cos(th), cx = x + w / 2 + Math.sin(th) * w * 0.4;
      if (!near) { // far: window slits, as before
        for (let y = y0 + 16; y < y1 - 14; y += 14 + rnd() * 10) {
          if (rnd() > (o.density ?? 0.5)) continue;
          c.fillStyle = rnd() < (o.warm ?? 0.7) ? slitC : cyan;
          c.fillRect(cx, y, Math.max(2, w * 0.025 * cs), 6 + rnd() * 6);
        }
        continue;
      }
      const cw = Math.max(4, (w * 0.62 / cols) * cs * 0.72), by0 = y0 + 14, by1 = y1 - 12;
      if (by1 - by0 < 12) continue;
      c.fillStyle = css(dark, 0.75); c.fill(rr(cx - cw / 2, by0, cw, by1 - by0, Math.min(3, cw * 0.15)));
      c.fillStyle = css(lit, 0.35); c.fillRect(cx - cw / 2, by1 - 1.5, cw, 1.5);
      c.fillStyle = css(cyanB, 0.75); c.fillRect(cx - cw * 0.4, by0 + 3, cw * 0.8, Math.max(1.5, cw * 0.08));
      for (let y = by0 + 10; y < by1 - 5; y += 6 + rnd() * 4) {
        c.fillStyle = css(lit, 0.12); c.fillRect(cx - cw * 0.42, y - 1.5, cw * 0.84, 1); // the unit's seam
        if (rnd() > (o.density ?? 0.5) + 0.3) continue;
        const nl = cw > 14 ? 1 + Math.floor(rnd() * 3) : 1, uh2 = Math.max(1.5, Math.min(3, cw * 0.1));
        for (let q = 0; q < nl; q++) {
          const warm = rnd() < (o.warm ?? 0.7), uw = nl > 1 ? cw * (0.12 + 0.1 * rnd()) : cw * (0.25 + 0.45 * rnd()), ux = nl > 1 ? cx - cw * 0.38 + q * cw * 0.27 : cx - cw * 0.38 + rnd() * (cw * 0.76 - uw);
          c.fillStyle = css(warm ? slitC : cyanB, 0.9); c.fillRect(ux, y, uw, uh2);
        }
      }
    }
  }
  if ((o.cap ?? 'flat') === 'dome') {
    const w = o.w - (tiers.length - 2) * step * 2, x = o.x + (tiers.length - 2) * step;
    c.fillStyle = body; c.beginPath(); c.ellipse(x + w / 2, o.top, w / 2, w * 0.32, 0, Math.PI, TAU); c.fill();
    c.fillStyle = dark; c.beginPath(); c.ellipse(x + w / 2, o.top, w / 2, w * 0.32, 0, right ? Math.PI : Math.PI * 1.6, right ? Math.PI * 1.4 : TAU); c.lineTo(x + w / 2, o.top); c.fill();
    c.strokeStyle = css(lit, 0.8); c.lineWidth = 2; c.beginPath(); c.ellipse(x + w / 2, o.top, w / 2, w * 0.32, 0, right ? Math.PI * 1.55 : Math.PI, right ? TAU : Math.PI * 1.45); c.stroke();
  }
}

export interface BalconyOpts {
  cx: number; y: number; rx: number; ry: number;
  /** the face's height (px) */
  th: number;
  far?: number;
  /** seen from below (default: the underside shows, the references' rings over our heads) or from above (the top shows) */
  view?: 'below' | 'above';
  /** a lamp row along the face: n lamps (warm), or a continuous warm strip ('strip') */
  lamps?: number | 'strip';
  /** only the arc from a0 to a1 (radians; 0 right, π/2 front) */
  a0?: number; a1?: number;
  /** a warm line under the lip (light from inside the floor) */
  glowUnder?: boolean;
  /** a railing on the lip (default: on the near balconies without glowUnder, whose lip is a floor's edge) */
  rail?: boolean;
}
/** A curved balcony band (the front half of a ring around a tower): the lip, the face, the underside or the top. */
export function paintBalcony(c: C2, R: Rig, o: BalconyOpts) {
  const k = R.c, far = o.far ?? 0, a0 = o.a0 ?? 0, a1 = o.a1 ?? Math.PI, below = (o.view ?? 'below') === 'below';
  const body = hazeOf(R, k.struct, far), dark = hazeOf(R, k.structDeep, far * 0.8), lit = hazeOf(R, k.structLit, far), warm = hazeOf(R, k.led, far * 0.4);
  const arc = (rx: number, ry: number, dy: number, from = a0, to = a1) => { const p: Pt[] = []; for (let i = 0; i <= 48; i++) { const a = from + (to - from) * (i / 48); p.push([o.cx + Math.cos(a) * rx, o.y + dy + Math.sin(a) * ry]); } return p; };
  const top = arc(o.rx, o.ry, 0), bot = arc(o.rx, o.ry, o.th);
  // the face: a band between the two arcs
  const face = new Path2D(); face.moveTo(top[0]![0], top[0]![1]); for (const p of top) face.lineTo(p[0], p[1]); for (let i = bot.length - 1; i >= 0; i--) face.lineTo(bot[i]![0], bot[i]![1]); face.closePath();
  if (!below) { // the walking surface (a lighter ellipse band above the face)
    const surf = new Path2D(); const inner = arc(o.rx * 0.86, o.ry * 0.8, -o.ry * 0.12, a0, a1);
    surf.moveTo(top[0]![0], top[0]![1]); for (const p of top) surf.lineTo(p[0], p[1]); for (let i = inner.length - 1; i >= 0; i--) surf.lineTo(inner[i]![0], inner[i]![1]); surf.closePath();
    c.fillStyle = mixs(body, lit, 0.4); c.fill(surf);
  } else { // the underside: a dark crescent below the face
    const und = arc(o.rx * 0.9, o.ry * 0.7, o.th + o.ry * 0.12, a0, a1);
    const p = new Path2D(); p.moveTo(bot[0]![0], bot[0]![1]); for (const q of bot) p.lineTo(q[0], q[1]); for (let i = und.length - 1; i >= 0; i--) p.lineTo(und[i]![0], und[i]![1]); p.closePath();
    c.fillStyle = dark; c.fill(p);
  }
  c.fillStyle = body; c.fill(face);
  // cel shading on the face: the left third in shadow (the light comes from the upper right)
  c.save(); c.clip(face);
  c.fillStyle = css(dark, 0.75); c.fillRect(o.cx - o.rx - 4, o.y - o.ry - 4, o.rx * 0.75, o.ry * 2 + o.th + 8);
  c.restore();
  // panel joints across the face (a curved band of segments), a soft gradient down it
  c.save(); c.clip(face);
  c.fillStyle = lgrad(c, 0, o.y - o.ry, 0, o.y + o.ry + o.th, [[0, css(lit, 0.12)], [0.5, css(lit, 0)], [1, css(dark, 0.3)]]); c.fillRect(o.cx - o.rx - 4, o.y - o.ry - 4, o.rx * 2 + 8, o.ry * 2 + o.th + 8);
  if (far < 0.5) { c.strokeStyle = css(dark, 0.55); c.lineWidth = 1.2; for (let i = 1; i < 14; i++) { const a = a0 + (a1 - a0) * (i / 14), px = o.cx + Math.cos(a) * o.rx, py = o.y + Math.sin(a) * o.ry; c.beginPath(); c.moveTo(px, py); c.lineTo(px, py + o.th); c.stroke(); } }
  c.restore();
  // the railing (reference 03, 08: balconies with a thin lit rail on posts), the near ones only
  if ((o.rail ?? !o.glowUnder) && far < 0.5 && o.th >= 10 && o.rx > 60 && o.rx < 1000) {
    const rh = Math.max(9, o.th * 0.85), rail = arc(o.rx, o.ry, -rh), n = Math.max(6, Math.round(((a1 - a0) * o.rx) / 26));
    c.strokeStyle = css(lit, 0.65); c.lineWidth = 1.3;
    for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n), px = o.cx + Math.cos(a) * o.rx, py = o.y + Math.sin(a) * o.ry; c.beginPath(); c.moveTo(px, py); c.lineTo(px, py - rh); c.stroke(); }
    c.fillStyle = css(k.holo, far > 0.2 ? 0.03 : 0.05); c.beginPath(); top.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); for (let i = rail.length - 1; i >= 0; i--) c.lineTo(rail[i]![0], rail[i]![1]); c.closePath(); c.fill(); // the glass between the posts
    c.strokeStyle = css(lit, 0.9); c.lineWidth = 2; c.beginPath(); rail.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.stroke();
  }
  // the lit lip
  c.strokeStyle = css(lit, 0.95); c.lineWidth = Math.max(1.5, o.th * 0.12); c.lineCap = 'round';
  c.beginPath(); top.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.stroke();
  if (o.glowUnder) { c.strokeStyle = css(warm, 0.85); c.lineWidth = Math.max(1.5, o.th * 0.1); c.beginPath(); bot.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.stroke(); }
  // lamps along the face
  if (o.lamps === 'strip') {
    const mid = arc(o.rx, o.ry, o.th * 0.55, a0 + 0.08, a1 - 0.08);
    c.strokeStyle = warm; c.lineWidth = Math.max(2, o.th * 0.28); c.beginPath(); mid.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.stroke();
  } else if (o.lamps) {
    for (let i = 0; i < o.lamps; i++) {
      const a = a0 + (a1 - a0) * ((i + 0.5) / o.lamps), x = o.cx + Math.cos(a) * o.rx, y = o.y + Math.sin(a) * o.ry + o.th * 0.5;
      c.fillStyle = warm; c.fillRect(x - 2.5, y - 2, 5, 4);
    }
  }
}

export interface ArchesOpts {
  x0: number; x1: number;
  /** the deck's top and the ground (or what the piers stand on) */
  y: number; base: number;
  /** number of arches, the deck's thickness */
  n: number; deck?: number;
  far?: number;
  /** lamps on the deck's face (n) */
  lamps?: number;
  /** a rail on the deck */
  rail?: boolean;
  /** a slight arch to the deck (px of sag upward at the middle) */
  rise?: number;
}
/** A viaduct: a deck on a row of arches (the references' bridges). The arch openings are left transparent. */
export function paintArches(c: C2, R: Rig, o: ArchesOpts) {
  const k = R.c, far = o.far ?? 0, deck = o.deck ?? 22, rise = o.rise ?? 0;
  const body = hazeOf(R, k.struct, far), dark = hazeOf(R, k.structDeep, far * 0.8), lit = hazeOf(R, k.structLit, far), warm = hazeOf(R, k.led, far * 0.4);
  const yAt = (x: number) => o.y - rise * Math.sin(Math.PI * clamp((x - o.x0) / (o.x1 - o.x0)));
  const span = (o.x1 - o.x0) / o.n, pier = span * 0.2;
  // the arcade: a band from the deck down to the base, with arch openings cut out
  c.save();
  const band = new Path2D();
  band.moveTo(o.x0, yAt(o.x0)); for (let x = o.x0; x <= o.x1; x += 8) band.lineTo(x, yAt(x)); band.lineTo(o.x1, yAt(o.x1)); band.lineTo(o.x1, o.base); band.lineTo(o.x0, o.base); band.closePath();
  c.fillStyle = body; c.fill(band);
  // the piers' shadow sides
  for (let i = 0; i <= o.n; i++) { const x = o.x0 + i * span; c.fillStyle = css(dark, 0.7); c.fillRect(x - pier / 2, yAt(x) + deck, pier * 0.4, o.base - yAt(x) - deck); }
  c.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < o.n; i++) {
    const xa = o.x0 + i * span + pier / 2, xb = o.x0 + (i + 1) * span - pier / 2, w = xb - xa, top = yAt((xa + xb) / 2) + deck + 6;
    const p = new Path2D(); p.moveTo(xa, o.base + 2); p.lineTo(xa, top + w * 0.5); p.arc((xa + xb) / 2, top + w * 0.5, w / 2, Math.PI, TAU); p.lineTo(xb, o.base + 2); p.closePath();
    c.fill(p);
  }
  c.restore();
  // the arch intrados lit on one side
  for (let i = 0; i < o.n; i++) {
    const xa = o.x0 + i * span + pier / 2, xb = o.x0 + (i + 1) * span - pier / 2, w = xb - xa, top = yAt((xa + xb) / 2) + deck + 6;
    c.strokeStyle = css(lit, 0.55); c.lineWidth = Math.max(1, w * 0.04); c.beginPath(); c.arc((xa + xb) / 2, top + w * 0.5, w / 2 - 1, Math.PI * 1.5, TAU); c.lineTo(xb - 1, o.base); c.stroke();
  }
  // the deck: its face, the lit top edge, its shadow line
  c.fillStyle = mixs(body, lit, 0.25);
  c.beginPath(); c.moveTo(o.x0, yAt(o.x0)); for (let x = o.x0; x <= o.x1; x += 8) c.lineTo(x, yAt(x)); for (let x = o.x1; x >= o.x0; x -= 8) c.lineTo(x, yAt(x) + deck); c.closePath(); c.fill();
  c.strokeStyle = css(lit, 0.95); c.lineWidth = 2; c.beginPath(); for (let x = o.x0; x <= o.x1; x += 8) (x === o.x0 ? c.moveTo(x, yAt(x)) : c.lineTo(x, yAt(x))); c.stroke();
  c.strokeStyle = css(dark, 0.9); c.lineWidth = 3; c.beginPath(); for (let x = o.x0; x <= o.x1; x += 8) (x === o.x0 ? c.moveTo(x, yAt(x) + deck) : c.lineTo(x, yAt(x) + deck)); c.stroke();
  if (o.rail) { c.strokeStyle = css(lit, 0.6); c.lineWidth = 2; c.beginPath(); for (let x = o.x0; x <= o.x1; x += 8) (x === o.x0 ? c.moveTo(x, yAt(x) - 12) : c.lineTo(x, yAt(x) - 12)); c.stroke(); for (let x = o.x0 + 10; x < o.x1; x += 26) c.fillRect(x, yAt(x) - 12, 1.5, 12); }
  if (o.lamps) for (let i = 0; i < o.lamps; i++) { const x = o.x0 + (o.x1 - o.x0) * ((i + 0.5) / o.lamps); c.fillStyle = warm; c.fillRect(x - 3, yAt(x) + deck * 0.4, 6, Math.max(3, deck * 0.25)); }
}

export interface ArchWallOpts {
  /** the wall's extent */
  x: number; y: number; w: number; h: number;
  /** the opening: its left, right, the spring line (where the arch starts) and the bottom */
  ox0: number; ox1: number; spring: number; obottom: number;
  far?: number;
  /** the reveal (the wall's thickness seen inside the opening, on the lit side) */
  reveal?: number;
}
/** A massive dark wall with an arch opening (the opening is transparent: the sky and the far city show through). */
export function paintArchWall(c: C2, R: Rig, o: ArchWallOpts) {
  const k = R.c, far = o.far ?? 0, body = hazeOf(R, k.struct, far), dark = hazeOf(R, k.structDeep, far * 0.8), lit = hazeOf(R, k.structLit, far);
  const w = o.ox1 - o.ox0, r = w / 2, cx = (o.ox0 + o.ox1) / 2;
  const hole = new Path2D(); hole.moveTo(o.ox0, o.obottom); hole.lineTo(o.ox0, o.spring); hole.arc(cx, o.spring, r, Math.PI, TAU); hole.lineTo(o.ox1, o.obottom); hole.closePath();
  c.save();
  c.fillStyle = mixs(body, dark, 0.35); c.fillRect(o.x, o.y, o.w, o.h);
  // pilasters and courses in cel steps
  c.fillStyle = css(dark, 0.8); for (let x = o.x + 20; x < o.x + o.w; x += 120) c.fillRect(x, o.y, 18, o.h);
  c.fillStyle = css(lit, 0.18); for (let y = o.y + 40; y < o.y + o.h; y += 90) c.fillRect(o.x, y, o.w, 3);
  c.globalCompositeOperation = 'destination-out'; c.fill(hole);
  c.restore();
  // the reveal: the wall's thickness on the right-hand inside of the opening, lit
  const rv = o.reveal ?? 18;
  c.fillStyle = mixs(body, lit, 0.45);
  c.beginPath(); c.moveTo(o.ox1, o.obottom); c.lineTo(o.ox1, o.spring); c.arc(cx, o.spring, r, 0, -Math.PI * 0.42, true); c.lineTo(cx + Math.cos(-Math.PI * 0.42) * (r - rv), o.spring + Math.sin(-Math.PI * 0.42) * (r - rv)); c.arc(cx, o.spring, r - rv, -Math.PI * 0.42, 0); c.lineTo(o.ox1 - rv, o.obottom); c.closePath(); c.fill();
  c.strokeStyle = css(lit, 0.9); c.lineWidth = 2.5; c.beginPath(); c.moveTo(o.ox0, o.obottom); c.lineTo(o.ox0, o.spring); c.arc(cx, o.spring, r, Math.PI, Math.PI * 1.5); c.stroke();
}
/** A thin spire on a stepped base (far skylines). */
export function paintSpire(c: C2, R: Rig, x: number, base: number, w: number, h: number, far = 0.5) {
  const k = R.c, body = hazeOf(R, k.struct, far), lit = hazeOf(R, k.structLit, far);
  c.fillStyle = body;
  c.fillRect(x - w / 2, base - h * 0.45, w, h * 0.45);
  c.fillRect(x - w * 0.32, base - h * 0.7, w * 0.64, h * 0.25);
  c.beginPath(); c.moveTo(x - w * 0.18, base - h * 0.7); c.lineTo(x, base - h); c.lineTo(x + w * 0.18, base - h * 0.7); c.fill();
  c.fillStyle = css(lit, 0.6); c.fillRect(x + w / 2 - 2, base - h * 0.45, 2, h * 0.45); c.fillRect(x + w * 0.32 - 2, base - h * 0.7, 2, h * 0.25);
}

// ------------------------------------------------------------------------------------------------------------
// The lit interior
// ------------------------------------------------------------------------------------------------------------
export interface InteriorSpec {
  /** the opening (the cut face), world px */
  x0: number; x1: number; ceiling: number; floor: number;
  /** how deep the room looks: the back wall is inset by this on each side and from the ceiling and floor */
  inset?: number;
  /** the lamp: where its light comes from (the pool on the back wall centres here), its reach */
  lamp: { x: number; y: number; r: number };
  /** the wall's lit, mid and shadow colours (default the rig's warm wall); the corners sink to `deep` */
  lit?: string; mid?: string; shade?: string; deep?: string;
  /** the floor's colour and the ceiling's */
  floorCol?: string; ceilCol?: string;
  /** vertical boards / panels on the back wall (spacing px; 0 none), horizontal ones */
  boards?: number; courses?: number;
  /** a window in the back wall (night or day outside: its glass colour) */
  window?: { x: number; y: number; w: number; h: number; glass?: string; blinds?: boolean } | null;
  seed?: number;
}
export interface InteriorPlanes { back: { x0: number; x1: number; y0: number; y1: number }; floorY: number }
/**
 * A cut-open room in the references' language (the references' cabin): the back wall lit by the lamp in soft steps that fall
 * off into near-dark corners, the ceiling and the side walls as planes a step or two darker, the floor catching the
 * pool, the corners in deep shadow. Paint it in the room's bake, then the furniture on top.
 */
export function paintInterior(c: C2, R: Rig, o: InteriorSpec): InteriorPlanes {
  const k = R.c, ins = o.inset ?? 46, rnd = mulberry32(o.seed ?? 3);
  // (reference 05: the wall in the lamp's pool a warm cream-yellow, honey toward the edges)
  const lit = o.lit ?? mixs(k.wallLit, k.lampLight, 0.38), mid = o.mid ?? mixs(k.wall, k.wallLit, 0.3), shade = o.shade ?? k.wallShade, deep = o.deep ?? mixs(k.woodDark, k.rackGroove, 0.45);
  const bx0 = o.x0 + ins, bx1 = o.x1 - ins, by0 = o.ceiling + ins * 0.8, by1 = o.floor - ins * 0.55;
  // the back wall: the lamp's pool, falling off in soft steps to the corners
  // (the pool reaches wider than before: reference 05's room is lit wall to wall, dark only in its corners)
  c.fillStyle = rgrad(c, o.lamp.x, o.lamp.y, o.lamp.r, [[0, lit], [0.36, mixs(lit, mid, 0.55)], [0.62, mixs(mid, shade, 0.6)], [0.84, mixs(shade, deep, 0.5)], [1, mixs(shade, deep, 0.88)]]);
  c.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
  c.save(); c.beginPath(); c.rect(bx0, by0, bx1 - bx0, by1 - by0); c.clip();
  if (o.boards) { c.strokeStyle = css(deep, 0.22); c.lineWidth = 2; for (let x = bx0 + o.boards * 0.5; x < bx1; x += o.boards * (0.9 + 0.2 * rnd())) { c.beginPath(); c.moveTo(x, by0); c.lineTo(x, by1); c.stroke(); } }
  if (o.courses) { c.strokeStyle = css(deep, 0.18); c.lineWidth = 2; for (let y = by0 + o.courses; y < by1; y += o.courses) { c.beginPath(); c.moveTo(bx0, y); c.lineTo(bx1, y); c.stroke(); } }
  c.restore();
  if (o.window) {
    const W = o.window;
    c.fillStyle = deep; c.fillRect(W.x - 10, W.y - 10, W.w + 20, W.h + 20);
    c.fillStyle = W.glass ?? mixs(k.skyTop, k.skyMid, 0.5); c.fillRect(W.x, W.y, W.w, W.h);
    if (W.blinds) { c.fillStyle = css(mixs(k.paper, mid, 0.45), 0.85); for (let y = W.y; y < W.y + W.h * 0.42; y += 12) c.fillRect(W.x, y, W.w, 8); }
    c.fillStyle = deep; c.fillRect(W.x + W.w / 2 - 3, W.y, 6, W.h);
    c.fillStyle = css(lit, 0.35); c.fillRect(W.x - 10, W.y + W.h + 6, W.w + 20, 4);
  }
  // the ceiling plane (darker, a little light on its front edge from the lamp below)
  const ceil = o.ceilCol ?? mixs(shade, deep, 0.55);
  c.fillStyle = lgrad(c, 0, o.ceiling, 0, by0, [[0, mixs(ceil, deep, 0.5)], [1, ceil]]);
  c.beginPath(); c.moveTo(o.x0, o.ceiling); c.lineTo(o.x1, o.ceiling); c.lineTo(bx1, by0); c.lineTo(bx0, by0); c.closePath(); c.fill();
  c.strokeStyle = css(deep, 0.5); c.lineWidth = 2; for (let i = 1; i < 8; i++) { const u = i / 8; c.beginPath(); c.moveTo(lerp(o.x0, o.x1, u), o.ceiling); c.lineTo(lerp(bx0, bx1, u), by0); c.stroke(); }
  // the side walls (in shadow; the one away from the lamp darker)
  const sideL = mixs(shade, deep, o.lamp.x > (o.x0 + o.x1) / 2 ? 0.75 : 0.5), sideR = mixs(shade, deep, o.lamp.x > (o.x0 + o.x1) / 2 ? 0.45 : 0.75);
  c.fillStyle = sideL; c.beginPath(); c.moveTo(o.x0, o.ceiling); c.lineTo(bx0, by0); c.lineTo(bx0, by1); c.lineTo(o.x0, o.floor); c.closePath(); c.fill();
  c.fillStyle = sideR; c.beginPath(); c.moveTo(o.x1, o.ceiling); c.lineTo(bx1, by0); c.lineTo(bx1, by1); c.lineTo(o.x1, o.floor); c.closePath(); c.fill();
  // the floor: lit under the lamp, darker toward the cut and the sides
  const fl = o.floorCol ?? k.floor;
  c.fillStyle = rgrad(c, o.lamp.x, by1, (o.x1 - o.x0) * 0.55, [[0, mixs(fl, lit, 0.2)], [0.5, fl], [1, mixs(fl, deep, 0.7)]]);
  c.beginPath(); c.moveTo(bx0, by1); c.lineTo(bx1, by1); c.lineTo(o.x1, o.floor); c.lineTo(o.x0, o.floor); c.closePath(); c.fill();
  c.strokeStyle = css(deep, 0.3); c.lineWidth = 2; for (let i = 1; i < 10; i++) { const u = i / 10; c.beginPath(); c.moveTo(lerp(bx0, bx1, u), by1); c.lineTo(lerp(o.x0, o.x1, u), o.floor); c.stroke(); }
  // the polished floor's simplified reflection (reference 01/02): the lamp's pool mirrored as a soft streak, the back
  // wall's skirting as a thin dark band
  { const fy0 = by1, fy1 = o.floor, rx = Math.min((o.x1 - o.x0) * 0.22, o.lamp.r * 0.5);
    c.save(); c.beginPath(); c.moveTo(bx0, fy0); c.lineTo(bx1, fy0); c.lineTo(o.x1, fy1); c.lineTo(o.x0, fy1); c.closePath(); c.clip();
    c.fillStyle = lgrad(c, 0, fy0, 0, fy1, [[0, css(lit, 0.3)], [1, css(lit, 0.04)]]); c.beginPath(); c.ellipse(o.lamp.x, (fy0 + fy1) / 2, rx, (fy1 - fy0) * 0.6, 0, 0, TAU); c.fill();
    c.fillStyle = css(k.lampLight, 0.12); c.fillRect(o.lamp.x - rx * 0.12, fy0, rx * 0.24, fy1 - fy0);
    c.restore(); }
  c.fillStyle = css(deep, 0.55); c.fillRect(bx0, by1 - 10, bx1 - bx0, 10);
  c.fillStyle = css(lit, 0.25); c.fillRect(bx0, by1 - 10, bx1 - bx0, 1.5);
  // the corner seams (crevices)
  c.strokeStyle = css(deep, 0.85); c.lineWidth = 3;
  c.beginPath(); c.moveTo(bx0, by0); c.lineTo(bx0, by1); c.lineTo(bx1, by1); c.lineTo(bx1, by0); c.lineTo(bx0, by0); c.stroke();
  return { back: { x0: bx0, x1: bx1, y0: by0, y1: by1 }, floorY: by1 };
}
/** The thick cut edge of a slab (a floor or a roof in cross-section): its face lit by the room on the inside edge. */
export function paintSlabEdge(c: C2, R: Rig, x0: number, x1: number, y: number, th: number, o: { col?: string; litTop?: boolean; litBottom?: boolean } = {}) {
  const k = R.c, col = o.col ?? k.woodDark;
  c.fillStyle = col; c.fillRect(x0, y, x1 - x0, th);
  c.fillStyle = css(k.rackGroove, 0.5); c.fillRect(x0, y + th * 0.7, x1 - x0, th * 0.3);
  if (o.litTop) { c.fillStyle = css(k.lampLight, 0.35); c.fillRect(x0, y, x1 - x0, 2.5); }
  if (o.litBottom) { c.fillStyle = css(k.warmLight, 0.45); c.fillRect(x0, y + th - 3, x1 - x0, 3); }
}

// ------------------------------------------------------------------------------------------------------------
// The machine kit
// ------------------------------------------------------------------------------------------------------------
/** A wooden crate seen three-quarter (front, top, side), origin its bottom-left front corner. */
export function paintCrate(c: C2, R: Rig, w: number, h: number, o: { d?: number; col?: string } = {}) {
  const k = R.c, d = o.d ?? w * 0.3, col = o.col ?? k.wood, dark = mixs(col, k.woodDark, 0.6), lit = mixs(col, k.beamLit, 0.5);
  // the front: soft light across the boards (lit at the left), a contact shadow; the top lit; the side in shadow
  c.fillStyle = css(k.rackGroove, 0.3); c.fill(ell(w * 0.55 + d * 0.3, 1, w * 0.62, Math.max(3, h * 0.05)));
  c.fillStyle = lgrad(c, 0, 0, w, 0, [[0, mixs(col, lit, 0.35)], [0.6, col], [1, mixs(col, dark, 0.25)]]); c.fillRect(0, -h, w, h);
  c.fillStyle = lit; c.beginPath(); c.moveTo(0, -h); c.lineTo(d * 0.6, -h - d * 0.45); c.lineTo(w + d * 0.6, -h - d * 0.45); c.lineTo(w, -h); c.closePath(); c.fill();
  c.fillStyle = lgrad(c, w, 0, w + d * 0.6, 0, [[0, dark], [1, mixs(dark, k.woodDark, 0.4)]]); c.beginPath(); c.moveTo(w, -h); c.lineTo(w + d * 0.6, -h - d * 0.45); c.lineTo(w + d * 0.6, -d * 0.45); c.lineTo(w, 0); c.closePath(); c.fill();
  // the boards' seams and grain, the frame and its brace, nail heads
  c.strokeStyle = css(k.woodDark, 0.3); c.lineWidth = 1;
  for (let i = 1; i < 5; i++) { const y = -h + (h * i) / 5; c.beginPath(); c.moveTo(w * 0.04, y); c.lineTo(w * 0.96, y); c.stroke(); }
  c.strokeStyle = css(k.woodDark, 0.8); c.lineWidth = Math.max(2, w * 0.03);
  c.strokeRect(w * 0.04, -h + h * 0.04, w * 0.92, h * 0.92);
  c.beginPath(); c.moveTo(w * 0.06, -h * 0.06); c.lineTo(w * 0.94, -h * 0.94); c.stroke();
  for (let i = 1; i < 3; i++) { c.beginPath(); c.moveTo(0, -h * i / 3); c.lineTo(w, -h * i / 3); c.stroke(); }
  c.strokeStyle = css(lit, 0.6); c.lineWidth = Math.max(1, w * 0.012); c.beginPath(); c.moveTo(w * 0.05, -h + h * 0.05); c.lineTo(w * 0.95, -h + h * 0.05); c.stroke();
  c.fillStyle = css(k.metalLit, 0.7); for (const [nx, ny] of [[0.08, 0.08], [0.92, 0.08], [0.08, 0.92], [0.92, 0.92]] as const) c.fill(ell(w * nx, -h + h * ny, Math.max(1, w * 0.012), Math.max(1, w * 0.012)));
}
/** A conveyor belt on legs, origin its left end's top; w long. The belt's moving dashes: conveyorDashes (live). */
export function paintConveyor(c: C2, R: Rig, w: number, o: { h?: number } = {}) {
  const k = R.c, h = o.h ?? 120, frame = k.metal, dark = mixs(k.metal, k.rackGroove, 0.6), lit = k.metalLit;
  c.fillStyle = dark; for (const x of [w * 0.08, w * 0.5, w * 0.92]) c.fillRect(x - 6, 22, 12, h - 22);
  c.fillStyle = dark; c.fillRect(w * 0.08, h * 0.7, w * 0.84, 8);
  c.fillStyle = mixs(k.device, k.rackGroove, 0.3); c.fill(rr(0, 0, w, 22, 11));
  c.fillStyle = frame; c.fillRect(0, 14, w, 12);
  c.fillStyle = css(lit, 0.8); c.fillRect(0, 14, w, 2);
  for (let x = 11; x < w; x += 44) { c.fillStyle = dark; c.fill(ell(x, 20, 7, 7)); c.fillStyle = css(lit, 0.6); c.fill(ell(x - 1.5, 18.5, 2.5, 2.5)); }
}
/** The belt's dashes, moving at `speed` px/s (live draw), along a conveyor painted at (x, y) with width w. */
export function conveyorDashes(st: Stage, R: Rig, x: number, y: number, w: number, t: number, o: DrawOpts & { speed?: number; k?: number } = {}) {
  const sp = o.speed ?? 60, off = ((t * sp) % 40 + 40) % 40;
  for (let s = off; s < w - 8; s += 40) st.rect(x + s + 8, y + 3, 14, 3, R.c.metalLit, { ...o, alpha: (o.alpha ?? 1) * 0.5 * (o.k ?? 1) });
}
/** A press frame (two columns, a crown, a bed), origin its bottom centre; the ram: paintPressRam. */
export function paintPress(c: C2, R: Rig, w: number, h: number, o: { col?: string } = {}) {
  const k = R.c, col = o.col ?? k.metal, dark = mixs(col, k.rackGroove, 0.55), lit = k.metalLit;
  // (reference 06's graphite machinery: soft volume on every column, bolts, a narrow highlight where the light falls)
  for (const x0 of [-w / 2, w / 2 - w * 0.14]) {
    c.fillStyle = lgrad(c, x0, 0, x0 + w * 0.14, 0, [[0, mixs(dark, col, 0.3)], [0.45, dark], [1, mixs(dark, k.rackGroove, 0.35)]]); c.fillRect(x0, -h, w * 0.14, h);
    c.fillStyle = css(lit, 0.18); c.fillRect(x0 + w * 0.02, -h, w * 0.015, h);
  }
  c.fillStyle = col; c.fillRect(-w / 2 + w * 0.04, -h, w * 0.06, h); c.fillRect(w / 2 - w * 0.1, -h, w * 0.06, h);
  c.fillStyle = lgrad(c, 0, -h - 40, 0, -h + 8, [[0, mixs(col, lit, 0.3)], [0.4, col], [1, mixs(col, dark, 0.45)]]); c.fill(rr(-w / 2 - 10, -h - 40, w + 20, 48, 6));
  c.fillStyle = css(lit, 0.8); c.fillRect(-w / 2 - 10, -h - 40, w + 20, 3);
  c.fillStyle = css(dark, 0.9); for (let i = 0; i < 6; i++) { const bx = -w / 2 + (w * (i + 0.5)) / 6; c.fill(ell(bx, -h - 16, 4, 4)); c.fillStyle = css(lit, 0.6); c.fill(ell(bx - 1, -h - 17, 1.5, 1.5)); c.fillStyle = css(dark, 0.9); }
  c.fillStyle = lgrad(c, 0, -34, 0, 0, [[0, mixs(dark, col, 0.25)], [1, dark]]); c.fill(rr(-w / 2 - 14, -34, w + 28, 34, 4));
  c.fillStyle = css(lit, 0.5); c.fillRect(-w / 2 - 14, -34, w + 28, 2);
  c.fillStyle = css(k.led, 0.25); c.fill(ell(w / 2 - w * 0.07, -h + 30, 11, 11));
  c.fillStyle = k.led; c.fill(ell(w / 2 - w * 0.07, -h + 30, 5, 5));
}
/** The press's ram (a heavy block on a rod), origin its bottom centre. */
export function paintPressRam(c: C2, R: Rig, w: number, o: { col?: string } = {}) {
  const k = R.c, col = o.col ?? k.metal;
  c.fillStyle = mixs(col, k.rackGroove, 0.4); c.fillRect(-w * 0.08, -260, w * 0.16, 200);
  c.fillStyle = col; c.fill(rr(-w / 2, -64, w, 64, 6));
  c.fillStyle = css(k.metalLit, 0.7); c.fillRect(-w / 2, -64, w, 3);
  c.fillStyle = css(k.rackGroove, 0.5); c.fillRect(-w / 2, -12, w, 12);
}
/** Shelves of molds (rounded trays with a shape pressed in them), origin top-left; n rows. */
export function paintMoldShelf(c: C2, R: Rig, w: number, h: number, o: { rows?: number; seed?: number } = {}) {
  const k = R.c, rows = o.rows ?? 3, rnd = mulberry32(o.seed ?? 5), rh = h / rows;
  c.fillStyle = mixs(k.woodDark, k.rackGroove, 0.3); c.fillRect(0, 0, w, h);
  for (let r = 0; r < rows; r++) {
    const y = r * rh;
    c.fillStyle = k.wood; c.fillRect(0, y + rh - 10, w, 10);
    c.fillStyle = css(k.beamLit, 0.6); c.fillRect(0, y + rh - 10, w, 2);
    for (let x = 10; x < w - 60; x += 70 + rnd() * 10) {
      const mw = 56, mh = rh * 0.5, my = y + rh - 10 - mh;
      c.fillStyle = mixs(k.metal, k.metalLit, 0.25); c.fill(rr(x, my, mw, mh, 8));
      c.fillStyle = mixs(k.metal, k.rackGroove, 0.5);
      const s = Math.floor(rnd() * 3);
      if (s === 0) c.fill(ell(x + mw / 2, my + mh / 2, mw * 0.28, mh * 0.28));
      else if (s === 1) c.fill(rr(x + mw * 0.25, my + mh * 0.25, mw * 0.5, mh * 0.5, 3));
      else { c.beginPath(); c.moveTo(x + mw / 2, my + mh * 0.18); c.lineTo(x + mw * 0.78, my + mh * 0.8); c.lineTo(x + mw * 0.22, my + mh * 0.8); c.fill(); }
    }
  }
}
/** A cog of radius r with n teeth, origin its centre (spin it live: st.sprite(art, x, y, { rot: t * w })). */
export function paintGear(c: C2, R: Rig, r: number, o: { n?: number; col?: string } = {}) {
  const k = R.c, n = o.n ?? 12, col = o.col ?? k.metal;
  const p = new Path2D();
  for (let i = 0; i < n * 2; i++) { const a0 = (i / (n * 2)) * TAU, a1 = ((i + 1) / (n * 2)) * TAU, rr2 = i % 2 ? r : r * 0.84; p.arc(0, 0, rr2, a0, a1); }
  p.closePath();
  c.fillStyle = col; c.fill(p);
  c.fillStyle = mixs(col, k.rackGroove, 0.45); c.fill(ell(0, 0, r * 0.62, r * 0.62));
  c.fillStyle = col; c.fill(ell(0, 0, r * 0.5, r * 0.5));
  c.fillStyle = mixs(col, k.rackGroove, 0.6); c.fill(ell(0, 0, r * 0.16, r * 0.16));
  c.strokeStyle = css(k.metalLit, 0.7); c.lineWidth = Math.max(1.5, r * 0.04); c.beginPath(); c.arc(0, 0, r * 0.5, -2.4, -0.6); c.stroke();
  void smooth;
}
