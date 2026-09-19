/**
 * The engine for our own pages (the dev stage, the designer, the gallery; a game brings its own): WebGPU where the
 * browser has it, WebGL2 otherwise. `?engine=webgl` on the page's URL forces WebGL2, to compare the two;
 * `?gpulimits=default` keeps WebGPU's minimum limits (as on the weakest devices).
 * Everything else asks the engine what it can do (subsurface scattering, for one, needs the pre-pass renderer)
 * rather than which kind it is.
 */
import { Engine, WebGPUEngine, type AbstractEngine } from '@babylonjs/core'
import type { Quality } from '../body/build.ts'

export interface EngineOptions {
  /** a transparent canvas, so the page shows through (the designer) */
  alpha?: boolean
}

export async function createEngine(canvas: HTMLCanvasElement, opts: EngineOptions = {}): Promise<AbstractEngine> {
  const forced = new URLSearchParams(location.search).get('engine')
  if (forced !== 'webgl' && (await WebGPUEngine.IsSupportedAsync)) {
    try {
      const engine = new WebGPUEngine(canvas, {
        antialias: true, stencil: true, adaptToDeviceRatio: true,
        // the device's own limits, not WebGPU's minimums: the skin's pre-pass writes several colour targets at
        // once (34 bytes a pixel with ambient occlusion; the default allows 32)
        // (`?gpulimits=default` keeps the minimums, as the weakest devices have: to test the fallbacks)
        setMaximumLimits: new URLSearchParams(location.search).get('gpulimits') !== 'default',
        // (a see-through canvas composites premultiplied under WebGPU; the stage clears to transparent black)
        ...(opts.alpha ? { premultipliedAlpha: true } : {}),
      })
      await engine.initAsync()
      return engine
    } catch (e) {
      console.warn('WebGPU failed to start; using WebGL2', e)
    }
  }
  return new Engine(canvas, true, {
    preserveDrawingBuffer: true, stencil: true, antialias: true,
    ...(opts.alpha ? { alpha: true, premultipliedAlpha: false } : {}),
  }, true)
}

/** Which kind of engine this is, for a page's diagnostics. */
export const engineName = (engine: AbstractEngine): string => (engine.isWebGPU ? 'WebGPU' : `WebGL${(engine as Engine).webGLVersion ?? ''}`)

/** Bytes per pixel the engine's colour targets may add up to in one pass (WebGPU limits this; WebGL2 does not). */
export function colorBytesPerSample(engine: AbstractEngine): number {
  return engine.isWebGPU ? ((engine as WebGPUEngine).currentLimits?.maxColorAttachmentBytesPerSample ?? 32) : Infinity
}

/**
 * A starting quality for this device (a game may know better, and `?q=` overrides it on our pages): phones and
 * tablets, and GPUs held to WebGPU's minimum limits, get medium; desktops high. Low is for crowds: a game asks for it
 * when it shows several avatars at once on a phone.
 */
export function suggestQuality(engine: AbstractEngine): Quality {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('q') : null
  if (q === 'low' || q === 'medium' || q === 'high') return q
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const touch = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1
  if (/iPhone|iPad|Android|Mobile/.test(ua) || (touch && /Macintosh/.test(ua)) || colorBytesPerSample(engine) <= 32) return 'medium'
  return 'high'
}
