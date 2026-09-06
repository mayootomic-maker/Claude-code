package dev.understudy.core.build;

import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CatalogTest {

    private static final Materials.Wood OAK = Materials.woodNamed("oak");
    private static final Materials.Stone STONE = Materials.stoneNamed("stone brick");

    @Test
    void everyListedDesignCanActuallyBeBuilt() {
        // The menu and the command both read this list, so an entry that does
        // not build is an entry the menu offers and the mod then refuses.
        for (Catalog.Entry entry : Catalog.entries()) {
            Blueprint blueprint = Catalog.build(entry, entry.defaultSize(), OAK, STONE);
            assertNotNull(blueprint, entry.id());
            assertTrue(blueprint.blockCount() > 0, entry.id() + " built nothing");
        }
    }

    @Test
    void buildsAtEverySizeItAdvertises() {
        for (Catalog.Entry entry : Catalog.entries()) {
            for (int size = entry.minSize(); size <= entry.maxSize(); size++) {
                Blueprint blueprint = Catalog.build(entry, size, OAK, STONE);
                assertTrue(blueprint.blockCount() > 0,
                        entry.id() + " at size " + size + " built nothing");
                assertFalseEmptyPreview(blueprint);
            }
        }
    }

    private static void assertFalseEmptyPreview(Blueprint blueprint) {
        assertTrue(!Preview.of(blueprint).isEmpty(), blueprint.name() + " has no picture");
    }

    @Test
    void clampsSizesOutsideItsRange() {
        Catalog.Entry hut = Catalog.byId("hut");
        assertNotNull(hut);
        Blueprint tiny = Catalog.build(hut, -50, OAK, STONE);
        Blueprint huge = Catalog.build(hut, 5000, OAK, STONE);
        assertTrue(tiny.blockCount() > 0);
        assertTrue(huge.blockCount() > 0);
        assertTrue(huge.blockCount() > tiny.blockCount());
    }

    @Test
    void idsAreUnique() {
        Set<String> seen = new HashSet<>();
        for (Catalog.Entry entry : Catalog.entries()) {
            assertTrue(seen.add(entry.id()), "two designs called " + entry.id());
        }
        assertEquals(seen.size(), Catalog.ids().size());
    }

    @Test
    void everyDesignSaysWhatItIs() {
        for (Catalog.Entry entry : Catalog.entries()) {
            assertTrue(entry.summary().length() > 20, entry.id() + " needs a real description");
            assertTrue(entry.minSize() < entry.maxSize(), entry.id() + " has no size range");
            assertTrue(entry.defaultSize() >= entry.minSize()
                    && entry.defaultSize() <= entry.maxSize(),
                    entry.id() + " defaults outside its own range");
        }
    }

    @Test
    void unknownNamesAreRefusedRatherThanGuessed() {
        assertNull(Catalog.byId("mansion"));
        assertThrows(IllegalArgumentException.class,
                () -> Catalog.build("mansion", 8, OAK, STONE));
    }
}
