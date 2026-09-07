package dev.understudy.core.build;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * What a holographic blueprint should show, decided away from how to draw it.
 *
 * Drawing is a dozen lines against an API that moved three times this version;
 * deciding is the part with judgement in it, and it belongs where it can be
 * tested. Given a blueprint, where it sits and how far the build has got, this
 * says which boxes to outline and in what colour.
 *
 * The judgement is mostly about restraint. A manor is eleven hundred blocks and
 * outlining all of them is a solid glowing lump you cannot see the shape of,
 * let alone see through to place anything. So: only what is not built yet, only
 * what is near enough to matter, and the surface rather than the interior —
 * because a wireframe of a filled volume is a scribble, and its outside is the
 * shape you actually wanted to check.
 */
public final class Hologram {

    /** One block's worth of outline. Colours are ARGB. */
    public record Ghost(int x, int y, int z, int argb) {}

    /** Far enough to see the whole building, near enough not to draw a city. */
    public static final int RANGE = 64;
    /** Above this many boxes even a good machine starts to feel it. */
    public static final int MAX_GHOSTS = 4_000;

    /** Still to do: the plan, in the blueprint's own material colours. */
    private static final int PENDING_ALPHA = 0xB0000000;
    /** The next block to be placed, called out so you can see where it is up to. */
    public static final int NEXT = 0xFFFFFFFF;
    /** Done, and dimmed almost to nothing: confirmation, not decoration. */
    public static final int PLACED = 0x30707070;

    private Hologram() {}

    /**
     * @param blueprint what is being built
     * @param originX   where the blueprint's own corner sits in the world
     * @param placed    how many of the build order are already done
     * @param nextIndex the one about to be placed, or -1
     * @param eyeX      where the player is, for range and for what to bother with
     * @param showDone  whether to dim in the finished blocks as well
     */
    public static List<Ghost> of(Blueprint blueprint, int originX, int originY, int originZ,
                                 int placed, int nextIndex,
                                 double eyeX, double eyeY, double eyeZ, boolean showDone) {
        List<Blueprint.Placement> order = blueprint.buildOrder();
        Map<String, Integer> colours = new java.util.HashMap<>();
        // Positions once, rather than a scan per neighbour test: the manor is
        // eleven hundred blocks and six lookups each of a linear search is the
        // difference between a frame and a stutter.
        java.util.Set<Long> filled = new java.util.HashSet<>();
        for (Blueprint.Placement p : order) filled.add(cell(p.x(), p.y(), p.z()));
        List<Ghost> ghosts = new ArrayList<>();

        for (int i = 0; i < order.size() && ghosts.size() < MAX_GHOSTS; i++) {
            Blueprint.Placement p = order.get(i);
            boolean done = i < placed;
            if (done && !showDone) continue;

            int x = originX + p.x();
            int y = originY + p.y();
            int z = originZ + p.z();
            if (far(x, y, z, eyeX, eyeY, eyeZ)) continue;
            // The inside of a solid wall contributes nothing you can see and
            // everything to the mess. Only the faces that are exposed.
            if (!done && buried(filled, p)) continue;

            int argb;
            if (i == nextIndex) argb = NEXT;
            else if (done) argb = PLACED;
            else {
                argb = PENDING_ALPHA
                        | (colours.computeIfAbsent(p.block(), Palette::colourOf) & 0xFFFFFF);
            }
            ghosts.add(new Ghost(x, y, z, argb));
        }
        return ghosts;
    }

    private static boolean far(int x, int y, int z, double eyeX, double eyeY, double eyeZ) {
        double dx = x + 0.5 - eyeX;
        double dy = y + 0.5 - eyeY;
        double dz = z + 0.5 - eyeZ;
        return dx * dx + dy * dy + dz * dz > (double) RANGE * RANGE;
    }

    /**
     * Whether every side of this block is another block of the same plan.
     *
     * Such a block is invisible in the finished building and worse than
     * invisible in a wireframe, where it is a box drawn inside a box.
     */
    private static boolean buried(java.util.Set<Long> filled, Blueprint.Placement p) {
        return filled.contains(cell(p.x() + 1, p.y(), p.z()))
                && filled.contains(cell(p.x() - 1, p.y(), p.z()))
                && filled.contains(cell(p.x(), p.y() + 1, p.z()))
                && filled.contains(cell(p.x(), p.y() - 1, p.z()))
                && filled.contains(cell(p.x(), p.y(), p.z() + 1))
                && filled.contains(cell(p.x(), p.y(), p.z() - 1));
    }

    private static long cell(int x, int y, int z) {
        return ((long) (x & 0xFFFF) << 32) | ((long) (z & 0xFFFF) << 16) | (y & 0xFFFF);
    }
}
