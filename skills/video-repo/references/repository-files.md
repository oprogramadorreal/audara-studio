# The repository's own files

What each file says, for whom, and an example of the ignore and attribute rules. Fit each to the project:
a one-video title card needs a short README; a music video with generated footage needs more.

## README.md, for people

The first thing someone sees on GitHub, and the one file a person reads before running anything. init wrote
one with the commands to watch and render; keep those and build around them. What it usually covers, in an
order and a length that fit the project:

1. **What it is.** The project's name as a title, then the videos in a sentence or two each: the subject,
   the length and format, where it's published. Only facts the user gave or the project holds: a published
   title or link nobody gave is left out, not guessed.
2. **How it was made.** Made in code with [audara-studio](https://github.com/oprogramadorreal/audara-studio)
   (scenes in TypeScript with WebGL/GLSL, three.js and Canvas2D), and what isn't code: the song, the voice,
   generated images or footage, each with where it came from, pointing to `assets/SOURCES.md`.
3. **Run it.** The prerequisites with the versions the clone check used (bun, Google Chrome, ffmpeg with
   libx264; uv only when the project's own tools need it), then the commands from a fresh clone:
   `bun install --frozen-lockfile`, the preview, `verify`, the render and where its MP4 lands. Say that
   render.ts looks for Chrome and reads `CHROME_PATH` when it's installed somewhere else.
4. **What's where.** A small table of the folders that matter (`videos/<video>/`, `src/engine/`,
   `src/look.ts`, `public/fonts/`, `scripts/`, `docs/`, `tools/` when there is one).
5. **What isn't in git.** One paragraph: renders and caches are made again by the commands above; anything
   a clone has to restore before it renders, said plainly; a link to `docs/REPOSITORY.md`.
6. **Credits and licenses.** The engine's license (`src/engine/LICENSE`), the fonts' (`public/fonts/`), and
   third-party media's terms.

Write it for a person who has never heard of audara-studio: no agent vocabulary ("the director", "the f(t) rule",
"treatment" without saying it's the video's plan), no absolute paths, and no claim the checks didn't
show. "Verified on a fresh clone on 2026-10-11 (bun 1.4.2, Chrome 154, ffmpeg 9.0)" is a fact; "renders
identically everywhere" is not one: the GPU, browser and encoder can change pixels. The clone check runs on
the commit, so its line goes in afterwards, in a commit of its own.

## docs/REPOSITORY.md, for whoever works on it next

What a later session, human or agent, needs before adding, moving or deleting a file:

- **Kept, and why:** a table of paths or patterns and the reason (renderer input, source of the mix,
  generated asset whose bytes can't be made again, timing data, request records).
- **Ignored:** outputs and caches, and the command that makes each again.
- **Left out:** duplicates, intermediates, rejected takes: the path, why, and how to rebuild it when it can
  be rebuilt.
- **Too big for GitHub:** for each file over 100 MiB, its path, size in bytes, SHA-256, what it's for, how
  to get it back (no credentials, private paths or expiring links), and whether a clone renders without it.
  When there are none, say so with the largest file kept and its size, so the next person knows the margin.
- **Adding media:** keep what a video loads or needs to be changed, ignore what's made, check the size
  first (GitHub warns over 50 MiB and refuses over 100 MiB), add its line to `assets/SOURCES.md`, and look
  for keys and personal details before committing (audara-studio's video-repo skill and its audit do both).
- **How it was checked:** the date, the clone check that ran and what it found.

## AGENTS.md: a Repository section

Outside the `<!-- audara:begin -->` / `<!-- audara:end -->` markers, so init's reruns keep it, with a
CLAUDE.md beside AGENTS.md that imports it (`@AGENTS.md`), as init writes one: Claude Code reads CLAUDE.md,
Codex reads AGENTS.md. A few lines, for example (before a video exists, without the docs/REPOSITORY.md
pointer, which comes with the full pass):

```markdown
## Repository

- What's in git and why, what's left out and how to get it back: `docs/REPOSITORY.md`. Read it before
  adding, moving or deleting media.
- Renders (`out/`), caches (`.audara-cache/`), dependencies and keys (`.env*`) stay out of git.
- A file a video needs is committed unless it's over 100 MiB; then it stays out and gets its entry in
  `docs/REPOSITORY.md`. Generated or paid media is kept as a file.
```

## .gitignore

init's entries stay; extend them with what the sorting found. Rules without a leading slash match at any
depth (`out/` also ignores `videos/intro/out/`; `/out/` only the top one). Name a file left out by its
path, so the rule doesn't catch the next one a video needs. A rule doesn't touch what git already tracks:
in a repository that committed one before, `git rm --cached <path>` (`-r` for a folder) takes it out of
the index and leaves it on disk.

```gitignore
# renders, caches, dependencies (init's)
node_modules/
out/
dist/
.vite/
.cache/
.audara-cache/
*.tsbuildinfo
*.log
# keys
.env
.env.*
!.env.example
# other tools' local files and output, as the project has them
.venv/
__pycache__/
.playwright-mcp/
tools/manim/media/
# left out on purpose (docs/REPOSITORY.md says why)
/song (1).mp3
videos/launch/assets/older/
videos/launch/assets/footage-master.mov
```

## .gitattributes

Text checked out with LF everywhere, so a script written on Windows still runs on macOS and Linux and diffs
don't show every line changed; media and fonts marked binary, so git never touches their bytes. List the
types the project has.

```gitattributes
* text=auto eol=lf
*.png binary
*.jpg binary
*.jpeg binary
*.webp binary
*.wav binary
*.mp3 binary
*.m4a binary
*.flac binary
*.mp4 binary
*.mov binary
*.ttf binary
*.otf binary
*.woff2 binary
```
