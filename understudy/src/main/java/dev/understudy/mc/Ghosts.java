package dev.understudy.mc;

import dev.understudy.core.build.Blueprint;
import dev.understudy.core.build.Hologram;
import net.fabricmc.fabric.api.client.rendering.v1.level.LevelRenderEvents;
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
 * The offset comes from the frame's own camera state, so it is exact in every
 * view rather than only in first person. Getting there took three wrong names:
 * this version has no GameRenderer.getMainCamera, its Camera has no position
 * accessor at all, and the position now lives on the render state — a public
 * Vec3 pos on the CameraRenderState hanging off the LevelRenderState the
 * context hands over. Which is the right place for it to be, and the reason
 * this cannot drift: it is the same state the pose stack was built from, so
 * the two cannot disagree about where the camera is.
 *
 * The earlier version offset by the player's eye. That is the camera in first
 * person and a couple of blocks from it in third, so the whole blueprint slid
 * sideways the moment you pressed F5 — which reads as broken rather than as
 * an approximation.
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

    /**
     * The blueprint's own shape, worked out once.
     *
     * The reason this exists is a performance bug that made the mod unusable on
     * a real import: everything below was being recomputed every frame, and
     * "everything" included sorting the entire six-thousand-block build order
     * and building a set of every position in it. Sixty times a second.
     */
    private static Hologram.Shape shape;
    /** The last answer, and what it was an answer to. */
    private static List<Hologram.Ghost> cached = List.of();
    private static long cachedFor = Long.MIN_VALUE;

    /** Draw this blueprint standing at this corner until told otherwise. */
    public static void show(Blueprint blueprint, BlockPos at) {
        show(blueprint, at, Hologram.shapeOf(blueprint));
    }

    /**
     * Show it, following the very list the builder is working through.
     *
     * Not a copy of that list — the same one. The builder reorders it as it
     * goes to save itself walking, and anything holding a copy would start
     * drawing the wrong blocks as finished the first time it did.
     */
    public static void show(Blueprint blueprint, BlockPos at,
                            List<Blueprint.Placement> order) {
        show(blueprint, at, Hologram.shapeOf(blueprint, order));
    }

    private static void show(Blueprint blueprint, BlockPos at, Hologram.Shape prepared) {
        // Off unless the site picker turns it on: a build under way wants the
        // arrow gone, and it is the picker that knows which way round it ended.
        front = -1;
        showing = blueprint;
        shape = prepared;
        origin = at;
        placed = 0;
        next = -1;
        cached = List.of();
        cachedFor = Long.MIN_VALUE;
    }

    /**
     * Which way the thing is pointing, drawn alongside it while it is being sited.
     *
     * Only while siting: once the build is under way the arrow has done its job
     * and would be one more thing in front of what is actually happening.
     */
    public static void facing(int quarterTurns) {
        front = quarterTurns;
        cachedFor = Long.MIN_VALUE;
    }

    public static void unfaced() {
        front = -1;
        cachedFor = Long.MIN_VALUE;
    }

    private static int front = -1;

    /** How far along, so the finished part can dim and the next can be called out. */
    public static void progress(int done, int upNext) {
        placed = done;
        next = upNext;
    }

    public static void hide() {
        front = -1;
        showing = null;
        shape = null;
        origin = null;
        placed = 0;
        next = -1;
        cached = List.of();
        cachedFor = Long.MIN_VALUE;
    }

    public static boolean showing() {
        return showing != null;
    }

    public static void includeFinished(boolean include) {
        showDone = include;
    }

    /**
     * The ghosts to draw, recomputed only when the answer could have changed.
     *
     * Which is: the build moved on, or the camera moved far enough that a
     * different part of the design is near. Everything else is the same list as
     * last frame, and handing back the same list is the difference between a
     * six-thousand-block import being a hologram and being a slideshow.
     */
    private static List<Hologram.Ghost> visible(Vec3 camera) {
        long now = key((int) camera.x >> 2, (int) camera.y >> 2, (int) camera.z >> 2)
                ^ ((long) placed << 40) ^ ((long) next << 20) ^ (showDone ? 1 : 0);
        if (now == cachedFor) return cached;
        cachedFor = now;
        List<Hologram.Ghost> ghosts = new java.util.ArrayList<>(
                Hologram.of(shape, origin.getX(), origin.getY(), origin.getZ(),
                        placed, next, camera.x, camera.y, camera.z, showDone));
        if (front >= 0 && showing != null) {
            ghosts.addAll(Hologram.orientation(showing, origin.getX(), origin.getY(),
                    origin.getZ(), front));
        }
        cached = ghosts;
        return cached;
    }

    private static long key(int x, int y, int z) {
        return ((long) (x & 0x3FFFF) << 36) | ((long) (z & 0x3FFFF) << 18) | (y & 0x3FFFF);
    }

    /**
     * Hook the one event that runs after the world is drawn and before the
     * debug shapes, which is where something drawn over the world belongs.
     */
    public static void register() {
        LevelRenderEvents.BEFORE_GIZMOS.register(context -> {
            if (showing == null || origin == null) return;
            Vec3 camera = context.levelState().cameraRenderState.pos;
            List<Hologram.Ghost> ghosts = visible(camera);

            for (Hologram.Ghost ghost : ghosts) {
                // Offset by the camera here rather than pushing a translation:
                // the box is built from doubles anyway, so this is the same
                // arithmetic in one place instead of two.
                VoxelShape box = Shapes.box(
                        ghost.x() - camera.x + INSET,
                        ghost.y() - camera.y + INSET,
                        ghost.z() - camera.z + INSET,
                        ghost.x() - camera.x + 1 - INSET,
                        ghost.y() - camera.y + 1 - INSET,
                        ghost.z() - camera.z + 1 - INSET);
                context.submitNodeCollector().submitShapeOutline(
                        context.poseStack(), box, RenderTypes.lines(),
                        ghost.argb(), LINE_WIDTH, false);
            }
        });
    }
}
