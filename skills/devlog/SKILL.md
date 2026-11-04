---
name: devlog
description: "Makes a devlog: builds something worth watching being built (a game, a physics simulation, a fractal explorer, a visual tool, any prototype) while keeping what makes its making a story (a development log, the director's turns, before and after, real bugs, demonstrations that can be filmed again), then hands that material to code-video for the video about how it was made. Use it whenever the user wants a devlog or a making-of video, asks to build something and then a video of how it was built (even when the build comes first and the video much later), or wants a video about how a project of theirs was built, and in any project whose docs/DEVELOPMENT_LOG.md feeds a video. Not for building something with no video in view, tutorials, product demos or screen recordings of finished software, videos that only show code (code-video), or ideas alone (video-ideas)."
---

# devlog

A devlog is two works: the thing built, and a video about building it. Its story happens during the build (first
attempts, bugs, the director's turns, the stages the thing passes through) and much of it is gone once the next
change lands. This skill covers the build and what it keeps; code-video makes the video and soundtrack its sound,
by their own steps, once the video starts. The thing can be anything a program shows; nothing here assumes a
game, an engine or a look. The director's words outrank this skill: their order, gates and scope hold, whether
they build first, script while building, or bring a project already built. Paths starting with `references/` are
this skill's; the rest are the project's.

## What carries one
- **The thing is the show:** real behaviour from its own code, filmed at its best, explained by what it visibly
  does.
- **Real struggles are the beats:** what broke, why, the fix, with its before and after.
- **Any moment can be filmed again:** repeatable demonstrations and recoverable stages make late notes cheap.
- **The director's turns are turning points:** a reaction, an ask to go further. Their jokes and lines are theirs.

## Start
One message, each point with the default you'll take, then start; wait only for what they alone can decide:
- what gets built, the scope they will judge ("both levels playable start to finish") and where it runs;
- a working promise: a title and a thumbnail idea, provisional (youtube-package makes the final ones);
- the order and gates (default, when they set none: a first look early, the prototype approved before the script, the script before
  production, the render on their yes);
- their own material: the music library and what each track is for, characters or props from earlier videos and
  where they are, their photo, the narrator's voice, how far the video may tease them;
- a repository now (video-repo) or later.

## Setup
- The prototype in its own folder (`game/`, `sim/`, `app/`), or a project already built as it is; the video
  project (code-video's init) at the root when the video starts.
- `docs/DEVELOPMENT_LOG.md` (references/log-template.md): status, decisions and why, known issues, next steps,
  and a timeline whose milestones carry their commit, artifacts by path and time range, and times from the
  session's messages. For a project already built, write it from its history first.
- Its story ledger: the director's words that name a beat, verbatim; what broke, how it was found and fixed;
  before and after pairs; numbers measured, not estimated; joke ideas as options, never written into their mouth.
- A "Devlog" section in AGENTS.md (outside init's markers) with the standing rules, so a later or compacted
  session keeps them.
- A way to film it again, sized to the thing (references/capture.md): for a game or a simulation, a fixed tick,
  seeded randomness and replays; for an explorer, the camera path as data; for a tool, scripted input. Set it up
  before the first feature: determinism added later means hunting every hidden clock. A project already built
  lists what it has first (recordings, history, tags) and adds only what the shots need.

## Build
- **Stages with an ETA,** said at the start and again when it slips. Hand off when the stage's own check passes:
  how to run it, what to look at, what's still short and the next builds with their cost. Checks that only
  polish run on while they look.
- **One piece first:** a new look goes on one representative piece (a character, a level slice) and is shown
  before the rest is converted. An option sheet shows the runner-up, and a close call says it was close.
- **Trade-offs are theirs:** a check that blocks an impact they asked for, or a reviewer's change that narrows
  their ask, goes to them as a before and after, not settled inside.
- **Each version's role in the video** goes in the log (the before, a rejected first look, the hero), and polish
  follows it. When what makes it work well and what makes it show well pull apart (a help text on a title, a
  limit that tidies a spectacle away), film both and ask.
- **Film now only what a change will erase:** a first attempt, a bug before its fix, a look about to go, anything
  that can't be reproduced later. The rest is filmed later, at final quality, against the script. A stage that
  will be shown stays recoverable (a flag, a style switch, a tagged commit).

## Enough for the video
Each milestone's hand-off says what the video could already be and what it still lacks, concretely: the
promise's payoff is there to show; the stages a viewer would watch change have their before and after; there is
footage for the struggles and for the mechanisms worth explaining. When their scope is met, say so and offer the
script, naming what one more stage would add. They decide: another "push further" may be the beat they want.
Don't stop short of their scope, and don't widen it silently.

## The video
- **The script** comes from the log and the ledger, through code-video's treatment (its Promise, Never claim and
  Decisions), or video-ideas when they want a script alone; their gates hold. The log is the research, not the
  outline: keep the turns that carry the promise, with their setups and payoffs; most entries stay out. On a long
  narrated piece, voice and roughly cut its least certain passage first and post it while building on.
- **Story order:** a stage appears first in the chapter that builds it, unless the story is told out of order on
  purpose (the treatment's Stage column); the hook may glimpse the payoff briefly and borrow later shots.
- **The picture shows the line** where a line asks the viewer to see something happen: footage of it happening,
  filmed for it. Reactions, metaphors and counterpoint stay open.
- **Explanations a first-time viewer can follow:** one subject, a concept defined before it's used, one idea per
  line, drawn as it is said (code-video's critic restates each one).
- **Their lines verbatim,** their persona as they set it; a joke for their voice is offered with options.
- **Provenance:** a claim, a number or a re-staged bug cites its log entry, the build and its settings.
- **Footage** enters through the engine's streamed footage (code-video's contract.md, "Images and footage").
- Then code-video and soundtrack as usual (carry the respellings approved before; test words the voice may
  miss). nutlight-style only when named: its look is for the scenes around the footage, and the thing keeps its
  own. youtube-package on request. video-repo keeps the recordings, screenshots and captures of old stages as
  sources.

## Stays theirs
What to build and how far; the look picks; the escalation; the story beats they seed; jokes in their voice; how
they appear on screen; the final yes.

## Read when
- references/capture.md: filming a game, a simulation, a math explorer or a tool again: replays, shot folders and
  manifests, footage in the video, the checks.
- references/log-template.md: DEVELOPMENT_LOG.md, the ledger and the AGENTS.md section, with an example entry.
