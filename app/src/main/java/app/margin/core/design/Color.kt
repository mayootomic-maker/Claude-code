package app.margin.core.design

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * Light is a warm stone ramp, dark is a warm charcoal one. The primary action is ink, not
 * blue; the blue accent is reserved for links, selection and focus.
 */
@Immutable
data class MarginColors(
    val canvas: Color,
    val surface: Color,
    val surfaceMuted: Color,
    val hairline: Color,
    val hairlineStrong: Color,
    val inkStrong: Color,
    val ink: Color,
    val inkMuted: Color,
    val inkFaint: Color,
    val inkDisabled: Color,
    /** Foreground on an inkStrong-filled surface. */
    val onInk: Color,
    /** Foreground on an accent-filled surface. */
    val onAccent: Color,
    val accent: Color,
    val accentPressed: Color,
    val accentSoft: Color,
    val focusRing: Color,
    val positive: Color,
    val positiveSoft: Color,
    val negative: Color,
    val negativeSoft: Color,
    val caution: Color,
    val cautionSoft: Color,
    val scrim: Color,
    /** Five authored steps, worst to best. Not alpha derivations: those composite muddy. */
    val scoreRamp: List<Color>,
    /** Stable per-category plate fills, so lists have rhythm without becoming confetti. */
    val plateTints: List<Color>,
    val isDark: Boolean,
) {
    fun forScore(score: Int): Color = when {
        score >= 78 -> scoreRamp[4]
        score >= 62 -> scoreRamp[3]
        score >= 46 -> scoreRamp[2]
        score >= 30 -> scoreRamp[1]
        else -> scoreRamp[0]
    }

    fun softForScore(score: Int): Color = when {
        score >= 62 -> positiveSoft
        score >= 46 -> cautionSoft
        else -> negativeSoft
    }

    fun forDelta(minor: Long): Color = when {
        minor > 0L -> positive
        minor < 0L -> negative
        else -> inkMuted
    }

    fun plateFor(index: Int): Color = plateTints[((index % plateTints.size) + plateTints.size) % plateTints.size]
}

val LightMarginColors = MarginColors(
    canvas = Color(0xFFFAF9F7),
    surface = Color(0xFFFFFFFF),
    surfaceMuted = Color(0xFFF2F1EE),
    hairline = Color(0xFFE4E2DD),
    hairlineStrong = Color(0xFFD2CFC8),
    inkStrong = Color(0xFF14130F),
    ink = Color(0xFF2B2924),
    inkMuted = Color(0xFF605C55),
    inkFaint = Color(0xFF8A857C),
    inkDisabled = Color(0xFFB4AFA6),
    onInk = Color(0xFFFAF9F7),
    onAccent = Color(0xFFFFFFFF),
    accent = Color(0xFF2549B0),
    accentPressed = Color(0xFF1B3A93),
    accentSoft = Color(0xFFEAEEF9),
    focusRing = Color(0xFF2549B0),
    positive = Color(0xFF0B6B4E),
    positiveSoft = Color(0xFFE5F0EA),
    negative = Color(0xFFA33A29),
    negativeSoft = Color(0xFFF8E9E5),
    caution = Color(0xFF8A6416),
    cautionSoft = Color(0xFFF7EFDD),
    scrim = Color(0x33000000),
    scoreRamp = listOf(
        Color(0xFFA33A29), Color(0xFFA85A32), Color(0xFF8A6416),
        Color(0xFF3F7A46), Color(0xFF0B6B4E),
    ),
    plateTints = listOf(
        Color(0xFFF2F1EE), Color(0xFFEDEFF4), Color(0xFFF1EFE9),
    ),
    isDark = false,
)

val DarkMarginColors = MarginColors(
    canvas = Color(0xFF0B0B0A),
    surface = Color(0xFF181715),
    surfaceMuted = Color(0xFF201F1C),
    hairline = Color(0xFF302E2A),
    hairlineStrong = Color(0xFF423F3A),
    inkStrong = Color(0xFFF5F3EF),
    ink = Color(0xFFDCD9D3),
    inkMuted = Color(0xFF9A948A),
    inkFaint = Color(0xFF6F6A61),
    inkDisabled = Color(0xFF57534B),
    onInk = Color(0xFF0B0B0A),
    onAccent = Color(0xFF0B0B0A),
    accent = Color(0xFF8AA6FF),
    accentPressed = Color(0xFF6E8CEB),
    accentSoft = Color(0xFF171B27),
    focusRing = Color(0xFF8AA6FF),
    positive = Color(0xFF4BC493),
    positiveSoft = Color(0xFF11231C),
    negative = Color(0xFFE87A63),
    negativeSoft = Color(0xFF2A1713),
    caution = Color(0xFFD8A63F),
    cautionSoft = Color(0xFF241D0D),
    scrim = Color(0x66000000),
    scoreRamp = listOf(
        Color(0xFFE87A63), Color(0xFFDD8A55), Color(0xFFD8A63F),
        Color(0xFF86C069), Color(0xFF4BC493),
    ),
    plateTints = listOf(
        Color(0xFF201F1C), Color(0xFF1C1E24), Color(0xFF221F1B),
    ),
    isDark = true,
)

val LocalMarginColors = staticCompositionLocalOf { LightMarginColors }
