package app.margin.ui.goals

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.margin.di.AppContainer
import app.margin.domain.model.Category
import app.margin.domain.model.Condition
import app.margin.domain.model.Goal
import app.margin.domain.model.GoalKind
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class GoalEditorUiState(
    val isNew: Boolean = true,
    val title: String = "",
    val kind: GoalKind = GoalKind.BUY,
    val category: Category = Category.BIKE,
    val budgetMaxMinor: Long = 0,
    val targetProfitMinMinor: Long = 0,
    val keywords: String = "",
    val conditionFloor: Condition = Condition.FAIR,
    val note: String = "",
    val active: Boolean = true,
) {
    val canSave: Boolean get() = title.isNotBlank() && budgetMaxMinor > 0
}

class GoalEditorViewModel(
    private val container: AppContainer,
    private val goalId: String?,
) : ViewModel() {

    private val _state = MutableStateFlow(GoalEditorUiState(isNew = goalId == null))
    val state: StateFlow<GoalEditorUiState> = _state.asStateFlow()

    init {
        if (goalId != null) {
            viewModelScope.launch {
                container.goals.byId(goalId)?.let { goal ->
                    _state.value = GoalEditorUiState(
                        isNew = false,
                        title = goal.title,
                        kind = goal.kind,
                        category = goal.category,
                        budgetMaxMinor = goal.budgetMaxMinor,
                        targetProfitMinMinor = goal.targetProfitMinMinor,
                        keywords = goal.keywords.joinToString(", "),
                        conditionFloor = goal.conditionFloor,
                        note = goal.note,
                        active = goal.active,
                    )
                }
            }
        }
    }

    fun setTitle(v: String) = _state.update { it.copy(title = v) }
    fun setKind(v: GoalKind) = _state.update { it.copy(kind = v) }
    fun setCategory(v: Category) = _state.update { it.copy(category = v) }
    fun setBudget(v: Long) = _state.update { it.copy(budgetMaxMinor = v) }
    fun setTargetProfit(v: Long) = _state.update { it.copy(targetProfitMinMinor = v) }
    fun setKeywords(v: String) = _state.update { it.copy(keywords = v) }
    fun setConditionFloor(v: Condition) = _state.update { it.copy(conditionFloor = v) }
    fun setNote(v: String) = _state.update { it.copy(note = v) }
    fun toggleActive() = _state.update { it.copy(active = !it.active) }

    fun save(onDone: () -> Unit) {
        val s = _state.value
        if (!s.canSave) return
        viewModelScope.launch {
            container.goals.upsert(
                Goal(
                    id = goalId ?: "goal-${container.now()}",
                    title = s.title.trim(),
                    kind = s.kind,
                    category = s.category,
                    budgetMaxMinor = s.budgetMaxMinor,
                    targetProfitMinMinor = if (s.kind == GoalKind.FLIP) s.targetProfitMinMinor else 0,
                    keywords = s.keywords.split(",").map { it.trim() }.filter { it.isNotBlank() },
                    conditionFloor = s.conditionFloor,
                    active = s.active,
                    note = s.note.trim(),
                    createdAtMillis = container.now(),
                )
            )
            // Goals change what every listing is measured against, so everything is re-scored.
            container.coordinator.refreshAll()
            onDone()
        }
    }

    fun delete(onDone: () -> Unit) {
        val id = goalId ?: return
        viewModelScope.launch {
            container.goals.delete(id)
            container.coordinator.refreshAll()
            onDone()
        }
    }
}
