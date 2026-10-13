// @ts-nocheck: assetmgr's types come from a checkout outside this repo (see ASSETMGR below), so a clone without
// one would fail typecheck; the tool is checked when run.
/**
 * Record avatarkit's public/ assets in assetmgr indexes (indexes/asset-index-avatarkit-*.json), so they can be
 * uploaded to the shared bucket and the designer can load them from there (src/body/bucket.ts).
 *
 * One assetmgr asset per entry of public/mh/index.json (a garment's mesh, textures, low-quality copies and
 * thumbnail together), one per morph target, and one per remaining file (modifiers, clips, lighting, the skin
 * detail map). Every file keeps its original public/ path in `extra.avatarkit.paths`, which is how the designer
 * finds it by the path it already asks for.
 *
 * Re-runnable: assets already recorded are skipped. Reads public/, never changes it.
 *
 *   node tools/mkassetmgr.ts            (from libs/avatarkit)
 */

import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Asset, AssetFile, Repo } from 'assetmgr/node'

// assetmgr isn't a dependency of the kit (only this maintenance tool uses it): it comes from a checkout of
// github.com/dfeldman/assetmgr, beside dandyhorse by default, or wherever ASSETMGR points (built: npm run build).
const ASSETMGR = process.env.ASSETMGR ?? join(import.meta.dirname, '..', '..', '..', '..', 'assetmgr')
const { addFile, emptyIndex, indexFileName, loadRepo, saveIndex, serializeIndex, slugify } = (await import(
  pathToFileURL(join(ASSETMGR, 'dist', 'node', 'index.js')).href
)) as typeof import('assetmgr/node')

const ROOT = process.cwd()
const PUB = join(ROOT, 'public')
const INDEX_DIR = 'indexes'
const DEFAULTS = {
  project: 'avatarkit',
  projectName: 'Avatar Kit',
  repo: 'https://github.com/dfeldman/dandyhorse',
}

/** The skins' leftover normal maps: nothing reads them (ASSETS.md), so they aren't recorded. */
const SKIP = /_normal\.(jpg|png)$/

const INDEXES = {
  wardrobe: { name: 'avatarkit-wardrobe', description: 'MakeHuman community garments fitted to the avatarkit base mesh: mesh, texture, low-quality copy, thumbnail' },
  body: { name: 'avatarkit-body', description: 'Skins, eyes, hair, brows, lashes, teeth, tongue and the two low-poly bodies' },
  targets: { name: 'avatarkit-targets', description: 'MakeHuman morph targets (macros and face/body modifiers), packed binary' },
  data: { name: 'avatarkit-data', description: 'The designer catalogue, modifier definitions, motion clips, studio lighting and shared maps' },
} as const

interface Entry {
  kind: string
  id: string
  name: string
  tags?: string[]
  pack?: string
  license: string
  author?: string
  homepage?: string | null
  slot?: string
  [k: string]: unknown
}

const SPDX: Record<string, string> = { CC0: 'CC0-1.0', 'CC-BY 4.0': 'CC-BY-4.0' }

async function walk(dir: string): Promise<string[]> {
  return ((await readdir(dir, { recursive: true, withFileTypes: true })) as { name: string; parentPath: string; isFile(): boolean }[])
    .filter((d) => d.isFile() && !d.name.startsWith('.'))
    .map((d) => relative(PUB, join(d.parentPath, d.name)).split('\\').join('/'))
    .sort()
}

async function ensureIndexFile(name: string, description: string): Promise<void> {
  const path = join(ROOT, INDEX_DIR, indexFileName(name))
  if (existsSync(path)) return
  await mkdir(join(ROOT, INDEX_DIR), { recursive: true })
  await writeFile(path, serializeIndex({ ...emptyIndex(name, DEFAULTS), description }))
}

/** What a file is, from its path relative to its owner: `lo` copies are LOD 1, suffixes become keywords. */
function describe(path: string, rest: string): Partial<AssetFile> {
  const lo = /\.lo\.[a-z0-9]+$/.test(path)
  const role = path.startsWith('mh/proxy/') ? 'mesh' : path.startsWith('mh/thumb/') ? 'thumb' : path.startsWith('mh/targets/') ? 'target' : 'texture'
  const words = [role, ...rest.replace(/^[_-]+/, '').split(/[_-]+/).filter(Boolean), ...(lo ? ['lo'] : [])]
  return {
    fileKeywords: [...new Set(words)],
    lod: lo ? 1 : 0,
    isProd: true,
    fileNote: `public/${path}`,
  }
}

async function main(): Promise<void> {
  for (const i of Object.values(INDEXES)) await ensureIndexFile(i.name, i.description)
  const repo: Repo = await loadRepo(ROOT)
  const has = (index: string, id: string) => repo.indexes.find((l) => l.name === index)?.index.assets.some((a) => a.id === id)

  const catalogue = JSON.parse(await readFile(join(PUB, 'mh', 'index.json'), 'utf8')) as { assets: Entry[] }
  const files = (await walk(PUB)).filter((p) => !SKIP.test(p))
  const claimed = new Set<string>()

  // ---- catalogue entries: files under proxy/<kind>/, thumb/<kind>/, tex/<kind>/ whose name starts with the id
  const byKind = new Map<string, Entry[]>()
  for (const e of catalogue.assets) byKind.set(e.kind, [...(byKind.get(e.kind) ?? []), e])
  const owner = new Map<string, { entry: Entry; rest: string }>()
  for (const p of files) {
    const m = /^mh\/(proxy|thumb|tex)\/([^/]+)\/(.+?)(?:\.lo)?\.[a-z0-9]+$/.exec(p)
    if (!m) continue
    const [, , kind, stem] = m
    // longest id that prefixes the stem, so `bob01` doesn't take `bob01_short`'s files
    const match = (byKind.get(kind!) ?? []).filter((e) => stem === e.id || stem!.startsWith(`${e.id}_`)).sort((a, b) => b.id.length - a.id.length)[0]
    if (match) owner.set(p, { entry: match, rest: stem!.slice(match.id.length) })
  }
  let added = 0
  for (const e of catalogue.assets) {
    const index = e.kind === 'clothes' ? INDEXES.wardrobe.name : INDEXES.body.name
    const id = slugify(`${e.kind}-${e.id}`)
    const mine = [...owner].filter(([, o]) => o.entry === e).map(([p, o]) => ({ p, rest: o.rest }))
    mine.forEach(({ p }) => claimed.add(p))
    if (has(index, id) || !mine.length) continue
    const { kind, id: _id, name, tags, pack, license, author, homepage, ...rest } = e
    const subtype = e.kind === 'clothes' ? 'garment' : e.kind === 'skin' ? 'skin' : 'avatar'
    const asset: Partial<Asset> = {
      id,
      name,
      type: '3d',
      subtype,
      license: SPDX[license] ?? license,
      ...(license !== 'CC0' && author ? { attribution: `${author}${pack ? ` (MakeHuman community pack "${pack}")` : ''}` } : {}),
      ...(author ? { artist: author } : {}),
      ...(homepage ? { sourceUrl: homepage } : {}),
      folder: `mh/${e.kind}`,
      assetKeywords: [e.kind, ...(tags ?? []).filter((t) => !t.includes('™'))].slice(0, 6),
      extra: { avatarkit: { kind, id: _id, pack, ...rest, paths: {} as Record<string, string> } },
    }
    for (const { p, rest: suffix } of mine) {
      const r = await addFile(repo, { index, indexDir: INDEX_DIR, src: join(PUB, p), assetId: id, asset, file: describe(p, suffix), allowDuplicate: true })
      ;((repo.indexes.find((l) => l.name === index)!.index.assets.find((a) => a.id === id)!.extra!.avatarkit as { paths: Record<string, string> }).paths)[r.file.filename] = p
    }
    added++
  }
  console.log(`catalogue: ${catalogue.assets.length} entries, ${added} added`)

  // ---- morph targets: one asset each
  let targets = 0
  for (const p of files.filter((f) => f.startsWith('mh/targets/'))) {
    claimed.add(p)
    const id = slugify(p.replace(/^mh\/targets\//, '').replace(/\.bin$/, ''))
    if (has(INDEXES.targets.name, id)) continue
    const group = p.split('/').slice(2, -1).join('/')
    await addFile(repo, {
      index: INDEXES.targets.name,
      indexDir: INDEX_DIR,
      src: join(PUB, p),
      asset: {
        id, name: id, type: '3d', subtype: 'morphtarget', license: 'CC0-1.0', artist: 'MakeHuman team',
        sourceUrl: 'https://github.com/makehumancommunity/makehuman', folder: `mh/targets/${group}`,
        assetKeywords: ['target', ...group.split('/')],
        generator: { script: 'avatarkit/tools/mkmhtargets.mjs' },
        extra: { avatarkit: { paths: {} } },
      },
      file: { ...describe(p, ''), fileKeywords: ['target'] },
      allowDuplicate: true,
    }).then((r) => {
      ;((repo.indexes.find((l) => l.name === INDEXES.targets.name)!.index.assets.find((a) => a.id === id)!.extra!.avatarkit as { paths: Record<string, string> }).paths)[r.file.filename] = p
    })
    targets++
  }
  console.log(`targets: ${targets} added`)

  // ---- everything else, one asset per file (a .lo copy joins its original)
  const DATA: Record<string, Partial<Asset>> = {
    'mh/index.json': { name: 'Designer catalogue', subtype: 'json', type: '2d', license: 'CC0-1.0', generator: { script: 'avatarkit/tools/mkmhassets.mjs' } },
    'mh/modifiers.json': { name: 'MakeHuman modifier definitions', subtype: 'json', type: '2d', license: 'CC0-1.0', sourceUrl: 'https://github.com/makehumancommunity/makehuman', generator: { script: 'avatarkit/tools/mkmhtargets.mjs' } },
    'mh/anim/ual.json': { name: 'Universal Animation Library clips (retargeted)', subtype: 'animation', type: '3d', license: 'CC0-1.0', artist: 'Quaternius', sourceUrl: 'https://quaternius.com', generator: { script: 'avatarkit/tools/mkclips.mjs' } },
    'env/studio_small_08_1k.hdr': { name: 'Studio Small 08 (1k)', subtype: 'hdri', type: '2d', hdr: true, license: 'CC0-1.0', attribution: 'Poly Haven, CC0', sourceUrl: 'https://polyhaven.com/a/studio_small_08' },
  }
  let other = 0
  const rest = files.filter((p) => !claimed.has(p))
  const groups = new Map<string, string[]>()
  for (const p of rest) {
    const key = p.replace(/\.lo(\.[a-z0-9]+)$/, '$1')
    groups.set(key, [...(groups.get(key) ?? []), p])
  }
  for (const [key, paths] of groups) {
    const id = slugify(key.replace(/\.[a-z0-9]+$/, ''))
    if (has(INDEXES.data.name, id)) continue
    const meta = DATA[key] ?? { name: key, subtype: /\.(jpg|png)$/.test(key) ? 'texture' : 'json', type: '2d' as const, license: 'CC0-1.0', notes: 'avatarkit tools output' }
    const folder = key.split('/').slice(0, -1).join('/')
    for (const p of paths.sort()) {
      const r = await addFile(repo, {
        index: INDEXES.data.name,
        indexDir: INDEX_DIR,
        src: join(PUB, p),
        assetId: id,
        asset: { id, folder, assetKeywords: [id.split('-').pop()!], ...meta, extra: { avatarkit: { paths: {} } } },
        file: describe(p, ''),
        allowDuplicate: true,
      })
      ;((repo.indexes.find((l) => l.name === INDEXES.data.name)!.index.assets.find((a) => a.id === id)!.extra!.avatarkit as { paths: Record<string, string> }).paths)[r.file.filename] = p
    }
    other++
  }
  console.log(`other files: ${other} added (${rest.length} files)`)

  for (const l of repo.indexes) await saveIndex(l)
  const skipped = (await walk(PUB)).filter((p) => SKIP.test(p)).length
  console.log(`not recorded: ${skipped} unused skin normal maps`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
