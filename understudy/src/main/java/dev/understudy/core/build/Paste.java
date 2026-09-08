package dev.understudy.core.build;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A blueprint turned into the commands that would put it in the world.
 *
 * Why commands, of all things. A client mod cannot make a block appear: the
 * server owns the world, and a placement it did not authorise did not happen.
 * There is no packet that says "here are six thousand blocks, have them". The
 * only routes that exist go through the server's own command handling — in a
 * single-player world through the integrated server's console, which is
 * permission level four whether or not cheats are on, and on a real server as
 * the player, which works if the player may run setblock and not otherwise.
 *
 * Both take a string, so the whole of the interesting part is here, where it
 * can be tested, and the half that needs a game is four lines.
 *
 * Runs are merged along x into fills, because a floor is a hundred identical
 * blocks in a row and a hundred commands is a hundred chances to be throttled.
 *
 * Doors and beds are two blocks that a player places with one click, and this
 * is not a player. Set only the half the design names and you get half a door,
 * which is a block that looks like a bug. Both halves are written.
 */
public final class Paste {

    /** What one fill may cover. The game refuses a larger one outright. */
    public static final int FILL_LIMIT = 32768;

    private Paste() {}

    private record Cell(int x, int y, int z) {}

    /**
     * Every command needed, in the order they must run.
     *
     * Without a leading slash: one caller wants it that way and the other does
     * not mind.
     *
     * @param clearFirst empty the design's own bounding box before filling it,
     *                   which is what makes a paste onto a slope look pasted
     *                   rather than half buried
     */
    public static List<String> commands(Blueprint plan, int ox, int oy, int oz,
                                        boolean clearFirst) {
        Map<Cell, String> cells = states(plan, ox, oy, oz);
        List<String> out = new ArrayList<>();
        if (clearFirst) out.addAll(clear(plan, ox, oy, oz));
        out.addAll(merged(cells));
        return out;
    }

    /** How many blocks the world will change, for saying so before doing it. */
    public static int blockCount(Blueprint plan, int ox, int oy, int oz) {
        return states(plan, ox, oy, oz).size();
    }

    /**
     * Every cell the design wants, and what goes in it.
     *
     * A map rather than a list because the second half of a door lands on a
     * cell the design never mentioned, and because two placements arguing over
     * one cell should end with one block rather than two commands.
     */
    private static Map<Cell, String> states(Blueprint plan, int ox, int oy, int oz) {
        Map<Cell, String> cells = new LinkedHashMap<>();
        for (Blueprint.Placement p : plan.buildOrder()) {
            int x = ox + p.x();
            int y = oy + p.y();
            int z = oz + p.z();
            String block = p.block();
            Facing facing = p.facing();

            if (block.endsWith("_door") && !block.endsWith("_trapdoor")) {
                cells.put(new Cell(x, y, z), state(block, facing, "half=lower"));
                cells.put(new Cell(x, y + 1, z), state(block, facing, "half=upper"));
                continue;
            }
            if (block.endsWith("_bed")) {
                // The foot goes where it was placed and the head one further
                // the way it faces, which is what a click on the ground does.
                Facing lie = facing == null ? Facing.NORTH : facing;
                cells.put(new Cell(x, y, z), state(block, lie, "part=foot"));
                cells.put(new Cell(x + lie.dx(), y, z + lie.dz()), state(block, lie, "part=head"));
                continue;
            }
            cells.put(new Cell(x, y, z), state(block, facing, null));
        }
        return cells;
    }

    private static String state(String block, Facing facing, String extra) {
        List<String> properties = new ArrayList<>();
        if (facing != null) properties.add("facing=" + facing.name().toLowerCase(java.util.Locale.ROOT));
        if (extra != null) properties.add(extra);
        String name = block.contains(":") ? block : "minecraft:" + block;
        return properties.isEmpty() ? name : name + "[" + String.join(",", properties) + "]";
    }

    /**
     * Empty the box the design occupies, in slabs the game will accept.
     *
     * One layer at a time rather than one box, because a fill is capped and a
     * tall import would be refused whole with nothing said about why.
     */
    private static List<String> clear(Blueprint plan, int ox, int oy, int oz) {
        List<String> out = new ArrayList<>();
        int wide = plan.sizeX();
        int deep = plan.sizeZ();
        int perLayer = Math.max(1, wide * deep);
        int layersAtOnce = Math.max(1, FILL_LIMIT / perLayer);
        for (int y = 0; y < plan.sizeY(); y += layersAtOnce) {
            int top = Math.min(plan.sizeY() - 1, y + layersAtOnce - 1);
            out.add("fill " + ox + " " + (oy + y) + " " + oz + " "
                    + (ox + wide - 1) + " " + (oy + top) + " " + (oz + deep - 1) + " air");
        }
        return out;
    }

    /**
     * The cells, as few commands as a straight run along x can manage.
     *
     * Only along one axis. Growing rectangles would merge fewer commands again,
     * and it would also be the third place in this file where an off-by-one
     * puts a wall one block short. A floor is a long run in x and so is a
     * course of wall, which is most of a building.
     */
    private static List<String> merged(Map<Cell, String> cells) {
        Map<Long, Cell> byKey = new HashMap<>();
        for (Cell cell : cells.keySet()) byKey.put(key(cell), cell);

        List<Cell> order = new ArrayList<>(cells.keySet());
        order.sort((a, b) -> {
            if (a.y() != b.y()) return Integer.compare(a.y(), b.y());
            if (a.z() != b.z()) return Integer.compare(a.z(), b.z());
            return Integer.compare(a.x(), b.x());
        });

        java.util.Set<Long> used = new java.util.HashSet<>();
        List<String> out = new ArrayList<>();
        for (Cell start : order) {
            if (!used.add(key(start))) continue;
            String block = cells.get(start);
            int endX = start.x();
            while (true) {
                Cell next = byKey.get(key(endX + 1, start.y(), start.z()));
                if (next == null || used.contains(key(next))) break;
                if (!block.equals(cells.get(next))) break;
                used.add(key(next));
                endX++;
            }
            if (endX == start.x()) {
                out.add("setblock " + start.x() + " " + start.y() + " " + start.z() + " " + block);
            } else {
                out.add("fill " + start.x() + " " + start.y() + " " + start.z() + " "
                        + endX + " " + start.y() + " " + start.z() + " " + block);
            }
        }
        return out;
    }

    private static long key(Cell cell) {
        return key(cell.x(), cell.y(), cell.z());
    }

    private static long key(int x, int y, int z) {
        return ((long) (x & 0x3FFFFFF) << 38) | ((long) (z & 0x3FFFFFF) << 12) | (y & 0xFFF);
    }
}
