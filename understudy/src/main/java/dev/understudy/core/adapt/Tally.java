package dev.understudy.core.adapt;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A count that forgets.
 *
 * Every observation adds weight; periodically all weights are scaled down. That
 * decay is the whole point of the class. A plain counter of "blocks you have
 * mined" describes the first week you played and never changes after that — the
 * mod would keep adapting to a version of you from months ago. With decay, what
 * you did yesterday outweighs what you did in January, and the profile tracks
 * you as you change rather than averaging over everything you have ever done.
 */
public final class Tally {
    /**
     * Weights are scaled by DECAY every INTERVAL observations, giving a
     * half-life of about 200 observations.
     *
     * The number matters more than it looks. Too slow and the thing is not
     * adaptive at all — at a half-life of a few thousand placements it takes
     * most of a world's lifetime to notice you switched from stone to wood,
     * which is indistinguishable from a plain counter. Too fast and it chases
     * noise, reorganising your palette because you happened to place a few
     * blocks of dirt to climb a hill. Two hundred is roughly "the last session
     * or two", which is what "how I play now" actually means.
     */
    private static final double DECAY = 0.84;
    private static final int INTERVAL = 50;
    /** Below this a name is dropped, so the map cannot grow without bound. */
    private static final double FLOOR = 0.01;

    private final Map<String, Double> weights = new LinkedHashMap<>();
    private int since;
    private double total;

    public void add(String name, double amount) {
        if (name == null || name.isEmpty() || amount <= 0) return;
        weights.merge(name, amount, Double::sum);
        total += amount;
        if (++since >= INTERVAL) {
            since = 0;
            decay();
        }
    }

    public void add(String name) {
        add(name, 1);
    }

    private void decay() {
        total = 0;
        weights.entrySet().removeIf(entry -> entry.getValue() * DECAY < FLOOR);
        for (Map.Entry<String, Double> entry : weights.entrySet()) {
            double scaled = entry.getValue() * DECAY;
            entry.setValue(scaled);
            total += scaled;
        }
    }

    public double weight(String name) {
        return weights.getOrDefault(name, 0.0);
    }

    /** Weight as a fraction of everything tallied, 0 when nothing is known. */
    public double share(String name) {
        return total <= 0 ? 0 : weight(name) / total;
    }

    public double total() {
        return total;
    }

    public boolean isEmpty() {
        return weights.isEmpty();
    }

    /** The heaviest names, most-used first. */
    public List<String> top(int limit) {
        List<Map.Entry<String, Double>> entries = new ArrayList<>(weights.entrySet());
        entries.sort(Comparator.<Map.Entry<String, Double>>comparingDouble(Map.Entry::getValue).reversed());
        List<String> out = new ArrayList<>(Math.min(limit, entries.size()));
        for (int i = 0; i < entries.size() && i < limit; i++) out.add(entries.get(i).getKey());
        return out;
    }

    /** The heaviest name, or null when nothing has been seen. */
    public String favourite() {
        String best = null;
        double bestWeight = 0;
        for (Map.Entry<String, Double> entry : weights.entrySet()) {
            if (entry.getValue() > bestWeight) {
                bestWeight = entry.getValue();
                best = entry.getKey();
            }
        }
        return best;
    }

    public Map<String, Double> snapshot() {
        return new LinkedHashMap<>(weights);
    }

    public void restore(Map<String, Double> saved) {
        weights.clear();
        total = 0;
        if (saved == null) return;
        for (Map.Entry<String, Double> entry : saved.entrySet()) {
            if (entry.getValue() == null || entry.getValue() <= 0) continue;
            weights.put(entry.getKey(), entry.getValue());
            total += entry.getValue();
        }
    }
}
