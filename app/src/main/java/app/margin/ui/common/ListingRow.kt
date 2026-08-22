package app.margin.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.margin.core.design.BleedRow
import app.margin.core.design.CategoryPlate
import app.margin.core.design.MarginTheme
import app.margin.core.design.Space
import app.margin.core.design.StatusLabel
import app.margin.core.format.Money
import app.margin.domain.model.Evaluation
import app.margin.domain.model.Listing
import app.margin.domain.model.Verdict

/** Colour for a verdict. Positive verdicts are green, negative clay, watch neutral. */
@Composable
fun verdictColor(verdict: Verdict): Color {
    val c = MarginTheme.colors
    return when (verdict) {
        Verdict.STRONG_BUY, Verdict.BUY -> c.positive
        Verdict.WATCH -> c.caution
        Verdict.PASS -> c.inkMuted
        Verdict.AVOID -> c.negative
    }
}

@Composable
fun verdictSoftColor(verdict: Verdict): Color {
    val c = MarginTheme.colors
    return when (verdict) {
        Verdict.STRONG_BUY, Verdict.BUY -> c.positiveSoft
        Verdict.WATCH -> c.cautionSoft
        Verdict.PASS -> c.surfaceMuted
        Verdict.AVOID -> c.negativeSoft
    }
}

@Composable
fun VerdictLabel(verdict: Verdict, modifier: Modifier = Modifier, short: Boolean = false) {
    StatusLabel(
        text = if (short) verdict.short else verdict.label,
        modifier = modifier,
        fg = verdictColor(verdict),
        bg = verdictSoftColor(verdict),
    )
}

/**
 * The feed row. Title, where it is and how it is priced against fair value on the left; the
 * score and verdict on the right. No chevron: the whole row is the target.
 */
@Composable
fun ListingRow(
    listing: Listing,
    evaluation: Evaluation?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    watched: Boolean = false,
) {
    val c = MarginTheme.colors
    BleedRow(
        onClick = onClick,
        modifier = modifier,
        leading = { CategoryPlate(listing.category, size = 46.dp) },
        trailing = {
            if (evaluation != null) {
                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        evaluation.dealScore.toString(),
                        style = MarginTheme.type.numeralM,
                        color = c.forScore(evaluation.dealScore),
                    )
                    Spacer(Modifier.height(5.dp))
                    VerdictLabel(evaluation.verdict, short = true)
                }
            }
        },
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                listing.title,
                style = MarginTheme.type.bodyStrong,
                color = c.inkStrong,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            if (watched) {
                Spacer(Modifier.width(Space.sm))
                Box(
                    Modifier
                        .size(6.dp)
                        .clip(CircleShape)
                        .background(c.accent)
                )
            }
        }
        Spacer(Modifier.height(3.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                Money.format(listing.askingPriceMinor, listing.currency),
                style = MarginTheme.type.numeralS,
                color = c.ink,
            )
            if (evaluation != null && evaluation.hasMarketData) {
                Spacer(Modifier.width(Space.sm))
                val delta = evaluation.discountMinor
                Text(
                    if (delta > 0) "${Money.whole(delta, listing.currency)} under fair"
                    else if (delta < 0) "${Money.whole(-delta, listing.currency)} over fair"
                    else "at fair value",
                    style = MarginTheme.type.caption,
                    color = if (delta > 0) c.positive else if (delta < 0) c.negative else c.inkMuted,
                    maxLines = 1,
                )
            }
        }
        Spacer(Modifier.height(2.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(Space.xs)) {
            Text(
                "${listing.sourceName} · ${listing.location} · ${listing.condition.label}",
                style = MarginTheme.type.caption,
                color = c.inkFaint,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
