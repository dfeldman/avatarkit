import { describe, expect, it } from 'vitest'
import { buildAvatarGeometry, preloadAssets, type AvatarGeometry } from '../src/body/build.ts'
import { decodeProxy, encodeProxy } from '../src/body/proxybin.ts'
import { existsSync } from 'node:fs'
import { loadIndex, loadProxy } from '../src/body/mhassets.ts'
import { clothingLayer, fitProxy, layerClothes } from '../src/body/mhbody.ts'
import type { MhProxy } from '../src/body/mhproxy.ts'
import { EXPRESSION_UNITS, loadModifierDefs, macroFactors, MACRO_DEFAULTS, targetWeights, type ExpressionUnit } from '../src/body/mhmodifiers.ts'
import { BONES, torsoHalfWidth } from '../src/body/rig.ts'
import { dot, len, norm, sub, type V3 } from '../src/body/vec.ts'
import { normalizeSpec, type AvatarSpec } from '../src/spec.ts'
import { HAND_MORPHS } from '../src/anim/hands.ts'
import { BODIES, edgeUse, preloadBodies, preset } from './helpers.ts'

await preloadBodies()

describe('MakeHuman modifiers', () => {
  it('weight each macro target by the product of its variables, as MakeHuman does', async () => {
    const d = await loadModifierDefs()
    const f = macroFactors({ ...MACRO_DEFAULTS, Gender: 0.25, Muscle: 0.75, Weight: 0.5 })
    expect(f.female).toBeCloseTo(0.75)
    expect(f.maxmuscle).toBeCloseTo(0.5)
    expect(f.averagemuscle).toBeCloseTo(0.5)
    expect(f.young).toBe(1)
    const w = targetWeights({ ...MACRO_DEFAULTS, Gender: 0.25, Muscle: 0.75 }, {}, d)
    expect(w.get('macrodetails/universal-female-young-maxmuscle-averageweight')).toBeCloseTo(0.75 * 0.5)
    // the ethnicities always act as a mix summing to one
    const e = macroFactors({ ...MACRO_DEFAULTS, African: 2, Asian: 0, Caucasian: 2 })
    expect(e.african + e.asian + e.caucasian).toBeCloseTo(1)
  })

  it('move one target, or one of a decr/incr pair, for a detail modifier', async () => {
    const d = await loadModifierDefs()
    const w = targetWeights(MACRO_DEFAULTS, { 'nose/nose-scale-vert-decr|incr': -0.6, 'no/such-modifier': 1 }, d)
    expect(w.get('nose/nose-scale-vert-decr')).toBeCloseTo(0.6)
    expect(w.has('nose/nose-scale-vert-incr')).toBe(false)
    expect([...w.keys()].some((k) => k.startsWith('no/'))).toBe(false)
  })
})

describe('the asset library', () => {
  it('lists every asset with its credits, and the non-CC0 ones name an author', async () => {
    const idx = await loadIndex()
    expect(idx.filter((a) => a.kind === 'hair').length).toBeGreaterThanOrEqual(10)
    expect(idx.filter((a) => a.kind === 'clothes').length).toBeGreaterThanOrEqual(40)
    for (const a of idx) expect(['CC0', 'CC-BY 4.0']).toContain(a.license)
    for (const a of idx.filter((x) => x.license !== 'CC0')) expect(a.author).toBeTruthy()
  })

  it('gives every garment its own colour and says whether it can be recoloured; most can', async () => {
    const clothes = (await loadIndex()).filter((a) => a.kind === 'clothes')
    for (const a of clothes) {
      expect(a.baseColor, a.id).toMatch(/^#[0-9a-f]{6}$/)
      expect(typeof a.tintable, a.id).toBe('boolean')
      if (a.slot) expect(['tops', 'bottoms', 'outfits', 'shoes', 'socks', 'other']).toContain(a.slot)
    }
    expect(clothes.filter((a) => a.tintable).length / clothes.length).toBeGreaterThan(0.5)
    const plain = await loadProxy('clothes', 'toigo_basic_tucked_t-shirt')
    expect(plain.material.tintable).toBe(true)
    const tartan = await loadProxy('clothes', 'mtknife_pleated_mini_skirt')
    expect(tartan.material.tintable).toBe(false)
    for (const a of clothes.filter((x) => x.normalMap)) {
      expect(existsSync(`public/mh/tex/clothes/${a.id}_normal.jpg`), a.id).toBe(true)
    }
  })
})

const built = new Map<AvatarSpec, AvatarGeometry>()
const geometry = (s: AvatarSpec): AvatarGeometry => {
  let g = built.get(s)
  if (!g) built.set(s, (g = buildAvatarGeometry(s)))
  return g
}

describe.each(BODIES)('%s', (_, spec) => {
  const g = geometry(spec)
  const P = g.body.positions
  const n = P.length / 3

  it('is closed except under its clothes, and every weight is on a real bone', () => {
    // (welded: the skin texture's uv seams split vertices)
    const src = g.body.src!
    const use = edgeUse(g.body.indices.map((i) => src[i]), 19158)
    expect([...use.values()].filter((u) => u > 2).length).toBe(0)
    // skin a garment hides is cut away beneath it: every open edge lies under some garment
    // (points on the garments' surfaces: their vertices and their triangles' centres, as the lighter garments'
    // vertices can be several centimetres apart)
    const garment: number[] = []
    for (const p of g.proxies) {
      if (p.kind !== 'clothes') continue
      for (let k = 0; k < p.positions.length; k++) garment.push(p.positions[k])
      const I = p.indices, Q = p.positions
      for (let t = 0; t < I.length; t += 3) {
        for (let c = 0; c < 3; c++) garment.push((Q[3 * I[t] + c] + Q[3 * I[t + 1] + c] + Q[3 * I[t + 2] + c]) / 3)
      }
    }
    let worst = 0
    for (const [e, u] of use) {
      if (u !== 1) continue
      const a = src.indexOf(Math.floor(e / 19158))
      let best = Infinity
      for (let k = 0; k < garment.length; k += 3) {
        best = Math.min(best, Math.hypot(P[3 * a] - garment[k], P[3 * a + 1] - garment[k + 1], P[3 * a + 2] - garment[k + 2]))
      }
      worst = Math.max(worst, best)
    }
    expect(worst).toBeLessThan(0.05)
    for (const m of [g.body, g.eyes, ...g.proxies]) {
      for (let v = 0; v < m.boneWeights.length / 4; v++) {
        let sum = 0
        for (let k = 0; k < 4; k++) {
          const w = m.boneWeights[4 * v + k]
          if (w > 0) expect(m.boneIndices[4 * v + k]).toBeLessThan(BONES.length)
          sum += w
        }
        expect(Math.abs(sum - 1)).toBeLessThan(1e-3)
      }
      for (const x of m.positions) expect(Number.isFinite(x)).toBe(true)
    }
  }, 15000) // (builds a whole dressed body; the first also warms up)

  it('stands on its soles, an adult height', () => {
    let y0 = Infinity
    for (const m of [g.body, ...g.proxies]) for (let i = 1; i < m.positions.length; i += 3) y0 = Math.min(y0, m.positions[i])
    expect(Math.abs(y0)).toBeLessThan(1e-4) // (float32 positions)
    expect(g.rig.height).toBeGreaterThan(1.3)
    expect(g.rig.height).toBeLessThan(2.25)
  })

  it('rests with straight arms and legs, as the poser expects, mirrored left to right', () => {
    const J = g.rig.joints
    const along = (a: V3, b: V3, c: V3): number => dot(norm(sub(b, a)), norm(sub(c, b)))
    expect(along(J['upperArm.R'], J['forearm.R'], J['hand.R'])).toBeGreaterThan(0.999)
    expect(along(J['thigh.R'], J['shin.R'], J['foot.R'])).toBeGreaterThan(0.999)
    expect(Math.abs(len(sub(J['forearm.R'], J['upperArm.R'])) - g.rig.upperArmLen)).toBeLessThan(1e-9)
    expect(J['hand.R'][0]).toBeGreaterThan(0.15)
    expect(J['hand.L'][0]).toBeCloseTo(-J['hand.R'][0], 9)
    // the spine stacks up
    const ys = (['hips', 'spine', 'chest', 'neck', 'head'] as const).map((b) => J[b][1])
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1])
  })

  it('measures its trunk for the poser', () => {
    const r = g.rig
    expect(r.hipOuter).toBeGreaterThanOrEqual(r.hipHalf)
    expect(r.crotchY).toBeLessThan(r.joints['thigh.R'][1])
    expect(r.crotchY).toBeGreaterThan(r.joints['shin.R'][1])
    const waist = torsoHalfWidth(r, r.joints.spine[1])
    expect(waist).toBeGreaterThan(0.08)
    expect(waist).toBeLessThan(r.hipOuter + 0.1)
    expect(r.chestDepth).toBeGreaterThan(0.05)
  })

  it('has its eyes in its head, riding the head bone', () => {
    const E = g.eyes.positions
    const head = BONES.indexOf('head')
    for (let v = 0; v < E.length / 3; v++) {
      expect(Math.abs(E[3 * v + 1] - g.rig.eyeY)).toBeLessThan(0.03)
      expect(Math.abs(E[3 * v])).toBeLessThan(g.rig.headR[0])
      expect(g.eyes.boneIndices[4 * v]).toBe(head)
    }
    expect(g.cornea.indices.length).toBeGreaterThan(0)
  })
})

describe('shape', () => {
  it('follows the macros: taller with Height, wider with Weight', () => {
    const base = preset('sam')
    const with_ = (m: Partial<AvatarSpec['macros']>): AvatarSpec => normalizeSpec({ ...base, macros: { ...base.macros, ...m } })
    const tall = with_({ Height: 0.7 }), short = with_({ Height: 0.3 }), heavy = with_({ Weight: 1 }), thin = with_({ Weight: 0 })
    for (const s of [tall, short, heavy, thin]) built.delete(s)
    return Promise.all([tall, short, heavy, thin].map((s) => import('../src/body/build.ts').then((b) => b.preloadAssets(s)))).then(() => {
      expect(geometry(tall).rig.height).toBeGreaterThan(geometry(short).rig.height + 0.15)
      const trunk = (s: AvatarSpec): number => { const w = geometry(s).rig.torso.w; return w.reduce((t, x) => t + x, 0) / w.length }
      expect(trunk(heavy)).toBeGreaterThan(trunk(thin))
      expect(geometry(heavy).rig.hipOuter).toBeGreaterThan(geometry(thin).rig.hipOuter + 0.01)
    })
  })
})

describe('layered clothes', () => {
  // one body triangle facing +z, and garments fitted to it at chosen heights above the skin
  // (a fourth vertex off the plane only sets the z scale MakeHuman's fitting multiplies offsets by)
  const P = new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1])
  const N = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1])
  const garment = (id: string, slot: string, z: number): MhProxy => ({
    kind: 'clothes', id, slot, scale: { x: [0, 1, 1], y: [0, 2, 1], z: [0, 3, 1] }, zDepth: 50,
    fit: [[0, 1, 2, 0.4, 0.3, 0.3, 0, 0, z], [0, 1, 2, 0.2, 0.5, 0.3, 0, 0, z]], uv: [0, 0, 1, 0], tris: [], deleteVerts: [],
    material: { texture: null, transparent: false, backfaceCull: true, color: '1 1 1' },
  })
  const zs = (p: Float32Array): number[] => [p[2], p[5]]

  it('push a shirt out over the shorts beneath it, whatever order they are worn in', () => {
    const wear = [garment('shirt', 'tops', 0.002), garment('shorts', 'bottoms', 0.006)]
    const fitted = wear.map((pr) => fitProxy(P, pr))
    layerClothes(P, N, wear, fitted)
    expect(zs(fitted[1])).toEqual([expect.closeTo(0.006, 6), expect.closeTo(0.006, 6)])
    for (const z of zs(fitted[0])) expect(z).toBeCloseTo(0.01, 6)
  })

  it('leave a garment alone when nothing is under it, or it already clears', () => {
    const wear = [garment('shirt', 'tops', 0.02), garment('shorts', 'bottoms', 0.006)]
    const fitted = wear.map((pr) => fitProxy(P, pr))
    layerClothes(P, N, wear, fitted)
    for (const z of zs(fitted[0])) expect(z).toBeCloseTo(0.02, 6)
    const alone = [garment('shirt', 'tops', 0.002)]
    const f2 = alone.map((pr) => fitProxy(P, pr))
    layerClothes(P, N, alone, f2)
    for (const z of zs(f2[0])) expect(z).toBeCloseTo(0.002, 6)
  })

  it('order socks, shoes, trousers, tops, then boots over trousers and hats outermost', () => {
    const L = (slot: string, id = 'x'): number => clothingLayer({ slot, id })
    expect(L('socks')).toBeLessThan(L('shoes'))
    expect(L('shoes')).toBeLessThan(L('bottoms'))
    expect(L('bottoms')).toBeLessThan(L('tops'))
    expect(L('shoes', 'riding_boots')).toBeGreaterThan(L('bottoms'))
    expect(L('other')).toBeGreaterThan(L('outfits'))
  })
})

describe('the binary proxy format', () => {
  it('round-trips a proxy within its quantisation steps', () => {
    const p: MhProxy = {
      kind: 'clothes', id: 'x', slot: 'tops', scale: { x: [1, 2, 3.5], y: [4, 5, 1.25], z: [6, 7, 2] }, zDepth: 50,
      fit: [[10, 20, 19157, 0.5, -8.3, 8.8, 0.01, -6.3, 2.2], [1, 2, 3, 1, 0, 0, 0, 0, 0]],
      uv: [-0.8, 0.2, 2.43, 0.99], tris: [0, 1, 0], deleteVerts: [5, 19157], lods: { low: [1, 0, 1] },
      material: { texture: 'tex/clothes/x.jpg', normal: null, transparent: false, backfaceCull: true, color: '1 1 1', baseColor: '#123456', tintable: true },
    }
    const b = encodeProxy(p)
    const q = decodeProxy(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)
    expect(q.material).toEqual(p.material)
    expect([q.tris, q.deleteVerts, q.lods, q.slot, q.scale]).toEqual([p.tris, p.deleteVerts, p.lods, p.slot, p.scale])
    p.fit.forEach((r, i) => r.forEach((v, k) => expect(Math.abs(q.fit[i][k] - v)).toBeLessThan(k < 3 ? 1e-9 : 3e-4)))
    p.uv.forEach((v, i) => expect(Math.abs(q.uv[i] - v)).toBeLessThan(1e-4))
  })

  it('simplifies heavy garments for the lower qualities, over the same vertices', async () => {
    const idx = await loadIndex()
    const heavy = idx.filter((a) => a.kind === 'clothes' && a.tris > 10000).slice(0, 5)
    expect(heavy.length).toBeGreaterThan(0)
    for (const a of heavy) {
      const p = await loadProxy('clothes', a.id)
      for (const q of ['medium', 'low'] as const) {
        const t = p.lods?.[q]
        if (!t) continue
        expect(t.length, `${a.id} ${q}`).toBeLessThan(p.tris.length)
        for (const v of t) expect(v).toBeLessThan(p.fit.length)
      }
      expect(p.lods?.low ?? p.lods?.medium, a.id).toBeTruthy()
    }
  })

  it('builds lighter garments at lower quality', async () => {
    const spec = normalizeSpec({ clothes: [{ id: 'mindfront_male_trousers_2' }, { id: 'elvs_hooded_sweat_jacket1' }] })
    await preloadAssets(spec, 'low')
    const tris = (q: 'low' | 'medium' | 'high'): number => buildAvatarGeometry(spec, q).proxies.filter((p) => p.kind === 'clothes').reduce((s, p) => s + p.indices.length / 3, 0)
    expect(tris('low')).toBeLessThan(tris('medium'))
    expect(tris('medium')).toBeLessThan(tris('high'))
  })

  it("draws MakeHuman's low-poly body at low quality, fully weighted, on the same skeleton", async () => {
    for (const g of [0.1, 0.9]) {
      const spec = normalizeSpec({ macros: { Gender: g } })
      await preloadAssets(spec, 'low')
      const low = buildAvatarGeometry(spec, 'low'), high = buildAvatarGeometry(spec, 'high')
      expect(low.body.positions.length / 3).toBeLessThan(2100)
      expect(low.body.indices.length).toBeLessThan(high.body.indices.length / 4)
      // the same skeleton, so every animation drives both
      expect(low.rig.height).toBeCloseTo(high.rig.height, 6)
      const w = low.body.boneWeights
      for (let i = 0; i < w.length; i += 4) expect(w[i] + w[i + 1] + w[i + 2] + w[i + 3]).toBeCloseTo(1, 3)
      for (const v of low.body.ao!) expect(v).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('facial expressions', () => {
  it('move only the face, a few millimetres to a few centimetres, left and right on their own sides', async () => {
    const spec = preset('sam')
    const g = buildAvatarGeometry(spec)
    const m = g.body.morphs!
    const units = (ms: object | undefined): number => Object.keys(ms ?? {}).filter((k) => !k.startsWith('hand-')).length
    expect(units(m)).toBe(EXPRESSION_UNITS.length)
    const P = g.body.positions
    const side = (u: ExpressionUnit): number => {
      const d = m[u]!
      let sx = 0, n = 0, most = 0
      for (let i = 0; i < d.length / 3; i++) {
        const len = Math.hypot(d[3 * i], d[3 * i + 1], d[3 * i + 2])
        if (len < 1e-4) continue
        expect(P[3 * i + 1], `${u} moves a vertex below the chin`).toBeGreaterThan(g.rig.chinY - 0.06)
        most = Math.max(most, len)
        sx += P[3 * i]
        n++
      }
      expect(most, u).toBeGreaterThan(0.002)
      expect(most, u).toBeLessThan(0.04)
      return sx / n
    }
    for (const u of EXPRESSION_UNITS) side(u)
    // (MakeHuman's left is the avatar's own left: +x)
    expect(side('eye-left-closure')).toBeGreaterThan(0)
    expect(side('eye-right-closure')).toBeLessThan(0)
    // the brows and lashes ride on the face
    for (const p of g.proxies.filter((x) => x.kind === 'eyebrows' || x.kind === 'eyelashes')) {
      expect(units(p.morphs), p.id).toBe(EXPRESSION_UNITS.length)
    }
    // and the low body carries them through its fitting
    await preloadAssets(spec, 'low')
    expect(units(buildAvatarGeometry(spec, 'low').body.morphs)).toBe(EXPRESSION_UNITS.length)
  })
})

describe('hands', () => {
  it('rest relaxed and take each pose, both hands mirror images, moving only the fingers', () => {
    const g = buildAvatarGeometry(preset('sam'))
    const P = g.body.positions
    const hand = g.rig.joints['hand.R']
    // the vertices around each hand
    const near = (sg: number): number[] => {
      const out: number[] = []
      for (let i = 0; i < P.length / 3; i++) {
        if (Math.hypot(P[3 * i] - sg * hand[0], P[3 * i + 1] - hand[1], P[3 * i + 2] - hand[2]) < 0.22) out.push(i)
      }
      return out
    }
    const R = near(1), L = near(-1)
    const mirrored = (D: Float32Array | null): number => {
      // the worst distance from a right-hand vertex to the nearest left-hand one, mirrored
      const at = (i: number): V3 => [P[3 * i] + (D ? D[3 * i] : 0), P[3 * i + 1] + (D ? D[3 * i + 1] : 0), P[3 * i + 2] + (D ? D[3 * i + 2] : 0)]
      const left = L.map(at)
      let worst = 0
      for (const i of R) {
        const p = at(i)
        let best = Infinity
        for (const q of left) best = Math.min(best, Math.hypot(p[0] + q[0], p[1] - q[1], p[2] - q[2]))
        worst = Math.max(worst, best)
      }
      return worst
    }
    expect(mirrored(null)).toBeLessThan(5e-4)
    for (const m of HAND_MORPHS) {
      const D = g.body.morphs![m]!
      expect(mirrored(D), m).toBeLessThan(5e-4)
      // the fingers move a few centimetres; nothing above the wrist moves
      let most = 0
      for (let i = 0; i < D.length / 3; i++) {
        const d = Math.hypot(D[3 * i], D[3 * i + 1], D[3 * i + 2])
        most = Math.max(most, d)
        if (d > 1e-4) expect(P[3 * i + 1], m).toBeLessThan(hand[1] + 0.02)
      }
      expect(most, m).toBeGreaterThan(0.01)
      expect(most, m).toBeLessThan(0.12)
    }
  })
})

describe('hats', () => {
  it('hide the hair under them, and only that', async () => {
    const hair = (spec: AvatarSpec): number => buildAvatarGeometry(spec).proxies.find((p) => p.kind === 'hair')!.indices.length
    const bare = normalizeSpec({ ...preset('sam'), hair: { id: 'long01', color: '#333333' } })
    const capped = normalizeSpec({ ...bare, clothes: [...bare.clothes, { id: 'mindfront_knitted_hat_01' }] })
    const glasses = normalizeSpec({ ...bare, clothes: [...bare.clothes, { id: 'punkduck_sport-sunglasses' }] })
    await preloadAssets(capped)
    await preloadAssets(glasses)
    const all = hair(bare), under = hair(capped)
    // a beanie covers the crown: much of the hair goes, but long hair below it stays
    expect(under).toBeLessThan(all * 0.8)
    expect(under).toBeGreaterThan(all * 0.2)
    // glasses are not a hat
    expect(hair(glasses)).toBe(all)
  })
})

describe('age', () => {
  it('runs from 25 to 90, and ageing changes the body', async () => {
    expect(normalizeSpec({ macros: { Age: 0.1 } }).macros.Age).toBe(0.5)
    expect(normalizeSpec({ macros: { Age: 0.8 } }).macros.Age).toBe(0.8)
    const young = preset('sam'), old = normalizeSpec({ ...young, macros: { ...young.macros, Age: 1 } })
    await preloadAssets(old)
    const a = buildAvatarGeometry(young).body.positions, b = buildAvatarGeometry(old).body.positions
    let most = 0
    for (let i = 0; i < a.length; i++) most = Math.max(most, Math.abs(a[i] - b[i]))
    expect(most).toBeGreaterThan(0.005)
  })
})
