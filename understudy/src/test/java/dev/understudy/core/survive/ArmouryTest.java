package dev.understudy.core.survive;

import dev.understudy.core.survive.Armoury.Slot;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class ArmouryTest {

    @Test
    @DisplayName("wears the best of what is in the bag, slot by slot")
    void picksTheBestSet() {
        Map<Slot, String> set = Armoury.bestSet(Map.of(
                "leather_chestplate", 1, "iron_chestplate", 1, "diamond_chestplate", 1,
                "iron_boots", 1, "leather_helmet", 1, "cobblestone", 64));
        assertEquals("diamond_chestplate", set.get(Slot.CHEST));
        assertEquals("iron_boots", set.get(Slot.FEET));
        assertEquals("leather_helmet", set.get(Slot.HEAD));
        assertNull(set.get(Slot.LEGS), "invented a pair of trousers");
    }

    @Test
    @DisplayName("breaks a tie on points by toughness")
    void prefersTheToughOne() {
        // Diamond and netherite boots are both worth three points. One of them
        // is meaningfully better and the difference is not in the points.
        Map<Slot, String> set = Armoury.bestSet(Map.of("diamond_boots", 1, "netherite_boots", 1));
        assertEquals("netherite_boots", set.get(Slot.FEET));
    }

    @Test
    @DisplayName("the numbers are the game's own")
    void pointsAreReal() {
        assertEquals(20, Armoury.pointsOf(Map.of(
                Slot.HEAD, "diamond_helmet", Slot.CHEST, "diamond_chestplate",
                Slot.LEGS, "diamond_leggings", Slot.FEET, "diamond_boots")));
        assertEquals(15, Armoury.pointsOf(Map.of(
                Slot.HEAD, "iron_helmet", Slot.CHEST, "iron_chestplate",
                Slot.LEGS, "iron_leggings", Slot.FEET, "iron_boots")));
        assertEquals(7, Armoury.pointsOf(Map.of(
                Slot.HEAD, "leather_helmet", Slot.CHEST, "leather_chestplate",
                Slot.LEGS, "leather_leggings", Slot.FEET, "leather_boots")));
    }

    @Test
    @DisplayName("armour reduces damage, and toughness helps most against the big hits")
    void reductionFollowsTheFormula() {
        assertEquals(1.0, Armoury.taken(0, 0, 6), 0.001, "bare skin takes all of it");

        // Full iron against an ordinary hit: about half gets through.
        assertEquals(0.52, Armoury.taken(15, 0, 6), 0.01);

        // The thing toughness is for: against a creeper-sized hit, iron and
        // diamond are much further apart than their four points suggest.
        double ironAgainstABlast = Armoury.taken(15, 0, 40);
        double diamondAgainstABlast = Armoury.taken(20, 8, 40);
        assertTrue(diamondAgainstABlast < ironAgainstABlast - 0.1,
                "toughness bought nothing against a big hit: "
                        + ironAgainstABlast + " vs " + diamondAgainstABlast);
    }

    @Test
    @DisplayName("more headroom is not more hearts")
    void survivabilityIsCapped() {
        // Full diamond really does cut an ordinary hit to about a quarter. Four
        // times the headroom is still not four times the health bar: a creeper
        // at point blank ends a fight at two hearts whatever the trousers are.
        assertEquals(1.0, Armoury.survivability(0, 0, 6), 0.001);
        assertTrue(Armoury.survivability(20, 8, 6) <= 2.0);
        assertTrue(Armoury.survivability(20, 8, 6) > Armoury.survivability(7, 0, 6));
    }

    @Test
    @DisplayName("knows a piece of armour from a pickaxe")
    void recognisesItsOwnKit() {
        assertTrue(Armoury.isArmour("netherite_leggings"));
        assertTrue(Armoury.isArmour("turtle_helmet"));
        assertFalse(Armoury.isArmour("iron_pickaxe"));
        assertFalse(Armoury.isArmour("shield"));
        assertEquals(Slot.HEAD, Armoury.of("turtle_helmet").slot());
    }
}
