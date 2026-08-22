/**
 * Generates the app icons.
 *
 * Hand-rolled because there is no rasteriser available and the icon is the
 * app's entire presence on a home screen — a flat colour block would be the
 * placeholder this project's rules forbid.
 *
 * The mark: a countdown ring with a gap, and a chevron pointing right. Time
 * running down, and go. It has to survive being 48px on a home screen, so
 * there is no fine detail and the contrast is high.
 */

import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

/** Supersampling factor. 4x is indistinguishable from proper AA at these sizes. */
const SS = 4

const BG = [11, 15, 20]
const RING = [122, 162, 247]
const MARK = [244, 246, 250]

function encodePng(size, pixels) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }

  const table = [...Array(256).keys()].map((n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf) => {
    let c = 0xffffffff
    for (const byte of buf) c = table[(c ^ byte) & 255] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * @param size output pixels
 * @param scale how much of the canvas the mark occupies; maskable icons need
 *   the mark inside the safe zone or launchers crop into it.
 */
function render(size, scale) {
  const n = size * SS
  const c = n / 2
  const px = Buffer.alloc(size * size * 4)

  const ringOuter = n * 0.44 * scale
  const ringInner = n * 0.36 * scale
  // Gap in the upper right: an unbroken ring reads as a logo, a broken one
  // reads as time already elapsed.
  const gapFrom = -Math.PI * 0.34
  const gapTo = -Math.PI * 0.02

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px4 = x * SS + sx + 0.5
          const py4 = y * SS + sy + 0.5
          const dx = px4 - c
          const dy = py4 - c
          const dist = Math.hypot(dx, dy)
          const angle = Math.atan2(dy, dx)

          let colour = BG

          const inGap = angle > gapFrom && angle < gapTo
          if (dist <= ringOuter && dist >= ringInner && !inGap) colour = RING

          // Chevron: one thick angled bar mirrored about the horizontal axis,
          // meeting at a tip. Offsets are relative to the centre, like dx/dy —
          // mixing an absolute x in here put the mark outside the ring.
          const w = n * 0.06 * scale
          const armLength = n * 0.17 * scale
          const tipDx = n * 0.05 * scale
          const ady = Math.abs(dy)
          if (ady <= armLength && Math.abs(dx - (tipDx - ady)) <= w) colour = MARK

          r += colour[0]
          g += colour[1]
          b += colour[2]
        }
      }

      const total = SS * SS
      const i = (y * size + x) * 4
      px[i] = Math.round(r / total)
      px[i + 1] = Math.round(g / total)
      px[i + 2] = Math.round(b / total)
      px[i + 3] = 255
    }
  }

  return encodePng(size, px)
}

const out = new URL('../public/', import.meta.url).pathname
writeFileSync(`${out}icon-192.png`, render(192, 1))
writeFileSync(`${out}icon-512.png`, render(512, 1))
// Maskable: launchers crop to a circle or squircle, so the mark shrinks into
// the 80% safe zone.
writeFileSync(`${out}icon-maskable-512.png`, render(512, 0.78))

// The favicon is the same mark, as vector, for browser tabs.
writeFileSync(
  `${out}favicon.svg`,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0b0f14"/>
  <path d="M32 6.5a25.5 25.5 0 1 1-18.2 7.6" fill="none" stroke="#7aa2f7" stroke-width="5.6" stroke-linecap="round" transform="rotate(35 32 32)"/>
  <path d="M27 22l10 10-10 10" fill="none" stroke="#f4f6fa" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,
)

console.log('icons written to public/')
