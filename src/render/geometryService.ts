/**
 * Geometry off the main thread. `request` resolves with geometry for a spec. By default every request is built
 * in turn (a game loading its players); with `latest: true` a newer request replaces any queued ones (a dragged
 * slider only builds its latest value) and the replaced ones resolve with null. Falls back to building on the
 * main thread when workers aren't available.
 *
 * A build that fails rejects, so a caller can tell "nothing to draw yet" (null: superseded) from "this avatar
 * cannot be built" and say so; the failure is never silent.
 */
import { assetBase, assetManifest } from '../body/mhassets.ts'
import { buildAvatarGeometry, preloadAssets, type AvatarGeometry, type Quality } from '../body/build.ts'
import { shapeKey, type AvatarSpec } from '../spec.ts'

interface Pending {
  key: string
  spec: AvatarSpec
  quality: Quality
  resolve: (g: AvatarGeometry | null) => void
  reject: (err: Error) => void
}

export class GeometryService {
  private worker: Worker | null = null
  private busy = false
  /** The asset manifest the worker was last given (it keeps it). */
  private sentManifest: Record<string, string> | null = null
  private queue: Pending[] = []
  private inflight: Pending | null = null
  private nextId = 1
  private readonly cache = new Map<string, AvatarGeometry>()

  constructor() {
    try {
      this.worker = new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (e: MessageEvent<{ id: number; geometry?: AvatarGeometry; error?: string }>) => this.done(e.data.geometry ?? null, e.data.error)
      // A worker that fails (a browser without module workers, a blocked or broken script) drops the kit to the
      // main thread. The request it was carrying goes back to the front of the queue: losing it would leave the
      // avatar that asked for it blank until something else asked again.
      this.worker.onerror = (e: ErrorEvent | Event) => {
        this.worker = null
        const why = (e as ErrorEvent).message || 'the worker failed to start'
        console.warn(`avatar geometry: ${why}; building on the main thread instead`)
        const p = this.inflight
        this.inflight = null
        this.busy = false
        if (p) this.queue.unshift(p)
        this.pump()
      }
    } catch {
      this.worker = null
    }
  }

  static key(spec: AvatarSpec, quality: Quality): string {
    return `${quality}|${shapeKey(spec)}`
  }

  cached(spec: AvatarSpec, quality: Quality): AvatarGeometry | undefined {
    return this.cache.get(GeometryService.key(spec, quality))
  }

  /** Resolves with the geometry, or null if a newer request superseded this one. */
  request(spec: AvatarSpec, quality: Quality, opts: { latest?: boolean } = {}): Promise<AvatarGeometry | null> {
    const key = GeometryService.key(spec, quality)
    const hit = this.cache.get(key)
    if (hit) return Promise.resolve(hit)
    return new Promise((resolve, reject) => {
      const p: Pending = { key, spec: JSON.parse(JSON.stringify(spec)) as AvatarSpec, quality, resolve, reject }
      const same = this.inflight?.key === key ? this.inflight : this.queue.find((q) => q.key === key)
      if (same) {
        const prev = same.resolve
        same.resolve = (g) => {
          prev(g)
          resolve(g)
        }
        const prevReject = same.reject
        same.reject = (e) => {
          prevReject(e)
          reject(e)
        }
        return
      }
      if (opts.latest) {
        for (const q of this.queue) q.resolve(null)
        this.queue = []
      }
      this.queue.push(p)
      this.pump()
    })
  }

  private pump(): void {
    if (this.busy || this.queue.length === 0) return
    const p = this.queue.shift()!
    this.inflight = p
    this.busy = true
    if (this.worker) {
      // (a worker can't see the page's address, so it is told where the MakeHuman assets are)
      let base: string | undefined
      try { base = assetBase() } catch { base = undefined }
      // (and the asset manifest, once: it is a few thousand entries)
      const manifest = assetManifest()
      const fresh = manifest && manifest !== this.sentManifest ? manifest : undefined
      if (fresh) this.sentManifest = fresh
      this.worker.postMessage({ id: this.nextId++, spec: p.spec, quality: p.quality, assetBase: base, manifest: fresh })
    } else {
      // no worker: load the assets and build on the main thread, letting the UI paint first
      preloadAssets(p.spec, p.quality).then(() => new Promise((r) => setTimeout(r, 0))).then(() => {
        try {
          this.done(buildAvatarGeometry(p.spec, p.quality))
        } catch (err) {
          this.done(null, String(err))
        }
      }, (err) => this.done(null, String(err)))
    }
  }

  private done(g: AvatarGeometry | null, error?: string): void {
    const p = this.inflight
    this.inflight = null
    this.busy = false
    if (p && error) {
      // (the caller shows it; the log keeps the cause where a caller only reports "couldn't build")
      console.warn('avatar geometry:', error)
      p.reject(new Error(error))
      this.pump()
      return
    }
    if (error) console.warn('avatar geometry:', error)
    if (p && g) {
      this.cache.set(p.key, g)
      if (this.cache.size > 40) this.cache.delete(this.cache.keys().next().value as string)
    }
    p?.resolve(g)
    this.pump()
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
  }
}
