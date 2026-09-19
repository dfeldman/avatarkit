/** Where a foot's lowest point falls over a stride (stance or swing), as the gait tests measure it: node tools/footdebug.ts speed run grade */
import { Vector3 } from '@babylonjs/core'
import { buildAvatarGeometry, preloadAssets } from '../src/body/build.ts'
import { BodyPoser } from '../src/anim/poser.ts'
import { FK, Pose, RestSkeleton } from '../src/anim/pose.ts'
import { rotate } from '../src/anim/qmath.ts'
import { PRESETS } from '../src/presets.ts'
const spec = PRESETS.find((p) => p.id === 'sam')!.spec
await preloadAssets(spec)
const rig = buildAvatarGeometry(spec).rig
const [speed, run, grade] = process.argv.slice(2).map(Number)
const rest = new RestSkeleton(rig), poser = new BodyPoser(rest), pose = new Pose(rest.names), fk = new FK(rest)
// (the heel as the gait tests place it)
const heel = new Vector3(0, 0.012 * rig.s - rig.ankleH, -0.075 * rig.s)
const N = 720, stride = 2 * poser.stepLength(speed, run)
const rows: Array<{ ph: number; ball: number; heel: number }> = []
for (let i = 0; i < N; i++) {
  const phase = i / N
  poser.gait(pose, phase, speed, run, grade, i * 0.001)
  fk.run(pose)
  const shift = new Vector3(0, grade * phase * stride, phase * stride)
  const ball = fk.pos[rest.i('toes.L')].add(shift)
  const hp = fk.pos[rest.i('foot.L')].add(rotate(fk.rot[rest.i('foot.L')], heel)).add(shift)
  rows.push({ ph: phase, ball: ball.y - grade * ball.z, heel: hp.y - grade * hp.z })
}
for (const k of ['ball', 'heel'] as const) {
  const floor = Math.min(...rows.map((r) => r[k]))
  const at = rows.find((r) => r[k] === floor)!.ph
  const down = rows.filter((r) => r[k] - floor < 1e-4).length / N
  console.log(`${k}: floor ${floor.toFixed(5)} at phase ${at.toFixed(3)}; within 0.1 mm of it ${(down * 100).toFixed(0)}% of the stride`)
}
