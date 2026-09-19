/// <reference lib="webworker" />
/** Builds avatar geometry off the main thread. */
import { buildAvatarGeometry, preloadAssets, type AvatarGeometry, type Quality } from '../body/build.ts'
import { setAssetBase } from '../body/mhassets.ts'
import type { AvatarSpec } from '../spec.ts'

interface Request { id: number; spec: AvatarSpec; quality: Quality; assetBase?: string }

function transferables(g: AvatarGeometry): Transferable[] {
  const out: Transferable[] = []
  for (const m of [g.body, g.eyes, g.cornea, ...g.proxies]) {
    out.push(m.positions.buffer, m.normals.buffer, m.indices.buffer, m.boneIndices.buffer, m.boneWeights.buffer, m.parts.buffer)
    if (m.uvs) out.push(m.uvs.buffer)
    if (m.src) out.push(m.src.buffer)
    if (m.ao) out.push(m.ao.buffer)
    if (m.tone) out.push(m.tone.buffer)
  }
  return out
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const { id, spec, quality, assetBase } = e.data
  try {
    if (assetBase) setAssetBase(assetBase)
    await preloadAssets(spec, quality)
    const g = buildAvatarGeometry(spec, quality)
    ;(self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, geometry: g }, transferables(g))
  } catch (err) {
    ;(self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, error: String(err) })
  }
}
