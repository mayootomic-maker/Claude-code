package app.margin.ui.today

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddLink
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.margin.core.design.BleedRow
import app.margin.core.design.EmptyState
import app.margin.core.design.Hairline
import app.margin.core.design.IconAction
import app.margin.core.design.MarginTheme
import app.margin.core.design.ScreenHeader
import app.margin.core.design.SectionLabel
import app.margin.core.design.SkeletonBlock
import app.margin.core.design.Space
import app.margin.core.design.rememberRevealState
import app.margin.core.design.revealAt
import app.margin.core.format.Money
import app.margin.domain.engine.AttentionItem
import app.margin.domain.engine.AttentionKind

@Composable
fun TodayScreen(
    viewModel: TodayViewModel,
    onOpenListing: (String) -> Unit,
    onOpenOwned: (String) -> Unit,
    onOpenSell: (String) -> Unit,
    onCapture: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val c = MarginTheme.colors
    val revealed = rememberRevealState(state.loading)

    LazyColumn(
        modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = Space.section),
    ) {
        item {
            ScreenHeader(
                title = "Today",
                subtitle = state.dateLine,
                action = {
                    IconAction(Icons.Outlined.AddLink, "Add a listing from a link", onCapture)
                },
            )
        }

        if (state.loading) {
            item {
                Column(Modifier.padding(horizontal = Space.screenH)) {
                    repeat(4) { i ->
                        SkeletonBlock(height = 18.dp, widthFraction = 0.7f - i * 0.08f, index = i)
                        Spacer(Modifier.height(Space.md))
                    }
                }
            }
            return@LazyColumn
        }

        // Portfolio: the one number that answers "where do I stand".
        item {
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = Space.screenH)
                    .revealAt(0, revealed)
            ) {
                Text("Portfolio", style = MarginTheme.type.caption, color = c.inkMuted)
                Spacer(Modifier.height(6.dp))
                Text(
                    Money.whole(state.portfolioValueMinor),
                    style = MarginTheme.type.numeralXl,
                    color = c.inkStrong,
                )
                Spacer(Modifier.height(4.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        Money.whole(state.unrealisedMinor, alwaysSigned = true),
                        style = MarginTheme.type.numeralS,
                        color = c.forDelta(state.unrealisedMinor),
                    )
                    Text(
                        "  unrealised · ${state.ownedCount} item${if (state.ownedCount == 1) "" else "s"}",
                        style = MarginTheme.type.caption,
                        color = c.inkMuted,
                    )
                }
            }
            Spacer(Modifier.height(Space.xl))
        }

        if (state.attention.isEmpty()) {
            item {
                EmptyState(
                    title = "Nothing needs you today",
                    body = "No watched item has moved and nothing you own is due to sell. " +
                        "Margin will surface things here when they change.",
                )
            }
        } else {
            item { SectionLabel("Needs you today") }
            item { Hairline(inset = 0.dp) }
            itemsIndexed(state.attention, key = { _, a -> a.id }) { index, attention ->
                AttentionRow(
                    item = attention,
                    modifier = Modifier.revealAt(index + 1, revealed),
                    onClick = {
                        when {
                            attention.saleDraftId != null && attention.ownedItemId != null ->
                                onOpenSell(attention.ownedItemId!!)
                            attention.ownedItemId != null -> onOpenOwned(attention.ownedItemId!!)
                            attention.listingId != null -> onOpenListing(attention.listingId!!)
                        }
                    },
                )
                Hairline(inset = 0.dp)
            }
        }

        item {
            Spacer(Modifier.height(Space.xl))
            Column(Modifier.padding(horizontal = Space.screenH)) {
                state.memoryLine?.let {
                    Text(it, style = MarginTheme.type.caption, color = c.inkMuted)
                    Spacer(Modifier.height(Space.xs))
                }
                Text(
                    "${state.goalCount} active goal${if (state.goalCount == 1) "" else "s"} · " +
                        "${state.opportunityCount} opportunities",
                    style = MarginTheme.type.caption,
                    color = c.inkFaint,
                )
            }
        }
    }
}

@Composable
private fun AttentionRow(
    item: AttentionItem,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = MarginTheme.colors
    val accent = when (item.kind) {
        AttentionKind.PRICE_DROP, AttentionKind.VERDICT_IMPROVED, AttentionKind.SELL_NOW -> c.positive
        AttentionKind.PRICE_RISE, AttentionKind.VERDICT_WORSENED -> c.negative
        else -> c.inkMuted
    }
    BleedRow(
        onClick = onClick,
        modifier = modifier,
        verticalPadding = Space.lg,
        trailing = {
            item.amountMinor?.let {
                Text(
                    Money.whole(it, alwaysSigned = true),
                    style = MarginTheme.type.numeralS,
                    color = c.forDelta(it),
                )
            }
        },
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                kindLabel(item.kind),
                style = MarginTheme.type.label,
                color = accent,
            )
        }
        Spacer(Modifier.height(5.dp))
        Text(
            item.headline,
            style = MarginTheme.type.bodyStrong,
            color = c.inkStrong,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(3.dp))
        Text(
            item.detail,
            style = MarginTheme.type.caption,
            color = c.inkMuted,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

private fun kindLabel(kind: AttentionKind): String = when (kind) {
    AttentionKind.PRICE_DROP -> "Price drop"
    AttentionKind.PRICE_RISE -> "Price rise"
    AttentionKind.VERDICT_IMPROVED -> "Improved"
    AttentionKind.VERDICT_WORSENED -> "Worsened"
    AttentionKind.SELL_NOW -> "Sell signal"
    AttentionKind.DRAFT_OPEN -> "Unfinished"
    AttentionKind.STALE_WATCH -> "Decide or drop"
}
