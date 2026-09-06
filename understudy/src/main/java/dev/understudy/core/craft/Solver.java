package dev.understudy.core.craft;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.PriorityQueue;
import java.util.Set;

/**
 * How long it takes to get one of everything, given what you already have.
 *
 * This is Knuth's generalisation of Dijkstra to hypergraphs, and the shape of
 * the problem forces it. "Cheapest way to obtain X" is not a shortest path,
 * because a recipe needs *all* of its inputs, not the cheapest one — so the cost
 * of an output depends on a sum over a set, and a plain graph search cannot
 * express that.
 *
 * Getting here took three attempts, and the two failures are worth recording
 * because both look reasonable:
 *
 *   Recursion with no cache was exponential — shared ingredients like sticks
 *   were re-derived down every branch that needed them.
 *
 *   Recursion with a cache was wrong. The cost of an item depends on what is
 *   already in hand, so a value computed while holding three planks is not
 *   valid once they are spent. Keying the cache by context turned every lookup
 *   into a fresh subtree, and a value computed under one context leaked into
 *   another: that is how a shield came out costing fifteen minutes because iron
 *   was, apparently, free.
 *
 * Knuth's algorithm has neither problem. Costs only ever decrease toward their
 * final value, each item is settled exactly once in increasing order, and a
 * recipe is only ever evaluated after every one of its inputs is already final.
 * There is nothing to cache and nothing to invalidate.
 */
public final class Solver {

    public static final double UNREACHABLE = Double.POSITIVE_INFINITY;

    /** What it costs to obtain one of an item, and the step that achieves it. */
    public record Cost(double seconds, Recipe viaRecipe, Gather viaGather) {
        public boolean reachable() {
            return seconds < UNREACHABLE;
        }
    }

    private final List<Recipe> recipes;
    private final Map<String, Gather> gathers;

    public Solver(List<Recipe> recipes, List<Gather> gathers) {
        this.recipes = List.copyOf(recipes);
        Map<String, Gather> byItem = new HashMap<>();
        // Cheapest way to gather wins when a thing drops from more than one block.
        for (Gather gather : gathers) {
            Gather existing = byItem.get(gather.item());
            if (existing == null || gather.perUnit() < existing.perUnit()) byItem.put(gather.item(), gather);
        }
        this.gathers = Map.copyOf(byItem);
    }

    /**
     * Solve for everything reachable.
     *
     * @param have items already in hand, which cost nothing to obtain
     */
    public Map<String, Cost> solve(Map<String, Integer> have) {
        Map<String, Cost> best = new HashMap<>();
        PriorityQueue<Entry> queue = new PriorityQueue<>();
        Set<String> settled = new HashSet<>();

        for (Map.Entry<String, Integer> held : have.entrySet()) {
            if (held.getValue() > 0) offer(best, queue, held.getKey(), new Cost(0, null, null));
        }

        // Gathering with bare hands is available from the start. Anything that
        // needs a tool has to wait until the tool's own cost is known, so it is
        // relaxed later, from the tool.
        for (Gather gather : gathers.values()) {
            if (gather.tool() == null) {
                offer(best, queue, gather.item(), new Cost(gather.perUnit(), null, gather));
            }
        }

        // How many inputs of each recipe are still unsettled, so a recipe is
        // only costed once every one of them is final.
        Map<Recipe, Integer> pending = new HashMap<>();
        Map<String, List<Recipe>> usedBy = new HashMap<>();
        Map<String, List<Gather>> toolFor = new HashMap<>();
        for (Recipe recipe : recipes) {
            pending.put(recipe, recipe.inputs().size());
            for (String input : recipe.inputs().keySet()) {
                usedBy.computeIfAbsent(input, key -> new ArrayList<>()).add(recipe);
            }
        }
        for (Gather gather : gathers.values()) {
            if (gather.tool() != null) {
                toolFor.computeIfAbsent(gather.tool(), key -> new ArrayList<>()).add(gather);
            }
        }

        while (!queue.isEmpty()) {
            Entry entry = queue.poll();
            if (!settled.add(entry.item)) continue;

            // A tool becoming available makes everything it mines available,
            // at the gather time plus the tool's share of its own durability.
            for (Gather gather : toolFor.getOrDefault(entry.item, List.of())) {
                double amortised = entry.cost / Math.max(1, gather.toolUses());
                offer(best, queue, gather.item(),
                        new Cost(gather.perUnit() + amortised, null, gather));
            }

            for (Recipe recipe : usedBy.getOrDefault(entry.item, List.of())) {
                if (pending.merge(recipe, -1, Integer::sum) != 0) continue;

                double total = recipe.seconds();
                for (Map.Entry<String, Integer> input : recipe.inputs().entrySet()) {
                    Cost inputCost = best.get(input.getKey());
                    if (inputCost == null || !inputCost.reachable()) {
                        total = UNREACHABLE;
                        break;
                    }
                    total += inputCost.seconds() * input.getValue();
                }
                if (total < UNREACHABLE) {
                    offer(best, queue, recipe.output(),
                            new Cost(total / recipe.count(), recipe, null));
                }
            }
        }
        return best;
    }

    private static void offer(Map<String, Cost> best, PriorityQueue<Entry> queue,
                              String item, Cost cost) {
        Cost existing = best.get(item);
        if (existing != null && existing.seconds() <= cost.seconds()) return;
        best.put(item, cost);
        queue.add(new Entry(item, cost.seconds()));
    }

    private record Entry(String item, double cost) implements Comparable<Entry> {
        @Override
        public int compareTo(Entry other) {
            return Double.compare(cost, other.cost);
        }
    }
}
