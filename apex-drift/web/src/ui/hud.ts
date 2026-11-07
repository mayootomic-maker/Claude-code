import { clamp } from '../core/math'
import type { Note } from '../game/pacenotes'
import { t } from '../game/i18n'
import type { StageSim } from '../sim/stage'
import { $, esc, fmtDelta, fmtTime, html } from './dom'

const ARROWS: Record<string, string> = {
  left: '<svg viewBox="0 0 40 40"><path d="M28 34 V18 Q28 10 20 10 H10" fill="none" stroke="#ffb81c" stroke-width="5" stroke-linecap="round"/><path d="M14 4 L6 10 L14 16" fill="none" stroke="#ffb81c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right: '<svg viewBox="0 0 40 40"><path d="M12 34 V18 Q12 10 20 10 H30" fill="none" stroke="#ffb81c" stroke-width="5" stroke-linecap="round"/><path d="M26 4 L34 10 L26 16" fill="none" stroke="#ffb81c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  hairpinleft: '<svg viewBox="0 0 40 40"><path d="M28 36 V14 A8 8 0 0 0 12 14 V30" fill="none" stroke="#ffb81c" stroke-width="5" stroke-linecap="round"/><path d="M6 24 L12 32 L18 24" fill="none" stroke="#ffb81c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  hairpinright: '<svg viewBox="0 0 40 40"><path d="M12 36 V14 A8 8 0 0 1 28 14 V30" fill="none" stroke="#ffb81c" stroke-width="5" stroke-linecap="round"/><path d="M22 24 L28 32 L34 24" fill="none" stroke="#ffb81c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
}

export class Hud {
  readonly root: HTMLElement
  private readonly time: HTMLElement
  private readonly split: HTMLElement
  private readonly prog: HTMLElement
  private readonly speed: HTMLElement
  private readonly gear: HTMLElement
  private readonly arc: SVGCircleElement
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
  private raceTick = 0
  /** Minimap colours of the rivals, from their liveries. */
  private rivalColors: string[] = []

  constructor(root: HTMLElement, private readonly mph: boolean) {
    this.root = html(root, `
      <div class="h-stage"><div class="name"></div><div class="time" aria-live="off">0:00.00</div><div class="split"></div><div class="h-prog"><i></i></div><div class="h-race hidden" aria-live="off"><b class="pos">P1</b><span class="of"></span><div class="gaps"></div></div></div>
      <div class="h-note" style="opacity:0"></div>
      <div class="h-tools">
        <button data-act="rewind" aria-label="${t('rewind')}"><svg viewBox="0 0 20 20"><path d="M9 4 L3 10 L9 16 Z M17 4 L11 10 L17 16 Z"/></svg><span class="rw-n"></span></button>
        <button data-act="camera" aria-label="${t('camera')}">CAM</button>
        <button data-act="reset" aria-label="${t('reset')}">${t('reset').toUpperCase()}</button>
        <button data-act="pause" aria-label="${t('paused')}"><svg viewBox="0 0 20 20"><rect x="4" y="3" width="4" height="14"/><rect x="12" y="3" width="4" height="14"/></svg></button>
      </div>
      <div class="h-say" style="opacity:0" aria-live="polite"></div>
      <div class="h-big hidden" aria-live="assertive"></div>
      <div class="h-warn hidden"></div>
      <div class="h-sector hidden" aria-live="polite"></div>
      <canvas id="minimap" width="240" height="240"></canvas>
      <div class="speedo"><svg viewBox="0 0 120 120"><circle class="track" cx="60" cy="60" r="52"/><circle class="fill" cx="60" cy="60" r="52"/></svg><b>0</b><span>${mph ? 'MPH' : 'KM/H'}</span><i>1</i></div>
      <div class="pads l">
        <button data-ctl="left" aria-label="Steer left"><svg viewBox="0 0 40 40"><path d="M26 8 L12 20 L26 32"/></svg></button>
        <button data-ctl="right" aria-label="Steer right"><svg viewBox="0 0 40 40"><path d="M14 8 L28 20 L14 32"/></svg></button>
      </div>
      <div class="pads r">
        <button data-ctl="hand" class="small">HAND</button>
        <button data-ctl="brake">BRAKE</button>
        <button data-ctl="gas" class="gas">GAS</button>
      </div>
      <p class="keys-hint">${t('keysHint')}</p>`)
    this.time = $('.time', root)
    this.split = $('.split', root)
    this.prog = $('.h-prog i', root)
    this.speed = $('.speedo b', root)
    this.gear = $('.speedo i', root)
    this.arc = root.querySelector('.speedo .fill') as SVGCircleElement
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
    this.mapScale = 200 / Math.max(maxX - minX, maxZ - minZ, 1)
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
    this.arc.style.stroke = car.rpm > car.redline * 0.94 ? 'var(--bad)' : ''
    if (sim.racing) this.racePanel(sim)
    this.warn.textContent = t('wrongWay')
    this.warn.classList.toggle('hidden', !sim.isWrongWay)
    this.drawMap(sim)
  }

  /** Rival colours for the minimap, in the order of `sim.field`. */
  setRivals(colors: number[]): void {
    this.rivalColors = colors.map((c) => `#${c.toString(16).padStart(6, '0')}`)
  }

  /** Race position and the gaps to the cars either side, refreshed a few times a second. */
  private racePanel(sim: StageSim): void {
    if (this.raceTick++ % 10) return
    const el = this.root.querySelector('.h-race') as HTMLElement | null
    if (!el) return
    const order = sim.order()
    const pos = order.findIndex((e) => e.you) + 1
    const g = sim.gaps()
    el.classList.remove('hidden')
    el.classList.toggle('lead', pos === 1)
    $('.pos', el).textContent = `P${pos}`
    $('.of', el).textContent = `/${order.length}`
    const fmt = (v: number) => `${v.toFixed(1)}s`
    $('.gaps', el).innerHTML = [
      g.ahead !== null && pos > 1 ? `<span class="behind">▲ ${esc(order[pos - 2].name)} ${fmt(g.ahead)}</span>` : '',
      g.behind !== null && pos < order.length ? `<span class="ahead">▼ ${esc(order[pos].name)} ${fmt(g.behind)}</span>` : '',
    ].join('')
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
    this.note.style.opacity = '1'
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
    g.strokeStyle = 'rgba(0,0,0,0.45)'
    g.lineWidth = 9
    g.stroke(this.mapPath)
    g.strokeStyle = 'rgba(243,239,230,0.85)'
    g.lineWidth = 4
    g.stroke(this.mapPath)
    const draw = (s: number, col: string, r: number) => {
      const a = sim.route.at(s)
      const [x, y] = this.toMap(a.x, a.z)
      g.fillStyle = col
      g.beginPath()
      g.arc(x, y, r, 0, Math.PI * 2)
      g.fill()
    }
    draw(sim.start, '#57c48a', 5)
    draw(sim.finish, '#ef6a5a', 5)
    sim.field.forEach((o, i) => {
      const [x, y] = this.toMap(o.car.x, o.car.z)
      g.fillStyle = this.rivalColors[i] ?? '#9fb4c8'
      g.strokeStyle = '#000'
      g.lineWidth = 1.5
      g.beginPath()
      g.arc(x, y, 5, 0, Math.PI * 2)
      g.fill()
      g.stroke()
    })
    const [cx, cy] = this.toMap(sim.car.x, sim.car.z)
    g.fillStyle = '#ffb81c'
    g.strokeStyle = '#000'
    g.lineWidth = 2
    g.beginPath()
    g.arc(cx, cy, 7, 0, Math.PI * 2)
    g.fill()
    g.stroke()
  }
}
