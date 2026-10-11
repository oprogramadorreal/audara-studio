---
name: video-repo
description: "Puts a video project made with audara in git so someone else can clone it on another machine, work on it and render it again: keeps the code and the media the videos need (generated and paid files included), leaves renders and caches out, documents files too big for GitHub, keeps API keys, secrets and personal details out, writes a README people can read, and checks a fresh clone. Use it whenever the user asks to create a git repository for a video project, get one ready for GitHub, or make it shareable or reproducible, even if they only say \"put this in git\". Not for everyday commits, branches or pull requests, for projects that aren't videos, or for making, changing or rendering a video (code-video)."
---

# video-repo

The user wants a repository someone else can clone on another machine and keep working from: everything the videos need, nothing they produce, no keys, secrets or personal details. Nothing leaves the machine (no remote, no push) unless they ask, and the videos themselves don't change. Their words outrank these defaults. `<skill>` is this skill's folder; other paths are the project's.

## Where the repository goes
`git rev-parse --show-toplevel` in the project folder:
- **None:** `git init -b main` there, so git can say what it would add.
- **This folder:** keep its branches, remotes, history and any Git LFS setup, and anything someone staged (see Commit). A file now ignored but tracked before leaves the index with `git rm --cached` (it stays on disk). A file over 100 MiB in the history stays in every clone, and GitHub refuses it: say so; rewriting history waits for the user's yes.
- **A folder above** (a home folder, a monorepo): ask whether the project gets a repository of its own or stays in that one, and wait, since the answer changes where everything goes.

## Sort every file by its role
Read AGENTS.md, each `videos/*/video.json`, its timeline and scenes (the files they load), `mix.json`, `assets/SOURCES.md`, the request records and `docs/`. `git ls-files -co --exclude-standard` lists what would go in (add `-i` for what wouldn't); the audit below adds totals, the largest files, duplicates and what's over GitHub's limits.
- **Keep the sources:** code, config, `bun.lock`, docs, treatments, critiques, lyrics and scripts, timing data, request records, fonts with their licenses, and any script that made a kept file (move it out of `.audara-cache/` into `tools/`).
- **Keep what a render loads**, even a generated or derived file (the final mix, extracted frames), and what someone needs to change the video: the mix's sources, the chosen takes. Generated and paid media stay as files: the same request doesn't give the same bytes again, and it costs again.
- **Ignore what's produced:** `out/` at any depth, renders, stills and sheets wherever they landed, `.audara-cache/`, `node_modules/`, `.venv/`, logs, tool scratch (`.playwright-mcp/`), another tool's render output. Ignore by folder or by name, not every `*.mp4`: a blanket media rule hides the next clip a video needs from the session that adds it. An allowlist the project already has on purpose stays.
- **Leave out, and list:** byte-identical duplicates, intermediates a kept file and a written command rebuild, rejected takes (`assets/older/`, unchosen voices). Name them to the user; any they want back goes in.
- **Too big for GitHub:** it warns over 50 MiB and refuses a file over 100 MiB. One over 100 MiB stays out, ignored by its path, and is documented: path, bytes, SHA-256, what it's for, how to get it back (no credentials, private paths or expiring links), and whether a clone renders without it. Offer, don't impose: a lossless smaller encoding, or Git LFS (its free quota counts every clone's download).
- **Outside the folder:** a file the project reads by an absolute path (a model, a song in Downloads) is missing from every clone: bring it in when it's small and theirs to share, else document it as above.

## Keys, secrets and personal details
Before the first `git add`, run `bun <skill>/scripts/audit.ts` (with `--history` in a repository that has commits). It finds copies of the secrets in the environment and `.env` files, known key formats, key files, home-folder paths, e-mail addresses and location data in photos and clips, and never prints a secret. Exit 1: blockers; 2: the audit couldn't finish. It's a net, not proof: also read what agents and tools wrote (request records, treatments, notes). Then:
- a key comes out of the file (audara's scripts read keys from the environment), and `.env*` is ignored;
- a path with the user's name becomes relative to the project, or goes when it only told a story;
- location data in a photo is named to the user: a copy without it, or their OK to keep it;
- a key already in the history: tell the user to revoke it now, whatever else happens; rewriting history waits for their yes.
Say what was checked and what wasn't; don't promise nothing personal is left.

## Write
Read references/repository-files.md, then write or extend:
- `.gitignore` (init's entries kept, `out/` rather than `/out/`, plus what the sorting found) and `.gitattributes` (`* text=auto eol=lf`, binary for the media and font types present).
- `README.md` for people, from init's (its commands kept): what the videos are, how they were made, how to run and render them, what's not in git.
- `docs/REPOSITORY.md` for whoever works on it next: what's kept and why, what's left out and how to get it back, how to add media.
- A short Repository section in AGENTS.md, outside init's `<!-- audara:begin -->`/`<!-- audara:end -->` markers (init rewrites what's between). AGENTS.md and CLAUDE.md stay at the root, where the tools read them.

## Commit and check a clone
- **Who commits:** every commit carries `git config user.name` and `user.email`. Unset: ask. When the user asked to keep personal details out, ask once before the first commit, with everything else ready: that address, or their GitHub noreply one set in this repository only. Ask the repository's name with it when the folder's looks like a working name (below).
- **What's committed:** stage, run `bun <skill>/scripts/audit.ts --staged` (the whole index), commit. When something was staged before you started, commit only your paths (`git commit -- <paths>`) so theirs stays staged; a file with changes of theirs and yours waits for the user.
- **A fresh clone:** clone into a temporary folder and run what a newcomer would: `bun install --frozen-lockfile`, `bun run check`, then `bun scripts/render.ts verify --video <video>` for each video (every scene and the files it reads: minutes) and a three-second `video --draft --from <s> --to <s+3>` where there's sound. Stop any preview it started, delete the clone. A failure: find why. A file left out or ignored by mistake is fixed in the repository and checked again; anything else (no network, a problem the video already had) is reported, not fixed here. No paid generation and no full render for this.

## Hand-off
Nothing is published yet and the rest can still change, so go on with defaults and end with:
- the commit, files and bytes tracked, the size of `.git` (`git count-objects -vH`), the largest files;
- what was left out and why, what the audit and the clone check ran, and what they found;
- what's theirs to decide, each with what you chose: the repository's name when the folder's looks like a working name (`oprog-1`: it goes into `package.json`, `bun.lock`, AGENTS.md's heading and the README's title, not video ids or titles); facts the README would state that the project doesn't hold (a published title, a link: left out, never guessed); rights to third-party media if the repository may go public;
- how to publish when they're ready: an empty GitHub repository (private or public is theirs), `git remote add origin <url>`, `git push -u origin <branch>`. Create it or push only when asked, and ask private or public first.
