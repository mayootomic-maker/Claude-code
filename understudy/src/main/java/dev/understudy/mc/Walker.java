package dev.understudy.mc;

import dev.understudy.core.path.BlockView;
import dev.understudy.core.path.Pursuit;
import dev.understudy.core.path.Smoother;
import dev.understudy.core.path.Step;
import dev.understudy.human.Look;
import dev.understudy.human.Rng;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;

import java.util.List;

/**
 * Walks a path by holding down the same keys a player would.
 *
 * Driving the movement keys rather than teleporting or writing to the player's
 * velocity means the client's own physics, collision and anti-cheat-visible
 * movement all behave exactly as they do when a person plays: there is no
 * separate code path for "the mod is moving you". It also means the walk can be
 * interrupted at any tick simply by letting go.
 *
 * The first version of this walked straight at the next block's centre and
 * turned at a fixed number of degrees per tick, and it looked exactly as bad as
 * that description sounds. Three things fix it, and none of them are here:
 * Smoother takes the staircase out of the path, Pursuit aims at a point further
 * along it rather than at the next block, and Look turns the view like a mass on
 * a spring instead of a stepper motor. What is left in this file is deciding
 * which keys that implies.
 */
public final class Walker {

    /** Turn this far off course and it is worth slowing down for. */
    private static final double EASE_FROM_DEGREES = 35;
    /** Past this, stop walking and turn first, the way you would at a wall. */
    private static final double STOP_AND_TURN_DEGREES = 100;
    private static final double SPRINT_MIN_REMAINING = 6;

    private final Minecraft client;
    private final Look look;
    private List<Step> path = List.of();
    private int index;
    private int stuckTicks;
    private double lastProgress = Double.MAX_VALUE;

    public Walker(Minecraft client, Rng rng) {
        this.client = client;
        LocalPlayer player = client.player;
        this.look = new Look(rng,
                player == null ? 0 : player.getYRot(),
                player == null ? 0 : player.getXRot());
    }

    /**
     * Take a path, with the world it was found in so the corners can be pulled
     * out of it. Smoothing needs to see the blocks, and this is the only place
     * that has both.
     */
    public void follow(List<Step> steps, BlockView world) {
        this.path = Smoother.smooth(steps, world);
        this.index = 0;
        this.stuckTicks = 0;
        this.lastProgress = Double.MAX_VALUE;
        LocalPlayer player = client.player;
        if (player != null) look.reset(player.getYRot(), player.getXRot());
    }

    public boolean done() {
        return index >= path.size();
    }

    public boolean stuck() {
        return stuckTicks > 60;
    }

    public Step current() {
        return done() ? null : path.get(index);
    }

    public int waypoints() {
        return path.size();
    }

    /** Let go of everything. Always safe to call. */
    public void release() {
        client.options.keyUp.setDown(false);
        client.options.keyDown.setDown(false);
        client.options.keyLeft.setDown(false);
        client.options.keyRight.setDown(false);
        client.options.keyJump.setDown(false);
        client.options.keySprint.setDown(false);
    }

    public void stop() {
        path = List.of();
        index = 0;
        release();
    }

    /** Advance one tick. Returns false when there is nothing left to walk. */
    public boolean tick(boolean allowSprint) {
        LocalPlayer player = client.player;
        if (player == null || done()) {
            release();
            return false;
        }

        Pursuit.Aim aim = Pursuit.aim(path, index, player.getX(), player.getZ());
        index = aim.index();
        if (done()) {
            release();
            return false;
        }

        Step step = path.get(index);
        double dy = step.y() - player.getY();

        if (aim.remaining() < Pursuit.REACHED && Math.abs(dy) < 1.2) {
            index = path.size();
            release();
            return false;
        }

        // Not getting closer for three seconds means something is in the way
        // that the path did not know about.
        if (aim.remaining() >= lastProgress - 0.01) stuckTicks++;
        else stuckTicks = 0;
        lastProgress = aim.remaining();

        double wantedYaw = Math.toDegrees(Math.atan2(aim.z() - player.getZ(),
                aim.x() - player.getX())) - 90.0;
        // Look a little down the way you do when watching your footing, and
        // further down when there is a step to take.
        double wantedPitch = dy < -0.5 ? 22 : 8;

        look.tick(wantedYaw, wantedPitch);
        player.setYRot((float) look.yaw());
        player.setXRot((float) look.pitch());

        double offCourse = Math.abs(Look.wrap(wantedYaw - look.yaw()));
        // Walking forward while facing the wrong way is how you scrape along
        // walls and end up in the corner of a room. Turn first.
        boolean forward = offCourse < STOP_AND_TURN_DEGREES;
        client.options.keyUp.setDown(forward);

        boolean straightAhead = offCourse < EASE_FROM_DEGREES && aim.bend() < 0.6;
        client.options.keySprint.setDown(allowSprint
                && straightAhead
                && aim.remaining() > SPRINT_MIN_REMAINING
                && player.getFoodData().getFoodLevel() > 6);

        boolean needsJump = step.kind() == Step.Kind.JUMP
                || (player.isInWater() && dy > -0.2)
                || stuckTicks > 12;
        client.options.keyJump.setDown(needsJump);
        return true;
    }
}
