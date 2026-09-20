/**
 * The MakeHuman body: MakeHuman's CC0 base mesh, skeleton and skin weights (tools/mkmh.mjs) shaped by MakeHuman's
 * modifiers (mhmodifiers.ts), put into our rest pose, and dressed in MakeHuman proxies (mhassets.ts): eyes, hair,
 * eyebrows, eyelashes, clothes and shoes.
 *
 * MakeHuman's own methods are kept wherever they apply: targets add to the base mesh; a joint is the mean of a set of
 * mesh vertices (so joints follow any shape); the skin weights are MakeHuman's; a proxy is fitted by barycentric
 * weights and scaled offsets (.mhclo), skinned by blending its reference vertices' weights, and hides the skin it
 * covers (delete_verts). Two things are ours: the bones are collapsed onto our 21, and the rest pose is converted —
 * MakeHuman rests with bent elbows and knees, and our poser wants each limb straight along one direction — by
 * re-posing the mesh with its own weights, as MakeHuman does when it changes rest pose.
 */
import mh from './mhbase.json' with { type: 'json' }
import { garmentSlot, loadedProxy } from './mhassets.ts'
import { applyTargets, EXPRESSION_UNITS, expressionDeltas, type ExpressionUnit } from './mhmodifiers.ts'
import type { MhProxy, ProxyKind } from './mhproxy.ts'
import type { Quality } from './build.ts'
import { HAND_MORPHS, type HandMorph } from '../anim/hands.ts'
import { BONES, type BodyBone, type Rig } from './rig.ts'
import { cross, dot, len, mirror, norm, rotate, sub, type V3 } from './vec.ts'
import type { AvatarSpec } from '../spec.ts'

interface MhAsset {
  bones: string[]
  positions: number[]
  tris: number[]
  used: number[]
  /** the body as rendered: split at uv seams, each vertex naming its source vertex */
  render: { src: number[]; uv: number[]; tris: number[] }
  /** ambient occlusion baked on the base mesh (tools/mkmhao.mjs), per base vertex (1 = open) */
  ao?: number[]
  weights: number[][]
  joints: Record<string, number[]>
  /** the fingers' phalanges (MakeHuman's finger1-1 … finger5-3): joints (right hand) and weights (vertex -> [bone, w, …]) */
  fingers: { bones: string[]; joints: Record<string, number[]>; weights: Record<string, number[]> }
  eyes: { fit: number[][]; scale: Record<'x' | 'y' | 'z', [number, number, number]>; tris: number[]; cornea: number[]; uv: number[] }
}
const A = mh as unknown as MhAsset
if (A.bones.join() !== BONES.join()) throw new Error('mhbase.json was built for a different bone list')

/** Eye height above the chin in head heights, measured from MakeHuman's eye helpers. */
const EYE_V = 0.4825

/** A morph target: a facial expression unit or a hand pose. */
export type MorphKey = ExpressionUnit | HandMorph

export interface MeshPart {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  boneIndices: Float32Array
  boneWeights: Float32Array
  /** facial expression units and hand poses: each vertex's move at full strength (n × 3, rest pose), for morph targets */
  morphs?: Partial<Record<MorphKey, Float32Array>>
}

export interface ProxyMesh extends MeshPart {
  kind: ProxyKind
  id: string
  uvs: Float32Array
  material: MhProxy['material']
  zDepth: number
  tint?: string
}

export interface MakeHumanMesh {
  rig: Rig
  /** the body, split at the skin texture's uv seams (src: each vertex's base-mesh vertex) */
  /** ao: baked occlusion; tone: the complexion's parts per vertex (redness, under-eye shade, beard area, blotch pattern),
   * which the renderer mixes by the spec's skin settings */
  body: MeshPart & { uvs: Float32Array; src: Uint32Array; ao: Float32Array; tone: Float32Array }
  /** the eyeballs (their texture is the eye material) and the clear corneas over them (same vertices) */
  eyes: MeshPart & { uvs: Float32Array; cornea: Uint32Array }
  /** hair, eyebrows, eyelashes, clothes, shoes */
  proxies: ProxyMesh[]
}

/** One proxy an avatar wears, and its tint. */
export interface Worn { kind: ProxyKind; id: string; tint?: string }

/** MakeHuman's low-poly body for this spec (drawn at low quality): the female one below Gender 0.5. */
export const lowBodyFor = (spec: AvatarSpec): string => (spec.macros.Gender < 0.5 ? 'female1605' : 'male1591')

/** The proxies a spec names. */
/**
 * Nobody is drawn bare: an avatar with nothing over its hips wears these briefs, and one with a woman's chest
 * wears this top. Games and the designer get the same body, so a spec can't produce a nude avatar anywhere.
 */
export const MODESTY = { bottoms: 'punkduck_sport_briefs', top: 'punkduck_sport_bra' } as const
/** a chest this size or larger is covered whatever the gender says (MakeHuman's BreastSize, 0..1) */
const COVER_CHEST = 0.1

/** What a spec wears, with the modesty garments added where it covers nothing (see MODESTY). */
export function modestyFor(spec: AvatarSpec): Worn[] {
  const slots = spec.clothes.map((c) => garmentSlot(c.id))
  const add: Worn[] = []
  // (an outfit is a whole garment: a dress or a suit covers both)
  if (!slots.some((s) => s === 'bottoms' || s === 'outfits')) add.push({ kind: 'clothes', id: MODESTY.bottoms })
  const chest = spec.macros.Gender < 0.5 || spec.macros.BreastSize > COVER_CHEST
  if (chest && !slots.some((s) => s === 'tops' || s === 'outfits')) add.push({ kind: 'clothes', id: MODESTY.top })
  return add
}

export function wornFor(spec: AvatarSpec): Worn[] {
  const w: Worn[] = []
  if (spec.hair.id) w.push({ kind: 'hair', id: spec.hair.id, tint: spec.hair.color })
  if (spec.eyebrows) w.push({ kind: 'eyebrows', id: spec.eyebrows, tint: spec.hair.color })
  if (spec.eyelashes) w.push({ kind: 'eyelashes', id: spec.eyelashes })
  // the mouth's insides, seen when it opens (facial expressions)
  w.push({ kind: 'teeth', id: 'teeth_base' }, { kind: 'tongue', id: 'tongue01' })
  // (worn under the spec's own clothes: layering sorts the order out)
  for (const m of modestyFor(spec)) w.push(m)
  for (const c of spec.clothes) w.push({ kind: 'clothes', id: c.id, tint: c.color })
  return w
}

/** A MakeHuman proxy's fitting (.mhclo): per vertex three base vertices, their weights and an offset. */
export interface ProxyFit {
  fit: number[][]
  scale: Record<'x' | 'y' | 'z', [number, number, number]>
}

/** MakeHuman's proxy fitting: Σ wᵢ·Pᵢ over three base vertices, plus an offset scaled by the body's own size. */
export function fitProxy(P: Float64Array, f: ProxyFit): Float32Array {
  const ax = (k: 'x' | 'y' | 'z', c: number): number => { const [a, b, d] = f.scale[k]; return Math.abs(P[3 * a + c] - P[3 * b + c]) / d }
  const sc = [ax('x', 0), ax('y', 1), ax('z', 2)]
  const out = new Float32Array(f.fit.length * 3)
  f.fit.forEach(([a, b, c, wa, wb, wc, dx, dy, dz], i) => {
    out[3 * i] = wa * P[3 * a] + wb * P[3 * b] + wc * P[3 * c] + dx * sc[0]
    out[3 * i + 1] = wa * P[3 * a + 1] + wb * P[3 * b + 1] + wc * P[3 * c + 1] + dy * sc[1]
    out[3 * i + 2] = wa * P[3 * a + 2] + wb * P[3 * b + 2] + wc * P[3 * c + 2] + dz * sc[2]
  })
  return out
}

/** How far out each garment is worn: socks under shoes under trousers under tops; boots over trousers; hats, glasses
 *  and gloves outermost. (MakeHuman's own z_depth is 50 on nearly every community garment, so it can't order them.) */
export function clothingLayer(pr: { slot?: string; id: string }): number {
  switch (pr.slot) {
    case 'socks': return 0
    case 'shoes': return /boot/.test(pr.id) ? 3.5 : 1
    case 'bottoms': return 2
    case 'tops': case 'outfits': return 3
    case 'other': return 5
    default: return 3
  }
}

/**
 * Garments are fitted to the body one by one, so where two overlap (a shirt over the waistband of shorts) they sit
 * at much the same distance from the skin and poke through each other. Worn inside out, layer by layer: each garment
 * records how far off the skin it stands at the body vertices it follows, and each garment worn over it is pushed out
 * along the body's normal until it clears that by a few millimetres.
 */
export function layerClothes(P: Float64Array, normals: Float32Array, wear: MhProxy[], fitted: Float32Array[]): void {
  const GAP = 0.004
  const clearance = new Float32Array(P.length / 3)
  const order = wear.map((pr, k) => k).filter((k) => wear[k].kind === 'clothes')
    .sort((a, b) => clothingLayer(wear[a]) - clothingLayer(wear[b]) || a - b)
  let prevLayer = -1
  let pending: Array<[number, number]> = []
  for (const k of order) {
    const layer = clothingLayer(wear[k])
    // garments in the same layer don't push each other: commit what the layer below recorded only on a new layer
    if (layer !== prevLayer) { for (const [v, d] of pending) if (d > clearance[v]) clearance[v] = d; pending = []; prevLayer = layer }
    const pos = fitted[k]
    wear[k].fit.forEach(([a, b, c, wa, wb, wc], i) => {
      let nx = wa * normals[3 * a] + wb * normals[3 * b] + wc * normals[3 * c]
      let ny = wa * normals[3 * a + 1] + wb * normals[3 * b + 1] + wc * normals[3 * c + 1]
      let nz = wa * normals[3 * a + 2] + wb * normals[3 * b + 2] + wc * normals[3 * c + 2]
      const nl = Math.hypot(nx, ny, nz) || 1
      nx /= nl; ny /= nl; nz /= nl
      const bx = wa * P[3 * a] + wb * P[3 * b] + wc * P[3 * c]
      const by = wa * P[3 * a + 1] + wb * P[3 * b + 1] + wc * P[3 * c + 1]
      const bz = wa * P[3 * a + 2] + wb * P[3 * b + 2] + wc * P[3 * c + 2]
      let d = (pos[3 * i] - bx) * nx + (pos[3 * i + 1] - by) * ny + (pos[3 * i + 2] - bz) * nz
      // what lies beneath: the most any of its body vertices already carries
      const under = Math.max(wa > 0.05 ? clearance[a] : 0, wb > 0.05 ? clearance[b] : 0, wc > 0.05 ? clearance[c] : 0)
      if (under > 0 && d < under + GAP) {
        const push = under + GAP - d
        pos[3 * i] += nx * push; pos[3 * i + 1] += ny * push; pos[3 * i + 2] += nz * push
        d = under + GAP
      }
      if (d > 0) for (const [v, w] of [[a, wa], [b, wb], [c, wc]] as const) if (w > 0.2) pending.push([v, d])
    })
  }
}

/** Hats, caps and helmets (MakeHuman files them with the clothes). */
export const isHat = (id: string): boolean => /hat|cap|helmet|fedora|trilby|visor/i.test(id)

/**
 * Hair under a hat: which of each hair's vertices a hat covers, by direction from the head's centre (MakeHuman's hair
 * follows a helper shell around the head and hats the scalp, so they share no base vertices to compare). Hair the hat
 * covers can't be seen, so its triangles are dropped rather than squeezed; hair the hat doesn't cover (below the
 * brim, a ponytail, long hair down the back) keeps its shape.
 */
export function hairUnderHats(wear: MhProxy[], fitted: Float32Array[], center: V3): Map<number, Uint8Array> {
  const covered = new Map<number, Uint8Array>()
  // directions binned on a cube map (6 faces × S × S cells of about 6°: even everywhere, the crown included)
  const S = 16
  const hats = wear.map((pr, k) => k).filter((k) => wear[k].kind === 'clothes' && isHat(wear[k].id))
  if (!hats.length) return covered
  const cell = (x: number, y: number, z: number): [number, number, number, number, number] => {
    const dx = x - center[0], dy = y - center[1], dz = z - center[2]
    const r = Math.hypot(dx, dy, dz) || 1e-9
    const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz)
    let f: number, u: number, v: number
    if (ax >= ay && ax >= az) { f = dx > 0 ? 0 : 1; u = dz / ax; v = dy / ax }
    else if (ay >= az) { f = dy > 0 ? 2 : 3; u = dx / ay; v = dz / ay }
    else { f = dz > 0 ? 4 : 5; u = dx / az; v = dy / az }
    const i = Math.min(S - 1, Math.floor(((u + 1) / 2) * S)), j = Math.min(S - 1, Math.floor(((v + 1) / 2) * S))
    return [(f * S + j) * S + i, r, f, i, j]
  }
  // the directions the hat covers: points sampled across each of its triangles (a low-poly hat's vertices are
  // centimetres apart, far sparser than the cells), with any gaps left between them filled
  const inner = new Float32Array(6 * S * S).fill(Infinity)
  for (const k of hats) {
    const pos = fitted[k], tri = wear[k].tris
    const mark = (x: number, y: number, z: number): void => {
      const [c, r] = cell(x, y, z)
      if (r < inner[c]) inner[c] = r
    }
    for (let t = 0; t < tri.length; t += 3) {
      const a = 3 * tri[t], b = 3 * tri[t + 1], c = 3 * tri[t + 2]
      const edge = Math.max(
        Math.hypot(pos[a] - pos[b], pos[a + 1] - pos[b + 1], pos[a + 2] - pos[b + 2]),
        Math.hypot(pos[b] - pos[c], pos[b + 1] - pos[c + 1], pos[b + 2] - pos[c + 2]),
        Math.hypot(pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]))
      const n = Math.max(1, Math.min(40, Math.ceil(edge / 0.004)))
      for (let i = 0; i <= n; i++) {
        for (let j = 0; j <= n - i; j++) {
          const u = i / n, v = j / n, w = 1 - u - v
          mark(u * pos[a] + v * pos[b] + w * pos[c], u * pos[a + 1] + v * pos[b + 1] + w * pos[c + 1], u * pos[a + 2] + v * pos[b + 2] + w * pos[c + 2])
        }
      }
    }
  }
  // (twice: a snug hat's vertices can be a few cells apart)
  for (let pass = 0; pass < 2; pass++) fillCells(inner, S)
  for (const [k, pr] of wear.entries()) {
    if (pr.kind !== 'hair') continue
    const pos = fitted[k]
    const under = new Uint8Array(pos.length / 3)
    for (let i = 0; i < pos.length; i += 3) under[i / 3] = Number.isFinite(inner[cell(pos[i], pos[i + 1], pos[i + 2])[0]]) ? 1 : 0
    covered.set(k, under)
  }
  return covered
}

/**
 * Fill the gaps inside a hat's cube-map cover: an empty cell with at least 5 of its 8 neighbours covered takes their
 * least radius. (It fills holes between the hat's vertices without growing past its rim, where hair below the brim
 * must keep its shape.)
 */
function fillCells(cells: Float32Array, S: number): void {
  const src = cells.slice()
  for (let f = 0; f < 6; f++) {
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        if (Number.isFinite(src[(f * S + j) * S + i])) continue
        let m = Infinity, n = 0
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const jj = j + dj, ii = i + di
            if ((dj || di) && jj >= 0 && jj < S && ii >= 0 && ii < S && Number.isFinite(src[(f * S + jj) * S + ii])) {
              m = Math.min(m, src[(f * S + jj) * S + ii])
              n++
            }
          }
        }
        if (n >= 5) cells[(f * S + j) * S + i] = m
      }
    }
  }
}

/** A triangle list less the triangles whose three corners are all covered. */
function dropCovered(tri: Uint32Array, under: Uint8Array): Uint32Array {
  const kept: number[] = []
  for (let t = 0; t < tri.length; t += 3) if (!(under[tri[t]] && under[tri[t + 1]] && under[tri[t + 2]])) kept.push(tri[t], tri[t + 1], tri[t + 2])
  return Uint32Array.from(kept)
}

/** MakeHuman's proxy skinning: each vertex takes its three base vertices' weights, blended by its fitting weights. */
export function proxyWeights(f: ProxyFit, bi: Float32Array, bw: Float32Array): { indices: Float32Array; weights: Float32Array } {
  const n = f.fit.length
  const indices = new Float32Array(n * 4), weights = new Float32Array(n * 4)
  const acc = new Map<number, number>()
  f.fit.forEach(([a, b, c, wa, wb, wc], i) => {
    acc.clear()
    for (const [v, w] of [[a, wa], [b, wb], [c, wc]]) {
      if (w <= 0) continue
      for (let s = 0; s < 4; s++) {
        const x = bw[4 * v + s]
        if (x > 0) acc.set(bi[4 * v + s], (acc.get(bi[4 * v + s]) ?? 0) + w * x)
      }
    }
    const top = [...acc].sort((p, q) => q[1] - p[1]).slice(0, 4)
    const sum = top.reduce((t, [, w]) => t + w, 0) || 1
    top.forEach(([bone, w], s) => { indices[4 * i + s] = bone; weights[4 * i + s] = w / sum })
    if (top.length === 0) { indices[4 * i] = B('head'); weights[4 * i] = 1 }
  })
  return { indices, weights }
}

const B = (b: BodyBone): number => BONES.indexOf(b)
const ARMS = new Set(['shoulder', 'upperArm', 'forearm', 'hand'].flatMap((b) => [B(`${b}.L` as BodyBone), B(`${b}.R` as BodyBone)]))
const LEGS = new Set(['thigh', 'shin', 'foot', 'toes'].flatMap((b) => [B(`${b}.L` as BodyBone), B(`${b}.R` as BodyBone)]))

/** The MakeHuman body a spec describes (its targets and proxies must be loaded: see preloadAssets). */
export function buildMakeHuman(spec: AvatarSpec, worn: Worn[] = wornFor(spec), quality: Quality = 'high'): MakeHumanMesh {
  const wear: MhProxy[] = []
  const tints: Array<string | undefined> = []
  for (const w of worn) {
    const px = loadedProxy(w.kind, w.id)
    if (!px) throw new Error(`MakeHuman ${w.kind} ${w.id} is not loaded (await preloadAssets(spec) first)`)
    wear.push(px)
    tints.push(w.tint)
  }
  const P = Float64Array.from(A.positions)
  const N = P.length / 3
  applyTargets(P, spec.macros, spec.modifiers)

  // ---- skin weights for every vertex (the helper cages clothes and hair fit to must pose with the body)
  const bi = new Float32Array(N * 4), bw = new Float32Array(N * 4)
  A.weights.forEach((list, v) => {
    let sum = 0
    for (let s = 0; s < 4 && 2 * s < list.length; s++) { bi[4 * v + s] = list[2 * s]; bw[4 * v + s] = list[2 * s + 1]; sum += list[2 * s + 1] }
    // (stored to four decimals: renormalised so each vertex's weights sum to exactly one)
    for (let s = 0; s < 4; s++) bw[4 * v + s] /= sum
  })
  const wOf = (v: number, bones: number[]): number => {
    let w = 0
    for (let s = 0; s < 4; s++) if (bones.includes(bi[4 * v + s])) w += bw[4 * v + s]
    return w
  }
  const j = (name: string): V3 => mean(P, A.joints[name])

  // ---- rest pose: straighten the elbows and knees along the upper arm and the thigh (every vertex)
  {
    const S = j('upperarm01.L'), E = j('lowerarm01.L'), W = j('wrist.L')
    const H = j('upperleg01.L'), K = j('lowerleg01.L'), An = j('foot.L')
    const armR = rotationOnto(norm(sub(W, E)), norm(sub(E, S)))
    const legR = rotationOnto(norm(sub(An, K)), norm(sub(K, H)))
    const footShift = sub(spin(An, K, legR), An)
    for (const sg of [1, -1]) {
      const sd = sg > 0 ? 'R' : 'L'
      const arm = [B(`forearm.${sd}` as BodyBone), B(`hand.${sd}` as BodyBone)]
      const shin = [B(`shin.${sd}` as BodyBone)], foot = [B(`foot.${sd}` as BodyBone), B(`toes.${sd}` as BodyBone)]
      const e = side(E, sg), kn = side(K, sg), aR = sideRot(armR, sg), lR = sideRot(legR, sg), fs = side(footShift, sg)
      for (let v = 0; v < N; v++) {
        const p: V3 = [P[3 * v], P[3 * v + 1], P[3 * v + 2]]
        if (p[0] * sg <= 0) continue
        let q = p
        const wa = wOf(v, arm)
        if (wa > 0) q = blend(q, spin(p, e, aR), wa)
        const ws = wOf(v, shin)
        if (ws > 0) q = blend(q, spin(p, kn, lR), ws)
        const wf = wOf(v, foot)
        if (wf > 0) q = [q[0] + fs[0] * wf, q[1] + fs[1] * wf, q[2] + fs[2] * wf]
        P[3 * v] = q[0]; P[3 * v + 1] = q[1]; P[3 * v + 2] = q[2]
      }
    }
  }

  // hands: relaxed in the rest pose; the other hand poses are morph targets, their moves from it (base vertices)
  const flat = P.slice()
  relaxHands(P, HAND_SHAPES.relaxed)
  const handDeltas = HAND_MORPHS.map((m) => {
    const Q = flat.slice()
    relaxHands(Q, HAND_SHAPES[m])
    const D = new Float32Array(3 * N)
    for (const v of Object.keys(A.fingers.weights)) for (let k = 0; k < 3; k++) D[3 * +v + k] = Q[3 * +v + k] - P[3 * +v + k]
    return [m, D] as const
  })

  // ---- what the clothes hide (MakeHuman's delete_verts), and the ground: under the soles when shoes are worn
  const hidden = new Uint8Array(N)
  for (const pr of wear) for (const v of pr.deleteVerts) hidden[v] = 1
  let floor = Infinity
  for (const v of A.used) if (!hidden[v]) floor = Math.min(floor, P[3 * v + 1])
  for (const pr of wear) {
    if (pr.kind !== 'clothes') continue
    const q = fitProxy(P, pr)
    for (let i = 1; i < q.length; i += 3) floor = Math.min(floor, q[i])
  }
  // ankles over the origin
  const ankleZ = j('foot.L')[2]
  for (let v = 0; v < N; v++) { P[3 * v + 1] -= floor; P[3 * v + 2] -= ankleZ }

  // ---- the rig, from MakeHuman's joints and the mesh
  const mid = (p: V3): V3 => [0, p[1], p[2]]
  const S = j('upperarm01.L'), E = j('lowerarm01.L'), W = j('wrist.L'), tip = j('finger3-3.L:tail')
  const H = j('upperleg01.L'), K = j('lowerleg01.L'), An = j('foot.L'), ball = j('toe3-1.L'), toeTip = j('toe3-3.L:tail')
  const joints = {} as Record<BodyBone, V3>
  joints.hips = mid(j('spine05'))
  joints.spine = mid(j('spine04'))
  joints.chest = mid(j('spine02'))
  joints.neck = mid(j('neck01'))
  joints.head = mid(j('head'))
  for (const [sg, sd] of [[1, 'R'], [-1, 'L']] as Array<[number, 'R' | 'L']>) {
    joints[`shoulder.${sd}`] = side(j('clavicle.L'), sg)
    joints[`upperArm.${sd}`] = side(S, sg)
    joints[`forearm.${sd}`] = side(E, sg)
    joints[`hand.${sd}`] = side(W, sg)
    joints[`thigh.${sd}`] = side(H, sg)
    joints[`shin.${sd}`] = side(K, sg)
    joints[`foot.${sd}`] = side(An, sg)
    joints[`toes.${sd}`] = side(ball, sg)
  }
  const dominant = (v: number): number => {
    let b = bi[4 * v], w = bw[4 * v]
    for (let s = 1; s < 4; s++) if (bw[4 * v + s] > w) { w = bw[4 * v + s]; b = bi[4 * v + s] }
    return b
  }
  let crown = -Infinity, hipOuter = 0, crotchY = H[1]
  for (const v of A.used) {
    const x = P[3 * v], y = P[3 * v + 1], d = dominant(v)
    crown = Math.max(crown, y)
    if (Math.abs(y - H[1]) < 0.06 && !ARMS.has(d)) hipOuter = Math.max(hipOuter, Math.abs(x))
    if (Math.abs(x) < 0.012 && y > K[1] && y < H[1] && !ARMS.has(d)) crotchY = Math.min(crotchY, y)
  }
  // the trunk's half-width by height (arms and legs excluded), for arm clearance
  const step = 0.01, y0 = Math.max(0, crotchY - 0.05), rows = Math.ceil((S[1] + 0.05 - y0) / step) + 1
  const torsoW = new Array<number>(rows).fill(0)
  for (const v of A.used) {
    const d = dominant(v)
    if (ARMS.has(d) || LEGS.has(d)) continue
    const k = Math.round((P[3 * v + 1] - y0) / step)
    if (k >= 0 && k < rows) torsoW[k] = Math.max(torsoW[k], Math.abs(P[3 * v]))
  }
  for (let k = 1; k < rows; k++) if (torsoW[k] === 0) torsoW[k] = torsoW[k - 1]
  // the chest's front (bust or pectorals) relative to the shoulder joints, between armpit and waist
  let chestFront = -Infinity
  for (const v of A.used) {
    const y = P[3 * v + 1], d = dominant(v)
    if (ARMS.has(d) || LEGS.has(d) || y > S[1] - 0.04 || y < S[1] - 0.3) continue
    chestFront = Math.max(chestFront, P[3 * v + 2])
  }

  // ---- eyes: MakeHuman's proxy fitting against the posed base mesh
  const eyeP = fitProxy(P, A.eyes)
  const eyeW = proxyWeights(A.eyes, bi, bw)
  const eyeI = new Uint32Array(A.eyes.tris)
  let eyeY = 0
  for (let i = 1; i < eyeP.length; i += 3) eyeY += eyeP[i] / (eyeP.length / 3)
  const headH = (crown - eyeY) / (1 - EYE_V)
  let z0 = Infinity, z1 = -Infinity, xr = 0
  for (const v of A.used) {
    if (P[3 * v + 1] < eyeY) continue
    z0 = Math.min(z0, P[3 * v + 2]); z1 = Math.max(z1, P[3 * v + 2]); xr = Math.max(xr, Math.abs(P[3 * v]))
  }
  const armDir = norm(sub(E, S)), legDir = norm(sub(K, H))
  const rig: Rig = {
    height: crown, s: crown / 1.72, muscle: spec.macros.Muscle, build: spec.macros.Weight, joints, armDir, legDir,
    upperArmLen: len(sub(E, S)), forearmLen: len(sub(W, E)), handLen: len(sub(tip, W)),
    thighLen: len(sub(K, H)), shinLen: len(sub(An, K)), footLen: Math.hypot(toeTip[0] - An[0], toeTip[2] - An[2]), ankleH: An[1],
    armAngle: Math.acos(Math.min(1, -armDir[1])), legAngle: Math.acos(Math.min(1, -legDir[1])),
    headH, chinY: crown - headH, eyeY, headCenter: [0, crown - 0.45 * headH, (z0 + z1) / 2], headR: [xr, 0.45 * headH, (z1 - z0) / 2],
    shoulderHalf: S[0], hipHalf: H[0], hipOuter, crotchY, chestDepth: chestFront - S[2], torso: { y0, step, w: torsoW },
  }

  // ---- the body as rendered (split at uv seams), less what the clothes hide (a face goes only when all its
  // corners are hidden, so the skin's cut edge stays inside the garment)
  const R = A.render
  const n = R.src.length
  const src = Uint32Array.from(R.src)
  const positions = new Float32Array(n * 3)
  const boneIndices = new Float32Array(n * 4), boneWeights = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    const v = src[i]
    positions[3 * i] = P[3 * v]; positions[3 * i + 1] = P[3 * v + 1]; positions[3 * i + 2] = P[3 * v + 2]
    for (let s = 0; s < 4; s++) { boneIndices[4 * i + s] = bi[4 * v + s]; boneWeights[4 * i + s] = bw[4 * v + s] }
  }
  const kept: number[] = []
  for (let t = 0; t < R.tris.length; t += 3) {
    const a = R.tris[t], b = R.tris[t + 1], c = R.tris[t + 2]
    if (hidden[src[a]] && hidden[src[b]] && hidden[src[c]]) continue
    kept.push(a, b, c)
  }
  const indices = new Uint32Array(kept)
  // normals on the welded mesh (every body face, hidden or not), so neither uv seams nor garment edges crease them
  const welded = new Float32Array(N * 3)
  {
    const Pf = new Float32Array(P)
    const nw = vertexNormals(Pf, Uint32Array.from(A.tris))
    welded.set(nw)
  }
  const normals = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { const v = src[i]; normals[3 * i] = welded[3 * v]; normals[3 * i + 1] = welded[3 * v + 1]; normals[3 * i + 2] = welded[3 * v + 2] }

  // the complexion per base vertex (see complexion()): the rendered body takes it per render vertex
  const tone = complexion(P, eyeP, rig, spec)
  let body: MakeHumanMesh['body'] = {
    positions, normals, indices, boneIndices, boneWeights, uvs: Float32Array.from(R.uv), src, ao: Float32Array.from(src, (v) => A.ao?.[v] ?? 1),
    tone: (() => { const out = new Float32Array(n * 4); for (let i = 0; i < n; i++) out.set(tone.subarray(4 * src[i], 4 * src[i] + 4), 4 * i); return out })(),
  }
  let lowBody: MhProxy | undefined
  if (quality === 'low') {
    lowBody = loadedProxy('body', lowBodyFor(spec))
    if (!lowBody) throw new Error(`MakeHuman body ${lowBodyFor(spec)} is not loaded (await preloadAssets(spec, 'low') first)`)
    body = lowPolyBody(lowBody, P, welded, bi, bw, hidden, tone, A.ao)
  }

  // clothes are fitted to a body whose chest curve is eased (see clothingBody); everything else follows the skin
  const dressBody = wear.some((pr) => pr.kind === 'clothes') ? clothingBody(P, spec) : P
  const fitted = wear.map((pr) => fitProxy(pr.kind === 'clothes' ? dressBody : P, pr))
  layerClothes(P, welded, wear, fitted)
  const underHats = hairUnderHats(wear, fitted, rig.headCenter)
  const proxies: ProxyMesh[] = wear.map((pr, k) => {
    const positions = fitted[k]
    // (a simplified triangle list over the same vertices at the lower qualities, where the garment has one)
    let tri: Uint32Array = new Uint32Array(quality === 'low' ? pr.lods?.low ?? pr.lods?.medium ?? pr.tris : quality === 'medium' ? pr.lods?.medium ?? pr.tris : pr.tris)
    // (hair a hat covers is dropped: see hairUnderHats)
    const under = underHats.get(k)
    if (under) tri = dropCovered(tri, under)
    const w = proxyWeights(pr, bi, bw)
    return {
      kind: pr.kind, id: pr.id, tint: tints[k], positions, normals: vertexNormals(positions, tri), indices: tri,
      uvs: new Float32Array(pr.uv), boneIndices: w.indices, boneWeights: w.weights, material: pr.material, zDepth: pr.zDepth,
    }
  })

  // facial expressions: each unit's move of the base vertices, carried to the rendered body (through its uv
  // splits, or the low body's fitting) and to the brows and lashes that sit on the face
  const units = EXPRESSION_UNITS.map((u) => [u, expressionDeltas(u, spec.macros, N)] as const)
  body.morphs = {}
  for (const [u, D] of units) {
    if (!D) continue
    body.morphs[u] = lowBody ? throughFit(lowBody.fit, D) : Float32Array.from({ length: body.positions.length }, (_, k) => D[3 * src[Math.floor(k / 3)] + (k % 3)])
  }
  for (const [k, pm] of proxies.entries()) {
    if (pm.kind !== 'eyebrows' && pm.kind !== 'eyelashes' && pm.kind !== 'teeth' && pm.kind !== 'tongue') continue
    pm.morphs = {}
    for (const [u, D] of units) if (D) pm.morphs[u] = throughFit(wear[k].fit, D)
  }
  // hand poses: the body, and any garment fitted to the hands (gloves)
  for (const [m, D] of handDeltas) {
    body.morphs[m] = lowBody ? throughFit(lowBody.fit, D) : Float32Array.from({ length: body.positions.length }, (_, k) => D[3 * src[Math.floor(k / 3)] + (k % 3)])
    for (const [k, pm] of proxies.entries()) {
      if (pm.kind !== 'clothes' || !wear[k].fit.some((r) => r[0] in A.fingers.weights || r[1] in A.fingers.weights || r[2] in A.fingers.weights)) continue
      ;(pm.morphs ??= {})[m] = throughFit(wear[k].fit, D)
    }
  }

  return {
    rig,
    body,
    eyes: {
      positions: eyeP, normals: vertexNormals(eyeP, eyeI), indices: eyeI, cornea: new Uint32Array(A.eyes.cornea), uvs: new Float32Array(A.eyes.uv),
      boneIndices: eyeW.indices, boneWeights: eyeW.weights,
    },
    proxies,
  }
}

/**
 * MakeHuman's low-poly body in place of the full one: fitted to the base body like any proxy, and everything the
 * full body carries per base vertex (bone weights, the welded normals, occlusion, complexion) blended through the
 * fitting weights. Its uvs follow the same skin atlas. A vertex is hidden under clothes when every base vertex it
 * follows is, and a face only when all its corners are (as for the full body).
 */
function lowPolyBody(
  pr: MhProxy, P: Float64Array, welded: Float32Array, bi: Float32Array, bw: Float32Array,
  hidden: ArrayLike<number | boolean>, tone: Float32Array, ao?: ArrayLike<number>,
): MakeHumanMesh['body'] {
  const positions = fitProxy(P, pr)
  const w = proxyWeights(pr, bi, bw)
  const n = pr.fit.length
  const normals = new Float32Array(n * 3), aoOut = new Float32Array(n), toneOut = new Float32Array(n * 4)
  const src = new Uint32Array(n), gone = new Uint8Array(n)
  pr.fit.forEach(([a, b, c, wa, wb, wc], i) => {
    const refs: Array<[number, number]> = [[a, wa], [b, wb], [c, wc]]
    let nx = 0, ny = 0, nz = 0, o = 0, sw = 0, best = -Infinity
    for (const [v, wt] of refs) {
      nx += wt * welded[3 * v]; ny += wt * welded[3 * v + 1]; nz += wt * welded[3 * v + 2]
      o += wt * (ao?.[v] ?? 1)
      for (let k = 0; k < 4; k++) toneOut[4 * i + k] += wt * tone[4 * v + k]
      sw += wt
      if (wt > best) { best = wt; src[i] = v }
    }
    const l = Math.hypot(nx, ny, nz) || 1
    normals[3 * i] = nx / l; normals[3 * i + 1] = ny / l; normals[3 * i + 2] = nz / l
    aoOut[i] = Math.min(1, Math.max(0, o / (sw || 1)))
    gone[i] = refs.every(([v, wt]) => Math.abs(wt) < 0.05 || hidden[v]) ? 1 : 0
  })
  const kept: number[] = []
  for (let t = 0; t < pr.tris.length; t += 3) {
    const [x, y, z] = [pr.tris[t], pr.tris[t + 1], pr.tris[t + 2]]
    if (gone[x] && gone[y] && gone[z]) continue
    kept.push(x, y, z)
  }
  return {
    positions, normals, indices: new Uint32Array(kept), boneIndices: w.indices, boneWeights: w.weights,
    uvs: new Float32Array(pr.uv), src, ao: aoOut, tone: toneOut,
  }
}

/** A base-vertex field (n × 3) carried to a proxy's vertices by its fitting weights. */
function throughFit(fit: MhProxy['fit'], D: Float32Array): Float32Array {
  const out = new Float32Array(fit.length * 3)
  fit.forEach(([a, b, c, wa, wb, wc], i) => {
    for (let k = 0; k < 3; k++) out[3 * i + k] = wa * D[3 * a + k] + wb * D[3 * b + k] + wc * D[3 * c + k]
  })
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// complexion

/**
 * No face is evenly coloured. Per base vertex, the parts of a complexion (0..1 each, blotch -1..1): where blood shows
 * through (the nose tip and wings, the apples of the cheeks, the ears, the chin, the upper lids), the shade under the
 * eyes, the beard area (the jaw and upper lip), and a gentle blotch pattern seeded by the avatar's own shape, so no two
 * faces are identically even. The renderer mixes them by the spec's skin settings (avatar.ts). Low-frequency
 * variation: the skin photograph carries the fine detail.
 */
function complexion(P: Float64Array, eyes: Float32Array, rig: Rig, spec: AvatarSpec): Float32Array {
  const N = P.length / 3
  const out = new Float32Array(N * 4)
  const h = rig.headH
  // landmarks, from this face
  let ex = 0, ey = 0, ez = 0, nEye = 0
  for (let i = 0; i < eyes.length; i += 3) if (eyes[i] > 0) { ex += eyes[i]; ey += eyes[i + 1]; ez += eyes[i + 2]; nEye++ }
  ex /= nEye; ey /= nEye; ez /= nEye
  const mouthY = rig.chinY + 0.2135 * h
  let nose: V3 = [0, 0, -Infinity], chin: V3 = [0, rig.chinY, 0], ear: V3 = [0, 0, 0]
  for (const v of A.used) {
    const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2]
    if (Math.abs(x) < 0.01 && y < ey && y > mouthY && z > nose[2]) nose = [0, y, z]
    if (Math.abs(x) < 0.01 && Math.abs(y - (rig.chinY + 0.03 * h)) < 0.02 * h && z > chin[2]) chin = [0, y, z]
    if (Math.abs(y - (ey - 0.02 * h)) < 0.05 * h && x > ear[0]) ear = [x, y, z]
  }
  const cheek: V3 = [ex + 0.01 * h, ey - 0.13 * h, ez - 0.01 * h]
  const under: V3 = [ex, ey - 0.055 * h, ez + 0.005 * h]
  const lid: V3 = [ex, ey + 0.035 * h, ez + 0.01 * h]
  // a seed from the shape (each face its own blotches)
  let seed = 0
  for (const m of Object.values(spec.macros)) seed = (seed * 31 + Math.round(m * 997)) >>> 0
  const blotch = (x: number, y: number, z: number): number => {
    const f = 38
    return (Math.sin(x * f * 1.3 + seed) * Math.sin(y * f + seed * 0.7) * Math.sin(z * f * 0.9 + seed * 1.3)
      + 0.5 * Math.sin(x * f * 2.7 - seed) * Math.sin(y * f * 2.1 + seed * 0.3)) * 0.66
  }
  const g = (d2: number, r: number): number => Math.exp(-d2 / (r * r))
  const d2 = (x: number, y: number, z: number, c: V3, sx = 1): number => (Math.abs(x) - c[0] * sx) ** 2 + (y - c[1]) ** 2 + (z - c[2]) ** 2
  for (let v = 0; v < N; v++) {
    const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2]
    if (y < rig.chinY - 0.12 * h) continue
    const onFace = y > rig.chinY - 0.05 * h ? 1 : 0.5
    const red = 0.9 * g(d2(x, y, z, nose, 0), 0.03 * h) + 0.7 * g(d2(x, y, z, cheek), 0.07 * h)
      + 0.6 * g(d2(x, y, z, ear), 0.05 * h) + 0.4 * g(d2(x, y, z, chin, 0), 0.05 * h) + 0.35 * g(d2(x, y, z, lid), 0.03 * h)
    const shade = g(d2(x, y, z, under), 0.028 * h)
    // beard: the jaw and upper lip, in front of the ears, below the cheeks
    const beard = Math.max(0, Math.min(1, (ey - 0.16 * h - y) / (0.08 * h))) * (z > ez - 0.12 * h ? 1 : 0) * (y > rig.chinY - 0.04 * h ? 1 : 0)
      * Math.max(0, 1 - g(d2(x, y, z, [0, mouthY, nose[2] - 0.02 * h], 0), 0.02 * h) * 1.5)
    out[4 * v] = Math.min(1, red) * onFace
    out[4 * v + 1] = shade
    out[4 * v + 2] = beard
    out[4 * v + 3] = Math.max(-1, Math.min(1, blotch(x, y, z))) * onFace
  }
  return out
}

/**
 * A hand shape: each finger's bend at each joint (thumb to little finger; knuckle, middle, tip; radians), and how
 * much closer to the middle finger's line each finger's tip comes than its knuckle is (index, ring and little
 * finger close up until they touch).
 */
interface HandShape {
  curl: number[][]
  close: number[]
  /**
   * where the thumb's tip goes: toward a joint of the curled fingers (a MakeHuman finger joint name), by `amount`
   * (0 leaves it where its own bend puts it)
   */
  thumb: { to: string; amount: number }
}
const TOGETHER = [0, 1, 0, 1, 1.5]
const FIST: number[][] = [[0.45, 0.6, 0.55], [1.45, 1.6, 0.9], [1.5, 1.6, 0.9], [1.5, 1.6, 0.9], [1.5, 1.6, 0.9]]
const HAND_SHAPES: Record<'relaxed' | HandMorph, HandShape> = {
  // the fingers curl a little more from the index to the little finger, and the thumb less
  // (the thumb rests beside the index finger's last joint)
  relaxed: { curl: [[0.1, 0.2, 0.2], [0.2, 0.3, 0.15], [0.25, 0.35, 0.2], [0.3, 0.4, 0.2], [0.35, 0.45, 0.25]], close: TOGETHER, thumb: { to: 'finger2-3', amount: 0.7 } },
  'hand-open': { curl: [[0, 0.05, 0.05], [0.04, 0.06, 0.04], [0.04, 0.06, 0.04], [0.05, 0.07, 0.05], [0.06, 0.08, 0.05]], close: TOGETHER, thumb: { to: 'finger2-3', amount: 0 } },
  // (a fist's thumb crosses the middle finger)
  'hand-fist': { curl: FIST, close: TOGETHER, thumb: { to: 'finger3-2', amount: 1 } },
  'hand-point': { curl: [FIST[0], [0.05, 0.05, 0.05], ...FIST.slice(2)], close: [0, 0, 0, 1, 1.5], thumb: { to: 'finger3-2', amount: 1 } },
}

/**
 * MakeHuman's hands rest flat with the fingers straight and spread. Curl them into a hand shape, re-posing the mesh
 * with the fingers' own weights (the skinning has one bone per hand). Each phalanx turns about its base joint toward
 * the palm, carrying the ones beyond it.
 */
function relaxHands(P: Float64Array, { curl, close, thumb }: HandShape): void {
  const F = A.fingers
  // (joints are read on the right hand and mirrored: read them all before either hand moves)
  const P0 = P.slice()
  for (const sg of [1, -1]) {
    const J = (name: string): V3 => side(mean(P0, F.joints[name]), sg)
    const heads = F.bones.map((b) => J(b))
    const tip = (f: number): V3 => J(`${F.bones[3 * f + 2]}:tail`)
    // the palm faces the way the curled fingers go: across the knuckles, index to little finger, and down the hand
    const along = norm(sub(tip(2), heads[3 * 2]))
    const across = norm(sub(heads[3 * 1], heads[3 * 4]))
    const palm = norm(sg > 0 ? cross(along, across) : cross(across, along))
    // each phalanx's move: turn about its own joint, then about each joint nearer the hand
    const turns = F.bones.map((_, b) => {
      const f = Math.floor(b / 3), k = b % 3
      // (the thumb bends across the palm, toward the little finger)
      const toward = f === 0 ? norm(sub(palm, across)) : palm
      // (the fingers all bend about one axis across the knuckles, so they curl side by side)
      const axis = norm(cross(f === 0 ? norm(sub(tip(f), heads[3 * f])) : along, toward))
      const chain: Array<{ pivot: V3; r: { axis: V3; angle: number } }> = []
      for (let i = k; i >= 0; i--) chain.push({ pivot: heads[3 * f + i], r: { axis, angle: curl[f][i] } })
      // (and the fingers close up until they touch: each turns onto the middle finger's line at the knuckle, then a
      // little past it, so its tip comes closer by CLOSE of its knuckle's offset; the knuckles sit wider apart than
      // the fingers are thick)
      if (f > 0 && f !== 2) {
        const fd = sub(tip(f), heads[3 * f])
        const spread = Math.atan2(dot(cross(along, norm(fd)), palm), dot(along, norm(fd)))
        const offset = dot(sub(heads[3 * f], heads[3 * 2]), cross(palm, along))
        chain.push({ pivot: heads[3 * f], r: { axis: palm, angle: -spread - Math.atan((close[f] * offset) / len(fd)) } })
      }
      return chain
    })
    // the thumb swings at its base to aim its (bent) tip at a joint of the curled fingers
    if (thumb.amount > 0) {
      const move = (p: V3, b: number): V3 => turns[b].reduce((q, t) => spin(q, t.pivot, t.r), p)
      // (a joint moves with the phalanx before it)
      const jb = F.bones.indexOf(thumb.to)
      const target = move(J(thumb.to), jb - 1)
      const bent = move(tip(0), 2)
      const r = rotationOnto(norm(sub(bent, heads[0])), norm(sub(target, heads[0])))
      for (const b of [0, 1, 2]) turns[b].push({ pivot: heads[0], r: { axis: r.axis, angle: r.angle * thumb.amount } })
    }
    for (const [key, list] of Object.entries(F.weights)) {
      const v = +key
      if (P[3 * v] * sg <= 0) continue
      const p: V3 = [P[3 * v], P[3 * v + 1], P[3 * v + 2]]
      const d: V3 = [0, 0, 0]
      for (let i = 0; i < list.length; i += 2) {
        let q = p
        for (const t of turns[list[i]]) q = spin(q, t.pivot, t.r)
        const w = list[i + 1]
        d[0] += (q[0] - p[0]) * w; d[1] += (q[1] - p[1]) * w; d[2] += (q[2] - p[2]) * w
      }
      P[3 * v] += d[0]; P[3 * v + 1] += d[1]; P[3 * v + 2] += d[2]
    }
  }
}

/** Each body vertex's neighbours in the mesh (the topology never changes, so this is worked out once). */
let NEIGHBOURS: Int32Array[] | null = null
function neighbours(): Int32Array[] {
  if (NEIGHBOURS) return NEIGHBOURS
  const n = A.positions.length / 3
  const lists: number[][] = Array.from({ length: n }, () => [])
  for (let t = 0; t < A.tris.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = A.tris[t + k], b = A.tris[t + ((k + 1) % 3)]
      if (!lists[a].includes(b)) lists[a].push(b)
      if (!lists[b].includes(a)) lists[b].push(a)
    }
  }
  NEIGHBOURS = lists.map((l) => Int32Array.from(l))
  return NEIGHBOURS
}

/**
 * How the chest is eased for clothes: its reach spreads over this many mesh steps (fabric spans a hollow rather
 * than dipping into it), then is blurred this many passes to take the edges off. MakeHuman's clothes helper cage
 * has no triangles of its own, so it takes a smooth average of the skin around it: garments bind to either, and a
 * few to both, and a triangle with one bind point moved and another left behind tears open.
 */
const CHEST_BRIDGE = 8
const CHEST_SMOOTHING = 20
const CAGE_REACH = 0.04

/**
 * The body garments are fitted to: this body with the chest's curve eased.
 *
 * MakeHuman garments bind each of their vertices to body vertices, so a thin one fitted to the skin is a displaced
 * copy of it and reproduces every curve, including the crease between the breasts — a cycling suit ends up
 * shrink-wrapped. MakeHuman's own garments avoid this by binding to its clothes helper cage, which has no such
 * crease. This gives every garment the same: each vertex is pushed out along the body's own outward normal until
 * it reaches as far as the fullest part of the chest near it, so the hollow fills, the chest keeps its size, and
 * the garment never ends up inside the skin. The normal is what keeps it coherent — pushing each vertex along its
 * own share of the chest's displacement sends neighbours either side of the breastbone in opposite directions and
 * tears the garment down the middle.
 */
function clothingBody(P: Float64Array, spec: AvatarSpec): Float64Array {
  const n = A.positions.length / 3
  // the chest's contribution on its own: targets add to whatever they are given, so the difference between the
  // body's targets with and without it is exactly that
  const withChest = new Float64Array(3 * n)
  const without = new Float64Array(3 * n)
  try {
    applyTargets(withChest, spec.macros, spec.modifiers)
    applyTargets(without, { ...spec.macros, BreastSize: 0 }, spec.modifiers)
  } catch {
    // (a caller that preloaded only its own targets: the garments hug the chest, as they did before)
    return P
  }
  const nb = neighbours()
  // the body's own outward normal, which every vertex is measured and pushed along
  const normal = new Float64Array(3 * n)
  for (let t = 0; t < A.tris.length; t += 3) {
    const a = 3 * A.tris[t], b = 3 * A.tris[t + 1], c = 3 * A.tris[t + 2]
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2]
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    for (const at of [a, b, c]) { normal[at] += nx; normal[at + 1] += ny; normal[at + 2] += nz }
  }
  for (let v = 0; v < n; v++) {
    const i = 3 * v
    const l = Math.hypot(normal[i], normal[i + 1], normal[i + 2])
    if (l) for (let k = 0; k < 3; k++) normal[i + k] /= l
  }
  // How far the chest stands out, measured along that normal — not how far the vertex travelled. A vertex under
  // the breast moves a long way without standing out at all, and equalising travel would float the fabric off
  // the front of the chest.
  const mag = new Float64Array(n)
  let most = 0
  for (let v = 0; v < n; v++) {
    const i = 3 * v
    const h = (withChest[i] - without[i]) * normal[i] + (withChest[i + 1] - without[i + 1]) * normal[i + 1]
      + (withChest[i + 2] - without[i + 2]) * normal[i + 2]
    mag[v] = Math.max(0, h)
    most = Math.max(most, mag[v])
  }
  if (most < 0.005) return P
  // the skin around the chest, as far as the spreading and blurring can reach
  const active: number[] = []
  {
    const seen = new Uint8Array(n)
    let front: number[] = []
    for (let v = 0; v < n; v++) if (mag[v] > 0 && nb[v].length) { seen[v] = 1; front.push(v); active.push(v) }
    for (let ring = 0; ring < CHEST_BRIDGE + CHEST_SMOOTHING && front.length; ring++) {
      const nextRing: number[] = []
      for (const v of front) for (const u of nb[v]) if (!seen[u]) { seen[u] = 1; nextRing.push(u); active.push(u) }
      front = nextRing
    }
  }
  if (!active.length) return P
  // Close the hollows: take the highest of each neighbourhood, then the lowest of that. Spreading alone lifts
  // everything near a full part of the chest; going back down again leaves the peaks and the flat where they were
  // and keeps only what filled a dip — which is what fabric does across the breastbone.
  let cur = Float64Array.from(mag), next = Float64Array.from(mag)
  for (let pass = 0; pass < CHEST_BRIDGE; pass++) {
    for (const v of active) {
      let best = cur[v]
      for (const u of nb[v]) if (cur[u] > best) best = cur[u]
      next[v] = best
    }
    cur.set(next)
  }
  for (let pass = 0; pass < CHEST_BRIDGE; pass++) {
    for (const v of active) {
      let least = cur[v]
      for (const u of nb[v]) if (cur[u] < least) least = cur[u]
      next[v] = least
    }
    cur.set(next)
  }
  for (let pass = 0; pass < CHEST_SMOOTHING; pass++) {
    for (const v of active) {
      const list = nb[v]
      let sum = cur[v]
      for (const u of list) sum += cur[u]
      next[v] = sum / (list.length + 1)
    }
    const swap = cur; cur = next; next = swap
  }
  // the helper cage: a smooth average of the skin near it, so it moves with the skin rather than against it
  const cell = CAGE_REACH
  const grid = new Map<string, number[]>()
  const key = (v: number): string =>
    `${Math.floor(P[3 * v] / cell)},${Math.floor(P[3 * v + 1] / cell)},${Math.floor(P[3 * v + 2] / cell)}`
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (const v of active) {
    const k = key(v)
    const at = grid.get(k)
    if (at) at.push(v)
    else grid.set(k, [v])
    for (let k2 = 0; k2 < 3; k2++) { lo[k2] = Math.min(lo[k2], P[3 * v + k2]); hi[k2] = Math.max(hi[k2], P[3 * v + k2]) }
  }
  const cage: number[] = []
  for (let v = 0; v < n; v++) {
    if (nb[v].length) continue
    const i = 3 * v
    if (P[i] < lo[0] - cell || P[i] > hi[0] + cell) continue
    if (P[i + 1] < lo[1] - cell || P[i + 1] > hi[1] + cell) continue
    if (P[i + 2] < lo[2] - cell || P[i + 2] > hi[2] + cell) continue
    const cx = Math.floor(P[i] / cell), cy = Math.floor(P[i + 1] / cell), cz = Math.floor(P[i + 2] / cell)
    let sum = 0, weight = 0
    const nrm = [0, 0, 0]
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (let z = cz - 1; z <= cz + 1; z++) {
      for (const u of grid.get(`${x},${y},${z}`) ?? []) {
        const d = Math.hypot(P[3 * u] - P[i], P[3 * u + 1] - P[i + 1], P[3 * u + 2] - P[i + 2])
        if (d > CAGE_REACH) continue
        const w = 1 - d / CAGE_REACH
        sum += cur[u] * w
        weight += w
        for (let k = 0; k < 3; k++) nrm[k] += normal[3 * u + k] * w
      }
    }
    if (!weight) continue
    cur[v] = sum / weight
    const l = Math.hypot(nrm[0], nrm[1], nrm[2])
    if (!l) continue
    for (let k = 0; k < 3; k++) normal[i + k] = nrm[k] / l
    // how far the chest already stands out here, along that borrowed normal: without this the cage would be
    // pushed out by the chest's whole height on top of the chest it already has, and a garment fitted to it
    // (the cami, and a hundred others) would balloon
    mag[v] = Math.max(0, (withChest[i] - without[i]) * normal[i] + (withChest[i + 1] - without[i + 1]) * normal[i + 1]
      + (withChest[i + 2] - without[i + 2]) * normal[i + 2])
    cage.push(v)
  }
  // never less than the chest's own reach: that would put the garment inside the skin
  const out = Float64Array.from(P)
  for (const v of active.concat(cage)) {
    const extra = cur[v] - mag[v]
    if (extra <= 0) continue
    for (let k = 0; k < 3; k++) out[3 * v + k] += normal[3 * v + k] * extra
  }
  return out
}

function mean(P: Float64Array, ids: number[]): V3 {
  const c: V3 = [0, 0, 0]
  for (const i of ids) { c[0] += P[3 * i]; c[1] += P[3 * i + 1]; c[2] += P[3 * i + 2] }
  return [c[0] / ids.length, c[1] / ids.length, c[2] / ids.length]
}

/** Axis and angle turning direction a onto b. */
function rotationOnto(a: V3, b: V3): { axis: V3; angle: number } {
  const c = cross(a, b)
  const s = len(c)
  return { axis: s > 1e-9 ? [c[0] / s, c[1] / s, c[2] / s] : [1, 0, 0], angle: Math.atan2(s, dot(a, b)) }
}
const spin = (p: V3, pivot: V3, r: { axis: V3; angle: number }): V3 => {
  const q = rotate(sub(p, pivot), r.axis, r.angle)
  return [q[0] + pivot[0], q[1] + pivot[1], q[2] + pivot[2]]
}
const blend = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
/** The right side's point, or its mirror image on the left. */
const side = (p: V3, sg: number): V3 => (sg > 0 ? p : mirror(p))
/** The mirror image of a rotation (its axis mirrored, the turn reversed). */
const sideRot = (r: { axis: V3; angle: number }, sg: number): { axis: V3; angle: number } =>
  sg > 0 ? r : { axis: [r.axis[0], -r.axis[1], -r.axis[2]], angle: r.angle }

function vertexNormals(P: Float32Array, I: Uint32Array): Float32Array {
  const Nn = new Float32Array(P.length)
  for (let t = 0; t < I.length; t += 3) {
    const a = 3 * I[t], b = 3 * I[t + 1], c = 3 * I[t + 2]
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2]
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    for (const i of [a, b, c]) { Nn[i] += nx; Nn[i + 1] += ny; Nn[i + 2] += nz }
  }
  for (let i = 0; i < Nn.length; i += 3) {
    const l = Math.hypot(Nn[i], Nn[i + 1], Nn[i + 2]) || 1
    Nn[i] /= l; Nn[i + 1] /= l; Nn[i + 2] /= l
  }
  return Nn
}
