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
- The showreel experiment: a named form keeps what defines it (0.4.0, 2026-10-06)
- 0.4.0 by hand: the preview link, and where the time goes (0.4.1, 2026-10-07)
- A place to choose the idea: video-ideas (0.5.0, 2026-10-08)
- Handing a project on: video-repo (0.6.0, 2026-10-11)
- One video or many in a project (0.6.1, 2026-10-11)
- Publishing it: youtube-package (0.7.0, 2026-10-12)
- Small fixes from three published videos (0.7.1, 2026-10-13)
- Sound for any video: a commercial made of AI clips (0.7.2, 2026-10-14)
- Photographic 3D from golden-temple (0.8.0, 2026-10-15)

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
  that native Windows doesn't give them, so `evals/harness/` runs the queries and the
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
- **Not run:** the stand-alone second wave of the short prompts on the final text (stopped when the test
  machine ran low on memory with four renders at once), real image generation and real ElevenLabs music with
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

## The showreel experiment: a named form keeps what defines it (0.4.0, 2026-10-06)

The user ran two short prompts word for word, each in Claude Code (Opus 5.5, xhigh) and in Codex (GPT-6
Astra, ultra), with and without the plugin (0.3.0): eight runs, each in a project folder of its own.

- "make a dynamic 15-second motion graphics video that shows what an incredible motion designer you are,
  like it's your showreel for a résumé. go all out"
- "make a dynamic 20-second motion graphics video that shows what an incredible motion designer you are,
  psychedelic and hypnotic. make it feel like a showreel piece. go all out."

They judged the runs without the plugin more impressive, in both tools; valued what the plugin gave (one
project structure, a preview to direct from); and found the plugin runs slow, and one of them saying
"every frame is a function of time". Two sessions analyzed the runs independently (the transcripts and
their subagents', the projects, contact sheets, qc.py on all eight MP4s, the previews played in Chrome)
and agreed on the causes:

- **The taste defaults worked against the genre the director named.** Every run without the plugin made a
  reel in chapters: labels naming each technique, timecodes, a new look per chapter, cuts on the beat.
  They even used the Avoid list's own archetypes as chapters (a dark ground with off-white type and one
  warm accent, an RGB split, neon titles), and won. Every plugin run made one film around a circle carried
  by match cuts (a ball, a lens, a chrome form, an aperture), after motion.md's "one persistent actor…
  unrelated reveals in a row read as a slideshow" and the storyboard's "what carries over" column; the
  hand-offs at the centre made most frames centred. Claude's prompt-2 style frames had a reel's labels and
  timecode; minutes after reading the Avoid list ("chrome nobody asked for: header and footer labels…"),
  its treatment said "no HUD or labels". Its critic removed an RGB split as "a glitch trope" and flagged
  "stock holographic colour" in a piece asked to be psychedelic, and its STYLE.md banned a rainbow.
  STYLE.md gave each piece one palette, and Codex's plugin runs moved in 4-second blocks where its prompt-1
  run without the plugin cut every bar. A critic's first look called the reel's range a risk: "it reads
  as a sampler of techniques rather than one idea that builds". For a showreel, a sampler is the brief.
- **The concept got almost no thought.** Without the plugin, Opus spent 118K and 88K output tokens
  thinking the whole piece through, concept and code, before writing a file. With it, the concept was
  fixed in the treatment after 2.2K and 3.5K (minutes 3 and 1.5), turned into briefs with coordinates, and
  built by scene subagents that couldn't change it: eight authors took 19–47 minutes each on 1.9-second
  scenes. Output tokens in all, subagents included: 596K against 155K (prompt 1), 375K against 153K.
- **Time:** Claude 116 and 96 minutes against 33 and 29; Codex 34 and 26 against 12.5 and 11.6. Claude's
  prompt-1 run spent 19 minutes on the brief, look and sound, 47 on its scene authors and 47 on two critic
  rounds and their fixes. The first round fixed real defects in all four runs (late hits, frozen and blank
  frames, an illegible sign-off, a broken burst, audio over its ceiling); the verification round found
  only polish in all four.
- **"Every frame is a function of time" came from the skill.** It was in Claude's prompt-2 treatment 88
  seconds in, when the only text the model had read that holds it was SKILL.md's Fixed rule; the example
  video copied into every project sings the same sentence, and its pen writes "f(t)", which the reel also
  showed. A prompt that asks the model to show what it is sends it looking for its identity, and the
  skill's rule was the nearest statement of one.
- **The Claude comparison was tilted.** Claude's plugin runs ended in the preview, as 0.2.0 asks: no
  motion blur, and on a first play in a fresh Chrome the preview froze 1.0 s at prompt 1's drop and 2.35 s
  where prompt 2's chrome world entered, while WebGL compiled their shaders (60 fps on a second play). The
  runs without the plugin were finals with motion blur (Codex's prompt-2 one excepted). Codex's plugin
  runs were finals too, rendered unasked against 0.2.0's rule, and still lost: the taste defaults are the
  main cause, not the presentation.
- **What the plugin did better:** the cleanest measurements of the eight (no clipping, no blank frame by
  accident; Claude's prompt-2 run without it peaked at +1.4 dBTP), more ambitious rendering (raymarched
  liquid metal, fluid ink, a Droste of live worlds) and a project a director can come back to, where each
  run without it invented a one-off setup.

The principle the changes follow: the plugin supplies what the model lacks (a preview to direct from, the
f(t) contract, sync from data, the project's memory, measured checks, a critic for defects) and stays out
of concept, taste and pacing unless the brief leaves a known weak spot. So they narrow and remove more
than they add:

- **A form or a style the director names counts as their words.** What defines it (a reel's chapters and
  labels, psychedelia's full spectrum and colour splitting, synthwave's grid and sun) is off the Avoid list
  for that piece, and never a critic's finding; the style template's "not from the genre" now reads "not
  from the subject", which is what it meant. SKILL.md's taste paragraph names it next to the song and the
  explainer.
- **A montage is a form of its own.** motion.md offers continuity (one persistent actor) or contrast (a
  montage, each chapter its own look, hard cuts on the beat), neither the default; the storyboard's column
  is "a cut, or what carries over"; a montage's STYLE.md keeps type and rhythm and lets each chapter take
  its own palette.
- **The lead works the whole piece out first, and a short piece gets one critic round.** The brief now
  starts "Work out the whole piece, then write the treatment". Up to about 30 s the build ends after the
  full-cut round and its fixes, which the render's own review checks (Delivery, step 2), so nothing renders
  unreviewed; past 30 s the verification round stays. Scene subagents stay as they were: a first version
  had the lead build a short piece alone, and its runs scored lower blind ("What 0.4.0 checked").
- **The skill's words stay off screen.** SKILL.md's f(t) rule says it is the code's, never a line in the
  video, and so do the treatment template and the AGENTS.md init writes; the example video's lyric is now
  "Lorem ipsum / dolor sit amet, / sed do." and its pen writes "fin.".
- **The preview compiles every scene before it plays.** `Engine.warm()` draws each timeline entry off
  screen at its start, middle and end while the page loads, with the progress on the info line. On copies
  of the two Claude projects with only that changed, in a fresh headless Chrome, twice each: ready after
  2.8–3.3 s (0.3–0.9 s before), and a first play at 60.0 fps with no frame over 25 ms, where it had stalled
  0.97–1.0 s and 2.0 s.
- **The evals:** `cv-showreel-resume` and `cv-showreel-psychedelic`, the two prompts word for word with a
  "Render it." turn, judged as a set with `--without` runs on finals; `task.ts --effort` runs a tool at the
  effort the user runs it (Codex had run at its config default, medium).

Considered and rejected:

- **Removing the Avoid list or the critic's taste check:** round 4 measured them lifting lyric videos and
  explainers above the model alone, where its own default is plain. They now keep to what nobody asked for.
- **Rewording the f(t) rule out of SKILL.md:** it names the contract verify checks and every reference
  cites. It is marked as the code's instead, and the example's words are placeholders.
- **Ending a short piece with its render:** 0.2.0 made a build end in the preview at this user's request.
  The preview's first play is now smooth, and the render stays one word away.
- **Warming a scene again after a hot reload:** without asynchronous compilation (three.js's
  `compileAsync` wants a scene graph the passes don't have) the stall can only move, and the `?t=` link
  each change comes with reloads the page, which warms every scene.

### What 0.4.0 checked

Headless runs on 2026-10-06 and 07 on one Windows 11 PC (an RTX 5070), Claude Code with Opus 5.5 at
xhigh and Codex with GPT-6 Astra at ultra (`task.ts --effort`), ElevenLabs mocked. Each run was graded by
a fresh grader with its own measurements. Three blind judges (Opus 5.5) scored
each set from contact sheets at 4 fps, full-size stills and the MP4s, under shuffled letters, with the
files' metadata stripped. The scores below are their "would impress" means, 1–10. Most runs in this
section were made on the release's first text, in which a piece up to about 30 s was built by the lead
alone.

- **On the showreel prompts the lead alone lost to 0.3.0, in both tools.** The 0.3.0 and no-plugin runs
  are the user's, with Claude's 0.3.0 projects rendered to finals for the comparison.

  | | Claude | Codex |
  |---|---|---|
  | Résumé reel, no plugin | 9.0 | 7.3 |
  | Résumé reel, 0.3.0 | 8.7 | 6.7 |
  | Résumé reel, 0.4.0's first text | 8.3 | 6.3 and 5.0 (two runs) |
  | Psychedelic reel, no plugin | 8.3 | 4.7 |
  | Psychedelic reel, 0.3.0 | 9.0 | 6.3 |
  | Psychedelic reel, 0.4.0's first text | 7.0 | 5.3 and 5.0 |

  One run per arm is noisy, and a gap of 0.3–0.4 is within it. Still, all four comparisons with 0.3.0 went
  the same way, and the psychedelic reel's Claude gap was 2 points with every judge agreeing. The judges'
  weakest moments were unfinished craft: a raymarch and a kaleidoscope gone "murky olive-teal", a dim end
  card, "a flared orange vase that looks unfinished". The psychedelic reel had half the frame-to-frame
  motion of 0.3.0's (one judge measured 11.2 against 23.3). Claude's lead wrote the résumé reel's seven
  chapters, a wall and an end card in 20 minutes, where 0.3.0's eight scene authors had worked 19–47
  minutes each. The psychedelic reel's six chapters took 17. Turn 1 got shorter (84.7 and 53.5 minutes
  against 116 and 96.5), and turn 2, the render's review and the render, took 28 and 31 more. Codex took
  about as long as before (23 and 32 minutes, 28 and 18, against 34 and 26). Scene subagents are back for every piece
  with many scenes, as in 0.3.0.
- **On the short single-idea prompts the lead alone kept the plugin's lift.**

  | | Claude with | Claude without | Codex with | Codex without |
  |---|---|---|---|---|
  | `cv-zero-asset` (sky) | 8.0 | 7.0 | 6.3 | 4.0 |
  | `cv-lyric-short` | 9.0 | 6.3 | 6.7 | 3.0 |

  Every judge put Claude's plugin video first in both sets, as in round 4 (sky 8 against 6.3, lyric 9
  against 7). Both tools passed every graded assertion on the sky video. On the lyric video, 42 of 44
  words were on time in Claude's, with two lit early by a hand correction of its own. Codex's had 47 of 47.
  Without the plugin, Claude's had 40 of 44 by a strict reading and Codex's 23 of 47, from Whisper's
  attention timings. The runs without the plugin took 5–19 minutes. The runs with it took 18–79 minutes in
  turn 1 and 17–28 more to render.
- **What the release is for held.**
  - Claude's showreels kept their chapter labels and timecodes (seven and six labelled chapters), and the
    psychedelic one its full spectrum and colour splitting. STYLE.md crossed both off the Avoid list for
    the piece. One critic still called a kaleidoscope's "purple and cyan neon on navy" an Avoid-list look,
    and the fix kept the kaleidoscope and moved it onto the full spectrum.
  - No run put the skill's words on screen: no f(t) line and no Lorem ipsum.
  - Claude ended every first turn in the preview.
  - The leads thought more before the treatment: 10.7K, 23.8K and 39.6K output tokens, against 2.2K and
    3.5K in 0.3.0.
- **The final text was only partly run.** Two Codex showreel runs on it each started two scene authors and
  one full-cut critic. Their turn 1 took 21 and 17 minutes, and they weren't judged. Claude's two re-runs
  each started seven scene authors, one per chapter, then were lost when the session ended. A second
  attempt was stopped at its style frames to finish the release. The interrupted lyric run's final was rendered from its
  finished project with its own command, and verify found no sampled frame changed.
- **Found and not changed:**
  - **Codex renders a showreel unasked.** It ran the full render in turn 1 in all six showreel runs
    ("A render is included to make the requested video directly usable"), against "make a video alone
    ends in the preview". It didn't on the sky or lyric prompts.
  - **verify's determinism probe fails on 1/255.** It failed now and then on a few hundred pixels at 1/255
    and passed on a rerun. It hit three of Claude's four runs here and 0.3.0's test-2 run. In the sky run it cost about 23 minutes: the chase found one real bug (a `pow()` of a negative base,
    NaN in a shader) and then merged two timeline entries to make the failure go away. A 1/255 difference
    on a few hundred pixels that a rerun doesn't repeat could count as a warning, not a failure.
  - **Critics missed sound and sync.** Five bells rang over the sky video's frozen last second and a half
    with nothing on screen. The lyric critic checked sync on four words and missed the two early ones.
  - **A lyric final came out at 374 MB** for 30 s (99 Mb/s at CRF 16).
  - **A Codex run without the plugin read this repo's AGENTS.md** from the folder above its work folder,
    with its own `Get-Content`. That AGENTS.md describes the plugin, not its skills.

A review by Codex on the PR found two more in the warm-up, each confirmed and fixed:

- **An updated project's player stopped before it started.** `init --force` replaces `src/main.ts` but never
  `src/engine/`, so a 0.3.0 project updated that way called `warm()` on an engine without it. In headless
  Chrome its preview threw "engine.warm is not a function" and never showed the player. The player now
  warms only an engine that has `warm()`, and a warm-up that throws only logs a warning, since it saves a
  stall and nothing more. The new player on a 0.3.0 engine started in 0.7 s. Codex's second look found
  that `bun run check` still failed on such a project (TS2339 on `warm`, TS7006 on its callback), so the
  check is typed as an optional method, and the player typechecks against both engines.
- **A short stateful entry played on from where warming left it.** `warm()` reset the engine's last time,
  not each scene's. A stateful entry shorter than the 0.25 s seek window then looked continuous when
  playback reached it, skipped its reset and played on from its end. In Codex's reproduction, a 1.0–1.2 s
  entry started at simulation step 48 instead of 1. Warming now resets every scene's last time too, and
  the same reproduction starts at step 1, as without warming. A showreel preview still loaded in 3.0 s and
  played its first time at 60.0 fps with no frame over 25 ms.

## 0.4.0 by hand: the preview link, and where the time goes (0.4.1, 2026-10-07)

After 0.4.0 merged, the user ran the two showreel prompts again by hand in Claude Code (Opus 5.5), one
folder each and at the same time on one PC, with no "Render it." turn: the check "What 0.4.0 checked"
left open. They found both pieces good and had two complaints: one session gave the preview link only at
the end, and both took long. Neither piece was rendered or judged blind. One Claude session read both
transcripts, their subagents' and the projects; a Codex review of that reading confirmed the timings and
the engine findings and sharpened some numbers below.

- **What the release is for held.** Both made reels in labelled chapters, each chapter a different craft:
  seven in the résumé reel, which again carried one dot through every cut as all four 0.3.0 runs did, and
  eight worlds in the psychedelic one, each born in the centre of the one before, with a recap under big
  chapter numbers. No scene holds the skill's words. Each ran one full-cut critic round, fixed what it
  found and ended in the preview with the render offered and those fixes listed as not yet reviewed.
  verify passed in both with no determinism failure. The leads thought 24.6K and 25.6K output tokens
  before writing the treatment.
- **The link came at minute 1 in one run and minute 19 in the other.** The psychedelic run posted the
  preview link a minute in and the treatment at minute 6. The résumé run posted neither until minute 19,
  when its first chapter played, and then only the treatment's path. Both got the same output from
  `render.ts preview`: the link, with nothing about passing it on. This is the third time it is recorded
  in Claude (round 4, then 0.3.0's title card and sky video), each time with the rule already in SKILL.md.
- **Time.** Turn 1 took 91 and 93 minutes (0.3.0: 116 and 96; the eval cases ask for under 60). Along the
  critical path:

  | | Résumé (15 s) | Psychedelic (20 s) |
  |---|---|---|
  | Brief, look, sound and timeline, until the scene authors start | 14 min | 13 min |
  | Scene authors, to the slowest one's report | 43 (5 authors, 25–42 each) | 47 (7 authors, 24–46 each) |
  | verify, a full-cut draft, qc.py | 4 | 3.5 |
  | The full-cut critic | 11 | 15 |
  | Its fixes, by the authors and the lead | 15 | 10 |
  | verify, a draft, qc.py, sheets, the hand-off | 3 | 4 |

  An author's time went into its stills loop: over its first build and its fixes, 58–184 model calls at
  14–25 s each (latency included), 22–101 stills and sheets looked at, against 3–11 minutes of waiting on
  tools. That says where the time went, not that every pass was needed: no run has compared a budget for
  that loop, and the model alone made reels in a third of the time that judges scored about as high
  (0.4.0's showreel table).
- **The drafts cost about 5 % of it.** The lead's full-cut drafts, with the qc.py runs chained to them,
  took 4.1 minutes (three, one forced by a mix rebuild) and 3.2 (two); each author's chapter clips 0.7–1.8,
  in parallel. Both critics worked from the draft: qc.py, a per-frame motion measure, 5 fps tiles, and a
  re-encode at a streaming bitrate. Dropping it would save minutes and take the critic's view of motion
  away. The bigger cost of a short
  piece is where 0.4.0 moved its second round: the render's review (Delivery, step 2), which "render it"
  starts in turn 2, though the director has watched those fixes in the preview by then. That round cost
  10–14 minutes and found only polish in four runs out of four (critique.md), and 0.4.0's first text took
  28 and 31 minutes in turn 2.
- **The critic earned its 25 minutes.** Its top findings became the reels' most visible fixes. The résumé
  reel's chrome and particles read as stock ("chrome blobs on a blue gradient, then a spiral galaxy"); they
  came back reflecting and recapping the reel's own earlier chapters. The psychedelic reel's "born in the
  centre" showed only at its two portals; the lead added a peek of the next world at every cut, and a
  murky fractal came back vivid.

What changed:

- `render.ts preview` asks the agent to post the link now, on the line before it (the link stays last, for
  a `| tail -1`), whether it started the server or found it running, as a new session does; the line says
  it's for the agent, since the director runs the preview too. `link` still prints the link alone, and
  init's last line says to post it. Whether Claude now posts it early isn't measured yet.
- `mix.py build` names a running preview when it can't replace a mix: on Windows the preview held
  `mix.wav`, the message blamed "a player or editor?", and the lead had to guess.

Found and not changed:

- **The HUD costs about 10 ms a frame when it changes every frame.** A reel's labels and timecodes, which
  0.4.0 keeps, redraw it every frame, and a full-frame Canvas2D upload takes most of the preview's
  16.7 ms (the résumé reel's particles author measured 10.5 ms with it, 1.2 without). Both leads
  rewrote the engine's overlay on their own: one uploads two fixed 160 px bands, which would clip a HUD
  drawn elsewhere; the other added an opt-in strip, and a frame of its title went from 10.9 to 3.9 ms. An
  opt-in bounded layer is the likelier upstream fix.
- **Grid times rounded to the millisecond land a frame late at some tempos.** At 144 BPM a beat is 25
  frames, and a downbeat at 6.6667 s is written 6.667, after its frame, so its cut and its beat fire a
  frame later (bars 2, 5, 8 and 11 of 12). Codex reproduced it with the template's AudioData at 60 fps:
  90 BPM late on the same bars, 180 BPM on bars 3, 6, 9 and 12. Two scene authors reported it; the lead
  snapped the timeline's cuts to frames and read beats 1 ms ahead in `frameFor`, which misses a scene that
  calls `audio.beatAt` itself. Snapping grid times within about 1 ms of a frame removes these cases, but a
  general fix needs the video's own fps, keeps the audio's offsets, and tells a generated grid's rounding
  from measured or authored times (sections and cues cut too); it wants its own change.
- **The render's review of a short piece.** Letting the director's "render it", after watching the fixes
  in the preview, stand for that review would save that round in turn 2 (an estimate: nothing measured the
  time or the quality without it). It trades a check for time, and the showreel cases assert the review,
  so it waits for a decision.

## A place to choose the idea: video-ideas (0.5.0, 2026-10-08)

The user asked for a skill that helps people who aren't prompt writers start well: triggered by a request
for video prompt ideas, informed by the prompts published on Skillry and Prompt Motion, and with a workflow
to settle (rewrite the prompt and start code-video, or hand the user a prompt to paste into another
session). They named the gap themselves: code-video fills in what a prompt leaves open, but goes on into
production; what's missing is a space to explore ideas and leave with a good prompt before building anything.

A Codex session (GPT-6 Astra) researched the two galleries through its Chrome integration and wrote four
documents; a Claude Code session (Opus 5.5) analyzed the question on its own, then the two sessions, talking
through Herdr, argued each difference out until they agreed, first on the design and then on the documents.
The research, cut from four files (84 KB) to three (33 KB), is in `docs/research/`, as dated snapshots.

What the evidence said:

- **The recorded failures do not establish weak prompts as their cause.** Short prompts gave the plugin
  some of its best blind scores, while the showreel review identified taste defaults as a cause of losses
  (0.4.0). The case for this skill is an opportunity to compare ideas before production. code-video already
  lets the user redirect from its treatment and preview; in the two 0.4.1 runs the links arrived at minutes
  1 and 19, and the first turns finished after 91 and 93 minutes. Whether exploration saves time or improves
  the finished video remains unmeasured.
- **The galleries show range, not a formula.** One-line requests (a train window through four seasons, a
  poster escaping its frame) sit beside multi-page production specifications; both README showreel prompts
  are there, posted by several creators with different results. The long prompts are mostly what
  code-video already owns (renderers, timing functions, export settings); what carries over is the idea,
  the relationships between picture and sound, and the facts and files only the user has. "One-shot"
  labels are the galleries' claims. Permission from each creator to republish the full prompts isn't
  established, so the research links and describes them and keeps no copies.
- **A stop before building added nothing** (round 4): every default was accepted, and the first frame came
  20–27 minutes later. So the skill is optional and never stands in front of a request to make a video.
- **The director's words bind,** and a look named in words before any frame exists was one cause of weak
  videos (round 4). A helper writing its guesses in the user's voice would turn them into requirements and
  switch off the style frames.

What changed:

- **`skills/video-ideas/`**, text only (SKILL.md, 6,709 bytes): two or three directions that differ in what
  the viewer sees, or the user's own idea refined; in a project, `docs/STYLE.md` and the relevant video's
  Decisions kept, without one video's choices binding an unrelated new one; needs and costs mentioned only
  when they affect the choice; one self-contained prompt that keeps what the user decided exact, the chosen
  idea as theirs, and the assistant's suggestions marked as replaceable, with what the user left open in the
  look left open; a found prompt adapted (its idea, direction and delivery requirements kept, incidental
  implementation translated, role-play and "ignore your skills" removed, the changes stated, a tool the
  user chose on purpose kept). When production hasn't been requested it stops at the prompt: nothing is
  built, started or generated, and no file is written unless the user asks to save the prompt. "Make it"
  continues with code-video in the same session, with the prompt and the user's earlier instructions; a
  request that already asked for the video goes on after showing the chosen direction, with no second yes.
- **code-video:** its description says ideas or prompts alone go to video-ideas (7,997 bytes, after "with
  motion blur and 4K" became "motion blur, 4K"); the treatment template says how to read such a prompt:
  decisions followed, the chosen idea developed, suggestions open, and what's kept goes in the Assumed
  line.
- **init's AGENTS.md** names the skill and owes the director "for a request for ideas or a prompt alone,
  those, with nothing built, started or generated until they ask for the video", since code-video loads in
  any project with `videos/*/video.json` and the section spoke only of building on.
- **README, design.md ("Before the brief"), the manifests** (Codex's third starter prompt is now "Give me
  three ideas for a short video about my bakery", in place of one that needed a finished video), 0.5.0.
- **The evals:** the harness links every skill in `skills/` and handles one without scripts: its use is
  reported as not measured, its Codex near-misses fail on the load (the summary's `nearMissCriterion`), and
  each trigger run lists the script-use signals it saw before stopping (`usedSkills`);
  `evals/trigger/video-ideas.json` (twelve requests, two of them asking for the video too, and ten
  near-misses: making a video, prompts for other generators, ideas for filmed content, general advice); two
  ideas-only near-misses at the end of code-video's set; nine `vi-` task cases, graded on the conversation.

Considered and rejected:

- **Documenting code-video's "plan first" instead:** the lightest route and the bar to beat, but it serves
  only users who know to say it, and it plans one video rather than comparing ideas.
- **A mode inside code-video:** its trigger and checklist pull toward production, and its SKILL.md had 31
  bytes to spare.
- **An interview inside production** (the product-film skill on Prompt Motion works that way): the stop
  before building that round 4 removed.
- **Always rewriting and building at once,** or **always a new session:** the first breaks the stopping
  point an ideas request asks for, the second adds work and loses context; both are offered, neither forced.
- **A reference of example prompts loaded with the skill:** examples anchor looks and motifs (design.md,
  "Room for the model"); the research's examples stay outside the skill.

A review by Codex of the implementation, before it was committed, found seven things, each taken:

- **Every video's Decisions** were to be kept, so an old title card's silence or length could bind an
  unrelated new video; now the shared style and the relevant video's.
- **Adapting a found prompt** dropped its frame size, rate, spring motion and finish as another tool's
  settings, and the case rewarded that; they can describe the result, so they stay, and only the
  implementation is translated.
- **A choice made after "make the one I pick"** would have stopped at the prompt, and "make it" could lose
  an earlier "and the MP4"; both now follow the user's earlier instructions.
- **The look** read as if one typeface settled it, and **real screens** as needed by any product, though a
  lamp or a brand film has none.
- **The trigger report** gave a skill without scripts a use rate of 0% rather than "not measured".
- **Composite requests had no trigger queries, and improving a prompt and making the video had no task
  case;** both are now covered (the new case first required 1080x1920 although the user supplied only
  vertical framing).
- **The history and design overstated what the runs established** about weak prompts and the time before
  comparing premises; they now distinguish preview links at minutes 1 and 19 from completed turns at 91 and
  93, and leave the benefit unmeasured.

What was checked: the three validators pass on all three skills, each SKILL.md is under 8,000 bytes with no
byte-order mark, `init.ts` writes the new AGENTS.md lines into a fresh project, the harness files parse, a
trigger run with no queries writes `nearMissCriterion: "load"` and "used on near-misses not measured" for
video-ideas, and `bun evals/tasks/cases.ts` writes the nine new cases without changing the others.
**Not run:** the trigger
sets and the `vi-` cases. The skill was built before the baseline the proposal asked for, at the user's
request; that baseline (the model brainstorming alone, code-video asked to plan only, and the skill, on
casual and explicit requests) is still what decides whether it earns its place. If it can't beat the
plan-first route without more friction or routing mistakes, the documented route replaces it.

## Handing a project on: video-repo (0.6.0, 2026-10-11)

The user ends many projects with the same request, typed by hand each time: create a local git repository
(the remote comes later) with every file someone else needs to clone the project and work on it; required
images, music, sounds and videos versioned unless a file is over GitHub's limit, in which case it stays out
and a versioned doc says it's missing; no output files, which go in `.gitignore`; no API key, secret or other
personal information, checked before anything is added; and a README expanded for people, with docs for
agents in `docs/`. They asked whether that should be a skill, what else it should hold, and whether it
should load on its own like the other three or only when called (`disable-model-invocation` in Claude Code;
they weren't sure Codex had an equivalent). A Claude Code session (Opus 5.5) and a Codex session (GPT-6
Astra), talking through Herdr, argued it out over four rounds; the user gave Claude the last call.

What the evidence said:

- **The request had been made once already,** by a Codex session on `videos/oprog-1` (2026-10-10, now
  published as ai-video-proxima-palavra). It did much well: media ignored by default with an exception for
  each input the render needs, generated and paid assets kept as files, a `docs/ASSETS.md` of what was kept
  and left out (a root `song.mp3` that was a byte-identical duplicate, intermediate mixes, rejected takes)
  measured against GitHub's 50 and 100 MiB limits, the scratch scripts that made kept assets archived, a
  README for people, and a fresh-clone check (frozen install, type check, a full `verify` of 2,687 frames, a
  half-second draft with audio).
- **The user still had to ask four times afterwards:** for a key scan of the files and the history
  ("just make sure there is no api key or key of any sort exposed in the versioned files"), for the
  published title the README had guessed, for the working folder name `oprog-1` to go from `package.json`,
  `bun.lock`, AGENTS.md's heading and `docs/STYLE.md` ("rename it to ai-video-proxima-palavra, which is
  current repo name"), and for the repository's size.
- **The published repository still leaks the user's Windows account name:** `TREATMENT.md` lines 151–152
  name plugin-cache paths under `C:\Users\<name>`, and the key scan didn't flag them. Every commit also
  carries the user's work e-mail. Its ignore rule `/out/` (the top folder only) let the mix-round records a
  script wrote to `videos/proxima-palavra/intro/out/` into the first commit; init's own `.gitignore` merge
  counted `/out/` as covering `out/`, so running init again wouldn't have added the broader rule.
- **Other projects show what a clone lacks:** `oprog-3` has a script that loads image models by absolute
  paths under the home folder, nested `.venv/` folders, another tool's render output (`tools/manim/media/`)
  and `.playwright-mcp/` logs.
- **Invocation:** Claude Code's `disable-model-invocation: true` takes the description out of context, so
  a plain "put this in git" gets the model's own way; Codex's equivalent is
  `policy.allow_implicit_invocation: false` in `agents/openai.yaml`. Both `quick_validate.py` scripts reject
  `disable-model-invocation` in the frontmatter. Anthropic's docs advise manual invocation for side-effect
  workflows such as `/commit` and `/deploy`, which Codex raised against "only local effects" as an answer.

What changed:

- **`skills/video-repo/`** (SKILL.md, 7,991 bytes; `references/repository-files.md`; `scripts/audit.ts`),
  model-invoked like the others: the request itself is in words, loading the skill only supplies the method,
  the request authorizes the changes, and nothing leaves the machine until the user asks. Scoped to audara
  projects, the only kind seen. Where the repository goes (fresh, this folder, or a folder above, which waits
  for the user); files sorted by role (a generated file the render loads is an input; outputs ignored by
  folder or name at any depth, with no blanket media rule; duplicates, intermediates and rejected takes left
  out and named); a file over 100 MiB left out and documented (path, bytes, SHA-256, purpose, how to get it
  back, whether a clone renders without it), Git LFS offered, never set up; keys and personal details checked
  before the first `git add`; a README for people from init's, `docs/REPOSITORY.md` and a Repository section
  in AGENTS.md outside init's markers; the commit identity checked before the first commit, asked once when
  the user wants personal details out, with the repository's name in the same message when the folder's is a
  working name; a fresh clone checked (`bun install --frozen-lockfile`, `bun run check`, `verify` per video, a
  three-second draft with sound); a hand-off with sizes, what's left out, what's theirs to decide, and how to
  push, done only when asked.
- **`scripts/audit.ts`**, written by the Codex session: read-only and dependency-free. It finds copies of
  secret-named environment and `.env` values (the user's keys live there), known key formats, key files,
  home paths, e-mail addresses, files over GitHub's limits and duplicates;
  `--staged` reads the index, `--history` every reachable blob; it masks secrets and lists what it doesn't
  cover. On `oprog-1 --history` it runs in about 3.5 seconds and flags `TREATMENT.md:151–152`.
- **init:** its `.gitignore` merge no longer counts `/out/` as `out/`; its AGENTS.md names video-repo and
  owes "for a request to put the project in git or get it ready for GitHub, that repository, with the
  videos left as they are".
- **README, design.md ("Handing it on: a repository", "Format, for both tools"), AGENTS.md, the manifests,**
  0.6.0.
- **The evals:** `evals/trigger/video-repo.json` (eleven requests, the user's own among them and two in
  Portuguese, and ten near-misses: everyday commits, a branch, a pull request, a render, ideas, git outside
  video projects); cv-23, a git request in code-video's set; trigger fixtures placed in subfolders with
  `=>`, and an AGENTS.md fixture written by init itself; task.ts's `"git": false` (no setup repository, git
  kept from finding this one above `evals/results/`) and `"plant"` (`evals/harness/plant.ts`: what the
  projects above held); `vr-first-repo` (the user's prompt, then a name and a noreply address),
  `vr-existing-history` (a key in an earlier commit, a change left staged) and `vr-empty-first` (the
  repository before the video, then the video, then the full pass).

Considered and rejected:

- **Explicit-only invocation:** the user would have to remember `/audara-studio:video-repo` or
  `$audara-studio:video-repo` for a request they already make in words, and both validators reject the
  Claude Code key.
- **A reference inside code-video:** a git request wouldn't find it, and its SKILL.md has 3 bytes to spare.
  Its description isn't changed either: no run has shown it loading for a git request yet; cv-23 measures
  that, and init's AGENTS.md routes the request meanwhile. Codex argued for an exclusion in code-video's
  description now; the evidence rule decided it.
- **A general "media project into git" skill:** only audara-studio projects have been seen.
- **A media allowlist by default** (oprog-1's): it hides the next required file from the session that adds
  it; one a project already has on purpose is kept.
- **Installing a secret scanner:** gitleaks is suggested when it's already installed.
- **Stopping to ask at the start:** nothing is published until the user pushes, so the skill goes on with
  defaults and asks only what changes the commit (its identity, when the user wants personal details out,
  and then the name with it) or where the repository goes.

Codex's reviews changed the design in these ways, each taken: `git ls-files -o` alone misses tracked and
staged files, so the audit reads the working set, the index and the history separately; an existing
repository is a path of its own (branches, remotes, history and LFS kept, a file now ignored untracked with
`git rm --cached`, a >100 MiB blob in the history named as a push blocker); "output" is defined by role, not
type; someone's staged work stays staged (`git commit -- <paths>`), and since such a commit adds back a
file untracked with `git rm --cached`, the skill asks first when it must do both; the identity is settled before the first
commit, not after; a clone-check failure is diagnosed rather than taken for a missing file; the branch is
the current one, not always main; every `.env` value of 8 characters or more was a literal at first, so
`NODE_ENV=production` would have blocked every file saying "production" (now only secret-named ones); a git
warning (Codex's sandbox can't read the global ignore file) made every run "incomplete" (now a note); the
password in a URL like `https://user:<password>@host` came out unmasked in the audit's list of e-mail
addresses (now left out of it and masked); and an eval exception let a commit go in before the identity
question the skill asks.

What was checked: the three validators pass on all four skills, each SKILL.md is under 8,000 bytes
(video-repo's 7,991) with no byte-order mark, and every changed script and harness file compiles.
`evals/tests/test_audit.ts` (16 checks, Codex's) passes. On a project made by init and planted with
`repo-traps`, the audit found the copied token, the hardcoded key, the 110 MiB take, the duplicated logo and
the home path in half a second; with `history-secret`, the key in the earlier commit. init adds `out/` to a
`.gitignore` that says `/out/`. Without the new environment, git run in a folder below `evals/results/`
finds this repo; with it, none, and the skill links stay out of `git status`. A trigger smoke run (Claude
Code, Opus 5.5, one run each) loaded video-repo for "put this video project in git so I can push it to
GitHub later" and left "commit my changes to the intro scene with a good message" alone. **Not run:** the
full trigger sets (cv-23 included) and the two `vr-` cases, an hour or more per case and tool. They, with
`--without` runs as the bar (the model alone did oprog-1), decide whether the skill earns its place.

After the pull request opened, the user asked how the skill behaves when it comes first, in an empty
folder, and whether it then picks up the files the other skills make; asked that the product be called
audara-studio, not audara; that the skill be as simple as it can be without limiting the model; and that the
clone it tests be deleted. Both sessions audited the skill with their skill-creator (Anthropic's plugin,
Codex's built-in) and reviewed the branch for Claude Code and Codex. What they found:

- **A repository set up before init mostly survives it:** init merges its entries into an existing
  `.gitignore` and appends its section to an existing AGENTS.md, but writes its README, the one with the
  commands to watch and render, only where there's none. In a test (an empty folder, a repository with a
  README, then init) the project lost init's README.
- **Nothing picks up files later on its own:** neither git nor the other skills commit unless asked, so new
  files sit untracked under the ignore rules until the user commits or asks for the repository again.
- **Nothing in the skill or the audit is specific to either tool.** Codex's default sandbox allows the
  system's temporary folder but blocks the network the clone's `bun install` needs. Current Claude Code can
  read AGENTS.md directly, though init's `CLAUDE.md` importer stays for older versions and other settings;
  the trigger fixtures lacked it.
- **The skill carried git recipes a frontier model already knows,** and the audit carried a parser for
  location data in photos and clips (about 130 lines) that no project had needed.

What changed: a "No video project yet" path (the repository, a `.gitignore` with init's entries so keys are
covered from the first file, a `.gitattributes`, AGENTS.md with its Repository section and a CLAUDE.md
importing it; no README and no commit unless asked; the full pass when asked again); the git recipes turned
into the outcomes they protect (someone's work kept, a file untracked but kept on disk, the identity settled
first); the clone in a new folder in the system's temporary folder (inside the project, Node would resolve a
missing package from the project's own `node_modules`), deleted whether it passed or failed and checked
gone, with no preview, since `verify` and `video` start and stop their own server, and a blocked network or
folder asked for or reported; the audit at 550 lines, location data left to a tool at hand; audara-studio
in the skill's prose and the audit's banner; init's `CLAUDE.md` in the trigger fixtures; `vr-22`, a request
in an empty folder, and `vr-empty-first`, the repository, then the video, then the full pass, in three
sessions. Checked: the three validators, SKILL.md at 7,991 bytes, the audit's 16 checks, a planted
project, and one trigger run of `vr-22` (Claude Code, Opus 5.5: loaded); not run, as above: the full
trigger sets and the `vr-` cases.

A code review of the whole branch by a third Codex session found three ways the audit could still leak or
miss a key, each reproduced before fixing: a detected npm token that also named a file was printed in full
in the file listings (now every detected value, a generic `api_key` value included, is masked wherever it
shows); an `.npmrc` committed, renamed to `backup.txt` and deleted passed `--history` (a blob keeps its
`.npmrc` name across renames, as it did for `.env`); and `PRIVATE_TOKEN=value#note` in a nested `.env` was
learned with its comment, so a copy of the value went unseen (an unquoted value now ends at `#`, as dotenv
and Bun read it; Bun loads only the top-level `.env` into the environment, which hid the case there). Three
regression tests, each failing on the previous script, bring the audit's checks to 19; the reviewing session
agreed with the fixes.

Its next pass found three more, each reproduced: an `.npmrc` credential in quotes (`_authToken="..."`, as
npm reads it) went unseen, now also `_password`; a key file (`.p12`, `.pem`, `.key`, `id_rsa`...) committed,
renamed and deleted passed `--history`, so the history scan now recovers every credential file's name, not
only `.env` and `.npmrc`; and init's `/out/` change had a side effect: with `/.env.*` then `!.env.example`,
init appended `.env.*` after the exception and ignored `.env.example`, so init now puts its entries before
a project's first exception. Its review of those fixes caught a regression in them: they kept one recovered
name per blob, so an `.npmrc` renamed `backup.key` lost its npm scan and could print a token in full; each
historical blob now keeps every credential name it had. The audit has 22 checks and
`evals/tests/test_init_gitignore.ts` three, each new one failing on the script before its fix; the session
agreed with the result.

A third pass found two more, both reproduced: `.env` values were read one way, while Bun, Node's dotenv and
python-dotenv each read quotes and escapes their own way (Bun strips backticks, for one), so a copy of the
value as a tool loaded it went unseen; and `--staged` from a subfolder read the whole index but learned
`.env` values only under that subfolder. Each value is now learned in every reading (the raw text, Bun's,
Node dotenv's, python-dotenv's: a copy is found as a substring, so an extra reading costs nothing), from
`.env` files anywhere in the repository; a value built from `${OTHER}` references is not expanded, a limit
the audit states. The review of that fix caught one more regression (Node dotenv's sequential reading of
`"\n"` lost), fixed with its test. The audit has 25 checks; the session agreed.

A fourth pass found that npm reads a double-quoted `.npmrc` value as JSON (`\u0066` is `f`), while the audit
masked only the text as written, so the decoded token, when it also named a file, was printed in full
(reproduced with npm's own `ini` parser). Its JSON reading is masked too now, and an empty value never
enters the masking. The audit has 26 checks; the session agreed.

## One video or many in a project (0.6.1, 2026-10-11)

The user had made five projects, one per video or close to it (`videos/audaces-1`, `oprog-1` to `oprog-4`, the
last four for their YouTube channel), and asked whether audara-studio would work as a studio: one git
repository for a channel, with a shared core (the engine, some assets) and what's specific to each video. Then
a constraint: separate repositories and one big one must both work, and if the big one complicated the plugin
too much, they would rather drop it, since the skills must stay light while models change fast. A Claude Code
session (Opus 5.5) and a Codex session (GPT-6 Astra) each analyzed the plugin and the five projects, then
argued it out over three rounds through Herdr; the user gave Claude the last call.

What already worked: several videos per project was a decision from the start. init's `--video` adds one, the
preview finds them and offers a picker, `?v=` and `--video` pick one, each renders into `out/<video>/`, and
AGENTS.md lists them. A separate repository is a project with one video (and the example), on the same code.

What the five projects showed:

- **Their engines were the template's,** byte for byte outside `src/look.ts` once line endings are set aside
  (audaces-1 and oprog-2 exactly), but for features a project added: oprog-1 a replay (`TimelineEntry.shift`
  and `window`) and shadow maps; oprog-3 a `clock.ts`, LaTeX fonts in `type.ts` and `render.ts --param`;
  oprog-4 scanlines and a glitch in the post, a timeline's `postAt`, and shadow maps, the same code oprog-1
  wrote.
- **Projects copied from each other:** oprog-4 took oprog-1's CRT scene, its plastic texture and
  `tileable.py`; audaces-1's vertical cut of video 3 is a copy (11 of its 15 scene files identical), so the
  director's note "include Audaces name together with the logo" was made twice.
- **Two projects gave a second video a look of its own, and both kept the first intact:** oprog-3 added v2's
  keys beside v1's in `src/look.ts` and set `V2_POST` on every v2 entry; audaces-1 kept video 2's palette in
  its scenes (`_story.ts`, "so the first video's `src/look.ts` is untouched").
- **A font one video registers loads for all of them** (`type.ts` registers `'../videos/<video>/assets/...'`
  and `loadFonts` loads every face at boot), so deleting it stops every video.
- **Disk:** `out/` reached 34 GB in oprog-3 (one draft of 516 MB in oprog-4); a channel repository's media
  would pass GitHub's recommended 10 GB for `.git` within a few dozen episodes (oprog-1's pack is 233 MiB).

Proposed, and left out on the evidence: a look per video in the engine (`videos/<video>/look.ts` merged over
`src/look.ts`: both projects that needed one managed without it, and engine code never reaches an existing
project, so skill text would grow "if your engine has it" branches, as `warm()` did in 0.4.1); `verify --all`
and a baseline system (an agent can run verify per video); loading a video's fonts only for that video (it
breaks a video that plays another's scene, which the engine guide documents); an engine upgrade path with a
recorded template version (a separate long-lived repository has the same need: a feature of its own);
channel-wide sound defaults and separate checklists for a first video, a new one and a revision (decisions
already go to `docs/STYLE.md`, and SKILL.md has no room); publication tags (the user's git habit); video-repo
leaving out a duplicate another video loads (the clone check catches it); and a sentence in init's AGENTS.md
to verify every video a shared change reaches (below). Codex's own first list had the look layer,
`verify --all` with baselines, `assets/` and `src/shared/` with a change to the preview, the upgrade path and
the sound defaults; its second round agreed none rested on a failure that had happened, and found the font
dependency, the boundary below and the soundtrack catch.

The AGENTS.md sentence was the one point left open, so it was measured. oprog-3's first video was last
verified on 10-08 at 21:26; after that only shared files changed, for v2 (`src/look.ts`, `type.ts`, four
fonts), and nobody verified v1 again. On scratch copies, verify `--since` the old reports said every sampled
frame changed, for v1 (1,000 of 1,000) and for a control, an audaces-1 video whose code hadn't changed since
its verify on 10-07 (57 of 57), so those reports couldn't tell a change from anything else. render.ts puts
such a result down to the browser or the GPU when nothing shared changed, which fits the control but wasn't
established. Compared with frames of the drafts each
project rendered right after those verifies, fresh stills matched: mean colour within one or two levels at
10, 60, 120 and 200 s, and identical by eye side by side at 120 s. PSNR was 20.7–34.5 dB against the
control's 36.3–40.3, most likely v1's full-frame TV static, which a draft's encoding can't keep, though the
comparison doesn't isolate that cause. So no regression attributable to the shared edits at the sampled
times: the sentence waits for an eval or a real regression. Codex added that "outside the video's folder"
was the wrong boundary for it, since oprog-1's thumbnail video imports helpers from inside the main video's.

What changed:

- **`references/contract.md`, "Changing the engine":** verify runs on every video in the project, not "the
  whole video": every scene of every video runs on the engine. In a separate repository that adds the example
  after an engine change, a few seconds.
- **`references/engine-guide-template.md`** (each project's `docs/ENGINE.md`, so new projects only): the
  layout gains `videos/_shared/`, optional, made when needed, for what several videos use (`scenes/`,
  `assets/` with `SOURCES.md`), with no `video.json`, so it isn't a video; soundtrack scripts given its files
  take `--video`, since they infer the video from an input's path (Codex's catch: `video_of()`, copied in five
  scripts). And "Every video loads every registered font, so a missing file stops them all" replaces "A file
  that is missing stops the page". Neither needs code. On a scratch project made by init, a scene in
  `videos/_shared/scenes/` played through `E('card', '../../_shared/scenes/fspass', ...)`: `bun run check` and
  verify passed, saving it hot-swapped the entry in a running preview ("reloaded card", the page not
  reloaded), saving a file in `videos/_shared/assets/` reloaded the page, and init's AGENTS.md table listed
  only the videos.
- **design.md:** a repository per video and one per channel are the same model; `videos/_shared/` in the
  layout.
- **The eval `cv-second-video-own-look`:** on the title-card project, a later session asks for "a 10-second
  end card for Night Signals' YouTube episodes, with a completely different look from the title card: warm
  paper and hand-drawn ink"; the title card's frames must come out unchanged. Its plant,
  `first-video-baseline`, verifies the title card twice before the session (the second `--since` the first,
  which says whether the comparison repeats on that machine and day, since the reports from other days above
  couldn't be compared), beside `work/` where the session doesn't look, with a copy of the project as it was
  (git-ignored inputs included); at the end the grader verifies it `--since` that report (every baseline
  sample compared, none changed, same length and timeline) and, on a mismatch, the copy again before blaming
  the session. It gates a style-template clause, "a video that departs from the project's look keeps it in its
  own files", added only if a run fails for that reason. On a scratch project the plant's two runs matched (8
  frames compared, 0 changed). Codex's review of the branch caught that the grader's fallback first rebuilt
  the baseline from the setup commit, which lacks git-ignored inputs, that `plant.ts`'s command line ran only
  `before` hooks (and, once fixed, ran both without the commit `history-secret` needs between them), and these
  two claims stated as established; each fixed.
- **The manifests,** 0.6.1.

The eval ran once per tool on the plugin as this branch has it (no style clause), from a `cv-title-card` run
of the branch (Claude Code, Opus 5.5: a dark sea at night with one red beacon, no paper or ink), with Claude
Code (Opus 5.5) and Codex (GPT-6 Astra, xhigh). Both pass every graded assertion:

- The baseline repeated: the plant's second verify matched its first (32 of 32 frames) in both runs.
- The title card is unchanged: verified `--since` the baseline at the end, 32 of 32 frames compared, none
  changed, the same length and timeline, in both.
- Each end card is a video of its own (Claude Code's `ns-end-card`, in 50 minutes; Codex's
  `night-signals-end-card`, in 14), passes verify at 10.00 s, and is warm paper and drawn ink on its stills.
- Each reply links its own preview (`?v=<end card>`, on the port serving its work folder), and only drafts
  were rendered.

Neither touched `src/look.ts`. Claude Code kept the end card's palette in its scenes (`_ink.ts`); Codex
gave the video a `look.ts` and a `STYLE.md` of its own, with its post on the timeline's entries. Both scoped
`docs/STYLE.md` to the title card and recorded the departure in the director's words, and both verified the
title card themselves without being asked. So the style-template clause isn't added, and the AGENTS.md
sentence stays out: on this evidence a model keeps a second video's look local and checks the first video
on its own. One run per tool, so this is a first measurement, not a rate.

## Publishing it: youtube-package (0.7.0, 2026-10-12)

The user ends video after video with the same request, typed by hand: "Help me create a youtube thumbnail for
this video. I want a png. 1280x720 pixels. In the thumbnail, I want the text "…" (for your knowledge, the
title will be "…"). In the background, use some of the high quality scenes of the actual video, or create
something new and impressive. Work hard to create the most impressive thumbnail options you can... give me 3
options. And by impressive I also mean effective. That attracts clicks." They asked for a skill that makes
three thumbnail options with any art at hand ("the skill must go all out"), one title designed with them to
win the click and keep the viewer, a description that helps search, and tags, as files in the project; words
they give are a start to keep or improve, and with none given the skill proposes everything. A Claude Code
session (Opus 5.5) built it and had the last call; a Codex session (GPT-6 Astra) analyzed it with its
skill-creator over five rounds through Herdr and ran the script in its own environment (through Node's child
processes: its default shell couldn't start a process on this machine, so the default shell sandbox itself
wasn't tested).

What the evidence said, from the user's four channel projects (`oprog-1` to `oprog-4`) and the sessions that
packaged them, read by nine research agents (the transcripts, the files, YouTube's help pages, data studies):

- **Too little, then too much.** On oprog-4 the first round (10 minutes) skipped the channel: the user had to
  name their thumbnail font ("I did not like the font... use the same font that I used for this other video of
  my channel"), then ask to "work harder". The round that followed took 9 h 44 min, 61 agent runs and about
  1.55M output tokens, six of those hours on an option that lost; it banned generated images "(they cost
  money)" as the director's rule, though the director had approved them for that film, and painted
  photographic eyes by hand instead. oprog-3's session showed the user nothing for over four hours, against
  their standing rule to bring findings and wait, and hit the account's limit twice.
- **What paid.** A five-minute scan of 65 real thumbnails from nine searches changed a whole set's type size
  (30% to 40-60% of the height), brightness (the set at 0.19-0.23 against the niche's 0.34) and colour (orange
  read as "Claude tutorial"); the feed mock with real neighbours showed what a sheet of sizes had passed as
  readable; one audit after the final polish caught real streaks between letters; three distinct hooks.
- **The video's own world wins.** oprog-1's first round (generated look-alike plates, rainbow confetti and music
  notes in a video with neither, stacked template type, a pasted face) was rejected in six minutes ("I'd like a
  cleaner aspect"); the thumbnail YouTube serves is the video's own computer and a modelled mascot, rendered in
  its engine in nine minutes. The user's own candidate re-staged the video's real computer with their face, made
  in ChatGPT: generation is welcome when it re-stages what the video has. Rules that count elements were wrong
  (the user's own design had a face, a computer, a line of text and ten labels); hierarchy decides.
- **The idea beats the pipeline.** oprog-3's quick first thumbnail (about 20 s of tool time) already held the
  idea that won its long round; locking the given words at 20% cap height with wide gutters made all sixteen
  mockups the same text wall and shrank the subject, so craft scores rose while the pull to click fell.
- **The pair, as the user writes it.** The thumbnail asks, the title answers, never with the same words
  ("FOMOS NÓS" became "EM EXTINÇÃO" because the title said "nós"); "Claude" early; spoken Brazilian Portuguese;
  31 to 53 characters; current, not "outdated"; clickable by the user's gut. They iterate titles over days and
  once chose the final title after the thumbnail, to point at it ("Claude respondeu essa pergunta com um clipe").
- **The words.** Descriptions shipped at 1,100-1,700 characters (a 4,570 one was cut by its lyrics); chapters
  computed from `words.json` and the render's length held, chapters recalled from memory were luck; no session
  ever wrote the tags to a file (the user typed eight short lowercase ones); three projects kept the description
  in three places, one under the ignored `out/`.
- **YouTube now** (its help pages, 2026-10-12): 3840x2160 thumbnails recommended, 1280x720 still the floor of a
  full-quality Test & Compare, 2 MB from the app and 50 MB from a computer; Test & Compare takes three titles,
  thumbnails or pairs and picks by watch time; AI help with a thumbnail or title needs no disclosure, but AI
  music that is a video's focus does; YouTube's terms forbid scraping its pages, which two sessions had done.

What changed:

- **`skills/youtube-package/`**, model-invoked like the others: SKILL.md (Fixed: an honest pair, money waits
  for a yes, rights, the user's words; the bar; a session of nine steps whose exploration happens once: the
  video, the channel, about six rough ideas and 10-20 titles shown to the user early, art, finishing, looking as
  viewers do with one fresh critic, the words, the check, the hand-off; fixing what the check or the critic
  finds is finishing, not a new round), `references/art.md`
  and `references/youtube.md`, and `scripts/youtube.ts` (shoot, preview, niche, check; Bun and Chrome over the
  DevTools protocol, no dependencies). The package goes in `videos/<video>/youtube/`; previews in `out/`.
- **init's AGENTS.md** names the skill, owes "for a request for a thumbnail or to get a video ready for YouTube,
  three thumbnail options made with one title, then the description and tags, and for one of those alone (a
  title, a description, tags), that part, in `videos/<video>/youtube/`, with the video left as it is", and
  scopes its last check to "Before calling a change to a video done"; its decisions line gives a YouTube
  package's decisions their own place, `youtube/NOTES.md`.
- **video-repo** keeps a video's `youtube/` package (SKILL.md 7,996 bytes) and reads its `title.txt` as a
  proposal, not the published title.
- **README, AGENTS.md, design.md** ("Publishing it: the YouTube package"), the manifests, 0.7.0.
- **The evals:** `evals/trigger/youtube-package.json` (12 requests, the user's own and three in Portuguese among
  them, and 11 near-misses: a title card, a poster frame, ideas, git, cover art, chapter titles inside the
  video, an app's thumbnail grid, a plain image, an upload script, a Shorts cut, a question), cv-24 and vi-23
  near-misses, trigger.ts's use signal for `youtube.ts`, and four task cases on `EVAL_PACKAGE_PROJECT`:
  `yp-given-words` (the user's prompt word for word, then the channel's type in a new session),
  `yp-nothing-given`, `yp-title-only` and `yp-images-budget` (the image mock); `trigger.ts` takes `--effort`.

Considered and rejected:

- **A mode inside code-video:** its SKILL.md has 3 bytes left, and its checklist pulls toward building the video.
- **A compositor or a layout template:** it would set one look for every channel. Codex first argued against
  any compositor; it agreed in round two that a camera (any page the model writes, rendered at an exact size and
  measured) institutionalizes no layout, since the preview needs the same browser anyway.
- **Scraping YouTube's search** (oprog-3 and oprog-4 each wrote one): YouTube's terms forbid it and its pages
  change. `niche` reads links through oEmbed and searches only through the Data API with the user's key.
- **A fixed count of drafts, judges and lenses** (oprog-3's sixteen mockups and four weighted lenses): about six
  rough ideas and one critic, with no CTR guesses or averaged scores; a salience score once pulled a design
  toward the cliché its brief ruled out.
- **Exports split from sources** (Codex's first proposal: the PNGs and text copies in `out/`): one folder for
  what the user uploads, since copies drift and a rebuild isn't guaranteed to match; Codex agreed.
- **Three titles, a 4K deliverable by default, an SRT, global channel memory:** the user asked for one title (the
  runners-up go in NOTES.md); 1280x720 is their ask (`shoot --scale 3` makes 4K from the same page); captions
  are offered, not made; `docs/CHANNEL.md` stays in the project, with no scanning of sibling folders.

Measured and fixed along the way:

- **YouTube's sizes, measured** on youtube.com (2026-10-12, logged out, windows 1280 to 1920 px wide and a
  390 px phone): the home grid now shows three across (344 px at 1366, 528 at 1920), search 500, the up-next
  column about 215 to 325 (168 only in the classic layout), the playlist panel 100; the duration badge covers up
  to about 20% by 23% of the image. The preview had been written for 360, 246 and 168 px and a guessed quarter
  corner; it now uses the measured sizes, and the search result cuts the description at about 130 characters as
  YouTube does. Pointing at a thumbnail plays the video in its place, so the opening is part of the package.
- **The image tools, tested:** rembg's command printed only an install hint without its `cli` extra, and its
  default model needs a paid licence for commercial use (now `birefnet-general`, MIT); Pillow on Windows set
  "AV" and "To" without the font's kerning, which Chrome applies, so words stay in the page.
- **A purge before any push:** a research agent's browser tool wrote `.playwright-mcp/` logs (signed YouTube
  links carrying an IP address) into the repo root, and a broad `git add` swept them into a commit; the branch
  was rewritten without them and the folder is ignored.

What was checked:

- **Triggering.** Claude Code (Opus 5.5), three runs each: 22 of 23 pass, the skill loaded on 94% of the
  packaging requests and on none of the near-misses; the miss, yp-10 ("render the final video, then make the
  thumbnail..."), loaded code-video first and ran out of turns once in three. Codex (GPT-6 Astra): 23 of 23,
  loaded on every packaging request, and once in 33 near-miss runs (yp-15, ideas with a title, beside
  video-ideas, using none of its scripts). cv-24 and vi-23 (a packaging request as code-video's and
  video-ideas' near-miss) passed three of three on Claude, so neither description changed.
- **The task, yp-given-words, on Claude** with the user's own prompt and the project their packaging session
  started from: with the skill, 25 minutes, then 5 for the channel's type in a new session: three different
  bets (the mask's lit eyes, the CRT in the sunny room, the two figures at the candle with a speech bubble), the
  title used exactly, a description with chapters, tags, `docs/CHANNEL.md`, a niche of ten real Brazilian
  videos through oEmbed, previews and the check passing; the video and engine untouched. Without it, 32 and 14
  minutes: three strong thumbnails from the same scenes, no description or tags, the files in the ignored
  `out/`, and the engine's `post.ts` and the project's docs changed to render the type. Both met the criteria
  of the case that apply to pictures; the with-skill run met all nine, the package ones included.
- **A blind panel on the two sets:** six judges (a viewer from the audience, a packaging strategist, an art
  director, each in both orders), shown each set's images and the same feed mock with the same ten real videos
  beside them. Every judge chose whichever set came second, so the vote measured position, not the sets; the
  scores are counterbalanced (each set came first for three judges). Out of 10, with the skill against without:
  variety 7.8 against 5.8 (two of the other set's three were the mask, all three dark), honesty 8.0 against 7.1
  (it gave a faceless figure a red eye and the CRT's mask burning eyes), legibility small 7.3 against 6.6, click
  pull 6.8 against 7.1, craft 7.0 against 7.2, the fit with the title 8.1 against 8.2, each set's mean rank 3.5.
  The pictures are on a par; what the skill adds is the package, its variety and honesty, the time, and a video
  left as it was.
- **yp-title-only on Claude:** 101 seconds: one title and three runners-up with their lengths and reasons, in
  `title.txt` and `NOTES.md`, nothing drawn, the video unchanged. It left "Claude" out as bait, reading the
  treatment's rule against showing a real product's interface as a rule against naming it; youtube.md now says
  a name the video is about belongs early. The with-skill run of the user's prompt had named the disclosure by
  its old name ("altered or synthetic content"); youtube.md gives today's, "AI use".
- **yp-given-words on Codex** (GPT-6 Astra at the user's own effort, ultra), four times, each run checking the
  fix the one before it led to; each took 10 to 12 minutes, then 4 to 8 for the channel's type, spawned a
  critic without the thread, generated nothing, and made three options from the video's own plates (the mask,
  the candle table, the eye in which a computer shows). The first made the thumbnails and the title only: its
  notes said "Escopo: miniaturas; descrição, capítulos e tags não solicitados". With SKILL.md saying the
  package comes even when only the pictures are named, the second made all of it, but appended its notes to
  the treatment's Decisions, as init's AGENTS.md asks for every director's note; init's line now gives a
  package's decisions `youtube/NOTES.md`, and SKILL.md calls the treatment the video's. The third, in a
  project still carrying the old AGENTS.md as the user's projects do, left the treatment alone; its reply and
  notes still left out Test & Compare and the disclosure, and it kept six roughs, an index page and a ZIP in
  the package folder. The fourth kept the roughs in `out/` and opened `NOTES.md` with its pick and the
  disclosure as the user's to decide; its replies stayed a few lines long, which looks like Codex's own way
  with a final answer, so the open decisions live in the notes as well.
- **What the checks cost.** Every trigger and task run inherited the user's own reasoning effort (Claude
  Code's xhigh, Codex's ultra), and the blind panel ran as sub-agents of a session at max effort, about 537,000
  tokens. The user can afford Codex runs, not Claude Code ones at that effort: after them, only Codex ran
  tasks, grading moved to scripts, and `trigger.ts` takes `--effort` as `task.ts` does, so a first check of a
  description runs at `--effort low --runs 1`.
- **Codex's five rounds** found, among others, the length of the video read from the audio before
  `video.json`'s duration, a mistyped folder checked as the one above it, JPEGs passing a PNG package, "0:99"
  read as a time, two pages writing one image, a cut unicode handle, and claims in the docs; the fifth confirmed
  the six fixes and three small notes, fixed. A sixth, of the branch against main, reproduced three more: with
  Chrome unable to start, three PNGs cut off before their size passed `check --full` (a warning each), a
  broken image set as a CSS background passed `shoot` (only `<img>` was decoded), and a package folder given
  beside `--video` lost the video's length, so a last chapter of 5 s passed (the project was taken from above
  the folder). Since a header without a size now fails, the JPEG reader steps over fill bytes and markers
  without a length, which it had misread. The CSS fix at first failed a valid `mask-image: url(#cut)`, which
  names an SVG mask in the page, not an image file; two more rounds made it skip such references, the page's
  own name with `#cut` too, and the last found nothing. A review of the pushed branch found two more: the scan
  read images nothing draws (on an element without a box, or a `::before` without content, which doesn't
  exist), so a missing one failed a page whose PNG was right, and it now skips them; and `<video>-thumbs`
  does become the default beside `example`, which any other video outranks, so art.md says to name the
  example there. The next found the scan still fetching what Chrome didn't draw (an `image-set()` candidate it
  didn't pick, a `::before` set to `display:none`): a file CSS names is now decoded only when Chrome requested
  it for the page. The first try read the page's resource timing, which lists a request only once it ends:
  Codex caught a corrupt background set on load and served late passing, so the requests come from the
  DevTools events instead, every URL kept (a redirect's request takes the next URL, and Codex caught one to a
  corrupt image passing too), and decoding waits for one still loading. The next review found what the box
  check still hid: a `display:contents` element has none, yet its `::before` draws, and a broken image there
  passed. An image now counts where something is drawn, such a `::before` included; a file there also needs
  Chrome's request (dropping that check for files let a file fetched for a hidden element fail where nothing
  drew it, which Codex caught), and an inline `data:` image, which Chrome reports only once it loads (never a
  broken one), counts outside an `image-set()`, of whose candidates Chrome draws one without saying which (a
  valid inline 1x with a broken 2x had failed a right page). `evals/tests/test_youtube.ts`: 45
  offline checks pass, seven added in these reviews; all but one (whole headers passing without Chrome, a
  guard on the stricter rule) fail on the script before their fix; `tsc --strict` passes; the three spec
  validators pass; SKILL.md is 7,969 bytes.

Not run: `yp-nothing-given` and `yp-images-budget`, cv-24 and vi-23 on Codex, and anything that spends (image
generation waits for the user's yes).

**One option in a format from the niche (2026-10-13).** The user asked that at least one of the three options
"look for successful videos of similar content and copy its style, if possible", a successful video being one
"that has much more views that would be expected for its channel size". The evidence was their own oprog-3
sessions. The first (2026-10-12) made sixteen mockups and three options from the video's own ideas. Its niche
scan already held 3Blue1Brown's guest video by Welch Labs, "But how do AI images and videos actually work?"
(iv-5mZ_9CPY), but only as a neighbour in the feed mock. The second (2026-10-13) made six dust variants the user
directed. Then, at the user's word, it made one "very similar to" that video's thumbnail. It downloaded the
picture to look at, and rebuilt its layout in a one-second Pillow script: the question in one line on top, a
yellow arrow pointing right over four tall panels from noise to his portrait, a blue one pointing left under
them. Everything in it came from the video's own portrait frames and the channel's Archivo. A next ask graded
the middle panels to the reference's olive and blue. From the first ask to that file (`setas-cores.png`) took
seven minutes, and the user preferred it to every other option of both sessions.

By the user's own measure the reference wasn't an outlier. It had 2,158,820 views in the feed mock, against
3Blue1Brown's roughly 8.5 million subscribers and 762 million views over 241 videos (third-party trackers,
2026): 0.25 times its subscribers and 0.68 times the channel's average per video. vidIQ's outlier score
starts at 2x (its help page, checked 2026-10-13). It was the subject's big video, and its layout was the
mechanism the video explains, which the video's own frames could show. So the skill asks for fit first and
numbers second.

What changed:

- **SKILL.md:** a niche step before the ideas. Videos on the subject a viewer would see beside this one, and
  those that far outran their channel's views; one option takes the format of the one that best fits the video,
  never its pixels or brand, rebuilt from the video's own material; none fits, say so. The bar's three bets
  name it, and the commands table no longer calls `niche` optional. SKILL.md is 7,996 bytes: two gotchas and
  `shoot`'s serving line, all in art.md already, left it.
- **art.md:** a section, "The niche, and a format that worked": finding the videos, what counts as having
  worked, fit before numbers (the oprog-3 case), what the option takes and what it never takes, notes in
  `NOTES.md`, and what to do when nothing fits. The niche paragraph moved there from "Looking as viewers do", and
  the film-poster line now says why a niche format differs: it borrows a way of showing, not a work's identity.
- **youtube.md:** Test & Compare notes what the format option tests; the sources add the channels resource and
  vidIQ's help page.
- **`youtube.ts niche`:** with a key, one more Data API call (the channels resource, 1 unit per 50 channels)
  gives each video's views as a multiple of its channel's lifetime average per video and of its subscribers
  (hidden counts left out), plus its date, listed highest first and kept in `niche.json`. The API's own picture
  link is tried first. `YOUTUBE_API_URL` takes another base (a proxy, the tests).
- **The evals:** two offline checks against a local stand-in for the Data API; `yp-given-words` and
  `yp-nothing-given` gain the format option's criterion; README and design.md say it.

Considered and left out: a fixed threshold that rules a video in or out (the user's preferred reference would
have failed it), and the median of each channel's recent uploads as the baseline (closer to vidIQ's "similar
timeframe", but two calls per channel and skewed by Shorts).

Codex (GPT-6 Astra, through Herdr) reviewed the branch read-only over three rounds and reproduced three bugs,
each fixed:

- **Earlier links got no numbers.** A video already in `niche.json` was skipped, so links gathered without a key
  never gained them on a run with one; the format option needs them. A video already there now takes the run's
  reading (an old comparison dropped) and keeps its picture.
- **`0:100` read as `0:10`.** The chapter stamp's pattern took a prefix and put the rest in the name, so
  `0:00`, `0:100`, `0:200` passed `check --duration 40` as 0, 10 and 20 s.
- **`0:10:0` read as `0:10`.** The first fix still let the stamp shrink before a colon. The stamp is now the
  whole digit-and-colon token, a stamp only when a part after a colon has two digits, so a `16:9` or `1:1` that
  opens a line stays out (a plain whole-token match would have failed such lines).

The third round found nothing.

What was checked: `bun evals/tests/test_youtube.ts` 51/51 (three of the four added in review fail on the script
before their fix; the fourth guards the stamps that are times), `tsc --strict` on the script and the test, the three spec validators, SKILL.md 7,996 bytes without a
byte-order mark. Not run: a task eval with the change, and `niche` against the real Data API (no key on this
machine; a local stand-in served the same JSON shapes).

## Small fixes from three published videos (0.7.1, 2026-10-13)

The user published two videos made with audara-studio on their channel (oprog-1, "Claude respondeu essa
pergunta com um clipe"; oprog-4, "A resposta do Claude é assustadora") and finished a third (oprog-3, "Do Ruído
à Imagem", scheduled). They were happy with all three and asked for a look at whether the plugin behaved as
expected, and for small improvements only, nothing that risks what works. A Claude Code session (Opus 5.5)
read the sessions through Herdr: the three main ones (0.5.0, whose code-video, soundtrack and video-ideas
SKILL.md are byte for byte today's), oprog-3's final render and thumbnail sessions (0.6.1), its description
and tags (0.7.0, the first youtube-package run on a real project) and a disk audit. Four subagents read the
transcripts whole, with the tool results, against the current repo.

What worked, to keep: video-ideas stopped at the prompt; treatments came before scenes, style frames were
picked by looking, Decisions kept the director's words and the budgets' running totals; verify passed at every
step and `--since` showed what each change touched; critic rounds found real problems (oprog-4's stillness
went from 65% to 17%); costs were printed before every spend; the plugin's own scripts rarely failed (most
errors in the transcripts were in code the agents wrote). youtube-package's first real run took 6 minutes and
cost nothing: description and tags only, as asked, chapters from the timing data checked against the final
cut, `docs/CHANNEL.md` started, the "AI use" setting flagged.

What the evidence said:

- **Renders on the integrated GPU.** In oprog-3's final-render session the NVIDIA GPU sat at 0% while Chrome
  drew on the Intel one: 1.1 fps against 3.7, a heavy stretch 0.2 against 2.4. The agent patched the project's
  render.ts to read `CHROME_FLAGS` and rendered with `--force_high_performance_gpu` (56 min). The same
  project's ~18 full drafts and 23 verifies had all run on the Intel GPU. youtube-package's art.md already told
  agents to set `CHROME_FLAGS`, which the template's render.ts never read. Chrome's choice varies: on the same
  machine on 2026-10-13 it took the NVIDIA GPU unprompted, in a scratch project made with init, where verify of
  the example passed with 0 mismatches on both GPUs, in 3.9 s on the discrete one and 6.5 s on the integrated.
- **Effects muted by the mix.** In oprog-1, about 200 of 476 effects came out at -60 dB ("paper-slap 50 of 92,
  stamp-soft 54 of 79"): a `target_db` of 0 or less asks the solver for no lift, so it stops at its least
  gain, with no warning and against its own docstring ("never a muted effect"). Reproduced on the example with
  0.7.0's mix.py. Finding and working around it took most of an afternoon.
- **Keys pasted in the chat.** The user gave keys in the chat in all three projects ("I want you to use exactly
  these keys. I'll invalidate them right after"; "ok you already have the api keys here in your context"),
  where elevenlabs.md said to ask them to set the key in their environment and start the session again, a rule
  no entry here explains. The sessions improvised three ways: a file in the session's temporary folder, loaded
  per command and deleted (oprog-1); `SetEnvironmentVariable` for the user, which put both keys on a command
  line and kept them after the session (oprog-4); the key inline on 7 commands (oprog-3). No key reached a
  project file (checked in all three projects and in oprog-3's 84 subagent transcripts).
- **`verify --only` replaced the whole video's report.** oprog-4's scene author ran it and overwrote the lead's
  `verify.json` ("overwrote my full-video report, but I'd kept a copy"); in oprog-3 authors did the same and
  the lead added `--out` to every brief. `video` already names a partial render `-only-<ids>`.
- **Two renders lost to memory.** oprog-1's final render died at 86% (37 minutes in) and an oprog-4 draft did
  too: each session ended its turn with the render in the background, and Claude Code stopped it when memory
  ran low while the session was idle. The rule was there; its reason didn't name this case.
- **Disk.** oprog-3's `out/` reached 41 GB (36 GB for v2: 19 kept drafts of about 1 GB, 25 frame folders, the
  critic rounds) beside a 1.7 GB final; the user had to ask a separate session what was safe to delete
  ("consumed a lot of my disk space with temp stuff"). critique.md said `out/` "costs nothing". That session
  did it well: about 120 GB in groups (A to F), each with its size and why it was safe, the user to pick by
  letter; the finals, the thumbnail options awaiting a pick and the reports `verify` compares with kept; the
  only render of a video with no final (oprog-3's v1, oprog-2) left to the user; a search showing no code read
  what it would delete; a wait while another session wrote in the project; 14.8 GB found in a finished
  thumbnail session's temporary folder, out of any project. It also offered every project's `.audara-cache/`
  but `preview.log`, after searching only oprog-3's code: oprog-1's `.audara-cache/tools/` holds the scripts
  that make its `mix.json` (`sfx_collect.ts`, `make_mix2.py`) and textures (`tileable.py`), named as such in
  the project's files. Copies were in its git repository (`docs/production-tools/`, from video-repo); a
  project without one would have lost them.
- **On screen.** oprog-3 showed "Modelo com LoRA do diretor" and the user's real name from their training
  captions until they asked: "I do not want to display my real name ([name]) anywhere... do not mention 'o
  diretor'". About 25 honesty captions piled up round by round ("too overwhelming... remove them all").
- **Smaller ones.** The treatment message went out without the preview link (the director asked for it 11
  minutes after init and got it 34 minutes later). oprog-3's preview showed "no default export" for three scenes
  whose helpers five authors were saving at once, cured by restarting it; renders and verify, each on a fresh
  server, never showed it. `bun run check` failed for an audio script importing the timeline
  (`import.meta.glob`); oprog-4 added `vite/client` to the scripts' types, and its check passes with it. Two
  cached layers were keyed on a rounded value but drawn with the exact one (a verify failure, then a faint
  ghost). `eleven.py sfx --pick` was run without its prompt. v4 voice lessons: tags on the say map's spoken
  side, a take that doesn't come back when asked for again, about 13.8 characters a second for a slow,
  dramatic Portuguese read (measured on oprog-4's words.json). youtube-package read the channel's titles with
  yt-dlp and got YouTube's English translations ("Claude's response is terrifying"), while `niche`'s oEmbed
  returned the Portuguese titles under any language header; `check` gave a description's bytes only past
  5,000, so the agent measured them by hand; the description took as its model a 4,570-character draft oprog-1
  cut before upload.

What changed:

- **render.ts (template):** Chrome starts with `--force_high_performance_gpu` (no effect with one GPU;
  `CHROME_FLAGS=--force_low_power_gpu` takes the integrated one, checked), and `CHROME_FLAGS` adds flags.
  `verify --only` writes `verify-only-<ids>.json` (`-preview` added with `--as-preview`), so `verify.json`
  stays the whole video's; checked in a scratch project: the partial reports compare with each other, the
  whole one with itself. Both reach new projects (and `init --force`); existing ones keep their render.ts.
- **tsconfig.scripts.json:** `vite/client` beside `bun` in the scripts' types.
- **mix.py:** a `target_db` of 0 or less stops the build, saying what it means and the fix (a small lift, or
  `gain_db`); the help says the lift is above 0. Plans that worked are unchanged: every `target_db` in the
  five projects' current plans is 0.5 or more.
- **eleven.py:** `sfx --pick` without a prompt, or with other settings, says that it takes the run's prompt and
  settings, as that run printed them.
- **youtube.ts check:** the description's ok line gives its bytes beside its characters when they differ.
- **elevenlabs.md and images.md:** a key pasted in the chat and wanted now lives for the session only, in a
  file in the session's temporary folder, loaded into each command's environment and deleted at the end, and
  is never set in the user's system for them; the suggestion to set it in their environment stays, said once.
  Also the v4 row, tags on the say map's spoken side, keeping the take the director heard, and the dramatic
  read's pace.
- **critique.md:** the critic's truth question asks for a label once, where a viewer would take a picture for
  fact (sources can go in the description); delivery step 3 names the memory case; delivery's reply offers to
  free the disk as that session did, in groups with sizes and reasons (drafts, frame folders and critic
  rounds, `.audara-cache/` scratch, a large session temporary folder), never the deliveries, their reports,
  sheets and poster, the only render of a video with no final, pictures awaiting a pick, `preview.log`,
  `uv/`, or anything the project names as a source (each path searched for first), and only after a yes,
  with nothing running in the project; `out/` "costs little", with the 36 GB case.
- **treatment-template.md:** the treatment's message carries the preview link; "Never claim" labels once;
  on-screen words never include the skill's "director", and a real name, family or place from the user's
  files appears only when they say so; scene authors' verify runs write to their own folder (`--out`), since a
  project's older render.ts writes even `--only` to `verify.json`.
- **engine-guide-template.md, contract.md, art.md, youtube.md:** the GPU and `CHROME_FLAGS`, verify's report
  names, restarting a stale preview; a rounded cache key drawn rounded; art.md's `CHROME_FLAGS` advice dropped
  (render.ts does it now); a published title from `niche` (oEmbed) or the Data API, never yt-dlp; "SEO" asks
  for the searched words, not length; earlier descriptions are the published ones.
- **SKILL.md, two words each:** code-video's keys stay "never in projects, logs or command lines" and
  soundtrack's "never in the project, a log or a command line", so the session's temporary file the references
  describe isn't against them; code-video's "a question tool that answers at once" became "answering at once"
  to stay at 7,997 bytes (soundtrack 7,996).
- **design.md, 0.7.1.**

Considered and left out: effects levelled against voice and music together (oprog-1's critic found intro
effects 22-29 dB under them, but every narrated mix would change level); a report of the closest
voice-over-music gap (the director heard a swell at 9 s that the mean hid: worth doing, but new code); a
library search in `eleven.py voices`; `beats.py window --at` for a song after a spoken intro; shadow maps,
`render.ts --param` and the projects' other engine additions (as in 0.6.1); smaller drafts (it would change
the grain the critics judge); collapsing Direct3D's repeated shader warnings in render.ts's browser log; more
sound effects by default (one director's taste).

What was checked: in the scratch project, `bun run check`, `gpu` with and without the flags, and the verify
runs above; mix.py on the example with `target_db` 0 and -3 (both refused) and 0.5 (gain -0.6 dB), and
0.7.0's mix.py on 0 (-60 dB); `eleven.py sfx --pick 2`; `youtube.ts check` on oprog-3's package ("3956
characters, 4128 bytes"); `bun evals/tests/test_youtube.ts` 51/51, `test_audit.ts` 26/26,
`test_init_gitignore.ts` 3/3, `test_imagegen.py` OK; the three spec validators on code-video, soundtrack and
youtube-package. Not run: a task eval with the changes, and the GPU flag on a machine with one GPU or in a
Codex sandbox.

Codex (GPT-6 Astra, through Herdr) reviewed the branch read-only and found two things, both fixed: the scene
authors' brief told them to use `verify --only`, which only a render.ts from 0.7.1 on keeps out of
`verify.json`, so authors on an existing project would still overwrite the lead's report (they now always pass
`--out`); and the SKILL.md rules still said keys go in no file, against the references' session-only file.
The second round found nothing.

## Sound for any video: a commercial made of AI clips (0.7.2, 2026-10-14)

The user ran a long prompt for a 60-second commercial (Neolevel, a program for young entrepreneurs in
Florianópolis) in a fresh folder with 0.7.1 installed. It left the tools open ("The choice of tools is up to
you. Go all out. You can use motion graphics, AI video generation, 3D graphics, or whatever else"), gave keys
for OpenAI images, ElevenLabs and Higgsfield's video models, and didn't name audara. They half expected
code-video to load; no audara skill did, and they asked whether that was the right call or whether the skills
should stretch to cases like it. A Claude Code session (Opus 5.5) read the project and the session's
transcript through Herdr, and Codex (GPT-6 Astra) went over the same evidence before seeing its conclusions;
they agreed. What the film took is in `docs/research/ai-video-commercial-neolevel.md`.

What the evidence said:

- **code-video: rightly left out of the picture.** The film is a photoreal young man in real places, from
  OpenAI keyframes and 22 Higgsfield image-to-video jobs (15 clips in the cut, $14.32 of a $20 budget),
  composited in Python and ffmpeg. The description excludes AI video clips and camera footage; code doesn't
  draw a photoreal person; the footage path holds every frame in GPU memory, for seconds of footage (59 s at
  1080p would be about 11.7 GB); and the engine renders opaque H.264 only, while the captions and logo had to
  go over the clips (the session drew them with skia-python as ProRes 4444, asking its subagent for
  code-video's own rules: every frame a function of `t`, seeded randomness, sub-frame motion blur). It read
  only the first 6,000 bytes of code-video's SKILL.md, which stop before the body's "AI video clips only when
  the director asks". The director had asked, so the body allowed what the description excluded.
- **soundtrack: a miss.** Narration in the user's cloned voice, two music cues, effects and the mix are what
  its description names, and its production scripts take `--out <dir>` outside an audara project. The
  session found the plugin's folder, read `eleven.py`, `mix.py` and `elevenlabs.md`, ran `eleven.py music
  plan` and `music compose` for the score, and wrote its own voice, effects and mix tools (621 lines) without
  loading the skill. They kept their requests and measured loudness; the music plan's terms for a company's
  ad came up only at handoff, after the score was in the cut, where the skill says before relying on it.
- **Why, unknown.** The thinking was redacted. A reading the descriptions invite: ruling out code-video
  ruled out the plugin, and soundtrack's own text read as code-video's companion ("the timing data the
  picture syncs to", "as the code-video engine reads them"), with "Not for ... voice cloning" beside a
  request that named a cloned voice. Fresh sessions don't bear it out. An adaptation of the prompt (st-25:
  keys, links and brand swapped, a short text script in place of the PDF, no brand research or Codex
  consultant), on Opus 5.5 at the user's xhigh in `claude -p`, loaded soundtrack within six turns in 8 of 10
  runs on 0.7.1's own descriptions. The original session had Ultracode on, with its workflow reference
  loaded before the prompt, and launched a research workflow first; it read the plugin's files three minutes
  in and wrote its own voice tool fifty minutes in. The trigger harness reproduces none of that.

What changed:

- **soundtrack's description:** "Use it whenever a video or animation, made with code, filmed or
  AI-generated, needs ..."; "Not for ... making a voice clone" (narrating in one the user has is in scope).
  Its opening says audio and timing data, "or with `--out <dir>` for a video made elsewhere", in place of "as
  the code-video engine reads them" (7,989 bytes).
- **code-video's description:** "Not for editing camera footage or generating AI video clips (soundtrack does
  their sound), or ideas or prompts alone (video-ideas)", so ruling out the picture points to what still
  applies. The body's line is now "AI clips only as footage the director asks for." Paid back with "A video's
  parts: idea,", "and style-template.md", "doesn't suit it" and "a video or animation" (7,996 bytes).
- **Trigger cases:** st-21 (an ad shot with AI video, a cloned voice, music and the mix, tools left open),
  st-22 (a voice clone the user already has, beside st-16), st-23 (the picture made in another tool; also
  cv-25, a code-video near-miss), st-24 (the AI shots alone, a near-miss), st-25 (the adapted prompt).
- **The eval harness:** an installed audara-studio is turned off for each trigger and task run, in both
  tools, so each skill is there once, with the description under test; until now a machine with the plugin
  installed offered two copies of each skill (st-25's runs loaded `audara-studio:code-video` from the 0.7.1
  cache beside the linked copy). Claude Code's `--plugin` mode keeps it; a task case's copied project
  settings are read too. `HIGGSFIELD_*` variables leave the environment
  as the OpenAI and ElevenLabs keys do, since st-25 names a Higgsfield key and a budget.
- **design.md** ("With any picture", the near-misses, the overview), **README**, **evals/README.md**, and the
  snapshot in `docs/research/`.

Considered and left out:

- **code-video stretched to such films:** its engine holds seconds of footage, renders no alpha and draws no
  photoreal people; a film of AI clips is a compositor's job, and generated clips stay out unless asked
  (round 4).
- **An alpha export** (ProRes 4444 or PNG frames), so code-video could make a film's titles and logo: the
  engine drops alpha in the renderer, the post pass and the encode, and this one project used overlays.
- **A skill for films made of AI clips:** one project's evidence, paid evals, providers that change month to
  month. The snapshot keeps what it would start from.
- **soundtrack's scripts fitted to this film** (four voices, two music cues in one mix, a phone treatment):
  one project.

What was checked: trigger runs on Opus 5.5 (the user's xhigh), this branch against `main` in a worktree, with
the same harness and cases. A first round left the installed 0.7.1 plugin on beside the linked skills; there
st-25 loaded soundtrack in 3 of 13 runs on `main` and 7 of 13 on the branch. With the plugin off the clean
re-run didn't reproduce the gap: 8 of 10 on `main` (soundtrack the first skill in 7, code-video in 3) and 7
of 10 on the branch (6 and 4). The other cases gave the same results in both rounds and on both wordings:
st-21 to st-23 loaded soundtrack 3 of 3; st-16, st-24, cv-12 and cv-25 loaded their skill 0 of 3. This small
clean comparison did not demonstrate a routing improvement: the new wording stands as a clarification, and
these counts don't predict a full production session. The three spec validators passed on code-video and
soundtrack, with no byte-order mark. Not run: a task eval (the session wrote its own voice tool fifty minutes
into a long production, which a six-turn trigger run can't reach), Codex's trigger runs, Sonnet.

Codex reviewed the branch read-only three times. The first round found six things, all fixed: st-24 asked for
5-second clips that didn't add up to 30 s; the snapshot and design.md said the custom audio tools lacked the
skill's rules, where they kept requests and measured loudness and only the licence came late; "every
script" takes `--out` (the production scripts do, their model helpers don't); the stand-up was an earlier
Seedance take, not a new one; alpha overlays were used, not asked for; and the snapshot said the keys were
revoked with no source (the user said so in this session). The second found the installed plugin in the
runs and the Higgsfield key st-25 names (both fixed in the harness, above), and asked for "adapted prompt"
and for counts that claim no more than they show. The third found that a task case's copied project
settings could turn the plugin back on (task.ts now reads them too) and softened two inferences.

## Photographic 3D from golden-temple (0.8.0, 2026-10-15)

The user pointed at [golden-temple](https://github.com/Leonxlnx/golden-temple) (MIT, Leon Lin, one commit,
`97fd9ec`, published that day): a golden-hour Japanese temple built entirely in three.js r186 and GLSL with
Claude Code (Opus 5.5 orchestrating parallel agents), rendered offline into a 70-second 1080p60 film in
headless Chrome. No models, textures or HDRIs; 24.4 million triangles; 8 averaged sub-frames per frame, about
3.3 s a frame and 4 hours for the film on a laptop iGPU (AMD Radeon 780M). They asked what audara could learn
from it to reach that quality as an option, without making every piece realistic and without risking the
skills' current behavior, and whether its prompts were known. At first they weren't: the repository was
created that day, has no issues, its release notes describe the film, and web searches found nothing, so the
first reading went by its README's "How it was made" and the code: one site plan and one time of day every
module reads, one agent per world module owning its hero shot, GPU stills compared with reference images (not
published), the world laid out for the cameras (the hero lotus at the first key's focus point), and camera
motion and flicker measured before the final render. The prompt turned up later (below). A Claude Code session (Opus 5.5) read both repositories and Codex (GPT-6 Astra,
through Herdr) read them independently first, then they argued it out over two rounds; the user gave Claude
the last call and asked for the change.

What the reading found: about 2,500 of golden-temple's 31,000 lines are reusable engine (material patching
into three's PBR materials, a Nishita sky with clouds, aerial perspective and "ambient volumes" in every
material through three's fog chunks, PMREM captures from the sky and then the scene, a fitted sun shadow,
SAO-style occlusion, a scatter-as-gather depth of field, an ACES/AgX blend, a shot evaluator); the other
28,000 build the temple. audara's engine already had the base it stands on (HDR targets, averaged
sub-frames, a bloom pyramid), but its sub-frames varied time (and cycled four supersampling taps for the
shaders that ask for them) without giving a three.js scene an index to move its camera, sun or occlusion
kernel by, and its docs led a three.js scene to flat materials, a RoomEnvironment and THREE.Fog. The user's own projects had already hand-rolled pieces of it
(audaces-1's `_realism.ts`: VSM shadows, area lights, a planar mirror, a depth of field; oprog-1 and oprog-4:
shadow maps in the engine), and 0.6.1 and 0.7.1 had left those engine additions out for scope, not for not
working.

**A proof of concept, in a scratch project** (nothing in the repository): the techniques ported into the
engine, scoped to one scene, and one small scene (a gilt finial on a vermilion post, a gate, stepping stones,
hills) rendered three ways at the same times and 12 sub-frames: A, a minimal PBR setup (what the docs led
to); B, golden-temple's way with AgX; C, B with the engine's shoulder. Findings:

- B against A: a large jump on the macro, which read as a photograph; the wide shot of the same simple
  geometry still read as CG (low-poly hills, bare ground). The geometry the lens resolves sets the ceiling,
  which is what golden-temple's macro-then-reveal grammar answers.
- B against C: a small difference. The tone curve isn't where the realism is, so the engine's post stays as
  it is.
- Sub-frame jitter (a Gaussian sub-pixel offset, a point in the sun's disc, the occlusion kernel's turn, all
  from the sub-frame's index) worked under verify's rules but kept the adaptive sampler climbing: 108
  sub-frames on a near-still frame, where it stops at 12 without jitter.
- Cost: the scene played in real time in the preview (8-10 ms a frame at 1080p) and cost about 18 ms per
  export sub-frame.

Codex's first round agreed on the direction (a reference, a kit copied on demand, no default) and ranked the
same levers, with modelled detail first. It added that a new tone mode would also have to drive the adaptive
sampler's error estimate, which once undersampled when the two disagreed (0.3.0); that verify's hashes need a
baseline rendered twice as a control; and that history's notes on shadows meant scope, not failure. Its
second round reviewed the proof of concept's code and found what packaging had to fix: program cache keys
from a counter (a hot reload could reuse a stale program), PMREM targets and passes never disposed, renderer
settings restored only on success (and a project with `shadowMap.autoUpdate = false` would skip the
shadows), the sub-frame index not reset in the single-sample branch or on a throw, a sub-pixel jitter
clipped on one side only, a depth of field that shrank at 4K, the sun counted twice in the scene's
environment capture, normals wrong under non-uniform scale, a scene's post overrides reaching a crossfade's
other scene, and "works with verify" overstated (verify's seek checks render one sample, with no jitter). It
preferred an engine index to deriving the sample from `t` (a zero shutter gives every sub-frame the same
time, and cut clamping repeats times), fixed samples as the first recipe, and checks of the sampled and
lifecycle paths.

What changed:

- **`references/realism.md`**: when a photographic shot earns its place (built and natural things; not
  people, faces or animals; Blender for organic heroes, cloth, fluids and glass), what makes it read as real
  in order, the kit, the rules that keep it stable in motion, sampling and cost, the method, prompting (an
  example prompt; the critic asked what reads as CG first) and the limits.
- **The realism kit, `skills/code-video/assets/realism/`**, copied whole into a project's `src/realism/`
  when a piece needs it, with golden-temple's MIT notice in its LICENSE: `env.ts` (one scene's sun, sky
  brightness and haze), `materials.ts` (`patch()` per material, no shared chunk edits, a content-hash cache
  key, three's own normals, an existing `onBeforeCompile` kept; `PROC` lacquer, gold, bronze, granite, wood,
  plaster; `n_aa`, `n_specAA`), `sky.ts`, `light.ts` (`Sun`, `withRenderer`), `lens.ts` (occlusion and depth
  of field in logical px), `sampling.ts` (Halton jitter from `SUBFRAME`, a symmetric truncated Gaussian,
  nothing on an engine without it), `camera.ts` (lens keys at times: direction, log look and focus
  distances), `example.ts` and a README with its rules. Pinned to three 0.186.
- **The engine:** `SUBFRAME` in `gl.ts`, set per sub-frame in `Engine.render` and reset to -1 in the
  single-sample branch and in a `finally` around the sampling loops. Nothing in the engine reads it.
- **SKILL.md** "Read when": `references/realism.md: photoreal 3D; blender.md: what three.js can't model or
  light, if installed.`, paid back by the images line (`what code draws poorly (...); images given or asked
  for.`): 7,997 bytes.
- **contract.md** ("three.js in this engine": a photographed shot goes to realism.md), **blender.md** (such
  a shot stays in three.js, and the kit lights a GLB), **engine-guide-template.md** (`SUBFRAME`, and fixed
  samples for jittered stretches), **init.ts** (AGENTS.md names `src/realism/` and its rules only in a
  project that has it), **README** ("Photoreal 3D" under other ways in), **NOTICE** and **LICENSE**
  (golden-temple), **design.md** ("Photographic 3D: an optional kit, not a default", the layout, "Coming
  back later").
- **Evals:** task case `cv-photoreal-shot` (a stone lantern at dusk, macro to reveal, rendered; judged blind
  with `--without`), a control in `cv-title-card` (no `src/realism/` for a minimal title card), and trigger
  case cv-26.

**The prompt, found afterwards.** With the branch open, the user found the author's post on X
(<https://x.com/LexnLin/status/2110657641831956870>, 2026-10-15) and, in his replies, "How I made this"
(<https://x.com/LexnLin/status/2110657793376039323>; read logged out in headless Chrome, its full text
through the fxtwitter API, and the same as the user pasted). The build was inspired by a Gemini scene
("argon") the author found full of mistakes. He generated about ten images of Japanese temples as references
(the board is attached to the reply: pagoda, arched bridge, lotus pond, lanterns, the gilt sanctum, a night
and a rain variant, which the film's shots follow closely) and gave Opus a short prompt of five parts: ten
7-second shots, each starting close up and pulling back; golden hour, as real as possible, light and shadows
first, matching the references "until you reach 99.9%"; everything in code but a free music track found
online; detail "2x more than you think is enough", the ground good from above too, light and shadows clean
with "zero flickering"; and verify and iterate, not stopping until it matched, "even if it takes days". What
that changed here: the macro-then-reveal grammar was the prompt's, not something the model found; the
engineering the kit ports (the sampling rule, the flicker tools, the patching) is what the model built to
meet "zero flickering" and "as real as possible", which is why it is worth shipping; and the quality came
from a visual target and an open-ended loop against it, which realism.md had treated as optional. So
realism.md's method now starts with a reference board (the director's photos, public-domain ones, or
generated ones, about $0.04 each through `imagegen.py`, offered in the brief and waiting for a yes, kept out
of the frame), a side-by-side compare (one ffmpeg command, tested), the bars in plain words and the time as
the budget (the side-by-side compare and the agreed budget are audara's, not the author's); its Prompting
follows the five parts. `images.md` names references as a use (a target, never
material), `cv-photoreal-shot` checks that the brief offers a board and spends nothing, and design.md and the
README follow. Nothing in the kit or the engine changed with it.

**The preview.** The user then asked how such scenes play in the browser preview. The player draws each
frame at the soundtrack's clock, so a slow scene drops frames and stays in sync, and while paused it redraws
the same one-sample frame. Measured at 1080p (`render.ts perf`, Chrome on the laptop's RTX 5070 and on its
integrated Intel GPU with `CHROME_FLAGS=--force_low_power_gpu`): the kit's example cost 8.4 ms a frame on
the RTX and 53 ms on the Intel GPU (19 fps); with the depth of field, sky, shadows and both switched off in
turn, the depth of field was 37 of the 53 ms, since its spiral sampled out to the largest blur allowed at
every pixel, in focus or not, while the sky and the shadows were cheap. So `lens.ts` now finds the largest
blur in each 16x16-px tile and stops the spiral at the largest within two tiles (render frames unchanged
to 1 level in 0.1% of pixels), and `dofStep` spaces the taps for a preview path (the example uses 1.2 when
`ctx.export` is false): 3.8 ms on the RTX, 26 ms on the Intel GPU (38 fps); the render's cost stayed where it
was on the Intel GPU (the macro, blurred everywhere, dominates). The example adds 1-3 s to opening the
preview. golden-temple itself, in its own preview (one sample, no depth of field, a 2048 shadow map, 23.2
million triangles), took 161 s on the RTX and 137 s on the Intel GPU to build and compile before the first
frame, then played at 21-44 fps on the RTX and 2.4-3 fps on the Intel GPU. What no speed fixes: one sample a
frame shows no jitter, soft shadows or motion blur, so the finish and its flicker are judged in renders.
`realism.md` has a section on it (what each shows, the preview path's levers in order, a long build kept
in a helper module so a scene's edits hot-swap in seconds: checked in the live preview, three edits of a
scene hot-swapped it while its world, built in `_world.ts`, was built once), and the kit's README and
design.md follow.
The paused frame came next, at the user's word, with no change to any other scene's preview. Asked
whether it overcomplicated things: refining it progressively, sub-frame by sub-frame across display
frames, would have needed new accumulation in the engine, so it is done the simple way, with the sampling
the engine has. In `src/main.ts`, when the preview is paused, the playhead has rested 0.3 s and a scene on
screen sets `refine = true` (a plain property, read by duck typing, so a kit scene still builds on an older
engine), the player renders that frame once with 12 sub-frames and holds it until the playhead moves or a
scene reloads ("full quality" on the info line); otherwise its loop draws exactly as before. The kit's
example sets it. Checked in the live preview (Playwright, the player's `engine.render` calls counted): the
example video paused, and a GLSL scene paused inside a video that also has a kit scene, drew one sample a
frame on every tick and never refined; the kit scene paused drew one-sample frames for about 0.3 s, then one
12-sub-frame render, then nothing until a seek (refined again) or play (one sample a frame), and saving the
scene while paused reloaded it and refined it again; the refined frame differed from the one-sample frame in
24% of its pixels (edges and highlights). Codex's review of it found four things, fixed: a kit scene in a
crossfade refined and froze the other scene too (now every scene the frame's shutter touches has to set it);
a stateful scene would have been sampled a little before the time already drawn, without a reset (stateful
scenes don't refine); a lost and restored GL context would have kept a held frame (both events let it go);
and "full quality" overstated a frame still on the preview path's settings (the info line says "refined
(12 sub-frames)", and the docs say what stays cheaper). Re-checked live: a crossfade between the kit scene
and a GLSL scene, paused, drew one sample a frame and never refined; the rest as before. A second round found
one more, fixed: paused at the video's very end, the shutter reached past it, where nothing draws, and
would have darkened the held frame (the end's frame isn't refined: checked live). The third found nothing.

Considered and left out: a tone operator (AgX or golden-temple's ACES/AgX blend: a small difference
measured, and coupled to the sampler's error estimate); a shadow setting in the engine (scenes turn shadows
on around their own draws; one type, PCF, project-wide); golden-temple's global shader-chunk patches (they
would reach every scene of a video); its ambient volumes (boxes that dim sky light indoors), its volumetric
light and god rays (both off in its own film), and its water, vegetation and SDF sculpture as kit code (each
a scene's own); a shimmer metric in qc.py
(golden-temple's `mcflicker` was used here by hand); a realism example in the template, or realism as the
default for 3D.

What was checked, in fresh projects made by this branch's init (and by `main`'s, in a worktree, for
controls):

- `bun run check` passes with the kit in `src/realism/`, on this branch's engine and on `main`'s (which has
  no `SUBFRAME`: the kit imports the engine's module as a namespace, so it builds and renders without
  jitter).
- The example video is unchanged by the engine hook: on `main`'s engine, verify twice gave the same hashes
  (48 sampled frames compared: the control); this branch's against that baseline, the same 48; an adaptive
  poster at 5.2 s (12 sub-frames) bit-identical between the two.
- The kit's example scene: verify passes; the same frame after different seek histories is bit-identical
  with fixed sampling (12 sub-frames) and adaptive sampling (108); crossfades with the example's GLSL and
  three.js scenes, both ways, render as expected and repeat bit-identically in four runs of five (one run
  differed from the others by 1 level in 2 pixels of a crossfade frame, unexplained; each scene alone and a
  crossfade of two example scenes repeated exactly); the example's three.js scene after the kit scene is
  bit-identical to it rendered alone.
- Renderer restoration: a probe scene that writes the shared renderer's settings into its pixels read the
  engine's defaults (shadows off, PCF, `autoUpdate` on, `autoClear` off) before the kit scene, after it, and
  after a scene that throws inside `withRenderer` with shadows and `autoClear` changed and another target
  bound.
- 4K: the macro at `--scale 2`, downscaled, matched 1x within 3.3 levels on average, with the same blur
  size.
- Hot reload in the live preview (Playwright, five edits each): the scene copied into
  `videos/<video>/scenes/` hot-swapped on every edit with geometries (49) and textures (39) unchanged and
  programs between 22 and 23, back to 22 after; an edit in `src/realism/` reloads the page instead (the
  preview hot-swaps scene modules under `videos/`), which `realism.md` says.
- A 6-second full-quality clip at 12 sub-frames: 360 frames in 44 s (0.12 s a frame). On `main`'s engine
  (no jitter) against this branch's, golden-temple's `mcflicker` residual went from 0.748 to 0.711 per 255
  (5% less shimmer) and the second temporal difference from 1.873 to 1.816: a measurable, modest gain on a
  scene with little thin geometry.
- Trigger: cv-26 loaded code-video in 3 of 3 runs and the near-miss cv-12 (a realistic AI clip) in 0 of 3
  (Opus 5.5, low effort). The three spec validators passed on code-video; `test_init_gitignore.ts` 3/3.

Not run: the `cv-photoreal-shot` task eval with and without the skills (an hour or more per run and tool),
so whether a fresh session reaches the kit and makes better pictures than the model alone is not yet
measured; Codex's trigger runs; a long photographic film; a GPU other than this laptop's.

Codex reviewed the branch read-only. The first round found seven things, all fixed: a patch chained onto a
material with its own `onBeforeCompile` lost that hook's identity in the program cache key (three's default
key reads the callback, which the patch had replaced; the key is now taken before: four checks on CPU-only
materials pass); the sky followed a camera's local position, which inside a CubeCamera is its face camera's
zero (now its world position: the example's frame changed by 1 level in 1.4% of pixels, verify passes); the
eval case asked the `--without` arm for audara's internals (now scoped to the skill arm, with equivalents);
the recipe for adding `SUBFRAME` to an older engine left out its import; the stability promise held only for a
fixed sample count (now said wherever it is made, and `maxSamples` described as a cost bound only); and two
lines here (golden-temple's ambient volumes are on in its film; the engine's sub-frames already cycled four
supersampling taps).
The second round found two more, fixed: the cache key still collided for a material subclass that overrides
the key on its prototype, and for an override that delegates to three's default (the patch now calls the
material's earlier key, whatever gives it, with the original callback put back for the call: seven checks
on CPU-only materials pass, and the example's frames are unchanged); and the eval's renderer assertion
counted binding `out`, which every scene does. The third round found nothing.
A fourth round, on the prompt's update, found three things, fixed: the compare command wrote into a
folder nothing creates (it now writes beside the still); handing the critic the builder's side-by-side pairs
broke its independence (it gets the references and makes its own); and design.md credited the author with
audara's side-by-side compare and time budget.
