package app.margin.core.design

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

// --- Structure ---------------------------------------------------------------------------

@Composable
fun SectionLabel(
    text: String,
    modifier: Modifier = Modifier,
    trailing: (@Composable () -> Unit)? = null,
) {
    val c = MarginTheme.colors
    Row(
        modifier
            .fillMaxWidth()
            .padding(start = Space.screenH, end = Space.md, top = Space.lg, bottom = Space.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text.uppercase(),
            style = MarginTheme.type.label,
            color = c.inkMuted,
            modifier = Modifier.weight(1f),
        )
        trailing?.invoke()
    }
}

/** A bordered surface. Reserved for genuinely grouped settings-style rows. */
@Composable
fun Grouped(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val c = MarginTheme.colors
    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = Space.screenH)
            .clip(RoundedCornerShape(Radius.md))
            .background(c.surface)
            .border(Space.hair, c.hairline, RoundedCornerShape(Radius.md)),
        content = content,
    )
}

@Composable
fun Hairline(inset: Dp = Space.lg, modifier: Modifier = Modifier, color: Color? = null) {
    val c = MarginTheme.colors
    Box(
        modifier
            .fillMaxWidth()
            .padding(start = inset)
            .height(Space.hair)
            .background(color ?: c.hairline)
    )
}

/**
 * A full-bleed row. Presses register as a background change rather than a scale, because
 * scaling an edge-to-edge row opens visible gaps against its neighbours.
 */
@Composable
fun BleedRow(
    onClick: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
    verticalPadding: Dp = Space.rowV,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val base = modifier.fillMaxWidth()
    val row = if (onClick != null) base.tintOnPress(onClick) else base
    Row(
        row.padding(horizontal = Space.screenH, vertical = verticalPadding),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leading != null) {
            leading()
            Spacer(Modifier.width(Space.md))
        }
        Column(Modifier.weight(1f), content = content)
        if (trailing != null) {
            Spacer(Modifier.width(Space.md))
            trailing()
        }
    }
}

/** A row inside a [Grouped] surface. */
@Composable
fun GroupRow(
    onClick: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val base = modifier.fillMaxWidth()
    val row = if (onClick != null) base.tintOnPress(onClick) else base
    Row(
        row.padding(horizontal = Space.lg, vertical = Space.rowV),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leading != null) {
            leading()
            Spacer(Modifier.width(Space.md))
        }
        Column(Modifier.weight(1f), content = content)
        if (trailing != null) {
            Spacer(Modifier.width(Space.md))
            trailing()
        }
    }
}

@Composable
fun ScreenHeader(
    title: String,
    subtitle: String? = null,
    modifier: Modifier = Modifier,
    action: (@Composable () -> Unit)? = null,
) {
    val c = MarginTheme.colors
    Row(
        modifier
            .fillMaxWidth()
            .padding(start = Space.screenH, end = Space.sm, top = Space.lg, bottom = Space.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MarginTheme.type.titleXl, color = c.inkStrong)
            if (subtitle != null) {
                Spacer(Modifier.height(Space.xxs))
                Text(subtitle, style = MarginTheme.type.caption, color = c.inkMuted)
            }
        }
        action?.invoke()
    }
}

// --- Actions -----------------------------------------------------------------------------

/** The primary action is ink, not colour. Blue is reserved for links, selection and focus. */
@Composable
fun PrimaryAction(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    icon: ImageVector? = null,
    tone: Color? = null,
) {
    val c = MarginTheme.colors
    val bg = if (!enabled) c.surfaceMuted else (tone ?: c.inkStrong)
    val fg = if (!enabled) c.inkFaint else if (tone != null) c.onAccent else c.onInk
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = Space.touchTarget)
            .clip(RoundedCornerShape(Radius.sm))
            .background(bg)
            .committable(onClick = onClick, enabled = enabled)
            .padding(horizontal = Space.lg, vertical = Space.md),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, null, tint = fg, modifier = Modifier.size(17.dp))
            Spacer(Modifier.width(Space.sm))
        }
        Text(label, style = MarginTheme.type.bodyStrong, color = fg)
    }
}

@Composable
fun SecondaryAction(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    icon: ImageVector? = null,
    tone: Color? = null,
) {
    val c = MarginTheme.colors
    val fg = if (!enabled) c.inkDisabled else (tone ?: c.ink)
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = Space.touchTarget)
            .clip(RoundedCornerShape(Radius.sm))
            .background(c.surface)
            .border(Space.hair, c.hairlineStrong, RoundedCornerShape(Radius.sm))
            .committable(onClick = onClick, enabled = enabled)
            .padding(horizontal = Space.lg, vertical = Space.md),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, null, tint = fg, modifier = Modifier.size(17.dp))
            Spacer(Modifier.width(Space.sm))
        }
        Text(label, style = MarginTheme.type.bodyStrong, color = fg)
    }
}

@Composable
fun QuietAction(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    tone: Color? = null,
) {
    val c = MarginTheme.colors
    val fg = tone ?: c.accent
    Row(
        modifier
            .clip(RoundedCornerShape(Radius.xs))
            .pressable(onClick, pressedScale = Motion.PressScaleSmall)
            .padding(horizontal = Space.sm, vertical = Space.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, null, tint = fg, modifier = Modifier.size(15.dp))
            Spacer(Modifier.width(Space.xs))
        }
        Text(label, style = MarginTheme.type.captionStrong, color = fg)
    }
}

@Composable
fun IconAction(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tone: Color? = null,
) {
    val c = MarginTheme.colors
    Box(
        modifier
            .size(Space.touchTarget)
            .clip(RoundedCornerShape(Radius.sm))
            .pressable(onClick, pressedScale = Motion.PressScaleSmall, onClickLabel = contentDescription),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription, tint = tone ?: c.ink, modifier = Modifier.size(20.dp))
    }
}

// --- Input -------------------------------------------------------------------------------

/**
 * A hairline field with the label above it. Material's floating label, filled container and
 * indicator line carry their own radii and rhythm and would visibly belong to another app.
 */
@Composable
fun MarginField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    placeholder: String = "",
    keyboardType: KeyboardType = KeyboardType.Text,
    singleLine: Boolean = true,
    minHeight: Dp = Space.touchTarget,
    prefix: String? = null,
    supporting: String? = null,
) {
    val c = MarginTheme.colors
    val interaction = remember { MutableInteractionSource() }
    Column(modifier.fillMaxWidth()) {
        Text(label, style = MarginTheme.type.caption, color = c.inkMuted)
        Spacer(Modifier.height(6.dp))
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = minHeight)
                .clip(RoundedCornerShape(Radius.sm))
                .background(c.surface)
                .border(Space.hair, c.hairlineStrong, RoundedCornerShape(Radius.sm))
                .padding(horizontal = Space.md, vertical = Space.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (prefix != null) {
                Text(prefix, style = MarginTheme.type.numeralS, color = c.inkFaint)
                Spacer(Modifier.width(Space.sm))
            }
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                if (value.isEmpty() && placeholder.isNotEmpty()) {
                    Text(placeholder, style = MarginTheme.type.body, color = c.inkFaint)
                }
                BasicTextField(
                    value = value,
                    onValueChange = onValueChange,
                    textStyle = LocalTextStyle.current.merge(
                        MarginTheme.type.body.copy(color = c.inkStrong)
                    ),
                    singleLine = singleLine,
                    cursorBrush = SolidColor(c.accent),
                    interactionSource = interaction,
                    keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        if (supporting != null) {
            Spacer(Modifier.height(5.dp))
            Text(supporting, style = MarginTheme.type.caption, color = c.inkFaint)
        }
    }
}

/** Money entry in major units; emits minor units. Rejects anything that is not a number. */
@Composable
fun MoneyField(
    minorValue: Long,
    onMinorChange: (Long) -> Unit,
    label: String,
    currency: String = "CHF",
    modifier: Modifier = Modifier,
    supporting: String? = null,
) {
    val text = remember(minorValue) { if (minorValue == 0L) "" else (minorValue / 100).toString() }
    MarginField(
        value = text,
        onValueChange = { raw ->
            val digits = raw.filter { it.isDigit() }.take(9)
            onMinorChange(if (digits.isEmpty()) 0L else digits.toLong() * 100)
        },
        label = label,
        placeholder = "0",
        keyboardType = KeyboardType.Number,
        prefix = currency,
        supporting = supporting,
        modifier = modifier,
    )
}

/** A real toggle, so the ban on decorative pills stays satisfiable. */
@Composable
fun SegmentedControl(
    options: List<String>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = MarginTheme.colors
    Row(
        modifier
            .clip(RoundedCornerShape(Radius.sm))
            .background(c.surface)
            .border(Space.hair, c.hairlineStrong, RoundedCornerShape(Radius.sm))
            .padding(2.dp),
    ) {
        options.forEachIndexed { index, option ->
            val selected = index == selectedIndex
            Box(
                Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(Radius.xs))
                    .background(if (selected) c.surfaceMuted else Color.Transparent)
                    .pressable({ onSelect(index) }, pressedScale = Motion.PressScaleSmall)
                    .padding(vertical = 9.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    option,
                    style = MarginTheme.type.captionStrong,
                    color = if (selected) c.inkStrong else c.inkMuted,
                    maxLines = 1,
                )
            }
        }
    }
}

/** Progress through the Sell flow. Steps are ticks on a rule, not numbered circles. */
@Composable
fun StepIndicator(
    stepCount: Int,
    currentStep: Int,
    modifier: Modifier = Modifier,
) {
    val c = MarginTheme.colors
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Space.xs)) {
        repeat(stepCount) { index ->
            val done = index <= currentStep
            Box(
                Modifier
                    .weight(1f)
                    .height(3.dp)
                    .clip(RoundedCornerShape(1.5.dp))
                    .background(if (done) c.inkStrong else c.hairline)
            )
        }
    }
}

// --- Data display -------------------------------------------------------------------------

/**
 * Label left, figure right on a fixed-width numeric column so values share a decimal axis
 * down the whole list. This is what makes a column of money read as a ledger.
 */
@Composable
fun KeyValueRow(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    valueColor: Color? = null,
    emphasis: Boolean = false,
    support: String? = null,
) {
    val c = MarginTheme.colors
    Row(
        modifier
            .fillMaxWidth()
            .padding(vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                label,
                style = if (emphasis) MarginTheme.type.bodyStrong else MarginTheme.type.body,
                color = if (emphasis) c.inkStrong else c.inkMuted,
            )
            if (support != null) {
                Text(support, style = MarginTheme.type.caption, color = c.inkFaint)
            }
        }
        Spacer(Modifier.width(Space.md))
        Text(
            value,
            style = if (emphasis) MarginTheme.type.numeralM else MarginTheme.type.numeralS,
            color = valueColor ?: if (emphasis) c.inkStrong else c.ink,
            textAlign = TextAlign.End,
            maxLines = 1,
        )
    }
}

/** A signed money delta. Sign and colour are derived from one place so they cannot disagree. */
@Composable
fun DeltaValue(
    minor: Long,
    currency: String,
    modifier: Modifier = Modifier,
    style: androidx.compose.ui.text.TextStyle? = null,
    compact: Boolean = false,
) {
    val c = MarginTheme.colors
    val text = if (compact) {
        app.margin.core.format.Money.compact(minor, currency)
    } else {
        app.margin.core.format.Money.format(minor, currency, alwaysSigned = true)
    }
    Text(
        text,
        style = style ?: MarginTheme.type.numeralS,
        color = c.forDelta(minor),
        modifier = modifier,
        maxLines = 1,
    )
}

@Composable
fun Metric(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    valueColor: Color? = null,
    support: String? = null,
    large: Boolean = false,
) {
    val c = MarginTheme.colors
    Column(modifier) {
        Text(label, style = MarginTheme.type.caption, color = c.inkMuted)
        Spacer(Modifier.height(4.dp))
        Text(
            value,
            style = if (large) MarginTheme.type.numeralL else MarginTheme.type.numeralM,
            color = valueColor ?: c.inkStrong,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (support != null) {
            Spacer(Modifier.height(2.dp))
            Text(support, style = MarginTheme.type.caption, color = c.inkFaint)
        }
    }
}

/** Small status label. Rectangular with a small radius; used for status, never decoration. */
@Composable
fun StatusLabel(
    text: String,
    modifier: Modifier = Modifier,
    fg: Color? = null,
    bg: Color? = null,
) {
    val c = MarginTheme.colors
    Text(
        text.uppercase(),
        style = MarginTheme.type.label,
        color = fg ?: c.inkMuted,
        modifier = modifier
            .clip(RoundedCornerShape(Radius.xs))
            .background(bg ?: c.surfaceMuted)
            .padding(horizontal = 7.dp, vertical = 4.dp),
    )
}

/** Value history for an owned item. */
@Composable
fun Sparkline(
    points: List<Long>,
    color: Color,
    modifier: Modifier = Modifier,
    height: Dp = 28.dp,
    strokeWidth: Dp = 1.6.dp,
) {
    if (points.size < 2) {
        Box(modifier.height(height))
        return
    }
    Canvas(modifier.fillMaxWidth().height(height)) {
        val min = points.min().toFloat()
        val max = points.max().toFloat()
        val range = (max - min).takeIf { it > 0f } ?: 1f
        val stepX = size.width / (points.size - 1)
        val path = Path()
        points.forEachIndexed { i, value ->
            val x = i * stepX
            val y = size.height - ((value.toFloat() - min) / range) * size.height
            if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        drawPath(
            path, color,
            style = Stroke(strokeWidth.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round),
        )
        val lastX = size.width
        val lastY = size.height -
            ((points.last().toFloat() - min) / range) * size.height
        drawCircle(color, radius = 2.4.dp.toPx(), center = Offset(lastX - 2.4.dp.toPx(), lastY))
    }
}

// --- States --------------------------------------------------------------------------------

@Composable
fun EmptyState(
    title: String,
    body: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    action: (@Composable () -> Unit)? = null,
) {
    val c = MarginTheme.colors
    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = Space.section, vertical = Space.section),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (icon != null) {
            Box(
                Modifier
                    .size(44.dp)
                    .clip(RoundedCornerShape(Radius.md))
                    .background(c.surfaceMuted),
                contentAlignment = Alignment.Center,
            ) { Icon(icon, null, tint = c.inkFaint, modifier = Modifier.size(20.dp)) }
            Spacer(Modifier.height(Space.lg))
        }
        Text(title, style = MarginTheme.type.heading, color = c.inkStrong, textAlign = TextAlign.Center)
        Spacer(Modifier.height(Space.xs))
        Text(body, style = MarginTheme.type.body, color = c.inkMuted, textAlign = TextAlign.Center)
        if (action != null) {
            Spacer(Modifier.height(Space.xl))
            Box(Modifier.widthIn(max = 280.dp)) { action() }
        }
    }
}

@Composable
fun ErrorState(
    title: String,
    body: String,
    modifier: Modifier = Modifier,
    onRetry: (() -> Unit)? = null,
) {
    val c = MarginTheme.colors
    Box(
        modifier
            .fillMaxWidth()
            .padding(horizontal = Space.screenH, vertical = Space.md)
            .clip(RoundedCornerShape(Radius.md))
            .background(c.negativeSoft)
            .border(
                BorderStroke(Space.hair, c.negative.copy(alpha = 0.22f)),
                RoundedCornerShape(Radius.md),
            )
            .padding(Space.lg)
    ) {
        Column {
            Text(title, style = MarginTheme.type.heading, color = c.negative)
            Spacer(Modifier.height(Space.xs))
            Text(body, style = MarginTheme.type.body, color = c.ink)
            if (onRetry != null) {
                Spacer(Modifier.height(Space.md))
                QuietAction("Try again", onRetry, tone = c.negative)
            }
        }
    }
}

/**
 * Loading placeholder. Phases are offset per index so a stack of them does not pulse in
 * unison, which reads as a broken screen rather than as content arriving.
 */
@Composable
fun SkeletonBlock(
    modifier: Modifier = Modifier,
    height: Dp = 14.dp,
    widthFraction: Float = 1f,
    index: Int = 0,
) {
    val c = MarginTheme.colors
    val pulse = rememberStaggeredPulse(index)
    Box(
        modifier
            .fillMaxWidth(widthFraction)
            .height(height)
            .clip(RoundedCornerShape(Radius.xs))
            .background(c.surfaceMuted.copy(alpha = 0.5f + 0.5f * pulse))
    )
}
