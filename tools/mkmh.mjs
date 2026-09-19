/**
 * Turns MakeHuman's CC0 data into the MakeHuman body asset (src/body/mhbase.json):
 *
 *   node tools/mkmh.mjs <dir with base.obj, default.mhskel, default_weights.mhw, eye-high-poly.obj/.mhclo>
 *
 * - every base-mesh vertex (targets, joints and the eye proxy all index the full list), in metres at MakeHuman's
 *   own stature; the `body` group's quads as triangles (never simplified: targets are deltas per vertex)
 * - MakeHuman's skin weights for every vertex, collapsed onto our 21 bones (MakeHuman .L is +X = our .R), top four
 * - the joint vertex sets our rig needs (a joint is the mean of its vertices, so joints follow any morph)
 * - the high-poly eye proxy: its fitting (.mhclo) and its triangles and uvs
 * - the fingers' own joints and weights (the runtime curls them into a relaxed hand; the skinning has no finger bones)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) throw new Error('usage: node tools/mkmh.mjs <makehuman data dir>')
const read = (f) => readFileSync(join(dir, f), 'utf8')

// ---- base mesh
const V = []
const VT = []
const tris = []
const corners = [] // the body's triangle corners as [vertex, uv]
let group = ''
for (const ln of read('base.obj').split('\n')) {
  if (ln.startsWith('v ')) { const p = ln.split(/\s+/); V.push([+p[1] * 0.1, +p[2] * 0.1, +p[3] * 0.1]) }
  else if (ln.startsWith('vt ')) { const p = ln.trim().split(/\s+/); VT.push([+p[1], +p[2]]) }
  else if (ln.startsWith('g ')) group = ln.slice(2).trim()
  else if (ln.startsWith('f ') && group === 'body') {
    const f = ln.trim().split(/\s+/).slice(1).map((t) => t.split('/').map((x) => +x - 1))
    for (let k = 2; k < f.length; k++) { tris.push(f[0][0], f[k - 1][0], f[k][0]); corners.push(f[0], f[k - 1], f[k]) }
  }
}
const used = [...new Set(tris)].sort((a, b) => a - b)
// the render mesh: one vertex per (vertex, uv) pair (the skin texture has seams); each keeps its source vertex
const renderKey = new Map()
const render = { src: [], uv: [], tris: [] }
for (const [v, t] of corners) {
  const k = `${v}/${t}`
  let i = renderKey.get(k)
  if (i === undefined) {
    i = render.src.length
    renderKey.set(k, i)
    render.src.push(v)
    render.uv.push(Math.round(VT[t][0] * 1e5) / 1e5, Math.round(VT[t][1] * 1e5) / 1e5)
  }
  render.tris.push(i)
}

// ---- bones: MakeHuman's 163 onto our 21
const side = (n) => (n.endsWith('.L') ? 'R' : n.endsWith('.R') ? 'L' : '')
const stem = (n) => n.replace(/\.[LR]$/, '')
function ours(n) {
  const s = stem(n), sd = side(n)
  if (['root', 'pelvis', 'spine05'].includes(s)) return 'hips'
  if (['spine04', 'spine03'].includes(s)) return 'spine'
  if (['spine02', 'spine01', 'breast'].includes(s)) return 'chest'
  if (/^neck0/.test(s)) return 'neck'
  if (s === 'clavicle') return `shoulder.${sd}`
  if (['shoulder01', 'upperarm01', 'upperarm02'].includes(s)) return `upperArm.${sd}`
  if (['lowerarm01', 'lowerarm02'].includes(s)) return `forearm.${sd}`
  if (s === 'wrist' || /^metacarpal|^finger/.test(s)) return `hand.${sd}`
  if (['upperleg01', 'upperleg02'].includes(s)) return `thigh.${sd}`
  if (['lowerleg01', 'lowerleg02'].includes(s)) return `shin.${sd}`
  if (s === 'foot') return `foot.${sd}`
  if (/^toe/.test(s)) return `toes.${sd}`
  return 'head' // head, jaw, eyes, tongue and the face's muscles
}
const BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'shoulder.L', 'upperArm.L', 'forearm.L', 'hand.L', 'shoulder.R', 'upperArm.R',
  'forearm.R', 'hand.R', 'thigh.L', 'shin.L', 'foot.L', 'toes.L', 'thigh.R', 'shin.R', 'foot.R', 'toes.R']
const skel = JSON.parse(read('default.mhskel'))
const mhw = JSON.parse(read('default_weights.mhw')).weights
const acc = new Map()
for (const [bone, list] of Object.entries(mhw)) {
  const b = BONES.indexOf(ours(bone))
  if (b < 0) throw new Error(`no bone for ${bone}`)
  for (const [v, w] of list) {
    if (!acc.has(v)) acc.set(v, new Map())
    const m = acc.get(v)
    m.set(b, (m.get(b) ?? 0) + w)
  }
}
// every vertex, helpers included: clothes and hair are fitted to the helper cages, which must pose with the body
const weights = []
let unweighted = 0
for (let v = 0; v < V.length; v++) {
  const m = acc.get(v)
  if (!m) { unweighted++; weights.push([4, 1]); continue } // (a stray vertex rides with the head)
  const top = [...m].sort((a, b) => b[1] - a[1]).slice(0, 4)
  const sum = top.reduce((s, [, w]) => s + w, 0)
  weights.push(top.flatMap(([b, w]) => [b, Math.round((w / sum) * 1e4) / 1e4]))
}

// ---- joints (MakeHuman bone-head names, mapped by x sign in the runtime)
const JOINTS = ['root', 'spine05', 'spine04', 'spine02', 'neck01', 'head', 'clavicle.L', 'upperarm01.L', 'lowerarm01.L', 'wrist.L',
  'upperleg01.L', 'lowerleg01.L', 'foot.L', 'toe3-1.L', 'finger3-3.L', 'toe3-3.L']
const joints = {}
for (const j of JOINTS) {
  joints[j] = skel.joints[`${j}____head`]
  if (j === 'finger3-3.L' || j === 'toe3-3.L') joints[`${j}:tail`] = skel.joints[`${j}____tail`]
  for (const k of [j, `${j}:tail`]) if (k in joints && !Array.isArray(joints[k])) throw new Error(`joint ${k} is not a vertex list`)
}

// ---- fingers: each phalanx's joints and weights (both hands share the indices; the runtime tells them apart by
// x sign), so the rest pose can be given a relaxed, partly closed hand
const FINGERS = [1, 2, 3, 4, 5].flatMap((f) => [1, 2, 3].map((k) => `finger${f}-${k}`))
const fingers = { bones: FINGERS, joints: {}, weights: {} }
for (const f of FINGERS) {
  fingers.joints[f] = skel.joints[`${f}.L____head`]
  if (f.endsWith('-3')) fingers.joints[`${f}:tail`] = skel.joints[`${f}.L____tail`]
}
for (const [bone, list] of Object.entries(mhw)) {
  const f = FINGERS.indexOf(stem(bone))
  if (f < 0) continue
  for (const [v, w] of list) {
    // (as a share of the vertex's whole weight)
    let sum = 0
    for (const x of acc.get(v).values()) sum += x
    ;(fingers.weights[v] ??= []).push(f, Math.round((w / sum) * 1e4) / 1e4)
  }
}
for (const [k, j] of Object.entries(fingers.joints)) if (!Array.isArray(j)) throw new Error(`joint ${k} is not a vertex list`)

// ---- eyes: the high-poly proxy and its fitting
const eyeObjV = [], eyeUV = [], eyeTris = [], eyeTriUV = []
for (const ln of read('eye-high-poly.obj').split('\n')) {
  if (ln.startsWith('v ')) eyeObjV.push(0)
  else if (ln.startsWith('vt ')) { const p = ln.split(/\s+/); eyeUV.push([+p[1], +p[2]]) }
  else if (ln.startsWith('f ')) {
    const f = ln.trim().split(/\s+/).slice(1).map((t) => t.split('/').map((x) => +x - 1))
    for (let k = 2; k < f.length; k++) { eyeTris.push(f[0][0], f[k - 1][0], f[k][0]); eyeTriUV.push(f[0][1], f[k - 1][1], f[k][1]) }
  }
}
// one uv per vertex (the eyeball's seam is at the back, out of sight)
const vUV = new Array(eyeObjV.length).fill(null)
eyeTris.forEach((v, i) => { if (vUV[v] === null) vUV[v] = eyeUV[eyeTriUV[i]] })
const clo = read('eye-high-poly.mhclo').split('\n')
const scale = {}
for (const ln of clo) { const m = ln.match(/^([xyz])_scale\s+(\d+)\s+(\d+)\s+([\d.]+)/); if (m) scale[m[1]] = [+m[2], +m[3], +m[4]] }
const fit = []
let on = false
for (const ln of clo) {
  if (/^verts\s/.test(ln)) { on = true; continue }
  if (!on) continue
  const n = ln.trim().split(/\s+/).map(Number)
  if (n.length === 9 && n.every(Number.isFinite)) fit.push(n)
  else if (fit.length) break
}
if (fit.length !== eyeObjV.length) throw new Error(`eye fitting has ${fit.length} rows for ${eyeObjV.length} vertices`)

const r5 = (x) => Math.round(x * 1e5) / 1e5
const asset = {
  source: 'MakeHuman hm08 base mesh, default skeleton and weights, high-poly eyes — released as CC0 in September 2020',
  bones: BONES,
  positions: V.flat().map(r5),
  tris,
  used,
  render,
  weights,
  joints,
  fingers,
  // the proxy is an eyeball and a clear cornea over it; the cornea's uvs all sit in the texture's corner circle
  eyes: (() => {
    const inCorner = (v) => { const u = vUV[v] ?? [0, 0]; return Math.hypot(u[0] - 0.935, u[1] - 0.0665) < 0.062 }
    const ball = [], cornea = []
    for (let t = 0; t < eyeTris.length; t += 3) (inCorner(eyeTris[t]) ? cornea : ball).push(eyeTris[t], eyeTris[t + 1], eyeTris[t + 2])
    console.log(`eye triangles: ball ${ball.length / 3}, cornea ${cornea.length / 3}`)
    return { fit, scale, tris: ball, cornea, uv: vUV.map((u) => (u ? u.map(r5) : [0, 0])).flat() }
  })(),
}
const out = JSON.stringify(asset)
writeFileSync('src/body/mhbase.json', out)
console.log(`verts ${V.length} (body ${used.length}, ${render.src.length} with uv seams)  tris ${tris.length / 3}  unweighted ${unweighted}  eye verts ${eyeObjV.length} tris ${eyeTris.length / 3}`)
console.log(`joints ${Object.keys(joints).length}  wrote src/body/mhbase.json (${(out.length / 1024).toFixed(0)} KB)`)
