package dev.understudy.mc;

import dev.understudy.core.build.Blueprint;
import dev.understudy.core.build.Hologram;
import net.fabricmc.fabric.api.client.rendering.v1.level.LevelRenderEvents;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.client.renderer.rendertype.RenderTypes;
import net.minecraft.core.BlockPos;
import net.minecraft.world.phys.Vec3;
import net.minecraft.world.phys.shapes.Shapes;
import net.minecraft.world.phys.shapes.VoxelShape;

import java.util.List;

/**
 * The blueprint, drawn in the air where it is going to be.
 *
 * What to draw is decided in core.build.Hologram, where it can be tested; this
 * is only the drawing, and the drawing is four lines surrounded by the version's
 * own vocabulary. Nothing here is a guess: every name in it was read out of the
 * game's own jar, because the four calls a person would reach for from memory —
 * ShapeRenderer, RenderType.lines, a vertex buffer, WorldRenderContext — are
 * every one of them absent in this version, and no compiler error would have
 * pointed at what replaced them.
 *
 * Minecraft 26 renders by submitting nodes rather than by writing vertices, so
 * a hologram is a shape outline submitted to the frame's collector. The pose
 * stack it hands over is relative to the camera, which is why the boxes are
 * built already offset: a box at its true world coordinates would be drawn as
 * far from you as you are from the origin.
 *
 * The offset uses the player's eye rather than the camera, which is the same
 * point in first person and a couple of blocks out in third. Asking the render
 * context for the camera is the right answer and is the next question in the
 * list; this is honest about being an approximation rather than silently one.
 */
public final class Ghosts {
    private Ghosts() {}

    /** Thin enough to see through, thick enough to read at forty blocks. */
    private static final float LINE_WIDTH = 2.0f;
    /** Boxes drawn slightly inside the block, so touching faces stay separate. */
    private static final double INSET = 0.02;

    private static Blueprint showing;
    private static BlockPos origin;
    private static int placed;
    private static int next = -1;
    private static boolean showDone = true;

    /** Draw this blueprint standing at this corner until told otherwise. */
    public static void show(Blueprint blueprint, BlockPos at) {
        showing = blueprint;
        origin = at;
        placed = 0;
        next = -1;
    }

    /** How far along, so the finished part can dim and the next can be called out. */
    public static void progress(int done, int upNext) {
        placed = done;
        next = upNext;
    }

    public static void hide() {
        showing = null;
        origin = null;
        placed = 0;
        next = -1;
    }

    public static boolean showing() {
        return showing != null;
    }

    public static void includeFinished(boolean include) {
        showDone = include;
    }

    /**
     * Hook the one event that runs after the world is drawn and before the
     * debug shapes, which is where something drawn over the world belongs.
     */
    public static void register() {
        LevelRenderEvents.BEFORE_GIZMOS.register(context -> {
            if (showing == null || origin == null) return;
            LocalPlayer player = Minecraft.getInstance().player;
            if (player == null) return;

            Vec3 eye = player.getEyePosition();
            List<Hologram.Ghost> ghosts = Hologram.of(showing,
                    origin.getX(), origin.getY(), origin.getZ(),
                    placed, next, eye.x, eye.y, eye.z, showDone);

            for (Hologram.Ghost ghost : ghosts) {
                // Offset by the camera here rather than pushing a translation:
                // the box is built from doubles anyway, so this is the same
                // arithmetic in one place instead of two.
                VoxelShape box = Shapes.box(
                        ghost.x() - eye.x + INSET,
                        ghost.y() - eye.y + INSET,
                        ghost.z() - eye.z + INSET,
                        ghost.x() - eye.x + 1 - INSET,
                        ghost.y() - eye.y + 1 - INSET,
                        ghost.z() - eye.z + 1 - INSET);
                context.submitNodeCollector().submitShapeOutline(
                        context.poseStack(), box, RenderTypes.lines(),
                        ghost.argb(), LINE_WIDTH, false);
            }
        });
    }
}
