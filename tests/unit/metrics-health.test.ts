/**
 * context.metrics + context.health tests — v0.10 Observability.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContextEngine } from '../../src/engine.js';
import { metrics } from '../../src/metrics.js';
import { MetricsSchema, HealthSchema } from '../../src/server.js';

describe('Metrics + Health (v0.10)', () => {
  let tmpDir: string;
  let engine: ContextEngine;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cf-metrics-'));
    engine = new ContextEngine({ projectPath: tmpDir, isEphemeral: true });
    metrics.reset();
  });

  afterEach(async () => {
    await engine.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('MetricsSchema and HealthSchema accept known fields and reject unknown', () => {
    expect(MetricsSchema.safeParse({}).success).toBe(true);
    expect(MetricsSchema.safeParse({ reset: true }).success).toBe(true);
    expect(MetricsSchema.safeParse({ bogus: 1 }).success).toBe(false);
    expect(HealthSchema.safeParse({}).success).toBe(true);
    expect(HealthSchema.safeParse({ bogus: 1 }).success).toBe(false);
  });

  it('recall increments metrics counters and histograms', async () => {
    await engine.store('hello world', 'decision', { layer: 2 });
    await engine.recall('hello', { mode: 'keyword' });
    const snap = metrics.snapshot();
    expect(snap.counters['recall.calls.keyword']).toBeGreaterThanOrEqual(1);
    expect(snap.histograms['recall.latency_ms.keyword']?.count).toBeGreaterThanOrEqual(1);
  });

  it('engine.health returns ok when layers are healthy', async () => {
    const report = await engine.health();
    expect(['ok', 'degraded']).toContain(report.status);
    const l2Check = report.checks.find(c => c.name === 'l2.sqlite');
    const l3Check = report.checks.find(c => c.name === 'l3.sqlite');
    expect(l2Check?.status).toBe('pass');
    expect(l3Check?.status).toBe('pass');
  });

  it('metrics.reset clears counters and histograms', () => {
    metrics.inc('foo');
    metrics.observe('bar', 10);
    expect(metrics.snapshot().counters.foo).toBe(1);
    metrics.reset();
    const snap = metrics.snapshot();
    expect(snap.counters.foo).toBeUndefined();
    expect(snap.histograms.bar).toBeUndefined();
  });
});
