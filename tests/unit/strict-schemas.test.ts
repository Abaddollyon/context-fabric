/**
 * Strict schema validation — unknown top-level fields on MCP tool schemas
 * must be rejected rather than silently dropped.
 *
 * Roadmap v0.9: Strict enum validation to catch LLM-hallucinated parameters.
 */
import { describe, expect, it } from 'vitest';
import {
  StoreMemorySchema,
  RecallSchema,
  GetCurrentContextSchema,
  SummarizeSchema,
  ReportEventSchema,
  OrientSchema,
  SetupSchema,
  SearchCodeSchema,
  GetMemorySchema,
  UpdateMemorySchema,
  DeleteMemorySchema,
  ListMemoriesSchema,
  BackupSchema,
} from '../../src/server.js';

describe('Strict Zod validation (v0.9)', () => {
  const cases: Array<[string, { safeParse: (v: unknown) => { success: boolean } }, object]> = [
    ['StoreMemorySchema', StoreMemorySchema, { type: 'decision', content: 'x', metadata: { tags: [] } }],
    ['RecallSchema', RecallSchema, { query: 'x' }],
    ['GetCurrentContextSchema', GetCurrentContextSchema, {}],
    ['SummarizeSchema', SummarizeSchema, {}],
    ['OrientSchema', OrientSchema, {}],
    ['SetupSchema', SetupSchema, { cli: 'generic' }],
    ['SearchCodeSchema', SearchCodeSchema, { query: 'x' }],
    ['GetMemorySchema', GetMemorySchema, { memoryId: 'id' }],
    ['UpdateMemorySchema', UpdateMemorySchema, { memoryId: 'id', content: 'new' }],
    ['DeleteMemorySchema', DeleteMemorySchema, { memoryId: 'id' }],
    ['ListMemoriesSchema', ListMemoriesSchema, {}],
    ['BackupSchema', BackupSchema, { destDir: '/tmp/backup' }],
    ['ReportEventSchema', ReportEventSchema, {
      event: {
        type: 'session_start',
        payload: {},
        timestamp: new Date().toISOString(),
        sessionId: 's1',
        cliType: 'generic',
      },
    }],
  ];

  for (const [name, schema, valid] of cases) {
    it(`${name} accepts valid input`, () => {
      expect(schema.safeParse(valid).success).toBe(true);
    });

    it(`${name} rejects unknown top-level fields`, () => {
      const withUnknown = { ...valid, __hallucinatedField: 'oops' };
      const result = schema.safeParse(withUnknown);
      expect(result.success).toBe(false);
    });
  }
});
