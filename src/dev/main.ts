/**
 * Dev page: avatars driven by URL params and window.__dev (the in-app browser pane draws at ~1 fps, so
 * poses are set explicitly for screenshots).
 *   ?preset=runner&mode=walk&speed=1.4&seed=3
 *   ?lineup=presets | ?lineup=random&seed=5&count=8
 *   ?lineup=macro.Weight (0 .. 1) | ?lineup=mod.nose/nose-scale-vert-decr|incr (-1 .. 1)
 *   ?lineup=hair | eyebrows | eyelashes | eyes | clothes&tag=shoes (every asset of that kind)
 */
import { Vector3 } from '@babylonjs/core'
import { PRESETS, randomSpec } from '../presets.ts'
import { Avatar } from '../render/avatar.ts'
import { Bike } from '../render/bike.ts'
import type { Quality } from '../body/build.ts'
import type { MotionMode } from '../anim/animator.ts'
import { preloadAssets } from '../body/build.ts'
import { loadIndex, setAssetBase } from '../body/mhassets.ts'
import { MACROS, normalizeSpec, type AvatarSpec, type Macro } from '../spec.ts'
import { createStage } from './scene.ts'
import { captureFrame } from '../render/capture.ts'
import { loadClips } from '../anim/clips.ts'

const params = new URLSearchParams(location.search)
// ?assets=mh-all loads another asset directory (e.g. a staging build of the packs)
if (params.get('assets')) setAssetBase(new URL(`${params.get('assets')}/`, document.baseURI).href)
const canvas = document.getElementById('c') as HTMLCanvasElement
const stage = await createStage(canvas)
const { engine, scene, camera, shadows } = stage
camera.inertia = 0
// (createStage lit the stage for this quality: suggestQuality in engine.ts, or ?q=)
const quality: Quality = stage.quality

const lineup = params.get('lineup')
const seed = params.get('seed')
let specs: AvatarSpec[]
const base = PRESETS.find((p) => p.id === params.get('preset'))?.spec ?? normalizeSpec({})
const steps = [0, 0.25, 0.5, 0.75, 1]
if (lineup === 'presets') specs = PRESETS.map((p) => p.spec)
else if (lineup === 'random') specs = Array.from({ length: Number(params.get('count') ?? 8) }, (_, i) => randomSpec(Number(seed ?? 1) * 100 + i))
else if (lineup?.startsWith('macro.') && (MACROS as readonly string[]).includes(lineup.slice(6))) {
  const k = lineup.slice(6) as Macro
  specs = steps.map((x) => normalizeSpec({ ...base, macros: { ...base.macros, [k]: x } }))
} else if (lineup?.startsWith('mod.')) {
  const k = lineup.slice(4)
  specs = steps.map((x) => normalizeSpec({ ...base, modifiers: { ...base.modifiers, [k]: x * 2 - 1 } }))
} else if (lineup === 'hair' || lineup === 'eyebrows' || lineup === 'eyelashes' || lineup === 'eyes' || lineup === 'clothes') {
  const tag = params.get('tag')
  const ids = (await loadIndex()).filter((a) => a.kind === lineup && (!tag || a.tags.includes(tag) || a.id.includes(tag))).map((a) => a.id)
  specs = ids.map((id) => normalizeSpec(
    lineup === 'hair' ? { ...base, hair: { ...base.hair, id } }
      : lineup === 'eyes' ? { ...base, eyes: id }
        : lineup === 'clothes' ? { ...base, clothes: [...base.clothes.filter((c) => /shoe|sneaker/.test(c.id)), { id }] }
          : { ...base, [lineup]: id },
  ))
} else {
  const preset = PRESETS.find((p) => p.id === params.get('preset'))
  specs = [seed !== null ? randomSpec(Number(seed)) : preset?.spec ?? normalizeSpec({})]
}

// MakeHuman assets load on demand; the avatars below are built synchronously from what's loaded
await Promise.all(specs.map((sp) => preloadAssets(sp, quality)))

interface Rider { avatar: Avatar; bike: Bike | null }
const riders: Rider[] = []
const gap = 0.75
const t0 = performance.now()
specs.forEach((spec, i) => {
  const avatar = new Avatar(scene, spec, { quality, shadows })
  if (params.has('grid')) {
    // class photo: rows of 5, each row further back and higher so every face shows
    const per = Number(params.get('grid') || 5)
    const row = Math.floor(i / per), col = i % per
    avatar.root.position.set((col - (per - 1) / 2) * 0.55, row * 0.42, -row * 0.9)
  } else avatar.root.position.x = (i - (specs.length - 1) / 2) * gap
  avatar.setMotion({ mode: (params.get('mode') as MotionMode) ?? 'idle', speed: Number(params.get('speed') ?? 1.3), cadence: Number(params.get('cadence') ?? 80) })
  avatar.animator.snap()
  riders.push({ avatar, bike: null })
})
console.log(`${specs.length} avatar(s) built in ${(performance.now() - t0).toFixed(0)} ms`)
if (specs.length > 1) {
  camera.target = new Vector3(0, 0.9, 0)
  camera.radius = Math.max(4.2, specs.length * 0.95)
}

function frame(dt: number): void {
  for (const r of riders) {
    r.avatar.update(dt)
    const c = r.avatar.animator.cycling
    if (c > 0 && !r.bike) {
      r.bike = new Bike(scene, r.avatar.animator.fit, { color: r.avatar.spec.clothes.find((c) => c.color)?.color ?? '#1f6bff' })
      r.bike.root.parent = r.avatar.root
      for (const m of r.bike.getMeshes()) shadows.addShadowCaster(m)
    }
    if (r.bike) {
      r.bike.setEnabled(c > 0.5)
      r.bike.update(r.avatar.animator.crank, dt * (r.avatar.animator.motion.cadence / 60) * 5.5)
    }
  }
}

let paused = false
let last = performance.now()
engine.runRenderLoop(() => {
  const now = performance.now()
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  if (!paused) frame(dt)
  scene.render()
})

/** Draw now, between the loop's frames (a hidden page's loop may be paused): inside a frame of its own, as WebGPU
 *  needs (a bare scene.render() there submits into a presented, destroyed swap-chain texture). */
function redraw(): void {
  engine.beginFrame()
  scene.render()
  engine.endFrame()
}

// ?clip=Walk_Loop plays a motion clip (Quaternius' library) on every rider
async function playClip(name: string | null): Promise<void> {
  const set = await loadClips()
  for (const r of riders) { r.avatar.animator.useClips(set); r.avatar.animator.play(name) }
}
if (params.get('clip')) await playClip(params.get('clip'))

const dev = {
  riders, scene, engine, camera,
  get avatar() { return riders[0].avatar },
  hold(on = true) { paused = on },
  /** advance n steps of dt seconds and render once */
  step(dt = 1 / 60, n = 1) {
    for (let i = 0; i < n; i++) frame(dt)
    redraw()
  },
  view(alpha: number, beta: number, radius: number, y = 0.92, x = 0) {
    camera.target = new Vector3(x, y, 0)
    camera.alpha = alpha
    camera.beta = beta
    camera.radius = radius
    redraw()
  },
  /** frame rider i's head from `alpha` (π/2 = in front) */
  face(i = 0, alpha = Math.PI / 2, radius = 0.9, beta = 1.5) {
    const a = riders[i].avatar
    const head = a.bonePosition('head')
    camera.target = head.add(new Vector3(0, a.rig.headH * 0.25, 0))
    camera.alpha = alpha
    camera.beta = beta
    camera.radius = radius
    redraw()
  },
  motion(mode: MotionMode, speed = 1.3, cadence = 80) {
    for (const r of riders) {
      r.avatar.setMotion({ mode, speed, cadence })
      r.avatar.animator.snap()
    }
    this.step(1 / 60, 1)
  },
  /** the next frame the render loop draws, as a canvas (see render/capture.ts) */
  capture: () => captureFrame(scene),
  /** play a motion clip on every rider (null stops) */
  play: playClip,
  async spec(s: unknown, i = 0) {
    const r = riders[i]
    const next = normalizeSpec(s)
    await preloadAssets(next, quality)
    r.avatar.setSpec(next)
    r.bike?.dispose()
    r.bike = null
    this.step(1 / 60, 1)
  },
}
;(window as unknown as { __dev: typeof dev }).__dev = dev
