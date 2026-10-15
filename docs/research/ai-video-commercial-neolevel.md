# An AI-video commercial made beside audara (Neolevel, 2026-10-13)

Written 2026-10-14 on audara-studio 0.7.1, from the project's files and its Claude Code session's transcript
(Opus 5.5, read through Herdr; its thinking was redacted). This is a dated snapshot, not a description of
the plugin: what changed because of it is in [history.md](../history.md) (0.7.2), what the skills do now in
[design.md](../design.md). It records what a film made of AI video clips took, as evidence for later
decisions (an alpha export from the engine, a skill for such films). Nothing here was built.

## The request

The user's prompt, in short (its API keys left out; the user has revoked them since): make the first of
three scripts in a PDF, a 60-second ad for Neolevel, a program for young entrepreneurs in Florianópolis;
read the brand's site and Instagram; "AAA production level, with a cinematic style"; "The choice of tools is
up to you. Go all out. You can use motion graphics, AI video generation, 3D graphics, or whatever else";
keys for OpenAI (images: "create a character sheet ... so characters stay consistent when you generate
videos with Seedance"), ElevenLabs (narration in a good commercial voice or the user's cloned one) and
Higgsfield (video models, "$20 maximum"); a Codex agent in another Herdr tab as an optional consultant.
audara-studio 0.7.1 was installed. The prompt didn't name it, and the session (in Ultracode, its workflow
mode) never invoked any of its skills.

## What it made

59 s, 1920×1080, 24 fps, H.264 at -14 LUFS, plus a ProRes 422 HQ master and voice, music and effects
stems. A photoreal young man in real places: a dark bedroom lit by a phone, a queue at dusk, a wall clock at
night (black and white, letterboxed), then at sunrise the colour returns, and a notebook, a mentor, a team,
a pitch at the FIESC Observatory and a walk on the Beira-Mar with the Hercílio Luz bridge, ending on the
logo forming in the sunset sky and a brand card. Every line of the script is in it.

## How

- **Picture:** OpenAI images (`gpt-image-2.5-sunburst`, 68 calls, about $12 reported): casting portraits, a
  turnaround and expression sheet, a set, then one 16:9 keyframe per shot, edited with the sheets as
  references to keep the face. Higgsfield image-to-video from the keyframes: 22 jobs, $14.32 of the $20 by
  the ledger's own estimates (Kling 3.0 Pro for 15 of them, at $0.38 to $0.95 a clip; one Seedance 2.5 at
  $2.31; one Seedance 2.0 reference-to-video at $1.51; five Wan 2.7, lip-sync among them). A side-by-side
  test chose Kling over Seedance 2.5: "similar quality, 1/5 price, native 1080p".
- **Sound:** narration in the user's cloned voice (`eleven_multilingual_v2`), 44 takes (about 990 credits)
  picked by a subagent with two speech-to-text engines; three library voices (`eleven_v4`) for the
  motivational reels heard on the phone, treated as phone audio; two music cues with ElevenLabs Music
  through soundtrack's own `eleven.py music plan` and `music compose`, the second stretched 2.5% so its last
  downbeat lands on the logo; effects from ElevenLabs. About 31k credits in all, as reported.
- **Post:** a Python and ffmpeg compositor (grade, a black-and-white mix, colour blooming from the window at
  the turn, letterbox, halation, grain), repairs painted over the clips, captions and the logo animation
  drawn with skia-python as ProRes 4444 clips with alpha, a mixer with gated ducking and a true-peak limiter.
- **Review:** Codex twice (the concept, then the first cut), three rounds of critic panels
  (picture, audio with speech-to-text, lip-sync, the brief, a skeptic), the last a regression check.
- **Time:** about four hours, from the prompt to the delivery (20:19 to 00:20 UTC).

## What the clips needed

- **Repairs:** both clocks re-drawn and tracked (the model had doubled the hands), a car that drove through
  the bedroom window trimmed out, an extra in the queue who looked like the hero cropped out, the first pen
  stroke composited, the stand-up at the turn replaced with the earlier Seedance 2.5 take. Left at
  handoff: the notebook's "handwriting" is scribble up close, and the room changes a little between the
  night and dawn angles.
- **Thrown away:** 7 of the 22 jobs, about $5 by the estimates: a Kling take replaced by Seedance, a
  reference-to-video test, and five Wan clips of him speaking his lines to camera. The user's one note
  during the session: "remove all scenes that you make our character look to the camera and talk... never
  try to make the charact talk some of the audio. it's weird, the lips does not sync well." Every line
  became voice-over, and the session kept the rule for future videos.

## What it wrote, and what audara had

About 3,900 lines of its own code, backups left out. Picture: a Higgsfield client and batch runner (633
lines), an OpenAI images helper (387), the compositor and edit (460), the clock and ink repairs (210), the
motion graphics (1,531). Sound: a voice generator, an effects helper, a stem tool, a mixer and its library
(621 lines).

- **soundtrack** covered the sound: its description named narration, music, effects and the mix of a
  video, and its production scripts (beats, align, eleven, mix, standin) take `--out <dir>` outside an
  audara project. The session read `eleven.py`, `mix.py` and `elevenlabs.md` from the plugin's folder and
  ran `eleven.py` for the music, but wrote the voice, effects and mix tools itself, without loading the
  skill. Those tools kept their requests, reported credits and measured loudness and peaks. The music
  licence (the account's Pro plan for a company's ad) was raised at handoff, after the score was in the
  cut; the skill calls for raising it before relying on the score. Where its needs went past the
  scripts: one film used four voices (`eleven.py tts` keeps one per narration), two music cues (`mix.py`
  takes one music file, so they'd be joined first) and a phone treatment for some lines.
- **code-video** didn't fit the picture: its description excluded AI video clips and camera footage; code
  doesn't draw a photoreal person; its footage path decodes every frame into GPU memory, for seconds of
  footage (59 s at 1080p would be about 11.7 GB); and it renders opaque H.264 only, while the captions and
  logo had to go over the clips. The session read only the first 6,000 bytes of its SKILL.md, which stop
  before the body's "AI video clips only when the director asks". The motion-graphics brief it gave a
  subagent asked for code-video's own rules (every frame a pure function of `t`, seeded randomness,
  sub-frame motion blur) in skia-python.

## Open questions

- **An alpha export** (ProRes 4444 or PNG frames) would let code-video make the titles, captions and logo
  of a film edited elsewhere. The engine drops alpha in three places (the renderer, the post pass, the
  H.264 encode), so it is real work. This project used alpha overlays; nobody has asked audara for them.
- **A skill for films made of AI clips** would hold what this session worked out: a character sheet and
  keyframes before any clip, a ledger of jobs with their estimates, a cheap model tested against an
  expensive one on the same shot, the repairs, no lip-sync unless the director wants it. It would need
  paid evals and would follow providers that change month to month. One project is the evidence so far.
