# Blender

Blender for the few 3D shots three.js can't model or light well enough, run headless from a script: never
through a GUI, an MCP server or screen control (they need a window and a person watching, and fail unattended).
Read it when a shot needs one of the things below and Blender is installed, or the director asks for it.
Checked 2026-10 with Blender 5.2.2 LTS on Windows 11; other versions move the Python API.

## When it earns its place

- Path-traced light (soft bounce light, glass, caustics, a clay or diorama look), cloth, fluid and rigid-body
  simulations, geometry nodes, a modelled hero object (a product, a logo with real bevels, a character).
- Not for a camera move: smooth 3D camera rides are what a model reaches for when asked for fluid motion,
  and three.js does them already. A shot that only needs bevelled type or simple solids stays in three.js
  (`MeshPhysicalMaterial`, a PMREM environment: `references/contract.md`, "three.js in this engine").
- Without Blender, make the shot in three.js and say in a line what Blender would have added.

## Running it

Find it in `BLENDER_BIN`, on the PATH, then the standard install folder. Install it in a short folder on
Windows: from a deep one (past 260 characters) its glTF exporter fails to import and every start prints a
traceback. Without an install, `uv run --no-project --python 3.13 --with bpy==5.2.2 python script.py`
runs the same script (a 645 MB package; its EEVEE renders on the integrated GPU, so use it for export, not
for frames).

```
blender -b --factory-startup --python-exit-code 1 -P scene.py -- <args>
```

- `--python-exit-code 1` makes a failing script fail the command (it exits 0 otherwise); judge by the files
  it wrote, not by stderr, where add-on tracebacks appear on clean runs.
- Print `bpy.app.version` first: 5.x changed actions (no `.fcurves`; layers and channelbags), deprecates
  `use_nodes`, and defaults to the AgX view transform and a 0.5 shutter.
- It writes caches under `%APPDATA%\Blender Foundation` even with `--factory-startup`;
  `BLENDER_USER_RESOURCES=<folder>` keeps them in the project's `.audara-cache/`.
- Under Codex the sandbox may stop Blender from starting: ask to run it outside.

## First choice: a GLB the engine animates

The scene stays live in the preview, the engine's motion blur, bloom and 4K apply, and timing stays in code.
Export took about a second for a bevelled six-letter word (440 kB):

```python
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True, export_animations=True,
    export_animation_mode="SCENE", export_anim_scene_split_object=False,  # one clip, not one per object
    export_force_sampling=True, export_frame_range=True, export_yup=True, export_cameras=False, export_lights=False)
```

- Frame 0 is t = 0 of the clip (keys at frame/fps). Hide an object by scaling all three axes to 0: one axis
  at 0, or 0.01, leaves a face or a speck that the bloom finds.
- Lights, camera and framing are three.js's: load in `init()` (`GLTFLoader`, an environment from
  `PMREMGenerator` + `RoomEnvironment`), and pose the clip from `t`, clamped, since a play-once clip set with
  `mixer.setTime` jumps back to its start once it has ended:

```ts
this.action = this.mixer.clipAction(gltf.animations[0]!); this.action.play();
private pose(ct: number) { const a = this.action, d = a.getClip().duration;
  a.enabled = true; a.paused = false; a.time = clamp(ct, 0, d); this.mixer.update(0); }  // render(): this.pose(f.t - start)
```

- Procedural materials and geometry nodes don't survive export: bake them (textures, applied modifiers);
  a baked Cycles lightmap or AO keeps Blender's light on geometry the engine still moves.

## Second choice: rendered frames

For what only Blender's renderer makes (Cycles light, volumes, a simulation too heavy to export). The
camera and the look are baked in, and every change costs a re-render (EEVEE on a laptop RTX: about 0.3 s a
frame at 1600×600; Cycles about 2.5 s).

- RGBA PNGs at the video's fps, `film_transparent`, the Standard view transform (AgX would be tone-mapped
  twice), Blender's motion blur on with a 0.2 shutter centred on the frame, so the layer blurs like the rest.
- Played through the footage path (`references/contract.md`, "Images and footage"): frames picked by
  `frameTime(t)`, drawn at 1:1. Crop to the object: each frame costs width × height × 4 bytes of GPU memory
  (60 frames at 1600×600: 230 MB; full-frame 1080p: about 500 MB a second). 4K means rendering at 2×.
- 8-bit frames lose HDR: glow added in the engine, or baked into the frames.
- `blender.exe`, not the bpy module, so EEVEE renders on the discrete GPU.
- Record the script, the Blender version and the command in `assets/SOURCES.md`, like any asset.
