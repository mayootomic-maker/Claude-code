package app.margin.ui.today

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.margin.di.AppContainer
import app.margin.domain.engine.AttentionEngine
import app.margin.domain.engine.AttentionItem
import app.margin.domain.engine.DecisionMemory
import app.margin.domain.engine.WatchedItem
import app.margin.domain.model.DecisionType
import app.margin.domain.model.OwnedStatus
import app.margin.domain.repository.DecisionRecord
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.util.Calendar

data class TodayUiState(
    val loading: Boolean = true,
    val dateLine: String = "",
    val portfolioValueMinor: Long = 0,
    val unrealisedMinor: Long = 0,
    val ownedCount: Int = 0,
    val attention: List<AttentionItem> = emptyList(),
    val memoryLine: String? = null,
    val goalCount: Int = 0,
    val opportunityCount: Int = 0,
)

class TodayViewModel(private val container: AppContainer) : ViewModel() {

    private val decisionRecords = MutableStateFlow<List<DecisionRecord>>(emptyList())
    private val memory = MutableStateFlow(DecisionMemory.EMPTY)

    init {
        viewModelScope.launch { refreshDerived() }
    }

    private suspend fun refreshDerived() {
        decisionRecords.value = container.decisions.allRecords()
        memory.value = container.coordinator.memory()
    }

    val state: StateFlow<TodayUiState> = combine(
        container.listings.observeAll(),
        container.evaluations.observeAll(),
        container.owned.observeAll(),
        container.saleDrafts.observeAll(),
        combine(container.goals.observeAll(), decisionRecords, memory) { g, d, m -> Triple(g, d, m) },
    ) { listings, evaluations, owned, drafts, (goals, records, mem) ->

        val listingsById = listings.associateBy { it.id }
        val evaluationByListing = evaluations
            .groupBy { it.listingId }
            .mapValues { (_, list) -> list.maxBy { it.createdAtMillis } }

        // Watched items carry the score recorded when the user pressed Watch, so drift is
        // measured rather than assumed.
        val watched = records
            .filter { it.decision.type == DecisionType.WATCH }
            .mapNotNull { record ->
                val listing = listingsById[record.decision.listingId] ?: return@mapNotNull null
                val evaluation = evaluationByListing[listing.id] ?: return@mapNotNull null
                WatchedItem(
                    listing = listing,
                    evaluation = evaluation,
                    watchedAtMillis = record.decision.createdAtMillis,
                    scoreAtWatch = record.scoreAtDecision,
                    verdictAtWatch = record.verdictAtDecision,
                )
            }

        val held = owned.filter { it.status == OwnedStatus.OWNED || it.status == OwnedStatus.LISTED }
        val decided = records.map { it.decision.listingId }.toSet()

        TodayUiState(
            loading = false,
            dateLine = dateLine(container.now()),
            portfolioValueMinor = held.sumOf { it.currentValueMinor },
            unrealisedMinor = held.sumOf { it.unrealisedMinor },
            ownedCount = held.size,
            attention = AttentionEngine.compute(
                watched = watched,
                owned = owned,
                drafts = drafts,
                nowMillis = container.now(),
            ).take(6),
            memoryLine = mem.summaryLine(),
            goalCount = goals.count { it.active },
            opportunityCount = listings.count { listing ->
                evaluationByListing.containsKey(listing.id) && listing.id !in decided
            },
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), TodayUiState())

    fun refresh() {
        viewModelScope.launch { refreshDerived() }
    }

    private fun dateLine(now: Long): String {
        val cal = Calendar.getInstance().apply { timeInMillis = now }
        val days = arrayOf("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")
        val months = arrayOf(
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December",
        )
        return "${days[cal.get(Calendar.DAY_OF_WEEK) - 1]} ${cal.get(Calendar.DAY_OF_MONTH)} " +
            months[cal.get(Calendar.MONTH)]
    }
}
