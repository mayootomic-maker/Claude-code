package dev.understudy.human;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * These run without Minecraft, which is the point: the parts of the mod that
 * are pure logic should be testable without a game to put them in.
 */
class RngTest {

    @Test
    @DisplayName("is uniform enough to build distributions on")
    void uniform() {
        Rng rng = new Rng("uniformity");
        int[] buckets = new int[10];
        int n = 200_000;
        for (int i = 0; i < n; i++) {
            double v = rng.next();
            assertTrue(v >= 0 && v < 1, "out of range: " + v);
            buckets[(int) (v * 10)]++;
        }
        for (int count : buckets) {
            assertTrue(Math.abs(count - n / 10.0) / (n / 10.0) < 0.05, "skewed bucket: " + count);
        }
    }

    @Test
    @DisplayName("gives unrelated streams to adjacent seeds")
    void decorrelated() {
        Rng a = new Rng("player1");
        Rng b = new Rng("player2");
        int agreements = 0;
        for (int i = 0; i < 1000; i++) {
            if (Math.abs(a.next() - b.next()) < 0.01) agreements++;
        }
        assertTrue(agreements < 60, "streams look correlated: " + agreements);
    }

    @Test
    @DisplayName("is reproducible from a seed")
    void reproducible() {
        assertEquals(draw(), draw());
    }

    private static String draw() {
        Rng rng = new Rng("repeat");
        return rng.next() + "|" + rng.normal(0, 1) + "|" + rng.logNormal(1, 0.3);
    }

    @Test
    @DisplayName("produces right-skewed latencies, never impossibly fast ones")
    void skew() {
        Rng rng = new Rng("latency");
        int n = 20_000;
        double[] samples = new double[n];
        double sum = 0;
        for (int i = 0; i < n; i++) {
            samples[i] = rng.logNormal(0.25, 0.35);
            sum += samples[i];
        }
        java.util.Arrays.sort(samples);
        double mean = sum / n;
        double median = samples[n / 2];
        // The defining property of a right-skewed distribution.
        assertTrue(mean > median, "not right-skewed: mean " + mean + " median " + median);
        assertTrue(samples[0] > 0.05, "impossibly fast sample: " + samples[0]);
    }

    @Test
    @DisplayName("clamps latency into a plausible window")
    void clamped() {
        Rng rng = new Rng("clamp");
        for (int i = 0; i < 10_000; i++) {
            double v = rng.latency(0.25, 0.5, 0.1, 2.0);
            assertTrue(v >= 0.1 && v <= 2.0, "outside window: " + v);
        }
    }
}
