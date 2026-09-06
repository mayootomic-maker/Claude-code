package dev.understudy.core.model;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * Reads Wavefront .obj, which is the format every 3D tool can export.
 *
 * Only the four directives that survive being turned into blocks: vertices,
 * faces, which material a face uses, and the library that defines them.
 * Normals, texture coordinates, smoothing groups and object names are read past
 * without comment, because a voxel has no use for any of them.
 *
 * The three awkward corners of the format, all of which appear in real files:
 * a face may have any number of vertices and needs triangulating; an index may
 * be negative, meaning "counted back from here" rather than from the start; and
 * a vertex reference may be "v", "v/vt", "v//vn" or "v/vt/vn", so only the part
 * before the first slash is ever the position.
 */
public final class ObjReader {

    /** Above this a model is a scan, not a build, and voxelising it would hang. */
    public static final int MAX_TRIANGLES = 400_000;

    private ObjReader() {}

    /**
     * @param materials looks up a named .mtl file's contents, or returns null.
     *                  A file that references materials it cannot find still
     *                  loads — as a shape without colours, which is most of
     *                  what matters.
     */
    public static Mesh read(byte[] file, Function<String, byte[]> materials) throws IOException {
        List<double[]> vertices = new ArrayList<>();
        List<Mesh.Triangle> triangles = new ArrayList<>();
        Map<String, Integer> palette = Map.of();
        int colour = -1;

        for (String raw : new String(file, StandardCharsets.UTF_8).split("\\R")) {
            String line = raw.trim();
            if (line.isEmpty() || line.startsWith("#")) continue;
            String[] parts = line.split("\\s+");

            switch (parts[0]) {
                case "v" -> {
                    if (parts.length < 4) continue;
                    vertices.add(new double[]{number(parts[1]), number(parts[2]), number(parts[3])});
                }
                case "mtllib" -> {
                    if (parts.length < 2) continue;
                    byte[] library = materials == null ? null : materials.apply(parts[1]);
                    if (library != null) palette = MtlReader.read(library);
                }
                case "usemtl" -> colour = parts.length < 2 ? -1 : palette.getOrDefault(parts[1], -1);
                case "f" -> {
                    List<double[]> corners = new ArrayList<>();
                    for (int i = 1; i < parts.length; i++) {
                        double[] vertex = vertexFor(parts[i], vertices);
                        if (vertex != null) corners.add(vertex);
                    }
                    // Fan triangulation. Correct for the convex faces that
                    // exporters produce, and a concave one becomes slightly the
                    // wrong shape rather than nothing at all.
                    for (int i = 1; i + 1 < corners.size(); i++) {
                        triangles.add(new Mesh.Triangle(corners.get(0), corners.get(i),
                                corners.get(i + 1), colour));
                        if (triangles.size() > MAX_TRIANGLES) {
                            throw new IOException("that model has more than " + MAX_TRIANGLES
                                    + " triangles, which is too detailed to turn into blocks");
                        }
                    }
                }
                default -> { } // normals, texture coordinates, groups: not our business
            }
        }
        if (triangles.isEmpty()) throw new IOException("no faces in that .obj");
        return Mesh.of(triangles);
    }

    private static double[] vertexFor(String reference, List<double[]> vertices) {
        // "12", "12/4", "12//7" and "12/4/7" all mean vertex twelve.
        int slash = reference.indexOf('/');
        String index = slash < 0 ? reference : reference.substring(0, slash);
        if (index.isEmpty()) return null;
        int at;
        try {
            at = Integer.parseInt(index);
        } catch (NumberFormatException error) {
            return null;
        }
        // One-based, and a negative index counts back from the most recent.
        int resolved = at < 0 ? vertices.size() + at : at - 1;
        return resolved >= 0 && resolved < vertices.size() ? vertices.get(resolved) : null;
    }

    private static double number(String text) {
        try {
            return Double.parseDouble(text);
        } catch (NumberFormatException error) {
            return 0;
        }
    }

    /** The part of .mtl that matters: a name and a diffuse colour. */
    static final class MtlReader {
        private MtlReader() {}

        static Map<String, Integer> read(byte[] file) {
            Map<String, Integer> colours = new HashMap<>();
            String current = null;
            for (String raw : new String(file, StandardCharsets.UTF_8).split("\\R")) {
                String line = raw.trim();
                String[] parts = line.split("\\s+");
                if (parts.length >= 2 && parts[0].equals("newmtl")) {
                    current = parts[1];
                } else if (parts.length >= 4 && parts[0].equals("Kd") && current != null) {
                    // Kd is 0..1 per channel.
                    int r = channel(parts[1]);
                    int g = channel(parts[2]);
                    int b = channel(parts[3]);
                    colours.put(current, 0xFF000000 | (r << 16) | (g << 8) | b);
                }
            }
            return colours;
        }

        private static int channel(String text) {
            try {
                return (int) Math.round(Math.max(0, Math.min(1, Double.parseDouble(text))) * 255);
            } catch (NumberFormatException error) {
                return 128;
            }
        }
    }
}
