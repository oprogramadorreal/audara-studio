# audara-studio

Make videos from code by directing an agent. Say what you want in a sentence or in pages, and bring a song,
a script or nothing at all: what you decide is followed exactly, and what you leave open the agent decides,
aiming for something worth watching. It builds the video in a live browser preview, takes your notes by time
("at 0:23 the title should land on the snare") and renders the MP4.

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

Open an empty folder and ask:

> make a 20-second video showing why the sky is blue, with music and sound effects

The agent shows a short plan, gives you a preview link and builds while you watch; redirect it whenever you
like. It ends with the video in the preview and a critic's review, and offers to render. Give notes by time,
and say "render it" when you want the MP4, which comes with a contact sheet, a poster frame and a quality
report (or ask for the MP4 in your first message to get it in one go). The project's own README has the
two commands to watch and render it yourself.

Bring a song and it cuts the picture to it:

> make a lyric video for the chorus of song.mp3, the lyrics are in lyrics.txt

Other ways in:

- **Your script:** "make the video for script.txt, keep every word". The words stay as written; the agent
  makes the voice, music and picture, and says so when something in the script won't work.
- **Your direction:** a paragraph of it, or notes over days ("slower intro", "less blue in the chorus",
  "no 3D camera moves"). A note changes only what it names (the agent measures which moments changed), and
  your decisions are kept in the project, so they hold in later sessions.
- **Your product:** "a 15-second teaser for our app, the screens are in screens/". It shows your real
  screens as they are and asks for any the story needs that you didn't give, rather than drawing a
  lookalike. Ask for a concept or a mockup and it makes one, marked as a concept.
- **Another format:** "also a vertical one for Reels". The same video is recomposed for that frame, not
  cropped, and a later fix lands in both.

To force the skill (for example when other video skills are installed), use `/audara-studio:code-video` in
Claude Code or `$audara-studio:code-video` in Codex.

An [ElevenLabs](https://elevenlabs.io) key in `ELEVENLABS_API_KEY` adds generated voice and music; an
[OpenAI](https://platform.openai.com) key in `OPENAI_API_KEY` adds generated images (Codex can also use its
own). The agent says what it will make and what it costs and waits for your yes, or spends within a budget
you give it. Without keys everything else works: music and effects synthesized in code, a local stand-in
voice, pictures drawn in code.

## More

- How it's designed and why: [docs/design.md](docs/design.md); how it got there: [docs/history.md](docs/history.md)
- Evals: [evals/README.md](evals/README.md)
- Credits and licenses: [NOTICE](NOTICE), [LICENSE](LICENSE) (MIT; the fonts keep their own licenses)
