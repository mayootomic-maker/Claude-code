package app.margin.ui.owned

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.margin.core.format.Money
import app.margin.di.AppContainer
import app.margin.domain.engine.AttentionEngine
import app.margin.domain.model.OwnedItem
import app.margin.domain.model.OwnedStatus
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlin.math.abs

data class OwnedUiState(
    val loading: Boolean = true,
    val subtitle: String = "",
    val held: List<OwnedItem> = emptyList(),
    val sold: List<OwnedItem> = emptyList(),
    val portfolioValueMinor: Long = 0,
    val unrealisedMinor: Long = 0,
    val scorecard: String? = null,
)

class OwnedViewModel(private val container: AppContainer) : ViewModel() {

    val state: StateFlow<OwnedUiState> = container.owned.observeAll().map { items ->
        val now = container.now()

        // Current value is recomputed from the same depreciation model that valued the item
        // at purchase, so it cannot silently go stale as a stored constant would.
        val revalued = items.map { item ->
            if (item.status == OwnedStatus.SOLD) item
            else item.copy(currentValueMinor = AttentionEngine.currentValueOf(item, container.marketData, now))
        }

        val held = revalued.filter { it.status != OwnedStatus.SOLD }
        val sold = revalued.filter { it.status == OwnedStatus.SOLD }

        OwnedUiState(
            loading = false,
            subtitle = "${held.size} held · ${sold.size} sold",
            held = held,
            sold = sold,
            portfolioValueMinor = held.sumOf { it.currentValueMinor },
            unrealisedMinor = held.sumOf { it.unrealisedMinor },
            scorecard = scorecard(sold),
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), OwnedUiState())

    private fun scorecard(sold: List<OwnedItem>): String? {
        val scored = sold.mapNotNull { item ->
            val predicted = item.predictedNetMinor ?: return@mapNotNull null
            val realised = item.realisedMinor ?: return@mapNotNull null
            predicted to realised
        }
        if (scored.isEmpty()) return null
        val predictedTotal = scored.sumOf { it.first }
        val realisedTotal = scored.sumOf { it.second }
        val delta = realisedTotal - predictedTotal
        val verb = if (delta >= 0) "better" else "worse"
        return "Across ${scored.size} sale${if (scored.size == 1) "" else "s"}, Margin forecast " +
            "${Money.whole(predictedTotal)} and you realised ${Money.whole(realisedTotal)} — " +
            "${Money.whole(abs(delta))} $verb than forecast."
    }
}
