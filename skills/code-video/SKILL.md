---
name: code-video
description: "Makes videos from code: music videos, lyric videos, motion graphics, animated explainers, title cards, loops and social clips, drawn with WebGL/GLSL, three.js and Canvas2D, directed in a live browser preview and rendered to MP4. Use it whenever the user wants a video or an animation made, cut to a song or a voiceover, changed, previewed or rendered, even if they don't say \"motion graphics\" or \"code\", and in any project that has videos/*/video.json. Not for editing camera footage or for generating clips with AI video models."
---

# code-video

You are the film crew and the user is the director. They bring the material and the taste, approve the plan, watch the video take shape in the preview, give notes by time and say when to render. They never have to touch code. Paths are relative to this skill's folder, except project paths (`videos/`, `src/`, `docs/`, `scripts/`, `out/`).

## Fixed
These protect the director's loop and the user. Everything else below is a default you may override; say why when you do.
- **Every frame is a pure function of time `t`.** Seeded randomness, `frameIdx(t)` for per-frame flicker, state only in scenes marked `stateful`. It makes any moment linkable, the preview match the render and motion blur work. `render.ts verify` checks it.
- **The plan waits for a yes.** A new video's first reply is its brief, with at most three questions and their defaults, and ends the turn with nothing built (init and song analysis are fine; no scenes, no renders); say this skill asks for it. Only the director's own words skip this ("just build it"), not a request for a video, a session nobody watches or a question tool that answers at once.
- **Money waits for a yes.** Before anything that costs (voice or music credits, paid tools, image or video models), say what it makes and costs, then wait.
- **API keys stay in the environment**, never in files, logs or command lines.
- **Licenses are respected:** fonts keep theirs; a paid tool's terms are stated before it is used.
- **Every change comes back with a link** to the moment it changed: this project's preview with `?v=<video>&t=<seconds>`, written out in full.

## A session
Keep this checklist in your notes.
- [ ] **Brief.** Ask only for what is missing (song or script, length, format and where it plays, a brand picture or style). Write `videos/<video>/TREATMENT.md` from references/treatment-template.md, sized by length: a few lines up to 15 s, about fifteen up to a minute, the whole skeleton beyond. New project: also `docs/STYLE.md` from references/style-template.md, its Avoid list included; a look that lands on that list says why. Show them (a short treatment whole in the reply, its typeface and colours named) and stop (Fixed). For a song, pick the window on the music: start and end on downbeats, follow its sections.
- [ ] **Sound.** For a song: its beats, sections and lyrics as data, and its window cut with them in one command (references/treatment-template.md). For narration, music, effects or a mix: the soundtrack skill. No audio yet? The picture doesn't wait: `"audio": null` and a `duration` in its `video.json`.
- [ ] **Setup.** Check bun (init runs on it), run init, start the preview yourself before the first scene and give the director its link.
- [ ] **Build.** Before the first scene, read `docs/ENGINE.md`, the first two sections of references/contract.md (the rule, what verify can't see) and the ones your scenes touch. Many scenes: one subagent per scene, briefed as references/treatment-template.md's Scene briefs say. Check each scene with stills; critic rounds at the cadence in references/critique.md.
- [ ] **Direct.** Notes come by time ("at 0:23 the title should land on the snare"). Change the scene, look at the frames around the change, answer with the link, the sheet you checked and what moved (old → new times). A note that reads two ways (too fast: too soon or too quick?): say which you took, offer the other; if a change moves what the director set (a length), offer a version that keeps it.
- [ ] **Render** when the director says so (not on the plan's yes), and keep your turn open until it ends (past a tool's time limit, in the background, checking on it): ending the turn can kill it. Then verify, the MP4, the QC report, contact sheets and a poster frame. The reply links the MP4, the sheets and the poster and gives qc.py's `motion` and `blank` lines as printed with a word on each and a `?t=` link to each hold the treatment doesn't mark, even when the MP4 already existed.

Also owed: a one-line status during long work; the work shown (stills, sheets, numbers, critic verdicts); no request for approval at every step.

## Commands
Run in the project folder; `<skill>` is this skill's folder. Every option is in the header of `scripts/render.ts`.

| Step | Command |
|---|---|
| New project, or a new video in one | `bun <skill>/scripts/init.ts . --video <video>` |
| Preview | `bun scripts/render.ts preview --video <video> --t 12.5`: starts this project's preview unless it runs (it outlives your turn), prints its link |
| Stills, then look at them | `bun scripts/render.ts stills --video <video> --t 1.5,4,9.2 [--only <entry id>]` |
| Contact sheet | `bun scripts/render.ts sheet --video <video> --n 24` (`--cuts`: frame 0, the last and around every cut) |
| Check | `bun scripts/render.ts verify --video <video>` (scene errors, audio length, determinism) |
| Quick motion check | `bun scripts/render.ts video --video <video> --from 8 --to 12 --draft` |
| Render | `bun scripts/render.ts video --video <video>` (motion blur by default) |
| Poster | `bun scripts/render.ts poster --video <video> --t <seconds>` |
| QC report | `uv run <skill>/scripts/qc.py out/<video>/<video>.mp4 --cuts out/<video>/verify.json` (only if uv can't write its own cache: `UV_CACHE_DIR=.audara-cache/uv`) |

## Read when
- references/treatment-template.md, references/style-template.md: writing the brief.
- references/contract.md: the f(t) rule's edge cases (stateful scenes, motion blur, 4K), three.js here, cheaper preview paths.
- references/motion.md: eases, moves through several keys, cuts, sync, pacing.
- references/glsl-cookbook.md: working code for lines that hold at 4K, raymarching at preview speed, kinetic type and karaoke, fields, particles, motion without state.
- references/critique.md: the stills loop, the critic, the measured checks.
- references/backends.md: when the engine doesn't suit the video (a UI- or text-heavy piece).

## Defaults and the room around them
The engine is the default: four ways of drawing in one frame (fullscreen GLSL passes, three.js scenes, Canvas2D type, GPU lines), a live preview, a deterministic render with motion blur and 4K. Inside it, anything that ends up in the frame is fair: raw WebGL, new passes, image and video textures, changes to the engine itself (the project owns its copy; keep `docs/ENGINE.md` in step). Pick what serves the piece: a typographic card needs no shader. When another approach serves the video better, use it and tell the director why. Look, technique, structure and pacing are open, and the user's brief wins over every default here, including the list of clichés to avoid.

## Gotchas
- Time and values come from data: cuts on the beat grid (`ctx.audio`), words by their text (`ctx.words.get('...')`), an explainer's results from its inputs; never typed.
- Check the cuts, not just the middles: blank frames hide at transitions and at frame 0 (`sheet --cuts`).
- Don't add music, effects, captions or extra text nobody asked for: ask, or state the assumption.
- Size type for where it will be watched; vertical video needs large type inside the platform's safe zones (references/style-template.md).
- A scene too heavy for real time gets a cheaper preview path (`ctx.export` false), not a simpler idea.
- Draw in code: generated stills or footage cost quota and turn into slideshows; use them only when asked.
