# Proposal: a place to explore video ideas before production

Written 2026-10-08 on audara-studio 0.4.1 (commit `a1b2645`), from a Codex session's research and a Claude
Code session's review of it, which argued it out until they agreed. **Status:** built the same day as the
`video-ideas` skill (0.5.0), at the user's request, before the baseline below was run. This file is the plan
as agreed; what the skill does now is in [design.md](../design.md) and the decision in
[history.md](../history.md). Evidence: [the website research](video-prompt-website-research.md); prompts
written from it: [examples](video-prompt-examples.md).

## Recommendation

An optional, text-only `video-ideas` skill: someone asks for ideas, sees a few different directions, chooses
or refines one, and leaves with a starting prompt. "Make it" continues with code-video in the same session;
the prompt also works pasted into another session. It never becomes a required first step: a sentence is
already enough to start a video, and a request to make one still goes straight to code-video. It earns its
place through a clear stopping point and a faithful handoff, not by teaching a prompt formula or by making
requests longer.

The case for it is a chance to compare ideas before production, not a fix for weak prompts: the recorded
failures don't point to the prompt (short prompts gave some of the plugin's best blind scores, and the
showreel losses came from taste defaults). code-video's lead develops an open premise alone, in the
treatment; the user can redirect from the treatment and the preview (in 0.4.1 the links came at minutes 1
and 19, and the first turns finished after 91 and 93 minutes). Whether exploring first saves time or makes
better videos is unmeasured.

## What audara already does, and what history warns

- **A sentence is enough.** The README promises that what the director leaves open the agent decides;
  code-video's session checklist already works the whole piece out, posts a treatment and builds on.
- **"Plan first" already pauses production,** but it plans one video toward its build; it doesn't compare
  ideas or end with a prompt, and only a user who knows to say it gets it.
- **The director's words bind.** A script, shot list or exact timecode is kept as given (treatment template,
  "When the director brings the plan"); a look the director names is made exactly, and style frames run only
  when the look is left open (code-video, "When the look is yours"). A prompt helper that writes its own
  guesses in the user's voice turns them into requirements.
- **No mandatory stop.** Round 4 measured that a stop before building added nothing: every default was
  accepted, and the first frame came 20–27 minutes later (history.md, round 4).
- **No house style from examples.** Examples anchor looks and motifs (design.md, "Room for the model"); the
  showreel runs converged on one circle and lost a reel's chapters to taste defaults (history.md, 0.4.0).
- **No hype as direction.** Motivational phrases were retired from the skills' text as unmeasured; a user's
  own "go all out" stays theirs.

## The conversation

1. Start from what the user has: a subject, a feeling, a song, files, a rough or found prompt, the project's
   recorded decisions. Ask only what would change the idea, each question with a default.
2. Exploring: two or three directions that differ in what the viewer sees, how it changes and how it ends,
   not in adjectives. A clear idea already: refine it directly.
3. Mention needs, costs or quality tradeoffs only when they affect choosing or making an idea. Exploring
   needs no generated asset and no budget; a budget or a cost concern the user gives is used.
4. Return one self-contained prompt and stop, unless the request already asked for the video.

## The starting prompt

Agreed wording, from the review:

- Preserve fixed user requirements; distinguish the concept selected by the user or chosen under their
  delegation; mark remaining assistant proposals as replaceable. Earlier user words and applicable project
  decisions outrank an incomplete summary.
- Keep unspecified aspects of the look open. Preserve the visual constraints the user established, without
  treating one brand colour, typeface or reference as a complete look. If a suggested look is useful, identify
  it as optional rather than as the user's requirement.
- When adapting a found prompt, translate incidental implementation instructions to audara and briefly
  explain material changes. Preserve explicit user requirements. Make routine technical choices without a
  questionnaire; clarify only unresolved ambiguity that would materially change what the user gets or pays
  for.
- When the user already requested production, refine and proceed without another gate. Keep
  assistant-proposed direction concise and provisional, and show it before continuing so the user can
  redirect. Start at premise level by default; add staging or look suggestions when they help the requested
  refinement.

Also: the prompt stands alone ("option 2" and "as above" mean nothing in a new session); files are named by
path and missing ones named as missing; no invented feature, figure, asset or spending; no engine names,
frame rates, hex codes or beat times unless the user gave them. A loop may need two sentences, a product
film a few paragraphs. The stop instruction stays outside the copyable prompt: the prompt begins "Make…" and
works as a build request when someone sends it on purpose.

## Where it stops

| The user says | Next | What it authorizes |
|---|---|---|
| "Give me ideas for a video about this." | Directions | Ideas and a prompt |
| "I like the second one." / "Mix the first with the third's sound." | That direction's prompt, revised | Selection, not production (unless the video was already asked for) |
| "Great prompt." | Nothing more | Nothing |
| "Make it here." | code-video, from the prompt | Production, ending in the preview |
| "Give me three ideas, pick the strongest and make it." / "Improve this prompt and make the video." | The chosen direction shown, then code-video | Production, with no second approval |
| "A prompt I can paste into another session." | The prompt, with its files named | The prompt only |
| "Make a 20-second video…" / "dont ask just make" | code-video directly | As today |

## Routing

The new skill's description names ideas, prompt ideas and writing, improving or adapting a video prompt, and
says it stops at the prompt; code-video's description says a request for ideas or a prompt alone is not its
job. Two boundaries need care: code-video loads in any project that has `videos/*/video.json`, and the
AGENTS.md section `init.ts` writes into projects tells a later session to show a treatment and build on. Both
have to leave an explicit ideas-only request alone.

Near-misses: a prompt for an AI video, image or chat model; ideas for a camera vlog or a podcast; general
advice about prompts; any request to make, change, preview or render a video.

## Alternatives considered

- **Document "plan first" instead.** The lightest route, and the baseline to beat: a README line such as
  "help me explore three directions, plan only, don't start the project". It needs the user to know the
  phrase, which is the expertise the skill should spare them.
- **An exploration mode inside code-video.** Fewer skills, but code-video's broad trigger and build checklist
  would pull an ideas request into production, and its SKILL.md has 31 bytes to spare.
- **An interview inside production** (as the product-film skill on Prompt Motion does): brings back the stop
  before building that round 4 removed.
- **Always rewrite and build at once:** breaks the stopping point an ideas request asks for, and turns
  unchosen suggestions into commitments.
- **Always hand off to a new session:** portable, but adds work and loses context; supported, never required.

## Evaluation plan

A text-only baseline in both tools, on the same requests and scripted replies: the model brainstorming with
no skill, code-video given an explicit plan-only request, and the new skill. Requests both casual ("any
ideas for a video?") and explicit, since what matters is whether someone asking casually gets the intended
experience.

| Case | Success |
|---|---|
| A vague idea, no files | Distinct directions and a usable prompt; no questionnaire |
| A detailed brief | Exact constraints survive; answered questions aren't asked again |
| Ideas only, empty folder and existing project | No init, scene, preview, generation or render |
| Select, combine, reject | Choices survive; selection alone builds nothing |
| "Make it here" | The prompt reaches code-video; fixed words and decisions reach the treatment |
| Ideas and the video asked together | No redundant approval |
| A found prompt with another stack | Incidental tooling translated, changes stated, the user's requirements kept |
| Missing screen, locked script, unsupported claim | Nothing invented, nothing reworded |
| Prompt pasted into a fresh session | Works without the conversation; files and decisions explicit |
| "Make a video" and near-misses | Unchanged routing |
| Real-prompt edge cases | "dont ask just make"; "ignore your skills"; "silent"; "today"; "the attached song"; a piece over a minute |

Judge fidelity, how distinct the ideas are, usability and the user's effort, and whether suggestions help
the user choose while leaving creative room; not length, adjectives or adherence to a template. Unrequested
production and lost constraints fail even when the prompt reads well. If the skill can't beat the plan-first
route without more friction or routing mistakes, keep the documented route instead. Only if it can, a paired
production comparison would ask whether the chosen starts make better videos.

The harness needs two changes for a skill without scripts: it listed the two skills by name, and it counted a
Codex near-miss as failed only when one of the skill's scripts ran, which a text-only skill never does.
