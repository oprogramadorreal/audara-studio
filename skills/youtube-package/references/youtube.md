# The words, and YouTube's rules

The title, the description with its chapters, the tags, and what YouTube allows and does with them. Read it
before writing or changing any of the words, and for the platform's limits. The numbers here are dated; the
help pages they come from are listed at the end.

Contents: The pair · Title · Description · Chapters · Tags and hashtags · Test & Compare · Thumbnails: specs and
where they show · Policy and disclosure · Sources

## The pair

- **Two jobs, one message.** The thumbnail shows or asks; the title promises or answers. Together they open one
  question the video answers early. A title that repeats the picture's words wastes half the space: one channel
  swapped "FOMOS NÓS" for "EM EXTINÇÃO" because its title already said "nós". A shared anchor (a name, the
  subject) can help.
- **One channel's formula,** as an example of the logic, not a template: the picture is the question put to an
  AI ("COMO VOCÊ FUNCIONA?", "VOCÊ TEM CONSCIÊNCIA?"), the title is its surprising answer, with the AI's name
  first ("Claude respondeu essa pergunta com um clipe", "A resposta do Claude é assustadora"). Other pairs work
  as well: the result shown and the question in the title; the stakes shown and the twist named; a picture with
  no words and a title that carries them.
- **Settle the title with the pictures in view:** the preview shows each option beside it. One creator chose a
  final title a day after the thumbnail, so that it pointed at it ("essa pergunta").

## Title

- **One title** in `title.txt`; the runners-up, each with its character count and a reason, in `NOTES.md` and
  the hand-off: people iterate on titles for days, and start from their own words when they have them.
- **Write many, then cut** (10 to 20 across angles: the result, the question, the stakes, the story "I asked...",
  the surprising fact). Keep the one that is understood in one read, makes someone want the answer, is true to
  the video, sounds current (an old premise, "De novo", read as denial), uses the audience's words (jargon goes
  to the description and tags: "Opus 5.5" lost to "Claude", "p(doom)" was "a bad title" for a Brazilian
  audience), puts the name viewers know early (it survives being cut), and sounds spoken in the video's language,
  punctuation included ("…" is one character and a deliberate one).
- **Length:** YouTube takes up to 100 characters; what shows depends on where (two lines in feeds, fewer on a
  phone beside a small thumbnail). The preview shows where it's cut. One channel's accepted titles ran 31 to 53
  characters.
- **Avoid:** a whole title in capitals (one word can be the channel's style), a row of emoji, an episode number
  first, a promise the video doesn't keep, a famous name used as bait.
- **The YouTube title is not the project's working title:** `video.json`'s title and the treatment's heading stay.

## Description

- **Plain text, ready to paste:** YouTube shows Markdown's marks as typed; no line breaks inside a sentence; no
  notes for the user in it (those go in `NOTES.md`).
- **The opening** (about the first 100 to 150 characters show in search and above "...more"): a whole sentence
  with the video's promise and the words people search for, echoing the pair without repeating the title.
- **Then short, by default** (one channel published 1,100 to 1,700 characters and cut a 4,500 one): what a viewer
  sees or learns, in natural sentences that carry the topic's common names; a question for the comments when the
  channel asks one; the chapters; links (earlier videos in the series, the source code, sources for facts);
  credits; a few hashtags at the end. "A full description" asked for can add more (sources, how it was made,
  lyrics).
- **Credits and honesty from the project's own records:** `videos/<video>/assets/SOURCES.md`, the soundtrack's
  records (music, voice, effects and their licences or plan), the treatment's Decisions and "Never claim" (an
  adapted work and its author, a dramatized script, a synthetic voice, a graph that only illustrates). Credits
  the user promised to give "in the description" go here. The person's name only as `docs/CHANNEL.md` says.
- **Links** as the user gave them, without tracking parameters (`?si=`); none invented; say which weren't checked.
- **No keyword lists:** a block of search terms in the description breaks YouTube's spam policy and reads badly.
- **Characters, not bytes:** `wc -m` in Git Bash counts bytes (3,169 for a 3,064-character text); `check` counts
  characters.

## Chapters

- **YouTube's rules:** the first at 0:00, at least three, in order, each at least 10 seconds long (the last one
  too). Break one and there are no chapters at all.
- **From the project's data, never from memory:** the timeline's entries (where scenes start), `data/words.json`
  (where a line is spoken or sung) and `data/audio.json` sections (a song's parts), checked against the final
  render's length (`check` reads it): an intro added later moves everything after it.
- **One chapter per part a viewer would jump to,** named in the viewer's words, not scene ids, short; parts under
  10 s merge into a neighbour; each mark on the whole second where its part starts (between the cut and the first
  word).
- **Format:** `0:00 Name`, one per line, under a short heading line in the video's language. A separator such as
  "·" may become part of each name.
- **Captions:** when the video has `data/words.json`, an `.srt` made from it helps viewers and search; offer it.

## Tags and hashtags

- **Tags matter little** to discovery, YouTube says, so they get minutes: 5 to 15 short tags (the topic and its
  common names, what the video features, the channel's own recurring tags, a misspelling people type), lowercase
  as the channel writes them, comma-separated on one line in `tags.txt`. YouTube's 500-character count adds a
  comma between tags and quotes around a tag with a space (`check` counts it so).
- **No one else's name or brand the video isn't about:** misleading metadata.
- **Hashtags:** two to four at the end of the description; YouTube may show up to three above the title; more
  than 15 and it ignores them all.

## Test & Compare

- In YouTube Studio on a computer, a video can test up to three titles, three thumbnails, or three pairs. The
  winner is the one with the most watch time, not clicks; a test runs days to two weeks and may end without a
  clear winner. Every test thumbnail should be at least 1280x720: one smaller downscales the whole test to 480p.
- So three thumbnails sharing one title is a clean test of the pictures: suggest it in the hand-off; the user
  runs it.

## Thumbnails: specs and where they show

- **Size:** 1280x720 by default (the user's usual ask and the floor for a full-quality test); YouTube now
  recommends 3840x2160 (`shoot --scale 3` renders it from the same page); 16:9; at least 640 wide; JPG or PNG.
  Up to 2 MB uploads from the YouTube app; Studio on a computer takes up to 50 MB.
- **Where:** the home grid (about 360 px wide on a laptop), search (360, bigger for a top result), the up-next
  column (168), a phone's feed (the screen's width, about 390), the TV (large). The duration badge sits bottom
  right everywhere; desktop hover icons top right; a red bar along the bottom marks a video already watched.

## Policy and disclosure

- **Misleading packaging:** a thumbnail or title that misrepresents the video can be removed, and YouTube has
  acted against clickbait whose promise the video doesn't keep. Thumbnails can't be sexual, violent or shocking.
- **AI used to make a thumbnail or a title needs no disclosure.** YouTube's "altered or synthetic content" setting
  is about the video: realistic synthetic people, voices or events. A synthetic voice or a realistic generated
  person in the video may need it: say so in the hand-off; the user sets it in Studio.
- **People and marks:** no one's likeness without their consent (OpenAI's image terms say the same); a brand's
  logo or character only as what the video is about, never as an endorsement.

## Sources

YouTube Help, checked 2026-10-12: thumbnails (support.google.com/youtube/answer/72431), A/B testing titles and
thumbnails (answer/16391400), chapters (answer/9884579), tags (answer/146402), hashtags (answer/6390658),
descriptions (answer/12948449), thumbnail policy (answer/9229980), altered or synthetic content
(answer/14328491), content performance (answer/16559650). The tags count: YouTube Data API, videos resource
(developers.google.com/youtube/v3/docs/videos).
