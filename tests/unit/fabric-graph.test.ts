/**
 * Sprint 3 scoped fabric temporal graph tests.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContextEngine } from '../../src/engine.js';
import { MemoryLayer } from '../../src/types.js';
import type { FabricEntityKind } from '../../src/fabric-graph.js';

const ENTITY_KINDS: FabricEntityKind[] = [
  'user',
  'workspace',
  'project',
  'branch',
  'session',
  'agent',
  'file',
  'symbol',
  'task',
  'memory',
  'decision',
  'error',
  'skill',
];

describe('FabricGraphService', () => {
  let tmpDir: string;
  let engine: ContextEngine;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cf-graph-'));
    engine = new ContextEngine({ projectPath: tmpDir, isEphemeral: true, autoCleanup: false, logLevel: 'error' });
  });

  afterEach(() => {
    engine.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('upserts scoped entity kinds without duplicates and links project scope', () => {
    const created = ENTITY_KINDS.map((kind) => engine.graph.upsertEntity({
      kind,
      key: `${kind}:primary`,
      name: `${kind} primary`,
    }));

    for (const kind of ENTITY_KINDS) {
      const again = engine.graph.upsertEntity({ kind, key: `${kind}:primary`, name: 'updated name' });
      const matching = engine.graph.findEntities({ kind, key: `${kind}:primary` });
      expect(matching).toHaveLength(1);
      expect(again.id).toBe(matching[0]!.id);
    }

    const project = created.find((entity) => entity.kind === 'project')!;
    const session = created.find((entity) => entity.kind === 'session')!;
    const edge = engine.graph.upsertRelationship({
      type: 'scoped_to',
      fromEntityId: session.id,
      toEntityId: project.id,
      provenance: { source: 'test' },
    });
    const duplicate = engine.graph.upsertRelationship({
      type: 'scoped_to',
      fromEntityId: session.id,
      toEntityId: project.id,
      provenance: { source: 'test' },
    });

    expect(duplicate.id).toBe(edge.id);
    expect(engine.graph.neighbors(session.id).map((n) => n.entity.id)).toContain(project.id);
  });

  it('supports temporal invalidation and as-of neighbor queries', () => {
    const oldDecision = engine.graph.upsertEntity({ kind: 'decision', key: 'decision:sqlite-v1', name: 'Use SQLite v1' });
    const newDecision = engine.graph.upsertEntity({ kind: 'decision', key: 'decision:sqlite-v2', name: 'Use SQLite v2' });
    const project = engine.graph.upsertEntity({ kind: 'project', key: `project:${tmpDir}`, name: tmpDir });

    engine.graph.upsertRelationship({
      type: 'decides_for',
      fromEntityId: oldDecision.id,
      toEntityId: project.id,
      validFrom: 100,
      sourceMemoryId: 'old-memory',
    });
    engine.graph.supersedeRelationship({
      type: 'decides_for',
      fromEntityId: oldDecision.id,
      toEntityId: project.id,
      supersededBy: {
        fromEntityId: newDecision.id,
        toEntityId: project.id,
        validFrom: 200,
        sourceMemoryId: 'new-memory',
      },
      at: 200,
    });

    expect(engine.graph.neighbors(project.id, { asOf: 150 }).map((n) => n.entity.id)).toContain(oldDecision.id);
    expect(engine.graph.neighbors(project.id, { asOf: 250 }).map((n) => n.entity.id)).not.toContain(oldDecision.id);
    expect(engine.graph.neighbors(project.id, { asOf: 250 }).map((n) => n.entity.id)).toContain(newDecision.id);
  });

  it('projects decision supersession into lineage and current/as-of decision workflows', async () => {
    const first = await engine.store('Decision: Use SQLite', 'decision', {
      layer: MemoryLayer.L3_SEMANTIC,
      metadata: { title: 'Use SQLite', temporal: { validFrom: 100 } },
    });
    const second = await engine.store('Decision: Keep SQLite but add graph tables', 'decision', {
      layer: MemoryLayer.L3_SEMANTIC,
      metadata: { title: 'Use scoped graph', supersedes: first.id, temporal: { validFrom: 200 } },
    });

    const current = engine.graph.listCurrentDecisions();
    expect(current.map((item) => item.entity.sourceMemoryId)).toContain(second.id);
    expect(current.map((item) => item.entity.sourceMemoryId)).not.toContain(first.id);

    const historical = engine.graph.listDecisions({ asOf: 150 });
    expect(historical.map((item) => item.entity.sourceMemoryId)).toContain(first.id);
    expect(historical.map((item) => item.entity.sourceMemoryId)).not.toContain(second.id);

    const lineage = engine.graph.explainDecisionLineage(second.id);
    expect(lineage.map((item) => item.sourceMemoryId)).toEqual([second.id, first.id]);
  });

  it('writes graph links for decision, command, error, file, session, and skill events', async () => {
    const sessionId = 'session-graph-test';
    await engine.eventHandler.handleEvent({
      type: 'session_start',
      payload: { projectPath: tmpDir, cliType: 'codex' },
      timestamp: new Date(),
      sessionId,
      cliType: 'codex',
      projectPath: tmpDir,
    });
    await engine.eventHandler.handleEvent({
      type: 'file_opened',
      payload: { path: 'src/app.ts', content: 'export function run() { return 1; }' },
      timestamp: new Date(),
      sessionId,
      cliType: 'codex',
      projectPath: tmpDir,
    });
    await engine.eventHandler.handleEvent({
      type: 'command_executed',
      payload: { command: 'npm test', output: 'Error: failed with exit code 1' },
      timestamp: new Date(),
      sessionId,
      cliType: 'codex',
      projectPath: tmpDir,
    });
    await engine.eventHandler.handleEvent({
      type: 'error_occurred',
      payload: { error: 'TypeError: boom', context: 'src/app.ts:1' },
      timestamp: new Date(),
      sessionId,
      cliType: 'codex',
      projectPath: tmpDir,
    });
    await engine.eventHandler.handleEvent({
      type: 'decision_made',
      payload: { decision: 'Keep graph local-first', rationale: 'SQLite only' },
      timestamp: new Date(),
      sessionId,
      cliType: 'codex',
      projectPath: tmpDir,
    });

    const skill = await engine.skills.create({
      slug: 'graph-debugging',
      name: 'Graph debugging',
      description: 'Debug graph issues',
      instructions: 'Inspect graph links.',
    });
    await engine.skills.invoke('graph-debugging', { sessionId, agent: 'codex' });

    expect(engine.graph.findEntities({ kind: 'session', key: `session:${sessionId}` })).toHaveLength(1);
    expect(engine.graph.findEntities({ kind: 'agent', key: 'agent:codex' })).toHaveLength(1);
    expect(engine.graph.findEntities({ kind: 'file', key: 'file:src/app.ts' })).toHaveLength(1);
    expect(engine.graph.findEntities({ kind: 'skill', key: 'skill:graph-debugging' })).toHaveLength(1);

    const command = engine.graph.findEntities({ kind: 'task' }).find((entity) => entity.name === 'npm test');
    const error = engine.graph.findEntities({ kind: 'error' }).find((entity) => entity.name?.includes('TypeError'));
    expect(command).toBeDefined();
    expect(error).toBeDefined();
    expect(engine.graph.neighbors(error!.id).map((n) => n.entity.id)).toContain(command!.id);
    expect(engine.graph.neighbors(skill.id).map((n) => n.entity.key)).toContain(`session:${sessionId}`);
  });

  it('links indexed files and symbols into graph entities', async () => {
    writeFileSync(join(tmpDir, 'module.ts'), 'export function greet(name: string) { return `hi ${name}`; }\n', 'utf8');
    await engine.syncCodeIndexGraph();

    const file = engine.graph.findEntities({ kind: 'file', key: 'file:module.ts' })[0];
    const symbol = engine.graph.findEntities({ kind: 'symbol' }).find((entity) => entity.key.includes('module.ts#'));

    expect(file).toBeDefined();
    expect(symbol).toBeDefined();
    expect(engine.graph.neighbors(file!.id).map((n) => n.entity.id)).toContain(symbol!.id);
  });

  it('exports and imports graph data and reports health findings', () => {
    const file = engine.graph.upsertEntity({ kind: 'file', key: 'file:src/missing.ts' });
    const memory = engine.graph.upsertEntity({ kind: 'memory', key: 'memory:missing', sourceMemoryId: 'missing-memory' });
    engine.graph.upsertRelationship({ type: 'mentions', fromEntityId: memory.id, toEntityId: file.id, sourceMemoryId: 'missing-memory' });

    const graphPath = join(tmpDir, 'graph.json');
    const exported = engine.graph.exportGraph(graphPath);
    expect(exported.entityCount).toBe(2);
    expect(exported.relationshipCount).toBe(1);

    const engine2Dir = mkdtempSync(join(tmpdir(), 'cf-graph-import-'));
    const engine2 = new ContextEngine({ projectPath: engine2Dir, isEphemeral: true, autoCleanup: false, logLevel: 'error' });
    try {
      const imported = engine2.graph.importGraph(graphPath);
      expect(imported.entityCount).toBe(2);
      expect(imported.relationshipCount).toBe(1);
      expect(engine2.graph.findEntities({ kind: 'file', key: 'file:src/missing.ts' })).toHaveLength(1);
    } finally {
      engine2.close();
      rmSync(engine2Dir, { recursive: true, force: true });
    }

    const health = engine.graph.health({ memoryExists: () => false, fileExists: () => false });
    expect(health.checks.some((check) => check.name === 'graph.memory_links' && check.status === 'warn')).toBe(true);
    expect(health.checks.some((check) => check.name === 'graph.code_links' && check.status === 'warn')).toBe(true);
  });

  it('validates graph MCP schemas and exposes engine-level query surfaces', async () => {
    const { GraphQuerySchema, GraphExportSchema, GraphImportSchema } = await import('../../src/server.js');
    expect(GraphQuerySchema.safeParse({ op: 'neighbors', entityId: 'entity-1' }).success).toBe(true);
    expect(GraphQuerySchema.safeParse({ op: 'lineage', entityId: 'entity-1' }).success).toBe(true);
    expect(GraphQuerySchema.safeParse({ op: 'decisions', currentOnly: true, asOf: 123 }).success).toBe(true);
    expect(GraphQuerySchema.safeParse({ op: 'bogus' }).success).toBe(false);
    expect(GraphExportSchema.safeParse({ destPath: join(tmpDir, 'graph.json') }).success).toBe(true);
    expect(GraphImportSchema.safeParse({ srcPath: join(tmpDir, 'graph.json') }).success).toBe(true);

    const decision = await engine.store('Decision: expose graph API', 'decision', {
      layer: MemoryLayer.L2_PROJECT,
      metadata: { title: 'Expose graph API' },
    });
    const graphDecision = engine.graph.explainDecisionLineage(decision.id)[0];
    expect(graphDecision?.sourceMemoryId).toBe(decision.id);
  });

  it('includes graph health in engine health checks', async () => {
    const health = await engine.health();
    expect(health.checks.some((check) => check.name === 'graph.sqlite')).toBe(true);
  });
});
