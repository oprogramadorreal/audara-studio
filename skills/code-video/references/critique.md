# Critique: the loops, the critic, the measured checks

How the work gets checked: the director's preview, your own stills, a fresh critic and the numbers.
Commands run in the project folder; `<skill>` is this skill's folder, so `<skill>/scripts/qc.py` is the
skill's script and `scripts/render.ts` the project's. The cadence, the bars and the prompts are defaults:
change them when the piece needs it, and say why.

Contents
- The director's loop
- Your stills loop
- The critic (cadence, ledger)
- Critic prompts: the tools block, storyboard, scene, full cut, verification
- Measured checks: `render.ts verify` and `qc.py`
- Delivery

## The director's loop

The preview is where the video gets directed: the director watches, points at a time and asks for a
change. Make it, check it (next section), and answer with a link to the moment: the preview's address
with `?v=<video>&t=<seconds>`. Link the moment itself for a note about a frame; for motion, a cut or a
transition, about half a second before it, so it plays into the change; after moving a cut, link both
sides; when a change moves where a passage ends, link that end too. In the preview, `c` copies the link to what's on screen. This rule is fixed, not a default: a link
is how the director checks your change in seconds instead of hunting for it.

A note can read two ways ("it comes in too fast": too soon, or too quick). Make the likelier change, say
which reading you took and offer the other in a line. A change that moves something the director set or
approved (the length, a cut on a word, a hold the treatment promises) says so, offers the version that
keeps it, and says what else you retimed to make room.

A note doesn't need a render: the preview is the answer, and a render costs minutes of waiting. After the
first build's MP4, render when the director asks.

## Your stills loop

Inside the director's loop runs yours: render the moments a change touches, look at the PNGs, fix, look
again. Most of the quality comes from it. Three habits make it catch what usually slips through.

**Look as a viewer, not as the author.** Before hunting defects, ask of each sheet whether a stranger
would watch it to the end, and again. Frames that read as slides (type, boxes and icons on an empty ground), a
picture that illustrates each line literally, or one that changes by the same amount where the music
turns, are worth fixing before any critic sees them, unless the director's words call for it.

**Look where videos break, not where they've settled.** A frame in the middle of a beat shows the scene
doing what it was written to do. Defects sit at the edges: a scene that starts a few frames late, a
title that fades in from nothing at every cut, an entry that ends before the next one begins.
Self-checks that sampled only mid-beat moments have shipped exactly these. So, besides the moments you
choose:

- every cut, frame 0 and the last frame: `bun scripts/render.ts sheet --video <video> --cuts` renders a
  sheet (a contact sheet, each frame labelled with its time and scene) of frame 0 and the last frame,
  then a row per cut: 0.1 s before, the frame before, the cut frame (where a late start shows), the
  frame after, 0.1 s after. For the sheet a cut is any time an entry starts or ends, so a crossfade
  gives two rows. A feed shows frame 0 before anyone presses play, and a loop jumps from the last frame.
  `--times` adds moments of your own to the same sheet;
- for a note, the same times before and after the change (`sheet --times`), so the pair shows what moved
  at the moment the note names;
- every frame through a crossfade or a transition: `sheet --from <a> --to <b> --n <(b - a) x fps + 1>`;
- the moments the treatment ties to the sound (a hit, a word, a title landing), at the times in the
  data, not from memory;
- after a fix, the cuts next to it: fixes move things into other things.

**Keep the evidence and show it.** Sheets and stills stay in `out/<video>/`, which isn't committed and
costs nothing. Name them per check (`--out out/<video>/sheets/intro-r2.png`) so the next one doesn't
overwrite them, put their paths in your reply, and don't clear them out at the end: they are the
director's view of what you checked, and without them a reply is only claims. Scripts and data you write to
check go in `.audara-cache/`, never `out/`.

- A sheet is scaled down when you look at it whole, and past about 2000 px a side its thumbnails stop
  being readable. So `sheet` gives every thumbnail the same area whatever the frame's shape (480×270 for
  16:9, 270×480 for 9:16, 360×360 for square), puts as many columns on a page as fit, and carries on in
  `-2.png`, `-3.png`: about 24 frames to a page. A `--cuts` row holds a cut's five frames, so there 16:9
  thumbnails shrink to 383×215. Look at every page it lists.
- A thumbnail is about what a phone shows; check type sizes on full-size stills against the minimums in
  `docs/STYLE.md`.
- Stills can't show motion. Pace, smoothness and one-frame pops show in a clip
  (`bun scripts/render.ts video --video <video> --from <a> --to <b> --draft --out out/<video>/wip/<clip>.mp4`:
  one sub-frame per frame and a fast encode), in `qc.py` run on it, and in the director's preview, which
  is theirs to watch: check motion with clips, not by driving their browser or desktop (a background tab
  skips frames). Say which you used.

## The critic

You know what you meant, so that's what you see; a critic that starts empty sees only what's on screen.
A reviewer that inherits your conversation inherits your blind spots: in testing, one forked from the
session that built the video passed it after looking at one frame and an eight-frame sheet.

- **Fresh every round.** Start a new subagent with an empty context, none of this conversation, whose
  whole task is one of the prompts below, filled in. Some tools copy the conversation into a subagent
  unless told not to (in Codex, set `fork_turns` to `"none"`): ask for an empty one, whose first message
  is the filled prompt and nothing else. If you can't start one, run the prompt in a new non-interactive
  session of your CLI. Wait for its report before you go on or end your turn: a critic started in the
  background is lost if the turn ends first, and its findings with it. Looking at your own work again is a stills check, not a critic round: call it that.
- **It gets** the treatment, `docs/STYLE.md`, the director's own words (the brief and every note,
  quoted from the treatment's Decisions, not summarized), facts about the work (paths, size, fps, duration, scene ids and windows,
  cut times, the timing data) and the commands to render what it wants. In a verification round, the
  earlier reports too. With another backend, give it that backend's commands for stills and clips;
  `qc.py` works on any MP4.
- **It never gets** your reasoning, what you changed, what you believe is fixed, or your sheets. Each
  of those tells it where to look and what to conclude.
- **It picks its own frames:** sheets at times it chooses, every frame around every cut, frame 0 and the
  last, and `qc.py` on renders. It writes under `out/<video>/critique/r<N>/` and changes nothing else.
- **Findings come ranked,** each with its time and place in the frame, the evidence (the image or the
  number that shows it), why it matters to the viewer or against the director's words, and a fix that
  can be made in code.
- **Verification.** Fix what's worth fixing, then start a new critic with the new render and the earlier
  reports. It marks every earlier finding FIXED, PARTLY or STILL PRESENT, hunts for regressions around
  them, and ends with SHIP or ONE MORE PASS (at most three fixes).
- **Stop** at SHIP, when what's left is cosmetic (sub-frame; a weak picture is not cosmetic when the
  look was left to you), or when the director says so, not after a set number of rounds (but one turn holds at most a full-cut
  round and one verification). After SHIP, what's left goes to the director as open findings, not into
  the picture: a change after the last round is reviewed at delivery (Delivery, step 6). The director
  outranks the critic: a finding that goes against their words is reported, not acted on. A choice only
  the treatment argues for (a hold for "reading time", a plain look) still has to work on screen.
- **Cadence,** scaled to the piece rather than to its number of scenes:
  - a storyboard round before building, for a long piece or one several scene authors build at once,
    when changing the plan is cheapest;
  - a scene round when separate authors make the scenes (or one round per few scenes);
  - a full-cut round on a `--draft` render of the whole video before you call it done, then one
    verification round after its fixes. Then the director gets the sheets and the findings still
    open (they have had the preview link since setup, and watch while the critics work), and any further
    round follows their notes. The first build then ends with its render (Delivery); later renders wait
    for their word.

  A short piece you build alone gets the full-cut round and its verification. Not after every edit:
  notes go through your stills loop and the preview.
- **The ledger** is `videos/<video>/CRITIQUE.md`, a row per round, so a later session sees what was
  found, what changed, what was left and why:

| Round | Reviewed | Top findings | Changes | Measured |
|---|---|---|---|---|
| 3 full cut | out/teaser/teaser.mp4 | 0:18 three empty frames before the end card; 0:04-0:09 nearly frozen | the end card overlaps the last scene by 0.3 s; kept the 0:04 hold (the treatment's pause before the drop) | blank at cuts 1 → 0 |

## Critic prompts

Fill in the `<slots>`, paste the tools block where a prompt says `<tools>`, and send each prompt to a
fresh critic. Keep your own reasoning out of them.

The tools block:

```text
You judge; you don't fix. Work in <project>. Stills, sheets and your report go under
out/<video>/critique/r<N>/; any script or data you write to measure goes under .audara-cache/critique/r<N>/.
- Stills, full size, to crop into: bun scripts/render.ts stills --video <video> --t 0,4.5,12 --out out/<video>/critique/r<N>
- A sheet at times you choose, each frame labelled with its time and scene:
  bun scripts/render.ts sheet --video <video> --times 1,2.5,4 --out out/<video>/critique/r<N>/<sheet>.png
- Every frame of a stretch: sheet ... --from 17.8 --to 18.2 --n 25 (at <fps> fps, n = (to - from) x fps + 1)
- Frame 0, the last frame and every cut, a row per cut (0.1 s before, the frame before, the cut frame,
  the frame after, 0.1 s after): sheet ... --cuts, with --times for more on the same sheet. The cut
  times: <cuts>.
- One scene alone (the rest renders black): add --only <entry id> (its id in the timeline).
- A clip, for motion: bun scripts/render.ts video --video <video> --from 10 --to 14 --draft --out out/<video>/critique/r<N>/clip.mp4
- Measured checks on any MP4 (holds, blank frames, loudness, color tags):
  uv run <skill>/scripts/qc.py <mp4> --cuts out/<video>/verify.json   (on a clip, add --offset <its --from>;
  only if uv can't write its own cache, set the environment variable UV_CACHE_DIR to .audara-cache/uv,
  never a folder under out/)
- The timing data: videos/<video>/data/audio.json (beats, downbeats, sections) and data/words.json (timed lines).
About 24 frames fit a sheet; a longer one goes on in <sheet>-2.png, <sheet>-3.png: look at every page.
Check type sizes on full-size stills.
```

**Storyboard**, before anything is built:

```text
Review the plan for a video before it is built. You didn't write it: judge it against what the director
asked for, not against what its writer meant. Read <project>/videos/<video>/TREATMENT.md, docs/STYLE.md
and the timing data in videos/<video>/data/, if any. The director's words: "<verbatim>".
Check:
- Does the structure follow the sound? Rows should change where the music's sections or the narration's
  lines change, and cut on downbeats or between lines. Name the rows that don't, with times from the data.
- Has every row its own composition and job? Which rows are filler?
- What carries across each cut? Does any row start or end on an empty frame, the first and last included?
- Is every claim, number and diagram true or labelled, and is nothing claimed that the treatment rules out?
- Are the format, length, sound and type size what the director asked for, where it will be watched?
- Does the look come from this brief, or is it what any video like it would get? Will it make something a
  viewer remembers? Name the rows that would read as slides or as the literal illustration of their words,
  unless the director asked for that.
- Where the treatment argues for a departure (an off-beat cut, a long hold, a uniform drift), judge
  whether it works, not whether it follows the default.
Reply with a ranked list, most important first: row or time, the problem, why it matters to the viewer,
one concrete fix. Under 400 words; also write it to out/<video>/critique/r<N>/storyboard.md.
```

**Scene**, when one is done:

```text
You are an independent critic; you didn't build this scene. Judge rendered pixels and measured numbers,
not intentions. Video <video>, <W>x<H> at <fps> fps. Scene <id>, <start>-<end> s. Its brief, from the
treatment: "<verbatim>". The director's words: "<verbatim>".
<tools>
Pick your frames: the scene's first and last, every frame through its entrance and exit, the moments its
brief ties to the sound (times from the data), and whatever a sheet makes you doubt. Crop full-size
stills into type, edges and fine lines.
Check: legibility at the delivery size; kerning and collisions; one-frame pops (something leaving rest
at full speed); holds the brief doesn't ask for; shimmer on thin lines; empty or near-black frames at
its edges; events landing on their beat or word, in frames; whether it does its brief's job in the
treatment's look rather than a default one, and whether it is striking or only correct. Where the treatment argues for a departure (an off-beat cut,
a long hold, a uniform drift), judge whether it works, not whether it follows the default.
Report, under 450 words, also to out/<video>/critique/r<N>/<id>.md: KEEP / REVISE / REJECT; defects by
severity, each with time, place in the frame, evidence, why it matters and a fix in code; the three
fixes worth most.
```

**Full cut**, the whole video rendered:

```text
You are an independent, demanding critic of a finished video; you didn't build it. Judge rendered pixels
and measured numbers, not intentions. Artifact: <project>/out/<video>/<file>.mp4 (<duration> s,
<W>x<H>, <fps> fps, <with sound | silent>). It is for: <one line from the treatment>. The director's
words, which bind: "<verbatim>". Treatment: videos/<video>/TREATMENT.md; look: docs/STYLE.md.
<tools>
Run qc.py on the MP4 first. Then sheets of the whole video (about five frames a second for a piece under
a minute, a frame per beat or bar for a longer one), every frame through each cut and transition, frame 0
and the last, full-size stills wherever a sheet raises a doubt, and a clip or two for motion.
Where the treatment argues for a departure (an off-beat cut, a long hold, a uniform drift), judge whether
it works, not whether it follows the default. Hold the look against the Avoid lists in docs/STYLE.md and
<skill>/references/style-template.md: an archetype from them that the director didn't ask for and the
treatment doesn't argue for is a finding; one marked (director) never comes back, whatever is argued.
Report, under 900 words, also to out/<video>/critique/r<N>/full.md:
0. As a viewer, in two lines: would it hold a stranger's attention to the end, and why? Unless the
   director's words set that part of the picture, or the treatment's idea calls for restraint, a picture
   that reads as slides or a template (the same layout in every scene, a headline beside or above a
   diagram; one composition held for the whole piece; captions over a background any song could have),
   that illustrates a song's words literally, that ignores the music's changes, or that any video on this
   subject would have, is a top finding with a fix in code, not taste.
   Glow, depth or a camera move added to a weak idea is not a fix; restraint that is the idea still has
   to hold attention.
1. Per scene: time range, what's on screen, its problems ranked.
2. Against the sound: does the picture change where the music or narration does, and do hits land on
   their beat or word (how many frames off)?
3. Transitions and layout: empty or blinking frames at cuts, collisions and near-collisions (unrelated
   lines closer than about a third of their type size), marks an offset copy or a glow adds to letters
   (two i-dots read as ï), a carried element that jumps,
   type too small for where it will be watched or outside the format's safe area (the Layout tables in
   <skill>/references/style-template.md, checked on full-size stills), frame 0, the last frame.
4. Holds and pace: each hold qc.py reports that the treatment doesn't mark is a finding, not taste (its
   time, its cause in code, a fix); so is each stretch its glance line calls still at a glance, and any
   stretch where only a detail moves.
5. The numbers: loudness against the treatment's target, color tags, duration.
6. The top 6-8 changes by impact on what a viewer sees, concrete enough to make in code.
End with SHIP or ONE MORE PASS. Be blunt; no padding.
```

**Verification**, after fixes:

```text
You are an independent critic; you didn't build this or write the earlier reports. Artifact: <the new
render, or the scene>. Earlier reports: <paths>. <If timings moved: the new cuts or sections.> The
director's words: "<verbatim>".
<tools>
For every finding in the earlier reports, give FIXED / PARTLY / STILL PRESENT, with the time and the
image or number that shows it. Then hunt for new defects, first around the earlier findings, where the
fixes went in: glitch frames, overlaps, clipped text, empty frames at cuts, sync drift. <If a moment
matters most: Check <the hit, the word> at <time>.> A finding the treatment argues for stays a note,
not a defect.
Report, under 500 words, to out/<video>/critique/r<N>/verify.md, ending with SHIP or ONE MORE PASS (at
most three fixes, ranked).
```

## Measured checks

**`bun scripts/render.ts verify --video <video>`**, before each critic round and before the final
render. It renders every word, cut and half second; reports scene and browser errors, the soundtrack's
length against the timeline and any gap between scenes; and checks determinism: the same frame reached
by different seeks must come out pixel-identical. That last check guards the rule everything here rests
on (every frame is a function of `t`). When it fails, the preview and the render disagree, and the
message names the scene and the time. It writes `out/<video>/verify.json` and exits with 1 on failure;
fix that before anything else.

**`uv run <skill>/scripts/qc.py <mp4> --cuts out/<video>/verify.json`**, the QC report, on every render,
whether from this engine, HyperFrames or Remotion (`--json` for JSON, `--out <file>` to keep the report,
`--offset <s>` for a clip that starts `s` seconds in). It reports:

| | What it measures | Default bar |
|---|---|---|
| holds | frozen (nothing visibly changes) and nearly frozen (under 0.5% of the frame moves) stretches of half a second or more, measured so that grain can't hide a hold and a moving hairline isn't counted as one | no hold the treatment doesn't call for (the commercial preset's numbers are in `references/treatment-template.md`) |
| glance | stretches of 1.5 s or more where under 2% of the frame visibly changes at a glance: moves under about 8 px, sway, grain and words changing colour in place don't count, so a picture that only breathes reads as still | none the treatment doesn't call for; a lyric or narrated piece that reads still most of the time is a finding even with no holds |
| blank frames | near-black and near-empty ranges, flagged at a cut, at t=0 and at the end | none at a cut; frame 0 a finished composition, unless the piece fades in on purpose |
| loudness | integrated, range, true peak, short-term per second, first and last sound | about -14 LUFS for punchy pieces and -16 for calm ones (platforms play online video at about -14, as of 2026); true peak at or under -1 dBTP; sound as long as the picture |
| stream | size, fps, frames, codec, pixel format, bitrate, color tags | tagged BT.709, yuv420p, the planned length to the frame |

These are reports, not gates. A music video can hold still on purpose, and a title card can rise out of
black: when a number misses its bar, fix it or say in a line why it's meant ("the 2 s hold at 0:12 is
the breath before the drop"). The last line of the report, `look at`, lists times worth a sheet
(`--times`). Loudness is fixed in the mix, with the soundtrack skill, not in the picture.

## Delivery

At the end of the first build (unless the director wants to watch the preview first), and later whenever
the director asks for a render:

1. `bun scripts/render.ts verify --video <video>`, passing.
2. `bun scripts/render.ts video --video <video>` → `out/<video>/<video>.mp4`, and wait for it before you
   reply: it takes minutes, often past a tool's time limit for one command (then run it in the background
   and check on it until it ends), the reply needs its result, and a render still running when your turn
   ends can die with the session. It renders with adaptive motion blur by default (`docs/ENGINE.md`,
   "Motion blur and sampling"; with a `stateful` scene on screen it takes a fixed 12 sub-frames,
   `--samples <n>` for another count; `--scale 2` gives 4K). A `--draft` is never the delivery.
3. `uv run <skill>/scripts/qc.py out/<video>/<video>.mp4 --cuts out/<video>/verify.json --out out/<video>/qc.json`
4. Sheets labelled with times: the whole video
   (`bun scripts/render.ts sheet --video <video> --n 24 --out out/<video>/sheet.png`) and frame 0, the
   last frame and the frames around every cut (`sheet --video <video> --cuts --out out/<video>/sheet-cuts.png`).
5. A poster, the frame that best stands for the video, rendered as the video renders it:
   `bun scripts/render.ts poster --video <video> --t <t>` → `out/<video>/poster.png`
6. The critic's verdict on this render: the last round's. A picture changed after that round gets a new
   full-cut round, unless this turn already ran a full-cut round and its verification: then give that
   verdict and list the fixes made since as not yet reviewed.

The reply gives the director, every time (also when the MP4 already existed or another size was made),
the MP4, the sheets and the poster (their paths); the QC report's numbers in
two or three lines, with a `?t=` link to anything flagged; the critic's verdict and the findings left
open; and what wasn't checked ("measured, not listened to"; "sampled frames, not every frame"). Every
claim in it comes from a check that ran: "lands on the beat" means someone looked at the frame on the
beat.

---

The critic protocol and its prompts are adapted from motion-video-kit (MIT, (c) 2026 echris6,
https://github.com/echris6/motion-video-kit), which follows the Gauntlet Loop
(https://somethingbig.ai/gauntlet-loop).
