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
- **Search or browse first?** YouTube tells creators apart: a searchable title says plainly what someone typing
  would look for; an intriguing one makes someone who wasn't looking curious. Decide where most viewers will
  meet the video. A topic whose searches are all tutorials ("como a IA cria imagens") needs an explainer's
  signal ("por dentro", "o que acontece quando") or the intriguing route.
- **Write many, then cut** (10 to 20 across angles: the result, the question, the stakes, the story "I asked...",
  the surprising fact, what's inside or hidden, a transformation, a versus). Push the framing to its most
  extreme honest version, then pull back to what the video delivers. Keep the one that is understood in one
  read, makes someone want the answer, is true to the video, sounds current (an old premise, "De novo", read as
  denial), uses the audience's words (jargon goes to the description and tags: "Opus 5.5" lost to "Claude",
  "p(doom)" was "a bad title" for a Brazilian audience), puts the name viewers know early (it survives being
  cut), and sounds spoken in the video's language, punctuation included ("…" is one character and a deliberate
  one).
- **Length isn't a lever:** a 2026 study of 277 breakout videos (OverseerOS; observational) found no best
  length, the median near 58 characters; what matters is where the meaning lands. YouTube takes up to 100
  characters; what shows depends on where (measured 2026: about 46 on a phone's first line and 85 in its two, about
  80 in a laptop's home grid, 50 to 80 in the up-next column), so the words that matter go in the first 40 to 45.
  The preview shows where it's cut. One channel's accepted titles ran 31 to 53 characters.
- **Avoid:** a whole title in capitals (one or two words can be the channel's style), emoji (no benefit in a
  2026 matched-pairs study), an episode number or the channel's name first, a promise the video doesn't keep, a
  famous name used as bait: one the video isn't about. A name it is about (its research, its answers, its
  subject) belongs early, even when the video shows no logo or interface of it.
- **A question:** titles ending in a bare question averaged 0.82 times the average views of the 4 million 2026
  uploads vidIQ studied. An association, not a rule: a question often sits better in the picture, with the title
  around it. These studies observe, they don't prove; a channel's own results outrank them.
- **The YouTube title is not the project's working title:** `video.json`'s title and the treatment's heading stay.

## Description

- **Plain text, ready to paste:** YouTube shows Markdown's marks as typed; no line breaks inside a sentence; no
  notes for the user in it (those go in `NOTES.md`).
- **The opening** (search on a computer shows about the first 130 characters, cut with " ..."; a phone's search
  shows none; the watch page about three lines above "...more", a blank line counting as one): a whole sentence
  with the video's promise and the words people search for, echoing the pair without repeating the title.
  YouTube's advice: one or two main words that describe the video, in both the title and the description, and a
  description of its own for every video.
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
- **Characters, and bytes:** YouTube's help allows 5,000 characters, its Data API 5,000 bytes (an accent takes
  two, an emoji four), and an upload through the API or a tool using it counts bytes; `check` counts both. `wc -m`
  in Git Bash counts bytes (3,169 for a 3,064-character text).

## Chapters

- **YouTube's rules:** the first at 0:00 (Help writes 00:00; both work), at least three, in order, each at least
  10 seconds long (the last one too). Break one and there are no chapters at all. Adding them is one of Studio's
  advanced features, and a strike or a mature-audience video turns them off: say so if the channel may lack them.
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
- **Hashtags:** two to four at the end of the description, each about the video; YouTube shows up to three it
  finds most engaging by the title (on a computer, in the description's first line), and ignores them all past 60
  (`check` warns well before that: a long list reads as spam).

## Test & Compare

- In YouTube Studio on a computer (advanced features on), a video can test up to three titles, three
  thumbnails, or three pairs (titles since December 2025). The winner is the one with the most watch time, not
  clicks; a test runs up to two weeks and can end "performed the same" or inconclusive, more often when the
  variants are alike, and then YouTube keeps the first one uploaded: put the pick first. Editing the title or
  thumbnail stops a test. Not for Shorts, or for made-for-kids, mature-audience or private videos. Every test
  thumbnail should be at least 1280x720: one smaller downscales the whole test.
- So three thumbnails sharing one title is a clean test of the pictures: suggest it in the hand-off; the user
  runs it. YouTube announced (September 2026) thumbnails that serve the best of three to different audiences;
  where it exists, the same three fit it.
- After publishing, YouTube Analytics' Intro measure (viewers still watching at 30 s) helps tell whether the
  opening kept what the title and thumbnail promised; it also reflects how much the opening holds on its own.

## Thumbnails: specs and where they show

- **Size:** 1280x720 by default (a common ask, and the floor for a full-quality test); YouTube now
  recommends 3840x2160 (`shoot --scale 3` renders it from the same page); 16:9; at least 640 wide; JPG or PNG.
  Up to 2 MB uploads from the YouTube app; Studio on a computer takes up to 50 MB.
- **Where** (measured on youtube.com on 2026-10-12, logged out): the home grid, three across (344 px wide at a
  1366 px window, up to 528 on a big screen); search (500); the up-next column (about 215 to 325, beside the
  title; 168 in the classic layout some still see); the playlist panel (100); a phone's feed (the screen's width,
  about 390); the TV (large, not measured). The duration badge sits bottom right everywhere (keep about the last
  256x166 px of 1280x720 clear); corners are rounded (12 px on the home grid, about 45 at 1280 wide); desktop
  hover icons top right; a red bar along the bottom marks a video already begun.
- **The video replaces it:** pointing at a thumbnail on a computer plays the video muted with captions from its
  start, and phone feeds play it inline, often by default. Its first seconds are part of the package.

## Policy and disclosure

- **Misleading packaging:** a thumbnail or title that misrepresents the video can be removed, and YouTube has
  acted against clickbait whose promise the video doesn't keep. Thumbnails can't be sexual, violent or shocking.
- **AI used to make a thumbnail or a title needs no disclosure.** YouTube's disclosure (in Studio, the video's
  "AI use" attribute, once called "altered or synthetic content": use today's name) is about the video:
  realistic synthetic people, voices or events, and music generated by AI that is the video's main focus (a
  music video whose song came from Suno or ElevenLabs). Say so in the hand-off when it applies; the user sets
  it. It doesn't limit reach or monetization.
- **People and marks:** no one's likeness without their consent (OpenAI's image terms say the same); a brand's
  logo or character only as what the video is about, never as an endorsement.
- **Made for this video:** YouTube's spam policy names AI imagery churned out across many videos with minimal
  changes, and its Partner Program's "inauthentic content" rule (2025) keeps templated, mass-produced videos from
  earning. A channel's style repeats; each package says something about its own video.

## Sources

YouTube Help, checked 2026-10-12: thumbnails (support.google.com/youtube/answer/72431), A/B testing titles and
thumbnails (answer/16391400), titles and thumbnails (answer/12340300), chapters (answer/9884579), tags
(answer/146402), hashtags (answer/6390658), descriptions (answer/12948449), thumbnail policy (answer/9229980),
altered or synthetic content (answer/14328491), content performance (answer/16559650), audience retention and the
Intro measure (answer/9314415), title and description limits (answer/57404), advanced features (answer/9890437),
previews on hover and in feeds (answer/7640367), spam (answer/2801973), the Partner Program's monetization policies
(answer/1311392). The tags count and the description's bytes: YouTube Data API, videos resource
(developers.google.com/youtube/v3/docs/videos). Sizes and cut-offs: measured on youtube.com on 2026-10-12 (logged
out, region BR, windows 1280 to 1920 px wide and a 390 px phone). Title testing for all creators since December
2025: Search Engine Journal, 2025-12-04. Studies (observational): vidIQ's thumbnail study (2026-07-08, 500
breakouts) and title study (2026-07-16, 4 million uploads), vidiq.com/research; OverseerOS on title length
(2026-08-14) and emoji (2026-08-27), overseeros.com/blog.
