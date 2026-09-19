/** Gait numbers over one stride (knee flexion, arm swing, elbow, pelvis bob), to tune against walking and running data: node tools/gait.ts [speed] [walk|run] */
import { Vector3 } from '@babylonjs/core'
import { normalizeSpec } from '../src/spec.ts'
import { buildAvatarGeometry, preloadAssets } from '../src/body/build.ts'
import { Animator } from '../src/anim/animator.ts'
import { FK } from '../src/anim/pose.ts'
import { PRESETS } from '../src/presets.ts'
const spec = PRESETS.find((p) => p.id === 'sam')!.spec
await preloadAssets(spec)
const rig = buildAvatarGeometry(spec).rig
const mode = (process.argv[3] ?? 'walk') as 'walk' | 'run'
const a = new Animator(); a.bind(rig); a.set({ mode, speed: Number(process.argv[2] ?? 1.4) })
for (let i = 0; i < 400; i++) a.update(1 / 120)
const fk = new FK(a.rest)
const P = (n: string) => fk.pos[a.rest.i(n)].clone()
const deg = (r: number) => (r * 180) / Math.PI
const ang = (u: Vector3, v: Vector3) => deg(Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(u.normalize(), v.normalize())))))
const rows: string[] = []
let kmin = 1e9, kmax = -1e9, amin = 1e9, amax = -1e9, emin = 1e9, emax = -1e9, hmin = 1e9, hmax = -1e9, wmax = 0
const period = 2 * a.poser.stepLength(a.motion.speed, mode === 'run' ? 1 : 0) / a.motion.speed
for (let k = 0; k < 16; k++) {
  for (let i = 0; i < Math.round(period * 120 / 16); i++) a.update(1 / 120)
  fk.run((a as any).out)
  const hip = P('thigh.R'), knee = P('shin.R'), ankle = P('foot.R'), sh = P('upperArm.R'), el = P('forearm.R'), wr = P('hand.R')
  const kneeFlex = 180 - ang(hip.subtract(knee), ankle.subtract(knee))
  const up = el.subtract(sh)
  const armSag = deg(Math.atan2(up.z, -up.y)) // + forward
  const armOut = deg(Math.atan2(up.x, -up.y))
  const elbow = 180 - ang(sh.subtract(el), wr.subtract(el))
  const hipsY = P('hips').y
  kmin = Math.min(kmin, kneeFlex); kmax = Math.max(kmax, kneeFlex); amin = Math.min(amin, armSag); amax = Math.max(amax, armSag)
  emin = Math.min(emin, elbow); emax = Math.max(emax, elbow); hmin = Math.min(hmin, hipsY); hmax = Math.max(hmax, hipsY)
  wmax = Math.max(wmax, Math.abs(wr.x - hip.x))
  rows.push(`${(k / 16).toFixed(2)}  kneeR ${kneeFlex.toFixed(0).padStart(3)}  ankleY ${ankle.y.toFixed(3)}  armFwd ${armSag.toFixed(0).padStart(4)}  armOut ${armOut.toFixed(0).padStart(3)}  elbow ${elbow.toFixed(0).padStart(3)}  hipsY ${hipsY.toFixed(3)}`)
}
console.log(rows.join('\n'))
console.log(`knee ${kmin.toFixed(0)}..${kmax.toFixed(0)}  armFwd ${amin.toFixed(0)}..${amax.toFixed(0)}  elbow ${emin.toFixed(0)}..${emax.toFixed(0)}  bob ${((hmax - hmin) * 100).toFixed(1)} cm  restHips ${rig.joints.hips[1].toFixed(3)}  L ${(rig.joints['thigh.R'][1]-rig.joints['foot.R'][1]).toFixed(3)}`)
