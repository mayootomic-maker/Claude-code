import { CARS, DECAL_KEYS, FINISHES, LIVERIES, NUM_FONTS, PATTERNS, type Decals, type LiveryDef } from '../data'
import { PALETTE, PER_CAR, SPONSORS, cleanNum, cleanText, customFrom, newCustomId, playerLivery, toLivery, type CustomLivery } from '../game/paint'
import { level } from '../game/career'
import { patternThumb } from '../render/livery-paint'
import { esc, toast } from './dom'
import { t } from '../game/i18n'
import { bindPalette, bindSeg, bindStage, bindToggle, css, palette, pt, seg, stage, toggle, type GarageCtx } from './paint-ui'

/**
 * The paint shop: design a livery for the car on the turntable, watch it
 * repaint live, and keep up to PER_CAR of them per car. Everything is
 * drawn into the car's one livery texture, so a custom job costs no more to
 * render than a team livery.
 */

type Slot = 'base' | 'stripe' | 'accent' | 'rim'
const SLOTS: readonly Slot[] = ['base', 'stripe', 'accent', 'rim']
const SLOT_LABEL: Record<Slot, string> = { base: 'primary', stripe: 'secondary', accent: 'accent', rim: 'wheels' }

/** Team liveries the player may start from: the ones they own. */
function owned(ctx: GarageCtx): LiveryDef[] {
  const s = ctx.store.save
  const lv = level(s.xp).level
  return LIVERIES.filter((l) => l.unlock.type === 'none' || s.owned.liveries.includes(l.id) || (l.unlock.type === 'level' && lv >= l.unlock.n))
}

export function openPaintShop(ctx: GarageCtx): void {
  const s = ctx.store.save
  const car = CARS.find((c) => c.id === ctx.car) ?? CARS[0]
  const mine = () => s.customLiveries.filter((c) => c.car === car.id)
  // Start from what's on the car: the chosen custom job, or a fresh copy of the preset.
  const onCar = s.carLivery[car.id]
  const start = mine().find((c) => c.id === onCar)
  let editing: string | null = start?.id ?? null
  let draft: CustomLivery = start ? { ...start, decals: { ...start.decals } } : customFrom(playerLivery(s, car.id), car.id, newCustomId(s.customLiveries), pt('myLivery'))
  if (!start) draft.window = s.name
  let slot: Slot = 'base'
  let queued = false
  let first = true
  const preview = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      ctx.showcase().repaint(toLivery(draft))
    })
  }

  const listHtml = () => {
    const list = mine()
    return list.length
      ? list.map((c) => `<button class="swatch ${c.id === editing ? 'sel' : ''}" data-mine="${c.id}"><span class="chip" style="background:linear-gradient(135deg,${css(c.base)} 50%,${css(c.stripe)} 50%,${css(c.stripe)} 70%,${css(c.accent)} 70%)"></span><span>${esc(c.name)}<small>${pt(c.pattern)} · ${pt(c.finish)}${s.carLivery[car.id] === c.id ? ` · <b>${pt('onCar')}</b>` : ''}</small></span></button>`).join('')
      : `<p class="ps-empty">${pt('none')}</p>`
  }
  const thumbs = () => PATTERNS.map((p) => `<button class="ps-pat ${p === draft.pattern ? 'sel' : ''}" data-pat="${p}"><img alt="" src="${patternThumb(p, draft.base, draft.stripe, draft.accent)}"><span>${pt(p)}</span></button>`).join('')
  const chips = () => Object.fromEntries(SLOTS.map((k) => [k, draft[k]])) as Record<string, number>

  const render = () => `
    <button class="back" data-back>${t('back')}</button>
    <div class="garage">
      <div class="card">
        <p class="kicker">${esc(car.name)}</p>
        <h1 class="display">${pt('paintShop')}</h1>
        <p class="kicker ps-sec">${pt('template')}</p>
        <div class="ps-pats" data-pats>${thumbs()}</div>
        <p class="kicker ps-sec">${pt('colours')}</p>
        <div data-slots>${seg('slot', SLOTS, slot, chips(), (k) => pt(SLOT_LABEL[k as Slot]))}</div>
        ${palette('paint', PALETTE, draft[slot])}
        <p class="kicker ps-sec">${pt('finish')}</p>
        ${seg('finish', FINISHES, draft.finish)}
        <p class="kicker ps-sec">${pt('number')}</p>
        <div class="ps-opt"><span>${pt('number')}</span><input type="text" maxlength="3" value="${esc(draft.num)}" data-num></div>
        ${seg('font', NUM_FONTS, draft.font)}
        <p class="kicker ps-sec">${pt('decals')}</p>
        ${DECAL_KEYS.map((k) => toggle(k, pt(k), draft.decals[k])).join('')}
        <div class="ps-opt"><span>${pt('sponsor')}</span><select data-sponsor>${SPONSORS.map((x) => `<option ${x === draft.sponsor ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
        <div class="ps-opt"><span>${pt('windowName')}</span><input type="text" maxlength="16" value="${esc(draft.window)}" data-window></div>
      </div>
      ${stage()}
      <div class="card">
        <div class="ps-opt"><span class="kicker">${pt('liveryName')}</span><input type="text" maxlength="20" value="${esc(draft.name)}" data-lname></div>
        <div class="ps-actions">
          <button class="btn" data-apply>${pt('apply')}</button>
          <button class="btn ghost" data-save>${pt('save')}</button>
          <button class="btn ghost" data-savenew>${pt('saveNew')}</button>
          <button class="btn ghost" data-del ${editing ? '' : 'disabled'}>${pt('delete')}</button>
        </div>
        <p class="kicker ps-sec">${pt('mine')} · ${mine().length}/${PER_CAR}</p>
        <div class="swatches ps-list" data-list>${listHtml()}</div>
        <p class="kicker ps-sec">${pt('startFrom')}</p>
        <div class="swatches">${owned(ctx).map((l) => `<button class="swatch" data-from="${l.id}"><span class="chip" style="background:linear-gradient(135deg,${css(l.base)} 55%,${css(l.stripe)} 55%)"></span><span>${esc(l.name)}<small>${pt(l.pattern)} · ${pt(l.finish ?? 'gloss')}</small></span></button>`).join('')}</div>
      </div>
    </div>`

  const bind = (root: HTMLElement) => {
    const sc = ctx.showcase()
    if (first) {
      sc.frame('car')
      sc.helmet(true)
      sc.setCar(car.id, toLivery(draft), { look: s.driver, name: s.name })
      first = false
    } else preview()
    bindStage(root, sc, 'car')
    const refreshThumbs = () => {
      const el = root.querySelector<HTMLElement>('[data-pats]')
      if (el) el.innerHTML = thumbs()
      bindPats()
    }
    const bindPats = () => root.querySelectorAll<HTMLElement>('[data-pat]').forEach((b) => b.addEventListener('click', () => {
      draft.pattern = (b.dataset.pat as CustomLivery['pattern']) ?? draft.pattern
      root.querySelectorAll('[data-pat]').forEach((x) => x.classList.toggle('sel', x === b))
      preview()
    }))
    bindPats()
    const pal = bindPalette(root, 'paint', (c) => {
      draft[slot] = c
      const chip = root.querySelector<HTMLElement>(`[data-seg="slot"] [data-v="${slot}"] i`)
      if (chip) chip.style.background = css(c)
      preview()
      if (slot !== 'rim') thumbTimer()
    })
    let tt = 0
    // Thumbnails follow the colours, but not on every tick of a colour drag.
    const thumbTimer = () => {
      clearTimeout(tt)
      tt = window.setTimeout(refreshThumbs, 250)
    }
    bindSeg(root, 'slot', (v) => {
      slot = v as Slot
      pal.set(draft[slot])
    })
    bindSeg(root, 'finish', (v) => {
      draft.finish = v as CustomLivery['finish']
      preview()
    })
    bindSeg(root, 'font', (v) => {
      draft.font = v as CustomLivery['font']
      preview()
    })
    for (const k of DECAL_KEYS) bindToggle(root, k, (on) => {
      draft.decals = { ...draft.decals, [k]: on } as Decals
      preview()
    })
    const num = root.querySelector<HTMLInputElement>('[data-num]')
    num?.addEventListener('input', () => {
      draft.num = cleanNum(num.value, draft.num)
      preview()
    })
    num?.addEventListener('change', () => (num.value = draft.num))
    const win = root.querySelector<HTMLInputElement>('[data-window]')
    win?.addEventListener('input', () => {
      draft.window = cleanText(win.value, 16).trim()
      preview()
    })
    const sp = root.querySelector<HTMLSelectElement>('[data-sponsor]')
    sp?.addEventListener('change', () => {
      draft.sponsor = (SPONSORS as readonly string[]).includes(sp.value) ? sp.value : draft.sponsor
      preview()
    })
    const lname = root.querySelector<HTMLInputElement>('[data-lname]')
    lname?.addEventListener('input', () => (draft.name = cleanText(lname.value, 20).trim() || pt('myLivery')))

    /** Re-renders the whole screen in place (after a save or load), keeping the Back history as it was. */
    const redraw = () => {
      const view = root
      view.innerHTML = render()
      view.querySelectorAll<HTMLElement>('[data-back]').forEach((b) => b.addEventListener('click', () => ctx.back()))
      bind(view)
    }
    const store = (asNew: boolean): boolean => {
      const list = s.customLiveries
      const i = editing && !asNew ? list.findIndex((c) => c.id === editing) : -1
      if (i >= 0) list[i] = { ...draft, decals: { ...draft.decals } }
      else {
        if (mine().length >= PER_CAR) {
          toast(pt('full', { n: PER_CAR }))
          return false
        }
        draft = { ...draft, id: newCustomId(list), decals: { ...draft.decals } }
        list.push({ ...draft, decals: { ...draft.decals } })
        editing = draft.id
      }
      ctx.store.write()
      return true
    }
    root.querySelector('[data-save]')?.addEventListener('click', () => {
      if (store(false)) {
        toast(pt('saved'))
        redraw()
      }
    })
    root.querySelector('[data-savenew]')?.addEventListener('click', () => {
      if (store(true)) {
        toast(pt('saved'))
        redraw()
      }
    })
    root.querySelector('[data-apply]')?.addEventListener('click', () => {
      if (!store(false) || !editing) return
      s.carLivery[car.id] = editing
      ctx.store.write()
      toast(pt('applied'))
      redraw()
    })
    root.querySelector('[data-del]')?.addEventListener('click', () => {
      if (!editing) return
      s.customLiveries = s.customLiveries.filter((c) => c.id !== editing)
      if (s.carLivery[car.id] === editing) delete s.carLivery[car.id]
      ctx.store.write()
      toast(pt('deleted'))
      editing = null
      draft = { ...draft, id: newCustomId(s.customLiveries) }
      redraw()
    })
    root.querySelectorAll<HTMLElement>('[data-mine]').forEach((b) => b.addEventListener('click', () => {
      const c = mine().find((x) => x.id === b.dataset.mine)
      if (!c) return
      editing = c.id
      draft = { ...c, decals: { ...c.decals } }
      redraw()
    }))
    root.querySelectorAll<HTMLElement>('[data-from]').forEach((b) => b.addEventListener('click', () => {
      const l = LIVERIES.find((x) => x.id === b.dataset.from)
      if (!l) return
      editing = null
      draft = customFrom({ ...l, window: draft.window }, car.id, newCustomId(s.customLiveries), l.name)
      redraw()
    }))
  }
  ctx.menu(render, bind)
}
