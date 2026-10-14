/**
 * Rebuild public/ (the MakeHuman assets, ~300 MB) from the shared asset bucket, so a fresh clone can run the
 * designer, the tests and the local-assets mode without MakeHuman's source data. Public HTTPS, no key.
 *
 * Every file the avatarkit-* indexes list is written to the path it had in public/ (recorded in
 * `extra.avatarkit.paths` by tools/mkassetmgr.ts), and its sha256 is checked. Files already present with the
 * right bytes are skipped, so it is safe to re-run.
 *
 *   npm run assets                     everything into public/
 *   npm run assets -- --out=/tmp/x     somewhere else
 *   npm run assets -- --check          report what is missing or different, write nothing
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { ASSET_BUCKET, AVATARKIT_INDEXES } from '../src/body/bucket-config.ts'

const arg = (name: string): string | undefined => process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const OUT = resolve(arg('out') ?? join(import.meta.dirname, '..', 'public'))
const CHECK = process.argv.includes('--check')
const BASE = (arg('bucket') ?? ASSET_BUCKET).replace(/\/+$/, '')
const CONCURRENCY = 6 // the bucket's r2.dev address throttles bursts

interface IndexFile {
  assets: { isDeleted?: boolean; assetFiles: { filename: string; hash: string; size: number; isDeleted?: boolean }[]; extra?: { avatarkit?: { paths?: Record<string, string> } } }[]
}

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

async function get(url: string): Promise<Response> {
  for (let i = 0; ; i++) {
    const r = await fetch(url)
    if (r.status !== 429 && r.status < 500) return r
    if (i >= 6) return r
    await new Promise((s) => setTimeout(s, 400 * 2 ** i))
  }
}

const jobs: { url: string; path: string; hash: string; size: number }[] = []
for (const name of AVATARKIT_INDEXES) {
  const r = await get(`${BASE}/asset-index-${name}.json`)
  if (!r.ok) throw new Error(`asset index ${name}: HTTP ${r.status}`)
  const idx = (await r.json()) as IndexFile
  for (const a of idx.assets) {
    if (a.isDeleted) continue
    const paths = a.extra?.avatarkit?.paths ?? {}
    for (const f of a.assetFiles) {
      const p = paths[f.filename]
      if (!p || f.isDeleted) continue
      jobs.push({ url: `${BASE}/${f.filename}`, path: join(OUT, p), hash: f.hash, size: f.size })
    }
  }
}

let present = 0, fetched = 0, bytes = 0
const problems: string[] = []
let next = 0
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < jobs.length) {
    const j = jobs[next++]
    try {
      const have = await readFile(j.path).then((b) => sha256(b), () => null)
      if (have === j.hash) { present++; continue }
      if (CHECK) { problems.push(`${have ? 'different' : 'missing'}: ${j.path}`); continue }
      const r = await get(j.url)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const body = new Uint8Array(await r.arrayBuffer())
      if (sha256(body) !== j.hash) throw new Error('downloaded bytes do not match the index')
      await mkdir(dirname(j.path), { recursive: true })
      await writeFile(`${j.path}.tmp`, body)
      await rename(`${j.path}.tmp`, j.path)
      fetched++
      bytes += body.length
      if (fetched % 200 === 0) console.log(`  ${fetched} fetched…`)
    } catch (e) {
      problems.push(`${j.path}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}))
console.log(`${jobs.length} files: ${present} already present, ${fetched} fetched (${(bytes / 1e6).toFixed(1)} MB) into ${OUT}`)
for (const p of problems.slice(0, 20)) console.log(`  ${p}`)
if (problems.length > 20) console.log(`  … ${problems.length - 20} more`)
process.exit(problems.length ? 1 : 0)
