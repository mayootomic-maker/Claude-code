package app.margin.ui.sell

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.margin.core.design.Hairline
import app.margin.core.design.IconAction
import app.margin.core.design.KeyValueRow
import app.margin.core.design.MarginField
import app.margin.core.design.MarginTheme
import app.margin.core.design.MoneyField
import app.margin.core.design.PrimaryAction
import app.margin.core.design.Radius
import app.margin.core.design.SecondaryAction
import app.margin.core.design.SectionLabel
import app.margin.core.design.Space
import app.margin.core.design.StepIndicator
import app.margin.core.design.pressable
import app.margin.core.format.Money
import app.margin.domain.model.SaleChannel

private val STEPS = listOf("Price", "Photographs", "Listing")

@Composable
fun SellScreen(
    viewModel: SellViewModel,
    onBack: () -> Unit,
    onFinished: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val c = MarginTheme.colors
    val clipboard = LocalClipboardManager.current
    val item = state.item

    Column(modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            IconAction(Icons.AutoMirrored.Outlined.ArrowBack, "Back", {
                if (state.step == 0) onBack() else viewModel.back()
            })
            Column(Modifier.weight(1f)) {
                Text("Sell", style = MarginTheme.type.heading, color = c.inkStrong)
                if (item != null) {
                    Text(item.title, style = MarginTheme.type.caption, color = c.inkMuted, maxLines = 1)
                }
            }
            Spacer(Modifier.width(Space.lg))
        }

        Box(Modifier.padding(horizontal = Space.screenH, vertical = Space.sm)) {
            StepIndicator(STEPS.size, state.step)
        }

        if (item == null) {
            Spacer(Modifier.weight(1f))
            return@Column
        }

        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(bottom = Space.section)) {
            item {
                Text(
                    STEPS[state.step],
                    style = MarginTheme.type.titleXl,
                    color = c.inkStrong,
                    modifier = Modifier.padding(horizontal = Space.screenH, vertical = Space.md),
                )
            }

            when (state.step) {
                0 -> {
                    item {
                        Column(Modifier.padding(horizontal = Space.screenH)) {
                            Text(
                                "Worth about ${Money.whole(state.currentValueMinor, item.currency)} today, " +
                                    "based on the same comparables Margin used when you bought it.",
                                style = MarginTheme.type.body, color = c.inkMuted,
                            )
                            Spacer(Modifier.height(Space.lg))
                            MoneyField(
                                minorValue = state.askPriceMinor,
                                onMinorChange = viewModel::setAskPrice,
                                label = "Your asking price",
                                currency = item.currency,
                            )
                            Spacer(Modifier.height(Space.lg))
                            KeyValueRow(
                                "Price for a quick sale",
                                Money.whole(state.quickSaleMinor, item.currency),
                                support = "Moves in roughly half the time",
                            )
                            KeyValueRow(
                                "Do not go below",
                                Money.whole(state.floorPriceMinor, item.currency),
                                support = "Under this you are better off keeping it",
                            )
                            KeyValueRow(
                                "You paid",
                                Money.format(item.purchasePriceMinor, item.currency),
                                support = "Bought " + app.margin.core.format.RelativeTime
                                    .shortDate(item.purchasedAtMillis),
                            )
                        }
                        Spacer(Modifier.height(Space.xl))
                    }
                    item { SectionLabel("Where to sell it") }
                    items(state.channels.size) { index ->
                        val option = state.channels[index]
                        ChannelRow(
                            option = option,
                            currency = item.currency,
                            selected = option.channel == state.channel,
                            onSelect = { viewModel.setChannel(option.channel) },
                        )
                        Hairline(inset = Space.screenH)
                    }
                }

                1 -> {
                    item {
                        Column(Modifier.padding(horizontal = Space.screenH)) {
                            Text(
                                "Listings with these photographs sell faster and get haggled " +
                                    "less. Margin cannot take them for you — this is your checklist.",
                                style = MarginTheme.type.body, color = c.inkMuted,
                            )
                            Spacer(Modifier.height(Space.lg))
                        }
                    }
                    items(state.photoTasks.size) { index ->
                        val task = state.photoTasks[index]
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .pressable({ viewModel.togglePhoto(task.id) })
                                .padding(horizontal = Space.screenH, vertical = Space.md),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                Modifier
                                    .size(22.dp)
                                    .clip(RoundedCornerShape(Radius.xs))
                                    .background(if (task.done) c.inkStrong else c.surface)
                                    .border(
                                        1.dp,
                                        if (task.done) c.inkStrong else c.hairlineStrong,
                                        RoundedCornerShape(Radius.xs),
                                    ),
                                contentAlignment = Alignment.Center,
                            ) {
                                if (task.done) {
                                    Icon(
                                        Icons.Outlined.Check, null,
                                        tint = c.onInk, modifier = Modifier.size(14.dp),
                                    )
                                }
                            }
                            Spacer(Modifier.width(Space.md))
                            Column(Modifier.weight(1f)) {
                                Text(
                                    task.label,
                                    style = MarginTheme.type.bodyStrong,
                                    color = if (task.done) c.inkMuted else c.inkStrong,
                                )
                                Text(task.hint, style = MarginTheme.type.caption, color = c.inkFaint)
                            }
                        }
                        Hairline(inset = Space.screenH)
                    }
                    item {
                        Spacer(Modifier.height(Space.md))
                        Text(
                            "${state.photoTasks.count { it.done }} of ${state.photoTasks.size} done. " +
                                "This is a reminder, not a requirement — you can list without it.",
                            style = MarginTheme.type.caption,
                            color = c.inkFaint,
                            modifier = Modifier.padding(horizontal = Space.screenH),
                        )
                    }
                }

                2 -> {
                    item {
                        Column(Modifier.padding(horizontal = Space.screenH)) {
                            MarginField(
                                value = state.title,
                                onValueChange = viewModel::setTitle,
                                label = "Listing title",
                                singleLine = false,
                                minHeight = 64.dp,
                            )
                            Spacer(Modifier.height(Space.lg))
                            MarginField(
                                value = state.body,
                                onValueChange = viewModel::setBody,
                                label = "Description",
                                singleLine = false,
                                minHeight = 260.dp,
                            )
                            Spacer(Modifier.height(Space.md))
                            Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
                                Box(Modifier.weight(1f)) {
                                    SecondaryAction(
                                        "Copy listing text",
                                        {
                                            clipboard.setText(
                                                AnnotatedString("${state.title}\n\n${state.body}")
                                            )
                                        },
                                        icon = Icons.Outlined.ContentCopy,
                                    )
                                }
                                Box(Modifier.weight(1f)) {
                                    SecondaryAction("Rewrite", { viewModel.regenerateCopy() })
                                }
                            }
                            Spacer(Modifier.height(Space.md))
                            Text(
                                "Written on the device from the facts on record. Edit it freely — " +
                                    "your changes are what gets saved.",
                                style = MarginTheme.type.caption,
                                color = c.inkFaint,
                            )
                        }
                    }
                }
            }
        }

        Column(Modifier.padding(Space.screenH)) {
            if (state.step < 2) {
                PrimaryAction("Continue", viewModel::next)
            } else {
                PrimaryAction("Mark as listed", { viewModel.markAsListed(onFinished) })
                Spacer(Modifier.height(Space.sm))
                SecondaryAction("Save as draft", { viewModel.saveDraft(); onFinished() })
            }
        }
    }
}

@Composable
private fun ChannelRow(
    option: ChannelOption,
    currency: String,
    selected: Boolean,
    onSelect: () -> Unit,
) {
    val c = MarginTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .pressable(onSelect)
            .background(if (selected) c.surfaceMuted else c.canvas)
            .padding(horizontal = Space.screenH, vertical = Space.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    option.channel.label,
                    style = MarginTheme.type.bodyStrong,
                    color = c.inkStrong,
                )
                if (option.recommended) {
                    Spacer(Modifier.width(Space.sm))
                    Text("BEST NET", style = MarginTheme.type.label, color = c.positive)
                }
            }
            Spacer(Modifier.height(2.dp))
            Text(
                "${option.channel.note} · about ${option.channel.typicalDays} days",
                style = MarginTheme.type.caption,
                color = c.inkMuted,
            )
        }
        Spacer(Modifier.width(Space.md))
        Text(
            Money.whole(option.netMinor, currency),
            style = MarginTheme.type.numeralM,
            color = if (selected) c.inkStrong else c.ink,
        )
    }
}
