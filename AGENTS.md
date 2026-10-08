# audara-studio

A plugin for Claude Code and Codex with three Agent Skills; `skills/` is the product. `skills/code-video/`
makes the picture (SKILL.md, references, scripts, and `assets/template-webgl/`, the engine `init.ts` copies
into each user's project); `skills/soundtrack/` makes the audio and its timing data; `skills/video-ideas/`
(text only) helps choose what to make and writes a starting prompt. `evals/` tests all three.
`docs/design.md` says how it works and why, `docs/history.md` how it got there, with the evidence: search
them for the topic before changing a behavior, since most choices answer something that once went wrong.
`docs/research/` holds dated research snapshots, not current behavior: they aren't updated as it changes.

## How we work
- Simple and effective over complete: a tool joins only when it clearly earns its place. Free tools first;
  a paid one is a last resort, with its license or cost stated.
- The README stays short: what it is, install, first video. Details go in linked docs.
- Python only through uv (`uv run`, PEP 723 inline dependencies).
- Skill text says what and why, in plain words, never MUST; the director's words outrank its defaults.
- Ask the user plain questions about what they will see or pay for; make technical calls yourself and say
  what you chose.

## Checks
- Each SKILL.md stays under 8,000 bytes (Codex cuts an invoked skill there), has no byte-order mark, and
  passes the three validators in `evals/README.md` ("Spec checks").
- Eval cases live in `evals/tasks/cases.ts`; `bun evals/tasks/cases.ts` writes every `case.json`. Don't edit
  those by hand.
- A behavior change updates every place that states it: SKILL.md and its references, the AGENTS.md section
  `skills/code-video/scripts/init.ts` writes into projects, the README, the eval cases, `docs/design.md`
  (edited in place) and `docs/history.md` (a dated entry with the evidence).
- A release bumps `version` in both `plugin.json` and `.claude-plugin/plugin.json`.
- A task eval takes an hour or more per case and tool, and anything that spends (ElevenLabs, image generation) waits
  for the user's yes; the evals mock both (`evals/README.md`).
- Eval runs work inside `evals/results/`, below this file. The harness keeps this file and CLAUDE.md out of
  Claude Code's runs (`claudeMdExcludes` in `evals/harness/`); keep it that way.
- In Git Bash on Windows, don't hand `/dev/null` to a native tool: bun wrote a file named `nul`.
