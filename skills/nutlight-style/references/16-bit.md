# Nutlight in 16-bit

When the director asks for the style as a 16-bit console would have drawn it (pixel art, "Super Nintendo",
"SNES", "16-bit"), the video is still Nutlight: the kit's squirrels, rigs, props and structures, ideas acted out,
light with a source, depth in planes, living motion, transitions through the world, the music plan. What changes
is how the picture reaches the screen. The kit's `pixel.ts` (`PixelStage`, in its README) turns what the Stage
draws into pixel art, layer by layer, as that hardware composed a frame. This file adds the craft that drawing it
taught: a 10-second test, one critic round and the director's approval (2026-11).

It isn't a filter over a finished video. The whole frame shrunk and recoloured at once came out muddy, with
speckled edges and crawling detail, so a scene is staged for it from the brief: pans rather than zooms, a layer
per plane, drawn frames, small detail set on the grid. The same scene file renders the kit's own look with
`hd: true`, which shows what the conversion costs.

Contents: What changes, and why · At each step · Checks

## What changes, and why

| Nutlight | In 16-bit | Why |
|---|---|---|
| crisp, smooth contours | a 384×216 grid (`px: 5`), each pixel a 5×5 block of the 1080p frame; 15-bit colour | about that hardware's line count at 16:9; on the cast sheet faces keep their mouths here and lose them at 320×180 (`px: 6`) |
| any colour the light makes | a palette per layer, chosen from the layer as the kit lights it (`P.extract`): 15 colours a character, 5 to 14 a background plane, up to about 44 for the focal plane; ordered dither only where a gradient crosses two colours; the sky a 15-bit gradient | that hardware gave each layer and sprite its own palettes; the lights added over them still brought a frame to several hundred colours |
| no outlines | a 1-pixel outline on characters only, in the setting's dark (`R.c.frame`) pulled toward the colour it borders (`selout: 0.3`), the same for every character; backgrounds keep the style's rule | small sprites read over busy planes; a black line breaks the style, and two characters with different outlines looked drawn by two hands |
| soft glow and bloom | light layers added in 4 flat steps of one intensity, its hue kept, never over the face of the screen or lamp it comes from (`holes`); the engine's post off (`PIXEL_POST`); characters drawn over the light, in their own colours | colour math, as that hardware lit things; a blurred glow, or a dither per channel (3 or 4 colours in every 2×2 cell of a screen), read as a filter |
| far layers in haze | the same, painted into each plane's palette | a palette per plane is how it showed distance |
| a camera that drifts, pushes and settles | pans only, in whole pixels, each plane scrolling 1/depth as fast (clouds 14, far 5, mid 2.3, focal 1, foreground 0.55 worked) | the grid has no zoom: a zoom resamples every pixel and the picture crawls; parallax in whole pixels is that era's signature |
| characters always alive | the kit's poses and acting, drawn 12 times a second (`P.drawing`); at rest a loop of three drawings (`P.idle`); typing in two; blinks in two; a hop's height every frame in whole pixels, its drawings a crouch, a stretch and a landing (`P.hop`) | a sprite redrawn from a continuous pose was a new picture at every step and its outline crawled (21 drawings in 20 steps at rest; 2 in 9 with the loop) |
| motion blur | none: `shutter: 0`, and every position snapped (`P.snap`) | a pixel is lit or not; a sub-pixel move shimmers |
| fine detail (rack lights, code on screens) | set on the grid by hand: status lights a pixel (`P.cell`), screens and emotes as hand-drawn icons (`P.icon`) | detail finer than the grid converts to noise that flickers as its layer scrolls |
| transitions through the world | the same, plus that hardware's own (`P.end`'s `mosaic`, `bright` in 16 steps, `iris`) | |
| words in the world | the same; small symbols as pixel icons, an emote bubble over a character | |

## At each step

- **Brief.** The treatment's Look names the variant and the grid, and its format says `shutter: 0`. Stage the
  storyboard for what the grid does well: a pan with parallax, a character's action read in silhouette, a screen
  that changes. A push-in becomes a cut, a pan or the mosaic. The music plan is music.md's: the director's library
  first. A 16-bit piece may want that era's sound (a sample-based chip: 32 kHz voices, a short echo). Synthesized
  in code it's free, so it's a fair stand-in, named as one, until a library track or a yes to generated music.
- **Setup.** As for any Nutlight video: `pixel.ts` comes with the kit.
- **Look.** Style frames through the PixelStage, each beside its reference and beside the same frame with
  `hd: true`. Make the key moment's subject big enough for the grid: a packet as a 4-pixel dot read as nothing,
  and the acorn itself with a short trail did. STYLE.md opens as look.md says, adds a "16-bit" table of what
  changes and why (this one, made the video's own), and lists in Avoid anything smooth beside the pixels (a
  blurred glow, an anti-aliased edge, a sub-pixel move), zooms, black outlines and detail finer than the grid.
- **Cast.** Render the cast sheet with `params: { px: 5 }` beside the kit's own: each character's silhouette,
  eyes and mouth should survive the grid, and every character should look drawn by one hand (one outline colour
  and selout, the same palette size). A small feature that reads as something else at this size goes for this
  video (a crown tuft read as a third ear), noted in the cast table.
- **Build.** Each scene brief names this file's full path too. A scene is `P.begin`, layers from far to near,
  `P.end` (the kit's README has one). Choose the
  palettes once in `init()`, from the views the pan will show (`P.views`). Bake at half resolution, since the grid
  sees a fifth. A pose acted from the beats is still the kit's (`poseKeys`, `express`, `reach`), stepped at the
  drawing rate; `P.idle` goes last. A frame that only breathes reads as a postcard: give the opening an action (the
  test's first two seconds were still at a glance until its character typed and tokens landed on the screen).
- **Critic.** Run it as SKILL.md says, adding the checks below and two verdicts: still Nutlight? 16-bit at a
  glance, and on inspection?
- **Render.** `--scale 2` draws each frame again at 3840×2160 on the same grid, each pixel a 10×10 block. A 4:2:0
  encode keeps an even block flat, while a 1080p H.264 file smeared 37% of the 5×5 blocks. A colour here and there
  can shift by one 15-bit step from the 1080p preview, and nothing moves.

## Checks

On stills and short clips, before scenes go out and in critic rounds, with look.md's and motion.md's:
- a plane alone (`P.solo = n`) through a pan is the same picture every frame, shifted by whole pixels: after the
  best whole-pixel shift, nothing differs but what is drawn live (a dither fixed to the screen made 3,263 pixels
  of the focal plane flip; anchored to the layer, 0 in four planes and at most 8 of 83,000 in the focal plane);
- a character at rest shows a few drawings, repeated (crop it at 12 steps a second and count the distinct
  pictures);
- no light sits on the face of its own screen; no 2×2 cell of a light holds three colours;
- on a 4K still, every 10×10 block is one colour (within the engine's 1/255 output dither);
- the opening isn't still at a glance (qc.py's `glance` line);
- what carries the story reads at the grid's size, and two characters side by side look drawn by one hand.
