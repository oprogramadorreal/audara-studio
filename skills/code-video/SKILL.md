---
name: code-video
description: "Makes videos from code: music videos, lyric videos, motion graphics, animated explainers, title cards, loops and social clips, drawn with WebGL/GLSL, three.js and Canvas2D, directed in a live browser preview and rendered to MP4. Use it whenever the user wants a video or an animation made, cut to a song or a voiceover, changed, previewed or rendered, even if they don't say \"motion graphics\" or \"code\", and in any project that has videos/*/video.json. Not for editing camera footage or for generating clips with AI video models."
---

# code-video

The user directs; you make the rest. A video's parts are its idea, words (script or lyrics), voice, music and effects, look, pacing, length and format. What the director decides, follow exactly and write down; what they leave open is yours, and should impress, not just work. They never touch code, and can take back any part at any time. Their words outrank this skill; only where the result would break (sound off the picture, a failed render) say what breaks, offer a fix, and do what they pick. Paths are this skill's, except `videos/`, `src/`, `docs/`, `scripts/`, `out/`.

## When the look is yours
Aim for a piece people would watch twice. Start from an image that carries the idea: for a song, tied to its words sideways rather than illustrating each line; for an explainer, the mechanism itself, staged so it surprises. Pick the means that image needs, not the habitual one: light and depth, one flat field, a treated photograph or type alone can each be the bold choice. The picture changes most where the sound does. A frame that could be a slide isn't done. What the director pins down (the look, a shot), even to something plain, make exactly that, well.

## Fixed
The rest is a default: depart from it when the piece gains, and say why.
- **Every frame is a pure function of time `t`.** Seeded randomness, `frameIdx(t)` for flicker, state only in `stateful` scenes: the preview matches the render. `render.ts verify` checks it.
- **Money waits for a yes.** Before anything that costs (voice, music, images, paid tools), say what it makes and costs. Only the director's own words are a yes: a budget they set covers what fits it (its running total goes in the treatment's Decisions); a key in the environment, or a question tool that answers at once, is not.
- **API keys stay in the environment**, never in files, logs or command lines.
- **Licenses are respected:** fonts, images, footage and voices keep theirs; every file from outside code gets a line in `videos/<video>/assets/SOURCES.md`.
- **Every change comes back with a link:** this project's preview with `?v=<video>&t=<seconds>`, written out in full.

## A session
Keep this checklist in your notes.
- [ ] **Brief.** Write `videos/<video>/TREATMENT.md` (references/treatment-template.md) and post it (a short one whole) in a message before any scene; keep building, the director steers whenever they like. Wait only for what they alone can decide (a fact or file only they have, two readings that make different videos, a piece over a minute, their own "plan first"), in one message whose defaults let "go" answer it.
- [ ] **Setup.** Check bun, run init, start the preview and post its link in a message.
- [ ] **Look.** When it's yours, render two or three style frames: the key moment, its words included, in the engine, each a different idea of what's staged (inside what the director said), not one layout restyled; pick by looking, post them. Then write `docs/STYLE.md` (references/style-template.md), `src/look.ts` and the treatment's Look from the pick.
- [ ] **Sound.** A song: beats, sections, lyrics and its window (references/treatment-template.md). Sound nobody gave or ruled out is yours, aimed as high as the look: music and effects synthesized in code are free; generated voice or music is asked for while you build with a free stand-in (the soundtrack skill). The picture never waits: `"audio": null` and a `duration`.
- [ ] **Build.** First read `docs/ENGINE.md` (by sections), the first two sections of references/contract.md and those your scenes touch. Many scenes: one subagent per scene, on your own model (Scene briefs in references/treatment-template.md). Look at each scene's stills as a viewer would.
- [ ] **Critic.** Before it's done: a fresh full-cut critic, then its verification (references/critique.md). A plain picture nobody asked for is a finding, not taste.
- [ ] **Render.** The first build ends with the MP4 unless the director wants to watch the preview first; after that, render when they say. Keep your turn open until it ends: ending it can kill the render. The reply links the MP4, sheets and poster, gives qc.py's `motion`, `glance` and `blank` lines with a `?t=` link to each hold the treatment doesn't mark, and the critic's verdict.
- [ ] **Direct.** Notes come by time ("at 0:23 land the title on the snare"). Change what the note names and what it forces, look at the frames around it, answer with the link and what moved (old → new). A note that reads two ways: take one, offer the other. Each decision, and each thing the director turns down, goes in their words into the treatment's Decisions (project-wide: `docs/STYLE.md`); read them before every change.

Also owed: a status line during long work; the work shown (stills, sheets, numbers, verdicts).

## Commands
Run in the project folder; `<skill>` is this skill's folder. All options: the header of `scripts/render.ts`.

| Step | Command |
|---|---|
| New project or video | `bun <skill>/scripts/init.ts . --video <video>` |
| Preview | `bun scripts/render.ts preview --video <video> --t 12.5` (starts it if needed; it outlives your turn) |
| Stills, then look | `bun scripts/render.ts stills --video <video> --t 1.5,4 [--only <entry id>]` |
| Contact sheet | `bun scripts/render.ts sheet --video <video> --n 24` (`--cuts`: around every cut) |
| Check | `bun scripts/render.ts verify --video <video>` |
| Clip, render, poster | `bun scripts/render.ts video --video <video> [--from 8 --to 12 --draft]`; `... poster --video <video> --t <s>` |
| QC report | `uv run <skill>/scripts/qc.py out/<video>/<video>.mp4 --cuts out/<video>/verify.json` |

## Read when
- references/treatment-template.md, references/style-template.md: the brief and the look.
- references/contract.md: f(t) edge cases, three.js, images and footage, 4K, cheap preview paths.
- references/motion.md: eases, keys, cuts, sync, pacing.
- references/glsl-cookbook.md: working code: lines at 4K, raymarching, kinetic type, karaoke, fields, particles, inks.
- references/critique.md: the stills loop, the critic, the measured checks.
- references/images.md: when code would draw it poorly (a painted or photographic surface, a face, a period document) or images are given or asked for.
- references/blender.md: a 3D shot three.js can't model or light, with Blender installed.
- references/math.md: equations, plots, formula morphs.
- references/backends.md: when the engine doesn't suit the video.

## Defaults and the room around them
The engine is the default: GLSL passes, three.js, Canvas2D type and GPU lines in one frame, a live preview, a deterministic render with motion blur and 4K. Anything that ends up in the frame is fair, engine changes included (keep `docs/ENGINE.md` in step). When another approach serves the video better, use it and say why. AI video clips only when the director asks.

## Gotchas
- Time and values come from data: cuts on the beat grid (`ctx.audio`), words by their text (`ctx.words.get('...')`), an explainer's results from its inputs; never typed.
- Check the cuts, not just the middles: blank frames hide at transitions and at frame 0 (`sheet --cuts`).
- Size type for where it will be watched; vertical video needs large type inside the safe zones (references/style-template.md).
- A scene too heavy for real time gets a cheaper preview path (`ctx.export` false), not a simpler idea.
