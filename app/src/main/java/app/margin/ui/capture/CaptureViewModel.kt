package app.margin.ui.capture

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.margin.core.format.Money
import app.margin.di.AppContainer
import app.margin.domain.engine.ResolveResult
import app.margin.domain.model.Listing
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ResolvedPreview(
    val listing: Listing,
    val title: String,
    val summary: String,
    val provenanceLabel: String,
    val inferredFields: List<String>,
    val unknownFields: List<String>,
)

data class CaptureError(val title: String, val hint: String)

data class CaptureExample(val label: String, val url: String)

data class CaptureUiState(
    val input: String = "",
    val resolving: Boolean = false,
    val resolved: ResolvedPreview? = null,
    val error: CaptureError? = null,
    val examples: List<CaptureExample> = emptyList(),
)

class CaptureViewModel(
    private val container: AppContainer,
    sharedText: String? = null,
) : ViewModel() {

    private val _state = MutableStateFlow(CaptureUiState())
    val state: StateFlow<CaptureUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            // Examples come from the seeded catalogue, so tapping one demonstrates a real
            // catalogue hit rather than a canned response.
            val catalogue = container.listings.all().take(3)
            _state.update {
                it.copy(
                    examples = catalogue.map { l -> CaptureExample(l.title, l.url) } +
                        CaptureExample(
                            "A link Margin has never seen",
                            "https://www.ricardo.ch/de/a/specialized-allez-sprint-2022-chf-1290-1299887711/",
                        ),
                )
            }
            if (!sharedText.isNullOrBlank()) {
                _state.update { it.copy(input = sharedText) }
                resolve()
            }
        }
    }

    fun setInput(value: String) = _state.update {
        it.copy(input = value, resolved = null, error = null)
    }

    fun useExample(url: String) {
        _state.update { it.copy(input = url, resolved = null, error = null) }
        resolve()
    }

    fun resolve() {
        val input = _state.value.input
        if (input.isBlank()) return
        viewModelScope.launch {
            _state.update { it.copy(resolving = true, error = null, resolved = null) }
            when (val result = container.listingSource.resolve(input, container.now())) {
                is ResolveResult.Known -> _state.update {
                    it.copy(
                        resolving = false,
                        resolved = ResolvedPreview(
                            listing = result.listing,
                            title = result.listing.title,
                            summary = summary(result.listing),
                            provenanceLabel = result.listing.provenance.label,
                            inferredFields = emptyList(),
                            unknownFields = emptyList(),
                        ),
                    )
                }
                is ResolveResult.Inferred -> _state.update {
                    it.copy(
                        resolving = false,
                        resolved = ResolvedPreview(
                            listing = result.listing,
                            title = result.listing.title,
                            summary = summary(result.listing),
                            provenanceLabel = result.listing.provenance.label,
                            inferredFields = result.inferredFields,
                            unknownFields = result.unknownFields,
                        ),
                    )
                }
                is ResolveResult.Unusable -> _state.update {
                    it.copy(
                        resolving = false,
                        error = CaptureError(result.reason, result.hint),
                    )
                }
            }
        }
    }

    fun evaluate(onEvaluated: (String) -> Unit) {
        val resolved = _state.value.resolved ?: return
        viewModelScope.launch {
            val existing = container.listings.byId(resolved.listing.id)
            if (existing == null) {
                container.listings.upsert(resolved.listing, inFeed = true)
            }
            container.coordinator.evaluate(resolved.listing)
            onEvaluated(resolved.listing.id)
        }
    }

    private fun summary(listing: Listing): String = buildString {
        append(listing.sourceName)
        append(" · ")
        append(
            if (listing.askingPriceMinor > 0) Money.format(listing.askingPriceMinor, listing.currency)
            else "no price found"
        )
        append(" · ")
        append(listing.condition.label)
        if (listing.location.isNotBlank()) {
            append(" · ")
            append(listing.location)
        }
    }
}
