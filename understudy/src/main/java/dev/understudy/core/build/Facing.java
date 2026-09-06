package dev.understudy.core.build;

/**
 * Which way a block faces, for the ones where it matters.
 *
 * Stairs, doors and trapdoors all take their orientation from the direction the
 * player is looking when they place it — not from the face that was clicked. So
 * a blueprint that only names a block builds a roof whose stairs all point the
 * same wrong way, and the difference between a design that looks built and one
 * that looks generated is almost entirely this.
 *
 * Deliberately only the four horizontal directions, because that is what the
 * blocks in these designs actually use, and because the vertical half of a stair
 * depends on where in a block face you click, which a builder cannot aim at
 * reliably.
 */
public enum Facing {
    NORTH(0, -1),
    SOUTH(0, 1),
    WEST(-1, 0),
    EAST(1, 0);

    private final int dx;
    private final int dz;

    Facing(int dx, int dz) {
        this.dx = dx;
        this.dz = dz;
    }

    public int dx() {
        return dx;
    }

    public int dz() {
        return dz;
    }

    /** The yaw to look at to place a block facing this way. */
    public float yaw() {
        return switch (this) {
            case SOUTH -> 0f;
            case WEST -> 90f;
            case NORTH -> 180f;
            case EAST -> -90f;
        };
    }

    public Facing opposite() {
        return switch (this) {
            case NORTH -> SOUTH;
            case SOUTH -> NORTH;
            case WEST -> EAST;
            case EAST -> WEST;
        };
    }
}
