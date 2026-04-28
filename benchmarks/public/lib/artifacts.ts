import * as fs from 'node:fs';
import * as path from 'node:path';

export interface PerQuestionArtifactCandidate {
  memoryId: string;
  benchDocId?: string;
  similarity: number;
  componentScores?: Record<string, unknown>;
  representationKind?: string;
  sourceSpan?: { start: number; end: number };
  provenance?: Record<string, unknown>;
  boosts?: Array<Record<string, unknown>>;
}

export interface PerQuestionArtifactRecord {
  question_id: string;
  question: string;
  question_type: string;
  answer_session_ids: string[];
  ranking: string[];
  hits: Record<number, number>;
  recalls: Record<number, number>;
  latencyMs: number;
  topCandidates: PerQuestionArtifactCandidate[];
}

export function writePerQuestionArtifact(artifactPath: string, record: PerQuestionArtifactRecord): void {
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.appendFileSync(artifactPath, `${JSON.stringify(record)}\n`, 'utf8');
}
