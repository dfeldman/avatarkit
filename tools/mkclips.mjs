/**
 * Motion clips from Quaternius' Universal Animation Library (CC0; the Standard pack's glTF), for our rig:
 *
 *   node tools/mkclips.mjs <AnimationLibrary_Godot_Standard.glb>
 *
 * Writes public/mh/anim/ual.json. For each clip, sampled at 30 fps: each of our bones' world rotation relative to
 * the source's rest pose (a quaternion per bone per frame), and the hips' movement from rest. Also the source's rest
 * direction per bone (joint to child joint) and hip height. The runtime (src/anim/clips.ts) turns these into our
 * bones' rotations for any body: it aligns each bone's rest direction to the source's (our rest is an A-pose, theirs
 * a T-pose) and scales the hips' movement by leg length. Rigify's fingers and middle spine segment are dropped (our
 * hands are one bone; our chest takes the top spine segment's world rotation, which includes the middle one).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const FPS = 30
const src = process.argv[2]
if (!src) throw new Error('usage: node tools/mkclips.mjs <AnimationLibrary_Godot_Standard.glb>')

// our bone ← the source's (Rigify's .L is +x, which is our .R)
const MAP = {
  hips: 'DEF-hips', spine: 'DEF-spine.001', chest: 'DEF-spine.003', neck: 'DEF-neck', head: 'DEF-head',
  'shoulder.R': 'DEF-shoulder.L', 'upperArm.R': 'DEF-upper_arm.L', 'forearm.R': 'DEF-forearm.L', 'hand.R': 'DEF-hand.L',
  'shoulder.L': 'DEF-shoulder.R', 'upperArm.L': 'DEF-upper_arm.R', 'forearm.L': 'DEF-forearm.R', 'hand.L': 'DEF-hand.R',
  'thigh.R': 'DEF-thigh.L', 'shin.R': 'DEF-shin.L', 'foot.R': 'DEF-foot.L', 'toes.R': 'DEF-toe.L',
  'thigh.L': 'DEF-thigh.R', 'shin.L': 'DEF-shin.R', 'foot.L': 'DEF-foot.R', 'toes.L': 'DEF-toe.R',
}
// each bone's direction: toward this bone's joint (leaves: continue their parent's direction), as in src/anim/clips.ts
export const TIP = {
  hips: 'spine', spine: 'chest', chest: 'neck', neck: 'head', head: null,
  'shoulder.R': 'upperArm.R', 'upperArm.R': 'forearm.R', 'forearm.R': 'hand.R', 'hand.R': null,
  'shoulder.L': 'upperArm.L', 'upperArm.L': 'forearm.L', 'forearm.L': 'hand.L', 'hand.L': null,
  'thigh.R': 'shin.R', 'shin.R': 'foot.R', 'foot.R': 'toes.R', 'toes.R': null,
  'thigh.L': 'shin.L', 'shin.L': 'foot.L', 'foot.L': 'toes.L', 'toes.L': null,
}
const LEAF_FROM = { head: 'neck', 'hand.R': 'forearm.R', 'hand.L': 'forearm.L', 'toes.R': 'foot.R', 'toes.L': 'foot.L' }

// ---- glb
const b = readFileSync(src)
const jl = b.readUInt32LE(12)
const gl = JSON.parse(b.subarray(20, 20 + jl).toString())
const bin = 20 + jl + 8
function accessor(i) {
  const a = gl.accessors[i], v = gl.bufferViews[a.bufferView]
  if (a.componentType !== 5126) throw new Error(`accessor ${i}: not float`)
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type]
  const off = b.byteOffset + bin + (v.byteOffset ?? 0) + (a.byteOffset ?? 0)
  return { n, data: new Float32Array(b.buffer.slice(off, off + a.count * n * 4)) }
}

// ---- quaternion and vector helpers ([x, y, z, w], Babylon's convention: world = parent × local)
const qmul = (a, c) => [
  a[3] * c[0] + a[0] * c[3] + a[1] * c[2] - a[2] * c[1],
  a[3] * c[1] - a[0] * c[2] + a[1] * c[3] + a[2] * c[0],
  a[3] * c[2] + a[0] * c[1] - a[1] * c[0] + a[2] * c[3],
  a[3] * c[3] - a[0] * c[0] - a[1] * c[1] - a[2] * c[2],
]
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]]
const qrot = (q, v) => { const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q)); return [p[0], p[1], p[2]] }
function slerp(a, c, t) {
  let d = a[0] * c[0] + a[1] * c[1] + a[2] * c[2] + a[3] * c[3]
  const cc = d < 0 ? c.map((x) => -x) : c
  d = Math.abs(d)
  if (d > 0.9995) { const r = a.map((x, i) => x + (cc[i] - x) * t); const l = Math.hypot(...r); return r.map((x) => x / l) }
  const th = Math.acos(d), s = Math.sin(th)
  return a.map((x, i) => (Math.sin((1 - t) * th) * x + Math.sin(t * th) * cc[i]) / s)
}

// ---- the node tree, rest TRS
const parent = new Array(gl.nodes.length).fill(-1)
gl.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => (parent[c] = i)))
const rest = gl.nodes.map((n) => ({ t: n.translation ?? [0, 0, 0], r: n.rotation ?? [0, 0, 0, 1], s: n.scale ?? [1, 1, 1] }))
const order = []
const visit = (i) => { order.push(i); for (const c of gl.nodes[i].children ?? []) visit(c) }
for (const r of gl.scenes[gl.scene ?? 0].nodes) visit(r)

/** World rotation and position of every node for local TRS (scale ignored below the root: the rig is unscaled). */
function fk(trs) {
  const wr = [], wp = []
  for (const i of order) {
    const p = parent[i], l = trs[i]
    if (p < 0) { wr[i] = l.r; wp[i] = l.t; continue }
    wr[i] = qmul(wr[p], l.r)
    const t = qrot(wr[p], l.t)
    wp[i] = [wp[p][0] + t[0], wp[p][1] + t[1], wp[p][2] + t[2]]
  }
  return { wr, wp }
}
const byName = new Map(gl.nodes.map((n, i) => [n.name, i]))
const restFk = fk(rest)
const node = (bone) => byName.get(MAP[bone])

// rest directions (world), and the hip height the clips' hip movement is scaled against
const dirOf = (w, bone) => {
  const from = LEAF_FROM[bone] ?? bone, to = LEAF_FROM[bone] ? bone : TIP[bone]
  const a = w.wp[node(from)], c = w.wp[node(to)]
  const d = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const l = Math.hypot(...d) || 1
  return d.map((x) => +(x / l).toFixed(5))
}
const restDirs = Object.fromEntries(Object.keys(MAP).map((bone) => [bone, dirOf(restFk, bone)]))
const hipHeight = restFk.wp[node('hips')][1]

// ---- clips
function sampler(s, t) {
  const inp = accessor(s.input).data, out = accessor(s.output)
  let k = 0
  while (k < inp.length - 1 && inp[k + 1] <= t) k++
  const n = out.n, cubic = s.interpolation === 'CUBICSPLINE'
  const at = (i) => { const o = cubic ? (3 * i + 1) * n : i * n; return Array.from(out.data.subarray(o, o + n)) }
  if (k >= inp.length - 1 || s.interpolation === 'STEP') return at(k)
  const u = Math.max(0, Math.min(1, (t - inp[k]) / (inp[k + 1] - inp[k])))
  const a = at(k), c = at(k + 1)
  return n === 4 ? slerp(a, c, u) : a.map((x, i) => x + (c[i] - x) * u)
}
const clips = {}
for (const anim of gl.animations) {
  let dur = 0
  for (const s of anim.samplers) dur = Math.max(dur, gl.accessors[s.input].max[0])
  const loop = /_Loop$/.test(anim.name)
  // (a loop's last frame repeats its first: leave it out and let the player wrap)
  const frames = Math.max(1, Math.round(dur * FPS) + (loop ? 0 : 1))
  const rot = [], hips = []
  for (let f = 0; f < frames; f++) {
    const t = Math.min(dur, f / FPS)
    const trs = rest.map((r) => ({ ...r }))
    for (const ch of anim.channels) {
      const i = ch.target.node, v = sampler(anim.samplers[ch.sampler], t)
      if (ch.target.path === 'rotation') trs[i] = { ...trs[i], r: v }
      else if (ch.target.path === 'translation') trs[i] = { ...trs[i], t: v }
    }
    const w = fk(trs)
    for (const bone of Object.keys(MAP)) {
      const d = qmul(w.wr[node(bone)], qinv(restFk.wr[node(bone)]))
      rot.push(...d.map((x) => +x.toFixed(4)))
    }
    const h = w.wp[node('hips')], h0 = restFk.wp[node('hips')]
    hips.push(+(h[0] - h0[0]).toFixed(4), +(h[1] - h0[1]).toFixed(4), +(h[2] - h0[2]).toFixed(4))
  }
  clips[anim.name] = { frames, loop, rot, hips }
}

mkdirSync('public/mh/anim', { recursive: true })
const outJson = JSON.stringify({
  source: "Quaternius' Universal Animation Library (Standard), CC0 — quaternius.com", fps: FPS,
  bones: Object.keys(MAP), restDirs, hipHeight: +hipHeight.toFixed(4), clips,
})
writeFileSync('public/mh/anim/ual.json', outJson)
console.log(`${Object.keys(clips).length} clips, ${(outJson.length / 1024).toFixed(0)} KB; source hips at ${hipHeight.toFixed(3)} m`)
