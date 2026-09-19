/**
 * The Babylon side, on a NullEngine: the rendered skeleton and skin follow the animation exactly, looks change
 * without rebuilding, nothing leaks, bikes match their riders, and the geometry service queues sensibly.
 */
import { FreeCamera, Logger, NullEngine, Scene, TransformNode, Vector3, type Mesh, type PBRMaterial } from '@babylonjs/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FK } from '../src/anim/pose.ts'
import { buildAvatarGeometry, preloadAssets, type SkinnedMeshData } from '../src/body/build.ts'
import { preloadProxies, setAssetBase } from '../src/body/mhassets.ts'
import { Avatar, getGeometry } from '../src/render/avatar.ts'
import { Bike } from '../src/render/bike.ts'
import { GeometryService } from '../src/render/geometryService.ts'
import { cloneSpec, normalizeSpec, shapeKey, type AvatarSpec } from '../src/spec.ts'
import { BIGGEST, installFakeCanvas, preloadBodies, preset, vec } from './helpers.ts'

installFakeCanvas()
// textures are fetched from here in pages; under node the loads just fail quietly (the tests check meshes)
setAssetBase('http://localhost/mh/')
await preloadBodies()
// (these tests build at low quality: MakeHuman's low-poly bodies)
await preloadProxies([['body', 'male1591'], ['body', 'female1605']])
for (const h of [0.61, 0.62, 0.63, 0.64, 0.65, 0.66, 0.67]) await preloadAssets(normalizeSpec({ ...preset('sam'), macros: { ...preset('sam').macros, Height: h } }))
Logger.LogLevels = Logger.ErrorLogLevel

let engine: NullEngine
let scene: Scene
beforeAll(() => {
  engine = new NullEngine()
  scene = new Scene(engine)
  new FreeCamera('camera', new Vector3(0, 1, -5), scene)
})
afterAll(() => engine.dispose())

const counts = (): Record<string, number> => ({
  meshes: scene.meshes.length,
  nodes: scene.transformNodes.length,
  materials: scene.materials.length,
  textures: scene.textures.length,
  skeletons: scene.skeletons.length,
  geometries: scene.geometries.length,
})

/** Where linear blend skinning puts each vertex for the animator's current pose (character space). */
function expectedSkin(avatar: Avatar, positions: Float32Array, indices: Float32Array, weights: Float32Array): Float32Array {
  const rest = avatar.animator.rest
  const fk = new FK(rest).run((avatar.animator as unknown as { out: Parameters<FK['run']>[0] }).out)
  const out = new Float32Array(positions.length)
  for (let v = 0; v < positions.length / 3; v++) {
    const acc = Vector3.Zero()
    for (let k = 0; k < 4; k++) {
      const w = weights[4 * v + k]
      if (!w) continue
      const b = indices[4 * v + k]
      const p = vec(positions, 3 * v).subtract(rest.restPos[b]).rotateByQuaternionToRef(fk.rot[b], new Vector3()).addInPlace(fk.pos[b])
      acc.addInPlace(p.scale(w))
    }
    out.set([acc.x, acc.y, acc.z], 3 * v)
  }
  return out
}

describe('Avatar', () => {
  it('eases its hands into a pose, and grips the bars when cycling', () => {
    const a = new Avatar(scene, preset('sam'), { quality: 'low' })
    const influence = (m: string): number => {
      const mgr = a.body!.morphTargetManager!
      for (let i = 0; i < mgr.numTargets; i++) if (mgr.getTarget(i).name.endsWith(`.${m}`)) return mgr.getTarget(i).influence
      throw new Error(`no ${m} morph`)
    }
    expect(influence('hand-fist')).toBe(0)
    a.setHands('fist')
    a.update(1 / 60)
    expect(influence('hand-fist')).toBeGreaterThan(0)
    expect(influence('hand-fist')).toBeLessThan(0.9)
    for (let i = 0; i < 30; i++) a.update(1 / 60)
    expect(influence('hand-fist')).toBe(1)
    a.setHands('point', 0.5)
    for (let i = 0; i < 60; i++) a.update(1 / 60)
    expect(influence('hand-fist')).toBe(0)
    expect(influence('hand-point')).toBe(0.5)
    // relaxed hands close around the bars on a bike
    a.setHands('relaxed')
    a.setMotion({ mode: 'cycle', cadence: 80 })
    for (let i = 0; i < 180; i++) a.update(1 / 60)
    expect(influence('hand-fist')).toBeGreaterThan(0.6)
    expect(influence('hand-point')).toBe(0)
    a.dispose()
  })

  it('poses the Babylon skeleton and skin exactly where the animation puts them', () => {
    const spec = preset('runner')
    const a = new Avatar(scene, spec, { quality: 'low' })
    a.root.position.set(1.5, 0.2, -3)
    a.root.rotation.y = 0.7
    expect(a.skeleton!.bones.length).toBe(a.animator.rest.names.length)
    expect(a.animator.rest.names.length).toBe(21)
    for (const [mode, speed] of [['run', 3.2], ['walk', 1.4], ['cycle', 5]] as const) {
      a.setMotion({ mode, speed, cadence: 85 })
      a.animator.snap()
      for (let i = 0; i < 37; i++) a.update(1 / 60)
      // joints
      const world = a.root.computeWorldMatrix(true)
      const fk = new FK(a.animator.rest).run((a.animator as unknown as { out: Parameters<FK['run']>[0] }).out)
      a.animator.rest.names.forEach((n, i) => {
        expect(Vector3.Distance(Vector3.TransformCoordinates(fk.pos[i], world), a.bonePosition(n))).toBeLessThan(1e-5)
      })
      // skin (Babylon's CPU skinning, in the avatar's local space): the body, the eyes and every proxy
      scene.render()
      a.skeleton!.prepare(true)
      const g = getGeometry(a.spec, 'low')
      const pairs: Array<[Mesh, SkinnedMeshData]> = [[a.body!, g.body], [a.eyes!, g.eyes], ...a.proxies.map((m, i): [Mesh, SkinnedMeshData] => [m, g.proxies[i]])]
      expect(pairs.length).toBe(2 + g.proxies.length)
      for (const [mesh, data] of pairs) {
        const skinned = mesh.getPositionData(true, false)!
        const want = expectedSkin(a, data.positions, data.boneIndices, data.boneWeights)
        let err = 0
        for (let i = 0; i < want.length; i++) err = Math.max(err, Math.abs(skinned[i] - want[i]))
        expect(err, `${mode} ${mesh.name}`).toBeLessThan(1e-5)
      }
      if (mode !== 'cycle') {
        // the rendered soles don't sink into the floor, and a walker always has one on it
        const shoes = a.proxies.findIndex((m) => /shoe/.test(m.name))
        const want = expectedSkin(a, g.proxies[shoes].positions, g.proxies[shoes].boneIndices, g.proxies[shoes].boneWeights)
        let low = Infinity
        for (let i = 1; i < want.length; i += 3) low = Math.min(low, want[i])
        expect(low, mode).toBeGreaterThan(-0.012)
        if (mode === 'walk') expect(low, mode).toBeLessThan(0.01)
      }
    }
    a.dispose()
  })

  it('changes colours and eyes without rebuilding, and rebuilds for new clothes or hair', async () => {
    const spec = preset('sam')
    const a = new Avatar(scene, spec, { quality: 'low' })
    const body = a.body
    const next = cloneSpec(spec)
    next.skin.color = '#3b2219'
    next.hair.color = '#e9e7e4'
    next.eyes = 'green'
    next.clothes[0].color = '#123456'
    a.setSpec(next)
    // (compare identity as a boolean: a failing toBe on two meshes makes vitest print the whole scene)
    expect(a.body === body).toBe(true)
    expect(a.spec).toEqual(next)
    // setLook keeps the meshes whatever it is given
    a.setLook({ ...next, hair: { ...next.hair, id: 'afro01' } })
    expect(a.body === body).toBe(true)
    expect(a.shape).toBe(`low|${shapeKey(spec)}`)
    // different clothes are a different shape (they hide different skin)
    const dressed = { ...next, clothes: [...next.clothes.slice(1), { id: 'toigo_camisole_top', color: '#ffffff' }] }
    await preloadAssets(normalizeSpec(dressed))
    a.setSpec(dressed)
    expect(a.body === body).toBe(false)
    expect(a.proxies.some((m) => m.name.endsWith('toigo_camisole_top'))).toBe(true)
    a.dispose()
  })

  it('shows expressions as morph targets on the face, brows and lashes, and blinks over them', () => {
    const a = new Avatar(scene, preset('sam'), { quality: 'low' })
    const influence = (mesh: string, unit: string): number[] =>
      a.getMeshes().filter((m) => m.name.includes(mesh)).map((m) => m.morphTargetManager!.getTargetByName(`${m.name}.${unit}`)!.influence)
    a.blinking = false
    a.setExpression('happy', 0.5)
    expect(influence('.body', 'mouth-corner-puller')).toEqual([0.5])
    expect(influence('.eyebrows.', 'mouth-corner-puller')).toEqual([0.5])
    expect(influence('.body', 'mouth-depression')).toEqual([0])
    a.setExpression({ 'mouth-open': 2 })
    expect(influence('.body', 'mouth-open')).toEqual([1])
    expect(influence('.body', 'mouth-corner-puller')).toEqual([0])
    // blinking closes both eyes now and then, over whatever the face is doing
    a.blinking = true
    let closed = 0
    for (let i = 0; i < 60 * 12; i++) { a.update(1 / 60); closed = Math.max(closed, influence('.body', 'eye-left-closure')[0]) }
    expect(closed).toBeGreaterThan(0.9)
    a.blinking = false
    a.update(1 / 60)
    a.dispose()
  })

  it('wears each proxy as its own textured mesh, alpha-tested where MakeHuman marks it transparent', () => {
    const a = new Avatar(scene, preset('sunny'), { quality: 'low' })
    const g = getGeometry(a.spec, 'low')
    expect(a.proxies.length).toBe(g.proxies.length)
    for (const [i, m] of a.proxies.entries()) {
      const mat = m.material as PBRMaterial
      expect(!!mat.albedoTexture).toBe(!!g.proxies[i].material.texture)
      expect(mat.transparencyMode === 1).toBe(g.proxies[i].material.transparent)
    }
    const hair = a.proxies.find((m) => m.name.includes('.hair.'))!
    expect((hair.material as PBRMaterial).transparencyMode).toBe(1)
    a.dispose()
  })

  it('rebuilds for a new shape, and leaves nothing behind when disposed', async () => {
    const before = counts()
    const spec = preset('petite')
    const a = new Avatar(scene, spec, { quality: 'low' })
    const body = a.body!
    const height = a.rig.height
    const taller = cloneSpec(spec)
    taller.macros.Height = 0.7
    taller.hair.id = 'afro01'
    await preloadAssets(taller)
    a.setSpec(taller)
    expect(a.body === body).toBe(false)
    expect(body.isDisposed()).toBe(true)
    expect(a.rig.height).toBeGreaterThan(height + 0.2)
    a.setMotion({ mode: 'walk', speed: 1.2 })
    a.update(0.1)
    a.setQuality('medium')
    expect(a.shape).toBe(`medium|${shapeKey(taller)}`)
    a.dispose()
    // (textures still loading are released as they finish; compare what the scene holds besides)
    const after = counts()
    expect({ ...after, textures: 0 }).toEqual({ ...before, textures: 0 })
  })

  it('takes any JSON and shares geometry between identical shapes', async () => {
    const junk = { macros: { Height: 'tall' }, hair: 42 }
    await preloadAssets(normalizeSpec(junk))
    const a = new Avatar(scene, junk, { quality: 'low' })
    expect(a.spec.macros.Height).toBe(0.5)
    const s1 = preset('silver')
    const s2: AvatarSpec = { ...cloneSpec(s1), skin: { ...s1.skin, color: '#000000', redness: 0.9, shine: 0.1 } }
    expect(getGeometry(s1, 'low')).toBe(getGeometry(s2, 'low'))
    a.dispose()
  })

  it('creates itself, loading what it needs', async () => {
    const a = await Avatar.create(scene, preset('curvy'))
    // (hair, brows, lashes, teeth and tongue besides the clothes)
    expect(a.proxies.length).toBe(preset('curvy').clothes.length + 5)
    a.dispose()
  })
})

describe('Bike', () => {
  it('puts the pedals where the rider’s feet go and keeps them level', () => {
    const a = new Avatar(scene, preset('lanky'), { quality: 'low' })
    const fit = a.animator.fit
    const bike = new Bike(scene, fit, { name: 'testBike' })
    const pedals = ([-1, 1] as const).map((sx) => scene.getTransformNodeByName(`testBike.pedalNode${sx}`) as TransformNode)
    for (let i = 0; i < 12; i++) {
      const crank = (i / 12) * Math.PI * 2
      bike.update(crank, 0.1)
      pedals.forEach((node, j) => {
        const side = j === 0 ? 'L' : 'R'
        const a0 = crank + (side === 'R' ? 0 : Math.PI)
        const centre = new Vector3((side === 'R' ? 1 : -1) * fit.qFactor, fit.bb.y + fit.crank * Math.cos(a0), fit.bb.z + fit.crank * Math.sin(a0))
        const m = node.computeWorldMatrix(true)
        expect(Vector3.Distance(m.getTranslation(), centre)).toBeLessThan(1e-6)
        // level: the pedal's up stays up
        expect(Vector3.TransformNormal(new Vector3(0, 1, 0), m).normalize().y).toBeCloseTo(1, 6)
      })
    }
    // wheels roll forward by the distance travelled
    const wheel = scene.getTransformNodeByName('testBike.rearWheel')!
    const before = wheel.rotation.x
    bike.update(0, fit.wheelRadius * 0.5)
    expect((wheel.rotation.x - before + Math.PI * 2) % (Math.PI * 2)).toBeCloseTo(0.5, 9)
    const baseline = scene.meshes.length
    const own = bike.getMeshes().length
    expect(own).toBeGreaterThan(10)
    bike.dispose()
    expect(scene.meshes.length).toBe(baseline - own)
    expect(scene.materials.filter((m) => m.name.startsWith('testBike.')).length).toBe(0)
    a.dispose()
  })

  it('gives the saddle and bars to the rider’s seat and hands', () => {
    const a = new Avatar(scene, preset('petite'), { quality: 'low' })
    a.setMotion({ mode: 'cycle', cadence: 80 })
    a.animator.snap()
    a.update(1 / 60)
    const fit = a.animator.fit
    const hips = a.bonePosition('hips')
    // seated just above the saddle, hands at the grips
    expect(hips.y).toBeGreaterThan(fit.saddle.y)
    expect(hips.y - fit.saddle.y).toBeLessThan(0.15)
    for (const side of ['L', 'R'] as const) {
      const sx = side === 'R' ? 1 : -1
      const grip = new Vector3(sx * fit.grip.x, fit.grip.y, fit.grip.z)
      expect(Vector3.Distance(a.bonePosition(`hand.${side}`), grip)).toBeLessThan(0.1)
    }
    a.dispose()
  })
})

describe('GeometryService (main-thread fallback)', () => {
  const tallSam = (h: number): AvatarSpec => {
    const s = cloneSpec(preset('sam'))
    s.macros.Height = h
    return s
  }
  const heightOf = (h: number): number => buildAvatarGeometry(tallSam(h)).rig.height

  it('builds what buildAvatarGeometry builds, once per shape', async () => {
    const svc = new GeometryService()
    const spec = tallSam(0.61)
    const [g1, g2] = await Promise.all([svc.request(spec, 'low'), svc.request(cloneSpec(spec), 'low')])
    expect(g1).not.toBeNull()
    expect(g2).toBe(g1)
    expect(g1!.body.positions).toEqual(buildAvatarGeometry(spec, 'low').body.positions)
    expect(svc.cached(spec, 'low')).toBe(g1)
    await expect(svc.request(spec, 'low')).resolves.toBe(g1)
    expect(svc.cached(spec, 'medium')).toBeUndefined()
    svc.dispose()
  })

  it('with `latest`, drops queued shapes that a newer request replaced', async () => {
    const svc = new GeometryService()
    const first = svc.request(tallSam(0.62), 'low', { latest: true })
    const stale = svc.request(tallSam(0.63), 'low', { latest: true })
    const newest = svc.request(tallSam(0.64), 'low', { latest: true })
    const [a, b, c] = await Promise.all([first, stale, newest])
    // the first was already building, so it finishes; the middle one never builds
    expect(a?.rig.height).toBe(heightOf(0.62))
    expect(b).toBeNull()
    expect(c?.rig.height).toBe(heightOf(0.64))
    expect(svc.cached(tallSam(0.63), 'low')).toBeUndefined()
    svc.dispose()
  })

  it('retries on the main thread when the worker fails, rather than dropping what it was building', async () => {
    // a worker that dies on its first job (no module workers, a blocked script): the avatar still appears
    class DeadWorker {
      onmessage: ((e: MessageEvent) => void) | null = null
      onerror: ((e: Event) => void) | null = null
      postMessage(): void {
        setTimeout(() => this.onerror?.(new Event('error')), 0)
      }
      terminate(): void {}
    }
    const g = globalThis as { Worker?: unknown }
    const had = Object.prototype.hasOwnProperty.call(g, 'Worker')
    const before = g.Worker
    g.Worker = DeadWorker
    try {
      const svc = new GeometryService()
      const spec = tallSam(0.68)
      await expect(svc.request(spec, 'low').then((x) => x?.rig.height)).resolves.toBe(heightOf(0.68))
      svc.dispose()
    } finally {
      if (had) g.Worker = before
      else delete g.Worker
    }
  })

  it('builds every request in order by default', async () => {
    const svc = new GeometryService()
    const done: number[] = []
    const heights = [0.65, 0.66, 0.67]
    await Promise.all(heights.map((h) => svc.request(tallSam(h), 'low').then((g) => done.push(g!.rig.height))))
    expect(done).toEqual(heights.map(heightOf))
    svc.dispose()
  })
})

describe('bounds', () => {
  it('cover every pose, so posed avatars are never culled', () => {
    const a = new Avatar(scene, BIGGEST, { quality: 'low' })
    const box = a.body!.getBoundingInfo().boundingBox
    for (const [mode, speed] of [['run', 6], ['cycle', 5], ['walk', 2.4]] as const) {
      a.setMotion({ mode, speed, cadence: 120 })
      a.animator.snap()
      for (let i = 0; i < 90; i++) {
        a.update(1 / 60)
        if (i % 10) continue
        scene.render()
        a.skeleton!.prepare(true)
        const p = a.body!.getPositionData(true, false)!
        // the posed extent (one check per frame; per-vertex expects take seconds)
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
        for (let j = 0; j < p.length; j += 3) {
          for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[j + k]); hi[k] = Math.max(hi[k], p[j + k]) }
        }
        expect(lo[0]).toBeGreaterThan(box.minimum.x)
        expect(hi[0]).toBeLessThan(box.maximum.x)
        expect(lo[1]).toBeGreaterThan(box.minimum.y)
        expect(hi[1]).toBeLessThan(box.maximum.y)
        expect(lo[2]).toBeGreaterThan(box.minimum.z)
        expect(hi[2]).toBeLessThan(box.maximum.z)
      }
    }
    a.dispose()
  })
})
