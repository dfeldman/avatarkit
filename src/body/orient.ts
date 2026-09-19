/** Triangle winding for Babylon. */

/**
 * Makes every triangle face the way the surface does at its corners (Babylon's front faces wind clockwise;
 * MakeHuman's meshes wind the other way).
 */
export function orientByNormals(positions: Float32Array, normals: Float32Array, indices: Uint32Array): number {
  const P = positions, N = normals
  let fixed = 0
  for (let t = 0; t < indices.length; t += 3) {
    const a = 3 * indices[t], b = 3 * indices[t + 1], c = 3 * indices[t + 2]
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2]
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const sx = N[a] + N[b] + N[c], sy = N[a + 1] + N[b + 1] + N[c + 1], sz = N[a + 2] + N[b + 2] + N[c + 2]
    if (nx * sx + ny * sy + nz * sz > 0) {
      const tmp = indices[t + 1]
      indices[t + 1] = indices[t + 2]
      indices[t + 2] = tmp
      fixed++
    }
  }
  return fixed
}
