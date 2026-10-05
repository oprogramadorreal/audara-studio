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
