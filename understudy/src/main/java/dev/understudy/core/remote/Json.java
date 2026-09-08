package dev.understudy.core.remote;

import java.util.List;
import java.util.Map;

/**
 * Writing JSON, and only writing it.
 *
 * The panel needs the state of the game as text and nothing needs to read JSON
 * back, so this is the easy half of the problem and no reason to take on a
 * dependency. What has to be right is escaping — a chat line with a quote in it
 * would otherwise produce a document that stops parsing halfway, and the panel
 * would go blank with no explanation.
 */
public final class Json {

    private final StringBuilder out = new StringBuilder(1024);
    private boolean first = true;

    public Json() {
        out.append('{');
    }

    public Json put(String key, String value) {
        comma();
        quote(key);
        out.append(':');
        if (value == null) out.append("null");
        else quote(value);
        return this;
    }

    public Json put(String key, double value) {
        comma();
        quote(key);
        out.append(':');
        // Not-a-number and infinity are not JSON, and a health bar reading NaN
        // is a panel that stops updating rather than one that looks odd.
        out.append(Double.isFinite(value) ? trim(value) : "0");
        return this;
    }

    public Json put(String key, boolean value) {
        comma();
        quote(key);
        out.append(':').append(value);
        return this;
    }

    /** A nested object or array that has already been built. */
    public Json raw(String key, String alreadyJson) {
        comma();
        quote(key);
        out.append(':').append(alreadyJson == null || alreadyJson.isBlank()
                ? "null" : alreadyJson);
        return this;
    }

    public Json strings(String key, List<String> values) {
        comma();
        quote(key);
        out.append(":[");
        for (int at = 0; at < values.size(); at++) {
            if (at > 0) out.append(',');
            quote(values.get(at));
        }
        out.append(']');
        return this;
    }

    /** A map of name to count, which is most of what this mod has to say. */
    public Json counts(String key, Map<String, Integer> values) {
        comma();
        quote(key);
        out.append(":{");
        boolean started = false;
        for (Map.Entry<String, Integer> entry : values.entrySet()) {
            if (started) out.append(',');
            started = true;
            quote(entry.getKey());
            out.append(':').append(entry.getValue());
        }
        out.append('}');
        return this;
    }

    public String done() {
        return out.append('}').toString();
    }

    /** A list of already-built objects. */
    public static String array(List<String> objects) {
        StringBuilder out = new StringBuilder("[");
        for (int at = 0; at < objects.size(); at++) {
            if (at > 0) out.append(',');
            out.append(objects.get(at));
        }
        return out.append(']').toString();
    }

    private void comma() {
        if (!first) out.append(',');
        first = false;
    }

    /**
     * A JSON string, escaped.
     *
     * The control characters are the ones people forget. A newline inside a
     * value is not a newline in JSON, and one arriving from a line the mod
     * wrote would break the whole document.
     */
    private void quote(String value) {
        out.append('"');
        for (int at = 0; at < value.length(); at++) {
            char letter = value.charAt(at);
            switch (letter) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> {
                    if (letter < 0x20) {
                        out.append(String.format(java.util.Locale.ROOT, "\\u%04x", (int) letter));
                    }
                    else out.append(letter);
                }
            }
        }
        out.append('"');
    }

    /** Whole numbers without a trailing .0, which is most of them. */
    private static String trim(double value) {
        if (value == Math.rint(value) && Math.abs(value) < 1e15) {
            return String.valueOf((long) value);
        }
        return String.format(java.util.Locale.ROOT, "%.2f", value);
    }
}
