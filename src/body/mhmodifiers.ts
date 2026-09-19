/**
 * MakeHuman's modifiers (public/mh/modifiers.json, from tools/mkmhtargets.mjs), applied the way MakeHuman applies
 * them:
 * - macro variables (Gender, Age, the three ethnicities, Muscle, Weight, Height, BodyProportions, BreastSize,
 *   BreastFirmness; 0..1) weight the macro targets: a macro target's name lists the variables it depends on
 *   (`universal-female-young-maxmuscle-averageweight`), and its weight is the product of their values
 * - every other modifier moves one target (0..1) or a decr/incr pair (-1..1)
 * All targets are moves of the base mesh's vertices, so they simply add. Only targets with a non-zero weight are
 * loaded.
 */
import { readBytes, readJson } from './mhassets.ts'

export const MACROS = ['Gender', 'Age', 'African', 'Asian', 'Caucasian', 'Muscle', 'Weight', 'Height', 'BodyProportions', 'BreastSize', 'BreastFirmness'] as const
export type Macro = (typeof MACROS)[number]
export type Macros = Record<Macro, number>
/** MakeHuman's defaults: an average young adult of mixed ethnicity. */
export const MACRO_DEFAULTS: Macros = {
  Gender: 0.5, Age: 0.5, African: 1 / 3, Asian: 1 / 3, Caucasian: 1 / 3, Muscle: 0.5, Weight: 0.5, Height: 0.5,
  BodyProportions: 0.5, BreastSize: 0.5, BreastFirmness: 0.5,
}

export interface ModifierDef { name: string; group: string; min: number; max: number; targets: [string | null, string] }
export interface ModifierDefs {
  macros: Array<{ group: string; variable: Macro }>
  macroTargets: Array<{ target: string; parts: string[] }>
  modifiers: ModifierDef[]
  /** MakeHuman's slider layout (modeling_sliders.json), for designers */
  sliders: unknown
}

let defsP: Promise<ModifierDefs> | null = null
let defs: ModifierDefs | null = null
export function loadModifierDefs(): Promise<ModifierDefs> {
  return (defsP ??= readJson<ModifierDefs>('modifiers.json').then((d) => (defs = d)))
}
/** The definitions, once loaded. */
export function modifierDefs(): ModifierDefs {
  if (!defs) throw new Error('MakeHuman modifiers are not loaded (await loadModifierDefs())')
  return defs
}

/** MakeHuman's per-variable factors for the macro target name parts (human.py _set*Vals). */
export function macroFactors(m: Macros): Record<string, number> {
  const c = (x: number): number => Math.min(1, Math.max(0, x))
  const tri = (x: number, lo: string, mid: string, hi: string): Record<string, number> => {
    const up = Math.max(0, c(x) * 2 - 1), down = Math.max(0, 1 - c(x) * 2)
    return { [lo]: down, [mid]: 1 - up - down, [hi]: up }
  }
  const a = c(m.Age)
  let age: Record<string, number>
  if (a < 0.5) {
    const young = Math.max(0, (a - 0.1875) * 3.2)
    age = { baby: Math.max(0, 1 - a * 5.333), young, child: Math.max(0, Math.min(1, 5.333 * a) - young), old: 0 }
  } else {
    const old = Math.max(0, a * 2 - 1)
    age = { baby: 0, child: 0, young: 1 - old, old }
  }
  const eth = c(m.African) + c(m.Asian) + c(m.Caucasian)
  const e = (x: number): number => (eth > 1e-6 ? c(x) / eth : 1 / 3)
  return {
    female: 1 - c(m.Gender), male: c(m.Gender), ...age,
    ...tri(m.Muscle, 'minmuscle', 'averagemuscle', 'maxmuscle'),
    ...tri(m.Weight, 'minweight', 'averageweight', 'maxweight'),
    minheight: Math.max(0, 1 - c(m.Height) * 2), maxheight: Math.max(0, c(m.Height) * 2 - 1),
    uncommonproportions: Math.max(0, 1 - c(m.BodyProportions) * 2), idealproportions: Math.max(0, c(m.BodyProportions) * 2 - 1),
    ...tri(m.BreastSize, 'mincup', 'averagecup', 'maxcup'),
    ...tri(m.BreastFirmness, 'minfirmness', 'averagefirmness', 'maxfirmness'),
    african: e(m.African), asian: e(m.Asian), caucasian: e(m.Caucasian),
  }
}

/** Every target with a non-zero weight for these values. */
export function targetWeights(macros: Macros, mods: Record<string, number>, d: ModifierDefs = modifierDefs()): Map<string, number> {
  const out = new Map<string, number>()
  const f = macroFactors(macros)
  for (const { target, parts } of d.macroTargets) {
    let w = 1
    for (const p of parts) w *= f[p] ?? 0
    if (w > 1e-5) out.set(target, (out.get(target) ?? 0) + w)
  }
  const byName = new Map(d.modifiers.map((m) => [m.name, m]))
  for (const [name, raw] of Object.entries(mods)) {
    const m = byName.get(name)
    if (!m || !Number.isFinite(raw)) continue
    const v = Math.min(m.max, Math.max(m.min, raw))
    const [neg, pos] = m.targets
    if (v > 1e-5) out.set(pos, (out.get(pos) ?? 0) + v)
    else if (v < -1e-5 && neg) out.set(neg, (out.get(neg) ?? 0) - v)
  }
  return out
}

interface Packed { idx: Uint16Array; d: Int16Array; step: number }
const packed = new Map<string, Packed>()
const pending = new Map<string, Promise<Packed>>()
function loadTarget(t: string): Promise<Packed> {
  const have = packed.get(t)
  if (have) return Promise.resolve(have)
  let p = pending.get(t)
  if (!p) {
    p = readBytes(`targets/${t}.bin`).then((buf) => {
      const n = new Uint32Array(buf, 0, 1)[0]
      const step = new Float32Array(buf, 4, 1)[0]
      const pad = (n * 2 + 3) & ~3
      const px = { idx: new Uint16Array(buf, 8, n), d: new Int16Array(buf, 8 + pad, n * 3), step }
      packed.set(t, px)
      pending.delete(t)
      return px
    })
    pending.set(t, p)
  }
  return p
}

/** Loads the definitions and every target these values use. */
export async function preloadTargets(macros: Macros, mods: Record<string, number>): Promise<void> {
  const d = await loadModifierDefs()
  await Promise.all([...targetWeights(macros, mods, d).keys()].map(loadTarget))
}

/** Adds the targets' moves to the base mesh positions P (metres, every vertex). */
export function applyTargets(P: Float64Array, macros: Macros, mods: Record<string, number>): void {
  for (const [t, w] of targetWeights(macros, mods)) {
    const px = packed.get(t)
    if (!px) throw new Error(`MakeHuman target ${t} is not loaded`)
    const s = w * px.step
    for (let k = 0; k < px.idx.length; k++) {
      const v = 3 * px.idx[k]
      P[v] += s * px.d[3 * k]
      P[v + 1] += s * px.d[3 * k + 1]
      P[v + 2] += s * px.d[3 * k + 2]
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// facial expressions

/**
 * MakeHuman's facial expression units that basic expressions need (it has 34, per ancestry): each moves the face's
 * base vertices, and plays as a morph target (0..1). Left and right are the avatar's own.
 */
export const EXPRESSION_UNITS = [
  'eye-left-closure', 'eye-right-closure', 'eye-left-slit', 'eye-right-slit', 'eye-left-opened-up', 'eye-right-opened-up',
  'eyebrows-left-up', 'eyebrows-right-up', 'eyebrows-left-down', 'eyebrows-right-down', 'eyebrows-left-inner-up', 'eyebrows-right-inner-up',
  'mouth-open', 'mouth-corner-puller', 'mouth-depression', 'mouth-retraction', 'mouth-pursing', 'nose-left-elevation', 'nose-right-elevation',
] as const
export type ExpressionUnit = (typeof EXPRESSION_UNITS)[number]

const ANCESTRY = [['African', 'african'], ['Asian', 'asian'], ['Caucasian', 'caucasian']] as const
/** How much of each ancestry's expression units to blend (MakeHuman's ethnic macros, normalised). */
function ancestryWeights(m: Macros): Array<[string, number]> {
  const sum = m.African + m.Asian + m.Caucasian || 1
  return ANCESTRY.map(([k, dir]) => [dir, m[k] / sum] as [string, number]).filter(([, w]) => w > 1e-3)
}
const unitTarget = (unit: string, dir: string): string => `expression/units/${dir}/${unit}`

export async function preloadExpressions(macros: Macros): Promise<void> {
  await Promise.all(ancestryWeights(macros).flatMap(([dir]) => EXPRESSION_UNITS.map((u) => loadTarget(unitTarget(u, dir)))))
}

/** A unit's move of every base vertex (n × 3, metres), blended by ancestry; null if it moves nothing. */
export function expressionDeltas(unit: ExpressionUnit, macros: Macros, n: number): Float32Array | null {
  const out = new Float32Array(n * 3)
  let any = false
  for (const [dir, w] of ancestryWeights(macros)) {
    const px = packed.get(unitTarget(unit, dir))
    if (!px) throw new Error(`MakeHuman expression ${unit} (${dir}) is not loaded (await preloadAssets(spec) first)`)
    const s = w * px.step
    for (let k = 0; k < px.idx.length; k++) {
      const v = 3 * px.idx[k]
      out[v] += s * px.d[3 * k]; out[v + 1] += s * px.d[3 * k + 1]; out[v + 2] += s * px.d[3 * k + 2]
      any = true
    }
  }
  return any ? out : null
}
