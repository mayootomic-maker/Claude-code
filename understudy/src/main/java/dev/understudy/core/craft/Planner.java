package dev.understudy.core.craft;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Turns "I want these blocks" into "do these things, in this order".
 *
 * The Solver says what everything costs. This says what to actually do about
 * it: what is already in the chest, what is missing, what has to be gathered
 * first so the thing after it can be crafted, and which tools are needed to
 * gather any of it.
 *
 * Order comes out of the expansion itself. Working backwards from the goal and
 * finishing each item only once all of its inputs are finished is a post-order
 * walk, and a post-order walk of a dependency tree is a build order. Nothing
 * sorts anything afterwards.
 *
 * Quantities are totalled per item and emitted once, rather than in the order
 * the tree happened to ask for them. The first version emitted every branch
 * separately and produced "gather 1 oak_log, craft 4 oak_planks" six times over,
 * which is a correct plan and a useless one: nobody walks back to the same tree
 * six times. Merging only adjacent steps did not fix it, because the repeats
 * were separated by the crafts in between. Totalling first is what actually
 * works, and it is safe: an item's first completion already comes after all of
 * its inputs' first completions, so gathering everything at that point cannot
 * put a step before something it needs.
 *
 * What is in hand is spent as the plan is built, so asking for two doors when
 * you already have six planks gathers one log rather than two — the second door
 * sees an inventory the first one has already drawn down.
 */
public final class Planner {

    public sealed interface Action permits Collect, Make {
        double seconds();
        String describe();
    }

    /** Break blocks, or find the animal. */
    public record Collect(String item, int count, double seconds, String tool) implements Action {
        @Override
        public String describe() {
            return "gather " + count + " " + item + (tool == null ? "" : " (needs " + tool + ")");
        }
    }

    /** Craft or smelt. */
    public record Make(String item, int count, int batches, Recipe recipe, double seconds)
            implements Action {
        @Override
        public String describe() {
            String verb = recipe.station() == Recipe.Station.FURNACE ? "smelt" : "craft";
            return verb + " " + count + " " + item;
        }
    }

    public record Plan(List<Action> actions, Map<String, Integer> shortfall, double seconds) {
        public boolean possible() {
            return shortfall.isEmpty();
        }

        /** Steps a person would read, not a dump of the tree. */
        public List<String> summary() {
            List<String> lines = new ArrayList<>();
            for (Action action : actions) lines.add(action.describe());
            return lines;
        }
    }

    private final Solver solver;

    public Planner(Solver solver) {
        this.solver = solver;
    }

    /**
     * Everything obtainable from nothing, sorted.
     *
     * Used for tab completion, so /get only ever offers things it can actually
     * fetch — a completion list that suggests something the mod then refuses is
     * worse than no completion at all.
     */
    public static java.util.List<String> obtainable() {
        return Catalogue.solver().solve(Map.of()).entrySet().stream()
                .filter(entry -> entry.getValue().reachable())
                .map(Map.Entry::getKey)
                .sorted()
                .toList();
    }

    /**
     * The blocks that drop an item.
     *
     * Static because the gatherer asks per tick and the answer never changes.
     * Iron comes out of both iron_ore and deepslate_iron_ore, and a gatherer
     * that only knows the first walks past half the ore it sees.
     */
    public static java.util.List<String> sourcesOf(String item) {
        for (Gather gather : Catalogue.gathers()) {
            if (gather.item().equals(item)) return gather.from();
        }
        return java.util.List.of(item);
    }

    public Plan plan(Map<String, Integer> goal, Map<String, Integer> have) {
        Map<String, Solver.Cost> costs = solver.solve(have);
        Map<String, Integer> stock = new LinkedHashMap<>(have);
        Map<String, Integer> shortfall = new LinkedHashMap<>();
        // Insertion-ordered: the first time an item is finished fixes where its
        // one step goes, and every later demand for it adds to the same total.
        Map<String, Integer> produce = new LinkedHashMap<>();
        // Which variant was actually chosen, so the step that comes out names
        // the tool the plan really uses rather than the one the solver costed.
        Map<String, Gather> chosen = new LinkedHashMap<>();

        for (Map.Entry<String, Integer> want : goal.entrySet()) {
            obtain(want.getKey(), want.getValue(), costs, stock, produce, chosen, shortfall,
                    new HashSet<>());
        }

        List<Action> actions = new ArrayList<>();
        for (Map.Entry<String, Integer> made : produce.entrySet()) {
            Solver.Cost cost = costs.get(made.getKey());
            if (cost == null) continue;
            if (cost.viaGather() != null) {
                Gather gather = chosen.getOrDefault(made.getKey(), cost.viaGather());
                int blocks = ceilDiv(made.getValue(), gather.amount());
                actions.add(new Collect(made.getKey(), blocks * gather.amount(),
                        blocks * gather.seconds(), gather.tool()));
            } else if (cost.viaRecipe() != null) {
                Recipe recipe = cost.viaRecipe();
                int batches = ceilDiv(made.getValue(), recipe.count());
                actions.add(new Make(recipe.output(), batches * recipe.count(), batches,
                        recipe, batches * recipe.seconds()));
            }
        }

        double total = actions.stream().mapToDouble(Action::seconds).sum();
        return new Plan(actions, shortfall, total);
    }

    private void obtain(String item, int count, Map<String, Solver.Cost> costs,
                        Map<String, Integer> stock, Map<String, Integer> produce,
                        Map<String, Gather> chosen, Map<String, Integer> shortfall,
                        Set<String> underway) {
        int held = stock.getOrDefault(item, 0);
        int take = Math.min(held, count);
        stock.put(item, held - take);
        int missing = count - take;
        if (missing <= 0) return;

        Solver.Cost cost = costs.get(item);
        if (cost == null || !cost.reachable()) {
            shortfall.merge(item, missing, Integer::sum);
            return;
        }
        // The chosen recipe's inputs are always strictly cheaper than the output,
        // so this cannot loop. The guard is here because a data-entry mistake in
        // the catalogue should surface as a shortfall rather than a stack
        // overflow inside somebody's game.
        if (!underway.add(item)) {
            shortfall.merge(item, missing, Integer::sum);
            return;
        }

        if (cost.viaGather() != null) {
            Gather gather = bestGather(item, missing, costs, underway);
            // The dearer tool wins: two calls for the same item, one for three
            // blocks and one for six hundred, must not leave the plan claiming
            // the small one's tool was enough for both.
            Gather already = chosen.get(item);
            if (already == null || already.perUnit() > gather.perUnit()) chosen.put(item, gather);
            int blocks = ceilDiv(missing, gather.amount());
            if (gather.tool() != null) {
                // A pickaxe is worn out, not eaten. Enough of them to survive the
                // job, and the survivor goes back in the bag for the next one —
                // which is why asking for stone and then coal does not build two.
                int tools = ceilDiv(blocks, Math.max(1, gather.toolUses()));
                obtain(gather.tool(), tools, costs, stock, produce, chosen, shortfall, underway);
                credit(stock, gather.tool(), 1);
            }
            produce.merge(item, blocks * gather.amount(), Integer::sum);
            credit(stock, item, blocks * gather.amount() - missing);
        } else if (cost.viaRecipe() != null) {
            Recipe recipe = cost.viaRecipe();
            int batches = ceilDiv(missing, recipe.count());
            for (Map.Entry<String, Integer> input : recipe.inputs().entrySet()) {
                obtain(input.getKey(), input.getValue() * batches,
                        costs, stock, produce, chosen, shortfall, underway);
            }
            if (recipe.station() == Recipe.Station.CRAFTING_TABLE) {
                obtain("crafting_table", 1, costs, stock, produce, chosen, shortfall, underway);
                credit(stock, "crafting_table", 1); // used, not consumed
            }
            if (recipe.station() == Recipe.Station.FURNACE) {
                obtain("furnace", 1, costs, stock, produce, chosen, shortfall, underway);
                credit(stock, "furnace", 1);
            }
            produce.merge(item, batches * recipe.count(), Integer::sum);
            credit(stock, item, batches * recipe.count() - missing);
        }
        underway.remove(item);
    }

    /**
     * Which tool to mine this with, given how much of it is wanted.
     *
     * Not a per-block question, which is why the solver does not answer it. A
     * stone pickaxe costs three cobblestone to make and saves a second and a
     * half on every deepslate block: pointless for eight blocks, obviously worth
     * it for six hundred. So the whole job is costed each way — the digging plus
     * however many tools it wears out — and the cheaper one wins.
     *
     * A variant whose tool is already being obtained further up the stack is
     * skipped, which is what stops "mine cobblestone with a stone pickaxe" being
     * considered while working out how to make the stone pickaxe.
     */
    private Gather bestGather(String item, int wanted, Map<String, Solver.Cost> costs,
                              Set<String> underway) {
        List<Gather> options = solver.gathersFor(item);
        Gather best = null;
        double bestTotal = Double.MAX_VALUE;
        for (Gather option : options) {
            if (option.tool() != null && underway.contains(option.tool())) continue;
            // You cannot mine cobblestone with a pickaxe made of cobblestone.
            // Costing it looks fine — a stone pickaxe amortised over 131 blocks
            // is cheap — and it is nonsense, so the dependency is checked rather
            // than left to a cycle guard to catch further down. If the tool is
            // already in the chest its cost is zero and the walk stops there,
            // which is right: then you really can use it.
            if (option.tool() != null
                    && dependsOn(option.tool(), item, costs, new HashSet<>())) continue;
            int blocks = ceilDiv(wanted, option.amount());
            double total = blocks * option.seconds();
            if (option.tool() != null) {
                Solver.Cost toolCost = costs.get(option.tool());
                if (toolCost == null || !toolCost.reachable()) continue;
                total += ceilDiv(blocks, Math.max(1, option.toolUses())) * toolCost.seconds();
            }
            if (total < bestTotal) {
                bestTotal = total;
                best = option;
            }
        }
        return best == null ? options.get(0) : best;
    }

    /** Whether making one of these would, somewhere down the chain, need the other. */
    private static boolean dependsOn(String item, String target,
                                     Map<String, Solver.Cost> costs, Set<String> seen) {
        if (item.equals(target)) return true;
        if (!seen.add(item)) return false;
        Solver.Cost cost = costs.get(item);
        if (cost == null) return false;
        if (cost.viaRecipe() != null) {
            for (String input : cost.viaRecipe().inputs().keySet()) {
                if (dependsOn(input, target, costs, seen)) return true;
            }
        } else if (cost.viaGather() != null && cost.viaGather().tool() != null) {
            return dependsOn(cost.viaGather().tool(), target, costs, seen);
        }
        return false;
    }

    /** Leftovers from a batch stay available for whatever is planned next. */
    private static void credit(Map<String, Integer> stock, String item, int spare) {
        if (spare > 0) stock.merge(item, spare, Integer::sum);
    }

    private static int ceilDiv(int a, int b) {
        return (a + b - 1) / b;
    }
}
