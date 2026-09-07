package dev.understudy.mc;

import dev.understudy.core.survive.Armoury;
import dev.understudy.core.survive.Combat;
import dev.understudy.human.Rng;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.monster.Monster;
import net.minecraft.world.phys.Vec3;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Actually swinging at things.
 *
 * Combat decides; this does. Every rule about reach and creepers and target
 * choice is tested without a game, and what is left here is reading an entity
 * list, pressing a key and calling attack.
 *
 * Four things in this file are not decisions and are most of what separates a
 * mod that fights from one that fights well, because all four are about the
 * body rather than the judgement:
 *
 * The swing is charged before it lands. Minecraft recovers an attack over about
 * six ticks with a sword, and a hit at half charge does about half damage with
 * no sweep. Clicking as fast as possible — which is what every naive combat bot
 * does, and what it looks like from outside — is a third of the damage.
 *
 * It jumps. A hit taken while falling is a critical: fifty per cent more, for a
 * keypress people make so habitually they have stopped noticing.
 *
 * It moves through the recovery instead of standing in it, which is six ticks
 * of free hits per swing reclaimed for nothing.
 *
 * And it looks where it is putting its feet. An earlier version answered a
 * creeper by pressing the back key, which is right in a field and suicide on a
 * ledge. Every retreat and every circle is checked against the actual blocks
 * first.
 */
public final class Fight {
    private Fight() {}

    /** How the fight is going, from the caller's point of view. */
    public enum Outcome {
        /** Nothing to fight. Carry on with whatever you were doing. */
        CLEAR,
        /** Busy. The controls are ours this tick. */
        FIGHTING,
        /** This one is not worth having. Stop the task and hand back. */
        DISENGAGE
    }

    /** How far out to look. Beyond this it is scenery, not a fight. */
    private static final double WATCH = 24.0;
    /** Within this angle of facing us, a mob is looking at us. */
    private static final double FACING_US = 50.0;
    /** Ticks between noticing something and acting on it. */
    private static final int REACTION_MIN = 3;
    private static final int REACTION_SPREAD = 5;
    /** How long to hold a bow before letting go. A full draw is twenty ticks. */
    private static final int FULL_DRAW = 22;
    /** Beyond this it is worth sprinting to close. */
    private static final double SPRINT_BEYOND = 6.0;
    /** How long to keep circling the same way before considering the other. */
    private static final int STRAFE_FOR = 14;
    /** A drop of more than this is not somewhere to step backwards into. */
    private static final int SAFE_DROP = 3;

    private static Rng rng;
    private static Entity target;
    private static int reaction;
    private static int jumpedAt;
    private static int drawing;
    private static int strafeLeftFor;
    private static boolean strafeLeft;
    /**
     * Which way the fight is, in degrees.
     *
     * Taken from where the target actually is rather than from where the head
     * is currently pointed. The head lags by design — it turns over several
     * ticks like a person's — so using it to decide which way is "backwards"
     * gets the first and most important tick of a retreat wrong.
     */
    private static double bearing;
    /** The client's blocks, read once a tick rather than once a question. */
    private static ClientBlockView ground;
    private static String lastSaid = "";

    /** Seeded from the account, like every other timing in this mod. */
    public static void begin(Rng seeded) {
        rng = seeded;
        reset();
    }

    /** Forget the fight. Called whenever the mod goes idle. */
    public static void reset() {
        target = null;
        reaction = 0;
        jumpedAt = 0;
        drawing = 0;
        strafeLeftFor = 0;
        ground = null;
        lastSaid = "";
    }

    /** What it is doing about the thing in front of it, for the overlay. */
    public static String describe() {
        return lastSaid;
    }

    /**
     * One tick of dealing with whatever is nearby.
     *
     * @param damageRecently health lost in the last couple of seconds, which is
     *                       how "is a fight already happening" is answered — a
     *                       mob's own target lives on the server and never
     *                       reaches the client
     */
    public static Outcome defend(Minecraft client, LocalPlayer player, double damageRecently) {
        if (client.level == null || client.gameMode == null) return Outcome.CLEAR;

        List<Entity> seen = new ArrayList<>();
        List<Combat.Foe> foes = new ArrayList<>();
        for (Entity entity : client.level.entitiesForRendering()) {
            if (!(entity instanceof Monster) || !entity.isAlive()) continue;
            double distance = Math.sqrt(player.distanceToSqr(entity));
            if (distance > WATCH) continue;
            seen.add(entity);
            foes.add(new Combat.Foe(kindOf(entity), distance, healthOf(entity),
                    isBaby(entity), facingUs(entity, player)));
        }
        if (foes.isEmpty()) {
            reset();
            return Outcome.CLEAR;
        }

        bearing = bearingTo(player, nearest(seen, player));
        ground = new ClientBlockView(client.level);
        Combat.Fighter me = new Combat.Fighter(healthFraction(player),
                player.getAttackStrengthScale(0.0f), damageRecently,
                kitOf(client, player), groundAround(client, player));
        Combat.Plan plan = Combat.decide(foes, me);

        if (plan.stance() == Combat.Stance.IGNORE) {
            reset();
            return Outcome.CLEAR;
        }
        if (plan.stance() == Combat.Stance.FLEE) {
            say(plan.kind() + ": " + plan.because());
            letGo(client);
            return Outcome.DISENGAGE;
        }

        Entity chosen = nearestOfKind(seen, foes, plan.kind());
        if (chosen == null) {
            reset();
            return Outcome.CLEAR;
        }
        // A reaction at the start of a fight, and only at the start. A pause
        // before every swing would be a stutter; a fight that begins on the
        // exact tick something crossed the scan radius is a fight nobody could
        // have seen coming.
        if (target == null) {
            reaction = REACTION_MIN + roll(REACTION_SPREAD);
            // Armour first, before the first blow rather than after it. It is
            // free, it is already in the bag, and it is worth more than
            // anything else that happens in the next ten seconds.
            wearTheBest(client, player);
        }
        target = chosen;
        say(plan.kind() + ": " + plan.because());
        if (reaction > 0) {
            reaction--;
            Keys.releaseAll();
            Aim.at(player, aimPoint(target));
            return Outcome.FIGHTING;
        }

        act(client, player, plan.stance());
        return Outcome.FIGHTING;
    }

    /**
     * Press the target that was already chosen — used by anything that has
     * picked its own quarry, which in practice means hunting.
     *
     * Returns whether it is still worth pressing: false once the thing is dead
     * or gone, which is how the hunt knows to move on.
     */
    static boolean strike(Minecraft client, LocalPlayer player, Entity quarry) {
        if (client.gameMode == null || quarry == null || !quarry.isAlive()) return false;
        double distance = Math.sqrt(player.distanceToSqr(quarry));
        Aim.at(player, aimPoint(quarry));
        if (distance > Combat.REACH) {
            Keys.set(client.options.keyDown, false);
            Keys.set(client.options.keyUp, true);
            return true;
        }
        Keys.set(client.options.keyUp, false);
        if (player.getAttackStrengthScale(0.0f) < Combat.CHARGED || !Aim.onTarget()) return true;
        swing(client, player, quarry);
        return true;
    }

    private static void act(Minecraft client, LocalPlayer player, Combat.Stance stance) {
        Aim.at(player, aimPoint(target));
        // Anything that is not a shot lets the bow go, or the draw is carried
        // between stances and released at nothing.
        if (stance != Combat.Stance.SHOOT && drawing > 0) letArrowGo(client);
        if (stance != Combat.Stance.BLOCK && stance != Combat.Stance.HEAL) {
            Keys.set(client.options.keyUse, false);
        }

        switch (stance) {
            case CLOSE -> {
                stopStrafing(client);
                Keys.set(client.options.keyDown, false);
                Keys.set(client.options.keyUp, true);
                // Sprinting closes a gap in half the time and costs a sweep it
                // was not going to land at that range anyway.
                Keys.set(client.options.keySprint,
                        Math.sqrt(player.distanceToSqr(target)) > SPRINT_BEYOND);
            }
            case BACK_OFF -> {
                stopStrafing(client);
                Keys.set(client.options.keySprint, false);
                Keys.set(client.options.keyUp, false);
                Keys.set(client.options.keyDown, true);
            }
            case HOLD -> stand(client);
            case STRAFE -> {
                Keys.set(client.options.keyUp, false);
                Keys.set(client.options.keyDown, false);
                Keys.set(client.options.keySprint, false);
                circle(client, player);
            }
            case STRIKE -> {
                stand(client);
                if (Aim.onTarget()) swing(client, player, target);
            }
            case BLOCK -> {
                stand(client);
                if (Hotbar.hold(client, "shield")) Keys.set(client.options.keyUse, true);
            }
            case SHOOT -> {
                stand(client);
                draw(client, player);
            }
            case HEAL -> {
                stand(client);
                bite(client, player);
            }
            default -> { }
        }
    }

    private static void stand(Minecraft client) {
        stopStrafing(client);
        Keys.set(client.options.keyUp, false);
        Keys.set(client.options.keyDown, false);
        Keys.set(client.options.keySprint, false);
    }

    private static void stopStrafing(Minecraft client) {
        Keys.set(client.options.keyLeft, false);
        Keys.set(client.options.keyRight, false);
    }

    /**
     * Circle the target rather than stand in front of it.
     *
     * One direction at a time and held for a while, because a mod that picks a
     * side afresh every tick vibrates on the spot — which is both useless and
     * the most obviously inhuman thing it could do. It changes hands on its own
     * schedule, and immediately if the side it chose turns out to be a wall.
     */
    private static void circle(Minecraft client, LocalPlayer player) {
        if (strafeLeftFor-- <= 0) {
            strafeLeftFor = STRAFE_FOR + roll(STRAFE_FOR);
            strafeLeft = !strafeLeft;
        }
        boolean leftOpen = canGo(client, player, bearing - 90);
        boolean rightOpen = canGo(client, player, bearing + 90);
        if (!leftOpen && !rightOpen) {
            stopStrafing(client);
            return;
        }
        if (strafeLeft && !leftOpen) strafeLeft = false;
        else if (!strafeLeft && !rightOpen) strafeLeft = true;

        Keys.set(client.options.keyLeft, strafeLeft);
        Keys.set(client.options.keyRight, !strafeLeft);
    }

    /**
     * Draw the bow, hold it, let it go.
     *
     * A bow released early is a dart. The twenty ticks are the game's own full
     * draw, and holding for them is the whole difference between a bow being
     * useful and a bow being a way to annoy a skeleton.
     */
    private static void draw(Minecraft client, LocalPlayer player) {
        if (drawing == 0 && !Hotbar.hold(client, "bow")) return;
        if (drawing < FULL_DRAW) {
            drawing++;
            Keys.set(client.options.keyUse, true);
            return;
        }
        if (!Aim.onTarget()) return;
        letArrowGo(client);
    }

    private static void letArrowGo(Minecraft client) {
        Keys.set(client.options.keyUse, false);
        drawing = 0;
    }

    /** An apple, and only an apple. It is the one food that heals on its own. */
    private static void bite(Minecraft client, LocalPlayer player) {
        String apple = Carried.contents(player).containsKey("enchanted_golden_apple")
                ? "enchanted_golden_apple" : "golden_apple";
        if (Hotbar.hold(client, apple)) Keys.set(client.options.keyUse, true);
    }

    /**
     * Hit it, from the air if that can be arranged.
     *
     * A hit landed while falling is a critical. The jump comes first and the
     * swing waits for the way down, so this is two ticks apart: press jump, and
     * on a later tick — once the fall has started — swing. If the jump did not
     * happen (in water, under a low ceiling) the swing goes ahead rather than
     * waiting for a fall that is never coming.
     */
    private static void swing(Minecraft client, LocalPlayer player, Entity quarry) {
        boolean falling = player.getDeltaMovement().y < -0.08;
        if (player.onGround() && jumpedAt <= 0) {
            jumpedAt = 6;
            Keys.set(client.options.keyJump, true);
            return;
        }
        Keys.set(client.options.keyJump, false);
        if (jumpedAt > 0) {
            jumpedAt--;
            if (!falling && jumpedAt > 0) return;
        }
        jumpedAt = 0;
        client.gameMode.attack(player, quarry);
        player.swing(InteractionHand.MAIN_HAND);
    }

    /** Best weapon in hand. */
    static boolean arm(Minecraft client, LocalPlayer player) {
        String weapon = Combat.bestWeapon(Carried.contents(player));
        return weapon != null && Hotbar.hold(client, weapon);
    }

    /**
     * Put on the best of what is being carried.
     *
     * Right-clicking a held piece equips it, which is the same action a person
     * takes and needs no inventory juggling. One piece per call: each is a use
     * of the hand and doing four in a tick is four things the server sees at
     * once.
     *
     * @return whether anything was put on
     */
    public static boolean wearTheBest(Minecraft client, LocalPlayer player) {
        if (client.gameMode == null) return false;
        Map<String, Integer> carried = Carried.contents(player);
        Map<Armoury.Slot, String> worn = wornBy(player);
        for (Map.Entry<Armoury.Slot, String> want : Armoury.bestSet(carried).entrySet()) {
            String have = worn.get(want.getKey());
            if (want.getValue().equals(have)) continue;
            Armoury.Piece candidate = Armoury.of(want.getValue());
            Armoury.Piece standing = have == null ? null : Armoury.of(have);
            if (standing != null && standing.points() >= candidate.points()) continue;
            if (!Hotbar.hold(client, want.getValue())) continue;
            client.gameMode.useItem(player, InteractionHand.MAIN_HAND);
            return true;
        }
        return false;
    }

    /**
     * What is actually on.
     *
     * Asked by equipment slot rather than by inventory index. The four armour
     * slots do sit at the end of the inventory array, and depending on that is
     * how a mod breaks silently the version they move: it would read four
     * arbitrary items and decide the player was wearing a stack of cobblestone.
     */
    static Map<Armoury.Slot, String> wornBy(LocalPlayer player) {
        Map<Armoury.Slot, String> worn = new java.util.LinkedHashMap<>();
        put(worn, player, Armoury.Slot.HEAD, EquipmentSlot.HEAD);
        put(worn, player, Armoury.Slot.CHEST, EquipmentSlot.CHEST);
        put(worn, player, Armoury.Slot.LEGS, EquipmentSlot.LEGS);
        put(worn, player, Armoury.Slot.FEET, EquipmentSlot.FEET);
        return worn;
    }

    private static void put(Map<Armoury.Slot, String> worn, LocalPlayer player,
                            Armoury.Slot slot, EquipmentSlot where) {
        String name = Hotbar.nameOf(player.getItemBySlot(where));
        if (name != null && Armoury.isArmour(name)) worn.put(slot, name);
    }

    private static Combat.Loadout kitOf(Minecraft client, LocalPlayer player) {
        return Combat.kitFrom(Carried.contents(player), wornBy(player));
    }

    /**
     * What the ground will let it do.
     *
     * Read from the client's own blocks rather than assumed, because every
     * stance that moves is only correct if there is somewhere to move to. A
     * retreat off a ledge is worse than the creeper.
     */
    private static Combat.Ground groundAround(Minecraft client, LocalPlayer player) {
        if (client.level == null) return Combat.Ground.OPEN;
        double away = bearing + 180;
        boolean back = canGo(client, player, away);
        return new Combat.Ground(
                back,
                canGo(client, player, bearing - 90) || canGo(client, player, bearing + 90),
                !back || solidBehind(client, player, away),
                player.isOnFire());
    }

    /** The direction from here to there, in the game's own degrees. */
    private static double bearingTo(LocalPlayer player, Entity entity) {
        if (entity == null) return player.getYRot();
        double dx = entity.getX() - player.getX();
        double dz = entity.getZ() - player.getZ();
        return Math.toDegrees(Math.atan2(dz, dx)) - 90.0;
    }

    private static Entity nearest(List<Entity> seen, LocalPlayer player) {
        Entity best = null;
        double nearest = Double.MAX_VALUE;
        for (Entity entity : seen) {
            double distance = player.distanceToSqr(entity);
            if (distance < nearest) {
                nearest = distance;
                best = entity;
            }
        }
        return best;
    }

    /**
     * Whether a step that way lands somewhere a person would step.
     *
     * Passable at head and foot, something under it within a survivable drop,
     * and nothing there that burns.
     */
    private static boolean canGo(Minecraft client, LocalPlayer player, double yaw) {
        ClientBlockView world = ground;
        if (world == null) return false;
        double radians = Math.toRadians(yaw);
        int x = (int) Math.floor(player.getX() - Math.sin(radians));
        int z = (int) Math.floor(player.getZ() + Math.cos(radians));
        int y = player.blockPosition().getY();

        if (!world.known(x, y, z)) return false;
        if (!world.passable(x, y, z) || !world.passable(x, y + 1, z)) return false;
        if (world.hazard(x, y, z) || world.hazard(x, y - 1, z)) return false;
        for (int drop = 1; drop <= SAFE_DROP; drop++) {
            if (world.hazard(x, y - drop, z)) return false;
            if (world.solid(x, y - drop, z)) return true;
        }
        return false;
    }

    /** Something at your back, so nothing walks round behind you. */
    private static boolean solidBehind(Minecraft client, LocalPlayer player, double yaw) {
        ClientBlockView world = ground;
        if (world == null) return false;
        double radians = Math.toRadians(yaw);
        int x = (int) Math.floor(player.getX() - Math.sin(radians) * 2);
        int z = (int) Math.floor(player.getZ() + Math.cos(radians) * 2);
        int y = player.blockPosition().getY();
        return world.solid(x, y, z) && world.solid(x, y + 1, z);
    }

    /** The middle of the body rather than the feet or the eyes. */
    private static Vec3 aimPoint(Entity entity) {
        return entity.position().add(0, entity.getBbHeight() * 0.6, 0);
    }

    /**
     * Whether it is pointed at us.
     *
     * The honest client-side answer to "is this thing hostile right now". A
     * mob's actual target lives on the server and is never sent, so the only
     * readable signal is which way it is looking — good enough for the one
     * question that needs it: whether a spider in daylight is scenery.
     */
    private static boolean facingUs(Entity entity, LocalPlayer player) {
        double dx = player.getX() - entity.getX();
        double dz = player.getZ() - entity.getZ();
        double toUs = Math.toDegrees(Math.atan2(dz, dx)) - 90.0;
        double difference = Math.abs(wrap(toUs - entity.getYRot()));
        return difference < FACING_US;
    }

    private static double wrap(double degrees) {
        double wrapped = (degrees + 180) % 360;
        if (wrapped < 0) wrapped += 360;
        return wrapped - 180;
    }

    private static Entity nearestOfKind(List<Entity> seen, List<Combat.Foe> foes, String kind) {
        Entity best = null;
        double worst = -1;
        for (int i = 0; i < seen.size(); i++) {
            if (!foes.get(i).kind().equals(kind)) continue;
            // The same ranking Combat used to choose the kind, so the entity
            // picked here is the one it was actually reasoning about — nearest
            // would pick a different skeleton from the wounded one it meant.
            double score = Combat.threatOf(foes.get(i));
            if (score > worst) {
                worst = score;
                best = seen.get(i);
            }
        }
        return best;
    }

    static String kindOf(Entity entity) {
        return BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).getPath();
    }

    private static boolean isBaby(Entity entity) {
        return entity instanceof LivingEntity living && living.isBaby();
    }

    /** What the client already knows for drawing its health bar. */
    private static double healthOf(Entity entity) {
        return entity instanceof LivingEntity living ? living.getHealth() : 20;
    }

    private static double healthFraction(LocalPlayer player) {
        return player.getMaxHealth() <= 0 ? 1 : player.getHealth() / player.getMaxHealth();
    }

    private static void letGo(Minecraft client) {
        stand(client);
        Keys.set(client.options.keyJump, false);
        Keys.set(client.options.keyUse, false);
        target = null;
        jumpedAt = 0;
        drawing = 0;
    }

    private static int roll(int spread) {
        return rng == null ? spread / 2 : rng.intRange(0, spread);
    }

    /** What Safety puts on the overlay; it does the once-per-situation part. */
    private static void say(String line) {
        lastSaid = line;
    }
}
