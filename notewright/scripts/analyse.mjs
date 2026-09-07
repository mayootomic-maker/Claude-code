#!/usr/bin/env node
// Measures a reference track so you can build in the same pocket.
//
// Producers work to references. The useful questions are always the same four —
// how fast, what key, where is the weight, and what is the drum pattern — and
// all four are measurable rather than matters of opinion. Decoding happens in a
// headless browser because that is the only MP3/M4A decoder available here, and
// it is the same one the app itself uses.
import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { createServer } from 'vite'
import { launch } from '../e2e/browser.mjs'

const args = process.argv.slice(2)
if (args.length === 0 || args.includes('--help')) {
  console.log('Usage: npm run analyse -- <audio file>')
  console.log('  Reads anything the browser can decode: mp3, wav, m4a, ogg, flac.')
  process.exit(args.length === 0 ? 1 : 0)
}

const path = resolve(args[0])
let bytes
try {
  bytes = readFileSync(path)
} catch (error) {
  console.error(`Could not read ${path}: ${error.message}`)
  process.exit(1)
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const server = await createServer({ server: { port: 5184, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await launch()
const page = await browser.newPage()

try {
  await page.goto('http://localhost:5184/e2e/harness.html')
  await page.waitForSelector('body[data-ready="true"]', { timeout: 60000 })

  const report = await page.evaluate(async (base64) => {
    const binary = atob(base64)
    const raw = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) raw[i] = binary.charCodeAt(i)
    const buffer = await new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: 44100 })
      .decodeAudioData(raw.buffer)

    const rate = buffer.sampleRate
    const left = buffer.getChannelData(0)
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left
    const n = buffer.length
    const mono = new Float32Array(n)
    for (let i = 0; i < n; i++) mono[i] = (left[i] + right[i]) / 2

    const fft = (re, im) => {
      const size = re.length
      for (let i = 1, j = 0; i < size; i++) {
        let bit = size >> 1
        for (; j & bit; bit >>= 1) j ^= bit
        j ^= bit
        if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti }
      }
      for (let len = 2; len <= size; len <<= 1) {
        const ang = (-2 * Math.PI) / len
        const wr = Math.cos(ang), wi = Math.sin(ang)
        for (let i = 0; i < size; i += len) {
          let cr = 1, ci = 0
          for (let k = 0; k < len / 2; k++) {
            const ur = re[i + k], ui = im[i + k]
            const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
            const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
            re[i + k] = ur + vr; im[i + k] = ui + vi
            re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi
            const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr
          }
        }
      }
    }

    const N = 1024, HOP = 256
    const frames = Math.floor((n - N) / HOP)
    const win = new Float32Array(N)
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))

    const BANDS = [[20, 60], [60, 150], [150, 400], [400, 2000], [2000, 6000], [6000, 20000]]
    const DRUM_BANDS = [[30, 130], [150, 900], [1000, 4000], [5000, 14000]]
    const flux = DRUM_BANDS.map(() => new Float32Array(frames))
    const bandEnergy = BANDS.map(() => 0)
    const chroma = new Float64Array(12)
    const subPitch = new Map()
    let previous = null

    for (let f = 0; f < frames; f++) {
      const re = new Float32Array(N), im = new Float32Array(N)
      for (let i = 0; i < N; i++) re[i] = mono[f * HOP + i] * win[i]
      fft(re, im)
      const mag = new Float32Array(N / 2)
      for (let k = 0; k < N / 2; k++) mag[k] = Math.hypot(re[k], im[k])

      for (let k = 1; k < N / 2; k++) {
        const freq = (k * rate) / N
        const power = mag[k] * mag[k]
        for (let b = 0; b < BANDS.length; b++) {
          if (freq >= BANDS[b][0] && freq < BANDS[b][1]) { bandEnergy[b] += power; break }
        }
        if (freq >= 55 && freq <= 2000) {
          const midi = Math.round(69 + 12 * Math.log2(freq / 440))
          chroma[((midi % 12) + 12) % 12] += power
        }
      }

      let bestSub = 0, bestK = 0
      for (let k = 1; k < N / 2; k++) {
        const freq = (k * rate) / N
        if (freq < 28 || freq > 140) continue
        if (mag[k] > bestSub) { bestSub = mag[k]; bestK = k }
      }
      if (bestK > 0 && bestSub > 0.4) {
        const midi = Math.round(69 + 12 * Math.log2(((bestK * rate) / N) / 440))
        const pc = ((midi % 12) + 12) % 12
        subPitch.set(pc, (subPitch.get(pc) ?? 0) + bestSub)
      }

      for (let b = 0; b < DRUM_BANDS.length; b++) {
        let rise = 0
        const kLo = Math.max(1, Math.floor((DRUM_BANDS[b][0] * N) / rate))
        const kHi = Math.min(N / 2 - 1, Math.ceil((DRUM_BANDS[b][1] * N) / rate))
        for (let k = kLo; k <= kHi; k++) {
          if (previous) { const d = mag[k] - previous[k]; if (d > 0) rise += d }
        }
        flux[b][f] = rise
      }
      previous = mag
    }

    const combined = new Float32Array(frames)
    for (let b = 0; b < DRUM_BANDS.length; b++) {
      let peak = 0
      for (let f = 0; f < frames; f++) peak = Math.max(peak, flux[b][f])
      if (peak > 0) for (let f = 0; f < frames; f++) { flux[b][f] /= peak; combined[f] += flux[b][f] }
    }
    let mean = 0
    for (let f = 0; f < frames; f++) mean += combined[f]
    mean /= frames
    for (let f = 0; f < frames; f++) combined[f] -= mean

    const fps = rate / HOP
    let best = { bpm: 120, score: -Infinity }
    const curve = []
    for (let bpm = 60; bpm <= 200; bpm += 0.1) {
      const lag = (60 / bpm) * fps
      let score = 0
      for (const mult of [1, 0.5, 2]) {
        const l = Math.round(lag * mult)
        if (l < 4 || l >= frames / 2) continue
        let sum = 0, count = 0
        for (let f = 0; f + l < frames; f++) { sum += combined[f] * combined[f + l]; count++ }
        score += (sum / count) * (mult === 1 ? 1 : 0.5)
      }
      curve.push({ bpm, score })
      if (score > best.score) best = { bpm, score }
    }
    curve.sort((a, b) => b.score - a.score)

    const beatFrames = (60 / best.bpm) * fps
    let phase = 0, phaseScore = -Infinity
    for (let p = 0; p < Math.round(beatFrames); p++) {
      let sum = 0
      for (let f = p; f < frames; f += beatFrames) sum += combined[Math.round(f)] || 0
      if (sum > phaseScore) { phaseScore = sum; phase = p }
    }

    const sixteenth = beatFrames / 4
    const bar = DRUM_BANDS.map(() => new Float64Array(16))
    const hits = new Float64Array(16)
    for (let step = 0; ; step++) {
      const f = Math.round(phase + step * sixteenth)
      if (f >= frames - 3) break
      const cell = step % 16
      hits[cell]++
      for (let b = 0; b < DRUM_BANDS.length; b++) {
        let peak = 0
        for (let d = -2; d <= 2; d++) peak = Math.max(peak, flux[b][f + d] || 0)
        bar[b][cell] += peak
      }
    }
    for (let b = 0; b < DRUM_BANDS.length; b++) for (let c = 0; c < 16; c++) bar[b][c] /= hits[c] || 1

    const chromaTotal = chroma.reduce((a, b) => a + b, 0) || 1
    const normalised = Array.from(chroma, (v) => v / chromaTotal)
    const major = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
    const minor = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
    const keys = []
    for (let root = 0; root < 12; root++) {
      for (const [name, profile] of [['major', major], ['minor', minor]]) {
        let sum = 0
        for (let i = 0; i < 12; i++) sum += normalised[(i + root) % 12] * profile[i]
        keys.push({ root, scale: name, score: sum })
      }
    }
    keys.sort((a, b) => b.score - a.score)

    let peak = 0, energy = 0, side = 0
    for (let i = 0; i < n; i++) {
      peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]))
      energy += mono[i] * mono[i]
      side += ((left[i] - right[i]) / 2) ** 2
    }
    const bandTotal = bandEnergy.reduce((a, b) => a + b, 0) || 1

    return {
      seconds: buffer.duration,
      channels: buffer.numberOfChannels,
      rate,
      peak,
      rms: Math.sqrt(energy / n),
      width: Math.sqrt(side / Math.max(energy, 1e-12)),
      tempo: curve.slice(0, 4),
      keys: keys.slice(0, 3),
      bands: BANDS.map((range, i) => ({ lo: range[0], hi: range[1], share: bandEnergy[i] / bandTotal })),
      sub: [...subPitch.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([pc, weight]) => ({ pc, weight })),
      drums: DRUM_BANDS.map((range, i) => ({ range, cells: Array.from(bar[i]) })),
    }
  }, bytes.toString('base64'))

  const db = (value) => (20 * Math.log10(Math.max(value, 1e-6))).toFixed(1)
  const minutes = Math.floor(report.seconds / 60)
  console.log(`\n${basename(path)}`)
  console.log(
    `  ${minutes}:${String(Math.round(report.seconds % 60)).padStart(2, '0')} · ` +
      `${report.channels === 2 ? 'stereo' : 'mono'} ${report.rate} Hz · ` +
      `peak ${db(report.peak)} dBFS · rms ${db(report.rms)} dBFS · ` +
      `crest ${(20 * Math.log10(report.peak / report.rms)).toFixed(1)} dB · width ${report.width.toFixed(2)}`,
  )

  console.log(`\nTempo   ${report.tempo[0].bpm.toFixed(1)} bpm`)
  console.log(`        also plausible: ${report.tempo.slice(1).map((t) => t.bpm.toFixed(1)).join(', ')}`)
  console.log(`        half-time feel: ${(report.tempo[0].bpm / 2).toFixed(1)}`)

  console.log(`\nKey     ${NAMES[report.keys[0].root]} ${report.keys[0].scale}`)
  console.log(`        then: ${report.keys.slice(1).map((k) => `${NAMES[k.root]} ${k.scale}`).join(', ')}`)
  if (report.sub.length > 0) {
    console.log(`        the bass sits on: ${report.sub.map((s) => NAMES[s.pc]).join(', ')}`)
  }

  console.log('\nWhere the energy sits')
  const low = report.bands[0].share + report.bands[1].share
  for (const band of report.bands) {
    console.log(
      `  ${String(band.lo).padStart(5)}-${String(band.hi).padEnd(5)} Hz ` +
        `${(band.share * 100).toFixed(1).padStart(5)}%  ${'#'.repeat(Math.round(band.share * 60))}`,
    )
  }
  console.log(`  below 150 Hz: ${(low * 100).toFixed(1)}%${low > 0.5 ? '  — an 808 record' : ''}`)

  console.log('\nWhere the hits land, averaged over every bar')
  const labels = ['kick + 808 ', 'body/snare ', 'snare/clap ', 'hats       ']
  console.log('              ' + Array.from({ length: 16 }, (_, i) => String(i + 1).padStart(4)).join(''))
  report.drums.forEach((row, index) => {
    const top = Math.max(...row.cells) || 1
    console.log(
      labels[index] + '   ' +
        row.cells.map((v) => (v / top > 0.8 ? '   X' : v / top > 0.55 ? '   x' : v / top > 0.35 ? '   o' : '   .')).join(''),
    )
  })
  console.log('\n  X strongest · x strong · o present · . quiet')
  console.log(
    `\nTo build in this pocket: tempo ${Math.round(report.tempo[0].bpm)}, ` +
      `key ${NAMES[report.keys[0].root]} ${report.keys[0].scale}, ` +
      `and keep ${(low * 100).toFixed(0)}% of the energy under 150 Hz.\n`,
  )
} finally {
  await browser.close()
  await server.close()
}
