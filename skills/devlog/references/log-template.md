# The development log, the ledger and the standing rules

`docs/DEVELOPMENT_LOG.md` is the build's index: a later session reads it before anything else, and when a
video starts, code-video reads it as research and films its moments from the commands it keeps. Both devlogs
this skill comes from kept one, and in both the script's best beats came from it (a fix that saved only 9%
became a running joke; a bug kept for the camera became a chapter). It is worth what it points to, so every
entry names its commit, every moment a video may show says how to run it again, and every number in it was
measured.

## The log

```markdown
# Development log

The build's index. Read it first when resuming. A video about this build is planned (<a devlog, an
explainer that shows it, a showcase: what the director said>); it will film the moments below from their
commands, at its own size. Captures, where a run wasn't the better way, in `devlog/captures/`.

## Status
| | |
|---|---|
| Stage | <what is being built now> |
| Waiting on the director | <the approval or answer, since when> |
| The video | <planned / started (code-video) / done> |

## Run it again
How to get back each moment a video may show. Checked at each milestone.
| Moment | How to run it | Commit or tag | Sizes it takes | Role in a video |
|---|---|---|---|---|
| <the first look> | `?look=plain&replay=replays/level1.json&w=<w>&h=<h>` | `stage/plain-bricks` | any (from the parameters) | <the before> |
| <a bug before its fix> | `bun run sim --seed 41 --to 900` | `bug/tunneling-before` | any | <a struggle beat> |
| <a glitch seen once> | capture: `devlog/captures/<file>.mp4` 0:03-0:07 | <commit> | 1920×1080 only | <the moment it broke> |

## Decisions
| Date | Decision | Why |
|---|---|---|
| <yyyy-mm-dd> | <what was decided, by whom: "the director:" for theirs, in their words; the alternative turned down> | <the reason, or the evidence> |

## Known issues
- <issue>: <where it shows, how to reproduce, why it is left>

## Next steps
- <the next build, with its cost in time>

## Timeline
Newest last. Most work needs no entry: one earns its place when a video could use it. Each entry: the time
(from the session's messages, not memory), what happened, the commit, and how to run it again when it's a
moment to show.

### <yyyy-mm-dd hh:mm> — <what happened, in a line a script could use>
- <what was built or found, and how; what broke, why, the fix; the alternative turned down>
- Commit `<hash>`. Run again: <the "Run it again" row>.
- Numbers: <measured, with how: "triangles 1.9 M → 0.31 M (stats panel, same seed, commit a41c0d2)">
```

An entry worth having, from one of those builds (a block-world game; shortened, with its run line as this
skill now writes it):

```markdown
### 2026-10-13 ~16:35 — Greedy meshing only saved 9%
- What: in the first comparison of the three meshers, greedy drew 128K triangles against 141K for culled.
- Why: faces may only merge where their ambient occlusion matches, and every face beside a step has a gradient
  (2,366 of 3,953 faces on one column vary both ways).
- Fix: also merge along one axis where the corner values are constant along it: 77K against 127K (-39%), the
  same pixels.
- Run again: `?mesher=culled|greedy&wire=1&seed=7&w=<w>&h=<h>`, the 9% at `stage/greedy-9pct`, the fix after it.
```

The video turned it into a beat the director kept and sharpened, and when the bug was rebuilt for the
camera later its saving measured 22%, since the world had changed: the number quoted is the one measured
when it happened, and the stage is got back from its commit, not rebuilt in today's world.

## The story ledger

A section at the end of the log, or `docs/VIDEO_NOTES.md` when it grows. Candidates, not decisions:

```markdown
## Story ledger
- **The director's beats**, verbatim, with the message's date: <"In the video, we can tell the story that this
  was your default art choice...">
- **Struggles:** <what broke, how it showed, how it was found, the fix> → <log entry, its "Run it again" row>
- **Before and after:** <pair> → <the two rows that show it>
- **Concepts worth explaining:** <the idea, in a line a first-time viewer could follow> → <where the build shows it>
- **Numbers worth saying:** <figure> → <how and when it was measured>
- **Joke ideas:** <an idea, as an option for the director to take, rewrite or drop>
- **Still missing for a video:** <a payoff not yet there to show, a stage without its before>
```

Times on screen (a timestamp on a "real bug" tag, the hour a stage was finished) are the director's call: the log
keeps them for the research, and the video asks before showing them.

## The AGENTS.md section

Beside init's section (outside `<!-- audara:begin -->` and `<!-- audara:end -->`, which init rewrites), so a later
session, a compacted one or another tool keeps the rules without this skill loaded:

```markdown
## Devlog

<The thing> is being built for a video about it (<what kind>), made later with code-video.
- Read docs/DEVELOPMENT_LOG.md first. Add to it what a video could use: decisions and why, trade-offs,
  concepts worth explaining, what broke and the fix, measured numbers with their method, commits; the
  director's words that turn the build go in its story ledger, verbatim.
- Moments a video may show stay runnable at any size: <the launch: its parameters or command>, listed in the
  log's "Run it again" table with their commit or tag; check them at each milestone. A capture only where it's
  the better way, logged with its size.
- The output size comes from a parameter; nothing is laid out by the window's size.
- Commits stay local unless the director asks to push.
- The director's gates: <what they set, e.g. the prototype approved before any video work>.
- When the video starts, code-video films these moments from their commands at the render's size (its
  references/filming-a-build.md).
- Long work gets a status line with the time left.
```
