# Capture: filming the thing you build

A devlog's footage comes from the program itself, not from a screen recorder. When a demonstration can be run
again exactly, any moment can be filmed after the fact: at final quality, from another angle, in an earlier look,
after a fix, with a note's change and nothing else. Both devlogs this skill comes from built such a rig on their
first day, and it is what made late notes cheap: one re-filmed 16 shots after a change to its game, every
simulation hash equal, and the other re-captured 31 shots with identical timing after two fixes. How much of it a
project needs depends on the thing: a tool needs scripted input, not a physics engine. What every devlog needs is
the result: each demonstration the video will show can be run again, and each stage it will show can be got back.

## Techniques

Take what the thing needs:

- **The state apart from what draws it** (a game, a simulation). State advances only in a step function; drawing
  reads state and never changes it. A second look (another art style, a quality mode) is then a second view over
  the same state, switchable live without touching the game.
- **A fixed tick,** a whole number of steps per second (60 for a game; the step a physics demo needs), never the
  frame's delta or the wall clock. Slow motion is fewer ticks per frame drawn, a time-lapse more.
- **No input that differs between runs:** seeded randomness from the state's own generator, no wall clock, no
  device-dependent maths in state that must replay across machines (keep `Math.sin` and friends out of it, or
  quantize what they feed), nothing that depends on which camera is drawing (an enemy that wakes when it comes on
  screen wakes on the simulation's own rule, so a free camera doesn't change the game).
- **Replays:** the inputs per tick (a game), the parameters and seed (a simulation), a camera path with its
  settings (an explorer) or a scripted session (a tool), saved as data, with a hash of the state every so many
  ticks where there is state. Replaying checks the hashes; a mismatch is a bug in the rig, found now rather than in
  the edit.
- **A capture page** (`capture.html` beside the prototype) that loads a shot spec, replays to its first tick, then
  steps and draws one frame at a time at the spec's size, writing numbered JPEGs. Run it headless in Chrome with the
  GPU (the engine's render.ts does the same for the video), on its own server with hot reload off, so another
  agent's edit can't reload it mid-shot.
- **A free camera for capture only:** orbit, follow, low and close, crane, a path through the scene. It reads the
  state and moves nothing in it, so the same run films from any angle.
- **Stages you can get back:** a flag for a look or a feature the video will show again (`?style=classic`,
  `?fx=off`), a tagged commit for the rest, and, where a fixed bug is worth showing, a toggle that brings it back on
  purpose, measured against the log's entry. A before and after is then one replay filmed twice.

## A shot

A shot folder, `footage/<shot>/` at the project root (shared by every video in the project):

```
footage/<shot>/
  manifest.json      what it is and how to make it again
  full/000001.jpg …  the frames at the render's size
  proxy/000001.jpg … the same at half size, for the preview
  contact.jpg        a sheet of its frames, to look at before using it
  events.json        optional: sounds and events per frame (a jump, a hit), for the mix
```

The manifest holds what a later session needs to re-shoot it and what a scene needs to play it:

```json
{ "id": "lvl1-run", "title": "Level 1 at full quality, one fast run, the game camera",
  "frames": 2091, "fps": 60, "size": [1920, 1080], "proxy": [960, 540],
  "source": { "replay": "tools/replays/lvl1-run.json", "from": 830, "to": 2920 },
  "settings": { "style": "voxel", "quality": "high", "camera": "game" },
  "samples": 16, "shutter": 0.5, "commit": "…" }
```

Size the frames for where they play: full frames at the size the shot fills in the final render, proxies
for the preview. JPEG at high quality is about 0.3-0.5 MB a 1080p frame, so a minute at 60 fps is 1-2 GB:
keep full frames only for shots the cut uses, and let a retired take go to a folder outside the video's
paths rather than deleting it while it may still be compared.

## Kinds of thing

- **A game:** input replays, played by the director, by a bot, or found by a search over the headless
  simulation (a skilful run with no deaths, a special move landing on a downbeat). The game's own camera
  for gameplay; the free camera for the shots that show it is 3D, or a level from above.
- **A physics simulation:** the seed and the initial conditions are the replay. Film one event from several
  angles and speeds from the same run (real time, then slow motion), and record the quantities the narration
  will name (energy, counts, frame times) per frame.
- **A fractal or a mathematical explorer:** the camera path is the replay (centre, zoom and iterations per
  frame, as data). Deep zooms need precision the GPU's floats lack (perturbation or double-single tricks);
  test the deepest frame first.
- **A tool or an interface:** scripted input (a browser driver), fixed data and a clock you control. Screens
  captured this way are the product's real screens (code-video's images.md).

## Into the video

Scenes play shots through the engine's streamed footage (code-video's contract.md, "Images and footage"): the
render reads full frames and the preview proxies, loaded just ahead of the frame, so minutes of footage don't
sit in memory. The video's own motion blur doesn't apply to footage, which carries its own (the capture's
samples and shutter). A capture's `events.json` gives the game's own sounds at the right frames; soundtrack's
mix places them from the video's timeline, so they move when the edit does.

Labels pinned to things in the world (a callout on a character) read the shot's per-frame data when the
capture writes it (the camera's matrices and the positions that matter), rather than being placed by eye.

## Checks before a shot goes in

- The replay's hashes match, and one shot rendered twice is byte-identical.
- A framing test: a known object fills the frame where the camera says it should (one capture drew every shot
  at the wrong field of view until a wall of cubes didn't fill its frame).
- Its first frames show what its title names: decorations loaded, the effect switched on, nothing still
  streaming in.
- Its frames seen at full size around the moment it is used, and in motion (a clip): flicker in leaves,
  water or distant geometry shows only in motion, and reached the director twice from captures judged on
  stills.
- The look the line is about: a chapter set before a stage shows the thing as it was then.
