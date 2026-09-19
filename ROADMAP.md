# Avatar Kit roadmap

A common library for several games (TypeScript, Babylon.js, WebGPU) that renders human avatars with a lot of
user-controllable flexibility. Avatar quality is good enough for now; this is what comes next. (2026-09-18)

## Targets

- **Engine:** WebGPU in every game, with WebGL2 as the fallback. Features are switched on by capability, not by engine type.
- **Avatars on screen:** usually 1, at most 5–10.
- **Weakest device:** a recent iPhone (Safari WebGPU). The constraints there are memory, heat and download size, so "low"
  is a mid-range tier rather than a bare-minimum one.

## In order

1. ~~**WebGPU support.**~~ Done 2026-09-18. `src/render/engine.ts` `createEngine`: WebGPU with the device's own limits,
   WebGL2 fallback; `?engine=webgl` and `?gpulimits=default` to test. SSS gated on the pre-pass, not the engine.
   SSAO shares the pre-pass (34 bytes/pixel), so devices held to WebGPU's 32-byte minimum go without it.
   `mountDesigner` and `createStage` are now async. Pixel capture under WebGPU reads BGRA, top-down.
2. ~~**Clothing recolouring.**~~ Done 2026-09-18. `garmentImage` in tools/mkmhassets.mjs: statistics over the texels the
   mesh uses (a UV coverage mask); the median is the garment's `baseColor`; not tintable when over 15% differs in hue
   or over 20% differs strongly in brightness. Tintable textures become neutral detail (half the linear ratio to the
   median); the runtime multiplies by twice the chosen colour or the garment's own. 140 of 213 recolourable; 129
   ship normal maps. Designer: own colour first, patterned garments say "worn as made".
   **Later:** two recolourable regions for two-tone garments (the suit's shirt tints with the jacket).
3. ~~**Quality tiers (low / medium / high).**~~ Done 2026-09-18. `Quality = 'low' | 'medium' | 'high'`;
   `suggestQuality(engine)` (phones and minimum-limit GPUs: medium; else high; `?q=` overrides; low is a game's
   choice for crowds).
   - Binary proxies (`src/body/proxybin.ts`, 16-bit, per-file steps): 98 MB of JSON became 34 MB.
   - Garments simplified offline with meshoptimizer (edges collapse onto existing vertices, so fitting survives;
     borders locked) to ≤8k triangles for medium and ≤2k for low, stored in the same file.
   - Low draws MakeHuman's low-poly body (`male1591` / `female1605`, ~1.6k vertices), with bone weights, normals,
     occlusion and complexion blended through its fitting.
   - Low reads `.lo` textures (garments, hair, brows 512; lashes 256; skin 1024).
   - Lighting: high = studio HDRI + SSS + SSAO; medium = HDRI + SSS; low = procedural sky (half-float: WebGPU can't
     filter 32-bit float), no SSS, lighter shadows.
   - Per avatar (default outfit): about 4.5 MB at high/medium, plus the 1.5 MB HDRI per page; 1.4 MB at low.
     Triangles 32k / 32k / 13k.
   **Later:** KTX2 textures; medium could take 1024 skin maps if phones need the memory.
4. ~~**Facial expressions.**~~ Done 2026-09-18.
   - Data: MakeHuman's expression unit targets (per ancestry, CC0), 19 of its 34 units packed by
     tools/mkmhtargets.mjs (564 KB for all), blended by the ancestry macros.
   - Played as morph targets on the body (the low body too, through its fitting), brows and lashes.
   - API: `avatar.setExpression('smile' | 'happy' | 'sad' | 'surprised' | 'angry' | 'effort' | 'panting' | 'wink' |
     'kiss' | 'neutral', strength)`, or unit weights directly; automatic blinking (`avatar.blinking`).
   - Designer: expression buttons on the stage.
   - WebGPU fix found here: Babylon rebuilds the SSS pass when morph targets switch on and then fetches its shader by
     URL (a dev server answers with HTML), blanking the scene on the first blink. The SSS and SSAO shaders are now
     imported up front.
   **Later:** teeth and tongue (MakeHuman proxies) so open mouths aren't an empty cavity; per-unit normals.
5. **Motion clips: started 2026-09-18 with Quaternius' Universal Animation Library (Standard, CC0).**
   - `tools/mkclips.mjs` samples the 45 clips (from the pack's glTF) at 30 fps. Each bone stores its world rotation
     relative to the source rest pose, plus the hips' movement, all written to public/mh/anim/ual.json (1.2 MB).
   - `src/anim/clips.ts` retargets onto our 21-bone rig for any body. Each bone's rest direction is turned onto the
     source's (their T-pose, our A-pose), and the hips' movement is scaled by hip height.
   - Rigify's fingers and middle spine segment are dropped.
   - API: `animator.useClips(await loadClips())`, then `animator.play('Dance_Loop')`. It fades over the procedural
     motion; one-shot clips fade out when they end.
   - Quaternius' motion is stylised, not realistic. Cycling stays procedural (it follows the crank).
   **Decided (user, 2026-09-18):** procedural locomotion; clips for everything else.
   - Walk tuned: stance knee 9–12° (was 26–30°: the rest pose's splayed feet held the hips below reach); elbows
     24–40° (were 17–23°); arms closer to the body. `node tools/gait.ts [speed]` prints the numbers per stride.
   - Walk smoothed (user: clunky, jerky, a stop mid-cycle, feet flat):
     - The hips ride a smooth wave fitted under the legs' reach, not the reach limit itself, which dropped and
       stopped at every footfall.
     - Swing feet are eased over the ground, so they leave and land at ground speed.
     - The swing lift and landing are eased; toes no longer snap at push-off; the arm terms no longer kink.
     - Heel-first landing is clearer (about 20°); push-off heel lift is 36° (was 57°).
     - `tools/jerk.ts` finds angular-acceleration spikes per bone; `tools/footdebug.ts` shows foot contact.
     - Knee bounce at footfall fixed: the hip wave's low point was about 5% after heel contact, so the landing knee
       folded to follow the hips down (15° dip at up to 450°/s). The low point is now at contact. Push-off is back
       to about 57° (the trailing heel's rise lets the leading leg land straighter). `tools/landing.ts` traces the
       knee frame by frame around a footfall.
     - Torso no longer rigid (user: forced, mechanical): the chest counter-rotates about 7° each way against the
       hips, tilts slightly against their drop, and each shoulder rolls forward about 5° with its arm.
     - Run (in progress): the hips now follow the physics of a run. They fall in a parabola during flight and sink as
       a half sine through the stance, sized so the speed at lift-off matches the flight. The whole curve is lowered
       to fit under the legs' reach, as the walk's is. There is no longer a 5 cm drop at each landing, and the peak
       vertical acceleration is about g.
       - Foot lands about 0.23 m ahead; toe-off is steeper (66°), so the trailing leg extends.
       - Arms swing about 30° each way and bend to about 110° coming forward.
       - Still open: the knee snaps at lift-off, as it did before these changes. Easing the swing in the ground frame
         or peeling the foot up gently cured the snap but dropped the hips 3–6 cm.
   **Was next:** decide whether walk/run use the clips (speed-matched Walk / Jog / Sprint) or stay procedural. Hands would
   need finger bones to use the clips' finger motion. The Pro pack (paid) has 120+ clips.

Design choices before step 5 should survive that skeleton change: morph targets and fitted proxies do; face bones and
hand-tuned weights don't.

## Also done (2026-09-18)

- **Skin micro-detail:** a procedural pore and fine-line detail map tiled over the skin (Babylon's PBR detail map),
  following the Texture slider. The photographs' own relief is eased back.
- **Teeth and tongue:** MakeHuman's, worn by every avatar, moving with the expressions.
- **Hats hide the hair under them.** Coverage is by direction from the head's centre (hair and hats share no base
  vertices), sampled across the hat's triangles. Covered hair triangles are dropped; hair below the brim stays.
- **Glasses:** alpha-blended, glossy lenses.
- **Age unpinned:** 25 to 90, from MakeHuman's young and old macro targets. Children are left out on purpose.
- **Relaxed hands:** MakeHuman's hands rest flat with the fingers spread. The body build now curls each finger
  toward the palm lightly (a little more from the index to the little finger, the thumb less) and closes the fingers together, side by side. It uses
  the fingers' own MakeHuman weights (tools/mkmh.mjs now exports them), so there are no extra bones at runtime.
- **Hand poses:** relaxed (the rest shape), open, fist and point, as morph targets baked from the fingers' own
  weights (gloves follow). `avatar.setHands(pose, strength)` eases in; cycling grips the bars automatically. The
  thumb aims at a joint of the curled fingers (beside the index when relaxed, across the middle finger in a fist).
  Both hands are built from joints read before either moves (the left hand had been posed around the right's moved
  joints).
- **Moves in the designer:** a Moves tray (Everyday, Sport, Action: 18 of Quaternius' clips with friendly names,
  icons, hand poses; props, seats and aiming holds left out). One-shots repeat after a pause; travelling moves run
  the treadmill. `animator.play([...])` plays a list in order. The designer also got a labelled pose dock (face and
  hands), compact tabs that fit narrow panels, per-tab accents, presets as pills at the top of Body, a phone layout
  for the top bar and tray, and the Share tab's duplicated code card removed.
- **Clip retargeting fix (user: chest too far forward):** only arm and leg bones are turned from our rest direction
  onto the source's. The trunk, neck, head and shoulders were too, but there the skeletons differ only in how the
  bones are drawn (Rigify's pelvis bone leans 40° from ours, its shoulder runs back from the sternum), so every clip
  tipped the pelvis and pushed the chest forward.
- **Moves trimmed (user: arms splayed in jog and sprint):** Quaternius' Jog and Sprint hold the upper arm 30–56° and
  31–83° out from the side (Idle about 20°), for its chunky character. Jog, Sprint and Stroll are out of MOVES:
  walking and running stay procedural, as decided.
- **WebGPU startup fix:** the SSAO pass sometimes drew its first frame before Babylon gave it a camera, skipped
  binding its noise texture, and WebGPU threw ("randomSampler not found"). It gets the camera when created.
- **Docs:** README and INTEGRATION rewritten for the MakeHuman pipeline, WebGPU, quality tiers and expressions.

## Still open

- Motion capture (on hold for a CC0 source; see 5).
- Two recolourable regions for two-tone garments.
- KTX2 textures.
