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

    /** One wood and one masonry, so a design's shape is what varies in a test. */
    private static final Materials.Wood OAK = Materials.woodNamed("oak");
    private static final Materials.Stone BRICK = Materials.stoneNamed("stone brick");

    private static final Map<Role, String> PALETTE = Designs.defaultPalette();

    private static Set<String> cells(Blueprint bp) {
        Set<String> out = new HashSet<>();
        for (Placement p : bp.placements()) out.add(p.x() + "," + p.y() + "," + p.z());
        return out;
    }

    @Test
    @DisplayName("a house is enclosed on every side at every wall height")
    void enclosed() {
        // The building stands at x,z in 1..7, with the plinth one block proud
        // all round — the Manor's convention, which every design now shares.
        Blueprint bp = Designs.house(7, 7, 4, PALETTE, OAK, BRICK);
        Set<String> filled = cells(bp);
        int doorX = (7 + 1) / 2;

        for (int y = 1; y <= 4; y++) {
            for (int x = 1; x <= 7; x++) {
                for (int z = 1; z <= 7; z++) {
                    boolean onWall = x == 1 || x == 7 || z == 1 || z == 7;
                    if (!onWall) continue;
                    boolean isDoorway = x == doorX && z == 1 && y <= 2;
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
        Blueprint bp = Designs.house(7, 7, 4, PALETTE, OAK, BRICK);
        int doorX = 4;
        // The door item sits in the lower cell; the upper one must be clear so
        // the opening is two blocks tall.
        long upper = bp.placements().stream()
                .filter(p -> p.x() == doorX && p.y() == 2 && p.z() == 1)
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
        Blueprint bp = Designs.house(7, 7, 4, PALETTE, OAK, BRICK);
        Set<String> filled = cells(bp);

        // The ridge runs along x, so the triangles to close are the two ends at
        // x = 0 and x = w + 1 — one block proud of the walls, because the roof
        // overhangs. Each course steps in from both sides in z.
        int base = 5;
        for (int course = 0; ; course++) {
            int y = base + course;
            int near = course;
            int far = 7 + 1 - course;
            if (near >= far) break;
            for (int z = near + 1; z < far; z++) {
                assertTrue(filled.contains("0," + y + "," + z),
                        "hole in the left gable at " + y + "," + z);
                assertTrue(filled.contains("8," + y + "," + z),
                        "hole in the right gable at " + y + "," + z);
            }
        }
    }

    @Test
    @DisplayName("the roof is pitched, not a flat lid")
    void pitchedRoof() {
        Blueprint bp = Designs.house(9, 7, 4, PALETTE, OAK, BRICK);
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
        Blueprint bp = Designs.house(7, 7, 4, PALETTE, OAK, BRICK);
        // The walls stand at 1..7, so a roof block at 0 or at 8 is past them.
        assertTrue(bp.placements().stream().anyMatch(p -> p.role() == Role.ROOF && p.x() == 0),
                "no overhang on the left");
        assertTrue(bp.placements().stream().anyMatch(p -> p.role() == Role.ROOF && p.x() == 8),
                "no overhang on the right");
        assertTrue(bp.placements().stream().anyMatch(p -> p.role() == Role.ROOF && p.z() == 0),
                "no overhang at the front");
    }

    @Test
    @DisplayName("counts its own materials, and separates the optional ones")
    void materials() {
        Blueprint bp = Designs.house(7, 7, 4, PALETTE, OAK, BRICK);
        Map<String, Integer> all = bp.materials();
        Map<String, Integer> essential = bp.essentialMaterials();

        assertEquals(bp.blockCount(), all.values().stream().mapToInt(Integer::intValue).sum());
        assertTrue(all.containsKey("glass_pane"), "no windows counted");
        assertFalse(essential.containsKey("glass_pane"), "windows must not block the build");
        assertFalse(essential.containsKey("lantern"));
        assertTrue(essential.get("oak_planks") > 50);
    }

    @Test
    @DisplayName("builds bottom-up, so nothing is placed against thin air")
    void buildOrderRises() {
        Blueprint bp = Designs.house(9, 9, 5, PALETTE, OAK, BRICK);
        int lastY = Integer.MIN_VALUE;
        for (Placement p : bp.buildOrder()) {
            assertTrue(p.y() >= lastY, "build order goes back down at " + p);
            lastY = p.y();
        }
    }

    @Test
    @DisplayName("leaves the doorway open, so it can always get out")
    void theDoorwayIsNeverBuiltOver() {
        // This replaces a test that asserted the wall course was laid furthest
        // from the door first. That did keep a way out, but it did it by
        // ordering, and the ordering it forced was the reason the builder spent
        // its day crossing the site — a symmetrical house has two walls the
        // same distance from the door, so it alternated between them.
        //
        // The guarantee is better without it. Nothing is ever placed in the
        // doorway at standing height, in any design, so the way out exists from
        // the first course to the last whatever order the blocks go in. That is
        // the property worth holding, and it does not cost a single step.
        for (String id : Catalog.ids()) {
            Blueprint bp = Catalog.build(id, Catalog.byId(id).defaultSize(), OAK, BRICK);
            for (Placement p : bp.placements()) {
                boolean inTheDoorway = p.x() == bp.entranceX() && p.z() == bp.entranceZ()
                        && p.y() >= bp.entranceY() && p.y() <= bp.entranceY() + 1;
                assertFalse(inTheDoorway,
                        id + " puts " + p.block() + " in its own doorway at "
                                + p.x() + "," + p.y() + "," + p.z());
            }
        }
    }

    @Test
    @DisplayName("fits the storage room to the number of chests asked for")
    void storageFitsChests() {
        for (int chests : new int[]{2, 8, 16, 30}) {
            Blueprint bp = Designs.storage(chests, PALETTE, OAK, BRICK);
            long placed = bp.placements().stream().filter(p -> p.block().equals("chest")).count();
            assertEquals(chests, placed, "wrong number of chests for " + chests);
        }
    }

    @Test
    @DisplayName("clamps silly sizes instead of trying to build them")
    void clampsSizes() {
        assertDoesNotThrow(() -> Designs.house(1, 1, 1, PALETTE, OAK, BRICK));
        assertDoesNotThrow(() -> Designs.house(9999, 9999, 9999, PALETTE, OAK, BRICK));
        Blueprint huge = Designs.house(9999, 9999, 9999, PALETTE, OAK, BRICK);
        assertTrue(huge.sizeX() <= 32 && huge.sizeZ() <= 32, "did not clamp: " + huge.sizeX());
    }

    @Test
    @DisplayName("builds out of the blocks you actually use")
    void paletteFollowsThePlayer() {
        Map<Role, String> palette = Designs.paletteFrom(
                List.of("spruce_planks", "cobblestone"), Designs.defaultPalette());
        assertEquals("spruce_planks", palette.get(Role.WALL));
        assertEquals("spruce_planks", palette.get(Role.FLOOR));

        Blueprint bp = Designs.house(7, 7, 4, palette, OAK, BRICK);
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
                Designs.house(7, 7, 4, PALETTE, OAK, BRICK),
                Designs.hut(5, PALETTE, OAK, BRICK),
                Designs.tower(12, 5, PALETTE, OAK, BRICK),
                Designs.storage(8, PALETTE, OAK, BRICK));
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

    @Test
    @DisplayName("every design has relief, not just the manor")
    void allDesignsHaveDepth() {
        // The complaint this answers: four of the five buildings were a floor,
        // a shell, a lid and a hole for a door. Every projecting detail — the
        // plinth, the base course, the sills, the eaves, the overhanging roof —
        // lives in the one-block margin the plinth leaves, so "does this wall
        // have depth" is exactly "is the margin used".
        for (Blueprint bp : List.of(
                Designs.hut(7, PALETTE, OAK, BRICK),
                Designs.house(11, 9, 4, PALETTE, OAK, BRICK),
                Designs.tower(14, 5, PALETTE, OAK, BRICK),
                Designs.storage(10, PALETTE, OAK, BRICK))) {
            long projecting = bp.placements().stream()
                    .filter(p -> p.y() > 0)
                    .filter(p -> p.x() == 0 || p.x() == bp.sizeX() - 1
                            || p.z() == 0 || p.z() == bp.sizeZ() - 1)
                    .count();
            assertTrue(projecting > 20,
                    bp.name() + " is a flat box: only " + projecting + " blocks stand proud");
        }
    }

    @Test
    @DisplayName("every design is built from more than four kinds of block")
    void allDesignsAreDetailed() {
        // A crude proxy for detailing and a hard one to fake: stairs, slabs,
        // fences, panes and masonry all have to be in there before this passes.
        for (Blueprint bp : List.of(
                Designs.hut(5, PALETTE, OAK, BRICK),
                Designs.house(9, 7, 4, PALETTE, OAK, BRICK),
                Designs.tower(12, 5, PALETTE, OAK, BRICK),
                Designs.storage(8, PALETTE, OAK, BRICK))) {
            assertTrue(bp.materials().size() >= 8,
                    bp.name() + " uses only " + bp.materials().size() + " kinds of block");
        }
    }

    @Test
    @DisplayName("nothing is ever placed outside the site that was marked")
    void nothingEscapesTheFootprint() {
        // The marker draws the blueprint's own bounds, and the bounds are
        // computed from the maximum coordinate — so a block at a negative one
        // is a block outside the box the player agreed to. Three of these
        // designs used to put their roofs there.
        for (Blueprint bp : List.of(
                Designs.hut(9, PALETTE, OAK, BRICK),
                Designs.house(16, 12, 5, PALETTE, OAK, BRICK),
                Designs.tower(24, 7, PALETTE, OAK, BRICK),
                Designs.storage(24, PALETTE, OAK, BRICK),
                Manor.build(15, OAK, BRICK))) {
            for (Placement p : bp.placements()) {
                assertTrue(p.x() >= 0 && p.y() >= 0 && p.z() >= 0,
                        bp.name() + " places a block outside the site at " + p);
                assertTrue(p.x() < bp.sizeX() && p.y() < bp.sizeY() && p.z() < bp.sizeZ(),
                        bp.name() + " places a block past its own bounds at " + p);
            }
        }
    }

    @Test
    @DisplayName("the roof is pitched along the long side of the building")
    void ridgeFollowsThePlan() {
        // A five-by-seventeen store room pitched across its long side climbs
        // nine courses and looks like a spire over a shed. The axis has to come
        // from the plan.
        Blueprint deep = Designs.storage(24, PALETTE, OAK, BRICK);
        assertTrue(deep.sizeZ() > deep.sizeX(), "expected a long narrow store room");

        int lowest = Integer.MAX_VALUE;
        int highest = Integer.MIN_VALUE;
        for (Placement p : deep.placements()) {
            if (p.role() != Role.ROOF) continue;
            lowest = Math.min(lowest, p.y());
            highest = Math.max(highest, p.y());
        }
        // Pitched across the short side, the rise is half of it. Pitched across
        // the long side it would be three times that.
        assertTrue(highest - lowest <= Math.min(deep.sizeX(), deep.sizeZ()) / 2 + 1,
                "roof pitched the wrong way: rises " + (highest - lowest)
                        + " over a " + deep.sizeX() + " by " + deep.sizeZ() + " plan");
    }

    @Test
    @DisplayName("a chest is never buried under a solid block")
    void chestsCanBeOpened() {
        // Not an aesthetic rule. A chest with a solid block directly above it
        // does not open, which turns a storage room into a wall of decoration.
        Blueprint bp = Designs.storage(20, PALETTE, OAK, BRICK);
        Set<String> filled = cells(bp);
        for (Placement p : bp.placements()) {
            if (!p.block().equals("chest")) continue;
            assertFalse(filled.contains(p.x() + "," + (p.y() + 1) + "," + p.z()),
                    "chest at " + p.x() + "," + p.y() + "," + p.z() + " cannot be opened");
        }
    }

    @Test
    @DisplayName("the tower can actually be climbed")
    void towerHasAWayUp() {
        // A lookout you cannot get to the top of is scenery. The old one was a
        // hollow shell with a lid on it.
        Blueprint bp = Designs.tower(16, 5, PALETTE, OAK, BRICK);
        long rungs = bp.placements().stream().filter(p -> p.block().equals("ladder")).count();
        assertTrue(rungs >= 16, "only " + rungs + " rungs in a 16-block tower");
    }

    @Test
    @DisplayName("the study's shelves are where the game actually counts them")
    void shelvesAreOnTheRing() {
        // Not aesthetic. A bookshelf counts only two blocks from the table with
        // air between, so a room with shelves stacked against it is a room full
        // of decoration — the commonest way this gets built, and the reason
        // people wonder why their table only offers level eight.
        Blueprint study = Catalog.build("study", 9, OAK, BRICK);
        Placement table = study.placements().stream()
                .filter(p -> p.block().equals("enchanting_table")).findFirst().orElseThrow();
        Set<String> filled = cells(study);

        long shelves = 0;
        for (Placement p : study.placements()) {
            if (!p.block().equals("bookshelf")) continue;
            shelves++;
            int ring = Math.max(Math.abs(p.x() - table.x()), Math.abs(p.z() - table.z()));
            assertEquals(2, ring, "shelf at the wrong distance from the table");

            // And the block between has to be empty, or it does not count.
            int betweenX = table.x() + Integer.signum(p.x() - table.x());
            int betweenZ = table.z() + Integer.signum(p.z() - table.z());
            assertFalse(filled.contains(betweenX + "," + p.y() + "," + betweenZ),
                    "something between the table and a shelf at "
                            + p.x() + "," + p.y() + "," + p.z());
        }
        assertEquals(15, shelves, "a table with " + shelves + " shelves is a worse table");
    }

    /**
     * The doorway keeps its lamps.
     *
     * A Draft cell holds one block, so a later call to set() on the same cell
     * is a silent replacement — and the porch canopy used to run the full width
     * of the porch, straight through the two cells the doorway lamps go in.
     * Every design with a porch had an unlit door and nothing anywhere said so.
     * That is the failure mode of a builder made of overlapping passes, and the
     * only defence is to assert that the last pass left the earlier one alone.
     */
    @Test
    @DisplayName("a lit doorway stays lit after the porch goes on")
    void theDoorwayKeepsItsLamps() {
        Blueprint bp = Designs.house(9, 7, 4, PALETTE, OAK, BRICK);
        long lamps = bp.placements().stream()
                .filter(p -> p.role() == Role.LIGHT)
                .filter(p -> p.z() == bp.entranceZ())
                .count();
        assertEquals(2, lamps, "the porch has eaten the doorway lamps again");
    }
}
