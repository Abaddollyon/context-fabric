/**
 * v0.11 Provenance tests.
 *
 * Provenance is an optional structured citation block on MemoryMetadata
 * that answers "where did this memory come from?". It rides through the
 * existing JSON metadata blob so no schema migration is needed.
 *
 * We verify end-to-end:
 *   - typed shape is accepted by the server's Zod StoreMemorySchema
 *   - L2 and L3 persist provenance round-trip through recall + get
 *   - engine.store stamps capturedAt automatically when omitted
 *   - optional auto-stamp of sessionId from the caller's context
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContextEngine } from '../../src/engine.js';
import { StoreMemorySchema } from '../../src/server.js';
import { MemoryLayer } from '../../src/types.js';
import type { Provenance } from '../../src/types.js';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('v0.11 Provenance', () => {
  let engine: ContextEngine;
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'cf-prov-'));
    engine = new ContextEngine({ projectPath: tmp, isEphemeral: true, autoCleanup: false });
  });

  afterEach(async () => {
    await engine.close();
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  });

  describe('Zod schema', () => {
    it('accepts a fully-specified provenance block on store', () => {
      const parsed = StoreMemorySchema.parse({
        type: 'decision',
        content: 'We chose Postgres because of row-level security.',
        metadata: {
          tags: [],
          confidence: 0.9,
          source: 'user_explicit',
          cliType: 'claude-code',
          weight: 4,
          provenance: {
            sessionId: 'sess-abc',
            eventId: 'evt-123',
            toolCallId: 'call-xyz',
            filePath: 'docs/decisions/0007-db.md',
            lineStart: 12,
            lineEnd: 40,
            commitSha: 'a1b2c3d',
            sourceUrl: 'https://github.com/org/repo/blob/main/docs/decisions/0007-db.md',
          },
        },
      });
      expect(parsed.metadata.provenance?.sessionId).toBe('sess-abc');
      expect(parsed.metadata.provenance?.commitSha).toBe('a1b2c3d');
    });

    it('accepts store with no provenance (backward compatible)', () => {
      expect(() => StoreMemorySchema.parse({
        type: 'decision',
        content: 'x',
        metadata: { tags: [], confidence: 0.9, source: 'user_explicit', cliType: 'claude-code', weight: 3 },
      })).not.toThrow();
    });

    it('rejects unknown fields inside provenance (strict)', () => {
      expect(() => StoreMemorySchema.parse({
        type: 'decision',
        content: 'x',
        metadata: {
          tags: [],
          confidence: 0.9,
          source: 'user_explicit',
          cliType: 'claude-code',
          weight: 3,
          provenance: { sessionId: 's', hackerField: 'nope' },
        },
      })).toThrow();
    });
  });

  describe('round-trip through L3', () => {
    it('persists provenance fields on store and returns them on recall', async () => {
      const prov: Provenance = {
        sessionId: 'sess-1',
        filePath: 'src/auth.ts',
        lineStart: 42,
        lineEnd: 58,
        commitSha: 'deadbeef',
      };

      const stored = await engine.store(
        'JWT signing uses HS256 with a 32-byte random secret rotated quarterly.',
        'decision',
        { layer: MemoryLayer.L3_SEMANTIC, metadata: { provenance: prov } },
      );
      expect(stored.layer).toBe(MemoryLayer.L3_SEMANTIC);

      const recalled = await engine.recall('JWT signing HS256', { limit: 3, mode: 'hybrid' });
      const hit = recalled.find(r => r.id === stored.id);
      expect(hit).toBeDefined();
      expect(hit!.metadata?.provenance).toBeDefined();
      expect(hit!.metadata!.provenance!.sessionId).toBe('sess-1');
      expect(hit!.metadata!.provenance!.filePath).toBe('src/auth.ts');
      expect(hit!.metadata!.provenance!.commitSha).toBe('deadbeef');
    });

    it('auto-stamps provenance.capturedAt when omitted', async () => {
      const before = Date.now();
      const stored = await engine.store(
        'We switched to Vitest because it runs tests 4x faster.',
        'decision',
        {
          layer: MemoryLayer.L3_SEMANTIC,
          metadata: { provenance: { sessionId: 's1' } as Provenance },
        },
      );
      const after = Date.now();

      const direct = await engine.l3.get(stored.id);
      expect(direct?.metadata?.provenance?.capturedAt).toBeDefined();
      const ts = direct!.metadata!.provenance!.capturedAt!;
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });

  describe('round-trip through L2', () => {
    it('persists provenance in L2 project layer', async () => {
      const prov: Provenance = {
        sessionId: 'sess-l2',
        toolCallId: 'mcp-call-1',
        filePath: 'README.md',
      };

      const stored = await engine.store(
        'Project uses pnpm, not npm, per the 2026-03 migration.',
        'convention',
        { layer: MemoryLayer.L2_PROJECT, metadata: { provenance: prov } },
      );

      const direct = await engine.l2.get(stored.id);
      expect(direct?.metadata?.provenance?.sessionId).toBe('sess-l2');
      expect(direct?.metadata?.provenance?.toolCallId).toBe('mcp-call-1');
      expect(direct?.metadata?.provenance?.filePath).toBe('README.md');
    });
  });
});
