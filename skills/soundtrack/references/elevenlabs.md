# Generating with ElevenLabs

Read this before generating narration, music or sound effects. `scripts/eleven.py` makes every call
and writes the files; this page covers the key, what things cost, what each plan allows, and how
to direct the voice, the music and the effects. Paths are relative to the skill's folder.

## Contents

- [The key](#the-key)
- [Ask before spending](#ask-before-spending)
- [Costs](#costs)
- [What each plan allows](#what-each-plan-allows)
- [Models and voices](#models-and-voices)
- [Narration](#narration)
- [Music](#music)
- [Sound effects](#sound-effects)
- [Checking what was made](#checking-what-was-made)
- [What to leave to ElevenLabs' own skills](#what-to-leave-to-elevenlabs-own-skills)
- [Sources and credits](#sources-and-credits)

## The key

- The scripts read `ELEVENLABS_API_KEY` from the environment and nothing else. Never write the key
  into a project file or `.env` the project commits, never pass it on a command line, never print it.
  If the user pastes a key into the conversation, don't store it anywhere: ask them to set it in
  their environment (shell profile or system settings) and start the session again.
- Without a key every paid command exits 3, spends nothing and prints what it would have cost and
  what a key would add (`eleven.py tts script.txt` needs no `--voice` for that). Run it rather than
  checking the variable yourself, then tell the director in one line that no key is set, what a key
  would add and its cost, as the script printed them; name the free paths below and go on with the
  one that fits, unless they pick another:
  - the user's own audio (`beats.py`, `align.py`);
  - a local stand-in voice under an open license, named as a stand-in with its license (for
    example Kokoro-82M, Apache-2.0). Scenes find words by text, so they keep their sync when the
    real voice replaces it. Level it as `tts` levels narration (-16 LUFS, true peak at or under
    -1 dBTP; `mix.py measure` reads both) and end its generator with `align.py check --fix`;
  - music you synthesize in a seeded script, with its grid and cues from `beats.py grid`;
  - a silent placeholder: `"audio": null` and a `"duration"` in the video's `video.json`.
- A rejected key also exits 3. Some keys are limited to certain endpoints or carry a credit quota:
  a 403 names what the key or plan can't do.

## Ask before spending

Every command that costs credits refuses without `--yes`: it prints what it would make (characters
or seconds, estimated credits, voice, model, the expected length, and the credits left on the
account) and exits 4. Show the director those lines, wait for a yes, then run the same command
with `--yes`. A refused run writes nothing. Free: `voices`, `music plan`, every `--pick`, `--snap` /
`--no-snap`, `sfx --screen`, and re-running anything already made, because an unchanged request makes no
API call.

For a narrated video the usual order is:

1. `uv run scripts/eleven.py voices --language <code>`: choose a voice with the director.
2. `uv run scripts/eleven.py tts script.md --video <video> --voice <id> --say say.tsv --only 1 --yes`:
   one paragraph, to approve the voice by ear before paying for the rest (a first run without `--yes`
   proposes exactly this).
3. `uv run scripts/eleven.py tts script.md --video <video> --yes`: the other paragraphs, then
   `narration.wav` and `data/words.json`, its phrase edges already moved onto the sound.
4. `--takes 3 --block N --yes` for the lines that matter most, then `--pick K --block N`.
5. `uv run scripts/eleven.py stt --video <video> --yes`: does the audio say what the text says?
6. `music plan ... --from-narration`, review it, then `music compose --plan <file> --takes 2 --yes`,
   `--pick K`, and the `beats.py` command it prints.
7. `mix.py build --video <video>`, then set what it prints in `video.json` (`"audio": "audio/mix.wav"`
   and the mix's `"duration"`).

## Costs

Checked 2026-10-02 on the [pricing page](https://elevenlabs.io/pricing) and the
[API pricing page](https://elevenlabs.io/pricing/api). Plans spend credits; pay-as-you-go API use is
billed in dollars. The script's estimates use these numbers; the account's own figures win.

| What | Credits | API pay-as-you-go |
|---|---|---|
| Speech, Multilingual v2, v3, v4 | 1 per character | $0.08 per 1,000 characters |
| Speech, Flash v2.5 | 0.5-1 per character | $0.04 per 1,000 characters |
| Music | about 900 per minute, per take | $0.15 per minute |
| Composition plan | free (rate limited) | free |
| Sound effect | 40 per second with `--duration`, 200 without (so `--duration` is cheaper under 5 s) | $0.12 per minute |
| Speech to text (Scribe v2) | about 330 per minute | $0.22 per hour |

- Monthly credits: Free 10k, Starter 30k ($6), Creator 121k ($22), Pro 600k ($99), Scale 1.8M ($299),
  Business 6M ($990). Paid plans roll unused credits over for up to two months.
- Music also has monthly minute limits per plan in its terms: Free 11, Starter 17, Creator 62,
  Pro 304, Scale 1,100, Business 4,800. The API page lists other numbers; plan with the lower.
- Length of a voice before generating it: characters / 16 per second (pdoom-video's Portuguese
  narration ran 15.8-16.4 characters per second; other languages and voices are unmeasured).
- An effect whose length the model picks is estimated in dollars as 5 s (the length at which the two
  credit rates meet); how the API bills it is not documented.
- Some library voices carry a credit multiplier (legacy custom rates) and cost more per character
  than this table says.

## What each plan allows

Say this to the director before relying on generated audio for a client or a monetized video, and
again when you hand that audio over, naming the account's plan: the scripts print it, with what it
allows, after every paid run.

- **Free plan:** non-commercial use only, and published work must credit ElevenLabs
  ([terms](https://elevenlabs.io/terms-of-use) §1(c) and §4(a);
  [help center](https://elevenlabs.io/docs/help-center/legal/can-i-publish-the-content-i-generate-on-the-platform)).
  A pay-as-you-go top-up on the free plan is not a paid subscription: treat its output as
  non-commercial too.
- **Paid plans:** a commercial license for what is made while subscribed, kept after cancelling or
  downgrading. Content made before or after a subscription is not covered.
- **Anything labelled alpha, beta or preview** can't be used commercially
  ([beta terms](https://elevenlabs.io/bsa)).
- **Music** ([model terms](https://elevenlabs.io/eleven-music-model-specific-terms),
  [music terms](https://elevenlabs.io/music-terms)):
  - Who may use it: Starter, Creator and Pro are for individuals only; Scale allows organizations
    under 10 employees, Business under 50, Enterprise by contract. An agency or a company making the
    video needs Scale or above.
  - The Music API needs a paid plan or a pay-as-you-go top-up; the sung-word timestamps need Starter
    or above.
  - Every self-serve plan excludes film, TV, radio and studio games; online video is allowed.
  - Starter may not release music on streaming platforms (Spotify and the like); Creator and above
    may.
  - No reselling and no building a music library to license. Some industries are excluded
    (political campaigns, religious organizations, adult content, tobacco, weapons, prescription drugs).
- **Sound effects:** unless the account opts out on the sound-effects page, ElevenLabs may
  sublicense the generated effects to others ([terms](https://elevenlabs.io/sound-effects-terms)).

## Models and voices

These ids and limits live only here and in the script's defaults (checked 2026-10-02).

| Model | Use | Characters per request |
|---|---|---|
| `eleven_multilingual_v2` | the default: timestamps documented, 29 languages, steady over long text | 10,000 |
| `eleven_flash_v2_5` | cheaper and faster, 32 languages | 40,000 |
| `eleven_v3` | most expressive (audio tags); no speed, similarity or speaker boost | 5,000 |
| `eleven_v4` | new on 2026-09-28; whether this endpoint returns its timings is unverified: try `--only 1` first | 10,000 |

- Music is always `music_v2_5` (the API still defaults to the deprecated `music_v1`); effects
  `eleven_text_to_sound_v2`; transcription `scribe_v2`. The v1 speech models and Scribe v1 were
  scheduled for removal on 2026-07-09: don't use them.
- **Formats.** The default `mp3_44100_128` works on every plan. Creator and above can ask for
  `--format mp3_44100_192` (speech) or `mp3_48000_192` (music, the model's own quality); 44.1 kHz WAV
  needs Pro. A changed format is a new request, so it regenerates.
- **Voices.** `uv run scripts/eleven.py voices` lists the account's voices with their preview links,
  which cost nothing to play: share two or three with the director before the paid voice test. Never hard-code a voice id: ElevenLabs' default (premade) voices are
  retired on 2026-12-31 and only exist on accounts created before March 2026. For a video that may
  be regenerated later, use a voice saved in the account's library.
- **Settings** (stability, similarity, style, speed 0.7-1.2, speaker boost): the first run takes the
  voice's own stored settings and keeps them in `audio/narration/narration.json`. Change them only
  with the director: any change makes every paragraph again, so they all keep matching.

## Narration

The lessons below come from pdoom-video's narrated explainer (its `ROTEIRO.md`, "Geração no
ElevenLabs"), and `tts` is built around them.

- **One voice and the same settings for every file.** Mixed settings sound like two narrators. The
  script keeps them in `narration.json`; changing one makes every block again, after asking.
- **One paragraph is one block, and the picture cuts in the silence between blocks.** Write the
  script in paragraphs that follow the edit, separated by blank lines. Each paragraph is one
  request; `--gap` sets the silence heard between blocks (measured on the file). A pause between
  paragraphs is no longer than one between sentences unless you make it so, which is why blocks
  come from the text and not from silence detection. In a `.md` script, `# headings` group the
  paragraphs into chapters, and `music plan --from-narration` follows the chapters.
- **Acronyms read better written as they appear on screen** (AGI, GPT-4, ChatGPT) than spelled out.
  Respell only what the voice gets wrong: symbols (`P(doom)`), numbers that read wrong (`1E30`),
  names in another language (`Claude` in a Portuguese narration). Respellings go in a say map, not
  in the script: `say.tsv` lines of `shown<TAB>spoken` (`P(doom)`, a tab, `pê dum`), a JSON
  object, or `--say 'IA=I-Á'` (`align.py song` reads the same map, for the user's own recording).
  `words.json` keeps `w` as shown and adds `spoken`, so scenes find `findWords('P(doom)')`. An
  all-capitals entry (`IA`) only matches all-capitals text, so the Portuguese verb "ia" stays as
  it is.
- **Generate the key lines several times and keep the most natural take**: the opening line, the
  reveal, a joke. `--takes 3 --block N --yes`, listen, then `--pick K --block N`.
- **Listen to the names before approving a file**: people, products, foreign words.
- Keep stage directions out of the text: the voice reads them aloud. Audio tags such as
  `[whispers]` exist only on v3 and v4.
- Pace: pdoom-video's approved narration ran 159-181 words per minute, with the rhythm coming from
  the picture, not from long pauses. Per-block words per minute are in the takes report.
- **Timings.** The API times every character, but phrase starts tend to come out early: the first
  character is timed from 0.0 (in ElevenLabs' own sample it spans 0.19 s), and another TTS service
  tested for this skill (Microsoft's edge voices, in a baseline run) led the sound by about 110 ms at
  every sentence. An MP3 without a gapless header would also put every time about 25 ms early (the
  encoder and decoder delay, 1.5 frames at 60 fps); whether ElevenLabs' MP3s carry one is untested.
  So after every run `tts` measures each phrase's start and end against the waveform, reports the
  worst error in ms and in frames at 30 and 60 fps, and moves those edges onto the sound (free; the
  same code as `align.py check --fix`; `--no-snap` keeps the API's times). Words inside a phrase
  can't be measured that way; when every word must be exact (fast karaoke at 60 fps),
  `--format wav_24000` avoids the codec delay (44.1 kHz WAV needs the Pro plan).
- `words.json` is rewritten only when what it is made from changes: a hand fix stays until then, and
  is kept in `out/<video>/` when a changed narration replaces it.
- `narration.wav` is a stem levelled to -16 LUFS for the preview; `mix.py` sets the final balance
  and loudness.
- A file that gets regenerated (a changed paragraph or setting) moves to `older/` first, so a take
  the director liked is never lost.

## Music

The rules in this section are adapted from motion-video-kit's `references/audio.md` (MIT, (c) 2026
echris6), learned from client rejections.

- **Plan first.** `music plan` is free: review the sections and styles with the director before
  paying for a take.
- **One section per scene group, with exact durations that add up to the video.**
  `--lengths "intro:8,build:12,hit:2,resolve:8"`, or start times with the total
  (`--sections "intro:0,build:8,hit:20,resolve:22" --length 30`, the form `beats.py` takes), or
  `--from-narration` so the music changes where the chapters change (40% into the silence before
  each). A section under 3 s merges into the next one, so the chunk still starts where the short
  section starts (where its hit lands); then a chunk over 120 s is split.
- **No long intro, and a clear resolved final chord with a natural ring-out.** The script writes
  both into the plan, because a plan is sent without the prompt.
- **No brand, artist, band or song names** in prompts or plans: the API refuses them (with a
  suggestion, which the script prints) and the terms forbid them. Describe the sound: genre,
  instruments, tempo, key, mood.
- **Match the music to the audience, not to the category**, and remember that calm music still
  needs a pulse: a beatless track feels sleepy against cuts and needs too much gain to be heard.
- **Compare 2-3 takes at the same loudness**, so the director compares music, not volume:
  `music compose --takes 2` writes level-matched copies to `out/<video>/music/`.
- **Reject by short-term loudness**: a near-silent intro, a dip under a key scene, or a decay seconds
  before the end. The script flags all three per take; make another seed (`--seed`) or change the
  plan.
- **A human-made library track, edited to picture, can still beat a generated one.** Offer it when
  the takes don't land.
- After `--pick K`: run the `beats.py` command it prints, for beats and envelopes with the planned
  section times kept exactly (the music changes there, not on the nearest downbeat);
  `data/music-sections.json` holds the same times. A plan with lyric lines also gets the sung words
  (`data/words.json`, or `song-words.json` when a narration already owns `words.json`). Under a
  narration the music plays in `mix.wav` from 0 s, so its analysis keeps the video's timeline.
- Keep one take under 5 minutes: the API accepts up to 10, but other ElevenLabs pages state a
  5-minute limit.

## Sound effects

Also adapted from motion-video-kit (`references/audio.md`, `scripts/sfx-candidates.py`).

- **Few and clean.** One short, soft whoosh on real transitions only (scene changes, wipes, a title
  slam); small clean sounds only on real actions (a click on a click, a pop on a badge, a tick on a
  label). A 3D reveal reads better with a musical accent in the score's key than with a noise.
- **Screen before anyone listens.** `sfx "<prompt>" --n 4 --duration 0.6 --yes` ranks the
  candidates: more than 50% of the energy under 150 Hz reads as a boom; more than 40% over 6 kHz as
  hiss or a harsh click; broadband noise reads as a whoosh unless a whoosh was asked for; over 0.8 s
  is long for a transition that repeats. `sfx --screen <files>` does the same for library sounds.
- **Place each effect by its measured onset, not its file start**: a 33 ms lead-in made every hit
  two frames late at 60 fps. `--pick` records `onset_s` with the effect.
- **Set each level inside the effect's own frequency band against the music** (`mix.py`): about
  +3-4 dB in band, with the ear-sensitive 2-8 kHz lift capped near 4 dB. Keep repeated sounds at
  the same level, deliver a music-only version, and change one thing per round, named by timestamp.
- `--duration` makes an effect predictable, and cheaper when it is under 5 s (40 credits per second
  instead of 200 per effect).
- Licensed library sounds often beat generated ones; screen them the same way.

## Checking what was made

- `stt` transcribes with Scribe v2 and compares the transcript with what was meant to be said
  (`words.json`'s spoken words); it lists the differences with their times. Numbers and respelled
  names can differ in spelling and still sound right: listen there.
- The numbers measure, they don't judge. The director approves the voice, the takes and the music
  by ear; say plainly what nobody has listened to yet.

## What to leave to ElevenLabs' own skills

[elevenlabs/skills](https://github.com/elevenlabs/skills) covers writing app code with the SDK,
voice design, voice cloning, dubbing, conversational agents and streaming. audara only owns the
calls that become files, their request records and the timing JSON the engine reads.

## Sources and credits

- API reference: [text to speech with timestamps](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps),
  [composition plan](https://elevenlabs.io/docs/api-reference/music/create-composition-plan),
  [compose with details](https://elevenlabs.io/docs/api-reference/music/compose-detailed),
  [sound effects](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert),
  [speech to text](https://elevenlabs.io/docs/api-reference/speech-to-text/convert),
  [models](https://elevenlabs.io/docs/overview/models),
  [default voices](https://elevenlabs.io/docs/help-center/product/voices/my-voices/what-are-default-voices).
- Music and sound-effect rules adapted from [motion-video-kit](https://github.com/echris6/motion-video-kit)
  (MIT, (c) 2026 echris6).
- Narration lessons from [pdoom-video](https://github.com/mexicat/pdoom-video) (MIT, (c) 2026
  Giacomo Magnanini).
