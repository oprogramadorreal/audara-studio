# Video prompt research: Skillry and Prompt Motion

Researched 2026-10-08 on audara-studio 0.4.1 (commit `a1b2645`), before the `video-ideas` skill existed. This
is a dated snapshot, not a description of the plugin: what the skill does now is in [design.md](../design.md),
the decision and its evidence in [history.md](../history.md) (0.5.0). The [proposal](video-ideas-skill-proposal.md)
says what was planned from it, and [the examples](video-prompt-examples.md) are prompts written for audara
from these lessons.

## Main finding

The galleries publish a wide range of starting points: one evocative scene, explicit creative delegation, a
process with a beginning and an end, a visual rule, a detailed commission. They don't show that a longer
prompt is better. Much of what makes the long prompts look expert is production work (renderers, timing
functions, export settings) that audara's code-video skill already owns. What carries over is the idea, the
relationships between its parts, and the facts and files only the user has. That supports an optional place
to explore ideas and leave with a starting prompt, not a requirement to write better prompts.

## How it was gathered

- **Pages:** 17 Skillry detail pages (11 recent entries labelled as shared only in part, then six with
  published prompt text) and 13 Prompt Motion detail pages (showreels, explainers, product films, typography,
  lyrics, stories), read through Codex's Chrome integration. An earlier attempt in the same session had
  failed to start, so the Claude Code session that reviewed this work read the gallery pages over the web.
- **The source collection** behind the galleries, [yihui-dev/awesome-opus5-5-videos](https://github.com/yihui-dev/awesome-opus5-5-videos/tree/756290289742535eb0ac3817548f152e9759cc70)
  (read at commit `7562902`, 2026-10-08), whose README says an entry may hold the creator's original post where
  no prompt was published, and that some creators shared only part of theirs.
- **Two visual spot checks** of preview frames (the train window, the psychedelic reel): still frames, not
  playback or audio.
- No video was made, nothing was paid for, and no prompt was run in audara. The two galleries overlap, so the
  counts are of pages, not of independent experiments.

[Skillry's gallery](https://skillry.dev/ai-videos/opus-5-5) listed 513 entries when read (317 motion
graphics, 67 explainers, 59 3D scenes, 70 games and interactive pieces), originals beside its own remakes.
[Prompt Motion](https://prompt-motion.com/), curated by @p4nthera_, files entries as prompts or skills,
credits each creator and marks some "one-shot". A label on a gallery page is the gallery's claim, not access
to the creator's session.

**Provenance.** The collection's MIT notice (yihui-dev, 2026) and its creator credits are documented, but
permission from each original creator to redistribute the full prompt texts has not been independently
established. So this note links each source and describes it, quoting only short phrases; it doesn't keep
copies. This is a provenance limit, not a finding of infringement.

## What the published requests show

| Request (source index below) | What it gives | Lesson for a starting prompt |
|---|---|---|
| Train window, @itsolelehmann | Seasons passing outside a train, a cosy carriage, coffee, a film's style named | A fixed viewpoint, a changing world and a feeling direct a piece in one sentence. |
| Poster, @pankajkumar_dev | A poster breaking out of its own frame | One visible action can be the whole concept; no shot list needed. |
| Recursion, @emollick | Recursion explained, each explanation in a radically different style, fast and self-referential | A teaching goal can shape the form; discontinuity can be the point. |
| Cocktail, @Ror_Fly | Empty glass to finished cocktail, each ingredient arriving with its measure, 30 s | A start state, an end state and a rule for when information appears organize an explainer. The quoted text names no recipe, though the gallery's title does. |
| Derivatives, @LinearUncle | A clear, thought-provoking lesson on derivatives with examples (in Chinese), naming Manim and edge-tts | Keep the learning goal and the language; a named tool is that user's choice, not audara advice. |
| Résumé and psychedelic showreels, @RaphaelAubryy, @monokern, @levabashidze | A named form and a length, everything else delegated; one variant adds "dont ask just make" | A form and an experience can be enough. Both prompts are in audara's README. The variant is a request to build at once, which an ideas step must not intercept. |
| Open delegation, @nolkeeg | Total creative freedom, rivalry with another model, and "do not reference any previous memories or skills" | Delegation is useful; an instruction to ignore skills would switch audara off if copied in. |
| Shadow theatre, @x4b47x | 30–60 s, vertical, paper cut-out shadow theatre, gentle code-made audio, a question about home | Theme, medium, format and sound frame a space and leave the story open. |
| Collision music, @KamStudioLabs | A 45-second machine where every note comes from a visible collision | Name the relationship between sound and action, not "good music". |
| Wordless short, @KamStudioLabs | 45 s, no dialogue, sound tells half the story, story invented | "Silent" here means no dialogue, not no audio. The lighthouse in the result is an output, not part of the prompt. |
| Bug film, @KamStudioLabs | 90 s about a bug that doesn't want to be fixed | A character with a contrary wish makes a story. Past a minute, code-video stops to agree the length. |
| Lyric showreel, @samaote | Lyrics synced to the vocals and the beat of an attached track | A copied prompt doesn't carry its attachment. |
| Photo-print launch, @twoclipping | Inputs to ask for, one continuous take of shape changes through a product journey, a beat structure, then pages of renderer, audio and export instructions, ending with a request to review a beat map and stills first | The asset contract and the transformation logic matter early; the rendering recipe is production's. Even this author asked for a review before building. |
| BUILD THE FLOOR, @Gdgtify | An original five-line speech in exact words; each word given an architectural role; a timed storyboard; phrase-based timing with a deliberate stillness; engineering and quality rules | Exact words and a visual rule can be tightly coupled; stillness can serve a piece, so one prompt's ban on holds doesn't transfer. |
| Weekday, @tankazunori0914 (Skillry, quoted in a post) | In Japanese: what day is it today, told in a cool 30-second motion graphic with background music, at full effort | A subject that depends on the date goes stale when the prompt is reused later. |
| Orange dot, @ultimaxbt (Prompt Motion) | One dot carrying a piece through a toggle, type, a spring graph and an end card, looping | Continuity through one object is one option, not a rule for every genre. No source copy with a stated licence was found; read on the gallery page only. |

## Six lessons

1. **Ask what changes on screen.** "A beautiful video" leaves the concept open; seasons through one window, a
   poster escaping its frame or words carrying a load give production something to stage. An ideas step can
   propose such actions; it need not demand the user invent them.
2. **Short and open requests are legitimate.** The train, poster and showreel prompts carry little detail, and
   the wordless short delegates its story. Length should grow only with decisions, dependencies or exact
   requirements worth carrying forward.
3. **Relationships make choices coherent.** Ingredients arrive with their measures; lyrics with the sung
   words; notes with collisions; the meaning of a speech with its architecture. A relationship guides later
   decisions and leaves the look open.
4. **Each form needs its own freedom.** A product journey gains from connected transformations; a showreel
   from chapters, palettes and hard cuts; spoken word from silence and stillness; a waiting-screen loop has no
   climax. No prompt's bans, palette or continuity device should become everyone's.
5. **Assets and facts travel with the prompt.** "The attached song" without the song, or a recipe with no
   measures, is incomplete. Missing material is named as missing; required words stay exact; a factual demo
   differs from a concept.
6. **Implementation stays with production.** The long briefs mix intent with seek functions, spring sums,
   displacement maps and export flags. They may have mattered where they were written; a starting prompt for
   audara keeps the experience and the user's real constraints and leaves the engine to code-video. A tool the
   user names on purpose stays theirs.

## What it doesn't show

Supported: the galleries publish diverse requests, some short and some highly specific; incomplete records
occur; two of audara's README prompts are among them. Inferred: an optional exploration step could help
people say what they want with less uncertainty. Unproven: any gain in finished-video quality, time saved,
first-pass success or reliability across models. The galleries show selected results, not failed takes,
whole sessions, every asset or a controlled comparison. The spot checks show only what two still frames show.

## Source index

Prompt texts are at collection commit `7562902`; `src` links to the file there.

| Creator | Pages | Lesson |
|---|---|---|
| @itsolelehmann | [Prompt Motion](https://prompt-motion.com/itsolelehmann-e47532) · [Skillry](https://skillry.dev/ai-videos/opus-5-5/itsolelehmann-762215) · [src](https://github.com/yihui-dev/awesome-opus5-5-videos/blob/756290289742535eb0ac3817548f152e9759cc70/prompts/itsolelehmann-762215.md) · [post](https://x.com/itsolelehmann/status/2103124033365762215) | a viewpoint, a change, a mood |
| @pankajkumar_dev | [Skillry](https://skillry.dev/ai-videos/opus-5-5/pankajkumar-dev-718609) · [src](https://github.com/yihui-dev/awesome-opus5-5-videos/blob/756290289742535eb0ac3817548f152e9759cc70/prompts/pankajkumar-dev-718609.md) · [post](https://x.com/pankajkumar_dev/status/2103502614134718609) | one action as the concept |
| @emollick | [Prompt Motion](https://prompt-motion.com/emollick-8661a8) · [Skillry](https://skillry.dev/ai-videos/opus-5-5/emollick-019567) · [src](https://github.com/yihui-dev/awesome-opus5-5-videos/blob/756290289742535eb0ac3817548f152e9759cc70/prompts/emollick-019567.md) · [post](https://x.com/emollick/status/2103688362960019567) | form that teaches |
| @Ror_Fly | [Prompt Motion](https://prompt-motion.com/ror-fly-9950f1) · [Skillry](https://skillry.dev/ai-videos/opus-5-5/ror-fly-880547) · [src](https://github.com/yihui-dev/awesome-opus5-5-videos/blob/756290289742535eb0ac3817548f152e9759cc70/prompts/ror-fly-880547.md) · [post](https://x.com/Ror_Fly/status/2102853258582880547) | start, end, and when information appears |
| @LinearUncle | [Prompt Motion](https://prompt-motion.com/linearuncle-5d2bae) · [src](https://github.com/yihui-dev/awesome-opus5-5-videos/blob/756290289742535eb0ac3817548f152e9759cc70/prompts/linearuncle-971663.md) | a learning goal; a named tool is the user's |
| @RaphaelAubryy | [Prompt Motion](https://prompt-motion.com/raphaelaubryy-4b137e) · [src](https://github.com/yihui-dev/awesome-opus5-5-videos/blob/756290289742535eb0ac3817548f152e9759cc70/prompts/raphaelaubryy-190360.md) · [post](https://x.com/RaphaelAubryy/status/2103416909857190360) | a named form (in the README) |
| @monokern | [Prompt Motion](https://prompt-motion.com/monokern-ade5b6) · [src](https://github.com/yihui-dev/awesome-opus5-5-videos/blob/756290289742535eb0ac3817548f152e9759cc70/prompts/monokern-832979.md) · [post](https://x.com/monokern/status/2103563538828832979) | a named style (in the README) |
| @levabashidze | [Skillry](https://skillry.dev/ai-videos/opus-5-5/levabashidze-184909) · [src](https://github.com/yihui-dev/awesome-opus5-5-videos/blob/756290289742535eb0ac3817548f152e9759cc70/prompts/levabashidze-184909.md) · [post](https://x.com/levabashidze/status/2103786742520184909) | "dont ask just make": build at once |
| @nolkeeg | [Skillry](https://skillry.dev/ai-videos/opus-5-5/nolkeeg-635633) · [src](https://github.com/yihui-dev/awesome-opus5-5-videos/blob/756290289742535eb0ac3817548f152e9759cc70/prompts/nolkeeg-635633.md) · [post](https://x.com/nolkeeg/status/2103841917603635633) | delegation; "ignore skills" |
| @x4b47x | [Prompt Motion](https://prompt-motion.com/x4b47x-9cc84f) · [src](https://github.com/yihui-dev/awesome-opus5-5-videos/blob/756290289742535eb0ac3817548f152e9759cc70/prompts/x4b47x-034026.md) | theme, medium, format, sound |
| @KamStudioLabs | [Prompt Motion](https://prompt-motion.com/kamstudiolabs-447565) · [src](https://github.com/yihui-dev/awesome-opus5-5-videos/blob/756290289742535eb0ac3817548f152e9759cc70/prompts/kamstudiolabs-440893.md) | sound with a visible cause |
| @KamStudioLabs | [Prompt Motion](https://prompt-motion.com/kamstudiolabs-0b0824) · [src](https://github.com/yihui-dev/awesome-opus5-5-videos/blob/756290289742535eb0ac3817548f152e9759cc70/prompts/kamstudiolabs-100086.md) | no dialogue is not no audio |
| @KamStudioLabs | [src](https://github.com/yihui-dev/awesome-opus5-5-videos/blob/756290289742535eb0ac3817548f152e9759cc70/prompts/kamstudiolabs-877996.md) | a character's wish; past a minute |
| @samaote | [Prompt Motion](https://prompt-motion.com/samaote-5e2fc2) · [src](https://github.com/yihui-dev/awesome-opus5-5-videos/blob/756290289742535eb0ac3817548f152e9759cc70/prompts/samaote-124569.md) | attachments don't travel |
| @twoclipping | [Prompt Motion](https://prompt-motion.com/twoclipping-221cab) · [src](https://github.com/yihui-dev/awesome-opus5-5-videos/blob/756290289742535eb0ac3817548f152e9759cc70/prompts/twoclipping-496100.md) · [post](https://x.com/twoclipping/status/2103835273813496100) | asset contract; recipe is production's |
| @Gdgtify | [Prompt Motion](https://prompt-motion.com/gdgtify-287ddf) · [src](https://github.com/yihui-dev/awesome-opus5-5-videos/blob/756290289742535eb0ac3817548f152e9759cc70/prompts/gdgtify-929495.md) · [post](https://x.com/Gdgtify/status/2103458245213929495) | exact words and a visual rule |
| @tankazunori0914 | [Skillry](https://skillry.dev/ai-videos/opus-5-5/tankazunori0914-156748) | a dated subject |
| @ultimaxbt | [Prompt Motion](https://prompt-motion.com/ultimaxbt-bbebf5) | continuity as one option |

Entries labelled as partial and read as promotional captions rather than usable prompts: Skillry's
[arumii-movie-622720](https://skillry.dev/ai-videos/opus-5-5/arumii-movie-622720),
[arumii-movie-249613](https://skillry.dev/ai-videos/opus-5-5/arumii-movie-249613),
[justinbuilds-412401](https://skillry.dev/ai-videos/opus-5-5/justinbuilds-412401),
[dheepanratnam-706454](https://skillry.dev/ai-videos/opus-5-5/dheepanratnam-706454),
[soumymaheshwri-825921](https://skillry.dev/ai-videos/opus-5-5/soumymaheshwri-825921),
[joaquimcassano-778239](https://skillry.dev/ai-videos/opus-5-5/joaquimcassano-778239),
[kzmucx-402052](https://skillry.dev/ai-videos/opus-5-5/kzmucx-402052),
[liu8in-891423](https://skillry.dev/ai-videos/opus-5-5/liu8in-891423),
[ideavim-986785](https://skillry.dev/ai-videos/opus-5-5/ideavim-986785) and
[leandroriviello-827135](https://skillry.dev/ai-videos/opus-5-5/leandroriviello-827135); tankazunori0914's,
also labelled partial, quotes a usable request inside its post.
