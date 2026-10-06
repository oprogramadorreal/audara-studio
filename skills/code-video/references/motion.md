# Motion

How things move in scenes: when, how they start and stop, how they cross cuts, and how to check them. Read it
when you write or change a scene's motion, or when a note is about timing, a cut or a move. Each point is a
default with its reason: the treatment and the director's notes win, and a scene that goes against a default
says why in the treatment. Paths are in the project, where commands run; `references/…` are this skill's
files. API details are in `docs/ENGINE.md`.

Adapted in part from [motion-video-kit](https://github.com/echris6/motion-video-kit) (MIT, © 2026 echris6):
the grammar, starting from rest, monotone keys, measuring a reference and shared poses at cuts. The rest is
pdoom-video's practice (MIT, © 2026 Giacomo Magnanini).

Contents: Time comes from the data · The grammar · Starting from rest · A move through several keys ·
Measuring real motion · Cuts and carried objects · Pacing · Motion blur

## Time comes from the data

The moments things happen are computed from the video's data (`ctx.audio` from `data/audio.json`,
`ctx.words` from `data/words.json`) or from another moment computed that way, never typed as seconds or frame
numbers. The data is measured, so it holds when the timeline changes, and "two bars later" stays a one-word
change. Estimates made on the side miss: a tempo read as 129 or 134 BPM for a 132 BPM song is a frame off
within seconds, and an ad-hoc kick detector fired up to 180 ms early. Durations are craft and can be typed (a
0.3 s snap), or counted in beats when they should follow the tempo.

Match the size of a change to the size of its musical unit:

| What changes | Lands on | Read it from |
|---|---|---|
| A scene or a composition | a section or phrase start, on its downbeat (a montage's chapters, as often as every bar) | `audio.sections`, `audio.downbeats`; the example timeline's `bar(n)` |
| A camera move, a big gesture | its end on a downbeat | `audio.downbeats` |
| An accent: a punch, a flash, a step | a beat, an onset or a word | `audio.beatAt(t)`, `f.a.kick`, `audio.hit('snare', t, 0.1)`, `audio.events('kick', t0, t1)` |
| Text, and what it sets off | its word | `words.get('…')`, `words.findWords('…')`, `Words.wordProgress(w, t)` |
| Texture, breathing | the envelopes | `f.a.low`, `audio.env('drums', t)` |

- A section change shows in the picture: the frame changes more across a section boundary than within the
  section. A picture that changes by the same amount everywhere ignores the song, however well it hits each
  kick.
- A cut anchored to a word goes on the beat at or before the word (the example timeline's `cut(q)`), so the
  new composition is there when the word starts.
- Times inside a scene come the same way: two beats after a line starts is
  `audio.timeOfBeat(audio.beatAt(line.start) + 2)`. An event that depends on another motion (a letter that
  appears when a ripple reaches it) is computed from that motion's function, so the two stay locked.
- A note by time ("at 0:23, on the snare") is approximate: find the event it means (the snare onset near
  23 s, the word sung there, the bar it starts) and anchor to that, relative to the structure (the first snare
  of a bar), not to 23.0. A timecode the director gives as exact (a client's cut, a broadcast slot) is a
  time, not a note: keep it.
- A song's excerpt is chosen and cut on the music: `references/treatment-template.md`, "Choosing the song
  window".
- A sync claim comes with its check: stills at the event and one frame either side (`render.ts stills --t …`),
  reported in frames ("the flash lands 0 frames from 'drop'"). `render.ts verify` renders every word and cut
  ±1 frame, but checks errors and determinism there, not what lands where.

## The grammar

- **Big changes land on the beat**: cuts on downbeats, accents on kicks and snares, camera moves that end on a
  downbeat, decelerating to land on it or accelerating into it to snap there. Smaller motion keeps going
  between them.
- **Rhythm is the piece's choice.** Motion that follows the music answers it somewhere: it can hold, then
  move decisively on the beat (a landing that slows so it can be read, then a fast exit); keep moving but
  phased to the grid, so it arrives on downbeats without stopping (`f.barPhase`); or swell and settle with the
  sound (`audio.env('drums', t)`). A constant slow drift or zoom on everything, answering nothing, reads as a
  screensaver or a slideshow. A stepped move, when the piece wants one, stays a function of t: count the
  finished steps, ease the current one.
  ```ts
  const k = Math.floor(audio.beatAt(t)), since = t - audio.timeOfBeat(k); // k0: the beat of the first step
  const x = x0 + dx * (k - k0 + ease.outExpo(clamp(since / 0.3)));     // holds, then snaps on every beat
  ```
- **Density from hierarchy**: one primary move, supporting motion staggered behind it, fine detail under
  that, all overlapping. The whole frame starting and stopping on every beat, or everything pulsing on every
  kick, is the visualizer reflex: let the music drive one or two things and the rest follow the structure.
- **Continuity or contrast**, whichever the piece is. One persistent actor (a line, a word, a shape, a
  product, a character) can keep its identity across scenes and carry the eye through the cuts. A montage (a
  showreel, a sampler of styles) shows range instead: each chapter its own look, hard cuts on the beat, held
  together by the music, the type and the frame. Neither is the default. Reveals with neither, unrelated
  and off the music, read as a slideshow, however well each is animated.
- **The foreground as the transition**: the next scene is already in place while something in front (a word,
  a shape, the actor) scales through the camera, wipes or opens onto it, so no frame is empty between scenes.
  In the engine, overlap the two entries and let the incoming scene composite `f.under` itself
  (`handlesTransition = true`, progress in `f.tin`; both scenes render during the overlap), or hide a hard cut
  inside a foreground both scenes draw from one pose. An overlap left to the engine is a crossfade: dissolves
  at every change read as a slideshow, and fading out and back in at every cut reads as a blink.
- **Every action has a visible result**: a press changes a state, a pulse lights what it reaches, a collision
  moves both things. Motion without a consequence reads as decoration.
- **Frame 0 is a finished composition**, and so is the first frame after every hard cut: not an empty
  background waiting for its elements, not a half-entered word. Elements can still enter, over a frame that
  already reads. A fade from black, or a loop that starts empty to match its end, is a choice the treatment
  states.
- **Hard cuts work** when subject, scale, direction or material match across them and the motion continues
  after the cut, or in a montage, where the contrast is the point and the cut lands on the beat. Keep one
  wipe direction and one title position through a run of similar scenes; outgoing
  text leaves before a wipe and incoming text enters after it, so two titles never splice into one word.

## Starting from rest

Eases that start at full speed (`ease.outExpo`, `outCubic`, `outBack`, and also `springStep`) are right when
something causes the motion at that instant: a cut, a hit, a word, an impact. Anywhere else they pop. Over a
0.5 s, 400 px move at 60 fps, `outExpo` covers 82 px in its first frame, `springStep` 81 and `outCubic` 39;
`smootherstep` covers 0.1. Something that starts moving from rest in the middle of a scene starts at zero
speed: `lerp(a, b, smootherstep(t0, t1, t))` (zero speed and acceleration at both ends) or
`prog(t, t0, t1, ease.inOutCubic)`.

For realism, contact is dead still: no camera jolt, at most a tiny rebound. The hold after a landing can
breathe (a slow push or separation of a few percent) so it isn't frozen, unless stillness is the point.

Fades follow the same rule, with one twist: this engine mixes a layer with what is behind it in linear
light, so a fade looks further along than its number. A light title over a dark ground showed about half
its final lightness at 21% opacity and three quarters at 50% (measured on stills). A gentler arrival needs
a curve that starts slower, not only a longer one.

## A move through several keys

`keys(t, [[t, v, ease], ...])` eases each segment on its own: with its default `ease.inOutCubic` the speed
falls to zero at every inner key (a move through four keys stops twice on the way), and with linear segments
it jumps at every key instead. That suits a move meant to stop at each key. For one continuous move, use
`smoothKeys(t, [[t, v], ...])`, a monotone cubic (Fritsch–Carlson): the speed carries through the inner keys,
and the curve never overshoots between them. Its ends are at rest; `smoothKeys(t, ks, 'free')` keeps the first
and last segments' speed, for a move already under way at a cut. Equal neighbouring values make a true hold.

- Don't soften the curve by blending it with a smoothstep: that moves the slow part and adds a hiccup (a
  measured swing went 7.8 → 2.6 → 5.4 °/frame that way).
- For a path through points, keep where apart from when: the path as points (`polylineLengths`,
  `pointAtLength`), the distance along it from `smoothKeys`, so one function sets the speed.

Check a move by its speed per frame: it should rise and fall once. A real move may swell a little again after
a slow part; a dip more than 40% below the smaller of the peaks either side of it is a stutter. A bun script
can't import engine modules directly (they use Vite's `import.meta.glob`), so this one loads them through
Vite. Save it as `out/<video>/wip/speed.ts`, point it at the module that exports the pose, and run
`bun out/<video>/wip/speed.ts` from the project root:

```ts
import { createServer } from 'vite';
// (no dependency pre-bundling: it would write into node_modules/.vite, the running preview's cache)
const vite = await createServer({ configFile: false, logLevel: 'error', appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, watch: null } });
const { pose } = await vite.ssrLoadModule('/videos/<video>/scenes/<module>.ts'); // pose(t): a number or { x, y, z? }
const fps = 60, from = 4.0, to = 5.3;                                          // one move
const d = (a: any, b: any) => (typeof a === 'number' ? Math.abs(b - a) : Math.hypot(b.x - a.x, b.y - a.y, (b.z ?? 0) - (a.z ?? 0)));
const v: number[] = [];
for (let n = Math.round(from * fps); n < Math.round(to * fps); n++) v.push(d(pose(n / fps), pose((n + 1) / fps)));
console.log(v.map((x) => x.toFixed(1)).join(' '));
for (let i = 1; i < v.length - 1; i++) {
  if (!(v[i] <= v[i - 1] && v[i] < v[i + 1])) continue; // a valley
  const l = Math.max(...v.slice(0, i)), r = Math.max(...v.slice(i + 1));
  if (v[i] < 0.6 * Math.min(l, r)) console.log(`stutter at ${(from + i / fps).toFixed(3)} s: ${v[i].toFixed(2)}/frame between peaks of ${l.toFixed(2)} and ${r.toFixed(2)}`);
}
await vite.close();
```

Through four keys, `keys()` prints two stutters and `smoothKeys()` none.

## Measuring real motion

When something should move like a real object (a door, a fold, a throw, a page, a hand), measure a reference
instead of guessing an ease: real motion is rarely a standard curve. A measured phone unfold was fastest early,
slowed near edge-on and landed softly; no ease has that shape.

1. Extract the move as PNGs at 30 fps, numbered from 0, so file k is k/30 s into it. Three things trip this
   up: ffmpeg doesn't create the output folder; a source below 30 fps (24, 25) is read at its own rate,
   since resampling it up repeats frames, which measure as stops; and a `tile` sheet of the whole move
   holds 49 frames at 7×7, so a longer one needs a numbered output name (`%02d`).
2. Measure one value per frame: a position, a width, an angle from a projected width. By eye from the frames
   for the shape, or with a short script (`uv run --with pillow --with numpy`: threshold the moving part,
   print its centroid or extent) for numbers.
3. Write the keys as `[seconds from the start of the move, value]` and interpolate them with `smoothKeys`
   (`'free'` if the clip starts or ends mid-motion). To make the move longer or shorter, scale its time.
4. Render yours at the same rate (`render.ts video --from … --to … --only <entry id> --fps 30 --draft`), tile
   it the same way, compare the sheets side by side, and run the speed check on both.

The reference is for study: it goes into the frame only if the director owns it or its license allows it.
During a measured move, keep the camera still and re-centre the object instead; a reframe that stops on the
contact frame reads as a bump, so reframe after the landing.

## Cuts and carried objects

Anything carried across a cut (the actor, a shape that becomes the next scene, a word that stays) gets its
pose from one shared function that both scenes call, so the last frame before the cut and the first after it
agree by construction and keep agreeing when either scene changes; matched by hand, they drift. Put the
function, and the drawing if that should match too, in a helper the scenes share, `scenes/_<name>.ts` with
named exports only (`scenes/_actor.ts` with `actorPose(t)`, say), so saving it updates both scenes in the
preview; when several authors build scenes, the lead owns it. Share everything that decides where it lands
on screen, the camera or zoom included, and pre-position the next scene so the object lands where that scene
needs it.

Check every cut by the frames around it, not by mid-beat samples (the sheets and stills for that are in
`references/critique.md`, "Your stills loop"). For a carried object, also measure the frame difference
inside its rectangle: across the cut it should look like its neighbours, not spike.

```
bun scripts/render.ts video --video <video> --from <cut-0.2> --to <cut+0.2> --noaudio --draft --crf 0 --out out/<video>/wip/cut.mp4
ffmpeg -i out/<video>/wip/cut.mp4 -vf "crop=<w>:<h>:<x>:<y>,format=gray,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=out/<video>/wip/cut-diff.txt" -an -f null -
```

Each entry in `cut-diff.txt` gives a time from `--from` and the mean difference (0–255) from the frame
before; the cut is about 0.2 s in. Crop tightly: when the background behind the object changes at the cut,
the number jumps anyway, and the two frames are compared by eye instead (`stills --t <cut-1/fps>,<cut>`).

## Pacing

The treatment sets the pacing from the piece and its music; there is no default number of compositions or
longest hold. A music video can hold a composition for bars, an explainer holds while a line is read, a short
loop can be one continuous move. Deliberate holds go into the treatment, so the critic reads the QC report's
holds as intended. Commercial pacing is an optional preset with numbers of its own
(`references/treatment-template.md`, "The commercial preset").

## Motion blur

The final render averages sub-frames across the shutter (`render.ts video` does it by default:
`--samples auto --shutter 0.2`; "Motion blur and sampling" in `docs/ENGINE.md`), so whatever moves fast gets
real blur there, a foreground flying through the camera included. The preview, single-sample stills and
`--draft` clips stay crisp. So a scene draws where things are at t, sharp: smears, trails, ghost copies or a
directional-blur pass meant to suggest speed would be blurred a second time in the render, and they slow the
preview. A fast move judders in the preview; before changing the motion for a note like that, look at the
moment as the render will show it: `render.ts stills --t <t> --samples auto`, or a short clip without
`--draft`.

Draw blur only when it is the look (smear frames, painted speed lines, a long-exposure trail), as a style the
treatment names. A `stateful` scene can't be sampled adaptively: the render gives it a fixed 12 sub-frames
(`--samples N` for another count).
