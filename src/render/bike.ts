/**
 * A cartoon bike built around a rider's BikeFit (so saddle, pedals and bars are exactly where the avatar puts its
 * hips, feet and hands). Parent `root` to the same transform as the avatar root. Games with their own bike model
 * can read the fit instead.
 */
import { Color3, Mesh, MeshBuilder, Quaternion, StandardMaterial, TransformNode, Vector3, type Scene } from '@babylonjs/core'
import type { BikeFit } from '../anim/poser.ts'

export interface BikeOptions {
  name?: string
  color?: string
  accent?: string
}

export class Bike {
  readonly root: TransformNode
  private readonly crankNode: TransformNode
  private readonly pedals: TransformNode[] = []
  private readonly wheels: TransformNode[] = []
  /** the fork, front wheel, stem and bar: turned about the head tube's own axis by `steer` */
  private readonly steerNode: TransformNode
  private readonly steerAxis: Vector3
  private readonly mats: StandardMaterial[] = []
  private wheelAngle = 0

  readonly fit: BikeFit

  constructor(scene: Scene, fit: BikeFit, opts: BikeOptions = {}) {
    this.fit = fit
    const name = opts.name ?? 'bike'
    const k = fit.k
    this.root = new TransformNode(name, scene)
    const mat = (id: string, c: Color3, spec = 0.3, power = 32): StandardMaterial => {
      const m = new StandardMaterial(`${name}.${id}`, scene)
      m.diffuseColor = c
      m.specularColor = new Color3(spec, spec, spec)
      m.specularPower = power
      this.mats.push(m)
      return m
    }
    const frameMat = mat('frame', Color3.FromHexString(opts.color ?? '#ff4d6d'), 0.6, 64)
    const accentMat = mat('accent', Color3.FromHexString(opts.accent ?? '#ffffff'), 0.4, 48)
    const dark = mat('dark', new Color3(0.08, 0.08, 0.1), 0.15, 16)
    const metal = mat('metal', new Color3(0.72, 0.74, 0.78), 0.9, 96)
    const add = (m: Mesh, material: StandardMaterial, parent: TransformNode = this.root): Mesh => {
      m.material = material
      m.parent = parent
      return m
    }
    const tube = (id: string, a: Vector3, b: Vector3, r: number, material: StandardMaterial, parent?: TransformNode): Mesh =>
      add(MeshBuilder.CreateTube(`${name}.${id}`, { path: [a, b], radius: r, tessellation: 10, cap: Mesh.CAP_ALL }, scene), material, parent)

    const R = fit.wheelRadius
    const rear = new Vector3(0, R, fit.rearZ)
    const bb = fit.bb
    const seatDir = new Vector3(0, Math.sin(1.274), -Math.cos(1.274))
    const seatCluster = bb.add(seatDir.scale(Vector3.Distance(bb, fit.saddle) - 0.14 * k))
    const bar = new Vector3(0, fit.grip.y + 0.01 * k, fit.grip.z - 0.02 * k)
    const headTop = bar.add(new Vector3(0, -0.04 * k, -0.1 * k))
    const steer = new Vector3(0, -Math.sin(1.257), Math.cos(1.257))
    const tAxle = (headTop.y - R) / Math.sin(1.257)
    const front = headTop.add(steer.scale(tAxle)).add(new Vector3(0, 0, 0.045 * k))
    const headBottom = headTop.add(steer.scale(0.14 * k))
    // everything that turns with the bars pivots about the head tube's axis, through its top
    this.steerNode = new TransformNode(`${name}.steer`, scene)
    this.steerNode.parent = this.root
    this.steerNode.setPivotPoint(headTop)
    this.steerAxis = steer.scale(-1)
    const turns = this.steerNode

    // frame
    const fr = 0.022 * k
    tube('seatTube', bb, seatCluster, fr, frameMat)
    tube('topTube', seatCluster, headTop.add(steer.scale(0.02 * k)), fr * 0.9, frameMat)
    tube('downTube', bb, headBottom, fr * 1.15, frameMat)
    tube('headTube', headTop.add(steer.scale(-0.01 * k)), headBottom.add(steer.scale(0.01 * k)), fr * 1.2, accentMat)
    for (const sx of [-1, 1]) {
      const r = rear.add(new Vector3(sx * 0.065 * k, 0, 0))
      tube(`chainstay${sx}`, bb.add(new Vector3(sx * 0.03 * k, 0, 0)), r, fr * 0.55, frameMat)
      tube(`seatstay${sx}`, seatCluster.add(new Vector3(sx * 0.015 * k, 0, 0)), r, fr * 0.5, frameMat)
      const f = front.add(new Vector3(sx * 0.055 * k, 0, 0))
      tube(`fork${sx}`, headBottom.add(new Vector3(sx * 0.02 * k, 0, 0)), f, fr * 0.6, frameMat, turns)
    }
    // seatpost and saddle
    tube('seatpost', seatCluster, fit.saddle.add(new Vector3(0, -0.025 * k, 0.01 * k)), fr * 0.6, metal)
    const saddle = add(MeshBuilder.CreateSphere(`${name}.saddle`, { segments: 12, diameter: 1 }, scene), dark)
    saddle.scaling.set(0.085 * k, 0.045 * k, 0.26 * k)
    saddle.position.copyFrom(fit.saddle.add(new Vector3(0, -0.012 * k, 0.03 * k)))
    // stem and bars, grips at the rider's hands
    tube('stem', headTop, bar, fr * 0.7, metal, turns)
    const gx = fit.grip.x
    // a flat bar running out past the hands, with a grip under each palm
    const ext = 0.055 * k
    const barPath = [
      new Vector3(-gx - ext, fit.grip.y, fit.grip.z),
      new Vector3(-gx, fit.grip.y, fit.grip.z),
      new Vector3(-gx * 0.7, bar.y, bar.z - 0.005 * k),
      new Vector3(-gx * 0.3, bar.y, bar.z),
      new Vector3(gx * 0.3, bar.y, bar.z),
      new Vector3(gx * 0.7, bar.y, bar.z - 0.005 * k),
      new Vector3(gx, fit.grip.y, fit.grip.z),
      new Vector3(gx + ext, fit.grip.y, fit.grip.z),
    ]
    add(MeshBuilder.CreateTube(`${name}.bar`, { path: barPath, radius: 0.012 * k, tessellation: 10, cap: Mesh.CAP_ALL }, scene), metal, turns)
    for (const sx of [-1, 1]) {
      const g = new Vector3(sx * gx, fit.grip.y, fit.grip.z)
      tube(`grip${sx}`, g.add(new Vector3(-0.045 * k, 0, 0)), g.add(new Vector3(0.05 * k, 0, 0)), 0.016 * k, dark, turns)
    }

    // wheels
    for (const [id, c] of [['rear', rear], ['front', front]] as const) {
      const w = new TransformNode(`${name}.${id}Wheel`, scene)
      w.parent = id === 'front' ? this.steerNode : this.root
      w.position.copyFrom(c)
      const tire = add(MeshBuilder.CreateTorus(`${name}.${id}Tire`, { diameter: 2 * R - 0.03 * k, thickness: 0.036 * k, tessellation: 40 }, scene), dark, w)
      tire.rotation.z = Math.PI / 2
      const rim = add(MeshBuilder.CreateTorus(`${name}.${id}Rim`, { diameter: 2 * R - 0.075 * k, thickness: 0.016 * k, tessellation: 40 }, scene), accentMat, w)
      rim.rotation.z = Math.PI / 2
      const hub = add(MeshBuilder.CreateCylinder(`${name}.${id}Hub`, { diameter: 0.04 * k, height: 0.1 * k, tessellation: 12 }, scene), metal, w)
      hub.rotation.z = Math.PI / 2
      const spokes: Mesh[] = []
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        const tip = new Vector3(0, Math.cos(a), Math.sin(a)).scale(R - 0.04 * k)
        spokes.push(MeshBuilder.CreateTube(`${name}.spoke`, { path: [new Vector3(0, 0, 0), tip], radius: 0.0035 * k, tessellation: 4 }, scene))
      }
      const merged = Mesh.MergeMeshes(spokes, true)
      if (merged) add(merged, metal, w)
      this.wheels.push(w)
    }

    // crankset
    const ring = add(MeshBuilder.CreateCylinder(`${name}.ring`, { diameter: 0.19 * k, height: 0.008 * k, tessellation: 28 }, scene), metal)
    ring.rotation.z = Math.PI / 2
    ring.position.copyFrom(bb.add(new Vector3(0.05 * k, 0, 0)))
    tube('chain', bb.add(new Vector3(0.05 * k, 0.095 * k, 0)), rear.add(new Vector3(0.05 * k, 0.05 * k, 0)), 0.005 * k, dark)
    tube('chain2', bb.add(new Vector3(0.05 * k, -0.095 * k, 0)), rear.add(new Vector3(0.05 * k, -0.05 * k, 0)), 0.005 * k, dark)
    this.crankNode = new TransformNode(`${name}.crank`, scene)
    this.crankNode.parent = this.root
    this.crankNode.position.copyFrom(bb)
    tube('axle', new Vector3(-fit.qFactor + 0.03 * k, 0, 0), new Vector3(fit.qFactor - 0.03 * k, 0, 0), 0.012 * k, metal, this.crankNode)
    for (const sx of [-1, 1]) {
      // right crank points up at angle 0; left is opposite
      const up = sx > 0 ? 1 : -1
      const x = sx * (fit.qFactor - 0.035 * k)
      tube(`crank${sx}`, new Vector3(x, 0, 0), new Vector3(x, up * fit.crank, 0), 0.011 * k, metal, this.crankNode)
      const pedal = new TransformNode(`${name}.pedalNode${sx}`, scene)
      pedal.parent = this.crankNode
      pedal.position.set(sx * fit.qFactor, up * fit.crank, 0)
      const box = add(MeshBuilder.CreateBox(`${name}.pedal${sx}`, { width: 0.09 * k, height: 0.018 * k, depth: 0.075 * k }, scene), dark, pedal)
      box.position.x = sx * 0.01 * k
      this.pedals.push(pedal)
    }
  }

  /** crank: the rider's crank angle; distance: metres travelled since last call (spins the wheels). */
  update(crank: number, distance: number): void {
    // our crank angle is measured from the top toward +Z, the way a rotation about +X by +a turns +Y
    this.crankNode.rotation.x = crank
    for (const p of this.pedals) p.rotation.x = -crank
    this.wheelAngle = (this.wheelAngle + distance / this.fit.wheelRadius) % (Math.PI * 2)
    for (const w of this.wheels) w.rotation.x = this.wheelAngle
  }

  /**
   * Turn the bars: `angle` radians, positive to the rider's RIGHT (as a positive yaw turns +z towards +x in Babylon's
   * left-handed frame — the same sense as a heading growing clockwise),
   * about the head tube's own raked axis — the fork, the front wheel, the stem, the bar and the grips together.
   * The hands are the avatar's; at the few degrees a moving bike steers they stay on the grips.
   */
  steer(angle: number): void {
    this.steerNode.rotationQuaternion = Quaternion.RotationAxis(this.steerAxis, angle)
  }

  setEnabled(on: boolean): void {
    this.root.setEnabled(on)
  }

  getMeshes(): Mesh[] {
    return this.root.getChildMeshes(false) as Mesh[]
  }

  dispose(): void {
    this.root.dispose()
    for (const m of this.mats) m.dispose()
  }
}
