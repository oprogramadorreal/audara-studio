# Nutlight: music

The style's sound is real, produced music that is cut to the story and stays clearly audible under the voice.
soundtrack does the audio work (analysis, generation, the mix); this file is the taste and the method for a
score built from several tracks. It names no tracks, and none ship with the plugin: each video's music
comes from the director.

## The sensibility

- Produced instrumental tracks with a steady pulse, picked for each stretch of the story by what it needs:
  curious, building, tense, light, triumphant. Where the voice speaks, nothing sung competes with it; a track
  with a voice-like lead plays where the voice rests.
- The music's turns land on the story's: a drop on the word that reveals, a new section where a new idea
  starts, a final hit on the last image of a chapter.
- Clearly audible, supporting and never competing. Music mixed so quietly it disappears was a note, and so was
  music that covered the narration.
- The picture and the music turn together. A big change in the music (a new track, a drop, a new section)
  comes with a change in the picture: a new place, a new palette, a camera move into a new space, an effect
  where it fits. Otherwise the cue moves to a moment that already has one. The director asked for this three
  times in one round of notes.
- Silence is designed: a held breath when something fails, a freeze before an answer. An accidental gap after
  a transition reads as a mistake.
- After the last word the music takes over, louder, and ends on a resolved hit, the track's own last chord if
  it has one, then black. The piece sets the length; about 15-20 s has worked.

## Where the music comes from

1. **The director's own library** (first choice): tracks they hold licences for and have used on their
   channel. Ask once where it is if they haven't said; it's a fact only they have. Note the folder in the
   treatment's Sound for later sessions. Each track used gets a line in `videos/<video>/assets/SOURCES.md`
   with the licence the director names. Say when redistribution isn't known, and when a track is a cover or
   remake of a famous song, which can draw a Content ID claim even when licensed.
2. **Generated music,** when nothing in the library fits a stretch or the director asks: soundtrack's
   `eleven.py music plan` (free; `--from-narration` sizes sections to the chapters) prints the cost, and
   nothing is composed before the director's yes (references/elevenlabs.md in soundtrack).
3. **Anything else that serves the brief:** a track the director names, music synthesized in code as a free
   stand-in or when asked, or silence.

## Choosing tracks

When the director leaves the choice to you, make it. Measure the candidates (`beats.py <track> --out
.audara-cache/music/<name>` gives tempo, downbeats, sections and energy, outside the video's data) and read
their names and any notes the director keeps. You can't listen, so
say that the picks are by measurement and the director's ear decides. When the director keeps the choice,
offer two or three candidates for each stretch, each with what it brings. Reusing a track across videos is
fine, but each video's score is its own, chosen for that story.

With the director's OK, keep a short catalogue note in the library folder: one line per track with its tempo,
key, length, energy and where it was used, drafted from measurements and corrected by the director's ear. Mood
labels in it stay provisional until someone has listened.

## Building the score

- **A cue sheet first:** for each stretch of the story, the track, the bars used, where its turns land
  (anchored to words in `words.json` or to picture cues) and why. Put it in the treatment's Sound and show it
  to the director with the rest of the brief.
- **Cuts** fall on the track's own downbeats with short equal-power crossfades (about 30-60 ms). Its bars play
  as they are, without stretching. A cue ends on its own final hit or rings out with a tail rather than being
  chopped mid-phrase. Within one track, a jump from one section to another is a cut like any other, on a
  downbeat, with the phrase in mind.
- **Entrances:** a new track comes in soft and rises, starting with its scene: neither leaving a gap after
  the transition nor running ahead of the line it belongs to. Late, early, too loud and a gap were each a
  separate note.
- **Keep the arrangement as a script beside the audio** (`videos/<video>/music/arrange.py`, run with uv), with
  times taken from word and picture anchors and never typed. A re-paced voice then moves every cue with it.
  It writes one music file, which `mix.py` takes as its music with `under_voice`. `beats.py` on that file
  gives the scenes its grid when the picture syncs to the music.
- **Retime the picture to the music** where an action should land on a hit, not only the music to the picture.

## Under the voice

`mix.py` keeps the music under the voice by `under_voice` (12 LU by default) and ducks it while words play.
A dark voice under bright tracks can still lose its consonants. Check the voice's presence band (about 1-4 kHz)
against the music on `mix.wav`, with `mix.py measure`'s phone check too. Where it is masked, dip that band in
the music under the words, from the arrangement. Hold those dips through short breaths so the music doesn't
pump between sentences.

## What to report

The cue sheet, the measured levels and joins, a `?t=` link to every entrance and join so the director can
listen to them in the preview, and plainly that nobody has listened yet when that is the case.

## Checks

Before the hand-off:
- every entrance: no gap, not early, not late, not too loud;
- every join: on a downbeat, nothing chopped mid-phrase, no click;
- every big music change has a change in the picture;
- the voice stays clear over the music;
- the outro is music-led and resolves.
