package app.margin.ui.opportunities

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.margin.di.AppContainer
import app.margin.domain.engine.Ranking
import app.margin.domain.model.Decision
import app.margin.domain.model.DecisionType
import app.margin.domain.model.Evaluation
import app.margin.domain.model.Goal
import app.margin.domain.model.Listing
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn

data class OpportunityRow(
    val listing: Listing,
    val evaluation: Evaluation,
    val goal: Goal?,
    val watched: Boolean,
)

data class OpportunitiesUiState(
    val loading: Boolean = true,
    val subtitle: String = "",
    val filters: List<String> = listOf("All"),
    val selectedFilter: Int = 0,
    val rows: List<OpportunityRow> = emptyList(),
    val goalCount: Int = 0,
    val rankingNote: String = "",
)

class OpportunitiesViewModel(private val container: AppContainer) : ViewModel() {

    private val filterIndex = MutableStateFlow(0)

    val state: StateFlow<OpportunitiesUiState> = combine(
        container.listings.observeFeed(),
        container.evaluations.observeAll(),
        container.goals.observeAll(),
        container.decisions.observeAll(),
        filterIndex,
    ) { listings, evaluations, goals, decisions, filter ->

        val activeGoals = goals.filter { it.active }
        val latestEvaluation = evaluations
            .groupBy { it.listingId }
            .mapValues { (_, list) -> list.maxBy { it.createdAtMillis } }

        val decisionByListing: Map<String, Decision> = decisions
            .groupBy { it.listingId }
            .mapValues { (_, list) -> list.maxBy { it.createdAtMillis } }

        // Rejected and bought items leave the feed; watched items stay, marked.
        val candidates = listings.filter { listing ->
            when (decisionByListing[listing.id]?.type) {
                DecisionType.REJECT, DecisionType.BOUGHT -> false
                else -> true
            }
        }

        val filters = listOf("All") + activeGoals.map { shortTitle(it) }
        val selected = filter.coerceIn(0, (filters.size - 1).coerceAtLeast(0))
        val goalFilter = if (selected == 0) null else activeGoals.getOrNull(selected - 1)

        val ranked = Ranking.rank(
            candidates.mapNotNull { listing ->
                val evaluation = latestEvaluation[listing.id] ?: return@mapNotNull null
                Triple(listing, evaluation, Ranking.bestGoal(listing, activeGoals))
            },
            container.now(),
        )

        val rows = ranked
            .filter { goalFilter == null || it.goal?.id == goalFilter.id }
            .map {
                OpportunityRow(
                    listing = it.listing,
                    evaluation = it.evaluation,
                    goal = it.goal,
                    watched = decisionByListing[it.listing.id]?.type == DecisionType.WATCH,
                )
            }

        OpportunitiesUiState(
            loading = false,
            subtitle = if (goalFilter != null) {
                "${rows.size} matching “${goalFilter.title}”"
            } else {
                "${rows.size} ranked by fit and value"
            },
            filters = filters,
            selectedFilter = selected,
            rows = rows,
            goalCount = activeGoals.size,
            rankingNote = "Ranked by deal score weighted by how well each listing fits an active " +
                "goal, then by how recently it was listed.",
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), OpportunitiesUiState())

    fun selectFilter(index: Int) { filterIndex.value = index }

    private fun shortTitle(goal: Goal): String =
        goal.title.substringBefore(" under").substringBefore(" I can").take(16)
}
