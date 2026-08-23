# Availability states — rendering specification

> **Status: specification.** No rendered screen exists to critique.

`Availability` and `UnavailableReason` are defined in
`src/FrameDoctor.Abstractions/Telemetry/Availability.cs`. This file specifies exactly how
each state renders, everywhere.

The invariant behind all of it: **a missing metric is never zero.** The UI's job is to make
that structurally impossible, not merely to remember it.

---

## 1. The five states at a glance

| State | Carries a value? | Value slot | Sub-line | Glyph | Colour |
|---|---|---|---|---|---|
| `Available` | yes | the value | normal | none | `--text-primary` |
| `Unavailable` | no | `—` | the reason | none | `--text-tertiary` |
| `Denied` | no | `—` | what would grant it | **lock**, 10 px | `--text-tertiary`, glyph `--sev-warning` |
| `Failed` | no | `—` | fault + age + retry state | **alert-triangle**, 10 px | `--text-tertiary`, glyph `--sev-warning` |
| `Stale` | **yes** | the value | age | **hollow circle**, 7 px | `--text-secondary` |

Three deliberate asymmetries:

- **`Unavailable` gets no glyph.** No sensor on this hardware is not a fault, and marking it
  as one produces a permanently alarmed UI on the majority of desktops (CPU die temperature
  is `Unavailable` on every machine without a kernel driver — which is every machine v1 runs
  on, by ADR 0005).
- **`Denied` and `Failed` do get a glyph**, because the user can act on both.
- **`Stale` shows its value**, dimmed to `--text-secondary`, because the last known value is
  genuinely informative — but it *must* show its age, since a silently frozen number is the
  dishonest case this whole enum exists to prevent.

The em dash is `U+2014`, not a hyphen, and it is rendered at the value's own type size and
tabular width so nothing shifts when a metric recovers.

---

## 2. Metric readouts

Applies to the Live view's metric cluster (region B), the telemetry strip (region C), the
inspector gutter, and the System view's source table.

```
AVAILABLE            UNAVAILABLE          DENIED               FAILED              STALE
CPU TEMP             CPU TEMP             CPU POWER            GPU CLOCK           GPU TEMP
71 °C                —                    🔒 —                 ⚠ —                 ○ 71 °C
                     no sensor            needs administrator  source faulted 4 s   12 s old
```

Rules:

1. **The value slot never changes width or height.** `—` occupies the same tabular advance
   as the widest plausible value for that metric. A layout that reflows when a sensor drops
   out draws the eye to the wrong thing.
2. **The sub-line always says something specific.** Mapping from `UnavailableReason`:

| `UnavailableReason` | Sub-line copy |
|---|---|
| `NoSensor` | `no sensor on this hardware` |
| `RequiresSensorDriver` | `needs a kernel-mode sensor driver` |
| `InsufficientPrivilege` | `needs administrator` |
| `NotExposedByVendor` | `not exposed by this GPU vendor` |
| `InsufficientData` | `needs 2 000 frames · have 1 204` (real counts) |
| `NotYetSampled` | `waiting for first reading` |
| `SourceFaulted` | `source faulted 4 s ago · retrying` |
| `EtwProviderSlotsExhausted` | `trace slots in use by another tool` |
| `TargetProcessProtected` | `process protected (anti-cheat or DRM)` |
| `NotMeaningfulInCurrentState` | `not meaningful while the session is locked` |
| `ClockDiscontinuity` | `clock discontinuity — interval not trustworthy` |
| `None` | never renders; a bug if seen |

3. In the **telemetry strip**, where there is no room for a sub-line, the reason appears in a
   400 ms-delay tooltip and the value slot shows `—` only. No glyph in the strip at all —
   see §5.
4. **Hover/focus reveals the reason; it is never only in a tooltip in the inspector**, where
   the gutter has room for it.
5. `Stale` age formats as `12 s old` under a minute, `4 min old` above, `over an hour old`
   beyond that. At `> 3 ×` the expected interval the value additionally drops to
   `--text-tertiary`; at `> 10 ×` it converts to `Failed`.

### What must never happen

- `0`, `0.0`, `0 %`, `0 °C`, `—0`, `N/A`, `null`, `undefined`, `NaN`.
- A hidden metric. A metric that disappears when unavailable teaches the user that absence is
  normal, and then a *real* absence carries no information.
- A greyed-out control appearance. `--text-disabled` is for controls. Unavailability is
  information and uses `--text-tertiary`.

---

## 3. Charts

### Whole-series unavailable

The panel keeps its full height and its gutter. The plot area fills with a **45° hatch**,
`--chart-hatch`, 1 px lines at 4 px pitch, and a centred label at `--t-body-sm` /
`--text-tertiary`:

```
┌──────────────┬──────────────────────────────────────────────┐
│ CPU TEMP   — │////////////////////////////////////////////// │
│ cpu.temp     │////////  Not measured — needs a  ////////////  │
│ — · —        │////////  kernel-mode sensor driver  /////////  │
│ · context    │////////////////////////////////////////////// │
└──────────────┴──────────────────────────────────────────────┘
```

- **Never an empty axis.** An empty plot with tick labels looks like measured zero.
- **Never a flat line at zero.** This is the exact failure the `Availability` enum was
  created to prevent, and it is the one that produces confidently wrong diagnoses.
- **Never omit the panel** when the metric was cited by the diagnosis or named in
  `Confidence.MissingMetrics`. The blind spot needs a physical place on the timeline.

### Partial unavailability inside a series

Per `event-inspector.md` §5 rule 5: the trace breaks and the interval hatches, labelled with
the reason and the duration when ≥ 40 px wide:

`no data 1.8 s` · `denied 1.2 s` · `source faulted 3.4 s` · `stale 6.0 s`

Never bridged, never dashed through, never imputed. `MetricSeries.Delta()` returns `NaN`
rather than `0` when a side has no readable samples for exactly this reason; the UI must
propagate that as a gap, not as no change.

### Stale samples inside a series

Drawn at **55 % opacity** with a 1 px `--line-default` bracket spanning the stale interval
and a `stale` label in `--t-mono-sm`. Still drawn, because the last known value is real; but
visibly a held value, not a fresh one.

### The Live chart's own capture failure

If `frame.time` itself becomes unavailable mid-session (`EtwProviderSlotsExhausted`,
`TargetProcessProtected`), the affected x interval hatches full height in the Live chart and
regions B's frame cells go to `—`. **The FPS number goes to `—`, never to 0.** A 0 fps
readout during a capture failure would be indistinguishable from a hung game, and the two
demand opposite responses from the user.

---

## 4. Quality is a separate axis and renders separately

`Quality` (`Exact` / `Derived` / `Estimated` / `Degraded`) is orthogonal to availability. A
value can be `Available` and `Degraded`.

| Quality | Readout | Chart |
|---|---|---|
| `Exact` | nothing | nothing |
| `Derived` | word `Derived` in the inspector gutter, `--text-tertiary` | nothing |
| `Estimated` | word `Estimated`, `--sev-warning` | trace at 80 % opacity |
| `Degraded` | word `Degraded`, `--sev-warning`, plus `source reported dropped samples` on hover | trace at 80 % opacity + a 2 px `--sev-warning` underline along the affected interval |

Never a coloured dot alone. The word is the primary channel; opacity and colour are the
secondary ones. `EvidenceItem.QualityWeight` already reduces the confidence a degraded input
can carry — the UI names the reason that happened.

---

## 5. The aggregation rule — how the wall of warnings is prevented

Without a rule, a typical desktop shows `cpu.temperature`, `cpu.power`, `cpu.throttle.state`,
`gpu.temp.hotspot` and `gpu.throttle.reason` as unavailable simultaneously. Five warning
icons on the main screen, permanently, on hardware that is working perfectly. The product
would be shouting about its own limitations instead of measuring.

### The rule, in five clauses

1. **At most one severity indicator per region.** A region is: the header, the metric
   cluster, the telemetry strip, the chart, the diagnosis panel, the event log, one inspector
   panel.
2. **Individual metric readouts never carry a severity indicator in the Live view.** They
   show `—` and reveal their reason on hover or focus. Glyphs are permitted only in the
   inspector gutter and the System view's source table, where the user has explicitly gone
   looking.
3. **All non-`Available` states in a view aggregate into one chip**, in the header.
4. **Aggregation groups by `UnavailableReason`, not by metric.** Users act on reasons —
   *"grant administrator"*, *"close your overlay tool"* — never on eleven individual metric
   names.
5. **`Stale` is exempt** and is always shown inline, because staleness is time-critical and a
   silently frozen number is the specific dishonesty this system exists to prevent.

### The Live view's single availability chip

Sits at the right end of the header (region A). 20 px tall, `--r-sm`,
`border: var(--border-default)`, `--t-label-sm`, `--text-secondary`.

**Text:** `TELEMETRY n / m`

- `m` = the number of metrics the **currently-enabled diagnostic rule set would consult**.
  Not "every metric in the catalog" — that denominator is meaningless and always red.
- `n` = how many are `Available` right now.

**Leading 5 × 5 px square marker**, whose colour is the *highest* severity present:

| Condition | Marker | Meaning |
|---|---|---|
| `n == m` | none (no square drawn) | everything the engine needs is being measured |
| only `Unavailable` / `InsufficientData` | `--text-tertiary` | this hardware cannot provide them; nothing to do |
| any `Denied` | `--sev-warning` | **the user can fix this** |
| any `Failed` | `--sev-warning` | a source broke; may recover |
| `frame.time` itself not `Available` | `--sev-critical` **and the chip text becomes** `FRAME CAPTURE UNAVAILABLE` | we are not measuring the product's subject |

The last row is the one exception to "aggregate everything": losing frame capture is not a
degradation of the picture, it is the absence of the picture, and it gets to say so in words.

**Hover** opens a popover, `--shadow-overlay`, max 6 lines, grouped by reason:

```
9 of 11 metrics available

3 unavailable — no sensor on this hardware
    cpu.temperature · cpu.power · cpu.throttle.state
1 denied — needs administrator
    disk.latency                         [ Grant… ]

Diagnoses affected: CPU thermal throttling cannot be tested.
```

The last line is the point. It converts a technical inventory into a consequence: *which
questions can this machine not answer.* An availability chip that does not say what is lost
is trivia.

**Click** navigates to System → Telemetry sources, scrolled to the first non-`Available` row.

### System view — the one place with a full inventory

The System view's telemetry source table is the only surface that shows every metric's state,
one row per metric, with `SourceId`, `Availability`, `UnavailableReason`, `Quality`, observed
rate, and last sample age. Glyphs are permitted there. It is a diagnostic surface the user
chose to open, not an ambient one they must live with.

---

## 6. Transitions between states

- Availability changes use `--motion-state` (120 ms) on colour and opacity only. **The value
  itself never animates** — a number tweening in from `—` would be inventing intermediate
  readings.
- A metric recovering from `Denied`/`Failed` to `Available` gets a single 300 ms `--sev-normal`
  underline on the value, then nothing. One acknowledgement, no persistent celebration.
- A metric degrading to `Failed` mid-session does **not** animate attention-grabbingly. It
  updates the header chip. Interrupting the user during gameplay measurement is exactly what
  ADR 0005 cut ("no live in-game stutter alerts — we would become the distraction we exist to
  prevent"), and the same reasoning applies here.
- Under `prefers-reduced-motion`, all of the above are instantaneous state changes; the
  recovery underline becomes a 300 ms static rule.
