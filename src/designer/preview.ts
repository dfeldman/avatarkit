/**
 * The designer's 3D preview: one avatar on a soft stage, a treadmill strip that scrolls under walking and
 * running feet, a bike for cycling, turntable spin and face/body framing. Geometry comes from a worker (the
 * MakeHuman assets a spec needs load on demand there); the avatar appears when its first geometry arrives.
 */
import {
  ArcRotateCamera, Color3, Color4, DirectionalLight, DynamicTexture, Mesh, MeshBuilder,
  Scene, ShadowGenerator, StandardMaterial, Texture, Vector3, type AbstractEngine,
} from '@babylonjs/core'
import { lightStage } from '../render/lighting.ts'
import { captureFrame } from '../render/capture.ts'
import { suggestQuality } from '../render/engine.ts'
import type { Quality } from '../body/build.ts'
import type { ExpressionName } from '../anim/expressions.ts'
import type { MotionMode } from '../anim/animator.ts'
import { loadClips } from '../anim/clips.ts'
import type { HandPose } from '../anim/hands.ts'
import { moveFor, type Move } from '../anim/moves.ts'
import { Avatar } from '../render/avatar.ts'
import { Bike } from '../render/bike.ts'
import { GeometryService } from '../render/geometryService.ts'
import { shapeKey, type AvatarSpec } from '../spec.ts'

export type View = 'body' | 'face'

export class Preview {
  readonly engine: AbstractEngine
  /** detail for this device (suggestQuality; `?q=` overrides) */
  readonly quality: Quality
  readonly scene: Scene
  readonly camera: ArcRotateCamera
  /** null until the first geometry arrives */
  avatar: Avatar | null = null
  onBusy: (busy: boolean, text?: string) => void = () => {}
  private readonly service = new GeometryService()
  private readonly shadows: ShadowGenerator
  private bike: Bike | null = null
  private bikeColors = ''
  private track: Mesh
  private trackTex: Texture
  private spec: AvatarSpec
  private wanted = ''
  private mode: MotionMode = 'idle'
  private speed = 1.3
  private cadence = 80
  private spin = true
  private view: View = 'body'
  private expression: ExpressionName = 'neutral'
  private hands: HandPose = 'relaxed'
  /** the move playing (a one-shot plays again after a pause while it's chosen) */
  private move: Move | null = null
  private moveRest = 0
  private clipsReady: Promise<void> | null = null
  private spinPause = 0
  private frozen = false
  private readonly onResize = (): void => this.engine.resize()
  private readonly resizer = new ResizeObserver(this.onResize)

  /** (the engine on `canvas`, from createEngine with alpha: the page shows through) */
  /** the next frame the render loop draws, as a canvas (see render/capture.ts) */
  capture(): Promise<HTMLCanvasElement> {
    return captureFrame(this.scene)
  }

  constructor(engine: AbstractEngine, canvas: HTMLCanvasElement, spec: AvatarSpec) {
    this.spec = spec
    this.engine = engine
    this.quality = suggestQuality(engine)
    const scene = (this.scene = new Scene(this.engine))
    scene.clearColor = new Color4(0, 0, 0, 0)
    scene.ambientColor = new Color3(0.25, 0.25, 0.3)
    const cam = (this.camera = new ArcRotateCamera('cam', Math.PI / 2 + 0.35, 1.36, 4, new Vector3(0, 0.9, 0), scene))
    cam.lowerRadiusLimit = 0.55
    cam.upperRadiusLimit = 9
    cam.lowerBetaLimit = 0.35
    cam.upperBetaLimit = 1.62
    cam.wheelDeltaPercentage = 0.01
    cam.pinchDeltaPercentage = 0.004
    cam.panningSensibility = 0
    cam.minZ = 0.05
    cam.fov = 0.55
    cam.attachControl(canvas, true)
    canvas.addEventListener('pointerdown', () => (this.spinPause = 4))
    canvas.addEventListener('wheel', () => (this.spinPause = 4), { passive: true })

    const { key: sun } = lightStage(scene, cam, this.quality)
    this.shadows = new ShadowGenerator(1024, sun)
    this.shadows.useBlurExponentialShadowMap = true
    this.shadows.blurKernel = 20
    this.shadows.darkness = 0.4

    // a soft round floor that fades into the page, and a strip that scrolls when moving
    const floor = MeshBuilder.CreateDisc('floor', { radius: 1.6, tessellation: 64 }, scene)
    floor.rotation.x = Math.PI / 2
    const floorMat = new StandardMaterial('floorMat', scene)
    const ft = new DynamicTexture('floorTex', { width: 256, height: 256 }, scene, true)
    const fctx = ft.getContext()
    const g = fctx.createRadialGradient(128, 128, 10, 128, 128, 128)
    g.addColorStop(0, 'rgba(255,255,255,0.7)')
    g.addColorStop(0.45, 'rgba(255,255,255,0.35)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    fctx.fillStyle = g
    fctx.fillRect(0, 0, 256, 256)
    ft.update()
    ft.hasAlpha = true
    floorMat.diffuseTexture = ft
    floorMat.useAlphaFromDiffuseTexture = true
    floorMat.diffuseColor = new Color3(0.85, 0.9, 1)
    floorMat.emissiveColor = new Color3(0.45, 0.48, 0.6)
    floorMat.specularColor = Color3.Black()
    floor.material = floorMat
    floor.receiveShadows = true

    this.track = MeshBuilder.CreateGround('track', { width: 1.1, height: 4.4 }, scene)
    this.track.position.y = 0.002
    const trackMat = new StandardMaterial('trackMat', scene)
    const tt = new DynamicTexture('trackTex', { width: 128, height: 512 }, scene, true)
    const tctx = tt.getContext()
    const tg = tctx.createLinearGradient(0, 0, 0, 512)
    tg.addColorStop(0, 'rgba(40,52,110,0)')
    tg.addColorStop(0.25, 'rgba(40,52,110,0.85)')
    tg.addColorStop(0.75, 'rgba(40,52,110,0.85)')
    tg.addColorStop(1, 'rgba(40,52,110,0)')
    tctx.fillStyle = tg
    tctx.fillRect(0, 0, 128, 512)
    tt.update()
    tt.hasAlpha = true
    trackMat.opacityTexture = tt
    const dashes = new DynamicTexture('dashTex', { width: 64, height: 64 }, scene, true)
    const dctx = dashes.getContext()
    dctx.fillStyle = '#3b4a8f'
    dctx.fillRect(0, 0, 64, 64)
    dctx.fillStyle = '#ffd42a'
    dctx.fillRect(28, 8, 8, 30)
    dashes.update()
    dashes.wrapU = dashes.wrapV = Texture.WRAP_ADDRESSMODE
    dashes.vScale = 11
    this.trackTex = dashes
    trackMat.diffuseTexture = dashes
    trackMat.specularColor = Color3.Black()
    trackMat.emissiveColor = new Color3(0.2, 0.2, 0.25)
    this.track.material = trackMat
    this.track.receiveShadows = true
    this.track.setEnabled(false)

    this.wanted = shapeKey(spec)
    void this.load(spec)

    scene.onBeforeRenderObservable.add(() => {
      if (this.frozen) return
      this.tick(Math.min(0.05, this.engine.getDeltaTime() / 1000))
    })
    this.engine.runRenderLoop(() => scene.render())
    window.addEventListener('resize', this.onResize)
    this.resizer.observe(canvas)
    // (the engine was made before the canvas was laid out: size it now rather than wait for an observer, which only
    // reports on a rendering step, never while the page is hidden)
    this.engine.resize()
  }

  /** Advance the preview by dt seconds (also used by tests and screenshots). */
  tick(dt: number): void {
    const a = this.avatar
    if (!a) return
    a.update(dt)
    const cyc = a.animator.cycling
    if (cyc > 0 && !this.bike) this.makeBike()
    this.bike?.setEnabled(cyc > 0.5)
    // a chosen one-shot move comes round again after a breath
    if (this.move && this.clipSet && !a.animator.playing) {
      this.moveRest -= dt
      if (this.moveRest <= 0) {
        a.animator.play(this.move.clips)
        this.moveRest = 1.2
      }
    }
    const ground = this.move ? this.move.ground ?? 0 : this.mode === 'cycle' ? (this.cadence / 60) * 5.2 : this.mode === 'idle' ? 0 : this.speed
    this.bike?.update(a.animator.crank, dt * ground)
    this.track.setEnabled(ground > 0)
    this.track.scaling.x = this.mode === 'cycle' ? 0.8 : 1
    // the strip moves backward under the feet: v offset in texture repeats per metre
    this.trackTex.vOffset = (this.trackTex.vOffset + (dt * ground * this.trackTex.vScale) / 4.4) % 1
    if (this.spinPause > 0) this.spinPause -= dt
    else if (this.spin) this.camera.alpha += dt * 0.25
    if (this.view === 'face') {
      const head = a.bonePosition('head')
      Vector3.LerpToRef(this.camera.target, head.add(new Vector3(0, a.rig.headH * 0.3, 0)), Math.min(1, dt * 8), this.camera.target)
    }
  }

  private makeBike(): void {
    if (!this.avatar) return
    this.bike = new Bike(this.scene, this.avatar.animator.fit, { name: 'designerBike', color: bikeColor(this.spec), accent: '#ffffff' })
    this.bikeColors = bikeColor(this.spec)
    this.bike.root.parent = this.avatar.root
    for (const m of this.bike.getMeshes()) this.shadows.addShadowCaster(m)
  }

  private dropBike(): void {
    if (!this.bike) return
    for (const m of this.bike.getMeshes()) this.shadows.removeShadowCaster(m)
    this.bike.dispose()
    this.bike = null
  }

  /** Show a spec: colours change at once; a new shape or new clothes arrive from the worker. */
  setSpec(spec: AvatarSpec, _live: boolean): void {
    this.spec = spec
    const key = shapeKey(spec)
    this.avatar?.setLook(spec)
    if (this.bike && this.bikeColors !== bikeColor(spec)) this.dropBike()
    if (key === this.wanted) return
    this.wanted = key
    void this.load(spec)
  }

  private async load(spec: AvatarSpec): Promise<void> {
    const key = shapeKey(spec)
    const hit = this.service.cached(spec, this.quality)
    if (!hit) this.onBusy(true)
    const g = hit ?? (await this.service.request(spec, this.quality, { latest: true }))
    if (!g || key !== this.wanted) return
    if (!this.avatar) {
      this.avatar = new Avatar(this.scene, this.spec, { geometry: g, quality: this.quality, shadows: this.shadows, name: 'designer' })
      this.avatar.setExpression(this.expression)
      if (this.clipSet) this.avatar.animator.useClips(this.clipSet)
      this.avatar.setHands(this.move?.hands ?? this.hands)
      this.setMotion(this.mode)
      if (this.move) void this.setMove(this.move.id)
      this.avatar.animator.snap()
      this.frame(this.view)
    } else this.avatar.setSpec(this.spec, g)
    this.dropBike()
    this.onBusy(false)
  }

  /** The avatar's facial expression (kept across rebuilds). */
  setExpression(e: ExpressionName): void {
    this.expression = e
    this.avatar?.setExpression(e)
    // turn to the face and hold the turntable a while, so the expression is seen
    if (e !== 'neutral') {
      this.camera.alpha = Math.PI / 2 + 0.25
      this.spinPause = 8
    }
  }

  /** The hands' pose (a move starts with its own; this takes over again, and holds once the move stops). */
  setHands(p: HandPose): void {
    this.hands = p
    this.avatar?.setHands(p)
  }

  get handPose(): HandPose {
    return this.hands
  }

  /** Play a move (MOVES) over standing still, or null to stop; the clip library loads the first time. */
  async setMove(id: string | null): Promise<void> {
    const move = id ? moveFor(id) ?? null : null
    this.move = move
    if (!move) {
      this.avatar?.animator.play(null)
      this.avatar?.setHands(this.hands)
      return
    }
    if (!this.clipSet) this.onBusy(true, 'Loading moves…')
    this.clipsReady ??= loadClips().then((set) => { this.clipSet = set })
    await this.clipsReady
    this.onBusy(false)
    const a = this.avatar
    if (!a || this.move !== move) return
    a.animator.useClips(this.clipSet)
    this.setMotion('idle')
    a.animator.play(move.clips)
    a.setHands(move.hands)
    this.moveRest = 1.2
  }

  private clipSet: Awaited<ReturnType<typeof loadClips>> | null = null

  get moveId(): string | null {
    return this.move?.id ?? null
  }

  setMotion(mode: MotionMode, speed?: number): void {
    this.mode = mode
    if (!this.avatar) return
    if (mode === 'cycle') {
      if (speed !== undefined) this.cadence = speed
      this.avatar.setMotion({ mode, cadence: this.cadence, speed: (this.cadence / 60) * 5.2, effort: 0.5 })
    } else {
      if (speed !== undefined) this.speed = speed
      this.avatar.setMotion({ mode, speed: mode === 'idle' ? 0 : this.speed, effort: mode === 'run' ? 0.7 : 0.35 })
    }
    if (mode === 'cycle' && this.view === 'body') this.frame('body')
  }

  get motionMode(): MotionMode {
    return this.mode
  }

  setSpin(on: boolean): void {
    this.spin = on
    this.spinPause = 0
  }

  get spinning(): boolean {
    return this.spin
  }

  frame(view: View): void {
    this.view = view
    const cam = this.camera
    const h = this.avatar?.rig.height ?? 1.72
    if (view === 'face') {
      cam.radius = 0.62 + h * 0.18
      cam.beta = 1.45
    } else {
      cam.target = new Vector3(0, this.mode === 'cycle' ? 0.78 : h * 0.52, this.mode === 'cycle' ? 0.05 : 0)
      cam.radius = 2.2 + h * 1.25
      cam.beta = 1.36
    }
  }

  /** Stop the automatic animation (screenshots/tests drive tick() themselves). */
  freeze(on: boolean): void {
    this.frozen = on
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize)
    this.resizer.disconnect()
    this.service.dispose()
    this.engine.dispose()
  }
}

/** The bike takes the colour of the first tinted garment. */
const bikeColor = (s: AvatarSpec): string => s.clothes.find((c) => c.color)?.color ?? '#1f6bff'
