import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Availability, Quality, UnavailableReason, hasValue } from './availability';
import { connectBridge, isHosted, toMetricValue, type BridgeMetric } from './bridge';

describe('toMetricValue', () => {
  it('carries a real reading through unchanged', () => {
    const metric: BridgeMetric = {
      metric: 'CpuLoadTotal',
      state: Availability.Available,
      quality: Quality.Exact,
      reason: UnavailableReason.None,
      value: 41.5,
    };

    const value = toMetricValue(metric);

    expect(hasValue(value)).toBe(true);
    if (hasValue(value)) expect(value.value).toBe(41.5);
  });

  it('preserves the reason for a metric with no sensor', () => {
    const value = toMetricValue({
      metric: 'CpuTemperature',
      state: Availability.Unavailable,
      quality: Quality.Exact,
      reason: UnavailableReason.RequiresSensorDriver,
    });

    expect(hasValue(value)).toBe(false);
    if (!hasValue(value)) expect(value.reason).toBe(UnavailableReason.RequiresSensorDriver);
  });

  it('keeps denied distinct, because the user can act on it', () => {
    const value = toMetricValue({
      metric: 'FrameTime',
      state: Availability.Denied,
      quality: Quality.Exact,
      reason: UnavailableReason.InsufficientPrivilege,
    });

    expect(value.state).toBe(Availability.Denied);
  });

  it('treats a claimed reading with no number as absent, never as zero', () => {
    // The failure this function exists to contain. A sending-side bug that drops the value must
    // not become a fabricated measurement at exactly the moment the pipeline is misbehaving.
    const value = toMetricValue({
      metric: 'GpuTemperature',
      state: Availability.Available,
      quality: Quality.Exact,
      reason: UnavailableReason.None,
    });

    expect(hasValue(value)).toBe(false);
    if (!hasValue(value)) expect(value.reason).toBe(UnavailableReason.SourceFaulted);
  });

  it('rejects a non-finite number rather than plotting it', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const converted = toMetricValue({
        metric: 'DiskLatency',
        state: Availability.Available,
        quality: Quality.Exact,
        reason: UnavailableReason.None,
        value,
      });

      expect(hasValue(converted)).toBe(false);
    }
  });

  it('keeps a genuine zero, which is a measurement', () => {
    const value = toMetricValue({
      metric: 'MemoryHardFaults',
      state: Availability.Available,
      quality: Quality.Exact,
      reason: UnavailableReason.None,
      value: 0,
    });

    expect(hasValue(value)).toBe(true);
    if (hasValue(value)) expect(value.value).toBe(0);
  });

  it('carries a stale reading with its degraded quality', () => {
    const value = toMetricValue({
      metric: 'GpuPower',
      state: Availability.Stale,
      quality: Quality.Degraded,
      reason: UnavailableReason.None,
      value: 212,
    });

    expect(value.state).toBe(Availability.Stale);
    if (hasValue(value)) expect(value.quality).toBe(Quality.Degraded);
  });
});

describe('connectBridge', () => {
  // The suite runs under Node, which has no window. A stub is enough: this module touches only
  // window.chrome.webview, and testing it against a full DOM would be testing jsdom.
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = globalThis;
  });

  afterEach(() => {
    delete (globalThis as { chrome?: unknown }).chrome;
    delete (globalThis as { window?: unknown }).window;
  });

  it('returns null outside the shell, so the dev server and screenshots still work', () => {
    expect(isHosted()).toBe(false);
    expect(connectBridge({ onTick: () => {}, onConnectionChange: () => {} })).toBeNull();
  });

  it('delivers ticks and connection changes when hosted', () => {
    const listeners: Array<(event: { data: unknown }) => void> = [];
    window.chrome = {
      webview: {
        addEventListener: (_type, handler) => listeners.push(handler),
        removeEventListener: () => {},
        // This module never sends. The stub carries the member so the host type stays one
        // shape — a second, narrower shape here would let the real one grow unnoticed.
        postMessage: () => {},
      },
    };

    const onTick = vi.fn();
    const onConnectionChange = vi.fn();

    {
      const disconnect = connectBridge({ onTick, onConnectionChange });
      expect(disconnect).not.toBeNull();

      listeners[0]({ data: { kind: 'connection', connected: true } });
      expect(onConnectionChange).toHaveBeenCalledWith(true);

      listeners[0]({
        data: { kind: 'tick', sequence: 7, degraded: true, skipped: 3, metrics: [] },
      });
      expect(onTick).toHaveBeenCalledWith(
        expect.objectContaining({ sequence: 7, degraded: true, skipped: 3 }),
      );
    }
  });

  it('drops a malformed message rather than putting undefined into a chart', () => {
    // A gap in a chart reads as a dropout in the user's machine. It must never come from us.
    const listeners: Array<(event: { data: unknown }) => void> = [];
    window.chrome = {
      webview: {
        addEventListener: (_type, handler) => listeners.push(handler),
        removeEventListener: () => {},
        // This module never sends. The stub carries the member so the host type stays one
        // shape — a second, narrower shape here would let the real one grow unnoticed.
        postMessage: () => {},
      },
    };

    const onTick = vi.fn();

    {
      connectBridge({ onTick, onConnectionChange: () => {} });

      listeners[0]({ data: null });
      listeners[0]({ data: 'tick' });
      listeners[0]({ data: { kind: 'tick' } });
      listeners[0]({ data: { kind: 'connection' } });
      listeners[0]({ data: { kind: 'something-else', metrics: [] } });

      expect(onTick).not.toHaveBeenCalled();
    }
  });
});
