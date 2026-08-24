import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The only channel through which this window makes anything happen.
 *
 * Two failures are asserted against throughout: an answer matched to the wrong question, which
 * would show a value that was never set, and a request left pending forever, which leaves the
 * user looking at a control that has neither moved nor refused to.
 */

type Handler = (event: { data: unknown }) => void;

class FakeHost {
  readonly sent: unknown[] = [];
  private readonly handlers: Handler[] = [];

  addEventListener(_type: 'message', handler: Handler): void {
    this.handlers.push(handler);
  }

  removeEventListener(_type: 'message', handler: Handler): void {
    const i = this.handlers.indexOf(handler);
    if (i >= 0) this.handlers.splice(i, 1);
  }

  postMessage(message: unknown): void {
    this.sent.push(message);
  }

  /** Delivers a message as the shell would. */
  deliver(data: unknown): void {
    for (const handler of [...this.handlers]) handler({ data });
  }

  lastId(): number {
    return (this.sent[this.sent.length - 1] as { id: number }).id;
  }
}

const SETTINGS = {
  highResolutionRetentionDays: 14,
  autoStartOnGameDetected: false,
  keepMeasuringWithWindowClosed: true,
  liveWindowSeconds: 60,
  simulationMode: false,
};

let host: FakeHost;

/** A fresh module per test, because the pending map and the id counter are module state. */
async function load() {
  vi.resetModules();
  return import('./control');
}

// The suite runs under Node, which has no window. A stub is enough: this module touches only
// window.chrome.webview, and testing it against a full DOM would be testing jsdom.
beforeEach(() => {
  vi.useFakeTimers();
  host = new FakeHost();
  (globalThis as { window?: unknown }).window = globalThis;
  window.chrome = { webview: host };
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { chrome?: unknown }).chrome;
  delete (globalThis as { window?: unknown }).window;
});

describe('control', () => {
  it('sends a request and resolves with its answer', async () => {
    const { getSettings } = await load();

    const promise = getSettings();
    host.deliver({ id: host.lastId(), ok: true, settings: SETTINGS });

    const response = await promise;

    expect(response.ok).toBe(true);
    expect(response.settings).toEqual(SETTINGS);
  });

  it('names the command and the value it was asked to set', async () => {
    const { setSetting } = await load();

    void setSetting('retention-days', '30');

    expect(host.sent[0]).toMatchObject({
      command: 'SetSetting',
      key: 'retention-days',
      value: '30',
    });
  });

  it('matches an answer to its own question', async () => {
    // Two requests in flight. An answer attributed to the wrong one shows a value that was
    // never set, which is the failure the id exists to prevent.
    const { send } = await load();

    const first = send('GetSettings');
    const firstId = host.lastId();
    const second = send('Ping');
    const secondId = host.lastId();

    expect(firstId).not.toBe(secondId);

    host.deliver({ id: secondId, ok: true, build: 'second' });
    host.deliver({ id: firstId, ok: true, settings: SETTINGS });

    expect((await second).build).toBe('second');
    expect((await first).settings).toEqual(SETTINGS);
  });

  it('ignores an answer to a question nobody asked', async () => {
    const { getSettings } = await load();

    const promise = getSettings();
    host.deliver({ id: 9999, ok: true, settings: SETTINGS });
    host.deliver({ id: host.lastId(), ok: true, settings: SETTINGS });

    await expect(promise).resolves.toMatchObject({ ok: true });
  });

  it('ignores telemetry ticks arriving on the same event', async () => {
    const { getSettings } = await load();

    const promise = getSettings();
    host.deliver({ kind: 'tick', metrics: [] });
    host.deliver({ kind: 'connection', connected: true });
    host.deliver({ id: host.lastId(), ok: true, settings: SETTINGS });

    await expect(promise).resolves.toMatchObject({ ok: true });
  });

  it('gives up rather than waiting forever', async () => {
    // A control left pending is worse than one that reports a failure: the user is looking at a
    // switch that has neither moved nor refused to.
    const { getSettings } = await load();

    const promise = getSettings();
    await vi.advanceTimersByTimeAsync(30_000);

    const response = await promise;

    expect(response.ok).toBe(false);
    expect(response.error).toContain('did not answer');
  });

  it('does not fire a timeout after an answer arrives', async () => {
    const { getSettings } = await load();

    const promise = getSettings();
    host.deliver({ id: host.lastId(), ok: true, settings: SETTINGS });

    const response = await promise;
    await vi.advanceTimersByTimeAsync(30_000);

    expect(response.ok).toBe(true);
  });

  it('reports a refusal rather than throwing', async () => {
    const { setSetting } = await load();

    const promise = setSetting('retention-days', 'soon');
    host.deliver({
      id: host.lastId(),
      ok: false,
      error: 'retention-days takes a whole number of days, from 1 to 365.',
      settings: SETTINGS,
    });

    const response = await promise;

    expect(response.ok).toBe(false);
    expect(response.error).toContain('whole number');

    // A refusal still carries the real settings, so the screen can put the rejected value back.
    expect(response.settings).toEqual(SETTINGS);
  });

  it('carries a note through, so a clamped value is not reported as the one asked for', async () => {
    const { setSetting } = await load();

    const promise = setSetting('retention-days', '9999');
    host.deliver({
      id: host.lastId(),
      ok: true,
      settings: { ...SETTINGS, highResolutionRetentionDays: 365 },
      note: '9999 is outside what retention-days accepts. Stored 365.',
    });

    const response = await promise;

    expect(response.note).toContain('Stored 365');
    expect(response.settings?.highResolutionRetentionDays).toBe(365);
  });

  it('reads a partial settings object as no settings at all', async () => {
    // Half a settings object would put an undefined behind a number on screen, and the screen
    // would render it as though it were a value.
    const { getSettings } = await load();

    const promise = getSettings();
    host.deliver({ id: host.lastId(), ok: true, settings: { liveWindowSeconds: 60 } });

    expect((await promise).settings).toBeNull();
  });

  it('answers immediately when the page is not hosted', async () => {
    delete (globalThis as { chrome?: unknown }).chrome;
    const { getSettings, canControl } = await load();

    expect(canControl()).toBe(false);

    const response = await getSettings();

    expect(response.ok).toBe(false);
    expect(response.error).toContain('not connected');
  });
});
