import type { PostParams } from '../engine/post';

// The Nutlight kit's colours. The settings' palettes and their lights (SettingPalette, LIGHTS), the squirrels' fur
// (FUR) and gear (GEAR) further down are what scenes use, through a rig (light.ts). First, the Stage's act palettes
// (ACTS): plainer looks the Stage can also take (new Stage(ctx, 'III')), and the source of the Look type the rigs
// fill. Colours are sRGB hex. `light.angle` is the direction TOWARD the key light on screen
// in degrees (0 = from the right, -90 = from straight above, y down); `elevation` 0..1 how high it stands over the
// picture plane (spheres and lit marks: 0 grazing, 1 frontal); `rim` the strength of the rim light it lays on
// silhouettes; `haze` how fast far layers fade into the sky (per unit of depth past 1).
export interface ActTokens {
  name: string;
  skyTop: string; skyBottom: string; horizon: string;
  ground: string; key: string; fill: string; rim: string; shadow: string; haze: string;
  ink: string; paper: string;
  accents: readonly string[];
  /** The act's materials: the same named things in every act, each in that act's light (see MATERIALS). */
  mat: Readonly<Record<MaterialKey, string>>;
  light: { angle: number; elevation: number; rim: number; haze: number };
  post: Partial<PostParams>;
}

/**
 * Named materials every act defines in its own light, so a painter asks for `l.hex.mat.wood` and the same house,
 * town or planet is right at night, at dusk and at morning. Scenes take colours from these, the act's tokens and
 * accents, never from hex literals of their own (bun run check lints it).
 *   wall, wallAlt   facades and house walls (pages in the town); roof   roof tiles
 *   wood            counters, tables, beams;  metal   appliances, steel, frames
 *   foliage, foliageDeep   trees and plants, their shade side;  land   fields seen from high above
 *   water           sea, river, ocean from orbit;  cloud, cloudShade   clouds and smoke, lit and shaded sides
 *   window          a lit line of text / window at night, the glass's sky by day;  lamp   an interior warm light
 *   street, traffic road surface, the lights of what drives on it (links: never amber or coral)
 *   city            lights of towns seen from orbit;  moon   the night's key light source (and the sun's disc by day)
 */
export type MaterialKey = 'wall' | 'wallAlt' | 'roof' | 'wood' | 'metal' | 'foliage' | 'foliageDeep' | 'land' | 'water' |
  'cloud' | 'cloudShade' | 'window' | 'lamp' | 'street' | 'traffic' | 'city' | 'moon';

export const ACTS = {
  /** II · Abrir: the glass lifts; slate and teal giving way to cool daylight from the side; full colour arrives. */
  II: {
    name: 'Abrir',
    skyTop: '#3D6B7A', skyBottom: '#BCDCD5', horizon: '#F2E9CF',
    ground: '#4E7F79', key: '#F3FAF5', fill: '#7DA6B2', rim: '#F1FFF9', shadow: '#1C3842', haze: '#A6CCC8',
    ink: '#0F2129', paper: '#F4F7F5',
    accents: ['#E8744F', '#F2B84B', '#2E8FA3', '#E9D8B4', '#C9473F'], // terracotta, ochre, harbour blue, sand, lighthouse red
    mat: { wall: '#EFE4CC', wallAlt: '#D5E4DF', roof: '#C25B44', wood: '#9A6B47', metal: '#BFCFD1', foliage: '#5E9A7A', foliageDeep: '#2D6155', land: '#86AE86', water: '#2E8FA3', cloud: '#F6FAF7', cloudShade: '#B3CDCB', window: '#CFE6EC', lamp: '#FFD08A', street: '#6E8B8C', traffic: '#FFF4D6', city: '#FFD08A', moon: '#FFF8E8' },
    light: { angle: -150, elevation: 0.45, rim: 0.55, haze: 0.22 },
    post: { bloom: 0.22, bloomThreshold: 1.1, bloomRadius: 0.55, grain: 0.03, vignette: 0.24, ca: 0.6 },
  },
  /** III · Relacionar: deep blue night, cyan light, white; the town of pages; a few stars. */
  III: {
    name: 'Relacionar',
    skyTop: '#030817', skyBottom: '#0E2350', horizon: '#2A5C9C',
    ground: '#0A1630', key: '#9FE4FF', fill: '#1C3768', rim: '#A9EEFF', shadow: '#02040D', haze: '#173462',
    ink: '#050B1A', paper: '#E6F0FF',
    accents: ['#3FD3FF', '#DDEBFF', '#FFC24A', '#FF7C8C', '#7DF0C0'], // cyan light, window white, motif amber, motif coral, motif mint
    mat: { wall: '#2A4677', wallAlt: '#2E3F7A', roof: '#3B5C93', wood: '#33395E', metal: '#7F97BF', foliage: '#1F5266', foliageDeep: '#0E2B40', land: '#10244A', water: '#0B1F4C', cloud: '#3B5A8E', cloudShade: '#18295A', window: '#A8C6F0', lamp: '#FFD58A', street: '#081226', traffic: '#E6FBFF', city: '#FFC27A', moon: '#EAF6FF' },
    light: { angle: -55, elevation: 0.5, rim: 0.7, haze: 0.3 },
    post: { bloom: 0.45, bloomThreshold: 0.95, bloomRadius: 0.62, grain: 0.035, vignette: 0.34, ca: 0.8 },
  },
  /** IV · Experimentar: warm yellow, cream and orange daylight; big objects, open compositions. */
  IV: {
    name: 'Experimentar',
    skyTop: '#86CBE6', skyBottom: '#FFE3A8', horizon: '#FFC46E',
    ground: '#E7A057', key: '#FFE6B0', fill: '#F2B391', rim: '#FFF5DA', shadow: '#8A4930', haze: '#FFDCB0',
    ink: '#3A2217', paper: '#FFF7E8',
    accents: ['#E8553E', '#2FA39A', '#FFD24D', '#C27A3A', '#5AA9E6'], // tomato, teal, butter, toast, sky blue
    mat: { wall: '#FFE6C0', wallAlt: '#DCEFE6', roof: '#C9573E', wood: '#C07034', metal: '#E3DCD0', foliage: '#78A865', foliageDeep: '#3C7A5A', land: '#86AE6A', water: '#3D8ED0', cloud: '#FFFBF3', cloudShade: '#EBC3A6', window: '#BFE6F5', lamp: '#FFD58A', street: '#B98E6E', traffic: '#FFF6E0', city: '#FFD08A', moon: '#FFF6DA' },
    light: { angle: -35, elevation: 0.55, rim: 0.6, haze: 0.2 },
    post: { bloom: 0.3, bloomThreshold: 1.05, bloomRadius: 0.6, grain: 0.03, vignette: 0.2, ca: 0.6 },
  },
  /** V · Duvidar: dusk blue-violet to night; a study lamp; the town fogging over. */
  V: {
    name: 'Duvidar',
    skyTop: '#14123A', skyBottom: '#5A4E8E', horizon: '#C98AA0',
    ground: '#221E46', key: '#FFC07A', fill: '#4B4E8E', rim: '#FFDAA8', shadow: '#0B0A20', haze: '#7C74AE',
    ink: '#0E0C22', paper: '#F1ECF6',
    accents: ['#FFB45E', '#D98BA6', '#6F8FD0', '#A9C7FF', '#E1251B'], // lamp amber, dusk rose, steel blue, pale blue, red
    mat: { wall: '#4A4478', wallAlt: '#584A82', roof: '#3A3468', wood: '#6A4A5C', metal: '#A6A3C8', foliage: '#3B5874', foliageDeep: '#232C50', land: '#2F2B5A', water: '#3A3D7C', cloud: '#A396C8', cloudShade: '#4E4F8E', window: '#FFD9A0', lamp: '#FFC07A', street: '#28244E', traffic: '#FFE6C0', city: '#FFC07A', moon: '#FFE9D0' },
    light: { angle: -120, elevation: 0.4, rim: 0.6, haze: 0.4 },
    post: { bloom: 0.4, bloomThreshold: 1.0, bloomRadius: 0.6, grain: 0.04, vignette: 0.4, ca: 0.8 },
  },
  /** VI · Construir: night sky, then space; indigo, a warm sun on a planet's rim, blue shadows. */
  VI: {
    name: 'Construir',
    skyTop: '#01020A', skyBottom: '#0A1340', horizon: '#3A6EE0',
    ground: '#0C1A4A', key: '#FFD08A', fill: '#2A4DB0', rim: '#FFE3B2', shadow: '#040A26', haze: '#13245E',
    ink: '#03040C', paper: '#EAF0FF',
    accents: ['#FFC35A', '#9FE8FF', '#FF9A5C', '#6FB4FF', '#FFFFFF'], // gold route, crystal cool, organic warm, blueprint, white
    mat: { wall: '#22337A', wallAlt: '#283A86', roof: '#2E4290', wood: '#3A3152', metal: '#9FB0D8', foliage: '#2A5A6A', foliageDeep: '#122E44', land: '#3F6B52', water: '#0D2C6E', cloud: '#E3EBFF', cloudShade: '#40528E', window: '#FFD08A', lamp: '#FFD08A', street: '#14204A', traffic: '#FFE3B2', city: '#FFC27A', moon: '#FFE6B8' },
    light: { angle: -12, elevation: 0.35, rim: 0.85, haze: 0.25 },
    post: { bloom: 0.55, bloomThreshold: 0.9, bloomRadius: 0.7, grain: 0.03, vignette: 0.3, ca: 0.7 },
  },
} as const satisfies Record<string, ActTokens>;

export type ActKey = keyof typeof ACTS;

/**
 * The thread's colours (one luminous line through the film; its colour is its job). `verify` is the drafting red
 * (PALETTE.red) as light, for a line drawn on a dark ground; on paper or a light ground use `verifyInk` (the red
 * itself). `link`: a hyperlink, a road between pages. `route`: a warm gold route.
 * `path`: a trajectory or an orbit drawn from a law.
 */
export const THREAD = {
  verify: '#FF3D2E', verifyInk: '#E1251B', link: '#8FE9FF', route: '#FFC35A', path: '#FFE9B8',
} as const;


// ==== The settings: one world under several lights ===================================================================
// Deep navy and teal night, cyan light in machines and conduits, warm amber interiors and lamps, coral and orange
// squirrels; and the same world in the morning, at dusk, at sunset, in a golden hall. light.ts turns each into a rig
// per location; scenes take every colour from a rig (`R.c.<key>`), never a hex of their own. A setting these don't
// cover gets its own palette here, spread from the nearest one (`{ ...NIGHT, … }`), and its own entry in LIGHTS.

/** The world's colours under one light (sRGB hex). Every palette has the same keys, so a painter asks for `c.tower`
 * and gets the tower at night, at dusk or in the morning. */
export interface SettingPalette {
  // sky and air
  space: string; skyTop: string; skyMid: string; skyLow: string; haze: string; cloud: string; cloudLit: string;
  moon: string; moonGlow: string; starWarm: string; starCool: string;
  // vegetation, ground
  leafNear: string; leafMid: string; leafFar: string; leafLit: string; leafMoon: string; ground: string; path: string;
  /** the references' foliage: dark teal-green clumps, their moonlit edge, the warm edge by a lit window */
  leafTeal: string; leafTealLit: string; leafWarm: string;
  // the server city
  tower: string; towerSide: string; towerEdge: string; towerFar: string; towerHaze: string; rack: string; rackGroove: string;
  slot: string; slotDim: string; led: string; fan: string; conduit: string; conduitGlow: string; packet: string;
  motif: string; windowWarm: string;
  /** viaduct decks and pillars (lighter than the towers behind them), an unlit LED (never black) */
  deck: string; deckLit: string; ledOff: string; slotOff: string;
  // the cabin (wood, warm interior)
  wallLit: string; wall: string; wallShade: string; beam: string; beamLit: string; wood: string; woodDark: string;
  floor: string; rug: string; rugInner: string; roof: string; roofEdge: string; brick: string; lampShade: string;
  lampLight: string; warmLight: string; book1: string; book2: string; book3: string; book4: string; pot: string;
  plant: string; plantLit: string; frame: string; paper: string; ink: string;
  // tech
  desk: string; deskTop: string; chair: string; chairLit: string; bezel: string; screen: string; screenGlow: string;
  code1: string; code2: string; code3: string; code4: string; device: string; metal: string; metalLit: string;
  // the hub
  hubBg: string; struct: string; structLit: string; structDeep: string; module: string; moduleTop: string; moduleSide: string;
  core: string; holo: string; warn: string; spark: string; verify: string;
  // space
  galaxy1: string; galaxy2: string; brainLight: string; brain: string; brainShade: string; brainDeep: string;
  cerebellum: string; netCyan: string; netGold: string; earthOcean: string; earthLand: string; earthCloud: string;
  earthCity: string; atmosphere: string;
  // the Moon base
  regolith: string; regolithShade: string; rock: string; domeGlass: string; solar: string; baseMetal: string;
  stripAmber: string; stripCyan: string;
  // the road and the open country: the asphalt and its
  // sheen, the lane paint, a kerb's face and top; fields of wheat and meadow (lit, in shade); hills near and far; water
  // and its glint; the sun's disc (its pale core, its deep lower edge) and its glow
  asphalt: string; asphaltLit: string; lane: string; kerb: string; kerbTop: string;
  field: string; fieldLit: string; fieldShade: string; meadow: string; meadowLit: string;
  hill: string; hillLit: string; hillFar: string; water: string; waterLit: string;
  sun: string; sunEdge: string; sunGlow: string;
  /** the thin back light a character takes from the side away from the key (light.ts's charLight):
   * the night world's cyan, the sunset's gold */
  charRim: string;
}

/** Night: the film's constant (: reference 03, 05, 08 — the same world more LUMINOUS: the
 * mid values saturated cobalt and indigo instead of murky navy, far layers sinking into a bright azure haze, a cream
 * moon; near-black kept for the foreground silhouettes: leafNear, leafTeal, rackGroove, structDeep, roofEdge, chair).
 * Its VALUE STRUCTURE (the grade): the atmosphere (sky*, haze, cloud*, towerFar, towerHaze, hubBg) stays
 * mid-value cobalt; the structure (tower*, rack, struct*, module*, metal, deck, conduit, screen, device) sits a step
 * deeper, saturated navy and indigo, so near things read dark against the haze and the lights (slot*, conduitGlow,
 * core, holo, code1: saturated cyan, never washed toward white) pop off them. */
export const NIGHT: SettingPalette = {
  space: '#05164A', skyTop: '#072C7A', skyMid: '#1046A0', skyLow: '#2268C4', haze: '#2466C0', cloud: '#164696', cloudLit: '#2E76D4',
  moon: '#F6E4C4', moonGlow: '#6E9EE0', starWarm: '#FFE2A8', starCool: '#BFE6FF',
  leafNear: '#010814', leafMid: '#061830', leafFar: '#1C4474', leafLit: '#4E5A2A', leafMoon: '#1E4C7E', ground: '#030A1C', path: '#173464',
  leafTeal: '#03171F', leafTealLit: '#1C5262', leafWarm: '#6E5828',
  tower: '#081A46', towerSide: '#040E2E', towerEdge: '#3A80D8', towerFar: '#1E56A6', towerHaze: '#2C70CC', rack: '#0C2858', rackGroove: '#010820',
  slot: '#30DCFF', slotDim: '#1AA0E0', led: '#FFC23A', fan: '#061634', conduit: '#0C326A', conduitGlow: '#38E2FF', packet: '#FFB73A',
  motif: '#FFE3A0', windowWarm: '#FFB45A',
  deck: '#0F3270', deckLit: '#2E7AD2', ledOff: '#3A2814', slotOff: '#0C2E5C',
  wallLit: '#E89238', wall: '#B8642C', wallShade: '#703620', beam: '#5C2C1A', beamLit: '#A45828', wood: '#7E4024', woodDark: '#3C1E14',
  floor: '#9E4E2C', rug: '#F0862A', rugInner: '#4A1C1A', roof: '#0A1632', roofEdge: '#040A1E', brick: '#443A52', lampShade: '#1C1A24',
  lampLight: '#FFE7A0', warmLight: '#FFB050', book1: '#7A3A2E', book2: '#2E4458', book3: '#A86A2E', book4: '#4E5A3A', pot: '#3A3646',
  plant: '#28462E', plantLit: '#5E7A34', frame: '#2A1A16', paper: '#F3EADB', ink: '#1A1E2A',
  desk: '#3A1E16', deskTop: '#5E3220', chair: '#08142E', chairLit: '#203C7A', bezel: '#0A1428', screen: '#051A40', screenGlow: '#1E8ED6',
  code1: '#44DAF8', code2: '#FFB040', code3: '#FF8A6E', code4: '#CFE6F2', device: '#0D1834', metal: '#173670', metalLit: '#5C9CE8',
  hubBg: '#0A2660', struct: '#081E4E', structLit: '#2A70CC', structDeep: '#010718', module: '#12387A', moduleTop: '#2E74CC', moduleSide: '#0A2252',
  core: '#48EAFA', holo: '#4CDCFA', warn: '#FF5A48', spark: '#FF8A2E', verify: '#FF3D2E',
  galaxy1: '#30247A', galaxy2: '#12428E', brainLight: '#FFBE5A', brain: '#F2903E', brainShade: '#D0605A', brainDeep: '#8E3656',
  cerebellum: '#9A3E5E', netCyan: '#3FE8FF', netGold: '#FFE07A', earthOcean: '#0A2A5E', earthLand: '#18394C', earthCloud: '#8AA8D2',
  earthCity: '#FFB44A', atmosphere: '#5ECBF5',
  regolith: '#C9C5CF', regolithShade: '#6E6A7A', rock: '#55525F', domeGlass: '#9FB6CC', solar: '#1E3466', baseMetal: '#B8BCC8',
  stripAmber: '#FFB444', stripCyan: '#3FD2F2',
  // the night street by the cabin: near-black asphalt, its sheen under a lamp, pale paint, a moonlit kerb;
  // the country in the dark (the time-lapse starts here); the sun under the horizon at night (its keys are the
  // dawn's, so it rises warm through the time-lapse)
  asphalt: '#0B1830', asphaltLit: '#20365C', lane: '#8494AC', kerb: '#12244A', kerbTop: '#36588A',
  field: '#0E2638', fieldLit: '#1C405C', fieldShade: '#06122A', meadow: '#0C2430', meadowLit: '#1A4248',
  hill: '#122C58', hillLit: '#28508A', hillFar: '#204C8A', water: '#0A2858', waterLit: '#5A98D8',
  sun: '#FFE2B4', sunEdge: '#FF8C5A', sunGlow: '#D8784E',
  charRim: '#9EE6FF',
};

/** Morning: warm daylight, coral and amber, a pale teal sky. */
export const MORNING: SettingPalette = {
  ...NIGHT,
  skyTop: '#4E9CD8', skyMid: '#98CEEA', skyLow: '#FFE0B0', haze: '#B4D6E8', cloud: '#FFF2DE', cloudLit: '#FFFFFF',
  moon: '#FFF4D8', moonGlow: '#FFE0A0', charRim: '#FFF4E0',
  leafNear: '#0E2622', leafMid: '#3E6A4E', leafFar: '#7AA88A', leafLit: '#A6CA66', leafMoon: '#5E8A6A', ground: '#6E8A5A', path: '#C8A07A',
  leafTeal: '#1A4238', leafTealLit: '#6AA080', leafWarm: '#E0C070', deck: '#7A98B4', deckLit: '#C8DCEC', ledOff: '#8A7050', slotOff: '#4E7A98',
  tower: '#4E7090', towerSide: '#3A5878', towerEdge: '#A8C8E0', towerFar: '#7EA0BC', towerHaze: '#A8C8D8', rack: '#5A7C9C', rackGroove: '#2E4862',
  slot: '#7EF0FF', slotDim: '#4EB0D0', fan: '#2E4862', conduit: '#3E7090', windowWarm: '#FFE0A0',
  wallLit: '#FFD7A0', wall: '#F2B47A', wallShade: '#C07850', beam: '#9A5A34', beamLit: '#D08A50', wood: '#B8703E', woodDark: '#7A4428',
  floor: '#C87A4A', rugInner: '#9A4A30', roof: '#3A4660', roofEdge: '#26304A', brick: '#8A6A6A', lampShade: '#3A3646',
  plant: '#3E7A4A', plantLit: '#8AC060', frame: '#6A4430',
  desk: '#8A5434', deskTop: '#B87448', chair: '#2E4A7A', chairLit: '#5A7AB0', screen: '#0E3050', device: '#3A4458', metal: '#8A9AB0', metalLit: '#E8F0F8',
  // the daylight's own values for the keys the night's value structure deepened or saturated
  struct: '#113A7C', structLit: '#2E72C6', structDeep: '#030C26', module: '#1E529A', moduleTop: '#3274C2', moduleSide: '#143A7A',
  core: '#56EAF5', holo: '#5CE0F8', code1: '#4FDCF5', conduitGlow: '#48E6FF', screenGlow: '#2488C6',
};

/** Dusk: violet-blue sky, a warm horizon, study-lamp amber. */
export const DUSK: SettingPalette = {
  ...NIGHT,
  skyTop: '#142E86', skyMid: '#3A5CB8', skyLow: '#E8949A', haze: '#5C7CCC', cloud: '#4A64B6', cloudLit: '#F4B0A0',
  moon: '#FFE6CC', moonGlow: '#E8A8B4',
  leafNear: '#0A0A24', leafMid: '#182452', leafFar: '#2E4480', leafMoon: '#3E5492', leafTeal: '#121838', leafTealLit: '#3A5090', leafWarm: '#C08468',
  tower: '#1A347E', towerSide: '#0E1A4C', towerEdge: '#5E86DA', towerFar: '#3654A8', towerHaze: '#5878C8',
  rack: '#1C3882', rackGroove: '#060A28', fan: '#0E1846', slotOff: '#1C3670', deck: '#22428E', deckLit: '#4A74CC', conduit: '#1E4690',
  charRim: '#C4C0FF',
};

/** A city at sunset, kept dark (darker reds and yellows; reference 07's sunset kept low): a
 * plum zenith over an oxblood sky warming to a NARROW ochre horizon (skyLow, drawn as a band); oxblood and
 * burnt-umber architecture (tower*, rack*, struct, brick, deck) with smoky violet shadows (towerSide, rackGroove,
 * structDeep, leaf*); a rose-plum haze the far layers sink into; dim amber lamps (windowWarm, led); the cyan data
 * signals kept but secondary (slot*, conduitGlow, holo). Lamp-lit wood, paper, ink and the cast's colours are the
 * dusk's, so a move from dusk into it has no step. */
export const EMBER: SettingPalette = {
  ...DUSK,
  space: '#12081C', skyTop: '#1E0C2C', skyMid: '#702630', skyLow: '#F0A23E', haze: '#6A2C3A', cloud: '#3A162C', cloudLit: '#C85C3A',
  moon: '#FFE2B8', moonGlow: '#E89060', starWarm: '#FFD8A0', starCool: '#E6CCFF',
  leafNear: '#0C0610', leafMid: '#26101E', leafFar: '#40192C', leafMoon: '#5A2638', leafTeal: '#170A16', leafTealLit: '#6E302E', leafWarm: '#B8603A',
  ground: '#0E060C', path: '#3C1E26',
  tower: '#3C1622', towerSide: '#200C18', towerEdge: '#D0704A', towerFar: '#56263A', towerHaze: '#7E3442',
  rack: '#481A2A', rackGroove: '#100510', fan: '#22101A', slot: '#3CC4DC', slotDim: '#2688A8', slotOff: '#361626', ledOff: '#3A1C14',
  deck: '#4A1E2A', deckLit: '#AE5840', conduit: '#3E1828', windowWarm: '#FFA048',
  struct: '#2C1022', structLit: '#A0503E', structDeep: '#0A0410', brick: '#5C2630',
  device: '#1C0C1A', metal: '#4A2236', metalLit: '#D8906A',
  charRim: '#FFB07A',
};

/** Golden hour (the road to the sunset), from dusk's violet and the night's machines: a big low
 * sun, the sky gold at the horizon through rose to violet, everything rimmed in gold, long violet shadows; foreground
 * silhouettes a deep aubergine (the value ladder's near-black, warmed); the server city far off in a rose haze. */
export const GOLDEN: SettingPalette = {
  ...DUSK,
  space: '#3A2462', skyTop: '#A86EAC', skyMid: '#E8705A', skyLow: '#FF9A30', haze: '#F4885C', cloud: '#C4647E', cloudLit: '#FFA860',
  moon: '#FFF0C8', moonGlow: '#FFB45A',
  leafNear: '#1C1024', leafMid: '#4A3C6C', leafFar: '#7A5082', leafLit: '#F2AA3A', leafMoon: '#C8706A', ground: '#3A1E30', path: '#C88E6A',
  leafTeal: '#24283C', leafTealLit: '#D8865A', leafWarm: '#FFC070',
  tower: '#4A3058', towerSide: '#34203F', towerEdge: '#F4A878', towerFar: '#8A5A7E', towerHaze: '#C88290', rack: '#5A3C66', rackGroove: '#1E1028',
  fan: '#2A1A38', conduit: '#5A3A60', deck: '#6A4868', deckLit: '#F0A880', ledOff: '#6A4A3A', slotOff: '#4A3E66', windowWarm: '#FFCE7A',
  wallLit: '#F0A050', wall: '#C86E3A', wallShade: '#7A3A2A', beam: '#6A3424', beamLit: '#C8703A', wood: '#A65A34', woodDark: '#5A2A22',
  roof: '#3A2440', roofEdge: '#22142A', brick: '#9A5048', paper: '#FFF0D8', ink: '#2A1A2A', metal: '#8A6A7A', metalLit: '#F4C8A0',
  lampLight: '#FFEAB0', warmLight: '#FFB45A', lampShade: '#2A1A2A', frame: '#4A2A22', pot: '#6A3A3A', plant: '#4E5A2A', plantLit: '#C8B04A',
  asphalt: '#4A3248', asphaltLit: '#C08470', lane: '#FFE2B0', kerb: '#6A4256', kerbTop: '#F0B890',
  field: '#CC9030', fieldLit: '#FAC050', fieldShade: '#7E4A38', meadow: '#A88C34', meadowLit: '#E2BA48',
  hill: '#8E5A90', hillLit: '#F2906A', hillFar: '#B6779A', water: '#8468A4', waterLit: '#FFC86E',
  // (reference 07: a saturated gold disc, drawn over the bloom's knee, on an orange glow; sunEdge its gold
  // corona and lower rim)
  sun: '#FFB868', sunEdge: '#FFA63C', sunGlow: '#FF9234',
  charRim: '#FFD27A',
};

/** The afterglow (the ending's last shot: the sun gone under the horizon): the horizon still burning orange-rose
 * under a violet sky that deepens to navy, the land in violet silhouette, the first stars. */
export const AFTERGLOW: SettingPalette = {
  ...GOLDEN,
  space: '#10123A', skyTop: '#22286A', skyMid: '#5A4494', skyLow: '#F48A60', haze: '#86629C', cloud: '#5A4284', cloudLit: '#FF9A78',
  moon: '#FFE6C8', moonGlow: '#C88AA0',
  leafNear: '#0E0A1E', leafMid: '#2A2250', leafFar: '#4A3A74', leafLit: '#C87A6A', leafMoon: '#6A4A7A', ground: '#181232', path: '#5A4268',
  leafTeal: '#18162E', leafTealLit: '#6A4A7A', leafWarm: '#E08A6A',
  tower: '#262456', towerSide: '#1A1844', towerEdge: '#9078A8', towerFar: '#3A3672', towerHaze: '#64549A', rack: '#322E66', rackGroove: '#0C0A20',
  asphalt: '#221A38', asphaltLit: '#6A4A6A', lane: '#C8A8B0', kerb: '#2E2244', kerbTop: '#8A6A86',
  field: '#62405A', fieldLit: '#A06672', fieldShade: '#2E1C38', meadow: '#44405A', meadowLit: '#706078',
  hill: '#4A3268', hillLit: '#925E80', hillFar: '#7A5490', water: '#5A4480', waterLit: '#FFB890',
  sun: '#FFC478', sunEdge: '#FF8A44', sunGlow: '#FF8A5A',
  charRim: '#FFB08A',
};

/** The prize hall (reference 06's golden laboratory), from the golden hour's warmth and the
 * morning's daylight (its own values throughout, so the night palettes may change under it): champagne and cream
 * architecture (struct*: a lit ivory edge, a champagne body, a CARAMEL shadow plane, never near-black), amber light,
 * GRAPHITE machinery (metal, rack, rackGroove, bezel, device, fan: the presses, the crate, the racks, the truss), warm
 * ivory surfaces (module*: the podium), a peach-gold sky through large windows over a distant lavender skyline (tower*:
 * the cool counterweight the warm characters read against, as 06's city does), dark teal-green planters (leaf*, plant*),
 * gold light strips (conduit, conduitGlow); cyan stays in the screens, the slots and the network. */
export const PRIZE: SettingPalette = {
  ...MORNING,
  space: '#E8AE78', skyTop: '#F6BE86', skyMid: '#FAD0A2', skyLow: '#FCE0BE', haze: '#F4CFA0', cloud: '#F4C4A0', cloudLit: '#FFF0DA',
  moon: '#FFF4D4', moonGlow: '#FFD68A', starWarm: '#FFE2A8', starCool: '#BFE6FF',
  leafNear: '#10291F', leafMid: '#2C5640', leafFar: '#8EA88A', leafLit: '#9CC064', leafMoon: '#6E9A6A', ground: '#B89060', path: '#D8B080',
  leafTeal: '#143428', leafTealLit: '#5E9A6C', leafWarm: '#D8C06A', plant: '#2E6644', plantLit: '#86B85A',
  tower: '#8E94D4', towerSide: '#7078BE', towerEdge: '#FFDCBE', towerFar: '#B2AADC', towerHaze: '#EFC6B6', rack: '#43362E', rackGroove: '#1E1511',
  slot: '#46E0FF', slotDim: '#2C9ECC', led: '#FFC23A', fan: '#2A262C', conduit: '#C89A52', conduitGlow: '#FFD678', packet: '#FFB73A',
  motif: '#FFE3A0', windowWarm: '#FFD488',
  deck: '#E0C08C', deckLit: '#FFF0D4', ledOff: '#5E4A34', slotOff: '#2E4E5E',
  wood: '#B8703E', woodDark: '#7A4428', beamLit: '#D08A50', wallLit: '#FFD7A0', wallShade: '#C07850',
  lampLight: '#FFEDAE', warmLight: '#FFC050', paper: '#F3EADB', ink: '#1A1E2A',
  bezel: '#141216', screen: '#0E2A3C', screenGlow: '#36A2C8', code1: '#4FDCF5', code2: '#FFB040', code3: '#FF8A6E', code4: '#CFE6F2',
  device: '#2E2622', metal: '#4C403C', metalLit: '#CCB496',
  hubBg: '#F4D090', struct: '#EEAE58', structLit: '#FFF0BE', structDeep: '#AC5A1E', module: '#F0B660', moduleTop: '#FFEEBC', moduleSide: '#C06C26',
  core: '#FFE7A0', holo: '#FFD884', netCyan: '#3FE8FF', netGold: '#FFE07A',
  charRim: '#FFEABC',
};

/** A vaulted archive (a tall hall above a computing floor): CHARCOAL-PLUM
 * structure (struct*, tower*, hubBg: the vault, the ribs, the walls, the console relit), MUTED JADE archive bays
 * (rack, module*: drawer faces and their lit tops; slot*: their small pale-jade status lights), PALE STONE platforms
 * and balconies (deck, deckLit), strong IVORY light from the clerestory (windowWarm, lampLight, structLit: the lit
 * edges), a warm mauve haze the far tiers sink into (haze, towerHaze, sky*), gold only on activity (led, motif,
 * netGold). The network keeps its own light (core, holo, conduitGlow, netCyan: the night's cyan), so the ring, the
 * cards read the same as in the hub; pictures shown inside it keep their own colours. */
export const ATRIUM: SettingPalette = {
  ...NIGHT,
  space: '#0C0610', skyTop: '#200C2A', skyMid: '#4E2050', skyLow: '#A0584A', haze: '#5A2A54', cloud: '#2E1A2E', cloudLit: '#C89A80',
  moon: '#FFF2DA', moonGlow: '#F0CFA0',
  leafNear: '#0A060C', leafMid: '#1A2A24', leafFar: '#34503F', leafLit: '#7A8C5A', leafMoon: '#4E6458', ground: '#100A10', path: '#5A4440',
  leafTeal: '#0E1A1A', leafTealLit: '#4A7464', leafWarm: '#C89A5A',
  tower: '#241626', towerSide: '#140A16', towerEdge: '#E6C89A', towerFar: '#4A3048', towerHaze: '#6E3A62', rack: '#1C5444', rackGroove: '#08050A',
  slot: '#8CF0CC', slotDim: '#4CA88C', led: '#FFC64E', fan: '#160E18', conduit: '#2A2C3C',
  windowWarm: '#FFD28A', deck: '#A88A6C', deckLit: '#F4E0BE', ledOff: '#4A3424', slotOff: '#18382E',
  lampLight: '#FFF0CC', warmLight: '#FFBE68', pot: '#3A2430', plant: '#24463A', plantLit: '#6A8E5A',
  chair: '#1A0E1C', chairLit: '#6A4A60', bezel: '#0E080F', screen: '#081A24', screenGlow: '#2E9AB8',
  device: '#180E1A', metal: '#4A3044', metalLit: '#E8CDA6',
  hubBg: '#220E28', struct: '#361A3C', structLit: '#F2DCB2', structDeep: '#0C040F', module: '#2A6E58', moduleTop: '#8CDCB0', moduleSide: '#153A30',
  charRim: '#FFE4B8',
};

/** A location's light: which palette, the key light's colour and direction (screen degrees toward it, y down;
 * elevation 0..1 over the picture plane), the rim it lays on silhouettes, how fast far layers sink into the
 * haze (per unit of depth past 1), and the frame's post. */
export interface Light {
  palette: SettingPalette;
  key: string; fill: string; rim: string; shadow: string;
  angle: number; elevation: number; rimK: number; hazeK: number;
  /** 0 day … 1 night (the Look's `night`, which dims what isn't a light and raises a character's back light): set by
   * hand since lifted the night skies (from the sky's value it would read the luminous night as dusk) */
  night?: number;
  post: Partial<PostParams>;
}
/** Night post (the references glows bloom softly and wide around every source; matte things, paper and type
 * included, stay under the threshold and crisp; a lighter vignette, as the references' frames keep their corners lit).
 * The grade: the threshold sits at 1.2, so only the lights (their gains over 1) bloom, strongly, and the frame-wide veil
 * a lower threshold laid over everything (it greyed the navy and lifted the darks) is gone. */
const POST_NIGHT: Partial<PostParams> = { bloom: 1.0, bloomThreshold: 1.2, bloomRadius: 0.8, bloomKnee: 0.3, grain: 0.016, vignette: 0.26, ca: 0.35, halation: 0 };
export const LIGHTS = {
  /** the cabin at night (reference 05): the pendant lamp is the key, warm from above; the moon rims the outside */
  cabin: { palette: NIGHT, key: '#FFC870', fill: '#2E5290', rim: '#FFD08A', shadow: '#1A0C14', angle: -100, elevation: 0.5, rimK: 0.5, hazeK: 0.17, night: 0.97, post: POST_NIGHT },
  /** the server city at night: moonlight from the upper right, cyan rims */
  city: { palette: NIGHT, key: '#A8D8FF', fill: '#1E4C8E', rim: '#86E0FF', shadow: '#03102A', angle: -60, elevation: 0.45, rimK: 0.45, hazeK: 0.17, night: 0.97, post: POST_NIGHT },
  /** the hub (reference 03): cool screens and the core light everything; warm desk lamps */
  hub: { palette: NIGHT, key: '#86E8FF', fill: '#1E4C8E', rim: '#90EAFF', shadow: '#03102A', angle: -70, elevation: 0.5, rimK: 0.55, hazeK: 0.16, night: 0.97, post: { ...POST_NIGHT, bloom: 1.05 } },
  /** an office at night: a warm lamp-lit interior on a dark street */
  office: { palette: NIGHT, key: '#FFC066', fill: '#28508A', rim: '#FFD490', shadow: '#160C12', angle: -110, elevation: 0.5, rimK: 0.5, hazeK: 0.17, night: 0.97, post: POST_NIGHT },
  /** space (the references): a far sun from the left, cool rims, deep black-navy */
  space: { palette: NIGHT, key: '#FFE2B0', fill: '#10306A', rim: '#9FE0FF', shadow: '#01030A', angle: 180, elevation: 0.35, rimK: 0.5, hazeK: 0.2, night: 0.97, post: { ...POST_NIGHT, bloom: 0.62, bloomThreshold: 0.85, vignette: 0.26 } },
  /** the Moon base control room (the references): navy panels, amber strips, the Earth's cool light through the window */
  moonbase: { palette: NIGHT, key: '#BFE6FF', fill: '#1E3460', rim: '#9FD8FF', shadow: '#040A1C', angle: -40, elevation: 0.5, rimK: 0.55, hazeK: 0.25, night: 0.97, post: POST_NIGHT },
  /** a room in the morning: warm daylight from the window on the right */
  morning: { palette: MORNING, key: '#FFF0D0', fill: '#A8C8E0', rim: '#FFF6E0', shadow: '#5A3A3A', angle: -30, elevation: 0.55, rimK: 0.55, hazeK: 0.22, night: 0, post: { bloom: 0.34, bloomThreshold: 1.02, bloomRadius: 0.66, grain: 0.014, vignette: 0.16, ca: 0.3 } },
  /** dusk (reference 08's evening): a warm low sun from the left, cobalt to periwinkle sky, peach clouds, violet shadows */
  dusk: { palette: DUSK, key: '#FFB880', fill: '#4460AC', rim: '#FFC89A', shadow: '#0A0E2C', angle: -160, elevation: 0.35, rimK: 0.6, hazeK: 0.4, night: 0.89, post: { ...POST_NIGHT, vignette: 0.28 } },
  /** a city at sunset, kept dark: the low sun in the west (left), warm and grazing; a smoky violet fill;
   * ember rims; the dusk's post, so a move from dusk has no step in the grade */
  ember: { palette: EMBER, key: '#FFA060', fill: '#5A2E6E', rim: '#FFB070', shadow: '#1A0818', angle: -165, elevation: 0.3, rimK: 0.7, hazeK: 0.36, night: 0.88, post: { ...POST_NIGHT, vignette: 0.28 } },
  /** golden hour (reference 07): a big low sun ahead and to the right,
   * grazing (long shadows to the left), gold rims on everything, violet shadows; the time-lapse mixes cabin → dusk →
   * golden (reference 07: the golden rim tracing ears, cheeks and tails on the sun's side
   * stronger and warmer; the frame's corners a step darker) */
  golden: { palette: GOLDEN, key: '#FFC070', fill: '#8A5AA0', rim: '#FFC25A', shadow: '#3A1A40', angle: -10, elevation: 0.18, rimK: 1.25, hazeK: 0.32, night: 0.66, post: { bloom: 0.64, bloomThreshold: 0.98, bloomRadius: 0.8, bloomKnee: 0.32, grain: 0.016, vignette: 0.22, ca: 0.35, halation: 0 } },
  /** the afterglow: the sun under the horizon, its glow still low and warm, violet fill, the first stars */
  afterglow: { palette: AFTERGLOW, key: '#FF9E78', fill: '#423E88', rim: '#FFB48E', shadow: '#100C28', angle: -12, elevation: 0.08, rimK: 0.65, hazeK: 0.3, night: 0.88, post: { ...POST_NIGHT, bloom: 0.6, bloomThreshold: 1.0, bloomKnee: 0.28, bloomRadius: 0.8, vignette: 0.28 } },
  /** a golden hall (reference 06's golden laboratory): warm light from the ceiling and the spotlights, a little
   * to the right; ivory rims; a bright frame, so the bloom starts above the honey walls and only the lamps, the gold
   * and the network bloom; a light vignette (pass 2: honey rather than cream, the graphite warmed toward 06's bronze) */
  prize: { palette: PRIZE, key: '#FFE0A6', fill: '#D8A070', rim: '#FFF0CC', shadow: '#5E3420', angle: -72, elevation: 0.55, rimK: 0.5, hazeK: 0.14, night: 0.1, post: { bloom: 0.62, bloomThreshold: 1.0, bloomRadius: 0.8, bloomKnee: 0.3, grain: 0.014, vignette: 0.3, ca: 0.3, halation: 0 } },
  /** the vaulted archive: ivory clerestory light from high up on the left is the key (the
   * squirrels lit warm), a plum fill, ivory rims; the hub's post exactly, so what is shown on screens keeps every
   * pixel's colour through a move from the hub */
  atrium: { palette: ATRIUM, key: '#FFE2B4', fill: '#4A3858', rim: '#FFE6C0', shadow: '#1A0E1A', angle: -125, elevation: 0.55, rimK: 0.6, hazeK: 0.2, night: 0.85, post: { ...POST_NIGHT, bloom: 1.05 } },
} as const satisfies Record<string, Light>;
export type LightKey = keyof typeof LIGHTS;

/** The squirrels' fur (sRGB hex), (references 01-08: the same squirrels rendered richer).
 *   base/light/shade/deep  the fur's four values: light the lit top of a mass (the forehead's gold), shade its broad
 *                 shadow plane, deep the darkest fur (creases, the far side's edge)
 *   cream, creamShade  the mask (round the eyes as "spectacles", the muzzle, the chin) and the long belly, its shadow
 *   inner         the open mouth's tongue;  mouthIn  the open mouth's dark inside;  nose  the tiny oval nose (and the
 *                 closed mouth's thin line);  blush  the cheeks' soft rosy oval (a smile, delight: reference 07, 08)
 *   ear, earFold  the inner ear: a DARKER warm rust / rosy brown (reference 01, 02, 07, 08 coral
 *                 inner ear is retired), its darker fold
 *   tailOuter, tailAmber, tailOrange, tailCore  the tail's NESTED BANDS from the curl's outside in (reference 01, 02:
 *                 light gold, amber, orange, the darker burnt core at the spiral's centre; the coral fur's in coral and peach,
 *                 the tan cast's a deeper caramel); tailStrand its fine light strands; tailBand (older callers) the
 *                 tail's lighter band
 *   the eyes (FUR_EYES, the same dark brown eyes on every squirrel: reference 01, 02, 08): eye the iris's dark heart,
 *                 iris its dark brown, irisRing the lighter brown lower ring, sclera / scleraShade the white (a step
 *                 greyer under the upper lid), lid the thick dark upper lid line (and the lash, the brows), glint the
 *                 cream-white highlights */
export interface FurPalette {
  base: string; light: string; shade: string; deep: string; cream: string; creamShade: string; inner: string; tailBand: string; eye: string; nose: string;
  ear: string; earFold: string; blush: string; mouthIn: string;
  tailOuter: string; tailAmber: string; tailOrange: string; tailCore: string; tailStrand: string;
  iris: string; irisRing: string; sclera: string; scleraShade: string; lid: string; glint: string;
}
const FUR_EYES = { eye: '#1C0A06', iris: '#3E1A0C', irisRing: '#9A4C22', sclera: '#FFF8EF', scleraShade: '#E6CCBA', lid: '#2B0F08', glint: '#FFFDF4' } as const;
export const FUR = {
  amber: { ...FUR_EYES, base: '#F28C24', light: '#FFB43E', shade: '#D8681C', deep: '#A84A18', cream: '#FCDAA2', creamShade: '#EAB078', inner: '#F59078', tailBand: '#FFA63A', nose: '#3E1A10', ear: '#B0532C', earFold: '#7E3318', blush: '#F99A70', mouthIn: '#5C2014', tailOuter: '#FFC24C', tailAmber: '#FA9630', tailOrange: '#E6691E', tailCore: '#A03D18', tailStrand: '#FFD77C' },
  coral: { ...FUR_EYES, base: '#EA5E3E', light: '#FF8A5E', shade: '#C94530', deep: '#93302A', cream: '#FCD6BA', creamShade: '#EEAA8A', inner: '#F58A86', tailBand: '#FF8064', nose: '#3E1412', ear: '#9A3428', earFold: '#6C2020', blush: '#FF9A84', mouthIn: '#5A1616', tailOuter: '#FF7E56', tailAmber: '#EC6040', tailOrange: '#C63E33', tailCore: '#882228', tailStrand: '#FFA884' },
  tan: { ...FUR_EYES, base: '#D59258', light: '#F3BC7E', shade: '#B97846', deep: '#84502C', cream: '#FCE7D2', creamShade: '#E6C4A2', inner: '#EE9682', tailBand: '#DCA068', nose: '#2C1610', ear: '#A44A2C', earFold: '#702E1A', blush: '#F2B49C', mouthIn: '#4E1C12', tailOuter: '#E8AE76', tailAmber: '#B06836', tailOrange: '#8E4C26', tailCore: '#582913', tailStrand: '#F2C496' },
  chestnut: { ...FUR_EYES, base: '#8E5236', light: '#AE6E4A', shade: '#723E28', deep: '#4E2A1C', cream: '#EAD0B0', creamShade: '#CCA888', inner: '#E08A7E', tailBand: '#A2664A', nose: '#24120C', ear: '#7C3A26', earFold: '#52241A', blush: '#E2A08C', mouthIn: '#401610', tailOuter: '#B87C56', tailAmber: '#925538', tailOrange: '#784229', tailCore: '#4C2416', tailStrand: '#C8926A' },
  grey: { ...FUR_EYES, base: '#8C94A6', light: '#B0B8C8', shade: '#6C7488', deep: '#4A5064', cream: '#EEF0F4', creamShade: '#C8CCD8', inner: '#E8A0AA', tailBand: '#A8B0C2', nose: '#2A2230', ear: '#9A6E7C', earFold: '#6A4C5A', blush: '#E8AAB6', mouthIn: '#3A2230', tailOuter: '#BEC6D4', tailAmber: '#9AA2B4', tailOrange: '#7E8698', tailCore: '#525870', tailStrand: '#D6DCE6' },
  golden: { ...FUR_EYES, base: '#E8A848', light: '#FFCA70', shade: '#C88830', deep: '#985E20', cream: '#FFF0CC', creamShade: '#EED0A0', inner: '#F5947E', tailBand: '#F8BC5C', nose: '#3A2414', ear: '#B4642E', earFold: '#82441E', blush: '#F8A47E', mouthIn: '#54240F', tailOuter: '#FFD67C', tailAmber: '#F2B24E', tailOrange: '#D88E2C', tailCore: '#985A1C', tailStrand: '#FFE4A0' },
} as const satisfies Record<string, FurPalette>;
/** The cast's gear (sRGB hex). */
export const GEAR = {
  hardhat: '#FFC21E', hardhatShade: '#D89A10', vest: '#FF7E1A', vestShade: '#D85E10', stripe: '#E8F2F2',
  suit: '#0E1830', suitLit: '#22345A', suitTrim: '#3FB8EE', glasses: '#1A1C26', lens: '#BFE6FF',
  toolbox: '#C8463A', toolboxLit: '#E86A50', backpack: '#2A7A8A', backpackLit: '#46A6B0', strap: '#1A3A4A',
} as const;
