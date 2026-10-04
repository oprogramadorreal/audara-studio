# Math

Equations, plots and geometric constructions inside the engine, and Manim for when it serves better. Read it
when a piece shows formulas or math being worked. Checked 2026-10 on Windows 11 (MathJax 4.1, Manim
Community 0.21) in a project like this one, `verify` passing for both routes.

## What makes math animation work

The 3Blue1Brown kind of explanation is technique more than a look: one idea at a time, objects that persist
and transform instead of cutting away, each quantity keeping its colour through every equation, writing
that follows the narration word by word, and pauses where the voice explains. All of it is drawable here;
its palette and type are the project's, not 3Blue1Brown's.

## First choice: TeX drawn in the engine

MathJax 4 (`bun add @mathjax/src`; its font package comes with it) turns TeX into glyph outlines in `init()`:
crisp at 4K, checked by `verify` like any scene, timed live from the words, no Python. About 1.4 MB of bundle
and 20 ms for the first formula.

```ts
import { mathjax } from '@mathjax/src/js/mathjax.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import { SVG } from '@mathjax/src/js/output/svg.js';
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
import '@mathjax/src/js/input/tex/base/BaseConfiguration.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import { MathJaxNewcmFont } from '@mathjax/mathjax-newcm-font/js/svg.js';
const DYNAMIC: Record<string, () => Promise<unknown>> = {   // literal paths, so Vite bundles them
  latin: () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/latin.js'),               // accented letters
  'double-struck': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/double-struck.js'), // \mathbb
  calligraphic: () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/calligraphic.js') };   // \mathcal
mathjax.asyncLoad = (f) => { const l = DYNAMIC[f.replace(/^.*\//, '').replace(/\.js$/, '')]; return l ? l() : Promise.reject(new Error(`add ${f} to DYNAMIC`)); };
const adaptor = liteAdaptor(); RegisterHTMLHandler(adaptor);
const doc = mathjax.document('', {
  InputJax: new TeX({ packages: ['base', 'ams'], formatError: (_: unknown, e: { message: string }) => { throw new Error(e.message); } }),
  OutputJax: new SVG({ fontData: MathJaxNewcmFont, fontCache: 'none' }) });
const svg = await mathjax.handleRetriesFor(() => doc.convert(String.raw`\frac{y}{r} = \sqrt{1 - \frac{x^2}{r^2}}`, { display: true }));
```

- Walk the SVG from `adaptor.tags(svg, 'svg')[0]` with a matrix that starts at `scale(px / 1000)` and the
  viewBox's x: each `<path>` becomes a `Path2D` keyed by its `data-c` character code, `<g>` transforms
  compose, each `<rect>` (a fraction bar, a root's line) a unit square scaled to size, so a morph can tween
  its length; a nested `<svg>` (the pieces of a stretched arrow or brace) is a clip window.
- A morph between formulas: pair glyphs with the same character by nearest relative position (reading order
  sends the r of r² to the wrong r), move the pairs on a short arc with a stagger, fade the rest; a progress
  from `t`. Redraw the formula's `Layer2D` only when the morph's state changes.
- Write TeX in `String.raw`: in a plain string `\frac` loses its backslash to a form feed, and MathJax draws
  the wrong formula without a word. `formatError` makes a TeX error fail the scene by name instead of
  rendering red text.
- Axes, plots and constructions: `LineBatch` (widths hold at 4K) and values computed from the inputs, so a
  plotted point is where the function says.

## Fallback: Manim

When the scene is Manim's own kind of work (coordinated graphs, geometric constructions) or Manim code
exists already. It leaves the live loop: each timing change is a re-render and a re-extract.

```
uv run --no-project --python 3.12 --with "manim[typst]" manim -qh --fps 60 --transparent --disable_caching --media_dir out/<video>/manim videos/<video>/manim/scene.py Scene
```

- On macOS run `brew install cairo pkg-config` first, on Debian or Ubuntu `apt install build-essential
  python3-dev libcairo2-dev libpango1.0-dev` (Windows has wheels); without them, take the MathJax route.
- No LaTeX needed: `MathTypst` instead of `MathTex` (which fails with `FileNotFoundError` without LaTeX), and
  `TransformMatchingShapes` (`TransformMatchingTex` refuses Typst).
- Time it from the same data: the Python scene reads `data/words.json` and `data/audio.json` and schedules
  against its own frame clock, `run_time = (n - 0.5) / fps` for n frames, measured from `self.renderer.time`
  (Manim rounds run times to frames inconsistently), with `wait(..., frozen_frame=False)`.
- Extract from the MOV, not `--format png` (a frozen wait writes one PNG for many frames), cropped to the
  content (`cropdetect` on `alphaextract`), at the video's fps. Manim's alpha is premultiplied: divide it out
  when extracting (an ffmpeg `geq` of r·255/alpha per channel), or the edges come out thin and dark.
- Play the frames through the footage path (`references/contract.md`, "Images and footage"). Memory grows
  with area × frames (5 s of a 690×744 crop: about 600 MB), so end the clip on its last move and let the
  engine hold the final frame; 4K footage frames are rarely worth their memory.
- A deep `UV_CACHE_DIR` on Windows breaks the install (a dependency's build passes 260 characters): use the
  default cache or a short one.
