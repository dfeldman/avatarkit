/**
 * LOUNGING: the poses of people on a beach or a lawn (Street Runner, 2026-10-06: "people lounging on the beach … rather
 * than standing or walking"). The clip library has standing, walking and sitting on a chair, and nothing on the ground,
 * so these are DERIVED from it when it loads, and played like any other clip (`animator.play('Lie_Back_Loop')`):
 *
 *  - `Lie_Back_Loop`   flat on the back: the standing idle turned a quarter over, face to the sky, arms at the sides;
 *  - `Lie_Front_Loop`  face down, the arms folded up under the head as a pillow;
 *  - `Sit_Ground_Loop` sitting on the ground, legs out straight: the chair sit with its shins swung in line with the thighs;
 *  - `Sit_Knees_Loop`  sitting with the knees drawn up, the feet flat near the seat.
 *
 * A clip stores each bone's WORLD rotation relative to the source's rest (a T-pose facing +z), and the hips' movement in
 * the source's metres, so a whole-body turn is one rotation pre-multiplied onto every bone, and lying down is that plus
 * the hips lowered to the ground. The idle's own sway rides along, so a lounger breathes rather than freezing. In the
 * character's frame a lying body's head points to −z (on its back) or +z (on its front), its hips at the origin.
 */
import { Quaternion, Vector3 } from '@babylonjs/core'
import type { Clip, ClipSet } from './clips.ts'

/** the hip joint's height over the ground in each pose, metres (the source's hip height is ~0.92) */
const LYING_HIPS = 0.11
const SITTING_HIPS = 0.13

function frameQuats(set: ClipSet, c: Clip, f: number): Map<string, Quaternion> {
  const n = set.bones.length
  const out = new Map<string, Quaternion>()
  set.bones.forEach((b, k) => {
    const a = 4 * (f * n + k)
    out.set(b, new Quaternion(c.rot[a], c.rot[a + 1], c.rot[a + 2], c.rot[a + 3]))
  })
  return out
}

/** Build a clip by rewriting each frame of `src` (bones' world rotations, and the hips' offset) with `fn`. */
function derive(set: ClipSet, src: Clip, fn: (q: Map<string, Quaternion>, hips: Vector3) => void): Clip {
  const n = set.bones.length
  const rot: number[] = new Array(src.frames * n * 4)
  const hips: number[] = new Array(src.frames * 3)
  for (let f = 0; f < src.frames; f++) {
    const q = frameQuats(set, src, f)
    const h = new Vector3(src.hips[3 * f], src.hips[3 * f + 1], src.hips[3 * f + 2])
    fn(q, h)
    set.bones.forEach((b, k) => {
      const v = q.get(b)!.normalize()
      rot[4 * (f * n + k)] = v.x; rot[4 * (f * n + k) + 1] = v.y; rot[4 * (f * n + k) + 2] = v.z; rot[4 * (f * n + k) + 3] = v.w
    })
    hips[3 * f] = h.x; hips[3 * f + 1] = h.y; hips[3 * f + 2] = h.z
  }
  return { frames: src.frames, loop: true, rot, hips }
}

/** the world rotation that turns the source's rest direction of `bone` to `dir` (the source frame) */
function aim(set: ClipSet, bone: string, dir: Vector3): Quaternion {
  const rest = Vector3.FromArray(set.restDirs[bone as keyof typeof set.restDirs]).normalize()
  const q = new Quaternion()
  Quaternion.FromUnitVectorsToRef(rest, dir.normalize(), q)
  return q
}

/** Add the lounging clips to a loaded library (idempotent). */
export function addLoungeClips(set: ClipSet): ClipSet {
  const idle = set.clips.Idle_Loop
  const sit = set.clips.Sitting_Idle_Loop
  if (!idle || !sit || set.clips.Lie_Back_Loop) return set
  const H = set.hipHeight
  const X = new Vector3(1, 0, 0)

  // the idle's stance (weight on one leg, the other knee bent) would lift a foot off the ground once lying, so the legs
  // are set straight and a little apart; `point` is the foot: forward (toes up, lying on the back) or pointed (on the front)
  const legsOut = (q: Map<string, Quaternion>, point: Vector3): void => {
    for (const s of [1, -1]) {
      const side = s > 0 ? 'R' : 'L'
      q.set(`thigh.${side}`, aim(set, `thigh.${side}`, new Vector3(s * 0.09, -1, 0)))
      q.set(`shin.${side}`, aim(set, `shin.${side}`, new Vector3(s * 0.05, -1, 0.02)))
      q.set(`foot.${side}`, aim(set, `foot.${side}`, new Vector3(s * 0.15 + point.x, point.y, point.z)))
      q.set(`toes.${side}`, aim(set, `toes.${side}`, new Vector3(s * 0.15 + point.x, point.y, point.z)))
    }
  }

  // on the back: a quarter turn about x, the head to −z and the face up
  const back = Quaternion.RotationAxis(X, -Math.PI / 2)
  set.clips.Lie_Back_Loop = derive(set, idle, (q, h) => {
    legsOut(q, new Vector3(0, -0.25, 1))
    for (const [b, v] of q) q.set(b, back.multiply(v))
    h.set(0, LYING_HIPS - H, 0)
  })

  // on the front: the other way, and the arms up over the head with the forearms crossed under the chin
  const front = Quaternion.RotationAxis(X, Math.PI / 2)
  set.clips.Lie_Front_Loop = derive(set, idle, (q, h) => {
    for (const s of [1, -1]) {
      const side = s > 0 ? 'R' : 'L'
      // (source frame, standing, the right side +x: up and a little out, then the forearm folded back across in front)
      q.set(`upperArm.${side}`, aim(set, `upperArm.${side}`, new Vector3(s * 0.42, 0.9, 0.12)))
      q.set(`forearm.${side}`, aim(set, `forearm.${side}`, new Vector3(-s * 0.92, 0.1, 0.38)))
      q.set(`hand.${side}`, aim(set, `hand.${side}`, new Vector3(-s * 0.92, 0.1, 0.38)))
    }
    legsOut(q, new Vector3(0, -1, -0.35))
    for (const [b, v] of q) q.set(b, front.multiply(v))
    h.set(0, LYING_HIPS + 0.03 - H, 0)
  })

  // sitting, legs out straight: the chair sit's thighs, its shins and feet swung into line with them
  const straighten = (q: Map<string, Quaternion>, side: string): void => {
    const thigh = q.get(`thigh.${side}`)!, shin = q.get(`shin.${side}`)!, foot = q.get(`foot.${side}`)!, toes = q.get(`toes.${side}`)!
    const turn = thigh.multiply(Quaternion.Inverse(shin))
    q.set(`shin.${side}`, thigh.clone())
    const f2 = turn.multiply(foot)
    q.set(`toes.${side}`, f2.multiply(Quaternion.Inverse(foot)).multiply(toes))
    q.set(`foot.${side}`, f2)
  }
  set.clips.Sit_Ground_Loop = derive(set, sit, (q, h) => {
    straighten(q, 'L'); straighten(q, 'R')
    h.set(h.x, SITTING_HIPS - H, h.z)
  })

  // sitting, knees up: the thighs raised to about 50° and the shins angled back down to feet near the seat
  set.clips.Sit_Knees_Loop = derive(set, sit, (q, h) => {
    for (const s of [1, -1]) {
      const side = s > 0 ? 'R' : 'L'
      q.set(`thigh.${side}`, aim(set, `thigh.${side}`, new Vector3(s * 0.14, 0.62, 0.77)))
      q.set(`shin.${side}`, aim(set, `shin.${side}`, new Vector3(s * 0.04, -0.93, 0.36)))
      q.set(`foot.${side}`, aim(set, `foot.${side}`, new Vector3(0, -0.2, 1)))
      q.set(`toes.${side}`, aim(set, `toes.${side}`, new Vector3(0, -0.2, 1)))
    }
    h.set(h.x, SITTING_HIPS - H, h.z)
  })
  return set
}

/** The lounging clips' names, for a game choosing one. */
export const LOUNGE_CLIPS = ['Lie_Back_Loop', 'Lie_Front_Loop', 'Sit_Ground_Loop', 'Sit_Knees_Loop'] as const
