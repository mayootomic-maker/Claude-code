package app.margin.ui.settings

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.margin.core.design.Grouped
import app.margin.core.design.GroupRow
import app.margin.core.design.Hairline
import app.margin.core.design.MarginTheme
import app.margin.core.design.ScreenHeader
import app.margin.core.design.SectionLabel
import app.margin.core.design.SegmentedControl
import app.margin.core.design.Space
import app.margin.core.design.StatusLabel
import app.margin.core.design.ThemeMode

@Composable
fun SettingsScreen(
    viewModel: SettingsViewModel,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val c = MarginTheme.colors

    LazyColumn(modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = Space.section)) {
        item { ScreenHeader("Settings") }

        item { SectionLabel("Appearance") }
        item {
            Box(Modifier.padding(horizontal = Space.screenH)) {
                SegmentedControl(
                    options = listOf("System", "Light", "Dark"),
                    selectedIndex = when (state.themeMode) {
                        ThemeMode.SYSTEM -> 0
                        ThemeMode.LIGHT -> 1
                        ThemeMode.DARK -> 2
                    },
                    onSelect = {
                        viewModel.setTheme(
                            when (it) {
                                0 -> ThemeMode.SYSTEM
                                1 -> ThemeMode.LIGHT
                                else -> ThemeMode.DARK
                            }
                        )
                    },
                )
            }
            Spacer(Modifier.height(Space.md))
        }
        item {
            Grouped {
                GroupRow(
                    onClick = { viewModel.setMotion(!state.motionEnabled) },
                    trailing = {
                        StatusLabel(
                            if (state.motionEnabled) "On" else "Off",
                            fg = if (state.motionEnabled) c.positive else c.inkMuted,
                            bg = if (state.motionEnabled) c.positiveSoft else c.surfaceMuted,
                        )
                    },
                ) {
                    Text("Animation", style = MarginTheme.type.bodyStrong, color = c.inkStrong)
                    Spacer(Modifier.height(2.dp))
                    Text(
                        "Turn off if you prefer reduced motion.",
                        style = MarginTheme.type.caption, color = c.inkMuted,
                    )
                }
            }
        }

        item { SectionLabel("Data sources") }
        item {
            Grouped {
                GroupRow(trailing = { StatusLabel("Local", fg = c.positive, bg = c.positiveSoft) }) {
                    Text("Valuation", style = MarginTheme.type.bodyStrong, color = c.inkStrong)
                    Spacer(Modifier.height(2.dp))
                    Text(
                        state.engineId + " — computes fair value from a local table of " +
                            "comparable sales. No network is used.",
                        style = MarginTheme.type.caption, color = c.inkMuted,
                    )
                }
                Hairline()
                GroupRow(trailing = { StatusLabel("Local", fg = c.positive, bg = c.positiveSoft) }) {
                    Text("Link reading", style = MarginTheme.type.bodyStrong, color = c.inkStrong)
                    Spacer(Modifier.height(2.dp))
                    Text(
                        "Listings are matched against the local catalogue, or read from the " +
                            "text of the link itself. Pages are never fetched.",
                        style = MarginTheme.type.caption, color = c.inkMuted,
                    )
                }
                Hairline()
                GroupRow(trailing = { StatusLabel("Not connected") }) {
                    Text("Live marketplaces", style = MarginTheme.type.bodyStrong, color = c.inkStrong)
                    Spacer(Modifier.height(2.dp))
                    Text(
                        "Not configured in this build. The interfaces exist so a real " +
                            "marketplace or pricing service can be connected without " +
                            "changing any screen.",
                        style = MarginTheme.type.caption, color = c.inkMuted,
                    )
                }
            }
        }

        item { SectionLabel("Demo data") }
        item {
            Grouped {
                GroupRow(
                    onClick = viewModel::reseed,
                    trailing = {
                        if (state.reseeding) StatusLabel("Working") else null
                    },
                ) {
                    Text("Reset demo data", style = MarginTheme.type.bodyStrong, color = c.inkStrong)
                    Spacer(Modifier.height(2.dp))
                    Text(
                        "Restores the seeded goals, listings, decisions and inventory, " +
                            "and re-evaluates everything.",
                        style = MarginTheme.type.caption, color = c.inkMuted,
                    )
                }
                Hairline()
                GroupRow(trailing = { Text(state.counts, style = MarginTheme.type.numeralS, color = c.ink) }) {
                    Text("On device", style = MarginTheme.type.bodyStrong, color = c.inkStrong)
                }
            }
        }

        item {
            Spacer(Modifier.height(Space.xl))
            Text(
                "Margin ${state.versionName} · everything is stored on this device and " +
                    "nothing leaves it.",
                style = MarginTheme.type.caption,
                color = c.inkFaint,
                modifier = Modifier.padding(horizontal = Space.screenH),
            )
        }
    }
}
