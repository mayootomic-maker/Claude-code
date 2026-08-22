package app.margin.ui.sell

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.margin.di.AppContainer
import app.margin.domain.engine.AttentionEngine
import app.margin.domain.engine.CopyRequest
import app.margin.domain.engine.HeuristicValuationEngine
import app.margin.domain.model.OwnedItem
import app.margin.domain.model.OwnedStatus
import app.margin.domain.model.PhotoTask
import app.margin.domain.model.SaleChannel
import app.margin.domain.model.SaleDraft
import app.margin.domain.model.SaleDraftStatus
import app.margin.data.seed.SeedData
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ChannelOption(
    val channel: SaleChannel,
    val netMinor: Long,
    val recommended: Boolean,
)

data class SellUiState(
    val loading: Boolean = true,
    val step: Int = 0,
    val item: OwnedItem? = null,
    val draft: SaleDraft? = null,
    val channels: List<ChannelOption> = emptyList(),
    val currentValueMinor: Long = 0,
    val askPriceMinor: Long = 0,
    val floorPriceMinor: Long = 0,
    val quickSaleMinor: Long = 0,
    val title: String = "",
    val body: String = "",
    val photoTasks: List<PhotoTask> = emptyList(),
    val channel: SaleChannel = SaleChannel.LOCAL_MARKETPLACE,
    val posted: Boolean = false,
)

class SellViewModel(
    private val container: AppContainer,
    private val ownedItemId: String,
) : ViewModel() {

    private val _state = MutableStateFlow(SellUiState())
    val state: StateFlow<SellUiState> = _state.asStateFlow()

    private val engine = container.valuation as? HeuristicValuationEngine

    init { load() }

    private fun load() {
        viewModelScope.launch {
            val item = container.owned.byId(ownedItemId) ?: return@launch
            val existing = container.saleDrafts.forOwnedItem(ownedItemId)
            val now = container.now()
            val currentValue = AttentionEngine.currentValueOf(item, container.marketData, now)
            val liquidity = container.marketData.categoryDefaults(item.category).liquidity

            val options = engine?.channelOptions(currentValue, liquidity).orEmpty()
            val best = options.firstOrNull()?.first ?: SaleChannel.LOCAL_MARKETPLACE
            val channel = existing?.channel ?: best

            val ask = existing?.askPriceMinor ?: (currentValue * 1.06).toLong()
            val floor = existing?.floorPriceMinor ?: (currentValue * 0.86).toLong()
            val quick = existing?.quickSalePriceMinor ?: (currentValue * 0.93).toLong()

            val copy = container.copywriter.draft(
                CopyRequest(
                    item = item,
                    channel = channel,
                    askPriceMinor = ask,
                    condition = item.condition,
                    highlights = highlightsFor(item),
                    flaws = flawsFor(item),
                    location = "Bern",
                )
            )

            _state.value = SellUiState(
                loading = false,
                item = item,
                draft = existing,
                channels = options.map {
                    ChannelOption(it.first, it.second, it.first == best)
                },
                currentValueMinor = currentValue,
                askPriceMinor = ask,
                floorPriceMinor = floor,
                quickSaleMinor = quick,
                title = existing?.title ?: copy.title,
                body = existing?.body ?: copy.body,
                photoTasks = existing?.photoTasks ?: SeedData.photoTasks(),
                channel = channel,
                posted = existing?.status == SaleDraftStatus.LISTED,
            )
        }
    }

    fun next() = _state.update { it.copy(step = (it.step + 1).coerceAtMost(2)) }
    fun back() = _state.update { it.copy(step = (it.step - 1).coerceAtLeast(0)) }

    fun setChannel(channel: SaleChannel) {
        _state.update { it.copy(channel = channel) }
        regenerateCopy()
    }

    fun setAskPrice(minor: Long) = _state.update { it.copy(askPriceMinor = minor) }
    fun setTitle(value: String) = _state.update { it.copy(title = value) }
    fun setBody(value: String) = _state.update { it.copy(body = value) }

    fun togglePhoto(id: String) = _state.update { s ->
        s.copy(photoTasks = s.photoTasks.map { if (it.id == id) it.copy(done = !it.done) else it })
    }

    fun regenerateCopy() {
        val s = _state.value
        val item = s.item ?: return
        val copy = container.copywriter.draft(
            CopyRequest(
                item = item,
                channel = s.channel,
                askPriceMinor = s.askPriceMinor,
                condition = item.condition,
                highlights = highlightsFor(item),
                flaws = flawsFor(item),
                location = "Bern",
            )
        )
        _state.update { it.copy(title = copy.title, body = copy.body) }
    }

    private fun persist(status: SaleDraftStatus) {
        val s = _state.value
        val item = s.item ?: return
        viewModelScope.launch {
            container.saleDrafts.upsert(
                SaleDraft(
                    id = s.draft?.id ?: "sd-${item.id}",
                    ownedItemId = item.id,
                    channel = s.channel,
                    askPriceMinor = s.askPriceMinor,
                    floorPriceMinor = s.floorPriceMinor,
                    quickSalePriceMinor = s.quickSaleMinor,
                    title = s.title,
                    body = s.body,
                    photoTasks = s.photoTasks,
                    status = status,
                    createdAtMillis = s.draft?.createdAtMillis ?: container.now(),
                )
            )
        }
    }

    fun saveDraft() = persist(SaleDraftStatus.DRAFT)

    /**
     * Marks the item as listed. Margin has nothing to publish to, so this records a real state
     * change the user made rather than pretending to post an advert somewhere.
     */
    fun markAsListed(onDone: () -> Unit) {
        val item = _state.value.item ?: return
        persist(SaleDraftStatus.LISTED)
        viewModelScope.launch {
            container.owned.upsert(item.copy(status = OwnedStatus.LISTED))
            _state.update { it.copy(posted = true) }
            onDone()
        }
    }

    fun markAsSold(priceMinor: Long, onDone: () -> Unit) {
        val item = _state.value.item ?: return
        persist(SaleDraftStatus.SOLD)
        viewModelScope.launch {
            container.owned.upsert(
                item.copy(
                    status = OwnedStatus.SOLD,
                    soldPriceMinor = priceMinor,
                    soldAtMillis = container.now(),
                )
            )
            onDone()
        }
    }

    private fun highlightsFor(item: OwnedItem): List<String> = buildList {
        item.year?.let { add("Bought new in $it, one owner since") }
        if (item.note.isNotBlank()) add(item.note)
        add("Working exactly as it should")
    }.take(3)

    private fun flawsFor(item: OwnedItem): List<String> = when (item.condition.rank) {
        5, 4 -> emptyList()
        3 -> listOf("Light marks consistent with its age, all photographed")
        else -> listOf(
            "Visible wear, photographed honestly",
            "Priced to reflect the condition rather than hide it",
        )
    }
}
