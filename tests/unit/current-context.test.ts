import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ContextEngine } from '../../src/engine.js';
import { resetConfigCache } from '../../src/config.js';
import { MemoryLayer } from '../../src/types.js';
import { extractSymbols } from '../../src/indexer/symbols.js';

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cf-current-context-'));
  writeFileSync(join(dir, 'calculator.ts'), [
    'import { strict as assert } from "node:assert";',
    'export interface CalculatorOptions { precision: number }',
    'export type NumericInput = number | string;',
    'export enum CalculatorMode { Fast = "fast" }',
    'export class CalculatorService {',
    '  constructor(private options: CalculatorOptions) {}',
    '  add(a: number, b: number): number {',
    '    return a + b;',
    '  }',
    '}',
    'export const calculatorVersion = "1.0.0";',
    'export function describeCalculator() {',
    '  return calculatorVersion;',
    '}',
    'test("adds numbers", () => {',
    '  assert.equal(new CalculatorService({ precision: 2 }).add(1, 2), 3);',
    '});',
  ].join('\n'));
  return dir;
}

describe('Sprint 4 code-aware current context', () => {
  let projectPath: string;
  let homePath: string;

  beforeEach(() => {
    projectPath = makeProject();
    homePath = mkdtempSync(join(tmpdir(), 'cf-current-context-home-'));
    process.env.CONTEXT_FABRIC_HOME = homePath;
    resetConfigCache();
  });

  afterEach(() => {
    delete process.env.CONTEXT_FABRIC_HOME;
    resetConfigCache();
    rmSync(projectPath, { recursive: true, force: true });
    rmSync(homePath, { recursive: true, force: true });
  });

  it('builds bounded active-code, decision, error, section, and ghost context from current file and command', async () => {
    const engine = new ContextEngine({ projectPath, autoCleanup: false, isEphemeral: true, logLevel: 'error' });
    try {
      await engine.store('Use CalculatorService for all arithmetic behavior in calculator.ts.', 'decision', {
        layer: MemoryLayer.L2_PROJECT,
        metadata: {
          title: 'Calculator architecture',
          tags: ['calculator'],
          fileContext: { path: 'calculator.ts', language: 'typescript' },
          source: 'user_explicit',
          cliType: 'generic',
        },
        tags: ['calculator'],
      });
      await engine.store('Error from command "npm test -- calculator": AssertionError: expected add result in calculator.ts', 'bug_fix', {
        layer: MemoryLayer.L2_PROJECT,
        metadata: {
          tags: ['error'],
          command: 'npm test -- calculator',
          fileContext: { path: 'calculator.ts', language: 'typescript' },
          source: 'system_auto',
          cliType: 'generic',
        },
        tags: ['error'],
      });

      const context = await engine.getContextWindow({
        sessionId: 'sprint4',
        currentFile: join(projectPath, 'calculator.ts'),
        currentCommand: 'npm test -- calculator AssertionError: expected 4 received 3',
        language: 'typescript',
        cursorLine: 7,
      });

      expect(context.query?.activeFile).toBe('calculator.ts');
      expect(context.query?.currentCommand).toContain('npm test');
      expect(context.activeCode?.filePath).toBe('calculator.ts');
      expect(context.activeCode?.activeSymbol?.name).toBe('add');
      expect(context.activeCode?.symbols.map((s) => s.name)).toContain('CalculatorService');
      expect(context.activeCode?.chunks.length).toBeGreaterThan(0);
      expect(context.relatedDecisions?.[0].content).toContain('CalculatorService');
      expect(context.recentErrors?.[0].content).toContain('AssertionError');
      expect(context.sections?.map((s) => s.id)).toEqual(expect.arrayContaining(['active-code', 'related-decisions', 'recent-errors']));
      expect(context.ghostMessages.some((m) => m.trigger === 'active_code_context')).toBe(true);
      expect(context.relevant.length).toBeLessThanOrEqual(10);
    } finally {
      engine.close();
    }
  });

  it('normalizes absolute, relative, outside-project, and deleted file paths during file-open indexing', async () => {
    const engine = new ContextEngine({ projectPath, autoCleanup: false, isEphemeral: true, logLevel: 'error' });
    try {
      const index = engine.getCodeIndex();
      await index.ensureReady();
      await index.reindexFile(join(projectPath, 'calculator.ts'));
      expect(index.getFileSymbols('calculator.ts').map((s) => s.name)).toContain('CalculatorService');

      await index.reindexFile('calculator.ts');
      expect(index.getStatus().totalFiles).toBe(1);

      const outside = join(tmpdir(), 'outside-context-fabric-file.ts');
      writeFileSync(outside, 'export const outside = true;');
      await index.reindexFile(outside);
      expect(index.getStatus().totalFiles).toBe(1);
      rmSync(outside, { force: true });

      unlinkSync(join(projectPath, 'calculator.ts'));
      await index.reindexFile('calculator.ts');
      expect(index.getFileSymbols('calculator.ts')).toEqual([]);
    } finally {
      engine.close();
    }
  });

  it('reports and repairs deleted indexed files', async () => {
    const engine = new ContextEngine({ projectPath, autoCleanup: false, isEphemeral: true, logLevel: 'error' });
    try {
      const index = engine.getCodeIndex();
      await index.ensureReady();
      expect(index.getStatus().totalFiles).toBe(1);

      unlinkSync(join(projectPath, 'calculator.ts'));
      const dryRun = await index.repair({ dryRun: true });
      expect(dryRun.issuesBefore.some((issue) => issue.type === 'missing_file')).toBe(true);
      expect(index.getStatus().totalFiles).toBe(1);

      const repaired = await index.repair();
      expect(repaired.deleted).toBe(1);
      expect(repaired.issuesAfter.some((issue) => issue.type === 'missing_file')).toBe(false);
      expect(index.getStatus().totalFiles).toBe(0);
    } finally {
      engine.close();
    }
  });

  it('extracts richer TypeScript symbols including imports, exports, methods, interfaces, types, enums, and tests', () => {
    const symbols = extractSymbols([
      'import { describe, it } from "vitest";',
      'export interface UserRepo { find(id: string): User }',
      'export type User = { id: string };',
      'export enum Role { Admin = "admin" }',
      'export class UserService {',
      '  findUser(id: string): User { return { id }; }',
      '}',
      'export const makeUser = () => ({ id: "1" });',
      'test("creates user", () => {});',
    ].join('\n'), 'typescript');

    expect(symbols.map((s) => `${s.kind}:${s.name}`)).toEqual(expect.arrayContaining([
      'export:describe',
      'export:it',
      'interface:UserRepo',
      'type:User',
      'enum:Role',
      'class:UserService',
      'method:findUser',
      'function:makeUser',
      'function:creates user',
    ]));
  });
});
