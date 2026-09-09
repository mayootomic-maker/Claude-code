package dev.understudy.core.path;

/** One move in a path: where to end up, and how to get there. */
public record Step(int x, int y, int z, Kind kind, double cost) {

    public enum Kind {
        /** Ordinary walking, including diagonals. */
        WALK,
        /** Step or jump up one block. */
        JUMP,
        /** Drop down one or more blocks. */
        FALL,
        /** Swim through fluid. */
        SWIM,
        /** Break the blocking block, then walk into it. */
        DIG,
        /** Place a block underfoot to cross a gap. */
        BRIDGE
    }

    public long key() {
        return PathFinder.key(x, y, z);
    }
}
