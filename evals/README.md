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
```

Some cases need outside material, passed by environment variable so no third-party media is committed:
`EVAL_SONG` (a song) with `EVAL_SONG_DATA` (a folder with its ground-truth `audio.json`), and
`EVAL_PROJECT` (a project made with audara, for the later-session case). `st-asks-before-spending` runs
against a local ElevenLabs mock (`evals/mocks/elevenlabs.py`) with a fake key and logs every request, so
a grader can see that nothing was spent before the user said yes.

Each run folder holds `turn-N.jsonl` (the transcripts), `result.json` (timings, the final file list, git
status, the assertions) and `work/` (the project as it ended). A grader reads them, checks each
assertion with evidence (running ffprobe, `render.ts verify`, `qc.py` and the like) and writes PASS or
FAIL per assertion.

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
