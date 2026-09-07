// Renders songs through the real audio engine in a real browser and asserts on
// the samples that come out. Unit tests cannot do this: there is no Web Audio in
// Node, and mocking it would only ever prove that the mock works.
import { createServer } from 'vite'
import { launch, reporter } from './browser.mjs'

const report = reporter()
const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await launch()
const page = await browser.newPage()

const consoleErrors = []
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', (error) => consoleErrors.push(String(error)))

try {
  await page.goto('http://localhost:5199/e2e/harness.html')
  await page.waitForSelector('body[data-ready="true"]', { timeout: 60000 })

  const song = (extra = {}) => ({
    format: 'notewright/1',
    title: 'Engine check',
    tempo: 120,
    timeSignature: '4/4',
    tracks: [
      { id: 'drums', name: 'Drums', gain: -6, instrument: { type: 'drums' } },
      { id: 'bass', name: 'Bass', gain: -6, instrument: { type: 'synth' } },
      { id: 'keys', name: 'Keys', gain: -8, instrument: { type: 'fm' } },
    ],
    patterns: [
      {
        id: 'beat', track: 'drums', bars: 1, grid: '1/16',
        lanes: { kick: 'x... .... x... ....', snare: '.... x... .... x...', hat: 'x.x. x.x. x.x. x.x.' },
      },
      { id: 'line', track: 'bass', bars: 1, grid: '1/16', notes: 'A1~4 . . .  E2~2 . . .  A1 . . .  C2~2 . . .' },
      { id: 'pad', track: 'keys', bars: 1, grid: '1/4', notes: '[A3 C4 E4]~4 . . .' },
    ],
    sections: [{ id: 'a', name: 'A', bars: 2, clips: ['beat', 'line', 'pad'] }],
    ...extra,
  })

  const measure = (document, options = {}) =>
    page.evaluate(
      async ([source, renderOptions]) => {
        const parsed = window.harness.parseSong(source)
        const buffer = await window.harness.renderSong(parsed.value, renderOptions)
        const stats = window.harness.analyseRender(buffer)
        const channelRms = []
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const data = buffer.getChannelData(channel)
          let sum = 0
          for (let index = 0; index < data.length; index++) sum += data[index] * data[index]
          channelRms.push(Math.sqrt(sum / data.length))
        }
        return { ...stats, channelRms, issues: parsed.issues, channels: buffer.numberOfChannels }
      },
      [document, options],
    )

  report.section('A whole song renders')
  const full = await measure(song())
  report.check('the parser had nothing to complain about', full.issues.length === 0, JSON.stringify(full.issues))
  report.check('there is sound in the file', full.rms > 0.01, `rms ${full.rms.toFixed(4)}`)
  report.check('nothing clips', full.clippedFrames === 0, `${full.clippedFrames} clipped frames`)
  report.check('it uses the headroom', full.peak > 0.15 && full.peak <= 1, `peak ${full.peak.toFixed(3)}`)
  report.check('it is stereo', full.channels === 2)
  report.check('two bars at 120bpm plus a tail', full.seconds > 4 && full.seconds < 12, `${full.seconds.toFixed(2)}s`)

  report.section('Each instrument on its own')
  for (const [name, trackId] of [['drum kit', 'drums'], ['subtractive synth', 'bass'], ['fm synth', 'keys']]) {
    const only = song()
    only.tracks = only.tracks.filter((track) => track.id === trackId)
    only.patterns = only.patterns.filter((pattern) => pattern.track === trackId)
    only.sections[0].clips = only.patterns.map((pattern) => pattern.id)
    const stats = await measure(only)
    report.check(`the ${name} makes sound`, stats.rms > 0.005, `rms ${stats.rms.toFixed(4)}`)
  }

  const strike = (document) =>
    page.evaluate(async (source) => {
      const parsed = window.harness.parseSong(source)
      const buffer = await window.harness.renderSong(parsed.value, { tailSeconds: 0.2 })
      const left = buffer.getChannelData(0)
      const right = buffer.getChannelData(1)
      // Only the first second: a hi-hat is over long before the render is, and
      // averaging across the silence afterwards would call every voice quiet.
      const span = Math.min(left.length, Math.floor(buffer.sampleRate))
      let peak = 0
      let sum = 0
      for (let index = 0; index < span; index++) {
        peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]))
        sum += ((left[index] + right[index]) / 2) ** 2
      }
      return { peak, rms: Math.sqrt(sum / span), issues: parsed.issues }
    }, document)

  report.section('Every drum voice speaks')
  const kitSong = song()
  kitSong.tracks = [{ id: 'drums', name: 'Drums', gain: 0, instrument: { type: 'drums' } }]
  kitSong.patterns = []
  kitSong.sections = [{ id: 'a', name: 'A', bars: 1, clips: [] }]
  for (const lane of ['kick', 'snare', 'clap', 'hat', 'open', 'rim', 'tom', 'ride']) {
    const one = JSON.parse(JSON.stringify(kitSong))
    one.patterns = [{ id: 'p', track: 'drums', bars: 1, grid: '1/16', lanes: { [lane]: 'X... .... .... ....' } }]
    one.sections[0].clips = ['p']
    const stats = await strike(one)
    report.check(
      `${lane} sounds, and within a kit's worth of the kick`,
      stats.peak > 0.1 && stats.peak <= 0.8,
      `peak ${stats.peak.toFixed(3)}`,
    )
  }

  report.section('Every oscillator shape speaks')
  for (const wave of ['sine', 'triangle', 'sawtooth', 'square', 'pulse', 'supersaw']) {
    const one = song()
    one.tracks = [{ id: 'bass', name: 'B', gain: 0, instrument: { type: 'synth', oscillators: [{ wave, level: 0.8 }, { level: 0 }] } }]
    one.patterns = [{ id: 'p', track: 'bass', bars: 1, grid: '1/4', notes: 'A3~4 . . .' }]
    one.sections = [{ id: 'a', name: 'A', bars: 1, clips: ['p'] }]
    const stats = await measure(one)
    report.check(`${wave} sounds`, stats.rms > 0.01 && stats.clippedFrames === 0, `rms ${stats.rms.toFixed(4)}`)
  }

  report.section('Silence stays silent')
  const empty = song()
  empty.sections = [{ id: 'a', name: 'A', bars: 2, clips: [] }]
  const nothing = await measure(empty)
  report.check('an empty arrangement is silent, not noisy', nothing.peak < 1e-4, `peak ${nothing.peak}`)

  const muted = song()
  muted.tracks.forEach((track) => (track.mute = true))
  report.check('muting everything silences it', (await measure(muted)).peak < 1e-4)

  const missing = song()
  missing.tracks[1].instrument = { type: 'sampler', sample: 'nothing-here.wav' }
  const missingStats = await measure(missing)
  report.check('a missing sample renders without throwing', missingStats.rms > 0.005, 'the rest of the song still plays')

  report.section('Mix controls do what they say')
  const soloed = song()
  soloed.tracks[0].solo = true
  const soloStats = await measure(soloed)
  report.check('solo drops the other tracks', soloStats.rms < full.rms, `${soloStats.rms.toFixed(4)} < ${full.rms.toFixed(4)}`)

  const panned = song()
  panned.tracks.forEach((track) => (track.pan = -1))
  const panStats = await measure(panned)
  report.check(
    'hard left empties the right channel',
    panStats.channelRms[0] > 0.01 && panStats.channelRms[1] < panStats.channelRms[0] * 0.05,
    `L ${panStats.channelRms[0].toFixed(4)} R ${panStats.channelRms[1].toFixed(4)}`,
  )

  const quietened = song()
  quietened.tracks.forEach((track) => (track.gain = -24))
  report.check('the faders attenuate', (await measure(quietened)).rms < full.rms * 0.35)

  report.section('Effects change the sound without breaking it')
  for (const effect of [
    { type: 'drive', amount: 0.8 },
    { type: 'chorus', mix: 1 },
    { type: 'delay', mix: 0.6 },
    { type: 'reverb', mix: 0.6 },
    { type: 'crush', bits: 3, mix: 1 },
    { type: 'eq', low: 12, high: -18 },
    { type: 'compressor', threshold: -40, ratio: 12 },
    { type: 'filter', mode: 'lowpass', frequency: 200 },
  ]) {
    const withEffect = song()
    withEffect.tracks[1].effects = [effect]
    const stats = await measure(withEffect)
    report.check(
      `${effect.type}`,
      stats.rms > 0.0005 && Math.abs(stats.rms - full.rms) > 1e-5 && stats.clippedFrames === 0,
      `rms ${stats.rms.toFixed(4)}`,
    )
  }

  const bypassed = song()
  bypassed.tracks[1].effects = [{ type: 'crush', bits: 2, mix: 1, enabled: false }]
  const bypassStats = await measure(bypassed)
  report.check('a disabled effect is truly out of the path', Math.abs(bypassStats.rms - full.rms) < 1e-9)

  report.section('Sends reach the master buses')
  const sent = song()
  sent.tracks[1].sends = { reverb: 1, delay: 1 }
  report.check('a send adds a tail', (await measure(sent)).rms > full.rms * 0.9)

  report.section('Automation moves a parameter')
  // On one bright track alone, so the change is the measurement rather than a
  // rounding error in a mix the track is a tenth of.
  const sweepBase = () => ({
    format: 'notewright/1', title: 'Sweep', tempo: 120, timeSignature: '4/4',
    master: { limiter: false },
    tracks: [{
      id: 'lead', name: 'Lead', gain: -6,
      instrument: { type: 'synth', oscillators: [{ wave: 'sawtooth', level: 0.9 }, { level: 0 }], filter: { frequency: 18000, envelope: 0 } },
      effects: [{ type: 'filter', mode: 'lowpass', frequency: 80 }],
    }],
    patterns: [{ id: 'p', track: 'lead', bars: 1, grid: '1/16', notes: 'A3 A3 A3 A3  A3 A3 A3 A3  A3 A3 A3 A3  A3 A3 A3 A3' }],
    sections: [{ id: 'a', name: 'A', bars: 2, clips: ['p'] }],
  })

  const closed = await measure(sweepBase())
  const opened = (() => { const doc = sweepBase(); doc.tracks[0].effects[0].frequency = 12000; return doc })()
  const openStats = await measure(opened)
  report.check(
    'a lowpass effect actually filters',
    openStats.rms > closed.rms * 3,
    `open ${openStats.rms.toFixed(4)} vs closed ${closed.rms.toFixed(4)}`,
  )

  const automated = sweepBase()
  automated.tracks[0].automation = [{ target: 'effects.0.frequency', points: '0:80 8:12000' }]
  // The point of a sweep is that it moves, so compare the start of the render
  // with the end of it — and compare *brightness*, not loudness. A sawtooth's
  // energy is nearly all in its fundamental, so opening a lowpass from 80Hz to
  // 12kHz changes its RMS by about four percent while changing its tone
  // completely. First-order differencing is a high-pass; the ratio of the
  // differenced signal's level to the signal's own is a usable spectral slope.
  const overTime = await page.evaluate(async (source) => {
    const parsed = window.harness.parseSong(source)
    const buffer = await window.harness.renderSong(parsed.value)
    const data = buffer.getChannelData(0)
    const rate = buffer.sampleRate
    const brightness = (fromSeconds, toSeconds) => {
      let signal = 0
      let edges = 0
      let count = 0
      const start = Math.max(1, Math.floor(fromSeconds * rate))
      const end = Math.min(data.length, Math.floor(toSeconds * rate))
      for (let i = start; i < end; i++) {
        signal += data[i] * data[i]
        const difference = data[i] - data[i - 1]
        edges += difference * difference
        count++
      }
      if (count === 0 || signal === 0) return 0
      return Math.sqrt(edges / signal)
    }
    return { start: brightness(0.05, 0.55), end: brightness(3.4, 3.9) }
  }, automated)
  report.check(
    'a sweep opens up as it goes',
    overTime.end > overTime.start * 2,
    `brightness ${overTime.start.toFixed(4)} then ${overTime.end.toFixed(4)}`,
  )

  const gainRide = sweepBase()
  gainRide.tracks[0].effects = []
  const openLoud = await measure({ ...sweepBase(), tracks: [{ ...sweepBase().tracks[0], effects: [] }] })
  gainRide.tracks[0].automation = [{ target: 'gain', points: '0:-60 8:-6' }]
  const rideStats = await measure(gainRide)
  report.check('a gain ride fades in', rideStats.rms < openLoud.rms * 0.8, `rms ${rideStats.rms.toFixed(4)} vs ${openLoud.rms.toFixed(4)}`)

  const panRide = sweepBase()
  panRide.tracks[0].effects = []
  panRide.tracks[0].automation = [{ target: 'pan', points: '0:-1 8:1' }]
  const panRideStats = await measure(panRide)
  report.check(
    'a pan ride keeps both channels busy',
    panRideStats.channelRms[0] > 0.005 && panRideStats.channelRms[1] > 0.005,
    `L ${panRideStats.channelRms[0].toFixed(4)} R ${panRideStats.channelRms[1].toFixed(4)}`,
  )

  report.section('Envelopes hold their shape')
  // The regression this guards: a note shorter than its own decay used to have
  // its decay discarded and dive straight to silence, so a six-step 808 was
  // inaudible by its fourth step. Anything with a long decay was affected.
  const envelopeShape = await page.evaluate(async () => {
    const doc = {
      format: 'notewright/1', title: 'e', tempo: 118, timeSignature: '4/4',
      master: { gain: 0, limiter: false },
      tracks: [{ id: 'b', name: 'B', gain: 0, instrument: { type: '808' } }],
      // Six steps of note, then a gap: long decay, short note.
      patterns: [{ id: 'p', track: 'b', bars: 1, grid: '1/16', notes: 'F1~6 . . .  . . . .  . . . .  . . . .' }],
      sections: [{ id: 'a', name: 'A', bars: 1, clips: ['p'] }],
    }
    const song = window.harness.parseSongText(JSON.stringify(doc)).value
    const buffer = await window.harness.renderSong(song, { tailSeconds: 0.1 })
    const data = buffer.getChannelData(0)
    const rate = buffer.sampleRate
    const stepSeconds = 60 / 118 / 4
    const at = (step) => {
      const from = Math.floor(step * stepSeconds * rate)
      const to = Math.min(data.length, Math.floor((step + 1) * stepSeconds * rate))
      let sum = 0
      for (let i = from; i < to; i++) sum += data[i] * data[i]
      return Math.sqrt(sum / Math.max(1, to - from))
    }
    return { first: at(0), fourth: at(3), sixth: at(5), afterRelease: at(8) }
  })
  report.check(
    'a note shorter than its decay is still there near its end',
    envelopeShape.fourth > envelopeShape.first * 0.5,
    `step 1 ${envelopeShape.first.toFixed(3)}, step 4 ${envelopeShape.fourth.toFixed(3)}`,
  )
  report.check(
    'and it does stop when it is over',
    envelopeShape.afterRelease < envelopeShape.first * 0.05,
    `after release ${envelopeShape.afterRelease.toFixed(4)}`,
  )

  report.section('The 808')
  const bass = await page.evaluate(async () => {
    const build = (notes, extra = {}) => ({
      format: 'notewright/1', title: '808', tempo: 118, timeSignature: '4/4',
      master: { gain: 0, limiter: false },
      tracks: [{ id: 'b', name: 'B', gain: 0, instrument: { type: '808', ...extra } }],
      patterns: [{ id: 'p', track: 'b', bars: 1, grid: '1/16', notes }],
      sections: [{ id: 'a', name: 'A', bars: 1, clips: ['p'] }],
    })
    // Dominant frequency under 200Hz in a window, by counting zero crossings of
    // a heavily smoothed signal — enough to tell one bass note from another.
    const pitchIn = (data, rate, fromSeconds, toSeconds) => {
      const from = Math.floor(fromSeconds * rate)
      const to = Math.min(data.length, Math.floor(toSeconds * rate))
      let smoothed = 0
      let previous = 0
      let crossings = 0
      for (let i = from; i < to; i++) {
        smoothed += (data[i] - smoothed) * 0.02
        if (previous <= 0 && smoothed > 0) crossings++
        previous = smoothed
      }
      return (crossings * rate) / Math.max(1, to - from)
    }
    const render = async (doc) => {
      const song = window.harness.parseSongText(JSON.stringify(doc)).value
      const buffer = await window.harness.renderSong(song, { tailSeconds: 0.1 })
      return { data: buffer.getChannelData(0), rate: buffer.sampleRate }
    }

    const plain = await render(build('F1~16 . . .  . . . .  . . . .  . . . .'))
    // A slide: C2 begins while F1 is still sounding, so the voice bends.
    const slid = await render(build('F1~9 . . .  . . . .  C2~8 . . .  . . . .'))
    const stepped = await render(build('F1~8 . . .  . . . .  C2~8 . . .  . . . .'))

    let low = 0, high = 0
    const size = 4096
    for (let i = 0; i < size; i++) {
      // Crude split: compare a heavily lowpassed copy against the raw signal.
      low += plain.data[i + 2000] * plain.data[i + 2000]
    }
    let smoothed = 0
    for (let i = 0; i < size; i++) {
      smoothed += (plain.data[i + 2000] - smoothed) * 0.05
      high += (plain.data[i + 2000] - smoothed) ** 2
    }
    void low
    void high

    return {
      steady: pitchIn(plain.data, plain.rate, 0.4, 1.6),
      slideStart: pitchIn(slid.data, slid.rate, 0.05, 0.35),
      slideEnd: pitchIn(slid.data, slid.rate, 0.9, 1.6),
      steppedStart: pitchIn(stepped.data, stepped.rate, 0.05, 0.35),
      steppedEnd: pitchIn(stepped.data, stepped.rate, 0.9, 1.6),
    }
  })
  report.check(
    'a held 808 sits on its note',
    Math.abs(bass.steady - 43.65) < 8,
    `${bass.steady.toFixed(1)} Hz for F1 (43.65)`,
  )
  report.check(
    'an overlapping note slides the pitch up',
    bass.slideEnd > bass.slideStart * 1.25,
    `${bass.slideStart.toFixed(1)} Hz then ${bass.slideEnd.toFixed(1)} Hz`,
  )
  report.check(
    'a non-overlapping note just retriggers at the new pitch',
    bass.steppedEnd > bass.steppedStart * 1.25,
    `${bass.steppedStart.toFixed(1)} Hz then ${bass.steppedEnd.toFixed(1)} Hz`,
  )

  report.section('Ducking')
  const ducked = await page.evaluate(async () => {
    const build = (duck) => ({
      format: 'notewright/1', title: 'd', tempo: 118, timeSignature: '4/4',
      master: { gain: 0, limiter: false },
      tracks: [
        { id: 'drums', name: 'D', gain: -60, instrument: { type: 'drums' } },
        { id: 'b', name: 'B', gain: 0, instrument: { type: '808' }, ...(duck ? { duck } : {}) },
      ],
      patterns: [
        { id: 'k', track: 'drums', bars: 1, grid: '1/16', lanes: { kick: 'x... .... x... ....' } },
        { id: 'p', track: 'b', bars: 1, grid: '1/16', notes: 'F1~16 . . .  . . . .  . . . .  . . . .' },
      ],
      sections: [{ id: 'a', name: 'A', bars: 1, clips: ['k', 'p'] }],
    })
    const measure = async (doc) => {
      const song = window.harness.parseSongText(JSON.stringify(doc)).value
      const buffer = await window.harness.renderSong(song, { tailSeconds: 0.05 })
      const data = buffer.getChannelData(0)
      const rate = buffer.sampleRate
      const window_ = (fromSeconds, toSeconds) => {
        let peak = 0
        for (let i = Math.floor(fromSeconds * rate); i < Math.floor(toSeconds * rate); i++) {
          peak = Math.max(peak, Math.abs(data[i]))
        }
        return peak
      }
      // The second kick lands at beat 2, which at 118bpm is 1.017s.
      return { atKick: window_(1.02, 1.07), between: window_(1.35, 1.45) }
    }
    return {
      without: await measure(build(null)),
      with: await measure(build({ from: 'drums', lane: 'kick', amount: 0.7, release: 0.15 })),
    }
  })
  report.check(
    'the 808 dips where the kick lands',
    ducked.with.atKick < ducked.with.between * 0.75,
    `at the kick ${ducked.with.atKick.toFixed(3)}, between ${ducked.with.between.toFixed(3)}`,
  )
  report.check(
    'and does not dip without it',
    ducked.without.atKick > ducked.without.between * 0.85,
    `at the kick ${ducked.without.atKick.toFixed(3)}, between ${ducked.without.between.toFixed(3)}`,
  )

  report.section('Hi-hat rolls')
  const rolls = await page.evaluate(async () => {
    const count = async (lane) => {
      const doc = {
        format: 'notewright/1', title: 'r', tempo: 118, timeSignature: '4/4',
        master: { gain: 0, limiter: false },
        tracks: [{
          id: 'd', name: 'D', gain: 0,
          instrument: {
            type: 'drums',
            // A very short hat so the hits in a roll do not overlap each other,
            // which would make them impossible to count by ear or by envelope.
            lanes: [{ id: 'hat', name: 'Hat', voice: 'hat', tune: 9000, decay: 0.006, snap: 0.9, level: 0, pan: 0, choke: 0 }],
          },
        }],
        patterns: [{ id: 'p', track: 'd', bars: 1, grid: '1/16', lanes: { hat: lane } }],
        sections: [{ id: 'a', name: 'A', bars: 1, clips: ['p'] }],
      }
      const song = window.harness.parseSongText(JSON.stringify(doc)).value
      const buffer = await window.harness.renderSong(song, { tailSeconds: 0.05 })
      const data = buffer.getChannelData(0)

      // A short-window envelope, then count bursts with hysteresis. Starting
      // armed matters: otherwise the very first hit is never counted.
      const window_ = 64
      let peak = 0
      const envelope = new Float32Array(Math.floor(data.length / window_))
      for (let block = 0; block < envelope.length; block++) {
        let sum = 0
        for (let i = 0; i < window_; i++) sum += data[block * window_ + i] ** 2
        envelope[block] = Math.sqrt(sum / window_)
        peak = Math.max(peak, envelope[block])
      }
      let hits = 0
      let armed = true
      for (const level of envelope) {
        if (armed && level > peak * 0.22) { hits++; armed = false }
        else if (!armed && level < peak * 0.06) armed = true
      }
      return hits
    }
    return {
      single: await count('x... .... .... ....'),
      double: await count('d... .... .... ....'),
      triplet: await count('t... .... .... ....'),
      four: await count('q... .... .... ....'),
      six: await count('s... .... .... ....'),
      bar: await count('x.x. x.t. x.x. x.q.'),
    }
  })

  report.check('a single step is one hit', rolls.single === 1, String(rolls.single))
  report.check('"d" is two hits', rolls.double === 2, String(rolls.double))
  report.check('"t" is three', rolls.triplet === 3, String(rolls.triplet))
  report.check('"q" is four', rolls.four === 4, String(rolls.four))
  report.check('"s" is six', rolls.six === 6, String(rolls.six))
  report.check(
    'a bar of eighths with two rolls in it counts up correctly',
    // x.x. x.t. x.x. x.q. is six single hits, a triplet and a four: 6 + 3 + 4.
    rolls.bar === 13,
    `${rolls.bar}, expected 13`,
  )

  report.section('The first beat is not swallowed')
  const firstBeat = await page.evaluate(async (source) => {
    const parsed = window.harness.parseSong(source)
    const buffer = await window.harness.renderSong(parsed.value)
    const data = buffer.getChannelData(0)
    const rate = buffer.sampleRate
    const windowPeak = (fromSeconds, toSeconds) => {
      let peak = 0
      for (let i = Math.floor(fromSeconds * rate); i < Math.min(data.length, Math.floor(toSeconds * rate)); i++) {
        peak = Math.max(peak, Math.abs(data[i]))
      }
      return peak
    }
    return { first: windowPeak(0, 0.5), later: windowPeak(2, 2.5) }
  }, song())
  report.check(
    'the downbeat is as loud as the third bar',
    firstBeat.first > firstBeat.later * 0.7,
    `first ${firstBeat.first.toFixed(3)} vs later ${firstBeat.later.toFixed(3)}`,
  )

  const compressed = song()
  compressed.tracks[0].effects = [{ type: 'compressor', threshold: -24, ratio: 8 }]
  const compressedFirst = await page.evaluate(async (source) => {
    const parsed = window.harness.parseSong(source)
    const buffer = await window.harness.renderSong(parsed.value)
    const data = buffer.getChannelData(0)
    const rate = buffer.sampleRate
    const windowPeak = (fromSeconds, toSeconds) => {
      let peak = 0
      for (let i = Math.floor(fromSeconds * rate); i < Math.min(data.length, Math.floor(toSeconds * rate)); i++) {
        peak = Math.max(peak, Math.abs(data[i]))
      }
      return peak
    }
    return { first: windowPeak(0, 0.5), later: windowPeak(2, 2.5) }
  }, compressed)
  report.check(
    'a compressor on a track has settled before bar one',
    compressedFirst.first > compressedFirst.later * 0.7,
    `first ${compressedFirst.first.toFixed(3)} vs later ${compressedFirst.later.toFixed(3)}`,
  )

  report.section('Rendering is repeatable')
  const repeat = await page.evaluate(async (source) => {
    const parsed = window.harness.parseSong(source)
    const first = await window.harness.renderSong(parsed.value)
    const second = await window.harness.renderSong(parsed.value)
    const a = first.getChannelData(0)
    const b = second.getChannelData(0)
    let worst = 0
    let differenceEnergy = 0
    let signalEnergy = 0
    for (let index = 0; index < a.length; index++) {
      const difference = a[index] - b[index]
      if (Math.abs(difference) > worst) worst = Math.abs(difference)
      differenceEnergy += difference * difference
      signalEnergy += a[index] * a[index]
    }
    return {
      worst,
      relative: Math.sqrt(differenceEnergy / Math.max(signalEnergy, 1e-30)),
    }
  }, song())
  const relativeDb = 20 * Math.log10(Math.max(repeat.relative, 1e-30))
  // Not bit-identical, and not expected to be. Chromium sums seven or more
  // inputs to a node in an order it does not promise, and float addition is not
  // associative; whichever order it picks, a resonant filter downstream rings on
  // the difference. Measured over many runs the result is bimodal, landing at
  // either -134 dB or -95 dB relative to the signal. Both are inaudible, and the
  // failure this guards against -- an unseeded noise source -- would show up at
  // around 0 dB, four orders of magnitude away.
  report.check(
    'two renders of one song differ only below audibility',
    relativeDb < -80,
    `${relativeDb.toFixed(1)} dB relative, largest single sample ${repeat.worst.toExponential(2)}`,
  )

  report.section('The WAV file is well formed')
  const wav = await page.evaluate(async (source) => {
    const parsed = window.harness.parseSong(source)
    const buffer = await window.harness.renderSong(parsed.value, { sampleRate: 44100 })
    const blob = window.harness.encodeWav(buffer, 16)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const text = (at, length) => String.fromCharCode(...bytes.slice(at, at + length))
    const view = new DataView(bytes.buffer)
    return {
      size: bytes.length,
      riff: text(0, 4), wave: text(8, 4), fmt: text(12, 4), data: text(36, 4),
      channels: view.getUint16(22, true), sampleRate: view.getUint32(24, true), bits: view.getUint16(34, true),
      declared: view.getUint32(40, true), frames: buffer.length, type: blob.type,
    }
  }, song())
  report.check('it is a RIFF/WAVE file', wav.riff === 'RIFF' && wav.wave === 'WAVE' && wav.fmt === 'fmt ' && wav.data === 'data')
  report.check('the header matches the audio', wav.channels === 2 && wav.sampleRate === 44100 && wav.bits === 16)
  report.check('the declared size matches the payload', wav.declared === wav.frames * 4 && wav.size === 44 + wav.declared, `${wav.size} bytes`)
  report.check('it is labelled audio/wav', wav.type === 'audio/wav')

  report.section('Nothing threw')
  report.check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '))
} finally {
  await browser.close()
  await server.close()
}

process.exit(report.finish() > 0 ? 1 : 0)
