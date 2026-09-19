/**
 * Facial expressions: named mixes of MakeHuman's expression units (src/body/mhmodifiers.ts EXPRESSION_UNITS), each
 * 0..1, played as morph targets on the face. A game sets one at a strength (`avatar.setExpression('effort', 0.7)`,
 * say from the rider's power) or mixes units itself; blinking runs on its own on top.
 */
import type { ExpressionUnit } from '../body/mhmodifiers.ts'

export type ExpressionWeights = Partial<Record<ExpressionUnit, number>>

const both = (l: ExpressionUnit, r: ExpressionUnit, w: number): ExpressionWeights => ({ [l]: w, [r]: w })

export const EXPRESSIONS = {
  neutral: {},
  /** a gentle closed-mouth smile; the cheeks lift a little */
  smile: { 'mouth-corner-puller': 0.8, ...both('eye-left-slit', 'eye-right-slit', 0.2) },
  /** a broad open smile */
  happy: { 'mouth-corner-puller': 1, 'mouth-open': 0.25, ...both('eye-left-slit', 'eye-right-slit', 0.35), ...both('eyebrows-left-up', 'eyebrows-right-up', 0.2) },
  sad: { 'mouth-depression': 0.8, ...both('eyebrows-left-inner-up', 'eyebrows-right-inner-up', 0.8), ...both('eye-left-slit', 'eye-right-slit', 0.15) },
  surprised: { 'mouth-open': 0.55, ...both('eyebrows-left-up', 'eyebrows-right-up', 1), ...both('eye-left-opened-up', 'eye-right-opened-up', 0.8) },
  angry: { ...both('eyebrows-left-down', 'eyebrows-right-down', 0.9), 'mouth-retraction': 0.35, ...both('nose-left-elevation', 'nose-right-elevation', 0.4), ...both('eye-left-slit', 'eye-right-slit', 0.3) },
  /** pushing hard: squint, brows down, teeth bared, nose wrinkled (for an exergame's effort) */
  effort: { ...both('eye-left-slit', 'eye-right-slit', 0.6), ...both('eyebrows-left-down', 'eyebrows-right-down', 0.6), 'mouth-retraction': 0.7, 'mouth-open': 0.15, ...both('nose-left-elevation', 'nose-right-elevation', 0.45) },
  /** breathing hard with the mouth open */
  panting: { 'mouth-open': 0.6, ...both('eyebrows-left-inner-up', 'eyebrows-right-inner-up', 0.4), ...both('eye-left-slit', 'eye-right-slit', 0.2) },
  wink: { 'eye-left-closure': 1, 'mouth-corner-puller': 0.5 },
  kiss: { 'mouth-pursing': 1 },
} satisfies Record<string, ExpressionWeights>

export type ExpressionName = keyof typeof EXPRESSIONS

/** A named expression at a strength (0..1), or unit weights as given, clamped. */
export function expressionWeights(e: ExpressionName | ExpressionWeights, strength = 1): ExpressionWeights {
  const src: ExpressionWeights = typeof e === 'string' ? EXPRESSIONS[e] ?? {} : e
  const s = Math.max(0, Math.min(1, strength))
  const out: ExpressionWeights = {}
  for (const [u, w] of Object.entries(src) as Array<[ExpressionUnit, number]>) out[u] = Math.max(0, Math.min(1, w * s))
  return out
}

/**
 * Blinking: every 2–6 seconds (sometimes twice), about a fifth of a second, closing fastest. Returns how closed the
 * eyes are (0..1) at time t.
 */
export class Blinker {
  private next = 1 + Math.random() * 3
  private t = 0
  private start = -1
  update(dt: number): number {
    this.t += dt
    if (this.start < 0 && this.t >= this.next) {
      this.start = this.t
      this.next = this.t + (Math.random() < 0.15 ? 0.35 : 2 + Math.random() * 4)
    }
    if (this.start < 0) return 0
    const u = (this.t - this.start) / 0.2
    if (u >= 1) { this.start = -1; return 0 }
    // shut quickly (a third of the blink), open more slowly
    return u < 0.33 ? u / 0.33 : 1 - (u - 0.33) / 0.67
  }
}
