import * as THREE from 'three'
import type { DriverLook, HelmetLook } from '../game/paint'
import { hex, mix } from './livery-paint'

/**
 * The driver's paint: his helmet and his loud shirt. Both are drawn per
 * driver, so each car owns and disposes its own.
 */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  if (!g) throw new Error('2D canvas unavailable')
  return [c, g]
}

function finish(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

/**
 * Helmet paint, mapped by direction from the helmet's centre: u runs from the
 * right ear (0) to the left ear (1), v round the head from the back (0) via
 * the chin (0.25), the face (0.5) and the crown (0.75). Most designs are
 * defined on that direction, so bands wrap the shell as they would on a real
 * helmet instead of smearing at the ears.
 */
export function drawHelmet(c: HTMLCanvasElement, h: HelmetLook, name: string, num: string): void {
  const W = c.width, H = c.height
  const g = c.getContext('2d')
  if (!g) return
  const P = [(h.base >> 16) & 255, (h.base >> 8) & 255, h.base & 255]
  const S = [(h.secondary >> 16) & 255, (h.secondary >> 8) & 255, h.secondary & 255]
  const A = [(h.accent >> 16) & 255, (h.accent >> 8) & 255, h.accent & 255]
  const img = g.createImageData(W, H)
  const field = (dx: number, dy: number, dz: number): number[] => {
    switch (h.pattern) {
      case 'stripe': {
        const a = Math.abs(dx)
        return a < 0.13 ? S : a > 0.16 && a < 0.2 ? A : P
      }
      case 'split':
        return Math.abs(dx) < 0.035 ? A : dx > 0 ? S : P
      case 'halo':
        return dy > 0.08 && dy < 0.32 ? S : (dy > 0.02 && dy < 0.07) || (dy > 0.34 && dy < 0.39) ? A : P
      case 'tricolor':
        return dz > 0.35 ? S : dz < -0.35 ? A : P
      case 'checker': {
        if (dy > 0.5 && dy < 0.56) return A
        if (dy < 0.56) return P
        const a = Math.floor((Math.atan2(dx, dz) + Math.PI) / (Math.PI / 8)), r = Math.floor((1 - dy) / 0.09)
        return (a + r) % 2 ? S : P
      }
      default:
        return P
    }
  }
  for (let y = 0; y < H; y++) {
    const th = (1 - (y + 0.5) / H) * Math.PI * 2 - Math.PI
    for (let x = 0; x < W; x++) {
      const dx = ((x + 0.5) / W) * 2 - 1
      const r = Math.sqrt(Math.max(0, 1 - dx * dx))
      const col = field(dx, r * Math.sin(th), r * Math.cos(th))
      const i = (y * W + x) * 4
      img.data[i] = col[0]
      img.data[i + 1] = col[1]
      img.data[i + 2] = col[2]
      img.data[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  const vy = (v: number) => (1 - v) * H
  const sec = hex(h.secondary), acc = hex(h.accent)
  if (h.pattern === 'flames') {
    // Tongues of flame from the brow licking back over the crown.
    for (const [col, k] of [[sec, 1], [acc, 0.55]] as const) {
      g.fillStyle = col
      g.beginPath()
      g.moveTo(0, vy(0.56))
      for (let i = 0; i <= 14; i++) {
        const x = (i / 14) * W
        const len = (0.16 + 0.14 * Math.abs(Math.sin(i * 1.7))) * k
        g.quadraticCurveTo(x - W / 28, vy(0.6 + len * 0.6), x, vy(0.6 + len))
        g.quadraticCurveTo(x + W / 40, vy(0.6 + len * 0.4), x + W / 28, vy(0.58))
      }
      g.lineTo(W, vy(0.5))
      g.lineTo(0, vy(0.5))
      g.fill()
    }
  } else if (h.pattern === 'stars') {
    let seed = 11
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 26; i++) {
      const x = rnd() * W, y = vy(0.6 + rnd() * 0.38), r = 6 + rnd() * 10
      g.fillStyle = i % 3 ? sec : acc
      g.beginPath()
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 - Math.PI / 2, rr = k % 2 ? r * 0.45 : r
        g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
      }
      g.fill()
    }
    g.fillStyle = sec
    g.fillRect(W * 0.47, 0, W * 0.06, H * 0.5)
  } else if (h.pattern === 'bolt') {
    for (const s of [0, 1]) {
      const x = s ? W * 0.86 : W * 0.14, f = s ? -1 : 1
      g.fillStyle = acc
      g.beginPath()
      const pts = [[-14, 0.86], [10, 0.86], [-2, 0.66], [16, 0.66], [-14, 0.34], [-2, 0.56], [-18, 0.56]]
      pts.forEach(([dx, v], i) => (i ? g.lineTo(x + dx * f, vy(v)) : g.moveTo(x + dx * f, vy(v))))
      g.fill()
      g.strokeStyle = sec
      g.lineWidth = 3
      g.stroke()
    }
  }
  // Carbon-look chin guard and lower rim.
  g.fillStyle = '#1b1c1f'
  g.fillRect(0, vy(0.3), W, vy(0.18) - vy(0.3))
  g.fillStyle = 'rgba(255,255,255,0.08)'
  for (let x = 0; x < W; x += 6) g.fillRect(x, vy(0.3), 2, vy(0.18) - vy(0.3))
  // Name down both sides, number on the back.
  const label = (name || 'Driver').toUpperCase().slice(0, 14)
  g.font = '800 26px "Barlow Condensed", sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  for (const [x, rot] of [[W * 0.1, -Math.PI / 2], [W * 0.9, Math.PI / 2]] as const) {
    g.save()
    g.translate(x, vy(0.42))
    g.rotate(rot)
    g.lineWidth = 4
    g.strokeStyle = 'rgba(10,10,12,0.7)'
    g.strokeText(label, 0, 0)
    g.fillStyle = '#f5f3ee'
    g.fillText(label, 0, 0)
    g.restore()
  }
  g.font = '800 40px "Barlow Condensed", sans-serif'
  g.lineWidth = 5
  g.strokeStyle = '#f5f3ee'
  g.strokeText(num, W * 0.5, vy(0.94))
  g.fillStyle = '#16181b'
  g.fillText(num, W * 0.5, vy(0.94))
}

export function helmetTexture(h: HelmetLook, name: string, num: string): THREE.CanvasTexture {
  const [c] = canvas(512, 256)
  drawHelmet(c, h, name, num)
  return finish(c)
}

/** A loud holiday shirt in the driver's colours. Tiles seamlessly. */
export function drawShirt(c: HTMLCanvasElement, look: DriverLook): void {
  const S = c.width
  const g = c.getContext('2d')
  if (!g) return
  const base = hex(look.shirt), pr = hex(look.printColor)
  const dark = hex(mix(look.shirt, 0x0a0a0a, 0.45)), light = hex(mix(look.printColor, 0xffffff, 0.55))
  g.fillStyle = base
  g.fillRect(0, 0, S, S)
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const wrap = (draw: (x: number, y: number) => void, x: number, y: number) => {
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) draw(x + dx, y + dy)
  }
  const scatter = (n: number, draw: (x: number, y: number, a: number, s: number, i: number) => void) => {
    for (let i = 0; i < n; i++) {
      const x = rnd() * S, y = rnd() * S, a = rnd() * 6.28, s = 0.75 + rnd() * 0.6
      wrap((px, py) => draw(px, py, a, s, i), x, y)
    }
  }
  const leaf = (x: number, y: number, a: number, s: number) => {
    g.save()
    g.translate(x, y)
    g.rotate(a)
    g.fillStyle = dark
    g.beginPath()
    g.ellipse(0, 0, 34 * s, 12 * s, 0, 0, Math.PI * 2)
    g.fill()
    g.restore()
  }
  switch (look.print) {
    case 'flowers':
      scatter(24, leaf)
      scatter(22, (x, y, a, s, i) => {
        g.save()
        g.translate(x, y)
        g.rotate(a)
        g.fillStyle = [pr, '#ffffff', light][i % 3]
        for (let k = 0; k < 5; k++) {
          g.rotate((Math.PI * 2) / 5)
          g.beginPath()
          g.ellipse(0, -16 * s, 11 * s, 17 * s, 0, 0, Math.PI * 2)
          g.fill()
        }
        g.fillStyle = '#ffe14a'
        g.beginPath()
        g.arc(0, 0, 6 * s, 0, Math.PI * 2)
        g.fill()
        g.restore()
      })
      break
    case 'palms':
      scatter(10, (x, y, _a, s) => {
        g.fillStyle = light
        g.beginPath()
        g.arc(x + 30 * s, y - 50 * s, 16 * s, 0, Math.PI * 2)
        g.fill()
        g.strokeStyle = dark
        g.lineWidth = 7 * s
        g.lineCap = 'round'
        g.beginPath()
        g.moveTo(x, y + 40 * s)
        g.quadraticCurveTo(x + 10 * s, y, x + 4 * s, y - 34 * s)
        g.stroke()
        g.fillStyle = pr
        for (let k = 0; k < 6; k++) {
          g.save()
          g.translate(x + 4 * s, y - 34 * s)
          g.rotate(-Math.PI / 2 + (k - 2.5) * 0.55)
          g.beginPath()
          g.ellipse(22 * s, 0, 24 * s, 6 * s, 0.25, 0, Math.PI * 2)
          g.fill()
          g.restore()
        }
      })
      break
    case 'flames':
      for (let row = 0; row < 2; row++) {
        const y0 = (row + 1) * (S / 2)
        for (const [col, k] of [[pr, 1], [light, 0.55]] as const) {
          g.fillStyle = col
          g.beginPath()
          g.moveTo(0, y0)
          for (let i = 0; i <= 8; i++) {
            const x = (i / 8) * S, len = (60 + 70 * Math.abs(Math.sin(i * 2.1 + row))) * k
            g.quadraticCurveTo(x - S / 20, y0 - len * 0.6, x, y0 - len)
            g.quadraticCurveTo(x + S / 30, y0 - len * 0.4, x + S / 16, y0)
          }
          g.lineTo(S, y0)
          g.fill()
        }
      }
      break
    case 'pineapples':
      scatter(14, (x, y, a, s) => {
        g.save()
        g.translate(x, y)
        g.rotate(a * 0.15)
        g.fillStyle = dark
        for (let k = -2; k <= 2; k++) {
          g.beginPath()
          g.ellipse(k * 5 * s, -26 * s, 4 * s, 13 * s, k * 0.3, 0, Math.PI * 2)
          g.fill()
        }
        g.fillStyle = pr
        g.beginPath()
        g.ellipse(0, 0, 15 * s, 21 * s, 0, 0, Math.PI * 2)
        g.fill()
        g.strokeStyle = light
        g.lineWidth = 1.6 * s
        for (let k = -3; k <= 3; k++) {
          g.beginPath()
          g.moveTo(-15 * s, k * 7 * s - 8 * s)
          g.lineTo(15 * s, k * 7 * s + 8 * s)
          g.moveTo(15 * s, k * 7 * s - 8 * s)
          g.lineTo(-15 * s, k * 7 * s + 8 * s)
          g.stroke()
        }
        g.restore()
      })
      break
    case 'stripes':
      for (let x = 0; x < S; x += 64) {
        g.fillStyle = pr
        g.fillRect(x, 0, 26, S)
        g.fillStyle = light
        g.fillRect(x + 34, 0, 6, S)
      }
      break
    case 'checks':
      g.globalAlpha = 0.55
      g.fillStyle = pr
      for (let x = 0; x < S; x += 64) g.fillRect(x, 0, 32, S)
      for (let y = 0; y < S; y += 64) g.fillRect(0, y, S, 32)
      g.globalAlpha = 1
      g.fillStyle = light
      for (let x = 46; x < S; x += 64) g.fillRect(x, 0, 3, S)
      break
    case 'plain':
      break
  }
}

export function shirtTexture(look: DriverLook): THREE.CanvasTexture {
  const [c] = canvas(512, 512)
  drawShirt(c, look)
  const t = finish(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(2, 2)
  return t
}
