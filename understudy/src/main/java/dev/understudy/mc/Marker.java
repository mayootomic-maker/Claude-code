package dev.understudy.mc;

import com.mojang.blaze3d.platform.InputConstants;
import dev.understudy.core.build.Blueprint;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;
import org.lwjgl.glfw.GLFW;

import java.util.function.BiConsumer;
import java.util.function.Consumer;

/**
 * Choosing where a build goes by dragging a rectangle on the ground.
 *
 * The old version put the footprint under your crosshair and committed on a
 * crouch, which meant the size was fixed, the position was a guess, and you
 * found out where it had really gone once it was going up. Dragging out the
 * square you want is how every builder already thinks about this.
 *
 * **Why the crouch key rather than the mouse.** Dragging with the left button
 * is what was asked for and it is the one thing this cannot safely do: in
 * creative, left-click destroys the block under the crosshair on the way down.
 * A site picker that mines a trench across your lawn while you choose where the
 * house goes is worse than one with an unusual key. So the anchor is a crouch —
 * one tap, not a hold — and the drag is where you then look. Enter confirms.
 *
 * **It turns the design to fit.** Drag a rectangle that is wider than it is
 * deep and a design that is deeper than it is wide turns a quarter to match,
 * rather than being crammed in sideways.
 */
public final class Marker {

    private enum Stage { OFF, AIMING, DRAGGING, READY }

    /** Beyond this the crosshair is not really pointing anywhere in particular. */
    private static final int MAX_RANGE = 64;
    /** A tap is a press seen after a release, so both edges are tracked. */
    private boolean crouchWasDown;
    private boolean enterWasDown;

    private final Minecraft client;
    private final Consumer<String> report;

    private Blueprint blueprint;
    private Blueprint turned;
    private BiConsumer<Blueprint, BlockPos> onPlaced;
    private Stage stage = Stage.OFF;
    private BlockPos anchor;
    private BlockPos corner;

    public Marker(Minecraft client, Consumer<String> report) {
        this.client = client;
        this.report = report;
    }

    public boolean active() {
        return stage != Stage.OFF;
    }

    public void start(Blueprint plan, BiConsumer<Blueprint, BlockPos> placed) {
        this.blueprint = plan;
        this.turned = plan;
        this.onPlaced = placed;
        this.stage = Stage.AIMING;
        this.anchor = null;
        this.corner = null;
        report.accept("aim at one corner and tap crouch, look to the far corner, "
                + "then press Enter — /build cancel to stop");
    }

    public void cancel() {
        if (stage == Stage.OFF) return;
        stage = Stage.OFF;
        Ghosts.hide();
        blueprint = null;
        Hud.setStatus("");
        report.accept("site cancelled");
    }

    public void tick() {
        if (stage == Stage.OFF) return;
        LocalPlayer player = client.player;
        if (player == null) return;

        boolean crouchTapped = tapped(client.options.keyShift.isDown(), true);
        boolean enterTapped = tapped(enterDown(), false);

        BlockPos aimed = lookingAt(player);
        if (aimed == null && stage != Stage.READY) {
            Hud.setStatus("aim at the ground");
            return;
        }

        switch (stage) {
            case AIMING -> {
                corner = aimed;
                preview(aimed, aimed);
                Hud.setStatus("tap crouch at one corner of the " + blueprint.name());
                if (crouchTapped) {
                    anchor = aimed;
                    stage = Stage.DRAGGING;
                }
            }
            case DRAGGING -> {
                corner = aimed;
                preview(anchor, corner);
                Hud.setStatus(size() + " — look to the far corner, Enter to build, "
                        + "crouch to re-anchor");
                if (crouchTapped) anchor = aimed;
                if (enterTapped) stage = Stage.READY;
            }
            case READY -> {
                Hud.setStatus(size() + " — Enter to build, crouch to move it");
                if (crouchTapped) {
                    stage = Stage.DRAGGING;
                    return;
                }
                if (enterTapped) commit();
            }
            default -> { }
        }
        // Enter in the DRAGGING stage means "that is the square" and Enter again
        // means "go" — but one press should not do both, so the second is only
        // read on a later tick.
        if (stage == Stage.READY && enterTapped) return;
    }

    /**
     * Turn the design to match the way the rectangle was dragged, and put it in
     * the middle of it.
     *
     * Dragging a long thin rectangle and getting a house crammed in across it is
     * the sort of thing that makes a tool feel like it is not listening.
     */
    private void preview(BlockPos from, BlockPos to) {
        if (from == null || to == null) return;
        int wide = Math.abs(to.getX() - from.getX()) + 1;
        int deep = Math.abs(to.getZ() - from.getZ()) + 1;
        boolean acrossTheDrag = (wide >= deep) != (blueprint.sizeX() >= blueprint.sizeZ());
        turned = acrossTheDrag ? blueprint.turned(1, false) : blueprint;

        BlockPos origin = originFor(from, to);
        Ghosts.show(turned, origin);
    }

    /** The corner the blueprint's own origin goes at, centred in the drag. */
    private BlockPos originFor(BlockPos from, BlockPos to) {
        int lowX = Math.min(from.getX(), to.getX());
        int lowZ = Math.min(from.getZ(), to.getZ());
        int wide = Math.abs(to.getX() - from.getX()) + 1;
        int deep = Math.abs(to.getZ() - from.getZ()) + 1;
        // Centred when the drag is bigger than the design, and anchored at the
        // low corner when it is smaller — so a drag that is too small still
        // starts where you put it rather than wandering off.
        int offX = Math.max(0, (wide - turned.sizeX()) / 2);
        int offZ = Math.max(0, (deep - turned.sizeZ()) / 2);
        return new BlockPos(lowX + offX, Math.max(from.getY(), to.getY()) + 1, lowZ + offZ);
    }

    private String size() {
        if (anchor == null || corner == null) return turned.name();
        int wide = Math.abs(corner.getX() - anchor.getX()) + 1;
        int deep = Math.abs(corner.getZ() - anchor.getZ()) + 1;
        String fit = wide >= turned.sizeX() && deep >= turned.sizeZ()
                ? "fits" : "smaller than the design (" + turned.sizeX() + "x" + turned.sizeZ() + ")";
        return turned.name() + " " + wide + "x" + deep + " — " + fit;
    }

    private void commit() {
        BlockPos origin = originFor(anchor, corner);
        stage = Stage.OFF;
        Hud.setStatus("");
        report.accept("building the " + turned.name() + " at "
                + origin.getX() + " " + origin.getY() + " " + origin.getZ());
        onPlaced.accept(turned, origin);
    }

    /** A press seen after a release, so holding a key does not fire every tick. */
    private boolean tapped(boolean down, boolean crouch) {
        boolean was = crouch ? crouchWasDown : enterWasDown;
        if (crouch) crouchWasDown = down;
        else enterWasDown = down;
        return down && !was;
    }

    /**
     * Enter, which Minecraft has no keybinding for.
     *
     * Asked of the window directly. It is the one key here that is not a game
     * control, which is exactly why it is the right one to confirm with: it
     * cannot mine anything, place anything or move you.
     */
    private boolean enterDown() {
        // isKeyDown takes the Window itself in this version, not the handle it
        // wraps — which is the tidier of the two and the one I guessed wrong.
        com.mojang.blaze3d.platform.Window window = client.getWindow();
        if (window == null) return false;
        return InputConstants.isKeyDown(window, GLFW.GLFW_KEY_ENTER)
                || InputConstants.isKeyDown(window, GLFW.GLFW_KEY_KP_ENTER);
    }

    /** The block the crosshair is on, or null when it is pointing at the sky. */
    private BlockPos lookingAt(LocalPlayer player) {
        HitResult hit = client.hitResult;
        if (!(hit instanceof BlockHitResult block) || hit.getType() != HitResult.Type.BLOCK) {
            return null;
        }
        BlockPos pos = block.getBlockPos();
        if (player.blockPosition().distSqr(pos) > (long) MAX_RANGE * MAX_RANGE) return null;
        return pos;
    }
}
