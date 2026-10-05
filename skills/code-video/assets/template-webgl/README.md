# Video project

Videos made in code with [audara-studio](https://github.com/oprogramadorreal/audara-studio). Each one is a
folder in `videos/`, with its plan in `TREATMENT.md`. You need [bun](https://bun.sh), Google Chrome and
ffmpeg.

## Watch it

    bun run render preview

prints a link to open in your browser. Click the picture or press Space to play, and ← → to move by a
second. The preview keeps running in the background and shows every change as it's saved;
`bun run render preview --stop` stops it.

## Render it

    bun run render video

writes `out/<video>/<video>.mp4`, with motion blur, in a few minutes. It renders at the size and frame
rate the video was made at (set in `videos/<video>/video.json`), and its first line says what it will
write, such as `1920x1080 at 60 fps, 20 s`: if that isn't what you want, stop it with Ctrl+C. Add
`--scale 2` for twice the size (4K from 1080p), or `--draft` for a quick look without motion blur.

With several videos, add `--video <name>` (its folder in `videos/`) to either command.
