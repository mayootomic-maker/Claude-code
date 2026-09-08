package dev.understudy.core.nether;

import dev.understudy.core.build.Blueprint;
import dev.understudy.core.build.Draft;

import java.util.ArrayList;
import java.util.List;

/**
 * A nether portal, as geometry and as arithmetic.
 *
 * The frame is a blueprint like any other, which is the point: the mod already
 * knows how to work out what a blueprint costs, go and mine it, walk to a plot
 * and place ten blocks in the right order. A portal is ten obsidian in a shape,
 * so making it a blueprint means going to the Nether needed no new machinery for
 * any of the hard parts — only for lighting it and for stepping through.
 *
 * The corners are left out on purpose. A portal ignores them, so building them
 * costs four obsidian, and obsidian costs a diamond pickaxe and ten seconds a
 * block. Ten is the honest number.
 *
 * The arithmetic is the other half and it is the half people get wrong. One
 * block in the Nether is eight in the overworld, so the two worlds are the same
 * map at different scales — which is why walking a hundred blocks down there and
 * coming back puts you eight hundred from where you started. That is not a
 * curiosity, it is the fastest travel in the game, and it is the reason to know
 * where a portal comes out before building it rather than after.
 */
public final class Portal {
    private Portal() {}

    /** Obsidian for a frame with no corners, which is all a portal needs. */
    public static final int OBSIDIAN = 10;

    /** How many overworld blocks one nether block is worth. */
    public static final int SCALE = 8;

    /** Inside measurements: two wide, three tall. The smallest the game lights. */
    public static final int INSIDE_WIDE = 2;
    public static final int INSIDE_TALL = 3;

    /**
     * The frame, as a blueprint standing on the ground at its own corner.
     *
     * Four wide and five tall including the frame, laid along x. Which way round
     * it faces does not matter to the game and the site picker can turn it, so
     * there is only one of these.
     */
    public static Blueprint frame() {
        Draft draft = new Draft("portal");
        int wide = INSIDE_WIDE + 2;
        int tall = INSIDE_TALL + 2;
        for (int x = 0; x < wide; x++) {
            for (int y = 0; y < tall; y++) {
                boolean edgeX = x == 0 || x == wide - 1;
                boolean edgeY = y == 0 || y == tall - 1;
                // The corners are the cells that are on both edges, and a portal
                // does not look at them.
                if (edgeX == edgeY) continue;
                draft.set(x, y, 0, "obsidian", Blueprint.Role.WALL, false);
            }
        }
        // The way in is the bottom middle of the frame, which is also where the
        // fire goes and the only cell of it a person can reach standing up.
        return draft.finish(1, 1, 0);
    }

    /**
     * The cells the fire goes in, relative to the frame's own corner.
     *
     * Lighting any of them lights all of them, but the bottom middle is the one
     * a person can reach without jumping, and this has to be reachable from the
     * ground.
     */
    public static List<int[]> inside() {
        List<int[]> out = new ArrayList<>();
        for (int x = 1; x <= INSIDE_WIDE; x++) {
            for (int y = 1; y <= INSIDE_TALL; y++) out.add(new int[] {x, y, 0});
        }
        return out;
    }

    /** Where a portal built here comes out on the other side. */
    public static int[] across(int x, int z, boolean intoTheNether) {
        return intoTheNether
                ? new int[] {Math.floorDiv(x, SCALE), Math.floorDiv(z, SCALE)}
                : new int[] {x * SCALE, z * SCALE};
    }

    /**
     * How far a walk in the Nether is worth up above.
     *
     * The number that makes the place worth the trouble: a hundred blocks down
     * there is eight hundred up here, so a journey long enough to be a chore
     * becomes one that is over before the food bar moves.
     */
    public static int worthUpstairs(int netherBlocks) {
        return netherBlocks * SCALE;
    }

    /**
     * Whether going through is quicker than walking, for a journey of this length.
     *
     * Two portals and the walk between them, against the walk itself. The fixed
     * cost is what stops this being "always yes": a portal at each end is ten
     * obsidian and a diamond pickaxe, and for anything under a few hundred
     * blocks the walk was shorter than the digging.
     */
    public static boolean worthGoingUnder(int overworldBlocks) {
        return overworldBlocks > WORTH_IT;
    }

    /**
     * Below this the portal costs more than the walk saves.
     *
     * A thousand blocks is about four minutes of sprinting, which is roughly
     * what two portals cost to build once the obsidian is already in the bag —
     * and much less than it costs when it is not.
     */
    public static final int WORTH_IT = 1000;
}
