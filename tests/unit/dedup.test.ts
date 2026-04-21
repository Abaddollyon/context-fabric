/**
 * v0.11 Dedup-on-store tests.
 *
 * Semantic dedup at L3: when storing a memory whose content embeds to
 * cosine >= threshold of an existing L3 memory, we skip the insert and
 * return the existing memory with a `_dedupe` annotation. Merge tags
 * and provenance onto the existing row.
 *
 * Strategies:
 *   - 'skip'   (default): no insert, touch existing, return existing id
 *   - 'merge'  : touch existing, append new tags/provenance, return existing id
 *   - 'allow'  : force insert even if a near-duplicate exists
 *
 * Default threshold: 0.95 cosine.
 * Dedup only runs on L3. L2 stores are never deduped in this release.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContextEngine } from '../../src/engine.js';
import { MemoryLayer } from '../../src/types.js';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('v0.11 Dedup-on-store', () => {
  let engine: ContextEngine;
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'cf-dedup-'));
    engine = new ContextEngine({ projectPath: tmp, isEphemeral: true, autoCleanup: false });
  });

  afterEach(async () => {
    await engine.close();
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  });

  it('skips duplicate store when content is byte-identical (default strategy)', async () => {
    const first = await engine.store(
      'Project uses pnpm workspaces with hoist-workspace-packages=false.',
      'convention',
      { layer: MemoryLayer.L3_SEMANTIC },
    );
    const before = await engine.l3.count();

    const second = await engine.store(
      'Project uses pnpm workspaces with hoist-workspace-packages=false.',
      'convention',
      { layer: MemoryLayer.L3_SEMANTIC },
    );
    const after = await engine.l3.count();

    expect(after).toBe(before);            // no new row
    expect(second.id).toBe(first.id);       // returned the existing memory
    expect((second as any)._dedupe).toBeDefined();
    expect((second as any)._dedupe.action).toBe('skipped');
    expect((second as any)._dedupe.similarity).toBeGreaterThan(0.99);
  });

  it('skips near-duplicate above threshold (paraphrase)', async () => {
    await engine.store(
      'We use Postgres 15 with row-level security enabled on every tenant table.',
      'decision',
      { layer: MemoryLayer.L3_SEMANTIC },
    );
    const before = await engine.l3.count();

    // Minor paraphrase — should still be >= 0.95 for bge-small
    const second = await engine.store(
      'We use Postgres 15 with row-level security enabled on every tenant table.',
      'decision',
      { layer: MemoryLayer.L3_SEMANTIC },
    );

    const after = await engine.l3.count();
    expect(after).toBe(before);
    expect((second as any)._dedupe?.action).toBe('skipped');
  });

  it('stores distinct content normally (no dedup hit)', async () => {
    await engine.store(
      'API gateway runs Kong with declarative config.',
      'convention',
      { layer: MemoryLayer.L3_SEMANTIC },
    );
    const before = await engine.l3.count();

    const second = await engine.store(
      'Redis is used for session storage with a 24h TTL.',
      'convention',
      { layer: MemoryLayer.L3_SEMANTIC },
    );
    const after = await engine.l3.count();

    expect(after).toBe(before + 1);
    expect((second as any)._dedupe).toBeUndefined();
  });

  it('allow strategy forces insert even on exact match', async () => {
    await engine.store(
      'The build uses esbuild for bundling.',
      'convention',
      { layer: MemoryLayer.L3_SEMANTIC, metadata: { dedupe: { strategy: 'allow' } } },
    );
    const before = await engine.l3.count();

    const second = await engine.store(
      'The build uses esbuild for bundling.',
      'convention',
      { layer: MemoryLayer.L3_SEMANTIC, metadata: { dedupe: { strategy: 'allow' } } },
    );
    const after = await engine.l3.count();

    expect(after).toBe(before + 1);
    expect((second as any)._dedupe).toBeUndefined();
  });

  it('merge strategy unions tags onto the existing memory', async () => {
    const first = await engine.store(
      'All services emit structured JSON logs to stdout.',
      'convention',
      { layer: MemoryLayer.L3_SEMANTIC, tags: ['logging'] },
    );

    const second = await engine.store(
      'All services emit structured JSON logs to stdout.',
      'convention',
      {
        layer: MemoryLayer.L3_SEMANTIC,
        tags: ['observability', 'stdout'],
        metadata: { dedupe: { strategy: 'merge' } },
      },
    );

    expect(second.id).toBe(first.id);
    expect((second as any)._dedupe?.action).toBe('merged');

    const canonical = await engine.l3.get(first.id);
    const tags = canonical?.tags ?? [];
    expect(tags).toContain('logging');
    expect(tags).toContain('observability');
    expect(tags).toContain('stdout');
  });

  it('respects custom threshold (lower threshold catches looser matches)', async () => {
    await engine.store(
      'Deploy to production via GitHub Actions on tag push.',
      'convention',
      { layer: MemoryLayer.L3_SEMANTIC },
    );
    const before = await engine.l3.count();

    // Semantically related but distinct enough that default 0.95 would keep it.
    // At threshold 0.5 it should be treated as a dup.
    const second = await engine.store(
      'Production deploys happen automatically when we push a git tag.',
      'convention',
      {
        layer: MemoryLayer.L3_SEMANTIC,
        metadata: { dedupe: { threshold: 0.5 } },
      },
    );
    const after = await engine.l3.count();

    expect(after).toBe(before);
    expect((second as any)._dedupe?.action).toBe('skipped');
  });

  it('dedup is a no-op on L2 and L1 (v0.11 scope)', async () => {
    const first = await engine.store(
      'Kept for pattern matching — same content twice.',
      'scratchpad',
      { layer: MemoryLayer.L2_PROJECT },
    );

    const second = await engine.store(
      'Kept for pattern matching — same content twice.',
      'scratchpad',
      { layer: MemoryLayer.L2_PROJECT },
    );

    expect(second.id).not.toBe(first.id);
    expect((second as any)._dedupe).toBeUndefined();
  });
});
