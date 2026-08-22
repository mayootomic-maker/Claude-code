import React from 'react';
import { spring, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { springs, toRemotionSpring, colors, font, chf } from './theme';

/** A spring value in 0..1 that starts at `delay` frames. The film's only timing primitive. */
export const useEnter = (delay = 0, tier: keyof typeof springs = 'standard') => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({
    frame: frame - delay,
    fps,
    config: toRemotionSpring(springs[tier]),
    durationInFrames: undefined,
  });
};

/** Lift-and-fade entrance. The same 14dp travel the app uses for list reveals. */
export const Reveal: React.FC<{
  delay?: number;
  travel?: number;
  tier?: keyof typeof springs;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ delay = 0, travel = 28, tier = 'standard', children, style }) => {
  const p = useEnter(delay, tier);
  return (
    <div
      style={{
        ...style,
        opacity: p,
        transform: `translateY(${(1 - p) * travel}px)`,
      }}
    >
      {children}
    </div>
  );
};

/** Figures roll into place rather than snapping, on tabular digits so nothing reflows. */
export const CountUp: React.FC<{
  to: number;
  delay?: number;
  format?: (n: number) => string;
  style?: React.CSSProperties;
}> = ({ to, delay = 0, format = (n) => chf(n), style }) => {
  const p = useEnter(delay, 'gentle');
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums', ...style }}>{format(to * p)}</span>
  );
};

/** The deal score instrument: 270 degrees of travel with a deliberate gap at the bottom. */
export const ScoreDial: React.FC<{
  score: number;
  delay?: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
}> = ({ score, delay = 0, size = 300, stroke = 18, color = colors.positive, track = colors.hairline }) => {
  const p = useEnter(delay, 'gentle');
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const arc = 0.75; // 270 of 360 degrees
  const value = (score / 100) * p;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(135deg)' }}>
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${circumference * arc} ${circumference}`}
      />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${circumference * arc * value} ${circumference}`}
      />
    </svg>
  );
};

/** Where the asking price sits inside the fair-value band. */
export const RangeMarker: React.FC<{
  low: number; high: number; marker: number; min: number; max: number; delay?: number; width: number;
}> = ({ low, high, marker, min, max, delay = 0, width }) => {
  const p = useEnter(delay, 'gentle');
  const f = (v: number) => ((v - min) / (max - min)) * width;
  return (
    <svg width={width} height={26}>
      <rect x={0} y={11} width={width} height={4} rx={2} fill={colors.hairline} />
      <rect x={f(low)} y={11} width={Math.max(4, f(high) - f(low))} height={4} rx={2} fill={colors.hairlineStrong} />
      <rect
        x={interpolate(p, [0, 1], [f(min), f(marker)]) - 3}
        y={0} width={6} height={26} rx={3} fill={colors.inkStrong}
      />
    </svg>
  );
};

export const Label: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({
  children, style,
}) => (
  <div
    style={{
      fontFamily: font,
      fontSize: 26,
      fontWeight: 600,
      letterSpacing: 1.8,
      textTransform: 'uppercase',
      color: colors.inkMuted,
      ...style,
    }}
  >
    {children}
  </div>
);
