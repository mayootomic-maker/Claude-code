package dev.understudy.core.build;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.PriorityQueue;
import java.util.Set;

/**
 * A structure, as data.
 *
 * Everything downstream reads from this one representation: the bill of
 * materials, the order to place things in, the footprint to level, and the
 * progress check that lets a half-built house be resumed. Keeping the design
 * separate from the act of building is what makes "work out the whole thing,
 * then go and do it" possible at all — you cannot cost a house you are
 * discovering as you place it.
 *
 * Coordinates are relative to the blueprint's own origin, with y=0 the floor.
 */
public record Blueprint(String name, List<Placement> placements, int sizeX, int sizeY, int sizeZ,
                        int entranceX, int entranceY, int entranceZ) {

    /** What a block is for, so its material can be chosen separately. */
    public enum Role { FLOOR, WALL, ACCENT, ROOF, WINDOW, LIGHT, DOOR, FURNITURE }

    /**
     * One block, and which way round it goes.
     *
     * facing is null for everything that does not care, which is most blocks.
     * It is not decoration: stairs take their orientation from where the player
     * is looking, so a roof built without it points the wrong way everywhere.
     */
    /**
     * @param facing     which way it goes, for the builder, which can only aim
     *                   at the four horizontal directions
     * @param properties the whole of what the block says about itself, as it
     *                   appears between the brackets and without them —
     *                   "facing=east,half=top,shape=straight". Null for the
     *                   designs, which describe blocks rather than states, and
     *                   filled in for anything imported.
     *
     *                   Kept separately from facing rather than replacing it
     *                   because the two have different jobs. A builder cannot
     *                   act on half=top: there is no click that means it. A
     *                   paste can, and dropping the rest was the difference
     *                   between an import arriving as itself and arriving with
     *                   its buttons on the floor.
     */
    public record Placement(int x, int y, int z, String block, Role role, boolean optional,
                            Facing facing, String properties) {
        public Placement(int x, int y, int z, String block, Role role, boolean optional) {
            this(x, y, z, block, role, optional, null, null);
        }

        public Placement(int x, int y, int z, String block, Role role, boolean optional,
                         Facing facing) {
            this(x, y, z, block, role, optional, facing, null);
        }
    }

    /** Block name to how many are needed, optional pieces included. */
    public Map<String, Integer> materials() {
        Map<String, Integer> out = new LinkedHashMap<>();
        for (Placement p : placements) out.merge(p.block(), 1, Integer::sum);
        return out;
    }

    /** Only what the build genuinely cannot proceed without. */
    public Map<String, Integer> essentialMaterials() {
        Map<String, Integer> out = new LinkedHashMap<>();
        for (Placement p : placements) {
            if (!p.optional()) out.merge(p.block(), 1, Integer::sum);
        }
        return out;
    }

    public int blockCount() {
        return placements.size();
    }

    /**
     * The same structure, turned and possibly stood on its head.
     *
     * This exists because a mesh file does not say which way is up. An .obj has
     * no field for it and an .stl has no fields at all, so which axis means up
     * is a convention of whatever program wrote it — and the two common
     * conventions disagree. Guessing gets it right most of the time, and most
     * of the time is no use when you are looking at your model standing on its
     * roof. So the guess stays as a default and this is the correction, applied
     * to whatever came out and shown in the preview before anything is built.
     *
     * @param quarterTurns clockwise turns about the vertical axis
     * @param upsideDown   mirror top to bottom
     */
    public Blueprint turned(int quarterTurns, boolean upsideDown) {
        int turns = Math.floorMod(quarterTurns, 4);
        if (turns == 0 && !upsideDown) return this;

        List<Placement> moved = new ArrayList<>(placements.size());
        for (Placement p : placements) {
            int x = p.x();
            int z = p.z();
            int width = sizeX;
            int depth = sizeZ;
            Facing facing = p.facing();
            for (int turn = 0; turn < turns; turn++) {
                int nx = depth - 1 - z;
                z = x;
                x = nx;
                int swap = width;
                width = depth;
                depth = swap;
                facing = facing == null ? null : facing.clockwise();
            }
            int y = upsideDown ? sizeY - 1 - p.y() : p.y();
            // The blocks move and so does what they say about themselves: a
            // turned building whose stairs still claim to face east is a
            // building with its roof on sideways.
            String properties = States.turned(p.properties(), turns);
            if (upsideDown) properties = States.flipped(properties);
            moved.add(new Placement(x, y, z, p.block(), p.role(), p.optional(), facing,
                    properties));
        }

        boolean sideways = turns % 2 == 1;
        int newX = sideways ? sizeZ : sizeX;
        int newZ = sideways ? sizeX : sizeZ;
        return new Blueprint(name, List.copyOf(moved), newX, sizeY, newZ,
                sideways ? sizeZ - 1 - entranceZ : entranceX,
                upsideDown ? sizeY - 1 - entranceY : entranceY,
                sideways ? entranceX : entranceZ);
    }

    /**
     * The order to place them in: bottom layer first, and within a layer, a
     * back-and-forth sweep like mowing a lawn.
     *
     * The height ordering is not optional — you cannot place a block against
     * nothing, so a course has to exist before the one above it.
     *
     * The within-layer ordering used to be "furthest from the door first",
     * which was chosen to stop the builder walling itself into a corner and
     * did do that. What it also did, on any building with two sides, was send
     * it back and forth across the site all day: a house is symmetrical, so
     * the left wall and the right wall are the same distance from the door,
     * their blocks tie, and it alternated between them. Measured on a
     * fifteen-wide house it averaged eight blocks between one block and the
     * next, with 555 of 816 steps too far to reach without walking, and single
     * hops of sixteen blocks — the full diagonal of the building. That is the
     * "stupid routes" you can watch it take, and it is nearly all of why a
     * house took as long as it did.
     *
     * A serpentine sweep is what a person does and it is also what is quickest:
     * finish a row, step across, come back along the next one. The same blocks
     * in this order cut that house from 6496 blocks of travel to 2088, and the
     * steps too far to reach from 555 to 96 — which is the number that matters,
     * because each one of those is a walk with a route to find and a route to
     * follow, and everything in between is a step sideways.
     *
     * The way out is still kept clear, but by the frontier rather than by the
     * sort. Nothing enters the frontier until something is already standing
     * next to it, so a course grows outward from ground it can reach; and the
     * walker can open a door, and dig, if it does end up on the wrong side of a
     * wall.
     */
    public List<Placement> buildOrder() {
        Comparator<Placement> preference = (a, b) -> {
            if (a.y() != b.y()) return Integer.compare(a.y(), b.y());
            // Furniture and lights go in after the shell of their layer, since
            // they need a floor and a wall to sit against.
            boolean fittingA = a.role() == Role.FURNITURE || a.role() == Role.LIGHT || a.role() == Role.DOOR;
            boolean fittingB = b.role() == Role.FURNITURE || b.role() == Role.LIGHT || b.role() == Role.DOOR;
            if (fittingA != fittingB) return fittingA ? 1 : -1;
            // Every other course runs the other way, and within a course every
            // other row does too, so the end of one is always the start of the
            // next rather than a walk back to where it began. Without the
            // course alternation the sweep is still a sweep, but it finishes
            // each layer at the far side and starts the next one back at the
            // near side — one twenty-block walk per course.
            boolean forwardZ = Math.floorMod(a.y(), 2) == 0;
            if (a.z() != b.z()) {
                return forwardZ ? Integer.compare(a.z(), b.z()) : Integer.compare(b.z(), a.z());
            }
            return Math.floorMod(a.z(), 2) == 0
                    ? Integer.compare(a.x(), b.x())
                    : Integer.compare(b.x(), a.x());
        };

        // Ordered by what can actually be placed, not just by height.
        //
        // The game will not let you put a block in mid-air: you place it by
        // clicking the face of one that is already there. So an order that is
        // merely bottom-up hands the builder blocks with nothing beside them —
        // an eave, the first block of a course, anything overhanging — and each
        // one it fails on takes the support out from under its neighbours. On
        // this manor that cascade turned two impossible blocks into two hundred
        // and seventy-one. Growing the order outward from what is already
        // standing costs one pass and removes the whole class of failure.
        Map<Long, Placement> byPosition = new HashMap<>();
        for (Placement p : placements) byPosition.put(at(p.x(), p.y(), p.z()), p);

        List<Placement> pending = new ArrayList<>(placements);
        pending.sort(preference);

        PriorityQueue<Placement> frontier = new PriorityQueue<>(preference);
        Set<Long> seen = new HashSet<>();
        for (Placement p : pending) {
            // Anything resting on the ground can always be placed: the terrain
            // under the site is the face to click.
            if (p.y() == 0 && seen.add(at(p.x(), p.y(), p.z()))) frontier.add(p);
        }

        List<Placement> ordered = new ArrayList<>(placements.size());
        int next = 0;
        while (ordered.size() < placements.size()) {
            if (frontier.isEmpty()) {
                // A piece with no path back to the ground — a floating island of
                // a model, an arch's far side. It genuinely cannot be placed
                // against anything yet, so start it and let the rest grow from
                // it; the builder scaffolds or reports it.
                while (next < pending.size()
                        && !seen.add(at(pending.get(next).x(), pending.get(next).y(),
                                pending.get(next).z()))) {
                    next++;
                }
                if (next >= pending.size()) break;
                frontier.add(pending.get(next++));
            }
            Placement p = frontier.poll();
            ordered.add(p);
            for (int[] side : SIDES) {
                Placement neighbour = byPosition.get(
                        at(p.x() + side[0], p.y() + side[1], p.z() + side[2]));
                if (neighbour == null) continue;
                if (!seen.add(at(neighbour.x(), neighbour.y(), neighbour.z()))) continue;
                frontier.add(neighbour);
            }
        }
        return ordered;
    }

    private static final int[][] SIDES =
            {{1, 0, 0}, {-1, 0, 0}, {0, 1, 0}, {0, -1, 0}, {0, 0, 1}, {0, 0, -1}};

    private static long at(int x, int y, int z) {
        return ((long) (x & 0xFFFF) << 32) | ((long) (z & 0xFFFF) << 16) | (y & 0xFFFF);
    }

    private double distanceFromEntrance(Placement p) {
        double dx = p.x() - entranceX;
        double dz = p.z() - entranceZ;
        return Math.sqrt(dx * dx + dz * dz);
    }
}
