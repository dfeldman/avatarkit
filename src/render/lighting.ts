/**
 * Portrait lighting for showing avatars (the dev stage, the designer; a game brings its own): a key light from
 * above and to one side, so faces and bodies model in light and shadow; a soft fill with a warm bounce from the
 * ground; a rim light from behind that separates the figure from the background; a photographed studio as
 * image-based light (soft light and reflections for the physically based materials); ambient occlusion in the
 * creases; and filmic tone mapping.
 */
import {
  Color3, Constants, DirectionalLight, HDRCubeTexture, HDRFiltering, HemisphericLight, ImageProcessingConfiguration, RawCubeTexture,
  SSAO2RenderingPipeline, SphericalPolynomial, Vector3, type Camera, type Scene,
} from '@babylonjs/core'
import { colorBytesPerSample } from './engine.ts'
import type { Quality } from '../body/build.ts'
// (their shaders registered up front, for the same reason as the skin's scattering pass: see materials.ts)
import '@babylonjs/core/Shaders/ssao2.fragment'
import '@babylonjs/core/Shaders/ssaoCombine.fragment'
import '@babylonjs/core/ShadersWGSL/ssao2.fragment'
import '@babylonjs/core/ShadersWGSL/ssaoCombine.fragment'
import '@babylonjs/core/ShadersWGSL/hdrFiltering.fragment'
import '@babylonjs/core/ShadersWGSL/hdrFiltering.vertex'

/** A studio HDRI (Poly Haven's "Studio Small 08", CC0), served beside the page as env/ unless setStudioHdri says
 *  otherwise (a host page that serves the kit's assets from elsewhere, as the Dandyhorse console does). */
export const STUDIO_HDRI = 'env/studio_small_08_1k.hdr'
let hdriUrl: string | null = null
export function setStudioHdri(url: string): void {
  hdriUrl = url
}
const studioHdri = (): string => hdriUrl ?? new URL(STUDIO_HDRI, document.baseURI).href

export interface StageLights {
  key: DirectionalLight
  fill: HemisphericLight
  rim: DirectionalLight
}

/**
 * The stage's lighting at a quality: high has everything; medium drops ambient occlusion; low lights with the small
 * procedural sky instead of the studio photograph (nothing to download or prefilter).
 */
export function lightStage(scene: Scene, camera?: Camera, quality: Quality = 'high'): StageLights {
  const fill = new HemisphericLight('fill', new Vector3(0.1, 1, 0.25), scene)
  // (a little: most of the soft light now comes from the studio environment)
  fill.intensity = 0.2
  fill.diffuse = new Color3(0.92, 0.95, 1)
  fill.groundColor = new Color3(0.45, 0.36, 0.3)
  fill.specular = new Color3(0, 0, 0)
  // (the avatar faces +Z: this key comes from its front right, the viewer's upper left)
  const key = new DirectionalLight('key', new Vector3(0.55, -0.75, -0.42), scene)
  key.position = new Vector3(-6, 9, 5)
  key.intensity = 2.1
  key.diffuse = new Color3(1, 0.95, 0.88)
  const rim = new DirectionalLight('rim', new Vector3(-0.45, -0.35, 0.82), scene)
  rim.intensity = 0.9
  rim.diffuse = new Color3(0.85, 0.9, 1)
  rim.specular = new Color3(0.6, 0.65, 0.7)
  const ip = scene.imageProcessingConfiguration
  ip.toneMappingEnabled = true
  ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES
  ip.exposure = 1.05
  ip.contrast = 1.08
  if (typeof document !== 'undefined' && quality !== 'low') studioEnvironment(scene)
  else skyEnvironment(scene, key.direction.scale(-1).normalize())
  if (camera && quality === 'high') ambientOcclusion(scene, camera)
  return { key, fill, rim }
}

/**
 * Image-based lighting from a photographed studio: soft light that varies around the figure (brighter from the
 * softboxes, darker from the floor), and something real for skin, eyes and hair to reflect.
 */
export function studioEnvironment(scene: Scene, url = studioHdri()): void {
  const tex = new HDRCubeTexture(url, scene, 256, false, true, false, true)
  scene.environmentTexture = tex
  // (more than this and the skin's subsurface scattering turns the extra soft light orange on mid skin tones)
  scene.environmentIntensity = 0.5
}

/** Screen-space ambient occlusion: contact shadows in the creases (nostrils, under the chin, between garments). */
export function ambientOcclusion(scene: Scene, camera: Camera): SSAO2RenderingPipeline | null {
  if (!SSAO2RenderingPipeline.IsSupported) return null
  // it shares the skin's pre-pass, adding a normals target: 34 bytes a pixel, past WebGPU's minimum of 32. Devices
  // held to the minimum go without (its own geometry buffer beside the pre-pass fails to draw under WebGPU).
  if (colorBytesPerSample(scene.getEngine()) < 40) return null
  const ssao = new SSAO2RenderingPipeline('ssao', scene, { ssaoRatio: 0.75, blurRatio: 1 }, [camera])
  // (in metres: a person-sized scene)
  ssao.radius = 0.06
  ssao.totalStrength = 1.1
  ssao.samples = 16
  ssao.maxZ = 30
  ssao.minZAspect = 0.2
  ssao.expensiveBlur = true
  // (Babylon hands the occlusion pass its camera from another pass's before-render hook, which doesn't always run
  // first: on a first frame without it the pass skips binding its noise texture, and WebGPU fails to draw
  // ("randomSampler not found"). Give it the camera now.)
  const thin = (ssao as unknown as { _thinSSAORenderingPipeline?: { _ssaoPostProcess?: { camera: Camera | null } } })._thinSSAORenderingPipeline
  if (thin?._ssaoPostProcess) thin._ssaoPostProcess.camera = camera
  return ssao
}

/**
 * A small high-dynamic-range sky as the scene's environment: blue above, a warm bright horizon, a darker ground,
 * and a sun where the key light comes from. Prefiltered, so rough surfaces reflect it softly and glossy ones (the
 * corneas) sharply.
 */
export function skyEnvironment(scene: Scene, sun: Vector3, size = 64): void {
  // (half floats: WebGPU can't filter or mip 32-bit float textures without an optional feature)
  const faces: Uint16Array[] = []
  // Babylon's cube face order: +X, -X, +Y, -Y, +Z, -Z
  const dir = (f: number, u: number, v: number): Vector3 => {
    const d = [
      new Vector3(1, -v, -u), new Vector3(-1, -v, u), new Vector3(u, 1, v),
      new Vector3(u, -1, -v), new Vector3(u, -v, 1), new Vector3(-u, -v, -1),
    ][f]
    return d.normalize()
  }
  for (let f = 0; f < 6; f++) {
    const data = new Uint16Array(size * size * 4)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = dir(f, ((x + 0.5) / size) * 2 - 1, ((y + 0.5) / size) * 2 - 1)
        const up = d.y
        let r: number, g: number, b: number
        if (up >= 0) {
          const t = Math.pow(1 - up, 3)
          r = 0.3 + 0.5 * t; g = 0.42 + 0.38 * t; b = 0.7 + 0.1 * t
        } else {
          const t = Math.min(1, -up * 3)
          r = 0.8 - 0.6 * t; g = 0.72 - 0.55 * t; b = 0.62 - 0.5 * t
        }
        const s = Math.max(0, Vector3.Dot(d, sun))
        // a small bright sun: a catchlight in the eyes, a glint on skin
        const glow = Math.pow(s, 900) * 30 + Math.pow(s, 16) * 0.25
        const i = 4 * (y * size + x)
        data[i] = toHalf(r + glow); data[i + 1] = toHalf(g + glow * 0.95); data[i + 2] = toHalf(b + glow * 0.85); data[i + 3] = toHalf(1)
      }
    }
    faces.push(data)
  }
  const tex = new RawCubeTexture(scene, faces, size, Constants.TEXTUREFORMAT_RGBA, Constants.TEXTURETYPE_HALF_FLOAT, true)
  scene.environmentTexture = tex
  // reflections only: the lights do the modelling and the fill, so the sky gives no diffuse light of its own
  tex.sphericalPolynomial = new SphericalPolynomial()
  scene.environmentIntensity = 0.7
  void new HDRFiltering(scene.getEngine()).prefilter(tex).then(() => { tex.sphericalPolynomial = new SphericalPolynomial() }, () => undefined)
}

/** A number as an IEEE half float's bits (the sky's values: small, positive, finite). */
function toHalf(x: number): number {
  const f = new Float32Array([x]), u = new Uint32Array(f.buffer)[0]
  const sign = (u >>> 16) & 0x8000, exp = ((u >>> 23) & 0xff) - 127 + 15, mant = u & 0x7fffff
  if (exp <= 0) return sign
  if (exp >= 31) return sign | 0x7c00
  return sign | (exp << 10) | Math.round(mant / 0x2000)
}
