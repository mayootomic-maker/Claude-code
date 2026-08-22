package app.margin.ui.capture

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.margin.core.design.ErrorState
import app.margin.core.design.IconAction
import app.margin.core.design.MarginField
import app.margin.core.design.MarginTheme
import app.margin.core.design.PrimaryAction
import app.margin.core.design.SecondaryAction
import app.margin.core.design.SkeletonBlock
import app.margin.core.design.Space
import app.margin.core.design.StatusLabel

@Composable
fun CaptureScreen(
    viewModel: CaptureViewModel,
    onBack: () -> Unit,
    onEvaluated: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val c = MarginTheme.colors

    Column(modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            IconAction(Icons.AutoMirrored.Outlined.ArrowBack, "Back", onBack)
            Text(
                "Evaluate a listing",
                style = MarginTheme.type.heading,
                color = c.inkStrong,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(Space.lg))
        }

        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = Space.screenH),
        ) {
            Spacer(Modifier.height(Space.sm))
            Text(
                "Paste a marketplace link, or share one to Margin from any app. " +
                    "Everything is read on the device — nothing is sent anywhere.",
                style = MarginTheme.type.body,
                color = c.inkMuted,
            )
            Spacer(Modifier.height(Space.xl))

            MarginField(
                value = state.input,
                onValueChange = viewModel::setInput,
                label = "Link or advert text",
                placeholder = "https://www.ricardo.ch/de/a/...",
                singleLine = false,
                minHeight = 96.dp,
            )

            if (state.resolving) {
                Spacer(Modifier.height(Space.xl))
                repeat(3) { i ->
                    SkeletonBlock(height = 16.dp, widthFraction = 0.85f - i * 0.15f, index = i)
                    Spacer(Modifier.height(Space.sm))
                }
            }

            state.error?.let { error ->
                Spacer(Modifier.height(Space.lg))
                ErrorState(
                    title = error.title,
                    body = error.hint,
                    modifier = Modifier.padding(horizontal = 0.dp),
                )
            }

            state.resolved?.let { resolved ->
                Spacer(Modifier.height(Space.xl))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        resolved.title,
                        style = MarginTheme.type.heading,
                        color = c.inkStrong,
                        modifier = Modifier.weight(1f),
                    )
                    StatusLabel(resolved.provenanceLabel)
                }
                Spacer(Modifier.height(Space.sm))
                Text(
                    resolved.summary,
                    style = MarginTheme.type.body,
                    color = c.inkMuted,
                )

                // Being explicit about what was read versus guessed is the whole point of
                // resolving locally rather than pretending to have fetched the page.
                if (resolved.inferredFields.isNotEmpty()) {
                    Spacer(Modifier.height(Space.md))
                    Text(
                        "Read from the link: ${resolved.inferredFields.joinToString(", ")}.",
                        style = MarginTheme.type.caption,
                        color = c.inkFaint,
                    )
                }
                if (resolved.unknownFields.isNotEmpty()) {
                    Spacer(Modifier.height(Space.xs))
                    Text(
                        "Could not determine: ${resolved.unknownFields.joinToString(", ")}. " +
                            "You can correct these after evaluating.",
                        style = MarginTheme.type.caption,
                        color = c.caution,
                    )
                }
            }

            Spacer(Modifier.height(Space.xl))
            if (state.resolved == null && !state.resolving) {
                Text("Or try one of these", style = MarginTheme.type.caption, color = c.inkMuted)
                Spacer(Modifier.height(Space.sm))
                state.examples.forEach { example ->
                    SecondaryAction(example.label, { viewModel.useExample(example.url) })
                    Spacer(Modifier.height(Space.sm))
                }
            }
            Spacer(Modifier.height(Space.section))
        }

        Column(Modifier.padding(Space.screenH)) {
            PrimaryAction(
                label = if (state.resolved != null) "Evaluate this" else "Read the link",
                onClick = {
                    if (state.resolved != null) viewModel.evaluate(onEvaluated)
                    else viewModel.resolve()
                },
                enabled = state.input.isNotBlank() && !state.resolving,
            )
        }
    }
}
