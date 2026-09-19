/** A soft, bright stage for looking at avatars (used by the designer, the gallery and the dev page). */
import {
  ArcRotateCamera, Color3, Color4, DirectionalLight, MeshBuilder, Scene, ShadowGenerator,
  StandardMaterial, Vector3, DynamicTexture, Texture, type AbstractEngine,
} from '@babylonjs/core'
import { createEngine, suggestQuality } from '../render/engine.ts'
import type { Quality } from '../body/build.ts'
import { lightStage } from '../render/lighting.ts'

export interface Stage {
  engine: AbstractEngine
  quality: Quality
  scene: Scene
  camera: ArcRotateCamera
  shadows: ShadowGenerator
  sun: DirectionalLight
}

export async function createStage(canvas: HTMLCanvasElement, opts: { ground?: boolean; clear?: string; quality?: Quality } = {}): Promise<Stage> {
  const engine = await createEngine(canvas)
  const quality = opts.quality ?? suggestQuality(engine)
  const scene = new Scene(engine)
  const clear = Color3.FromHexString(opts.clear ?? '#9fd3ff')
  scene.clearColor = new Color4(clear.r, clear.g, clear.b, 1)
  scene.ambientColor = new Color3(0.25, 0.25, 0.3)
  const camera = new ArcRotateCamera('cam', Math.PI / 2, 1.38, 4.2, new Vector3(0, 0.92, 0), scene)
  camera.lowerRadiusLimit = 0.45
  camera.upperRadiusLimit = 14
  camera.wheelDeltaPercentage = 0.01
  camera.pinchDeltaPercentage = 0.004
  camera.minZ = 0.05
  camera.fov = 0.6
  camera.attachControl(canvas, true)
  const { key: sun } = lightStage(scene, camera, quality)
  const shadows = new ShadowGenerator(quality === 'low' ? 1024 : 2048, sun)
  shadows.useBlurExponentialShadowMap = true
  shadows.blurKernel = quality === 'low' ? 8 : 16
  shadows.darkness = 0.35
  shadows.bias = 0.0005
  if (opts.ground !== false) {
    const ground = MeshBuilder.CreateDisc('ground', { radius: 30, tessellation: 64 }, scene)
    ground.rotation.x = Math.PI / 2
    const gm = new StandardMaterial('groundMat', scene)
    const tex = new DynamicTexture('groundTex', { width: 512, height: 512 }, scene, true)
    const ctx = tex.getContext()
    const g = ctx.createRadialGradient(256, 256, 20, 256, 256, 256)
    g.addColorStop(0, '#e9f4e0')
    g.addColorStop(0.35, '#cfe8c4')
    g.addColorStop(1, '#9fd3ff')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 512, 512)
    tex.update()
    tex.wrapU = tex.wrapV = Texture.CLAMP_ADDRESSMODE
    gm.diffuseTexture = tex
    gm.specularColor = new Color3(0, 0, 0)
    gm.emissiveColor = new Color3(0.25, 0.25, 0.25)
    ground.material = gm
    ground.receiveShadows = true
  }
  window.addEventListener('resize', () => engine.resize())
  return { engine, quality, scene, camera, shadows, sun }
}
