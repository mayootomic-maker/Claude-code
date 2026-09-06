/**
 * The system prompt.
 *
 * Kept deliberately short. The long, careful prompt is the usual response to an
 * agent behaving badly, and it is usually the wrong one — most of what such a
 * prompt tries to enforce ("check you have the ingredients", "get a pickaxe
 * first") is enforced properly by the planner, which cannot forget. What is
 * left here is only the part that genuinely needs judgement.
 */

import type { WorldSnapshot } from '../bot/world.js'

export const SYSTEM_PROMPT = `You are playing Minecraft. You control a character in the world and you talk to the person who owns it.

How you work:
- The "acquire" tool solves the whole dependency tree for an item by itself — mining, smelting, crafting, and building the tools it needs first. Just ask for what you want. Do not decompose it into mining and crafting steps yourself; you will do it worse.
- Use "plan" to check what something would cost before committing to it, and to answer questions about what it would take.
- Call "look_around" when you need to know the current state. Do not guess at your inventory or position.
- When you are finished, or when you cannot finish, call "done" with a one-line summary.

How you behave:
- You are a person playing a game, not a service. Talk like one in chat: short, casual, lowercase is fine. Do not narrate every action or list your steps back.
- Say something when it is worth saying — you found something good, something went wrong, you are heading somewhere. Not otherwise.
- Survival comes first. If you are about to die, deal with that before the task. The code handles immediate reflexes; you handle the judgement calls.
- If a task is ambiguous, pick the sensible reading and get on with it. Ask only when the readings genuinely differ.
- If something is impossible, say so plainly and say why. Do not substitute a different task and report success.`

/** The current situation, rendered as the briefing a player would give. */
export function describeSituation(view: WorldSnapshot): string {
  const lines: string[] = []

  lines.push(
    `You are at ${view.position.x}, ${view.position.y}, ${view.position.z} in the ${view.dimension} (${view.biome}).`,
  )
  lines.push(
    `Health ${view.health}/20, food ${view.food}/20. It is ${view.timeOfDay}${view.raining ? ' and raining' : ''}. Light level ${view.lightLevel}.`,
  )

  lines.push(
    view.inventory.length > 0
      ? `Carrying: ${view.inventory.map((i) => `${i.count} ${i.item}`).join(', ')}.`
      : 'Carrying nothing.',
  )

  if (view.equipped.hand) lines.push(`Holding ${view.equipped.hand}.`)
  if (view.equipped.armour.length > 0) lines.push(`Wearing ${view.equipped.armour.join(', ')}.`)

  if (view.nearbyBlocks.length > 0) {
    lines.push(
      `Nearby: ${view.nearbyBlocks.map((b) => `${b.block} (${b.count}, ${b.nearest}m)`).join(', ')}.`,
    )
  }
  if (view.threats.length > 0) {
    lines.push(`Hostile: ${view.threats.map((t) => `${t.name} at ${t.distance}m`).join(', ')}.`)
  } else if (view.nearbyEntities.length > 0) {
    lines.push(
      `Mobs: ${view.nearbyEntities.slice(0, 6).map((e) => `${e.count} ${e.name} (${e.distance}m)`).join(', ')}.`,
    )
  }
  if (view.players.length > 0) {
    lines.push(
      `Players: ${view.players.map((p) => (p.distance === null ? p.name : `${p.name} (${p.distance}m)`)).join(', ')}.`,
    )
  }

  return lines.join('\n')
}

/** A short reminder of what happened recently, so the model has continuity. */
export function describeHistory(
  episodes: ReadonlyArray<{ task: string; outcome: string; detail: string }>,
): string {
  if (episodes.length === 0) return ''
  const lines = episodes.map((e) => `- ${e.task}: ${e.outcome} (${e.detail})`)
  return `Recently:\n${lines.join('\n')}`
}
