# The engine contract

What a scene may assume, what it owes the engine, why, and the edge cases that catch capable authors in
this engine. Before the first scene, read the first two sections, then the ones your scenes touch; give
its path to scene authors along with `docs/ENGINE.md` (the API and its rules: what to call, and how) and
`references/motion.md` (how things should move). This file holds the reasons and the measurements; the
code for each rule is in `docs/ENGINE.md`. Paths are the project's; `references/…` are this skill's files.
Numbers marked "measured" come from an Intel integrated GPU (ANGLE, Direct3D 11) at 1920×1080 unless they
say otherwise.

Contents
- The rule, and what rests on it
- What verify can't see
- Randomness, flicker and steps
- Noise and emitters
- Stateful scenes
- What render() leaves in `out`
- Time from the data
- Cuts and transitions
- three.js in this engine
- Images and footage
- 4K
- Performance and the cheaper preview path
- Changing the engine

## The rule, and what rests on it

**`render(f, out)` draws the same pixels for the same `f.t`, whatever was drawn before.** Its inputs are
`f.t` and what the Frame derives from it, the video's data, the entry's params and seeded randomness;
nothing carries over from one call to the next. Writing renderers this way comes naturally; what this engine
adds is how much hangs on it:

- **The preview is the render.** The director approves what the preview plays, and the render must be that
  picture, only cleaner. The same code runs live at one sample per frame and headless at up to 324.
- **Every moment is a link.** `?t=` opens exactly that frame, so a note by time is checked in seconds.
- **Motion blur.** The render averages 12 to 324 sub-frames per frame, spread over a fifth of the frame time
  (the shutter) and rendered out of time order: 4 evenly spread, then two more around each, until the
  frame stops changing.
- **Ranges render alone.** Stills, a `--from`/`--to` clip and pieces rendered separately are the frames the
  whole video has (measured: two halves rendered side by side and joined with ffmpeg's concat matched a
  single render frame for frame, to the encoder's precision).
- **It can be checked.** `render.ts verify` renders the same `t` after different seeks (from 1 s before,
  1 s after, from 0, and straight after the frame before) and fails on any pixel that differs; it also
  checks that motion blur never carries a scene across a hard cut.

## What verify can't see

verify compares single-sample frames reached by different seeks. Each pattern below passed it in testing
while being wrong somewhere verify doesn't look:

| Pattern | Passes verify, but | Where |
|---|---|---|
| `Math.floor(t * fps)` for flicker | every rendered frame shows both states at half strength | Randomness, flicker and steps |
| noise seeded by continuous `t` | the grain the preview shows averages away in the render | Noise and emitters |
| a `stateful` scene adding up `f.dt` | a simulation that isn't linear ends up somewhere else in the preview, after a seek and in the render | Stateful scenes |
| `mixer.setTime()` with a play-once clip | jumps back to the start once the clip has ended | three.js in this engine |

`Math.random()`, a generator kept across `render()` calls and a target left half-drawn do fail it, with the
scene's name.

## Randomness, flicker and steps

- `Math.random()`, `Date.now()` and `performance.now()` never reach the picture. `hash(i, seed)` is
  stateless: it gives each particle, glyph or cell its own value. `mulberry32(seed)` returns a generator
  that advances on every call: fill arrays from it in `init()`, or make a fresh one inside `render()`.
- Per-frame flicker and jitter key on `frameIdx(t)`, never `Math.floor(t * fps)`. A rendered frame's
  sub-frames are centred on the frame's own time, and `floor` switches exactly there, so half of them see
  one state and half the other (measured: a black/grey alternation keyed on `floor` rendered as a steady
  mid-grey; keyed on `frameIdx`, each frame kept its state). `floor` misses even at one sample: for about one
  frame in twenty at 30 or 60 fps (one in seven at 24), the frame's own time times fps comes out a hair under
  its index (frame 31's time is 31 × (1/30), and that × 30 is 30.999…) and floors to the frame before.
- Anything that changes in steps (a counter, a word lighting up, a font stepping wider, a cut inside a scene)
  changes on `frameTime(t)`, so the step falls between two frames instead of splitting one frame's
  sub-frames into a double image. Motion stays on `t`, so it blurs.
- A cache across frames is fine when its key is everything the result depends on (a layout per line of
  text, a layer redrawn when its text changes). A cache keyed on "the last frame" is state.

## Noise and emitters

**Noise** that changes over time is seeded with `frameIdx(t)` unless it is meant to smooth out. Seeded with
continuous `t`, every sub-frame draws new noise, the render averages it away, and the sampler works hard to
do it (measured on a patch of grain: a standard deviation of 42 levels in the preview and in stills, 3 in the
render; every frame climbed to the 324-sub-frame ceiling instead of stopping at 12). The director would
approve grain the MP4 doesn't have.

**Particles without state:** particle `n` is born at `n / rateMax` on a fixed clock, takes everything else
from `hash(n, …)`, and is placed from its age; a rate that changes over time thins the births (keep `n` when
`hash(n) * rateMax < rate(tb)`) instead of moving them. The code is in `references/glsl-cookbook.md`,
"24. Deterministic particles". Birth times read from the rate at the current `t` slide as `t` moves, every
particle with them (computed: a one-second-old particle moved 17 px per frame instead of 10, and its streak
came out 1.6 times as long).

## Stateful scenes

The pattern and its code are in `docs/ENGINE.md`, "Stateful scenes": a closed form or a table built in
`init()` first (more ways in `references/glsl-cookbook.md`, "25. Motion without state"), `stateful = true`
only for what can only run forward (feedback buffers, a GPU simulation, a physics engine), and then a
simulation stepped at its own fixed rate, counted from the entry's start, to the step `f.t` calls for. Why
each part:

- **A function of `t` first.** It keeps adaptive motion blur and exact seeks; a table costs memory in
  proportion to its length. The render can't sample a stateful scene adaptively: a range that shows one
  renders at a fixed 12 sub-frames, the whole range and not just that entry, so fast motion elsewhere shows
  steps. Give a higher count for the whole render (`--samples 36`), or render the stateful stretch as a
  piece of its own (end of this section).
- **Its own fixed step, not `f.dt`.** `f.dt` is the video time since the scene's last render, and that
  depends on how the frames are drawn: the display's rate in the preview, the frame grid after a seek, the
  sub-frame spacing in the render. Added up, it keeps the right speed but takes different steps in each,
  and a simulation that isn't linear (a bounce, a collision, a stiff spring, flocking) ends up somewhere
  else in each (measured: a ball bouncing under gravity, 2.9 s into its entry, was drawn 18 px away from
  where a seek put it after playback at 240 frames a second, and 9.5 px away after a 12-sub-frame render;
  stepped at 1/240 s from the entry's start, it was on the same pixel in all three). Paused, `f.t` doesn't
  move and nothing steps.
- **Counted from the entry's start.** A seek then replays exactly what playback did, at a cost that grows
  with the time since the start. Counted from the first `f.t` after `reset()` instead, the replay is bounded
  by `prerollMax` (6 s by default), and the state must forget what came before within that time, or a frame
  reached by a seek differs from the same frame in the render.

verify's seeks all replay the same way, so they agree even when the state hasn't settled. Check a stateful
scene by comparing a still at `t` (reached by a seek) with the frame at `t` of a clip rendered from the
entry's start.

Rendering in pieces, to give a stateful stretch its own sample count (or to split a long render):

```
bun scripts/render.ts video --video <video> --from 0 --to 42 --noaudio --out out/<video>/part1.mp4
bun scripts/render.ts video --video <video> --from 42 --to 60 --noaudio --out out/<video>/part2.mp4
ffmpeg -f concat -safe 0 -i out/<video>/parts.txt -c copy out/<video>/picture.mp4
ffmpeg -i out/<video>/picture.mp4 -i videos/<video>/audio/<file> -map 0:v -map 1:a -c:v copy -c:a aac -b:a 320k -shortest out/<video>/<video>.mp4
```

`parts.txt` lists `file 'part1.mp4'` and `file 'part2.mp4'`, one per line. The last line fits a soundtrack
that is one file played from 0. The soundtrack goes on once, over the joined picture: pieces that each carry
their own audio drift by about 50 ms at every join (measured).

## What render() leaves in `out`

- `out` is a HalfFloat target holding linear HDR colour, one of a few the engine reuses across entries and
  frames: whatever `render()` doesn't draw shows a previous frame or another scene. Start with a fullscreen
  pass, `clearRT(renderer, out, LIN.bg)` or a `comp.draw(…, { mode: 'replace' })` of a full-frame target.
  The renderer's `autoClear` is off, so a three.js pass after a fullscreen pass clears depth itself
  (`renderer.clearDepth()`).
- `render()` is synchronous, and the engine doesn't wait for anything it returns. Everything it needs
  (images, models, decoded frames, tables, text layouts) is ready when `init()` resolves. `init()` runs for
  every entry when the page boots, and every render.ts run boots a page: a slow `init()` costs every reload
  (`--only` loads just the entries named).
- Colours are linear: `C_<KEY>` in GLSL, `LIN.<key>` for uniforms and three.js, `rgba('<key>', a)` for
  Canvas2D, whose layers are sRGB and decoded on upload. The palette is the project's (`src/look.ts`), and
  scenes name its colours by role, so a change to the look reaches every scene.
- What glows: the bloom starts at about 0.7 linear (threshold 1 with a soft knee), and the tone shoulder
  rolls off everything above 0.72, so pure white over a large area lands at 246 of 255 with the default
  bloom and 243 with it off (measured), and a white title on a dark ground gets a faint halo by default. A
  scene that must stay crisp returns `{ bloom: 0 }` or keeps its values under 0.7; values above 1 are for
  light that should glow.
- three.js frees GPU memory only in `dispose()`, and the preview swaps a scene on every save: free the
  targets, textures and geometry the scene made there.

## Time from the data

Every time in the picture comes from `ctx.audio` and `ctx.words`, or from another time computed from them:
cuts from `audio.downbeats` and `audio.sections`, accents from `audio.events(…)` and `f.a`, text from
`words.get('…')` by its words, a named hit from `audio.cue('…')`. Never typed seconds. The data is
measured, so the picture follows it when the soundtrack changes, a note like "two bars later" is a one-word
change, and the preview, stills and render agree because they read the same JSON. What lands on which beat
is craft: `references/motion.md`.
- `words.get()` and `audio.cue()` throw when the text or cue isn't there, and the scene shows its error in
  the preview and renders dark red. Let it: a scene that quietly falls back draws at the wrong time.
- Without `data/audio.json` a beat grid at `video.json`'s `bpm` stands in, but envelopes and onsets read 0:
  a scene driven by `f.a.kick` sits still until the analysis exists (verify warns).
- Times a scene uses more than once (a line's word times, the beats a camera passes through) are found in
  `init()`. The page reloads when the data changes, so they stay current.
- Durations are craft and can be typed (a 0.3 s snap), or counted in beats when they should follow the tempo.

## Cuts and transitions

- Entries that touch make a hard cut, the default: the change lands on one frame, which a downbeat can
  carry. A crossfade spreads it across the overlap and reads in its middle, so a dissolve meant to land on a
  beat is centred on it.
- The render keeps every sub-frame on its own frame's side of a hard cut: the frame on the cut shows only
  the scene after it, the frame before only the scene before, as on film. Spread across the cut, every cut
  frame would double-expose; verify checks it. A crossfade is continuous and blurs freely.
- A gap between entries renders black (verify warns). `sheet --cuts` shows the frames around every cut.
- Overlapping entries crossfade by default, linearly in linear light. For another transition set
  `handlesTransition = true`: the scene gets the previous scene's frame as `f.under` and the overlap's
  progress as `f.tin` (0 to 1), composites them itself, and still draws every pixel of `out`. `f.tout` is
  the progress into the next scene's overlap.
- Something carried across a cut takes its pose from one function both scenes call
  (`references/motion.md`, "Cuts and carried objects").

## three.js in this engine

The rule, applied to three.js:
- Build the scene graph, cameras, materials and geometry in `init()`, models too:
  `await new GLTFLoader().loadAsync(url)` (from `three/addons/loaders/GLTFLoader.js`), with the file in the
  video's `assets/` folder (`new URL('../assets/model.glb', import.meta.url).href` from a scene). An
  environment map from `PMREMGenerator` is made there once: `fromScene` allocates a new target on every call.
- Every transform, camera setting, uniform and material value is set from `f.t` in `render()`. No
  `THREE.Clock`, no `requestAnimationFrame`, no `mixer.update(delta)`.
- `mixer.setTime(lt)` is a function of `t` only for clips that loop (the default) without fades or warps.
  A play-once clip (`LoopOnce`, `clampWhenFinished`), `fadeIn`, `crossFadeTo` or `warp` changes the
  action's state the first time the mixer passes their end, and `setTime` doesn't undo it (measured with
  `LoopOnce` and `clampWhenFinished`: the frame after the clip's end snapped back to its first pose, and so
  did every earlier time from then on; verify passed, since every frame it compared was wrong the same way).
  For those, set each action's time and weight from `t` and call `mixer.update(0)`: the code is in
  `docs/ENGINE.md`, "Writing a scene".
- Draw into `out`, or into a target of your own that you then `comp.draw` into it. three.js writes linear
  colour there and applies no tone mapping or output conversion, which run only when drawing to the canvas:
  `renderer.toneMapping` and `outputColorSpace` change nothing for a scene (measured). The engine's post
  does that job for the whole frame.
- Colours: `new THREE.Color('#406080')` converts from sRGB and comes out exact; `setRGB(r, g, b)` takes
  linear values (`LIN` triplets as they are), and sRGB numbers given to it come out washed out (#406080 as
  about #89A5BC, measured). Colour textures need `colorSpace = THREE.SRGBColorSpace`: `TextureLoader` and
  `CanvasTexture` leave it unset, which reads as linear and washes the image out the same way (measured).
  Data textures (normals, masks, coverage) stay unset. `GLTFLoader` sets its own textures' spaces.
- The renderer is shared by every scene and by the engine: leave its settings as they were. For a split
  screen or an inset, render each view into a target of its own (`makeRT(w, h)`) and place it with
  `comp.draw(…, { rect })`, in logical px at every scale: `renderer.setViewport` and `setScissor` count the
  target's physical px.
- three.js's own lines are one physical pixel wide whatever `linewidth` says, so they halve at 4K
  (measured); `LineBatch` draws lines with a width.
- A physics engine that has to run forward is stateful (above); one that can run ahead in `init()` into a
  table keeps adaptive blur, and particles need no state at all ("Noise and emitters").
- `docs/ENGINE.md` lists what the example's three.js scene ran into: aliased edges without a multisampled
  target of your own (and the seam a colour gradient makes there), an `InstancedMesh` culled by its first
  frame's bounds, light intensities in multiples of π, a straight-down camera's `up`.

## Images and footage

- Images and models go in the video's `assets/` folder, loaded in `init()`:
  `await new THREE.TextureLoader().loadAsync(url)` with `colorSpace` set as above, or an `Image`
  (`img.src = url; await img.decode()`) drawn into a `Layer2D`.
- They pass through the same post as everything else: the bloom lifts the blacks around a bright image
  (from 0 to 11–23 next to a white frame) and the tone shoulder lands white at 243 even with `{ bloom: 0 }`
  (measured). A picture that must match its file (a logo, a screenshot, a product shot) needs the shoulder
  off for its entry: an engine change in `src/engine/post.ts`.
- Footage (the director's own clips) never plays through an `HTMLVideoElement` or a `VideoTexture`: it runs
  on the wall clock and seeks asynchronously, `render()` can't wait, and the preview, stills and render
  would each show a different frame for the same `t`. Extract the frames with ffmpeg at the size they're
  shown and at the footage's own rate (`-ss` before `-i` cuts on the exact frame; `f_0001.jpg` is the frame
  at `<in>`), into a folder made first, since ffmpeg doesn't create one (`mkdir -p` works in PowerShell too):

```
mkdir -p videos/<video>/assets/<clip>
ffmpeg -ss <in> -t <seconds> -i <footage> -vf "fps=<rate>,scale=<width>:-2" -q:v 3 videos/<video>/assets/<clip>/f_%04d.jpg
```

In `init()`, decode each frame (`await img.decode()`), wrap it in a `THREE.Texture` with
`colorSpace = THREE.SRGBColorSpace`, no mipmaps (`generateMipmaps = false`, `minFilter = THREE.LinearFilter`)
and `needsUpdate = true`, and upload it with `renderer.initTexture(tex)`, so playback never waits for an
upload. In `render()`, pick by `frameTime(t)`, so all of a frame's sub-frames show the same footage frame
(its own motion blur is in the picture already):

```ts
const k = clamp(Math.floor((frameTime(f.t) - clipStart) * RATE + 1e-6), 0, this.frames.length - 1); // f_0001.jpg is 0
this.ctx.comp.draw(renderer, this.frames[k]!, out, { rect: [x, y, w, h] });
```

Measured: 120 frames at 960×540 decoded in 0.1 s and uploaded in 0.3 s at boot, and showing one costs
nothing. Each takes width × height × 4 bytes of GPU memory (2 MB at 960×540, 8 MB at 1080p): seconds of
footage, not minutes.

## 4K

`--scale 2` renders twice the logical size. The director approves at 1×, so the 4K frame must be the same
picture, only sharper. Scenes lay out in logical px (`W` and `H` never change), and the engine scales its
targets, `Layer2D`, `LineBatch` and the post. What it can't scale for a scene:
- In GLSL, `gl_FragCoord`, `fwidth` and `dFdx` are physical px. `FRAG_PX` is the fragment's position in
  logical px, with its origin at the bottom left like `gl_FragCoord`, while Canvas2D and `comp.draw`'s
  `rect` count from the top left. `PX_SCALE` converts.
- A line whose width comes from `fwidth` gets thinner and fainter at 4K; `pxLine` and `rampLine` keep the
  1× ink.
- Canvases and textures a scene makes itself (an atlas, text on a 3D plane) are made `SCALE`× larger, with
  `ctx.scale(SCALE, SCALE)`, or they look soft. `getImageData` works in physical px.
- three.js's own lines (above). `makeRT(w, h)` takes logical px; `{ pxScale: 1 }` is for a target sized by
  its data.

Check with stills at both scales: downscaled, the 4K frame should match the 1× one. The rest is in
`docs/ENGINE.md`, "Output scale (4K)".

## Performance and the cheaper preview path

The preview plays in real time while a frame costs under about 16 ms (33 ms still plays, at 30 frames a
second). Measured at 1080p: the engine's own post costs about 1.6 ms a frame (4 ms at 4K, 2.5 times as
much), and the example's scenes 0.3–2.6 ms each. Where a scene's time goes:
- **Canvas2D uploads cost by area.** A full-frame `Layer2D` redrawn every frame costs about 9 ms (40 ms at
  4K); a layer the size of its text (1728×255) costs 1.5 ms (7–8 ms at 4K). Draw what never changes once in
  `init()`, redraw a layer only when what it shows changes, and give changing text a layer only as big as
  the text, placed with `rect`.
- **Precompute in `init()`:** text layouts, geometry, tables, simulations.
- **The render multiplies a scene's cost** by its sub-frames, on top of what every frame pays: the
  readback (about 15 ms at 1080p), the transfer to ffmpeg and the encode, about 60 ms a frame at 1080p in
  all (measured: the 17-second example's 1,020 frames took 60 s as a `--draft`, one sub-frame each, and
  about 115 s as the render, most frames at 12). A scene that keeps the sampler at 324 renders 27 times as often
  as a still one: tell the director how long a render will take before starting a long one.
- **Measure** with `bun scripts/render.ts perf --video <video> --from <a> --to <b> --only <entry id>`: the
  preview's cost split into the engine's share and the scenes', and what the render pays for a frame of one
  sub-frame, with the readback. It leaves out the transfer and the encode: a few seconds of
  `video --draft` time those.

A scene too heavy for real time gets a cheaper preview path, not a simpler idea. `ctx.export` is false in
the live preview and true for everything render.ts draws:
- What may change: internal resolution (render into `makeRT(W / 2, H / 2)` and draw that into `out`), step
  and tap counts, shadow and occlusion quality. What may not: shapes, timing, colours, framing. The render
  shows what the director approved, only cleaner.
- Lower the resolution before the step count: with too few raymarch steps a silhouette moves where grazing
  rays no longer reach it.
- Keep pixel-scale detail (hairlines, grain, hatching) at full resolution: upscaled from half, hairlines
  soften and anything sized in pixels doubles. Compute the heavy part small and draw the fine lines on top
  at full size (`references/glsl-cookbook.md`, "6. A half-resolution G-buffer"; "8. Cheaper paths" has more
  cuts that keep the content).
- Check it: `stills --t <t> --as-preview` (it writes to `stills-preview/`) beside `stills --t <t>`, the
  render's own frame with `poster --t <t>`, both paths' cost with `perf`, and the preview path's
  determinism with `verify --as-preview` (its report is `verify-preview.json`, so `verify.json` stays the
  full-quality one that `qc.py --cuts` reads).
- A cheap buffer that sparkles from one sub-frame to the next keeps the sampler climbing: cap it with the
  entry's `maxSamples` (at 4K, 108 can't be told from 324). A shader that supersamples with 4 taps takes one
  tap per sub-frame in the render through `SS_TAP` (`docs/ENGINE.md`, "Motion blur and sampling").

## Changing the engine

The project owns its copy of the engine (`src/`): change it when the video needs it (a post option, a new
pass, a fix), as freely as a scene. Keep `docs/ENGINE.md` in step, since it is what scene authors read; run
verify on the whole video rather than `--only`, since every scene runs on the engine; and while scene authors
work in parallel, engine changes go through the lead. The engine is held to the rule too, and verify's
determinism and cut checks are its regression test.
