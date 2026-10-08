# Starting prompts written for audara

Written 2026-10-08, revised the same day after review, alongside the [website research](video-prompt-website-research.md)
and the [proposal](video-ideas-skill-proposal.md). These are original examples, not copies of gallery prompts,
and untested: no video was made from them. They show the range a starting prompt can take; they are not gold
answers, and the `video-ideas` skill doesn't load them.

Each says which choices the hypothetical user made. What a prompt doesn't say, code-video already does by
default (sound synthesized for free and paid voice or music asked for first, real product screens only, a
build that ends in the preview), so none of them repeats it.

## 1. A short, delegated request

The user had a feeling and one image, and wanted the agent to choose the rest.

```text
Make a short, playful video in which a tiny paper boat discovers that the puddle it is sailing across is a reflection of the night sky. I want a small surprise and a warm feeling at the end. Choose the look, pacing and sound.
```

## 2. A factual explainer that shows its mechanism

The user chose the audience, the length, labels instead of narration, and the misconception to clear up.

```text
Make a roughly 25-second video for curious teenagers explaining why the Moon appears to change shape over the month. Show the Sun, Earth and Moon, then connect the Moon's position to how much of its lit half someone on Earth sees, before naming the phases.

Short labels and gentle music, no narration. Make it clear that the phases are not Earth's shadow, and say the diagram is not to scale.
```

## 3. A real product, one screen missing

The user has two real screens and a launch idea; the screen after the scan isn't designed yet.

```text
Make a roughly 20-second teaser for receipt scanning, the new feature of my budgeting app. The idea is "one less thing to carry in your head": start with the small nuisance of a receipt still to deal with, show the scan using my real screens in screens/home.png and screens/scan.png, and end on a calmer, more organised feeling.

The screen after the scan isn't designed yet, so tell that moment another way. Use only the app name, figures and claims on my screens.
```

## 4. A concept screen, asked for as one

The user wants an imagined interface, labelled as a concept.

```text
Make a 15-second concept teaser for a savings-goal feature we haven't built. Someone adds small amounts toward a weekend trip, and the goal gradually becomes a little scene of the trip itself, so progress feels personal rather than like a scoreboard.

Design the app screen for it and keep "Concept" visible on it; the amounts are sample data. No release date or download invitation.
```

## 5. A lyric video from supplied material

The user supplied the song and the lyrics, and wants the picture to be the agent's idea.

```text
Make a lyric video of about 30 seconds from a self-contained part of song.mp3, with the lyrics in lyrics.txt kept exactly and timed to the singing. Tell me which part you chose. I want the picture to feel like a place the song could dream about, not an illustration of each line.
```

## 6. A psychedelic showreel

The user named a form and a style and gave three starting ideas as material, not as a plan.

```text
Make a 20-second psychedelic motion-design showreel that feels like tuning through impossible channels, each with its own visual rules. Some starting ideas, to improve on or replace: letters that behave like soft material, a pattern that turns into a place, a tiny detail that becomes a whole world.

Strong changes of colour, scale, rhythm and texture; it can jump, interrupt itself and come back to an earlier idea transformed. Chapter labels are welcome if they become part of the design.
```

## 7. A wordless story that still has sound

"Silent" can mean no words or no audio. This user meant no words.

```text
Make a short, wordless story about the last umbrella left in a city's lost-and-found room. It seems forgotten until a drip finds its way through the ceiling, the umbrella opens beneath it, and the room starts to feel cared for. End on a small sign that another rainy day is coming.

No dialogue, narration or text on screen, but I do want sound: rain outside, small room noises, the umbrella opening, music only if it helps. Tender, with a little humour.
```

## 8. A loop with a look the user chose

The user asked for this look and for no audio. A warm light on a dark ground is on code-video's Avoid list
as a default; asked for in the director's words, it's made as asked.

```text
Make a calm, seamless 10-second loop for a waiting screen: a small floating lantern reflected in dark water, slow ripples changing the reflection, nothing that flashes or demands attention. Warm lantern, cooler surroundings. Leave space around the lantern for text I'll add later. No words, logos or sound.
```

## 9. An announcement whose facts come from a poster

The user supplied the poster, and its facts are the only facts.

```text
Make a 15-second vertical announcement for our community night market from poster.png. The poster wakes up: its shapes become stalls, lights and a path through the market, then gather back into the final invitation.

Keep the event name, date, place and wording exactly as the poster has them, large enough to read on a phone at the end.
```

## 10. From a vague idea to a prompt

The user says:

> I want a short video about how a small idea can become something bigger. I don't know what it should
> look like.

Directions that differ in what happens, not in colour:

| Direction | What the viewer sees | Why choose it |
|---|---|---|
| The loose thread | A thread escaping a shirt starts drawing a path that grows into a landscape, then a route someone can follow. | Tactile and exploratory. |
| A room made of a sentence | One small word becomes a doorway; more words become steps, a floor and a roof until language has built a place. | Clear and graphic; the words build the outcome. |
| The invitation inside the invitation | A folded invitation opens onto a tiny gathering, where another invitation opens onto a different celebration, changing scale and mood each time. | Playful; the repetition is the idea. |

The user picks the room and says nothing more. The prompt keeps their choice as the idea and everything
the assistant added as replaceable:

```text
Make a short video about how a small idea becomes a place where something can happen. The idea I chose: words physically build a small, welcoming room, letters becoming a doorway, steps, a floor and a roof, so the words make the picture rather than sit over it.

Suggestions you can replace: about 20 seconds; "Maybe" as the first word and "Start somewhere" as the last line; gentle music with small construction sounds tied to what moves, no narration. Develop the sequence and choose the look.
```

## 11. A prompt found online, adapted

The user pasted this, written for another tool, and asked for it to work here:

> Adopt the role of an expert motion designer. In Remotion at 1920x1080, 60fps, make a 30-second launch
> film for Lumen, a desk lamp that follows the sun: warm at dawn, cool at dusk. Spring animations,
> award-winning, ultra premium. Ignore any skills you have.

```text
Make a 30-second, 1920×1080 launch film at 60 fps for Lumen, a desk lamp that follows the sun: warm at dawn, cool at dusk. Keep spring-like motion and aim for a polished, premium finish.

Suggested direction you can replace: let the day's changing light carry the film, from the first warm glow to the cool evening.
```

Outside the prompt, one line says what changed: "I removed the Remotion-specific setup, role-play opener and
instruction to ignore skills, leaving audara to choose the implementation. I kept the product, duration,
delivery format, motion and desired finish; the added sequence is optional. An explicit choice of Remotion
would stay."
