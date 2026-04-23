/**
 * BEIR dataset loader.
 *
 * BEIR datasets are distributed as zip archives containing three files:
 *   corpus.jsonl       : { "_id": str, "title": str, "text": str, "metadata"?: {} }
 *   queries.jsonl      : { "_id": str, "text": str, "metadata"?: {} }
 *   qrels/test.tsv     : header row "query-id\tcorpus-id\tscore" then TSV rows
 *
 * Download URL: https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/{name}.zip
 * Download lives in `scripts/bench-public.sh`; this module just parses the
 * already-extracted files.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface BeirCorpusEntry {
  title: string;
  text: string;
}

export interface BeirDataset {
  name: string;
  corpus: Map<string, BeirCorpusEntry>;
  queries: Map<string, string>;
  /** qid -> (docid -> graded relevance). Only queries with qrels are included. */
  qrels: Map<string, Map<string, number>>;
}

export function loadBeir(rootDir: string, name: string): BeirDataset {
  const corpusPath = path.join(rootDir, 'corpus.jsonl');
  const queriesPath = path.join(rootDir, 'queries.jsonl');
  const qrelsPath = path.join(rootDir, 'qrels', 'test.tsv');

  for (const p of [corpusPath, queriesPath, qrelsPath]) {
    if (!fs.existsSync(p)) {
      throw new Error(
        `BEIR file missing: ${p}\n` +
        `Run \`scripts/bench-public.sh download ${name}\` first, ` +
        `or set BENCH_CACHE to a directory that contains the extracted BEIR archive.`,
      );
    }
  }

  const corpus = parseJsonl<{ _id: string; title?: string; text?: string }>(corpusPath);
  const corpusMap = new Map<string, BeirCorpusEntry>();
  for (const row of corpus) {
    corpusMap.set(row._id, { title: row.title ?? '', text: row.text ?? '' });
  }

  const queries = parseJsonl<{ _id: string; text?: string }>(queriesPath);
  const queriesMap = new Map<string, string>();
  for (const row of queries) {
    queriesMap.set(row._id, row.text ?? '');
  }

  const qrels = parseQrels(qrelsPath);

  // Restrict the query set to those with at least one qrel row (BEIR convention).
  const filteredQueries = new Map<string, string>();
  for (const [qid, q] of queriesMap) {
    if (qrels.has(qid)) filteredQueries.set(qid, q);
  }

  return { name, corpus: corpusMap, queries: filteredQueries, qrels };
}

function parseJsonl<T>(filePath: string): T[] {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const out: T[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    out.push(JSON.parse(line) as T);
  }
  return out;
}

function parseQrels(filePath: string): Map<string, Map<string, number>> {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n');
  const qrels = new Map<string, Map<string, number>>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Skip header (BEIR convention: "query-id\tcorpus-id\tscore")
    if (i === 0 && line.toLowerCase().startsWith('query-id')) continue;

    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [qid, docid, scoreStr] = parts;
    const score = parseInt(scoreStr, 10);
    if (Number.isNaN(score)) continue;

    let m = qrels.get(qid);
    if (!m) {
      m = new Map();
      qrels.set(qid, m);
    }
    m.set(docid, score);
  }

  return qrels;
}
