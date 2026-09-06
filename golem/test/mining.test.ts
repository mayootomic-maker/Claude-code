import { describe, expect, it } from 'vitest'
import { GameData } from '../src/mc/data.js'
import { bestHeldTool, canHarvest, digTimeTicks, toolRequirement } from '../src/mc/mining.js'

const data = new GameData('1.21.4')
const block = (name: string) => {
  const b = data.block(name)
  if (!b) throw new Error(`no block ${name}`)
  return b
}

describe('dig time matches vanilla', () => {
  // Reference values are the in-game break times every Minecraft player knows
  // by feel. Ticks = seconds * 20.
  const cases: Array<[string, string | null, number, string]> = [
    ['stone', 'wooden_pickaxe', 23, '1.15s'],
    ['stone', 'stone_pickaxe', 12, '0.60s'],
    ['stone', 'iron_pickaxe', 8, '0.40s'],
    ['stone', 'diamond_pickaxe', 6, '0.30s'],
    ['stone', 'netherite_pickaxe', 5, '0.25s'],
    ['stone', 'golden_pickaxe', 4, '0.20s'],
    ['obsidian', 'diamond_pickaxe', 188, '9.4s'],
    ['obsidian', 'netherite_pickaxe', 167, '8.35s'],
    ['oak_log', 'iron_axe', 10, '0.50s'],
    ['dirt', 'iron_shovel', 3, '0.15s'],
    ['dirt', null, 15, '0.75s bare-handed'],
  ]

  for (const [blockName, tool, ticks, note] of cases) {
    it(`${blockName} with ${tool ?? 'bare hands'} takes ${ticks} ticks (${note})`, () => {
      expect(digTimeTicks(data, block(blockName), tool)).toBe(ticks)
    })
  }

  it('charges the 3.33x penalty for a tool that cannot harvest', () => {
    // Stone bare-handed: speed 1 / hardness 1.5 / 100 -> 150 ticks, 7.5s.
    expect(digTimeTicks(data, block('stone'), null)).toBe(150)
  })

  it('treats a wrong-class tool as no better than a bare hand', () => {
    expect(digTimeTicks(data, block('stone'), 'diamond_shovel')).toBe(
      digTimeTicks(data, block('stone'), null),
    )
  })

  it('never returns a finite time for bedrock', () => {
    expect(digTimeTicks(data, block('bedrock'), 'netherite_pickaxe')).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('harvest gating', () => {
  it('knows diamond ore needs iron or better', () => {
    const ore = block('deepslate_diamond_ore')
    expect(toolRequirement(data, ore)).toEqual({ toolClass: 'pickaxe', minTier: 'iron' })
    expect(canHarvest(data, ore, 'stone_pickaxe')).toBe(false)
    expect(canHarvest(data, ore, 'iron_pickaxe')).toBe(true)
    expect(canHarvest(data, ore, 'diamond_pickaxe')).toBe(true)
  })

  it('does not let a golden pickaxe harvest diamonds despite its higher speed', () => {
    // Gold has the highest raw speed of any tier but sits at harvest level 0.
    // Sorting the tier list by speed rather than harvest level would break
    // exactly this. Note it ends up *slower* than iron here too: failing to
    // harvest costs a 3.33x penalty that its speed advantage cannot cover.
    const ore = block('deepslate_diamond_ore')
    expect(canHarvest(data, ore, 'golden_pickaxe')).toBe(false)
    expect(digTimeTicks(data, ore, 'golden_pickaxe')).toBeGreaterThan(
      digTimeTicks(data, ore, 'iron_pickaxe'),
    )
    // On a block gold *can* harvest, its speed does win.
    expect(digTimeTicks(data, block('stone'), 'golden_pickaxe')).toBeLessThan(
      digTimeTicks(data, block('stone'), 'iron_pickaxe'),
    )
  })

  it('lets anything harvest a block with no tool requirement', () => {
    expect(canHarvest(data, block('dirt'), null)).toBe(true)
    expect(canHarvest(data, block('oak_log'), null)).toBe(true)
  })
})

describe('tool selection from inventory', () => {
  it('prefers the fastest harvesting tool held', () => {
    const held = ['wooden_pickaxe', 'stone_pickaxe', 'diamond_shovel', 'stick']
    expect(bestHeldTool(data, block('stone'), held)).toBe('stone_pickaxe')
  })

  it('prefers a slow tool that harvests over a fast one that does not', () => {
    // Iron mines diamond ore slower than gold, but gold drops nothing.
    const held = ['golden_pickaxe', 'iron_pickaxe']
    expect(bestHeldTool(data, block('deepslate_diamond_ore'), held)).toBe('iron_pickaxe')
  })

  it('returns null when bare hands are as good as anything held', () => {
    expect(bestHeldTool(data, block('dirt'), ['stick', 'apple'])).toBe(null)
  })
})
