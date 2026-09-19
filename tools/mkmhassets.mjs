/**
 * Builds the MakeHuman asset directory, public/mh/, from MakeHuman asset packs (unpacked):
 *
 *   node tools/mkmhassets.mjs <pack dir>[=<pack name>] ...
 *
 * For every hair, eyebrow, eyelash and clothing asset in the packs: the proxy (MakeHuman's fitting, delete_verts,
 * mesh with uvs split at seams) as public/mh/proxy/<kind>/<id>.json, its diffuse texture (at most 1024 px, 512 for
 * brows and lashes) in public/mh/tex/, a thumbnail in public/mh/thumb/, and one entry in public/mh/index.json with
 * its tags, author, licence and source pack. CREDITS.md lists every asset that isn't CC0.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { MeshoptSimplifier } from 'meshoptimizer'
import { encodeProxy } from '../src/body/proxybin.ts'

// simplified garments for the lower qualities: at most this many triangles (garments already under stay whole)
const LOD_TRIS = { medium: 8000, low: 2000 }
const BASE = JSON.parse(readFileSync(new URL('../src/body/mhbase.json', import.meta.url), 'utf8'))
await MeshoptSimplifier.ready

/** A proxy fitted to the base body (MakeHuman's fitting: weighted base vertices plus a scaled offset). */
function fitted(fit, scale) {
  const P = BASE.positions
  const ax = (k, c) => { const [a, b, d] = scale[k]; return Math.abs(P[3 * a + c] - P[3 * b + c]) / d }
  const sc = [ax('x', 0), ax('y', 1), ax('z', 2)]
  const out = new Float32Array(fit.length * 3)
  fit.forEach(([a, b, c, wa, wb, wc, ...d], i) => {
    for (let k = 0; k < 3; k++) out[3 * i + k] = wa * P[3 * a + k] + wb * P[3 * b + k] + wc * P[3 * c + k] + d[k] * sc[k]
  })
  return out
}

/**
 * Simplified triangle lists over the same vertices. meshoptimizer only ever collapses an edge onto one of its own
 * ends, so every surviving vertex keeps its MakeHuman fitting (moving vertices would break it); open borders (hems,
 * cuffs) are locked, and vertices split at uv seams collapse together.
 */
function lodsFor(fit, scale, tris) {
  const pos = fitted(fit, scale)
  const idx = Uint32Array.from(tris)
  const out = {}
  for (const q of ['medium', 'low']) {
    const target = LOD_TRIS[q] * 3
    if (tris.length <= target) continue
    const [r] = MeshoptSimplifier.simplify(idx, pos, 3, target, 0.05, ['LockBorder'])
    if (r.length < tris.length * 0.95) out[q] = Array.from(r)
  }
  return out
}

const OUT = process.env.MH_OUT ?? 'public/mh'
const KINDS = ['hair', 'eyebrows', 'eyelashes', 'clothes', 'body', 'teeth', 'tongue']
// the mouth's insides, worn by every avatar (seen when it opens): MakeHuman's default teeth and tongue
const MOUTH = new Set(['teeth_base', 'tongue01'])
// MakeHuman's low-poly bodies (about 1.6k vertices against the full body's 14.5k), for the low quality
const BODIES = new Set(['male1591', 'female1605'])
const TEX = { hair: 1024, eyebrows: 512, eyelashes: 512, clothes: 1024, body: 512, teeth: 256, tongue: 256 }
// the curated wardrobe: only these clothes ship, each with its designer slot
const WARDROBE_ROWS = readFileSync(new URL('./wardrobe.tsv', import.meta.url), 'utf8').split('\n')
  .filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.split('\t'))
const WARDROBE = new Map(WARDROBE_ROWS.map(([id, slot]) => [id, slot]))
// the designer's names and order (each slot as listed, exercise wear first)
const WARDROBE_NAME = new Map(WARDROBE_ROWS.map(([id, , label]) => [id, label]))
const WARDROBE_ORDER = new Map(WARDROBE_ROWS.map(([id], i) => [id, i]))
// community skins shipped beside MakeHuman's six system ones: id -> [label, sex]
const SKINS = new Map(readFileSync(new URL('./skins.tsv', import.meta.url), 'utf8').split('\n')
  .filter((l) => l.trim() && !l.startsWith('#')).map((l) => { const [id, label, sex] = l.split('\t'); return [id, [label, sex.trim()]] }))

function parseMhclo(text) {
  const scale = {}, fit = [], del = [], tags = [], meta = {}
  let section = '', objFile = null, material = null, zDepth = 50, name = null
  for (const raw of text.split('\n')) {
    const ln = raw.trim()
    if (!ln) continue
    if (ln.startsWith('#')) {
      const m = ln.match(/^#\s*(author|license|homepage)\s+(.+)$/i)
      if (m) meta[m[1].toLowerCase()] = m[2].trim()
      continue
    }
    const sm = ln.match(/^([xyz])_scale\s+(\d+)\s+(\d+)\s+([\d.]+)/)
    if (sm) { scale[sm[1]] = [+sm[2], +sm[3], +sm[4]]; continue }
    if (/^verts\b/.test(ln)) { section = 'verts'; continue }
    if (/^delete_verts\b/.test(ln)) { section = 'delete'; continue }
    const kw = ln.match(/^([a-z_]+)\s+(.*)$/i)
    if (kw && !/^\d/.test(ln)) {
      const [, k, v] = kw
      if (k === 'obj_file') objFile = v.trim()
      else if (k === 'material') material = v.trim()
      else if (k === 'z_depth') zDepth = +v
      else if (k === 'name') name = v.trim()
      else if (k === 'tag') tags.push(v.trim().toLowerCase())
      else if (k === 'author' || k === 'license' || k === 'homepage') meta[k] = v.trim()
      continue
    }
    if (section === 'verts') {
      const n = ln.split(/\s+/).map(Number)
      if (n.length === 9 && n.every(Number.isFinite)) fit.push(n)
      else if (n.length === 1 && Number.isFinite(n[0])) fit.push([n[0], n[0], n[0], 1, 0, 0, 0, 0, 0])
    } else if (section === 'delete') {
      const toks = ln.split(/\s+/)
      if (!toks.every((t) => /^\d+$/.test(t) || t === '-')) continue
      for (let i = 0; i < toks.length; i++) {
        if (toks[i + 1] === '-') { for (let v = +toks[i]; v <= +toks[i + 2]; v++) del.push(v); i += 2 }
        else del.push(+toks[i])
      }
    }
  }
  return { scale, fit, del: [...new Set(del)].sort((a, b) => a - b), objFile, material, zDepth, name, tags, meta }
}

function parseObj(text) {
  let nv = 0
  const vt = [], corners = []
  for (const ln of text.split('\n')) {
    if (ln.startsWith('v ')) nv++
    else if (ln.startsWith('vt ')) { const p = ln.trim().split(/\s+/); vt.push([+p[1], +p[2]]) }
    else if (ln.startsWith('f ')) {
      const f = ln.trim().split(/\s+/).slice(1).map((t) => { const [a, b] = t.split('/'); return [+a - 1, b ? +b - 1 : -1] })
      for (let k = 2; k < f.length; k++) corners.push(f[0], f[k - 1], f[k])
    }
  }
  return { nv, vt, corners }
}

const parseMhmat = (text) => Object.fromEntries(text.split('\n').map((l) => l.trim().match(/^(\w+)\s+(.+)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]))

/** Resize with PIL; returns whether the image really uses its alpha. */
function image(src, dst, size, keepAlpha, neutral = false) {
  return execFileSync('python3', ['-c', `
import sys
from PIL import Image, ImageOps
im = Image.open(sys.argv[1])
src_size = '%dx%d' % im.size
if sys.argv[5] == '1':
    # hair and brows: keep the strands' detail and alpha, drop their own colour, lift to a light neutral grey so a
    # tint can take them to any colour
    a = im.convert('RGBA').getchannel('A')
    g = ImageOps.autocontrast(im.convert('L'), cutoff=2)
    g = g.point(lambda v: int(90 + v * 165 / 255))
    # transparent pixels take the strands' own median grey, so filtering never blends a stray colour into them
    gp, ap = list(g.getdata()), list(a.getdata())
    solid = sorted(v for v, al in zip(gp, ap) if al > 128) or [170]
    fill = solid[len(solid) // 2]
    g.putdata([v if al > 16 else fill for v, al in zip(gp, ap)])
    im = Image.merge('RGBA', (g, g, g, a))
s = int(sys.argv[3])
w, h = im.size
if max(w, h) > s: im = im.resize((s, max(1, round(h * s / w))) if w >= h else (max(1, round(w * s / h)), s), Image.LANCZOS)
alpha = sys.argv[4] == '1' and im.mode in ('RGBA', 'LA', 'P') and im.convert('RGBA').getchannel('A').getextrema()[0] < 250
if alpha: im.convert('RGBA').save(sys.argv[2] + '.png', optimize=True)
else: im.convert('RGB').save(sys.argv[2] + '.jpg', quality=85)
print(('png' if alpha else 'jpg') + ' ' + src_size)
`, src, dst, String(size), keepAlpha ? '1' : '0', neutral ? '1' : '0']).toString().trim().split(' ')
}

/**
 * A garment's diffuse texture made recolourable. Its default colour is the median of its opaque pixels. If much of
 * it differs in hue from that (tartan, florals, prints, two-tone outfits) it stays as photographed and can't be
 * tinted; otherwise it becomes neutral detail, each pixel half its linear ratio to the median (sRGB-encoded), so
 * any colour times twice the detail is that colour with the fabric's weave, seams and folds, and the default
 * colour gives back the photograph.
 */
function garmentImage(src, dst, size, uv, tris) {
  // (only the texels the mesh uses count: many atlases leave unused space in a fill colour)
  const uvFile = join(tmpdir(), `mkmh-uv-${process.pid}.json`)
  writeFileSync(uvFile, JSON.stringify({ uv, tris }))
  return JSON.parse(execFileSync('python3', ['-c', `
import sys, json
from PIL import Image, ImageDraw
im = Image.open(sys.argv[1])
src_size = '%dx%d' % im.size
s = int(sys.argv[3])
w, h = im.size
if max(w, h) > s: im = im.resize((s, max(1, round(h * s / w))) if w >= h else (max(1, round(w * s / h)), s), Image.LANCZOS)
rgba = im.convert('RGBA')
alpha = rgba.getchannel('A').getextrema()[0] < 250
N = 128
mesh = json.load(open(sys.argv[4]))
mask = Image.new('L', (N, N), 0)
draw = ImageDraw.Draw(mask)
for i in range(0, len(mesh['tris']), 3):
    draw.polygon([(mesh['uv'][2 * k] * N, (1 - mesh['uv'][2 * k + 1]) * N) for k in mesh['tris'][i:i + 3]], fill=255)
small = rgba.resize((N, N))
px = [p[:3] for p, m in zip(small.getdata(), mask.getdata()) if p[3] > 128 and m] or [(200, 200, 200)]
med = [sorted(c[k] for c in px)[len(px) // 2] for k in range(3)]
# how much differs in hue: chromaticity far from the median's, on pixels with some colour of their own
def chroma(c):
    t = sum(c) or 1
    return (c[0] / t, c[1] / t, c[2] / t)
mc = chroma(med)
def sat(c):
    return (max(c) - min(c)) / (max(c) or 1)
L = lambda c: 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
# (near-black pixels have no dependable hue)
off = sum(1 for c in px if L(c) > 40 and sum(abs(a - b) for a, b in zip(chroma(c), mc)) > 0.09 and (sat(c) > 0.2 or sat(med) > 0.2))
# and how much is far lighter or darker (black-and-white stripes, a print on a plain ground; not a dark fabric's sheen)
contrast = sum(1 for c in px if abs(L(c) - L(med)) > 90) / len(px)
patterned = off / len(px)
tintable = patterned < 0.15 and contrast < 0.2
if tintable:
    lin = lambda v: (v / 255) / 12.92 if v <= 10 else ((v / 255 + 0.055) / 1.055) ** 2.4
    enc = lambda x: 12.92 * x if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055
    lut = []
    for k in range(3):
        m = max(lin(med[k]), 0.002)
        lut += [min(255, round(255 * enc(min(1.0, 0.5 * lin(v) / m)))) for v in range(256)]
    rgb = rgba.convert('RGB').point(lut)
    if alpha:
        rgb.putalpha(rgba.getchannel('A'))
        rgba = rgb
    else:
        rgba = rgb.convert('RGBA')
if alpha: rgba.save(sys.argv[2] + '.png', optimize=True)
else: rgba.convert('RGB').save(sys.argv[2] + '.jpg', quality=85)
print(json.dumps({'ext': 'png' if alpha else 'jpg', 'size': src_size, 'base': '#%02x%02x%02x' % tuple(med), 'tintable': tintable, 'patterned': round(patterned, 3), 'contrast': round(contrast, 3)}))
`, src, dst, String(size), uvFile]).toString().trim())
}

/** A normal map, resized (linear data: no colour handling). */
function normalImage(src, dst, size) {
  execFileSync('python3', ['-c', `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
s = int(sys.argv[3])
if max(im.size) > s: im = im.resize((s, s) if im.size[0] == im.size[1] else (s, round(im.size[1] * s / im.size[0])), Image.LANCZOS)
im.save(sys.argv[2] + '.jpg', quality=90)
`, src, dst, String(size)])
}

const sources = process.argv.slice(2).map((a) => { const [dir, pack] = a.split('='); return { dir, pack: pack ?? basename(dir) } })
if (!sources.length) throw new Error('usage: node tools/mkmhassets.mjs <pack dir>[=<name>] ...')
for (const d of ['proxy', 'tex', 'thumb']) for (const k of KINDS) mkdirSync(join(OUT, d, k), { recursive: true })

const index = []
const seen = new Set()
let bytes = 0
for (const { dir, pack } of sources) {
  const packLicense = /ccby|cc-by/i.test(pack) ? 'CC-BY 4.0' : 'CC0'
  for (const kind of KINDS) {
    const kdir = join(dir, kind === 'body' ? 'proxymeshes' : kind)
    if (!existsSync(kdir)) continue
    for (const id of readdirSync(kdir).sort()) {
      const adir = join(kdir, id)
      const mhclo = existsSync(adir) ? readdirSync(adir).find((f) => f.endsWith('.mhclo') || (kind === 'body' && f.endsWith('.proxy'))) : null
      if (!mhclo) continue
      if (kind === 'body' && !BODIES.has(id)) continue
      if ((kind === 'teeth' || kind === 'tongue') && !MOUTH.has(id)) continue
      if (kind === 'clothes' && !WARDROBE.has(id)) continue
      if (seen.has(`${kind}/${id}`)) { console.warn(`skip duplicate ${kind}/${id} in ${pack}`); continue }
      try {
        const clo = parseMhclo(readFileSync(join(adir, mhclo), 'utf8'))
        const obj = parseObj(readFileSync(join(adir, clo.objFile ?? mhclo.replace('.mhclo', '.obj')), 'utf8'))
        if (clo.fit.length !== obj.nv) throw new Error(`${clo.fit.length} fitting rows for ${obj.nv} vertices`)
        if (!clo.scale.x || !clo.scale.y || !clo.scale.z) throw new Error('missing x/y/z_scale')
        const key = new Map(), fit = [], uv = [], tris = []
        for (const [v, t] of obj.corners) {
          const k = `${v}/${t}`
          let i = key.get(k)
          if (i === undefined) {
            i = fit.length
            key.set(k, i)
            fit.push(clo.fit[v].map((x, j) => (j < 3 ? x : Math.round(x * 1e5) / 1e5)))
            const u = t >= 0 ? obj.vt[t] : [0, 0]
            uv.push(Math.round(u[0] * 1e5) / 1e5, Math.round(u[1] * 1e5) / 1e5)
          }
          tris.push(i)
        }
        const matFile = clo.material && existsSync(join(adir, clo.material)) ? clo.material : readdirSync(adir).find((f) => f.endsWith('.mhmat'))
        const mat = matFile ? parseMhmat(readFileSync(join(adir, matFile), 'utf8')) : {}
        // keep alpha wherever the image really uses it (many garments cut holes or lace with alpha without
        // flagging the material transparent)
        const transparentHint = true
        let texture = null, texSize = null, baseColor = null, tintable = kind !== 'clothes', normal = null
        const texSrc = mat.diffuseTexture ? join(adir, mat.diffuseTexture.replace(/^.*[\\/]/, '')) : null
        if (texSrc && existsSync(texSrc) && kind === 'clothes') {
          const g = garmentImage(texSrc, join(OUT, 'tex', kind, id), TEX[kind], uv, tris)
          texture = `tex/${kind}/${id}.${g.ext}`
          texSize = g.size
          baseColor = g.base
          tintable = g.tintable
        } else if (texSrc && existsSync(texSrc)) {
          const [ext, size] = image(texSrc, join(OUT, 'tex', kind, id), TEX[kind], transparentHint, kind === 'hair' || kind === 'eyebrows')
          texture = `tex/${kind}/${id}.${ext}`
          texSize = size
        }
        const nrmSrc = mat.normalmapTexture ? join(adir, mat.normalmapTexture.replace(/^.*[\\/]/, '')) : null
        if (kind === 'clothes' && nrmSrc && existsSync(nrmSrc)) {
          try {
            normalImage(nrmSrc, join(OUT, 'tex', kind, `${id}_normal`), TEX[kind])
            normal = `tex/${kind}/${id}_normal.jpg`
          } catch {
            console.warn(`no normal map for clothes/${id}: unreadable ${nrmSrc}`)
          }
        }
        const thumbFile = readdirSync(adir).find((f) => f.endsWith('.thumb'))
        let thumb = null
        if (thumbFile) { image(join(adir, thumbFile), join(OUT, 'thumb', kind, id), 128, false); thumb = `thumb/${kind}/${id}.jpg` }
        const transparent = texture?.endsWith('.png') ?? false
        const proxy = {
          kind, id, ...(kind === 'clothes' ? { slot: WARDROBE.get(id) } : {}), scale: clo.scale, fit, uv, tris, deleteVerts: clo.del, zDepth: clo.zDepth,
          material: { texture, normal, transparent, backfaceCull: mat.backfaceCull !== 'False' && !transparent, color: mat.diffuseColor ?? '1 1 1', baseColor, tintable },
        }
        const bin = encodeProxy({ ...proxy, lods: kind === 'clothes' ? lodsFor(fit, clo.scale, tris) : {} })
        writeFileSync(join(OUT, 'proxy', kind, `${id}.bin`), bin)
        bytes += bin.length
        const license = /by/i.test(clo.meta.license ?? '') ? 'CC-BY 4.0' : clo.meta.license && /cc0|zero/i.test(clo.meta.license) ? 'CC0' : packLicense
        index.push({
          kind, id, name: (kind === 'clothes' && WARDROBE_NAME.get(id)) || clo.name || id,
          ...(kind === 'clothes' ? { slot: WARDROBE.get(id), order: WARDROBE_ORDER.get(id) } : {}), tags: [...new Set(clo.tags)], pack, license,
          author: clo.meta.author ?? (packLicense === 'CC0' && pack.includes('system') ? 'MakeHuman team' : null),
          homepage: clo.meta.homepage ?? null, thumb, texSize, normalMap: !!normal, ...(kind === 'clothes' ? { baseColor, tintable } : {}), verts: fit.length, tris: tris.length / 3, hides: clo.del.length,
        })
        seen.add(`${kind}/${id}`)
      } catch (e) {
        console.warn(`skip ${kind}/${id} (${pack}): ${e.message}`)
      }
    }
  }
}
// MakeHuman's eye materials (one texture each; the eyeball proxy is in mhbase.json)
for (const { dir } of sources) {
  const mdir = join(dir, 'eyes', 'materials')
  if (!existsSync(mdir)) continue
  mkdirSync(join(OUT, 'tex', 'eyes'), { recursive: true })
  for (const f of readdirSync(mdir).filter((x) => x.endsWith('.mhmat')).sort()) {
    const id = f.replace('.mhmat', '')
    const mat = parseMhmat(readFileSync(join(mdir, f), 'utf8'))
    if (!mat.diffuseTexture) continue
    const [ext] = image(join(mdir, mat.diffuseTexture), join(OUT, 'tex', 'eyes', id), 512, false)
    index.push({ kind: 'eyes', id, name: id, tags: [], pack: 'makehuman_system_assets', license: 'CC0', author: 'MakeHuman team', homepage: null, thumb: null, texture: `tex/eyes/${id}.${ext}`, verts: 0, tris: 0, hides: 0 })
  }
}
// MakeHuman's skins as neutral detail: each pixel divided by its skin's median colour (lips stay redder than the
// cheek, creases darker), stored at half scale as linear data, so a renderer multiplies by any skin colour; the
// skin's own tone is kept so the nearest photograph can be chosen for a colour (never for anything else)
for (const { dir } of sources) {
  const sdir = join(dir, 'skins')
  if (!existsSync(sdir)) continue
  mkdirSync(join(OUT, 'tex', 'skin'), { recursive: true })
  for (const id of readdirSync(sdir).filter((d) => /^young_(african|asian|caucasian)_(female|male)$/.test(d) || SKINS.has(d)).sort()) {
    const matFile = readdirSync(join(sdir, id)).find((f) => f.endsWith('.mhmat'))
    if (!matFile) continue
    const mat = parseMhmat(readFileSync(join(sdir, id, matFile), 'utf8'))
    if (!mat.diffuseTexture) continue
    const system = !SKINS.has(id)
    const tone = execFileSync('python3', ['-c', `
import sys
from PIL import Image, ImageFilter, ImageChops
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB')
if im.size[0] > 2048: im = im.resize((2048, 2048), Image.LANCZOS)
# the median of the skin itself (some maps leave the space between their islands black)
px = [c for c in im.resize((512, 512)).getdata() if sum(c) > 45]
med = [sorted(c[k] for c in px)[len(px) // 2] for k in range(3)]
# and that space filled with it, so mipmaps and seams never pull black in
mask = im.convert('L').point(lambda v: 255 if v < 15 else 0)
im.paste(Image.new('RGB', im.size, tuple(med)), (0, 0), mask)
# the photographs' fine detail (freckles, fine lines, pores, stubble) is soft on a game-sized face: amplify what
# differs from a blurred copy, leaving broad tone (lips, cheeks, the flush of the knees) as photographed
BOOST, RADIUS = 2.2, 12
soft = im.filter(ImageFilter.GaussianBlur(RADIUS))
fine = ImageChops.subtract(im, soft, 1, 128).point(lambda v: max(0, min(255, round(128 + (v - 128) * BOOST))))
detail = ImageChops.add(soft, fine, 1, -128)
# albedo detail, full resolution: half the ratio to the median, sRGB-encoded (the GPU decodes it)
lut = []
for k in range(3):
    enc = lambda x: 12.92 * x if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055
    lut += [min(255, round(255 * enc(min(1.0, 0.5 * v / max(1, med[k]))))) for v in range(256)]
detail.point(lut).save(out + '.jpg', quality=90)
# relief: the photograph's fine detail (pores, stubble, fine lines) as height, darker = deeper; its slopes as a
# tangent-space normal map
L = im.convert('L')
hp = ImageChops.subtract(L, L.filter(ImageFilter.GaussianBlur(5)), 1, 128)
hp = hp.filter(ImageFilter.GaussianBlur(0.7))
gx = hp.filter(ImageFilter.Kernel((3, 3), [-1, 0, 1, -2, 0, 2, -1, 0, 1], 1, 128))
gy = hp.filter(ImageFilter.Kernel((3, 3), [-1, -2, -1, 0, 0, 0, 1, 2, 1], 1, 128))
k = 2.2
nx = gx.point(lambda v: max(0, min(255, round(128 - (v - 128) * k))))
ny = gy.point(lambda v: max(0, min(255, round(128 + (v - 128) * k))))
nz = Image.new('L', L.size, 255)
Image.merge('RGB', (nx, ny, nz)).save(out + '_normal.jpg', quality=90)
# roughness (green channel; blue = metallic 0): skin 0.5, lips and the damp inner parts shinier (reddest), pores
# and creases rougher
r, g, b = im.split()
red = ImageChops.subtract(r, g, 1, 0).point(lambda v: min(255, v * 3))
rough = ImageChops.subtract(Image.new('L', L.size, 132), red.point(lambda v: v * 50 // 255))
rough = ImageChops.add(rough, hp.point(lambda v: max(0, 128 - v) // 2))
Image.merge('RGB', (Image.new('L', L.size, 255), rough, Image.new('L', L.size, 0))).resize((1024, 1024)).save(out + '_rough.jpg', quality=90)
# a swatch for the designer: a patch of cheek, at the photograph's own colour
im.crop((1800, 700, 1928, 828)).resize((96, 96), Image.LANCZOS).save(out + '_swatch.jpg', quality=85)
print('#%02x%02x%02x' % tuple(med))
`, join(sdir, id, mat.diffuseTexture.replace(/^.*[\\/]/, '')), join(OUT, 'tex', 'skin', id)]).toString().trim()
    const [label, sex] = system ? [id.split('_')[1].replace(/^./, (c) => c.toUpperCase()), id.split('_')[2]] : SKINS.get(id)
    index.push({
      kind: 'skin', id, name: label, tags: [sex], auto: system, pack: system ? 'makehuman_system_assets' : basename(dir), license: 'CC0',
      author: system ? 'MakeHuman team' : id.split('_')[0], homepage: null, thumb: `tex/skin/${id}_swatch.jpg`, texture: `tex/skin/${id}.jpg`,
      tone, verts: 0, tris: 0, hides: 0,
    })
  }
}
index.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))

// the skin's micro-detail, tiled finely over every skin (a 2048 atlas leaves a face ~400 px, soft up close): pores and
// fine lines as a Babylon detail map, made here (so CC0): red = albedo detail, green = normal y, blue = roughness
// detail, alpha = normal x; 0.5 is neutral throughout. Seamless: drawn and blurred on a wrapped 3×3 canvas.
execFileSync('python3', ['-c', `
import random, sys
from PIL import Image, ImageDraw, ImageFilter, ImageChops
N = 512
rnd = random.Random(7)
H = Image.new('L', (3 * N, 3 * N), 128)
d = ImageDraw.Draw(H)
def dot(x, y, r, v):
    for ox in (0, N, 2 * N):
        for oy in (0, N, 2 * N):
            d.ellipse((x + ox - r, y + oy - r, x + ox + r, y + oy + r), fill=v)
# fine lines first (the skin's criss-cross microrelief), then pores over them
for _ in range(900):
    x, y = rnd.uniform(0, N), rnd.uniform(0, N)
    ang = rnd.choice((0.6, 2.3)) + rnd.uniform(-0.25, 0.25)
    import math
    L = rnd.uniform(12, 40)
    dx, dy = math.cos(ang) * L / 2, math.sin(ang) * L / 2
    for ox in (0, N, 2 * N):
        for oy in (0, N, 2 * N):
            d.line((x - dx + ox, y - dy + oy, x + dx + ox, y + dy + oy), fill=112, width=1)
for _ in range(420):
    dot(rnd.uniform(0, N), rnd.uniform(0, N), rnd.uniform(1.2, 2.4), rnd.randint(60, 90))
H = H.filter(ImageFilter.GaussianBlur(1.1))
# fine grain
noise = Image.effect_noise((3 * N, 3 * N), 18).filter(ImageFilter.GaussianBlur(0.8))
H = ImageChops.add(H, noise, 1, -128)
H = H.crop((N, N, 2 * N, 2 * N))
# slopes, wrapped, as a tangent-space normal (x in alpha, y in green)
W = Image.new('L', (N + 2, N + 2))
for ox in (-1, 0, 1):
    for oy in (-1, 0, 1):
        W.paste(H, (1 + ox * N, 1 + oy * N))
k = 3.0
gx = W.filter(ImageFilter.Kernel((3, 3), [-1, 0, 1, -2, 0, 2, -1, 0, 1], 1, 128)).crop((1, 1, N + 1, N + 1))
gy = W.filter(ImageFilter.Kernel((3, 3), [-1, -2, -1, 0, 0, 0, 1, 2, 1], 1, 128)).crop((1, 1, N + 1, N + 1))
nx = gx.point(lambda v: max(0, min(255, round(128 - (v - 128) * k))))
ny = gy.point(lambda v: max(0, min(255, round(128 + (v - 128) * k))))
# albedo: pores and lines a touch darker; roughness: rougher in them
albedo = H.point(lambda v: max(0, min(255, round(128 + (v - 128) * 0.6))))
rough = H.point(lambda v: max(0, min(255, round(128 - (v - 128) * 0.8))))
Image.merge('RGBA', (albedo, ny, rough, nx)).save(sys.argv[1], optimize=True)
`, join(OUT, 'tex', 'skin', 'detail.png')])

// the low quality's textures, beside each full one as <name>.lo.<ext>: garments, hair and brows at 512, the skin's
// detail and relief at 1024 (its roughness is already 1024)
execFileSync('python3', ['-c', `
import os, sys
from PIL import Image
out = sys.argv[1]
jobs = [('clothes', 512), ('hair', 512), ('eyebrows', 512), ('eyelashes', 256), ('skin', 1024), ('teeth', 128), ('tongue', 128)]
for kind, size in jobs:
    d = os.path.join(out, 'tex', kind)
    if not os.path.isdir(d): continue
    for f in os.listdir(d):
        stem, ext = os.path.splitext(f)
        if '.lo' in stem or stem.endswith('_swatch') or stem.endswith('_rough') or ext not in ('.jpg', '.png'): continue
        im = Image.open(os.path.join(d, f))
        if max(im.size) > size: im = im.resize((size, size) if im.size[0] == im.size[1] else (size, round(im.size[1] * size / im.size[0])), Image.LANCZOS)
        dst = os.path.join(d, stem + '.lo' + ext)
        if ext == '.png': im.save(dst, optimize=True)
        else: im.convert('RGB').save(dst, quality=85)
`, OUT])
// a community asset without an author line: the author most often named on assets with the same name prefix
// (community packs prefix each asset with its author's handle), marked as inferred
for (const a of index) {
  if (a.author || a.license === 'CC0') continue
  const prefix = a.id.split('_')[0]
  const votes = {}
  for (const b of index) if (b.author && b.id.split('_')[0] === prefix) votes[b.author] = (votes[b.author] ?? 0) + 1
  const best = Object.entries(votes).sort((x, y) => y[1] - x[1])[0]
  // no other asset names that handle: the prefix is the uploader's community handle itself
  a.author = best ? best[0] : prefix
  a.authorInferred = true
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify({ source: 'MakeHuman asset packs (makehumancommunity.org)', assets: index }, null, 1))
const credited = index.filter((a) => a.license !== 'CC0')
writeFileSync('CREDITS.md', [
  '# Credits', '',
  'The avatars are built from [MakeHuman](http://www.makehumancommunity.org) data: the base mesh, skeleton, weights,',
  'targets, eyes and the system assets are CC0. The assets below are CC-BY 4.0 and are used with attribution; each',
  'was modified for the web (converted from MakeHuman\'s .mhclo/.obj/.mhmat, textures downsampled).', '',
  '| Asset | Kind | Author | Licence | Pack |', '|---|---|---|---|---|',
  ...credited.map((a) => `| ${a.name} | ${a.kind} | ${a.author ?? 'unknown'}${a.authorInferred ? ' (inferred from the pack naming)' : ''} | ${a.license} | ${a.pack} |`), '',
].join('\n'))
const count = {}
const missing = [...WARDROBE.keys()].filter((id) => !seen.has(`clothes/${id}`))
if (missing.length) console.warn(`wardrobe items not found in the packs: ${missing.join(' ')}`)
for (const a of index) count[a.kind] = (count[a.kind] ?? 0) + 1
console.log(`assets ${index.length} ${JSON.stringify(count)}  CC-BY ${credited.length}  proxies ${(bytes / 1024 / 1024).toFixed(1)} MB`)
