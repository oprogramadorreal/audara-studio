# Evals

Two kinds, both run headless in fresh folders, in Claude Code and in Codex. Results go to
`evals/results/` (git-ignored). The runners clean up after themselves: Codex's per-folder trust entries
are removed from `~/.codex/config.toml`, and Claude Code sessions are not kept (trigger) or are moved
next to their results (tasks).

No session can reach the user's desktop or their own browser: with the user's own Codex config, one task
run read the titles of their open Chrome tabs through Codex's computer-use plugin, pressed play in a
background tab and left a tab open. So every run turns off what could. In Codex that is the features and
plugins named for computer use or a browser (`computer_use`, `browser_use*`, `in_app_browser`; the bundled
`computer-use`, `unified-computer-use`, `browser` and `chrome`), every MCP server whose name, command or
environment names one (the Codex app's `node_repl` in `config.toml`) and the `notify` program, with `-c`
and `--disable` flags built from what `codex features list`, `plugin list` and `mcp list` report (an
override for something Codex doesn't have is an error). In Claude Code it is Claude in Chrome
(`--no-chrome`) and the enabled plugins named for a browser (Playwright's MCP server), through
`--settings`. No config file changes, and the rest of the user's setup loads as before. Then a check:
with the flags, Codex's plugin and server lists show none of these before the first turn; each Claude
turn's init event lists none among its tools before the model acts; and a Codex call to such a server
stops the run (a task turn is marked `blocked`; a trigger eval writes no results). A shell command could
still open a URL (`start`, `Start-Process`): Codex puts it to its automatic reviewer first, Claude Code to
its auto-mode classifier.

No session reads this repo's own notes either. The runs work inside `evals/results/`, below the repo's
`AGENTS.md` and `CLAUDE.md`, and Claude Code reads both from every folder above its own; the runners leave
them out with `claudeMdExcludes` in the same `--settings`. Codex stops at the run folder's own git root.
(Checked with a canary line: without the setting, a Claude run below an `AGENTS.md` alone quoted it, and
one below the `CLAUDE.md` saw its import line; with it, neither. A Codex run saw nothing.) A session can
still open them with a command of its own: on 2026-10-06 a Codex run without the skills read the repo's
`AGENTS.md` with `Get-Content` (history.md, 0.4.0).

Both runners record the model each run had as the transcripts name it (Claude's init event; Codex's
session file, since its `--json` stream doesn't), and `modelArg`, what `--model` asked for.

## Trigger evals

Does a fresh session load the skill for a realistic request, and leave near-misses alone? About twenty
requests per skill, half near-misses, three runs each. Every skill in `skills/` is linked into each run, so
they compete as they do once the plugin is installed (an installed audara-studio is turned off for the run,
in both tools, so each skill is there once, with the description under test); code-video's set ends with
two requests for ideas only, which belong to video-ideas, and one to put a project in git, which belongs to video-repo (on Codex,
read cv-23 by its loads, `runs[].triggered`: its use signal matches any command that names
`scripts/render.ts`, which video-repo's own work can do). A request
made inside a project places fixtures with `"<fixture> => <path>"` (video-repo's set gives each the outline
of a finished one: `videos/promo/video.json`, its song, and the `AGENTS.md` and `CLAUDE.md` init writes,
made by init itself and again whenever `init.ts` changes).

```sh
bun evals/harness/trigger.ts --tool claude --model opus   --set evals/trigger/code-video.json
bun evals/harness/trigger.ts --tool claude --model sonnet --set evals/trigger/soundtrack.json
bun evals/harness/trigger.ts --tool codex                 --set evals/trigger/code-video.json
bun evals/harness/trigger.ts --tool claude --model opus   --set evals/trigger/video-ideas.json
bun evals/harness/trigger.ts --tool claude --model opus   --set evals/trigger/video-repo.json
bun evals/harness/trigger.ts --tool claude --model opus   --set evals/trigger/youtube-package.json
```

`--effort` sets the reasoning effort the user's settings would otherwise pick, as in `task.ts` below. Every run
otherwise inherits the user's own (Claude Code's `effortLevel`, Codex's `model_reasoning_effort`), so a check of
a description change can run first at `--effort low --runs 1`, and at the user's effort only when that is worth
its cost.

youtube-package's set holds the user's own thumbnail prompt and three requests in Portuguese, and its
near-misses sit beside it in the other sets: cv-24 (the package asked for inside a project, in code-video's
set) and vi-23 (a better title for a finished video, in video-ideas'). A packaging run that renders plates
calls `render.ts`, which counts as code-video's use on Codex: read cv-24 by its loads, as cv-23.

soundtrack's set ends with films whose picture isn't the engine's: st-21 asks for a whole ad shot with an AI
video model, its narration, music and mix; st-23 says the picture is made in another tool; st-22 narrates in
a voice clone the user already has, beside st-16, which asks to make one; st-24, the AI shots alone, is the
near-miss. cv-25, in code-video's set, is st-23. st-21 isn't one of code-video's near-misses: an ad can
fairly use code for its titles. st-25 adapts the long prompt a 2026-10 session answered without
soundtrack (`docs/history.md`, 0.7.2): keys, links and brand swapped, a short text script in place of a
PDF. On Opus 5.5 it loaded soundtrack in 7 of 10 runs, code-video first in the rest; a run that loads
code-video first and soundtrack only when the sound starts would be fine in a real session but fails here,
since a run stops at six turns.

A request passes when the skill loads in at least half its runs (or, for a near-miss, in fewer than
half). Codex models often open a plausible skill just to decide, then decline it; for Codex a near-miss
fails only when the skill is used (one of its scripts runs). video-ideas has no scripts, so its use can't be
seen that way: it is reported as not measured, and its Codex near-misses fail on the load, as Claude's do, a
stricter test (the summary's `nearMissCriterion` says which applied). Each run also reports script-use
signals observed before it stops (`usedSkills`). Positive runs stop when the target skill loads, so the `vi-`
task cases, not the trigger pass rate, check that ideas requests never continue into production.
`--description <file>` tries an alternative description without editing SKILL.md.

## Task evals

Realistic multi-turn requests, with scripted director replies between turns, built from what the
no-skill baselines got wrong. Each case is `evals/tasks/<id>/case.json` (written by
`evals/tasks/cases.ts`): the setup, the turns and the assertions a grader checks with evidence.

```sh
bun evals/harness/task.ts --case evals/tasks/cv-title-card --tool claude
bun evals/harness/task.ts --case evals/tasks/cv-title-card --tool codex
bun evals/harness/task.ts --case evals/tasks/cv-title-card --tool claude --without   # baseline arm
bun evals/harness/task.ts --case evals/tasks/cv-showreel-resume --tool codex --effort ultra
bash evals/harness/run-tasks.sh both                                                 # every case, both tools
CASES="cv-title-card cv-later-session-small-change" bash evals/harness/run-tasks.sh claude
```

`run-tasks.sh` runs the cases a few at a time, then the six cases that start from a finished project (the
later session, the second format, a second video with its own look, ideas for another video and the two
repository cases) on the project of the latest finished
`cv-title-card` run (Claude Code's if there is one, else Codex's), the same project for both tools; an `EVAL_PROJECT` set beforehand is used instead. `CASES` runs only the cases it names, and extra
arguments go to `task.ts` (`--without`, `--model sonnet`, `--effort ultra`). `--effort` sets the reasoning effort the
user's settings would otherwise pick (Claude Code's `--effort`, Codex's `model_reasoning_effort`), so a run can
match how the user runs the tool.

Some cases need outside material, passed by environment variable so no third-party media is committed:
`EVAL_PACKAGE_PROJECT` (a finished project whose narrated video runs over a minute and has no YouTube package
yet, for the `yp-` cases: their words fit oprog-4's treinada, copied without `node_modules/`, `out/`,
`.audara-cache/`, `videos/treinada/thumbs/`, `thumbnail.py` and `youtube-description.txt`, and with
TREATMENT.md cut before the Decision that first asks for a thumbnail, so the session starts where the user did),
`EVAL_SONG` (a song) with `EVAL_SONG_DATA` (a folder with its ground-truth `audio.json` and
`lyrics.json`), `EVAL_PROJECT` (a project made with audara, for the later-session, second-format, second-video and
existing-project ideas cases; one from an older release keeps its older `render.ts`, which init's AGENTS.md
then says to update), and
`EVAL_INPUTS` (a folder with `pdoom-pt-BR.mp3` and its `lyrics.txt`, for `cv-lyric-short`, the short
lyric-video prompt of the 2026-10-03 tests word for word; it isn't in `run-tasks.sh`'s default list, nor are
`cv-showreel-resume` and `cv-showreel-psychedelic`, the 2026-10-06 showreel prompts, judged as a set with their
`--without` runs).

Which user each case stands for: a short prompt that leaves everything open (`cv-zero-asset`,
`cv-lyric-short`, `cv-range-loop`) or names only a form or a style (`cv-showreel-resume`,
`cv-showreel-psychedelic`), direction given in detail or over several turns, a rejection included,
which must survive a new session (`cv-direction-rejection`, `cv-visual-direction-no-script`,
`cv-later-session-small-change`), a script the director brings with its words locked (`cv-locked-script`,
`st-voiceover-no-key`), a finished video asked for in a second format (`cv-second-format`), a second
video in the same project with a look of its own, which must leave the first one's frames as they were
(`cv-second-video-own-look`: the plant `first-video-baseline` verifies the first video twice before the
session, in `baseline/` beside `work/`, for the grader to compare with), a product film
from the director's own screens, one missing (`cv-product-real-screens`), and a concept screen they ask
for (`cv-product-concept-mockup`), and the three ways generated images come in: offered once, used within
a budget, and no key (`cv-images-offered`, `cv-images-used`, `cv-images-no-key`), and a photographic 3D shot asked
for by its subject and its move (`cv-photoreal-shot`: the realism kit, judged blind with `--without` on how
photographic its frames read, and like the showreels not in `run-tasks.sh`'s default list; `cv-title-card` checks the
kit stays out of a piece that doesn't ask for it). The `vi-` cases stand
for someone choosing what to make: ideas only, from nothing or from product screens, in an empty folder or
an existing project (`vi-ideas-only`, `vi-product-screens`, `vi-existing-project`), a prompt to improve or
one found online to adapt (`vi-refine-keeps-constraints`, `vi-adapt-found-prompt`, `vi-silent-long`), and
the ways on to the video: a "make it" after choosing, and a better prompt or a choice of ideas asked for
together with the video (`vi-select-then-make`, `vi-improve-and-make`, `vi-ideas-and-make`). Most are text
only and take minutes. The `vr-` cases stand for someone handing a finished project on: its first
repository, asked for in the user's own words, then a name and a commit e-mail (`vr-first-repo`), and a
project already in git with a key in an earlier commit and someone's change left staged
(`vr-existing-history`), and the repository asked for in an empty folder before the video, which then
has to survive init and reach the full pass in later sessions (`vr-empty-first`). The first two start from
the title-card project too, and `"plant": "<name>"` adds what
`evals/harness/plant.ts` plants: a home-folder path in a treatment, keys in a script and a debug dump, a
render outside `out/`, an `out/` below a video, a duplicate, a file over GitHub's 100 MiB limit, a
superseded generated image. `"git": false` leaves the folder without the harness's repository and setup
commit, as a project is before its first one; the session's environment stops git at the run's folder
(`GIT_CEILING_DIRECTORIES`), so it doesn't find this repo's above `evals/results/`, and keeps the skill links
out of git (a `core.excludesFile` beside the folder). The `yp-` cases stand for someone publishing a finished
video, on `EVAL_PACKAGE_PROJECT`: the user's own thumbnail prompt with its words and title given, then their
channel's type applied in a new session (`yp-given-words`); nothing given (`yp-nothing-given`); a title alone,
where no picture should be made (`yp-title-only`); and generated images within a budget, on the image mock
(`yp-images-budget`). They aren't in run-tasks.sh's default list, since they need that project; run them with
`--without` too, judging the thumbnails blind, small and beside their title, against the model alone. The `vi-` cases are graded on the conversation, preservation of constraints,
faithful prompts and unwanted actions. The production cases' set comparisons use blind contact-sheet
judging with and `--without` the skills: they are the check that the skills make the picture better than
the model alone, not just correct.

A turn with `"newSession": true` starts a new session in the same folder instead of resuming, as a
director coming back another day would: it knows only what the project wrote down.
`st-asks-before-spending` runs against a local ElevenLabs mock (`evals/mocks/elevenlabs.py`) with a fake
key and logs every request the session makes, so a grader can see that nothing was spent before the user
said yes; a text-to-speech request's log line also gives where each word really sounds on its audio, to
check words.json against. The mock's MP3s carry the gapless header ElevenLabs' do (an Info tag with the
encoder delay, which ffmpeg and browsers drop). The no-key cases run the mock too, with no key
(`"key": false`): a request made anyway reaches the mock, not ElevenLabs, and shows in its log.
`"mock": "openai-images"` (or a list of both) does the same for image generation with
`evals/mocks/openai_images.py` and `mock-images.jsonl`: `imagegen.py` talks to it through
`AUDARA_IMAGES_BASE_URL`, with a fake `OPENAI_API_KEY` in Claude Code runs only, to keep a fake key away
from Codex's own sign-in. Codex's built-in image generation can't be mocked: in a Codex run it would
draw on the ChatGPT plan's limits, which the image cases check it only does when asked. The harness never
passes a real `ELEVENLABS_API_KEY` or `OPENAI_API_KEY` to a session, in task or trigger runs, nor any
`HIGGSFIELD_*` variable (st-25 names a Higgsfield key and a budget). The
later-session case has a decoy (`"decoy": 5173` in its setup): for the whole run an unrelated Vite app
answers on 127.0.0.1:5173, as one left running on a developer's machine does, with its page for every path
and no JSON at `/__audara`, so a grader can see whether the agent checked that the preview it links is its
own. If the port is taken already, `result.json` says what answers there instead.

Claude Code turns run with `--strict-mcp-config` and the claude.ai connectors off, so no MCP server loads
and the user's connectors can't ask for authorization in the replies (the user's plugins, skills and hooks
still load, but for the browser ones above). Codex turns keep the user's other MCP servers and apps. Both
tools keep the user's caches (uv's, and the soundtrack scripts' `AUDARA_CACHE`): a fresh one per run would
download gigabytes each time, so a run finds the models the machine already has, and the first download on
a clean machine is outside what these runs test.

Each run folder holds `turn-N.jsonl` (the transcripts), `result.json` (the model, with Codex's reasoning
effort, and `otherModels` when a sub-agent ran another; each turn's start and end, to the millisecond, its
length, its model and whether it hit the timeout or was blocked; `desktopOff`, the flags that turned
computer use and browser automation off; the final file list, git status, the assertions),
`mock-requests.jsonl` when the case runs the mock, and `work/` (the project as it ended). `result.json`'s
`previews` lists every port in 5173-5199 whose `/__audara` named a folder during the run, with that folder
and whether it is this run's `work/`: a preview started in a background shell dies with its turn, one
started by `render.ts preview` runs until the harness stops it at the end, and runs going at once can
reach each other's. A Codex run also gets `codex-sessions/`, its session files from `~/.codex/sessions`
(the main thread's and its sub-agents'), since `codex exec --json` leaves out calls such as spawn_agent
and view_image. A grader reads them, checks each assertion with evidence (running ffprobe,
`render.ts verify`, `qc.py` and the like) and writes PASS or FAIL per assertion.

## Script tests

`evals/tests/` tests the scripts themselves, offline: no session, no network, no paid call. `imagegen.py`'s
check that a paid image is never lost or paid for twice (a changed format, a failed save, an edit of
itself).

`test_audit.ts` checks secret detection and masking, file limits, duplicates, Git scopes and actionable
failures in temporary repositories.
`test_init_gitignore.ts` checks how init merges its entries into a project's own `.gitignore` (a rooted
`/out/`, an exception such as `!.env.example` that has to stay last).
`test_youtube.ts` checks youtube-package's `youtube.ts`, with a local Chrome and no network: shoot's
diagnostics (a face that doesn't load, a character a face lacks, text in the badge's corner, a missing image,
two pages that would write one image, its exit codes); check's rules (the title over 100 characters, the
description at and past 5,000 accented characters, chapters under 10 s or past the end or not times at all
("0:99"), the video's length taken from video.json before its audio, the tags' 500-character count, hashtags past
15 and past 60, Markdown, an image that isn't 16:9 or doesn't decode, a mistyped folder, and --full's three PNGs
and three text files); preview's sheets; and what niche refuses before any network call.
`test_render_failures.ts` checks encoder exits, socket write failures, cancellation and ffprobe preflight
with in-memory peers and bounded waits. `test_render_inputs.ts` checks resume fingerprints and piece
boundaries around stateful scenes' shutter exposures; neither needs Chrome or ffmpeg.

```sh
uv run evals/tests/test_imagegen.py
bun evals/tests/test_audit.ts
bun evals/tests/test_init_gitignore.ts
bun evals/tests/test_youtube.ts
bun evals/tests/test_render_failures.ts
bun evals/tests/test_render_inputs.ts
```

## Spec checks

Before a release, each skill passes all three validators, since each catches something the others miss:
skills-ref checks the folder name and strict YAML; both `quick_validate.py` scripts reject angle brackets
in the description; Codex's also rejects keys it doesn't read and `[TODO:` placeholders.

```sh
uvx --from skills-ref agentskills validate skills/code-video
PYTHONUTF8=1 uv run --with pyyaml python ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/code-video
PYTHONUTF8=1 uv run --with pyyaml python <skill-creator>/scripts/quick_validate.py skills/code-video
```

The second script comes with the Codex CLI (upstream: `codex-rs/skills/src/assets/samples/skill-creator/`
in openai/codex), the third with Anthropic's skill-creator plugin. `PYTHONUTF8=1` stops them misreading
UTF-8 on Windows. Run the same three on `skills/soundtrack`, `skills/video-ideas`, `skills/video-repo` and `skills/youtube-package`. Two checks no
validator makes: SKILL.md stays under 8,000 bytes (Codex cuts an invoked skill there) and is saved without
a byte-order mark.
