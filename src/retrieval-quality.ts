import type { Memory, MemoryLayer, MemoryMetadata, TemporalInfo } from './types.js';

export type RepresentationKind =
  | 'raw_chunk'
  | 'atomic_fact'
  | 'preference'
  | 'decision'
  | 'summary'
  | 'code_reference'
  | 'session';

export type ScoringProfileName = 'default' | 'benchmark' | 'code' | 'temporal' | 'preference';

export interface SourceSpan {
  start: number;
  end: number;
}

export interface RepresentationMetadata {
  kind: RepresentationKind;
  sourceMemoryId?: string;
  sourceTranscriptId?: string;
  sourceSpan?: SourceSpan;
  sourceSessionId?: string;
}

export interface QueryDateFeature {
  text: string;
  isoDate: string;
  timestampMs: number;
}

export interface RelativeTimeFeature {
  phrase: string;
  startMs: number;
  endMs: number;
}

export interface QueryFeatures {
  raw: string;
  normalized: string;
  quotedPhrases: string[];
  properNouns: string[];
  filePaths: string[];
  symbols: string[];
  dates: QueryDateFeature[];
  relativeTimes: RelativeTimeFeature[];
  preferenceTerms: string[];
  errorIdentifiers: string[];
}

export interface RetrievalScoreComponents {
  baseScore: number;
  bm25Score?: number;
  bm25Rank?: number;
  keywordRank?: number;
  vectorScore?: number;
  vectorRank?: number;
  rrfScore?: number;
  weightMultiplier?: number;
  boostTotal?: number;
  temporalScore?: number;
  rerankerScore?: number;
  finalScore?: number;
}

export interface RetrievalBoostExplanation {
  kind: string;
  value: number;
  matched: string;
}

export interface TemporalMatchExplanation {
  matched: boolean;
  matchedDate?: string;
  relativePhrase?: string;
  score: number;
}

export interface RetrievalExplanation {
  componentScores: RetrievalScoreComponents;
  boosts: RetrievalBoostExplanation[];
  temporalMatch?: TemporalMatchExplanation;
  representationKind?: RepresentationKind;
  provenance?: RetrievalCandidateProvenance;
}

export interface RetrievalCandidateProvenance {
  memoryId: string;
  sourceMemoryId?: string;
  sourceTranscriptId?: string;
  sourceSpan?: SourceSpan;
  sessionId?: string;
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  capturedAt?: number;
}

export interface RankedMemory extends Memory {
  layer: MemoryLayer;
  similarity: number;
  explanation?: RetrievalExplanation;
}

export interface RetrievalCandidate {
  id: string;
  memory: RankedMemory;
  layer: MemoryLayer;
  content: string;
  representationKind: RepresentationKind;
  baseScore: number;
  components: RetrievalScoreComponents;
  provenance: RetrievalCandidateProvenance;
  temporal?: TemporalInfo;
  explanation?: RetrievalExplanation;
}

export interface ScoringProfile {
  name: ScoringProfileName;
  rrfK: number;
  exactPhraseBoost: number;
  properNounBoost: number;
  filePathBoost: number;
  symbolBoost: number;
  errorIdentifierBoost: number;
  temporalBoost: number;
  representationBoosts: Partial<Record<RepresentationKind, number>>;
  recencyHalfLifeDays: number;
  localRerankWeight: number;
}

export interface ScoreRetrievalOptions {
  profile?: ScoringProfileName;
  explain?: boolean;
  dedupeRepresentations?: boolean;
  nowMs?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const SCORING_PROFILES: Record<ScoringProfileName, ScoringProfile> = {
  default: {
    name: 'default',
    rrfK: 60,
    exactPhraseBoost: 0.08,
    properNounBoost: 0.025,
    filePathBoost: 0.08,
    symbolBoost: 0.06,
    errorIdentifierBoost: 0.08,
    temporalBoost: 0.04,
    representationBoosts: { atomic_fact: 0.03, preference: 0.03, code_reference: 0.03 },
    recencyHalfLifeDays: 90,
    localRerankWeight: 0.6,
  },
  benchmark: {
    name: 'benchmark',
    rrfK: 45,
    exactPhraseBoost: 0.1,
    properNounBoost: 0.035,
    filePathBoost: 0.06,
    symbolBoost: 0.05,
    errorIdentifierBoost: 0.08,
    temporalBoost: 0.06,
    representationBoosts: { atomic_fact: 0.06, preference: 0.06, session: 0.01 },
    recencyHalfLifeDays: 60,
    localRerankWeight: 0.14,
  },
  code: {
    name: 'code',
    rrfK: 50,
    exactPhraseBoost: 0.08,
    properNounBoost: 0.02,
    filePathBoost: 0.12,
    symbolBoost: 0.1,
    errorIdentifierBoost: 0.1,
    temporalBoost: 0.02,
    representationBoosts: { code_reference: 0.08, decision: 0.03 },
    recencyHalfLifeDays: 120,
    localRerankWeight: 0.1,
  },
  temporal: {
    name: 'temporal',
    rrfK: 60,
    exactPhraseBoost: 0.06,
    properNounBoost: 0.02,
    filePathBoost: 0.04,
    symbolBoost: 0.04,
    errorIdentifierBoost: 0.06,
    temporalBoost: 0.14,
    representationBoosts: { atomic_fact: 0.03, session: 0.02 },
    recencyHalfLifeDays: 30,
    localRerankWeight: 0.08,
  },
  preference: {
    name: 'preference',
    rrfK: 50,
    exactPhraseBoost: 0.12,
    properNounBoost: 0.04,
    filePathBoost: 0.08,
    symbolBoost: 0.04,
    errorIdentifierBoost: 0.08,
    temporalBoost: 0.04,
    representationBoosts: { preference: 0.12, atomic_fact: 0.05, session: -0.01 },
    recencyHalfLifeDays: 60,
    localRerankWeight: 0.16,
  },
};

export function extractQueryFeatures(query: string, nowMs = Date.now()): QueryFeatures {
  const quotedPhrases = unique([...query.matchAll(/["“]([^"”]+)["”]/g)].map((m) => m[1].trim()).filter(Boolean));
  const filePaths = unique([...query.matchAll(/(?:^|\s)((?:[.~]?\/?[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]+)(?=$|\s|[,):;!?])/g)].map((m) => trimToken(m[1])));
  const dottedSymbols = [...query.matchAll(/\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\b/g)].map((m) => m[0]);
  const parenSymbols = [...query.matchAll(/\b[A-Za-z_$][\w$]*\(\)/g)].map((m) => m[0].slice(0, -2));
  const symbols = unique([...dottedSymbols, ...parenSymbols].filter((s) => !filePaths.includes(s)));
  const errorIdentifiers = unique([...query.matchAll(/\b(?:[A-Z][A-Z0-9]+-\d+|(?:ERR|ERROR|BUG|FAIL|E[A-Z0-9_]{2,})[A-Z0-9_-]*)\b/g)].map((m) => trimToken(m[0])));
  const properNouns = unique([...query.matchAll(/\b[A-Z][a-zA-Z0-9]*(?:[A-Z][a-zA-Z0-9]*)?\b/g)]
    .map((m) => trimToken(m[0]))
    .filter((token) => token.length > 1 && !COMMON_CAPITALIZED.has(token) && !errorIdentifiers.includes(token)));
  const dates = extractDates(query);
  const relativeTimes = extractRelativeTimes(query, nowMs);
  const lower = query.toLowerCase();
  const preferenceTerms = unique(PREFERENCE_TERMS.filter((term) => lower.includes(term)));

  return {
    raw: query,
    normalized: normalize(query),
    quotedPhrases,
    properNouns,
    filePaths,
    symbols,
    dates,
    relativeTimes,
    preferenceTerms,
    errorIdentifiers,
  };
}

export function buildRetrievalCandidate(input: {
  memory: Memory | RankedMemory;
  layer: MemoryLayer;
  baseScore: number;
  components?: Partial<RetrievalScoreComponents>;
}): RetrievalCandidate {
  const ranked = input.memory as RankedMemory;
  const memory: RankedMemory = {
    ...ranked,
    layer: input.layer,
    similarity: ranked.similarity ?? input.baseScore,
  };
  const representation = getRepresentation(memory.metadata);
  const kind = representation?.kind ?? inferRepresentationKind(memory);
  const provenance = buildProvenance(memory, representation);
  const components: RetrievalScoreComponents = {
    baseScore: input.baseScore,
    ...input.components,
  };

  return {
    id: memory.id,
    memory,
    layer: input.layer,
    content: memory.content,
    representationKind: kind,
    baseScore: input.baseScore,
    components,
    provenance,
    temporal: memory.metadata?.temporal,
    explanation: memory.explanation,
  };
}

export function scoreRetrievalCandidates(
  candidates: RetrievalCandidate[],
  features: QueryFeatures,
  options: ScoreRetrievalOptions = {},
): RankedMemory[] {
  const profile = SCORING_PROFILES[options.profile ?? 'default'];
  const nowMs = options.nowMs ?? Date.now();
  const scored = candidates.map((candidate, index) => {
    const boosts: RetrievalBoostExplanation[] = [];
    let boostTotal = 0;

    const addBoost = (kind: string, value: number, matched: string): void => {
      if (value === 0) return;
      boostTotal += value;
      boosts.push({ kind, value, matched });
    };

    for (const phrase of features.quotedPhrases) {
      if (containsNormalized(candidate.content, phrase)) addBoost('quoted_phrase', profile.exactPhraseBoost, phrase);
    }
    for (const noun of features.properNouns) {
      if (containsWord(candidate.content, noun)) addBoost('proper_noun', profile.properNounBoost, noun);
    }
    for (const filePath of features.filePaths) {
      if (candidate.content.includes(filePath) || String(candidate.memory.metadata?.fileContext?.path ?? '').includes(filePath)) {
        addBoost('file_path', profile.filePathBoost, filePath);
      }
    }
    for (const symbol of features.symbols) {
      if (candidate.content.includes(symbol)) addBoost('symbol', profile.symbolBoost, symbol);
    }
    for (const err of features.errorIdentifiers) {
      if (candidate.content.includes(err)) addBoost('error_identifier', profile.errorIdentifierBoost, err);
    }

    const repBoost = profile.representationBoosts[candidate.representationKind] ?? 0;
    if (repBoost !== 0) addBoost('representation', repBoost, candidate.representationKind);

    const temporalMatch = computeTemporalMatch(candidate, features, profile, nowMs);
    if (temporalMatch.score > 0) addBoost('temporal', temporalMatch.score, temporalMatch.matchedDate ?? temporalMatch.relativePhrase ?? 'recency');

    const anchorScore = boosts.reduce((sum, boost) => sum + Math.max(0, boost.value), 0);
    let finalScore = candidate.baseScore + boostTotal;
    const components: RetrievalScoreComponents = {
      ...candidate.components,
      boostTotal,
      temporalScore: temporalMatch.score,
    };

    const similarity = clamp01(finalScore);
    components.finalScore = similarity;

    const explanation: RetrievalExplanation = {
      componentScores: components,
      boosts,
      temporalMatch,
      representationKind: candidate.representationKind,
      provenance: candidate.provenance,
    };

    return {
      candidate,
      rankStableIndex: index,
      finalScore,
      memory: {
        ...candidate.memory,
        similarity,
        explanation,
      } as RankedMemory,
    };
  });

  const deduped = options.dedupeRepresentations ? dedupeBySourceEvidence(scored) : scored;
  return deduped
    .sort((a, b) => b.finalScore - a.finalScore || a.rankStableIndex - b.rankStableIndex)
    .map((row) => row.memory);
}

export function generateDeterministicRepresentations(memory: Memory): Memory[] {
  const representations: Memory[] = [];
  const content = memory.content;
  const sentences = splitSentencesWithOffsets(content);

  for (const sentence of sentences) {
    const lower = sentence.text.toLowerCase();
    if (PREFERENCE_TERMS.some((term) => lower.includes(term))) {
      representations.push(derivedMemory(memory, sentence.text, 'preference', sentence.start, sentence.end));
      continue;
    }
    if (/\b(?:my|i am|i'm|i work|i live|my manager|my role|my team|my name)\b/i.test(sentence.text)) {
      representations.push(derivedMemory(memory, sentence.text, 'atomic_fact', sentence.start, sentence.end));
    }
  }

  return representations;
}

function derivedMemory(source: Memory, content: string, kind: RepresentationKind, start: number, end: number): Memory {
  const sourceRepresentation = getRepresentation(source.metadata);
  const metadata: MemoryMetadata = {
    tags: source.metadata?.tags ?? source.tags ?? [],
    relationships: source.metadata?.relationships ?? [],
    confidence: source.metadata?.confidence ?? 0.8,
    source: 'system_auto',
    cliType: source.metadata?.cliType ?? 'generic',
    ...source.metadata,
    representation: {
      kind,
      sourceMemoryId: source.id,
      sourceTranscriptId: sourceRepresentation?.sourceTranscriptId,
      sourceSessionId: sourceRepresentation?.sourceSessionId ?? source.metadata?.provenance?.sessionId,
      sourceSpan: { start, end },
    },
    provenance: source.metadata?.provenance,
  };

  return {
    ...source,
    id: `${source.id}:${kind}:${start}-${end}`,
    content,
    metadata,
    tags: metadata.tags,
    embedding: undefined,
  };
}

function dedupeBySourceEvidence<T extends { candidate: RetrievalCandidate; finalScore: number; rankStableIndex: number; memory: RankedMemory }>(rows: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    const key = sourceEvidenceKey(row.candidate);
    const existing = byKey.get(key);
    if (!existing || isBetterRepresentation(row, existing)) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values()];
}

function isBetterRepresentation<T extends { candidate: RetrievalCandidate; finalScore: number }>(next: T, current: T): boolean {
  if (next.finalScore !== current.finalScore) return next.finalScore > current.finalScore;
  return representationPriority(next.candidate.representationKind) > representationPriority(current.candidate.representationKind);
}

function representationPriority(kind: RepresentationKind): number {
  switch (kind) {
    case 'preference': return 7;
    case 'atomic_fact': return 6;
    case 'decision': return 5;
    case 'code_reference': return 4;
    case 'summary': return 3;
    case 'session': return 2;
    case 'raw_chunk': return 1;
  }
}

function sourceEvidenceKey(candidate: RetrievalCandidate): string {
  return candidate.provenance.sourceMemoryId ?? candidate.id;
}

function getRepresentation(metadata?: MemoryMetadata): RepresentationMetadata | undefined {
  const rep = metadata?.representation;
  if (!rep || typeof rep !== 'object') return undefined;
  const record = rep as Record<string, unknown>;
  const kind = record.kind;
  if (!isRepresentationKind(kind)) return undefined;
  const sourceSpan = record.sourceSpan as Partial<SourceSpan> | undefined;
  return {
    kind,
    sourceMemoryId: typeof record.sourceMemoryId === 'string' ? record.sourceMemoryId : undefined,
    sourceTranscriptId: typeof record.sourceTranscriptId === 'string' ? record.sourceTranscriptId : undefined,
    sourceSessionId: typeof record.sourceSessionId === 'string' ? record.sourceSessionId : undefined,
    sourceSpan: typeof sourceSpan?.start === 'number' && typeof sourceSpan.end === 'number'
      ? { start: sourceSpan.start, end: sourceSpan.end }
      : undefined,
  };
}

function inferRepresentationKind(memory: Memory): RepresentationKind {
  if (memory.type === 'decision') return 'decision';
  if (memory.type === 'summary') return 'summary';
  if (memory.metadata?.codeBlock || memory.metadata?.fileContext) return 'code_reference';
  return 'raw_chunk';
}

function buildProvenance(memory: RankedMemory, representation?: RepresentationMetadata): RetrievalCandidateProvenance {
  const provenance = memory.metadata?.provenance;
  return {
    memoryId: memory.id,
    sourceMemoryId: representation?.sourceMemoryId,
    sourceTranscriptId: representation?.sourceTranscriptId,
    sourceSpan: representation?.sourceSpan,
    sessionId: representation?.sourceSessionId ?? provenance?.sessionId,
    filePath: provenance?.filePath ?? memory.metadata?.fileContext?.path,
    lineStart: provenance?.lineStart ?? memory.metadata?.fileContext?.lineStart,
    lineEnd: provenance?.lineEnd ?? memory.metadata?.fileContext?.lineEnd,
    capturedAt: provenance?.capturedAt,
  };
}

function computeTemporalMatch(
  candidate: RetrievalCandidate,
  features: QueryFeatures,
  profile: ScoringProfile,
  nowMs: number,
): TemporalMatchExplanation {
  const content = candidate.content;
  for (const date of features.dates) {
    if (content.includes(date.isoDate) || content.includes(date.text)) {
      return { matched: true, matchedDate: date.isoDate, score: profile.temporalBoost };
    }
    const created = toMs(candidate.memory.createdAt);
    if (sameUtcDay(created, date.timestampMs)) {
      return { matched: true, matchedDate: date.isoDate, score: profile.temporalBoost * 0.8 };
    }
  }
  for (const rel of features.relativeTimes) {
    const created = toMs(candidate.memory.createdAt);
    if (created >= rel.startMs && created < rel.endMs) {
      return { matched: true, relativePhrase: rel.phrase, score: profile.temporalBoost * 0.8 };
    }
  }

  const created = toMs(candidate.memory.createdAt);
  if (created > 0 && features.dates.length === 0 && features.relativeTimes.length > 0) {
    const daysOld = Math.max(0, (nowMs - created) / DAY_MS);
    const recency = Math.pow(0.5, daysOld / profile.recencyHalfLifeDays) * profile.temporalBoost * 0.25;
    if (recency > 0.001) return { matched: false, score: recency };
  }

  return { matched: false, score: 0 };
}

function representationAnchorScore(candidate: RetrievalCandidate, features: QueryFeatures): number {
  let score = 0;
  if (candidate.representationKind === 'preference' && features.preferenceTerms.length > 0) score += 0.6;
  if (candidate.representationKind === 'atomic_fact') score += 0.3;
  return score;
}

function splitSentencesWithOffsets(content: string): Array<{ text: string; start: number; end: number }> {
  const matches = [...content.matchAll(/[^.!?\n]+[.!?]?/g)];
  return matches
    .map((m) => ({ text: m[0].trim(), start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }))
    .filter((s) => s.text.length > 0);
}

function extractDates(query: string): QueryDateFeature[] {
  const out: QueryDateFeature[] = [];
  for (const match of query.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const timestampMs = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    out.push({ text: match[0], isoDate: match[0], timestampMs });
  }
  for (const match of query.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) {
    const timestampMs = Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2]));
    out.push({ text: match[0], isoDate: isoDate(timestampMs), timestampMs });
  }
  return uniqueBy(out, (d) => d.isoDate);
}

function extractRelativeTimes(query: string, nowMs: number): RelativeTimeFeature[] {
  const lower = query.toLowerCase();
  const startToday = startOfUtcDay(nowMs);
  const out: RelativeTimeFeature[] = [];
  if (lower.includes('today')) out.push({ phrase: 'today', startMs: startToday, endMs: startToday + DAY_MS });
  if (lower.includes('yesterday')) out.push({ phrase: 'yesterday', startMs: startToday - DAY_MS, endMs: startToday });
  if (lower.includes('last week')) out.push({ phrase: 'last week', startMs: startToday - 7 * DAY_MS, endMs: startToday });
  if (lower.includes('this week')) out.push({ phrase: 'this week', startMs: startToday - 6 * DAY_MS, endMs: startToday + DAY_MS });
  return out;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function uniqueBy<T>(values: T[], keyFn: (value: T) => string): T[] {
  const map = new Map<string, T>();
  for (const value of values) map.set(keyFn(value), value);
  return [...map.values()];
}

function trimToken(token: string): string {
  return token.replace(/^[\s(\[]+|[\s),.;:!?\]]+$/g, '');
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function containsNormalized(content: string, needle: string): boolean {
  return normalize(content).includes(normalize(needle));
}

function containsWord(content: string, word: string): boolean {
  return new RegExp(`\\b${escapeRegExp(word)}\\b`).test(content);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function toMs(value: Date | number | undefined): number {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  return 0;
}

function sameUtcDay(a: number, b: number): boolean {
  return isoDate(a) === isoDate(b);
}

function startOfUtcDay(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function isRepresentationKind(value: unknown): value is RepresentationKind {
  return typeof value === 'string' && REPRESENTATION_KINDS.has(value as RepresentationKind);
}

const REPRESENTATION_KINDS = new Set<RepresentationKind>([
  'raw_chunk',
  'atomic_fact',
  'preference',
  'decision',
  'summary',
  'code_reference',
  'session',
]);

const PREFERENCE_TERMS = [
  'prefer',
  'prefers',
  'preferred',
  'preference',
  'likes',
  'dislikes',
  'favorite',
  'favourite',
  'rather',
];

const COMMON_CAPITALIZED = new Set([
  'What',
  'When',
  'Where',
  'Who',
  'Why',
  'How',
  'Find',
  'After',
  'Before',
  'The',
  'A',
  'An',
  'User',
  'Assistant',
]);
