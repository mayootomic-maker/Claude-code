package dev.understudy.core.build;

import java.util.HashMap;
import java.util.Map;
import java.util.function.IntFunction;

/**
 * A design that can still be asked for at a different size.
 *
 * The site picker used to be handed a finished blueprint, which meant the
 * rectangle you dragged on the ground could only ever decide *where* a build
 * went — the size was fixed the moment you left the menu, and dragging a plot
 * twice as big got you the same house standing in the middle of it. Handing it
 * this instead lets the drag decide the size too, which is what dragging a
 * rectangle obviously ought to mean.
 *
 * Not everything can be resized and that is not a failing. A schematic somebody
 * exported is the size it was saved at; resampling a structure is not scaling,
 * it is damaging it. Those arrive as {@link #fixed} and the picker says so
 * rather than offering a control that would lie.
 *
 * Sizes are cached because the fit is found by searching them, and generating a
 * manor is thousands of placements — doing it five times per tick while a drag
 * is under way is a stutter you can feel.
 */
public final class Sized {

    private final Blueprint asChosen;
    private final IntFunction<Blueprint> maker;
    private final int min;
    private final int max;
    private final Map<Integer, Blueprint> made = new HashMap<>();

    private Sized(Blueprint asChosen, IntFunction<Blueprint> maker, int min, int max) {
        this.asChosen = asChosen;
        this.maker = maker;
        this.min = min;
        this.max = max;
    }

    /** A design that comes at whatever size is asked for, between two bounds. */
    public static Sized of(Blueprint asChosen, IntFunction<Blueprint> maker, int min, int max) {
        return new Sized(asChosen, maker, Math.min(min, max), Math.max(min, max));
    }

    /** A design that is the size it is: an import, or anything already built. */
    public static Sized fixed(Blueprint blueprint) {
        return new Sized(blueprint, null, 0, 0);
    }

    /** The blueprint as it was chosen, before any plot has been dragged. */
    public Blueprint asChosen() {
        return asChosen;
    }

    public boolean adjustable() {
        return maker != null && max > min;
    }

    public int min() {
        return min;
    }

    public int max() {
        return max;
    }

    public Blueprint atSize(int size) {
        if (maker == null) return asChosen;
        int wanted = Math.max(min, Math.min(max, size));
        return made.computeIfAbsent(wanted, maker::apply);
    }

    /**
     * The biggest version of this that fits the plot, turned to suit it.
     *
     * Found by halving rather than by trying every size, because "does size n
     * fit" only goes one way — a bigger number is never a smaller footprint —
     * and a manor generated twenty times in a tick is a visible stutter where
     * five times is not.
     *
     * When nothing fits, the smallest is returned rather than nothing at all: a
     * plot too small for the design is a thing to be told about, and the caller
     * can see it for itself by comparing the footprint it gets back. Returning
     * null would only mean the preview vanished at the moment it was needed.
     */
    public Blueprint fitting(int wide, int deep) {
        // A fixed design keeps the way round it was made. Turning it to match
        // the plot is a kindness to a design that has no opinion; a schematic
        // has a front door and a back garden, and spinning it a quarter because
        // the rectangle you dragged came out wider than it was deep is the
        // opposite of listening. R turns it, and only R.
        if (!adjustable()) return asChosen;

        int low = min;
        int high = max;
        int best = min;
        while (low <= high) {
            int mid = (low + high) >>> 1;
            if (fits(atSize(mid), wide, deep)) {
                best = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        return orientedFor(atSize(best), wide, deep);
    }

    /** Whether this design fits the plot either as drawn or turned a quarter. */
    private static boolean fits(Blueprint plan, int wide, int deep) {
        return (plan.sizeX() <= wide && plan.sizeZ() <= deep)
                || (plan.sizeZ() <= wide && plan.sizeX() <= deep);
    }

    /**
     * Turned to lie the same way round as the plot.
     *
     * A long thin drag with the house crammed across it is the sort of thing
     * that makes a tool feel like it was not listening, so a design deeper than
     * it is wide turns a quarter when the plot is wider than it is deep. A
     * square plot is left alone: there is nothing to match.
     */
    private static Blueprint orientedFor(Blueprint plan, int wide, int deep) {
        if (wide == deep || plan.sizeX() == plan.sizeZ()) return plan;
        boolean plotIsWide = wide > deep;
        boolean planIsWide = plan.sizeX() > plan.sizeZ();
        return plotIsWide == planIsWide ? plan : plan.turned(1, false);
    }
}
