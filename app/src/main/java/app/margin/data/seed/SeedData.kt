package app.margin.data.seed

import app.margin.domain.model.Category
import app.margin.domain.model.Condition
import app.margin.domain.model.Decision
import app.margin.domain.model.DecisionType
import app.margin.domain.model.Goal
import app.margin.domain.model.GoalKind
import app.margin.domain.model.Listing
import app.margin.domain.model.OwnedItem
import app.margin.domain.model.OwnedStatus
import app.margin.domain.model.PhotoTask
import app.margin.domain.model.PricePoint
import app.margin.domain.model.Provenance
import app.margin.domain.model.SaleChannel
import app.margin.domain.model.SaleDraft
import app.margin.domain.model.SaleDraftStatus
import app.margin.domain.model.SellerType

/**
 * The demo corpus.
 *
 * Sized deliberately: 3 active goals plus 1 archived, 12 feed listings, 4 owned items and 12
 * decisions. Enough that the ranking is falsifiable and memory has something to remember;
 * few enough that the feed does not become the product and the evaluation screen — the actual
 * centrepiece — still gets opened.
 *
 * Every listing is priced so the seeded goals are genuinely satisfiable. Descriptions are in
 * the register Swiss marketplaces actually use: terse, often German or French, ending in
 * pickup logistics. Two listings are deliberately poor, because risk rules about thin
 * descriptions and few photos are unfalsifiable if every seeded listing is good.
 */
object SeedData {

    private const val DAY = 86_400_000L

    data class Corpus(
        val goals: List<Goal>,
        val feedListings: List<Listing>,
        val historyListings: List<Listing>,
        val decisions: List<Decision>,
        val ownedItems: List<OwnedItem>,
        val saleDrafts: List<SaleDraft>,
    )

    fun build(now: Long): Corpus {
        val goals = goals(now)
        val feed = feedListings(now)
        val history = historyListings(now)
        val owned = ownedItems(now)
        return Corpus(
            goals = goals,
            feedListings = feed,
            historyListings = history,
            decisions = decisions(now),
            ownedItems = owned,
            saleDrafts = saleDrafts(now),
        )
    }

    // -- Goals -------------------------------------------------------------------------------

    private fun goals(now: Long) = listOf(
        Goal(
            id = "goal-egravel",
            title = "E-gravel bike under CHF 1,500",
            kind = GoalKind.BUY,
            category = Category.BIKE,
            budgetMaxMinor = 150_000,
            targetProfitMinMinor = 0,
            keywords = listOf("gravel", "e-bike", "bosch", "pedelec"),
            conditionFloor = Condition.FAIR,
            note = "Ride-ready. Willing to service it, not to rebuild it.",
            createdAtMillis = now - 47 * DAY,
        ),
        Goal(
            id = "goal-pcflip",
            title = "PCs I can flip for CHF 150+ profit",
            kind = GoalKind.FLIP,
            category = Category.PC,
            budgetMaxMinor = 60_000,
            targetProfitMinMinor = 15_000,
            keywords = listOf("optiplex", "elitedesk", "ryzen", "rtx", "sff"),
            conditionFloor = Condition.FAIR,
            note = "Office machines and budget gaming towers. Collect within an hour of Bern.",
            createdAtMillis = now - 41 * DAY,
        ),
        Goal(
            id = "goal-macbook",
            title = "MacBook Air M1 under CHF 550",
            kind = GoalKind.BUY,
            category = Category.LAPTOP,
            budgetMaxMinor = 55_000,
            targetProfitMinMinor = 0,
            keywords = listOf("macbook", "air", "m1"),
            conditionFloor = Condition.GOOD,
            note = "For my sister. Battery health above 85%.",
            createdAtMillis = now - 18 * DAY,
        ),
        Goal(
            id = "goal-festool",
            title = "Festool tools, CHF 100+ profit",
            kind = GoalKind.FLIP,
            category = Category.TOOL,
            budgetMaxMinor = 45_000,
            targetProfitMinMinor = 10_000,
            keywords = listOf("festool", "ts 55", "saw"),
            conditionFloor = Condition.GOOD,
            active = false,
            note = "Paused: too much competition from trade buyers.",
            createdAtMillis = now - 96 * DAY,
        ),
    )

    // -- Feed --------------------------------------------------------------------------------

    private fun feedListings(now: Long) = listOf(

        listing(
            id = "l-riverside", url = "https://www.ricardo.ch/de/a/decathlon-riverside-500-e-gravel-1289345021/",
            source = "Ricardo", title = "Decathlon Riverside 500 E", brand = "Decathlon",
            model = "Riverside 500 E", year = 2021, category = Category.BIKE,
            condition = Condition.GOOD, price = 69_000, location = "Thun",
            seller = SellerType.PRIVATE, rating = 96, listedDaysAgo = 6, images = 6,
            description = "Verkaufe mein Riverside 500 E. Akku ca. 1'400 km, hält gut. " +
                "Neue Kette und Bremsbeläge im Frühling montiert. Kleine Kratzer am Oberrohr, " +
                "siehe Fotos. Grösse M. Nur Abholung, Region Thun.",
            specs = mapOf("battery_health_pct" to "88", "frame_size" to "M", "service_history" to "partial"),
            history = listOf(79_000 to 22, 74_000 to 12, 69_000 to 4), now = now,
        ),

        listing(
            id = "l-flyer", url = "https://www.ricardo.ch/de/a/flyer-gotour6-e-bike-1276554390/",
            source = "Ricardo", title = "Flyer Gotour6", brand = "Flyer",
            model = "Gotour6", year = 2020, category = Category.BIKE,
            condition = Condition.GOOD, price = 119_000, location = "Bern",
            seller = SellerType.PRIVATE, rating = 98, listedDaysAgo = 19, images = 9,
            description = "Flyer Gotour6, Schweizer Qualität aus Huttwil. Gekauft 2020 bei " +
                "Velo Bern, Serviceheft vollständig. Motor letztes Jahr ersetzt (Garantie). " +
                "Akku 500Wh, Reichweite immer noch ca. 70 km. Rahmen L. Abholung Bern oder Thun.",
            specs = mapOf("battery_health_pct" to "84", "frame_size" to "L", "service_history" to "full"),
            history = listOf(129_000 to 19, 119_000 to 5), now = now,
        ),

        listing(
            id = "l-cube-nuroad", url = "https://www.tutti.ch/de/vi/bern/velo/cube-nuroad-hybrid/4429183",
            source = "Tutti", title = "Cube Nuroad Hybrid C:62", brand = "Cube",
            model = "Nuroad Hybrid C:62", year = 2021, category = Category.BIKE,
            condition = Condition.GOOD, price = 145_000, location = "Luzern",
            seller = SellerType.PRIVATE, rating = 94, listedDaysAgo = 3, images = 5,
            description = "Cube Nuroad Hybrid C:62, Carbon, Bosch Performance. Wenig gefahren, " +
                "ca. 2'100 km. Winterpause im Keller, daher Verkauf. Rahmen 56. " +
                "Original-Rechnung vorhanden. Abholung in Luzern, Versand möglich.",
            specs = mapOf("battery_health_pct" to "91", "frame_size" to "56", "service_history" to "full"),
            history = listOf(145_000 to 3), now = now,
        ),

        listing(
            id = "l-canyon-over", url = "https://www.ricardo.ch/de/a/canyon-grail-on-cf-7-1291002884/",
            source = "Ricardo", title = "Canyon Grail:ON CF 7", brand = "Canyon",
            model = "Grail:ON CF 7", year = 2021, category = Category.BIKE,
            condition = Condition.LIKE_NEW, price = 189_000, location = "Zürich",
            seller = SellerType.PRIVATE, rating = 99, listedDaysAgo = 24, images = 11,
            description = "Canyon Grail:ON CF 7, Zustand wie neu, ca. 900 km. " +
                "Bosch Performance Line CX, 504 Wh. Zweiter Akku und Ladegerät dabei. " +
                "Rahmengrösse M. Immer trocken gelagert, Serviceheft komplett. Abholung Zürich.",
            specs = mapOf("battery_health_pct" to "95", "frame_size" to "M", "service_history" to "full"),
            history = listOf(189_000 to 24), now = now,
        ),

        listing(
            id = "l-canyon-battery", url = "https://www.anibis.ch/de/c/velos-e-bikes/canyon-grail-on-9931882",
            source = "Anibis", title = "Canyon Grail:ON CF 7", brand = "Canyon",
            model = "Grail:ON CF 7", year = 2021, category = Category.BIKE,
            condition = Condition.FAIR, price = 129_000, location = "Winterthur",
            seller = SellerType.PRIVATE, rating = 91, listedDaysAgo = 31, images = 4,
            description = "Grail:ON CF 7, viel gefahren (Pendler). Akku zeigt noch 61% " +
                "Gesundheit laut Bosch-Diagnose, sollte ersetzt werden. Bremsen und Kette neu. " +
                "Rahmen M. Preis ist verhandelbar. Abholung Winterthur.",
            specs = mapOf("battery_health_pct" to "61", "frame_size" to "M", "service_history" to "partial"),
            history = listOf(149_000 to 31, 139_000 to 16, 129_000 to 6), now = now,
        ),

        listing(
            id = "l-ryzen", url = "https://www.ricardo.ch/de/a/gaming-pc-ryzen-5-5600-rtx-3060-1290887712/",
            source = "Ricardo", title = "Gaming PC Ryzen 5 5600 + RTX 3060", brand = "Custom",
            model = "Ryzen 5 5600 RTX 3060", year = 2021, category = Category.PC,
            condition = Condition.GOOD, price = 37_500, location = "Luzern",
            seller = SellerType.PRIVATE, rating = 97, listedDaysAgo = 2, images = 8,
            description = "Selbstgebauter Gaming-PC. Ryzen 5 5600, RTX 3060 12GB, 16GB DDR4, " +
                "512GB NVMe, be quiet! 550W. Läuft einwandfrei. Grafikkarte hat leichtes " +
                "Spulenfiepen unter Last, stört mich nicht, erwähne es aber. Windows 11 " +
                "frisch installiert. Abholung Luzern oder Versand.",
            specs = mapOf("gpu" to "RTX 3060 12GB", "cpu" to "Ryzen 5 5600", "ram" to "16GB", "storage" to "512GB NVMe"),
            history = listOf(37_500 to 2), now = now,
        ),

        listing(
            id = "l-elitedesk", url = "https://www.ricardo.ch/de/a/hp-elitedesk-800-g6-sff-1288120945/",
            source = "Ricardo", title = "HP EliteDesk 800 G6 SFF", brand = "HP",
            model = "EliteDesk 800 G6", year = 2020, category = Category.PC,
            condition = Condition.GOOD, price = 9_500, location = "Basel",
            seller = SellerType.DEALER, rating = 95, listedDaysAgo = 9, images = 4,
            description = "Aus Geschäftsauflösung. HP EliteDesk 800 G6 SFF, i5-10500, 16GB RAM, " +
                "256GB SSD, Windows 11 Pro. Getestet und zurückgesetzt. Mehrere Stück " +
                "verfügbar. Rechnung mit MwSt. Abholung Basel oder Versand CHF 12.",
            specs = mapOf("cpu" to "i5-10500", "ram" to "16GB", "storage" to "256GB SSD"),
            history = listOf(11_000 to 9, 9_500 to 2), now = now,
        ),

        listing(
            id = "l-optiplex-dear", url = "https://www.ricardo.ch/de/a/dell-optiplex-7080-sff-1290334561/",
            source = "Ricardo", title = "Dell OptiPlex 7080 SFF", brand = "Dell",
            model = "OptiPlex 7080 SFF", year = 2020, category = Category.PC,
            condition = Condition.GOOD, price = 24_000, location = "Zürich",
            seller = SellerType.PRIVATE, rating = 93, listedDaysAgo = 12, images = 5,
            description = "Dell OptiPlex 7080 SFF, i7-10700, 16GB RAM, 512GB SSD. " +
                "Lief als Homeoffice-Rechner, wenig Stunden. Windows 11 Pro aktiviert. " +
                "Sehr leise. Abholung Zürich Altstetten.",
            specs = mapOf("cpu" to "i7-10700", "ram" to "16GB", "storage" to "512GB SSD"),
            history = listOf(24_000 to 12), now = now,
        ),

        // Deliberately poor listing: three lines, two photos, weak seller rating.
        listing(
            id = "l-optiplex-thin", url = "https://www.anibis.ch/fr/c/informatique/dell-optiplex-9928471",
            source = "Anibis", title = "Dell OptiPlex 7080", brand = "Dell",
            model = "OptiPlex 7080 SFF", year = 2020, category = Category.PC,
            condition = Condition.FAIR, price = 16_500, location = "Genève",
            seller = SellerType.PRIVATE, rating = 71, listedDaysAgo = 44, images = 2,
            description = "PC Dell fonctionne bien. Sans disque dur. A prendre sur place Genève.",
            specs = mapOf("cpu" to "i7-10700", "ram" to "16GB", "missing" to "no storage drive"),
            history = listOf(19_000 to 44, 16_500 to 21), now = now,
        ),

        listing(
            id = "l-macbook", url = "https://www.tutti.ch/fr/vi/geneve/informatique/macbook-air-m1/4431902",
            source = "Tutti", title = "MacBook Air M1 8/256", brand = "Apple",
            model = "MacBook Air M1", year = 2020, category = Category.LAPTOP,
            condition = Condition.GOOD, price = 52_000, location = "Lausanne",
            seller = SellerType.PRIVATE, rating = 97, listedDaysAgo = 8, images = 7,
            description = "MacBook Air M1 2020, 8 Go RAM, 256 Go SSD, gris sidéral. " +
                "Santé batterie 89%, 214 cycles. Quelques micro-rayures sur le dessus, " +
                "écran impeccable. Chargeur d'origine inclus. Remise en main propre à " +
                "Lausanne, envoi possible.",
            specs = mapOf("battery_health_pct" to "89", "ram" to "8GB", "storage" to "256GB"),
            history = listOf(56_000 to 8, 52_000 to 2), now = now,
        ),

        // Deliberately poor listing: cheap, thin, few photos, low rating.
        listing(
            id = "l-macbook-risky", url = "https://www.tutti.ch/de/vi/zuerich/informatike/macbook-air/4428771",
            source = "Tutti", title = "MacBook Air M1", brand = "Apple",
            model = "MacBook Air M1", year = 2020, category = Category.LAPTOP,
            condition = Condition.FAIR, price = 39_500, location = "Zürich",
            seller = SellerType.UNKNOWN, rating = 78, listedDaysAgo = 5, images = 2,
            description = "MacBook Air M1, funktioniert. Delle am Gehäuse. Kein Ladegerät.",
            specs = mapOf("battery_health_pct" to "74", "missing" to "charger"),
            history = listOf(39_500 to 5), now = now,
        ),

        listing(
            id = "l-fuji", url = "https://www.ricardo.ch/de/a/fujifilm-x-t4-body-1289773310/",
            source = "Ricardo", title = "Fujifilm X-T4 Body", brand = "Fujifilm",
            model = "X-T4 body", year = 2020, category = Category.CAMERA,
            condition = Condition.GOOD, price = 129_000, location = "Zürich",
            seller = SellerType.PRIVATE, rating = 92, listedDaysAgo = 27, images = 6,
            description = "Fujifilm X-T4 Body, schwarz. Auslösungen ca. 24'000. " +
                "Zwei Akkus, Ladegerät, Originalkarton. Kleine Gebrauchsspuren am Boden. " +
                "Umstieg auf Vollformat, daher Verkauf. Abholung Zürich oder Versand.",
            specs = mapOf("shutter_count" to "24000", "service_history" to "none"),
            history = listOf(129_000 to 27), now = now,
        ),
    )

    // -- History: the listings behind the seeded decision record ------------------------------

    private fun historyListings(now: Long) = listOf(
        listing(
            id = "h-canyon-1", url = "https://www.ricardo.ch/de/a/canyon-grail-on-cf-7-1271004411/",
            source = "Ricardo", title = "Canyon Grail:ON CF 7", brand = "Canyon",
            model = "Grail:ON CF 7", year = 2021, category = Category.BIKE,
            condition = Condition.LIKE_NEW, price = 245_000, location = "Zug",
            seller = SellerType.PRIVATE, rating = 98, listedDaysAgo = 44, images = 8,
            description = "Canyon Grail:ON CF 7, top Zustand. Abholung Zug.",
            specs = mapOf("battery_health_pct" to "94"), history = listOf(245_000 to 44), now = now,
        ),
        listing(
            id = "h-canyon-2", url = "https://www.tutti.ch/de/vi/aargau/velo/canyon-grail-on/4402118",
            source = "Tutti", title = "Canyon Grail:ON CF 7", brand = "Canyon",
            model = "Grail:ON CF 7", year = 2021, category = Category.BIKE,
            condition = Condition.GOOD, price = 229_000, location = "Aarau",
            seller = SellerType.PRIVATE, rating = 90, listedDaysAgo = 33, images = 5,
            description = "Grail:ON, guter Zustand, Rahmengrösse unklar. Abholung Aarau.",
            specs = mapOf("battery_health_pct" to "88"), history = listOf(229_000 to 33), now = now,
        ),
        listing(
            id = "h-canyon-3", url = "https://www.ricardo.ch/de/a/canyon-grail-on-cf-7-1279884120/",
            source = "Ricardo", title = "Canyon Grail:ON CF 7", brand = "Canyon",
            model = "Grail:ON CF 7", year = 2020, category = Category.BIKE,
            condition = Condition.GOOD, price = 238_000, location = "Basel",
            seller = SellerType.PRIVATE, rating = 95, listedDaysAgo = 26, images = 7,
            description = "Grail:ON CF 7, Akku etwas schwach. Abholung Basel.",
            specs = mapOf("battery_health_pct" to "61"), history = listOf(238_000 to 26), now = now,
        ),
        listing(
            id = "h-cube-bought", url = "https://www.ricardo.ch/de/a/cube-nuroad-hybrid-1268990234/",
            source = "Ricardo", title = "Cube Nuroad Hybrid C:62", brand = "Cube",
            model = "Nuroad Hybrid C:62", year = 2021, category = Category.BIKE,
            condition = Condition.GOOD, price = 162_000, location = "Bern",
            seller = SellerType.PRIVATE, rating = 96, listedDaysAgo = 101, images = 9,
            description = "Cube Nuroad Hybrid C:62, Serviceheft komplett. Abholung Bern.",
            specs = mapOf("battery_health_pct" to "93"), history = listOf(179_000 to 101, 162_000 to 96), now = now,
        ),
        listing(
            id = "h-optiplex-1", url = "https://www.ricardo.ch/de/a/dell-optiplex-7080-1274430912/",
            source = "Ricardo", title = "Dell OptiPlex 7080 SFF", brand = "Dell",
            model = "OptiPlex 7080 SFF", year = 2020, category = Category.PC,
            condition = Condition.GOOD, price = 24_000, location = "Bern",
            seller = SellerType.PRIVATE, rating = 94, listedDaysAgo = 38, images = 4,
            description = "OptiPlex 7080, i7, 16GB. Abholung Bern.",
            specs = mapOf("cpu" to "i7-10700"), history = listOf(24_000 to 38), now = now,
        ),
        listing(
            id = "h-optiplex-2", url = "https://www.tutti.ch/de/vi/bern/informatik/dell-optiplex/4411002",
            source = "Tutti", title = "Dell OptiPlex 7080 SFF", brand = "Dell",
            model = "OptiPlex 7080 SFF", year = 2020, category = Category.PC,
            condition = Condition.GOOD, price = 26_000, location = "Thun",
            seller = SellerType.PRIVATE, rating = 89, listedDaysAgo = 29, images = 3,
            description = "OptiPlex 7080 SFF, wenig gebraucht. Abholung Thun.",
            specs = mapOf("cpu" to "i7-10700"), history = listOf(26_000 to 29), now = now,
        ),
        listing(
            id = "h-ryzen-bought", url = "https://www.ricardo.ch/de/a/gaming-pc-ryzen-5-5600-1266112087/",
            source = "Ricardo", title = "Gaming PC Ryzen 5 5600 + RTX 3060", brand = "Custom",
            model = "Ryzen 5 5600 RTX 3060", year = 2021, category = Category.PC,
            condition = Condition.GOOD, price = 35_500, location = "Bern",
            seller = SellerType.PRIVATE, rating = 96, listedDaysAgo = 68, images = 6,
            description = "Gaming-PC Ryzen 5 5600 mit RTX 3060. Abholung Bern.",
            specs = mapOf("gpu" to "RTX 3060 12GB"), history = listOf(35_500 to 68), now = now,
        ),
    )

    // -- Decisions ------------------------------------------------------------------------------

    private fun decisions(now: Long) = listOf(
        decision("d-1", "h-canyon-1", DecisionType.REJECT, "Overpriced",
            "Priced like a one-year-old bike. It is three.", 43, now),
        decision("d-2", "h-canyon-2", DecisionType.REJECT, "Seller unclear",
            "Would not confirm the frame size. Not travelling to Aarau on a maybe.", 32, now),
        decision("d-3", "h-canyon-3", DecisionType.REJECT, "Battery",
            "61% battery health at that price is someone else's problem.", 25, now),
        decision("d-4", "h-cube-bought", DecisionType.BOUGHT, "Good price",
            "Full service history, CHF 430 under fair. Collected in Bern.", 95, now),
        decision("d-5", "h-optiplex-1", DecisionType.REJECT, "No margin",
            "Nothing left after refurbishment at this asking price.", 37, now),
        decision("d-6", "h-optiplex-2", DecisionType.REJECT, "No margin",
            "Same machine, dearer. Pass.", 28, now),
        decision("d-7", "h-ryzen-bought", DecisionType.BOUGHT, "Clears target",
            "Flipped in three weeks. Worked exactly as modelled.", 64, now),
        decision("d-8", "l-flyer", DecisionType.WATCH, "Waiting on price",
            "Swiss-built and serviced. Waiting to see if it drops under CHF 1,150.", 14, now),
        decision("d-9", "l-macbook", DecisionType.WATCH, "Close to budget",
            "Battery 89% is fine. CHF 30 under budget already.", 9, now),
        decision("d-10", "l-canyon-over", DecisionType.WATCH, "Over budget",
            "Best condition I have seen, but CHF 390 over what I said I would spend.", 20, now),
        decision("d-11", "l-elitedesk", DecisionType.WATCH, "Thin margin",
            "Dealer stock, several available. Worth asking for a two-unit price.", 7, now),
        decision("d-12", "l-fuji", DecisionType.WATCH, "Not a goal",
            "Not chasing cameras, but I know this body sells.", 4, now),
    )

    private fun decision(
        id: String, listingId: String, type: DecisionType, reason: String,
        note: String, daysAgo: Int, now: Long,
    ) = Decision(
        id = id, listingId = listingId, type = type, reason = reason, note = note,
        createdAtMillis = now - daysAgo * DAY,
    )

    // -- Owned ----------------------------------------------------------------------------------

    private fun ownedItems(now: Long) = listOf(
        // Bought well below fair value, so it is ahead despite depreciating.
        OwnedItem(
            id = "o-cube", listingId = "h-cube-bought",
            title = "Cube Nuroad Hybrid C:62", brand = "Cube", category = Category.BIKE,
            condition = Condition.GOOD,
            purchasePriceMinor = 162_000, purchasedAtMillis = now - 96 * DAY,
            currentValueMinor = 193_400, status = OwnedStatus.OWNED,
            year = 2021, note = "Daily ride. Serviced in May.",
            predictedNetMinor = 21_000, fairValueAtPurchaseMinor = 205_000,
        ),
        // Bought slightly above fair value. A loss on screen is worth more than any feature.
        OwnedItem(
            id = "o-sonos", listingId = null,
            title = "Sonos Five", brand = "Sonos", category = Category.AUDIO,
            condition = Condition.GOOD,
            purchasePriceMinor = 38_000, purchasedAtMillis = now - 240 * DAY,
            currentValueMinor = 32_300, status = OwnedStatus.OWNED,
            year = 2020, note = "Paid over the odds in a hurry. Keeping it.",
            predictedNetMinor = -4_000, fairValueAtPurchaseMinor = 36_000,
        ),
        OwnedItem(
            id = "o-macbook", listingId = null,
            title = "MacBook Air M1 8/256", brand = "Apple", category = Category.LAPTOP,
            condition = Condition.GOOD,
            purchasePriceMinor = 43_000, purchasedAtMillis = now - 122 * DAY,
            currentValueMinor = 47_900, status = OwnedStatus.LISTED,
            year = 2020, note = "Listed on Ricardo, no offers yet.",
            predictedNetMinor = 6_500, fairValueAtPurchaseMinor = 52_000,
        ),
        OwnedItem(
            id = "o-ryzen-sold", listingId = "h-ryzen-bought",
            title = "Gaming PC Ryzen 5 5600 + RTX 3060", brand = "Custom", category = Category.PC,
            condition = Condition.GOOD,
            purchasePriceMinor = 35_500, purchasedAtMillis = now - 68 * DAY,
            currentValueMinor = 0, status = OwnedStatus.SOLD,
            soldPriceMinor = 61_500, soldAtMillis = now - 47 * DAY,
            year = 2021, note = "Sold in 21 days on Ricardo. Cleaned it and added a 1TB drive.",
            predictedNetMinor = 18_800, fairValueAtPurchaseMinor = 60_000,
        ),
    )

    private fun saleDrafts(now: Long) = listOf(
        SaleDraft(
            id = "sd-macbook", ownedItemId = "o-macbook",
            channel = SaleChannel.LOCAL_MARKETPLACE,
            askPriceMinor = 52_500, floorPriceMinor = 45_000, quickSalePriceMinor = 47_500,
            title = "MacBook Air M1 (2020) 8 GB / 256 GB — battery 91%",
            body = "MacBook Air M1 from 2020, 8 GB RAM and a 256 GB SSD, space grey.\n\n" +
                "Battery health 91% over 168 cycles. Screen is unmarked; there are two small " +
                "scuffs on the underside, photographed below.\n\n" +
                "Comes with the original 30W charger and the box. Reset to factory settings, " +
                "signed out of iCloud.\n\n" +
                "Collection in Bern, or I can post it insured for CHF 12.",
            photoTasks = photoTasks(done = setOf("front", "screen", "ports")),
            status = SaleDraftStatus.DRAFT,
            createdAtMillis = now - 11 * DAY,
        ),
    )

    fun photoTasks(done: Set<String> = emptySet()) = listOf(
        PhotoTask("front", "Front, screen on", "Proves it powers up and the panel is clean", "front" in done),
        PhotoTask("screen", "Screen at an angle", "Shows scratches that a straight-on shot hides", "screen" in done),
        PhotoTask("ports", "Ports and edges", "Buyers look for drop damage here first", "ports" in done),
        PhotoTask("wear", "Every mark you mentioned", "Photographing flaws stops the haggling later", "wear" in done),
        PhotoTask("serial", "Serial number", "Reassures buyers it is not stolen", "serial" in done),
        PhotoTask("extras", "Charger and box", "Accessories are worth real money", "extras" in done),
    )

    // -- Helper ------------------------------------------------------------------------------------

    private fun listing(
        id: String, url: String, source: String, title: String, brand: String, model: String,
        year: Int?, category: Category, condition: Condition, price: Long, location: String,
        seller: SellerType, rating: Int?, listedDaysAgo: Int, images: Int,
        description: String, specs: Map<String, String>,
        history: List<Pair<Long, Int>>,
        now: Long,
    ): Listing = Listing(
        id = id,
        url = url,
        sourceName = source,
        provenance = Provenance.SEEDED,
        title = title,
        brand = brand,
        model = model,
        year = year,
        category = category,
        condition = condition,
        askingPriceMinor = price,
        location = location,
        sellerType = seller,
        sellerRatingPct = rating,
        listedAtMillis = now - listedDaysAgo * DAY,
        description = description,
        specs = specs,
        imageCount = images,
        capturedAtMillis = now,
        priceHistory = history.map { (p, daysAgo) -> PricePoint(p, now - daysAgo * DAY) },
    )
}
