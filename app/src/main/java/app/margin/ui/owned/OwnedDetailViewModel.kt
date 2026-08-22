package app.margin.ui.owned

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.margin.di.AppContainer
import app.margin.domain.engine.AttentionEngine
import app.margin.domain.model.OwnedItem
import app.margin.domain.model.OwnedStatus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class OwnedDetailUiState(
    val item: OwnedItem? = null,
    val currentValueMinor: Long = 0,
    val valueSeries: List<Long> = emptyList(),
    val signalText: String? = null,
    val markingSold: Boolean = false,
    val soldPriceInput: Long = 0,
)

class OwnedDetailViewModel(
    private val container: AppContainer,
    private val itemId: String,
) : ViewModel() {

    private val _state = MutableStateFlow(OwnedDetailUiState())
    val state: StateFlow<OwnedDetailUiState> = _state.asStateFlow()

    init { load() }

    private fun load() {
        viewModelScope.launch {
            val item = container.owned.byId(itemId) ?: return@launch
            val now = container.now()
            val current = if (item.status == OwnedStatus.SOLD) {
                item.soldPriceMinor ?: item.currentValueMinor
            } else {
                AttentionEngine.currentValueOf(item, container.marketData, now)
            }
            _state.value = OwnedDetailUiState(
                item = item,
                currentValueMinor = current,
                valueSeries = valueSeries(item, now),
                signalText = AttentionEngine.sellSignal(item.copy(currentValueMinor = current), now)?.detail,
                soldPriceInput = current,
            )
        }
    }

    /** Samples the depreciation model between purchase and now, for the sparkline. */
    private fun valueSeries(item: OwnedItem, now: Long): List<Long> {
        val end = item.soldAtMillis ?: now
        val span = (end - item.purchasedAtMillis).coerceAtLeast(1L)
        return (0..11).map { step ->
            val at = item.purchasedAtMillis + span * step / 11
            AttentionEngine.currentValueOf(item, container.marketData, at)
        }
    }

    fun beginMarkSold() = _state.update { it.copy(markingSold = true) }
    fun cancelMarkSold() = _state.update { it.copy(markingSold = false) }
    fun setSoldPrice(minor: Long) = _state.update { it.copy(soldPriceInput = minor) }

    fun confirmSold(onDone: () -> Unit) {
        val item = _state.value.item ?: return
        val price = _state.value.soldPriceInput
        if (price <= 0) return
        viewModelScope.launch {
            container.owned.upsert(
                item.copy(
                    status = OwnedStatus.SOLD,
                    soldPriceMinor = price,
                    soldAtMillis = container.now(),
                    currentValueMinor = price,
                )
            )
            onDone()
        }
    }
}
