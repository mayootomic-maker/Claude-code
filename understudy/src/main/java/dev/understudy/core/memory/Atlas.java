package dev.understudy.core.memory;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Everywhere it has ever seen anything.
 *
 * This is the one place the mod can be plainly better than a person rather than
 * merely tireless. A player walking to a village passes a dozen coal seams, an
 * iron vein in a cliff face and three cave mouths, and by the time they want
 * coal they remember roughly one of them and roughly where. The gatherer
 * already looks at a third of a million blocks every scan and then throws all
 * of it away except the single block it wanted. Writing it down instead costs
 * almost nothing and means "go and get iron" starts from fourteen known veins
 * rather than from a strip mine.
 *
 * It is deliberately a memory rather than an index of the world: things are
 * remembered as *seen at a time*, they go stale, and a sighting that turns out
 * to be wrong is removed when it is walked to and found gone. A confident,
 * permanently wrong map would be worse than none.
 *
 * Bounded, because a session is long and a scan is enormous. When it is full
 * the oldest sightings go, which is also roughly the right answer for accuracy:
 * an ore seen an hour ago is more likely to have been mined by someone than one
 * seen a minute ago.
 */
public final class Atlas {

    /**
     * What a remembered spot of trouble is filed under.
     *
     * A sighting like any other, which is the point: the atlas is already the
     * thing that knows where everything was, and where a fight went badly is a
     * fact about a place in exactly the same way a vein of iron is. Filing it
     * separately would have meant a second memory that ages differently and
     * gets saved differently for no reason.
     */
    public static final String TROUBLE = "trouble";

    /** What was seen, where, and when — the tick is the client's own count. */
    public record Sighting(String what, int x, int y, int z, long tick) {
        public double distanceTo(int fromX, int fromY, int fromZ) {
            double dx = x - fromX;
            double dy = y - fromY;
            double dz = z - fromZ;
            return Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
    }

    /**
     * Room for a great many sightings and still a bound.
     *
     * A hundred thousand blocks is a few megabytes and several hours of
     * playing. Unbounded would be fine right up until the session where it is
     * not, and then it would be a memory leak in a mod that runs for hours.
     */
    public static final int CAPACITY = 100_000;

    /** Position to sighting, so seeing the same vein twice is one entry. */
    private final Map<Long, Sighting> byPlace = new LinkedHashMap<>();
    /** Name to positions, so "where is iron" does not scan everything. */
    private final Map<String, List<Long>> byWhat = new HashMap<>();

    public void saw(String what, int x, int y, int z, long tick) {
        long key = key(x, y, z);
        Sighting existing = byPlace.get(key);
        if (existing != null) {
            if (!existing.what().equals(what)) forget(x, y, z);
            else {
                // Seen again: refresh the age without disturbing the ordering
                // any more than it has to.
                byPlace.put(key, new Sighting(what, x, y, z, tick));
                return;
            }
        }
        byPlace.put(key, new Sighting(what, x, y, z, tick));
        byWhat.computeIfAbsent(what, name -> new ArrayList<>()).add(key);
        if (byPlace.size() > CAPACITY) evictOldest();
    }

    /**
     * The nearest thing of this kind that is still believed to be there.
     *
     * Nearest by straight line, which is not the same as nearest to walk to —
     * but the walk is the pathfinder's job and asking it about fourteen
     * candidates to pick one would cost more than the walk it saved.
     */
    public Sighting nearest(String what, int fromX, int fromY, int fromZ) {
        return known(what).stream()
                .min(Comparator.comparingDouble(s -> s.distanceTo(fromX, fromY, fromZ)))
                .orElse(null);
    }

    /**
     * Whether something went wrong near here, recently enough to matter.
     *
     * Recency is the whole of it. A creeper went off here an hour ago is not a
     * reason to avoid a place — whatever it was is long dead and the hole has
     * probably been walked through since. Twenty minutes ago is a different
     * matter, and a spawner is a place that keeps being trouble, which is
     * exactly what several sightings in one spot means.
     */
    public boolean troubleNear(int x, int y, int z, double within, long now, long staleAfter) {
        for (Sighting sighting : known(TROUBLE)) {
            if (now - sighting.tick() > staleAfter) continue;
            if (sighting.distanceTo(x, y, z) <= within) return true;
        }
        return false;
    }

    public List<Sighting> known(String what) {
        List<Sighting> out = new ArrayList<>();
        for (Long key : byWhat.getOrDefault(what, List.of())) {
            Sighting sighting = byPlace.get(key);
            if (sighting != null && sighting.what().equals(what)) out.add(sighting);
        }
        return out;
    }

    /**
     * It is not there any more.
     *
     * Called when something is mined, and — just as importantly — when the
     * gatherer walks to a remembered spot and finds nothing. A map that only
     * ever gains entries slowly becomes a map of where things used to be.
     */
    public void forget(int x, int y, int z) {
        Sighting gone = byPlace.remove(key(x, y, z));
        if (gone == null) return;
        List<Long> places = byWhat.get(gone.what());
        if (places != null) {
            places.remove(key(x, y, z));
            if (places.isEmpty()) byWhat.remove(gone.what());
        }
    }

    public int size() {
        return byPlace.size();
    }

    /**
     * Everything, oldest first.
     *
     * Order matters here rather than being incidental: it is the order the
     * eviction rule uses, so writing it out and reading it back has to preserve
     * which sightings are the old ones. A memory that comes back from disk with
     * its ages shuffled forgets the wrong things for the rest of the session.
     */
    public List<Sighting> all() {
        return new ArrayList<>(byPlace.values());
    }

    /** Every kind of thing remembered, with how many of each. */
    public Map<String, Integer> summary() {
        Map<String, Integer> out = new LinkedHashMap<>();
        for (Sighting sighting : byPlace.values()) {
            out.merge(sighting.what(), 1, Integer::sum);
        }
        return out;
    }

    public void clear() {
        byPlace.clear();
        byWhat.clear();
    }

    private void evictOldest() {
        // LinkedHashMap keeps insertion order, and insertion order is age here,
        // so the first key is the oldest. Refreshing a sighting replaces the
        // value in place and deliberately does not move it: something seen
        // repeatedly is not thereby newer than something seen once recently.
        Long oldest = byPlace.keySet().iterator().next();
        Sighting gone = byPlace.get(oldest);
        if (gone != null) forget(gone.x(), gone.y(), gone.z());
    }

    private static long key(int x, int y, int z) {
        return ((long) (x & 0x3FFFFFF) << 38) | ((long) (z & 0x3FFFFFF) << 12) | (y & 0xFFF);
    }
}
