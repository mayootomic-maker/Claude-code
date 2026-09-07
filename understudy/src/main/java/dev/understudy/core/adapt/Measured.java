package dev.understudy.core.adapt;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * How long things actually take, as opposed to how long they were guessed to.
 *
 * Every number the planner reasons with is an estimate written by hand. The dig
 * times are the game's own formula and are right; the *search* times — how long
 * it takes to find a seam of iron, or a cow — are frankly guesses, and they are
 * the numbers that dominate a plan. "About twelve minutes" turning into forty
 * is not a small annoyance: it is the mod being confidently wrong about the one
 * thing you asked it to predict.
 *
 * They are also the numbers the planner *chooses* with. Given two ways to get
 * something it takes the cheaper one, so a source that is slow in this
 * particular world — no cows for four hundred blocks, a biome with no exposed
 * coal — keeps being chosen because the table says it is quick.
 *
 * So it measures. Every gather reports what it really cost, and the estimate
 * moves toward the truth as evidence accumulates. Three properties matter and
 * all three have tests:
 *
 *  - One strange result must not wreck a plan. A vein found in four seconds
 *    because you happened to be standing on it is not evidence that iron takes
 *    four seconds.
 *  - Confidence grows with samples, so the first observation nudges and the
 *    twentieth is believed.
 *  - It is bounded in both directions. A world where something really is ten
 *    times slower is a world where the plan should say so, but not one where
 *    it says an hour and a half for four cobblestone.
 */
public final class Measured {

    /** What has been seen of one item. */
    public record Seen(String item, double secondsPerUnit, int samples) {}

    /**
     * How many observations before the measurement is believed outright.
     *
     * Three, which is few — but the estimates being corrected are guesses, and
     * three real gathers of a thing are worth more than a number somebody wrote
     * from memory.
     */
    private static final double TRUST_AFTER = 3.0;
    /** No plan is ever adjusted by more than this, in either direction. */
    private static final double MOST = 4.0;
    private static final double LEAST = 0.25;
    /** A gather this short measured nothing; it was already in the bag. */
    private static final double TOO_QUICK = 0.5;

    /** The one that knows nothing, for callers that have no history to offer. */
    public static final Measured NOTHING = new Measured();

    private final Map<String, Seen> seen = new LinkedHashMap<>();

    /**
     * Record a real gather.
     *
     * @param seconds wall-clock seconds the whole step took
     * @param units   how many were actually obtained
     */
    public void saw(String item, double seconds, int units) {
        if (units <= 0 || seconds < TOO_QUICK) return;
        double perUnit = seconds / units;
        Seen before = seen.get(item);
        if (before == null) {
            seen.put(item, new Seen(item, perUnit, 1));
            return;
        }
        // A running mean rather than the last value: the point is the shape of
        // this world, not the shape of the last five minutes in it.
        int samples = before.samples() + 1;
        double mean = before.secondsPerUnit() + (perUnit - before.secondsPerUnit()) / samples;
        seen.put(item, new Seen(item, mean, samples));
    }

    public boolean knows(String item) {
        return seen.containsKey(item);
    }

    public Seen of(String item) {
        return seen.get(item);
    }

    public int size() {
        return seen.size();
    }

    public void clear() {
        seen.clear();
    }

    public List<Seen> all() {
        return new ArrayList<>(seen.values());
    }

    /**
     * The estimate, corrected by whatever has been observed.
     *
     * Blended rather than replaced: one gather is a hint and twenty are a fact,
     * and treating the first as the last is how a single lucky vein convinces
     * the planner that iron is free.
     */
    public double adjust(String item, double estimatedPerUnit) {
        Seen record = seen.get(item);
        if (record == null || estimatedPerUnit <= 0) return estimatedPerUnit;

        double trust = record.samples() / (record.samples() + TRUST_AFTER);
        double ratio = record.secondsPerUnit() / estimatedPerUnit;
        double blended = 1 + trust * (ratio - 1);
        return estimatedPerUnit * Math.max(LEAST, Math.min(MOST, blended));
    }

    /** Biggest surprise first — the estimates most worth not trusting. */
    public List<String> summary() {
        List<String> lines = new ArrayList<>();
        if (seen.isEmpty()) {
            lines.add("nothing measured yet — it learns as it gathers");
            return lines;
        }
        seen.values().stream()
                .sorted((a, b) -> Integer.compare(b.samples(), a.samples()))
                .forEach(record -> lines.add(String.format("  %-20s %5.1fs each, %d seen",
                        record.item(), record.secondsPerUnit(), record.samples())));
        return lines;
    }

    private static final String HEADER = "understudy-measured 1";

    public void write(Writer out) throws IOException {
        out.write(HEADER + "\n");
        for (Seen record : seen.values()) {
            out.write(record.item() + " " + record.secondsPerUnit() + " " + record.samples() + "\n");
        }
    }

    /**
     * Read back what was learned, forgivingly.
     *
     * A line that no longer parses costs one item's history, not the file. The
     * worst case for a bad line is an estimate that goes back to being a guess,
     * which is where it started.
     */
    public int read(Reader source) throws IOException {
        BufferedReader lines = new BufferedReader(source);
        String header = lines.readLine();
        if (header == null || !header.startsWith(HEADER)) return 0;
        int taken = 0;
        String line;
        while ((line = lines.readLine()) != null) {
            String[] parts = line.split(" ");
            if (parts.length != 3) continue;
            try {
                seen.put(parts[0], new Seen(parts[0],
                        Double.parseDouble(parts[1]), Integer.parseInt(parts[2])));
                taken++;
            } catch (NumberFormatException malformed) {
                // One unreadable line is one item back to a guess.
            }
        }
        return taken;
    }
}
