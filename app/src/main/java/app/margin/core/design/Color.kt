package app.margin.core.design

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * Margin's palette is authored by hand for light and dark rather than derived by inversion.
 * The canvas is near-neutral; one accent hue carries all interactivity; three semantic hues
 * carry money outcomes. Nothing here is decorative.
 */
@Immutable
data class MarginColors(
    val canvas: Color,
    val surface: Color,
    val surfaceMuted: Color,
    val surfaceRaised: Color,
    val hairline: Color,
    val hairlineStrong: Color,
    val inkStrong: Color,
    val ink: Color,
    val inkMuted: Color,
    val inkFaint: Color,
    val onAccent: Color,
    val accent: Color,
    val accentSoft: Color,
    val positive: Color,
    val positiveSoft: Color,
    val negative: Color,
    val negativeSoft: Color,
    val caution: Color,
    val cautionSoft: Color,
    val scrim: Color,
    val isDark: Boolean,
) {
    /** Semantic colour for a 0..100 deal score. Deliberately three-hued, never a rainbow. */
    fun forScore(score: Int): Color = when {
        score >= 78 -> positive
        score >= 62 -> positive.copy(alpha = 0.86f)
        score >= 46 -> caution
        score >= 30 -> negative.copy(alpha = 0.86f)
        else -> negative
    }

    fun softForScore(score: Int): Color = when {
        score >= 62 -> positiveSoft
        score >= 46 -> cautionSoft
        else -> negativeSoft
    }

    /** Green for gain, clay for loss, muted ink for exactly zero. */
    fun forDelta(minor: Long): Color = when {
        minor > 0L -> positive
        minor < 0L -> negative
        else -> inkMuted
    }
}

val LightMarginColors = MarginColors(
    canvas = Color(0xFFFBFBFC),
    surface = Color(0xFFFFFFFF),
    surfaceMuted = Color(0xFFF3F4F7),
    surfaceRaised = Color(0xFFFFFFFF),
    hairline = Color(0xFFE5E7EC),
    hairlineStrong = Color(0xFFD2D6DE),
    inkStrong = Color(0xFF0C0E12),
    ink = Color(0xFF23272F),
    inkMuted = Color(0xFF61666F),
    inkFaint = Color(0xFF8C919A),
    onAccent = Color(0xFFFFFFFF),
    accent = Color(0xFF2B4FC9),
    accentSoft = Color(0xFFEBEFFB),
    positive = Color(0xFF0B6B4E),
    positiveSoft = Color(0xFFE3F1EB),
    negative = Color(0xFFA33A29),
    negativeSoft = Color(0xFFFAEAE6),
    caution = Color(0xFF8A6416),
    cautionSoft = Color(0xFFFAF1DC),
    scrim = Color(0x33000000),
    isDark = false,
)

val DarkMarginColors = MarginColors(
    canvas = Color(0xFF0A0B0D),
    surface = Color(0xFF121417),
    surfaceMuted = Color(0xFF191C21),
    surfaceRaised = Color(0xFF16191D),
    hairline = Color(0xFF23262C),
    hairlineStrong = Color(0xFF343841),
    inkStrong = Color(0xFFF4F5F7),
    ink = Color(0xFFDCDFE5),
    inkMuted = Color(0xFF979CA6),
    inkFaint = Color(0xFF6C727C),
    onAccent = Color(0xFF08101F),
    accent = Color(0xFF7B99FF),
    accentSoft = Color(0xFF161C2C),
    positive = Color(0xFF4BC493),
    positiveSoft = Color(0xFF0F241C),
    negative = Color(0xFFE87A63),
    negativeSoft = Color(0xFF2A1613),
    caution = Color(0xFFD8A63F),
    cautionSoft = Color(0xFF241C0C),
    scrim = Color(0x66000000),
    isDark = true,
)

val LocalMarginColors = staticCompositionLocalOf { LightMarginColors }
