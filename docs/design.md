# audara-studio: design

Why audara-studio is built the way it is, for later sessions working on it. This is the design brief the
build started from (2026-10-02), with its one-time instructions and local paths taken out; the last
sections record what the build checked and where it went differently, and why.

The engine comes from [pdoom-video](https://github.com/mexicat/pdoom-video) (MIT, Giacomo Magnanini),
from a copy that added the render verify mode, accented stroke-font letters, scene remixes, longer
timelines and spliced soundtracks to upstream commit `bdbad53`.

## Decisions made with the user

- **Repo:** https://github.com/oprogramadorreal/audara-studio.
- **License: MIT.** A `NOTICE` file credits:
  - pdoom-video (MIT, © 2026 Giacomo Magnanini);
  - motion-video-kit (MIT, © 2026 echris6), where its text or algorithms are adapted;
  - each font under its own license: the SIL Open Font License for Archivo, IBM Plex Mono, Cormorant
    Garamond and the EMS stroke fonts, and the Hershey fonts' liberal license, whose text is inside their
    SVG files.
- **Several videos per project.** The engine, the look (`docs/STYLE.md`) and the fonts are shared. Each
  video has its own folder with its treatment, timeline, scenes, audio and timing data, and the preview
  picks it with `?v=<name>`. pdoom-video already worked this way in practice: its pt-BR explainer reuses the
  clip's scenes through `remix`. See "What `init` creates in a project".
- **Fonts: pdoom-video's set, and no more by default.** Archivo, IBM Plex Mono, Cormorant Garamond, and the
  EMS and Hershey stroke fonts. Together they cover the four voices a piece needs:
  - a grotesk whose width and weight can animate;
  - a mono for UI and data;
  - a serif for the solemn register;
  - pen-plotted writing.

  A project that needs another typeface (a brand's own, or a script these don't cover) adds it then; the
  engine guide explains how. Any OFL font works, for example from Google Fonts. A variable font first goes
  through a static-instance script like pdoom-video's `analysis/make_fonts.py`, because Canvas2D and
  opentype.js need static outlines.

## Definition of done

- One command (`init`) adds the template to a new project, and its preview plays the example video over a
  generated demo track.
- In both Claude Code and Codex, the skills trigger on a plain request ("make a 30-second video for this
  song") and produce the two test videos of build step 6.
- Both skills follow "Writing the skills": they pass `skills-ref validate`, their trigger and task evals
  pass in both tools, and the creative-range eval shows they don't narrow what the model makes.
- `render.ts verify` passes, including the determinism check, and `qc.py` reports on the final MP4s.
- Without an ElevenLabs key, everything except audio generation still works.
- A later session in a project made with audara, asked for a small change ("make the intro slower"), follows
  the project's conventions without anyone naming a skill.
- The plugin installs from https://github.com/oprogramadorreal/audara-studio in both Claude Code and Codex.
- The README stays short: what it is, install, first video.

## The vision: the user directs, the agent builds

audara-studio makes the coding agent a film crew and the user its director. The director brings the
material and the taste, approves the plan, watches the video take shape in the browser, gives notes by time,
and says when to render. They never have to write code or run a script, though they can.

This is how pdoom-video was made: in conversation, watched in a live preview, changed note by note. Every
part of the design serves that loop:

- **The f(t) rule** makes any moment linkable and re-renderable.
- **The preview** shows a change seconds after it's made.
- **The briefs** keep the crew consistent.
- **The critic** catches what the director shouldn't have to.

### How it's used

- **Install once per machine.** In Claude Code: `/plugin marketplace add oprogramadorreal/audara-studio`,
  then install it from `/plugin`. In Codex: its plugin command. In either:
  `npx skills add oprogramadorreal/audara-studio`.
- **Then talk naturally.** Open a folder and ask for a video: "make a 60-second video for `song.mp3`, dark
  and engraved". The skills load on their own: each skill's short description is in every session, and a
  matching request loads the rest.
- **Name a skill only to force it**, when the request is vague, or when other video skills (Remotion,
  HyperFrames) are installed and audara must win. In Claude Code that's `/audara-studio:code-video`; in
  Codex, `$code-video`.

### A session, from the director's chair

1. **Brief.** The agent asks only for what's missing (the song or script, length, format, a brand picture
   or a style) and writes the treatment and storyboard, sized to the piece. The director approves them
   before any scene is built.
2. **Sound.** For a song, the agent analyzes its beats and lyrics. For narration, it writes the script, asks
   before spending ElevenLabs credits, and generates the voice and music with their timings.
3. **Setup.** It copies the engine into the folder, starts the preview and gives the director the link.
4. **Build.** It writes the scenes, several in parallel when there are many, and a critic reviews each one.
   The preview reloads as scenes change.
5. **Direct.** The director watches and gives notes by time ("at 0:23 the title should land on the
   snare"). The agent changes the scene and answers with a `?t=` link to that moment. This loop repeats for
   as long as the director wants.
6. **Render.** The director says "render it" and gets the MP4, with a quality report, a contact sheet and a
   poster frame.

What the agent owes the director:

- a one-line status during long work;
- a link for every change;
- the work shown: contact sheets, numbers, critic verdicts;
- a question before anything that costs money.

It doesn't ask for approval of every step in between.

### Coming back later

A project outlives the session that started it. `init` writes a short `AGENTS.md` into the project with
what a later session needs:

- the videos in the project, and where each one's treatment is;
- the shared style and the engine guide;
- the preview and render commands;
- the f(t) rule, in one line;
- what the agent owes the director.

It also writes a one-line `CLAUDE.md` that imports it (`@AGENTS.md`); Codex reads `AGENTS.md` on its own.
The agent keeps `AGENTS.md` current as videos are added.

A later session in that folder then knows the conventions even when a request ("make the intro slower") is
too small to load a skill. Skills tend not to load for simple one-step requests the model can handle
itself, which is exactly why the project carries its own conventions.

## The decision

Build audara-studio as **one repo of Agent Skills around one engine: the pdoom-video engine as a starter
template the skill copies into each project, plus the method for using it**. The core is what made this
project easy to direct:

- **A live preview in the browser**, where the user watches the video take shape and asks for edits.
- **GLSL**, which lets the model draw almost anything, with three.js for 3D geometry and Canvas2D for type
  in the same frame.

Other frameworks are only suggested, through their own official skills, for videos the engine doesn't suit:
HyperFrames (free) first, Remotion (paid for companies) only as an optional last resort. Wrap it in two
small plugin manifests, one for Claude Code and one for Codex. No MCP server; agents only as optional
extras.

It has two skills: **`code-video`** for the picture and **`soundtrack`** for the sound. `soundtrack` turns a
song or a script into audio files plus the timing data the engine reads. When the user provides an
ElevenLabs API key, it can also generate narration, music and sound effects (see "Sound and ElevenLabs").

### Room for the model

Opus 5.5 is good at motion graphics and finds approaches of its own. audara exists to give it a fast loop
with the director and hard-won craft, never to narrow what it can make. So the skills fix very little:

- **Fixed,** because they protect the director's loop and the user:
  - every frame is a function of `t` (with `stateful` as the way out for simulations);
  - spending money waits for the user;
  - the API key stays out of the repo;
  - licenses are respected;
  - every change comes back with a `?t=` link.
- **Defaults the model may override, saying why:** the engine and its four ways of drawing, the workflow's
  steps, the treatment format, the motion grammar, the critic's cadence, the measured bars, the example
  scenes.
- **Open:** look, style, technique, structure, pacing.
  - Inside the engine, anything that ends up in the frame is fair: raw WebGL, new passes, image and video
    textures, changes to the engine itself.
  - Outside it, another approach when it serves the video better: HyperFrames, Remotion (with its license
    caveat), or one the model knows better for the job.

How the skills could still limit it, and what prevents that:

- **Anchoring on examples.** pdoom-video's scenes and taste (engraving, ink and orange) would pull every
  video toward one look. The example scenes are indexed by technique, not style, and the templates carry no
  pdoom-video palette, tone or motifs.
- **Process overhead on small requests.** The brief scales with the piece: a ten-second loop needs a few
  lines, a music video a full treatment.
- **Hard rules where taste belongs.** The skills give reasons, not MUSTs, and the user's brief always wins
  over their defaults, including the list of clichés to avoid.
- **A slow preview killing an idea.** A scene too heavy for real time gets a cheaper preview path (lower
  resolution, fewer samples) rather than a simpler idea. pdoom-video's shoggoth already renders its G-buffer
  at half resolution.

The evals check this directly (see "Writing the skills").

## What made pdoom-video work (preserve these)

The GLSL is the visible part, but the value to reuse is six things around it:

1. **Every frame depends only on the time `t`** (`docs/ENGINE.md:49`). Randomness is seeded, flicker is
   keyed to the frame index (`frameIdx(t)`), and scenes that keep state have to opt in (`stateful`). That's
   why the browser preview matches the export, and why motion blur from averaged sub-frames and rendering
   in parallel segments both work.
2. **A live preview to direct the video** (`app/src/main.ts`). `bunx vite` serves the video as a web page
   that plays in real time with the song (in audara, `render.ts preview` starts it, detached, so it
   outlives the agent's turn):
   - a scrub bar with the scenes marked, and keys to play, seek, step one frame, jump between scenes and
     loop one;
   - `?t=23` links to any moment;
   - saving a scene file reloads only that scene;
   - a scene that fails shows its error on the page and renders black without breaking the others
     (`app/src/timeline.ts:9`).

   This is the user's feedback loop: watch, point at a time, ask for a change, see it seconds later. It
   works because scenes stay fast (under 25 ms a frame, `docs/ENGINE.md:54`) and motion blur is left to the
   export.
3. **Sync comes from data.** The Python/uv analysis (`analysis/align.py`, `analysis/analyze.py`) writes the
   beats and word timings to `data/audio.json` and `data/lyrics.json`. Scenes find lyric lines by their text
   (`lyrics.get('sudden drop')`), and the timeline snaps cuts to the beat grid (`app/src/timeline.ts:18`).
   Nothing is timed by hand.
4. **Two briefing docs.** `docs/TREATMENT.md` covers palette, type, tone, a list of looks to avoid and a
   brief for each scene. `docs/ENGINE.md` covers the scene API and its rules. Each scene has an owner
   (A1–A8, B1), and ENGINE.md tells scene authors not to touch other files and to ask "the lead" for engine
   changes. That points to a lead agent running parallel scene agents, and these two docs kept all 17
   scenes consistent.
5. **The model checks its own frames.** `render.ts stills` and `sheet` (contact sheets), `--only <scene>`,
   then the model looks at the PNGs. There's also a `verify` mode, and scene errors are printed. This is
   the model's loop, next to the user's preview, and most of the quality came from it.
6. **The render pipeline** (`app/scripts/render.ts`, export API in `app/src/main.ts`). Headless Chrome
   (playwright-core) sends raw frames over a WebSocket to ffmpeg, with adaptive motion blur, true 4K
   (`--scale 2`) and BT.709 color tagging. Hard to get right, and nothing in it is specific to this video.

Only the palette, fonts, recurring visuals, the P(doom) overlay and the scenes themselves belong to
pdoom-video.

## Why this setup

- **A skill, not an MCP server.** Everything is local files and command-line scripts the agent can already
  run. An MCP server would add a running process and a protocol and gain nothing.
- **One engine at the core, and a method that doesn't depend on it.** The skill uses the template by
  default and leaves the final choice to the model. The method (the f(t) rule, timing data, briefs, the two
  feedback loops) works the same in HyperFrames (a GSAP timeline seeked to `t`) and Remotion
  (`useCurrentFrame()`), so a video the engine doesn't suit can still use them (see "The engine, three.js
  and other frameworks"). Write it as principles and defaults, with the reason for each, rather than hard
  rules (see "Room for the model").
- **Copy the engine in; don't publish it as an npm package.** Agents need to read and change the engine.
  pdoom-video added an overlay, single-stroke fonts and a remix hook to it, and code in `node_modules` is
  out of their reach.
- **Keep agent definitions small.** Skill folders (`SKILL.md`) are the one format both tools read. Agent
  definitions differ: Claude Code uses `agents/*.md`, Codex uses `.codex/agents/*.toml`. Agent Plugins 1.0
  (the standard Codex, Cursor and Copilot adopted in August 2026) leaves agents, hooks and commands out,
  and Claude Code doesn't support it yet. Both tools can start general-purpose subagents, so put the
  coordination in the skill: write the briefing docs from their templates and, when there are many scenes,
  start one subagent per scene, each with its own files.
- **The critic is a role, not a file.** The one extra role worth having is a **critic** that reviews
  contact sheets against the treatment with fresh eyes (its protocol is in "Lessons from
  motion-video-kit"). In v1 the lead starts a general-purpose subagent with the critic prompt from
  `critique.md`, which works the same in both tools. Add an agent definition only if that falls short.

## The engine, three.js and other frameworks

### three.js: yes, and it's already there

The engine is built on three.js (0.186): its render targets, shader materials and cameras. Scenes already
combine four ways of drawing in the same frame:

- fullscreen GLSL passes (`FSPass`);
- three.js scenes with meshes and cameras: `stack.ts` falls through an `InstancedMesh` with a perspective
  camera and fog, and `loss.ts` flies over a terrain mesh with its own shader;
- Canvas2D layers for type (`Layer2D`);
- GPU lines (`LineBatch`).

So three.js adds no new tool; it only needs to be explicit:

- The template ships one small example scene for each way of drawing.
- The three.js rules go in `contract.md`, because they are the f(t) rule applied to three.js:
  - animation is driven from `t` (`AnimationMixer.setTime(t)`, never `THREE.Clock` or
    `requestAnimationFrame`);
  - models load in `init()`;
  - scenes render into `out`, in linear color;
  - physics and particle simulations are `stateful`, so they only get fixed-sample motion blur.
- No React Three Fiber: it would add React for nothing the engine needs.

### Remotion: optional, and only when it really helps

The user doesn't want to depend on a paid tool. Remotion is free for individuals and teams of up to three
people, and paid from four. So it is never the default and never bundled. The skill suggests it only when
one of its specific strengths is needed and the free options don't cover it, and it states the license
condition before using it.

What Remotion would add:

- **HTML/CSS layout through React**, much easier than Canvas2D for UI, text-heavy and data-driven videos.
- **Many variants of one video**, generated from data.
- **Audio** tracks mixed at render time.
- **Cloud rendering.**
- **Remotion Studio**, a preview as good as this one.

Remotion maintains official agent skills for all of it.

What it would cost audara:

- **A second engine** to template, document and test in two agents, which doubles what the plugin has to
  keep working.
- **A weaker fit for shader-heavy work.** Each frame is a screenshot of the page, WebGL needs Chrome's ANGLE
  backend when rendering headless (the default since Remotion 5), and the HDR post-processing and adaptive
  motion blur would have to be rebuilt.
- **A license** for teams of four or more (a Company License, with telemetry that counts renders).

So `backends.md` has a short order of choice:

1. **The template** (the default), for anything it suits: generative, shader-heavy, music-synced, 3D.
2. **HyperFrames** (HeyGen, Apache-2.0, free), when HTML/CSS layout really helps: product or UI videos,
   text-heavy pieces. It also covers most of what Remotion's HTML layout would add.
3. **Remotion**, optional, only for what HyperFrames doesn't cover, such as React components the user
   already has or cloud rendering. Use it only after telling the user about the license.

Both alternatives are used through their own skills, keeping audara's method and its `soundtrack` data,
which is plain JSON either one can read. The skill names the template as the default and says what it's
best at, so the model doesn't drift to a more popular framework out of habit. The choice still belongs to
the model: when another approach serves the video better, including one not listed here, it uses it and
tells the director why. Paid tools keep their license caveat.

## Sound and ElevenLabs

Worth adding, as an optional part of `soundtrack`. With a key, the model can make the whole soundtrack;
without one, nothing else changes.

### Why it earns its place

- **The timings come with the audio.** Text-to-speech `with-timestamps` returns the time of every
  character, so word times come for free, and a generated song's lyrics get word times too
  (`/v1/music/detailed` with `with_timestamps`). Write them in the same `words[]` format as
  `data/lyrics.json`, and scenes find narration words by their text exactly as they find lyrics.
  pdoom-video's explainer had to force-align its ElevenLabs narration after the fact
  (`analysis/narracao.py`: CTC alignment plus a pronunciation table). With timestamps that step goes away,
  and the heavy local path (Demucs plus forced alignment, about 4 GB of models) is only needed for audio
  the user brings.
- **The music can be composed to fit the edit.** Generate the narration first and measure its chapters.
  Then compose the music from a composition plan whose sections last as long as the chapters, so the music
  changes where the chapters change. Creating a plan (`/v1/music/plan`) costs no credits, so it can be
  reviewed before paying for the track. pdoom-video instead looped a fixed 204.8 s Suno track under 581 s of
  narration.

### Where it goes, and where it doesn't

- **Not in `code-video`.** The picture method has to work with any audio, or none. Its SKILL.md only points
  to `soundtrack` for narration, music and timing data.
- **Not through the ElevenLabs MCP server.** The official server exists, but here each generation has to
  become timing JSON in the engine's format, with a record of the request, and be cached. A script does that
  in one step and runs the same way in Claude Code and Codex.
- **Don't re-teach the API.** ElevenLabs maintains official skills
  ([elevenlabs/skills](https://github.com/elevenlabs/skills): text-to-speech, music, sound effects,
  speech-to-text). They are guides for writing app code with the SDK and know nothing about this timing
  format. audara owns only the glue: three calls, the files they write and the timing JSON. For anything
  else (voice design, cloning, dubbing), point to the official skills.

### Rules for the generation scripts

1. **Generated audio is an asset, not a build step.** Each generation costs credits and gives a different
   take. Generate once, keep the file, and save the exact request next to it (text, voice, model, settings,
   seed). Renders never call the API, and a script regenerates only when its request has changed.
   pdoom-video did this by hand: `docs/letra-explicada-pt-br/tts/` holds the exact text of each generation.
2. **Ask before spending.** Before generating, say what it will make (characters, length) and confirm. For
   music, show the free plan first. Approve the voice on one short file before generating the rest.
3. **Keep the key out of the repo.** Read `ELEVENLABS_API_KEY` from the environment (the name the SDK and
   the official skills use). Never write it to a tracked file, print it or pass it as a command-line
   argument. If it's missing, the scripts say so and the skill goes on with the user's own audio or a silent
   placeholder track, so the picture work never waits for it.
4. **Keep the spoken text and the displayed text apart.** The narration text is spelled the way it should
   sound (pdoom-video's table in `docs/letra-explicada-pt-br/ROTEIRO.md`, "Grafia para a voz": "pê dum" for
   P(doom), "I-Á" for IA), so the timestamps are in spoken words. Keep a map from spoken to displayed words,
   so scenes still find words by what's on screen.
5. **Check the result by transcription.** Speech-to-text on the generated file confirms that it says what
   the text says. The user still approves it by ear.

Lessons from pdoom-video's explainer to put in `references/elevenlabs.md` (`ROTEIRO.md`, "Geração no
ElevenLabs"): one voice and the same settings for every file; one paragraph of text is one block, and the
picture cuts in the silence between blocks; acronyms read better written as they appear on screen than
spelled out; generate the key lines several times and keep the most natural take.

### Adding more tools later

Add a tool only when it writes data the engine reads or does a step the model can't do by itself, and keep
it behind one line in SKILL.md. Cheap candidates: SRT captions from the word timings, and a thumbnail mode
(pdoom-video has `app/thumb.html` and `app/scripts/thumb.ts`). Leave out until a project needs them: image
generation, stock footage, voice cloning.

## Lessons from motion-video-kit

[echris6/motion-video-kit](https://github.com/echris6/motion-video-kit) (MIT, September 2026) is one skill,
`business-motion-film`, for 15–40 s commercials made with HyperFrames + GSAP, some three.js, AI-generated
footage and library audio. It is mostly a knowledge pack: about 1,000 lines in 11 reference docs, 7 small
ffmpeg/Python scripts and 2 templates, written from two client projects and about 70 critic rounds.

It has no engine of its own. It renders with HyperFrames, and its motion blur is the same sub-frame
accumulation we have, without the adaptive sampling. Its review process and its audio rules are stronger
than what we had planned, and those are what to take. Nothing here changes the core.

### Worth taking

1. **The critic protocol** (`references/gauntlet.md`, `references/critic-prompts.md`). It sharpens the critic
   we already planned:
   - **A fresh critic every round.** It gets only the render, the treatment and the user's own words, never
     the builder's reasoning or its list of fixes.
   - **The critic picks its own frames.** With our engine that means `render.ts sheet`, with `--cuts` and
     times it chooses, plus dense frames around every cut. The builder can't show only the good ones.
   - **Verification rounds.** The next round is a new critic that marks each earlier finding FIXED, PARTLY
     or STILL PRESENT, looks for regressions, and ends with SHIP or ONE MORE PASS.
   - **A stop rule:** stop at the bar, or when what's left is cosmetic, not after a set number of rounds.
   - **A short ledger:** round, top findings, changes, measured result.

   Adapt their four prompts (storyboard, component, full cut, verification) into `critique.md`. Keep it
   proportional: one round when a scene is done and one per full cut, not one after every edit. They needed
   about 70 rounds for 40 s. The user's preview stays the main loop.
2. **Measured checks**, which turn taste arguments into numbers (`references/quality-bar.md`,
   `scripts/frozen-time.sh`, `scripts/loudness.sh`):
   - **Frozen time:** the total seconds where the frame barely changes, and the longest hold.
   - **Near-black frames** at transitions.
   - **Loudness:** integrated, range, true peak, and short-term per second.
   - **Determinism:** the same frame, rendered after seeking from before it and from after it, must give
     identical pixels. pdoom-video's `verify` renders frames at every word and cut but never compares them,
     and this is the one check that guards the f(t) rule directly.

   They are reports, not gates: a music video can hold still on purpose. The first three run on any MP4, so
   they also work on HyperFrames output.
3. **Motion craft**, for a new `motion.md` reference (`references/motion-grammar.md`,
   `references/product-hero-realism.md`):
   - **Starting from rest.** An ease that starts at full speed (`outExpo`) is right for a snap on a cut or a
     hit, but makes a one-frame pop when something starts moving from rest mid-shot. Start those with
     `smootherstep`, which is already in `util.ts`.
   - **Motion through several keys.** Use a monotone cubic (Fritsch–Carlson). pdoom-video's `keys()`
     (`app/src/engine/util.ts:128`) eases each segment separately, so a move through several keys slows to a
     stop at every key; their attempt to smooth keys with a smoothstep caused a mid-swing hiccup. Add a small
     `smoothKeys()` next to `keys()`, and check the speed per frame: it should peak once.
   - **Real motion.** To make something move like a real object, measure the reference frame by frame
     (extract it at 30 fps and write keys) instead of guessing.
   - **Cuts.** An object carried across a cut gets its pose from one shared function that both scenes
     call, and the cut is checked with a frame difference. pdoom-video's `_motifs.ts` already shares how
     the spark is drawn, so it looks the same in every scene; sharing its pose is the next step.
   - **Grammar:** one persistent actor across scenes (pdoom-video's spark is exactly that), the foreground
     as the transition, every action producing a visible result, frame 0 a finished composition.

   Their pacing numbers (no hold over 0.6 s, the subject filling 60–85% of the frame) are for commercials.
   They can be an optional preset in the treatment, not a default: pdoom-video's treatment asks for negative
   space and holds.
4. **The storyboard table** (their `SKILL.md`, step 3): time, what the viewer sees, the beat's job, and the
   transition out, including what carries over. Add that last column to `treatment-template.md`, plus a field
   for what must never be claimed. Have a critic read the storyboard before building, when changes are
   cheapest.
5. **Audio rules** for `soundtrack`, learned from client rejections (`references/audio.md`,
   `scripts/solve-sfx-gains.py`, `scripts/sfx-candidates.py`). They go into `references/elevenlabs.md` and
   `mix.py`:
   - **Generated music.** One plan section per scene group, with exact durations that add up to the video
     (merge sections shorter than about 3 s). Ask for no long intro and a resolved final chord with a natural
     ring-out. Check each take's short-term loudness and reject near-silent intros, dips under key scenes and
     early decay. No brand or artist names in prompts. Offer 2–3 options at the same loudness, so the user
     compares music, not volume. A human-made library track can still beat a generated one.
   - **Sound effects.** Few and clean: a soft whoosh on real transitions, small sounds only on real actions.
     Generate several candidates and screen them by analysis before anyone listens: too much energy below
     150 Hz reads as a boom, too much above 6 kHz as hiss. Place each effect by its measured onset, not its
     file start (a 33 ms lead-in made every hit two frames late). Set each level inside the effect's own
     frequency band against the music, with a cap on the 2–8 kHz lift.
   - **Mix.** About −14 LUFS for punchy pieces and −16 for calm ones, true peak at or below −1 dBFS. Always
     write a music-only version next to the mix, to find which layer a complaint is about. Change one thing
     per round and name it by timestamp.
6. **Show the work.** Each delivery comes with contact sheets, measured numbers, critic verdicts and a poster
   frame. Plan visibly, then build without asking approval for every step; spending money is the exception.

### Leave out

- **The business playbook** (verticals, prices, pilot offers) and **the notes on 28 launch films**: out of
  scope for a general video tool.
- **The HyperFrames lab page and GSAP template**: our engine has its own isolation (`--only`, the preview's
  scene loop).
- **`scripts/offline-mix.py` as a file**: it has one film's constants baked in (a 40 s length, a drop at
  14.0–17.1 s, a ring-out at 37.2 s). Take its per-event level solver, not the file.
- **Bash scripts**: write the same ffmpeg calls as uv scripts, which run on Windows without Git Bash.
- **AI footage generation**: their notes confirm what we decided (warped geometry, 720p/24 fps, half the
  clips unused).

Their repo is MIT: credit it where `critique.md`, `motion.md` or `mix.py` adapt its text or algorithms.

## Lessons from Hamza Khalid's Opus 5.5 course

[The article](https://x.com/humzaakhalid/status/2105203643758895454) ("How to create motion graphics with
Claude Opus 5.5 (Full Course)", X, 2026-09-30) sets up a "motion studio" folder for brand films. Only its
first half is public: the brand brief, the `CLAUDE.md`, the exact prompt and the fixes are in a paid
newsletter, so this covers the public half.

Its thesis matches this design: "the prompt is 10% of the result, and the setup is the other 90%." A viral
one-shot prompt, run as-is, gave a floating head and unreadable text, because Claude "had no brand, no
references and no rules to work from, so it filled the gaps with guesses."

### Worth taking

- **No scene before a brief.** The skill's first step turns what the user has (a picture of the brand, a
  product URL, a song, a script) into the treatment, sized to the piece, and asks only for what's missing.
  The palette and type come from the picture or the site. Rules come from `contract.md`, and references
  from the next point.
- **Examples, not just rules.** "A model working from memory alone reaches for the most average animation it
  has seen." The article clones eight example repos into the folder. We need less: `glsl-cookbook.md` links
  each technique to the pdoom-video scene that does it, on GitHub at the upstream commit `bdbad53` of
  mexicat/pdoom-video, where all five exist:
  - engraving hatching on a raymarched form: `shoggoth-glsl.ts`;
  - instanced 3D: `stack.ts`;
  - a terrain mesh: `loss.ts`;
  - kinetic type: `hook.ts`;
  - paper and stamps: `bureau.ts`.

  They are written against the same engine API, so their patterns carry over even where the template's
  paths differ.
- **Check the prerequisites first.** The article's setup prompt checks for Node 22+, git and ffmpeg before
  anything else, then lists each repo with one line on what it's for. `init` does the same for bun, Chrome,
  ffmpeg and uv, and says how to install whatever is missing.
- **Exact install lines** for the alternatives, for `backends.md`: `npx skills add remotion-dev/skills`, and
  `claude plugin marketplace add heygen-com/hyperframes` followed by
  `claude plugin install hyperframes@hyperframes`.

### Leave out

- **Cloning eight repos into every project:** heavy, and mostly other people's engines. The pinned example
  links do the job.
- **Its model comparison and the paid newsletter material.**

Its repos are listed under "Similar work" as not reviewed. One of them, JohnHeibel/PDoomVideo, is another
P(doom) video made with Opus 5.5 (p5.js with a watercolour brush), reportedly built with the same pattern: a
brief, parallel subagents, headless Chrome and ffmpeg.

## Writing the skills: Anthropic and OpenAI best practices

Both skills follow the skill-writing guidance of Anthropic and of OpenAI, and the open Agent Skills spec.
The links are under Sources; read them before writing. The two companies agree on almost everything; where
they differ, follow the stricter rule. What that means here:

### Format, for both tools

- **Frontmatter:** only `name` and `description`, the portable minimum.
  - Claude Code's extra fields (`when_to_use`, `allowed-tools`, `context: fork`…) are ignored by Codex, and
    v1 needs none of them. Codex's optional `agents/openai.yaml` can add a display name and an icon.
  - Both skills stay model-invoked: no `disable-model-invocation`, and `allow_implicit_invocation` left at
    its default. The vision depends on them loading on their own.
- **`name`:** lowercase letters, digits and hyphens; at most 64 characters; the same as the folder name; no
  "claude" or "anthropic". `code-video` and `soundtrack` pass.
- **`description`:** at most 1,024 characters, in the third person.
  - **Content:** what the skill does and when to use it, the main use case first, in the words users
    actually type ("video", "music video", "lyric video", "motion graphics", "animation", "explainer",
    "render").
  - **Near-misses** (OpenAI): name what it is not for. `code-video` is not for editing camera footage or
    for generating clips with AI video models.
  - **A little insistent** (Anthropic), because models tend to under-trigger skills: "use it whenever the
    user wants a video made from code, even if they don't say 'motion graphics'".
  - **First sentence first:** Claude Code cuts each listing at 1,536 characters, and Codex shortens
    descriptions first when its listing (2% of the context window) fills up.
- **Body:** well under 500 lines, ideally under about 5,000 tokens. Long director sessions make this
  matter: Claude Code keeps a loaded skill's text for the rest of the session, and after compaction it
  carries skills forward only within a 25,000-token budget. Write SKILL.md as standing instructions for the
  whole session, and as a map: what to do, and which reference to read when.
- **Files:** each reference sits one level deep from SKILL.md, named for its content and linked with when
  to read it. A reference longer than 100 lines starts with a table of contents. No README, changelog or
  install guide inside a skill folder (OpenAI); those belong at the repo root.
- **Paths:** forward slashes, relative to the skill's folder. No tool names ("view the PNG", not "use the
  Read tool") and no Claude-only variables such as `${CLAUDE_SKILL_DIR}` in text both tools read.

### Writing

- **Only what the model doesn't know.** It already knows GLSL, three.js and ffmpeg. The skill adds the
  engine contract, the workflow, the pitfalls pdoom-video paid for, and where things are.
- **Freedom to match the risk** (both companies):
  - exact commands for fragile steps: `init`, render, `verify`, `qc`, and anything that spends ElevenLabs
    credits;
  - principles with reasons for creative work, which is most of it;
  - the why instead of MUSTs: a rule in capitals is a sign the reason is missing (Anthropic);
  - no fixed structure or number of steps where the task doesn't need one (OpenAI).

  See "Room for the model".
- **One default per choice, with a way out:** the template by default, and another approach when it serves
  the video better.
- **Imperative steps with explicit inputs and outputs** (OpenAI): "Run `scripts/eleven.py tts <script>`: it
  writes the narration, its word timings and a record of the request into `videos/<name>/`."
- **Checklists for workflows, loops for quality:** the six director steps as a list the agent can copy;
  render stills, look and fix; `verify` and fix; critic, fix and verify.
- **One term per idea:** "scene" (pdoom-video also says "plate"), "treatment", "timeline", "preview",
  "render", "cut".
- **Nothing that goes stale in the instructions.** Model ids and API limits live in one reference file, or
  as documented script defaults.
- **Examples over descriptions**, chosen so they don't anchor one look (see "Room for the model").

### Scripts

- **Scripts for deterministic work** (`init`, render, `qc`, timing conversion, mixing), and instructions
  for judgment. OpenAI: prefer instructions unless the task needs deterministic behavior or an external
  tool.
- **Scripts solve their own problems.** They catch errors and say how to fix them ("ffmpeg not found:
  install it, then reopen the terminal"), explain every constant (why −14 LUFS, why that frozen-frame
  threshold), and declare their dependencies (PEP 723 for the uv scripts).
- **Say whether to run a script or read it.** Validation output names the exact problem: "scene `intro`
  failed: …".

### Test before polishing

- **Evals first.** Before writing much, run the target tasks without the skills, note what goes wrong, and
  turn that into at least three realistic task evals per skill. Change the skills for failures that
  actually happened, not imagined ones.
- **Trigger evals:** about 20 realistic requests per skill, half that should load it and half near-misses
  that shouldn't. Tune the description with the description optimizer in Anthropic's skill-creator.
- **A creative-range eval:** the same open brief, with and without the skill, two or three times each. The
  skill must not make the results narrower or plainer; if it does, find what anchors them and cut it.
- **Fresh sessions, every model.** Compare with and without the skill (in Claude Code, `skillOverrides`
  turns a skill off), using every model the user will run: Claude Opus, a smaller Claude model, and Codex's
  default model.
- **Claude A and Claude B:** one session improves the skills while a fresh one uses them on real tasks.
  Watch which files it reads: a file never read is unnecessary or badly linked.
- **Tools:**
  - Anthropic's skill-creator plugin: task evals, benchmarks, the description optimizer;
  - Codex's built-in `$skill-creator` and its validator;
  - `skills-ref validate ./skills/<name>`;
  - `claude --plugin-dir`, to load the plugin from its folder;
  - `claude plugin eval`, for a repeatable suite;
  - `/doctor` in Claude Code, for the listing cost.

## Target layout

```
audara-studio/
├── README.md                         # short: what it is, install, first video
├── LICENSE, NOTICE                   # MIT; credits pdoom-video, motion-video-kit and the fonts
├── .claude-plugin/plugin.json        # Claude Code
├── .claude-plugin/marketplace.json   # Codex docs also list this path as a fallback marketplace
├── plugin.json                       # Agent Plugins 1.0 (Codex, Cursor, Copilot)
└── skills/
    ├── code-video/                   # the picture: the engine and the method
    │   ├── SKILL.md                  # short: workflow, the f(t) rule, the preview and stills loops
    │   ├── references/               # contract, motion, style, treatment and engine-guide
    │   │                             # templates, critique loop, GLSL cookbook, other frameworks
    │   ├── scripts/init.ts           # (bun) copies the template into a project, generates the
    │   │                             # demo track, writes AGENTS.md and CLAUDE.md
    │   ├── scripts/qc.py             # frozen time, near-black frames, loudness on any MP4
    │   └── assets/template-webgl/    # engine, preview player, render.ts, fonts, an example video
    │                                 # with one scene per way of drawing; pdoom specifics removed
    └── soundtrack/                   # the sound: audio in, timing data out
        ├── SKILL.md                  # generate (ElevenLabs) or analyze the user's audio
        ├── references/elevenlabs.md  # read only when generating: key, costs, voice and music lessons
        └── scripts/                  # uv scripts with PEP 723 inline deps
            ├── eleven.py             # tts | music | sfx → audio + request record + word timings
            ├── beats.py              # beats, downbeats, onsets, loudness → data/audio.json
            ├── mix.py                # ffmpeg: voice, music and effects; loudness by kind of piece;
            │                         # a music-only version beside the mix
            └── align.py              # optional, heavy: forced alignment for the user's own song
```

`soundtrack` always ends with the same output, whichever path it takes: audio files plus `data/*.json` in
the formats the engine's `audio.ts` and `lyrics.ts` read.

Suggested `code-video/references/` files:

- `contract.md`: determinism, `frameIdx`, `stateful`, motion-blur rules, the three.js rules, and a cheaper
  preview path for scenes too heavy for real time.
- `motion.md`: eases from rest, `smoothKeys()`, measuring real motion, shared poses across cuts, the motion
  grammar.
- `style-template.md`: the project's shared look (palette, type, tone, motifs), and clichés to avoid unless
  the brief asks for them.
- `treatment-template.md`: one video's idea, storyboard table and scene briefs, with an optional commercial
  preset.
- `engine-guide-template.md`: from `ENGINE.md`, plus how to add a font.
- `critique.md`: the two loops, the critic protocol and its four prompts, the measured checks.
- `glsl-cookbook.md`: hatching/engraving, SDF raymarching, `pxLine` at 4K, the NaN guard in the accumulator,
  and an index of example scenes in pdoom-video, pinned to a commit.
- `backends.md`: the order of choice (template, then HyperFrames, then Remotion as an optional last
  resort), and how to use the alternatives through their own skills.

To install: `/plugin marketplace add oprogramadorreal/audara-studio` in Claude Code, the `codex plugin`
commands in Codex, or `npx skills add oprogramadorreal/audara-studio` for either.

### What `init` creates in a project

A suggested layout; adjust it if the code pushes back.

```
<project>/                       # one per brand or client, with several videos
├── AGENTS.md, CLAUDE.md         # conventions for later sessions ("Coming back later")
├── package.json, vite.config.ts, index.html, tsconfig.json
├── src/                         # the shared engine and preview player, copied from the template
├── scripts/render.ts            # stills, sheet, verify, video; --video <name>
├── public/fonts/                # the shared fonts, with their licenses
├── docs/STYLE.md                # the shared look
├── docs/ENGINE.md               # the engine guide
├── videos/<name>/
│   ├── TREATMENT.md             # this video's idea, storyboard and scene briefs
│   ├── timeline.ts, scenes/     # its edit and its scene modules
│   ├── audio/                   # song, narration, music, effects, each with its request record
│   └── data/                    # audio.json, and words.json for sung or spoken lines
└── out/<name>/                  # renders, not committed
```

- **The project folder is Vite's root,** so each video's audio and data are served from inside it, with no
  symlinks. pdoom-video kept them outside its `app/` folder and needed the `repoAssets` plugin
  (`vite.config.ts`) for Windows.
- **`words.json`** uses the format of pdoom-video's `lyrics.json` for sung and spoken lines alike, so scenes
  find narration words by their text exactly as they find lyrics.
- **Heavy model downloads** (only `align.py` needs them) go to a user-level cache, not the project.
- **`.gitignore`:** `out/`, `node_modules/`, `.env` and caches.

## Principles from the user

- Free tools first. A paid one (like Remotion for companies) is only an optional last resort, with its
  license stated before use.
- Simple and effective over complete: add a tool only when it clearly earns its place.
- READMEs stay short: what it is, install, first video. Details go in linked docs.
- Python only through uv (`uv run`, PEP 723 inline dependencies).

## Similar work to read first

- [hculap/skill-motion-graphic](https://github.com/hculap/skill-motion-graphic): small and new, closely
  related. A canvas engine where each frame is a function of time, sub-frame blur, a review loop that
  scores 7 criteria, shipped as a Claude Code plugin.
- [iart-ai/webgl-animation-skills](https://github.com/iart-ai/webgl-animation-skills): GLSL and three.js
  skills that could sit alongside audara-studio.
- [elevenlabs/skills](https://github.com/elevenlabs/skills): ElevenLabs' official skills, for what
  `soundtrack` leaves out.
- [echris6/motion-video-kit](https://github.com/echris6/motion-video-kit): read in full; what to take from it
  is in "Lessons from motion-video-kit".
- Not reviewed, from Hamza Khalid's article: [JohnHeibel/PDoomVideo](https://github.com/JohnHeibel/PDoomVideo)
  (another P(doom) video, p5.js), [JohnHeibel/ClaudeAnimationBase](https://github.com/JohnHeibel/ClaudeAnimationBase)
  (a starter), [buildwithhanif/claude-animation-skill](https://github.com/buildwithhanif/claude-animation-skill),
  [WinterArc21/Battle-of-Austerlitz-Film](https://github.com/WinterArc21/Battle-of-Austerlitz-Film) (long
  form), [athemeroy/awesome-opus-5-5-videos](https://github.com/athemeroy/awesome-opus-5-5-videos) (prompts),
  [guanmo-ai/awesome-ai-motion](https://github.com/guanmo-ai/awesome-ai-motion) (a list).

## What the build checked

Every check ran on Windows 11, in fresh headless sessions (`claude -p`, `codex exec`), with the skills
linked into a scratch folder as project skills or installed as the plugin. The harness and the cases are
in `evals/`; their results stay out of the repo.

- **Format.** Both SKILL.md files pass three validators: `skills-ref` (the Agent Skills spec), Codex's
  `quick_validate.py` and Anthropic's. They stay under 8,000 bytes, so neither tool truncates them.
- **Triggering.** Twenty queries per skill, ten that should load it and ten near-misses written to be
  hard (a podcast edit, an app that calls a speech API, a GIF of a UI). Claude Opus, Claude Sonnet and
  Codex's default model: 20/20 each, for both skills. Codex opens a skill to decide whether it applies, so
  for Codex a near-miss passes when the skill was not used (its scripts never ran); it read code-video on
  43% of the near-misses and used it on none.
- **Tasks.** Nine multi-turn cases written from what went wrong in twelve runs without the skills: a title
  card, a brief for a song video, a vertical explainer, a later session asked for a small change (with
  and without the skills installed, and with an unrelated app holding Vite's default port), a
  creative-range loop, beats as JSON, a voiceover and a music cue without a key, and a voiceover that must
  ask before spending (against a mock of the ElevenLabs API, so nothing is billed). One grader per run
  checks each assertion with measurements (ffprobe, `verify`, `qc.py`, ground-truth beats and lyrics,
  loudness), not the transcript.
  - Round 1: Claude 84% of assertions, Codex 55%. Five of six new-video runs built and rendered the whole
    video before the director saw a plan.
  - Round 2, after the fixes below: Claude Opus 89%, Claude Sonnet 80%, Codex 84%; every new-video run
    stopped at the brief, every spending and no-key check passed (36 of 36), and every later session,
    with or without the skills installed, linked its own preview past the decoy.
  - ROUND3
- **Creative range.** The same request ("a 10 second loop for my late night jazz stream") ten times, five
  with the skills and five without, contact sheets judged by three blind judges who didn't know which set
  was which. All three found the set with the skills more varied (5, 4, 5 against 3, 3, 4 out of 10), less
  generic and better made, and the set without them plainer. Codex alone kept converging, with or without
  the skills, on a turning record with ivory type and a brass accent; after "the genre's emblem as the
  whole idea" joined the style template's Avoid list, its next two runs chose smoked glass and velvet.
- **The engine.** `render.ts verify` passes on the example and on every video the tests made, determinism
  included (the same frame reached by different seeks is pixel-identical), and `qc.py` reports on every
  final MP4.
- **Test videos.** Four 25-31 s videos, each in Claude Code and in Codex, directed through the preview by
  the user: a narrated explainer in Portuguese with an ElevenLabs voice and generated music, and a lyric
  video cut to the user's own song. The director's notes (a slower voice, a bigger label, more motion in
  a still stretch) went through the preview, and new sessions in those projects, asked for a change
  without naming a skill, found the conventions and answered with a link to the moment that changed.
  The narrated videos cost 2,392 ElevenLabs credits in all.
- **Install.** The plugin installs from GitHub in Claude Code (`/plugin marketplace add`, then
  `/plugin install audara-studio@audara-studio`) and in Codex (`codex plugin marketplace add`, then
  `codex plugin add`), and `npx skills add` finds both skills. While the repository was private, Codex
  and npx needed its SSH URL: over HTTPS, git waited for a credential prompt.
- **No key.** Everything except generating audio works without an ElevenLabs key: the scripts estimate
  what generation would cost and exit 3, and the free paths are a script away (the user's recording,
  `standin.py`'s local voice, synthesized music gridded with `beats.py grid`, a silent placeholder).

## Built differently from the plan, and why

- **The approval stop is a fixed rule.** The plan made "show the brief, then build" one step of the
  session, and everything outside the fixed rules is a default the model may override with a reason. In
  the first task evals, five of six new-video runs built and rendered before the director saw a plan:
  Claude wrote "since this session couldn't wait for a reply", and Codex cited its own rule to finish
  authorized work (its question tool also returned "accepted" before anyone answered). Asking for a
  video now authorizes its brief, not its build, and the render waits for the director's own word.
- **Replies list what they deliver.** "Show all of it" lost to the tools' terse final messages: a render
  reply came back as one MP4 link. The render step and the soundtrack's "show the work" name what every
  last reply carries (the files, the sheets, qc.py's numbers, a link to each unmarked hold).
- **A preview command.** The plan had the agent run `bunx vite` and read the address it prints. Port 5173
  is Vite's default, so another app often holds it (one later session linked an unrelated site), and a
  headless session stops its background shells when its turn ends, so every link died with the turn.
  `render.ts link` asks every port for `/__audara` and prints the one that serves this project, and
  `render.ts preview` starts the project's own Vite as a detached process that outlives the turn.
- **Renders are waited for.** A full render takes minutes, often past a tool's time limit for one
  command, and one left running in the background died when the turn ended. The render step now says to
  keep the turn open until it ends.
- **The example keeps its own palette.** It used the project palette's test-card names, so a project's
  real palette broke its type check, and agents tried to delete it (blocked by permission prompts) or
  kept the old names as aliases. It now has its own palette module.
- **The preview doesn't watch the cache.** In a sandbox the skills put uv's cache in `.audara-cache/`;
  Vite's watcher held its files open and uv's renames failed.
- **beats.py tracks with Beat This!, not librosa.** The plan started from librosa on the mix. Beat This!
  (MIT), a neural beat and downbeat tracker, runs on CPU in its own environment; with a grid fitted to
  its beats it put all 345 beats of the test song within 17 ms of the ground truth and every downbeat on
  the right bar. librosa stays as `--tracker librosa`, an analysis with no model download. Song windows
  snap to whole bars unless `--exact`, since an agent kept a half-bar cut "to keep exactly 30 s" despite
  the warning, and each window writes its own click track for the brief.
- **align.py runs on CPU anywhere.** pdoom-video's aligner used mlx-whisper, which only runs on Apple
  Silicon: align.py uses Demucs for the vocals, a CTC aligner for the words and faster-whisper only to
  cross-check them, in their own environment, with the models in the user cache.
- **A stand-in voice script.** The plan named a local open-source voice as a free path; without a script,
  two runs each wrote a Kokoro generator by hand, hit a Rust build or Windows' path limit, and levelled
  the voice wrongly. `standin.py` makes one the way `eleven.py tts` makes narration.
- **mix.py's measurements were rebuilt.** Its hit onset, the largest jump of the mono level, read bass
  zero crossings and stereo cancellation as attacks (20.271 s for a hit at 20.000); it now sums the
  channels' power, and it reports the build into each hit.
- **The template's palette is a test card.** The plan asked for an example "in a neutral look so it
  anchors no style". Grey with a cyan and a magenta reads as a placeholder, and `verify` warns while a
  real video still uses it, so no project inherits a look nobody chose.
- **The evals have their own harness.** skill-creator's trigger loop and `claude plugin eval` need a shell
  this machine doesn't give them on native Windows, so `evals/harness/` runs the queries and the
  multi-turn cases directly, with a decoy app on Vite's default port, a record of every live preview, a
  copy of Codex's session files and a mock of ElevenLabs that looks like a real account, and cleans what
  the runs leave in the tools' own settings.
- **Two marketplace files for Codex.** Besides the root `plugin.json` (Agent Plugins 1.0, with Codex's
  fields under `extensions.com.openai`), Codex reads its marketplace from `.agents/plugins/marketplace.json`.

## Sources

- [Anthropic: Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Claude Code: Skills](https://code.claude.com/docs/en/skills)
- [Claude Code: Plugins](https://code.claude.com/docs/en/plugins)
- [OpenAI: Build skills](https://learn.chatgpt.com/docs/build-skills)
- [OpenAI Codex: its built-in skill-creator skill](https://github.com/openai/codex/blob/main/codex-rs/skills/src/assets/samples/skill-creator/SKILL.md)
- [Agent Skills specification](https://agentskills.io/specification)
- [Agent Skills open standard: portable SKILL.md across Codex CLI, Claude Code and others](https://codex.danielvaughan.com/2026/05/05/agent-skills-open-standard-portable-skills-codex-cli-cross-agent/)
- [Codex: Package your plugin](https://developers.openai.com/codex/plugins/build)
- [Agent Plugins 1.0: One Package Format for Every AI Agent](https://blakecrosley.com/blog/agent-plugins-standard)
- [Agent Plugins 1.0: Why Claude Code Sat It Out](https://scienceshot.com/post/agent-plugins-1-0-claude-code)
- [Codex subagents](https://developers.openai.com/codex/subagents)
- [Codex CLI subagents: TOML format](https://codex.danielvaughan.com/2026/03/26/codex-cli-subagents-toml-parallelism/)
- [How to use Remotion Agent Skills with Claude Code](https://www.tella.com/blog/how-to-use-remotion-agent-skills-with-claude-code.md)
- [Remotion: @remotion/three](https://www.remotion.dev/docs/three)
- [Remotion: rendering WebGL with ANGLE](https://www.remotion.dev/docs/three-webgpu-canvas)
- [Remotion: license](https://www.remotion.dev/docs/license)
- [HyperFrames: Claude Code can now write and render videos](https://themenonlab.blog/blog/hyperframes-claude-code-writes-renders-videos)
- [HeyGen HyperFrames: HTML to MP4 for AI agents](https://www.noqta.tn/en/blog/heygen-hyperframes-html-to-mp4-ai-agent-video-2026)
- [Vercel Skills CLI (npx skills)](https://codex.danielvaughan.com/2026/05/31/codex-cli-vercel-skills-cli-npx-skills-open-agent-skills-ecosystem/)
- [hculap/skill-motion-graphic](https://github.com/hculap/skill-motion-graphic)
- [iart-ai/webgl-animation-skills](https://github.com/iart-ai/webgl-animation-skills)
- [ElevenLabs: text to speech with timestamps](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps)
- [ElevenLabs: compose music](https://elevenlabs.io/docs/api-reference/music/compose)
- [ElevenLabs: compose music with details](https://elevenlabs.io/docs/api-reference/music/compose-detailed)
- [ElevenLabs: create a composition plan](https://elevenlabs.io/docs/api-reference/music/create-composition-plan)
- [ElevenLabs: composition plans guide](https://elevenlabs.io/docs/eleven-api/guides/how-to/music/composition-plans)
- [ElevenLabs: sound effects](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert)
- [elevenlabs/skills](https://github.com/elevenlabs/skills)
- [echris6/motion-video-kit](https://github.com/echris6/motion-video-kit)
- [Hamza Khalid: How to create motion graphics with Claude Opus 5.5 (Full Course)](https://x.com/humzaakhalid/status/2105203643758895454)

