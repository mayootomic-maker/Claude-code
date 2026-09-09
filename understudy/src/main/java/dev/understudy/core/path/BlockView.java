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

    /**
     * Whether this block is taller than the metre it appears to be.
     *
     * A fence, a wall and a fence gate are one block of world and one and a half
     * blocks of collision, and the game will not let you jump onto one. Without
     * this the search sees a solid block with two clear cells above it, calls
     * that a step up, and hands the walker a route whose next move is to jump
     * onto a fence — which the walker then attempts, forever, pressed against a
     * fence post. Farms and villages are full of them, and this was the single
     * most reliable way to get stuck.
     */
    default boolean tall(int x, int y, int z) {
        return false;
    }

    /**
     * A door, gate or trapdoor you could just open.
     *
     * Solid to a collision test and not really an obstacle at all. Treating
     * them as walls is why a route inside a building comes back as no route.
     */
    default boolean openable(int x, int y, int z) {
        return false;
    }

    /** Whether the search may consider this cell at all. Chunks may not be loaded. */
    default boolean known(int x, int y, int z) {
        return true;
    }
}
