package dev.understudy.core.mind;

import dev.understudy.core.mind.Agenda.Act;
import dev.understudy.core.mind.Agenda.Job;
import dev.understudy.core.mind.Agenda.Situation;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class AgendaTest {

    private final Agenda agenda = new Agenda();

    /** A comfortable situation with nothing wrong, to vary one thing at a time. */
    private static Situation fine(Job job) {
        return new Situation(20, 20, 0, 20, true, 15, true, 20, 0, Map.of(), job);
    }

    @Test
    @DisplayName("the whole complaint in one case: hurt, dark, full, and still mining")
    void doesNotCarryOnRegardless() {
        // This is what "extremely stupid" looked like. Every one of these was
        // true at once and the old answer was "keep mining", because nothing
        // ever asked.
        Situation bad = new Situation(3, 20, 0, 4, true, 0, true, 0, 2,
                Map.of("iron_pickaxe", 1), Job.of("mine iron"));
        assertNotEquals(Act.WORK, agenda.next(bad).act());
    }

    @Test
    @DisplayName("what is urgent beats what is valuable")
    void urgencyBeatsWorth() {
        // Being on fire is less bad than being bored and far more urgent. Each
        // of these situations has a perfectly good job waiting, and none of
        // them is the answer.
        Situation attacked = new Situation(18, 20, 5, 20, true, 15, true, 20, 1,
                Map.of(), Job.of("build"));
        assertEquals(Act.RETREAT, agenda.next(attacked).act(), "carried on while being hit");

        Situation starving = new Situation(20, 20, 0, 3, true, 15, true, 20, 0,
                Map.of(), Job.of("build"));
        assertEquals(Act.EAT, agenda.next(starving).act());

        Situation dark = new Situation(20, 20, 0, 20, true, 2, true, 20, 0,
                Map.of(), Job.of("build"));
        assertEquals(Act.LIGHT, agenda.next(dark).act());

        Situation full = new Situation(20, 20, 0, 20, true, 15, true, 1, 0,
                Map.of(), Job.of("build"));
        assertEquals(Act.UNLOAD, agenda.next(full).act());
    }

    @Test
    @DisplayName("hurt with no food retreats rather than eating air")
    void retreatsWhenItCannotHeal() {
        Situation bleeding = new Situation(4, 20, 0, 20, false, 15, true, 20, 0,
                Map.of(), Job.of("build"));
        assertEquals(Act.RETREAT, agenda.next(bleeding).act());
        assertTrue(agenda.next(bleeding).because().contains("nothing to eat"));
    }

    @Test
    @DisplayName("a dark spot with no torch is not a reason to stand still")
    void doesNotStallOnSomethingItCannotFix() {
        // The failure mode of a rule engine: an unfixable condition that keeps
        // winning the priority contest and nothing ever happens again.
        Situation lightless = new Situation(20, 20, 0, 20, true, 0, false, 20, 0,
                Map.of(), Job.of("build"));
        assertEquals(Act.WORK, agenda.next(lightless).act());

        Situation hungryWithNothing = new Situation(20, 20, 0, 2, false, 15, true, 20, 0,
                Map.of(), Job.of("build"));
        assertEquals(Act.WORK, agenda.next(hungryWithNothing).act());
    }

    @Test
    @DisplayName("gets the tool before the job that needs it")
    void equipsFirst() {
        Job mining = new Job("mine iron", List.of("stone_pickaxe"), List.of());
        assertEquals(Act.EQUIP, agenda.next(fine(mining)).act());
        assertEquals("stone_pickaxe", agenda.next(fine(mining)).detail());

        Situation armed = new Situation(20, 20, 0, 20, true, 15, true, 20, 0,
                Map.of("stone_pickaxe", 1), mining);
        assertEquals(Act.WORK, agenda.next(armed).act());
    }

    @Test
    @DisplayName("fetches a missing material before working")
    void fetchesFirst() {
        Job building = new Job("build a house", List.of(), List.of("oak_planks"));
        assertEquals(Act.FETCH, agenda.next(fine(building)).act());
        assertEquals("oak_planks", agenda.next(fine(building)).detail());
    }

    @Test
    @DisplayName("idle is a decision, not an accident")
    void idleWithNoJob() {
        assertEquals(Act.IDLE, agenda.next(fine(null)).act());
    }

    @Test
    @DisplayName("every decision explains itself")
    void alwaysGivesAReason() {
        // A decision you cannot interrogate is indistinguishable from a bug,
        // and this is the thing the player reads when it does something odd.
        List<Situation> all = List.of(
                fine(null),
                fine(Job.of("build")),
                new Situation(2, 20, 0, 20, true, 15, true, 20, 3, Map.of(), Job.of("build")),
                new Situation(20, 20, 0, 2, true, 15, true, 20, 0, Map.of(), Job.of("build")),
                new Situation(20, 20, 0, 20, true, 0, true, 20, 0, Map.of(), Job.of("build")),
                new Situation(20, 20, 0, 20, true, 15, true, 0, 0, Map.of(), Job.of("build")));
        for (Situation situation : all) {
            Agenda.Decision decision = agenda.next(situation);
            assertNotNull(decision.because());
            assertFalse(decision.because().isBlank(), "decided " + decision.act() + " for no stated reason");
            assertTrue(agenda.reasoning(situation).size() >= 6);
        }
    }
}
