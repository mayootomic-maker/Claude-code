import React from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame, interpolate, Easing } from 'remotion';
import { colors, font, chf } from './theme';
import { CountUp, Label, RangeMarker, Reveal, ScoreDial, useEnter } from './motion';
import { Mark } from './Mark';

const W = 1080;

const Screen: React.FC<{ children: React.ReactNode; dark?: boolean }> = ({ children, dark }) => (
  <AbsoluteFill
    style={{
      backgroundColor: dark ? '#0B0B0A' : colors.canvas,
      fontFamily: font,
      padding: 96,
      justifyContent: 'center',
    }}
  >
    {children}
  </AbsoluteFill>
);

/** A hairline-separated row, the app's core list primitive. */
const Row: React.FC<{
  title: string; sub: string; value: string; score?: number; verdict?: string;
  verdictColor?: string; delay: number;
}> = ({ title, sub, value, score, verdict, verdictColor, delay }) => (
  <Reveal delay={delay}>
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 28,
        padding: '30px 0', borderBottom: `2px solid ${colors.hairline}`,
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 38, fontWeight: 500, color: colors.inkStrong }}>{title}</div>
        <div style={{ fontSize: 30, color: colors.inkMuted, marginTop: 8 }}>{sub}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div
          style={{
            fontSize: 40, fontWeight: 600, color: verdictColor ?? colors.inkStrong,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {score ?? value}
        </div>
        {verdict ? (
          <div
            style={{
              marginTop: 10, fontSize: 22, fontWeight: 600, letterSpacing: 1.4,
              textTransform: 'uppercase', color: verdictColor,
              background: colors.positiveSoft, padding: '6px 12px', borderRadius: 8,
            }}
          >
            {verdict}
          </div>
        ) : null}
      </div>
    </div>
  </Reveal>
);

// --- Scene 1: the mark -------------------------------------------------------------------

const Open: React.FC = () => {
  const wordmark = useEnter(14, 'standard');
  const tag = useEnter(30, 'standard');
  return (
    <Screen>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
        <Mark size={230} />
        <div
          style={{
            fontSize: 96, fontWeight: 400, letterSpacing: -3, color: colors.inkStrong,
            opacity: wordmark, transform: `translateY(${(1 - wordmark) * 22}px)`,
          }}
        >
          Margin
        </div>
        <div
          style={{
            fontSize: 34, color: colors.inkMuted, opacity: tag,
            transform: `translateY(${(1 - tag) * 16}px)`,
          }}
        >
          Know what it is worth before you pay.
        </div>
      </div>
    </Screen>
  );
};

// --- Scene 2: the question ---------------------------------------------------------------

const Question: React.FC = () => (
  <Screen>
    <Reveal delay={0} travel={34}>
      <div style={{ fontSize: 74, lineHeight: 1.15, fontWeight: 400, color: colors.inkStrong }}>
        You found something.
      </div>
    </Reveal>
    <Reveal delay={12} travel={34}>
      <div style={{ fontSize: 74, lineHeight: 1.15, fontWeight: 400, color: colors.inkFaint }}>
        Is it actually a good buy?
      </div>
    </Reveal>
    <Reveal delay={34}>
      <div
        style={{
          marginTop: 72, padding: 44, borderRadius: 24, background: colors.surface,
          border: `2px solid ${colors.hairline}`,
        }}
      >
        <div style={{ fontSize: 30, color: colors.inkMuted }}>Ricardo · Luzern</div>
        <div style={{ fontSize: 46, fontWeight: 500, color: colors.inkStrong, marginTop: 12 }}>
          Gaming PC Ryzen 5 5600 + RTX 3060
        </div>
        <div
          style={{
            fontSize: 76, fontWeight: 600, color: colors.inkStrong, marginTop: 24,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {chf(375)}
        </div>
      </div>
    </Reveal>
  </Screen>
);

// --- Scene 3: the evaluation -------------------------------------------------------------

const Evaluation: React.FC = () => {
  const badge = useEnter(6, 'reward');
  return (
    <Screen>
      <Reveal delay={0}>
        <Label>Evaluation</Label>
      </Reveal>

      <div style={{ display: 'flex', alignItems: 'center', gap: 56, marginTop: 48 }}>
        <div style={{ flex: 1 }}>
          <div
            style={{
              display: 'inline-block', fontSize: 26, fontWeight: 600, letterSpacing: 1.6,
              textTransform: 'uppercase', color: colors.positive, background: colors.positiveSoft,
              padding: '10px 18px', borderRadius: 10,
              transform: `scale(${0.9 + badge * 0.1})`, opacity: badge,
            }}
          >
            Strong buy
          </div>
          <div
            style={{
              fontSize: 40, color: colors.inkMuted, marginTop: 30,
            }}
          >
            Fair value
          </div>
          <div style={{ fontSize: 92, fontWeight: 600, color: colors.inkStrong, marginTop: 6 }}>
            <CountUp to={580} delay={10} />
          </div>
        </div>
        <div style={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
          <ScoreDial score={86} delay={8} size={280} stroke={20} />
          <div style={{ position: 'absolute', textAlign: 'center' }}>
            <div style={{ fontSize: 84, fontWeight: 600, color: colors.positive }}>
              <CountUp to={86} delay={8} format={(n) => String(Math.round(n))} />
            </div>
            <div style={{ fontSize: 26, color: colors.inkFaint }}>score</div>
          </div>
        </div>
      </div>

      <Reveal delay={24} style={{ marginTop: 56 }}>
        <RangeMarker low={545} high={648} marker={375} min={330} max={700} delay={26} width={W - 192} />
        <div
          style={{
            display: 'flex', justifyContent: 'space-between', marginTop: 14,
            fontSize: 28, color: colors.inkFaint,
          }}
        >
          <span>{chf(545)}</span>
          <span style={{ color: colors.inkMuted }}>asking price is below the range</span>
          <span>{chf(648)}</span>
        </div>
      </Reveal>

      <Reveal delay={38} style={{ marginTop: 60 }}>
        {[
          ['Resale via local marketplace', chf(567)],
          ['Collection and tied-up capital', `−${chf(14).replace('CHF ', 'CHF ')}`],
        ].map(([k, v]) => (
          <div
            key={k}
            style={{
              display: 'flex', justifyContent: 'space-between', padding: '18px 0',
              fontSize: 34, color: colors.inkMuted,
            }}
          >
            <span>{k}</span>
            <span style={{ color: colors.ink, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
          </div>
        ))}
        <div
          style={{
            display: 'flex', justifyContent: 'space-between', paddingTop: 24,
            borderTop: `2px solid ${colors.hairline}`, fontSize: 40, fontWeight: 500,
          }}
        >
          <span style={{ color: colors.inkStrong }}>Net if you flipped it</span>
          <span style={{ color: colors.positive, fontVariantNumeric: 'tabular-nums' }}>
            +{chf(178)}
          </span>
        </div>
      </Reveal>
    </Screen>
  );
};

// --- Scene 4: it remembers ---------------------------------------------------------------

const Memory: React.FC = () => (
  <Screen>
    <Reveal delay={0}>
      <Label>And it remembers</Label>
    </Reveal>
    <Reveal delay={8} style={{ marginTop: 40 }}>
      <div style={{ fontSize: 62, lineHeight: 1.2, color: colors.inkStrong, fontWeight: 400 }}>
        You have passed on three Canyons before.
      </div>
    </Reveal>
    <Reveal delay={22} style={{ marginTop: 64 }}>
      <div
        style={{
          background: colors.surfaceMuted, borderRadius: 22, padding: 44,
          display: 'flex', alignItems: 'center', gap: 22, fontSize: 44,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <span style={{ color: colors.inkMuted }}>Base 50</span>
        <span style={{ color: colors.negative, fontSize: 34 }}>−5 from your history</span>
        <span style={{ color: colors.inkStrong, fontWeight: 600 }}>= 45</span>
      </div>
    </Reveal>
    <Reveal delay={34} style={{ marginTop: 40 }}>
      <div style={{ fontSize: 34, color: colors.inkMuted, lineHeight: 1.4 }}>
        Every decision you make changes the next recommendation, and Margin shows you the
        arithmetic rather than asking you to trust it.
      </div>
    </Reveal>
  </Screen>
);

// --- Scene 5: own and sell ----------------------------------------------------------------

const Portfolio: React.FC = () => (
  <Screen>
    <Reveal delay={0}>
      <Label>Then it follows the money</Label>
    </Reveal>
    <Reveal delay={8} style={{ marginTop: 36 }}>
      <div style={{ fontSize: 112, fontWeight: 600, color: colors.inkStrong }}>
        <CountUp to={2742} delay={10} />
      </div>
      <div style={{ fontSize: 34, color: colors.positive, marginTop: 10 }}>
        +{chf(312)} <span style={{ color: colors.inkMuted }}>unrealised across 3 items</span>
      </div>
    </Reveal>

    <div style={{ marginTop: 60 }}>
      <Row title="Cube Nuroad Hybrid" sub="Paid CHF 1’620" value={chf(1939)} delay={22} />
      <Row title="MacBook Air M1" sub="Listed · no offers yet" value={chf(479)} delay={30} />
      <Row title="Sonos Five" sub="Paid CHF 380" value={chf(324)} delay={38} />
    </div>

    <Reveal delay={52} style={{ marginTop: 64 }}>
      <div
        style={{
          border: `2px solid ${colors.hairlineStrong}`, borderRadius: 22, padding: 40,
        }}
      >
        <div style={{ fontSize: 30, color: colors.inkMuted }}>Sold last month</div>
        <div style={{ fontSize: 44, color: colors.inkStrong, marginTop: 12, lineHeight: 1.35 }}>
          Margin forecast {chf(188)}. You cleared {chf(260)}.
        </div>
        <div style={{ fontSize: 34, color: colors.positive, marginTop: 14, fontWeight: 500 }}>
          +{chf(72)} better than forecast
        </div>
      </div>
    </Reveal>
  </Screen>
);

// --- Scene 6: close ------------------------------------------------------------------------

const Close: React.FC = () => {
  const frame = useCurrentFrame();
  const line = interpolate(frame, [10, 40], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  return (
    <Screen dark>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 30 }}>
        <Mark size={200} light />
        <Reveal delay={8}>
          <div style={{ fontSize: 96, fontWeight: 400, letterSpacing: -3, color: '#F5F3EF' }}>
            Margin
          </div>
        </Reveal>
        <div
          style={{
            height: 2, background: '#302E2A', width: `${line * 480}px`, marginTop: 10,
          }}
        />
        <Reveal delay={26}>
          <div style={{ fontSize: 40, color: '#9A948A', textAlign: 'center', lineHeight: 1.4 }}>
            Buy well. Own well. Sell well.
          </div>
        </Reveal>
      </div>
    </Screen>
  );
};

export const MarginAd: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: colors.canvas }}>
    <Sequence durationInFrames={75}><Open /></Sequence>
    <Sequence from={75} durationInFrames={100}><Question /></Sequence>
    <Sequence from={175} durationInFrames={140}><Evaluation /></Sequence>
    <Sequence from={315} durationInFrames={110}><Memory /></Sequence>
    <Sequence from={425} durationInFrames={145}><Portfolio /></Sequence>
    <Sequence from={570} durationInFrames={90}><Close /></Sequence>
  </AbsoluteFill>
);
