/**
 * Going places, and looking for things that are not in sight yet.
 */

import { Vec3 } from 'vec3'
import { sleep } from '../bot/bot.js'
import { checkCancelled, fail, ok, type SkillContext, type SkillResult } from './types.js'

export async function goTo(
  ctx: SkillContext,
  x: number,
  y: number,
  z: number,
  range = 2,
): Promise<SkillResult> {
  const target = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z))
  await ctx.golem.gate('normal')
  const travel = await ctx.nav.travelTo(target, { range })
  return travel.arrived
    ? ok(`arrived at ${format(target)}`)
    : fail(`could not get to ${format(target)}: ${travel.reason}`, { reason: travel.reason })
}

/** Walk to a place the bot has been told the name of. */
export async function goToPlace(ctx: SkillContext, name: string): Promise<SkillResult> {
  const place = ctx.memory.place(name)
  if (!place) {
    const known = ctx.memory.places().map((p) => p.name)
    return fail(
      known.length > 0
        ? `no place called "${name}" — I know: ${known.join(', ')}`
        : `no place called "${name}", and I have not saved any yet`,
    )
  }
  return goTo(ctx, place.position.x, place.position.y, place.position.z, 2)
}

export async function follow(ctx: SkillContext, playerName: string, range = 3): Promise<SkillResult> {
  const player = ctx.bot.players[playerName]
  if (!player?.entity) return fail(`cannot see ${playerName}`)
  const travel = await ctx.nav.follow(player.entity.id, range, 20_000)
  return travel.arrived ? ok(`following ${playerName}`) : fail(`lost ${playerName}: ${travel.reason}`)
}

/**
 * Wander outward looking for something.
 *
 * Walks a widening spiral rather than a straight line, because a straight line
 * out of a cave system usually ends against the same wall repeatedly, and
 * because a bot that only ever walks due north is conspicuous. Stops the
 * instant the target block or entity comes into range.
 */
export async function explore(
  ctx: SkillContext,
  options: {
    readonly lookingFor?: string
    readonly maxDistance?: number
    readonly legs?: number
  } = {},
): Promise<SkillResult> {
  const maxDistance = options.maxDistance ?? 256
  const legs = options.legs ?? 8
  const origin = ctx.bot.entity.position.clone()
  const wanted = options.lookingFor ? ctx.data.block(options.lookingFor) : null

  // A golden-angle spiral: successive headings are maximally spread out, so
  // the bot covers new ground rather than re-treading a quadrant.
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))

  for (let leg = 1; leg <= legs; leg++) {
    checkCancelled(ctx)
    if (wanted) {
      const found = ctx.bot.findBlock({ matching: wanted.id, maxDistance: 96, count: 1 })
      if (found) {
        ctx.memory.sawBlock(wanted.name, found.position, ctx.bot.entity.position)
        return ok(`found ${wanted.name} at ${format(found.position)}`, {
          found: wanted.name,
          position: found.position,
        })
      }
    }

    const angle = leg * goldenAngle
    const distance = Math.min((leg / legs) * maxDistance, maxDistance)
    const destination = origin.offset(
      Math.cos(angle) * distance,
      0,
      Math.sin(angle) * distance,
    )

    await ctx.golem.gate('normal')
    const travel = await ctx.nav.travelTo(destination, { range: 6, timeoutMs: 45_000 })
    if (!travel.arrived && travel.reason === 'no-path') continue

    // Look around on arrival, the way a person orienting themselves would.
    if (ctx.golem.rhythm.wantsToFidget()) await ctx.golem.glanceAround()
  }

  return options.lookingFor
    ? fail(`explored ${legs} legs without finding ${options.lookingFor}`)
    : ok(`explored around ${format(origin)}`)
}

/** Stand still for a while. Used for waiting out the night or a break. */
export async function idle(ctx: SkillContext, seconds: number): Promise<SkillResult> {
  const deadline = Date.now() + seconds * 1000
  while (Date.now() < deadline) {
    checkCancelled(ctx)
    if (ctx.golem.rhythm.wantsToFidget()) await ctx.golem.glanceAround()
    await sleep(1_000)
  }
  return ok(`waited ${Math.round(seconds)}s`)
}

function format(v: { x: number; y: number; z: number }): string {
  return `${Math.round(v.x)}, ${Math.round(v.y)}, ${Math.round(v.z)}`
}
