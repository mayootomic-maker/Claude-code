# FrameDoctor design system

> **Status: specification.** No FrameDoctor UI has been built yet, so nothing here is a
> critique of a rendered screen. Every value below was either measured this session in
> headless Chromium (`[verified]`), read out of a primary source with a URL
> (`[documented]`), or is a design decision with no external authority (`[decision]`).
> Anything genuinely unproven is `[unverified]` and says so.

Authority: this file is the single source of truth for tokens. `docs/design/live-view.md`,
`event-inspector.md` and `availability-states.md` may only reference token names, never
literal colours or sizes.

---

## 0. What was actually examined

| Artefact | Path | What it established |
|---|---|---|
| uPlot 1.6.32 type defs + ESM source | `node_modules/uplot/dist/uPlot.d.ts`, `uPlot.esm.js` | hook names, draw order, `paths → null`, `uPlot.sync` |
| Headless uPlot probe | scratchpad `probe/www/index.html` + `proof.png` | custom Canvas 2D series drawn on uPlot's canvas; cursor synced across two plots |
| Font probe | scratchpad `probe/www/fonts.html` + `fonts.png` | Inter/JetBrains Mono load from local `woff2`; tabular figures confirmed by advance-width measurement |
| Live-view layout probe | scratchpad `probe/www/live.html`, screenshots at 1280×720 / 1920×1080 / 2560×1440 | every fixed row height and the reflow thresholds in `live-view.md` |
| Contrast calculator | scratchpad `probe/c3.mjs` | every ratio quoted in §2 |

The scratchpad is disposable. The numbers it produced are not; they are reproduced inline
below so this document stands alone.

---

## 1. Fonts — self-hosted, offline, licence-clear

### Decision

| Role | Family | Package | File shipped | Size |
|---|---|---|---|---|
| UI + **all numerals** | Inter Variable | `@fontsource-variable/inter@5.3.0` | `inter-latin-wght-normal.woff2` | **48 256 B** `[verified]` |
| Machine literals only | JetBrains Mono Variable | `@fontsource-variable/jetbrains-mono@5.3.0` | `jetbrains-mono-latin-wght-normal.woff2` | **40 404 B** `[verified]` |

Total font payload **88 660 B**, two files, zero network requests. `[verified]` — both
packages installed and both files rendered from `file://` in headless Chromium this session.

### Licence

Both are **SIL Open Font License 1.1** `[verified]` — read from
`node_modules/@fontsource-variable/{inter,jetbrains-mono}/LICENSE`. OFL 1.1 permits
redistribution as part of a software bundle, including a commercial one, provided the
licence text ships with the font and the fonts are not sold on their own.

**Obligation on us:** ship both `LICENSE` files. Put them at
`src/FrameDoctor.Shell/web/fonts/OFL-Inter.txt` and `OFL-JetBrainsMono.txt`, and reference
them from the Settings → About screen. Do not rename the font families in `@font-face`
beyond the `Variable` suffix Fontsource already uses.

> **A Google Fonts `<link>` is forbidden** by invariant 7 and would also simply fail: the
> WebView2 content is loaded from a local virtual host with no network. This is not a
> preference, it is a functional requirement.

### Why variable, and why only the `latin` subset

Fontsource ships 7 unicode subsets per family. We ship **`latin` only**. FrameDoctor's
strings are game names, process names, metric ids and English diagnosis prose. A game with
a Cyrillic or CJK title falls back to the system stack, which is correct behaviour on
Windows and costs nothing. Shipping all subsets would be ~380 KB for glyphs that never
render. `[decision]`

Variable rather than static instances because the type scale below uses **weights 450, 500,
520, 550, 560, 600 and 620**. Those are not available as static Fontsource weights, and the
in-between weights are precisely what stops the UI reading as a Tailwind template.
`[verified]` — the variable file declares `font-weight: 100 900`.

### Build step

Do not `@import '@fontsource-variable/inter'` — the package's `index.css` pulls all 7
subsets. Copy the two files at build time and hand-write the `@font-face`:

```
// vite.config.ts — copy step
viteStaticCopy({ targets: [
  { src: 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', dest: 'fonts' },
  { src: 'node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2', dest: 'fonts' },
  { src: 'node_modules/@fontsource-variable/inter/LICENSE', dest: 'fonts', rename: 'OFL-Inter.txt' },
  { src: 'node_modules/@fontsource-variable/jetbrains-mono/LICENSE', dest: 'fonts', rename: 'OFL-JetBrainsMono.txt' },
]})
```

```css
@font-face {
  font-family: 'Inter Variable';
  font-style: normal;
  font-weight: 100 900;
  font-display: block;               /* NOT swap — see note */
  src: url('/fonts/inter-latin-wght-normal.woff2') format('woff2-variations');
}
@font-face {
  font-family: 'JetBrains Mono Variable';
  font-style: normal;
  font-weight: 100 800;              /* JBM's real axis range, verified */
  font-display: block;
  src: url('/fonts/jetbrains-mono-latin-wght-normal.woff2') format('woff2-variations');
}
```

`font-display: block` rather than Fontsource's default `swap`. On a local filesystem the
block period is sub-frame, and `swap` would produce a visible metric reflow of the 44 px FPS
number on every cold start. `[decision]`

### Tabular figures — measured, not assumed

```css
:root { font-variant-numeric: tabular-nums; }   /* global default */
```

`[verified]` at 32 px in Chromium:

| Sample | Width |
|---|---|
| `0123456789`, Inter, default | 189.28 px (proportional) |
| `0123456789`, Inter, `tabular-nums` | **207.50 px** |
| `1111111111`, Inter, `tabular-nums` | **207.50 px** |
| `0123456789`, JetBrains Mono | 192.02 px |

Identical widths for `0123456789` and `1111111111` prove the `tnum` feature is active and
every digit occupies 0.6484 em. This is what makes a live FPS readout stop twitching.

**Do not use `slashed-zero`.** `[verified]` — applying `font-variant-numeric: slashed-zero`
to the shipped Inter latin subset produced a glyph identical to the plain zero. The `zero`
feature is not in this subset. Specifying it would be a lie in the stylesheet.

### The numeral rule — one rule, no exceptions

> **All numbers are Inter with `tabular-nums`. JetBrains Mono is used only for strings the
> machine produced and the user might copy:** metric ids (`cpu.clock.effective`), process
> names and pids (`OneDrive.exe · 9214`), source ids, file paths, timestamps in the event
> log, hex, and rule ids.

The failure mode this prevents is "terminal cosplay" — mono everywhere reads as a hacker
theme, not an instrument. Inter's tabular figures are a *technical* numeral already, they
set tighter, and they hold their shape at 44 px where JetBrains Mono starts to look like a
code editor. `[decision]`

### Font stacks

```css
--font-ui:   'Inter Variable', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
--font-mono: 'JetBrains Mono Variable', 'Cascadia Mono', Consolas, 'Courier New', monospace;
```

Windows 11 fallbacks first, since that is the primary target.

---

## 2. Colour

### Theme structure — dark is designed, light is cut

Light mode is **cut from v1** by ADR 0005. It is not deferred-by-neglect; it is absent, and
the tokens are structured so that adding it later is a second `[data-theme]` block and
nothing else.

The structure that makes that true:

1. **Two layers.** A private *palette* layer (`--fd-*`, raw colours, never used by a
   component) and a public *semantic* layer (`--bg-*`, `--text-*`, `--sev-*`, `--chart-*`).
   Components reference only the semantic layer. Adding light mode redefines ~30 semantic
   tokens; it never touches a component.
2. **No component may write a literal colour.** Enforced by `scripts/slop-scan.sh`: a
   `#[0-9a-f]{3,8}` or `rgb(`/`hsl(` outside `tokens.css` fails the build.
3. **Semantic names describe role, not appearance.** `--bg-raised`, not `--gray-900`.
   `--sev-critical`, not `--red`. A light theme inverts elevation; a name like `--gray-900`
   becomes a lie the moment it does.
4. **Canvas code reads tokens too.** Chart drawing must call
   `getComputedStyle(root).getPropertyValue('--chart-trace')` once per theme change and
   cache it, never hardcode. See `live-view.md` §6.

```css
:root, [data-theme='dark'] { /* dark tokens */ }
/* v1 ships only the dark block. [data-theme='light'] is intentionally absent. */
```

### The four-hue rule

The entire product uses **four hues**: green, amber, red, blue. Nothing else. The fifth
semantic role — *comparison* — is deliberately **achromatic** (`--sev-comparison`, a neutral
grey) and is distinguished by a dashed stroke and a label, not by a colour.

That is not minimalism for its own sake. A comparison overlay drawn in a fifth hue competes
with severity, and severity is the only thing in this product allowed to shout. `[decision]`

### Base palette (private — do not reference from components)

```css
:root {
  /* neutrals — a cool, slightly blue-shifted near-black ramp */
  --fd-n-1000: #0B0E13;
  --fd-n-950:  #11151C;
  --fd-n-900:  #151A22;
  --fd-n-850:  #1B212B;
  --fd-n-800:  #202836;
  --fd-n-750:  #1E242E;
  --fd-n-700:  #2A323F;
  --fd-n-600:  #3A4552;
  --fd-n-500:  #4A5361;
  --fd-n-400:  #606D7C;
  --fd-n-350:  #7A8494;
  --fd-n-300:  #7C8798;
  --fd-n-200:  #9BA6B7;
  --fd-n-100:  #C9D4E3;
  --fd-n-50:   #E8EDF4;

  --fd-green-400:  #4CC38A;
  --fd-amber-400:  #D9A03C;
  --fd-amber-700:  #8F7233;
  --fd-red-400:    #F26761;
  --fd-blue-400:   #4C9AFF;
  --fd-blue-300:   #6AB0FF;
  --fd-blue-600:   #4E78A8;
}
```

Never pure `#000`. A 1 px hairline on pure black haloes on both OLED and cheap IPS panels,
and the whole UI is hairlines. `[decision]`

### Semantic tokens — paste this

```css
:root, [data-theme='dark'] {
  /* ---- surfaces ---------------------------------------------------- */
  --bg-base:      var(--fd-n-1000);  /* window body, content columns          */
  --bg-raised:    var(--fd-n-950);   /* nav rail, header bar, diagnosis panel */
  --bg-panel:     var(--fd-n-900);   /* chart plot areas, inspector panels    */
  --bg-hover:     var(--fd-n-850);
  --bg-selected:  var(--fd-n-800);
  --bg-scrim:     rgba(6, 8, 11, 0.72);   /* modal backdrop only */

  /* ---- text -------------------------------------------------------- */
  --text-primary:   var(--fd-n-50);
  --text-secondary: var(--fd-n-200);
  --text-tertiary:  var(--fd-n-350);
  --text-disabled:  var(--fd-n-500);

  /* ---- lines ------------------------------------------------------- */
  --line-hairline: var(--fd-n-750);  /* table rules, sub-region dividers */
  --line-default:  var(--fd-n-700);  /* region boundaries, control edges */
  --line-strong:   var(--fd-n-600);  /* button edge, focused container   */

  /* ---- the five semantic roles ------------------------------------- */
  --sev-normal:     var(--fd-green-400);
  --sev-warning:    var(--fd-amber-400);
  --sev-critical:   var(--fd-red-400);
  --sev-selected:   var(--fd-blue-400);
  --sev-comparison: var(--fd-n-300);   /* achromatic by design */

  /* low-alpha companions, for fills behind the above */
  --sev-normal-wash:   rgba(76, 195, 138, 0.14);
  --sev-warning-wash:  rgba(217, 160, 60, 0.14);
  --sev-critical-wash: rgba(242, 103, 97, 0.16);
  --sev-selected-wash: rgba(76, 154, 255, 0.14);

  /* ---- chart ------------------------------------------------------- */
  --chart-plot-bg:   var(--bg-base);
  --chart-grid:      var(--fd-n-850);
  --chart-axis:      var(--fd-n-350);
  --chart-trace:     var(--fd-n-100);   /* the per-column last-value polyline */
  --chart-envelope:  var(--fd-blue-600);/* per-column min→max span            */
  --chart-baseline:  var(--fd-n-400);   /* rolling median reference, dashed   */
  --chart-threshold: var(--fd-amber-700); /* stutter threshold, dashed        */
  --chart-refresh:   var(--fd-n-350);   /* display refresh interval, dotted   */
  --chart-cursor:    var(--fd-n-200);
  --chart-selection: var(--sev-selected-wash);
  --chart-event-span: var(--sev-critical-wash);
  --chart-hatch:     var(--fd-n-750);   /* unavailable / gap hatching         */

  /* ---- focus ------------------------------------------------------- */
  --focus-ring: var(--fd-blue-300);
}
```

### Contrast — measured, WCAG 2.1 relative luminance

`[verified]` — computed by `probe/c3.mjs` this session.

| Token | on `--bg-base` | on `--bg-raised` | on `--bg-panel` | on `--bg-selected` |
|---|---|---|---|---|
| `--text-primary` | 16.43 | 15.55 | 14.84 | 12.59 |
| `--text-secondary` | 7.85 | 7.43 | 7.09 | 6.02 |
| `--text-tertiary` | 5.11 | 4.84 | 4.62 | 3.92 |
| `--text-disabled` | 2.49 | 2.35 | 2.25 | 1.90 |
| `--sev-normal` | 8.73 | 8.26 | 7.88 | 6.68 |
| `--sev-warning` | 8.32 | 7.88 | 7.52 | 6.38 |
| `--sev-critical` | 6.34 | 6.00 | 5.73 | 4.86 |
| `--sev-selected` | 6.79 | 6.42 | 6.13 | 5.20 |
| `--sev-comparison` | 5.32 | 5.03 | 4.80 | 4.07 |
| `--focus-ring` | 8.53 | 8.07 | 7.70 | 6.53 |
| `--chart-trace` | 12.90 | 12.21 | 11.65 | 9.88 |
| `--chart-envelope` | 4.21 | 3.99 | 3.80 | 3.23 |
| `--chart-baseline` | 3.66 | 3.46 | 3.31 | 3.06 |
| `--chart-threshold` | 4.25 | 4.03 | 3.84 | 3.26 |

Rules this locks in:

- Every text token except `--text-disabled` clears **4.5:1** on `base`, `raised` and
  `panel`. `--text-tertiary` is 3.92 on `--bg-selected`, so **tertiary text is forbidden
  inside a selected row**; use `--text-secondary` there. This is a real constraint, not a
  footnote — the event log's selected row is the case that hits it.
- Every chart mark clears **3:1** everywhere it is used.
- `--text-disabled` is under 3:1 deliberately and is only ever used for a control the user
  cannot operate. **It is never used for an unavailable metric** — unavailability is
  information, not a disabled control, and renders in `--text-tertiary`. See
  `availability-states.md`.
- `--line-*` and `--chart-grid` are all under 2:1 by design. They are structure, not
  content; if the grid competes with the trace, the chart has failed.

### Severity is never colour alone

Every place a severity appears it carries **two** of {colour, shape, position, label}:

| Severity | Colour | Shape | Label |
|---|---|---|---|
| Severe hitch | `--sev-critical` | filled **triangle**, 9×8 px, apex up | `Severe hitch` |
| Stutter / micro-stutter | `--sev-warning` | filled **square**, 7×7 px | `Stutter` / `Micro-stutter` |
| Pacing micro-stutter | `--sev-warning` | filled **diamond**, 8×8 px | `Pacing` |
| Warm-up (excluded) | `--text-tertiary` | **hollow square**, 7×7 px, 1 px stroke | `Warm-up hitch` |
| Regime change | `--text-tertiary` | **vertical bar** glyph, 2×9 px | `Regime change` |
| Healthy | `--sev-normal` | filled **circle**, 6 px | (state dot only, in header) |

Deuteranopia check by construction: triangle/square/diamond/hollow/bar are distinguishable
with the colour channel removed entirely. `[decision]` — not user-tested; mark
`REQUIRES-USER-VALIDATION` when a Windows build exists.

---

## 3. Type scale

Every token is `font-size / line-height / weight / letter-spacing`. Sizes in `px`, not `rem`
— this is a fixed-DPI desktop surface hosted in WebView2 and there is no user font-size
setting to respect. `[decision]`

```css
:root {
  /* the hero: the one number that answers "is it healthy" */
  --t-hero-size: 44px;  --t-hero-lh: 44px;  --t-hero-weight: 620; --t-hero-track: -0.02em;

  /* headline metrics beside the hero, and the confidence number */
  --t-metric-lg-size: 28px; --t-metric-lg-lh: 32px; --t-metric-lg-weight: 600; --t-metric-lg-track: -0.015em;

  /* secondary telemetry strip values */
  --t-metric-md-size: 14px; --t-metric-md-lh: 18px; --t-metric-md-weight: 560; --t-metric-md-track: -0.005em;

  /* inspector gutter values, table numerics */
  --t-metric-sm-size: 12px; --t-metric-sm-lh: 16px; --t-metric-sm-weight: 550; --t-metric-sm-track: 0;

  /* section titles inside a view */
  --t-title-size: 16px; --t-title-lh: 22px; --t-title-weight: 600; --t-title-track: -0.01em;
  --t-subtitle-size: 15px; --t-subtitle-lh: 20px; --t-subtitle-weight: 600; --t-subtitle-track: -0.01em;

  /* diagnosis prose — the product */
  --t-body-size: 13px; --t-body-lh: 20px; --t-body-weight: 400; --t-body-track: 0;
  --t-body-strong-weight: 600;
  --t-body-sm-size: 12px; --t-body-sm-lh: 18px; --t-body-sm-weight: 400; --t-body-sm-track: 0;

  /* region and metric labels — uppercase */
  --t-label-size: 11px; --t-label-lh: 14px; --t-label-weight: 500; --t-label-track: 0.06em;
  --t-label-sm-size: 10px; --t-label-sm-lh: 13px; --t-label-sm-weight: 500; --t-label-sm-track: 0.06em;

  /* nav */
  --t-nav-size: 13px; --t-nav-lh: 16px; --t-nav-weight: 500; --t-nav-track: 0.01em;

  /* machine literals */
  --t-mono-size: 11px; --t-mono-lh: 15px; --t-mono-weight: 450; --t-mono-track: 0;
  --t-mono-sm-size: 10px; --t-mono-sm-lh: 14px; --t-mono-sm-weight: 450; --t-mono-sm-track: 0;
}
```

Recommended shorthand classes (one per token, no ad-hoc sizes anywhere else):

```css
.t-hero      { font: var(--t-hero-weight) var(--t-hero-size)/var(--t-hero-lh) var(--font-ui);
               letter-spacing: var(--t-hero-track); }
.t-label     { font: var(--t-label-weight) var(--t-label-size)/var(--t-label-lh) var(--font-ui);
               letter-spacing: var(--t-label-track); text-transform: uppercase; }
.t-mono      { font: var(--t-mono-weight) var(--t-mono-size)/var(--t-mono-lh) var(--font-mono); }
/* …one per token… */
```

### Unit typography

A unit is **always** a separate element, `--t-label-sm` weight 500, colour
`--text-tertiary`, separated from the value by a **4 px gap** (not a space character — a
space in a tabular-figure run is itself a tabular-width glyph and looks wrong).

```html
<span class="value t-hero">143</span><span class="unit t-label-sm">fps</span>
```

Exception: compound units that read as one token stay inside the unit span —
`/ 12 GB`, `/s`, `°C`. The slash is never bolded.

### Number formatting — one table, no judgement calls

| Quantity | Format | Example |
|---|---|---|
| Frame time < 100 ms | 1 decimal | `11.4 ms` |
| Frame time ≥ 100 ms | 0 decimals | `142 ms` |
| FPS | 0 decimals | `143 fps` |
| Percent | 0 decimals | `38 %` |
| Percent < 1 | 1 decimal | `0.4 %` |
| CPU/GPU clock | GHz, 2 decimals, when ≥ 1000 MHz | `4.61 GHz` |
| GPU memory clock | MHz, 0 decimals, thin-space grouped | `2 610 MHz` |
| Temperature | 0 decimals | `71 °C` |
| Memory | GB, 1 decimal | `9.8 / 12 GB` |
| Disk latency | 1 decimal ms | `0.4 ms` |
| Counts ≥ 1000 | narrow no-break space `U+202F` as group separator | `2 041 frames` |
| Confidence | 2 decimals, `0.00`–`0.97`, never a percentage | `0.74` |
| Duration | `mm:ss` under an hour, `hh:mm:ss` over | `00:42:17` |
| Event timestamp | `HH:mm:ss.SSS`, mono | `14:32:07.412` |

Grouping uses `U+202F` and not a comma, because a comma in a decimal locale is a decimal
point and this application shows both in the same row. `[decision]`

---

## 4. Spacing, radii, borders, shadows

```css
:root {
  --sp-1: 4px;  --sp-2: 8px;   --sp-3: 12px; --sp-4: 16px; --sp-5: 20px;
  --sp-6: 24px; --sp-7: 32px;  --sp-8: 40px; --sp-9: 48px; --sp-10: 64px;

  --gutter-view: var(--sp-6);        /* 24px — left/right padding of every view region */
  --gutter-view-wide: var(--sp-7);   /* 32px — applied at ≥ 2200px main-column width   */

  --r-sm: 2px;   /* chips, inputs, tags        */
  --r-md: 3px;   /* buttons, menu items        */
  --r-lg: 4px;   /* dialogs, popovers          */
  /* there is no --r-full. Nothing in FrameDoctor is a pill except the 6px status dot,
     which is a circle by geometry, not by radius. */

  --border-hairline: 1px solid var(--line-hairline);
  --border-default:  1px solid var(--line-default);
  --border-strong:   1px solid var(--line-strong);

  --shadow-overlay: 0 8px 24px rgba(0,0,0,0.55), 0 0 0 1px var(--line-default);
}
```

### The border budget

A border is permitted on exactly five things. Anything else is a bug:

1. A **region boundary** — `--border-default`, and only where two regions with different
   backgrounds meet or where a region scrolls independently.
2. A **sub-region rule** — `--border-hairline`, table row rules, the vertical rules between
   metric cells.
3. An **interactive control** — button, input, select, chip. `--border-default` at rest,
   `--border-strong` on hover.
4. An **overlay surface** — dialog, popover, context menu, via `--shadow-overlay`.
5. A **severity tag** — the 1 px outline around `▲ SEVERE HITCH`, in the severity colour.

**Forbidden, and grep-enforced:** `border` or `background` on any container holding a metric
readout in the Live view. This is the review gate from ADR 0004 (§Risks) — the four-number
cluster drifting into a KPI-card grid is named there as the most likely failure mode of this
layout. `scripts/slop-scan.sh` must fail the build on it.

Hierarchy in the metric cluster comes from **size (44 vs 28 px), weight (620 vs 600), and a
1 px vertical hairline with 40 px of padding either side.** Nothing else.

### Shadows

Exactly one shadow token, used on exactly three things: dialog, popover, context menu.
No shadow on a card (there are no cards), a button, a chart, a panel, or a table row.
Elevation inside the app is expressed by `--bg-raised` / `--bg-panel`, not by blur.

---

## 5. Motion

Four transitions. There is no fifth. Any animation not on this list is a bug.

```css
:root {
  --ease-standard: cubic-bezier(0.20, 0.00, 0.00, 1.00);
  --ease-decel:    cubic-bezier(0.16, 1.00, 0.30, 1.00);

  --motion-state:   120ms var(--ease-standard);  /* 1 */
  --motion-select:  160ms var(--ease-standard);  /* 2 */
  --motion-arrive:  220ms var(--ease-decel);     /* 3 */
  --motion-reveal:  260ms var(--ease-decel);     /* 4 */
}
```

| # | Name | Duration | Applies to | Properties |
|---|---|---|---|---|
| 1 | **state** | 120 ms | hover, press, focus, enable/disable | `background-color`, `border-color`, `color`, `opacity` |
| 2 | **select** | 160 ms | nav indicator, selected row, panel expand/collapse, tab underline | `transform`, `background-color`, `height` |
| 3 | **arrive** | 220 ms | a new event marker landing in the ribbon; a new diagnosis replacing the previous one | `opacity 0→1`, `transform translateY(4px)→0` |
| 4 | **reveal** | 260 ms | event inspector opening, session loading, dialog entry | `opacity 0→1`, `transform translateY(8px)→0`; scrim `opacity 0→1` |

### Three motion prohibitions

1. **Nothing bound to telemetry is ever transitioned.** No tweened numbers, no animated
   bars, no eased chart values. A number that takes 120 ms to reach its value is displaying
   a value that was never measured. This is an honesty rule before it is a performance rule.
2. **The canvas never CSS-animates.** All chart change happens inside one `rAF` draw. This
   is also an ADR 0004 mitigation for the "our UI steals frame time from the game" risk.
3. **No loading spinner longer than one frame.** Anything slow shows a determinate state or
   a static skeleton with the reason. A perpetual spinner is a UI that does not know what it
   is doing.

### `prefers-reduced-motion`

```css
@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-state:  1ms linear;
    --motion-select: 1ms linear;
    --motion-arrive: 1ms linear;
    --motion-reveal: 1ms linear;
  }
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
}
```

Behaviourally, under reduced motion:

- Transitions 1 and 2 become instantaneous state changes. Nothing is lost.
- Transition 3 (arrive) loses its translate. **The event marker still needs to announce
  itself**, so it instead paints at full opacity immediately and the corresponding event-log
  row receives a **200 ms static outline** in `--sev-selected` — a state, not a motion.
- Transition 4 (reveal) becomes an immediate cut.
- The chart is unaffected: it never animated.

Implement by reading the media query in JS as well, since the canvas code is not CSS:

```ts
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
```

---

## 6. Interaction states — exact

### Focus

`:focus-visible` only. Never `:focus`. Mouse users must never see a ring.

```css
:where(a, button, [role='button'], [role='tab'], [role='row'], input, select, summary):focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
  border-radius: var(--r-sm);
}
```

For a control sitting on `--bg-panel` inside a `--bg-base` region, the 2 px offset can leave
the ring reading against an ambiguous edge. Add an inner knockout:

```css
.focus-knockout:focus-visible { box-shadow: 0 0 0 1px var(--bg-base); }
```

Focus is never removed, never restyled to a colour change alone, and never suppressed on a
table row — the event log is keyboard-navigable and that is the point.

### Hover

| Element | At rest | Hover | Transition |
|---|---|---|---|
| Nav item | `--text-secondary` on `--bg-raised` | `--text-primary` on `--bg-hover` | state |
| Table row | `--bg-base` | `--bg-hover` | state |
| Button | `--border-default`, `--text-primary` | `--border-strong`, `--bg-hover` | state |
| Chip (interactive) | `--border-default` | `--border-strong` | state |
| Chart plot area | — | crosshair cursor + readout; **no background change** | none |
| Metric readout | — | **nothing**, unless it is non-`Available`, in which case a tooltip after 400 ms | none |

A metric readout is not a control and must not behave like one. No hover background, no
pointer cursor, no underline.

### Selected

| Element | Treatment |
|---|---|
| Nav item | `--bg-selected` fill + **2 px left bar** in `--sev-selected`, full item height |
| Event-log row | `--bg-selected` fill + **2 px inset left bar** in `--sev-selected`; text lifts from `--text-secondary` to `--text-primary`; the first cell's mono timestamp lifts from `--text-tertiary` to `--text-secondary` (contrast rule, §2) |
| Chart event marker | marker gains a 1 px `--sev-selected` outline and the event span shades with `--chart-selection` across every synced panel |
| Inspector panel (focused series) | left gutter background `--bg-selected`; **the trace does not change colour** |

Selection is always **fill + positional bar**, never colour alone, so it survives the
severity colours already present in the same row.

### Pressed / active

`transform: none`. No scale, no depress. Pressed state is `--bg-selected` held for the
duration of the press. Scale transforms on a 13 px control read as a website.

### Disabled

`--text-disabled`, `--border-hairline`, `cursor: default`, `pointer-events: none` on the
inner content but the wrapper keeps a `title` explaining *why*. A disabled control with no
reason is forbidden by invariant 9.

---

## 7. Density and the desktop-not-website rule

- Root `font-size` is not used for layout. No `rem`. No fluid `clamp()` on type.
- `clamp()` is permitted on **region heights only**, and only where specified in
  `live-view.md`.
- Layout is CSS Grid with explicit track sizes. No `max-width: 1200px; margin: auto`
  centring — a 3440 px ultrawide gets 3440 px of chart, which is the whole point of owning a
  chart engine.
- Minimum supported client area: **1280 × 720**. Below that the window is clamped by the WPF
  shell, not handled by CSS.
- Breakpoints are on the **main column width** (viewport minus the 200 px nav rail), not the
  viewport, and there are exactly two:

| Name | Main column width | Effect |
|---|---|---|
| `compact` | < 1200 px | telemetry strip wraps to 2 rows; inspector explanation column narrows 420 → 360 px; event-log `Evidence` column hides |
| `wide` | ≥ 2200 px | `--gutter-view-wide` (32 px); inspector explanation column widens to 480 px; event-log gains an `Excess %` column |

Everything between is one layout that flexes. `[verified]` — measured at 1280×720,
1920×1080 and 2560×1440; see `live-view.md` §2 for the measured row heights.

---

## 8. Iconography

There are **no icon fonts and no emoji** (both forbidden by `docs/PRODUCT-SPEC.md`).

Icons are inline SVG, 14×14 px viewBox `0 0 14 14`, `stroke-width: 1.25`, `stroke:
currentColor`, `fill: none`, `stroke-linecap: square`. The permitted set for v1 is small and
closed:

`chevron-right` · `chevron-down` · `arrow-right` · `lock` · `alert-triangle` ·
`refresh` · `external` · `close` · `search` · `download`

Severity glyphs (triangle / square / diamond / hollow square / bar) are **not** icons — they
are drawn as CSS shapes or canvas paths, sized 7–9 px, because they must render identically
in DOM and on canvas.

---

## 9. File layout

```
src/FrameDoctor.Shell/web/src/styles/
  tokens.css        # §1 @font-face, §2 palette + semantic, §3 type, §4 space, §5 motion
  base.css          # reset, html/body, ::selection, scrollbars, focus-visible
  utilities.css     # the .t-* type classes and nothing else
```

`tokens.css` is the only file in the repository permitted to contain a colour literal.
