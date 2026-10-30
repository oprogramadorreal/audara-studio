# Nutlight: the look

How to make the look in code, and what tends to go wrong. The images and the author's own description are in
`assets/references/` (in a project, `docs/style/nutlight/`); the code that draws it is the kit, `assets/kit/` (in
a project, `src/nutlight/`, with its README). This file adds the craft that drawing it in the engine taught, over
seven revisions of a 14.5-minute explainer.

Contents: Construction · Light and value · Palette by setting · Depth and composition · The cast · Things and
technology · Words in the world · STYLE.md for a Nutlight project · Checks

## Construction

- One vocabulary for everything: circles, ellipses, rounded rectangles, arcs, wedges, flowing curves.
  Characters, machines, trees and buildings are made of the same shapes, so they belong to one world.
- No outlines. A contour is a change of colour, crisp and smooth. Dark lines are accents only (a lid, a
  seam), never round a whole silhouette.
- Volume: a soft gradient inside each mass, a broad shadow plane, a narrow highlight, a contact shadow
  where it meets the ground, reflected colour from what is near. The clean shape stays readable under the
  shading.
- Glass and holograms: translucent, with luminous edges, simple bars, charts, nodes and symbols. Never
  legible prose.
- Detail goes to what matters: faces, interfaces and mechanisms carry small marks, while large regions stay
  quiet. Paint dense detail once (baked into a texture) and keep a few things live: a slot that flickers,
  a fan that turns, a packet that travels.

## Light and value

- Form first, light second. A box reads as a box when its top, front and side are three different values
  before any glow. A lit edge is a thin line only where the light falls, never a halo round a silhouette.
- A value ladder, darkest to brightest: near-black (foreground silhouettes, gaps, crevices); dark (shadow
  faces); mid (front faces in the light); light (top faces turned to the key); lights (lamps, screens, the
  action's peak). To check how dark, measure the share of near-black pixels on the reference that guides the
  setting and on a rendered still the same way, and keep them close. A dark frame without its near-blacks
  looks washed out, and one that is all near-black looks murky.
- The brightest light in the frame belongs to the action: the thing being explained, touched or changed.
  Secondary lights (conduits, distant windows, idle screens) stay a step under it. Matte things stay matte
  and under the bloom threshold, while screens, lamps and signals glow.
- Light has a source: a pool under a lamp falls off to dark corners, and a screen lights the face in front
  of it. An interior is never an even fill.
- Unlit is a colour (a dark teal for an LED that is off), never the lit colour times zero, which draws
  black. Shadows mix toward the setting's deep colour, never toward black.
- One light rig per setting: the kit's `rig('dusk')` gives its key, rim, haze and post, and every named colour
  under that light. Scenes ask for colours by role (`R.c.wallLit`) and never type a hex, so relighting a setting
  or a whole stretch is one change (`mixRig` between two). Notes asked for relit stretches more than once.

## Palette by setting

The kit's rigs cover the references' settings (night interiors and cities, a computing hall, morning, dusk, a
dark sunset, golden hour, a golden hall, a vaulted archive). A new setting gets a palette in the kit's
`palette.ts`, spread from the nearest and sampled from the reference that guides it, measured rather than
remembered, and adjusted on rendered stills (the tone shoulder softens saturated fields:
references/style-template.md in code-video). The families: computing interiors in ink-navy, indigo, charcoal and teal with cyan light and amber activity;
warm domestic interiors in honey and wood under lamps; golden laboratories in champagne, amber, graphite and
ivory; dusk in honey, orange, peach, pink and violet; blue cities in cyan, periwinkle, cobalt and midnight.
A setting the references don't show gets its own palette in the same spirit: warm characters against a
cooler or darker world, and saturated light only where it means something. Colour can carry meaning across
a video (one warm red for "something's wrong", a pale gold for a pattern): say so in STYLE.md and keep each
colour to its meaning.

## Depth and composition

- Three planes in every frame: a dark foreground that frames (foliage, a console, a chair back, a railing),
  the action in the middle at full contrast, and far layers smaller, paler and hazier. A subject on an empty
  ground isn't this style.
- Far layers are made of the same shapes as the near ones (the same towers, trees and arches), not flat
  rectangles. Leave gaps between near forms so the distance shows through.
- Furniture, machines and buildings are seen at three-quarter, showing a front face and a receding side or
  top. Thickness shows as an edge a value darker than the top. Group things at different depths, overlapping,
  rather than in one frontal row.
- A widescreen hierarchy: busy clusters of detail balanced by broad skies and quiet surfaces. The eye goes to
  the lit action first.
- Parallax comes from depth: a camera move parts the layers. Layering has to make spatial sense, with
  nothing standing in front of what it is behind.

## The cast

Every character is the kit's squirrel (`src/nutlight/squirrel.ts`); each video casts its own names, fur, roles
and gear. Distinct furs (`FUR`: amber, coral, tan, chestnut, grey, golden, or a new one) and gear (a cap,
glasses, a suit) tell characters apart. Background characters can be silhouettes under the local light with a
warm rim (`silhouette`). A squirrel drawn anew, even from these references, came out a different animal in the
first run without the kit, and would differ again in the next video.

Before scene authors start, render the cast sheet (`assets/cast-sheet.ts`, with this video's cast) at the
references' size and at a wide shot's. The kit already draws the qualities below. They are the checks for
anything added to it (a fur, gear, a pose, a view) and for every critic round. Judge first as a solid
silhouette beside 01 and 02, then with light and detail. What went wrong without each:

- **Proportions,** as 01 and 02 show them: a big round head about as wide as the body, sitting low into the
  shoulders; a compact pear body with a long cream belly and broad hind paws; a tail plume about as tall as the
  whole figure and wider than the torso, rising behind one side.
- **One head, turned.** Front, three-quarter and profile are one head seen from different angles, every
  feature at its place on the skull. A profile's mask pasted on a turned skull read as a raccoon. A head
  turn passes through an in-between view rather than snapping.
- **The tail** is one thick rounded form in nested bands, its root tucked behind the haunch. A disc on a stalk
  read as a lollipop, and a dark point at the curl's centre read as a hole or an eye. It keeps its curl in
  motion: emotion goes into its angle, lag and droop.
- **Arms** are one continuous tapering limb through a rounded elbow. Two tubes meeting with a step at the
  elbow was the director's note. A raised or reaching arm may stretch and thicken cartoon-style, but only the
  arm that acts: a stretched resting arm read as a third leg.
- **Contact lands:** a paw rests on the keys, touches the node or holds the prop. Compute the reach from the
  target and place the character so it arrives. A reach that falls short, a paw pointing past its subject, or
  a prop that moves by itself breaks the cause and effect. A point reads best as one bent curve aimed at its
  subject; a straight rod, or an arm across the muzzle, read badly.
- **Seated at work:** choose a view where body, arm and screen read together (from behind at three-quarter
  worked), with furniture that never hides the action: a low chair back, no armrest across the working arm.
- **Expressions:** the eyes, lids, brows and mouth act. Most moments need about half an expression, held and
  changing on a beat of the story. Varied and fitting the moment, never stuck on one smile: a sad crowd
  looks sad. In profile a worried lid arches; a straight slanted one reads as a glare.

## Things and technology

Make the idea a place or a thing a character can use: a network as a city of racks and conduits, a process
as a machine with visible stages, a dataset as drawers that light up. Technology is tangible, with bays,
fans, ports and status lights. Interfaces show bars, symbols, charts and short coloured runs of code, never
prose. Brains, robots, circuit boards and code rain stay off the screen unless the subject needs them or the
director asks: the style's own images explain technology without them.

## Words in the world

Few words, and they live in the world: a sign, a screen, a label on the machine, a painting on an easel, a
billboard. Leave out labels that announce a category ("example", "analogy", "thought experiment"): the
staging should make that clear. A value the story depends on is shown large, on the thing it belongs to.
When a source carries its own digits or type (a document, a plan, a screenshot), keep them as they are rather
than setting them again, and mark them where the voice names them if that helps (a circle in the world's pen
worked). Where nothing in the
world can hold a line (a short disclaimer), a small overlay on a solid band is fine. Sizes and safe areas
follow code-video's style template.

## STYLE.md for a Nutlight project

Write it with code-video's `references/style-template.md`, filled from this style:

- The first lines name the style and what defines it: "Style: Nutlight (squirrel characters in luminous
  geometric worlds), references in `docs/style/nutlight/`". The critic treats what defines a named style as
  the director's.
- A line "From: Nutlight style, <date>" for the defaults taken from here, kept apart from Decisions, which hold
  only the director's words.
- The palette as rigs per setting, sampled from the references; glow keys by role; the value ladder.
- The cast table for this video: name, fur, role, gear, all drawn by `src/nutlight/`.
- The references mapped to this video's kinds of scene ("the archive: 03's depth and 06's light"), so each
  scene brief can name the image to hold its stills against.
- Avoid: the template's list, with the style's own exceptions: navy, teal and amber worlds, glowing screens,
  translucent panels with luminous edges and starry skies are what define the style here. The rest of the list
  stands: slides, captions that repeat the voice, filler light, one composition for every scene, and stock
  AI imagery (brains, robots, circuit boards, code rain) unless the subject needs it or the director asks. Add
  hard cuts, a subject on an empty ground, a reference image used as a backdrop or panned across, static
  characters, black shadows and everything glowing.

## Checks

On stills beside the reference that guides each scene, before scenes go out and again in critic rounds:
- each character's silhouette against 01 and 02; the same character on model in every view and scene;
- dark frames keep their reference's near-black share; the peak light is on the action;
- three planes, three-quarter forms, gaps and overlaps; no flat ground under a subject;
- every light sits on its source; nothing appears or vanishes during a camera move; layers overlap the way
  the space says they should;
- words are in the world, or a small overlay where nothing in it can hold them; large enough; none announces
  a category.
