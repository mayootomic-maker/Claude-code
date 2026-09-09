package dev.understudy.core.build;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * The properties in a block state's brackets, and what happens to them when the
 * building is turned.
 *
 * A blueprint used to carry one horizontal facing and nothing else, and for a
 * builder that was the honest limit: a person places a block by clicking a face,
 * and there is no click that means "half=top" or "face=ceiling". Pasting has no
 * such limit — the server sets the state it is given — so throwing the rest away
 * was the difference between an imported building arriving as itself and
 * arriving with every button on the floor and every trapdoor upside down.
 *
 * Turning is where this earns its keep. A quarter turn does not just move the
 * blocks; it has to rewrite what they say about themselves, and three
 * properties disagree about how:
 *
 *  - **facing** goes round with the building, and only the four horizontal
 *    values move — a dropper pointing up still points up.
 *  - **axis** is not a direction but a line, so it swaps between x and z on
 *    an odd number of turns and is untouched on an even one. y never moves.
 *  - **rotation** is sixteenths, for signs and banners, so a quarter turn is
 *    four of them.
 *
 * Everything else is either relative to facing already — a stair's shape, a
 * button's face — or has nothing to do with which way round the building is.
 */
public final class States {
    private States() {}

    /** The four that turn. Up and down are here so they can be left alone. */
    private static final List<String> AROUND = List.of("north", "east", "south", "west");

    /**
     * The same properties, for a building turned this many quarters clockwise.
     *
     * Null in, null out: most blocks have nothing to say and should not be given
     * an empty pair of brackets to say it in.
     */
    public static String turned(String properties, int quarterTurns) {
        int turns = Math.floorMod(quarterTurns, 4);
        if (properties == null || properties.isEmpty() || turns == 0) return properties;

        List<String> out = new ArrayList<>();
        for (String pair : properties.split(",")) {
            int equals = pair.indexOf('=');
            if (equals < 0) {
                out.add(pair);
                continue;
            }
            String key = pair.substring(0, equals).trim();
            String value = pair.substring(equals + 1).trim();
            out.add(key + "=" + switch (key) {
                case "facing" -> around(value, turns);
                case "axis" -> turns % 2 == 1 ? swapAxis(value) : value;
                case "rotation" -> sixteenths(value, turns);
                default -> value;
            });
        }
        return String.join(",", out);
    }

    /**
     * The same properties, for a building stood on its head.
     *
     * Only ever asked of an imported model, where which way is up was a guess in
     * the first place — see Blueprint.turned. A slab, a stair and a trapdoor all
     * say which half of the cell they occupy and all three use a different word
     * for it.
     */
    public static String flipped(String properties) {
        if (properties == null || properties.isEmpty()) return properties;
        List<String> out = new ArrayList<>();
        for (String pair : properties.split(",")) {
            int equals = pair.indexOf('=');
            if (equals < 0) {
                out.add(pair);
                continue;
            }
            String key = pair.substring(0, equals).trim();
            String value = pair.substring(equals + 1).trim();
            out.add(key + "=" + switch (key) {
                // Stairs and trapdoors say half; slabs say type; a button says
                // which face it is stuck to.
                case "half", "type" -> flipHalf(value);
                case "face" -> switch (value) {
                    case "floor" -> "ceiling";
                    case "ceiling" -> "floor";
                    default -> value;
                };
                case "facing" -> switch (value) {
                    case "up" -> "down";
                    case "down" -> "up";
                    default -> value;
                };
                default -> value;
            });
        }
        return String.join(",", out);
    }

    /** One property's value, or null if it is not in there. */
    public static String value(String properties, String key) {
        if (properties == null) return null;
        for (String pair : properties.split(",")) {
            int equals = pair.indexOf('=');
            if (equals > 0 && pair.substring(0, equals).trim().equals(key)) {
                return pair.substring(equals + 1).trim();
            }
        }
        return null;
    }

    /** The properties with one added or replaced. */
    public static String with(String properties, String key, String value) {
        String pair = key + "=" + value;
        if (properties == null || properties.isEmpty()) return pair;
        if (States.value(properties, key) == null) return properties + "," + pair;

        List<String> out = new ArrayList<>();
        for (String existing : properties.split(",")) {
            int equals = existing.indexOf('=');
            out.add(equals > 0 && existing.substring(0, equals).trim().equals(key)
                    ? pair : existing);
        }
        return String.join(",", out);
    }

    private static String around(String value, int turns) {
        int at = AROUND.indexOf(value.toLowerCase(Locale.ROOT));
        // Up, down, and anything that is not a direction at all.
        return at < 0 ? value : AROUND.get((at + turns) % 4);
    }

    private static String swapAxis(String value) {
        return switch (value) {
            case "x" -> "z";
            case "z" -> "x";
            default -> value;
        };
    }

    private static String sixteenths(String value, int turns) {
        try {
            return String.valueOf(Math.floorMod(Integer.parseInt(value) + turns * 4, 16));
        } catch (NumberFormatException notANumber) {
            return value;
        }
    }

    private static String flipHalf(String value) {
        return switch (value) {
            case "top" -> "bottom";
            case "bottom" -> "top";
            default -> value; // a double slab is both and stays both
        };
    }
}
