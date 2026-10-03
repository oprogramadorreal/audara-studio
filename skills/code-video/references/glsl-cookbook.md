# GLSL cookbook

Techniques with working code, for when a scene needs one. Find the technique in the contents and read only its
entry, which stands alone under its `### N.` heading: what it gives, why it works, the key lines in this
template's API, and where the full source is. The rules the entries assume (determinism, 4K, motion blur,
performance) are in the project's `docs/ENGINE.md`, and their reasons and edge cases in
`references/contract.md`.

**Methods, not a look.** Most sources are scenes from pdoom-video, a music video with its own palette,
subjects and tone. Take the method and draw it in the project's palette, type and motifs (`docs/STYLE.md`),
or in ones the piece invents; a technique put to a use its source never tried is the point. Neither those
scenes nor the template's example video (a calibration card) is a style to copy. The entries are what one
music video needed, not the range of what fits: a piece with nothing here in it is as much at home in the
engine.

Sources: [pdoom-video](https://github.com/mexicat/pdoom-video) (MIT, © 2026 Giacomo Magnanini), every link
pinned to commit `bdbad53`, where its line numbers hold. To read a linked file whole, fetch
`https://raw.githubusercontent.com/mexicat/pdoom-video/bdbad537a7b7af3213475651774030c47568c181/<path>`, with
the path from the link and no `#L` anchor.

## Contents

- Reading the source code
- Lines: 1. Lines that keep their weight at 4K · 2. Engraving that follows the form ·
  3. Line densities that keep their spacing · 4. Contours, illuminated contours, hachures · 5. Guilloché and
  line relief
- Raymarching: 6. A half-resolution G-buffer · 7. The depth- and id-aware upsample · 8. Cheaper paths
- three.js: 9. Hidden lines removed by instanced slabs · 10. Fog and a geometric smear for lines ·
  11. A terrain with its own shader, and things placed exactly on it
- Type: 12. Width and weight steps hidden by a spring · 13. Karaoke, four ways · 14. Per-glyph motion with
  velocity effects · 15. Words on 3D planes with a wipe shader · 16. Pen writing synced to the words
- Layered 2D: inks, textures, a page camera: 17. Channel-coded inks overprinted like ink · 18. Paper fibres
  and stamp ink · 19. A page camera and whip blur · 20. Typewriter, tear, stutter
- Fields and time: 21. Domain warping · 22. Droste recursion · 23. Lensing · 24. Deterministic particles ·
  25. Motion without state · 26. More, one line each
- The template's example scenes, by way of drawing
- Pitfalls

## Reading the source code

The template is pdoom-video's engine, so the sources are TypeScript and GLSL ES 3.00 against the same API.
What differs:

- `ctx.lyrics` and `Lyrics` are `ctx.words` and `Words` here (`get`, `find`, `wordProgress` are the same).
- Colour constants (`C_INK`, `C_BONE`, `C_SIGNAL`…, `LIN.bone`, `rgba('signal')`, the `heat()` ramp) are that
  video's palette: use the project's key for the same role, from `src/look.ts` (`C_<KEY>`, `LIN.<key>`,
  `rgba('<key>')`).
- `W`, `H` are fixed at 1920×1080 there, and some shaders write `1920.0`: here they are the video's logical
  size (`ctx.W`, `ctx.H`; in GLSL a uniform or `FRAG_PX`).
- `LineBatch` blends with `add` by default there; here the default is `max` (Pitfalls).
- A discrete change computed from `t` there (a font step, a lit glyph, a jump in time) is computed here from
  `frameTime(t)`, so all of a frame's motion-blur sub-frames agree; `1 / 60` is `1 / VIDEO.fps`.
- There is no preview flag there; here `ctx.export` is false in the live preview (entry 8).
- Upstream calls a scene a "plate".

## Lines

### 1. Lines that keep their weight at 4K

Hairlines whose width comes from `fwidth` get thinner and fainter at `--scale 2`, since `fwidth` counts
physical pixels. Written through `pxLine` (or `rampLine` for the linear ramp), the 1× idiom is unchanged at 1×
and keeps its ink per logical pixel above it, with a sharper edge (`docs/ENGINE.md`, "Output scale"). For the
isolines of a distance field, divide by the gradient's length rather than `fwidth`, whose |dx| + |dy| is 1.4×
too large on diagonals and draws a circle thicker at 45°.

```glsl
float d = abs(fract(u + 0.5) - 0.5) / max(fwidth(u), 1e-5); // px to the nearest integer of u
float ink = pxLine(d, 0.35, 1.2);                            // was 1.0 - smoothstep(0.35, 1.2, d)
float isoPx = abs(fract(f / S + 0.5) - 0.5) * S / max(length(vec2(dFdx(f), dFdy(f))), 1e-6);
float ring = pxLine(isoPx, 0.1, 1.1);                        // isolines of f every S px
```

**Source:** [common.ts L105-126](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/engine/glsl/common.ts#L105-L126)
(the helpers, also in the template); the isolines are the template's `videos/example/scenes/fspass.ts`.

### 2. Engraving that follows the form

Shading made of lines that follow the form, rings around a tube and strokes along it in the highlights, each
wider where it's lighter (or darker, for dark lines on a light ground). The lines carry the shape and stay on
the surface when the camera moves.

**Why it works.** Besides its distance, each SDF primitive returns two surface coordinates in world units:
`along` its axis and `around` it (angle × radius). The smooth union blends the distances but takes the
coordinates and the id from the nearer primitive, so they are never mixed; the switch falls where the crevice
line goes (entry 7). `around` comes from `atan` and wraps: keep its seam where no lines are drawn, or unwrap
it before upsampling.

```glsl
void U(inout vec4 acc, float d, float along, float around, float id, float k) { // acc = (d, along, around, id)
  float h = sat(0.5 + 0.5 * (d - acc.x) / k);
  float m = mix(d, acc.x, h) - k * h * (1.0 - h);
  if (d < acc.x) acc.yzw = vec3(along, around, id);
  acc.x = m;
}
vec2 q = vec2(length(p.xz) - R, p.y); // a torus with its own coordinates
U(acc, length(q) - r, atan(p.z, p.x) * R, atan(q.y, q.x) * r, id, 0.15);
// shading (G = the upsampled g0 of entry 7): rings at constant `along` with a hand-cut wobble, strokes
// along the tube in the highlights, each line as wide as the light
float u = G.y / spacing, v = G.z / (spacing * 0.8);
u += 0.22 * sin(v * 0.21 + u * 0.013) + 0.08 * sin(v * 0.9 + 1.7);
float wA = pow(light, 1.25) * 0.9;
float lines = max(elineLod(u, wA, 6.0), elineLod(v, sat(light * 1.6 - 0.95) * 0.7, 7.0));
```

A 2D pass can do the same, with rings bowed by a tube's cross-section. `hatch()` and `engrave()` in
`GLSL_COMMON` are the single-density versions, for any space.

**Source:** [shoggoth-glsl.ts L84-130](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/shoggoth-glsl.ts#L84-L130)
(the union and the field),
[L264-297](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/shoggoth-glsl.ts#L264-L297)
(the shading);
[dense-askew.ts L99-124](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/dense-askew.ts#L99-L124)
(in 2D).

### 3. Line densities that keep their spacing

Hatching about N px apart at any distance: as the surface comes closer, new lines fade in halfway between the
old ones, like mip levels.

**Why it works.** With `fu = fwidth(u) * PX_SCALE`, lines at the integers of `u·2^k` lie `1/(fu·2^k)` px
apart, so `k = -log2(fu·px)` spaces them `px`. Cross-fading the two levels around `k` fades only the
in-between lines, since every line of one level is also a line of the next, and a width given as a fraction
of the period keeps the mean tone, so the fade doesn't show. Past the clamp, fall back to that tone.

```glsl
float eline(float u, float w) { // anti-aliased lines at the integers of u; w = width / period
  float d = abs(u - floor(u + 0.5));
  return rampLine(d, w * 0.5, max(fwidth(u), 1e-4) * 0.7) * smoothstep(0.0, 0.05, w);
}
float elineLod(float u, float w, float px) { // the same lines, about px logical px apart
  float fu = max(fwidth(u), 1e-5) * PX_SCALE;
  float k = clamp(-log2(fu * px), -1.0, 3.0), kf = floor(k);
  return mix(eline(u * exp2(kf), w), eline(u * exp2(kf + 1.0), w), smoothstep(0.0, 1.0, k - kf));
}
float fw = max(fwidth(u), fwidth(v) * 0.5) * PX_SCALE; // too dense to resolve: the flat tone
lines = mix(lines, wA * 0.8, smoothstep(0.6, 1.2, fw));
```

**Source:** [shoggoth-glsl.ts L205-215](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/shoggoth-glsl.ts#L205-L215),
[L276-286](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/shoggoth-glsl.ts#L276-L286);
with an explicit footprint, for code after a raymarch loop:
[ilya-glsl.ts L262-289](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/ilya-glsl.ts#L262-L289).

### 4. Contours, illuminated contours, hachures

Topographic lines on any height field (a terrain, a face, a data surface): a constant pixel width, index
contours, relief from line brightness alone, short strokes down the slopes.

**Why it works.** The distance to the nearest level in px is `|fract(h + 0.5) - 0.5| / fwidth(h)`, constant at
any slope; where contours crowd under about 6 px they fade to their mean coverage instead of turning to moiré.
Evaluate the height per fragment, so the lines don't depend on the mesh. Illuminated (Tanaka) contours
brighten where the slope faces the light's azimuth. Hachures are `hatch()` down the slope, staggered per
band, with a gap at each contour.

```glsl
float contour(float c, float wpx) { // c = height / interval; wpx = width in logical px
  float fwP = max(fwidth(c), 1e-5), fw = fwP * PX_SCALE;
  float d = abs(fract(c + 0.5) - 0.5) / fwP;
  float cov = pxLine(d, wpx * 0.5 - 0.5, wpx * 0.5 + 0.5);
  return mix(cov, clamp(wpx * fw, 0.0, 1.0) * 0.45, smoothstep(0.16, 0.42, fw));
}
float minor = contour(h / interval, 1.05), index = contour(h / (5.0 * interval), 2.1);
vec2 nx = n.xz / max(length(n.xz), 1e-4); // n: the normal (y up); L: toward the light
float tanaka = sat(0.5 + 0.55 * dot(nx, normalize(L.xz)) * sat(slope * 1.2));
float band = floor(h / interval), fb = fract(h / interval); // hachures: one stagger per band
float gap = smoothstep(0.08, 0.22, fb) * (1.0 - smoothstep(0.78, 0.92, fb));
```

**Source:** [loss.ts L91-161](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/loss.ts#L91-L161)
(a terrain shader, hachures at L140-149);
[leftturn-map.ts L393-431](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/leftturn-map.ts#L393-L431)
(on a 2D field, with sub-contours).

### 5. Guilloché and line relief

Banknote patterns (rosettes of interlaced curves, wavy security lines) and an image in relief, made of
parallel lines bent by height and widened by shade.

**Why it works.** A curve `r = R + a sin(nθ + φ)` drawn by its radial distance thickens where it is steep;
dividing by `sqrt(1 + slope²)`, with slope = dr / (r dθ), approximates the perpendicular distance, so the
width stays even.

```glsl
float rosette(vec2 m, float R, float a, float n, float K, float w, float twist) { // m, R, w in logical px
  float r = length(m), th = atan(m.y, m.x), ink = 0.0;
  for (int k = 0; k < 16; k++) {
    if (float(k) >= K) break;
    float ph = float(k) * TAU / K + twist;
    float slope = a * n * cos(n * th + ph) / max(r, 1.0);
    float d = (r - R - a * sin(n * th + ph)) / sqrt(1.0 + slope * slope);
    ink = max(ink, pxLine(abs(d) * PX_SCALE, w * 0.5 - 0.5, w * 0.5 + 0.5));
  }
  return ink;
}
float relief = hatch((p.y - height * lift) / spacing, sat(dark * 1.05 + 0.04)); // lines lifted by the height
float xhatch = hatch((p.x + p.y * 0.5) / (spacing * 0.77), sat(dark * 1.6 - 1.0)); // deepest shade only
```

**Source:** [ascent-note.ts L48-62](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/ascent-note.ts#L48-L62)
(rosettes),
[L88-110](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/ascent-note.ts#L88-L110)
(security lines, a woven band),
[L124-147](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/ascent-note.ts#L124-L147)
(relief).

## Raymarching

### 6. A half-resolution G-buffer

A heavy raymarched form at preview speed: march a quarter of the pixels, store what shading needs, and draw
the crisp parts (lines, edges) at full resolution in a second pass.

**Why it works.** The lines need only smooth quantities, surface coordinates and light terms, which survive
upsampling. `FSPass` has one output, so the G-buffer pass is a `RawShaderMaterial` with two
`layout(location = n) out` into a target with `count: 2`. Make it `FloatType`: coordinates of about 20 world
units over a spacing of 0.02 need more than a half float, which steps by 1/64 between 16 and 32, almost a
line period. A size not multiplied by `SCALE` keeps the cost put at 4K, and the preview can take a smaller one
(entry 8).

```ts
const g = this.ctx.export ? 0.5 : 0.25; // the G-buffer's scale: half in the render, a quarter in the preview
const gbuf = new THREE.WebGLRenderTarget(Math.ceil(W * g), Math.ceil(H * g), { count: 2, type: THREE.FloatType,
  minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
// RawShaderMaterial (glslVersion: THREE.GLSL3) on a fullscreen triangle in its own THREE.Scene
const GBUF_FRAG = `precision highp float;\nin vec2 vUv;\nlayout(location = 0) out vec4 g0;\nlayout(location = 1) out vec4 g1;\n${GLSL_COMMON}\n${MARCH}`;
renderer.setRenderTarget(gbuf); renderer.render(this.gscene, this.gcam); // then the full-resolution FSPass
comp.u.g0Tex!.value = gbuf.textures[0]; comp.u.g1Tex!.value = gbuf.textures[1];
```

`g0 = (t, along, around, id)`, `g1 = (key × shadow, rim, occlusion, up-facing)`, and a miss writes
`g0 = (1e5, 0, 0, -1)`. In the march: a bounding sphere first, hits relative to distance (`d < 0.0007 * t`),
under-relaxed steps (`t += d * 0.8`), a cheap early-out per primitive. The half-resolution buffer sparkles
along silhouettes from one sub-frame to the next, noise the render's adaptive sampler would chase to 324
sub-frames: `maxSamples: 108` on the timeline entry caps it.

**Source:** [shoggoth.ts L86-111](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/shoggoth.ts#L86-L111)
(the pass and the target);
[shoggoth-glsl.ts L133-190](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/shoggoth-glsl.ts#L133-L190)
(the march);
[timeline.ts L62-64](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/timeline.ts#L62-L64)
(the cap).

### 7. The depth- and id-aware upsample

The half-resolution buffer at full resolution without halos across silhouettes, and a crevice line wherever
two surfaces meet.

**Why it works.** Bilinear filtering averages depth and coordinates across an edge. Keeping only the taps
with the reference's id and a depth within 6% of it interpolates within one surface, a joint-bilateral
upsample, and the weight it rejects is the share of the pixel that belongs to another surface: draw it as a
line. The weight of the taps that hit at all is the coverage, a soft silhouette, where flat tone replaces the
lines.

```glsl
float keep(vec4 a, vec4 ref) { return (a.w == ref.w && abs(a.x - ref.x) < 0.06 * ref.x) ? 1.0 : 0.0; }
// in main(): the 2x2 texels around this pixel and their bilinear weights
vec2 hp = vUv * gRes - 0.5; ivec2 i0 = ivec2(floor(hp)); vec2 f = hp - vec2(i0);
vec4 a[4];
a[0] = fetch0(i0); a[1] = fetch0(i0 + ivec2(1, 0)); a[2] = fetch0(i0 + ivec2(0, 1)); a[3] = fetch0(i0 + ivec2(1, 1));
vec4 bw = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
float cov = 0.0, best = -1.0; vec4 ref = a[0]; // ref: the hit with the largest weight
for (int i = 0; i < 4; i++) if (a[i].x < 1e4) { cov += bw[i]; if (bw[i] > best) { best = bw[i]; ref = a[i]; } }
vec4 G = vec4(0.0); float ws = 0.0;
for (int i = 0; i < 4; i++) { float w = bw[i] * keep(a[i], ref); G += a[i] * w; ws += w; }
G = ws > 1e-4 ? G / ws : ref;
G.w = ref.w; // ids are never interpolated
float edge = ws > 1e-4 ? sat(1.0 - ws / max(cov, 1e-3)) : 0.0;
```

`fetch0` is a `texelFetch` clamped to the buffer, and the second attachment is blended with the same weights.
The interpolated depth also hides full-resolution detail drawn over the cheap buffer (analytic spheres,
letters in world planes).

**Source:** [shoggoth-glsl.ts L232-262](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/shoggoth-glsl.ts#L232-L262)
(the upsample),
[L292-293](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/shoggoth-glsl.ts#L292-L293)
(the line),
[L299-355](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/shoggoth-glsl.ts#L299-L355)
(detail occluded by it).

### 8. Cheaper paths

A scene too heavy for real time gets a cheaper preview path, not a simpler idea. `ctx.export` is false only in
the live preview, and the render must show the same content, only cleaner (`docs/ENGINE.md`, Rules); put
`stills --t <t> --as-preview` beside `stills --t <t>`. Entry 6's G-buffer drops to a quarter of the frame in
the preview. Other cuts that keep the content:

- fewer steps, but only after a lower resolution: too few steps can move a silhouette;
- soft shadows and occlusion only where the feature is big enough on screen to read them
  ([paperclips-glsl.ts L245-250](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/paperclips-glsl.ts#L245-L250));
- taps by need, one camera-blur tap when still and up to 16 on a whip, in a loop bounded by a uniform
  ([leftturn-map.ts L494-503](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/leftturn-map.ts#L494-L503),
  whose `break` form broke derivatives in a test on Windows: Pitfalls);
- a volume sampled densely near its light rather than evenly along the ray
  ([ilya-glsl.ts L407-441](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/ilya-glsl.ts#L407-L441));
- `SS_TAP` (`docs/ENGINE.md`): each sub-frame of the render takes one of four supersampling taps; `fwidth` in
  the tap loop measures the pixel, not the tap
  ([paperclips-glsl.ts L39-41](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/paperclips-glsl.ts#L39-L41)).

```glsl
for (int i = 0; i < uTaps; i++) // a uniform bound (not a constant bound with a break: see Pitfalls)
  acc += shade(mix(uCamA, uCamB, uTaps > 1 ? float(i) / float(uTaps - 1) : 0.0));
for (int k = ssK0(); k < ssK1(); k++) col += shade(FRAG_PX + rgss(k) / PX_SCALE); // SS_TAP_GLSL in the shader, ssTap: SS_TAP
fragColor = vec4(col * ssWeight(), 1.0);
```

## three.js

### 9. Hidden lines removed by instanced slabs

3D line drawings (diagrams, wireframes, architecture) in which lines behind a solid are hidden, for one
instanced draw.

**Why it works.** `LineBatch` segments test depth but don't write it. Draw the volumes first as solids in the
ground colour: they fill the depth buffer, the lines behind them fail the test, and the solids read as empty
space. Shrunk a hair (0.994 across, 0.99 in depth), they leave each block's own edges visible. The renderer's
`autoClear` is off: clear the depth after a fullscreen background.

```ts
const slab = new THREE.BoxGeometry(2 * hx * 0.994, 2 * hy * 0.994, 2 * hz * 0.99); // init()
const ground = new THREE.Color().setRGB(...LIN.bg, THREE.LinearSRGBColorSpace);
this.bodies = new THREE.InstancedMesh(slab, new THREE.MeshBasicMaterial({ color: ground, fog: true }), maxBlocks);
this.bodies.frustumCulled = false;
this.lines = new LineBatch(90000, { screen2D: false, depthTest: true });
this.bg.render(renderer, out); // render(): background, clean depth, slabs, lines
renderer.setRenderTarget(out); renderer.clearDepth();
this.bodies.count = n; this.bodies.instanceMatrix.needsUpdate = true; // after setMatrixAt() for the blocks in view
renderer.render(this.bodyScene, this.cam);
this.lines.render(renderer, out, this.cam);
```

**Source:** [stack.ts L173-187](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/stack.ts#L173-L187)
(slabs and fog),
[L450-534](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/stack.ts#L450-L534)
(the passes in order).

### 10. Fog and a geometric smear for lines

Lines that fade with depth, and a speed streak drawn as geometry, which the preview shows too. The render
already blurs real motion (`references/motion.md`, "Motion blur"): the smear is for when a streak is the look.

**Why it works.** Each block's lines get an exponential fog computed on the CPU, as alpha, and blocks under 2%
are skipped; over a light ground, use `blend: 'normal'` and fade toward the fog colour instead. The motion is a
function of `t`, so evaluate it a shutter earlier and draw each segment `NS` times back along the
displacement, capped so a fast move stays a graphic streak. The source sums the copies with `blend: 'add'`,
which made `render.ts verify` fail on an Intel GPU (Pitfalls), so the copies go in a `max` batch, fainter
toward where the line was.

```ts
const dy = clamp((this.pos(t - 0.9 / VIDEO.fps) - this.pos(t)) * pitch, -1.8, 1.8); // back to where it was: pos(t) is a pure function
const NS = Math.max(1, Math.min(12, Math.ceil(Math.abs(dy) / 0.1)));
const fogK = Math.exp(-Math.max(0, dz - near) / fogLen); // per block; skip it below 0.02
for (let s = 0; s < NS; s++) {
  const off = NS > 1 ? dy * (s / (NS - 1)) : 0;
  lb.seg(ax, ay + off, az, bx, by + off, bz, w, r, g, b, al * fogK * (1 - s / NS)); // fading back to where it was
}
```

**Source:** [stack.ts L442-448](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/stack.ts#L442-L448),
[L480-518](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/stack.ts#L480-L518).

### 11. A terrain with its own shader, and things placed exactly on it

A surface the camera flies over, with paths, labels and the camera itself exactly on or above it.

**Why it works.** The height function is written twice, TypeScript to place things and GLSL to draw, with the
GLSL constants written from the TypeScript ones (`toFixed`), so they stay one surface. The vertex shader
displaces in world space, after `modelMatrix`, so the twins share coordinates; the lines are computed per
fragment (entry 4), the mesh only carries the silhouette, and `polygonOffset` lets depth-tested lines drawn on
it win. Newton steps on the twin, `u -= h ∇h / |∇h|²`, put a label exactly on a contour (a fixed count keeps
it deterministic), and the camera is lifted above the twin sampled around it, every frame.

```ts
const K = 0.42; // one constant, both twins
const heightTS = (u: number, v: number) => Math.sin(K * u) * Math.sin(0.37 * v);
const TERRAIN_VERT = /* glsl */ `precision highp float;
in vec3 position;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vW;
float terrH(vec2 q) { return sin(${K.toFixed(4)} * q.x) * sin(0.37 * q.y); }
void main() {
  vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
  p.y = terrH(vec2(p.x, -p.z)); // displaced in world space
  vW = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const grad = (u: number, v: number, e = 0.01) =>
  [(heightTS(u + e, v) - heightTS(u - e, v)) / (2 * e), (heightTS(u, v + e) - heightTS(u, v - e)) / (2 * e)] as const;
const onContour = (u: number, v: number, level: number) => {
  for (let i = 0; i < 30; i++) { // a fixed count: deterministic
    const h = heightTS(u, v) - level, [gu, gv] = grad(u, v), g2 = gu * gu + gv * gv + 1e-6;
    u -= (h * gu) / g2; v -= (h * gv) / g2;
  }
  return { u, v }; // the contour runs along (-gv, gu)
};
```

**Source:** [loss.ts L21-89](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/loss.ts#L21-L89)
(the twins),
[L278-298](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/loss.ts#L278-L298)
(the mesh, 640×720 segments),
[L332-378](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/loss.ts#L332-L378)
(labels on contours),
[L579-584](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/loss.ts#L579-L584)
(the camera above the ground).

## Type

### 12. Width and weight steps hidden by a spring

Type that steps wider on every sixteenth, or a row squeezed into a narrower, heavier cut on each kick with
momentum, so the step reads as a squeeze rather than a cut.

**Why it works.** Canvas2D needs static outlines, so the grotesk comes as 6 widths × 4 weights and
`F.archivo()` snaps to the nearest: width moves in steps. To hide one, draw the new cut scaled horizontally by
`old width / new width` and let `springStep` bring the scale back to 1. The stage comes from `frameTime(t)`,
the spring from `t`, so a frame never mixes two cuts and the squeeze still blurs.

```ts
const STAGES = [{ width: 125, weight: 300 }, { width: 100, weight: 500 }, { width: 75, weight: 700 }, { width: 62, weight: 900 }];
let k = 0;
for (let i = 0; i < Math.min(kicks.length, STAGES.length); i++) if (frameTime(t) >= kicks[i]!) k = i;
const sp = k === 0 ? 1 : springStep(t - kicks[k]!, 3.2, 0.42);
const st = STAGES[k]!, prev = STAGES[Math.max(0, k - 1)]!, fam = F.archivo(st.width, st.weight);
const ratio = measure(text, F.archivo(prev.width, prev.weight), size) / measure(text, fam, size);
c.save(); c.translate(x0, 0); c.scale(lerp(ratio, 1, sp), 1); c.translate(-x0, 0); // squeezed about x0
c.font = font(fam, size); c.fillText(text, x0, y); c.restore();
```

The template's `videos/example/scenes/layer2d.ts` shows the other half: the words after a stepping word glide
aside before the step.

**Source:** [dense-press.ts L132-137](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/dense-press.ts#L132-L137),
[L186-200](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/dense-press.ts#L186-L200)
(the squeeze, with tracking and leading);
[room.ts L495-512](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/room.ts#L495-L512)
(a step per sixteenth).

### 13. Karaoke, four ways

Words that light exactly with the voice: a clip wipe, glyph by glyph, in a shader, or over a held note.

**Why it works.** Every wipe comes from `Words.wordProgress(w, t)`, piecewise through the syllables when the
data has them, and words are found by their text, so the light stays on the voice when the timing data is
made again. A word drawn in pieces starts each at `glyphX()`, which keeps the kerning (`docs/ENGINE.md`,
Typography).

```ts
const p = Words.wordProgress(w, t);
// 1. clip wipe: the dim word, then the lit word clipped to a rectangle that grows with p
c.fillStyle = rgba('fg', 0.28); c.fillText(txt, x, y);
c.save(); c.beginPath(); c.rect(x - 4, y - size, (ww + 8) * p, size * 1.3); c.clip();
c.fillStyle = rgba(p < 1 ? 'accent' : 'fg'); c.fillText(txt, x, y); c.restore();
// 2. glyph by glyph: glyph i of the word lights as the voice reaches it
const lit = clamp(p * Array.from(w.w).length - i);
// 3. in a shader: p as a uniform (entry 15), or each cell's position within its word in a mask texture
// 4. a long held word lights over its onset, not across the whole hold
const sung = w.end - w.start > 0.6 ? clamp((t - w.start) / 0.4) : p;
```

**Source:** [room.ts L534-580](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/room.ts#L534-L580)
(the clip wipe),
[ascent.ts L190-217](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/ascent.ts#L190-L217)
(per glyph),
[dense-gpu.ts L89-93](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/dense-gpu.ts#L89-L93)
(per cell),
[shoggoth.ts L823-825](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/shoggoth.ts#L823-L825)
(held words).

### 14. Per-glyph motion with velocity effects

Glyphs that rise or slam in one by one and stretch with their own speed, with a trail.

**Why it works.** Each glyph's position is a closed form of `t`, a stagger, an `outExpo` rise and a drift, and
its speed is the same function's difference a moment earlier: no state, so every sub-frame agrees. Stretch the
glyph along its motion by that speed, and draw a few offset outline copies behind it as a trail.

```ts
const posAt = (i: number, tt: number) => {
  const ts = t0 + i * stagger, e = ease.outExpo(clamp((tt - ts) / dur));
  return lerp(H + capH * 1.3, endY, e) - Math.max(0, tt - ts - dur) * 70; // rises in, then drifts on
};
const y = posAt(i, t), vel = Math.abs(posAt(i, t - 1 / 240) - y) * 240; // px/s
const stretch = 1 + clamp(vel / 5000, 0, 1.3);
c.save(); c.translate(x0 + lay.glyphs[i]!.x, y); c.scale(1, stretch); c.fillText(lay.glyphs[i]!.ch, 0, 0); c.restore();
const slam = (t: number, t0: number) => (t < t0 ? 1 : 1 + 0.14 * (1 - ease.outExpo(clamp((t - t0) / 0.16))));
```

**Source:** [hook.ts L273-324](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/hook.ts#L273-L324)
(the rising word),
[L119-130](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/hook.ts#L119-L130)
(a slam re-triggered on the beats),
[L400-415](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/hook.ts#L400-L415)
(stacked outline echoes).

### 15. Words on 3D planes with a wipe shader

A word in a three.js scene, tilted, distant or behind geometry, with a karaoke wipe that follows it through
any transform and stays sharp at 4K.

**Why it works.** Each word is drawn once into its own canvas at `px × SCALE`, the fill into R and an outline
into G with `'lighter'`, and uploaded as coverage (`NoColorSpace`) with mipmaps and anisotropy. The shader maps
`uv.x` onto the ink, so the feathered wipe ends exactly at `prog = 1`; per frame the scene only sets
`prog = Words.wordProgress(w, t)`. In a raymarched scene, cut the letters in the composite instead, occluded
by the upsampled depth (entry 7).

```ts
c2.globalCompositeOperation = 'lighter'; // on a canvas filled black, sized to the ink box plus padding
c2.fillStyle = '#f00'; c2.fillText(text, bx, by); // the fill's coverage in R
c2.strokeStyle = '#0f0'; c2.lineWidth = ol; c2.lineJoin = 'round'; c2.strokeText(text, bx, by); // the outline's in G
tex.colorSpace = THREE.NoColorSpace; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.anisotropy = 8;
```
```glsl
vec4 tx = texture(map, vUv);
float fill = tx.r, line = tx.g;
float u = clamp((vUv.x - u0) / max(1e-4, u1 - u0), 0.0, 1.0); // 0..1 across the ink
if (dir < 0.0) u = 1.0 - u; // a right-to-left wipe
float e = prog * (1.0 + feather);
float sung = prog <= 0.0 ? 0.0 : 1.0 - smoothstep(e - feather, e, u);
vec3 rgb = fill * sung * cSung + (line * aDim + fill * fillDim) * cDim * (1.0 - sung);
float a = fill * sung + max(line * aDim, fill * fillDim) * (1.0 - sung);
fragColor = vec4(rgb, a) * opacity; // premultiplied: blend One, OneMinusSrcAlpha
```

**Source:** [stack-kit.ts L17-48](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/stack-kit.ts#L17-L48)
(the shader),
[L81-150](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/stack-kit.ts#L81-L150)
(the canvas and the plane);
[stack.ts L602-662](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/stack.ts#L602-L662)
(words and letters driven per frame).

### 16. Pen writing synced to the words

A line written stroke by stroke by a pen, at the speed of the voice.

**Why it works.** `strokeText()` records the range of written length each character's strokes cover, and
`writtenLength(st, charTimes, t)` writes character `i` at an even speed over its own time slot. Slots from the
word timings give each letter an equal share of its word and each space none, so the pen keeps pace with the
voice. `drawStrokeText()` returns the pen's head, for a spark at the nib; the template's
`videos/example/scenes/linebatch.ts` writes a glyph per beat into a `LineBatch` instead.

```ts
function charTimes(words: Word[]): [number, number][] { // the words joined by single spaces
  const out: [number, number][] = [];
  words.forEach((w, wi) => {
    const n = Array.from(w.w).length;
    for (let j = 0; j < n; j++) out.push([lerp(w.start, w.end, j / n), lerp(w.start, w.end, (j + 1) / n)]);
    if (wi < words.length - 1) out.push([w.end, w.end]);
  });
  return out;
}
this.st = strokeText(line.words.map((w) => w.w).join(' '), 'script', 120); // init()
const head = drawStrokeText(c, this.st, writtenLength(this.st, charTimes(line.words), f.t)); // render()
```

**Source:** [stroke.ts L240-324](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/engine/stroke.ts#L240-L324)
(the functions, as in the template);
[spacetime.ts L346-371](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/spacetime.ts#L346-L371)
(written by a moving beam, hot near the pen, the strokes still to come faintly lit).

## Layered 2D: inks, textures, a page camera

### 17. Channel-coded inks overprinted like ink

Printed matter (a page, a form, a poster, a map) where up to three inks darken where they overlap and the paper
shows through, for one Canvas2D upload.

**Why it works.** Everything is drawn into one `Layer2D` cleared to opaque black with `'lighter'`, each ink in
its own channel, and uploaded as data (`NoColorSpace`). The paper shader multiplies the paper colour by
`transmission ^ coverage` for each ink, transmission being the ink colour over the paper colour (Beer–Lambert):
no alpha halos, and each ink can get its own grain or texture.

```ts
const INK_A = (a = 1) => `rgba(255,0,0,${a})`, INK_B = (a = 1) => `rgba(0,255,0,${a})`, INK_C = (a = 1) => `rgba(0,0,255,${a})`;
this.ink.texture.colorSpace = THREE.NoColorSpace; // init(): coverage, not colour
this.ink.clear('#000'); this.ink.ctx.globalCompositeOperation = 'lighter'; // render(), then each ink in its channel
```
```glsl
vec4 ink = texture(inkTex, vUv);
vec3 col = paper; // uPaper with its texture (entry 18); uPaper, uInkA..C: linear colours from LIN
col *= pow(clamp(uInkA / uPaper, 0.004, 1.0), vec3(sat(ink.r)));
col *= pow(clamp(uInkB / uPaper, 0.004, 1.0), vec3(sat(ink.g)));
col *= pow(clamp(uInkC / uPaper, 0.004, 1.0), vec3(sat(ink.b)));
```

**Source:** [bureau.ts L23-26](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/bureau.ts#L23-L26)
(the inks),
[L113-126](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/bureau.ts#L113-L126)
(grain per ink, the overprint),
[L471-501](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/bureau.ts#L471-L501)
(the ink pass).

### 18. Paper fibres and stamp ink

Paper that holds up in close-up, and stamps with voids, mottling and heavier edges.

**Why it works.** Fibres are one random short segment per cell of a 3×3 neighbourhood, with a random sign for
light and dark ones, over fbm and rare specks. Evaluated in page coordinates (through the camera's inverse,
entry 19), the texture stays on the paper as the camera moves. Stamps are ordinary Canvas2D shapes in one ink
channel, and inside each stamp's rectangle the shader turns them into stamp ink: voids from thresholded noise,
a low-frequency pressure, and more ink at the edges (the coverage minus a 4-tap blur of it), where a rubber
stamp pools.

```glsl
float fibres(vec2 p, float cs) { // p in page px; cs = the cell size
  float acc = 0.0; vec2 cell = floor(p / cs);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = cell + vec2(float(i), float(j)), o = (c + hash22(c)) * cs;
    float a = hash12(c + 7.1) * TAU, L = cs * (0.3 + 1.1 * hash12(c + 3.3));
    vec2 d = vec2(cos(a), sin(a));
    acc += (hash12(c + 9.9) - 0.5) * (1.0 - smoothstep(0.25, 0.9 + 0.4 / zoom, sdSegment(p, o - d * L * 0.5, o + d * L * 0.5)));
  }
  return acc;
}
float stampInk(vec2 p, float cov, float edge, float seed, float strength) {
  float n = snoise(p * 0.07 + seed) * 0.45 + snoise(p * 0.23 + seed * 2.0) * 0.35 + snoise(p * 0.9 - seed) * 0.2;
  float press = smoothstep(-0.9, 0.3, snoise(p * 0.0045 + seed * 3.0));
  float voids = smoothstep(-0.58, -0.36, n + (strength - 1.0) * 0.8 + 0.25 * press);
  return sat(cov * voids * (0.72 + 0.28 * press) * 1.25 + edge * 0.5);
}
```

**Source:** [bureau.ts L41-71](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/bureau.ts#L41-L71)
(fibres, stamp mask, stamp ink),
[L81-112](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/bureau.ts#L81-L112)
(the paper, the edges).

### 19. A page camera and whip blur

Pan, zoom and roll over a big flat document or map through one affine transform, with a directional blur only
on whips that never smears across a cut. Like the smear (entry 10), the blur is a look on top of the render's
motion blur.

**Why it works.** A 2D similarity maps page to screen: Canvas2D draws through `setTransform`, and the shader
gets the inverse, so procedural texture is computed in page space. The camera is a function of `t`, so where it
was a frame earlier costs nothing: the blur vector is how far the screen centre moved, with a dead zone under
40 px, a cap at 170 px and nothing across a cut, and the shader averages 32 jittered taps along it. `invXf`
(the inverse affine) and `apply` (a point through one) are in the first source link.

```ts
const camXf = (cam: Cam) => { // page -> screen for { x, y, z: zoom, r: roll }
  const a = Math.cos(cam.r) * cam.z, b = Math.sin(cam.r) * cam.z;
  return { a, b, c: -b, d: a, e: W / 2 - (a * cam.x - b * cam.y), f: H / 2 - (b * cam.x + a * cam.y) };
};
const dt = 1 / VIDEO.fps; // the whip blur: where the screen centre was one frame ago
const pc = apply(invXf(camXf(this.camAt(t))), W / 2, H / 2), q = apply(camXf(this.camAt(t - dt)), pc.x, pc.y);
const bx = q.x - W / 2, by = q.y - H / 2, len = Math.hypot(bx, by);
const k = this.cutBetween(t - dt, t) || len <= 40 ? 0 : (Math.min(1, (len - 40) / 30) * Math.min(170, len * 0.5)) / len;
```

**Source:** [bureau.ts L189-204](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/bureau.ts#L189-L204)
(the transforms),
[L455-469](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/bureau.ts#L455-L469)
(the blur vector),
[L91-102](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/bureau.ts#L91-L102)
(the taps);
[leftturn-map.ts L318-327](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/leftturn-map.ts#L318-L327)
(a camera with a keystone tilt, in a shader).

### 20. Typewriter, tear, stutter

Text typed in step with its words, a page torn in two, and a moment replayed three times on the beat.

**Why it works.** Each character gets a strike time inside its word, plus a hashed jitter and rotation, and
lifts briefly as it strikes. A tear is a noise line `x(y)`, and each piece is drawn through its own inverse
affine, hinging, then tumbling away. A stutter needs no new drawing: the scene is a function of time, so
replaying a stretch is remapping `t`, one remapped time for the camera and the drawing alike. Take the jumps
from `frameTime(t)`: keyed to `t`, a motion-blurred frame on a jump shows both sides of it at once.

```ts
const per = Math.min(0.07, (w.end - w.start) / Math.max(1, chars.length)); // strikes inside the word
chars.forEach((ch, i) => out.push({ ch, t: w.start + i * per, x: x + i * adv, jx: (hash(k + i, 2) - 0.5) * 1.6, rot: (hash(k + i, 4) - 0.5) * 0.02 }));
const remap = (t: number) => { // [src0, src1] replayed three times over [rep0, rep1]
  const tf = frameTime(t); // which side of a jump: the frame's own time, so no frame averages both
  if (tf < rep0 || tf >= rep1) return t;
  const seg = (rep1 - rep0) / 3, n = Math.min(2, Math.floor((tf - rep0) / seg));
  return lerp(src0, src1, (t - rep0 - n * seg) / seg);
};
```

**Source:** [bureau.ts L294-325](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/bureau.ts#L294-L325)
(typewriter),
[L143-187](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/bureau.ts#L143-L187)
(the tear),
[L341-351](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/bureau.ts#L341-L351)
(the remap).

## Fields and time

### 21. Domain warping

Noise with a folded, hand-drawn quality, sampled at a point displaced by two other lookups; drawn as contours
(entry 4), it reads as a survey map. The two offsets decorrelate the x and y displacements (one shared lookup
would push everything along a diagonal), the `dot` tilts the field so the contours have a direction, and an
unwarped octave adds detail.

```glsl
vec2 q = w + 260.0 * vec2(snoise(w * 0.0007 + vec2(1.3, 9.1)), snoise(w * 0.0007 + vec2(5.2, 0.4)));
float h = dot(q, vec2(-0.0042, 0.0052)) + 1.1 * snoise(q * 0.0011 + vec2(3.1, 1.7)) + 0.35 * snoise(w * 0.003 + vec2(7.7, 2.3));
```

**Source:** [leftturn-map.ts L370-373](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/leftturn-map.ts#L370-L373).

### 22. Droste recursion

An image that contains itself level after level, with an optional Escher spiral and a continuous zoom through
the levels; the innermost level can be another scene's live frame, so the dive lands on the next scene.

**Why it works.** In log-polar coordinates, scaling by `s` is a shift by `log s`: the zoom is a translation and
the nesting a periodic wrap. Multiplying by the complex `c = (1, -twist·log s / 2π)` shears the strip so one
turn climbs one level, the spiral. Back through `exp`, scale by `s` until the point lies between the inner and
outer rectangle, counting levels. Only whole twists tile, so the spiral comes in as a cross-fade of the flat
and the one-turn images. The map is continuous, so its gradients are taken analytically for `textureGrad`:
implicit ones jump at the level seams and blur them.

```glsl
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 cexp(vec2 z) { return exp(z.x) * vec2(cos(z.y), sin(z.y)); }
vec2 clog(vec2 z) { return vec2(log(length(z)), atan(z.y, z.x)); }
// z: centred, y up, in half-heights; s: the scale between levels; tw: 0.0 or 1.0
vec2 c = vec2(1.0, -tw * log(s) / TAU);
vec2 Wz = cmul(clog(z), c); Wz.x -= zoom * log(s);
vec2 w = cexp(Wz); float level = 0.0;
for (int i = 0; i < 24; i++) { if (max(abs(w.x) / asp, abs(w.y)) < 1.0 / s) { w *= s; level += 1.0; } else break; }
for (int i = 0; i < 24; i++) { if (max(abs(w.x) / asp, abs(w.y)) > 1.0) { w /= s; level -= 1.0; } else break; }
vec2 dwdz = cmul(cexp(Wz), c); // d/dz exp(c log z) = exp(W) c / z
dwdz = vec2(dwdz.x * z.x + dwdz.y * z.y, dwdz.y * z.x - dwdz.x * z.y) / max(dot(z, z), 1e-8);
```

**Source:** [loom-glsl.ts L11-82](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/loom-glsl.ts#L11-L82)
(the shader, with the bottom level and a label per level);
[loom.ts L405-426](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/loom.ts#L405-L426)
(a level per beat; the next scene rendered only once it shows).

### 23. Lensing

An image bent by a gravitational lens, with the Einstein ring and the flipped inner image for free. Trace each
pixel back to the source plane through the thin-lens equation `β = θ (1 - θE² / |θ|²)` and look up whatever
lives there (an analytic grid, a canvas layer); sample that texture in uniform control flow, so its
derivatives pick the right mip.

```glsl
vec2 d = FRAG_PX - uC; // from the lens centre, logical px
vec2 q = uC + d * (1.0 - uThE * uThE / max(dot(d, d), 1e-2)); // the source-plane point this pixel sees
```

**Source:** [spacetime-lens.ts L38-60](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/spacetime-lens.ts#L38-L60)
(a box-filtered grid and the lens),
[L104-130](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/spacetime-lens.ts#L104-L130)
(the lensed layer, a shadow disc and a photon ring);
[ascent-note.ts L156-213](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/ascent-note.ts#L156-L213)
(a warp into a point, with a swirl).

### 24. Deterministic particles

Sparks, sputter, dust: hundreds of particles without state, so seeks, stills and the render's sub-frames,
which arrive in any order, agree.

**Why it works.** A particle is an integer `n` born at `tb = n / rate`, and only those that can still be alive
are visited. Its angle, speed and lifetime are hashes of `n`, and its path starts where the emitter was at its
birth, `headAt(tb)`, so the trail follows the emitter's past. A rate that varies runs the births on the
constant `rateMax` clock and keeps particle `n` only if `hash(n) · rateMax < rate(tb)`: each particle keeps its
identity, where a rate read at the current `t` re-times them all between two sub-frames. `headAt` returning
`null` suppresses births (before the emitter exists, outside a beat window).

```ts
type Emit = { rate: (tb: number) => number; rateMax: number; life: number; speed: number; gravity: number; seed: number; rgb: [number, number, number] };
function particles(lb: LineBatch, t: number, headAt: (tb: number) => { x: number; y: number } | null, o: Emit) {
  const { rateMax: R, life, speed, gravity: g, seed } = o;
  for (let n = Math.floor((t - life) * R); n <= Math.floor(t * R); n++) {
    const tb = n / R, age = t - tb;
    if (tb > t || hash(n, seed + 3) * R >= o.rate(tb)) continue; // thinned on a fixed clock
    const h = headAt(tb), lf = life * (0.35 + 0.65 * hash(n, seed + 2)); // the emitter at the birth
    if (!h || age > lf) continue;
    const a = hash(n, seed) * TAU, sp = speed * (0.25 + hash(n, seed + 1) ** 2 * 1.2);
    const vx = Math.cos(a) * sp, vy = Math.sin(a) * sp - speed * 0.3;
    const at = (s: number) => [h.x + vx * s, h.y + vy * s + 0.5 * g * s * s] as const;
    const [x0, y0] = at(Math.max(0, age - 0.018)), [x1, y1] = at(age); // an 18 ms streak
    const k = 1 - age / lf;
    lb.seg2(x0, y0, x1, y1, 1.6 * (0.5 + 0.7 * k), o.rgb, Math.min(1, k * 1.4));
  }
}
```

**Source:** [_motifs.ts L10-48](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/_motifs.ts#L10-L48)
(the particles);
[fuse.ts L645-655](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/fuse.ts#L645-L655)
(a rate swelling before a hit, bursts gated to beat windows).

### 25. Motion without state

Things that seem to remember (rings from past beats, a value knocked from key to key, a string ringing after a
pluck) while each frame stays a function of `t`.

- **Event history as uniforms:** pass the last few beat or onset times and compute each ring from `t - ti` in
  the shader
  ([dense-gpu.ts L99-107](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/dense-gpu.ts#L99-L107)),
  or enumerate the past beats on the CPU every frame and age them
  ([room.ts L514-532](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/room.ts#L514-L532)).
- **Stepped springs:** a value that steps between keys, each step caught by a damped spring, as a sum of step
  responses
  ([dense-askew.ts L171-181](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/dense-askew.ts#L171-L181)):

  ```ts
  function stepped(t: number, ks: [number, number][], freq: number, damp: number) {
    let v = ks[0]![1];
    for (let i = 1; i < ks.length && t > ks[i]![0]; i++) v += (ks[i]![1] - ks[i - 1]![1]) * springStep(t - ks[i]![0], freq, damp);
    return v;
  }
  ```
- **A simulation integrated once, in `init()`:** step it at a fixed rate into a table and interpolate the table
  by `t`. It moves like a simulation, and the scene stays stateless, so the render keeps its adaptive motion
  blur, which `stateful` scenes lose
  ([fuse.ts L415-467](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/fuse.ts#L415-L467),
  a string driven by the sung pitch). Integrating a speed that steps up every beat gives a "flow clock", for
  things that should go faster and faster without a jump
  ([spacetime.ts L205-213](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/spacetime.ts#L205-L213)).
- **Another scene at a remapped time:** keep a private instance of a scene and render it at a time of your own,
  backwards, slowed, braking to its first frame
  ([outro.ts L774-797](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/outro.ts#L774-L797)).
  For plain re-use, a timeline entry can play another video's scene, with `remix` (`docs/ENGINE.md`).

### 26. More, one line each

- **A field of 100,000 cells from a data texture:** words rasterised into a small mask (R in the text, G the
  position within the word, B the word); karaoke per cell is `step(m.g, progress)`
  ([dense-gpu.ts L17-62](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/dense-gpu.ts#L17-L62)).
- **An area light:** the light a rectangle casts on a point, exactly, by Lambert's polygon form factor
  ([ilya-glsl.ts L192-213](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/ilya-glsl.ts#L192-L213)).
- **An endless raymarched lattice by cell repetition,** each cell hashing its own orientation and missing
  pieces
  ([paperclips-glsl.ts L155-209](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/paperclips-glsl.ts#L155-L209)).
- **A CRT-style collapse:** a uniform squashes the camera rays toward the centre line until the image is one
  line
  ([shoggoth-glsl.ts L30-34](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/shoggoth-glsl.ts#L30-L34)).
- **Line architecture projected on the CPU** into `LineBatch`es: near-plane clipping by hand, a screen-space
  warp, text on 3D planes in Canvas2D through an affine from three projected points
  ([room.ts L800-838](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/room.ts#L800-L838)).
- **Text into points, points onto a path:** `textPoints()` samples the glyphs, and each point is eased to a
  place along a target path, sorted by x
  ([spacetime.ts L215-258](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/spacetime.ts#L215-L258)).
- **One shape for the CPU and the GPU:** a curve used for paths in TypeScript and as an SDF in GLSL, from one
  definition
  ([paperclips-geo.ts](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/src/scenes/paperclips-geo.ts)).

## The template's example scenes, by way of drawing

Every project has them in `videos/example/scenes/`, one per way of drawing, written to the rules above; the
header of each says what it shows.

| Way of drawing | Scene | What it demonstrates |
|---|---|---|
| Fullscreen GLSL (`FSPass`) | `fspass.ts` | The whole frame from one signed distance field: isolines as rings that hold at 4K (entry 1), a shape morph every isoline follows, ruler ticks by domain repetition, `hatch()` thickened by the kick, fronts from `audio.events('kick')`, a keep-out box around the label, a flash of the drawing instead of post's `flash` |
| three.js | `three.ts` | An `InstancedMesh` driven from `t`, a camera through poses on the beats with `smoothKeys` (an inset plots its speed against `keys()`), fog that follows the camera, a 4× multisampled target copied into `out`, light intensities as fractions of π, an `up` that holds looking straight down, a small `Layer2D` inset placed with `rect` |
| Canvas2D type (`Layer2D`) | `layer2d.ts` | Karaoke of lines found with `words.get()`: glyphs and width/weight steps from `Words.wordProgress` at `frameTime`, the layout gliding at `t`, `glyphX` splitting a word without losing its kerning, the gap between runs in two fonts, cheap uploads (still parts once, each line only when it changes, moving parts in a small strip) |
| GPU lines (`LineBatch`) and stroke fonts | `linebatch.ts` | One batch with blend `max` for a lattice, an inked figure and a word, `strokeText` and `writtenLength` writing a glyph per beat, a pen that surges on each beat, a head above 1.0 that the bloom makes glow, a shimmer keyed to `frameIdx`, a dashed preview so the first frame is already a composition |

`_label.ts` is a helper the four share (named exports only): a label in the title-safe area.

## Pitfalls

- **Derivatives in a branch that differs between neighbouring pixels.** `fwidth`, `dFdx` and `texture()` with
  an implicit mip level are undefined in non-uniform control flow (GLSL ES 3.00, §8.8 and §8.9), and so is
  every helper that calls them (`hatch`, `aaFill`, `aaStroke`, the `contour` and `elineLod` above). The source
  of entry 3 calls them inside `if (cov > 0.001)`, which diverges along silhouettes. Compute such terms before
  the branch and mask by multiplying, branch only on uniforms, pass explicit gradients (`textureGrad`), or,
  after a raymarch loop, use an explicit footprint.
- **Derivatives in a loop that can `break`.** On Windows, Chrome runs WebGL on Direct3D 11, and there `fwidth`
  and `texture()`'s mip came out wrong inside `for (int i = 0; i < 16; i++) { if (i >= uTaps) break; … }`,
  though `uTaps` is a uniform (tested on an Intel GPU: the contours vanished, a minified texture took its
  finest mip). The same body in `for (int i = 0; i < uTaps; i++)`, in a constant loop with an `if` and no
  `break`, or in the `SS_TAP` loop drew correctly, and so did a footprint taken before the loop and passed in.
- **Reversed `smoothstep` edges.** `smoothstep(e0, e1, x)` is undefined when `e0 >= e1` (§8.3), and equal edges
  divide by zero. The sources often reverse them (`smoothstep(0.9, -0.6, y)`) and get the mirrored ramp because
  GPUs use the reference formula; `1.0 - smoothstep(e1, e0, x)` doesn't depend on that.
- **Rates that vary over time.** A particle rate, lifetime or speed read at the current `t` re-times every
  particle between the sub-frames of one frame, so the frame whose shutter straddles a change averages two
  particle sets: make it a function of the birth time (entry 24).
- **NaN and infinity.** The render drops a sub-frame's pixel when a channel is NaN or beyond ±6e4 (a range test,
  which catches NaN because every comparison with NaN is false), so one bad value can't poison the average and
  bloom into a disc. The preview, stills and sheets render one sample without that filter, and GLSL ES doesn't
  promise NaNs are produced or propagated (§4.5.1), so guard at the source: `pow(sat(x), p)`,
  `sqrt(max(0.0, x))`, `max(…, 1e-4)` in denominators, `log` and `inversesqrt` of positive values only.
- **Half-float limits.** `out` and `makeRT()` targets are HalfFloat: at most 65504, about three significant
  digits (between 16 and 32 the step is 1/64). Fine for colour; data for a later pass (depth, surface
  coordinates, positions) goes in a `type: THREE.FloatType` target (entry 6).
- **Data in a canvas texture** (coverage, masks, ids) is uploaded with `NoColorSpace`: `Layer2D` decodes sRGB by
  default, which bends the values.
- **`add` on overlapping lines.** Where `blend: 'add'` segments overlap, some GPUs round the sums differently
  from one render to the next; the smear of entry 10 drawn that way failed `render.ts verify` on an Intel GPU
  (1/255 on 76 px of a frame). `max`, the default, gives the same result in any order.
