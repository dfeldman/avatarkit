// Asset loading and geometry build timings for the presets: node tools/bench.ts
import { buildAvatarGeometry, preloadAssets } from '../src/body/build.ts'
import { PRESETS } from '../src/presets.ts'

for (const p of PRESETS) {
  const t0 = performance.now()
  await preloadAssets(p.spec)
  const t1 = performance.now()
  const g = buildAvatarGeometry(p.spec)
  const t2 = performance.now()
  const tris = g.body.indices.length / 3 + g.proxies.reduce((n, x) => n + x.indices.length / 3, 0)
  let bad = 0
  for (const m of [g.body, ...g.proxies]) for (const x of m.positions) if (!Number.isFinite(x)) bad++
  console.log(`${p.id.padEnd(11)} load ${(t1 - t0).toFixed(0).padStart(4)} ms  build ${(t2 - t1).toFixed(0).padStart(4)} ms  height ${g.rig.height.toFixed(3)} m  tris ${tris} (${g.proxies.length} proxies)  nan ${bad}`)
}
