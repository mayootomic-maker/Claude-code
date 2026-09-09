package dev.understudy.core.gear;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.List;
import java.util.Map;

/**
 * What goes in a chest you leave behind.
 *
 * A death chest is not a storage chest and the difference is the whole design.
 * Storage is about everything you own; this is about the twenty minutes after
 * you respawn with nothing, in your underwear, a thousand blocks from your
 * things. So it holds one of each of the four tools, one set of armour, a
 * weapon, food, torches, and enough stone to wall yourself in — and nothing
 * else, because a chest with sixty items in it is a chest you have to read.
 *
 * The rule that makes it safe to use is `keepBack`. Stocking a spare set is
 * only sensible if it does not strip the set you are wearing: donating your
 * only pickaxe to a box and then walking into a cave is worse than not having
 * the box at all. Every line says how many of that thing must stay with you,
 * and only the surplus above that is ever given away. In creative there is no
 * surplus and no scarcity, so the whole list is simply granted.
 *
 * There is no Minecraft in here, which is what lets the tests check the
 * arithmetic — and the arithmetic is the part that can quietly rob you.
 */
public final class Kit {
    private Kit() {}

    /** The block the kit goes into. Named once so nothing has to spell it. */
    public static final String CONTAINER = "chest";

    /** A single chest is 27 slots; the list is kept comfortably inside that. */
    public static final int SLOTS = 27;

    /**
     * @param item     registry path, the same plain name the rest of the mod uses
     * @param want     how many to put in the chest
     * @param keepBack how many must stay in your own inventory, always
     */
    public record Line(String item, int want, int keepBack) {}

    /**
     * One line of the kit and the most of it that may leave your inventory.
     *
     * A ceiling rather than a promise, and the distinction is real. In creative
     * the stack is conjured to exactly this size, so it is also the amount. In
     * survival the mod moves whole stacks — there is no click that moves
     * twenty-four of a stack of forty, only sequences of clicks that take
     * seconds each — so it moves the stacks that fit under this and leaves the
     * rest alone. Under-filling the chest is a disappointment; going below
     * `keepBack` is how you die, so the ceiling is the side it errs on.
     */
    public record Give(String item, int count) {}

    /**
     * @param giving  what can be put in, in kit order
     * @param shortOf what cannot, because there is none spare
     */
    public record Stocked(List<Give> giving, List<String> shortOf) {
        public boolean isEmpty() {
            return giving.isEmpty();
        }

        public int items() {
            int total = 0;
            for (Give give : giving) total += give.count();
            return total;
        }
    }

    /** The kit you get when you type nothing else. */
    public static final String RECOVERY = "recovery";
    /** Rockets and a spare pair of wings, for getting somewhere rather than back. */
    public static final String FLIGHT = "flight";

    /** The named kits, for help text and for completing what is being typed. */
    public static List<String> presets() {
        return List.of(RECOVERY, FLIGHT);
    }

    /** A named kit, or null if that word is not one. */
    public static List<Line> preset(String name) {
        String clean = name == null ? "" : name.trim().toLowerCase(Locale.ROOT);
        return switch (clean) {
            case RECOVERY -> recovery();
            case FLIGHT -> flight();
            default -> null;
        };
    }

    /**
     * Rockets, wings, and the membrane to mend them with.
     *
     * A different problem from the recovery chest and worth its own list. This
     * one is not about a death, it is about the flight running out somewhere
     * inconvenient — so what it holds is the two things you cannot improvise
     * in the air, plus enough food to walk if it comes to that.
     */
    public static List<Line> flight() {
        return List.of(
                new Line("firework_rocket", 64, 32),
                new Line("elytra", 1, 1),
                new Line("phantom_membrane", 4, 0),
                new Line("cooked_beef", 16, 8));
    }

    /**
     * Anything you name, in whatever quantity you name.
     *
     * Several at once joined with a plus, the same way /get takes them, because
     * a chest holding one thing is rarely the chest anyone wanted. The count
     * applies to each named thing rather than being shared out between them —
     * "sixty-four of each" is what people mean by it, and splitting a number
     * across a list nobody counted is a silent surprise.
     *
     * Nothing is kept back from an order. The kits protect the set you are
     * wearing because you did not choose their contents; naming a thing and a
     * number is choosing, and second-guessing that would just mean the chest
     * quietly holds less than you asked for.
     */
    public static List<Line> order(String request, int count) {
        List<Line> out = new ArrayList<>();
        List<String> seen = new ArrayList<>();
        if (request == null) return List.of();
        for (String each : request.split("\\+")) {
            String item = clean(each);
            if (item.isEmpty() || seen.contains(item)) continue;
            seen.add(item);
            out.add(new Line(item, Math.max(1, count), 0));
        }
        return List.copyOf(out);
    }

    /**
     * One typed name, tidied.
     *
     * The namespace goes, spaces and dashes become underscores, and the locale
     * is pinned — `toLowerCase()` with a Turkish default turns IRON into ıron
     * and every lookup after it fails without saying why. That bug has been
     * found in this codebase three times now.
     *
     * The trim happens before the spaces are replaced and the edges are stripped
     * after, or "  iron ingot  " arrives as "__iron_ingot__" — whitespace turned
     * into underscores is no longer whitespace, and trim stops seeing it.
     */
    public static String clean(String name) {
        if (name == null) return "";
        String tidy = name.toLowerCase(Locale.ROOT)
                .replace("minecraft:", "")
                .trim()
                .replace(' ', '_')
                .replace('-', '_');
        int from = 0;
        int to = tidy.length();
        while (from < to && tidy.charAt(from) == '_') from++;
        while (to > from && tidy.charAt(to - 1) == '_') to--;
        return tidy.substring(from, to);
    }

    /**
     * Short names people actually type for things the registry calls something
     * else.
     *
     * Deliberately short. Guessing at names is how a lookup table becomes a
     * dictionary nobody maintains, and the plural rules below already cover
     * most of what a list like this would otherwise be full of — "arrows",
     * "torches", "ender_pearls" all reach the right item without an entry
     * here. What is left is the handful where the everyday word and the
     * registry name are simply different words.
     */
    private static final Map<String, String> ALSO_KNOWN_AS = Map.of(
            "rocket", "firework_rocket",
            "firework", "firework_rocket",
            "pearl", "ender_pearl",
            "wing", "elytra",
            "wings", "elytra",
            "steak", "cooked_beef",
            "gapple", "golden_apple",
            "xp_bottle", "experience_bottle");

    /**
     * What this typed word might be, best guess first.
     *
     * The caller walks these against the registry and takes the first that
     * exists, which keeps the only list of real item names in the one place
     * that has it. Plurals are here rather than there because "torches" is a
     * fact about English, not about Minecraft, and it is testable without a
     * game.
     */
    public static List<String> candidates(String typed) {
        String name = clean(typed);
        if (name.isEmpty()) return List.of();
        List<String> out = new ArrayList<>();
        add(out, name);
        add(out, ALSO_KNOWN_AS.get(name));
        if (name.endsWith("ies")) add(out, name.substring(0, name.length() - 3) + "y");
        if (name.endsWith("es")) add(out, name.substring(0, name.length() - 2));
        if (name.endsWith("s")) {
            String one = name.substring(0, name.length() - 1);
            add(out, one);
            add(out, ALSO_KNOWN_AS.get(one));
        }
        return List.copyOf(out);
    }

    private static void add(List<String> out, String name) {
        if (name != null && !name.isEmpty() && !out.contains(name)) out.add(name);
    }

    /**
     * The kit, in the order it matters after a death.
     *
     * Armour and a sword first because whatever killed you is still there;
     * then the tools, then the things that keep you alive while you walk back.
     * A partial stock is therefore still a useful one, which matters in
     * survival where it usually will be partial.
     */
    public static List<Line> recovery() {
        return List.of(
                new Line("iron_sword", 1, 1),
                new Line("shield", 1, 1),
                new Line("iron_helmet", 1, 1),
                new Line("iron_chestplate", 1, 1),
                new Line("iron_leggings", 1, 1),
                new Line("iron_boots", 1, 1),
                new Line("iron_pickaxe", 1, 1),
                new Line("iron_axe", 1, 1),
                new Line("iron_shovel", 1, 1),
                new Line("cooked_beef", 32, 8),
                new Line("torch", 64, 16),
                new Line("cobblestone", 64, 32),
                new Line("oak_log", 16, 16),
                new Line("crafting_table", 1, 1),
                new Line("water_bucket", 1, 1),
                new Line("coal", 32, 16));
    }

    /**
     * Work out what this inventory can actually spare.
     *
     * `free` is creative: there is no such thing as not having something, so
     * the list is granted whole and nothing is short. Everywhere else the
     * surplus above `keepBack` is the ceiling, and a line with no surplus is
     * reported rather than silently dropped — a chest that is missing the
     * pickaxe should say so while you are standing next to it, not when you
     * come back to it dead.
     */
    public static Stocked from(List<Line> lines, Map<String, Integer> carried, boolean free) {
        List<Give> giving = new ArrayList<>();
        List<String> shortOf = new ArrayList<>();
        for (Line line : lines) {
            int count = free ? line.want() : spare(carried, line);
            if (count > 0) giving.add(new Give(line.item(), count));
            else shortOf.add(line.item());
        }
        return new Stocked(List.copyOf(giving), List.copyOf(shortOf));
    }

    /** How many of this line may leave the inventory, never below keepBack. */
    public static int spare(Map<String, Integer> carried, Line line) {
        int have = carried.getOrDefault(line.item(), 0);
        return Math.max(0, Math.min(line.want(), have - line.keepBack()));
    }

    /**
     * The kit as a shopping list, for someone who wants to stock one properly.
     *
     * Want plus keepBack, because to put a spare pickaxe in a box you need two
     * pickaxes — which is the thing that is obvious afterwards and not before.
     */
    public static Map<String, Integer> shoppingList(List<Line> lines) {
        Map<String, Integer> out = new LinkedHashMap<>();
        for (Line line : lines) out.put(line.item(), line.want() + line.keepBack());
        return out;
    }

    /** One line of chat: what it is going to try to put in. */
    public static String describe(Stocked stocked) {
        if (stocked.isEmpty()) return "nothing";
        List<String> parts = new ArrayList<>();
        for (Give give : stocked.giving()) {
            parts.add(give.count() == 1 ? give.item() : give.count() + " " + give.item());
        }
        return String.join(", ", parts);
    }
}
