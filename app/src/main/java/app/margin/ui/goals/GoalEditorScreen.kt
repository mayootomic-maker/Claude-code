package app.margin.ui.goals

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.margin.core.design.IconAction
import app.margin.core.design.MarginField
import app.margin.core.design.MarginTheme
import app.margin.core.design.MoneyField
import app.margin.core.design.PrimaryAction
import app.margin.core.design.SecondaryAction
import app.margin.core.design.SectionLabel
import app.margin.core.design.SegmentedControl
import app.margin.core.design.Space
import app.margin.domain.model.Category
import app.margin.domain.model.Condition
import app.margin.domain.model.GoalKind

@Composable
fun GoalEditorScreen(
    viewModel: GoalEditorViewModel,
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val c = MarginTheme.colors

    Column(modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            IconAction(Icons.AutoMirrored.Outlined.ArrowBack, "Back", onDone)
            Text(
                if (state.isNew) "New goal" else "Edit goal",
                style = MarginTheme.type.heading,
                color = c.inkStrong,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(Space.lg))
        }

        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(bottom = Space.section)) {
            item {
                Column(Modifier.padding(horizontal = Space.screenH)) {
                    Spacer(Modifier.height(Space.sm))
                    MarginField(
                        value = state.title,
                        onValueChange = viewModel::setTitle,
                        label = "What are you looking for",
                        placeholder = "E-gravel bike under CHF 1,500",
                    )
                    Spacer(Modifier.height(Space.lg))

                    Text("Kind", style = MarginTheme.type.caption, color = c.inkMuted)
                    Spacer(Modifier.height(6.dp))
                    SegmentedControl(
                        options = listOf("Buy to keep", "Buy to flip"),
                        selectedIndex = if (state.kind == GoalKind.BUY) 0 else 1,
                        onSelect = { viewModel.setKind(if (it == 0) GoalKind.BUY else GoalKind.FLIP) },
                    )
                    Spacer(Modifier.height(Space.lg))

                    Text("Category", style = MarginTheme.type.caption, color = c.inkMuted)
                    Spacer(Modifier.height(6.dp))
                }
            }

            item {
                // Category is a closed set: free text here is what silently orphans listings
                // from the goal they belong to.
                Column(Modifier.padding(horizontal = Space.screenH)) {
                    Category.entries.chunked(3).forEach { rowItems ->
                        Row(
                            Modifier.fillMaxWidth().padding(bottom = Space.sm),
                            horizontalArrangement = Arrangement.spacedBy(Space.sm),
                        ) {
                            rowItems.forEach { category ->
                                Box(Modifier.weight(1f)) {
                                    SegmentedControl(
                                        options = listOf(category.label),
                                        selectedIndex = if (state.category == category) 0 else -1,
                                        onSelect = { viewModel.setCategory(category) },
                                    )
                                }
                            }
                            repeat(3 - rowItems.size) { Box(Modifier.weight(1f)) {} }
                        }
                    }
                }
            }

            item {
                Column(Modifier.padding(horizontal = Space.screenH)) {
                    Spacer(Modifier.height(Space.md))
                    MoneyField(
                        minorValue = state.budgetMaxMinor,
                        onMinorChange = viewModel::setBudget,
                        label = "Most you will pay",
                        supporting = "Anything above this is flagged, not hidden.",
                    )
                    if (state.kind == GoalKind.FLIP) {
                        Spacer(Modifier.height(Space.lg))
                        MoneyField(
                            minorValue = state.targetProfitMinMinor,
                            onMinorChange = viewModel::setTargetProfit,
                            label = "Minimum net profit",
                            supporting = "After refurbishment, fees, collection and tied-up capital.",
                        )
                    }
                    Spacer(Modifier.height(Space.lg))
                    MarginField(
                        value = state.keywords,
                        onValueChange = viewModel::setKeywords,
                        label = "Keywords",
                        placeholder = "gravel, bosch, 500Wh",
                        supporting = "Comma separated. Used to match listings to this goal.",
                    )
                    Spacer(Modifier.height(Space.lg))

                    Text("Lowest condition you will accept", style = MarginTheme.type.caption, color = c.inkMuted)
                    Spacer(Modifier.height(6.dp))
                    SegmentedControl(
                        options = listOf("Good", "Fair", "Poor", "Any"),
                        selectedIndex = when (state.conditionFloor) {
                            Condition.GOOD -> 0
                            Condition.FAIR -> 1
                            Condition.POOR -> 2
                            else -> 3
                        },
                        onSelect = {
                            viewModel.setConditionFloor(
                                when (it) {
                                    0 -> Condition.GOOD
                                    1 -> Condition.FAIR
                                    2 -> Condition.POOR
                                    else -> Condition.FOR_PARTS
                                }
                            )
                        },
                    )
                    Spacer(Modifier.height(Space.lg))
                    MarginField(
                        value = state.note,
                        onValueChange = viewModel::setNote,
                        label = "Note to yourself",
                        placeholder = "Ride-ready. Willing to service it, not rebuild it.",
                        singleLine = false,
                        minHeight = 72.dp,
                    )
                }
            }

            if (!state.isNew) {
                item {
                    Spacer(Modifier.height(Space.xl))
                    SectionLabel("Goal state")
                    Column(Modifier.padding(horizontal = Space.screenH)) {
                        SecondaryAction(
                            if (state.active) "Pause this goal" else "Reactivate this goal",
                            { viewModel.toggleActive() },
                        )
                        Spacer(Modifier.height(Space.sm))
                        SecondaryAction(
                            "Delete goal",
                            { viewModel.delete(onDone) },
                            tone = c.negative,
                        )
                    }
                }
            }
        }

        Column(Modifier.padding(Space.screenH)) {
            PrimaryAction(
                if (state.isNew) "Create goal" else "Save changes",
                { viewModel.save(onDone) },
                enabled = state.canSave,
            )
        }
    }
}
