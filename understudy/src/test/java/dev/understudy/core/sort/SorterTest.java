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

        Map<Integer, Category> first = Sorter.plan(haul, chests, true).assignment();
        Map<Integer, Category> second = Sorter.plan(haul, chests, true).assignment();
        assertEquals(first, second);
    }

    @Test
    @DisplayName("says what it could not place instead of dumping it anywhere")
    void reportsUnplaced() {
        // One chest, three categories. Two of them have nowhere to go, and
        // scattering them at random would be worse than saying so.
        Plan plan = Sorter.plan(
                inventory("cobblestone", 64, "iron_ingot", 30, "redstone", 20),
                List.of(chest(1, 27)), true);

        assertEquals(1, plan.moves().size());
        assertEquals(2, plan.unplaced().size());
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
