# The pictures

How the three thumbnails get made: the ideas, where each picture comes from, how it is finished and set in
type, and how it is judged. Read it before making or changing a thumbnail. `<skill>` is this skill's folder;
code-video is the skill beside it; other paths are the project's.

Contents: What a thumbnail has to do · The niche, and a format that worked · Ideas · Where the picture comes
from · Finishing · Type · Looking as viewers do · The critic · What went wrong before

## What a thumbnail has to do

A frame is made for motion and for what comes before and after it. A thumbnail stands alone, among strangers,
100 to 500 px wide (about 344 in a laptop's home grid), beside its title, and is read in less than a second. So:

- **One idea a stranger gets at once:** a subject big enough to read small, in a situation that makes them want
  the video (a question asked and its answer withheld, a machine looking back, a thing about to break). Hierarchy
  matters, not a count: a picture with a face, a computer, a line of text and ten small labels works when one
  thing dominates and the rest stays small at the edges.
- **The video's own world, staged better:** its real objects, palette and light. Spectacle the video doesn't
  have (motifs it never shows, a generic "AI" look) promises another video; on one project a round of
  generated look-alikes with confetti and music notes was rejected in minutes, and the thumbnail that shipped was
  the video's own computer, rendered in its engine.
- **Visible in its feed:** brightness, colour and edges set against the videos beside it and against YouTube's
  pages, near-black (#0f0f0f) and white. A dark tile melts into the dark page unless light holds its edges.
- **Its own bet:** each of the three is a different reason to click (another subject, situation or layout, with
  text or without), so a test between them teaches something. Three takes on one layout teach nothing.
- **Then the video takes its place:** pointing at it on a computer plays the video muted with captions, and
  phone feeds play it inline, often by default. The first seconds are part of the package; when they don't carry
  the promise on, say so in the hand-off (the video stays as it is here).

## The niche, and a format that worked

Before the ideas, when the network is allowed: the videos a viewer of this one would see beside it, and the
ones among them whose package did best. A few minutes of it pays twice. Nine searches once changed a whole
set's type size, brightness and colour. And the thumbnail one creator preferred, over more than a dozen made
from the video's own ideas, took its format from a video on the same subject.

- **Find 10 to 30** on the same subject, for the same audience: a web search in the video's language and in
  English (the words people would type, the subject's common names), the channel's peers, links the user
  gives. `bun <skill>/scripts/youtube.ts niche <links...> --video <video> --lang <language>` saves their titles,
  channels and full-size pictures in `out/<video>/youtube/niche/` (other people's images: never in the
  project's assets or in git). With a YouTube Data API key in `YOUTUBE_API_KEY` (free), `--search "<words>"
  --n 50` and `--channel <@handle>` find them too, and each video gets its views as a multiple of its channel's
  average per video and of its subscribers, highest first. Nothing scrapes youtube.com: YouTube's terms forbid
  automated access outside its APIs. Without a key, the views a web search shows, beside a tracker's figures
  for the channel (Social Blade, vidIQ), give the same multiples roughly; the hand-off can say a free key would
  make them exact.
- **What worked:** far more views than the channel usually gets. vidIQ's outlier score starts at 2x the
  channel's average and tops out above 10x; more views than the channel has subscribers says the same, and a
  recent video says it more than one that had years. Its package (subject, title and picture together) brought
  viewers the channel alone didn't: evidence about a package, observational, not proof of what its picture did.
- **Fit before numbers.** Learn from a video whose picture shows something this one has too: its mechanism, its
  moment, its question. A format that would make this video promise another (a shocked face where it has none,
  a result it doesn't show) belongs to another video. With no outlier that fits, the subject's most-viewed video
  that does is next best; say which it was. The preferred thumbnail above followed 3Blue1Brown's guest video by
  Welch Labs on how AI makes images: four panels from noise to picture between two arrows. With 2.2 million
  views against that channel's average of about 3 million, it was the subject's big video, not an outlier. Its
  layout was the mechanism the video explains, and the video's own frames could show it.
- **One of the three takes that format:** what it shows and how (the layout, the panels and their order, the
  arrows, how much text and where, its colours), rebuilt from this video's own material, in the channel's type,
  with this video's words. Not its pixels, its logo, mascot or characters, its creator's face, or its words: a
  format is shared on YouTube, a picture is someone's work, and this one should read as the channel's own take,
  not pass for that video, which may sit beside it in the up-next column. Match it side by side (the same
  region cropped from each), and note in `NOTES.md` which video it follows, its link and its numbers. The other
  two stay the video's own bets, so a test of the three asks whether the niche's format wins on this channel.
- **When nothing fits** (no network, a subject no one has covered, formats that would mislead), that option is
  another of the video's own bets, and the hand-off says why.
- **Stop once it has informed the set:** those nine searches took five minutes. The same folder serves the
  preview.

## Ideas

- **Start from the promise:** one line for what the video gives a viewer, then the pair: the picture shows or
  asks, the title promises or answers (references/youtube.md). Write title candidates alongside the pictures.
- **Rough out about six ideas, visually** (quick crops of plates, placeholder type, a code sketch; one of them
  the niche's format), not six descriptions: composition problems only show on a picture. Judge them small
  beside the working title, then finish three. A request that already sets the ideas, or changes one thing (a
  font, a word), doesn't restart this.
- **Breadth before polish.** An idea found in twenty seconds can beat a night of finishing: one project's quick
  first thumbnail already held the idea that won the long round after it.
- **What the user named** (a scene, a shot, an object) gets a properly cropped try before it's dropped: a scene
  dismissed on a weak wide crop once won the final vote.
- **Words are optional.** No text was the most common single pattern among 500 breakout thumbnails in vidIQ's
  2026 study (observational, like every study of this kind); when the words are yours to choose, let at least
  one option try few or none. When used, they say what the title doesn't: a question, a number, a sound bite,
  a label.
- **Fixed words aren't a fixed layout.** Text the user decided keeps its words; its size and place still serve
  the picture. When rigid type rules (a minimum height, wide gutters) made every option the same wall of text and
  shrank the subject, craft scores went up and the pull to click went down.
- **Show the user early:** the rough sheet and the titles you're weighing go in a message before the long
  finishing work, so they can redirect; then go on.

## Where the picture comes from

**The video's own pixels, clean.** Find moments with `bun scripts/render.ts sheet --video <video> --n 24` (or
`--times`), then render the chosen ones once, as a batch: `bun scripts/render.ts stills --video <video> --t
<a,b,c> --scale 2 --out out/<video>/youtube/frames` (3840x2160 for a 1080p video, crisp: one sub-frame; `poster`
adds motion blur). Choose by content and pose: a scene's midpoint can be mid-fade. A frame carries what the video
draws over it (captions, a HUD dot, citations, lower thirds): render without those entries (`--only`), use the
plate the scene itself loads from `videos/<video>/assets/` (often the cleanest source, sometimes with a depth
map), or paint them out. `--size 1280x720` is refused for a 16:9 video: render big and scale down. A video
made elsewhere gives its frames through ffmpeg (`ffmpeg -ss <seconds> -i <video> -frames:v 1 frame.png`), at
its own resolution and compression: crop less, and lean more on finishing.

**A plate staged for the still, in the engine.** When the frames don't carry the idea (the subject too small, a
camera move), stage it: a video of its own, `videos/<video>-thumbs/` (silent, one short slot per plate; the name
sorts after the video's, so it doesn't become the project's default, except beside `example`, which any other
video outranks: there, the example's commands name `--video example`, its links `?v=example`, and the hand-off
says so), whose scenes import the video's scenes and helpers without changing them, rendered with
`stills --only <slot> --scale 2`. It is a real video to the preview, `verify` and git, so its TREATMENT.md says
what it is for. Keep it to the plates that need it, render them one
at a time, and never while the video's final render runs.

**The user's photos.** A face lit by the scene, looking at the subject or at the viewer, with an expression the
video earns. A cut-out pasted with a white outline and a stock shocked stare, reused from an old thumbnail, read
as a sticker and was turned down. Ask for fresh photos when a face would help. `docs/CHANNEL.md` says whether
the user's face and name appear at all.

**Generated images, after a yes** (SKILL.md, Fixed). code-video's `scripts/imagegen.py` is the way in either
tool: `uv run <code-video>/scripts/imagegen.py generate <name> --out videos/<video>/youtube/assets --size 2560x1440
--ref <plate.png> --prompt "..."` prints what it would make and what that costs, and spends nothing; with `--yes`
it runs, once the user has said yes (its `--help`, and code-video's references/images.md for prices, `--takes`,
`pick`, `--transparent` and what a reference adds to the cost). Use it to re-stage the video's real elements
photographically (a plate or frame as `--ref`), the way one creator made their own candidate, not to invent
look-alikes. In Codex without a key, its built-in image generation draws on the plan's limits (several times
faster than text turns): spending too, and its prompt goes word for word into `<name>.prompt.txt` beside the
file. Its pictures come out about 1672x941, enough for 1280x720 but not for 3840x2160, and it edits a frame once
the frame is opened in the conversation (`view_image`). Words drawn by an image model come out
misspelled ("vatio" for "fatio"): set every word in code, and read back any text a generated picture contains.
A local model the user already runs (ComfyUI, say) is free; installing one isn't part of making a thumbnail.
For a monetized channel a model's licence matters as much as a font's: non-commercial ones (FLUX.2 dev, RMBG-2.0,
4x-UltraSharp, InsightFace) stay out.

**Code.** Type, shapes, light, a redacted reply bubble, an interface: whatever the idea needs that no frame has.

**Cut-outs.** Best rendered from the engine with only the subject's entries; else `uv run --with
"rembg[cpu,cli]" rembg i -m birefnet-general -dc in.png out.png` (`-dc` cleans colour fringes;
`birefnet-portrait` for a person; MIT, about 1 GB downloads once; rembg's default model needs a paid licence for
commercial use) and the edge checked over a flat colour.

**Brands and people.** A brand character the user asks for (a mascot) is modelled or drawn, not lifted from
someone's photo, and noted in `youtube/SOURCES.md`. Anyone else's face or likeness appears only with their
consent (a guest who agreed, with their photo); a famous name in a title as a comparison is words, not a
likeness, and imitating a film's poster or stills stays out: that borrows the film's identity, where a format
from the niche, rebuilt from the video's own material, borrows a way of showing.

## Finishing

- **Recompose:** crop in until the subject reads at 168 px; paint out clutter; and where the picture needs it,
  light the subject from the scene's own sources, lift it off the ground (a rim of light, a darker ground), grade
  so it holds on both pages, bind the layers (a shared grain or haze). Each option is a finished picture, not a
  frame with words on it; what finishing it needs comes from looking at it, not from a recipe.
- **Tools:** whatever does the job. An HTML page through `shoot` is quickest for layout and type (`@font-face`
  from `/public/fonts/...`, `-webkit-text-stroke` with `paint-order: stroke fill`, layered `text-shadow`,
  `filter`, `mix-blend-mode`, `mask-image`, an SVG `feTurbulence` grain); Python with numpy and Pillow for pixel
  work (compositing in linear light, relighting from a depth map); the engine for anything it already draws.
  Words go in the page, not Pillow: on Windows it sets them without the face's kerning ("AV", "To" gape).
  Work from plates at 2x, so the finished 1280x720 is downsampled, never upscaled.
- **Keep what rebuilds it** beside the PNG: `thumbnail-N.html` (or `.py`) and `youtube/assets/`. Not a Bun or
  Node script (one that imports `node:` modules or uses Bun) anywhere in `videos/`: the project's type check
  (`bun run check`) reads that folder as browser code and fails on one. Work files go in `out/<video>/youtube/`.
- **On Windows:** another program can hold a PNG open; write to a temporary name and rename. Python prints
  accented text once the environment variable `PYTHONIOENCODING` is `utf-8`.

## Type

- **The channel's typeface** (`docs/CHANNEL.md`), at the weight and width it uses, not a pick of the moment: on
  one project a well-made set came back for its font alone. With no channel style yet, a heavy face that reads
  small, from the project's fonts or an OFL file copied with its licence into `youtube/assets/` (not registered
  in the engine, which would load it for every video).
- **Few words, big:** the main words at about 12 px or more at 168 px wide (`shoot` reports each block; a set
  that read well small had 14 to 19 px). One or two lines; few colours in the type; a dark margin around
  letters that sit on busy ground.
- **Details that show small:** line spacing that clears accents (Ê, Ã: stacked capitals need a line height of
  at least the face's accent top, about 1.1 for Anton); kerning a face lacks (a "?" after an
  "A"); word spaces wide enough that "A IA" stays two words at 168 px; every accented letter looked at in the
  image (`shoot` names characters the face lacks).
- **Text can be a thing in the scene** (a slip of paper, a screen) as well as a caption over it.
- **Corners:** the duration badge covers the bottom right everywhere (keep the last 256x166 px of 1280x720 free;
  `shoot` names a block that enters it); desktop hover icons sit top right; corners are rounded (about 45 px at
  1280 wide) and a red bar runs along the bottom for a viewer who began the video. Nothing there that matters.

## Looking as viewers do

- **`preview`** puts each option where viewers meet it (sizes measured on YouTube in 2026): every size from
  search's 500 px down to a playlist's 100 on both pages; a home row (344 px, three across on a laptop), the
  up-next column (250 px) and a phone feed (390 px) with the title wrapped and cut as there; and a search result
  with as much of the description as search shows. Look at each at its own size; a sheet of sizes alone once
  passed text that the feed then showed small and too dark.
- **Beside the niche:** `preview --niche out/<video>/youtube/niche` puts the niche's videos around each option.
  Leave out what's off-topic and give the others their real titles, as yours has. The option that follows a
  niche video's format is seen beside that video too, where it should read as this channel's.

## The critic

Once the three are finished, a fresh subagent that starts without this conversation (in Codex, one spawned
without the thread's history), given only the preview images and the title, answers:

- What does each option promise; what would you expect the video to be?
- What reads first at 168 px?
- What is confusing, illegible, ordinary or misleading?
- Does each give its own reason to click?
- Which one change would help most?

Then tell it what the video really shows and ask whether each promise is kept. With no subagent at hand, look
at the preview again yourself as a stranger would, after the rest is done, and say the critic was you. No CTR
guesses, no averaged scores: measures are guardrails, not targets (a salience score once pulled a design toward
the cliché its brief had ruled out). Fix what it finds, look again, and stop when only preferences remain. A
last look at full size after the final polish catches what small sizes hide (a streak, a halo, banding, a
leftover caption, a typo).

## What went wrong before

In the packaging sessions this skill was built from (audara-studio's docs/history.md has the evidence):

- **Too little:** one round, the first idea, text too small, tiles too dark, a font the channel doesn't use, a
  sheet of sizes taken for a feed test, no title or description.
- **Too much:** nearly ten hours and sixty agent runs for one set, six of those hours on an option that lost;
  sixteen polished mockups before anyone looked; byte-reproducible scripts for four finalists before the user
  had chosen one; four hours with nothing shown to the user.
- **Off the video:** spectacle and motifs the video doesn't contain; a pasted face; every option the same text
  block on the left and subject on the right.
- **Rules nobody gave:** "no generated images" written into briefs when the creator had approved them, and "no
  mascot" when they had published one. Read the user's earlier words before ruling something out, and ask.
