---
name: devlog
description: "Keeps what a build will need for a video about it later: a development log (decisions and why, trade-offs, concepts worth explaining, bugs and their fixes, measured numbers, the director's words) and code whose stages run again at any size (an early look, a fixed bug, a demonstration), so the video films them at its final resolution. Use it whenever the user builds something with a video about it in view, now or later, even if they never say devlog or prototype: a game, simulation, explorer or tool they mean to show on their channel, a devlog or making-of, a prototype built before a video that shows it or its subject; and when building goes on in a project whose docs/DEVELOPMENT_LOG.md keeps such a log. Not for a build with no video in view, making, filming or rendering the video itself, including one about a project already built (code-video), ideas or a script alone (video-ideas), or tutorials and demos of finished software."
---

# devlog

Some builds end up in a video: a devlog about making it, an explainer that shows what it draws, a showcase
flown through it. The video comes later, often at another size (a 4K master), and much of a build's story is
gone once the next change lands. This skill keeps two things as the build goes, and does nothing about the
video itself: code-video makes that when it starts, filming what it needs at its final size.

1. **A development log** of what a video could use: decisions and why, trade-offs, concepts worth explaining,
   what broke and the fix, numbers measured, the director's words.
2. **Code whose moments run again:** an early look, a fixed bug, a demonstration, drawn again later at any
   size from a command the log keeps.

The thing can be anything a program does; nothing here assumes a game or a look. The director's words outrank
this skill: their order, gates and scope hold. Paths starting with `references/` are this skill's; the rest
are the project's.

## Start
- **Say it once,** in the first reply: you keep a development log and the stages a video may show runnable
  again, in a local git repository (one started if there's none; nothing pushed unless they ask), committing
  each such stage when it's reached. They can turn any of it off.
- **The log,** `docs/DEVELOPMENT_LOG.md` (references/log-template.md), and a "Devlog" section in AGENTS.md
  (outside init's markers) with the standing rules, so a later or compacted session, or code-video's, keeps
  them. For a build already under way, write the log from its history first.
- **Foundations sized to the thing,** before the first feature: added later, they mean hunting every hidden
  clock and hard-coded pixel (references/rerun.md).
  - The output size from a parameter, with layout, text and line widths in the thing's own units, so a stage
    draws at 4K rather than being enlarged.
  - Where timing changes the result (a game, a simulation): the state apart from what draws it, a fixed
    tick and seeded randomness.
  - A camera that reads the state and moves nothing in it.
  - One way to launch a given stage with given inputs at a given size: a URL's parameters, a command.

  A saved camera path may be all an explorer needs, and a fixture and a command all a tool needs.

## The log
An entry earns its place when a video could use it: a decision with its reason and the alternative turned
down, a trade-off, a concept the build makes visible (in a plain line a first-time viewer could follow), a
surprise, what broke (how it showed, why, the fix), a number measured with its method, a turn the director
gave the build. Most work needs no entry; it isn't a diary. Each entry has its time (from the session's
messages), its commit, and, for a moment a video may show, how to run it again. A number keeps its method and
revision: one fix measured 9% and, rebuilt later in a changed world, 22%, so the first is the one to quote.
Their words that turn the build go in verbatim; a joke for their voice is an option, never put in their mouth.

## Run it again
For each moment a video may show, the cheapest way back that survives the next change and keeps the code
clean (references/rerun.md):
- **A commit** and the command that runs it; a tag when the stage deserves a name (`stage/plain-bricks`).
  Try it from a clean checkout when it depends on files of its time.
- **A preset** (`?look=plain`) when the old look is a second view over the same state, a few lines, and
  wanted beside the new one.
- **Inputs as data:** a seed, inputs by tick, a camera path or a fixture, with an expected value or a hash
  of the state.
- **A bug** is fixed. To show it, the commit before the fix keeps it, with the smallest input that triggers
  it; log what each commit does with that input. A toggle in live code only when it's a line or two.
- **A capture** when that's better: keeping the moment runnable would clutter the code, or it won't come
  back (an outside service, a race, a glitch seen once, the director's live session). Take it while it's
  there, at the largest size practical, and log its path, size, time range and what it shows; a video at
  another size plays it enlarged where it's smaller.

Screenshots and clips to check your own work are fine; keep only those the log names.

## While building
- **Stages with an ETA,** said at the start and again when it slips. Hand off when the stage's own check
  passes: how to run it, what to look at, what's still short, the next builds with their cost.
- **One piece first:** a new look goes on one representative piece (a character, a level slice) and is
  shown before the rest is converted. An option sheet shows the runner-up, and a close call says so.
- **Trade-offs are theirs:** a check that blocks an impact they asked for, or a reviewer's change that
  narrows their ask, goes to them as a before and after, not settled inside.
- **Each version's role** goes in the log (the before, a rejected first look, the hero). When what makes it
  work well and what makes it show well pull apart, keep both runnable and ask.

## When the video starts
code-video makes it, reading the log as research and filming the stages from its commands at the render's
size (its references/filming-a-build.md); video-ideas writes a script alone. Keep the log while the build
goes on.

## Stays theirs
What to build and how far; the look picks; the escalation; the story beats they seed; jokes in their voice;
the final yes.

## Read when
- references/rerun.md: getting a moment back, by kind of thing; any size; captures; the checks.
- references/log-template.md: the log, its tables, the AGENTS.md section, an example entry.
