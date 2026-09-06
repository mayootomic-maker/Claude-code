package dev.understudy.mc;

import dev.understudy.core.path.Step;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.util.Mth;

import java.util.List;

/**
 * Walks a path by holding down the same keys a player would.
 *
 * Driving the movement keys rather than teleporting or writing to the player's
 * velocity means the client's own physics, collision and anti-cheat-visible
 * movement all behave exactly as they do when a person plays: there is no
 * separate code path for "the mod is moving you". It also means the walk can be
 * interrupted at any tick simply by letting go.
 */
public final class Walker {

    /** Close enough to a step's centre to move on to the next one. */
    private static final double ARRIVED = 0.6;
    /** Turn no faster than this per tick, so the view does not snap. */
    private static final float MAX_TURN_DEGREES = 22f;

    private final Minecraft client;
    private List<Step> path = List.of();
    private int index;
    private int stuckTicks;
    private double lastProgress = Double.MAX_VALUE;

    public Walker(Minecraft client) {
        this.client = client;
    }

    public void follow(List<Step> steps) {
        this.path = steps;
        this.index = 0;
        this.stuckTicks = 0;
        this.lastProgress = Double.MAX_VALUE;
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

        Step step = path.get(index);
        double targetX = step.x() + 0.5;
        double targetZ = step.z() + 0.5;
        double dx = targetX - player.getX();
        double dz = targetZ - player.getZ();
        double horizontal = Math.sqrt(dx * dx + dz * dz);
        double dy = step.y() - player.getY();

        if (horizontal < ARRIVED && Math.abs(dy) < 1.2) {
            index++;
            stuckTicks = 0;
            lastProgress = Double.MAX_VALUE;
            if (done()) {
                release();
                return false;
            }
            return true;
        }

        // Not getting closer for three seconds means something is in the way
        // that the path did not know about.
        if (horizontal >= lastProgress - 0.01) stuckTicks++;
        else stuckTicks = 0;
        lastProgress = horizontal;

        face(player, dx, dz);

        client.options.keyUp.setDown(true);
        client.options.keySprint.setDown(allowSprint && horizontal > 2 && player.getFoodData().getFoodLevel() > 6);
        // Jump for a step up, to get out of water, or when the walk has snagged
        // on something a block high that the path did not model.
        boolean needsJump = step.kind() == Step.Kind.JUMP
                || (player.isInWater() && dy > -0.2)
                || stuckTicks > 12;
        client.options.keyJump.setDown(needsJump);
        return true;
    }

    /**
     * Turn toward the target, but only so far per tick.
     *
     * A path change would otherwise snap the view instantly, which is both
     * unpleasant to watch from inside the game and nothing like how a person
     * turns a corner.
     */
    private void face(LocalPlayer player, double dx, double dz) {
        float wanted = (float) (Math.toDegrees(Math.atan2(dz, dx)) - 90.0);
        float delta = Mth.wrapDegrees(wanted - player.getYRot());
        float clamped = Mth.clamp(delta, -MAX_TURN_DEGREES, MAX_TURN_DEGREES);
        player.setYRot(player.getYRot() + clamped);
        // Look slightly down, the way you do when watching where you are going.
        player.setXRot(Mth.clamp(player.getXRot() + (10f - player.getXRot()) * 0.1f, -90f, 90f));
    }
}
