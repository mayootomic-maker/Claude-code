package dev.understudy.core.model;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Turns triangles into blocks.
 *
 * The model is scaled so its tallest dimension is the requested number of
 * blocks, then every triangle is walked and the cells it passes through are
 * filled. Walking rather than intersecting: each triangle is split in half until
 * the pieces are smaller than a cell, and then the cell containing each piece's
 * centre is marked. Triangle-against-box intersection is the textbook method and
 * is fiddly to get exactly right at edges and corners; subdividing cannot miss a
 * cell the surface passes through, and the only cost is doing a little more
 * arithmetic than strictly necessary.
 *
 * Surface only by default, because that is what a Minecraft build is: a shell
 * you can walk into. Filling a model solid multiplies the block count by the
 * thickness and produces something nobody can get inside.
 *
 * Up is Y in Minecraft and in most exporters, but Blender and a lot of CAD use
 * Z. Rather than ask, the axis with the smallest extent is taken as depth and
 * the model is stood up if it is obviously lying down — a building is taller
 * than it is deep, and getting this wrong leaves a house on its face.
 */
public final class Voxeliser {

    /** Never produce more than this, whatever size was asked for. */
    public static final int MAX_BLOCKS = 200_000;

    public record Options(int height, boolean solid, boolean standUp) {
        public static Options ofHeight(int height) {
            return new Options(height, false, true);
        }
    }

    /** A filled cell and the colour of the triangle that filled it. */
    public record Voxels(Map<Long, Integer> cells, int sizeX, int sizeY, int sizeZ) {
        public int count() {
            return cells.size();
        }
    }

    private Voxeliser() {}

    public static Voxels voxelise(Mesh mesh, Options options) {
        double[] box = mesh.bounds();
        double spanX = box[3] - box[0];
        double spanY = box[4] - box[1];
        double spanZ = box[5] - box[2];

        // Z-up files come out lying on their face otherwise.
        boolean swapYZ = options.standUp() && spanZ > spanY * 1.4 && spanZ > spanX * 0.6;

        double up = swapYZ ? spanZ : spanY;
        double scale = up <= 0 ? 1 : Math.max(1, options.height()) / up;

        Map<Long, Integer> cells = new LinkedHashMap<>();
        int[] extent = {0, 0, 0};
        for (Mesh.Triangle triangle : mesh.triangles()) {
            double[] a = place(triangle.a(), box, scale, swapYZ);
            double[] b = place(triangle.b(), box, scale, swapYZ);
            double[] c = place(triangle.c(), box, scale, swapYZ);
            fill(cells, extent, a, b, c, triangle.argb());
            if (cells.size() > MAX_BLOCKS) break;
        }

        Voxels voxels = new Voxels(cells, extent[0] + 1, extent[1] + 1, extent[2] + 1);
        return options.solid() ? solidify(voxels) : voxels;
    }

    /** Into blueprint space: scaled, stood up if need be, and starting at the origin. */
    private static double[] place(double[] point, double[] box, double scale, boolean swapYZ) {
        double x = (point[0] - box[0]) * scale;
        double y = (point[1] - box[1]) * scale;
        double z = (point[2] - box[2]) * scale;
        return swapYZ ? new double[]{x, z, y} : new double[]{x, y, z};
    }

    /**
     * Mark every cell the triangle touches, by halving it until the pieces are
     * smaller than a cell.
     */
    private static void fill(Map<Long, Integer> cells, int[] extent,
                             double[] a, double[] b, double[] c, int argb) {
        Deque<double[][]> pending = new ArrayDeque<>();
        pending.push(new double[][]{a, b, c});
        int guard = 0;
        while (!pending.isEmpty() && guard++ < 200_000) {
            double[][] triangle = pending.pop();
            double longest = 0;
            int side = 0;
            for (int i = 0; i < 3; i++) {
                double length = distance(triangle[i], triangle[(i + 1) % 3]);
                if (length > longest) {
                    longest = length;
                    side = i;
                }
            }
            if (longest < 0.5) {
                double[] centre = {
                        (triangle[0][0] + triangle[1][0] + triangle[2][0]) / 3,
                        (triangle[0][1] + triangle[1][1] + triangle[2][1]) / 3,
                        (triangle[0][2] + triangle[1][2] + triangle[2][2]) / 3};
                mark(cells, extent, (int) centre[0], (int) centre[1], (int) centre[2], argb);
                continue;
            }
            // Split the longest edge, which keeps the pieces from going needle
            // thin the way splitting a fixed edge would.
            double[] p = triangle[side];
            double[] q = triangle[(side + 1) % 3];
            double[] r = triangle[(side + 2) % 3];
            double[] middle = {(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2};
            pending.push(new double[][]{p, middle, r});
            pending.push(new double[][]{middle, q, r});
        }
    }

    private static void mark(Map<Long, Integer> cells, int[] extent, int x, int y, int z, int argb) {
        if (x < 0 || y < 0 || z < 0) return;
        extent[0] = Math.max(extent[0], x);
        extent[1] = Math.max(extent[1], y);
        extent[2] = Math.max(extent[2], z);
        cells.putIfAbsent(key(x, y, z), argb);
    }

    /**
     * Fill the inside, by flooding the outside and keeping whatever the flood
     * could not reach.
     *
     * Flooding from outside rather than testing each cell for insideness: a
     * scanline parity test is undone by any hole in the mesh, and exported
     * models are full of holes. The worst a leak can do here is leave the model
     * hollow, which is what it was anyway.
     */
    private static Voxels solidify(Voxels voxels) {
        int sx = voxels.sizeX() + 2, sy = voxels.sizeY() + 2, sz = voxels.sizeZ() + 2;
        boolean[] outside = new boolean[sx * sy * sz];
        Deque<int[]> queue = new ArrayDeque<>();
        queue.add(new int[]{0, 0, 0});
        outside[0] = true;

        while (!queue.isEmpty()) {
            int[] at = queue.poll();
            for (int[] step : new int[][]{{1, 0, 0}, {-1, 0, 0}, {0, 1, 0}, {0, -1, 0},
                    {0, 0, 1}, {0, 0, -1}}) {
                int x = at[0] + step[0], y = at[1] + step[1], z = at[2] + step[2];
                if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) continue;
                int index = (y * sz + z) * sx + x;
                if (outside[index]) continue;
                if (voxels.cells().containsKey(key(x - 1, y - 1, z - 1))) continue;
                outside[index] = true;
                queue.add(new int[]{x, y, z});
            }
        }

        Map<Long, Integer> filled = new LinkedHashMap<>(voxels.cells());
        for (int x = 0; x < voxels.sizeX(); x++) {
            for (int y = 0; y < voxels.sizeY(); y++) {
                for (int z = 0; z < voxels.sizeZ(); z++) {
                    if (filled.containsKey(key(x, y, z))) continue;
                    if (outside[((y + 1) * sz + (z + 1)) * sx + (x + 1)]) continue;
                    filled.put(key(x, y, z), -1);
                    if (filled.size() > MAX_BLOCKS) return voxels; // give up rather than hang
                }
            }
        }
        return new Voxels(filled, voxels.sizeX(), voxels.sizeY(), voxels.sizeZ());
    }

    private static double distance(double[] a, double[] b) {
        double dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    public static long key(int x, int y, int z) {
        return ((long) (x + 1024) << 42) | ((long) (y + 1024) << 21) | (z + 1024);
    }

    public static int x(long key) {
        return (int) (key >>> 42) - 1024;
    }

    public static int y(long key) {
        return (int) ((key >>> 21) & 0x1FFFFF) - 1024;
    }

    public static int z(long key) {
        return (int) (key & 0x1FFFFF) - 1024;
    }

    /** For tests and callers that want the cells rather than the packed keys. */
    public static Map<String, Integer> readable(Voxels voxels) {
        Map<String, Integer> out = new HashMap<>();
        voxels.cells().forEach((key, argb) ->
                out.put(x(key) + "," + y(key) + "," + z(key), argb));
        return out;
    }
}
