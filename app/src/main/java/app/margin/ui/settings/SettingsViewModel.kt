package app.margin.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.margin.core.design.ThemeMode
import app.margin.di.AppContainer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class SettingsUiState(
    val themeMode: ThemeMode = ThemeMode.SYSTEM,
    val motionEnabled: Boolean = true,
    val engineId: String = "",
    val counts: String = "",
    val reseeding: Boolean = false,
    val versionName: String = "1.0.0",
)

class SettingsViewModel(private val container: AppContainer) : ViewModel() {

    private val reseeding = MutableStateFlow(false)

    val state: StateFlow<SettingsUiState> = combine(
        container.preferences.preferences,
        container.listings.observeAll(),
        container.owned.observeAll(),
        container.goals.observeAll(),
        reseeding,
    ) { prefs, listings, owned, goals, busy ->
        SettingsUiState(
            themeMode = prefs.themeMode,
            motionEnabled = prefs.motionEnabled,
            engineId = container.valuation.engineId,
            counts = "${goals.size}g · ${listings.size}l · ${owned.size}o",
            reseeding = busy,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SettingsUiState())

    fun setTheme(mode: ThemeMode) = viewModelScope.launch {
        container.preferences.setThemeMode(mode)
    }

    fun setMotion(enabled: Boolean) = viewModelScope.launch {
        container.preferences.setMotionEnabled(enabled)
    }

    fun reseed() = viewModelScope.launch {
        reseeding.value = true
        container.seeder.reseed()
        reseeding.value = false
    }
}
