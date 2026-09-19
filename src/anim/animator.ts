/**
 * Animator: turns a Motion (what the player is doing) into a Pose every frame, blending idle, walking, running
 * and cycling smoothly. Games set the motion from their own inputs; nothing here reads devices.
 */
import { Vector3 } from '@babylonjs/core'
import type { Rig } from '../body/rig.ts'
import { Pose, RestSkeleton } from './pose.ts'
import { BodyPoser, type BikeFit } from './poser.ts'
import { ClipRetarget, type ClipSet } from './clips.ts'

export type MotionMode = 'idle' | 'walk' | 'run' | 'cycle'

export interface Motion {
  /** 'walk' becomes a run above ~2.6 m/s; 'run' jogs even when slow */
  mode: MotionMode
  /** ground speed, m/s (walk/run) */
  speed: number
  /** pedal cadence, rpm (cycle) */
  cadence: number
  /** crank angle in radians; when set the animator follows it instead of integrating cadence */
  crank: number | null
  /** 0..1: posture and breathing */
  effort: number
  /** slope under the feet, rise/run */
  grade: number
}

const DEFAULT_MOTION: Motion = { mode: 'idle', speed: 0, cadence: 0, crank: null, effort: 0.3, grade: 0 }

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const approach = (x: number, target: number, rate: number, dt: number): number => x + (target - x) * (1 - Math.exp(-rate * dt))

export class Animator {
  motion: Motion = { ...DEFAULT_MOTION }
  rest!: RestSkeleton
  poser!: BodyPoser
  private out!: Pose
  private a!: Pose
  private b!: Pose
  private time = 0
  private phase = 0
  private crankAngle = 0
  private speed = 0
  private runW = 0
  private cycleW = 0
  private bound = false
  // motion clips (Quaternius' library): one plays over the procedural pose, fading in and out
  private clipSet: ClipSet | null = null
  private clips: ClipRetarget | null = null
  private c!: Pose
  private clip: { name: string; t: number; speed: number } | null = null
  private clipW = 0
  private rig: Rig | null = null

  bind(rig: Rig): void {
    const keepCycle = this.bound
    this.rest = new RestSkeleton(rig)
    this.poser = new BodyPoser(this.rest)
    this.out = new Pose(this.rest.names)
    this.a = new Pose(this.rest.names)
    this.b = new Pose(this.rest.names)
    this.c = new Pose(this.rest.names)
    this.rig = rig
    this.clips = this.clipSet ? new ClipRetarget(this.clipSet, rig) : null
    if (!keepCycle) this.cycleW = this.motion.mode === 'cycle' ? 1 : 0
    this.bound = true
  }

  /** The clip library to play from (see loadClips). */
  useClips(set: ClipSet | null): void {
    this.clipSet = set
    this.clips = set && this.rig ? new ClipRetarget(set, this.rig) : null
  }

  /**
   * Play a motion clip over the procedural motion (it fades in over a quarter second); loops until stopped, others
   * fade back out when they end. A list plays in order, each one-shot running straight into the next (a jump's
   * take-off, then its landing). null stops. `speed` scales the playback rate.
   */
  play(name: string | string[] | null, opts: { speed?: number } = {}): void {
    const names = name === null ? [] : Array.isArray(name) ? name : [name]
    if (!names.length) { this.clip = null; this.queue = []; return }
    for (const n of names) if (!this.clipSet?.clips[n]) throw new Error(`no motion clip ${n} (useClips first)`)
    this.queue = names.slice(1)
    if (this.clip?.name === names[0]) { this.clip.speed = opts.speed ?? this.clip.speed; return }
    this.clip = { name: names[0], t: 0, speed: opts.speed ?? 1 }
  }

  private queue: string[] = []

  /** The clip playing (or fading out), if any. */
  get playing(): string | null {
    return this.clip?.name ?? null
  }

  set(m: Partial<Motion>): void {
    this.motion = { ...this.motion, ...m }
  }

  get fit(): BikeFit {
    return this.poser.fit
  }

  /** Current crank angle (radians), for spinning a bike's cranks in sync. */
  get crank(): number {
    return this.crankAngle
  }

  /** How far the pose is toward cycling (0..1): show the bike when > 0. */
  get cycling(): number {
    return this.cycleW
  }

  /** Current gait phase (0..1 per stride). */
  get gaitPhase(): number {
    return this.phase
  }

  /** Jump straight to the current motion (no blending), e.g. when an avatar first appears. */
  snap(): void {
    const m = this.motion
    this.cycleW = m.mode === 'cycle' ? 1 : 0
    this.speed = m.mode === 'idle' ? 0 : m.speed
    this.runW = this.runTarget(this.speed)
  }

  private runTarget(speed: number): number {
    switch (this.motion.mode) {
      case 'run': return smooth(0.4, 1.0, speed)
      case 'walk': return smooth(2.4, 2.9, speed)
      default: return 0
    }
  }

  update(dt: number): Pose {
    const m = this.motion
    this.time += dt
    const t = this.time
    this.cycleW = Math.min(1, Math.max(0, this.cycleW + (m.mode === 'cycle' ? dt : -dt) / 0.35))
    const targetSpeed = m.mode === 'idle' || m.mode === 'cycle' ? 0 : Math.max(0, m.speed)
    this.speed = approach(this.speed, targetSpeed, 5, dt)
    this.runW = approach(this.runW, this.runTarget(this.speed), 4, dt)
    const moveW = smooth(0.02, 0.3, this.speed)
    if (this.speed > 0.005) {
      const stride = 2 * this.poser.stepLength(this.speed, this.runW)
      this.phase = (this.phase + (dt * this.speed) / stride) % 1
    }
    if (m.crank !== null && Number.isFinite(m.crank)) this.crankAngle = m.crank
    else this.crankAngle = (this.crankAngle + (dt * Math.max(0, m.cadence) * Math.PI * 2) / 60) % (Math.PI * 2)

    const out = this.out
    if (this.cycleW < 1) {
      this.poser.idle(out, t, 1 + m.effort)
      if (moveW > 0) {
        this.poser.gait(this.a, this.phase, this.speed, this.runW, m.grade, t)
        out.blend(this.a, moveW)
      }
    }
    if (this.cycleW > 0) {
      this.poser.cycle(this.b, this.crankAngle, m.effort, t)
      if (this.cycleW >= 1) out.copyFrom(this.b)
      else out.blend(this.b, smooth(0, 1, this.cycleW))
    }
    // a motion clip over it all
    const clip = this.clip
    if (clip && this.clips) {
      clip.t += dt * clip.speed
      const c = this.clipSet!.clips[clip.name]
      if (!c.loop && clip.t >= this.clips.duration(clip.name)) {
        const next = this.queue.shift()
        this.clip = next ? { name: next, t: 0, speed: clip.speed } : null
      }
    }
    this.clipW = Math.min(1, Math.max(0, this.clipW + (this.clip ? dt : -dt) / 0.25))
    if (this.clipW > 0 && this.clips) {
      this.clips.pose(this.c, (this.clip ?? this.lastClip).name, (this.clip ?? this.lastClip).t)
      if (this.clip) this.lastClip = this.clip
      if (this.clipW >= 1) out.copyFrom(this.c)
      else out.blend(this.c, smooth(0, 1, this.clipW))
    }
    return out
  }

  private lastClip: { name: string; t: number; speed: number } = { name: '', t: 0, speed: 1 }
}
