package dev.understudy.core.build;

import java.util.ArrayList;
import java.util.List;

/**
 * Draws a blueprint as a small isometric picture, so the picker can show what
 * each build actually looks like.
 *
 * Why this rather than photographs. A picture pulled off the internet shows
 * someone else's house, in someone else's block palette, at a size the mod is
 * not going to build. This shows the exact structure that will be placed, in the
 * materials it will be placed in, and it changes when the size or palette does.
 * It also needs no network, ships nothing copyrighted in the jar, and cannot
 * break because a link rotted.
 *
 * The output is deliberately a list of horizontal runs rather than an image.
 * Minecraft 26 replaced its drawing surface and a mod has no stable way to hand
 * it a bitmap, but filling a rectangle is the one primitive every UI has ever
 * had. A house compresses to a few hundred runs, which is nothing to draw.
 *
 * The projection is the standard 2:1 isometric: each block is a flat diamond
 * top with two sides, drawn back to front. Three brightnesses for the three
 * visible faces is what makes it read as solid rather than as a pile of
 * lozenges.
 */
public final class Preview {

    /** Half-width and half-height of a block's top face, in preview pixels. */
    private static final int HALF_W = 4;
    private static final int HALF_H = 2;
    /** How tall a block's side is. */
    private static final int SIDE = 4;

    private static final double TOP_LIGHT = 1.0;
    private static final double LEFT_LIGHT = 0.78;
    private static final double RIGHT_LIGHT = 0.6;

    /** A horizontal span of one colour: draw as a rectangle length wide, one tall. */
    public record Run(int x, int y, int length, int argb) {}

    public record Image(int width, int height, List<Run> runs) {
        public boolean isEmpty() {
            return runs.isEmpty();
        }
    }

    private Preview() {}

    public static Image of(Blueprint blueprint) {
        int width = (blueprint.sizeX() + blueprint.sizeZ()) * HALF_W + 2;
        int height = (blueprint.sizeX() + blueprint.sizeZ()) * HALF_H
                + blueprint.sizeY() * SIDE + HALF_H * 2 + 2;
        int[] canvas = new int[width * height];

        // Painter's algorithm. Increasing x+z is further from the viewer along
        // the ground; increasing y is higher and therefore drawn later, so a
        // roof covers the wall behind it.
        List<Blueprint.Placement> order = new ArrayList<>(blueprint.placements());
        order.sort((a, b) -> {
            int depthA = a.x() + a.z();
            int depthB = b.x() + b.z();
            if (depthA != depthB) return Integer.compare(depthA, depthB);
            return Integer.compare(a.y(), b.y());
        });

        int originX = blueprint.sizeZ() * HALF_W + 1;
        int originY = 1;
        for (Blueprint.Placement placement : order) {
            int colour = Palette.colourOf(placement.block());
            // Glass gets sides like anything else. Drawing it as a top face
            // alone left windows floating in front of the wall instead of set
            // into it; a pale panel in a brown wall already reads as a window.
            // Torches stay flat, because a torch drawn as a full cube looks
            // like a gold block.
            boolean flat = Palette.emissive(placement.block());

            int sx = originX + (placement.x() - placement.z()) * HALF_W;
            int sy = originY + (placement.x() + placement.z()) * HALF_H
                    + (blueprint.sizeY() - 1 - placement.y()) * SIDE;

            if (!flat) {
                sides(canvas, width, height, sx, sy, colour);
            }
            top(canvas, width, height, sx, sy, colour, TOP_LIGHT);
        }
        return new Image(width, height, runsOf(canvas, width, height));
    }

    /** The diamond top face: a row of spans widening then narrowing. */
    private static void top(int[] canvas, int width, int height, int sx, int sy,
                            int colour, double light) {
        int shaded = shade(colour, light);
        for (int row = 0; row < HALF_H * 2; row++) {
            int spread = row < HALF_H ? row : HALF_H * 2 - 1 - row;
            int half = (spread + 1) * (HALF_W / HALF_H);
            span(canvas, width, height, sx - half, sy + row, half * 2, shaded);
        }
    }

    /** The two visible sides, which are simple parallelograms. */
    private static void sides(int[] canvas, int width, int height, int sx, int sy, int colour) {
        int left = shade(colour, LEFT_LIGHT);
        int right = shade(colour, RIGHT_LIGHT);
        for (int row = 0; row < SIDE; row++) {
            span(canvas, width, height, sx - HALF_W, sy + HALF_H + row, HALF_W, left);
            span(canvas, width, height, sx, sy + HALF_H + row, HALF_W, right);
        }
        // The lower tip of the diamond overhangs the sides by one row each way.
        for (int row = 0; row < HALF_H; row++) {
            int inset = row * (HALF_W / HALF_H);
            span(canvas, width, height, sx - HALF_W + inset, sy + HALF_H * 2 + SIDE - HALF_H + row,
                    (HALF_W - inset) * 2, left);
        }
    }

    private static void span(int[] canvas, int width, int height, int x, int y, int length, int argb) {
        if (y < 0 || y >= height) return;
        int from = Math.max(0, x);
        int to = Math.min(width, x + length);
        for (int i = from; i < to; i++) canvas[y * width + i] = argb;
    }

    private static int shade(int argb, double light) {
        int r = (int) Math.min(255, ((argb >> 16) & 0xFF) * light);
        int g = (int) Math.min(255, ((argb >> 8) & 0xFF) * light);
        int b = (int) Math.min(255, (argb & 0xFF) * light);
        return 0xFF000000 | (r << 16) | (g << 8) | b;
    }

    /** Collapse the canvas into horizontal runs, skipping anything untouched. */
    private static List<Run> runsOf(int[] canvas, int width, int height) {
        List<Run> runs = new ArrayList<>();
        for (int y = 0; y < height; y++) {
            int x = 0;
            while (x < width) {
                int argb = canvas[y * width + x];
                if (argb == 0) {
                    x++;
                    continue;
                }
                int end = x;
                while (end < width && canvas[y * width + end] == argb) end++;
                runs.add(new Run(x, y, end - x, argb));
                x = end;
            }
        }
        return runs;
    }
}
