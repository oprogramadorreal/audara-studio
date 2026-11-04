# The development log, the ledger and the standing rules

`docs/DEVELOPMENT_LOG.md` is the build's index: a later session reads it before anything else, and the video's
script is written from it. Both devlogs this skill comes from kept one, and in both the script's best beats came
from it (a fix that saved only 9% became a running joke; a bug kept for the camera became a chapter). It is
worth what it points to, so every milestone names its commit and its files, and every number in it was measured.

## The log

```markdown
# Development log

The build's index. Read it first when resuming. Recordings in `devlog/recordings/`, screenshots in
`devlog/screenshots/`, shots for the video in `footage/<shot>/` (references: path, and a time range for a
recording).

## Status
| | |
|---|---|
| Stage | <what is being built now> |
| Waiting on the director | <the approval or answer, since when> |
| The video | <not started / script / production / done> |

## Decisions
| Date | Decision | Why |
|---|---|---|
| <yyyy-mm-dd> | <what was decided, by whom: "the director:" for theirs, in their words> | <the reason, or the evidence> |

## Versions and their role in the video
| Version | How to get it back | Role in the video |
|---|---|---|
| <the first look> | `?style=classic`, commit <hash> | <the before: shown as the first attempt> |

## Known issues
- <issue>: <where it shows, how to reproduce, why it is left>

## Next steps
- <the next build, with its cost in time>

## Timeline
Newest last. Each entry: the time (from the session's messages, not memory), what happened, the commit, the
artifacts.

### <yyyy-mm-dd hh:mm> — <what happened, in a line a script could use>
- <what was built or found, and how; what broke, why, the fix>
- Commit `<hash>`. Artifacts: `devlog/screenshots/<file>.png` (before), `devlog/recordings/<file>.mp4` 0:12-0:31
  (the bug), `footage/<shot>/` (after).
- Numbers: <measured, with how: "triangles 1.9 M → 0.31 M (stats panel, same seed)">
```

An entry worth having, from one of those builds (a block-world game; shortened):

```markdown
### 2026-10-13 ~16:35 — Greedy meshing only saved 9%
- What: in the first comparison of the three meshers, greedy drew 128K triangles against 141K for culled.
- Why: faces may only merge where their ambient occlusion matches, and every face beside a step has a gradient
  (2,366 of 3,953 faces on one column vary both ways).
- Fix: also merge along one axis where the corner values are constant along it: 77K against 127K (-39%), the
  same pixels.
- Screenshots: `devlog/foundation-05-mesh-*-wire.png` (each mesher, wireframe, same view).
```

The video turned it into a beat the director kept and sharpened, and when the bug was rebuilt for the
camera later its saving measured 22%, since the world had changed: a fragile state is filmed when it happens.

## The story ledger

A section at the end of the log, or `docs/VIDEO_NOTES.md` when it grows. Candidates, not decisions:

```markdown
## Story ledger
- **The director's beats**, verbatim, with the message's date: <"In the video, we can tell the story that this
  was your default art choice...">
- **Struggles:** <what broke, how it showed, how it was found, the fix> → <log entry>
- **Before and after:** <pair> → <how to film it: replay, flags>
- **Numbers worth saying:** <figure> → <how it was measured>
- **Joke ideas:** <an idea, as an option for the director to take, rewrite or drop>
- **Still missing for the video:** <a payoff not yet there to show, a stage without its before>
```

Times on screen (a timestamp on a "real bug" tag, the hour a stage was finished) are the director's call: the log
keeps them for the research, and the video asks before showing them.

## The AGENTS.md section

Beside init's section (outside `<!-- audara:begin -->` and `<!-- audara:end -->`, which init rewrites), so a later
session, a compacted one or another tool keeps the rules without this skill loaded:

```markdown
## Devlog

This project is a devlog: <the thing>, then a video about how it was built.
- Read docs/DEVELOPMENT_LOG.md first. Add to it as you go: decisions, what broke and the fix, commits, artifacts
  by path, measured numbers; the director's words that name a beat go in its story ledger, verbatim.
- Film now only what a change will erase (a first attempt, a bug before its fix, a look about to go). The rest is
  filmed later from replays (<how: the capture page, its command>).
- Stages the video will show stay recoverable: <flags, tags>.
- The director's gates: <the prototype approved before the script, the script before production, the render on
  their yes>.
- Long work gets a status line with the time left.
```
