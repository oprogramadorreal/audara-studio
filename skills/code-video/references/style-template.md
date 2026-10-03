# Style template

The look every video in a project shares, written to `docs/STYLE.md` and mirrored in code: the palette
and post defaults in `src/look.ts` (`PALETTE`, `POST`), the fonts in `src/engine/type.ts`. Write it with
the project's first treatment, before any scene, and show its palette and type in the same reply for
approval. Later videos reuse it; one that departs from it says how in its own treatment. Change the doc
and the code together: scenes read the code, while scene authors, the critic and later sessions read the
doc.

Paths that start with `references/` are in this skill; all others are in the project.

Contents: Fill it from what the director gives · The skeleton · Palette: roles, glow, brand colours ·
Type: the voices · Layout: safe areas and minimum sizes · Motion and post · Avoid unless the piece calls
for them

## Fill it from what the director gives

- **A brand picture** (a poster, a logo sheet, a product photo, a screenshot): take the palette from its
  pixels, measured rather than remembered; match its type to the nearest voice below or add the brand's
  own typeface; use the logo as given, since a redrawn logo is no longer the brand's mark.
- **A product URL:** the site's CSS (custom properties, `@font-face`) names its colours and fonts, and its
  copy gives the tone.
- **Neither:** derive the look from the idea rather than from its genre: for example from the subject's
  own material (its objects, textures, tools and places), from the music's character, from a typographic
  idea or from a constraint the piece sets itself. The look that comes first for "night", "tech", "music"
  or "data" is the one every other video already has (see the list at the end).

Ask only for what's missing, such as the logo as a file or whether the brand's typeface may be used in
video. The director's material wins over everything here. A small project's STYLE.md can be fifteen
lines: a palette, a type line and the avoid list.

## The skeleton

```markdown
# Style: <project>

From: <the brand picture, URL or treatment it was derived from>, <date>.

## Palette (`src/look.ts` PALETTE)
| Key | Hex | Role |
|---|---|---|
| `bg` | | the ground most frames sit on |
| `fg` | | what reads on that ground: text and marks |
| <`key`> | | <each other colour the piece needs, named for its job here; as many as the idea wants> |

Glow: <the keys a scene may push above 1, if any>. <Light and dark: one ground, or which moments turn
light.>

## Type
| Voice | Font | Carries |
|---|---|---|
| <only the voices this project uses; one is often enough> | <font and its `F` call> | <what it carries here> |

## Layout
<Grid and margins in logical px; the safe area and minimum text size for each format the project
delivers, copied from this template's Layout tables with their date.>

## Motion
<Two or three lines on the motion's character: its weight and speed, how things arrive and leave, what a
cut and a hit do.>

## Texture and post (`src/look.ts` POST)
<The project's values and why: grain, bloom, halation, vignette, chromatic aberration.>

## Motifs
<What recurs across the project's videos, if anything: from the brand or the first video.>

## Tone
<A few words the scene authors can act on: what it sounds like, what humour it allows, what it never does.>

## Craft
- Kerning: the font's own. Text drawn glyph by glyph is placed with `layout()` / `glyphX()`, and
  `strokeText()` kerns the stroke fonts optically; the gap between runs in different fonts or sizes is set
  by eye (`docs/ENGINE.md`, Typography).
- Punctuation: typographic in display text (’ “ ” … – — × −; words from `data/` already are). The mono
  voice keeps typewriter quotes where it shows typed input or code.
- Glyphs: every one from the project's fonts, and a symbol they lack is drawn. A system fallback font
  changes from machine to machine, so the render stops matching the preview.
- Legibility: text at or above its format's minimum size; settled text at least 4.5:1 against what is
  behind it (3:1 for large type), measured on a rendered still. Small type stays solid and out of the
  glow, since outlines and glows blur at phone size and smear under bloom; display type may glow when the
  idea is light itself.
- Rights: only fonts, images and marks the project owns or licenses; a brand's assets as given; no
  imitation of other artists' characters or of real products' interfaces.

## Avoid unless the piece calls for them
<The list at the end of this template, with what this project adds or crosses out.>
```

## Palette: roles, glow, brand colours

- The values `init` puts in `look.ts` are a test card, not a choice: replace every one before the first
  scene, in a quick loop and on "just build it" too. Left in place they are a look nobody chose, and
  every video in the project inherits it; `render.ts verify` and the preview say so while all of them
  are still there. Light or dark comes from the brand and the idea; neither is the default.
- `bg` and `fg` are the only keys the engine needs (its flash, invert and crop marks use them). Name
  every other key for its job in this piece, so scenes say what a colour is for and a palette change
  restyles every scene; the test card's `surface`, `line`, `muted`, `accent` and `accent2` are one way to
  name roles, not a set to fill.
- Renaming or deleting a key breaks every scene that uses it (`C_<KEY>`, `LIN.<key>`, `rgba('<key>')`),
  the example video's included: update those scenes, or delete `videos/example/` once the project has a
  video of its own (`init` leaves it deleted).
- **Glow.** Bloom works on linear values: it picks up a pixel's brightest channel from about 0.7 and grows
  above 1 (`bloomThreshold` 1, soft knee 0.3). A palette hex reaches 1.0 at most (a channel at FF), where
  it barely blooms, so glow means a scene pushing a key above 1, as in `C_ACCENT * 3.0`. Name the keys
  allowed to; small type stays out of it, and crisp.
- **Brand colours.** Above 0.72 linear the tone shoulder compresses, so a large field of a saturated brand
  colour or a near-white renders a little softer than its hex (pure white comes out at 246 of 255 with the
  default bloom, 243 without it). When it has to match, sample a rendered still and adjust.

## Type: the voices

The template ships four voices, with their licenses in `public/fonts/`:

- **Grotesk: Archivo**, whose width (62–125) and weight (300–900) can animate. They come as static
  instances, six widths by four weights, so a change steps rather than glides, which on the beat reads as
  rhythm; a smooth stretch has to scale the outline (`textPath2D`).
- **Mono: IBM Plex Mono**, for code, figures and anything typed.
- **Serif: Cormorant Garamond**, a high-contrast Garamond drawn for display sizes.
- **Pen: the single-stroke EMS and Hershey fonts** (`src/engine/stroke.ts`), for words a pen or plotter
  writes on screen, in time with the voice.

Use the voices the piece needs; one is often enough. When the project needs a typeface these can't voice
(the brand's own, a script they don't cover, a display face the idea asks for), add it as `docs/ENGINE.md`
describes under "Adding a font". A brand's typeface is often licensed rather than free: use it only from
files the director supplies under a license that allows video, and otherwise the nearest voice, saying so.

## Layout: safe areas and minimum sizes

Sizes are logical px, the `size` in `video.json`, whatever the render scale.

**Safe areas,** checked 2026-10 against published templates. The vertical apps move their buttons with
updates, so look at a platform's current template when a layout is tight.

| Format | Frame | Keep text, faces and logos inside |
|---|---|---|
| 16:9 | 1920×1080 | title-safe, 5% in from each edge: 96 px at the sides, 54 px at top and bottom |
| 1:1, 4:5 | 1080×1080, 1080×1350 | 5% in from each edge: 54 px at the sides |
| 9:16 (Shorts, Reels, TikTok) | 1080×1920 | clear of the apps' buttons and captions: about 250 px at the top, 400 px at the bottom, 200 px at the right, 60 px at the left |

Backgrounds and motion run full-bleed; only what must be read or recognised stays inside.

**Minimum text size.** Text meant to be read should come out at about 16 px (CSS px) on the smallest
screen it plays on, so in the frame it needs 16 × frame width ÷ screen width:

| Frame | Smallest likely screen | Text meant to be read |
|---|---|---|
| 1080 wide (9:16, 1:1, 4:5) | a phone, about 390 px wide | 44 px |
| 1920×1080 | a laptop player, about 850 px wide | 36 px |
| 1920×1080 in a phone's feed | about 390 px wide | 80 px |

Smaller text is texture and can't carry information. Check sizes against this table on full-size stills:
a contact sheet is usually shown scaled down, so its thumbnails understate what a phone shows.

## Motion and post

- **Motion** in STYLE.md is a character in a few words (heavy and slow, springy, mechanical, snapping on
  the beat), so every scene author moves things alike. The craft behind it (eases from rest, moves
  through several keys, objects carried across a cut) is in `references/motion.md`.
- **Post** is set once in `POST`; scenes return per-frame changes on top (a flash on a hit, a punch-in).
  The engine's defaults are a clean image: a mild bloom above 1, everything else off.
- **Grain** changes every frame, and that costs bitrate: on one 15-second card it made the file about
  eight times larger than a still grain did. Use the least that survives encoding, or none.

## Avoid unless the piece calls for them

Copy this list into `docs/STYLE.md` and adapt it. These are what a model reaches for first, so they read
as generic: the average of what it has seen rather than a choice. When one is right for the piece, the
treatment names it and says why. The director's request always wins over the list.

Generic "AI video" looks:

- purple and cyan neon cyberpunk;
- glowing brains, robots, circuit boards and other stock "AI" imagery;
- Matrix code rain;
- lens-flare soup;
- generic particle nebulae;
- glitch effects and scan lines.

Archetypes models converge on when nothing steers them:

- a navy or near-black ground with ivory type and one amber accent, or teal, amber and violet on navy;
- starfields, drifting glow blobs, dot grids;
- broadcast rings, and a "signal" line with a pulse travelling along it;
- a centred circular spectrum or equalizer visualizer; a black sun or an eclipse in the middle of the frame;
- Ken Burns pans and zooms over generated stills;
- rounded translucent cards that glow, and titles in a neon gradient;
- a system font (Segoe UI, Consolas) as the voice;
- chrome nobody asked for: header and footer labels, progress segments, a small tracked label,
  decorative coordinates.
