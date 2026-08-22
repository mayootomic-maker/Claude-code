package app.margin.core.design

import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.SpringSpec
import androidx.compose.animation.core.VisibilityThreshold
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp

/**
 * Three tiers plus a reward tier. Springs throughout, so motion responds to interruption
 * instead of replaying a fixed curve.
 *
 * A tier is chosen by what the motion means:
 *   Press    - something is under the finger right now
 *   Standard - layout, list and value changes
 *   Gentle   - large surfaces: sheets, screen transitions
 *   Reward   - the user committed to something and it worked
 */
object Motion {

    const val PressDamping = 0.88f
    const val PressStiffness = 1700f

    const val StandardDamping = 0.82f
    const val StandardStiffness = 420f

    const val GentleDamping = 1f
    const val GentleStiffness = 190f

    const val RewardDamping = 0.52f
    const val RewardStiffness = 560f

    val pressFloat: SpringSpec<Float> = spring(PressDamping, PressStiffness)
    val standardFloat: SpringSpec<Float> = spring(StandardDamping, StandardStiffness)
    val gentleFloat: SpringSpec<Float> = spring(GentleDamping, GentleStiffness)
    val rewardFloat: SpringSpec<Float> = spring(RewardDamping, RewardStiffness)

    val standardDp: SpringSpec<Dp> =
        spring(StandardDamping, StandardStiffness, Dp.VisibilityThreshold)
    val standardIntOffset: SpringSpec<IntOffset> =
        spring(StandardDamping, StandardStiffness, IntOffset.VisibilityThreshold)
    val gentleIntOffset: SpringSpec<IntOffset> =
        spring(GentleDamping, GentleStiffness, IntOffset.VisibilityThreshold)

    /**
     * Colour is the one thing that must not spring: there is no physical intuition for a hue
     * overshooting, so an overshooting colour reads as a rendering glitch.
     */
    fun <T> colorSpec(): AnimationSpec<T> = tween(durationMillis = 190)

    fun <T> fade(): FiniteAnimationSpec<T> = tween(durationMillis = 160)

    /** Press feedback is a small scale on discrete targets; full-bleed rows tint instead. */
    const val PressScaleLarge = 0.972f
    const val PressScaleSmall = 0.94f

    /** Entrance travel for staggered reveals. */
    val RevealTravel: Dp = 14.dp

    const val StaggerStepMs = 34L

    /** Items past this index appear together, so long lists never feel slow. */
    const val StaggerMaxIndex = 7

    /** Offset between skeleton pulses so a stack does not throb in unison. */
    const val SkeletonPhaseStepMs = 90
}
