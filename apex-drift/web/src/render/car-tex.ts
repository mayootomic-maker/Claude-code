import * as THREE from 'three'

/**
 * Canvas textures for the car: two shared atlases (lamp lenses, and trim such
 * as grilles, vents, plates and gauges).
 * The atlases are drawn once and shared by every car, so they
 * are never disposed with a car.
 */

/** A region of an atlas as UV bounds: u0..u1 left to right, v0..v1 bottom to top. */
export interface Rect { u0: number; v0: number; u1: number; v1: number }

const rect = (x: number, y: number, w: number, h: number, W: number, H: number): Rect => ({ u0: x / W, u1: (x + w) / W, v0: 1 - (y + h) / H, v1: 1 - y / H })

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  if (!g) throw new Error('2D canvas unavailable')
  return [c, g]
}

function finish(c: HTMLCanvasElement, aniso = 4): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = aniso
  return t
}

const LW = 1024, LH = 512
/** Lamp atlas regions. */
export const LAMP = {
  round: rect(0, 0, 256, 256, LW, LH),
  rect: rect(256, 0, 256, 138, LW, LH),
  slim: rect(512, 0, 512, 128, LW, LH),
  tail: rect(512, 128, 512, 128, LW, LH),
  spot: rect(0, 256, 256, 256, LW, LH),
  amber: rect(256, 256, 128, 64, LW, LH),
  tailClassic: rect(512, 288, 384, 160, LW, LH),
}

let lampTex: THREE.CanvasTexture | null = null
/**
 * Lenses with what sits behind them painted in: chrome reflector bowls, the
 * bulb shield, projector glass, LED strips. The same canvas is the emissive
 * map, so a lamp glows where its bulbs and reflectors are, not as a flat disc.
 */
export function lampAtlas(): THREE.CanvasTexture {
  if (lampTex) return lampTex
  const [c, g] = canvas(LW, LH)
  g.fillStyle = '#101113'
  g.fillRect(0, 0, LW, LH)
  const bowl = (x: number, y: number, r: number, rings = 6) => {
    const gr = g.createRadialGradient(x - r * 0.15, y - r * 0.2, r * 0.05, x, y, r)
    gr.addColorStop(0, '#ffffff')
    gr.addColorStop(0.35, '#d9dde2')
    gr.addColorStop(0.75, '#8d939b')
    gr.addColorStop(1, '#3a3e44')
    g.fillStyle = gr
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
    g.strokeStyle = 'rgba(255,255,255,0.35)'
    g.lineWidth = Math.max(1, r / 40)
    for (let i = 1; i <= rings; i++) {
      g.beginPath()
      g.arc(x, y, (r * i) / (rings + 1), 0, Math.PI * 2)
      g.stroke()
    }
    // Bulb shield: the little chrome cap in the middle of every reflector.
    g.fillStyle = '#f4f6f8'
    g.beginPath()
    g.arc(x, y, r * 0.18, 0, Math.PI * 2)
    g.fill()
    g.strokeStyle = '#4a4f56'
    g.lineWidth = Math.max(1, r / 25)
    g.stroke()
  }
  const flutes = (x: number, y: number, w: number, h: number, step: number) => {
    g.save()
    g.beginPath()
    g.rect(x, y, w, h)
    g.clip()
    g.strokeStyle = 'rgba(255,255,255,0.12)'
    g.lineWidth = 1.5
    for (let i = x; i < x + w; i += step) {
      g.beginPath()
      g.moveTo(i, y)
      g.lineTo(i, y + h)
      g.stroke()
    }
    for (let j = y; j < y + h; j += step * 1.6) {
      g.beginPath()
      g.moveTo(x, j)
      g.lineTo(x + w, j)
      g.stroke()
    }
    g.restore()
  }
  // Round sealed-beam headlamp.
  g.fillStyle = '#2a2d31'
  g.beginPath()
  g.arc(128, 128, 126, 0, Math.PI * 2)
  g.fill()
  bowl(128, 128, 112, 7)
  flutes(16, 16, 224, 224, 14)
  // Rectangular headlamp: twin reflectors behind one lens.
  g.fillStyle = '#25282c'
  g.fillRect(256, 0, 256, 138)
  bowl(256 + 70, 69, 58, 5)
  bowl(256 + 180, 69, 50, 4)
  flutes(258, 2, 252, 134, 12)
  // Slim modern lamp: smoked housing, projector, reflector and an LED daytime strip.
  {
    const x = 512, y = 0
    const gr = g.createLinearGradient(x, y, x, y + 128)
    gr.addColorStop(0, '#2b2f35')
    gr.addColorStop(1, '#0e1012')
    g.fillStyle = gr
    g.fillRect(x, y, 512, 128)
    bowl(x + 340, y + 66, 44, 4)
    // Projector: dark glass ball with a bright ring around it.
    g.fillStyle = '#d4dbe4'
    g.beginPath()
    g.arc(x + 170, y + 66, 46, 0, Math.PI * 2)
    g.fill()
    const pj = g.createRadialGradient(x + 160, y + 56, 4, x + 170, y + 66, 40)
    pj.addColorStop(0, '#9fb8d8')
    pj.addColorStop(0.4, '#2a3a52')
    pj.addColorStop(1, '#05070a')
    g.fillStyle = pj
    g.beginPath()
    g.arc(x + 170, y + 66, 38, 0, Math.PI * 2)
    g.fill()
    // LED strip: a hooked light guide along the top edge.
    g.strokeStyle = '#ffffff'
    g.lineWidth = 9
    g.lineCap = 'round'
    g.shadowColor = '#e8f2ff'
    g.shadowBlur = 14
    g.beginPath()
    g.moveTo(x + 40, y + 104)
    g.lineTo(x + 70, y + 20)
    g.lineTo(x + 470, y + 16)
    g.stroke()
    g.shadowBlur = 0
    g.fillStyle = '#e08a1c'
    g.fillRect(x + 410, y + 92, 80, 18)
  }
  // Modern tail lamp: smoked red with a glowing C-shaped LED outline.
  {
    const x = 512, y = 128
    g.fillStyle = '#3a0607'
    g.fillRect(x, y, 512, 128)
    g.strokeStyle = '#ff2a20'
    g.shadowColor = '#ff3b2a'
    g.shadowBlur = 18
    g.lineWidth = 12
    g.beginPath()
    g.moveTo(x + 480, y + 24)
    g.lineTo(x + 60, y + 24)
    g.lineTo(x + 40, y + 64)
    g.lineTo(x + 60, y + 104)
    g.lineTo(x + 480, y + 104)
    g.stroke()
    g.shadowBlur = 0
    g.fillStyle = '#7d0f10'
    for (let i = 0; i < 3; i++) {
      g.beginPath()
      g.arc(x + 150 + i * 90, y + 64, 26, 0, Math.PI * 2)
      g.fill()
    }
    g.fillStyle = '#e9e6e0'
    g.fillRect(x + 400, y + 46, 70, 36)
  }
  // Classic tail lamp: ribbed red, amber indicator, white reverse light.
  {
    const x = 512, y = 288
    g.fillStyle = '#9c1010'
    g.fillRect(x, y, 384, 160)
    g.fillStyle = '#d88a18'
    g.fillRect(x + 270, y, 114, 160)
    g.fillStyle = '#ebe8e2'
    g.fillRect(x + 190, y + 50, 70, 60)
    g.fillStyle = 'rgba(255,255,255,0.18)'
    for (let j = 8; j < 160; j += 16) g.fillRect(x, y + j, 384, 4)
    g.strokeStyle = '#2a0a0a'
    g.lineWidth = 6
    g.strokeRect(x + 3, y + 3, 378, 154)
  }
  // Spot lamp: a deep reflector with a cross-hatched lens.
  g.fillStyle = '#16181b'
  g.fillRect(0, 256, 256, 256)
  bowl(128, 384, 120, 9)
  g.save()
  g.beginPath()
  g.arc(128, 384, 120, 0, Math.PI * 2)
  g.clip()
  g.strokeStyle = 'rgba(255,255,255,0.16)'
  g.lineWidth = 2
  for (let i = -256; i < 256; i += 16) {
    g.beginPath()
    g.moveTo(128 + i, 256)
    g.lineTo(128 + i + 256, 512)
    g.moveTo(128 + i, 512)
    g.lineTo(128 + i + 256, 256)
    g.stroke()
  }
  g.restore()
  // Amber side repeater.
  const am = g.createLinearGradient(256, 256, 256, 320)
  am.addColorStop(0, '#ffc25a')
  am.addColorStop(1, '#b8640a')
  g.fillStyle = am
  g.fillRect(256, 256, 128, 64)
  g.fillStyle = 'rgba(255,255,255,0.25)'
  for (let i = 260; i < 384; i += 12) g.fillRect(i, 256, 3, 64)
  lampTex = finish(c, 8)
  return lampTex
}

const TW = 1024, TH = 512
/** Trim atlas regions. */
export const TRIM = {
  honey: rect(0, 0, 256, 128, TW, TH),
  slats: rect(256, 0, 256, 128, TW, TH),
  plate: rect(512, 0, 256, 64, TW, TH),
  switches: rect(512, 64, 256, 64, TW, TH),
  gauges: rect(768, 0, 256, 128, TW, TH),
  carbon: rect(0, 128, 128, 128, TW, TH),
  flap: rect(128, 128, 256, 128, TW, TH),
  filler: rect(384, 128, 64, 64, TW, TH),
  mesh: rect(448, 128, 64, 64, TW, TH),
  trip: rect(512, 128, 128, 64, TW, TH),
  tread: rect(640, 128, 128, 64, TW, TH),
}

let trimTex: THREE.CanvasTexture | null = null
export function trimAtlas(): THREE.CanvasTexture {
  if (trimTex) return trimTex
  const [c, g] = canvas(TW, TH)
  g.fillStyle = '#18191b'
  g.fillRect(0, 0, TW, TH)
  // Honeycomb grille mesh.
  g.fillStyle = '#060607'
  g.fillRect(0, 0, 256, 128)
  g.strokeStyle = '#3c3f44'
  g.lineWidth = 2.5
  const r = 9
  for (let row = 0; row < 12; row++)
    for (let col = 0; col < 18; col++) {
      const cx = col * r * 1.75 + (row % 2) * r * 0.875, cy = row * r * 1.5
      g.beginPath()
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + Math.PI / 6
        const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r
        if (k) g.lineTo(px, py)
        else g.moveTo(px, py)
      }
      g.closePath()
      g.stroke()
    }
  // Louvred vent: dark gaps between lit slats.
  for (let i = 0; i < 8; i++) {
    const y = i * 16
    const gr = g.createLinearGradient(0, y, 0, y + 16)
    gr.addColorStop(0, '#55595f')
    gr.addColorStop(0.45, '#2a2c30')
    gr.addColorStop(0.5, '#050505')
    gr.addColorStop(1, '#050505')
    g.fillStyle = gr
    g.fillRect(256, y, 256, 16)
  }
  // Number plate: generic, no real country's format.
  g.fillStyle = '#f2f0e8'
  g.fillRect(512, 0, 256, 64)
  g.strokeStyle = '#111'
  g.lineWidth = 4
  g.strokeRect(516, 4, 248, 56)
  g.fillStyle = '#16181b'
  g.font = '800 44px "Barlow Condensed", sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('AD 307 RX', 640, 34)
  // Switch panel: toggles with guards and labels.
  g.fillStyle = '#202226'
  g.fillRect(512, 64, 256, 64)
  for (let i = 0; i < 8; i++) {
    const x = 524 + i * 31
    g.fillStyle = i === 0 ? '#c8231c' : i < 3 ? '#e0a020' : '#9aa0a8'
    g.fillRect(x, 78, 14, 22)
    g.fillStyle = '#e8e8e8'
    g.fillRect(x + 2, 106, 10, 4)
  }
  // Gauges: tacho, speedo and a shift light bar.
  g.fillStyle = '#0d0e10'
  g.fillRect(768, 0, 256, 128)
  for (const [cx, rr] of [[830, 52], [960, 44]] as const) {
    g.fillStyle = '#f1efe8'
    g.beginPath()
    g.arc(cx, 70, rr, 0, Math.PI * 2)
    g.fill()
    g.strokeStyle = '#111'
    g.lineWidth = 3
    for (let k = 0; k <= 10; k++) {
      const a = Math.PI * 0.75 + (k / 10) * Math.PI * 1.5
      g.beginPath()
      g.moveTo(cx + Math.cos(a) * rr * 0.72, 70 + Math.sin(a) * rr * 0.72)
      g.lineTo(cx + Math.cos(a) * rr * 0.92, 70 + Math.sin(a) * rr * 0.92)
      g.stroke()
    }
    g.strokeStyle = '#e02a1a'
    g.lineWidth = 4
    g.beginPath()
    g.moveTo(cx, 70)
    g.lineTo(cx + Math.cos(Math.PI * 1.1) * rr * 0.8, 70 + Math.sin(Math.PI * 1.1) * rr * 0.8)
    g.stroke()
  }
  for (let i = 0; i < 9; i++) {
    g.fillStyle = i < 5 ? '#2ad04a' : i < 7 ? '#f0c020' : '#ff2a1a'
    g.fillRect(790 + i * 24, 6, 18, 10)
  }
  // Carbon weave.
  for (let y = 128; y < 256; y += 8)
    for (let x = 0; x < 128; x += 8) {
      const odd = ((x + y) / 8) % 2
      const gr = g.createLinearGradient(x, y, odd ? x + 8 : x, odd ? y : y + 8)
      gr.addColorStop(0, '#1b1c1f')
      gr.addColorStop(0.5, '#3a3d42')
      gr.addColorStop(1, '#141517')
      g.fillStyle = gr
      g.fillRect(x, y, 8, 8)
    }
  // Mudflap: black rubber with the team script.
  g.fillStyle = '#121214'
  g.fillRect(128, 128, 256, 128)
  g.fillStyle = '#f0eee8'
  g.font = '800 46px "Barlow Condensed", sans-serif'
  g.save()
  g.translate(256, 192)
  g.rotate(-Math.PI / 2)
  g.fillText('APEX', 0, -20)
  g.font = '700 26px "Barlow Condensed", sans-serif'
  g.fillText('DRIFT', 0, 20)
  g.restore()
  // Fuel filler cap.
  g.fillStyle = '#2a2c30'
  g.fillRect(384, 128, 64, 64)
  g.fillStyle = '#c9ccd0'
  g.beginPath()
  g.arc(416, 160, 28, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#7b8088'
  g.beginPath()
  g.arc(416, 160, 18, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#e8eaec'
  g.fillRect(400, 156, 32, 8)
  // Fine mesh.
  g.fillStyle = '#050506'
  g.fillRect(448, 128, 64, 64)
  g.strokeStyle = '#34363a'
  g.lineWidth = 1
  for (let i = 0; i < 64; i += 4) {
    g.beginPath()
    g.moveTo(448 + i, 128)
    g.lineTo(448 + i, 192)
    g.moveTo(448, 128 + i)
    g.lineTo(512, 128 + i)
    g.stroke()
  }
  // Co-driver's trip meter screen.
  g.fillStyle = '#0a1a10'
  g.fillRect(512, 128, 128, 64)
  g.fillStyle = '#7dff9a'
  g.font = '700 30px monospace'
  g.fillText('12.84', 576, 160)
  // Rubber tread plate for footrests and sills.
  g.fillStyle = '#1e1f22'
  g.fillRect(640, 128, 128, 64)
  g.fillStyle = '#34363a'
  for (let y = 132; y < 192; y += 10) for (let x = 644; x < 768; x += 10) g.fillRect(x, y, 5, 2)
  trimTex = finish(c, 8)
  return trimTex
}
