import React from 'react';
import { Composition } from 'remotion';
import { MarginAd } from './Ad';

export const RemotionRoot: React.FC = () => (
  <Composition
    id="MarginAd"
    component={MarginAd}
    durationInFrames={660}
    fps={30}
    width={1080}
    height={1920}
  />
);
