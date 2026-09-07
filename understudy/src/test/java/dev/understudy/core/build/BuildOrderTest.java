package dev.understudy.core.build;

import dev.understudy.core.build.Blueprint.Placement;
import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * How far the builder walks, measured off the order rather than guessed at.
 *
 * The order was hopping corner to corner for months and no test noticed,
 * because every test asked whether the blocks were right and none asked what
 * route they made. From the outside that was the whole complaint — it looked
 * stupid and it took forever — and it was invisible from the inside.
 *
 * So the route is a property now. The numbers are ceilings a good order clears
 * comfortably rather than a snapshot of today's: they are there to catch an
 * order that goes back to crossing the building, not to freeze this one.
 */
class BuildOrderTest {

    private static final Materials.Wood OAK = Materials.woodNamed("oak");
    private static final Materials.Stone BRICK = Materials.stoneNamed("stone brick");

    /** Beyond this the builder cannot reach and has to walk. */
    private static final double REACH = 4.0;

    private static Blueprint design(String id, int size) {
        return Catalog.build(id, size, OAK, BRICK);
    }

    private static double stepsOver(List<Placement> order, double limit) {
        int over = 0;
        for (int i = 1; i < order.size(); i++) {
            if (gap(order.get(i - 1), order.get(i)) > limit) over++;
        }
        return over;
    }

    private static double gap(Placement a, Placement b) {
        double dx = a.x() - b.x();
        double dy = a.y() - b.y();
        double dz = a.z() - b.z();
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    private static double averageStep(List<Placement> order) {
        double total = 0;
        for (int i = 1; i < order.size(); i++) total += gap(order.get(i - 1), order.get(i));
        return total / Math.max(1, order.size() - 1);
    }

    @Test
    void oneBlockIsUsuallyNextToTheLast() {
        for (String id : Catalog.ids()) {
            Blueprint plan = design(id, Catalog.byId(id).defaultSize());
            double average = averageStep(plan.buildOrder());
            assertTrue(average < 4.0,
                    id + " averages " + String.format("%.1f", average)
                            + " blocks between one placement and the next, which means"
                            + " it is walking between most of them");
        }
    }

    /**
     * The one that actually costs time. A step within reach is a step sideways;
     * a step beyond it is a route to find and a route to walk, and on the old
     * order two thirds of them were the second kind.
     */
    @Test
    void mostPlacementsNeedNoWalkAtAll() {
        for (String id : Catalog.ids()) {
            Blueprint plan = design(id, Catalog.byId(id).defaultSize());
            List<Placement> order = plan.buildOrder();
            double walks = stepsOver(order, REACH);
            assertTrue(walks < order.size() * 0.25,
                    id + " needs " + (int) walks + " walks for " + order.size()
                            + " blocks; it should be a small fraction of them");
        }
    }

    @Test
    void aCourseIsFinishedBeforeTheOneAboveItIsStarted() {
        Blueprint plan = design("house", 9);
        int highestSoFar = Integer.MIN_VALUE;
        Set<Integer> done = new HashSet<>();
        for (Placement p : plan.buildOrder()) {
            if (p.y() != highestSoFar) {
                assertTrue(done.add(p.y()), "came back to layer " + p.y() + " after leaving it");
                highestSoFar = p.y();
            }
        }
    }

    @Test
    void everyBlockIsPlacedExactlyOnce() {
        for (String id : Catalog.ids()) {
            Blueprint plan = design(id, Catalog.byId(id).defaultSize());
            List<Placement> order = plan.buildOrder();
            assertEquals(plan.placements().size(), order.size(), id);
            Set<String> seen = new HashSet<>();
            for (Placement p : order) {
                assertTrue(seen.add(p.x() + "," + p.y() + "," + p.z()),
                        id + " places " + p.x() + "," + p.y() + "," + p.z() + " twice");
            }
        }
    }
}
