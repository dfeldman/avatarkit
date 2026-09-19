/** Analytic two-bone IK (hip-knee-ankle, shoulder-elbow-wrist). */
import { Quaternion, Vector3 } from '@babylonjs/core'
import { frameRotation } from './qmath.ts'

export interface TwoBoneResult {
  /** middle joint (knee / elbow) */
  mid: Vector3
  /** where the end actually lands (the target, pulled in if out of reach) */
  end: Vector3
  /** world rotations for the upper and lower bone */
  upper: Quaternion
  lower: Quaternion
  reached: boolean
}

/**
 * root: upper joint position; target: where the end joint should go; pole: the direction the middle joint
 * should point (need not be perpendicular). restDir: the (straight) rest direction of both bones;
 * restHinge: the rest axis the middle joint bends about, i.e. cross(restDir, restPole).
 */
export function solveTwoBone(
  root: Vector3, target: Vector3, l1: number, l2: number, pole: Vector3,
  restDir1: Vector3, restDir2: Vector3, restHinge: Vector3, maxStretch = 0.999,
): TwoBoneResult {
  const toT = target.subtract(root)
  let d = toT.length()
  const dir = d > 1e-9 ? toT.scale(1 / d) : new Vector3(0, -1, 0)
  const maxD = (l1 + l2) * maxStretch
  const minD = Math.abs(l1 - l2) + 1e-4
  const reached = d <= maxD && d >= minD
  d = Math.min(maxD, Math.max(minD, d))
  let perp = pole.subtract(dir.scale(Vector3.Dot(pole, dir)))
  if (perp.lengthSquared() < 1e-10) {
    perp = Vector3.Cross(dir, new Vector3(1, 0, 0))
    if (perp.lengthSquared() < 1e-10) perp = Vector3.Cross(dir, new Vector3(0, 0, 1))
  }
  perp.normalize()
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x))
  const mid = root.add(dir.scale(x)).add(perp.scale(h))
  const end = root.add(dir.scale(d))
  const hinge = Vector3.Cross(dir, perp).normalize()
  const upper = frameRotation(restDir1, restHinge, mid.subtract(root), hinge)
  const lower = frameRotation(restDir2, restHinge, end.subtract(mid), hinge)
  return { mid, end, upper, lower, reached }
}
