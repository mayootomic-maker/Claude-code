package dev.understudy.core.adapt;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.StringReader;
import java.io.StringWriter;

import static org.junit.jupiter.api.Assertions.*;

class MeasuredTest {

    @Test
    @DisplayName("an estimate that is wrong stops being wrong")
    void learnsTheRealCost() {
        // The complaint this answers is "it said twelve minutes and took forty".
        // The dig times are the game's own formula; the search times are frankly
        // guesses, and they dominate.
        Measured measured = new Measured();
        double guessed = 10;
        for (int gather = 0; gather < 20; gather++) measured.saw("iron_ore", 400, 10);

        double learned = measured.adjust("iron_ore", guessed);
        assertTrue(learned > 30, "did not believe twenty consistent observations: " + learned);
        assertTrue(learned <= guessed * 4, "believed them past all reason: " + learned);
    }

    @Test
    @DisplayName("one lucky vein is not evidence")
    void oneSampleOnlyNudges() {
        // Finding iron in four seconds because you happened to be standing on
        // it is not evidence that iron takes four seconds.
        Measured measured = new Measured();
        measured.saw("iron_ore", 4, 10);
        double after = measured.adjust("iron_ore", 40);
        assertTrue(after > 25,
                "one lucky gather rewrote the estimate: " + after + " from 40");
    }

    @Test
    @DisplayName("confidence grows with evidence")
    void believesMoreAsItSeesMore() {
        Measured one = new Measured();
        one.saw("coal", 100, 10);
        Measured many = new Measured();
        for (int i = 0; i < 20; i++) many.saw("coal", 100, 10);

        double guessed = 2;
        assertTrue(many.adjust("coal", guessed) > one.adjust("coal", guessed),
                "twenty observations were worth no more than one");
    }

    @Test
    @DisplayName("never adjusts past all reason, in either direction")
    void staysBounded() {
        Measured absurd = new Measured();
        for (int i = 0; i < 500; i++) absurd.saw("dirt", 10_000, 1);
        assertTrue(absurd.adjust("dirt", 1) <= 4.0,
                "a world where dirt is slow is not a world where four dirt take an hour");

        Measured freebie = new Measured();
        for (int i = 0; i < 500; i++) freebie.saw("diamond", 0.6, 64);
        assertTrue(freebie.adjust("diamond", 100) >= 25);
    }

    @Test
    @DisplayName("a gather that measured nothing is not recorded")
    void ignoresTheMeaningless() {
        // It was already in the bag, or the step was skipped. Neither is a
        // measurement of how long the thing takes.
        Measured measured = new Measured();
        measured.saw("iron_ore", 0.1, 10);
        measured.saw("iron_ore", 30, 0);
        assertFalse(measured.knows("iron_ore"));
        assertEquals(40, measured.adjust("iron_ore", 40), 0.001);
    }

    @Test
    @DisplayName("what it knows survives the game closing")
    void roundTrips() throws Exception {
        Measured before = new Measured();
        for (int i = 0; i < 7; i++) before.saw("iron_ore", 300, 10);
        before.saw("coal", 60, 20);

        StringWriter out = new StringWriter();
        before.write(out);
        Measured after = new Measured();
        assertEquals(2, after.read(new StringReader(out.toString())));
        assertEquals(before.adjust("iron_ore", 10), after.adjust("iron_ore", 10), 0.001);
        assertEquals(7, after.of("iron_ore").samples(), "forgot how sure it was");
    }

    @Test
    @DisplayName("knowing nothing changes nothing")
    void theEmptyOneIsHarmless() {
        assertEquals(12.5, Measured.NOTHING.adjust("anything", 12.5), 0.001);
        assertFalse(Measured.NOTHING.knows("anything"));
        assertTrue(Measured.NOTHING.summary().get(0).contains("nothing measured"));
    }

    @Test
    @DisplayName("nonsense in the file costs one item, not the file")
    void survivesABadLine() throws Exception {
        Measured measured = new Measured();
        int taken = measured.read(new StringReader(
                "understudy-measured 1\niron_ore 30.0 4\ncoal not a number\ndiamond 90.0 2\n"));
        assertEquals(2, taken);
        assertTrue(measured.knows("diamond"));
    }
}
