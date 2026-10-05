# audara-studio: design

How audara-studio works and why, for anyone changing it. It started as the design brief the build began
from (2026-10-02); it is kept true to the current version, edited in place when a behavior changes. How
it got here, with the evidence of each round (what the evals measured, what went wrong, what changed), is
in [history.md](history.md).

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

## Principles from the user

- Free tools first. A paid one (like Remotion for companies) is only an optional last resort, with its
  license stated before use.
- Simple and effective over complete: add a tool only when it clearly earns its place.
- READMEs stay short: what it is, install, first video. Details go in linked docs.
- Python only through uv (`uv run`, PEP 723 inline dependencies).

## The vision: the user directs, the agent builds

audara-studio makes the coding agent a film crew and the user its director. The director decides what they
want to decide (the idea, the words, the voice, the music, the look, the pacing, the length), as little as a
sentence or as much as a shot list; the crew follows that exactly and fills everything left open with its
own best work. The director watches the video take shape in the browser, gives notes by time, and can take
back any part at any time. They never have to write code or run a script, though they can. (Round 4 changed
this from "the director brings the material and the taste": with a short prompt nobody brings taste, and
the model read it as not its job; see history.md.)

This is how pdoom-video was made: in conversation, watched in a live preview, changed note by note. Every
part of the design serves that loop:

- **The f(t) rule** makes any moment linkable and re-renderable, and a change measurable: the same frame
  always has the same pixels, so `verify` hashes them and names exactly the stretches a change touched
  since its last run ("a note changes only what it names" is checked, not hoped for).
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

1. **Brief.** The agent decides what the request leaves open, writes the treatment and storyboard, sized
   to the piece, shows them and builds on; it waits only for what the director alone can decide. (Until
   round 4 the director approved the brief before any scene was built; history.md says why it changed.)
2. **Sound.** For a song, the agent analyzes its beats and lyrics. For narration, it writes the script, asks
   before spending ElevenLabs credits, and generates the voice and music with their timings.
3. **Setup.** It copies the engine into the folder, starts the preview and gives the director the link.
4. **Build.** It writes the scenes, several in parallel when there are many, and a critic reviews each one.
   The preview reloads as scenes change.
5. **Direct.** The director watches and gives notes by time ("at 0:23 the title should land on the
   snare"). The agent changes the scene and answers with a `?t=` link to that moment. This loop repeats for
   as long as the director wants.
6. **Render.** A build ends in the preview with the render offered; the director says "render it" (or
   asked for the MP4 in the request). A picture changed since the last critic round is reviewed on a
   quick draft first, so the render runs once. Each render comes with a quality report, a contact sheet
   and a poster frame. (Until 0.2.0 the first build ended with the MP4; history.md says why it changed.)

What the agent owes the director:

- a one-line status during long work;
- a link for every change;
- the work shown: contact sheets, numbers, critic verdicts;
- a question before anything that costs money, or spending within a budget they set;
- their decisions and rejections written down in the project, so later sessions keep them;
- their product as it is: its real screens (given, or captured from its live site with their OK) and only
  the figures they gave. A lookalike screen reads as the product and isn't, so a screen nobody has yet is
  asked for and stands in as a placeholder that reads as one.

It doesn't ask for approval of every step in between, and nothing waits on a missing screen but the moment
that shows it.

### Coming back later

A project outlives the session that started it. `init` writes a short `AGENTS.md` into the project with
what a later session needs:

- the videos in the project, and where each one's treatment is;
- the shared style and the engine guide;
- the preview and render commands;
- the f(t) rule, in one line;
- what the agent owes the director.

It also writes a one-line `CLAUDE.md` that imports it (`@AGENTS.md`); Codex reads `AGENTS.md` on its own.
The agent keeps `AGENTS.md` current as videos are added. `init` never replaces a project's own scripts, so
a project made by an older release keeps its `render.ts`: the generated section names only what that copy
can do, and says that `init --force` updates it. `render.ts` itself stops on an option it doesn't know,
since 0.2.0's copy ignored `--size` and rendered the video's own format under the same name.

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
  contact sheets against the treatment with fresh eyes (its protocol comes from
  motion-video-kit: history.md, "Lessons from motion-video-kit"). In a full-cut round it looks first as a
  stranger, from the render and the director's words alone, and writes that down before it reads the
  treatment, so the treatment's arguments can explain a choice but not change what a viewer saw. In v1 the
  lead starts a general-purpose subagent with the critic prompt from
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

### Another format: the same video, another frame

A director often wants one piece in two shapes, a 16:9 master and a 9:16 cut for the vertical apps.
Cropping the master loses what its edges carried and keeps type sized for the other screen, so the second
format is recomposed. It is the same video at another size: `--size 1080x1920` in every `render.ts` mode
and `?size=` in the preview, like `--fps`. The timeline, the sound, the timing data and the scenes are
shared, so a cut or a fix lands in both; the scenes read `W` and `H` and lay out for the frame they get;
and everything rendered for it goes to `out/<video>/<W>x<H>/`, so neither format's files replace the
other's. A size with the video's own shape is refused: that is the same picture smaller or bigger, the
720p flag history.md's 0.2.0 entry rejected (`--scale` makes it bigger).

A second video folder was the other way, and the engine already allowed most of it (another video's
scenes through `remix`, audio by a relative path). But a video reads its timing data from its own
`data/`, and `verify` resolves a song window's audio relative to the folder that holds the data, so the
copy would have needed the song's data and audio copied too, and the two would drift. A format that needs
another edit (another length, other scenes) is still another video.

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
   music, show the free plan first. Make the voice's first block and check it before generating the rest
   (by ear when the director wants to; by measurement otherwise). A budget the director sets counts as the yes.
3. **Keep the key out of the repo.** Read `ELEVENLABS_API_KEY` from the environment (the name the SDK and
   the official skills use). Never write it to a tracked file, print it or pass it as a command-line
   argument. If it's missing, the scripts say so and the skill goes on with the user's own audio or a silent
   placeholder track, so the picture work never waits for it.
4. **Keep the spoken text and the displayed text apart.** The narration text is spelled the way it should
   sound (pdoom-video's table in `docs/letra-explicada-pt-br/ROTEIRO.md`, "Grafia para a voz": "pê dum" for
   P(doom), "I-Á" for IA), so the timestamps are in spoken words. Keep a map from spoken to displayed words,
   so scenes still find words by what's on screen.
5. **Check the result by transcription.** Speech-to-text on the generated file confirms that it says what
   the text says. The user approves it by ear when they want to.

Lessons from pdoom-video's explainer to put in `references/elevenlabs.md` (`ROTEIRO.md`, "Geração no
ElevenLabs"): one voice and the same settings for every file; one paragraph of text is one block, and the
picture cuts in the silence between blocks; acronyms read better written as they appear on screen than
spelled out; generate the key lines several times and keep the most natural take.

### Adding more tools later

Add a tool only when it writes data the engine reads or does a step the model can't do by itself, and keep
it behind one line in SKILL.md. Cheap candidates: SRT captions from the word timings, and a thumbnail mode
(pdoom-video has `app/thumb.html` and `app/scripts/thumb.ts`). Leave out until a project needs them: stock
footage, voice cloning. (Image generation joined in round 4, as an option behind the same spending rules.)

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
- **Size and checks:** SKILL.md stays under 8,000 bytes, since Codex cuts an invoked skill there, and is
  saved without a byte-order mark. It passes three validators, each catching something the others miss
  (`evals/README.md`, "Spec checks").
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

## Layout

```
audara-studio/
├── README.md                         # short: what it is, install, first video
├── LICENSE, NOTICE                   # MIT; credits pdoom-video, motion-video-kit and the fonts
├── AGENTS.md, CLAUDE.md              # notes for agents working on this repo (CLAUDE.md imports AGENTS.md)
├── .claude-plugin/plugin.json        # Claude Code's manifest
├── .claude-plugin/marketplace.json   # Claude Code's marketplace
├── plugin.json                       # Agent Plugins 1.0, with Codex's fields under extensions.com.openai
├── .agents/plugins/marketplace.json  # Codex's marketplace
├── docs/design.md, docs/history.md   # how it works and why; how it got here
├── evals/                            # trigger and task evals, their harness, mocks of the paid APIs
└── skills/
    ├── code-video/                   # the picture: the engine and the method
    │   ├── SKILL.md                  # the session checklist, what is fixed, commands, which reference when
    │   ├── references/               # one level deep, each read when its case comes up (below)
    │   ├── scripts/init.ts           # (bun) makes a folder a project or adds a video: copies the template,
    │   │                             # writes ENGINE.md, AGENTS.md, CLAUDE.md and .gitignore entries
    │   ├── scripts/demo-track.ts     # the example video's synthesized demo track
    │   ├── scripts/qc.py             # holds, still at a glance, blank frames, loudness, stream tags on any MP4
    │   ├── scripts/imagegen.py       # optional: generated images, each with its request record
    │   └── assets/template-webgl/    # engine, preview player, render.ts, fonts, an example video
    │                                 # with one scene per way of drawing; pdoom specifics removed
    └── soundtrack/                   # the sound: audio in, timing data out
        ├── SKILL.md                  # generate (ElevenLabs), stand in, or analyze the user's audio
        ├── references/elevenlabs.md  # read only when generating: key, costs, voice and music lessons
        └── scripts/                  # uv scripts with PEP 723 inline deps
            ├── eleven.py             # tts | music | sfx → audio + request record + word timings
            ├── standin.py            # a free local voice (Kokoro) in eleven.py's place
            ├── beats.py              # beats, downbeats, sections, loudness → data/audio.json
            ├── align.py              # the user's own song: lyrics timed to the vocals
            ├── mix.py                # voice, music and effects; loudness by kind of piece
            └── *_models.py           # beats.py's and align.py's model stages, in their own environments
```

`soundtrack` always ends with the same output, whichever path it takes: audio files plus `data/*.json` in
the formats the engine's `audio.ts` and `words.ts` read.

`code-video/references/`, each named in SKILL.md with when to read it:

- `treatment-template.md`, `style-template.md`: the brief (idea, storyboard, scene briefs, Decisions) and
  the shared look (palette, type, tone, what to avoid).
- `engine-guide-template.md`: the project's `docs/ENGINE.md`, the scene API and its rules.
- `contract.md`: the f(t) rule's edge cases, three.js, images and footage, 4K, cheaper preview paths.
- `motion.md`: eases, keys, cuts, sync, pacing.
- `glsl-cookbook.md`: working code for lines at 4K, raymarching, kinetic type, karaoke, fields, particles,
  inks.
- `critique.md`: the director's loop, the stills loop, the critic and its prompts, the measured checks, the
  hand-off and the delivery.
- `images.md`, `blender.md`, `math.md`: optional tools, each read only when in play.
- `backends.md`: the order of choice (the engine, then HyperFrames, then Remotion as an optional last
  resort), and how to use the alternatives through their own skills.

### What `init` creates in a project

```
<project>/                       # one per brand or client, with several videos
├── AGENTS.md, CLAUDE.md         # conventions for later sessions ("Coming back later")
├── README.md                    # for the director: the commands to watch and render without an agent
│                                # (written once, when the project has none; theirs after that)
├── package.json, vite.config.ts, index.html, tsconfig.json
├── src/                         # the shared engine and preview player; src/look.ts holds the look in code
├── scripts/render.ts            # preview, link, stills, sheet, verify, perf, video, poster; --video <name>,
│                                # --size <w>x<h> for a second format
├── public/fonts/                # the shared fonts, with their licenses
├── docs/ENGINE.md               # the engine guide; docs/STYLE.md, the shared look, comes with the first look
├── videos/<name>/
│   ├── video.json               # title, size, fps, and its audio (or a duration)
│   ├── TREATMENT.md             # this video's idea, storyboard, scene briefs and Decisions
│   ├── CRITIQUE.md              # the critic rounds' ledger
│   ├── timeline.ts, scenes/     # its edit and its scene modules
│   ├── audio/                   # song, narration, music, effects, each with its request record
│   ├── assets/                  # images and footage, each with a line in SOURCES.md
│   └── data/                    # audio.json, and words.json for sung or spoken lines
├── .audara-cache/               # caches and scratch work, git-ignored
└── out/<name>/                  # renders, sheets and reports, not committed
```

- **The project folder is Vite's root,** so each video's audio and data are served from inside it, with no
  symlinks. pdoom-video kept them outside its `app/` folder and needed the `repoAssets` plugin
  (`vite.config.ts`) for Windows.
- **`words.json`** uses the format of pdoom-video's `lyrics.json` for sung and spoken lines alike, so scenes
  find narration words by their text exactly as they find lyrics.
- **Heavy model downloads** (`align.py`, `beats.py`'s tracker, `standin.py`'s voice) go to a user-level
  cache, not the project.
- **`.gitignore`:** `out/`, `node_modules/`, `.env` and caches.

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
- [rari: Motion Engineering: Build a Video Studio Around Opus 5.5](https://x.com/0xwhrrari/status/2105643919119696297)

