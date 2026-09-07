package dev.understudy.core.survive;

import dev.understudy.core.survive.Combat.Fighter;
import dev.understudy.core.survive.Combat.Foe;
import dev.understudy.core.survive.Combat.Ground;
import dev.understudy.core.survive.Combat.Loadout;
import dev.understudy.core.survive.Combat.Stance;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class CombatTest {

    private static final double CHARGED = 1.0;
    private static final double SWORD = Combat.dpsOf("iron_sword");
    /** Healthy, armed with a sword, standing somewhere with room to move. */
    private static final Loadout PLAIN =
            new Loadout(SWORD, false, false, 0, false, 0, 0, false);

    private static Foe at(String kind, double distance) {
        return new Foe(kind, distance, 20, false, true);
    }

    private static Fighter me(double health, Loadout kit) {
        return new Fighter(health, CHARGED, 0, kit, Ground.OPEN);
    }

    private static Fighter me(double health) {
        return me(health, PLAIN);
    }

    private static Stance decide(List<Foe> foes, Fighter me) {
        return Combat.decide(foes, me).stance();
    }

    @Test
    @DisplayName("the whole complaint: one zombie no longer ends the job")
    void fightsRatherThanStopping() {
        assertEquals(Stance.STRIKE, decide(List.of(at("zombie", 2)), me(1.0)));
    }

    @Test
    @DisplayName("does not run from what it cannot outrun")
    void staysAndFightsWhatIsFaster() {
        // Fleeing a zombie is safe; fleeing a spider is dying tired.
        assertNotEquals(Stance.FLEE,
                decide(List.of(at("spider", 2)), new Fighter(0.2, CHARGED, 4, PLAIN, Ground.OPEN)),
                "ran from a spider at two hearts");
        assertEquals(Stance.FLEE,
                decide(List.of(at("zombie", 2)), new Fighter(0.2, CHARGED, 4, PLAIN, Ground.OPEN)));
    }

    @Test
    @DisplayName("a baby of anything is something you cannot outrun")
    void babiesAreFast() {
        Foe baby = new Foe("zombie", 2, 20, true, true);
        assertNotEquals(Stance.FLEE,
                decide(List.of(baby), new Fighter(0.2, CHARGED, 4, PLAIN, Ground.OPEN)));
    }

    @Test
    @DisplayName("circles while the swing recharges instead of standing there")
    void strafesThroughTheCooldown() {
        // Six ticks of standing still is six ticks of free hits, every swing,
        // for the whole fight. Moving through them costs nothing.
        Fighter recharging = new Fighter(1.0, 0.4, 0, PLAIN, Ground.OPEN);
        assertEquals(Stance.STRAFE, decide(List.of(at("zombie", 2)), recharging));
    }

    @Test
    @DisplayName("but stands still rather than circling off a ledge")
    void doesNotStrafeIntoNothing() {
        Ground cliff = new Ground(false, false, true, false);
        Fighter recharging = new Fighter(1.0, 0.4, 0, PLAIN, cliff);
        assertEquals(Stance.HOLD, decide(List.of(at("zombie", 2)), recharging));
    }

    @Test
    @DisplayName("never backs off a cliff to get away from a creeper")
    void givesGroundOnlyWhereThereIsGround() {
        // The version of this rule that only knew "press the back key" was
        // correct in a field and suicide on a ledge.
        Ground cliff = new Ground(false, false, true, false);
        Loadout shielded = new Loadout(SWORD, false, true, 0, false, 0, 0, false);
        assertEquals(Stance.BLOCK,
                decide(List.of(at("creeper", 1.5)), new Fighter(1.0, CHARGED, 0, shielded, cliff)),
                "cornered by a creeper with a shield and did not raise it");
    }

    @Test
    @DisplayName("never walks into a creeper")
    void creepersAreTheirOwnRulebook() {
        assertEquals(Stance.BACK_OFF, decide(List.of(at("creeper", 1.5)), me(1.0)));
        assertEquals(Stance.HOLD, decide(List.of(at("creeper", 6)), me(1.0)),
                "walked at a creeper across open ground");
        assertEquals(Stance.STRIKE, decide(List.of(at("creeper", 2.9)), me(1.0)));
        assertEquals(Stance.BACK_OFF,
                decide(List.of(at("creeper", 2.9)), new Fighter(1.0, 0.3, 0, PLAIN, Ground.OPEN)));
    }

    @Test
    @DisplayName("hits the one that matters, not the one that is nearest")
    void picksByThreatRatherThanDistance() {
        // Nearest is what a mob-grinder bot does. It walks past a creeper to
        // punch a zombie.
        assertEquals("creeper",
                Combat.decide(List.of(at("zombie", 2), at("creeper", 4)), me(1.0)).kind());

        // And it starts a fresh skeleton while a wounded one keeps shooting.
        Foe wounded = new Foe("skeleton", 2.5, 3, false, true);
        Foe fresh = new Foe("skeleton", 2.0, 20, false, true);
        assertSame(wounded, Combat.ranked(List.of(fresh, wounded), true).get(0),
                "left a skeleton on one hit to start another one");
    }

    @Test
    @DisplayName("never swings until the swing is charged")
    void waitsForTheCooldown() {
        Fighter half = new Fighter(1.0, 0.5, 0, PLAIN, new Ground(true, false, true, false));
        assertEquals(Stance.HOLD, decide(List.of(at("zombie", 2)), half),
                "spam-clicked: a half-charged hit is half a hit and no sweep");
    }

    @Test
    @DisplayName("leaves alone what is not attacking")
    void doesNotStartFights() {
        Foe idle = new Foe("enderman", 5, 40, false, false);
        assertEquals(Stance.IGNORE, decide(List.of(idle), me(1.0)));
        Foe angry = new Foe("enderman", 5, 40, false, true);
        assertNotEquals(Stance.IGNORE, decide(List.of(angry), me(1.0)));
    }

    @Test
    @DisplayName("knows the fights it cannot win")
    void runsFromWhatItCannotBeat() {
        Loadout best = new Loadout(Combat.dpsOf("netherite_sword"), false, true, 64, true, 20, 8, true);
        for (String hopeless : List.of("warden", "ravager", "elder_guardian")) {
            assertEquals(Stance.FLEE, decide(List.of(at(hopeless, 3)), me(1.0, best)),
                    "picked a fight with a " + hopeless);
        }
    }

    @Test
    @DisplayName("shoots what a sword cannot reach, and leaves if it has no bow")
    void reachesWhatItCannotTouch() {
        // Walking toward a ghast until it kills you is what a mod with only a
        // sword in its vocabulary does.
        Loadout archer = new Loadout(SWORD, false, false, 12, true, 0, 0, false);
        assertEquals(Stance.SHOOT, decide(List.of(at("ghast", 20)), me(1.0, archer)));
        assertEquals(Stance.FLEE, decide(List.of(at("ghast", 20)), me(1.0)));

        // An empty quiver is not a bow.
        Loadout empty = new Loadout(SWORD, false, false, 0, true, 0, 0, false);
        assertEquals(Stance.FLEE, decide(List.of(at("ghast", 20)), me(1.0, empty)));
    }

    @Test
    @DisplayName("trades arrows with a distant shooter rather than walking at it")
    void shootsBackAcrossARoom() {
        Loadout archer = new Loadout(SWORD, false, false, 12, true, 0, 0, false);
        assertEquals(Stance.SHOOT, decide(List.of(at("skeleton", 18)), me(1.0, archer)));
        // Close enough to reach, and closing is the better answer again.
        assertEquals(Stance.CLOSE, decide(List.of(at("skeleton", 6)), me(1.0, archer)));
    }

    @Test
    @DisplayName("raises the shield instead of eating the arrow")
    void blocksWhileClosing() {
        Loadout shielded = new Loadout(SWORD, false, true, 0, false, 0, 0, false);
        assertEquals(Stance.BLOCK, decide(List.of(at("skeleton", 8)), me(1.0, shielded)));
        // Nothing shooting at it: the shield stays down and it closes.
        assertEquals(Stance.CLOSE, decide(List.of(at("zombie", 8)), me(1.0, shielded)));
    }

    @Test
    @DisplayName("armour changes which fights are worth having")
    void fightsHarderInIron() {
        // Naked at four hearts is a retreat; in full iron the same four hearts
        // is several more hits than the zombie has left in it.
        Fighter naked = new Fighter(0.25, CHARGED, 0, PLAIN, Ground.OPEN);
        assertEquals(Stance.FLEE, decide(List.of(at("zombie", 2)), naked));

        Loadout iron = new Loadout(SWORD, false, false, 0, false, 15, 0, false);
        Fighter armoured = new Fighter(0.25, CHARGED, 0, iron, Ground.OPEN);
        assertNotEquals(Stance.FLEE, decide(List.of(at("zombie", 2)), armoured));
    }

    @Test
    @DisplayName("drinks the apple while there is still room to")
    void healsBeforeItIsTooLate() {
        Loadout apples = new Loadout(SWORD, false, false, 0, false, 0, 0, true);
        assertEquals(Stance.HEAL,
                decide(List.of(at("zombie", 8)), new Fighter(0.2, CHARGED, 0, apples, Ground.OPEN)));
        // Not with one in your face: that is two seconds of standing still.
        assertNotEquals(Stance.HEAL,
                decide(List.of(at("zombie", 2)), new Fighter(0.2, CHARGED, 0, apples, Ground.OPEN)));
    }

    @Test
    @DisplayName("gets its back to a wall before it is surrounded")
    void doesNotLetThemGetBehindIt() {
        List<Foe> pair = List.of(at("zombie", 5), at("zombie", 6));
        assertEquals(Stance.BACK_OFF, decide(pair, me(1.0)),
                "let two of them close on open ground");

        Ground backedUp = new Ground(true, true, true, false);
        assertEquals(Stance.CLOSE, decide(pair, new Fighter(1.0, CHARGED, 0, PLAIN, backedUp)));
    }

    @Test
    @DisplayName("gets out of the fire before worrying about the zombie")
    void firstThingsFirst() {
        Ground burning = new Ground(true, true, true, true);
        assertEquals(Stance.BACK_OFF,
                decide(List.of(at("zombie", 2)), new Fighter(1.0, CHARGED, 0, PLAIN, burning)));
    }

    @Test
    @DisplayName("three at once is not a fight either")
    void doesNotTakeOnACrowd() {
        List<Foe> mob = List.of(at("zombie", 2), at("zombie", 3), at("skeleton", 5),
                at("zombie", 6));
        assertEquals(Stance.FLEE, decide(mob, me(1.0)));
    }

    @Test
    @DisplayName("does not blunt the pickaxe on a fight it could walk away from")
    void protectsTheToolItCameWith() {
        // A diamond pickaxe out-damages a stone sword and using it is still
        // wrong: the pickaxe is what the afternoon depends on.
        Loadout tooling = new Loadout(Combat.dpsOf("diamond_pickaxe"), true, false, 0, false, 0, 0, false);
        assertEquals(Stance.FLEE, decide(List.of(at("zombie", 5)), me(1.0, tooling)));
        // Unless it is already being hit, at which point the tool is what there is.
        assertNotEquals(Stance.FLEE,
                decide(List.of(at("zombie", 5)), new Fighter(1.0, CHARGED, 4, tooling, Ground.OPEN)));
        // Nor when it is already inside arm's reach: declining is not on offer.
        assertNotEquals(Stance.FLEE, decide(List.of(at("zombie", 2)), me(1.0, tooling)));
    }

    @Test
    @DisplayName("unarmed at full health, it walks away")
    void doesNotPunchThingsForNoReason() {
        assertEquals(Stance.FLEE, decide(List.of(at("zombie", 5)), me(1.0, Loadout.NOTHING)));
        assertNotEquals(Stance.FLEE, decide(List.of(at("zombie", 5)),
                new Fighter(1.0, CHARGED, 4, Loadout.NOTHING, Ground.OPEN)));
    }

    @Test
    @DisplayName("picks a weapon by damage per second, and a weapon over a tool")
    void swordsBeatAxesAndToolsAreLast() {
        assertTrue(Combat.dpsOf("diamond_sword") > Combat.dpsOf("diamond_axe"));

        assertEquals("diamond_sword", Combat.bestWeapon(
                Map.of("diamond_axe", 1, "diamond_sword", 1, "iron_pickaxe", 1)));
        // A diamond pickaxe out-damages a stone sword. The sword still wins.
        assertEquals("stone_sword", Combat.bestWeapon(
                Map.of("diamond_pickaxe", 1, "stone_sword", 1)));
        // With no weapon at all, the tool is what there is — and it is flagged.
        assertEquals("diamond_pickaxe", Combat.bestWeapon(Map.of("diamond_pickaxe", 1)));
        assertTrue(Combat.kitFrom(Map.of("diamond_pickaxe", 1), Map.of()).improvised());
        assertNull(Combat.bestWeapon(Map.of("cobblestone", 64)));
    }

    @Test
    @DisplayName("the damage table is the game's own")
    void weaponNumbersAreReal() {
        assertEquals(8.0 * 1.6, Combat.dpsOf("netherite_sword"), 0.001);
        assertEquals(7.0 * 1.6, Combat.dpsOf("diamond_sword"), 0.001);
        assertEquals(5.0 * 1.6, Combat.dpsOf("stone_sword"), 0.001);
        assertEquals(9.0, Combat.dpsOf("diamond_axe"), 0.001);
        assertEquals(9.0, Combat.dpsOf("stone_axe"), 0.001);
        assertEquals(10.0, Combat.dpsOf("netherite_axe"), 0.001);
        assertEquals(5.0 * 1.2, Combat.dpsOf("diamond_pickaxe"), 0.001);
    }

    @Test
    @DisplayName("reads the whole bag in one go")
    void buildsItsOwnLoadout() {
        Loadout kit = Combat.kitFrom(
                Map.of("iron_sword", 1, "shield", 1, "bow", 1, "arrow", 32,
                        "golden_apple", 2, "cobblestone", 64),
                Map.of(Armoury.Slot.CHEST, "iron_chestplate", Armoury.Slot.HEAD, "iron_helmet"));
        assertEquals(SWORD, kit.weaponDps(), 0.001);
        assertFalse(kit.improvised());
        assertTrue(kit.shield());
        assertTrue(kit.canShoot());
        assertTrue(kit.healing());
        assertEquals(8, kit.armourPoints());
    }

    @Test
    @DisplayName("every decision explains itself")
    void alwaysGivesAReason() {
        List<List<Foe>> situations = List.of(
                List.of(), List.of(at("creeper", 2)), List.of(at("skeleton", 9)),
                List.of(at("warden", 5)), List.of(at("ghast", 30)), List.of(at("zombie", 1)));
        for (List<Foe> foes : situations) {
            for (double health : new double[]{1.0, 0.5, 0.2}) {
                for (Ground ground : List.of(Ground.OPEN, new Ground(false, false, true, false))) {
                    Combat.Plan plan = Combat.decide(foes,
                            new Fighter(health, CHARGED, 0, PLAIN, ground));
                    assertNotNull(plan.because());
                    assertFalse(plan.because().isBlank(),
                            "decided " + plan.stance() + " for no stated reason");
                }
            }
        }
    }
}
