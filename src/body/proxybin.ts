/**
 * MakeHuman proxies (clothes, hair, brows, lashes) in a compact binary form: public/mh/proxy/<kind>/<id>.bin,
 * written by tools/mkmhassets.mjs and read by loadProxy. About a quarter of the JSON they replaced.
 *
 *   'MHPX' uint32 version, uint32 metadata length, metadata JSON (padded to 4 bytes), then 16-bit arrays:
 *   refs    Uint16[3n]  the three base vertices each proxy vertex follows
 *   weights Int16[3n]   their weights (MakeHuman's reach well outside 0..1), × wStep
 *   offsets Int16[3n]   the offset, × oStep (then scaled by the body's size, as MakeHuman does)
 *   uv      Uint16[2n]  uvMin + q × uvStep (MakeHuman uvs can leave 0..1)
 *   tris    Uint16[3t]  the full mesh
 *   lods    Uint16[…]   simplified triangle lists over the same vertices, for the lower qualities (metadata.lods)
 *   hide    Uint16[d]   base vertices it hides (MakeHuman's delete_verts)
 *
 * Quantisation errors stay under a tenth of a millimetre on a body and a tenth of a texel on a 2048 texture.
 */
import type { MhProxy } from './mhproxy.ts'

const MAGIC = 0x5850484d // 'MHPX'
const VERSION = 1

/** Lower-quality triangle lists: triangle counts by quality, stored after the full mesh in this order. */
export type ProxyLods = Partial<Record<'medium' | 'low', number>>

interface Meta {
  kind: MhProxy['kind']
  id: string
  slot?: string
  scale: MhProxy['scale']
  zDepth: number
  material: MhProxy['material']
  n: number
  t: number
  d: number
  wStep: number
  oStep: number
  uvMin: [number, number]
  uvStep: [number, number]
  lods: ProxyLods
}

/** (MhProxy carries its simplified triangle lists: indices into the same vertices) */
export type ProxyWithLods = MhProxy

export function encodeProxy(p: ProxyWithLods): Uint8Array {
  const n = p.fit.length
  let wMax = 1e-6, oMax = 1e-6
  const uMin = [Infinity, Infinity], uMax = [-Infinity, -Infinity]
  for (const r of p.fit) {
    for (let i = 3; i < 6; i++) wMax = Math.max(wMax, Math.abs(r[i]))
    for (let i = 6; i < 9; i++) oMax = Math.max(oMax, Math.abs(r[i]))
  }
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 2; k++) { uMin[k] = Math.min(uMin[k], p.uv[2 * i + k]); uMax[k] = Math.max(uMax[k], p.uv[2 * i + k]) }
  }
  if (!n) { uMin[0] = uMin[1] = 0; uMax[0] = uMax[1] = 1 }
  const lodOrder = (['medium', 'low'] as const).filter((q) => p.lods?.[q])
  const meta: Meta = {
    kind: p.kind, id: p.id, ...(p.slot ? { slot: p.slot } : {}), scale: p.scale, zDepth: p.zDepth, material: p.material,
    n, t: p.tris.length / 3, d: p.deleteVerts.length,
    wStep: wMax / 32767, oStep: oMax / 32767,
    uvMin: [uMin[0], uMin[1]], uvStep: [Math.max(1e-9, (uMax[0] - uMin[0]) / 65535), Math.max(1e-9, (uMax[1] - uMin[1]) / 65535)],
    lods: Object.fromEntries(lodOrder.map((q) => [q, p.lods![q]!.length / 3])),
  }
  if (n > 65535) throw new Error(`${p.id}: ${n} vertices is more than 16-bit indices hold`)
  const json = new TextEncoder().encode(JSON.stringify(meta))
  const head = 12 + Math.ceil(json.length / 4) * 4
  const lodLen = lodOrder.reduce((s, q) => s + p.lods![q]!.length, 0)
  const count16 = 3 * n + 3 * n + 3 * n + 2 * n + p.tris.length + lodLen + p.deleteVerts.length
  const buf = new ArrayBuffer(head + 2 * count16)
  const dv = new DataView(buf)
  dv.setUint32(0, MAGIC, true)
  dv.setUint32(4, VERSION, true)
  dv.setUint32(8, json.length, true)
  new Uint8Array(buf, 12, json.length).set(json)
  let o = head / 2
  const u16 = new Uint16Array(buf), i16 = new Int16Array(buf)
  for (const r of p.fit) { u16[o++] = r[0]; u16[o++] = r[1]; u16[o++] = r[2] }
  for (const r of p.fit) for (let i = 3; i < 6; i++) i16[o++] = Math.round(r[i] / meta.wStep)
  for (const r of p.fit) for (let i = 6; i < 9; i++) i16[o++] = Math.round(r[i] / meta.oStep)
  for (let i = 0; i < n; i++) for (let k = 0; k < 2; k++) u16[o++] = Math.round((p.uv[2 * i + k] - meta.uvMin[k]) / meta.uvStep[k])
  for (const t of p.tris) u16[o++] = t
  for (const q of lodOrder) for (const t of p.lods![q]!) u16[o++] = t
  for (const v of p.deleteVerts) u16[o++] = v
  return new Uint8Array(buf)
}

export function decodeProxy(buf: ArrayBuffer): ProxyWithLods {
  const dv = new DataView(buf)
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('not a MakeHuman proxy (.bin)')
  if (dv.getUint32(4, true) !== VERSION) throw new Error(`proxy format version ${dv.getUint32(4, true)} (this reads ${VERSION})`)
  const len = dv.getUint32(8, true)
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, len))) as Meta
  let o = (12 + Math.ceil(len / 4) * 4) / 2
  const u16 = new Uint16Array(buf), i16 = new Int16Array(buf)
  const { n } = meta
  const fit: MhProxy['fit'] = new Array(n)
  for (let i = 0; i < n; i++) fit[i] = [u16[o + 3 * i], u16[o + 3 * i + 1], u16[o + 3 * i + 2], 0, 0, 0, 0, 0, 0]
  o += 3 * n
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) fit[i][3 + k] = i16[o + 3 * i + k] * meta.wStep
  o += 3 * n
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) fit[i][6 + k] = i16[o + 3 * i + k] * meta.oStep
  o += 3 * n
  const uv = new Array<number>(2 * n)
  for (let i = 0; i < n; i++) for (let k = 0; k < 2; k++) uv[2 * i + k] = meta.uvMin[k] + u16[o + 2 * i + k] * meta.uvStep[k]
  o += 2 * n
  const tris = Array.from(u16.subarray(o, o + 3 * meta.t))
  o += 3 * meta.t
  const lods: ProxyWithLods['lods'] = {}
  for (const q of ['medium', 'low'] as const) {
    const t = meta.lods[q]
    if (!t) continue
    lods[q] = Array.from(u16.subarray(o, o + 3 * t))
    o += 3 * t
  }
  const deleteVerts = Array.from(u16.subarray(o, o + meta.d))
  return {
    kind: meta.kind, id: meta.id, ...(meta.slot ? { slot: meta.slot } : {}), scale: meta.scale, zDepth: meta.zDepth,
    material: meta.material, fit, uv, tris, deleteVerts, lods,
  }
}
