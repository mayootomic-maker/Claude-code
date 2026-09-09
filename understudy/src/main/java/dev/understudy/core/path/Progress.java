package dev.understudy.core.path;

/**
 * Whether the walk is actually working, and what to try when it is not.
 *
 * "It always gets stuck somewhere" was the complaint, and the answer to it
 * lived in the middle of Walker, tangled up with key presses and Minecraft
 * types — which meant the one piece of this mod most likely to be wrong was the
 * one piece that could not be tested. It is here now, and every rule below has
 * a case in ProgressTest.
 *
 * Two different things go wrong on a walk and they need different answers:
 *
 * **Wedged.** The character is pressed against something — a fence post, a
 * doorframe, the corner of a staircase — and is not going anywhere at all. The
 * fix is a ladder of increasingly rude things to try, in the order a person
 * tries them: jump, open whatever it is, lean out sideways, dig.
 *
 * **Going nowhere.** The character is moving perfectly well and getting no
 * closer, which is a different failure: the route is wrong, or it loops, or the
 * goal is somewhere the path cannot actually reach. Rudeness does not help. The
 * fix is a new route.
 *
 * The old check could not tell them apart, and worse, it could not see the
 * second one at all: it compared the distance to the *look-ahead point* with
 * last tick's, which decreases on almost every tick of a perfectly useless
 * circular walk. Scraping along a wall at a fifth of walking speed counted as
 * progress forever.
 */
public final class Progress {

    /** What to do about it, in escalating order of rudeness. */
    public enum Move {
        /** Nothing wrong. Keep walking. */
        WALK,
        /** A step, a slab, a lip on a staircase. */
        JUMP,
        /** A door or a gate. One click, and much cheaper than the alternatives. */
        OPEN,
        /** Lean out and go round. Jumping does nothing about a fence post. */
        LEAN_LEFT,
        LEAN_RIGHT,
        /** Cut through it, if this route was allowed to. */
        DIG,
        /** Moving fine and getting no closer: the route is the problem. */
        REPATH,
        /** None of it worked. Say so rather than lean on the wall forever. */
        GIVE_UP
    }

    /** Ticks of position history to judge "has it moved at all" over. */
    private static final int WEDGE_WINDOW = 20;
    /**
     * Blocks of movement in that second that count as moving.
     *
     * Walking covers about four blocks a second and sprinting five and a half,
     * so this is under a fifth of a walk — generous enough that pushing through
     * cobwebs or wading is never mistaken for being stuck, and small enough
     * that being pressed against a fence is caught in one second.
     */
    private static final double MOVED_AT_ALL = 0.75;

    /** Ticks over which the goal has to get closer by something. */
    private static final int NOWHERE_WINDOW = 120;
    /**
     * How much closer, over those six seconds.
     *
     * Deliberately tiny compared with what a walk covers. It is not measuring
     * speed; it is asking whether the route is going anywhere at all, and any
     * real route beats this by a factor of twenty.
     */
    private static final double CLOSER_BY = 2.0;

    /** The ladder, in ticks wedged. */
    private static final int TRY_JUMPING = 12;
    private static final int TRY_OPENING = 20;
    private static final int TRY_LEANING = 25;
    private static final int TRY_DIGGING = 45;
    private static final int ENOUGH = 70;
    /** How long to hold one lean before trying the other side. */
    private static final int LEAN_FOR = 12;

    private final double[] x = new double[WEDGE_WINDOW];
    private final double[] y = new double[WEDGE_WINDOW];
    private final double[] z = new double[WEDGE_WINDOW];
    private int samples;

    private double bestToGoal = Double.MAX_VALUE;
    private int sinceCloser;
    private int wedged;
    private int leaning;

    /** A fresh route: forget everything about how the last one was going. */
    public void restart() {
        samples = 0;
        bestToGoal = Double.MAX_VALUE;
        sinceCloser = 0;
        wedged = 0;
        leaning = 0;
    }

    public int wedgedTicks() {
        return wedged;
    }

    /** Whether the caller should stop rather than keep trying. */
    public boolean hopeless() {
        return wedged >= ENOUGH;
    }

    /**
     * One tick.
     *
     * @param toGoal straight-line distance to where the journey is actually
     *               going — the destination, not the next waypoint. The
     *               waypoint moves ahead as you walk, which is why measuring
     *               against it cannot tell walking from circling.
     */
    public Move next(double px, double py, double pz, double toGoal) {
        record(px, py, pz);

        // The best only moves on a real improvement. Sliding it down to the
        // current distance every tick — which is what the first version did —
        // makes the threshold unreachable by construction: the goal can never
        // be two blocks nearer than a number that was just set to where it is.
        // A perfectly good four-hundred-block walk asked for a new route
        // halfway along it.
        if (toGoal < bestToGoal - CLOSER_BY) {
            bestToGoal = toGoal;
            sinceCloser = 0;
        } else {
            sinceCloser++;
        }

        if (movedRecently()) {
            wedged = 0;
            leaning = 0;
            // Moving well and no nearer for six seconds. Nothing physical is in
            // the way, so nothing physical will fix it.
            return sinceCloser > NOWHERE_WINDOW ? Move.REPATH : Move.WALK;
        }

        wedged++;
        if (wedged >= ENOUGH) return Move.GIVE_UP;
        if (wedged >= TRY_DIGGING) return Move.DIG;
        if (wedged >= TRY_LEANING) return lean();
        if (wedged >= TRY_OPENING) return Move.OPEN;
        if (wedged >= TRY_JUMPING) return Move.JUMP;
        return Move.WALK;
    }

    /**
     * Which way to lean, held for a while and then swapped.
     *
     * Alternating matters: whichever side the obstruction is on, one of the two
     * is past it. Holding matters too — a side chosen afresh every tick is a
     * character vibrating on the spot, which is both useless and the most
     * obviously non-human thing it could do.
     */
    private Move lean() {
        leaning++;
        return (leaning / LEAN_FOR) % 2 == 0 ? Move.LEAN_LEFT : Move.LEAN_RIGHT;
    }

    /** Whether the last second contains any real movement. */
    private boolean movedRecently() {
        if (samples < WEDGE_WINDOW) return true; // not enough history to accuse it yet
        int newest = (samples - 1) % WEDGE_WINDOW;
        int oldest = samples % WEDGE_WINDOW;
        double dx = x[newest] - x[oldest];
        double dy = y[newest] - y[oldest];
        double dz = z[newest] - z[oldest];
        return Math.sqrt(dx * dx + dy * dy + dz * dz) >= MOVED_AT_ALL;
    }

    private void record(double px, double py, double pz) {
        int slot = samples % WEDGE_WINDOW;
        x[slot] = px;
        y[slot] = py;
        z[slot] = pz;
        samples++;
    }
}
