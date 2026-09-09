package dev.understudy.core.craft;

import dev.understudy.core.craft.Enchanting.Act;
import dev.understudy.core.craft.Enchanting.Offer;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class EnchantingTest {

    /** What a full set of shelves offers: a cheap line, a middling one, and thirty. */
    private static final List<Offer> FULL_TABLE = List.of(
            new Offer(0, 8, "unbreaking"),
            new Offer(1, 17, "efficiency"),
            new Offer(2, 30, "fortune"));

    @Test
    @DisplayName("takes the top offer, not the affordable one")
    void neverSpendsTheOneChanceCheaply() {
        // The mistake everyone makes at least once, and it is permanent: an
        // item can be enchanted at a table exactly once, so the cheap line at
        // level eight is what that pickaxe is for the rest of its life.
        Enchanting.Choice choice = Enchanting.decide(30, 3, 15, FULL_TABLE);
        assertEquals(Act.ENCHANT, choice.act());
        assertEquals(2, choice.slot(), "took a cheaper line than it could afford");
    }

    @Test
    @DisplayName("waits for levels rather than settling")
    void waitsRatherThanSettles() {
        Enchanting.Choice choice = Enchanting.decide(12, 3, 15, FULL_TABLE);
        assertEquals(Act.EARN_LEVELS, choice.act(),
                "took the cheap line because it happened to be affordable");
        assertTrue(choice.because().contains("levels come back"));
    }

    @Test
    @DisplayName("builds the shelves before spending anything")
    void refusesABareTable() {
        // A table with no shelves cannot offer the enchantments worth having at
        // all. Using one is not a cheap enchant; it is a wasted item.
        assertEquals(Act.BUILD_SHELVES,
                Enchanting.decide(30, 64, 0, List.of(new Offer(0, 3, ""))).act());
        assertEquals(Act.BUILD_SHELVES,
                Enchanting.decide(30, 64, 14, FULL_TABLE).act(),
                "fourteen shelves is meaningfully worse and looks identical");
        assertEquals(Act.ENCHANT, Enchanting.decide(30, 64, 15, FULL_TABLE).act());
    }

    @Test
    @DisplayName("lapis is cheap and it is not free")
    void needsLapis() {
        assertEquals(Act.GET_LAPIS, Enchanting.decide(30, 2, 15, FULL_TABLE).act());
        assertEquals(Act.ENCHANT, Enchanting.decide(30, 3, 15, FULL_TABLE).act());
    }

    @Test
    @DisplayName("ignores slots the table cannot fill yet")
    void skipsEmptySlots() {
        List<Offer> partial = List.of(
                new Offer(0, 5, "unbreaking"), new Offer(1, 0, ""), new Offer(2, 0, ""));
        assertEquals(0, Enchanting.top(partial).slot());
    }

    @Test
    @DisplayName("a table with nothing on it is not an error")
    void emptyTable() {
        assertEquals(Act.WAIT, Enchanting.decide(30, 64, 15, List.of()).act());
    }

    @Test
    @DisplayName("knows what is worth enchanting")
    void picksTheRightThings() {
        for (String yes : List.of("diamond_pickaxe", "netherite_sword", "iron_chestplate",
                "bow", "trident", "book")) {
            assertTrue(Enchanting.worthEnchanting(yes), yes + " was not worth enchanting");
        }
        for (String no : List.of("cobblestone", "torch", "cooked_beef", "shield")) {
            assertFalse(Enchanting.worthEnchanting(no), no + " was offered to the table");
        }
        assertFalse(Enchanting.worthEnchanting(null));
    }

    @Test
    @DisplayName("every decision explains itself")
    void alwaysGivesAReason() {
        for (int level : new int[]{0, 12, 30, 50}) {
            for (int lapis : new int[]{0, 3, 64}) {
                for (int shelves : new int[]{0, 14, 15}) {
                    Enchanting.Choice choice =
                            Enchanting.decide(level, lapis, shelves, FULL_TABLE);
                    assertFalse(choice.because().isBlank(),
                            "decided " + choice.act() + " for no stated reason");
                }
            }
        }
    }
}
