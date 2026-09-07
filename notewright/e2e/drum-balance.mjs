import { createServer } from 'vite'
import { launch } from './browser.mjs'

const server = await createServer({ server: { port: 5197, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await launch()
const page = await browser.newPage()
await page.goto('http://localhost:5197/e2e/harness.html')
await page.waitForSelector('body[data-ready="true"]', { timeout: 60000 })

const lanes = ['kick', 'snare', 'clap', 'hat', 'open', 'rim', 'tom', 'ride']
const limiter = process.argv.includes('--limiter')
const rows = []
for (const lane of lanes) {
  const stats = await page.evaluate(async ([laneId, useLimiter]) => {
    const doc = {
      format: 'notewright/1', title: 'B', tempo: 120, timeSignature: '4/4',
      master: { limiter: useLimiter, gain: useLimiter ? -1 : 0 },
      tracks: [{ id: 'd', name: 'D', gain: 0, instrument: { type: 'drums' } }],
      patterns: [{ id: 'p', track: 'd', bars: 1, grid: '1/16', lanes: { [laneId]: 'X... .... .... ....' } }],
      sections: [{ id: 'a', name: 'A', bars: 1, clips: ['p'] }],
    }
    const parsed = window.harness.parseSong(doc)
    const buffer = await window.harness.renderSong(parsed.value, { tailSeconds: 0.2 })
    const left = buffer.getChannelData(0)
    const right = buffer.getChannelData(1)
    let peak = 0, sum = 0
    const span = Math.min(left.length, Math.floor(buffer.sampleRate * 1.2))
    for (let i = 0; i < span; i++) {
      const v = (left[i] + right[i]) / 2
      peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]))
      sum += v * v
    }
    return { peak, rms: Math.sqrt(sum / span) }
  }, [lane, limiter])
  rows.push([lane, stats.peak, stats.rms])
}

console.log(limiter ? 'master limiter ON, gain -1dB' : 'master limiter off, gain 0dB')
const loudest = Math.max(...rows.map((r) => r[1]))
for (const [lane, peak, rms] of rows) {
  const db = 20 * Math.log10(peak / loudest)
  console.log(lane.padEnd(7), 'peak', peak.toFixed(4).padStart(7), 'rms', rms.toFixed(5).padStart(8), 'rel', db.toFixed(1).padStart(6), 'dB')
}

await browser.close()
await server.close()
