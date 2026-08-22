package app.margin.core.design

import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.SpringSpec
import androidx.compose.animation.core.VisibilityThreshold
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp

/**
 * Margin's motion language.
 *
 * Everything is spring-driven, so motion responds to interruption instead of replaying a
 * fixed curve. Four tiers cover the whole app; a fifth "reward" tier exists only for moments
 * where the user has committed to something and deserves confirmation.
 *
 * Rule enforced in review: motion must communicate state change, causality or confirmation.
 * Motion that only decorates is deleted.
 */
object Motion {

    // --- Tiers -------------------------------------------------------------------------

    /** Immediate tactile feedback under the finger. Fast, barely any overshoot. */
    const val PressDamping = 0.88f
    const val PressStiffness = 1700f

    /** The default for layout, list and value changes. Crisp with a trace of overshoot. */
    const val StandardDamping = 0.82f
    const val StandardStiffness = 420f

    /** Large surfaces: sheets, screen transitions. Heavier, never bouncy. */
    const val GentleDamping = 1f
    const val GentleStiffness = 190f

    /** Long travel with weight, e.g. a value bar sweeping across the screen. */
    const val FluidDamping = 0.9f
    const val FluidStiffness = 260f

    /** Commitment moments only: decision saved, draft ready. Visible, brief overshoot. */
    const val RewardDamping = 0.52f
    const val RewardStiffness = 560f

    fun <T> press(): SpringSpec<T> = spring(PressDamping, PressStiffness)
    fun <T> standard(): SpringSpec<T> = spring(StandardDamping, StandardStiffness)
    fun <T> gentle(): SpringSpec<T> = spring(GentleDamping, GentleStiffness)
    fun <T> fluid(): SpringSpec<T> = spring(FluidDamping, FluidStiffness)
    fun <T> reward(): SpringSpec<T> = spring(RewardDamping, RewardStiffness)

    // Typed variants; non-float animations need a visibility threshold to settle correctly.
    val pressFloat: SpringSpec<Float> = spring(PressDamping, PressStiffness)
    val standardFloat: SpringSpec<Float> = spring(StandardDamping, StandardStiffness)
    val gentleFloat: SpringSpec<Float> = spring(GentleDamping, GentleStiffness)
    val fluidFloat: SpringSpec<Float> = spring(FluidDamping, FluidStiffness)
    val rewardFloat: SpringSpec<Float> = spring(RewardDamping, RewardStiffness)

    val standardDp: SpringSpec<Dp> =
        spring(StandardDamping, StandardStiffness, Dp.VisibilityThreshold)
    val gentleDp: SpringSpec<Dp> =
        spring(GentleDamping, GentleStiffness, Dp.VisibilityThreshold)
    val standardIntOffset: SpringSpec<IntOffset> =
        spring(StandardDamping, StandardStiffness, IntOffset.VisibilityThreshold)
    val gentleIntOffset: SpringSpec<IntOffset> =
        spring(GentleDamping, GentleStiffness, IntOffset.VisibilityThreshold)
    val standardOffset: SpringSpec<Offset> =
        spring(StandardDamping, StandardStiffness, Offset.VisibilityThreshold)

    /**
     * Colour is the one place springs are wrong: an overshooting colour reads as a glitch,
     * because there is no physical intuition for a hue overshooting. Colour uses a short tween.
     */
    fun <T> colorSpec(): AnimationSpec<T> = tween(durationMillis = 190)

    /** Cross-fades for content swaps that should not draw attention to themselves. */
    fun <T> fade(): FiniteAnimationSpec<T> = tween(durationMillis = 160)

    // --- Shared constants used by the primitives ---------------------------------------

    /** Scale a surface drops to while pressed. Small: the feel comes from the spring, not the depth. */
    const val PressScaleLarge = 0.972f
    const val PressScaleSmall = 0.94f

    /** Entrance travel for staggered list reveals. */
    val RevealTravel: Dp = 14.dp

    /** Delay between successive items in a staggered reveal, in milliseconds. */
    const val StaggerStepMs = 34L

    /** Items past this index appear together, so long lists never feel slow. */
    const val StaggerMaxIndex = 7
}

/** Compose's default float spring, used where an explicit tier would be noise. */
val DefaultFloatSpring: SpringSpec<Float> =
    spring(Spring.DampingRatioNoBouncy, Spring.StiffnessMedium)
