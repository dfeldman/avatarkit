import { describe, expect, it } from 'vitest'
import { loadIndex } from '../src/body/mhassets.ts'
import { PRESETS, SKIN_DETAILS, randomSpec } from '../src/presets.ts'
import {
  DEFAULT_SPEC, EYE_MATERIALS, MACROS, cloneSpec, decodeSpec, encodeSpec, normalizeSpec, shapeKey, type AvatarSpec,
} from '../src/spec.ts'

describe('normalizeSpec', () => {
  it('turns anything into a valid spec', () => {
    for (const junk of [undefined, null, 42, 'x', [], { macros: 'no' }, { clothes: 'shirt' }, { hair: [] }]) {
      const s = normalizeSpec(junk)
      expect(s.v).toBe(2)
      for (const k of MACROS) expect(s.macros[k]).toBeGreaterThanOrEqual(0)
      expect((EYE_MATERIALS as readonly string[]).includes(s.eyes)).toBe(true)
    }
    expect(normalizeSpec(undefined)).toEqual(DEFAULT_SPEC)
  })

  it('clamps macros, pins Age at 25 years, and keeps strings that are numbers', () => {
    const s = normalizeSpec({ macros: { Gender: 3, Weight: -1, Muscle: '0.8', Height: Number.NaN, Age: 0.1 } })
    expect(s.macros.Gender).toBe(1)
    expect(s.macros.Weight).toBe(0)
    expect(s.macros.Muscle).toBe(0.8)
    expect(s.macros.Height).toBe(DEFAULT_SPEC.macros.Height)
    expect(s.macros.Age).toBe(0.5)
  })

  it('keeps well-formed modifiers, clamped, and drops the rest', () => {
    const s = normalizeSpec({ modifiers: { 'nose/nose-scale-vert-decr|incr': 4, 'chin/chin-width-decr|incr': -0.3, bad: 1, 'x/y': 'no', 'z/zero': 0 } })
    expect(s.modifiers).toEqual({ 'nose/nose-scale-vert-decr|incr': 1, 'chin/chin-width-decr|incr': -0.3 })
  })

  it('keeps the skin settings in range, defaulting what is missing', () => {
    const s = normalizeSpec({ skin: { color: '#123456', redness: 3, blotchiness: '0.2', beard: -1, shine: 'wet' } })
    expect(s.skin).toEqual({ color: '#123456', redness: 1, blotchiness: 0.2, beard: 0, pores: DEFAULT_SPEC.skin.pores, shine: DEFAULT_SPEC.skin.shine, texture: null })
    expect(normalizeSpec({ skin: { texture: 'toigo_light_skin_male_freckles' } }).skin.texture).toBe('toigo_light_skin_male_freckles')
    expect(normalizeSpec({ skin: { texture: '../../x' } }).skin.texture).toBe(null)
  })

  it('checks asset ids and colours, and wears each garment once', () => {
    const s = normalizeSpec({
      hair: { id: '../etc/passwd', color: 'red' }, eyebrows: null, eyes: 'purple',
      clothes: ['shoes05', { id: 'shoes05' }, { id: 'toigo_camisole_top', color: '#ABC' }, { id: 'bad id!' }],
    })
    expect(s.hair.id).toBe(DEFAULT_SPEC.hair.id)
    expect(s.hair.color).toBe(DEFAULT_SPEC.hair.color)
    expect(s.eyebrows).toBeNull()
    expect(s.eyes).toBe(DEFAULT_SPEC.eyes)
    expect(s.clothes).toEqual([{ id: 'shoes05' }, { id: 'toigo_camisole_top', color: '#aabbcc' }])
    expect(normalizeSpec({ hair: { id: null } }).hair.id).toBeNull()
    expect(normalizeSpec({ clothes: Array.from({ length: 30 }, (_, i) => `g${i}`) }).clothes.length).toBe(12)
  })
})

describe('shapeKey', () => {
  const base = PRESETS[1].spec
  const variant = (f: (s: AvatarSpec) => void): string => { const s = cloneSpec(base); f(s); return shapeKey(normalizeSpec(s)) }
  const key = shapeKey(base)
  it('ignores colours and skin settings', () => {
    expect(variant((s) => { s.skin.color = '#000000'; s.hair.color = '#ffffff'; s.eyes = 'green'; s.clothes[0].color = '#123456' })).toBe(key)
    expect(variant((s) => { s.skin.redness = 1; s.skin.beard = 1; s.skin.pores = 0; s.skin.shine = 1; s.skin.blotchiness = 0 })).toBe(key)
  })
  it('changes with anything that changes the meshes', () => {
    expect(variant((s) => { s.macros.Weight = 0.9 })).not.toBe(key)
    expect(variant((s) => { s.modifiers['nose/nose-scale-vert-decr|incr'] = 0.5 })).not.toBe(key)
    expect(variant((s) => { s.hair.id = 'afro01' })).not.toBe(key)
    expect(variant((s) => { s.eyebrows = null })).not.toBe(key)
    expect(variant((s) => { s.clothes = s.clothes.slice(1) })).not.toBe(key)
  })
})

describe('avatar codes', () => {
  const specs = [DEFAULT_SPEC, ...PRESETS.map((p) => p.spec), randomSpec(1), randomSpec(2)]
  it('round-trip (numbers to three decimals)', () => {
    for (const s of specs) {
      const code = encodeSpec(s)
      expect(code).toMatch(/^AV2-[A-Za-z0-9_-]+$/)
      const back = decodeSpec(code)!
      expect(back).not.toBeNull()
      for (const k of MACROS) expect(Math.abs(back.macros[k] - s.macros[k])).toBeLessThan(6e-4)
      expect(encodeSpec(back)).toBe(code)
      expect(back.clothes).toEqual(s.clothes)
      expect(back.hair).toEqual(s.hair)
    }
  })
  it('hold only what differs from the defaults', () => {
    expect(encodeSpec(DEFAULT_SPEC)).toBe('AV2-e30')
  })
  it('reject anything else, including version 1 codes, and tolerate whitespace', () => {
    for (const bad of ['', 'AV1-AQID', 'AV2-!!', 'AV2-', 'hello', 'AV3-e30']) expect(decodeSpec(bad)).toBeNull()
    const code = encodeSpec(PRESETS[2].spec)
    expect(decodeSpec(`  ${code}\n`)).toEqual(decodeSpec(code))
  })
})

describe('presets and random avatars', () => {
  it('only use assets that exist', async () => {
    const idx = await loadIndex()
    const has = (kind: string, id: string | null): boolean => id === null || idx.some((a) => a.kind === kind && a.id === id)
    for (const s of [...PRESETS.map((p) => p.spec), ...Array.from({ length: 40 }, (_, i) => randomSpec(i))]) {
      expect(has('hair', s.hair.id), s.hair.id ?? '').toBe(true)
      expect(has('eyebrows', s.eyebrows), s.eyebrows ?? '').toBe(true)
      expect(has('eyelashes', s.eyelashes), s.eyelashes ?? '').toBe(true)
      expect(has('eyes', s.eyes), s.eyes).toBe(true)
      for (const c of s.clothes) expect(has('clothes', c.id), c.id).toBe(true)
      expect(has('skin', s.skin.texture), s.skin.texture ?? '').toBe(true)
    }
    for (const id of [...SKIN_DETAILS.female, ...SKIN_DETAILS.male]) expect(has('skin', id), id).toBe(true)
  })
  it('vary', () => {
    const keys = new Set(Array.from({ length: 30 }, (_, i) => shapeKey(randomSpec(i))))
    expect(keys.size).toBe(30)
  })
})
