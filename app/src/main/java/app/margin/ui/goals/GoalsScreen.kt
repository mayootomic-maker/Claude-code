package app.margin.ui.goals

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.margin.core.design.EmptyState
import app.margin.core.design.Grouped
import app.margin.core.design.GroupRow
import app.margin.core.design.Hairline
import app.margin.core.design.IconAction
import app.margin.core.design.MarginTheme
import app.margin.core.design.PrimaryAction
import app.margin.core.design.ScreenHeader
import app.margin.core.design.SectionLabel
import app.margin.core.design.Space
import app.margin.core.design.StatusLabel
import app.margin.core.design.rememberRevealState
import app.margin.core.design.revealAt
import app.margin.core.format.Money
import app.margin.domain.model.GoalKind

@Composable
fun GoalsScreen(
    viewModel: GoalsViewModel,
    onEditGoal: (String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val c = MarginTheme.colors
    val revealed = rememberRevealState(state.loading)

    LazyColumn(modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = Space.section)) {
        item {
            ScreenHeader(
                "Goals",
                "What Margin ranks everything against",
                action = { IconAction(Icons.Outlined.Add, "New goal", { onEditGoal(null) }) },
            )
        }

        if (state.active.isEmpty() && state.archived.isEmpty()) {
            item {
                EmptyState(
                    title = "No goals yet",
                    body = "A goal is a budget and a shape: what you want, how much you will " +
                        "pay, and what counts as worth it.",
                    action = { PrimaryAction("Create your first goal", { onEditGoal(null) }) },
                )
            }
            return@LazyColumn
        }

        if (state.active.isNotEmpty()) {
            item { SectionLabel("Active") }
            itemsIndexed(state.active, key = { _, g -> g.id }) { index, goal ->
                Box(Modifier.revealAt(index, revealed)) {
                    Grouped {
                        GroupRow(
                            onClick = { onEditGoal(goal.id) },
                            trailing = {
                                Column(horizontalAlignment = Alignment.End) {
                                    Text(
                                        "${state.matchCounts[goal.id] ?: 0}",
                                        style = MarginTheme.type.numeralM,
                                        color = c.inkStrong,
                                    )
                                    Text("matches", style = MarginTheme.type.caption, color = c.inkFaint)
                                }
                            },
                        ) {
                            Text(goal.title, style = MarginTheme.type.bodyStrong, color = c.inkStrong)
                            Spacer(Modifier.height(4.dp))
                            Text(
                                when (goal.kind) {
                                    GoalKind.BUY -> "Buy · up to ${Money.format(goal.budgetMaxMinor, goal.currency)} · " +
                                        "${goal.conditionFloor.label} or better"
                                    GoalKind.FLIP -> "Flip · up to ${Money.format(goal.budgetMaxMinor, goal.currency)} · " +
                                        "${Money.format(goal.targetProfitMinMinor, goal.currency)}+ net"
                                },
                                style = MarginTheme.type.caption,
                                color = c.inkMuted,
                            )
                            if (goal.note.isNotBlank()) {
                                Spacer(Modifier.height(3.dp))
                                Text(goal.note, style = MarginTheme.type.caption, color = c.inkFaint)
                            }
                        }
                    }
                }
                Spacer(Modifier.height(Space.sm))
            }
        }

        if (state.archived.isNotEmpty()) {
            item {
                Spacer(Modifier.height(Space.md))
                SectionLabel("Paused")
            }
            itemsIndexed(state.archived, key = { _, g -> g.id }) { _, goal ->
                Grouped {
                    GroupRow(
                        onClick = { onEditGoal(goal.id) },
                        trailing = { StatusLabel("Paused") },
                    ) {
                        Text(goal.title, style = MarginTheme.type.bodyStrong, color = c.inkMuted)
                        if (goal.note.isNotBlank()) {
                            Spacer(Modifier.height(3.dp))
                            Text(goal.note, style = MarginTheme.type.caption, color = c.inkFaint)
                        }
                    }
                }
                Spacer(Modifier.height(Space.sm))
            }
        }
    }
}
