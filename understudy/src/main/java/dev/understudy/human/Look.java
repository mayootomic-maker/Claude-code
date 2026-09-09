package dev.understudy.human;

/**
 * How the view turns.
 *
 * Clamping the turn to a fixed number of degrees per tick — the obvious way,
 * and what this mod did first — produces a constant-rate sweep that starts
 * instantly, holds one speed, and stops dead on arrival. Nothing physical moves
 * like that, which is why it reads as mechanical even at a believable speed.
 *
 * A neck is a mass on a spring. Modelling it as one, slightly underdamped, gives
 * the acceleration into the turn, the deceleration out of it and the small
 * overshoot-and-settle that real aiming has, with no hand-authored easing.
 *
 * On top of that sit two things people cannot help doing: they do not re-aim
 * every frame — they commit to a target and re-evaluate a few times a second —
 * and their hands never hold perfectly still. Both are here, because a view that
 * tracks a moving target with zero lag and zero tremor is the single clearest
 * sign that nobody is holding the mouse.
 */
public final class Look {

    /** Seconds per client tick. */
    private static final double DT = 0.05;
    /** Spring stiffness. Higher turns faster; 9 settles in about a third of a second. */
    private static final double STIFFNESS = 9.0;
    /** Under 1 leaves a small overshoot. Exactly 1 would settle without any. */
    private static final double DAMPING = 0.78;
    /** Nothing turns faster than this, however far off target it is. */
    private static final double MAX_DEGREES_PER_SECOND = 520.0;
    /**
     * And nothing reaches that speed instantly. Without this the spring saturates
     * the speed cap on the first tick of any large turn, which is a constant-rate
     * sweep wearing a spring's clothes — the exact thing this class replaced.
     * Bounded torque is also just what a neck has.
     */
    private static final double MAX_DEGREES_PER_SECOND_SQUARED = 2600.0;
    /** How strongly the tremor pulls back to centre. */
    private static final double TREMOR_RETURN = 0.12;
    private static final double TREMOR_SCALE = 0.055;

    private final Rng rng;

    private double yaw;
    private double pitch;
    private double yawVelocity;
    private double pitchVelocity;

    /** The committed target, which lags the true one by a reaction time. */
    private double heldYaw;
    private double heldPitch;
    private int holdTicks;

    private double tremorYaw;
    private double tremorPitch;

    public Look(Rng rng, double yaw, double pitch) {
        this.rng = rng;
        this.yaw = yaw;
        this.pitch = pitch;
        this.heldYaw = yaw;
        this.heldPitch = pitch;
    }

    /** Jump the view without any spring, for a fresh start rather than a turn. */
    public void reset(double yawNow, double pitchNow) {
        this.yaw = yawNow;
        this.pitch = pitchNow;
        this.heldYaw = yawNow;
        this.heldPitch = pitchNow;
        this.yawVelocity = 0;
        this.pitchVelocity = 0;
        this.holdTicks = 0;
    }

    public double yaw() {
        return yaw;
    }

    public double pitch() {
        return pitch;
    }

    /** Advance one tick toward the given target. Returns the new yaw. */
    public double tick(double targetYaw, double targetPitch) {
        if (--holdTicks <= 0) {
            heldYaw = targetYaw;
            heldPitch = targetPitch;
            // Three to eight ticks, so 150ms to 400ms: human reaction, and it
            // varies, because a fixed interval is its own kind of tell.
            holdTicks = 3 + (int) (rng.next() * 6);
        }

        tremorYaw += (rng.normal(0, 1) * TREMOR_SCALE) - tremorYaw * TREMOR_RETURN;
        tremorPitch += (rng.normal(0, 1) * TREMOR_SCALE) - tremorPitch * TREMOR_RETURN;

        yawVelocity = step(yawVelocity, wrap(heldYaw + tremorYaw - yaw));
        pitchVelocity = step(pitchVelocity, clamp(heldPitch + tremorPitch, -90, 90) - pitch);

        yaw = wrap(yaw + yawVelocity * DT);
        pitch = clamp(pitch + pitchVelocity * DT, -90, 90);
        return yaw;
    }

    private static double step(double velocity, double error) {
        double acceleration = clamp(
                STIFFNESS * STIFFNESS * error - 2 * DAMPING * STIFFNESS * velocity,
                -MAX_DEGREES_PER_SECOND_SQUARED, MAX_DEGREES_PER_SECOND_SQUARED);
        return clamp(velocity + acceleration * DT, -MAX_DEGREES_PER_SECOND, MAX_DEGREES_PER_SECOND);
    }

    /** True once the view is pointing where it was asked to and has stopped moving. */
    public boolean settled(double targetYaw, double tolerance) {
        return Math.abs(wrap(targetYaw - yaw)) < tolerance && Math.abs(yawVelocity) < 8;
    }

    public static double wrap(double degrees) {
        double d = degrees % 360.0;
        if (d >= 180.0) d -= 360.0;
        if (d < -180.0) d += 360.0;
        return d;
    }

    private static double clamp(double value, double low, double high) {
        return value < low ? low : Math.min(value, high);
    }
}
