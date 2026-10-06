# audara-studio: history

How audara-studio got to where it is, in order: the plan's acceptance criteria and research
(2026-10-02), what the first build checked and where it went differently, and each round since, with
what was measured and what changed. Entries are added at the end and not rewritten. How it works now:
[design.md](design.md).

Contents
- Definition of done (the plan)
- Similar work to read first (the plan)
- Lessons from motion-video-kit (the plan)
- Lessons from Hamza Khalid's Opus 5.5 course (the plan)
- What the build checked
- Built differently from the plan, and why
- Round 4: direction first, and taste when it's left open (2026-10-04)
- After round 4: a build ends in the preview (0.2.0, 2026-10-05)
- Lessons from the motion-engineering article (0.3.0, 2026-10-05)

## Definition of done

- One command (`init`) adds the template to a new project, and its preview plays the example video over a
  generated demo track.
- In both Claude Code and Codex, the skills trigger on a plain request ("make a 30-second video for this
  song") and produce the test videos ("What the build checked").
- Both skills follow "Writing the skills" (design.md): they pass `skills-ref validate`, their trigger and task evals
  pass in both tools, and the creative-range eval shows they don't narrow what the model makes.
- `render.ts verify` passes, including the determinism check, and `qc.py` reports on the final MP4s.
- Without an ElevenLabs key, everything except audio generation still works.
- A later session in a project made with audara, asked for a small change ("make the intro slower"), follows
  the project's conventions without anyone naming a skill.
- The plugin installs from https://github.com/oprogramadorreal/audara-studio in both Claude Code and Codex.
- The README stays short: what it is, install, first video.

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
  - Round 3, on the cases this round's changes touched (the title card, the no-key voiceover and the later
    session, in both tools): 87% of assertions, against 78% in round 2 and 53% in round 1 on the same
    cases. The preview served every project through its last turn, the example kept its own palette, no
    final render ran before "Render it.", both voiceovers used `standin.py`, and both later sessions said
    which reading of the note they took and offered the other. What still missed: briefs over their
    word budget, and a stand-in hand-off without its license line and cache paths; the skill text was
    tightened for both afterwards, without another round.
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

- **The approval stop was a fixed rule (until round 4).** The plan made "show the brief, then build" one step of the
  session, and everything outside the fixed rules is a default the model may override with a reason. In
  the first task evals, five of six new-video runs built and rendered before the director saw a plan:
  Claude wrote "since this session couldn't wait for a reply", and Codex cited its own rule to finish
  authorized work (its question tool also returned "accepted" before anyone answered). Asking for a
  video now authorized its brief, not its build, and the render waited for the director's own word. Round 4
  keeps the brief shown first but builds on, and ends the first build with its MP4 (see "Round 4").
- **Replies list what they deliver.** "Show all of it" lost to the tools' terse final messages: a render
  reply came back as one MP4 link. The render step and the soundtrack's "show the work" name what every
  last reply carries (the files, the sheets, qc.py's numbers, a link to each unmarked hold).
- **A preview command.** The plan had the agent run `bunx vite` and read the address it prints. Port 5173
  is Vite's default, so another app often holds it (one later session linked an unrelated site), and a
  headless session stops its background shells when its turn ends, so every link died with the turn.
  `render.ts link` asks every port for `/__audara` and prints the one that serves this project, and
  `render.ts preview` starts the project's own Vite as a detached process that outlives the turn. On
  Windows it first marks its own handles non-inheritable: otherwise Vite kept the caller's output pipe,
  and Codex waited for a command that had already finished.
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
  the runs leave in the tools' own settings. Its runs keep computer-use and browser plugins off in both tools:
  in one round a Codex run's computer-use plugin drove the user's real browser to look at a preview.
- **Two marketplace files for Codex.** Besides the root `plugin.json` (Agent Plugins 1.0, with Codex's
  fields under `extensions.com.openai`), Codex reads its marketplace from `.agents/plugins/marketplace.json`.

## Round 4: direction first, and taste when it's left open (2026-10-04)

Four videos made with short casual prompts on 2026-10-03 (a narrated git explainer and a lyric video for the
chorus of the user's song, each in Claude Code and in Codex, on commit `5f73a08`) came out competent at best:
the explainers clear but simple, the lyric videos weak. The user's prompts asked for nothing plain. What the
videos, the transcripts and four runs of the same prompts without the skills showed:

- **One look for all four.** Two tools, two subjects, the same palette: a warm off-white paper ground, near-
  black ink, one red accent, bloom off, flat Canvas2D on an empty ground. It is the negative of the archetype
  the Avoid list named (a dark ground, ivory type, one warm accent). The song treatment said so: "the usual
  would be dark neon, glitch and robots; here it's the opposite: paper, ink and a graph". Anthropic's own
  Opus 5.5 notes describe this: a general "avoid a generic look" mostly swaps one default for another.
- **The look was fixed in words in minutes,** before the engine, the example scenes or the cookbook were
  read and before any frame existed (Codex: 0 reasoning tokens on the treatment), and the user approved it as
  one line of text.
- **All of the taste guidance said what to avoid.** No line in either skill asked for anything striking;
  "derive the look from the subject's own material" became props drawn flat on paper; "a typographic card
  needs no shader" and "Draw in code ... only when asked" pointed down; the rights line ("no imitation of
  other artists' characters") kept the lyric's monsters out of the picture.
- **The critic checked correctness and waved taste off** ("Stop ... when what's left is cosmetic: taste the
  director hasn't raised"; "a choice the treatment argues for is reported, not acted on"). It shipped a
  lyric video that is nine still type cards, and a narrated one at 71% frozen, as "reading holds". One
  session never ran a critic.
- **qc.py couldn't see it.** A 1.3 px sway of the type made "frozen 0 s, nearly frozen 0 s" out of a video
  that sits still to the eye 79% of the time.
- **The stop before building added nothing** in any of the four: every default was accepted, and the first
  frame came 20-27 minutes after the prompt.
- **Not the model tier:** Opus 5.5 at xhigh and GPT-6 Astra at ultra ran every thread, subagents included.
  Not time either: the sessions stopped working on the picture by choice, because nothing in their loop asked
  about it.
- **Without the skills,** on the same prompts, Claude made a varied illustrated sky explainer (richer than
  any of the four) and a green terminal karaoke for the song; Codex made dark slides and a dark karaoke with
  interface chrome. The model alone reaches for its own defaults; with the old skills it reached for their
  mirror image.

What changed, and why:

- **The user decides what they decide; the model fills the rest, aiming high.** SKILL.md opens with the
  parts of a video and that rule, and a short "When the look is yours" bar: an image that carries the idea,
  tied to the words sideways (the pdoom video's author: "approach them sideways"), what code draws that slides
  can't, the picture changing where the sound does, plain only as a choice. No motivational phrasing: Anthropic
  dropped "Don't hold back" from its docs, and no study measures such phrases; both companies now advise
  naming defaults, stating the outcome and proposing options before building.
- **The brief is shown and the build goes on,** unless something only the director can decide is open. The
  stop was added in round 1 because runs built without showing a plan; showing it remains, waiting doesn't.
- **Style frames:** when the look is open, two or three directions rendered in the engine, chosen by looking,
  which is the one approach Anthropic calls reliable against default looks.
- **The Avoid list** names the paper twin and says that steering clear of a list is not a look.
- **The critic** gives a viewer's verdict first, and a plain or slide-like picture nobody asked for is a
  finding, not taste; qc.py's "still at a glance" gives it a number.
- **Sound left open is made** (synthesized for free; paid voice or music after a yes, with a free stand-in
  meanwhile); **the first build ends with the MP4** (the tests' users asked for it every time).
- **Decisions are written down:** a Decisions section in the treatment and STYLE.md, in the director's words,
  rejections included; AGENTS.md tells later sessions to read it. A script, shot list or exact timecode the
  director gives is kept as given; problems are raised with a fix, not edited in.
- **Spending:** a budget the director sets is the yes for what fits it. The voice is checked by measurement
  before the rest is made; takes and voices are picked by measurement when left to the model.
- **Optional tools, each read only when in play:** generated images (`imagegen.py`, GPT Image 2.5, behind the
  same rules as ElevenLabs; Codex's built-in generation counts as spending), public-domain and the director's
  images, Blender (headless; a GLB driven from `t` first), and math (MathJax drawn in the engine first, Manim
  as footage). Generated video clips stay out unless asked: am.will's model tried Veo and used none, and they
  were part of a $200 bill.

Considered and rejected:

- **Blender through an MCP server or screen control:** both need a window and someone watching (the MCP add-on
  hangs in background mode; Claude Code's computer use isn't available headless), and fail the unattended,
  same-in-both-tools test.
- **Manim as a dependency or default:** it leaves the live preview and the engine's motion blur, needs a
  second timing system, and its default look is the generic "AI explainer"; TeX, the one real gap, MathJax
  fills in the browser.
- **Motivational phrases** ("go all out"): retired by Anthropic, unmeasured, and they don't say what better is.
- **Removing the Avoid list:** the codex jazz loop converged without it; it now names defaults instead of
  standing in for a look.
- **A fourth skill for images:** one reference and one script in code-video carry it.

### What round 4 checked

Headless runs on Windows 11, Claude Code (Opus 5.5) and Codex (GPT-6 Astra), on the users' plans, with ElevenLabs
and the image API mocked (`evals/README.md`); one grader per run checked each assertion with its own
measurements, and three blind judges ranked each set of videos made from the same prompt.

- **Blind, the short prompts** (overall "would impress", 1-10, three judges):

  | Lyric video for the chorus of `pdoom-pt-BR.mp3` | Judges | | "Why the sky is blue", zero assets | Judges |
  |---|---|---|---|---|
  | Claude, with the round-4 skills | 9, 9, 9 | | Claude, with the round-4 skills | 8, 8, 8 |
  | Claude, the 2026-10-03 test (old skills) | 8, 8, 7 | | Claude, without the skills | 6, 6, 7 |
  | Claude, without the skills | 7, 7, 7 | | Codex, with the round-4 skills | 5.5, 5, 5 |
  | Codex, the 2026-10-03 test (old skills) | 5, 5, 3 | | Codex, without the skills | 4, 4, 3 |
  | Codex, with the round-4 skills | 4, 4, 4 | | | |
  | Codex, without the skills | 3, 3, 2 | | | |

  Every judge put the round-4 Claude video first in both sets and named it the one to show; the skills beat
  the model alone in both tools. Codex's lyric video moved from cream karaoke cards to a full-frame shader
  field but stayed captions over a background any song could have, no better than the old test; the text
  that names that pattern and asks style frames to differ in idea came after that run.
- **No stops before something to watch** in any run, with or without the skills.
- **Codex follows the process better than Claude and its taste less.** On the final text it posted the
  preview link within two minutes and the style frames within three, recorded the director's words and
  rejections, and built without stopping; but it kept converging (the paper twin's skeleton in stone and
  orange after a rejection, the dark-ground archetype with a cool accent for a title card), its style
  frames restyled one layout, an open toolbox gave a Ken Burns move over one generated illustration, and
  its critics shipped all of it as justified. Claude's taste carried its runs, while its process (posting
  early, waiting for critics) slipped. The critic now counts only the treatment's own argument for an
  archetype and names a camera move over one still.
- **Direction is kept:** decisions and rejections were written in the director's words, in the treatment and
  in STYLE.md's Avoid marked (director), and a new session read them; an exact timecode stayed off the beat
  grid "by their word"; a locked script's 43 words came out exactly, with only the say map's respelling
  spoken. Misses: drop marks that read as tree rings slipped past "no plant icons" because the critics that
  caught it ran in the background and died with the turn.
- **Process misses the graders found,** each fixed in the text afterwards: the treatment, the preview link
  and the style frames shown only at the end of 55-88-minute silent builds; critics and a final render
  started in the background and lost when a headless turn ended; style frames that varied the surface, not
  the idea. Two script bugs were found and fixed: `align.py` gave an acronym's held vowel to the next word
  (RLHF 0.6 s early), and contact sheets over 3.75 MiB were re-encoded to 256 colours by Claude Code's image
  reader, painting grey haze into the critics' view.
- **Not run:** the stand-alone second wave of the short prompts on the final text (stopped when the machine
  ran low on memory with four renders at once), real image generation and real ElevenLabs music with
  `--free-form` (no paid calls were made), and Blender or Manim outside Windows.

## After round 4: a build ends in the preview (0.2.0, 2026-10-05)

The user ran the README's first prompt in two empty folders, in Claude Code (Opus 5.5, xhigh) and in Codex
(GPT-6 Astra, ultra), on commit `922b77b`. Both videos were fine, Claude's the better taste, but both took
long and both ended with a final render nobody asked for: the user expected the build to end in the preview,
with an offer to render.

- **The skill asked for that render.** "The first build ends with the MP4" came in round 4 because "the
  tests' users asked for it every time", but those users were the cases' scripted turns ("Render it.",
  "I want the MP4"). Asked to "make a video", the one real user wanted to watch it first.
- **The render was a small part of the wait.** Claude's session took 92 minutes: about 15 for the brief,
  the style frames and the sound, 33 for three scene authors, 36 for two critic rounds and their fixes, 5
  for the final render and 1 for QC, sheets and the poster. Codex's took 24.5, and its 4-minute render ran
  alongside its verification critic. Ending in the preview spares the render, not the review.
- **The first notes usually change the picture,** and then the first MP4 is thrown away.

What changed: a build ends in the preview, with its link, the critic's verdict, qc.py's lines on the
critic's draft and the render offered with its time; a render waits until the director asks for the file
(a render, an export, the MP4), in the request or later. "make a video" alone isn't that. AGENTS.md and the
README say the same. In the task cases, cv-zero-asset (the README's prompt) checks that turn 1 ends in the
preview and turn 2's "I want the MP4" renders it, and cases that measured an MP4 without asking for one
measure the last MP4, draft or final.

The critic rounds were kept. Frames from the draft the first critic saw and the final cut at the same times
show the same idea, palette and layout in both tools (Codex's critic called its draft "five illustrated
slides", and the final still is), so taste is set before the critics, by the style frames and the scenes.
But the first round fixed what a viewer would notice: 53% and 60% of the cut still at a glance (Codex's
went to 0%), the loudest music under the stillest picture, effects buried in the mix, and science that
misled (waves that made longer wavelengths travel faster, red light that missed the molecule, white rays
under "scattered blue"). The verification found less (three smaller fixes in Claude, one of them a
regression the first round's fixes made; SHIP in Codex) and cost about 14 minutes in Claude. Guessing
from a prompt that the director means to iterate over many sessions was rejected: prompts rarely say so.
A director who asks for speed ("a quick version", "a rough cut") gets the full-cut round and its fixes,
and a render they ask for later gets a full-cut review in place of the verification.

The same release split this file from design.md, which now says only how the plugin works and is edited
in place, and gave the repo a short AGENTS.md (with a CLAUDE.md that imports it) for agents working on it:
the session that made these changes had to rediscover the 8,000-byte limit, how the eval cases are written
and the two version fields, and left a stray file. Eval runs work below those notes, and Claude Code reads
an AGENTS.md or CLAUDE.md from every folder above its own, so the runners now leave both out
(`claudeMdExcludes`, `evals/README.md`).

### What 0.2.0 checked

`cv-zero-asset`, the README's prompt, on this release's text in both tools (Claude Code with Opus 5.5 and
Codex with GPT-6 Astra, the user's defaults), each run graded by a fresh grader with its own measurements.

- **Both pass every assertion that could be graded:** a 20 s MP4 with music and effects on picture events,
  nothing requested from the ElevenLabs mock, true science, no stop before something to watch, `verify`
  passing. The blind comparison with runs without the skills wasn't made.
- **Turn 1 ended in the preview in both, with draft renders only.**
  - Claude, after 67 minutes and two critic rounds. Its reply gave the preview link and the moments to
    watch first, each critic round, QC on the draft with a link to each still stretch, and the render
    offered at "about 3–8 minutes".
  - Codex, after 12 minutes and three rounds. Its reply was terse: no critic verdict, no time for the
    render. The Hand-off now names both as given every time.
  - Turn 2's "I want the MP4" rendered it in both.
- **Claude's turn 2 took 40 minutes and rendered the MP4 three times.** Delivery put the owed review after
  the render, so each round's findings meant another render: render, full-cut critic, fixes, render,
  verification, fixes, render. Delivery now reviews a draft first, in one round, and renders once; the
  fixes it makes come back with their links, since the director hasn't seen them.
- **Codex's whooshes started on their cuts and peaked 0.3 s after them.** Effects that lead into a cut
  now go by their peak.
- **Not changed:** Codex kept one headline-over-diagram layout in all four scenes after its critic flagged
  it twice, and an arc ran through a label nobody caught (taste and the critic's eye, as in round 4).
  Claude's turn 2 ended three times while a render ran, and only the tool's background notifications
  brought it back.

After those runs, `init` also writes a `README.md` into a project that has none: the two commands for
the director to watch the preview and render the MP4 without an agent (`bun run render preview`,
`bun run render video`). It comes from the template, so the copy that skips existing files writes it
once; a README already there is the director's, never replaced or reported, not even with `--force`.

And a render now says what it will write before it starts: `-> out/<video>/<video>.mp4: 1920x1080 at 60
fps, 20 s (1200 frames)`, with `(2x the video's 1920x1080)` under `--scale 2`. Until then the size showed
only on the last line, minutes later, so a director rendering from the README could find a size they
didn't expect only at the end. The size stays the video's own, set with the director in the brief
(`video.json`), whatever the aspect ratio: the README says where it comes from, and the hand-off's offer
names it before the director says "render it". A 720p flag was rejected: scenes are laid out in the
video's pixels and the renderer scales by whole numbers only.

## Lessons from the motion-engineering article (0.3.0, 2026-10-05)

[rari's article](https://x.com/0xwhrrari/status/2105643919119696297) ("Motion Engineering: Build a Video
Studio Around Opus 5.5", X, 2026-10-01), read through a restatement of it and its replies, makes the same
case as Hamza Khalid's and motion-video-kit's: the quality comes from the system around the model, a
deterministic frame function, a gated review loop, and files that let the next film start from the last.
Most of it was here already:

- the frame as a pure function of time, seeded, seekable: the f(t) rule, which `verify` proves;
- its five layers (brief, style guide, shot list, renderer, critic): TREATMENT.md, STYLE.md, the timeline
  and scenes, CRITIQUE.md;
- each beat with an entry, an exit and a reason, unjustified shots cut: the storyboard's job and
  transition columns, "a row without one is filler";
- contact sheets before export and a critic that names its top defects with a time, the evidence and a
  fix: `sheet --cuts`, the fresh critic and its verification;
- picture and sound on one beat grid: the soundtrack's data, with every time read from it;
- "where does taste memory live?" (a reply): Decisions in the director's words, rejections included.

Four things were worth taking, two of them answers to failures recorded above:

- **The full-cut critic looks before it reads.** The article's critic judges the rendered frames with no
  statement of intent. Ours read the treatment first, and in round 4 critics weighing its arguments
  shipped a lyric video of nine still type cards as "reading holds" and archetype looks as justified. The
  critic now writes a first look (what it shows, whether it holds a stranger, its weakest stretch) from
  qc.py and a sheet of the whole render, with only the director's words and where it plays, before it
  opens TREATMENT.md or STYLE.md; item 0 of its report quotes it. The director's words still come first:
  they bind.
- **`verify` says which stretches changed.** A reply proposed versioned data with pixel-diff checks before
  every render. The f(t) rule makes such a check exact: verify now hashes the frames at every half second,
  cut and word start, compares them with the report it replaces (or `--since <report>`), and prints the
  stretches that differ, their scenes, and the timeline entries that moved. That measures "a note changes
  only what it names" and catches what 0.2.0's verification found by eye, a regression the first round's
  fixes made. On the example (16 s, 62 frames rendered, 48 hashed): a constant changed in one GLSL scene
  gave "10 of 48 frames, in 0.000–3.983 s ('fspass')"; a cut moved a bar gave the two entries' old and new
  spans and their changed frames; undone, `--since` a copy of the first report gave "no frame". The
  readback waits for the GPU, about 17 ms a frame at 1080p (verify 2.4 s without it, 3.5 s hashing every
  frame it renders), so it hashes those frames only, not the four a lyric video renders per word. A
  verification critic gets the stretches measured since the render it reviewed; the Direct step, the
  project's AGENTS.md and the later-session case use them after a note. A project copied without `out/`
  has nothing to compare with, so a session there runs verify before it changes anything.
- **A second format is recomposed, not cropped** (the article's per-format compositions). Nothing said how to
  make a 9:16 of a 16:9 video. Reading the engine showed a second video folder couldn't share the first's
  data: a video reads its timing from its own `data/`, and verify resolves a song window's audio relative to
  the folder that holds the data, so a copy fails there unless the audio is copied too, and then the two
  drift. So it is the same video at another size, `--size 1080x1920` in every render.ts mode and `?size=` in
  the preview, like `--fps`, with its files under `out/<video>/<W>x<H>/`. It refuses a size with the video's
  own shape: that would be the 720p flag 0.2.0 rejected, the same picture smaller, laid out anew. On the
  example: verify passes at 1080x1920, its sheet and a draft clip come out 1080x1920, its scenes (which read
  `W` and `H`) recompose rather than crop, and the 16:9 outputs are untouched.
- **A product film shows the product's real screens** (the article's main use case: real screens and
  metrics, never invented; a missing asset means asking). We had "no invented logo, tagline or label" and
  Never claim, nothing on screens, and the style template's Rights line ("a real product's interface" is
  out) could read as a reason to redraw the director's own app. The treatment's open parts now have a row
  for product screens and figures, a screen the story needs that nobody has is asked for and told another
  way meanwhile, the critics check screens against SOURCES.md, and images.md has a capture recipe with the
  project's own playwright-core (tested on a local page: a 390×844 phone viewport at 3× gave a 1170×2531
  PNG).

Left out, and why:

- **Six approval gates:** round 4 measured that the stop before building added nothing and delayed the
  first frame by 20-27 minutes. "Wait only for what only the director can decide" already covers the
  article's real stops, a missing asset and an irreversible brand decision.
- **A 1-5 score per criterion:** the article gives no scale; ranked findings with their evidence and
  SHIP or ONE MORE PASS say more.
- **Separate brief, shot list and review files:** the same content as TREATMENT.md and CRITIQUE.md.
- **Re-rendering only the frames a fix touched:** f(t) would allow it, but delivery already reviews a draft
  and renders once; it pays only if pieces several minutes long become common.
- **Checking sound against picture automatically:** the failure it guards (a click that lags, a cut off the
  beat) is prevented upstream here, since every time comes from the data and mix.py measures the onsets.
- **p5.brush, GenMotion, a taste memory across projects:** the cookbook's inks and stroke fonts, backends.md
  and the agents' own memory cover them.
- **Cheap, with no failure recorded yet:** a check that a feed video earns the first two seconds, motion
  rules per kind of element in STYLE.md, captions for viewers with the sound off (already a candidate in
  design.md), the pacing of a reference clip measured with qc.py.

`code-video/SKILL.md` names verify in its Direct step and stays under the limit at 7,999 bytes, with four
phrases shortened elsewhere. The new cases (`cv-second-format`, `cv-product-real-screens`, with two phone
screens of a made-up app drawn by fixtures.ts) and the changed assertions (`cv-zero-asset`,
`cv-range-loop`, `cv-later-session-small-change`) were written, not run: each takes an hour or more per case
and tool, and whether a first look changes what critics ship is measured only by them.

A review of the branch by Codex (GPT-6 Astra) before merging found three defects, each confirmed and fixed:

- **The change report could flag a frame that hadn't changed.** It matched the two runs' frames by their
  time rounded to 0.1 ms, which merged a word's frame at 0.49997 s with the half second's at 0.5 s, two
  different frames. With a word starting at 0.4833 s on the example, two identical runs reported "1 of 44
  frames, in 0.500 s"; matched by the exact time, which both runs compute alike and JSON keeps, "no frame".
- **`init` advertised what an older project couldn't do.** Running it again on a 0.2.0 project rewrites
  AGENTS.md but keeps the project's `render.ts`, and that copy ignored `--size` and rendered the video's
  own format under the same name. `init` now reads what the project's `render.ts` documents and leaves out
  what it lacks, with a line saying `--force` updates it (checked on a project given back 0.2.0's
  `render.ts`, then updated with `--force`), and `render.ts` stops on an option it doesn't know. Codex's
  second look at the fixes found that line promising `--force` keeps every video: it resets the
  example's files too (each kept as `.orig`), and the line now says so and asks for what was changed on
  purpose to be brought back from the `.orig` copies.
- **Delivery's second format kept the first format's paths.** Its sheets' explicit `--out` wins over
  `--size`, so following the steps would have replaced the 16:9 sheets. Delivery now names every path that
  moves, and `render.ts` warns when an `--out` given with `--size` lands outside that format's folder.

A second review on the PR found four more, each confirmed and fixed:

- **A word that moved could hide a change.** Each run hashed a word's frame at its current start, and only
  times both reports shared were compared, so a moved word's old and new samples were both left out. With
  the reviewer's case (a 1 s video, a frame white only while its one word is sung, the word moved by 0.1 s)
  the report said "no frame (4 compared)". The new run now also renders the earlier report's sample times,
  compares them and leaves them out of its own report: "1 of 5 sampled frames, in 0.117 s". A clean report
  now says "no sampled frame", and no text calls it exact: between samples, a short change can go unseen.
- **The later-session case couldn't pass on a 0.2.0 project:** the change report needs the new
  `render.ts`, and updating it broke the assertion that only `videos/` changes. Both now allow for it.
- **fixtures.ts** wrote the screens elsewhere when given a relative folder, since ffmpeg runs in the repo.
- **"Never a lookalike" overruled the director.** Asked for a concept screen of a feature that isn't
  built, the text sent the builder to a real screen, another way or a grey placeholder. A factual demo now
  shows the real screens by default; a concept, mockup or stylized screen the director asks for is made and
  marked as a concept where it could pass for the product; neither presents an invented feature, result or
  figure as the product's; SOURCES.md records each by where it came from. A new case,
  `cv-product-concept-mockup`, checks that exception.

### What 0.3.0 checked

Five cases in both tools on 2026-10-05 and 06, on `0bfc8cf` (Claude Code with Opus 5.5, Codex with GPT-6
Astra), each run graded by a fresh grader with its own measurements. Claude's second-format run was cut
off by a usage limit in its first turn and run again; a grader cut off the same way was run again.

| Case | Claude | Codex |
|---|---|---|
| cv-title-card | 6 of 12 | 7 of 12 |
| cv-zero-asset | 6 of 6 (1 N/A: no --without arm) | 6 of 6 (1 N/A) |
| cv-product-real-screens | 4 of 5 | 2 of 5 |
| cv-later-session-small-change | 7 of 7 | 6 of 7 |
| cv-second-format | 6 of 7 | 5 of 7 |

- **The first look worked in both tools.** Each full-cut critic wrote it before opening the treatment,
  and the fixes went to the stretch it called weakest: Codex's 5–15 s went from 9.93 to 4.97 s still at a
  glance; Claude's two rounds fixed a sunset that was "a small orange smudge" and an empty blue frame (47
  near-empty frames to 15). One Codex critic named a slide-like picture in its first look and then set it
  aside because "the user did not request a slide treatment", reading item 0's double negative backwards;
  item 0 now states the finding first and says that not asking for slides is why it is one.
- **The change report was used as meant.** Both later sessions ran verify before and after the note.
  Codex's named 1.5–2.0 and 3.0–5.0 s, and the grader's own old-and-new stills differ from 1.05 to 5.15 s
  and nowhere else. Claude's named 30 of 32 frames: its slower start moved everything after it, and the
  reply said so, with a link to each moved stretch and a 16 s version on offer that keeps the old hold.
- **Both second formats used `--size`,** recomposed the name into two lines behind one `H > W` branch in
  the scene, and left the 16:9 pixel-identical (34 and 35 stills against the starting commit). Codex's ran
  42 px into Reels' right margin, from margins it made up for a STYLE.md that had only 16:9; the second-
  format text now points to the style template's Layout tables. Claude's rendered the file in turn 1,
  reading "I also need this title card as a vertical video for Instagram Reels" as a request for it.
- **Product screens:** once turn 2 said the third screen wasn't designed, both showed only the two real
  ones. Claude's matched the files within a level and told the landing on a paper budget strip. Codex's
  home screen was 9.9 levels off its file, its white at 243: it turned the bloom off but didn't undo the
  tone shoulder, the step images.md gave as a GLSL function to paste. A post setting does it now,
  `{ bloom: 0, shoulder: 0 }` (white at 255, measured). Codex's brief didn't name the missing screen. Both
  first plans redrew the home screen's total for the new expense.
- **Found on the way, older than this release:**
  - Claude's sessions again showed the treatment and the preview link only at the end (the title card
    after 36 minutes, the sky video after 74), as in round 4.
  - Four runs rendered the file in turn 2. Since 0.2.0 a build ends offering the render, so the scripted
    "Go ahead" answers it; the two cases written for the older flow now accept that when the reply says so.
  - A session's synthesized score, a bun script in `videos/<video>/audio/`, broke `bun run check` for its
    project and every session after it: bun's types reached the browser program. The tsconfigs now keep
    such scripts with `scripts/`.
  - A critic left `mix.py measure`'s report at the top of `out/` (run without `--video`), and both
    title-card replies left out qc.py's numbers.
- Not run: `cv-product-concept-mockup`, `cv-range-loop`'s creative-range set, and the --without arms.

A third review by Codex, after those runs, found three more, each confirmed and fixed:

- **The change report's hash missed changes to green and blue.** Its two lanes multiplied each pixel's
  32-bit word in, and a multiply carries bits only upward, so a change to a word's high bytes (green, blue)
  stayed in a few top bits of the state and often cancelled out. Over a 1080p frame, changing the first n
  pixels hashed the same as the unchanged frame for 16 values of n on black (blue 0 to 128, the reviewer's
  case), 31 on white (blue 255 to 254, one level) and 63 on white (green 255 to 127); a lane alone, for up
  to 4,088. Each lane now rotates its state after the multiply, and no lane collided in twelve such cases
  (three backgrounds, four changes), 2 million values of n each. Verify takes as long as before (3.5 s on
  the example). Codex's second look at the fixes found that the new hash changes every digest, so a report
  written by the old one, the branch's own, would have shown every frame as changed. A report now records
  its `hashVersion`, and one hashed another way isn't compared, saying why: with a report from the
  previous `render.ts`, "not compared (another copy of render.ts hashed its frames another way)", then "no
  sampled frame (48 compared)" on the next run.
- **`shoulder: 0` undersampled bright motion.** The adaptive sampling's error estimate ran every frame
  through the full tone shoulder, which flattens the gaps between highlights, so on a frame with the
  shoulder off it measured about half the error the picture showed (2.35 levels for 0.875 against 1,
  where the shown gap is 4.85) and stopped below the tolerance of 3 too soon. It now applies as much of the
  shoulder as the frame's post does. A thin bar at 2.0 sweeping over grey 0.8, shoulder off: 36 sub-frames
  a frame before, 108 now. The example, shoulder off, samples as before (24 frames); with the shoulder on,
  the estimate is the old one.
- **`--size` without its value rendered the video's own format,** into its own folder, as `opt()` reads a
  missing value as an absent option. Any option but the six flags given without its value now stops the
  run, by name.

A fourth review by Codex (2026-10-06) found two more, each confirmed and fixed:

- **A shorter video showed no change.** verify compares the frames both runs sampled, so the time only one
  run has went unmentioned: the example cut from 17 s to 8 s with video.json's `duration` printed "no
  sampled frame (20 compared)", and only its last entry's moved end hinted at the 9 s that went. A change
  of length is now a line of its own, "length since then: 17.000 → 8.000 s (8.000–17.000 s removed, not
  compared)", and the frame line says "in the 0–8.000 s both runs have"; lengthened to 20 s, it names
  17.000–20.000 s as added. verify.json's `changes` records `duration: { was, now }`. With the length
  unchanged it prints as before.
- **`shoulder: 0` did nothing in an older project's engine.** init never replaces `src/engine/`, not even
  with `--force`, and 0.2.0's `PostParams` has no `shoulder`: returned from a `render()` without a declared
  type, the setting is ignored and the white stays at 243 (in a timeline entry, `bun run check` rejects it,
  checked with tsc). images.md now says how to tell (no `shoulder` in `post.ts`'s `PostParams`) and to
  undo the shoulder in the scene there, with the `unshoulder` function it already gave for a frame that
  needs its glow; the shoulder curve is the same in every release.
