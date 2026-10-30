---
name: nutlight-style
description: "The Nutlight style: a house look for animated explainers made with code-video and soundtrack, with squirrel characters acting out ideas in luminous geometric worlds, a calm camera, transitions carried through the world, and music cut from the director's own library. Use it whenever the user names the Nutlight style (\"in the Nutlight style\", \"estilo Nutlight\") for a video, ideas or a prompt for one, its music or a change to it, and in any project whose docs/STYLE.md names Nutlight. Not for videos that don't name it, even ones with squirrels or other cute animals, or for another studio's or channel's look."
---

# nutlight-style

Nutlight is a house style for explainers: squirrels acting out ideas in luminous geometric worlds, a calm
cinematic camera, scenes that flow into each other, and produced music cut to the story. This skill is art
direction only. code-video makes the picture, soundtrack the sound and video-ideas the ideas, each by its own
steps; this skill says what the style asks of each step. The director's words outrank it. A video's content
is always its own: subject, script, story, settings, length and tracks. The style brings no scenes, places or
music from other videos. Paths that start with `references/` or `assets/` are this skill's; the rest are the
project's.

## What defines it
- **One illustrated world of simple geometry:** circles, rounded rectangles and arcs, crisp contours without
  outlines, volume from soft gradients, contact shadows and narrow highlights, glass with luminous edges.
- **Squirrels:** every character is a squirrel of one design (a big round head, a pear body, cream face and
  belly, an enormous curled tail), and each video casts its own names, furs, roles and gear.
- **Light with a source and depth in three planes:** warm characters against cooler or darker worlds, a
  palette for each setting, deep near-blacks, the brightest light on the action, a dark framing foreground
  and hazy far layers.
- **Ideas acted out:** what the voice says, a character or a thing does, with a visible result; words
  live in the world, on signs and screens.
- **Measured, living motion:** characters that breathe and blink, a camera that drifts and settles, and no
  hard cuts.
- **Music:** produced instrumental tracks, mostly from the director's library, cut to the story's turns,
  clearly audible under the voice, ending music-led.

The director named this style, so what defines it is theirs. Navy and teal worlds, glowing screens and
luminous glass are not Avoid items here (code-video's style template: a named style asks for what defines
it). The rest of that list still applies.

## At each step of code-video
- **Brief.** The treatment names the style in its Look. It picks settings for this subject: new places are
  welcome, and the reference images' own places appear only when the subject calls for them. Its Sound gives
  the music plan (references/music.md). When the director hasn't said where their music library is, ask in
  the brief's message and keep building the picture.
- **Setup.** After init, copy `assets/references/` (eight images and README.md) into the project's
  `docs/style/nutlight/`. Scene authors, critics, later sessions and anyone who clones the project then have
  them without this skill.
- **Look.** Make two or three style frames of the key moment, all in this style, each a different idea of how
  to stage it. Compare each side by side with the nearest reference before picking. Then write
  `docs/STYLE.md` as references/look.md describes, and `src/look.ts` with a light rig for each setting.
- **Cast.** Before any scene, build the cast as one shared module and render its sheet: turnaround,
  expressions, arms in the poses the scenes need. Check it against references 01 and 02 (references/look.md,
  "The cast").
- **Sound.** Use soundtrack, with references/music.md: library first; generated music only after a yes, with
  its cost.
- **Build.** Each scene brief names its reference images and the cast module, and gives the full paths of
  references/look.md and references/motion.md. Hold each scene's stills against its references.
- **Critic.** Run it as code-video does, its first look as a stranger first. Add the checks at the end of
  look.md, motion.md and music.md to its prompt.
- **Direct.** A note that departs from the style wins and goes in Decisions in the director's words; the
  style's defaults never override a decision.

## Ideas, and later sessions
- **Ideas only** (video-ideas): keep "in the Nutlight style" in the prompt it writes, and offer ideas the
  style can stage, such as a mechanism as a place where characters work. Nothing gets built.
- **A later session** in a Nutlight project reads `docs/STYLE.md` and `docs/style/nutlight/` before a change.
  If the folder is missing (a project started without it), copy it in.

## Read when
- references/look.md: construction, light and value, palettes, depth, the cast, words in the world,
  STYLE.md for a Nutlight project, checks.
- references/motion.md: explaining by doing, acting, camera, transitions, checks.
- references/music.md: where the music comes from, choosing tracks, building and mixing a score from
  several, checks.
- assets/references/README.md: the eight images, the author's own description of the look and the motion,
  and which kinds of scene each image guides.
