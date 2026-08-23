import { describe, expect, it } from 'vitest';
import { hasValue, available, stale } from './availability';
import { normalizeScenario } from './scenario';

/**
 * The boundary where a serializer's omitted key became a lie on screen.
 *
 * The .NET side omits null properties, which is right — an absent key cannot be misread as a
 * number. The mistake was consuming that with a bare cast: every guard downstream is written
 * against `null`, and `undefined !== null` is `true`, so every one of them passed. The result
 * was `NaN%` where a confidence belongs, under the heading "Most likely cause", on an event the
 * engine had explicitly declined to explain.
 */
describe('normalizeScenario', () => {
  const bare = {
    id: 'x',
    title: 'X',
    description: '',
    refreshRateHz: 144,
    frameCount: 0,
    durationMs: 0,
    stutterCount: 0,
    severeStutterCount: 0,
  };

  it('turns every absent optional number into a real null', () => {
    const scenario = normalizeScenario(bare);

    expect(scenario.medianFrameTimeMs).toBeNull();
    expect(scenario.p99FrameTimeMs).toBeNull();
    expect(scenario.low1PercentFps).toBeNull();
    expect(scenario.sensitivityFloorMs).toBeNull();
    expect(scenario.explanationRate).toBeNull();
  });

  it('turns an absent explanation rate into null rather than leaving it undefined', () => {
    // The exact field that rendered "explanation rate NaN%" on the healthy session.
    const scenario = normalizeScenario(bare);

    expect(scenario.explanationRate).not.toBeUndefined();
    expect(scenario.explanationRate).toBeNull();
  });

  it('treats an event with no rule as unexplained, with no confidence', () => {
    const scenario = normalizeScenario({
      ...bare,
      events: [{ startMs: 0, endMs: 0, className: 'SevereHitch', whatHappened: '' }],
    });

    expect(scenario.events[0].ruleId).toBeNull();
    expect(scenario.events[0].confidence).toBeNull();
  });

  it('discards a confidence that arrives without a rule to attach it to', () => {
    // A number attached to no claim. Rendering it would put a percentage beside the word
    // "Unexplained".
    const scenario = normalizeScenario({
      ...bare,
      events: [{ startMs: 0, endMs: 0, className: 'Stutter', whatHappened: '', confidence: 0.8 }],
    });

    expect(scenario.events[0].confidence).toBeNull();
  });

  it('keeps a real confidence that has a rule behind it', () => {
    const scenario = normalizeScenario({
      ...bare,
      events: [
        {
          startMs: 0,
          endMs: 0,
          className: 'Stutter',
          whatHappened: '',
          ruleId: 'gpu-power-limit',
          confidence: 0.75,
        },
      ],
    });

    expect(scenario.events[0].ruleId).toBe('gpu-power-limit');
    expect(scenario.events[0].confidence).toBe(0.75);
  });

  it('treats a non-finite number as absent', () => {
    // JSON cannot carry NaN, but the exporter permits named floating-point literals and a
    // hand-edited fixture can. A NaN reaching toFixed renders the string "NaN" where a
    // measurement belongs.
    const scenario = normalizeScenario({ ...bare, p99FrameTimeMs: Number.NaN });

    expect(scenario.p99FrameTimeMs).toBeNull();
  });

  it('keeps a genuine zero, which is a measurement', () => {
    expect(normalizeScenario({ ...bare, explanationRate: 0 }).explanationRate).toBe(0);
  });

  it('gives absent collections an empty array rather than undefined', () => {
    const scenario = normalizeScenario(bare);

    expect(scenario.events).toEqual([]);
    expect(scenario.series).toEqual([]);
    expect(scenario.frameTimes).toEqual([]);
  });

  it('never leaves a value that would render as NaN', () => {
    // The property, stated directly: after normalization there is no path from a bare fixture to
    // a NaN on screen.
    const scenario = normalizeScenario({
      ...bare,
      events: [{ startMs: 0, endMs: 0, className: 'Stutter', whatHappened: '' }],
    });

    const numbers = [
      scenario.medianFrameTimeMs,
      scenario.p99FrameTimeMs,
      scenario.low1PercentFps,
      scenario.sensitivityFloorMs,
      scenario.explanationRate,
      scenario.events[0].confidence,
    ];

    for (const n of numbers) {
      expect(Number.isNaN(n as number)).toBe(false);
      expect(n === undefined).toBe(false);
    }
  });
});

describe('available', () => {
  it('refuses a value that is not a finite number', () => {
    // hasValue tests the state, not the value, so an {Available, undefined} passed every guard
    // and reached .toFixed() — a blank screen, or a headline number rendered from nothing.
    expect(hasValue(available(undefined as unknown as number))).toBe(false);
    expect(hasValue(available(Number.NaN))).toBe(false);
    expect(hasValue(available(Number.POSITIVE_INFINITY))).toBe(false);
    expect(hasValue(stale(undefined as unknown as number, 100))).toBe(false);
  });

  it('still accepts a genuine zero', () => {
    const metric = available(0);

    expect(hasValue(metric)).toBe(true);
    if (hasValue(metric)) expect(metric.value).toBe(0);
  });
});
