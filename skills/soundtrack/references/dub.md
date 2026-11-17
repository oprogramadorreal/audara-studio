# Dubbed tracks

A video's narration in other languages, in the same ElevenLabs voice, each over the video's own music and
effects, one complete track per language for YouTube's audio tracks. `scripts/dub.py` does the work; this
page is the method and the job's rules. The youtube-package skill offers dubs with a video's package in more
languages (its references/languages.md: the offer, the translations, the subtitles, where files go); a dub
asked here directly follows the same job.

Contents: What a track is · What it needs · The yes · The job · A language, step by step · Fixes inside the
yes · Stops · Checks · Lessons

## What a track is

`youtube/<code>/mix.wav`: the video's mix with its narration replaced, as long as the video, so it plays in
sync with it. The music and the effects keep their files, their times and their gains from the video's own
mix (`audio/mix.wav.request.json`), so the bed doesn't move; each translated sentence starts where its
original sentence starts, because the picture follows the original words (a cut, a label, a reveal). The
picture isn't changed: words it shows stay in the original language (the subtitles can translate them).

## What it needs

- The video's mix built by `mix.py` and up to date (`dub.py` refuses an older one), with the voice apart
  from the music and effects in `mix.json`: a finished file with everything mixed in can't be dubbed here.
- Timed narration, `data/words.json`.
- An ElevenLabs voice the account owns, or one of ElevenLabs' premade voices: by default the one the narration
  was made with (its records name it), with the same settings. A narration the user recorded has no voice to keep: a dub then needs a voice they
  choose (`eleven.py voices`), which is their call, not a default.
- A translation per language, `youtube/<code>/narration.txt` (`dub.py source` writes the original's lines as
  paragraphs to translate): one paragraph per line, sentence for sentence where the language allows. The
  director's script is locked; its translation is the agent's work, faithful to it.

## The yes

`dub.py plan --video <video> --from <code> --langs <codes>` (free) prices the batch: per language its
characters (exact from a translation, else the original's length times a measured ratio), its model (the
narration's when it speaks the language; Multilingual v2 doesn't speak Bengali or Vietnamese, so they get
`eleven_v4`), a transcription check of every placed voice and a retry allowance; the credits left; a cap
that covers it. It looks the voice up, so a voice gone from the account shows here, before any yes.

Show the director, before asking: the languages, what each gets (a full track in their voice over the
video's music and effects), the estimate and the cap, that it takes hours and one yes covers every listed
language, and that the checks are measurements, not anyone listening. Their yes, in their words, and the cap
they accept are the job: `dub.py plan ... --approve "<their words>" --cap <credits>` writes
`dub/job.json`. A budget they set in their own words is that yes too. A key in the environment, or a question
tool that answers before anyone could, is not.

What the yes covers: the listed languages, the voice and models listed, retakes on new seeds, a sentence
shortened or reworded to fit its place (same meaning), respellings, anchors and levels, and every free step.
What it doesn't: more than the cap, another voice or model, a change of what the video says, anything paid
for something else (art, music), anything in YouTube Studio.

## The job

- **Spending only through `dub.py`** (`speak`, `hear`), never `eleven.py --yes` by hand: each paid request
  gets a ledger entry in `job.json` before it is sent, reserving the most it can cost, and is refused past
  the cap or past its language's share (the cap split by the estimates), so one language's retries can't
  starve the others. Only one run works on the job at a time (`dub/.job.lock`), so every write reads it fresh.
- **What a character may cost:** the list rate, 1 credit, the most ElevenLabs states for these models. That
  holds for a voice the account owns and for ElevenLabs' premade voices; a Voice Library voice the account
  doesn't own can carry a credit multiplier (a legacy custom rate, varying with the user's plan) that the API
  doesn't state, so no job takes one: a dub with it is the director's call, outside a cap. Should a request
  ever be billed past what it reserved and take the job past its cap, the job stops.
- **A request that may have been billed without its audio arriving** (a timeout, a dropped connection, a
  crash, anything but the server's no) stays reserved at its most ("possibly charged"), is never sent again by
  itself, and stops its language; the requests of the same run that did arrive stay billed:
  the hand-off names it and where to check (the account's history on elevenlabs.io). A run that died
  mid-request leaves its entry pending; the next `dub.py` run settles it the same way.
- **After translating everything,** `dub.py plan --video <video>` (no `--langs`) gives the updated estimate
  from the exact texts and splits the cap again; past the cap, it stops: that is the director's question.
- **Progress:** a line per language finished (its file, its numbers, credits so far), never a question.
- **Resume:** `dub.py status --video <video>` says what each language has, what's next and what was spent;
  paid audio on disk is never bought again (eleven.py reuses an unchanged request's file).

## A language, step by step

1. `say.tsv` in `dub/<code>/` for the voice (numbers, names, acronyms as that language says them; the
   original's map shows what needed it).
2. `dub.py speak --video <video> --lang <code> --test N`: the voice test on the hardest paragraph (most
   numbers and names, the tightest place), not the first; then `dub.py hear --video <video> --lang <code>
   --test N` transcribes it, letting the transcriber detect the language, against its text. The rest isn't made until it passes; a
   failure gets another take (`speak --block N --takes 2`, `--pick 2 --block N`) heard again, and a second
   failure stops the language. Read what eleven.py measures on it too (pace against the original's,
   loudness).
3. `dub.py speak --video <video> --lang <code>`: the other paragraphs, then the narration assembled.
4. `dub.py place --video <video> --lang <code>`: each sentence where its original sentence starts, cut only
   in measured pauses; a sentence that runs long may start up to 0.25 s early, be sped up to 8% (pitch
   kept), or push the next one up to 0.4 s late; past that it is an open issue saying how much shorter it
   must be, and nothing may run past the video's end. A line whose sentences don't match the original's one
   for one goes as one piece from the line's start. Each line is matched to the original line's level. Words the picture follows go in
   `dub/<code>/anchors.tsv` (`line<TAB>original words<TAB>translated words`, `#2` for a later occurrence):
   the translated word lands within 0.3 s of the original's, the sentence cut in the pause before it.
5. `dub.py mix --video <video> --lang <code>`: `youtube/<code>/mix.wav`. It lists the lines where the voice
   sits closer to the music or effects than the same line in the video's mix, with the lift that restores
   the original's margin.
6. `dub.py hear --video <video> --lang <code>`: the placed voice transcribed and compared with its text;
   under 85% means missing, repeated or cut words to find.
7. youtube-package's `srt --lang <code>` again, now timed on the dubbed voice.
8. After the last language: `dub.py verify --video <video>` (all of them together).

## Fixes inside the yes

- **A sentence too long for its place:** shorten it in `narration.txt` (same meaning; the subtitles follow),
  `speak` makes that paragraph again, `place`.
- **A line the music covers** (mix's list): listen there if you can; lift it in `dub/<code>/levels.tsv`
  (`line<TAB>dB<TAB>why`, at most the lift printed), `place`, `mix`. The lists are measurements: a flag the
  original mix also had was the director's level.
- **A bad block** (heard wrong, a broken take): `speak --block N --takes 2` makes another take on a new
  seed, `speak --pick K --block N` keeps it (free), then `place`.
- Two tries at the same problem, then it is an open issue in the hand-off, not a third round.

## Stops

A language stops, and the others go on, when a request may have been billed without arriving, its share of
the cap is spent, its voice test fails twice, or a fix would change what the video says. The job stops when
the cap or the account's credits run out. The hand-off says, for each stopped language, why and what going on
would need; only then is it the director's question. A higher cap the director approves (`plan --approve`
again, in their words) lifts a stop on a share or the cap; a possible charge and a failed voice test stay
stopped.

## Checks

`dub.py verify` (free) checks each track against the video (its final render's length, else the mix's, to a
frame), 48 kHz stereo, no clipped sample, the true peak under the ceiling, the music and effects as in the
video's mix (files, times, gains), the original voice absent, every placed word inside the track, that it is
made from what is there now (the translation, the respellings, the voice and its settings, the narration, the
anchors and levels, the placement, the video's words and mix: a track made before any of them changed fails),
the placement's open issues, the transcription; and, as things to listen to rather than failures, the loudness against the original
(integrated, and 3-second stretches more than 3 LU apart) and the spread across languages. `--mp4` muxes each
track on the final render in `out/<video>/dub/` to watch. Not checked by anything: the accent, the delivery,
the translation's meaning. Say so in every hand-off: nobody has listened unless the director has.

## Lessons

From an 8-minute narrated explainer dubbed by hand into eight languages (docs/history.md, 2026-11-17):

- The picture follows the original words, so each sentence goes where its original sits; a few words a cut
  or a label follows needed their own anchor.
- That voice read fast in English and Spanish (220 words a minute, some lines near 300): slower takes fitted
  better where the place allowed. The take report's pace is the check.
- German ran about as long as the Portuguese; Japanese and Korean used about half its characters, Chinese
  a third (what the estimate's ratios come from).
- Numbers and names need a say map in every language (dates, a mission's number, an abbreviation), as the original did.
- The account was billed about half the list rate per character for its narration: the estimate stays at the
  list rate, and the ledger keeps what was billed.
