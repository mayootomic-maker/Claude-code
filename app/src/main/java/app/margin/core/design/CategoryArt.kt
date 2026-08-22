package app.margin.core.design

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import app.margin.domain.model.Category
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Product imagery without a network, and without grey placeholder boxes.
 *
 * Each category is drawn as minimal line art on a neutral plate. It is honest — it never
 * pretends to be a photo of the actual item — and it gives lists a designed rhythm instead
 * of the "unloaded image" look that makes prototypes read as unfinished.
 */
enum class ArtCategory {
    BICYCLE, COMPUTER, LAPTOP, CAMERA, PHONE, AUDIO, WATCH, TOOL,
    FURNITURE, DRONE, INSTRUMENT, PACKAGE;

    companion object {
        fun of(category: Category): ArtCategory = when (category) {
            Category.BIKE -> BICYCLE
            Category.PC -> COMPUTER
            Category.LAPTOP -> LAPTOP
            Category.CAMERA -> CAMERA
            Category.PHONE -> PHONE
            Category.AUDIO -> AUDIO
            Category.WATCH -> WATCH
            Category.TOOL -> TOOL
            Category.FURNITURE -> FURNITURE
            Category.DRONE -> DRONE
            Category.INSTRUMENT -> INSTRUMENT
            Category.OTHER -> PACKAGE
        }
    }
}

/** A framed plate carrying the category line art. Fixed square, used in every list row. */
@Composable
fun CategoryPlate(
    category: Category,
    modifier: Modifier = Modifier,
    size: Dp = 48.dp,
    radius: Dp = Radius.sm,
    tint: Color? = null,
) {
    val c = MarginTheme.colors
    Box(
        modifier
            .size(size)
            .clip(RoundedCornerShape(radius))
            .background(c.plateFor(category.ordinal))
            .border(Space.hair, c.hairline, RoundedCornerShape(radius)),
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.fillMaxSize()) {
            drawCategory(ArtCategory.of(category), tint ?: c.inkMuted)
        }
    }
}

/** The same art at feature size, used on detail screens. */
@Composable
fun CategoryFeature(
    category: Category,
    modifier: Modifier = Modifier,
    size: Dp = 160.dp,
    tint: Color? = null,
) {
    val c = MarginTheme.colors
    Box(
        modifier
            .size(size)
            .clip(RoundedCornerShape(Radius.md))
            .background(c.plateFor(category.ordinal))
            .border(Space.hair, c.hairline, RoundedCornerShape(Radius.md)),
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.fillMaxSize()) { drawCategory(ArtCategory.of(category), tint ?: c.inkMuted) }
    }
}

/**
 * All art is authored in a 100x100 space and scaled to the available box, so the same
 * drawing is used from a 40dp row thumbnail to a 220dp feature image.
 */
private fun DrawScope.drawCategory(category: ArtCategory, color: Color) {
    val side = minOf(size.width, size.height)
    val unit = side / 100f
    val ox = (size.width - side) / 2f
    val oy = (size.height - side) / 2f
    // Optical, not linear: small glyphs need a proportionally heavier line to stay legible,
    // large ones need a lighter one to avoid looking like a doodle.
    val strokeScale = when {
        side < 56f -> 6.0f
        side < 160f -> 4.2f
        else -> 3.0f
    }
    val stroke = Stroke(
        width = strokeScale * unit,
        cap = StrokeCap.Round,
        join = StrokeJoin.Round,
    )
    fun p(x: Float, y: Float) = Offset(ox + x * unit, oy + y * unit)
    fun line(x1: Float, y1: Float, x2: Float, y2: Float) =
        drawLine(color, p(x1, y1), p(x2, y2), stroke.width, StrokeCap.Round)
    fun circle(cx: Float, cy: Float, r: Float) =
        drawCircle(color, r * unit, p(cx, cy), style = stroke)
    fun rect(x: Float, y: Float, w: Float, h: Float, r: Float = 3f) = drawRoundRect(
        color = color,
        topLeft = p(x, y),
        size = Size(w * unit, h * unit),
        cornerRadius = androidx.compose.ui.geometry.CornerRadius(r * unit, r * unit),
        style = stroke,
    )
    fun path(build: Path.() -> Unit) {
        val path = Path().apply(build)
        drawPath(path, color, style = stroke)
    }

    when (category) {
        ArtCategory.BICYCLE -> {
            circle(26f, 66f, 17f)
            circle(74f, 66f, 17f)
            line(26f, 66f, 45f, 66f)   // down tube base
            line(45f, 66f, 58f, 36f)   // seat tube
            line(58f, 36f, 74f, 66f)   // fork
            line(45f, 66f, 62f, 40f)
            line(52f, 36f, 66f, 36f)   // saddle
            line(70f, 32f, 80f, 34f)   // bar
        }
        ArtCategory.COMPUTER -> {
            rect(30f, 18f, 40f, 64f, 4f)
            line(38f, 30f, 54f, 30f)
            line(38f, 38f, 54f, 38f)
            circle(50f, 62f, 7f)
        }
        ArtCategory.LAPTOP -> {
            rect(24f, 26f, 52f, 34f, 3f)
            line(16f, 68f, 84f, 68f)
            line(24f, 60f, 76f, 60f)
        }
        ArtCategory.CAMERA -> {
            rect(16f, 32f, 68f, 42f, 5f)
            circle(50f, 53f, 13f)
            line(34f, 32f, 40f, 24f)
            line(40f, 24f, 60f, 24f)
            line(60f, 24f, 66f, 32f)
        }
        ArtCategory.PHONE -> {
            rect(32f, 14f, 36f, 72f, 6f)
            line(45f, 22f, 55f, 22f)
        }
        ArtCategory.AUDIO -> {
            path {
                moveTo(ox + 24f * unit, oy + 60f * unit)
                cubicTo(
                    ox + 22f * unit, oy + 24f * unit,
                    ox + 78f * unit, oy + 24f * unit,
                    ox + 76f * unit, oy + 60f * unit,
                )
            }
            rect(16f, 56f, 16f, 26f, 6f)
            rect(68f, 56f, 16f, 26f, 6f)
        }
        ArtCategory.WATCH -> {
            circle(50f, 50f, 20f)
            line(50f, 44f, 50f, 51f)
            line(50f, 51f, 57f, 54f)
            line(40f, 32f, 42f, 18f)
            line(60f, 32f, 58f, 18f)
            line(40f, 68f, 42f, 82f)
            line(60f, 68f, 58f, 82f)
        }
        ArtCategory.TOOL -> {
            rect(22f, 34f, 40f, 24f, 5f)
            line(62f, 46f, 80f, 46f)
            path {
                moveTo(ox + 34f * unit, oy + 58f * unit)
                lineTo(ox + 34f * unit, oy + 80f * unit)
                lineTo(ox + 50f * unit, oy + 80f * unit)
                lineTo(ox + 48f * unit, oy + 58f * unit)
            }
        }
        ArtCategory.FURNITURE -> {
            line(26f, 54f, 74f, 54f)
            line(30f, 54f, 30f, 80f)
            line(70f, 54f, 70f, 80f)
            line(34f, 54f, 38f, 22f)
            line(38f, 22f, 66f, 26f)
            line(66f, 26f, 64f, 42f)
        }
        ArtCategory.DRONE -> {
            rect(38f, 40f, 24f, 20f, 5f)
            line(38f, 40f, 22f, 26f)
            line(62f, 40f, 78f, 26f)
            line(38f, 60f, 22f, 74f)
            line(62f, 60f, 78f, 74f)
            line(12f, 26f, 32f, 26f)
            line(68f, 26f, 88f, 26f)
            line(12f, 74f, 32f, 74f)
            line(68f, 74f, 88f, 74f)
        }
        ArtCategory.INSTRUMENT -> {
            circle(42f, 62f, 22f)
            line(58f, 48f, 78f, 26f)
            line(74f, 18f, 84f, 28f)
            circle(42f, 62f, 8f)
        }
        ArtCategory.PACKAGE -> {
            path {
                moveTo(ox + 50f * unit, oy + 18f * unit)
                lineTo(ox + 80f * unit, oy + 34f * unit)
                lineTo(ox + 80f * unit, oy + 66f * unit)
                lineTo(ox + 50f * unit, oy + 82f * unit)
                lineTo(ox + 20f * unit, oy + 66f * unit)
                lineTo(ox + 20f * unit, oy + 34f * unit)
                close()
            }
            line(20f, 34f, 50f, 50f)
            line(80f, 34f, 50f, 50f)
            line(50f, 50f, 50f, 82f)
        }
    }
}
