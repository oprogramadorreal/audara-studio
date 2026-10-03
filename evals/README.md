# Evals

Two kinds, both run headless in fresh folders, in Claude Code and in Codex. Results go to
`evals/results/` (git-ignored). The runners clean up after themselves: Codex's per-folder trust entries
are removed from `~/.codex/config.toml`, and Claude Code sessions are not kept (trigger) or are moved
next to their results (tasks).

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
`lyrics.json`), and `EVAL_PROJECT` (a project made with audara, for the later-session case).
`st-asks-before-spending` runs against a local ElevenLabs mock (`evals/mocks/elevenlabs.py`) with a fake
key and logs every request the session makes, so a grader can see that nothing was spent before the user
said yes; a text-to-speech request's log line also gives where each word really sounds on its audio, to
check words.json against. The mock's MP3s carry the gapless header ElevenLabs' do (an Info tag with the
encoder delay, which ffmpeg and browsers drop). The no-key cases run the mock too, with no key
(`"key": false`): a request made anyway reaches the mock, not ElevenLabs, and shows in its log. The
later-session case has a decoy (`"decoy": 5173` in its setup): for the whole run an unrelated Vite app
answers on 127.0.0.1:5173, as one left running on a developer's machine does, with its page for every path
and no JSON at `/__audara`, so a grader can see whether the agent checked that the preview it links is its
own. If the port is taken already, `result.json` says what answers there instead.

Claude Code turns run with `--strict-mcp-config` and the claude.ai connectors off, so no MCP server loads
and the user's connectors can't ask for authorization in the replies (the user's plugins, skills and hooks
still load). Both tools keep the user's caches (uv's, and the soundtrack scripts' `AUDARA_CACHE`): a fresh
one per run would download gigabytes each time, so a run finds the models the machine already has, and
the first download on a clean machine is outside what these runs test.

Each run folder holds `turn-N.jsonl` (the transcripts), `result.json` (each turn's start and end, to the
millisecond, its length and whether it hit the timeout, the final file list, git status, the assertions),
`mock-requests.jsonl` when the case runs the mock, and `work/` (the project as it ended). `result.json`'s
`previews` lists every port in 5173-5199 whose `/__audara` named a folder during the run, with that folder
and whether it is this run's `work/`: a preview started in a background shell dies with its turn, one
started by `render.ts preview` runs until the harness stops it at the end, and runs going at once can
reach each other's. A Codex run also gets `codex-sessions/`, its session files from `~/.codex/sessions`
(the main thread's and its sub-agents'), since `codex exec --json` leaves out calls such as spawn_agent
and view_image. A grader reads them, checks each assertion with evidence (running ffprobe,
`render.ts verify`, `qc.py` and the like) and writes PASS or FAIL per assertion.

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
