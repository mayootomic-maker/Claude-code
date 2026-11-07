// Rebuilds the shipped co-driver voice (public/voice) from the original
// recordings in voice-src/: every word is trimmed of dead air, slowed with
// ffmpeg's atempo (pitch unchanged), given short raised-cosine fades so a clip
// can start and stop anywhere without a click, and laid out with silence
// between words. It always reads voice-src/, never its own output, so running
// it twice gives the same files rather than stretching them twice.
//
//   node scripts/voice.mjs            (needs ffmpeg with libmp3lame on PATH)
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const TEMPO = 0.82
/** Silence between clips in the file; the game adds its own gaps between words. */
const PAD = 0.12
const FADE = 0.006
/** Anything quieter than this, relative to the clip's peak, is dead air. */
const FLOOR_DB = -38
const MARGIN = 0.02

const root = new URL('..', import.meta.url).pathname
const src = (f) => `${root}voice-src/${f}`
const dst = (f) => `${root}public/voice/${f}`

function ffmpeg(args, input) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { input, maxBuffer: 1 << 28 })
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')}: ${r.stderr}`)
  return r.stdout
}

const toF32 = (buf) => new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
const toBuf = (f32) => Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength)

function trim(x, sr) {
  let peak = 0
  for (const v of x) peak = Math.max(peak, Math.abs(v))
  const floor = peak * Math.pow(10, FLOOR_DB / 20)
  let a = 0, b = x.length - 1
  while (a < b && Math.abs(x[a]) < floor) a++
  while (b > a && Math.abs(x[b]) < floor) b--
  const m = Math.round(MARGIN * sr)
  return x.subarray(Math.max(0, a - m), Math.min(x.length, b + m + 1))
}

function fade(x, sr) {
  const n = Math.min(Math.round(FADE * sr), x.length >> 1)
  for (let i = 0; i < n; i++) {
    const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / n)
    x[i] *= g
    x[x.length - 1 - i] *= g
  }
  return x
}

for (const lang of ['en', 'de']) {
  const meta = JSON.parse(readFileSync(src(`voice-${lang}.json`), 'utf8'))
  const sr = meta.sr
  const pcm = ['-f', 'f32le', '-ac', '1', '-ar', String(sr)]
  const all = toF32(ffmpeg(['-i', src(`voice-${lang}.mp3`), ...pcm, '-']))
  const parts = [new Float32Array(Math.round(PAD * sr))]
  const clips = {}
  let at = parts[0].length
  for (const [key, [off, dur]] of Object.entries(meta.clips)) {
    const raw = trim(all.subarray(Math.round(off * sr), Math.round((off + dur) * sr)), sr)
    const slow = fade(toF32(ffmpeg([...pcm, '-i', '-', '-af', `atempo=${TEMPO}`, ...pcm, '-'], toBuf(Float32Array.from(raw)))), sr)
    clips[key] = [+(at / sr).toFixed(4), +(slow.length / sr).toFixed(4)]
    parts.push(slow, new Float32Array(Math.round(PAD * sr)))
    at += slow.length + Math.round(PAD * sr)
  }
  const out = new Float32Array(at)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  ffmpeg(['-y', ...pcm, '-i', '-', '-c:a', 'libmp3lame', '-b:a', '48k', dst(`voice-${lang}.mp3`)], toBuf(out))
  writeFileSync(dst(`voice-${lang}.json`), JSON.stringify({ sr, tempo: TEMPO, clips }) + '\n')
  console.log(`voice-${lang}: ${Object.keys(clips).length} clips, ${(at / sr).toFixed(1)} s`)
}
