package dev.understudy.mc;

import com.mojang.blaze3d.platform.InputConstants;
import dev.understudy.core.build.Blueprint;
import dev.understudy.core.build.Sized;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;
import org.lwjgl.glfw.GLFW;

import java.util.function.BiConsumer;
import java.util.function.Consumer;

/**
 * Choosing where a build goes, how big it is, and how high, by dragging a
 * rectangle on the ground.
 *
 * The first version put the footprint under your crosshair and committed on a
 * crouch, so the size was fixed, the position was a guess, and you found out
 * where it had really gone once it was going up. The second added the drag but
 * the drag still only chose a position: the design kept the size the menu had
 * given it and sat in the middle of whatever you dragged, which is not what
 * dragging a rectangle means to anybody. Now the rectangle decides the size —
 * the design is regenerated to the largest that fits and turned to lie the same
 * way round — and Page Up and Page Down lift it off the ground, because "on the
 * ground" is not the only place a thing can go.
 *
 * **Why the crouch key rather than the mouse.** Dragging with the left button
 * is what was asked for and it is the one thing this cannot safely do: in
 * creative, left-click destroys the block under the crosshair on the way down.
 * A site picker that mines a trench across your lawn while you choose where the
 * house goes is worse than one with an unusual key. So the anchor is a crouch —
 * one tap, not a hold — and the drag is where you then look. Enter confirms.
 */
public final class Marker {

    private enum Stage { OFF, PLACING, AIMING, DRAGGING, READY }

    /** Beyond this the crosshair is not really pointing anywhere in particular. */
    private static final int MAX_RANGE = 64;
    /** How far off the ground it may be moved, in either direction. */
    private static final int MAX_LIFT = 32;

    private final Minecraft client;
    private final Consumer<String> report;

    private Sized design;
    private Blueprint turned;
    private BiConsumer<Blueprint, BlockPos> onPlaced;
    private Stage stage = Stage.OFF;
    private BlockPos anchor;
    private BlockPos corner;
    private int quarterTurns;
    private int lift;
    /** Whether this design has a size of its own, and so needs a spot rather than a plot. */
    private boolean placing;

    /**
     * What the last fit was worked out from.
     *
     * Refitting means regenerating the design, so it happens when the plot or
     * the rotation actually changes rather than on every tick of a drag — which
     * at sixty ticks a second would be sixty manors.
     */
    private int fittedWide = -1;
    private int fittedDeep = -1;
    private int fittedTurns;

    /** A tap is a press seen after a release, so both edges are tracked. */
    private boolean crouchWasDown;
    private boolean enterWasDown;
    private boolean turnWasDown;
    private boolean upWasDown;
    private boolean downWasDown;

    public Marker(Minecraft client, Consumer<String> report) {
        this.client = client;
        this.report = report;
    }

    public boolean active() {
        return stage != Stage.OFF;
    }

    public void start(Sized plan, BiConsumer<Blueprint, BlockPos> placed) {
        this.design = plan;
        this.turned = plan.asChosen();
        this.onPlaced = placed;
        this.anchor = null;
        this.corner = null;
        this.quarterTurns = 0;
        this.lift = 0;
        this.fittedWide = -1;

        // A drag decides a size, so a design with no size to decide should not
        // be asking for one. A twenty-five by forty-seven schematic cannot be
        // dragged out by looking at the ground anyway — the far corner is past
        // the range of the crosshair — so what you got was a rectangle that
        // meant nothing, a building that ignored it, and no way to tell where
        // it would land until it landed.
        this.placing = !plan.adjustable();
        this.stage = placing ? Stage.PLACING : Stage.AIMING;

        if (placing) {
            Blueprint it = plan.asChosen();
            report.accept("placing the " + it.name() + " — " + it.sizeX() + " by " + it.sizeZ()
                    + ", " + it.sizeY() + " tall");
            report.accept("look where you want its near corner · R turns · "
                    + "Page Up and Down raise · Enter places it");
        } else {
            report.accept("aim at a corner, tap crouch, look to the far corner, Enter to place");
            report.accept("the design resizes to the square you drag — R turns it, "
                    + "Page Up and Page Down raise it");
        }
    }

    public void cancel() {
        if (stage == Stage.OFF) return;
        stage = Stage.OFF;
        Ghosts.hide();
        design = null;
        Hud.setStatus("");
        report.accept("site cancelled");
    }

    public void tick() {
        if (stage == Stage.OFF) return;
        LocalPlayer player = client.player;
        if (player == null) return;

        boolean crouchTapped = tapped(client.options.keyShift.isDown(), Tap.CROUCH);
        boolean enterTapped = tapped(down(GLFW.GLFW_KEY_ENTER) || down(GLFW.GLFW_KEY_KP_ENTER),
                Tap.ENTER);
        if (tapped(down(GLFW.GLFW_KEY_R), Tap.TURN)) quarterTurns = (quarterTurns + 1) % 4;
        if (tapped(down(GLFW.GLFW_KEY_PAGE_UP), Tap.UP)) lift = Math.min(MAX_LIFT, lift + 1);
        if (tapped(down(GLFW.GLFW_KEY_PAGE_DOWN), Tap.DOWN)) lift = Math.max(-MAX_LIFT, lift - 1);

        BlockPos aimed = lookingAt(player);
        if (aimed == null && stage != Stage.READY) {
            Hud.setStatus("aim at the ground");
            return;
        }

        switch (stage) {
            case PLACING -> {
                anchor = aimed;
                corner = aimed;
                preview(aimed, aimed, false);
                Hud.setStatus(placingStatus(aimed));
                if (enterTapped) {
                    commit();
                    return;
                }
            }
            case AIMING -> {
                corner = aimed;
                // Shown at the size the menu chose, not fitted: there is no
                // plot yet, and shrinking the design to a single block the
                // instant you look at the ground reads as it going wrong.
                preview(aimed, aimed, false);
                Hud.setStatus("crouch at one corner");
                if (crouchTapped) {
                    anchor = aimed;
                    stage = Stage.DRAGGING;
                }
            }
            case DRAGGING -> {
                corner = aimed;
                preview(anchor, corner, true);
                Hud.setStatus(size() + " · Enter");
                if (crouchTapped) anchor = aimed;
                if (enterTapped) stage = Stage.READY;
            }
            case READY -> {
                preview(anchor, corner, true);
                Hud.setStatus(size() + " · Enter to build");
                if (crouchTapped) {
                    stage = Stage.DRAGGING;
                    return;
                }
                if (enterTapped) commit();
            }
            default -> { }
        }
    }

    /**
     * Work out the design for this plot and show it where it will stand.
     *
     * The regeneration is behind a guard on the plot having actually changed,
     * so looking around inside the same square costs nothing.
     */
    private void preview(BlockPos from, BlockPos to, boolean fit) {
        if (from == null || to == null) return;
        int wide = fit ? Math.abs(to.getX() - from.getX()) + 1 : 0;
        int deep = fit ? Math.abs(to.getZ() - from.getZ()) + 1 : 0;
        if (wide != fittedWide || deep != fittedDeep || quarterTurns != fittedTurns) {
            turned = fit ? design.fitting(wide, deep) : design.asChosen();
            if (quarterTurns != 0) turned = turned.turned(quarterTurns, false);
            fittedWide = wide;
            fittedDeep = deep;
            fittedTurns = quarterTurns;
        }
        Ghosts.show(turned, originFor(from, to));
    }

    /**
     * The corner the blueprint's own origin goes at.
     *
     * Centred in the plot when the design is smaller than it, and anchored at
     * the low corner when it is larger, so a plot that is too small still
     * starts where you put it rather than wandering off. The floor sits one
     * above the block you dragged on, plus however far it has been lifted.
     */
    private BlockPos originFor(BlockPos from, BlockPos to) {
        int lowX = Math.min(from.getX(), to.getX());
        int lowZ = Math.min(from.getZ(), to.getZ());
        int wide = Math.abs(to.getX() - from.getX()) + 1;
        int deep = Math.abs(to.getZ() - from.getZ()) + 1;
        int offX = Math.max(0, (wide - turned.sizeX()) / 2);
        int offZ = Math.max(0, (deep - turned.sizeZ()) / 2);
        // One above the block you pointed at, unless the design brought its own
        // ground — a schematic cut out of somebody's world has a slab of lawn
        // underneath it, and putting that one above the grass leaves the whole
        // house hovering on a layer of someone else's garden.
        int ground = Math.max(from.getY(), to.getY())
                + (turned.bringsItsOwnGround() ? 0 : 1);
        return new BlockPos(lowX + offX, ground + lift, lowZ + offZ);
    }

    /**
     * The one line of status, kept short.
     *
     * Short because the overlay above the hotbar is drawn centred and never
     * wrapped, so a sentence of instructions runs off both edges of the screen
     * at once. The instructions were said in chat when the site opened, which
     * is where a sentence belongs; this is the readout.
     */
    /**
     * The one line while a fixed design is being placed.
     *
     * It says the two things you cannot see from the outline: how far the
     * ground under the footprint varies, and therefore how much of the
     * building is about to be buried or left standing on air. On flat ground it
     * says so and gets out of the way.
     */
    private String placingStatus(BlockPos at) {
        String where = turned.name() + " " + turned.sizeX() + "x" + turned.sizeZ();
        if (lift != 0) where += (lift > 0 ? " +" : " ") + lift;
        int roughness = groundVaries(at);
        if (roughness < 0) return where + " · Enter";
        if (roughness == 0) return where + " · flat · Enter";
        return where + " · ground varies " + roughness + " · Enter";
    }

    /**
     * How much the ground under the footprint rises and falls, in blocks.
     *
     * Sampled rather than measured at every column: a corner and a middle is
     * enough to tell a lawn from a hillside, and this runs every tick while you
     * look around. Negative when the ground is not loaded to answer with.
     */
    private int groundVaries(BlockPos at) {
        if (client.level == null) return -1;
        int low = Integer.MAX_VALUE;
        int high = Integer.MIN_VALUE;
        for (int dx = 0; dx <= turned.sizeX(); dx += Math.max(1, turned.sizeX() / 3)) {
            for (int dz = 0; dz <= turned.sizeZ(); dz += Math.max(1, turned.sizeZ() / 3)) {
                Integer top = surfaceAt(at.getX() + dx, at.getY(), at.getZ() + dz);
                if (top == null) continue;
                low = Math.min(low, top);
                high = Math.max(high, top);
            }
        }
        return low > high ? -1 : high - low;
    }

    /** The highest solid block near the aimed height, or null if nothing is loaded. */
    private Integer surfaceAt(int x, int startY, int z) {
        ClientBlockView view = new ClientBlockView(client.level);
        for (int y = startY + 8; y > startY - 16; y--) {
            if (view.solid(x, y, z) && view.passable(x, y + 1, z)) return y;
        }
        return null;
    }

    private String size() {
        String at = turned.sizeX() + "x" + turned.sizeZ();
        if (anchor == null || corner == null) return turned.name() + " " + at;
        int wide = Math.abs(corner.getX() - anchor.getX()) + 1;
        int deep = Math.abs(corner.getZ() - anchor.getZ()) + 1;
        String note = turned.sizeX() <= wide && turned.sizeZ() <= deep
                ? at
                : at + " §c>" + wide + "x" + deep;
        if (lift != 0) note += (lift > 0 ? " +" : " ") + lift;
        return turned.name() + " " + note;
    }

    private void commit() {
        BlockPos origin = originFor(anchor, corner);
        Blueprint going = turned;
        stage = Stage.OFF;
        Hud.setStatus("");
        report.accept("building the " + going.name() + " (" + going.sizeX() + "x"
                + going.sizeZ() + ") at " + origin.getX() + " " + origin.getY()
                + " " + origin.getZ());
        onPlaced.accept(going, origin);
    }

    private enum Tap { CROUCH, ENTER, TURN, UP, DOWN }

    /** A press seen after a release, so holding a key does not fire every tick. */
    private boolean tapped(boolean isDown, Tap which) {
        boolean was = switch (which) {
            case CROUCH -> crouchWasDown;
            case ENTER -> enterWasDown;
            case TURN -> turnWasDown;
            case UP -> upWasDown;
            case DOWN -> downWasDown;
        };
        switch (which) {
            case CROUCH -> crouchWasDown = isDown;
            case ENTER -> enterWasDown = isDown;
            case TURN -> turnWasDown = isDown;
            case UP -> upWasDown = isDown;
            case DOWN -> downWasDown = isDown;
        }
        return isDown && !was;
    }

    /**
     * A key asked of the window directly.
     *
     * Enter, R, Page Up and Page Down have no game binding between them, which
     * is exactly why they are the right keys here: none of them can mine
     * anything, place anything or move you while you are choosing a plot.
     */
    private boolean down(int key) {
        // isKeyDown takes the Window itself in this version, not the handle it
        // wraps — which is the tidier of the two and the one I guessed wrong.
        com.mojang.blaze3d.platform.Window window = client.getWindow();
        return window != null && InputConstants.isKeyDown(window, key);
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
