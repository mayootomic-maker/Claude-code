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
 *
 * One thing it deliberately does not decide: which tool to mine with. Amortising
 * a pickaxe over its durability makes "deepslate with a stone pickaxe" cost less
 * per block than the stone pickaxe itself, and an edge cheaper than its own
 * input breaks the ordering the algorithm depends on. It is also genuinely not a
 * per-block question — wood is right for eight blocks and stone for six hundred
 * — so it belongs where the quantity is known, in the planner. What comes out of
 * here is the cost with the cheapest tool that works, which is the right
 * estimate for everything upstream.
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
    private final List<Gather> gathers;

    public Solver(List<Recipe> recipes, List<Gather> gathers) {
        this.recipes = List.copyOf(recipes);
        // Every way of getting a thing is kept, not just the one that looks
        // cheapest to dig. Which is actually cheapest depends on the tool: a
        // stone pickaxe halves the time on deepslate but costs more to make, and
        // whether that pays back depends on how much you are mining. Keeping
        // both and letting the search decide is the whole point of the search —
        // picking one here was choosing ten wooden pickaxes over one stone one.
        this.gathers = List.copyOf(gathers);
    }

    /**
     * Every way of gathering an item, cheapest per block first.
     *
     * The planner needs these rather than one winner, because which tool is
     * right depends on how much you are mining and the solver works in per-block
     * costs that cannot know that. See Planner.bestGather.
     */
    public List<Gather> gathersFor(String item) {
        List<Gather> found = new ArrayList<>();
        for (Gather gather : gathers) if (gather.item().equals(item)) found.add(gather);
        found.sort((a, b) -> Double.compare(a.perUnit(), b.perUnit()));
        return found;
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
            if (held.getValue() > 0) offer(best, queue, settled, held.getKey(), new Cost(0, null, null));
        }

        // Gathering with bare hands is available from the start. Anything that
        // needs a tool has to wait until the tool's own cost is known, so it is
        // relaxed later, from the tool.
        for (Gather gather : gathers) {
            if (gather.tool() == null) {
                offer(best, queue, settled, gather.item(), new Cost(gather.perUnit(), null, gather));
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
        for (Gather gather : gathers) {
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
                offer(best, queue, settled, gather.item(),
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
                    offer(best, queue, settled, recipe.output(),
                            new Cost(total / recipe.count(), recipe, null));
                }
            }
        }
        return best;
    }

    /**
     * Record a way of getting something, if it beats the way already known.
     *
     * A settled item is finished and must not be touched again, and that guard
     * is not a nicety. Without it, a later, cheaper-looking route overwrites the
     * provenance of an item whose cost is already final — which is how the
     * planner came to believe the best way to get cobblestone was to mine it
     * with a stone pickaxe, a stone pickaxe being made of cobblestone. The
     * algorithm's ordering guarantee only holds if what it has settled stays
     * settled; the cost was right and the story of where it came from was not.
     */
    private static void offer(Map<String, Cost> best, PriorityQueue<Entry> queue,
                              Set<String> settled, String item, Cost cost) {
        if (settled.contains(item)) return;
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
