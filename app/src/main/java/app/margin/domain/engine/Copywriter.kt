package app.margin.domain.engine

import app.margin.core.format.Money
import app.margin.domain.model.Category
import app.margin.domain.model.Condition
import app.margin.domain.model.OwnedItem
import app.margin.domain.model.SaleChannel

data class CopyRequest(
    val item: OwnedItem,
    val channel: SaleChannel,
    val askPriceMinor: Long,
    val condition: Condition,
    val highlights: List<String>,
    val flaws: List<String>,
    val location: String,
)

data class ListingCopy(val title: String, val body: String)

/** The seam an LLM copywriter would implement. */
interface ListingCopywriter {
    val copywriterId: String
    fun draft(request: CopyRequest): ListingCopy
}

/**
 * Composes listing copy from the facts on record.
 *
 * The structure follows what actually sells second-hand goods: what it is, its real condition
 * including flaws, what is included, and how collection works. Flaws are stated rather than
 * omitted, because a listing that hides them gets haggled down on collection anyway.
 */
class TemplateCopywriter : ListingCopywriter {

    override val copywriterId: String = "template-v1"

    override fun draft(request: CopyRequest): ListingCopy {
        val item = request.item
        val cur = item.currency
        val year = item.year?.let { " ($it)" } ?: ""

        val title = buildString {
            append(item.title)
            append(year)
            request.highlights.firstOrNull()?.let { append(" — $it") }
        }.take(80)

        val body = buildString {
            appendLine("${item.title}$year in ${request.condition.label.lowercase()} condition.")
            appendLine()

            if (request.highlights.isNotEmpty()) {
                request.highlights.forEach { appendLine("• $it") }
                appendLine()
            }

            if (request.flaws.isNotEmpty()) {
                appendLine("Being straight about the condition:")
                request.flaws.forEach { appendLine("• $it") }
                appendLine()
            } else {
                appendLine("No damage beyond normal use for its age. Happy to photograph anything specific.")
                appendLine()
            }

            appendLine(includedLine(item.category))
            appendLine()

            appendLine(
                "Asking ${Money.format(request.askPriceMinor, cur)}. " + when (request.channel) {
                    SaleChannel.LOCAL_MARKETPLACE ->
                        "Collection in ${request.location}, cash or TWINT on pickup."
                    SaleChannel.SPECIALIST ->
                        "Shipping insured, or collection in ${request.location}."
                    SaleChannel.AUCTION ->
                        "Starting bid set low, no reserve. Collection in ${request.location}."
                    SaleChannel.TRADE_IN ->
                        "Available for immediate trade-in assessment."
                }
            )
        }.trim()

        return ListingCopy(title, body)
    }

    private fun includedLine(category: Category): String = when (category) {
        Category.BIKE -> "Included: original charger, keys, and the service records I have."
        Category.PC, Category.LAPTOP -> "Included: power supply, and the original box where I still have it. Wiped and reset."
        Category.CAMERA -> "Included: body cap, strap, two batteries and the charger."
        Category.PHONE -> "Included: cable. Reset, signed out, and not carrier or account locked."
        Category.AUDIO -> "Included: power cable and original packaging."
        Category.WATCH -> "Included: box, papers and any spare links."
        Category.TOOL -> "Included: case, guide-rail fittings and the manual."
        Category.FURNITURE -> "Collection only — it will not fit in a car without folding the seats."
        Category.DRONE -> "Included: controller, all batteries, charger and the case."
        Category.INSTRUMENT -> "Included: case and the accessories it came with."
        Category.OTHER -> "Included: everything shown in the photographs."
    }
}
