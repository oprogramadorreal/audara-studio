# Realism

A photographic 3D shot in three.js: a place or an object that reads as filmed through a real lens in real
light. Read it when the director asks for photoreal, realistic or cinematic 3D, or when the image the piece
needs is a real thing in real light (a temple at dusk, a watch on a desk, a street after rain). It is one look
among many: nothing here applies to a graphic, flat or stylized piece, and every other default of the skill
holds (the treatment, the style frames, the critic, the render). `<skill>` is this skill's folder; other
paths are the project's.

It comes from [golden-temple](https://github.com/Leonxlnx/golden-temple) (MIT, © 2026 Leon Lin, commit
`97fd9ec`), a 70-second film of a Japanese temple at golden hour made entirely in three.js and GLSL with
Claude Code: no models, textures or HDRIs, 24.4 million triangles, rendered in headless Chrome with 8
sub-frames per frame. Its techniques were ported into this engine and measured (`docs/history.md`, 0.8.0);
the kit below is that port. Its author shared how it was made
([on X](https://x.com/LexnLin/status/2110657793376039323)): about ten generated images of Japanese temples as
references, and a short prompt that set the format (ten 7-second shots, each starting close up and pulling
back), the look (golden hour, as real as possible, light and shadows first, matching the references), the
bars (everything in code; "2x more than you think is enough" detail, the ground good from above too; clean
light and shadows with zero flickering) and the loop (verify and iterate until it matches the references,
without stopping early). Almost everything below is what the model built to meet those demands; the
references and the loop are "The method".

Contents: When it earns its place · What makes it read as real · The kit · Stable in motion · Sampling and
cost · The method · Prompting · Limits

## When it earns its place

- Built and natural things in real light: architecture, stone, wood, lacquer, metal, water, terrain, plants
  seen as masses; a product with simple, modelled forms; a landscape.
- Not people, faces or animals: code draws them poorly, and a photoreal one reads as uncanny
  (`references/images.md` when a person must be seen; AI clips only as footage the director asks for).
- A modelled hero with organic forms (a character, a sculpted face), cloth, fluids or path-traced glass:
  `references/blender.md`. The kit lights and shades a GLB loaded from Blender like any other mesh.
- Without a director's word for it, a realistic look is a choice like any other in Look: one of the style
  frames, not the default for 3D.

## What makes it read as real

What golden-temple's loop produced, in the order that matters, from its code and from ablations in this
engine (history.md, 0.8.0):

1. **Modelled detail where the lens looks.** Most of golden-temple is its world: 28,000 of its 31,000 lines
   build bracket sets, roof tiles, carvings, trees and lotus. Light and materials turned a simple close-up
   into a photograph in the port, while the wide shot of the same simple scene still read as CG: the
   geometry the camera resolves sets the ceiling.
2. **Light that holds together.** One sun, low for long shadows and warm light; a physical sky; the
   environment light captured from that sky and then from the built scene (one bounce for free); the same
   haze inside every material, so far things go blue and soft as they do outdoors. One `Env` (the kit's
   env.ts) feeds all of them, which is why they agree.
3. **Surfaces with history.** three's PBR materials with procedural wear on top: faded patches, worn edges,
   grime near the ground, moss on what faces up, tarnish, roughness that varies with all of it. Every fine
   term fades out as it shrinks below a pixel, or it shimmers in motion.
4. **A lens.** A focal length in mm, a focus distance and an f-stop, and a depth of field computed from
   them; occlusion in the creases.
5. **Samples over the sub-frames.** Each sub-frame moves the camera by a fraction of a pixel, the sun inside
   its disc and the occlusion kernel, so the average has wide anti-aliasing, soft penumbrae and clean
   occlusion, always the same for a still surface.
6. **Staging.** Every golden-temple shot opens on a macro of one detailed object (a lantern, a lotus, a
   bell) and pulls back to reveal the place, as its prompt asked: the close-up is where detail is
   affordable and convincing, and haze and depth of field carry the wide end. Its world is laid out for
   the cameras: the hero lotus sits exactly at the first key's focus point, and lanes are kept clear for
   the lens.

The tone curve barely matters: AgX against the engine's shoulder on the same frame was a small difference.
Leave the engine's post as it is; grain, vignette or exposure go in `src/look.ts` or the entry's `post`.

## The kit

`<skill>/assets/realism/` is the port, copied into a project when a piece needs it: copy the whole folder to
`src/realism/` (its LICENSE travels with it). Scenes in `videos/<video>/scenes/` import it as
`../../../src/realism/<file>`. Pinned to three 0.186 (it edits three's shader text).

| File | What it gives |
|---|---|
| `env.ts` | `makeEnv()`, `sunFrom(elevation, azimuth)`: one scene's sun, sky brightness and haze; `aerialGLSL()` for a ShaderMaterial of your own |
| `materials.ts` | `patch(material, hooks, env)`: GLSL into MeshStandard/Physical, with the haze and a stable shadow filter; `PROC`: lacquer, gold, bronze, granite, wood, plaster; `n_aa`, `n_specAA`, `n_bumpView` for your own |
| `sky.ts` | `createSky(env)`, `captureSkyEnv()`, `captureEnv()`: the sky dome and environment light (the caller disposes the returned target) |
| `light.ts` | `Sun`: shadowed, its frustum fitted to the shot, jittered in its disc; `withRenderer()`: renderer settings for a draw, restored however it ends |
| `lens.ts` | `Lens`: the scene's 4x multisampled target with depth, then occlusion and depth of field into `out`; `focalToFov()` |
| `sampling.ts` | `jitter()`, `jitterCamera()`: this sub-frame's samples from the engine's `SUBFRAME` |
| `camera.ts` | `lensAt(t, keys)`, `applyLens()`, `reveal`: lens keys at times; direction, look and focus distances interpolated the way a camera moves |
| `example.ts` | a scene using all of it (a gilt finial pulling back to a gate); play it with `E('garden', '../../../src/realism/example', a, b)`, then copy it into `scenes/` to make it yours |

What it supports, and what it doesn't: fresh MeshStandardMaterial or MeshPhysicalMaterial on Mesh and
InstancedMesh, static geometry (a vertex displacement would cast the undisplaced shadow), metres as units,
one sun. Its `Env` defaults are golden-temple's golden hour: change them for the piece. Edits to `src/realism/`
reload the preview page; edits to a scene hot-swap it.

The jitter needs the engine's `SUBFRAME` (`src/engine/gl.ts`, from 0.8.0). In an older project the kit still
works without it, with no jitter; to add it, export `export const SUBFRAME = { k: -1 };` from `gl.ts`, add
`SUBFRAME` to `engine.ts`'s import from `./gl`, and in `Engine.render` set `SUBFRAME.k = k` beside
`SS_TAP.value` in the sub-frame function and `SUBFRAME.k = -1` wherever `SS_TAP.value = -1` is set (the
single-sample branch, and after the sub-frame loops, in a `finally`), then run verify on every video.

## Stable in motion

What keeps a photographic frame from crawling, shimmering or flickering between frames (golden-temple
measured each on footage, not stills):

- Every sampling pattern depends on the sub-frame's index, never on the frame's number or time (`jitter()`).
- Fine procedural detail fades by its pixel footprint (`n_aa(period)`), metals get rougher where the normal
  turns fast across a pixel (`n_specAA`), and a small bright feature (a droplet, a rivet) shrinks away once
  it is under a pixel, so it doesn't sparkle.
- Shadows: a fixed PCF rotation (patch does it), the softness from the sun's disc; the shadow frustum fitted
  to the shot (`Sun.fit`), the smallest radius that holds what casts and receives.
- The renderer is shared: shadows on only inside `withRenderer()`, which restores every setting even when a
  draw throws; one shadow type (PCF) in the whole project, since three rebuilds shadowed materials when it
  changes. No `scene.fog` with patched materials: the haze replaces it.
- A post override returned by a scene applies to the whole frame, the other scene of a crossfade included.

## Sampling and cost

- The preview plays the example scene in real time (8-10 ms a frame at 1080p on a laptop GPU): one sample, no
  jitter. A heavier scene gets a cheaper preview path (`ctx.export` false): a smaller shadow map, fewer
  occlusion taps, never other content.
- Jittered sub-frames never converge to the adaptive sampler's threshold quickly: a near-still frame went to
  108 sub-frames, where it stops at 12 without jitter, and frames it stops at different counts average
  different samples. Render a photographic stretch with a fixed count (`video --samples 12` measured 0.12 s
  a frame at 1080p for the example, about 3x a draft). An entry's `maxSamples` only bounds the cost, in a
  video whose other stretches want adaptive sampling: check a moving clip if you use it.
- Say how long the render will take before a long one. golden-temple's 70 s took 4 hours at 3.3 s a frame,
  on an integrated GPU, with 24 million triangles.

## The method

The quality came from a loop: a visual target, bars named in plain words, and iteration until the renders
matched. The kit saves the hours of finding the techniques; the loop is still the work.

- **A reference board.** About ten stills of what the piece should look like, at the framings the shots
  will have: the director's photos, public-domain ones, or generated ones (golden-temple's author generated
  his). Generating costs (about $0.04 an image with `imagegen.py`, `references/images.md`), so it waits for
  the director's yes like any image; offer it in the brief with its cost, and build meanwhile. References
  are a target, never material: they stay out of the frame, and each gets a `SOURCES.md` row whose Used
  column says "reference only".
- **Side by side.** Compare a still with its reference at the same moment of the shot, in one image:
  `ffmpeg -i out/<video>/stills/f_0004.50.png -i videos/<video>/assets/ref-03.png -filter_complex
  "[0]scale=-2:720[a];[1]scale=-2:720[b];[a][b]hstack" out/<video>/refs/compare-03.png`. Name the largest
  difference first (light direction and colour, contrast, haze with distance, density of detail, wear,
  scale), fix it, render again; keep the pairs as the evidence of each round.
- **Bars in plain words.** The ones golden-temple's prompt set are the ones that matter: light and shadows
  first; detail past what seems enough, the ground included, seen from above too; clean light and shadows
  with zero flickering, checked in motion. "Stable in motion" above is what the last one took.
- **Iteration is the budget.** Its prompt asked the model to keep going until the match was close, even if
  it took days, and the film took a long session of parallel agents. Agree the time with the director (a
  realistic piece of a minute is hours, not one turn), say where it stands in each status line, and stop
  when the critic's list of what reads as CG first is down to the cosmetic, or the budget is spent.
- **One plan first.** Units (metres), where everything stands, the time of day (one `Env`), the shared
  materials. golden-temple kept them in a site plan and an environment file every module read.
- **The world for the camera.** Write the shots' lens keys early, then place and detail what they see: the
  hero object at the first key's focus distance, nothing in the lens's path, detail spent by distance to it.
- **One author per hero.** With many shots, a scene author per hero object and its shot (the scene briefs of
  `references/treatment-template.md`), each given the plan, the `Env` and the kit; shared materials and the
  `Env` change through the lead.
- **Close and wide.** Compare both ends of every shot with the references: fix what reads as CG first (edges
  too sharp, surfaces too clean, light without a source, scale without detail).
- **Motion before more detail.** A short moving clip at the render's sampling, checked for shimmer and
  crawling, before the world grows. In golden-temple, camera acceleration spikes were measured and smoothed.

## Prompting

golden-temple's prompt had five parts, and a director's request for a photographic piece reads well the
same way (each part optional; the treatment's defaults fill the rest):

1. the format and the shots' grammar (how many, how long, how each moves);
2. the look, with references to match and how closely;
3. what has to be code, and what may come from outside (its music was a free track found online);
4. the bars: where the detail goes, light and shadows clean, no flicker;
5. the loop: verify, compare, iterate, and how long it may take.

> a 20-second photoreal shot of a temple at golden hour: open on a macro of a weathered bronze bell under
> red-lacquered eaves, then pull back to reveal the pagoda in haze. Match the references in refs/ as closely
> as you can. Everything in code. Light and shadows first, clean, with no flicker; detail everywhere the
> camera goes, the ground too. Verify against the references and keep iterating, take the afternoon.

The subject and its hero object, the time of day and weather, the lens per moment, the references and the
time budget are the levers; a brief asks for those only when the piece rests on them (references and time
do, for a photographic piece: offer generated references with their cost when none are given). For the
critic, the director's "photoreal" is the bar: give it the references and the side-by-side pairs, and ask
what reads as CG first.

## Limits

- Wide shots of large, detailed places need modelling to match (golden-temple's world is 28,000 lines built
  by several agents); a short piece is better spent on a few close subjects and one reveal.
- The engine's scene-level passes are rasterized approximations (environment captures, screen-space
  occlusion), not path tracing: glass, caustics and soft bounce light inside closed rooms are Blender's.
- Long photographic films render for hours: plan the length with the director.
