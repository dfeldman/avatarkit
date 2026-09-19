/**
 * Motion clips (Quaternius' Universal Animation Library, CC0: tools/mkclips.mjs → public/mh/anim/ual.json) played on
 * our rig, for any body.
 *
 * A clip stores, per frame, each bone's world rotation relative to the source's rest pose, and the hips' movement.
 * For one of our bodies, each arm and leg bone first turns from its own rest direction to the source's (our rest is
 * an A-pose with straight limbs, the source's a T-pose), then takes the clip's rotation; local rotations follow down
 * the hierarchy. The trunk, neck, head and shoulders take the clip's rotation as it is: both skeletons stand upright
 * there, and their bones differ only in how they are drawn (Rigify's pelvis bone leans 40° from ours, its shoulder
 * bone runs back from the sternum), so turning ours onto theirs would tip the pelvis and push the chest forward.
 * The hips' movement is scaled by hip height.
 */
import { Quaternion, Vector3 } from '@babylonjs/core'
import { readJson } from '../body/mhassets.ts'
import { BONES, PARENT, type BodyBone, type Rig } from '../body/rig.ts'
import type { Pose } from './pose.ts'

export interface Clip {
  frames: number
  loop: boolean
  /** per frame, per bone (ClipSet.bones order): x, y, z, w */
  rot: number[]
  /** per frame: the hips' movement from rest, x, y, z (metres, for the source's hip height) */
  hips: number[]
}

export interface ClipSet {
  source: string
  fps: number
  bones: BodyBone[]
  /** the source's rest direction per bone (world, unit) */
  restDirs: Record<BodyBone, [number, number, number]>
  hipHeight: number
  clips: Record<string, Clip>
}

let setP: Promise<ClipSet> | null = null
/** The clip library (fetched once, on first use). */
export function loadClips(): Promise<ClipSet> {
  return (setP ??= readJson<ClipSet>('anim/ual.json'))
}

// each bone's direction: toward its child's joint; leaves continue their parent's (as tools/mkclips.mjs)
const TIP: Partial<Record<BodyBone, BodyBone>> = {
  hips: 'spine', spine: 'chest', chest: 'neck', neck: 'head',
  'shoulder.R': 'upperArm.R', 'upperArm.R': 'forearm.R', 'forearm.R': 'hand.R',
  'shoulder.L': 'upperArm.L', 'upperArm.L': 'forearm.L', 'forearm.L': 'hand.L',
  'thigh.R': 'shin.R', 'shin.R': 'foot.R', 'foot.R': 'toes.R',
  'thigh.L': 'shin.L', 'shin.L': 'foot.L', 'foot.L': 'toes.L',
}
const LEAF_FROM: Partial<Record<BodyBone, BodyBone>> = { head: 'neck', 'hand.R': 'forearm.R', 'hand.L': 'forearm.L', 'toes.R': 'foot.R', 'toes.L': 'foot.L' }
/** bones whose rest pose differs between the skeletons (T-pose arms, and legs), so need turning onto the source's */
const LIMBS = new Set<BodyBone>(['upperArm', 'forearm', 'hand', 'thigh', 'shin', 'foot', 'toes'].flatMap((b) => [`${b}.L`, `${b}.R`] as BodyBone[]))

/** A clip library fitted to one body. */
export class ClipRetarget {
  private readonly align = new Map<BodyBone, Quaternion>()
  private readonly slot = new Map<BodyBone, number>()
  private readonly hipScale: number
  private readonly world = new Map<BodyBone, Quaternion>()
  private readonly qa = new Quaternion()
  private readonly qb = new Quaternion()

  readonly set: ClipSet

  constructor(set: ClipSet, rig: Rig) {
    this.set = set
    set.bones.forEach((b, i) => this.slot.set(b, i))
    const J = rig.joints as Record<string, [number, number, number]>
    for (const b of BONES) {
      const from = LEAF_FROM[b] ?? b, to = LEAF_FROM[b] ? b : TIP[b]!
      const ours = new Vector3(J[to][0] - J[from][0], J[to][1] - J[from][1], J[to][2] - J[from][2]).normalize()
      const theirs = Vector3.FromArray(set.restDirs[b]).normalize()
      const q = new Quaternion()
      if (LIMBS.has(b)) Quaternion.FromUnitVectorsToRef(ours, theirs, q)
      this.align.set(b, q)
      this.world.set(b, new Quaternion())
    }
    this.hipScale = J.hips[1] / set.hipHeight
  }

  has(name: string): boolean {
    return name in this.set.clips
  }

  /** Length of a clip, seconds. */
  duration(name: string): number {
    const c = this.set.clips[name]
    return c ? c.frames / this.set.fps : 0
  }

  /** The clip's pose at time t (seconds; loops wrap, others hold their last frame) into `out`. */
  pose(out: Pose, name: string, t: number): void {
    const c = this.set.clips[name]
    if (!c) return
    const n = this.set.bones.length
    let f = t * this.set.fps
    f = c.loop ? ((f % c.frames) + c.frames) % c.frames : Math.max(0, Math.min(c.frames - 1, f))
    const f0 = Math.floor(f), f1 = c.loop ? (f0 + 1) % c.frames : Math.min(c.frames - 1, f0 + 1), u = f - f0
    for (const b of BONES) {
      const k = this.slot.get(b)!
      const a = 4 * (f0 * n + k), z = 4 * (f1 * n + k)
      this.qa.set(c.rot[a], c.rot[a + 1], c.rot[a + 2], c.rot[a + 3])
      this.qb.set(c.rot[z], c.rot[z + 1], c.rot[z + 2], c.rot[z + 3])
      const w = this.world.get(b)!
      Quaternion.SlerpToRef(this.qa, this.qb, u, w)
      // the clip's rotation, after turning our rest direction onto the source's
      w.multiplyToRef(this.align.get(b)!, w)
      const p = PARENT[b]
      const local = out.get(b)
      if (p) Quaternion.InverseToRef(this.world.get(p)!, local).multiplyToRef(w, local)
      else local.copyFrom(w)
    }
    const h0 = 3 * f0, h1 = 3 * f1
    out.hipsOffset.set(
      (c.hips[h0] + (c.hips[h1] - c.hips[h0]) * u) * this.hipScale,
      (c.hips[h0 + 1] + (c.hips[h1 + 1] - c.hips[h0 + 1]) * u) * this.hipScale,
      (c.hips[h0 + 2] + (c.hips[h1 + 2] - c.hips[h0 + 2]) * u) * this.hipScale,
    )
  }
}
