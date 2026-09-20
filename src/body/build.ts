/**
 * Avatar geometry from a spec: the MakeHuman body (mhbody.ts) with its eyes and proxies, skinned to our skeleton,
 * as typed arrays ready for the GPU (and for transfer out of a worker).
 */
import { loadIndex, preloadProxies } from './mhassets.ts'
import type { MhProxy } from './mhproxy.ts'
import { buildMakeHuman, lowBodyFor, wornFor, type MeshPart } from './mhbody.ts'
import type { ProxyKind } from './mhproxy.ts'
import { preloadTargets, preloadExpressions } from './mhmodifiers.ts'
import { orientByNormals } from './orient.ts'
import { BONES, type Rig } from './rig.ts'
import type { AvatarSpec } from '../spec.ts'

/** Level of detail (all build MakeHuman's full mesh for now; its proxy meshes would give the lower levels). */
/** Detail for the device and the crowd: high (desktop), medium (a phone showing one avatar), low (several at once) */
export type Quality = 'low' | 'medium' | 'high'

export interface SkinnedMeshData {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  boneIndices: Float32Array
  boneWeights: Float32Array
  /** 4 per vertex: arm, leg, hand, foot membership (0..1) */
  parts: Float32Array
  /** 2 per vertex, for textured meshes */
  uvs?: Float32Array
  /** the body: each vertex's base-mesh vertex (uv seams split vertices; weld by this) */
  src?: Uint32Array
  /** the body: ambient occlusion per vertex (1 = open) */
  ao?: Float32Array
  /** the body: the complexion's parts per vertex (redness, under-eye shade, beard area, blotch pattern) */
  tone?: Float32Array
  /** the body, brows, lashes and gloves: facial expression units and hand poses as vertex moves (see MeshPart.morphs) */
  morphs?: MeshPart['morphs']
}

export interface ProxyGeometry extends SkinnedMeshData {
  kind: string
  id: string
  uvs: Float32Array
  material: MhProxy['material']
  zDepth: number
  tint?: string
}

export interface AvatarGeometry {
  rig: Rig
  body: SkinnedMeshData
  /** the eyeballs (textured with the spec's eye material) and the clear corneas over them */
  eyes: SkinnedMeshData & { uvs: Float32Array }
  cornea: SkinnedMeshData & { uvs: Float32Array }
  /** hair, eyebrows, eyelashes, clothes and shoes */
  proxies: ProxyGeometry[]
  ms: number
}

/** Loads the MakeHuman targets and proxies a spec uses (buildAvatarGeometry then reads them synchronously). */
export async function preloadAssets(spec: AvatarSpec, quality: Quality = 'high'): Promise<void> {
  // (the index first: what a garment covers decides whether the modesty garments are worn, and the build can't wait)
  await loadIndex()
  const list: Array<[ProxyKind, string]> = wornFor(spec).map((w) => [w.kind, w.id])
  if (quality === 'low') list.push(['body', lowBodyFor(spec)])
  await Promise.all([
    preloadTargets(spec.macros, spec.modifiers),
    // clothes are fitted to a body whose chest curve is eased, which needs the same body without its chest
    // (mhbody.ts clothingBody)
    preloadTargets({ ...spec.macros, BreastSize: 0 }, spec.modifiers),
    preloadExpressions(spec.macros),
    preloadProxies(list),
  ])
}

const ARM = new Set(['shoulder', 'upperArm', 'forearm'])
const LEG = new Set(['thigh', 'shin'])
const baseName = (b: string): string => b.replace(/\.[LR]$/, '')

/** Each vertex's arm, leg, hand and foot membership, from its skin weights. */
function partsOf(indices: Float32Array, weights: Float32Array): Float32Array {
  const n = indices.length / 4
  const parts = new Float32Array(n * 4)
  for (let v = 0; v < n; v++) {
    for (let k = 0; k < 4; k++) {
      const w = weights[v * 4 + k]
      if (w === 0) continue
      const name = baseName(BONES[indices[v * 4 + k]])
      if (ARM.has(name)) parts[v * 4] += w
      if (LEG.has(name)) parts[v * 4 + 1] += w
      if (name === 'hand') parts[v * 4 + 2] += w
      if (name === 'foot' || name === 'toes') parts[v * 4 + 3] += w
    }
  }
  return parts
}

const skinned = (m: MeshPart): SkinnedMeshData => {
  orientByNormals(m.positions, m.normals, m.indices)
  return { ...m, parts: partsOf(m.boneIndices, m.boneWeights) }
}

export function buildAvatarGeometry(spec: AvatarSpec, quality: Quality = 'medium'): AvatarGeometry {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const m = buildMakeHuman(spec, wornFor(spec), quality)
  const body = { ...skinned(m.body), uvs: m.body.uvs, src: m.body.src, ao: m.body.ao, tone: m.body.tone, morphs: m.body.morphs }
  const eyes = { ...skinned(m.eyes), uvs: m.eyes.uvs }
  // (the corneas share the eyes' vertices, with their own triangles and buffers)
  const cornea = { ...skinned({ ...m.eyes, positions: m.eyes.positions.slice(), normals: m.eyes.normals.slice(), indices: m.eyes.cornea,
    boneIndices: m.eyes.boneIndices.slice(), boneWeights: m.eyes.boneWeights.slice() }), uvs: m.eyes.uvs.slice() }
  const proxies: ProxyGeometry[] = m.proxies.map((p) => ({
    ...skinned(p), kind: p.kind, id: p.id, uvs: p.uvs, material: p.material, zDepth: p.zDepth, tint: p.tint, morphs: p.morphs,
  }))
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  return { rig: m.rig, body, eyes, cornea, proxies, ms: t1 - t0 }
}
