package dev.understudy.core.craft;

import java.util.Map;

/**
 * One way to turn things you have into a thing you want.
 *
 * A recipe is a hyperedge, not an edge: it has several inputs and all of them
 * are required. That is the whole reason the planner cannot be ordinary
 * Dijkstra, and the reason a naive "cheapest ingredient" search gets iron wrong.
 */
public record Recipe(String output, int count, Map<String, Integer> inputs,
                     Station station, double seconds) {

    public enum Station {
        /** In the four slots of your inventory. */
        HAND,
        CRAFTING_TABLE,
        FURNACE
    }

    public static Recipe hand(String output, int count, double seconds, Object... pairs) {
        return new Recipe(output, count, pairsToMap(pairs), Station.HAND, seconds);
    }

    public static Recipe table(String output, int count, double seconds, Object... pairs) {
        return new Recipe(output, count, pairsToMap(pairs), Station.CRAFTING_TABLE, seconds);
    }

    public static Recipe smelt(String output, String input, double seconds) {
        return new Recipe(output, 1, Map.of(input, 1), Station.FURNACE, seconds);
    }

    private static Map<String, Integer> pairsToMap(Object... pairs) {
        if (pairs.length % 2 != 0) throw new IllegalArgumentException("inputs must be name, count pairs");
        Map<String, Integer> map = new java.util.LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            map.merge((String) pairs[i], (Integer) pairs[i + 1], Integer::sum);
        }
        return Map.copyOf(map);
    }
}
