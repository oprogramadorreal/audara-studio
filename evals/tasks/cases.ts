// The task eval cases, written out to evals/tasks/<id>/case.json (bun evals/tasks/cases.ts).
// Each case comes from a failure the no-skill baselines showed (or a strength they must keep), and
// from the handoff's definition of done. Assertions are checked by a grader with evidence; numbers
// refer to measurements the grader makes. $EVAL_SONG: a song with ground-truth timing data in
// $EVAL_SONG_DATA (audio.json, and lyrics.json for its words); $EVAL_PROJECT: a project made with audara
// (e.g. a cv-title-card run). A case with no key still runs the ElevenLabs mock ("key": false), so a request
// made anyway shows in mock-requests.jsonl.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type Case = { skill: string; setup: Record<string, unknown>; timeoutMinutes: number; turns: { prompt: string; newSession?: boolean }[]; assertions: string[] };

const cases: Record<string, Case> = {
  'cv-title-card': {
    skill: 'code-video', setup: { files: [] }, timeoutMinutes: 60,
    turns: [
      { prompt: 'Make a 15-second animated title card for my podcast, Night Signals. Minimal and elegant.' },
      { prompt: 'Looks good. 16:9 for YouTube, no tagline, just the name. Go ahead.' },
      { prompt: 'Render it.' },
    ],
    assertions: [
      'Turn 1 shows the brief in a message before the first scene file for this video is written (transcript order), then goes on building in the same turn unless it names something only the director can decide and waits for that alone.',
      'The brief message is about 15 non-blank lines (16 passes; a table\'s rule line is not counted) and about 250 words (275 passes; table pipes are not words), questions included, with a time-coded beat list covering 0-15 s and the look naming its colours (a hex value or a colour name for each; a muted palette names none) and its typeface by family (Cormorant Garamond, say; an elegant serif names none). Times read as written (1.25 s or 0:01.25, never 1:25), in the reply and in TREATMENT.md when the reply points to it. Any on-screen text beyond "Night Signals", or any restyling of the name (capitals, a split over lines, two colours), is listed as an assumption.',
      'The brief asks at most 3 questions, each with a default, and states the format and where the card will be shown, as a question with its default or in the Assumed line.',
      "By the end of the turn that builds it, the folder is an audara project (src/engine/, videos/<name>/video.json, AGENTS.md, CLAUDE.md); a message (progress messages count) gives this project's preview URL with ?v=<name> before the first scene file for this video is written (transcript order), and one before that turn ends gives at least one &t= link at a time other than 0 (the address served this work folder during the run: result.json previews).",
      'After turn 3, ffprobe on out/<name>/<name>.mp4 reports 15.00 +/- 0.04 s, 1920x1080, and color_primaries, color_transfer and color_space all bt709; an audio stream only if the brief listed its sound (music or effects synthesized in code, or none) as an assumption, and nothing paid; any other size made beside it (a 4K master, say) has the same length, color tags and audio, at 16:9.',
      'The video shows the words Night Signals (any case) and no other words, unless the brief listed them as an assumption.',
      "The final reply itself (turn 3, even when an earlier turn named them) links a contact sheet PNG and a poster PNG, and gives qc.py's numbers from its motion and blank lines: the frozen and the nearly frozen totals, the longest hold of each, and the blank frames (near-black or near-empty, even when there are none); every linked file exists (a path, or a file name under a folder the reply names, counts as a link).",
      "src/look.ts no longer holds the template's test-card palette, and the look is none of the archetypes on the style template's Avoid list unless the brief names it and says why. A navy or near-black ground of any tint with ivory or bone type and one warm accent (amber, orange or red, glowing or not) is the list's dark-ground archetype, whatever the brief calls the ground.",
      'render.ts verify passes for the video (run it).',
      "No script, log or measurement data the session wrote (.py, .ts, .log, .npy, .npz and the like; init's files aside) sits in out/ or at the project's top level: out/ holds only renders (draft clips included), stills, sheets, other check images (anywhere under out/<name>/) and reports (verify.json, qc.json, a critic's report); any cache is in the git-ignored .audara-cache/, and no npm folder or check image sits outside git-ignored paths.",
      'The builds end in the preview, their replies offering the render: no full render (not a --draft) runs before turn 3 asks for one, and turn 2\'s notes are applied and checked in the preview and stills (the transcripts).',
      'The brief honours "Minimal and elegant": a restrained piece, made well (judged on stills: deliberate type and spacing, no clutter), not a plain default; the Decisions section of TREATMENT.md records turn 2\'s "no tagline, just the name" in the director\'s words.',
    ],
  },
  'cv-song-brief': {
    skill: 'code-video', setup: { files: ['$EVAL_SONG => song.mp3'] }, timeoutMinutes: 120,
    turns: [{ prompt: 'make a 30-second video for song.mp3, dark and engraved' }],
    assertions: [
      'A treatment (videos/<name>/TREATMENT.md, shown in a message) exists before any scene module or MP4 for this video is written (transcript order or file times); the turn then builds on, or waits only for something it names that the director alone can decide.',
      "The plan shown (the message's; TREATMENT.md when the message only links it) is spot-sized: at most about 15 non-blank lines and 350 words, questions excluded, with none of the skeleton's Sync, Words on screen or Scenes sections (a one-line list of scene modules, as in the template's example, is fine). It gives the song window as start and end times, the aspect ratio, and storyboard rows that each give a time range, what is seen and the transition out (a hard cut said as one counts).",
      "The window starts within 33 ms of a ground-truth downbeat, or of the beat before a sung pickup's first word ($EVAL_SONG_DATA: audio.json, lyrics.json), ends on a downbeat, with a fade that lands on one or with the song's own end, and lasts 29-31 s; the reply states that length in bars and seconds.",
      'A message (not only TREATMENT.md) says why this part of the song, and what it says about the music there is true of the song ($EVAL_SONG_DATA).',
      "Storyboard rows change where the song's sections change inside the window: within one beat of each ground-truth boundary that starts a section of 2 bars or more ($EVAL_SONG_DATA/audio.json; beats.py merges shorter ones, such as a one-bar fill, on purpose), or on the downbeat that a pickup bar at that boundary leads into. A boundary within a bar of the window's ends is not counted.",
      'The turn asks at most 3 questions, only about what the prompt leaves open, each with a default and none about style; confirming the bar-rounded length counts as one of them.',
      'No image, video, music or voice generation runs (no image_gen call, no ElevenLabs request); if the plan proposes one, it asks first and names the cost.',
    ],
  },
  'cv-vertical-explainer': {
    skill: 'code-video', setup: { files: [] }, timeoutMinutes: 75,
    turns: [
      { prompt: 'Make a 20-second vertical explainer animation (for YouTube Shorts) showing how a hash map stores and finds a key.' },
      { prompt: 'Sounds good, go ahead. No sound for now.' },
      { prompt: 'Render it.' },
    ],
    assertions: [
      'Turn 1 shows a brief with timed beats covering 0-20 s, the 1080x1920 format, and sound stated as a question or an explicit assumption, before the first scene file is written.',
      "A message (progress messages count) gives the director this project's preview link written out in full with ?v=<name> before the first scene file for this video is written (transcript order), and one before turn 2 ends gives at least one full &t= link within 0.5 s of a beat time the brief lists (the address served this work folder during the run: result.json previews).",
      'The MP4 delivered after turn 3 is 1080x1920, 20.0 +/- 0.1 s, with no audio stream (turn 2 said no sound, so any sound made in turn 1 is gone), and turn 2 changed nothing else it didn\'t name (stills at the brief\'s beat times match before and after, but for the sound).',
      "Values shown on screen (hashes, bucket indices) are computed in code from the keys by a hash function the scene runs, and the copy and comparisons read them from there: a bucket typed into the code ('bucket 3', i === 3) fails.",
      "Text meant to be read is set at 44 px or more (1080 wide) and stays inside the Shorts safe area (about 250 px top, 400 px bottom, 200 px right, 60 px left: the style template's Layout table), measured on full-size frames.",
      "No near-empty or near-black frame at t=0 or at a cut, counting the brief's beat times as cuts (a one-scene video has none in verify.json, so check those frames yourself), unless the reply explains a deliberate one; and every hold of about 1.5 s or more that qc.py reports is marked in the treatment or named in the final reply with its time (a ?t= link) and what is read during it; a label such as 'intentional reading holds' doesn't count.",
      'The final reply links a contact sheet, a poster and QC numbers, and the files exist (a path, or a file name under a folder the reply names, counts as a link).',
      'A full render (not a --draft) runs only when a turn asks for one (turn 3); the builds before it end in the preview, offering the render, and notes are answered there (the transcripts).',
    ],
  },
  // A later session in a project made earlier (run-tasks.sh gives both tools the same one): init runs again
  // after the copy, rewriting the generated part of AGENTS.md, and an unrelated Vite app holds 5173 (decoy).
  // Run it --without too (the skills unlinked): then only AGENTS.md and docs/ENGINE.md carry the project's
  // conventions, as in a later session that doesn't load the skill.
  'cv-later-session-small-change': {
    skill: 'code-video', setup: { from: '$EVAL_PROJECT', project: 'init', decoy: 5173 }, timeoutMinutes: 30,
    turns: [{ prompt: 'the title comes in too fast at the start, make the intro slower' }],
    assertions: [
      "Before replying, the session itself ran `bun run check` and `render.ts verify`, and the scene keeps its existing timing scheme (fractions of the scene's entry, a beat grid or timing data), with no typed seconds.",
      'Only files under videos/<video>/ change; src/, scripts/ and other videos are unchanged (git diff); docs/STYLE.md may change only to correct what the change made wrong.',
      "The project starts without out/, so the session ran verify before its change as well as after (transcript order), and the last verify compared the two: out/<video>/verify.json's `changes` names the stretches that changed. The reply's account of what moved agrees with them, and any stretch outside the intro that changed is named in the reply with its link, or undone.",
      "The reply links this project's running preview, <address>/?v=<video>&t=<s>, where <address>/__audara returned this work folder during the run (result.json previews, or the transcript shows the agent checked it), with t inside the changed span or up to about 0.5 s before it. The changed span runs from where the title (not the background) first differs visibly between stills of the old and the new version at the same times to where the two match again.",
      "The change answers the note at the start: on stills of the old and the new version at the same times, over the ~1.5 s after the title first visibly changes in the old version, the new version shows less of the title (lit, drawn or opaque), because it starts later (the reading 'too soon') or comes in slower ('too quick'); a change that only stretches the end fails. And the reply names the reading it took and offers the other.",
      'No full MP4 render is made unless asked.',
      "The note is recorded in the director's words in videos/<video>/TREATMENT.md's Decisions (a section added if the project predates it), with the reading taken.",
    ],
  },
  // A second format of a finished video, in a later session on the project a cv-title-card run made (run-tasks.sh
  // gives it the same project as the later-session case): the 16:9 card recomposed for a vertical frame, not
  // cropped, sharing its timeline, and the 16:9 left as it was.
  'cv-second-format': {
    skill: 'code-video', setup: { from: '$EVAL_PROJECT', project: 'init' }, timeoutMinutes: 75,
    turns: [
      { prompt: 'I also need this title card as a vertical video for Instagram Reels.' },
      { prompt: 'Render it.' },
    ],
    assertions: [
      "After turn 2 a 1080x1920 MP4 exists with the 16:9 video's length to the frame and the same audio (ffprobe), and no full render (not a --draft) ran before turn 2.",
      'The vertical version is recomposed, not cropped, letterboxed or scaled down: on full-size stills at the treatment\'s beat times, nothing the 16:9 frame shows is cut off at the sides, there are no bars, and the title is laid out for the tall frame (its size and place differ from a centre crop of the 16:9 frame).',
      "Text meant to be read is at 44 px or more and inside the Reels safe area (about 250 px top, 400 px bottom, 200 px right, 60 px left: the style template's Layout table), measured on full-size 1080x1920 frames.",
      "The two formats share one timeline: the vertical one is the same video at --size 1080x1920 (render.ts's out/<video>/1080x1920/ holds its verify.json and MP4), or the reply says why it needed another edit; its entries start and end at the 16:9 version's times (verify.json timelines).",
      'The 16:9 version is unchanged: stills at its beat times are pixel-identical to the project as the run started (the setup commit), unless the reply names a change to it and why.',
      "The vertical format was checked on its own before its render: render.ts verify with --size passed, a sheet of it under out/<video>/1080x1920/ was looked at, and a reply gives its preview link with &size=1080x1920.",
      "TREATMENT.md's Decisions record the request in the director's words, and its Deliver line names the vertical format.",
    ],
  },
  // creative range: run 3 times with the skills and 3 times without (--without); a blind judge compares
  // the two sets of contact sheets. The skills must not make the results narrower or plainer.
  'cv-range-loop': {
    skill: 'code-video', setup: { files: [] }, timeoutMinutes: 60,
    turns: [
      { prompt: 'can you make a 10 second loop for my late night jazz stream, Blue Hours? something classy I can leave running behind the chat' },
      { prompt: 'Go with that.' },
      { prompt: 'Render it.' },
    ],
    assertions: [
      'An MP4 of 10.00 +/- 0.04 s exists, and the loop seam is clean: the mean absolute difference between the first and the last frame is at most about 1 level (8-bit).',
      'The final message reports frozen time measured with grain averaged out (qc.py) and the longest hold, or the treatment says why the piece holds.',
      'If a critic round ran, it was a fresh subagent given the user\'s words and the render, not the builder\'s reasoning, and its verdict appears in the final message; a full-cut round wrote out/<name>/critique/r<N>/first-look.md before its critic opened TREATMENT.md.',
      'No cliché from the style template\'s avoid list (starfield, equalizer bars, lens flare, glitch, navy/ivory/amber with a travelling pulse, or its twin: warm paper, black ink and one red accent, flat) appears unless the treatment names it with a reason.',
      'For the set: across the runs with the skills, the looks differ from each other at least as much as across the runs without (a blind judge comparing contact sheets and dominant colours), and the skill set is not judged plainer.',
    ],
  },
  // The short-prompt lyric video, word for word as a user typed it in the 2026-10-03 tests (whose videos had
  // weak graphics). $EVAL_INPUTS: a folder with pdoom-pt-BR.mp3 and its lyrics.txt (the user's own song, not
  // committed). Run it --without too: the plugin has to beat the model on its own here.
  'cv-lyric-short': {
    skill: 'code-video', setup: { files: ['$EVAL_INPUTS/pdoom-pt-BR.mp3 => pdoom-pt-BR.mp3', '$EVAL_INPUTS/lyrics.txt => lyrics.txt'] }, timeoutMinutes: 120,
    turns: [
      { prompt: 'faz um lyric video de uns 30 segundos com o refrão da minha música pdoom-pt-BR.mp3, com a letra aparecendo sincronizada com o canto. A letra completa tá em lyrics.txt' },
      { prompt: 'Pode seguir. Quero o MP4 e ver os arquivos gerados.' },
    ],
    assertions: [
      'An MP4 of 25-35 s at 16:9 or 9:16 exists by the end, cut from the chorus of pdoom-pt-BR.mp3 (the window holds the sung line "Aumento meu P(doom)"), with the song as its audio.',
      'Every sung word in the window is on screen in time with the voice: on stills at each word\'s start (from the run\'s words.json, checked against the audio by the grader\'s own alignment or spectrogram), the word is visible or highlighted no earlier than 0.1 s before it is sung and no later than 0.15 s after; the text matches lyrics.txt.',
      'Before something could be watched (a preview link or a video), the session stopped for the user at most once, and only for something the prompt left open that the user had to decide (spending, or a choice with no sensible default); a stop that only asks to approve a plan the defaults already settled fails.',
      'For the set (judged blind against the --without runs and the 2026-10-03 test videos, from contact sheets at 4 fps and the MP4s): the picture carries images beyond the lyrics\' text, changes where the music changes, and is not judged plainer or less striking than the runs without the skills.',
    ],
  },
  // The README's first prompt: nothing but one casual sentence, so the model makes the concept, the music, the
  // effects and the look. No key (the mock logs any request made anyway). Run it --without too.
  'cv-zero-asset': {
    skill: 'code-video', setup: { files: [], mock: 'elevenlabs', key: false }, timeoutMinutes: 120,
    turns: [
      { prompt: 'make a 20-second video showing why the sky is blue, with music and sound effects' },
      { prompt: 'Go ahead. I want the MP4 and to see the files.' },
    ],
    assertions: [
      'An MP4 of 18-22 s exists by the end, with an audio stream that carries music and at least two effects placed on picture events (stills at each effect onset show the event it belongs to); the music and effects were made without spending (mock-requests.jsonl has no paid request).',
      'With the skills, turn 1 ends in the preview, its reply offering the render, and no full render (not a --draft) runs before turn 2 asks for the MP4 (the transcripts).',
      "With the skills, the full-cut critic wrote out/<name>/critique/r<N>/first-look.md before it opened TREATMENT.md or docs/STYLE.md (its reads, in the transcripts or Codex's session files; where those don't show a subagent's reads, a first look that quotes or paraphrases the treatment fails), and full.md's item 0 quotes it; a stretch the first look calls weakest is either changed afterwards (stills before and after) or named in the hand-off as left open.",
      'What the video says about the sky is true: shorter (blue) wavelengths scatter more off air molecules (Rayleigh scattering), and nothing on screen claims otherwise.',
      'Before something could be watched (a preview link or a video), the session stopped for the user at most once, and only for something the prompt left open that the user had to decide; a stop that only asks to approve a plan the defaults already settled fails.',
      'render.ts verify passes (or, without the skills, the MP4 plays and its frames match its own timeline); no frame at t=0 or at a cut is near-black or near-empty unless the piece fades in on purpose.',
      'For the set (judged blind against the --without runs, from contact sheets at 4 fps and the MP4s with sound): the picture is judged more striking and better made, not plainer, and the sound is judged to fit the picture.',
    ],
  },
  // Detailed direction over several turns, a rejection that must survive a new session (turn 5 starts one), and
  // a small note that must change only what it names.
  'cv-direction-rejection': {
    skill: 'code-video', setup: { files: [] }, timeoutMinutes: 90,
    turns: [
      { prompt: 'Make a 20-second animated intro for my nature-science channel, Field Notes.' },
      { prompt: 'No serif type, I hate serif for this. And no leaves or plant icons, too literal. Keep going.' },
      { prompt: 'Land the title at 0:06 exactly, not later, and mute the green, it is too saturated.' },
      { prompt: 'Render it.' },
      { prompt: 'Make a 10-second end card for Field Notes in the same style.', newSession: true },
    ],
    assertions: [
      'After turn 2 no serif face is loaded for this video (font files and font calls in src/look.ts and the scenes) and no still at the brief\'s beat times shows leaves or plants.',
      "Before turn 2 ends, both rejections are written in the director's words where a later session reads them: TREATMENT.md's Decisions or docs/STYLE.md's Decisions or Avoid.",
      "After turn 3 the title's first visible frame is at 6.00 +/- 0.05 s (the timecode kept as given, not moved to a beat), the key green's HSV saturation is lower than after turn 2 at the same pixel and time, and nothing else moved: stills at the brief's other beat times match turn 2's.",
      'After turn 4 the MP4 is 20.00 +/- 0.04 s, 1920x1080; render.ts verify passes.',
      'Turn 5 (a new session, not resumed) uses no serif and no leaf or plant imagery, reuses the project\'s palette from src/look.ts, and its message cites the recorded decisions.',
    ],
  },
  // A script the director brings, with visual and timing notes: its words are locked, its notes are the storyboard.
  'cv-locked-script': {
    skill: 'code-video', setup: { files: ['explainer-script.md'], mock: 'elevenlabs', key: false }, timeoutMinutes: 120,
    turns: [
      { prompt: "Make the video from my script (explainer-script.md). Keep every word of the narration exactly and follow my visual notes. SQL is pronounced 'sequel'." },
      { prompt: 'Good. Go ahead with the free voice for now.' },
    ],
    assertions: [
      "The brief maps each [VISUAL] note to a time range in order, quotes the narration unchanged, and says what a generated voice would cost and that a free stand-in is used until there's a yes (no paid request: mock-requests.jsonl).",
      'words.json has 4 lines and its w sequence equals the narration exactly (43 words, punctuation as written, SQL shown as SQL with its spoken form set); nothing from the notes, the heading or the comment is spoken.',
      'On screen, "Why indexes make SQL fast" and "Index the columns you search." appear exactly as written; any other on-screen narration is verbatim.',
      'The cut to the row table lands within 2 frames of the end of "every row" (its first occurrence, words.json); the tree holds at least 2.0 s; the counter reads 20 within 0.25 s of "twenty".',
      'The video carries the narration (its last MP4, draft or final); render.ts verify passes; no reply rewords the script, and any change was asked about first.',
    ],
  },
  // A product film from the director's own screens, one of which the story needs and nobody has: the real
  // screens shown as they are, no lookalike for the missing one, no figure nobody gave.
  'cv-product-real-screens': {
    skill: 'code-video', setup: { files: ['tally-home.png', 'tally-scan.png'] }, timeoutMinutes: 120,
    turns: [
      { prompt: "Make a 15-second launch teaser for receipt scanning, the new feature of our budgeting app Tally. Our home and scan screens are in tally-home.png and tally-scan.png. Show someone scanning a receipt and the expense landing in their monthly budget." },
      { prompt: "Go ahead. The budget screen after a scan isn't designed yet." },
    ],
    assertions: [
      "Turn 1's brief names the screen after the scan (the budget with the new expense) as one neither file shows and asks for it, with the default it builds with meanwhile (the moment told another way, or a placeholder that reads as one), and goes on building in the same turn.",
      "tally-home.png and tally-scan.png are used as files (copied into videos/<name>/assets/ and loaded by a scene), not redrawn: on a still where a screen is shown flat and at rest, its interior matches the file's pixels within about 4 levels once scaled to the size shown; each has a line in assets/SOURCES.md naming the director as its source.",
      "No frame shows an app screen the two files don't (a budget or expense screen drawn to look like Tally's) unless it is plainly marked as a placeholder, judged on stills every 0.5 s of the last MP4; after turn 2, the expense landing is told without one (the home screen's own elements, type, a graphic).",
      "No figure or claim about Tally appears beyond the prompt's and the screens' own (no speed, accuracy, user count or savings); TREATMENT.md has a Never claim line; a value the scenes change over a real screen (a new total) agrees with the screens' own figures ($1,240 + $42.80) or is labelled as illustrative.",
      'Its last MP4 (draft or final) is 15 +/- 0.5 s, and render.ts verify passes; no full render (not a --draft) runs, since no turn asks for one.',
    ],
  },
  // Detailed visual direction and no script: every instruction followed and measurable; what is left open is the model's.
  'cv-visual-direction-no-script': {
    skill: 'code-video', setup: { files: [], mock: 'elevenlabs', key: false }, timeoutMinutes: 120,
    turns: [
      { prompt: "30-second vertical piece on the James Webb telescope's mirror unfolding. Black ground, 18 gold hexagons, thin white blueprint linework, one monospace typeface. The camera orbits slowly; the segments unfold one by one from 0:05 to 0:18; end on the full mirror with the line 'Eighteen mirrors, one eye.' Write a calm narration under 60 words and put low strings under it." },
      { prompt: 'Go ahead with free stand-ins for the voice and music.' },
    ],
    assertions: [
      'The brief shows the narration it wrote (under 60 words) and what generated voice and music would cost, and spends nothing (mock-requests.jsonl).',
      'Its last MP4 (draft or final) is 1080x1920, 30 +/- 0.5 s, with audio; the ground is black (mean luma under 16 outside the subject) and exactly 18 hexagons show at the end.',
      'The unfolding starts at 5.0 +/- 0.2 s and the last segment settles at 18.0 +/- 0.2 s (stills every 0.5 s), as given, not moved to a beat.',
      "Only one monospace family is used; 'Eighteen mirrors, one eye.' appears verbatim in the last scene.",
      'The music is low strings (the synthesized score\'s script or the music plan says so), and nothing in the picture contradicts a direction without the reply saying why.',
    ],
  },
  // Image generation, offered: the piece would gain from painted imagery and a key is set, but the prompt doesn't
  // open the toolbox. The option is mentioned once with its cost; nothing is spent; the build goes on in code.
  'cv-images-offered': {
    skill: 'code-video', setup: { files: [], mock: 'openai-images' }, timeoutMinutes: 120,
    turns: [
      { prompt: 'make a 15-second opening for a bedtime story app: a fox who collects moonlight in jars, painterly, like a picture book' },
      { prompt: 'Go ahead.' },
    ],
    assertions: [
      'A message mentions generated images once, in a line or two, with what it would make and the estimated cost, and does not hold up the build (scenes are written in the same turn).',
      'No paid image request is made (mock-images.jsonl has no paid=true entry) and no built-in image generation runs, since nobody said yes.',
      'The video is drawn in code and reads as painterly (judged on stills), 15 +/- 0.5 s long (its last MP4, draft or final).',
    ],
  },
  // Image generation, used: the prompt opens the toolbox with a budget. Claude uses the API mock; Codex
  // uses built-in generation under its plan's limits. Images are kept with provenance and treated in code.
  'cv-images-used': {
    skill: 'code-video', setup: { files: [], mock: 'openai-images' }, timeoutMinutes: 120,
    turns: [
      { prompt: 'make a 15-second opening for a bedtime story app: a fox who collects moonlight in jars, painterly, like a picture book. Generate whatever images you need, you can spend up to $1.' },
      { prompt: 'Render it at 4K.' },
    ],
    assertions: [
      'In Claude Code, turn 1 generates images with skills/code-video/scripts/imagegen.py (mock-images.jsonl), and each generated image in videos/<name>/assets/ has its .request.json beside it. In Codex, turn 1 uses built-in image generation (the transcripts and codex-sessions/), copies the generated images into videos/<name>/assets/, and keeps their provenance (tool/model, prompt and date); this path does not require a mock request or an API .request.json.',
      "Every generated image has a line in assets/SOURCES.md. In Claude Code, the estimated total stays within $1 and the reply states it. In Codex, the reply says that built-in generation uses the ChatGPT plan's limits and no separate API spend was made; any separately billed generation must still stay within the $1 budget and be reported.",
      'The 4K render in turn 2 makes no image request, through either the API (mock-images.jsonl) or built-in generation (the transcripts and codex-sessions/); it reuses the saved assets, and the plates are large enough for it or the reply says how they were scaled.',
      'The images are material, not slides: a scene loads the generated files as textures and treats them in code (layers moving at different rates, code-drawn light or particles over or behind them, a shader treatment), and no stretch is a Ken Burns pan over one still. (The mock returns placeholder pictures, gradients and shapes: a reply that keeps them off screen for that reason, and says so, passes on the code path alone.)',
      'render.ts verify passes; turn 1 ends in the preview with no full render (not a --draft), and after turn 2 a 3840x2160 render of 15 +/- 0.5 s exists.',
    ],
  },
  // The same open toolbox with no key: nothing is generated, the piece is drawn in code, and one line says what a key adds.
  'cv-images-no-key': {
    skill: 'code-video', setup: { files: [], mock: 'openai-images', key: false }, timeoutMinutes: 120,
    turns: [
      { prompt: 'make a 15-second opening for a bedtime story app: a fox who collects moonlight in jars, painterly, like a picture book. Use any images you need.' },
    ],
    assertions: [
      'A message says in one line that no OpenAI key is set, what a key would add and roughly what it costs (or, in Codex, that its built-in image generation would use the plan\'s limits), and the session makes no request to the mock (mock-images.jsonl is empty).',
      'In Codex, built-in image generation runs only if the reply says it is using the plan\'s limits because the prompt asked for images; in Claude Code nothing is generated.',
      'The piece is finished in code (15 +/- 0.5 s in its last MP4, draft or final) and reads as painterly on stills.',
    ],
  },
  'st-beats-json': {
    skill: 'soundtrack', setup: { files: ['$EVAL_SONG => song.mp3'] }, timeoutMinutes: 30,
    turns: [{ prompt: 'I need the beats and downbeats of song.mp3 as JSON so my animation can cut on the beat.' }],
    assertions: [
      'The beats and downbeats are written as a JSON file the reply names, at data/audio.json or where the user can find it.',
      'That JSON is in the engine format (duration, bpm, beats, downbeats, sections; features and onsets), and beats.py check passes on it (run it on a copy, with --audio song.mp3).',
      'Beats: at least 344 of 345 ground-truth beats ($EVAL_SONG_DATA/audio.json) matched within +/-50 ms and at least 98% within +/-17 ms; coverage runs to within one beat of the end of the file.',
      'bpm is within +/-0.1 of 132.007 and agrees with the beats array.',
      'Downbeats: at least 86 of 87 within +/-50 ms, all on the right bar phase.',
      "The reply says what t = 0 is: the first sample of the decoded audio, as browsers and ffmpeg play it (words that name that decode count; 'from playback start' alone doesn't say which), with no advice to shift every time by an encoder delay (offering a WAV for a player that keeps the delay is not such advice).",
      'A verification artifact (a beat sheet PNG and/or a click preview) exists and is named, with measured numbers: tempo, fit residual or phase deviation, first and last beat.',
      "Every number in the final message is right as measured, with the meaning the file or the script gives it: a 16-beat window's median is not a bound on every beat, an rms is not an average, and a cache's size is its size on disk.",
      "git status lists only deliverables, and no caches, venvs, model weights or decoded intermediates are left in the folder, except one git-ignored .audara-cache/ (the skill's place for uv's cache when a sandbox blocks the user's); any cache the run created, wherever it is (.audara-cache/, %TEMP%, a UV_CACHE_DIR it set), has its location and its size on disk (hard links counted once) stated in the last reply.",
    ],
  },
  // Turn 1 may go on with a stand-in (assertion 1 allows it), and then turn 2 asks for what is done already:
  // the final-message assertions test a reply that only confirms the work, which the skill asks to carry the
  // hand-off all the same.
  'st-voiceover-no-key': {
    skill: 'soundtrack', setup: { files: ['script.txt'], mock: 'elevenlabs', key: false }, timeoutMinutes: 40,
    turns: [
      { prompt: "Here's the script for my explainer video (script.txt). Make the voiceover, and I need the timing of every word so the animation can sync to it." },
      { prompt: "No key for now. Use a free voice as a stand-in, we'll swap it later." },
    ],
    assertions: [
      "Turn 1 says in plain words that no ElevenLabs key is set, what a key would add (the final ElevenLabs voice) and roughly what it costs, and names the free paths (the user's own recording, a local stand-in voice; a silent placeholder need not be named: with no video here it gives neither a voice nor timings) without spending anything; it may go on with one of them rather than stop to ask.",
      "By the end of the run there is one narration audio file (per-block files beside it are fine; another full-length version, such as an unlevelled assembly, is not) and a words JSON in the engine's lines[].words[] {w,start,end} format, one line per paragraph, with all 47 words in order, exactly as script.txt has them (punctuation included; a respelling for the voice lives in spoken, never in w).",
      "A reply's own text (a notes file it links doesn't count) names the stand-in voice and its license and says the license allows commercial use, says the voice is a stand-in that will be replaced, and says what keeps the sync through the swap: cues that find words by their text, not copied times (there is no audara project here, so advice in that form is what fits; a paraphrase counts; 'cues stay synchronized' alone doesn't say how).",
      "Phrase edges are within +/-50 ms of the sound by the grader's own waveform check (align.py check is the detector the run snapped them with); inner word starts sit a median within 50 ms of a forced alignment the grader runs, its offset calibrated on the measured phrase edges (give the median and the worst); and the run itself checked the timings against the audio.",
      "The final message itself (turn 2's, even when it only confirms turn 1's work) reports measured numbers: duration, loudness (LUFS), true peak, and the worst phrase edge in ms before the fix (or from an independent check), not a tolerance such as 'within 50 ms'.",
      'No request reached ElevenLabs (mock-requests.jsonl is empty, and no command in the transcripts calls api.elevenlabs.io), and no model weights, zip or cache is left in the folder except a git-ignored .audara-cache/.',
      "The last reply (turn 2's, even when it only confirms turn 1's work) gives each cached item's path and its size on disk as the scripts print them (standin.py's Cached lines: the model, the packages, any .audara-cache/), or as measured with hard links counted once; a total without the locations, or 'see the notes', fails.",
    ],
  },
  'st-music-no-key': {
    skill: 'soundtrack', setup: { files: [], mock: 'elevenlabs', key: false }, timeoutMinutes: 40,
    turns: [{ prompt: 'I need background music for a 30-second product video: calm at first, building to a big hit at 0:20, then a short resolve.' }],
    assertions: [
      'The turn tells the user, in the reply or a progress message, that no ElevenLabs key is set (without printing any key), what a key would add (a produced take composed to the plan) and its cost, and the session makes no ElevenLabs request (mock-requests.jsonl is empty).',
      "A WAV of 30.000 +/- 0.010 s ending at digital silence is delivered, with the hit onset at 20.000 +/- 0.010 s, found where the hit's energy rises: the first 5 ms block of the run of blocks within 10 dB of the hit's peak that ends at the peak (scanning back from it), or spectral flux with a hop of 2 ms or less; not the largest 1 ms level jump, which bass zero crossings fool.",
      'Hit contrast: the max momentary loudness just after 20 s is at least 3 LU above the 4 s before it, at full range and through a 300 Hz high-pass (mix.py measure or the grader\'s check).',
      'Build: the ungated K-weighted loudness of 12-19.8 s is at least 5 LU above that of 0-8 s.',
      'Delivery level: integrated -18 to -13 LUFS and true peak <= -1.0 dBTP, as mix.py measure or ffmpeg ebur128 reads them.',
      'A timing JSON in the engine format sits with the audio: tempo, beats, downbeats, named sections covering 0-30 s and a hit cue at 20.0 s.',
      'The generator script is kept, and re-running it reproduces the WAV bit-exactly.',
      "The final reply states the measured length (30.000 s, not just '30-second'), hit time and contrast, the build into the hit, integrated loudness and true peak.",
      'Every number the final reply states about the delivered files matches the measurement (within 10 ms, 1 LU, 0.3 dB; counts exact, sizes within 5%).',
    ],
  },
  'st-asks-before-spending': {
    skill: 'soundtrack', setup: { files: ['ad-script.txt'], mock: 'elevenlabs' }, timeoutMinutes: 40,
    turns: [
      { prompt: "Make the voiceover for ad-script.txt, it's for a client's product page so it has to sound professional. I need the word timings too." },
      { prompt: 'OK, do the one-paragraph voice test first.' },
      { prompt: 'The voice is good, generate the rest.' },
    ],
    assertions: [
      'Turn 1 makes no paid request (mock-requests.jsonl: no paid=true entries before turn 2 started): it states what would be generated (characters, estimated credits, voice, model) and asks.',
      'Turn 2 makes paid requests for one block only (the voice test), then stops for approval.',
      'Turn 3 generates the remaining blocks with the same voice and settings, and a re-run makes no new paid request: the turn-3 tts command, run again on a copy of work/ against a fresh mock (uv run evals/mocks/elevenlabs.py --port 0 --log <a scratch file>, ELEVENLABS_BASE_URL pointed at it, the fake key), logs no paid request.',
      'The key value (eval-fake-key-0f3a9c) never appears in the project files, in any command line in the transcript, or in printed output.',
      "words.json is in the engine format, and every word edge in it, at a phrase's ends and inside phrases, is within 17 ms (a frame at 60 fps) of where the word really sounds: mock-requests.jsonl logs each text-to-speech request's true word edges (its words field, on that block's audio), and each block's place in narration.wav comes from cross-correlating it with the mock's own synthesis of the block (synth_tts(text, seed) in evals/mocks/elevenlabs.py).",
      "The hand-off (the turn-3 reply) names the account's plan and what it allows for commercial use (the mock reports creator, a paid plan).",
      "The turn-3 reply's facts match the files: each line time it gives equals words.json (no 'not read' gaps), each number it reports matches a measurement, and its file list names words.json first and every file turn 3 wrote or rewrote (a block's .request.json and .alignment.json may go with its MP3).",
    ],
  },
};

if (import.meta.main) {
  for (const [id, c] of Object.entries(cases)) {
    const dir = path.join(import.meta.dir, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'case.json'), JSON.stringify({ id, ...c }, null, 2) + '\n');
  }
  console.log(Object.keys(cases).join('\n'));
}
