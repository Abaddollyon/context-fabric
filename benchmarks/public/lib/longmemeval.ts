/**
 * LongMemEval dataset loader.
 *
 * LongMemEval (Wu et al., ICLR 2025; arXiv 2410.10813) ships one JSON array
 * per variant (`longmemeval_s.json`, `longmemeval_m.json`, `longmemeval_oracle.json`).
 * Each element has the following shape (abbreviated):
 *
 *   {
 *     "question_id":          string,
 *     "question_type":        "single-session-user" | "single-session-assistant"
 *                           | "multi-session" | "temporal-reasoning"
 *                           | "knowledge-update" | "abstention",
 *     "question":             string,
 *     "answer":               string,
 *     "haystack_session_ids": string[],           // parallel to haystack_sessions
 *     "haystack_dates":       string[],
 *     "haystack_sessions":    Array<Array<{ role: "user" | "assistant", content: string }>>,
 *     "answer_session_ids":   string[]            // gold evidence
 *   }
 *
 * Dataset sources (any of these works; see scripts/bench-public.sh):
 *   - HuggingFace:  https://huggingface.co/datasets/xiaowu0162/longmemeval
 *   - GitHub:       https://github.com/xiaowu0162/LongMemEval
 */

import * as fs from 'node:fs';

export interface LmeTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface LmeQuestion {
  question_id: string;
  question_type: string;
  question: string;
  answer: string;
  haystack_session_ids: string[];
  haystack_dates?: string[];
  haystack_sessions: LmeTurn[][];
  answer_session_ids: string[];
}

export function loadLongMemEval(filePath: string): LmeQuestion[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `LongMemEval file missing: ${filePath}\n` +
      'Run `scripts/bench-public.sh download longmemeval_s` first.',
    );
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error(`Expected JSON array in ${filePath}, got ${typeof data}`);
  }
  return data as LmeQuestion[];
}

/**
 * Render a session (list of turns) into a single searchable document.
 * Mirrors the conventional representation used in the LongMemEval reference
 * pipeline: each turn on its own line, role-prefixed.
 */
export function renderSession(turns: LmeTurn[], date?: string): string {
  const header = date ? `[session date: ${date}]\n` : '';
  const body = turns
    .map((t) => `${t.role}: ${t.content}`)
    .join('\n');
  return header + body;
}

/**
 * Group question IDs by question_type — used for per-category metrics.
 */
export function groupByType(questions: LmeQuestion[]): Map<string, LmeQuestion[]> {
  const out = new Map<string, LmeQuestion[]>();
  for (const q of questions) {
    const arr = out.get(q.question_type) ?? [];
    arr.push(q);
    out.set(q.question_type, arr);
  }
  return out;
}
