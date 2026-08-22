package app.margin.ui.evaluate

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.margin.di.AppContainer
import app.margin.domain.model.Decision
import app.margin.domain.model.DecisionType
import app.margin.domain.model.Evaluation
import app.margin.domain.model.Goal
import app.margin.domain.model.Listing
import app.margin.domain.model.OwnedItem
import app.margin.domain.model.OwnedStatus
import app.margin.domain.repository.DecisionRecord
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class EvaluateUiState(
    val loading: Boolean = true,
    val error: String? = null,
    val listing: Listing? = null,
    val evaluation: Evaluation? = null,
    val goal: Goal? = null,
    val currentDecision: DecisionType? = null,
    val showAllRisks: Boolean = false,
    val showScoreMath: Boolean = false,
    val committed: DecisionType? = null,
)

class EvaluateViewModel(
    private val container: AppContainer,
    private val listingId: String,
) : ViewModel() {

    private val _state = MutableStateFlow(EvaluateUiState())
    val state: StateFlow<EvaluateUiState> = _state.asStateFlow()

    init { load() }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            val listing = container.listings.byId(listingId)
            if (listing == null) {
                _state.update {
                    it.copy(loading = false, error = "That listing is no longer in your library.")
                }
                return@launch
            }
            val evaluation = container.evaluations.latestFor(listingId)
                ?: container.coordinator.evaluate(listing)
            val goal = evaluation.goalId?.let { container.goals.byId(it) }
            val decision = container.decisions.latestFor(listingId)
            _state.update {
                it.copy(
                    loading = false,
                    listing = listing,
                    evaluation = evaluation,
                    goal = goal,
                    currentDecision = decision?.type,
                )
            }
        }
    }

    fun toggleRisks() = _state.update { it.copy(showAllRisks = !it.showAllRisks) }
    fun toggleScoreMath() = _state.update { it.copy(showScoreMath = !it.showScoreMath) }

    /**
     * Records a decision and immediately re-evaluates everything, so the consequence of this
     * decision is visible on the very next screen the user opens.
     */
    fun decide(type: DecisionType, reason: String) {
        val listing = _state.value.listing ?: return
        val evaluation = _state.value.evaluation ?: return
        viewModelScope.launch {
            container.decisions.record(
                DecisionRecord(
                    decision = Decision(
                        id = "dec-${listing.id}-${container.now()}",
                        listingId = listing.id,
                        type = type,
                        reason = reason,
                        createdAtMillis = container.now(),
                    ),
                    scoreAtDecision = evaluation.dealScore,
                    verdictAtDecision = evaluation.verdict,
                )
            )

            if (type == DecisionType.BOUGHT) {
                container.owned.upsert(
                    OwnedItem(
                        id = "own-${listing.id}",
                        listingId = listing.id,
                        title = listing.title,
                        brand = listing.brand,
                        category = listing.category,
                        condition = listing.condition,
                        purchasePriceMinor = listing.askingPriceMinor,
                        purchasedAtMillis = container.now(),
                        currentValueMinor = evaluation.fairValueMinor,
                        status = OwnedStatus.OWNED,
                        currency = listing.currency,
                        year = listing.year,
                        note = "Bought from ${listing.sourceName}, ${listing.location}.",
                        predictedNetMinor = evaluation.netProfitMinor,
                        fairValueAtPurchaseMinor = evaluation.fairValueMinor,
                    )
                )
            }

            container.coordinator.refreshAll()
            val refreshed = container.evaluations.latestFor(listing.id)
            _state.update {
                it.copy(
                    currentDecision = type,
                    committed = type,
                    evaluation = refreshed ?: it.evaluation,
                )
            }
        }
    }

    fun clearCommitted() = _state.update { it.copy(committed = null) }

    fun undoDecision() {
        val listing = _state.value.listing ?: return
        viewModelScope.launch {
            container.decisions.clearFor(listing.id)
            container.coordinator.refreshAll()
            _state.update { it.copy(currentDecision = null, committed = null) }
        }
    }
}
