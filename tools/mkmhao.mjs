/**
 * Bakes ambient occlusion onto MakeHuman's base mesh (src/body/mhbase.json gets `ao`, one value per base vertex):
 *
 *   node tools/mkmhao.mjs
 *
 * For every body vertex, cosine-weighted rays over its hemisphere against the body's own triangles (through a
 * bounding-volume hierarchy); a ray that hits within REACH occludes, nearer hits more. Creases, sockets, the
 * underside of the chin and the armpits come out darker. Shapes from targets move creases only slightly, so one
 * bake serves every body.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const FILE = 'src/body/mhbase.json'
const A = JSON.parse(readFileSync(FILE, 'utf8'))
const P = A.positions, T = A.tris
const RAYS = 48, REACH = 0.18

// vertex normals (area-weighted; MakeHuman winds its faces outward)
const N = new Float64Array(P.length)
for (let t = 0; t < T.length; t += 3) {
  const a = 3 * T[t], b = 3 * T[t + 1], c = 3 * T[t + 2]
  const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2]
  const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
  for (const i of [a, b, c]) { N[i] += nx; N[i + 1] += ny; N[i + 2] += nz }
}
for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= l; N[i + 1] /= l; N[i + 2] /= l }

// BVH over triangles
const nt = T.length / 3
const cen = new Float64Array(nt * 3), lo = new Float64Array(nt * 3), hi = new Float64Array(nt * 3)
for (let t = 0; t < nt; t++) {
  for (let k = 0; k < 3; k++) {
    const vs = [P[3 * T[3 * t] + k], P[3 * T[3 * t + 1] + k], P[3 * T[3 * t + 2] + k]]
    lo[3 * t + k] = Math.min(...vs); hi[3 * t + k] = Math.max(...vs); cen[3 * t + k] = (vs[0] + vs[1] + vs[2]) / 3
  }
}
const order = Array.from({ length: nt }, (_, i) => i)
const nodes = [] // [lo3, hi3, left, right, start, count]
function build(start, end) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (let i = start; i < end; i++) { const t = order[i]; for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], lo[3 * t + k]); b[3 + k] = Math.max(b[3 + k], hi[3 * t + k]) } }
  const id = nodes.length
  nodes.push({ b, l: -1, r: -1, s: start, n: end - start })
  if (end - start <= 6) return id
  const ax = [0, 1, 2].sort((x, y) => (b[3 + y] - b[y]) - (b[3 + x] - b[x]))[0]
  const seg = order.slice(start, end).sort((x, y) => cen[3 * x + ax] - cen[3 * y + ax])
  for (let i = 0; i < seg.length; i++) order[start + i] = seg[i]
  const mid = (start + end) >> 1
  nodes[id].l = build(start, mid)
  nodes[id].r = build(mid, end)
  return id
}
build(0, nt)

function hitBox(b, o, inv, tmax) {
  let t0 = 0, t1 = tmax
  for (let k = 0; k < 3; k++) {
    let a = (b[k] - o[k]) * inv[k], c = (b[3 + k] - o[k]) * inv[k]
    if (a > c) { const x = a; a = c; c = x }
    t0 = Math.max(t0, a); t1 = Math.min(t1, c)
    if (t0 > t1) return false
  }
  return true
}
/** Distance to the nearest triangle along d within tmax (Möller–Trumbore), or Infinity. */
function cast(o, d, tmax, skip) {
  const inv = [1 / d[0], 1 / d[1], 1 / d[2]]
  let best = Infinity
  const stack = [0]
  while (stack.length) {
    const nd = nodes[stack.pop()]
    if (!hitBox(nd.b, o, inv, Math.min(tmax, best))) continue
    if (nd.l >= 0) { stack.push(nd.l, nd.r); continue }
    for (let i = nd.s; i < nd.s + nd.n; i++) {
      const t = order[i]
      const a = 3 * T[3 * t], b = 3 * T[3 * t + 1], c = 3 * T[3 * t + 2]
      if (T[3 * t] === skip || T[3 * t + 1] === skip || T[3 * t + 2] === skip) continue
      const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]
      const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]]
      const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2]
      if (Math.abs(det) < 1e-12) continue
      const f = 1 / det, s = [o[0] - P[a], o[1] - P[a + 1], o[2] - P[a + 2]]
      const u = f * (s[0] * p[0] + s[1] * p[1] + s[2] * p[2])
      if (u < 0 || u > 1) continue
      const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]]
      const v = f * (d[0] * q[0] + d[1] * q[1] + d[2] * q[2])
      if (v < 0 || u + v > 1) continue
      const dist = f * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2])
      if (dist > 1e-5 && dist < best) best = dist
    }
  }
  return best
}

// a fixed set of cosine-weighted directions (Hammersley), rotated into each vertex's frame
const dirs = []
for (let i = 0; i < RAYS; i++) {
  let bits = i, rad = 0, f = 0.5
  while (bits) { if (bits & 1) rad += f; bits >>= 1; f /= 2 }
  const u = (i + 0.5) / RAYS, phi = 2 * Math.PI * rad
  const r = Math.sqrt(u)
  dirs.push([r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(1 - u)])
}
const used = [...new Set(T)]
const ao = new Array(P.length / 3).fill(1)
const t0 = Date.now()
for (const v of used) {
  const n = [N[3 * v], N[3 * v + 1], N[3 * v + 2]]
  const h = Math.abs(n[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0]
  const tx = [n[1] * h[2] - n[2] * h[1], n[2] * h[0] - n[0] * h[2], n[0] * h[1] - n[1] * h[0]]
  const tl = Math.hypot(...tx); tx[0] /= tl; tx[1] /= tl; tx[2] /= tl
  const ty = [n[1] * tx[2] - n[2] * tx[1], n[2] * tx[0] - n[0] * tx[2], n[0] * tx[1] - n[1] * tx[0]]
  const o = [P[3 * v] + n[0] * 5e-4, P[3 * v + 1] + n[1] * 5e-4, P[3 * v + 2] + n[2] * 5e-4]
  let occ = 0
  for (const [x, y, z] of dirs) {
    const d = [tx[0] * x + ty[0] * y + n[0] * z, tx[1] * x + ty[1] * y + n[1] * z, tx[2] * x + ty[2] * y + n[2] * z]
    const hit = cast(o, d, REACH, v)
    if (hit < REACH) occ += 1 - hit / REACH
  }
  ao[v] = Math.round((1 - occ / RAYS) * 1000) / 1000
}
A.ao = ao
writeFileSync(FILE, JSON.stringify(A))
const vals = used.map((v) => ao[v]).sort((a, b) => a - b)
console.log(`baked ${used.length} vertices in ${((Date.now() - t0) / 1000).toFixed(1)} s: min ${vals[0]} p10 ${vals[Math.floor(vals.length * 0.1)]} median ${vals[vals.length >> 1]}`)
