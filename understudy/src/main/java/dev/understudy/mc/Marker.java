package dev.understudy.mc;

import dev.understudy.core.build.Blueprint;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;

import java.util.function.BiConsumer;
import java.util.function.Consumer;

/**
 * Choosing where a build goes, by looking at it.
 *
 * The footprint follows the block under your crosshair, and crouching for a
 * moment commits it. Crouch rather than a click because a click in Minecraft
 * already means something — left-click breaks the block you are aiming at and
 * right-click places one — and a site picker that mines a hole in the ground
 * while you choose where to put the house is not a site picker. Holding rather
 * than tapping, because a tap is something you do by accident while walking.
 *
 * What it reports every tick is the real corner and the real footprint, so the
 * commitment is to exactly the square that was on screen.
 */
public final class Marker {

    /** Ticks of crouching before the site is taken. Two fifths of a second. */
    private static final int HOLD_TICKS = 8;
    /** Beyond this the crosshair is not really pointing at anywhere in particular. */
    private static final int MAX_RANGE = 48;

    private final Minecraft client;
    private final Consumer<String> report;

    private Blueprint blueprint;
    private BiConsumer<Blueprint, BlockPos> onPlaced;
    private boolean active;
    private int held;
    private BlockPos aimed;

    public Marker(Minecraft client, Consumer<String> report) {
        this.client = client;
        this.report = report;
    }

    public boolean active() {
        return active;
    }

    public void start(Blueprint plan, BiConsumer<Blueprint, BlockPos> placed) {
        this.blueprint = plan;
        this.onPlaced = placed;
        this.active = true;
        this.held = 0;
        this.aimed = null;
        report.accept("look at where the " + plan.name() + " should go, then crouch to place it"
                + " (/build cancel to stop)");
    }

    public void cancel() {
        if (!active) return;
        active = false;
        Ghosts.hide();
        blueprint = null;
        Hud.setStatus("");
        report.accept("site cancelled");
    }

    public void tick() {
        if (!active) return;
        LocalPlayer player = client.player;
        if (player == null) return;

        BlockPos target = lookingAt();
        if (target == null) {
            held = 0;
            Hud.setStatus("aim at the ground to place the " + blueprint.name());
            return;
        }

        // The corner moves with the crosshair right up until it is taken, so
        // what gets built is whatever was last on screen — and now you can see
        // it there while you choose, rather than finding out afterwards.
        aimed = target;
        Ghosts.show(blueprint, target.offset(-blueprint.sizeX() / 2, 1, -blueprint.sizeZ() / 2));
        if (!client.options.keyShift.isDown()) {
            held = 0;
            Hud.setStatus(String.format("%s %dx%d at %d %d %d — crouch to place",
                    blueprint.name(), blueprint.sizeX(), blueprint.sizeZ(),
                    target.getX(), target.getY(), target.getZ()));
            return;
        }

        held++;
        if (held < HOLD_TICKS) {
            Hud.setStatus("placing" + ".".repeat(1 + held * 3 / HOLD_TICKS));
            return;
        }

        active = false;
        held = 0;
        Hud.setStatus("");
        // The blueprint's own origin is a corner, so centring it on the aimed
        // block is what makes the square land where it was drawn rather than
        // off to one side of it.
        BlockPos origin = aimed.offset(-blueprint.sizeX() / 2, 1, -blueprint.sizeZ() / 2);
        report.accept("site set at " + origin.getX() + " " + origin.getY() + " " + origin.getZ());
        onPlaced.accept(blueprint, origin);
    }

    /** The block the crosshair is on, or null when it is pointing at the sky. */
    private BlockPos lookingAt() {
        HitResult hit = client.hitResult;
        if (!(hit instanceof BlockHitResult block) || hit.getType() != HitResult.Type.BLOCK) {
            return null;
        }
        LocalPlayer player = client.player;
        if (player == null) return null;
        BlockPos pos = block.getBlockPos();
        if (player.blockPosition().distSqr(pos) > (long) MAX_RANGE * MAX_RANGE) return null;
        return pos;
    }
}
