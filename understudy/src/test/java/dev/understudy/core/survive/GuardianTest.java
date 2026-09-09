package dev.understudy.core.survive;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GuardianTest {

    private static Vitals with(double health, int food, boolean hasFood) {
        return new Vitals(health, 20, food, hasFood, 300, 300, false, false, false, 0, 0, 999);
    }

    @Test
    void saysNothingWhenNothingIsWrong() {
        assertFalse(new Guardian().check(Vitals.healthy()).interrupts());
    }

    @Test
    void lavaBeatsEverythingElse() {
        // Starving, drowning and burning at once: lava still wins, because it
        // is the one that kills before the next check.
        Vitals awful = new Vitals(6, 20, 0, true, 10, 300, true, true, true, 0, 3, 2);
        assertEquals(Guardian.Action.FLEE, new Guardian().check(awful).action());
        assertTrue(new Guardian().check(awful).reason().contains("lava"));
    }

    @Test
    void holdsStillWhileFalling() {
        Vitals falling = new Vitals(20, 20, 20, true, 300, 300,
                false, false, false, 9, 0, 999);
        assertEquals(Guardian.Action.HOLD, new Guardian().check(falling).action());
    }

    @Test
    void surfacesBeforeTheAirRunsOut() {
        Vitals drowning = new Vitals(20, 20, 20, true, 60, 300,
                false, false, true, 0, 0, 999);
        assertEquals(Guardian.Action.SURFACE, new Guardian().check(drowning).action());
    }

    @Test
    void abortsRatherThanContinuingOnLowHealth() {
        assertEquals(Guardian.Action.ABORT, new Guardian().check(with(6, 20, true)).action());
    }

    @Test
    void eatsBeforeSprintingWouldStop() {
        // Sprinting cuts out at 6. Eating at 13 means it never gets there
        // mid-journey, rather than stalling a walk halfway.
        assertEquals(Guardian.Action.EAT, new Guardian().check(with(20, 13, true)).action());
    }

    @Test
    void doesNotAskForFoodItDoesNotHave() {
        assertFalse(new Guardian().check(with(20, 2, false)).interrupts());
    }

    @Test
    void tellsSuddenDamageApartFromMerelyBeingHurt() {
        // Sitting at fourteen hearts is fine. Arriving at fourteen hearts from
        // twenty in half a second is an attack in progress.
        Guardian steady = new Guardian();
        for (int tick = 0; tick < 40; tick++) steady.check(with(14, 20, true));
        assertFalse(steady.check(with(14, 20, true)).interrupts(),
                "a stable fourteen hearts is not an emergency");

        Guardian attacked = new Guardian();
        attacked.check(with(20, 20, true));
        Guardian.Verdict verdict = attacked.check(with(14, 20, true));
        assertEquals(Guardian.Action.FLEE, verdict.action());
        assertTrue(verdict.reason().contains("fast"));
    }

    @Test
    void ignoresDistantHostilesAtFullHealth() {
        Vitals watched = new Vitals(20, 20, 20, true, 300, 300,
                false, false, false, 0, 2, 20);
        assertFalse(new Guardian().check(watched).interrupts());
    }

    @Test
    void handsAHostileToTheCombatLayerRatherThanFleeing() {
        // The old rule was "stop when hurt, otherwise carry on regardless",
        // which meant a skeleton at full health was ignored until it had done
        // half the health bar, and then answered by standing still. Whether
        // this fight is worth having is Combat's question now; the Guardian's
        // job is only to say that there is one.
        Vitals close = new Vitals(20, 20, 20, true, 300, 300,
                false, false, false, 0, 1, 3);
        assertEquals(Guardian.Action.FIGHT, new Guardian().check(close).action());

        Vitals closeAndHurt = new Vitals(10, 20, 20, true, 300, 300,
                false, false, false, 0, 1, 3);
        assertEquals(Guardian.Action.FIGHT, new Guardian().check(closeAndHurt).action(),
                "being hurt is a reason to fight well, not a reason to freeze");
    }

    @Test
    void nearDeathWithNothingAttackingStillStops() {
        // The abort rule has to survive the combat layer being in front of it:
        // three hearts and nothing in sight is a walk home, not a fight.
        Vitals dying = new Vitals(4, 20, 20, true, 300, 300,
                false, false, false, 0, 0, 999);
        assertEquals(Guardian.Action.ABORT, new Guardian().check(dying).action());
    }

    @Test
    void resetForgetsTheDamageHistory() {
        Guardian guardian = new Guardian();
        guardian.check(with(20, 20, true));
        guardian.reset();
        assertEquals(0, guardian.damageInWindow());
    }

    @Test
    void aDistantThingShootingAtYouIsStillAFight() {
        // The distance gate alone said a skeleton at fifteen blocks was not a
        // situation, so the mod stood in the open being shot and carried on
        // mining. Losing health with something in sight is a fight wherever it
        // is standing.
        Guardian guardian = new Guardian();
        guardian.check(new Vitals(20, 20, 20, true, 300, 300,
                false, false, false, 0, 1, 15));
        Guardian.Verdict shot = guardian.check(new Vitals(16, 20, 20, true, 300, 300,
                false, false, false, 0, 1, 15));
        assertEquals(Guardian.Action.FIGHT, shot.action());
    }

    @Test
    void aDistantThingDoingNothingIsNot() {
        Vitals watched = new Vitals(20, 20, 20, true, 300, 300,
                false, false, false, 0, 1, 15);
        assertFalse(new Guardian().check(watched).interrupts(),
                "stopped work over a skeleton across a cavern");
    }
}
