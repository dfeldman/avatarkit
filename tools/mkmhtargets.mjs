/**
 * Packs MakeHuman's targets and modifier definitions into public/mh/:
 *
 *   node tools/mkmhtargets.mjs <makehuman/data dir>
 *
 * - targets/<path>.bin: one per target, fetched on demand: uint32 count, float32 step (metres), uint16 vertex
 *   indices (padded to 4 bytes), int16 x/y/z moves in that step (at least 10 µm; MakeHuman's decimetres as metres)
 * - modifiers.json: every modifier (modeling, measurement, body shapes) as MakeHuman defines them, the macro
 *   targets with the macro variables their names encode, and MakeHuman's slider layout for the designer.
 * Macro targets are kept for adults, 25 to 90 (MakeHuman's young and old); children and babies would add more
 * than 100 MB and the games are for adults.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

const data = process.argv[2]
if (!data) throw new Error('usage: node tools/mkmhtargets.mjs <makehuman/data dir>')
const TDIR = join(data, 'targets')
const OUT = 'public/mh'
const STEP = 1e-5

function walk(d) { return readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p] }) }
const all = walk(TDIR).filter((f) => f.endsWith('.target')).map((f) => relative(TDIR, f).replace(/\.target$/, ''))
const have = new Set(all)

// ---- the macro variables a target's name encodes (MakeHuman: the product of their values is its weight)
const COMPONENTS = {
  female: 'gender', male: 'gender', baby: 'age', child: 'age', young: 'age', old: 'age',
  minmuscle: 'muscle', averagemuscle: 'muscle', maxmuscle: 'muscle', minweight: 'weight', averageweight: 'weight', maxweight: 'weight',
  minheight: 'height', maxheight: 'height', idealproportions: 'proportions', uncommonproportions: 'proportions',
  mincup: 'cup', averagecup: 'cup', maxcup: 'cup', minfirmness: 'firmness', averagefirmness: 'firmness', maxfirmness: 'firmness',
  african: 'ethnic', asian: 'ethnic', caucasian: 'ethnic',
}
const macroTargets = []
for (const t of all) {
  const inMacro = t.startsWith('macrodetails/') || /^breast\/(female|male)-/.test(t)
  if (!inMacro) continue
  const parts = t.split('/').pop().replace(/^universal-/, '').split('-')
  if (!parts.every((p) => p in COMPONENTS)) { console.warn('macro target with unknown parts:', t); continue }
  if (!parts.includes('young') && !parts.includes('old')) continue // adults only
  macroTargets.push({ target: t, parts })
}

// ---- detail modifiers, as MakeHuman's modifier files define them
const modifiers = []
const macros = []
for (const file of ['modeling_modifiers.json', 'measurement_modifiers.json', 'bodyshapes_modifiers.json']) {
  for (const g of JSON.parse(readFileSync(join(data, 'modifiers', file), 'utf8'))) {
    for (const m of g.modifiers) {
      if (m.macrovar) { macros.push({ group: g.group, variable: m.macrovar }); continue }
      const base = `${g.group}/${m.target}`
      let mod
      if (m.min && m.max) mod = { name: `${base}-${m.min}|${m.max}`, group: g.group, min: -1, max: 1, targets: [`${base}-${m.min}`, `${base}-${m.max}`] }
      else if (m.max) mod = { name: `${base}-${m.max}`, group: g.group, min: 0, max: 1, targets: [null, `${base}-${m.max}`] }
      else mod = { name: base, group: g.group, min: 0, max: 1, targets: [null, base] }
      const missing = mod.targets.filter((t) => t && !have.has(t))
      if (missing.length) { console.warn(`${mod.name}: no target ${missing.join(', ')}`); continue }
      if (!modifiers.some((x) => x.name === mod.name)) modifiers.push(mod)
    }
  }
}

// ---- pack every target that's used
// MakeHuman's facial expression units (per ancestry: expression/units/<african|asian|caucasian>/<unit>): blinks,
// brow raises, smiles and so on, blended by the ancestry macros like everything else and played as morph targets
const expressionTargets = all.filter((t) => t.startsWith('expression/units/'))
const expressionUnits = [...new Set(expressionTargets.map((t) => t.split('/').pop()))].sort()
const used = new Set([...macroTargets.map((m) => m.target), ...modifiers.flatMap((m) => m.targets.filter(Boolean)), ...expressionTargets])
let bytes = 0
for (const t of used) {
  const rows = []
  for (const ln of readFileSync(join(TDIR, `${t}.target`), 'utf8').split('\n')) {
    if (!/^\d/.test(ln)) continue
    const [i, x, y, z] = ln.trim().split(/\s+/).map(Number)
    rows.push([i, x * 0.1, y * 0.1, z * 0.1])
  }
  rows.sort((a, b) => a[0] - b[0])
  const n = rows.length
  // (each target has its own step: most move millimetres, the height targets tens of centimetres)
  let big = 0
  for (const [, x, y, z] of rows) big = Math.max(big, Math.abs(x), Math.abs(y), Math.abs(z))
  const step = Math.max(STEP, big / 32000)
  const pad = (n * 2 + 3) & ~3
  const buf = new ArrayBuffer(8 + pad + n * 6)
  new Uint32Array(buf, 0, 1)[0] = n
  new Float32Array(buf, 4, 1)[0] = step
  const idx = new Uint16Array(buf, 8, n)
  const d = new Int16Array(buf, 8 + pad, n * 3)
  rows.forEach(([i, x, y, z], k) => {
    idx[k] = i
    d[3 * k] = Math.round(x / step)
    d[3 * k + 1] = Math.round(y / step)
    d[3 * k + 2] = Math.round(z / step)
  })
  const out = join(OUT, 'targets', `${t}.bin`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, Buffer.from(buf))
  bytes += buf.byteLength
}
const sliders = JSON.parse(readFileSync(join(data, 'modifiers', 'modeling_sliders.json'), 'utf8'))
writeFileSync(join(OUT, 'modifiers.json'), JSON.stringify({
  source: 'MakeHuman modifiers and targets — released as CC0 in September 2020',
  macros, macroTargets, modifiers, sliders, expressionUnits,
}))
console.log(`macro variables ${macros.length}, macro targets ${macroTargets.length}, modifiers ${modifiers.length}, targets packed ${used.size} (${(bytes / 1024 / 1024).toFixed(1)} MB)`)
