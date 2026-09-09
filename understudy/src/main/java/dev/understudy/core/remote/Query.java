package dev.understudy.core.remote;

import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Reading the arguments off a request.
 *
 * A query string rather than JSON, and that is a decision rather than
 * laziness: the panel only ever sends a handful of named values, and a JSON
 * parser written by hand is a hundred lines of somebody else's escaping bugs
 * guarding the one door into a running game. Percent-decoding is twenty lines
 * and all of it is here, where it is tested.
 */
public final class Query {
    private Query() {}

    /** Longer than any real argument, and short enough that nothing can flood it. */
    private static final int LONGEST = 256;

    /**
     * Parse `a=get&item=iron_ore&n=8` into a map.
     *
     * Forgiving in the ways that do not matter and strict in the ones that do:
     * a repeated key keeps the first, an empty pair is skipped, and anything
     * absurdly long is cut rather than kept, because the only thing on the
     * other end of this is a text field in a web page.
     */
    public static Map<String, String> parse(String raw) {
        Map<String, String> out = new LinkedHashMap<>();
        if (raw == null || raw.isBlank()) return out;
        for (String pair : raw.split("&")) {
            if (pair.isBlank()) continue;
            int equals = pair.indexOf('=');
            String key = equals < 0 ? pair : pair.substring(0, equals);
            String value = equals < 0 ? "" : pair.substring(equals + 1);
            key = decode(key);
            if (key.isEmpty() || out.containsKey(key)) continue;
            out.put(key, decode(value));
        }
        return out;
    }

    /**
     * Percent-decoding, plus the plus-for-space that forms use.
     *
     * Written out rather than handed to URLDecoder because URLDecoder throws on
     * a malformed escape, and a malformed escape arriving at a game client
     * should be a shrug rather than an exception on a socket thread.
     */
    public static String decode(String value) {
        if (value == null) return "";
        StringBuilder out = new StringBuilder(Math.min(value.length(), LONGEST));
        byte[] bytes = new byte[value.length()];
        int used = 0;
        for (int at = 0; at < value.length() && used < LONGEST; at++) {
            char letter = value.charAt(at);
            if (letter == '+') {
                bytes[used++] = ' ';
            } else if (letter == '%' && at + 2 < value.length()) {
                int high = Character.digit(value.charAt(at + 1), 16);
                int low = Character.digit(value.charAt(at + 2), 16);
                if (high < 0 || low < 0) {
                    bytes[used++] = (byte) letter; // not an escape; take it as written
                } else {
                    bytes[used++] = (byte) ((high << 4) + low);
                    at += 2;
                }
            } else {
                // Anything above ASCII arrives already percent-encoded from a
                // browser; a raw one is taken at face value rather than mangled.
                for (byte piece : String.valueOf(letter).getBytes(StandardCharsets.UTF_8)) {
                    if (used < LONGEST) bytes[used++] = piece;
                }
            }
        }
        out.append(new String(bytes, 0, used, StandardCharsets.UTF_8));
        return out.toString();
    }

    /** A number, or the fallback when it is missing or nonsense. */
    public static int number(Map<String, String> query, String key, int fallback,
                            int least, int most) {
        try {
            return Math.max(least, Math.min(most, Integer.parseInt(query.getOrDefault(key, ""))));
        } catch (NumberFormatException notANumber) {
            return fallback;
        }
    }
}
