import './paintshop.css'
import type { Store } from '../game/save'
import type { Showcase } from '../render/showcase'
import { esc } from './dom'

/**
 * Pieces shared by the paint shop and the driver editor: option rows,
 * colour pickers, the drag-to-orbit stage, and their words in both languages.
 * Kept apart from app.ts so the garage screens are self-contained.
 */

/** What the garage hands its editors. */
export interface GarageCtx {
  store: Store
  car: string
  /** The garage showcase, created if needed. */
  showcase(): Showcase
  /** Shows a menu screen over the showcase (pushed, so Back returns). */
  menu(render: () => string, bind: (root: HTMLElement) => void): void
  /** Leaves the editor, as the Back button does. */
  back(): void
}

const EN = {
  paintShop: 'Paint shop',
  paintSub: 'Design your own livery',
  driverEdit: 'Driver',
  driverSub: 'Helmet, face and shirt',
  template: 'Design',
  colours: 'Colours',
  primary: 'Primary',
  secondary: 'Secondary',
  accent: 'Accent',
  wheels: 'Wheels',
  finish: 'Finish',
  number: 'Number',
  font: 'Number style',
  sponsor: 'Sponsor',
  decals: 'Decals',
  panel: 'Door number panel',
  sponsors: 'Sponsor stickers',
  pinstripe: 'Pinstripe',
  roof: 'Roof number',
  bonnet: 'Bonnet sponsor',
  windowName: 'Name on windows',
  liveryName: 'Livery name',
  mine: 'My liveries for this car',
  none: 'Nothing saved yet. Design one and press Save.',
  startFrom: 'Start from a team livery',
  save: 'Save',
  saveNew: 'Save as new',
  apply: 'Use on car',
  delete: 'Delete',
  onCar: 'on the car',
  saved: 'Livery saved',
  applied: 'On the car for your next stage',
  full: 'This car already has {n} liveries: delete one first',
  deleted: 'Livery deleted',
  spin: 'Turntable',
  resetView: 'Reset view',
  drag: 'Drag to turn · scroll or pinch to zoom',
  helmet: 'Helmet',
  pattern: 'Pattern',
  base: 'Base',
  visor: 'Visor',
  face: 'Face',
  skin: 'Skin',
  hair: 'Hair',
  hairColour: 'Hair colour',
  moustache: 'Moustache',
  brows: 'Eyebrows',
  glasses: 'Glasses',
  shirt: 'Shirt',
  print: 'Print',
  printColour: 'Print colour',
  shorts: 'Shorts',
  helmetOn: 'Helmet on',
  surprise: 'Surprise me',
  reset: 'Reset',
  driverSaved: 'Looking sharp',
  unsaved: 'Unsaved changes',
  myLivery: 'My livery',
  // Option names.
  swoosh: 'Swoosh', stripes: 'Stripes', chevron: 'Chevrons', fade: 'Fade', split: 'Split', blocks: 'Blocks', band: 'Band', shards: 'Shards', wave: 'Wave', tricolor: 'Sash', dots: 'Dots', plain: 'Plain',
  gloss: 'Gloss', metallic: 'Metallic', pearl: 'Pearl', satin: 'Satin', matte: 'Matte', chrome: 'Chrome',
  block: 'Block', italic: 'Italic', outline: 'Outline', stencil: 'Stencil', retro: 'Retro',
  stripe: 'Stripe', flames: 'Flames', stars: 'Stars', checker: 'Checker', halo: 'Halo', bolt: 'Bolt',
  iridium: 'Iridium', gold: 'Gold', smoke: 'Smoke', rainbow: 'Rainbow', clear: 'Clear',
  mullet: 'Mullet', curls: 'Curls', quiff: 'Quiff', mop: 'Mop', buzz: 'Buzz cut', bald: 'Bald',
  handlebar: 'Handlebar', walrus: 'Walrus', pencil: 'Pencil', none_: 'None',
  bushy: 'Bushy', arched: 'Arched', mono: 'Mono', thin: 'Thin',
  aviator: 'Aviators', round: 'Round', shutter: 'Shutter shades',
  flowers: 'Hibiscus', palms: 'Palms', pineapples: 'Pineapples', checks: 'Checks',
}
type Key = keyof typeof EN

const DE: Partial<Record<Key, string>> = {
  paintShop: 'Lackiererei',
  paintSub: 'Gestalte deine eigene Lackierung',
  driverEdit: 'Fahrer',
  driverSub: 'Helm, Gesicht und Hemd',
  template: 'Design',
  colours: 'Farben',
  primary: 'Grundfarbe',
  secondary: 'Zweitfarbe',
  accent: 'Akzent',
  wheels: 'Felgen',
  finish: 'Oberfläche',
  number: 'Startnummer',
  font: 'Nummernstil',
  sponsor: 'Sponsor',
  decals: 'Aufkleber',
  panel: 'Nummernfeld an der Tür',
  sponsors: 'Sponsorenaufkleber',
  pinstripe: 'Zierlinie',
  roof: 'Dachnummer',
  bonnet: 'Sponsor auf der Haube',
  windowName: 'Name an den Scheiben',
  liveryName: 'Name der Lackierung',
  mine: 'Meine Lackierungen für dieses Auto',
  none: 'Noch nichts gespeichert. Gestalte eine und tippe auf Speichern.',
  startFrom: 'Mit einer Teamlackierung beginnen',
  save: 'Speichern',
  saveNew: 'Als neue speichern',
  apply: 'Aufs Auto',
  delete: 'Löschen',
  onCar: 'auf dem Auto',
  saved: 'Lackierung gespeichert',
  applied: 'Ab der nächsten Prüfung auf dem Auto',
  full: 'Dieses Auto hat schon {n} Lackierungen: lösche zuerst eine',
  deleted: 'Lackierung gelöscht',
  spin: 'Drehteller',
  resetView: 'Ansicht zurücksetzen',
  drag: 'Ziehen zum Drehen · Scrollen oder Zwei-Finger-Zoom',
  helmet: 'Helm',
  pattern: 'Muster',
  base: 'Grundfarbe',
  visor: 'Visier',
  face: 'Gesicht',
  skin: 'Haut',
  hair: 'Frisur',
  hairColour: 'Haarfarbe',
  moustache: 'Schnurrbart',
  brows: 'Augenbrauen',
  glasses: 'Brille',
  shirt: 'Hemd',
  print: 'Muster',
  printColour: 'Musterfarbe',
  shorts: 'Shorts',
  helmetOn: 'Helm auf',
  surprise: 'Überrasch mich',
  reset: 'Zurücksetzen',
  driverSaved: 'Schick!',
  unsaved: 'Ungespeicherte Änderungen',
  myLivery: 'Meine Lackierung',
  swoosh: 'Schwung', stripes: 'Streifen', chevron: 'Winkel', fade: 'Verlauf', split: 'Geteilt', blocks: 'Blöcke', band: 'Band', shards: 'Splitter', wave: 'Welle', tricolor: 'Schärpe', dots: 'Punkte', plain: 'Uni',
  gloss: 'Glanz', metallic: 'Metallic', pearl: 'Perlmutt', satin: 'Seidenmatt', matte: 'Matt', chrome: 'Chrom',
  block: 'Block', italic: 'Kursiv', outline: 'Kontur', stencil: 'Schablone', retro: 'Retro',
  stripe: 'Streifen', flames: 'Flammen', stars: 'Sterne', checker: 'Karo', halo: 'Ring', bolt: 'Blitz',
  iridium: 'Iridium', gold: 'Gold', smoke: 'Rauch', rainbow: 'Regenbogen', clear: 'Klar',
  mullet: 'Vokuhila', curls: 'Locken', quiff: 'Tolle', mop: 'Mopp', buzz: 'Stoppel', bald: 'Glatze',
  handlebar: 'Lenker', walrus: 'Walross', pencil: 'Strich', none_: 'Keiner',
  bushy: 'Buschig', arched: 'Gebogen', mono: 'Monobraue', thin: 'Schmal',
  aviator: 'Pilotenbrille', round: 'Rund', shutter: 'Jalousiebrille',
  flowers: 'Hibiskus', palms: 'Palmen', pineapples: 'Ananas', checks: 'Karos',
}

export function pt(key: string, vars?: Record<string, string | number>): string {
  const k = key as Key
  let s = (document.documentElement.lang === 'de' ? DE[k] : undefined) ?? EN[k] ?? key
  if (vars) for (const [n, v] of Object.entries(vars)) s = s.replace(`{${n}}`, String(v))
  return s
}
/** An option's label; 'none' is shared by several lists, so it has its own key. */
export const optLabel = (v: string): string => pt(v === 'none' ? 'none_' : v)

export const css = (n: number): string => '#' + (n & 0xffffff).toString(16).padStart(6, '0')

/** A row of choices; `chips` gives each a colour square. */
export function seg(name: string, opts: readonly string[], cur: string, chips?: Record<string, number>, label = optLabel): string {
  return `<div class="seg ps-seg" data-seg="${name}">${opts.map((o) => `<button class="${o === cur ? 'on' : ''}" data-v="${esc(o)}">${chips?.[o] !== undefined ? `<i style="background:${css(chips[o])}"></i>` : ''}${esc(label(o))}</button>`).join('')}</div>`
}

export function bindSeg(root: HTMLElement, name: string, fn: (v: string) => void): void {
  const el = root.querySelector<HTMLElement>(`[data-seg="${name}"]`)
  el?.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
    el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b))
    fn(b.dataset.v ?? '')
  }))
}

/** Curated swatches plus a free colour picker. */
export function palette(name: string, colours: readonly number[], cur: number): string {
  return `<div class="ps-dots" data-col="${name}">${colours.map((c) => `<button class="ps-dot ${c === cur ? 'sel' : ''}" data-c="${c}" style="background:${css(c)}" aria-label="${css(c)}"></button>`).join('')}<input type="color" value="${css(cur)}" aria-label="custom colour"></div>`
}

/** Wires a palette; `set` lets the caller point it at another colour (e.g. switching Primary/Secondary). */
export function bindPalette(root: HTMLElement, name: string, fn: (c: number) => void): { set(c: number): void } {
  const el = root.querySelector<HTMLElement>(`[data-col="${name}"]`)
  const input = el?.querySelector<HTMLInputElement>('input[type=color]')
  const mark = (c: number) => {
    el?.querySelectorAll<HTMLElement>('.ps-dot').forEach((d) => d.classList.toggle('sel', Number(d.dataset.c) === c))
    if (input) input.value = css(c)
  }
  el?.querySelectorAll<HTMLElement>('.ps-dot').forEach((d) => d.addEventListener('click', () => {
    const c = Number(d.dataset.c)
    mark(c)
    fn(c)
  }))
  input?.addEventListener('input', () => {
    const c = parseInt(input.value.slice(1), 16)
    if (Number.isFinite(c)) {
      el?.querySelectorAll<HTMLElement>('.ps-dot').forEach((d) => d.classList.remove('sel'))
      fn(c)
    }
  })
  return { set: mark }
}

/** The see-through middle column: drag to orbit, wheel or pinch to zoom. */
export function stage(): string {
  return `<div class="ps-stage" aria-hidden="true" data-stage><div class="ps-view row"><button class="btn ghost" data-spin>${pt('spin')}</button><button class="btn ghost" data-reset>${pt('resetView')}</button></div><p class="ps-hint">${pt('drag')}</p></div>`
}

export function bindStage(root: HTMLElement, sc: Showcase, mode: 'car' | 'driver'): void {
  const el = root.querySelector<HTMLElement>('[data-stage]')
  if (!el) return
  const pts = new Map<number, { x: number; y: number }>()
  let pinch = 0
  el.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return
    el.setPointerCapture(e.pointerId)
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
  })
  el.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId)
    if (!p) return
    if (pts.size === 2) {
      const [a, b] = [...pts.values()]
      const d0 = Math.hypot(a.x - b.x, a.y - b.y)
      p.x = e.clientX
      p.y = e.clientY
      const [c, d] = [...pts.values()]
      const d1 = Math.hypot(c.x - d.x, c.y - d.y)
      if (pinch && d0 > 0) sc.zoom(d0 / d1)
      pinch = d1
      return
    }
    sc.orbit(e.clientX - p.x, e.clientY - p.y)
    p.x = e.clientX
    p.y = e.clientY
  })
  const up = (e: PointerEvent) => {
    pts.delete(e.pointerId)
    pinch = 0
  }
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', up)
  el.addEventListener('wheel', (e) => {
    e.preventDefault()
    sc.zoom(e.deltaY > 0 ? 1.08 : 1 / 1.08)
  }, { passive: false })
  root.querySelector('[data-spin]')?.addEventListener('click', () => {
    sc.spin = sc.spin ? 0 : 0.35
  })
  root.querySelector('[data-reset]')?.addEventListener('click', () => sc.frame(mode))
}

/** A labelled on/off switch using the shared toggle style. */
export function toggle(name: string, label: string, on: boolean): string {
  return `<div class="ps-opt"><span>${esc(label)}</span><button class="toggle ${on ? 'on' : ''}" data-tog="${name}" role="switch" aria-checked="${on}" aria-label="${esc(label)}"></button></div>`
}

export function bindToggle(root: HTMLElement, name: string, fn: (on: boolean) => void): void {
  const b = root.querySelector<HTMLElement>(`[data-tog="${name}"]`)
  b?.addEventListener('click', () => {
    const on = !b.classList.contains('on')
    b.classList.toggle('on', on)
    b.setAttribute('aria-checked', String(on))
    fn(on)
  })
}
