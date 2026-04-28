import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { writePerQuestionArtifact } from '../../benchmarks/public/lib/artifacts.js';
import { resolveLongMemEvalScoringProfile } from '../../benchmarks/public/longmemeval-s.js';

describe('LongMemEval benchmark options', () => {
  it('does not change scoring profile just because artifact output is enabled', () => {
    expect(resolveLongMemEvalScoringProfile({ artifactJsonl: undefined, scoringProfile: undefined })).toBeUndefined();
    expect(resolveLongMemEvalScoringProfile({ artifactJsonl: '/tmp/artifact.jsonl', scoringProfile: undefined })).toBeUndefined();
  });

  it('allows explicit scoring profile experiments through an env-style option', () => {
    expect(resolveLongMemEvalScoringProfile({ artifactJsonl: '/tmp/artifact.jsonl', scoringProfile: 'benchmark' })).toBe('benchmark');
  });
});

describe('LongMemEval per-question artifact output', () => {
  it('writes JSONL records with question, top candidates, component scores, representation, and source spans', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-lme-artifact-'));
    const artifactPath = path.join(dir, 'per-question.jsonl');

    try {
      writePerQuestionArtifact(artifactPath, {
        question_id: 'q-1',
        question: 'What does Alice prefer?',
        question_type: 'single-session-preference',
        answer_session_ids: ['s-1'],
        ranking: ['s-1'],
        hits: { 1: 1, 5: 1, 10: 1, 50: 1 },
        recalls: { 1: 1, 5: 1, 10: 1, 50: 1 },
        latencyMs: 12.5,
        topCandidates: [{
          memoryId: 'm-1',
          benchDocId: 's-1',
          similarity: 0.99,
          componentScores: { rrfScore: 0.03, keywordRank: 1, vectorRank: 2 },
          representationKind: 'preference',
          sourceSpan: { start: 4, end: 20 },
        }],
      });

      const lines = fs.readFileSync(artifactPath, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(1);
      const record = JSON.parse(lines[0]);
      expect(record.question_id).toBe('q-1');
      expect(record.topCandidates[0].componentScores.keywordRank).toBe(1);
      expect(record.topCandidates[0].representationKind).toBe('preference');
      expect(record.topCandidates[0].sourceSpan).toEqual({ start: 4, end: 20 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
