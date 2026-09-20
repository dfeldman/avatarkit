/**
 * The avatar spec, in MakeHuman's terms: its macro variables and named modifiers for the body and face, and
 * MakeHuman assets (by id, see public/mh/index.json) for the hair, eyebrows, eyelashes, eyes and clothes. It is plain
 * JSON: it lives in the player's profile and travels between games.
 */
import { MACRO_DEFAULTS, MACROS, type Macro, type Macros } from './body/mhmodifiers.ts'

export { MACROS, MACRO_DEFAULTS, type Macro, type Macros }
export const SPEC_VERSION = 2

export interface Worn {
  /** a MakeHuman clothes asset id (garments and shoes) */
  id: string
  /** multiplies the garment's texture (most are authored white or grey to take a colour) */
  color?: string
}

/** The skin: its colour, and its complexion and surface (all 0..1; changing them never rebuilds the body). */
export interface SkinSpec {
  color: string
  /** warmth where blood shows through: nose, cheeks, ears, chin */
  redness: number
  /** uneven tone, 0 = perfectly even */
  blotchiness: number
  /** a blue-grey shadow on the jaw and upper lip */
  beard: number
  /** how strongly pores, stubble and fine lines show */
  pores: number
  /** how much of the photograph's own freckles, creases and shading to keep (1 = as photographed) */
  photo?: number
  /** matte 0 .. dewy 1 */
  shine: number
  /** the detail photograph (a MakeHuman skin id: freckled, older, bronzed, …); null = MakeHuman's own young skin
   *  nearest the colour. Either way it is recoloured to `color`. */
  texture: string | null
}

export interface AvatarSpec {
  v: typeof SPEC_VERSION
  /** MakeHuman's macro variables, 0..1 (Age: adults only, 0.5 = 25 years to 1 = 90) */
  macros: Macros
  /** MakeHuman modifiers by name, e.g. 'nose/nose-scale-vert-decr|incr' (-1..1) or 'buttocks/buttocks-volume-decr|incr' */
  modifiers: Record<string, number>
  skin: SkinSpec
  /** a MakeHuman eye material (brown, blue, green, …) */
  eyes: string
  /** MakeHuman hair, eyebrow and eyelash ids (null = none); hair and brows are tinted by color */
  hair: { id: string | null; color: string }
  eyebrows: string | null
  eyelashes: string | null
  /** garments and shoes, in wearing order */
  clothes: Worn[]
}

export const SKIN_TONES = [
  '#ffe3d3', '#fdd3bb', '#f3c3a2', '#e9b08b', '#dc9c70', '#c98657',
  '#b06f43', '#935933', '#784528', '#5e341e', '#472616', '#331b10',
] as const
export const HAIR_COLORS = [
  '#16110e', '#2e1f17', '#4b3122', '#704628', '#94421f', '#c05a24', '#d8a346', '#ecd394',
  '#f3ead2', '#8e8b88', '#e9e7e4', '#e2508a', '#3f7fe3', '#2fb27e', '#8b55db', '#e23e3e',
] as const
export const OUTFIT_COLORS = [
  '#1f6bff', '#22c7ee', '#14b8a6', '#12a874', '#7ac81a', '#ffd42a', '#f59e0b', '#e8690c',
  '#e03131', '#e5157f', '#f472b6', '#7c3aed', '#0d1233', '#263066', '#1f2937', '#6b7280',
  '#d0d4e0', '#ffffff', '#111111', '#8b5a2b',
] as const

export const EYE_MATERIALS = ['brown', 'brownlight', 'blue', 'lightblue', 'deepblue', 'bluegreen', 'green', 'grey', 'ice'] as const

export const DEFAULT_SPEC: AvatarSpec = {
  v: SPEC_VERSION,
  macros: { ...MACRO_DEFAULTS },
  modifiers: {},
  skin: { color: '#e9b08b', redness: 0.5, blotchiness: 0.5, beard: 0, pores: 0.5, shine: 0.5, texture: null },
  eyes: 'brown',
  hair: { id: 'short02', color: '#4b3122' },
  eyebrows: 'eyebrow001',
  eyelashes: 'eyelashes01',
  clothes: [{ id: 'elvs_crude_t-shirt_male', color: '#1f6bff' }, { id: 'mindfront_male_swimming_trunks_01', color: '#263066' }, { id: 'punkduck_running_shoes_01' }],
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
const unit = (v: unknown, dflt: number): number => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? clamp01(n) : dflt
}
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const id = (v: unknown, dflt: string | null): string | null =>
  v === null ? null : typeof v === 'string' && /^[\w.-]{1,80}$/.test(v) ? v : dflt

export function normalizeColor(v: unknown, dflt: string): string {
  if (typeof v !== 'string') return dflt
  let s = v.trim().toLowerCase()
  if (s.startsWith('#')) s = s.slice(1)
  if (/^[0-9a-f]{3}$/.test(s)) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2]
  return /^[0-9a-f]{6}$/.test(s) ? `#${s}` : dflt
}

/** Any JSON to a valid spec: unknown fields dropped, numbers clamped, missing values defaulted. */
export function normalizeSpec(input?: unknown): AvatarSpec {
  const src = obj(input), D = DEFAULT_SPEC
  const m = obj(src.macros), mods = obj(src.modifiers), hair = obj(src.hair), skin = obj(src.skin)
  const macros = { ...D.macros }
  for (const k of MACROS) {
    const v = typeof m[k] === 'string' ? Number(m[k]) : m[k]
    if (typeof v === 'number' && Number.isFinite(v)) macros[k] = clamp01(v)
  }
  // adults: MakeHuman's 25 (0.5) to 90 (1); younger would need its child targets
  macros.Age = Math.max(0.5, macros.Age)
  const modifiers: Record<string, number> = {}
  for (const [k, v] of Object.entries(mods)) {
    if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) > 1e-4 && /^[\w-]+\/[\w|-]+$/.test(k)) modifiers[k] = Math.max(-1, Math.min(1, v))
  }
  const clothes: Worn[] = []
  for (const c of Array.isArray(src.clothes) ? src.clothes.slice(0, 12) : D.clothes) {
    const w = typeof c === 'string' ? { id: c } : obj(c)
    const cid = id(w.id, null)
    if (!cid || clothes.some((x) => x.id === cid)) continue
    clothes.push(w.color === undefined ? { id: cid } : { id: cid, color: normalizeColor(w.color, '#ffffff') })
  }
  return {
    v: SPEC_VERSION,
    macros,
    modifiers,
    skin: {
      color: normalizeColor(skin.color, D.skin.color),
      redness: unit(skin.redness, D.skin.redness), blotchiness: unit(skin.blotchiness, D.skin.blotchiness),
      beard: unit(skin.beard, D.skin.beard), pores: unit(skin.pores, D.skin.pores), shine: unit(skin.shine, D.skin.shine),
      texture: id(skin.texture, null),
      // (temporary; see SkinSpec. Absent unless set, so specs and codes are unchanged for everyone else)
      ...(skin.photo === undefined ? {} : { photo: unit(skin.photo, 1) }),
    },
    eyes: (EYE_MATERIALS as readonly string[]).includes(src.eyes as string) ? (src.eyes as string) : D.eyes,
    hair: { id: 'id' in hair ? id(hair.id, D.hair.id) : D.hair.id, color: normalizeColor(hair.color, D.hair.color) },
    eyebrows: 'eyebrows' in src ? id(src.eyebrows, D.eyebrows) : D.eyebrows,
    eyelashes: 'eyelashes' in src ? id(src.eyelashes, D.eyelashes) : D.eyelashes,
    clothes: Array.isArray(src.clothes) ? clothes : D.clothes.map((c) => ({ ...c })),
  }
}

export function cloneSpec(s: AvatarSpec): AvatarSpec {
  return normalizeSpec(JSON.parse(JSON.stringify(s)))
}

/** Everything that changes the meshes (not colours): the same key means the same geometry. */
export function shapeKey(s: AvatarSpec): string {
  const r = (x: number): string => x.toFixed(3)
  return JSON.stringify([
    MACROS.map((k) => r(s.macros[k])),
    Object.keys(s.modifiers).sort().map((k) => `${k}=${r(s.modifiers[k])}`),
    s.hair.id, s.eyebrows, s.eyelashes, s.clothes.map((c) => c.id),
  ])
}

// ---------------------------------------------------------------------------------------------------------------
// Avatar codes: a copyable string for sharing a look. Only what differs from the defaults goes in.

// (node has no atob/btoa in older versions: its Buffer through globalThis, so this browser library needs no node types)
type NodeBuffer = { from(s: string, enc: string): { toString(enc: string): string } }
const nodeBuffer = (): NodeBuffer => (globalThis as { Buffer?: NodeBuffer }).Buffer!

export function encodeSpec(spec: AvatarSpec): string {
  const s = normalizeSpec(spec), D = DEFAULT_SPEC
  const out: Record<string, unknown> = {}
  const macros = Object.fromEntries(MACROS.filter((k) => Math.abs(s.macros[k] - D.macros[k]) > 1e-3).map((k) => [k, +s.macros[k].toFixed(3)]))
  if (Object.keys(macros).length) out.macros = macros
  if (Object.keys(s.modifiers).length) out.modifiers = Object.fromEntries(Object.entries(s.modifiers).map(([k, v]) => [k, +v.toFixed(3)]))
  for (const k of ['skin', 'eyes', 'hair', 'eyebrows', 'eyelashes', 'clothes'] as const) {
    if (JSON.stringify(s[k]) !== JSON.stringify(D[k])) out[k] = s[k]
  }
  const json = JSON.stringify(out)
  const b64 = typeof btoa === 'function' ? btoa(json) : nodeBuffer().from(json, 'utf8').toString('base64')
  return `AV${SPEC_VERSION}-${b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}

/** Returns null for anything that isn't a valid code. */
export function decodeSpec(code: string): AvatarSpec | null {
  const m = /^AV(\d+)-([A-Za-z0-9_-]+)$/.exec(code.trim())
  if (!m || Number(m[1]) !== SPEC_VERSION) return null
  try {
    const b64 = m[2].replace(/-/g, '+').replace(/_/g, '/')
    const json = typeof atob === 'function' ? atob(b64) : nodeBuffer().from(b64, 'base64').toString('utf8')
    return normalizeSpec(JSON.parse(json))
  } catch {
    return null
  }
}
