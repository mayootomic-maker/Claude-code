package app.margin.core.design

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf

enum class ThemeMode { SYSTEM, LIGHT, DARK }

/** Set to true in screenshot tests so animations settle deterministically. */
val LocalMotionEnabled = staticCompositionLocalOf { true }

object MarginTheme {
    val colors: MarginColors
        @Composable @ReadOnlyComposable get() = LocalMarginColors.current
    val type: MarginTypography
        @Composable @ReadOnlyComposable get() = LocalMarginType.current
}

@Composable
fun MarginTheme(
    mode: ThemeMode = ThemeMode.SYSTEM,
    motionEnabled: Boolean = true,
    content: @Composable () -> Unit,
) {
    val dark = when (mode) {
        ThemeMode.SYSTEM -> isSystemInDarkTheme()
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
    }
    val colors = if (dark) DarkMarginColors else LightMarginColors

    // Material 3 components (text fields, sheets, ripples) read the M3 scheme, so it is
    // mapped from the same tokens rather than left at Material's defaults.
    val m3 = if (dark) {
        darkColorScheme(
            primary = colors.accent, onPrimary = colors.onAccent,
            secondary = colors.accent, onSecondary = colors.onAccent,
            background = colors.canvas, onBackground = colors.ink,
            surface = colors.surface, onSurface = colors.ink,
            surfaceVariant = colors.surfaceMuted, onSurfaceVariant = colors.inkMuted,
            error = colors.negative, onError = colors.onAccent,
            outline = colors.hairlineStrong, outlineVariant = colors.hairline,
            scrim = colors.scrim,
        )
    } else {
        lightColorScheme(
            primary = colors.accent, onPrimary = colors.onAccent,
            secondary = colors.accent, onSecondary = colors.onAccent,
            background = colors.canvas, onBackground = colors.ink,
            surface = colors.surface, onSurface = colors.ink,
            surfaceVariant = colors.surfaceMuted, onSurfaceVariant = colors.inkMuted,
            error = colors.negative, onError = colors.onAccent,
            outline = colors.hairlineStrong, outlineVariant = colors.hairline,
            scrim = colors.scrim,
        )
    }

    CompositionLocalProvider(
        LocalMarginColors provides colors,
        LocalMarginType provides MarginType,
        LocalMotionEnabled provides motionEnabled,
        LocalTextStyle provides MarginType.body.copy(color = colors.ink),
    ) {
        MaterialTheme(
            colorScheme = m3,
            typography = Typography(
                bodyLarge = MarginType.body,
                bodyMedium = MarginType.body,
                labelLarge = MarginType.bodyStrong,
                titleMedium = MarginType.heading,
            ),
            content = content,
        )
    }
}
