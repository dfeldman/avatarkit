/**
 * @dandyhorse/avatarkit: MakeHuman avatars (body, face, hair, clothes) with procedural animation, for Dandyhorse games.
 *
 *   import { Avatar, setAssetBase } from '@dandyhorse/avatarkit'
 *   setAssetBase('https://…/mh/')                            // where public/mh/ is served (pages default to ./mh/)
 *   const avatar = await Avatar.create(scene, profile.avatar) // any JSON; missing fields get defaults
 *   avatar.root.position.copyFrom(playerPosition)
 *   avatar.setMotion({ mode: 'run', speed: 3.1 })           // or { mode: 'cycle', cadence: 85 }
 *   scene.onBeforeRenderObservable.add(() => avatar.update(engine.getDeltaTime() / 1000))
 *
 * The designer (DOM, no game needs it) is a separate entry: '@dandyhorse/avatarkit/designer'.
 */
export * from './spec.ts'
export { BEACH_WARDROBE, EXERCISE_KIT, PRESETS, beachSpec, makeRng, randomSpec, type Preset, type Rng } from './presets.ts'
export { Avatar, getGeometry, type AvatarOptions } from './render/avatar.ts'
export { GeometryService } from './render/geometryService.ts'
export { Bike, type BikeOptions } from './render/bike.ts'
export { Animator, type Motion, type MotionMode } from './anim/animator.ts'
export { loadClips, ClipRetarget, type Clip, type ClipSet } from './anim/clips.ts'
export { addLoungeClips, LOUNGE_CLIPS } from './anim/lounge.ts'
export type { BikeFit } from './anim/poser.ts'
export { buildAvatarGeometry, preloadAssets, type AvatarGeometry, type Quality } from './body/build.ts'
export { BONES, type Rig, type BodyBone } from './body/rig.ts'
export { assetUrl, credits, loadIndex, setAssetBase, setAssetManifest, type AssetEntry } from './body/mhassets.ts'
export { ASSET_BUCKET, AVATARKIT_INDEXES, loadFromBucket } from './body/bucket.ts'
export { EXPRESSION_UNITS, loadModifierDefs, type ExpressionUnit, type ModifierDef, type ModifierDefs } from './body/mhmodifiers.ts'
export { EXPRESSIONS, expressionWeights, type ExpressionName, type ExpressionWeights } from './anim/expressions.ts'
export { HAND_POSES, type HandPose } from './anim/hands.ts'
export { MOVES, moveFor, type Move } from './anim/moves.ts'
export { createEngine, suggestQuality } from './render/engine.ts'
export { lightStage, setStudioHdri, STUDIO_HDRI } from './render/lighting.ts'
export { beachChair, beachUmbrella, propMesh, towel, type PropGeometry } from './props/beach.ts'
