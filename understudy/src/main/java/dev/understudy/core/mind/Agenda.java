package dev.understudy.core.mind;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Deciding what to do next, and being able to say why.
 *
 * Everything else in this mod is a skilled pair of hands: a recipe solver that
 * plans a diamond pickaxe from an empty inventory, a pathfinder that walks two
 * thousand blocks, a sorter that lays out a base. None of them ever *chooses*
 * anything. Every one of them sits still until a command arrives, which is why
 * the whole thing can look expert and stupid in the same minute — it will
 * cheerfully mine iron on two hearts in the dark with a full inventory, because
 * nobody asked it not to.
 *
 * This is the missing half. Given a reading of the situation it answers one
 * question — what should be happening right now — and it answers with a reason,
 * because a decision you cannot interrogate is indistinguishable from a bug.
 *
 * Where it can be better than a person, and where it cannot. It cannot form
 * intentions it was never taught; there is no goal here that is not in this
 * file. What it can do is never forget, never miscount, and never fail to
 * notice: a person mining at y minus fifty forgets they are on four hearts,
 * loses track of how much food is left, and walks past the coal they will need
 * in ten minutes. This does not, and that is most of the distance between
 * "stupid" and "sharp" in practice.
 */
public final class Agenda {

    /** What the mod could be doing. Deliberately few and deliberately concrete. */
    public enum Act {
        /** Nothing needs doing and nothing was asked for. */
        IDLE,
        /** Get away and stop working — something is actively hurting us. */
        RETREAT,
        /** Eat. */
        EAT,
        /** Put a light down. */
        LIGHT,
        /** Put things away, because there is nowhere to put what comes next. */
        UNLOAD,
        /** Make or replace a tool the standing job needs. */
        EQUIP,
        /** Go and fetch a material the standing job needs. */
        FETCH,
        /** Get on with the job that was asked for. */
        WORK
    }

    /**
     * Everything the decision depends on, read once so the reasoning is a pure
     * function of it and can be tested without a game.
     *
     * @param health        hearts remaining, out of maxHealth
     * @param maxHealth     hearts at full
     * @param damageTaken   health lost in the last couple of seconds
     * @param food          hunger, out of twenty
     * @param carryingFood  whether there is anything edible on hand
     * @param light         light level where we are standing, 0 to 15
     * @param carryingTorch whether there is a torch to place
     * @param freeSlots     empty inventory slots
     * @param threatsNear   hostiles within a dozen blocks
     * @param carried       what is in the inventory, by name
     * @param job           what was asked for, or null when nothing was
     */
    public record Situation(double health, double maxHealth, double damageTaken,
                            int food, boolean carryingFood,
                            int light, boolean carryingTorch,
                            int freeSlots, int threatsNear,
                            Map<String, Integer> carried, Job job) {}

    /**
     * A standing instruction, and what it still needs.
     *
     * `needs` is what the planner already worked out is missing — the agenda
     * does not re-derive it, it decides whether now is the moment to go and get
     * it or whether something else comes first.
     */
    public record Job(String what, List<String> needsTools, List<String> needsMaterials) {
        public static Job of(String what) {
            return new Job(what, List.of(), List.of());
        }
    }

    /** What to do, and the sentence explaining it. */
    public record Decision(Act act, String detail, String because) {
        public String describe() {
            return detail == null || detail.isEmpty()
                    ? act.name().toLowerCase() + " — " + because
                    : act.name().toLowerCase() + " " + detail + " — " + because;
        }
    }

    /** Below this fraction of health, nothing else matters. */
    private static final double HURT = 0.4;
    /** Losing this much in two seconds means something is attacking. */
    private static final double UNDER_ATTACK = 3.0;
    /** Sprinting stops at 6; eat before that rather than after. */
    private static final int HUNGRY = 14;
    /** The game's own spawn threshold. */
    private static final int DARK = 8;
    /** Fewer free slots than this and the next haul has nowhere to go. */
    private static final int NEARLY_FULL = 2;

    /**
     * The one question.
     *
     * Ordered by how little time there is to react rather than by how much the
     * outcome is worth, which is the same principle the Guardian uses and for
     * the same reason: being on fire is less bad than being bored, and far more
     * urgent.
     */
    public Decision next(Situation now) {
        if (now.health() <= 0) {
            return new Decision(Act.RETREAT, "", "dead; nothing to decide");
        }
        if (now.damageTaken() >= UNDER_ATTACK || (now.threatsNear() > 0 && hurt(now))) {
            return new Decision(Act.RETREAT, "",
                    "losing health with " + now.threatsNear() + " nearby — stopping beats finishing");
        }
        if (hurt(now) && now.carryingFood()) {
            return new Decision(Act.EAT, "",
                    "on " + heartsOf(now) + " hearts; eating is what heals");
        }
        if (now.food() <= HUNGRY && now.carryingFood()) {
            return new Decision(Act.EAT, "", "hunger " + now.food() + "; below 6 it stops sprinting");
        }
        if (hurt(now)) {
            return new Decision(Act.RETREAT, "",
                    "on " + heartsOf(now) + " hearts with nothing to eat");
        }

        // Nothing is on fire. Now the things that quietly ruin the next hour.
        if (now.light() < DARK && now.carryingTorch()) {
            return new Decision(Act.LIGHT, "",
                    "light " + now.light() + " here — things spawn below " + DARK);
        }
        if (now.freeSlots() <= NEARLY_FULL) {
            return new Decision(Act.UNLOAD, "",
                    now.freeSlots() + " slots left; what is mined next would drop on the floor");
        }

        Job job = now.job();
        if (job == null) {
            return new Decision(Act.IDLE, "", "nothing asked for");
        }
        for (String tool : job.needsTools()) {
            if (!has(now, tool)) {
                return new Decision(Act.EQUIP, tool, "no " + tool + " and " + job.what() + " needs one");
            }
        }
        for (String material : job.needsMaterials()) {
            if (!has(now, material)) {
                return new Decision(Act.FETCH, material,
                        job.what() + " is short of " + material);
            }
        }
        return new Decision(Act.WORK, job.what(), "everything it needs is to hand");
    }

    /**
     * The whole ordering, for explaining itself.
     *
     * Not used to decide anything — `next` is the decision. This exists so the
     * player can ask why and get the reasoning rather than the conclusion,
     * which is the difference between trusting it and watching it.
     */
    public List<String> reasoning(Situation now) {
        List<String> lines = new ArrayList<>();
        lines.add(String.format("health %.0f/%.0f%s", now.health(), now.maxHealth(),
                hurt(now) ? " — hurt" : ""));
        lines.add("hunger " + now.food() + (now.carryingFood() ? " (food carried)" : " (no food)"));
        lines.add("light " + now.light() + (now.light() < DARK ? " — spawns here" : ""));
        lines.add(now.freeSlots() + " free slots");
        lines.add(now.threatsNear() + " hostiles near");
        Job job = now.job();
        lines.add(job == null ? "no standing job" : "job: " + job.what());
        if (job != null) {
            if (!job.needsTools().isEmpty()) lines.add("  needs tools: " + String.join(", ", job.needsTools()));
            if (!job.needsMaterials().isEmpty()) {
                lines.add("  needs materials: " + String.join(", ", job.needsMaterials()));
            }
        }
        lines.add("-> " + next(now).describe());
        return lines;
    }

    private static boolean hurt(Situation now) {
        return now.maxHealth() > 0 && now.health() / now.maxHealth() < HURT;
    }

    private static String heartsOf(Situation now) {
        return String.format("%.0f", now.health() / 2);
    }

    private static boolean has(Situation now, String item) {
        return now.carried().getOrDefault(item, 0) > 0;
    }
}
