package dev.understudy.core.path;

import java.util.List;

/**
 * Where to actually look while walking a path.
 *
 * Steering straight at the next waypoint makes the walk snap from heading to
 * heading as each one is reached — the classic robot wobble. Aiming instead at
 * a point a fixed distance ahead along the route means the turn into a corner
 * begins before the corner and finishes after it, which is what a person does
 * and what a smooth line looks like.
 *
 * The look-ahead length is the whole character of the movement. Short and it
 * hugs the path and twitches; long and it cuts corners and drifts wide. A
 * little over two blocks tracks a Minecraft path closely without visible
 * correction.
 */
public final class Pursuit {

    public static final double LOOK_AHEAD = 2.4;
    /** Within this of a waypoint, it counts as reached. */
    public static final double REACHED = 0.7;

    /**
     * @param x         where to steer toward
     * @param z         where to steer toward
     * @param index     the waypoint now being worked toward
     * @param remaining blocks of path left, for deciding whether to sprint
     * @param bend      radians of turn coming up within the look-ahead, 0 when straight
     */
    public record Aim(double x, double z, int index, double remaining, double bend) {}

    private Pursuit() {}

    public static Aim aim(List<Step> path, int index, double px, double pz) {
        if (path.isEmpty()) return new Aim(px, pz, index, 0, 0);

        int at = Math.min(index, path.size() - 1);
        // Skip anything already reached. A smoothed path can put two waypoints
        // inside one another's radius, so this consumes all of them, not one.
        while (at < path.size() - 1 && distance(px, pz, path.get(at)) < REACHED) at++;

        double travelled = distance(px, pz, path.get(at));
        int target = at;
        while (target < path.size() - 1 && travelled < LOOK_AHEAD) {
            travelled += distance(path.get(target), path.get(target + 1));
            target++;
        }

        double remaining = distance(px, pz, path.get(at));
        for (int i = at; i < path.size() - 1; i++) remaining += distance(path.get(i), path.get(i + 1));

        return new Aim(path.get(target).x() + 0.5, path.get(target).z() + 0.5,
                at, remaining, bendAt(path, at));
    }

    /**
     * How sharply the path turns at a waypoint, in radians.
     *
     * Used to ease off the throttle before a corner. Running full speed into a
     * ninety and correcting afterwards is precisely the overshoot-and-snap that
     * makes automated movement obvious.
     */
    private static double bendAt(List<Step> path, int at) {
        if (at == 0 || at >= path.size() - 1) return 0;
        Step prev = path.get(at - 1);
        Step here = path.get(at);
        Step next = path.get(at + 1);
        double inX = here.x() - prev.x();
        double inZ = here.z() - prev.z();
        double outX = next.x() - here.x();
        double outZ = next.z() - here.z();
        double inLen = Math.hypot(inX, inZ);
        double outLen = Math.hypot(outX, outZ);
        if (inLen == 0 || outLen == 0) return 0;
        double cos = (inX * outX + inZ * outZ) / (inLen * outLen);
        return Math.acos(Math.max(-1, Math.min(1, cos)));
    }

    private static double distance(double px, double pz, Step step) {
        return Math.hypot(step.x() + 0.5 - px, step.z() + 0.5 - pz);
    }

    private static double distance(Step a, Step b) {
        return Math.hypot(a.x() - b.x(), a.z() - b.z());
    }
}
