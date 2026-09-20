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
import { Color3, DynamicTexture, PBRMaterial, Texture, type Scene } from '@babylonjs/core'
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
  /** TEMPORARY: how much of the photograph's own variation to keep (see skin.photo), and what is drawn now */
  photo: number
  photoKey?: string
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
  return { body, photo: 1, quality }
}

/**
 * TEMPORARY (2026-09-19): the photograph with its own variation pulled toward
 * its median, for judging how much of a heavily freckled skin should survive. The textures hold half the
 * photograph's ratio to its median, so the neutral texel is mid grey: fading toward that flattens freckles,
 * creases and shading together, and 1 leaves the photograph alone.
 */
function fadedPhoto(url: string, scene: Scene, keep: number): Texture {
  const size = 2048
  const t = new DynamicTexture(`skinPhoto|${keep}`, { width: size, height: size }, scene, true)
  const ctx = t.getContext() as CanvasRenderingContext2D
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    ctx.drawImage(img, 0, 0, size, size)
    // sRGB(0.5 linear) = 188: the value a texel has where the photograph matches its own median
    ctx.fillStyle = `rgba(188, 188, 188, ${1 - keep})`
    ctx.fillRect(0, 0, size, size)
    t.update()
  }
  img.src = url
  return t
}

/**
 * The skin colour, and its detail photograph: the chosen one, or the nearest to the colour.
 *
 * The photograph's own relief is deliberately not used. It was derived from the photograph's brightness (a
 * high-pass, then slopes), which cannot tell a pore from a freckle, so every dark mark became a dent and freckled
 * skins came out pitted. The fine grain now comes only from the tiled micro-detail map, which is the same for
 * everyone and knows nothing about pigment.
 */
export function applySpecToMaterials(m: AvatarMaterials, spec: AvatarSpec): void {
  const color = Color3.FromHexString(spec.skin.color)
  // the detail map holds half the photograph's ratio to its own median: twice the linear colour gives the colour itself
  m.body.albedoColor = color.toLinearSpace().scale(2)
  // surface: the micro-detail's grain, and matte to dewy (the roughness map is scaled around its own values)
  // (the skin has no relief from the photograph: see the note above applySpecToMaterials)
  const detail = spec.skin.pores
  m.body.detailMap.diffuseBlendLevel = 0.35 * detail
  m.body.detailMap.bumpLevel = 1.8 * detail
  m.body.detailMap.roughnessBlendLevel = 0.5 * detail
  m.body.roughness = 1.35 - 0.7 * spec.skin.shine
  m.photo = spec.skin.photo ?? 1
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
    if (m.photoKey === `${url}|${m.photo}`) return
    m.photoKey = `${url}|${m.photo}`
    const scene = m.body.getScene()
    for (const t of [m.body.albedoTexture, m.body.metallicTexture]) t?.dispose()
    // (sRGB-encoded, decoded to linear by the GPU)
    m.body.albedoTexture = m.photo >= 0.999 ? new Texture(url, scene) : fadedPhoto(url, scene, m.photo)
    // roughness in green (lips and damp skin shinier, pores and creases rougher), metallic 0 in blue
    const surface = new Texture(url.replace(/(\.lo)?\.jpg$/, '_rough.jpg'), scene)
    surface.gammaSpace = false
    m.body.metallicTexture = surface
    m.body.useRoughnessFromMetallicTextureGreen = true
    m.body.useMetallnessFromMetallicTextureBlue = true
    m.body.useAmbientOcclusionFromMetallicTextureRed = false
  }, () => undefined)
}
