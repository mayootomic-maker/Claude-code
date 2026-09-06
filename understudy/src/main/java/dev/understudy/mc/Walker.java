package dev.understudy.mc;

import dev.understudy.core.path.Step;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.util.math.MathHelper;

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

    private final MinecraftClient client;
    private List<Step> path = List.of();
    private int index;
    private int stuckTicks;
    private double lastProgress = Double.MAX_VALUE;

    public Walker(MinecraftClient client) {
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
        client.options.forwardKey.setPressed(false);
        client.options.backKey.setPressed(false);
        client.options.leftKey.setPressed(false);
        client.options.rightKey.setPressed(false);
        client.options.jumpKey.setPressed(false);
        client.options.sprintKey.setPressed(false);
    }

    public void stop() {
        path = List.of();
        index = 0;
        release();
    }

    /** Advance one tick. Returns false when there is nothing left to walk. */
    public boolean tick(boolean allowSprint) {
        ClientPlayerEntity player = client.player;
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

        client.options.forwardKey.setPressed(true);
        client.options.sprintKey.setPressed(allowSprint && horizontal > 2 && player.getHungerManager().getFoodLevel() > 6);
        // Jump for a step up, to get out of water, or when the walk has snagged
        // on something a block high that the path did not model.
        boolean needsJump = step.kind() == Step.Kind.JUMP
                || (player.isTouchingWater() && dy > -0.2)
                || stuckTicks > 12;
        client.options.jumpKey.setPressed(needsJump);
        return true;
    }

    /**
     * Turn toward the target, but only so far per tick.
     *
     * A path change would otherwise snap the view instantly, which is both
     * unpleasant to watch from inside the game and nothing like how a person
     * turns a corner.
     */
    private void face(ClientPlayerEntity player, double dx, double dz) {
        float wanted = (float) (Math.toDegrees(Math.atan2(dz, dx)) - 90.0);
        float delta = MathHelper.wrapDegrees(wanted - player.getYaw());
        float clamped = MathHelper.clamp(delta, -MAX_TURN_DEGREES, MAX_TURN_DEGREES);
        player.setYaw(player.getYaw() + clamped);
        // Look slightly down, the way you do when watching where you are going.
        player.setPitch(MathHelper.clamp(player.getPitch() + (10f - player.getPitch()) * 0.1f, -90f, 90f));
    }
}
