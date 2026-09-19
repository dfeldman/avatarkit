/**
 * Hand poses. The body is built with relaxed hands (fingers lightly curled and together); the others are morph
 * targets on it (src/body/mhbody.ts bakes them from MakeHuman's finger weights), so a game switches or blends them
 * at no cost: `avatar.setHands('fist')`.
 */
export const HAND_POSES = ['relaxed', 'open', 'fist', 'point'] as const
export type HandPose = (typeof HAND_POSES)[number]

/** The morph target each pose other than the rest one is stored as. */
export type HandMorph = `hand-${Exclude<HandPose, 'relaxed'>}`
export const HAND_MORPHS: HandMorph[] = ['hand-open', 'hand-fist', 'hand-point']
export const handMorph = (p: HandPose): HandMorph | null => (p === 'relaxed' ? null : `hand-${p}`)
