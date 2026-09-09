import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Memory } from '../src/memory/store.js'
import { createLogger } from '../src/util/log.js'

const quiet = createLogger('test', { sink: () => {} })
const scratch = () => mkdtemp(join(tmpdir(), 'golem-'))

describe('memory', () => {
  it('starts empty rather than failing on a first run', async () => {
    const memory = await Memory.open('bot', quiet, await scratch())
    expect(memory.places()).toEqual([])
    expect(memory.recent()).toEqual([])
  })

  it('remembers places across a reload', async () => {
    const dir = await scratch()
    const first = await Memory.open('bot', quiet, dir)
    first.remember('home', { x: 10, y: 64, z: -20 }, 'overworld', 'the base')
    await first.save()

    const second = await Memory.open('bot', quiet, dir)
    expect(second.place('home')?.position).toEqual({ x: 10, y: 64, z: -20 })
    expect(second.place('HOME')?.note).toBe('the base')
    expect(second.place('nowhere')).toBeNull()
  })

  it('replaces a place rather than accumulating duplicates', async () => {
    const memory = await Memory.open('bot', quiet, await scratch())
    memory.remember('home', { x: 0, y: 0, z: 0 }, 'overworld')
    memory.remember('home', { x: 5, y: 5, z: 5 }, 'overworld')
    expect(memory.places()).toHaveLength(1)
    expect(memory.place('home')?.position.x).toBe(5)
  })

  it('turns sightings into planner search times', async () => {
    const memory = await Memory.open('bot', quiet, await scratch())
    memory.sawBlock('deepslate_diamond_ore', { x: 100, y: -50, z: 0 }, { x: 0, y: -50, z: 0 })
    const times = memory.searchTimes()
    // 100 blocks away at a quarter-second per block.
    expect(times.get('deepslate_diamond_ore')).toBeCloseTo(25, 1)
  })

  it('keeps the nearest sighting of a block, not the latest', async () => {
    const memory = await Memory.open('bot', quiet, await scratch())
    memory.sawBlock('iron_ore', { x: 200, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })
    memory.sawBlock('iron_ore', { x: 20, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })
    expect(memory.searchTimes().get('iron_ore')).toBeCloseTo(5, 1)
  })

  it('does not record every block in one vein separately', async () => {
    const memory = await Memory.open('bot', quiet, await scratch())
    for (let i = 0; i < 10; i++) {
      memory.sawBlock('coal_ore', { x: i, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })
    }
    expect(memory.sightings('coal_ore')).toHaveLength(1)
  })

  it('survives a corrupt or hand-edited file instead of crashing', async () => {
    const dir = await scratch()
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'bot.json'), '{ not json at all', 'utf8')
    const memory = await Memory.open('bot', quiet, dir)
    expect(memory.places()).toEqual([])
  })

  it('rejects a well-formed file of the wrong shape', async () => {
    const dir = await scratch()
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'bot.json'), JSON.stringify({ version: 99, places: 'no' }), 'utf8')
    const memory = await Memory.open('bot', quiet, dir)
    expect(memory.places()).toEqual([])
  })

  it('writes valid JSON, atomically', async () => {
    const dir = await scratch()
    const memory = await Memory.open('bot', quiet, dir)
    memory.remember('mine', { x: 1, y: 2, z: 3 }, 'overworld')
    await memory.save()
    const parsed: unknown = JSON.parse(await readFile(join(dir, 'bot.json'), 'utf8'))
    expect((parsed as { version: number }).version).toBe(1)
  })

  it('keeps the file bounded as episodes pile up', async () => {
    const dir = await scratch()
    const memory = await Memory.open('bot', quiet, dir)
    for (let i = 0; i < 500; i++) {
      memory.record({ at: i, task: `task ${i}`, outcome: 'done', detail: 'ok', seconds: 1 })
    }
    await memory.save()
    const parsed = JSON.parse(await readFile(join(dir, 'bot.json'), 'utf8')) as { episodes: unknown[] }
    expect(parsed.episodes.length).toBeLessThanOrEqual(200)
    // The ones kept are the most recent, not the first two hundred.
    expect(memory.recent(1)[0]?.task).toBe('task 499')
  })
})
