/** Tiny DOM helpers: no framework, the UI is a handful of screens. */

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T => {
  const el = root.querySelector<T>(sel)
  if (!el) throw new Error(`Missing element ${sel}`)
  return el
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
}

const layouts = new WeakMap<HTMLElement, string>()

export function html(el: HTMLElement, markup: string): HTMLElement {
  el.innerHTML = markup
  // Menu screens redraw whole on every tab, toggle or pick. When the layout is
  // the same as last time it is a redraw, not a new screen: mark it so the
  // entrance animations play on arrival only, not on every tap.
  const view = el.querySelector(':scope > .view')
  if (view) {
    const layout = Array.from(view.children, (c) => `${c.tagName}.${c.className}`).join('|')
    el.classList.toggle('redraw', layouts.get(el) === layout)
    layouts.set(el, layout)
  }
  return el
}

export function fmtTime(s: number, cents = true): string {
  if (!Number.isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  const sec = s - m * 60
  const whole = Math.floor(sec)
  const c = Math.floor((sec - whole) * 100)
  return `${m}:${String(whole).padStart(2, '0')}${cents ? '.' + String(c).padStart(2, '0') : ''}`
}

export function fmtDelta(s: number): string {
  const sign = s < 0 ? '−' : '+'
  return `${sign}${Math.abs(s).toFixed(2)}`
}

export const CHEVRON = '<svg viewBox="0 0 120 120" aria-hidden="true"><path d="M26 34 L48 60 L26 86"/><path d="M50 34 L72 60 L50 86"/><path d="M74 34 L96 60 L74 86"/></svg>'

let toastTimer = 0
export function toast(msg: string, ms = 3200): void {
  const el = document.getElementById('toast')
  if (!el) return
  el.textContent = msg
  el.classList.remove('hidden')
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => el.classList.add('hidden'), ms)
}
