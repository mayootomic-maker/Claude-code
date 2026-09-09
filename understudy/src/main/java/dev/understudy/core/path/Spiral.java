package dev.understudy.core.path;

import java.util.ArrayList;
import java.util.List;

/**
 * Offsets in order of increasing distance, for looking outward from a point.
 *
 * Used to find the nearest block of some kind. Scanning a cube in x, y, z order
 * would find the corner of the search box before the block two steps behind you,
 * which is how a gatherer ends up walking sixty blocks past the tree it was
 * standing next to.
 *
 * The order is built once and shared: it is a few thousand offsets, it never
 * changes, and rebuilding it per search would cost more than the search.
 */
public final class Spiral {

    private static final int DEFAULT_RADIUS = 48;
    private static final int DEFAULT_HEIGHT = 24;
    private static final List<int[]> DEFAULT = build(DEFAULT_RADIUS, DEFAULT_HEIGHT);

    private Spiral() {}

    public static List<int[]> offsets() {
        return DEFAULT;
    }

    /**
     * Every offset within a horizontal radius and a vertical reach, nearest
     * first.
     *
     * Vertical is weighted: a block ten below you is much further away in
     * practice than one ten to the side, because getting to it means digging.
     */
    public static List<int[]> build(int radius, int height) {
        List<int[]> offsets = new ArrayList<>();
        for (int x = -radius; x <= radius; x++) {
            for (int z = -radius; z <= radius; z++) {
                for (int y = -height; y <= height; y++) {
                    if (x * x + z * z > radius * radius) continue;
                    offsets.add(new int[]{x, y, z});
                }
            }
        }
        offsets.sort((a, b) -> Double.compare(weight(a), weight(b)));
        return List.copyOf(offsets);
    }

    private static double weight(int[] offset) {
        double vertical = offset[1] * (offset[1] < 0 ? 2.5 : 1.6);
        return offset[0] * offset[0] + offset[2] * offset[2] + vertical * vertical;
    }
}
