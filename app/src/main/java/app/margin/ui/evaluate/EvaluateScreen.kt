package app.margin.ui.evaluate

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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.margin.core.design.CategoryPlate
import app.margin.core.design.ErrorState
import app.margin.core.design.Hairline
import app.margin.core.design.IconAction
import app.margin.core.design.KeyValueRow
import app.margin.core.design.MarginTheme
import app.margin.core.design.PrimaryAction
import app.margin.core.design.Radius
import app.margin.core.design.RangeMarker
import app.margin.core.design.ScoreDial
import app.margin.core.design.SecondaryAction
import app.margin.core.design.SectionLabel
import app.margin.core.design.SkeletonBlock
import app.margin.core.design.Space
import app.margin.core.design.StatusLabel
import app.margin.core.design.pressable
import app.margin.core.format.Money
import app.margin.core.format.RelativeTime
import app.margin.domain.model.DecisionType
import app.margin.domain.model.Evaluation
import app.margin.domain.model.Listing
import app.margin.domain.model.Risk
import app.margin.domain.model.RiskSeverity
import app.margin.ui.common.VerdictLabel
import app.margin.ui.common.verdictColor

@Composable
fun EvaluateScreen(
    viewModel: EvaluateViewModel,
    onBack: () -> Unit,
    onOpenOwned: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val c = MarginTheme.colors

    Column(modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(end = Space.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconAction(Icons.AutoMirrored.Outlined.ArrowBack, "Back", onBack)
            Spacer(Modifier.width(Space.xs))
            Text(
                state.listing?.sourceName ?: "Evaluation",
                style = MarginTheme.type.captionStrong,
                color = c.inkMuted,
                modifier = Modifier.weight(1f),
            )
            state.listing?.let {
                StatusLabel(it.provenance.label)
            }
        }

        when {
            state.loading -> LoadingBody()
            state.error != null -> ErrorState(
                title = "Could not open this",
                body = state.error!!,
                onRetry = viewModel::load,
            )
            else -> {
                val listing = state.listing!!
                val evaluation = state.evaluation!!
                EvaluationBody(
                    listing = listing,
                    evaluation = evaluation,
                    state = state,
                    viewModel = viewModel,
                    onOpenOwned = onOpenOwned,
                )
            }
        }
    }
}

@Composable
private fun LoadingBody() {
    Column(Modifier.padding(Space.screenH)) {
        SkeletonBlock(height = 26.dp, widthFraction = 0.75f, index = 0)
        Spacer(Modifier.height(Space.md))
        SkeletonBlock(height = 46.dp, widthFraction = 0.5f, index = 1)
        Spacer(Modifier.height(Space.xl))
        repeat(4) { i ->
            SkeletonBlock(height = 16.dp, widthFraction = 0.9f - i * 0.1f, index = i + 2)
            Spacer(Modifier.height(Space.sm))
        }
    }
}

@Composable
private fun EvaluationBody(
    listing: Listing,
    evaluation: Evaluation,
    state: EvaluateUiState,
    viewModel: EvaluateViewModel,
    onOpenOwned: (String) -> Unit,
) {
    val c = MarginTheme.colors
    val cur = listing.currency

    Box(Modifier.fillMaxSize()) {
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = 132.dp),
        ) {
            // --- Identity -----------------------------------------------------------------
            item {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = Space.screenH, vertical = Space.sm),
                    verticalAlignment = Alignment.Top,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(listing.title, style = MarginTheme.type.title, color = c.inkStrong)
                        Spacer(Modifier.height(4.dp))
                        Text(
                            listOfNotNull(
                                listing.condition.label,
                                listing.year?.toString(),
                                listing.location,
                                listing.sellerType.label,
                            ).joinToString(" · "),
                            style = MarginTheme.type.caption,
                            color = c.inkMuted,
                        )
                    }
                    Spacer(Modifier.width(Space.md))
                    CategoryPlate(listing.category, size = 54.dp)
                }
            }

            // --- Verdict, score, asking price ---------------------------------------------
            item {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = Space.screenH, vertical = Space.lg),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        VerdictLabel(evaluation.verdict)
                        Spacer(Modifier.height(Space.sm))
                        Text(
                            Money.format(listing.askingPriceMinor, cur),
                            style = MarginTheme.type.numeralXl,
                            color = c.inkStrong,
                        )
                        Spacer(Modifier.height(2.dp))
                        Text(
                            "asking · listed ${RelativeTime.format(listing.listedAtMillis, System.currentTimeMillis())}",
                            style = MarginTheme.type.caption,
                            color = c.inkFaint,
                        )
                    }
                    Spacer(Modifier.width(Space.lg))
                    Box(contentAlignment = Alignment.Center) {
                        ScoreDial(
                            score = evaluation.dealScore,
                            trackColor = c.hairline,
                            valueColor = c.forScore(evaluation.dealScore),
                            size = 84.dp,
                        )
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                evaluation.dealScore.toString(),
                                style = MarginTheme.type.numeralL,
                                color = c.forScore(evaluation.dealScore),
                            )
                            Text("score", style = MarginTheme.type.caption, color = c.inkFaint)
                        }
                    }
                }
            }

            item {
                Text(
                    evaluation.headline,
                    style = MarginTheme.type.heading,
                    color = verdictColor(evaluation.verdict),
                    modifier = Modifier.padding(horizontal = Space.screenH),
                )
                Spacer(Modifier.height(Space.lg))
            }

            evaluation.personalNote?.let { note ->
                item {
                    ScoreMathBlock(evaluation, note, state.showScoreMath, viewModel::toggleScoreMath)
                    Spacer(Modifier.height(Space.lg))
                }
            }

            // --- Price against fair value --------------------------------------------------
            if (evaluation.hasMarketData) {
                item {
                    FairValueBlock(listing, evaluation)
                    Spacer(Modifier.height(Space.xl))
                }
            }

            // --- The money ------------------------------------------------------------------
            item { SectionLabel("The money") }
            item {
                Column(Modifier.padding(horizontal = Space.screenH)) {
                    KeyValueRow("Asking price", Money.format(listing.askingPriceMinor, cur))
                    if (evaluation.refurbCostMinor > 0) {
                        KeyValueRow(
                            "Refurbishment", Money.whole(evaluation.refurbCostMinor, cur),
                            support = "Overrun allowance included",
                        )
                    }
                    KeyValueRow("Collection", Money.whole(evaluation.logisticsCostMinor, cur))
                    Hairline(inset = 0.dp, modifier = Modifier.padding(vertical = Space.sm))
                    KeyValueRow(
                        "Resale via ${evaluation.recommendedChannel.label.lowercase()}",
                        Money.whole(evaluation.resaleValueMinor, cur),
                        support = "About ${evaluation.recommendedChannel.typicalDays} days",
                    )
                    if (evaluation.feeCostMinor > 0) {
                        KeyValueRow("Platform fees", Money.whole(-evaluation.feeCostMinor, cur))
                    }
                    KeyValueRow("Capital tied up", Money.whole(-evaluation.holdingCostMinor, cur))
                    Hairline(inset = 0.dp, modifier = Modifier.padding(vertical = Space.sm))
                    KeyValueRow(
                        "Net if you flipped it",
                        Money.whole(evaluation.netProfitMinor, cur, alwaysSigned = true),
                        valueColor = c.forDelta(evaluation.netProfitMinor),
                        emphasis = true,
                    )
                }
                Spacer(Modifier.height(Space.xl))
            }

            // --- The number that matters in a negotiation ------------------------------------
            item {
                WalkAwayBlock(evaluation, cur)
                Spacer(Modifier.height(Space.xl))
            }

            // --- Risks ------------------------------------------------------------------------
            if (evaluation.risks.isNotEmpty()) {
                val shown = if (state.showAllRisks) evaluation.risks else evaluation.risks.take(3)
                item {
                    SectionLabel(
                        "What to check",
                        trailing = {
                            if (evaluation.risks.size > 3) {
                                Text(
                                    if (state.showAllRisks) "Show less"
                                    else "${evaluation.risks.size - 3} more",
                                    style = MarginTheme.type.captionStrong,
                                    color = c.accent,
                                    modifier = Modifier.pressable(viewModel::toggleRisks),
                                )
                            }
                        },
                    )
                }
                items(shown.size) { index -> RiskRow(shown[index]) }
                item { Spacer(Modifier.height(Space.xl)) }
            }

            // --- Why -----------------------------------------------------------------------
            item { SectionLabel("How this was worked out") }
            items(evaluation.rationale.size) { index ->
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = Space.screenH, vertical = 5.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    Box(
                        Modifier
                            .padding(top = 8.dp)
                            .height(3.dp).width(3.dp)
                            .clip(RoundedCornerShape(1.5.dp))
                            .background(c.inkFaint)
                    )
                    Spacer(Modifier.width(Space.md))
                    Text(
                        evaluation.rationale[index],
                        style = MarginTheme.type.body,
                        color = c.ink,
                    )
                }
            }

            // --- Comparables ------------------------------------------------------------------
            if (evaluation.comparables.isNotEmpty()) {
                item {
                    Spacer(Modifier.height(Space.xl))
                    SectionLabel("Comparable sales")
                }
                items(evaluation.comparables.size) { index ->
                    val comp = evaluation.comparables[index]
                    Column(Modifier.padding(horizontal = Space.screenH)) {
                        KeyValueRow(
                            label = comp.label,
                            value = Money.format(comp.priceMinor, cur),
                            support = "${comp.condition.label} · ${comp.soldDaysAgo} days ago",
                        )
                    }
                }
            }

            item {
                Spacer(Modifier.height(Space.xl))
                Column(Modifier.padding(horizontal = Space.screenH)) {
                    Text("Description", style = MarginTheme.type.captionStrong, color = c.inkMuted)
                    Spacer(Modifier.height(Space.xs))
                    Text(listing.description, style = MarginTheme.type.body, color = c.ink)
                    Spacer(Modifier.height(Space.lg))
                    Text(
                        "Valued locally by ${evaluation.engineId} · " +
                            "${evaluation.confidence.label.lowercase()} confidence · no network used",
                        style = MarginTheme.type.caption,
                        color = c.inkFaint,
                    )
                }
            }
        }

        DecisionBar(
            current = state.currentDecision,
            onDecide = viewModel::decide,
            onUndo = viewModel::undoDecision,
            onOpenOwned = { onOpenOwned("own-${listing.id}") },
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }
}

@Composable
private fun ScoreMathBlock(
    evaluation: Evaluation,
    note: String,
    expanded: Boolean,
    onToggle: () -> Unit,
) {
    val c = MarginTheme.colors
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = Space.screenH)
            .clip(RoundedCornerShape(Radius.md))
            .background(c.surfaceMuted)
            .pressable(onToggle)
            .padding(Space.lg)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "Base ${evaluation.baseScore}",
                style = MarginTheme.type.numeralS, color = c.inkMuted,
            )
            Text(
                "  ${if (evaluation.memoryDelta >= 0) "+" else "−"}${kotlin.math.abs(evaluation.memoryDelta)} from your history  ",
                style = MarginTheme.type.caption,
                color = c.forDelta(evaluation.memoryDelta.toLong()),
            )
            Text(
                "= ${evaluation.dealScore}",
                style = MarginTheme.type.numeralS, color = c.inkStrong,
            )
        }
        Spacer(Modifier.height(Space.xs))
        Text(
            note,
            style = MarginTheme.type.caption,
            color = c.inkMuted,
            maxLines = if (expanded) 8 else 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun FairValueBlock(listing: Listing, evaluation: Evaluation) {
    val c = MarginTheme.colors
    val cur = listing.currency
    val low = evaluation.fairLowMinor
    val high = evaluation.fairHighMinor
    // Widen the axis a little beyond the band so the marker is never clipped at an edge.
    val axisLow = minOf(low, listing.askingPriceMinor) * 0.94
    val axisHigh = maxOf(high, listing.askingPriceMinor) * 1.06
    val span = (axisHigh - axisLow).takeIf { it > 0 } ?: 1.0
    fun frac(v: Long) = ((v - axisLow) / span).toFloat()

    Column(Modifier.fillMaxWidth().padding(horizontal = Space.screenH)) {
        Row(verticalAlignment = Alignment.Bottom) {
            Column(Modifier.weight(1f)) {
                Text("Fair value", style = MarginTheme.type.caption, color = c.inkMuted)
                Spacer(Modifier.height(3.dp))
                Text(
                    Money.whole(evaluation.fairValueMinor, cur),
                    style = MarginTheme.type.numeralL,
                    color = c.inkStrong,
                )
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    if (evaluation.discountMinor > 0) "under fair value" else "over fair value",
                    style = MarginTheme.type.caption, color = c.inkMuted,
                )
                Spacer(Modifier.height(3.dp))
                Text(
                    Money.whole(kotlin.math.abs(evaluation.discountMinor), cur),
                    style = MarginTheme.type.numeralM,
                    color = c.forDelta(evaluation.discountMinor),
                )
            }
        }
        Spacer(Modifier.height(Space.md))
        RangeMarker(
            lowFraction = frac(low),
            highFraction = frac(high),
            markerFraction = frac(listing.askingPriceMinor),
            bandColor = c.hairlineStrong,
            trackColor = c.hairline,
            markerColor = c.inkStrong,
        )
        Spacer(Modifier.height(Space.sm))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(Money.whole(low, cur), style = MarginTheme.type.caption, color = c.inkFaint)
            Text(
                when {
                    listing.askingPriceMinor < low -> "asking price is below the range"
                    listing.askingPriceMinor > high -> "asking price is above the range"
                    else -> "asking price is inside the range"
                },
                style = MarginTheme.type.caption, color = c.inkMuted,
            )
            Text(Money.whole(high, cur), style = MarginTheme.type.caption, color = c.inkFaint)
        }
    }
}

@Composable
private fun WalkAwayBlock(evaluation: Evaluation, cur: String) {
    val c = MarginTheme.colors
    val gap = evaluation.negotiationGapMinor
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = Space.screenH)
            .clip(RoundedCornerShape(Radius.md))
            .border(1.dp, c.hairlineStrong, RoundedCornerShape(Radius.md))
            .padding(Space.lg)
    ) {
        Text("Do not pay more than", style = MarginTheme.type.caption, color = c.inkMuted)
        Spacer(Modifier.height(4.dp))
        Text(
            Money.whole(evaluation.maxBidMinor, cur),
            style = MarginTheme.type.numeralL,
            color = c.inkStrong,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            if (gap <= 0) {
                "The asking price is already ${Money.whole(-gap, cur)} below your walk-away price."
            } else {
                "They need to come down ${Money.whole(gap, cur)} before this works."
            },
            style = MarginTheme.type.caption,
            color = c.inkMuted,
        )
    }
}

@Composable
private fun RiskRow(risk: Risk) {
    val c = MarginTheme.colors
    val tone = when (risk.severity) {
        RiskSeverity.SERIOUS -> c.negative
        RiskSeverity.CAUTION -> c.caution
        RiskSeverity.INFO -> c.inkMuted
    }
    Row(
        Modifier.fillMaxWidth().padding(horizontal = Space.screenH, vertical = Space.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            Modifier
                .padding(top = 6.dp)
                .width(3.dp)
                .height(30.dp)
                .clip(RoundedCornerShape(1.5.dp))
                .background(tone)
        )
        Spacer(Modifier.width(Space.md))
        Column {
            Text(risk.title, style = MarginTheme.type.bodyStrong, color = c.inkStrong)
            Spacer(Modifier.height(2.dp))
            Text(risk.detail, style = MarginTheme.type.caption, color = c.inkMuted)
        }
    }
}

@Composable
private fun DecisionBar(
    current: DecisionType?,
    onDecide: (DecisionType, String) -> Unit,
    onUndo: () -> Unit,
    onOpenOwned: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = MarginTheme.colors
    Column(
        modifier
            .fillMaxWidth()
            .background(c.canvas)
    ) {
        Hairline(inset = 0.dp)
        Column(Modifier.padding(Space.screenH)) {
            when (current) {
                null -> {
                    Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
                        Box(Modifier.weight(1f)) {
                            SecondaryAction("Reject", { onDecide(DecisionType.REJECT, "Not for me") })
                        }
                        Box(Modifier.weight(1f)) {
                            SecondaryAction("Watch", { onDecide(DecisionType.WATCH, "Watching for a price cut") })
                        }
                        Box(Modifier.weight(1f)) {
                            PrimaryAction("Bought", { onDecide(DecisionType.BOUGHT, "Bought it") })
                        }
                    }
                }
                DecisionType.BOUGHT -> {
                    PrimaryAction("Open in your inventory", onOpenOwned)
                    Spacer(Modifier.height(Space.sm))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                        Text(
                            "Undo",
                            style = MarginTheme.type.captionStrong,
                            color = c.inkMuted,
                            modifier = Modifier.pressable(onUndo).padding(Space.xs),
                        )
                    }
                }
                else -> {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            if (current == DecisionType.WATCH) "You are watching this"
                            else "You rejected this",
                            style = MarginTheme.type.bodyStrong,
                            color = c.inkStrong,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            "Undo",
                            style = MarginTheme.type.captionStrong,
                            color = c.accent,
                            modifier = Modifier.pressable(onUndo).padding(Space.xs),
                        )
                    }
                }
            }
        }
    }
}
