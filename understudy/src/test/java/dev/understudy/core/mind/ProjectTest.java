package dev.understudy.core.mind;

import dev.understudy.core.mind.Project.Facts;
import dev.understudy.core.mind.Project.Kind;
import dev.understudy.core.mind.Project.Objective;
import dev.understudy.core.mind.Project.Plan;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

class ProjectTest {

    private static Facts with(Map<String, Integer> carried, Set<String> built) {
        return new Facts(carried, built, 15, 0);
    }

    private static Facts empty() {
        return with(Map.of(), Set.of());
    }

    @Test
    @DisplayName("an objective is something you can be handed, not a list of commands")
    void decomposesAGoal() {
        Plan kit = Project.byId("kit");
        assertNotNull(kit);
        Objective first = Project.next(kit, empty());
        assertEquals(Kind.GET, first.kind());
        assertEquals("stone_pickaxe", first.what(),
                "started somewhere other than the tool everything else needs");
    }

    @Test
    @DisplayName("steps someone else already did are stepped over, not repeated")
    void doesNotRedoWhatIsDone() {
        // The property that makes a project usable rather than a script: which
        // step is next is worked out from what is true, so quitting, reloading,
        // wandering off and doing half of it by hand all just work. A project
        // that kept a step counter would build a second house next to the one
        // you built yourself.
        Plan base = Project.byId("base");
        Map<String, Integer> bag = Map.of("stone_pickaxe", 1);
        assertEquals("house", Project.next(base, with(bag, Set.of())).what());
        assertEquals("storage", Project.next(base, with(bag, Set.of("house"))).what());

        // With both up and the bag still full, the next step is putting it
        // away — never building either of them a second time.
        Objective afterBoth = Project.next(base,
                new Facts(bag, Set.of("house", "storage"), 15, 40));
        assertNotNull(afterBoth);
        assertNotEquals(Kind.BUILD, afterBoth.kind(), "built something twice");
    }

    @Test
    @DisplayName("finished means finished")
    void knowsWhenItIsDone() {
        Plan camp = Project.byId("camp");
        Facts done = new Facts(Map.of("torch", 16, "white_bed", 1), Set.of("hut"), 15, 0);
        assertNull(Project.next(camp, done));
        assertTrue(Project.progress(camp, done).get(0).contains("4 of 4"));
    }

    @Test
    @DisplayName("a dark camp is not a finished camp")
    void lightIsAStepLikeAnyOther() {
        Plan camp = Project.byId("camp");
        Facts dark = new Facts(Map.of("torch", 16, "white_bed", 1), Set.of("hut"), 2, 0);
        assertEquals(Kind.LIGHT, Project.next(camp, dark).kind());
    }

    @Test
    @DisplayName("a storage room with everything still in your pockets is a room")
    void sortingCounts() {
        Plan base = Project.byId("base");
        Map<String, Integer> bag = Map.of("stone_pickaxe", 1);
        Facts hoarding = new Facts(bag, Set.of("house", "storage"), 15, 40);
        assertEquals(Kind.SORT, Project.next(base, hoarding).kind());

        // Tidy, lit, both up, pickaxe in hand: there is nothing left to do,
        // and saying so is the whole point of a project having an end.
        Facts tidy = new Facts(bag, Set.of("house", "storage"), 15, 0);
        assertNull(Project.next(base, tidy));
    }

    @Test
    @DisplayName("what is left is one shopping list, not several errands")
    void costsTheWholeThingAtOnce() {
        // The planner costs a list far better than the same items one at a
        // time: the pickaxe, the crafting table and the walk underground get
        // paid for once instead of five times.
        Map<String, Integer> list = Project.shoppingList(Project.byId("kit"), empty());
        assertTrue(list.size() >= 6, "asked for them one at a time");
        assertTrue(list.containsKey("iron_chestplate"));

        Map<String, Integer> partly = new LinkedHashMap<>();
        partly.put("stone_pickaxe", 1);
        partly.put("torch", 64);
        Map<String, Integer> rest = Project.shoppingList(Project.byId("kit"), with(partly, Set.of()));
        assertFalse(rest.containsKey("stone_pickaxe"), "shopped for what it already had");
        assertFalse(rest.containsKey("torch"));
    }

    @Test
    @DisplayName("every project can be finished, and every step says why it is there")
    void everyProjectIsHonest() {
        for (Plan plan : Project.all()) {
            assertFalse(plan.objectives().isEmpty(), plan.id() + " is a project with no steps");
            assertNotNull(Project.next(plan, empty()), plan.id() + " is done before it starts");
            for (Objective objective : plan.objectives()) {
                assertFalse(objective.why().isBlank(),
                        plan.id() + " has a step with no stated reason: " + objective.describe());
                assertFalse(objective.describe().isBlank());
                if (objective.kind() == Kind.GET) {
                    assertTrue(objective.count() > 0,
                            plan.id() + " asks for zero " + objective.what());
                }
            }
            // Every project must be reachable: satisfy everything and it ends.
            Map<String, Integer> everything = new LinkedHashMap<>();
            Set<String> everythingBuilt = new java.util.HashSet<>();
            for (Objective objective : plan.objectives()) {
                if (objective.kind() == Kind.GET) {
                    everything.put(objective.what(), objective.count());
                }
                if (objective.kind() == Kind.BUILD) everythingBuilt.add(objective.what());
            }
            assertNull(Project.next(plan, new Facts(everything, everythingBuilt, 15, 0)),
                    plan.id() + " cannot be finished");
        }
    }

    @Test
    @DisplayName("names it does not know are not a crash")
    void unknownProject() {
        assertNull(Project.byId("world_peace"));
        assertTrue(Project.ids().contains("base"));
    }
}
