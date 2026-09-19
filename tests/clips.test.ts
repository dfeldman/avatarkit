import { describe, expect, it } from 'vitest'
import { Animator } from '../src/anim/animator.ts'
import { ClipRetarget, loadClips } from '../src/anim/clips.ts'
import { Pose } from '../src/anim/pose.ts'
import { buildAvatarGeometry } from '../src/body/build.ts'
import { BONES } from '../src/body/rig.ts'
import { HAND_POSES } from '../src/anim/hands.ts'
import { MOVES } from '../src/anim/moves.ts'
import { BODIES, preloadBodies } from './helpers.ts'

await preloadBodies()
const set = await loadClips()

describe("Quaternius' motion clips", () => {
  it('cover the whole library, every bone, every frame', () => {
    expect(Object.keys(set.clips).length).toBeGreaterThanOrEqual(45)
    for (const b of BONES) expect(set.bones).toContain(b)
    for (const [name, c] of Object.entries(set.clips)) {
      expect(c.rot.length, name).toBe(c.frames * set.bones.length * 4)
      expect(c.hips.length, name).toBe(c.frames * 3)
    }
  })

  it('retarget onto every body: unit rotations, and the hips moving in proportion', () => {
    for (const [, spec] of BODIES) {
      const rig = buildAvatarGeometry(spec).rig
      const r = new ClipRetarget(set, rig)
      const pose = new Pose(BONES)
      for (const name of ['Idle_Loop', 'Walk_Loop', 'Sprint_Loop', 'Dance_Loop', 'Jump_Start']) {
        for (const t of [0, 0.3, 0.71, 1.9]) {
          r.pose(pose, name, t)
          for (const b of BONES) {
            const q = pose.get(b)
            expect(Math.hypot(q.x, q.y, q.z, q.w), `${name} ${b}`).toBeCloseTo(1, 3)
          }
          // (in place: a walk's hips bob a few centimetres, scaled to this body's legs)
          if (name === 'Walk_Loop') expect(Math.abs(pose.hipsOffset.y)).toBeLessThan(0.15 * rig.joints.hips[1])
        }
      }
    }
  })

  it("keep the trunk as the clip holds it: the source's T-pose stands our body upright", () => {
    const rig = buildAvatarGeometry(BODIES[0][1]).rig
    const r = new ClipRetarget(set, rig)
    const pose = new Pose(BONES)
    r.pose(pose, 'A_TPose', 0)
    // (Rigify's pelvis bone leans 40° from ours: turning ours onto it tipped the pelvis and pushed the chest forward)
    for (const b of ['hips', 'spine', 'chest', 'neck', 'shoulder.L', 'shoulder.R'] as const) {
      const q = pose.get(b)
      expect(2 * Math.acos(Math.min(1, Math.abs(q.w))), b).toBeLessThan(0.12)
    }
  })

  it('play over the procedural motion, fading in, and fade back out when stopped or finished', () => {
    const rig = buildAvatarGeometry(BODIES[0][1]).rig
    const a = new Animator()
    a.bind(rig)
    a.useClips(set)
    const still = a.update(1 / 60).get('upperArm.R').clone()
    a.play('Jump_Start')
    expect(a.playing).toBe('Jump_Start')
    for (let i = 0; i < 20; i++) a.update(1 / 60)
    expect(a.update(1 / 60).get('upperArm.R').equalsWithEpsilon(still, 1e-3)).toBe(false)
    // a one-shot clip ends by itself
    for (let i = 0; i < 60 * 3; i++) a.update(1 / 60)
    expect(a.playing).toBe(null)
    expect(() => a.play('No_Such_Clip')).toThrow()
  })

  it('play a list in order, each running straight into the next', () => {
    const a = new Animator()
    a.bind(buildAvatarGeometry(BODIES[0][1]).rig)
    a.useClips(set)
    a.play(['Jump_Start', 'Jump_Land'])
    const start = set.clips.Jump_Start.frames / set.fps
    for (let t = 0; t < start + 0.1; t += 1 / 60) a.update(1 / 60)
    expect(a.playing).toBe('Jump_Land')
    for (let i = 0; i < 60 * 2; i++) a.update(1 / 60)
    expect(a.playing).toBe(null)
  })
})

describe('moves', () => {
  it('name real clips and hand poses, each id once', () => {
    expect(new Set(MOVES.map((m) => m.id)).size).toBe(MOVES.length)
    for (const m of MOVES) {
      expect(m.clips.length, m.id).toBeGreaterThan(0)
      for (const c of m.clips) expect(set.clips[c], `${m.id}: ${c}`).toBeDefined()
      expect(HAND_POSES).toContain(m.hands)
    }
  })
})
