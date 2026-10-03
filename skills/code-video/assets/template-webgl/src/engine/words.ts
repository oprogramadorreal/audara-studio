// Timed words (data/words.json): sung lyrics or spoken narration, as lines of words with start/end
// times, with queries for karaoke and word-synced rendering. Find a line by its text, never by a
// hard-coded time: `ctx.words.get('every frame').words[1].start`.
// Format: { lines: [{ text, start, end, sourceText?, words: [{ w, start, end, conf?, syl?, spoken? }] }] }
// (`sourceText`: an alias get() and find() match first, never shown: a translated video's lines can keep
// their original text, so scenes written against the original still find them.)
import { smart } from './type';

export interface Word {
  w: string; // display token (punctuation attached, typographic quotes: don’t, ’cause)
  start: number;
  end: number;
  conf?: number;
  /** Syllable spans [start, end] for long words (karaoke wipes progress through them). */
  syl?: [number, number][];
  /** What was said, when it differs from the displayed `w` (narration spelled for the voice: "four" for "4"). */
  spoken?: string;
  /** filled in by Words: */
  line: number;
  index: number; // index within line
  gi: number; // global word index
}
export interface Line {
  i: number;
  text: string;
  /** Optional authoring alias (e.g. a translated line's original): find() and get() match it first. Never displayed. */
  sourceText?: string;
  start: number;
  end: number;
  words: Word[];
}

export class Words {
  lines: Line[];
  words: Word[];
  constructor(j: { lines?: any[] } = {}) {
    // display text gets curly apostrophes and quotes (the data keeps the typed ones); mono UI
    // text that wants them straight uses plain()
    this.lines = (j.lines ?? []).map((l, li) => ({
      ...l,
      i: li,
      text: smart(String(l.text ?? '')),
      words: ((l.words ?? []) as any[]).map((w, wi) => ({ ...w, w: smart(String(w.w ?? '')), line: li, index: wi, gi: 0 })),
    }));
    this.words = this.lines.flatMap((l) => l.words);
    this.words.forEach((w, i) => (w.gi = i));
  }

  /** The video's words; `url` null (no data/words.json yet) gives an empty set, not an error. */
  static async load(url: string | null): Promise<Words> {
    if (!url) return new Words();
    const r = await fetch(url);
    // (a dev server answers a missing file with its index page: only JSON counts)
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return new Words();
    return new Words(await r.json());
  }

  /** The line being sung/spoken at t (or null in gaps). */
  lineAt(t: number): Line | null {
    return this.lines.find((l) => t >= l.start && t < l.end) ?? null;
  }
  /** Most recent line that started at or before t. */
  lastLine(t: number): Line | null {
    let best: Line | null = null;
    for (const l of this.lines) if (l.start <= t) best = l;
    return best;
  }
  nextLine(t: number): Line | null {
    return this.lines.find((l) => l.start > t) ?? null;
  }
  linesIn(t0: number, t1: number): Line[] {
    return this.lines.filter((l) => l.end > t0 && l.start < t1);
  }
  /** Lines whose text includes `s` (case-insensitive, straight or curly quotes). Handy for finding a line by content. */
  find(s: string): Line[] {
    const q = fold(s);
    const source = this.lines.filter((l) => l.sourceText && fold(l.sourceText).includes(q));
    return source.length ? source : this.lines.filter((l) => fold(l.text).includes(q));
  }
  /** First line containing `s` (or the nth); throws if missing (fail loudly while authoring). */
  get(s: string, nth = 0): Line {
    const l = this.find(s)[nth];
    if (!l) throw new Error(`line not found in data/words.json: ${JSON.stringify(s)}${nth ? ` (#${nth})` : ''}`);
    return l;
  }
  wordAt(t: number): Word | null {
    return this.words.find((w) => t >= w.start && t < w.end) ?? null;
  }
  lastWord(t: number): Word | null {
    let best: Word | null = null;
    for (const w of this.words) if (w.start <= t) best = w;
    return best;
  }
  /** Words whose normalized text matches (accents, case and punctuation ignored: 'time' finds “time.”). */
  findWords(s: string): Word[] {
    const q = norm(s);
    return this.words.filter((w) => norm(w.w) === q);
  }

  /**
   * Progress of a word at time t: 0 before start, 1 after end, linear inside
   * (or piecewise across syllables when available). Use for karaoke wipes.
   */
  static wordProgress(w: Word, t: number): number {
    if (t <= w.start) return 0;
    if (t >= w.end) return 1;
    if (w.syl && w.syl.length > 1) {
      const n = w.syl.length;
      for (let i = 0; i < n; i++) {
        const [a, b] = w.syl[i]!;
        if (t < a) return i / n;
        if (t < b) return (i + (t - a) / Math.max(1e-3, b - a)) / n;
      }
      return 1;
    }
    return (t - w.start) / Math.max(1e-3, w.end - w.start);
  }

  /** Progress through a whole line in characters (0..text.length), for per-glyph wipes. */
  static lineCharProgress(l: Line, t: number): number {
    let chars = 0;
    for (const w of l.words) {
      const p = Words.wordProgress(w, t);
      chars += p * w.w.length;
      if (p < 1) break;
      chars += 1; // the space
    }
    return Math.min(chars, l.text.length);
  }
}

/** Matching key: accents stripped, lower case, and only letters (any script), digits and parentheses kept. */
export const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}()]/gu, '');
const fold = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
