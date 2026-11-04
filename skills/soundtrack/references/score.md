# A score from several tracks

How to build a video's music from tracks someone already has (the director's library, licensed or bought
tracks, earlier takes) or from several generated ones: which part plays where, how they hand over, and how they
sit under a voice. The taste is the video's (its treatment's Sound, or a style that names one, such as
nutlight-style's music.md); this is the method. It came from long narrated videos scored this way, where most of
the director's sound notes were about joins: a gap after a transition, a track coming in too loud or too early, a
splice landing in a louder section, music stopping under the voice, words lost under the bed.

## Where the tracks come from

- **The director's library** when they have one: ask where it is and what they use each track for, once; it's a
  fact only they have. Note the folder in the treatment's Sound for later sessions. Copy the tracks used into the
  project (`videos/<video>/music/tracks/`) and read them by relative paths, so it rebuilds on another machine.
- **Each track's source and licence** go in `videos/<video>/assets/SOURCES.md` when the track enters the project,
  not at publishing: the licence the director names, where it came from, and what it requires (a credit line in
  the description is common for library tracks). Say when redistribution isn't known, and when a track is a cover
  or remake of a famous song, which can draw a Content ID claim even when licensed. Whether a track may go in a
  shared repository is the licence's question (video-repo asks).
- **Choosing,** when it's left to you: measure the candidates (`beats.py <track> --out .audara-cache/music/<name>`
  gives tempo, downbeats, sections and energy, outside the video's data) and read their names and any notes the
  director keeps. You can't listen, so say the picks are by measurement and the director's ear decides. When the
  director keeps the choice, offer two or three candidates for each stretch, each with what it brings. A track
  they assigned to a moment ("use this one for the coding sequence") goes there.

## Building it

- **A cue sheet first:** for each stretch of the story, the track, the bars used, where its turns land (anchored
  to words in `words.json` or to picture cues) and why. It goes in the treatment's Sound, shown with the brief.
- **Cuts and joins follow the music's phrasing:** a downbeat or a phrase end with a short equal-power crossfade
  (30-60 ms worked) is the usual join; a pickup, a prelap or a longer overlap is fine where the phrase asks for it.
  A cue ends on its own final hit or rings out with a tail rather than being chopped mid-phrase. A jump inside one
  track is a join like any other, and lands in a section of about the same energy: one splice from a quiet
  bridge into a section 8 dB louder was a "very noticeable cut".
- **Entrances** neither leave a gap after the transition nor run ahead of the line they belong to, and don't
  arrive too loud; coming in soft and rising often works, and a whoosh or a riser into the new track covers a
  change of key or energy. Late, early, too loud and a gap were each a separate note.
- **Stops are chosen:** music that stops under narration, or a silence before a punchline, is a beat. Each one
  is in the cue sheet with why, and the hand-off lists them, so a stop nobody chose reads as one.
- **The picture and the music turn together** where the video is cut to its music: a new track or a drop comes
  with a change in the picture, or the cue moves to a moment that already has one.
- **The arrangement is a script beside the audio** (`videos/<video>/music/arrange.py`, run with uv), with times
  taken from word and picture anchors and never typed, so a re-paced voice moves every cue with it. It writes one
  music file, which `mix.py` takes as its music with `under_voice`; `beats.py` on that file gives the scenes its
  grid when the picture syncs to the music.
- **Retime the picture to the music** where an action should land on a hit, not only the music to the picture.

## Under the voice

`mix.py` keeps the music under the voice by `under_voice` (12 LU by default) and ducks it while words play. That
is an average: a dark voice under bright tracks can still lose its consonants, and a loud effect or game sound
on top of the bed can bury a phrase the average calls fine. Check the voice's presence band (about 1-4 kHz)
against everything else on `mix.wav`, with `mix.py measure`'s phone check too, line by line. Where it is masked,
dip that band in the music under the words, from the arrangement, and hold those dips through short breaths so
the music doesn't pump between sentences. A track the director says is a little loud everywhere it plays comes
down everywhere it plays.

## What to report

The cue sheet, the measured levels and joins, a `?t=` link to every entrance, join and stop so the director can
listen to them in the preview, and plainly that nobody has listened yet when that is the case. A flag the
measures raised is fixed, marked as meant, or listed as open.

## Checks

Before the hand-off:
- every entrance: no gap, not early, not late, not too loud;
- every join: with the music's phrasing, nothing chopped mid-phrase, no click, no hole or surge across it;
- every stop under the voice: chosen, and listed;
- the voice stays clear over the music and the effects, line by line;
- each track has its source and licence in SOURCES.md.
