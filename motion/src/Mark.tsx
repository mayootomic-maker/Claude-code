import React from 'react';
import { colors } from './theme';
import { useEnter } from './motion';

/**
 * The Margin mark: two margin rules with an ascending measure between them, the same
 * geometry as the Android launcher icon.
 */
export const Mark: React.FC<{ size?: number; delay?: number; light?: boolean }> = ({
  size = 180, delay = 0, light = false,
}) => {
  const p = useEnter(delay, 'gentle');
  const rule = light ? colors.inkFaint : colors.hairlineStrong;
  const ink = light ? colors.onInk : colors.inkStrong;
  return (
    <svg width={size} height={size} viewBox="0 0 108 108">
      <g opacity={p}>
        <rect x="34" y="32" width="3.2" height="44" fill={rule} />
        <rect x="70.8" y="32" width="3.2" height="44" fill={rule} />
      </g>
      <g
        style={{
          transform: `scaleX(${p})`,
          transformOrigin: '40px 60px',
        }}
      >
        <path
          d="M40.5,68.2 L52.4,56.2 L58.6,62.4 L71.6,47.6 L75.2,50.8 L58.9,69.3 L52.7,63.1 L44,71.8 z"
          fill={ink}
        />
        <rect x="40.5" y="74.6" width="27" height="3.4" fill={colors.positive} />
      </g>
    </svg>
  );
};
