/** Spikes in each bone's angular acceleration over two strides (what reads as jerky motion): node tools/jerk.ts [speed] [mode] */
import { Quaternion } from '@babylonjs/core'
import { buildAvatarGeometry, preloadAssets } from '../src/body/build.ts'
import { Animator, type MotionMode } from '../src/anim/animator.ts'
import { FK } from '../src/anim/pose.ts'
import { PRESETS } from '../src/presets.ts'
const spec = PRESETS.find((p) => p.id === 'sam')!.spec
await preloadAssets(spec)
const rig = buildAvatarGeometry(spec).rig
const v = Number(process.argv[2] ?? 1.4), mode = (process.argv[3] ?? 'walk') as MotionMode
const a = new Animator(); a.bind(rig); a.set({ mode, speed: v, cadence: 80 })
const dt = 1 / 120
for (let i = 0; i < 1200; i++) a.update(dt)
const fk = new FK(a.rest)
const names = a.rest.names
const hist: Quaternion[][] = []
const hips: number[] = []
const phases: number[] = []
for (let i = 0; i < 360; i++) {
  fk.run(a.update(dt))
  hist.push(fk.rot.map((q) => q.clone()))
  phases.push((a as unknown as { phase: number }).phase)
  hips.push(fk.pos[a.rest.i('hips')].y)
}
const angle = (p: Quaternion, q: Quaternion): number => 2 * Math.acos(Math.min(1, Math.abs(Quaternion.Dot(p, q))))
const out: string[] = []
for (let b = 0; b < names.length; b++) {
  const w: number[] = []
  for (let i = 1; i < hist.length; i++) w.push(angle(hist[i - 1][b], hist[i][b]) / dt)
  let acc = 0, at = 0
  for (let i = 1; i < w.length; i++) { const x = Math.abs(w[i] - w[i - 1]) / dt; if (x > acc) { acc = x; at = i } }
  const mean = w.reduce((s, x) => s + x, 0) / w.length
  out.push(`${names[b].padEnd(11)} mean ${mean.toFixed(2).padStart(5)} rad/s  peak accel ${acc.toFixed(0).padStart(5)} rad/s²  at ${(at * dt).toFixed(3)} s (phase ${phases[at].toFixed(3)})`)
}
let hacc = 0
for (let i = 1; i < hips.length - 1; i++) hacc = Math.max(hacc, Math.abs(hips[i + 1] - 2 * hips[i] + hips[i - 1]) / (dt * dt))
console.log(out.join('\n'))
console.log(`hips vertical peak accel ${hacc.toFixed(1)} m/s²`)
