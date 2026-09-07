package dev.understudy.core.adapt;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Where the time actually went.
 *
 * "Too slow" is a real complaint and an unactionable one: a job that takes
 * twenty minutes might be nineteen minutes of mining, which is the game's own
 * speed and nothing to fix, or nineteen minutes of walking between blocks,
 * which is entirely fixable. Guessing between those and optimising the wrong
 * one is how you spend a day making something no faster.
 *
 * So it is counted rather than guessed. Ticks are the unit because ticks are
 * what the mod has — twenty to the second, and every phase already runs inside
 * one. Nothing here is per-block or per-job: the question is what the *shape*
 * of a job is, and a handful of totals answers that.
 */
public final class Timings {

    /** What a tick was spent on. One of these, every tick a task is running. */
    public enum Phase {
        /** Walking, including the pathfinding that decides where. */
        TRAVELLING,
        /** Looking for something: the block scan and the memory. */
        SEARCHING,
        /** Swinging at a block. */
        MINING,
        /**
         * Swinging at something that swings back.
         *
         * Its own bucket rather than folded into mining, because it is the one
         * category the player can act on directly: a job that spent half its
         * time fighting wants better armour or a different route, not a faster
         * pathfinder.
         */
        FIGHTING,
        /** Putting a block down. */
        PLACING,
        /** In a menu: crafting, smelting, a chest. */
        HANDLING,
        /** Turning the head, and nothing else. */
        AIMING,
        /** None of the above — waiting on a cooldown, or on the world. */
        WAITING
    }

    private final Map<Phase, Integer> ticks = new LinkedHashMap<>();
    private int total;

    public void spent(Phase phase) {
        ticks.merge(phase, 1, Integer::sum);
        total++;
    }

    public int ticksIn(Phase phase) {
        return ticks.getOrDefault(phase, 0);
    }

    public int totalTicks() {
        return total;
    }

    public double secondsIn(Phase phase) {
        return ticksIn(phase) / 20.0;
    }

    /** The share of the job this phase took, 0 to 1. */
    public double shareOf(Phase phase) {
        return total == 0 ? 0 : (double) ticksIn(phase) / total;
    }

    public void clear() {
        ticks.clear();
        total = 0;
    }

    /**
     * Biggest first, because the top line is the only one that matters when
     * deciding what to fix.
     */
    public java.util.List<String> summary() {
        java.util.List<String> lines = new java.util.ArrayList<>();
        if (total == 0) {
            lines.add("nothing timed yet");
            return lines;
        }
        lines.add(String.format("%.0f seconds accounted for:", total / 20.0));
        ticks.entrySet().stream()
                .sorted((a, b) -> Integer.compare(b.getValue(), a.getValue()))
                .forEach(entry -> lines.add(String.format("  %-11s %5.0fs  %2.0f%%",
                        entry.getKey().name().toLowerCase(),
                        entry.getValue() / 20.0,
                        100.0 * entry.getValue() / total)));
        return lines;
    }
}
