# audara-studio

Make videos from code by directing an agent. Say what you want in a sentence or in pages, and bring a song,
a script or nothing at all: what you decide is followed exactly, and what you leave open the agent decides,
aiming for something worth watching. It builds the video in a live browser preview, takes your notes by time
("at 0:23 the title should land on the snare") and renders the MP4.

audara-studio is a plugin for Claude Code and Codex with six skills:

- **code-video**: music videos, lyric videos, motion graphics, explainers, title cards and loops, drawn
  with WebGL/GLSL, three.js and Canvas2D. Every frame is a function of time, so the preview matches the
  render and any moment has a link.
- **soundtrack**: turns a song or a script into audio and the timing the picture syncs to: beats, sections,
  word timings, narration and music (with ElevenLabs, asking before spending credits), effects and the mix,
  also for a video made elsewhere (filmed, or from AI video clips).
- **video-ideas**: for when you don't know yet what to make. It offers a few different ideas, helps you pick
  one and writes it up as a prompt, without building anything until you ask.
- **video-repo**: for when you want a project in git, finished or not started yet. It keeps what someone
  else needs to clone it and render the video again, leaves renders and files too big for GitHub out (and
  says which), keeps API keys and personal details out, and writes a README people can read. Nothing is
  pushed until you ask.
- **youtube-package**: for when a video is ready to publish. Three thumbnail options designed together with
  one title, then the description with chapters and the tags, written into the project and checked against
  YouTube's limits. The art comes from the video itself, staged and finished for a thumbnail; one option
  borrows the layout of a video on the same subject that did unusually well. Each option is judged small, in a
  mock of YouTube's feed, beside the title.
- **nutlight-style**: a house style you can name, for explainers: squirrels acting out the ideas in luminous
  geometric worlds, scenes that flow into each other and music cut from your own library. Ask for a video
  "in the Nutlight style" and the other skills make it in that look; it stays out of everything else.

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
like. It ends with the video in the preview and a critic's review, and offers to render. Give notes by time
(ask for another critic's review whenever you want one), and say "render it" when you want the MP4, which comes with a contact sheet, a poster frame and a quality
report (or ask for the MP4 in your first message to get it in one go). The project's own README has the
two commands to watch and render it yourself.

Bring a song and it cuts the picture to it:

> make a lyric video for the chorus of song.mp3, the lyrics are in lyrics.txt

Or leave it all open and name only a form or a style; what defines it is kept (a reel's chapters, a
psychedelic piece's colour):

> make a dynamic 15-second motion graphics video that shows what an incredible motion designer you are,
> like it's your showreel for a résumé. go all out

> make a dynamic 20-second motion graphics video that shows what an incredible motion designer you are,
> psychedelic and hypnotic. make it feel like a showreel piece. go all out.

Other ways in:

- **Not sure yet:** "give me some ideas for a short video for my bakery". You get a few directions and, once
  you pick one, a prompt; say "make it" to build it here, or paste it into another session.
- **Your script:** "make the video for script.txt, keep every word". The words stay as written; the agent
  makes the voice, music and picture, and says so when something in the script won't work.
- **Your direction:** a paragraph of it, or notes over days ("slower intro", "less blue in the chorus",
  "no 3D camera moves"). A note changes only what it names (the agent measures which moments changed), and
  your decisions are kept in the project, so they hold in later sessions.
- **Your product:** "a 15-second teaser for our app, the screens are in screens/". It shows your real
  screens as they are and asks for any the story needs that you didn't give, rather than drawing a
  lookalike. Ask for a concept or a mockup and it makes one, marked as a concept.
- **Photoreal 3D:** "a 15-second photoreal shot of a stone lantern at dusk, opening on a macro of its flame".
  It is lit like a photograph (a physical sky, sunlight and haze, a real lens), for places and things rather
  than people. Bring reference images to match (or ask for generated ones) and give it time: it compares
  its renders with them and iterates, and renders slower than a graphic piece.
- **Another format:** "also a vertical one for Reels". The same video is recomposed for that frame, not
  cropped, and a later fix lands in both.
- **Publishing:** "make three YouTube thumbnails for this video, with the title, description and tags". You
  get them in `videos/<video>/youtube/`, with the one the agent would pick and why. A title or text you've
  decided is used as you wrote it; one you offer as a start may be improved, and the agent says what changed.

To force the skill (for example when other video skills are installed), use `/audara-studio:code-video` in
Claude Code or `$audara-studio:code-video` in Codex.

An [ElevenLabs](https://elevenlabs.io) key in `ELEVENLABS_API_KEY` adds generated voice and music; an
[OpenAI](https://platform.openai.com) key in `OPENAI_API_KEY` adds generated images (Codex can also use its
own). The agent says what it will make and what it costs and waits for your yes, or spends within a budget
you give it. Without keys everything else works: music and effects synthesized in code, a local stand-in
voice, pictures drawn in code.

## More

- Tested prompts to copy or adapt, with what each took: [docs/prompts.md](docs/prompts.md)
- How it's designed and why: [docs/design.md](docs/design.md); how it got there: [docs/history.md](docs/history.md)
- Evals: [evals/README.md](evals/README.md)
- Credits and licenses: [NOTICE](NOTICE), [LICENSE](LICENSE) (MIT; the fonts keep their own licenses)
