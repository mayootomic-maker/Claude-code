import { Availability, Quality, UnavailableReason, type MetricValue } from './availability';

/**
 * The messages the WPF shell posts into the web view.
 *
 * Deliberately mirrors the .NET side field for field rather than being a convenient shape for
 * the UI. Anything reshaped here is reshaped in two places and will eventually be reshaped in
 * two different ways; the components adapt to this, not the reverse.
 */
export interface BridgeMetric {
  readonly metric: string;
  readonly state: Availability;
  readonly quality: Quality;
  readonly reason: UnavailableReason;
  readonly instance?: number;
  /**
   * Absent when the metric has no reading.
   *
   * Not `null`, not `NaN`, not `0`. The .NET side omits the key entirely, which is what makes
   * the absent case impossible to read as a number by accident.
   */
  readonly value?: number;
}

export interface TickMessage {
  readonly kind: 'tick';
  readonly sequence: number;
  /** Samples were dropped upstream. The UI must show reduced fidelity, not interpolate over it. */
  readonly degraded: boolean;
  readonly afterDiscontinuity: boolean;
  readonly skipped: number;
  readonly metrics: readonly BridgeMetric[];
}

export interface ConnectionMessage {
  readonly kind: 'connection';
  readonly connected: boolean;
}

export type BridgeMessage = TickMessage | ConnectionMessage;

/** The subset of the WebView2 host object this file uses. */
interface WebViewHost {
  addEventListener(type: 'message', handler: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', handler: (event: { data: unknown }) => void): void;
  /** The only way this page makes anything happen. Used by `control.ts` and nowhere else. */
  postMessage(message: unknown): void;
}

declare global {
  interface Window {
    chrome?: { webview?: WebViewHost };
  }
}

/** Whether this page is running inside the FrameDoctor shell rather than a plain browser. */
export function isHosted(): boolean {
  return typeof window !== 'undefined' && window.chrome?.webview !== undefined;
}

/**
 * Converts a bridge metric into the UI's honest value type.
 *
 * The one function where a mistake would undo every guarantee upstream: a missing `value` must
 * become an absent reading, never a zero. It is written to fail closed — anything that is not
 * unambiguously a finite number is absence.
 */
export function toMetricValue(metric: BridgeMetric): MetricValue {
  const hasReading =
    metric.state === Availability.Available || metric.state === Availability.Stale;

  if (hasReading && typeof metric.value === 'number' && Number.isFinite(metric.value)) {
    return {
      state: metric.state,
      value: metric.value,
      quality: metric.quality,
    };
  }

  // A state that claims a reading but carries no number is a bug on the sending side. Rendering
  // it as absent is the only safe reading: the alternative is a fabricated measurement, and it
  // would be fabricated at exactly the moment the pipeline was misbehaving.
  const reason = hasReading ? UnavailableReason.SourceFaulted : metric.reason;

  const state =
    metric.state === Availability.Denied || metric.state === Availability.Failed
      ? metric.state
      : Availability.Unavailable;

  return { state, reason };
}

export interface BridgeHandlers {
  readonly onTick: (tick: TickMessage) => void;
  readonly onConnectionChange: (connected: boolean) => void;
}

/**
 * Subscribes to the shell's telemetry stream.
 *
 * @returns a function that unsubscribes, or `null` when this page is not hosted by the shell —
 * which is the normal case in the development server and in the screenshot harness.
 */
export function connectBridge(handlers: BridgeHandlers): (() => void) | null {
  const host = window.chrome?.webview;
  if (!host) return null;

  const handler = (event: { data: unknown }) => {
    const message = parse(event.data);
    if (!message) return;

    if (message.kind === 'connection') handlers.onConnectionChange(message.connected);
    else handlers.onTick(message);
  };

  host.addEventListener('message', handler);
  return () => host.removeEventListener('message', handler);
}

/**
 * Validates a message from the host.
 *
 * The shell is trusted, but the boundary is still a boundary: a malformed message is dropped
 * rather than allowed to put `undefined` into a chart, where it would render as a gap the user
 * would read as a dropout in their own machine.
 */
function parse(data: unknown): BridgeMessage | null {
  if (typeof data !== 'object' || data === null) return null;

  // Not `Partial<TickMessage & ConnectionMessage>`: intersecting the two literal `kind` types
  // gives `never`, which silently narrows every later access to nothing.
  const message = data as {
    kind?: unknown;
    connected?: unknown;
    sequence?: unknown;
    degraded?: unknown;
    afterDiscontinuity?: unknown;
    skipped?: unknown;
    metrics?: unknown;
  };

  if (message.kind === 'connection') {
    return typeof message.connected === 'boolean'
      ? { kind: 'connection', connected: message.connected }
      : null;
  }

  if (message.kind !== 'tick' || !Array.isArray(message.metrics)) return null;

  return {
    kind: 'tick',
    sequence: typeof message.sequence === 'number' ? message.sequence : 0,
    degraded: message.degraded === true,
    afterDiscontinuity: message.afterDiscontinuity === true,
    skipped: typeof message.skipped === 'number' ? message.skipped : 0,
    metrics: message.metrics as readonly BridgeMetric[],
  };
}
