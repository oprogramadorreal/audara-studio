# Example: four ways of drawing

A 17-second test card over the demo track (120 BPM, 4/4, 8 bars and a one-second ring-out). It shows
what the engine draws with, one technique per two bars, each scene labelled with its technique and
file so a viewer can map what they see to the code. It is a calibration chart, not a style: neutral
palette (`src/look.ts`), plain geometry, no mood. Take from it what each scene shows about the engine, not
its look, structure or pacing (a treatment's format is the code-video skill's
`references/treatment-template.md`). One motif runs through it: the kick sends something outward (a front
through the field, a ring through the columns, the lit pool around the pen).

- **Format:** 1920×1080, 60 fps, `audio/demo.wav` (generated, with exact timing data in `data/`).
- **Type:** IBM Plex Mono for the labels: `<technique> · videos/example/scenes/<file>.ts`, 36 px, `muted`,
  at the lower left of the title-safe area (96 px from the left, descenders on the line 54 px from the
  bottom), drawn by `scenes/_label.ts` for all four scenes. 36 px is `docs/STYLE.md`'s smallest size for
  text meant to be read at 1920×1080. The other annotations (legends, notes under words, the ruler) are
  13–15 px: texture that rewards a pause in the preview, never something the viewer must read. Archivo
  for the lyric; the `readable` stroke font for the pen.
- **Palette:** `bg` ground, `fg` marks, `line` and `muted` for structure, `accent` for what reacts to
  the music, `accent2` for one other channel per scene (the snare, the kick's source).
- **Rules:** every motion is a function of `t` and the beat grid; cuts are hard, on downbeats; each scene
  holds a finished composition on its first frame; nothing crosses the labels.
- **Assumed:** the demo track has no voice: `data/words.json` times the lyric to its beats, as an
  analysis of a sung line would.

## Storyboard

| Time | What the viewer sees | The moment's job | Transition out (what carries over) |
|---|---|---|---|
| 0:00–0:04 (bars 1–2) | The distance field of a hatched disc, drawn as crisp rings every 60 px that drift outward one spacing per bar. Each kick sends a front out through them in `accent`; each snare lights a still ruler in `accent2`. On bar 2's downbeat the disc snaps to a rounded square and every ring with it, with a flash of the drawing | Show one fullscreen shader drawing the frame, with the kick and the snare as two channels | Hard cut on bar 3's kick; the kick's ring from the centre carries over, now lifting columns |
| 0:04–0:08 (bars 3–4) | A slab of 25×25 columns waving on the beat; each kick sends a ring of raised `accent` columns out from the centre, whose column flashes `accent2`. The camera glides through a pose on every beat, from a low three-quarter view to straight down; an inset plots its speed, smoothKeys against keys() | Show 3D geometry, and a camera that moves through beat-timed poses without stopping at each | Hard cut on bar 5; the columns settle flat and the camera ends straight down, so a flat grid cuts to the flat page |
| 0:08–0:12 (bars 5–6) | “Every frame / is a function / of time.”, dim and narrow from the first frame. Each word lights glyph by glyph on its beats and steps through Archivo's widths and weights, the words after it gliding aside to make room; a ruler below plots the words and the drum hits under a playhead | Show type synced to `data/words.json`: words found by their text, kerning kept across a split word | Hard cut on bar 7; the sentence becomes its formula: the pen will write f(t) |
| 0:12–0:17 (bars 7–8, ring-out) | On a lattice of registration crosses lit around the pen, the pen plots a 3:2 Lissajous figure in three beat surges, lifts and moves on beat 4, then writes “f(t)” one glyph per beat, the last stroke on the final hit; a ring sweeps the lattice on that hit | Show GPU lines and pen writing timed to the beat grid | The ring-out holds the finished drawing; fade on the last half second |

## Scenes

- `fspass` (`scenes/fspass.ts`): one `FSPass`; the core's SDF (`sdBox` with a corner radius, disc to
  rounded square on bar 2), rings from `fract` of the distance (`pxLine`, crisp at 4K), kick fronts from
  `audio.events('kick')`, `f.a.kick` filling the hatch, `f.a.snare` on the ruler; the field fades out
  around the label (an SDF box). Label: `FSPass · fullscreen GLSL · videos/example/scenes/fspass.ts`.
- `three` (`scenes/three.ts`): an `InstancedMesh` slab and a `PerspectiveCamera` rendered into `out` in
  linear colour, through its own 4× multisampled target; nine poses on the beats interpolated with
  `smoothKeys`; heights from `f.beat` and the kicks' onsets; a small `Layer2D` inset placed with
  `comp.draw`'s `rect`. Label: `three.js · InstancedMesh · videos/example/scenes/three.ts`.
- `layer2d` (`scenes/layer2d.ts`): `Layer2D` karaoke of the three lines found with `words.get()`;
  `Words.wordProgress` drives each word's glyphs and Archivo steps, taken at the frame's own time
  (`frameTime`), while the layout glides; `glyphX` splits a word without losing its kerning; one small
  layer per line, redrawn only when it changes. Label: `Layer2D · Canvas2D type · videos/example/scenes/layer2d.ts`.
- `linebatch` (`scenes/linebatch.ts`): one `LineBatch` (blend `max`) for the lattice, the inked figure and
  the word; `strokeText('f(t)', 'readable')` written by `writtenLength()` with a glyph per beat; the pen's
  head above 1.0 so the bloom gives it its glow. Label: `LineBatch + stroke font · videos/example/scenes/linebatch.ts`.
