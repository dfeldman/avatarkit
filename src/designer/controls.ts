/** Small DOM builders for the designer. Each control registers a sync() so the UI can follow the spec. */

export type Sync = () => void

type Props<K extends keyof HTMLElementTagNameMap> = Omit<Partial<HTMLElementTagNameMap[K]>, 'dataset'> & { class?: string; dataset?: Record<string, string> }

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props<K> = {} as Props<K>, ...children: Array<Node | string | null | undefined>): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  const { class: cls, dataset, ...rest } = props
  if (cls) e.className = cls
  if (dataset) Object.assign(e.dataset, dataset)
  Object.assign(e, rest)
  for (const c of children) if (c !== null && c !== undefined) e.append(c)
  return e
}

/** Whether an element has focus (document.activeElement stops at a shadow root's host). */
export function hasFocus(e: Element): boolean {
  return (e.getRootNode() as Document | ShadowRoot).activeElement === e
}

export function card(title: string, ...children: Array<Node | null>): { root: HTMLElement; value: HTMLElement } {
  const value = el('span', { class: 'val' })
  const root = el('section', { class: 'card' }, el('h3', {}, el('span', { textContent: title }), value), ...children)
  return { root, value }
}

export interface SliderOpts {
  label: string
  min: number
  max: number
  step: number
  get: () => number
  /** live: while dragging; commit: on release */
  set: (v: number, commit: boolean) => void
  format: (v: number) => string
}

export function slider(o: SliderOpts, syncs: Sync[]): HTMLElement {
  const id = `s${Math.random().toString(36).slice(2, 8)}`
  const input = el('input', { type: 'range', id, min: String(o.min), max: String(o.max), step: String(o.step) })
  const out = el('output')
  out.setAttribute('for', id)
  const paint = (): void => {
    const v = Number(input.value)
    input.style.setProperty('--fill', `${((v - o.min) / (o.max - o.min)) * 100}%`)
    out.textContent = o.format(v)
  }
  input.addEventListener('input', () => {
    paint()
    o.set(Number(input.value), false)
  })
  input.addEventListener('change', () => o.set(Number(input.value), true))
  syncs.push(() => {
    if (hasFocus(input) && input.matches(':active')) return
    input.value = String(o.get())
    paint()
  })
  return el('div', { class: 'slider' }, el('div', { class: 'row' }, el('label', { htmlFor: id, textContent: o.label }), out), input)
}

export function swatches(colors: readonly string[], get: () => string, set: (c: string) => void, syncs: Sync[], names?: Record<string, string>): HTMLElement {
  const wrap = el('div', { class: 'swatches', role: 'group' })
  const buttons = colors.map((c) => {
    const b = el('button', { class: 'swatch', type: 'button', title: names?.[c] ?? c })
    b.style.background = c
    b.setAttribute('aria-label', names?.[c] ?? c)
    b.addEventListener('click', () => set(c))
    wrap.append(b)
    return b
  })
  const custom = el('input', { type: 'color' })
  custom.addEventListener('input', () => set(custom.value))
  const customBtn = el('label', { class: 'swatch custom', title: 'Any colour' }, custom)
  wrap.append(customBtn)
  syncs.push(() => {
    const cur = get().toLowerCase()
    let matched = false
    buttons.forEach((b, i) => {
      const on = colors[i].toLowerCase() === cur
      matched ||= on
      b.setAttribute('aria-pressed', String(on))
    })
    customBtn.setAttribute('aria-pressed', String(!matched))
    customBtn.style.boxShadow = matched ? '' : `0 0 0 3px var(--accent), inset 0 0 0 12px ${cur}`
    if (!hasFocus(custom)) custom.value = cur
  })
  return wrap
}

export interface ChipOption<T extends string> {
  value: T
  label: string
  glyph?: string | (() => Node)
}

export function chips<T extends string>(options: ChipOption<T>[], get: () => T, set: (v: T) => void, syncs: Sync[], wide = false): HTMLElement {
  const wrap = el('div', { class: wide ? 'chips wide' : 'chips', role: 'group' })
  const items = options.map((o) => {
    const b = el('button', { class: 'chip', type: 'button' })
    const glyph = typeof o.glyph === 'function' ? o.glyph() : o.glyph ? el('span', { class: 'glyph', textContent: o.glyph }) : null
    if (glyph) b.append(glyph)
    b.append(el('span', { textContent: o.label }))
    b.addEventListener('click', () => set(o.value))
    wrap.append(b)
    return { b, o }
  })
  syncs.push(() => {
    const cur = get()
    for (const { b, o } of items) b.setAttribute('aria-pressed', String(o.value === cur))
  })
  return wrap
}

export function toggle(label: string, get: () => boolean, set: (v: boolean) => void, syncs: Sync[]): HTMLElement {
  const b = el('button', { class: 'toggle', type: 'button' }, el('span', { class: 'knob' }), el('span', { textContent: label }))
  b.addEventListener('click', () => set(!get()))
  syncs.push(() => b.setAttribute('aria-pressed', String(get())))
  return b
}
