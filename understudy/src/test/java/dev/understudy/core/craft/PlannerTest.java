package dev.understudy.core.craft;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PlannerTest {

    private static Planner planner() {
        return new Planner(Catalogue.solver());
    }

    private static List<String> stepsFor(Map<String, Integer> goal, Map<String, Integer> have) {
        return planner().plan(goal, have).summary();
    }

    private static int indexOf(List<String> steps, String fragment) {
        for (int i = 0; i < steps.size(); i++) if (steps.get(i).contains(fragment)) return i;
        return -1;
    }

    private static int totalGathered(Planner.Plan plan, String item) {
        return plan.actions().stream()
                .filter(a -> a instanceof Planner.Collect c && c.item().equals(item))
                .mapToInt(a -> ((Planner.Collect) a).count()).sum();
    }

    private static int totalMade(Planner.Plan plan, String item) {
        return plan.actions().stream()
                .filter(a -> a instanceof Planner.Make m && m.item().equals(item))
                .mapToInt(a -> ((Planner.Make) a).count()).sum();
    }

    @Test
    void asksForNothingWhenYouAlreadyHaveIt() {
        assertTrue(stepsFor(Map.of("oak_planks", 4), Map.of("oak_planks", 10)).isEmpty());
    }

    @Test
    void choppingComesBeforeCrafting() {
        List<String> steps = stepsFor(Map.of("oak_planks", 8), Map.of());
        assertTrue(indexOf(steps, "gather") >= 0, "must gather logs: " + steps);
        assertTrue(indexOf(steps, "gather") < indexOf(steps, "craft"),
                "gathering has to come first: " + steps);
    }

    @Test
    void findsToolsItNeedsBeforeTheBlocksThatNeedThem() {
        // Cobblestone needs a pickaxe. Nobody said so; the plan has to work it
        // out from the fact that gathering stone requires one.
        List<String> steps = stepsFor(Map.of("cobblestone", 20), Map.of());
        int pickaxe = indexOf(steps, "wooden_pickaxe");
        int stone = indexOf(steps, "gather 20 cobblestone");
        assertTrue(pickaxe >= 0, "should craft a pickaxe: " + steps);
        assertTrue(stone >= 0, "should gather the stone: " + steps);
        assertTrue(pickaxe < stone, "pickaxe before the stone it mines: " + steps);
    }

    @Test
    void reachesIronThroughTheWholeToolChain() {
        // Iron needs a stone pickaxe, which needs cobblestone, which needs a
        // wooden pickaxe, which needs planks, which need a log. Four levels the
        // planner is never told about.
        List<String> steps = stepsFor(Map.of("iron_ingot", 3), Map.of());
        assertTrue(indexOf(steps, "oak_log") >= 0, steps.toString());
        assertTrue(indexOf(steps, "wooden_pickaxe") >= 0, steps.toString());
        assertTrue(indexOf(steps, "stone_pickaxe") >= 0, steps.toString());
        assertTrue(indexOf(steps, "raw_iron") >= 0, steps.toString());
        assertTrue(indexOf(steps, "oak_log") < indexOf(steps, "wooden_pickaxe"), steps.toString());
        assertTrue(indexOf(steps, "wooden_pickaxe") < indexOf(steps, "stone_pickaxe"), steps.toString());
        assertTrue(indexOf(steps, "stone_pickaxe") < indexOf(steps, "raw_iron"), steps.toString());
    }

    @Test
    void ironCostsFarMoreThanWood() {
        // The bug this replaces had iron coming out nearly free, which made a
        // shield look like a five-minute job. Ordering is the whole point of
        // the cost model; if these two are close, nothing else it says is worth
        // reading.
        Map<String, Solver.Cost> costs = Catalogue.solver().solve(Map.of());
        double wood = costs.get("oak_planks").seconds();
        double iron = costs.get("iron_ingot").seconds();
        assertTrue(iron > wood * 10,
                "iron " + iron + "s vs planks " + wood + "s — iron should be much dearer");
    }

    @Test
    void neverMinesSomethingPlayersMake() {
        // No source in the world drops a crafted block, so no cost may come
        // from gathering one.
        Map<String, Solver.Cost> costs = Catalogue.solver().solve(Map.of());
        for (String made : List.of("oak_planks", "stick", "glass", "stone", "iron_ingot",
                "chest", "torch", "bricks")) {
            Solver.Cost cost = costs.get(made);
            assertTrue(cost != null && cost.viaGather() == null,
                    made + " must be crafted, not gathered");
        }
    }

    @Test
    void spendsWhatYouHaveBeforeGatheringMore() {
        List<String> withLogs = stepsFor(Map.of("oak_planks", 4), Map.of("oak_log", 5));
        assertEquals(-1, indexOf(withLogs, "gather"),
                "five logs is plenty for four planks: " + withLogs);
    }

    @Test
    void countsLeftoversFromABatch() {
        // One log makes four planks, so six planks is two logs and not six.
        // Nothing else is in the way here — the door version of this test
        // quietly also paid for a crafting table, and passed only because it
        // was looking at the first of two separate log gathers.
        Planner.Plan plan = planner().plan(Map.of("oak_planks", 6), Map.of());
        assertEquals(2, totalGathered(plan, "oak_log"), plan.summary().toString());
    }

    @Test
    void countsTheTableTheRecipeNeeds() {
        // Three doors is six planks, and the table they are made on is another
        // four. Ten planks is three logs.
        Planner.Plan plan = planner().plan(Map.of("oak_door", 3), Map.of());
        assertEquals(3, totalGathered(plan, "oak_log"), plan.summary().toString());
    }

    @Test
    void gathersEachThingOnce() {
        // The plan is a list a person follows. Six separate trips for one log
        // each is a correct plan and a useless one.
        Planner.Plan plan = planner().plan(
                Map.of("oak_planks", 64, "chest", 4, "torch", 16, "oak_door", 3), Map.of());
        for (String item : List.of("oak_log", "cobblestone", "coal")) {
            long trips = plan.actions().stream()
                    .filter(a -> a instanceof Planner.Collect c && c.item().equals(item))
                    .count();
            assertTrue(trips <= 1, item + " gathered in " + trips + " separate trips: "
                    + plan.summary());
        }
    }

    @Test
    void doesNotBuildAToolPerJob() {
        // A pickaxe is worn out, not eaten. Mining stone and then coal is one
        // pickaxe, and the second only appears when the first would break.
        Planner.Plan small = planner().plan(Map.of("cobblestone", 8, "coal", 2), Map.of());
        assertEquals(1, totalMade(small, "wooden_pickaxe"), small.summary().toString());

        Planner.Plan large = planner().plan(Map.of("cobblestone", 120), Map.of());
        assertTrue(totalMade(large, "wooden_pickaxe") >= 2,
                "120 blocks outlasts a 59-use pickaxe: " + large.summary());
    }

    @Test
    void doesNotConsumeTheCraftingTable() {
        // A table is used, not spent. Asking for several table recipes must not
        // build several tables.
        List<String> steps = stepsFor(Map.of("chest", 1, "oak_door", 3, "ladder", 3), Map.of());
        long tables = steps.stream().filter(line -> line.contains("crafting_table")).count();
        assertEquals(1, tables, "one table is enough: " + steps);
    }

    @Test
    void saysSoWhenSomethingCannotBeReached() {
        Planner.Plan plan = planner().plan(Map.of("netherite_ingot", 1), Map.of());
        assertFalse(plan.possible());
        assertTrue(plan.shortfall().containsKey("netherite_ingot"));
    }

    @Test
    void chargesForFurnaceFuel() {
        // Smelting without counting the coal is how a plan promises stone in
        // ten seconds and then goes mining for twelve minutes.
        Map<String, Solver.Cost> costs = Catalogue.solver().solve(Map.of());
        assertTrue(costs.get("stone").seconds() > costs.get("coal").seconds(),
                "stone must cost at least the coal it burns");
    }

    @Test
    void amortisesAToolOverItsDurability() {
        // A pickaxe lasts 59 blocks, so one cobblestone carries a fifty-ninth of
        // a pickaxe, not a whole one.
        Map<String, Solver.Cost> costs = Catalogue.solver().solve(Map.of());
        double pickaxe = costs.get("wooden_pickaxe").seconds();
        double cobble = costs.get("cobblestone").seconds();
        assertTrue(cobble < pickaxe,
                "one stone (" + cobble + "s) should not cost a whole pickaxe (" + pickaxe + "s)");
    }

    @Test
    void wholePlanIsOrderedSoEveryStepIsPossibleWhenItIsReached() {
        // The real invariant, checked by replaying the plan against an empty
        // inventory: nothing may be crafted before its inputs exist.
        Planner.Plan plan = planner().plan(Map.of("chest", 2, "torch", 8, "oak_door", 3), Map.of());
        assertTrue(plan.possible(), plan.shortfall().toString());

        Map<String, Integer> held = new java.util.HashMap<>();
        for (Planner.Action action : plan.actions()) {
            if (action instanceof Planner.Collect collect) {
                held.merge(collect.item(), collect.count(), Integer::sum);
            } else if (action instanceof Planner.Make make) {
                for (Map.Entry<String, Integer> input : make.recipe().inputs().entrySet()) {
                    int need = input.getValue() * make.batches();
                    int has = held.getOrDefault(input.getKey(), 0);
                    assertTrue(has >= need,
                            "step '" + make.describe() + "' needs " + need + " "
                                    + input.getKey() + " but only " + has + " exist by then\n"
                                    + String.join("\n", plan.summary()));
                    held.put(input.getKey(), has - need);
                }
                held.merge(make.item(), make.count(), Integer::sum);
            }
        }
    }
}
