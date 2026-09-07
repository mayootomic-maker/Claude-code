package dev.understudy.core.survive;

import java.util.List;
import java.util.Map;

/**
 * Whether to fight, and how.
 *
 * The mod could not fight at all. Its entire answer to a hostile was to stop
 * and hand the controls back, which is a defensible answer for a thing that
 * cannot see what hit it and a terrible one in practice: a single zombie
 * wandering into a mine ends the job, and the job never restarts because the
 * zombie is still there. An hour of unattended work is lost to one mob that a
 * player would have killed without breaking stride.
 *
 * So this decides. It is a separate file from the Guardian because the two
 * questions are genuinely different — the Guardian asks whether to keep working,
 * this asks what to do about the thing in front of you — and because every
 * judgement here is one that is miserable to stage in a real game and trivial to
 * state as a table.
 *
 * What makes it better than a person rather than merely armed:
 *
 *  - It never spam-clicks. Minecraft charges a swing over time and a swing at
 *    half charge does roughly half damage plus no sweep; clicking as fast as
 *    possible is the single most common way players do a third of their damage
 *    and do not notice. This waits.
 *  - It picks a weapon by damage per second rather than by damage. An axe hits
 *    harder and swings slower, and against everything that is not wearing
 *    armour the sword wins — which is the opposite of what the numbers in the
 *    tooltip suggest.
 *  - It knows which mobs cannot be outrun. Fleeing a spider is how you die
 *    tired; a player learns this once per death, and forgets it at 2am.
 *  - It does not look at endermen, and does not pick fights it was not offered.
 *
 * Nothing here touches Minecraft, so all of it is tested.
 */
public final class Combat {

    /** What to do about the nearest thing that wants to hurt you. */
    public enum Stance {
        /** Leave it alone. Either harmless, or provoking it is the mistake. */
        IGNORE,
        /** Swing now. */
        STRIKE,
        /** Close the distance. */
        CLOSE,
        /** In range, but the swing is not charged — wait, facing it. */
        HOLD,
        /** Give ground without disengaging. Creepers, mostly. */
        BACK_OFF,
        /** Break off and stop working. */
        FLEE
    }

    /**
     * One hostile, as the numbers that matter.
     *
     * `kind` is the registry path — "creeper", "skeleton" — because that is the
     * one name that is stable across versions and reachable without a class
     * cast per mob type.
     */
    public record Foe(String kind, double distance, boolean baby, boolean lookingAtUs) {}

    /** What to do, and the sentence explaining it. */
    public record Plan(Stance stance, String kind, String because) {}

    /** Melee reach. Vanilla is a little over three; stay honestly inside it. */
    public static final double REACH = 3.0;
    /**
     * Closer than this to a creeper and the only move is backwards.
     *
     * It has to be under melee reach or there is no distance at which the thing
     * can be hit at all — which is what a first cut of this rule produced: a
     * "back off inside three blocks" and a "strike inside three blocks" that
     * between them left an empty window and a mod that circled a creeper until
     * it went off.
     */
    private static final double CREEPER_TOO_CLOSE = 2.0;
    /**
     * A swing below this fraction of charge is a wasted swing.
     *
     * Public because the body layer has to wait for the same number before it
     * presses the button, and two copies of it would drift.
     */
    public static final double CHARGED = 0.92;
    /** Below this much health, disengage from anything escapable. */
    private static final double BREAK_OFF = 0.4;
    /** Below this, do not start a fight that is not already happening. */
    private static final double PICK_FIGHTS_ABOVE = 0.6;
    /** More than this many at once and no weapon is enough. */
    private static final int OVERWHELMED = 3;
    /** Bare hands do this much. Anything less than a real weapon is close to it. */
    private static final double FISTS = 1.0;

    /**
     * Things that are faster than a walking player, or fast enough that running
     * only means being hit in the back.
     *
     * This is the list that changes the answer most often. "Flee" is the safe
     * move against a zombie and a losing move against a spider, and the mod
     * previously fled from both.
     */
    private static final List<String> CANNOT_OUTRUN = List.of(
            "spider", "cave_spider", "vex", "hoglin", "zoglin", "warden",
            "phantom", "blaze", "vindicator", "ravager", "breeze");

    /** Things that hurt you from further away than you can hit them. */
    private static final List<String> RANGED = List.of(
            "skeleton", "stray", "bogged", "witch", "pillager", "blaze",
            "ghast", "drowned", "illusioner", "breeze", "shulker");

    /**
     * Fights nothing here can win, at any health, with any sword.
     *
     * Being clear about this is the difference between an autopilot you can
     * leave running and one that walks your character into a warden.
     */
    private static final List<String> HOPELESS = List.of(
            "warden", "wither", "ender_dragon", "elder_guardian", "ravager", "evoker");

    /** Neutral until provoked. Swinging at one of these is the whole mistake. */
    private static final List<String> LEAVE_ALONE = List.of(
            "enderman", "zombified_piglin", "piglin", "spider", "cave_spider");

    private Combat() {}

    public static boolean cannotOutrun(String kind) {
        return CANNOT_OUTRUN.contains(kind);
    }

    public static boolean ranged(String kind) {
        return RANGED.contains(kind);
    }

    public static boolean hopeless(String kind) {
        return HOPELESS.contains(kind);
    }

    /**
     * Whether swinging at this would be starting something.
     *
     * Spiders are on the list and are the awkward case: hostile in the dark,
     * indifferent in daylight, and the game does not say which from the outside.
     * "Is it looking at us" is the readable proxy, and erring toward leaving it
     * alone costs nothing — a spider that is not attacking is not a problem.
     */
    public static boolean neutral(String kind) {
        return LEAVE_ALONE.contains(kind);
    }

    /**
     * The one decision.
     *
     * @param foes          hostiles in sight, nearest first is not assumed
     * @param healthFraction hearts remaining over hearts at full
     * @param weaponDps     damage per second of the best thing in the inventory
     * @param swingCharge   0 to 1, how far the attack cooldown has recovered
     * @param underAttack   health lost in the last couple of seconds
     */
    public static Plan decide(List<Foe> foes, double healthFraction, double weaponDps,
                              double swingCharge, double underAttack) {
        Foe target = pick(foes, underAttack > 0);
        if (target == null) {
            return new Plan(Stance.IGNORE, "", "nothing worth fighting");
        }
        if (hopeless(target.kind())) {
            return new Plan(Stance.FLEE, target.kind(),
                    target.kind() + " is not a fight, at any health");
        }

        boolean cornered = cannotOutrun(target.kind());
        int engaged = countEngaged(foes, underAttack > 0);

        if (engaged > OVERWHELMED && !cornered) {
            return new Plan(Stance.FLEE, target.kind(),
                    engaged + " at once is more than one sword answers");
        }
        // Low on health, and running is actually an option. Against something
        // faster than you it is not, and pretending otherwise is how the flight
        // ends with an arrow in your back at two hearts.
        if (healthFraction < BREAK_OFF && !cornered) {
            return new Plan(Stance.FLEE, target.kind(),
                    "on " + percent(healthFraction) + " health with a way out");
        }
        // Unarmed against something that is not already committed to the fight:
        // punching a zombie to death at full health is a fight you win with four
        // hearts left, for nothing.
        if (weaponDps <= FISTS && underAttack <= 0 && !cornered) {
            return new Plan(Stance.FLEE, target.kind(), "nothing to fight with");
        }
        if (healthFraction < PICK_FIGHTS_ABOVE && underAttack <= 0 && !cornered) {
            return new Plan(Stance.FLEE, target.kind(),
                    "hurt already; not starting one");
        }

        if (target.kind().equals("creeper")) {
            return creeper(target, swingCharge);
        }

        if (target.distance() > REACH) {
            return new Plan(Stance.CLOSE, target.kind(),
                    ranged(target.kind())
                            ? "closing fast — standing still in front of a "
                                    + target.kind() + " is the losing move"
                            : "closing to reach");
        }
        if (swingCharge < CHARGED) {
            return new Plan(Stance.HOLD, target.kind(),
                    "swing at " + percent(swingCharge) + " — a half-charged hit is half a hit");
        }
        return new Plan(Stance.STRIKE, target.kind(), "in reach, fully charged");
    }

    /**
     * Creepers, which are their own rulebook.
     *
     * The fuse starts at about three blocks and runs for a second and a half,
     * and a hit knocks the creeper back and resets it. So the winning pattern is
     * to strike from the edge of reach and immediately give ground, never to
     * stand next to one — and never to approach one that is already too close,
     * because closing the last block is what lights it.
     */
    private static Plan creeper(Foe target, double swingCharge) {
        if (target.distance() < CREEPER_TOO_CLOSE) {
            return new Plan(Stance.BACK_OFF, "creeper",
                    "inside the blast — getting out before it goes off");
        }
        if (target.distance() > REACH) {
            return new Plan(Stance.HOLD, "creeper",
                    "letting it come to the edge of reach rather than walking into the fuse");
        }
        if (swingCharge < CHARGED) {
            return new Plan(Stance.BACK_OFF, "creeper",
                    "swing not charged; giving ground rather than standing in the blast");
        }
        return new Plan(Stance.STRIKE, "creeper", "at arm's length and charged — hit and step back");
    }

    /**
     * Which one to worry about.
     *
     * Nearest, except that a creeper outranks anything else at similar distance
     * — it is the only one whose mistake costs the whole health bar at once —
     * and neutrals are skipped entirely unless the fight is already happening.
     */
    private static Foe pick(List<Foe> foes, boolean fightIsOn) {
        Foe best = null;
        double bestScore = Double.MAX_VALUE;
        for (Foe foe : foes) {
            if (!engaged(foe, fightIsOn)) continue;
            double score = foe.distance() - (foe.kind().equals("creeper") ? 4.0 : 0.0);
            if (score < bestScore) {
                bestScore = score;
                best = foe;
            }
        }
        return best;
    }

    private static int countEngaged(List<Foe> foes, boolean fightIsOn) {
        int count = 0;
        for (Foe foe : foes) if (engaged(foe, fightIsOn)) count++;
        return count;
    }

    /**
     * Whether this one is part of the situation at all.
     *
     * A neutral mob standing there is scenery. It stops being scenery when it
     * is looking at you, or when something is already hitting you and it is the
     * only candidate — which is the case where "leave it alone" would mean
     * standing still while it bites.
     */
    private static boolean engaged(Foe foe, boolean fightIsOn) {
        if (!neutral(foe.kind())) return true;
        return foe.lookingAtUs() || (fightIsOn && foe.distance() <= REACH + 1);
    }

    /**
     * The best thing to hit with, by damage per second rather than by damage.
     *
     * Axes have the bigger number and the slower swing. A diamond sword does
     * seven at 1.6 swings a second; a diamond axe does nine at one. Eleven and
     * change against nine, and the tooltip says the axe is better.
     */
    public static String bestWeapon(Map<String, Integer> carried) {
        String best = null;
        double bestDps = FISTS;
        for (String item : carried.keySet()) {
            if (carried.getOrDefault(item, 0) <= 0) continue;
            double dps = dpsOf(item);
            if (dps > bestDps) {
                bestDps = dps;
                best = item;
            }
        }
        return best;
    }

    public static double bestWeaponDps(Map<String, Integer> carried) {
        String best = bestWeapon(carried);
        return best == null ? FISTS : dpsOf(best);
    }

    /**
     * Damage per second of a held item.
     *
     * The two tables are the game's own: attack damage by material, attack speed
     * by tool. A pickaxe is in here because "what is the best thing I am
     * carrying" has to have an answer while mining, and the answer is often a
     * pickaxe.
     */
    public static double dpsOf(String item) {
        if (item == null) return FISTS;
        double speed;
        if (item.endsWith("_sword")) speed = 1.6;
        else if (item.endsWith("_axe")) speed = 1.0;
        else if (item.endsWith("_pickaxe")) speed = 1.2;
        else if (item.endsWith("_shovel")) speed = 1.0;
        else if (item.equals("trident")) speed = 1.1;
        else if (item.equals("mace")) speed = 0.6;
        else return FISTS;

        double damage = item.endsWith("_axe")
                ? axeDamage(item)
                : base(item) + materialBonus(item);
        return damage * speed;
    }

    /**
     * What the tool type contributes before the material is considered.
     *
     * Axes are the exception and get a table of their own, because their damage
     * does not step evenly with the material the way everything else does: wood
     * and gold both do seven, stone iron and diamond all do nine, and only
     * netherite moves it to ten. Deriving it would give a diamond axe ten, which
     * is a number the game has never had.
     */
    private static double base(String item) {
        if (item.endsWith("_sword")) return 4.0;
        if (item.endsWith("_pickaxe")) return 2.0;
        if (item.endsWith("_shovel")) return 2.5;
        if (item.equals("trident")) return 9.0;
        if (item.equals("mace")) return 6.0;
        return FISTS;
    }

    private static double axeDamage(String item) {
        if (item.startsWith("netherite_")) return 10.0;
        if (item.startsWith("stone_") || item.startsWith("iron_")
                || item.startsWith("diamond_")) return 9.0;
        return 7.0;
    }

    /** And what the material adds on top. Wood and gold add nothing. */
    private static double materialBonus(String item) {
        if (item.startsWith("netherite_")) return 4.0;
        if (item.startsWith("diamond_")) return 3.0;
        if (item.startsWith("iron_")) return 2.0;
        if (item.startsWith("stone_")) return 1.0;
        return 0.0;
    }

    private static String percent(double fraction) {
        return Math.round(fraction * 100) + "%";
    }
}
