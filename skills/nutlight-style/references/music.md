# Nutlight: music

The style's sound is real, produced music that is cut to the story and stays clearly audible under the voice.
soundtrack does the audio work (analysis, generation, the mix), and its references/score.md is the method
for a score built from several tracks: the cue sheet, joins, entrances, the arrangement script, the voice over
the bed, licences at intake and the checks. This file is the style's taste and what it adds to that method. It
names no tracks, and none ship with the plugin: each video's music comes from the director.

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
   channel. Ask once where it is if they haven't said; it's a fact only they have. Its source and licence lines
   follow soundtrack's score.md.
2. **Generated music,** when nothing in the library fits a stretch or the director asks: soundtrack's
   `eleven.py music plan` (free; `--from-narration` sizes sections to the chapters) prints the cost, and
   nothing is composed before the director's yes (references/elevenlabs.md in soundtrack).
3. **Anything else that serves the brief:** a track the director names, music synthesized in code as a free
   stand-in or when asked, or silence.

## Choosing tracks and building the score

soundtrack's references/score.md: measured candidates when the choice is left to you, two or three per stretch
when the director keeps it, the cue sheet in the treatment's Sound, joins on the phrasing, soft entrances, chosen
stops, the arrangement as a script, and the voice checked against the bed line by line. In this style, reusing a
track across videos is fine, but each video's score is its own, chosen for that story. With the director's OK,
keep a short catalogue note in the library folder: one line per track with its tempo, key, length, energy and
where it was used, drafted from measurements and corrected by the director's ear; mood labels in it stay
provisional until someone has listened.

## Checks

Before the hand-off, score.md's checks (entrances, joins, stops, the voice over the bed, licences), and:
- every big music change has a change in the picture;
- where the voice speaks, nothing sung competes with it;
- the outro is music-led and resolves.
