/**
 * Procedural poses: idle, a walk/run gait that blends continuously with speed, and cycling. Legs always use IK
 * to explicit foot targets (no sliding, any body proportions); arms use FK for walking/running and IK to the
 * handlebars for cycling.
 */
import { Quaternion, Vector3 } from '@babylonjs/core'
import type { Side } from '../body/rig.ts'
import { torsoHalfWidth } from '../body/rig.ts'
import { solveTwoBone } from './ik.ts'
import { axisAngle, fromV3, frameRotation, rotate, toLocal, ypr } from './qmath.ts'
import type { Pose, RestSkeleton } from './pose.ts'

const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x)
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
/** Periodic [1 2 1] smoothing, `passes` times (each pass reaches one sample further). */
function blur(a: Float64Array, passes: number): Float64Array {
  const n = a.length
  let cur = a.slice()
  for (let p = 0; p < passes; p++) {
    const next = new Float64Array(n)
    for (let i = 0; i < n; i++) next[i] = 0.25 * cur[(i + n - 1) % n] + 0.5 * cur[i] + 0.25 * cur[(i + 1) % n]
    cur = next
  }
  return cur
}
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
const TAU = Math.PI * 2
const SIDES: readonly Side[] = ['L', 'R']
const sgn = (s: Side): number => (s === 'R' ? 1 : -1)

/**
 * The right hand on the bars (the left mirrors it): pointing forward and down, palm on the bar, thumb inward, so
 * the curled fingers wrap over the bar's front.
 */
const GRIP_DIR = new Vector3(0.05, -0.5, 1).normalize()
const GRIP_PALM = new Vector3(-0.15, -1, 0).subtract(GRIP_DIR.scale(Vector3.Dot(new Vector3(-0.15, -1, 0), GRIP_DIR))).normalize()
const GRIP_THUMB = Vector3.Cross(GRIP_PALM, GRIP_DIR).normalize()
/** hip-to-ankle length of the default avatar: running strides are scaled from its */
const REF_LEG = 0.85
/** feet turn out a little while walking and running (radians) */
const TOE_OUT = 0.05
/** a running foot stays down for at most this many leg lengths of travel */
const MAX_RUN_STANCE = 1.05

export interface BikeFit {
  /** bike scale relative to a 1.75 m rider's bike */
  k: number
  bb: Vector3
  crank: number
  /** half the distance between the pedals */
  qFactor: number
  /** seated hip-joint midpoint */
  hip: Vector3
  saddle: Vector3
  /** right grip (the left is mirrored) */
  grip: Vector3
  /** right wrist target */
  wrist: Vector3
  lean: number
  pelvisTilt: number
  wheelRadius: number
  /** rear and front axle z */
  rearZ: number
  frontZ: number
}

interface GaitParams {
  v: number
  runAmt: number
  grade: number
  stride: number
  duty: number
  lift: number
  kick: number
  heelStrike: number
  toeOff: number
  heelOff: number
  /** how much of the stance happens in front of the hip */
  landFrac: number
  bob: number
  lean: number
  /** 0 standing .. 1 moving (fades the pelvis motion in) */
  move: number
}

interface FootTarget {
  ankle: Vector3
  pitch: number
  yaw: number
  toe: number
  stance: boolean
  /** progress through the stance or the swing, 0..1 */
  u: number
}

interface PelvisMotion {
  rot: Quaternion
  /** sideways sway of the hip midpoint */
  x: number
  yaw: number
  roll: number
}

export class BodyPoser {
  private hipKey = ''
  private hipTable: Float64Array = new Float64Array(1)
  readonly L: number
  readonly restHips: Vector3
  readonly restHipMid: Vector3
  private readonly hip: Record<Side, Vector3>
  private readonly legDir: Record<Side, Vector3>
  private readonly legHinge: Record<Side, Vector3>
  private readonly armDir: Record<Side, Vector3>
  private readonly armHinge: Record<Side, Vector3>
  private readonly wristFlex: Record<Side, Quaternion>
  private readonly toBall: Vector3
  private readonly toHeel: Vector3
  readonly fit: BikeFit

  readonly rest: RestSkeleton

  constructor(rest: RestSkeleton) {
    this.rest = rest
    const rig = rest.rig
    this.L = rig.thighLen + rig.shinLen
    this.restHips = rest.pos('hips').clone()
    this.hip = { L: rest.pos('thigh.L').clone(), R: rest.pos('thigh.R').clone() }
    this.restHipMid = this.hip.L.add(this.hip.R).scale(0.5)
    const s = rig.s
    this.legDir = { L: fromV3([-rig.legDir[0], rig.legDir[1], rig.legDir[2]]), R: fromV3(rig.legDir) }
    this.armDir = { L: fromV3([-rig.armDir[0], rig.armDir[1], rig.armDir[2]]), R: fromV3(rig.armDir) }
    const fwd = new Vector3(0, 0, 1)
    this.legHinge = { L: Vector3.Cross(this.legDir.L, fwd).normalize(), R: Vector3.Cross(this.legDir.R, fwd).normalize() }
    this.armHinge = { L: Vector3.Cross(this.armDir.L, fwd.scale(-1)).normalize(), R: Vector3.Cross(this.armDir.R, fwd.scale(-1)).normalize() }
    // fingers toward the palm (the palm faces -hinge in the rest pose)
    const flex = (side: Side): Quaternion => axisAngle(Vector3.Cross(this.armDir[side], this.armHinge[side].scale(-1)), 0.22)
    this.wristFlex = { L: flex('L'), R: flex('R') }
    this.toBall = rest.pos('toes.R').subtract(rest.pos('foot.R'))
    this.toHeel = new Vector3(0, 0.012 * s - rig.ankleH, -0.075 * s)
    this.fit = this.computeFit(0.72)
  }

  // ------------------------------------------------------------------------------------------------ shared parts

  private setHips(out: Pose, qp: Quaternion, hipMid: Vector3): void {
    out.set('hips', qp)
    const hipsPos = hipMid.add(rotate(qp, this.restHips.subtract(this.restHipMid)))
    hipsPos.subtractToRef(this.restHips, out.hipsOffset)
  }

  private hipJoint(out: Pose, side: Side): Vector3 {
    const qp = out.get('hips')
    return this.restHips.add(out.hipsOffset).add(rotate(qp, this.hip[side].subtract(this.restHips)))
  }

  /** Leg to an ankle target; foot pitched by `pitch` (+ = toes down) and turned by `yaw`. */
  private leg(out: Pose, side: Side, ankle: Vector3, pole: Vector3, pitch: number, yaw: number, toeBend: number): void {
    const rig = this.rest.rig
    const qp = out.get('hips')
    const res = solveTwoBone(this.hipJoint(out, side), ankle, rig.thighLen, rig.shinLen, pole, this.legDir[side], this.legDir[side], this.legHinge[side])
    out.set(`thigh.${side}`, toLocal(qp, res.upper))
    out.set(`shin.${side}`, toLocal(res.upper, res.lower))
    const foot = ypr(yaw, pitch, 0)
    out.set(`foot.${side}`, toLocal(res.lower, foot))
    out.set(`toes.${side}`, axisAngle(new Vector3(1, 0, 0), toeBend))
  }

  /**
   * Ankle position for a foot pitched by `pitch` that keeps its heel (pitched up from the ground) or its ball
   * (pitched down) where they are when the foot lies flat on ground of slope `ground` (a pitch) with the ankle
   * at `contact`.
   */
  private anklePlanted(contact: Vector3, pitch: number, yaw: number, ground = 0): Vector3 {
    const ref = pitch >= ground ? this.toBall : this.toHeel
    const refPoint = contact.add(rotate(ypr(yaw, ground, 0), ref))
    return refPoint.subtract(rotate(ypr(yaw, pitch, 0), ref))
  }

  private spineChain(out: Pose, qp: Quaternion, spineW: Quaternion, chestW: Quaternion, neckW: Quaternion, headW: Quaternion): void {
    out.set('spine', toLocal(qp, spineW))
    out.set('chest', toLocal(spineW, chestW))
    out.set('neck', toLocal(chestW, neckW))
    out.set('head', toLocal(neckW, headW))
  }

  /** Arm hanging/swinging from the chest: swing (+ forward), abduction (+ out), elbow flex, forearm aim inward. */
  private armSwing(out: Pose, side: Side, chestW: Quaternion, swing: number, abd: number, elbow: number, inward: number, shrug: number, protract = 0): void {
    const sx = sgn(side)
    // (protract: the shoulder rolls forward with the arm, + for the right shoulder forward and the left back)
    const shoulderW = chestW.multiply(ypr(-sx * shrug * 0.5 - protract, 0, sx * shrug))
    out.set(`shoulder.${side}`, toLocal(chestW, shoulderW))
    let u = rotate(axisAngle(new Vector3(0, 0, 1), sx * abd), new Vector3(0, -1, 0))
    u = rotate(axisAngle(new Vector3(1, 0, 0), -swing), u)
    u = rotate(chestW, u)
    const toward = rotate(chestW, new Vector3(-sx * inward, 0.15, 1).normalize())
    const h = Vector3.Cross(toward, u).normalize()
    const f = rotate(axisAngle(h, -elbow), u)
    const ua = frameRotation(this.armDir[side], this.armHinge[side], u, h)
    const fa = frameRotation(this.armDir[side], this.armHinge[side], f, h)
    out.set(`upperArm.${side}`, toLocal(shoulderW, ua))
    out.set(`forearm.${side}`, toLocal(ua, fa))
    out.set(`hand.${side}`, this.wristFlex[side])
  }

  private shoulderJoint(out: Pose, side: Side, chestW: Quaternion): Vector3 {
    // chest world position via the spine chain
    const r = this.rest
    const hipsW = out.get('hips')
    const hipsPos = this.restHips.add(out.hipsOffset)
    const spineW = hipsW.multiply(out.get('spine'))
    const spinePos = hipsPos.add(rotate(hipsW, r.offset[r.i('spine')]))
    const chestPos = spinePos.add(rotate(spineW, r.offset[r.i('chest')]))
    const shoulderW = chestW.multiply(out.get(`shoulder.${side}`))
    const shoulderPos = chestPos.add(rotate(chestW, r.offset[r.i(`shoulder.${side}`)]))
    return shoulderPos.add(rotate(shoulderW, r.offset[r.i(`upperArm.${side}`)]))
  }

  private armReach(out: Pose, side: Side, chestW: Quaternion, wrist: Vector3, pole: Vector3, handDir: Vector3, thumb: Vector3): void {
    const rig = this.rest.rig
    out.set(`shoulder.${side}`, Quaternion.Identity())
    const root = this.shoulderJoint(out, side, chestW)
    const res = solveTwoBone(root, wrist, rig.upperArmLen, rig.forearmLen, pole, this.armDir[side], this.armDir[side], this.armHinge[side], 0.995)
    const shoulderW = chestW.multiply(out.get(`shoulder.${side}`))
    out.set(`upperArm.${side}`, toLocal(shoulderW, res.upper))
    out.set(`forearm.${side}`, toLocal(res.upper, res.lower))
    const hand = frameRotation(this.armDir[side], new Vector3(0, 0, 1), handDir, thumb)
    out.set(`hand.${side}`, toLocal(res.lower, hand))
  }

  // ------------------------------------------------------------------------------------------------ idle

  idle(out: Pose, t: number, breath = 1): void {
    const rig = this.rest.rig
    const s = rig.s
    const shift = Math.sin(t * 0.42)
    const hipY = this.restHipMid.y - 0.014 * s - 0.003 * s * Math.sin(t * 0.8)
    const qp = ypr(0.03 * Math.sin(t * 0.23), 0.02, 0.022 * shift)
    this.setHips(out, qp, new Vector3(0.012 * s * shift, hipY, 0))
    for (const side of SIDES) {
      const sx = sgn(side)
      const ankle = new Vector3(sx * (rig.hipHalf + 0.018 * s), rig.ankleH, sx * 0.012 * s)
      this.leg(out, side, ankle, new Vector3(sx * 0.15, 0, 1), 0, sx * 0.12, 0)
    }
    const b = Math.sin(t * 1.6) * breath
    const spineW = qp.multiply(ypr(-0.015 * Math.sin(t * 0.23), -0.02 + 0.006 * b, -0.015 * shift))
    const chestW = ypr(0, 0.005 * b - 0.01, 0)
    const look = 0.14 * Math.sin(t * 0.21) * Math.sin(t * 0.067 + 1)
    const neckW = ypr(look * 0.4, 0.02, 0)
    const headW = ypr(look, 0.04 * Math.sin(t * 0.13) - 0.02, 0.02 * Math.sin(t * 0.17))
    this.spineChain(out, qp, spineW, chestW, neckW, headW)
    const abd = this.armAbduction()
    for (const side of SIDES) {
      const ph = side === 'R' ? 0 : 1.3
      this.armSwing(out, side, chestW, 0.04 + 0.025 * Math.sin(t * 0.9 + ph), abd, 0.22 + 0.04 * Math.sin(t * 0.7 + ph), 0.2, 0.01 * b)
    }
  }

  /** How far the arms hang out from the body so the hands clear the hips and the elbows clear the waist. */
  armAbduction(): number {
    const rig = this.rest.rig
    const armLen = rig.upperArmLen + rig.forearmLen
    // the wrists hang beside the widest part of the hips, with room for the hand and forearm
    const hands = rig.hipOuter + (0.035 + 0.02 * rig.muscle + 0.015 * rig.build) * rig.s - rig.shoulderHalf
    // and the elbows beside the waist (a heavy build is widest there), with room for the forearm
    const elbowY = rig.joints['upperArm.R'][1] - rig.upperArmLen
    const elbows = torsoHalfWidth(rig, elbowY) + (0.05 + 0.015 * rig.build) * rig.s - rig.shoulderHalf
    return Math.max(Math.asin(Math.min(0.6, Math.max(0, hands / armLen))), Math.asin(Math.min(0.6, Math.max(0, elbows / rig.upperArmLen)))) + 0.02
  }

  // ------------------------------------------------------------------------------------------------ gait

  /** Gait shape for a speed: everything the foot paths and the body motion need. */
  private gaitParams(speed: number, runAmt: number, grade: number): GaitParams {
    const L = this.L
    const v = Math.max(0, speed)
    const step = this.stepLength(v, runAmt)
    const v0 = v * Math.sqrt(REF_LEG / L)
    const runDuty = Math.min(clamp(0.36 - 0.025 * (v0 - 3), 0.27, 0.38), (MAX_RUN_STANCE * L) / (2 * step))
    return {
      v, runAmt, grade,
      stride: 2 * step,
      duty: lerp(0.6, runDuty, runAmt),
      lift: lerp(L * (0.05 + 0.025 * Math.min(v, 2)), L * (0.1 + 0.03 * Math.min(v, 6)), runAmt),
      kick: lerp(0, L * (0.14 + 0.05 * Math.min(v, 6)), runAmt),
      // (walking lands on the heel, toes about 20° up, and pushes off steeply, the foot about 57° to the ground: the
      // trailing heel's rise is what lets the hips stay high enough for the leading leg to land nearly straight)
      heelStrike: lerp(-0.38, -0.08, runAmt),
      toeOff: lerp(1.0, 1.15, runAmt),
      heelOff: lerp(0.32, 0.3, runAmt),
      landFrac: lerp(0.43, 0.3, runAmt),
      // (walking only: a run's rise and fall comes from its flight time, in hipCurve)
      bob: 0.03 * L * Math.min(1, v) * (1 - runAmt),
      lean: lerp(0.03 + 0.025 * v, 0.1 + 0.022 * Math.min(v, 7), runAmt) + Math.atan(grade) * 0.6,
      move: Math.min(1, v / 0.8),
    }
  }

  /** Pelvis rotation and sway over the stride (the legs' reach depends on it, so the hip table uses it too). */
  private pelvis(phase: number, g: GaitParams): PelvisMotion {
    const p2 = TAU * phase
    const off = p2 - TAU * g.duty * 0.5
    const yaw = lerp(0.07, 0.09, g.runAmt) * g.move * Math.cos(p2)
    const roll = -lerp(0.04, 0.025, g.runAmt) * g.move * Math.cos(off)
    const x = -lerp(0.014, 0.006, g.runAmt) * this.rest.rig.s * g.move * Math.cos(off)
    return { rot: ypr(yaw, g.lean * 0.3, roll), x, yaw, roll }
  }

  /** Where one foot is at local phase psi (0 = this foot lands). */
  private foot(side: Side, psi: number, g: GaitParams): FootTarget {
    const rig = this.rest.rig
    const s = rig.s
    const sx = sgn(side)
    const yaw = sx * TOE_OUT
    const x = sx * (rig.hipHalf * 0.82 + 0.006 * s)
    const zc = g.duty * g.stride * g.landFrac
    const gradePitch = -Math.atan(g.grade)
    if (psi < g.duty) {
      const u = psi / g.duty
      const z = zc - psi * g.stride
      // (the heel rocker: the foot rolls down from the heel over the first fifth of the stance)
      let pitch = g.heelStrike * (1 - smooth(0, lerp(0.2, 0.16, g.runAmt), u))
      const rise = Math.pow(smooth(g.heelOff, 1, u), 1.3) * g.toeOff
      pitch += rise
      const contact = new Vector3(x, rig.ankleH + g.grade * z, z)
      const ankle = this.anklePlanted(contact, pitch + gradePitch, yaw, gradePitch)
      return { ankle, pitch: pitch + gradePitch, yaw, toe: -rise * 0.95, stance: true, u }
    }
    const w = (psi - g.duty) / (1 - g.duty)
    const e = 0.5 - 0.5 * Math.cos(Math.PI * w)
    // swing starts where stance ended (heel up) and lands flat at the next contact
    const z0 = zc - g.duty * g.stride
    const end = this.anklePlanted(new Vector3(x, rig.ankleH + g.grade * z0, z0), g.toeOff + gradePitch, yaw, gradePitch)
    const land = this.anklePlanted(new Vector3(x, rig.ankleH + g.grade * zc, zc), g.heelStrike + gradePitch, yaw, gradePitch)
    // eased over the ground, not the body: a planted foot moves back past the body at the walking speed, so the
    // swing leaves and arrives at that speed (easing in the body's frame would jolt the foot at lift-off and landing)
    // (walking; a run keeps its easing in the body's frame, which its landing and hip height are tuned for)
    const z = lerp(end.z, land.z, w) + (e - w) * lerp(g.stride, land.z - end.z, g.runAmt)
    // (and, walking, settles onto the heel rather than dropping onto it: the height eases out at both ends, so the
    // ankle doesn't stop dead the moment the foot is planted; on a slope, measured from the ground under the path)
    const eh = lerp(e, w, g.runAmt)
    const base = lerp(end.y, land.y, eh) + g.grade * (z - lerp(end.z, land.z, eh))
    const y = base + g.lift * Math.sin(Math.PI * w) ** lerp(1.25, 0.9, g.runAmt) + g.kick * Math.sin(Math.PI * Math.min(1, w * 1.6)) * (1 - w)
    const pitch = lerp(g.toeOff, g.heelStrike, smooth(0.0, 0.9, w)) + gradePitch
    // (the toes straighten from where push-off left them, not from a fixed bend: no snap at lift-off)
    return { ankle: new Vector3(lerp(end.x, land.x, e), y, z), pitch, yaw, toe: -0.95 * g.toeOff * (1 - smooth(0, 0.5, w)), stance: false, u: w }
  }

  /**
   * Pelvis height over the stride, as a periodic table. Walking vaults over the stance leg (highest at
   * mid-stance), running sinks into it (lowest at mid-stance); wherever the legs can't reach that high the
   * pelvis comes down. The table is smoothed and then lowered smoothly wherever smoothing lifted it above that
   * limit, so it never jerks and the feet always reach.
   */
  private hipCurve(g: GaitParams): Float64Array {
    const N = 64
    // walking: lowest as each heel lands and already rising as it takes the weight (lowest after the landing, the
    // new stance knee would have to fold to follow the hips down, and bounce)
    const amp = g.bob
    // running: a flight is a fall, a parabola from lift-off back down to the same height at landing; the stance sinks
    // and rises again as a half sine, as deep as makes its speed at lift-off the flight's
    // (a stride takes at most 0.8 s: at a jog, the cadence stays up and the steps shorten)
    const T = Math.min(g.stride / Math.max(g.v, 0.01), 0.8), ts = g.duty * T, tf = Math.max(0, 0.5 - g.duty) * T
    const flightH = (9.81 * tf * tf) / 8, sink = (9.81 * tf * ts) / (2 * Math.PI)
    const runWave = (phase: number): number => {
      const s = (((phase % 0.5) + 0.5) % 0.5)
      if (s < g.duty) return -sink * Math.sin((Math.PI * s) / g.duty)
      const w = (s - g.duty) / (0.5 - g.duty)
      return 4 * flightH * w * (1 - w)
    }
    const wave = (phase: number): number => amp * Math.cos(4 * Math.PI * (phase - 0.25)) + g.runAmt * runWave(phase)
    const limit = new Float64Array(N)
    for (let i = 0; i < N; i++) limit[i] = this.hipLimit(this.pelvis(i / N, g), this.feet(i / N, g), g)
    // the hips ride that wave, lowered as a whole until it fits under the legs' reach everywhere. (Riding the reach
    // limit itself kinks at every footfall: a fast drop, then a stop.) The rest pose stands with the feet apart;
    // walking puts them under the hips, so the wave may rise a little above the rest height. A few millimetres
    // short of full reach where it's tightest: a leg at full stretch is where the knee's angle is most sensitive,
    // and would flick as the feet change.
    let top = this.restHipMid.y + 0.04 * this.rest.rig.s
    for (let i = 0; i < N; i++) top = Math.min(top, limit[i] - wave(i / N) - 0.004 * this.rest.rig.s)
    const cap = new Float64Array(N)
    for (let i = 0; i < N; i++) cap[i] = Math.min(top + wave(i / N), limit[i])
    // the limit dips sharply where a foot lifts off; landings fall on samples but lift-offs usually don't, so
    // lower the samples either side until the line between them passes under the dip (by nothing when the dip
    // is at a sample, so the table stays continuous as the speed changes)
    for (const off of [g.duty % 1, (g.duty + 0.5) % 1]) {
      const x = off * N
      const i = Math.floor(x) % N, j = (i + 1) % N, f = x - Math.floor(x)
      const over = (1 - f) * cap[i] + f * cap[j] - this.hipLimit(this.pelvis(off, g), this.feet(off, g), g)
      if (over > 0) {
        cap[i] -= over
        cap[j] -= over
      }
    }
    const H = blur(cap, 5)
    const excess = H.map((h, i) => Math.max(0, h - cap[i]))
    // widen by the blur's reach first, so the blurred correction covers the excess everywhere
    const wide = excess.map((_, i) => {
      let m = 0
      for (let k = -3; k <= 3; k++) m = Math.max(m, excess[(i + k + N) % N])
      return m
    })
    const fix = blur(wide, 3)
    return H.map((h, i) => h - fix[i])
  }

  private feet(phase: number, g: GaitParams): Record<Side, FootTarget> {
    return { L: this.foot('L', phase % 1, g), R: this.foot('R', (phase + 0.5) % 1, g) }
  }

  /**
   * The highest the hip midpoint can be with both ankles on their targets. A running stance leg is nearly
   * straight when it lands and pushes off and most bent in between; the swing leg uses the landing reach, so the
   * limit doesn't jump when a foot lands or lifts.
   */
  private hipLimit(pm: PelvisMotion, feet: Record<Side, FootTarget>, g: GaitParams): number {
    let h = Infinity
    for (const side of SIDES) {
      const f = feet[side]
      // (walking: a stance knee flexes only about 5–15°; running: it sinks into the stance)
      // (running: nearly straight at landing and push-off, bending to about 44° at mid-stance)
      const r = this.L * (lerp(0.997, 0.99, g.runAmt) - g.runAmt * (0.005 + (f.stance ? 0.055 * Math.sin(Math.PI * f.u) : 0)))
      // the hip joint is at (pm.x, h, 0) plus the rotated rest offset from the hip midpoint
      const o = rotate(pm.rot, this.hip[side].subtract(this.restHipMid))
      const horiz = Math.min(r * 0.999, Math.hypot(pm.x + o.x - f.ankle.x, o.z - f.ankle.z))
      h = Math.min(h, f.ankle.y - o.y + Math.sqrt(r * r - horiz * horiz))
    }
    return h
  }

  /** The table at any phase (Catmull-Rom, so the pelvis speed has no corners). */
  private hipAt(phase: number): number {
    const H = this.hipTable
    const N = H.length
    const x = (((phase % 1) + 1) % 1) * N
    const i = Math.floor(x) % N
    const t = x - Math.floor(x)
    const p0 = H[(i + N - 1) % N], p1 = H[i], p2 = H[(i + 1) % N], p3 = H[(i + 2) % N]
    return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)))
  }

  /**
   * phase: 0..1 over a stride (left foot lands at 0, right at 0.5). speed m/s, runAmt 0 walk .. 1 run,
   * grade rise/run, t seconds (for small idle motions).
   */
  gait(out: Pose, phase: number, speed: number, runAmt: number, grade: number, t: number): void {
    const v = Math.max(0, speed)
    const g = this.gaitParams(v, runAmt, grade)
    const key = `${v.toFixed(2)}|${runAmt.toFixed(2)}|${grade.toFixed(2)}`
    if (key !== this.hipKey) {
      this.hipKey = key
      this.hipTable = this.hipCurve(g)
    }
    const lean = g.lean
    const armAmp = lerp(0.12 + 0.12 * Math.min(v, 2), 0.36 + 0.05 * Math.min(v, 7), runAmt)
    // (walking arms hang with a relaxed bend, more on the forward swing; running arms are held at about 75°)
    const elbow = lerp(0.3 + 0.08 * v, 1.32, runAmt)
    // (the shoulders turn against the hips, about 7° each way walking, and roll forward with each arm)
    const chestYaw = lerp(0.12, 0.14, runAmt) * g.move
    const protract = lerp(0.09, 0.03, runAmt) * g.move
    const p2 = TAU * phase
    const pm = this.pelvis(phase, g)
    const pelvisYaw = pm.yaw
    const pelvisRoll = pm.roll
    const qp = pm.rot
    const feet = this.feet(phase, g)
    // the table is smooth; the exact limit only bites between its samples
    this.setHips(out, qp, new Vector3(pm.x, Math.min(this.hipAt(phase), this.hipLimit(pm, feet, g)), 0))

    for (const side of SIDES) {
      const sx = sgn(side)
      const f = feet[side]
      const pole = rotate(ypr(pelvisYaw, 0, 0), new Vector3(sx * 0.08, 0, 1))
      this.leg(out, side, f.ankle, pole, f.pitch, f.yaw, f.toe)
    }

    const spineW = qp.multiply(ypr(-pelvisYaw * 0.5, lean * 0.35, -pelvisRoll * 0.5))
    // (and tilt a little the other way to the hips' drop)
    const chestW = ypr(-chestYaw * Math.cos(p2), lean * 0.7, -pelvisRoll * 0.6)
    const nod = 0.02 * Math.cos(2 * p2) * (0.5 + runAmt)
    const neckW = ypr(-chestYaw * Math.cos(p2) * 0.5, lean * 0.45, 0)
    const headW = ypr(0.02 * Math.sin(t * 0.3), -0.02 + nod + lerp(0.02, 0.06, runAmt), 0)
    this.spineChain(out, qp, spineW, chestW, neckW, headW)
    const abd = this.armAbduction() + 0.04 * runAmt
    for (const side of SIDES) {
      const sx = sgn(side)
      // how far forward this arm is in its swing, 0..1, smooth (a hard max(0, …) kinks twice a stride)
      const fwd = ((1 + sx * Math.cos(p2)) / 2) ** 2
      // (walking arms swing a little more forward than back; running arms swing about 30° each way and bend more
      // coming forward, the hands travelling from beside the hip up to about chest height rather than reaching out)
      const swing = sx * armAmp * Math.cos(p2) + lerp(0.04, 0.08, runAmt)
      const e = elbow + lerp(0.3, 0.6, runAmt) * fwd
      // the forearm crosses toward the midline in front of the chest, but on the back swing the hand passes
      // beside the hip, not through it
      const inward = lerp(0.2, 0.3, runAmt) * (0.15 + 0.85 * fwd)
      this.armSwing(out, side, chestW, swing, abd, e, inward, 0.03 * runAmt * Math.cos(p2) * sx, protract * Math.cos(p2))
    }
  }

  /**
   * Metres per step at this speed. Running strides are the default avatar's, scaled by leg length at the same
   * Froude number: a small body at 5 m/s runs like the default one would at a higher speed, not in giant leaps.
   */
  stepLength(speed: number, runAmt: number): number {
    const L = this.L
    const v = Math.max(0, speed)
    const walk = L * clamp(0.36 + 0.32 * v, 0.36, 0.98)
    const v0 = v * Math.sqrt(REF_LEG / L)
    const run = Math.max(walk, (L / REF_LEG) * (v0 / clamp(2.45 + 0.1 * v0, 2.5, 3.3)))
    return lerp(walk, run, runAmt)
  }

  // ------------------------------------------------------------------------------------------------ cycling

  /** Where the ankle goes for a pedal at crank angle a (0 = top, forward is +), and the foot's pitch there. */
  pedalAnkle(fit: BikeFit, side: Side, a: number): { ankle: Vector3; pitch: number } {
    const s = this.rest.rig.s
    const pedal = new Vector3(sgn(side) * fit.qFactor, fit.bb.y + fit.crank * Math.cos(a), fit.bb.z + fit.crank * Math.sin(a))
    const pitch = 0.2 - 0.13 * Math.cos(a) + 0.05 * Math.sin(a)
    const q = ypr(0, pitch, 0)
    const ball = pedal.add(rotate(q, new Vector3(0, 0.018 * s + 0.012, 0)))
    return { ankle: ball.subtract(rotate(q, this.toBall)), pitch }
  }

  private computeFit(lean: number): BikeFit {
    const rig = this.rest.rig
    const s = rig.s
    const k = clamp(rig.height / 1.75, 0.78, 1.18)
    const crank = 0.17 * k
    const bb = new Vector3(0, 0.29 * k, 0)
    const qFactor = rig.hipHalf * 0.72 + 0.045 * s
    const fit: BikeFit = {
      k, bb, crank, qFactor, hip: Vector3.Zero(), saddle: Vector3.Zero(), grip: Vector3.Zero(), wrist: Vector3.Zero(),
      lean, pelvisTilt: lean * 0.42, wheelRadius: 0.34 * k, rearZ: -0.41 * k, frontZ: 0.6 * k,
    }
    // seat along a 73 degree seat tube, as high as keeps ~40 degrees of knee bend at full extension
    const dir = new Vector3(0, Math.sin(1.274), -Math.cos(1.274))
    const target = 0.93 * this.L
    let lo = 0.3 * this.L, hi = 1.3 * this.L
    for (let it = 0; it < 30; it++) {
      const mid = (lo + hi) / 2
      const hip = bb.add(dir.scale(mid))
      let far = 0
      for (let i = 0; i < 36; i++) {
        const { ankle } = this.pedalAnkle(fit, 'R', (i / 36) * TAU)
        far = Math.max(far, Vector3.Distance(new Vector3(rig.hipHalf, hip.y, hip.z), ankle))
      }
      if (far > target) hi = mid
      else lo = mid
    }
    fit.hip = bb.add(dir.scale(lo))
    fit.saddle = fit.hip.add(new Vector3(0, -(this.restHipMid.y - rig.crotchY) * 0.95, -0.03 * s))
    // hands: with the torso leaning, reach down and forward so the bars (under the palms, below the wrists) end up
    // just above saddle height
    const probe = new PoseProbe(this)
    const shoulder = probe.shoulder(fit)
    const armLen = rig.upperArmLen + rig.forearmLen
    const reach = 0.9 * armLen
    const wy = fit.saddle.y + 0.03 * k + 0.055 * s
    const dy = Math.min(reach * 0.98, shoulder.y - wy)
    const dz = Math.sqrt(Math.max(0, reach * reach - dy * dy))
    fit.wrist = new Vector3(shoulder.x + 0.03 * s, shoulder.y - dy, shoulder.z + dz)
    // the bar lies under the palm, just short of the knuckles
    fit.grip = fit.wrist.add(GRIP_DIR.scale(0.42 * rig.handLen)).add(GRIP_PALM.scale(0.026 * s))
    return fit
  }

  /** Seated pedalling. crank: radians (right pedal at the top = 0); effort 0..1. */
  cycle(out: Pose, crank: number, effort: number, t: number): void {
    const fit = this.fit
    const rig = this.rest.rig
    const s = rig.s
    const rock = (0.015 + 0.035 * effort) * Math.sin(crank)
    const bounce = 0.004 * s * Math.cos(2 * crank) * (0.3 + effort)
    const lean = fit.lean + 0.08 * effort
    const qp = ypr(0.012 * Math.sin(crank), fit.pelvisTilt + 0.03 * effort, rock)
    this.setHips(out, qp, fit.hip.add(new Vector3(0, bounce, 0)))
    for (const side of SIDES) {
      const sx = sgn(side)
      const a = crank + (side === 'R' ? 0 : Math.PI)
      const { ankle, pitch } = this.pedalAnkle(fit, side, a)
      this.leg(out, side, ankle, new Vector3(sx * 0.06, 0.25, 1), pitch, 0, 0)
    }
    const breath = Math.sin(t * (1.6 + 1.4 * effort))
    const spineW = qp.multiply(ypr(0, (lean - fit.pelvisTilt) * 0.45 + 0.005 * breath, -rock * 0.4))
    const chestW = ypr(-0.02 * Math.sin(crank) * (0.5 + effort), lean * 0.95 + 0.004 * breath, -rock * 0.9)
    const neckW = ypr(0, lean * 0.35, 0)
    const headW = ypr(0.015 * Math.sin(t * 0.4), -0.1, 0)
    this.spineChain(out, qp, spineW, chestW, neckW, headW)
    for (const side of SIDES) {
      const sx = sgn(side)
      const wrist = new Vector3(sx * fit.wrist.x, fit.wrist.y, fit.wrist.z)
      const handDir = new Vector3(sx * GRIP_DIR.x, GRIP_DIR.y, GRIP_DIR.z)
      const thumb = new Vector3(sx * GRIP_THUMB.x, GRIP_THUMB.y, GRIP_THUMB.z)
      this.armReach(out, side, chestW, wrist, new Vector3(sx * 1, -0.5, -0.5), handDir, thumb)
    }
  }
}

/** Runs just enough of the cycling pose to find where the shoulders end up (for fitting the handlebars). */
class PoseProbe {
  private readonly p: BodyPoser
  constructor(p: BodyPoser) {
    this.p = p
  }

  shoulder(fit: BikeFit): Vector3 {
    const r = this.p.rest
    const qp = ypr(0, fit.pelvisTilt, 0)
    const hipsPos = fit.hip.add(rotate(qp, this.p.restHips.subtract(this.p.restHipMid)))
    const spineW = qp.multiply(ypr(0, (fit.lean - fit.pelvisTilt) * 0.45, 0))
    const chestW = ypr(0, fit.lean * 0.95, 0)
    const spinePos = hipsPos.add(rotate(qp, r.offset[r.i('spine')]))
    const chestPos = spinePos.add(rotate(spineW, r.offset[r.i('chest')]))
    const shoulderPos = chestPos.add(rotate(chestW, r.offset[r.i('shoulder.R')]))
    return shoulderPos.add(rotate(chestW, r.offset[r.i('upperArm.R')]))
  }
}
