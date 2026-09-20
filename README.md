# Avatar Kit

Human avatars for Dandyhorse games. A player designs one look, and every game shows the same person walking,
running or riding a bike. The bodies, faces, clothes, hair and skins come from [MakeHuman](http://www.makehumancommunity.org)
(CC0, with some community assets CC-BY; see [CREDITS.md](CREDITS.md)), rendered with Babylon.js on WebGPU, with WebGL2
as the fallback.

- **Bodies:** MakeHuman's macros (gender, age 25–90, muscle, weight, height, proportions, breast size and firmness,
  and a blend of African, Asian and Caucasian features), plus about 280 of its detail modifiers for the face and body.
  Every slider is continuous.
- **Skin:** any colour, over real skin photographs (MakeHuman's own, or one of 24 natural community skins: freckled,
  older, bronzed, stubble and more). The shading has subsurface scattering, fine pore detail, and per-avatar
  redness, evenness, beard shadow, texture and shine.
- **Faces:** expressions (smile, happy, sad, surprised, angry, effort, panting, wink, kiss, or MakeHuman's units
  mixed directly), automatic blinking, and teeth and a tongue.
- **Clothes:** 213 curated garments across tops, bottoms, outfits, shoes, socks and accessories, fitted to any body.
  Exercise wear comes first. Most can be recoloured; patterned ones are worn as made. Layers sit over one another
  without poking through, hats hide the hair under them, and glasses have see-through lenses.
- **Hair:** MakeHuman's styles, eyebrows and eyelashes, in any colour.
- **Motion:** walking, running (the two blend with speed) and cycling on a bike fitted to the rider. The feet
  plant without sliding.
- **Quality:** low, medium and high, for crowds, phones and desktops.
- **Designer:** an editor in the Dandyhorse console style that works on a phone. It can run as its own page or be
  embedded in another.

Babylon.js 9.26 and TypeScript, with no other runtime dependencies. [INTEGRATION.md](INTEGRATION.md) is the plan for
using it on the platform; [ROADMAP.md](ROADMAP.md) is what's done and what's next.

## Assets (read this first)

Everything under `public/` is **not in git**: `mh/` (MakeHuman bodies and targets 65 MB, textures 234 MB) and
`env/` (the studio lighting HDRI, 1.5 MB). From the repo root:

```bash
make avatar-assets                               # copies from ~/avatarkit/public by default
make avatar-assets AVATAR_ASSETS=/path/to/public # or from anywhere else
```

[ASSETS.md](ASSETS.md) says what every file is, where it came from (MakeHuman, its community packs, Quaternius,
Poly Haven) and how to build it again with the tools in `tools/`. Nothing else here needs them: the console, bridge,
games and server all run without them, and only the designer comes up empty.

## In the console

The Dandyhorse console embeds the designer under **Preferences → Design your avatar**
(`consoles/web/src/views/Avatar.vue`, the route `#/avatar`). It loads on demand, so Babylon and the assets stay out
of the console's main bundle. The server serves this folder's `public/` at `/avatars/`, so the page calls
`setAssetBase('/avatars/mh/')` and `setStudioHdri('/avatars/env/…')`. A host page that serves the kit's assets
elsewhere does the same two calls.

Save stores the avatar on the player's profile (`users.profile.avatar`, through `PUT /api/me`), so it follows the
account to any device; `consoles/web/src/avatar.ts` does the reading and merging. An avatar left in a browser by the
earlier version (`localStorage`, key `dh.avatar`) is picked up once and then cleared.

## Run

```bash
npm install
npm run dev        # http://localhost:5194 (designer), /gallery.html, /dev.html, /embed.html — or `make dev-avatar`
npm test           # spec and codes, MakeHuman meshes, fitting and layering, gait and cycling, Babylon integration
npm run build      # static site in dist/ (npm run preview serves it on :5195)
npm run bench      # geometry build times and sizes
```

| Page | What it is | URL options |
|---|---|---|
| `/` | the designer | `?theme=light\|dark` `?q=` |
| `/gallery.html` | a park with a running track, walkers, runners and cyclists (the saved avatar is the first) | `?count=12` `?q=low\|medium\|high` `?seed=7` |
| `/dev.html` | test bench | `?preset=runner` `?seed=5` `?mode=idle\|walk\|run\|cycle` `?speed=1.4` `?cadence=80` `?q=` `?lineup=presets\|random\|hair\|clothes…` `?grid=5` |
| `/embed.html` | how a host page embeds the designer | `?fail=1` (saving fails) |

Every page also takes `?engine=webgl` (WebGL2 instead of WebGPU) and `?gpulimits=default` (WebGPU's minimum limits, as
on the weakest devices), to test the fallbacks.

Debug handles (the in-app browser pane draws at about 1 fps, so tests drive things explicitly):

| Handle | Contents |
|---|---|
| `__dev` | `hold(on)`, `step(dt, n)`, `view(alpha, beta, radius, y, x)`, `face(i, alpha, radius, beta)`, `motion(mode, speed, cadence)`, `spec(s, i)`, `capture()`, `riders` |
| `__gallery` | `hold`, `step`, `follow(i, radius)`, `movers` |
| `__designer` | the `Designer` instance (`preview.capture()` for a frame) |
| `__embed` | `designer`, `profile` |

## Using it in a game

```ts
import { Avatar, GeometryService, preloadAssets, setAssetBase, suggestQuality } from '@dandyhorse/avatarkit'

setAssetBase('https://…/mh/')                            // where public/mh/ is served
const quality = suggestQuality(engine)                   // or 'low' for a crowd
const geometry = new GeometryService()                   // builds bodies in a web worker
const g = await geometry.request(profile.avatar, quality)
const avatar = new Avatar(scene, profile.avatar, { geometry: g, quality, shadows })
avatar.root.position.copyFrom(where)                     // feet at the root, facing +Z
avatar.setMotion({ mode: 'run', speed: 3.1 })            // or { mode: 'cycle', cadence: 85, speed: 8 }
avatar.setExpression('effort', rider.effort)             // the face follows the work
scene.onBeforeRenderObservable.add(() => avatar.update(engine.getDeltaTime() / 1000))
```

- **The spec:** `Avatar` takes any JSON. Missing or invalid fields fall back to defaults (`normalizeSpec` never
  throws), so a profile from an older client is always safe to use.
- **Assets:** MakeHuman's targets, garments, hair and textures load on demand from the asset base. Without a worker,
  `await Avatar.create(scene, spec, opts)` loads what the spec needs and builds on the main thread; with
  `new Avatar(scene, spec)` directly, `await preloadAssets(spec, quality)` first.
- **Quality:** `low` draws MakeHuman's low-poly body, simplified garments and smaller textures, without subsurface
  scattering, for crowds of 5–10 on a phone. `medium` is the full body and skin with lighter garments. `high` is
  everything. `suggestQuality(engine)` picks medium on phones and high on desktops. `avatar.setQuality(q)` switches
  (preload first for low).
- **Motion:** `Motion` is `{ mode, speed (m/s), cadence (rpm), crank (rad or null), effort (0–1), grade }`.
  - `walk` switches to a run above about 2.6 m/s; `run` jogs even when slow.
  - `effort` changes posture and breathing; `grade` tilts the feet and body for hills.
  - Set `crank` to drive the pedals from a real crank angle instead of the cadence.
- **Faces:** `avatar.setExpression(name, strength)` or `avatar.setExpression({ 'mouth-open': 0.4, … })` (the units
  are `EXPRESSION_UNITS`). It holds until changed. `avatar.blinking = false` stops the automatic blinks.
- **Hands:** `avatar.setHands('relaxed' | 'open' | 'fist' | 'point', strength)`. The hands ease into the pose over a
  fifth of a second. The body is built with relaxed hands (fingers lightly curled and together); the other poses are
  morph targets, so switching costs nothing. While cycling, relaxed hands close around the bars on their own.
- **Moves (motion clips):** `avatar.animator.useClips(await loadClips())`, then `avatar.animator.play('Dance_Loop')`
  or a list played in order (`play(['Jump_Start', 'Jump_Land'])`). A clip fades in over the procedural motion; loops
  run until `play(null)`, one-shots fade out when they end. `MOVES` is the curated set the designer offers (friendly
  names, icons, the hand pose each wants, and the ground speed for the ones that travel).
- **Bikes:** `new Bike(scene, avatar.animator.fit, { color, accent })` builds a bike whose saddle, bars and pedals sit
  where this rider's body goes. Parent `bike.root` to `avatar.root`, and call
  `bike.update(avatar.animator.crank, metresTravelled)` each frame. A game with its own bike model can read
  `avatar.animator.fit` (bottom bracket, crank length, saddle, grips, wheel size) and scale its model to match.
- **Attaching things:** `avatar.nodes.get('hand.R')` and the other bone names (see `BONES`) are TransformNodes you
  can parent props to. `avatar.bonePosition(name)` returns a bone's world position.
- **Changing the look:** `avatar.setLook(spec)` applies colours, skin settings and eyes without a rebuild.
  `avatar.setSpec(spec, geometry?)` also rebuilds when the shape changed (macros, modifiers, hair, clothes);
  `shapeKey(spec)` tells you whether it will.
- **Lighting:** `lightStage(scene, camera, quality)` is the stage our pages use (a studio HDRI, key, fill and rim
  lights, SSAO at high). Games bring their own lights; the materials are physically based.
- **Lifetime:** `avatar.dispose()` removes everything the avatar created.
- **Credits:** `credits()` lists the CC-BY assets (name, author, licence) for a game's credits screen.

Sharing a look: `encodeSpec(spec)` gives a short code (`AV2-…`), and `decodeSpec(code)` reads it back (`null` if
the code is invalid).

## The designer

```ts
import { mountDesigner } from '@dandyhorse/avatarkit/designer'

const designer = await mountDesigner(element, { initial: profile.avatar, onSave: async (spec) => { /* store it */ } })
// later
designer.dispose()
```

- **Isolation:** it renders into a shadow root on `element`, so its styles and the host page's can't affect each
  other. Set `element.dataset.theme = 'light'` or `'dark'` to force a theme; otherwise it follows the system.
- **Tabs:** Body (macros, age, ancestry, skin colour, skin settings and skin photographs), Face and Shape
  (MakeHuman's modifiers as it groups them), Hair & eyes, Clothes (by slot, with colours), and Share (the code and
  the credits).
- **Preview:** stand, walk, run or cycle with a speed slider, or pick one of the moves (dance, jab, jump, …) from
  the Moves tray; close-up and full-body views; a turntable; and a pose dock with the face's expressions (which turn
  the camera to the face) and the hands' poses. One-shot moves repeat after a pause while chosen.
- **Editing:** undo/redo (Ctrl/Cmd+Z, and Shift for redo) and a dice button for a random look.
- **Layout:** two columns on wide screens, stacked on phones.
- **Saving:** it stores nothing itself. `onSave` does the storing and can throw; the error message is shown to the
  player.

## How it works

```
spec ──► MakeHuman base mesh + targets (macros blended as MakeHuman does, modifiers)   [in a worker]
     ──► rest pose for our rig (elbows and knees straightened), 21 bones from MakeHuman's skeleton and weights
     ──► proxies fitted to it (MakeHuman's fitting): hair, brows, lashes, teeth, tongue, clothes
         ──► layered inside out by slot; hair under hats dropped; simplified lists for lower qualities
     ──► the body (or the low-poly body), less what the clothes hide; occlusion and complexion per vertex
     ──► facial expression units as morph targets
     ──► Babylon meshes + skeleton + PBR materials (skin with subsurface scattering and micro-detail)
Motion ─► Animator: idle / gait / cycle poses (analytic IK), blended ─► bone rotations
```

- **`src/spec.ts`:** the spec (v2), its defaults and palettes, `normalizeSpec`, `shapeKey`, and avatar codes.
  `src/presets.ts` has the named starting points and `randomSpec(seed)`.
- **`src/body/`:** pure TypeScript with no Babylon, safe in a worker.
  - `mhmodifiers.ts`: macros and modifiers to target weights; expression units.
  - `mhbody.ts`: the build: targets, rig, fitting, layering, hats, the low-poly body, expressions.
  - `mhassets.ts`, `proxybin.ts`, `mhproxy.ts`: the asset index, on-demand loading, the binary proxy format.
  - `rig.ts`: bones and measurements; `build.ts`: quality and the geometry handed to the renderer.
- **`src/anim/`:** `poser.ts` (idle, the gait and cycling), `ik.ts`, `pose.ts`, `animator.ts`, `expressions.ts`.
- **`src/render/`:** `avatar.ts` (the Babylon side), `materials.ts` (the skin), `lighting.ts`, `engine.ts`
  (WebGPU/WebGL2, `suggestQuality`), `capture.ts`, `bike.ts`, and `geometryService.ts` / `geometry.worker.ts`.
- **`src/designer/`:** the editor. `src/gallery/`, `src/dev/` and `src/embed/` are the demo pages.
- **`tools/`:** the asset pipeline, run once from MakeHuman's data and asset packs into `public/mh/`:
  - `mkmh.mjs`: the base mesh, weights, joints and eyes.
  - `mkmhtargets.mjs`: targets and modifiers.
  - `mkmhassets.mjs`: garments, hair, skins and textures. `wardrobe.tsv` and `skins.tsv` choose what ships.
  - `mkmhao.mjs`: baked occlusion.

Some details that matter:

- **The gait plans every foot.** Heel strike, a flat foot, then heel-off and toe-off rocking over the ball, with the
  planted point fixed on the ground. Running strides scale with leg length. Tests check planted points don't slip,
  soles meet the floor and knees bend forward, across body extremes and speeds.
- **Cycling fits a bike to each rider:** the saddle leaves about 40° of knee bend at the bottom of the stroke, and the
  bars go where the leaning shoulders reach.
- **WebGPU:** features are switched on by what the device supports. The skin's pre-pass needs 34 bytes a pixel with
  SSAO, so devices held to WebGPU's 32-byte minimum go without SSAO. Never call `scene.render()` outside the engine's
  frame under WebGPU (use `capture.ts` to read frames).
- **Skinned bounds are fixed.** Babylon doesn't move a skinned mesh's bounding box, so each avatar gets one large
  enough for any pose, and is never culled.

## Known limits and next steps

- **Motion capture:** walking, running and cycling are procedural; everything else can use Quaternius' CC0 clips
  (stylised rather than realistic). A realistic CC0 mocap source is still wanted (see ROADMAP.md).
- **Two-tone garments** tint as one colour (a suit's shirt with its jacket).
- **Hands:** the fingers have no bones of their own: four poses (morph targets) blend on both hands at once, and
  the clips' finger motion is dropped.
- **Motion:** no turning or strafing. Games rotate `avatar.root`, and the feet slide a little in tight turns.
- **Classic-script games:** games that load Babylon from its CDN can't use the kit yet; see INTEGRATION.md.
