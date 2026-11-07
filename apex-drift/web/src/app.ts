import { Audio, engineProfileFor, haptic } from './audio/audio'
import { asset } from './core/assets'
import { clamp } from './core/math'
import { CARS, LIVERIES, RALLIES, SCHOOL, carPhys, type LiveryDef, type RallyDef } from './data'
import { CoDriver } from './game/codriver'
import { level, medalFor, raceReward, rallyReward, stageMedals, stageReward, standings, unlocked, type Medal } from './game/career'
import { setLang, subtitle, t, type TKey } from './game/i18n'
import { Controls } from './game/input'
import { paceNotes } from './game/pacenotes'
import { GhostRecorder, loadGhost, saveGhost } from './game/ghost'
import { Director, emptyFrame, ReplayRecorder, type Replay, type ReplayFrame } from './game/replay'
import { dailyChallenge, streak } from './game/daily'
import { openStore, type Settings, type Store } from './game/save'
import { CHEATS, findCheat, OWNER, unlockAll, type CheatState } from './game/owner'
import { Showcase } from './render/showcase'
import { openPaintShop } from './ui/paintshop'
import { openDriverEditor } from './ui/driver-edit'
import { pt, type GarageCtx } from './ui/paint-ui'
import { findLivery, playerLivery, playerLiveryId } from './game/paint'
import { Renderer, StageView, type Tier } from './render/view'
import { DT, type Pose } from './sim/car'
import { raceGrid } from './sim/race'
import { autopilot, StageSim, type Difficulty } from './sim/stage'
import { BODY } from './sim/terrain'
import { $, CHEVRON, esc, fmtTime, html, toast } from './ui/dom'
import { Hud } from './ui/hud'

const VERSION = '3.0.0'
type Screen = 'sting' | 'title' | 'menu' | 'loading' | 'race'
type RacePhase = 'intro' | 'countdown' | 'running' | 'finished' | 'results' | 'replay'

interface RaceCtx {
  rally: RallyDef
  stageIdx: number
  mode: 'career' | 'free' | 'school' | 'daily' | 'race'
  sim: StageSim
  view: StageView
  hud: Hud
  codriver: CoDriver
  phase: RacePhase
  introT: number
  finishT: number
  paused: boolean
  gold: number | null
  school: School | null
  cheered: Set<number>
  benchmark: number[] | null
  /** Rolling snapshots for rewind, newest last, ~6 per second for the last 6 s. */
  history: { car: Snap; sim: Snap }[]
  rewinds: number
  sectors: number
  recorder: GhostRecorder
  /** Full-detail recording for the replay after the finish. */
  tape: ReplayRecorder
  replay: { data: Replay; t: number; speed: number; dir: Director; frame: ReplayFrame; bar: HTMLElement } | null
  /** Photo mode: an orbit camera around the paused car. */
  photo: { yaw: number; pitch: number; dist: number; capture: boolean; bar: HTMLElement; drag: { x: number; y: number } | null } | null
}

const tapePose: Pose = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0, steer: 0, spin: 0 }

type Snap = Record<string, unknown>

/**
 * Copies the plain state of an object (numbers, flags, small plain objects
 * and number arrays), skipping references like the route or ground. Generic
 * on purpose: the car's physics state can grow without rewind knowing.
 */
function snap(o: object): Snap {
  const out: Snap = {}
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') out[k] = v
    else if (Array.isArray(v) && v.every((x) => typeof x === 'number')) out[k] = v.slice()
    else if (ArrayBuffer.isView(v) && v instanceof Float64Array) out[k] = v.slice()
    else if (ArrayBuffer.isView(v) && v instanceof Float32Array) out[k] = v.slice()
    else if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) out[k] = { ...v }
  }
  return out
}

function restore(o: object, s: Snap): void {
  const t = o as Record<string, unknown>
  for (const [k, v] of Object.entries(s)) {
    const cur = t[k]
    if (cur instanceof Float64Array || cur instanceof Float32Array) cur.set(v as ArrayLike<number>)
    else if (Array.isArray(v)) t[k] = v.slice()
    else if (cur && typeof cur === 'object' && v && typeof v === 'object') Object.assign(cur, v)
    else t[k] = v
  }
}

const REWINDS: Record<string, number> = { rookie: 5, driver: 3, pro: 1 }
const REWIND_PENALTY = 2

interface School {
  step: number
  shownAt: number
  hairpin: number
  firstCall: string | null
}

const native = (): { exitApp?: () => void; version?: () => string; desktop?: boolean } | undefined =>
  (window as unknown as { ApexNative?: { exitApp(): void; version(): string; desktop?: boolean } }).ApexNative

export class App {
  private readonly store: Store
  private readonly audio = new Audio()
  private readonly renderer: Renderer
  private readonly controls: Controls
  private screen: Screen = 'sting'
  private race: RaceCtx | null = null
  private acc = 0
  private last = performance.now()
  private menuStack: (() => void)[] = []
  private perf = false
  private storage: Storage | null = null
  private showcase: Showcase | null = null
  private attract: { sim: StageSim; view: StageView; acc: number } | null = null
  private frameMs: number[] = []
  private readonly cheat: CheatState = { turbo: false }
  private readonly ui: Record<'sting' | 'title' | 'menu' | 'loading' | 'hud' | 'overlay', HTMLElement>

  constructor(private readonly canvas: HTMLCanvasElement) {
    let storage: Storage | null = null
    try {
      storage = window.localStorage
    } catch {
      storage = null
    }
    this.store = openStore(storage)
    this.storage = storage
    if (OWNER) {
      unlockAll(this.store.save)
      this.store.write()
    }
    const s = this.store.save
    setLang(s.settings.lang)
    document.documentElement.style.setProperty('--text', String(s.settings.textSize))
    const tier: Tier = s.settings.quality !== 'auto' ? s.settings.quality : s.tier ?? 'medium'
    this.renderer = new Renderer(canvas, tier)
    this.controls = new Controls(() => this.store.save.settings)
    this.controls.onAction = (a) => this.action(a)
    this.ui = {
      sting: $('#sting'), title: $('#title'), menu: $('#menu'), loading: $('#loading'), hud: $('#hud'), overlay: $('#overlay'),
    }
    if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch')
    addEventListener('touchstart', () => document.body.classList.add('touch'), { once: true, passive: true })
    addEventListener('resize', () => this.resize())
    addEventListener('keydown', (e) => this.desktopKey(e))
    addEventListener('apex:pause', () => this.background())
    document.addEventListener('visibilitychange', () => document.hidden && this.background())
    ;(window as unknown as { __apexBack: () => boolean }).__apexBack = () => this.back()
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      this.contextLost()
    })
    this.audio.onSay = (w) => {
      if (this.store.save.settings.subtitles && this.race) this.race.hud.subtitle(subtitle(w))
    }
    if (this.store.recovered) setTimeout(() => toast(t('saveRecovered'), 6000), 3000)
    else if (this.store.volatile) setTimeout(() => toast(t('saveVolatile'), 6000), 3000)
    // Ask the browser to keep our storage; it may say no, which is why saves are validated.
    void navigator.storage?.persist?.()
    this.resize()
    this.sting()
    requestAnimationFrame((n) => this.loop(n))
  }

  // ======================================================================= flow

  private show(s: Screen): void {
    this.screen = s
    for (const k of ['sting', 'title', 'menu', 'loading'] as const) this.ui[k].classList.toggle('hidden', k !== s)
    this.ui.hud.classList.toggle('hidden', s !== 'race')
    document.body.classList.toggle('driving', s === 'race')
  }

  private sting(): void {
    this.show('sting')
    html(this.ui.sting, `<div><div class="mark">${CHEVRON}</div><p class="studio">TOMIĆ <b>STUDIOS</b></p><p class="presents">${t('presents')}</p></div>`)
    const go = () => {
      clearTimeout(timer)
      removeEventListener('pointerdown', go)
      removeEventListener('keydown', go)
      this.title()
    }
    const timer = window.setTimeout(go, 2600)
    addEventListener('pointerdown', go, { once: true })
    addEventListener('keydown', go, { once: true })
  }

  private title(): void {
    this.show('title')
    html(this.ui.title, `
      <p class="kicker">Tomić Studios</p>
      <h1 class="wordmark display"><span>Apex </span><span>Drift</span></h1>
      <p class="tag">${t('tagline')}</p>
      <p class="tap">${document.body.classList.contains('touch') ? t('tapToStart') : t('pressKey')}</p>
      <p class="ver">${t('version', { v: VERSION })}</p>`)
    // A live stage behind the logo once it's built; the still picture covers the wait.
    setTimeout(() => this.startAttract(), 50)
    const go = () => {
      removeEventListener('keydown', go)
      this.ui.title.removeEventListener('pointerdown', go)
      this.stopAttract()
      this.audio.unlock()
      this.applyMix()
      this.audio.playMusic('menu')
      void this.audio.loadVoice(this.store.save.settings.voiceLang)
      // First run goes straight to the driving school.
      if (!this.store.save.tutorialDone) this.startSchool()
      else this.home()
    }
    this.ui.title.addEventListener('pointerdown', go)
    addEventListener('keydown', go)
  }

  /** Title-screen attract mode: a car driving a golden-hour stage by itself. */
  private startAttract(): void {
    if (this.attract || this.screen !== 'title') return
    try {
      const rally = RALLIES[0]
      const sim = new StageSim({ rally, stage: rally.stages[1], car: 'kestrel', difficulty: 'driver' })
      for (let i = 0; i < 60 * 8; i++) sim.step(autopilot(sim, 0.8))
      const view = new StageView(sim, this.renderer, LIVERIES[0])
      view.camMode = 'near'
      view.resize(innerWidth, innerHeight)
      view.syncCar(1)
      view.snapCamera()
      view.prewarm()
      if (this.screen !== 'title') {
        view.dispose()
        return
      }
      this.attract = { sim, view, acc: 0 }
      this.ui.title.classList.add('live')
    } catch {
      // The still picture stays; the title works without the live stage.
    }
  }

  private stopAttract(): void {
    this.attract?.view.dispose()
    this.attract = null
    this.ui.title.classList.remove('live')
  }

  private menu(render: () => string, bind: (root: HTMLElement) => void, art?: string, push = true): void {
    this.show('menu')
    if (push) this.menuStack.push(() => this.menu(render, bind, art, false))
    const s = this.store.save
    const lv = level(s.xp)
    // Absolute URL: a relative url() inside a custom property resolves against the stylesheet's folder.
    this.ui.menu.style.setProperty('--menu-art', art && art !== 'showcase' ? `url('${new URL(art, location.href).href}')` : 'none')
    this.ui.menu.classList.toggle('see-through', art === 'showcase')
    if (art !== 'showcase') this.closeShowcase()
    html(this.ui.menu, `
      <header class="topbar"><span class="brand">${CHEVRON}APEX DRIFT</span>${OWNER ? '<span class="pill owner">OWNER</span>' : ''}<span class="spacer"></span>
        <span class="pill">${esc(s.name)} · ${t('level', { n: lv.level })}</span><span class="pill"><b>${s.credits.toLocaleString()}</b> cr</span></header>
      <main class="view">${render()}</main>`)
    const root = $('.view', this.ui.menu)
    root.querySelectorAll<HTMLElement>('[data-back]').forEach((b) => b.addEventListener('click', () => this.back()))
    root.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) this.audio.click()
    })
    bind(root)
  }

  private home(): void {
    this.menuStack = []
    const s = this.store.save
    const ev = s.event
    const nextRally = ev ? RALLIES.find((r) => r.id === ev.rally) : RALLIES.find((r, i) => unlocked(s, i) && !s.finished.includes(r.id)) ?? RALLIES[0]
    const careerSub = ev && nextRally ? t('continueRally', { rally: nextRally.name }) : t('careerSub')
    const daily = dailyChallenge(new Date())
    const streakN = streak(s.daily.days, new Date())
    this.menu(() => `
      <div class="home">
        <button class="tile big" data-go="career" style="background-image:url('${asset(`img/c-${nextRally?.id ?? 'finland'}.jpg`)}')"><span class="kicker">${esc(careerSub)}</span><span class="t display">${t('career')}</span></button>
        <button class="tile" data-go="free" style="background-image:url('${asset(`img/free.jpg`)}')"><span class="t display">${t('quickStage')}</span><span class="s">${t('quickSub')}</span></button>
        <button class="tile" data-go="race" style="background-image:url('${asset(`img/c-kenya.jpg`)}')"><span class="t display">${t('race')}</span><span class="s">${t('raceSub')}</span></button>
        <button class="tile" data-go="daily" style="background-image:url('${asset(`img/c-${daily.base}.jpg`)}')"><span class="kicker">${s.daily.best[daily.key] ? t('dailyBest', { time: fmtTime(s.daily.best[daily.key]) }) : streakN ? t('streak', { n: streakN }) : ''}</span><span class="t display">${t('daily')}</span><span class="s">${t('dailySub', { rally: esc(daily.rally.name), car: esc(CARS.find((c) => c.id === daily.car)?.name ?? '') })}</span></button>
        <button class="tile" data-go="school" style="background-image:url('${asset(`img/c-finland.jpg`)}')"><span class="t display">${t('school')}</span><span class="s">${t('schoolSub')}</span></button>
        <button class="tile" data-go="garage" style="background-image:url('${asset(`img/garage.jpg`)}')"><span class="t display">${t('garage')}</span><span class="s">${t('garageSub')}</span></button>
        <button class="tile" data-go="options"><span class="t display">${t('options')}</span></button>
        <button class="tile" data-go="credits"><span class="t display">${t('credits')}</span></button>
        ${native()?.desktop ? `<button class="tile" data-go="exit"><span class="t display">${t('quitGame')}</span></button>` : ''}
      </div>`, (root) => {
      root.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => b.addEventListener('click', () => {
        const go = b.dataset.go
        if (go === 'career') this.careerList('career')
        else if (go === 'free') this.careerList('free')
        else if (go === 'race') this.careerList('race')
        else if (go === 'school') this.startSchool()
        else if (go === 'daily') this.load(daily.rally, 0, 'daily', daily.car)
        else if (go === 'garage') this.garage()
        else if (go === 'options') this.options('controls')
        else if (go === 'exit') native()?.exitApp?.()
        else this.creditsScreen()
      }))
    }, asset('img/garage.jpg'))
  }

  private careerList(mode: 'career' | 'free' | 'race'): void {
    const s = this.store.save
    this.menu(() => `
      <button class="back" data-back>${t('back')}</button>
      <h1 class="display">${mode === 'career' ? t('career') : mode === 'race' ? t('race') : t('quickStage')}</h1>
      <div class="rallies">${RALLIES.map((r, i) => {
        const open = unlocked(s, i)
        const medals = r.stages.map((_, k) => s.best[`${r.id}:${k}:${s.settings.difficulty}`]?.medal ?? null)
        return `<button class="tile rally ${open ? '' : 'locked'}" data-r="${i}" style="background-image:url('${asset(`img/c-${r.id}.jpg`)}');animation-delay:${i * 30}ms" ${open ? '' : 'aria-disabled="true"'}>
          <span class="kicker"><span class="flag">${r.flag.map((c) => `<i style="background:${c}"></i>`).join('')}</span>${esc(r.nation)}</span>
          <span class="t display">${esc(r.name)}</span>
          <span class="s">${open ? t('stages', { n: r.stages.length, km: r.stages.reduce((a, x) => a + x.km, 0).toFixed(1) }) : t('locked', { rally: RALLIES[i - 1]?.name ?? '' })}</span>
          <span class="medals">${medals.map((m) => `<span class="medal ${m ?? ''}"></span>`).join('')}</span>
        </button>`
      }).join('')}</div>`, (root) => {
      root.querySelectorAll<HTMLElement>('[data-r]').forEach((b) => b.addEventListener('click', () => {
        const i = Number(b.dataset.r)
        if (!unlocked(this.store.save, i)) {
          toast(t('locked', { rally: RALLIES[i - 1]?.name ?? '' }))
          return
        }
        this.rallyDetail(RALLIES[i], mode)
      }))
    })
  }

  private rallyDetail(r: RallyDef, mode: 'career' | 'free' | 'race', sel = 0): void {
    const s = this.store.save
    const d = s.settings.difficulty
    const ev = s.event && s.event.rally === r.id ? s.event : null
    this.menu(() => `
      <button class="back" data-back>${t('back')}</button>
      <div class="detail">
        <div class="card">
          <p class="kicker">${esc(r.nation)} · ${t(`surface_${r.surface}` as TKey)}</p>
          <h1 class="display">${esc(r.name)}</h1>
          <p class="muted">${esc(r.blurb)}</p>
          <p class="kicker" style="margin-top:16px">${t('difficulty')}</p>
          <div class="seg" role="radiogroup">${(['rookie', 'driver', 'pro'] as Difficulty[]).map((x) => `<button class="${x === d ? 'on' : ''}" data-d="${x}" role="radio" aria-checked="${x === d}">${t(x)}</button>`).join('')}</div>
          <p class="muted" style="font-size:0.88em">${t(`${d}Sub` as TKey)}</p>
          ${mode === 'career' ? `<div class="row" style="margin-top:14px">
            <button class="btn" data-start>${ev ? t('resumeRally', { n: ev.times.length + 1 }) : t('startRally')}</button>
            ${ev ? `<button class="btn ghost" data-abandon>${t('abandon')}</button>` : ''}</div>` : ''}
        </div>
        <div class="card stagelist">${r.stages.map((st, k) => {
          const best = s.best[`${r.id}:${k}:${d}`]
          const done = ev && k < ev.times.length
          return `<button class="stagerow ${mode !== 'career' && k === sel ? 'sel' : ''}" data-k="${k}">
            <span class="n">${k + 1}</span>
            <span class="meta">${esc(st.name)}${st.power ? ` · <b style="color:var(--amber)">${t('power')}</b>` : ''}
              <small>${st.km.toFixed(1)} km · ${t(`look_${st.look}` as TKey)} · ${t(`weather_${st.weather}` as TKey)}${done ? ` · ${fmtTime(ev.times[k])}` : ''}</small></span>
            <span class="medal ${best?.medal ?? ''}" title="${best ? t('best', { time: fmtTime(best.time) }) : t('noTime')}"></span>
          </button>`
        }).join('')}
        ${mode === 'free' ? `<button class="btn wide" data-drive style="margin-top:8px">${t('driveStage')}</button>` : ''}
        ${mode !== 'career' ? `<button class="btn wide ${mode === 'race' ? '' : 'ghost'}" data-race style="margin-top:8px">${t('raceStage')}</button>` : ''}</div>
      </div>`, (root) => {
      root.querySelectorAll<HTMLElement>('[data-d]').forEach((b) => b.addEventListener('click', () => {
        this.store.save.settings.difficulty = b.dataset.d as Difficulty
        this.store.write()
        this.menuStack.pop()
        this.rallyDetail(r, mode, sel)
      }))
      root.querySelectorAll<HTMLElement>('[data-k]').forEach((b) => b.addEventListener('click', () => {
        if (mode === 'career') return
        this.menuStack.pop()
        this.rallyDetail(r, mode, Number(b.dataset.k))
      }))
      root.querySelector('[data-start]')?.addEventListener('click', () => {
        const save = this.store.save
        if (!save.event || save.event.rally !== r.id) save.event = { rally: r.id, times: [], difficulty: save.settings.difficulty }
        this.store.write()
        this.load(r, save.event.times.length, 'career')
      })
      root.querySelector('[data-abandon]')?.addEventListener('click', () => {
        this.store.save.event = null
        this.store.write()
        this.menuStack.pop()
        this.rallyDetail(r, mode)
      })
      root.querySelector('[data-drive]')?.addEventListener('click', () => this.load(r, sel, 'free'))
      root.querySelector('[data-race]')?.addEventListener('click', () => this.load(r, sel, 'race'))
    }, asset(`img/c-${r.id}.jpg`))
  }

  private garage(carSel?: string): void {
    const s = this.store.save
    const lv = level(s.xp).level
    const sel = carSel ?? s.car
    const car = CARS.find((c) => c.id === sel) ?? CARS[0]
    const p = carPhys(car.id)
    const stats = [
      [t('power_'), Math.min(1, p.power / 3e5)], [t('grip'), clamp((p.grip - 0.9) / 0.25 + 0.25, 0, 1)], [t('weight'), clamp((p.mass - 650) / 900, 0, 1)],
    ] as const
    const drive = p.frontDrive >= 0.99 ? t('driveFront') : p.frontDrive <= 0.01 ? t('driveRear') : t('driveAll')
    const price = (lvl: number) => Math.round(1500 * lvl * lvl ** 0.5 / 100) * 100
    const visible = LIVERIES.filter((l) => l.unlock.type === 'none' || l.unlock.type === 'shop' || l.unlock.type === 'level' || s.owned.liveries.includes(l.id))
    const ownsL = (l: LiveryDef) => l.unlock.type === 'none' || s.owned.liveries.includes(l.id) || (l.unlock.type === 'level' && lv >= l.unlock.n)
    this.menu(() => `
      <button class="back" data-back>${t('back')}</button>
      <div class="garage">
        <div class="card">
          <p class="kicker">${esc(car.era)} · ${esc(car.tag)}</p>
          <h1 class="display">${esc(car.name)}</h1>
          ${stats.map(([k, v]) => `<div class="stat"><span class="muted">${k}</span><span class="bar"><i style="width:${(v * 100).toFixed(0)}%"></i></span></div>`).join('')}
          <div class="stat"><span class="muted">${t('drive')}</span><span>${drive} · ${Math.round(p.power / 745.7)} hp · ${p.mass} kg</span></div>
          <div class="row" style="margin-top:12px">${s.owned.cars.includes(car.id)
            ? `<button class="btn" data-pick ${s.car === car.id ? 'disabled' : ''}>${s.car === car.id ? t('selected') : t('select')}</button>`
            : lv < car.level ? `<button class="btn" disabled>${t('needLevel', { n: car.level })}</button>`
            : `<button class="btn" data-buy ${s.credits < price(car.level) ? 'disabled' : ''}>${t('buy', { price: price(car.level).toLocaleString() })}</button>`}</div>
          <div class="cars" style="margin-top:14px">${CARS.map((c) => `<button class="carbtn ${c.id === sel ? 'sel' : ''} ${s.owned.cars.includes(c.id) ? '' : 'lock'}" data-car="${c.id}">${esc(c.name)}<small>${esc(c.era)} · ${t('level', { n: c.level })}</small></button>`).join('')}</div>
        </div>
        <div aria-hidden="true"></div>
        <div class="card">
          <div class="row" style="margin-bottom:12px"><button class="btn" data-paint>${pt('paintShop')}</button><button class="btn ghost" data-driver>${pt('driverEdit')}</button></div>
          <p class="kicker">Livery</p>
          <div class="swatches">${visible.map((l) => {
            const own = ownsL(l)
            const sub = own ? (s.livery === l.id && !s.carLivery[car.id] ? t('selected') : t('select')) : l.unlock.type === 'shop' ? t('buy', { price: l.unlock.price.toLocaleString() }) : l.unlock.type === 'level' ? t('needLevel', { n: l.unlock.n }) : t('secret')
            return `<button class="swatch ${s.livery === l.id && !s.carLivery[car.id] ? 'sel' : ''}" data-l="${l.id}"><span class="chip" style="background:linear-gradient(135deg,#${l.base.toString(16).padStart(6, '0')} 55%,#${l.stripe.toString(16).padStart(6, '0')} 55%)"></span><span>${esc(l.name)}<small>${sub}</small></span></button>`
          }).join('')}</div>
        </div>
      </div>`, (root) => {
      root.querySelectorAll<HTMLElement>('[data-car]').forEach((b) => b.addEventListener('click', () => {
        this.menuStack.pop()
        this.garage(b.dataset.car)
      }))
      root.querySelector('[data-pick]')?.addEventListener('click', () => {
        this.store.save.car = car.id
        this.store.write()
        this.menuStack.pop()
        this.garage(car.id)
      })
      root.querySelector('[data-buy]')?.addEventListener('click', () => {
        const cost = price(car.level)
        if (this.store.save.credits < cost) return toast(t('notEnough'))
        this.store.save.credits -= cost
        this.store.save.owned.cars.push(car.id)
        this.store.save.car = car.id
        this.store.write()
        this.menuStack.pop()
        this.garage(car.id)
      })
      root.querySelectorAll<HTMLElement>('[data-l]').forEach((b) => b.addEventListener('click', () => {
        const l = LIVERIES.find((x) => x.id === b.dataset.l)
        if (!l) return
        const save = this.store.save
        if (!ownsL(l)) {
          if (l.unlock.type !== 'shop') return toast(l.unlock.type === 'level' ? t('needLevel', { n: l.unlock.n }) : t('secret'))
          if (save.credits < l.unlock.price) return toast(t('notEnough'))
          save.credits -= l.unlock.price
          save.owned.liveries.push(l.id)
        }
        save.livery = l.id
        delete save.carLivery[car.id]
        this.store.write()
        this.menuStack.pop()
        this.garage(sel)
      }))
      root.querySelector('[data-paint]')?.addEventListener('click', () => openPaintShop(this.garageCtx(car.id)))
      root.querySelector('[data-driver]')?.addEventListener('click', () => openDriverEditor(this.garageCtx(car.id)))
      // In bind, not after it: coming Back from the paint shop must put the saved look back on the turntable.
      const sc = this.ensureShowcase()
      sc.frame('car')
      sc.helmet(true)
      sc.setCar(car.id, playerLivery(this.store.save, car.id), { look: this.store.save.driver, name: this.store.save.name })
    }, 'showcase')
  }

  private ensureShowcase(): Showcase {
    if (!this.showcase) {
      this.showcase = new Showcase(this.renderer.gl)
      this.showcase.resize(innerWidth, innerHeight)
    }
    return this.showcase
  }

  private garageCtx(car: string): GarageCtx {
    return { store: this.store, car, showcase: () => this.ensureShowcase(), menu: (r, b) => this.menu(r, b, 'showcase'), back: () => this.back() }
  }

  private closeShowcase(): void {
    this.showcase?.dispose()
    this.showcase = null
  }

  private options(tab: OptTab): void {
    const show = (x: OptTab) => {
      this.menuStack.pop()
      this.options(x)
    }
    let panel = this.settingsPanel(tab, false, show)
    this.menu(() => {
      panel = this.settingsPanel(tab, false, show)
      return `
      <button class="back" data-back>${t('back')}</button>
      <h1 class="display">${t('options')}</h1>
      ${panel.html}`
    }, (root) => panel.bind(root))
  }

  /**
   * The settings tabs, shared by the Options screen and the pause menu. In a
   * race only the tabs that apply on the spot are offered: difficulty, name
   * and save data wait for the menu, where changing them can't half-apply to
   * a stage already running.
   */
  private settingsPanel(tab: OptTab, inRace: boolean, show: (tab: OptTab) => void): { html: string; bind: (root: HTMLElement) => void } {
    const st = this.store.save.settings
    const seg = <K extends keyof Settings>(key: K, opts: readonly Settings[K][], label: (v: Settings[K]) => string) =>
      `<div class="seg">${opts.map((o) => `<button class="${st[key] === o ? 'on' : ''}" data-set="${String(key)}" data-v="${String(o)}">${label(o)}</button>`).join('')}</div>`
    const tog = (key: keyof Settings) => `<button class="toggle ${st[key] ? 'on' : ''}" data-tog="${key}" role="switch" aria-checked="${!!st[key]}"></button>`
    const range = (key: keyof Settings, min: number, max: number, step: number) => `<input type="range" min="${min}" max="${max}" step="${step}" value="${st[key]}" data-range="${key}">`
    const opt = (label: string, ctl: string) => `<div class="opt"><label>${label}</label>${ctl}</div>`
    const body: Record<OptTab, () => string> = {
      controls: () => (isTouch() ? [
        opt(t('steering'), seg('steering', ['buttons', 'tilt'] as const, (v) => t(`steer_${v}` as TKey))),
        opt(t('autoGas'), tog('autoGas')),
        opt(t('sensitivity'), range('sensitivity', 0.5, 2, 0.1)),
        opt(t('tiltInvert'), tog('tiltInvert')),
        opt(t('haptics'), tog('haptics')),
      ] : [
        opt(t('autoGas'), tog('autoGas')),
        opt(t('sensitivity'), range('sensitivity', 0.5, 2, 0.1)),
        `<h3 class="keys-title">${t('keyboard')}</h3><dl class="keymap">${([
          ['W A S D / ← ↑ → ↓', 'k_drive'], ['Space', 'k_hand'], ['Q', 'k_rewind'], ['R', 'k_reset'],
          ['C', 'k_camera'], ['F', 'k_full'], ['Esc', 'k_pause'],
        ] as const).map(([k, l]) => `<dt><kbd>${k}</kbd></dt><dd>${t(l)}</dd>`).join('')}</dl>`,
        `<h3 class="keys-title">${t('gamepad')}</h3><p class="keys-pad">${t('k_padDrive')}<br>${t('k_padHand')}</p>`,
      ]).join(''),
      audio: () => [
        opt(t('master'), range('master', 0, 1, 0.05)), opt(t('music'), range('music', 0, 1, 0.05)),
        opt(t('engine'), range('engine', 0, 1, 0.05)), opt(t('sfx'), range('sfx', 0, 1, 0.05)), opt(t('voice'), range('voice', 0, 1, 0.05)),
        opt(t('notes'), seg('notes', ['full', 'corners', 'off'] as const, (v) => t(`notes_${v}` as TKey))),
        opt(t('voiceLang'), seg('voiceLang', ['en', 'de'] as const, (v) => (v === 'en' ? 'English' : 'Deutsch'))),
        opt(t('subtitles'), tog('subtitles')),
      ].join(''),
      display: () => [
        opt(t('quality'), seg('quality', ['auto', 'low', 'medium', 'high'] as const, (v) => t(`q_${v}` as TKey))),
        opt(t('camera'), seg('camera', ['chase', 'near', 'bonnet', 'cockpit'] as const, (v) => t(`camera_${v}` as TKey))),
        ...(canFullscreen() ? [opt(t('fullscreen'), `<button class="toggle ${document.fullscreenElement ? 'on' : ''}" data-full role="switch" aria-checked="${!!document.fullscreenElement}"></button>`)] : []),
        opt(t('shake'), tog('shake')),
        opt(t('units'), seg('units', ['kmh', 'mph'] as const, (v) => (v === 'kmh' ? 'km/h' : 'mph'))),
        opt(t('textSize'), seg('textSize', [1, 1.15, 1.3] as const, (v) => `${Math.round(v * 100)}%`)),
        opt(t('lang'), seg('lang', ['en', 'de'] as const, (v) => (v === 'en' ? 'English' : 'Deutsch'))),
      ].join(''),
      gameplay: () => [
        opt(t('difficulty'), seg('difficulty', ['rookie', 'driver', 'pro'] as const, (v) => t(v))),
        opt(t('name'), `<input type="text" maxlength="20" value="${esc(this.store.save.name)}" data-name>`),
        opt(t('replaySchool'), `<button class="btn ghost" data-school>${t('school')}</button>`),
      ].join(''),
      data: () => [
        opt(t('privacy'), `<button class="btn ghost" data-privacy>${t('privacy')}</button>`),
        opt(t('erase'), `<button class="btn ghost" data-erase style="color:var(--bad)">${t('erase')}</button>`),
        `<div class="opt" data-ver><label>${t('version', { v: VERSION })}</label></div>`,
      ].join(''),
      cheats: () => !OWNER ? '' : [
        `<form class="opt cheatbox" data-cheat><label for="cheat">${t('cheatCode')}</label><input id="cheat" type="text" maxlength="24" autocomplete="off" autocapitalize="characters" spellcheck="false"><button class="btn" type="submit">${t('cheatEnter')}</button></form>`,
        `<h3 class="keys-title">${t('cheatList')}</h3><p class="keys-pad cheatlist">${CHEATS.map((c) => `<kbd>${c.code}</kbd>`).join(' ')}</p>`,
        `<p class="muted">${this.cheat.turbo ? 'TURBO: on' : 'TURBO: off'}</p>`,
      ].join(''),
    }
    const tabs: OptTab[] = inRace ? ['controls', 'audio', 'display'] : ['controls', 'audio', 'display', 'gameplay', 'data', ...(OWNER ? ['cheats' as const] : [])]
    const htmlOut = `
      <div class="options">
        <div class="seg tabs">${tabs.map((x) => `<button class="${x === tab ? 'on' : ''}" data-tab="${x}">${t(x)}</button>`).join('')}</div>
        ${body[tab]()}
      </div>`
    return { html: htmlOut, bind: (root) => {
      const redraw = () => show(tab)
      root.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab as OptTab)))
      root.querySelectorAll<HTMLElement>('[data-set]').forEach((b) => b.addEventListener('click', () => {
        const key = b.dataset.set as keyof Settings
        const raw = b.dataset.v ?? ''
        const cur = st[key]
        ;(st as unknown as Record<string, unknown>)[key] = typeof cur === 'number' ? Number(raw) : raw
        this.settingsChanged(key)
        redraw()
      }))
      root.querySelector('[data-full]')?.addEventListener('click', () => void toggleFullscreen().then(redraw))
      root.querySelectorAll<HTMLElement>('[data-tog]').forEach((b) => b.addEventListener('click', () => {
        const key = b.dataset.tog as keyof Settings
        ;(st as unknown as Record<string, unknown>)[key] = !st[key]
        this.settingsChanged(key)
        redraw()
      }))
      root.querySelectorAll<HTMLInputElement>('[data-range]').forEach((inp) => inp.addEventListener('input', () => {
        const key = inp.dataset.range as keyof Settings
        ;(st as unknown as Record<string, unknown>)[key] = Number(inp.value)
        this.settingsChanged(key)
      }))
      root.querySelector<HTMLInputElement>('[data-name]')?.addEventListener('change', (e) => {
        const v = (e.target as HTMLInputElement).value.trim().slice(0, 20)
        if (v) this.store.save.name = v
        this.store.write()
      })
      root.querySelector('[data-school]')?.addEventListener('click', () => this.startSchool())
      if (OWNER) root.querySelector<HTMLFormElement>('[data-cheat]')?.addEventListener('submit', (e) => {
        e.preventDefault()
        const input = root.querySelector<HTMLInputElement>('#cheat')
        const c = findCheat(input?.value ?? '')
        if (!c) {
          toast(t('cheatBad'))
          input?.select()
          return
        }
        toast(c.run(this.store.save, this.cheat))
        this.store.write()
        redraw()
      })
      // Five taps on the version line toggles the performance overlay, for testing on real phones.
      let taps = 0
      root.querySelector('[data-ver]')?.addEventListener('click', () => {
        if (++taps < 5) return
        taps = 0
        this.perf = !this.perf
        toast(this.perf ? 'Performance overlay on' : 'Performance overlay off')
      })
      root.querySelector('[data-privacy]')?.addEventListener('click', () => {
        // Shown inside the app: it works offline, and back returns to the game.
        const o = this.ui.overlay
        o.classList.remove('hidden')
        html(o, `<div class="dialog" style="width:min(760px,100%);height:100%;display:flex;flex-direction:column"><iframe src="${asset('privacy.html')}" title="${t('privacy')}" style="flex:1;border:0;border-radius:10px;background:#1a2027"></iframe><div class="col"><button class="btn" data-close>${t('back')}</button></div></div>`)
        $('[data-close]', o).addEventListener('click', () => o.classList.add('hidden'))
      })
      root.querySelector('[data-erase]')?.addEventListener('click', () => this.confirm(t('eraseConfirm'), () => {
        this.store.reset()
        if (OWNER) {
          unlockAll(this.store.save)
          this.store.write()
        }
        toast(t('erased'))
        this.home()
      }))
    } }
  }

  private settingsChanged(key: keyof Settings): void {
    const st = this.store.save.settings
    this.store.write()
    if (key === 'lang') setLang(st.lang)
    if (key === 'textSize') document.documentElement.style.setProperty('--text', String(st.textSize))
    if (['master', 'music', 'sfx', 'engine', 'voice'].includes(key)) this.applyMix()
    if (key === 'voiceLang') void this.audio.loadVoice(st.voiceLang)
    if (key === 'quality' && st.quality !== 'auto') this.renderer.setTier(st.quality)
    if (key === 'tiltInvert' || key === 'steering') this.requestTilt()
    const r = this.race
    if (r) {
      if (key === 'camera') r.view.camMode = st.camera
      if (key === 'shake') r.view.shake = st.shake ? 1 : 0
      if (key === 'notes') r.codriver.setMode(st.notes)
    }
  }

  /** iOS-style permission prompt for motion sensors, where the browser has one. */
  private requestTilt(): void {
    const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }
    if (this.store.save.settings.steering === 'tilt' && D.requestPermission) void D.requestPermission().catch(() => toast(t('steer_buttons')))
  }

  private applyMix(): void {
    const s = this.store.save.settings
    this.audio.setMix({ master: s.master, music: s.music, sfx: s.sfx, engine: s.engine, voice: s.voice })
  }

  private creditsScreen(): void {
    this.menu(() => `
      <button class="back" data-back>${t('back')}</button>
      <div class="card" style="max-width:640px">
        <div class="row" style="gap:12px"><span style="width:48px;display:inline-block">${CHEVRON}</span><h1 class="display" style="margin:0">Apex Drift</h1></div>
        <p>${t('creditsBody')}</p>
        <p class="kicker">${t('licences')}</p>
        <p class="muted">${t('licenceText')}</p>
        <p class="muted">${t('version', { v: VERSION })}</p>
      </div>`, () => undefined)
  }

  private confirm(msg: string, yes: () => void, no?: () => void): void {
    const o = this.ui.overlay
    o.classList.remove('hidden')
    html(o, `<div class="dialog" role="alertdialog"><p>${esc(msg)}</p><div class="row"><button class="btn" data-y>${t('yes')}</button><button class="btn ghost" data-n>${t('no')}</button></div></div>`)
    $('[data-y]', o).addEventListener('click', () => {
      o.classList.add('hidden')
      yes()
    })
    $('[data-n]', o).addEventListener('click', () => {
      o.classList.add('hidden')
      no?.()
    })
  }

  // ======================================================================= race

  private startSchool(): void {
    this.load(SCHOOL, 0, 'school')
  }

  private load(rally: RallyDef, stageIdx: number, mode: RaceCtx['mode'], car?: string): void {
    this.disposeRace()
    this.closeShowcase()
    const st = rally.stages[stageIdx]
    const s = this.store.save
    this.show('loading')
    const tips = ['loadingTip0', 'loadingTip1', 'loadingTip2', 'loadingTip3', 'loadingTip4'] as const
    // The school and the daily stage borrow a country's road, so they show its picture.
    const art = rally.id === 'school' ? 'finland' : rally.id.startsWith('daily-') ? (RALLIES.find((x) => x.name === rally.name)?.id ?? 'finland') : rally.id
    this.ui.loading.style.backgroundImage = `url('${asset(`img/c-${art}.jpg`)}')`
    html(this.ui.loading, `
      <div class="info"><p class="kicker">${mode === 'school' ? t('school') : `${esc(rally.name)} · ${t('stageOf', { n: stageIdx + 1, total: rally.stages.length })}`}</p>
        <h1 class="display">${esc(mode === 'school' ? t('school') : st.name)}</h1>
        <dl class="facts"><dt>${t('length')}</dt><dd>${st.km.toFixed(1)} km</dd><dt>${t('surface')}</dt><dd>${t(`surface_${rally.surface}` as TKey)}</dd><dt>${t('conditions')}</dt><dd>${t(`look_${st.look}` as TKey)} · ${t(`weather_${st.weather}` as TKey)}</dd></dl></div>
      <p class="tip">${t(tips[(st.seed + stageIdx) % tips.length])}</p>
      <div class="progress"><i></i></div>`)
    const bar = $('.progress i', this.ui.loading)
    // Build in steps so the loading screen paints and the bar moves.
    const steps: (() => void)[] = []
    let sim: StageSim | null = null
    let view: StageView | null = null
    steps.push(() => {
      const difficulty = mode === 'school' ? 'rookie' : s.event && mode === 'career' ? s.event.difficulty : s.settings.difficulty
      const race = mode === 'race' ? raceGrid(rally, stageIdx, difficulty, car ?? s.car, playerLiveryId(s, car ?? s.car)) : undefined
      sim = new StageSim({ rally, stage: st, car: car ?? s.car, difficulty, power: OWNER && this.cheat.turbo ? 2 : 1, race })
    })
    steps.push(() => {
      if (!sim) return
      const lv = playerLivery(s, sim.setup.car)
      view = new StageView(sim, this.renderer, lv, { start: t('start'), finish: t('finish') }, { look: s.driver, name: s.name })
      view.camMode = s.settings.camera
      view.shake = s.settings.shake ? 1 : 0
      this.resize(view)
    })
    steps.push(() => view?.prewarm())
    steps.push(() => void this.audio.loadVoice(s.settings.voiceLang))
    let i = 0
    const next = () => {
      try {
        steps[i++]()
      } catch (e) {
        this.fatal(e)
        return
      }
      bar.style.width = `${Math.round((i / steps.length) * 100)}%`
      if (i < steps.length) setTimeout(next, 30)
      else if (sim && view) this.begin(rally, stageIdx, mode, sim, view)
    }
    setTimeout(next, 60)
  }

  private begin(rally: RallyDef, stageIdx: number, mode: RaceCtx['mode'], sim: StageSim, view: StageView): void {
    const s = this.store.save
    const hud = new Hud(this.ui.hud, s.settings.units === 'mph')
    hud.setStage(mode === 'school' ? t('school') : `${rally.name} · ${rally.stages[stageIdx].name}`, sim)
    this.controls.bindTouch(this.ui.hud)
    this.ui.hud.querySelectorAll<HTMLElement>('[data-act]').forEach((b) => b.addEventListener('click', () => this.action(b.dataset.act as 'pause')))
    const notes = paceNotes(sim.route, sim.start, sim.finish)
    const gold = mode === 'school' || mode === 'race' ? null : stageMedals(rally, stageIdx, sim.setup.difficulty).gold
    if (sim.racing) hud.setRivals(sim.field.map((o) => (LIVERIES.find((l) => l.id === o.slot.livery) ?? LIVERIES[0]).base))
    const hairpin = notes.find((n) => n.kind === 'corner' && n.grade === 0)?.s ?? sim.finish
    this.race = {
      rally, stageIdx, mode, sim, view, hud, phase: 'intro', introT: 0, finishT: 0, paused: false, gold,
      codriver: new CoDriver(notes, s.settings.notes),
      school: mode === 'school' ? { step: 0, shownAt: 0, hairpin, firstCall: null } : null,
      cheered: new Set(),
      history: [],
      // Rewinding a race would have to rewind the rivals too.
      rewinds: mode === 'school' ? 9 : mode === 'race' ? 0 : REWINDS[sim.setup.difficulty] ?? 3,
      sectors: 0,
      recorder: new GhostRecorder(),
      tape: new ReplayRecorder(),
      replay: null,
      photo: null,
      benchmark: s.settings.quality === 'auto' && !s.tier ? [] : null,
    }
    this.race.hud.rewinds(this.race.rewinds)
    if (mode !== 'school' && mode !== 'race') {
      const g = loadGhost(this.storage, `${rally.id}:${stageIdx}`)
      if (g) view.setGhost(g, findLivery(s, g.livery), { look: s.driver, name: s.name })
    }
    this.show('race')
    this.ui.overlay.classList.add('hidden')
    $('#bars').classList.add('on')
    hud.bigText(null)
    this.audio.playMusic('drive')
    this.audio.startCar(engineProfileFor(sim.setup.car))
    this.audio.setRain(rally.stages[stageIdx].weather === 'rain')
    this.audio.say(s.settings.voiceLang, ['goodluck'])
    this.acc = 0
  }

  private disposeRace(): void {
    const r = this.race
    if (!r) return
    r.replay?.bar.remove()
    r.photo?.bar.remove()
    this.photoCleanup?.()
    this.photoCleanup = null
    document.body.classList.remove('photo')
    r.view.dispose()
    this.race = null
    this.controls.release()
    this.audio.stopCar()
    this.audio.setRain(false)
    this.audio.clearCalls()
    $('#bars').classList.remove('on')
    document.querySelector('.coach')?.remove()
  }

  private loop(now: number): void {
    requestAnimationFrame((n) => this.loop(n))
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    if (this.showcase && this.screen === 'menu') this.showcase.render(dt)
    const at = this.attract
    if (at && this.screen === 'title') {
      at.acc += dt
      while (at.acc >= DT) {
        at.sim.step(autopilot(at.sim, 0.8))
        at.acc -= DT
        // Loop the stage: back to the start before the finish line.
        if (at.sim.phase === 'finished') at.sim.car.place(at.sim.start + 200)
      }
      at.view.frame(at.acc / DT, dt, 'drive')
    }
    const r = this.race
    if (!r || this.screen !== 'race') return
    if (r.replay) this.replayTick(r, r.replay, dt)
    else if (r.photo) this.photoTick(r, r.photo)
    else {
      if (!r.paused) this.tick(r, dt)
      r.view.updateGhost(r.sim.time)
      if (r.view.softHits) {
        this.audio.thump(0.25)
        haptic(25, this.store.save.settings.haptics)
        if (Math.random() < 0.5) this.audio.cheer()
      }
      const mode = r.phase === 'intro' ? 'intro' : r.phase === 'finished' || r.phase === 'results' ? 'orbit' : 'drive'
      r.view.frame(r.paused ? 1 : this.acc / DT, r.paused ? 0 : dt, mode, r.introT / 6)
    }
    this.renderer.sample(dt * 1000)
    if (r.benchmark) this.benchmark(r, dt * 1000)
    if (this.perf) this.perfOverlay(dt * 1000)
  }

  private perfOverlay(ms: number): void {
    this.frameMs.push(ms)
    if (this.frameMs.length > 240) this.frameMs.shift()
    let el = document.getElementById('perf')
    if (!el) {
      el = document.createElement('div')
      el.id = 'perf'
      el.style.cssText = 'position:fixed;left:50%;bottom:4px;transform:translateX(-50%);z-index:30;background:rgba(0,0,0,.7);color:#9f9;font:11px/1.3 monospace;padding:4px 8px;border-radius:6px;pointer-events:none;white-space:pre'
      document.body.appendChild(el)
    }
    if (this.frameMs.length % 15) return
    const s = [...this.frameMs].sort((a, b) => a - b)
    const q = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1)
    const info = this.renderer.gl.info.render
    el.textContent = `p50 ${q(0.5)} ms  p95 ${q(0.95)} ms  max ${s[s.length - 1].toFixed(0)} ms  |  ${info.calls} draws  ${(info.triangles / 1000).toFixed(0)}k tris  |  ${this.renderer.tier} x${this.renderer.scale.toFixed(2)}`
  }

  /**
   * The first stage on a new device measures itself during the flyover and
   * picks a graphics tier, so a slow phone never starts on settings it can't run.
   */
  private benchmark(r: RaceCtx, ms: number): void {
    const b = r.benchmark
    if (!b || r.phase !== 'intro') return
    b.push(ms)
    if (b.length < 150) return
    const sorted = [...b].sort((a, c) => a - c)
    const p90 = sorted[Math.floor(sorted.length * 0.9)]
    const tier: Tier = p90 > 24 ? 'low' : p90 < 12 && this.renderer.tier === 'medium' ? 'high' : 'medium'
    this.store.save.tier = tier
    this.store.write()
    r.benchmark = null
    if (tier !== this.renderer.tier) toast(`${t('quality')}: ${t(tier === 'low' ? 'q_low' : tier === 'high' ? 'q_high' : 'q_medium')}`)
  }

  private tick(r: RaceCtx, dt: number): void {
    const s = this.store.save
    const sim = r.sim
    const school = r.school
    // In the driving school, a waiting lesson slows time instead of stopping it.
    const scale = school && school.step > 0 && school.shownAt > 0 && this.coachWaiting(r) ? 0.35 : 1
    if (r.phase === 'intro') {
      r.introT += dt
      if (r.introT >= 6) {
        r.phase = 'countdown'
        $('#bars').classList.remove('on')
        r.view.snapCamera()
      }
      return
    }
    this.acc += dt * scale
    const input = this.controls.read(dt, sim.car.speed)
    while (this.acc >= DT) {
      sim.step(r.phase === 'running' ? input : { steer: 0, throttle: 0, brake: 0, handbrake: false })
      this.acc -= DT
      if (r.phase === 'running') {
        const c = sim.car
        r.recorder.record(sim.time, c.x, c.y, c.z, c.heading)
        r.tape.record(sim.time, c.s, c.pose(1, tapePose), c.speed, c.rpm, c.throttleOut, c.gear, Math.min(1, c.slipR * 3))
      }
      if (r.phase === 'running' && Math.round(sim.time * 60) % 10 === 0) {
        r.history.push({ car: snap(sim.car), sim: snap(sim) })
        if (r.history.length > 36) r.history.shift()
      }
      if (sim.car.events.impact > 2) {
        haptic(Math.min(80, 20 + sim.car.events.impact * 4), s.settings.haptics)
      }
      if (sim.car.events.landed > 2.5) {
        haptic(30, s.settings.haptics)
      }
    }
    if (r.phase === 'countdown') {
      if (r.hud.countdown(sim.countdown)) this.audio.click()
      if (sim.phase === 'running') {
        r.phase = 'running'
        r.hud.bigText(t('go'), true)
        this.audio.say(s.settings.voiceLang, ['go'])
        haptic(40, s.settings.haptics)
        setTimeout(() => r.phase === 'running' && r.hud.bigText(null), 900)
      }
    }
    if (r.phase === 'running') {
      const call = r.codriver.update(sim.car.s, sim.car.speed, sim.time)
      if (call) {
        // Dropped if it would only be heard once the car is already at the corner.
        this.audio.say(s.settings.voiceLang, call.words, () => sim.car.s > call.at - 5)
        if (school && !school.firstCall) school.firstCall = subtitle(call.words)
      }
      r.hud.showNote(r.codriver.upcoming(sim.car.s))
      // A cheer as you pass a crowd at a hairpin or jump.
      for (const n of paceNotes(sim.route, sim.start, sim.finish)) {
        if (Math.abs(n.s - sim.car.s) < 15 && !r.cheered.has(n.s) && ((n.kind === 'corner' && n.grade <= 2) || n.kind === 'jump')) {
          r.cheered.add(n.s)
          if (Math.random() < 0.7) this.audio.cheer()
        }
      }
      if (school) this.coach(r, input)
      // Sector splits at a third and two thirds, against gold pace.
      const sec = Math.floor((sim.progress / sim.length) * 3)
      if (sec > r.sectors && sec < 3) {
        r.sectors = sec
        r.hud.sector(sec, r.gold === null ? null : sim.total - (r.gold * sec) / 3)
      }
      if (sim.phase === 'finished') this.finished(r)
    }
    if (r.phase === 'finished') {
      r.finishT += dt
      if (r.finishT > 2.2) this.results(r)
    }
    const car = sim.car
    const live = r.phase === 'running' || r.phase === 'countdown'
    this.audio.updateCar({
      rpm: car.rpm, throttle: live ? car.throttleOut : 0, load: live ? car.engineLoad : 0, gear: car.gear, shifting: car.shifting,
      boost: car.boost, speed: car.speed, surface: car.surface, slip: Math.min(1, car.slipR * 3), wheelSpin: car.wheelSpin,
      onGround: !car.airborne, impact: car.events.impact, landed: car.events.landed, camera: r.view.camMode === 'cockpit' ? 'bonnet' : r.view.camMode,
    })
    r.hud.update(sim, r.gold)
  }

  // ------------------------------------------------------------- driving school

  private coachWaiting(r: RaceCtx): boolean {
    return !!document.querySelector('.coach[data-wait]') && r.phase === 'running'
  }

  private coach(r: RaceCtx, inp: { steer: number; throttle: number; brake: number; handbrake: boolean }): void {
    const sc = r.school
    if (!sc) return
    const s = r.sim.car.s
    const keys = !document.body.classList.contains('touch')
    const autoGas = this.store.save.settings.autoGas
    const show = (text: string, waitFor: 'action' | 'button', step: number) => {
      document.querySelector('.coach')?.remove()
      const el = document.createElement('div')
      el.className = 'coach'
      el.setAttribute('role', 'status')
      if (waitFor === 'action') el.dataset.wait = '1'
      el.innerHTML = `<span class="k">${step}</span><p>${esc(text)}</p>${waitFor === 'button' ? `<button class="btn ghost" data-ok>${t('gotIt')}</button>` : ''}`
      document.body.appendChild(el)
      el.querySelector('[data-ok]')?.addEventListener('click', () => el.remove())
      sc.shownAt = performance.now()
    }
    const done = () => {
      document.querySelector('.coach')?.remove()
      sc.step++
      sc.shownAt = 0
    }
    switch (sc.step) {
      case 0:
        if (!autoGas) show(t(keys ? 'school_gasKeys' : 'school_gas'), 'action', 1)
        sc.step = autoGas ? 2 : 1
        break
      case 1:
        if (inp.throttle > 0.5) done()
        break
      case 2:
        show(t(keys ? 'school_steerKeys' : 'school_steer'), 'action', 2)
        sc.step = 3
        break
      case 3:
        if (Math.abs(inp.steer) > 0.4 || s > r.sim.start + 160) done()
        break
      case 4:
        if (sc.firstCall) {
          show(t('school_notes', { call: sc.firstCall }), 'button', 3)
          sc.step = 5
        }
        break
      case 5:
        if (s > sc.hairpin - 150 || performance.now() - sc.shownAt > 9000) done()
        break
      case 6:
        if (s > sc.hairpin - 130) {
          show(t(keys ? 'school_brakeKeys' : 'school_brake'), 'action', 4)
          sc.step = 7
        }
        break
      case 7:
        if (inp.brake > 0.3 || s > sc.hairpin - 20) done()
        break
      case 8:
        if (s > sc.hairpin - 30) {
          show(t(keys ? 'school_handKeys' : 'school_hand'), 'action', 5)
          sc.step = 9
        }
        break
      case 9:
        if (inp.handbrake || s > sc.hairpin + 25) done()
        break
      case 10:
        if (s > sc.hairpin + 60) {
          show(t('school_reset'), 'button', 6)
          sc.step = 11
        }
        break
      case 11:
        if (performance.now() - sc.shownAt > 7000) done()
        break
    }
  }

  // ------------------------------------------------------------- finish

  private finished(r: RaceCtx): void {
    r.phase = 'finished'
    r.finishT = 0
    document.querySelector('.coach')?.remove()
    r.hud.bigText(t('finish'))
    haptic(60, this.store.save.settings.haptics)
    setTimeout(() => r.hud.bigText(null), 1600)
  }

  private results(r: RaceCtx): void {
    r.phase = 'results'
    const s = this.store.save
    const sim = r.sim
    const time = sim.total
    s.stats.stages++
    s.stats.metres += sim.length
    s.stats.resets += sim.resets
    s.stats.seconds += time
    const o = this.ui.overlay
    o.classList.remove('hidden')
    if (r.mode === 'school') {
      s.tutorialDone = true
      this.store.write()
      html(o, `<div class="dialog"><p class="kicker">${t('school')}</p><h2 class="display">${t('stageComplete')}</h2><p>${t('school_done')}</p>
        <div class="col"><button class="btn" data-first>${t('school_go')}</button><button class="btn ghost" data-menu>${t('menu')}</button></div></div>`)
      $('[data-first]', o).addEventListener('click', () => {
        const save = this.store.save
        save.event = { rally: RALLIES[0].id, times: [], difficulty: save.settings.difficulty }
        this.store.write()
        this.load(RALLIES[0], 0, 'career')
      })
      $('[data-menu]', o).addEventListener('click', () => this.toMenu())
      return
    }
    if (r.mode === 'race') return this.raceResults(r)
    saveGhost(this.storage, `${r.rally.id}:${r.stageIdx}`, { car: sim.setup.car, livery: playerLiveryId(s, sim.setup.car), time, frames: r.recorder.frames() })
    if (r.mode === 'daily') {
      // The daily stage keeps its own record: today's best and the streak, no career or garage effects.
      const day = r.rally.id.slice('daily-'.length)
      const prevBest = s.daily.best[day]
      if (!prevBest || time < prevBest) s.daily.best[day] = time
      if (!s.daily.days.includes(day)) s.daily.days = [...s.daily.days, day].slice(-60)
      for (const k of Object.keys(s.daily.best)) if (!s.daily.days.includes(k)) delete s.daily.best[k]
      const reward = stageReward(medalFor(time, r.rally, 0, sim.setup.difficulty), sim.resets === 0)
      s.credits += reward.credits
      s.xp += reward.xp
      this.store.write()
      const n = streak(s.daily.days, new Date())
      html(o, `<div class="results single"><div class="card">
        <p class="kicker">${t('daily')} · ${esc(day)}</p>
        <h2 class="display" style="font-size:30px;margin:4px 0">${t('stageComplete')}</h2>
        <div class="bigtime">${fmtTime(time)}</div>
        <p>${t('dailyBest', { time: fmtTime(s.daily.best[day]) })}${!prevBest || time < prevBest ? ` · ${t('newBest')}` : ''}</p>
        <p class="kicker">${t('streak', { n })}</p>
        <p>${t('earned', { credits: reward.credits.toLocaleString(), xp: reward.xp.toLocaleString() })}</p>
        <div class="col"><button class="btn" data-retry>${t('retry')}</button><button class="btn ghost" data-replay>${t('watchReplay')}</button><button class="btn ghost" data-menu>${t('menu')}</button></div>
      </div></div>`)
      $('[data-replay]', o).addEventListener('click', () => this.startReplay(r))
      $('[data-retry]', o).addEventListener('click', () => this.load(r.rally, 0, 'daily', sim.setup.car))
      $('[data-menu]', o).addEventListener('click', () => this.toMenu())
      return
    }
    const d = sim.setup.difficulty
    const medal: Medal = medalFor(time, r.rally, r.stageIdx, d)
    const key = `${r.rally.id}:${r.stageIdx}:${d}`
    const prev = s.best[key]
    const isBest = !prev || time < prev.time
    if (isBest) s.best[key] = { time, medal }
    const before = level(s.xp).level
    const reward = stageReward(medal, sim.resets === 0)
    let extra = ''
    let standingsHtml = ''
    let last = false
    if (r.mode === 'career' && s.event && s.event.rally === r.rally.id) {
      s.event.times.push(time)
      const rows = standings(r.rally, s.event.times, s.name, s.event.difficulty)
      const pos = rows.findIndex((x) => x.you) + 1
      last = s.event.times.length >= r.rally.stages.length
      standingsHtml = `<p class="kicker">${t('standings')}</p><table class="table">${rows.slice(0, 6).concat(rows.findIndex((x) => x.you) >= 6 ? [rows.find((x) => x.you)!] : []).map((x) => {
        const p = rows.indexOf(x) + 1
        return `<tr class="${x.you ? 'you' : ''}"><td>${p}</td><td>${esc(x.name)}</td><td>${fmtTime(x.total)}</td></tr>`
      }).join('')}</table><p class="muted">${t('position', { pos, n: rows.length })}</p>`
      if (last) {
        const rr = rallyReward(pos)
        reward.credits += rr.credits
        reward.xp += rr.xp
        if (!s.finished.includes(r.rally.id)) s.finished.push(r.rally.id)
        if (!s.postcards.includes(r.rally.id)) {
          s.postcards.push(r.rally.id)
          extra = `<div class="postcard" style="background-image:url('${asset(`img/c-${r.rally.id}.jpg`)}')"></div><p>${t('postcard', { rally: esc(r.rally.name) })}</p>`
        }
        s.event = null
      }
    }
    s.credits += reward.credits
    s.xp += reward.xp
    const after = level(s.xp).level
    this.store.write()
    if (medal && (medal === 'gold' || isBest)) this.audio.say(s.settings.voiceLang, ['wellDone'])
    const m = stageMedals(r.rally, r.stageIdx, d)
    const medalName = medal ? t(medal) : t('noMedal')
    const left = `
        <p class="kicker">${esc(r.rally.name)} · ${esc(r.rally.stages[r.stageIdx].name)}</p>
        <h2 class="display" style="font-size:30px;margin:4px 0">${last ? t('rallyComplete') : t('stageComplete')}</h2>
        <p class="muted">${t('yourTime')}</p>
        <div class="bigtime">${fmtTime(time)}</div>
        ${sim.penalty ? `<p class="muted">${t('penalty', { s: sim.penalty })}</p>` : ''}
        <div class="medal-big"><i class="medal ${medal ?? ''}"></i>${medalName}${isBest && prev ? ` · ${t('newBest')}` : ''}</div>
        <p class="muted" style="font-size:0.85em">${t('gold')} ${fmtTime(m.gold)} · ${t('silver')} ${fmtTime(m.silver)} · ${t('bronze')} ${fmtTime(m.bronze)}</p>
        <p>${t('earned', { credits: reward.credits.toLocaleString(), xp: reward.xp.toLocaleString() })}${after > before ? ` · <b style="color:var(--amber)">${t('levelUp', { n: after })}</b>` : ''}</p>
        ${extra}`
    const buttons = `<div class="col">
          ${r.mode === 'career' && !last ? `<button class="btn" data-next>${t('nextStage')}</button>` : ''}
          ${r.mode === 'free' && r.stageIdx + 1 < r.rally.stages.length ? `<button class="btn" data-freenext>${t('nextStage')}</button>` : ''}
          ${r.mode === 'free' ? `<button class="btn ghost" data-retry>${t('retry')}</button>` : ''}
          <button class="btn ghost" data-replay>${t('watchReplay')}</button>
          <button class="btn ${r.mode === 'career' && last ? '' : 'ghost'}" data-menu>${t('menu')}</button>
        </div>`
    html(o, standingsHtml
      ? `<div class="results"><div class="card">${left}</div><div class="card">${standingsHtml}${buttons}</div></div>`
      : `<div class="results single"><div class="card">${left}${buttons}</div></div>`)
    $('[data-replay]', o).addEventListener('click', () => this.startReplay(r))
    o.querySelector('[data-next]')?.addEventListener('click', () => this.load(r.rally, r.stageIdx + 1, 'career'))
    o.querySelector('[data-retry]')?.addEventListener('click', () => this.load(r.rally, r.stageIdx, 'free'))
    o.querySelector('[data-freenext]')?.addEventListener('click', () => this.load(r.rally, r.stageIdx + 1, 'free'))
    $('[data-menu]', o).addEventListener('click', () => this.toMenu())
  }

  /** Finishing order of a race; rivals still on the road are placed by their projected time. */
  private raceResults(r: RaceCtx): void {
    const s = this.store.save
    const sim = r.sim
    const o = this.ui.overlay
    const rows = sim.result()
    const pos = rows.findIndex((x) => x.you) + 1
    const winner = rows[0].total
    const reward = raceReward(pos, sim.setup.difficulty)
    const before = level(s.xp).level
    s.credits += reward.credits
    s.xp += reward.xp
    const after = level(s.xp).level
    this.store.write()
    if (pos === 1) this.audio.say(s.settings.voiceLang, ['wellDone'])
    const carName = (id: string) => esc(CARS.find((c) => c.id === id)?.name ?? '')
    const table = `<table class="table order">${rows.map((x, i) => `<tr class="${x.you ? 'you' : ''}"><td>P${i + 1}</td><td>${x.you ? esc(s.name) : esc(x.name)}<br><small class="muted">${carName(x.car)}</small></td><td>${i === 0 ? fmtTime(x.total) : `+${fmtTime(x.total - winner)}`}${x.finished ? '' : `<br><small class="muted">${t('raceEst')}</small>`}</td></tr>`).join('')}</table>`
    const last = r.stageIdx + 1 >= r.rally.stages.length
    html(o, `<div class="results"><div class="card">
        <p class="kicker">${esc(r.rally.name)} · ${esc(r.rally.stages[r.stageIdx].name)} · ${t(sim.setup.difficulty)}</p>
        <h2 class="display" style="font-size:30px;margin:4px 0">${pos === 1 ? t('raceWon') : t('racePlace', { pos, n: rows.length })}</h2>
        <p class="muted">${t('yourTime')}</p>
        <div class="bigtime">${fmtTime(sim.total)}</div>
        ${sim.penalty ? `<p class="muted">${t('penalty', { s: sim.penalty })}</p>` : ''}
        <p>${t('earned', { credits: reward.credits.toLocaleString(), xp: reward.xp.toLocaleString() })}${after > before ? ` · <b style="color:var(--amber)">${t('levelUp', { n: after })}</b>` : ''}</p>
      </div><div class="card"><p class="kicker">${t('raceResult')}</p>${table}
        <div class="col">
          ${last ? '' : `<button class="btn" data-racenext>${t('nextStage')}</button>`}
          <button class="btn ${last ? '' : 'ghost'}" data-retry>${t('retry')}</button>
          <button class="btn ghost" data-replay>${t('watchReplay')}</button>
          <button class="btn ghost" data-menu>${t('menu')}</button>
        </div></div></div>`)
    $('[data-replay]', o).addEventListener('click', () => this.startReplay(r))
    $('[data-retry]', o).addEventListener('click', () => this.load(r.rally, r.stageIdx, 'race', sim.setup.car))
    o.querySelector('[data-racenext]')?.addEventListener('click', () => this.load(r.rally, r.stageIdx + 1, 'race', sim.setup.car))
    $('[data-menu]', o).addEventListener('click', () => this.toMenu())
  }

  // ------------------------------------------------------------- replay

  /** Plays the run back from TV cameras, letterboxed, with its own engine sound. */
  private startReplay(r: RaceCtx): void {
    if (r.replay || r.phase !== 'results') return
    const data = r.tape.done()
    if (data.frames < 2) return
    const g = r.sim.ground
    const dir = new Director(r.sim.route, (x, z) => g.height(x, z), (s) => g.limitAt(s) + BODY + 0.8, r.sim.finish)
    const bar = document.createElement('div')
    bar.id = 'replaybar'
    bar.innerHTML = `<span class="rec">${t('replay')}</span><span class="rt" data-rt>0:00</span><button class="btn ghost" data-rspeed>1×</button><button class="btn ghost" data-rexit>${t('exitReplay')}</button>`
    document.body.appendChild(bar)
    r.replay = { data, t: 0, speed: 1, dir, frame: emptyFrame(), bar }
    r.phase = 'replay'
    this.ui.overlay.classList.add('hidden')
    this.ui.hud.classList.add('hidden')
    $('#bars').classList.add('on')
    $('[data-rexit]', bar).addEventListener('click', () => this.stopReplay(r))
    const sp = $('[data-rspeed]', bar)
    sp.addEventListener('click', () => {
      const rp = r.replay
      if (!rp) return
      rp.speed = rp.speed === 1 ? 2 : rp.speed === 2 ? 4 : rp.speed === 4 ? 0.5 : 1
      sp.textContent = `${rp.speed === 0.5 ? '½' : rp.speed}×`
    })
    this.audio.playMusic('menu')
  }

  private replayTick(r: RaceCtx, rp: NonNullable<RaceCtx['replay']>, dt: number): void {
    rp.t += dt * rp.speed
    if (rp.t >= rp.data.duration) return this.stopReplay(r)
    const f = rp.data.at(rp.t, rp.frame)
    r.view.override = f
    const shot = rp.dir.shot(rp.t, f)
    r.view.setShot(shot.pos, shot.look, shot.fov)
    r.view.updateGhost(rp.t)
    r.view.frame(1, dt, 'fixed')
    // The engine plays from the recording; slowed or sped-up replays stay quiet.
    const live = rp.speed === 1
    const car = r.sim.car
    this.audio.updateCar({
      rpm: f.rpm, throttle: live ? f.throttle : 0, load: live ? f.throttle : 0, gear: f.gear, shifting: false,
      boost: 0, speed: live ? f.speed : 0, surface: car.surface, slip: live ? f.slip : 0, wheelSpin: 0,
      onGround: true, impact: 0, landed: 0, camera: shot.kind === 'wheel' ? 'bonnet' : 'chase',
    })
    const rt = rp.bar.querySelector('[data-rt]')
    if (rt) rt.textContent = fmtTime(rp.t).replace(/\.\d+$/, '')
  }

  private stopReplay(r: RaceCtx): void {
    const rp = r.replay
    if (!rp) return
    rp.bar.remove()
    r.replay = null
    r.view.override = null
    r.phase = 'results'
    $('#bars').classList.remove('on')
    this.ui.hud.classList.remove('hidden')
    this.ui.overlay.classList.remove('hidden')
    r.view.snapCamera()
  }

  // ------------------------------------------------------------- photo mode

  private startPhoto(r: RaceCtx): void {
    if (!r.paused || r.photo) return
    const bar = document.createElement('div')
    bar.id = 'photobar'
    bar.innerHTML = `<p class="hint">${t(isTouch() ? 'photoHintTouch' : 'photoHint')}</p><div class="row"><button class="btn ghost zoom" data-zoom="-1" aria-label="zoom in">+</button><button class="btn ghost zoom" data-zoom="1" aria-label="zoom out">−</button><button class="btn" data-shoot>${t('takePhoto')}</button><button class="btn ghost" data-pdone>${t('back')}</button></div>`
    document.body.appendChild(bar)
    r.photo = { yaw: r.sim.car.heading + Math.PI * 0.8, pitch: 0.22, dist: 7, capture: false, bar, drag: null }
    this.ui.overlay.classList.add('hidden')
    this.ui.hud.classList.add('hidden')
    document.body.classList.add('photo')
    $('[data-shoot]', bar).addEventListener('click', () => r.photo && (r.photo.capture = true))
    $('[data-pdone]', bar).addEventListener('click', () => this.stopPhoto(r))
    bar.querySelectorAll<HTMLElement>('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
      if (r.photo) r.photo.dist = clamp(r.photo.dist * (1 + Number(b.dataset.zoom) * 0.15), 2.6, 30)
    }))
    const c = this.canvas
    const down = (e: PointerEvent) => {
      if (!r.photo) return
      r.photo.drag = { x: e.clientX, y: e.clientY }
      c.setPointerCapture?.(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      const ph = r.photo
      if (!ph?.drag) return
      ph.yaw -= (e.clientX - ph.drag.x) * 0.008
      ph.pitch = clamp(ph.pitch + (e.clientY - ph.drag.y) * 0.006, 0.02, 1.3)
      ph.drag = { x: e.clientX, y: e.clientY }
    }
    const up = () => r.photo && (r.photo.drag = null)
    const wheel = (e: WheelEvent) => {
      if (!r.photo) return
      e.preventDefault()
      r.photo.dist = clamp(r.photo.dist * (1 + Math.sign(e.deltaY) * 0.1), 2.6, 30)
    }
    const key = (e: KeyboardEvent) => {
      const ph = r.photo
      if (!ph) return
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') ph.yaw += 0.08
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') ph.yaw -= 0.08
      else if (e.code === 'ArrowUp' || e.code === 'KeyW') ph.pitch = clamp(ph.pitch + 0.05, 0.02, 1.3)
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') ph.pitch = clamp(ph.pitch - 0.05, 0.02, 1.3)
      else if (e.code === 'Equal' || e.code === 'NumpadAdd') ph.dist = clamp(ph.dist * 0.9, 2.6, 30)
      else if (e.code === 'Minus' || e.code === 'NumpadSubtract') ph.dist = clamp(ph.dist * 1.1, 2.6, 30)
      else if (e.code === 'Space' || e.code === 'Enter') ph.capture = true
    }
    c.addEventListener('pointerdown', down)
    c.addEventListener('pointermove', move)
    c.addEventListener('pointerup', up)
    c.addEventListener('wheel', wheel, { passive: false })
    addEventListener('keydown', key)
    this.photoCleanup = () => {
      c.removeEventListener('pointerdown', down)
      c.removeEventListener('pointermove', move)
      c.removeEventListener('pointerup', up)
      c.removeEventListener('wheel', wheel)
      removeEventListener('keydown', key)
    }
  }

  private photoCleanup: (() => void) | null = null

  private photoTick(r: RaceCtx, ph: NonNullable<RaceCtx['photo']>): void {
    const c = r.view.car.root.position
    const h = Math.cos(ph.pitch) * ph.dist
    const pos = { x: c.x + Math.sin(ph.yaw) * h, y: c.y + 0.8 + Math.sin(ph.pitch) * ph.dist, z: c.z + Math.cos(ph.yaw) * h }
    pos.y = Math.max(pos.y, r.sim.ground.height(pos.x, pos.z) + 0.4)
    r.view.setShot(pos, { x: c.x, y: c.y + 0.6, z: c.z }, 50)
    r.view.frame(1, 0, 'fixed')
    if (!ph.capture) return
    // Read the canvas in the same task as the draw: the drawing buffer is
    // only guaranteed until the browser composites it.
    ph.capture = false
    this.savePhoto(this.canvas.toDataURL('image/png'), `apex-drift-${r.rally.id}-${Date.now()}`)
  }

  private savePhoto(dataUrl: string, name: string): void {
    const n = (window as unknown as { ApexNative?: { saveImage?: (b: string, n: string) => boolean } }).ApexNative
    if (n?.saveImage) {
      toast(n.saveImage(dataUrl, name) ? t('photoSaved') : t('photoFailed'))
      return
    }
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `${name}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
    toast(t('photoSaved'))
  }

  private stopPhoto(r: RaceCtx): void {
    const ph = r.photo
    if (!ph) return
    ph.bar.remove()
    this.photoCleanup?.()
    this.photoCleanup = null
    r.photo = null
    document.body.classList.remove('photo')
    this.ui.hud.classList.remove('hidden')
    r.view.snapCamera()
    this.pauseMenuAgain()
  }

  private toMenu(): void {
    this.ui.overlay.classList.add('hidden')
    this.disposeRace()
    this.audio.playMusic('menu')
    this.home()
  }

  // ------------------------------------------------------------- pause & input

  private action(a: 'pause' | 'reset' | 'camera' | 'rewind'): void {
    const r = this.race
    if (!r || this.screen !== 'race') return
    if (a === 'pause') {
      if (r.replay) return this.stopReplay(r)
      if (r.photo) return this.stopPhoto(r)
      return this.inPauseSettings() ? this.pauseMenuAgain() : r.paused ? this.unpause() : this.pause()
    }
    if (r.paused || r.phase !== 'running') return
    if (a === 'reset') {
      r.sim.reset()
      r.codriver.seek(r.sim.car.s)
      r.view.snapCamera()
      this.audio.clearCalls()
    }
    if (a === 'rewind') {
      // Three seconds back, with a small penalty; the clock keeps the time already spent.
      if (r.rewinds <= 0 || r.history.length < 2) return
      const target = r.history[Math.max(0, r.history.length - 19)]
      const spent = r.sim.time
      restore(r.sim.car, target.car)
      restore(r.sim, target.sim)
      r.sim.time = Math.max(r.sim.time, spent)
      r.sim.penalty += REWIND_PENALTY
      r.history.length = Math.max(1, r.history.length - 18)
      r.rewinds--
      r.hud.rewinds(r.rewinds)
      r.codriver.seek(r.sim.car.s)
      r.view.syncCar(1)
      r.view.snapCamera()
      this.audio.clearCalls()
    }
    if (a === 'camera') {
      const order = ['chase', 'near', 'bonnet', 'cockpit'] as const
      r.view.camMode = order[(order.indexOf(r.view.camMode) + 1) % order.length]
      this.store.save.settings.camera = r.view.camMode
      this.store.write()
    }
  }

  private pause(): void {
    const r = this.race
    if (r?.replay) return this.stopReplay(r)
    if (!r || r.paused || r.phase === 'results') return
    r.paused = true
    this.controls.release()
    this.audio.suspend()
    const o = this.ui.overlay
    o.classList.remove('hidden')
    const st = this.store.save.settings
    html(o, `<div class="dialog" role="dialog" aria-label="${t('paused')}">
      <p class="kicker">${esc(r.mode === 'school' ? t('school') : r.rally.stages[r.stageIdx].name)}</p><h2 class="display">${t('paused')}</h2>
      <div class="opt"><label>${t('notes')}</label><div class="seg">${(['full', 'corners', 'off'] as const).map((v) => `<button class="${st.notes === v ? 'on' : ''}" data-notes="${v}">${t(`notes_${v}` as TKey)}</button>`).join('')}</div></div>
      <div class="col"><button class="btn" data-resume>${t('resume')}</button><button class="btn ghost" data-settings>${t('options')}</button><button class="btn ghost" data-photo>${t('photoMode')}</button><button class="btn ghost" data-restart>${t('restart')}</button><button class="btn ghost" data-quit>${t('quit')}</button></div></div>`)
    $('[data-settings]', o).addEventListener('click', () => this.pauseSettings('controls'))
    $('[data-photo]', o).addEventListener('click', () => this.startPhoto(r))
    o.querySelectorAll<HTMLElement>('[data-notes]').forEach((b) => b.addEventListener('click', () => {
      st.notes = b.dataset.notes as typeof st.notes
      this.store.write()
      r.codriver.setMode(st.notes)
      o.querySelectorAll('[data-notes]').forEach((x) => x.classList.toggle('on', x === b))
    }))
    $('[data-resume]', o).addEventListener('click', () => this.unpause())
    $('[data-restart]', o).addEventListener('click', () => this.load(r.rally, r.stageIdx, r.mode, r.sim.setup.car))
    $('[data-quit]', o).addEventListener('click', () => this.confirm(t('quitConfirm'), () => this.toMenu(), () => {
      r.paused = false
      this.pause()
    }))
  }

  /** Options from inside a paused race. Back (or Esc) returns to the pause menu, not the stage. */
  private pauseSettings(tab: OptTab, first = true): void {
    const r = this.race
    if (!r || !r.paused) return
    const o = this.ui.overlay
    const panel = this.settingsPanel(tab, true, (x) => this.pauseSettings(x, false))
    // Every tab or toggle redraws the dialog; only its first appearance animates.
    html(o, `<div class="dialog settings${first ? '' : ' still'}" role="dialog" aria-label="${t('options')}" data-pause-settings>
      <p class="kicker">${t('paused')}</p><h2 class="display">${t('options')}</h2>
      ${panel.html}
      <div class="col"><button class="btn" data-back-pause>${t('back')}</button></div></div>`)
    panel.bind(o)
    $('[data-back-pause]', o).addEventListener('click', () => this.pauseMenuAgain())
  }

  private inPauseSettings(): boolean {
    return !!this.race?.paused && !!this.ui.overlay.querySelector('[data-pause-settings]')
  }

  private pauseMenuAgain(): void {
    const r = this.race
    if (!r) return
    r.paused = false
    this.pause()
  }

  private unpause(): void {
    const r = this.race
    if (!r) return
    r.paused = false
    this.audio.resume()
    this.ui.overlay.classList.add('hidden')
    this.last = performance.now()
  }

  /** App went to the background, lost audio focus, or the tab was hidden. Never auto-resume. */
  private background(): void {
    if (this.race && this.race.phase !== 'results') this.pause()
    else this.audio.suspend()
  }

  /**
   * Keys that only matter with a keyboard: F toggles fullscreen anywhere, and
   * Esc steps back through menus the way Android's back button does. In a race
   * Esc is the pause key, which Controls already handles.
   */
  private desktopKey(e: KeyboardEvent): void {
    if (e.repeat || e.target instanceof HTMLInputElement) return
    if (e.code === 'KeyF' && canFullscreen()) {
      void toggleFullscreen()
      return
    }
    if (e.code !== 'Escape' || this.screen === 'race') return
    // The menu root has nowhere to go back to; on a computer it stays open.
    if (this.screen === 'menu' && this.menuStack.length <= 1 && this.ui.overlay.classList.contains('hidden')) return
    this.back()
  }

  /** Android back: close a dialog, pause, step back a menu. Returns false to let the app close. */
  private back(): boolean {
    const o = this.ui.overlay
    if (this.screen === 'race' && this.race) {
      if (this.race.replay) this.stopReplay(this.race)
      else if (this.race.photo) this.stopPhoto(this.race)
      else if (this.inPauseSettings()) this.pauseMenuAgain()
      else if (this.race.paused) this.unpause()
      else if (this.race.phase === 'results') this.toMenu()
      else this.pause()
      return true
    }
    if (!o.classList.contains('hidden')) {
      o.classList.add('hidden')
      return true
    }
    if (this.screen === 'menu' && this.menuStack.length > 1) {
      this.menuStack.pop()
      this.menuStack[this.menuStack.length - 1]()
      return true
    }
    if (this.screen === 'menu') {
      native()?.exitApp?.()
      return false
    }
    return false
  }

  private contextLost(): void {
    const r = this.race
    if (!r) return
    toast(t('graphicsLost'), 5000)
    const { rally, stageIdx, mode } = r
    this.canvas.addEventListener('webglcontextrestored', () => this.load(rally, stageIdx, mode), { once: true })
  }

  private resize(view?: StageView): void {
    this.renderer.resize()
    this.showcase?.resize(innerWidth, innerHeight)
    const v = view ?? this.race?.view
    v?.resize(innerWidth, innerHeight)
  }

  private fatal(e: unknown): void {
    console.error(e)
    const el = document.createElement('div')
    el.id = 'fatal'
    el.innerHTML = `<div><h2 class="display">Apex Drift</h2><p>${esc(String(e instanceof Error ? e.message : e))}</p><button class="btn" onclick="location.reload()">${t('retry')}</button></div>`
    document.body.appendChild(el)
  }
}

type OptTab = 'controls' | 'audio' | 'display' | 'gameplay' | 'data' | 'cheats'

const isTouch = (): boolean => document.body.classList.contains('touch')

/** The Android WebView has no fullscreen API worth using: the app is already fullscreen there. */
const canFullscreen = (): boolean => !isTouch() && !!document.documentElement.requestFullscreen && document.fullscreenEnabled

async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
  } catch {
    // Refused (no user gesture, or a browser policy): the windowed game still works.
    toast(t('fullscreenRefused'))
  }
}
