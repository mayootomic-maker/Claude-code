// Loads every song in songs/ through the parser and the engine, and reports
// what the file says and what it sounds like. A song that provokes a parser
// warning, renders silent, or clips is a broken song, and this is where that
// gets caught rather than on somebody's headphones.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { launch, reporter } from './browser.mjs'

const report = reporter()
const songsDir = new URL('../songs', import.meta.url).pathname
const files = readdirSync(songsDir).filter((name) => name.endsWith('.song.json')).sort()

if (files.length === 0) {
  console.log('No songs to check.')
  process.exit(0)
}

const server = await createServer({ server: { port: 5195, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await launch()
const page = await browser.newPage()
const consoleErrors = []
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', (error) => consoleErrors.push(String(error)))

try {
  await page.goto('http://localhost:5195/e2e/harness.html')
  await page.waitForSelector('body[data-ready="true"]', { timeout: 60000 })

  for (const file of files) {
    const source = readFileSync(join(songsDir, file), 'utf8')
    report.section(file)

    const result = await page.evaluate(async (text) => {
      const parsed = window.harness.parseSongText(text)
      if (!parsed.value) return { issues: parsed.issues }
      const song = parsed.value
      const timeline = window.harness.buildTimeline(song)
      const buffer = await window.harness.renderSong(song)
      const stats = window.harness.analyseRender(buffer)

      // Loudness over time, one reading per section, so a section that ends up
      // silent by accident shows itself.
      const data = buffer.getChannelData(0)
      const rate = buffer.sampleRate
      const secondsPerBeat = 60 / song.tempo
      const sections = timeline.sections.map((section) => {
        const from = Math.floor(section.startBeat * secondsPerBeat * rate)
        const to = Math.min(data.length, Math.floor((section.startBeat + section.beats) * secondsPerBeat * rate))
        let sum = 0
        let peak = 0
        for (let index = from; index < to; index++) {
          sum += data[index] * data[index]
          peak = Math.max(peak, Math.abs(data[index]))
        }
        const count = Math.max(1, to - from)
        return { name: section.name, bars: section.bars, rms: Math.sqrt(sum / count), peak }
      })

      const rewritten = window.harness.serialiseSong(song)
      const reparsed = window.harness.parseSongText(rewritten)
      const stable = reparsed.value ? window.harness.serialiseSong(reparsed.value) === rewritten : false

      return {
        issues: parsed.issues,
        title: song.title,
        tempo: song.tempo,
        tracks: song.tracks.length,
        patterns: song.patterns.length,
        notes: timeline.notes.length,
        bars: timeline.totalBars,
        stats,
        sections,
        stable,
        rewrittenIssues: reparsed.issues ?? [],
      }
    }, source)

    if (!result.title) {
      report.check('the file parses', false, JSON.stringify(result.issues))
      continue
    }

    const minutes = Math.floor(result.stats.seconds / 60)
    const seconds = Math.round(result.stats.seconds % 60)
    console.log(
      `  "${result.title}" -- ${result.tempo}bpm, ${result.bars} bars, ${result.tracks} tracks, ` +
        `${result.patterns} patterns, ${result.notes} notes, ${minutes}:${String(seconds).padStart(2, '0')}`,
    )

    report.check('no parser issues', result.issues.length === 0, result.issues.map((issue) => `${issue.where}: ${issue.message}`).join(' | '))
    report.check('it makes sound', result.stats.rms > 0.02, `rms ${result.stats.rms.toFixed(4)}`)
    report.check('it does not clip', result.stats.clippedFrames === 0, `${result.stats.clippedFrames} clipped frames`)
    report.check('it is loud enough to be a master', result.stats.peak > 0.5, `peak ${result.stats.peak.toFixed(3)}`)
    report.check('re-saving it is a no-op', result.stable && result.rewrittenIssues.length === 0)

    const quiet = result.sections.filter((section) => section.rms < 0.005)
    report.check('no section is accidentally silent', quiet.length === 0, quiet.map((section) => section.name).join(', '))

    for (const section of result.sections) {
      const db = 20 * Math.log10(Math.max(section.rms, 1e-6))
      console.log(
        `     ${section.name.padEnd(10)} ${String(section.bars).padStart(3)} bars   ` +
          `${db.toFixed(1).padStart(6)} dB rms   peak ${section.peak.toFixed(3)}`,
      )
    }
  }

  report.section('Nothing threw')
  report.check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '))
} finally {
  await browser.close()
  await server.close()
}

process.exit(report.finish() > 0 ? 1 : 0)
