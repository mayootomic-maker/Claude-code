package dev.understudy.mc;

import dev.understudy.core.survive.Combat;
import dev.understudy.human.Rng;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.monster.Monster;
import net.minecraft.world.phys.Vec3;

import java.util.ArrayList;
import java.util.List;

/**
 * Actually swinging at things.
 *
 * Combat decides; this does. The split is the usual one in this mod and it
 * earns its keep here more than anywhere: every rule about creepers and reach
 * and swing timing is tested without a game, and what is left in this file is
 * reading an entity list, pressing a key and calling attack.
 *
 * Two details in here are the difference between a mod that fights and a mod
 * that fights well, and neither is in Combat because both are about the body
 * rather than the decision:
 *
 * The swing is charged before it lands. Minecraft recovers an attack over about
 * six ticks with a sword, and a hit at half charge does about half damage with
 * no sweep. Clicking as fast as possible — which is what every naive combat bot
 * does, and what it looks like from the outside — is a third of the damage and
 * unmistakably not a person.
 *
 * And it jumps. A hit taken while falling is a critical: fifty per cent more
 * damage, for the price of a keypress that people make so habitually they stop
 * noticing they are doing it. It is the single cheapest damage increase in the
 * game and it is also, conveniently, what a human looks like.
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
    private static final double WATCH = 16.0;
    /** Within this angle of facing us, a mob is looking at us. */
    private static final double FACING_US = 50.0;
    /** Ticks between noticing something and acting on it. */
    private static final int REACTION_MIN = 3;
    private static final int REACTION_SPREAD = 5;

    private static Rng rng;
    private static Entity target;
    private static int reaction;
    private static int jumpedAt;
    private static String lastSaid = "";

    /** Seeded from the account, like every other timing in this mod. */
    public static void begin(Rng seeded) {
        rng = seeded;
        target = null;
        reaction = 0;
        lastSaid = "";
    }

    /** Forget the fight. Called whenever the mod goes idle. */
    public static void reset() {
        target = null;
        reaction = 0;
        jumpedAt = 0;
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
     *                       mob's own target is server-side and never reaches
     *                       the client
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
            foes.add(new Combat.Foe(kindOf(entity), distance, isBaby(entity),
                    facingUs(entity, player)));
        }
        if (foes.isEmpty()) {
            reset();
            return Outcome.CLEAR;
        }

        double weaponDps = Combat.bestWeaponDps(Carried.contents(player));
        Combat.Plan plan = Combat.decide(foes, healthFraction(player), weaponDps,
                player.getAttackStrengthScale(0.0f), damageRecently);

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
        // exact tick something crossed sixteen blocks is a fight nobody could
        // have seen coming.
        if (target == null) {
            reaction = REACTION_MIN + roll(REACTION_SPREAD);
            arm(client, player);
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
        switch (stance) {
            case CLOSE -> {
                Keys.set(client.options.keyDown, false);
                Keys.set(client.options.keyUp, true);
            }
            case BACK_OFF -> {
                Keys.set(client.options.keyUp, false);
                Keys.set(client.options.keyDown, true);
            }
            case HOLD -> {
                Keys.set(client.options.keyUp, false);
                Keys.set(client.options.keyDown, false);
            }
            case STRIKE -> {
                Keys.set(client.options.keyUp, false);
                Keys.set(client.options.keyDown, false);
                if (Aim.onTarget()) swing(client, player, target);
            }
            default -> { }
        }
    }

    /**
     * Hit it, from the air if that can be arranged.
     *
     * A hit landed while falling is a critical. The jump has to come first and
     * the swing has to wait for the way down, so this is two ticks apart: press
     * jump, and on a later tick — once the fall has actually started — swing.
     * If the jump did not happen (in water, under a low ceiling) the swing goes
     * ahead anyway rather than waiting for a fall that is never coming.
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

    /** Best weapon in hand before anything else happens. */
    static boolean arm(Minecraft client, LocalPlayer player) {
        String weapon = Combat.bestWeapon(Carried.contents(player));
        return weapon != null && Hotbar.hold(client, weapon);
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
     * readable signal is which way it is looking — which is good enough for the
     * one question that needs it: whether a spider in daylight is scenery.
     */
    private static boolean facingUs(Entity entity, LocalPlayer player) {
        double dx = player.getX() - entity.getX();
        double dz = player.getZ() - entity.getZ();
        double bearing = Math.toDegrees(Math.atan2(dz, dx)) - 90.0;
        double difference = Math.abs(wrap(bearing - entity.getYRot()));
        return difference < FACING_US;
    }

    private static double wrap(double degrees) {
        double wrapped = (degrees + 180) % 360;
        if (wrapped < 0) wrapped += 360;
        return wrapped - 180;
    }

    private static Entity nearestOfKind(List<Entity> seen, List<Combat.Foe> foes, String kind) {
        Entity best = null;
        double nearest = Double.MAX_VALUE;
        for (int i = 0; i < seen.size(); i++) {
            if (!foes.get(i).kind().equals(kind)) continue;
            if (foes.get(i).distance() < nearest) {
                nearest = foes.get(i).distance();
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

    private static double healthFraction(LocalPlayer player) {
        return player.getMaxHealth() <= 0 ? 1 : player.getHealth() / player.getMaxHealth();
    }

    private static void letGo(Minecraft client) {
        Keys.set(client.options.keyUp, false);
        Keys.set(client.options.keyDown, false);
        Keys.set(client.options.keyJump, false);
        target = null;
        jumpedAt = 0;
    }

    private static int roll(int spread) {
        return rng == null ? spread / 2 : rng.intRange(0, spread);
    }

    /** What Safety puts on the overlay; it does the once-per-situation part. */
    private static void say(String line) {
        lastSaid = line;
    }
}
