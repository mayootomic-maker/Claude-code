package dev.understudy.core.survive;

import dev.understudy.core.survive.Combat.Foe;
import dev.understudy.core.survive.Combat.Stance;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class CombatTest {

    private static final double CHARGED = 1.0;
    private static final double SWORD = Combat.dpsOf("iron_sword");

    private static Foe at(String kind, double distance) {
        return new Foe(kind, distance, false, true);
    }

    @Test
    @DisplayName("the whole complaint: one zombie no longer ends the job")
    void fightsRatherThanStopping() {
        // This was the entire combat model before: any hostile, any distance,
        // stop and hand back the controls. An hour of unattended work lost to
        // one zombie that was never going to win.
        Combat.Plan plan = Combat.decide(List.of(at("zombie", 2)), 1.0, SWORD, CHARGED, 0);
        assertEquals(Stance.STRIKE, plan.stance());
    }

    @Test
    @DisplayName("does not run from what it cannot outrun")
    void staysAndFightsWhatIsFaster() {
        // The rule that most changes the answer. Fleeing a zombie is safe;
        // fleeing a spider is being bitten in the back until you die tired.
        Combat.Plan spider = Combat.decide(List.of(at("spider", 2)), 0.2, SWORD, CHARGED, 4);
        assertNotEquals(Stance.FLEE, spider.stance(), "ran from a spider at two hearts");

        Combat.Plan zombie = Combat.decide(List.of(at("zombie", 2)), 0.2, SWORD, CHARGED, 4);
        assertEquals(Stance.FLEE, zombie.stance(), "stood and fought at two hearts with a way out");
    }

    @Test
    @DisplayName("never walks into a creeper")
    void creepersAreTheirOwnRulebook() {
        // Inside the blast, the only right answer is backwards.
        assertEquals(Stance.BACK_OFF,
                Combat.decide(List.of(at("creeper", 1.5)), 1.0, SWORD, CHARGED, 0).stance());

        // And it never closes the last block: it waits for the creeper to come
        // to the edge of reach instead of walking into the fuse.
        assertEquals(Stance.HOLD,
                Combat.decide(List.of(at("creeper", 6)), 1.0, SWORD, CHARGED, 0).stance());

        // At arm's length with a charged swing it hits, because a hit knocks it
        // back and resets the fuse.
        assertEquals(Stance.STRIKE,
                Combat.decide(List.of(at("creeper", 2.9)), 1.0, SWORD, CHARGED, 0).stance());

        // An uncharged swing at that range is not worth standing there for.
        assertEquals(Stance.BACK_OFF,
                Combat.decide(List.of(at("creeper", 2.9)), 1.0, SWORD, 0.3, 0).stance());
    }

    @Test
    @DisplayName("a creeper outranks whatever else is closer")
    void creeperFirst() {
        Combat.Plan plan = Combat.decide(
                List.of(at("zombie", 2), at("creeper", 4)), 1.0, SWORD, CHARGED, 0);
        assertEquals("creeper", plan.kind(), "swung at the zombie with a creeper behind it");
    }

    @Test
    @DisplayName("never swings until the swing is charged")
    void waitsForTheCooldown() {
        Combat.Plan plan = Combat.decide(List.of(at("zombie", 2)), 1.0, SWORD, 0.5, 0);
        assertEquals(Stance.HOLD, plan.stance(),
                "spam-clicked: a half-charged hit is half a hit and no sweep");
    }

    @Test
    @DisplayName("leaves alone what is not attacking")
    void doesNotStartFights() {
        // An enderman minding its own business is not a fight; it is a fight
        // you lose by looking at it.
        Foe idle = new Foe("enderman", 5, false, false);
        assertEquals(Stance.IGNORE, Combat.decide(List.of(idle), 1.0, SWORD, CHARGED, 0).stance());

        Foe angry = new Foe("enderman", 5, false, true);
        assertNotEquals(Stance.IGNORE,
                Combat.decide(List.of(angry), 1.0, SWORD, CHARGED, 0).stance());
    }

    @Test
    @DisplayName("knows the fights it cannot win")
    void runsFromWhatItCannotBeat() {
        for (String hopeless : List.of("warden", "ravager", "elder_guardian")) {
            assertEquals(Stance.FLEE,
                    Combat.decide(List.of(at(hopeless, 3)), 1.0,
                            Combat.dpsOf("netherite_sword"), CHARGED, 0).stance(),
                    "picked a fight with a " + hopeless);
        }
    }

    @Test
    @DisplayName("three at once is not a fight either")
    void doesNotTakeOnACrowd() {
        List<Foe> mob = List.of(at("zombie", 2), at("zombie", 3), at("skeleton", 5),
                at("zombie", 6));
        assertEquals(Stance.FLEE, Combat.decide(mob, 1.0, SWORD, CHARGED, 0).stance());
    }

    @Test
    @DisplayName("unarmed at full health, it walks away")
    void doesNotPunchThingsForNoReason() {
        assertEquals(Stance.FLEE,
                Combat.decide(List.of(at("zombie", 3)), 1.0, 1.0, CHARGED, 0).stance());
        // Unless it is already being hit, at which point running is not on offer.
        assertNotEquals(Stance.FLEE,
                Combat.decide(List.of(at("zombie", 3)), 1.0, 1.0, CHARGED, 4).stance());
    }

    @Test
    @DisplayName("picks a weapon by damage per second, not by damage")
    void swordsBeatAxes() {
        // The tooltip says the axe hits harder, and it does. It also swings at
        // five eighths of the speed, and against anything unarmoured that is
        // the number that decides the fight.
        assertTrue(Combat.dpsOf("diamond_sword") > Combat.dpsOf("diamond_axe"));

        Map<String, Integer> bag = Map.of("diamond_axe", 1, "diamond_sword", 1,
                "iron_pickaxe", 1, "cooked_beef", 12);
        assertEquals("diamond_sword", Combat.bestWeapon(bag));

        // With no weapon at all the answer is honest rather than a stick.
        assertNull(Combat.bestWeapon(Map.of("cobblestone", 64)));
        assertEquals(1.0, Combat.bestWeaponDps(Map.of("cobblestone", 64)));
    }

    @Test
    @DisplayName("the damage table is the game's own")
    void weaponNumbersAreReal() {
        // Sword damage steps evenly with the material and axe damage does not,
        // which is exactly the sort of thing that gets derived and comes out
        // giving a diamond axe a number the game has never had.
        assertEquals(8.0 * 1.6, Combat.dpsOf("netherite_sword"), 0.001);
        assertEquals(7.0 * 1.6, Combat.dpsOf("diamond_sword"), 0.001);
        assertEquals(5.0 * 1.6, Combat.dpsOf("stone_sword"), 0.001);
        assertEquals(9.0, Combat.dpsOf("diamond_axe"), 0.001);
        assertEquals(9.0, Combat.dpsOf("stone_axe"), 0.001);
        assertEquals(10.0, Combat.dpsOf("netherite_axe"), 0.001);
        assertEquals(5.0 * 1.2, Combat.dpsOf("diamond_pickaxe"), 0.001);
    }

    @Test
    @DisplayName("every decision explains itself")
    void alwaysGivesAReason() {
        List<List<Foe>> situations = List.of(
                List.of(), List.of(at("creeper", 2)), List.of(at("skeleton", 9)),
                List.of(at("warden", 5)), List.of(at("zombie", 1)));
        for (List<Foe> foes : situations) {
            for (double health : new double[]{1.0, 0.5, 0.2}) {
                Combat.Plan plan = Combat.decide(foes, health, SWORD, CHARGED, 0);
                assertNotNull(plan.because());
                assertFalse(plan.because().isBlank(),
                        "decided " + plan.stance() + " for no stated reason");
            }
        }
    }

    @Test
    @DisplayName("a baby of anything is something you cannot outrun")
    void babiesAreFast() {
        // The one case where the kind alone gives the wrong answer, and the one
        // that actually kills people: an adult zombie is outrun by walking, and
        // a baby one is outrun by nobody.
        Foe baby = new Foe("zombie", 2, true, true);
        assertNotEquals(Stance.FLEE, Combat.decide(List.of(baby), 0.2, SWORD, CHARGED, 4).stance(),
                "tried to run from a baby zombie");
    }
}
