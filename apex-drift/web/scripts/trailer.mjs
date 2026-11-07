// Renders the gameplay trailer: trailer/apex-drift-trailer.mp4.
//
//   npm run trailer                       full render, 1280x720 (software GL is slow), all shots
//   npm run trailer -- --width=1920       full HD, roughly twice the render time
//   npm run trailer -- --width=960        quick low-resolution pass
//   npm run trailer -- --only=4,grid-drone  re-render just these shots (index or name)
//   npm run trailer -- --resume           keep shots already rendered with the same plan
//   npm run trailer -- --jobs=2           render shots in two browsers at once
//   npm run trailer -- --width=640 --only=0,1,5 --cut
//                                         a short test edit of just those shots (sound included)
//
// Pipeline: a Vite dev server serves trailer.html; headless Chromium (software
// GL) simulates the runs, plans the shots from their telemetry and renders each
// frame on request at exactly 1/30 s of game time, however long it takes. Each
// shot's JPEG frames are piped into its own ffmpeg encode, with the telemetry
// saved beside it. The sound is then rendered offline from that telemetry
// (src/trailer/audio-main.ts), and ffmpeg joins the shots with the planned
// transitions, letterboxes them and muxes the mastered mix.
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const web = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(web, 'trailer')
const work = join(outDir, 'work')
const arg = (name, def) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  return a ? a.slice(name.length + 3) : process.argv.includes(`--${name}`) ? true : def
}
const W = Number(arg('width', 1280)) & ~1
const H_FULL = Math.round((W * 9) / 16) & ~1
// Rendered at 2.39:1 and letterboxed: the bars cost nothing to draw.
const H = Math.round(W / 2.39) & ~1
const FPS = 30
const JOBS = Math.max(1, Number(arg('jobs', 1)))
const RESUME = !!arg('resume', false)
const ONLY = arg('only', '') ? String(arg('only')).split(',') : null
const NO_AUDIO = !!arg('no-audio', false)
const CUT = !!arg('cut', false)
const started = Date.now()
const secs = () => ((Date.now() - started) / 1000).toFixed(0)
const say = (s) => console.log(`[${secs().padStart(5)} s] ${s}`)

mkdirSync(work, { recursive: true })

const server = await createServer({ root: web, logLevel: 'warn', server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } })
await server.listen()
const port = server.httpServer.address().port
say(`dev server on ${port}, rendering ${W}x${H} letterboxed to ${W}x${H_FULL}, ${JOBS} job(s)`)

async function openPage() {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-watchdog', '--js-flags=--max-old-space-size=6144'] })
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  page.setDefaultTimeout(0)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
    else if (m.text().startsWith('[trailer]') && JOBS === 1) console.log('   ', m.text().slice(10))
  })
  await page.goto(`http://127.0.0.1:${port}/trailer.html`, { timeout: 0 })
  await page.waitForFunction(() => !!window.__trailer, null, { timeout: 0 })
  return { browser, page, errors }
}

function shotKey(s) {
  return createHash('sha1').update(JSON.stringify([s.name, s.run, s.t0, s.dur, W, H])).digest('hex').slice(0, 12)
}

const pad = (i) => String(i).padStart(2, '0')

async function renderShot(page, plan, i) {
  const s = plan.shots[i]
  const file = join(work, `shot-${pad(i)}.mp4`)
  const keyFile = join(work, `shot-${pad(i)}.key`)
  const key = shotKey(s)
  if (RESUME && existsSync(keyFile) && readFileSync(keyFile, 'utf8') === key && existsSync(file)) return say(`shot ${pad(i)} ${s.name}: kept`)
  const t0 = Date.now()
  await page.evaluate((n) => window.__trailer.prepare(n), i)
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '10', '-pix_fmt', 'yuv420p', '-r', String(FPS), file], { stdio: ['pipe', 'inherit', 'inherit'] })
  const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c} on shot ${i}`)))))
  const prep = Date.now()
  for (let f = 0; f < s.frames; f++) {
    const url = await page.evaluate((n) => window.__trailer.frame(n), f)
    const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
    if (!ff.stdin.write(buf)) await new Promise((res) => ff.stdin.once('drain', res))
  }
  ff.stdin.end()
  await done
  const tel = await page.evaluate((n) => window.__trailer.telemetry(n), i)
  writeFileSync(join(work, `shot-${pad(i)}.json`), JSON.stringify(tel))
  writeFileSync(keyFile, key)
  const per = (Date.now() - prep) / s.frames / 1000
  say(`shot ${pad(i)} ${s.name}: ${s.frames} frames, prepare ${((prep - t0) / 1000).toFixed(0)} s, ${per.toFixed(2)} s/frame`)
}

// ---- plan ------------------------------------------------------------------
const pages = await Promise.all(Array.from({ length: JOBS }, () => openPage()))
say('planning: simulating the hero runs and finding the moments')
const plans = await Promise.all(pages.map(({ page }) => page.evaluate(() => window.__trailer.plan())))
const plan = plans[0]
for (const l of plan.log) console.log('   ', l)
if (plans.some((p) => JSON.stringify(p.shots) !== JSON.stringify(plan.shots))) throw new Error('plans differ between browsers: the simulation is not deterministic')
let t = 0
plan.shots.forEach((s, i) => {
  s.idx = i
  s.at = t
  t += s.dur - s.out.dur
})
plan.length = t
plan.width = W
plan.height = H_FULL
plan.fps = FPS
writeFileSync(join(work, 'plan.json'), JSON.stringify(plan, null, 1))
say(`plan: ${plan.shots.length} shots, ${plan.shots.reduce((n, s) => n + s.frames, 0)} frames, ${t.toFixed(1)} s on the timeline`)
plan.shots.forEach((s, i) => console.log(`    ${pad(i)} ${s.at.toFixed(2).padStart(6)}  ${s.name.padEnd(16)} ${s.dur.toFixed(2)} s  ${s.out.type} ${s.out.dur.toFixed(2)}  ${s.note}`))

// ---- render ----------------------------------------------------------------
const want = plan.shots.map((s, i) => i).filter((i) => !ONLY || ONLY.includes(String(i)) || ONLY.includes(plan.shots[i].name))
// Keep each stage's shots in one browser, so each stage is built once per job; balance by frame count.
const groups = []
for (const i of want) {
  const g = groups.find((x) => x.run === plan.shots[i].run)
  if (g) g.shots.push(i)
  else groups.push({ run: plan.shots[i].run, shots: [i] })
}
const queues = pages.map(() => ({ frames: 0, shots: [] }))
for (const g of [...groups].sort((a, b) => b.shots.length - a.shots.length)) {
  const q = queues.reduce((a, b) => (a.frames <= b.frames ? a : b))
  q.shots.push(...g.shots)
  q.frames += g.shots.reduce((n, i) => n + plan.shots[i].frames, 0)
}
const renderStart = Date.now()
await Promise.all(pages.map(async ({ page }, j) => {
  for (const i of queues[j].shots.sort((a, b) => a - b)) await renderShot(page, plan, i)
}))
const renderSecs = (Date.now() - renderStart) / 1000
for (const { browser, errors } of pages) {
  await browser.close()
  if (errors.length) console.log('page errors:\n  ' + errors.slice(0, 10).join('\n  '))
}
await server.close()
// A test cut joins only the shots asked for; otherwise every shot must be there.
const edit = CUT && ONLY ? { ...plan, shots: plan.shots.filter((s, i) => want.includes(i)).map((s) => ({ ...s })) } : plan
if (edit !== plan) {
  let at = 0
  edit.shots.forEach((s, i) => {
    s.at = at
    if (i === edit.shots.length - 1) s.out = { type: 'fade', dur: 0 }
    at += s.dur - s.out.dur
  })
  edit.length = at
}
writeFileSync(join(work, 'edit.json'), JSON.stringify(edit, null, 1))
const missing = edit.shots.filter((s) => !existsSync(join(work, `shot-${pad(s.idx)}.mp4`))).map((s) => s.idx)
if (missing.length) {
  say(`shots not rendered yet: ${missing.join(', ')}; run without --only to finish`)
  process.exit(0)
}

// ---- sound -----------------------------------------------------------------
const mix = join(work, 'mix.wav')
if (!NO_AUDIO) {
  say('rendering the sound from telemetry')
  const r = spawnSync(join(web, 'node_modules/.bin/vite-node'), ['src/trailer/audio-main.ts', work, 'edit.json'], { cwd: web, stdio: 'inherit' })
  if (r.status !== 0) throw new Error('audio render failed')
}

// ---- edit ------------------------------------------------------------------
say('joining shots')
const inputs = edit.shots.flatMap((s) => ['-i', join(work, `shot-${pad(s.idx)}.mp4`)])
const parts = edit.shots.map((s, i) => `[${i}:v]settb=AVTB,fps=${FPS},setpts=PTS-STARTPTS,format=yuv420p[s${i}]`)
let last = 's0'
for (let i = 1; i < edit.shots.length; i++) {
  const tr = edit.shots[i - 1].out
  parts.push(`[${last}][s${i}]xfade=transition=${tr.type}:duration=${Math.max(1 / FPS, tr.dur).toFixed(4)}:offset=${edit.shots[i].at.toFixed(4)}[x${i}]`)
  last = `x${i}`
}
const len = edit.length
parts.push(`[${last}]pad=${W}:${H_FULL}:0:(oh-ih)/2:black,fade=t=in:st=0:d=0.7,fade=t=out:st=${(len - 1.4).toFixed(3)}:d=1.4,trim=duration=${len.toFixed(3)}[v]`)
const final = join(outDir, edit === plan ? 'apex-drift-trailer.mp4' : 'apex-drift-trailer-test.mp4')
const audioIn = NO_AUDIO ? [] : ['-i', join(work, 'master.wav')]
const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, ...audioIn, '-filter_complex', parts.join(';'), '-map', '[v]',
  ...(NO_AUDIO ? [] : ['-map', `${edit.shots.length}:a`, '-c:a', 'aac', '-b:a', '256k', '-ar', '48000']),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-tune', 'film', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', '-shortest', final], { stdio: 'inherit' })
if (ff.status !== 0) throw new Error('final encode failed')

// ---- checks ----------------------------------------------------------------
const stills = join(outDir, 'stills')
rmSync(stills, { recursive: true, force: true })
mkdirSync(stills, { recursive: true })
for (let i = 0; i < 12; i++) {
  const at = (len * (i + 0.5)) / 12
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', at.toFixed(2), '-i', final, '-frames:v', '1', '-q:v', '3', join(stills, `still-${pad(i)}-${at.toFixed(1)}s.jpg`)])
}
const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,r_frame_rate:format=duration', '-of', 'compact', final], { encoding: 'utf8' })
console.log(probe.stdout.trim())
let loud = ''
if (!NO_AUDIO) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', final, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' })
  loud = r.stderr.slice(r.stderr.lastIndexOf('Summary:')).trim()
  console.log(loud)
}
// A plain-text record of what was made: the hero's runs, the shots, timings and loudness.
const fmt = (x) => (x === null ? '-' : x.toFixed(2))
const report = [
  `Apex Drift trailer - ${final}`,
  `${W}x${H_FULL} (picture ${W}x${H}, 2.39:1), ${FPS} fps, ${len.toFixed(1)} s; render ${(renderSecs / 60).toFixed(1)} min, total ${(Number(secs()) / 60).toFixed(1)} min`,
  '',
  'Hero runs (fastest clean run found; Pro AI = the race AI at its own limit, same car, same distance):',
  ...plan.reports.map((r) => `  ${r.stage.padEnd(34)} ${r.style.padEnd(5)} ${String(r.metres).padStart(5)} m  hero ${fmt(r.heroTime)} s  pro ${fmt(r.proTime)} s  ideal ${fmt(r.idealTime)} s${r.race ? `  place ${r.place}` : ''}  ${r.clean ? 'clean' : 'NOT CLEAN'}`),
  '',
  'Shots:',
  ...edit.shots.map((s) => `  ${s.at.toFixed(2).padStart(6)} s  ${s.name.padEnd(16)} ${s.dur.toFixed(2)} s  -> ${s.out.type} ${s.out.dur.toFixed(2)}  ${s.note}`),
  '',
  loud,
  existsSync(join(work, 'audio-report.json')) ? `audio checks: ${readFileSync(join(work, 'audio-report.json'), 'utf8')}` : '',
].join('\n')
writeFileSync(join(outDir, edit === plan ? 'report.txt' : 'report-test.txt'), report + '\n')
say(`done: ${final} (render ${(renderSecs / 60).toFixed(1)} min of ${secs()} s total)`)
