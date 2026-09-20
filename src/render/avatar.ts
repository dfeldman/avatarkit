/**
 * Avatar: one player's look in a Babylon scene. Owns a root TransformNode (put it where the player is; the avatar
 * faces +Z with its feet at the root), a skinned MakeHuman body with its eyes, hair, eyebrows, eyelashes, clothes
 * and shoes, and an Animator.
 *
 *   const a = await Avatar.create(scene, spec)
 *   a.setMotion({ mode: 'run', speed: 3.2 })
 *   scene.onBeforeRenderObservable.add(() => a.update(engine.getDeltaTime() / 1000))
 *
 * The face and hands take poses on top of the motion: `a.setExpression('smile')`, `a.setHands('fist')`.
 */
import {
  BaseTexture, Bone, BoundingInfo, Color3, Matrix, Mesh, MorphTarget, MorphTargetManager, PBRMaterial, Quaternion, Skeleton, Texture, TransformNode, VertexBuffer,
  type Scene, type ShadowGenerator, Vector3, VertexData,
} from '@babylonjs/core'
import { Animator, type Motion } from '../anim/animator.ts'
import { buildAvatarGeometry, preloadAssets, type AvatarGeometry, type ProxyGeometry, type Quality, type SkinnedMeshData } from '../body/build.ts'
import { assetUrl, texturePath } from '../body/mhassets.ts'
import type { MorphKey } from '../body/mhbody.ts'
import { HAND_MORPHS, handMorph, type HandMorph, type HandPose } from '../anim/hands.ts'
import { Blinker, expressionWeights, type ExpressionName, type ExpressionWeights } from '../anim/expressions.ts'
import { BONES, PARENT, type Rig } from '../body/rig.ts'
import { normalizeSpec, shapeKey, type AvatarSpec } from '../spec.ts'
import { applySpecToMaterials, createAvatarMaterials, type AvatarMaterials } from './materials.ts'

export interface AvatarOptions {
  name?: string
  quality?: Quality
  /** reuse geometry built elsewhere (e.g. in a worker) */
  geometry?: AvatarGeometry
  /** shadow casters are added here */
  shadows?: ShadowGenerator
}

let counter = 0

/** Geometry cache: rebuilding the same body twice (a crowd of clones, a designer undo) is free. */
const CACHE = new Map<string, AvatarGeometry>()
const CACHE_MAX = 24

/** Builds (or reuses) a spec's geometry; its MakeHuman assets must be loaded (see preloadAssets). */
export function getGeometry(spec: AvatarSpec, quality: Quality): AvatarGeometry {
  const key = `${quality}|${shapeKey(spec)}`
  let g = CACHE.get(key)
  if (!g) {
    g = buildAvatarGeometry(spec, quality)
    CACHE.set(key, g)
    if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value as string)
  }
  return g
}

export class Avatar {
  readonly scene: Scene
  readonly name: string
  readonly root: TransformNode
  readonly animator: Animator
  spec: AvatarSpec
  rig!: Rig
  quality: Quality
  body: Mesh | null = null
  eyes: Mesh | null = null
  cornea: Mesh | null = null
  /** MakeHuman proxies: hair, eyebrows, eyelashes, clothes, shoes (in the spec's order) */
  proxies: Mesh[] = []
  skeleton: Skeleton | null = null
  /** bone name -> node (parent-linked like the bones; attach props here) */
  readonly nodes = new Map<string, TransformNode>()
  private readonly materials: AvatarMaterials
  private geometryKey = ''
  private geometry: AvatarGeometry | null = null
  /** blink on its own every few seconds (a game can turn it off, e.g. for a photo) */
  blinking = true
  private expression: ExpressionWeights = {}
  private blink = 0
  private readonly blinker = new Blinker()
  private readonly morphTargets = new Map<MorphKey, MorphTarget[]>()
  /** the hand pose asked for, and each hand morph's weight now (they ease toward it) */
  private hands: { pose: HandPose; strength: number } = { pose: 'relaxed', strength: 1 }
  private readonly handW = new Map<HandMorph, number>(HAND_MORPHS.map((m) => [m, 0]))
  private shadows?: ShadowGenerator

  /** Loads the spec's MakeHuman assets, then builds the avatar. */
  static async create(scene: Scene, spec: unknown, opts: AvatarOptions = {}): Promise<Avatar> {
    const s = normalizeSpec(spec)
    if (!opts.geometry) await preloadAssets(s, opts.quality ?? 'medium')
    return new Avatar(scene, s, opts)
  }

  /** Builds at once: the spec's MakeHuman assets must already be loaded (or pass geometry). */
  constructor(scene: Scene, spec: unknown, opts: AvatarOptions = {}) {
    this.scene = scene
    this.name = opts.name ?? `avatar${++counter}`
    this.quality = opts.quality ?? 'medium'
    this.shadows = opts.shadows
    this.root = new TransformNode(this.name, scene)
    this.materials = createAvatarMaterials(scene, this.name, this.quality)
    this.spec = normalizeSpec(spec)
    this.animator = new Animator()
    this.rebuild(opts.geometry ?? getGeometry(this.spec, this.quality))
  }

  /** Change the look: new shapes or proxies rebuild (their assets must be loaded), colours don't. */
  setSpec(spec: unknown, geometry?: AvatarGeometry): void {
    this.spec = normalizeSpec(spec)
    const key = `${this.quality}|${shapeKey(this.spec)}`
    if (geometry || key !== this.geometryKey) this.rebuild(geometry ?? getGeometry(this.spec, this.quality))
    else this.refreshLook()
  }

  /** Colours right away, keeping the current meshes (for a UI that builds the new shape in the background). */
  setLook(spec: unknown): void {
    this.spec = normalizeSpec(spec)
    this.refreshLook()
  }

  /** The shape key of the meshes on screen. */
  get shape(): string {
    return this.geometryKey
  }

  /** Rebuild at another quality (its assets must be loaded: `await preloadAssets(avatar.spec, q)` for low). */
  setQuality(q: Quality): void {
    if (q === this.quality) return
    this.quality = q
    // (textures follow on the next refresh; subsurface scattering stays as the avatar was created)
    this.materials.quality = q
    this.rebuild(getGeometry(this.spec, q))
  }

  setMotion(m: Partial<Motion>): void {
    this.animator.set(m)
  }

  /**
   * The face: a named expression at a strength (0..1), or MakeHuman's expression units directly. Holds until changed;
   * blinking carries on over it (see `blinking`).
   */
  setExpression(e: ExpressionName | ExpressionWeights, strength = 1): void {
    this.expression = expressionWeights(e, strength)
    this.applyExpression()
  }

  /**
   * The hands: relaxed (the default), open, fist or point, at a strength (0..1). They move there over a fifth of a
   * second. While cycling, relaxed hands close around the bars on their own.
   */
  setHands(pose: HandPose, strength = 1): void {
    this.hands = { pose, strength: Math.max(0, Math.min(1, strength)) }
  }

  get handPose(): HandPose {
    return this.hands.pose
  }

  /** Advance animation by dt seconds and pose the skeleton. */
  update(dt: number): void {
    let dirty = false
    if (this.blinking) {
      const b = this.blinker.update(Math.min(dt, 0.1))
      if (b !== this.blink) { this.blink = b; dirty = true }
    }
    // the hands ease toward their pose (a relaxed hand grips the bars as the rider settles onto the bike)
    const grip = this.hands.pose === 'relaxed' ? 0.7 * this.animator.cycling : 0
    const want = handMorph(this.hands.pose)
    for (const m of HAND_MORPHS) {
      const target = m === want ? this.hands.strength : m === 'hand-fist' ? grip : 0
      const w = this.handW.get(m)!
      const eased = Math.abs(target - w) < 1e-3 ? target : w + (target - w) * Math.min(1, dt / 0.06)
      if (eased !== w) { this.handW.set(m, eased); dirty = true }
    }
    if (dirty) this.applyExpression()
    const pose = this.animator.update(Math.min(dt, 0.1))
    for (const [name, q] of pose.rotations) {
      const node = this.nodes.get(name)
      if (node) node.rotationQuaternion!.copyFrom(q)
    }
    const hips = this.nodes.get('hips')!
    const rest = this.rig.joints.hips
    hips.position.set(rest[0] + pose.hipsOffset.x, rest[1] + pose.hipsOffset.y, rest[2] + pose.hipsOffset.z)
  }

  /**
   * Resolves when every texture this avatar draws with has loaded. The meshes exist before their skin, clothes and
   * hair textures arrive, so anything shown at once appears bare and half-painted for a moment: hide it (or hold a
   * spinner) until this resolves. Gives up after `timeoutMs`, so a texture that never loads can't hide the avatar
   * for good.
   */
  whenReady(timeoutMs = 15000): Promise<void> {
    const textures = this.getMeshes().flatMap((m) => m.material?.getActiveTextures() ?? [])
    if (!textures.length) return Promise.resolve()
    return new Promise<void>((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(finish, timeoutMs)
      BaseTexture.WhenAllReady(textures, finish)
    })
  }

  /** World position of a bone (after the last update). */
  bonePosition(name: string, out = new Vector3()): Vector3 {
    const n = this.nodes.get(name)
    if (!n) return out.setAll(0)
    n.computeWorldMatrix(true)
    return out.copyFrom(n.getAbsolutePosition())
  }

  getMeshes(): Mesh[] {
    return [this.body, this.eyes, this.cornea, ...this.proxies].filter((m): m is Mesh => m !== null)
  }

  dispose(): void {
    this.disposeMeshes()
    this.materials.body.dispose()
    this.root.dispose()
  }

  // -------------------------------------------------------------------------------------------------------------

  private disposeMeshes(): void {
    for (const m of this.getMeshes()) {
      this.shadows?.removeShadowCaster(m)
      if (m !== this.body) m.material?.dispose(false, true)
      m.dispose()
    }
    this.body = this.eyes = this.cornea = null
    this.proxies = []
    this.morphTargets.clear()
    this.skeleton?.dispose()
    this.skeleton = null
    for (const n of this.nodes.values()) n.dispose()
    this.nodes.clear()
  }

  /** The expression's unit weights, with the blink closing both eyes over them, and the hands', on every morph target. */
  private applyExpression(): void {
    for (const [unit, targets] of this.morphTargets) {
      let w = unit.startsWith('hand-') ? this.handW.get(unit as HandMorph) ?? 0 : this.expression[unit as keyof ExpressionWeights] ?? 0
      if (this.blink > 0 && (unit === 'eye-left-closure' || unit === 'eye-right-closure')) w = Math.max(w, this.blink)
      for (const t of targets) t.influence = w
    }
  }

  private rebuild(g: AvatarGeometry): void {
    this.disposeMeshes()
    this.rig = g.rig
    this.geometry = g
    this.geometryKey = `${this.quality}|${shapeKey(this.spec)}`
    const scene = this.scene
    const skel = new Skeleton(`${this.name}.skeleton`, `${this.name}.skeleton`, scene)
    const bones = new Map<string, Bone>()
    for (const name of BONES) {
      const parent = PARENT[name]
      const j = g.rig.joints[name]
      const pj = parent ? g.rig.joints[parent] : [0, 0, 0]
      const bone = new Bone(name, skel, parent ? bones.get(parent)! : null, Matrix.Translation(j[0] - pj[0], j[1] - pj[1], j[2] - pj[2]))
      bones.set(name, bone)
      const node = new TransformNode(`${this.name}.${name}`, scene)
      node.parent = parent ? this.nodes.get(parent)! : this.root
      node.position.set(j[0] - pj[0], j[1] - pj[1], j[2] - pj[2])
      node.rotationQuaternion = Quaternion.Identity()
      bone.linkTransformNode(node)
      this.nodes.set(name, node)
    }
    this.skeleton = skel
    this.animator.bind(g.rig)

    this.body = this.makeMesh(`${this.name}.body`, g.body)
    this.body.material = this.materials.body
    // the eyes: MakeHuman's eye material on the eyeball, a clear glossy cornea over it
    this.eyes = this.makeMesh(`${this.name}.eyes`, g.eyes)
    // (every avatar material is physically based: the skin's scattering pass needs each surface to report itself)
    const eyeball = new PBRMaterial(`${this.name}.eyeball`, scene)
    eyeball.metallic = 0
    eyeball.roughness = 0.35
    this.eyes.material = eyeball
    this.cornea = this.makeMesh(`${this.name}.cornea`, g.cornea)
    const cornea = new PBRMaterial(`${this.name}.cornea`, scene)
    cornea.albedoColor = new Color3(0, 0, 0)
    cornea.metallic = 0
    cornea.roughness = 0.05
    cornea.alpha = 0.12
    cornea.useSpecularOverAlpha = true
    cornea.useRadianceOverAlpha = true
    this.cornea.material = cornea
    this.shadows?.removeShadowCaster(this.cornea)
    for (const pg of g.proxies) {
      const mesh = this.makeMesh(`${this.name}.${pg.kind}.${pg.id}`, pg)
      mesh.material = this.proxyMaterial(pg)
      // (MakeHuman draws by z_depth: hair and brows after the skin they sit on)
      if (pg.material.transparent) mesh.alphaIndex = 100 - pg.zDepth
      this.proxies.push(mesh)
    }
    this.refreshLook()
    this.applyExpression()
  }

  private makeMesh(name: string, d: SkinnedMeshData): Mesh {
    const mesh = new Mesh(name, this.scene)
    const vd = new VertexData()
    vd.positions = d.positions
    vd.normals = d.normals
    vd.indices = d.indices
    vd.matricesIndices = d.boneIndices
    vd.matricesWeights = d.boneWeights
    if (d.uvs) vd.uvs = d.uvs
    vd.applyToMesh(mesh, false)
    // the body's vertex colour (occlusion and complexion) follows the look without a rebuild (skinTone)
    if (d.ao) mesh.setVerticesData(VertexBuffer.ColorKind, new Float32Array(d.ao.length * 4).fill(1), true, 4)
    mesh.parent = this.root
    mesh.skeleton = this.skeleton
    // skinned bounds don't follow the pose: use a box that covers any reachable pose
    const H = this.rig.height
    mesh.setBoundingInfo(new BoundingInfo(new Vector3(-H * 0.6, -0.1, -H * 0.6), new Vector3(H * 0.6, H * 1.1, H * 0.6)))
    this.shadows?.addShadowCaster(mesh)
    // facial expressions and hand poses: one morph target each (its moves added to the rest positions)
    const morphs = Object.entries(d.morphs ?? {}) as Array<[MorphKey, Float32Array]>
    if (morphs.length) {
      const mgr = new MorphTargetManager(this.scene)
      for (const [unit, delta] of morphs) {
        const t = new MorphTarget(`${name}.${unit}`, 0, this.scene)
        const pos = new Float32Array(d.positions.length)
        for (let k = 0; k < pos.length; k++) pos[k] = d.positions[k] + delta[k]
        t.setPositions(pos)
        mgr.addTarget(t)
        let list = this.morphTargets.get(unit)
        if (!list) this.morphTargets.set(unit, (list = []))
        list.push(t)
      }
      mesh.morphTargetManager = mgr
    }
    return mesh
  }

  /**
   * A MakeHuman proxy's material: its own texture, alpha-tested where it has alpha (hair, brows, lashes, lace),
   * lit on both sides where it isn't back-face culled.
   */
  private proxyMaterial(pg: ProxyGeometry): PBRMaterial {
    const m = new PBRMaterial(`${this.name}.${pg.kind}.${pg.id}`, this.scene)
    if (pg.material.texture) {
      const tex = new Texture(assetUrl(texturePath(pg.material.texture, this.quality)), this.scene)
      tex.hasAlpha = pg.material.transparent
      m.albedoTexture = tex
    }
    if (pg.material.normal) {
      const n = new Texture(assetUrl(texturePath(pg.material.normal, this.quality)), this.scene)
      n.gammaSpace = false
      m.bumpTexture = n
    }
    m.metallic = 0
    // hair has a soft sheen; fabric and leather are matt
    m.roughness = pg.kind === 'hair' || pg.kind === 'eyebrows' || pg.kind === 'eyelashes' ? 0.66 : pg.kind === 'teeth' ? 0.3 : pg.kind === 'tongue' ? 0.45 : 0.8
    if (isGlasses(pg.id)) {
      // glasses: lenses are see-through in their texture's alpha (blended, not cut away), and glossy like glass
      m.transparencyMode = 2 // alpha blend
      m.useAlphaFromAlbedoTexture = pg.material.transparent
      m.roughness = 0.12
      m.metallic = 0
    } else if (pg.material.transparent) {
      m.transparencyMode = 1 // alpha test
      m.alphaCutOff = 0.4
      m.useAlphaFromAlbedoTexture = true
    }
    m.backFaceCulling = pg.material.backfaceCull
    m.twoSidedLighting = !pg.material.backfaceCull
    return m
  }

  /**
   * The body's vertex colour: baked occlusion (softened, so creases deepen without looking dirty) times the
   * complexion — redness where blood shows through, the shade under the eyes, beard shadow, uneven tone — mixed by
   * the spec's skin settings. The material multiplies it into the skin.
   */
  private skinTone(): void {
    const d = this.geometry?.body
    if (!this.body || !d?.ao) return
    const { redness, blotchiness, beard } = this.spec.skin
    const t = d.tone
    const c = new Float32Array(d.ao.length * 4)
    for (let i = 0; i < d.ao.length; i++) {
      const o = 0.3 + 0.7 * d.ao[i]
      let r = 1, g = 1, b = 1
      if (t) {
        const red = t[4 * i] * redness * 2, shade = t[4 * i + 1], bd = t[4 * i + 2] * beard, bl = t[4 * i + 3] * blotchiness * 0.07
        r = (1 + 0.05 * red - 0.05 * shade - 0.14 * bd) * (1 + bl)
        g = (1 - 0.1 * red - 0.08 * shade - 0.1 * bd) * (1 + bl * 0.8)
        b = (1 - 0.08 * red - 0.03 * shade - 0.02 * bd) * (1 + bl * 0.6)
      }
      c[4 * i] = o * r; c[4 * i + 1] = o * g; c[4 * i + 2] = o * b; c[4 * i + 3] = 1
    }
    this.body.updateVerticesData(VertexBuffer.ColorKind, c)
  }

  /** Colours: the skin, the eye material, and the tints on hair, brows and clothes. */
  private refreshLook(): void {
    applySpecToMaterials(this.materials, this.spec)
    this.skinTone()
    const eye = this.eyes?.material as PBRMaterial | undefined
    if (eye) {
      const url = assetUrl(`tex/eyes/${this.spec.eyes}.jpg`)
      if ((eye.albedoTexture as Texture | null)?.url !== url) {
        eye.albedoTexture?.dispose()
        const tex = new Texture(url, this.scene)
        eye.albedoTexture = tex
      }
    }
    const tints = new Map<string, string | undefined>()
    if (this.spec.hair.id) tints.set(`hair.${this.spec.hair.id}`, this.spec.hair.color)
    if (this.spec.eyebrows) tints.set(`eyebrows.${this.spec.eyebrows}`, this.spec.hair.color)
    for (const c of this.spec.clothes) tints.set(`clothes.${c.id}`, c.color)
    for (const mesh of this.proxies) {
      const key = mesh.name.slice(this.name.length + 1)
      const pm = this.geometry?.proxies.find((p) => `${p.kind}.${p.id}` === key)?.material
      // (teeth: a little warm and shaded, as teeth in a mouth are; the tongue as textured)
      ;(mesh.material as PBRMaterial).albedoColor = key.startsWith('teeth.') ? new Color3(0.78, 0.74, 0.66)
        : key.startsWith('tongue.') ? new Color3(0.9, 0.9, 0.9) : tintFor(tints.get(key), pm)
    }
  }
}

/** Glasses and goggles (MakeHuman files them with the clothes). */
export const isGlasses = (id: string): boolean => /glass|goggle/i.test(id)

/**
 * The colour a proxy's texture is multiplied by (linear, as a physically based material's colour is).
 * - Recolourable garments carry neutral detail at half their ratio to their own colour (tools/mkmhassets.mjs):
 *   twice the chosen colour, or twice their own when none is chosen, which gives back the photograph.
 * - Patterned garments are worn as photographed, whatever colour is asked for.
 * - Hair and brows are light neutral grey strands: the colour multiplies them, blond to black.
 */
function tintFor(hex: string | undefined, material?: { baseColor?: string | null; tintable?: boolean }): Color3 {
  if (material?.baseColor) {
    if (!material.tintable) return new Color3(1, 1, 1)
    return Color3.FromHexString(hex ?? material.baseColor).toLinearSpace().scale(2)
  }
  return hex ? Color3.FromHexString(hex).toLinearSpace() : new Color3(1, 1, 1)
}
