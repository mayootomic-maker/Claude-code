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
        assertTrue(error.getMessage().contains("too big"), error.getMessage());
    }

    @Test
    void anImportedBuildStillGetsAPicture() throws IOException {
        // The preview works off any blueprint, so an import gets one for free —
        // which is the point of importing into the same menu.
        Blueprint blueprint = Schematic.read("cabin.schem", NbtWriter.gzip(spongeSchem())).blueprint();
        assertTrue(!Preview.of(blueprint).isEmpty());
    }
}
