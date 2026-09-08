package dev.understudy.core.build;

import dev.understudy.core.model.BlockColours;
import dev.understudy.core.model.Mesh;
import dev.understudy.core.model.ObjReader;
import dev.understudy.core.model.StlReader;
import dev.understudy.core.model.Voxeliser;
import dev.understudy.core.nbt.Nbt;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Turns a schematic file into a blueprint.
 *
 * "Import a 3D model" for Minecraft means a schematic in practice: .litematic,
 * .schem or a vanilla structure .nbt. Those are already block data, so they map
 * onto a blueprint exactly, with no guessing about which block a colour should
 * become. A mesh format like .obj would have to be voxelised and colour-matched
 * — possible, and a different and much lossier job.
 *
 * Three formats, because the community uses three:
 *
 *   .litematic   Litematica's own. Regions of bit-packed block state indices.
 *   .schem       Sponge's. A varint stream, one entry per block.
 *   .nbt         Vanilla structure blocks. A sparse list of positions.
 *
 * All three carry full block states — "oak_stairs[facing=north,half=bottom]" —
 * so an imported roof keeps its orientation, which is the difference between a
 * house and a pile of stairs.
 *
 * Air is dropped. A schematic is mostly air, and a blueprint is a list of things
 * to place.
 */
public final class Schematic {

    /** Anything larger is a region capture rather than a build, and would hang the menu. */
    public static final int MAX_BLOCKS = 200_000;

    public record Result(Blueprint blueprint, List<String> notes) {}

    private Schematic() {}

    /**
     * Turn a 3D model into a blueprint.
     *
     * A mesh is not block data, so unlike a schematic this is a conversion with
     * choices in it: how tall to make it, whether to fill the inside, and which
     * block stands in for each colour. The height is the one that matters most —
     * a model has no scale of its own, and "as tall as the original" is not a
     * number that exists.
     *
     * A model with materials gets its colours matched to buildable blocks. One
     * without — every .stl, and plenty of .obj files — is a shape, and the shape
     * is built out of whatever material was chosen in the menu.
     *
     * @param height  how many blocks tall the result should be
     * @param solid   fill the inside, rather than leaving a shell you can enter
     * @param plain   the block to use when the model carries no colours
     */
    public static Result readModel(String name, byte[] file, int height, boolean solid,
                                   String plain) throws IOException {
        Mesh mesh = name.toLowerCase(java.util.Locale.ROOT).endsWith(".stl")
                ? StlReader.read(file)
                : ObjReader.read(file, ignored -> null);
        if (mesh.isEmpty()) throw new IOException("nothing in that model");

        Voxeliser.Voxels voxels = Voxeliser.voxelise(mesh,
                new Voxeliser.Options(height, solid, true));
        if (voxels.count() == 0) throw new IOException("that model came out empty at that size");

        Draft draft = new Draft(cleanName(name));
        boolean coloured = mesh.hasColours();
        for (Map.Entry<Long, Integer> cell : voxels.cells().entrySet()) {
            int argb = cell.getValue();
            String block = coloured && argb != -1 ? BlockColours.nearest(argb) : plain;
            draft.set(Voxeliser.x(cell.getKey()), Voxeliser.y(cell.getKey()),
                    Voxeliser.z(cell.getKey()), block, roleOf(block), false, null);
        }

        Blueprint blueprint = draft.finish(0, 0, 0);
        List<String> notes = new ArrayList<>();
        notes.add(mesh.triangles().size() + " triangles");
        notes.add(voxels.count() + " blocks at " + height + " tall");
        notes.add(coloured ? blueprint.materials().size() + " kinds matched to colours"
                : "no colours in the file — built in " + plain);
        if (voxels.count() >= Voxeliser.MAX_BLOCKS) {
            notes.add("clipped at the size limit; try a smaller height");
        }
        return new Result(blueprint, notes);
    }

    /** One block as read, before the whole thing is shifted to start at the origin. */
    private record Raw(int x, int y, int z, String block, Facing facing, String properties) {}

    public static Result read(String name, byte[] file) throws IOException {
        Nbt.Tag.Compound root = Nbt.read(file);
        List<String> notes = new ArrayList<>();
        List<Raw> raw = new ArrayList<>();

        if (Nbt.compound(root, "Regions") != null) {
            litematic(root, raw, notes);
        } else if (Nbt.has(root, "BlockData") || Nbt.compound(root, "Schematic") != null) {
            sponge(root, raw, notes);
        } else if (Nbt.has(root, "blocks") && Nbt.has(root, "palette")) {
            structure(root, raw, notes);
        } else {
            throw new IOException("not a schematic this understands "
                    + "(expected a .litematic, .schem or structure .nbt)");
        }

        if (raw.isEmpty()) throw new IOException("that schematic has nothing in it but air");

        // Schematics are saved wherever they happened to be in someone's world,
        // with regions at arbitrary offsets and sometimes negative ones. A
        // blueprint is relative to its own corner, so the whole thing is shifted
        // to start at the origin — otherwise the footprint the site marker draws
        // is the wrong size and in the wrong place.
        int minX = Integer.MAX_VALUE, minY = Integer.MAX_VALUE, minZ = Integer.MAX_VALUE;
        for (Raw block : raw) {
            minX = Math.min(minX, block.x());
            minY = Math.min(minY, block.y());
            minZ = Math.min(minZ, block.z());
        }
        Draft draft = new Draft(cleanName(name));
        for (Raw block : raw) {
            draft.set(block.x() - minX, block.y() - minY, block.z() - minZ,
                    block.block(), roleOf(block.block()), false, block.facing(),
                    block.properties());
        }

        Blueprint blueprint = draft.finish(0, 0, 0);
        notes.add(raw.size() + " blocks, " + blueprint.materials().size() + " kinds");
        return new Result(blueprint, notes);
    }

    // --- Litematica ----------------------------------------------------------

    /**
     * Block state indices packed into a long array, so many bits per entry as
     * the palette needs.
     *
     * Unlike the chunk format the game uses, litematica lets an entry straddle
     * the boundary between two longs, so this reads bit ranges rather than
     * slicing each long into fixed slots. Getting that wrong does not fail: it
     * produces a building made of the wrong blocks, which is worse.
     */
    private static void litematic(Nbt.Tag.Compound root, List<Raw> out, List<String> notes) {
        Nbt.Tag.Compound regions = Nbt.compound(root, "Regions");
        for (Map.Entry<String, Nbt.Tag> entry : regions.value().entrySet()) {
            if (!(entry.getValue() instanceof Nbt.Tag.Compound region)) continue;

            int[] size = xyz(Nbt.compound(region, "Size"));
            int[] at = xyz(Nbt.compound(region, "Position"));
            int sx = Math.abs(size[0]), sy = Math.abs(size[1]), sz = Math.abs(size[2]);

            // Where the block array starts, which is not where Position is.
            //
            // A litematica region records the corner the player started the
            // selection from, and a size that can be negative because the other
            // corner may be behind it. The block array, though, always runs from
            // the region's *lowest* corner upward — the sign says where Position
            // sits, not which way the data reads.
            //
            // Reading it as though Position were the origin and stepping away
            // from it is how this file came out mirrored in x and z and stood on
            // its head in y: the ground ended up as the top layer and every
            // stair faced the wrong way. It was not a paste bug at all. Every
            // import saved from the far corner has been wrong since this was
            // written, in the builder as well.
            int[] from = lowestCorner(size, at);
            if (sx == 0 || sy == 0 || sz == 0) continue;

            List<Nbt.Tag> palette = Nbt.list(region, "BlockStatePalette");
            long[] packed = Nbt.longs(region, "BlockStates");
            if (palette.isEmpty() || packed.length == 0) continue;

            int bits = Math.max(2, 32 - Integer.numberOfLeadingZeros(palette.size() - 1));
            long total = (long) sx * sy * sz;
            if (total > MAX_BLOCKS) {
                notes.add("region " + entry.getKey() + " skipped: " + total + " blocks is too big");
                continue;
            }

            for (int index = 0; index < total; index++) {
                int state = unpack(packed, index, bits);
                if (state < 0 || state >= palette.size()) continue;
                String block = stateName(palette.get(state));
                if (block == null) continue;
                // Litematica orders y, then z, then x.
                int y = index / (sx * sz);
                int rest = index % (sx * sz);
                int z = rest / sx;
                int x = rest % sx;
                put(out, from[0] + x, from[1] + y, from[2] + z, block);
            }
        }
    }

    /** Read `bits` bits starting at entry `index`, crossing long boundaries. */
    /**
     * The corner a region's block array starts from.
     *
     * One line of arithmetic and the whole of the bug above, so it is out here
     * where a test can hold it: a negative extent moves the origin to the far
     * end, it does not reverse the reading.
     */
    public static int[] lowestCorner(int[] size, int[] at) {
        return new int[] {
                size[0] < 0 ? at[0] + size[0] + 1 : at[0],
                size[1] < 0 ? at[1] + size[1] + 1 : at[1],
                size[2] < 0 ? at[2] + size[2] + 1 : at[2]};
    }

    private static int unpack(long[] packed, int index, int bits) {
        long start = (long) index * bits;
        int startLong = (int) (start >>> 6);
        int startBit = (int) (start & 63);
        if (startLong >= packed.length) return -1;
        long mask = bits >= 64 ? -1L : (1L << bits) - 1;

        long value = packed[startLong] >>> startBit;
        if (startBit + bits > 64) {
            if (startLong + 1 >= packed.length) return -1;
            value |= packed[startLong + 1] << (64 - startBit);
        }
        return (int) (value & mask);
    }

    // --- Sponge .schem -------------------------------------------------------

    private static void sponge(Nbt.Tag.Compound root, List<Raw> out, List<String> notes)
            throws IOException {
        // Version 3 moved everything down a level and renamed BlockData to Data.
        Nbt.Tag.Compound schema = Nbt.compound(root, "Schematic");
        Nbt.Tag.Compound holder = schema != null ? schema : root;
        Nbt.Tag.Compound blocks = Nbt.compound(holder, "Blocks");

        int width = Nbt.integer(holder, "Width", 0);
        int height = Nbt.integer(holder, "Height", 0);
        int length = Nbt.integer(holder, "Length", 0);
        Nbt.Tag.Compound palette = blocks != null
                ? Nbt.compound(blocks, "Palette") : Nbt.compound(holder, "Palette");
        byte[] data = blocks != null ? Nbt.bytes(blocks, "Data") : Nbt.bytes(holder, "BlockData");

        if (width <= 0 || height <= 0 || length <= 0 || palette == null || data.length == 0) {
            throw new IOException("that .schem is missing its size or its blocks");
        }
        if ((long) width * height * length > MAX_BLOCKS) {
            throw new IOException("that schematic is " + ((long) width * height * length)
                    + " blocks, which is far too big to build");
        }

        // The palette maps name to id, which is the wrong way round for reading.
        String[] byId = new String[palette.value().size() * 2 + 2];
        for (Map.Entry<String, Nbt.Tag> entry : palette.value().entrySet()) {
            if (!(entry.getValue() instanceof Nbt.Tag.Num id)) continue;
            int slot = (int) id.value();
            if (slot < 0) continue;
            if (slot >= byId.length) byId = java.util.Arrays.copyOf(byId, slot + 1);
            byId[slot] = entry.getKey();
        }

        int cursor = 0;
        for (int index = 0; index < width * height * length && cursor < data.length; index++) {
            // Varint per entry, low seven bits at a time.
            int value = 0;
            int shift = 0;
            while (cursor < data.length) {
                byte piece = data[cursor++];
                value |= (piece & 0x7F) << shift;
                if ((piece & 0x80) == 0) break;
                shift += 7;
            }
            String block = value >= 0 && value < byId.length ? byId[value] : null;
            if (block == null) continue;
            // Sponge orders y, then z, then x.
            int y = index / (width * length);
            int rest = index % (width * length);
            int z = rest / width;
            int x = rest % width;
            put(out, x, y, z, block);
        }
    }

    // --- Vanilla structure ---------------------------------------------------

    private static void structure(Nbt.Tag.Compound root, List<Raw> out, List<String> notes)
            throws IOException {
        List<Nbt.Tag> palette = Nbt.list(root, "palette");
        List<Nbt.Tag> blocks = Nbt.list(root, "blocks");
        if (blocks.size() > MAX_BLOCKS) {
            throw new IOException("that structure is " + blocks.size()
                    + " blocks, which is far too big to build");
        }

        for (Nbt.Tag tag : blocks) {
            if (!(tag instanceof Nbt.Tag.Compound entry)) continue;
            List<Nbt.Tag> pos = Nbt.list(entry, "pos");
            if (pos.size() < 3) continue;
            int state = Nbt.integer(entry, "state", -1);
            if (state < 0 || state >= palette.size()) continue;
            String block = stateName(palette.get(state));
            if (block == null) continue;
            put(out, num(pos.get(0)), num(pos.get(1)), num(pos.get(2)), block);
        }
    }

    // --- shared --------------------------------------------------------------

    /**
     * Add one block, unless it is air.
     *
     * The block state string carries its properties, and all of them are kept.
     *
     * The facing is pulled out separately because that is the one thing a
     * builder can act on — it looks that way before it clicks. Everything else
     * is passed through untouched for the paste, which sets the state directly
     * and can honour all of it. Dropping it, which is what this used to do, is
     * why an imported building arrived with its buttons on the floor and its
     * trapdoors the wrong way up.
     */
    private static void put(List<Raw> out, int x, int y, int z, String state) {
        String name = state;
        Facing facing = null;

        String properties = null;
        int bracket = name.indexOf('[');
        if (bracket >= 0) {
            properties = name.substring(bracket + 1, Math.max(bracket + 1, name.length() - 1));
            name = name.substring(0, bracket);
            String way = States.value(properties, "facing");
            if (way != null) facing = facingOf(way);
        }
        if (name.startsWith("minecraft:")) name = name.substring("minecraft:".length());
        if (name.equals("air") || name.equals("cave_air") || name.equals("void_air")) return;

        out.add(new Raw(x, y, z, name, facing, properties));
    }

    private static Facing facingOf(String value) {
        return switch (value) {
            case "north" -> Facing.NORTH;
            case "south" -> Facing.SOUTH;
            case "west" -> Facing.WEST;
            case "east" -> Facing.EAST;
            default -> null; // up and down, which nothing here can aim at
        };
    }

    /**
     * A rough guess at what each block is for.
     *
     * Only used for build order — floors before walls, fittings last — so being
     * approximate costs nothing. An imported schematic has no idea what its
     * author meant by any given block.
     */
    private static Blueprint.Role roleOf(String name) {
        if (name.contains("glass") || name.contains("pane")) return Blueprint.Role.WINDOW;
        if (name.contains("torch") || name.contains("lantern") || name.contains("lamp")) {
            return Blueprint.Role.LIGHT;
        }
        if (name.endsWith("_door")) return Blueprint.Role.DOOR;
        if (name.contains("chest") || name.contains("bed") || name.contains("furnace")
                || name.contains("crafting") || name.contains("shelf")) {
            return Blueprint.Role.FURNITURE;
        }
        if (name.contains("stairs") || name.contains("slab")) return Blueprint.Role.ROOF;
        if (name.contains("_log") || name.contains("pillar")) return Blueprint.Role.ACCENT;
        return Blueprint.Role.WALL;
    }

    private static String stateName(Nbt.Tag tag) {
        if (!(tag instanceof Nbt.Tag.Compound entry)) return null;
        String name = Nbt.string(entry, "Name", null);
        if (name == null) return null;
        Nbt.Tag.Compound properties = Nbt.compound(entry, "Properties");
        if (properties == null) return name;
        StringBuilder full = new StringBuilder(name).append('[');
        boolean first = true;
        for (Map.Entry<String, Nbt.Tag> property : properties.value().entrySet()) {
            if (!(property.getValue() instanceof Nbt.Tag.Str value)) continue;
            if (!first) full.append(',');
            full.append(property.getKey()).append('=').append(value.value());
            first = false;
        }
        return first ? name : full.append(']').toString();
    }

    private static int[] xyz(Nbt.Tag.Compound compound) {
        return new int[]{Nbt.integer(compound, "x", 0), Nbt.integer(compound, "y", 0),
                Nbt.integer(compound, "z", 0)};
    }

    private static int num(Nbt.Tag tag) {
        return tag instanceof Nbt.Tag.Num number ? (int) number.value() : 0;
    }

    private static String cleanName(String fileName) {
        String name = fileName;
        int slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
        if (slash >= 0) name = name.substring(slash + 1);
        int dot = name.lastIndexOf('.');
        if (dot > 0) name = name.substring(0, dot);
        return name.isBlank() ? "imported" : name;
    }
}
