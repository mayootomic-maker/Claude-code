package dev.understudy.core.mind;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TouchedTest {

    /**
     * The bug this class was extracted for.
     *
     * A working mod turns its own head and walks itself across a site. Measured
     * from where the mod left the view, that turn is zero degrees, and while it
     * is under way its own travel is not read at all. If either of those counts,
     * the mod hands the controls back the instant it starts and never gets them
     * back — which is exactly what shipped.
     */
    @Test
    void theModWorkingIsNotThePersonDoingSomething() {
        assertFalse(Touched.by(false, false, 0.0, 0.9, true),
                "the mod walking itself across a site is not you walking");
    }

    @Test
    void aHandOnTheMouseCountsEvenWhileItIsWorking() {
        assertTrue(Touched.by(false, false, 4.0, 0.0, true));
    }

    @Test
    void aKeyTheModDidNotPressCountsAtOnce() {
        assertTrue(Touched.by(false, true, 0.0, 0.0, true));
    }

    @Test
    void openingAContainerCounts() {
        assertTrue(Touched.by(true, false, 0.0, 0.0, true));
    }

    @Test
    void walkingCountsOnceTheControlsAreYours() {
        assertTrue(Touched.by(false, false, 0.0, 0.2, false));
    }

    /**
     * The countdown has to be able to finish. Standing still is never exactly
     * still — there is drift of a few thousandths of a block from the physics
     * alone — and treating that as movement would mean the ten seconds never
     * elapsed and the mod never picked its work back up.
     */
    @Test
    void standingStillFinishesTheCountdown() {
        assertFalse(Touched.by(false, false, 0.0, 0.004, false));
        assertFalse(Touched.by(false, false, 0.1, 0.0, false));
    }
}
