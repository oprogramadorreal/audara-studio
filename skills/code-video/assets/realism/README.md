# realism

A kit for photographic 3D shots in this engine, copied in by the code-video skill (its
`references/realism.md` has the method, the reasons and the measurements). Adapted from
[golden-temple](https://github.com/Leonxlnx/golden-temple) (MIT, Leon Lin, commit `97fd9ec`): see LICENSE.
Tested with three 0.186.

| File | What it gives |
|---|---|
| `env.ts` | one scene's sun, sky brightness and haze (`makeEnv`, `sunFrom`) |
| `materials.ts` | `patch()`: procedural GLSL inside MeshStandard/Physical materials, with the haze; `PROC` surfaces |
| `sky.ts` | the physical sky, and the environment light captured from it and from the scene |
| `light.ts` | the shadowed sun (`Sun`); `withRenderer()` for renderer settings around a draw |
| `lens.ts` | the scene's target with depth, then occlusion and a depth of field from the lens (`dofStep` for a preview path) |
| `sampling.ts` | per-sub-frame camera, sun and kernel jitter, from `src/engine/gl.ts` `SUBFRAME` |
| `camera.ts` | lens keys at times: pan and tilt, look and focus distances interpolated like a camera |
| `example.ts` | a scene that uses all of it: `E('garden', '../../../src/realism/example', a, b)` in a timeline |

Rules that keep the shared engine safe and the frames stable:

- Shadows only inside `withRenderer(r, { shadows: true }, draw)`; one shadow type (PCF) in the project.
- Sampling patterns from the sub-frame's index only (`jitter()`), never from the frame or time.
- Fine detail faded by its pixel footprint (`n_aa`), metals with `n_specAA`.
- No `scene.fog` with patched materials; no post overrides from a scene (they reach a crossfade's other
  scene): grain, vignette and exposure go in `src/look.ts` or the entry's `post`.
- Supported: fresh MeshStandard/Physical materials on Mesh and InstancedMesh, each patched once (spread a
  `PROC` surface and your own hooks into one `patch()`), static geometry, metres.
- `Sun.fit()` before every shadowed draw (each `render()`, and an environment capture): only the two Suns
  fitted last keep their shadow maps. Draw into `Lens.rt` and call `finish()` in the same render: every Lens
  of one frame size shares its targets.
- Dispose what you create: the environment target, the `Sky`, the `Sun`, the `Lens`, geometries, materials.
- Set `refine = true` on each scene built on the kit: its frame depends on its sub-frame samples. Paused
  there, the preview renders the frame again with the render's 12 sub-frames, on the preview path's
  settings ("refined" on the info line; not during a crossfade with another kind of scene, nor for a
  stateful one). Playing, it draws one sample a frame: judge flicker in short `video --samples 12` clips.
  A cheaper preview path (`ctx.export` false) changes cost, never content: `dofStep` about 1.2, a smaller
  shadow map, fewer occlusion taps.
- render.ts gives a range that shows a `refine` scene a fixed 12 sub-frames when `--samples` isn't given:
  jittered frames keep the adaptive sampler climbing, and frames it stops at different counts average
  different samples (an entry's `maxSamples` only bounds the cost). An older project's render.ts doesn't:
  pass `--samples 12` there.

Without `SUBFRAME` (an engine older than audara 0.8.0) the kit works with no jitter. To add it: in
`src/engine/gl.ts`, `export const SUBFRAME = { k: -1 };`; in `src/engine/engine.ts`, add `SUBFRAME` to its
import from `./gl`, and in `render()` set `SUBFRAME.k = k` beside `SS_TAP.value` in the sub-frame function,
and `SUBFRAME.k = -1` in the single-sample branch and after the sub-frame loops (in a `finally`). Run verify
on every video after.
