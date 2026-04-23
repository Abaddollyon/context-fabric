/**
 * Standard IR metrics in pure JS.
 *
 * Conventions match `pytrec_eval` / BEIR so numbers are directly comparable
 * to the BEIR leaderboard and to the Mem0 / Zep / LongMemEval papers:
 *
 *   DCG@k = sum over top-k of (2^rel_i - 1) / log2(i + 2)
 *   nDCG@k = DCG@k / iDCG@k   (iDCG built from the best-possible graded rels)
 *   Recall@k = |{retrieved in top-k} ∩ {rel > 0}| / |{rel > 0}|
 *   MRR@k    = 1 / rank of the first rel > 0 hit in top-k (0 if none)
 *
 * All three functions accept:
 *   - `ranking`:  array of doc-ids in predicted order (highest score first)
 *   - `rels`:     Map<docId, graded-relevance> from qrels for this query
 */

export type RelMap = Map<string, number>;

export function ndcgAtK(ranking: string[], rels: RelMap, k: number): number {
  const topK = ranking.slice(0, k);
  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    const rel = rels.get(topK[i]) ?? 0;
    if (rel > 0) {
      dcg += (Math.pow(2, rel) - 1) / Math.log2(i + 2);
    }
  }

  const idealRels = [...rels.values()]
    .filter((r) => r > 0)
    .sort((a, b) => b - a)
    .slice(0, k);
  let idcg = 0;
  for (let i = 0; i < idealRels.length; i++) {
    idcg += (Math.pow(2, idealRels[i]) - 1) / Math.log2(i + 2);
  }

  return idcg === 0 ? 0 : dcg / idcg;
}

export function recallAtK(ranking: string[], rels: RelMap, k: number): number {
  const relevant = new Set(
    [...rels.entries()].filter(([, r]) => r > 0).map(([id]) => id),
  );
  if (relevant.size === 0) return 0;
  let hits = 0;
  const topK = ranking.slice(0, k);
  for (const id of topK) {
    if (relevant.has(id)) hits++;
  }
  return hits / relevant.size;
}

export function mrrAtK(ranking: string[], rels: RelMap, k: number): number {
  const topK = ranking.slice(0, k);
  for (let i = 0; i < topK.length; i++) {
    const rel = rels.get(topK[i]) ?? 0;
    if (rel > 0) return 1 / (i + 1);
  }
  return 0;
}

/**
 * Hit rate at k: 1 if any relevant doc appears in top-k else 0.
 * This is the metric LongMemEval reports for retrieval (as "recall@k" in the
 * paper, but really a hit-rate when |rel|=1).
 */
export function hitAtK(ranking: string[], rels: RelMap, k: number): number {
  const relevant = new Set(
    [...rels.entries()].filter(([, r]) => r > 0).map(([id]) => id),
  );
  const topK = ranking.slice(0, k);
  for (const id of topK) {
    if (relevant.has(id)) return 1;
  }
  return 0;
}

export function percentile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(sortedAsc.length * q)));
  return sortedAsc[idx];
}
