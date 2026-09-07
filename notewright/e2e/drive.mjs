// Drives the whole application in a real browser: clicks the interface, checks
// that the song document changed the way the click implied, and takes a
// screenshot of every screen. Two bugs in this project were found by driving it
// rather than by unit tests, which is the argument for keeping it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'vite'
import { launch, reporter } from './browser.mjs'

const report = reporter()
const SHOTS = new URL('./shots/', import.meta.url).pathname
mkdirSync(SHOTS, { recursive: true })

const songPath = new URL('../songs/back-lot.song.json', import.meta.url).pathname
const originalSong = readFileSync(songPath, 'utf8')

const server = await createServer({ server: { port: 5192, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1560, height: 950 } })

const problems = []
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text()}`)
})
page.on('pageerror', (error) => problems.push(`page: ${String(error)}`))

const state = () => page.evaluate(() => window.notewright.store.get())
const songText = () => page.evaluate(() => window.notewright.store.text())
const shot = (name) => page.screenshot({ path: `${SHOTS}${name}.png` })

try {
  // Named explicitly rather than relying on which song sorts first.
  await page.goto('http://localhost:5192/?song=back-lot')
  await page.waitForSelector('.app', { timeout: 30000 })
  await page.waitForTimeout(400)

  report.section('It opens')
  const opened = await state()
  report.check('the demo beat loaded', opened.song.title === 'Back Lot', opened.song.title)
  report.check('with no complaints from the parser', opened.issues.length === 0, JSON.stringify(opened.issues))
  report.check('a track is already selected', opened.selection.trackId !== null, String(opened.selection.trackId))
  report.check('and so is one of its patterns', opened.selection.patternId !== null, String(opened.selection.patternId))
  report.check('it says audio has not started yet', await page.locator('.banner').first().isVisible())
  await shot('01-arrange')

  report.section('The arrangement grid')
  const cellsBefore = await page.locator('.cell[data-on="true"]').count()
  await page.locator('.cell').nth(1).click()
  await page.waitForTimeout(120)
  const cellsAfter = await page.locator('.cell[data-on="true"]').count()
  report.check('clicking a cell changes what plays in that section', cellsAfter !== cellsBefore, `${cellsBefore} then ${cellsAfter}`)
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(120)
  report.check('undo puts it back', (await page.locator('.cell[data-on="true"]').count()) === cellsBefore)

  const sectionsBefore = (await state()).song.sections.length
  await page.locator('.toolbar button', { hasText: 'Add section' }).first().click()
  await page.waitForTimeout(150)
  report.check(
    'a section can be added',
    (await state()).song.sections.length === sectionsBefore + 1,
    `${sectionsBefore} then ${(await state()).song.sections.length}`,
  )
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(120)
  report.check('and undone', (await state()).song.sections.length === sectionsBefore)

  report.section('The step editor')
  await page.keyboard.press('2')
  await page.waitForTimeout(250)
  const stepsOn = () => page.locator('.step[data-on="true"]').count()
  const before = await stepsOn()
  await page.locator('.step').nth(1).click()
  await page.waitForTimeout(120)
  report.check('clicking an empty step places a hit', (await stepsOn()) === before + 1)
  const withHit = await songText()
  report.check('and the file text shows it', withHit.includes('"kick"'), 'kick lane present')
  await page.locator('.step').nth(1).click()
  await page.waitForTimeout(120)
  report.check('clicking it again takes it away', (await stepsOn()) === before)
  await shot('02-steps')

  await page.locator('.lane-name').first().click()
  await page.waitForTimeout(300)
  report.check('clicking a lane name starts the audio engine', (await page.evaluate(() => window.notewright.audio.status)) === 'running')

  report.section('The piano roll')
  await page.locator('.track-row', { hasText: '808' }).first().click()
  await page.waitForTimeout(300)
  report.check('the 808 track shows a piano roll', await page.locator('.roll-grid canvas').first().isVisible())
  const bassNotes = async () =>
    (await state()).song.patterns.find((pattern) => pattern.id === '808-a').notes
  const notesBefore = (await bassNotes()).length
  // Relative to the scroll viewport, not the canvas: the canvas is far taller
  // than the window and scrolled, so its own origin sits off-screen.
  const view = await page.locator('.roll-scroll').boundingBox()
  const spotX = view.x + 320
  const spotY = view.y + 180
  await page.mouse.click(spotX, spotY)
  await page.waitForTimeout(200)
  const afterAdd = await bassNotes()
  report.check('clicking empty space writes a note', afterAdd.length === notesBefore + 1, `${notesBefore} then ${afterAdd.length}`)
  const selection = (await state()).selection.notes
  report.check(
    'and the new note is the one selected',
    selection.length === 1 && afterAdd[selection[0]] !== undefined,
    JSON.stringify(selection),
  )
  const placed = afterAdd[selection[0]]

  // Press on the note itself rather than near where it was clicked: a click
  // snaps left to the grid, so "two pixels right of the pointer" can already be
  // past the end of a sixteenth and would just add a second note.
  const canvasBox = await page.locator('.roll-grid canvas').first().boundingBox()
  const noteX = canvasBox.x + placed.at * 46 + 4
  await page.mouse.move(noteX, spotY)
  await page.mouse.down()
  await page.mouse.move(noteX + 92, spotY, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(200)
  const moved = await bassNotes()
  const nowAt = moved[(await state()).selection.notes[0]]
  report.check('and it can be dragged along', moved.length === afterAdd.length, `${moved.length} notes`)
  report.check(
    'the drag moved it later in the bar',
    nowAt !== undefined && nowAt.at > placed.at,
    `${placed.at} then ${nowAt?.at}`,
  )
  await shot('03-piano-roll')

  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(200)
  const undone = (await bassNotes()).length
  report.check('undo removes the note again', undone === notesBefore, `${undone} notes`)

  report.section('Hi-hat rolls in the step editor')
  await page.locator('.track-row', { hasText: 'Drums' }).first().click()
  await page.waitForTimeout(250)
  await page.locator('.pattern-tabs button', { hasText: 'drums-main' }).first().click()
  await page.waitForTimeout(200)
  const hatLane = async () =>
    (await state()).song.patterns.find((pattern) => pattern.id === 'drums-main').lanes.hat.length
  const hatsBefore = await hatLane()
  await page.getByLabel('Roll', { exact: true }).selectOption({ label: '3 — triplet' })
  await page.waitForTimeout(150)
  // The fourth row of cells is the hi-hat lane; step 2 of it is empty.
  const hatRow = page.locator('.step-lane').nth(3)
  await hatRow.locator('.step').nth(1).click()
  await page.waitForTimeout(200)
  const hatsAfter = await hatLane()
  report.check(
    'placing a triplet writes three hits into one step',
    hatsAfter === hatsBefore + 3,
    `${hatsBefore} then ${hatsAfter}`,
  )
  // Read the pattern by name: the file has several hat lanes, and matching the
  // first one in the text was checking a different pattern entirely.
  const rolledLane = JSON.parse(await songText()).patterns.find((p) => p.id === 'drums-main').lanes.hat
  report.check(
    'and it stays one character in the file',
    rolledLane.startsWith('xtx.'),
    rolledLane,
  )
  await hatRow.locator('.step').nth(1).click()
  await page.waitForTimeout(200)
  report.check('clicking it again clears the whole roll', (await hatLane()) === hatsBefore)

  report.section('The chord tool')
  await page.locator('.track-row', { hasText: '808' }).first().click()
  await page.waitForTimeout(300)
  await page.getByLabel('Place', { exact: true }).selectOption({ label: 'Triad from the key' })
  await page.waitForTimeout(150)
  const beforeChord = (await bassNotes()).length
  await page.mouse.click(view.x + 500, view.y + 300)
  await page.waitForTimeout(200)
  const afterChord = await bassNotes()
  report.check(
    'placing a triad writes three notes at once',
    afterChord.length === beforeChord + 3,
    `${beforeChord} then ${afterChord.length}`,
  )
  const chordSelection = (await state()).selection.notes
  const chordPitches = chordSelection.map((index) => afterChord[index].pitch).sort((a, b) => a - b)
  report.check(
    'and they are stacked as a chord, all on one beat',
    chordPitches.length === 3 &&
      new Set(chordSelection.map((index) => afterChord[index].at)).size === 1 &&
      chordPitches[1] - chordPitches[0] >= 3 &&
      chordPitches[2] - chordPitches[1] >= 3,
    chordPitches.join(', '),
  )
  const inKey = await page.evaluate(
    ([pitches]) => {
      const minor = [0, 2, 3, 5, 7, 8, 10]
      const root = 5 // The demo beat is in F minor.
      return pitches.every((pitch) => minor.includes((((pitch - root) % 12) + 12) % 12))
    },
    [chordPitches],
  )
  report.check('every tone belongs to the song key', inKey, chordPitches.join(', '))

  await page.getByLabel('Place', { exact: true }).selectOption({ label: 'Single note' })
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(200)
  report.check('undo takes the whole chord back out', (await bassNotes()).length <= beforeChord, `${(await bassNotes()).length} notes`)

  report.section('Reordering tracks')
  const orderBefore = (await state()).song.tracks.map((track) => track.id)
  const moving = (await state()).selection.trackId
  const wasAt = orderBefore.indexOf(moving)
  await page.locator('.inspector .mini[title="Move this track down"]').first().click()
  await page.waitForTimeout(200)
  const orderAfter = (await state()).song.tracks.map((track) => track.id)
  report.check(
    'the selected track moves down the list',
    orderAfter.indexOf(moving) === wasAt + 1 && orderAfter[wasAt] === orderBefore[wasAt + 1],
    `${moving}: ${wasAt} -> ${orderAfter.indexOf(moving)} (${orderAfter.join(' ')})`,
  )
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(150)
  report.check('and put back', (await state()).song.tracks.map((track) => track.id).join(' ') === orderBefore.join(' '))

  report.section('The mixer')
  await page.keyboard.press('3')
  await page.waitForTimeout(250)
  report.check(
    'every track has a strip, plus the master',
    (await page.locator('.strip').count()) === (await state()).song.tracks.length + 1,
    `${await page.locator('.strip').count()} strips`,
  )
  const gainBefore = (await state()).song.tracks[0].gain
  await page.locator('.strip .fader').first().focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(150)
  const gainAfter = (await state()).song.tracks[0].gain
  report.check('a fader can be moved from the keyboard', gainAfter === gainBefore - 2, `${gainBefore} then ${gainAfter}`)
  await page.locator('.strip .mini[data-kind="mute"]').first().click()
  await page.waitForTimeout(120)
  report.check('mute is a real change to the song', (await state()).song.tracks[0].mute === true)
  await page.locator('.strip .mini[data-kind="mute"]').first().click()
  await page.waitForTimeout(120)
  await shot('04-mixer')

  report.section('The inspector')
  await page.keyboard.press('2')
  await page.locator('.track-row', { hasText: 'Pad' }).first().click()
  await page.waitForTimeout(250)
  const cutoffKnob = page.locator('.inspector [role="slider"][aria-label="Cutoff"]').first()
  const cutoffBefore = Number(await cutoffKnob.getAttribute('aria-valuenow'))
  await cutoffKnob.focus()
  await page.keyboard.press('ArrowUp')
  await page.waitForTimeout(150)
  const cutoffAfter = Number(await cutoffKnob.getAttribute('aria-valuenow'))
  report.check('a knob responds to the keyboard', cutoffAfter > cutoffBefore, `${cutoffBefore} then ${cutoffAfter}`)
  const cutoffInDocument = (await state()).song.tracks.find((track) => track.id === 'pad').instrument.filter.frequency
  report.check(
    'and the change is in the document',
    // aria-valuenow is rounded for announcement; the document keeps full precision.
    cutoffAfter !== cutoffBefore && Math.abs(cutoffInDocument - cutoffAfter) < 0.001,
    `knob says ${cutoffAfter}, document says ${cutoffInDocument}`,
  )
  await shot('05-inspector')

  const effectsBefore = (await state()).song.tracks.find((track) => track.id === 'pad').effects.length
  await page.selectOption('.inspector .panel-head select[aria-label="Add an effect"]', 'reverb')
  await page.waitForTimeout(200)
  report.check(
    'an effect can be added to the rack',
    (await state()).song.tracks.find((track) => track.id === 'pad').effects.length === effectsBefore + 1,
  )
  await page.locator('.effect .mini[title="Remove"]').last().click()
  await page.waitForTimeout(150)
  report.check(
    'and removed',
    (await state()).song.tracks.find((track) => track.id === 'pad').effects.length === effectsBefore,
  )

  report.section('Adding a track')
  const trackCount = (await state()).song.tracks.length
  await page.locator('.rail .panel-head .button').first().click()
  await page.waitForTimeout(150)
  await page.locator('.rail .list-row', { hasText: '808 — Deep' }).first().click()
  await page.waitForTimeout(200)
  const added = await state()
  report.check('the new track is there', added.song.tracks.length === trackCount + 1)
  report.check('it is an 808, from the preset', added.song.tracks.at(-1).instrument.type === '808')
  report.check('and it is selected', added.selection.trackId === added.song.tracks.at(-1).id)
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(150)
  report.check('undo removes it', (await state()).song.tracks.length === trackCount)

  report.section('Starting from a template')
  await page.keyboard.press('4')
  await page.waitForTimeout(300)
  page.once('dialog', (dialog) => void dialog.accept())
  await page.locator('.card .list-row', { hasText: 'Trap — 140' }).first().click()
  await page.waitForTimeout(400)
  const started = await state()
  report.check('a template loads a beat, not an empty screen', started.song.tracks.length >= 3, `${started.song.tracks.length} tracks`)
  report.check('at the tempo it says', started.song.tempo === 140, String(started.song.tempo))
  report.check(
    'with an 808 that ducks under the kick',
    started.song.tracks.some((track) => track.instrument.type === '808' && track.duck?.lane === 'kick'),
  )
  report.check('and it lands on the arrangement', started.view === 'arrange')

  // Back to the demo for the rest of the run.
  await page.evaluate(async () => {
    const entries = await window.notewright.library.list()
    const demo = entries.find((entry) => entry.name === 'back-lot')
    window.notewright.store.loadText(demo.source, demo.name)
  })
  await page.waitForTimeout(300)

  report.section('Playback')
  await page.keyboard.press('1')
  await page.waitForTimeout(150)
  await page.keyboard.press(' ')
  await page.waitForTimeout(1200)
  const playing = await page.evaluate(() => window.notewright.audio.player.state)
  report.check('the transport is running', playing.playing === true)
  report.check('and the playhead has moved', playing.beat > 0.2, `beat ${playing.beat.toFixed(2)}`)
  const meter = await page.evaluate(() => window.notewright.audio.player.meters().master)
  report.check('the master meter shows signal', meter > 0.001, `level ${meter.toFixed(4)}`)
  await shot('06-playing')
  await page.keyboard.press(' ')
  await page.waitForTimeout(200)
  report.check('space stops it again', (await page.evaluate(() => window.notewright.audio.player.state.playing)) === false)

  report.section('Saving to the project folder')
  await page.keyboard.press('4')
  await page.waitForTimeout(250)
  await shot('07-files')
  const edited = await page.evaluate(() => {
    window.notewright.store.edit((song) => {
      song.title = 'Back Lot (driven)'
    })
    return window.notewright.store.get().dirty
  })
  report.check('editing marks the document dirty', edited === true)
  await page.locator('.card .button', { hasText: /^Save$/ }).first().click()
  await page.waitForTimeout(600)
  const onDisk = readFileSync(songPath, 'utf8')
  report.check('the file on disk changed', onDisk.includes('Back Lot (driven)'))
  report.check('and the document is clean again', (await state()).dirty === false)
  report.check('the saved file still parses', JSON.parse(onDisk).format === 'notewright/1')

  report.section('A change on disk reaches the running app')
  writeFileSync(songPath, onDisk.replace('Back Lot (driven)', 'Back Lot (from disk)'), 'utf8')
  await page.waitForFunction(
    () => window.notewright.store.get().song.title === 'Back Lot (from disk)',
    undefined,
    { timeout: 10000 },
  ).then(
    () => report.check('the app picked up the edit without a reload', true),
    () => report.check('the app picked up the edit without a reload', false, 'timed out'),
  )

  report.section('Exporting audio')
  const exported = await page.evaluate(async () => {
    const { song } = window.notewright.store.get()
    const short = structuredClone(song)
    short.sections = short.sections.slice(0, 1)
    const module = await import('/src/engine/render.ts')
    const buffer = await module.renderSong(short)
    const stats = module.analyseRender(buffer)
    const blob = module.encodeWav(buffer, 16)
    return { ...stats, bytes: blob.size, type: blob.type }
  })
  report.check('the export makes sound', exported.rms > 0.005, `rms ${exported.rms.toFixed(4)}`)
  report.check('it does not clip', exported.clippedFrames === 0)
  report.check('and it is a real WAV', exported.type === 'audio/wav' && exported.bytes > 44)

  report.section('Empty and broken states')
  await page.evaluate(() => window.notewright.store.loadText('{ not json', 'broken'))
  await page.waitForTimeout(200)
  const broken = await state()
  report.check('malformed JSON is reported, not thrown', broken.issues.some((issue) => issue.message.includes('not valid JSON')))
  report.check('and the previous song is still loaded', broken.song.tracks.length > 0)
  await shot('08-broken')

  await page.evaluate(() =>
    window.notewright.store.loadText(
      JSON.stringify({ format: 'notewright/1', title: 'Empty', tempo: 120, tracks: [], patterns: [], sections: [] }),
      'empty',
    ),
  )
  await page.keyboard.press('1')
  await page.waitForTimeout(250)
  report.check('an empty song offers a way in', await page.locator('.empty h2').first().isVisible())
  await shot('09-empty')
  await page.keyboard.press('2')
  await page.waitForTimeout(200)
  report.check('so does the editor', await page.locator('.empty h2').first().isVisible())
  await page.keyboard.press('3')
  await page.waitForTimeout(200)
  report.check('and the mixer', await page.locator('.empty h2').first().isVisible())

  report.section('Nothing threw')
  report.check('no console or page errors', problems.length === 0, problems.join(' | '))
} catch (error) {
  report.check('the run completed', false, String(error))
  await shot('99-failure')
} finally {
  writeFileSync(songPath, originalSong, 'utf8')
  await browser.close()
  await server.close()
}

process.exit(report.finish() > 0 ? 1 : 0)
