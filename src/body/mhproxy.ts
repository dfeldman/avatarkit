/**
 * MakeHuman proxies — hair, eyebrows, eyelashes, clothes and shoes (tools/mkmhproxies.mjs): meshes fitted to the
 * base mesh by MakeHuman's own method, skinned by the base mesh's weights, and (clothes, shoes) hiding the body
 * vertices they cover.
 */
import type { ProxyFit } from './mhbody.ts'

/** ('body': MakeHuman's low-poly bodies, male1591 and female1605, drawn instead of the full body at low quality) */
export type ProxyKind = 'hair' | 'eyebrows' | 'eyelashes' | 'clothes' | 'body' | 'teeth' | 'tongue'

export interface MhProxy extends ProxyFit {
  kind: ProxyKind
  id: string
  /** 2 per vertex */
  uv: number[]
  tris: number[]
  /** clothes: simplified triangle lists over the same vertices, for the lower qualities (tools/mkmhassets.mjs) */
  lods?: Partial<Record<'medium' | 'low', number[]>>
  /** base-mesh vertices this proxy hides (MakeHuman's delete_verts) */
  deleteVerts: number[]
  /** clothes: the designer slot (tools/wardrobe.tsv), which also sets the layer it is worn in */
  slot?: string
  /** MakeHuman's draw order hint (lower draws first) */
  zDepth: number
  /** texture: a path under public/mh/ (see assetUrl) */
  material: {
    texture: string | null
    /** clothes: a tangent-space normal map (fabric relief), when the garment has one */
    normal?: string | null
    transparent: boolean
    backfaceCull: boolean
    color: string
    /** clothes: the garment's own colour (the median of its texture), worn when no colour is chosen */
    baseColor?: string | null
    /** clothes: the texture is neutral detail that any colour recolours (false: patterned, worn as photographed) */
    tintable?: boolean
  }
}
