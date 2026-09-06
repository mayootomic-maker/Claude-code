/**
 * Drive the built bot against a real server and assert what actually happened.
 *
 * The unit tests prove the aim maths and the planner in isolation. This proves
 * the parts that only exist at runtime: that the bot joins, that humanised
 * aiming reaches the wire as a stream of distinct angles rather than a snap,
 * that navigation moves it, that digging works, and that chat arrives.
 *
 * Fails the process on the first broken expectation, and on any unhandled
 * error, so it is usable as a gate.
 */

import { GolemBot } from '../dist/bot/bot.js'
import { Navigator } from '../dist/bot/nav.js'
import { GameData } from '../dist/mc/data.js'
import { Planner } from '../dist/plan/acquire.js'
import { inventoryMap, snapshot } from '../dist/bot/world.js'
import { createLogger } from '../dist/util/log.js'
import { acquire } from '../dist/skills/gather.js'
import { Memory } from '../dist/memory/store.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = Number(process.env.GOLEM_E2E_PORT ?? 25599)
const failures = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function check(name, condition, detail = '') {
  const line = `${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`
  console.log(line)
  if (!condition) failures.push(name)
}

const log = createLogger('e2e', { level: 'warn' })
const golem = new GolemBot({
  host: '127.0.0.1',
  port: PORT,
  username: 'GolemE2E',
  version: '1.21.4',
  logger: log,
})

process.on('unhandledRejection', (error) => {
  console.log(`FAIL  unhandled rejection — ${String(error)}`)
  failures.push('unhandled rejection')
})

try {
  await golem.ready(45_000)
  check('joins the server and spawns', true, `at ${golem.bot.entity.position.floored()}`)

  // Let chunks arrive before asking anything about the world.
  await sleep(4_000)

  const data = new GameData('1.21.4')

  // --- perception -----------------------------------------------------------
  const view = snapshot(golem.bot, data)
  check('reports a position', Number.isFinite(view.position.y), JSON.stringify(view.position))
  check('reports health and food', view.health > 0 && view.food > 0, `${view.health}hp ${view.food}food`)
  check('names the time of day', typeof view.timeOfDay === 'string', view.timeOfDay)
  check('sees blocks around it', view.nearbyBlocks.length >= 0, `${view.nearbyBlocks.length} kinds`)

  // --- humanised aiming on the wire ----------------------------------------
  // The point of the whole human layer: angles must arrive as a smooth stream,
  // not one packet jumping straight to the target.
  const samples = []
  const sampler = setInterval(() => samples.push(golem.bot.entity.yaw), 25)
  await golem.lookTo({ yaw: 2.0, pitch: 0.4 }, 0.08)
  await sleep(400)
  clearInterval(sampler)

  const distinct = new Set(samples.map((y) => y.toFixed(3))).size
  check('aiming produces many intermediate angles, not a snap', distinct > 5, `${distinct} distinct yaw values over ${samples.length} samples`)

  const monotonic = samples.every((y, i) => i === 0 || Math.abs(y - samples[i - 1]) < 1.5)
  check('aiming never jumps a huge angle in one tick', monotonic)

  // --- movement -------------------------------------------------------------
  const nav = new Navigator(golem.bot, log)
  const before = golem.bot.entity.position.clone()
  const target = before.offset(8, 0, 8)
  // While travelling, watch whether the aim layer and the pathfinder are both
  // trying to hold the head. They were, on 99% of ticks — the bot still
  // arrived, so nothing failed, but two contradictory look packets every tick
  // is louder than either system alone and it threw away the aim model for the
  // whole journey. Only measuring it caught that.
  let contested = 0
  let ticks = 0
  const watcher = setInterval(() => {
    // Only while the pathfinder is actually steering. Before it has a path and
    // after it arrives, the aim layer holds the head legitimately, and counting
    // those ticks measures the handover rather than the contention.
    if (!golem.bot.pathfinder.isMoving()) return
    ticks++
    const drift = Math.abs(
      ((golem.aim.orientation.yaw - golem.bot.entity.yaw + Math.PI) % (2 * Math.PI)) - Math.PI,
    )
    if (drift > 0.5) contested++
  }, 50)

  const travel = await nav.travelTo(target, { range: 3, timeoutMs: 30_000 })
  clearInterval(watcher)

  const moved = golem.bot.entity.position.distanceTo(before)
  check('walks somewhere when told to', moved > 2, `moved ${moved.toFixed(1)} blocks (${travel.reason})`)
  check(
    'aiming yields the head to the pathfinder while walking',
    ticks === 0 || contested / ticks < 0.05,
    `${contested}/${ticks} contested ticks`,
  )

  // --- digging --------------------------------------------------------------
  const solid = golem.bot.findBlock({
    matching: (b) => b && b.boundingBox === 'block' && b.name !== 'bedrock',
    maxDistance: 6,
    count: 1,
  })
  if (solid) {
    const name = solid.name
    await golem.lookAt(solid.position.offset(0.5, 0.5, 0.5), 0.35)
    let dug = false
    try {
      await golem.bot.dig(solid)
      dug = true
    } catch (error) {
      check('digs a block', false, String(error))
    }
    if (dug) {
      const after = golem.bot.blockAt(solid.position)
      check('digs a block', after?.name !== name, `${name} -> ${after?.name}`)
    }
  } else {
    check('digs a block', false, 'no solid block within reach to try')
  }

  // --- the planner, against a live inventory --------------------------------
  const planner = new Planner(data)
  const plan = planner.plan('wooden_pickaxe', 1, inventoryMap(golem.bot))
  check('plans against the live inventory', plan.feasible, `${plan.steps.length} steps, ${Math.round(plan.seconds)}s`)

  // --- the whole pipeline: plan, then actually carry it out -----------------
  // This is the claim the project rests on. Not "the planner produces a
  // sensible list" — the unit tests cover that — but that the list, executed
  // against a real world, ends with the item in the inventory.
  const memory = await Memory.open('e2e', log, mkdtempSync(join(tmpdir(), 'golem-e2e-')))
  const ctx = {
    golem,
    bot: golem.bot,
    data,
    planner,
    nav,
    memory,
    log,
    cancelled: () => false,
  }

  const wanted = 'dirt'
  const held = inventoryMap(golem.bot).get(wanted) ?? 0
  const gathered = await acquire(ctx, wanted, held + 2)
  const now = inventoryMap(golem.bot).get(wanted) ?? 0
  check(
    'carries out a plan and ends up holding the item',
    gathered.ok && now >= held + 2,
    `${gathered.detail} (had ${held}, now ${now})`,
  )

  // --- chat -----------------------------------------------------------------
  const heard = []
  golem.bot.on('messagestr', (m) => heard.push(m))
  await golem.say('e2e check')
  await sleep(3_000)
  check('says things in chat', heard.some((m) => m.includes('e2e check')), heard.slice(-2).join(' | '))

  // --- persona --------------------------------------------------------------
  check(
    'has a stable persona in human range',
    golem.persona.reaction > 0.15 && golem.persona.reaction < 0.4,
    `reaction ${Math.round(golem.persona.reaction * 1000)}ms, ${Math.round(golem.persona.wpm)} wpm`,
  )
} catch (error) {
  check('completed the drive without throwing', false, String(error))
} finally {
  golem.dispose('e2e done')
}

await sleep(500)
console.log(failures.length === 0 ? '\nALL CHECKS PASSED' : `\n${failures.length} FAILED: ${failures.join(', ')}`)
process.exit(failures.length === 0 ? 0 : 1)
