import { HeartbeatMetrics } from '../types';

export class HeartbeatRingBuffer {
  private buffer: Float64Array;
  private capacity: number;
  private head: number = 0;
  private count: number = 0;

  constructor(capacity = 20, initialValues: number[] = []) {
    this.capacity = Math.max(1, capacity);
    this.buffer = new Float64Array(this.capacity);
    for (let i = 0; i < initialValues.length; i++) {
      this.push(initialValues[i]);
    }
  }

  public push(value: number): void {
    this.buffer[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  public toArray(): number[] {
    if (this.count === 0) return [];
    const result: number[] = new Array(this.count);
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      result[i] = this.buffer[(start + i) % this.capacity];
    }
    return result;
  }

  public getMetrics(currentLatency: number | null, status: 'idle' | 'healthy' | 'warning' | 'unreachable'): HeartbeatMetrics {
    const history = this.toArray();
    const len = history.length;
    if (len === 0) {
      const current = currentLatency ?? 0;
      return {
        currentLatencyMs: current,
        history: current > 0 ? [current] : [],
        jitterMs: 0,
        minLatencyMs: current,
        maxLatencyMs: current,
        avgLatencyMs: current,
        status
      };
    }
    const current = currentLatency ?? history[len - 1] ?? 0;
    let min = history[0];
    let max = history[0];
    let sum = history[0];
    let jitterSum = 0;

    // Single-pass computation of min, max, sum, and RFC 3550 inter-arrival jitter
    for (let i = 1; i < len; i++) {
      const v = history[i];
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      jitterSum += Math.abs(v - history[i - 1]);
    }

    const avg = Math.round(sum / len);
    const jitter = len > 1 ? Math.round((jitterSum / (len - 1)) * 10) / 10 : 0;

    return {
      currentLatencyMs: current,
      history,
      jitterMs: jitter,
      minLatencyMs: min,
      maxLatencyMs: max,
      avgLatencyMs: avg,
      status
    };
  }
}
