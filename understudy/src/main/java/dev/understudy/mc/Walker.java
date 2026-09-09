package dev.understudy.mc;

import dev.understudy.core.path.BlockView;
import dev.understudy.core.path.Lean;
import dev.understudy.core.path.Progress;
import dev.understudy.core.path.Pursuit;
import dev.understudy.core.path.Smoother;
import dev.understudy.core.path.Step;
import dev.understudy.human.Look;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;

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
 * along it rather than at the next block, and Aim turns the view like a mass on
 * a spring instead of a stepper motor. What is left in this file is deciding
 * which keys that implies.
 *
 * The head belongs to Aim rather than to this file, and that matters even
 * though the walk was the one place already doing it properly: during a build
 * the walker wants to look down the path while the builder wants to look at the
 * block, and two writers in one tick is a view that shakes.
 *
 * Nor is "am I stuck, and what should I try" here any more. That was the single
 * most complained-about behaviour in the mod and it lived in the middle of this
 * file, mixed in with key presses and Minecraft types, where it could not be
 * tested. It is Progress and Lean now, both of which are arithmetic over
 * positions and blocks, and both of which have a test for every rule — one of
 * which caught a bug on the first run: the old check compared the distance to
 * the *look-ahead point* with last tick's, so scraping along a wall at a fifth
 * of walking speed counted as progress indefinitely.
 */
public final class Walker {

    /** Turn this far off course and it is worth slowing down for. */
    private static final double EASE_FROM_DEGREES = 35;
    /** Past this, stop walking and turn first, the way you would at a wall. */
    private static final double STOP_AND_TURN_DEGREES = 100;
    private static final double SPRINT_MIN_REMAINING = 6;

    private final Minecraft client;
    private List<Step> path = List.of();
    private int index;
    private final Progress progress = new Progress();
    private BlockPos goal = BlockPos.ZERO;
    private boolean wantsRepath;
    private BlockPos digging;
    private int digTicks;
    private BlockView world;
    private boolean mayDig;
    private BlockPos opening;
    private int openTicks;

    public Walker(Minecraft client) {
        this.client = client;
    }

    /**
     * Take a path, with the world it was found in so the corners can be pulled
     * out of it. Smoothing needs to see the blocks, and this is the only place
     * that has both.
     */
    public void follow(List<Step> steps, BlockView world) {
        follow(steps, world, false);
    }

    public void follow(List<Step> steps, BlockView world, boolean mayDig) {
        this.path = Smoother.smooth(steps, world);
        this.world = world;
        this.mayDig = mayDig;
        this.opening = null;
        this.openTicks = 0;
        this.index = 0;
        this.goal = steps.isEmpty() ? BlockPos.ZERO
                : new BlockPos(steps.get(steps.size() - 1).x(),
                        steps.get(steps.size() - 1).y(), steps.get(steps.size() - 1).z());
        this.wantsRepath = false;
        this.progress.restart();
        Aim.release(client.player);
    }

    public boolean done() {
        return index >= path.size();
    }

    /**
     * Whether to stop trying this route.
     *
     * Two different failures, and the caller wants a new path for both: one is
     * wedged against geometry nothing here can get past, the other is walking
     * perfectly well and getting no nearer.
     */
    public boolean stuck() {
        return progress.hopeless() || wantsRepath;
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
        if (step.kind() == Step.Kind.BRIDGE && bridge(player, step)) return true;

        if (aim.remaining() < Pursuit.REACHED && Math.abs(dy) < 1.2) {
            index = path.size();
            release();
            return false;
        }

        // What the walk is actually doing, judged on where the player has been
        // rather than on where the aim point is: the aim point runs ahead as
        // you walk, which is why measuring against it cannot tell walking from
        // circling.
        Progress.Move move = progress.next(player.getX(), player.getY(), player.getZ(),
                Math.sqrt(player.distanceToSqr(goal.getX() + 0.5, goal.getY(), goal.getZ() + 0.5)));
        if (move == Progress.Move.REPATH || move == Progress.Move.GIVE_UP) {
            wantsRepath = move == Progress.Move.REPATH;
            release();
            return true;
        }

        double wantedYaw = Math.toDegrees(Math.atan2(aim.z() - player.getZ(),
                aim.x() - player.getX())) - 90.0;
        // Look a little down the way you do when watching your footing, and
        // further down when there is a step to take.
        double wantedPitch = dy < -0.5 ? 22 : 8;

        Aim.at(wantedYaw, wantedPitch);

        double offCourse = Math.abs(Look.wrap(wantedYaw - Aim.yaw()));
        // Walking forward while facing the wrong way is how you scrape along
        // walls and end up in the corner of a room. Turn first.
        boolean forward = offCourse < STOP_AND_TURN_DEGREES;
        Keys.set(client.options.keyUp, forward);

        boolean straightAhead = offCourse < EASE_FROM_DEGREES && aim.bend() < 0.6;
        Keys.set(client.options.keySprint, allowSprint
                && straightAhead
                && aim.remaining() > SPRINT_MIN_REMAINING
                && player.getFoodData().getFoodLevel() > 6);

        // Something is in the way that the route did not think was in the way.
        // A shut door is the common one and costs a click; anything else, if
        // this route was allowed to tunnel, costs a few seconds of mining. Both
        // beat the alternative, which is leaning on a wall until the task gives
        // up and tells you it cannot find a way somewhere it is standing.
        if ((move == Progress.Move.OPEN || move == Progress.Move.DIG)
                && unstick(player, move == Progress.Move.DIG)) {
            return true;
        }

        Keys.set(client.options.keyJump, step.kind() == Step.Kind.JUMP
                || (player.isInWater() && dy > -0.2)
                || move == Progress.Move.JUMP
                || move == Progress.Move.LEAN_LEFT || move == Progress.Move.LEAN_RIGHT);

        // Jumping gets you over a step. It does nothing about a fence post you
        // are pressed against, and pressing forward harder never has — so lean
        // out sideways instead, onto a block that has been checked first. If
        // neither side is somewhere to put a foot, stay put: the alternative to
        // being stuck is not always better.
        boolean leanLeft = false;
        boolean leanRight = false;
        if (move == Progress.Move.LEAN_LEFT || move == Progress.Move.LEAN_RIGHT) {
            boolean wanted = move == Progress.Move.LEAN_LEFT;
            if (canStrafe(player, wanted)) {
                leanLeft = wanted;
                leanRight = !wanted;
            } else if (canStrafe(player, !wanted)) {
                leanLeft = !wanted;
                leanRight = wanted;
            }
        }
        Keys.set(client.options.keyLeft, leanLeft);
        Keys.set(client.options.keyRight, leanRight);
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
        int[] at = Lean.cell(player.getX(), player.getY(), player.getZ(),
                player.getYRot(), leftward);
        return Lean.safe(world, at[0], at[1], at[2]);
    }

    /**
     * Deal with whatever is actually in the way, rather than pressing harder.
     *
     * Returns true when it took the tick. Doors first, because a door is a
     * second's work and a person would simply open it; digging only if this
     * route was planned as one that may tunnel, since chewing through a wall
     * you were only meant to walk past is not an improvement.
     */
    private boolean unstick(LocalPlayer player, boolean mayCut) {
        if (world == null || client.level == null) return false;
        BlockPos ahead = inFront(player);

        if (opening != null || world.openable(ahead.getX(), ahead.getY(), ahead.getZ())) {
            if (opening == null) {
                opening = ahead;
                openTicks = 0;
            }
            lookAtBlock(player, opening);
            // A few ticks of turning first, so the click lands on a door the
            // view is already pointed at rather than snapping onto it.
            if (++openTicks < 5) return true;
            Placement.use(client, player, opening);
            opening = null;
            progress.restart();
            return true;
        }
        if (mayDig && mayCut) return digAt(player, ahead);
        return false;
    }

    /**
     * Put a block under the gap and then walk onto it.
     *
     * The reason this was switched off for so long is the obvious one: the way
     * to fall into a ravine is to walk towards it while placing the floor. So
     * the forward key comes up first and stays up until the block is actually
     * there — the placement is verified against the world, not assumed from
     * having sent the click.
     *
     * The click itself is the one a person makes: the side face of the block
     * under your own feet, which is the only face adjacent to a hole that you
     * can reach.
     */
    private boolean bridge(LocalPlayer player, Step step) {
        if (client.gameMode == null || client.level == null) return false;
        BlockPos under = new BlockPos(step.x(), step.y() - 1, step.z());
        if (!client.level.getBlockState(under).isAir()) return false; // floor is there; walk it

        String block = spare(player);
        if (block == null) {
            // Nothing to build with. Saying so through the stuck counter gets a
            // fresh search that will not plan another bridge.
            wantsRepath = true;
            return false;
        }
        // Stand still. Everything below this is done from a standstill.
        Keys.set(client.options.keyUp, false);
        Keys.set(client.options.keySprint, false);
        Keys.set(client.options.keyJump, false);
        if (!Hotbar.hold(client, block)) return true;

        BlockPos from = player.blockPosition().below();
        if (client.level.getBlockState(from).isAir()) return false; // nothing to click either
        Direction face = Torchlight.toward(from, under);
        Vec3 hit = Vec3.atCenterOf(from).add(face.getStepX() * 0.5, 0, face.getStepZ() * 0.5);

        lookAtBlock(player, under);
        client.gameMode.useItemOn(player, InteractionHand.MAIN_HAND,
                new BlockHitResult(hit, face, from, false));
        player.swing(InteractionHand.MAIN_HAND);
        // True while there is still a hole: keep the tick and try again.
        return client.level.getBlockState(under).isAir();
    }

    /**
     * Something ordinary to build a floor out of.
     *
     * Deliberately a short list of the cheap and plentiful. Bridging a ravine
     * with the oak doors you gathered for a house is not a trade anyone wants
     * to make, and there is no way for this to know which of your blocks were
     * spoken for.
     */
    static String spare(LocalPlayer player) {
        for (String block : SPARES) {
            if (Hotbar.count(player, block) > 0) return block;
        }
        return null;
    }

    private static final List<String> SPARES = List.of(
            "dirt", "cobblestone", "cobbled_deepslate", "netherrack", "gravel",
            "andesite", "diorite", "granite", "stone", "sand");

    /** The cell the player is walking into: one step along where they face. */
    private BlockPos inFront(LocalPlayer player) {
        double yaw = Math.toRadians(player.getYRot());
        return new BlockPos(
                (int) Math.floor(player.getX() - Math.sin(yaw)),
                (int) Math.floor(player.getY()),
                (int) Math.floor(player.getZ() + Math.cos(yaw)));
    }

    /**
     * Break what is in the way. Returns true while there is still digging to do.
     *
     * Both the block at head height and the one at foot height, because a player
     * is two blocks tall and a tunnel one block high is a tunnel you cannot walk
     * down.
     */
    private boolean digThrough(LocalPlayer player, Step step) {
        return digAt(player, new BlockPos(step.x(), step.y(), step.z()));
    }

    private boolean digAt(LocalPlayer player, BlockPos feet) {
        if (client.gameMode == null || client.level == null) return false;

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
            wantsRepath = true;
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
        Aim.at(Math.toDegrees(Math.atan2(dz, dx)) - 90.0,
                -Math.toDegrees(Math.atan2(dy, horizontal)));
    }
}
