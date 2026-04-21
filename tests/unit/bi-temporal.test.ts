/**
 * v0.11 Bi-temporal tests for L3.
 *
 * Concepts:
 *   valid_from     — epoch ms; defaults to created_at
 *   valid_until    — epoch ms or null; null means "still current"
 *   supersedes_id  — id of the memory this one replaces
 *   superseded_by_id — inverse pointer, set when another memory supersedes this
 *
 * API surface:
 *   engine.store(content, type, { supersedes: existingId, layer: L3 })
 *     → new memory has supersedes_id = existingId
 *     → old memory has valid_until = now, superseded_by_id = new.id
 *
 *   engine.recall(query, { includeSuperseded?: boolean, asOf?: number })
 *     Default hides superseded memories. `asOf` lets callers query the
 *     state of memory as it existed at a past point in time.
 *
 *   L3 fields surface on Memory via metadata.temporal = {validFrom, validUntil,
 *   supersedesId, supersededById}.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContextEngine } from '../../src/engine.js';
import { MemoryLayer } from '../../src/types.js';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('v0.11 Bi-temporal (L3)', () => {
  let engine: ContextEngine;
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'cf-bitemp-'));
    engine = new ContextEngine({ projectPath: tmp, isEphemeral: true, autoCleanup: false });
  });

  afterEach(async () => {
    await engine.close();
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  });

  it('new L3 memory has validFrom = createdAt and validUntil = null', async () => {
    const before = Date.now();
    const m = await engine.store(
      'Deploy pipeline has three stages: build, test, publish.',
      'decision',
      { layer: MemoryLayer.L3_SEMANTIC },
    );
    const after = Date.now();

    const stored = await engine.l3.get(m.id);
    const temp = (stored?.metadata as any)?.temporal;
    expect(temp).toBeDefined();
    expect(temp.validFrom).toBeGreaterThanOrEqual(before);
    expect(temp.validFrom).toBeLessThanOrEqual(after);
    expect(temp.validUntil).toBeNull();
    expect(temp.supersedesId).toBeNull();
    expect(temp.supersededById).toBeNull();
  });

  it('supersedes marks old memory invalid and links both', async () => {
    const old = await engine.store(
      'We deploy via Jenkins on every merge to main.',
      'decision',
      { layer: MemoryLayer.L3_SEMANTIC, dedupe: { strategy: 'allow' } },
    );

    const before = Date.now();
    const now = await engine.store(
      'We deploy via GitHub Actions on every merge to main.',
      'decision',
      {
        layer: MemoryLayer.L3_SEMANTIC,
        dedupe: { strategy: 'allow' },
        metadata: { supersedes: old.id },
      },
    );
    const after = Date.now();

    const oldRow = await engine.l3.get(old.id);
    const oldTemp = (oldRow?.metadata as any)?.temporal;
    expect(oldTemp.validUntil).not.toBeNull();
    expect(oldTemp.validUntil).toBeGreaterThanOrEqual(before);
    expect(oldTemp.validUntil).toBeLessThanOrEqual(after);
    expect(oldTemp.supersededById).toBe(now.id);

    const newRow = await engine.l3.get(now.id);
    const newTemp = (newRow?.metadata as any)?.temporal;
    expect(newTemp.supersedesId).toBe(old.id);
    expect(newTemp.validUntil).toBeNull();
  });

  it('recall hides superseded memories by default', async () => {
    const old = await engine.store(
      'The auth service is written in Ruby on Rails.',
      'decision',
      { layer: MemoryLayer.L3_SEMANTIC, dedupe: { strategy: 'allow' } },
    );
    const fresh = await engine.store(
      'The auth service is written in Go using the gin framework.',
      'decision',
      {
        layer: MemoryLayer.L3_SEMANTIC,
        dedupe: { strategy: 'allow' },
        metadata: { supersedes: old.id },
      },
    );

    const results = await engine.recall('auth service language', { limit: 10, mode: 'hybrid' });
    const ids = results.map(r => r.id);
    expect(ids).toContain(fresh.id);
    expect(ids).not.toContain(old.id);
  });

  it('recall includeSuperseded returns both versions', async () => {
    const old = await engine.store(
      'We charge 2.9 percent plus thirty cents per transaction.',
      'decision',
      { layer: MemoryLayer.L3_SEMANTIC, dedupe: { strategy: 'allow' } },
    );
    const fresh = await engine.store(
      'We charge 2.5 percent plus twenty cents per transaction.',
      'decision',
      {
        layer: MemoryLayer.L3_SEMANTIC,
        dedupe: { strategy: 'allow' },
        metadata: { supersedes: old.id },
      },
    );

    const results = await engine.recall('transaction fee percent cents', {
      limit: 10,
      mode: 'hybrid',
      includeSuperseded: true,
    });
    const ids = results.map(r => r.id);
    expect(ids).toContain(fresh.id);
    expect(ids).toContain(old.id);
  });

  it('recall asOf returns the memory that was current at that time', async () => {
    const old = await engine.store(
      'The frontend uses Next.js version 13 with the pages router.',
      'decision',
      { layer: MemoryLayer.L3_SEMANTIC, dedupe: { strategy: 'allow' } },
    );

    // Wait so we have a clean time boundary.
    await new Promise(r => setTimeout(r, 20));
    const midpoint = Date.now();
    await new Promise(r => setTimeout(r, 20));

    const fresh = await engine.store(
      'The frontend uses Next.js version 15 with the app router.',
      'decision',
      {
        layer: MemoryLayer.L3_SEMANTIC,
        dedupe: { strategy: 'allow' },
        metadata: { supersedes: old.id },
      },
    );

    // asOf at midpoint → old was still current, fresh did not exist yet
    const past = await engine.recall('frontend Next.js router', {
      limit: 10,
      mode: 'hybrid',
      asOf: midpoint,
    });
    const pastIds = past.map(r => r.id);
    expect(pastIds).toContain(old.id);
    expect(pastIds).not.toContain(fresh.id);

    // asOf now → fresh is current, old is superseded
    const nowResults = await engine.recall('frontend Next.js router', {
      limit: 10,
      mode: 'hybrid',
      asOf: Date.now(),
    });
    const nowIds = nowResults.map(r => r.id);
    expect(nowIds).toContain(fresh.id);
    expect(nowIds).not.toContain(old.id);
  });

  it('supersedes with unknown id stores the new memory but leaves links unchanged', async () => {
    const m = await engine.store(
      'We track sprint velocity using Linear cycles.',
      'convention',
      {
        layer: MemoryLayer.L3_SEMANTIC,
        dedupe: { strategy: 'allow' },
        metadata: { supersedes: '00000000-0000-0000-0000-000000000000' },
      },
    );

    const stored = await engine.l3.get(m.id);
    const temp = (stored?.metadata as any)?.temporal;
    // Unknown predecessor: link is not set (no ghost pointer) and new memory
    // remains valid.
    expect(temp.supersedesId).toBeNull();
    expect(temp.validUntil).toBeNull();
  });
});
