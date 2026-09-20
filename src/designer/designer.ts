/**
 * The avatar designer: live 3D preview on the left, tabbed controls on the right (stacked on phones), generated
 * from MakeHuman's own data: its macro variables, its modifier sliders (grouped and labelled as MakeHuman groups and
 * labels them), and its asset library (hair, eyebrows, eyelashes, eyes, clothes; public/mh/index.json).
 * mountDesigner() renders into a shadow root on the element it is given, so a host page (the console) can embed
 * it without either side's CSS leaking into the other. `onSave` receives the spec to store (the player's
 * profile); the designer itself stores nothing.
 */
import type { MotionMode } from '../anim/animator.ts'
import { assetUrl, credits, loadIndex, type AssetEntry } from '../body/mhassets.ts'
import { createEngine } from '../render/engine.ts'
import type { ExpressionName } from '../anim/expressions.ts'
import type { HandPose } from '../anim/hands.ts'
import { MOVES, type Move } from '../anim/moves.ts'
import type { AbstractEngine } from '@babylonjs/core'
import { loadModifierDefs, type ModifierDef } from '../body/mhmodifiers.ts'
import { randomSpec } from '../presets.ts'
import {
  EYE_MATERIALS, HAIR_COLORS, OUTFIT_COLORS, SKIN_TONES, cloneSpec, decodeSpec, encodeSpec, normalizeSpec,
  type AvatarSpec, type Macro,
} from '../spec.ts'
import { card, el, hasFocus, slider, swatches, type Sync } from './controls.ts'
import css from './designer.css?inline'
import { Preview } from './preview.ts'

export interface DesignerOptions {
  initial?: unknown
  onSave?: (spec: AvatarSpec) => void | Promise<void>
  title?: string
}

type TabId = 'body' | 'face' | 'shape' | 'hair' | 'clothes' | 'share'
const TABS: Array<{ id: TabId; label: string; ico: string }> = [
  { id: 'body', label: 'Body', ico: '🧍' },
  { id: 'face', label: 'Face', ico: '🙂' },
  { id: 'shape', label: 'Shape', ico: '📐' },
  { id: 'hair', label: 'Hair & eyes', ico: '💇' },
  { id: 'clothes', label: 'Clothes', ico: '👟' },
  { id: 'share', label: 'Share', ico: '🔗' },
]

/** MakeHuman's macro sliders, as it labels them. */
const MACRO_SLIDERS: Array<{ key: Macro; label: string; left: string; right: string }> = [
  { key: 'Gender', label: 'Gender', left: 'Female', right: 'Male' },
  { key: 'Muscle', label: 'Muscle', left: 'Minimum', right: 'Maximum' },
  { key: 'Weight', label: 'Weight', left: 'Minimum', right: 'Maximum' },
  { key: 'Height', label: 'Height', left: 'Short', right: 'Tall' },
  // (MakeHuman calls this "uncommon to ideal"; what it actually does is straighten or curve the silhouette)
  { key: 'BodyProportions', label: 'Proportions', left: 'Straight', right: 'Hourglass' },
  { key: 'BreastSize', label: 'Chest size', left: 'Small', right: 'Large' },
  { key: 'BreastFirmness', label: 'Chest firmness', left: 'Low', right: 'High' },
]
const ETHNIC: Macro[] = ['African', 'Asian', 'Caucasian']

type Slot = 'tops' | 'bottoms' | 'outfits' | 'shoes' | 'socks' | 'other'
const SLOTS: Array<{ id: Slot; label: string }> = [
  { id: 'tops', label: 'Tops' }, { id: 'bottoms', label: 'Bottoms' }, { id: 'outfits', label: 'Outfits' },
  { id: 'shoes', label: 'Shoes' }, { id: 'socks', label: 'Socks & legwear' }, { id: 'other', label: 'Hats, glasses & gloves' },
]
/** A garment's slot: the curated one from the index, else guessed from its MakeHuman tags and name. */
function slotOf(a: AssetEntry): Slot {
  if (a.slot && SLOTS.some((x) => x.id === a.slot)) return a.slot as Slot
  const t = `${a.id} ${a.tags.join(' ')}`.toLowerCase()
  if (/sock/.test(t)) return 'socks'
  if (/shoe|sneaker|boot|sandal|flat|maryjane|oxford|monk|heel|flip/.test(t)) return 'shoes'
  if (/suit|dress|gown|overall/.test(t)) return 'outfits'
  if (/pants|jean|short|trunk|trouser|harem|skirt/.test(t)) return 'bottoms'
  if (/fedora|hat|cap|helmet/.test(t)) return 'other'
  return 'tops'
}

const pretty = (id: string): string =>
  id.replace(/^(elvs|punkduck|toigo|mindfront|joepal|cortu|namuhekam|culturalibre|dressupdoc|callharvey3d|drednicolson|skalldyrssuppe|v0rt3x|matcreator|spamrakuen|maciekg|grinsegold|green_tomato|scailman|mtknife|frankyaye|rehmanpolanski|jaldmic|jujube|donitz|madmanny|wolgade|aethelraed|kwnet_at|marco_105|janexx|ews|wdg|scsouza|sonicteam998)_/, '')
    .replace(/[_-]+/g, ' ').replace(/\b(\d)$/, ' $1').replace(/^./, (c) => c.toUpperCase())

// MakeHuman models genitals and names things anatomically; a fitness game shows neither. These sliders are left
// out, and "breast" is called "chest" wherever MakeHuman's own labels come through.
const HIDDEN_MODIFIER = /^genitals\/|^pelvis\/bulge/
const chestly = (t: string): string => t.replace(/breasts?/gi, (m) => (m[0] === m[0].toUpperCase() ? 'Chest' : 'chest'))

export class Designer {
  spec: AvatarSpec
  readonly preview: Preview
  private readonly syncs: Sync[] = []
  private readonly sheets = new Map<TabId, HTMLElement>()
  private readonly tabButtons = new Map<TabId, HTMLButtonElement>()
  private undoStack: AvatarSpec[] = []
  private redoStack: AvatarSpec[] = []
  private tab: TabId = 'body'
  private readonly undoBtn: HTMLButtonElement
  private readonly redoBtn: HTMLButtonElement
  private readonly codeInput: HTMLInputElement
  private readonly toastEl: HTMLElement
  private readonly busyEl: HTMLElement
  private toastTimer = 0
  private readonly opts: DesignerOptions
  private readonly root: HTMLElement
  private readonly onKey = (e: KeyboardEvent): void => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
    // text fields keep their own undo (the target is retargeted to the host outside a shadow root)
    const t = e.composedPath()[0] as HTMLElement | undefined
    if (t?.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text') return
    if (t?.tagName === 'TEXTAREA' || t?.isContentEditable) return
    e.preventDefault()
    if (e.shiftKey) this.redo()
    else this.undo()
  }

  constructor(root: HTMLElement, opts: DesignerOptions, stageCanvas: HTMLCanvasElement, engine: AbstractEngine) {
    this.opts = opts
    this.root = root
    this.spec = normalizeSpec(opts.initial)
    root.classList.add('designer')

    // --- top bar
    this.undoBtn = el('button', { class: 'btn icon', type: 'button', title: 'Undo (Ctrl+Z)', textContent: '↶' })
    this.redoBtn = el('button', { class: 'btn icon', type: 'button', title: 'Redo (Ctrl+Shift+Z)', textContent: '↷' })
    this.undoBtn.addEventListener('click', () => this.undo())
    this.redoBtn.addEventListener('click', () => this.redo())
    const dice = el('button', { class: 'btn', type: 'button', title: 'Surprise me' }, el('span', { class: 'ico', textContent: '🎲' }), el('span', { class: 'label', textContent: 'Random' }))
    dice.addEventListener('click', () => this.apply(randomSpec(Math.floor(Math.random() * 1e9))))
    const save = el('button', { class: 'btn primary', type: 'button' }, el('span', { class: 'ico', textContent: '✓' }), el('span', { textContent: 'Save' }))
    save.addEventListener('click', () => void this.save())
    root.append(el('header', { class: 'topbar' },
      el('h1', { textContent: opts.title ?? 'Your avatar' }),
      el('span', { class: 'sub', textContent: 'The same you in every game' }),
      el('span', { class: 'spacer' }),
      this.undoBtn, this.redoBtn, dice, save,
    ))

    // --- stage
    const canvas = stageCanvas
    canvas.setAttribute('aria-label', 'Avatar preview. Drag to turn, scroll to zoom.')
    this.busyEl = el('div', { class: 'busy', textContent: 'Shaping…' })
    const stage = el('div', { class: 'stage' }, canvas, this.busyEl)
    root.append(stage)
    this.preview = new Preview(engine, canvas, this.spec)
    this.preview.onBusy = (b, text) => {
      this.busyEl.textContent = text ?? 'Shaping…'
      this.busyEl.classList.toggle('on', b)
    }
    // a build or a download that fails says so, instead of leaving the stage on "Shaping…"
    this.preview.onError = (message) => this.toast(message)
    stage.append(this.viewButtons(), this.poseDock(), this.motionBar())

    // --- panel
    const tabs = el('div', { class: 'tabs', role: 'tablist' })
    const panel = el('section', { class: 'panel' }, tabs)
    for (const t of TABS) {
      const b = el('button', { class: `tab tab-${t.id}`, type: 'button', role: 'tab' }, el('span', { class: 'ico', textContent: t.ico }), el('span', { textContent: t.label }))
      b.addEventListener('click', () => this.showTab(t.id))
      tabs.append(b)
      this.tabButtons.set(t.id, b)
      const sheet = el('div', { class: 'sheet', role: 'tabpanel', dataset: { tab: t.id } })
      this.sheets.set(t.id, sheet)
      panel.append(sheet)
    }
    root.append(panel)
    this.codeInput = el('input', { type: 'text', spellcheck: false, ariaLabel: 'Avatar code' })
    this.buildBody()
    this.buildShare()
    this.toastEl = el('div', { class: 'toast', role: 'status' })
    root.append(this.toastEl)
    window.addEventListener('keydown', this.onKey)
    this.showTab('body')
    this.sync()
    // MakeHuman's modifier sliders and asset library load in the background
    void loadModifierDefs().then((d) => {
      this.buildModifiers('face', d.sliders as SliderLayout, ['Face'], d.modifiers)
      this.buildModifiers('shape', d.sliders as SliderLayout, ['Torso', 'Arms and Legs', 'Gender'], d.modifiers)
      this.sync()
    })
    void loadIndex().then((idx) => {
      this.buildHair(idx)
      this.buildClothes(idx)
      this.sync()
    })
  }

  // ------------------------------------------------------------------------------------------------ state

  private edit(mutate: (s: AvatarSpec) => void, live = false): void {
    const before = cloneSpec(this.spec)
    const next = cloneSpec(this.spec)
    mutate(next)
    this.spec = normalizeSpec(next)
    if (live) this.pendingBase ??= before
    else {
      const base = this.pendingBase ?? before
      this.pendingBase = null
      if (JSON.stringify(base) !== JSON.stringify(this.spec)) {
        this.undoStack.push(base)
        if (this.undoStack.length > 80) this.undoStack.shift()
        this.redoStack = []
      }
    }
    this.preview.setSpec(this.spec, live)
    this.sync()
  }

  private pendingBase: AvatarSpec | null = null

  /** Replace the whole spec (preset, random, code, undo). */
  apply(spec: AvatarSpec, record = true): void {
    if (record) {
      this.undoStack.push(cloneSpec(this.spec))
      this.redoStack = []
    }
    this.spec = normalizeSpec(spec)
    this.preview.setSpec(this.spec, false)
    this.sync()
  }

  undo(): void {
    const prev = this.undoStack.pop()
    if (!prev) return
    this.redoStack.push(cloneSpec(this.spec))
    this.apply(prev, false)
  }

  redo(): void {
    const next = this.redoStack.pop()
    if (!next) return
    this.undoStack.push(cloneSpec(this.spec))
    this.apply(next, false)
  }

  private sync(): void {
    for (const s of this.syncs) s()
    this.undoBtn.disabled = this.undoStack.length === 0
    this.redoBtn.disabled = this.redoStack.length === 0
    if (!hasFocus(this.codeInput)) this.codeInput.value = encodeSpec(this.spec)
  }

  async save(): Promise<void> {
    try {
      await this.opts.onSave?.(cloneSpec(this.spec))
      this.toast('Saved ✓')
    } catch (err) {
      this.toast(`Couldn't save: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Stop rendering and listening, and empty the element it was mounted on. */
  dispose(): void {
    window.removeEventListener('keydown', this.onKey)
    clearTimeout(this.toastTimer)
    this.preview.dispose()
    const host = this.root.getRootNode()
    if (host instanceof ShadowRoot) host.replaceChildren()
    else this.root.replaceChildren()
  }

  private toast(text: string): void {
    this.toastEl.textContent = text
    this.toastEl.classList.add('on')
    clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on'), 1800)
  }

  private showTab(id: TabId): void {
    this.tab = id
    for (const [t, b] of this.tabButtons) b.setAttribute('aria-selected', String(t === id))
    for (const [t, s] of this.sheets) s.hidden = t !== id
    if (id === 'face' || id === 'hair') this.preview.frame('face')
    else this.preview.frame('body')
  }

  // ------------------------------------------------------------------------------------------------ stage UI

  private viewButtons(): HTMLElement {
    const face = el('button', { class: 'btn icon', type: 'button', title: 'Close-up', textContent: '🔍' })
    const body = el('button', { class: 'btn icon', type: 'button', title: 'Whole body', textContent: '🧍' })
    const spin = el('button', { class: 'btn icon', type: 'button', title: 'Turntable', textContent: '⟳' })
    face.addEventListener('click', () => this.preview.frame('face'))
    body.addEventListener('click', () => this.preview.frame('body'))
    spin.addEventListener('click', () => {
      this.preview.setSpin(!this.preview.spinning)
      spin.setAttribute('aria-pressed', String(this.preview.spinning))
      spin.style.opacity = this.preview.spinning ? '1' : '0.55'
    })
    return el('div', { class: 'views' }, face, body, spin)
  }

  /** Try the avatar's facial expressions and hand poses (games set these; the designer just shows them). */
  private poseDock(): HTMLElement {
    const faces: Array<[ExpressionName, string, string]> = [
      ['neutral', '😐', 'Neutral'], ['smile', '🙂', 'Smile'], ['happy', '😄', 'Happy'], ['sad', '🙁', 'Sad'],
      ['surprised', '😮', 'Surprised'], ['angry', '😠', 'Angry'], ['effort', '😣', 'Effort'], ['panting', '😮‍💨', 'Panting'], ['wink', '😉', 'Wink'],
    ]
    const hands: Array<[HandPose, string, string]> = [['relaxed', '🤚', 'Relaxed'], ['open', '🖐️', 'Open'], ['fist', '✊', 'Fist'], ['point', '👉', 'Point']]
    const group = <T extends string>(items: Array<[T, string, string]>, initial: T, pick: (v: T) => void): HTMLElement[] => {
      const buttons = items.map(([id, ico, label]) => {
        const b = el('button', { class: 'dock-btn', type: 'button', title: label, textContent: ico })
        b.setAttribute('aria-label', label)
        b.setAttribute('aria-pressed', String(id === initial))
        b.addEventListener('click', () => {
          pick(id)
          for (const x of buttons) x.setAttribute('aria-pressed', String(x === b))
        })
        return b
      })
      return buttons
    }
    const faceGrid = el('div', { class: 'dock-grid', role: 'group', ariaLabel: 'Expression' }, ...group(faces, 'neutral', (id) => {
      this.preview.setExpression(id)
      if (id !== 'neutral') this.preview.frame('face')
    }))
    const handGrid = el('div', { class: 'dock-grid', role: 'group', ariaLabel: 'Hands' }, ...group(hands, 'relaxed', (id) => this.preview.setHands(id)))
    return el('div', { class: 'dock' }, el('span', { class: 'dock-label', textContent: 'Face' }), faceGrid, el('span', { class: 'dock-label', textContent: 'Hands' }), handGrid)
  }

  private motionBar(): HTMLElement {
    const modes: Array<{ id: MotionMode; label: string; ico: string; min: number; max: number; step: number; value: number }> = [
      { id: 'idle', label: 'Stand', ico: '🧍', min: 0, max: 0, step: 1, value: 0 },
      { id: 'walk', label: 'Walk', ico: '🚶', min: 0.5, max: 2.4, step: 0.05, value: 1.4 },
      { id: 'run', label: 'Run', ico: '🏃', min: 1.6, max: 6, step: 0.05, value: 3.2 },
      { id: 'cycle', label: 'Cycle', ico: '🚴', min: 40, max: 120, step: 1, value: 80 },
    ]
    const speed = el('input', { type: 'range', ariaLabel: 'Speed' })
    const out = el('output')
    const speedWrap = el('div', { class: 'speed' }, speed, out)
    const bar = el('div', { class: 'pill-bar' })
    const tray = this.movesTray()
    let current = modes[0]
    const show = (): void => {
      const v = Number(speed.value)
      speed.style.setProperty('--fill', `${((v - current.min) / Math.max(1e-6, current.max - current.min)) * 100}%`)
      out.textContent = current.id === 'cycle' ? `${Math.round(v)} rpm` : `${(v * 3.6).toFixed(1)} km/h · ${(v * 2.237).toFixed(1)} mph`
    }
    const buttons = modes.map((m) => {
      const b = el('button', { class: 'seg', type: 'button', title: m.label }, el('span', { textContent: m.ico }), el('span', { class: 'label', textContent: m.label }))
      b.addEventListener('click', () => {
        current = m
        for (const x of buttons) x.setAttribute('aria-pressed', String(x === b))
        movesBtn.setAttribute('aria-pressed', 'false')
        tray.close()
        void this.preview.setMove(null)
        speedWrap.hidden = m.id === 'idle'
        speed.min = String(m.min)
        speed.max = String(m.max)
        speed.step = String(m.step)
        speed.value = String(m.value)
        show()
        this.preview.setMotion(m.id, m.value)
      })
      bar.append(b)
      return b
    })
    speed.addEventListener('input', () => {
      current.value = Number(speed.value)
      show()
      this.preview.setMotion(current.id, current.value)
    })
    // the motion clips: a tray of moves over the bar
    const movesBtn = el('button', { class: 'seg', type: 'button', title: 'Moves' }, el('span', { textContent: '✨' }), el('span', { class: 'label', textContent: 'Moves' }))
    movesBtn.setAttribute('aria-expanded', 'false')
    movesBtn.addEventListener('click', () => tray.toggle())
    tray.onOpen = (open) => movesBtn.setAttribute('aria-expanded', String(open))
    tray.onPick = (move) => {
      for (const x of buttons) x.setAttribute('aria-pressed', String(move === null && x === buttons[0]))
      movesBtn.setAttribute('aria-pressed', String(move !== null))
      speedWrap.hidden = true
      if (move === null) { current = modes[0]; this.preview.setMotion('idle', 0) }
    }
    bar.insertBefore(movesBtn, null)
    buttons[0].setAttribute('aria-pressed', 'true')
    speedWrap.hidden = true
    bar.append(speedWrap)
    return el('div', { class: 'motion' }, tray.root, bar)
  }

  /** The moves (motion clips), grouped; one plays until another, or a walk, run or ride, is chosen. */
  private movesTray(): { root: HTMLElement; toggle: () => void; close: () => void; onOpen: (open: boolean) => void; onPick: (m: Move | null) => void } {
    const root = el('div', { class: 'tray', role: 'dialog', ariaLabel: 'Moves' })
    root.hidden = true
    const api = {
      root,
      onOpen: (_open: boolean): void => {},
      onPick: (_m: Move | null): void => {},
      toggle: (): void => { root.hidden = !root.hidden; api.onOpen(!root.hidden) },
      close: (): void => { if (!root.hidden) { root.hidden = true; api.onOpen(false) } ; mark(null) },
    }
    const chipsFor: Array<[HTMLButtonElement, Move]> = []
    const mark = (id: string | null): void => { for (const [b, m] of chipsFor) b.setAttribute('aria-pressed', String(m.id === id)) }
    const closeBtn = el('button', { class: 'tray-close', type: 'button', title: 'Close', textContent: '✕' })
    closeBtn.addEventListener('click', () => { root.hidden = true; api.onOpen(false) })
    root.append(el('div', { class: 'tray-head' }, el('strong', { textContent: 'Moves' }), el('span', { class: 'hint', textContent: 'Tap one to try it; tap again to stop.' }), closeBtn))
    for (const group of ['Everyday', 'Sport', 'Action'] as const) {
      const row = el('div', { class: 'tray-row' })
      for (const m of MOVES.filter((x) => x.group === group)) {
        const b = el('button', { class: 'move', type: 'button' }, el('span', { class: 'glyph', textContent: m.ico }), el('span', { textContent: m.label }))
        b.addEventListener('click', () => {
          const on = this.preview.moveId === m.id
          void this.preview.setMove(on ? null : m.id)
          mark(on ? null : m.id)
          api.onPick(on ? null : m)
          // (on a phone the tray covers the stage: get out of the way to show the move)
          if (!on && window.matchMedia('(max-width: 860px)').matches) { root.hidden = true; api.onOpen(false) }
        })
        chipsFor.push([b, m])
        row.append(b)
      }
      root.append(el('div', { class: 'tray-group' }, el('span', { class: 'dock-label', textContent: group }), row))
    }
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { root.hidden = true; api.onOpen(false) } })
    return api
  }

  // ------------------------------------------------------------------------------------------------ tabs

  private buildBody(): void {
    const sheet = this.sheets.get('body')!
    const pct = (v: number): string => `${Math.round(v * 100)}%`
    // (no ready-made bodies to start from: naming body types invites a fight nobody wins. The dice still offers a
    // random one, and every slider starts in the middle.)
    const body = card('Body')
    for (const m of MACRO_SLIDERS) {
      body.root.append(slider({
        label: m.label, min: 0, max: 1, step: 0.01, get: () => this.spec.macros[m.key],
        set: (v, commit) => this.edit((s) => { s.macros[m.key] = v }, !commit),
        format: (v) => (v < 0.47 ? m.left : v > 0.53 ? m.right : 'Average') + ` · ${pct(v)}`,
      }, this.syncs))
    }
    // age, as MakeHuman reckons it: 0.5 = 25 years, 1 = 90
    body.root.append(slider({
      label: 'Age', min: 0.5, max: 1, step: 0.005, get: () => this.spec.macros.Age,
      set: (v, commit) => this.edit((s) => { s.macros.Age = v }, !commit),
      format: (v) => `${Math.round(25 + (v - 0.5) * 130)} years`,
    }, this.syncs))
    const height = el('p', { class: 'hint' })
    this.syncs.push(() => {
      const h = this.preview.avatar?.rig.height
      height.textContent = h ? `Standing ${(h * 100).toFixed(0)} cm (${Math.floor(h / 0.3048)}′ ${Math.round((h / 0.0254) % 12)}″)` : ''
    })
    body.root.append(height)
    sheet.append(body.root)

    // MakeHuman's ethnicity sliders: they always sum to one (moving one rebalances the others, as MakeHuman does);
    // they shape the face and body only — skin colour is chosen separately, below
    const eth = card('Ancestry')
    for (const k of ETHNIC) {
      eth.root.append(slider({
        label: k, min: 0, max: 1, step: 0.01, get: () => this.spec.macros[k],
        set: (v, commit) => this.edit((s) => setEthnic(s, k, v), !commit), format: pct,
      }, this.syncs))
    }
    eth.root.append(el('p', { class: 'hint', textContent: 'MakeHuman blends face and body features from these. Skin colour is separate.' }))
    sheet.append(eth.root)
    const skin = card('Skin', swatches(SKIN_TONES, () => this.spec.skin.color, (c) => this.edit((s) => { s.skin.color = c }), this.syncs))
    const SKIN: Array<{ key: 'redness' | 'blotchiness' | 'beard' | 'pores' | 'shine'; label: string; words: [string, string, string] }> = [
      { key: 'redness', label: 'Redness', words: ['Pale', 'Natural', 'Flushed'] },
      { key: 'blotchiness', label: 'Evenness', words: ['Even', 'Natural', 'Blotchy'] },
      { key: 'beard', label: 'Beard shadow', words: ['None', 'Light', 'Heavy'] },
      { key: 'pores', label: 'Texture', words: ['Smooth', 'Natural', 'Rough'] },
      { key: 'shine', label: 'Shine', words: ['Matte', 'Natural', 'Dewy'] },
    ]
    for (const k of SKIN) {
      skin.root.append(slider({
        label: k.label, min: 0, max: 1, step: 0.01, get: () => this.spec.skin[k.key],
        set: (v, commit) => this.edit((s) => { s.skin[k.key] = v }, !commit),
        format: (v) => (v < 0.2 ? k.words[0] : v > 0.75 ? k.words[2] : k.words[1]),
      }, this.syncs))
    }
    // TEMPORARY (2026-09-19): how much of the skin photograph's own freckles, creases and shading to keep, faded
    // toward its median. It redraws the texture, so it moves on release rather than while dragging. Remove with
    // SkinSpec.photo once the balance is settled.
    skin.root.append(slider({
      label: 'Photo strength (temp)', min: 0, max: 1, step: 0.05, get: () => this.spec.skin.photo ?? 1,
      set: (v, commit) => { if (commit) this.edit((s) => { s.skin.photo = v }) },
      format: (v) => `${Math.round(v * 100)}%`,
    }, this.syncs))
    sheet.append(skin.root)
    // the detail photograph under the colour: freckles, stubble, fine lines, age
    const detail = card('Skin detail')
    detail.root.append(el('p', { class: 'hint', textContent: 'Real skin photographs from the MakeHuman community, recoloured to the colour above.' }))
    sheet.append(detail.root)
    void loadIndex().then((idx) => {
      const skins = idx.filter((a) => a.kind === 'skin')
        .sort((x, y) => Number(x.auto) - Number(y.auto) || x.tags[0].localeCompare(y.tags[0]) || x.name.localeCompare(y.name))
        .map((a) => ({ ...a, name: `${a.name} · ${a.tags[0] === 'female' ? 'F' : 'M'}` }))
      detail.root.append(this.tiles(skins, () => this.spec.skin.texture, (id) => this.edit((s) => { s.skin.texture = id }), 'Automatic'))
      for (const f of this.syncs) f()
    })
  }

  /** MakeHuman's modifier sliders for some of its tabs, grouped and labelled as MakeHuman does. */
  private buildModifiers(tab: TabId, layout: SliderLayout, tabs: string[], defs: ModifierDef[]): void {
    const sheet = this.sheets.get(tab)!
    const byName = new Map(defs.map((d) => [d.name, d]))
    for (const t of tabs) {
      for (const [group, items] of Object.entries(layout[t]?.modifiers ?? {})) {
        if (/genital/i.test(group)) continue
        const details = el('details', { class: 'card' }, el('summary', { textContent: chestly(title(group)) }))
        let n = 0
        for (const it of items) {
          const d = byName.get(it.mod)
          if (!d || HIDDEN_MODIFIER.test(it.mod)) continue
          n++
          details.append(slider({
            label: chestly(it.label ?? it.mod), min: d.min, max: d.max, step: 0.01, get: () => this.spec.modifiers[d.name] ?? 0,
            set: (v, commit) => this.edit((s) => {
              if (Math.abs(v) < 0.005) delete s.modifiers[d.name]
              else s.modifiers[d.name] = v
            }, !commit),
            format: (v) => (Math.abs(v) < 0.005 ? '·' : `${v > 0 ? '+' : ''}${Math.round(v * 100)}`),
          }, this.syncs))
        }
        if (n) sheet.append(details)
      }
    }
    const reset = el('button', { class: 'btn', type: 'button', textContent: 'Reset these' })
    const names = new Set(tabs.flatMap((t) => Object.values(layout[t]?.modifiers ?? {}).flat().map((it) => it.mod)))
    reset.addEventListener('click', () => this.edit((s) => { for (const k of Object.keys(s.modifiers)) if (names.has(k)) delete s.modifiers[k] }))
    sheet.append(el('div', { class: 'card' }, reset))
  }

  private buildHair(idx: AssetEntry[]): void {
    const sheet = this.sheets.get('hair')!
    const of = (kind: AssetEntry['kind']): AssetEntry[] => idx.filter((a) => a.kind === kind)
    sheet.append(card('Hair',
      this.tiles(of('hair'), () => this.spec.hair.id, (id) => this.edit((s) => { s.hair.id = id }), true),
      swatches(HAIR_COLORS, () => this.spec.hair.color, (c) => this.edit((s) => { s.hair.color = c }), this.syncs),
    ).root)
    sheet.append(card('Eyebrows', this.tiles(of('eyebrows'), () => this.spec.eyebrows, (id) => this.edit((s) => { s.eyebrows = id }), true)).root)
    sheet.append(card('Eyelashes', this.tiles(of('eyelashes'), () => this.spec.eyelashes, (id) => this.edit((s) => { s.eyelashes = id }), true)).root)
    const eyes = of('eyes').filter((a) => (EYE_MATERIALS as readonly string[]).includes(a.id))
    sheet.append(card('Eyes', this.tiles(eyes.map((a) => ({ ...a, thumb: a.texture ?? null })), () => this.spec.eyes, (id) => this.edit((s) => { s.eyes = id ?? 'brown' }), false)).root)
  }

  private buildClothes(idx: AssetEntry[]): void {
    const sheet = this.sheets.get('clothes')!
    const worn = el('div', { class: 'worn' })
    const wornCard = card('Wearing', worn)
    sheet.append(wornCard.root)
    // recolourable garments: their own colour first (choosing it clears the chosen colour), then the palette;
    // patterned ones are worn as made
    const colorsFor = (id: string): HTMLElement => {
      const a = idx.find((x) => x.kind === 'clothes' && x.id === id)
      if (a && a.tintable === false) return el('p', { class: 'hint', textContent: 'Patterned: worn as made.' })
      const own = a?.baseColor ?? '#ffffff'
      return swatches([own, ...OUTFIT_COLORS.filter((c) => c !== own)], () => this.spec.clothes.find((x) => x.id === id)?.color ?? own,
        (col) => this.edit((s) => { const w = s.clothes.find((x) => x.id === id); if (w) w.color = col === own ? undefined : col }), this.syncs)
    }
    // the worn list is rebuilt when the set of worn items changes
    let shown = ''
    this.syncs.push(() => {
      const key = this.spec.clothes.map((c) => c.id).join()
      if (key === shown) return
      shown = key
      worn.replaceChildren(...this.spec.clothes.map((c) => {
        const off = el('button', { class: 'btn icon', type: 'button', title: 'Take off', textContent: '✕' })
        off.addEventListener('click', () => this.edit((s) => { s.clothes = s.clothes.filter((x) => x.id !== c.id) }))
        const name = idx.find((x) => x.kind === 'clothes' && x.id === c.id)?.name ?? pretty(c.id)
        return el('div', { class: 'worn-item' }, el('div', { class: 'row' }, el('span', { textContent: name }), off), colorsFor(c.id))
      }))
      if (!this.spec.clothes.length) worn.append(el('p', { class: 'hint', textContent: 'Nothing yet: pick from below.' }))
    })
    const garments = idx.filter((a) => a.kind === 'clothes')
    for (const slot of SLOTS) {
      const items = garments.filter((a) => slotOf(a) === slot.id).sort((x, y) => (x.order ?? 1e9) - (y.order ?? 1e9))
      if (!items.length) continue
      const pick = (id: string | null): void => this.edit((s) => {
        if (!id) return
        if (s.clothes.some((x) => x.id === id)) { s.clothes = s.clothes.filter((x) => x.id !== id); return }
        // one item per slot, except socks and other accessories
        const keep = s.clothes.filter((x) => slot.id === 'other' || slotOf(garments.find((g) => g.id === x.id) ?? { id: x.id, tags: [] } as unknown as AssetEntry) !== slot.id)
        // (in its own colour until one is chosen)
        s.clothes = [...keep, { id }]
      })
      const details = el('details', { class: 'card', open: slot.id === 'tops' }, el('summary', { textContent: `${slot.label} (${items.length})` }),
        this.tiles(items, () => null, pick, false, (id) => this.spec.clothes.some((x) => x.id === id)))
      sheet.append(details)
    }
  }

  /** A grid of asset thumbnails; `none` adds a "none" tile. */
  private tiles(items: AssetEntry[], get: () => string | null, set: (id: string | null) => void, none: boolean | string, isOn?: (id: string) => boolean): HTMLElement {
    const grid = el('div', { class: 'tiles' })
    const on = isOn ?? ((id: string) => get() === id)
    const buttons: Array<[HTMLButtonElement, string | null]> = []
    const add = (id: string | null, label: string, thumb: string | null, credit: string): void => {
      const b = el('button', { class: 'tile', type: 'button', title: credit ? `${label} — ${credit}` : label })
      if (thumb) b.append(el('img', { src: assetUrl(thumb), alt: '', loading: 'lazy' }))
      else b.append(el('span', { class: 'none', textContent: id ? label : label === 'None' ? '∅' : 'Auto' }))
      b.append(el('span', { class: 'cap', textContent: label }))
      b.addEventListener('click', () => set(id))
      grid.append(b)
      buttons.push([b, id])
    }
    if (none) add(null, typeof none === 'string' ? none : 'None', null, '')
    // (curated garments carry their designer name; everything else gets MakeHuman's, tidied)
    for (const a of items) add(a.id, a.order !== undefined ? a.name : pretty(a.name ?? a.id), a.thumb, a.license === 'CC0' ? '' : `${a.author ?? 'unknown'}, ${a.license}`)
    this.syncs.push(() => { for (const [b, id] of buttons) b.setAttribute('aria-pressed', String(id === null ? get() === null : on(id))) })
    return grid
  }

  private buildShare(): void {
    const sheet = this.sheets.get('share')!
    const copy = el('button', { class: 'btn', type: 'button', textContent: 'Copy' })
    const use = el('button', { class: 'btn', type: 'button', textContent: 'Use' })
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(encodeSpec(this.spec)).then(() => this.toast('Code copied'), () => this.codeInput.select())
    })
    use.addEventListener('click', () => {
      const spec = decodeSpec(this.codeInput.value)
      if (spec) {
        this.apply(spec)
        this.toast('Avatar loaded')
      } else this.toast('That code doesn’t look right')
    })
    this.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') use.click()
    })
    sheet.append(card('Avatar code', el('div', { class: 'code' }, this.codeInput, copy, use),
      el('p', { class: 'hint', textContent: 'Share this code, or paste one to wear it.' })).root)
    const list = el('ul', { class: 'credits' })
    void credits().then((cs) => list.replaceChildren(...cs.map((c) => el('li', { textContent: `${pretty(c.name)} (${c.kind}) — ${c.author ?? 'unknown'}, ${c.license}` }))))
    sheet.append(card('Credits', el('p', { class: 'hint', textContent: 'Bodies, faces and most assets are MakeHuman\u2019s (CC0). These are CC-BY and credited to their authors:' }), list).root)
    const reset = el('button', { class: 'btn', type: 'button', textContent: 'Start over' })
    reset.addEventListener('click', () => this.apply(normalizeSpec({})))
    sheet.append(card('Reset', reset).root)
  }
}

type SliderLayout = Record<string, { modifiers?: Record<string, Array<{ mod: string; label?: string; cam?: string }>> }>

const title = (s: string): string => s.replace(/^./, (c) => c.toUpperCase())

/** Sets one ethnicity and rebalances the others to keep the sum at one (MakeHuman's _setEthnicVals). */
function setEthnic(s: AvatarSpec, k: Macro, v: number): void {
  const others = ETHNIC.filter((e) => e !== k)
  const rest = others.reduce((t, e) => t + s.macros[e], 0)
  s.macros[k] = v
  for (const e of others) s.macros[e] = rest > 1e-6 ? (s.macros[e] / rest) * (1 - v) : (1 - v) / 2
}

/** Render the designer into `host` (in its shadow root). Call dispose() on the result to take it down again. */
export async function mountDesigner(host: HTMLElement, opts: DesignerOptions = {}): Promise<Designer> {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = css
  const root = document.createElement('div')
  shadow.replaceChildren(style, root)
  // the preview's engine first (WebGPU starts asynchronously), on the canvas the designer will lay out
  const canvas = el('canvas', { tabIndex: 0 })
  const engine = await createEngine(canvas, { alpha: true })
  return new Designer(root, opts, canvas, engine)
}
