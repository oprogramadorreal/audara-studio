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
one below the `CLAUDE.md` saw its import line; with it, neither. A Codex run saw nothing.)

Both runners record the model each run had as the transcripts name it (Claude's init event; Codex's
session file, since its `--json` stream doesn't), and `modelArg`, what `--model` asked for.

## Trigger evals

Does a fresh session load the skill for a realistic request, and leave near-misses alone? Twenty requests
per skill, half near-misses, three runs each.

```sh
bun evals/harness/trigger.ts --tool claude --model opus   --set evals/trigger/code-video.json
bun evals/harness/trigger.ts --tool claude --model sonnet --set evals/trigger/soundtrack.json
bun evals/harness/trigger.ts --tool codex                 --set evals/trigger/code-video.json
```

A request passes when the skill loads in at least half its runs (or, for a near-miss, in fewer than
half). Codex models often open a plausible skill just to decide, then decline it; for Codex a near-miss
fails only when the skill is used (one of its scripts runs). `--description <file>` tries an alternative
description without editing SKILL.md.

## Task evals

Realistic multi-turn requests, with scripted director replies between turns, built from what the
no-skill baselines got wrong. Each case is `evals/tasks/<id>/case.json` (written by
`evals/tasks/cases.ts`): the setup, the turns and the assertions a grader checks with evidence.

```sh
bun evals/harness/task.ts --case evals/tasks/cv-title-card --tool claude
bun evals/harness/task.ts --case evals/tasks/cv-title-card --tool codex
bun evals/harness/task.ts --case evals/tasks/cv-title-card --tool claude --without   # baseline arm
bash evals/harness/run-tasks.sh both                                                 # every case, both tools
CASES="cv-title-card cv-later-session-small-change" bash evals/harness/run-tasks.sh claude
```

`run-tasks.sh` runs the cases a few at a time, then the later-session case on the project of the latest
finished `cv-title-card` run (Claude Code's if there is one, else Codex's), the same project for both
tools; an `EVAL_PROJECT` set beforehand is used instead. `CASES` runs only the cases it names, and extra
arguments go to `task.ts` (`--without`, `--model sonnet`).

Some cases need outside material, passed by environment variable so no third-party media is committed:
`EVAL_SONG` (a song) with `EVAL_SONG_DATA` (a folder with its ground-truth `audio.json` and
`lyrics.json`), `EVAL_PROJECT` (a project made with audara, for the later-session case), and
`EVAL_INPUTS` (a folder with `pdoom-pt-BR.mp3` and its `lyrics.txt`, for `cv-lyric-short`, the short
lyric-video prompt of the 2026-10-03 tests word for word; it isn't in `run-tasks.sh`'s default list).

Which user each case stands for: a short prompt that leaves everything open (`cv-zero-asset`,
`cv-lyric-short`, `cv-range-loop`), direction given in detail or over several turns, a rejection
included, which must survive a new session (`cv-direction-rejection`, `cv-visual-direction-no-script`,
`cv-later-session-small-change`), a script the director brings with its words locked (`cv-locked-script`,
`st-voiceover-no-key`), and the three ways generated images come in: offered once, used within a budget,
and no key (`cv-images-offered`, `cv-images-used`, `cv-images-no-key`). The set comparisons in their
assertions (a blind judge on contact sheets, with and `--without` the skills) are the check that the
skills make the picture better than the model alone, not just correct.

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
passes a real `ELEVENLABS_API_KEY` or `OPENAI_API_KEY` to a session, in task or trigger runs. The
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

```sh
uv run evals/tests/test_imagegen.py
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
UTF-8 on Windows. Run the same three on `skills/soundtrack`. Two checks no validator makes: SKILL.md stays
under 8,000 bytes (Codex cuts an invoked skill there) and is saved without a byte-order mark.
