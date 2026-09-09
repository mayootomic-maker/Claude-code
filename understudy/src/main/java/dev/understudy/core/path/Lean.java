package dev.understudy.core.path;

/**
 * Stepping one block to the side, and whether that is a good idea.
 *
 * Leaning out is what gets you past a fence post, which jumping never does and
 * pressing forward harder has never done in the history of the game. It is also
 * an excellent way to walk off the cliff you were stuck at the edge of, and the
 * second one costs a life — so the cell is checked before the key goes down,
 * against the same rules the pathfinder uses for anywhere else.
 *
 * Here rather than in the walker because both halves are arithmetic and block
 * lookups, and because a rule about not walking off cliffs is worth being able
 * to test without a cliff.
 */
public final class Lean {
    private Lean() {}

    /** How far down is survivable to step into. Matches the pathfinder's own. */
    private static final int SAFE_DROP = 3;


    /**
     * The block you would end up in.
     *
     * Facing south — yaw zero, +Z — your left hand points east, so left is
     * (cos yaw, sin yaw). Getting this backwards produces a mod that leans into
     * the wall it is stuck on, which looks identical to being stuck.
     */
    public static int[] cell(double px, double py, double pz, double yawDegrees,
                             boolean leftward) {
        double yaw = Math.toRadians(yawDegrees);
        double vx = Math.cos(yaw);
        double vz = Math.sin(yaw);
        if (!leftward) {
            vx = -vx;
            vz = -vz;
        }
        return new int[]{
                (int) Math.floor(px + vx),
                (int) Math.floor(py),
                (int) Math.floor(pz + vz)};
    }

    /**
     * Whether that block is somewhere a person would put a foot.
     *
     * Feet and head clear, nothing that hurts, and ground within a survivable
     * drop — or water, which you can fall into without noticing.
     */
    public static boolean safe(BlockView world, int x, int y, int z) {
        if (!world.known(x, y, z)) return false;
        if (!world.passable(x, y, z) || !world.passable(x, y + 1, z)) return false;
        if (world.hazard(x, y, z) || world.hazard(x, y + 1, z)) return false;
        for (int drop = 1; drop <= SAFE_DROP; drop++) {
            if (world.hazard(x, y - drop, z)) return false;
            if (world.liquid(x, y - drop, z)) return true;
            if (world.solid(x, y - drop, z)) return true;
        }
        return false;
    }
}
