# More languages

The package in other languages, and dubbed audio tracks for them. Read it before offering either, and again
before making them. The dubbed audio is soundtrack's work (its references/dub.md); this page is what the user
sees, chooses and uploads.

Contents: What the user gets · The preset · Before offering · The offer · After the answer · A language's
package · Subtitles · The dubbed tracks · Where each file goes · The hand-off · Sources

## What the user gets

- **By default** (no question): the package in the video's own language, as SKILL.md makes it, with
  `youtube/subtitles.<code>.srt`, the narration's timed subtitles, when the video has timed narration
  (`data/words.json`). A narrow request (a title, the description, one option) gets that part and no offer.
- **More languages** (one question, after a whole package): the same package in the preset's other
  languages, in `youtube/<code>/`: the title, the description with the same chapters, every thumbnail that
  has words with its words translated (the ones without words serve every language), and timed subtitles.
  Nothing is generated, so no credits: say "no generation credits", not "free" (it takes their time and
  yours).
- **Dubbed audio** (a separate choice in the same question, only when the narration was made with an
  ElevenLabs voice in their account): a complete audio track per language, `youtube/<code>/mix.wav`, their
  voice speaking that language over the video's own music and effects, as long as the video. It spends
  credits: one yes covers the whole batch, up to a cap they agree.

## The preset

The 15 languages with the most native-speaking YouTube users, by one estimate (BeMultilingual, "The Top 21
Viewed Languages On YouTube", 2025 figures): YouTube users per country times the share of each country that
speaks the language natively. It counts speakers, not views or watch time, and its Indonesian entry counts
Javanese speakers. Call it "a 15-language preset", never "the most-watched languages".

| # | Language | Code | Default variant (say it; the user can change it) |
|---|---|---|---|
| 1 | Spanish | es | neutral Latin American (Studio: "Spanish (Latin America)" if the channel lists it) |
| 2 | English | en | American |
| 3 | Hindi | hi | standard Hindi, everyday words over Sanskritised ones |
| 4 | Portuguese | pt-BR | Brazilian |
| 5 | Arabic | ar | Modern Standard Arabic |
| 6 | Russian | ru | |
| 7 | Japanese | ja | |
| 8 | German | de | "du", as German YouTube speaks to its viewers |
| 9 | Bengali | bn | Bangla as written in Bangladesh and West Bengal |
| 10 | French | fr | France |
| 11 | Vietnamese | vi | |
| 12 | Turkish | tr | |
| 13 | Indonesian | id | |
| 14 | Korean | ko | |
| 15 | Italian | it | |

The video's own language counts once: a Portuguese video is offered the other 14; a video in a language
outside the preset (Dutch, Chinese) keeps its package and is offered all 15. Name every language that would
be added, in the user's language. The user can name a subset, or another language: follow them.

## Before offering

Free, and quick; the offer needs these:

- **Timed narration.** Subtitles and dubs are timed on `data/words.json`. A video without narration still
  gets translated titles, descriptions and thumbnail words: the offer says so.
- **Whether a dub is possible:** the video's mix built by soundtrack's `mix.py` (`audio/mix.wav` and its
  record: a dub keeps its music and effects), and a narration made by `eleven.py` with a voice in the account
  (its records name it). Without either, offer the packages only, and say in a line what a dub would need.
- **The estimate:** `uv run <soundtrack>/scripts/dub.py plan --video <video> --from <code> --langs <codes>`
  (`<soundtrack>` is the soundtrack skill's folder, beside this one): credits per language, the models (a
  language the original model doesn't speak gets one that does), the account's credits left, a cap that
  covers it. It spends nothing. With no ElevenLabs key it says so: offer the packages, and the dub once a
  key is set.

## The offer

One message, in the user's language, at the end of the package's hand-off, then one question. Something like
this, with the real values (adapt the words; keep every part):

> Your package (in `videos/<video>/youtube/`) has the title, the description with chapters, the tags, three
> thumbnails and timed Portuguese subtitles.
>
> **More languages.** A 15-language preset of YouTube's largest audiences adds 14: Spanish, English, Hindi,
> Arabic, Russian, Japanese, German, Bengali, French, Vietnamese, Turkish, Indonesian, Korean, Italian.
> 1. **Packages only, no generation credits:** each language gets its title, description, thumbnail 1 with
>    its words translated (2 and 3 have none) and timed subtitles, in `youtube/<code>/`.
> 2. **Packages and dubbed audio:** everything in 1, plus a full-length audio track per language in your
>    voice "<name>", over the video's own music and effects (`youtube/<code>/mix.wav`). About N ElevenLabs
>    credits (voice tests, a check of every track and retries included); I won't spend more than C (you
>    have M). It takes hours: one yes covers all 14, and I'll finish without asking again unless finishing
>    would need more than C or something you'd decide. The checks are measurements: nobody will have
>    listened to the accent or the delivery until you do. Uploading audio tracks needs Studio's advanced
>    features; YouTube's own automatic dubbing is free, from Portuguese only into English and Spanish, in a
>    voice it picks.
>
> Text inside the video stays in Portuguese.

Options: packages only / packages and dubbed audio, up to C credits / neither. In Claude Code ask with the
question tool; in Codex, as a plain question. Their answer, in their words, goes in `NOTES.md`; a partial
yes ("only Spanish and English", "no dub for Hindi") is the scope.

## After the answer

Packages only: make them, check them, hand off. With the dub: right after the yes, write the job
(`dub.py plan ... --approve "<their words>" --cap C`, soundtrack's references/dub.md), then make the
packages, then the dubs, language by language, the most viewers first. From the yes on, they can leave:

- **No routine questions.** A line of progress per language finished (files, measured numbers, credits so
  far), never ending in a question. A choice you'd normally offer (a title's alternative, a variant) is made,
  noted in `NOTES.md` with the alternative, and goes on.
- **Ask only** when finishing needs something outside the yes: more credits than the cap, another voice or
  a model the job doesn't list, a change of what the video says. A language that hits one stops; the others
  go on, and the hand-off says what each stopped one needs.
- **Interrupted** (a closed session, a full context): `dub.py status --video <video>` says where each
  language stands and what was spent; go on from there. Paid audio already made is never bought again.

## A language's package

- **The translation first:** `dub.py source --video <video>` writes the narration's lines as paragraphs;
  translate them into `youtube/<code>/narration.txt`, one paragraph per line and sentence for sentence where
  the language allows. It is both the subtitles' text and the dub's script, so they say the same thing.
  Keep the meaning, the facts and the promises; make it sound spoken in that language (a narrator, not a
  document), numbers as that language writes them. The director's script is locked; its translation is
  yours, faithful to it.
- **The title:** a title they decided is translated faithfully (its meaning, its promise, its words where the
  language allows) and sounds natural there; a stronger or shorter version goes in `NOTES.md` beside it,
  not in its place (a German translation of 67 characters had a 59-character one that kept the promise). A
  title that was yours is yours to adapt. The rules of references/youtube.md hold in every language. Ask a
  fresh subagent to read each as a native editor when you can, and say whose reading it is.
- **The description:** the same opening idea, chapters at the same times with translated names, the same
  links and credits (a licence's attribution stays); hashtags in the language where they exist.
- **Tags:** YouTube keeps one tag list per video, not one per language: `youtube/tags.txt` stays the only
  one. Add a few of the biggest languages' words only while the 500 characters allow it; the language
  folders have none.
- **Thumbnails:** every option with words gets `youtube/<code>/thumbnail-N.html` and `.png`, the same
  picture with the words translated, as short and as large as the original's (a longer phrase gets a smaller
  size or fewer words, never a cut). Options without words aren't copied. Type in a face that has the script:
  the channel's typeface where it covers it (Archivo has no Cyrillic), else a Noto face of the same weight
  (Noto Sans JP, KR, SC, Arabic, Devanagari, Bengali; OFL, its licence beside it, a line in `SOURCES.md`).
  Arabic is `dir="rtl"`. `shoot` each (it names a face that didn't draw), and look at each at 168 px.
- **Check:** `check --video <video>` checks the package and every language's folder.

## Subtitles

`bun <skill>/scripts/youtube.ts srt --video <video> --lang <code>`:

- No `youtube/<code>/narration.txt`: the video's own narration, `youtube/subtitles.<code>.srt`.
- With it: `youtube/<code>/subtitles.<code>.srt`, each translated sentence shown while its original sentence
  is spoken; once the dub is placed from that text, timed on the dubbed voice (made again after placing).
- Lines and speeds follow Netflix's guides (42 characters a line, Japanese 13, Korean and Chinese 16; two
  lines; 5/6 s to 7 s on screen). They carry the narration word for word, so a fast voice reads fast: the
  report gives the speed against the language's guide, to mention, not to fix by cutting words.
- Japanese and Chinese have no spaces: a space after each sentence's last mark in `narration.txt` lets the
  dub time each sentence (the voice doesn't read spaces); the subtitles leave the spaces out.
- Words the picture shows in the video's language while nobody speaks (a count, a label) can get timed notes:
  `youtube/<code>/notes.tsv`, `time<TAB>seconds<TAB>[the words]`, placed where no narration subtitle is.

## The dubbed tracks

Soundtrack's references/dub.md is the method (the job, its cap and ledger, placing, mixing, checks). What
matters here: the track replaces the narration, keeps the music and effects as the video has them, and is
as long as the video, so it plays in sync with it; the picture isn't changed (its words stay in the
original language). Each language's track is checked against the video and the original mix by
`dub.py verify`; `check` checks its length again.

## Where each file goes

YouTube Studio, the video, **Languages** (help pages read 2026-11-17; Studio's menus move, so say where to
look rather than promise a button):

- **Title and description:** Add language, then "Title and description": `title.txt`, `description.txt`.
- **Subtitles:** "Subtitles", Upload file, With timing: `subtitles.<code>.srt` (the video's own language's
  too, from `youtube/`).
- **Dub:** "Dub", Add: `mix.wav`. Needs Studio's advanced features; an automatic dub already there for that
  language has to be deleted first.
- **Thumbnail:** "Thumbnail", Add, for a long-form video: `thumbnail-N.png` of the option they picked.
  Without it, every language sees the original thumbnail.

## The hand-off

In the user's language, as SKILL.md's hand-off, plus: a line per language (its folder, the title, whether
dubbed, anything left open or stopped); the credits spent against the estimate and the cap; what was checked
by measurement and what nobody has listened to; the Studio steps above, once. `NOTES.md` gets a section per
language: the files, the titles weighed, the variant, their decisions.

## Sources

Ranking: bemultilingual.ca/blog/youtube-languages (read 2026-11-17). YouTube Help, read 2026-11-17:
multi-language audio and localized thumbnails (support.google.com/youtube/answer/13338784), automatic
dubbing (answer/15569972), translated titles and descriptions (answer/6289575), subtitle files
(answer/2734698) and adding them (answer/2734796). Subtitle lines and speeds: Netflix's timed-text style
guides (partnerhelp.netflixstudios.com: general requirements, article 215758617; timing, 360051554394; the
guides for each language, read 2026-11-17).
