package app.margin

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.lifecycle.lifecycleScope
import app.margin.core.design.DarkMarginColors
import app.margin.core.design.LightMarginColors
import app.margin.core.design.MarginTheme
import app.margin.core.design.ThemeMode
import app.margin.data.prefs.AppPreferences
import app.margin.ui.nav.MarginNavHost
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(Color.Transparent.value.toInt(), Color.Transparent.value.toInt()),
        )
        super.onCreate(savedInstanceState)

        val container = (application as MarginApp).container

        // Seeding happens once, before the first frame that needs it. It is fast and local,
        // so there is no loading screen to justify.
        lifecycleScope.launch { container.seeder.ensureSeeded() }

        setContent {
            var sharedText by remember { mutableStateOf(extractSharedText(intent)) }
            val prefs by container.preferences.preferences.collectAsState(initial = AppPreferences())

            MarginTheme(mode = prefs.themeMode, motionEnabled = prefs.motionEnabled) {
                val dark = when (prefs.themeMode) {
                    ThemeMode.SYSTEM -> androidx.compose.foundation.isSystemInDarkTheme()
                    ThemeMode.LIGHT -> false
                    ThemeMode.DARK -> true
                }
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(if (dark) DarkMarginColors.canvas else LightMarginColors.canvas)
                ) {
                    MarginNavHost(
                        container = container,
                        sharedText = sharedText,
                        onSharedTextConsumed = { sharedText = null },
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        recreate()
    }

    /** Accepts both a shared URL and text selected in another app. */
    private fun extractSharedText(intent: Intent?): String? = when (intent?.action) {
        Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)
        Intent.ACTION_PROCESS_TEXT ->
            intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString()
        else -> null
    }?.takeIf { it.isNotBlank() }
}
