package dev.understudy.core.nbt;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.GZIPOutputStream;

/**
 * Writes NBT, so the reader can be tested against real bytes rather than
 * against a mock of itself.
 *
 * Test-only and deliberately so: nothing in the mod writes NBT, and a writer in
 * the main source would be dead code. Here it is the only way to prove the
 * reader handles the formats it claims to.
 */
public final class NbtWriter {

    public sealed interface Value {
        record I(int value) implements Value {}
        record S(short value) implements Value {}
        record B(byte value) implements Value {}
        record Str(String value) implements Value {}
        record Bytes(byte[] value) implements Value {}
        record Longs(long[] value) implements Value {}
        record ListOf(int type, List<Value> items) implements Value {}
        record Comp(Map<String, Value> fields) implements Value {}
    }

    private NbtWriter() {}

    public static Value.Comp compound(Object... pairs) {
        Map<String, Value> map = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) map.put((String) pairs[i], (Value) pairs[i + 1]);
        return new Value.Comp(map);
    }

    public static byte[] gzip(Value.Comp root) throws IOException {
        ByteArrayOutputStream raw = new ByteArrayOutputStream();
        try (DataOutputStream out = new DataOutputStream(new GZIPOutputStream(raw))) {
            out.writeByte(10);
            out.writeUTF("");
            writeBody(out, root);
        }
        return raw.toByteArray();
    }

    public static byte[] plain(Value.Comp root) throws IOException {
        ByteArrayOutputStream raw = new ByteArrayOutputStream();
        try (DataOutputStream out = new DataOutputStream(raw)) {
            out.writeByte(10);
            out.writeUTF("");
            writeBody(out, root);
        }
        return raw.toByteArray();
    }

    private static int typeOf(Value value) {
        return switch (value) {
            case Value.B ignored -> 1;
            case Value.S ignored -> 2;
            case Value.I ignored -> 3;
            case Value.Bytes ignored -> 7;
            case Value.Str ignored -> 8;
            case Value.ListOf ignored -> 9;
            case Value.Comp ignored -> 10;
            case Value.Longs ignored -> 12;
        };
    }

    private static void writeBody(DataOutputStream out, Value value) throws IOException {
        switch (value) {
            case Value.B v -> out.writeByte(v.value());
            case Value.S v -> out.writeShort(v.value());
            case Value.I v -> out.writeInt(v.value());
            case Value.Str v -> out.writeUTF(v.value());
            case Value.Bytes v -> {
                out.writeInt(v.value().length);
                out.write(v.value());
            }
            case Value.Longs v -> {
                out.writeInt(v.value().length);
                for (long each : v.value()) out.writeLong(each);
            }
            case Value.ListOf v -> {
                out.writeByte(v.items().isEmpty() ? 0 : v.type());
                out.writeInt(v.items().size());
                for (Value item : v.items()) writeBody(out, item);
            }
            case Value.Comp v -> {
                for (Map.Entry<String, Value> field : v.fields().entrySet()) {
                    out.writeByte(typeOf(field.getValue()));
                    out.writeUTF(field.getKey());
                    writeBody(out, field.getValue());
                }
                out.writeByte(0);
            }
        }
    }
}
