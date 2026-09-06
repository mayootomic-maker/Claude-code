package dev.understudy.core.model;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Reads .stl, in both of its forms.
 *
 * The format has no materials and no colours, so an .stl becomes a shape and
 * the material is whatever is chosen in the menu. That is not a limitation of
 * this reader — there is genuinely nothing else in the file.
 *
 * Telling the two forms apart is the one trap. An ASCII file starts with
 * "solid", and so do plenty of binary ones, because the eighty-byte header is
 * often filled in by exporters that copied the ASCII convention. Sniffing the
 * word is therefore wrong; checking whether the declared triangle count matches
 * the actual file length is not, because binary .stl has a fixed record size.
 */
public final class StlReader {

    private static final int HEADER = 80;
    private static final int RECORD = 50; // 12 floats plus a two-byte attribute
    public static final int MAX_TRIANGLES = ObjReader.MAX_TRIANGLES;

    private StlReader() {}

    public static Mesh read(byte[] file) throws IOException {
        return looksBinary(file) ? binary(file) : ascii(file);
    }

    static boolean looksBinary(byte[] file) {
        if (file.length < HEADER + 4) return false;
        long declared = ByteBuffer.wrap(file, HEADER, 4).order(ByteOrder.LITTLE_ENDIAN).getInt()
                & 0xFFFFFFFFL;
        return HEADER + 4 + declared * RECORD == file.length;
    }

    private static Mesh binary(byte[] file) throws IOException {
        ByteBuffer buffer = ByteBuffer.wrap(file).order(ByteOrder.LITTLE_ENDIAN);
        buffer.position(HEADER);
        int count = buffer.getInt();
        if (count > MAX_TRIANGLES) {
            throw new IOException("that model has " + count
                    + " triangles, which is too detailed to turn into blocks");
        }
        List<Mesh.Triangle> triangles = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            buffer.position(buffer.position() + 12); // the normal, which we recompute from nothing
            double[] a = point(buffer);
            double[] b = point(buffer);
            double[] c = point(buffer);
            buffer.getShort(); // attribute bytes: a colour in some dialects, unreliable in all
            triangles.add(new Mesh.Triangle(a, b, c, -1));
        }
        if (triangles.isEmpty()) throw new IOException("no triangles in that .stl");
        return Mesh.of(triangles);
    }

    private static double[] point(ByteBuffer buffer) {
        return new double[]{buffer.getFloat(), buffer.getFloat(), buffer.getFloat()};
    }

    private static Mesh ascii(byte[] file) throws IOException {
        List<Mesh.Triangle> triangles = new ArrayList<>();
        List<double[]> corners = new ArrayList<>();
        for (String raw : new String(file, StandardCharsets.UTF_8).split("\\R")) {
            String[] parts = raw.trim().split("\\s+");
            if (parts.length >= 4 && parts[0].equals("vertex")) {
                corners.add(new double[]{number(parts[1]), number(parts[2]), number(parts[3])});
            } else if (parts[0].equals("endloop")) {
                for (int i = 1; i + 1 < corners.size(); i++) {
                    triangles.add(new Mesh.Triangle(corners.get(0), corners.get(i),
                            corners.get(i + 1), -1));
                }
                corners.clear();
                if (triangles.size() > MAX_TRIANGLES) {
                    throw new IOException("that model is too detailed to turn into blocks");
                }
            }
        }
        if (triangles.isEmpty()) throw new IOException("no triangles in that .stl");
        return Mesh.of(triangles);
    }

    private static double number(String text) {
        try {
            return Double.parseDouble(text);
        } catch (NumberFormatException error) {
            return 0;
        }
    }
}
