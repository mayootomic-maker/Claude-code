import { FINISHES } from '../data'
import { t } from '../game/i18n'
import { BROWS, GLASSES, HAIR, HAIR_COLOURS, HELMET_PATTERNS, MOUSTACHE, PALETTE, PRINTS, SKIN_TONES, VISORS, defaultLook, playerLivery, rivalLook, type DriverLook, type HelmetLook } from '../game/paint'
import { toast } from './dom'
import { bindPalette, bindSeg, bindStage, bindToggle, css, palette, pt, seg, stage, toggle, type GarageCtx } from './paint-ui'

/**
 * The driver editor: our man's helmet, face, hair and shirt, previewed on
 * him in his seat with the camera close on his face. Still no race suit:
 * the helmet is the only protection he believes in.
 */

type HSlot = 'base' | 'secondary' | 'accent'
type SSlot = 'shirt' | 'printColor' | 'shorts'
const H_LABEL: Record<HSlot, string> = { base: 'base', secondary: 'secondary', accent: 'accent' }
const S_LABEL: Record<SSlot, string> = { shirt: 'shirt', printColor: 'printColour', shorts: 'shorts' }

const clone = (l: DriverLook): DriverLook => ({ ...l, helmet: { ...l.helmet } })

export function openDriverEditor(ctx: GarageCtx): void {
  const s = ctx.store.save
  let look = clone(s.driver)
  let hslot: HSlot = 'base'
  let sslot: SSlot = 'shirt'
  let helmetOn = false
  let first = true
  let queued = false
  const preview = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      ctx.showcase().setDriver(clone(look), s.name)
    })
  }
  const hchips = () => ({ base: look.helmet.base, secondary: look.helmet.secondary, accent: look.helmet.accent })
  const schips = () => ({ shirt: look.shirt, printColor: look.printColor, shorts: look.shorts })

  const render = () => `
    <button class="back" data-back>${t('back')}</button>
    <div class="garage">
      <div class="card">
        <p class="kicker">${pt('driverEdit')}</p>
        <h1 class="display">${pt('helmet')}</h1>
        <p class="kicker ps-sec">${pt('pattern')}</p>
        ${seg('hpat', HELMET_PATTERNS, look.helmet.pattern)}
        <p class="kicker ps-sec">${pt('colours')}</p>
        ${seg('hslot', ['base', 'secondary', 'accent'], hslot, hchips(), (k) => pt(H_LABEL[k as HSlot]))}
        ${palette('hcol', PALETTE, look.helmet[hslot])}
        <p class="kicker ps-sec">${pt('finish')}</p>
        ${seg('hfin', FINISHES, look.helmet.finish)}
        <p class="kicker ps-sec">${pt('visor')}</p>
        ${seg('visor', VISORS, look.helmet.visor)}
        <p class="kicker ps-sec">${pt('shirt')}</p>
        ${seg('print', PRINTS, look.print)}
        ${seg('sslot', ['shirt', 'printColor', 'shorts'], sslot, schips(), (k) => pt(S_LABEL[k as SSlot]))}
        ${palette('scol', PALETTE, look[sslot])}
      </div>
      ${stage()}
      <div class="card">
        <h1 class="display">${pt('face')}</h1>
        ${toggle('helmetOn', pt('helmetOn'), helmetOn)}
        <p class="kicker ps-sec">${pt('skin')}</p>
        ${palette('skin', SKIN_TONES, look.skin)}
        <p class="kicker ps-sec">${pt('hair')}</p>
        ${seg('hair', HAIR, look.hair)}
        <p class="kicker ps-sec">${pt('hairColour')}</p>
        ${palette('hairc', HAIR_COLOURS, look.hairColor)}
        <p class="kicker ps-sec">${pt('moustache')}</p>
        ${seg('moustache', MOUSTACHE, look.moustache)}
        <p class="kicker ps-sec">${pt('brows')}</p>
        ${seg('brows', BROWS, look.brows)}
        <p class="kicker ps-sec">${pt('glasses')}</p>
        ${seg('glasses', GLASSES, look.glasses)}
        <div class="ps-actions">
          <button class="btn" data-dsave>${pt('save')}</button>
          <button class="btn ghost" data-surprise>${pt('surprise')}</button>
          <button class="btn ghost" data-dreset>${pt('reset')}</button>
        </div>
      </div>
    </div>`

  const bind = (root: HTMLElement) => {
    const sc = ctx.showcase()
    if (first) {
      sc.setCar(ctx.car, playerLivery(s, ctx.car), { look: clone(look), name: s.name })
      sc.frame('driver')
      sc.helmet(helmetOn)
      first = false
    } else preview()
    bindStage(root, sc, 'driver')
    const redraw = () => {
      root.innerHTML = render()
      root.querySelectorAll<HTMLElement>('[data-back]').forEach((b) => b.addEventListener('click', () => ctx.back()))
      bind(root)
    }
    const on = <K extends keyof DriverLook>(name: string, key: K) => bindSeg(root, name, (v) => {
      look = { ...look, [key]: v }
      preview()
    })
    const onH = <K extends keyof HelmetLook>(name: string, key: K) => bindSeg(root, name, (v) => {
      look = { ...look, helmet: { ...look.helmet, [key]: v } }
      // The helmet comes back on to show off a new helmet design.
      if (!helmetOn) {
        helmetOn = true
        sc.helmet(true)
        root.querySelector('[data-tog="helmetOn"]')?.classList.add('on')
      }
      preview()
    })
    onH('hpat', 'pattern')
    onH('hfin', 'finish')
    onH('visor', 'visor')
    on('print', 'print')
    on('hair', 'hair')
    on('moustache', 'moustache')
    on('brows', 'brows')
    on('glasses', 'glasses')
    const hpal = bindPalette(root, 'hcol', (c) => {
      look = { ...look, helmet: { ...look.helmet, [hslot]: c } }
      const chip = root.querySelector<HTMLElement>(`[data-seg="hslot"] [data-v="${hslot}"] i`)
      if (chip) chip.style.background = css(c)
      preview()
    })
    bindSeg(root, 'hslot', (v) => {
      hslot = v as HSlot
      hpal.set(look.helmet[hslot])
    })
    const spal = bindPalette(root, 'scol', (c) => {
      look = { ...look, [sslot]: c }
      const chip = root.querySelector<HTMLElement>(`[data-seg="sslot"] [data-v="${sslot}"] i`)
      if (chip) chip.style.background = css(c)
      preview()
    })
    bindSeg(root, 'sslot', (v) => {
      sslot = v as SSlot
      spal.set(look[sslot])
    })
    bindPalette(root, 'skin', (c) => {
      look = { ...look, skin: c }
      preview()
    })
    bindPalette(root, 'hairc', (c) => {
      look = { ...look, hairColor: c }
      preview()
    })
    bindToggle(root, 'helmetOn', (v) => {
      helmetOn = v
      sc.helmet(v)
    })
    root.querySelector('[data-dsave]')?.addEventListener('click', () => {
      s.driver = clone(look)
      ctx.store.write()
      toast(pt('driverSaved'))
    })
    root.querySelector('[data-surprise]')?.addEventListener('click', () => {
      look = rivalLook((Math.random() * 1e9) | 0)
      redraw()
    })
    root.querySelector('[data-dreset]')?.addEventListener('click', () => {
      look = defaultLook()
      redraw()
    })
  }
  ctx.menu(render, bind)
}
