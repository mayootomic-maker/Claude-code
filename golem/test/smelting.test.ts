import { describe, expect, it } from 'vitest'
import { GameData } from '../src/mc/data.js'
import { FUELS, PREFERRED_FUELS, SMELT_RECIPES, smeltRecipesFor } from '../src/mc/smelting.js'

const data = new GameData('1.21.4')

describe('the hand-written smelting table stays in sync with the game', () => {
  // This table is the one piece of game knowledge not read from minecraft-data,
  // so it is the one piece that can silently drift. These assertions are the
  // guard: a renamed or removed item fails the build rather than making the
  // planner quietly unable to smelt.
  it('resolves every smelting input and output to a real item', () => {
    const unknown: string[] = []
    for (const recipe of SMELT_RECIPES) {
      if (!data.item(recipe.input)) unknown.push(`input ${recipe.input}`)
      if (!data.item(recipe.output)) unknown.push(`output ${recipe.output}`)
    }
    expect(unknown).toEqual([])
  })

  it('resolves every fuel to a real item', () => {
    const unknown = Object.keys(FUELS).filter((name) => !data.item(name))
    expect(unknown).toEqual([])
  })

  it('lists only real items as preferred fuels, all of which are fuels', () => {
    for (const name of PREFERRED_FUELS) {
      expect(data.item(name), name).not.toBeNull()
      expect(FUELS[name], name).toBeGreaterThan(0)
    }
  })

  it('covers the smelt the planner most depends on', () => {
    const iron = smeltRecipesFor('iron_ingot')
    expect(iron.map((r) => r.input)).toContain('raw_iron')
  })

  it('produces no duplicate input/output pairs', () => {
    const seen = new Set<string>()
    for (const r of SMELT_RECIPES) {
      const key = `${r.input}->${r.output}`
      expect(seen.has(key), key).toBe(false)
      seen.add(key)
    }
  })
})
