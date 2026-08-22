/**
 * The same tokens the Android app ships with. The film is not "inspired by" the product's
 * palette and motion — it is drawn from the identical numbers, so the two cannot drift.
 */
export const colors = {
  canvas: '#FAF9F7',
  surface: '#FFFFFF',
  surfaceMuted: '#F2F1EE',
  hairline: '#E4E2DD',
  hairlineStrong: '#D2CFC8',
  inkStrong: '#14130F',
  ink: '#2B2924',
  inkMuted: '#605C55',
  inkFaint: '#8A857C',
  onInk: '#FAF9F7',
  accent: '#2549B0',
  positive: '#0B6B4E',
  positiveSoft: '#E5F0EA',
  negative: '#A33A29',
  caution: '#8A6416',
} as const;

export const darkColors = {
  canvas: '#0B0B0A',
  surface: '#181715',
  surfaceMuted: '#201F1C',
  hairline: '#302E2A',
  inkStrong: '#F5F3EF',
  ink: '#DCD9D3',
  inkMuted: '#9A948A',
  inkFaint: '#6F6A61',
  positive: '#4BC493',
} as const;

/** Motion tiers, matching app/src/main/java/app/margin/core/design/Motion.kt exactly. */
export const springs = {
  press: { damping: 0.88, stiffness: 1700 },
  standard: { damping: 0.82, stiffness: 420 },
  gentle: { damping: 1.0, stiffness: 190 },
  reward: { damping: 0.52, stiffness: 560 },
} as const;

/**
 * Remotion's spring() takes a mass/damping/stiffness triple where damping is absolute, while
 * Compose takes a damping *ratio*. Converting keeps both platforms on one set of numbers:
 * damping = ratio * 2 * sqrt(stiffness * mass).
 */
export const toRemotionSpring = (t: { damping: number; stiffness: number }, mass = 1) => ({
  mass,
  stiffness: t.stiffness / 12,
  damping: t.damping * 2 * Math.sqrt((t.stiffness / 12) * mass),
});

export const font =
  'Inter, "Helvetica Neue", Helvetica, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';

/** Swiss grouping with a non-breaking space, exactly as Money.kt formats it. */
export const chf = (units: number): string => {
  const s = Math.round(Math.abs(units)).toString();
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += '’';
    out += s[i];
  }
  return `${units < 0 ? '−' : ''}CHF ${out}`;
};
