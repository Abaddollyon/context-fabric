/**
 * Consistent MCP error response shape — roadmap v0.9.
 *
 * All tool errors serialize to:
 *   { error: string, code: string, details?: unknown }
 *
 * `code` is a short UPPER_SNAKE tag so clients can branch on error class
 * without string-matching on the human-readable message.
 */
import { z } from 'zod';

export type ErrorCode =
  | 'VALIDATION_ERROR'   // Zod / schema parse failure
  | 'NOT_FOUND'          // memory / resource lookup miss
  | 'UNKNOWN_TOOL'       // tool name not registered
  | 'SHUTTING_DOWN'      // server is draining
  | 'CONFLICT'           // destination exists, duplicate, etc.
  | 'INTERNAL_ERROR';    // catch-all

export interface ErrorPayload {
  error: string;
  code: ErrorCode;
  details?: unknown;
}

/**
 * Raise-able error carrying a code. Handlers throw this; the outer
 * CallToolRequest catch maps it to an MCP error response.
 */
export class ToolError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

/**
 * Map an arbitrary thrown value to a stable ErrorPayload.
 * - ToolError keeps its code/details.
 * - ZodError becomes VALIDATION_ERROR with issues[] in details.
 * - Everything else becomes INTERNAL_ERROR.
 */
export function toErrorPayload(err: unknown): ErrorPayload {
  if (err instanceof ToolError) {
    return {
      error: err.message,
      code: err.code,
      ...(err.details !== undefined ? { details: err.details } : {}),
    };
  }

  if (err instanceof z.ZodError) {
    return {
      error: 'Invalid tool arguments',
      code: 'VALIDATION_ERROR',
      details: err.issues,
    };
  }

  if (err instanceof Error) {
    // Heuristic mapping for common message substrings so legacy throws
    // get a sensible code without requiring every call site to be ported.
    const msg = err.message;
    if (/not found/i.test(msg)) {
      return { error: msg, code: 'NOT_FOUND' };
    }
    if (/unknown tool/i.test(msg)) {
      return { error: msg, code: 'UNKNOWN_TOOL' };
    }
    if (/shutting down/i.test(msg)) {
      return { error: msg, code: 'SHUTTING_DOWN' };
    }
    if (/already exists|conflict|duplicate/i.test(msg)) {
      return { error: msg, code: 'CONFLICT' };
    }
    return { error: msg, code: 'INTERNAL_ERROR' };
  }

  return { error: String(err), code: 'INTERNAL_ERROR' };
}
