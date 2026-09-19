/** Tiny tuple maths for the geometry pipeline (no Babylon, so it runs in workers and plain node tests). */
export type V3 = [number, number, number]

export const v3 = (x = 0, y = 0, z = 0): V3 => [x, y, z]
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2])
export const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
export const norm = (a: V3): V3 => {
  const l = len(a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
export const lerpV = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
/** a + dir * s */
export const along = (a: V3, dir: V3, s: number): V3 => [a[0] + dir[0] * s, a[1] + dir[1] * s, a[2] + dir[2] * s]
/** Mirror across the body's midplane (x -> -x). */
export const mirror = (a: V3): V3 => [-a[0], a[1], a[2]]
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x)
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Rotate v about a unit axis by angle (right-hand rule in maths terms, the same formula Babylon uses). */
export function rotate(v: V3, axis: V3, angle: number): V3 {
  const c = Math.cos(angle), s = Math.sin(angle)
  const k = dot(axis, v) * (1 - c)
  const x = cross(axis, v)
  return [v[0] * c + x[0] * s + axis[0] * k, v[1] * c + x[1] * s + axis[1] * k, v[2] * c + x[2] * s + axis[2] * k]
}

/** Two unit vectors perpendicular to d: `v` follows `hint` (projected), `u` completes the frame. */
export function frameFor(d: V3, hint: V3 = [0, 0, 1]): { u: V3; v: V3 } {
  let v = sub(hint, scale(d, dot(hint, d)))
  if (len(v) < 1e-6) v = sub([0, 1, 0], scale(d, d[1]))
  v = norm(v)
  const u = norm(cross(v, d))
  return { u, v }
}
