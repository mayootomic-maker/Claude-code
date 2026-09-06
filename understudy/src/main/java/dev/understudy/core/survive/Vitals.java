package dev.understudy.core.survive;

/**
 * Everything the survival check is allowed to know, as plain numbers.
 *
 * A record rather than a live handle to the player so the rules can be tested
 * against situations that are tedious to arrange in a real game — drowning at
 * two hearts with a skeleton four blocks away — and so the rules themselves
 * never depend on a Minecraft type that the next version renames.
 */
public record Vitals(
        double health,
        double maxHealth,
        int food,
        /** Whether there is anything in the inventory worth eating. */
        boolean hasFood,
        int air,
        int maxAir,
        boolean onFire,
        boolean inLava,
        boolean inWater,
        double fallDistance,
        /** Hostiles within the scan radius. */
        int hostilesNear,
        /** Distance to the closest one, or a large number when there are none. */
        double nearestHostile) {

    public double healthFraction() {
        return maxHealth <= 0 ? 1 : health / maxHealth;
    }

    public double airFraction() {
        return maxAir <= 0 ? 1 : (double) air / maxAir;
    }

    public static Vitals healthy() {
        return new Vitals(20, 20, 20, true, 300, 300, false, false, false, 0, 0, 999);
    }
}
