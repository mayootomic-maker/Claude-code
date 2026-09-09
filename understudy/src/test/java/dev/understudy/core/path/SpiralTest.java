package dev.understudy.core.path;

import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SpiralTest {

    @Test
    void startsWhereYouAreStanding() {
        int[] first = Spiral.offsets().get(0);
        assertEquals(0, first[0]);
        assertEquals(0, first[1]);
        assertEquals(0, first[2]);
    }

    @Test
    void worksOutwards() {
        // The whole point: a scan in x, y, z order finds the corner of the
        // search box before the block two steps behind you, which is how a
        // gatherer walks sixty blocks past the tree it was standing next to.
        List<int[]> offsets = Spiral.offsets();
        double previous = -1;
        for (int[] offset : offsets) {
            double flat = offset[0] * offset[0] + offset[2] * offset[2];
            if (offset[1] != 0) continue; // only compare within one level
            assertTrue(flat >= previous - 1e-9,
                    "went backwards: " + flat + " after " + previous);
            previous = flat;
        }
    }

    @Test
    void prefersSidewaysToDownwards() {
        // Ten blocks down means digging a shaft; ten to the side means walking.
        List<int[]> offsets = Spiral.offsets();
        int sideways = indexOf(offsets, 8, 0, 0);
        int downwards = indexOf(offsets, 0, -8, 0);
        assertTrue(sideways < downwards,
                "eight across should be reached before eight down");
    }

    @Test
    void hasNoDuplicates() {
        Set<Long> seen = new HashSet<>();
        for (int[] offset : Spiral.offsets()) {
            long key = ((long) (offset[0] + 512) << 40)
                    | ((long) (offset[1] + 512) << 20) | (offset[2] + 512);
            assertTrue(seen.add(key), "duplicate offset");
        }
    }

    @Test
    void staysInsideItsRadius() {
        for (int[] offset : Spiral.build(10, 4)) {
            assertTrue(offset[0] * offset[0] + offset[2] * offset[2] <= 100);
            assertTrue(Math.abs(offset[1]) <= 4);
        }
    }

    private static int indexOf(List<int[]> offsets, int x, int y, int z) {
        for (int i = 0; i < offsets.size(); i++) {
            int[] o = offsets.get(i);
            if (o[0] == x && o[1] == y && o[2] == z) return i;
        }
        return -1;
    }
}
