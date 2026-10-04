# Treatment template

A treatment is one video's plan: `videos/<video>/TREATMENT.md`, written before any scene exists and kept
current after. Show it to the director in a short message (with `out/<video>/window.png` and the click
track `out/<video>/clicks.m4a` when there is a song) and build on; scene authors, the critic and later
sessions all work from it, its Decisions first. The look every video in the project shares is in `docs/STYLE.md`
(`references/style-template.md`), so a treatment says only what this video adds or changes.

Everything here is a default. Drop what the piece doesn't need, add what it does, and when you depart from
a default that matters (a cut off the beat, a long hold, another format), say why in a line. `references/…`
and `<skill>/…` are this skill's files; every other path is in the project, where commands run.

Contents: Size it to the piece · Decide what's open, ask only what isn't yours · When the director brings
the plan · The skeleton · Choosing the song window · The storyboard · The sync map · Words on screen · Scene
briefs for scene authors · The commercial preset · Deliverables · Example: a 15-second pool reopening teaser

## Size it to the piece

The treatment grows with the piece, not with this template:

- **A loop, a sting or a title card (up to ~15 s): a few lines.** The idea in a sentence or two, the
  format, a timed line per moment, the look in a line (palette and typeface), what you assumed. A loop also
  says how it closes: its last frame leads back into its first. Its message fits in about 15 lines and
  250 words, the questions included, with Also considered in one line at most.
- **A spot or a short explainer (~15–60 s): about fifteen lines.** The idea, format and sound (a song
  window with its start and end times and why that part), a row per moment with its time, what's seen and
  its transition out (a hard cut says so), the moments that must land, and "never claim" when it states
  facts.
- **A whole-song music video, a long explainer, or anything several scene authors make at once: the
  whole skeleton,** with scene briefs. Length decides, not the kind of video: a 30-s cut of a song is a
  spot.

A short treatment goes into the message whole; for a long one, the idea, the song window and the storyboard
with its rows whole, transitions out included. Analysis numbers, file lists and status stay out of it.

## Decide what's open, ask only what isn't yours

Read everything the director gave (the request, files, a brand picture or URL, the song, a script) and
decide what it leaves open yourself, with the defaults below. Ask only what SKILL.md's Brief step says waits
for them: at most three questions, so one line can answer them, each with the default you'll use ("Where
will it play? Default: YouTube, 16:9, 1920×1080"), in the same message as the draft. Don't re-ask what the
request says.

| Open part | Decide when | Default |
|---|---|---|
| Which part of the song | the song is longer than the video | the window you'd choose on the music (below), with its reason |
| Format, platform, length | nothing says where it plays or how long it runs | 16:9, 1920×1080, 60 fps; a named platform sets the shape (Shorts, Reels, TikTok: 9:16, 1080×1920; a feed post: 1:1); the song's length, or the shortest that tells it |
| Lyrics on screen | the song has words | none; picture events can still land on sung words once their timings exist |
| Sound | the request has no audio and says nothing about it | music, and effects on the picture's actions, synthesized in code (free); a voice or generated music only after a yes, quoted with its cost, built meanwhile with a free stand-in; none when the director says silent or the piece plays muted (a feed loop, a stream background) |
| Brand assets | it's for a named brand, show, event or person | the name set in the style's type; no invented logo, tagline or label |

Anything you decide that the director didn't say (text they didn't give, their name restyled into
capitals, the format, the window, the music) goes in the **Assumed** line, where it can be vetoed. Then
build: the director steers in the preview whenever they like. When something does wait for them, the
message says what, the defaults you'll use, and that "go" takes them all.

## When the director brings the plan

A script, a shot list, a two-column A/V script or timecodes are the director's storyboard: keep their
words, order and times, a row per shot, and fill only what they leave open. A timecode they give as exact
(a client's cut, a broadcast slot) stays exact; a note by time ("at 0:23, on the snare") finds the event it
means (`references/motion.md`). A script too long for its length, a word the voice will stumble on, a shot
that can't work: say so with a fix and wait, rather than changing it. Spoken words go to the soundtrack
skill without the notes.

## The skeleton

```markdown
# <Title>

<The idea in one paragraph: what the viewer should feel or understand by the end, and the image that
carries it. Tie it to the words sideways rather than illustrating each line: the literal picture is the one
every video of this song or subject shows. If it rests on a transformation or two, name them without effect
names ("the receipt becomes the city map", not "a morph transition"); name the persistent actor if any.>
<Also considered: the style frames you didn't pick, a line each, when the look was yours.>

- **Format:** <w>×<h> (<ratio>) for <platform>, <fps> fps, <length: bars and seconds>; safe area per
  `docs/STYLE.md`.
- **Sound:** <the song window below | narration | none: no audio track>.
- **Look:** `docs/STYLE.md`<, plus what this video changes and why>; the style frame it came from.
- **Assumed:** <every decision the director didn't make; how their name is set counts: capitals, split over
  lines, two colours>.
- **Never claim:** <what would be false or unprovable here; how illustrative values are labelled>. (When
  the piece states facts.)
- **Preset:** commercial. (Only when the director chose it.)
- **Deliver:** <the standard set, plus what this video needs beyond it>.

## Song window
Song <m:ss.ss>–<m:ss.ss> = <n> bars at <bpm> BPM (<sections>) → video 0:00–<m:ss.ss>, cut as
`audio/<song>-window.wav`. <Why this part.> <How it ends, and what is sung there.>

## Storyboard
| Time | What the viewer sees | The moment's job | Transition out (what carries over) |
|---|---|---|---|

## Sync
<The three to six moments that must land, each with the data it comes from.>

## Words on screen
<How the words live in the picture.>

## Scenes
<A brief per scene: a line each when one author makes them all, the full form for several.>

## Decisions
<The director's decisions and notes in their words, dated, newest last, including what they turned down;
a budget and what has been spent. Read before every change.>
```

## Choosing the song window

A video shorter than its song plays a window of it, chosen on the music from the beats, downbeats and
section map of the whole song's analysis (the soundtrack skill writes it), not by counting seconds:

- **Start on a downbeat,** usually the first of a section or a phrase. If a sung pickup starts before it,
  start on the beat before the pickup's first word.
- **End on a downbeat, or with a fade that lands on one,** and check what is sung there (`words.json`):
  stopping inside a held word or a line sounds chopped even on the bar line.
- **Whole bars, then say the length.** A requested length is rarely whole bars: 30 s at 100 BPM in 4/4 is
  12.5 bars, so the window is 12 bars (28.8 s) or 13 (31.2 s). Choose by the phrase (most are 4, 8 or 16
  bars), tell the director the new length, and stay under a platform's hard cap.
- **Follow the section map.** Windows that begin and end on section boundaries cut best, and the storyboard
  changes where the sections change, so the picture moves most where the music does: a chorus entry, a
  drop, a breakdown.
- **Say why this part.** The strongest arc that fits (a build into a chorus, a breakdown into the last one)
  usually beats the song's first 30 seconds.

Scenes read `data/` in video time, so the window becomes the video's own audio and data, cut together to
the sample: a cut by hand drifts (an `-ss` seek lands about 20 ms off in AAC and drops an MP3's first
samples), and every time in the data has to move with it. One command of the soundtrack skill does both,
from the whole song's analysis, which it makes first when there is none (`<soundtrack>` is that skill's
folder, beside this one):

```
uv run <soundtrack>/scripts/beats.py window --video <video> --from <start> --to <end> [--fade <seconds>]
```

It checks the window on the music before it cuts: it reports the bars and sections it holds; moves an
end off the downbeats to the nearest one (`--exact` keeps it where you put it), so tell the director the
length it prints; and warns, with the fix, about a word, held note or line that an end cuts (naming the
nearest ends where nothing is sung, and, without lyrics, a voice it hears across an end). It writes
`audio/<song>-window.wav` and the window's `data/audio.json` and `data/words.json` in video time (bar 1 is the window's first downbeat),
keeps the whole song's data in `data/song/`, so another window is the same command with other times, and
draws both cuts in `out/<video>/window.png`. Then make the `video.json` edit it prints, `"audio":
"audio/<song>-window.wav"` with no `duration` (init writes it that way for a video set up after its
window): until then `render.ts verify` fails, because the data describes the window and the video plays
something else.

## The storyboard

One row per moment of the story, usually one to four bars. A scene, one module in `scenes/`, can play
several rows.

- **Time** in the music's terms, then the seconds they resolve to: `bars 5–8 · chorus 1 (0:09.60–0:19.20)`,
  `"who are you" (0:21.30)`. `timeline.ts` computes the seconds from the data (`bar(5)`,
  `cut('who are you')`), so they are a reading, not a setting. A silent piece can pace itself on a grid too
  (`bpm` in `video.json`), and music added later then fits the timeline. Times read as written: `1.5 s`
  or `0:01.50`, never `1:30` for 1.5 s.
- **What the viewer sees,** concretely: what is where, how big, what moves.
- **The moment's job:** what it tells, sets up or pays off. A row without one is filler.
- **Transition out:** how it hands over and what crosses the cut: an object, a shape, a colour, a direction
  of motion, a word. Name it, because the author on the far side has to pick it up (a shared pose,
  `references/motion.md`). A hard cut that carries nothing is fine when it's meant; say so.

Empty frames tend to appear at cuts, where one scene's exit meets another's entrance, so the storyboard
makes the first frame (often the thumbnail) and both sides of every cut finished compositions, and nothing
passes through an empty frame unless its row says so. Whether a fresh critic reads the storyboard before
anything is built depends on the piece: `references/critique.md`, "Cadence".

## The sync map

Every timed event comes from data: a typed number in a scene is a sync error waiting for the next edit. The
**Sync** section lists the three to six moments that must land exactly, each with its source, and the
critic checks them frame by frame. The sources (more in `docs/ENGINE.md`, "Data"):

- **Cuts** on downbeats, changing where the sections change: `bar(n)`, `audio.sections`. Around words, the
  example timeline's `cut('line')` (the last beat before the line) and `after('line')` (the downbeat
  nearest its end).
- **Hits** on the music's own events in `data/audio.json`: kicks and snares (`f.a.kick`,
  `audio.events('snare', t0, t1)`), a section's first downbeat. A detector written in a hurry for one scene
  misses: in one test, only a quarter of its hits landed within 35 ms of a kick.
- **Named moments** in music made for the video (a hit, a drop) are found by name, never typed: declared as
  cues or sections when the music is made, they are `audio.cue('hit')` or
  `audio.sections.find((s) => s.name === 'hit')`.
- **Words** found by their text, `words.get('line')` or `findWords('word')`. An event on a word lands at
  its `start`.
- **Continuous motion** on the grid or the sound: `f.beatPhase`, `f.barPhase`, `audio.env('drums', t)`.
- **Sound effects,** when the director wants them, are placed from the same times as the picture, so they
  move when the timeline does; a copied list of times doesn't.

## Words on screen

Words don't replace the picture. Unless the director wants type alone, the frame holds an image the words
live in; when type is the whole picture, its treatment is the image (it moves, steps, builds, breaks). When
sung or spoken words are on screen, as karaoke or captions:

- **Readable:** at or above the style's minimum size for the format, and on screen long enough to read.
  A line too long for its time is shortened or held longer; shrinking it only makes it unreadable sooner.
  Text that isn't sung (a title, a date) stays settled about a second per 15 characters, and at least
  ~1.5 s.
- **On the voice, never ahead of it:** a word appears or highlights at its `start` and is complete by its
  `end` (`Words.wordProgress`). Anticipation is fine (the line's next words shown dim up to ~0.4 s early),
  but a highlight that leads the voice reads as bad sync.
- **Title-safe,** and clear of the platform's buttons (`docs/STYLE.md`).
- **Cuts fall between lines** (`cut()`, `after()`): a cut inside a line makes the viewer find their place
  again. When the music forces one, the line keeps its place across it.
- **The displayed text is the data's** `w`, with typographic punctuation; narration spelled for the voice
  keeps what was said in `spoken`.

How the words live in the picture (riding a shape, typed, stamped, written by a pen, set into a scene,
set plainly) is the treatment's call.

## Scene briefs for scene authors

When several scene authors work at once (subagents on your own model: they make the picture), each scene
gets a brief that stands alone: its author reads it,
`docs/STYLE.md`, `docs/ENGINE.md` and this skill's `references/contract.md` and `references/motion.md`
(give their full paths), not the rest of the treatment. Scene authors edit only their own files and ask
the lead for engine changes.

```markdown
### `<id>` · <owner, e.g. B2> · bars <a–b>, <section> (<m:ss–m:ss>)
Files: `scenes/<id>.ts` and `scenes/<id>-*.ts`. <What it shows, row by row.> Must land: <its sync points>.
Receives: <what carries in, and the shared helper it comes from>. Hands over: <what carries out>.
```

The lead owns `timeline.ts`, `video.json`, `src/` and the helpers scenes share (`scenes/_<name>.ts`, named
exports only: a carried object's pose, a recurring motif), so no two authors edit one file; scene authors
ask the lead for changes there.

## The commercial preset

Off unless the director asks for punchy, commercial pacing. For an ad or a promo, offer it in the brief as
one option and say what it would change. A `Preset: commercial` line turns it on, and the critic then holds
the video to it, reading the QC report's holds (the frozen total and the longest hold) against these
numbers. It comes from commercials made under client review (motion-video-kit, MIT):

- no hold over ~0.6 s except the end card, and at most ~1 s of frozen time per 30 s; a hold that must be
  read gets a slow 3–5% push;
- the lead subject fills 60–85% of the usable frame in feature moments;
- 12–15 distinct compositions per 30 s (moments of 1.4–3.5 s), varying the scale: macro, wide, overhead,
  close-up, type; each lands readably, then leaves faster than it came;
- the end card or call to action readable at phone size for ~1.5–2 s.

Without it, holds and negative space are fair when they're meant: a music video may hold a frame for a bar.
Mark such a hold in its row, so the frozen time in the QC report reads as a choice.

## Deliverables

The render comes with its evidence in `out/<video>/`: the MP4, contact sheets with time labels (the whole
video, and `sheet --cuts`: frame 0, the last frame and five frames around every cut), a poster frame
(`render.ts poster`), the QC report (`<skill>/scripts/qc.py`) and the critic's verdict
(`references/critique.md`, "Delivery"). Keep it all: it is what the director checks and what a later
session compares against. Work-in-progress clips (`--draft`) need none of it. The **Deliver** line adds
only what this video needs beyond that, such as another format, a 4K master (`--scale 2`) or captions.

## Example: a 15-second pool reopening teaser

The request: "a 15 s Reel for the Lindell Pool reopening, the upbeat part of our summer track, the info's on
the poster", with `lido.mp3` (licensed by the parks department) and the poster, from which `docs/STYLE.md`
was written. A piece this size gets about fifteen lines:

```markdown
# Lindell Pool reopens

Summer starts when the cover comes off: the pool's winter cover, seen from above, peels away on the drums to the water that carries the rest.

- **Format:** 1080×1920 (9:16) for Instagram Reels, 60 fps, 8 bars = 15.48 s.
- **Sound:** `lido.mp3` 0:15.79–0:31.28, bars 9–16 at 124 BPM, where the drums come in (15 s is 7.75 bars; the phrase is 8), instrumental, cut as `audio/lido-window.wav` with a one-bar fade. No effects.
- **Look:** `docs/STYLE.md`, from the poster; only the light on the water glows.
- **Assumed:** that window for "the upbeat part"; the logo as given, on the last bar; no text beyond the poster's.
- **Never claim:** what the poster doesn't say (hours past "7 am", prices). On screen: "Reopens 14 June · 7 am", "Lindell Park".

| Time | What the viewer sees | The moment's job | Transition out |
|---|---|---|---|
| bar 1 · 0:00 | The cover edge to edge, a corner curling | A finished frame asking what's under it | The curl carries on |
| bars 2–3 · 0:01.94 | The cover peels back on each snare; tiles and light beneath | The pool is back | Cut on bar 4: the peel's last edge is the first rope |
| bars 4–5 · 0:05.81 | Ropes snap across, one per beat; "Reopens" rides the top one | Name the event | The ropes slide out |
| bars 6–7 · 0:09.68 | "14 June · 7 am" rises through the water and holds | The fact, legible 3.4 s | The water stills on bar 8 |
| bar 8 · 0:13.55 | Still water, the logo, "Lindell Park"; the music fades | Who and where | Ends with the fade |

Scenes: `peel` (bars 1–3), `pool` (bars 4–8); both draw the water and first rope from `scenes/_water.ts`.
```
