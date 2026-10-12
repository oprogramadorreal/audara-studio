---
name: youtube-package
description: "Makes a video's YouTube package: three thumbnail options (1280x720 PNG) designed together with one title, plus the description with chapters and the tags, written into the project. Builds the art from the video's own frames and engine, generated images (asking before spending) or anything at hand, and judges each option small, in a mock feed, beside the title. Use it whenever the user wants a thumbnail, a YouTube title, description, chapters or tags for a video, wants it ready to upload, or wants one of those changed, even if they only say \"thumb\", \"miniatura\" or \"make it clickable\". Not for making or changing the video itself, or title cards and text inside it (code-video), for choosing what video to make (video-ideas), or for images unrelated to a video."
---

# youtube-package

The user is about to publish a video. Make what decides whether people click and stay: three thumbnail options and one title made as a pair, then the description (with chapters) and the tags, in `videos/<video>/youtube/` (outside an audara project, a `youtube/` folder beside the video). "A thumbnail" or "get it ready for YouTube" gets the whole package; a narrower request gets that part (a title, the description, one option changed). Their words outrank this skill. `<skill>` is this skill's folder; other paths are the project's.

## Fixed
- **The pair promises what the video delivers, early.** The first seconds keep the viewers who clicked, and play in the thumbnail's place on hover and in phone feeds. Metaphor and new art are fine; an invented result, quote or endorsement isn't. When the opening doesn't pay off the best promise, say so and offer the change (code-video makes it); never change the video here.
- **Money waits for a yes.** Generated images cost: an OpenAI key, or Codex's built-in images on the plan's limits. Say what you'd make and what it costs first. A key in the environment isn't a yes; the user's own words are ("use generated images", a budget), earlier ones in the project included.
- **Rights:** fonts, images and footage keep their licences; no one's face or likeness without their consent; every file from outside gets a line in `youtube/SOURCES.md`. API keys stay in the environment.
- **Their words.** A title or thumbnail text they decided ("the title will be", "I want the text") is used exactly; a stronger version goes beside it with why, never in its place. One offered as a start ("something like", "a suggestion") is yours to keep or improve, saying what changed.

## The bar
Three options a stranger would notice in a crowded feed at 168 px wide and read in a second: three different bets (subject, situation, layout, words or none), not one design restyled, all with the same title (YouTube's Test & Compare tests up to three). The title says what the picture doesn't; together they open one question the video answers. Each picture is the video's own world, staged better: a frame with words on it is a start; crop, simplify, relight and grade until it reads small. "Go all out" means more ideas, finished art and honest looking, not more paid calls or more rounds.

## A session
Keep this checklist in your notes. Explore once (about six ideas, three finished, one critic round); fixing what the check or the critic finds is finishing, not a new round.
- [ ] **The video.** Its treatment (idea, words, Decisions, Never claim), script or lyrics, timeline, `docs/STYLE.md`, and its key moments seen (`render.ts sheet`). One line: what a viewer gets from it, and what its first 30 s show. Write in the video's language.
- [ ] **The channel.** `docs/CHANNEL.md`: name and link, language, thumbnail style (typeface file, colours, faces, words), title voice, links and credits it repeats, the user's decisions apart from what you inferred. Without it: what the user said, an earlier project they point to, else ask once for its link and go on meanwhile; its recent thumbnails and titles show what its audience knows. Write down what you learn.
- [ ] **Ideas.** About six rough pictures (quick crops, placeholder type) and 10 to 20 titles, together; then one title (into `youtube/title.txt` at once: the preview reads it) and three pictures that differ in what the viewer sees and why they'd click. Post the rough sheet and the titles you're weighing, and go on. Reasons in `NOTES.md`.
- [ ] **Art.** Each idea gets the means it needs (references/art.md): the video's frames rendered at 2x without its captions, a plate staged in the engine, the user's photos, generated images after a yes, code. Type in the channel's typeface.
- [ ] **Finish** each as `youtube/thumbnail-N.png`, 1280x720 unless asked otherwise, its source beside it so a word can change later: an HTML page through `shoot`, or any pipeline.
- [ ] **Look as viewers do.** `preview` (again after any change), and look at every image. Then a critic: a fresh subagent that starts without this conversation, given only the preview images and the title, answers: what does each promise; what reads first at 168 px; what is confusing, illegible, ordinary or misleading; does each give its own reason to click; which one change would help most. No subagent: look again yourself, and say so. A last look at full size.
- [ ] **Words.** `description.txt` (plain text, short unless asked) and `tags.txt`, only what gets pasted (references/youtube.md). Chapters from timing data checked against the final cut, never guessed.
- [ ] **Check.** `check --full` for the whole package (plain `check` for a part); fix every FAIL.
- [ ] **Hand-off**, in the user's language: your pick and why, in a line; each option's idea; the title and two runners-up with lengths; the description's first line and chapters; files and preview images; what the check and the critic found; costs; what's theirs to decide (the pick, a Test & Compare run, disclosure, an opening that doesn't pay off). Their decisions go in `NOTES.md` in their words (channel-wide ones in `docs/CHANNEL.md`); read them before any change.

## Commands
From the project folder; `--help` has every option.

| Step | Command |
|---|---|
| Find moments | `bun scripts/render.ts sheet --video <video> --n 24` |
| Plates at 2x | `bun scripts/render.ts stills --video <video> --t 12.5,40 --scale 2 [--only <entries>] --out out/<video>/youtube/frames` |
| A page to PNG | `bun <skill>/scripts/youtube.ts shoot videos/<video>/youtube/thumbnail-1.html` |
| Videos beside it | `bun <skill>/scripts/youtube.ts niche <links> --video <video>` (optional) |
| As viewers see it | `bun <skill>/scripts/youtube.ts preview --video <video> --channel "<name>" [--niche <dir>]` |
| Check the package | `bun <skill>/scripts/youtube.ts check --video <video> [--full]` |
| Generated image | code-video's `scripts/imagegen.py` (references/art.md) |

`shoot` serves the project at `/` (a page loads `/public/fonts/<file>.ttf`) and reports text sizes at 168 px, the badge's corner, and fonts that didn't load or lack a character. `preview` writes to `out/<video>/youtube/`. Outside an audara project, pass the package folder, not `--video`.

## Read when
- references/art.md: the pictures (ideas, plates, staging, photos, generated images, finishing, type, the niche, the critic).
- references/youtube.md: the title, description, chapters and tags, and YouTube's sizes, limits, testing and policy, with sources.

## Gotchas
- A frame carries the video's captions and HUD: render the plate without those entries (`--only`), or use the asset the scene loads.
- `render.ts --size 1280x720` refuses a 16:9 video (same shape): render `--scale 2` and scale down.
- Image models misspell: every word is set in code.
- A Bun or Node script (importing `node:` or using Bun) doesn't go in `videos/`: `bun run check` type-checks it for the browser and fails. HTML or Python there; scratch in `out/`.
- Plates staged in the engine go in a video named `<video>-thumbs`, so it never becomes the default video.
