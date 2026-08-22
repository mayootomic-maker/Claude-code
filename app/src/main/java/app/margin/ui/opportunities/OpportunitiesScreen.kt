package app.margin.ui.opportunities

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddLink
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.margin.core.design.EmptyState
import app.margin.core.design.Hairline
import app.margin.core.design.IconAction
import app.margin.core.design.MarginTheme
import app.margin.core.design.PrimaryAction
import app.margin.core.design.ScreenHeader
import app.margin.core.design.SegmentedControl
import app.margin.core.design.SkeletonBlock
import app.margin.core.design.Space
import app.margin.core.design.rememberRevealState
import app.margin.core.design.revealAt
import app.margin.ui.common.ListingRow

@Composable
fun OpportunitiesScreen(
    viewModel: OpportunitiesViewModel,
    onOpenListing: (String) -> Unit,
    onCapture: () -> Unit,
    onCreateGoal: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val c = MarginTheme.colors
    val revealed = rememberRevealState(state.selectedFilter)

    LazyColumn(
        modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = Space.section),
    ) {
        item {
            ScreenHeader(
                title = "Opportunities",
                subtitle = state.subtitle,
                action = { IconAction(Icons.Outlined.AddLink, "Add a listing from a link", onCapture) },
            )
        }

        if (state.loading) {
            item {
                Column(Modifier.padding(horizontal = Space.screenH)) {
                    repeat(5) { i ->
                        SkeletonBlock(height = 44.dp, index = i)
                        Spacer(Modifier.height(Space.md))
                    }
                }
            }
            return@LazyColumn
        }

        item {
            Text(
                state.rankingNote,
                style = MarginTheme.type.caption,
                color = c.inkFaint,
                modifier = Modifier.padding(horizontal = Space.screenH, vertical = Space.xs),
            )
            Spacer(Modifier.height(Space.sm))
        }

        if (state.filters.size > 1) {
            item {
                Box(Modifier.padding(horizontal = Space.screenH, vertical = Space.xs)) {
                    SegmentedControl(
                        options = state.filters,
                        selectedIndex = state.selectedFilter,
                        onSelect = viewModel::selectFilter,
                    )
                }
                Spacer(Modifier.height(Space.md))
            }
        }

        if (state.rows.isEmpty()) {
            item {
                if (state.goalCount == 0) {
                    // With no goals there is nothing to rank against, so the empty state is a
                    // goal picker rather than a shrug.
                    EmptyState(
                        title = "Set a goal first",
                        body = "Margin ranks listings against what you are actually looking for. " +
                            "Without a goal it can only show you a list.",
                        action = { PrimaryAction("Create a goal", onCreateGoal) },
                    )
                } else {
                    EmptyState(
                        title = "Nothing left here",
                        body = "You have decided on everything matching this goal. " +
                            "Paste a link to evaluate something new.",
                        action = { PrimaryAction("Paste a listing link", onCapture) },
                    )
                }
            }
        } else {
            item { Hairline(inset = 0.dp) }
            itemsIndexed(state.rows, key = { _, row -> row.listing.id }) { index, row ->
                ListingRow(
                    listing = row.listing,
                    evaluation = row.evaluation,
                    watched = row.watched,
                    onClick = { onOpenListing(row.listing.id) },
                    modifier = Modifier.revealAt(index, revealed),
                )
                Hairline(inset = 0.dp)
            }
        }
    }
}
