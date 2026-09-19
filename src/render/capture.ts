/**
 * The frame the engine's own render loop draws next, as a canvas (for tools and tests of the look). Read inside that
 * frame: under WebGPU the swap chain's texture is gone once the frame is presented, so rendering an extra frame by
 * hand and reading it back fails. WebGPU reads back BGRA, top row first; WebGL RGBA, bottom row first.
 */
import type { Scene } from '@babylonjs/core'

export function captureFrame(scene: Scene): Promise<HTMLCanvasElement> {
  const engine = scene.getEngine()
  return new Promise((resolve, reject) => {
    // (a hidden page's render loop may be paused: then draw the frame here, with nothing to collide with)
    // (inside a frame of its own: under WebGPU a render outside one draws nothing that can be read back)
    const nudge = setTimeout(() => { engine.beginFrame(); scene.render(); engine.endFrame() }, 300)
    scene.onAfterRenderObservable.addOnce(() => {
      clearTimeout(nudge)
      const W = engine.getRenderWidth(), H = engine.getRenderHeight()
      engine.readPixels(0, 0, W, H).then((view) => {
        const px = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
        const img = new ImageData(W, H)
        const row = W * 4
        for (let r = 0; r < H; r++) {
          const from = engine.isWebGPU ? r : H - 1 - r
          img.data.set(px.subarray(from * row, (from + 1) * row), r * row)
        }
        if (engine.isWebGPU) for (let i = 0; i < img.data.length; i += 4) { const t = img.data[i]; img.data[i] = img.data[i + 2]; img.data[i + 2] = t }
        const c = document.createElement('canvas')
        c.width = W
        c.height = H
        c.getContext('2d')!.putImageData(img, 0, 0)
        resolve(c)
      }, reject)
    })
  })
}
