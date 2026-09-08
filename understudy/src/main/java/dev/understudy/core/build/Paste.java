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
        standUpTheTorches(cells);
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
                cells.put(new Cell(x, y, z),
                        state(block, facing, States.with(p.properties(), "half", "lower")));
                cells.put(new Cell(x, y + 1, z),
                        state(block, facing, States.with(p.properties(), "half", "upper")));
                continue;
            }
            if (block.endsWith("_bed")) {
                // The foot goes where it was placed and the head one further
                // the way it faces, which is what a click on the ground does.
                Facing lie = facing == null ? Facing.NORTH : facing;
                cells.put(new Cell(x, y, z),
                        state(block, lie, States.with(p.properties(), "part", "foot")));
                cells.put(new Cell(x + lie.dx(), y, z + lie.dz()),
                        state(block, lie, States.with(p.properties(), "part", "head")));
                continue;
            }
            cells.put(new Cell(x, y, z), state(block, facing, p.properties()));
        }
        return cells;
    }

    /**
     * The blocks that fall off unless they are told what they are stuck to.
     *
     * A torch placed by clicking a wall becomes a wall torch, and the game does
     * that conversion for you. Nothing does it for a paste: it puts down exactly
     * what it was given, so "torch" three blocks up in the middle of a room is a
     * floor torch with no floor, and it pops the instant anything updates it.
     * That is the sconces in every one of these designs.
     */
    private static final Map<String, String> ON_A_WALL = Map.of(
            "torch", "wall_torch",
            "soul_torch", "soul_wall_torch",
            "redstone_torch", "redstone_wall_torch");

    /**
     * Turn floor-standing blocks into their wall form where there is no floor.
     *
     * Exact rather than a guess, because the box is cleared to air first: a cell
     * that is not in the design is empty, so "is there something under this" has
     * a definite answer and so does "which side is the wall on".
     */
    private static void standUpTheTorches(Map<Cell, String> cells) {
        for (Map.Entry<Cell, String> entry : new ArrayList<>(cells.entrySet())) {
            Cell at = entry.getKey();
            String plain = entry.getValue().replace("minecraft:", "");
            String wall = ON_A_WALL.get(plain);
            if (wall == null) continue;
            if (cells.containsKey(new Cell(at.x(), at.y() - 1, at.z()))) continue;

            for (Facing side : Facing.values()) {
                // The wall is the neighbour; the torch faces away from it.
                Cell behind = new Cell(at.x() - side.dx(), at.y(), at.z() - side.dz());
                if (!cells.containsKey(behind)) continue;
                entry.setValue("minecraft:" + wall + "[facing="
                        + side.name().toLowerCase(java.util.Locale.ROOT) + "]");
                break;
            }
        }
    }

    /**
     * One block, as the game writes them.
     *
     * The block's own properties win where it has them, which is every imported
     * block and no designed one. A design says "a stair facing east" and means
     * only that; an import says exactly which of the eighty states it is, and
     * saying anything less is how a building arrives with its buttons on the
     * floor. The facing is folded in only when the properties did not already
     * carry one.
     */
    private static String state(String block, Facing facing, String properties) {
        String out = properties;
        if (facing != null && States.value(out, "facing") == null) {
            out = States.with(out, "facing", facing.name().toLowerCase(java.util.Locale.ROOT));
        }
        String name = block.contains(":") ? block : "minecraft:" + block;
        return out == null || out.isEmpty() ? name : name + "[" + out + "]";
    }

    /**
     * Empty the box the design occupies, in slabs the game will accept.
     *
     * One layer at a time rather than one box, because a fill is capped and a
     * tall import would be refused whole with nothing said about why.
     */
    private static List<String> clear(Blueprint plan, int ox, int oy, int oz) {
        return erase(ox, oy, oz, plan.sizeX(), plan.sizeY(), plan.sizeZ());
    }

    /**
     * Empty a box, in slabs the game will accept.
     *
     * One stack of layers at a time rather than one box, because a fill is
     * capped at {@link #FILL_LIMIT} and a tall import would be refused whole
     * with nothing said about why.
     *
     * Used both to make room for a paste and to take one away again, which are
     * the same operation over the same box — which is the whole reason undoing
     * a paste needs nothing recorded but six numbers.
     */
    public static List<String> erase(int ox, int oy, int oz, int wide, int tall, int deep) {
        List<String> out = new ArrayList<>();
        int perLayer = Math.max(1, wide * deep);
        int layersAtOnce = Math.max(1, FILL_LIMIT / perLayer);
        for (int y = 0; y < tall; y += layersAtOnce) {
            int top = Math.min(tall - 1, y + layersAtOnce - 1);
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
