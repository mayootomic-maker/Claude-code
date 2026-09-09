package dev.understudy.core.remote;

import java.util.List;
import java.util.Map;

/**
 * What the panel is allowed to ask for.
 *
 * This is the whole security boundary of the remote control, and it is a
 * whitelist by construction rather than by inspection: a request names one of a
 * dozen verbs and its arguments are validated into a typed record, so there is
 * no path from the network to "run this text". Nothing here can type in chat,
 * run a server command, read a file, or reach anything the mod does not already
 * do from its own menu.
 *
 * Everything a panel can do, a person with the game open can already do. That
 * is the line, and it is deliberately the whole of it.
 */
public final class Command {

    /** Every verb there is. */
    public enum Verb {
        STOP, PAUSE, RESUME,
        GET, PROJECT, BUILD, SORT, TRAVEL, ENCHANT,
        AUTO, AUTO_OFF,
        SPEED, HUD
    }

    /**
     * A validated request.
     *
     * @param what  the verb
     * @param name  an item, project, design or speed — already checked against
     *              the shape of a real name, never passed through raw
     * @param count how many, or a size
     * @param x     coordinates, meaningful only for TRAVEL
     */
    public record Action(Verb what, String name, int count, int x, int y, int z) {
        public static Action of(Verb what) {
            return new Action(what, "", 0, 0, 0, 0);
        }
    }

    /** What a Minecraft identifier looks like, and nothing else gets through. */
    private static final int LONGEST_NAME = 64;
    /** The world is thirty million blocks across; nothing sensible is outside it. */
    private static final int EDGE = 30_000_000;
    private static final int DEEPEST = -512;
    private static final int HIGHEST = 1024;
    /** More than anyone wants of anything, and small enough not to hang the game. */
    private static final int MOST = 4096;

    private Command() {}

    /**
     * Turn a request into an action, or explain why not.
     *
     * @return the action, or null when the request is not one this understands —
     *         which the caller answers with a refusal rather than a guess
     */
    public static Action parse(Map<String, String> query) {
        Verb verb = verbOf(query.get("a"));
        if (verb == null) return null;

        return switch (verb) {
            case STOP, PAUSE, RESUME, SORT, AUTO_OFF -> Action.of(verb);
            case GET -> named(verb, query, Query.number(query, "n", 1, 1, MOST));
            case AUTO -> named(verb, query, Query.number(query, "n", 1, 1, MOST));
            case ENCHANT -> {
                String name = clean(query.get("name"));
                yield new Action(verb, name == null ? "" : name, 0, 0, 0, 0);
            }
            case PROJECT, SPEED -> named(verb, query, 0);
            case BUILD -> named(verb, query, Query.number(query, "n", 0, 0, 64));
            case HUD -> Action.of(verb);
            case TRAVEL -> new Action(verb, "", 0,
                    Query.number(query, "x", 0, -EDGE, EDGE),
                    Query.number(query, "y", 64, DEEPEST, HIGHEST),
                    Query.number(query, "z", 0, -EDGE, EDGE));
        };
    }

    private static Action named(Verb verb, Map<String, String> query, int count) {
        String name = clean(query.get("name"));
        return name == null ? null : new Action(verb, name, count, 0, 0, 0);
    }

    /**
     * A name, or nothing.
     *
     * Lowercase letters, digits and underscores, which is exactly what a
     * Minecraft identifier is. A namespace prefix is allowed and stripped,
     * because people paste "minecraft:iron_ore" and meaning it is obvious.
     */
    public static String clean(String raw) {
        if (raw == null) return null;
        String name = raw.trim().toLowerCase(java.util.Locale.ROOT);
        int colon = name.indexOf(':');
        if (colon >= 0) name = name.substring(colon + 1);
        if (name.isEmpty() || name.length() > LONGEST_NAME) return null;
        for (int at = 0; at < name.length(); at++) {
            char letter = name.charAt(at);
            boolean allowed = (letter >= 'a' && letter <= 'z')
                    || (letter >= '0' && letter <= '9') || letter == '_' || letter == '+';
            if (!allowed) return null;
        }
        return name;
    }

    private static Verb verbOf(String raw) {
        if (raw == null) return null;
        for (Verb verb : Verb.values()) {
            if (verb.name().equalsIgnoreCase(raw.replace('-', '_'))) return verb;
        }
        return null;
    }

    /** Every verb, for the panel to discover what it may ask for. */
    public static List<String> verbs() {
        return java.util.Arrays.stream(Verb.values())
                .map(verb -> verb.name().toLowerCase(java.util.Locale.ROOT)).toList();
    }
}
