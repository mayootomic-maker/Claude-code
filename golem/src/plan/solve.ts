/**
 * Optimal acquisition costs, by Knuth's generalisation of Dijkstra.
 *
 * The first version of this searched depth-first with a cycle guard, and the
 * guard was the problem: whether a route looked possible depended on what was
 * already on the stack when you asked. Iron priced during a stone-pickaxe
 * expansion is infinite — correctly, since you cannot bootstrap a stone pickaxe
 * out of iron that needs one — but that infinity leaked into the cache, deleted
 * smelting from the options for iron, and left the planner concluding that the
 * way to get an ingot is to go and fight an iron golem. Not caching at all
 * fixed the correctness and made the search exponential instead.
 *
 * The mistake was the algorithm, not the cache. Obtaining an item is a
 * shortest-path problem over a hypergraph: items are nodes, sources are edges
 * with several tails, and a source's cost is its own overhead plus its inputs'.
 * That cost is monotone in its inputs, which is exactly the condition under
 * which Knuth's 1977 generalisation of Dijkstra applies.
 *
 * So: settle items in increasing order of cost. A source becomes usable the
 * moment its last input settles, and it can only ever produce something dearer
 * than every input it consumes. Cycles need no special handling at all — making
 * iron out of iron blocks made of iron cannot be cheaper than the iron it
 * started from, so it never wins. One pass prices every item in the game.
 */

import type { GameData } from '../mc/data.js'
import { buildSources, type Source, type SourceOptions } from './sources.js'

export interface CostTable {
  /** Item name -> seconds to obtain one, or absent if unobtainable. */
  readonly cost: ReadonlyMap<string, number>
  /** Item name -> the source that achieves that cost. */
  readonly via: ReadonlyMap<string, Source>
  /** Settle order. A source's inputs always settle before its output. */
  readonly order: ReadonlyMap<string, number>
  /** Every source per output item, kept so failures can be explained. */
  readonly sourcesFor: ReadonlyMap<string, readonly Source[]>
}

/**
 * The items actually responsible for an item being unobtainable.
 *
 * Reporting the goal ("cannot make a beacon") is useless; reporting the leaves
 * ("cannot obtain a nether star") tells the caller what to go and solve. Walks
 * back through the sources that would have produced the item and collects the
 * dependencies that themselves have no cost.
 */
export function blockers(table: CostTable, itemName: string, seen = new Set<string>()): string[] {
  if (table.cost.has(itemName)) return []
  if (seen.has(itemName)) return []
  seen.add(itemName)

  const sources = table.sourcesFor.get(itemName) ?? []
  if (sources.length === 0) return [itemName]

  const found = new Set<string>()
  for (const source of sources) {
    for (const dep of source.deps) {
      if (table.cost.has(dep.item)) continue
      for (const leaf of blockers(table, dep.item, seen)) found.add(leaf)
    }
  }
  // Every route was blocked by something, but nothing deeper was identifiable:
  // the item itself is the honest answer.
  return found.size > 0 ? [...found] : [itemName]
}

/**
 * Price every item in the game at once.
 *
 * Doing the whole table costs about the same as doing one item — the work is
 * dominated by building the source list — and it means the agent can answer
 * "what can I make from here?" without another pass.
 */
export function solveCosts(data: GameData, options: SourceOptions = {}): CostTable {
  const sources = buildSources(data, options)

  // Reverse index: which sources are waiting on each item.
  const waiting = new Map<string, Source[]>()
  const remaining = new Map<Source, number>()
  const heap = new MinHeap()
  const cost = new Map<string, number>()
  const via = new Map<string, Source>()
  const order = new Map<string, number>()
  const sourcesFor = new Map<string, Source[]>()

  for (const source of sources) {
    const bucket = sourcesFor.get(source.output)
    if (bucket) bucket.push(source)
    else sourcesFor.set(source.output, [source])
    // A source may name the same input twice; it is one dependency to wait on.
    const distinct = new Set(source.deps.map((d) => d.item))
    remaining.set(source, distinct.size)
    for (const item of distinct) {
      const list = waiting.get(item)
      if (list) list.push(source)
      else waiting.set(item, [source])
    }
    // Sources with no inputs are the seeds: mining a block bare-handed, killing
    // a mob. Everything else is reached from these.
    if (distinct.size === 0) heap.push(source.output, source.overhead / source.batch, source)
  }

  let settled = 0
  while (heap.size > 0) {
    const top = heap.pop()
    if (!top) break
    if (cost.has(top.item)) continue // already settled at a lower cost

    cost.set(top.item, top.cost)
    via.set(top.item, top.source)
    order.set(top.item, settled++)

    for (const source of waiting.get(top.item) ?? []) {
      const left = (remaining.get(source) ?? 0) - 1
      remaining.set(source, left)
      if (left > 0) continue
      if (cost.has(source.output)) continue
      const unit = priceOf(source, cost)
      if (Number.isFinite(unit)) heap.push(source.output, unit, source)
    }
  }

  return { cost, via, order, sourcesFor }
}

/** Seconds per unit of output, given that every input has settled. */
function priceOf(source: Source, cost: ReadonlyMap<string, number>): number {
  let total = source.overhead
  for (const dep of source.deps) {
    const each = cost.get(dep.item)
    if (each === undefined) return Number.POSITIVE_INFINITY
    total += each * dep.perBatch
  }
  return total / source.batch
}

/**
 * A binary min-heap keyed on cost.
 *
 * Written out rather than pulled in: it is thirty lines, and the alternative is
 * a dependency on the hot path of the one thing this project has to be fast at.
 */
class MinHeap {
  private readonly items: Array<{ item: string; cost: number; source: Source }> = []

  get size(): number {
    return this.items.length
  }

  push(item: string, cost: number, source: Source): void {
    this.items.push({ item, cost, source })
    let i = this.items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.items[parent]!.cost <= this.items[i]!.cost) break
      this.swap(i, parent)
      i = parent
    }
  }

  pop(): { item: string; cost: number; source: Source } | undefined {
    const top = this.items[0]
    const last = this.items.pop()
    if (this.items.length > 0 && last) {
      this.items[0] = last
      let i = 0
      for (;;) {
        const left = 2 * i + 1
        const right = left + 1
        let smallest = i
        if (left < this.items.length && this.items[left]!.cost < this.items[smallest]!.cost) smallest = left
        if (right < this.items.length && this.items[right]!.cost < this.items[smallest]!.cost) smallest = right
        if (smallest === i) break
        this.swap(i, smallest)
        i = smallest
      }
    }
    return top
  }

  private swap(a: number, b: number): void {
    const tmp = this.items[a]!
    this.items[a] = this.items[b]!
    this.items[b] = tmp
  }
}
