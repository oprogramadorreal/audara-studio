# Backends: the template, HyperFrames, Remotion

A backend is what draws and renders the frames. Read this before building with anything but the template,
or when a request seems to need HTML/CSS layout, React or cloud rendering. `references/…` and `<skill>/…`
are this skill's files; every other path is in the project, where commands run.

Contents: Order of choice · Switching · Keeping the method · Checked 2026-10-02 (install, commands, side
effects, licenses, versions)

## Order of choice

1. **The template** (the default) is built for what code does best: anything drawn rather than laid out.
   Shader fields and raymarched forms, generative systems, particles, three.js geometry and cameras, line
   work, kinetic type with animatable width and weight, pen-written strokes, composited in one frame with
   HDR post, motion blur averaged in linear light, and true 4K. It cuts and animates from the soundtrack's
   data, its preview gives the director `?t=` links and per-scene hot reload, and it is MIT and local. It
   doesn't imply shaders or 3D: choose the means for the image. Leave it only for something it can't do well, and name that thing; a better-known framework is not a reason.
2. **HyperFrames** (HeyGen; Apache-2.0, free) when HTML/CSS layout carries the piece: product and UI
   videos, text-heavy explainers, charts and tables that need real layout, captions or graphics over
   footage. GSAP, its default animation runtime, has its own free license (see the dated facts). A
   three.js or canvas layer can live inside it, so one shader moment doesn't force a switch.
3. **Remotion**, an optional last resort for what HyperFrames doesn't cover: React components or a Remotion
   project the director already has, its `<Player>` inside their React app, rendering on Lambda, Cloud Run
   or Vercel. It is paid for companies of four or more: say the license line under the dated facts and
   wait for a yes before installing anything.
4. **Something else you know better for the job** is fine: say why, keep the method below, and say what
   the director's loop loses. A renderer written from scratch usually has no live preview, so every note
   costs a full render.

## Switching

- Name the backend and the reason in the brief, so the director sees it with the treatment and can turn it down.
- Install the framework's own skills into the project, not globally (the lines are under the dated
  facts): they answer plain video requests too, and installed everywhere they compete with this one in
  every project. Ask before anything global or paid.
- `videos/<video>/` stays the video's home: the treatment, the soundtrack's audio and data. Stills, sheets
  and renders go to `out/<video>/` at the project root. Make the framework's project with its own init in a
  new folder outside `src/` and `videos/` (the template type-checks those), e.g. `hyperframes/<video>/`.
- Note the backend, its folder, its version and its preview and render commands in `AGENTS.md`, outside
  the section `init` regenerates, so a later session uses them instead of the template's preview. With no
  `AGENTS.md`, write a short one (videos and treatments, commands, the f(t) rule, what the director is
  owed) and a `CLAUDE.md` holding `@AGENTS.md`.

## Keeping the method

The framework's skills teach its API; what carries over from this skill is the method around it.

**Every frame a function of `t`.** Both renderers seek frames in any order and across workers, so no
clocks, rAF timing, unseeded `Math.random()` or data fetched while rendering. HyperFrames seeks a paused
GSAP timeline to `t` and Remotion renders `useCurrentFrame()`; how to write either so it survives seeking
is in their skills, and the determinism check below catches what slips.

**Timing from the soundtrack's data.** `soundtrack` writes `data/audio.json` (beats, downbeats, sections,
envelopes, onsets) and `data/words.json` (`lines[].words[]` with `w`, `start`, `end`) whatever the
backend. Find words by their text and cut on the grid. Don't let the framework measure the beats again:
two timing sources drift apart.
- HyperFrames: inline both files in the HyperFrames composition, since it bans fetching required data at
  render time; regenerate that script whenever `soundtrack` rewrites them, and take the root's
  `data-duration` from the data too. Then the timeline reads them as the template's scenes do:

  ```js
  const AUDIO = /* data/audio.json */, WORDS = /* data/words.json */;
  const line = (q) => WORDS.lines.find((l) => l.text.toLowerCase().includes(q));
  tl.fromTo('#hook', from, to, line('words of the hook').start);   // on a line, found by its text
  AUDIO.downbeats.forEach((d) => tl.fromTo('.bar', from, to, d));  // on every bar
  ```

  Its Studio analyzes the music itself unless it finds a beats file first: write one from `AUDIO.beats`
  before it opens (format under the dated facts).
- Remotion: point its public folder at the video's folder, read both files in `calculateMetadata()`, take
  the Remotion composition's length from `audio.duration` there, and convert times to frames with
  `Math.round(sec * fps)`.
- Captions: flatten `words.json`'s lines into the framework's caption format (per its skill), keeping the
  word times.

**The briefs.** The treatment and `docs/STYLE.md` stay the source of truth; palette and type become CSS
variables or a theme, and fonts from `public/fonts/` travel with their license files. The frameworks'
catalog blocks and style presets are someone else's look: take their mechanics, not their style. If
HyperFrames' router or workflows are installed, a `BRIEF.md` in its folder keeps their interview, beat
analysis and checkpoints out of the director's loop (its values are under the dated facts).

**The preview and links.** Each change still comes back with a link: the studio's address, the exact time
and a still of that moment, since neither studio takes a time in its URL. For real `?t=` links in
HyperFrames, a small page around its `<hyperframes-player>` element can call `seek(t)` with the URL's `t`
(untested).

**Stills, the critic, the render and the QC report.**
- Take the frames the template's `sheet --cuts` takes, not only mid-beat ones: frame 0, the last frame, and
  around every cut 0.1 s before, the frame before, the cut frame, the frame after and 0.1 s after. Blank
  frames and blinking titles hide there. Tile the stills into a sheet labelled with times, a cut per row,
  look at it, and keep stills and sheets in `out/<video>/`: they are part of the work shown. The commands
  are under the dated facts.
- The critic loop in `references/critique.md` is unchanged; give the critic the framework's still and
  render commands so it picks its own times. Deliver the render with the QC report's numbers, the sheet
  and a poster frame. With no `verify.json`, pass the cut times, computed from the timing data:
  `uv run <skill>/scripts/qc.py out/<video>/<video>.mp4 --cuts 3.9,8.1,12.4`; without them, blank frames
  at a cut are reported as mid-video.
- Determinism: reach one moment through two seek histories and compare the PNGs byte for byte; a
  difference is hidden state. In HyperFrames, give each history its own folder, since `snapshot` names
  files by index and time and the second run would overwrite the first:
  `snapshot <folder> --at 4.9,5 -o out/<video>/det-a`, then `--at 6,5 -o out/<video>/det-b`, and compare
  `det-a/frame-01-at-5.000s.png` with `det-b/frame-01-at-5.000s.png` (untested). In Remotion, hidden
  state shows as flicker, since it renders in several tabs.

## Checked 2026-10-02

These change, HyperFrames several times a day; re-check before quoting or relying on them, and pin the
version a video was made with (`npx hyperframes@<version>`) in `AGENTS.md`.

**Install**

```bash
# HyperFrames (default): the three skills a build needs, into .agents/skills/ and .claude/skills/
npx skills add heygen-com/hyperframes -s hyperframes-core hyperframes-animation hyperframes-cli -a claude-code -a codex -y
# or HeyGen's plugin, with all its skills, router and workflows included (then write BRIEF.md, below)
claude plugin marketplace add heygen-com/hyperframes --scope project
claude plugin install hyperframes@hyperframes --scope project
codex plugin marketplace add heygen-com/hyperframes
codex plugin add hyperframes@hyperframes          # Codex enables it for every project

# Remotion: all its skills, into this project, for both tools
npx skills add remotion-dev/skills -a claude-code -a codex -y
claude plugin marketplace add remotion-dev/claude-code-plugin --scope project
claude plugin install remotion@remotion --scope project
# Codex: "Remotion" in its plugin directory (/plugins, or the ChatGPT app's Plugins tab), then $remotion;
# its Claude Code marketplace doesn't load in Codex
```

HyperFrames' router and workflows run their own brief interview, beat analysis and plan, which this skill
already does; the three domain skills hold the composition contract, GSAP and its adapters, and the CLI.
Add others with `-s` when a build needs them (`--list` shows them). Skills added mid-session may need a
new session (or `/reload-plugins` in Claude Code) to load. `--scope project` on the Claude Code plugin
lines is untested.

**Commands**

```bash
npx hyperframes preview                                                # from its folder
npx remotion studio                                                    # then http://localhost:3000/<CompositionId>
npx hyperframes snapshot <folder> --at 3.48,3.5,3.52 --no-end --describe false -o out/<video>/stills
npx remotion render <CompositionId> out/<video>/stills --frames=209,210,211 --image-format=png
npx remotion still <CompositionId> out/<video>/f210.png --frame=210    # one frame, any Remotion version
npx hyperframes render <folder> --output out/<video>/<video>.mp4       # --quality draft while iterating
npx remotion render <CompositionId> out/<video>/<video>.mp4            # --gl=angle when it draws WebGL
```

- HyperFrames Studio's beats file: `beats/<audio path>.json`,
  `{"version": 1, "audio": "<audio path>", "beats": [{"time": 0.5, "strength": 1}]}`.
- HyperFrames `BRIEF.md`, written right after its init (init refuses a non-empty folder):
  `workflow: general-video`, `flow: automation`, `storyboard: no`, `message` and `aspect` from the
  treatment, and a body that points to the treatment. A workflow that finds it asks no brief question;
  `general-video` keeps `music-to-video` and its beat analyzer out, and `automation` with `storyboard: no`
  states its choices instead of stopping at checkpoints the director already passed (from HeyGen's docs,
  not tested together). Remotion's skills need no such file.
- Remotion's public folder: `Config.setPublicDir('../videos/<video>')` in `remotion.config.ts`, files read
  with `staticFile()` (untested outside its project). WebGL rendered headless needs `--gl=angle`
  (`swangle` without a GPU; `chromiumOptions: {gl: 'angle'}` in its render APIs), or the canvas can come
  out empty; `Config.setChromiumOpenGlRenderer('angle')` covers its CLI and Studio, not the render APIs.

**Side effects**

HyperFrames:
- Telemetry is on by default and reports which coding agent runs it: tell the director, and run its
  commands with `HYPERFRAMES_NO_TELEMETRY=1` unless they'd rather share (`npx hyperframes telemetry
  disable` turns it off machine-wide).
- `init` refreshes HyperFrames skills installed globally (`HYPERFRAMES_SKIP_SKILLS=1` stops it), and the
  router installs workflows on demand with `npx hyperframes skills update`, which links skills into every
  agent on the machine: ask before either.
- `snapshot` sends frames to Gemini whenever `GEMINI_API_KEY` is set, unless `--describe false`;
  `media-use` stores choices (aspect, voice, style) as preferences for later projects.
- Cloud, Lambda and Cloud Run rendering and hosted services can cost money and upload the work: ask first.
- On Windows and macOS, a multi-worker render first writes raw frames to disk (about 25 GB a minute at
  1080p30): `--workers 1`, or `HF_CAPTURE_PARALLEL_STREAM=true`.

Remotion:
- Telemetry: client-side rendering always sends it; server-side rendering sends none unless a
  `licenseKey` is set.
- Its getting-started prompt installs its skills globally (`-g`); use the project line above.
- Lambda, Cloud Run and Vercel rendering bill the director's cloud account: ask first.

Other skills: HyperFrames' router and Remotion's skills both answer plain "make a video" requests, image
and video generators can take over an approach and spend quota, and general WebGL skills animate from
clock deltas (`clock.getDelta()`, `mixer.update(dt)`), which break f(t). While this skill drives, it picks
the backend; use another skill only for the backend chosen, and keep its interview, analysis and spending
out of the director's loop unless the director asks for them.

**Licenses**
- **Remotion** ([FAQ](https://www.remotion.dev/docs/license/faq)): free for an individual, an
  organization of up to 3 people, a non-profit, or while evaluating it; source-available, not open source.
  Say before using it: "Remotion is free for individuals and teams of up to 3 people. A company of 4 or
  more (freelancers and agencies on the same project count toward the 4) needs a license: Remotion for
  Creators, $25 a month for each person who writes Remotion code themselves or with an AI coding tool, is
  for producing videos without setting up an automation; Remotion for Automators, $0.01 per render with a
  $100 monthly minimum, is for owning code that programmatically calls its renderer (`npx remotion render`
  included) or its `<Player>`. Shall I use it?" The FAQ doesn't say whether an agent running the CLI for
  the director counts as an automation; a company that depends on the difference should ask Remotion
  (hi@remotion.dev).
- **GSAP** ([licensing](https://gsap.com/licensing/)): "Standard No Charge", free including commercial
  work; the exception is building a no-code visual animation tool that competes with Webflow.

**Versions and time links**
- HyperFrames 0.8.113, needing Node.js 22 or later and FFmpeg. Remotion 4.0.532; a list in `--frames`
  needs 4.0.502 or later. Remotion 5.0 is unreleased: it makes ANGLE the default and telemetry mandatory
  for automations.
- Neither HyperFrames Studio nor Remotion Studio documents a time in its URL.
