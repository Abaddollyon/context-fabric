import { describe, expect, it } from 'vitest';
import {
  extractQueryFeatures,
  buildRetrievalCandidate,
  scoreRetrievalCandidates,
  generateDeterministicRepresentations,
  type RankedMemory,
} from '../../src/retrieval-quality.js';
import { MemoryLayer, type Memory } from '../../src/types.js';

function memory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: overrides.id ?? 'mem-1',
    type: overrides.type ?? 'scratchpad',
    content: overrides.content ?? 'Alice prefers dark mode in src/ui/theme.ts after BUG-1234 on 2026-04-20.',
    metadata: overrides.metadata ?? {
      tags: [],
      relationships: [],
      confidence: 0.8,
      source: 'ai_inferred',
      cliType: 'generic',
    },
    tags: overrides.tags ?? [],
    createdAt: overrides.createdAt ?? Date.UTC(2026, 3, 20),
    updatedAt: overrides.updatedAt ?? Date.UTC(2026, 3, 20),
    ...overrides,
  };
}

function ranked(id: string, content: string, similarity: number): RankedMemory {
  return {
    ...memory({ id, content }),
    layer: MemoryLayer.L3_SEMANTIC,
    similarity,
  };
}

describe('retrieval quality query feature extraction', () => {
  it('extracts high-signal deterministic query features', () => {
    const features = extractQueryFeatures(
      'What did Alice prefer in "dark mode" for src/ui/theme.ts after 2026-04-20 when BUG-1234 failed in ContextEngine.recall?',
      Date.UTC(2026, 3, 28),
    );

    expect(features.quotedPhrases).toContain('dark mode');
    expect(features.properNouns).toEqual(expect.arrayContaining(['Alice', 'ContextEngine']));
    expect(features.filePaths).toContain('src/ui/theme.ts');
    expect(features.symbols).toEqual(expect.arrayContaining(['ContextEngine.recall']));
    expect(features.dates.map((d) => d.isoDate)).toContain('2026-04-20');
    expect(features.preferenceTerms).toContain('prefer');
    expect(features.errorIdentifiers).toContain('BUG-1234');
  });

  it('resolves relative-time expressions against an explicit clock', () => {
    const features = extractQueryFeatures('What changed yesterday and last week?', Date.UTC(2026, 3, 28, 12));

    expect(features.relativeTimes.map((t) => t.phrase)).toEqual(expect.arrayContaining(['yesterday', 'last week']));
    expect(features.relativeTimes.find((t) => t.phrase === 'yesterday')?.startMs).toBe(Date.UTC(2026, 3, 27));
  });
});

describe('retrieval candidate scoring', () => {
  it('preserves representation metadata and source links on candidates', () => {
    const source = memory({
      id: 'pref-1',
      metadata: {
        tags: ['preference'],
        relationships: [],
        confidence: 0.9,
        source: 'system_auto',
        cliType: 'generic',
        representation: {
          kind: 'preference',
          sourceMemoryId: 'session-1',
          sourceTranscriptId: 'transcript-1',
          sourceSpan: { start: 12, end: 42 },
        },
      },
    });

    const candidate = buildRetrievalCandidate({ memory: source, layer: MemoryLayer.L3_SEMANTIC, baseScore: 0.4 });

    expect(candidate.representationKind).toBe('preference');
    expect(candidate.provenance.sourceMemoryId).toBe('session-1');
    expect(candidate.provenance.sourceTranscriptId).toBe('transcript-1');
    expect(candidate.provenance.sourceSpan).toEqual({ start: 12, end: 42 });
  });

  it('boosts exact anchors monotonically and deduplicates linked representations by source evidence', () => {
    const query = extractQueryFeatures('Find "dark mode" preference for Alice in src/ui/theme.ts BUG-1234');
    const candidates = [
      buildRetrievalCandidate({ memory: ranked('raw-1', 'Alice likes theme settings.', 0.8), layer: MemoryLayer.L3_SEMANTIC, baseScore: 0.8 }),
      buildRetrievalCandidate({
        memory: {
          ...ranked('pref-1', 'Alice prefers dark mode in src/ui/theme.ts because of BUG-1234.', 0.6),
          metadata: {
            tags: [],
            relationships: [],
            confidence: 0.9,
            source: 'system_auto',
            cliType: 'generic',
            representation: { kind: 'preference', sourceMemoryId: 'raw-1', sourceSpan: { start: 0, end: 60 } },
          },
        },
        layer: MemoryLayer.L3_SEMANTIC,
        baseScore: 0.6,
      }),
    ];

    const scored = scoreRetrievalCandidates(candidates, query, { profile: 'preference', dedupeRepresentations: true, explain: true });

    expect(scored).toHaveLength(1);
    expect(scored[0].id).toBe('pref-1');
    expect(scored[0].similarity).toBeGreaterThan(0.8);
    expect(scored[0].explanation?.boosts.map((b) => b.kind)).toEqual(expect.arrayContaining(['quoted_phrase', 'file_path', 'proper_noun', 'error_identifier', 'representation']));
  });

  it('applies temporal scoring for explicit dates and recency profiles', () => {
    const query = extractQueryFeatures('What happened on 2026-04-20?', Date.UTC(2026, 3, 28));
    const exact = buildRetrievalCandidate({ memory: ranked('exact', 'On 2026-04-20 Alice changed the theme.', 0.5), layer: MemoryLayer.L3_SEMANTIC, baseScore: 0.5 });
    const stale = buildRetrievalCandidate({ memory: ranked('stale', 'On 2025-01-01 Alice changed the theme.', 0.5), layer: MemoryLayer.L3_SEMANTIC, baseScore: 0.5 });

    const scored = scoreRetrievalCandidates([stale, exact], query, { profile: 'temporal', explain: true });

    expect(scored[0].id).toBe('exact');
    expect(scored[0].explanation?.temporalMatch?.matched).toBe(true);
    expect(scored[0].explanation?.boosts.some((b) => b.kind === 'temporal')).toBe(true);
  });
});

describe('deterministic representation generation', () => {
  it('generates linked preference and atomic fact representations from session text', () => {
    const reps = generateDeterministicRepresentations(memory({
      id: 'session-1',
      content: 'User: I prefer dark mode for dashboards. User: My manager is Priya. Assistant: noted.',
      metadata: {
        tags: [],
        relationships: [],
        confidence: 0.8,
        source: 'user_explicit',
        cliType: 'generic',
        representation: { kind: 'session' },
        provenance: { sessionId: 'chat-1' },
      },
    }));

    expect(reps.map((r) => r.metadata?.representation?.kind)).toEqual(expect.arrayContaining(['preference', 'atomic_fact']));
    for (const rep of reps) {
      expect(rep.metadata?.representation?.sourceMemoryId).toBe('session-1');
      expect(rep.metadata?.provenance?.sessionId).toBe('chat-1');
      expect(rep.metadata?.representation?.sourceSpan?.start).toEqual(expect.any(Number));
    }
  });
});
