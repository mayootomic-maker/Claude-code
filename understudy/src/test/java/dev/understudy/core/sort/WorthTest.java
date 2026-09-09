package dev.understudy.core.sort;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

class WorthTest {

    @Test
    @DisplayName("throws out the cobblestone rather than stopping the job")
    void freesASlot() {
        Map<String, Integer> bag = Map.of(
                "cobblestone", 192, "dirt", 64, "iron_ore", 12, "diamond_pickaxe", 1);
        assertEquals("cobblestone", Worth.leastMissed(bag, Set.of("iron_ore")));
    }

    @Test
    @DisplayName("never the thing the job is for")
    void doesNotThrowAwayThePoint() {
        // A gather of six hundred cobblestone must not decide, on filling up,
        // that the cobblestone is the problem.
        Map<String, Integer> bag = Map.of("cobblestone", 192, "dirt", 128);
        assertEquals("dirt", Worth.leastMissed(bag, Set.of("cobblestone")));
    }

    @Test
    @DisplayName("the cheapest thing in a bag of diamonds is still a diamond")
    void refusesRatherThanGuess() {
        // The answer to "nothing here is spare" is nothing, and stopping with
        // an honest message. It is just no longer the first answer.
        Map<String, Integer> bag = Map.of(
                "diamond", 3, "iron_ingot", 40, "cooked_beef", 20, "torch", 32);
        assertNull(Worth.leastMissed(bag, Set.of()));
    }

    @Test
    @DisplayName("a handful of something is not a spare stack of it")
    void onlyRealPiles() {
        assertNull(Worth.leastMissed(Map.of("cobblestone", 12), Set.of()));
        assertEquals("cobblestone", Worth.leastMissed(Map.of("cobblestone", 64), Set.of()));
    }

    @Test
    @DisplayName("the biggest pile goes first")
    void takesTheBiggestPile() {
        Map<String, Integer> bag = Map.of("dirt", 70, "cobblestone", 300, "gravel", 128);
        assertEquals("cobblestone", Worth.leastMissed(bag, Set.of()));
    }

    @Test
    @DisplayName("nothing that is a tool, a weapon, armour or a meal")
    void keepsWhatMatters() {
        for (String keep : java.util.List.of("diamond_pickaxe", "iron_sword", "iron_chestplate",
                "cooked_beef", "diamond", "golden_apple")) {
            assertTrue(Worth.precious(keep), keep + " was treated as spare");
            assertFalse(Worth.spoil(keep));
        }
        for (String spare : java.util.List.of("cobblestone", "dirt", "gravel", "netherrack")) {
            assertFalse(Worth.precious(spare), spare + " was treated as precious");
        }
    }
}
