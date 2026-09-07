package dev.understudy.core.survive;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Whether to fight, what to fight, and how.
 *
 * The mod could not fight at all, then it could fight competently, and this is
 * the version that fights better than most people do. The difference between
 * the second and the third is not reflexes — a mod has perfect reflexes and
 * they buy it almost nothing — it is the half-dozen things a good player does
 * that a decent one does not, every one of which is a decision rather than a
 * skill:
 *
 *  - Wear the armour that is in your bag. Eighty per cent damage reduction is
 *    sitting in the inventory and the fight is what it is for.
 *  - Never stand still. A charged swing takes six ticks; standing through them
 *    is six ticks of free hits, and moving through them is not harder.
 *  - Hit the one that is nearly dead. Damage already dealt is only worth
 *    anything once the thing stops attacking, so finishing a wounded skeleton
 *    removes more incoming damage than starting a fresh one.
 *  - Raise the shield instead of eating the arrow.
 *  - Get your back to something before four of them are around you.
 *  - Do not wear out the pickaxe you came here with on a zombie you could
 *    walk away from.
 *  - Know what is unkillable with what you are carrying, and leave.
 *
 * All of that is arithmetic and tables, which is why it is here rather than in
 * the half that touches Minecraft, and why every rule below has a test.
 */
public final class Combat {

    /** What to do about the thing in front of you. */
    public enum Stance {
        /** Leave it alone. Harmless, or provoking it is the mistake. */
        IGNORE,
        /** Swing now. */
        STRIKE,
        /** Close the distance. */
        CLOSE,
        /** In range, swing not ready, and nowhere safe to move: wait, facing it. */
        HOLD,
        /** In range, swing not ready: circle rather than stand there. */
        STRAFE,
        /** Give ground without disengaging. */
        BACK_OFF,
        /** Shoot it. Either it cannot be reached, or reaching it is the mistake. */
        SHOOT,
        /** Shield up and take it on the wood. */
        BLOCK,
        /** Drink the apple. */
        HEAL,
        /** Break off and stop working. */
        FLEE
    }

    /**
     * One hostile, as the numbers that matter.
     *
     * `kind` is the registry path — "creeper", "skeleton" — because that is the
     * one name stable across versions and reachable without a cast per type.
     * `health` is what the client already knows for drawing its health bar, and
     * it is the input that makes target choice something better than "nearest".
     */
    public record Foe(String kind, double distance, double health, boolean baby,
                      boolean lookingAtUs) {}

    /**
     * What is under and behind your feet.
     *
     * The reason this exists: an earlier version answered a creeper by pressing
     * the back key, which is correct in a field and suicide on a ledge or at
     * the edge of a lava pool. Giving ground has to be a thing you check, not a
     * thing you assume.
     */
    public record Ground(boolean canStepBack, boolean canStrafe, boolean wallBehind,
                         boolean standingInFire) {
        public static final Ground OPEN = new Ground(true, true, false, false);
    }

    /**
     * What you are fighting with and wearing.
     *
     * @param improvised whether the best weapon is really a tool. A pickaxe hits
     *                   respectably and every swing is durability off the thing
     *                   the job needs, so it changes whether a fight is worth
     *                   having rather than only how it goes.
     */
    public record Loadout(double weaponDps, boolean improvised, boolean shield,
                          int arrows, boolean bow, int armourPoints, double toughness,
                          boolean healing) {
        public static final Loadout NOTHING =
                new Loadout(1.0, false, false, 0, false, 0, 0, false);

        public boolean canShoot() {
            return bow && arrows > 0;
        }
    }

    /** Everything about your own state that the decision turns on. */
    public record Fighter(double healthFraction, double swingCharge, double damageTaken,
                          Loadout kit, Ground ground) {}

    /** What to do, to what, and the sentence explaining it. */
    public record Plan(Stance stance, String kind, String because) {}

    /** Melee reach. Vanilla is a little over three; stay honestly inside it. */
    public static final double REACH = 3.0;
    /**
     * A swing below this fraction of charge is a wasted swing.
     *
     * Public because the body layer waits for the same number before it presses
     * the button, and two copies of it would drift.
     */
    public static final double CHARGED = 0.92;
    /** Closer than this to a creeper and the only move is backwards. */
    private static final double CREEPER_TOO_CLOSE = 2.0;
    /** Below this much health, disengage from anything escapable. */
    private static final double BREAK_OFF = 0.4;
    /** Below this, do not start a fight that is not already happening. */
    private static final double PICK_FIGHTS_ABOVE = 0.6;
    /** Below this, drink the apple if there is one. */
    private static final double CRITICAL = 0.35;
    /** Far enough away that there is time to eat. */
    private static final double ROOM_TO_HEAL = 5.0;
    /** More than this many at once and no sword is enough. */
    private static final int OVERWHELMED = 3;
    /** Bare hands do this much. */
    private static final double FISTS = 1.0;
    /** Beyond this, closing on a shooter costs more than shooting back. */
    private static final double TOO_FAR_TO_CLOSE = 12.0;
    /** A foe with less than this left dies to one hit and stops shooting. */
    private static final double NEARLY_DEAD = 5.0;
    /** Three hearts: about what an ordinary mob lands, for reckoning armour by. */
    private static final double TYPICAL_HIT = 6.0;

    /**
     * Things faster than a walking player, or fast enough that running only
     * means being hit in the back.
     *
     * The rule that changes the answer most often. Fleeing a zombie is safe;
     * fleeing a spider is dying tired.
     */
    private static final List<String> CANNOT_OUTRUN = List.of(
            "spider", "cave_spider", "vex", "hoglin", "zoglin", "warden",
            "phantom", "blaze", "vindicator", "ravager", "breeze");

    /** Things that hurt you from further away than you can hit them. */
    private static final List<String> RANGED = List.of(
            "skeleton", "stray", "bogged", "witch", "pillager", "blaze",
            "ghast", "drowned", "illusioner", "breeze", "shulker");

    /**
     * Things melee cannot reach at all.
     *
     * A ghast floats out of range by design and a shulker sits inside a wall.
     * Without a bow these are not fights that go badly — they are fights that
     * cannot be had, and walking toward one until it kills you is what a mod
     * with only a sword in its vocabulary does.
     */
    private static final List<String> OUT_OF_REACH = List.of("ghast", "shulker", "phantom");

    /** Fights nothing here wins, at any health, with any sword. */
    private static final List<String> HOPELESS = List.of(
            "warden", "wither", "ender_dragon", "elder_guardian", "ravager", "evoker");

    /** Neutral until provoked. Swinging at one of these is the whole mistake. */
    private static final List<String> LEAVE_ALONE = List.of(
            "enderman", "zombified_piglin", "piglin", "spider", "cave_spider");

    /**
     * Roughly how much damage each thing does per second, in half-hearts.
     *
     * Used to rank targets, not to predict a fight. What it has to get right is
     * the ordering — that a creeper is in a different class from a zombie and a
     * skeleton across a room is worse than a spider behind you — and the exact
     * figures matter much less than that.
     */
    private static final Map<String, Double> DANGER = Map.ofEntries(
            Map.entry("creeper", 20.0), Map.entry("warden", 30.0), Map.entry("wither", 20.0),
            Map.entry("ghast", 8.0), Map.entry("ravager", 8.0), Map.entry("evoker", 6.0),
            Map.entry("vindicator", 6.0), Map.entry("enderman", 5.0), Map.entry("hoglin", 5.0),
            Map.entry("wither_skeleton", 5.0), Map.entry("elder_guardian", 5.0),
            Map.entry("zombified_piglin", 4.0), Map.entry("piglin", 4.0),
            Map.entry("blaze", 3.0), Map.entry("drowned", 3.0), Map.entry("pillager", 3.0),
            Map.entry("vex", 3.0), Map.entry("magma_cube", 3.0), Map.entry("guardian", 3.0),
            Map.entry("skeleton", 2.0), Map.entry("stray", 2.0), Map.entry("bogged", 2.0),
            Map.entry("witch", 2.0), Map.entry("zombie", 2.0), Map.entry("husk", 2.0),
            Map.entry("phantom", 2.0), Map.entry("slime", 2.0), Map.entry("breeze", 2.0),
            Map.entry("shulker", 2.0), Map.entry("spider", 1.5), Map.entry("cave_spider", 1.5),
            Map.entry("silverfish", 1.0), Map.entry("endermite", 1.0));

    private Combat() {}

    public static boolean cannotOutrun(String kind) {
        return CANNOT_OUTRUN.contains(kind);
    }

    public static boolean ranged(String kind) {
        return RANGED.contains(kind);
    }

    public static boolean outOfReach(String kind) {
        return OUT_OF_REACH.contains(kind);
    }

    public static boolean hopeless(String kind) {
        return HOPELESS.contains(kind);
    }

    /** How dangerous this is per second, for ranking one against another. */
    public static double dangerOf(String kind) {
        return DANGER.getOrDefault(kind, 2.0);
    }

    /**
     * Whether swinging at this would be starting something.
     *
     * Spiders are on the list and are the awkward case: hostile in the dark,
     * indifferent in daylight, and the game does not say which from outside.
     * "Is it looking at us" is the readable proxy, and erring toward leaving it
     * alone costs nothing.
     */
    public static boolean neutral(String kind) {
        return LEAVE_ALONE.contains(kind);
    }

    /**
     * The one decision.
     *
     * Ordered by how little time there is to react rather than by how much is
     * at stake, which is the principle the Guardian uses and for the same
     * reason: standing in fire is less bad than being surrounded and far more
     * urgent.
     */
    public static Plan decide(List<Foe> foes, Fighter me) {
        Foe target = pick(foes, me.damageTaken() > 0);
        if (target == null) {
            return new Plan(Stance.IGNORE, "", "nothing worth fighting");
        }
        Loadout kit = me.kit();
        boolean fightIsOn = me.damageTaken() > 0;
        int engaged = countEngaged(foes, fightIsOn);
        // Armour changes what is survivable, so it changes where the lines are
        // rather than merely how a fight goes. Full iron is most of a health
        // bar's worth of hits again, and ignoring that means running from
        // fights that were already won. It is a bounded adjustment: see
        // Armoury.survivability for why more headroom is not more hearts.
        double armoured = Armoury.survivability(kit.armourPoints(), kit.toughness(), TYPICAL_HIT);

        if (me.ground().standingInFire() && me.ground().canStepBack()) {
            return new Plan(Stance.BACK_OFF, target.kind(),
                    "standing in fire — that first, whatever else is happening");
        }
        if (hopeless(target.kind())) {
            return new Plan(Stance.FLEE, target.kind(),
                    target.kind() + " is not a fight, at any health");
        }
        if (outOfReach(target.kind())) {
            return kit.canShoot()
                    ? new Plan(Stance.SHOOT, target.kind(),
                            "a " + target.kind() + " cannot be reached with a sword")
                    : new Plan(Stance.FLEE, target.kind(),
                            "nothing here can touch a " + target.kind() + " without a bow");
        }

        boolean cornered = cannotOutrun(target.kind()) || target.baby();

        // Healing before anything optional. An apple is two seconds and most of
        // a health bar, and the moment to take it is while there is still room.
        if (me.healthFraction() < CRITICAL && kit.healing()
                && target.distance() > ROOM_TO_HEAL) {
            return new Plan(Stance.HEAL, target.kind(),
                    "on " + percent(me.healthFraction()) + " with room to drink");
        }

        if (engaged > OVERWHELMED && !cornered) {
            return new Plan(Stance.FLEE, target.kind(),
                    engaged + " at once is more than one sword answers");
        }
        // Divided, not multiplied. Armour lowers the health at which a fight
        // stops being worth having; the first cut of this raised it, so a full
        // set of iron made it run from fights it would have won bare.
        if (me.healthFraction() < BREAK_OFF / armoured && !cornered) {
            return new Plan(Stance.FLEE, target.kind(),
                    "on " + percent(me.healthFraction()) + " health with a way out");
        }
        // Nothing to fight with, and something that can be walked away from.
        if (kit.weaponDps() <= FISTS && !fightIsOn && !cornered && walkAway(target)) {
            return new Plan(Stance.FLEE, target.kind(), "nothing to fight with");
        }
        // A pickaxe is a decent weapon and every swing is durability off the
        // thing the job came here for. Worth it when there is no choice; never
        // worth it against something that is going to wander off.
        if (kit.improvised() && !fightIsOn && !cornered && walkAway(target)
                && me.healthFraction() > PICK_FIGHTS_ABOVE) {
            return new Plan(Stance.FLEE, target.kind(),
                    "only a tool to fight with, and no need to blunt it");
        }
        if (me.healthFraction() < PICK_FIGHTS_ABOVE / armoured && !fightIsOn && !cornered
                && walkAway(target)) {
            return new Plan(Stance.FLEE, target.kind(), "hurt already; not starting one");
        }

        // Surrounded is a thing you prevent, not a thing you survive. Two or
        // more and nothing at your back means the next one walks round behind.
        if (engaged >= 2 && !me.ground().wallBehind() && me.ground().canStepBack()
                && target.distance() > REACH) {
            return new Plan(Stance.BACK_OFF, target.kind(),
                    engaged + " of them and open ground behind — backing up to a wall");
        }

        if (target.kind().equals("creeper")) {
            return creeper(target, me);
        }

        // Something shooting from across a room. Closing under fire costs more
        // than the arrows do; shooting back, or not being there, costs less.
        if (ranged(target.kind()) && target.distance() > TOO_FAR_TO_CLOSE) {
            if (kit.canShoot()) {
                return new Plan(Stance.SHOOT, target.kind(),
                        "a " + target.kind() + " at " + Math.round(target.distance())
                                + " blocks — trading arrows beats walking at it");
            }
        }

        if (target.distance() > REACH) {
            // Shield up while closing on a shooter, if the swing is not the
            // thing being waited for anyway.
            if (kit.shield() && ranged(target.kind()) && target.lookingAtUs()) {
                return new Plan(Stance.BLOCK, target.kind(),
                        "shield up while closing on a " + target.kind());
            }
            return new Plan(Stance.CLOSE, target.kind(), "closing to reach");
        }
        if (me.swingCharge() < CHARGED) {
            // The six ticks a swing takes to recover are six ticks of standing
            // there. Circling costs nothing and is most of what separates
            // someone who fights well from someone who merely swings.
            if (me.ground().canStrafe()) {
                return new Plan(Stance.STRAFE, target.kind(),
                        "swing at " + percent(me.swingCharge()) + " — circling, not standing");
            }
            return new Plan(Stance.HOLD, target.kind(),
                    "swing at " + percent(me.swingCharge()) + " and nowhere safe to move");
        }
        return new Plan(Stance.STRIKE, target.kind(), "in reach, fully charged");
    }

    /**
     * Creepers, which are their own rulebook.
     *
     * The fuse starts at about three blocks and runs a second and a half, and a
     * hit knocks it back and resets it. So the winning pattern is to strike from
     * the edge of reach and give ground, never to stand next to one, and never
     * to close the last block — which is what lights it.
     *
     * The shield is the exception worth having: a blocked blast is survivable in
     * anything, so when there is nowhere to give ground to, wood beats hope.
     */
    private static Plan creeper(Foe target, Fighter me) {
        if (target.distance() < CREEPER_TOO_CLOSE) {
            if (!me.ground().canStepBack() && me.kit().shield()) {
                return new Plan(Stance.BLOCK, "creeper",
                    "nowhere to back into — shield up and take it");
            }
            return new Plan(Stance.BACK_OFF, "creeper",
                    "inside the blast — getting out before it goes off");
        }
        if (target.distance() > REACH) {
            return new Plan(Stance.HOLD, "creeper",
                    "letting it come to the edge of reach rather than walking into the fuse");
        }
        if (me.swingCharge() < CHARGED) {
            return new Plan(Stance.BACK_OFF, "creeper",
                    "swing not charged; giving ground rather than standing in the blast");
        }
        return new Plan(Stance.STRIKE, "creeper", "at arm's length and charged — hit and step back");
    }

    /**
     * Which one to worry about.
     *
     * Not nearest. Nearest is what a mob-grinder bot does, and it is wrong twice
     * over: it walks past a creeper to punch a zombie, and it starts a fresh
     * skeleton while a wounded one keeps shooting. Threat is danger over
     * distance, a creeper is in its own class, and something that dies to the
     * next hit is worth taking first because a dead one does no damage at all.
     */
    private static Foe pick(List<Foe> foes, boolean fightIsOn) {
        Foe best = null;
        double bestScore = -1;
        for (Foe foe : foes) {
            if (!engaged(foe, fightIsOn)) continue;
            double score = threatOf(foe);
            if (score > bestScore) {
                bestScore = score;
                best = foe;
            }
        }
        return best;
    }

    /**
     * Whether declining is still on offer.
     *
     * Every "not worth starting" rule needs this and the first cut of them did
     * not have it, which made them say something false: a zombie already inside
     * arm's reach is not a fight you are choosing to start, and walking away
     * from one at that range is walking away while it hits you in the back.
     */
    private static boolean walkAway(Foe target) {
        return target.distance() > REACH;
    }

    /** How much this one matters, right now. Higher is worse. */
    public static double threatOf(Foe foe) {
        double score = dangerOf(foe.kind()) / Math.max(1.0, foe.distance());
        if (foe.kind().equals("creeper")) score *= 3;
        // One hit from ending it. Damage already dealt buys nothing until the
        // thing stops attacking, so finishing beats starting.
        if (foe.health() > 0 && foe.health() <= NEARLY_DEAD && foe.distance() <= REACH) {
            score *= 2;
        }
        return score;
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
     * is looking at you, or when something is already hitting you and it is
     * close enough to be the thing doing it.
     */
    private static boolean engaged(Foe foe, boolean fightIsOn) {
        if (!neutral(foe.kind())) return true;
        return foe.lookingAtUs() || (fightIsOn && foe.distance() <= REACH + 1);
    }

    /** Everything engaged, worst first — what the reasoning prints. */
    public static List<Foe> ranked(List<Foe> foes, boolean fightIsOn) {
        List<Foe> out = new ArrayList<>();
        for (Foe foe : foes) if (engaged(foe, fightIsOn)) out.add(foe);
        out.sort((a, b) -> Double.compare(threatOf(b), threatOf(a)));
        return out;
    }

    /**
     * The best thing to hit with, by damage per second rather than by damage.
     *
     * Axes have the bigger number and the slower swing. A diamond sword does
     * seven at 1.6 swings a second; a diamond axe does nine at one. Eleven and
     * change against nine, and the tooltip says the axe is better.
     *
     * Weapons before tools regardless of the numbers, which is the one place
     * this deliberately does not maximise: a diamond pickaxe out-damages a
     * stone sword and using it is still wrong, because the pickaxe is what the
     * afternoon depends on and the sword is a stick with a rock on it.
     */
    public static String bestWeapon(Map<String, Integer> carried) {
        String bestWeapon = null;
        double bestWeaponDps = FISTS;
        String bestTool = null;
        double bestToolDps = FISTS;
        for (String item : carried.keySet()) {
            if (carried.getOrDefault(item, 0) <= 0) continue;
            double dps = dpsOf(item);
            if (isWeapon(item)) {
                if (dps > bestWeaponDps) {
                    bestWeaponDps = dps;
                    bestWeapon = item;
                }
            } else if (dps > bestToolDps) {
                bestToolDps = dps;
                bestTool = item;
            }
        }
        return bestWeapon != null ? bestWeapon : bestTool;
    }

    /** Made for fighting, as opposed to pressed into it. */
    public static boolean isWeapon(String item) {
        return item.endsWith("_sword") || item.equals("trident") || item.equals("mace");
    }

    /** Everything the fight needs to know about what is in the bag. */
    public static Loadout kitFrom(Map<String, Integer> carried, Map<Armoury.Slot, String> worn) {
        String weapon = bestWeapon(carried);
        return new Loadout(
                weapon == null ? FISTS : dpsOf(weapon),
                weapon != null && !isWeapon(weapon),
                carried.getOrDefault("shield", 0) > 0,
                carried.getOrDefault("arrow", 0),
                carried.getOrDefault("bow", 0) > 0,
                Armoury.pointsOf(worn),
                Armoury.toughnessOf(worn),
                carried.getOrDefault("golden_apple", 0) > 0
                        || carried.getOrDefault("enchanted_golden_apple", 0) > 0);
    }

    /**
     * Damage per second of a held item.
     *
     * The two tables are the game's own: attack damage by material, attack
     * speed by tool. A pickaxe is in here because "what is the best thing I am
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
     * netherite moves it to ten. Deriving it would give a diamond axe ten,
     * which is a number the game has never had.
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
