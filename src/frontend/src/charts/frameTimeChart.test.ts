import { describe, expect, it } from 'vitest';
import { formatTick, logTicks, logY, niceCeiling, niceFloor } from './frameTimeChart';

describe('niceCeiling', () => {
  it('lands on the next 1-2-5 tick strictly above the peak', () => {
    expect(niceCeiling(6.9)).toBe(10);
    expect(niceCeiling(10)).toBe(20);
    expect(niceCeiling(104)).toBe(200);
    expect(niceCeiling(25)).toBe(50);
    expect(niceCeiling(0.4)).toBe(0.5);
  });

  it('never returns a ceiling at or below the peak, so a peak is never clipped', () => {
    for (let ms = 0.1; ms < 500; ms *= 1.07) {
      expect(niceCeiling(ms)).toBeGreaterThan(ms);
    }
  });

  it('degrades to a usable axis rather than NaN for nonsense input', () => {
    expect(niceCeiling(0)).toBe(1);
    expect(niceCeiling(Number.NaN)).toBe(1);
    expect(niceCeiling(-5)).toBe(1);
  });
});

describe('logY', () => {
  const height = 200;

  it('puts the floor at the bottom and the ceiling at the top', () => {
    expect(logY(1, 1, 100, height)).toBe(height);
    expect(logY(100, 1, 100, height)).toBe(0);
  });

  it('places a decade at an equal fraction of the plot regardless of magnitude', () => {
    // The defining property of the axis: 1→10 occupies exactly as much height as 10→100.
    const lower = logY(1, 1, 100, height) - logY(10, 1, 100, height);
    const upper = logY(10, 1, 100, height) - logY(100, 1, 100, height);
    expect(lower).toBeCloseTo(upper, 9);
  });

  it('lifts a 6.9 ms baseline clear of the axis even with a 104 ms spike in the window', () => {
    // The regression this axis exists for. On a linear axis the baseline sat at 97% height,
    // indistinguishable from the axis line itself.
    const y = logY(6.9, 1, niceCeiling(104), height);
    const fromBottom = (height - y) / height;
    expect(fromBottom).toBeGreaterThan(0.25);
    expect(fromBottom).toBeLessThan(0.75);
  });

  it('pins out-of-range values to the edges instead of running off the canvas', () => {
    expect(logY(0, 1, 100, height)).toBe(height);
    expect(logY(0.001, 1, 100, height)).toBe(height);
    expect(logY(100000, 1, 100, height)).toBe(0);
  });

  it('returns the bottom rather than NaN for a degenerate range', () => {
    expect(logY(5, 10, 10, height)).toBe(height);
    expect(logY(5, 0, 100, height)).toBe(height);
  });
});

describe('logTicks', () => {
  it('excludes the endpoints, whose gridlines would be invisible', () => {
    const ticks = logTicks(1, 100);
    expect(ticks).not.toContain(1);
    expect(ticks).not.toContain(100);
    expect(ticks).toEqual([2, 5, 10, 20, 50]);
  });

  it('keeps every tick strictly inside the range', () => {
    for (const ceiling of [10, 20, 50, 100, 200, 500]) {
      for (const ms of logTicks(1, ceiling)) {
        expect(ms).toBeGreaterThan(1);
        expect(ms).toBeLessThan(ceiling);
      }
    }
  });

  it('thins to decades rather than producing a grey block over a wide range', () => {
    const ticks = logTicks(0.1, 10000);
    expect(ticks.length).toBeLessThanOrEqual(12);
    expect(ticks).toContain(1);
    expect(ticks).toContain(100);
  });

  it('returns nothing for a range that cannot hold a tick', () => {
    expect(logTicks(10, 10)).toEqual([]);
    expect(logTicks(0, 100)).toEqual([]);
    expect(logTicks(1, 1.5)).toEqual([]);
  });

  it('emits exact values, not floating-point debris', () => {
    // 2 * 10 ** -1 is 0.2 only after rounding; an unrounded tick would label as 0.30000000000000004.
    for (const ms of logTicks(0.1, 5)) {
      expect(formatTick(ms)).toMatch(/^\d+(\.\d)?$/);
    }
  });
});

describe('niceFloor', () => {
  it('lands on the largest 1-2-5 tick at or below the value', () => {
    expect(niceFloor(3.47)).toBe(2);
    expect(niceFloor(8.33)).toBe(5);
    expect(niceFloor(6.9)).toBe(5);
    expect(niceFloor(10)).toBe(10);
    expect(niceFloor(0.9)).toBe(0.5);
  });

  it('never returns a floor above the value, so a fast frame is never pushed off-scale', () => {
    for (let ms = 0.2; ms < 100; ms *= 1.07) {
      expect(niceFloor(ms)).toBeLessThanOrEqual(ms);
    }
  });

  it('degrades to a usable axis rather than NaN for nonsense input', () => {
    expect(niceFloor(0)).toBe(1);
    expect(niceFloor(Number.NaN)).toBe(1);
    expect(niceFloor(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('reclaims the dead band a fixed 1 ms floor wastes at 144 Hz', () => {
    // Half a 6.94 ms refresh interval. With a 1 ms floor, 1-3 ms is a third of the plot that
    // no game ever draws in.
    const floor = niceFloor(6.94 / 2);
    const height = 200;
    const baselineFraction = (height - logY(6.9, floor, 100, height)) / height;
    expect(baselineFraction).toBeGreaterThan(0.28);
  });
});
