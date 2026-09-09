package dev.understudy.core.nbt;

import java.io.ByteArrayInputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.GZIPInputStream;

/**
 * Just enough NBT to read a schematic.
 *
 * Minecraft has its own NBT reader, and this deliberately does not use it. The
 * whole reason the rest of this mod survived the game renaming every class it
 * touches is that the parts that can be written without Minecraft are: they sit
 * in core, they are tested against bytes rather than against a running game, and
 * a version bump cannot reach them. A file format that has not changed since
 * 2011 is exactly the wrong thing to couple to a class that gets renamed every
 * year.
 *
 * Reading only. Nothing here writes NBT, because nothing needs to.
 */
public final class Nbt {

    public sealed interface Tag {
        record Num(double value) implements Tag {}
        record Bytes(byte[] value) implements Tag {}
        record Str(String value) implements Tag {}
        record Items(List<Tag> value) implements Tag {}
        record Compound(Map<String, Tag> value) implements Tag {}
        record Ints(int[] value) implements Tag {}
        record Longs(long[] value) implements Tag {}
    }

    private static final int END = 0, BYTE = 1, SHORT = 2, INT = 3, LONG = 4, FLOAT = 5,
            DOUBLE = 6, BYTE_ARRAY = 7, STRING = 8, LIST = 9, COMPOUND = 10,
            INT_ARRAY = 11, LONG_ARRAY = 12;

    /** Guards against a corrupt length field asking for a gigabyte array. */
    private static final int MAX_ELEMENTS = 64 << 20;

    private Nbt() {}

    /**
     * Read a file, gzipped or not.
     *
     * Every schematic format in circulation is gzipped, but plain ones exist and
     * sniffing the two magic bytes is cheaper than being wrong about it.
     */
    public static Tag.Compound read(byte[] file) throws IOException {
        InputStream raw = new ByteArrayInputStream(file);
        InputStream stream = file.length > 1 && (file[0] & 0xFF) == 0x1F && (file[1] & 0xFF) == 0x8B
                ? new GZIPInputStream(raw)
                : raw;
        try (DataInputStream in = new DataInputStream(stream)) {
            int type = in.readUnsignedByte();
            if (type != COMPOUND) {
                throw new IOException("not an NBT file: root tag is type " + type);
            }
            in.readUTF(); // the root's name, which nothing uses
            Tag tag = readPayload(in, COMPOUND);
            return (Tag.Compound) tag;
        }
    }

    private static Tag readPayload(DataInputStream in, int type) throws IOException {
        return switch (type) {
            case BYTE -> new Tag.Num(in.readByte());
            case SHORT -> new Tag.Num(in.readShort());
            case INT -> new Tag.Num(in.readInt());
            case LONG -> new Tag.Num(in.readLong());
            case FLOAT -> new Tag.Num(in.readFloat());
            case DOUBLE -> new Tag.Num(in.readDouble());
            case BYTE_ARRAY -> new Tag.Bytes(in.readNBytes(count(in.readInt())));
            case STRING -> new Tag.Str(in.readUTF());
            case LIST -> readList(in);
            case COMPOUND -> readCompound(in);
            case INT_ARRAY -> {
                int[] values = new int[count(in.readInt())];
                for (int i = 0; i < values.length; i++) values[i] = in.readInt();
                yield new Tag.Ints(values);
            }
            case LONG_ARRAY -> {
                long[] values = new long[count(in.readInt())];
                for (int i = 0; i < values.length; i++) values[i] = in.readLong();
                yield new Tag.Longs(values);
            }
            default -> throw new IOException("unknown NBT tag type " + type);
        };
    }

    private static Tag readList(DataInputStream in) throws IOException {
        int type = in.readUnsignedByte();
        int length = count(in.readInt());
        List<Tag> items = new ArrayList<>(Math.min(length, 1024));
        // An empty list is written with element type END, which is not an error.
        for (int i = 0; i < length && type != END; i++) items.add(readPayload(in, type));
        return new Tag.Items(items);
    }

    private static Tag readCompound(DataInputStream in) throws IOException {
        Map<String, Tag> map = new LinkedHashMap<>();
        while (true) {
            int type = in.readUnsignedByte();
            if (type == END) return new Tag.Compound(map);
            String name = in.readUTF();
            map.put(name, readPayload(in, type));
        }
    }

    private static int count(int declared) throws IOException {
        if (declared < 0 || declared > MAX_ELEMENTS) {
            throw new IOException("refusing a declared length of " + declared);
        }
        return declared;
    }

    // Readers. Every one returns a default rather than throwing, because a
    // schematic missing a field should be reported as "this file is not a
    // schematic" once, not as a null pointer somewhere inside a menu.

    public static Tag.Compound compound(Tag.Compound parent, String name) {
        return parent != null && parent.value().get(name) instanceof Tag.Compound found ? found : null;
    }

    public static List<Tag> list(Tag.Compound parent, String name) {
        return parent != null && parent.value().get(name) instanceof Tag.Items found
                ? found.value() : List.of();
    }

    public static String string(Tag.Compound parent, String name, String fallback) {
        return parent != null && parent.value().get(name) instanceof Tag.Str found
                ? found.value() : fallback;
    }

    public static int integer(Tag.Compound parent, String name, int fallback) {
        return parent != null && parent.value().get(name) instanceof Tag.Num found
                ? (int) found.value() : fallback;
    }

    public static byte[] bytes(Tag.Compound parent, String name) {
        return parent != null && parent.value().get(name) instanceof Tag.Bytes found
                ? found.value() : new byte[0];
    }

    public static int[] ints(Tag.Compound parent, String name) {
        return parent != null && parent.value().get(name) instanceof Tag.Ints found
                ? found.value() : new int[0];
    }

    public static long[] longs(Tag.Compound parent, String name) {
        return parent != null && parent.value().get(name) instanceof Tag.Longs found
                ? found.value() : new long[0];
    }

    public static boolean has(Tag.Compound parent, String name) {
        return parent != null && parent.value().containsKey(name);
    }
}
