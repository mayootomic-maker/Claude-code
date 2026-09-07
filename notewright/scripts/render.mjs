#!/usr/bin/env node
// Renders a song to a WAV file without opening the app.
//
// There is no Web Audio outside a browser, so this drives a headless one — the
// same engine, the same graph, the same scheduler as playback. That is the
// point: a command-line render that used a different code path would be a
// second engine to keep in sync, and the first thing to drift.
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { createServer } from 'vite'
import { launch } from '../e2e/browser.mjs'

const args = process.argv.slice(2)
if (args.length === 0 || args.includes('--help')) {
  console.log('Usage: npm run render -- <song> [--bits 16|24] [--out file.wav] [--from bar] [--to bar]')
  console.log('  <song> is a name in songs/, or a path to a .song.json file.')
  console.log('  --from and --to are bar numbers, counting from 1, for bouncing a section.')
  process.exit(args.length === 0 ? 1 : 0)
}

const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : fallback
}

const target = args[0]
const inputPath = target.endsWith('.json')
  ? resolve(target)
  : new URL(`../songs/${target}.song.json`, import.meta.url).pathname
const bits = Number(flag('bits', '16'))
if (bits !== 16 && bits !== 24) {
  console.error(`--bits must be 16 or 24, not ${bits}`)
  process.exit(1)
}
const fromBar = flag('from') === undefined ? null : Number(flag('from'))
const toBar = flag('to') === undefined ? null : Number(flag('to'))
if ((fromBar !== null && !Number.isFinite(fromBar)) || (toBar !== null && !Number.isFinite(toBar))) {
  console.error('--from and --to take bar numbers')
  process.exit(1)
}

const outputPath = resolve(flag('out', `${basename(inputPath).replace(/\.song\.json$|\.json$/, '')}.wav`))

let source
try {
  source = readFileSync(inputPath, 'utf8')
} catch (error) {
  console.error(`Could not read ${inputPath}: ${error.message}`)
  process.exit(1)
}

const server = await createServer({ server: { port: 5188, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await launch()
const page = await browser.newPage()

try {
  await page.goto('http://localhost:5188/e2e/harness.html')
  await page.waitForSelector('body[data-ready="true"]', { timeout: 60000 })

  const started = Date.now()
  const result = await page.evaluate(
    async ([text, bitDepth, from, to]) => {
      const parsed = window.harness.parseSongText(text)
      if (!parsed.value) return { issues: parsed.issues }
      const timeline = window.harness.buildTimeline(parsed.value)
      const range = {}
      if (from !== null) range.fromBeat = (from - 1) * timeline.beatsInBar
      if (to !== null) range.toBeat = to * timeline.beatsInBar
      const buffer = await window.harness.renderSong(parsed.value, range)
      const stats = window.harness.analyseRender(buffer)
      const blob = window.harness.encodeWav(buffer, bitDepth)
      const bytes = new Uint8Array(await blob.arrayBuffer())
      return {
        issues: parsed.issues,
        title: parsed.value.title,
        stats,
        // Base64 rather than the raw array: a few million numbers through the
        // CDP bridge is minutes of JSON, and this is seconds.
        data: btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')),
      }
    },
    [source, bits, fromBar, toBar],
  )

  if (!result.data) {
    for (const issue of result.issues) console.error(`${issue.severity}: ${issue.where ?? ''} ${issue.message}`)
    process.exit(1)
  }

  for (const issue of result.issues) {
    console.warn(`${issue.severity}: ${issue.where ? `${issue.where}: ` : ''}${issue.message}`)
  }

  writeFileSync(outputPath, Buffer.from(result.data, 'base64'))
  const peakDb = 20 * Math.log10(Math.max(result.stats.peak, 1e-6))
  const minutes = Math.floor(result.stats.seconds / 60)
  console.log(
    `"${result.title}" -> ${outputPath}\n` +
      `  ${minutes}:${String(Math.round(result.stats.seconds % 60)).padStart(2, '0')} · ` +
      `${bits}-bit · peak ${peakDb.toFixed(1)} dBFS · ` +
      `${result.stats.clippedFrames} clipped frames · rendered in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  )
} finally {
  await browser.close()
  await server.close()
}
