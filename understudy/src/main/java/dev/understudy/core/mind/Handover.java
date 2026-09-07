package dev.understudy.core.mind;

/**
 * Who has the controls, and when they change hands.
 *
 * The old rule was that touching a movement key stopped everything. It is the
 * right instinct — the gesture you make when something is going wrong is to
 * grab the keyboard — and the wrong consequence: it threw the plan away. Nudge
 * a key by accident forty minutes into a gather and the gather was gone.
 *
 * So touching anything hands the controls back and *holds* the plan. It takes
 * them again only after you have genuinely stopped: not merely stopped pressing
 * keys, but stopped moving, stopped looking around, and stayed that way long
 * enough that it is clearly not a pause for breath. Ten seconds of a completely
 * still character is a person who has put the mouse down.
 *
 * The asymmetry is the point. Handing over is instant, because the cost of
 * being slow is that it fights you. Taking back is slow, because the cost of
 * being quick is that it starts moving while you are still deciding something.
 */
public final class Handover {

    /** What should happen to the running work. */
    public enum Act {
        /** Nothing has changed. */
        CARRY_ON,
        /** Hands off now, and keep the plan for later. */
        HAND_BACK,
        /** They have been still long enough. Pick it up again. */
        TAKE_OVER
    }

    /**
     * Ten seconds.
     *
     * Long enough that walking to a chest and back does not restart it, short
     * enough that "I have finished, off you go" does not need a command. A
     * shorter figure was tempting and is wrong: three seconds is exactly the
     * length of a thought.
     */
    public static final int STILL_FOR = 200;

    private boolean holding;
    private int stillTicks;

    /** Whether the plan is currently held because a person touched something. */
    public boolean holding() {
        return holding;
    }

    /** How much longer, in ticks, before it would take over again. */
    public int untilTakeover() {
        return holding ? Math.max(0, STILL_FOR - stillTicks) : 0;
    }

    public void reset() {
        holding = false;
        stillTicks = 0;
    }

    /**
     * One tick.
     *
     * @param touched whether the person did anything at all this tick — a key,
     *                the mouse, the camera, a step in any direction
     * @param working whether there is anything running to hand back
     */
    public Act next(boolean touched, boolean working) {
        if (touched) {
            stillTicks = 0;
            if (!holding && working) {
                holding = true;
                return Act.HAND_BACK;
            }
            holding = holding || working;
            return Act.CARRY_ON;
        }
        if (!holding) return Act.CARRY_ON;

        if (++stillTicks < STILL_FOR) return Act.CARRY_ON;
        holding = false;
        stillTicks = 0;
        return Act.TAKE_OVER;
    }
}
