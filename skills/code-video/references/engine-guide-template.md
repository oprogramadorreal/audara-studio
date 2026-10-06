# Engine guide (for scene authors)

The project is a web app (TypeScript + three.js, run with bun + Vite) that renders any time `t` of a video
deterministically, in the logical size its `video.json` sets (1920×1080 by default; vertical and square
work the same), or at 2× that with `?scale=2` (see "Output scale"). The same code drives the live preview
and the offline export. This guide is the API and its rules; the reasons behind the rules, with
measurements and the mistakes `verify` can't see, are in the code-video skill's `references/contract.md`.

Contents: Running things · The project and its videos · Data · Writing a scene · Rules · Stateful scenes ·
Toolbox · Typography · Output scale (4K) · Another format · Motion blur and sampling · Adding a font

## Running things

- **Preview**: you start it, before the first scene (the director doesn't run commands):
  `bun scripts/render.ts preview --video <video> --t 23.5` starts this project's preview unless it is
  running, and prints the link to give, `http://127.0.0.1:5173/?v=<video>&t=23.5` (another port when 5173
  was taken; no `&t=` without `--t`). It runs the project's own Vite in a process of its own, its output in
  `.audara-cache/preview.log`, so the preview outlives the command, your turn and the shell that ran it.
  In a new session run the same command: it starts nothing when the preview is up, and only prints the
  link. `bun scripts/render.ts preview --stop` ends it. `link`, with the same `--video` and `--t`, prints
  the link without starting anything: a dev server is this project's only if link finds it, since 5173,
  Vite's default port, often serves another app or another project's preview; when none answers, link
  says what holds those ports and exits 1. The server listens on 127.0.0.1 only, so the link uses that
  address: `localhost` may reach another app on the same port. `?v=` picks the video (default: the
  only one, else the first that isn't `example`); `?t=` starts at that time. Keys: space play/pause,
  ←/→ ±1 s (shift ±5 s), `,`/`.` ±1 frame, `[`/`]` previous/next timeline entry, `l` loop the current
  entry, `h` hide the UI, `c` copy a link to this moment. While paused or seeking, the address bar's `?t=`
  follows the playhead, so it is always a link to what is on screen. A project with several videos shows
  a picker.
- **Saving files while it plays:** a scene, or a helper a scene imports, swaps in place and the rest
  keeps playing; a scene that fails (a syntax error, a bad import, a throw) lists its error on the page,
  with the dev server's message, and renders dark red until it is fixed. The timeline (`timeline.ts`),
  `video.json`, `src/` and a new or changed file in the video's `data/`, `audio/` or `assets/` reload the
  page, at the moment it was showing.
- **Stills** (the main way to check your work; then look at the PNGs):
  `bun scripts/render.ts stills --video <video> --t 12.5,13.0,14.2 --only intro` → `out/<video>/stills/`
- **Contact sheet**, each frame labelled with its time and scene, into `out/<video>/sheets/`:
  `bun scripts/render.ts sheet --video <video> --n 24` spreads 24 frames over the whole video;
  `--from 1.5 --to 9 --n 16 --only intro` over a stretch; `--times a,b,c` takes the moments you pick; and
  `--cuts` takes where blank or broken frames hide: frame 0, the last frame, and for every cut (every time
  an entry starts or ends, so a crossfade gives two) a row of five: 0.1 s before, the frame before, the cut
  frame, the frame after, 0.1 s after. `--cuts --times a,b` adds those moments to the same sheet.
  Thumbnails have the same area whatever the frame's shape (480 px wide for 16:9, 270 for 9:16), in as
  many columns as fit about 1940 px, except that a `--cuts` row holds a cut's five frames, so 16:9
  thumbnails shrink to 383 px there. A sheet taller than about 2000 px, or past 3.75 MiB, goes on in `-2.png`,
  `-3.png`, so each page stays readable when it's looked at whole and reaches an image reader unchanged (a
  bigger PNG can be re-encoded to 256 colours on the way, which paints grey blotches around bright strokes). `--cols` and `--thumb <px wide>` change the layout.
- **A quick look at motion**: `bun scripts/render.ts video --video <video> --from 20 --to 25 --only hook --draft`.
  `--draft` takes one sub-frame per frame (no motion blur) and a fast encode (`--preset veryfast --crf 23`)
  and says so as it starts.
- **The render**: `bun scripts/render.ts video --video <video>` → `out/<video>/<video>.mp4`, with motion
  blur by default (`--samples auto --shutter 0.2`, see "Motion blur and sampling") and a slow, fine encode
  (`--preset slow --crf 16`). Add `--scale 2` for 4K, `--noaudio` for the picture alone, `--fps 30` for
  another rate than `video.json`'s. Only the whole video, every entry, on the full-quality path takes the
  name `<video>.mp4`; anything less is named for what it is, so it can't replace the delivery: a range
  adds its times (`<video>-20-25.mp4`), `--only` adds `-only-<ids>`, `--draft` `-draft` and `--as-preview`
  `-preview` (the quick look above writes `<video>-20-25-only-hook-draft.mp4`). `--out <file.mp4>` names
  it yourself. Its first line says what it will write (`-> out/<video>/<video>.mp4: 1920x1080 at 60 fps,
  20 s (1200 frames)`): the size is `video.json`'s times `--scale`, so check it before the minutes go by.
- **Poster**: `bun scripts/render.ts poster --video <video> --t 9.5` renders that one frame as the video
  renders it, motion blur included, to `out/<video>/poster.png` (`--out <file.png>` to choose).
- **Verify** before calling anything done: `bun scripts/render.ts verify --video <video>`. It renders every
  word, cut and half second; reports scene, browser and WebGL errors; checks the soundtrack against the
  timeline, the timing data in `data/` against the soundtrack (a song's window has to be the file that
  plays), and the gaps between scenes; checks determinism (the same frame reached by different seeks
  must give identical pixels); and checks that motion blur never carries a scene across a hard cut.
  One-line verdict, details in `out/<video>/verify.json`, exit code 1 on failure. Warnings don't fail it,
  among them one for every video but `example` while `src/look.ts` still has the template's test-card
  palette, which the preview shows too. Then it says what changed since the verify whose report it
  replaces: the stretches whose frames differ (it hashes the pixels at every half second, cut and word
  start, and again at the times the earlier report sampled, such as a moved word's old start; a frame is a
  function of `t`, so an equal hash is an unchanged frame), with their scenes, and the timeline
  entries added, removed or moved. After a change, those should be the stretches you meant to change; any
  other is a side effect (a shared helper, the look, a moved cut). With no report yet (`out/` isn't
  committed), run verify before you change anything. `--since <report>` compares with an earlier
  `verify.json` kept elsewhere instead.
- **Speed**: `bun scripts/render.ts perf --video <video> --from 20 --to 25 --only hook` prints what a
  frame costs the preview on the scenes' preview path (render until the GPU is done), split into the
  engine's own share (post-processing, paid by every frame) and the scenes', and what an export pays per
  frame on their full-quality path, with the readback (see `ctx.export` under Rules, performance). A video
  frame costs more: the run also sends each frame to ffmpeg and encodes it, and by default renders it as
  several sub-frames. `gpu` prints the GPU Chrome renders with.
- `--only a,b` loads only those timeline entries, by their ids in `timeline.ts` (fast, and isolates you
  from other people's broken scenes); the others render black. An id the timeline doesn't have stops the run.
- `--as-preview`, in any mode, renders the scenes' preview path (`ctx.export` false) instead of their
  full-quality one, under names of its own (`stills-preview/`, `verify-preview.json`, `-preview` on sheets,
  posters and videos): `stills --t 12.5 --as-preview` lands beside `stills --t 12.5`, a heavy scene's
  cheaper preview next to what the render will show.
- `--samples` and `--shutter` work in stills, sheet, poster, video and perf: sub-frames per frame (default
  1, `auto` for `video` and `poster`) and the fraction of the frame time they spread over (default 0.2).
  verify's renders are fixed.
- Every option is in the header of `scripts/render.ts`; this list has the common ones. An option it doesn't
  know stops the run (an instruction written for a newer copy: the code-video skill's `init.ts --force`
  updates the project's scripts).
- Typecheck: `bun run check`, or just your files: `bunx tsc --noEmit -p tsconfig.json 2>&1 | grep scenes/yourscene`
  (PowerShell: `bunx tsc --noEmit -p tsconfig.json | Select-String scenes/yourscene`). A bun script in a
  video's `audio/` (a synthesized score, say) is checked with `scripts/`, under bun's types, not with the
  scenes: bun's typing of `import.meta.hot` would break the browser program's.
- render.ts prints `SCENE ERRORS` and browser console errors: read them.
- 4K: add `--scale 2` to any mode (`stills` then saves full-resolution PNGs). Check your scene at both
  scales: downscaled, the 4K frame should look like the 1x one, only sharper.
- render.ts starts a private dev server for each run, without live reload, so a file saved mid-run (by
  you, the director or another agent) can't reload the page under it. `--url http://127.0.0.1:5174` uses a
  running server instead; one started with `AUDARA_NO_HMR=1 bunx vite` (PowerShell:
  `$env:AUDARA_NO_HMR=1; bunx vite`) doesn't reload either.

## The project and its videos

```
src/engine/       the engine (shared by every video; changes go through the lead)
src/look.ts       the project's palette (PALETTE) and post defaults (POST); it starts as a test card
src/video.ts      finds the videos, picks one (?v=), normalizes its video.json
public/fonts/     the fonts and their licenses
videos/<video>/
  video.json      size, fps, audio, duration, bpm
  TREATMENT.md    the idea, storyboard and scene briefs
  timeline.ts     the timeline: which scene plays when
  scenes/*.ts     one module per scene (its helpers: scenes/<scene>-*.ts; shared: scenes/_<name>.ts,
                  like the example's _label.ts)
  assets/         what only this video loads: images, models, fonts, footage frames (create it with
                  the first one)
  audio/          the soundtrack's files (and the records of how they were made)
  data/           audio.json (beat grid, envelopes, onsets) and words.json (timed lines)
out/<video>/      renders (not committed)
```

A scene loads its assets in `init()` by URL, `new URL('../assets/<file>', import.meta.url).href`: a
model with `await new GLTFLoader().loadAsync(url)`, an image with `THREE.TextureLoader` or an `Image`
drawn into a `Layer2D`. A file that isn't there fails the scene, and render.ts's browser log shows the
404 with its address. Fonts are registered like the shared ones ("Adding a font"); colour spaces,
footage and what the post does to an image are in the code-video skill's `references/contract.md`,
"three.js in this engine" and "Images and footage".

`video.json` (every field optional):

```json
{ "title": "Example", "size": [1920, 1080], "fps": 60, "audio": "audio/song.mp3" }
```

- `size`: the logical frame `[width, height]` in even pixels (H.264 needs even sizes): `[1080, 1920]` for
  vertical, `[1080, 1080]` for square. `fps` (default 60): the export's rate and the one `frameIdx()`
  counts in. `title`: shown in the page title.
- `audio`: one file played from 0 (`"audio/song.mp3"`), or a list of segments spliced together (each file
  trimmed and placed, silence between them, never mixed, so they must not overlap):
  `[{ "file": "audio/a.mp3", "at": 0, "from": 0, "dur": 30.5, "fadeOut": 1.2 }, ...]` (`at` = video time,
  `from` = offset in the file, `dur` required, `fadeOut` = a linear fade over the segment's last seconds),
  or `null`/absent for a silent video. Paths are relative to the video's folder.
- The video's length: `duration` (seconds) if set, else the end of the segment list, else
  `data/audio.json`'s duration, else the audio file's own length. A silent video without analysis needs
  `duration`. `bpm` (default 120) sets the beat grid used while there is no `data/audio.json`.

`timeline.ts` default-exports `(words, audio) => TimelineEntry[]`. Each entry:
`{ id, file, load, start, end, post?, params?, maxSamples?, remix? }`; the timeline's `E(id, name, start,
end, extra?)` helper fills in `load` (it imports `scenes/<name>.ts`) and `file` (that module's path, which
the preview watches: saving it, or a helper it imports, hot-swaps the entry). `E` loads scenes by URL, not
through `import.meta.glob`: a glob would tie every file in `scenes/` to the timeline, and saving a helper
would then reload the whole page. Derive every time from the data, never type seconds: the example's
`bar(n)` (the first beat of bar n), `cut(q)` (the last beat at or before the first word of the line
containing `q`), `after(q)` (the downbeat nearest the end of that line). `audio.duration` is the video's
length, so the last entry ends there. One module can serve several entries (`params`), and an entry may
play another video's scene (`E('intro2', '../../clip/scenes/intro', ...)`, with `remix`, see Rules).

## Data

- `ctx.words` (`src/engine/words.ts`, from `data/words.json`; empty without one): `lines[]` with
  `text, start, end, words[]`, each word `{ w, start, end, conf?, syl?, spoken? }` (`spoken`: what was said
  when the displayed text differs). Find lines by content, never hard-code times:
  `const l = this.ctx.words.get('sudden drop')` → `l.words[3].start` (`get` throws if the line is missing:
  fail loudly while authoring; `find` returns all matches). Also `lineAt(t)`, `lastLine(t)`, `nextLine(t)`,
  `linesIn(t0, t1)`, `wordAt(t)`, `lastWord(t)`, `findWords('time')` (accents, case and punctuation
  ignored). Helpers: `Words.wordProgress(word, t)` (0..1 progress through the word, by syllable when it
  has them), `Words.lineCharProgress(line, t)` (characters sung so far, for per-glyph wipes). A line may
  carry `sourceText`, an alias `get`/`find` match first and never show (a translated video's lines keep
  their original, so scenes written against it still find them).
- `ctx.audio` (`src/engine/audio.ts`, from `data/audio.json`): `beats[]`, `downbeats[]`, `sections[]`,
  `beatAt(t)` (continuous beat index), `barAt(t)`, `timeOfBeat(i)`, `nearestBeat(t)`, `section(t)`,
  `events('kick'|'snare'|'hat'|'vocal', t0, t1)`, `env(name, t)` for `rms|low|mid|high|vocal|drums|bass|other`
  (0..1), `pitchMidi` (the voice's pitch as a MIDI note, 0 where it is quiet, when the analysis had
  stems) and any other envelope the file has, `envPeak(name, t, w)`, `hit(kind, t, halfLife)` decaying
  pulses, `cue('hit')` (a named hit point's time, from `cues[]`; throws if missing). Without `data/audio.json` a beat grid at the video's `bpm` stands in (`audio.synthetic` is
  true; envelopes and onsets read 0), so a video previews before it has any analysis.
- Every `Frame` already carries `f.a` = `{ rms, low, mid, high, vocal, drums, bass, other, kick, snare,
  hat, vonset }`, `f.beat, f.bar, f.beatPhase, f.barPhase`, the local time `f.lt` and progress `f.p`
  through the entry, `f.start, f.end`, `f.dt` (the video time since the scene's last render, 0 after a
  seek and while the preview is paused; not for integrating, see "Stateful scenes"), `f.seeked`,
  `f.preroll`, and for transitions `f.under, f.tin, f.tout`.

## Writing a scene

One file `videos/<video>/scenes/<name>.ts`, default-exporting a class extending `Scene`
(`src/engine/scene.ts`). This one is an API sketch, not a composition: what a scene reads and calls. The
picture comes from the treatment.

```ts
import type * as THREE from 'three';
import { Scene, type Frame } from '../../../src/engine/scene';
import { FSPass, Layer2D } from '../../../src/engine/gl';
import { rgba } from '../../../src/engine/palette';
import { F, font } from '../../../src/engine/type';
import { ease, prog } from '../../../src/engine/util';

export default class Sweep extends Scene {
  bg = new FSPass(/* glsl */ `
    uniform float edge, low, flare;
    void main() {
      float d = FRAG_PX.x - edge;                                     // logical px from the edge
      vec3 c = mix(C_BG, C_FG, 0.08 * step(d, 0.0));                  // the ground the edge has crossed
      float line = pxLine(abs(d), 1.0 + 2.0 * low, 2.5 + 2.0 * low);  // a hairline the bass thickens
      fragColor = vec4(mix(c, C_ACCENT * (1.0 + 2.0 * flare), line), 1.0); // above 1 on a downbeat: it glows
    }`, { edge: { value: 0 }, low: { value: 0 }, flare: { value: 0 } });
  // a layer only as big as the text it holds: an upload costs by the pixel (see Rules, performance)
  text = new Layer2D(this.ctx.W, 160);

  override async init() { /* build geometry, precompute text layouts, load assets */ }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const { renderer, comp, words, W, H } = this.ctx;
    this.bg.u.edge!.value = W * ease.inOutCubic(f.p);    // crosses the frame over the entry
    this.bg.u.low!.value = f.a.low;                      // the bass envelope, 0..1
    this.bg.u.flare!.value = Math.exp(-6 * f.barPhase);  // once a bar, fading from its downbeat
    this.bg.render(renderer, out); // fullscreen shader → out (overwrites it)
    const line = words.lineAt(f.t);
    if (line) {
      this.text.clear(); // (it resets every style too: set them all each time)
      const c = this.text.ctx;
      c.font = font(F.archivo(100, 700), 96);
      c.fillStyle = rgba('fg', prog(f.t, line.start, line.start + 0.25, ease.outCubic));
      c.fillText(line.text, 96, 110); // 96 px: the title-safe margin
      comp.draw(renderer, this.text.upload(), out, { rect: [0, H * 0.8 - 110, W, 160] }); // alpha-over onto out, there
    }
    return { bloom: 0.5 }; // post overrides for this frame (optional)
  }
}
```

And its entry in the video's `timeline.ts`: `E('sweep', 'sweep', bar(1), bar(5))`.

three.js scenes render into the same `out`: build the scene, camera and materials in `init()` (models load
there too), set every transform, camera and material value from `f.t` (never `THREE.Clock`,
`requestAnimationFrame` or `mixer.update(delta)`), give materials linear colours
(`new THREE.Color().setRGB(...LIN.fg, THREE.LinearSRGBColorSpace)`), then
`renderer.setRenderTarget(out); renderer.clearDepth(); renderer.render(scene, camera)` after a
background pass (or `clearRT(renderer, out, LIN.bg)` first). An `AnimationMixer` follows `t` through
`mixer.setTime(lt)` only for clips that loop (the default) with no fades or warps. A play-once clip
(`LoopOnce`, `clampWhenFinished`), `fadeIn`, `crossFadeTo` or `warp` changes the action's state the first
time the mixer passes its end, and `setTime` doesn't undo it: set each action from `t` instead and let the
mixer apply it:

```ts
const a = this.action, d = a.getClip().duration;
a.enabled = true;
a.paused = false;
a.time = Math.min(Math.max(lt - clipStart, 0), d); // once, then held; ((x % d) + d) % d to loop
a.setEffectiveWeight(fadeIn(lt));                   // a fade is a function of t too
this.mixer.update(0);                               // applies the poses, advances nothing
```

A simulation or a physics engine runs ahead in `init()` into a table when it can, and is `stateful` when it
can't ("Stateful scenes"). What the example's `three.ts` found out:

- The engine's targets have no multisampling, so edges alias. For smooth edges render into a target of
  your own, `makeRT(W, H, { samples: 4, resolveDepthBuffer: false })`, clear it (the renderer's
  `autoClear` is off), then copy it into `out` with `comp.draw(renderer, rt.texture, out, { mode: 'replace' })`.
  Under multisampling, a colour gradient across a face lights a seam where the face is seen edge-on: keep
  per-instance colours flat.
- An `InstancedMesh` whose matrices change needs `frustumCulled = false`: three.js computes its bounds
  once, from the first frame, and culls it with them afterwards.
- Lights are physical: a Lambert face square to a light of intensity π shows its own colour, so write
  intensities as fractions of `Math.PI`.
- A camera that looks straight down needs an `up` perpendicular to its view (`lookAt`'s default, the
  vertical, leaves the roll undefined there).

## Rules

- **Deterministic**: the output must be a pure function of `f.t` (and seeded randomness: `mulberry32(seed)`,
  `hash(...)`). Never use `Math.random()`, `Date.now()` or `performance.now()` for visuals, and keep no
  state between `render()` calls. The export averages many sub-frames per frame, in any order (see "Motion
  blur and sampling"); `render.ts verify` renders frames after different seeks and fails on any pixel that
  differs. What seems to need memory (rings from past beats, particles, a value knocked from key to key)
  usually has a closed form or a table built in `init()`; what can only run forward is a stateful scene
  (next section).
- Per-frame flicker and jitter use `frameIdx(t)` (`util.ts`, the index of the output frame at the
  video's fps), never `Math.floor(t * 60)`.
- `render()` must fully overwrite `out` (a HalfFloat linear-HDR target): start with a fullscreen pass or
  `clearRT(renderer, out, LIN.bg)`. A target left with the previous frame in it fails verify.
- Colours are **linear**. The palette lives in `src/look.ts` (`PALETTE`) and comes as `C_<KEY>` constants
  in GLSL (`bg` → `C_BG`, `accent2` → `C_ACCENT2`, `deepRed` → `C_DEEP_RED`), `LIN.<key>` triplets for GL
  uniforms and three.js, and `rgba('<key>', alpha)` for Canvas2D (`src/engine/palette.ts`). Values from
  about 0.7 up start to bloom (`bloomThreshold` 1 with a soft knee) and the tone shoulder rolls off
  everything above 0.72: a large area of a near-white or fully saturated colour reads a little softer
  than its hex, and values above 1 glow. A frame showing a picture that must match its file (a screen, a
  logo) returns `{ bloom: 0, shoulder: 0 }`: both off, its white stays 255.
- `ctx.params` holds the timeline entry's params (one module can serve several entries); `ctx.start`,
  `ctx.end` its window; `ctx.W`, `ctx.H` the logical frame; `ctx.export` whether render.ts is rendering
  (see performance, below); `f.lt`/`f.p` local time and progress.
- `f.remix`: the entry's opt-in variations (`TimelineEntry.remix`), so another entry, or another video,
  can re-render your scene with another camera or without its text. Absent normally: the scene must render
  exactly as designed without it, and read only the keys it documents.
- Transitions: entries that touch make a hard cut (the default); overlapping ones crossfade. For a custom
  transition set `handlesTransition = true` and composite `f.under` (the previous scene's frame) yourself
  using `f.tin` (0→1 over the overlap).
- Post overrides a scene can return per frame (`src/engine/post.ts`): `exposure, bloom, bloomThreshold,
  bloomKnee, bloomRadius, halation, ca, grain, vignette, hud` (HUD opacity), `frame` (crop marks, 0..1),
  `paper` (marks in `bg` on a light frame), `fade, flash, shake: [x, y], zoom, invert, hudDraw` (a Canvas2D
  callback drawn in the HUD layer, steady under shake and zoom). The engine's defaults are neutral
  (`ENGINE_POST`: exposure 1, bloom 0.35, the rest off); `src/look.ts` `POST` sets the project's;
  `TimelineEntry.post` an entry's; the scene's own return wins. `flash` adds `fg` to the whole linear
  frame before encoding: on a dark ground even 0.02 reads as a grey veil, so flash the drawing itself
  (brighter lines, a thicker outline) unless the whole frame is meant to flare.
- Performance: the preview plays in real time while a frame costs under ~16 ms (60 Hz; 33 ms still
  plays, at 30). `render.ts perf` prints that cost and its parts: on an integrated GPU at 1920×1080 the
  engine's own post-processing takes about 1.6 ms (4 ms at `--scale 2`), the example's scenes 0.3–2.6 ms
  each. At `--scale 2` a fullscreen pass and a Canvas2D upload cost about four times as much (four times
  the pixels). The costly thing in a scene is usually that upload, in proportion to the layer's area:
  about 9 ms for a full-frame layer redrawn every frame (40 ms at 4K), 1.5 ms for a 1728×255 strip (7–8 ms
  at 4K). So draw and upload what never changes once, in `init()`; redraw a layer only when what it
  shows changes; and give text that changes every frame a layer only as big as the text, placed with
  `comp.draw(..., { rect })` (the example's `layer2d.ts` does all three). Precompute in `init()`.
- What a render costs: every frame is read back (about 15 ms at 1080p, which perf shows apart), sent to
  ffmpeg and encoded, about 60 ms a frame at 1080p in all before any sub-frames, and the motion blur
  multiplies the scenes' share by the sub-frames (12 for a still frame, up to 324 for a whip). So a
  render takes a multiple of this video's `--draft` time that grows with fast motion: 2× for the
  17-second example, 7× for a 20-second Canvas2D piece whose flips took 108-324 sub-frames. Estimate it
  from this video's draft, tell the director before starting, and firm it up with the render's `eta`.
- A scene too heavy for real time gets a cheaper preview path, not a simpler idea. `ctx.export` is false
  in the live preview and true whenever render.ts renders (stills, sheets, verify, the video), so the
  scene can trade quality for speed in the preview alone: a lower internal resolution (render into
  `makeRT(W / 2, H / 2)` and draw that into `out`), fewer samples or taps, fewer raymarch steps. Cost,
  never content: the render must show what the director approved in the preview, only cleaner, with the
  same shapes, timing, colours and framing. Check it with `stills --t <t> --as-preview`, which lands in
  `stills-preview/` beside what `stills --t <t>` writes, and time both paths with `perf`. Lower the
  resolution before the step count: too few steps can move a silhouette that grazing rays no longer
  reach. Read `ctx.export` in `init()` or `render()`; it doesn't change while the page runs.
- Scene authors edit only their own files: `videos/<video>/scenes/<scene>.ts` and its helpers,
  `scenes/<scene>-*.ts`. A helper has named exports only: a module in `scenes/` whose default export is a
  class is taken for a scene and swapped on its own, while saving a helper hot-swaps every scene that
  imports it. Helpers several scenes share (a carried object's pose, a recurring motif, the example's
  labels) are `scenes/_<name>.ts` and belong to the lead. Engine changes (`src/`), shared helpers,
  `timeline.ts` and `video.json` go through the lead: report what you'd need.

## Stateful scenes

First choose what keeps the scene a function of `t`: a closed form (ballistic paths, `springStep`, decays
from event times: `audio.events('kick', t - 2, t)`, then `pulse(t, t0)` for each), particles born on a
fixed clock with everything else from `hash(n, …)`, or a simulation run once in `init()` at a fixed step
into a table, read back by `t` with interpolation. They keep adaptive motion blur and exact seeks.

`stateful = true` is for what can only run forward: feedback buffers, a GPU simulation, a physics engine.
What the engine does with one:

- After a seek it calls `reset()` and replays the frames since `max(entry start, t − prerollMax)` (6 s by
  default) with `f.preroll` true: step then, skip the drawing.
- The render can't sample it adaptively, since adaptive sub-frames come out of time order: a range that
  shows one takes a fixed 12 sub-frames, the whole range and not just that entry (`--samples N` for another
  count; an explicit `--samples auto` stops with the reason).

Step the simulation at its own fixed rate, counting the steps from the entry's start, to the step `f.t`
calls for, rather than adding up `f.dt`. `f.dt` is the time since the scene's last render, which depends
on how the frames are drawn (the display's rate in the preview, the frame grid after a seek, the
sub-frame spacing in the render): added up, it takes different steps in each, and anything nonlinear (a
bounce, a collision, a stiff spring) ends up somewhere else in each. Counted from the entry's start, every
path takes the same steps, and while the preview is paused nothing steps:

```ts
override stateful = true;
private h = 1 / 240; // the simulation's own step (s)
private n = -1;      // steps taken since the entry's start; -1 after reset()
override reset() { this.n = -1; }
override render(f: Frame, out: THREE.WebGLRenderTarget) {
  const lt = f.t - this.ctx.start;
  if (this.n < 0) { this.setInitialState(); this.n = 0; } // after a seek: replay from the start
  while (this.n * this.h <= lt) this.step(this.ctx.start + this.n++ * this.h); // inputs read at the step's time
  if (f.preroll) return;
  // draw between the previous state and this one, at (lt - (this.n - 1) * this.h) / this.h,
  // or the motion blur shows the steps
}
```

Replaying from the entry's start makes a seek exact, at a cost that grows with the time since the start.
To bound it, start the counter at the first `f.t` after `reset()` (`this.n = Math.floor(lt / this.h)`) and
let the engine's `prerollMax` seconds of replay settle the state: it must forget what came before within
that time, or a frame reached by a seek differs from the same frame in the render. verify's seeks all
replay the same way, so they agree even when the state hasn't settled: compare a still at `t` with the
frame at `t` of a clip rendered from the entry's start.

## Toolbox

- `gl.ts`: `FSPass(frag, uniforms)` fullscreen GLSL3 pass (has `vUv`, writes `fragColor`, gets
  `GLSL_COMMON`); `Compositor` via `this.ctx.comp.draw(renderer, tex, target, { mode: 'normal'|'add'|'screen'|'multiply'|'max'|'replace', opacity, tint, rect, scale, offset, premult })`
  (`rect: [x, y, w, h]` puts the texture there, in logical px from the top left: a small layer where it
  belongs); `Layer2D(w = W, h = H)` (a logical Canvas2D → sRGB texture, CPU-backed: it uploads at about
  half the cost of a GPU canvas and rasterizes the same pixels every time; `clear(color?)` also resets
  every drawing setting, `upload()`); `makeRT()` (an HDR target the size of the frame; `makeRT(w, h)`
  takes logical px); `clearRT(renderer, rt, [r, g, b])`; `W`, `H` (logical size), `SCALE`, `PW`, `PH`
  (output scale and physical size); `SS_TAP`, `SS_TAP_GLSL`; `scaleContext2D`.
- `glsl/common.ts` (`GLSL_COMMON`, prepended to every FSPass; import it into your own ShaderMaterials): the
  palette constants, `PI`, `TAU`, `PX_SCALE`, `FRAG_PX`, `sat`, `remap`, `rot2`, `luma`, `hash11/12/13/22/33`,
  `snoise(vec2|vec3)`, `fbm`, `curl2`, 2D/3D SDFs (`sdCircle`, `sdBox`, `sdSegment`, `sdSphere`, `sdBox3`,
  `sdCapsule`, `sdTorus`), `smin`, `smax`, `aaFill`, `aaStroke`, `pxLine`, `rampLine`, `hatch(u, darkness)`
  and `engrave(uv, darkness, freq, angle)` for engraving-style shading, `rgss(k)`, `toSRGB`/`toLinear`.
- `lines.ts`: `LineBatch(capacity, { screen2D, worldWidth, blend, depthTest })`: GPU capsule segments, in
  2D pixels (y down) or 3D with a camera. `seg2`, `seg`, `polyline`, `clear()`,
  `render(renderer, out, camera?)`. Colours linear, may exceed 1 for glow (the bloom makes it). Good for
  10k–200k segments; `seg()` drops whatever passes `capacity`, silently, so size it from the geometry.
  `blend`: `'max'` (default) for light lines on a dark ground: overlaps (a polyline's joints, crossings,
  hatching) don't double up, in any drawing order. `'add'` brightens overlaps, for glow, but some GPUs
  round overlapping sums differently from one render to the next (1/255 here and there, which verify
  reports): keep it for segments that don't overlap. `'normal'` (alpha over) for dark ink on a light ground.
- `type.ts`: fonts. `F.archivo(width 62–125, weight 300–900)` (a grotesk with width steps
  62/75/87.5/100/112.5/125), `F.archivoItalic()`, `F.serif(weight, italic)` (Cormorant Garamond),
  `F.mono(weight, italic)` (IBM Plex Mono). `font(family, px)` → CSS font string.
  `layout(text, family, size, tracking)` → per-glyph x/advance with the font's kerning (draw glyph i at
  `glyphs[i].x`). `glyphX(text, i, family, size)`, `fitSize`, `measure`, `textPath2D` (opentype outline as
  Path2D), `textPathCommands`, `textPoints(text, family, size, step)` (points filling the glyphs),
  `smart(s)` / `plain(s)`, `ot(family)` (the opentype.js font).
- `stroke.ts`: single-stroke plotter/engraving fonts (`script`, `hscript`, `sans`, `readable`, `tech`,
  `serif`, `osmotron`, `felix`): `strokeText(text, font = 'readable', size, tracking, kern)`,
  `drawStrokeText(ctx2d, st, lengthPx)` → the pen's head position, `writtenLength(st, charTimes, t)` to sync
  the writing to word timings. The fonts have no kerning tables: pairs that leave a hole (To, Yo, We, AV,
  LT…) are kerned optically from the glyph shapes (off for the connected scripts). They cover ASCII and
  Latin-1; other Latin letters (ā ă ą č ě ł ő ř ş ž ǘ …) are composed from a base letter and drawn accents.
- `util.ts`: `clamp`, `lerp`, `invLerp`, `remap`, `smoothstep`, `smootherstep`, `fract`, `mod`, `window01`,
  `ease.*`, `prog(x, a, b, ease)`, `springStep`, `pulse`, `mulberry32`, `hash`, `frameIdx`, `frameTime`,
  `noise1/2/3`, `fbm1/2`, `keys`, `smoothKeys`, `polylineLengths`, `pointAtLength`, `hexToLinear`.
  - `keys(t, [[t, v, ease], ...])` eases each segment separately: a move through several keys stops at
    each one. `smoothKeys(t, [[t, v], ...], ends?)` is a monotone cubic (Fritsch–Carlson) through the keys:
    the speed carries through the inner keys and it never overshoots. It starts and ends at rest by
    default (`ends: 'free'` keeps the first and last segments' speed, for a move already under way on a
    cut). Check a move by its speed per frame: it should rise and fall smoothly.
  - Something that starts moving from rest mid-shot starts with `smootherstep` (or `ease.inOutCubic`), not
    `ease.outExpo`: an ease that starts at full speed is right for a snap on a cut or a hit, and makes a
    one-frame pop anywhere else.
- `hud.ts`: the global overlay: the crop-mark frame (`post.frame`) and `post.hudDraw`.
- `soundtrack.ts`: the soundtrack's segments (`Segment`, `segmentGain`, `resolveDuration`) and the
  preview's `SoundtrackPlayer`. Scenes don't play audio; they read `ctx.audio` and `ctx.words`.

## Typography

- Proportional text gets the font's kerning: whole strings through Canvas2D get it for free; glyph-by-glyph
  drawing must use `layout()` / `glyphX()`. When a word is drawn in pieces (sung and unsung colours, a
  clipped wipe), start each piece at `glyphX(text, i, family, size)`; never offset a piece by
  `measure(text.slice(0, i))`, which drops the kern between the pieces. Adjacent runs in different fonts or
  sizes have no kerning between them: set that gap by eye.
- Words come with typographic punctuation (`don’t`, `’cause`, `“Just`): `Word.w` and `Line.text` go through
  `smart()`; `words.get()` matches straight or curly quotes. Hardcoded display strings use ’ “ ” … – — × −
  too. The mono voice (`docs/STYLE.md` says what it carries) keeps typewriter quotes where it shows typed
  input (`plain()` for such a line).
- Text meant to be read is usually solid: outlines and halos blur at phone size and smear under bloom.
  When the look calls for outlined or haloed type (the brief says so), keep it large and check it on a
  full-size still at the smallest size it will be watched. Display type may glow when the idea is light itself.

## Output scale (4K)

`?scale=2` (render.ts `--scale 2`) renders a true 2× frame (3840×2160 for a 1920×1080 video). Scenes keep
laying out in logical px (`W`, `H`, `ctx.W`, `ctx.H` never change); the engine handles the rest:

- Render targets: `out`, the engine's targets and `makeRT()` are physical (`PW`×`PH`). `makeRT(w, h)` takes
  logical px and allocates `w*SCALE`×`h*SCALE`; pass `{ pxScale: 1 }` for a data-sized target whose
  resolution must not follow the output.
- `Layer2D`: the backing canvas is `SCALE`× larger and its context is pre-scaled, so drawing code works in
  logical px. `setTransform`/`resetTransform`/`getTransform`, `shadowBlur`, `shadowOffsetX/Y` and `filter`
  px lengths are patched to stay logical. Not patched: `canvas.width/height` and
  `getImageData`/`putImageData` are physical px, and `drawImage(layer.canvas, x, y)` needs an explicit
  size. `new Layer2D(w, h, 1)` makes a deliberately low-res layer (e.g. a soft glow).
  `scaleContext2D(ctx, SCALE)` applies the same patch to your own canvas. A layer has 4× the pixels at
  `--scale 2`, and costs about 4× as much to upload: one more reason to keep the layers that change small.
- `LineBatch`: coordinates and widths stay logical; the AA feather and the hairline floor work in physical
  px, so hairlines stay crisp.
- GLSL (`GLSL_COMMON`): `gl_FragCoord`, `fwidth` and `dFdx` are physical. Use `FRAG_PX` (the fragment
  position in logical px) instead of `gl_FragCoord.xy` whenever it is combined with logical sizes, and
  `PX_SCALE` to convert. A line whose width comes from `fwidth` ("a 1.2 px hairline":
  `1.0 - smoothstep(a, b, d / fwidth(u))`) gets thinner and fainter at 4K: write it as `pxLine(d, a, b)`,
  which is identical at 1× and keeps the 1× ink with sharper edges at 4K (`rampLine` does the same for the
  linear-ramp idiom). `hatch`, `engrave` and `aaStroke` already do this. LOD thresholds and supersampling
  offsets expressed in pixels should be logical (`fwidth(u) * PX_SCALE`, offsets `/ PX_SCALE`).

## Another format

A video can also play in a second format, a 9:16 version of a 16:9 piece, say: `--size 1080x1920` in every
render.ts mode, and in the preview `?size=1080x1920` (`bun scripts/render.ts preview --video <video> --size
1080x1920` prints that link). It is the same video, with the same timeline, sound, timing data and scenes,
so a cut or a fix lands in both formats. Only the frame changes: `W`, `H`, `ctx.W` and `ctx.H` are the new
size, and render.ts writes everything for it under `out/<video>/<W>x<H>/` (its `verify.json`, stills,
sheets, `<video>.mp4`), beside the video's own format, never over it. A size with the video's own shape
is refused: that is the same picture at another size, which `--scale` makes.

- Lay out from the frame, not from numbers typed for one shape: positions, sizes and margins from `W` and
  `H` and the format's safe area (`docs/STYLE.md`; for a format the project hasn't used yet, the Layout
  tables in the code-video skill's `references/style-template.md`), so a scene recomposes instead of
  cropping.
- Where a shape needs another composition, branch on it in the scene (`const tall = H > W`): fewer
  elements, a vertical stack, type at that format's minimum size. What carries the story stays: the
  timing, the persistent actor, the palette.
- Check each format on its own (`verify`, sheets and stills with `--size`): a layout that works in one
  shape can collide, or leave the safe area, in the other.
- A format that needs another edit (another length, other scenes) is another video, with its own
  timeline and its own timing data from the soundtrack skill: `--size` shares everything but the frame.
- Offscreen canvases used as textures (atlases, text planes) keep their own size: make them `SCALE`× larger
  (with `ctx.scale(SCALE, SCALE)`) if they are shown large, or they look soft at 4K.
- Post (bloom, halation, CA, grain, vignette) and the HUD scale automatically; the bloom pyramid stays at
  the logical resolution.

## Motion blur and sampling

`video` and `poster` render every frame as the average of many sub-frames spread over the shutter
(`--shutter`, by default 0.2: a fifth of the frame time, centred on the frame's time), before
post-processing, so the delivery gets real motion blur without anyone remembering a flag. By default they
choose the count per frame (`--samples auto`); `--samples N` takes N evenly spaced sub-frames. Stills,
sheets, perf and `video --draft` take one sub-frame unless told otherwise (`stills --samples auto` shows a
moment's blur); verify's renders are fixed (one sub-frame, and four over the whole frame time at the
cuts). The adaptive count (`Engine.render`, `AdaptiveSampling`):

- The count steps through 4, 12, 36, 108, 324. Each step adds a sub-frame either side of every existing
  one, so each set is evenly spread and centred on the frame's time.
- After each step the engine compares the new sub-frames' average with the old ones' (displayed values,
  worst 2×2-logical-px block). Stepped copies of a moving edge differ between the two sets; a converged
  streak or a still image does not. Stepping shrinks as 1/count, so the frame's remaining error is about
  half the change the last step made; it stops when that is below `--tol` (default 3 levels of 255).
- In practice a still frame stops at 12, ordinary camera motion at 36, and whips, slams and fast zooms at
  108 or 324. At 1:1 in 4K, 108 can't be told from 324, while 36 still shows faint striations on the
  fastest edges.
- A sub-frame with a non-finite pixel (a stray NaN from some shader, one sub-frame in hundreds) is dropped
  from the sum, or it would poison the average and bloom into a disc.
- No sub-frame crosses a hard cut (entries that meet without overlapping, or a scene against black): the
  frame on the cut shows only the scene after it, the frame before only the one before, as on film, where
  a cut falls between two exposures. (Spread across the cut, the frame on it would double-expose both
  scenes.) Overlapping entries crossfade, which is continuous, and blur across freely. Verify checks it.
- `TimelineEntry.maxSamples` caps the count while an entry is on screen, for noise that converges slowly
  (a half-resolution G-buffer that sparkles from one sub-frame to the next).

What this asks of scenes:

- Sub-frames are rendered out of time order and in any number: a scene's output must depend on `f.t` only.
  `stateful` scenes can't be sampled adaptively (the engine refuses): when one is on screen in the range,
  `video` and `poster` take a fixed 12 sub-frames instead and say so ("Stateful scenes"). Nothing may count
  `render()` calls.
- Per-frame flicker and jitter must use `frameIdx(t)` (`util.ts`), not `Math.floor(t * fps)`. `frameIdx` is
  constant over the frame's shutter; `floor` switches at the frame's own time and double-exposes two states
  in every frame.
- Anything that changes in steps (a font stepping wider, a counter, a word lighting up, a cut inside a
  scene) changes on the frame's own time, `frameTime(t)` (`frameIdx(t) / fps`): a step taken at `t` itself
  that lands on a frame splits its sub-frames between two states, and the export shows both, a double
  image. Motion stays on `t`, so it blurs; and what moves because of a step (the rest of a line making
  room for a wider word) glides there over a few frames rather than jumping (the example's `layer2d.ts`).
- Noise that changes with continuous `t` (a hash seeded by time) is resampled in every sub-frame: it
  averages out, but slowly, and makes the adaptive sampler work harder. Seed it with `frameIdx(t)` unless
  it is meant to smooth out.
- A particle emitter whose rate varies over time passes the rate as a function of the birth time (and its
  maximum, to bound the loop): a rate read at the current `t` re-times every particle from one sub-frame
  to the next.
- Shaders that supersample internally (4 rotated-grid taps) take `ssTap: SS_TAP` and `${SS_TAP_GLSL}` and
  loop `for (int k = ssK0(); k < ssK1(); k++) ... rgss(k)`, weighting by `ssWeight()`. The engine then
  hands each sub-frame one tap, cycling them (every set is a multiple of 4), which averages to the same
  image for a quarter of the cost. In the preview and single-sample stills they take all four.
- Post parameters (shake, flash, zoom, fades, the HUD's paper mode) are read at one point of the shutter,
  1/8 of it after the frame's time (a point every sample set includes); the HUD, grain and dither are drawn
  once per frame.

## Adding a font

The project ships Archivo (width and weight steps), IBM Plex Mono, Cormorant Garamond and the stroke fonts.
To add another (a brand's own, or a script these don't cover; any OFL font, e.g. from Google Fonts):

1. **Static files.** Canvas2D (`FontFace`) and opentype.js draw a variable font only at its default
   instance, so cut the widths and weights you need into static files:
   `uv run scripts/font-instances.py "Inter[opsz,wght].ttf" --axis wght=400,700 --name Inter`
   writes `public/fonts/Inter-wght400.ttf` and `Inter-wght700.ttf` (axes left out are pinned at their
   default; `--pattern "{name}-{wght}"` names the files your way). A static font goes in as it is. A
   font only one video uses can go in its `assets/` folder instead (`--out videos/<video>/assets`).
2. **Register it** in `src/engine/type.ts`: `FONTS.push({ family: 'Inter-400', file: 'Inter-wght400.ttf' })`
   for each face (`features: '"lnum" 1'` switches on OpenType features, since Canvas2D can't), and for
   several faces a helper in `F` (`inter(weight) { return weight < 550 ? 'Inter-400' : 'Inter-700'; }`).
   `file` is relative to `public/fonts/`, so a face in a video's `assets/` is
   `'../videos/<video>/assets/Inter-wght400.ttf'`. Then `font(F.inter(700), 64)` in Canvas2D,
   `ot(F.inter(700))` for outlines; `layout()`, `glyphX()` and `textPath2D()` take the same family name. A
   file that is missing stops the page with its name.
3. **The license** goes next to the files (`public/fonts/OFL-Inter.txt` for an OFL font) and the
   project's credits name it.
