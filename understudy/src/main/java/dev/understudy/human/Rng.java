package dev.understudy.human;

/**
 * Seeded randomness, and the distributions the humanised timing is built on.
 *
 * Deterministic from a seed on purpose. A character whose reaction times
 * resample on every launch is a different person each session, which is exactly
 * the thing this layer exists to avoid.
 *
 * xoshiro128** rather than a bare LCG: small, fast, and well enough distributed
 * that the distributions built on top of it mean what they say.
 */
public final class Rng {
    private int s0;
    private int s1;
    private int s2;
    private int s3;

    public Rng(String seed) {
        this(hash(seed));
    }

    public Rng(int seed) {
        // splitmix32 the seed out into four words, so that adjacent seeds
        // ("bot1", "bot2") give unrelated streams rather than correlated ones.
        int h = seed;
        this.s0 = mix(h += 0x9e3779b9);
        this.s1 = mix(h += 0x9e3779b9);
        this.s2 = mix(h += 0x9e3779b9);
        this.s3 = mix(h + 0x9e3779b9);
    }

    private static int mix(int z) {
        z = (z ^ (z >>> 16)) * 0x21f0aaad;
        z = (z ^ (z >>> 15)) * 0x735a2d97;
        return z ^ (z >>> 15);
    }

    public static int hash(String value) {
        int h = 0x811c9dc5;
        for (int i = 0; i < value.length(); i++) {
            h ^= value.charAt(i);
            h *= 0x01000193;
        }
        return h;
    }

    private int nextInt() {
        int result = Integer.rotateLeft(s1 * 5, 7) * 9;
        int t = s1 << 9;
        s2 ^= s0;
        s3 ^= s1;
        s1 ^= s2;
        s0 ^= s3;
        s2 ^= t;
        s3 = Integer.rotateLeft(s3, 11);
        return result;
    }

    /** Uniform in [0, 1). */
    public double next() {
        return (nextInt() >>> 8) / (double) (1 << 24);
    }

    public double range(double min, double max) {
        return min + next() * (max - min);
    }

    public int intRange(int min, int max) {
        return min + (int) Math.floor(next() * (max - min + 1));
    }

    public boolean chance(double p) {
        return next() < p;
    }

    /** Standard normal, by Box-Muller. */
    public double normal(double mean, double stdDev) {
        double u = 1.0 - next();
        double v = next();
        return mean + stdDev * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }

    /**
     * Log-normal. Human reaction and decision latencies are right-skewed: most
     * cluster near a floor with a long tail of "I was looking at something
     * else". A symmetric normal would produce impossibly fast outliers as often
     * as slow ones, and the fast ones are what read as machine.
     */
    public double logNormal(double median, double sigma) {
        return median * Math.exp(normal(0, sigma));
    }

    public double latency(double median, double sigma, double min, double max) {
        return clamp(logNormal(median, sigma), min, max);
    }

    public static double clamp(double value, double min, double max) {
        return value < min ? min : Math.min(value, max);
    }
}
