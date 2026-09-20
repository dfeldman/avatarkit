# The avatar assets

Everything the designer draws comes from files under `public/`, which is **not in git** (303 MB). This file says
what is in there, where each piece came from, and how to build it again.

```bash
make avatar-assets                               # from the repo root; copies from ~/avatarkit/public
make avatar-assets AVATAR_ASSETS=/path/to/public # or from a copy anywhere else
```

The server serves this folder at `/avatars/` (`servers/api-flask/dandyhorse/static.py`), so the console's designer
reads `/avatars/mh/…` and `/avatars/env/…`. Nothing else in Dandyhorse needs it: without the assets every other
page still runs, the kit's tests skip, and only the designer comes up empty.

## What is there

| Path | Size | What |
|---|---|---|
| `public/mh/targets/` | 30 MB | 969 MakeHuman morph targets (the macros and about 280 face and body modifiers), one `.bin` each, fetched on demand |
| `public/mh/modifiers.json` | 112 KB | every modifier as MakeHuman defines it, the macro variables, and MakeHuman's slider layout for the designer |
| `public/mh/proxy/` | 35 MB | 243 fitted meshes: garments, hair, brows, lashes, teeth, tongue, and MakeHuman's two low-poly bodies. Binary (`src/body/proxybin.ts`), each with its simplified triangle lists for medium and low quality |
| `public/mh/tex/` | 234 MB | textures for those: garments 145 MB, skins 75 MB, hair 11 MB, the rest small. Each has a `.lo` copy for low quality. The skins' `*_normal.jpg` are left over from an older build and unused: see below |
| `public/mh/thumb/` | 1.1 MB | the designer's tiles |
| `public/mh/index.json` | 136 KB | every asset with its tags, author, licence and pack, plus each garment's own colour and whether it recolours |
| `public/mh/anim/ual.json` | 1.2 MB | 46 motion clips, retargeted onto our 21-bone rig |
| `public/env/` | 1.4 MB | the studio lighting HDRI |

One asset does live in git, because the code imports it at build time: **`src/body/mhbase.json`** (2.1 MB) — the
base mesh, its skin weights collapsed onto our 21 bones, the joint vertex sets, the fingers' joints and weights, the
high-poly eye proxy, and baked ambient occlusion.

By kind, `index.json` holds 213 garments, 30 skins, 12 eyebrows, 10 hairstyles, 9 eye materials, 4 eyelashes, teeth,
a tongue and 2 low-poly bodies, from 33 MakeHuman packs. 128 of them are CC-BY and are credited in
[CREDITS.md](CREDITS.md); everything else is CC0.

## Where it comes from

- **MakeHuman** (<http://www.makehumancommunity.org>, source at
  <https://github.com/makehumancommunity/makehuman>): the base mesh, skeleton, skin weights, targets, modifier
  definitions, eyes, teeth, tongue, low-poly bodies and the system skins. Released as CC0 in September 2020. The
  pipeline reads MakeHuman's own `data/` directory.
- **MakeHuman community asset packs** (the Assets section of the community site, downloaded and unpacked): the
  garments, hair, eyebrows, eyelashes and community skins. A mix of CC0 and CC-BY; the licence travels with each
  asset into `index.json` and CREDITS.md.
- **Quaternius' Universal Animation Library** (Standard pack, glTF, CC0, <https://quaternius.com>): the motion
  clips.
- **Poly Haven's "Studio Small 08"** (CC0, <https://polyhaven.com/a/studio_small_08>): the lighting HDRI, used at
  1k. Saved as `public/env/studio_small_08_1k.hdr`.

## Building them again

The tools are in `tools/` and each is run once, from this folder, in this order. They need MakeHuman's data and the
unpacked asset packs, which are **not** in this repo: download them from the sources above first.

```bash
# 1. the base mesh, weights, joints, fingers and eyes -> src/body/mhbase.json
node tools/mkmh.mjs <dir with base.obj, default.mhskel, default_weights.mhw, eye-high-poly.obj/.mhclo>

# 2. baked ambient occlusion, added to the same file (reads and rewrites src/body/mhbase.json)
node tools/mkmhao.mjs

# 3. targets and modifier definitions -> public/mh/targets/, modifiers.json
node tools/mkmhtargets.mjs <makehuman/data dir>

# 4. garments, hair, brows, lashes, skins: proxies, textures, thumbnails, index.json, CREDITS.md
node tools/mkmhassets.mjs <pack dir>[=<pack name>] ...

# 5. the motion clips -> public/mh/anim/ual.json
node tools/mkclips.mjs <AnimationLibrary_Godot_Standard.glb>
```

Order matters: `mkmhao.mjs` adds to what `mkmh.mjs` wrote, and `mkmhassets.mjs` fits every proxy to that base mesh.

What ships is curated by two files, which are in git:

- **`tools/wardrobe.tsv`** — the garments, their designer slot, display name and order. The designer lists each slot
  in this order, exercise wear first. A garment missing from this file is not shipped.
- **`tools/skins.tsv`** — the community skins (natural skin only, no makeup or fantasy). MakeHuman's six `young_*`
  system skins always ship.

The skins no longer get a normal map. It was derived from the photograph's brightness, which cannot tell a pore
from a freckle, so freckles and moles became pits; the skin's fine grain comes from the tiled micro-detail map
instead (`public/mh/tex/skin/detail.png`, made by the same tool). A folder synced before 2026-09-19 still holds
`*_normal.jpg` files for skins; nothing reads them, and a rebuild won't write them.

Two decisions worth knowing before rebuilding: the macro targets are kept for adults only (25 to 90; children and
babies would add more than 100 MB), and textures are capped at 1024 px (512 for brows and lashes) with a `.lo` copy
beside each one.
