import { describe, expect, it } from 'vitest';
import { SampleRing } from './ringBuffer';

describe('SampleRing', () => {
  it('holds samples in order and reports its extent', () => {
    const ring = new SampleRing(8);
    for (let i = 0; i < 5; i++) ring.push(i * 10, i);

    expect(ring.count).toBe(5);
    expect(ring.oldestTimestamp).toBe(0);
    expect(ring.newestTimestamp).toBe(40);
    expect(ring.valueAt(2)).toBe(2);
  });

  it('evicts the oldest once full rather than growing', () => {
    // Bounded by construction. An unbounded buffer in a process that runs for hours is a
    // memory leak with extra steps.
    const ring = new SampleRing(4);
    for (let i = 0; i < 10; i++) ring.push(i * 10, i);

    expect(ring.count).toBe(4);
    expect(ring.oldestTimestamp).toBe(60);
    expect(ring.newestTimestamp).toBe(90);
    expect(ring.valueAt(0)).toBe(6);
    expect(ring.valueAt(3)).toBe(9);
  });

  it('bumps the sequence once per batch so one redraw follows, not one per sample', () => {
    // The animation callback redraws when seq moves. A batch of 300 samples arriving at once
    // must cost one frame of work, not 300.
    const ring = new SampleRing(1024);
    const before = ring.seq;

    const timestamps = Array.from({ length: 300 }, (_, i) => i);
    const values = Array.from({ length: 300 }, () => 6.94);
    ring.pushMany(timestamps, values);

    expect(ring.count).toBe(300);
    expect(ring.seq).toBe(before + 1);
  });

  it('finds the first sample at or after a timestamp', () => {
    const ring = new SampleRing(16);
    for (let i = 0; i < 10; i++) ring.push(i * 100, i);

    expect(ring.indexAtOrAfter(0)).toBe(0);
    expect(ring.indexAtOrAfter(450)).toBe(5);
    expect(ring.indexAtOrAfter(500)).toBe(5);
    expect(ring.indexAtOrAfter(10_000)).toBe(ring.count);
  });

  it('searches correctly after wrapping', () => {
    const ring = new SampleRing(4);
    for (let i = 0; i < 10; i++) ring.push(i * 100, i);

    // Holds 600..900.
    expect(ring.indexAtOrAfter(650)).toBe(1);
    expect(ring.timestampAt(ring.indexAtOrAfter(650))).toBe(700);
  });

  it('copies a time range into caller-owned arrays', () => {
    const ring = new SampleRing(64);
    for (let i = 0; i < 50; i++) ring.push(i * 10, i);

    const t = new Float64Array(64);
    const v = new Float32Array(64);
    const n = ring.copyRange(100, 200, t, v);

    expect(n).toBe(11);
    expect(t[0]).toBe(100);
    expect(v[0]).toBe(10);
    expect(t[n - 1]).toBe(200);
  });

  it('rejects a nonsensical capacity rather than failing later', () => {
    expect(() => new SampleRing(0)).toThrow(RangeError);
    expect(() => new SampleRing(-1)).toThrow(RangeError);
    expect(() => new SampleRing(1.5)).toThrow(RangeError);
  });

  it('reports empty extents as NaN rather than zero', () => {
    // Zero is a plausible timestamp. NaN forces the caller to handle emptiness.
    const ring = new SampleRing(4);
    expect(Number.isNaN(ring.oldestTimestamp)).toBe(true);
    expect(Number.isNaN(ring.newestTimestamp)).toBe(true);
    expect(ring.indexAtOrAfter(0)).toBe(0);
  });
});
