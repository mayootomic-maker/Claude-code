package dev.understudy.mc;

import dev.understudy.human.Look;
import dev.understudy.human.Rng;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.world.phys.Vec3;

/**
 * Where the view is pointing, and the only thing allowed to move it.
 *
 * The single largest reason this still looked like a bot. A lot of care went
 * into the walk — a critically damped spring, a reaction delay, a tremor — and
 * then every other thing the mod does set the view directly. Mining six hundred
 * deepslate was six hundred instant camera teleports; so was every block of a
 * house, every chest opened, every furnace loaded. Walking is a small fraction
 * of what you watch it do, so the careful part was the part you rarely saw.
 *
 * Worse, two of them could want the view in the same tick. During a build the
 * walker aims down the path and the builder aims at the block, both write, and
 * the result is a view that jitters between them — which reads as broken rather
 * than merely mechanical.
 *
 * So nothing sets the view any more. A task says where it would like to look;
 * this turns the head, once per tick, the way a person does. Last request in
 * the tick wins, which is naturally the thing that matters most: the walker
 * asks continuously, and anything doing something deliberate asks after it.
 */
public final class Aim {
    private Aim() {}

    /** Close enough to swing at, in degrees. A person does not aim to the pixel. */
    private static final double ON_TARGET = 6.0;

    private static Look look;
    private static double wantYaw;
    private static double wantPitch;
    private static boolean asked;
    private static float leftYaw;
    private static float leftPitch;

    /**
     * One head, seeded from the account, so the way it moves is the same every
     * session rather than different every launch.
     */
    public static void begin(Rng rng, LocalPlayer player) {
        look = new Look(rng, player.getYRot(), player.getXRot());
        wantYaw = player.getYRot();
        wantPitch = player.getXRot();
        asked = false;
        settled(player);
    }

    /** Look at a point in the world — a block's face, a mob, a spot on the ground. */
    static void at(LocalPlayer player, Vec3 target) {
        double dx = target.x - player.getX();
        double dy = target.y - (player.getY() + player.getEyeHeight());
        double dz = target.z - player.getZ();
        double flat = Math.sqrt(dx * dx + dz * dz);
        at(Math.toDegrees(Math.atan2(dz, dx)) - 90.0,
                -Math.toDegrees(Math.atan2(dy, flat)));
    }

    static void at(LocalPlayer player, BlockPos block) {
        at(player, Vec3.atCenterOf(block));
    }

    /** Look this way, in degrees. */
    static void at(double yaw, double pitch) {
        wantYaw = yaw;
        wantPitch = pitch;
        asked = true;
    }

    /**
     * Whether the head has caught up enough to act.
     *
     * Callers wait on this before swinging or placing, which is what stops the
     * mod hitting a block it is not yet facing — a thing that is both obviously
     * inhuman and, on a server, obviously a mod.
     */
    static boolean onTarget() {
        return look == null || look.settled(wantYaw, ON_TARGET);
    }

    static double yaw() {
        return look == null ? wantYaw : look.yaw();
    }

    /**
     * Move the head one tick toward wherever it was asked to look.
     *
     * Called once, from the client tick, after every task has had its say. If
     * nobody asked for anything this tick the head simply stays put: an idle
     * mod should not be gently drifting the view.
     */
    public static void tick(LocalPlayer player) {
        if (look == null || !asked) return;
        look.tick(wantYaw, wantPitch);
        player.setYRot((float) look.yaw());
        player.setXRot((float) look.pitch());
        asked = false;
    }

    /**
     * Write down the view as the tick is leaving it.
     *
     * The one thing that makes "did the person move the mouse" answerable. The
     * view has exactly two authors — this class, once per tick, and the mouse,
     * between ticks — so anything that differs from what this left behind was a
     * hand on the mouse and nothing else.
     *
     * It has to be called at the very end of the tick, after {@link #tick}, on
     * every path out of it including the ones that turn nothing and the one
     * that throws. Recorded at the start instead and the mod's own turning
     * reads as the player's: it hands the controls back the instant it starts
     * working, then takes them again, forever.
     */
    public static void settled(LocalPlayer player) {
        if (player == null) return;
        leftYaw = player.getYRot();
        leftPitch = player.getXRot();
    }

    /** How far the view has moved since then, in degrees. Mouse only. */
    public static double movedSinceSettled(LocalPlayer player) {
        if (player == null) return 0.0;
        return Math.max(Math.abs(turn(player.getYRot() - leftYaw)),
                Math.abs(player.getXRot() - leftPitch));
    }

    /** Degrees the short way round, so 359 to 1 is two and not three hundred. */
    private static double turn(double degrees) {
        double wrapped = (degrees + 180.0) % 360.0;
        if (wrapped < 0.0) wrapped += 360.0;
        return wrapped - 180.0;
    }

    /**
     * Put the head there this instant, with no spring and no reaction time.
     *
     * The one deliberate exception to everything this class is for, and it
     * exists because the alternative was a setting that did not work. A build
     * waits for the head before every block, and the spring settles in about a
     * third of a second — so however many blocks a tick the speed setting
     * allowed, the real rate was two or three a second at every setting, and
     * "flat out" was indistinguishable from "steady". Flat out is described as
     * "like a mod" because that is exactly what it is: it gives up looking like
     * a person in exchange for going roughly fifty times faster. Nothing else
     * in the mod may call this.
     */
    static void snapAt(LocalPlayer player, Vec3 target) {
        double dx = target.x - player.getX();
        double dy = target.y - (player.getY() + player.getEyeHeight());
        double dz = target.z - player.getZ();
        double flat = Math.sqrt(dx * dx + dz * dz);
        float yaw = (float) (Math.toDegrees(Math.atan2(dz, dx)) - 90.0);
        float pitch = (float) -Math.toDegrees(Math.atan2(dy, flat));
        player.setYRot(yaw);
        player.setXRot(pitch);
        wantYaw = yaw;
        wantPitch = pitch;
        asked = false;
        // The spring is moved with it rather than left behind, or the first
        // tick after the build ends swings the view back to wherever the
        // careful half thought the head was.
        if (look != null) look.reset(yaw, pitch);
    }

    /** The same, at a block, which is what a build actually has. */
    static void snapAt(LocalPlayer player, BlockPos block) {
        snapAt(player, Vec3.atCenterOf(block));
    }

    /** Hands off — the view is the player's again. */
    public static void release(LocalPlayer player) {
        asked = false;
        if (look != null && player != null) look.reset(player.getYRot(), player.getXRot());
        settled(player);
    }
}
