# Style template

The look every video in a project shares, written to `docs/STYLE.md` and mirrored in code: the palette
and post defaults in `src/look.ts` (`PALETTE`, `POST`), the fonts in `src/engine/type.ts`. Write it once
the look is settled, from the director's material or the style frame picked by looking, and show its
palette and type with that frame.
Later videos reuse it; one that departs from it says how in its own treatment. Change the doc
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
  copy gives the tone; its pages are where the product's real screens come from (`references/images.md`).
- **Words** ("dark and engraved", a film, an era): that look is the director's. The style frames try ways
  to make it, all inside what they said; what they didn't say (palette, type, light) is yours.
- **None of these:** the look is yours (SKILL.md, "When the look is yours"). Start from the idea: what the
  piece should make a viewer feel and the image that carries it, the music's character, a typographic idea,
  a material or a light, a constraint the piece sets itself. Not from the genre (the look that comes first
  for "night", "tech", "music" or "data" is the one every other video already has), and not from the
  subject's props drawn flat on a plain ground. Try two or three directions as style frames: the key moment
  in the engine, each made a different way (a lit form, a flat graphic field, a treated photograph, type
  alone: whatever the idea suggests), not one layout recoloured; one scene file and a still each, no sync.
  Keep the one that carries the idea at a glance and that no other video of this subject would have; the
  others go in the treatment's Also considered, so the director can switch.

Ask only for what's missing, such as the logo as a file or whether the brand's typeface may be used in
video. The director's material wins over everything here, and what they decide or turn down for the whole
project goes into Decisions in their words. A small project's STYLE.md can be fifteen lines: a palette, a
type line, the decisions and the avoid list.

## The skeleton

```markdown
# Style: <project>

From: <the brand picture, URL or treatment it was derived from>, <date>.

## Palette (`src/look.ts` PALETTE)
| Key | Hex | Role |
|---|---|---|
| `bg` | | the engine's base (its flash, invert and crop marks use it); a frame need not be figures on a ground |
| `fg` | | its contrast to `bg`: what reads against it |
| <`key`> | | <each other colour the piece needs, named for its job here; as many as the idea wants> |

Glow: <the keys a scene may push above 1, if any>. <Light and dark: where the frame's values sit, and
which moments turn.>

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

## Decisions
<What the director chose or turned down for the whole project, in their words, with the date. Every session
reads it before a change. What they turned down stays out whatever a treatment argues; it may also be listed
in Avoid, marked (director).>

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
- Rights: only fonts, images and marks the project owns or licenses, each listed in
  `videos/<video>/assets/SOURCES.md`; a brand's assets as given. Draw your own version of whatever the
  words name (a monster, a myth, a machine); what's out is copying a particular artist's design, a
  franchise's character or another company's product interface. The director's own product appears as
  itself, its real screens as given or captured, never a lookalike (`references/images.md`).

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
- Renaming or deleting a key breaks every scene that uses it (`C_<KEY>`, `LIN.<key>`, `rgba('<key>')`):
  update those scenes. The template's example video (`videos/example/`) keeps its own palette, so a
  new palette never breaks it: leave it, or delete it when the director asks.
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
- **Grain** is a look like any other. Grain that changes every frame costs file size (about eight times
  a still grain's on one 15-second card), so when the look wants it, use the least that survives encoding.

## Avoid unless the piece calls for them

Copy this list into `docs/STYLE.md` and adapt it. These are defaults, not choices: what models reach for
when nothing steers them, so each reads as generic. One is fine when the director asks for it or the
treatment argues for it, except an item marked (director): that is their decision, and no treatment brings
it back. The list says what is tired, not what is good: steering clear of all of it is not a look, and
turning one item inside out gives its twin, which is listed too.

- a navy or near-black ground with ivory or bone type and one warm accent, often glowing; or teal, amber
  and violet on navy;
- its twin: a warm off-white paper ground, near-black ink type and one red accent (paper grain or a
  vignette doesn't make it another look);
- either one's skeleton in other colours: one flat ground, one ink, one accent, figures placed on it;
- stock "AI" and tech imagery: purple and cyan neon, glowing brains, robots, circuit boards, code rain,
  glitch and scan lines;
- the genre's emblem as the whole idea: a turning record for jazz, a skyline at night for lo-fi, a neon
  sign for synthwave, a rocket for a launch;
- slides: a heading at the top left, boxes, icons and arrows below, captions that repeat the voice, on an
  empty flat ground;
- lyrics as captions: the sung line set over a plain ground, or over an animated background that would fit
  any song;
- one composition for every scene: a headline beside or above a diagram, captions centred over a field;
- filler light: starfields, drifting glow blobs, generic particle nebulae, lens-flare soup, dot grids;
- a centred circular spectrum or equalizer; a black sun or an eclipse in the middle of the frame;
- Ken Burns pans and zooms over stills;
- rounded translucent cards that glow, and titles in a neon gradient;
- a font used for everything because it was there (the template's Archivo or IBM Plex Mono, a system
  font);
- chrome nobody asked for: header and footer labels, progress segments, a small tracked label,
  decorative coordinates.
