package dev.understudy.core.mind;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Something bigger than a task, broken into tasks.
 *
 * Everything this mod could be told to do was one thing: get that, build this,
 * sort those. That is a set of skills rather than something you can hand an
 * objective to — "set me up here" is not a command it had, and the reason is
 * not that any of the pieces were missing. They were all there and nothing
 * joined them up.
 *
 * A project is an ordered list of objectives with the awkward property that
 * makes it useful: **nothing is remembered**. Which objective is next is worked
 * out afresh from what is true right now, so the same code answers "what next"
 * on the first tick and after you quit, reload, wander off, do half of it by
 * hand, and come back a day later. A project that kept a step counter would
 * confidently build a second house next to the one you built yourself.
 *
 * That also means a project can be *finished by the player*. Put the chests in
 * yourself and the objective is met; the mod does not care who did it.
 */
public final class Project {

    /** The kinds of thing a step can be, each one something the mod already does. */
    public enum Kind {
        /** Have this many of an item, however that has to happen. */
        GET,
        /** A structure of this design standing somewhere near. */
        BUILD,
        /** Nothing left in the bag that belongs in a chest. */
        SORT,
        /** Somewhere dark enough for things to spawn, made not so. */
        LIGHT
    }

    /**
     * One step, and why it is there.
     *
     * The reason is not decoration: a project the player cannot interrogate is
     * a mod doing things for reasons of its own, which is the thing people
     * uninstall.
     */
    public record Objective(Kind kind, String what, int count, String why) {
        public String describe() {
            return switch (kind) {
                case GET -> "get " + count + " " + what;
                case BUILD -> "build a " + what;
                case SORT -> "put everything away";
                case LIGHT -> "light the place";
            };
        }
    }

    /**
     * What is true right now, as the only thing an objective is judged against.
     *
     * @param carried what is in the bag
     * @param built   designs known to be standing nearby, by id
     * @param light   light level where the player is
     * @param spare   items in the bag that belong in a chest rather than on you
     */
    public record Facts(Map<String, Integer> carried, Set<String> built, int light, int spare) {}

    /** A named project, and the steps it is made of. */
    public record Plan(String id, String name, String summary, List<Objective> objectives) {}

    /** Dark enough for things to spawn. The game's own threshold. */
    private static final int DARK = 8;
    /** Enough loose oddments in the bag to be worth a trip to the chests. */
    private static final int UNTIDY = 6;

    private Project() {}

    /**
     * The projects it knows.
     *
     * Deliberately few and deliberately concrete. A project that means "improve
     * things" cannot be finished and cannot be checked, and a list of twenty is
     * a menu nobody reads. Each of these is a sentence someone would actually
     * say, and each has an end you can point at.
     */
    private static final List<Plan> PLANS = List.of(
            new Plan("kit", "Kit up",
                    "A pickaxe, a sword, armour, light and food — the state you want "
                            + "to be in before anything else.",
                    List.of(
                            new Objective(Kind.GET, "stone_pickaxe", 1,
                                    "everything else needs one first"),
                            new Objective(Kind.GET, "stone_sword", 1,
                                    "the difference between a zombie costing two hearts and eight"),
                            new Objective(Kind.GET, "cooked_beef", 8,
                                    "food is what heals, and running out ends the day"),
                            new Objective(Kind.GET, "torch", 32,
                                    "a dark tunnel is a tunnel full of things that spawned in it"),
                            new Objective(Kind.GET, "iron_pickaxe", 1,
                                    "diamond needs iron, and iron mines four times faster"),
                            new Objective(Kind.GET, "iron_chestplate", 1,
                                    "where two thirds of the armour points are"),
                            new Objective(Kind.GET, "iron_leggings", 1, "and most of the rest"),
                            new Objective(Kind.GET, "shield", 1,
                                    "turns a skeleton from a problem into a nuisance"))),

            new Plan("camp", "Make camp",
                    "Somewhere to be when it gets dark: a shelter, a bed, and light.",
                    List.of(
                            new Objective(Kind.GET, "torch", 16, "before it is needed, not after"),
                            new Objective(Kind.GET, "white_bed", 1,
                                    "sleeping through the night removes every hostile in it"),
                            new Objective(Kind.BUILD, "hut", 1,
                                    "one room and a door is the whole requirement"),
                            new Objective(Kind.LIGHT, "", 0,
                                    "nothing spawns in a lit camp"))),

            new Plan("base", "Settle here",
                    "A house to live in, a storage room, everything put away and the "
                            + "whole place lit.",
                    List.of(
                            new Objective(Kind.GET, "stone_pickaxe", 1, "for the digging"),
                            new Objective(Kind.BUILD, "house", 1, "somewhere to live"),
                            new Objective(Kind.BUILD, "storage", 1, "somewhere to put things"),
                            new Objective(Kind.SORT, "", 0,
                                    "a storage room with everything still in your pockets is a room"),
                            new Objective(Kind.LIGHT, "", 0, "so it stays yours overnight"))),

            new Plan("enchanter", "Set up enchanting",
                    "A table and the fifteen bookshelves that make it worth using — "
                            + "roughly double the mining speed, permanently.",
                    List.of(
                            new Objective(Kind.GET, "diamond_pickaxe", 1,
                                    "obsidian cannot be mined with anything less"),
                            new Objective(Kind.GET, "enchanting_table", 1, "the table itself"),
                            new Objective(Kind.GET, "bookshelf", 15,
                                    "fourteen is meaningfully worse and looks identical"),
                            new Objective(Kind.GET, "lapis_lazuli", 12, "the price of admission"),
                            new Objective(Kind.BUILD, "study", 1,
                                    "the shelves have to be round the table to count"))));

    public static List<Plan> all() {
        return PLANS;
    }

    public static Plan byId(String id) {
        for (Plan plan : PLANS) if (plan.id().equalsIgnoreCase(id)) return plan;
        return null;
    }

    public static List<String> ids() {
        List<String> out = new ArrayList<>();
        for (Plan plan : PLANS) out.add(plan.id());
        return out;
    }

    /**
     * The first step that is not already true, or null when the project is done.
     *
     * In order, and the order matters: a house before a storage room because
     * you sleep in one of them, a pickaxe before either. But every step is
     * checked, so one already satisfied — by the player, by a previous run, by
     * luck — is stepped over rather than repeated.
     */
    public static Objective next(Plan plan, Facts facts) {
        for (Objective objective : plan.objectives()) {
            if (!met(objective, facts)) return objective;
        }
        return null;
    }

    /** Whether this step is already true. */
    public static boolean met(Objective objective, Facts facts) {
        return switch (objective.kind()) {
            case GET -> facts.carried().getOrDefault(objective.what(), 0) >= objective.count();
            case BUILD -> facts.built().contains(objective.what());
            case SORT -> facts.spare() <= UNTIDY;
            case LIGHT -> facts.light() >= DARK;
        };
    }

    /** How far along, as something a person can read. */
    public static List<String> progress(Plan plan, Facts facts) {
        List<String> lines = new ArrayList<>();
        int done = 0;
        for (Objective objective : plan.objectives()) {
            boolean met = met(objective, facts);
            if (met) done++;
            lines.add((met ? "  done  " : "  to do ") + objective.describe());
        }
        lines.add(0, plan.name() + ": " + done + " of " + plan.objectives().size());
        return lines;
    }

    /**
     * Everything the project still wants, as one shopping list.
     *
     * Useful on its own: the planner costs a list far better than it costs the
     * same items one at a time, because the pickaxe and the crafting table and
     * the walk underground get paid for once. Asking "what does this project
     * cost" is the same question as "what is left".
     */
    public static Map<String, Integer> shoppingList(Plan plan, Facts facts) {
        Map<String, Integer> wanted = new LinkedHashMap<>();
        for (Objective objective : plan.objectives()) {
            if (objective.kind() != Kind.GET || met(objective, facts)) continue;
            wanted.merge(objective.what(), objective.count(), Integer::max);
        }
        return wanted;
    }
}
