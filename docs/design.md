# audara-studio: design

How audara-studio works and why, for anyone changing it. It started as the design brief the build began
from (2026-10-02); it is kept true to the current version, edited in place when a behavior changes. How
it got here, with the evidence of each round (what the evals measured, what went wrong, what changed), is
in [history.md](history.md).

The engine comes from [pdoom-video](https://github.com/mexicat/pdoom-video) (MIT, Giacomo Magnanini),
from a copy that added the render verify mode, accented stroke-font letters, scene remixes, longer
timelines and spliced soundtracks to upstream commit `bdbad53`.

## Decisions made with the user

- **Repo:** https://github.com/oprogramadorreal/audara-studio.
- **License: MIT.** A `NOTICE` file credits:
  - pdoom-video (MIT, © 2026 Giacomo Magnanini);
  - motion-video-kit (MIT, © 2026 echris6), where its text or algorithms are adapted;
  - golden-temple (MIT, © 2026 Leon Lin), whose rendering code the realism kit adapts (each project that
    copies the kit keeps its notice in `src/realism/LICENSE`);
  - each font under its own license: the SIL Open Font License for Archivo, IBM Plex Mono, Cormorant
    Garamond and the EMS stroke fonts, and the Hershey fonts' liberal license, whose text is inside their
    SVG files.
- **Several videos per project.** The engine, the look (`docs/STYLE.md`) and the fonts are shared. Each
  video has its own folder with its treatment, timeline, scenes, audio and timing data, and the preview
  picks it with `?v=<name>`. pdoom-video already worked this way in practice: its pt-BR explainer reuses the
  clip's scenes through `remix`. See "What `init` creates in a project".
  - **A repository per video and one for a whole channel are the same model:** a project with one video,
    or with many. Nothing asks which, so whatever the skills say holds for both, and a studio mode was
    left out (history.md, 0.6.1). What the videos share reaches all of them: an engine change is verified
    on every video (`references/contract.md`), every video loads every registered font, and what several
    videos use can live in `videos/_shared/`, which has no `video.json`, so it isn't a video, and the
    preview hot-swaps and reloads it like a video's own files.
- **Fonts: pdoom-video's set, and no more by default.** Archivo, IBM Plex Mono, Cormorant Garamond, and the
  EMS and Hershey stroke fonts. Together they cover the four voices a piece needs:
  - a grotesk whose width and weight can animate;
  - a mono for UI and data;
  - a serif for the solemn register;
  - pen-plotted writing.

  A project that needs another typeface (a brand's own, or a script these don't cover) adds it then; the
  engine guide explains how. Any OFL font works, for example from Google Fonts. A variable font first goes
  through the template's `scripts/font-instances.py` (after pdoom-video's `analysis/make_fonts.py`):
  Canvas2D and opentype.js draw a variable font only at its default instance, so each width or weight a
  video uses becomes its own static file.

## Principles from the user

- Free tools first. A paid one (like Remotion for companies) is only an optional last resort, with its
  license stated before use.
- Simple and effective over complete: add a tool only when it clearly earns its place.
- READMEs stay short: what it is, install, first video. Details go in linked docs.
- Python only through uv (`uv run`, PEP 723 inline dependencies).

## The vision: the user directs, the agent builds

audara-studio makes the coding agent a film crew and the user its director. The director decides what they
want to decide (the idea, the words, the voice, the music, the look, the pacing, the length), as little as a
sentence or as much as a shot list; the crew follows that exactly and fills everything left open with its
own best work. The director watches the video take shape in the browser, gives notes by time, and can take
back any part at any time. They never have to write code or run a script, though they can. (Round 4 changed
this from "the director brings the material and the taste": with a short prompt nobody brings taste, and
the model read it as not its job; see history.md.)

This is how pdoom-video was made: in conversation, watched in a live preview, changed note by note. Every
part of the design serves that loop:

- **The f(t) rule** makes any moment linkable and re-renderable, and a change measurable: the same frame
  always has the same pixels, so `verify` hashes them and names the stretches a change touched since its
  last run, at the frames it samples, and any change of length ("a note changes only what it names" is
  checked, not hoped for, though a change shorter than half a second between samples can go unseen).
- **The preview** shows a change seconds after it's made.
- **The briefs** keep the crew consistent.
- **The critic** catches what the director shouldn't have to.

### How it's used

- **Install once per machine.** In Claude Code: `/plugin marketplace add oprogramadorreal/audara-studio`,
  then `/plugin install audara-studio@audara-studio`. In Codex: `codex plugin marketplace add
  oprogramadorreal/audara-studio`, then `codex plugin add audara-studio@audara-studio`. The skills alone, in
  either: `npx skills add oprogramadorreal/audara-studio`.
- **Then talk naturally.** Open a folder and ask for a video: "make a 60-second video for `song.mp3`, dark
  and engraved". The skills load on their own: each skill's short description is in every session, and a
  matching request loads the rest. Someone who doesn't know yet what to make asks for ideas instead ("give
  me some ideas for a video for my bakery"), and gets them without a build ("Before the brief").
- **Name a skill only to force it**, when the request is vague, or when other video skills (Remotion,
  HyperFrames) are installed and audara must win. In Claude Code that's `/audara-studio:code-video`; in
  Codex, `$audara-studio:code-video` (as the README says).

### A session, from the director's chair

The steps follow SKILL.md's session checklist, in its order:

1. **Brief.** The agent works the whole piece out and decides what the request leaves open, then writes the
   treatment and storyboard, sized to the piece, posts it and builds on; it waits only for what the
   director alone can decide. (Until round 4 the director approved the brief before any scene was built;
   history.md says why it changed.)
2. **Setup.** It copies the engine into the folder, starts the preview and gives the director the link at
   once, and again with the treatment. The preview command asks for that where it prints the link, since
   the skill's text alone didn't hold: Claude sessions held the link back for 20 to 90 minutes.
3. **Look.** When the look is left to it, it renders two or three style frames of the key moment, each a
   different idea, picks one by looking, and writes the shared look down (`docs/STYLE.md`, `src/look.ts`).
4. **Sound.** For a song, it analyzes the beats, sections and lyrics and cuts the window the video uses.
   For narration, it asks before spending ElevenLabs credits and makes the voice with its word timings,
   with a free stand-in voice meanwhile. Music and effects nobody gave are synthesized in code (free)
   unless generated ones are asked for. The picture never waits for the sound.
5. **Build.** It writes the scenes, one subagent per scene when there are many, and looks at each scene's
   stills. The preview reloads as scenes change.
6. **Critic.** A fresh critic reviews a draft of the whole cut, looking first as a stranger, and the agent
   fixes what it finds; a piece longer than about 30 s also gets a verification round. After the build,
   a critic round runs when the director asks for one and before the render; a round of notes goes
   through the agent's own checks instead (step 8), and its hand-off offers a critic round only when it
   rebuilt much of the cut or left something those checks couldn't settle. (Until 0.8.1 the text let a
   critic round follow every round of notes; history.md says why it changed.)
7. **Render.** A build ends in the preview with the render offered; the director says "render it" (or
   asked for the MP4 in the request). A picture changed since the last critic round is reviewed on a
   quick draft first, so the render runs once. Each render comes with a quality report, a contact sheet
   and a poster frame, and an offer to delete, after a yes, the drafts and frame folders the work left (one
   project's reached 36 GB), never what the project names as a source. Chrome renders on a laptop's discrete GPU (`--force_high_performance_gpu`): left to
   itself it sometimes took the integrated one. A long video renders for hours, and one render uses one
   browser's thread: `video --jobs N` renders it in pieces on N browsers at once and joins them, the same
   frames, and `--resume` picks up an interrupted one while its inputs, including compiler settings, are
   unchanged. (Until 0.2.0 the first build ended with the MP4; history.md says why it changed.)
8. **Direct.** The director watches and gives notes by time ("at 0:23 the title should land on the
   snare"). The agent changes what the note names and what it forces, checks what `verify` says changed
   and each note's moment as it renders (a still, a clip with its `qc.py` lines, the mix measured), and
   answers with a `?t=` link and what moved. This loop repeats for as long as the director wants.

What the agent owes the director:

- a one-line status during long work, with the time left;
- a link for every change, with what moved;
- for a note that reads two ways, the reading taken and the other on offer;
- the work shown: contact sheets, numbers (`qc.py`'s holds and blank frames, with a link to each),
  critic verdicts;
- a question before anything that costs money, or spending within a budget they set;
- their decisions and rejections written down in the project, so later sessions keep them;
- their product as it is in a factual demo: its real screens (given, or captured from its live site with
  their OK) and only the figures they gave. A lookalike nobody asked for reads as the product and isn't,
  so a screen nobody has yet is asked for and stands in as a placeholder that reads as one. A concept or
  mockup the director asks for is theirs to ask for: it is made, and marked as a concept where it could
  pass for the product. Neither shows an invented feature or figure as the product's.

It doesn't ask for approval of every step in between, and nothing waits on a missing screen but the moment
that shows it.

### Before the brief: choosing what to make

A sentence is enough to start a video. When its premise is left open, code-video's lead develops one in the
treatment, then builds while the user can redirect. `video-ideas` offers a separate opportunity to compare
directions before production: the user asks for ideas, sees two or three that differ in what the viewer
would see, picks or refines one, and leaves with a starting prompt. It never stands in front of a request
just to make a video, which still goes straight to code-video.

- **It stops at the prompt.** When production hasn't already been requested, ideas, a prompt or "I like
  the second one" start nothing: no project, no preview, nothing generated, and no file unless the user
  asks to save the prompt. "Make it" continues with code-video in the same session, with the prompt and the
  user's earlier instructions, under its usual production and render rules; a request that already asked
  for the video ("pick the strongest and make it") goes on without a second yes, after showing the chosen
  direction so the user can redirect; the prompt also works pasted into another session.
- **The prompt keeps three things apart:** what the user decided, exactly (their words, files by path,
  facts, length, sound, what they ruled out); the idea they chose; and what the assistant only suggested
  (copy, a length, a staging), marked as replaceable. code-video follows the first exactly, develops the
  second, and treats the third as open, putting what it keeps in the Assumed line (treatment template).
  Without that split, a helper writing in the user's voice would turn its own guesses into requirements.
- **What the user left open in the look stays open,** and the visual constraints they set are kept,
  without one brand colour, typeface or reference taken for a whole look: code-video explores the rest in
  its style frames. A look the assistant suggests is marked optional.
- **A prompt found elsewhere is adapted:** its idea, creative direction and delivery requirements kept
  (frame shape, size, rate, motion and finish can describe the result), incidental implementation (a
  Remotion component, an HTML-page setup) translated, role-play openers and "ignore your skills" removed,
  and the changes said in a line. A tool the user chose on purpose stays.
- **Decisions apply where they belong.** In a project, `docs/STYLE.md` and the relevant video's Decisions
  are kept; one video's own choices (its length, its silence) don't bind an unrelated new one.
- **Text only.** No scripts, no engine, no generated options to look at: drawing alternatives is
  production, under code-video's rules. Costs and asset needs come up only when they affect the choice.

Why a skill of its own: code-video loads for any video request and in any project with
`videos/*/video.json`, and its routing and checklist can pull an ideas request toward production; its
SKILL.md has no room left either. Considered and left out: documenting code-video's "plan first" instead
(the lightest route, but only for users who know to say it, and it plans one video rather than comparing
ideas), an interview inside production (the stop before building that round 4 removed), and a required
fresh session. The research behind it is in `docs/research/` (dated snapshots), the decision in history.md
(0.5.0).

### Coming back later

A project outlives the session that started it. `init` writes a short `AGENTS.md` into the project with
what a later session needs:

- the videos in the project, and where each one's treatment is;
- the shared style and the engine guide;
- the preview and render commands;
- the f(t) rule, in one line;
- when the project has copied the realism kit (`src/realism/`), that it is there and the rules in its
  README that keep the shared renderer and the frames stable;
- where the director's decisions are (each treatment's Decisions, and `docs/STYLE.md` for the project's),
  to read before every change;
- what the agent owes the director, including that a request for ideas or a prompt alone gets those and
  nothing built, and a request for a thumbnail, a title, a description or tags gets the YouTube package with the
  video left as it is.

It also writes a one-line `CLAUDE.md` that imports it (`@AGENTS.md`); Codex reads `AGENTS.md` on its own.
The agent keeps `AGENTS.md` current as videos are added. `init` never replaces a project's own scripts, so
a project made by an older release keeps its `render.ts`: the generated section names only what that copy
can do, and says that `init --force` updates it. `render.ts` itself stops on an option it doesn't know,
since 0.2.0's copy ignored `--size` and rendered the video's own format under the same name, and on one
given without its value, which would read as not given in the same way. Its engine, `src/engine/`, is never
replaced, not even by `--force`, so a setting the engine gained later (the post's `shoulder`) does nothing
there: where the skill names one, it says how to tell and what to do instead (`references/images.md`; the
realism kit's `SUBFRAME`, which the kit does without, in `references/realism.md`).
The player outside it (`src/main.ts`) is updated by `--force`, so it checks what the engine has: on an
engine from before 0.4.0 it skips the shader warm-up and plays as before.

A later session in that folder then knows the conventions even when a request ("make the intro slower") is
too small to load a skill. Skills tend not to load for simple one-step requests the model can handle
itself, which is exactly why the project carries its own conventions.

### Handing it on: a repository

A finished project often goes into git next, so someone else can clone it on another machine, work on it
and render it again. The user asked for that in the same words project after project, and the first one
made by hand (`oprog-1`, 2026-10-10) came out well but needed four follow-ups and kept a leak (history.md,
0.6.0). `video-repo` holds the method:

- **Where the repository goes first.** None yet: `git init -b main` in the project. The project already is
  one: its branches, remotes, history, LFS setup and anyone's staged work are kept, and its history is
  searched too. A folder above is one (a home folder, a monorepo): the user decides, before anything moves.
- **Before there's a video, only what init keeps.** A user may ask for the repository in an empty folder,
  before code-video has made anything. Then the skill sets up the repository, a `.gitignore` with init's
  entries (so keys are covered before the first file), a `.gitattributes`, AGENTS.md with its Repository
  section and a CLAUDE.md importing it, and commits nothing unless asked. init then merges its entries into
  the `.gitignore` and appends its section to AGENTS.md, but writes its README (the commands to watch and
  render) only where there's none, so the skill writes no README yet: one written first cost a test project
  init's. Nothing picks up files later on its own (neither git nor the other skills commit unless asked);
  later sessions read the Repository section before committing, and asking again once a video exists brings
  the full pass.
- **Files sorted by their role, not their type.** A generated or derived file the render loads (the final
  mix, extracted frames) is an input and stays, as do the sources someone needs to change the video (the
  mix's stems, the chosen takes, request records, the scripts that made a kept file). Generated and paid
  media stay as files, since the same request doesn't give the same bytes again. Outputs and caches are
  ignored by folder or name at any depth; no blanket `*.mp4` rule, which would hide the next clip a video
  needs from the session that adds it. Duplicates, rebuildable intermediates and rejected takes are left
  out and named to the user.
- **GitHub's limits, and what's left out written down.** GitHub warns over 50 MiB and refuses a file over
  100 MiB, so one over 100 MiB stays out and `docs/REPOSITORY.md` records its path, bytes, SHA-256, purpose,
  how to get it back, and whether a clone renders without it. Git LFS is offered, never set up by default:
  the user asked to leave such files out, and its free quota (10 GiB of storage and of bandwidth on GitHub
  Free) counts every clone's download.
- **Keys and personal details, checked before the first `git add`.** `scripts/audit.ts` (bun, read-only)
  looks for the values of secret-named variables in the environment and in `.env` files wherever they were
  copied, known key formats, key files, home-folder paths, e-mail addresses, files over GitHub's limits and
  duplicates; with `--staged` it reads exactly what the commit holds, with `--history` every blob any ref
  reaches. It never prints a secret and says what it doesn't cover: location data in camera photos and clips
  is looked at with a tool at hand, or reported unchecked (a parser for it was cut as more code than any
  case seen has needed). A key already in the history is revoked first; rewriting history waits for the
  user's yes.
- **A README for people, notes for whoever comes next.** The README says what the videos are, how they were
  made, how to run and render them and what isn't in git, from init's README, whose commands stay. A
  published title or link nobody gave is left out, not guessed. `docs/REPOSITORY.md` and a short section in
  AGENTS.md (outside init's markers) tell a later session what's kept and how to add media.
- **A fresh clone is the test.** The skill clones the repository into a new folder in the system's
  temporary folder, not inside the project, where Node would resolve a package missing from `package.json`
  from the project's own `node_modules`. It runs what a newcomer would: `bun install --frozen-lockfile`,
  `bun run check`, `verify` for each video (every scene and the files it reads) and a three-second draft
  with sound, which start and stop their own server, so no preview holds the folder. Then, passed or failed,
  it deletes the clone and checks it's gone, or names its path. A sandbox can block the install's network
  (Codex's default) or the temporary folder: it asks, or reports the check as not run. It says what ran,
  without promising identical pixels on another machine.
- **Defaults, then the hand-off.** Nothing is published until the user pushes, so it goes on rather than
  waiting, with one exception: the name and e-mail every commit carries are settled before the first
  commit. Unset, it asks; when the user asked to keep personal details out, it asks once with everything
  else ready (that address, or their GitHub noreply one), and the repository's name goes in the same
  message when the folder's is a working name. It ends with what's still theirs to decide: the name, if it
  wasn't asked (it goes into `package.json`, AGENTS.md's heading and the README's title, not into video ids
  or titles), facts the README can't know, and rights to third-party media if the repository may go public.
  Someone's staged work stays staged: only the skill's own paths are committed, and it asks first when it
  must also untrack a file or a file holds both. It creates a remote or pushes only when asked, after asking
  private or public.

Considered and left out: a general "media project into git" skill (only audara-studio projects have been
seen so far), a reference inside code-video (its SKILL.md is full, and a git request wouldn't find it), explicit-only
invocation (see "Format, for both tools"), and installing a secret scanner (gitleaks is suggested when it's
already there).

### Publishing it: the YouTube package

A finished video still has to earn its click. The user ended project after project with the same request,
typed by hand: three thumbnail options at 1280x720 with given words and a given title, "work hard... effective.
That attracts clicks", then a description with chapters, and tags nobody wrote down (history.md, 0.7.0).
`youtube-package` holds the method:

- **A pair, then the words.** Three thumbnails and one title designed together: the picture shows or asks, the
  title promises or answers, and neither repeats the other. Three because YouTube's Test & Compare tests up to
  three, judged by watch time, and three different bets (subject, situation, layout, words or none) are what
  make a test teach something. Then the description (plain text, short by default, its chapters from the
  project's timing data and checked against the final cut), and the tags, which get minutes, not effort.
- **The video's own world, staged better.** The pictures start from the video: its frames rendered at 2x without
  their captions, the plates its scenes load, a plate staged in the engine in a video of its own
  (`<video>-thumbs`, which sorts after the video and so doesn't become the default, except beside `example`,
  which any other video outranks, so the example's commands then name it), the user's photos, and
  generated images only after a yes, through code-video's `imagegen.py` (or, in Codex, its built-in image
  generation, which draws on the plan's limits). Every word is set in code: image models
  misspell. A frame with words on it is a start, not a finish. The rejected rounds in the user's projects were
  spectacle the video didn't have (confetti and music notes in a video with neither) and pasted faces; the
  thumbnail that shipped was the video's own computer, rendered in its engine.
- **One format that worked elsewhere.** Before the ideas comes the niche: 10 to 30 videos on the subject that a
  viewer would see beside this one. It informs the whole set's type, brightness and colour. And one of the three
  takes the format of the niche video that best fits this one: what it shows and how, rebuilt from the video's
  own material in the channel's type, never that video's pixels, characters or brand. A format is shared on
  YouTube; a picture is someone's work. The niche video is preferably an outlier, with far more views than its
  channel usually gets (vidIQ's score starts at 2x a channel's average). Fit comes before numbers: on oprog-3
  the user preferred, over more than a dozen of the video's own ideas, the option that followed the subject's
  big video, 3Blue1Brown's guest video by Welch Labs. It had 2.2 million views, under that channel's average, and
  its layout (four panels from noise to picture) was the mechanism the video explains. The other two options
  stay the video's own bets, so a test of the three asks whether the niche's format wins on this channel.
- **The channel before the video's pixels.** A well-made set came back once for its font alone. The channel's
  identity (name, link, language, the thumbnail type and colours, the title voice, the links it repeats) lives
  in the project's `docs/CHANNEL.md`, the user's decisions kept apart from what was inferred. The user makes a
  project per video, so a new project starts from what they say, an earlier project they point to, or one
  question; nothing scans sibling folders.
- **Judged as viewers meet it.** A sheet of sizes alone once passed text that the feed then showed small and too
  dark. The skill's `preview` puts each option where it is seen, at sizes measured on youtube.com in October 2026
  (every size from search's 500 px down to a playlist's 100; a home row of three at 344 px, the up-next column at
  250, a phone, a search result with as much of the description as search shows), on YouTube's dark and light
  pages, with the title wrapped and cut as there, beside other videos when there are some. Then one fresh critic,
  given the images and the title before any reasoning, says what each promises, what reads first, what fails and
  what one change would help; no CTR guesses or averaged scores, since a salience score once pulled a design
  toward the cliché its brief ruled out.
- **Stop rules.** Exploration happens once: about six rough ideas, three finished, one critic round; fixing what
  the check or the critic finds is finishing, not a new round; then a last look at full size. One
  session spent nearly ten hours and sixty agent runs on one set, six of those hours on an option that lost;
  another showed the user nothing for four hours. The rough sheet and the titles being weighed go to the user
  early, and work goes on.
- **Their words.** A title or text the user decided is used exactly, a stronger version offered beside it;
  one given as a start is the skill's to keep or improve, saying what changed. A request for a thumbnail gets the
  description and tags too, even when it names only the pictures (a Codex run once read the user's own prompt
  as thumbnails only); a request for one other part (a title, the description, one option changed) gets that
  part.
- **Honest packaging.** The pair promises what the video delivers in its first seconds (YouTube's Intro measure,
  viewers still watching at 30 s, helps assess that, and YouTube removes thumbnails that misrepresent). Those
  seconds are packaging too: on a computer, pointing at a thumbnail plays the video in its place, and phone feeds
  play it inline. An opening that doesn't pay off the best promise is reported, with the change offered through
  code-video; the skill never changes the video. YouTube's own Studio has generated thumbnails since July 2026;
  what this skill adds is art that fits this video and this channel.

Its script, `youtube.ts`, has four modes and no dependencies: Bun serves the project, Chrome renders headless,
and Bun's WebSocket speaks the DevTools protocol to it, so it runs the same in both tools, with nothing to
install and no network but `niche`'s. `shoot` renders any HTML page at an exact size and reports each text
block's size at 168 px (the smallest place a thumbnail's words are read), text in the duration badge's corner
(the last 256x166 px of 1280x720, measured), a face that didn't load or lacks a character (an Ê), an image that
didn't load or decode (those CSS draws too: a broken background loads fine and draws nothing); `preview` makes
the feed sheets; `check` holds the package to YouTube's limits (sizes, the title's 100 characters, the
description's 5,000 characters and a warning past 5,000 bytes, the Data API's unit, the chapters' rules, the
tags' 500-character count, the hashtags'); `niche` gathers the niche's videos through YouTube's own endpoints
(oEmbed for links; the Data API with the user's key, which adds each video's views as a multiple of its
channel's average per video and of its subscribers), since YouTube's terms forbid scraping its pages.
Words are set in the page, in Chrome, which kerns them; Pillow on Windows doesn't. A camera, not a compositor:
the pages are the model's, so no layout ships.

The files the user uploads live together in `videos/<video>/youtube/` (the three PNGs, `title.txt`,
`description.txt` and `tags.txt` holding only what gets pasted, `NOTES.md` with the ideas, the runners-up and
the user's decisions, opening with what is still theirs to decide, and the sources that rebuild each
thumbnail); previews, roughs and scratch go to
`out/<video>/youtube/`. The package's decisions stay in its `NOTES.md`, not the treatment's Decisions, which
are the video's: init's AGENTS.md says so too, since a Codex run once logged the thumbnail notes there. video-repo keeps the folder: the delivered PNG is the record, since a rebuild isn't
guaranteed to match.

Considered and left out: a mode inside code-video (its SKILL.md has 3 bytes left, and its checklist pulls
toward building the video); a universal compositor or a layout template (it would set one look for every
channel; the camera leaves the page to the model); a scraper of YouTube search, as two of the user's sessions
wrote (YouTube's terms, and pages that change); three title packages (the user asked for one title; the
runners-up go in the notes); a 3840x2160 deliverable by default (YouTube now recommends it, but the user asks
for 1280x720, the floor for a full-quality test; `shoot --scale 3` makes one from the same page); metrics such
as salience or CLIP readings as judges; a fixed outlier threshold that rules a niche video in or out (the
user's preferred reference wasn't an outlier; the multiples are read, not obeyed); the median of each channel's
recent uploads as the baseline, closer to vidIQ's "similar timeframe" but two more calls per channel and skewed
by Shorts, where the lifetime average per video comes with the channel's statistics in one call; an SRT from the
word timings, offered rather than made; and a second image script for Google's Nano Banana 2.1 (a little
cheaper per image, better at keeping one face across three options, but a new script and key, while
`imagegen.py`'s GPT Image 2.5 led Artificial Analysis's rankings for generating and editing in October 2026).

## The decision

Build audara-studio as **one repo of Agent Skills around one engine: the pdoom-video engine as a starter
template the skill copies into each project, plus the method for using it**. The core is what made this
project easy to direct:

- **A live preview in the browser**, where the user watches the video take shape and asks for edits.
- **GLSL**, which lets the model draw almost anything, with three.js for 3D geometry and Canvas2D for type
  in the same frame.

Other frameworks are only suggested, through their own official skills, for videos the engine doesn't suit:
HyperFrames (free) first, Remotion (paid for companies) only as an optional last resort. Wrap it in two
small plugin manifests, one for Claude Code and one for Codex. No MCP server; agents only as optional
extras.

It has five skills: **`code-video`** for the picture, **`soundtrack`** for the sound, **`video-ideas`**
for deciding what to make, **`video-repo`** for handing a finished project on and **`youtube-package`** for
publishing a finished video. `soundtrack` turns a song
or a script into audio files plus the timing data the engine reads, and does the sound of a video made
elsewhere too (filmed, or from AI video clips). When the user provides an ElevenLabs API
key, it can also generate narration, music and sound effects (see "Sound and ElevenLabs"). `video-ideas` is
text only and ends with a starting prompt (see "Before the brief"). `video-repo` puts the project in git so
someone else can clone it and render it again (see "Handing it on: a repository"). `youtube-package` makes a
finished video's thumbnails, title, description and tags (see "Publishing it: the YouTube package").

### Room for the model

Opus 5.5 is good at motion graphics and finds approaches of its own. audara exists to give it a fast loop
with the director and hard-won craft, never to narrow what it can make. So the skills fix very little:

- **Fixed,** because they protect the director's loop and the user:
  - every frame is a function of `t` (with `stateful` as the way out for simulations);
  - spending money waits for the user;
  - the API key stays out of the repo;
  - licenses are respected;
  - every change comes back with a `?t=` link.
- **Defaults the model may override, saying why:** the engine and its four ways of drawing, the workflow's
  steps, the treatment format, the motion grammar, the critic's cadence, the measured bars, the example
  scenes.
- **Open:** look, style, technique, structure, pacing.
  - Inside the engine, anything that ends up in the frame is fair: raw WebGL, new passes, image and video
    textures, changes to the engine itself.
  - Outside it, another approach when it serves the video better: HyperFrames, Remotion (with its license
    caveat), or one the model knows better for the job.

How the skills could still limit it, and what prevents that:

- **Anchoring on examples.** pdoom-video's scenes and taste (engraving, ink and orange) would pull every
  video toward one look. The example scenes are indexed by technique, not style, and the templates carry no
  pdoom-video palette, tone or motifs. The example's words are placeholders, and the f(t) rule is marked as
  the code's: its sentence once became a showreel's message. Tested example prompts are for people:
  `docs/prompts.md` keeps them, linked from the README, and no skill reads it (history.md, 0.5.0 and 0.8.2).
- **Process overhead on small requests.** The brief scales with the piece: a ten-second loop needs a few
  lines, a music video a full treatment. The lead works the whole piece out before it writes the treatment:
  a showreel's concept was once fixed after 2–3.5K tokens of thought, where the model alone spent 88–118K.
  A piece up to about 30 s gets one critic round before the hand-off, and the render's review is its
  second. A round of notes gets none unless the director asks: on a 13-minute video, critic rounds after
  six of seven rounds of notes took, with the fixes they led to, about half those rounds' time (history.md,
  0.8.1). Scene authors stay: a lead that built two showreels alone shortened the first turn by 31–43
  minutes but scored lower blind than 0.3.0 (history.md, 0.4.0).
- **Hard rules where taste belongs.** The skills give reasons, not MUSTs, and the user's brief always wins
  over their defaults, including the list of clichés to avoid. A form or a style the director names (a
  showreel, psychedelic) brings what defines it: the Avoid list, the critic and the motion grammar's
  persistent actor step aside for it, since they had taken a reel's labels and a psychedelic piece's colour
  splitting out, and built four showreels around one circle.
- **A slow preview killing an idea.** A scene too heavy for real time gets a cheaper preview path (lower
  resolution, fewer samples) rather than a simpler idea. pdoom-video's shoggoth already renders its G-buffer
  at half resolution. The player compiles every scene's shaders while it loads, so a heavy scene doesn't
  freeze the first play where it enters.

The evals check this directly (see "Writing the skills").

## What made pdoom-video work (preserve these)

The GLSL is the visible part, but the value to reuse is six things around it:

1. **Every frame depends only on the time `t`** (`docs/ENGINE.md:49`). Randomness is seeded, flicker is
   keyed to the frame index (`frameIdx(t)`), and scenes that keep state have to opt in (`stateful`). That's
   why the browser preview matches the export, and why motion blur from averaged sub-frames and rendering
   in parallel segments (`render.ts video --jobs`) both work.
2. **A live preview to direct the video** (`app/src/main.ts`). `bunx vite` serves the video as a web page
   that plays in real time with the song (in audara, `render.ts preview` starts it, detached, so it
   outlives the agent's turn):
   - a scrub bar with the scenes marked, and keys to play, seek, step one frame, jump between scenes and
     loop one;
   - `?t=23` links to any moment;
   - saving a scene file reloads only that scene;
   - a scene that fails shows its error on the page and renders black without breaking the others
     (`app/src/timeline.ts:9`).

   This is the user's feedback loop: watch, point at a time, ask for a change, see it seconds later. It
   works because scenes stay fast (under 25 ms a frame, `docs/ENGINE.md:54`) and motion blur is left to the
   export.
3. **Sync comes from data.** The Python/uv analysis (`analysis/align.py`, `analysis/analyze.py`) writes the
   beats and word timings to `data/audio.json` and `data/lyrics.json`. Scenes find lyric lines by their text
   (`lyrics.get('sudden drop')`), and the timeline snaps cuts to the beat grid (`app/src/timeline.ts:18`).
   Nothing is timed by hand.
4. **Two briefing docs.** `docs/TREATMENT.md` covers palette, type, tone, a list of looks to avoid and a
   brief for each scene. `docs/ENGINE.md` covers the scene API and its rules. Each scene has an owner
   (A1–A8, B1), and ENGINE.md tells scene authors not to touch other files and to ask "the lead" for engine
   changes. That points to a lead agent running parallel scene agents, and these two docs kept all 17
   scenes consistent.
5. **The model checks its own frames.** `render.ts stills` and `sheet` (contact sheets), `--only <scene>`,
   then the model looks at the PNGs. There's also a `verify` mode, and scene errors are printed. This is
   the model's loop, next to the user's preview, and most of the quality came from it.
6. **The render pipeline** (`app/scripts/render.ts`, export API in `app/src/main.ts`). Headless Chrome
   (playwright-core) sends raw frames over a WebSocket to ffmpeg, with adaptive motion blur, true 4K
   (`--scale 2`) and BT.709 color tagging. Hard to get right, and nothing in it is specific to this video.

Only the palette, fonts, recurring visuals, the P(doom) overlay and the scenes themselves belong to
pdoom-video.

## Why this setup

- **A skill, not an MCP server.** Everything is local files and command-line scripts the agent can already
  run. An MCP server would add a running process and a protocol and gain nothing.
- **One engine at the core, and a method that doesn't depend on it.** The skill uses the template by
  default and leaves the final choice to the model. The method (the f(t) rule, timing data, briefs, the two
  feedback loops) works the same in HyperFrames (a GSAP timeline seeked to `t`) and Remotion
  (`useCurrentFrame()`), so a video the engine doesn't suit can still use them (see "The engine, three.js
  and other frameworks"). Write it as principles and defaults, with the reason for each, rather than hard
  rules (see "Room for the model").
- **Copy the engine in; don't publish it as an npm package.** Agents need to read and change the engine.
  pdoom-video added an overlay, single-stroke fonts and a remix hook to it, and code in `node_modules` is
  out of their reach.
- **Keep agent definitions small.** Skill folders (`SKILL.md`) are the one format both tools read. Agent
  definitions differ: Claude Code uses `agents/*.md`, Codex uses `.codex/agents/*.toml`. Agent Plugins 1.0
  (the standard Codex, Cursor and Copilot adopted in August 2026) leaves agents, hooks and commands out,
  and Claude Code doesn't support it yet. Both tools can start general-purpose subagents, so put the
  coordination in the skill: write the briefing docs from their templates and, when there are many scenes,
  start one subagent per scene, each with its own files.
- **The critic is a role, not a file.** The one extra role worth having is a **critic** that reviews
  contact sheets against the treatment with fresh eyes (its protocol comes from
  motion-video-kit: history.md, "Lessons from motion-video-kit"). In a full-cut round it looks first as a
  stranger, from the render and the director's words alone, and writes that down before it reads the
  treatment, so the treatment's arguments can explain a choice but not change what a viewer saw. The lead
  starts a general-purpose subagent with the critic prompt from `critique.md`, which works the same in both
  tools, and waits for it (a critic left running dies with the turn). Add an agent definition only if
  that falls short.

## The engine, three.js and other frameworks

### three.js: yes, and it's already there

The engine is built on three.js (0.186): its render targets, shader materials and cameras. Scenes already
combine four ways of drawing in the same frame:

- fullscreen GLSL passes (`FSPass`);
- three.js scenes with meshes and cameras: pdoom-video's `stack.ts` falls through an `InstancedMesh` with
  a perspective camera and fog, and its `loss.ts` flies over a terrain mesh with its own shader;
- Canvas2D layers for type (`Layer2D`);
- GPU lines (`LineBatch`).

So three.js adds no new tool; it only needs to be explicit:

- The template ships one small example scene for each way of drawing.
- The three.js rules go in `contract.md`, because they are the f(t) rule applied to three.js:
  - animation is driven from `t` (`AnimationMixer.setTime(t)`, never `THREE.Clock` or
    `requestAnimationFrame`);
  - models load in `init()`;
  - scenes render into `out`, in linear color;
  - physics and particle simulations are `stateful`, so they only get fixed-sample motion blur.
- No React Three Fiber: it would add React for nothing the engine needs.

### Another format: the same video, another frame

A director often wants one piece in two shapes, a 16:9 master and a 9:16 cut for the vertical apps.
Cropping the master loses what its edges carried and keeps type sized for the other screen, so the second
format is recomposed. It is the same video at another size: `--size 1080x1920` in every `render.ts` mode
and `?size=` in the preview, like `--fps`. The timeline, the sound, the timing data and the scenes are
shared, so a cut or a fix lands in both; the scenes read `W` and `H` and lay out for the frame they get;
and everything rendered for it goes to `out/<video>/<W>x<H>/`, so neither format's files replace the
other's. A size with the video's own shape is refused: that is the same picture smaller or bigger, the
720p flag history.md's 0.2.0 entry rejected (`--scale` makes it bigger).

A second video folder was the other way, and the engine already allowed most of it (another video's
scenes through `remix`, audio by a relative path). But a video reads its timing data from its own
`data/`, and `verify` resolves a song window's audio relative to the folder that holds the data, so the
copy would have needed the song's data and audio copied too, and the two would drift. A format that needs
another edit (another length, other scenes) is still another video.

### Photographic 3D: an optional kit, not a default

[golden-temple](https://github.com/Leonxlnx/golden-temple) (MIT, Leon Lin, 2026-10-15) showed that the
engine's own stack (three.js, GLSL, headless Chrome, averaged sub-frames) reaches near-photographic frames:
a temple at golden hour, 24.4 million triangles, 8 sub-frames a frame. What made it look real was mostly
scene-side: modelled detail where the lens looks, one sun-sky-haze environment that every material shares,
procedural wear inside three's PBR materials with fine detail faded by its pixel footprint, a lens, and
samples spread over the sub-frames by their index. So audara takes it as an optional path that leaves every
other video as it was (history.md, 0.8.0):

- **`references/realism.md`**, reached from SKILL.md's "Read when" and from `contract.md`'s three.js section
  and `blender.md`: when a photographic shot earns its place (built and natural things, not people), what
  makes it read as real in order, the rules that keep it stable in motion, the cost, the method and
  prompting. The method starts from the author's own, as he described it on X: a board of about ten
  reference images (golden-temple's were generated), a short prompt that names the bars (light and shadows
  first, more detail than seems enough, zero flicker) and verifying and iterating against the references
  until they match. audara adds how: stills compared side by side with the references, and a time budget
  agreed with the director in place of "even if it takes days". The kit saves finding the techniques; the
  loop is still the work. Generated references go through `references/images.md` and its yes, and never
  into the frame.
- **A kit copied on demand**, `skills/code-video/assets/realism/` → a project's `src/realism/`: the port,
  scoped so that it touches nothing it doesn't own. Materials are patched per material (golden-temple edits
  three's shared shader chunks, which would reach every scene of a video); shadows are on only inside
  `withRenderer`, which restores the shared renderer however a draw ends; the program cache key is a hash of
  everything injected, so a hot-reloaded scene never gets a stale shader; a material is patched once (a
  second patch would declare everything twice, so it throws), and a three.js whose shader text no longer
  has what the patch edits stops the kit with what is missing instead of changing nothing. Every entry's
  scene is built when the page opens, so what one holds multiplies with the shots: the `Lens` targets are
  scratch shared by every scene of one frame size, and only the two most recently fitted `Sun`s keep a
  shadow map (a 4096² one is about 128 MB); four shots of the example took 600 MB of GPU memory in the
  preview instead of 1,180. `Sun.fit` puts the shadow frustum on whole texels, so a frustum that follows the
  shot doesn't make still shadows swim, and the camera turns as a camera head does, pan and tilt
  (golden-temple blends the direction's components, which has no direction half-way through a half turn).
  Not in the template: a piece that doesn't ask for it never carries it, and its README and init's
  AGENTS.md line tell a later session its rules.
- **One engine hook, `SUBFRAME`** (`gl.ts`): the sub-frame's index within its frame, -1 for a single sample.
  Sampling patterns that depend on it, never on the frame or the time, keep still surfaces identical from
  frame to frame. Nothing in the engine reads it; it is reset however the sampling loop ends; the example
  video renders bit-identically with it. Time can't stand in for it: with a zero shutter every sub-frame
  has the same time, and cut clamping repeats times. An older project's engine works with the kit without
  it (no jitter); `realism.md` gives the few lines that add it.
- **The preview plays it, with less finish.** The player keeps time by dropping frames, so a slow scene
  stutters rather than drifts; the kit's example plays at 3.8 ms a frame on a laptop RTX and 26 ms on an
  integrated GPU (after the depth of field's taps learned to stop at the largest blur nearby: it was 70% of
  the cost), while a golden-temple-scale world plays at 2-3 fps on an integrated GPU after minutes of
  building. One sample a frame shows light, framing and motion. Paused on a frame whose scenes all set
  `refine = true` (the kit's do; none stateful), it is rendered once more with the render's 12 sub-frames
  and held until the playhead moves or a scene it shows is swapped, so the director sees the finish of any
  moment by pausing on it; every other frame, a crossfade with any other scene included, is drawn exactly
  as before. Flicker, which needs motion, is judged in full-sample clips. `realism.md` says so, with the
  preview path's levers and how to keep a long build out of the hot-swap loop. A GL context lost and
  restored (a GPU reset) reloads the page at its moment, since what scenes captured on the GPU when they
  were built is gone with the old one.
- **Fixed samples for a photographic stretch, by default.** Jittered sub-frames never agree, so the
  adaptive sampler climbs toward its cap (108 sub-frames on a near-still frame where it stops at 12, 324 on
  a frame of the example's move); frames that stop at different counts average different samples, which
  flickers. `refine = true` is the one flag a kit scene sets: its frame depends on its sub-frame samples. So
  the preview refines it paused, and render.ts gives a range that shows it, in any sub-frame, a fixed 12
  when `--samples` isn't given, as it does for a stateful scene (`--samples auto` asked for by name is
  obeyed, with a note). An entry's `maxSamples` only bounds the cost.
- **Left out:** a tone operator (AgX against the engine's shoulder was a small difference on the same
  frame, and a new one would also have to drive the adaptive sampler's error estimate, which once
  undersampled when the two disagreed); a shadow setting in the engine (scenes enable shadows around their
  own draws, one type, PCF, project-wide); golden-temple's world, volumetrics, god rays and water as kit
  code (each scene's own); a realism default or example video, which would pull every 3D piece toward one
  look.

### Remotion: optional, and only when it really helps

The user doesn't want to depend on a paid tool. Remotion is free for individuals and teams of up to three
people, and paid from four. So it is never the default and never bundled. The skill suggests it only when
one of its specific strengths is needed and the free options don't cover it, and it states the license
condition before using it.

What Remotion would add:

- **HTML/CSS layout through React**, much easier than Canvas2D for UI, text-heavy and data-driven videos.
- **Many variants of one video**, generated from data.
- **Audio** tracks mixed at render time.
- **Cloud rendering.**
- **Remotion Studio**, a preview as good as this one.

Remotion maintains official agent skills for all of it.

What it would cost audara:

- **A second engine** to template, document and test in two agents, which doubles what the plugin has to
  keep working.
- **A weaker fit for shader-heavy work.** Each frame is a screenshot of the page, WebGL needs Chrome's ANGLE
  backend when rendering headless (the default since Remotion 5), and the HDR post-processing and adaptive
  motion blur would have to be rebuilt.
- **A license** for teams of four or more (a Company License, with telemetry that counts renders).

So `backends.md` has a short order of choice:

1. **The template** (the default), for anything it suits: generative, shader-heavy, music-synced, 3D.
2. **HyperFrames** (HeyGen, Apache-2.0, free), when HTML/CSS layout really helps: product or UI videos,
   text-heavy pieces. It also covers most of what Remotion's HTML layout would add.
3. **Remotion**, optional, only for what HyperFrames doesn't cover, such as React components the user
   already has or cloud rendering. Use it only after telling the user about the license.

Both alternatives are used through their own skills, keeping audara's method and its `soundtrack` data,
which is plain JSON either one can read. The skill names the template as the default and says what it's
best at, so the model doesn't drift to a more popular framework out of habit. The choice still belongs to
the model: when another approach serves the video better, including one not listed here, it uses it and
tells the director why. Paid tools keep their license caveat.

## Sound and ElevenLabs

Worth adding, as an optional part of `soundtrack`. With a key, the model can make the whole soundtrack;
without one, nothing else changes: music and effects are synthesized in code, `standin.py` gives a free
local voice (Kokoro-82M, Apache-2.0), and the user's own audio is analyzed as before.

### Why it earns its place

- **The timings come with the audio.** Text-to-speech `with-timestamps` returns the time of every
  character, so word times come for free, and a generated song's lyrics get word times too
  (`/v1/music/detailed` with `with_timestamps`). Write them in the same `words[]` format as
  `data/lyrics.json`, and scenes find narration words by their text exactly as they find lyrics.
  pdoom-video's explainer had to force-align its ElevenLabs narration after the fact
  (`analysis/narracao.py`: CTC alignment plus a pronunciation table). With timestamps that step goes away,
  and the heavy local path (Demucs plus forced alignment, about 4 GB of models) is only needed for audio
  the user brings.
- **The music can be composed to fit the edit.** Generate the narration first and measure its chapters.
  Then compose the music from a composition plan whose sections last as long as the chapters, so the music
  changes where the chapters change. Creating a plan (`/v1/music/plan`) costs no credits, so it can be
  reviewed before paying for the track. pdoom-video instead looped a fixed 204.8 s Suno track under 581 s of
  narration.

### Where it goes, and where it doesn't

- **Not in `code-video`.** The picture method has to work with any audio, or none. Its SKILL.md only points
  to `soundtrack` for narration, music and timing data.
- **With any picture.** The reverse holds too: a video made outside the engine (filmed, AI video clips,
  another editor) gets its sound here, since the production scripts take `--out <dir>` in place of `--video`
  and the files and timings work in any edit. Both descriptions say so: a session making a commercial from
  AI video clips loaded neither skill, ran `eleven.py` for its music and wrote its own narration, effects
  and mix tools (history.md, 0.7.2).
- **Not through the ElevenLabs MCP server.** The official server exists, but here each generation has to
  become timing JSON in the engine's format, with a record of the request, and be cached. A script does that
  in one step and runs the same way in Claude Code and Codex.
- **Don't re-teach the API.** ElevenLabs maintains official skills
  ([elevenlabs/skills](https://github.com/elevenlabs/skills): text-to-speech, music, sound effects,
  speech-to-text). They are guides for writing app code with the SDK and know nothing about this timing
  format. audara owns only the glue: three calls, the files they write and the timing JSON. For anything
  else (voice design, cloning, dubbing), point to the official skills.

### Rules for the generation scripts

1. **Generated audio is an asset, not a build step.** Each generation costs credits and gives a different
   take. Generate once, keep the file, and save the exact request next to it (text, voice, model, settings,
   seed). Renders never call the API, and a script regenerates only when its request has changed.
   pdoom-video did this by hand: `docs/letra-explicada-pt-br/tts/` holds the exact text of each generation.
2. **Ask before spending.** Before generating, say what it will make (characters, length) and confirm:
   without `--yes`, `eleven.py` prints what it would make and what it would cost, and exits without
   spending. For music, show the free plan first. Make the voice's first block and check it before
   generating the rest (by ear when the director wants to; by measurement otherwise). A budget the director
   sets counts as the yes.
3. **Keep the key out of the repo.** Read `ELEVENLABS_API_KEY` from the environment (the name the SDK and
   the official skills use). Never write it to a tracked file, print it or pass it as a command-line
   argument. If it's missing, the scripts say so and the skill goes on with the user's own audio or a silent
   placeholder track, so the picture work never waits for it. A key the user pastes into the chat and wants
   used now lives for that session only: in a file in the session's temporary folder, outside the project,
   loaded into each command's environment and deleted at the end; never set in their system for them.
4. **Keep the spoken text and the displayed text apart.** The narration text is spelled the way it should
   sound (pdoom-video's table in `docs/letra-explicada-pt-br/ROTEIRO.md`, "Grafia para a voz": "pê dum" for
   P(doom), "I-Á" for IA), so the timestamps are in spoken words. Keep a map from spoken to displayed words,
   so scenes still find words by what's on screen.
5. **Check the result by transcription.** Speech-to-text on the generated file confirms that it says what
   the text says. The user approves it by ear when they want to.

Lessons from pdoom-video's explainer are in `references/elevenlabs.md` (from its `ROTEIRO.md`, "Geração
no ElevenLabs"): one voice and the same settings for every file; one paragraph of text is one block, and
the picture cuts in the silence between blocks; acronyms read better written as they appear on screen
than spelled out; generate the key lines several times and keep the most natural take.

### Adding more tools later

Add a tool only when it writes data the engine reads or does a step the model can't do by itself, and keep
it behind one line in SKILL.md. A cheap candidate: SRT captions from the word timings. Leave out until a
project needs them: stock footage, voice cloning. (A thumbnail mode came as `render.ts poster`, one frame at
full quality, and grew into the `youtube-package` skill in 0.7.0; image generation joined in round 4, as an
option behind the same spending rules; Blender and math references came as optional tools, each read only when
in play.)

## Writing the skills: Anthropic and OpenAI best practices

All five skills follow the skill-writing guidance of Anthropic and of OpenAI, and the open Agent Skills spec.
The links are under Sources; read them before writing. The two companies agree on almost everything; where
they differ, follow the stricter rule. What that means here:

### Format, for both tools

- **Frontmatter:** only `name` and `description`, the portable minimum.
  - Claude Code's extra fields (`when_to_use`, `allowed-tools`, `context: fork`…) are ignored by Codex, and
    the skills need none of them. Codex's optional `agents/openai.yaml` can add a display name and an icon.
  - All five stay model-invoked: no `disable-model-invocation`, and `allow_implicit_invocation` left at
    its default. The vision depends on them loading on their own. `video-repo` was the one in question,
    since Anthropic advises manual invocation for workflows with side effects (`/commit`, `/deploy`). It
    stays model-invoked because a repository is something the user asks for in words ("put this in git"),
    and that request should get the method without a command to remember: loading the skill only supplies
    instructions, the user's request is what authorizes the changes, and nothing leaves the machine until
    they ask. Explicit-only would also take two mechanisms, `disable-model-invocation` in the frontmatter
    for Claude Code (a key both `quick_validate.py` scripts reject) and `policy.allow_implicit_invocation:
    false` in `agents/openai.yaml` for Codex.
- **`name`:** lowercase letters, digits and hyphens; at most 64 characters; the same as the folder name; no
  "claude" or "anthropic". `code-video`, `soundtrack`, `video-ideas`, `video-repo` and `youtube-package` pass.
- **`description`:** at most 1,024 characters, in the third person.
  - **Content:** what the skill does and when to use it, the main use case first, in the words users
    actually type ("video", "music video", "lyric video", "motion graphics", "animation", "explainer",
    "render").
  - **Near-misses** (OpenAI): name what it is not for. `code-video` is not for editing camera footage, for
    generating AI video clips, or for ideas and a prompt alone, and that exclusion says `soundtrack` still
    does the sound of such a film, so ruling out the picture doesn't rule out the plugin; `soundtrack` is
    not for making a voice clone (narrating in one the user has is fine); `video-ideas` is not for making a
    video, for prompts for other generators, or for ideas for filmed content; `video-repo` is not for
    everyday commits, branches or pull requests, or for projects that aren't videos; `youtube-package` is not
    for making or changing the video (title cards and text inside it included), for choosing what to make, or
    for images unrelated to a video.
  - **A little insistent** (Anthropic), because models tend to under-trigger skills: "use it whenever the
    user wants a video made from code, even if they don't say 'motion graphics'".
  - **First sentence first:** Claude Code cuts each listing at 1,536 characters, and Codex shortens
    descriptions first when its listing (2% of the context window) fills up.
- **Body:** well under 500 lines, ideally under about 5,000 tokens. Long director sessions make this
  matter: Claude Code keeps a loaded skill's text for the rest of the session, and after compaction it
  carries skills forward only within a 25,000-token budget. Write SKILL.md as standing instructions for the
  whole session, and as a map: what to do, and which reference to read when.
- **Size and checks:** SKILL.md stays under 8,000 bytes, since Codex cuts an invoked skill there, and is
  saved without a byte-order mark. It passes three validators, each catching something the others miss
  (`evals/README.md`, "Spec checks").
- **Files:** each reference sits one level deep from SKILL.md, named for its content and linked with when
  to read it. A reference longer than 100 lines starts with a table of contents. No README, changelog or
  install guide inside a skill folder (OpenAI); those belong at the repo root.
- **Paths:** forward slashes, relative to the skill's folder. No tool names ("view the PNG", not "use the
  Read tool") and no Claude-only variables such as `${CLAUDE_SKILL_DIR}` in text both tools read.

### Writing

- **Only what the model doesn't know.** It already knows GLSL, three.js and ffmpeg. The skill adds the
  engine contract, the workflow, the pitfalls pdoom-video paid for, and where things are.
- **Freedom to match the risk** (both companies):
  - exact commands for fragile steps: `init`, render, `verify`, `qc`, and anything that spends ElevenLabs
    credits;
  - principles with reasons for creative work, which is most of it;
  - the why instead of MUSTs: a rule in capitals is a sign the reason is missing (Anthropic);
  - no fixed structure or number of steps where the task doesn't need one (OpenAI).

  See "Room for the model".
- **One default per choice, with a way out:** the template by default, and another approach when it serves
  the video better.
- **Imperative steps with explicit inputs and outputs** (OpenAI): "`uv run <skill>/scripts/eleven.py tts
  script.txt --video <video> --voice <id>` prints what it would make and cost; with `--yes` it writes the
  narration to `audio/`, its word timings to `data/words.json` and a request record beside each file."
- **Checklists for workflows, loops for quality:** the session's eight steps as a checklist the agent
  keeps in its notes;
  render stills, look and fix; `verify` and fix; critic, fix and verify.
- **One term per idea:** "scene" (pdoom-video also says "plate"), "treatment", "timeline", "preview",
  "render", "cut".
- **Nothing that goes stale in the instructions.** Model ids and API limits live in one reference file, or
  as documented script defaults.
- **Examples over descriptions**, chosen so they don't anchor one look (see "Room for the model").

### Scripts

- **Scripts for deterministic work** (`init`, render, `qc`, timing conversion, mixing), and instructions
  for judgment. OpenAI: prefer instructions unless the task needs deterministic behavior or an external
  tool.
- **Scripts solve their own problems.** They catch errors and say how to fix them ("ffmpeg not found:
  install it, then reopen the terminal"), explain every constant (why −14 LUFS, why that frozen-frame
  threshold), and declare their dependencies (PEP 723 for the uv scripts).
- **Say whether to run a script or read it.** Validation output names the exact problem: "scene `intro`
  failed: …".

### Test before polishing

- **Evals first.** Before writing much, run the target tasks without the skills, note what goes wrong, and
  turn that into at least three realistic task evals per skill. Change the skills for failures that
  actually happened, not imagined ones.
- **Trigger evals:** about 20 realistic requests per skill, half that should load it and half near-misses
  that shouldn't. Tune the description with the description optimizer in Anthropic's skill-creator.
- **A creative-range eval:** the same open brief, with and without the skill, two or three times each. The
  skill must not make the results narrower or plainer; if it does, find what anchors them and cut it.
- **Fresh sessions, every model.** Compare with and without the skill (in Claude Code, `skillOverrides`
  turns a skill off), using every model the user will run: Claude Opus, a smaller Claude model, and Codex's
  default model.
- **Claude A and Claude B:** one session improves the skills while a fresh one uses them on real tasks.
  Watch which files it reads: a file never read is unnecessary or badly linked.
- **Tools:** the evals run on their own harness (`evals/harness/`: trigger sets of about 20 requests per
  skill, multi-turn task cases, mocks of the paid APIs), since skill-creator's trigger loop and `claude
  plugin eval` need a shell native Windows doesn't give them (`evals/README.md`). Also used:
  - Anthropic's skill-creator plugin: task evals, benchmarks, the description optimizer;
  - Codex's built-in `$skill-creator` and its validator;
  - `skills-ref validate ./skills/<name>`;
  - `claude --plugin-dir`, to load the plugin from its folder;
  - `claude plugin eval`, for a repeatable suite;
  - `/doctor` in Claude Code, for the listing cost.

## Layout

```
audara-studio/
├── README.md                         # short: what it is, install, first video
├── LICENSE, NOTICE                   # MIT; credits pdoom-video, motion-video-kit, golden-temple and the fonts
├── AGENTS.md, CLAUDE.md              # notes for agents working on this repo (CLAUDE.md imports AGENTS.md)
├── .claude-plugin/plugin.json        # Claude Code's manifest
├── .claude-plugin/marketplace.json   # Claude Code's marketplace
├── plugin.json                       # Agent Plugins 1.0, with Codex's fields under extensions.com.openai
├── .agents/plugins/marketplace.json  # Codex's marketplace
├── docs/design.md, docs/history.md   # how it works and why; how it got here
├── docs/prompts.md                   # tested example prompts, for people; no skill reads it
├── docs/research/                    # dated research snapshots: the video-ideas proposal, its sources
├── evals/                            # trigger and task evals, their harness, mocks of the paid APIs
└── skills/
    ├── code-video/                   # the picture: the engine and the method
    │   ├── SKILL.md                  # the session checklist, what is fixed, commands, which reference when
    │   ├── references/               # one level deep, each read when its case comes up (below)
    │   ├── scripts/init.ts           # (bun) makes a folder a project or adds a video: copies the template,
    │   │                             # writes ENGINE.md, AGENTS.md, CLAUDE.md and .gitignore entries
    │   ├── scripts/demo-track.ts     # the example video's synthesized demo track
    │   ├── scripts/qc.py             # holds, still at a glance, blank frames, loudness, stream tags on any MP4
    │   ├── scripts/imagegen.py       # optional: generated images, each with its request record
    │   ├── assets/template-webgl/    # engine, preview player, render.ts, font-instances.py, fonts, an
    │   │                             # example video with one scene per way of drawing; pdoom specifics
    │   │                             # removed
    │   └── assets/realism/           # the realism kit, copied into a project's src/realism/ on demand
    ├── video-ideas/                  # choosing what to make: ideas in, a starting prompt out
    │   └── SKILL.md                  # text only: directions, the prompt's three parts, where it stops
    ├── video-repo/                   # handing a project on: a git repository someone else can clone
    │   ├── SKILL.md                  # where the repository goes, files by role, keys out, the clone check
    │   ├── references/repository-files.md  # the README, docs/REPOSITORY.md, AGENTS.md's section, ignores
    │   └── scripts/audit.ts          # (bun, read-only) sizes, duplicates, keys, home paths, e-mail addresses
    ├── youtube-package/              # publishing: three thumbnails with one title, the description, the tags
    │   ├── SKILL.md                  # the pair, the bar, the session's steps and its stop rules
    │   ├── references/art.md         # the pictures: ideas, plates, staging, photos, generation, type, critic
    │   ├── references/youtube.md     # the words, and YouTube's sizes, limits, testing and policy, dated
    │   └── scripts/youtube.ts        # (bun, no dependencies) shoot | preview | niche | check, on Chrome
    └── soundtrack/                   # the sound: audio in, timing data out
        ├── SKILL.md                  # generate (ElevenLabs), stand in, or analyze the user's audio
        ├── references/elevenlabs.md  # read only when generating: key, costs, voice and music lessons
        └── scripts/                  # uv scripts with PEP 723 inline deps
            ├── eleven.py             # tts | music | sfx → audio + request record + word timings
            ├── standin.py            # a free local voice (Kokoro) in eleven.py's place
            ├── beats.py              # beats, downbeats, sections, loudness → data/audio.json
            ├── align.py              # the user's own song: lyrics timed to the vocals
            ├── mix.py                # voice, music and effects; loudness by kind of piece
            └── *_models.py           # beats.py's and align.py's model stages, in their own environments
```

`soundtrack` always ends with the same output, whichever path it takes: audio files plus `data/*.json` in
the formats the engine's `audio.ts` and `words.ts` read.

`code-video/references/`, each named in SKILL.md with when to read it:

- `treatment-template.md`, `style-template.md`: the brief (idea, storyboard, scene briefs, Decisions) and
  the shared look (palette, type, tone, what to avoid).
- `engine-guide-template.md`: the project's `docs/ENGINE.md`, the scene API and its rules.
- `contract.md`: the f(t) rule's edge cases, three.js, images and footage, 4K, cheaper preview paths.
- `motion.md`: eases, keys, cuts, sync, pacing.
- `glsl-cookbook.md`: working code for lines at 4K, raymarching, kinetic type, karaoke, fields, particles,
  inks.
- `critique.md`: the director's loop, the stills loop, the critic and its prompts, the measured checks, the
  hand-off and the delivery.
- `images.md`, `blender.md`, `math.md`: optional tools, each read only when in play.
- `realism.md`: a photographic 3D shot, with the realism kit (`assets/realism/`).
- `backends.md`: the order of choice (the engine, then HyperFrames, then Remotion as an optional last
  resort), and how to use the alternatives through their own skills.

### What `init` creates in a project

```
<project>/                       # one per brand, client or channel, with one video or many
├── AGENTS.md, CLAUDE.md         # conventions for later sessions ("Coming back later")
├── README.md                    # for the director: the commands to watch and render without an agent
│                                # (written once, when the project has none; theirs after that)
├── package.json, vite.config.ts, index.html, tsconfig.json, tsconfig.scripts.json
├── src/                         # the shared engine (src/engine/) and preview player (src/main.ts);
│                                # src/look.ts holds the look in code
├── scripts/render.ts            # preview, link, stills, sheet, verify, perf, gpu, video, poster;
│                                # --video <name>, --size <w>x<h> for a second format
├── scripts/font-instances.py    # static instances of a variable font, for a typeface a project adds
├── public/fonts/                # the shared fonts, with their licenses
├── docs/ENGINE.md               # the engine guide; docs/STYLE.md, the shared look, comes with the first look;
│                                # docs/CHANNEL.md, the channel's identity, with the first YouTube package
├── videos/<name>/
│   ├── video.json               # title, size, fps, and its audio (or a duration)
│   ├── TREATMENT.md             # this video's idea, storyboard, scene briefs and Decisions
│   ├── CRITIQUE.md              # the critic rounds' ledger
│   ├── timeline.ts, scenes/     # its edit and its scene modules
│   ├── audio/                   # song, narration, music, effects, each with its request record
│   ├── mix.json                 # the mix of voice, music and effects that mix.py builds
│   ├── assets/                  # images and footage, each with a line in SOURCES.md
│   ├── data/                    # audio.json, and words.json for sung or spoken lines
│   └── youtube/                 # once youtube-package runs: the thumbnails, title.txt, description.txt,
│                                # tags.txt, NOTES.md and what rebuilds the thumbnails (kept in git)
├── videos/_shared/              # optional, made when needed: what several videos use (scenes/,
│                                # assets/ with SOURCES.md); no video.json, so it isn't a video
├── .audara-cache/               # caches and scratch work, git-ignored
├── out/<name>/                  # renders, sheets and reports, not committed
└── docs/REPOSITORY.md           # once video-repo puts it in git: what's kept, what's left out and why
```

- **The project folder is Vite's root,** so each video's audio and data are served from inside it, with no
  symlinks. pdoom-video kept them outside its `app/` folder and needed the `repoAssets` plugin
  (`vite.config.ts`) for Windows.
- **`words.json`** uses the format of pdoom-video's `lyrics.json` for sung and spoken lines alike, so scenes
  find narration words by their text exactly as they find lyrics.
- **Heavy model downloads** (`align.py`, `beats.py`'s tracker, `standin.py`'s voice) go to a user-level
  cache, not the project.
- **`.gitignore`:** `out/` (at any depth), `node_modules/`, `.env` and caches. init adds the entries a
  project's own `.gitignore` lacks, and doesn't count `/out/` as `out/`: the first covers only the top
  folder, and a project whose ignore file said `/out/` committed the reports a script wrote to a video's
  own `out/`. The rest of a repository (what's kept, left out or too big for GitHub) is video-repo's.

## Sources

YouTube's own pages, for the youtube-package skill (checked 2026-10-12):

- [YouTube Help: Add video thumbnails](https://support.google.com/youtube/answer/72431)
- [YouTube Help: A/B test titles and thumbnails](https://support.google.com/youtube/answer/16391400)
- [YouTube Help: Video chapters](https://support.google.com/youtube/answer/9884579)
- [YouTube Help: Tags](https://support.google.com/youtube/answer/146402)
- [YouTube Help: Hashtags](https://support.google.com/youtube/answer/6390658)
- [YouTube Help: Write descriptions](https://support.google.com/youtube/answer/12948449)
- [YouTube Help: Titles and thumbnails](https://support.google.com/youtube/answer/12340300)
- [YouTube Help: Thumbnails policy](https://support.google.com/youtube/answer/9229980)
- [YouTube Help: Disclosing use of GenAI content](https://support.google.com/youtube/answer/14328491)
- [YouTube Help: Audience retention (the Intro measure)](https://support.google.com/youtube/answer/9314415)
- [YouTube Data API: videos resource (the tags count)](https://developers.google.com/youtube/v3/docs/videos)

Everything else:

- [Anthropic: Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Claude Code: Skills](https://code.claude.com/docs/en/skills)
- [Claude Code: Plugins](https://code.claude.com/docs/en/plugins)
- [OpenAI: Build skills](https://learn.chatgpt.com/docs/build-skills)
- [OpenAI Codex: its built-in skill-creator skill](https://github.com/openai/codex/blob/main/codex-rs/skills/src/assets/samples/skill-creator/SKILL.md)
- [Agent Skills specification](https://agentskills.io/specification)
- [Agent Skills open standard: portable SKILL.md across Codex CLI, Claude Code and others](https://codex.danielvaughan.com/2026/05/05/agent-skills-open-standard-portable-skills-codex-cli-cross-agent/)
- [Codex: Package your plugin](https://developers.openai.com/codex/plugins/build)
- [Agent Plugins 1.0: One Package Format for Every AI Agent](https://blakecrosley.com/blog/agent-plugins-standard)
- [Agent Plugins 1.0: Why Claude Code Sat It Out](https://scienceshot.com/post/agent-plugins-1-0-claude-code)
- [Codex subagents](https://developers.openai.com/codex/subagents)
- [Codex CLI subagents: TOML format](https://codex.danielvaughan.com/2026/03/26/codex-cli-subagents-toml-parallelism/)
- [How to use Remotion Agent Skills with Claude Code](https://www.tella.com/blog/how-to-use-remotion-agent-skills-with-claude-code.md)
- [Remotion: @remotion/three](https://www.remotion.dev/docs/three)
- [Remotion: rendering WebGL with ANGLE](https://www.remotion.dev/docs/three-webgpu-canvas)
- [Remotion: license](https://www.remotion.dev/docs/license)
- [HyperFrames: Claude Code can now write and render videos](https://themenonlab.blog/blog/hyperframes-claude-code-writes-renders-videos)
- [HeyGen HyperFrames: HTML to MP4 for AI agents](https://www.noqta.tn/en/blog/heygen-hyperframes-html-to-mp4-ai-agent-video-2026)
- [Vercel Skills CLI (npx skills)](https://codex.danielvaughan.com/2026/05/31/codex-cli-vercel-skills-cli-npx-skills-open-agent-skills-ecosystem/)
- [hculap/skill-motion-graphic](https://github.com/hculap/skill-motion-graphic)
- [iart-ai/webgl-animation-skills](https://github.com/iart-ai/webgl-animation-skills)
- [ElevenLabs: text to speech with timestamps](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps)
- [ElevenLabs: compose music](https://elevenlabs.io/docs/api-reference/music/compose)
- [ElevenLabs: compose music with details](https://elevenlabs.io/docs/api-reference/music/compose-detailed)
- [ElevenLabs: create a composition plan](https://elevenlabs.io/docs/api-reference/music/create-composition-plan)
- [ElevenLabs: composition plans guide](https://elevenlabs.io/docs/eleven-api/guides/how-to/music/composition-plans)
- [ElevenLabs: sound effects](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert)
- [elevenlabs/skills](https://github.com/elevenlabs/skills)
- [echris6/motion-video-kit](https://github.com/echris6/motion-video-kit)
- [Hamza Khalid: How to create motion graphics with Claude Opus 5.5 (Full Course)](https://x.com/humzaakhalid/status/2105203643758895454)
- [rari: Motion Engineering: Build a Video Studio Around Opus 5.5](https://x.com/0xwhrrari/status/2105643919119696297)

