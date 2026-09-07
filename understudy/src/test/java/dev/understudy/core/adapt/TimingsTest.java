package dev.understudy.core.adapt;

import dev.understudy.core.adapt.Timings.Phase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class TimingsTest {

    @Test
    @DisplayName("answers the question that matters: what took the longest")
    void biggestFirst() {
        // The whole point. "Twenty minutes" is not actionable; "seventeen of
        // them walking" is, and "seventeen of them mining" means there is
        // nothing to fix because that is the game's own speed.
        Timings timings = new Timings();
        for (int i = 0; i < 200; i++) timings.spent(Phase.TRAVELLING);
        for (int i = 0; i < 40; i++) timings.spent(Phase.MINING);
        for (int i = 0; i < 20; i++) timings.spent(Phase.SEARCHING);

        List<String> lines = timings.summary();
        assertTrue(lines.get(1).contains("travelling"), "did not lead with the biggest: " + lines);
        assertTrue(lines.get(1).contains("77%"), lines.get(1));
    }

    @Test
    @DisplayName("seconds, not ticks, because nobody thinks in ticks")
    void reportsSeconds() {
        Timings timings = new Timings();
        for (int i = 0; i < 20; i++) timings.spent(Phase.MINING);
        assertEquals(1.0, timings.secondsIn(Phase.MINING), 0.001);
        assertEquals(20, timings.totalTicks());
    }

    @Test
    @DisplayName("shares add up, so nothing is unaccounted for")
    void sharesSumToOne() {
        Timings timings = new Timings();
        for (Phase phase : Phase.values()) {
            for (int i = 0; i < 7; i++) timings.spent(phase);
        }
        double sum = 0;
        for (Phase phase : Phase.values()) sum += timings.shareOf(phase);
        assertEquals(1.0, sum, 0.0001);
    }

    @Test
    @DisplayName("says so rather than dividing by zero")
    void emptyIsHonest() {
        Timings timings = new Timings();
        assertEquals(0, timings.shareOf(Phase.MINING));
        assertEquals(List.of("nothing timed yet"), timings.summary());
    }
}
