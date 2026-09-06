package dev.understudy.mc;

import dev.understudy.core.path.BlockView;
import dev.understudy.core.path.Pursuit;
import dev.understudy.core.path.Smoother;
import dev.understudy.core.path.Step;
import dev.understudy.human.Look;
import dev.understudy.human.Rng;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.InteractionHand;

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
    private BlockPos digging;
    private int digTicks;
    private int sidestep;
    private BlockView world;

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
        this.world = world;
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
        Keys.set(client.options.keyUp, false);
        Keys.set(client.options.keyDown, false);
        Keys.set(client.options.keyLeft, false);
        Keys.set(client.options.keyRight, false);
        Keys.set(client.options.keyJump, false);
        Keys.set(client.options.keySprint, false);
        sidestep = 0;
    }

    public void stop() {
        path = List.of();
        index = 0;
        stopDigging();
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

        // A dig step is a block in the way, not a place to walk to. Cutting
        // through is what lets a route go over a hill instead of round it, and
        // routing round everything is most of why long journeys used to wander.
        if (step.kind() == Step.Kind.DIG && digThrough(player, step)) return true;

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
        Keys.set(client.options.keyUp, forward);

        boolean straightAhead = offCourse < EASE_FROM_DEGREES && aim.bend() < 0.6;
        Keys.set(client.options.keySprint, allowSprint
                && straightAhead
                && aim.remaining() > SPRINT_MIN_REMAINING
                && player.getFoodData().getFoodLevel() > 6);

        boolean needsJump = step.kind() == Step.Kind.JUMP
                || (player.isInWater() && dy > -0.2)
                || stuckTicks > 12;
        Keys.set(client.options.keyJump, needsJump);

        // Jumping gets you over a step. It does nothing about a fence post you
        // are pressed against, and pressing forward harder never has. So after
        // a couple of seconds of no progress, lean out sideways — alternating,
        // because whichever way the obstruction is, one of the two is past it.
        //
        // Only onto ground, though. Blind strafing is a fine way to unstick
        // yourself from a fence and an excellent way to walk off the cliff you
        // were stuck at the edge of, and the second one costs a life.
        boolean left = false;
        boolean right = false;
        if (stuckTicks > 25) {
            sidestep++;
            boolean preferLeft = (sidestep / 12) % 2 == 0;
            if (canStrafe(player, preferLeft)) {
                left = preferLeft;
                right = !preferLeft;
            } else if (canStrafe(player, !preferLeft)) {
                left = !preferLeft;
                right = preferLeft;
            }
        }
        Keys.set(client.options.keyLeft, left);
        Keys.set(client.options.keyRight, right);
        return true;
    }

    /**
     * Whether stepping one block to the side lands on something.
     *
     * The pathfinder's own rule, asked of the block beside you: feet and head
     * clear, nothing that hurts, and ground underneath — or water, which you
     * can fall a block into without noticing. Anything else and the key stays
     * up, because the alternative to being stuck is not always better.
     */
    private boolean canStrafe(LocalPlayer player, boolean leftward) {
        if (world == null) return false;
        double yaw = Math.toRadians(player.getYRot());
        // Facing south (yaw 0, +Z) your left hand points east: (cos, sin).
        double vx = Math.cos(yaw);
        double vz = Math.sin(yaw);
        if (!leftward) {
            vx = -vx;
            vz = -vz;
        }
        int x = (int) Math.floor(player.getX() + vx * 0.9);
        int y = (int) Math.floor(player.getY());
        int z = (int) Math.floor(player.getZ() + vz * 0.9);

        if (!world.known(x, y, z)) return false;
        if (world.hazard(x, y, z) || world.hazard(x, y + 1, z)) return false;
        if (!world.passable(x, y, z) || !world.passable(x, y + 1, z)) return false;
        return world.solid(x, y - 1, z) || world.liquid(x, y - 1, z) || world.liquid(x, y, z);
    }

    /**
     * Break what is in the way. Returns true while there is still digging to do.
     *
     * Both the block at head height and the one at foot height, because a player
     * is two blocks tall and a tunnel one block high is a tunnel you cannot walk
     * down.
     */
    private boolean digThrough(LocalPlayer player, Step step) {
        if (client.gameMode == null || client.level == null) return false;

        BlockPos feet = new BlockPos(step.x(), step.y(), step.z());
        BlockPos head = feet.above();
        BlockPos target = !client.level.getBlockState(head).isAir() ? head
                : !client.level.getBlockState(feet).isAir() ? feet : null;

        if (target == null) {
            stopDigging();
            return false; // the way is clear; walk it
        }
        if (player.blockPosition().distSqr(target) > 25) {
            stopDigging();
            return false; // too far to reach: walk closer first
        }

        if (!target.equals(digging)) {
            digging = target;
            digTicks = 0;
            client.gameMode.startDestroyBlock(target, Direction.UP);
        }
        lookAtBlock(player, target);
        client.gameMode.continueDestroyBlock(target, Direction.UP);
        player.swing(InteractionHand.MAIN_HAND);

        // Bedrock, or something a server will not let you break. Give up on the
        // step rather than standing there hitting it forever.
        if (++digTicks > 200) {
            stopDigging();
            stuckTicks = 999;
        }
        return true;
    }

    private void stopDigging() {
        if (digging != null && client.gameMode != null) client.gameMode.stopDestroyBlock();
        digging = null;
        digTicks = 0;
    }

    private void lookAtBlock(LocalPlayer player, BlockPos at) {
        double dx = at.getX() + 0.5 - player.getX();
        double dy = at.getY() + 0.5 - (player.getY() + player.getEyeHeight());
        double dz = at.getZ() + 0.5 - player.getZ();
        double horizontal = Math.sqrt(dx * dx + dz * dz);
        look.tick(Math.toDegrees(Math.atan2(dz, dx)) - 90.0,
                -Math.toDegrees(Math.atan2(dy, horizontal)));
        player.setYRot((float) look.yaw());
        player.setXRot((float) look.pitch());
    }
}
