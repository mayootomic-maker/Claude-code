package dev.understudy.core.build;

import dev.understudy.core.nbt.NbtWriter;
import dev.understudy.core.nbt.NbtWriter.Value;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SchematicTest {

    // --- Sponge .schem -------------------------------------------------------

    private static Value.Comp spongeSchem() {
        // 2x2x2, chequered stone and air, with one oriented stair.
        Map<String, Integer> palette = Map.of("minecraft:air", 0, "minecraft:stone", 1,
                "minecraft:oak_stairs[facing=west,half=bottom]", 2);
        Value.Comp paletteTag = NbtWriter.compound(
                "minecraft:air", new Value.I(0),
                "minecraft:stone", new Value.I(1),
                "minecraft:oak_stairs[facing=west,half=bottom]", new Value.I(2));

        // Order is y, then z, then x.
        int[] ids = {1, 0, 0, 1, 0, 1, 2, 0};
        ByteArrayOutputStream data = new ByteArrayOutputStream();
        for (int id : ids) data.write(id); // all under 128, so one byte each
        return NbtWriter.compound(
                "Version", new Value.I(2),
                "Width", new Value.S((short) 2),
                "Height", new Value.S((short) 2),
                "Length", new Value.S((short) 2),
                "Palette", paletteTag,
                "BlockData", new Value.Bytes(data.toByteArray()));
    }

    @Test
    void readsASpongeSchematic() throws IOException {
        Schematic.Result result = Schematic.read("cabin.schem", NbtWriter.gzip(spongeSchem()));
        Blueprint blueprint = result.blueprint();
        assertEquals("cabin", blueprint.name(), "the file name becomes the design name");
        assertEquals(4, blueprint.blockCount(), "air is dropped: four of eight cells are solid");
        assertEquals(Map.of("stone", 3, "oak_stairs", 1), blueprint.materials());
    }

    @Test
    void keepsTheOrientationOfImportedStairs() throws IOException {
        // A roof imported without facings is a pile of stairs. The state string
        // carries it, so it has to survive the import.
        Schematic.Result result = Schematic.read("roof.schem", NbtWriter.gzip(spongeSchem()));
        Blueprint.Placement stair = result.blueprint().placements().stream()
                .filter(p -> p.block().equals("oak_stairs")).findFirst().orElseThrow();
        assertEquals(Facing.WEST, stair.facing());
    }

    @Test
    void readsAnUncompressedFileToo() throws IOException {
        // Every schematic in circulation is gzipped, but plain ones exist and
        // sniffing two bytes is cheaper than being wrong.
        assertEquals(4, Schematic.read("plain.schem", NbtWriter.plain(spongeSchem()))
                .blueprint().blockCount());
    }

    @Test
    void handlesAPaletteBiggerThanAByte() throws IOException {
        // Varints: anything past 127 needs a second byte, and reading it as one
        // silently builds the wrong blocks rather than failing.
        List<Value> ignored = new ArrayList<>();
        Map<String, Value> palette = new java.util.LinkedHashMap<>();
        for (int i = 0; i < 200; i++) palette.put("minecraft:block_" + i, new Value.I(i));
        ByteArrayOutputStream data = new ByteArrayOutputStream();
        // One block, id 199, encoded as a two-byte varint.
        data.write(199 & 0x7F | 0x80);
        data.write(199 >>> 7);
        Value.Comp root = NbtWriter.compound(
                "Width", new Value.S((short) 1),
                "Height", new Value.S((short) 1),
                "Length", new Value.S((short) 1),
                "Palette", new Value.Comp(palette),
                "BlockData", new Value.Bytes(data.toByteArray()));

        Blueprint blueprint = Schematic.read("big.schem", NbtWriter.gzip(root)).blueprint();
        assertEquals(Map.of("block_199", 1), blueprint.materials());
        assertTrue(ignored.isEmpty());
    }

    // --- vanilla structure ---------------------------------------------------

    @Test
    void readsAVanillaStructure() throws IOException {
        Value.ListOf palette = new Value.ListOf(10, List.of(
                NbtWriter.compound("Name", new Value.Str("minecraft:oak_planks")),
                NbtWriter.compound("Name", new Value.Str("minecraft:oak_stairs"),
                        "Properties", NbtWriter.compound("facing", new Value.Str("south")))));
        Value.ListOf blocks = new Value.ListOf(10, List.of(
                NbtWriter.compound("pos", new Value.ListOf(3,
                        List.of(new Value.I(0), new Value.I(0), new Value.I(0))),
                        "state", new Value.I(0)),
                NbtWriter.compound("pos", new Value.ListOf(3,
                        List.of(new Value.I(1), new Value.I(2), new Value.I(3))),
                        "state", new Value.I(1))));
        Value.Comp root = NbtWriter.compound(
                "size", new Value.ListOf(3, List.of(new Value.I(2), new Value.I(3), new Value.I(4))),
                "palette", palette, "blocks", blocks);

        Blueprint blueprint = Schematic.read("shed.nbt", NbtWriter.gzip(root)).blueprint();
        assertEquals(2, blueprint.blockCount());
        Blueprint.Placement stair = blueprint.placements().stream()
                .filter(p -> p.block().equals("oak_stairs")).findFirst().orElseThrow();
        assertEquals(Facing.SOUTH, stair.facing(), "Properties carry the facing here, not the name");
    }

    // --- litematica ----------------------------------------------------------

    /** Pack indices at the given bit width, letting entries straddle longs. */
    private static long[] pack(int[] values, int bits) {
        long totalBits = (long) values.length * bits;
        long[] packed = new long[(int) ((totalBits + 63) / 64)];
        for (int i = 0; i < values.length; i++) {
            long start = (long) i * bits;
            int index = (int) (start >>> 6);
            int offset = (int) (start & 63);
            packed[index] |= ((long) values[i] & ((1L << bits) - 1)) << offset;
            if (offset + bits > 64) {
                packed[index + 1] |= ((long) values[i] & ((1L << bits) - 1)) >>> (64 - offset);
            }
        }
        return packed;
    }

    @Test
    void readsALitematic() throws IOException {
        Value.ListOf palette = new Value.ListOf(10, List.of(
                NbtWriter.compound("Name", new Value.Str("minecraft:air")),
                NbtWriter.compound("Name", new Value.Str("minecraft:cobblestone")),
                NbtWriter.compound("Name", new Value.Str("minecraft:glass"))));
        int[] states = {1, 2, 0, 1, 1, 0, 2, 1}; // 2x2x2, y then z then x
        Value.Comp region = NbtWriter.compound(
                "Size", NbtWriter.compound("x", new Value.I(2), "y", new Value.I(2),
                        "z", new Value.I(2)),
                "Position", NbtWriter.compound("x", new Value.I(0), "y", new Value.I(0),
                        "z", new Value.I(0)),
                "BlockStatePalette", palette,
                "BlockStates", new Value.Longs(pack(states, 2)));
        Value.Comp root = NbtWriter.compound("Regions", NbtWriter.compound("main", region));

        Blueprint blueprint = Schematic.read("tower.litematic", NbtWriter.gzip(root)).blueprint();
        assertEquals(Map.of("cobblestone", 4, "glass", 2), blueprint.materials());
    }

    @Test
    void readsEntriesThatStraddleTwoLongs() throws IOException {
        // Litematica, unlike the chunk format, lets an entry cross the boundary
        // between two longs. Reading it the chunk way produces a building made
        // of the wrong blocks, which is worse than failing.
        List<Value> names = new ArrayList<>();
        names.add(NbtWriter.compound("Name", new Value.Str("minecraft:air")));
        for (int i = 1; i < 40; i++) {
            names.add(NbtWriter.compound("Name", new Value.Str("minecraft:block_" + i)));
        }
        int bits = 6; // 40 entries needs six bits, and 64 is not a multiple of six
        int[] states = new int[27];
        for (int i = 0; i < states.length; i++) states[i] = (i % 39) + 1;

        Value.Comp region = NbtWriter.compound(
                "Size", NbtWriter.compound("x", new Value.I(3), "y", new Value.I(3),
                        "z", new Value.I(3)),
                "Position", NbtWriter.compound("x", new Value.I(0), "y", new Value.I(0),
                        "z", new Value.I(0)),
                "BlockStatePalette", new Value.ListOf(10, names),
                "BlockStates", new Value.Longs(pack(states, bits)));
        Value.Comp root = NbtWriter.compound("Regions", NbtWriter.compound("main", region));

        Blueprint blueprint = Schematic.read("wide.litematic", NbtWriter.gzip(root)).blueprint();
        assertEquals(27, blueprint.blockCount(), "every entry should decode");
        for (int i = 0; i < 27; i++) {
            String expected = "block_" + ((i % 39) + 1);
            assertTrue(blueprint.materials().containsKey(expected),
                    "entry " + i + " should have decoded to " + expected
                            + " but the palette came out as " + blueprint.materials().keySet());
        }
    }

    @Test
    void shiftsAnOffsetRegionBackToTheOrigin() throws IOException {
        // Schematics are saved wherever they happened to be in someone's world.
        // A blueprint is relative to its own corner, or the footprint the site
        // marker draws is in the wrong place and the wrong size.
        Value.ListOf palette = new Value.ListOf(10, List.of(
                NbtWriter.compound("Name", new Value.Str("minecraft:stone"))));
        Value.Comp region = NbtWriter.compound(
                "Size", NbtWriter.compound("x", new Value.I(2), "y", new Value.I(1),
                        "z", new Value.I(1)),
                "Position", NbtWriter.compound("x", new Value.I(-1500), "y", new Value.I(63),
                        "z", new Value.I(2400)),
                "BlockStatePalette", palette,
                "BlockStates", new Value.Longs(pack(new int[]{0, 0}, 2)));
        Value.Comp root = NbtWriter.compound("Regions", NbtWriter.compound("main", region));

        Blueprint blueprint = Schematic.read("far.litematic", NbtWriter.gzip(root)).blueprint();
        assertEquals(2, blueprint.blockCount());
        assertTrue(blueprint.placements().stream().allMatch(p -> p.x() >= 0 && p.y() >= 0 && p.z() >= 0),
                "everything should be shifted to non-negative coordinates");
        assertEquals(2, blueprint.sizeX());
        assertEquals(1, blueprint.sizeY());
        assertEquals(1, blueprint.sizeZ());
    }

    // --- refusals ------------------------------------------------------------

    @Test
    void refusesSomethingThatIsNotASchematic() {
        IOException error = assertThrows(IOException.class,
                () -> Schematic.read("notes.txt", "hello".getBytes()));
        assertNotNull(error.getMessage());
    }

    @Test
    void refusesAFileOfNothingButAir() throws IOException {
        Value.Comp root = NbtWriter.compound(
                "Width", new Value.S((short) 1), "Height", new Value.S((short) 1),
                "Length", new Value.S((short) 1),
                "Palette", NbtWriter.compound("minecraft:air", new Value.I(0)),
                "BlockData", new Value.Bytes(new byte[]{0}));
        byte[] file = NbtWriter.gzip(root);
        IOException error = assertThrows(IOException.class, () -> Schematic.read("empty.schem", file));
        assertTrue(error.getMessage().contains("air"));
    }

    @Test
    void refusesSomethingTooBigToBuild() throws IOException {
        Value.Comp root = NbtWriter.compound(
                "Width", new Value.S((short) 800), "Height", new Value.S((short) 300),
                "Length", new Value.S((short) 800),
                "Palette", NbtWriter.compound("minecraft:stone", new Value.I(0)),
                "BlockData", new Value.Bytes(new byte[]{0}));
        byte[] file = NbtWriter.gzip(root);
        IOException error = assertThrows(IOException.class, () -> Schematic.read("huge.schem", file));
        // Still refused, and still says its size — but for the honest reason,
        // which is the walking rather than the building. Eight hundred cubed is
        // a hundred and ninety million cells; the tall thin sky farm that used
        // to be caught by the same rule is a quarter of a million and reads.
        assertTrue(error.getMessage().contains("800"), error.getMessage());
        assertTrue(error.getMessage().contains("cells"), error.getMessage());
    }

    @Test
    void anImportedBuildStillGetsAPicture() throws IOException {
        // The preview works off any blueprint, so an import gets one for free —
        // which is the point of importing into the same menu.
        Blueprint blueprint = Schematic.read("cabin.schem", NbtWriter.gzip(spongeSchem())).blueprint();
        assertTrue(!Preview.of(blueprint).isEmpty());
    }

    @Test
    void flippingPutsTheRoofBackOnTop() {
        // A file does not say which way is up — .obj has no field for it and
        // .stl has no fields at all — so the menu asks. This is that control.
        Draft draft = new Draft("tower");
        draft.set(0, 0, 0, "stone", Blueprint.Role.FLOOR, false);
        draft.set(0, 1, 0, "stone", Blueprint.Role.WALL, false);
        draft.set(0, 2, 0, "glass", Blueprint.Role.ROOF, false);
        Blueprint upright = draft.finish(0, 0, 0);

        Blueprint flipped = upright.turned(0, true);
        assertEquals(3, flipped.sizeY());
        assertEquals("glass", blockAt(flipped, 0, 0, 0), "the roof should be at the bottom now");
        assertEquals("stone", blockAt(flipped, 0, 2, 0));
        assertEquals(upright.blockCount(), flipped.blockCount());
        // And flipping twice is where you started.
        assertEquals("stone", blockAt(flipped.turned(0, true), 0, 0, 0));
    }

    @Test
    void turningMovesTheFootprintAndTheStairsTogether() {
        Draft draft = new Draft("L");
        draft.set(0, 0, 0, "stone", Blueprint.Role.FLOOR, false);
        draft.set(3, 0, 0, "oak_stairs", Blueprint.Role.ROOF, false, Facing.NORTH);
        draft.set(0, 0, 1, "stone", Blueprint.Role.FLOOR, false);
        Blueprint one = draft.finish(0, 0, 0);
        assertEquals(4, one.sizeX());
        assertEquals(2, one.sizeZ());

        Blueprint turned = one.turned(1, false);
        // A quarter turn swaps the footprint over.
        assertEquals(2, turned.sizeX());
        assertEquals(4, turned.sizeZ());
        assertEquals(one.blockCount(), turned.blockCount());
        // Stairs must turn with the building, or a roof comes out inside out.
        Blueprint.Placement stairs = turned.placements().stream()
                .filter(p -> p.block().equals("oak_stairs"))
                .findFirst().orElseThrow();
        assertEquals(Facing.EAST, stairs.facing());
        // Four turns is the identity, footprint and facing alike.
        Blueprint round = one.turned(4, false);
        assertEquals(one.sizeX(), round.sizeX());
        assertEquals(Facing.NORTH, round.placements().stream()
                .filter(p -> p.block().equals("oak_stairs"))
                .findFirst().orElseThrow().facing());
    }

    @Test
    void everyBlockStaysInsideTheFootprintAfterTurning() {
        // The invariant that matters: a turned blueprint whose blocks fall
        // outside its own size builds through whatever is next to the site.
        Blueprint manor = Catalog.build(Catalog.entries().get(0), 9,
                Materials.wood(0), Materials.stone(0));
        for (int turns = 0; turns < 4; turns++) {
            for (boolean flip : new boolean[]{false, true}) {
                Blueprint moved = manor.turned(turns, flip);
                for (Blueprint.Placement p : moved.placements()) {
                    assertTrue(p.x() >= 0 && p.x() < moved.sizeX(), "x out of bounds: " + p);
                    assertTrue(p.y() >= 0 && p.y() < moved.sizeY(), "y out of bounds: " + p);
                    assertTrue(p.z() >= 0 && p.z() < moved.sizeZ(), "z out of bounds: " + p);
                }
            }
        }
    }

    private static String blockAt(Blueprint blueprint, int x, int y, int z) {
        return blueprint.placements().stream()
                .filter(p -> p.x() == x && p.y() == y && p.z() == z)
                .map(Blueprint.Placement::block)
                .findFirst().orElse(null);
    }

    /** The rule the game enforces: a block goes against a face that exists. */
    private static int unplaceable(Blueprint blueprint) {
        int[][] sides = {{1,0,0},{-1,0,0},{0,1,0},{0,-1,0},{0,0,1},{0,0,-1}};
        java.util.Set<Long> world = new java.util.HashSet<>();
        int stuck = 0;
        for (Blueprint.Placement p : blueprint.buildOrder()) {
            boolean against = false;
            for (int[] side : sides) {
                int ny = p.y() + side[1];
                // Below the floor is the ground the site sits on, which is
                // always something to click.
                if (ny < 0) { against = true; break; }
                if (world.contains(cell(p.x() + side[0], ny, p.z() + side[2]))) {
                    against = true;
                    break;
                }
            }
            if (!against) stuck++;
            else world.add(cell(p.x(), p.y(), p.z()));
        }
        return stuck;
    }

    private static long cell(int x, int y, int z) {
        return ((long) (x & 0xFFFF) << 32) | ((long) (z & 0xFFFF) << 16) | (y & 0xFFFF);
    }

    @Test
    void everyDesignCanBeBuiltInTheOrderItIsGiven() {
        // Bottom-up is not enough on its own. An eave, an overhang or the first
        // block of a course has nothing beside it when its turn comes, and each
        // one that fails takes the support out from under its neighbours — on
        // the manor that cascade turned two impossible blocks into 271. The
        // order has to grow outward from what is already standing.
        for (Catalog.Entry entry : Catalog.entries()) {
            Blueprint design = Catalog.build(entry, entry.defaultSize(),
                    Materials.wood(0), Materials.stone(0));
            assertEquals(0, unplaceable(design),
                    entry.name() + " has blocks with nothing to place them against");
        }
    }

    @Test
    void turningADesignDoesNotBreakItsBuildOrder() {
        // A turned building is a different set of coordinates, and an order that
        // only worked in the original orientation would strand half a roof.
        Blueprint manor = Catalog.build(Catalog.entries().get(Catalog.entries().size() - 1), 9,
                Materials.wood(2), Materials.stone(1));
        for (int turns = 0; turns < 4; turns++) {
            assertEquals(0, unplaceable(manor.turned(turns, false)),
                    "unbuildable after " + (turns * 90) + " degrees");
        }
    }

    @Test
    void buildOrderStillPlacesEveryBlockExactlyOnce() {
        // The ordering grew a frontier and a visited set; the way that goes
        // wrong is quietly dropping or duplicating blocks.
        Blueprint manor = Catalog.build(Catalog.entries().get(Catalog.entries().size() - 1), 9,
                Materials.wood(0), Materials.stone(0));
        List<Blueprint.Placement> order = manor.buildOrder();
        assertEquals(manor.blockCount(), order.size(), "lost or duplicated blocks");
        assertEquals(manor.blockCount(),
                order.stream().map(p -> cell(p.x(), p.y(), p.z())).distinct().count(),
                "the same position twice");
    }

    @Test
    void buildOrderStartsAtTheBottom() {
        Blueprint manor = Catalog.build(Catalog.entries().get(Catalog.entries().size() - 1), 9,
                Materials.wood(0), Materials.stone(0));
        List<Blueprint.Placement> order = manor.buildOrder();
        assertEquals(0, order.get(0).y(), "did not start on the ground");
        // Not strictly layered any more — it follows what is standing — but it
        // must not be putting a roof on before there are walls.
        int firstHigh = 0;
        for (int i = 0; i < order.size(); i++) {
            if (order.get(i).y() >= manor.sizeY() - 1) { firstHigh = i; break; }
        }
        assertTrue(firstHigh > order.size() / 2,
                "reached the top course " + firstHigh + " blocks in, of " + order.size());
    }

    /**
     * A region saved from its far corner reads the same way up as one saved
     * from its near corner.
     *
     * Litematica records the corner you started the selection from and a size
     * that goes negative when the other corner is behind it — but the block
     * array always runs from the region's lowest corner regardless. Treating
     * Position as the origin and stepping away from it mirrors the building in
     * x and z and stands it on its head, which is what happened to a real
     * house: the lawn came out as the roof and every stair faced backwards.
     *
     * It went unnoticed because a building mirrored twice is a building rotated
     * half a turn, which looks plausible until you try to walk in the door.
     */
    @Test
    void aNegativeExtentMovesTheCornerRatherThanReversingTheReading() {
        // Selected from (24, 27, 46) back to the origin: size is negative on
        // every axis and the region is the cube from 0,0,0 to 24,27,46.
        int[] corner = Schematic.lowestCorner(new int[] {-25, -28, -47}, new int[] {24, 27, 46});
        assertEquals(0, corner[0]);
        assertEquals(0, corner[1]);
        assertEquals(0, corner[2]);
    }

    @Test
    void aPositiveExtentStartsWhereItSaysItDoes() {
        int[] corner = Schematic.lowestCorner(new int[] {25, 28, 47}, new int[] {-3, 64, 12});
        assertEquals(-3, corner[0]);
        assertEquals(64, corner[1]);
        assertEquals(12, corner[2]);
    }

    @Test
    void aMixOfSignsIsHandledOneAxisAtATime() {
        int[] corner = Schematic.lowestCorner(new int[] {-4, 3, -2}, new int[] {10, 20, 30});
        assertEquals(7, corner[0]);
        assertEquals(20, corner[1]);
        assertEquals(29, corner[2]);
    }

    /**
     * A tall thin selection is not a big build.
     *
     * The size guard was measured on the box a schematic was cut from rather
     * than on the blocks inside it, and the two are nothing like the same
     * number for the things people actually import. A sky farm is a selection
     * ninety per cent air: one real creeper farm was 45 x 132 x 46 — 273,240
     * cells against a 200,000 limit — and held 9,505 blocks. It was refused,
     * and refused with "nothing in it but air", because the region was skipped
     * and the note saying why was thrown away underneath the empty result.
     *
     * So the limit counts what is kept, a much larger one covers what will be
     * walked, and a read that comes back empty says what the notes said.
     */
    @Test
    void theLimitIsOnBlocksRatherThanOnTheBoxTheyCameFrom() {
        assertTrue(Schematic.MAX_CELLS > Schematic.MAX_BLOCKS,
                "a cell budget no larger than the block budget is the old bug wearing a hat");
        // Room for the shape that failed: a tall thin selection of a sky farm.
        assertTrue(45L * 132L * 46L < Schematic.MAX_CELLS,
                "a 45x132x46 selection is an ordinary sky farm and must read");
    }
}
