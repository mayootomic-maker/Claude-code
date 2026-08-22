package app.margin.domain.engine

import app.margin.domain.model.Category
import app.margin.domain.model.Condition
import app.margin.domain.model.Listing
import app.margin.domain.model.Provenance
import app.margin.domain.model.SellerType
import java.util.Locale

/**
 * The seam a real marketplace scraper or listing API would implement.
 *
 * The shipped implementation never pretends to fetch anything. It resolves against the local
 * catalogue first, and otherwise parses what it can out of the URL itself, reporting exactly
 * which fields were inferred so the UI can show the user what is known versus guessed.
 */
interface ListingSource {
    val sourceId: String
    suspend fun resolve(input: String, nowMillis: Long): ResolveResult
}

sealed interface ResolveResult {
    /** Matched an item already in the local catalogue: every field is real. */
    data class Known(val listing: Listing) : ResolveResult

    /**
     * Built from the link itself. [inferredFields] names every field that was guessed rather
     * than read, and [unknownFields] names what could not be determined at all.
     */
    data class Inferred(
        val listing: Listing,
        val inferredFields: List<String>,
        val unknownFields: List<String>,
    ) : ResolveResult

    data class Unusable(val reason: String, val hint: String) : ResolveResult
}

class LocalListingResolver(
    private val catalogue: suspend () -> List<Listing>,
    private val market: SeededMarketData,
) : ListingSource {

    override val sourceId: String = "local-resolver-v1"

    override suspend fun resolve(input: String, nowMillis: Long): ResolveResult {
        val text = input.trim()
        if (text.isEmpty()) {
            return ResolveResult.Unusable(
                "Nothing to read",
                "Paste a marketplace link, or share one to Margin from another app.",
            )
        }

        val url = extractUrl(text)
        val existing = catalogue()

        if (url != null) {
            existing.firstOrNull { sameUrl(it.url, url) }?.let { return ResolveResult.Known(it) }
        }

        // Without a URL we can still work from a pasted advert body, but only if there is
        // enough of it to be worth parsing.
        if (url == null && text.length < 24) {
            return ResolveResult.Unusable(
                "That does not look like a listing",
                "Margin needs a marketplace link or the text of an advert.",
            )
        }

        return parse(text, url, nowMillis)
    }

    // -- Parsing ---------------------------------------------------------------------------

    private fun parse(text: String, url: String?, nowMillis: Long): ResolveResult {
        val inferred = mutableListOf<String>()
        val unknown = mutableListOf<String>()

        val haystack = buildString {
            append(text.lowercase(Locale.ROOT))
            append(' ')
            append(url?.let { slugWords(it) }.orEmpty())
        }

        val host = url?.let { hostOf(it) }
        val sourceName = host?.let { sourceNameFor(it) } ?: "Pasted text"

        val match = matchModel(haystack)
        val brand: String
        val model: String
        val category: Category
        if (match != null) {
            brand = match.brand
            model = match.model
            category = match.category
            inferred += "brand"
            inferred += "model"
        } else {
            brand = detectBrand(haystack) ?: "Unknown"
            model = detectModelTokens(haystack, url) ?: "Unidentified model"
            category = detectCategory(haystack) ?: Category.OTHER
            if (brand == "Unknown") unknown += "brand" else inferred += "brand"
            unknown += "model"
        }
        if (match == null) inferred += "category"

        val price = detectPrice(text) ?: detectPrice(url.orEmpty())
        if (price == null) unknown += "asking price" else inferred += "asking price"

        val year = detectYear(haystack)
        if (year == null) unknown += "year" else inferred += "year"

        val condition = detectCondition(haystack)
        inferred += "condition"

        val title = buildTitle(brand, model, year, match?.displayName)

        val listing = Listing(
            id = "parsed-" + java.lang.Long.toHexString(
                (url ?: text).hashCode().toLong() and 0xFFFFFFFFL
            ),
            url = url ?: "",
            sourceName = sourceName,
            provenance = Provenance.PARSED_URL,
            title = title,
            brand = brand,
            model = model,
            year = year,
            category = category,
            condition = condition,
            askingPriceMinor = price ?: 0L,
            location = detectLocation(haystack) ?: "Location not stated",
            sellerType = SellerType.UNKNOWN,
            sellerRatingPct = null,
            listedAtMillis = nowMillis,
            description = text.take(600),
            specs = emptyMap(),
            imageCount = 0,
            capturedAtMillis = nowMillis,
        )

        return ResolveResult.Inferred(listing, inferred.distinct(), unknown.distinct())
    }

    // -- Field detection --------------------------------------------------------------------

    private data class ModelMatch(
        val brand: String, val model: String, val category: Category, val displayName: String,
    )

    /** Matches against the local market table, which is also the app's brand/model lexicon. */
    private fun matchModel(haystack: String): ModelMatch? {
        var best: ModelMatch? = null
        var bestScore = 0
        market.all().forEach { m ->
            // key is "category:brand:model"
            val parts = m.key.split(":")
            if (parts.size < 3) return@forEach
            val brandSlug = parts[1]
            val modelSlug = parts[2]
            val brandHit = brandSlug.isNotEmpty() && haystack.contains(brandSlug.replace('-', ' ')) ||
                haystack.contains(brandSlug)
            if (!brandHit) return@forEach
            val modelTokens = modelSlug.split('-').filter { it.length >= 3 }
            val modelHits = modelTokens.count { haystack.contains(it) }
            val score = 2 + modelHits
            if (score > bestScore) {
                bestScore = score
                best = ModelMatch(
                    brand = titleCase(brandSlug),
                    model = titleCase(modelSlug),
                    category = Category.fromSlug(parts[0]),
                    displayName = m.displayName,
                )
            }
        }
        return best
    }

    private val extraBrands = listOf(
        "canyon", "specialized", "cube", "trek", "giant", "scott", "bmc", "cannondale",
        "dell", "hp", "lenovo", "asus", "acer", "msi", "apple", "samsung", "sony",
        "fujifilm", "canon", "nikon", "panasonic", "sonos", "bose", "sennheiser",
        "festool", "bosch", "makita", "hilti", "dji", "gopro", "seiko", "tissot",
        "vitra", "usm", "herman miller", "yamaha", "fender", "gibson",
    )

    private fun detectBrand(haystack: String): String? =
        extraBrands.firstOrNull { haystack.contains(it) }?.let { titleCase(it.replace(' ', '-')) }

    private fun detectModelTokens(haystack: String, url: String?): String? {
        val slug = url?.let { slugWords(it) } ?: return null
        val stop = setOf(
            "www", "https", "http", "com", "ch", "de", "fr", "html", "htm", "php", "index",
            "listing", "listings", "item", "items", "ad", "ads", "offer", "offers", "annonce",
            "inserat", "artikel", "produkt", "product", "detail", "details", "kaufen", "verkaufen",
            "chf", "eur", "usd", "gebraucht", "occasion", "used", "neu", "new",
        )
        val tokens = slug.split(' ')
            .filter { it.length in 2..18 && it.any { ch -> ch.isLetter() } && it !in stop }
            .filterNot { it.all { ch -> ch.isDigit() } }
            .take(4)
        return tokens.takeIf { it.isNotEmpty() }?.joinToString(" ") { titleCase(it) }
    }

    private val categoryWords = mapOf(
        Category.BIKE to listOf("bike", "velo", "fahrrad", "gravel", "mtb", "roadbike", "e-bike", "ebike", "bicycle"),
        Category.PC to listOf("pc", "desktop", "tower", "gaming-pc", "optiplex", "elitedesk", "workstation", "computer"),
        Category.LAPTOP to listOf("laptop", "notebook", "macbook", "thinkpad", "ultrabook"),
        Category.CAMERA to listOf("camera", "kamera", "objektiv", "lens", "dslr", "mirrorless"),
        Category.PHONE to listOf("iphone", "smartphone", "handy", "pixel", "galaxy"),
        Category.AUDIO to listOf("speaker", "lautsprecher", "kopfhorer", "headphones", "hifi", "soundbar", "sonos"),
        Category.WATCH to listOf("watch", "uhr", "montre", "chronograph", "diver"),
        Category.TOOL to listOf("saw", "drill", "bohrmaschine", "saege", "werkzeug", "tool", "festool"),
        Category.FURNITURE to listOf("chair", "stuhl", "sessel", "table", "tisch", "sofa", "regal", "furniture"),
        Category.DRONE to listOf("drone", "drohne", "mavic", "mini-3", "fpv"),
        Category.INSTRUMENT to listOf("guitar", "gitarre", "bass", "piano", "keyboard", "violin"),
    )

    private fun detectCategory(haystack: String): Category? =
        categoryWords.entries.firstOrNull { (_, words) -> words.any { haystack.contains(it) } }?.key

    /**
     * Finds an asking price in text or in a URL slug. Handles Swiss formatting (1'450),
     * thousands separators, and the "1450.-" convention.
     */
    private fun detectPrice(source: String): Long? {
        if (source.isBlank()) return null
        val s = source.lowercase(Locale.ROOT)
        val patterns = listOf(
            Regex("""(?:chf|fr\.?|sfr)\s*([0-9][0-9'’.,\s]{0,12}[0-9]|[0-9])"""),
            Regex("""([0-9][0-9'’.,\s]{0,12}[0-9]|[0-9])\s*(?:chf|fr\.?|sfr|\.-)"""),
            Regex("""(?:price|preis|prix)[=:/-]\s*([0-9][0-9'’.,]{0,12})"""),
        )
        for (p in patterns) {
            val m = p.find(s) ?: continue
            val raw = m.groupValues[1]
            parseAmount(raw)?.let { if (it in 1_00..5_000_000_00) return it }
        }
        // Last resort: a bare number in a URL segment, which marketplaces often include.
        Regex("""[/\-_](\d{2,6})(?:[/\-_.]|$)""").findAll(s).forEach { m ->
            val v = m.groupValues[1].toLongOrNull()
            if (v != null && v in 20..200_000) return v * 100
        }
        return null
    }

    private fun parseAmount(raw: String): Long? {
        val cleaned = raw.replace(Regex("""[\s'’]"""), "")
        // Treat a trailing ",50" or ".50" as cents; everything else as a group separator.
        val centsMatch = Regex("""^(.*)[.,](\d{2})$""").find(cleaned)
        return if (centsMatch != null) {
            val units = centsMatch.groupValues[1].replace(Regex("""[.,]"""), "").toLongOrNull() ?: return null
            units * 100 + centsMatch.groupValues[2].toLong()
        } else {
            val units = cleaned.replace(Regex("""[.,]"""), "").toLongOrNull() ?: return null
            units * 100
        }
    }

    private fun detectYear(haystack: String): Int? =
        Regex("""\b(19[89]\d|20[0-4]\d)\b""").findAll(haystack)
            .mapNotNull { it.groupValues[1].toIntOrNull() }
            .filter { it in 1985..2049 }
            .maxOrNull()

    private fun detectCondition(haystack: String): Condition = when {
        listOf("for parts", "defekt", "ersatzteile", "spares", "broken", "faulty")
            .any { haystack.contains(it) } -> Condition.FOR_PARTS
        listOf("neu ovp", "brand new", "sealed", "ungeoffnet", "originalverpackt")
            .any { haystack.contains(it) } -> Condition.NEW
        listOf("wie neu", "like new", "as new", "neuwertig", "mint", "excellent")
            .any { haystack.contains(it) } -> Condition.LIKE_NEW
        listOf("stark gebraucht", "abgenutzt", "worn", "heavily used", "poor")
            .any { haystack.contains(it) } -> Condition.POOR
        listOf("gebrauchsspuren", "fair", "used with", "kratzer", "scratches")
            .any { haystack.contains(it) } -> Condition.FAIR
        else -> Condition.GOOD
    }

    private val swissPlaces = listOf(
        "zurich", "zürich", "bern", "basel", "geneva", "genève", "lausanne", "luzern",
        "lucerne", "winterthur", "st gallen", "lugano", "biel", "thun", "chur", "zug",
        "fribourg", "neuchatel", "sion", "aarau", "baden", "olten", "wil", "uster",
    )

    private fun detectLocation(haystack: String): String? =
        swissPlaces.firstOrNull { haystack.contains(it) }?.let { titleCase(it) }

    // -- URL helpers -------------------------------------------------------------------------

    private fun extractUrl(text: String): String? =
        Regex("""https?://\S+""").find(text)?.value?.trimEnd('.', ',', ')', '"', '\'')
            ?: Regex("""\bwww\.\S+""").find(text)?.value?.let { "https://$it" }

    private fun hostOf(url: String): String? =
        Regex("""https?://([^/\s:]+)""").find(url)?.groupValues?.get(1)?.removePrefix("www.")?.lowercase()

    private fun sourceNameFor(host: String): String = when {
        host.contains("ricardo") -> "Ricardo"
        host.contains("tutti") -> "Tutti"
        host.contains("anibis") -> "Anibis"
        host.contains("ebay") -> "eBay"
        host.contains("facebook") -> "Facebook Marketplace"
        host.contains("marktplaats") -> "Marktplaats"
        host.contains("leboncoin") -> "leboncoin"
        host.contains("kleinanzeigen") -> "Kleinanzeigen"
        host.contains("subito") -> "Subito"
        host.contains("gumtree") -> "Gumtree"
        host.contains("bikemarkt") || host.contains("buycycle") -> "Bike marketplace"
        else -> host.substringBefore('.').replaceFirstChar { it.uppercase() }
    }

    private fun slugWords(url: String): String =
        url.substringAfter("://").substringAfter('/')
            .replace(Regex("""[?#].*$"""), "")
            .replace(Regex("""[^A-Za-z0-9]+"""), " ")
            .lowercase(Locale.ROOT)
            .trim()

    private fun sameUrl(a: String, b: String): Boolean {
        fun key(u: String) = u.lowercase()
            .removePrefix("https://").removePrefix("http://").removePrefix("www.")
            .substringBefore('?').substringBefore('#').trimEnd('/')
        return a.isNotBlank() && key(a) == key(b)
    }

    private fun buildTitle(brand: String, model: String, year: Int?, displayName: String?): String {
        if (displayName != null) return if (year != null) "$displayName ($year)" else displayName
        val base = listOf(brand.takeIf { it != "Unknown" }, model.takeIf { it != "Unidentified model" })
            .filterNotNull().joinToString(" ")
        val withYear = if (year != null && base.isNotEmpty()) "$base ($year)" else base
        return withYear.ifBlank { "Untitled listing" }
    }

    private fun titleCase(slug: String): String =
        slug.split('-', ' ').filter { it.isNotBlank() }.joinToString(" ") { part ->
            if (part.length <= 3 && part.all { it.isLetter() } && part.uppercase() == part.uppercase()) {
                // Short tokens that are probably designators stay upper: CF, ON, SFF
                if (part.length <= 3) part.uppercase() else part
            } else {
                part.replaceFirstChar { it.uppercase() }
            }
        }
}
