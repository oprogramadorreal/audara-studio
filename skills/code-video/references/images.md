# Images

Pictures from outside code (generated, archival, the director's own) as material the code layers, lights,
masks and moves. Read it when a piece would gain from something code draws poorly, when the director brings
images, or when they ask for generated ones. `<skill>` is this skill's folder; other paths are the project's.

Contents: When an image earns its place · Where images come from · Making them part of the picture · One look
across many images · Size and 4K · The record · Checking

## When an image earns its place

Code draws light, geometry, type, fields, particles and motion better than any still. It draws poorly a
painted or photographic surface, a face or a character, a period document, the grain of a real material.
That is where an image earns its place, as a plate, a texture, a cut-out, a mask or a source of light, never
as a slide: what makes it video is what the code does to it. A still that only pans and zooms is the Ken
Burns line on the Avoid list. For anything factual or historical, a real image beats a generated one: a
generated "1920s photo" in an explainer is a fabrication.

## Where images come from

**The director's own.** Their files, their rights; for a client's piece, note the basis they give (own
work, a stock licence and its ID, releases for the people in it).

**Public domain and open licences.** Free, real, and often the strongest material: the creator of the
original P(doom) video built a whole piece on about forty public-domain images and films, treated in code.
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
- When a piece would clearly gain from something code draws poorly and the director hasn't opened the
  toolbox, mention generated images once, in a line with what you'd make and the cost, and keep building in
  code. When they ask for images or open the toolbox ("use any keys you have", "generate what you need"),
  use it within their budget. Otherwise draw in code.
- **With an OpenAI key** (`OPENAI_API_KEY`), in either tool: `uv run <skill>/scripts/imagegen.py generate
  <name> --video <video> --prompt "..."` (GPT Image 2.5). Without a key it spends nothing and prints the
  cost and the free paths; without `--yes` it prints what it would make and what that costs; with it, the
  image lands in `videos/<video>/assets/` beside its `.request.json`. An unchanged request makes no call,
  and renders never call it. About $0.04 for a high-quality 1536×1024 image and $0.10 at 3840×2160 (an
  estimate; the script records the real cost). `--help` has the rest: `--style`, `--ref`, `--transparent`,
  `--takes`, `pick`.
- **In Codex without a key**, its built-in image generation ("$imagegen", gpt-image-2) draws on the
  ChatGPT plan's limits: that is spending too, so the same rules apply. It picks size and quality itself
  (no 4K, no exact aspect): good for style frames, textures and plates you'll scale. Copy each file into
  `assets/` and write its record (below).
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
comp.draw(renderer, this.cutout, out, { rect: [cx - camX * 1.9, cy, cw, ch], tint: lit });  // in front, fastest
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

- **Cut-outs:** straight alpha with the colour bled into the transparent pixels; black under alpha 0 gives a
  dark rim when the image is shown small. Resize colour and alpha separately (Pillow premultiplies RGBA and
  loses the bleed). Leave `premultiplyAlpha` off on an sRGB texture: it darkens soft edges.
- **Sharpness:** mipmaps soften a plate shown just under its size by about a sixth; keep them and sample with
  a bias of -0.5, or turn them off when nothing samples it blurred. A halftone or any cell-snapped lookup
  uses `textureLod`: `texture()` picks the wrong mip at every cell edge.
- **Memory:** width × height × 4 bytes plus a third for mipmaps (22 MB for a 2560×1440 plate); footage
  frames are the costly kind (`references/contract.md`).
- **A picture that must match its file** (a logo, a product shot): the entry's post `{ bloom: 0 }`, and the
  scene undoes the tone shoulder before it writes (it mirrors `SHOULDER_GLSL` in `src/engine/post.ts`; with
  the cap at 0.998, greys land within 0.2 levels of the file):
  `vec3 unshoulder(vec3 y) { const float k = 0.72; vec3 yc = min(y, vec3(0.998)); return mix(y, k - (1.0 - k) * log(1.0 - (yc - k) / (1.0 - k)), step(k, y)); }`

## One look across many images

- One style block for every prompt, kept in the video's folder and passed with `--style`; one master
  frame passed with `--ref` to the images that follow it; the model snapshot pinned (the script does).
- A subject and its background as separate images (a clean plate, a cut-out with `--transparent`), so a
  move never opens a hole behind the subject.
- The same treatment in code over every source (one grade, one grain, one halftone screen) makes forty
  images from forty places read as one piece.

## Size and 4K

Sizes in `video.json` are logical; `--scale 2` renders 4K, so a plate needs at least twice the logical
width it's shown at (a 2560-wide plate shown 2100 px wide looked soft at 4K; the 3840 one held), plus room for
what the camera does: a 10% push at 3840 wide needs about 4220 px. OpenAI's largest is 3840×2160 (above
2560×1440 counts as experimental), so for a move at 4K, keep the camera still and move layers, upscale, or
use a provider that goes bigger. A soft background behind sharp code-drawn type survives a 1.5× upscale.

## The record

Every file in `videos/<video>/assets/` that didn't come from code has a row in `assets/SOURCES.md`:

| File | Source | Creator, date | Licence or basis | Credit line | Treatment | Used |
|---|---|---|---|---|---|---|
| `fox-plate.png` | generated: `fox-plate.request.json` | GPT Image 2.5, 2026-10-04 | owned by the user (OpenAI terms) | none | halftone, parallax layer | 0:00-0:08 |
| `derby-1896/` | <landing page URL> | <photographer>, 1896 | public domain (US, published 1896) | "<as the source asks>" | dithered, cropped | 0:12-0:15 |

The end card or the video's description carries the credits the licences require.

## Checking

Look at every image before it goes in (the script prints "not looked at yet"), and judge it in motion in the
composite, not alone: stills at the moments it moves, a draft clip, and the critic's full-cut round.
