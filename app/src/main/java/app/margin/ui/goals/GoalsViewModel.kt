package app.margin.ui.goals

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.margin.di.AppContainer
import app.margin.domain.engine.Ranking
import app.margin.domain.model.Goal
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn

data class GoalsUiState(
    val loading: Boolean = true,
    val active: List<Goal> = emptyList(),
    val archived: List<Goal> = emptyList(),
    val matchCounts: Map<String, Int> = emptyMap(),
)

class GoalsViewModel(container: AppContainer) : ViewModel() {

    val state: StateFlow<GoalsUiState> = combine(
        container.goals.observeAll(),
        container.listings.observeFeed(),
    ) { goals, listings ->
        val active = goals.filter { it.active }
        GoalsUiState(
            loading = false,
            active = active,
            archived = goals.filterNot { it.active },
            matchCounts = active.associate { goal ->
                goal.id to listings.count { Ranking.bestGoal(it, active)?.id == goal.id }
            },
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), GoalsUiState())
}
