/**
 * Lightweight in-process metrics registry — v0.10 Observability.
 *
 * Tracks:
 *  - counters (incremented with optional labels flattened into the key)
 *  - latency histograms with p50/p95/p99 via reservoir sampling
 *
 * Intentionally dependency-free; exported as a singleton so the server,
 * engine, and layers can all record without wiring.
 */

const MAX_SAMPLES = 1024;

class Histogram {
  private samples: number[] = [];
  private count = 0;

  record(valueMs: number): void {
    this.count++;
    if (this.samples.length < MAX_SAMPLES) {
      this.samples.push(valueMs);
    } else {
      // Reservoir replacement
      const idx = Math.floor(Math.random() * this.count);
      if (idx < MAX_SAMPLES) this.samples[idx] = valueMs;
    }
  }

  snapshot(): { count: number; p50: number; p95: number; p99: number; max: number } {
    if (this.samples.length === 0) {
      return { count: 0, p50: 0, p95: 0, p99: 0, max: 0 };
    }
    const sorted = [...this.samples].sort((a, b) => a - b);
    const pick = (q: number): number => {
      const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
      return sorted[idx] ?? 0;
    };
    return {
      count: this.count,
      p50: pick(0.5),
      p95: pick(0.95),
      p99: pick(0.99),
      max: sorted[sorted.length - 1] ?? 0,
    };
  }

  reset(): void {
    this.samples = [];
    this.count = 0;
  }
}

class MetricsRegistry {
  private counters = new Map<string, number>();
  private histograms = new Map<string, Histogram>();

  inc(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  observe(name: string, valueMs: number): void {
    let h = this.histograms.get(name);
    if (!h) {
      h = new Histogram();
      this.histograms.set(name, h);
    }
    h.record(valueMs);
  }

  /** Convenience: time an async function and record the elapsed ms. */
  async time<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      return await fn();
    } finally {
      this.observe(name, Date.now() - start);
    }
  }

  snapshot(): {
    counters: Record<string, number>;
    histograms: Record<string, { count: number; p50: number; p95: number; p99: number; max: number }>;
  } {
    const counters: Record<string, number> = {};
    for (const [k, v] of this.counters) counters[k] = v;
    const histograms: Record<string, { count: number; p50: number; p95: number; p99: number; max: number }> = {};
    for (const [k, h] of this.histograms) histograms[k] = h.snapshot();
    return { counters, histograms };
  }

  reset(): void {
    this.counters.clear();
    for (const h of this.histograms.values()) h.reset();
    this.histograms.clear();
  }
}

export const metrics = new MetricsRegistry();
