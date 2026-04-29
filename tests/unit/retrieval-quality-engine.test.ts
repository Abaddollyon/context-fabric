import { describe, expect, it } from 'vitest';
import { ContextEngine } from '../../src/engine.js';
import { MemoryLayer } from '../../src/types.js';

function mem(id: string, content: string, similarity: number, representation?: Record<string, unknown>) {
  return {
    id,
    type: 'scratchpad' as const,
    content,
    metadata: {
      tags: [],
      relationships: [],
      confidence: 0.8,
      source: 'ai_inferred' as const,
      cliType: 'generic',
      ...(representation ? { representation } : {}),
    },
    tags: [],
    createdAt: Date.UTC(2026, 3, 20),
    updatedAt: Date.UTC(2026, 3, 20),
    layer: MemoryLayer.L3_SEMANTIC,
    similarity,
  };
}

describe('ContextEngine retrieval quality fusion', () => {
  it('keeps RRF stable while exposing component-score explanations', async () => {
    const keyword = [mem('anchor', 'Alice prefers dark mode.', 0.8), mem('keyword-only', 'Alice notes.', 0.7)];
    const semantic = [mem('semantic-only', 'Theme preferences.', 0.9), mem('anchor', 'Alice prefers dark mode.', 0.6)];

    const fused = await ContextEngine.fuseRRF(keyword, semantic, 10, 60, { explain: true });

    expect(fused[0].id).toBe('anchor');
    expect(fused[0].explanation?.componentScores.keywordRank).toBe(1);
    expect(fused[0].explanation?.componentScores.vectorRank).toBe(2);
    expect(fused[0].explanation?.componentScores.rrfScore).toBeGreaterThan(0);
  });

  it('keeps explanation mode diagnostic without changing RRF rank order', async () => {
    const keyword: ReturnType<typeof mem>[] = [];
    const semantic = [
      mem('top', 'Can you recommend generic weekend activities?', 0.9),
      mem('answer', 'Can you recommend cultural events around me this weekend? Alice prefers gallery openings and jazz shows nearby.', 0.8),
    ];

    const plain = await ContextEngine.fuseRRF(keyword, semantic, 2, 60);
    const explained = await ContextEngine.fuseRRF(keyword, semantic, 2, 60, {
      query: 'Can you recommend cultural events around me this weekend?',
      explain: true,
    });

    expect(explained.map((row) => row.id)).toEqual(plain.map((row) => row.id));
    expect(explained[0].explanation?.componentScores.rrfScore).toBeGreaterThan(0);
  });

  it('keeps default query-aware fusion backwards-compatible unless quality knobs are explicit', async () => {
    const keyword: ReturnType<typeof mem>[] = [];
    const semantic = [
      mem('top', 'General notes about commute and work.', 0.9),
      mem('answer', 'How long is my daily commute to work? It is 45 minutes.', 0.8),
    ];

    const plain = await ContextEngine.fuseRRF(keyword, semantic, 2, 60);
    const defaultWithQuery = await ContextEngine.fuseRRF(keyword, semantic, 2, 60, {
      query: 'How long is my daily commute to work?',
    });

    expect(defaultWithQuery.map((row) => row.id)).toEqual(plain.map((row) => row.id));
  });

  it('keeps post-fusion explanation mode diagnostic without changing rank order', async () => {
    const rows = [
      mem('top', 'General notes about commute and work.', 0.9),
      mem('answer', 'My daily commute to work is 45 minutes.', 0.85),
    ];
    const engine = Object.create(ContextEngine.prototype) as unknown as {
      applyRetrievalQuality: (query: string, rows: typeof rows, options: Record<string, unknown>) => Promise<typeof rows>;
    };

    const explained = await engine.applyRetrievalQuality('Find "daily commute"', rows, { explain: true });
    const scored = await engine.applyRetrievalQuality('Find "daily commute"', rows, {
      scoringProfile: 'preference',
    });

    expect(explained.map((row) => row.id)).toEqual(rows.map((row) => row.id));
    expect(explained[0].explanation?.componentScores.finalScore).toBeDefined();
    expect(scored[0].similarity).toBeGreaterThan(rows[0].similarity);
  });

  it('deduplicates linked representations by source evidence when requested', async () => {
    const raw = mem('raw-session', 'Long session text with Alice preferences.', 0.95, { kind: 'session' });
    const preference = mem('pref-view', 'Alice prefers dark mode.', 0.7, {
      kind: 'preference',
      sourceMemoryId: 'raw-session',
      sourceSpan: { start: 10, end: 35 },
    });

    const fused = await ContextEngine.fuseRRF([raw], [preference], 10, 60, {
      query: 'Alice "dark mode" preference',
      scoringProfile: 'preference',
      dedupeRepresentations: true,
      explain: true,
    });

    expect(fused).toHaveLength(1);
    expect(fused[0].id).toBe('pref-view');
    expect(fused[0].metadata?.representation?.kind).toBe('preference');
    expect(fused[0].explanation?.boosts.some((b) => b.kind === 'representation')).toBe(true);
  });
});
