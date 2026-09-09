package dev.understudy.core.gear;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * A death chest must never be paid for out of the kit you are wearing.
 *
 * This is the failure worth testing because it is invisible while it happens:
 * stocking the box takes your pickaxe, you walk off happy, and you find out in
 * the dark. Every case below is a variant of "did it take more than it should".
 */
class KitTest {

    private static Map<String, Integer> carrying(Object... pairs) {
        Map<String, Integer> out = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            out.put((String) pairs[i], (Integer) pairs[i + 1]);
        }
        return out;
    }

    @Test
    void theOnlyPickaxeStaysWithYou() {
        Kit.Stocked stocked = Kit.from(carrying("iron_pickaxe", 1), false);
        assertTrue(stocked.giving().isEmpty());
        assertTrue(stocked.shortOf().contains("iron_pickaxe"));
    }

    @Test
    void theSpareOneGoesIn() {
        Kit.Stocked stocked = Kit.from(carrying("iron_pickaxe", 2), false);
        assertEquals(1, stocked.giving().size());
        assertEquals(new Kit.Give("iron_pickaxe", 1), stocked.giving().getFirst());
        assertFalse(stocked.shortOf().contains("iron_pickaxe"));
    }

    @Test
    void stackablesGiveOnlyTheSurplus() {
        // torch wants 64 and keeps 16 back, so 40 carried leaves 24 to give.
        Kit.Stocked stocked = Kit.from(carrying("torch", 40), false);
        assertEquals(new Kit.Give("torch", 24), stocked.giving().getFirst());
    }

    @Test
    void aSurplusBiggerThanTheKitStillOnlyGivesTheKit() {
        Kit.Stocked stocked = Kit.from(carrying("torch", 2000), false);
        assertEquals(new Kit.Give("torch", 64), stocked.giving().getFirst());
    }

    @Test
    void creativeGrantsTheWholeList() {
        Kit.Stocked stocked = Kit.from(Map.of(), true);
        assertEquals(Kit.recovery().size(), stocked.giving().size());
        assertTrue(stocked.shortOf().isEmpty());
        for (int i = 0; i < Kit.recovery().size(); i++) {
            assertEquals(Kit.recovery().get(i).want(), stocked.giving().get(i).count());
        }
    }

    @Test
    void anEmptyInventoryGivesNothingAndSaysSo() {
        Kit.Stocked stocked = Kit.from(Map.of(), false);
        assertTrue(stocked.isEmpty());
        assertEquals(Kit.recovery().size(), stocked.shortOf().size());
        assertEquals("nothing", Kit.describe(stocked));
    }

    @Test
    void theKitFitsInOneChest() {
        // Every line is at most a stack, so lines are slots. More lines than
        // slots would silently lose the tail of the list.
        assertTrue(Kit.recovery().size() <= Kit.SLOTS,
                "the kit has outgrown a single chest");
    }

    @Test
    void nothingIsListedTwice() {
        long distinct = Kit.recovery().stream().map(Kit.Line::item).distinct().count();
        assertEquals(Kit.recovery().size(), distinct);
    }

    @Test
    void theShoppingListAsksForTheSpareAsWellAsTheOneYouKeep() {
        // The whole point: two pickaxes to end up with one in a box.
        assertEquals(2, Kit.shoppingList().get("iron_pickaxe"));
        assertEquals(80, Kit.shoppingList().get("torch"));
    }

    @Test
    void whatItGivesIsWrittenTheWayItReads() {
        Kit.Stocked stocked = Kit.from(carrying("iron_pickaxe", 2, "torch", 100), false);
        assertEquals("iron_pickaxe, 64 torch", Kit.describe(stocked));
    }
}
