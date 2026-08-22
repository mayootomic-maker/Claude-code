package app.margin.core.design

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * Every style that can contain a figure carries `tnum` (tabular numerals) so that numbers
 * align in columns and do not jitter horizontally while a count-up animation runs.
 */
private const val TABULAR = "tnum"

private val Sans = FontFamily.Default

@Immutable
data class MarginTypography(
    val display: TextStyle,
    val titleXl: TextStyle,
    val title: TextStyle,
    val heading: TextStyle,
    val body: TextStyle,
    val bodyStrong: TextStyle,
    val caption: TextStyle,
    val captionStrong: TextStyle,
    val label: TextStyle,
    val numeralXl: TextStyle,
    val numeralL: TextStyle,
    val numeralM: TextStyle,
    val numeralS: TextStyle,
)

val MarginType = MarginTypography(
    display = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 32.sp,
        lineHeight = 38.sp, letterSpacing = (-0.7).sp, fontFeatureSettings = TABULAR,
    ),
    titleXl = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 25.sp,
        lineHeight = 31.sp, letterSpacing = (-0.5).sp, fontFeatureSettings = TABULAR,
    ),
    title = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 19.sp,
        lineHeight = 25.sp, letterSpacing = (-0.25).sp, fontFeatureSettings = TABULAR,
    ),
    heading = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 15.5.sp,
        lineHeight = 21.sp, letterSpacing = (-0.1).sp, fontFeatureSettings = TABULAR,
    ),
    body = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.Normal, fontSize = 14.5.sp,
        lineHeight = 21.sp, letterSpacing = 0.sp, fontFeatureSettings = TABULAR,
    ),
    bodyStrong = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.Medium, fontSize = 14.5.sp,
        lineHeight = 21.sp, letterSpacing = 0.sp, fontFeatureSettings = TABULAR,
    ),
    caption = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.Normal, fontSize = 12.5.sp,
        lineHeight = 17.sp, letterSpacing = 0.05.sp, fontFeatureSettings = TABULAR,
    ),
    captionStrong = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.Medium, fontSize = 12.5.sp,
        lineHeight = 17.sp, letterSpacing = 0.05.sp, fontFeatureSettings = TABULAR,
    ),
    label = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 11.sp,
        lineHeight = 14.sp, letterSpacing = 0.7.sp,
    ),
    numeralXl = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 38.sp,
        lineHeight = 44.sp, letterSpacing = (-1.2).sp, fontFeatureSettings = TABULAR,
    ),
    numeralL = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 26.sp,
        lineHeight = 31.sp, letterSpacing = (-0.6).sp, fontFeatureSettings = TABULAR,
    ),
    numeralM = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 16.sp,
        lineHeight = 21.sp, letterSpacing = (-0.2).sp, fontFeatureSettings = TABULAR,
    ),
    numeralS = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.Medium, fontSize = 13.sp,
        lineHeight = 17.sp, letterSpacing = 0.sp, fontFeatureSettings = TABULAR,
    ),
)

val LocalMarginType = staticCompositionLocalOf { MarginType }
