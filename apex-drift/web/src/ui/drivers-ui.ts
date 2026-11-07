import { isCustom, PRESETS, TOGGLES, type AssistSettings, type AssistToggle } from '../game/assists'
import { currentLang, t, type TKey } from '../game/i18n'
import { ASSIST_LEVELS, type AssistLevel } from '../sim/car'
import { levelAt, levelIndex, LEVELS, TOP_LEVEL, type Difficulty } from '../sim/levels'
import { character, flag } from '../sim/personality'
import { esc } from './dom'

/**
 * Self-contained markup for the AI ladder, the assists and the rival
 * characters, shared by the Options screen, the race setup and the results.
 * Built from the existing `.opt`, `.seg`, `.toggle` and `.muted` patterns so
 * it follows whatever the stylesheet does with them.
 */

/** A stepper and slider over the thirteen rungs, with the rung's name and what it means. */
export function aiPickerHtml(d: Difficulty): string {
  const i = levelIndex(d)
  return `<div class="opt" data-ai-pick>
    <label>${t('aiLevel')} · <b>${t(d)}</b><br><small class="muted">${t(`${d}Sub` as TKey)} · ${t('aiLevelOf', { n: i + 1, total: LEVELS.length })}</small></label>
    <div class="seg"><button data-ai-step="-1" aria-label="${t('aiDown')}" ${i === 0 ? 'disabled' : ''}>−</button><input type="range" min="0" max="${TOP_LEVEL}" step="1" value="${i}" data-ai-range aria-label="${t('aiLevel')}"><button data-ai-step="1" aria-label="${t('aiUp')}" ${i === TOP_LEVEL ? 'disabled' : ''}>+</button></div>
  </div>`
}

export function bindAiPicker(root: HTMLElement, get: () => Difficulty, set: (d: Difficulty) => void): void {
  root.querySelectorAll<HTMLElement>('[data-ai-step]').forEach((b) => b.addEventListener('click', () => set(levelAt(levelIndex(get()) + Number(b.dataset.aiStep)))))
  // Commit on release, so dragging across the ladder doesn't redraw the screen under the finger.
  root.querySelector<HTMLInputElement>('[data-ai-range]')?.addEventListener('change', (e) => set(levelAt(Number((e.target as HTMLInputElement).value))))
}

/** The assist preset ladder; `full` adds every toggle and the steering slider. */
export function assistsHtml(a: AssistSettings, full: boolean): string {
  const custom = isCustom(a)
  const seg = `<div class="seg" role="radiogroup">${ASSIST_LEVELS.map((l) => `<button class="${!custom && a.preset === l ? 'on' : ''}" data-assist="${l}" role="radio" aria-checked="${!custom && a.preset === l}">${t(`assist_${l}` as TKey)}</button>`).join('')}${custom ? `<button class="on" disabled>${t('assist_custom')}</button>` : ''}</div>`
  const head = `<div class="opt"><label>${t('assists')}</label>${seg}</div>`
  if (!full) return head
  const sub: Partial<Record<AssistToggle, TKey>> = { steer: 'as_steerSub', brake: 'as_brakeSub', forgive: 'as_forgiveSub' }
  const rows = TOGGLES.map((k) => {
    const s = sub[k]
    return `<div class="opt"><label>${t(`as_${k}` as TKey)}${s ? `<br><small class="muted">${t(s)}</small>` : ''}</label><button class="toggle ${a[k] ? 'on' : ''}" data-assist-tog="${k}" role="switch" aria-checked="${a[k]}"></button></div>`
  })
  rows.push(`<div class="opt"><label>${t('as_speedSteer')}</label><input type="range" min="0" max="1" step="0.25" value="${a.speedSteer}" data-assist-speed></div>`)
  rows.push(`<div class="opt"><label class="muted">${t('as_gearbox')}</label></div>`)
  return head + rows.join('')
}

export function bindAssists(root: HTMLElement, a: AssistSettings, changed: (redraw: boolean) => void): void {
  root.querySelectorAll<HTMLElement>('[data-assist]').forEach((b) => b.addEventListener('click', () => {
    const l = b.dataset.assist as AssistLevel
    Object.assign(a, { preset: l, ...PRESETS[l] })
    changed(true)
  }))
  root.querySelectorAll<HTMLElement>('[data-assist-tog]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.assistTog as AssistToggle
    a[k] = !a[k]
    changed(true)
  }))
  root.querySelector<HTMLInputElement>('[data-assist-speed]')?.addEventListener('change', (e) => {
    a.speedSteer = Number((e.target as HTMLInputElement).value)
    changed(true)
  })
}

interface RivalRow {
  rival: number
  name: string
  nat: string
}

/** The rivals for a race: flag, name, style, and what they have to say for themselves. */
export function rivalsHtml(rows: readonly RivalRow[], ids: readonly string[], withBio: boolean): string {
  const L = currentLang()
  return rows.map((r, i) => {
    const c = character(ids[i] ?? '')
    return `<p style="margin:8px 0"><b>${flag(r.nat)} ${esc(r.name)}</b>${c ? ` · <span class="kicker">${esc(c.style[L])}</span>` : ''}
      ${c ? `<br><small class="muted">${withBio ? `${esc(c.bio[L])} ` : ''}<i>${esc(c.quote[L])}</i></small>` : ''}</p>`
  }).join('')
}

/** One line for a rival in a results table: style and catchphrase. */
export function rivalTag(id: string): string {
  const c = character(id)
  if (!c) return ''
  const L = currentLang()
  return `<br><small class="muted">${esc(c.style[L])} · <i>${esc(c.quote[L])}</i></small>`
}
