package app.margin.core.design

import android.view.HapticFeedbackConstants
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/** Reusable spring primitives. Screens compose these; screens do not hand-roll animation. */

@Composable
private fun rememberTapHaptic(): (Boolean) -> Unit {
    val view = LocalView.current
    return remember(view) {
        { strong: Boolean ->
            view.performHapticFeedback(
                if (strong) HapticFeedbackConstants.LONG_PRESS
                else HapticFeedbackConstants.CONTEXT_CLICK
            )
        }
    }
}

/** Scale press, for discrete targets: buttons, icons, chips, plates. */
@Composable
fun Modifier.pressable(
    onClick: () -> Unit,
    enabled: Boolean = true,
    pressedScale: Float = Motion.PressScaleLarge,
    haptic: Boolean = true,
    role: Role? = Role.Button,
    onClickLabel: String? = null,
): Modifier {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val motionOn = LocalMotionEnabled.current
    val tap = rememberTapHaptic()
    val scale by animateFloatAsState(
        targetValue = if (pressed && enabled && motionOn) pressedScale else 1f,
        animationSpec = Motion.pressFloat,
        label = "pressScale",
    )
    return this
        .scale(scale)
        .clickable(
            interactionSource = interaction,
            indication = null,
            enabled = enabled,
            role = role,
            onClickLabel = onClickLabel,
        ) {
            if (haptic) tap(false)
            onClick()
        }
}

/**
 * Tint press, for full-bleed rows. Scaling an edge-to-edge row opens visible gaps against
 * its neighbours, so the row darkens instead.
 */
@Composable
fun Modifier.tintOnPress(
    onClick: () -> Unit,
    enabled: Boolean = true,
    role: Role? = Role.Button,
): Modifier {
    val c = MarginTheme.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val motionOn = LocalMotionEnabled.current
    val tap = rememberTapHaptic()
    val alpha by animateFloatAsState(
        targetValue = if (pressed && enabled && motionOn) 1f else 0f,
        animationSpec = tween(90),
        label = "pressTint",
    )
    return this
        .drawBehind { if (alpha > 0f) drawRect(c.surfaceMuted.copy(alpha = alpha)) }
        .clickable(
            interactionSource = interaction,
            indication = null,
            enabled = enabled,
            role = role,
        ) {
            tap(false)
            onClick()
        }
}

/** A commitment tap: heavier haptic. Watch, Reject, Bought, and Sell publishing. */
@Composable
fun Modifier.committable(
    onClick: () -> Unit,
    enabled: Boolean = true,
    pressedScale: Float = Motion.PressScaleSmall,
): Modifier {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val motionOn = LocalMotionEnabled.current
    val tap = rememberTapHaptic()
    val scale by animateFloatAsState(
        targetValue = if (pressed && enabled && motionOn) pressedScale else 1f,
        animationSpec = Motion.pressFloat,
        label = "commitScale",
    )
    return this
        .scale(scale)
        .clickable(
            interactionSource = interaction,
            indication = null,
            enabled = enabled,
            role = Role.Button,
        ) {
            tap(true)
            onClick()
        }
}

/**
 * Animates a value on change only. Starting every Animatable at zero made numbers and bars
 * re-roll from nothing each time a list row was recycled during a scroll.
 */
@Composable
fun rememberAnimatedValue(
    target: Float,
    spec: AnimationSpec<Float> = Motion.standardFloat,
    animateOnFirstFrame: Boolean = false,
): Float {
    val motionOn = LocalMotionEnabled.current
    val anim = remember { Animatable(if (animateOnFirstFrame && motionOn) 0f else target) }
    LaunchedEffect(target, motionOn) {
        if (motionOn) anim.animateTo(target, spec) else anim.snapTo(target)
    }
    return anim.value
}

/**
 * Screen-level entrance flag. Hoisting this out of individual rows is what stops the
 * staggered reveal from replaying on every scroll and every back-navigation.
 */
@Composable
fun rememberRevealState(key: Any? = Unit): Boolean {
    val motionOn = LocalMotionEnabled.current
    val state = remember(key) { Animatable(if (motionOn) 0f else 1f) }
    LaunchedEffect(key, motionOn) {
        if (motionOn) state.animateTo(1f, tween(1)) else state.snapTo(1f)
    }
    return state.value >= 1f
}

/** Staggered entrance. [revealed] comes from [rememberRevealState] at screen level. */
@Composable
fun Modifier.revealAt(index: Int, revealed: Boolean = true): Modifier {
    val motionOn = LocalMotionEnabled.current
    val density = LocalDensity.current
    val progress = remember { Animatable(if (motionOn) 0f else 1f) }
    LaunchedEffect(revealed, motionOn) {
        if (!motionOn) { progress.snapTo(1f); return@LaunchedEffect }
        if (!revealed) return@LaunchedEffect
        delay(index.coerceAtMost(Motion.StaggerMaxIndex) * Motion.StaggerStepMs)
        progress.animateTo(1f, Motion.standardFloat)
    }
    val travelPx = with(density) { Motion.RevealTravel.toPx() }
    return this.graphicsLayer {
        val p = progress.value.coerceIn(0f, 1f)
        alpha = p
        translationY = (1f - p) * travelPx
    }
}

@Composable
fun rememberStaggeredPulse(index: Int): Float {
    val motionOn = LocalMotionEnabled.current
    if (!motionOn) return 1f
    val transition = rememberInfiniteTransition(label = "pulse")
    val v by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(
                durationMillis = 760,
                delayMillis = (index % 4) * Motion.SkeletonPhaseStepMs,
            ),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "pulseValue",
    )
    return v
}

/**
 * The deal score as a sweeping arc. 270 degrees of travel with a gap at the bottom, so it
 * reads as an instrument rather than a progress ring.
 */
@Composable
fun ScoreDial(
    score: Int,
    trackColor: Color,
    valueColor: Color,
    modifier: Modifier = Modifier,
    size: Dp = 76.dp,
    stroke: Dp = 6.dp,
    animateOnEntry: Boolean = true,
) {
    val animated = rememberAnimatedValue(
        score.coerceIn(0, 100) / 100f,
        Motion.gentleFloat,
        animateOnFirstFrame = animateOnEntry,
    )
    Canvas(modifier.size(size)) {
        val strokePx = stroke.toPx()
        val inset = strokePx / 2f
        val arcSize = Size(this.size.width - strokePx, this.size.height - strokePx)
        val topLeft = Offset(inset, inset)
        drawArc(
            color = trackColor, startAngle = 135f, sweepAngle = 270f, useCenter = false,
            topLeft = topLeft, size = arcSize,
            style = Stroke(width = strokePx, cap = StrokeCap.Round),
        )
        drawArc(
            color = valueColor, startAngle = 135f, sweepAngle = 270f * animated, useCenter = false,
            topLeft = topLeft, size = arcSize,
            style = Stroke(width = strokePx, cap = StrokeCap.Round),
        )
    }
}

@Composable
fun ValueBar(
    fraction: Float,
    color: Color,
    trackColor: Color,
    modifier: Modifier = Modifier,
    height: Dp = 6.dp,
) {
    val animated = rememberAnimatedValue(fraction.coerceIn(0f, 1f), Motion.standardFloat)
    Box(
        modifier
            .fillMaxWidth()
            .height(height)
            .clip(RoundedCornerShape(height / 2))
            .background(trackColor)
            .drawBehind {
                drawRoundRect(
                    color = color,
                    size = Size(size.width * animated, size.height),
                    cornerRadius = CornerRadius(size.height / 2f),
                )
            }
    )
}

/** Where the asking price sits inside the fair-value range. */
@Composable
fun RangeMarker(
    lowFraction: Float,
    highFraction: Float,
    markerFraction: Float,
    bandColor: Color,
    trackColor: Color,
    markerColor: Color,
    modifier: Modifier = Modifier,
    height: Dp = 12.dp,
    animateOnEntry: Boolean = true,
) {
    val marker = rememberAnimatedValue(
        markerFraction.coerceIn(0f, 1f), Motion.gentleFloat, animateOnFirstFrame = animateOnEntry,
    )
    val bandStart = rememberAnimatedValue(lowFraction.coerceIn(0f, 1f), Motion.gentleFloat)
    val bandEnd = rememberAnimatedValue(highFraction.coerceIn(0f, 1f), Motion.gentleFloat)
    Canvas(modifier.fillMaxWidth().height(height)) {
        val trackH = 3.dp.toPx()
        val cy = size.height / 2f
        drawRoundRect(
            color = trackColor,
            topLeft = Offset(0f, cy - trackH / 2f),
            size = Size(size.width, trackH),
            cornerRadius = CornerRadius(trackH / 2f),
        )
        val x0 = size.width * bandStart
        val x1 = size.width * bandEnd
        drawRoundRect(
            color = bandColor,
            topLeft = Offset(x0, cy - trackH / 2f),
            size = Size((x1 - x0).coerceAtLeast(2f), trackH),
            cornerRadius = CornerRadius(trackH / 2f),
        )
        val mx = size.width * marker
        drawRoundRect(
            color = markerColor,
            topLeft = Offset((mx - 1.5.dp.toPx()).coerceIn(0f, size.width - 3.dp.toPx()), 0f),
            size = Size(3.dp.toPx(), size.height),
            cornerRadius = CornerRadius(1.5.dp.toPx()),
        )
    }
}
