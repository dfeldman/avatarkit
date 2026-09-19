/** Rest skeleton data, the Pose type, blending and forward kinematics (all in character space). */
import { Quaternion, Vector3 } from '@babylonjs/core'
import { BONES, PARENT, type Rig } from '../body/rig.ts'
import { nlerp, rotate } from './qmath.ts'

export class RestSkeleton {
  readonly names: string[] = []
  readonly parent: number[] = []
  readonly restPos: Vector3[] = []
  /** rest offset from the parent joint */
  readonly offset: Vector3[] = []
  readonly index = new Map<string, number>()

  readonly rig: Rig

  constructor(rig: Rig) {
    this.rig = rig
    const add = (name: string, parent: string | null, p: readonly number[]): void => {
      const i = this.names.length
      this.names.push(name)
      this.index.set(name, i)
      const pi = parent === null ? -1 : this.index.get(parent)!
      this.parent.push(pi)
      const pos = new Vector3(p[0], p[1], p[2])
      this.restPos.push(pos)
      this.offset.push(pi < 0 ? pos.clone() : pos.subtract(this.restPos[pi]))
    }
    for (const b of BONES) add(b, PARENT[b], rig.joints[b])
  }

  i(name: string): number {
    const i = this.index.get(name)
    if (i === undefined) throw new Error(`no bone ${name}`)
    return i
  }

  pos(name: string): Vector3 {
    return this.restPos[this.i(name)]
  }
}

export class Pose {
  /** local rotation per bone name */
  readonly rotations = new Map<string, Quaternion>()
  /** hips position relative to its rest position */
  readonly hipsOffset = new Vector3()

  constructor(names: readonly string[]) {
    for (const n of names) this.rotations.set(n, Quaternion.Identity())
  }

  get(name: string): Quaternion {
    return this.rotations.get(name)!
  }

  set(name: string, q: Quaternion): void {
    this.rotations.get(name)?.copyFrom(q)
  }

  reset(): void {
    for (const q of this.rotations.values()) q.set(0, 0, 0, 1)
    this.hipsOffset.setAll(0)
  }

  copyFrom(p: Pose): this {
    for (const [n, q] of p.rotations) this.rotations.get(n)?.copyFrom(q)
    this.hipsOffset.copyFrom(p.hipsOffset)
    return this
  }

  /** this = lerp(this, other, t) */
  blend(other: Pose, t: number): this {
    if (t <= 0) return this
    if (t >= 1) return this.copyFrom(other)
    for (const [n, q] of this.rotations) {
      const o = other.rotations.get(n)
      if (o) nlerp(q, o, t, q)
    }
    Vector3.LerpToRef(this.hipsOffset, other.hipsOffset, t, this.hipsOffset)
    return this
  }
}

/** World (character space) rotation and position of every bone for a pose. */
export class FK {
  readonly rot: Quaternion[]
  readonly pos: Vector3[]
  readonly rest: RestSkeleton
  constructor(rest: RestSkeleton) {
    this.rest = rest
    this.rot = rest.names.map(() => Quaternion.Identity())
    this.pos = rest.names.map(() => Vector3.Zero())
  }

  run(pose: Pose): this {
    const r = this.rest
    for (let i = 0; i < r.names.length; i++) {
      const local = pose.rotations.get(r.names[i])!
      const p = r.parent[i]
      if (p < 0) {
        this.rot[i].copyFrom(local)
        r.restPos[i].addToRef(pose.hipsOffset, this.pos[i])
      } else {
        this.rot[p].multiplyToRef(local, this.rot[i])
        rotate(this.rot[p], r.offset[i], this.pos[i]).addInPlace(this.pos[p])
      }
    }
    return this
  }

  /** World rotation/position of one bone, walking only its ancestors (cheaper than run for a single query). */
  static chain(rest: RestSkeleton, pose: Pose, name: string, outRot = new Quaternion(), outPos = new Vector3()): { rot: Quaternion; pos: Vector3 } {
    const path: number[] = []
    for (let i = rest.i(name); i >= 0; i = rest.parent[i]) path.push(i)
    path.reverse()
    outRot.set(0, 0, 0, 1)
    outPos.setAll(0)
    for (const i of path) {
      const local = pose.rotations.get(rest.names[i])!
      if (rest.parent[i] < 0) {
        outRot.copyFrom(local)
        rest.restPos[i].addToRef(pose.hipsOffset, outPos)
      } else {
        outPos.addInPlace(rotate(outRot, rest.offset[i]))
        outRot.multiplyToRef(local, outRot)
      }
    }
    return { rot: outRot, pos: outPos }
  }
}
