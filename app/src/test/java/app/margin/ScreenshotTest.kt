package app.margin

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.test.core.app.ApplicationProvider
import app.margin.core.design.MarginTheme
import app.margin.core.design.ThemeMode
import app.margin.di.AppContainer
import app.margin.ui.capture.CaptureScreen
import app.margin.ui.capture.CaptureViewModel
import app.margin.ui.evaluate.EvaluateScreen
import app.margin.ui.evaluate.EvaluateViewModel
import app.margin.ui.goals.GoalEditorScreen
import app.margin.ui.goals.GoalEditorViewModel
import app.margin.ui.goals.GoalsScreen
import app.margin.ui.goals.GoalsViewModel
import app.margin.ui.opportunities.OpportunitiesScreen
import app.margin.ui.opportunities.OpportunitiesViewModel
import app.margin.ui.owned.OwnedDetailScreen
import app.margin.ui.owned.OwnedDetailViewModel
import app.margin.ui.owned.OwnedScreen
import app.margin.ui.owned.OwnedViewModel
import app.margin.ui.sell.SellScreen
import app.margin.ui.sell.SellViewModel
import app.margin.ui.settings.SettingsScreen
import app.margin.ui.settings.SettingsViewModel
import app.margin.ui.today.TodayScreen
import app.margin.ui.today.TodayViewModel
import com.github.takahirom.roborazzi.captureRoboImage
import kotlinx.coroutines.runBlocking
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Renders every screen off-device and writes a PNG.
 *
 * There is no KVM in the build environment, so no emulator. These captures are how the UI
 * actually gets looked at: real view models over a real Room database seeded with the real
 * demo corpus, rendered at phone size in both themes. Motion is disabled so every capture
 * is deterministic.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h891dp-xhdpi", sdk = [34])
class ScreenshotTest {

    @get:Rule val compose = createComposeRule()

    private lateinit var container: AppContainer

    @Before
    fun setUp() {
        container = AppContainer(ApplicationProvider.getApplicationContext())
        runBlocking { container.seeder.reseed() }
    }

    /**
     * [readyText] must be text that only appears once the screen has real data. Without it
     * the capture races the Room flow and photographs the loading skeleton, which is exactly
     * what happened the first time this ran.
     */
    @OptIn(ExperimentalTestApi::class)
    private fun capture(
        name: String,
        mode: ThemeMode,
        readyText: String,
        content: @Composable () -> Unit,
    ) {
        compose.setContent {
            MarginTheme(mode = mode, motionEnabled = false) {
                Box(Modifier.fillMaxSize().background(MarginTheme.colors.canvas)) { content() }
            }
        }
        compose.waitUntilAtLeastOneExists(hasText(readyText, substring = true), 15_000)
        compose.waitForIdle()
        compose.onRoot().captureRoboImage("build/screens/$name-${mode.name.lowercase()}.png")
    }

    @Test fun today_light() = capture("01-today", ThemeMode.LIGHT, "Portfolio") {
        TodayScreen(TodayViewModel(container), {}, {}, {}, {})
    }

    @Test fun today_dark() = capture("01-today", ThemeMode.DARK, "Portfolio") {
        TodayScreen(TodayViewModel(container), {}, {}, {}, {})
    }

    @Test fun opportunities_light() = capture("02-opportunities", ThemeMode.LIGHT, "ranked by fit") {
        OpportunitiesScreen(OpportunitiesViewModel(container), {}, {}, {})
    }

    @Test fun opportunities_dark() = capture("02-opportunities", ThemeMode.DARK, "ranked by fit") {
        OpportunitiesScreen(OpportunitiesViewModel(container), {}, {}, {})
    }

    @Test fun evaluate_hero_light() = capture("03-evaluate-hero", ThemeMode.LIGHT, "Fair value") {
        EvaluateScreen(EvaluateViewModel(container, "l-ryzen"), {}, {})
    }

    @Test fun evaluate_hero_dark() = capture("03-evaluate-hero", ThemeMode.DARK, "Fair value") {
        EvaluateScreen(EvaluateViewModel(container, "l-ryzen"), {}, {})
    }

    @Test fun evaluate_memory_light() = capture("04-evaluate-memory", ThemeMode.LIGHT, "Fair value") {
        EvaluateScreen(EvaluateViewModel(container, "l-canyon-over"), {}, {})
    }

    @Test fun evaluate_risky_light() = capture("05-evaluate-risky", ThemeMode.LIGHT, "Fair value") {
        EvaluateScreen(EvaluateViewModel(container, "l-macbook-risky"), {}, {})
    }

    @Test fun owned_light() = capture("06-owned", ThemeMode.LIGHT, "unrealised") {
        OwnedScreen(OwnedViewModel(container), {})
    }

    @Test fun owned_dark() = capture("06-owned", ThemeMode.DARK, "unrealised") {
        OwnedScreen(OwnedViewModel(container), {})
    }

    @Test fun owned_detail_light() = capture("07-owned-detail", ThemeMode.LIGHT, "Worth today") {
        OwnedDetailScreen(OwnedDetailViewModel(container, "o-cube"), {}, {})
    }

    @Test fun owned_sold_light() = capture("08-owned-sold", ThemeMode.LIGHT, "Sold for") {
        OwnedDetailScreen(OwnedDetailViewModel(container, "o-ryzen-sold"), {}, {})
    }

    @Test fun goals_light() = capture("09-goals", ThemeMode.LIGHT, "matches") {
        GoalsScreen(GoalsViewModel(container), {})
    }

    @Test fun goal_editor_light() = capture("10-goal-editor", ThemeMode.LIGHT, "What are you looking for") {
        GoalEditorScreen(GoalEditorViewModel(container, "goal-pcflip"), {})
    }

    @Test fun capture_light() = capture("11-capture", ThemeMode.LIGHT, "Paste a marketplace link") {
        CaptureScreen(CaptureViewModel(container, null), {}, {})
    }

    @Test fun sell_light() = capture("12-sell", ThemeMode.LIGHT, "Price") {
        SellScreen(SellViewModel(container, "o-macbook"), {}, {})
    }

    @Test fun settings_light() = capture("13-settings", ThemeMode.LIGHT, "Valuation") {
        SettingsScreen(SettingsViewModel(container))
    }

    @Test fun settings_dark() = capture("13-settings", ThemeMode.DARK, "Valuation") {
        SettingsScreen(SettingsViewModel(container))
    }
}
