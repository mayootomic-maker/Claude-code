package dev.understudy.core.path;

import java.util.ArrayList;
import java.util.List;

/**
 * Pulls the slack out of a path.
 *
 * A* on a block grid can only move between cell centres, so a straight walk
 * across open ground comes back as a staircase of alternating diagonal and
 * cardinal steps. Followed literally that reads as a wobble, because it is one:
 * the walker really is turning every block. No amount of smoothing the *camera*
 * fixes it, because the path itself is the thing that zigzags.
 *
 * So the corners come out here instead. Walking a straight line from an anchor
 * as far as the world allows, and dropping everything in between, is the
 * standard string-pulling trick, and it turns a staircase into the diagonal a
 * person would actually walk.
 *
 * Only WALK steps on one level are ever shortcut. A jump, a dig, a bridge or a
 * fall is a specific action at a specific block, and skipping past it would
 * describe a route that cannot be walked.
 */
public final class Smoother {

    /** How finely the straight line is checked. Under half a block, so no cell is skipped. */
    private static final double SAMPLE = 0.35;

    private Smoother() {}

    public static List<Step> smooth(List<Step> path, BlockView world) {
        if (path.size() < 3) return path;

        List<Step> out = new ArrayList<>();
        int anchor = 0;
        out.add(path.get(0));

        while (anchor < path.size() - 1) {
            int best = anchor + 1;
            // Reach as far ahead as the straight line stays walkable. Stopping at
            // the first failure rather than searching past it keeps this linear,
            // and a blocked line does not become clear again further on.
            for (int candidate = anchor + 2; candidate < path.size(); candidate++) {
                if (!straightWalkable(path, anchor, candidate, world)) break;
                best = candidate;
            }
            out.add(path.get(best));
            anchor = best;
        }
        return out;
    }

    /**
     * Whether the player can walk the straight line from one step to another.
     *
     * Every step in between must be plain walking on the same level, and the
     * line itself must be clear: two blocks of headroom, solid footing, and no
     * hazard anywhere along it.
     */
    private static boolean straightWalkable(List<Step> path, int from, int to, BlockView world) {
        Step a = path.get(from);
        Step b = path.get(to);
        if (a.y() != b.y()) return false;

        for (int i = from; i <= to; i++) {
            Step step = path.get(i);
            if (step.kind() != Step.Kind.WALK) return false;
            if (step.y() != a.y()) return false;
        }

        double dx = b.x() - a.x();
        double dz = b.z() - a.z();
        double length = Math.sqrt(dx * dx + dz * dz);
        if (length == 0) return true;

        int samples = (int) Math.ceil(length / SAMPLE);
        for (int i = 0; i <= samples; i++) {
            double t = (double) i / samples;
            // Cell centres, so the sampled point is the middle of the block the
            // player would be standing in rather than its corner.
            int cx = (int) Math.floor(a.x() + dx * t + 0.5);
            int cz = (int) Math.floor(a.z() + dz * t + 0.5);
            if (!walkableCell(world, cx, a.y(), cz)) return false;
        }
        return true;
    }

    private static boolean walkableCell(BlockView world, int x, int y, int z) {
        return world.known(x, y, z)
                && world.passable(x, y, z)
                && world.passable(x, y + 1, z)
                && world.solid(x, y - 1, z)
                && !world.hazard(x, y, z)
                && !world.hazard(x, y - 1, z)
                && !world.liquid(x, y, z);
    }
}
