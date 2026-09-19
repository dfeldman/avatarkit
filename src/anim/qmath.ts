/**
 * Rotation helpers on Babylon's math types. Conventions (checked in tests): q.rotate(v) = q v q*, and a child's
 * world rotation is parentWorld.multiply(local), which is how TransformNode hierarchies compose.
 */
import { Quaternion, Vector3 } from '@babylonjs/core'

export const X = (): Vector3 => new Vector3(1, 0, 0)
export const Y = (): Vector3 => new Vector3(0, 1, 0)
export const Z = (): Vector3 => new Vector3(0, 0, 1)

export function rotate(q: Quaternion, v: Vector3, out = new Vector3()): Vector3 {
  return v.rotateByQuaternionToRef(q, out)
}

/** Shortest rotation taking direction a to direction b (both need not be unit). */
export function fromTo(a: Vector3, b: Vector3, out = new Quaternion()): Quaternion {
  const an = a.normalizeToNew(), bn = b.normalizeToNew()
  const d = Vector3.Dot(an, bn)
  if (d < -0.999999) {
    // opposite: any perpendicular axis
    let axis = Vector3.Cross(new Vector3(1, 0, 0), an)
    if (axis.lengthSquared() < 1e-6) axis = Vector3.Cross(new Vector3(0, 1, 0), an)
    return Quaternion.RotationAxisToRef(axis.normalize(), Math.PI, out)
  }
  Quaternion.FromUnitVectorsToRef(an, bn, out)
  return out
}

/**
 * Rotation that takes the frame (a1, a2) to (b1, b2): a1 goes exactly to b1, and a2 (made perpendicular to a1)
 * goes as close to b2 as it can while staying perpendicular to b1.
 */
export function frameRotation(a1: Vector3, a2: Vector3, b1: Vector3, b2: Vector3, out = new Quaternion()): Quaternion {
  const q1 = fromTo(a1, b1)
  const b1n = b1.normalizeToNew()
  const a2r = rotate(q1, a2)
  const a2p = a2r.subtract(b1n.scale(Vector3.Dot(a2r, b1n)))
  const b2p = b2.subtract(b1n.scale(Vector3.Dot(b2, b1n)))
  if (a2p.lengthSquared() < 1e-10 || b2p.lengthSquared() < 1e-10) return out.copyFrom(q1)
  const angle = Math.atan2(Vector3.Dot(Vector3.Cross(a2p, b2p), b1n), Vector3.Dot(a2p, b2p))
  const q2 = Quaternion.RotationAxis(b1n, angle)
  return q2.multiplyToRef(q1, out)
}

export function axisAngle(axis: Vector3, angle: number, out = new Quaternion()): Quaternion {
  return Quaternion.RotationAxisToRef(axis.normalizeToNew(), angle, out)
}

/** Euler-ish helper for small body rotations in character axes: yaw about Y, then pitch about X, then roll about Z. */
export function ypr(yaw: number, pitch: number, roll: number, out = new Quaternion()): Quaternion {
  const qy = Quaternion.RotationAxis(new Vector3(0, 1, 0), yaw)
  const qx = Quaternion.RotationAxis(new Vector3(1, 0, 0), pitch)
  const qz = Quaternion.RotationAxis(new Vector3(0, 0, 1), roll)
  return qy.multiply(qx).multiplyToRef(qz, out)
}

/** local = inverse(parentWorld) * world */
export function toLocal(parentWorld: Quaternion, world: Quaternion, out = new Quaternion()): Quaternion {
  return Quaternion.Inverse(parentWorld).multiplyToRef(world, out)
}

/** Normalised lerp that takes the short way round. */
export function nlerp(a: Quaternion, b: Quaternion, t: number, out = new Quaternion()): Quaternion {
  const s = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1
  out.set(a.x + (b.x * s - a.x) * t, a.y + (b.y * s - a.y) * t, a.z + (b.z * s - a.z) * t, a.w + (b.w * s - a.w) * t)
  return out.normalize()
}

export const v = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z)
export const fromV3 = (a: readonly number[]): Vector3 => new Vector3(a[0], a[1], a[2])
