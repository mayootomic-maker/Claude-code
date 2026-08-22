package app.margin.core.design

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * Large text is light, small text is heavy. Only the numeral styles carry tabular figures —
 * tabular digits in running prose make paragraphs read like a spreadsheet.
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
        fontFamily = Sans, fontWeight = FontWeight.Normal, fontSize = 32.sp,
        lineHeight = 38.sp, letterSpacing = (-0.8).sp,
    ),
    titleXl = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.Normal, fontSize = 25.sp,
        lineHeight = 31.sp, letterSpacing = (-0.5).sp,
    ),
    title = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.Medium, fontSize = 20.sp,
        lineHeight = 26.sp, letterSpacing = (-0.3).sp,
    ),
    heading = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.Medium, fontSize = 17.sp,
        lineHeight = 23.sp, letterSpacing = (-0.15).sp,
    ),
    body = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.Normal, fontSize = 15.sp,
        lineHeight = 22.sp,
    ),
    bodyStrong = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.Medium, fontSize = 15.sp,
        lineHeight = 22.sp,
    ),
    caption = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.Normal, fontSize = 13.sp,
        lineHeight = 18.sp,
    ),
    captionStrong = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.Medium, fontSize = 13.sp,
        lineHeight = 18.sp,
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
        fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 17.sp,
        lineHeight = 22.sp, letterSpacing = (-0.2).sp, fontFeatureSettings = TABULAR,
    ),
    numeralS = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.Medium, fontSize = 13.sp,
        lineHeight = 17.sp, fontFeatureSettings = TABULAR,
    ),
)

val LocalMarginType = staticCompositionLocalOf { MarginType }
