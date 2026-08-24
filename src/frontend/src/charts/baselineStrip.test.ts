import { describe, expect, it } from 'vitest';
import { stripGeometry } from './baselineStrip';

const H = 100;

describe('stripGeometry', () => {
  it('places the lowest value at the bottom and the highest at the top', () => {
    const g = stripGeometry(
      [
        { id: 'a', valueMs: 8 },
        { id: 'b', valueMs: 10 },
      ],
      null,
      null,
      H,
    );

    expect(g.points[0].y).toBeGreaterThan(g.points[1].y!);
  });

  it('keeps the band inside the plot even when every session sits far outside it', () => {
    // The reading this must not allow: points floating against a band clipped off the chart.
    const g = stripGeometry([{ id: 'a', valueMs: 40 }], 8, 0.6, H);

    expect(g.bandTopY).toBeGreaterThanOrEqual(0);
    expect(g.bandBottomY).toBeLessThanOrEqual(H);
    expect(g.points[0].y).toBeGreaterThanOrEqual(0);
  });

  it('does not divide by zero on a run of identical sessions', () => {
    const g = stripGeometry(
      [
        { id: 'a', valueMs: 8.3 },
        { id: 'b', valueMs: 8.3 },
        { id: 'c', valueMs: 8.3 },
      ],
      8.3,
      0.1,
      H,
    );

    for (const p of g.points) expect(Number.isFinite(p.y!)).toBe(true);
    expect(Number.isFinite(g.centreY!)).toBe(true);
  });

  it('centres a single session rather than pinning it to an edge', () => {
    const g = stripGeometry([{ id: 'a', valueMs: 8.3 }], null, null, H);

    expect(g.points[0].x).toBe(0.5);
  });

  it('plots a session with no median as absent rather than at zero', () => {
    // A missing median drawn at the bottom of the axis would read as the fastest session in the
    // history.
    const g = stripGeometry(
      [
        { id: 'a', valueMs: 8.3 },
        { id: 'b', valueMs: null },
      ],
      8.3,
      0.1,
      H,
    );

    expect(g.points[1].y).toBeNull();
    expect(g.points[1].valueMs).toBeNull();
  });

  it('produces no band when there is no baseline', () => {
    const g = stripGeometry([{ id: 'a', valueMs: 8.3 }], null, null, H);

    expect(g.centreY).toBeNull();
    expect(g.bandTopY).toBeNull();
    expect(g.bandBottomY).toBeNull();
  });

  it('survives a history with nothing measurable in it', () => {
    const g = stripGeometry([{ id: 'a', valueMs: null }], null, null, H);

    expect(g.points[0].y).toBeNull();
    expect(Number.isFinite(g.minMs)).toBe(true);
  });

  it('never emits a non-finite coordinate', () => {
    const g = stripGeometry(
      [
        { id: 'a', valueMs: 6.9 },
        { id: 'b', valueMs: 9.7 },
        { id: 'c', valueMs: null },
      ],
      6.95,
      0.1,
      H,
    );

    const numbers = [
      ...g.points.map((p) => p.y).filter((y): y is number => y !== null),
      g.centreY!,
      g.bandTopY!,
      g.bandBottomY!,
      g.minMs,
      g.maxMs,
    ];

    for (const n of numbers) expect(Number.isFinite(n)).toBe(true);
  });
});
