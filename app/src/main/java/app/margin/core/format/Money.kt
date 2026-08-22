package app.margin.core.format

import kotlin.math.abs
import kotlin.math.roundToLong

/**
 * All money in Margin is a Long in minor units. It is formatted only at the UI edge.
 * Swiss grouping (1'480) is used for CHF because that is the app's home market.
 */
object Money {

    /**
     * A non-breaking space between the currency and the figure, so "CHF" can never wrap onto
     * a different line from the number it labels.
     */
    private const val NBSP = '\u00A0'

    fun format(
        minor: Long,
        currency: String = "CHF",
        showCurrency: Boolean = true,
        alwaysSigned: Boolean = false,
        forceDecimals: Boolean = false,
    ): String {
        val negative = minor < 0
        val abs = abs(minor)
        val units = abs / 100
        val cents = (abs % 100).toInt()
        val grouped = group(units, groupingFor(currency))
        val body = if (cents != 0 || forceDecimals) {
            "$grouped.${cents.toString().padStart(2, '0')}"
        } else {
            grouped
        }
        val sign = when {
            negative -> "−" // real minus sign, not a hyphen
            alwaysSigned && minor > 0 -> "+"
            else -> ""
        }
        return if (showCurrency) "$sign$currency$NBSP$body" else "$sign$body"
    }

    /**
     * Rounds to whole units before formatting. Used for every derived figure — fair value,
     * resale, profit — because quoting an appraisal to the centime is false precision.
     */
    fun whole(
        minor: Long,
        currency: String = "CHF",
        showCurrency: Boolean = true,
        alwaysSigned: Boolean = false,
    ): String {
        val rounded = ((minor + if (minor >= 0) 50 else -50) / 100) * 100
        return format(rounded, currency, showCurrency, alwaysSigned)
    }

    /** Compact form for dense rows and chart labels: CHF 1.5k, CHF 12.4k. */
    fun compact(minor: Long, currency: String = "CHF", showCurrency: Boolean = true): String {
        val abs = abs(minor) / 100
        val sign = if (minor < 0) "−" else ""
        val body = when {
            abs >= 1_000_000 -> trimZero(abs / 100_000L / 10.0) + "M"
            abs >= 1_000 -> trimZero(abs / 100L / 10.0) + "k"
            else -> abs.toString()
        }
        return if (showCurrency) "$sign$currency$NBSP$body" else "$sign$body"
    }

    fun percent(fraction: Double, alwaysSigned: Boolean = false): String {
        val pct = (fraction * 100).roundToLong()
        val sign = when {
            pct < 0 -> "−"
            alwaysSigned && pct > 0 -> "+"
            else -> ""
        }
        return "$sign${abs(pct)}%"
    }

    fun symbol(currency: String): String = currency

    private fun groupingFor(currency: String): Char = when (currency) {
        "CHF" -> '’' // Swiss apostrophe
        "USD", "GBP" -> ','
        else -> ' '  // narrow-ish space for EUR and the rest
    }

    private fun group(value: Long, separator: Char): String {
        val s = value.toString()
        if (s.length <= 3) return s
        val sb = StringBuilder()
        var count = 0
        for (i in s.lastIndex downTo 0) {
            sb.append(s[i])
            count++
            if (count % 3 == 0 && i != 0) sb.append(separator)
        }
        return sb.reverse().toString()
    }

    private fun trimZero(v: Double): String {
        val r = (v * 10).roundToLong() / 10.0
        return if (r == r.toLong().toDouble()) r.toLong().toString() else r.toString()
    }
}

/** Human relative time, used everywhere a timestamp is shown. */
object RelativeTime {
    fun format(thenMillis: Long, nowMillis: Long): String {
        val d = nowMillis - thenMillis
        if (d < 0) return "scheduled"
        val minutes = d / 60_000
        val hours = minutes / 60
        val days = hours / 24
        return when {
            minutes < 1 -> "just now"
            minutes < 60 -> "${minutes}m ago"
            hours < 24 -> "${hours}h ago"
            days == 1L -> "yesterday"
            days < 7 -> "${days}d ago"
            days < 60 -> "${days / 7}w ago"
            else -> "${days / 30}mo ago"
        }
    }

    fun shortDate(millis: Long): String {
        val c = java.util.Calendar.getInstance().apply { timeInMillis = millis }
        val months = arrayOf("Jan", "Feb", "Mar", "Apr", "May", "Jun",
            "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
        return "${c.get(java.util.Calendar.DAY_OF_MONTH)} ${months[c.get(java.util.Calendar.MONTH)]} ${c.get(java.util.Calendar.YEAR)}"
    }
}
