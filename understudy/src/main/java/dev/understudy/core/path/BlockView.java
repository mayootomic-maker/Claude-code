package dev.understudy.core.path;

/**
 * The only thing the pathfinder knows about the world.
 *
 * Deliberately tiny, and deliberately free of any Minecraft type. The search is
 * the part most likely to be wrong and hardest to debug inside a running game,
 * so it is written against four questions that a synthetic test world can
 * answer just as well as the real one. The adapter that answers them from
 * Minecraft's chunks is a separate, much duller file.
 */
public interface BlockView {

    /** Whether a player can occupy this cell — air, grass, water, an open door. */
    boolean passable(int x, int y, int z);

    /** Whether this cell can be stood on. */
    boolean solid(int x, int y, int z);

    /** Lava, fire, cactus, a magma block, powder snow: things to route around. */
    boolean hazard(int x, int y, int z);

    /** Water or any other fluid the player would swim through rather than walk. */
    boolean liquid(int x, int y, int z);

    /**
     * Seconds to break this block with whatever is currently held, or a
     * negative number if it cannot or should not be broken. Used only when
     * digging is allowed.
     */
    double breakSeconds(int x, int y, int z);

    /** Whether the search may consider this cell at all. Chunks may not be loaded. */
    default boolean known(int x, int y, int z) {
        return true;
    }
}
