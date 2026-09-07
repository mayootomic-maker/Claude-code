package dev.understudy.core.build;

import dev.understudy.core.build.Blueprint.Role;

/**
 * The details that make a building look built.
 *
 * All four of the small designs were flat boxes: a floor, a shell, a lid, and a
 * hole for a door. They were correct and they read as generated, which is the
 * one thing a build in someone's world must not do. The Manor is not better
 * because it is bigger — it is better because it has a plinth, a base course,
 * posts, sills, eaves and an overhanging roof, none of which cost more than a
 * ring of blocks each.
 *
 * So the vocabulary lives here rather than five times over. Every one of these
 * works on a building that occupies x in 1..w and z in 1..d, with one block of
 * margin all round for things to project into — the same convention the Manor
 * already uses, which is why nothing here needs negative coordinates and why a
 * blueprint's bounds are still its real footprint.
 *
 * A note on why the projections matter more than they sound. A wall that is
 * flush from the ground to the roof has no shadow anywhere on it, and shadow is
 * what the eye reads at a distance. A course that stands one block proud throws
 * a line across the whole elevation. It is the cheapest detail in the game and
 * the one that most changes whether a house looks like a house.
 */
public final class Trim {
    private Trim() {}

    /** The course of masonry the building stands on, one block proud all round. */
    public static void plinth(Draft draft, int w, int d, String stone) {
        draft.box(0, 0, 0, w + 1, 0, d + 1, stone, Role.FLOOR);
    }

    /** A ring of masonry at the foot of the wall, so timber never meets grass. */
    public static void baseCourse(Draft draft, int w, int d, int y, String stone) {
        ring(draft, 1, 1, w, d, y, stone, Role.ACCENT, false);
    }

    /**
     * Uprights at the corners and every few blocks between them.
     *
     * A long unbroken wall is the other half of what makes a box read as a box.
     * The spacing is deliberately the same as the window rhythm, so the posts
     * land between the windows rather than through them.
     */
    public static void posts(Draft draft, int w, int d, int from, int to, int every, String log) {
        for (int x = 1; x <= w; x++) {
            if (!onGrid(x, w, every)) continue;
            for (int y = from; y <= to; y++) {
                draft.set(x, y, 1, log, Role.ACCENT);
                draft.set(x, y, d, log, Role.ACCENT);
            }
        }
        for (int z = 1; z <= d; z++) {
            if (!onGrid(z, d, every)) continue;
            for (int y = from; y <= to; y++) {
                draft.set(1, y, z, log, Role.ACCENT);
                draft.set(w, y, z, log, Role.ACCENT);
            }
        }
    }

    /** A corner, or one of the regular uprights between them. */
    public static boolean onGrid(int along, int span, int every) {
        return along == 1 || along == span || (along - 1) % every == 0;
    }

    /** Where a window goes: two of every four, so the wall has a rhythm. */
    public static boolean windowAt(int along, int every) {
        int step = (along - 1) % every;
        return step >= 1 && step <= every - 2;
    }

    /**
     * Glazing along all four walls, between the posts.
     *
     * Openings are the only detail here that is also useful — a house you
     * cannot see out of is a bunker — which is why they are two courses tall
     * rather than one, and why they skip the wall the door is in.
     */
    public static void windows(Draft draft, int w, int d, int sill, int head, int every,
                               String pane, int skipX) {
        for (int x = 2; x < w; x++) {
            if (!windowAt(x, every) || onGrid(x, w, every)) continue;
            for (int y = sill; y <= head; y++) {
                if (x != skipX) draft.set(x, y, 1, pane, Role.WINDOW, true);
                draft.set(x, y, d, pane, Role.WINDOW, true);
            }
        }
        for (int z = 2; z < d; z++) {
            if (!windowAt(z, every) || onGrid(z, d, every)) continue;
            for (int y = sill; y <= head; y++) {
                draft.set(1, y, z, pane, Role.WINDOW, true);
                draft.set(w, y, z, pane, Role.WINDOW, true);
            }
        }
    }

    /**
     * A sill under every opening and a hood over it, both in the margin.
     *
     * A pane set flush in a flat wall is a hole with glass in it. These two
     * courses are what make it a window, and because they project outward the
     * building gains relief without gaining a footprint.
     */
    public static void dressWindows(Draft draft, int w, int d, int sill, int head, int every,
                                    String slab) {
        for (int x = 2; x < w; x++) {
            if (!windowAt(x, every) || onGrid(x, w, every)) continue;
            draft.set(x, sill - 1, 0, slab, Role.ACCENT, true);
            draft.set(x, head + 1, 0, slab, Role.ACCENT, true);
            draft.set(x, sill - 1, d + 1, slab, Role.ACCENT, true);
            draft.set(x, head + 1, d + 1, slab, Role.ACCENT, true);
        }
        for (int z = 2; z < d; z++) {
            if (!windowAt(z, every) || onGrid(z, d, every)) continue;
            draft.set(0, sill - 1, z, slab, Role.ACCENT, true);
            draft.set(0, head + 1, z, slab, Role.ACCENT, true);
            draft.set(w + 1, sill - 1, z, slab, Role.ACCENT, true);
            draft.set(w + 1, head + 1, z, slab, Role.ACCENT, true);
        }
    }

    /** The underside of the overhang: what turns a projecting roof into an eave. */
    public static void eaves(Draft draft, int w, int d, int y, String slab) {
        ring(draft, 0, 0, w + 1, d + 1, y, slab, Role.ROOF, true);
    }

    /**
     * A pitched roof in stairs, with a one-block overhang and closed gables.
     *
     * The ridge runs along the building's long axis, which is not decoration:
     * a roof pitched across the long side of a five-by-seventeen store room
     * climbs nine courses and looks like a church spire over a shed. Roofs
     * follow the plan, so the axis is chosen from the plan rather than fixed.
     *
     * Both of the things that most often go wrong are handled here: the
     * overhang (without it the roof is a lid) and the gable fill (without it
     * there are two open triangles at the ends for anything to walk in
     * through).
     *
     * @return the height of the ridge, so a chimney knows how far to go
     */
    public static int gable(Draft draft, int w, int d, int base, String stairs, String slab,
                            String gableWall) {
        // Step across the short span; the ridge then lies along the long one.
        boolean alongX = w >= d;
        int across = alongX ? d : w;
        int along = alongX ? w : d;
        int y = base;
        for (int course = 0; ; course++) {
            y = base + course;
            int near = course;
            int far = across + 1 - course;
            if (near > far) break;

            for (int i = 0; i <= along + 1; i++) {
                if (near == far) {
                    set(draft, alongX, i, y, near, slab, Role.ROOF, null); // the ridge cap
                } else {
                    set(draft, alongX, i, y, near, stairs, Role.ROOF,
                            alongX ? Facing.NORTH : Facing.WEST);
                    set(draft, alongX, i, y, far, stairs, Role.ROOF,
                            alongX ? Facing.SOUTH : Facing.EAST);
                }
            }
            // Close the triangle at both ends of the ridge.
            for (int j = near + 1; j < far; j++) {
                set(draft, alongX, 0, y, j, gableWall, Role.WALL, null);
                set(draft, alongX, along + 1, y, j, gableWall, Role.WALL, null);
            }
            if (near == far) break;
        }
        return y;
    }

    /** One roof cell, in whichever orientation the ridge turned out to be. */
    private static void set(Draft draft, boolean alongX, int along, int y, int across,
                            String block, Role role, Facing facing) {
        int x = alongX ? along : across;
        int z = alongX ? across : along;
        if (facing == null) draft.set(x, y, z, block, role);
        else draft.facing(x, y, z, block, role, facing);
    }

    /**
     * A doorway with a lintel over it and a lamp either side.
     *
     * An entrance that is only a gap in a wall is the clearest tell that nobody
     * looked at the front of the building.
     *
     * There is deliberately no step. The plinth already stands one block proud
     * of the ground, so it *is* the step — and putting a stair in front of the
     * door as well fills the one cell you have to stand in to walk through it.
     * The blueprint's own entrance point is that cell, which is how this was
     * caught: the design was reporting an entrance it had bricked up itself.
     */
    public static void doorway(Draft draft, int doorX, int wallZ, String door, String lintel) {
        draft.clear(doorX, 1, wallZ);
        draft.clear(doorX, 2, wallZ);
        draft.set(doorX, 1, wallZ, door, Role.DOOR, true);
        draft.set(doorX, 3, wallZ, lintel, Role.ACCENT);
        draft.set(doorX - 1, 3, wallZ - 1, "torch", Role.LIGHT, true);
        draft.set(doorX + 1, 3, wallZ - 1, "torch", Role.LIGHT, true);
    }

    /** Wall lamps at intervals down both long walls, high enough to light a room. */
    public static void lights(Draft draft, int w, int d, int y, int every) {
        for (int z = 2; z < d; z += every) {
            draft.set(2, y, z, "torch", Role.LIGHT, true);
            draft.set(w - 1, y, z, "torch", Role.LIGHT, true);
        }
    }

    /** One course of a rectangle's outline, optionally the whole rectangle's edge. */
    private static void ring(Draft draft, int x0, int z0, int x1, int z1, int y, String block,
                             Role role, boolean optional) {
        for (int x = x0; x <= x1; x++) {
            draft.set(x, y, z0, block, role, optional);
            draft.set(x, y, z1, block, role, optional);
        }
        for (int z = z0; z <= z1; z++) {
            draft.set(x0, y, z, block, role, optional);
            draft.set(x1, y, z, block, role, optional);
        }
    }
}
