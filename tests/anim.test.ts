import { Quaternion, Vector3 } from '@babylonjs/core'
import { describe, expect, it } from 'vitest'
import { Animator, type Motion, type MotionMode } from '../src/anim/animator.ts'
import { solveTwoBone } from '../src/anim/ik.ts'
import { FK, Pose, RestSkeleton } from '../src/anim/pose.ts'
import { BodyPoser } from '../src/anim/poser.ts'
import { axisAngle, frameRotation, fromTo, nlerp, rotate, toLocal, ypr } from '../src/anim/qmath.ts'
import { buildAvatarGeometry, preloadAssets, type AvatarGeometry } from '../src/body/build.ts'
import { torsoHalfWidth, type Rig, type Side } from '../src/body/rig.ts'
import { makeRng } from '../src/presets.ts'
import { normalizeSpec, type AvatarSpec } from '../src/spec.ts'
import { BIGGEST, BODIES, SMALLEST, preloadBodies, preset } from './helpers.ts'

// the MakeHuman assets the test bodies use (the builds below read them synchronously)
await preloadBodies()
const built = new Map<AvatarSpec, AvatarGeometry>()
const geometry = (spec: AvatarSpec): AvatarGeometry => {
  let g = built.get(spec)
  if (!g) built.set(spec, (g = buildAvatarGeometry(spec)))
  return g
}
const rigOf = (spec: AvatarSpec): Rig => geometry(spec).rig
void BODIES

const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1)
const SIDES: Side[] = ['L', 'R']
const rng = makeRng(42)
function randUnit(): Vector3 {
  for (;;) {
    const v = new Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1)
    if (v.length() > 0.1 && v.length() <= 1) return v.normalize()
  }
}
const randQuat = (): Quaternion => axisAngle(randUnit(), rng() * Math.PI * 2)
const expectNear = (a: Vector3, b: Vector3, eps = 1e-6): void => expect(Vector3.Distance(a, b)).toBeLessThan(eps)
const angle = (a: Vector3, b: Vector3): number => Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(a.normalizeToNew(), b.normalizeToNew()))))

function skeleton(spec: AvatarSpec) {
  const rig = rigOf(spec)
  const rest = new RestSkeleton(rig)
  return { rig, rest, poser: new BodyPoser(rest), pose: new Pose(rest.names), fk: new FK(rest) }
}

describe('rotation conventions', () => {
  it('compose like a TransformNode hierarchy: world = parent * local', () => {
    for (let i = 0; i < 50; i++) {
      const parent = randQuat(), local = randQuat(), v = randUnit()
      expectNear(rotate(parent.multiply(local), v), rotate(parent, rotate(local, v)))
      const world = randQuat()
      expectNear(rotate(parent.multiply(toLocal(parent, world)), v), rotate(world, v))
    }
  })

  it('ypr is yaw about Y of pitch about X of roll about Z, with + pitch tipping forward and down', () => {
    for (let i = 0; i < 20; i++) {
      const [y, p, r] = [rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1]
      const v = randUnit()
      expectNear(rotate(ypr(y, p, r), v), rotate(axisAngle(Y, y), rotate(axisAngle(X, p), rotate(axisAngle(Z, r), v))))
    }
    // a pitched foot points its toes down; a pitched spine leans forward
    expect(rotate(ypr(0, 0.3, 0), Z).y).toBeLessThan(0)
    expect(rotate(ypr(0, 0.3, 0), Y).z).toBeGreaterThan(0)
    // + yaw turns forward toward +X
    expect(rotate(ypr(0.3, 0, 0), Z).x).toBeGreaterThan(0)
  })

  it('fromTo takes a direction onto another, including opposite ones', () => {
    for (let i = 0; i < 50; i++) {
      const a = randUnit().scale(0.5 + rng()), b = randUnit().scale(0.5 + rng())
      expectNear(rotate(fromTo(a, b), a.normalizeToNew()), b.normalizeToNew())
    }
    for (const a of [X, Y, Z, new Vector3(1, 1, 0).normalize()]) {
      expectNear(rotate(fromTo(a, a.scale(-1)), a), a.scale(-1))
      expectNear(rotate(fromTo(a, a), a), a)
    }
  })

  it('frameRotation takes one frame onto another', () => {
    for (let i = 0; i < 50; i++) {
      const a1 = randUnit(), a2 = randUnit(), b1 = randUnit(), b2 = randUnit()
      const q = frameRotation(a1, a2, b1, b2)
      expectNear(rotate(q, a1), b1)
      // the part of a2 across a1 lands on the part of b2 across b1
      const a2p = a2.subtract(a1.scale(Vector3.Dot(a2, a1)))
      const b2p = b2.subtract(b1.scale(Vector3.Dot(b2, b1)))
      expect(angle(rotate(q, a2p), b2p)).toBeLessThan(1e-5)
    }
  })

  it('nlerp goes from a to b the short way', () => {
    for (let i = 0; i < 50; i++) {
      const a = randQuat(), b = randQuat(), v = randUnit()
      expectNear(rotate(nlerp(a, b, 0), v), rotate(a, v))
      expectNear(rotate(nlerp(a, b, 1), v), rotate(b, v))
      const mid = nlerp(a, b, 0.5)
      const whole = Quaternion.Inverse(a).multiply(b)
      const part = Quaternion.Inverse(a).multiply(mid)
      const ang = (q: Quaternion): number => 2 * Math.acos(Math.min(1, Math.abs(q.w)))
      expect(ang(part)).toBeCloseTo(ang(whole) / 2, 6)
      expect(ang(whole)).toBeLessThanOrEqual(Math.PI + 1e-9)
    }
  })
})

describe('two-bone IK', () => {
  const restDir = new Vector3(0, -1, 0)
  const restHinge = Vector3.Cross(restDir, Z)
  const l1 = 0.45, l2 = 0.42
  const root = new Vector3(0.1, 0.9, 0)

  it('lands exactly on reachable targets, bending toward the pole', () => {
    for (let i = 0; i < 200; i++) {
      const target = root.add(randUnit().scale(0.05 + rng() * 0.8))
      const pole = randUnit()
      const r = solveTwoBone(root, target, l1, l2, pole, restDir, restDir, restHinge)
      expect(r.reached).toBe(true)
      expectNear(r.end, target, 1e-9)
      expect(Vector3.Distance(root, r.mid)).toBeCloseTo(l1, 9)
      expect(Vector3.Distance(r.mid, r.end)).toBeCloseTo(l2, 9)
      // the knee sits on the pole's side of the root-target line
      const dir = target.subtract(root).normalize()
      const poleAcross = pole.subtract(dir.scale(Vector3.Dot(pole, dir)))
      const kneeAcross = r.mid.subtract(root).subtract(dir.scale(Vector3.Dot(r.mid.subtract(root), dir)))
      if (poleAcross.length() > 0.05) expect(Vector3.Dot(kneeAcross, poleAcross)).toBeGreaterThanOrEqual(-1e-9)
      // the bone rotations carry the rest bones onto the solved ones, hinge across both
      expect(angle(rotate(r.upper, restDir), r.mid.subtract(root))).toBeLessThan(1e-6)
      expect(angle(rotate(r.lower, restDir), r.end.subtract(r.mid))).toBeLessThan(1e-6)
      for (const [q, bone] of [[r.upper, r.mid.subtract(root)], [r.lower, r.end.subtract(r.mid)]] as const) {
        expect(Math.abs(Vector3.Dot(rotate(q, restHinge), bone.normalizeToNew()))).toBeLessThan(1e-6)
      }
      expect(Vector3.Dot(rotate(r.upper, restHinge), rotate(r.lower, restHinge))).toBeCloseTo(1, 6)
    }
  })

  it('reaches as far as it can toward targets out of range', () => {
    const far = root.add(new Vector3(0.3, -2, 0.4))
    const r = solveTwoBone(root, far, l1, l2, Z, restDir, restDir, restHinge)
    expect(r.reached).toBe(false)
    expect(Vector3.Distance(root, r.end)).toBeCloseTo((l1 + l2) * 0.999, 9)
    expect(angle(r.end.subtract(root), far.subtract(root))).toBeLessThan(1e-9)
    const near = solveTwoBone(root, root.add(new Vector3(0, -0.001, 0)), l1, l2, Z, restDir, restDir, restHinge)
    expect(near.reached).toBe(false)
    expect(Vector3.Distance(root, near.end)).toBeCloseTo(Math.abs(l1 - l2) + 1e-4, 9)
  })

  it('stays finite when the pole points along the limb or the target is the root', () => {
    for (const [target, pole] of [[root.add(new Vector3(0, -0.6, 0)), new Vector3(0, -1, 0)], [root.clone(), Z]] as const) {
      const r = solveTwoBone(root, target, l1, l2, pole, restDir, restDir, restHinge)
      for (const v of [r.mid, r.end]) expect(Number.isFinite(v.x + v.y + v.z)).toBe(true)
      for (const q of [r.upper, r.lower]) expect(Number.isFinite(q.x + q.y + q.z + q.w)).toBe(true)
    }
  })
})

describe('forward kinematics', () => {
  const { rest, fk } = skeleton(preset('runner'))

  it('puts every joint at rest for the identity pose', () => {
    fk.run(new Pose(rest.names))
    rest.names.forEach((_, i) => expectNear(fk.pos[i], rest.restPos[i], 1e-12))
  })

  it('FK.chain agrees with FK.run', () => {
    const pose = new Pose(rest.names)
    for (const n of rest.names) pose.set(n, randQuat())
    pose.hipsOffset.set(0.1, -0.2, 0.3)
    fk.run(pose)
    rest.names.forEach((n, i) => {
      const c = FK.chain(rest, pose, n)
      expectNear(c.pos, fk.pos[i], 1e-9)
      expect(Math.abs(Quaternion.Dot(c.rot, fk.rot[i]))).toBeCloseTo(1, 9)
    })
  })

  it('Pose.blend goes from one pose to the other', () => {
    const a = new Pose(rest.names), b = new Pose(rest.names)
    for (const n of rest.names) b.set(n, axisAngle(randUnit(), 1))
    b.hipsOffset.set(0, 0.2, 0)
    const c = new Pose(rest.names).copyFrom(a).blend(b, 0)
    expect(c.get('head').equalsWithEpsilon(a.get('head'), 1e-12)).toBe(true)
    c.blend(b, 0.5)
    expect(2 * Math.acos(Math.abs(c.get('head').w))).toBeCloseTo(0.5, 6)
    expect(c.hipsOffset.y).toBeCloseTo(0.1, 12)
    c.blend(b, 1)
    expect(c.get('head').equalsWithEpsilon(b.get('head'), 1e-12)).toBe(true)
  })
})

// ------------------------------------------------------------------------------------------------ the gait

/** The heel point the gait plants, relative to the ankle (the ball is the toes joint). */
const heelOffset = (rig: Rig): Vector3 => new Vector3(0, 0.012 * rig.s - rig.ankleH, -0.075 * rig.s)

interface Case { name: string; speed: number; run: number; grade: number }
const CASES: Case[] = [
  { name: 'slow walk', speed: 0.6, run: 0, grade: 0 },
  { name: 'walk', speed: 1.4, run: 0, grade: 0 },
  { name: 'fast walk', speed: 2.4, run: 0, grade: 0 },
  { name: 'jog', speed: 1.6, run: 1, grade: 0 },
  { name: 'run', speed: 3.2, run: 1, grade: 0 },
  { name: 'sprint', speed: 6, run: 1, grade: 0 },
  { name: 'uphill walk', speed: 1.2, run: 0, grade: 0.12 },
  { name: 'downhill run', speed: 3, run: 1, grade: -0.1 },
  { name: 'walk-run blend', speed: 2.6, run: 0.5, grade: 0 },
]
const GAIT_BODIES: Array<[string, AvatarSpec]> = [
  ['sam', preset('sam')], ['petite', preset('petite')], ['lanky', preset('lanky')], ['comfy', preset('comfy')],
  ['smallest', SMALLEST], ['biggest', BIGGEST],
]

describe.each(GAIT_BODIES)('%s gait', (_, spec) => {
  const { rig, rest, poser, pose, fk } = skeleton(spec)
  const heel = heelOffset(rig)
  const ballRestY = rig.joints['toes.R'][1]
  const hipsRestY = rest.pos('hips').y

  it('swings the arms beside the body, never through it', async () => {
    // (a fresh poser: the gait smooths over calls, so earlier tests would change where this one starts)
    const { rig, rest, poser, pose, fk } = skeleton(spec)
    // the trunk alone, in rest space: the undressed body's vertices bound to neither limbs nor shoulders (skin
    // hidden under a garment belongs to no triangle and has no normal). A point is inside if, in the trunk's
    // horizontal cross-section at its height, it is nearer the section's centre than the surface in its direction.
    const bare = normalizeSpec({ ...spec, clothes: [] })
    await preloadAssets(bare)
    const b = geometry(bare).body
    const slices = new Map<number, Array<[number, number]>>()
    for (let v = 0; v < b.positions.length / 3; v++) {
      const limb = b.parts[4 * v] + b.parts[4 * v + 1] + b.parts[4 * v + 2] + b.parts[4 * v + 3]
      if (limb > 0.05 || Math.hypot(b.normals[3 * v], b.normals[3 * v + 1], b.normals[3 * v + 2]) < 0.5) continue
      const k = Math.round(b.positions[3 * v + 1] / 0.01)
      if (!slices.has(k)) slices.set(k, [])
      slices.get(k)!.push([b.positions[3 * v], b.positions[3 * v + 2]])
    }
    const torso = { eval: (x: number, y: number, z: number): number => {
      const sec = [-1, 0, 1].flatMap((d) => slices.get(Math.round(y / 0.01) + d) ?? [])
      if (sec.length < 12) return 1 // above the shoulders or below the crotch: no trunk here
      const cx = sec.reduce((t, p) => t + p[0], 0) / sec.length, cz = sec.reduce((t, p) => t + p[1], 0) / sec.length
      const a = Math.atan2(z - cz, x - cx)
      let best = Infinity, r = 0
      for (const [px, pz] of sec) {
        const d = Math.abs(((Math.atan2(pz - cz, px - cx) - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI)
        if (d < best) { best = d; r = Math.hypot(px - cx, pz - cz) }
      }
      return Math.hypot(x - cx, z - cz) - r
    } }
    const hipsRest = rest.pos('hips')
    let worst = Infinity, where = ''
    for (const [speed, run] of [[1.4, 0], [3.5, 1], [6, 1]]) {
      for (let i = 0; i < 48; i++) {
        poser.gait(pose, i / 48, speed, run, 0, i * 0.02)
        fk.run(pose)
        const hips = fk.pos[rest.i('hips')]
        for (const side of SIDES) {
          const el = fk.pos[rest.i(`forearm.${side}`)], wr = fk.pos[rest.i(`hand.${side}`)]
          for (const [pt, r] of [[el, 0.036], [Vector3.Lerp(el, wr, 0.5), 0.033], [wr, 0.025], [Vector3.Lerp(el, wr, 1.45), 0.02]] as const) {
            // torso-relative (the torso itself barely turns while moving)
            const q = pt.subtract(hips).add(hipsRest)
            const d = torso.eval(q.x, q.y, q.z) - r * rig.s
            if (d < worst) { worst = d; where = `${side} ${r === 0.036 ? 'elbow' : r === 0.033 ? 'mid-forearm' : r === 0.025 ? 'wrist' : 'hand'} at ${speed} m/s, phase ${(i / 48).toFixed(2)}, (${q.x.toFixed(3)}, ${q.y.toFixed(3)}, ${q.z.toFixed(3)})` }
          }
        }
      }
    }
    expect(worst, where).toBeGreaterThan(-0.008)
  })

  it.each(CASES)('$name: feet plant without slipping, knees bend forward, the pelvis moves smoothly', ({ speed, run, grade }) => {
    const N = 720
    const stride = 2 * poser.stepLength(speed, run)
    const dt = stride / speed / N
    type Pt = { p: Vector3; h: number }
    const track: Record<Side, { ball: Pt[]; heel: Pt[] }> = { L: { ball: [], heel: [] }, R: { ball: [], heel: [] } }
    const hipsY: number[] = []
    for (let i = 0; i < N; i++) {
      const phase = i / N
      poser.gait(pose, phase, speed, run, grade, i * dt)
      fk.run(pose)
      hipsY.push(fk.pos[rest.i('hips')].y)
      // ground frame: the body moves forward (and up the slope) one stride per cycle
      const shift = new Vector3(0, grade * phase * stride, phase * stride)
      const fwd = rotate(fk.rot[rest.i('hips')], Z)
      for (const s of SIDES) {
        const ankle = fk.pos[rest.i(`foot.${s}`)]
        const ball = fk.pos[rest.i(`toes.${s}`)].add(shift)
        const heelP = ankle.add(rotate(fk.rot[rest.i(`foot.${s}`)], heel)).add(shift)
        track[s].ball.push({ p: ball, h: ball.y - grade * ball.z })
        track[s].heel.push({ p: heelP, h: heelP.y - grade * heelP.z })
        // knee in front of the hip-ankle line, never folded flat
        const hip = fk.pos[rest.i(`thigh.${s}`)], knee = fk.pos[rest.i(`shin.${s}`)]
        const axis = ankle.subtract(hip).normalize()
        const across = knee.subtract(hip).subtract(axis.scale(Vector3.Dot(knee.subtract(hip), axis)))
        expect(Vector3.Dot(across, fwd)).toBeGreaterThan(-0.0005)
        expect(angle(knee.subtract(hip), ankle.subtract(knee))).toBeLessThan((145 * Math.PI) / 180)
      }
    }
    const touching = new Array<number>(N).fill(0)
    for (const s of SIDES) {
      const onGround = new Array<boolean>(N).fill(false)
      for (const which of ['ball', 'heel'] as const) {
        const pts = track[s][which]
        const floor = Math.min(...pts.map((q) => q.h))
        // on level ground the sole meets the floor exactly
        if (grade === 0) expect(floor).toBeCloseTo(which === 'ball' ? ballRestY : 0.012 * rig.s, 4)
        const down = pts.map((q) => q.h - floor < 1e-4)
        for (let i = 0; i < N; i++) {
          if (down[i]) onGround[i] = true
          // a point on the ground doesn't move (the next sample is 2-6 mm further along if it slides; a toe rolling
          // off the ground at lift-off, leaving at the ground's speed, moves a fraction of a millimetre)
          if (down[i] && down[(i + 1) % N] && i + 1 < N) expect(Vector3.Distance(pts[i].p, pts[i + 1].p)).toBeLessThan(5e-4)
        }
      }
      const share = onGround.filter(Boolean).length / N
      if (run === 0) expect(share).toBeGreaterThan(0.55)
      if (run === 1) {
        expect(share).toBeGreaterThan(0.18)
        expect(share).toBeLessThan(0.45)
      }
      onGround.forEach((d, i) => (touching[i] += d ? 1 : 0))
    }
    // walking always has a foot down; running has flight
    if (run === 0) expect(Math.min(...touching)).toBeGreaterThan(0)
    if (run === 1) expect(Math.min(...touching)).toBe(0)
    // pelvis height: never a crouch, and no sudden changes. (A walk vaults over a nearly straight stance leg, and
    // with the feet under the hips rather than apart as in the rest pose, that lifts the hips a little above their
    // rest height.)
    const lo = Math.min(...hipsY) / hipsRestY, hi = Math.max(...hipsY) / hipsRestY
    // (a fast walk's long strides dip the hips most as the feet change, as real fast walking does)
    expect(lo).toBeGreaterThan(run === 0 ? 0.85 : 0.82)
    expect(hi).toBeLessThan(run === 0 ? 1.04 : 1.03)
    let acc = 0
    for (let i = 0; i < N; i++) acc = Math.max(acc, Math.abs(hipsY[(i + 1) % N] - 2 * hipsY[i] + hipsY[(i + N - 1) % N]) / (dt * dt))
    expect(acc).toBeLessThan(run === 0 ? 100 : 200)
  })

  it('changes smoothly with speed', () => {
    for (const run of [0, 0.5, 1]) {
      for (const phase of [0.07, 0.62]) {
        let prev = NaN
        for (let v = 0.3; v <= 6; v += 0.01) {
          poser.gait(pose, phase, v, run, 0, 0)
          // (a few millimetres at most per 0.01 m/s; running, the fit's tightest point can move from one sample to
          // another as the stride lengthens, steepening the change briefly)
          if (!Number.isNaN(prev)) expect(Math.abs(pose.hipsOffset.y - prev)).toBeLessThan(0.003)
          prev = pose.hipsOffset.y
        }
      }
    }
  })

  it('takes longer, slower steps with longer legs and quicker ones when running faster', () => {
    const cadence = (v: number, run: number): number => (60 * v) / poser.stepLength(v, run)
    expect(cadence(3.2, 1)).toBeGreaterThan(140)
    expect(cadence(3.2, 1)).toBeLessThan(215)
    expect(cadence(6, 1)).toBeGreaterThan(cadence(3.2, 1))
    expect(cadence(1.4, 0)).toBeGreaterThan(90)
    expect(cadence(1.4, 0)).toBeLessThan(165)
    expect(poser.stepLength(1.4, 0)).toBeGreaterThan(0.6 * poser.L)
    expect(poser.stepLength(6, 1)).toBeLessThan(2.7 * poser.L)
  })

  it('stands with feet flat and hands clear of the hips', () => {
    for (let t = 0; t < 30; t += 0.25) {
      poser.idle(pose, t)
      fk.run(pose)
      for (const s of SIDES) {
        expect(fk.pos[rest.i(`foot.${s}`)].y).toBeCloseTo(rig.ankleH, 6)
        expect(fk.pos[rest.i(`toes.${s}`)].y).toBeCloseTo(ballRestY, 6)
        expect(Math.abs(fk.pos[rest.i(`hand.${s}`)].x)).toBeGreaterThan(rig.hipOuter)
      }
    }
  })
})

describe.each(GAIT_BODIES)('%s on a bike', (_, spec) => {
  const { rig, rest, poser, pose, fk } = skeleton(spec)
  const fit = poser.fit

  it('keeps feet on the pedals and hands on the bars all the way round', () => {
    for (let i = 0; i < 36; i++) {
      const crank = (i / 36) * Math.PI * 2
      for (const effort of [0, 0.5, 1]) {
        poser.cycle(pose, crank, effort, i * 0.1)
        fk.run(pose)
        for (const s of SIDES) {
          const target = poser.pedalAnkle(fit, s, crank + (s === 'R' ? 0 : Math.PI))
          expectNear(fk.pos[rest.i(`foot.${s}`)], target.ankle, 5e-4)
          const sx = s === 'R' ? 1 : -1
          expectNear(fk.pos[rest.i(`hand.${s}`)], new Vector3(sx * fit.wrist.x, fit.wrist.y, fit.wrist.z), 5e-4)
          const hip = fk.pos[rest.i(`thigh.${s}`)], knee = fk.pos[rest.i(`shin.${s}`)], ankle = fk.pos[rest.i(`foot.${s}`)]
          const flex = (angle(knee.subtract(hip), ankle.subtract(knee)) * 180) / Math.PI
          expect(flex).toBeGreaterThan(30)
          expect(flex).toBeLessThan(120)
          const elbow = (angle(fk.pos[rest.i(`forearm.${s}`)].subtract(fk.pos[rest.i(`upperArm.${s}`)]), fk.pos[rest.i(`hand.${s}`)].subtract(fk.pos[rest.i(`forearm.${s}`)])) * 180) / Math.PI
          expect(elbow).toBeGreaterThan(20)
        }
      }
    }
  })

  it('fits a bike to the rider', () => {
    expect(fit.k).toBeCloseTo(Math.min(1.18, Math.max(0.78, rig.height / 1.75)), 9)
    expect(fit.saddle.y).toBeLessThan(fit.hip.y)
    expect(fit.saddle.y).toBeGreaterThan(fit.bb.y + fit.crank)
    expect(fit.saddle.z).toBeLessThan(fit.bb.z)
    expect(fit.grip.z).toBeGreaterThan(fit.bb.z)
    expect(fit.grip.y).toBeGreaterThan(fit.saddle.y)
    expect(fit.qFactor).toBeGreaterThan(0.05)
    expect(fit.rearZ).toBeLessThan(fit.saddle.z)
    expect(fit.frontZ).toBeGreaterThan(fit.grip.z)
  })
})

describe('Animator', () => {
  const spec = normalizeSpec({})
  const make = (m: Partial<Motion>): Animator => {
    const a = new Animator()
    a.bind(rigOf(spec))
    a.set(m)
    a.snap()
    return a
  }

  it('blends onto and off the bike in about a third of a second', () => {
    const a = make({ mode: 'cycle', cadence: 90 })
    expect(a.cycling).toBe(1)
    a.set({ mode: 'walk', speed: 1.4 })
    for (let i = 0; i < 6; i++) a.update(1 / 60)
    expect(a.cycling).toBeCloseTo(1 - 0.1 / 0.35, 6)
    for (let i = 0; i < 18; i++) a.update(1 / 60)
    expect(a.cycling).toBe(0)
    a.set({ mode: 'cycle' })
    for (let i = 0; i < 22; i++) a.update(1 / 60)
    expect(a.cycling).toBe(1)
  })

  it('turns the cranks at the cadence, or follows a crank angle it is given', () => {
    const a = make({ mode: 'cycle', cadence: 90 })
    let turned = 0, last = a.crank
    for (let i = 0; i < 120; i++) {
      a.update(1 / 60)
      turned += (a.crank - last + Math.PI * 2) % (Math.PI * 2)
      last = a.crank
    }
    expect(turned).toBeCloseTo(2 * 1.5 * Math.PI * 2, 6)
    a.set({ crank: 1.234 })
    a.update(1 / 60)
    expect(a.crank).toBe(1.234)
  })

  it('steps at the speed it is given', () => {
    const a = make({ mode: 'walk', speed: 1.4 })
    const stride = 2 * a.poser.stepLength(1.4, 0)
    const start = a.gaitPhase
    for (let i = 0; i < 30; i++) a.update(1 / 60)
    expect((a.gaitPhase - start + 1) % 1).toBeCloseTo(0.5 * (1.4 / stride), 6)
  })

  it('always produces a sane pose, whatever it is asked to do', () => {
    const a = make({ mode: 'idle' })
    const r = makeRng(9)
    const modes: MotionMode[] = ['idle', 'walk', 'run', 'cycle']
    for (let i = 0; i < 3000; i++) {
      if (r() < 0.02) {
        a.set({
          mode: modes[Math.floor(r() * 4)], speed: r() * 8, cadence: r() * 140, grade: r() * 0.3 - 0.15, effort: r(),
          crank: r() < 0.2 ? r() * 20 - 10 : null,
        })
      }
      const dt = r() < 0.01 ? 3 : r() < 0.05 ? 0 : r() * 0.1
      const pose = a.update(dt)
      for (const q of pose.rotations.values()) {
        expect(Number.isFinite(q.x + q.y + q.z + q.w)).toBe(true)
        expect(Math.abs(q.length() - 1)).toBeLessThan(1e-6)
      }
      expect(pose.hipsOffset.length()).toBeLessThan(0.6)
    }
  })

})
