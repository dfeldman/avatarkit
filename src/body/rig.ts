/**
 * The skeleton our animation drives, and the measurements it reads. Character space: metres, +Y up, the avatar
 * faces +Z, its right side is +X, feet on y = 0. Every bone's rest rotation is identity (a bone is just an offset
 * from its parent), so animation code can reason in character axes. The MakeHuman body (mhbody.ts) fills a Rig from
 * its own joints and mesh.
 */
import type { V3 } from './vec.ts'

export const BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'shoulder.L', 'upperArm.L', 'forearm.L', 'hand.L',
  'shoulder.R', 'upperArm.R', 'forearm.R', 'hand.R',
  'thigh.L', 'shin.L', 'foot.L', 'toes.L',
  'thigh.R', 'shin.R', 'foot.R', 'toes.R',
] as const
export type BodyBone = (typeof BONES)[number]

export const PARENT: Record<BodyBone, BodyBone | null> = {
  hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  'shoulder.L': 'chest', 'upperArm.L': 'shoulder.L', 'forearm.L': 'upperArm.L', 'hand.L': 'forearm.L',
  'shoulder.R': 'chest', 'upperArm.R': 'shoulder.R', 'forearm.R': 'upperArm.R', 'hand.R': 'forearm.R',
  'thigh.L': 'hips', 'shin.L': 'thigh.L', 'foot.L': 'shin.L', 'toes.L': 'foot.L',
  'thigh.R': 'hips', 'shin.R': 'thigh.R', 'foot.R': 'shin.R', 'toes.R': 'foot.R',
}

export type Side = 'L' | 'R'
/** +1 for the right side (+X), -1 for the left. */
export const sideSign = (s: Side): number => (s === 'R' ? 1 : -1)

export interface Rig {
  /** standing height, crown to sole (m) */
  height: number
  /** height / 1.72: the average adult is 1 */
  s: number
  /** MakeHuman's Muscle and Weight macros (0..1): the gait and arm swing read them */
  muscle: number
  build: number
  joints: Record<BodyBone, V3>
  /** rest direction of the right arm (shoulder -> wrist), unit, straight; the left arm is mirrored */
  armDir: V3
  /** rest direction of the right leg (hip -> ankle), unit, straight */
  legDir: V3
  upperArmLen: number
  forearmLen: number
  handLen: number
  thighLen: number
  shinLen: number
  footLen: number
  /** ankle joint height above the sole */
  ankleH: number
  /** rest angles of the arm and leg from vertical (radians) */
  armAngle: number
  legAngle: number
  headH: number
  /** cranium centre and radii (x, y, z) */
  headCenter: V3
  headR: V3
  chinY: number
  eyeY: number
  shoulderHalf: number
  hipHalf: number
  /** how far out the hips reach (for arm clearance) */
  hipOuter: number
  crotchY: number
  /** how far the chest stands in front of the shoulder joints (m): a deep chest needs the arms to swing wider */
  chestDepth: number
  /** the torso's half-width, sampled every `step` metres from y = y0 (arms excluded) */
  torso: { y0: number; step: number; w: number[] }
}

/** The torso's half-width at height y (the widest point of the trunk there, arms excluded). */
export function torsoHalfWidth(rig: Rig, y: number): number {
  const { y0, step, w } = rig.torso
  const f = (y - y0) / step
  const i = Math.max(0, Math.min(w.length - 2, Math.floor(f)))
  const t = Math.max(0, Math.min(1, f - i))
  return w[i] + (w[i + 1] - w[i]) * t
}
