// The squirrels (part of the Nutlight kit: scenes import from './index'). One design for every character, drawn after
// the style's references (assets/references in the nutlight-style skill; in a project, docs/style/nutlight/): 01 the
// full front, 02 the head turned three-quarter, 03-08 the cast at work and at rest. Each video casts its own
// characters from it: a name, a fur (FUR), a few proportions and gear (SquirrelSpec); the design itself stays.
//
// THE DESIGN
//   A big round head about as wide as the body, sitting low into the shoulders; a short snub muzzle; big eyes: white
//   eyeballs with a dark brown iris toward the nose, a lighter lower ring, a large cream glint up and toward the look
//   and a small one low, a thick dark upper lid line, a lash flick at the outer corner and small brows once the head
//   turns; the cream "spectacles" round the eyes with the forehead's fur coming down between them, into the muzzle,
//   chin, chest and a long cream belly; a tiny dark oval nose with a glint, a thin smile with upturned ends; tall
//   upright ears with a slightly pointed tip, a small tuft, a light rim and a darker rust inner ear; fur tufts at the
//   cheeks' edges and on the crown. A compact pear body, short thick arms (each ONE tapering tube from the shoulder
//   through a rounded elbow to a mitten paw), broad hind paws. The TAIL enormous: a broad C rising steeply up the back,
//   its top at the head's, the spiral at the far side, in a few broad crisp nested bands (FUR.*.tailOuter / Amber /
//   Orange / Core), light and dark by turns, into one clean darker curl at the spiral's core. No outlines; volume from
//   soft internal gradients, broad soft shadow planes and narrow highlights.
//   Every feature sits at a longitude on the head (the face model FM), so the profile, the 60° in-between, the
//   three-quarter and the front are one head turned, never a profile's mask pasted on a turned skull.
//
// LIT BY THE SCENE (by itself, from st.look, the rig the scene's Stage already has; light.ts's charLight): the fur
// takes the key light's colour (a multiply that keeps its values: warm under a lamp, cooler under screens), a thin rim
// from the location's other source runs along the outer masses on the side away from the key, and a soft contact
// shadow lies under the feet, the haunch and the tail's root. Opt out per draw with `light: false`, or scale a part:
// `light: { contact: 0 }` where the scene draws its own shadow or there is no ground under the character.
//
// HOW IT WORKS: cut-out animation. Each character is baked ONCE into an atlas of parts (the head in profile and turned
// 60°, 30° (three-quarter) and 0° (front), eyes, lids, mouths, ears, the body from the side, from behind and from the
// front, haunches, feet, the arm's two discs, paws, tail, gear) at its scene's start; every frame the rig places the
// parts from a pose, a pure function of t, as GPU sprites (one draw call per character). Nothing is drawn with
// Canvas2D in render(). An ARM is a chain of discs along a spine (shoulder, a rounded elbow, wrist) placed per frame:
// first the shade discs, then the lit discs shifted toward the lit side, so the arm is one tube whose shadow runs
// unbroken through the elbow at any bend.
//
//   const pip = new Squirrel({ name: 'Pip', fur: FUR.amber, gear: { cap: true } }); // a field of the scene (after its Stage)
//   const p = alive(typing(POSE.sitType, t), t, 1);                   // a pose + breathing, blinks, tail, ears
//   pip.draw(st, 640, 760, p, { scale: 0.62, view: 'back' });         // (x, y): the seat / ground point
//   const j = pip.joints(640, 760, p, { scale: 0.62, view: 'back' }); // where the paw, eye, nose are
//   // reaching: the paw lands ON the target, or the rig tells you it can't
//   const r = pip.reach(640, 760, kb.x, kb.y, o);                     // { pt, ok, short }: pt goes in reachN
//   const x = pip.standFor(panel.x, panel.y, groundY, o);             // where to stand so the paw gets there
//   // acting: an expression blended in by an amount (restraint: most of the time 0.4-0.8 reads)
//   const q = express(p, 'worried', smootherstep(t0, t0 + 0.4, t));   // or withPose(p, { expr: EXPR.worried })
//   pip.draw(st, 960, 900, express(POSE.shrug, 'skeptical'), { view: 'front' }); // the whole body toward us
//
// Units: rig units (u); a standing squirrel is about 520 u from ear tip to toes, the head 200 u across; scale turns
// them into world px. (x, y) is the ground point under the hip (standing) or the seat point (sitting).
import { Atlas, smooth, type Art, type Pt } from './art';
import { css, lin, mixs, type Col, type RGB } from './color';
import type { Stage, DrawOpts, Clip } from './stage';
import { charLight, CHAR_LIGHT } from './light';
import { FUR, GEAR, type FurPalette } from './palette';
import { clamp, hash, lerp, noise1, smootherstep, TAU } from '../engine/util';

// ------------------------------------------------------------------------------------------------------------
// The cast
// ------------------------------------------------------------------------------------------------------------
export interface Gear {
  hat?: boolean; vest?: boolean; glasses?: boolean; backpack?: boolean; suit?: boolean;
  /** a plain red cap (no letter or emblem), drawn like the hard hat */
  cap?: boolean;
}
export interface SquirrelSpec {
  name: string;
  fur: FurPalette;
  /** body width (1; a hair slimmer for some of the cast) */
  slim?: number;
  /** head size (1; a young one's head is bigger for its body) */
  head?: number;
  /** the flame-shaped tuft on the crown */
  tuft?: boolean;
  gear?: Gear;
}
/** Starting points for a cast, one per fur (a video gives each character its own name, role and gear:
 * `{ ...CAST.coral, name: 'Rue', gear: { glasses: true } }`). Every character is a squirrel of this one design. */
export const CAST = {
  amber: { name: 'amber', fur: FUR.amber },
  coral: { name: 'coral', fur: FUR.coral, slim: 0.96, tuft: true },
  tan: { name: 'tan', fur: FUR.tan },
  chestnut: { name: 'chestnut', fur: FUR.chestnut, slim: 0.95 },
  grey: { name: 'grey', fur: FUR.grey },
  golden: { name: 'golden', fur: FUR.golden, slim: 0.92, head: 1.1, tuft: true },
} as const satisfies Record<string, SquirrelSpec>;
export type CastKey = keyof typeof CAST;

// ------------------------------------------------------------------------------------------------------------
// Expressions: the face's controls, blended in by an amount (all 0 = the approved neutral face)
// ------------------------------------------------------------------------------------------------------------
/**
 * The face's controls (each 0 at rest; optional in a pose's `expr`). Read in every view: profile, three-quarter, front.
 *   lidU   the upper lids lowered (0 open … 1 shut; beyond the blink, which `eye` keeps)
 *   lidL   the lower lids raised (0 … 1: a smile's squint turns the eyes into crescents)
 *   slant  the upper lids' tilt: + their inner corners up (worried, sad), − down (determined, cross)
 *   wide   the eyes opened wider (0 … 1)
 *   lookX  the gaze: + toward the way the squirrel faces, − away (−1 … 1)
 *   lookY  the gaze: + down, − up (−1 … 1)
 *   smile  the closed mouth: + the bigger 'w' smile, − a frown (−1 … 1; 0 the neutral 'w' / the profile's curve)
 *   flat   a small flat line (0 … 1)       wavy  the worried wavy mouth (0 … 1)
 *   open   the mouth open (0 … 1; with the pose's `mouth`, the larger wins)   round  0 a wide open grin … 1 a round 'o'
 *   cheek  the cheeks raised: the lower lids pushed up and a faint blush (0 … 1)
 *   asym   one side more than the other (−1 … 1: skeptical: one lid lower, the mouth pulled to one side)
 *   ears   added to the pose's ears (+ pricked, − drooped back)
 *   droop  (an option off by default: 0 changes nothing) the ears laid flat back along the head and a
 *          little shorter, dejected (0 … 1)
 */
export interface Expr {
  lidU: number; lidL: number; slant: number; wide: number; lookX: number; lookY: number;
  smile: number; flat: number; wavy: number; open: number; round: number; cheek: number; asym: number; ears: number;
  droop: number;
}
const EXPR0: Expr = { lidU: 0, lidL: 0, slant: 0, wide: 0, lookX: 0, lookY: 0, smile: 0, flat: 0, wavy: 0, open: 0, round: 0, cheek: 0, asym: 0, ears: 0, droop: 0 };
const EXPR_KEYS = Object.keys(EXPR0) as (keyof Expr)[];
/** Named expressions (use them at an amount: express(p, 'worried', 0.7)). Restrained by design: none is a take. */
export const EXPR = {
  neutral: {},
  /** a pleased smile: the bigger 'w', the cheeks up, the lower lids a little */
  smile: { smile: 0.8, lidL: 0.24, cheek: 0.4, ears: 0.1 },
  /** joy: the mouth open in a grin, the eyes squeezed into crescents, the cheeks up, ears up */
  delighted: { smile: 1, open: 0.7, round: 0, lidL: 0.52, cheek: 0.9, ears: 0.55 },
  /** eyes wide, a round 'o', ears pricked */
  surprised: { wide: 1, open: 0.5, round: 1, ears: 0.9, lookY: -0.1 },
  /** eyes open wide under lids whose inner corners are up (in profile an arched lid: a lifted brow), the wavy mouth (in
   * profile the lips just parted, the corner down), ears back (watching something go wrong) */
  worried: { slant: 1.15, lidU: 0.14, wide: 0.5, wavy: 0.9, ears: -0.6, lookY: 0.05 },
  /** lids a little lowered and level, a flat mouth, ears forward */
  focused: { lidU: 0.32, slant: -0.3, flat: 0.8, lookY: 0.15, ears: 0.35 },
  /** one lid lower than the other, the flat mouth pulled to one side */
  skeptical: { lidU: 0.36, asym: 0.85, slant: -0.25, flat: 0.85, ears: -0.1 },
  /** eyes up and away, the mouth small and to one side */
  thinking: { lookX: -0.45, lookY: -0.85, lidU: 0.16, asym: 0.35, flat: 0.6, ears: 0.1 },
  /** lids heavy with the inner corners up, a frown, ears down, the gaze down */
  sad: { slant: 0.85, lidU: 0.42, smile: -0.9, ears: -0.95, lookY: 0.55 },
  /** lids lowered with the inner corners down, a firm flat mouth, ears up */
  determined: { slant: -0.8, lidU: 0.3, lidL: 0.16, flat: 0.75, smile: -0.12, ears: 0.6 },
} as const satisfies Record<string, Partial<Expr>>;
export type ExprKey = keyof typeof EXPR;
/** Between two expressions (k 0 → a, 1 → b). */
export function mixExpr(a: Partial<Expr> | undefined, b: Partial<Expr> | undefined, k: number): Partial<Expr> | undefined {
  if (!a && !b) return undefined;
  if (k <= 0) return a;
  if (k >= 1) return b;
  const o: Partial<Expr> = {};
  for (const key of EXPR_KEYS) {
    const x = a?.[key] ?? 0, y = b?.[key] ?? 0;
    if (x !== 0 || y !== 0) o[key] = lerp(x, y, k);
  }
  return o;
}
/** A pose with an expression blended in by k (0 none … 1 the named one), over whatever expression it already has. */
export function express(p: SqPose, e: ExprKey | Partial<Expr>, k = 1): SqPose {
  if (k <= 0) return p;
  const to = typeof e === 'string' ? EXPR[e] : e;
  return { ...p, expr: mixExpr(p.expr, to, clamp(k)) };
}
/** Expression keys over time ([[t, name or controls], …]): each change eased over `blend` s before its time, like poseKeys. */
export function exprKeys(t: number, ks: [number, ExprKey | Partial<Expr>][], blend = 0.4): Partial<Expr> | undefined {
  if (!ks.length) return undefined;
  const of = (e: ExprKey | Partial<Expr>) => (typeof e === 'string' ? EXPR[e] : e);
  let x: Partial<Expr> | undefined = of(ks[0]![1]);
  for (let i = 1; i < ks.length; i++) {
    const [ti, ei] = ks[i]!, b = Math.min(blend, Math.max(0.05, ti - ks[i - 1]![0]));
    if (t <= ti - b) break;
    x = mixExpr(x, of(ei), smootherstep(ti - b, ti, t));
  }
  return x;
}
const exprOf = (p: SqPose): Expr => (p.expr ? { ...EXPR0, ...p.expr } : EXPR0);

// ------------------------------------------------------------------------------------------------------------
// The pose
// ------------------------------------------------------------------------------------------------------------
/** An arm's angles: `sh` the shoulder (0 hanging, + forward), `el` the elbow's bend from the upper arm (+ forward and
 * up). The front view (draw's view: 'front') reads two more that the side views ignore: `rot` swings the forearm out
 * to the side (+: a shrug's open palms, a cheer) or in across the chest (−), `ab` opens the upper arm out from the body
 * (default 0.16). An arm without `rot` rests there as reference 01's do: the elbow tucked at the body's side, the paws apart
 * under the chest. */
export interface ArmAngles {
  sh: number; el: number; rot?: number; ab?: number;
  /** from the front, how much of the side pose's idle (no `rot`) is left while a blend turns it into a posed arm:
   * set by mixPose, 0..1 (absent: 1 without `rot`, 0 with it) */
  idle?: number;
}
/**
 * A pose (angles in radians). Arm angles are measured from hanging straight down, positive swinging forward (toward
 * the way the squirrel faces); `el` bends the elbow forward/up from the upper arm. `reachN` / `reachF` (rig units from
 * the character's origin, facing right: use sq.reach()) override an arm's angles: the PAW lands on that point.
 */
export interface SqPose {
  /** the body's lean (+ forward) */
  lean: number;
  /** the hip above the origin (u): 0 sitting on the seat point, 16 standing (the soles and the haunch on the ground) */
  lift: number;
  /** body squash-stretch (1 none; breathing, a hop) */
  sy: number;
  head: number;          // head tilt relative to the body (+ nods down/forward, − looks up)
  /** the head turned toward us: 0 profile (up to 0.46: squashed a little) … the swap at 0.46-0.54 (through a 60° head)
   * … 1 three-quarter (reference 02: both eyes; looking out at the city, a shrug; anything from 0.54 to 1.5) … 2 full front
   * (reference 01). In view 'front' (the body toward us) it turns the head AWAY from us instead: 0 the face toward us, 1
   * three-quarter toward the way the squirrel faces. */
  turn: number;
  ears: number;          // 0 relaxed … 1 pricked up (startled); −1 drooped (a shrug)
  earTwitch: number;     // −1..1 a quick flick of the near ear
  eye: number;           // 0 closed … 1 open (blinks), >1 wide (startled)
  mouth: number;         // 0 closed … 1 open (cheer, startled, "oh")
  armN: ArmAngles; armF: ArmAngles;
  reachN?: Pt | null; reachF?: Pt | null;
  /** how much of each arm its reach takes, 0..1 (absent: all of it). mixPose sets it when only one of two poses
   * reaches, so the paw travels from where the arm's angles put it to the target, instead of jumping halfway */
  reachNw?: number; reachFw?: number;
  /** paws: 0 relaxed, 1 a pointing paw (index out) */
  pointN: number;
  thighN: number; thighF: number;   // thigh swing (+ forward)
  footN: number; footF: number;     // foot pitch (absolute; 0 flat)
  /** foot lift off the ground (u), walking */
  stepN: number; stepF: number;
  tail: number;          // tail sway (+ toward the back)
  tailCurl: number;      // 1 normal; >1 curls tighter (a happy squirrel), <1 relaxes
  /** the arms' length (1 rest; a raised, pointing or reaching arm stretches, cartoon-style: the references' raised
   * arms are half again as long as their resting ones) */
  reachK: number;
  /** the far arm's stretch (default reachK): 1 keeps a tucked far arm its resting length while the near one reaches */
  reachKF?: number;
  /** sideways body shift (u), a hop or a step */
  dx: number; dy: number;
  /** the face's expression (EXPR.*, or controls of your own; missing = the neutral face). express() blends one in. */
  expr?: Partial<Expr>;
}
const A0 = { sh: 0.2, el: 0.55 };
export const BASE_POSE: SqPose = {
  lean: 0, lift: 16, sy: 1, head: 0, turn: 0, ears: 0, earTwitch: 0, eye: 1, mouth: 0,
  armN: { ...A0 }, armF: { sh: 0.1, el: 0.65 }, reachN: null, reachF: null, pointN: 0,
  thighN: 0.15, thighF: 0.05, footN: 0, footF: 0, stepN: 0, stepF: 0, tail: 0, tailCurl: 1, reachK: 1, dx: 0, dy: 0,
};
const P = (o: Partial<SqPose>): SqPose => ({ ...BASE_POSE, ...o, armN: { ...BASE_POSE.armN, ...(o.armN ?? {}) }, armF: { ...BASE_POSE.armF, ...(o.armF ?? {}) } });
/** Named poses. Sitting ones put the seat point at (x, y). Each reads from the front too (view: 'front'). They carry no
 * expression (the face is the scene's call: express(POSE.cheer, 'delighted'), express(POSE.startled, 'surprised'),
 * express(POSE.shrug, 'skeptical' or 'worried')). */
export const POSE = {
  stand: P({}),
  /** sitting upright (on a chair, a ledge, the floor) */
  sit: P({ lift: 0, thighN: 1.35, thighF: 1.25, footN: 0.1, footF: 0.1, armN: { sh: 0.55, el: 0.8 }, armF: { sh: 0.45, el: 0.9 } }),
  /** at the keyboard: hunched in (the shoulders forward, the head dropped toward the screen), both paws forward (give reachN / reachF from sq.reach(); typing() moves them) */
  sitType: P({ lift: 0, lean: 0.3, head: 0.14, thighN: 1.35, thighF: 1.25, footN: 0.1, footF: 0.1, armN: { sh: 1.15, el: 0.45 }, armF: { sh: 1.05, el: 0.55 }, reachK: 1.2 }),
  /** pointing up and forward (reference 03's squirrel at the warning panel): ONE BENT CURVE, the upper arm forward and a little
   * up from under the cheek, the forearm rising, the paw at eye level a paw's width ahead of the snout (never across
   * the muzzle); the far arm tucked at the chest at its resting length (only two feet touch the floor). In a scene,
   * aim it with sq.pointAt(), which keeps the paw there. From the front: the arm out to the side and up. */
  point: P({ lean: 0.05, head: -0.16, armN: { sh: 1.7, el: 0.8, rot: 1.25, ab: 0.5 }, armF: { sh: 0.7, el: 1.5 }, pointN: 1, tail: 0.05, ears: 0.4, reachK: 1.75, reachKF: 1 }),
  /** a tap forward at chest height */
  tap: P({ lean: 0.08, armN: { sh: 1.5, el: 0.1, rot: 0.6, ab: 0.4 }, armF: { sh: 0.7, el: 1.5 }, pointN: 1, reachK: 1.3, reachKF: 1 }),
  /** joy: both paws up in front (the near one at the chin, the far one at the chest: both read), mouth open, ears
   * up, tail curled tight (add hop() for a jump); from the front, both paws up and out */
  cheer: P({ lean: -0.08, head: -0.16, armN: { sh: 1.55, el: 1.12, rot: 0.55, ab: 0.45 }, armF: { sh: 1.14, el: 0.94, rot: 0.55, ab: 0.45 }, mouth: 1, ears: 0.7, tailCurl: 1.1, eye: 1.05, reachK: 1.25 }),
  /** forearms out, palms up, head tilted toward us, ears drooped */
  shrug: P({ lean: -0.02, head: 0.14, turn: 1, armN: { sh: 0.5, el: 1.55, rot: 1.25, ab: 0.3 }, armF: { sh: 0.4, el: 1.65, rot: 1.25, ab: 0.3 }, ears: -0.8, tail: -0.05 }),
  /** looking up (the question, the stars) */
  lookUp: P({ lean: -0.1, head: -0.45, armN: { sh: 0.4, el: 0.95 }, armF: { sh: 0.35, el: 0.95 }, ears: 0.2 }),
  /** holding something in both paws at the chest (pass the thing as draw's `hold`) */
  hold: P({ lean: 0.04, armN: { sh: 1.05, el: 1.0 }, armF: { sh: 0.95, el: 1.1 } }),
  /** ears up, eyes wide, paws up: something went wrong */
  startled: P({ lean: -0.12, head: -0.08, ears: 1, eye: 1.18, mouth: 0.7, armN: { sh: 1.3, el: 1.35, rot: 0.15 }, armF: { sh: 1.2, el: 1.45, rot: 0.15 }, tail: -0.12, tailCurl: 0.9, dy: -6 }),
} as const;
export type PoseKey = keyof typeof POSE;

const lerpU = (a: number | undefined, b: number | undefined, k: number) => (a === undefined && b === undefined ? undefined : lerp(a ?? (b as number), b ?? (a as number), k));
const idleOf = (a: ArmAngles) => (a.rot === undefined ? 1 : a.idle ?? 0);
const lerpArm = (a: ArmAngles, b: ArmAngles, k: number): ArmAngles => {
  const o: ArmAngles = { sh: lerp(a.sh, b.sh, k), el: lerp(a.el, b.el, k) };
  const ia = idleOf(a), ib = idleOf(b);
  // (each side's effective opening: the front view's idle takes 0.1, a posed arm armFront's 0.16)
  const abOf = (x: ArmAngles) => x.ab ?? (x.rot === undefined ? 0.1 : 0.16);
  const r = lerpU(a.rot, b.rot, k), ab = a.ab === undefined && b.ab === undefined && ia === ib ? undefined : lerp(abOf(a), abOf(b), k);
  if (r !== undefined) o.rot = r;
  if (ab !== undefined) o.ab = ab;
  // (a blend between an idle arm and a posed one fades the front view's idle out, instead of jumping at k > 0)
  if (r !== undefined && (ia > 0 || ib > 0)) o.idle = lerp(ia, ib, k);
  return o;
};
/** One arm's reach between two poses: a target both have moves between them; a target only one has stays where it is
 * while its weight (reachNw / reachFw) fades in or out, and solve() blends the arm from its angles to the reach. */
const mixReach = (a: Pt | null | undefined, b: Pt | null | undefined, wa: number | undefined, wb: number | undefined, k: number): [Pt | null, number | undefined] => {
  if (!a && !b) return [null, undefined];
  const w = lerp(a ? wa ?? 1 : 0, b ? wb ?? 1 : 0, k);
  return [a && b ? [lerp(a[0], b[0], k), lerp(a[1], b[1], k)] : (a ?? b)!, w >= 1 ? undefined : w];
};
/** The swap band of `turn`: the profile up to its low end, the three-quarter from its high end, the 60° head between
 * (headsAt). No scene holds a value inside it. */
export const TURN_BAND = [0.46, 0.54] as const;
/**
 * A head turn on its way from `from` to `to` at progress k (0..1, eased or not), LINGERING through the swap band so the
 * 60° head shows for a few frames and the face's volume turns instead of jumping profile → three-quarter (* reference 00-motion: "a head turn reveals the established facial volume"). When the two values lie on either side
 * of the band, the share `dwell` of the progress around where a plain lerp crosses the band's middle is spent crossing
 * the band (narrowed symmetrically when that crossing is near an end, so the middle is crossed at the same k as
 * before); otherwise it is the plain lerp. The ends are exact
 * (k 0 → from, 1 → to), so a held turn never changes. dwell 0.85 (the default) suits a ~0.25 s smootherstep ramp:
 * about three frames of the 60° head. A scene that ramps `turn` itself goes through it:
 *   turn: headTurn(smootherstep(t0, t0 + 0.25, t))          (0 → 1; a glance back: headTurn(pulse) on the way out too)
 * mixPose() and poseKeys() already do (poseKeys sets the dwell from its blend time).
 */
export function headTurn(k: number, to = 1, from = 0, dwell = 0.85): number {
  const u = clamp(k), [lo, hi] = TURN_BAND;
  if (!((from <= lo && to >= hi) || (from >= hi && to <= lo))) return lerp(from, to, u);
  const up = to > from, e0 = up ? lo : hi, e1 = up ? hi : lo, kc = (0.5 - from) / (to - from), m = 0.04;
  const h = Math.max(0, Math.min(dwell / 2, kc - m, 1 - m - kc)), k0 = kc - h, k1 = kc + h;
  if (h <= 0) return lerp(from, to, u);
  if (u <= k0) return lerp(from, e0, u / k0);
  if (u >= k1) return lerp(e1, to, (u - k1) / (1 - k1));
  return lerp(e0, e1, (u - k0) / (k1 - k0));
}
/** Between two poses (k 0 → a, 1 → b). Ease k yourself (smootherstep) so a change of pose starts and ends at rest. The
 * head's turn goes through headTurn() (`turnDwell` its dwell), so a change that turns the head shows the 60° head. */
export function mixPose(a: SqPose, b: SqPose, k: number, turnDwell = 0.6): SqPose {
  if (k <= 0) return a;
  if (k >= 1) return b;
  const o = { ...a } as SqPose;
  for (const key of Object.keys(a) as (keyof SqPose)[]) {
    const x = a[key], y = b[key];
    if (typeof x === 'number' && typeof y === 'number') (o as unknown as Record<string, number>)[key] = lerp(x, y, k);
  }
  o.armN = lerpArm(a.armN, b.armN, k); o.armF = lerpArm(a.armF, b.armF, k);
  o.reachKF = lerp(a.reachKF ?? a.reachK, b.reachKF ?? b.reachK, k);
  [o.reachN, o.reachNw] = mixReach(a.reachN, b.reachN, a.reachNw, b.reachNw, k);
  [o.reachF, o.reachFw] = mixReach(a.reachF, b.reachF, a.reachFw, b.reachFw, k);
  o.turn = headTurn(k, b.turn, a.turn, turnDwell);
  const ex = mixExpr(a.expr, b.expr, k);
  if (ex) o.expr = ex; else delete o.expr;
  return o;
}
/** A pose with some fields changed. */
export const withPose = (p: SqPose, o: Partial<SqPose>): SqPose => ({ ...p, ...o });
/**
 * Pose keys over time: [[t, pose], …] → the pose at t, each change eased (smootherstep over `blend` s before the key's
 * time ends at the key). A key holds until the next one starts blending.
 */
export function poseKeys(t: number, ks: [number, SqPose][], blend = 0.45): SqPose {
  if (!ks.length) return BASE_POSE;
  let p = ks[0]![1];
  for (let i = 1; i < ks.length; i++) {
    const [ti, pi] = ks[i]!, b = Math.min(blend, Math.max(0.05, ti - ks[i - 1]![0]));
    if (t <= ti - b) break;
    // (the turn's dwell from the blend's length: about 0.1 s of the 60° head, )
    p = mixPose(p, pi, smootherstep(ti - b, ti, t), clamp(0.32 / b, 0.2, 0.85));
  }
  return p;
}

// ------------------------------------------------------------------------------------------------------------
// Secondary motion: every function a pure function of t (and a seed per character, so two squirrels don't blink
// together). alive() adds all of them to a pose.
// ------------------------------------------------------------------------------------------------------------
/** Eye openness from a seeded blink schedule (a blink every 2.6-5.2 s, 0.16 s long; now and then a double). */
export function blink(t: number, seed = 0): number {
  let tb = -1.3 + 2.0 * hash(seed, 1), i = 0;
  while (tb < t - 0.4 && i < 400) { tb += 2.6 + 2.6 * hash(seed, i, 2); i++; }
  const near = (tc: number) => { const u = (t - tc) / 0.16; return u > 0 && u < 1 ? Math.sin(Math.PI * u) : 0; };
  let c = near(tb) + near(tb - 2.6 - 2.6 * hash(seed, i - 1, 2));
  if (hash(seed, i, 3) < 0.25) c += near(tb + 0.24);
  return 1 - 0.94 * clamp(c);
}
/** Breathing: a slow rise of the chest (body squash-stretch, a hair of head bob). */
export const breathe = (t: number, seed = 0, k = 1) => Math.sin(TAU * (t / 3.6 + hash(seed, 7))) * k;
/** The tail's idle sway (rad) and its slower curl breathing. */
export const tailSway = (t: number, seed = 0, k = 1) => k * (0.045 * Math.sin(TAU * (t / 4.3 + hash(seed, 8))) + 0.022 * noise1(t * 0.6, seed + 3));
/** Ear twitches: now and then a quick flick (−1..1), seeded. */
export function earTwitch(t: number, seed = 0): number {
  const period = 4.5, k = Math.floor(t / period), u = t - k * period - 3.2 * hash(seed, k, 9);
  return u > 0 && u < 0.32 && hash(seed, k, 10) < 0.6 ? Math.sin((Math.PI * u) / 0.32) * Math.sin(TAU * u / 0.16) : 0;
}
/** How much of the blink an expression lets through (1 all … 0 none): while its lower lids are up (lidL, and the
 * cheeks that lift them: a smile's crescents, delighted's), a blink on top reads as shut eyes, so it fades out from a
 * lower lid at 0.2 to none from 0.3 . */
function blinkRoom(e: Partial<Expr> | undefined) {
  if (!e) return 1;
  return 1 - smootherstep(0.2, 0.3, clamp((e.lidL ?? 0) + 0.35 * (e.cheek ?? 0), 0, 1));
}
/** A pose brought to life: breathing, blinks, tail sway, ear twitches, a slow head drift. `k` scales it all. */
export function alive(p: SqPose, t: number, seed = 0, k = 1): SqPose {
  const b = breathe(t, seed, k), bl = blink(t, seed), room = blinkRoom(p.expr);
  return {
    ...p,
    sy: p.sy * (1 + 0.012 * b),
    head: p.head + k * (0.015 * b + 0.02 * noise1(t * 0.35, seed + 5)),
    eye: p.eye * (room >= 1 ? bl : 1 - room * (1 - bl)),
    earTwitch: p.earTwitch + k * earTwitch(t, seed),
    tail: p.tail + tailSway(t, seed, k),
    tailCurl: p.tailCurl * (1 + 0.015 * k * Math.sin(TAU * (t / 5.1 + hash(seed, 11)))),
  };
}
/** Typing: the paws pat the keys, alternating, at about 7 strokes a second (k 0..1 how hard; 0 rests). */
export function typing(p: SqPose, t: number, k = 1, seed = 0): SqPose {
  if (k <= 0) return p;
  const s1 = Math.abs(Math.sin(TAU * (t * 3.4 + hash(seed, 21)))), s2 = Math.abs(Math.sin(TAU * (t * 3.1 + 0.37 + hash(seed, 22))));
  const burst = 0.6 + 0.4 * Math.sin(TAU * t / 2.3 + seed);
  const rN = p.reachN ? [p.reachN[0] + 5 * k * Math.sin(TAU * t * 0.9 + seed), p.reachN[1] - 8 * k * s1 * burst] as Pt : p.reachN;
  const rF = p.reachF ? [p.reachF[0] + 5 * k * Math.sin(TAU * t * 0.7 + seed + 1), p.reachF[1] - 8 * k * s2 * burst] as Pt : p.reachF;
  return { ...p, reachN: rN, reachF: rF, armN: { ...p.armN, sh: p.armN.sh + 0.05 * k * s1 * burst, el: p.armN.el - 0.12 * k * s1 * burst }, armF: { ...p.armF, sh: p.armF.sh + 0.05 * k * s2 * burst, el: p.armF.el - 0.12 * k * s2 * burst }, head: p.head + 0.01 * k * s1 };
}
/** Walking at `phase` cycles (a step per half cycle): the hop of the hip, thighs and feet swinging, arms counter. */
export function walk(phase: number, k = 1): SqPose {
  const a = TAU * phase, s = Math.sin(a), c = Math.cos(a);
  return mixPose(POSE.stand, {
    ...POSE.stand,
    lean: 0.1, lift: 20 + 8 * Math.abs(c), sy: 1 + 0.02 * Math.abs(s),
    thighN: 0.15 + 0.55 * s, thighF: 0.1 - 0.55 * s, footN: -0.25 * s, footF: 0.25 * s,
    stepN: Math.max(0, -c) * 16, stepF: Math.max(0, c) * 16,
    armN: { sh: 0.3 - 0.35 * s, el: 0.6 }, armF: { sh: 0.25 + 0.35 * s, el: 0.6 },
    tail: 0.06 * c, head: 0.03 * s,
  }, k);
}
/** A hop of joy (a jump with a squash on landing), from t0, dur s. */
export function hop(p: SqPose, t: number, t0: number, height = 40, dur = 0.5): SqPose {
  const u = (t - t0) / dur;
  if (u <= -0.15 || u >= 1.15) return p;
  const air = u > 0 && u < 1 ? Math.sin(Math.PI * u) : 0;
  const squash = u < 0 ? Math.sin(Math.PI * (u + 0.15) / 0.15) : u > 1 ? Math.sin(Math.PI * (u - 1) / 0.15) : 0;
  return { ...p, dy: p.dy - height * air, sy: p.sy * (1 - 0.08 * squash + 0.06 * air), tail: p.tail - 0.1 * air };
}
/** A walk between two points: where the character is at t and its pose (stride ~ 70 u per step at scale 1). */
export function walkTo(t: number, t0: number, t1: number, x0: number, x1: number, scale = 1, stride = 140): { x: number; face: 1 | -1; k: number; pose: SqPose } {
  const k = smootherstep(t0, t1, t), x = lerp(x0, x1, k), face: 1 | -1 = x1 >= x0 ? 1 : -1;
  const moving = t > t0 && t < t1 ? Math.min(1, Math.min(t - t0, t1 - t) / 0.25) : 0;
  const phase = (Math.abs(x - x0) / Math.max(1, stride * scale));
  return { x, face, k, pose: walk(phase, moving) };
}

// ------------------------------------------------------------------------------------------------------------
// The rig's skeleton (rig units, facing right, y down)
// ------------------------------------------------------------------------------------------------------------
const SK = {
  // on the body (origin: the seat point, the bottom of the pelvis)
  neck: [30, -204] as Pt, neckBack: [44, -208] as Pt,
  shoulderN: [46, -176] as Pt, shoulderF: [22, -184] as Pt, shoulderBack: [78, -166] as Pt, shoulderBackF: [40, -176] as Pt,
  hipN: [-4, -58] as Pt, hipF: [-16, -62] as Pt,
  tailBase: [-72, -16] as Pt, tailBaseBack: [-88, -24] as Pt,
  upper: 64, fore: 58, paw: 20,
  // the arm's tube: its radius at the shoulder, the elbow and the wrist (× √reachK), the elbow's rounding
  rSh: 30, rEl: 23, rWr: 19,
  // on the head (origin: the neck), profile
  head: [4, -98] as Pt, eye: [54, -106] as Pt, nose: [127, -72] as Pt, mouth: [114, -50] as Pt, lip: [127, -62] as Pt,
  earN: [-20, -180] as Pt, earF: [-54, -164] as Pt, tuft: [40, -194] as Pt,
  // on the haunch: the heel
  heel: [16, 58] as Pt,
};
/** The body from the front (reference 01; origin the seat point, the N side +x): shoulders, hips, feet, the tail's root
 * behind the far haunch. */
const SKF = {
  neck: [0, -206] as Pt,
  shoulderN: [62, -170] as Pt, shoulderF: [-62, -170] as Pt,
  hipN: [78, -46] as Pt, hipF: [-78, -46] as Pt,
  footN: [82, 0] as Pt, footF: [-82, 0] as Pt,
  tailBase: [-64, -40] as Pt,
};
/** between two angles the short way round */
const lerpAng = (a: number, b: number, k: number) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return a + d * k; };
/** From the front, how much a paw can hang from a forearm at angle a2: none with the forearm straight up, all of it
 * from about 34° off the vertical. (Up is where hanging toward the ground switches sides, so a paw fading into the
 * forearm's line there never flips from one side to the other as the forearm passes it.) */
const hangRoom = (a2: number) => smootherstep(0, 0.6, Math.abs(lerpAng(0, a2 + Math.PI / 2, 1)));
const rotP = (p: Pt, a: number): Pt => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]; };
const addP = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const lerpP = (a: Pt, b: Pt, k: number): Pt => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
const dirA = (a: number): Pt => [Math.sin(a), Math.cos(a)]; // 0 down, + forward (toward +x)
const angOf = (d: Pt) => Math.atan2(d[1], d[0]);

/** Two-bone reach: the shoulder angles that put the wrist at `to` (from the shoulder), the elbow bending down/out. */
function reach2(to: Pt, l1: number, l2: number): { sh: number; el: number; d: number } {
  const dd = Math.hypot(to[0], to[1]), d = clamp(dd, 1e-3, l1 + l2 - 0.5), base = Math.atan2(to[0], to[1]); // angle from down, + toward +x
  const cosE = clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1), el = Math.PI - Math.acos(cosE);
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  return { sh: base - Math.acos(cosA), el, d: dd };
}
/** An arm solved (rig units): its joints, the upper arm's and forearm's angles, the paw's, and what a reach misses by. */
type ArmSolved = { sh: Pt; elbow: Pt; wrist: Pt; a1: number; a2: number; aPaw: number; hang: number; short: number };
/** The front view's arm (reference 01), from the same angles: a small 3D arm (out, down, toward us) projected on the picture.
 * The upper arm swings forward by sh and opens out by ab; the elbow bends by el about a hinge that `rot` turns: −
 * brings the forearm in across the chest, + out to the side (a shrug). `out` is +1 for the arm on the +x side. */
function armFront(a: ArmAngles, out: 1 | -1): { d1: Pt; d2: Pt } {
  const ab = a.ab ?? 0.16, rot = a.rot ?? -1.05;
  const u = [Math.sin(ab), Math.cos(ab) * Math.cos(a.sh), Math.cos(ab) * Math.sin(a.sh)];
  // the bend's direction with no rotation (the profile's: forward and up, square to the upper arm)
  let b0 = [0, -Math.sin(a.sh), Math.cos(a.sh)];
  const du = b0[0]! * u[0]! + b0[1]! * u[1]! + b0[2]! * u[2]!;
  b0 = [b0[0]! - du * u[0]!, b0[1]! - du * u[1]!, b0[2]! - du * u[2]!];
  const m0 = Math.hypot(b0[0]!, b0[1]!, b0[2]!) || 1; b0 = b0.map((v) => v / m0);
  // the outward direction square to both (the hinge turns toward it)
  let l = [u[1]! * b0[2]! - u[2]! * b0[1]!, u[2]! * b0[0]! - u[0]! * b0[2]!, u[0]! * b0[1]! - u[1]! * b0[0]!];
  if (l[0]! < 0) l = l.map((v) => -v);
  const b = [0, 1, 2].map((i) => Math.cos(rot) * b0[i]! + Math.sin(rot) * l[i]!);
  const f = [0, 1, 2].map((i) => Math.cos(a.el) * u[i]! + Math.sin(a.el) * b[i]!);
  return { d1: [out * u[0]!, u[1]!], d2: [out * f[0]!, f[1]!] };
}

// ------------------------------------------------------------------------------------------------------------
// The face model: the turned heads (head units, origin the neck, facing +x). A feature at longitude φ (deg; 0 the
// face's centre line, − the near side, toward us in profile) on a radius r about the head's vertical axis sits, at a
// yaw ψ (90 the profile … 0 the full front), at x = cx + r·sin(φ + ψ), visible while cos(φ + ψ) > 0. Measured: the
// approved profile (eye x 54, nose 127, mouth 114, the near ear −20) at ψ = 90; reference 02's near eye −18, far eye 72,
// nose 61 (head units) at ψ = 30, the nose and mouth 8 lower there than at the front (the far eye's ring shows between
// the nose and that eye); reference 01's eyes ±55 and ears ±62 at 0.
// ------------------------------------------------------------------------------------------------------------
const D2R = Math.PI / 180;
/** the turned heads baked per character (yaw, deg): a step toward us, three-quarter (reference 02), full front (reference 01) */
const YAWS = [60, 30, 0] as const;
// (references 01-02: the eyes bigger and a little taller than wide, each in a taller cream "spectacle"
// that reaches up toward the brow and out toward the cheek; their centres where they were)
const FM = {
  eye: { phi: 48, r: 74, y: -106, rx: 28, ry: 32 },
  ring: { phi: 52, r: 77, y: -112, rx: 39, ry: 47 },
  nose: { r: 123, y: -77, w: 33, h: 19, low: 10 },
  mouth: { r: 119, y: -58 },
  ear: { phi: 110, r: 74, y: -176 },
  tuft: { r: 36, y: -196 },
  blush: { phi: 58, r: 82, y: -64 },
};
interface FeatT { x: number; y: number; sx: number; vis: number; inner: 1 | -1 }
interface FaceGeo {
  yaw: number; ps: number; cx: number;
  /** [near, far] */
  eyes: FeatT[]; rings: FeatT[]; blush: FeatT[];
  nose: { x: number; y: number; w: number };
  mouth: { x: number; y: number; sx: number };
  ears: { x: number; y: number; rot: number; sx: number }[];
  tuft: Pt;
}
function faceGeo(yawDeg: number): FaceGeo {
  const psi = yawDeg * D2R, ps = Math.sin(psi), cx = 4 * ps;
  const at = (phi: number, r: number) => cx + r * Math.sin(phi * D2R + psi);
  const vis = (phi: number) => smootherstep(-0.04, 0.16, Math.cos(phi * D2R + psi));
  // eyes, rings and blush face half their longitude's way (a face looks forward, not out to the sides)
  const fs = (phi: number) => Math.max(0.04, Math.cos(0.4 * phi * D2R + psi));
  const noseX = at(0, FM.nose.r);
  // turned away from the full front, the snout's tip (the nose, the mouth under it) sits lower: at 30° it clears the far
  // eye, a sliver of that eye's ring between them (reference 02); toward the profile it meets the profile's nose height
  const low = FM.nose.low * smootherstep(0, 0.5, ps);
  const feat = (phi: number, r: number, y: number): FeatT => { const x = at(phi, r); return { x, y, sx: fs(phi), vis: vis(phi), inner: noseX >= x ? 1 : -1 }; };
  return {
    yaw: yawDeg, ps, cx,
    eyes: [feat(-FM.eye.phi, FM.eye.r, FM.eye.y), feat(FM.eye.phi, FM.eye.r, FM.eye.y)],
    rings: [feat(-FM.ring.phi, FM.ring.r, FM.ring.y), feat(FM.ring.phi, FM.ring.r, FM.ring.y)],
    blush: [feat(-FM.blush.phi, FM.blush.r, FM.blush.y), feat(FM.blush.phi, FM.blush.r, FM.blush.y)],
    nose: { x: noseX, y: FM.nose.y + low, w: lerp(FM.nose.w, 23, ps) },
    mouth: { x: at(0, FM.mouth.r), y: FM.mouth.y + low, sx: Math.pow(Math.cos(psi), 0.6) },
    ears: [-1, 1].map((sd) => {
      const th = sd * FM.ear.phi * D2R + psi;
      return { x: cx + FM.ear.r * Math.sin(th), y: FM.ear.y + 6 * ps, rot: 0.26 * Math.sin(th) - 0.3 * ps, sx: lerp(0.62, 1, Math.cos(psi)) };
    }),
    tuft: [at(0, FM.tuft.r), FM.tuft.y],
  };
}
const GEO = YAWS.map((y) => faceGeo(y));

// ------------------------------------------------------------------------------------------------------------
// Painting the parts (Canvas2D, once). (references 01-08: the same squirrels rendered richer): large clean
// colour shapes still carry the figure (no outlines), and inside them SOFT INTERNAL GRADIENTS (the forehead curving
// through several warm tones), BROAD SHADOW PLANES with soft edges and a few short fur strokes; dark lines only as
// accents (the eyes' thick upper lids and lashes, the brows, the mouth, the fingers and toes, the ears' folds).
// ------------------------------------------------------------------------------------------------------------
type C2 = CanvasRenderingContext2D;
const ell = (x: number, y: number, rx: number, ry: number, rot = 0) => { const p = new Path2D(); p.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, TAU); return p; };
const union = (...ps: Path2D[]) => { const p = new Path2D(); for (const q of ps) p.addPath(q); return p; };
/** Fill `shape` with c1, then (inside it) its shadow: what `lit` doesn't cover, in c2 — a hard-edged form shadow
 * (the gear's flat cel: hard hats, vests, the suit, the toolbox). */
function cel(c: C2, shape: Path2D, base: string, shade: string, lit: Path2D) {
  c.fillStyle = shade; c.fill(shape);
  c.save(); c.clip(shape); c.fillStyle = base; c.fill(lit); c.restore();
}
type Stops = [number, string][];
/** Fill the current clip with an elliptical radial gradient about (x, y), radii rx × ry, turned by rot. */
function gradE(c: C2, x: number, y: number, rx: number, ry: number, stops: Stops, rot = 0) {
  c.save(); c.translate(x, y); c.rotate(rot); c.scale(1, ry / rx);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, rx);
  for (const [k, col] of stops) g.addColorStop(clamp(k), col);
  const R = 900 * Math.max(1, rx / ry);
  c.fillStyle = g; c.fillRect(-900, -R, 1800, 2 * R);
  c.restore();
}
/** Fill the current clip with a linear gradient from (x0, y0) to (x1, y1). */
function gradL(c: C2, x0: number, y0: number, x1: number, y1: number, stops: Stops) {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  for (const [k, col] of stops) g.addColorStop(clamp(k), col);
  c.fillStyle = g; c.fillRect(-900, -900, 1800, 1800);
}
/** A mass's volume (the references: "soft internal gradients, broad shadow planes"): inside the clip, the base lit toward
 * (lx, ly) through the fur's light (a gold top) and fading at radius rx × ry into what is under it (the shade). */
function volume(c: C2, f: FurPalette, lx: number, ly: number, rx: number, ry: number, lit = 1) {
  gradE(c, lx, ly, rx, ry, [[0, mixs(f.base, f.light, lit)], [0.34, mixs(f.base, f.light, 0.45 * lit)], [0.62, f.base], [0.86, mixs(f.base, f.shade, 0.55)], [1, css(f.shade, 0)]]);
}
/** An ellipse whose arcs [a0, a1, n, sweep] (canvas angles, rad, a0 < a1, in increasing order within one turn from
 * the first a0) carry n SOFT points of fur each (reference 01: one or two small rounded points, never spikes): their
 * tips on the ellipse (so the mass never grows), the dips between them `depth` of the radius inside it, each point
 * leaning toward a1 (sweep 1) or a0 (−1); the outline is one smooth curve through it all. */
type TuftArc = [number, number, number, 1 | -1];
function tuftEll(x: number, y: number, rx: number, ry: number, arcs: TuftArc[], depth = 0.08): Path2D {
  const at = (a: number, k: number): Pt => [x + rx * k * Math.cos(a), y + ry * k * Math.sin(a)];
  const pts: Pt[] = [];
  const plain = (a: number, b: number) => { const n = Math.max(1, Math.ceil((b - a) / 0.2)); for (let i = 1; i <= n; i++) pts.push(at(a + ((b - a) * i) / n, 1)); };
  const start = arcs[0]![0];
  pts.push(at(start, 1));
  let cur = start;
  for (const [a0, a1, n, sw] of arcs) {
    plain(cur, a0);
    const st = (a1 - a0) / n;
    for (let j = 0; j < n; j++) {
      const aA = a0 + st * j;
      if (sw > 0) { pts.push(at(aA + 0.3 * st, 1 - depth), at(aA + 0.75 * st, 1 - 0.35 * depth), at(aA + st, 1)); }
      else { pts.push(at(aA + 0.25 * st, 1 - 0.35 * depth), at(aA + 0.7 * st, 1 - depth), at(aA + st, 1)); }
    }
    cur = a1;
  }
  plain(cur, start + TAU - 0.1);
  return smooth(pts, true, 0.5);
}
/** Short fur strokes (the references: "subtle short strokes on the forehead, cheeks and tail, never noisy"): each [x, y,
 * angle, length, width], in one colour, round-capped and gently curved. */
function strokes(c: C2, col: string, list: [number, number, number, number, number][], bend = 0.18) {
  c.strokeStyle = col; c.lineCap = 'round';
  for (const [x, y, a, len, w] of list) {
    const dx = Math.cos(a) * len, dy = Math.sin(a) * len;
    c.lineWidth = w; c.beginPath(); c.moveTo(x, y);
    c.quadraticCurveTo(x + dx * 0.5 - dy * bend, y + dy * 0.5 + dx * bend, x + dx, y + dy); c.stroke();
  }
}
/** A short crown tuft (reference 01: two small soft points on the top of the skull), its root at (x, y), `w` its
 * horizontal squash (a turned head). Not on a character with its own crown tuft part (a spec with `tuft`). */
function crownTuft(x: number, y: number, w = 1): Path2D {
  return smooth(([[-15, 6], [-12, -3], [-7, -9], [-3, -6], [1, -13], [5, -6], [10, -7], [13, 6]] as Pt[]).map(([u, v]) => [x + u * w, y + v] as Pt), true, 0.5);
}

/** The head in profile (facing right), its origin the neck: a big round skull, a SHORT snub muzzle (it barely leaves
 * the skull's circle), a round full cheek, a small crown tuft. (The mouth is a part of its own: paintMouthP.) */
function headShape(crown = true): Path2D {
  return union(ell(4, -98, 104, 100), ell(94, -64, 36, 30, -0.15), ell(44, -42, 68, 50, 0.1), ...(crown ? [crownTuft(26, -192)] : []));
}
function paintHead(c: C2, f: FurPalette, crown = true) {
  const head = headShape(crown);
  c.fillStyle = f.shade; c.fill(head);
  c.save(); c.clip(head);
  // the skull through several warm tones: gold high on the brow toward the light (up and ahead), the base, a step
  // darker round the back of the skull and under the jaw (a soft terminator)
  volume(c, f, 52, -150, 150, 140);
  // fur strokes: a few light ones on the lit brow, darker ones fanning from the crown at the back
  strokes(c, css(f.light, 0.55), [[40, -178, -0.5, 18, 2.6], [58, -170, -0.35, 16, 2.4], [24, -184, -0.75, 14, 2.4]]);
  strokes(c, css(f.shade, 0.45), [[-12, -176, 2.3, 18, 2.6], [-28, -160, 2.5, 16, 2.4], [-40, -138, 2.75, 14, 2.2], [6, -186, 2.0, 14, 2.2]]);
  // the cream mask: a disc round the big eye that runs into the muzzle and a ROUND cheek (one shape), the cheek's
  // back edge broken into small tufts of fur
  const mask = union(ell(SK.eye[0] - 2, SK.eye[1] + 4, 48, 54), ell(96, -60, 32, 26, -0.15), tuftEll(64, -40, 50, 44, [[2.4, 3.3, 2, -1]], 0.14));
  c.fillStyle = f.cream; c.fill(mask);
  c.save(); c.clip(mask);
  // the cream's own volume: the jaw's underside a soft step down, the muzzle's top a little lit
  gradE(c, 70, 18, 96, 46, [[0, f.creamShade], [0.55, css(f.creamShade, 0.75)], [1, css(f.creamShade, 0)]], 0.1);
  gradE(c, 104, -78, 34, 22, [[0, css(f.glint, 0.3)], [1, css(f.glint, 0)]]);
  c.restore();
  // the bridge of the snout: fur from the brow down to the nose (the profile's "V")
  c.fillStyle = mixs(f.base, f.light, 0.3); c.fill(smooth([[84, -158], [104, -124], [122, -94], [128, -82], [116, -86], [98, -96], [84, -112], [78, -134]], true, 0.45));
  c.restore();
  // the nose: a tiny dark oval button, its glint
  const nose = smooth([[115, -80], [129, -84], [136, -76], [132, -65], [120, -64]], true, 0.6);
  c.fillStyle = f.nose; c.fill(nose);
  c.save(); c.clip(nose); gradE(c, 126, -84, 14, 9, [[0, mixs(f.nose, f.deep, 0.45)], [1, css(f.nose, 0)]]); c.restore();
  c.fillStyle = css(f.glint, 0.85); c.fill(ell(127.5, -79, 3.6, 2.1, -0.3));
}
/** The eye ring's cream: the mask's own cream (the references: the "spectacles" are the muzzle's cream), so a lid laid
 * over the eye in it is the ring's colour. */
const ringCream = (f: FurPalette) => f.cream;
/** A blob on the head seen at a yaw: centred at longitude φ (deg) on radius r, `w` its half-size along the surface,
 * `d` how far it stands out (its half-width seen edge-on), `ry` its half-height. */
function blobT(G: FaceGeo, phi: number, r: number, y: number, w: number, d: number, ry: number): Path2D {
  const th = phi * D2R + G.yaw * D2R;
  return ell(G.cx + r * Math.sin(th), y, Math.hypot(w * Math.cos(th), d * Math.sin(th)), ry);
}
/** blobT's ellipse with soft points of fur on its arcs (the cheeks' edge, reference 01). */
function blobTuftT(G: FaceGeo, phi: number, r: number, y: number, w: number, d: number, ry: number, arcs: TuftArc[], depth = 0.12): Path2D {
  const th = phi * D2R + G.yaw * D2R;
  return tuftEll(G.cx + r * Math.sin(th), y, Math.hypot(w * Math.cos(th), d * Math.sin(th)), ry, arcs, depth);
}
/** A point on the face's front (longitude 0) seen at G's yaw: `u` along the surface across the face, on radius r. */
const frontT = (G: FaceGeo, u: number, r: number) => G.cx + r * Math.sin(G.yaw * D2R) + u * Math.cos(G.yaw * D2R);
/** The turned head's silhouette: the round skull, the CHEEK BULGES at the sides (their outer edges in small tufts of
 * fur, reference 01), the lower face, the snout (it leaves the skull's outline only near profile), the crown tuft. */
function headShapeT(G: FaceGeo, crown = true): Path2D {
  const kF = smootherstep(0, 0.5, G.ps);
  return union(
    ell(G.cx, -98, lerp(112, 104, G.ps), 100),
    blobTuftT(G, -80, 86, -62, 40, 42, 42, [[2.6, 3.3, 2, -1]], 0.16),
    // (the far cheek, turned away from the full front: smaller and pulled in behind the muzzle, so it never reads as a
    // second muzzle beside the nose; its points nearly smooth)
    blobTuftT(G, 80, 86 - 26 * kF, -62, 40 - 10 * kF, 42 - 12 * kF, 42 - 4 * kF, [[-0.16, 0.54, kF > 0.5 ? 1 : 2, 1]], 0.16 - 0.11 * kF),
    blobT(G, 0, 30, -38, 66, 40, 42),
    blobT(G, 0, 88, -64, 44, 36, 30),
    ...(crown ? [crownTuft(G.cx + FM.tuft.r * Math.sin(G.yaw * D2R), -192, lerp(1, 0.8, G.ps))] : []),
  );
}
/** The forehead's amber V coming down between the eye rings to a point above the nose (reference 01), seen at G's yaw. */
function vT(G: FaceGeo): Path2D {
  const P = (u: number, y: number, r = 100): Pt => [frontT(G, u, r), y];
  return smooth([P(-34, -160), P(-15, -128), P(-3, -96, 104), P(0, -89, 106), P(3, -96, 104), P(15, -128), P(34, -160)], true, 0.3);
}
/** The head turned toward us at G's yaw (reference 02 at 30, reference 01 at 0), its origin the neck. Its eyes,
 * lids, brows and mouth are parts of their own (placed by the rig); the mask (the "spectacles", the V, the muzzle)
 * and the nose are painted here. */
function paintHeadT(c: C2, f: FurPalette, G: FaceGeo, crown = true) {
  const head = headShapeT(G, crown), ps = G.ps, sY = Math.sin(G.yaw * D2R);
  c.fillStyle = f.shade; c.fill(head);
  c.save(); c.clip(head);
  // lit from above and from the side it faces: the brow gold, the base, the far side and the underside in shade
  volume(c, f, G.cx + 18 + 30 * ps, -156, 156, 142);
  // fur: a small fan of darker strokes on the forehead's middle under the crown, light ones on the lit brow
  const fx = frontT(G, 0, 70), k = lerp(1, 0.7, ps);
  strokes(c, css(f.shade, 0.36), [[fx - 3 * k, -184, 1.85, 20, 2.6], [fx + 2 * k, -186, 1.35, 18, 2.4], [fx - 10 * k, -178, 2.2, 13, 2.1], [fx + 9 * k, -179, 0.95, 13, 2.1]]);
  strokes(c, css(f.light, 0.55), [[fx + 26 * k + 8 * ps, -176, -0.25, 18, 2.6], [fx + 40 * k + 8 * ps, -164, -0.05, 15, 2.4], [fx - 34 * k, -172, -2.85, 14, 2.2]]);
  // the cream "spectacles": a tall egg round each eye that reaches up toward the brow and out toward the cheek, ONE
  // shape with the muzzle and the chin under them (its lower edge smooth), and the forehead's amber V cut down
  // between them to a point above the nose
  const rings = G.rings.filter((rg) => rg.vis > 0.02).map((rg) => ell(rg.x, rg.y, FM.ring.rx * rg.sx, FM.ring.ry));
  // (turned from the full front, the lower cream ends at the muzzle's far edge: past it the far cheek is fur, so it
  // reads as a cheek behind the muzzle, never a second muzzle beside the nose)
  const kF = smootherstep(0, 0.5, G.ps), lower = blobT(G, -6 * kF, 40, -38, 90 - 14 * kF, 60, 42);
  const mask = union(lower, blobT(G, 0, 100, -69, 38, 30, 22), blobT(G, 0, 96, -98, 52, 30, 24), ...rings);
  const notV = new Path2D(); notV.rect(-400, -400, 800, 800); notV.addPath(vT(G));
  c.save(); c.clip(notV, 'evenodd');
  c.fillStyle = f.cream; c.fill(mask);
  c.save(); c.clip(mask);
  // the cream's volume: the chin and the jaw's underside a soft step down; a little light on the muzzle's top
  gradE(c, G.cx + 20 * sY, 14, 120, 44, [[0, f.creamShade], [0.6, css(f.creamShade, 0.7)], [1, css(f.creamShade, 0)]]);
  gradE(c, frontT(G, 0, 100), -66, 34, 18, [[0, css(f.glint, 0.28)], [1, css(f.glint, 0)]]);
  c.restore();
  c.restore();
  c.restore();
  // the nose: a tiny dark oval between the eyes' lower edges, its glint
  const N = G.nose, kN = N.w / 30;
  const nose = smooth(([[-15, -7], [15, -7], [11, 5], [0, 10], [-11, 5]] as Pt[]).map(([x, y]) => [N.x + x * kN, N.y + y] as Pt), true, 0.8);
  c.fillStyle = f.nose; c.fill(nose);
  c.save(); c.clip(nose); gradE(c, N.x - 2 * kN, N.y - 7, 16 * kN, 9, [[0, mixs(f.nose, f.deep, 0.45)], [1, css(f.nose, 0)]]); c.restore();
  c.fillStyle = css(f.glint, 0.85); c.fill(ell(N.x + 5.5 * kN, N.y - 3.6, 4.6 * kN, 2.3));
}
/** The eye (reference 01, 02): a white eyeball, a big DARK BROWN iris toward the nose (+x) with a LIGHTER BROWN LOWER
 * RING and a dark heart, the white a step greyer under the upper lid, a THICK DARK UPPER LID LINE (thickest at the
 * top) and a thin line round the rest. Origin its centre; `I` the iris. */
function paintEyeBall(c: C2, f: FurPalette, rx: number, ry: number, I: { dx: number; dy: number; rx: number; ry: number }) {
  const eye = ell(0, 0, rx, ry);
  c.fillStyle = f.sclera; c.fill(eye);
  c.save(); c.clip(eye);
  gradL(c, 0, -ry, 0, -0.2 * ry, [[0, f.scleraShade], [1, css(f.scleraShade, 0)]]);
  const ir = ell(I.dx, I.dy, I.rx, I.ry);
  c.fillStyle = f.irisRing; c.fill(ir);
  c.save(); c.clip(ir);
  gradE(c, I.dx, I.dy + I.ry, I.rx * 1.1, I.ry * 0.55, [[0, mixs(f.irisRing, f.glint, 0.22)], [1, css(f.irisRing, 0)]]);
  c.fillStyle = f.iris; c.fill(ell(I.dx - 0.2, I.dy - 0.1 * I.ry, I.rx * 0.97, I.ry * 0.9));
  c.fillStyle = f.eye; c.fill(ell(I.dx + 0.3, I.dy - 0.16 * I.ry, I.rx * 0.8, I.ry * 0.76));
  c.restore();
  // the iris sits back under the lid: a soft shade over its top too
  gradL(c, 0, -ry, 0, -0.35 * ry, [[0, css(f.eye, 0.4)], [1, css(f.eye, 0)]]);
  c.restore();
  c.strokeStyle = f.lid; c.lineWidth = 1.5; c.stroke(eye);
  const lid = new Path2D();
  lid.ellipse(0, 0, rx + 0.9, ry + 0.9, 0, Math.PI, TAU);
  lid.ellipse(0, 0.1 * ry, rx - 0.5, 0.92 * ry, 0, TAU, Math.PI, true);
  lid.closePath();
  c.fillStyle = f.lid; c.fill(lid);
}
/** the profile eye's size (head units: a vertical oval, reference 05) and its iris, forward toward the nose */
const EYE_P = { rx: 26, ry: 37 }, IRIS_P = { dx: 4, dy: 2, rx: 21, ry: 31.5 };
/** the turned views' iris (toward the nose, a little low: the white shows as a crescent on the eye's outer side) */
const IRIS_T = { dx: 4.8, dy: 1.8, rx: 22, ry: 25.5 };
function paintEye(c: C2, f: FurPalette) {
  // origin: the eye's centre (facing right): the eyeball, its glints up and ahead (the profile has one eye: baked in)
  paintEyeBall(c, f, EYE_P.rx, EYE_P.ry, IRIS_P);
  c.fillStyle = f.glint; c.fill(ell(IRIS_P.dx + 7.5, IRIS_P.dy - 13, 6.6, 7.4));
  c.fillStyle = css(f.glint, 0.7); c.fill(ell(IRIS_P.dx - 7, IRIS_P.dy + 15, 2.8, 3.4));
}
/** The turned views' eye: the eyeball with its iris toward +x (the rig turns each eye's iris toward the nose). */
function paintEyeT(c: C2, f: FurPalette) { paintEyeBall(c, f, FM.eye.rx, FM.eye.ry, IRIS_T); }
/** The turned views' glints, origin the iris's centre: a large cream highlight up and toward the way the face looks,
 * a small one low on the other side (reference 01, 02). */
function paintGlintT(c: C2, f: FurPalette) {
  c.fillStyle = f.glint; c.fill(ell(7, -9.5, 7, 7.4));
  c.fillStyle = css(f.glint, 0.7); c.fill(ell(-7.5, 10.5, 3.2, 2.9));
}
/** The lash (reference 02, 07, 08: a small flick at the eye's outer corner), origin where the upper lid's line ends,
 * pointing out (+x) and up. */
function paintLash(c: C2, f: FurPalette) {
  const p = new Path2D();
  p.moveTo(-3.5, -1.9); p.quadraticCurveTo(4.5, -2.4, 9.6, -8.4); p.quadraticCurveTo(6.8, -1.2, -2.5, 2.2); p.closePath();
  c.fillStyle = f.lid; c.fill(p);
}
/** A brow (reference 02, 05, 07, 08: a small dark arc above the eye's cream ring), origin its middle, ±15 long. */
function paintBrow(c: C2, f: FurPalette) {
  const p = new Path2D();
  p.moveTo(-15, 2.4); p.quadraticCurveTo(0, -9.6, 15, 1.2); p.quadraticCurveTo(0, -1.4, -15, 2.4); p.closePath();
  c.fillStyle = mixs(f.lid, f.deep, 0.3); c.fill(p);
}
/** An upper lid, its origin the middle of its lower edge: the top half of a disc (radius 30) in the ring's cream; the
 * rig scales it to span the eye's top down to the lid's edge. */
function paintLidU(c: C2, col: string) {
  const p = new Path2D(); p.ellipse(0, 0, 30, 30, 0, Math.PI, TAU); p.closePath();
  c.fillStyle = col; c.fill(p);
}
/** The profile's upper lid for a worried or sad look (the lids' inner corners up) ARCHES: its edge rises toward the
 * brow in the middle, so the eye keeps a round top that droops toward the back, a lifted brow, never the wedge a
 * straight slanted edge cuts (side-on that reads as a glare). The rig builds it from the straight lid, its edge raised
 * to the arch's top, and these HORNS under it (origin the middle of the chord between the arch's ends, ±30 wide): the
 * region between that chord's level raised by ARCH_HB and an arc from end to end peaking there, scaled to the arch's
 * height (the arch stays the same height however deep the lid is). */
const ARCH_HB = 10;
function paintLidHorns(c: C2, col: string) {
  const p = new Path2D(); p.moveTo(-30, 0); p.quadraticCurveTo(0, -2 * ARCH_HB, 30, 0); p.lineTo(30, -ARCH_HB - 1.5); p.lineTo(-30, -ARCH_HB - 1.5); p.closePath();
  c.fillStyle = col; c.fill(p);
}
/** the arch's height (head units) at full weight */
const ARCH_H = 11;
/** A lower lid, its origin the ends of its upper edge: the edge an arch rising 12 (so the raised lid leaves a crescent
 * eye), the bottom half of a disc below. */
function paintLidL(c: C2, col: string) {
  const p = new Path2D(); p.moveTo(-30, 0); p.quadraticCurveTo(0, -24, 30, 0); p.ellipse(0, 0, 30, 30, 0, 0, Math.PI); p.closePath();
  c.fillStyle = col; c.fill(p);
}
/** A lid's edge line (a bar, origin its centre, ±29): the eye's THICK DARK upper lid line carried down with the lid. */
function paintLidLine(c: C2, f: FurPalette) {
  c.strokeStyle = f.lid; c.lineWidth = 3.4; c.lineCap = 'round';
  c.beginPath(); c.moveTo(-29, 0); c.lineTo(29, 0); c.stroke();
}
function paintMouth(c: C2, f: FurPalette) {
  c.fillStyle = f.mouthIn;
  c.fill(smooth([[-14, -6], [4, -8], [14, -2], [8, 10], [-6, 12], [-14, 4]], true, 0.6));
  c.fillStyle = css(f.inner, 0.95);
  c.fill(ell(0, 6, 7, 4, 0));
}
/** The profile's closed mouths, their origin the nose's lower front (SK.lip): a THIN curve under the nose, its end
 * a little upturned (reference 05), and its variations (the corner up in a smile, straight, wavy, down in a frown). */
type MouthKey = 'w' | 'smile' | 'flat' | 'wavy' | 'frown';
const MOUTHS: MouthKey[] = ['w', 'smile', 'flat', 'wavy', 'frown'];
function paintMouthP(c: C2, f: FurPalette, k: MouthKey) {
  c.strokeStyle = f.nose; c.lineWidth = 2.5; c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath(); c.moveTo(0, 0);
  if (k === 'w') { c.quadraticCurveTo(-2, 10, -11, 12); c.quadraticCurveTo(-15, 12, -17, 9.5); }
  else if (k === 'smile') { c.quadraticCurveTo(-2, 11, -11, 12.5); c.quadraticCurveTo(-18, 12.5, -22, 6); }
  else if (k === 'flat') { c.quadraticCurveTo(-1, 9, -5, 11); c.lineTo(-17, 11.5); }
  else if (k === 'wavy') {
    // side-on a wavy line doesn't read: the worried mouth is the lips just parted, the corner pulled down and back
    c.quadraticCurveTo(-1, 8, -2.5, 10); c.stroke();
    const m = new Path2D(); m.moveTo(-1.5, 9.5); m.bezierCurveTo(-7, 8.5, -12.5, 10.5, -17, 15.5); m.quadraticCurveTo(-19.5, 19.5, -15.5, 18.5);
    m.bezierCurveTo(-11.5, 16.5, -7, 15.5, -2.5, 14.5); m.closePath();
    c.fillStyle = f.mouthIn; c.fill(m);
    c.save(); c.clip(m); c.fillStyle = css(f.inner, 0.9); c.fill(ell(-7, 15.5, 5, 2.6, -0.25)); c.restore();
    c.lineWidth = 2; c.stroke(m);
    return;
  }
  else { c.quadraticCurveTo(-2, 10, -8, 12); c.quadraticCurveTo(-14, 13, -18, 19); }
  c.stroke();
}
/** The turned views' closed mouths (reference 01, 02), their origin the middle of the lips: a thin philtrum from the
 * nose down and a thin curved smile, its ends a little upturned (the neutral), a bigger one, a flat line, the wavy
 * worried line, a frown. */
function paintMouthT(c: C2, f: FurPalette, k: MouthKey) {
  c.strokeStyle = f.nose; c.lineWidth = 2.6; c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath(); c.moveTo(0, -10); c.lineTo(0, k === 'frown' ? 1 : 0);
  if (k === 'w') { c.moveTo(0, 0); c.bezierCurveTo(-3, 7.5, -15, 8.5, -21, -1); c.moveTo(0, 0); c.bezierCurveTo(3, 7.5, 15, 8.5, 21, -1); }
  else if (k === 'smile') { c.moveTo(0, 0); c.bezierCurveTo(-4, 10, -20, 12, -27, -5); c.moveTo(0, 0); c.bezierCurveTo(4, 10, 20, 12, 27, -5); }
  else if (k === 'flat') { c.moveTo(-14, 1.5); c.quadraticCurveTo(0, 2.5, 14, 1.5); }
  else if (k === 'wavy') { c.moveTo(-17, 3); c.bezierCurveTo(-13, -2, -9, -2, -5.5, 2.5); c.bezierCurveTo(-2, 7, 2, 7, 5.5, 2.5); c.bezierCurveTo(9, -2, 13, -2, 17, 3); }
  else { c.moveTo(-16, 9); c.quadraticCurveTo(0, -4, 16, 9); }
  c.stroke();
}
/** The turned views' open mouths, origin the middle of the lips: a grin (a D under the philtrum, its inside dark with
 * the tongue: reference 08's coral squirrel) and a round 'o'. */
function paintOpenT(c: C2, f: FurPalette, round: boolean) {
  c.strokeStyle = f.nose; c.lineWidth = 2.6; c.lineCap = 'round';
  c.beginPath(); c.moveTo(0, -10); c.lineTo(0, -2); c.stroke();
  const m = round ? ell(0, 7, 9, 11) : (() => { const p = new Path2D(); p.moveTo(-22, -3); p.quadraticCurveTo(0, 3, 22, -3); p.bezierCurveTo(20, 20, -20, 20, -22, -3); p.closePath(); return p; })();
  c.fillStyle = f.mouthIn; c.fill(m);
  c.save(); c.clip(m); c.fillStyle = f.inner; c.fill(round ? ell(0, 15, 7, 5) : ell(0, 16, 12, 6)); c.restore();
}
/** The cheek's blush (reference 07, 08): a soft rosy oval. */
function paintBlush(c: C2, f: FurPalette) { gradE(c, 0, 0, 16, 9.5, [[0, f.blush], [0.6, css(f.blush, 0.85)], [1, css(f.blush, 0)]]); }
/** An ear, its origin the base, pointing up (references 01-08): TALL and upright with a slightly pointed tip and a
 * small tuft of fur on it; its back in the fur with a light rim on the outer edge (−x), the inner ear a DARKER warm
 * rust with a darker fold toward the head (+x) and a softer rosy base. `far`: the one behind (profile). */
const EAR_OUT: Pt[] = [[-32, 8], [-39, -24], [-36, -60], [-25, -90], [-9, -108], [4, -106], [21, -84], [33, -48], [35, -10], [30, 8]];
const EAR_IN: Pt[] = [[-18, 0], [-24, -26], [-22, -58], [-13, -84], [-4, -95], [7, -86], [16, -58], [20, -28], [16, 0]];
const earTuft = () => smooth([[-11, -101], [-9.5, -110], [-5, -106], [-2.5, -114], [1.5, -106], [5.5, -109], [6, -99]], true, 0.45);
function paintEar(c: C2, f: FurPalette, far: boolean) {
  const outer = union(smooth(EAR_OUT, true, 0.5), earTuft()), inner = smooth(EAR_IN, true, 0.5);
  if (far) { c.fillStyle = mixs(f.shade, f.deep, 0.2); c.fill(outer); c.fillStyle = mixs(f.earFold, f.ear, 0.35); c.fill(inner); return; }
  c.fillStyle = f.light; c.fill(outer);
  c.save(); c.clip(outer);
  // the back of the ear: the light rim left along its outer edge and over the tip, the base, darker toward the root
  c.fillStyle = f.base; c.fill(smooth(EAR_OUT.map(([x, y]) => [x * 0.88 + 3, y * 0.95 + 2] as Pt), true, 0.5));
  gradL(c, 0, -20, 0, 10, [[0, css(f.shade, 0)], [1, css(f.shade, 0.8)]]);
  c.restore();
  c.fillStyle = f.ear; c.fill(inner);
  c.save(); c.clip(inner);
  gradL(c, 0, -100, 0, 2, [[0, css(f.earFold, 0.55)], [0.55, css(f.ear, 0)], [1, css(mixs(f.ear, f.blush, 0.45), 0.85)]]);
  c.fillStyle = f.earFold; c.fill(smooth([[16, 0], [20, -28], [16, -58], [7, -84], [5, -60], [6, -30], [3, 0]], true, 0.5));
  c.restore();
}
/** The crown tuft: three small flames on the crown, origin their root, pointing up (lit from the top). */
function paintTuft(c: C2, f: FurPalette) {
  const t = smooth([[-16, 6], [-20, -14], [-12, -40], [-6, -22], [0, -54], [6, -26], [16, -46], [16, -16], [14, 6]], true, 0.35);
  c.fillStyle = f.base; c.fill(t);
  c.save(); c.clip(t); gradL(c, 0, -54, 0, 8, [[0, f.light], [0.6, css(f.light, 0)], [1, css(f.shade, 0.5)]]); c.restore();
  c.fillStyle = css(f.light, 0.8);
  c.fill(smooth([[-2, 0], [-2, -18], [0, -44], [4, -20], [6, 0]], true, 0.4));
}
/** The body from the side (facing right), its origin the seat point: a chubby pear, the long cream belly. */
function bodyShape(slim: number): Path2D {
  const s = (p: Pt): Pt => [p[0] * slim, p[1]];
  return smooth(([
    [-92, -40], [-96, -112], [-80, -172], [-46, -216], [0, -238], [44, -236], [76, -210], [94, -160], [100, -100], [100, -44],
    [82, -6], [34, 10], [-34, 12], [-76, -8],
  ] as Pt[]).map(s), true, 0.5);
}
function paintBody(c: C2, f: FurPalette, slim: number) {
  const body = bodyShape(slim);
  c.fillStyle = f.shade; c.fill(body);
  c.save(); c.clip(body);
  volume(c, f, 34 * slim, -176, 130 * slim, 160, 0.8);
  strokes(c, css(f.shade, 0.4), [[-74 * slim, -150, 1.9, 16, 2.4], [-82 * slim, -116, 1.75, 14, 2.2]]);
  const belly = smooth(([[14, -246], [62, -234], [90, -170], [98, -100], [94, -40], [70, -2], [40, -24], [24, -100], [6, -196]] as Pt[]).map(([x, y]) => [x * slim, y] as Pt), true, 0.5);
  c.fillStyle = f.cream; c.fill(belly);
  c.save(); c.clip(belly);
  gradE(c, 70 * slim, -170, 40 * slim, 70, [[0, css(f.glint, 0.3)], [1, css(f.glint, 0)]]);
  gradE(c, 86 * slim, 6, 74 * slim, 70, [[0, f.creamShade], [0.55, css(f.creamShade, 0.8)], [1, css(f.creamShade, 0)]]);
  c.restore();
  c.restore();
}
/** The body from behind, three-quarter (facing right: the head turns right), its origin the seat point: the round
 * back, the wide rump on the seat. */
function backShape(slim: number): Path2D {
  const s = (p: Pt): Pt => [p[0] * slim, p[1]];
  return union(smooth(([
    [-104, -40], [-110, -124], [-90, -192], [-44, -238], [18, -252], [74, -234], [104, -184], [114, -112], [112, -46], [92, -4],
    [30, 12], [-44, 12], [-92, -2],
  ] as Pt[]).map(s), true, 0.5), ell(-6 * slim, -22, 112 * slim, 28));
}
function paintBack(c: C2, f: FurPalette, slim: number) {
  const body = backShape(slim);
  // lit from the front-right (the screen, the lamp): the left side and the rump in a soft broad shadow
  c.fillStyle = f.shade; c.fill(body);
  c.save(); c.clip(body);
  volume(c, f, 58 * slim, -184, 140 * slim, 160, 0.85);
  // the far shoulder's roundness, the fur along the spine
  gradE(c, 88 * slim, -190, 34 * slim, 48, [[0, css(f.light, 0.75)], [1, css(f.light, 0)]], -0.5);
  strokes(c, css(f.shade, 0.4), [[-8 * slim, -228, 1.75, 18, 2.6], [-24 * slim, -196, 1.85, 16, 2.4], [-40 * slim, -160, 1.95, 14, 2.2]]);
  c.restore();
}
/** The body from the front (reference 01), its origin the seat point: a pear, narrow at the shoulders and wide at the
 * haunches, the LONG cream belly from the chest down between the legs. */
function frontShape(slim: number): Path2D {
  return smooth(([
    [0, -236], [50, -226], [78, -188], [90, -134], [98, -80], [96, -34], [76, -4], [36, 10], [-36, 10], [-76, -4], [-96, -34],
    [-98, -80], [-90, -134], [-78, -188], [-50, -226],
  ] as Pt[]).map(([x, y]) => [x * slim, y] as Pt), true, 0.5);
}
function paintFront(c: C2, f: FurPalette, slim: number) {
  const body = frontShape(slim);
  c.fillStyle = f.shade; c.fill(body);
  c.save(); c.clip(body);
  volume(c, f, 20 * slim, -176, 128 * slim, 168, 0.85);
  const belly = smooth(([[0, -230], [34, -214], [52, -160], [58, -96], [52, -36], [30, 4], [0, 12], [-30, 4], [-52, -36], [-58, -96], [-52, -160], [-34, -214]] as Pt[]).map(([x, y]) => [x * slim, y] as Pt), true, 0.5);
  c.fillStyle = f.cream; c.fill(belly);
  c.save(); c.clip(belly);
  gradE(c, 10 * slim, -150, 50 * slim, 90, [[0, css(f.glint, 0.32)], [1, css(f.glint, 0)]]);
  gradE(c, -66 * slim, -40, 52 * slim, 120, [[0, f.creamShade], [0.6, css(f.creamShade, 0.7)], [1, css(f.creamShade, 0)]]);
  gradL(c, 0, -60, 0, 12, [[0, css(f.creamShade, 0)], [1, css(f.creamShade, 0.55)]]);
  c.restore();
  // the chest: two small points of fur into the cream under the chin
  c.fillStyle = mixs(f.base, f.light, 0.25);
  c.fill(smooth(([[-30, -232], [-18, -232], [-10, -214], [-16, -222], [-24, -208], [-26, -222]] as Pt[]).map(([x, y]) => [x * slim, y] as Pt), true, 0.3));
  c.fill(smooth(([[30, -232], [18, -232], [10, -214], [16, -222], [24, -208], [26, -222]] as Pt[]).map(([x, y]) => [x * slim, y] as Pt), true, 0.3));
  c.restore();
}
/** A disc of the arm's tube (radius 44, scaled per frame): the shade one and the lit one. */
const DISC_R = 44;
function paintDisc(c: C2, col: string) { c.fillStyle = col; c.fill(ell(0, 0, DISC_R, DISC_R)); }
/** A forepaw (origin the wrist, a small mitten along +x): soft volume, the fingers' notches (reference 01: three short
 * dark lines at its tip); pointing, the index out. */
function paintPaw(c: C2, f: FurPalette, pointing: boolean) {
  const paw = union(ell(18, 0, 25, 21, 0), pointing ? smooth([[24, -14], [52, -16], [62, -8], [52, -1], [26, 4]], true, 0.5) : new Path2D());
  c.fillStyle = f.shade; c.fill(paw);
  c.save(); c.clip(paw); gradE(c, 20, -10, 34, 26, [[0, mixs(f.base, f.light, 0.35)], [0.55, f.base], [1, css(f.base, 0)]]); c.restore();
  if (!pointing) {
    c.strokeStyle = mixs(f.deep, f.lid, 0.3); c.lineWidth = 2.2; c.lineCap = 'round';
    for (const y of [-9, -1, 7]) { c.beginPath(); c.moveTo(33, y); c.lineTo(41.5, y + 0.6); c.stroke(); }
  }
}
/** The haunch from the side (origin the hip joint): big and round, lit high and ahead, its shadow a soft crescent low
 * and behind. */
function paintThigh(c: C2, f: FurPalette) {
  const h = ell(10, 12, 66, 60, -0.1);
  c.fillStyle = f.shade; c.fill(h);
  c.save(); c.clip(h); volume(c, f, 30, -18, 76, 70, 0.7); c.restore();
}
/** A haunch from the front (reference 01), origin the hip: round, lit high, its shadow low on the side away from the
 * light, a soft crease where it meets the belly. */
function paintThighFront(c: C2, f: FurPalette) {
  const h = ell(0, 0, 50, 62);
  c.fillStyle = f.shade; c.fill(h);
  c.save(); c.clip(h); volume(c, f, 10, -26, 56, 70, 0.7); c.restore();
}
/** A hind foot from the side (origin the heel; the foot along +x, its sole at y = +18): broad, three short toe lines. */
function paintFoot(c: C2, f: FurPalette) {
  const foot = smooth([[-16, 6], [-8, -12], [30, -16], [68, -12], [86, 2], [78, 16], [30, 18], [-10, 18]], true, 0.5);
  c.fillStyle = f.shade; c.fill(foot);
  c.save(); c.clip(foot); gradE(c, 40, -14, 60, 20, [[0, mixs(f.base, f.light, 0.3)], [0.6, f.base], [1, css(f.base, 0)]]); c.restore();
  c.strokeStyle = mixs(f.deep, f.lid, 0.3); c.lineWidth = 2.2; c.lineCap = 'round';
  for (const x of [60, 68, 76]) { c.beginPath(); c.moveTo(x, 5); c.lineTo(x + 3.5, 14); c.stroke(); }
}
/** A hind foot from the front (reference 01), origin the middle of its sole: a BROAD round mitten toward us, three
 * short toe lines. */
function paintFootFront(c: C2, f: FurPalette) {
  const foot = smooth([[-44, 0], [-46, -16], [-31, -33], [0, -37], [31, -33], [46, -16], [44, 0]], true, 0.55);
  c.fillStyle = f.shade; c.fill(foot);
  c.save(); c.clip(foot); gradE(c, 4, -30, 50, 26, [[0, mixs(f.base, f.light, 0.35)], [0.6, f.base], [1, css(f.base, 0)]]); c.restore();
  c.strokeStyle = mixs(f.deep, f.lid, 0.3); c.lineWidth = 2.4; c.lineCap = 'round';
  for (const x of [-15, 0, 15]) { c.beginPath(); c.moveTo(x, -12); c.lineTo(x * 1.06, -2); c.stroke(); }
}

// The tail (reference 01, 02, 07, 08): ENORMOUS, a broad C rising behind the body that rivals the torso,
// a thick tube whose spine climbs from the root tucked into the haunch up the body's back (so the near side hugs the
// back: no gap), over the top (its top at the head's), down the far side and curls inward into a spiral at the far
// side, its tip coiled at the centre. Its root is the old one (drawn behind the haunch, so it never reaches the floor
// like another foot) and it still moves as ONE rounded form (the sway turns it about the root, the curl breathes it).
//   back (seated, three-quarter from behind): the neck rises straight up behind the back, hidden by it, and the plume
//     overlaps the back's far side and the back of the head, its top at the ears' base.
//   front: the side tail, its root behind the far haunch, the plume rising beside the body.
// The silhouette is the union of discs along a spine (each knot its own radius): one smooth big C, no fur flicks on
// its edge. Painted (the tail fix after the second pass's busy straw of fine strands and soft strokes) as
// FEW, BROAD, CRISP NESTED BANDS that run ALONG its length (reference 01, 02, 07, 08): a handful of long flames
// (tailBands), each an offset band of the spine with clean hard edges and a smooth gradient inside it (a blurred
// shade clipped to the band), light and dark by turns, drifting across the tube as they climb; the curl's inside ONE
// clean darker curl (the core: a crisp shape, darkest right under the tongue's edge), round which the coil's outside
// (the tongue) narrows and its tip curls in as a medium crescent; a few fine light strands just inside the outer edge;
// the root a step darker, the plume's top catching the light.
interface TailDef { spine: Pt[]; r: number[]; c: Pt }
const TAIL_DEF: Record<'side' | 'back', TailDef> = {
  side: {
    // (the tail fix: the neck's knots 2-5 nearer the body and a little broader, so the C rises steeply
    // from the root, as reference 01, 02, 07, 08 do; the root, the plume, the curl and the bake box are as they were)
    spine: [[0, 0], [-16, -38], [-37, -88], [-54, -138], [-66, -190], [-84, -240], [-108, -288], [-142, -316], [-192, -320], [-238, -294], [-258, -250], [-246, -204], [-212, -178], [-172, -182], [-146, -208], [-148, -242], [-172, -258], [-196, -248], [-202, -226]],
    r: [44, 66, 88, 99, 98, 86, 74, 68, 62, 56, 52, 48, 44, 40, 34, 28, 22, 16, 11],
    c: [-174, -226],
  },
  back: {
    spine: [[0, 0], [-6, -44], [-6, -94], [0, -144], [8, -196], [12, -246], [0, -300], [-44, -328], [-92, -316], [-114, -276], [-100, -232], [-62, -210], [-30, -222], [-22, -254], [-38, -280], [-62, -282], [-70, -262]],
    r: [44, 56, 62, 64, 64, 62, 60, 56, 56, 54, 50, 44, 38, 30, 23, 17, 11],
    c: [-50, -256],
  },
};
/** where the neck ends and the curl's coil starts (u: the knot index ÷ the last one) */
const TAIL_U = { side: { neck: 6 / 18, coil: 12.5 / 18 }, back: { neck: 5 / 16, coil: 11 / 16 } };
interface TailSample { x: number; y: number; r: number; u: number; nx: number; ny: number }
function tailSamples(d: TailDef, n = 200): TailSample[] {
  // Catmull-Rom through the spine (and its radii), resampled by arc length
  const N = d.spine.length, Q = (i: number) => d.spine[clamp(i, 0, N - 1)]!, RQ = (i: number) => d.r[clamp(i, 0, N - 1)]!;
  const cr = (a: number, b: number, c2: number, e: number, u: number) => 0.5 * (2 * b + (-a + c2) * u + (2 * a - 5 * b + 4 * c2 - e) * u * u + (-a + 3 * b - 3 * c2 + e) * u * u * u);
  const pts: { p: Pt; r: number; kp: number }[] = [];
  for (let s = 0; s < N - 1; s++) for (let j = 0; j < 16; j++) {
    const u = j / 16, p0 = Q(s - 1), p1 = Q(s), p2 = Q(s + 1), p3 = Q(s + 2);
    pts.push({ p: [cr(p0[0], p1[0], p2[0], p3[0], u), cr(p0[1], p1[1], p2[1], p3[1], u)], r: lerp(RQ(s), RQ(s + 1), smootherstep(0, 1, u)), kp: s + u });
  }
  pts.push({ p: d.spine[N - 1]!, r: d.r[N - 1]!, kp: N - 1 });
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1]! + Math.hypot(pts[i]!.p[0] - pts[i - 1]!.p[0], pts[i]!.p[1] - pts[i - 1]!.p[1]));
  const total = L[L.length - 1]!, out: TailSample[] = [];
  let j = 0;
  for (let i = 0; i <= n; i++) {
    const s = (total * i) / n;
    while (j < L.length - 2 && L[j + 1]! < s) j++;
    const k = clamp((s - L[j]!) / Math.max(1e-6, L[j + 1]! - L[j]!), 0, 1), a = pts[j]!, b = pts[j + 1]!;
    const x = lerp(a.p[0], b.p[0], k), y = lerp(a.p[1], b.p[1], k), tx = b.p[0] - a.p[0], ty = b.p[1] - a.p[1], m = Math.hypot(tx, ty) || 1;
    // the inside: the normal that faces the plume's centre
    let nx = -ty / m, ny = tx / m;
    if (nx * (d.c[0] - x) + ny * (d.c[1] - y) < 0) { nx = -nx; ny = -ny; }
    out.push({ x, y, r: lerp(a.r, b.r, k), u: lerp(a.kp, b.kp, k) / (N - 1), nx, ny });
  }
  return out;
}
const TAILS = { side: tailSamples(TAIL_DEF.side), back: tailSamples(TAIL_DEF.back) };
/** the plume's radius about TAIL_DEF[v].c (rig units; measured on the spines: the outer knots' distance plus radius) */
const PLUME_R = { side: 150, back: 118 };
/** A tail's bounds (rig units, origin its root). */
function tailBox(T: TailSample[]) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of T) { x0 = Math.min(x0, s.x - s.r); x1 = Math.max(x1, s.x + s.r); y0 = Math.min(y0, s.y - s.r); y1 = Math.max(y1, s.y + s.r); }
  return { x0: Math.floor(x0) - 6, x1: Math.ceil(x1) + 6, y0: Math.floor(y0) - 6, y1: Math.ceil(y1) + 6 };
}
/** the tail's top (rig units from its root), for joints().tailTop */
const tailTop = (v: 'side' | 'back'): Pt => [TAIL_DEF[v].c[0], Math.min(...TAILS[v].map((s) => s.y - s.r))];
/** The tail's colours: a FUR key, or a mix of two (k toward the second). */
type TailCol = (f: FurPalette) => string;
type TailKey = 'tailOuter' | 'tailAmber' | 'tailOrange' | 'tailCore' | 'tailStrand';
const tc = (a: TailKey, b: TailKey = a, k = 0): TailCol => (f) => (k ? mixs(f[a], f[b], k) : f[a]);
/** A band of the tail (reference 01, 02, 07, 08): ONE long flame along the length with clean hard edges, shading
 * SMOOTHLY across its width from `col` on its outer side to `shade` on its inner side (a soft gradient inside, clipped
 * to the band, so the edges stay crisp). u: its length (its ends pointed; past 0 or 1 the tube cuts it); o: its middle
 * drifting across the tube from the first to the second (o: −1 the curve's outside … +1 its inside), so the bands
 * sweep diagonally across the tube like flames; w its half-width (of the radius); pw how its ends taper (lower:
 * blunter). */
interface TailBand { u: [number, number]; o: [number, number]; w: number; col: TailCol; shade: TailCol; pw?: number }
/** The bands, painted in order (a later one lies over an earlier one), by where the curl starts (cu), FEW and BROAD,
 * light and dark by turns (reference 02): (in profile the neck's outside lies against the body, its inside is the
 * far edge we see; over the plume the outside is its top)
 *   the near side of the neck in the body's shadow, ending as the plume begins;
 *   the gold outside over the plume's top and down its far side;
 *   an orange flame up the middle of the neck (beside the body, from the front too) and over the plume into the curl,
 *     where it is the band between the tongue and the core;
 *   the neck's far edge lit, ending at the plume;
 *   the burnt inside of the plume, the shadow round the curl, ending under the curl's start;
 *   the curl's tip, a medium tone (reference 02, 07, 08: the tip a crescent curling into the dark core; the core
 *     itself, coreEdge below, is painted over the bands in each pass). */
const tailBands = (cu: number): TailBand[] => [
  { u: [-0.22, 0.44], o: [-0.82, -1.0], w: 0.46, col: tc('tailOrange', 'tailCore', 0.42), shade: tc('tailOrange', 'tailAmber', 0.2), pw: 0.6 },
  { u: [0.2, cu + 0.12], o: [-1.15, -1.1], w: 0.6, col: tc('tailOuter'), shade: tc('tailOuter', 'tailAmber', 0.5), pw: 0.6 },
  { u: [-0.04, cu + 0.2], o: [0.1, 0.04], w: 0.34, col: tc('tailOrange'), shade: tc('tailOrange', 'tailCore', 0.45), pw: 0.6 },
  { u: [-0.22, 0.5], o: [0.74, 0.64], w: 0.3, col: tc('tailAmber'), shade: tc('tailAmber', 'tailOuter', 0.45), pw: 0.7 },
  { u: [0.3, cu + 0.08], o: [1.05, 0.5], w: 0.52, col: tc('tailOrange', 'tailCore', 0.6), shade: tc('tailCore'), pw: 0.5 },
  { u: [0.8, 1.25], o: [-0.75, -0.7], w: 0.5, col: tc('tailOrange', 'tailAmber', 0.45), shade: tc('tailOrange', 'tailCore', 0.15), pw: 0.5 },
];
/** The curl's core (reference 02, 07, 08): the coil's inside from this edge (o, by u) inward, widening toward the tip,
 * so the coil's outside (the tongue) narrows as it curls in and ends as the tip, a medium crescent in the dark */
const coreEdge = (cu: number) => (u: number) => (u < 0.8 ? lerp(1.15, 0.42, smootherstep(cu - 0.04, 0.8, u)) : lerp(0.42, -0.3, smootherstep(0.8, 1, u)));
function paintTail(c: C2, f: FurPalette, view: 'side' | 'back') {
  const T = TAILS[view], U = TAIL_U[view], C = TAIL_DEF[view].c, seed = view === 'side' ? 31 : 37, N = T.length;
  // the inside's normal, the same side all along (the tail turns one way, its inside on its left as it goes: a
  // normal that never flips, so the bands are clean offset curves of the spine)
  const nrm = T.map((_, i) => { const a = T[Math.max(0, i - 2)]!, b = T[Math.min(N - 1, i + 2)]!, tx = b.x - a.x, ty = b.y - a.y, m = Math.hypot(tx, ty) || 1; return [ty / m, -tx / m] as Pt; });
  const off = (i: number, o: number): Pt => { const s = T[i]!, n = nrm[i]!; return [s.x + n[0] * s.r * o, s.y + n[1] * s.r * o]; };
  const range = (u0: number, u1: number) => T.map((_, i) => i).filter((i) => T[i]!.u >= u0 && T[i]!.u <= u1);
  /** the discs of the samples from u0 to u1 (the tube's silhouette), each r·rk·g(u) */
  const discs = (rk: number, u0 = 0, u1 = 1, g: (u: number) => number = () => 1) => {
    const p = new Path2D();
    for (const i of range(u0, u1)) { const s = T[i]!, r = s.r * rk * g(s.u); if (r > 0.5) { p.moveTo(s.x + r, s.y); p.arc(s.x, s.y, r, 0, TAU); } }
    return p;
  };
  /** a swept shape along the length between the offset curves lo(u) and hi(u), from u0 to u1 (both kept within
   * ±1.15 of the radius: further out, round the curl's tight centre, an offset curve folds over itself); at the tip
   * and the root it runs on past the last sample along the tangent, over the round cap of the end disc */
  const sweep = (lo: (u: number) => number, hi: (u: number) => number, u0: number, u1: number) => {
    const idx = range(u0, u1), p = new Path2D(), cl = (o: number) => clamp(o, -1.15, 1.15);
    if (idx.length < 2) return p;
    const pt = (i: number, o: number, ext: number): Pt => { const q = off(i, o), n = nrm[i]!, r = T[i]!.r * ext; return [q[0] - n[1] * r, q[1] + n[0] * r]; };
    const ext = (i: number) => (i === N - 1 ? 1.05 : i === 0 ? -1.05 : 0);
    const a = idx[0]!, z = idx[idx.length - 1]!;
    const lo0 = cl(lo(T[a]!.u)), hi0 = cl(hi(T[a]!.u)), loZ = cl(lo(T[z]!.u)), hiZ = cl(hi(T[z]!.u));
    if (ext(a)) { const q = pt(a, lo0, ext(a)); p.moveTo(q[0], q[1]); }
    idx.forEach((i, k) => { const q = off(i, cl(lo(T[i]!.u))); if (k || ext(a)) p.lineTo(q[0], q[1]); else p.moveTo(q[0], q[1]); });
    if (ext(z)) { const q1 = pt(z, loZ, ext(z)), q2 = pt(z, hiZ, ext(z)); p.lineTo(q1[0], q1[1]); p.lineTo(q2[0], q2[1]); }
    for (let k = idx.length - 1; k >= 0; k--) { const q = off(idx[k]!, cl(hi(T[idx[k]!]!.u))); p.lineTo(q[0], q[1]); }
    if (ext(a)) { const q = pt(a, hi0, ext(a)); p.lineTo(q[0], q[1]); }
    p.closePath();
    return p;
  };
  // a soft fill (the gradients inside the bands): a canvas filter's blur is in texels, whatever the transform
  const m = c.getTransform(), px = Math.hypot(m.a, m.b);
  const soft = (r: number, draw: () => void) => { c.save(); c.filter = `blur(${Math.max(0.4, r * px).toFixed(2)}px)`; draw(); c.restore(); };
  const bands = tailBands(U.coil);
  /** the bands over u0 … u1 (a pass's stretch), each crisp, its gradient soft by `bl` rig units */
  const paintBands = (u0: number, u1: number, bl: number) => {
    for (const b of bands) {
      const [ba, bb] = b.u, lo = Math.max(ba, u0), hi = Math.min(bb, u1);
      if (hi - lo < 0.01) continue;
      const mid = (u: number) => lerp(b.o[0], b.o[1], smootherstep(ba, bb, u));
      const hw = (u: number) => b.w * Math.pow(Math.sin(Math.PI * clamp((u - ba) / (bb - ba))), b.pw ?? 0.7);
      const path = sweep((u) => mid(u) - hw(u), (u) => mid(u) + hw(u), lo, hi);
      c.fillStyle = b.col(f); c.fill(path, 'nonzero');
      c.save(); c.clip(path, 'nonzero');
      // the shade over the band's inner part; its own stretch runs past the pass's, so its blur never fades at a
      // pass's end (no seam where the curl's first discs lie over the wrap)
      soft(bl, () => { c.fillStyle = b.shade(f); c.fill(sweep((u) => mid(u) - 0.05 * hw(u), (u) => mid(u) + hw(u) + 0.3, Math.max(ba, u0 - 0.08), Math.min(bb, u1 + 0.08)), 'nonzero'); });
      c.restore();
    }
  };
  /** a few fine light strands just inside the outer edge (reference 01: a little texture there, never noisy) */
  const strands = (u0: number, u1: number, n: number, sd: number) => {
    c.lineCap = 'round'; c.strokeStyle = css(f.tailStrand, 0.32);
    for (let i = 0; i < n; i++) {
      const a = lerp(u0, u1, (i + 0.2 + 0.6 * hash(sd, i, 1)) / n), len = 0.05 + 0.05 * hash(sd, i, 2), o = -0.9 + 0.2 * hash(sd, i, 3);
      const idx = range(a, Math.min(u1, a + len));
      if (idx.length < 4) continue;
      c.lineWidth = 0.8 + 0.5 * hash(sd, i, 4);
      c.beginPath();
      idx.forEach((j, k) => { const t = k / (idx.length - 1), q = off(j, o + 0.06 * t * t); if (k) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); });
      c.stroke();
    }
  };
  const cu = U.coil, rw = view === 'side' ? 1 : 0.8;
  /** one pass (the wrap, or the curl lying over it): the tube's colour, then, clipped a hair outside it (so a band's
   * colour, not the tube's, makes the curl's edge where it lies over the wrap), the bands and a few strands */
  const pass = (u0: number, u1: number, base: string, bl: number, nStr: number, sd: number, hub?: Path2D, s0 = u0, g?: (u: number) => number) => {
    const sil = discs(0.97, Math.max(0, s0), u1, g), clip = discs(0.985, Math.max(0, s0), u1, g);
    if (hub) { sil.addPath(hub); clip.addPath(hub); }
    c.fillStyle = base; c.fill(sil, 'nonzero');
    c.save(); c.clip(clip, 'nonzero');
    paintBands(u0, u1, bl);
    // THE CORE: the curl's inside and the spiral's centre (a disc over the small hole the coil leaves there), ONE
    // crisp shape in one colour (the band ends that meet round the centre all lie under it), darkest right under
    // the tongue's edge (its shadow: a smooth gradient inward from there); painted the same in both passes, so the
    // curl's first discs show no seam. (The disc first, then the sweep: filled one by one, since, wound opposite
    // ways, as one path their overlap would cancel.)
    const ce = coreEdge(cu), coreCol = mixs(f.tailOrange, f.tailCore, 0.6);
    const hubC = ell(C[0], C[1], 30, 30), coreP = sweep(ce, () => 1.15, Math.max(cu - 0.04, u0), u1);
    c.fillStyle = coreCol; c.fill(hubC);
    c.save(); c.clip(hubC); gradE(c, C[0], C[1], 30, 30, [[0, css(f.tailCore, 0.25)], [1, css(f.tailCore, 0.55)]]); c.restore();
    c.fillStyle = coreCol; c.fill(coreP, 'nonzero');
    c.save(); c.clip(coreP, 'nonzero');
    soft(bl, () => { c.fillStyle = f.tailCore; c.fill(sweep((u) => ce(u) - 0.1, (u) => ce(u) + 0.38, Math.max(cu - 0.12, u0 - 0.08), Math.min(1, u1 + 0.08)), 'nonzero'); });
    c.restore();
    if (nStr) strands(Math.max(0.22, u0), Math.min(cu, u1), nStr, sd);
    // the root, tucked into the haunch, a step darker; the plume's top catching the light
    gradL(c, 0, 30, 0, -150, [[0, css(f.shade, 0.5)], [1, css(f.shade, 0)]]);
    gradE(c, C[0] + 10, C[1] - 120, 150, 56, [[0, css(f.tailStrand, 0.2)], [1, css(f.tailStrand, 0)]]);
    c.restore();
  };
  // 1 THE WRAP (root → a little past the curl's start): the smooth big C, its middle (the hub, the spiral's deep
  // inside) dark; 2 THE CURL lying over it: the same bands carried round, narrowing to the tip. Its discs grow in
  // from nothing at the curl's start (on the curl's tight inside a full disc would reach back past where its bands
  // begin: a straight cut), and its bands begin well before them, so where it lies over the wrap's own end the two
  // passes paint the same and no seam shows; only where it crosses the plume's inside does its edge show.
  pass(0, cu + 0.12, f.tailAmber, 6 * rw, view === 'side' ? 9 : 7, seed, ell(C[0], C[1], 46, 46));
  pass(cu - 0.1, 1, f.tailAmber, 3.5 * rw, 0, seed + 1, undefined, cu, (u) => smootherstep(cu - 0.01, cu + 0.12, u));
}

// ---- gear ----
function paintHat(c: C2) {
  // on the head (origin: the neck), over the skull
  const g = GEAR;
  const dome = new Path2D(); dome.ellipse(8, -160, 102, 80, -0.08, Math.PI * 1.02, Math.PI * 1.98); dome.closePath();
  cel(c, dome, g.hardhat, g.hardhatShade, ell(30, -236, 110, 76, -0.08));
  c.fillStyle = g.hardhatShade;
  c.fill(smooth([[-112, -160], [-60, -170], [40, -176], [130, -166], [132, -152], [40, -158], [-60, -152], [-110, -146]], true, 0.4));
  c.fillStyle = css(g.hardhatShade, 0.9);
  c.fillRect(-4, -236, 14, 66); // the ridge
}
/** The hard hat on a turned head (origin the neck): the dome over the skull, the brim round it (its visor toward the
 * way the head faces), the ridge along the crown's middle. */
function paintHatT(c: C2, G: FaceGeo) {
  const g = GEAR, ps = G.ps, cx = G.cx;
  const dome = new Path2D(); dome.ellipse(cx + 4 * ps, -160, 102, 80, -0.08 * ps, Math.PI * 1.02, Math.PI * 1.98); dome.closePath();
  cel(c, dome, g.hardhat, g.hardhatShade, ell(cx + 14 + 16 * ps, -236, 110, 76, -0.08 * ps));
  c.save(); c.clip(dome);
  c.fillStyle = css(g.hardhatShade, 0.9);
  const rx = cx + 58 * ps * Math.sin(G.yaw * D2R), rw = 8 + 6 * Math.cos(G.yaw * D2R);
  c.fill(smooth([[rx - rw, -170], [rx - rw * 0.8, -236], [rx + rw * 0.8, -236], [rx + rw, -170]], true, 0.2));
  c.restore();
  c.fillStyle = g.hardhatShade;
  c.fill(union(ell(cx + 8 * ps, -159, 118 + 4 * ps, 9.5), ell(cx + 72 * ps, -156, 58 + 6 * ps, 9)));
}
/** The cap's shade and its visor's underside (from the cast's own reds). */
const capShade = () => mixs(FUR.coral.deep, GEAR.toolbox, 0.3), capUnder = () => mixs(FUR.coral.deep, FUR.coral.nose, 0.4);
/** The red cap in profile (origin the neck, facing right; gear.cap): the visor forward over the brow (its underside a
 * step darker), the dome snug over the crown in flat cel (its back in shadow, a lit top), a band at its rim, a seam, a
 * button on top. Plain: no letter, no emblem. */
function paintCap(c: C2) {
  const g = GEAR, sh = capShade();
  c.fillStyle = capUnder();
  c.beginPath(); c.moveTo(44, -150); c.quadraticCurveTo(120, -160, 160, -141); c.quadraticCurveTo(152, -131, 110, -133); c.quadraticCurveTo(70, -135, 38, -133); c.closePath(); c.fill();
  c.fillStyle = g.toolbox;
  c.beginPath(); c.moveTo(44, -155); c.quadraticCurveTo(120, -167, 162, -145); c.quadraticCurveTo(122, -148, 44, -142); c.closePath(); c.fill();
  const dome = new Path2D(); dome.ellipse(6, -146, 100, 86, -0.06, Math.PI, Math.PI * 2); dome.closePath();
  cel(c, dome, g.toolbox, sh, ell(44, -170, 118, 92, -0.1));
  c.save(); c.clip(dome);
  c.fillStyle = g.toolboxLit; c.fill(ell(40, -234, 66, 18, -0.1));
  c.strokeStyle = sh; c.lineWidth = 5; c.beginPath(); c.moveTo(10, -230); c.quadraticCurveTo(40, -200, 50, -150); c.stroke();
  c.restore();
  c.fillStyle = sh; c.fillRect(-94, -152, 196, 9);
  c.fillStyle = g.toolboxLit; c.beginPath(); c.arc(8, -232, 10, 0, TAU); c.fill();
}
/** The cap on a turned head (origin the neck): the dome over the skull, the visor in front of its rim toward the way the
 * head faces (a flattened half-disc whose top catches the light, its lower edge a step darker), the button on top. */
function paintCapT(c: C2, G: FaceGeo) {
  const g = GEAR, ps = G.ps, cx = G.cx, sh = capShade();
  const dome = new Path2D(); dome.ellipse(cx + 4 * ps, -147, 102, 86, -0.06 * ps, Math.PI, Math.PI * 2); dome.closePath();
  cel(c, dome, g.toolbox, sh, ell(cx + 34 + 14 * ps, -172, 116, 92, -0.1 * ps));
  c.save(); c.clip(dome);
  c.fillStyle = g.toolboxLit; c.fill(ell(cx + 30 + 12 * ps, -234, 62, 17, -0.1 * ps));
  c.restore();
  c.fillStyle = sh; c.fill(ell(cx + 4 * ps, -147, 103, 6));
  // the visor: centred on the face's longitude, wider toward the full front
  const vx = cx + 70 * ps, vw = 96 - 22 * ps, vh = 20 + 8 * (1 - ps);
  const lower = (dy: number, w: number, h: number) => { const p = new Path2D(); p.ellipse(vx, -147 + dy, w, h, 0, 0, Math.PI); p.closePath(); return p; };
  c.fillStyle = capUnder(); c.fill(lower(2, vw, vh));
  c.fillStyle = g.toolbox; c.fill(lower(0, vw - 3, vh - 5));
  c.fillStyle = g.toolboxLit; c.beginPath(); c.arc(cx + 6 * ps, -232, 10, 0, TAU); c.fill();
}
function paintVest(c: C2, slim: number, back: boolean) {
  const g = GEAR, sh = back ? backShape(slim) : bodyShape(slim);
  c.save(); c.clip(sh);
  const vest = new Path2D();
  if (back) vest.rect(-140, -230, 280, 168);
  else vest.addPath(smooth(([[-90, -200], [-40, -232], [20, -232], [40, -200], [60, -120], [98, -110], [102, -60], [-100, -60]] as Pt[]).map(([x, y]) => [x * slim, y] as Pt), true, 0.3));
  cel(c, vest, g.vest, g.vestShade, ell(30 * slim, -150, 96 * slim, 110));
  c.fillStyle = g.stripe;
  c.fillRect(-140, -150, 280, 13); c.fillRect(-140, -104, 280, 13);
  if (back) { c.save(); c.translate(0, -175); c.rotate(0.6); c.fillRect(-120, -6, 240, 12); c.rotate(-1.2); c.fillRect(-120, -6, 240, 12); c.restore(); }
  c.restore();
}
/** The hi-vis vest from the front: two panels over the chest with a V between them, the reflective stripes. */
function paintVestFront(c: C2, slim: number) {
  const g = GEAR, sh = frontShape(slim);
  c.save(); c.clip(sh);
  const vest = smooth(([[-100, -214], [-34, -226], [0, -160], [34, -226], [100, -214], [104, -64], [-104, -64]] as Pt[]).map(([x, y]) => [x * slim, y] as Pt), true, 0.15);
  cel(c, vest, g.vest, g.vestShade, ell(14 * slim, -150, 92 * slim, 110));
  c.save(); c.clip(vest); c.fillStyle = g.stripe; c.fillRect(-140, -152, 280, 13); c.fillRect(-140, -106, 280, 13); c.restore();
  c.restore();
}
/** the lenses' radii (head units: the profile's, the turned head's), round the eyes as draws them */
const LENS_P = 43, LENS_T = 38;
function paintGlasses(c: C2) {
  // origin: the eye's centre
  // (a lens round the bigger eye)
  c.fillStyle = css(GEAR.lens, 0.16); c.fill(ell(0, 0, LENS_P, LENS_P, 0));
  c.strokeStyle = GEAR.glasses; c.lineWidth = 7;
  c.beginPath(); c.arc(0, 0, LENS_P, 0, TAU); c.stroke();
  c.beginPath(); c.moveTo(-LENS_P + 1, -6); c.lineTo(-100, -18); c.stroke(); // the temple, back to the ear
  c.strokeStyle = css(GEAR.lens, 0.7); c.lineWidth = 3.5;
  c.beginPath(); c.arc(0, 0, LENS_P - 9, -2.4, -1.6); c.stroke();
}
/** A lens on a turned head (origin the eye's centre; the rig squashes it with the eye): the round frame, the glass, a glint. */
function paintLensT(c: C2) {
  c.fillStyle = css(GEAR.lens, 0.16); c.fill(ell(0, 0, LENS_T, LENS_T, 0));
  c.strokeStyle = GEAR.glasses; c.lineWidth = 6.5;
  c.beginPath(); c.arc(0, 0, LENS_T, 0, TAU); c.stroke();
  c.strokeStyle = css(GEAR.lens, 0.7); c.lineWidth = 3.2;
  c.beginPath(); c.arc(0, 0, LENS_T - 8, -2.4, -1.6); c.stroke();
}
/** The frames' inner edges (head units about the eye's centre): the profile's lens (radius 40, a 7-wide rim) and the
 * turned head's (33, 6.5): a lid's edge line drawn over the glass stays inside them. */
const LENS_P_IN = LENS_P - 3.5, LENS_T_IN = LENS_T - 3.25;
/** The edge line over the glass: a little thicker and fully opaque (the glass has lifted the eye under it toward the
 * lid's value, so the line carries the edge alone). */
const OVER_LENS = { w: 1.5, a: 1 };
/** Inside a lens of radius r squashed to r·sx across (a point about the eye's centre, head units)? */
const inLens = (p: Pt, r: number, sx: number) => (p[0] / (r * sx)) ** 2 + (p[1] / r) ** 2 <= 1;
/** The half-length (at most h0) of a line centred at (0, dy) about the eye's centre, at angle rot, kept inside that
 * lens (symmetric about its centre); 0 when its centre is outside. */
/** The half-length of a line centred at (0, dy) about an ellipse's centre (half-axes a across, b up), at angle rot,
 * kept inside it (symmetric about its centre); 0 when its centre is outside. */
function chordE(dy: number, rot: number, a: number, b: number) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const A = (c * c) / (a * a) + (s * s) / (b * b), B = (2 * dy * s) / (b * b), C = (dy * dy) / (b * b) - 1;
  if (C >= 0) return 0;
  const D = Math.sqrt(B * B - 4 * A * C);
  return Math.max(0, Math.min((B + D) / (2 * A), (-B + D) / (2 * A)));
}
function chordInLens(dy: number, rot: number, h0: number, r: number, sx: number) {
  const c = Math.cos(rot), s = Math.sin(rot), rx = r * sx;
  const A = (c * c) / (rx * rx) + (s * s) / (r * r), B = (2 * dy * s) / (r * r), C = (dy * dy) / (r * r) - 1;
  if (C >= 0) return 0;
  const D = Math.sqrt(B * B - 4 * A * C);
  return Math.max(0, Math.min(h0, (B + D) / (2 * A), (-B + D) / (2 * A)));
}
/** A short bar of the frame (the bridge, a temple), origin its left end, 40 long. */
function paintBar(c: C2) { c.fillStyle = GEAR.glasses; c.fill(smooth([[0, -3.2], [40, -3.2], [40, 3.2], [0, 3.2]], true, 0.2)); }
/** The backpack in side view, on its wearer's back (origin: the seat point; inside its bake box, x −140..−30, y
 * −222..−52): a school bag seen from the side — a domed padded body, a rounded flap over its top closed by a strap and buckle on its outer face, a puffy
 * front pocket, a side pocket, a small grab handle, the shoulder strap rising from its top over her shoulder; soft
 * shading (lit top and outer face, a broad shade toward her back and its base), no outlines, seams as fine lines. */
function paintBackpack(c: C2) {
  const g = GEAR, B = g.backpack, lit = g.backpackLit, shade = mixs(B, g.strap, 0.38), deep = mixs(B, g.strap, 0.62), hi = mixs(lit, g.stripe, 0.35);
  const strapLit = mixs(g.strap, lit, 0.35), metal = mixs(g.stripe, lit, 0.3);
  const lg = (x0: number, y0: number, x1: number, y1: number, st: Stops) => { const gr = c.createLinearGradient(x0, y0, x1, y1); for (const [k, col] of st) gr.addColorStop(k, col); return gr; };
  const rg = (x: number, y: number, r: number, st: Stops) => { const gr = c.createRadialGradient(x, y, 0, x, y, r); for (const [k, col] of st) gr.addColorStop(k, col); return gr; };
  // the grab handle on top (behind the dome)
  c.lineCap = 'round';
  c.strokeStyle = g.strap; c.lineWidth = 5; c.beginPath(); c.moveTo(-100, -206); c.bezierCurveTo(-98, -222, -82, -222, -80, -208); c.stroke();
  // the body: a padded dome in profile, its back flat against her back, its outer face bulging a little; lit, as her
  // other gear, on the side toward her front (the light falls past her shoulder), its outer face and base in shade
  const body = smooth([[-58, -204], [-84, -214], [-110, -206], [-128, -182], [-134, -140], [-132, -96], [-122, -66], [-100, -57], [-68, -59], [-54, -74], [-51, -140], [-53, -188]], true, 0.42);
  c.fillStyle = rg(-76, -158, 96, [[0, mixs(B, lit, 0.62)], [0.5, mixs(B, lit, 0.2)], [1, shade]]); c.fill(body);
  c.save(); c.clip(body);
  // its outer face: a narrow panel along the front, a step darker, the rim light on its edge
  c.fillStyle = css(shade, 0.75); c.fill(smooth([[-112, -204], [-128, -184], [-134, -140], [-132, -98], [-122, -68], [-112, -66], [-116, -100], [-118, -150]], true, 0.4));
  c.strokeStyle = css(hi, 0.5); c.lineWidth = 2.2; c.beginPath(); c.moveTo(-131, -172); c.bezierCurveTo(-136, -140, -134, -100, -126, -72); c.stroke();
  // the base a step darker, a thin shade where it touches her back
  c.fillStyle = lg(0, -86, 0, -56, [[0, css(deep, 0)], [1, css(deep, 0.6)]]); c.fillRect(-140, -88, 92, 34);
  c.fillStyle = lg(-60, 0, -50, 0, [[0, css(deep, 0)], [1, css(deep, 0.4)]]); c.fillRect(-60, -220, 12, 170);
  // the side pocket, puffy, low on the side panel
  c.fillStyle = lg(0, -112, 0, -64, [[0, mixs(B, lit, 0.4)], [1, shade]]); c.fill(smooth([[-106, -110], [-66, -112], [-60, -90], [-66, -66], [-104, -64], [-110, -88]], true, 0.4));
  c.strokeStyle = css(deep, 0.6); c.lineWidth = 1.6; c.beginPath(); c.moveTo(-104, -104); c.quadraticCurveTo(-86, -108, -64, -106); c.stroke();
  c.restore();
  // the flap over the top, down the outer face to the buckle; its stitched hem; the shade it casts
  const flap = smooth([[-56, -198], [-70, -213], [-96, -215], [-118, -203], [-132, -179], [-135, -152], [-127, -146], [-115, -157], [-98, -170], [-77, -177], [-57, -181]], true, 0.42);
  c.save(); c.clip(body); c.fillStyle = css(deep, 0.42); c.fill(smooth([[-58, -178], [-80, -172], [-104, -162], [-122, -144], [-112, -140], [-96, -156], [-76, -166], [-58, -170]], true, 0.4)); c.restore();
  c.fillStyle = lg(-70, -215, -120, -150, [[0, mixs(B, lit, 0.7)], [0.6, mixs(B, lit, 0.3)], [1, mixs(B, g.strap, 0.1)]]); c.fill(flap);
  c.save(); c.clip(flap);
  c.strokeStyle = css(hi, 0.55); c.lineWidth = 2.4; c.beginPath(); c.moveTo(-118, -198); c.bezierCurveTo(-104, -210, -84, -214, -62, -206); c.stroke();
  c.strokeStyle = css(deep, 0.55); c.lineWidth = 1.3; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(-126, -156); c.bezierCurveTo(-110, -168, -84, -177, -60, -177); c.stroke(); c.setLineDash([]);
  c.restore();
  // the strap down the outer face to the buckle
  c.fillStyle = g.strap; c.fill(smooth([[-136, -154], [-128, -154], [-128, -124], [-136, -124]], true, 0.2));
  c.fillStyle = css(deep, 0.5); c.fill(smooth([[-139, -144], [-126, -144], [-126, -130], [-139, -130]], true, 0.3));
  c.fillStyle = metal; c.fill(smooth([[-139, -146], [-127, -146], [-127, -133], [-139, -133]], true, 0.3));
  c.fillStyle = mixs(g.strap, deep, 0.4); c.fill(smooth([[-136, -142], [-130, -142], [-130, -137], [-136, -137]], true, 0.2));
  // the front pocket bulging from the outer face, its zip
  const pocket = smooth([[-125, -120], [-134, -112], [-138, -90], [-133, -72], [-119, -66], [-113, -80], [-115, -104]], true, 0.42);
  c.fillStyle = lg(-114, -120, -138, -66, [[0, mixs(B, lit, 0.35)], [0.6, B], [1, shade]]); c.fill(pocket);
  c.strokeStyle = css(deep, 0.65); c.lineWidth = 1.6; c.beginPath(); c.moveTo(-126, -116); c.quadraticCurveTo(-134, -100, -132, -80); c.stroke();
  // the shoulder strap: padded, from the top of the back panel up over her shoulder (it goes on under her head: it
  // never ends in the air), its lit edge
  c.strokeStyle = g.strap; c.lineWidth = 13;
  c.beginPath(); c.moveTo(-66, -164); c.bezierCurveTo(-60, -182, -50, -198, -37, -212); c.stroke();
  c.strokeStyle = css(strapLit, 0.7); c.lineWidth = 2.5;
  c.beginPath(); c.moveTo(-62, -168); c.bezierCurveTo(-56, -184, -46, -199, -34, -211); c.stroke();
}
/** The backpack from the front: its straps over the shoulders. */
function paintStrapsFront(c: C2, slim: number) {
  c.save(); c.clip(frontShape(slim));
  c.fillStyle = GEAR.strap;
  for (const s of [-1, 1]) c.fill(smooth(([[42, -236], [62, -232], [70, -150], [56, -112], [44, -116], [50, -152]] as Pt[]).map(([x, y]) => [s * x * slim, y] as Pt), true, 0.3));
  c.restore();
}
function paintSuitBody(c: C2, slim: number, back: boolean) {
  const g = GEAR, sh = back ? backShape(slim) : bodyShape(slim);
  c.save(); c.clip(sh);
  const all = new Path2D(); all.rect(-140, -226, 280, 250);
  cel(c, all, g.suitLit, g.suit, back ? ell(40 * slim, -150, 92 * slim, 116, -0.2) : ell(26 * slim, -128, 100 * slim, 128, 0.08));
  c.strokeStyle = g.suitTrim; c.lineWidth = 7; c.lineCap = 'round';
  c.beginPath(); c.moveTo(-140, -70); c.lineTo(140, -70); c.stroke(); // the belt line
  c.lineWidth = 5;
  if (!back) {
    c.beginPath(); c.arc(56 * slim, -150, 15, 0, TAU); c.stroke(); // the chest badge
    c.fillStyle = css(g.suitTrim, 0.35); c.fill(ell(56 * slim, -150, 11, 11));
    c.beginPath(); c.moveTo(22 * slim, -228); c.lineTo(12 * slim, -90); c.stroke();
  } else {
    c.fillStyle = g.suit;
    c.fill(smooth([[-70, -200], [10, -214], [30, -110], [-60, -96]], true, 0.3)); // the back pack
    c.strokeStyle = g.suitTrim; c.lineWidth = 4;
    c.beginPath(); c.moveTo(-50, -170); c.lineTo(10, -176); c.stroke();
  }
  c.restore();
  // the collar ring
  c.fillStyle = g.suit;
  c.fill(ell(back ? 40 : 30 * slim, back ? -236 : -230, 48, 13, -0.15));
  c.strokeStyle = g.suitTrim; c.lineWidth = 4;
  c.beginPath(); c.ellipse(back ? 40 : 30 * slim, back ? -236 : -230, 48, 13, -0.15, 0, TAU); c.stroke();
}
/** The space suit from the front: the belt, the zip, the chest badge, the collar ring. */
function paintSuitFront(c: C2, slim: number) {
  const g = GEAR, sh = frontShape(slim);
  c.save(); c.clip(sh);
  const all = new Path2D(); all.rect(-140, -240, 280, 260);
  cel(c, all, g.suitLit, g.suit, ell(14 * slim, -122, 96 * slim, 136));
  c.strokeStyle = g.suitTrim; c.lineCap = 'round';
  c.lineWidth = 7; c.beginPath(); c.moveTo(-140, -70); c.lineTo(140, -70); c.stroke();
  c.lineWidth = 5; c.beginPath(); c.moveTo(0, -228); c.lineTo(0, -76); c.stroke();
  c.beginPath(); c.arc(44 * slim, -160, 14, 0, TAU); c.stroke();
  c.fillStyle = css(g.suitTrim, 0.35); c.fill(ell(44 * slim, -160, 10, 10));
  c.restore();
  c.fillStyle = g.suit; c.fill(ell(0, -232, 54, 13));
  c.strokeStyle = g.suitTrim; c.lineWidth = 4; c.beginPath(); c.ellipse(0, -232, 54, 13, 0, 0, TAU); c.stroke();
}
/** The suit's cuff (origin its centre, across the arm: 8 along it, 2 × 26 across, scaled to the wrist). */
function paintCuff(c: C2) { c.fillStyle = GEAR.suitTrim; c.fill(smooth([[-4, -26], [4, -26], [4, 26], [-4, 26]], true, 0.3)); }
function paintToolbox(c: C2) {
  const g = GEAR;
  const box = smooth([[-56, -18], [56, -18], [58, 40], [-58, 40]], true, 0.12);
  cel(c, box, g.toolboxLit, g.toolbox, ell(-10, -10, 80, 30));
  c.strokeStyle = g.toolbox; c.lineWidth = 8; c.lineCap = 'round';
  c.beginPath(); c.moveTo(-24, -18); c.lineTo(-20, -40); c.lineTo(20, -40); c.lineTo(24, -18); c.stroke();
  c.fillStyle = GEAR.stripe; c.fillRect(-8, -2, 16, 12);
}

// ------------------------------------------------------------------------------------------------------------
// The arm's tube: a spine from the shoulder through a ROUNDED elbow to the wrist, sampled for the discs
// ------------------------------------------------------------------------------------------------------------
interface Knot { x: number; y: number; r: number; nx: number; ny: number }
/** The tube's knots (rig units): the elbow is a fillet (a quadratic from the upper arm into the forearm, its tangent
 * length about the elbow's radius × tan(bend/2), never past 40 % of either segment), the radius tapers shoulder →
 * elbow → wrist, a knot every third of the local radius; n is the lit side's normal (the upper side of a forward arm,
 * the inside of the bend). */
function armKnots(S: Pt, E: Pt, W: Pt, r0: number, r1: number, r2: number): Knot[] {
  const L1 = Math.hypot(E[0] - S[0], E[1] - S[1]) || 1e-3, L2 = Math.hypot(W[0] - E[0], W[1] - E[1]) || 1e-3;
  const d1: Pt = [(E[0] - S[0]) / L1, (E[1] - S[1]) / L1], d2: Pt = [(W[0] - E[0]) / L2, (W[1] - E[1]) / L2];
  const bend = Math.acos(clamp(d1[0] * d2[0] + d1[1] * d2[1], -1, 1));
  const tl = Math.min(0.4 * L1, 0.4 * L2, 1.35 * r1 * Math.tan(Math.min(1.35, bend) / 2));
  const A: Pt = [E[0] - d1[0] * tl, E[1] - d1[1] * tl], B: Pt = [E[0] + d2[0] * tl, E[1] + d2[1] * tl];
  // a dense polyline along the spine with each point's share of the way (0 shoulder, 1 wrist; the elbow's middle at
  // L1 ÷ (L1 + L2))
  const pts: { p: Pt; t: Pt }[] = [];
  const line = (a: Pt, b: Pt, d: Pt, n: number) => { for (let i = 0; i < n; i++) { const u = i / n; pts.push({ p: [lerp(a[0], b[0], u), lerp(a[1], b[1], u)], t: d }); } };
  line(S, A, d1, 10);
  for (let i = 0; i < 12; i++) {
    const u = i / 12, v = 1 - u;
    const p: Pt = [v * v * A[0] + 2 * u * v * E[0] + u * u * B[0], v * v * A[1] + 2 * u * v * E[1] + u * u * B[1]];
    const tx = 2 * v * (E[0] - A[0]) + 2 * u * (B[0] - E[0]), ty = 2 * v * (E[1] - A[1]) + 2 * u * (B[1] - E[1]), m = Math.hypot(tx, ty) || 1;
    pts.push({ p, t: tl > 1e-3 ? [tx / m, ty / m] : d1 });
  }
  line(B, W, d2, 10);
  pts.push({ p: W, t: d2 });
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]!.p[0] - pts[i - 1]!.p[0], pts[i]!.p[1] - pts[i - 1]!.p[1]));
  const total = cum[cum.length - 1]!, mid = L1 / (L1 + L2);
  const rAt = (s: number) => { const u = s / Math.max(1e-6, total); return u < mid ? lerp(r0, r1, smootherstep(0, mid, u) * 0.85 + 0.15 * (u / mid)) : lerp(r1, r2, (u - mid) / Math.max(1e-6, 1 - mid)); };
  const out: Knot[] = [];
  let s = 0, j = 0;
  for (let guard = 0; guard < 120; guard++) {
    while (j < pts.length - 2 && cum[j + 1]! < s) j++;
    const k = clamp((s - cum[j]!) / Math.max(1e-6, cum[j + 1]! - cum[j]!), 0, 1), a = pts[j]!, b = pts[j + 1]!;
    const tx = lerp(a.t[0], b.t[0], k), ty = lerp(a.t[1], b.t[1], k), m = Math.hypot(tx, ty) || 1, r = rAt(s);
    out.push({ x: lerp(a.p[0], b.p[0], k), y: lerp(a.p[1], b.p[1], k), r, nx: ty / m, ny: -tx / m });
    if (s >= total) break;
    s = Math.min(total, s + Math.max(1.2, 0.34 * r));
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------
// The character
// ------------------------------------------------------------------------------------------------------------
export type SqView = 'side' | 'back' | 'front';
export interface SqDrawOpts extends DrawOpts {
  /** world px per rig unit (default 1) */
  scale?: number;
  /** 1 facing right (default), −1 facing left (from the front: the tail on the left for 1, on the right for −1) */
  face?: 1 | -1;
  /** 'side' (profile; default), 'back' (three-quarter from behind, seated at a desk: the references) or 'front' (the
   * whole body toward us, reference 01: paws at the chest, the cream belly, haunches and feet, the tail rising behind one
   * side; the pose's angles read in the picture's plane, ArmAngles' rot and ab say how the arms open) */
  view?: SqView;
  /** rim light multiplier on the outer masses (tail, head, ears, body; never the limbs) and its colour */
  rim?: number; rimColor?: Col;
  /** a multiply tint over every part (night dimming) */
  tint?: Col; flat?: number;
  /** a background character: a dark silhouette under the local light (the references' pod) — the body `color`, a rim in
   * `rim` and a warmer one on the tail (`tailRim`), `k` how dark (default 0.9) */
  silhouette?: { color: Col; rim?: Col; tailRim?: Col; k?: number } | null;
  /** something held at the near paw (drawn at the paw, its anchor there), its rotation and scale */
  hold?: Art | null; holdRot?: number; holdScale?: number;
  /** the point of the held art that sits in the paw (0..1 of the art, never mirrored; default its own anchor): facing
   * left, [1, 0.8] holds a sheet by its right edge so it reaches ahead of the character */
  holdAnchor?: readonly [number, number];
  /** what to skip (a chair hides the legs) */
  noLegs?: boolean;
  /** the scene's light on the character, from the stage's look (default on): the key light's colour on the fur, a thin
   * counter rim on the side away from the key, a soft contact shadow (profile and front; none seated from behind, with
   * noLegs or as a silhouette). false: the flat cel character alone; or each one's strength (1 the default, 0 off):
   * contact 0 where the scene draws its own shadow or nothing is under the character (a jump off a ledge, a flight) */
  light?: false | { tint?: number; rim?: number; contact?: number };
}
export interface Joints {
  /** world points (eye: the near eye; mouth: the middle of the lips) */
  head: Pt; eye: Pt; nose: Pt; mouth: Pt; pawN: Pt; pawF: Pt; tip: Pt; neck: Pt; chest: Pt; tailTop: Pt; shoulderN: Pt;
  /** the scale in use */
  s: number;
}
/** A reach solved: the point for pose.reachN / reachF (rig units), whether the paw gets there, and by how much it
 * misses (world px; 0 when it reaches): beyond the whole arm, or nearer the shoulder than the folded arm's paw. */
export interface Reach { pt: Pt; ok: boolean; short: number }
/** The baked parts. (`upper` and `fore` are the arm's two discs, the shade one and the lit one: a scene's arm-only bake
 * that keeps `upper`, `fore` and `pawPoint` still draws a whole arm.) */
interface Parts {
  head: Art; eye: Art; mouth: Art; earN: Art; earF: Art; tuft?: Art; body: Art; back: Art; thigh: Art; foot: Art;
  upper: Art; fore: Art; paw: Art; pawPoint: Art; tail: Art; tailBack: Art;
  headT: Art[]; eyeT: Art; lidU: Art; lidL: Art; lidUT: Art; lidLT: Art; lidLine: Art; lidHorns: Art; blush: Art;
  /** the turned eyes' glints, the eye's lash, a brow (optional: a scene's arm-only bake drops them) */
  glintT?: Art; lash?: Art; brow?: Art;
  mouthP: Record<MouthKey, Art>; mouthT: Record<MouthKey, Art>; grinT: Art; ohT: Art;
  front: Art; thighFront: Art; footFront: Art;
  hat?: Art; hatT?: Art[]; vest?: Art; vestBack?: Art; vestFront?: Art; glasses?: Art; lensT?: Art; bar?: Art; backpack?: Art; straps?: Art;
  cap?: Art; capT?: Art[];
  suit?: Art; suitBack?: Art; suitFront?: Art; suitUpper?: Art; suitFore?: Art; suitThigh?: Art; suitThighFront?: Art; cuff?: Art;
}
const FAR_TINT: [number, number, number] = [0.74, 0.68, 0.7];
/** the references' proportions: a chunky body (×1.04 the skeleton's width) and a BIG head, about as wide as the body */
const BODY_W = 1.04, HEAD_K = 1.1;
/** The shelf packing of Atlas.add (the same rule), to size the atlas to the parts a character bakes. */
function packHeight(width: number, sizes: [number, number, number][]): number {
  let x = 0, y = 0, rowH = 0;
  for (const [w, h, pad] of sizes) {
    const gw = Math.ceil(w + 2 * pad) + 2, gh = Math.ceil(h + 2 * pad) + 2;
    if (x + gw > width) { x = 0; y += rowH; rowH = 0; }
    x += gw; rowH = Math.max(rowH, gh);
  }
  return y + rowH;
}

/** Which baked head shows at a turn (and the next one fading in over it): 0 the profile, 1-3 the turned heads (YAWS). */
function headsAt(turn: number, front: boolean): { a: number; b: number; k: number } {
  // a head's band, as the rig has always read `turn`: the profile up to 0.46 (a small turn squashes it), the swap
  // inside 0.46-0.54, three-quarter from 0.54 to 1.5,
  // front beyond. The 60° head is the swap's in-between (alone at 0.475-0.525, with headTurn() a turn
  // lingers there for about three frames), so a turn passes profile → 60° → three-quarter and every held value from
  // 0.54 up is the three-quarter face toward us (0.46 and 0.54 are still exactly the profile and the three-quarter).
  // Each change is a very quick fade of the new head over the old (0.01 of turn: cut-out replacement, so a frame almost
  // never lands on a see-through double face; the final render's motion blur turns it into a sub-frame dissolve).
  const t = front ? 2 - clamp(turn, 0, 1) : clamp(turn, 0, 2);
  const edges: [number, number, number, number][] = [[0.47, 0.005, 0, 1], [0.53, 0.005, 1, 2], [1.5, 0.04, 2, 3]];
  let a = 0;
  for (const [e, w, , to] of edges) if (t >= e + w) a = to;
  for (const [e, w, from, to] of edges) if (t > e - w && t < e + w) return { a: from, b: to, k: smootherstep(e - w, e + w, t) };
  return { a, b: a, k: 0 };
}

export class Squirrel {
  readonly atlas: Atlas;
  readonly parts: Parts;
  readonly spec: SquirrelSpec;
  readonly slim: number;
  readonly headK: number;
  /** a toolbox: pass it as `hold` */
  toolbox: Art;
  private warned = false;
  /**
   * Bake the character (call it as a scene field, after the scene's Stage, so the Stage owns the texture).
   * res: texels per rig unit (default 0.9: crisp up to ~1 world px per unit at --scale 1).
   */
  constructor(spec: SquirrelSpec, o: { res?: number } = {}) {
    this.spec = spec;
    const f = spec.fur, slim = (this.slim = (spec.slim ?? 1) * BODY_W), g = spec.gear ?? {};
    this.headK = (spec.head ?? 1) * HEAD_K;
    const TB = tailBox(TAILS.side), TBB = tailBox(TAILS.back);
    const BW = Math.ceil(206 * slim) + 10, BX = Math.ceil(100 * slim) + 5, KW = Math.ceil(252 * slim) + 10, KX = Math.ceil(130 * slim) + 5;
    const FW = Math.ceil(200 * slim) + 12, FX = Math.ceil(100 * slim) + 6;
    // every part: [key, w, h, px, py, paint, rim, pad]; packed in this order, the atlas sized to hold them
    type Spec = [string, number, number, number, number, (c: C2) => void, number?];
    const L: Spec[] = [
      ['tail', TB.x1 - TB.x0, TB.y1 - TB.y0, -TB.x0, -TB.y0, (c) => paintTail(c, f, 'side'), 0.7],
      ['tailBack', TBB.x1 - TBB.x0, TBB.y1 - TBB.y0, -TBB.x0, -TBB.y0, (c) => paintTail(c, f, 'back'), 0.7],
      ['head', 272, 232, 108, 218, (c) => paintHead(c, f, !spec.tuft), 0.55],
      ...GEO.map((G, i): Spec => [`headT${i}`, 292, 236, 124, 222, (c) => paintHeadT(c, f, G, !spec.tuft), 0.55]),
      ['body', BW, 262, BX, 250, (c) => paintBody(c, f, slim), 0.45],
      ['back', KW, 280, KX, 262, (c) => paintBack(c, f, slim), 0.45],
      ['front', FW, 262, FX, 250, (c) => paintFront(c, f, slim), 0.45],
      ['thigh', 148, 136, 60, 52, (c) => paintThigh(c, f)],
      ['thighFront', 104, 128, 52, 64, (c) => paintThighFront(c, f)],
      ['eye', 76, 90, 38, 45, (c) => paintEye(c, f)],
      ['eyeT', 60, 66, 30, 33, (c) => paintEyeT(c, f)],
      ['earN', 80, 136, 40, 126, (c) => paintEar(c, f, false), 0.55],
      ['earF', 80, 136, 40, 126, (c) => paintEar(c, f, true), 0.3],
      ['foot', 108, 42, 20, 21, (c) => paintFoot(c, f)],
      ['footFront', 92, 40, 46, 38, (c) => paintFootFront(c, f)],
      ['upper', 2 * DISC_R + 2, 2 * DISC_R + 2, DISC_R + 1, DISC_R + 1, (c) => paintDisc(c, f.shade)],
      ['fore', 2 * DISC_R + 2, 2 * DISC_R + 2, DISC_R + 1, DISC_R + 1, (c) => paintDisc(c, f.base)],
      ['paw', 56, 48, 8, 24, (c) => paintPaw(c, f, false)],
      ['pawPoint', 74, 48, 8, 24, (c) => paintPaw(c, f, true)],
      ['mouth', 34, 26, 17, 13, (c) => paintMouth(c, f)],
      ['lidU', 62, 32, 31, 31, (c) => paintLidU(c, f.cream)],
      ['lidL', 62, 44, 31, 13, (c) => paintLidL(c, f.cream)],
      ['lidUT', 62, 32, 31, 31, (c) => paintLidU(c, ringCream(f))],
      ['lidLT', 62, 44, 31, 13, (c) => paintLidL(c, ringCream(f))],
      ['lidLine', 64, 6, 32, 3, (c) => paintLidLine(c, f)],
      ['lidHorns', 62, 14, 31, 12.5, (c) => paintLidHorns(c, f.cream)],
      ['blush', 32, 19, 16, 9.5, (c) => paintBlush(c, f)],
      ...MOUTHS.map((k): Spec => [`mouthP_${k}`, 34, 26, 26, 4, (c) => paintMouthP(c, f, k)]),
      ...MOUTHS.map((k): Spec => [`mouthT_${k}`, 62, 30, 31, 12, (c) => paintMouthT(c, f, k)]),
      ['grinT', 50, 32, 25, 12, (c) => paintOpenT(c, f, false)],
      ['ohT', 24, 32, 12, 12, (c) => paintOpenT(c, f, true)],
    ];
    if (spec.tuft) L.push(['tuft', 48, 66, 24, 58, (c) => paintTuft(c, f), 0.4]);
    if (g.hat) { L.push(['hat', 260, 112, 120, 254, (c) => paintHat(c), 0.4]); GEO.forEach((G, i) => L.push([`hatT${i}`, 264, 120, 132, 256, (c) => paintHatT(c, G), 0.4])); }
    if (g.cap) { L.push(['cap', 272, 124, 104, 250, (c) => paintCap(c), 0.4]); GEO.forEach((G, i) => L.push([`capT${i}`, 264, 140, 112, 250, (c) => paintCapT(c, G), 0.4])); }
    if (g.vest) { L.push(['vest', BW, 262, BX, 250, (c) => paintVest(c, slim, false)], ['vestBack', KW, 280, KX, 262, (c) => paintVest(c, slim, true)], ['vestFront', FW, 262, FX, 250, (c) => paintVestFront(c, slim)]); }
    if (g.glasses) L.push(['glasses', 156, 96, 112, 48, (c) => paintGlasses(c)], ['lensT', 76, 76, 38, 38, (c) => paintLensT(c)], ['bar', 41, 8, 0.5, 4, (c) => paintBar(c)]);
    if (g.backpack) L.push(['backpack', 110, 170, 140, 222, (c) => paintBackpack(c), 0.3], ['straps', FW, 262, FX, 250, (c) => paintStrapsFront(c, slim)]);
    if (g.suit) {
      L.push(
        ['suit', BW, 262, BX, 250, (c) => paintSuitBody(c, slim, false), 0.45],
        ['suitBack', KW, 280, KX, 262, (c) => paintSuitBody(c, slim, true), 0.45],
        ['suitFront', FW, 262, FX, 250, (c) => paintSuitFront(c, slim), 0.45],
        ['suitUpper', 2 * DISC_R + 2, 2 * DISC_R + 2, DISC_R + 1, DISC_R + 1, (c) => paintDisc(c, GEAR.suit)],
        ['suitFore', 2 * DISC_R + 2, 2 * DISC_R + 2, DISC_R + 1, DISC_R + 1, (c) => paintDisc(c, GEAR.suitLit)],
        ['suitThigh', 148, 136, 60, 52, (c) => cel(c, ell(10, 12, 66, 60, -0.1), GEAR.suitLit, GEAR.suit, ell(22, 2, 62, 58, -0.1))],
        ['suitThighFront', 104, 128, 52, 64, (c) => cel(c, ell(0, 0, 50, 62), GEAR.suitLit, GEAR.suit, ell(8, -8, 48, 60))],
        ['cuff', 10, 54, 5, 27, (c) => paintCuff(c)],
      );
    }
    L.push(['toolbox', 124, 88, 62, 44, (c) => paintToolbox(c), 0.3]);
    // (the turned eyes' glints, the lash, the brow; small, so they pack into the last row's free width)
    L.push(['glintT', 26, 26, 13, 13, (c) => paintGlintT(c, f)], ['lash', 16, 14, 4, 10, (c) => paintLash(c, f)], ['brow', 36, 12, 18, 6, (c) => paintBrow(c, f)]);
    const PAD = 5, AW = 1280;
    const AH = Math.min(2048, Math.ceil(packHeight(AW, L.map(([, w, h]): [number, number, number] => [w, h, PAD])) / 16) * 16 + 16);
    const A = (this.atlas = new Atlas(AW, AH, o.res ?? 0.9));
    const arts: Record<string, Art> = {};
    // rim: the outer masses only (0 on the limbs: no seams at the joints)
    for (const [key, w, h, px, py, paint, rim] of L) arts[key] = A.add(w, h, (c) => { c.save(); c.translate(px, py); paint(c); c.restore(); }, { anchor: [px / w, py / h], pad: PAD, rim: rim ?? 0 });
    const rec = <K extends string>(pre: string, ks: K[]) => Object.fromEntries(ks.map((k) => [k, arts[pre + k]!])) as Record<K, Art>;
    const opt = (k: string) => arts[k];
    this.parts = {
      head: arts.head!, eye: arts.eye!, mouth: arts.mouth!, earN: arts.earN!, earF: arts.earF!, tuft: opt('tuft'),
      body: arts.body!, back: arts.back!, thigh: arts.thigh!, foot: arts.foot!,
      upper: arts.upper!, fore: arts.fore!, paw: arts.paw!, pawPoint: arts.pawPoint!, tail: arts.tail!, tailBack: arts.tailBack!,
      headT: GEO.map((_, i) => arts[`headT${i}`]!), eyeT: arts.eyeT!, lidU: arts.lidU!, lidL: arts.lidL!, lidUT: arts.lidUT!, lidLT: arts.lidLT!, lidLine: arts.lidLine!, lidHorns: arts.lidHorns!, blush: arts.blush!,
      glintT: opt('glintT'), lash: opt('lash'), brow: opt('brow'),
      mouthP: rec('mouthP_', MOUTHS), mouthT: rec('mouthT_', MOUTHS), grinT: arts.grinT!, ohT: arts.ohT!,
      front: arts.front!, thighFront: arts.thighFront!, footFront: arts.footFront!,
      hat: opt('hat'), hatT: g.hat ? GEO.map((_, i) => arts[`hatT${i}`]!) : undefined, vest: opt('vest'), vestBack: opt('vestBack'), vestFront: opt('vestFront'),
      glasses: opt('glasses'), lensT: opt('lensT'), bar: opt('bar'), backpack: opt('backpack'), straps: opt('straps'),
      cap: opt('cap'), capT: g.cap ? GEO.map((_, i) => arts[`capT${i}`]!) : undefined,
      suit: opt('suit'), suitBack: opt('suitBack'), suitFront: opt('suitFront'), suitUpper: opt('suitUpper'), suitFore: opt('suitFore'),
      suitThigh: opt('suitThigh'), suitThighFront: opt('suitThighFront'), cuff: opt('cuff'),
    };
    this.toolbox = arts.toolbox!;
  }

  /** The rig solved: every part's pivot (rig units, facing right) and angle. */
  private solve(p: SqPose, view: SqView) {
    const back = view === 'back', front = view === 'front';
    const root: Pt = [p.dx, p.dy - p.lift];
    // from the front a lean (toward us) only settles the body a little; a nod tilts the head to the side
    const lean = front ? 0 : p.lean, sy = p.sy * (front ? 1 - 0.06 * Math.max(0, p.lean) : 1);
    const onBody = (q: Pt): Pt => { const r = rotP([q[0] * this.slim, q[1] * sy], lean); return addP(root, r); };
    const neck = onBody(front ? SKF.neck : back ? SK.neckBack : SK.neck);
    const headA = front ? 0.35 * p.head : lean + p.head;
    const hk = this.headK;
    const onHead = (q: Pt): Pt => addP(neck, rotP([q[0] * hk, q[1] * hk], headA));
    const shN = onBody(front ? SKF.shoulderN : back ? SK.shoulderBack : SK.shoulderN), shF = onBody(front ? SKF.shoulderF : back ? SK.shoulderBackF : SK.shoulderF);
    const rk = p.reachK ?? 1, rkF = p.reachKF ?? rk;
    const arm = (sh: Pt, a: ArmAngles, reach: Pt | null | undefined, k: number, out: 1 | -1, rw = 1, pk = 0): ArmSolved => {
      const L1 = SK.upper * k, L2 = SK.fore * k;
      let elbow: Pt, wrist: Pt, short = 0, hang = 0.55;
      // the reach: the paw (not the wrist) lands on the target and continues the forearm, so the forearm and the paw
      // are one bone from the elbow to the target; the wrist sits a forearm's length along it
      const reached = (to: Pt) => {
        const dx = to[0] - sh[0], dy = to[1] - sh[1], dd = Math.hypot(dx, dy), L2p = L2 + SK.paw;
        // (from the front the elbow bends out to its own side: solve the arm on the −x side mirrored)
        const m = front && out < 0 ? -1 : 1, r = reach2([m * dx, dy], L1, L2p);
        const d1 = dirA(r.sh), d2 = dirA(r.sh + r.el), e = addP(sh, [m * d1[0] * L1, d1[1] * L1]);
        // (what the paw misses by: past the whole arm, or nearer than the folded arm's paw)
        return { elbow: e, wrist: addP(e, [m * d2[0] * L2, d2[1] * L2]), short: Math.max(0, dd - (L1 + L2p), Math.abs(L2p - L1) - dd) };
      };
      const w = reach ? clamp(rw) : 0;
      if (w > 0 && w < 1) {
        // a blend into or out of a reach (mixPose): the arm as its angles put it, moved toward the reach
        const A = arm(sh, a, null, k, out), B = reached(reach!);
        const el = lerpP(A.elbow, B.elbow, w), wr = lerpP(A.wrist, B.wrist, w);
        const a1 = Math.atan2(el[1] - sh[1], el[0] - sh[0]);
        const a2 = Math.hypot(wr[0] - el[0], wr[1] - el[1]) > 4 * k ? Math.atan2(wr[1] - el[1], wr[0] - el[0]) : a1;
        const hw = lerp(A.hang, 0, w);
        return { sh, elbow: el, wrist: wr, a1, a2, aPaw: front ? lerpAng(a2, Math.PI / 2, hw * (1 - pk) * hangRoom(a2)) : a2, hang: hw, short: B.short };
      }
      if (reach && w >= 1) {
        ({ elbow, wrist, short } = reached(reach));
        hang = 0; // a reaching paw continues the forearm, from the front too
      } else if (front) {
        // a pose made for the side (no `rot`) reads from the front as reference 01's idle: the upper arm down the body's side,
        // the elbow tucked in at the side, the forearm coming forward toward us and a little in, so the paws rest APART
        // under the chest and hang from the wrists; short and plump (foreshortened toward us: 0.8 of the arm's
        // length, its thickness kept), never folded into a W. Give rot (even the default −1.05) to have the angles
        // taken as they are
        // (idleOf: 1 for a side pose, 0 for a posed arm, between while mixPose turns one into the other)
        const w = idleOf(a);
        const place = (F: { d1: Pt; d2: Pt }, kI: number): [Pt, Pt] => {
          const e = addP(sh, [F.d1[0] * L1 * kI, F.d1[1] * L1 * kI]);
          return [e, addP(e, [F.d2[0] * L2 * kI, F.d2[1] * L2 * kI])];
        };
        const I = w > 0 ? place(armFront({ sh: 0.06 + 0.25 * a.sh, el: clamp(a.el + 1.3, 1.8, 2.25), rot: -0.68, ab: a.ab ?? 0.1 }, out), 0.8) : null;
        const Q = w < 1 ? place(armFront(a, out), 1) : null;
        [elbow, wrist] = I && Q ? [lerpP(Q[0], I[0], w), lerpP(Q[1], I[1], w)] : (I ?? Q)!;
        hang = lerp(0.55, 0.78, w);
      } else {
        const d1 = dirA(a.sh + lean), d2 = dirA(a.sh + lean + a.el);
        elbow = addP(sh, [d1[0] * L1, d1[1] * L1]); wrist = addP(elbow, [d2[0] * L2, d2[1] * L2]);
      }
      const a1 = Math.atan2(elbow[1] - sh[1], elbow[0] - sh[0]);
      const a2 = Math.hypot(wrist[0] - elbow[0], wrist[1] - elbow[1]) > 4 * k ? Math.atan2(wrist[1] - elbow[1], wrist[0] - elbow[0]) : a1;
      // from the front a resting paw hangs from the wrist toward the ground (reference 01's paws at the chest): its angle
      // (a pointing paw, pk, continues the forearm: it turns there as pointN rises, instead of snapping at the swap)
      const aPaw = front ? lerpAng(a2, Math.PI / 2, hang * (1 - pk) * hangRoom(a2)) : a2;
      return { sh, elbow, wrist, a1, a2, aPaw, hang, short };
    };
    const armN = arm(shN, p.armN, p.reachN, rk, 1, p.reachNw, smootherstep(0.25, 0.75, p.pointN));
    const armF = arm(shF, p.armF, p.reachF, rkF, -1, p.reachFw);
    const hipN = onBody(front ? SKF.hipN : SK.hipN), hipF = onBody(front ? SKF.hipF : SK.hipF);
    const leg = (hip: Pt, th: number, foot: number, step: number) => {
      const a = lean - th * 0.6;
      const heel = addP(hip, rotP(SK.heel, a));
      return { hip, a, heel: [heel[0], heel[1] - step] as Pt, footA: foot };
    };
    const legN = leg(hipN, p.thighN, p.footN, p.stepN), legF = leg(hipF, p.thighF, p.footF, p.stepF);
    if (front) { legN.heel = addP(addP(root, [SKF.footN[0] * this.slim, SKF.footN[1]]), [0, -p.stepN]); legF.heel = addP(addP(root, [SKF.footF[0] * this.slim, SKF.footF[1]]), [0, -p.stepF]); }
    const tailBase = onBody(front ? SKF.tailBase : back ? SK.tailBaseBack : SK.tailBase);
    return { root, lean, sy, neck, headA, onHead, armN, armF, legN, legF, tailBase };
  }

  /** A world point as rig units from the character's (x, y), for `reachN` / `reachF` (facing and scale undone). */
  local(x: number, y: number, wx: number, wy: number, o: SqDrawOpts = {}): Pt { const s = o.scale ?? 1, face = o.face ?? 1; return [(face * (wx - x)) / s, (wy - y) / s]; }
  /**
   * Reach a world point with a paw (arm 'N' near, 'F' far), for the character drawn at (x, y) in pose p: the point
   * for reachN / reachF, and whether the paw gets there (short: world px it misses by, too far or too near the
   * shoulder). When it doesn't, move the character (standFor) or the target: a reach that misses is a broken cause
   * and effect.
   */
  reach(x: number, y: number, wx: number, wy: number, o: SqDrawOpts = {}, arm: 'N' | 'F' = 'N', p: SqPose = POSE.stand): Reach {
    const pt = this.local(x, y, wx, wy, o), R = this.solve(p, o.view ?? 'side'), sh = arm === 'N' ? R.armN.sh : R.armF.sh;
    const k = arm === 'N' ? p.reachK ?? 1 : p.reachKF ?? p.reachK ?? 1;
    const d = Math.hypot(pt[0] - sh[0], pt[1] - sh[1]), L1 = SK.upper * k, L2p = SK.fore * k + SK.paw;
    const short = Math.max(0, d - (L1 + L2p), Math.abs(L2p - L1) - d) * (o.scale ?? 1);
    return { pt, ok: short <= 0.5, short };
  }
  /**
   * Point AT a world point from where the character stands (a gesture, not a touch): the point for reachN. The paw
   * goes out from the shoulder toward the target, `ext` of the arm's length (0.9: the elbow bent, the arm one curve),
   * its rise held between level and `maxRise` (rad above horizontal, 0.62): a target high above still gets a paw at
   * eye level in front of the face, as the pointing squirrel in reference 03 does, never a rod past the crown or across the
   * muzzle. Use reach() when the paw must land on the thing.
   */
  pointAt(x: number, y: number, wx: number, wy: number, o: SqDrawOpts = {}, p: SqPose = POSE.point, ext = 0.9, arm: 'N' | 'F' = 'N', maxRise = 0.62): Pt {
    const pt = this.local(x, y, wx, wy, o), R = this.solve(p, o.view ?? 'side'), sh = arm === 'N' ? R.armN.sh : R.armF.sh;
    // (from the side the paw always goes forward, as before; from the front toward the target's side)
    const side = (o.view ?? 'side') === 'front' && pt[0] < sh[0] ? -1 : 1;
    const rise = clamp(Math.atan2(sh[1] - pt[1], Math.max(1, side * (pt[0] - sh[0]))), -0.1, maxRise);
    const L = ((SK.upper + SK.fore) * (p.reachK ?? 1) + SK.paw) * ext, d = Math.min(L, Math.hypot(pt[0] - sh[0], pt[1] - sh[1]));
    return [sh[0] + side * Math.cos(rise) * d, sh[1] - Math.sin(rise) * d];
  }
  /** Where to stand (the x of the ground point, facing `o.face`) so the near paw reaches (wx, wy) with the arm
   * `ext` of its full length (0.8: a comfortable reach, the elbow bent), in pose p. */
  standFor(wx: number, wy: number, groundY: number, o: SqDrawOpts = {}, p: SqPose = POSE.tap, ext = 0.8): number {
    const s = o.scale ?? 1, face = o.face ?? 1, R = this.solve(p, o.view ?? 'side');
    const sh = R.armN.sh, L = ((SK.upper + SK.fore) * (p.reachK ?? 1) + SK.paw) * ext * s;
    const dy = wy - (groundY + sh[1] * s), dx = Math.sqrt(Math.max(0, L * L - dy * dy));
    return wx - face * (sh[0] * s + dx);
  }

  /** The face's points for the head showing (rig units): the near eye, the nose, the lips. */
  private facePts(p: SqPose, view: SqView, R: ReturnType<Squirrel['solve']>): { eye: Pt; nose: Pt; mouth: Pt } {
    const H = headsAt(p.turn, view === 'front'), i = H.k > 0.5 ? H.b : H.a;
    if (i === 0) {
      const sxP = 1 - 0.22 * smootherstep(0, 0.5, clamp(p.turn, 0, 1));
      return { eye: R.onHead([SK.eye[0] * sxP, SK.eye[1]]), nose: R.onHead([SK.nose[0] * sxP, SK.nose[1]]), mouth: R.onHead([SK.mouth[0] * sxP, SK.mouth[1]]) };
    }
    const G = GEO[i - 1]!;
    return { eye: R.onHead([G.eyes[0]!.x, G.eyes[0]!.y]), nose: R.onHead([G.nose.x, G.nose.y]), mouth: R.onHead([G.mouth.x, G.mouth.y]) };
  }
  /** Where things are, in world px (for props, taps, threads). */
  joints(x: number, y: number, p: SqPose, o: SqDrawOpts = {}): Joints {
    const s = o.scale ?? 1, face = o.face ?? 1, view = o.view ?? 'side', R = this.solve(p, view);
    const W2 = (q: Pt): Pt => [x + face * q[0] * s, y + q[1] * s];
    // (the paws as drawn: from the front a resting paw hangs from its wrist)
    const aN = R.armN.aPaw;
    const tipLen = lerp(38, 56, smootherstep(0.25, 0.75, p.pointN)), d = [Math.cos(aN), Math.sin(aN)], df = [Math.cos(R.armF.aPaw), Math.sin(R.armF.aPaw)];
    const F = this.facePts(p, view, R), tv = view === 'back' ? 'back' : 'side';
    return {
      head: W2(R.onHead([20 * (view === 'front' ? 0 : 1), -100])), eye: W2(F.eye), nose: W2(F.nose), mouth: W2(F.mouth), neck: W2(R.neck),
      pawN: W2(addP(R.armN.wrist, [d[0]! * SK.paw, d[1]! * SK.paw])), pawF: W2(addP(R.armF.wrist, [df[0]! * SK.paw, df[1]! * SK.paw])), tip: W2(addP(R.armN.wrist, [d[0]! * tipLen, d[1]! * tipLen])),
      chest: W2(addP(R.root, rotP([(view === 'front' ? 0 : 40) * this.slim, -150], R.lean))), tailTop: W2(addP(R.tailBase, rotP(tailTop(tv), this.tailRot(p, R.lean, view === 'back')))), shoulderN: W2(R.armN.sh), s,
    };
  }

  /** The tail's angle about its root: it follows a third of the body's lean in profile; seated from behind, the plume
   * rests against the back, so it follows most of it (a hunch over the keys never opens a gap between them). */
  private tailRot(p: SqPose, lean: number, back: boolean) { return lean * (back ? 0.75 : 0.3) + p.tail; }
  /** Draw the squirrel at (x, y) (the ground point under the hip, or the seat point) in pose p. */
  draw(st: Stage, x: number, y: number, p: SqPose, o: SqDrawOpts = {}) {
    const s = o.scale ?? 1, face = o.face ?? 1, view = o.view ?? 'side', back = view === 'back', front = view === 'front', P2 = this.parts;
    const R = this.solve(p, view), rk = p.reachK ?? 1, rkF = p.reachKF ?? rk;
    if (!this.warned && (R.armN.short > 12 || R.armF.short > 12)) {
      this.warned = true;
      console.warn(`[squirrel] ${this.spec.name}: a reach misses by ${Math.round(Math.max(R.armN.short, R.armF.short) * s)} px — place the character with standFor() or move the target`);
    }
    const sil = o.silhouette;
    // under the scene's light the character's rim is the counter rim alone (charLight: from the side away
    // from the key and above), so it never circles the silhouette as a pale outline with the stage's own key-side rim;
    // a scene's own `rim` still sets that key-side one, and a silhouette or `light: false` keeps it as before
    const charLit = !o.silhouette && o.light !== false;
    const rimK = o.rim ?? (charLit ? 0 : 1), rimW = clamp(4 * s, 1.1, 3);
    const flat = sil ? sil.k ?? 0.9 : o.flat;
    // the scene's light (st.look: the rig its Stage has, or a mix): none on a silhouette or with light: false
    const lo = o.light === false || sil ? null : o.light ?? {}, lt = lo ? charLight(st.look) : null;
    const unflat = 1 - clamp(flat ?? 0);
    const kT = lt ? CHAR_LIGHT.tint * (lo!.tint ?? 1) * unflat : 0;
    const keyT: RGB | null = lt && kT > 0 ? [lerp(1, lt.tint[0], kT), lerp(1, lt.tint[1], kT), lerp(1, lt.tint[2], kT)] : null;
    const tint0 = sil ? sil.color : o.tint;
    const tint: Col | undefined = keyT ? (tint0 ? mulCol(tint0, keyT) : keyT) : tint0;
    // the counter rim: an added pass of the tail, the head and the ears under the counter light's look, right after
    // each (so what is drawn over it covers it too); it dims with a darkening tint, a flat fill, the depth's haze and
    // by day (half: a back light reads against the night, against a bright room it would read as an outline)
    const d0 = o.depth ?? 1, hz = o.haze ?? (d0 > 1 && d0 !== Infinity ? Math.min(0.92, st.look.hazeK * (d0 - 1)) : 0);
    const tl = tint0 ? lin(tint0) : null, dimK = tl ? Math.min(1, 0.2126 * tl[0] + 0.7152 * tl[1] + 0.0722 * tl[2]) : 1;
    const kR = lt ? CHAR_LIGHT.rim * st.look.rimK * (0.5 + 0.5 * st.look.night) * (lo!.rim ?? 1) * unflat * dimK * (1 - hz) : 0;
    const rimC = clamp(CHAR_LIGHT.rimPx * Math.min(1, 1.6 * s), 1, CHAR_LIGHT.rimPx);
    const base = { depth: o.depth, haze: o.haze, screen: o.screen, clip: o.clip, flat, rimWidth: rimW };
    const mul = (t: [number, number, number]): Col => (tint ? (Array.isArray(tint) ? [t[0] * tint[0]!, t[1] * tint[1]!, t[2] * tint[2]!] : mulHex(tint, t)) : t);
    // where a back light can't reach the head and the ears: where they lie over the tail's plume (a circle: its centre
    // and radius under the tail's sway and curl, on screen), so their counter rim is kept outside it. A scene's own
    // clip wins: then only the tail takes the counter rim.
    const sceneClip = o.clip === undefined ? st.clip : o.clip;
    let plume: Clip | null | undefined;
    const plumeClip = (): Clip | null => {
      if (plume !== undefined) return plume;
      const v = back ? 'back' : 'side', cu = p.tailCurl, sxT = 1 / Math.sqrt(cu), c = TAIL_DEF[v].c;
      const pc = addP(R.tailBase, rotP([c[0] * sxT, c[1] * cu], this.tailRot(p, R.lean, back)));
      const q = st.project(x + face * pc[0] * s, y + pc[1] * s, o.depth ?? 1);
      plume = { x: q.x, y: q.y, r: PLUME_R[v] * 0.5 * (sxT + cu) * s * q.s, feather: 4, outside: true };
      return plume;
    };
    const put = (a: Art | undefined, q: Pt, rot: number, o2: { sx?: number; sy?: number; tint?: Col; scale?: number; alpha?: number; rimColor?: Col; anchor?: readonly [number, number]; counter?: boolean | 'outer' } = {}) => {
      if (!a) return;
      const al = (o.alpha ?? 1) * (o2.alpha ?? 1);
      if (al <= 0.002) return;
      const X = x + face * q[0] * s, Y = y + q[1] * s;
      const geo = { rot: face * rot, sx: face * (o2.sx ?? 1) * s * (o2.scale ?? 1), sy: (o2.sy ?? 1) * s * (o2.scale ?? 1), anchor: o2.anchor };
      st.sprite(a, X, Y, {
        ...base, ...geo,
        tint: o2.tint ?? tint, alpha: al, rim: rimK * (a.rim ?? 0) * (sil ? 3 : 1), rimColor: o2.rimColor ?? (sil ? sil.rim : undefined) ?? o.rimColor,
      });
      const outer = o2.counter === 'outer'; // the tail: its rim is a silhouette edge, unclipped
      if (lt && kR > 0 && (a.rim ?? 0) > 0 && o2.counter !== false && (outer || !sceneClip)) {
        const clip = outer || o.screen ? o.clip : plumeClip();
        // the stage puts a sprite's rim on the edge facing its look's light: for this pass, the counter light's look
        const old = st.look;
        st.look = lt.look; st.project(0, 0); // project() re-reads the look's light
        try {
          st.sprite(a, X, Y, { depth: o.depth, screen: o.screen, clip, ...geo, haze: 0, flat: 0, add: 1, tint: BLACK, alpha: al, rim: (a.rim ?? 0) * kR, rimWidth: rimC, rimColor: lt.counter });
        } finally { st.look = old; st.project(0, 0); }
      }
    };
    const g = this.spec.gear ?? {};
    // the arm: one tube of discs along its spine (shade discs, then the lit ones shifted toward the lit side), the paw
    const tube = (A: ReturnType<Squirrel['solve']>['armN'], k: number, tn: Col | undefined, paw: Art | null) => {
      const th = Math.sqrt(k) * (front ? 1.06 : 1), K = armKnots(A.sh, A.elbow, A.wrist, SK.rSh * th, SK.rEl * th, SK.rWr * th);
      const dark = g.suit ? P2.suitUpper ?? P2.upper : P2.upper, lit = g.suit ? P2.suitFore ?? P2.fore : P2.fore;
      if (dark) for (const n of K) put(dark, [n.x, n.y], 0, { scale: n.r / DISC_R, tint: tn });
      // (from the front, where the short foreshortened arm folds on itself, the lit discs a little bigger and
      // nearer the spine, so the lit side reads as one smooth rounded volume instead of a lumpy stripe)
      const lk = front ? 0.66 : 0.55, ls = front ? 0.3 : 0.45;
      if (lit) for (const n of K) put(lit, [n.x + n.nx * ls * n.r, n.y + n.ny * ls * n.r], 0, { scale: (lk * n.r) / DISC_R, tint: tn });
      // the suit's cuff, across the forearm a little above the wrist (its tangent: the lit normal turned back)
      if (g.suit && P2.cuff && K.length > 3) { const n = K[K.length - 3]!; put(P2.cuff, [n.x, n.y], Math.atan2(n.nx, -n.ny), { sy: n.r / 26, tint: tn }); }
      // from the front a resting paw hangs from the wrist toward the ground (reference 01's paws at the chest)
      if (paw) put(paw, A.wrist, A.aPaw, { tint: tn });
    };
    // 0 the contact shadow, under it all (profile and front, on the ground or a seat)
    // (and none for a bake whose body was dropped: a second pass that draws only an arm over a prop)
    const kC = lt && !back && !o.noLegs && P2.body && P2.thigh ? CHAR_LIGHT.contact * (lo!.contact ?? 1) * unflat * (o.alpha ?? 1) : 0;
    if (kC > 0.002) {
      // off the ground (a hop, a stride's lift) it shrinks and fades
      const air = clamp(1 - Math.max(0, -p.dy) / 90 - Math.max(0, p.lift - 16) / 70), w = 0.7 + 0.3 * air, cx = x + face * (p.dx + (front ? -18 : 4) * this.slim) * s;
      const co = { depth: o.depth, haze: o.haze, screen: o.screen, clip: o.clip };
      if (air > 0.01) {
        st.contact(cx - face * 6 * s, y + 3 * s, (front ? 290 : 250) * s * this.slim * w, 30 * s * w, { ...co, alpha: 0.6 * kC * air });
        st.contact(cx + face * 8 * s, y + 2 * s, (front ? 200 : 160) * s * this.slim * w, 13 * s * w, { ...co, alpha: 0.75 * kC * air });
      }
    }
    // 1 the tail (behind everything): it sways about its root
    const curl = p.tailCurl;
    put(back ? P2.tailBack : P2.tail, R.tailBase, this.tailRot(p, R.lean, back) + (front ? 0.1 : 0), { sx: (1 / Math.sqrt(curl)) * (front ? 1.08 : 1), sy: curl * (front ? 1.08 : 1), rimColor: sil?.tailRim, counter: 'outer' });
    const hk = this.headK, ex = exprOf(p);
    if (front) {
      // FROM THE FRONT (reference 01): the body, the haunches and feet over it, both arms in front, then the head
      put(g.suit ? P2.suitFront ?? P2.front : P2.front, R.root, 0, { sy: R.sy, counter: false });
      if (g.vest) put(P2.vestFront, R.root, 0, { sy: R.sy, counter: false });
      if (g.backpack) put(P2.straps, R.root, 0, { sy: R.sy, counter: false });
      if (!o.noLegs) {
        for (const L of [R.legF, R.legN]) put(g.suit ? P2.suitThighFront ?? P2.thighFront : P2.thighFront, L.hip, 0);
        put(P2.footFront, R.legF.heel, 0.12); put(P2.footFront, R.legN.heel, -0.12);
      }
      tube(R.armF, rkF, undefined, P2.paw);
      tube(R.armN, rk, undefined, p.pointN > 0.5 ? P2.pawPoint : P2.paw);
      if (o.hold) {
        const d = [Math.cos(R.armN.a2), Math.sin(R.armN.a2)];
        put(o.hold, addP(R.armN.wrist, [d[0]! * SK.paw * 0.6, d[1]! * SK.paw * 0.6]), o.holdRot ?? 0, { scale: o.holdScale ?? 1, sx: face, anchor: o.holdAnchor, tint: undefined, rimColor: undefined, counter: false });
      }
      this.drawHead(put, R, p, ex, true, hk);
      return;
    }
    // 2 far ear, far arm, far leg (behind the body)
    const H = headsAt(p.turn, false);
    const kP = H.a === 0 ? 1 : H.b === 0 ? 1 - H.k : 0;
    if (kP > 0) put(P2.earF, R.onHead(SK.earF), R.headA - 0.62 - 0.18 * (p.ears + ex.ears) + 0.7 * ex.droop, { sy: (1 + 0.08 * (p.ears + ex.ears)) * (g.hat || g.cap ? 0.8 : 1) * (1 - 0.2 * ex.droop), scale: hk, alpha: kP });
    const farUp = !back && R.armF.wrist[1] < R.neck[1] - 10 && R.armF.wrist[0] < R.neck[0]; // a far paw raised behind the crown (cheer)
    const farArm = () => tube(R.armF, rkF, mul(FAR_TINT), P2.paw);
    if (!back) {
      if (!o.noLegs) {
        put(g.suit ? P2.suitThigh : P2.thigh, R.legF.hip, R.legF.a, { tint: mul(FAR_TINT) });
        put(P2.foot, R.legF.heel, R.legF.footA, { tint: mul(FAR_TINT) });
      }
      if (!farUp) farArm();
    } else farArm();
    // 3 the body (and what it wears)
    // (no counter rim on the body: its back edge lies over the tail, where a back light can't reach)
    put(back ? P2.back : P2.body, R.root, R.lean, { sy: R.sy, counter: false });
    if (g.suit) put(back ? P2.suitBack : P2.suit, R.root, R.lean, { sy: R.sy, counter: false });
    if (g.vest) put(back ? P2.vestBack : P2.vest, R.root, R.lean, { sy: R.sy, counter: false });
    if (g.backpack && !back) put(P2.backpack, R.root, R.lean, { sy: R.sy, counter: false });
    // 4 near leg
    if (!back && !o.noLegs) {
      put(g.suit ? P2.suitThigh : P2.thigh, R.legN.hip, R.legN.a);
      put(P2.foot, R.legN.heel, R.legN.footA);
    }
    // 5 the head: profile or turned, eyes, lids, mouth, ears, gear
    this.drawHead(put, R, p, ex, false, hk);
    // a far paw raised up behind the crown (cheer) shows over the back of the head
    if (farUp) farArm();
    // 6 the near arm (in front of the body) and what it holds
    // (a stretched arm thickens with it, √reachK, so it stays one limb as thick as the references' raised arm)
    if (o.hold) {
      tube(R.armN, rk, undefined, null);
      const d = [Math.cos(R.armN.a2), Math.sin(R.armN.a2)];
      // never mirrored (a held sheet's writing must read): sx = face undoes the facing's flip
      put(o.hold, addP(R.armN.wrist, [d[0]! * SK.paw * 0.6, d[1]! * SK.paw * 0.6]), o.holdRot ?? 0, { scale: o.holdScale ?? 1, sx: face, anchor: o.holdAnchor, tint: undefined, rimColor: undefined, counter: false });
      put(p.pointN > 0.5 ? P2.pawPoint : P2.paw, R.armN.wrist, R.armN.a2);
    } else tube(R.armN, rk, undefined, p.pointN > 0.5 ? P2.pawPoint : P2.paw);
  }

  /** The head showing at the pose's turn (a new one fading in over the old at a change) with its face. */
  private drawHead(put: PutFn, R: ReturnType<Squirrel['solve']>, p: SqPose, ex: Expr, front: boolean, hk: number) {
    // (a bake whose head parts were dropped, a scene's arm-only second pass, draws no head)
    if (!this.parts.head && !this.parts.headT) return;
    const H = headsAt(p.turn, front);
    this.drawHeadAt(put, R, p, ex, H.a, 1, hk);
    if (H.k > 0 && H.b !== H.a) this.drawHeadAt(put, R, p, ex, H.b, H.k, hk);
  }
  /** One baked head (0 the profile, 1-3 the turned heads) and its face at alpha `al`. */
  private drawHeadAt(put: PutFn, R: ReturnType<Squirrel['solve']>, p: SqPose, ex: Expr, i: number, al: number, hk: number) {
    const P2 = this.parts, g = this.spec.gear ?? {};
    const earUp = p.ears + ex.ears;
    // the taller ears are a step shorter under a hard hat or a cap, so they still come out of it as ears
    const earK = g.hat || g.cap ? 0.8 : 1;
    // the eyes: open (the pose's blink and wideness, the expression's), and the lids over them
    const eyeOpen = clamp(p.eye, 0, 1.4), wideK = 1 + 0.12 * clamp(ex.wide, 0, 1);
    // (an eye opened wider than 1, startled, is drawn bigger: its lids span it as drawn)
    const big = Math.max(1, eyeOpen);
    const eyeSy = Math.max(0.07, eyeOpen) * hk * wideK, eyeSx = (eyeOpen > 1 ? eyeOpen : 1) * hk * wideK;
    const lidL0 = clamp(ex.lidL + 0.35 * ex.cheek, 0, 1);
    // turned toward us, the round eyes don't squash to close: the lids close over them (a blink, a held squint: the
    // pose's `eye` below 1), so a pleased half-shut look reads as one and never as two dark slits
    const shut = 1 - clamp(eyeOpen, 0, 1);
    // a lens tints what is under it: its glass lifts the dark eye to a mid grey and takes a lowered lid's
    // edge line with it, so behind glasses a lid didn't read. The edge line is drawn again OVER the lens (its part inside
    // the frame's inner edge, in head units less the line's cap): the lid reads through the glass
    const overLens: [Pt, number, { sx: number; scale?: number; sy: number; alpha: number }][] = [];
    const lensR = (turned: boolean) => (turned ? LENS_T_IN : LENS_P_IN) - 1.6;
    // c: the eye's socket (head units); rx, ry: the eye's half-size there (head units, before hk); sx its squash across
    // (a far eye, a squashed profile); sq the profile eye's own blink squash (its rest corner comes down with it)
    const lids = (c: Pt, rx: number, ry: number, sx: number, inner: 1 | -1, near: boolean, turned: boolean, sq = 1, lashK = 1) => {
      const lidUP = turned ? P2.lidUT : P2.lidU, lidLA = turned ? P2.lidLT : P2.lidL;
      const lu = Math.max(clamp(ex.lidU + (near ? 0.35 : -0.35) * ex.asym, 0, 1), turned ? 0.94 * shut : 0);
      const lidL = Math.max(lidL0, turned ? 0.24 * shut : 0);
      const rot = -0.36 * clamp(ex.slant, -1.2, 1.2) * inner, th = R.headA + rot;
      // in profile, inner corners up (worried, sad): the lid's edge ARCHES (paintLidHorns), the arch growing with the
      // slant from nothing (so it starts as the straight lid), the lid set a little deeper so it droops at the back
      const wA = turned || !P2.lidHorns ? 0 : smootherstep(0.15, 0.6, ex.slant);
      let edgeDy = -ry;
      if (lu > 0.004) {
        const top = c[1] - ry - (turned ? 6 : 4), edge = c[1] - ry + 2 * ry * (lu + 0.16 * wA) + 1.2 * Math.abs(ex.slant) * 3;
        edgeDy = edge - c[1];
        const kL = smootherstep(0, 0.06, lu);
        const q0 = R.onHead([c[0], edge]), SX = ((rx + 5) / 30) * sx * hk;
        const H = Math.min(ARCH_H * wA, 0.6 * (edge - top)); // the arch's height (head units)
        if (H < 0.05) {
          put(lidUP, q0, th, { sx: SX, sy: ((edge - top) / 30) * hk, alpha: al });
          // the lid's line is the eye's thick upper lid line carried down: it spans the eye as it is at the
          // lid's edge (its chord), never past the eye's outline onto the cream
          const hl = Math.min((rx + 1) * sx, chordE(edgeDy, rot, rx * sx, ry) + 1.4);
          if (hl > 0.6) put(P2.lidLine, q0, th, { sx: (hl / 29) * hk, scale: 1, sy: hk, alpha: al * kL });
          if (g.glasses) {
            const h = chordInLens(edgeDy, rot, hl, lensR(turned), sx);
            if (h > 1.5) overLens.push([q0, th, { sx: (h / 29) * hk, scale: 1, sy: hk * OVER_LENS.w, alpha: al * kL * OVER_LENS.a }]);
          }
        } else {
          // the straight lid down to the arch's top, the horns under it, the line along the arch in short pieces (so it
          // keeps its width)
          put(lidUP, addP(q0, rotP([0, -H * hk], th)), th, { sx: SX, sy: ((edge - top - H) / 30) * hk, alpha: al });
          put(P2.lidHorns, q0, th, { sx: SX, sy: (H / ARCH_HB) * hk, alpha: al });
          const span = (rx + 1) / (rx + 5), n = 8, at = (u: number): Pt => {
            const v = 0.5 + (u - 0.5) * span;
            return addP(q0, rotP([30 * (2 * v - 1) * SX, -4 * v * (1 - v) * H * hk], th));
          };
          // (the same points about the eye's centre, head units: for the pieces drawn again over a lens)
          const local = (u: number): Pt => { const v = 0.5 + (u - 0.5) * span; return addP([0, edge - c[1]], rotP([(2 * v - 1) * (rx + 5) * sx, -4 * v * (1 - v) * H], rot)); };
          for (let k = 0; k < n; k++) {
            const A = at(k / n), B = at((k + 1) / n), L = Math.hypot(B[0] - A[0], B[1] - A[1]);
            const q: Pt = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], a = Math.atan2(B[1] - A[1], B[0] - A[0]), o2 = { sx: (L / 58) * 1.12, sy: hk, alpha: al * kL };
            put(P2.lidLine, q, a, o2);
            if (g.glasses && inLens(local(k / n), lensR(turned), sx) && inLens(local((k + 1) / n), lensR(turned), sx)) overLens.push([q, a, { ...o2, sy: hk * OVER_LENS.w, alpha: al * kL * OVER_LENS.a }]);
          }
          edgeDy -= H;
        }
      }
      if (lidL > 0.004) {
        const bot = c[1] + ry + 6, edge = c[1] + ry - 1.4 * ry * lidL;
        put(lidLA, R.onHead([c[0], edge]), R.headA, { sx: ((rx + 5) / 30) * sx * hk, sy: ((bot - edge) / 30) * hk, alpha: al });
      }
      // the lash, a small flick at the eye's OUTER corner (reference 02, 07, 08), where the upper lid's line
      // ends: at rest the eye's upper outer corner, riding the lid's end down the eye's outline as the lid lowers
      if (P2.lash && lashK > 0.01) {
        const out = -inner, ryS = ry * sq, dy = Math.max(edgeDy, -0.52 * ryS), xk = Math.sqrt(Math.max(0, 1 - (dy / Math.max(1e-3, ryS)) ** 2));
        const k = rx / (turned ? FM.eye.rx : EYE_P.rx);
        put(P2.lash, R.onHead([c[0] + out * (rx * xk * sx + 0.6), c[1] + dy]), th, { sx: out * hk * k * Math.max(0.55, sx), sy: hk * k, alpha: al * lashK });
      }
    };
    // a brow above each eye (reference 02, 05, 07, 08: a small dark arc on the cream ring's top edge, never
    // on the full front, reference 01): it acts with the face, up with wide eyes and a worry (its inner end up with the
    // lids' slant), down with lowered lids and a frown, one up and one down when skeptical
    const brow = (c: Pt, rx: number, ry: number, sx: number, inner: 1 | -1, near: boolean, kA: number) => {
      if (!P2.brow || kA <= 0.01) return;
      const asy = (near ? 1 : -1) * ex.asym;
      const lift = 6 * clamp(ex.wide, 0, 1) + 2.5 * Math.max(0, ex.slant) - 3.5 * Math.max(0, -ex.slant) - 4 * clamp(ex.lidU, 0, 1) - 4 * asy - 2.5 * Math.min(0, ex.lookY) + (g.glasses ? 6 : 0);
      const rotB = -0.3 * clamp(ex.slant, -1.2, 1.2) * inner;
      put(P2.brow, R.onHead([c[0] - inner * 0.16 * rx * sx, c[1] - ry - 8.5 - lift]), R.headA + rotB, { sx: -inner * hk * Math.max(0.45, sx) * ((0.72 * rx) / 15), sy: hk, alpha: al * kA });
    };
    // the mouth: the closed shapes by weight, the open one over them
    const wS = Math.max(0, ex.smile), wF = Math.max(0, -ex.smile), wFl = clamp(ex.flat), wW = clamp(ex.wavy);
    const sum = wS + wF + wFl + wW, nk = sum > 1 ? 1 / sum : 1, wN = Math.max(0, 1 - sum);
    const sharpen = (w: number) => w * w * (3 - 2 * w);
    const mw: [MouthKey, number][] = ([['w', wN], ['smile', wS * nk], ['frown', wF * nk], ['flat', wFl * nk], ['wavy', wW * nk]] as [MouthKey, number][]).map(([k, w]) => [k, sharpen(clamp(w))]);
    const mwSum = mw.reduce((a, [, w]) => a + w, 0) || 1;
    const open = clamp(Math.max(p.mouth, ex.open), 0, 1.2);
    const mx = 5 * ex.asym, mrot = -0.14 * ex.asym;
    if (i === 0) {
      // PROFILE (the approved head)
      const sxP = 1 - 0.22 * smootherstep(0, 0.5, clamp(p.turn, 0, 1));
      put(P2.head, R.neck, R.headA, { scale: hk, sx: sxP, alpha: al });
      const look: Pt = [5 * clamp(ex.lookX, -1, 1), 5 * clamp(ex.lookY, -1, 1)];
      put(P2.eye, R.onHead([(SK.eye[0] + look[0]) * sxP, SK.eye[1] + look[1]]), R.headA, { sy: eyeSy, sx: eyeSx * sxP, alpha: al });
      lids([SK.eye[0] * sxP, SK.eye[1]], EYE_P.rx * wideK * big, EYE_P.ry * wideK * big, sxP, 1, true, false, Math.min(1, Math.max(0.07, eyeOpen)));
      brow([SK.eye[0] * sxP, SK.eye[1]], EYE_P.rx * wideK * big, EYE_P.ry * wideK * big, sxP, 1, true, 1);
      for (const [k, w] of mw) if (w > 0.01) put(P2.mouthP?.[k], R.onHead([SK.lip[0] * sxP + mx * 0.5, SK.lip[1]]), R.headA + mrot * 0.5, { scale: hk, sx: sxP, alpha: al * (w / mwSum) });
      if (open > 0.02) {
        const rd = clamp(ex.round);
        put(P2.mouth, R.onHead([SK.mouth[0] * sxP, SK.mouth[1]]), R.headA, { sx: (0.4 + 0.6 * open) * hk * sxP * (1 - 0.35 * rd), sy: open * hk * (1 + 0.1 * rd), alpha: al });
      }
      if (ex.cheek > 0.02) put(P2.blush, R.onHead([66 * sxP, -60]), R.headA, { scale: hk, sx: sxP, alpha: al * 0.5 * clamp(ex.cheek) });
      if (g.glasses) put(P2.glasses, R.onHead([SK.eye[0] * sxP, SK.eye[1]]), R.headA, { scale: hk, sx: sxP, alpha: al });
      for (const [q, a, o2] of overLens) put(P2.lidLine, q, a, o2);
      // the ear more upright (the references: tall, upright ears), its base where it was
      put(P2.earN, R.onHead(SK.earN), R.headA - 0.36 - 0.2 * earUp + 0.25 * p.earTwitch + 0.75 * ex.droop, { sy: (1 + 0.1 * earUp) * hk * earK * (1 - 0.22 * ex.droop), sx: hk, alpha: al });
      if (P2.tuft) put(P2.tuft, R.onHead(SK.tuft), R.headA - 0.12, { scale: hk, alpha: al });
      if (g.hat) put(P2.hat, R.neck, R.headA, { scale: hk, sx: sxP, alpha: al });
      if (g.cap) put(P2.cap, R.neck, R.headA, { scale: hk, sx: sxP, alpha: al });
      return;
    }
    // TURNED TOWARD US (reference 02 at 30°, reference 01 at 0°): both ears behind the skull (the right one mirrored, so
    // each ear's fold lies toward the head), the head, the eyes in their rings
    const G = GEO[i - 1]!;
    G.ears.forEach((e, j) => {
      const sd = j === 0 ? -1 : 1;
      put(P2.earN, R.onHead([e.x, e.y]), R.headA + e.rot + sd * 0.16 * earUp * (1 - G.ps) - 0.18 * earUp * G.ps + (j === 0 ? 0.25 * p.earTwitch : 0) + ex.droop * (0.6 * G.ps - sd * 0.45 * (1 - G.ps)), { sy: (1 + 0.1 * earUp) * hk * earK * (1 - 0.22 * ex.droop), sx: -sd * hk * e.sx, alpha: al });
    });
    put(P2.headT?.[i - 1], R.neck, R.headA, { scale: hk, alpha: al });
    const look: Pt = [7 * clamp(ex.lookX, -1, 1), 6 * clamp(ex.lookY, -1, 1)];
    // (no brows and no lash flicks on the full front, reference 01; turned, they come in: reference 02)
    const browK = smootherstep(4, 20, G.yaw);
    for (let j = 1; j >= 0; j--) {
      const e = G.eyes[j]!;
      if (e.vis <= 0.02) continue;
      // each eye's iris toward the nose (the white a crescent on its outer side: reference 01, 02), its glints
      // on the iris, up and toward the way the face looks
      const ex0 = e.x + look[0] * e.sx, ey0 = e.y + look[1], sY = Math.max(eyeSy, hk * wideK);
      put(P2.eyeT, R.onHead([ex0, ey0]), R.headA, { sx: eyeSx * e.sx * e.inner, sy: sY, alpha: al * e.vis });
      put(P2.glintT, R.onHead([ex0 + e.inner * IRIS_T.dx * (eyeSx / hk) * e.sx, ey0 + IRIS_T.dy * (sY / hk)]), R.headA, { sx: eyeSx * Math.max(0.5, e.sx), sy: sY, alpha: al * e.vis });
      lids([e.x, e.y], FM.eye.rx * wideK * big, FM.eye.ry * wideK * big, e.sx, e.inner, j === 0, true, 1, browK);
      brow([e.x, e.y], FM.eye.rx * wideK * big, FM.eye.ry * wideK * big, e.sx, e.inner, j === 0, browK * e.vis);
      if (ex.cheek > 0.02 && G.blush[j]!.vis > 0.02) put(P2.blush, R.onHead([G.blush[j]!.x, G.blush[j]!.y]), R.headA, { scale: hk, sx: G.blush[j]!.sx, alpha: al * 0.5 * clamp(ex.cheek) * G.blush[j]!.vis });
    }
    const M = G.mouth, mq = R.onHead([M.x + mx, M.y]);
    const closedK = 1 - smootherstep(0.08, 0.4, open);
    if (closedK > 0.01) for (const [k, w] of mw) if (w > 0.01) put(P2.mouthT?.[k], mq, R.headA + mrot, { scale: hk, sx: M.sx, alpha: al * closedK * (w / mwSum) });
    if (open > 0.02) {
      // the shape: the expression's (round), or for the pose's own open mouth a grin when it smiles, else an 'o'
      // (the pose's own open mouth, no expression: an 'o' when the eyes are wide (startled), else a grin (a cheer, a beam))
      const rd = ex.open > 0.02 || ex.round !== 0 ? clamp(ex.round) : ex.smile > 0.25 ? 0 : p.eye >= 1.1 ? 1 : 0, oy = 0;
      if (rd < 0.99) put(P2.grinT, mq, R.headA + mrot, { scale: hk, sx: M.sx * (0.7 + 0.3 * clamp(open)), sy: clamp(open), alpha: al * (1 - rd) * smootherstep(0.02, 0.25, open) });
      if (rd > 0.01) put(P2.ohT, R.onHead([M.x + mx, M.y + oy]), R.headA, { scale: hk, sx: M.sx * (0.7 + 0.3 * clamp(open)), sy: 0.55 + 0.45 * clamp(open), alpha: al * rd * smootherstep(0.02, 0.25, open) });
    }
    if (g.glasses && P2.lensT && P2.bar) {
      const [eN, eF] = G.eyes as [FeatT, FeatT], rL = LENS_T;
      for (const e of [eF, eN]) if (e.vis > 0.02) put(P2.lensT, R.onHead([e.x, e.y]), R.headA, { scale: hk, sx: e.sx, alpha: al * e.vis });
      for (const [q, a, o2] of overLens) put(P2.lidLine, q, a, o2);
      // the bridge between the lenses' inner edges, the temples from the outer edges back toward the ears
      const bar = (a: Pt, b: Pt, k = 1) => { const qa = R.onHead(a), qb = R.onHead(b), L2 = Math.hypot(qb[0] - qa[0], qb[1] - qa[1]); if (L2 > 1) put(P2.bar, qa, Math.atan2(qb[1] - qa[1], qb[0] - qa[0]), { sx: L2 / 40, sy: hk, alpha: al * k }); };
      if (eF.vis > 0.02) bar([eN.x + eN.inner * rL * eN.sx, eN.y - 4], [eF.x + eF.inner * rL * eF.sx, eF.y - 4], eF.vis);
      bar([eN.x - eN.inner * rL * eN.sx, eN.y - 6], [eN.x - eN.inner * (rL * eN.sx + 18 + 40 * G.ps), eN.y - 10]);
      if (eF.vis > 0.5 && G.ps < 0.3) bar([eF.x - eF.inner * rL * eF.sx, eF.y - 6], [eF.x - eF.inner * (rL * eF.sx + 16), eF.y - 10], eF.vis);
    }
    if (P2.tuft) put(P2.tuft, R.onHead(G.tuft), R.headA - 0.12 * G.ps, { scale: hk, alpha: al });
    if (g.hat && P2.hatT) put(P2.hatT[i - 1], R.neck, R.headA, { scale: hk, alpha: al });
    if (g.cap && P2.capT) put(P2.capT[i - 1], R.neck, R.headA, { scale: hk, alpha: al });
  }
}
type PutFn = (a: Art | undefined, q: Pt, rot: number, o2?: { sx?: number; sy?: number; tint?: Col; scale?: number; alpha?: number; rimColor?: Col; anchor?: readonly [number, number]; counter?: boolean | 'outer' }) => void;
const BLACK: RGB = [0, 0, 0];
/** a colour (hex or linear) times a linear multiply */
const mulCol = (c: Col, t: RGB): RGB => (Array.isArray(c) ? [c[0] * t[0], c[1] * t[1], c[2] * t[2]] : mulHex(c, t));
function mulHex(h: string, t: [number, number, number]): [number, number, number] {
  const n = parseInt(h.replace('#', ''), 16), s2l = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return [s2l(((n >> 16) & 255) / 255) * t[0], s2l(((n >> 8) & 255) / 255) * t[1], s2l((n & 255) / 255) * t[2]];
}
