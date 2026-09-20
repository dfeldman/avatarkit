/**
 * Moving focus with four directions, for a d-pad or the arrow keys.
 *
 * The console has the same geometry in consoles/web/src/focus.ts, and the two are deliberately separate: the
 * avatar kit depends on nothing but Babylon, and a game embedding it should not have to pull in the platform's
 * console to let someone drive the designer with a remote. The picker is forty lines of pure arithmetic with
 * its own test either side; if a third caller turns up, that is the time to give it a home of its own.
 *
 * The other reason this exists at all: the designer lives in a shadow root, and the console's picker walks
 * `document` and reads `document.activeElement`, neither of which sees inside one.
 */
export type Dir = 'up' | 'down' | 'left' | 'right'
export interface Rect { x: number; y: number; w: number; h: number }

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])'

/**
 * Index of the best candidate in direction `dir` from `from`, or -1. A candidate must lie past `from`'s
 * centre on the axis of travel; the nearest edge distance wins, with sideways offset penalised (lightly
 * when the two overlap on the cross axis, heavily when they do not) so a column stays a column.
 */
export function pickNext(from: Rect, candidates: Rect[], dir: Dir): number {
  const fc = { x: from.x + from.w / 2, y: from.y + from.h / 2 }
  let best = -1
  let bestScore = Infinity
  candidates.forEach((c, i) => {
    const cc = { x: c.x + c.w / 2, y: c.y + c.h / 2 }
    let primary: number
    let cross: number
    let overlap: boolean
    if (dir === 'down' || dir === 'up') {
      if (dir === 'down' ? cc.y <= fc.y + 1 : cc.y >= fc.y - 1) return
      primary = dir === 'down' ? Math.max(0, c.y - (from.y + from.h)) : Math.max(0, from.y - (c.y + c.h))
      cross = Math.abs(cc.x - fc.x)
      overlap = c.x < from.x + from.w && c.x + c.w > from.x
    } else {
      if (dir === 'right' ? cc.x <= fc.x + 1 : cc.x >= fc.x - 1) return
      primary = dir === 'right' ? Math.max(0, c.x - (from.x + from.w)) : Math.max(0, from.x - (c.x + c.w))
      cross = Math.abs(cc.y - fc.y)
      overlap = c.y < from.y + from.h && c.y + c.h > from.y
    }
    const score = primary + cross * (overlap ? 0.5 : 3)
    if (score < bestScore) { bestScore = score; best = i }
  })
  return best
}

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, w: r.width, h: r.height }
}

/** Reachable: on screen, not hidden, not disabled, and not tucked inside a closed foldout. */
function reachable(el: Element): boolean {
  if ((el as HTMLElement).hidden || el.getAttribute('aria-hidden') === 'true') return false
  if ((el as HTMLButtonElement).disabled) return false
  const r = el.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return false
  const cs = getComputedStyle(el)
  return cs.visibility !== 'hidden' && cs.display !== 'none'
}

export function focusables(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(reachable)
}

/** The focused element as the shadow root sees it (document.activeElement stops at the host). */
export function activeIn(root: Element): HTMLElement | null {
  const a = (root.getRootNode() as Document | ShadowRoot).activeElement
  return a instanceof HTMLElement && root.contains(a) ? a : null
}

/** Move focus one step in `dir`, or onto the first control when nothing inside is focused. */
export function moveFocus(dir: Dir, root: Element): HTMLElement | null {
  const items = focusables(root)
  if (!items.length) return null
  const cur = activeIn(root)
  let next: HTMLElement | null
  if (!cur || !items.includes(cur)) {
    next = items[0]!
  } else {
    const others = items.filter((e) => e !== cur)
    const i = pickNext(rectOf(cur), others.map(rectOf), dir)
    next = i >= 0 ? others[i]! : null
  }
  if (next) {
    next.focus({ preventScroll: true })
    next.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  return next
}
