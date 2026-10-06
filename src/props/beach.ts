/**
 * BEACH PROPS (Street Runner's Ocean Beach, 2026-10-06: "beach umbrellas and towels … we'll need this for other beach
 * scenes in the future"): a towel, a beach umbrella and a low sling chair, each sized for the kit's bodies.
 *
 * Plain geometry (positions, normals, colours, indices), no Babylon, so a game can merge it, thin-instance it or
 * run it under its own material; `propMesh` makes a Babylon mesh of one for anyone who just wants to place it. Every
 * prop stands on y = 0 at its origin. Colours are baked into the vertices, so a scene makes a few variants and
 * instances them.
 *
 *  - towel:    1.7 × 0.8 m, laid along z, a hand's thickness, stripes across it, a gentle rumple;
 *  - umbrella: a pole to ~2.2 m and a canopy of alternating panels, a scalloped valance round its rim; leaned by the
 *              scene towards the sun;
 *  - chair:    a low aluminium sling chair facing −z, its back reclined.
 */
import { Mesh, VertexData, type Scene } from '@babylonjs/core'

export type Rgb = readonly [number, number, number]

export interface PropGeometry { positions: number[]; normals: number[]; colors: number[]; indices: number[] }

class Builder implements PropGeometry {
  positions: number[] = []
  normals: number[] = []
  colors: number[] = []
  indices: number[] = []
  vertex(x: number, y: number, z: number, n: readonly number[], c: Rgb): number {
    this.positions.push(x, y, z)
    this.normals.push(n[0], n[1], n[2])
    this.colors.push(c[0], c[1], c[2], 1)
    return this.positions.length / 3 - 1
  }
  /** a quad a, b, c, d, counter-clockwise seen from where it faces (its normal by the right-hand rule); `both`: its back as well */
  quad(a: number[], b: number[], c: number[], d: number[], col: Rgb, both = false, back?: Rgb): void {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]]
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const L = Math.hypot(n[0], n[1], n[2]) || 1
    n = n.map((x) => x / L)
    const i = this.vertex(a[0], a[1], a[2], n, col), j = this.vertex(b[0], b[1], b[2], n, col)
    const k = this.vertex(c[0], c[1], c[2], n, col), l = this.vertex(d[0], d[1], d[2], n, col)
    // (wound clockwise as seen from its front: Babylon's left-handed default culls the other way round)
    this.indices.push(i, k, j, i, l, k)
    if (both) {
      const bn = n.map((x) => -x), bc = back ?? col
      const i2 = this.vertex(a[0], a[1], a[2], bn, bc), j2 = this.vertex(b[0], b[1], b[2], bn, bc)
      const k2 = this.vertex(c[0], c[1], c[2], bn, bc), l2 = this.vertex(d[0], d[1], d[2], bn, bc)
      this.indices.push(i2, j2, k2, i2, k2, l2)
    }
  }
  /** an upright prism of `sides` from y0 to y1 at (x, z) */
  pole(x: number, z: number, y0: number, y1: number, r: number, col: Rgb, sides = 6): void {
    for (let s = 0; s < sides; s++) {
      const a0 = (s / sides) * Math.PI * 2, a1 = ((s + 1) / sides) * Math.PI * 2
      const p = (a: number, y: number): number[] => [x + Math.cos(a) * r, y, z + Math.sin(a) * r]
      this.quad(p(a0, y0), p(a0, y1), p(a1, y1), p(a1, y0), col)
    }
  }
  /** a slim strut between two points, square in section */
  strut(a: number[], b: number[], w: number, col: Rgb): void {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const L = Math.hypot(d[0], d[1], d[2]) || 1
    const t = d.map((x) => x / L)
    const up = Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]
    let s = [t[1] * up[2] - t[2] * up[1], t[2] * up[0] - t[0] * up[2], t[0] * up[1] - t[1] * up[0]]
    const sl = Math.hypot(s[0], s[1], s[2]); s = s.map((x) => (x / sl) * w)
    let u = [t[1] * s[2] - t[2] * s[1], t[2] * s[0] - t[0] * s[2], t[0] * s[1] - t[1] * s[0]]
    const ul = Math.hypot(u[0], u[1], u[2]); u = u.map((x) => (x / ul) * w)
    const c = (p: number[], i: number, j: number): number[] => [p[0] + s[0] * i + u[0] * j, p[1] + s[1] * i + u[1] * j, p[2] + s[2] * i + u[2] * j]
    for (const [i0, j0, i1, j1] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
      this.quad(c(a, i0, j0), c(a, i1, j1), c(b, i1, j1), c(b, i0, j0), col)
    }
  }
}

/** A beach towel, laid along z, stripes across it. `seed` rumples it. */
export function towel(opts: { colors: readonly Rgb[]; length?: number; width?: number; stripes?: number; seed?: number }): PropGeometry {
  const b = new Builder()
  const L = opts.length ?? 1.7, W = opts.width ?? 0.8, S = opts.stripes ?? 7
  const cols = opts.colors.length ? opts.colors : [[0.9, 0.9, 0.9]] as Rgb[]
  const seed = opts.seed ?? 1
  const NX = 4, NZ = S * 2
  const h = (i: number, j: number): number => {
    const v = Math.sin(i * 12.9898 + j * 78.233 + seed * 3.17) * 43758.5453
    return (v - Math.floor(v)) * 0.012
  }
  for (let j = 0; j < NZ; j++) {
    const col = cols[Math.floor((j / NZ) * S) % cols.length]
    for (let i = 0; i < NX; i++) {
      const x0 = -W / 2 + (i / NX) * W, x1 = -W / 2 + ((i + 1) / NX) * W
      const z0 = -L / 2 + (j / NZ) * L, z1 = -L / 2 + ((j + 1) / NZ) * L
      b.quad([x0, 0.008 + h(i, j), z0], [x0, 0.008 + h(i, j + 1), z1], [x1, 0.008 + h(i + 1, j + 1), z1], [x1, 0.008 + h(i + 1, j), z0], col)
    }
  }
  return b
}

/** A beach umbrella: a pole and a canopy of `panels` alternating in `colors`, a scalloped valance round the rim. */
export function beachUmbrella(opts: { colors: readonly Rgb[]; radius?: number; height?: number; panels?: number }): PropGeometry {
  const b = new Builder()
  const R = opts.radius ?? 1.05, H = opts.height ?? 2.15, N = opts.panels ?? 8
  const cols = opts.colors.length ? opts.colors : [[0.9, 0.2, 0.2], [0.95, 0.95, 0.92]] as Rgb[]
  const POLE: Rgb = [0.92, 0.92, 0.9]
  b.pole(0, 0, -0.25, H + 0.32, 0.022, POLE)
  const rim = H - 0.05, mid = H + 0.16, apex = H + 0.3
  const shade = (c: Rgb): Rgb => [c[0] * 0.55, c[1] * 0.55, c[2] * 0.55]
  for (let s = 0; s < N; s++) {
    const col = cols[s % cols.length]
    const a0 = (s / N) * Math.PI * 2, a1 = ((s + 1) / N) * Math.PI * 2
    const at = (a: number, r: number, y: number): number[] => [Math.cos(a) * r, y, Math.sin(a) * r]
    // two rings: the panel bellies a little between its ribs
    b.quad(at(a0, R, rim), at(a0, R * 0.55, mid), at(a1, R * 0.55, mid), at(a1, R, rim), col, true, shade(col))
    b.quad(at(a0, R * 0.55, mid), at(a0, 0.02, apex), at(a1, 0.02, apex), at(a1, R * 0.55, mid), col, true, shade(col))
    // the valance: a short flap hanging from the rim, cut in a scallop
    const am = (a0 + a1) / 2
    b.quad(at(a0, R, rim - 0.01), at(a0, R, rim - 0.1), at(am, R, rim - 0.17), at(am, R, rim - 0.01), col, true, shade(col))
    b.quad(at(am, R, rim - 0.01), at(am, R, rim - 0.17), at(a1, R, rim - 0.1), at(a1, R, rim - 0.01), col, true, shade(col))
    // the rib under the seam
    b.strut(at(a0, 0.03, mid - 0.02), at(a0, R * 0.98, rim - 0.02), 0.008, POLE)
  }
  // the finial
  b.pole(0, 0, apex, apex + 0.06, 0.03, POLE, 8)
  return b
}

/** A low sling beach chair, facing −z (a seated body's front), its back reclined. */
export function beachChair(opts: { color: Rgb }): PropGeometry {
  const b = new Builder()
  const FRAME: Rgb = [0.78, 0.79, 0.8]
  const W = 0.27, seatY = 0.22, backTop = 0.75
  // the legs and arms
  for (const x of [-W, W]) {
    b.strut([x, 0, -0.32], [x, seatY + 0.05, -0.28], 0.012, FRAME)
    b.strut([x, 0, 0.18], [x, seatY, 0.12], 0.012, FRAME)
    b.strut([x, seatY + 0.05, -0.28], [x, seatY, 0.12], 0.012, FRAME)
    b.strut([x, seatY, 0.12], [x, backTop, 0.42], 0.012, FRAME)
    b.strut([x, seatY + 0.2, -0.24], [x, seatY + 0.24, 0.2], 0.014, FRAME)
  }
  // the sling: the seat sagging a little, the back
  b.quad([-W, seatY + 0.04, -0.27], [-W, seatY - 0.02, 0.0], [W, seatY - 0.02, 0.0], [W, seatY + 0.04, -0.27], opts.color, true)
  b.quad([-W, seatY - 0.02, 0.0], [-W, seatY, 0.12], [W, seatY, 0.12], [W, seatY - 0.02, 0.0], opts.color, true)
  b.quad([-W, seatY, 0.12], [-W, backTop - 0.03, 0.41], [W, backTop - 0.03, 0.41], [W, seatY, 0.12], opts.color, true)
  return b
}

/** One prop as a Babylon mesh (vertex colours; give it a material that uses them). */
export function propMesh(scene: Scene, name: string, g: PropGeometry): Mesh {
  const m = new Mesh(name, scene)
  const vd = new VertexData()
  vd.positions = g.positions
  vd.normals = g.normals
  vd.colors = g.colors
  vd.indices = g.indices
  vd.applyToMesh(m)
  return m
}
