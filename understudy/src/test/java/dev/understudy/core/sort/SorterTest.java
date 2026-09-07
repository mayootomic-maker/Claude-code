package dev.understudy.core.sort;

import dev.understudy.core.sort.Sorter.ChestView;
import dev.understudy.core.sort.Sorter.Move;
import dev.understudy.core.sort.Sorter.Plan;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class SorterTest {

    private static ChestView chest(int id, int free, Object... pairs) {
        Map<String, Integer> contents = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            contents.put((String) pairs[i], (Integer) pairs[i + 1]);
        }
        return new ChestView(id, contents, free);
    }

    private static Map<String, Integer> inventory(Object... pairs) {
        Map<String, Integer> out = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) out.put((String) pairs[i], (Integer) pairs[i + 1]);
        return out;
    }

    @Test
    @DisplayName("a diamond pickaxe is a tool, not a valuable")
    void specificBeatsGeneral() {
        // The rule that catches "diamond" would swallow every diamond tool if
        // it were tested first, and the tool chest would stay empty forever.
        assertEquals(Category.TOOLS, Category.of("diamond_pickaxe"));
        assertEquals(Category.TOOLS, Category.of("netherite_shovel"));
        assertEquals(Category.WEAPONS, Category.of("diamond_sword"));
        assertEquals(Category.ARMOUR, Category.of("netherite_chestplate"));
        assertEquals(Category.VALUABLES, Category.of("diamond"));
        assertEquals(Category.VALUABLES, Category.of("netherite_ingot"));
    }

    @Test
    @DisplayName("a redstone torch is redstone, not a building block")
    void redstoneBeforeBuilding() {
        assertEquals(Category.REDSTONE, Category.of("redstone_torch"));
        assertEquals(Category.REDSTONE, Category.of("sticky_piston"));
        assertEquals(Category.REDSTONE, Category.of("powered_rail"));
        assertEquals(Category.BUILDING, Category.of("torch"));
    }

    @Test
    @DisplayName("sorts the ordinary things where you would expect")
    void obviousCases() {
        assertEquals(Category.ORES, Category.of("iron_ingot"));
        assertEquals(Category.ORES, Category.of("raw_copper"));
        assertEquals(Category.ORES, Category.of("coal"));
        assertEquals(Category.BUILDING, Category.of("oak_planks"));
        assertEquals(Category.BUILDING, Category.of("cobblestone"));
        assertEquals(Category.FOOD, Category.of("cooked_beef"));
        assertEquals(Category.FOOD, Category.of("golden_carrot"));
        assertEquals(Category.PLANTS, Category.of("oak_sapling"));
        assertEquals(Category.BREWING, Category.of("nether_wart"));
        assertEquals(Category.MISC, Category.of("bone"));
    }

    @Test
    @DisplayName("copes with a namespaced or empty name instead of throwing")
    void tolerantOfOddNames() {
        assertEquals(Category.BUILDING, Category.of("minecraft:oak_planks"));
        assertEquals(Category.MISC, Category.of(""));
        assertEquals(Category.MISC, Category.of(null));
        assertEquals(Category.MISC, Category.of("some_mod:mystery_widget"));
    }

    @Test
    @DisplayName("keeps your kit rather than depositing it")
    void keepsKit() {
        // Sorting that puts away your pickaxe and your food leaves you standing
        // in a tidy base unable to do anything.
        Plan plan = Sorter.plan(
                inventory("diamond_pickaxe", 1, "cooked_beef", 12, "cobblestone", 200),
                List.of(chest(1, 27)), true);

        List<String> moved = plan.moves().stream().map(Move::item).toList();
        assertFalse(moved.contains("diamond_pickaxe"), "deposited the pickaxe");
        assertFalse(moved.contains("cooked_beef"), "deposited the food");
        assertTrue(moved.contains("cobblestone"));
    }

    @Test
    @DisplayName("empties out completely when asked to")
    void canEmptyEverything() {
        Plan plan = Sorter.plan(
                inventory("diamond_pickaxe", 1, "cobblestone", 200),
                List.of(chest(1, 27), chest(2, 27)), false);
        assertEquals(2, plan.moves().size());
    }

    @Test
    @DisplayName("gives each category its own chest")
    void oneCategoryPerChest() {
        Plan plan = Sorter.plan(
                inventory("cobblestone", 64, "iron_ingot", 30, "redstone", 20),
                List.of(chest(1, 27), chest(2, 27), chest(3, 27)), true);

        assertEquals(3, plan.moves().size());
        long distinctChests = plan.moves().stream().map(Move::chestId).distinct().count();
        assertEquals(3, distinctChests, "piled different categories into one chest");
        assertTrue(plan.unplaced().isEmpty());
    }

    @Test
    @DisplayName("puts things back where they already live")
    void stickyAssignment() {
        // Chest 2 is clearly already the ore chest. Sorting again must not
        // decide chest 1 is now the ore chest and move everything across.
        List<ChestView> chests = List.of(
                chest(1, 20, "oak_planks", 100, "cobblestone", 64),
                chest(2, 20, "iron_ingot", 64, "gold_ingot", 32));

        Plan plan = Sorter.plan(inventory("raw_iron", 40, "stone", 64), chests, true);
        Map<String, Integer> chestFor = new LinkedHashMap<>();
        for (Move move : plan.moves()) chestFor.put(move.item(), move.chestId());

        assertEquals(2, chestFor.get("raw_iron"), "ore did not go to the ore chest");
        assertEquals(1, chestFor.get("stone"), "building did not go to the building chest");
    }

    @Test
    @DisplayName("is stable: sorting twice does not reshuffle the base")
    void stableAcrossRuns() {
        List<ChestView> chests = List.of(
                chest(1, 20, "oak_planks", 100),
                chest(2, 20, "iron_ingot", 64),
                chest(3, 20, "redstone", 40));
        Map<String, Integer> haul = inventory("cobblestone", 64, "raw_gold", 12, "repeater", 4);

        Map<Integer, List<Category>> first = Sorter.plan(haul, chests, true).assignment();
        Map<Integer, List<Category>> second = Sorter.plan(haul, chests, true).assignment();
        assertEquals(first, second);
    }

    @Test
    @DisplayName("one chest takes everything rather than one category and a shrug")
    void fewerChestsThanCategories() {
        // This used to place one category and report the other two as having
        // nowhere to go, which is true of a rule that gives each chest a single
        // category and useless to somebody with one chest. Everything that fits
        // goes in.
        Plan plan = Sorter.plan(
                inventory("cobblestone", 64, "iron_ingot", 30, "redstone", 20),
                List.of(chest(1, 27)), true);

        assertEquals(3, plan.moves().size(), "left things behind with room to spare");
        assertTrue(plan.unplaced().isEmpty(), plan.unplaced().toString());
    }

    @Test
    @DisplayName("keeps things together: ore goes with the valuables, not the bread")
    void groupsRelatedCategories() {
        // Two chests, four categories. Which two share matters — putting the
        // diamonds in with the ore is a base you can find things in; putting
        // them in with the wheat is a jumble.
        Plan plan = Sorter.plan(
                inventory("raw_iron", 30, "diamond", 4, "oak_planks", 64, "bread", 12),
                List.of(chest(1, 27), chest(2, 27)), true);

        int ores = chestOf(plan, "raw_iron");
        int valuables = chestOf(plan, "diamond");
        assertEquals(ores, valuables, "split the ore from the valuables: " + plan.assignment());
    }

    @Test
    @DisplayName("spills into another chest rather than stopping at a full one")
    void overflowsRatherThanGivingUp() {
        // The ore chest has one slot and there are two kinds of ore. The second
        // one has to go somewhere, and the chest next to it is empty.
        Plan plan = Sorter.plan(
                inventory("raw_iron", 30, "raw_copper", 30),
                List.of(chest(1, 1, "raw_gold", 40), chest(2, 27)), true);

        assertEquals(2, plan.moves().size(), "stopped at the full chest: " + plan.unplaced());
        assertTrue(plan.unplaced().isEmpty());
    }

    @Test
    @DisplayName("keeps the best pickaxe and puts the other three away")
    void keepsOnlyTheBestOfEachKind() {
        Map<String, Integer> carried = inventory(
                "diamond_pickaxe", 1, "stone_pickaxe", 3, "wooden_pickaxe", 1,
                "iron_sword", 1, "bread", 8);
        java.util.Set<String> keeping = Sorter.keepBack(carried);

        assertTrue(keeping.contains("diamond_pickaxe"), "gave away the good one");
        assertFalse(keeping.contains("stone_pickaxe"), "kept the spares");
        assertFalse(keeping.contains("wooden_pickaxe"));
        assertTrue(keeping.contains("iron_sword"), "only one sword, and it stays");
        assertTrue(keeping.contains("bread"), "never leave without food");
    }

    private static int chestOf(Plan plan, String item) {
        return plan.moves().stream()
                .filter(move -> move.item().equals(item))
                .findFirst()
                .orElseThrow(() -> new AssertionError("never placed " + item))
                .chestId();
    }

    @Test
    @DisplayName("will not send anything to a chest with no room")
    void respectsFullChests() {
        Plan plan = Sorter.plan(
                inventory("cobblestone", 64, "iron_ingot", 30),
                List.of(chest(1, 0, "oak_planks", 100), chest(2, 1)), true);

        for (Move move : plan.moves()) {
            assertNotEquals(1, move.chestId(), "sent something to a full chest");
        }
        assertTrue(plan.moves().size() <= 1, "overfilled the one chest with a slot free");
    }

    @Test
    @DisplayName("does nothing, quietly, when there is nothing to do")
    void nothingToDo() {
        Plan plan = Sorter.plan(inventory("diamond_pickaxe", 1), List.of(chest(1, 27)), true);
        assertTrue(plan.isEmpty());
        assertTrue(plan.unplaced().isEmpty());

        Plan noChests = Sorter.plan(inventory("cobblestone", 64), List.of(), true);
        assertTrue(noChests.isEmpty());
        assertEquals(List.of("cobblestone"), noChests.unplaced());
    }

    @Test
    @DisplayName("every category has a label worth showing a person")
    void labels() {
        for (Category category : Category.values()) {
            assertNotNull(category.label());
            assertFalse(category.label().isBlank());
        }
    }
}
