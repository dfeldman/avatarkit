/**
 * Named starting points for the designer, and a seeded generator for crowds, rivals and the dice button — all in
 * MakeHuman's terms (macro variables, modifiers, asset ids).
 */
import { DEFAULT_SPEC, EYE_MATERIALS, HAIR_COLORS, MACRO_DEFAULTS, OUTFIT_COLORS, SKIN_TONES, normalizeSpec, type AvatarSpec, type Macros } from './spec.ts'

export type Rng = () => number

/** mulberry32: small, fast, good enough for looks. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface PresetInput extends Partial<Omit<AvatarSpec, 'macros' | 'hair' | 'skin'>> {
  macros?: Partial<Macros>
  hair?: Partial<AvatarSpec['hair']>
  skin?: Partial<AvatarSpec['skin']>
}
function preset(p: PresetInput): AvatarSpec {
  const d = DEFAULT_SPEC
  return normalizeSpec({ ...d, ...p, macros: { ...d.macros, ...p.macros }, hair: { ...d.hair, ...p.hair }, skin: { ...d.skin, ...p.skin } })
}

export interface Preset { id: string; name: string; spec: AvatarSpec }

const RUN = 'punkduck_running_shoes_01'
export const PRESETS: readonly Preset[] = [
  { id: 'sam', name: 'Sam', spec: preset({}) },
  {
    id: 'runner', name: 'Runner',
    spec: preset({
      macros: { Gender: 0.1, Muscle: 0.62, Weight: 0.35, Height: 0.52, BodyProportions: 0.7, BreastSize: 0.4 },
      skin: { color: '#c98657' }, eyes: 'brown', hair: { id: 'ponytail01', color: '#16110e' }, eyelashes: 'eyelashes02',
      clothes: [{ id: 'elvs_lara_tank1', color: '#f59e0b' }, { id: 'punkduck_female_short_jeans', color: '#14b8a6' }, { id: RUN }],
    }),
  },
  {
    id: 'powerhouse', name: 'Powerhouse',
    spec: preset({
      macros: { Gender: 1, Muscle: 1, Weight: 0.65, Height: 0.55, BodyProportions: 0.7 },
      skin: { color: '#935933', beard: 0.6 }, hair: { id: 'short04', color: '#16110e' }, eyebrows: 'eyebrow009',
      clothes: [{ id: 'mindfront_tank_top_01', color: '#e03131' }, { id: 'mindfront_male_swimming_trunks_01', color: '#222222' }, { id: RUN }],
    }),
  },
  {
    id: 'curvy', name: 'Curvy',
    spec: preset({
      macros: { Gender: 0, Muscle: 0.4, Weight: 0.7, Height: 0.45, BreastSize: 0.8 },
      modifiers: { 'hip/hip-scale-horiz-decr|incr': 0.4, 'buttocks/buttocks-volume-decr|incr': 0.4 },
      skin: { color: '#f3c3a2', texture: 'toigo_light_skin_female_freckles' }, eyes: 'green', hair: { id: 'bob01', color: '#94421f' }, eyelashes: 'eyelashes02',
      clothes: [{ id: 'female_sportsuit01' }, { id: 'punkduck_tennis_shoes' }],
    }),
  },
  {
    id: 'lanky', name: 'Tall & Lanky',
    spec: preset({
      macros: { Gender: 0.85, Muscle: 0.4, Weight: 0.2, Height: 0.72, BodyProportions: 0.8 },
      skin: { color: '#5e341e', beard: 0.35 }, hair: { id: 'afro01', color: '#16110e' },
      clothes: [{ id: 'elvs_crude_t-shirt_male', color: '#14b8a6' }, { id: 'mindfront_male_swimming_trunks_03', color: '#263066' }, { id: 'shoes06' }],
    }),
  },
  {
    id: 'petite', name: 'Petite',
    spec: preset({
      macros: { Gender: 0.15, Muscle: 0.35, Weight: 0.45, Height: 0.28 },
      skin: { color: '#fdd3bb' }, eyes: 'blue', hair: { id: 'braid01', color: '#d8a346' }, eyelashes: 'eyelashes02',
      clothes: [{ id: 'punkduck_v_neck_top', color: '#ffd42a' }, { id: 'cortu_jeans_shorts', color: '#1f6bff' }, { id: 'punkduck_tennis_shoes' }],
    }),
  },
  {
    id: 'comfy', name: 'Big & Comfy',
    spec: preset({
      macros: { Gender: 0.9, Muscle: 0.35, Weight: 0.95, Height: 0.52 },
      skin: { color: '#dc9c70', beard: 0.5 }, hair: { id: 'short01', color: '#704628' },
      clothes: [{ id: 'elvs_male_logo_tshirt1', color: '#12a874' }, { id: 'cortu_cargo_pants', color: '#6b7280' }, { id: 'shoes05' }],
    }),
  },
  {
    id: 'cyclist', name: 'Cyclist',
    spec: preset({
      macros: { Gender: 0.85, Muscle: 0.65, Weight: 0.25, Height: 0.52, BodyProportions: 0.75 },
      skin: { color: '#ffe3d3', beard: 0.3, texture: 'toigo_light_skin_male_ginger' }, eyes: 'bluegreen', hair: { id: 'short03', color: '#c05a24' },
      clothes: [{ id: 'elvs_crude_t-shirt_male', color: '#ffd42a' }, { id: 'mindfront_male_swimming_trunks_01', color: '#111111' }, { id: 'punkduck_cycling_shoes' }],
    }),
  },
  {
    id: 'silver', name: 'Silver Fox',
    spec: preset({
      macros: { Gender: 0.9, Muscle: 0.4, Weight: 0.55, Height: 0.5 },
      skin: { color: '#f3c3a2', beard: 0.55, texture: 'onlytheghosts_old_eurasian_male' }, eyes: 'lightblue', hair: { id: 'short02', color: '#e9e7e4' }, eyebrows: 'eyebrow006',
      clothes: [{ id: 'namuhekam_male_polo_shirt', color: '#263066' }, { id: 'cortu_cargo_pants', color: '#a39070' }, { id: 'shoes01' }],
    }),
  },
  {
    id: 'sunny', name: 'Sunny',
    spec: preset({
      macros: { Gender: 0.05, Muscle: 0.45, Weight: 0.5, Height: 0.42, BreastSize: 0.65 },
      skin: { color: '#784528' }, eyes: 'brownlight', hair: { id: 'long01', color: '#2e1f17' }, eyelashes: 'eyelashes02',
      clothes: [{ id: 'punkduck_sleeveless_crop_top', color: '#e5157f' }, { id: 'punkduck_female_short_jeans', color: '#0d1233' }, { id: RUN }],
    }),
  },
]

const pickOf = <T>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length) % arr.length]
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))
const gauss = (rng: Rng): number => {
  const u = Math.max(1e-9, rng()), v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** community skin photographs random avatars may use (tools/skins.tsv ships these; tests check they exist) */
export const SKIN_DETAILS = {
  female: ['callharvey3d_midtoned_female', 'nyloseth_zoeyskin', 'onlytheghosts_young_eurasian_female', 'skalldyrssuppe_creamy_female',
    'toigo_light_skin_female_bronze', 'toigo_light_skin_female_freckles', 'toigo_light_skin_female_ginger', 'cutoff3d_indian_female_skin'],
  male: ['jartur69_middleage_slavic_male_with_genitals_and_beard', 'mindfront_aksel_skin', 'mindfront_skin_male_african_middleage',
    'toigo_light_skin_male_bronze', 'toigo_light_skin_male_freckles', 'toigo_light_skin_male_ginger'],
}

const WARDROBE = {
  topsF: ['joepal_crude_t-shirt_female', 'elvs_lara_tank1', 'punkduck_sleeveless_crop_top', 'punkduck_v_neck_top', 'punkduck_high_neck_crop_top', 'punkduck_spaghetti_strap_tank_top', 'mindfront_tank_top_01'],
  topsM: ['elvs_crude_t-shirt_male', 'elvs_male_logo_tshirt1', 'mindfront_tank_top_01', 'namuhekam_male_polo_shirt'],
  bottomsF: ['punkduck_female_short_jeans', 'cortu_jeans_shorts'],
  bottomsM: ['elvs_male_swim_shorts1', 'mindfront_male_swimming_trunks_01', 'mindfront_male_swimming_trunks_03', 'cortu_cargo_pants', 'cortu_jeans_shorts'],
  shoes: [RUN, 'punkduck_cycling_shoes', 'punkduck_tennis_shoes', 'culturalibre_sneakers', 'shoes05', 'shoes06'],
  hairF: ['ponytail01', 'bob01', 'bob02', 'long01', 'braid01', 'short03', 'afro01'],
  hairM: ['short01', 'short02', 'short03', 'short04', 'afro01', null],
}

/**
 * What you would wear to do this: the shortlist the designer offers before the whole wardrobe. Held here
 * rather than derived from the top of each slot, because tools/wardrobe.tsv runs sport, then swimwear, then
 * street clothes — the top of "bottoms" is three kinds of swim trunks. Ids are checked against wardrobe.tsv
 * by the kit's tests, so this cannot quietly drift away from what is actually shipped.
 */
export const EXERCISE_KIT: readonly string[] = [
  // tops
  'punkduck_sport_bra', 'mindfront_tank_top_01', 'punkduck_sleeveless_crop_top', 'elvs_lara_tank1', 'joepal_crude_t-shirt_female',
  // bottoms
  'punkduck_sport_briefs', 'elvs_male_swim_shorts1', 'punkduck_female_short_jeans',
  // whole kits
  'culturalibre_male_sport_suit', 'female_sportsuit01',
  // shoes and socks
  'punkduck_running_shoes_01', 'punkduck_cycling_shoes', 'shoes06', 'joepal_crude_low_socks',
]

/** A plausible, varied avatar (every value, ethnicity included, drawn independently: nothing is inferred). */
export function randomSpec(seed: number): AvatarSpec {
  const rng = makeRng(seed)
  const around = (mean: number, sd: number): number => clamp01(mean + gauss(rng) * sd)
  const fem = rng() < 0.5
  const eth = [rng() + 0.2, rng() + 0.2, rng() + 0.2]
  const sum = eth[0] + eth[1] + eth[2]
  const macros: Macros = {
    ...MACRO_DEFAULTS,
    Gender: fem ? around(0.08, 0.08) : around(0.92, 0.08),
    Muscle: around(0.5, 0.15), Weight: clamp01(0.3 + Math.pow(rng(), 1.5) * 0.65), Height: around(0.5, 0.14),
    BodyProportions: around(0.55, 0.15), BreastSize: fem ? around(0.5, 0.18) : 0.5,
    African: eth[0] / sum, Asian: eth[1] / sum, Caucasian: eth[2] / sum,
  }
  const colors = OUTFIT_COLORS
  const clothes = [
    { id: pickOf(rng, fem ? WARDROBE.topsF : WARDROBE.topsM), color: pickOf(rng, colors) },
    { id: pickOf(rng, fem ? WARDROBE.bottomsF : WARDROBE.bottomsM), color: rng() < 0.55 ? pickOf(rng, ['#111111', '#1f2937', '#263066', '#6b7280']) : pickOf(rng, colors) },
    { id: pickOf(rng, WARDROBE.shoes) },
  ]
  return normalizeSpec({
    macros,
    skin: {
      color: pickOf(rng, SKIN_TONES), redness: around(0.5, 0.18), blotchiness: around(0.45, 0.2),
      beard: fem ? 0 : rng() < 0.6 ? around(0.45, 0.2) : 0, pores: around(0.5, 0.15), shine: around(0.45, 0.15),
      // a third get a community skin photograph (freckles, stubble, age) instead of the automatic one
      texture: rng() < 0.35 ? pickOf(rng, fem ? SKIN_DETAILS.female : SKIN_DETAILS.male) : null,
    },
    eyes: pickOf(rng, EYE_MATERIALS),
    hair: { id: pickOf(rng, fem ? WARDROBE.hairF : WARDROBE.hairM), color: rng() < 0.9 ? pickOf(rng, HAIR_COLORS.slice(0, 11)) : pickOf(rng, HAIR_COLORS.slice(11)) },
    eyebrows: `eyebrow${String(1 + Math.floor(rng() * 12)).padStart(3, '0')}`,
    eyelashes: fem ? 'eyelashes02' : 'eyelashes01',
    clothes,
  })
}

/**
 * BEACHWEAR (Street Runner's Ocean Beach, 2026-10-06; the owner: "swimwear is different from athletic wear. no one is
 * offended by people wearing swimming attire on a beach. it just wasn't appropriate for running"). The bikinis and
 * swimsuits stay off the designer's list (mhassets.ts WITHDRAWN) and out of the street crowds; a beach scene dresses
 * its people from here by id. Outfits are [garment, garment?]: a swimsuit or a bikini set is one garment, a bikini in
 * two parts is two; men in trunks or board shorts, bare-chested more often than not, a tank or a tee on some.
 * Barefoot: no shoes on the sand.
 */
export const BEACH_WARDROBE: { female: readonly (readonly string[])[]; male: readonly (readonly string[])[] } = {
  female: [
    ['mindfront_f_one-piece_swimsuit_01'], ['punkduck_one_piece_bikini01'], ['mindfront_bikini_01'],
    ['punkduck_bandeau_bikini_bra', 'punkduck_bandeau_bikini_slip'],
    // and some who came to the beach dressed (Ocean Beach is cold more often than not)
    ['punkduck_spaghetti_strap_tank_top', 'punkduck_female_short_jeans'], ['joepal_crude_t-shirt_female', 'cortu_jeans_shorts'],
  ],
  male: [
    ['elvs_male_swim_shorts1'], ['mindfront_male_swimming_trunks_01'], ['mindfront_male_swimming_trunks_02'], ['mindfront_male_swimming_trunks_03'],
    ['mindfront_tank_top_01', 'elvs_male_swim_shorts1'], ['elvs_crude_t-shirt_male', 'mindfront_male_swimming_trunks_01'],
  ],
}

const BEACH_COLORS = ['#e03131', '#1f6bff', '#f59f00', '#12b886', '#e64980', '#111111', '#ffffff', '#7048e8', '#fd7e14', '#263066', '#0ca678', '#f8f0e3']

/** A random avatar in beachwear (`randomSpec`'s body and face; the clothes from BEACH_WARDROBE, barefoot). */
export function beachSpec(seed: number): AvatarSpec {
  const spec = randomSpec(seed)
  const rng = makeRng(seed ^ 0x5eaf00d)
  const fem = (spec.macros.Gender ?? 0.5) < 0.5
  const outfit = pickOf(rng, fem ? BEACH_WARDROBE.female : BEACH_WARDROBE.male)
  return normalizeSpec({ ...spec, clothes: outfit.map((id) => ({ id, color: pickOf(rng, BEACH_COLORS) })) })
}
