package dev.understudy.core.gear;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
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
        Kit.Stocked stocked = Kit.from(Kit.recovery(), carrying("iron_pickaxe", 1), false);
        assertTrue(stocked.giving().isEmpty());
        assertTrue(stocked.shortOf().contains("iron_pickaxe"));
    }

    @Test
    void theSpareOneGoesIn() {
        Kit.Stocked stocked = Kit.from(Kit.recovery(), carrying("iron_pickaxe", 2), false);
        assertEquals(1, stocked.giving().size());
        assertEquals(new Kit.Give("iron_pickaxe", 1), stocked.giving().getFirst());
        assertFalse(stocked.shortOf().contains("iron_pickaxe"));
    }

    @Test
    void stackablesGiveOnlyTheSurplus() {
        // torch wants 64 and keeps 16 back, so 40 carried leaves 24 to give.
        Kit.Stocked stocked = Kit.from(Kit.recovery(), carrying("torch", 40), false);
        assertEquals(new Kit.Give("torch", 24), stocked.giving().getFirst());
    }

    @Test
    void aSurplusBiggerThanTheKitStillOnlyGivesTheKit() {
        Kit.Stocked stocked = Kit.from(Kit.recovery(), carrying("torch", 2000), false);
        assertEquals(new Kit.Give("torch", 64), stocked.giving().getFirst());
    }

    @Test
    void creativeGrantsTheWholeList() {
        Kit.Stocked stocked = Kit.from(Kit.recovery(), Map.of(), true);
        assertEquals(Kit.recovery().size(), stocked.giving().size());
        assertTrue(stocked.shortOf().isEmpty());
        for (int i = 0; i < Kit.recovery().size(); i++) {
            assertEquals(Kit.recovery().get(i).want(), stocked.giving().get(i).count());
        }
    }

    @Test
    void anEmptyInventoryGivesNothingAndSaysSo() {
        Kit.Stocked stocked = Kit.from(Kit.recovery(), Map.of(), false);
        assertTrue(stocked.isEmpty());
        assertEquals(Kit.recovery().size(), stocked.shortOf().size());
        assertEquals("nothing", Kit.describe(stocked));
    }

    @Test
    void everyPresetIsNamedAndReadable() {
        for (String name : Kit.presets()) {
            assertNotNull(Kit.preset(name), name + " is listed but does not resolve");
            assertFalse(Kit.preset(name).isEmpty(), name + " is empty");
        }
        assertNull(Kit.preset("firework_rocket"), "an item name must not be a preset");
        assertNull(Kit.preset(null));
    }

    @Test
    void theFlightKitCarriesTheTwoThingsYouCannotImproviseInTheAir() {
        List<String> items = Kit.flight().stream().map(Kit.Line::item).toList();
        assertTrue(items.contains("firework_rocket"));
        assertTrue(items.contains("elytra"));
    }

    @Test
    void theWingsYouAreFlyingOnAreNotTheSpare() {
        // One elytra carried is the one you are using. Only a second one goes.
        assertTrue(Kit.from(Kit.flight(), carrying("elytra", 1), false).shortOf()
                .contains("elytra"));
        assertEquals(new Kit.Give("elytra", 1),
                Kit.from(Kit.flight(), carrying("elytra", 2), false).giving().getFirst());
    }

    @Test
    void anOrderIsTakenAtItsWord() {
        // No keepBack on something you named yourself: you asked for it.
        List<Kit.Line> lines = Kit.order("firework_rocket", 64);
        assertEquals(1, lines.size());
        assertEquals("firework_rocket", lines.getFirst().item());
        assertEquals(64, lines.getFirst().want());
        assertEquals(0, lines.getFirst().keepBack());
    }

    @Test
    void severalAtOnceJoinedWithAPlus() {
        List<Kit.Line> lines = Kit.order("ender_pearl+firework_rocket", 42);
        assertEquals(2, lines.size());
        // The count is each, not shared out between them.
        assertEquals(42, lines.get(0).want());
        assertEquals(42, lines.get(1).want());
    }

    @Test
    void anOrderIsTidiedBeforeItIsLookedUp() {
        assertEquals("iron_ingot", Kit.order("Minecraft:Iron Ingot", 1).getFirst().item());
        assertEquals("oak_log", Kit.order("  OAK-LOG  ", 1).getFirst().item());
    }

    @Test
    void aNameSaidTwiceIsStillOneLine() {
        assertEquals(1, Kit.order("coal+coal", 8).size());
    }

    @Test
    void anEmptyOrderAsksForNothingRatherThanForBlank() {
        assertTrue(Kit.order("", 8).isEmpty());
        assertTrue(Kit.order("+++", 8).isEmpty());
        assertTrue(Kit.order(null, 8).isEmpty());
    }

    @Test
    void aCountOfNothingIsStillOne() {
        // /stash coal 0 is a typo, not an instruction to stash zero coal.
        assertEquals(1, Kit.order("coal", 0).getFirst().want());
        assertEquals(1, Kit.order("coal", -5).getFirst().want());
    }

    @Test
    void theTurkishLocaleDoesNotEatTheDottedI() {
        Locale was = Locale.getDefault();
        try {
            Locale.setDefault(Locale.forLanguageTag("tr"));
            assertEquals("iron_ingot", Kit.order("IRON_INGOT", 1).getFirst().item());
        } finally {
            Locale.setDefault(was);
        }
    }

    @Test
    void theWordPeopleTypeReachesTheItemTheRegistryHas() {
        assertTrue(Kit.candidates("rockets").contains("firework_rocket"));
        assertTrue(Kit.candidates("rocket").contains("firework_rocket"));
        assertTrue(Kit.candidates("ender_pearls").contains("ender_pearl"));
        assertTrue(Kit.candidates("pearls").contains("ender_pearl"));
        assertTrue(Kit.candidates("torches").contains("torch"));
        assertTrue(Kit.candidates("arrows").contains("arrow"));
        assertTrue(Kit.candidates("wings").contains("elytra"));
    }

    @Test
    void theNameAsTypedIsAlwaysTriedFirst() {
        // "beds" is not an item and "bed" is; but "grass" is an item and
        // "gras" is not, so guessing before asking would be worse than useless.
        assertEquals("beds", Kit.candidates("beds").getFirst());
        assertEquals("grass", Kit.candidates("grass").getFirst());
        assertTrue(Kit.candidates("grass").contains("gras"),
                "the singular is still offered, just not first");
    }

    @Test
    void nothingTypedIsNothingGuessed() {
        assertTrue(Kit.candidates("").isEmpty());
        assertTrue(Kit.candidates(null).isEmpty());
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
        assertEquals(2, Kit.shoppingList(Kit.recovery()).get("iron_pickaxe"));
        assertEquals(80, Kit.shoppingList(Kit.recovery()).get("torch"));
    }

    @Test
    void whatItGivesIsWrittenTheWayItReads() {
        Kit.Stocked stocked = Kit.from(Kit.recovery(), carrying("iron_pickaxe", 2, "torch", 100), false);
        assertEquals("iron_pickaxe, 64 torch", Kit.describe(stocked));
    }
}
