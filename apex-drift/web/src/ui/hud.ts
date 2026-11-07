import { clamp } from '../core/math'
import type { Note } from '../game/pacenotes'
import { t } from '../game/i18n'
import type { StageSim } from '../sim/stage'
import { STEP } from '../sim/route'
import { $, fmtDelta, fmtTime, html } from './dom'

// Arrows draw in currentColor so the card's severity tint reaches them.
const ARROWS: Record<string, string> = {
  left: '<svg viewBox="0 0 40 40"><path d="M28 34 V18 Q28 10 20 10 H10" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M14 4 L6 10 L14 16" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right: '<svg viewBox="0 0 40 40"><path d="M12 34 V18 Q12 10 20 10 H30" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M26 4 L34 10 L26 16" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  hairpinleft: '<svg viewBox="0 0 40 40"><path d="M28 36 V14 A8 8 0 0 0 12 14 V30" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M6 24 L12 32 L18 24" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  hairpinright: '<svg viewBox="0 0 40 40"><path d="M12 36 V14 A8 8 0 0 1 28 14 V30" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M22 24 L28 32 L34 24" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
}

/** Line icons for the HUD buttons; they take the button's text colour. */
const ICONS = {
  rewind: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 6 L4 12 L11 18 Z M20 6 L13 12 L20 18 Z"/></svg>',
  camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5h3l1.6-2.5h6.8L17 8.5h3v10H4z"/><circle cx="12" cy="13.2" r="3.3"/></svg>',
  reset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12a7 7 0 1 0 2.1-5"/><path d="M5 4.5V9h4.5"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5.5v13M15.5 5.5v13" stroke-width="3.2"/></svg>',
  hand: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M13 31 L25 9"/><circle cx="26" cy="8" r="3.5"/><path d="M8 32h17"/></svg>',
  brake: '<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="8" y="12" width="24" height="15" rx="3"/><path d="M14 17.5h12M14 21.5h12M20 27v6"/></svg>',
  gas: '<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="13" y="5" width="14" height="26" rx="3"/><path d="M17 11h6M17 16h6M17 21h6M20 31v5"/></svg>',
}

/** Rev dial: a 270° arc from bottom left, a tick every tenth of the redline, a red band at the top end. */
const TACHO = (() => {
  let ticks = ''
  for (let k = 0; k <= 10; k++) {
    const a = (k / 10) * 1.5 * Math.PI
    const r0 = k % 2 ? 42 : 39
    const x = (r: number) => (60 + Math.cos(a) * r).toFixed(1)
    const y = (r: number) => (60 + Math.sin(a) * r).toFixed(1)
    ticks += `<line class="${k % 2 ? '' : 'major'}" x1="${x(r0)}" y1="${y(r0)}" x2="${x(46)}" y2="${y(46)}"/>`
  }
  return `<svg viewBox="0 0 120 120" aria-hidden="true"><defs><linearGradient id="tacho-grad" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#ffd24d"/><stop offset="1" stop-color="#ff7a1a"/></linearGradient></defs>`
    + '<circle class="plate" cx="60" cy="60" r="58"/>'
    + `<g class="dial"><circle class="track" cx="60" cy="60" r="52"/><circle class="red" cx="60" cy="60" r="52"/><circle class="fill" cx="60" cy="60" r="52"/><g class="ticks">${ticks}</g></g></svg>`
})()

export class Hud {
  readonly root: HTMLElement
  private readonly time: HTMLElement
  private readonly split: HTMLElement
  private readonly prog: HTMLElement
  private readonly speed: HTMLElement
  private readonly gear: HTMLElement
  private readonly arc: SVGCircleElement
  private readonly tacho: HTMLElement
  private readonly note: HTMLElement
  private readonly say: HTMLElement
  private readonly big: HTMLElement
  private readonly warn: HTMLElement
  private readonly map: HTMLCanvasElement
  private sayTimer = 0
  private sectorTimer = 0
  private lastNote: Note | null = null
  private lastSec = -1
  private mapPath: Path2D | null = null
  private mapScale = 1
  private mapCx = 0
  private mapCz = 0

  constructor(root: HTMLElement, private readonly mph: boolean) {
    this.root = html(root, `
      <div class="h-stage"><div class="name"></div><div class="time" aria-live="off">0:00.00</div><div class="split"></div><div class="h-prog"><i></i></div></div>
      <div class="h-note" style="opacity:0"></div>
      <div class="h-tools">
        <button data-act="rewind" aria-label="${t('rewind')}">${ICONS.rewind}<span class="rw-n"></span></button>
        <button data-act="camera" aria-label="${t('camera')}">${ICONS.camera}</button>
        <button data-act="reset" aria-label="${t('reset')}">${ICONS.reset}</button>
        <button data-act="pause" aria-label="${t('paused')}">${ICONS.pause}</button>
      </div>
      <div class="h-say" style="opacity:0" aria-live="polite"></div>
      <div class="h-big hidden" aria-live="assertive"></div>
      <div class="h-warn hidden"></div>
      <div class="h-sector hidden" aria-live="polite"></div>
      <canvas id="minimap" width="240" height="240"></canvas>
      <div class="speedo">${TACHO}<b>0</b><span>${mph ? 'MPH' : 'KM/H'}</span><i>1</i></div>
      <div class="pads l">
        <button data-ctl="left" aria-label="Steer left"><svg viewBox="0 0 40 40"><path d="M24 8 L12 20 L24 32"/></svg></button>
        <button data-ctl="right" aria-label="Steer right"><svg viewBox="0 0 40 40"><path d="M16 8 L28 20 L16 32"/></svg></button>
      </div>
      <div class="pads r">
        <button data-ctl="hand" class="small" aria-label="Handbrake">${ICONS.hand}HAND</button>
        <button data-ctl="brake" aria-label="Brake">${ICONS.brake}BRAKE</button>
        <button data-ctl="gas" class="gas" aria-label="Throttle">${ICONS.gas}GAS</button>
      </div>
      <p class="keys-hint">${t('keysHint')}</p>`)
    this.time = $('.time', root)
    this.split = $('.split', root)
    this.prog = $('.h-prog i', root)
    this.speed = $('.speedo b', root)
    this.gear = $('.speedo i', root)
    this.arc = root.querySelector('.speedo .fill') as SVGCircleElement
    this.tacho = $('.speedo', root)
    this.note = $('.h-note', root)
    this.say = $('.h-say', root)
    this.big = $('.h-big', root)
    this.warn = $('.h-warn', root)
    this.map = $('#minimap', root) as HTMLCanvasElement
  }

  setStage(name: string, sim: StageSim): void {
    $('.name', this.root).textContent = name
    // Minimap: the whole stage, scaled to fit, drawn once and reused.
    const r = sim.route
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (let i = 0; i < r.n; i++) {
      minX = Math.min(minX, r.x[i]); maxX = Math.max(maxX, r.x[i])
      minZ = Math.min(minZ, r.z[i]); maxZ = Math.max(maxZ, r.z[i])
    }
    // 180 of 240 px: room inside the round frame for the start and finish dots.
    this.mapScale = 170 / Math.max(maxX - minX, maxZ - minZ, 1)
    this.mapCx = (minX + maxX) / 2
    this.mapCz = (minZ + maxZ) / 2
    const p = new Path2D()
    for (let i = 0; i < r.n; i += 3) {
      const [x, y] = this.toMap(r.x[i], r.z[i])
      if (i === 0) p.moveTo(x, y)
      else p.lineTo(x, y)
    }
    this.mapPath = p
  }

  private toMap(x: number, z: number): [number, number] {
    // Mirror X so the map's left is the driver's left when heading "up".
    return [120 - (x - this.mapCx) * this.mapScale, 120 - (z - this.mapCz) * this.mapScale]
  }

  update(sim: StageSim, target: number | null): void {
    const car = sim.car
    this.time.textContent = fmtTime(sim.total)
    const frac = clamp(sim.progress / sim.length, 0, 1)
    this.prog.style.width = `${(frac * 100).toFixed(1)}%`
    if (target !== null && sim.phase === 'running' && frac > 0.02) {
      // Compare with gold pace at the same point of the stage.
      const d = sim.total - target * frac
      this.split.textContent = `${t('target')} ${fmtDelta(d)}`
      this.split.className = `split ${d <= 0 ? 'ahead' : 'behind'}`
    } else this.split.textContent = ''
    const v = car.speed * (this.mph ? 2.237 : 3.6)
    this.speed.textContent = String(Math.round(v))
    // The real gearbox: gear and revs straight from the drivetrain.
    this.gear.textContent = car.gear < 0 ? "R" : String(car.gear)
    this.arc.style.strokeDasharray = `${((Math.min(car.rpm, car.redline) / car.redline) * 245).toFixed(0)} 400`
    this.tacho.classList.toggle('shift', car.rpm > car.redline * 0.94)
    this.warn.textContent = t('wrongWay')
    this.warn.classList.toggle('hidden', !sim.isWrongWay)
    this.drawMap(sim)
  }

  rewinds(n: number): void {
    const el = this.root.querySelector('.rw-n')
    if (el) el.textContent = String(n)
    this.root.querySelector('[data-act="rewind"]')?.toggleAttribute('disabled', n <= 0)
  }

  /** Sector split: green when faster than the reference, red when slower. */
  sector(n: number, delta: number | null): void {
    const el = this.root.querySelector('.h-sector') as HTMLElement | null
    if (!el) return
    el.textContent = delta === null ? `${t('sector')} ${n}` : `${t('sector')} ${n}  ${fmtDelta(delta)}`
    el.className = `h-sector ${delta === null ? '' : delta <= 0 ? 'ahead' : 'behind'}`
    clearTimeout(this.sectorTimer)
    this.sectorTimer = window.setTimeout(() => el.classList.add('hidden'), 2600)
  }

  /** The next corner, shown as an arrow and its grade. */
  showNote(n: Note | null): void {
    if (n === this.lastNote) return
    this.lastNote = n
    if (!n || n.kind !== 'corner') {
      this.note.style.opacity = '0'
      return
    }
    const key = n.grade === 0 ? `hairpin${n.dir}` : (n.dir ?? 'left')
    const extra = [n.long ? 'long' : '', n.tightens ? 'tightens' : n.opens ? 'opens' : ''].filter(Boolean).join(' · ')
    this.note.innerHTML = `${ARROWS[key]}<span class="g">${n.grade === 0 ? 'H' : n.grade}</span><span class="w">${extra}</span>`
    // Tight corners read red, fast ones calm, at a glance and before the number.
    this.note.dataset.sev = n.grade <= 2 ? 'hard' : n.grade >= 5 ? 'easy' : 'mid'
    this.note.style.opacity = '1'
    // Restart the pop so every new call catches the eye, not only the first.
    this.note.classList.remove('pop')
    void this.note.offsetWidth
    this.note.classList.add('pop')
  }

  subtitle(text: string): void {
    this.say.textContent = text
    this.say.style.opacity = '1'
    clearTimeout(this.sayTimer)
    this.sayTimer = window.setTimeout(() => (this.say.style.opacity = '0'), 2200)
  }

  /** Countdown numbers and GO; screen readers hear each once, never per frame. */
  bigText(text: string | null, go = false): void {
    if (text === null) {
      this.big.classList.add('hidden')
      this.lastSec = -1
      return
    }
    if (this.big.textContent === text && !this.big.classList.contains('hidden')) return
    this.big.textContent = text
    this.big.classList.toggle('go', go)
    this.big.classList.remove('hidden')
    // Each number slams in fresh; the animation restarts on every change.
    this.big.style.animation = 'none'
    void this.big.offsetWidth
    this.big.style.animation = ''
  }

  countdown(sec: number): boolean {
    const n = Math.ceil(sec)
    if (n === this.lastSec) return false
    this.lastSec = n
    this.bigText(String(n))
    return true
  }

  private drawMap(sim: StageSim): void {
    const g = this.map.getContext('2d')
    if (!g || !this.mapPath) return
    g.clearRect(0, 0, 240, 240)
    g.lineCap = g.lineJoin = 'round'
    g.strokeStyle = 'rgba(0,0,0,0.5)'
    g.lineWidth = 11
    g.stroke(this.mapPath)
    g.strokeStyle = 'rgba(245,241,232,0.55)'
    g.lineWidth = 5
    g.stroke(this.mapPath)
    // The road already driven, in amber.
    const r = sim.route
    const a0 = Math.max(0, Math.floor(sim.start / STEP))
    const a1 = Math.min(r.n - 1, Math.floor(sim.car.s / STEP))
    if (a1 > a0) {
      g.beginPath()
      for (let i = a0; i <= a1; i += 3) {
        const [x, y] = this.toMap(r.x[i], r.z[i])
        if (i === a0) g.moveTo(x, y)
        else g.lineTo(x, y)
      }
      const [ex, ey] = this.toMap(r.x[a1], r.z[a1])
      g.lineTo(ex, ey)
      g.strokeStyle = '#ffb81c'
      g.lineWidth = 6
      g.stroke()
    }
    const dot = (s: number, col: string, rad: number) => {
      const a = sim.route.at(s)
      const [x, y] = this.toMap(a.x, a.z)
      g.fillStyle = col
      g.strokeStyle = 'rgba(0,0,0,0.6)'
      g.lineWidth = 3
      g.beginPath()
      g.arc(x, y, rad, 0, Math.PI * 2)
      g.fill()
      g.stroke()
    }
    dot(sim.start, '#4fd18b', 7)
    dot(sim.finish, '#ff5a4e', 7)
    // The car as an arrowhead pointing where it is heading (X mirrored, as in toMap).
    const [cx, cy] = this.toMap(sim.car.x, sim.car.z)
    const h = sim.car.heading
    const fx = -Math.sin(h), fy = -Math.cos(h)
    g.beginPath()
    g.moveTo(cx + fx * 14, cy + fy * 14)
    g.lineTo(cx - fx * 8 + fy * 9, cy - fy * 8 - fx * 9)
    g.lineTo(cx - fx * 4, cy - fy * 4)
    g.lineTo(cx - fx * 8 - fy * 9, cy - fy * 8 + fx * 9)
    g.closePath()
    g.fillStyle = '#ffffff'
    g.strokeStyle = '#ff7a1a'
    g.lineWidth = 3
    g.fill()
    g.stroke()
  }
}
