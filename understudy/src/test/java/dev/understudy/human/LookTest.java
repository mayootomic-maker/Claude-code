package dev.understudy.human;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class LookTest {

    @Test
    void reachesTheTargetItIsGiven() {
        Look look = new Look(new Rng("aim"), 0, 0);
        for (int tick = 0; tick < 60; tick++) look.tick(90, 0);
        assertEquals(90, look.yaw(), 2.0, "should settle on the target within three seconds");
    }

    @Test
    void acceleratesAndDeceleratesRatherThanSweepingFlat() {
        // The old clamp-per-tick turn moved the same amount every tick. A neck
        // does not: it speeds up, then slows into the target. Comparing the
        // first tick against the fastest one is what tells them apart.
        Look look = new Look(new Rng("ramp"), 0, 0);
        double previous = 0;
        double first = 0;
        double fastest = 0;
        for (int tick = 0; tick < 40; tick++) {
            double yaw = look.tick(120, 0);
            double moved = Math.abs(Look.wrap(yaw - previous));
            if (tick == 0) first = moved;
            fastest = Math.max(fastest, moved);
            previous = yaw;
        }
        assertTrue(fastest > first * 3,
                "turn should build up speed, not start at full rate (first=" + first
                        + " fastest=" + fastest + ")");
    }

    @Test
    void neverSnaps() {
        Look look = new Look(new Rng("snap"), 0, 0);
        double previous = 0;
        for (int tick = 0; tick < 80; tick++) {
            double yaw = look.tick(179, 0);
            assertTrue(Math.abs(Look.wrap(yaw - previous)) < 30,
                    "no single tick may jump the view that far");
            previous = yaw;
        }
    }

    @Test
    void lagsBehindATargetThatMovesEveryTick() {
        // Zero lag is the giveaway: a person cannot track a target that changes
        // sixty times a second without falling behind it.
        Look look = new Look(new Rng("lag"), 0, 0);
        double target = 0;
        double totalError = 0;
        for (int tick = 0; tick < 60; tick++) {
            target += 3;
            totalError += Math.abs(Look.wrap(target - look.tick(target, 0)));
        }
        assertTrue(totalError / 60 > 1.0, "should trail a moving target, not lock onto it");
    }

    @Test
    void isNeverPerfectlyStill() {
        // Held on one target, a real view still drifts. An exactly constant
        // angle over three seconds is only possible without a hand on the mouse.
        Look look = new Look(new Rng("tremor"), 0, 0);
        for (int tick = 0; tick < 40; tick++) look.tick(45, 0);
        double settled = look.yaw();
        boolean moved = false;
        for (int tick = 0; tick < 60; tick++) {
            if (Math.abs(look.tick(45, 0) - settled) > 1e-6) moved = true;
        }
        assertTrue(moved, "a settled view should still drift slightly");
    }

    @Test
    void staysWithinPitchLimits() {
        Look look = new Look(new Rng("pitch"), 0, 0);
        for (int tick = 0; tick < 100; tick++) {
            look.tick(0, 900);
            assertTrue(look.pitch() <= 90.0001 && look.pitch() >= -90.0001,
                    "pitch escaped its limits: " + look.pitch());
        }
    }

    @Test
    void resetDoesNotSweep() {
        Look look = new Look(new Rng("reset"), 0, 0);
        look.reset(170, 20);
        assertEquals(170, look.yaw(), 1e-9);
        assertEquals(20, look.pitch(), 1e-9);
    }

    @Test
    void takesTheShortWayRound() {
        Look look = new Look(new Rng("wrap"), 170, 0);
        for (int tick = 0; tick < 60; tick++) look.tick(-170, 0);
        assertEquals(0, Look.wrap(look.yaw() - (-170)), 2.0,
                "should cross 180 rather than turn 340 degrees the long way");
    }
}
