// Single-stroke (engraving/plotter) fonts: EMS/Hershey SVG fonts rendered as polylines,
// so text can be *written* progressively by a moving point (a pen). The fonts carry no kerning
// and no curly quotes: pairs are kerned optically (see `pairKern`) and ’ ‘ “ ” … are built from their
// own ' and . glyphs. They cover ASCII and Latin-1; the other Latin letters are composed from a base
// letter and drawn accents (see `addAccents`).
import { type V2, polylineLengths } from './util';

export const STROKE_FONTS = {
  script: 'EMSAllure.svg', // flowing cursive
  hscript: 'HersheyScript1.svg', // classic Hershey script
  sans: 'HersheySans1.svg', // plotter sans
  readable: 'EMSReadability.svg', // clean single-line sans
  tech: 'EMSTech.svg', // technical lettering
  serif: 'HersheySerifMed.svg',
  osmotron: 'EMSOsmotron.svg', // geometric/techno
  felix: 'EMSFelix.svg', // brushy
} as const;
export type StrokeFontName = keyof typeof STROKE_FONTS;

/** Connected scripts: kerning would break the joins between letters. */
const SCRIPTS = new Set<StrokeFontName>(['script', 'hscript']);

interface SGlyph { adv: number; strokes: V2[][] }
interface SFont {
  upm: number; ascent: number; descent: number; xh: number; cap: number; glyphs: Map<string, SGlyph>; missingAdv: number;
  /** Measured from the outlines (the files' x-height / cap-height attributes are placeholders). */
  base: number; xTop: number; capTop: number;
  /** Profile bands: [yLo, yLo + ROWS*dy] covers every glyph's ink. */
  yLo: number; dy: number;
  prof: Map<string, Profile | null>; kern: Map<string, number>; target: { lc: number; uc: number } | null;
  /** Each glyph's strokes in a hand's order (see penOrder), made when first written; null for the connected scripts. */
  pen: Map<string, V2[][]> | null;
}
const fonts = new Map<StrokeFontName, SFont>();

export async function loadStrokeFonts() {
  await Promise.all(
    (Object.keys(STROKE_FONTS) as StrokeFontName[]).map(async (k) => {
      const r = await fetch(`${import.meta.env.BASE_URL}fonts/stroke/${STROKE_FONTS[k]}`);
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('svg')) throw new Error(`stroke font missing: public/fonts/stroke/${STROKE_FONTS[k]}`);
      const f = parseSvgFont(await r.text());
      addTypographic(f);
      addAccents(f);
      f.pen = SCRIPTS.has(k) ? null : new Map();
      fonts.set(k, f);
    }),
  );
}

const inkBox = (strokes: V2[][]) => {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of strokes) for (const p of s) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  return { x0, x1, y0, y1 };
};
const moved = (g: SGlyph, dx: number, dy = 0): V2[][] => g.strokes.map((s) => s.map((p) => ({ x: p.x + dx, y: p.y + dy })));

type Box = ReturnType<typeof inkBox>;
const cp = (n: number) => String.fromCodePoint(n);
// the combining marks, by code point
const ACUTE = cp(0x301), GRAVE = cp(0x300), CIRCUMFLEX = cp(0x302), TILDE = cp(0x303), MACRON = cp(0x304), BREVE = cp(0x306);
const DOT = cp(0x307), DIAERESIS = cp(0x308), RING = cp(0x30a), DOUBLE_ACUTE = cp(0x30b), CARON = cp(0x30c), CEDILLA = cp(0x327), OGONEK = cp(0x328);
/** Latin-1 letters that lend their mark (á minus a is the font's own acute), lowercase and capital. */
const LENDERS: Record<string, [string, string]> = {
  [ACUTE]: ['á', 'Á'], [GRAVE]: ['à', 'À'], [CIRCUMFLEX]: ['â', 'Â'], [TILDE]: ['ã', 'Ã'],
  [DIAERESIS]: ['ä', 'Ä'], [RING]: ['å', 'Å'], [CEDILLA]: ['ç', 'Ç'],
};
const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 10) =>
  Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; });
const diamond = (x: number, y: number, r = 0.03) => [[x - r, y], [x, y - r], [x + r, y], [x, y + r], [x - r, y]];
/**
 * Drawn marks, in em units, for what a font has no letter to lend: x from the centre of the base's ink
 * (from its right edge for the ogonek), y up from the mark's own bottom (marks above) or from the ink's
 * bottom (marks below).
 */
const DRAWN: Record<string, number[][][]> = {
  [ACUTE]: [[[-0.055, 0], [0.065, 0.11]]],
  [GRAVE]: [[[0.055, 0], [-0.065, 0.11]]],
  [CIRCUMFLEX]: [[[-0.1, 0], [0, 0.095], [0.1, 0]]],
  [TILDE]: [[[-0.12, 0.015], [-0.06, 0.055], [0, 0.035], [0.06, 0.015], [0.12, 0.055]]],
  [DIAERESIS]: [diamond(-0.12, 0.03), diamond(0.12, 0.03)],
  [DOT]: [diamond(0, 0.03)],
  [CARON]: [[[-0.1, 0.095], [0, 0], [0.1, 0.095]]],
  [DOUBLE_ACUTE]: [[[-0.1, 0], [-0.03, 0.11]], [[0.03, 0], [0.1, 0.11]]],
  [RING]: [arc(0, 0.05, 0.05, 0.05, 0, 2 * Math.PI, 14)],
  [MACRON]: [[[-0.11, 0.02], [0.11, 0.02]]],
  [BREVE]: [arc(0, 0.08, 0.09, 0.07, Math.PI, 2 * Math.PI)],
  [CEDILLA]: [[[0, 0], [-0.035, -0.055], [0.04, -0.08], [0.03, -0.13], [-0.045, -0.15]]],
  [OGONEK]: [[[-0.03, 0], [-0.075, -0.06], [-0.05, -0.115], [0, -0.12]]],
};
const BELOW = new Set([CEDILLA, OGONEK]);

/** A mark in font units: strokes relative to the base's centre (marks above: to their own bottom; below: to the base's bottom). */
interface MarkShape { strokes: V2[][]; below: boolean; right?: boolean; gap: number; h: number }

/**
 * The bundled plotter fonts cover ASCII and Latin-1 (á, ç, ñ, ø, ß ...). Every other Latin letter that
 * decomposes into a base letter and acute, grave, circumflex, tilde, diaeresis, ring, macron, breve, caron,
 * dot above, double acute, cedilla or ogonek (ā ă ą ć č ď ě ę ğ ń ň ő ř ś ş š ţ ů ű ź ż ž ǘ ...) is composed
 * from the font's own base letter and marks: each mark is taken from a Latin-1 letter of the same font
 * (á minus a), so it has the font's shape and height (capitals take theirs from Á, Ä ... above the cap
 * height); caron, dot above and double acute are made from the circumflex, diaeresis and acute; macron,
 * breve and ogonek, which no Latin-1 letter has, are drawn. ď ť ľ Ľ take their caron as a small apostrophe
 * after the stem, ł Ł đ Đ get a stroke through the base, and i and j drop their dot under a mark (ı and ȷ too). What can't be composed (æ, œ, ŀ when a font lacks
 * them) stays missing: drawn as an empty advance, never an error.
 */
function addAccents(f: SFont) {
  const G = f.glyphs, u = f.upm;
  // (i and j lose their dot under a mark above, as in every text face)
  const undotted = (base: string, strokes: V2[][]) => (base === 'i' || base === 'j' ? strokes.filter((s) => s.some((p) => p.y < f.xTop + u * 0.04)) : strokes);
  const sig = (s: V2[]) => s.map((p) => `${p.x},${p.y}`).join(';');
  const toShape = (strokes: V2[][], below: boolean, ox: number, oy: number, gap: number): MarkShape => {
    const s = strokes.map((st) => st.map((p) => ({ x: p.x - ox, y: p.y - oy })));
    const b = inkBox(s);
    return { strokes: s, below, gap, h: below ? -b.y0 : b.y1 };
  };
  /** The mark of a Latin-1 letter: its strokes that its base letter doesn't have (null if they aren't a separate mark). */
  const lend = (letter: string, below: boolean): MarkShape | null => {
    const r = G.get(letter), base = G.get(letter.normalize('NFD')[0]!);
    if (!r || !base?.strokes.length) return null;
    const have = new Set(base.strokes.map(sig));
    const extra = r.strokes.filter((s) => !have.has(sig(s)));
    if (!extra.length || extra.length === r.strokes.length) return null;
    const bb = inkBox(base.strokes), mb = inkBox(extra), cx = (bb.x0 + bb.x1) / 2;
    if (below ? mb.y1 > bb.y0 + u * 0.05 : mb.y0 < bb.y1 - u * 0.02) return null;
    return below ? toShape(extra, true, cx, bb.y0, 0) : toShape(extra, false, cx, mb.y0, mb.y0 - bb.y1);
  };
  const cache = new Map<string, MarkShape | null>();
  const shape = (m: string, upper: boolean): MarkShape | null => {
    const key = m + (upper ? 'U' : 'l');
    if (cache.has(key)) return cache.get(key)!;
    let s: MarkShape | null = LENDERS[m] ? lend(LENDERS[m]![upper ? 1 : 0], BELOW.has(m)) : null;
    if (!s && m === CARON) {
      const c = shape(CIRCUMFLEX, upper); // the circumflex upside down
      if (c) s = { ...c, strokes: c.strokes.map((st) => st.map((p) => ({ x: p.x, y: c.h - p.y }))) };
    } else if (!s && m === DOT) {
      const d = shape(DIAERESIS, upper); // one of the diaeresis' dots, centred
      if (d) {
        const all = inkBox(d.strokes), mid = (all.x0 + all.x1) / 2;
        const left = d.strokes.filter((st) => { const b = inkBox([st]); return (b.x0 + b.x1) / 2 < mid; });
        const lb = inkBox(left), dx = mid - (lb.x0 + lb.x1) / 2;
        if (left.length && left.length < d.strokes.length) s = { ...d, strokes: left.map((st) => st.map((p) => ({ x: p.x + dx, y: p.y }))) };
      }
    } else if (!s && m === DOUBLE_ACUTE) {
      const a = shape(ACUTE, upper); // two acutes side by side
      if (a) {
        const b = inkBox(a.strokes), c = (b.x0 + b.x1) / 2, off = Math.max(u * 0.05, (b.x1 - b.x0) * 0.6);
        s = { ...a, strokes: [-off, off].flatMap((o) => a.strokes.map((st) => st.map((p) => ({ x: p.x - c + o, y: p.y })))) };
      }
    }
    if (!s && DRAWN[m]) {
      // drawn, at the gap the font's own acute keeps over its base
      const below = BELOW.has(m), acute = m === ACUTE ? null : shape(ACUTE, upper);
      const strokes = DRAWN[m]!.map((st) => st.map(([x, y]) => ({ x: x! * u, y: y! * u })));
      s = { ...toShape(strokes, below, 0, 0, acute?.gap ?? u * (upper ? 0.06 : 0.07)), right: m === OGONEK };
    }
    cache.set(key, s);
    return s;
  };
  const quote = G.get('’') ?? G.get("'");
  const compose = (ch: string) => {
    if (G.has(ch)) return;
    const [base, ...marks] = Array.from(ch.normalize('NFD'));
    if (!base || !marks.length) return;
    const g = G.get(base);
    if (!g?.strokes.length) return;
    // ď ť ľ Ľ: on a letter with an ascender the caron is a small apostrophe after the stem (Czech, Slovak)
    if (marks.length === 1 && marks[0] === CARON && 'dtlL'.includes(base) && quote?.strokes.length) {
      const b = inkBox(g.strokes), q = inkBox(quote.strokes), dx = b.x1 + u * 0.04 - q.x0, dy = b.y1 + u * 0.02 - q.y1;
      G.set(ch, { adv: g.adv + (q.x1 - q.x0 + u * 0.04) * 0.6, strokes: [...g.strokes, ...moved(quote, dx, dy)] });
      return;
    }
    const upper = base !== base.toLowerCase();
    const shapes = marks.map((m) => shape(m, upper));
    if (shapes.some((s) => !s)) return;
    const strokes = shapes.some((s) => !s!.below) ? undotted(base, g.strokes) : g.strokes;
    const b = inkBox(strokes), cx = (b.x0 + b.x1) / 2;
    const out = [...strokes];
    let top = b.y1, stacked = false;
    for (const s of shapes as MarkShape[]) {
      if (s.below) { out.push(...s.strokes.map((st) => st.map((p) => ({ x: (s.right ? b.x1 : cx) + p.x, y: b.y0 + p.y })))); continue; }
      // (a second mark above the first sits closer than the first does to the letter)
      const y0 = top + (stacked ? Math.min(s.gap, u * 0.05) : s.gap);
      out.push(...s.strokes.map((st) => st.map((p) => ({ x: cx + p.x, y: y0 + p.y }))));
      top = y0 + s.h;
      stacked = true;
    }
    G.set(ch, { adv: g.adv, strokes: out });
  };
  for (const [a, z] of [[0xc0, 0x24f], [0x1e00, 0x1eff]] as const) for (let c = a; c <= z; c++) compose(String.fromCodePoint(c));
  // letters with a stroke through them (they don't decompose)
  const through = (ch: string, base: string, line: (b: Box) => number[][]) => {
    const g = G.get(base);
    if (G.has(ch) || !g?.strokes.length) return;
    G.set(ch, { adv: g.adv, strokes: [...g.strokes, line(inkBox(g.strokes)).map(([x, y]) => ({ x: x!, y: y! }))] });
  };
  const slashed = (b: Box) => [[b.x0 - u * 0.02, b.y0 - u * 0.03], [b.x1 + u * 0.02, b.y1 + u * 0.03]];
  through('ø', 'o', slashed);
  through('Ø', 'O', slashed);
  through('ł', 'l', (b) => { const x = (b.x0 + b.x1) / 2, y = b.y0 + (b.y1 - b.y0) * 0.45; return [[x - u * 0.09, y - u * 0.05], [x + u * 0.09, y + u * 0.05]]; });
  through('Ł', 'L', (b) => { const y = b.y0 + (b.y1 - b.y0) * 0.42; return [[b.x0 - u * 0.07, y - u * 0.05], [b.x0 + u * 0.13, y + u * 0.06]]; });
  through('đ', 'd', (b) => { const y = f.xTop + (b.y1 - f.xTop) * 0.55; return [[b.x1 - u * 0.13, y], [b.x1 + u * 0.05, y]]; });
  if (!G.has('Đ') && G.has('Ð')) G.set('Đ', G.get('Ð')!); // (the same letter shape)
  through('Đ', 'D', (b) => { const y = (b.y0 + b.y1) / 2; return [[b.x0 - u * 0.06, y], [b.x0 + u * 0.14, y]]; });
  for (const [ch, base] of [['ı', 'i'], ['ȷ', 'j']] as const) {
    const g = G.get(base);
    if (!G.has(ch) && g?.strokes.length) G.set(ch, { adv: g.adv, strokes: undotted(base, g.strokes) });
  }
  // the ink now reaches higher and lower (stacked accents, cedillas): the kerning profiles cover it
  const bounds = inkBox([...G.values()].flatMap((g) => g.strokes));
  f.yLo = bounds.y0; f.dy = (bounds.y1 - bounds.y0 + 1) / ROWS;
}

/** Curly quotes and the ellipsis, built from the font's own ' and . (in Hershey the ' is already comma-shaped). */
function addTypographic(f: SFont) {
  const G = f.glyphs, q = G.get("'"), dot = G.get('.');
  if (q && q.strokes.length) {
    const b = inkBox(q.strokes), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const turned: SGlyph = { adv: q.adv, strokes: q.strokes.map((s) => s.map((p) => ({ x: 2 * cx - p.x, y: 2 * cy - p.y }))) };
    const dbl = (g: SGlyph): SGlyph => {
      const off = b.x1 - b.x0 + 0.07 * f.upm;
      return { adv: g.adv + off, strokes: [...g.strokes, ...moved(g, off)] };
    };
    if (!G.has('\u2019')) G.set('\u2019', q);
    if (!G.has('\u2018')) G.set('\u2018', turned);
    if (!G.has('\u201D')) G.set('\u201D', dbl(q));
    if (!G.has('\u201C')) G.set('\u201C', dbl(turned));
  }
  if (dot && !G.has('…')) {
    const step = dot.adv * 0.72;
    G.set('…', { adv: dot.adv + 2 * step, strokes: [...dot.strokes, ...moved(dot, step), ...moved(dot, 2 * step)] });
  }
}

// ------------------------------------------------------------------ optical kerning
// The fonts' sidebearings already space plain pairs (nn, oo, ...); what they lack is kerning for shapes
// that leave a hole — overhangs and diagonals (To, Yo, We, AV, LT, r., ...). For those pairs, the ink is
// reduced to left/right profiles (extreme x per horizontal band, widened steeply so a T's arm shades
// the bands under it) and the right glyph moves in until the closest approach over the zone both
// letters share (x-height for lowercase, cap height otherwise) comes most of the way to the font's own
// n/o pairs.
const ROWS = 90; // bands over the glyphs' vertical extent
const SHADE = 0.4; // ink d units above/below a band counts as SHADE*d further out in it
/** Glyphs whose right side overhangs or slants (they can kern with what follows). */
const OPEN_R = new Set('AFLPTVWYKXfrvwyk7\'"\u2019\u201D'.split(''));
/** Glyphs whose left side slants or tucks under (they can kern with what precedes). */
const OPEN_L = new Set('AJTVWYXvwyj.,\'"\u2019\u201D\u2026'.split(''));
const CLEAR = 0.1; // em: the inks never come closer than this (measured at 45°, so diagonals count)
/** Only part of the way: equal closest approach would pack diagonals and rounds tighter than the eye wants. */
const STRENGTH = 0.6;
interface Profile { l: Float32Array; r: Float32Array; l45: Float32Array; r45: Float32Array } // NaN where no ink

function profile(f: SFont, ch: string): Profile | null {
  if (f.prof.has(ch)) return f.prof.get(ch)!;
  const g = f.glyphs.get(ch);
  let p: Profile | null = null;
  if (g && g.strokes.length) {
    const l = new Float32Array(ROWS).fill(NaN), r = new Float32Array(ROWS).fill(NaN);
    const put = (x: number, y: number) => {
      const i = Math.floor((y - f.yLo) / f.dy);
      if (i < 0 || i >= ROWS) return;
      if (!(l[i]! <= x)) l[i] = x;
      if (!(r[i]! >= x)) r[i] = x;
    };
    for (const s of g.strokes) {
      if (s.length === 1) put(s[0]!.x, s[0]!.y);
      for (let k = 1; k < s.length; k++) {
        const a = s[k - 1]!, b = s[k]!;
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (f.dy * 0.35)));
        for (let j = 0; j <= n; j++) put(a.x + ((b.x - a.x) * j) / n, a.y + ((b.y - a.y) * j) / n);
      }
    }
    // widen: a band sees the ink of its neighbours, set back in proportion to their vertical distance
    const widen = (k: number) => {
      const lw = new Float32Array(ROWS).fill(NaN), rw = new Float32Array(ROWS).fill(NaN);
      for (let i = 0; i < ROWS; i++) {
        for (let j = 0; j < ROWS; j++) {
          const d = Math.abs(i - j) * f.dy * k;
          if (!Number.isNaN(l[j]!) && !(lw[i]! <= l[j]! + d)) lw[i] = l[j]! + d;
          if (!Number.isNaN(r[j]!) && !(rw[i]! >= r[j]! - d)) rw[i] = r[j]! - d;
        }
      }
      return [lw, rw] as const;
    };
    const [lw, rw] = widen(SHADE), [l45, r45] = widen(1);
    p = { l: lw, r: rw, l45, r45 };
  }
  f.prof.set(ch, p);
  return p;
}

const baseOf = (ch: string) => ch.normalize('NFD')[0] ?? ch;
const isLower = (ch: string) => ch !== ch.toUpperCase() && ch === ch.toLowerCase();
const isLetter = (ch: string) => /[\p{L}\p{N}]/u.test(ch);

/** Closest approach (font units) of b to a, set at a's advance, over the zone they share. */
function approach(f: SFont, a: string, b: string): number | null {
  const pa = profile(f, a), pb = profile(f, b);
  if (!pa || !pb) return null;
  const adv = f.glyphs.get(a)!.adv;
  const lower = isLower(a) || isLower(b) || !isLetter(a) || !isLetter(b);
  const top = lower ? f.xTop : f.capTop;
  const i0 = Math.max(0, Math.floor((f.base - f.yLo) / f.dy)), i1 = Math.min(ROWS - 1, Math.floor((top - f.yLo) / f.dy));
  let m = Infinity;
  for (let i = i0; i <= i1; i++) {
    const ra = pa.r[i]!, lb = pb.l[i]!;
    if (!Number.isNaN(ra) && !Number.isNaN(lb)) m = Math.min(m, adv + lb - ra);
  }
  return m === Infinity ? null : m;
}

/** Optical kern (font units, <= 0) between two adjacent glyphs; 0 unless one of them leaves a hole. */
function pairKern(f: SFont, a: string, b: string): number {
  // (an accented letter kerns like its base: Ý like Y)
  if (a === ' ' || b === ' ' || !(OPEN_R.has(baseOf(a)) || OPEN_L.has(baseOf(b)))) return 0;
  if (!isLetter(a) && !isLetter(b)) return 0;
  const key = a + b;
  const hit = f.kern.get(key);
  if (hit !== undefined) return hit;
  if (!f.target) {
    const mean = (ps: string[]) => { const v = ps.map((p) => approach(f, p[0]!, p[1]!) ?? 0); return v.reduce((x, y) => x + y, 0) / v.length; };
    f.target = { lc: mean(['nn', 'oo', 'no', 'on']), uc: mean(['HH', 'OO', 'HO', 'OH']) };
  }
  const m = approach(f, a, b);
  let k = 0;
  if (m !== null) {
    const lower = isLower(a) || isLower(b) || !isLetter(a) || !isLetter(b);
    k = Math.max(-0.15 * f.upm, Math.min(0, STRENGTH * ((lower ? f.target.lc : f.target.uc) - m)));
    // clearance over the full height (descenders, accents and arms included)
    const pa = profile(f, a)!, pb = profile(f, b)!, adv = f.glyphs.get(a)!.adv;
    let near = Infinity;
    for (let i = 0; i < ROWS; i++) {
      const ra = pa.r45[i]!, lb = pb.l45[i]!;
      if (!Number.isNaN(ra) && !Number.isNaN(lb)) near = Math.min(near, adv + lb - ra);
    }
    k = Math.max(k, Math.min(0, CLEAR * f.upm - near));
  }
  f.kern.set(key, k);
  return k;
}

function parseSvgFont(txt: string): SFont {
  const doc = new DOMParser().parseFromString(txt, 'image/svg+xml');
  const ff = doc.querySelector('font-face')!;
  const fontEl = doc.querySelector('font')!;
  const defAdv = parseFloat(fontEl.getAttribute('horiz-adv-x') ?? '500');
  const glyphs = new Map<string, SGlyph>();
  doc.querySelectorAll('glyph').forEach((g) => {
    const u = g.getAttribute('unicode');
    if (u == null) return;
    const adv = parseFloat(g.getAttribute('horiz-adv-x') ?? String(defAdv));
    glyphs.set(u, { adv, strokes: parsePath(g.getAttribute('d') ?? '') });
  });
  let yLo = Infinity, yHi = -Infinity;
  for (const g of glyphs.values()) for (const st of g.strokes) for (const p of st) { yLo = Math.min(yLo, p.y); yHi = Math.max(yHi, p.y + 1); }
  const H = inkBox(glyphs.get('H')?.strokes ?? [[{ x: 0, y: 0 }, { x: 0, y: 700 }]]);
  const X = inkBox(glyphs.get('x')?.strokes ?? [[{ x: 0, y: 0 }, { x: 0, y: 450 }]]);
  return {
    upm: parseFloat(ff.getAttribute('units-per-em') ?? '1000'),
    ascent: parseFloat(ff.getAttribute('ascent') ?? '800'),
    descent: parseFloat(ff.getAttribute('descent') ?? '-200'),
    xh: parseFloat(ff.getAttribute('x-height') ?? '300'),
    cap: parseFloat(ff.getAttribute('cap-height') ?? '500'),
    glyphs,
    missingAdv: defAdv,
    base: H.y0, xTop: X.y1, capTop: H.y1,
    yLo, dy: (yHi - yLo) / ROWS,
    prof: new Map(), kern: new Map(), target: null, pen: null,
  };
}

// ------------------------------------------------------------------ the pen's order, smooth curves
// The fonts are drawn in the order a plotter likes: many strokes start at the baseline and go up, and a
// crossbar is drawn out and back over itself. A pen writing on screen reads better moving like a hand, so
// strokeText takes each glyph through penOrder() (not the connected scripts: their order is a hand's):
// - a segment drawn twice (out and back) is drawn once; pieces that this splits and that continue one
//   another are joined again (an f's stem, broken where its crossbar was drawn);
// - a stroke that runs up, nearly straight and mostly vertical (a stem, a parenthesis) runs down instead;
//   every other stroke keeps the font's direction, which is often a hand's already;
// - a crossbar (a nearly level stroke that another one crosses) comes after the strokes it crosses.
// The ink is the same: the same lines, in another order and direction.

const near = (a: V2, b: V2, e: number) => Math.abs(a.x - b.x) <= e && Math.abs(a.y - b.y) <= e;
/** Distance from p to the segment ab. */
function segDist(p: V2, a: V2, b: V2) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const u = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - u * dx, p.y - a.y - u * dy);
}
/** Turning angle at b on the way a → b → c, in radians (0: straight on, π: straight back). */
function turn(a: V2, b: V2, c: V2) {
  const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y, l = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  return l > 0 ? Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / l))) : 0;
}
/** Where segments ab and cd cross, or null. */
function cross(a: V2, b: V2, c: V2, d: V2): V2 | null {
  const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y }, den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const u = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den, v = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? { x: a.x + u * r.x, y: a.y + u * r.y } : null;
}

/** A glyph's strokes (font units, y up) in a hand's order and direction (see above). */
function penOrder(strokes: V2[][], upm: number): V2[][] {
  // (E: how close two lines run to be one line drawn twice, half a percent of the em: invisible at any size
  // the fonts are drawn at, and far below the gap of the parallel strokes that thicken Hershey's stems)
  const E = upm * 0.005, JOIN = upm * 0.012;
  // 1. segments in drawing order, without those other segments draw already. Going from the last drawn to
  //    the first, a segment that lies along the others still drawn goes, so of a line drawn twice the
  //    first drawing stays
  type Seg = { a: V2; b: V2 };
  const items: (Seg | V2)[] = []; // segments, and lone points (a dot drawn as one point)
  for (const s of strokes) {
    if (s.length === 1) items.push(s[0]!);
    for (let k = 1; k < s.length; k++) items.push({ a: s[k - 1]!, b: s[k]! });
  }
  const segs = items.filter((x): x is Seg => 'a' in x), covered = new Set<Seg>();
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i]!;
    const on = (p: V2) => segs.some((t) => t !== s && !covered.has(t) && segDist(p, t.a, t.b) <= E);
    let all = true;
    for (let k = 0; k <= 8 && all; k++) all = on({ x: s.a.x + ((s.b.x - s.a.x) * k) / 8, y: s.a.y + ((s.b.y - s.a.y) * k) / 8 });
    if (all) covered.add(s);
  }
  // 2. chains: what is left, joined where one segment starts where the last one ended without turning back
  const chains: V2[][] = [];
  let cur: V2[] | null = null;
  for (const it of items) {
    if (!('a' in it)) { chains.push([it]); cur = null; continue; }
    if (covered.has(it)) { cur = null; continue; }
    if (cur && near(cur[cur.length - 1]!, it.a, E) && (cur.length < 2 || turn(cur[cur.length - 2]!, cur[cur.length - 1]!, it.b) < 2.6)) cur.push(it.b);
    else chains.push((cur = [it.a, it.b]));
  }
  //    and pieces that continue one another (the end of one at the start of a later one, going on smoothly)
  for (let i = 0; i < chains.length; i++) {
    const x = chains[i]!;
    if (x.length < 2) continue;
    for (let j = i + 1; j < chains.length; j++) {
      const y = chains[j]!;
      if (y.length < 2 || !near(x[x.length - 1]!, y[0]!, JOIN) || turn(x[x.length - 2]!, x[x.length - 1]!, y[1]!) > 0.9) continue;
      x.push(...y.slice(near(x[x.length - 1]!, y[0]!, E) ? 1 : 0));
      chains.splice(j, 1);
      j = i; // (look again from the start: the chain has a new end)
    }
  }
  // 3. upward strokes that are stems: down instead
  for (const c of chains) {
    if (c.length < 2 || near(c[0]!, c[c.length - 1]!, JOIN)) continue; // (a dot, a closed loop)
    let v = 0, h = 0, back = 0;
    for (let k = 1; k < c.length; k++) { const dy = c[k]!.y - c[k - 1]!.y; v += Math.abs(dy); h += Math.abs(c[k]!.x - c[k - 1]!.x); if (dy < 0) back -= dy; }
    if (c[c.length - 1]!.y > c[0]!.y && v >= 2.5 * h && back <= 0.1 * v) c.reverse();
  }
  // 4. crossbars after the strokes they cross
  const ends = (c: V2[], p: V2) => near(c[0]!, p, JOIN) || near(c[c.length - 1]!, p, JOIN);
  const isBar = (c: V2[]) => {
    const b = inkBox([c]);
    if (c.length < 2 || b.x1 - b.x0 <= 0 || b.y1 - b.y0 > 0.2 * (b.x1 - b.x0)) return false;
    return chains.some((d) => d !== c && d.length > 1 && d.some((_, k) => k > 0 && c.some((_, m) => {
      if (m === 0) return false;
      const x = cross(c[m - 1]!, c[m]!, d[k - 1]!, d[k]!);
      return !!x && !ends(c, x) && !ends(d, x);
    })));
  };
  const bars = chains.filter(isBar);
  return [...chains.filter((c) => !bars.includes(c)), ...bars];
}

/**
 * A stroke at a large size: resampled every `step` px along a centripetal Catmull-Rom spline through its
 * points, so a curve loses the straight facets the fonts' polylines show when big; it still passes through
 * every point of the font, and a corner (a turn of more than 40°) stays a corner.
 */
function smoothStroke(pts: V2[], step: number): V2[] {
  if (pts.length < 3) return pts;
  const out: V2[] = [pts[0]!];
  const P = (k: number, i0: number, i1: number): V2 => {
    // past either end of a run, the run's end mirrored (a natural end tangent)
    if (k < i0) return { x: 2 * pts[i0]!.x - pts[i0 + 1]!.x, y: 2 * pts[i0]!.y - pts[i0 + 1]!.y };
    if (k > i1) return { x: 2 * pts[i1]!.x - pts[i1 - 1]!.x, y: 2 * pts[i1]!.y - pts[i1 - 1]!.y };
    return pts[k]!;
  };
  const run = (i0: number, i1: number) => {
    for (let j = i0; j < i1; j++) {
      const p0 = P(j - 1, i0, i1), p1 = pts[j]!, p2 = pts[j + 1]!, p3 = P(j + 2, i0, i1);
      const kn = (a: V2, b: V2) => Math.max(1e-6, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)));
      const t1 = kn(p0, p1), t2 = t1 + kn(p1, p2), t3 = t2 + kn(p2, p3);
      const n = Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / step));
      for (let i = 1; i <= n; i++) {
        if (i === n) { out.push(p2); break; }
        const t = t1 + ((t2 - t1) * i) / n, L = (a: V2, b: V2, ta: number, tb: number) => {
          const u = (t - ta) / (tb - ta);
          return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
        };
        const a1 = L(p0, p1, 0, t1), a2 = L(p1, p2, t1, t2), a3 = L(p2, p3, t2, t3);
        const b1 = L(a1, a2, 0, t2), b2 = L(a2, a3, t1, t3);
        out.push(L(b1, b2, t1, t2));
      }
    }
  };
  let i0 = 0;
  for (let k = 1; k < pts.length; k++) if (k === pts.length - 1 || turn(pts[k - 1]!, pts[k]!, pts[k + 1]!) > 0.7) { run(i0, k); i0 = k; }
  return out;
}
/** From this size (px) on, strokeText smooths the strokes (smaller, the polylines' facets don't show). */
const SMOOTH_FROM = 80;

/** These fonts only use M/L (absolute) commands; y is up in font units. */
function parsePath(d: string): V2[][] {
  const out: V2[][] = [];
  const tok = d.match(/[MLml]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  let cur: V2[] | null = null;
  let cmd = 'M';
  for (let i = 0; i < tok.length; ) {
    const t = tok[i]!;
    if (/[MLml]/.test(t)) { cmd = t.toUpperCase(); i++; continue; }
    const x = parseFloat(tok[i]!), y = parseFloat(tok[i + 1]!);
    i += 2;
    if (cmd === 'M') { cur = [{ x, y }]; out.push(cur); cmd = 'L'; }
    else cur?.push({ x, y });
  }
  return out;
}

export interface StrokeText {
  /** Polylines in px, origin at left baseline, y down. */
  strokes: V2[][];
  /** For each stroke: index of the char it belongs to. */
  charOf: number[];
  /** Cumulative length at the start of each stroke & total (for progressive writing). */
  startLen: number[];
  lens: Float32Array[];
  total: number;
  width: number;
  /** Char index -> [startLen, endLen] of its strokes (for syncing writing to word timings). */
  charRange: [number, number][];
  size: number;
  capHeight: number;
}

/**
 * Lay out a string in a stroke font at `size` px (em size). Letter pairs are kerned optically unless
 * `kern` is false (default: on, except for the connected scripts). The strokes come in a hand's order
 * (see penOrder: top-down stems, a crossbar once and last), and from 80 px on, their curves are smoothed.
 */
export function strokeText(text: string, fontName: StrokeFontName = 'readable', size = 100, tracking = 0, kern = !SCRIPTS.has(fontName)): StrokeText {
  const f = fonts.get(fontName);
  if (!f) throw new Error(`stroke font not loaded: ${fontName}`);
  const s = size / f.upm;
  const strokes: V2[][] = [];
  const charOf: number[] = [];
  let x = 0;
  const chars = Array.from(text);
  chars.forEach((ch, ci) => {
    const g = f.glyphs.get(ch);
    let order = g?.strokes ?? [];
    if (g && f.pen) {
      if (!f.pen.has(ch)) f.pen.set(ch, penOrder(g.strokes, f.upm));
      order = f.pen.get(ch)!;
    }
    for (const st of order) {
      const px = st.map((p) => ({ x: x + p.x * s, y: -p.y * s }));
      strokes.push(size >= SMOOTH_FROM ? smoothStroke(px, Math.max(2, size / 100)) : px);
      charOf.push(ci);
    }
    x += (g?.adv ?? f.missingAdv) * s + tracking;
    if (kern && ci + 1 < chars.length) x += pairKern(f, ch, chars[ci + 1]!) * s;
  });
  const lens = strokes.map((p) => polylineLengths(p));
  const startLen: number[] = [];
  let acc = 0;
  for (const L of lens) { startLen.push(acc); acc += L[L.length - 1] ?? 0; }
  const charRange: [number, number][] = chars.map(() => [Infinity, -Infinity]);
  strokes.forEach((_, i) => {
    const r = charRange[charOf[i]!]!;
    r[0] = Math.min(r[0], startLen[i]!);
    r[1] = Math.max(r[1], startLen[i]! + (lens[i]![lens[i]!.length - 1] ?? 0));
  });
  // chars without strokes (spaces) inherit the position of the previous char's end
  let last = 0;
  for (const r of charRange) {
    if (r[0] === Infinity) { r[0] = last; r[1] = last; }
    last = r[1];
  }
  return { strokes, charOf, startLen, lens, total: acc, width: x - tracking, charRange, size, capHeight: f.cap * s };
}

/**
 * Draw the first `len` px of a StrokeText into a Canvas2D context (already transformed).
 * Returns the pen position (where the stroke head is) or null if nothing drawn.
 */
export function drawStrokeText(c: CanvasRenderingContext2D, st: StrokeText, len: number): { x: number; y: number; angle: number } | null {
  let head: { x: number; y: number; angle: number } | null = null;
  c.beginPath();
  for (let i = 0; i < st.strokes.length; i++) {
    const s0 = st.startLen[i]!;
    if (s0 >= len) break;
    const pts = st.strokes[i]!, L = st.lens[i]!;
    const remain = len - s0;
    c.moveTo(pts[0]!.x, pts[0]!.y);
    let j = 1;
    for (; j < pts.length && L[j]! <= remain; j++) c.lineTo(pts[j]!.x, pts[j]!.y);
    if (j < pts.length) {
      const a = pts[j - 1]!, b = pts[j]!;
      const u = (remain - L[j - 1]!) / Math.max(1e-6, L[j]! - L[j - 1]!);
      const x = a.x + (b.x - a.x) * u, y = a.y + (b.y - a.y) * u;
      c.lineTo(x, y);
      head = { x, y, angle: Math.atan2(b.y - a.y, b.x - a.x) };
    } else {
      const a = pts[pts.length - 2] ?? pts[0]!, b = pts[pts.length - 1]!;
      head = { x: b.x, y: b.y, angle: Math.atan2(b.y - a.y, b.x - a.x) };
    }
  }
  c.stroke();
  return head;
}

/**
 * Map video time -> written length so each char is written while its word is sung or spoken.
 * `charTimes[i]` = [start, end] time for char i (e.g. derived from word timings).
 */
export function writtenLength(st: StrokeText, charTimes: [number, number][], t: number): number {
  let len = 0;
  for (let i = 0; i < st.charRange.length; i++) {
    const [a, b] = st.charRange[i]!;
    const [t0, t1] = charTimes[i] ?? [Infinity, Infinity];
    if (t >= t1) len = b;
    else if (t > t0) { len = a + (b - a) * ((t - t0) / Math.max(1e-3, t1 - t0)); break; }
    else break;
  }
  return len;
}
