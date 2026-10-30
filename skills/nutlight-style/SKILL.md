---
name: nutlight-style
description: "The Nutlight style: a house look for animated explainers made with code-video and soundtrack, with squirrel characters acting out ideas in luminous geometric worlds, a calm camera, transitions carried through the world, and music cut from the director's own library. Use it whenever the user names the Nutlight style (\"in the Nutlight style\", \"estilo Nutlight\") for a video, ideas or a prompt for one, its music or a change to it, and in any project whose docs/STYLE.md names Nutlight. Not for videos that don't name it, even ones with squirrels or other cute animals, or for another studio's or channel's look."
---

# nutlight-style

Nutlight is a house style for explainers: squirrels acting out ideas in luminous geometric worlds, a calm
cinematic camera, scenes that flow into each other, and produced music cut to the story. This skill is art
direction plus a code kit: code-video makes the picture, soundtrack the sound and video-ideas the ideas, each by
its own steps; this skill says what the style asks of each step, and its kit draws the cast and the stage they
live on, the same in every video, so the channel keeps one identity. The director's words outrank it. A video's content
is always its own: subject, script, story, settings, length and tracks. The style brings no scenes, places or
music from other videos. Paths that start with `references/` or `assets/` are this skill's; the rest are the
project's.

## What defines it
- **One illustrated world of simple geometry:** circles, rounded rectangles and arcs, crisp contours without
  outlines, volume from soft gradients, contact shadows and narrow highlights, glass with luminous edges.
- **Squirrels:** every character is the kit's squirrel (a big round head, a pear body, cream face and belly,
  an enormous curled tail), drawn by the same code in every video; each video casts its own names, furs, roles
  and gear.
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
- **Setup.** After init, copy `assets/kit/` into the project's `src/nutlight/` and `assets/references/`
  (eight images and README.md) into `docs/style/nutlight/`. Scene authors, critics, later sessions and anyone
  who clones the project then have both without this skill. Scenes import from `src/nutlight/`; its README is
  the guide.
- **Look.** First read `docs/style/nutlight/README.md`, the author's own description of the look and the
  motion, and look at the images that guide this video's settings. Then make two or three style frames of the
  key moment, built on the kit's Stage, rigs and squirrels, each a different idea of how to stage it. Compare
  each side by side with the nearest reference before picking. Then write
  `docs/STYLE.md` as references/look.md describes. A setting the kit's rigs lack gets its palette and light in
  `src/nutlight/palette.ts`; `src/look.ts` keeps only the engine's `bg`, `fg` and post, from the main setting.
- **Cast.** Cast each character from the kit (`CAST`, `FUR`, gear), with its own name: never a squirrel drawn
  anew, which drifts from the design within a video and between videos. Copy `assets/cast-sheet.ts` into the
  video's scenes and render it with this video's cast before scene authors start. A fur, gear or pose the kit
  lacks is added inside `src/nutlight/`, in the kit's construction, and checked on that sheet against
  references 01 and 02 (references/look.md, "The cast").
- **Sound.** Use soundtrack, with references/music.md: library first; generated music only after a yes, with
  its cost.
- **Build.** Each scene brief names its reference images, `docs/style/nutlight/README.md` and
  `src/nutlight/README.md`, and gives the full paths of references/look.md and references/motion.md. Hold each scene's stills against
  its references.
- **Critic.** Run it as code-video does, its first look as a stranger first. Then it reads
  `docs/style/nutlight/README.md` with the treatment and STYLE.md; add the checks at the end of look.md,
  motion.md and music.md to its prompt.
- **Direct.** A note that departs from the style wins and goes in Decisions in the director's words; the
  style's defaults never override a decision.

## Ideas, and later sessions
- **Ideas only** (video-ideas): keep "in the Nutlight style" in the prompt it writes, and offer ideas the
  style can stage, such as a mechanism as a place where characters work. Nothing gets built.
- **A later session** in a Nutlight project reads `docs/STYLE.md` and `docs/style/nutlight/` before a change.
  If either folder (or `src/nutlight/`) is missing, copy it in. A project's kit is its own copy: a newer
  skill's kit goes in only when the director asks, since it can change how finished videos look.

## Read when
- assets/kit/README.md (in a project, `src/nutlight/README.md`): the kit: a scene, rigs, the squirrels, props,
  structures, the camera and transitions, the Stage.
- references/look.md: construction, light and value, palettes, depth, the cast, words in the world,
  STYLE.md for a Nutlight project, checks.
- references/motion.md: explaining by doing, acting, camera, transitions, checks.
- references/music.md: where the music comes from, choosing tracks, building and mixing a score from
  several, checks.
- assets/references/README.md (in a project, `docs/style/nutlight/README.md`): the author's own description
  of the look and the motion, and which kinds of scene each of the eight images guides. Read it before the
  style frames, and again whenever a scene's look is in doubt.
