/** The hip height a gait wants against what the legs allow, over a stride: node tools/hiplimit.ts speed run */
import { buildAvatarGeometry, preloadAssets } from '../src/body/build.ts'
import { BodyPoser } from '../src/anim/poser.ts'
import { RestSkeleton } from '../src/anim/pose.ts'
import { PRESETS } from '../src/presets.ts'
const spec = PRESETS.find((p) => p.id === 'sam')!.spec
await preloadAssets(spec)
const rig = buildAvatarGeometry(spec).rig
const [speed, run] = process.argv.slice(2).map(Number)
const p = new BodyPoser(new RestSkeleton(rig)) as unknown as Record<string, (...a: unknown[]) => unknown> & { restHipMid: { y: number } }
const g = p.gaitParams(speed, run, 0) as { duty: number; bob: number }
const table = p.hipCurve(g) as Float64Array
console.log(`duty ${g.duty.toFixed(2)}  bob ${g.bob.toFixed(3)}  rest hips ${p.restHipMid.y.toFixed(3)}`)
for (let i = 0; i < 16; i++) {
  const ph = i / 16
  const feet = p.feet(ph, g) as Record<string, { stance: boolean; u: number }>
  const lim = p.hipLimit(p.pelvis(ph, g), feet, g) as number
  console.log(`${ph.toFixed(3)}  table ${table[Math.round(ph * table.length) % table.length].toFixed(3)}  limit ${lim.toFixed(3)}  L ${feet.L.stance ? 'stance' : 'swing '} ${feet.L.u.toFixed(2)}  R ${feet.R.stance ? 'stance' : 'swing '} ${feet.R.u.toFixed(2)}`)
}
