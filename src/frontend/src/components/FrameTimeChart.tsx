import { useEffect, useRef, type JSX } from 'react';
import { FrameTimeChartRenderer } from '../charts/frameTimeChart';
import type { SampleRing } from '../telemetry/ringBuffer';
import type { DetectedEvent } from '../telemetry/scenario';

interface FrameTimeChartProps {
  readonly ring: SampleRing;
  /** Current playhead in session milliseconds. */
  readonly nowMs: number;
  readonly windowSeconds: number;
  readonly refreshIntervalMs: number;
  readonly baselineMs: number | null;
  readonly thresholdMs: number | null;
  readonly events: readonly DetectedEvent[];
  readonly selectedEventStartMs: number | null;
  readonly onSelectEvent: (event: DetectedEvent) => void;
}

/** Reads a CSS custom property off the document root. */
function token(name: string, fallback: string): string {
  if (typeof getComputedStyle !== 'function') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * The frame-time timeline: the largest element on the Live view, because it is the product.
 *
 * React renders the frame and the event ribbon. It never touches the series — the canvas is
 * driven by a `requestAnimationFrame` loop reading the ring buffer directly, and that loop
 * returns immediately when the ring's sequence number has not moved. A paused game costs
 * nothing.
 */
export function FrameTimeChart({
  ring,
  nowMs,
  windowSeconds,
  refreshIntervalMs,
  baselineMs,
  thresholdMs,
  events,
  selectedEventStartMs,
  onSelectEvent,
}: FrameTimeChartProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<FrameTimeChartRenderer | null>(null);
  const lastSeqRef = useRef(-1);
  const lastNowRef = useRef(Number.NaN);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    rendererRef.current = new FrameTimeChartRenderer(
      canvas,
      {
        background: token('--chart-plot-bg', '#0b0e13'),
        gridLine: token('--chart-grid', '#1b212b'),
        axisText: token('--chart-axis', '#7a8494'),
        envelope: token('--chart-envelope', '#4e78a8'),
        trace: token('--chart-trace', '#c9d4e3'),
        referenceLine: token('--chart-refresh', '#7a8494'),
        thresholdLine: token('--chart-threshold', '#8f7233'),
        clipped: token('--sev-critical', '#f26761'),
      },
      {
        windowSeconds,
        defaultCeilingMs: Math.max(25, refreshIntervalMs * 3.6),
        minFloorMs: 0.5,
        refreshIntervalMs,
        thresholdMs,
      },
    );

    let handle = 0;
    const tick = () => {
      const renderer = rendererRef.current;
      if (renderer) {
        // The whole point of the sequence counter: skip the draw entirely when nothing has
        // arrived and the playhead has not moved.
        if (ring.seq !== lastSeqRef.current || nowMs !== lastNowRef.current) {
          lastSeqRef.current = ring.seq;
          lastNowRef.current = nowMs;
          renderer.draw(ring, nowMs);
        }
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(handle);
  }, [ring, nowMs, windowSeconds, refreshIntervalMs, thresholdMs]);

  // Force a redraw when the playhead moves, e.g. when seeking rather than playing.
  useEffect(() => {
    lastSeqRef.current = -1;
  }, [nowMs, windowSeconds]);

  const windowMs = windowSeconds * 1000;
  const fromMs = nowMs - windowMs;
  const visible = events.filter((e) => e.endMs >= fromMs && e.startMs <= nowMs);

  return (
    <div className="chart">
      <div className="chart__header">
        <span className="t-label">
          Frame time — last {windowSeconds} s
          {/*
            The axis is logarithmic and says so. Frame-time series span more than a decade in
            ordinary play, and a compressed axis that hides the fact would let a 15× hitch read
            as a modest bump.
          */}
          <span className="chart__scale t-label-sm" title="Logarithmic y-axis: frame times span more than a decade, so a linear axis would flatten the baseline">
            log ms
          </span>
        </span>
        <span className="chart__legend t-label-sm">
          <span className="chart__key chart__key--envelope" /> min/max per column
          {baselineMs !== null ? (
            <>
              <span className="chart__key chart__key--baseline" /> baseline {baselineMs.toFixed(1)} ms
            </>
          ) : null}
          <span className="chart__key chart__key--refresh" /> refresh {refreshIntervalMs.toFixed(2)} ms
        </span>
      </div>

      <div className="chart__plot">
        <canvas ref={canvasRef} className="chart__canvas" />
      </div>

      {/*
        Markers live in their own strip below the plot, never overlaid on the trace. Overlaying
        them is how a frame-time chart becomes unreadable during exactly the sessions that
        matter most.
      */}
      <div className="chart__ribbon" role="list" aria-label="Detected events">
        {visible.map((event) => {
          const left = ((event.startMs - fromMs) / windowMs) * 100;
          const selected = event.startMs === selectedEventStartMs;
          return (
            <button
              key={event.startMs}
              type="button"
              role="listitem"
              className="chart__marker"
              data-class={event.className.toLowerCase()}
              data-selected={selected || undefined}
              style={{ left: `${Math.min(99.5, Math.max(0, left))}%` }}
              onClick={() => onSelectEvent(event)}
              title={`${event.className} — ${event.peakFrameTimeMs.toFixed(0)} ms`}
              aria-label={`${event.className} at ${(event.startMs / 1000).toFixed(1)} seconds, peak ${event.peakFrameTimeMs.toFixed(0)} milliseconds`}
            />
          );
        })}
      </div>

      <div className="chart__axis t-mono-sm">
        <span>−{windowSeconds}s</span>
        <span>−{Math.round(windowSeconds * 0.75)}s</span>
        <span>−{Math.round(windowSeconds * 0.5)}s</span>
        <span>−{Math.round(windowSeconds * 0.25)}s</span>
        <span>now</span>
      </div>
    </div>
  );
}
