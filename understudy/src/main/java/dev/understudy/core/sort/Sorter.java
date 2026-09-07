package dev.understudy.core.sort;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

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

    public record Plan(List<Move> moves, List<String> unplaced,
                       Map<Integer, List<Category>> assignment) {
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
     * But keeping *every* tool is the other way to get it wrong: four stone
     * pickaxes come back from a mining trip and all four stay in your pockets,
     * which is the thing you wanted sorting for.
     */
    public static boolean keep(String item, Category category) {
        return switch (category) {
            case TOOLS, WEAPONS, ARMOUR -> true;
            case FOOD -> true;
            default -> item.equals("torch") || item.equals("crafting_table");
        };
    }

    /** Tool and armour materials, worst first, so "best" is a list position. */
    private static final List<String> MATERIALS =
            List.of("wooden", "golden", "stone", "chainmail", "iron", "diamond", "netherite");

    /** The kinds of thing you only want one of. */
    private static final List<String> ONE_EACH = List.of(
            "_pickaxe", "_axe", "_shovel", "_hoe", "_sword",
            "_helmet", "_chestplate", "_leggings", "_boots");

    /**
     * Exactly which items to hold back, given what is actually carried.
     *
     * The difference from `keep` is that this can see the whole inventory, so
     * it can keep the diamond pickaxe and put the three stone ones away.
     * Anything whose kind is not one you would carry a spare of — food, a
     * torch, the crafting table — is kept as before.
     */
    public static Set<String> keepBack(Map<String, Integer> inventory) {
        Set<String> keeping = new LinkedHashSet<>();
        Map<String, String> bestOfKind = new LinkedHashMap<>();

        for (String item : inventory.keySet()) {
            if (inventory.getOrDefault(item, 0) <= 0) continue;
            Category category = Category.of(item);
            String kind = kindOf(item);
            if (kind != null) {
                String current = bestOfKind.get(kind);
                if (current == null || rank(item) > rank(current)) bestOfKind.put(kind, item);
                continue;
            }
            if (category == Category.FOOD
                    || item.equals("torch") || item.equals("crafting_table")) {
                keeping.add(item);
            }
            // Tools that are not one of a kind — shears, a bucket, a compass —
            // are single things you carry, and there is only ever one worth
            // having, so they stay.
            if (category == Category.TOOLS || category == Category.WEAPONS
                    || category == Category.ARMOUR) {
                keeping.add(item);
            }
        }
        keeping.addAll(bestOfKind.values());
        return keeping;
    }

    private static String kindOf(String item) {
        for (String kind : ONE_EACH) {
            if (item.endsWith(kind)) return kind;
        }
        return null;
    }

    private static int rank(String item) {
        for (int i = MATERIALS.size() - 1; i >= 0; i--) {
            if (item.startsWith(MATERIALS.get(i) + "_")) return i;
        }
        return MATERIALS.size(); // netherite-and-above, or something unnamed
    }

    /**
     * Decide which categories belong in which chest.
     *
     * A chest can hold more than one. The old rule was one category each, which
     * is tidy right up until you have three chests and eight kinds of thing —
     * and then five of them have nowhere to go and the sort quietly does
     * nothing with most of your inventory.
     *
     * The grouping is decided before the chests are, which is the part that was
     * wrong at first: assigning categories to chests one at a time and then
     * finding homes for the leftovers puts the ore with the planks and the
     * diamonds on their own, because by the time the leftovers are considered
     * every chest is already spoken for. Deciding what shares with what first,
     * and only then which box each group lives in, keeps the ore with the
     * valuables and the bread with the potions.
     */
    public static Map<Integer, List<Category>> assign(List<ChestView> chests,
                                                      List<Category> needed) {
        Map<Integer, List<Category>> assignment = new LinkedHashMap<>();
        if (chests.isEmpty() || needed.isEmpty()) return assignment;

        List<List<Category>> groups = groupsFor(needed, chests.size());

        // Each group takes the chest it already has most in common with, the
        // strongest claim first. That is what keeps a base laid out the same
        // way after the second and third sort.
        groups.sort((a, b) -> Double.compare(bestAffinity(chests, b), bestAffinity(chests, a)));
        for (List<Category> group : groups) {
            ChestView best = null;
            double bestScore = -1;
            for (ChestView chest : chests) {
                if (assignment.containsKey(chest.id())) continue;
                double score = affinity(chest, group);
                if (score > bestScore) {
                    bestScore = score;
                    best = chest;
                }
            }
            if (best != null) assignment.put(best.id(), new ArrayList<>(group));
        }
        return assignment;
    }

    /**
     * Which categories sit happily together when there are not enough chests.
     *
     * Not arbitrary: these are the groupings a person makes. Tools with weapons
     * and armour is your kit; ore with valuables is what you came back with.
     */
    private static final List<List<Category>> KIN = List.of(
            List.of(Category.TOOLS, Category.WEAPONS, Category.ARMOUR),
            List.of(Category.ORES, Category.VALUABLES),
            List.of(Category.BUILDING, Category.PLANTS),
            List.of(Category.FOOD, Category.BREWING),
            List.of(Category.REDSTONE, Category.MISC));

    /**
     * Split what needs storing into at most `chestCount` groups.
     *
     * Families first. Too many for the chests available and the smallest
     * families merge — a chest holding both the food and the potions is a
     * compromise anyone would make. Too few and the families split back into
     * single categories, because a chest each is better when you have the room.
     */
    private static List<List<Category>> groupsFor(List<Category> needed, int chestCount) {
        List<List<Category>> groups = new ArrayList<>();
        for (List<Category> family : KIN) {
            List<Category> present = new ArrayList<>(family);
            present.retainAll(needed);
            if (!present.isEmpty()) groups.add(present);
        }
        for (Category category : needed) {
            if (groups.stream().noneMatch(group -> group.contains(category))) {
                groups.add(new ArrayList<>(List.of(category)));
            }
        }

        // Room to spare: break the families up, biggest first, until every
        // category has its own chest or the chests run out.
        while (groups.size() < chestCount) {
            List<Category> biggest = null;
            for (List<Category> group : groups) {
                if (group.size() > 1 && (biggest == null || group.size() > biggest.size())) {
                    biggest = group;
                }
            }
            if (biggest == null) break;
            groups.add(new ArrayList<>(List.of(biggest.remove(biggest.size() - 1))));
        }

        // Not enough chests: merge the two smallest groups until they fit.
        while (groups.size() > chestCount) {
            groups.sort((a, b) -> Integer.compare(a.size(), b.size()));
            groups.get(0).addAll(groups.remove(1));
        }
        return groups;
    }

    /** How much of this chest is already one of these categories, 0 to 1. */
    private static double affinity(ChestView chest, List<Category> group) {
        double best = 0;
        for (Category category : group) best = Math.max(best, affinity(chest, category));
        return best;
    }

    private static double bestAffinity(List<ChestView> chests, List<Category> group) {
        double best = 0;
        for (ChestView chest : chests) best = Math.max(best, affinity(chest, group));
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
        Set<String> keeping = keepKit ? keepBack(inventory) : Set.of();

        List<Category> needed = new ArrayList<>();
        for (Map.Entry<String, Integer> entry : inventory.entrySet()) {
            if (entry.getValue() <= 0 || keeping.contains(entry.getKey())) continue;
            Category category = Category.of(entry.getKey());
            if (!needed.contains(category)) needed.add(category);
        }

        Map<Integer, List<Category>> assignment = assign(chests, needed);

        // Where each category may go, best home first. More than one, because a
        // chest fills up — and a sort that stops at the first full chest while
        // three others stand half empty is the thing people complain about.
        Map<Category, List<Integer>> homes = new EnumMap<>(Category.class);
        for (Map.Entry<Integer, List<Category>> entry : assignment.entrySet()) {
            for (Category category : entry.getValue()) {
                homes.computeIfAbsent(category, c -> new ArrayList<>()).add(entry.getKey());
            }
        }

        Map<Integer, Integer> space = new LinkedHashMap<>();
        for (ChestView chest : chests) space.put(chest.id(), chest.freeSlots());

        List<Move> moves = new ArrayList<>();
        List<String> unplaced = new ArrayList<>();

        for (Map.Entry<String, Integer> entry : inventory.entrySet()) {
            String item = entry.getKey();
            int count = entry.getValue();
            if (count <= 0 || keeping.contains(item)) continue;
            Category category = Category.of(item);

            Integer chestId = null;
            for (Integer candidate : homes.getOrDefault(category, List.of())) {
                if (space.getOrDefault(candidate, 0) > 0) {
                    chestId = candidate;
                    break;
                }
            }
            if (chestId == null) {
                // Its own chests are full. Anywhere with room beats leaving it
                // in your pockets, and the chest is recorded as holding this
                // category too so the rest of the stack follows it rather than
                // scattering one item per chest.
                chestId = spillTo(chests, space);
                if (chestId != null) {
                    homes.computeIfAbsent(category, c -> new ArrayList<>()).add(chestId);
                    assignment.computeIfAbsent(chestId, id -> new ArrayList<>()).add(category);
                }
            }
            if (chestId == null) {
                unplaced.add(item);
                continue;
            }
            moves.add(new Move(item, count, chestId, category));
            space.merge(chestId, -1, Integer::sum);
        }

        return new Plan(moves, unplaced, assignment);
    }

    private static Integer spillTo(List<ChestView> chests, Map<Integer, Integer> space) {
        Integer best = null;
        int most = 0;
        for (ChestView chest : chests) {
            int free = space.getOrDefault(chest.id(), 0);
            if (free > most) {
                most = free;
                best = chest.id();
            }
        }
        return best;
    }
}
