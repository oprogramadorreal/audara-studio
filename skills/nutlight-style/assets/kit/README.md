# The Nutlight kit

The code that draws the Nutlight style: the squirrels, the light, a layered 2D stage with a camera, props,
structures and the transitions. A project copies this folder into `src/nutlight/`, and every video's scenes
import from it, so the cast and the look stay the same from video to video. Extend it where a video needs
something new, keeping what is here as it is drawn. The style's references are in `docs/style/nutlight/`.

It runs on code-video's engine: scenes are the engine's `Scene`s and everything is a pure function of `t`.

## A scene

```ts
import type * as THREE from 'three';
import { Scene, type Frame } from '../../../src/engine/scene';
import { Stage, rig, Squirrel, CAST, POSE, alive, typing, camKeys, cam, worldUnder, paintPottedPlant, bakeAt } from '../../../src/nutlight';

const R = rig('cabin');                           // the location's light: R.c.* colours, R.fur, R.gear
export default class Desk extends Scene {
  override handlesTransition = true;              // when it composites the previous scene (worldUnder)
  st = new Stage(this.ctx, R);                    // FIRST field: what is baked from here on is this stage's
  pip = new Squirrel({ ...CAST.amber, name: 'Pip', gear: { cap: true } });
  plant = bakeAt(270, 260, 100, 250, (c) => paintPottedPlant(c, R, 1.2));   // painted once, its origin (the pot's foot) at 100, 250
  override dispose() { this.st.dispose(); }
  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const st = this.st, t = f.t, t0 = this.ctx.words.get('drawer').start;   // times from the words
    st.cam = camKeys(t, [[f.start, cam(960, 540, 1)], [t0, cam(960, 540, 1)], [t0 + 1.6, cam(900, 600, 1.4)]]);
    st.begin(out);
    st.sky({ top: R.c.skyTop, bottom: R.c.skyLow });                            // far to near
    st.sprite(this.plant, 1500, 980, { depth: 0.8 });                          // foreground: < 1
    this.pip.draw(st, 960, 900, alive(typing(POSE.sitType, t), t, 1), { scale: 0.6, view: 'back' });
    worldUnder(st, f, { kind: 'iris', x: 1500, y: 300, from: 40 });             // LAST: the previous scene through a mask
    return st.end();                                                          // the rig's post
  }
}
```

## Light and colour (`light.ts`, `palette.ts`)

- `rig(k)`: a location's light. Keys: `cabin` (a warm interior at night), `city` (a night city), `hub`
  (a computing hall), `office`, `space`, `moonbase`, `morning`, `dusk`, `ember` (a city at sunset, kept dark),
  `golden` (golden hour), `afterglow`, `prize` (a golden hall), `atrium` (a vaulted archive). A rig is the Stage's
  Look plus `R.c` (hex), `R.cl` (linear), `R.fur`, `R.gear`. Scenes never type a colour.
- `mixRig(a, b, k)`: between two lights (night falling, morning arriving); bake with a pure rig.
- `GLOW3`: gains by role (matte, screen, code, slot, led, window, lamp, conduit, packet, node, link, core, spark,
  star, moon, sun): matte things stay under the bloom and crisp; the brightest light belongs to the action.
- `furIn(R, fur)`: a fur under a rig's light; `charLight` is how a character takes it (the squirrels do it
  themselves); `tintK`, `lerp3`.
- A new setting: a palette in `palette.ts` spread from the nearest (`{ ...NIGHT, … }`) and an entry in `LIGHTS`,
  sampled from the reference that guides it.

## The squirrels (`squirrel.ts`)

- `CAST`: starting points, one per fur (`amber`, `coral`, `tan`, `chestnut`, `grey`, `golden`). A character is
  `new Squirrel({ ...CAST.coral, name: 'Rue', gear: { glasses: true } })`. Fields: `fur` (`FUR.*`), `slim`,
  `head` (a young one's bigger head), `tuft` (a crown tuft), `gear` (`hat`, `vest`, `glasses`, `backpack`,
  `suit`, `cap`). Add a fur to `FUR` for a new character; keep the design.
- `sq.draw(st, x, y, pose, { scale, face: 1 | -1, view: 'side' | 'back' | 'front', depth, tint, rimColor,
  silhouette, hold, holdRot, holdScale, holdAnchor, light })`: (x, y) is the ground point under the hip, or the seat.
  `view: 'front'` is the whole body toward us (reference 01); a pose's `turn` turns the head (0 to 0.46 profile,
  0.54 to 1.5 three-quarter, as reference 02; 2 full front).
- `POSE`: `stand sit sitType point tap cheer shrug lookUp hold startled`; `walk(phase)`, `walkTo(…)`,
  `hop(p, t, t0)`, `typing(p, t, k)`.
- `alive(p, t, seed)`: breathing, blinks, tail sway, ear twitches. Always: nothing on screen is frozen.
- `withPose(p, {...})`, `mixPose(a, b, k)`, `poseKeys(t, [[t, pose], …], blend)`: a pose change starts and ends at
  rest; `headTurn()` passes the head through its 60° in-between; a paw moves into and out of a reach along the way,
  the arm turning and bending as an arm does. Two targets can flip an arm mid-blend, since a blend has to cut its
  angles somewhere: one inside the body (behind and below the shoulder, in profile or from behind) and one over the
  head on the far side (from the front). Neither is a place a paw goes.
- `express(p, name, k)`, `exprKeys(t, [[t, name], …])`, `EXPR`: `neutral smile delighted surprised worried focused
  skeptical thinking sad determined`. Most moments need 0.4-0.8 of one, held, changing on a beat of the story.
- Cause and effect: `sq.reach(x, y, wx, wy, o, 'N' | 'F', pose)` puts a paw on a target or says by how much it
  misses (too far, or too close to the shoulder); `sq.standFor(wx, wy, groundY, o, pose)` places the character so the paw arrives; `sq.pointAt(…)` aims an
  arm at something out of reach; `sq.joints(…)` gives the head, eye, nose, paws, tail top; `hold` carries a prop.
- Background characters: `silhouette: { color, rim, tailRim, k }`.

## Props and structures (`props.ts`, `structures.ts`)

Painters run once (in a field or `init()`, through `bake` or an `Atlas`); live draws run every frame on the Stage.
- Nature: `paintBushes`, `paintPines`, `paintLeaf`, `paintPottedPlant`, `paintSmallPlant`, `paintCloudBank`,
  `paintWipeTree` (a foreground tree that can carry a wipe), `drawMoonR3`.
- Technology: `codePage` + `drawCode` (illuminated code that types), `paintMonitor`, `paintKeyboard`,
  `paintRouter`, `drawTube` and `drawPacket` (glowing conduits and their data), `pathThrough`.
- Interiors: `paintDeskLamp`, `paintPendant`, `drawLampLight` (bulb, cone, pool), `drawMotes`, `paintMug`,
  `paintChairBack`, `paintHighChair`, `paintLowChair` (a seated worker whose action reads), `paintArmchair`,
  `drawWindowGlow`.
- Structures: `paintCylinder`, `paintBalcony`, `paintArches`, `paintArchWall`, `paintSpire`, `hazeOf`;
  `paintInterior` (a lit cut-open room) and `paintSlabEdge`; machines: `paintCrate`, `paintConveyor` +
  `conveyorDashes`, `paintPress` + `paintPressRam`, `paintMoldShelf`, `paintGear`.
- Live things (`live.ts`): `StarField`, `Counter` (a rolling counter), `drawSun`, `drawMoon`, `flare`, `fadeIn`,
  `corner` (a safe-area corner for a small overlay).
- Helpers: `bakeAt`, `ell`, `lgrad`, `rgrad`, `smooth`, `rr`, `polyPath`, `label`.

## Camera and transitions (`camera.ts`, `motion.ts`)

- `cam(x, y, zoom, rot, back)`, `camKeys`, `camLerp`, `shotMove`, `frameRect`, `zoomThrough`. Give the video's
  places one world and name its framings as cams in a module of your own, so two scenes that meet on the same
  framing agree by construction.
- `worldUnder(st, f, o)`, LAST in `render()`: the previous scene over this one through a mask, by `f.tin`:
  `{ kind: 'iris', x, y, from, to }` · `{ kind: 'rect', rect, to, radius }` · `{ kind: 'wipe', angle }` ·
  `{ kind: 'through', rect }` (a matched zoom-through: draw this scene under `throughAt(tin, rect).mag` with
  `st.withMagnify`) · `{ kind: 'fade' }`; plus `zoom: { x, y, to, tx, ty }` (the old frame pushes into a point that
  travels to where the same thing stands now).
- `camProject(cam, x, y, d)`, `camRect(cam, rect, d)`: an object's place under another scene's camera. Every opening
  comes from the thing it opens through, never typed pixels. `handoff(base, u, side, { dx })`: the same move in both
  scenes across a wipe; `wipeEdge(tin, angle)`, `openK(tin)`, `exitK(f)`.
- Motion helpers: `Path`, `glide`, `pop`, `spring`, `stagger`, `bob`, `sway`, `ballistic`, `shake`, `resample`, `morph`.

## The Stage (`stage.ts`, `stage-gl.ts`, `art.ts`, `color.ts`)

`st.cam = cam(…)` · `begin(out)` · `sky` · `sprite(art, x, y, { depth, scale, sx, sy, rot, anchor, tint, gain, rim,
rimColor, add, blur, flat, crop, screen, clip })` · `disc` · `rect` · `capsule` · `ring` · `tri` · `glow` ·
`sparkle` · `beam` · `puffs` · `contact` · `line(pts, w, col, { feather, add, dash, closed })` (points may carry `d`,
their own depth) · `poly` · `planet` · `project` · `unproject` · `withClip` · `withMagnify` · `flush` · `end()` (the
rig's post). Depth: 1 the subject, above 1 farther (parallax, haze), below 1 the foreground. `bake(w, h, paint,
{ res, anchor, rim })` and `Atlas` paint once, never in `render()`.

## Budget and rules

About 12 megatexels baked per scene (the Stage warns), about 10 ms a frame in the live preview, no Canvas2D in
`render()`, times from the words and the beat grid, no `Math.random`, `Date` or `performance.now`, no state between
frames. `cast-sheet.ts`, in the skill's `assets/`, is a scene that renders the cast in its views and poses: copy it
into a video's `scenes/` to check a new character against references 01 and 02.
