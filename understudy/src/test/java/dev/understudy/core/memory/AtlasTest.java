package dev.understudy.core.memory;

import dev.understudy.core.memory.Atlas.Sighting;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class AtlasTest {

    @Test
    @DisplayName("remembers what a person would have forgotten")
    void remembersEverythingSeen() {
        // The whole point. A scan looks at a third of a million blocks and used
        // to keep the one it wanted; this keeps the other thirteen too.
        Atlas atlas = new Atlas();
        atlas.saw("iron_ore", 100, 40, 100, 1);
        atlas.saw("iron_ore", -300, 12, 80, 2);
        atlas.saw("coal_ore", 5, 60, 5, 3);

        assertEquals(2, atlas.known("iron_ore").size());
        assertEquals(3, atlas.size());
        assertEquals(2, atlas.summary().get("iron_ore"));
    }

    @Test
    @DisplayName("finds the nearest one rather than the first one remembered")
    void nearestWins() {
        Atlas atlas = new Atlas();
        atlas.saw("iron_ore", 500, 40, 0, 1);
        atlas.saw("iron_ore", 20, 40, 0, 2);
        atlas.saw("iron_ore", 900, 40, 0, 3);

        Sighting nearest = atlas.nearest("iron_ore", 0, 40, 0);
        assertNotNull(nearest);
        assertEquals(20, nearest.x());
    }

    @Test
    @DisplayName("seeing the same block twice is one memory, not two")
    void doesNotDuplicate() {
        Atlas atlas = new Atlas();
        atlas.saw("iron_ore", 10, 40, 10, 1);
        atlas.saw("iron_ore", 10, 40, 10, 500);
        assertEquals(1, atlas.size());
        assertEquals(500, atlas.known("iron_ore").get(0).tick(), "did not refresh how recently");
    }

    @Test
    @DisplayName("forgets a place once it turns out to be wrong")
    void forgetsWhatIsGone() {
        // A map that only ever gains entries becomes a map of where things used
        // to be, which is worse than no map: it sends you somewhere.
        Atlas atlas = new Atlas();
        atlas.saw("iron_ore", 10, 40, 10, 1);
        atlas.forget(10, 40, 10);

        assertEquals(0, atlas.size());
        assertNull(atlas.nearest("iron_ore", 0, 0, 0));
        assertTrue(atlas.known("iron_ore").isEmpty());
    }

    @Test
    @DisplayName("a block that became something else is not still the old thing")
    void overwritesWhenTheBlockChanges() {
        Atlas atlas = new Atlas();
        atlas.saw("iron_ore", 10, 40, 10, 1);
        atlas.saw("stone", 10, 40, 10, 2);

        assertTrue(atlas.known("iron_ore").isEmpty(), "still thinks there is iron there");
        assertEquals(1, atlas.known("stone").size());
        assertEquals(1, atlas.size());
    }

    @Test
    @DisplayName("stays bounded, and drops the oldest first")
    void boundedByCapacity() {
        // A session runs for hours and a scan is enormous. Unbounded is fine
        // right up until the session where it is not.
        Atlas atlas = new Atlas();
        for (int i = 0; i < Atlas.CAPACITY + 500; i++) {
            atlas.saw("stone", i, 40, 0, i);
        }
        assertEquals(Atlas.CAPACITY, atlas.size());
        // The oldest five hundred are the ones gone, and the newest are all
        // still there — evicting arbitrarily would pass a size check and lose
        // the sighting from a minute ago.
        assertTrue(atlas.known("stone").stream().noneMatch(s -> s.x() < 500),
                "kept the oldest");
        assertNotNull(atlas.nearest("stone", Atlas.CAPACITY + 400, 40, 0),
                "dropped one of the newest");
    }

    @Test
    @DisplayName("asking about something never seen is empty, not an error")
    void unknownIsEmpty() {
        Atlas atlas = new Atlas();
        assertNull(atlas.nearest("diamond_ore", 0, 0, 0));
        assertTrue(atlas.known("diamond_ore").isEmpty());
        assertTrue(atlas.summary().isEmpty());
    }
}
