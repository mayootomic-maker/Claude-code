package app.margin.data.prefs

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import app.margin.core.design.ThemeMode
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "margin_prefs")

data class AppPreferences(
    val themeMode: ThemeMode = ThemeMode.SYSTEM,
    val motionEnabled: Boolean = true,
)

class PreferencesStore(private val context: Context) {

    private val themeKey = stringPreferencesKey("theme_mode")
    private val motionKey = booleanPreferencesKey("motion_enabled")

    val preferences: Flow<AppPreferences> = context.dataStore.data.map { prefs ->
        AppPreferences(
            themeMode = runCatching { ThemeMode.valueOf(prefs[themeKey] ?: "SYSTEM") }
                .getOrDefault(ThemeMode.SYSTEM),
            motionEnabled = prefs[motionKey] ?: true,
        )
    }

    suspend fun setThemeMode(mode: ThemeMode) {
        context.dataStore.edit { it[themeKey] = mode.name }
    }

    suspend fun setMotionEnabled(enabled: Boolean) {
        context.dataStore.edit { it[motionKey] = enabled }
    }
}
