package dev.understudy.core.build;

import dev.understudy.core.build.Blueprint.Role;

/**
 * The big one: two floors, a pitched roof, and everything you need to live in
 * it without going back to a chest somewhere else.
 *
 * What makes a Minecraft build read as hand-made rather than generated is
 * almost entirely detail that costs nothing: a plinth so the walls do not grow
 * straight out of the grass, posts breaking up long runs of flat wall, a roof
 * that overhangs instead of stopping flush, and windows in a rhythm rather than
 * wherever there was room. All of that is here, and it is why this is a separate
 * file from the small designs.
 *
 * Coordinates: the house occupies x=1..w and z=1..d, with the plinth one block
 * proud of it all the way round. Everything is non-negative so the blueprint's
 * own bounds are its real footprint, which is what the site marker draws.
 *
 * The ridge runs along x, so the two gable ends face left and right and the
 * front of the house gets the long slope.
 */
public final class Manor {

    /** Wall height of each storey, in blocks of headroom plus the ceiling. */
    private static final int STOREY = 4;

    /**
     * Which way a stair faces on the north-facing slope of the roof.
     *
     * Minecraft takes a stair's orientation from where the player is looking
     * when it is placed, and this design cannot be run in a game from here to
     * check which way round that comes out. If the roof builds inside out, this
     * one constant is the whole fix — every slope and every step derives from
     * it.
     */
    private static final Facing NORTH_SLOPE = Facing.NORTH;

    private Manor() {}

    public static Blueprint build(int width, Materials.Wood wood, Materials.Stone stone) {
        int w = Math.max(11, Math.min(23, width | 1)); // odd, so the door centres
        int d = Math.max(9, w * 3 / 4 | 1);
        Draft draft = new Draft("manor");

        int groundTop = STOREY;            // walls run y=1..4
        int deck = groundTop + 1;          // y=5, the upper floor
        int upperTop = deck + STOREY;      // walls run y=6..9
        int roofBase = upperTop + 1;       // y=10
        int doorX = (w + 1) / 2;

        plinth(draft, w, d, stone);
        storey(draft, w, d, 1, groundTop, wood, stone, true);
        deck(draft, w, d, deck, wood);
        storey(draft, w, d, deck + 1, upperTop, wood, stone, false);
        roof(draft, w, d, roofBase, wood, stone);

        frontDoor(draft, doorX, d, wood, stone);
        porch(draft, doorX, wood, stone);
        staircase(draft, w, d, deck, wood);
        groundFloorFittings(draft, w, d, wood, stone);
        upperFloorFittings(draft, w, d, deck, wood);
        chimney(draft, w, d, roofBase, stone);

        return draft.finish(doorX, 1, 0);
    }

    /**
     * A course of masonry one block proud of the walls.
     *
     * Without it the walls grow straight out of the grass, which is the single
     * clearest sign that nobody thought about how the building meets the ground.
     */
    private static void plinth(Draft draft, int w, int d, Materials.Stone stone) {
        draft.box(0, 0, 0, w + 1, 0, d + 1, stone.block(), Role.FLOOR);
    }

    private static void storey(Draft draft, int w, int d, int from, int to,
                               Materials.Wood wood, Materials.Stone stone, boolean ground) {
        draft.shell(1, from, 1, w, to, d, wood.planks(), Role.WALL);

        // Posts at the corners and every fourth block, so a long wall is broken
        // up instead of reading as one flat sheet.
        for (int x = 1; x <= w; x++) {
            boolean post = x == 1 || x == w || (x - 1) % 4 == 0;
            if (!post) continue;
            for (int y = from; y <= to; y++) {
                draft.set(x, y, 1, wood.log(), Role.ACCENT);
                draft.set(x, y, d, wood.log(), Role.ACCENT);
            }
        }
        for (int z = 1; z <= d; z++) {
            boolean post = z == 1 || z == d || (z - 1) % 4 == 0;
            if (!post) continue;
            for (int y = from; y <= to; y++) {
                draft.set(1, y, z, wood.log(), Role.ACCENT);
                draft.set(w, y, z, wood.log(), Role.ACCENT);
            }
        }

        // A band of stone at the base of the ground floor, tying the walls to
        // the plinth rather than leaving a hard line between wood and ground.
        if (ground) {
            for (int x = 2; x < w; x++) {
                if (!draft.has(x, from, 1)) continue;
                draft.set(x, from, 1, stone.block(), Role.ACCENT);
                draft.set(x, from, d, stone.block(), Role.ACCENT);
            }
            for (int z = 2; z < d; z++) {
                draft.set(1, from, z, stone.block(), Role.ACCENT);
                draft.set(w, from, z, stone.block(), Role.ACCENT);
            }
        }

        windows(draft, w, d, from, to);
    }

    /** Two courses of glass at eye level, between the posts. */
    private static void windows(Draft draft, int w, int d, int from, int to) {
        int sill = from + 1;
        int head = Math.min(to - 1, sill + 1);
        for (int x = 2; x < w; x++) {
            if ((x - 1) % 4 == 0) continue;
            if ((x - 1) % 4 == 1 || (x - 1) % 4 == 2) {
                for (int y = sill; y <= head; y++) {
                    draft.set(x, y, 1, "glass_pane", Role.WINDOW, true);
                    draft.set(x, y, d, "glass_pane", Role.WINDOW, true);
                }
            }
        }
        for (int z = 2; z < d; z++) {
            if ((z - 1) % 4 == 0) continue;
            if ((z - 1) % 4 == 1 || (z - 1) % 4 == 2) {
                for (int y = sill; y <= head; y++) {
                    draft.set(1, y, z, "glass_pane", Role.WINDOW, true);
                    draft.set(w, y, z, "glass_pane", Role.WINDOW, true);
                }
            }
        }
    }

    /** The floor between the storeys. */
    private static void deck(Draft draft, int w, int d, int y, Materials.Wood wood) {
        draft.box(1, y, 1, w, y, d, wood.planks(), Role.FLOOR);
    }

    private static void frontDoor(Draft draft, int doorX, int d, Materials.Wood wood,
                                  Materials.Stone stone) {
        draft.clear(doorX, 1, 1);
        draft.clear(doorX, 2, 1);
        draft.set(doorX, 1, 1, wood.door(), Role.DOOR);
        // A lintel over the opening, and lamps either side of it.
        draft.set(doorX, 3, 1, stone.block(), Role.ACCENT);
        draft.set(doorX - 1, 3, 0, "torch", Role.LIGHT, true);
        draft.set(doorX + 1, 3, 0, "torch", Role.LIGHT, true);
    }

    /** A covered step outside the door, so the entrance is somewhere and not just a hole. */
    private static void porch(Draft draft, int doorX, Materials.Wood wood, Materials.Stone stone) {
        draft.facing(doorX, 1, 0, stone.stairs(), Role.ACCENT, NORTH_SLOPE);
        draft.set(doorX - 1, 1, 0, wood.fence(), Role.ACCENT, true);
        draft.set(doorX + 1, 1, 0, wood.fence(), Role.ACCENT, true);
        draft.set(doorX - 1, 2, 0, wood.fence(), Role.ACCENT, true);
        draft.set(doorX + 1, 2, 0, wood.fence(), Role.ACCENT, true);
        for (int x = doorX - 1; x <= doorX + 1; x++) {
            draft.set(x, 3, 0, wood.slab(), Role.ROOF, true);
        }
    }

    /**
     * Stairs up the inside of the back wall, and the hole they arrive through.
     *
     * The hole is cut after the deck is laid, which is the whole reason Draft
     * lets a later write win: describing the floor and then removing the part
     * the stairs come through is how a person would say it.
     */
    private static void staircase(Draft draft, int w, int d, int deckY, Materials.Wood wood) {
        int z = d - 1;
        // One more step than the storey is tall. The deck is the floor of the
        // upper room, so the flight has to finish level with it rather than one
        // short — the difference between arriving upstairs and arriving at a
        // hole in the ceiling with nothing to step onto.
        for (int step = 0; step <= STOREY; step++) {
            int x = 2 + step;
            int y = 1 + step;
            draft.facing(x, y, z, wood.stairs(), Role.FURNITURE, Facing.EAST);
            draft.clear(x, y + 1, z);
            draft.clear(x, y + 2, z);
        }
        // Open the deck above the flight itself, but not above the top step —
        // that one is level with the deck and is what you walk off onto.
        for (int step = 0; step < STOREY; step++) {
            draft.clear(2 + step, deckY, z);
        }
        // A rail along the open side, so the stairwell is not a trip hazard.
        for (int step = 0; step <= STOREY; step++) {
            draft.set(2 + step, deckY + 1, z - 1, wood.fence(), Role.ACCENT, true);
        }
    }

    /** A kitchen, a workbench, a table to sit at, and light to see it by. */
    private static void groundFloorFittings(Draft draft, int w, int d,
                                            Materials.Wood wood, Materials.Stone stone) {
        int back = d - 1;

        // Work wall: furnaces, bench, chests, all reachable without moving.
        draft.set(w - 2, 1, back, "furnace", Role.FURNITURE, true);
        draft.set(w - 3, 1, back, "furnace", Role.FURNITURE, true);
        draft.set(w - 4, 1, back, "crafting_table", Role.FURNITURE, true);
        draft.set(w - 5, 1, back, "chest", Role.FURNITURE, true);
        draft.set(w - 6, 1, back, "chest", Role.FURNITURE, true);

        // A table you can actually sit at: posts with a slab top, chairs facing in.
        int tx = (w + 1) / 2;
        int tz = d / 2;
        draft.set(tx, 1, tz, wood.fence(), Role.FURNITURE, true);
        draft.set(tx + 1, 1, tz, wood.fence(), Role.FURNITURE, true);
        draft.set(tx, 2, tz, wood.slab(), Role.FURNITURE, true);
        draft.set(tx + 1, 2, tz, wood.slab(), Role.FURNITURE, true);
        draft.facing(tx, 1, tz - 1, wood.stairs(), Role.FURNITURE, Facing.SOUTH);
        draft.facing(tx + 1, 1, tz + 1, wood.stairs(), Role.FURNITURE, Facing.NORTH);

        for (int z = 2; z < d; z += 3) {
            draft.set(2, 3, z, "torch", Role.LIGHT, true);
            draft.set(w - 1, 3, z, "torch", Role.LIGHT, true);
        }
        draft.set(2, 1, 2, "bookshelf", Role.FURNITURE, true);
        draft.set(2, 2, 2, "bookshelf", Role.FURNITURE, true);
        draft.set(3, 1, 2, "bookshelf", Role.FURNITURE, true);
    }

    /** Somewhere to sleep, and somewhere to put everything. */
    private static void upperFloorFittings(Draft draft, int w, int d, int deckY,
                                           Materials.Wood wood) {
        int y = deckY + 1;
        // Beds occupy two blocks in the game from a single placement, so the
        // head is all that is described; the foot follows from where it faces.
        draft.facing(3, y, 2, "white_bed", Role.FURNITURE, Facing.SOUTH);
        draft.facing(5, y, 2, "white_bed", Role.FURNITURE, Facing.SOUTH);

        for (int x = w - 4; x <= w - 1; x++) {
            draft.set(x, y, d - 1, "chest", Role.FURNITURE, true);
        }
        draft.set(w - 1, y, 2, "bookshelf", Role.FURNITURE, true);
        draft.set(w - 2, y, 2, "bookshelf", Role.FURNITURE, true);
        draft.set(w - 1, y + 1, 2, "bookshelf", Role.FURNITURE, true);

        for (int z = 2; z < d; z += 3) {
            draft.set(2, y + 2, z, "torch", Role.LIGHT, true);
            draft.set(w - 1, y + 2, z, "torch", Role.LIGHT, true);
        }
        draft.set(w / 2, y, d / 2, wood.trapdoor(), Role.FURNITURE, true);
    }

    /**
     * A pitched roof with a one-block overhang, stepped in stairs.
     *
     * The overhang is what stops the roof looking like a lid. The gable ends are
     * filled in as they narrow, which is the part that is easy to forget and
     * leaves two triangular holes for anything to walk in through.
     */
    private static void roof(Draft draft, int w, int d, int base,
                             Materials.Wood wood, Materials.Stone stone) {
        int left = 0;
        int right = w + 1;
        for (int course = 0; ; course++) {
            int y = base + course;
            int near = course;
            int far = d + 1 - course;
            if (near > far) break;

            for (int x = left; x <= right; x++) {
                if (near == far) {
                    draft.set(x, y, near, stone.slab(), Role.ROOF); // the ridge cap
                } else {
                    draft.facing(x, y, near, stone.stairs(), Role.ROOF, NORTH_SLOPE);
                    draft.facing(x, y, far, stone.stairs(), Role.ROOF, NORTH_SLOPE.opposite());
                }
            }
            // Close the gable triangle at both ends of the ridge.
            for (int z = near + 1; z < far; z++) {
                draft.set(left, y, z, wood.planks(), Role.WALL);
                draft.set(right, y, z, wood.planks(), Role.WALL);
            }
            if (near == far) break;
        }
    }

    /** A stack from the furnaces out through the roof, because a chimney reads as a house. */
    private static void chimney(Draft draft, int w, int d, int roofBase, Materials.Stone stone) {
        int x = w - 2;
        int z = d;
        for (int y = 2; y <= roofBase + (d / 2) + 2; y++) {
            draft.set(x, y, z, stone.block(), Role.ACCENT);
        }
    }
}
