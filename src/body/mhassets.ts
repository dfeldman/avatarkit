/**
 * The MakeHuman asset directory (public/mh/, built by tools/mkmhassets.mjs): an index of every asset, and each
 * proxy (hair, eyebrows, eyelashes, clothes) with its texture and thumbnail, loaded when an avatar needs it.
 *
 * Loading is asynchronous (fetch in pages and workers, the file system under node); building is synchronous and
 * reads what has been loaded, so callers `await preloadAssets(spec)` before building.
 */
import type { MhProxy, ProxyKind } from './mhproxy.ts'
import { decodeProxy } from './proxybin.ts'

export interface AssetEntry {
  kind: ProxyKind | 'eyes' | 'skin'
  id: string
  name: string
  /** clothes: the designer slot (tops, bottoms, outfits, shoes, socks, other), from tools/wardrobe.tsv */
  slot?: string
  /** clothes: position in the designer's lists (tools/wardrobe.tsv order) */
  order?: number
  /** clothes: its own colour, and whether it can be recoloured (see MhProxy.material) */
  baseColor?: string | null
  tintable?: boolean
  /** clothes: ships a normal map (tex/clothes/<id>_normal.jpg) */
  normalMap?: boolean
  /** skins: one of MakeHuman's own young skins, chosen automatically by colour */
  auto?: boolean
  tags: string[]
  pack: string
  license: string
  author: string | null
  homepage: string | null
  thumb: string | null
  verts: number
  tris: number
  /** base-mesh vertices it hides (clothes) */
  hides: number
  /** eye materials and skins: the texture */
  texture?: string
  /** skins: the photograph's own median colour */
  tone?: string
}

// (node's globals are reached through globalThis, so a game's build needs no node types for this browser library)
interface NodeGlobals { process?: { versions?: { node?: string } }; WorkerGlobalScope?: unknown }
const G = globalThis as NodeGlobals
const isNode = !!G.process?.versions?.node && typeof document === 'undefined' && typeof G.WorkerGlobalScope === 'undefined'
/** node's fs/promises, imported by a name the bundlers leave alone (this branch never runs in a browser) */
type NodeFs = { readFile: ((p: URL, enc: 'utf8') => Promise<string>) & ((p: URL) => Promise<Uint8Array>) }
const nodeFs = async (): Promise<NodeFs> => (await import(/* @vite-ignore */ 'node:fs/' + 'promises')) as NodeFs

let base: string | null = null
/** Where public/mh/ is served from (an absolute URL ending in /). Pages default to `mh/` beside the page. */
export function setAssetBase(url: string): void {
  base = url.endsWith('/') ? url : `${url}/`
}
export function assetBase(): string {
  if (base) return base
  if (typeof document !== 'undefined') return (base = new URL('mh/', document.baseURI).href)
  throw new Error('asset base not set (call setAssetBase in workers)')
}
/** A texture or thumbnail's URL (paths as the index gives them). */
export const assetUrl = (path: string): string => assetBase() + path
/** A texture's path at a quality: low reads the smaller copy beside it (<name>.lo.<ext>, tools/mkmhassets.mjs). */
export const texturePath = (path: string, quality: 'low' | 'medium' | 'high'): string =>
  quality === 'low' ? path.replace(/\.(jpg|png)$/, '.lo.$1') : path

async function readJson<T>(path: string): Promise<T> {
  if (isNode) {
    const url = new URL(`../../public/mh/${path}`, import.meta.url)
    return JSON.parse(await (await nodeFs()).readFile(url, 'utf8')) as T
  }
  const r = await fetch(assetUrl(path))
  if (!r.ok) throw new Error(`MakeHuman asset ${path}: HTTP ${r.status}`)
  return (await r.json()) as T
}

/** A binary asset (packed targets). */
export async function readBytes(path: string): Promise<ArrayBuffer> {
  if (isNode) {
    const b = await (await nodeFs()).readFile(new URL(`../../public/mh/${path}`, import.meta.url))
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
  }
  const r = await fetch(assetUrl(path))
  if (!r.ok) throw new Error(`MakeHuman asset ${path}: HTTP ${r.status}`)
  return r.arrayBuffer()
}
export { readJson }

/**
 * Garments that no longer ship: swimwear, bodysuits, corsetry and mini skirts (this is exercise kit for a family
 * audience), and the ribbed sweater and the plain t-shirt, which render badly. They are dropped from the library here as well as
 * from tools/wardrobe.tsv, so a folder of assets built earlier stops offering them too. An avatar saved wearing
 * one still renders: the files are there, they are just not on offer.
 */
const WITHDRAWN = new Set([
  'toigo_bodice-style_top',
  'mindfront_f_one-piece_swimsuit_01', 'punkduck_one_piece_bikini01',
  'culturalibre_heroine_suit_1', 'punkduck_female_strapless_bodysuit',
  'mindfront_bikini_01', 'punkduck_bandeau_bikini_bra', 'punkduck_bandeau_bikini_slip',
  'callharvey3d_harvey_pskirt01', 'elvs_disco_mini_skirt', 'frankyaye_mini_skirt_02', 'mtknife_low_mini_skirt',
  'mtknife_pleated_mini_skirt', 'punkduck_black_mini_skirt', 'toigo_tiered_mini_skirt',
  'toigo_fisherman_sweater',
  'toigo_basic_tucked_t-shirt',
])

let indexP: Promise<AssetEntry[]> | null = null
let indexNow: AssetEntry[] | null = null
/** Every asset, with its tags and credits. */
export function loadIndex(): Promise<AssetEntry[]> {
  return (indexP ??= readJson<{ assets: AssetEntry[] }>('index.json').then((j) => {
    indexNow = j.assets.filter((a) => !(a.kind === 'clothes' && WITHDRAWN.has(a.id)))
    return indexNow
  }))
}

/**
 * A garment's designer slot (tops, bottoms, outfits, shoes, socks, other), or undefined when the index hasn't
 * loaded yet or the garment isn't in it. Synchronous, for the geometry build, which cannot wait (preloadAssets
 * loads the index first).
 */
export function garmentSlot(id: string): string | undefined {
  return indexNow?.find((a) => a.kind === 'clothes' && a.id === id)?.slot
}

const proxies = new Map<string, MhProxy>()
const pending = new Map<string, Promise<MhProxy>>()
const key = (kind: ProxyKind, id: string): string => `${kind}/${id}`

export function loadProxy(kind: ProxyKind, id: string): Promise<MhProxy> {
  const k = key(kind, id)
  const have = proxies.get(k)
  if (have) return Promise.resolve(have)
  let p = pending.get(k)
  if (!p) {
    p = readBytes(`proxy/${kind}/${id}.bin`).then((buf) => {
      const px = decodeProxy(buf)
      proxies.set(k, px)
      pending.delete(k)
      return px
    })
    pending.set(k, p)
  }
  return p
}

/** A proxy that has been loaded (undefined if it hasn't). */
export const loadedProxy = (kind: ProxyKind, id: string): MhProxy | undefined => proxies.get(key(kind, id))

/** Loads every listed proxy. */
export async function preloadProxies(list: Array<[ProxyKind, string]>): Promise<void> {
  await Promise.all(list.map(([k, id]) => loadProxy(k, id)))
}

/** The assets that need crediting (anything not CC0): name, kind, author, licence and pack, for a game's credits. */
export async function credits(): Promise<AssetEntry[]> {
  return (await loadIndex()).filter((a) => a.license !== 'CC0')
}
