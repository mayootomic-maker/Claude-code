package dev.understudy.core.build;

import dev.understudy.core.build.Blueprint.Placement;
import dev.understudy.core.build.Blueprint.Role;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

class DesignsTest {

    private static final Map<Role, String> PALETTE = Designs.defaultPalette();

    private static Set<String> cells(Blueprint bp) {
        Set<String> out = new HashSet<>();
        for (Placement p : bp.placements()) out.add(p.x() + "," + p.y() + "," + p.z());
        return out;
    }

    @Test
    @DisplayName("a house is enclosed on every side at every wall height")
    void enclosed() {
        Blueprint bp = Designs.house(7, 7, 4, PALETTE);
        Set<String> filled = cells(bp);
        int doorX = 7 / 2;

        for (int y = 1; y <= 4; y++) {
            for (int x = 0; x < 7; x++) {
                for (int z = 0; z < 7; z++) {
                    boolean onWall = x == 0 || x == 6 || z == 0 || z == 6;
                    if (!onWall) continue;
                    boolean isDoorway = x == doorX && z == 0 && y <= 2;
                    String key = x + "," + y + "," + z;
                    if (isDoorway) continue;
                    assertTrue(filled.contains(key), "gap in the wall at " + key);
                }
            }
        }
    }

    @Test
    @DisplayName("the doorway is a two-high gap you can actually walk through")
    void doorway() {
        Blueprint bp = Designs.house(7, 7, 4, PALETTE);
        int doorX = 3;
        // The door item sits in the lower cell; the upper one must be clear so
        // the opening is two blocks tall.
        long upper = bp.placements().stream()
                .filter(p -> p.x() == doorX && p.y() == 2 && p.z() == 0)
                .count();
        assertEquals(0, upper, "the doorway is only one block high");
        assertTrue(bp.placements().stream()
                .anyMatch(p -> p.role() == Role.DOOR && p.optional()),
                "no door, and it must be optional so a missing door does not fail the build");
    }

    @Test
    @DisplayName("the gable ends are filled, so the roof has no holes in it")
    void gableEndsClosed() {
        // The classic mistake: step the roof in from both sides and leave two
        // open triangles at the ends for anything to walk through.
        Blueprint bp = Designs.house(7, 7, 4, PALETTE);
        Set<String> filled = cells(bp);

        int height = 4;
        for (int k = 0; k < 4; k++) {
            int y = height + 1 + k;
            int lx = -1 + k;
            int rx = 7 - k;
            if (lx > rx) break;
            for (int x = Math.max(0, lx + 1); x <= Math.min(6, rx - 1); x++) {
                assertTrue(filled.contains(x + "," + y + ",0"), "hole in the front gable at " + x + "," + y);
                assertTrue(filled.contains(x + "," + y + ",6"), "hole in the back gable at " + x + "," + y);
            }
        }
    }

    @Test
    @DisplayName("the roof is pitched, not a flat lid")
    void pitchedRoof() {
        Blueprint bp = Designs.house(9, 7, 4, PALETTE);
        int minRoofY = Integer.MAX_VALUE;
        int maxRoofY = Integer.MIN_VALUE;
        for (Placement p : bp.placements()) {
            if (p.role() != Role.ROOF) continue;
            minRoofY = Math.min(minRoofY, p.y());
            maxRoofY = Math.max(maxRoofY, p.y());
        }
        assertTrue(maxRoofY - minRoofY >= 3, "roof is flat: rises " + (maxRoofY - minRoofY));
    }

    @Test
    @DisplayName("the roof overhangs the walls")
    void overhang() {
        Blueprint bp = Designs.house(7, 7, 4, PALETTE);
        assertTrue(bp.placements().stream().anyMatch(p -> p.role() == Role.ROOF && p.x() == -1),
                "no overhang on the left");
        assertTrue(bp.placements().stream().anyMatch(p -> p.role() == Role.ROOF && p.z() == -1),
                "no overhang at the front");
    }

    @Test
    @DisplayName("counts its own materials, and separates the optional ones")
    void materials() {
        Blueprint bp = Designs.house(7, 7, 4, PALETTE);
        Map<String, Integer> all = bp.materials();
        Map<String, Integer> essential = bp.essentialMaterials();

        assertEquals(bp.blockCount(), all.values().stream().mapToInt(Integer::intValue).sum());
        assertTrue(all.containsKey("glass"), "no windows counted");
        assertFalse(essential.containsKey("glass"), "windows must not block the build");
        assertFalse(essential.containsKey("torch"));
        assertTrue(essential.get("oak_planks") > 50);
    }

    @Test
    @DisplayName("builds bottom-up, so nothing is placed against thin air")
    void buildOrderRises() {
        Blueprint bp = Designs.house(9, 9, 5, PALETTE);
        int lastY = Integer.MIN_VALUE;
        for (Placement p : bp.buildOrder()) {
            assertTrue(p.y() >= lastY, "build order goes back down at " + p);
            lastY = p.y();
        }
    }

    @Test
    @DisplayName("works away from the door, so it cannot wall itself into a corner")
    void buildOrderRetreatsToTheDoor() {
        Blueprint bp = Designs.house(9, 9, 4, PALETTE);
        List<Placement> order = bp.buildOrder();

        // Within the first wall course, the blocks nearest the entrance must be
        // placed last — that is what leaves a way out at every point.
        double firstDistance = -1;
        double lastDistance = -1;
        for (Placement p : order) {
            if (p.y() != 1 || p.role() != Role.WALL) continue;
            double d = Math.hypot(p.x() - bp.entranceX(), p.z() - bp.entranceZ());
            if (firstDistance < 0) firstDistance = d;
            lastDistance = d;
        }
        assertTrue(firstDistance > lastDistance,
                "started at the door and worked outward: " + firstDistance + " -> " + lastDistance);
    }

    @Test
    @DisplayName("fits the storage room to the number of chests asked for")
    void storageFitsChests() {
        for (int chests : new int[]{2, 8, 16, 30}) {
            Blueprint bp = Designs.storage(chests, PALETTE);
            long placed = bp.placements().stream().filter(p -> p.block().equals("chest")).count();
            assertEquals(chests, placed, "wrong number of chests for " + chests);
        }
    }

    @Test
    @DisplayName("clamps silly sizes instead of trying to build them")
    void clampsSizes() {
        assertDoesNotThrow(() -> Designs.house(1, 1, 1, PALETTE));
        assertDoesNotThrow(() -> Designs.house(9999, 9999, 9999, PALETTE));
        Blueprint huge = Designs.house(9999, 9999, 9999, PALETTE);
        assertTrue(huge.sizeX() <= 32 && huge.sizeZ() <= 32, "did not clamp: " + huge.sizeX());
    }

    @Test
    @DisplayName("builds out of the blocks you actually use")
    void paletteFollowsThePlayer() {
        Map<Role, String> palette = Designs.paletteFrom(
                List.of("spruce_planks", "cobblestone"), Designs.defaultPalette());
        assertEquals("spruce_planks", palette.get(Role.WALL));
        assertEquals("spruce_planks", palette.get(Role.FLOOR));

        Blueprint bp = Designs.house(7, 7, 4, palette);
        assertTrue(bp.materials().containsKey("spruce_planks"));
        assertFalse(bp.materials().containsKey("oak_planks"));
    }

    @Test
    @DisplayName("does not use a preferred block where it makes no sense")
    void palettePicksSuitableBlocks() {
        // Someone who has placed a lot of torches and glass has not told you
        // what their walls should be made of.
        Map<Role, String> palette = Designs.paletteFrom(
                List.of("torch", "glass", "spruce_planks"), Designs.defaultPalette());
        assertEquals("spruce_planks", palette.get(Role.WALL));
        assertNotEquals("torch", palette.get(Role.FLOOR));
        assertNotEquals("glass", palette.get(Role.WALL));
    }

    @Test
    @DisplayName("every design produces something with a way in")
    void allDesignsHaveAnEntrance() {
        List<Blueprint> all = List.of(
                Designs.house(7, 7, 4, PALETTE),
                Designs.hut(5, PALETTE),
                Designs.tower(12, 5, PALETTE),
                Designs.storage(8, PALETTE));
        for (Blueprint bp : all) {
            assertTrue(bp.blockCount() > 0, bp.name() + " is empty");
            Set<String> filled = cells(bp);
            String entrance = bp.entranceX() + "," + bp.entranceY() + "," + bp.entranceZ();
            assertFalse(filled.contains(entrance), bp.name() + " has its entrance blocked");
        }
    }

    @Test
    @DisplayName("the manor has relief, not flat walls")
    void wallsHaveDepth() {
        // The difference between a house and a box with windows in it. Every
        // projecting detail — the base course, the belt at the floor line, the
        // sills and hoods, the eaves — lives in the margin the plinth leaves,
        // so "does the wall have depth" is exactly "is the margin used".
        Blueprint manor = Catalog.build(Catalog.entries().get(Catalog.entries().size() - 1), 15,
                Materials.wood(0), Materials.stone(0));

        long projecting = manor.placements().stream()
                .filter(p -> p.y() > 0)
                .filter(p -> p.x() == 0 || p.x() == manor.sizeX() - 1
                        || p.z() == 0 || p.z() == manor.sizeZ() - 1)
                .count();
        assertTrue(projecting > 100,
                "the walls are flat: only " + projecting + " blocks stand proud");
    }

    @Test
    @DisplayName("every window has a sill under it")
    void windowsAreDressed() {
        // A pane flush in a flat wall is a hole with glass in it. This asserts
        // the thing that makes it read as a window rather than the presence of
        // a particular block.
        Blueprint manor = Catalog.build(Catalog.entries().get(Catalog.entries().size() - 1), 15,
                Materials.wood(0), Materials.stone(0));

        java.util.Set<Integer> columns = new java.util.HashSet<>();
        int lowestPane = Integer.MAX_VALUE;
        for (Blueprint.Placement p : manor.placements()) {
            if (!p.block().equals("glass_pane") || p.z() != 1) continue;
            columns.add(p.x());
            lowestPane = Math.min(lowestPane, p.y());
        }
        assertFalse(columns.isEmpty(), "no windows on the front wall at all");

        for (int x : columns) {
            int sillY = lowestPane - 1;
            boolean dressed = manor.placements().stream()
                    .anyMatch(p -> p.x() == x && p.z() == 0 && p.y() == sillY);
            assertTrue(dressed, "window at x=" + x + " has no sill");
        }
    }

    @Test
    @DisplayName("detailing never grows the site it was marked out on")
    void detailStaysInsideTheFootprint() {
        // The margin is one block. A detail that projects two would build
        // through whatever is beside the house, and the site marker would have
        // drawn the wrong square.
        for (int width = 11; width <= 23; width += 2) {
            Blueprint manor = Catalog.build(Catalog.entries().get(Catalog.entries().size() - 1),
                    width, Materials.wood(1), Materials.stone(2));
            for (Blueprint.Placement p : manor.placements()) {
                assertTrue(p.x() >= 0 && p.x() < manor.sizeX(), "x outside: " + p);
                assertTrue(p.y() >= 0 && p.y() < manor.sizeY(), "y outside: " + p);
                assertTrue(p.z() >= 0 && p.z() < manor.sizeZ(), "z outside: " + p);
            }
        }
    }
}
