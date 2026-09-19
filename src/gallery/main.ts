/**
 * Gallery: what a game sees. A loop track with walkers, runners and cyclists (random avatars plus the player's
 * saved one), moving for real so feet and wheels have to agree with the ground. Also a performance check.
 *   ?count=12  ?q=draft|normal  ?seed=7
 * window.__gallery: { step(dt, n), hold(on), stats() }
 */
import {
  ArcRotateCamera, Color3, Color4, DirectionalLight, DynamicTexture, HemisphericLight, MeshBuilder, Scene,
  ShadowGenerator, StandardMaterial, Texture, Vector3,
} from '@babylonjs/core'
import { createEngine, engineName } from '../render/engine.ts'
import type { MotionMode } from '../anim/animator.ts'
import type { Quality } from '../body/build.ts'
import { loadSaved } from '../storage.ts'
import { randomSpec } from '../presets.ts'
import { Avatar } from '../render/avatar.ts'
import { Bike } from '../render/bike.ts'
import { GeometryService } from '../render/geometryService.ts'
import type { AvatarSpec } from '../spec.ts'

const params = new URLSearchParams(location.search)
const count = Math.max(1, Math.min(40, Number(params.get('count') ?? 12)))
const quality = (params.get('q') as Quality) ?? 'low'
const seed = Number(params.get('seed') ?? 7)

const canvas = document.getElementById('c') as HTMLCanvasElement
const engine = await createEngine(canvas)
const scene = new Scene(engine)
scene.clearColor = new Color4(0.62, 0.82, 1, 1)
scene.fogMode = Scene.FOGMODE_EXP2
scene.fogDensity = 0.012
scene.fogColor = new Color3(0.62, 0.82, 1)
const camera = new ArcRotateCamera('cam', -0.9, 1.08, 24, new Vector3(0, 0, 0), scene)
camera.lowerRadiusLimit = 3
camera.upperRadiusLimit = 60
camera.upperBetaLimit = 1.45
camera.wheelDeltaPercentage = 0.01
camera.attachControl(canvas, true)
const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.1), scene)
hemi.intensity = 0.72
hemi.groundColor = new Color3(0.45, 0.5, 0.4)
const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, -0.35), scene)
sun.position = new Vector3(20, 40, 15)
sun.intensity = 0.8
const shadows = new ShadowGenerator(2048, sun)
shadows.useBlurExponentialShadowMap = true
shadows.blurKernel = 12
shadows.darkness = 0.35

// the park: grass, an oval track (straights along x), a few trees
const grass = MeshBuilder.CreateGround('grass', { width: 160, height: 160 }, scene)
const gm = new StandardMaterial('grassMat', scene)
gm.diffuseColor = new Color3(0.45, 0.72, 0.36)
gm.specularColor = Color3.Black()
grass.material = gm
grass.receiveShadows = true

const STRAIGHT = 16
const RADIUS = 7
const LANES = [-1.4, 0, 1.4]
const trackLen = (r: number): number => 2 * STRAIGHT + 2 * Math.PI * r

/** Position and heading on the oval at distance s for a lane radius r. */
function onTrack(s: number, r: number): { pos: Vector3; yaw: number } {
  const L = trackLen(r)
  let d = ((s % L) + L) % L
  const half = STRAIGHT / 2
  if (d < STRAIGHT) return { pos: new Vector3(-half + d, 0, -r), yaw: Math.PI / 2 }
  d -= STRAIGHT
  if (d < Math.PI * r) {
    const a = d / r
    return { pos: new Vector3(half + Math.sin(a) * r, 0, -Math.cos(a) * r), yaw: Math.PI / 2 - a }
  }
  d -= Math.PI * r
  if (d < STRAIGHT) return { pos: new Vector3(half - d, 0, r), yaw: -Math.PI / 2 }
  d -= STRAIGHT
  const a = d / r
  return { pos: new Vector3(-half - Math.sin(a) * r, 0, Math.cos(a) * r), yaw: -Math.PI / 2 - a }
}

{
  const tex = new DynamicTexture('trackTex', { width: 64, height: 64 }, scene, true)
  const ctx = tex.getContext()
  ctx.fillStyle = '#c8553d'
  ctx.fillRect(0, 0, 64, 64)
  ctx.fillStyle = '#f2e9dc'
  ctx.fillRect(0, 0, 64, 3)
  tex.update()
  tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE
  const mat = new StandardMaterial('trackMat', scene)
  mat.diffuseTexture = tex
  mat.specularColor = Color3.Black()
  const inner = RADIUS - 2.3, outer = RADIUS + 2.3
  const N = 96
  const paths = [inner, outer].map((r) => {
    const pts: Vector3[] = []
    for (let i = 0; i <= N; i++) pts.push(onTrack((i / N) * trackLen(r), r).pos.add(new Vector3(0, 0.01, 0)))
    return pts
  })
  const ribbon = MeshBuilder.CreateRibbon('track', { pathArray: paths }, scene)
  ribbon.material = mat
  ribbon.receiveShadows = true
  const treeMat = new StandardMaterial('treeMat', scene)
  treeMat.diffuseColor = new Color3(0.2, 0.55, 0.3)
  treeMat.specularColor = Color3.Black()
  const trunkMat = new StandardMaterial('trunkMat', scene)
  trunkMat.diffuseColor = new Color3(0.45, 0.3, 0.18)
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2
    const r = 22 + (i % 3) * 3
    const x = Math.cos(a) * r * 1.3, z = Math.sin(a) * r
    const trunk = MeshBuilder.CreateCylinder('trunk', { height: 1.6, diameter: 0.35 }, scene)
    trunk.position.set(x, 0.8, z)
    trunk.material = trunkMat
    const crown = MeshBuilder.CreateSphere('crown', { diameter: 2.6 + (i % 4) * 0.4, segments: 10 }, scene)
    crown.position.set(x, 2.6, z)
    crown.scaling.y = 1.2
    crown.material = treeMat
    shadows.addShadowCaster(crown)
  }
}

interface Mover {
  avatar: Avatar
  bike: Bike | null
  mode: MotionMode
  speed: number
  lane: number
  s: number
}

const movers: Mover[] = []
const service = new GeometryService()
const saved = loadSaved()
const specs: AvatarSpec[] = Array.from({ length: count }, (_, i) => (i === 0 && saved ? saved : randomSpec(seed * 1000 + i)))
const t0 = performance.now()

// the way a game should do it: geometry from the worker, each avatar appears when its body is ready
specs.forEach((spec, i) => {
  const mode: MotionMode = (['walk', 'run', 'cycle', 'run', 'walk', 'cycle'] as const)[i % 6]
  const speed = mode === 'walk' ? 1.1 + (i % 3) * 0.25 : mode === 'run' ? 2.6 + (i % 4) * 0.5 : 5 + (i % 3)
  void service.request(spec, quality).then((g) => {
    if (!g) return
    const avatar = new Avatar(scene, spec, { quality, geometry: g, shadows, name: `a${i}` })
    avatar.setMotion({ mode, speed, cadence: mode === 'cycle' ? speed * 12 : 0, effort: mode === 'walk' ? 0.3 : 0.7 })
    avatar.animator.snap()
    const m: Mover = { avatar, bike: null, mode, speed, lane: LANES[i % LANES.length] + RADIUS, s: (i / count) * trackLen(RADIUS) }
    if (mode === 'cycle') m.bike = makeBike(m)
    movers.push(m)
    if (movers.length === count) console.log(`${count} avatars ready in ${(performance.now() - t0).toFixed(0)} ms`)
  })
})

function makeBike(m: Mover): Bike {
  const b = new Bike(scene, m.avatar.animator.fit, { name: `${m.avatar.name}.bike`, color: m.avatar.spec.clothes.find((c) => c.color)?.color ?? '#1f6bff', accent: '#ffffff' })
  b.root.parent = m.avatar.root
  for (const mesh of b.getMeshes()) shadows.addShadowCaster(mesh)
  return b
}

let paused = false
function step(dt: number): void {
  for (const m of movers) {
    const ds = m.speed * dt
    m.s += ds
    const { pos, yaw } = onTrack(m.s, m.lane)
    m.avatar.root.position.copyFrom(pos)
    m.avatar.root.rotation.y = yaw
    m.avatar.update(dt)
    m.bike?.update(m.avatar.animator.crank, ds)
  }
}

scene.onBeforeRenderObservable.add(() => {
  if (!paused) step(Math.min(0.05, engine.getDeltaTime() / 1000))
})
engine.runRenderLoop(() => scene.render())
window.addEventListener('resize', () => engine.resize())

const stats = document.getElementById('stats')!
setInterval(() => {
  let tris = 0
  for (const m of movers) for (const mesh of m.avatar.getMeshes()) tris += mesh.getTotalIndices() / 3
  stats.textContent = `${count} avatars · ${Math.round(tris / 1000)}k tris · ${engine.getFps().toFixed(0)} fps · ${engineName(engine)}`
}, 500)

// (draws between the loop's frames inside a frame of its own, as WebGPU needs: see src/dev/main.ts)
const redraw = (): void => { engine.beginFrame(); scene.render(); engine.endFrame() }
;(window as unknown as { __gallery: unknown }).__gallery = {
  movers, scene, engine, camera,
  hold(on = true) { paused = on },
  step(dt = 1 / 60, n = 1) {
    for (let i = 0; i < n; i++) step(dt)
    redraw()
  },
  follow(i: number, radius = 5) {
    const m = movers[i]
    camera.target = m.avatar.root.position.add(new Vector3(0, 1, 0))
    camera.radius = radius
    redraw()
  },
}
