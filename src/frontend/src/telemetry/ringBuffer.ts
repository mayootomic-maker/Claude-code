/**
 * A fixed-capacity ring of timestamped samples, deliberately outside React.
 *
 * Telemetry can arrive at 300 Hz or more. Putting it in React state would mean hundreds of
 * commits per second and a reconciliation pass over data the user cannot perceive changing that
 * fast. This buffer is module-scope, never in state, never in a ref React reads, and never
 * behind `useSyncExternalStore` — the chart reads it directly from a `requestAnimationFrame`
 * callback and React learns about it at 10 Hz through derived headline numbers only.
 *
 * The `seq` counter is what makes that cheap: the animation callback compares it against the
 * last value it drew and returns immediately if nothing has arrived. A paused game costs
 * nothing at all.
 */
export class SampleRing {
  private readonly timestamps: Float64Array;
  private readonly values: Float32Array;
  private head = 0;
  private length = 0;

  /** Increments on every write. Compare against a stored copy to skip redundant work. */
  seq = 0;

  /** Samples dropped by the producer before reaching us, reported by the transport. */
  droppedUpstream = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
    }
    this.timestamps = new Float64Array(capacity);
    this.values = new Float32Array(capacity);
  }

  get count(): number {
    return this.length;
  }

  get isFull(): boolean {
    return this.length === this.capacity;
  }

  /** Appends one sample, evicting the oldest once full. */
  push(timestampMs: number, value: number): void {
    const index = (this.head + this.length) % this.capacity;

    if (this.isFull) {
      this.timestamps[this.head] = timestampMs;
      this.values[this.head] = value;
      this.head = (this.head + 1) % this.capacity;
    } else {
      this.timestamps[index] = timestampMs;
      this.values[index] = value;
      this.length++;
    }

    this.seq++;
  }

  /** Appends a batch. One `seq` bump for the whole batch, so one redraw rather than N. */
  pushMany(timestamps: ArrayLike<number>, values: ArrayLike<number>, n = timestamps.length): void {
    const before = this.seq;
    for (let i = 0; i < n; i++) this.push(timestamps[i], values[i]);
    this.seq = before + 1;
  }

  clear(): void {
    this.head = 0;
    this.length = 0;
    this.seq++;
  }

  /** Timestamp at a logical index, oldest first. */
  timestampAt(i: number): number {
    return this.timestamps[(this.head + i) % this.capacity];
  }

  /** Value at a logical index, oldest first. */
  valueAt(i: number): number {
    return this.values[(this.head + i) % this.capacity];
  }

  /** Newest timestamp, or NaN when empty. */
  get newestTimestamp(): number {
    return this.length === 0 ? NaN : this.timestampAt(this.length - 1);
  }

  /** Oldest timestamp, or NaN when empty. */
  get oldestTimestamp(): number {
    return this.length === 0 ? NaN : this.timestampAt(0);
  }

  /**
   * Index of the first sample at or after `timestampMs`, by binary search.
   *
   * Returns `count` when every sample is older. Timestamps are monotonic, which is what makes
   * the search valid — the transport reports a peer restart rather than letting time go
   * backwards silently.
   */
  indexAtOrAfter(timestampMs: number): number {
    let lo = 0;
    let hi = this.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.timestampAt(mid) < timestampMs) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * Copies a time range into caller-owned arrays.
   *
   * @returns the number of samples written.
   */
  copyRange(
    fromMs: number,
    toMs: number,
    outTimestamps: Float64Array,
    outValues: Float32Array,
  ): number {
    const start = this.indexAtOrAfter(fromMs);
    let n = 0;
    for (let i = start; i < this.length && n < outTimestamps.length; i++) {
      const t = this.timestampAt(i);
      if (t > toMs) break;
      outTimestamps[n] = t;
      outValues[n] = this.valueAt(i);
      n++;
    }
    return n;
  }
}
