# Images

Pictures from outside code (generated, archival, the director's own) as material the code layers, lights,
masks and moves. Read it when a piece would gain from something code draws poorly, when the director brings
images, when they ask for generated ones, or when the piece shows a product's screens. `<skill>` is this skill's folder; other paths are the project's.

Contents: When an image earns its place · Where images come from · Making them part of the picture · One look
across many images · Size and 4K · The record · Checking

## When an image earns its place

Code draws light, geometry, type, fields, particles and motion better than any still. It draws poorly a
painted or photographic surface, a face or a character, a period document, the grain of a real material.
That is where an image earns its place, as a plate, a texture, a cut-out, a mask or a source of light, never
as a slide unless the director wants their pictures shown as they are: what makes it video is what the code
does to it. A still that only pans and zooms is the Ken
Burns line on the Avoid list. For anything factual or historical, a real image beats a generated one: a
generated "1920s photo" in an explainer is a fabrication.

## Where images come from

**The director's own.** Their files, their rights; for a client's piece, note the basis they give (own
work, a stock licence and its ID, releases for the people in it).

**Their product's screens.** A factual demo of an app, a site or a device shows the real one by default:
the screens the director gives, or captured from its live site with their OK (below), shown as they are.
Left to you, a lookalike redrawn from memory, a screen the product doesn't have, or a figure nobody gave
reads as the product and isn't: a fabrication, like a generated "1920s photo" in an explainer. Code still
does what makes it video (the device, the scroll, the tap, the light, the transitions), and a value the
scenes animate over a real screen is labelled as illustrative where it could be taken for a claim. A
screen a factual demo needs that nobody has yet waits for the director: the brief asks for it, the rest
builds meanwhile, and until it comes the moment is told another way or with a placeholder that reads as
one (a grey frame named for the missing screen), never a convincing fake.

A concept, a mockup or a stylized reconstruction the director asks for is theirs to ask for: make it, in
the product's style when they want that, and mark it as a concept wherever a viewer could take it for
the shipping product (their own label, such as "Concept", or one you add and say so). What stays out
either way is an invented feature, result or figure presented as a fact about the product.

A page behind a login or a cookie banner is theirs to capture or to send. Each screen gets its line in
SOURCES.md, by where it really came from: supplied by the director, captured from its URL (with the date),
or a concept made for this video at their request (never recorded as a capture). To capture one, save this
as `.audara-cache/capture.ts` and run `bun .audara-cache/capture.ts` from the project (it uses the
project's playwright-core and Chrome):

```ts
import { chromium } from 'playwright-core';
const shots = [{ url: 'https://<their site>/', file: 'videos/<video>/assets/screen-home.png' }];
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true }); // a phone; a desktop: 1440x900 at 2
for (const s of shots) {
  await page.goto(s.url, { waitUntil: 'networkidle' });
  await page.screenshot({ path: s.file }); // the viewport; fullPage: true for the whole page
}
await browser.close();
```

**Public domain and open licences.** Free, real, and often the strongest material: a whole music video has
rested on about forty public-domain images and films, treated in code.
These answer without a key, with licence fields to record (checked 2026-10):

```
# Wikimedia Commons: originals and their licence metadata
curl -s "https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrsearch=<words>&prop=imageinfo&iiprop=url|size|extmetadata" -A "<project> (contact)"
# Openverse: broad discovery, filtered to CC0 and public domain
curl -s "https://api.openverse.org/v1/images/?q=<words>&license=cc0,pdm"
# The Met: search, then each object's record (isPublicDomain, primaryImage, artistDisplayName, creditLine)
curl -s "https://collectionapi.metmuseum.org/public/collection/v1.1/search?q=<words>&isPublicDomain=true&hasImages=true&limit=20"
curl -s "https://collectionapi.metmuseum.org/public/collection/v1/objects/<id>"
# The Cleveland Museum of Art: CC0 records with print-size images (share_license_status, creditline, images.print.url)
curl -s "https://openaccess-api.clevelandart.org/api/artworks/?q=<words>&cc0=1&has_image=1&limit=10"
```

- In the US, works published in 1930 or earlier are public domain (as of 2026); elsewhere the term runs
  from the author's death. CC0 and public domain need no credit (give one anyway when the source asks).
- CC BY needs a credit; CC BY-SA makes the treated image BY-SA too; NC rules out client and monetized work.
  "No known copyright restrictions" is not a warranty. People and logos in a photo carry rights of their
  own. A film's soundtrack can be under copyright when its picture isn't: mute it.
- When the director cares which images go in, show a numbered sheet of candidates with source and licence
  under each; otherwise choose, and say what you chose.

**Generated.** Money waits for a yes (SKILL.md, Fixed), and a key in the environment is not one:
- When a piece would clearly gain from something code draws poorly and the director hasn't asked for
  images, mention generated images once, in a line with what you'd make and the cost, as an option outside
  the brief's defaults (a "go" to the brief doesn't buy them), and keep building in code. When they ask for
  images in their own words ("generate what you need", "use any keys you have"), that is the yes: within
  their budget when they set one; without one, for the images the treatment plans, each cost in Decisions,
  asking before more. Otherwise draw in code.
- **With an OpenAI key** (`OPENAI_API_KEY`), in either tool: `uv run <skill>/scripts/imagegen.py generate
  <name> --video <video> --prompt "..."` (GPT Image 2.5). Without a key it spends nothing and prints the
  cost and the free paths; without `--yes` it prints what it would make and what that costs; with it, the
  image lands in `videos/<video>/assets/` beside its `.request.json`. An unchanged request makes no call,
  and renders never call it. About $0.04 for a high-quality 1536×1024 image and $0.10 at 3840×2160 (an
  estimate; the script records the real cost). `--help` has the rest: `--style`, `--ref`, `--transparent`,
  `--takes`, `pick`. In a sandbox without network it can't connect, and says nothing was sent: run it with
  network access.
- **In Codex without a key**, its built-in image generation ("$imagegen", gpt-image-2) draws on the
  ChatGPT plan's limits: that is spending too, so the same rules apply, and the reply says so. It picks size and quality itself
  (no 4K, no exact aspect): good for textures and plates you'll scale; style frames stay renders in the
  engine, since they prove what code will make. It saves under `$CODEX_HOME/generated_images/`: copy each
  file into `assets/`, put its prompt word for word in `<name>.prompt.txt` beside it (there is no request
  file, and the prompt is how a similar image gets made again), and write its record (below). Signed in
  with an API key instead, it bills that key.
- Another provider fits better for some jobs: images beyond 4K or one character across many shots (Google's
  Gemini image models), vector art (Recraft). Use one when the director names it, behind the same rules.
- Generated video clips stay out unless the director asks (SKILL.md).

## Making them part of the picture

Images load in a scene's `init()` and pass through the engine like everything else (`references/contract.md`,
"Images and footage": colour space, what the post does to them, footage as frames). One shot that worked
(verified 2026-10, `verify` passing at 1× and 4K): a public-domain landscape as a plate that develops out of a
halftone, a title passing between it and a cut-out in front, a light sweep crossing all three, every layer
moving at its own rate from one camera value keyed to beats.

```ts
async function loadTexture(renderer: THREE.WebGLRenderer, file: string) {
  const tex = await new THREE.TextureLoader().loadAsync(new URL('../assets/' + file, import.meta.url).href);
  tex.colorSpace = THREE.SRGBColorSpace; // unset reads as linear: washed out
  renderer.initTexture(tex);             // upload and mipmaps now, not on the first frame that shows it
  return tex;                            // (type the field THREE.Texture<HTMLImageElement> to read .image.width)
}
// render(): one camera value, three rates of parallax
const at = (beats: number) => audio.timeOfBeat(this.beat0 + beats);
const u = smoothKeys(f.t, [[at(0), 0], [at(16), 1]]), camX = (u - 0.5) * 140;
this.pass.u.rect!.value.set(W / 2 - camX * 0.4 - pw / 2, H / 2 - ph / 2, pw, ph);        // the plate, slowest
this.pass.render(renderer, out);                                                            // an FSPass: plate + treatment
comp.draw(renderer, this.title.texture, out, { rect: [tx - camX, H * 0.36, tw, th] });      // between the layers
comp.draw(renderer, this.cutout, out, { rect: [cx - camX * 1.9, cy - ch / 2, cw, ch], tint: lit });  // in front, fastest
```

In the plate's shader, the image is a source, not the frame:

```glsl
vec3 c = texture(plate, uv, -0.5).rgb;  // bias -0.5: full detail for a plate shown at 0.6-1x its size
vec2 g = rot2(0.785398) * (uv * texSize) / PITCH, cell = floor(g) + 0.5;  // halftone cells in texels: they ride the picture
float tone = pow(luma(textureLod(plate, rot2(-0.785398) * cell * PITCH / texSize, 3.0).rgb), 1.0 / 2.2);
vec3 ht = mix(C_BG, C_FG, aaFill(length(g - cell) - 0.64 * sqrt(tone)));
c = mix(c, ht, smoothstep(edge - 0.05, edge + 0.05, uv.x));                  // it develops out of the halftone
c += C_ACCENT * 1.4 * exp(-pow((b - sweep) / 0.09, 2.0)) * smoothstep(0.35, 0.8, pow(luma(c), 1.0 / 2.2)); // light on the bright parts
```

- **Cut-outs:** GPT Image 2.5's `--transparent` subjects come out about 99% opaque (alpha mostly 252-253,
  never 255) inside a faint alpha 1-11 haze (measured 2026-10): clamp both when preparing one (alpha over
  about 240 to 255, under about 8 to 0), or a layer moving behind it shows through and the haze picks up
  colour. Look at a cut-out over a flat colour: an image reader that ignores alpha shows the colour bled
  under it as a glowing halo that isn't in the picture. Straight alpha with the colour bled into the transparent pixels; black under alpha 0 gives a
  dark rim when the image is shown small. Resize colour and alpha separately (Pillow premultiplies RGBA and
  loses the bleed). Leave `premultiplyAlpha` off on an sRGB texture: it darkens soft edges.
- **Sharpness:** mipmaps soften a plate shown just under its size by about a sixth; keep them and sample with
  a bias of -0.5, or turn them off when nothing samples it blurred. A plate shown larger than its file (a 3:2
  plate cropped to 16:9 and pushed in) is soft whatever the sampling: generate it bigger. A halftone or any cell-snapped lookup
  uses `textureLod`: `texture()` picks the wrong mip at every cell edge.
- **Memory:** width × height × 4 bytes plus a third for mipmaps (22 MB for a 2560×1440 plate); footage
  frames are the costly kind (`references/contract.md`).
- **A picture that must match its file** (a logo, a product shot, a screen): the entry's post `{ bloom: 0 }`, and the
  scene undoes the tone shoulder before it writes (it mirrors `SHOULDER_GLSL` in `src/engine/post.ts`; with
  the cap at 0.998, greys land within 0.2 levels of the file):
  `vec3 unshoulder(vec3 y) { const float k = 0.72; vec3 yc = min(y, vec3(0.998)); return mix(y, k - (1.0 - k) * log(1.0 - (yc - k) / (1.0 - k)), step(k, y)); }`

Lighting and joining generated layers (from a 20 s piece made of a night plate, its dawn variant and a cut-out):

- **A cut-out lit for its scene** needs a pass of its own: a tint only multiplies, so a daylit subject on a
  night plate still reads daylit. Grade it there (partly desaturate, then a cool tint that keeps red above
  green above blue on warm fur, or it turns grey or lilac), mix toward a lit colour for a local light rather
  than adding to the graded one, and take a rim light from the alpha's difference toward the light. The pass
  outputs premultiplied colour, `vec4(col * a, a)`, with blend factors One, OneMinusSrcAlpha set on it: the
  default (SrcAlpha) multiplies by alpha a second time.
- **Contact under parallax:** a cut-out standing on ground painted into the plate slides over it once the two
  move at different rates. Hide the contact behind a nearer layer (grass, a ridge) or move the touching
  layers at one rate.
- **Two plates of one place** (the second made from the first with `--ref`) line up to the pixel. Go from one to
  the other with a reveal that starts at the light source, a wide ellipse along the horizon with a warm edge on
  the bright parts, rather than a crossfade, which reads as a dissolve.
- **Masks** don't come with a generated image: make one in its own pixels (a shape tuned on an overlay, a
  brightness test) and port its numbers to the shader. Light pushed past about 1.2 linear in a saturated
  colour washes to white through the tone shoulder; keep a coloured glow near 1.0.

## One look across many images

- One style block for every prompt, kept in the video's folder and passed with `--style`; one master
  frame passed with `--ref` to the images that follow it (a night plate re-lit to dawn this way kept its
  composition exactly; the reference adds image-input cost the estimate leaves out: $0.054 billed against
  $0.041 estimated at 1536×1024 high); the model snapshot pinned (the script does).
- A subject and its background as separate images (a clean plate, a cut-out with `--transparent`), so a
  move never opens a hole behind the subject.
- The same treatment in code over every source (one grade, one grain, one halftone screen) makes forty
  images from forty places read as one piece.

## Size and 4K

Sizes in `video.json` are logical; `--scale 2` renders 4K, so a plate needs at least twice the logical
width it's shown at (a 2560-wide plate shown 2100 px wide looked soft at 4K; the 3840 one held), plus room for
what the camera does: a 10% push at 3840 wide needs about 4220 px. For a 4K render pass imagegen.py
`--size 3840x2160`; the script's default (the video's size × 4/3) suits 1080p. OpenAI's largest is 3840×2160 (above
2560×1440 counts as experimental), so for a move at 4K, keep the camera still and move layers, upscale, or
use a provider that goes bigger. A soft background behind sharp code-drawn type survives a 1.5× upscale.

## The record

Every file in `videos/<video>/assets/` that didn't come from code has a row in `assets/SOURCES.md`:

| File | Source | Creator, date | Licence or basis | Credit line | Treatment | Used |
|---|---|---|---|---|---|---|
| `fox-plate.png` | generated: `fox-plate.request.json` | GPT Image 2.5, 2026-10-04 | owned by the user (OpenAI terms) | none | halftone, parallax layer | 0:00-0:08 |
| `jar-glow.png` | generated in Codex ($imagegen): `jar-glow.prompt.txt` | gpt-image-2, 2026-10-04 | owned by the user (OpenAI terms) | none | additive glow layer | 0:04-0:10 |
| `derby-1896/` | <landing page URL> | <photographer>, 1896 | public domain (US, published 1896) | "<as the source asks>" | dithered, cropped | 0:12-0:15 |

The end card or the video's description carries the credits the licences require.

## Checking

Look at every image before it goes in (the script prints "not looked at yet"), and judge it in motion in the
composite, not alone: stills at the moments it moves, a draft clip, and the critic's full-cut round.
