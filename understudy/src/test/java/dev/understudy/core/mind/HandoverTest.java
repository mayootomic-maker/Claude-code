package dev.understudy.core.mind;

import dev.understudy.core.mind.Handover.Act;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class HandoverTest {

    private static Act after(Handover handover, int ticks, boolean touched, boolean working) {
        Act last = Act.CARRY_ON;
        for (int at = 0; at < ticks; at++) last = handover.next(touched, working);
        return last;
    }

    @Test
    @DisplayName("touching anything hands the controls back at once")
    void handsBackImmediately() {
        Handover handover = new Handover();
        assertEquals(Act.CARRY_ON, handover.next(false, true));
        assertEquals(Act.HAND_BACK, handover.next(true, true));
        assertTrue(handover.holding());
    }

    @Test
    @DisplayName("and keeps the plan rather than throwing it away")
    void takesItBackAfterwards() {
        // The old rule stopped everything, which is the right instinct and the
        // wrong consequence: nudge a key forty minutes into a gather and the
        // gather was gone.
        Handover handover = new Handover();
        handover.next(true, true);
        assertEquals(Act.CARRY_ON, after(handover, Handover.STILL_FOR - 1, false, true),
                "took over before the ten seconds were up");
        assertEquals(Act.TAKE_OVER, handover.next(false, true));
        assertFalse(handover.holding());
    }

    @Test
    @DisplayName("the clock restarts on any movement at all")
    void anyTouchRestartsIt() {
        Handover handover = new Handover();
        handover.next(true, true);
        after(handover, Handover.STILL_FOR - 5, false, true);
        handover.next(true, true);                       // one twitch
        assertEquals(Act.CARRY_ON, after(handover, Handover.STILL_FOR - 1, false, true),
                "a single keypress did not restart the count");
        assertEquals(Act.TAKE_OVER, handover.next(false, true));
    }

    @Test
    @DisplayName("it says how long is left, so the wait is not a mystery")
    void countsDown() {
        Handover handover = new Handover();
        handover.next(true, true);
        assertEquals(Handover.STILL_FOR, handover.untilTakeover());
        after(handover, 100, false, true);
        assertEquals(Handover.STILL_FOR - 100, handover.untilTakeover());
    }

    @Test
    @DisplayName("nothing running means nothing to hand back")
    void quietWhenIdle() {
        Handover handover = new Handover();
        assertEquals(Act.CARRY_ON, after(handover, 50, true, false));
        assertFalse(handover.holding());
        // And it does not then "take over" something that was never running.
        assertEquals(Act.CARRY_ON, after(handover, 400, false, false));
    }

    @Test
    @DisplayName("standing still without ever touching anything changes nothing")
    void doesNotStartOnItsOwn() {
        Handover handover = new Handover();
        assertEquals(Act.CARRY_ON, after(handover, 1000, false, true));
    }
}
