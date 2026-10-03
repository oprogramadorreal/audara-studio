// The task eval cases, written out to evals/tasks/<id>/case.json (bun evals/tasks/cases.ts).
// Each case comes from a failure the no-skill baselines showed (or a strength they must keep), and
// from the handoff's definition of done. Assertions are checked by a grader with evidence; numbers
// refer to measurements the grader makes. $EVAL_SONG: a song with ground-truth timing data in
// $EVAL_SONG_DATA (audio.json); $EVAL_PROJECT: a project made with audara (e.g. a cv-title-card run).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type Case = { skill: string; setup: Record<string, unknown>; timeoutMinutes: number; turns: { prompt: string }[]; assertions: string[] };

const cases: Record<string, Case> = {
  'cv-title-card': {
    skill: 'code-video', setup: { files: [] }, timeoutMinutes: 60,
    turns: [
      { prompt: 'Make a 15-second animated title card for my podcast, Night Signals. Minimal and elegant.' },
      { prompt: 'Looks good. 16:9 for YouTube, no tagline, just the name. Go ahead.' },
      { prompt: 'Render it.' },
    ],
    assertions: [
      'After turn 1 there is no scene file for this video and no rendered MP4 (init and the template example may exist): nothing is built before approval.',
      'The turn-1 reply is a brief for approval, of about 15 lines or fewer, with a time-coded beat list covering 0-15 s (times that read as written: 1.25 s or 0:01.25, never 1:25) and the look (palette and type). Any on-screen text beyond "Night Signals", or any restyling of the name, is listed as an assumption.',
      'Turn 1 asks at most 3 questions, each with a default, and one of them is about format or where the card will be shown.',
      'After turn 2 the folder is an audara project (src/engine/, videos/<name>/video.json, AGENTS.md, CLAUDE.md) and the reply gives a preview URL with ?v=<name> and at least one link with &t=.',
      'After turn 3, ffprobe on out/<name>/<name>.mp4 reports 15.00 +/- 0.04 s, 1920x1080, no audio stream, and color_primaries, color_transfer and color_space all bt709; any other size made beside it (a 4K master, say) has the same length, color tags and no audio, at 16:9.',
      'The video shows the words Night Signals (any case) and no other words, unless the brief listed them as an assumption.',
      'The final reply itself (turn 3, even when an earlier turn named them) links a contact sheet PNG, a poster PNG and QC numbers (frozen time or longest hold, near-black or near-empty frames), and every linked file exists.',
      "src/look.ts no longer holds the template's test-card palette, and the look is none of the archetypes on the style template's Avoid list (the navy/ivory/amber one both baseline models converged on among them) unless the brief names it and says why.",
      'render.ts verify passes for the video (run it); the project root has no stray caches, npm folders or check images outside out/ and git-ignored paths, out/ holds only renders, stills, sheets and reports, and any cache is in the git-ignored .audara-cache/.',
    ],
  },
  'cv-song-brief': {
    skill: 'code-video', setup: { files: ['$EVAL_SONG => song.mp3'] }, timeoutMinutes: 40,
    turns: [{ prompt: 'make a 30-second video for song.mp3, dark and engraved' }],
    assertions: [
      'A treatment (videos/<name>/TREATMENT.md or the reply) exists, and no scene module or MP4 for this video was written before it (transcript order or file times). The turn ends awaiting approval, or says why it went ahead.',
      "The treatment as shown for approval (in the reply, or the file before the first scene module) is sized to a 30-s piece (the template's spot size, about fifteen lines, not the full skeleton): it states the song window as start and end times, the aspect ratio, and a storyboard with time ranges, what is seen and the transition out.",
      "The window starts within 33 ms of a ground-truth downbeat ($EVAL_SONG_DATA/audio.json), ends on a downbeat, with a fade that lands on one or with the song's own end, lasts 29-31 s, and the reply says why this part of the song.",
      "Storyboard rows change where the song sections change inside the window (within one beat of each ground-truth section boundary; a boundary within a bar of the window's ends is not counted).",
      'The turn asks at most 3 questions, only about what the prompt leaves open, each with a default; it does not ask for a length or a style (stating the bar-rounded length, with a default, is expected).',
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
      'After turn 1: a brief with timed beats covering 0-20 s, the 1080x1920 format, and sound stated as a question or an explicit assumption; nothing built yet.',
      "By the end of turn 2 the director has been given this project's preview link written out in full, with ?v=<name>, and at least one full &t= link at a named beat (the address served this work folder during the run: result.json previews).",
      'The MP4 is 1080x1920, 20.0 +/- 0.1 s, with no audio stream (the user said no sound).',
      'Values shown on screen are computed in code from the keys (hashes, buckets), not hand-typed lists.',
      "Text meant to be read is set at 44 px or more (1080 wide) and stays inside the Shorts safe area (about 250 px top, 400 px bottom, 200 px right, 60 px left: the style template's Layout table), measured on full-size frames.",
      'qc.py reports no near-empty or near-black frame at a cut or at t=0 (or the reply explains a deliberate one), and the longest hold is under about 1.5 s or the reply explains it.',
      'The final reply links a contact sheet, a poster and QC numbers, and the files exist.',
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
      'Before replying, the session itself ran `bun run check` and `render.ts verify`, and the scene keeps its timing source (beat grid or timing data), with no typed seconds.',
      'Only files under videos/<video>/ change; src/, scripts/ and other videos are unchanged (git diff); docs/STYLE.md may change only to correct what the change made wrong.',
      "The reply links this project's running preview, <address>/?v=<video>&t=<s>, where <address>/__audara returned this work folder during the run (result.json previews, or the transcript shows the agent checked it), with t inside the changed span or up to about 0.5 s before it.",
      'The change answers the note: on stills, the title takes longer from its first visible change to fully in, or the reply names the reading it took and offers the other.',
      'No full MP4 render is made unless asked.',
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
      'If a critic round ran, it was a fresh subagent given the treatment, the user\'s words and the render, not the builder\'s reasoning, and its verdict appears in the final message.',
      'No cliché from the style template\'s avoid list (starfield, equalizer bars, lens flare, glitch, navy/ivory/amber with a travelling pulse) appears unless the treatment names it with a reason.',
      'For the set: across the runs with the skills, the looks differ from each other at least as much as across the runs without (a blind judge comparing contact sheets and dominant colours), and the skill set is not judged plainer.',
    ],
  },
  'st-beats-json': {
    skill: 'soundtrack', setup: { files: ['$EVAL_SONG => song.mp3'] }, timeoutMinutes: 30,
    turns: [{ prompt: 'I need the beats and downbeats of song.mp3 as JSON so my animation can cut on the beat.' }],
    assertions: [
      'A JSON file in the engine format is written (duration, bpm, beats, downbeats, sections; features and onsets), at data/audio.json or where the user can find it, and the reply names it.',
      'Beats: at least 344 of 345 ground-truth beats ($EVAL_SONG_DATA/audio.json) matched within +/-50 ms and at least 98% within +/-17 ms; coverage runs to within one beat of the end of the file.',
      'bpm is within +/-0.1 of 132.007 and agrees with the beats array.',
      'Downbeats: at least 86 of 87 within +/-50 ms, all on the right bar phase.',
      'The reply states the time origin once, with no advice to shift every time by an encoder delay (offering a WAV for a player that keeps the delay is not such advice).',
      'A verification artifact (a beat sheet PNG and/or a click preview) exists and is named, with measured numbers: tempo, fit residual or phase deviation, first and last beat.',
      'Every number in the final message matches the delivered file.',
      "git status lists only deliverables, and no caches, venvs, model weights or decoded intermediates are left in the folder, except one git-ignored .audara-cache/ (the skill's place for uv's cache when a sandbox blocks the user's) whose location and size the last reply states.",
    ],
  },
  'st-voiceover-no-key': {
    skill: 'soundtrack', setup: { files: ['script.txt'] }, timeoutMinutes: 40,
    turns: [
      { prompt: "Here's the script for my explainer video (script.txt). Make the voiceover, and I need the timing of every word so the animation can sync to it." },
      { prompt: "No key for now. Use a free voice as a stand-in, we'll swap it later." },
    ],
    assertions: [
      'Turn 1 says in plain words that no ElevenLabs key is set, what a key would add and roughly what it costs, and names the free paths (the user\'s recording, a local stand-in voice, a silent placeholder) without spending anything; it may go on with one of them rather than stop to ask.',
      "By the end of the run there is one narration audio file (per-block files beside it are fine) and a words JSON in the engine's lines[].words[] {w,start,end} format, one line per paragraph, with all 47 words in order.",
      'The stand-in voice is named with its license (commercial use allowed), and the hand-off says it is a stand-in that will be replaced, with scenes finding words by their text.',
      "Phrase edges are within +/-50 ms of the sound (align.py check on the result, or the grader's own waveform check), and the run itself checked the timings against the audio.",
      'The final message itself (not only an earlier one) reports measured numbers: duration, loudness (LUFS), true peak, and the largest word-edge error.',
      'No request to api.elevenlabs.io was made, and no model weights, zip or cache is left in the folder, except a git-ignored .audara-cache/ whose location and size the last reply states.',
    ],
  },
  'st-music-no-key': {
    skill: 'soundtrack', setup: { files: [] }, timeoutMinutes: 40,
    turns: [{ prompt: 'I need background music for a 30-second product video: calm at first, building to a big hit at 0:20, then a short resolve.' }],
    assertions: [
      'The turn tells the user, in the reply or a progress message, that no ElevenLabs key is set (without printing any key) and what a key would add, and makes no paid request.',
      "A WAV of 30.000 +/- 0.010 s ending at digital silence is delivered, with the hit onset at 20.000 +/- 0.010 s, found where the hit's energy rises (spectral flux, or the first 5-10 ms block within 10 dB of the hit's peak), not as the largest 1 ms level jump, which bass zero crossings fool.",
      'Hit contrast: the max momentary loudness just after 20 s is at least 3 LU above the 4 s before it, at full range and through a 300 Hz high-pass (mix.py measure or the grader\'s check).',
      'Build: the K-weighted loudness of 12-19.8 s is at least 5 LU above 0-8 s.',
      'Delivery level: integrated -18 to -13 LUFS and true peak <= -1.0 dBTP.',
      'A timing JSON in the engine format sits with the audio: tempo, beats, downbeats, named sections covering 0-30 s and a hit cue at 20.0 s.',
      'The generator script is kept, and re-running it reproduces the WAV bit-exactly.',
      'The final reply states the measured length, hit time and contrast, the build into the hit, integrated loudness and true peak.',
      'Every number the final reply states about the delivered files matches the measurement (within 10 ms, 1 LU, 0.3 dB).',
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
      'Turn 3 generates the remaining blocks with the same voice and settings, and a re-run would make no new paid request (request records exist beside the audio).',
      'The key value (eval-fake-key-0f3a9c) never appears in the project files, in any command line in the transcript, or in printed output.',
      'words.json is in the engine format with phrase edges snapped to the sound.',
      "The hand-off (the turn-3 reply) names the account's plan and what it allows for commercial use (the mock reports creator, a paid plan).",
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
