package dev.understudy.core.sort;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Works out what goes where.
 *
 * Pure: chests and an inventory in, a list of moves out. Nothing here opens a
 * container or touches the world, which means the awkward parts — a chest that
 * fills up halfway through, a category with nowhere to go, keeping the pickaxe
 * you are holding — are all testable without a game.
 *
 * Assignment is sticky rather than recomputed from scratch. A chest that
 * already holds mostly ore keeps being the ore chest, so sorting twice does not
 * shuffle everything to a different wall.
 */
public final class Sorter {

    /** A chest as the sorter needs to see it. */
    public record ChestView(int id, Map<String, Integer> contents, int freeSlots) {}

    public record Move(String item, int count, int chestId, Category category) {}

    public record Plan(List<Move> moves, List<String> unplaced, Map<Integer, Category> assignment) {
        public boolean isEmpty() {
            return moves.isEmpty();
        }

        public int itemsMoved() {
            return moves.stream().mapToInt(Move::count).sum();
        }
    }

    /**
     * Items to hold on to.
     *
     * Sorting that deposits your pickaxe and your food leaves you standing in a
     * tidy base unable to do anything, which is a real way to get this wrong.
     */
    public static boolean keep(String item, Category category) {
        return switch (category) {
            case TOOLS, WEAPONS, ARMOUR -> true;
            case FOOD -> true;
            default -> item.equals("torch") || item.equals("crafting_table");
        };
    }

    /**
     * Decide which chest each category belongs in.
     *
     * Each chest gets at most one category, and a category goes to whichever
     * free chest already holds most of it — which is what makes the layout
     * stable across repeated sorts.
     */
    public static Map<Integer, Category> assign(List<ChestView> chests, List<Category> needed) {
        Map<Integer, Category> assignment = new LinkedHashMap<>();
        Map<Category, Integer> chosen = new EnumMap<>(Category.class);

        // Strongest existing affinity first, so a chest that is clearly already
        // the ore chest claims ORES before a nearly-empty chest can.
        List<Category> order = new ArrayList<>(needed);
        order.sort((a, b) -> Double.compare(bestAffinity(chests, b), bestAffinity(chests, a)));

        for (Category category : order) {
            ChestView best = null;
            double bestScore = -1;
            for (ChestView chest : chests) {
                if (assignment.containsKey(chest.id())) continue;
                double score = affinity(chest, category);
                // A chest with no room is no use however well it matches.
                if (chest.freeSlots() <= 0 && score <= 0) continue;
                if (score > bestScore) {
                    bestScore = score;
                    best = chest;
                }
            }
            if (best == null) continue;
            assignment.put(best.id(), category);
            chosen.put(category, best.id());
        }
        return assignment;
    }

    private static double bestAffinity(List<ChestView> chests, Category category) {
        double best = 0;
        for (ChestView chest : chests) best = Math.max(best, affinity(chest, category));
        return best;
    }

    /** How much of this chest is already this category, 0 to 1. */
    private static double affinity(ChestView chest, Category category) {
        int total = 0;
        int matching = 0;
        for (Map.Entry<String, Integer> entry : chest.contents().entrySet()) {
            total += entry.getValue();
            if (Category.of(entry.getKey()) == category) matching += entry.getValue();
        }
        return total == 0 ? 0 : (double) matching / total;
    }

    /**
     * Plan a sort of `inventory` into `chests`.
     *
     * `keepKit` decides whether to hold back tools, weapons, armour and food.
     * Turning it off is for emptying out entirely; leaving it on is for the
     * ordinary "put this haul away" case.
     */
    public static Plan plan(Map<String, Integer> inventory, List<ChestView> chests, boolean keepKit) {
        List<Category> needed = new ArrayList<>();
        for (Map.Entry<String, Integer> entry : inventory.entrySet()) {
            if (entry.getValue() <= 0) continue;
            Category category = Category.of(entry.getKey());
            if (keepKit && keep(entry.getKey(), category)) continue;
            if (!needed.contains(category)) needed.add(category);
        }

        Map<Integer, Category> assignment = assign(chests, needed);
        Map<Category, Integer> chestFor = new EnumMap<>(Category.class);
        for (Map.Entry<Integer, Category> entry : assignment.entrySet()) {
            chestFor.put(entry.getValue(), entry.getKey());
        }

        // Track remaining space so a plan never asks a full chest for more.
        Map<Integer, Integer> space = new LinkedHashMap<>();
        for (ChestView chest : chests) space.put(chest.id(), chest.freeSlots());

        List<Move> moves = new ArrayList<>();
        List<String> unplaced = new ArrayList<>();

        for (Map.Entry<String, Integer> entry : inventory.entrySet()) {
            String item = entry.getKey();
            int count = entry.getValue();
            if (count <= 0) continue;
            Category category = Category.of(item);
            if (keepKit && keep(item, category)) continue;

            Integer chestId = chestFor.get(category);
            if (chestId == null || space.getOrDefault(chestId, 0) <= 0) {
                // No home for this category, or its chest is full. Say so
                // rather than dumping it somewhere arbitrary — a sort that
                // silently scatters things is worse than one that stops.
                unplaced.add(item);
                continue;
            }
            moves.add(new Move(item, count, chestId, category));
            space.merge(chestId, -1, Integer::sum);
        }

        return new Plan(moves, unplaced, assignment);
    }
}
