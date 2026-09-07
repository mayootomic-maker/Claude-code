package dev.understudy.core.mind;

/**
 * Whether the person did something, as distinct from the mod doing something.
 *
 * This existed as four lines inside the client tick and it was wrong, in the
 * way that only untested code gets to be wrong: it compared the view against
 * the previous tick's view and the position against the previous tick's
 * position, which answers "did anything move" rather than "did *you* move
 * anything". The mod turns its own head every tick while it works, so the
 * moment it started a job it saw its own turn, decided a hand was on the mouse,
 * handed the controls back, waited to be still, took them again, turned its
 * head — forever. The feature shipped and did not work once.
 *
 * So the rule is here, where it can be tested, and it takes two things the tick
 * loop has to establish rather than one:
 *
 *  - **How far the view has moved since the mod last left it.** Not since last
 *    tick. The view has exactly two authors, and measuring from the one the mod
 *    wrote leaves only the mouse.
 *  - **Whether the mod is the one moving the character.** Position cannot tell
 *    a walk the mod started from a walk you started — it is the same physics —
 *    so while the mod is under way, position is not evidence and the keys are.
 *    While the controls are yours the mod holds nothing, and position becomes
 *    exact, which is the case that has to be right: it is what times the wait.
 */
public final class Touched {
    private Touched() {}

    /**
     * Half a degree of mouse. Small enough to feel instant; larger than the
     * nothing a still mouse produces.
     */
    public static final double MOUSE_NUDGE = 0.35;

    /** Four centimetres of ground, which is less than one tick of walking. */
    public static final double STEP = 0.04;

    /**
     * @param containerOpen    a chest, furnace or your own inventory is open
     * @param keyByHand        a movement key is down that the mod did not press
     * @param viewMoved        degrees the view has moved since the mod left it
     * @param movedFlat        blocks travelled horizontally since the last tick
     * @param modIsMoving      the mod is the one under way, so position lies
     */
    public static boolean by(boolean containerOpen, boolean keyByHand,
                             double viewMoved, double movedFlat, boolean modIsMoving) {
        if (containerOpen || keyByHand) return true;
        if (viewMoved > MOUSE_NUDGE) return true;
        return !modIsMoving && movedFlat > STEP;
    }
}
