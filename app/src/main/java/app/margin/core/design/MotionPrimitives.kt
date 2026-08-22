package app.margin.core.design

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.PressInteraction
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Reusable spring-driven primitives. Screens compose these; screens never hand-roll animation.
 */

/**
 * Tactile press response: the surface yields under the finger and springs back.
 * Ripple is suppressed because scale reads as more physical on dense, hairline-separated rows.
 */
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
    val hapticFeedback = LocalHapticFeedback.current
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
            if (haptic) hapticFeedback.performHapticFeedback(HapticFeedbackType.TextHandleMove)
            onClick()
        }
}

/** A commitment tap: heavier haptic, used for Watch / Reject / Bought and Sell publishing. */
@Composable
fun Modifier.committable(
    onClick: () -> Unit,
    enabled: Boolean = true,
    pressedScale: Float = Motion.PressScaleSmall,
): Modifier {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val motionOn = LocalMotionEnabled.current
    val hapticFeedback = LocalHapticFeedback.current
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
            hapticFeedback.performHapticFeedback(HapticFeedbackType.LongPress)
            onClick()
        }
}

/**
 * Drives a numeric value with a spring so figures roll into place instead of snapping.
 * Paired with tabular figures (see [MarginTypography]) so the text never reflows mid-roll.
 */
@Composable
fun rememberAnimatedValue(target: Float, spec: androidx.compose.animation.core.AnimationSpec<Float> = Motion.fluidFloat): Float {
    val motionOn = LocalMotionEnabled.current
    val anim = remember { Animatable(if (motionOn) 0f else target) }
    LaunchedEffect(target, motionOn) {
        if (motionOn) anim.animateTo(target, spec) else anim.snapTo(target)
    }
    return anim.value
}

/**
 * Staggered entrance for list content. Items lift and fade in sequence, capped so long
 * lists never feel like they are loading slowly.
 */
@Composable
fun Modifier.revealAt(index: Int, key: Any? = null): Modifier {
    val motionOn = LocalMotionEnabled.current
    val progress = remember(key, index) { Animatable(if (motionOn) 0f else 1f) }
    LaunchedEffect(key, index, motionOn) {
        if (!motionOn) { progress.snapTo(1f); return@LaunchedEffect }
        kotlinx.coroutines.delay(index.coerceAtMost(Motion.StaggerMaxIndex) * Motion.StaggerStepMs)
        progress.animateTo(1f, Motion.standardFloat)
    }
    return this.graphicsLayerReveal(progress.value)
}

private fun Modifier.graphicsLayerReveal(p: Float): Modifier = this.then(
    androidx.compose.ui.graphics.graphicsLayer {
        alpha = p.coerceIn(0f, 1f)
        translationY = (1f - p) * 34f
    }
)

/**
 * The deal score, drawn as a sweeping arc. The sweep is the animation — there is no separate
 * decorative motion. Track and value share a cap so the dial reads as a single instrument.
 */
@Composable
fun ScoreDial(
    score: Int,
    modifier: Modifier = Modifier,
    size: Dp = 76.dp,
    stroke: Dp = 6.dp,
    trackColor: Color,
    valueColor: Color,
) {
    val animated = rememberAnimatedValue(score.coerceIn(0, 100) / 100f, Motion.fluidFloat)
    Canvas(modifier.size(size)) {
        val strokePx = stroke.toPx()
        val inset = strokePx / 2f
        val arcSize = Size(this.size.width - strokePx, this.size.height - strokePx)
        val topLeft = Offset(inset, inset)
        // 270 degrees of travel leaves a deliberate gap at the bottom: it reads as an
        // instrument rather than a progress ring.
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

/** A proportional bar. Used for value composition, never as decoration. */
@Composable
fun ValueBar(
    fraction: Float,
    color: Color,
    trackColor: Color,
    modifier: Modifier = Modifier,
    height: Dp = 6.dp,
) {
    val animated = rememberAnimatedValue(fraction.coerceIn(0f, 1f), Motion.fluidFloat)
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
                    cornerRadius = androidx.compose.ui.geometry.CornerRadius(size.height / 2f),
                )
            }
    )
}

/**
 * Marks a value band on a scale: shows where the asking price sits inside the fair-value
 * range. This is the one chart in the app and it earns its place.
 */
@Composable
fun RangeMarker(
    lowFraction: Float,
    highFraction: Float,
    markerFraction: Float,
    bandColor: Color,
    trackColor: Color,
    markerColor: Color,
    modifier: Modifier = Modifier,
    height: Dp = 10.dp,
) {
    val marker = rememberAnimatedValue(markerFraction.coerceIn(0f, 1f), Motion.fluidFloat)
    val bandStart = rememberAnimatedValue(lowFraction.coerceIn(0f, 1f), Motion.fluidFloat)
    val bandEnd = rememberAnimatedValue(highFraction.coerceIn(0f, 1f), Motion.fluidFloat)
    Canvas(modifier.fillMaxWidth().height(height)) {
        val trackH = 3.dp.toPx()
        val cy = size.height / 2f
        drawRoundRect(
            color = trackColor,
            topLeft = Offset(0f, cy - trackH / 2f),
            size = Size(size.width, trackH),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(trackH / 2f),
        )
        val x0 = size.width * bandStart
        val x1 = size.width * bandEnd
        drawRoundRect(
            color = bandColor,
            topLeft = Offset(x0, cy - trackH / 2f),
            size = Size((x1 - x0).coerceAtLeast(2f), trackH),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(trackH / 2f),
        )
        val mx = size.width * marker
        drawRoundRect(
            color = markerColor,
            topLeft = Offset((mx - 1.5.dp.toPx()).coerceIn(0f, size.width - 3.dp.toPx()), 0f),
            size = Size(3.dp.toPx(), size.height),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(1.5.dp.toPx()),
        )
    }
}

/** Emits a press interaction programmatically; used by screenshot tests to capture pressed states. */
suspend fun MutableInteractionSource.simulatePress() {
    emit(PressInteraction.Press(Offset.Zero))
}

@Composable
fun CenteredBox(modifier: Modifier = Modifier, content: @Composable () -> Unit) =
    Box(modifier, contentAlignment = Alignment.Center) { content() }
