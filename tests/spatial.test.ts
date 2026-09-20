import { describe, expect, it } from 'vitest'
import { pickNext, type Rect } from '../src/designer/spatial.ts'

const r = (x: number, y: number, w = 100, h = 40): Rect => ({ x, y, w, h })

describe('pickNext', () => {
  it('walks down a column rather than hopping to a nearer neighbour beside it', () => {
    const from = r(0, 0)
    // a control directly below, and one that is closer as the crow flies but off to the side
    const below = r(0, 60)
    const aside = r(140, 20)
    expect(pickNext(from, [below, aside], 'down')).toBe(0)
  })
  it('goes along a row left and right, and stops at the ends', () => {
    const a = r(0, 0, 40, 40), b = r(50, 0, 40, 40), c = r(100, 0, 40, 40)
    expect(pickNext(b, [a, c], 'right')).toBe(1)
    expect(pickNext(b, [a, c], 'left')).toBe(0)
    expect(pickNext(c, [a, b], 'right')).toBe(-1)
    expect(pickNext(a, [b, c], 'left')).toBe(-1)
  })
  it('never picks something that is not in that direction', () => {
    const from = r(0, 100)
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      const i = pickNext(from, [r(0, 100)], dir)
      expect(i, `${dir} onto itself`).toBe(-1)
    }
  })
  it('has nothing to pick from an empty list', () => {
    expect(pickNext(r(0, 0), [], 'down')).toBe(-1)
  })
  it('prefers the nearest row below, not the nearest centre', () => {
    const from = r(0, 0, 200, 40)
    const nextRow = r(150, 50, 40, 40)      // just below, off to the right
    const farRow = r(0, 400, 200, 40)       // dead ahead but far away
    expect(pickNext(from, [nextRow, farRow], 'down')).toBe(0)
  })
})
