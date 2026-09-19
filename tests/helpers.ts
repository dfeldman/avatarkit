/** Shared fixtures for the tests. */
import { Vector3 } from '@babylonjs/core'
import { PRESETS } from '../src/presets.ts'
import { preloadAssets } from '../src/body/build.ts'
import { normalizeSpec, type AvatarSpec } from '../src/spec.ts'

/** The extremes: the smallest, slightest body and the biggest, with Height kept to the adult range the gait was
 * validated on (about 1.4 to 2.05 m; MakeHuman's own Height ends run from 1.2 m to 2.4 m). */
export const SMALLEST = normalizeSpec({ macros: { Gender: 0, Muscle: 0, Weight: 0, Height: 0.28, BodyProportions: 0, BreastSize: 0 } })
export const BIGGEST = normalizeSpec({ macros: { Gender: 1, Muscle: 1, Weight: 1, Height: 0.72, BodyProportions: 1, BreastSize: 1 } })

export function preset(id: string): AvatarSpec {
  const p = PRESETS.find((x) => x.id === id)
  if (!p) throw new Error(`no preset ${id}`)
  return p.spec
}

/** Every preset, both extremes and a couple of odd mixes: together they cover the macro space. */
export const BODIES: Array<[string, AvatarSpec]> = [
  ...PRESETS.map((p): [string, AvatarSpec] => [p.id, p.spec]),
  ['smallest', SMALLEST],
  ['biggest', BIGGEST],
  ['short, heavy, muscular', normalizeSpec({ macros: { Gender: 0.7, Height: 0.2, Weight: 1, Muscle: 1 } })],
  ['tall, slight, long legs', normalizeSpec({ macros: { Gender: 0.3, Height: 0.8, Weight: 0, Muscle: 0 }, modifiers: { 'measure/measure-upperleg-height-decr|incr': 1 } })],
]

/** Loads the MakeHuman assets every test body uses (the geometry build reads them synchronously). */
export async function preloadBodies(bodies: Array<[string, AvatarSpec]> = BODIES): Promise<void> {
  for (const [, s] of bodies) await preloadAssets(s)
}

/** How many triangles use each edge (key: lo * nVerts + hi). */
export function edgeUse(indices: Uint32Array, nVerts: number): Map<number, number> {
  const m = new Map<number, number>()
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k], b = indices[t + ((k + 1) % 3)]
      const key = Math.min(a, b) * nVerts + Math.max(a, b)
      m.set(key, (m.get(key) ?? 0) + 1)
    }
  }
  return m
}

export const vec = (p: ArrayLike<number>, i = 0): Vector3 => new Vector3(p[i], p[i + 1], p[i + 2])

/**
 * Babylon's DynamicTexture needs a 2D canvas; Node has none. This one accepts every drawing call and draws
 * nothing, which is all the avatar tests need.
 */
export function installFakeCanvas(): void {
  const g = globalThis as { OffscreenCanvas?: unknown }
  if (g.OffscreenCanvas) return
  const context = (canvas: unknown): unknown => {
    const known: Record<string | symbol, unknown> = {
      canvas,
      measureText: () => ({ width: 0 }),
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
      createPattern: () => ({}),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    }
    return new Proxy(known, {
      get: (t, k) => (k in t ? t[k] : () => undefined),
      set: (t, k, v) => {
        t[k] = v
        return true
      },
    })
  }
  g.OffscreenCanvas = class {
    width: number
    height: number
    constructor(width: number, height: number) {
      this.width = width
      this.height = height
    }
    getContext(): unknown {
      return context(this)
    }
  }
}
