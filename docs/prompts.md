# Tested prompts

Prompts that were run exactly as written below, each in an empty folder, and made a video the maintainer
judged good. Each entry says what the prompt asks the agent to work out, what it leaves open, what came
back, how to change it for your own subject, and what it took. Paste one into an empty folder, with any file
it names. If other video skills are installed, start it with `/audara-studio:code-video` in Claude Code or
`$audara-studio:code-video` in Codex.

What the five share: each names how the picture is made or what it computes (how ink behaves, which number
is measured, what changes in every section), and says what it leaves open. A single sentence or a style
word works too and leaves more to the agent; the [README](../README.md#your-first-video) has some.

No skill reads this file, on purpose: examples a skill loads pull every video toward the same look
([design.md](design.md), "Room for the model").

## How they were run

On 2026-10-26, with audara-studio 0.8.1 in Claude Code 2.1.310, Opus 5.5 at effort xhigh, auto mode on (so
no waiting on permission prompts), on Windows 11. One message each, and no notes afterwards. Each ended the
way a code-video session does: the video playing in the live preview, a draft MP4 without motion blur, the
critic's findings fixed or listed as open (the last fixes not yet reviewed), and the final render offered,
with one more critic review before it. Add "then render it" to a prompt to get the MP4 in one go. None
stopped to ask a question, and none spent money: the sound was synthesized in code, or was the user's own
song. They haven't been run in Codex yet.

| # | Prompt | Length | Time to the hand-off | Critic rounds |
|---|---|---|---|---|
| 1 | Ink wash, drawn in code | 20 s | 1 h 14 min | 1 |
| 2 | A painting repainted as brushstrokes | 20 s | 1 h 22 min | 1 |
| 3 | 3D math with a number measured live | 30 s | 1 h 5 min | 1 |
| 4 | An explainer whose argument you write | 40 s | 1 h 23 min | 2 |
| 5 | A music video, one thing transformed | 46.5 s | 4 h 55 min | 2 |

Times run from the prompt to the hand-off, as each session reported it, on one machine; yours will differ.
The sessions estimated the final render at 5 to 20 minutes for 1 to 4 and 30 to 60 minutes for 5, after a
last critic review of about 10 to 15 minutes.

## 1. Ink wash, drawn in code

```text
Make a 20-second video in ink wash on paper, drawn entirely in code: a night train crossing a snowy plain. Make it the way ink is made: wet washes that spread and soften at their edges, dry-brush strokes that break up toward their tails, darker ink laid over paler, and the snow and the train's lit windows left as untouched paper. The blank paper is part of the picture (snow, light, distance), not background waiting to be filled. The painting stays alive (wash creeping, snow falling, smoke brushed in as it rises) without strokes flickering or reshuffling from frame to frame. Choose the composition, any colour beyond ink, the sound and the pacing.
```

- **What it asks for:** a medium built the way it is physically made, with untouched paper doing the work
  of light. The picture stays alive without its strokes changing from frame to frame.
- **Left open:** the composition, any colour beyond ink, the sound and the pacing.
- **In the test:** one continuous painting, chosen from three style frames: the train comes round a curve
  toward the viewer in two inks. The brush, wind, train and whistle were synthesized in code from the same
  timing as the picture. The critic found that the train looked like vector art and that the middle went
  dead; both were fixed.
- **To adapt:** for another medium, rewrite the second sentence as how that medium is made, and keep the
  sentence about staying alive without flickering. If the subject matters as much as the ground, say it is
  painted the same way. "Drawn entirely in code" keeps it in code. Without it, a painterly piece may get a
  one-line offer of generated images, which cost money.

## 2. A public-domain painting, repainted as brushstrokes

```text
Make a 20-second video from Van Gogh's Wheat Field with Cypresses (1889, public domain; The Met's open-access image, 1993.132). Repaint it in code as brushstrokes: thick strokes that take their colour from the painting and follow its forms (the cypresses flaming upward, the clouds coiling, the wheat leaning), so it reads as paint, not a filter over a photo. Then let the wind move through it, the strokes carrying it and flowing rather than flickering; if the camera goes closer, the strokes stay brush-sized instead of enlarging. It opens and ends on the painting's own composition. Judge stills side by side with the original. Choose the rest.
```

- **What it asks for:** a real painting used as both source and target. The strokes take their colour and
  direction from it, stay brush-sized as the camera moves, and are checked side by side with the original.
- **Left open:** everything after "Choose the rest": the camera's path, the frame and the sound.
- **In the test:** the agent downloaded The Met's image (this needs internet) and traced about 260,000
  strokes from the brush ridges in the photograph, over a softened underpainting made from it. It kept the
  canvas's own shape (1378×1080), so a 16:9 player shows bars at the sides. The sound was wind and an
  Aeolian harp, synthesized from the same wind that moves the picture.
- **To adapt:** pick a public-domain painting with an open-access image and name it the way this prompt
  does (title, year, museum, accession number), so the exact image is found and recorded in the project's
  `SOURCES.md`. Name a frame (16:9, vertical) if you need one, and describe how that painter's strokes move.
- **Licence:** the painting is public domain; The Met's image is Open Access (CC0), object 436535.

## 3. 3D math with a number measured live

```text
Make a 30-second animation of the Hopf fibration. A small sphere stays in view; each point on it owns a circle in space, and every circle links every other exactly once without touching. Points moving along a latitude lay their circles down one by one into a torus of interlocking rings; moving the latitude nests torus inside torus, between a single circle at the core and a straight line through the middle. Every curve is a solid tube that passes over and under the others, under one soft matte light, seen through a long lens on a slow orbit that never stops. A live readout of the linking number, computed from the drawn curves: for two highlighted circles, then for every pair of circles drawn (it stays 1).
```

- **What it asks for:** curves in 3D drawn as solid lit tubes that pass over and under each other, a camera
  that never stops, and a readout computed from the drawn geometry rather than typed.
- **Left open:** the colours and look, the sound, and the timing within the 30 seconds.
- **In the test:** 68 curves coloured by latitude, a look chosen from three. The readout counts all 2,278
  pairs on the drawn curves; the critic checked an earlier version's pairs with its own computation. Each
  ring's note in the synthesized score lands as the ring closes.
- **To adapt:** keep the sentence about tube, light, lens and orbit, say what gets built step by step, and
  give your subject its own number measured from what is drawn.

## 4. An explainer whose argument you write

```text
Make a 40-second animated explainer of why a sphere's surface is exactly four times the area of its shadow with the sun straight overhead. A sphere sits snug inside a cylinder, the figure on Archimedes' tomb. Slice both into thin horizontal bands: each band of the sphere is shorter around than its partner at the same height on the cylinder by exactly the factor it is wider, because it is tilted, so the two have the same area. Peel the cylinder's bands off and unroll them into one flat rectangle. Then slice the shadow disc like a pizza, rearrange it into a rectangle, and show it fits the unrolled one exactly four times. Short labels and one formula that builds with the picture; no narration.
```

- **What it asks for:** a proof told as physical moves (slice, peel, unroll, rearrange), with labels and one
  formula that build with the picture and numbers that come from the geometry. At over 30 seconds, the
  critic also runs a verification round.
- **Left open:** the look, the camera, and the music and effects.
- **In the test:** one continuous 3D shot with no cuts. Of two style frames, a lit floor in overhead sun was
  chosen over a flat technical drawing. The critic's rounds caught a sphere drawn inside out and formula
  terms landing 20 frames late; both were fixed.
- **To adapt:** write your argument as a sequence of things that move, in the order the viewer needs them,
  and say whether you want narration. The more of the argument you write, the more closely the video
  follows it; leave the staging open.

## 5. A music video: one thing, transformed in every section

```text
Make a music video for about 45 seconds of song.mp3, from the part you choose. One thing on screen carries the whole song and is transformed in every section, not just re-framed: a new scale, material or place each time, while it stays recognisably the same thing. No stretch should be the same set seen from another angle.
```

- **What it asks for:** the song's beats and sections, a window the agent picks, and one recurring thing
  that changes scale, material or place at each section. A rule rules out re-framing one set, and the critic
  checks it.
- **Left open:** which part of the song, what the one thing is, and its worlds and their look.
- **In the test:** `song.mp3` was the maintainer's own song, with its lyrics in the file's tags. The agent
  cut 46.5 s, from the bridge to the last spoken word, and made a text cursor the one thing, in six worlds:
  it built one and five scene authors working in parallel built the others. That is why it took about four
  times as long as the others (about 35 minutes of it a network outage) and several times their usage. The
  critic's first round found one world was another seen from higher up, and it was re-staged.
- **To adapt:** bring your own song, or one you have the rights to, as `song.mp3`. If you have the thing in
  mind, name it. Fewer sections or a shorter part keeps it lighter. For the words to be timed on screen,
  give `lyrics.txt` unless the file carries them; the first timing of sung words downloads about 3 GB of
  models, once.

## Adding a prompt

This file stays short and curated. A prompt joins when:

- it was run exactly as written in an empty folder, and its entry gives the date, the audara-studio
  version, the tool, model and effort, the time to the hand-off, and any notes it needed;
- the maintainer watched the result and judged it good;
- it names the mechanism (how the medium is made, what is computed, what changes and when), not only a
  style;
- it leaves real choices to the agent, and the entry says which;
- it needs no paid service, or the entry says what it spent;
- anything it brings in from outside (a painting, a song, footage) is public domain, openly licensed or the
  user's own, and the entry says which;
- it covers something the others don't, rather than the same mechanism on a new subject.

The prompt stays word for word as it was run. Each entry is a record of its run: when a later version
changes what a prompt does, run it again and update the entry, or leave the entry as it is, with its version
showing when it was true.

## More starting points

- Short prompts for a first video are in the [README](../README.md#your-first-video).
- For a prompt about your own subject, ask for ideas ("three ideas for a 20-second video about my bakery"):
  the video-ideas skill writes one, and builds nothing until you ask.
- Prompts written for the video-ideas research (2026-10-08), covering product screens, a lyric video with
  its lyrics file, a loop and a prompt adapted from another tool:
  [research/video-prompt-examples.md](research/video-prompt-examples.md). They are untested: nothing was made
  from them.
