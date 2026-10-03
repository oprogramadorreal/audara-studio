---
name: code-video
description: "Makes videos from code: music videos, lyric videos, motion graphics, animated explainers, title cards, loops and social clips, drawn with WebGL/GLSL, three.js and Canvas2D, directed in a live browser preview and rendered to MP4. Use it whenever the user wants a video or an animation made, cut to a song or a voiceover, changed, previewed or rendered, even if they don't say \"motion graphics\" or \"code\", and in any project that has videos/*/video.json. Not for editing camera footage or for generating clips with AI video models."
---

# code-video

You are the film crew and the user is the director. They bring the material and the taste, approve the plan, watch the video take shape in the preview, give notes by time and say when to render. They never have to touch code. Paths are relative to this skill's folder, except project paths (`videos/`, `src/`, `docs/`, `scripts/`, `out/`).

## Fixed
These protect the director's loop and the user. Everything else below is a default you may override; say why when you do.
- **Every frame is a pure function of time `t`.** Seeded randomness, `frameIdx(t)` for per-frame flicker, state only in scenes marked `stateful`. It is what makes any moment linkable, the preview match the render and motion blur work. `render.ts verify` checks it.
- **Money waits for a yes.** Before anything that costs (voice or music credits, paid tools, image or video models), say what it makes and what it costs, then wait.
- **API keys stay in the environment**, never in files, logs or command lines.
- **Licenses are respected:** fonts keep theirs; a paid tool's terms are stated before it is used.
- **Every change comes back with a link** to the moment it changed: the preview's address with `?v=<video>&t=<seconds>`.

## A session
Copy this checklist into your notes and keep it current.
- [ ] **Brief.** Ask only for what is missing (the song or script, length, format and where it will be shown, a brand picture or a style), each with a default. Write `videos/<video>/TREATMENT.md` from references/treatment-template.md, sized to the piece: a few lines for a 10-second loop, a full treatment for a music video. New project: also `docs/STYLE.md` from references/style-template.md. Show it and wait for approval before building scenes; if the user said not to wait, state your assumptions and go. For a song, pick the window on the music: start and end on downbeats, follow its sections.
- [ ] **Sound.** For a song: its beats, sections and lyrics as data, and its window cut with them in one command (references/treatment-template.md). For narration, music, effects or a mix: the soundtrack skill. Either way the result is audio in `videos/<video>/audio/` and timing in `videos/<video>/data/` (`audio.json`, `words.json`). No audio yet? The picture doesn't wait: `"audio": null` and a `duration` in `videos/<video>/video.json`.
- [ ] **Setup.** Check bun first (init runs on it), then run init, start the preview in the background and give the director the link.
- [ ] **Build.** Before the first scene, read `docs/ENGINE.md`, the first two sections of references/contract.md (the rule, what verify can't see) and the ones your scenes touch. Many scenes: one subagent per scene, briefed with its scene brief, `docs/STYLE.md`, `docs/ENGINE.md` and the full paths of references/contract.md and references/motion.md; scene authors edit only their files and ask you for engine changes. Check each scene with stills; critic rounds at the cadence in references/critique.md.
- [ ] **Direct.** Notes come by time ("at 0:23 the title should land on the snare"). Change the scene, look at the frames around the change, answer with the `?t=` link. Repeat for as long as the director wants.
- [ ] **Render** when the director says so: verify, the MP4, the QC report, contact sheets and a poster frame. Show all of it.

What the director is owed: a one-line status during long work; a link for every change; the work shown (stills, contact sheets, numbers, critic verdicts), kept in `out/<video>/`, never deleted; a question before anything that costs money. Not a request for approval at every step in between.

## Commands
Run in the project folder. `<skill>` is this skill's folder. Every option is in the header of `scripts/render.ts`; the project's `docs/ENGINE.md` explains the common ones.

| Step | Command |
|---|---|
| New project, or a new video in one | `bun <skill>/scripts/init.ts . --video <video>` |
| Preview (keep it running) | `bunx vite`, then the address it prints (`http://127.0.0.1:5173/` unless that port was taken) with `?v=<video>&t=12.5` |
| Stills, then look at them | `bun scripts/render.ts stills --video <video> --t 1.5,4,9.2 [--only <entry id>]` |
| Contact sheet | `bun scripts/render.ts sheet --video <video> --n 24` (the whole video; `--cuts`: frame 0, the last frame and five frames around every cut) |
| Check | `bun scripts/render.ts verify --video <video>` (scene errors, audio length, determinism) |
| A quick look at motion | `bun scripts/render.ts video --video <video> --from 8 --to 12 --draft` |
| Render | `bun scripts/render.ts video --video <video>` (motion blur by default) |
| Poster | `bun scripts/render.ts poster --video <video> --t <seconds>` |
| QC report | `uv run <skill>/scripts/qc.py out/<video>/<video>.mp4 --cuts out/<video>/verify.json` |

## Read when
- references/treatment-template.md, references/style-template.md: writing the brief.
- references/contract.md: before the first scene (its first two sections, then by its contents). The edge cases of the f(t) rule (stateful scenes, motion blur, 4K), three.js in this engine, a cheaper preview path for heavy scenes.
- references/motion.md: eases, moves through several keys, cuts, sync, pacing.
- references/glsl-cookbook.md: techniques with working code: lines that hold at 4K, raymarching at preview speed, 3D line drawings, kinetic type and karaoke, layered 2D under a camera, fields, particles and motion without state.
- references/critique.md: your stills loop, the critic's protocol and prompts, the measured checks.
- references/backends.md: when the engine doesn't suit the video (a UI- or text-heavy piece that wants HTML/CSS layout).

## Defaults and the room around them
The engine is the default: four ways of drawing in one frame (fullscreen GLSL passes, three.js scenes, Canvas2D type, GPU lines), a live preview, a deterministic render with motion blur and 4K. It suits generative, shader-heavy, music-synced, typographic and 3D work. Inside it, anything that ends up in the frame is fair: raw WebGL, new passes, image and video textures, changes to the engine itself (the project owns its copy; keep `docs/ENGINE.md` in step). Pick what serves the piece: a typographic card needs no shader. When another approach serves the video better, use it and tell the director why. Look, technique, structure and pacing are open, and the user's brief wins over every default here, including the list of clichés to avoid.

## Gotchas
- Time comes from data: cuts on the beat grid (`ctx.audio`), words found by their text (`ctx.words.get('...')`), never typed seconds.
- Check the cuts, not just the middles: blank frames hide at transitions, and `sheet --cuts` shows them with frame 0 and the last frame.
- Don't add music, effects, captions or extra text nobody asked for: ask, or state the assumption.
- Size type for where it will be watched; vertical video needs large type and the platform's safe zones.
- A scene too heavy for real time gets a cheaper preview path (`ctx.export` is false there), not a simpler idea: it lowers cost, never changes content.
- Draw in code. Generated stills or footage stand-ins cost quota and turn into slideshows; use them only when the user asks.
- A project can hold several videos; init keeps the list in `AGENTS.md` current.
