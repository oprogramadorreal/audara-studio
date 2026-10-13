---
name: video-repo
description: "Puts a video project made with audara-studio, or the folder about to hold one, in git so someone else can clone it on another machine, work on it and render it again: keeps the code and the media the videos need (generated and paid files included), leaves renders and caches out, documents files too big for GitHub, keeps API keys, secrets and personal details out, writes a README people can read, and checks a fresh clone. Use it whenever the user asks for a git repository for a video project, to get one ready for GitHub, or to make it shareable or reproducible, even if they only say \"put this in git\". Not for everyday commits, branches or pull requests, for projects that aren't videos, or for making, changing or rendering a video (code-video)."
---

# video-repo

The user wants a repository someone else can clone on another machine and keep working from: everything the videos need, nothing they produce, no keys, secrets or personal details. Nothing leaves the machine (no remote, no push) unless they ask, and the videos themselves don't change. Their words outrank these defaults. `<skill>` is this skill's folder; other paths are the project's.

## Where the repository goes
- **No repository yet:** create one in the project folder, on `main`.
- **The project already is one:** its branches, remotes, history, LFS setup and anyone's uncommitted or staged work stay as they are.
- **A folder above is one** (a home folder, a monorepo): ask whether the project gets its own, and wait.

## No video project yet
With no `videos/*/video.json` yet, set up only what code-video's init keeps: the repository, a `.gitignore` with init's entries (`out/`, `node_modules/`, `.env*`, `.audara-cache/`, caches, logs), a `.gitattributes`, AGENTS.md with the Repository section and a CLAUDE.md importing it (`@AGENTS.md`). No README (init writes its own, with the commands to watch and render, only where none exists) and no commit unless asked. Tell them nothing commits on its own later: they commit as they go, and ask again once a video exists, for the README, docs and clone check.

## Sort every file by its role
Read AGENTS.md, each video's `video.json`, timeline and scenes (the files they load), `mix.json`, `assets/SOURCES.md`, the request records and `docs/`.
- **Keep the sources:** code, config, `bun.lock`, docs, treatments, critiques, lyrics and scripts, timing data, request records, fonts with their licenses, and any script that made a kept file (out of `.audara-cache/`, into `tools/`).
- **Keep what a render loads**, even a generated or derived file (the final mix, extracted frames), and what changing the video needs: the mix's sources, the chosen takes. Generated and paid media stay as files: the same request doesn't give the same bytes again, and it costs again.
- **Ignore what's produced:** `out/` at any depth, renders, stills and sheets wherever they landed (a `youtube/` package stays), `.audara-cache/`, `node_modules/`, `.venv/`, logs, tool scratch (`.playwright-mcp/`), another tool's render output. Ignore by folder or name, not every `*.mp4`: a blanket media rule hides the next clip a video needs from whoever adds it. An allowlist the project already has on purpose stays. A file already tracked that should be ignored leaves the index, not the disk.
- **Leave out, and list:** byte-identical duplicates, intermediates a kept file and a written command rebuild, rejected takes (`assets/older/`, unchosen voices). Name them to the user; any they want back goes in.
- **Too big for GitHub:** it warns over 50 MiB and refuses a file over 100 MiB, in the history too: one committed earlier blocks the push until the history is rewritten, which waits for the user's yes. A file over 100 MiB stays out, ignored by its path, and documented (references/repository-files.md). Offer, don't impose: a lossless smaller encoding, or Git LFS (its free quota counts every clone's download).
- **Outside the folder:** a file read by an absolute path (a model, a song in Downloads) is missing from every clone: bring it in when it's small and theirs to share, else document it as above.

## Keys, secrets and personal details
Before the first `git add`, run `bun <skill>/scripts/audit.ts` (`--history` when there are commits; `--staged` for what a commit will hold). It finds copied secrets (from the environment and `.env` files), key formats and files, home paths, e-mail addresses, files over GitHub's limits and duplicates, and never prints a secret (exit 1: blockers; 2: unfinished). It's a net, not proof: read what agents and tools wrote too (request records, treatments, notes), and the location data of camera photos and clips with a tool at hand (or say it wasn't checked). Then:
- a key comes out of the file (audara-studio's scripts read keys from the environment), and `.env*` is ignored;
- a path with the user's name becomes relative to the project, or goes when it only told a story;
- location data in a photo is named to the user: a copy without it, or their OK to keep it;
- a key already in the history: tell the user to revoke it now, whatever else happens; rewriting history waits for their yes.
Say what was checked and what wasn't; don't promise nothing personal is left.

## Write
Read references/repository-files.md, then write or extend `.gitignore` and `.gitattributes`; a README for people, built on init's (its commands kept); `docs/REPOSITORY.md` for whoever works on it next; and a Repository section in AGENTS.md, outside init's `<!-- audara:begin -->`/`<!-- audara:end -->` markers (init rewrites what's between). AGENTS.md and CLAUDE.md stay at the root, where the tools read them.

## Commit
- **Who:** the commits carry the configured name and e-mail. Unset: ask. When the user asked to keep personal details out, ask once before the first commit, with everything else ready: that address, or their GitHub noreply one set in this repository only. Ask the repository's name in the same message when the folder's looks like a working name (below).
- **What:** what you prepared, audited as staged. Someone's staged or uncommitted work stays out of your commits: commit only your paths, and ask first when a file holds theirs and yours, or when a file must also leave the index (a path-limited commit puts it back).

## Check a fresh clone
Clone the commit into a new folder in the system's temp folder (inside the project, Node finds a package missing from `package.json` in its `node_modules`) and run what a newcomer would: `bun install --frozen-lockfile`, `bun run check`, `bun scripts/render.ts verify --video <video>` for each video (every scene and the files it reads) and a three-second `video --draft --from <s> --to <s+3>` where there's sound. These start and stop their own server: no preview. A sandbox may block the install's network or the temp folder: ask for it, or report the check as not run. A failure: find why; a file left out or ignored by mistake is fixed in the repository and checked again; anything else (a problem the video already had) is reported, not fixed here. No paid generation and no full render. Then, passed or failed, delete the clone and check it's gone; if something holds it, retry when that ends, else give its path in the hand-off.

## Hand-off
Nothing is published yet and the rest can still change, so go on with defaults and end with: the commit and its sizes (tracked, `.git`, the largest files); what was left out and why; what the audit and the clone check ran and found; what's theirs to decide, with what you chose (the repository's name when the folder's looks like a working name such as `oprog-1`: it goes into `package.json`, `bun.lock`, AGENTS.md's heading and the README's title, not video ids or titles; facts the README can't know, left out rather than guessed; rights to third-party media if it may go public); and how to publish: an empty GitHub repository, private or public as they choose, as the remote. Create it or push only when asked.
