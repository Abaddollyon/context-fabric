import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ToolError, toErrorPayload } from '../../src/errors.js';

describe('Error response schema (v0.9)', () => {
  it('ToolError passes through code + details', () => {
    const err = new ToolError('NOT_FOUND', 'memory abc missing', { memoryId: 'abc' });
    const p = toErrorPayload(err);
    expect(p).toEqual({ error: 'memory abc missing', code: 'NOT_FOUND', details: { memoryId: 'abc' } });
  });

  it('ZodError becomes VALIDATION_ERROR with issues', () => {
    const schema = z.object({ x: z.string() });
    const parsed = schema.safeParse({ x: 123 });
    if (parsed.success) throw new Error('expected failure');
    const p = toErrorPayload(parsed.error);
    expect(p.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(p.details)).toBe(true);
  });

  it('generic Error with "not found" maps to NOT_FOUND', () => {
    expect(toErrorPayload(new Error('Memory xyz not found in L2')).code).toBe('NOT_FOUND');
  });

  it('generic Error with "already exists" maps to CONFLICT', () => {
    expect(toErrorPayload(new Error('file already exists: /tmp/foo')).code).toBe('CONFLICT');
  });

  it('falls back to INTERNAL_ERROR for unknown errors', () => {
    expect(toErrorPayload(new Error('something broke')).code).toBe('INTERNAL_ERROR');
  });

  it('handles non-Error throws', () => {
    expect(toErrorPayload('string thrown').code).toBe('INTERNAL_ERROR');
    expect(toErrorPayload('string thrown').error).toBe('string thrown');
  });
});
