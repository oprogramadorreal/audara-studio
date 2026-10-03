# audara-studio

Make videos from code by directing an agent. You bring the song or the script and the taste; the agent
writes the brief, builds the video in a live browser preview, takes your notes by time ("at 0:23 the title
should land on the snare") and renders the MP4.

audara-studio is a plugin for Claude Code and Codex with two skills:

- **code-video**: music videos, lyric videos, motion graphics, explainers, title cards and loops, drawn
  with WebGL/GLSL, three.js and Canvas2D. Every frame is a function of time, so the preview matches the
  render and any moment has a link.
- **soundtrack**: turns a song or a script into audio and the timing the picture syncs to: beats, sections,
  word timings, narration and music (with ElevenLabs, asking before spending credits), effects and the mix.

## Install

You need [bun](https://bun.sh), Google Chrome and ffmpeg; [uv](https://docs.astral.sh/uv/) for the
soundtrack and the quality report.

- **Claude Code:** `/plugin marketplace add oprogramadorreal/audara-studio`, then
  `/plugin install audara-studio@audara-studio`.
- **Codex:** `codex plugin marketplace add oprogramadorreal/audara-studio`, then
  `codex plugin add audara-studio@audara-studio`.
- **Either, skills only:** `npx skills add oprogramadorreal/audara-studio`.

## Your first video

Open a folder with a song in it and ask:

> make a 30-second video for song.mp3, dark and engraved

The agent asks what's missing, shows you a short treatment, and once you approve it, sets up the project and
gives you a preview link. Watch it and give notes by time. Say "render it" when it's ready: you get the MP4
with a contact sheet, a poster frame and a quality report.

To force the skill (for example when other video skills are installed), use `/audara-studio:code-video` in
Claude Code or `$audara-studio:code-video` in Codex.

Generating voice or music needs an [ElevenLabs](https://elevenlabs.io) API key in `ELEVENLABS_API_KEY`;
everything else works without one, and a local stand-in voice or synthesized music can fill in until
there is one.

## More

- How it's designed and why: [docs/design.md](docs/design.md)
- Evals: [evals/README.md](evals/README.md)
- Credits and licenses: [NOTICE](NOTICE), [LICENSE](LICENSE) (MIT; the fonts keep their own licenses)
