/**
 * The skin: a physically based material with subsurface scattering (light entering skin travels a little under it
 * before coming back out, red furthest: MakeHuman's own skins scatter red 5, green 2.5, blue 1), over a detail map
 * made from MakeHuman's skin photographs — lips redder than the cheek, creases darker, a flush at knees and elbows —
 * multiplied by the chosen skin colour. The photograph nearest that colour is used (tools/mkmhassets.mjs); nothing
 * else chooses it.
 *
 * Everything else an avatar wears (eyes, hair, eyebrows, eyelashes, clothes, shoes) is a MakeHuman proxy with its own
 * material (avatar.ts).
 */
import { Color3, PBRMaterial, Texture, type Scene } from '@babylonjs/core'
import { assetUrl, loadIndex, texturePath } from '../body/mhassets.ts'
import type { Quality } from '../body/build.ts'
// the scattering pass's shaders, registered up front: Babylon imports them when it first builds the pass, but not when
// it rebuilds it (morph targets switching on do that), and then fetches them by URL, which a dev server answers
// with a page (WGSL "<!DOCTYPE html>")
import '@babylonjs/core/Shaders/subSurfaceScattering.fragment'
import '@babylonjs/core/ShadersWGSL/subSurfaceScattering.fragment'
import type { AvatarSpec } from '../spec.ts'

export interface AvatarMaterials {
  body: PBRMaterial
  /** the relief strength to give the normal map once it loads */
  pores: number
  /** textures and shading follow it: low reads the smaller textures and skips subsurface scattering */
  quality: Quality
}

/** MakeHuman's skin scattering radii (sssRScale 5, sssGScale 2.5, sssBScale 1) in their proportions, at a quarter of
 *  the distance: with image-based light, the full distance carried so much red that mid skin tones went orange and
 *  flat. */
const SCATTER = new Color3(0.25, 0.125, 0.05)

export function createAvatarMaterials(scene: Scene, name: string, quality: Quality = 'medium'): AvatarMaterials {
  const body = new PBRMaterial(`${name}.skin`, scene)
  body.metallic = 1 // (scaled by the surface map's blue channel: 0)
  body.roughness = 1 // (scaled by its green channel: the skin's own roughness)
  // skin reflects less than most dielectrics (F0 about 0.028 against 0.04)
  body.metallicF0Factor = 0.7
  // (subsurface scattering needs the scene's pre-pass renderer: WebGPU or WebGL2. Elsewhere the skin is simply lit.)
  try {
    // (not at low quality: the extra pass costs more than it shows on a small, distant figure)
    if (quality !== 'low' && scene.getEngine().getCaps().drawBuffersExtension && scene.enableSubSurfaceForPrePass()) {
      scene.subSurfaceConfiguration!.metersPerUnit = 1
      body.subSurface.isScatteringEnabled = true
      body.subSurface.scatteringDiffusionProfile = SCATTER
    }
  } catch {
    // no pre-pass here: plain lighting
  }
  // micro-detail tiled finely over the skin (pores, fine lines): the photographs are a 2048 atlas for the whole body,
  // soft on a face seen close. Not at low quality (small, distant figures).
  if (quality !== 'low') {
    const detail = new Texture(assetUrl('tex/skin/detail.png'), scene)
    detail.gammaSpace = false
    // (one tile ≈ 2 cm of skin: the atlas spans about a metre)
    detail.uScale = detail.vScale = 50
    body.detailMap.texture = detail
    body.detailMap.isEnabled = true
  }
  return { body, pores: 0.5, quality }
}

/** The skin colour, and its detail photograph: the chosen one, or the nearest to the colour. */
export function applySpecToMaterials(m: AvatarMaterials, spec: AvatarSpec): void {
  const color = Color3.FromHexString(spec.skin.color)
  // the detail map holds half the photograph's ratio to its own median: twice the linear colour gives the colour itself
  m.body.albedoColor = color.toLinearSpace().scale(2)
  // surface: how strongly the relief shows, and matte to dewy (the roughness map is scaled around its own values)
  // (the photograph's own relief is soft and lumpy at this scale: the micro-detail below carries the fine grain)
  if (m.body.bumpTexture) m.body.bumpTexture.level = 1.4 * spec.skin.pores
  // (the micro-detail follows the same slider: none when smooth)
  m.body.detailMap.diffuseBlendLevel = 0.35 * spec.skin.pores
  m.body.detailMap.bumpLevel = 1.8 * spec.skin.pores
  m.body.detailMap.roughnessBlendLevel = 0.5 * spec.skin.pores
  m.body.roughness = 1.35 - 0.7 * spec.skin.shine
  m.pores = spec.skin.pores
  const fem = spec.macros.Gender < 0.5
  void loadIndex().then((idx) => {
    // a chosen photograph, else MakeHuman's own young skin of this sex nearest the colour
    let best = idx.find((a) => a.kind === 'skin' && a.id === spec.skin.texture)?.texture ?? '', dist = best ? -1 : Infinity
    for (const a of idx) {
      if (dist < 0) break
      if (a.kind !== 'skin' || !a.auto || !a.texture || !a.tone || a.tags[0] !== (fem ? 'female' : 'male')) continue
      const t = Color3.FromHexString(a.tone)
      const d = (t.r - color.r) ** 2 + (t.g - color.g) ** 2 + (t.b - color.b) ** 2
      if (d < dist) { dist = d; best = a.texture }
    }
    if (!best) return
    const url = assetUrl(texturePath(best, m.quality))
    if ((m.body.albedoTexture as Texture | null)?.url === url) return
    const scene = m.body.getScene()
    for (const t of [m.body.albedoTexture, m.body.bumpTexture, m.body.metallicTexture]) t?.dispose()
    // (sRGB-encoded, decoded to linear by the GPU)
    m.body.albedoTexture = new Texture(url, scene)
    // relief from the same photograph: pores, stubble, fine lines
    const bump = new Texture(url.replace(/(\.lo)?\.jpg$/, '_normal$1.jpg'), scene)
    bump.gammaSpace = false
    bump.level = 1.4 * m.pores
    m.body.bumpTexture = bump
    // roughness in green (lips and damp skin shinier, pores and creases rougher), metallic 0 in blue
    const surface = new Texture(url.replace(/(\.lo)?\.jpg$/, '_rough.jpg'), scene)
    surface.gammaSpace = false
    m.body.metallicTexture = surface
    m.body.useRoughnessFromMetallicTextureGreen = true
    m.body.useMetallnessFromMetallicTextureBlue = true
    m.body.useAmbientOcclusionFromMetallicTextureRed = false
  }, () => undefined)
}
