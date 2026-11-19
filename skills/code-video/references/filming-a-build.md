# Filming a build

Some videos show something built: a devlog about making it, an explainer that shows what a prototype draws, a
showcase flown through it. Such a project often keeps `docs/DEVELOPMENT_LOG.md` (the devlog skill): the build's
decisions, struggles, concepts and measured numbers, and a "Run it again" table of the moments a video may show.
Each is either a recipe (the command that brings it back at any size, with its inputs and commit), filmed now at
the video's final size, or a capture the build kept with its provenance (its path, size, time range and why),
used as it is. This file is how. A project with no log (a video about
something built before) starts from what it has: its history, tags, any replays or recordings.

## The log in the script

- **Research, not the outline.** Keep the turns that carry the promise, with their setups and payoffs; most
  entries stay out. For a video about the subject rather than the making (an explainer, a showcase), the log
  finds the mechanisms and views worth showing without imposing the build's chronology.
- **Story order:** a stage appears first in the chapter that builds it, unless the story is told out of order
  on purpose (the treatment's Stage column); the hook may glimpse the payoff briefly and borrow later shots.
- **The picture shows the line** where a line asks the viewer to see something happen: the moment run again
  and filmed for it. Reactions, metaphors and counterpoint stay open.
- **Explanations a first-time viewer can follow:** one subject, a concept defined before it's used, one idea
  per line, drawn as it is said (critique.md's critic restates each one).
- **Their lines verbatim,** their persona as they set it; a joke for their voice is offered with options.
- **Provenance:** a claim, a number or a re-staged bug cites its log entry, its commit and its settings. A
  number is the one measured when it happened (a rebuilt bug in a changed world may measure otherwise).
- nutlight-style only when named: its look is for the scenes around the footage, and the thing keeps its own.

## Two ways onto the screen

- **The build's own drawing in a scene,** when it runs in the browser and a frame follows from `t` (a shader
  explorer flown along a camera path) or from a fixed tick a stateful scene can step (a light simulation):
  import its module into a scene, drive it by time, and it draws at the render's size with everything else,
  a 4K master included, with nothing captured. The rules of contract.md hold for it (seeded randomness,
  `PX_SCALE` for anything drawn in pixels).
- **Frames captured from it** into a shot folder, streamed by the engine (contract.md, "Images and footage"):
  for a build that is heavy per frame, carries minutes of state, runs outside the browser, or comes from an
  old commit.

## The capture page

A capture page (`capture.html` beside the build, or a command for one outside the browser) loads a shot spec,
launches the moment as the log's command does (its stage, inputs and size), replays to the shot's first tick,
then steps and draws one frame at a time at the spec's size, writing numbered JPEGs. Run it headless in Chrome
with the GPU (render.ts does the same for the video), on its own server with hot reload off, so another agent's
edit can't reload it mid-shot. A moment kept at an old commit is filmed from a worktree at the commit or tag the
log names, with its logged launch and its own capture driver or a newer one adapted to it (a smoother camera
path, a finer sampling); a newer one is checked against the old look, timing and framing, and the manifest names
the driver's revision.

A free camera for capture only (orbit, follow, low and close, crane, a path through the scene) reads the state
and moves nothing in it, so the same run films from any angle.

## A shot

```
footage/<shot>/
  manifest.json      what it is and how to make it again
  full/000001.jpg …  the frames at the render's size
  proxy/000001.jpg … the same at half the 1× size, for the preview
  contact.jpg        a sheet of its frames, to look at before using it
  events.json        optional: sounds and events per frame (a jump, a hit), for the mix
```

The manifest holds what a later session needs to re-shoot it and what a scene needs to play it:

```json
{ "id": "lvl1-run", "title": "Level 1 at full quality, one fast run, the game camera",
  "frames": 2091, "fps": 60, "size": [3840, 2160], "proxy": [960, 540],
  "source": { "run": "?stage=final&replay=replays/lvl1-run.json", "commit": "stage/final", "from": 830, "to": 2920 },
  "settings": { "quality": "high", "camera": "game" },
  "samples": 16, "shutter": 0.5 }
```

Full frames are at the size the shot fills in the final render at its largest (a push-in counts), in its
pixels: twice the logical size for a 1080p video's 4K master. Proxies are for the 1× preview. JPEG at high
quality is about 0.3-0.5 MB a 1080p frame and three to four times that at 4K, so a minute at 60 fps is 1-2 GB
at 1080p: film only the stretches the cut uses, and let a retired take go to a folder outside the video's paths
rather than deleting it while it may still be compared. Film after the cut is settled where you can; a bigger
master asked for after the capture films again only what it would show enlarged (contract.md, "4K"): the same
run, framing and frame numbers at the new size into `full/`, the manifest's `size` with it, proxies as they
are. Say what the time and room come to before starting.

**The same picture, finer.** Downscaled, the bigger frames match the approved ones (contract.md, "4K", its
check). When a frame drawn at the new size, downscaled, doesn't match the approved one, because the build
decides things by the pixel (a star's or a glare's size, where detail fades in, where a finer map takes over),
and correcting that code isn't practical, weave each frame: N×N renders at the approved size, offset by
fractions of a pixel and interleaved into a frame N times larger, each one a frame the approved capture could
have drawn. Keep what spans the frame the same across the N² (the time, the exposure, a glare from their mean),
seed noise by frame and sub-frame rather than by a count of draws, reset what is redrawn a piece per draw as
each render begins, and let texture reads use the woven pixel so they keep their detail. It draws N² times per
frame (four for 4K from 1080p): film a short moving stretch first, time it to estimate the rest, and look for
rows or columns that alternate, flicker and soft textures.

**A capture from the build** (`devlog/captures/`, named in the log with its size) is a moment kept that way
because it wouldn't come back, or keeping it runnable cost more. A clip is cut into a shot like any footage
(contract.md), a still goes in as an image (images.md), each at its own size; at a bigger master it plays
enlarged where it's smaller, and the reply names it among what plays enlarged.

## Into the video

Scenes play shots through the engine's streamed footage: a scene opens a shot with
`openFootage(this.ctx, '<shot>')` in `init()`, says what it will show in `prepare()`, and draws `frame(f.t)`.
The engine reads the manifest's `frames`, `fps`, `size` and `proxy` (`"proxy": false` makes the preview read
`full/`); the rest is for re-shooting. The video's own
motion blur doesn't apply to footage, which carries its own (the capture's samples and shutter). A capture's
`events.json` gives the thing's own sounds at the right frames; soundtrack's mix places them from the video's
timeline, so they move when the edit does. Labels pinned to things in the world (a callout on a character)
read the shot's per-frame data when the capture writes it (the camera's matrices and the positions that
matter), rather than being placed by eye.

## Kinds of thing

- **A game:** the game's own camera for gameplay; the free camera for the shots that show it is 3D, or a level
  from above. A skilful run can come from a search over the headless simulation.
- **A physics simulation:** one event from several angles and speeds from the same run (real time, then slow
  motion), with the quantities the narration names recorded per frame.
- **A fractal or a mathematical explorer:** the camera path is the shot; its shader often runs in a scene
  directly.
- **A tool or an interface:** scripted input; screens captured this way are the product's real screens
  (images.md).

## Checks before a shot goes in

- The replay's hashes match, and one shot rendered twice is byte-identical.
- A framing test: a known object fills the frame where the camera says it should (one capture drew every shot
  at the wrong field of view until a wall of cubes didn't fill its frame).
- Its first frames show what its title names: decorations loaded, the effect switched on, nothing still
  streaming in.
- A frame reached from a fresh start matches the same frame in continuous play, after a cut or a streaming
  change too: what the build carries from frame to frame (streamed maps, light adaptation, caches) has settled
  or been set straight. Two cold renders can agree and both be wrong.
- Its frames seen at full size around the moment it is used, and in motion (a clip): flicker in leaves,
  water or distant geometry shows only in motion, and reached the director twice from captures judged on
  stills.
- The look the line is about: a chapter set before a stage shows the thing as it was then, from its commit.
