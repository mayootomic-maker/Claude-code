package app.margin.domain.engine

import app.margin.domain.model.Category
import app.margin.domain.model.Comp
import app.margin.domain.model.Condition
import app.margin.domain.model.MarketKey

/**
 * The local market model: the app's substitute for a pricing API.
 *
 * Replacing it with a live service means implementing [MarketDataSource]; nothing above this
 * interface changes.
 */
interface MarketDataSource {
    fun lookup(category: Category, brand: String, model: String): MarketModel?
    fun categoryDefaults(category: Category): CategoryProfile
    fun categoryAnchor(category: Category): Long?
}

data class MarketModel(
    val key: String,
    val displayName: String,
    val category: Category,
    val newPriceMinor: Long,
    /** Calendar year and 1-based month the product went on sale. Comps are validated against it. */
    val releasedYear: Int,
    val releasedMonth: Int,
    val annualDepreciation: Double,
    val floorFraction: Double,
    /** 0..1: how quickly this sells at a fair price. */
    val liquidity: Double,
    val comps: List<Comp>,
) {
    fun ageMonthsAt(year: Int, month1Based: Int): Int =
        ((year - releasedYear) * 12 + (month1Based - releasedMonth)).coerceAtLeast(0)
}

data class CategoryProfile(
    val category: Category,
    val annualDepreciation: Double,
    val floorFraction: Double,
    val liquidity: Double,
    /** Cost to bring a FAIR item up to GOOD. */
    val refurbToGoodMinor: Long,
    /** Transport/handling for a local pickup. */
    val logisticsMinor: Long,
)

object CategoryProfiles {
    private val table = listOf(
        CategoryProfile(Category.BIKE, 0.17, 0.20, 0.72, 18_000, 3_000),
        // A 512GB NVMe plus 8GB of DDR4 is CHF 40-45 in Switzerland, not CHF 90. The old
        // figure made thin office-PC flips structurally impossible.
        CategoryProfile(Category.PC, 0.26, 0.12, 0.83, 4_500, 1_000),
        CategoryProfile(Category.LAPTOP, 0.28, 0.10, 0.86, 6_000, 1_000),
        CategoryProfile(Category.CAMERA, 0.14, 0.24, 0.66, 12_000, 1_500),
        CategoryProfile(Category.PHONE, 0.32, 0.09, 0.91, 6_000, 800),
        CategoryProfile(Category.AUDIO, 0.15, 0.26, 0.61, 7_000, 1_500),
        CategoryProfile(Category.WATCH, 0.06, 0.55, 0.48, 22_000, 800),
        CategoryProfile(Category.TOOL, 0.16, 0.25, 0.70, 5_000, 1_500),
        CategoryProfile(Category.FURNITURE, 0.11, 0.30, 0.44, 9_000, 6_000),
        CategoryProfile(Category.DRONE, 0.29, 0.14, 0.64, 9_000, 1_000),
        CategoryProfile(Category.INSTRUMENT, 0.08, 0.42, 0.52, 14_000, 3_000),
    ).associateBy { it.category }

    val fallback = CategoryProfile(Category.OTHER, 0.20, 0.20, 0.60, 8_000, 2_000)

    fun of(category: Category): CategoryProfile = table[category] ?: fallback
    fun all(): List<CategoryProfile> = table.values.toList()
}

/**
 * The shipped market table.
 *
 * Every model here is load-bearing: it backs a seeded goal, a feed listing or an owned item.
 * Comp prices are deliberately uneven and include one condition inversion per model with a
 * stated reason, because real comparable sets are not monotone by condition.
 *
 * Only Ricardo publishes realised sale prices in Switzerland. Comps sourced from tutti and
 * Anibis are labelled as asking prices or delistings, never as sales.
 */
class SeededMarketData : MarketDataSource {

    private val models: Map<String, MarketModel> = listOf(

        // --- Bikes: the "e-gravel under CHF 1,500" goal needs a floor as well as a ceiling ---

        model(
            Category.BIKE, "Decathlon", "Riverside 500 E", "Decathlon Riverside 500 E",
            newPrice = 179_900, released = 2021 to 3, dep = 0.21, floor = 0.18, liquidity = 0.76,
            comps = listOf(
                comp("Ricardo, sold", 78_400, Condition.GOOD, 62, 11),
                comp("Ricardo, sold", 69_150, Condition.FAIR, 65, 24),
                comp("tutti, delisted after 9 days", 85_000, Condition.LIKE_NEW, 58, 31),
                comp("Ricardo, sold with spare battery", 92_600, Condition.GOOD, 61, 19),
                comp("Anibis, asking", 74_900, Condition.GOOD, 63, 46),
            ),
        ),
        model(
            Category.BIKE, "Flyer", "Gotour6", "Flyer Gotour6 (Huttwil)",
            newPrice = 349_900, released = 2020 to 4, dep = 0.16, floor = 0.24, liquidity = 0.63,
            comps = listOf(
                comp("Ricardo, sold", 132_000, Condition.GOOD, 73, 16),
                comp("Ricardo, sold", 148_500, Condition.LIKE_NEW, 69, 28),
                comp("tutti, delisted after 21 days", 119_000, Condition.FAIR, 76, 40),
                comp("Ricardo, sold, new motor fitted", 156_200, Condition.GOOD, 74, 22),
                comp("Anibis, asking", 139_000, Condition.GOOD, 72, 51),
            ),
        ),
        model(
            Category.BIKE, "Cube", "Nuroad Hybrid C:62", "Cube Nuroad Hybrid C:62",
            newPrice = 379_900, released = 2021 to 6, dep = 0.19, floor = 0.20, liquidity = 0.66,
            comps = listOf(
                comp("Ricardo, sold", 164_300, Condition.GOOD, 59, 15),
                comp("tutti, delisted after 14 days", 149_000, Condition.FAIR, 62, 30),
                comp("Ricardo, sold", 182_700, Condition.LIKE_NEW, 55, 44),
                comp("Ricardo, sold", 158_450, Condition.GOOD, 61, 37),
            ),
        ),
        model(
            Category.BIKE, "Canyon", "Grail:ON CF 7", "Canyon Grail:ON CF 7",
            newPrice = 449_900, released = 2021 to 2, dep = 0.19, floor = 0.20, liquidity = 0.70,
            comps = listOf(
                comp("Ricardo, sold", 189_000, Condition.GOOD, 64, 12),
                comp("Ricardo, sold, second battery included", 218_400, Condition.GOOD, 63, 19),
                comp("tutti, delisted after 6 days", 205_000, Condition.LIKE_NEW, 60, 21),
                comp("Ricardo, sold", 172_600, Condition.GOOD, 66, 34),
                comp("Anibis, asking", 196_500, Condition.GOOD, 65, 55),
            ),
        ),

        // --- Desktop PCs: the flip goal. Three machines, three different answers. ---

        model(
            Category.PC, "Custom", "Ryzen 5 5600 RTX 3060", "Ryzen 5 5600 + RTX 3060 desktop",
            newPrice = 129_000, released = 2021 to 4, dep = 0.24, floor = 0.15, liquidity = 0.86,
            comps = listOf(
                comp("Ricardo, sold", 62_100, Condition.GOOD, 61, 6),
                comp("Ricardo, sold", 68_500, Condition.LIKE_NEW, 58, 13),
                comp("tutti, delisted after 4 days", 57_000, Condition.GOOD, 63, 24),
                comp("Ricardo, sold, 32GB fitted", 71_800, Condition.GOOD, 60, 17),
                comp("Ricardo, sold", 54_450, Condition.FAIR, 64, 33),
            ),
        ),
        model(
            Category.PC, "Dell", "OptiPlex 7080 SFF", "Dell OptiPlex 7080 SFF",
            newPrice = 119_000, released = 2020 to 5, dep = 0.30, floor = 0.10, liquidity = 0.88,
            comps = listOf(
                comp("Ricardo, sold", 21_800, Condition.GOOD, 72, 5),
                comp("Ricardo, sold", 20_450, Condition.GOOD, 74, 14),
                comp("tutti, delisted after 11 days", 24_900, Condition.LIKE_NEW, 70, 22),
                comp("Ricardo, sold with 1TB SSD", 25_300, Condition.GOOD, 71, 9),
                comp("Business clearance lot, per unit", 18_200, Condition.FAIR, 75, 36),
            ),
        ),
        model(
            Category.PC, "HP", "EliteDesk 800 G6", "HP EliteDesk 800 G6",
            newPrice = 109_000, released = 2020 to 6, dep = 0.31, floor = 0.10, liquidity = 0.87,
            comps = listOf(
                comp("Ricardo, sold", 19_650, Condition.GOOD, 71, 8),
                comp("Ricardo, sold", 21_200, Condition.GOOD, 70, 19),
                comp("tutti, delisted after 17 days", 16_000, Condition.FAIR, 73, 31),
                comp("Ricardo, sold", 23_400, Condition.LIKE_NEW, 69, 42),
            ),
        ),

        // --- One laptop goal, one owned speaker, one deliberately off-goal camera ---

        model(
            Category.LAPTOP, "Apple", "MacBook Air M1", "MacBook Air M1 8/256",
            newPrice = 119_900, released = 2020 to 11, dep = 0.22, floor = 0.16, liquidity = 0.92,
            comps = listOf(
                comp("Ricardo, sold", 52_300, Condition.GOOD, 66, 4),
                comp("Ricardo, sold", 58_100, Condition.LIKE_NEW, 63, 12),
                comp("tutti, delisted after 3 days", 49_500, Condition.GOOD, 67, 26),
                comp("Ricardo, sold, 92% battery", 56_400, Condition.GOOD, 65, 15),
                comp("Ricardo, sold", 44_200, Condition.FAIR, 68, 39),
            ),
        ),
        model(
            Category.AUDIO, "Sonos", "Five", "Sonos Five",
            newPrice = 64_900, released = 2020 to 6, dep = 0.15, floor = 0.28, liquidity = 0.61,
            comps = listOf(
                comp("Ricardo, sold", 36_200, Condition.GOOD, 71, 7),
                comp("tutti, delisted after 28 days", 41_000, Condition.LIKE_NEW, 68, 18),
                comp("Anibis, asking", 32_450, Condition.GOOD, 73, 33),
                comp("Ricardo, sold, boxed", 39_900, Condition.GOOD, 70, 25),
            ),
        ),
        model(
            Category.CAMERA, "Fujifilm", "X-T4 body", "Fujifilm X-T4 body",
            newPrice = 189_900, released = 2020 to 2, dep = 0.14, floor = 0.26, liquidity = 0.66,
            comps = listOf(
                comp("Ricardo, sold", 84_600, Condition.GOOD, 76, 10),
                comp("Specialist dealer, sold", 96_000, Condition.LIKE_NEW, 73, 20),
                comp("tutti, delisted after 12 days", 79_100, Condition.GOOD, 77, 35),
                comp("Ricardo, sold, shutter 8k", 91_200, Condition.GOOD, 75, 14),
            ),
        ),
    ).associateBy { it.key }

    override fun lookup(category: Category, brand: String, model: String): MarketModel? {
        models[MarketKey.of(category.slug, brand, model)]?.let { return it }
        // A Canyon Grail still says something useful about a Canyon Endurace.
        val catBrand = "${category.slug}:${MarketKey.norm(brand)}:"
        return models.entries.firstOrNull { it.key.startsWith(catBrand) }?.value
    }

    override fun categoryDefaults(category: Category): CategoryProfile = CategoryProfiles.of(category)

    /** Median new price of the models known for a category; a weak anchor of last resort. */
    override fun categoryAnchor(category: Category): Long? =
        models.values.filter { it.category == category }
            .map { it.newPriceMinor }
            .sorted()
            .takeIf { it.isNotEmpty() }
            ?.let { it[it.size / 2] }

    fun all(): List<MarketModel> = models.values.toList()

    private fun model(
        category: Category, brand: String, model: String, displayName: String,
        newPrice: Long, released: Pair<Int, Int>, dep: Double, floor: Double,
        liquidity: Double, comps: List<Comp>,
    ) = MarketModel(
        key = MarketKey.of(category.slug, brand, model),
        displayName = displayName,
        category = category,
        newPriceMinor = newPrice,
        releasedYear = released.first,
        releasedMonth = released.second,
        annualDepreciation = dep,
        floorFraction = floor,
        liquidity = liquidity,
        comps = comps,
    )

    private fun comp(source: String, price: Long, condition: Condition, ageMonths: Int, soldDaysAgo: Int) =
        Comp(
            label = source, priceMinor = price, conditionName = condition.name,
            ageMonths = ageMonths, soldDaysAgo = soldDaysAgo, source = source,
        )
}
