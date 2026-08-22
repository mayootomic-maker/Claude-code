package app.margin.ui.owned

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
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.margin.core.design.BleedRow
import app.margin.core.design.CategoryPlate
import app.margin.core.design.EmptyState
import app.margin.core.design.Hairline
import app.margin.core.design.MarginTheme
import app.margin.core.design.ScreenHeader
import app.margin.core.design.SectionLabel
import app.margin.core.design.SkeletonBlock
import app.margin.core.design.Space
import app.margin.core.design.StatusLabel
import app.margin.core.design.rememberRevealState
import app.margin.core.design.revealAt
import app.margin.core.format.Money
import app.margin.domain.model.OwnedItem
import app.margin.domain.model.OwnedStatus

@Composable
fun OwnedScreen(
    viewModel: OwnedViewModel,
    onOpenItem: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val c = MarginTheme.colors
    val revealed = rememberRevealState(state.loading)

    LazyColumn(modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = Space.section)) {
        item { ScreenHeader("Owned", state.subtitle) }

        if (state.loading) {
            item {
                Column(Modifier.padding(horizontal = Space.screenH)) {
                    repeat(4) { i ->
                        SkeletonBlock(height = 40.dp, index = i)
                        Spacer(Modifier.height(Space.md))
                    }
                }
            }
            return@LazyColumn
        }

        if (state.held.isEmpty() && state.sold.isEmpty()) {
            item {
                EmptyState(
                    title = "Nothing in your inventory",
                    body = "Mark a listing as bought and it will appear here, with an " +
                        "estimated current value that updates as it depreciates.",
                )
            }
            return@LazyColumn
        }

        item {
            Column(Modifier.padding(horizontal = Space.screenH).revealAt(0, revealed)) {
                Text(
                    Money.whole(state.portfolioValueMinor),
                    style = MarginTheme.type.numeralXl,
                    color = c.inkStrong,
                )
                Spacer(Modifier.height(4.dp))
                Row {
                    Text(
                        Money.whole(state.unrealisedMinor, alwaysSigned = true),
                        style = MarginTheme.type.numeralS,
                        color = c.forDelta(state.unrealisedMinor),
                    )
                    Text(
                        "  unrealised across ${state.held.size} item${if (state.held.size == 1) "" else "s"}",
                        style = MarginTheme.type.caption,
                        color = c.inkMuted,
                    )
                }
            }
            Spacer(Modifier.height(Space.xl))
        }

        if (state.held.isNotEmpty()) {
            item { ColumnHeader() }
            item { Hairline(inset = 0.dp) }
            itemsIndexed(state.held, key = { _, it -> it.id }) { index, item ->
                OwnedRow(item, { onOpenItem(item.id) }, Modifier.revealAt(index + 1, revealed))
                Hairline(inset = 0.dp)
            }
        }

        if (state.sold.isNotEmpty()) {
            item {
                Spacer(Modifier.height(Space.xl))
                SectionLabel("Sold")
            }
            item { Hairline(inset = 0.dp) }
            itemsIndexed(state.sold, key = { _, it -> it.id }) { _, item ->
                SoldRow(item) { onOpenItem(item.id) }
                Hairline(inset = 0.dp)
            }
            // The app scoring itself. This is the only thing here that improves with use.
            state.scorecard?.let { line ->
                item {
                    Spacer(Modifier.height(Space.lg))
                    Text(
                        line,
                        style = MarginTheme.type.caption,
                        color = c.inkMuted,
                        modifier = Modifier.padding(horizontal = Space.screenH),
                    )
                }
            }
        }
    }
}

@Composable
private fun ColumnHeader() {
    val c = MarginTheme.colors
    Row(
        Modifier.fillMaxWidth().padding(horizontal = Space.screenH, vertical = Space.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Spacer(Modifier.width(46.dp + Space.md))
        Text("Item", style = MarginTheme.type.label, color = c.inkFaint, modifier = Modifier.weight(1f))
        Text(
            "Value", style = MarginTheme.type.label, color = c.inkFaint,
            textAlign = TextAlign.End, modifier = Modifier.width(78.dp),
        )
        Text(
            "P/L", style = MarginTheme.type.label, color = c.inkFaint,
            textAlign = TextAlign.End, modifier = Modifier.width(66.dp),
        )
    }
}

@Composable
private fun OwnedRow(item: OwnedItem, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = MarginTheme.colors
    BleedRow(
        onClick = onClick,
        modifier = modifier,
        leading = { CategoryPlate(item.category, size = 46.dp) },
        trailing = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    Money.whole(item.currentValueMinor, showCurrency = false),
                    style = MarginTheme.type.numeralS, color = c.inkStrong,
                    textAlign = TextAlign.End, modifier = Modifier.width(78.dp),
                )
                Text(
                    Money.whole(item.unrealisedMinor, showCurrency = false, alwaysSigned = true),
                    style = MarginTheme.type.numeralS, color = c.forDelta(item.unrealisedMinor),
                    textAlign = TextAlign.End, modifier = Modifier.width(66.dp),
                )
            }
        },
    ) {
        Text(
            item.title, style = MarginTheme.type.bodyStrong, color = c.inkStrong,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(3.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "Paid ${Money.format(item.purchasePriceMinor, item.currency)}",
                style = MarginTheme.type.caption, color = c.inkFaint,
            )
            if (item.status == OwnedStatus.LISTED) {
                Spacer(Modifier.width(Space.sm))
                StatusLabel("Listed", fg = c.accent, bg = c.accentSoft)
            }
        }
    }
}

@Composable
private fun SoldRow(item: OwnedItem, onClick: () -> Unit) {
    val c = MarginTheme.colors
    val realised = item.realisedMinor ?: 0L
    BleedRow(
        onClick = onClick,
        leading = { CategoryPlate(item.category, size = 46.dp) },
        trailing = {
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    Money.whole(realised, alwaysSigned = true),
                    style = MarginTheme.type.numeralS, color = c.forDelta(realised),
                )
                item.predictionErrorMinor?.let { error ->
                    Spacer(Modifier.height(3.dp))
                    Text(
                        "vs ${Money.whole(error, showCurrency = false, alwaysSigned = true)} on forecast",
                        style = MarginTheme.type.caption, color = c.inkFaint,
                    )
                }
            }
        },
    ) {
        Text(
            item.title, style = MarginTheme.type.bodyStrong, color = c.inkStrong,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(3.dp))
        Text(
            "Bought ${Money.format(item.purchasePriceMinor, item.currency)} · " +
                "sold ${Money.format(item.soldPriceMinor ?: 0, item.currency)}",
            style = MarginTheme.type.caption, color = c.inkFaint,
        )
    }
}
