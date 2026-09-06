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

    public Plan plan(Map<String, Integer> goal, Map<String, Integer> have) {
        Map<String, Solver.Cost> costs = solver.solve(have);
        Map<String, Integer> stock = new LinkedHashMap<>(have);
        Map<String, Integer> shortfall = new LinkedHashMap<>();
        // Insertion-ordered: the first time an item is finished fixes where its
        // one step goes, and every later demand for it adds to the same total.
        Map<String, Integer> produce = new LinkedHashMap<>();

        for (Map.Entry<String, Integer> want : goal.entrySet()) {
            obtain(want.getKey(), want.getValue(), costs, stock, produce, shortfall, new HashSet<>());
        }

        List<Action> actions = new ArrayList<>();
        for (Map.Entry<String, Integer> made : produce.entrySet()) {
            Solver.Cost cost = costs.get(made.getKey());
            if (cost == null) continue;
            if (cost.viaGather() != null) {
                Gather gather = cost.viaGather();
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
                        Map<String, Integer> shortfall, Set<String> underway) {
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
            Gather gather = cost.viaGather();
            int blocks = ceilDiv(missing, gather.amount());
            if (gather.tool() != null) {
                // A pickaxe is worn out, not eaten. Enough of them to survive the
                // job, and the survivor goes back in the bag for the next one —
                // which is why asking for stone and then coal does not build two.
                int tools = ceilDiv(blocks, Math.max(1, gather.toolUses()));
                obtain(gather.tool(), tools, costs, stock, produce, shortfall, underway);
                credit(stock, gather.tool(), 1);
            }
            produce.merge(item, blocks * gather.amount(), Integer::sum);
            credit(stock, item, blocks * gather.amount() - missing);
        } else if (cost.viaRecipe() != null) {
            Recipe recipe = cost.viaRecipe();
            int batches = ceilDiv(missing, recipe.count());
            for (Map.Entry<String, Integer> input : recipe.inputs().entrySet()) {
                obtain(input.getKey(), input.getValue() * batches,
                        costs, stock, produce, shortfall, underway);
            }
            if (recipe.station() == Recipe.Station.CRAFTING_TABLE) {
                obtain("crafting_table", 1, costs, stock, produce, shortfall, underway);
                credit(stock, "crafting_table", 1); // used, not consumed
            }
            if (recipe.station() == Recipe.Station.FURNACE) {
                obtain("furnace", 1, costs, stock, produce, shortfall, underway);
                credit(stock, "furnace", 1);
            }
            produce.merge(item, batches * recipe.count(), Integer::sum);
            credit(stock, item, batches * recipe.count() - missing);
        }
        underway.remove(item);
    }

    /** Leftovers from a batch stay available for whatever is planned next. */
    private static void credit(Map<String, Integer> stock, String item, int spare) {
        if (spare > 0) stock.merge(item, spare, Integer::sum);
    }

    private static int ceilDiv(int a, int b) {
        return (a + b - 1) / b;
    }
}
