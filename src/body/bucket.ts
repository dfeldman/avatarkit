/**
 * Loading the MakeHuman assets from the shared assetmgr bucket (~/assetmgr) instead of a copy of public/.
 *
 * tools/mkassetmgr.ts recorded every file of public/ in the avatarkit-* indexes, under its content-hashed bucket
 * name, with its original path in `extra.avatarkit.paths`. This fetches those indexes over public HTTP (no key) and
 * turns them into the path → URL manifest that assetUrl() consults, so the rest of the kit asks for the same paths
 * as before.
 *
 *   await loadFromBucket()                     // before mountDesigner / the first Avatar
 */

import { setAssetManifest } from './mhassets.ts'
import { setStudioHdri, STUDIO_HDRI } from '../render/lighting.ts'

/** The public URL of the shared asset bucket. */
export const ASSET_BUCKET = 'https://pub-32f6f3f21c18414cbeaf4bf0ac34ebe5.r2.dev'
export const AVATARKIT_INDEXES = ['avatarkit-body', 'avatarkit-wardrobe', 'avatarkit-targets', 'avatarkit-data'] as const

interface IndexFile {
  assets: { isDeleted?: boolean; extra?: { avatarkit?: { paths?: Record<string, string> } } }[]
}

/**
 * Point the kit at the bucket. Resolves with the number of files mapped. Throws if an index can't be read, so a
 * page fails loudly rather than drawing a bald, naked avatar.
 */
export async function loadFromBucket(baseUrl: string = ASSET_BUCKET, indexes: readonly string[] = AVATARKIT_INDEXES): Promise<number> {
  const base = baseUrl.replace(/\/+$/, '')
  const files = await Promise.all(indexes.map(async (name) => {
    const r = await fetch(`${base}/asset-index-${name}.json`, { cache: 'no-cache' })
    if (!r.ok) throw new Error(`asset index ${name}: HTTP ${r.status}`)
    return (await r.json()) as IndexFile
  }))
  const manifest: Record<string, string> = {}
  for (const idx of files) {
    for (const a of idx.assets) {
      if (a.isDeleted) continue
      for (const [filename, path] of Object.entries(a.extra?.avatarkit?.paths ?? {})) {
        const url = `${base}/${filename}`
        if (path.startsWith('mh/')) manifest[path.slice(3)] = url
        else if (path === STUDIO_HDRI) setStudioHdri(url)
      }
    }
  }
  setAssetManifest(manifest)
  return Object.keys(manifest).length
}
