/** The left leg frame by frame around its landing (phase 0): knee angle and velocity, foot pitch, ankle height. node tools/landing.ts [speed] */
import { Vector3 } from '@babylonjs/core'
import { buildAvatarGeometry, preloadAssets } from '../src/body/build.ts'
import { BodyPoser } from '../src/anim/poser.ts'
import { FK, Pose, RestSkeleton } from '../src/anim/pose.ts'
import { PRESETS } from '../src/presets.ts'
const spec = PRESETS.find((p) => p.id === 'sam')!.spec
await preloadAssets(spec)
const rig = buildAvatarGeometry(spec).rig
const v = Number(process.argv[2] ?? 1.4)
const rest = new RestSkeleton(rig), poser = new BodyPoser(rest), pose = new Pose(rest.names), fk = new FK(rest)
const period = (2 * poser.stepLength(v, 0)) / v, dt = 1 / 120
const deg = (r: number): number => (r * 180) / Math.PI
let prevK = NaN, prevV = NaN
for (let f = -14; f <= 14; f++) {
  const phase = (((f * dt) / period) % 1 + 1) % 1
  poser.gait(pose, phase, v, 0, 0, 0)
  fk.run(pose)
  const P = (n: string): Vector3 => fk.pos[rest.i(n)]
  const hip = P('thigh.L'), knee = P('shin.L'), ankle = P('foot.L'), toe = P('toes.L')
  const a = hip.subtract(knee).normalize(), b = ankle.subtract(knee).normalize()
  const k = 180 - deg(Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(a, b)))))
  const kv = Number.isNaN(prevK) ? 0 : (k - prevK) / dt, ka = Number.isNaN(prevV) ? 0 : (kv - prevV) / dt
  prevK = k; prevV = kv
  const pitch = deg(Math.atan2(ankle.y - toe.y, toe.z - ankle.z))
  console.log(`${String(f).padStart(3)}  phase ${phase.toFixed(3)}  knee ${k.toFixed(1).padStart(5)}°  vel ${kv.toFixed(0).padStart(5)}°/s  acc ${ka.toFixed(0).padStart(6)}  footPitch ${pitch.toFixed(1).padStart(5)}  ankleY ${ankle.y.toFixed(4)}  hipY ${P('hips').y.toFixed(4)}`)
}
