# Run it again: getting a moment of the build back

A video about a build is made after it, often at another size than the build was ever seen at (a 4K master
of a 1080p video), and many of its best moments are gone by then: the first look, the bug before its fix, the
stage before the redesign. When a moment can be run again, the video films it then, at its final size, from
another angle, after a fix, with nothing else changed. Both devlogs this skill comes from built such a rig on
their first day, and it is what made late notes cheap: one re-filmed 16 shots after a change to its game, every
simulation hash equal, and the other re-captured 31 shots with identical timing after two fixes. Filming as
they went cost more than it gave: one took 2,242 screenshots and 76 recordings in two days, and its video used
about 16 and 9.

How much of this a build needs depends on the thing: a tool needs scripted input, not a physics engine, and
an explorer may need only its camera path saved. What every one needs is the result: each moment the log
says a video may show can be got back, at any size, from a command. A project already under way keeps its own
structure: list what it has first (its history, tags, replays, a debug camera) and add only what the moments
need.

## Foundations

Set before the first feature, sized to the thing:

- **Any size.** The output size comes from a parameter (`?w=3840&h=2160`, `--size 3840x2160`), never the
  window. Layout, text and line widths are in the thing's own units and scale with the output, so a frame at
  4K is the same picture as at 1080p, sharper. Canvases and textures it makes itself (text, an atlas) are made
  at the output's scale. In GLSL, `gl_FragCoord`, `fwidth` and `dFdx` count physical pixels: a line drawn
  from `fwidth` gets thinner at 4K (code-video's contract.md, "4K", has the same traps for the video's own
  scenes). Assets set the detail ceiling: a 1K texture stays 1K at any size.
- **The state apart from what draws it** (a game, a simulation). State advances only in a step function;
  drawing reads the state and never changes it. A second look (an early art style, a debug view) is then a
  second view over the same state.
- **A fixed tick,** a whole number of steps per second (60 for a game; the step a physics demo needs), never
  the frame's delta or the wall clock. Slow motion is fewer ticks per frame drawn, a time-lapse more.
- **No input that differs between runs:** seeded randomness from the state's own generator, no wall clock,
  no device-dependent maths in state that must replay across machines (keep `Math.sin` and friends out of it,
  or quantize what they feed), nothing that depends on which camera is drawing (an enemy that wakes when it
  comes on screen wakes on the simulation's own rule, so a free camera doesn't change the game).
- **A camera that reads the state** and moves nothing in it, so the same run can later be filmed from any
  angle.
- **One launch for a moment:** a stage, its inputs and a size, from a URL's parameters or a command
  (`?stage=plain&replay=replays/first-win.json&w=3840&h=2160`), with a way to start paused and step one frame
  at a time, so a later capture can draw each frame as slowly as it needs.

## Ways back

The cheapest that survives the next change and keeps the code clean:

- **A commit and its command.** It costs the live code nothing and shows the stage as it was, bugs and limits
  included. It runs only what its code could, which is why the size parameter and the launch come first: a
  commit from before them can't draw at 4K. A tag when the stage deserves a name (`stage/plain-bricks`,
  `bug/tunneling-before`). To try it: `git worktree add ../plain-bricks stage/plain-bricks`, install from the
  lockfile, run the command. A tag misses what git doesn't track: commit the assets it needs, or log where
  they are.
- **A preset** (`?look=plain`, `?fx=off`) when the old look is a second view over the same state, costs a few
  lines, and is wanted beside the new one (a before and after in one run, a switch live on screen). Every
  later change to the state has to keep it drawing; when it starts spreading conditionals through the code,
  retire it to its commit.
- **Inputs as data:** the inputs per tick (a game), the parameters and seed (a simulation), a camera path
  with its settings (an explorer), a scripted session (a tool), with a hash of the state every so many ticks
  where there is state. Replaying checks the hashes; a mismatch is a bug in the rig, found now rather than in
  the edit. A replay depends on the code that reads it, so its log entry names the revision.
- **A fixed bug:** fixed. To show it later, the commit before the fix keeps it, with the smallest input that
  triggers it (a seed and a few seconds of input, a fixture); run that input on both commits and log what
  each does. A toggle that puts the bug back in live code (`?bug=double-bounce`) only when it's a line or
  two, and measured against the log's entry, since a world that changed may show it differently.
- **A capture** when that's better: keeping the moment runnable would clutter the code, or it won't come back
  (an outside service or a generated asset that changes, a race, a driver glitch seen once, a moment in the
  director's live session). Take it while it's there, at the largest size practical (a canvas drawn at
  3840×2160 for a still, a recording at the display's full size), lossless or at high quality, into
  `devlog/captures/`, and log its path, size, time range, what it shows and why it's a capture. A capture the
  director made counts the same: keep it where they put it or copy it in, and log it. In a video at another
  size it plays enlarged where it's smaller, so a capture is the second choice when a run is cheap.

Screenshots and clips taken to check the work are fine and don't need keeping; a library of them is what the
evidence above warns against.

## Kinds of thing

- **A game:** input replays, played by the director, by a bot, or found by a search over the headless
  simulation (a skilful run with no deaths, a special move landing on a downbeat). An early art style is a
  preset over the same state while it's cheap, then its commit.
- **A physics simulation:** the seed and the initial conditions are the replay. One run can then be filmed from
  several angles and speeds; the quantities a line may quote (energy, counts, frame times) are measured
  from runs, with their method.
- **A fractal or a mathematical explorer:** the camera path is the replay (centre, zoom and iterations per
  frame, as data). Deep zooms need precision the GPU's floats lack (perturbation or double-single tricks);
  test the deepest frame first. The drawing code kept in a module of its own can later run inside the video's
  scenes directly.
- **A tool or an interface:** scripted input (a browser driver), fixed data and a clock you control.
- **Something with no picture of its own** (a command-line tool, a compiler, a library): a fixture and a
  command whose output shows the moment, before and after; the video draws it.

## Checks

- **At each milestone,** run each command in the log's "Run it again" table: does it still show what its row
  says? A preset that stopped drawing is fixed or retired to its commit, and the row says which.
- **For a stage the video will show,** one frame at the video's size and at 4K (or the size the director named):
  the same picture and framing, the larger sharper, nothing laid out by the window's size.
- **Replays:** the hashes match, and one frame drawn twice is identical.
