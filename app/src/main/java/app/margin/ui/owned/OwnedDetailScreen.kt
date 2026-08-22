package app.margin.ui.owned

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
import app.margin.core.design.CategoryPlate
import app.margin.core.design.Hairline
import app.margin.core.design.IconAction
import app.margin.core.design.KeyValueRow
import app.margin.core.design.MarginTheme
import app.margin.core.design.MoneyField
import app.margin.core.design.PrimaryAction
import app.margin.core.design.SecondaryAction
import app.margin.core.design.SectionLabel
import app.margin.core.design.Sparkline
import app.margin.core.design.Space
import app.margin.core.design.StatusLabel
import app.margin.core.format.Money
import app.margin.core.format.RelativeTime
import app.margin.domain.model.OwnedStatus

@Composable
fun OwnedDetailScreen(
    viewModel: OwnedDetailViewModel,
    onBack: () -> Unit,
    onSell: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val c = MarginTheme.colors
    val item = state.item

    Column(modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            IconAction(Icons.AutoMirrored.Outlined.ArrowBack, "Back", onBack)
            Text(
                "Owned item", style = MarginTheme.type.captionStrong,
                color = c.inkMuted, modifier = Modifier.weight(1f),
            )
            item?.let { StatusLabel(it.status.label) }
            Spacer(Modifier.width(Space.md))
        }

        if (item == null) {
            Spacer(Modifier.weight(1f))
            return@Column
        }

        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(bottom = Space.section)) {
            item {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = Space.screenH, vertical = Space.sm),
                    verticalAlignment = Alignment.Top,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(item.title, style = MarginTheme.type.title, color = c.inkStrong)
                        Spacer(Modifier.height(4.dp))
                        Text(
                            listOfNotNull(item.condition.label, item.year?.toString())
                                .joinToString(" · "),
                            style = MarginTheme.type.caption, color = c.inkMuted,
                        )
                    }
                    Spacer(Modifier.width(Space.md))
                    CategoryPlate(item.category, size = 54.dp)
                }
            }

            item {
                Column(Modifier.padding(horizontal = Space.screenH, vertical = Space.lg)) {
                    Text(
                        if (item.status == OwnedStatus.SOLD) "Sold for" else "Worth today",
                        style = MarginTheme.type.caption, color = c.inkMuted,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        Money.whole(
                            if (item.status == OwnedStatus.SOLD) item.soldPriceMinor ?: 0
                            else state.currentValueMinor,
                            item.currency,
                        ),
                        style = MarginTheme.type.numeralXl, color = c.inkStrong,
                    )
                    Spacer(Modifier.height(6.dp))
                    val delta = if (item.status == OwnedStatus.SOLD) {
                        item.realisedMinor ?: 0
                    } else {
                        state.currentValueMinor - item.purchasePriceMinor
                    }
                    Text(
                        "${Money.whole(delta, item.currency, alwaysSigned = true)} against what you paid",
                        style = MarginTheme.type.numeralS, color = c.forDelta(delta),
                    )
                    if (state.valueSeries.size > 2) {
                        Spacer(Modifier.height(Space.lg))
                        Sparkline(
                            points = state.valueSeries,
                            color = c.forDelta(delta),
                            height = 40.dp,
                        )
                        Spacer(Modifier.height(Space.xs))
                        Text(
                            "Modelled value since purchase",
                            style = MarginTheme.type.caption, color = c.inkFaint,
                        )
                    }
                }
            }

            state.signalText?.let { signal ->
                item {
                    Column(Modifier.padding(horizontal = Space.screenH)) {
                        Text(signal, style = MarginTheme.type.body, color = c.ink)
                        Spacer(Modifier.height(Space.lg))
                    }
                }
            }

            item { SectionLabel("Record") }
            item {
                Column(Modifier.padding(horizontal = Space.screenH)) {
                    KeyValueRow("Paid", Money.format(item.purchasePriceMinor, item.currency))
                    KeyValueRow("Bought", RelativeTime.shortDate(item.purchasedAtMillis))
                    item.fairValueAtPurchaseMinor?.let {
                        KeyValueRow(
                            "Fair value then", Money.whole(it, item.currency),
                            support = if (it > item.purchasePriceMinor) {
                                "You bought ${Money.whole(it - item.purchasePriceMinor, showCurrency = false)} under it"
                            } else null,
                        )
                    }
                    item.predictedNetMinor?.let {
                        KeyValueRow(
                            "Margin forecast", Money.whole(it, item.currency, alwaysSigned = true),
                        )
                    }
                    item.realisedMinor?.let {
                        KeyValueRow(
                            "You realised", Money.whole(it, item.currency, alwaysSigned = true),
                            valueColor = c.forDelta(it), emphasis = true,
                        )
                    }
                    item.predictionErrorMinor?.let { error ->
                        KeyValueRow(
                            "Against forecast",
                            Money.whole(error, item.currency, alwaysSigned = true),
                            valueColor = c.forDelta(error),
                            support = if (error >= 0) "Better than Margin predicted"
                            else "Worse than Margin predicted",
                        )
                    }
                    if (item.note.isNotBlank()) {
                        Spacer(Modifier.height(Space.md))
                        Text(item.note, style = MarginTheme.type.body, color = c.inkMuted)
                    }
                }
            }

            if (state.markingSold) {
                item {
                    Spacer(Modifier.height(Space.xl))
                    Column(Modifier.padding(horizontal = Space.screenH)) {
                        MoneyField(
                            minorValue = state.soldPriceInput,
                            onMinorChange = viewModel::setSoldPrice,
                            label = "What did it actually sell for",
                            currency = item.currency,
                            supporting = "Margin compares this against its own forecast.",
                        )
                    }
                }
            }
        }

        if (item.status != OwnedStatus.SOLD) {
            Column(Modifier.padding(Space.screenH)) {
                if (state.markingSold) {
                    PrimaryAction(
                        "Record the sale",
                        { viewModel.confirmSold(onBack) },
                        enabled = state.soldPriceInput > 0,
                    )
                    Spacer(Modifier.height(Space.sm))
                    SecondaryAction("Cancel", viewModel::cancelMarkSold)
                } else {
                    PrimaryAction(
                        if (item.status == OwnedStatus.LISTED) "Continue the listing" else "Start selling",
                        { onSell(item.id) },
                    )
                    Spacer(Modifier.height(Space.sm))
                    SecondaryAction("Mark as sold", viewModel::beginMarkSold)
                }
            }
        }
    }
}
