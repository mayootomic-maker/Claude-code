package dev.understudy.core.adapt;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class PlayerProfileTest {

    @Test
    @DisplayName("knows nothing, and says so, before it has watched anything")
    void startsHonest() {
        PlayerProfile profile = new PlayerProfile();
        assertNull(profile.favouriteBuildingBlock());
        assertNull(profile.preferredMiningDepth());
        assertFalse(profile.confident());
        assertEquals(0, profile.confidence(), 0.001);
        // Unknown tendencies sit at the midpoint rather than at zero: "I have
        // not seen you bridge" is not the same as "you never bridge".
        assertEquals(0.5, profile.bridgeTolerance(), 0.001);
        assertEquals(0.5, profile.aggression(), 0.001);
    }

    @Test
    @DisplayName("learns the block you actually build with")
    void learnsMaterial() {
        PlayerProfile profile = new PlayerProfile();
        for (int i = 0; i < 40; i++) profile.placedBlock("spruce_planks");
        for (int i = 0; i < 5; i++) profile.placedBlock("cobblestone");
        assertEquals("spruce_planks", profile.favouriteBuildingBlock());
        assertEquals(List.of("spruce_planks", "cobblestone"), profile.buildingBlocks(2));
    }

    @Test
    @DisplayName("follows you when your habits change, instead of averaging over all time")
    void adaptsRatherThanAccumulating() {
        PlayerProfile profile = new PlayerProfile();
        // A long stone phase.
        for (int i = 0; i < 600; i++) profile.placedBlock("cobblestone");
        assertEquals("cobblestone", profile.favouriteBuildingBlock());

        // Then you switch to wood and stay there. A plain counter would need
        // 600 more placements to catch up; decay gets there in far fewer,
        // which is the difference between a profile that adapts and one that
        // describes the first thing you ever did.
        for (int i = 0; i < 300; i++) profile.placedBlock("oak_planks");
        assertEquals("oak_planks", profile.favouriteBuildingBlock(),
                "still stuck on the old habit");
    }

    @Test
    @DisplayName("keeps the tally bounded however long you play")
    void bounded() {
        Tally tally = new Tally();
        for (int i = 0; i < 60_000; i++) tally.add("block_" + (i % 900));
        // Decay drops anything that stops being used, so the map cannot grow
        // without limit across a long-running world.
        assertTrue(tally.snapshot().size() <= 900, "unbounded: " + tally.snapshot().size());
        assertTrue(tally.total() > 0);
    }

    @Test
    @DisplayName("learns the depth you mine ore at, not the depth you walk at")
    void miningDepth() {
        PlayerProfile profile = new PlayerProfile();
        // Lots of walking about on the surface.
        for (int i = 0; i < 100; i++) profile.minedBlock("dirt", 70);
        // And rather less ore mining, deep down.
        for (int i = 0; i < 30; i++) profile.minedBlock("deepslate_diamond_ore", -54);
        Integer depth = profile.preferredMiningDepth();
        assertNotNull(depth);
        assertTrue(depth <= -48 && depth >= -56, "wrong band: " + depth);
    }

    @Test
    @DisplayName("buckets depth into bands rather than exact levels")
    void depthBands() {
        assertEquals("-56", PlayerProfile.band(-54));
        assertEquals("-56", PlayerProfile.band(-50));
        assertEquals("64", PlayerProfile.band(70));
        assertEquals("0", PlayerProfile.band(3));
        assertEquals("-8", PlayerProfile.band(-1));
    }

    @Test
    @DisplayName("picks up how you get past obstacles")
    void travelStyle() {
        PlayerProfile tunneller = new PlayerProfile();
        tunneller.travelled(800, true, true, false, false);
        tunneller.travelled(200, true, false, false, false);
        assertTrue(tunneller.digTolerance() > 0.7, "did not notice the tunnelling");
        assertTrue(tunneller.haste() > 0.9);
        assertTrue(tunneller.swimTolerance() < 0.1);

        PlayerProfile stroller = new PlayerProfile();
        stroller.travelled(1000, false, false, false, false);
        assertTrue(stroller.digTolerance() < 0.1);
        assertTrue(stroller.haste() < 0.1);
    }

    @Test
    @DisplayName("notices whether you pick fights")
    void aggression() {
        PlayerProfile brave = new PlayerProfile();
        for (int i = 0; i < 20; i++) brave.sawHostile(true);
        assertTrue(brave.aggression() > 0.9);

        PlayerProfile careful = new PlayerProfile();
        for (int i = 0; i < 20; i++) careful.sawHostile(false);
        assertTrue(careful.aggression() < 0.1);
    }

    @Test
    @DisplayName("grows confident only after it has watched enough")
    void confidence() {
        PlayerProfile profile = new PlayerProfile();
        for (int i = 0; i < 5; i++) profile.placedBlock("stone");
        assertFalse(profile.confident(), "confident on five observations");

        for (int i = 0; i < 60; i++) {
            profile.placedBlock("stone");
            profile.minedBlock("stone", 30);
        }
        profile.travelled(1200, true, false, false, false);
        assertTrue(profile.confident(), "never became confident: " + profile.confidence());
        assertTrue(profile.confidence() <= 1.0);
    }

    @Test
    @DisplayName("survives a round trip through storage")
    void roundTrip() {
        PlayerProfile before = new PlayerProfile();
        for (int i = 0; i < 30; i++) before.placedBlock("birch_planks");
        for (int i = 0; i < 20; i++) before.minedBlock("iron_ore", -20);
        before.travelled(500, true, true, false, false);
        before.sawHostile(true);

        Map<String, Object> saved = before.save();
        PlayerProfile after = new PlayerProfile();
        after.load(saved);

        assertEquals(before.favouriteBuildingBlock(), after.favouriteBuildingBlock());
        assertEquals(before.preferredMiningDepth(), after.preferredMiningDepth());
        assertEquals(before.digTolerance(), after.digTolerance(), 0.0001);
        assertEquals(before.aggression(), after.aggression(), 0.0001);
    }

    @Test
    @DisplayName("shrugs off a missing or malformed save rather than throwing")
    void tolerantOfBadSaves() {
        PlayerProfile profile = new PlayerProfile();
        assertDoesNotThrow(() -> profile.load(null));
        assertDoesNotThrow(() -> profile.load(Map.of()));
        assertDoesNotThrow(() -> profile.load(Map.of("travel", Map.of("total", "not a number"))));
        assertNull(profile.favouriteBuildingBlock());
    }
}
