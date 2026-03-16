/**
 * Shared FTS5 query sanitization utility.
 *
 * Used by ProjectMemoryLayer, SemanticMemoryLayer, and CodeIndex to strip
 * FTS5 special operators before running MATCH queries.
 */

/**
 * Sanitize a user query for safe use in an FTS5 MATCH expression.
 *
 * Strips FTS5 operators and boolean keywords, then wraps each token in
 * double-quotes to force literal matching. Returns an empty string if
 * nothing usable remains.
 */
export function sanitizeFTS5Query(query: string): string {
  const cleaned = query
    .replace(/[*"():^{}~<>]/g, ' ')
    .replace(/\b(AND|OR|NOT|NEAR)\b/gi, '')
    .trim();
  if (!cleaned) return '';

  const tokens = cleaned.split(/\s+/).filter(t => t.length > 0);
  if (tokens.length === 0) return '';

  return tokens.map(t => `"${t}"`).join(' ');
}
