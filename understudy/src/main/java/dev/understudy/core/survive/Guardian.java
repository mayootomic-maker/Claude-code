package dev.understudy.core.survive;

import java.util.ArrayDeque;
import java.util.Deque;

/**
 * Watches the player while the mod is driving, and takes the controls back.
 *
 * On what this can and cannot promise. It cannot guarantee you never die —
 * nothing can. A creeper that spawns adjacent and detonates inside its fuse
 * kills a full-health player before any tick-based check can respond, and a
 * server hiccup can drop you into a hole nobody saw. What it can do is remove
 * every death that comes from the mod not paying attention: walking a route
 * while starving, digging on with two hearts left, staying underwater until the
 * bar empties, carrying on with a skeleton shooting. Those are the deaths an
 * automated task actually causes, and those are the ones this ends.
 *
 * Rules are ordered by how little time there is to react, not by how bad the
 * outcome is. Lava beats low health because lava kills in about a second and
 * low health can be walked away from.
 *
 * On fighting. This used to answer every hostile with "stop and hand back the
 * controls", which sounds cautious and is not: it loses an hour of unattended
 * work to one zombie, and it stands still in front of the mobs that are faster
 * than you. The Guardian now says only that something is here; Combat decides
 * what to do about it, and running away is one of its answers.
 *
 * It is stateful on purpose: losing four hearts in a second and sitting at
 * fourteen hearts are the same instantaneous reading and call for opposite
 * responses, and only a history can tell them apart.
 */
public final class Guardian {

    public enum Action {
        /** Nothing wrong. Carry on. */
        CONTINUE,
        /** Stop and eat before doing anything else. */
        EAT,
        /** Get to air. */
        SURFACE,
        /** Move away from what is hurting you, now. */
        FLEE,
        /**
         * Deal with the thing that is attacking, rather than standing there.
         *
         * The Guardian deliberately does not decide whether the fight is worth
         * having — that is Combat's question, and it needs to know what is in
         * your hand and what the mob is. This says only that there is something
         * here and it is now the most urgent thing.
         */
        FIGHT,
        /** Stand still and do nothing — mid-fall, or the situation is resolving. */
        HOLD,
        /** Give up the task entirely and hand back control. */
        ABORT
    }

    public record Verdict(Action action, String reason) {
        public boolean interrupts() {
            return action != Action.CONTINUE;
        }
    }

    private static final Verdict FINE = new Verdict(Action.CONTINUE, "");

    /** Health below this fraction stops the task rather than merely pausing it. */
    private static final double ABORT_HEALTH = 0.35;
    /** Below this, retreat but keep the task alive to resume. */
    private static final double FLEE_HEALTH = 0.6;
    /** Sprinting stops below 7, so eat before that rather than after. */
    private static final int EAT_BELOW_FOOD = 14;
    private static final double AIR_RESERVE = 0.35;
    private static final double HOSTILE_CLOSE = 7.0;
    /** Roughly four hearts. Losing this fast means something is actively attacking. */
    private static final double BURST_DAMAGE = 4.0;
    /** Two seconds of history. */
    private static final int WINDOW_TICKS = 40;

    private final Deque<Double> recentHealth = new ArrayDeque<>();

    public void reset() {
        recentHealth.clear();
    }

    /** Losing health quickly, whatever the current reading is. */
    public double damageInWindow() {
        if (recentHealth.size() < 2) return 0;
        return Math.max(0, recentHealth.peekFirst() - recentHealth.peekLast());
    }

    public Verdict check(Vitals vitals) {
        recentHealth.addLast(vitals.health());
        while (recentHealth.size() > WINDOW_TICKS) recentHealth.removeFirst();

        if (vitals.health() <= 0) {
            return new Verdict(Action.ABORT, "you died");
        }
        if (vitals.inLava()) {
            return new Verdict(Action.FLEE, "standing in lava");
        }
        // Falling first among the non-fatal cases: pressing movement keys
        // mid-air changes where you land, and the landing is the dangerous part.
        if (vitals.fallDistance() > 3) {
            return new Verdict(Action.HOLD, "falling");
        }
        if (vitals.inWater() && vitals.airFraction() < AIR_RESERVE) {
            return new Verdict(Action.SURFACE, "running out of air");
        }
        if (vitals.onFire() && vitals.healthFraction() < FLEE_HEALTH) {
            return new Verdict(Action.FLEE, "on fire");
        }
        // Something is here. This comes before the low-health abort on purpose,
        // and the ordering is the whole point of having a combat layer at all:
        // stopping at three hearts is the right answer to a long walk and the
        // wrong one to a spider, which is faster than you and will simply eat
        // the character standing still with its hands off the controls. Combat
        // decides whether this particular fight is worth having, and answers
        // "run" when running is actually available.
        if (vitals.hostilesNear() > 0 && vitals.nearestHostile() < HOSTILE_CLOSE) {
            return new Verdict(Action.FIGHT, "hostile " + Math.round(vitals.nearestHostile())
                    + " blocks away");
        }
        if (vitals.healthFraction() < ABORT_HEALTH) {
            return new Verdict(Action.ABORT,
                    "health down to " + hearts(vitals) + " hearts — stopping");
        }
        // Losing health fast with nothing visible doing it: drowning in a wall,
        // standing in a fire that is out of the scan, falling down a shaft. No
        // target means nothing to fight, so the honest answer is still to stop.
        if (damageInWindow() >= BURST_DAMAGE) {
            return new Verdict(Action.FLEE, "taking damage fast");
        }
        // Eating last of the interruptions: it is the only one that is a chore
        // rather than an emergency, and it should not pre-empt getting out of
        // trouble first.
        if (vitals.food() < EAT_BELOW_FOOD && vitals.hasFood()) {
            return new Verdict(Action.EAT, "hungry");
        }
        return FINE;
    }

    private static String hearts(Vitals vitals) {
        return String.valueOf(Math.round(vitals.health()) / 2);
    }
}
