# Design specification

Written before implementation, from ADRs 0004 (UI stack) and 0005 (v1 scope). **These are
specifications, not reviews** — no FrameDoctor UI has been rendered, so nothing here
critiques a real screen. When the first build exists, run `/council-ui` against actual
screenshots and amend these files from the findings.

| File | Answers |
|---|---|
| `design-system.md` | Every token, ready to paste. Fonts, colour, type, space, motion, states. **Authoritative** — the other files reference token names only. |
| `live-view.md` | The main screen, region by region, with measured dimensions and the complete frame-time chart spec. |
| `event-inspector.md` | The standout surface: evidence-driven panels, the shared axis, the five sparse-series honesty rules, and the copy rules for diagnosis text. |
| `availability-states.md` | How `Available`/`Unavailable`/`Denied`/`Failed`/`Stale` render, and the aggregation rule that prevents a wall of warnings. |
| `component-inventory.md` | The React tree with props. The file to code from. |

## Evidence tags

- `[verified]` — run or read in the session that wrote the line. Font metrics, contrast
  ratios, uPlot API behaviour and layout dimensions are all in this class.
- `[documented]` — primary source with a URL.
- `[decision]` — a design choice with no external authority. Stated so it can be argued with.
- `[unverified]` — believed, not checked. Mostly Windows-dependent copy and geometry.

## Verified this session

| Claim | How |
|---|---|
| uPlot 1.6.32 is the latest release | `npm view uplot versions` |
| `series.paths → null` disables uPlot's own series rendering; `drawSeries` still fires | read `uPlot.esm.js:4198-4256`, then rendered headlessly |
| `points: { show: false }` is *also* required | read `uPlot.esm.js:4238-4245` |
| uPlot does not clip custom drawing to the plot area | read `uPlot.esm.js:4265-4300`; confirmed by a spike painting over the axis until we clipped |
| The `draw` hook fires **after** axes and series | `uPlot.esm.js:4887-4889`; `drawOrder` default `["axes","series"]` at `:2995` |
| `uPlot.sync(key)` syncs cursors across plots by x value | two plots, one mouse move, identical `cursor.left` (495) and `cursor.idx` (2457) |
| Inter + JetBrains Mono are OFL 1.1 and self-hostable | read both `LICENSE` files from the Fontsource packages |
| Inter's tabular figures work | advance-width measurement: `0123456789` and `1111111111` both 207.50 px at 32 px |
| Inter's shipped latin subset has **no** slashed zero | rendered; identical glyph with and without `slashed-zero` |
| Every text token clears 4.5:1 and every chart mark clears 3:1 | WCAG relative-luminance computation over the full token matrix |
| The Live-view grid holds at 1280×720, 1920×1080 and 2560×1440 | headless render of a token-accurate mock; row heights in `live-view.md` §2 |
| A 148 px minimum telemetry-strip column is required | at 124 px, labels and values collide at 1280×720 |
