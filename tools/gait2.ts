/** Fine-grained gait trace for one foot and the hips: node tools/gait2.ts [speed] */
import { Vector3 } from '@babylonjs/core'
import { buildAvatarGeometry, preloadAssets } from '../src/body/build.ts'
import { Animator } from '../src/anim/animator.ts'
import { FK } from '../src/anim/pose.ts'
import { PRESETS } from '../src/presets.ts'
const spec = PRESETS.find((p) => p.id === 'sam')!.spec
await preloadAssets(spec)
const rig = buildAvatarGeometry(spec).rig
const v = Number(process.argv[2] ?? 1.4)
const a = new Animator(); a.bind(rig); a.set({ mode: 'walk', speed: v })
for (let i = 0; i < 600; i++) a.update(1 / 120)
const fk = new FK(a.rest)
const P = (n: string) => fk.pos[a.rest.i(n)].clone()
const period = (2 * a.poser.stepLength(v, 0)) / v
const N = 32
let prevHip = NaN, prevZ = NaN
for (let k = 0; k < N; k++) {
  for (let i = 0; i < Math.round((period * 120) / N); i++) a.update(1 / 120)
  fk.run((a as unknown as { out: never }).out)
  const ankle = P('foot.R'), toe = P('toes.R'), hips = P('hips')
  const pitch = (Math.atan2(ankle.y - toe.y, toe.z - ankle.z) * 180) / Math.PI // + toes down
  const dt = period / N
  const vy = Number.isNaN(prevHip) ? 0 : (hips.y - prevHip) / dt
  const vz = Number.isNaN(prevZ) ? 0 : (ankle.z - prevZ) / dt
  prevHip = hips.y; prevZ = ankle.z
  console.log(`${(k / N).toFixed(3)}  footPitch ${pitch.toFixed(0).padStart(4)}°  ankleY ${ankle.y.toFixed(3)}  toeY ${toe.y.toFixed(3)}  ankleVz ${vz.toFixed(2).padStart(6)}  hipsY ${hips.y.toFixed(3)}  hipVy ${vy.toFixed(2).padStart(6)}`)
}
