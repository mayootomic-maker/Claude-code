package dev.understudy.core.model;

import java.util.ArrayList;
import java.util.List;

/**
 * A 3D model as triangles, which is all a voxeliser needs.
 *
 * Whatever the file said about normals, texture coordinates, smoothing groups
 * or object names is dropped on the way in. None of it survives being turned
 * into blocks, and carrying it would only mean writing code to ignore it later.
 *
 * Colour is per triangle rather than per vertex: Minecraft has one block per
 * cell and no way to shade it, so a gradient across a face is going to become
 * one block regardless.
 */
public record Mesh(List<Triangle> triangles) {

    /** One triangle, with the colour its material gave it, or -1 for none. */
    public record Triangle(double[] a, double[] b, double[] c, int argb) {}

    public boolean isEmpty() {
        return triangles.isEmpty();
    }

    /** Lowest and highest corner: [minX, minY, minZ, maxX, maxY, maxZ]. */
    public double[] bounds() {
        double[] box = {Double.MAX_VALUE, Double.MAX_VALUE, Double.MAX_VALUE,
                -Double.MAX_VALUE, -Double.MAX_VALUE, -Double.MAX_VALUE};
        for (Triangle triangle : triangles) {
            for (double[] point : List.of(triangle.a(), triangle.b(), triangle.c())) {
                for (int axis = 0; axis < 3; axis++) {
                    box[axis] = Math.min(box[axis], point[axis]);
                    box[axis + 3] = Math.max(box[axis + 3], point[axis]);
                }
            }
        }
        return box;
    }

    public boolean hasColours() {
        for (Triangle triangle : triangles) if (triangle.argb() != -1) return true;
        return false;
    }

    public static Mesh of(List<Triangle> triangles) {
        return new Mesh(List.copyOf(new ArrayList<>(triangles)));
    }
}
