import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type FabricEntityKind =
  | 'user'
  | 'workspace'
  | 'project'
  | 'branch'
  | 'session'
  | 'agent'
  | 'file'
  | 'symbol'
  | 'task'
  | 'memory'
  | 'decision'
  | 'error'
  | 'skill';

export interface FabricEntity {
  id: string;
  kind: FabricEntityKind;
  key: string;
  name?: string;
  projectPath: string;
  sourceMemoryId?: string;
  metadata: Record<string, unknown>;
  validFrom: number;
  validUntil: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface FabricRelationship {
  id: string;
  type: string;
  fromEntityId: string;
  toEntityId: string;
  projectPath: string;
  sourceMemoryId?: string;
  provenance: Record<string, unknown>;
  validFrom: number;
  validUntil: number | null;
  replacedById: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertEntityInput {
  kind: FabricEntityKind;
  key: string;
  name?: string;
  sourceMemoryId?: string;
  metadata?: Record<string, unknown>;
  validFrom?: number;
  validUntil?: number | null;
}

export interface UpsertRelationshipInput {
  type: string;
  fromEntityId: string;
  toEntityId: string;
  sourceMemoryId?: string;
  provenance?: Record<string, unknown>;
  validFrom?: number;
  validUntil?: number | null;
}

export interface NeighborOptions {
  direction?: 'out' | 'in' | 'both';
  type?: string;
  asOf?: number;
}

export interface GraphHealthCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  detail?: string;
}

interface EntityRow {
  id: string;
  kind: FabricEntityKind;
  entity_key: string;
  name: string | null;
  project_path: string;
  source_memory_id: string | null;
  metadata: string | null;
  valid_from: number;
  valid_until: number | null;
  created_at: number;
  updated_at: number;
}

interface RelationshipRow {
  id: string;
  type: string;
  from_entity_id: string;
  to_entity_id: string;
  project_path: string;
  source_memory_id: string | null;
  provenance: string | null;
  valid_from: number;
  valid_until: number | null;
  replaced_by_id: string | null;
  created_at: number;
  updated_at: number;
}

const ENTITY_KINDS = new Set<FabricEntityKind>([
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
]);

export class FabricGraphService {
  private db: DatabaseSync;
  private projectPath: string;
  private stmtGetEntity!: StatementSync;
  private stmtGetEntityById!: StatementSync;
  private stmtInsertEntity!: StatementSync;
  private stmtUpdateEntity!: StatementSync;
  private stmtFindEntities!: StatementSync;
  private stmtFindEntitiesByKind!: StatementSync;
  private stmtFindEntitiesBySourceMemory!: StatementSync;
  private stmtGetRelationship!: StatementSync;
  private stmtGetRelationshipById!: StatementSync;
  private stmtInsertRelationship!: StatementSync;
  private stmtUpdateRelationship!: StatementSync;
  private stmtFindRelationships!: StatementSync;
  private stmtInvalidateRelationship!: StatementSync;
  private stmtSetRelationshipReplacement!: StatementSync;
  private stmtBackdateEntityValidFrom!: StatementSync;
  private stmtAllEntities!: StatementSync;
  private stmtAllRelationships!: StatementSync;

  constructor(options: { projectPath: string; baseDir?: string; isEphemeral?: boolean }) {
    this.projectPath = options.projectPath;
    if (options.isEphemeral) {
      this.db = new DatabaseSync(':memory:');
    } else {
      const dbDir = options.baseDir ?? join(this.projectPath, '.context-fabric');
      mkdirSync(dbDir, { recursive: true });
      this.db = new DatabaseSync(join(dbDir, 'fabric-graph.db'));
    }
    this.initSchema();
    this.prepareStatements();
  }

  upsertEntity(input: UpsertEntityInput): FabricEntity {
    this.assertEntityKind(input.kind);
    const now = Date.now();
    const existing = this.stmtGetEntity.get(input.kind, input.key, this.projectPath) as EntityRow | undefined;
    if (existing) {
      const metadata = { ...this.parseJson(existing.metadata), ...(input.metadata ?? {}) };
      this.stmtUpdateEntity.run(
        input.name ?? existing.name,
        input.sourceMemoryId ?? existing.source_memory_id,
        JSON.stringify(metadata),
        input.validFrom ?? existing.valid_from,
        input.validUntil === undefined ? existing.valid_until : input.validUntil,
        now,
        existing.id,
      );
      return this.getEntity(existing.id)!;
    }

    const id = randomUUID();
    this.stmtInsertEntity.run(
      id,
      input.kind,
      input.key,
      input.name ?? null,
      this.projectPath,
      input.sourceMemoryId ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.validFrom ?? now,
      input.validUntil ?? null,
      now,
      now,
    );
    return this.getEntity(id)!;
  }

  getEntity(id: string): FabricEntity | null {
    const row = this.stmtGetEntityById.get(id) as EntityRow | undefined;
    return row ? this.rowToEntity(row) : null;
  }

  findEntities(filter: { kind?: FabricEntityKind; key?: string; sourceMemoryId?: string } = {}): FabricEntity[] {
    if (filter.kind) this.assertEntityKind(filter.kind);
    if (filter.sourceMemoryId) {
      return (this.stmtFindEntitiesBySourceMemory.all(filter.sourceMemoryId, this.projectPath) as unknown as EntityRow[])
        .map((row) => this.rowToEntity(row))
        .filter((entity) => (!filter.kind || entity.kind === filter.kind) && (!filter.key || entity.key === filter.key));
    }
    if (filter.kind && filter.key) {
      const row = this.stmtGetEntity.get(filter.kind, filter.key, this.projectPath) as EntityRow | undefined;
      return row ? [this.rowToEntity(row)] : [];
    }
    if (filter.kind) {
      return (this.stmtFindEntitiesByKind.all(filter.kind, this.projectPath) as unknown as EntityRow[]).map((row) => this.rowToEntity(row));
    }
    return (this.stmtFindEntities.all(this.projectPath) as unknown as EntityRow[]).map((row) => this.rowToEntity(row));
  }

  upsertRelationship(input: UpsertRelationshipInput): FabricRelationship {
    const now = Date.now();
    const validFrom = input.validFrom ?? now;
    const existing = this.stmtGetRelationship.get(
      input.type,
      input.fromEntityId,
      input.toEntityId,
      input.sourceMemoryId ?? null,
      validFrom,
      this.projectPath,
    ) as RelationshipRow | undefined;

    if (existing) {
      const provenance = { ...this.parseJson(existing.provenance), ...(input.provenance ?? {}) };
      this.stmtUpdateRelationship.run(
        input.sourceMemoryId ?? existing.source_memory_id,
        JSON.stringify(provenance),
        input.validUntil === undefined ? existing.valid_until : input.validUntil,
        now,
        existing.id,
      );
      return this.getRelationship(existing.id)!;
    }

    const id = randomUUID();
    this.backdateRelationshipEndpoints(input.fromEntityId, input.toEntityId, validFrom, now);
    this.stmtInsertRelationship.run(
      id,
      input.type,
      input.fromEntityId,
      input.toEntityId,
      this.projectPath,
      input.sourceMemoryId ?? null,
      JSON.stringify(input.provenance ?? {}),
      validFrom,
      input.validUntil ?? null,
      null,
      now,
      now,
    );
    return this.getRelationship(id)!;
  }

  getRelationship(id: string): FabricRelationship | null {
    const row = this.stmtGetRelationshipById.get(id) as RelationshipRow | undefined;
    return row ? this.rowToRelationship(row) : null;
  }

  invalidateRelationship(relationshipId: string, at = Date.now()): boolean {
    const result = this.stmtInvalidateRelationship.run(at, Date.now(), relationshipId);
    return result.changes > 0;
  }

  supersedeRelationship(input: {
    type: string;
    fromEntityId: string;
    toEntityId: string;
    supersededBy: Omit<UpsertRelationshipInput, 'type'> & { type?: string };
    at?: number;
  }): FabricRelationship {
    const at = input.at ?? Date.now();
    const oldRows = this.relationshipRows({
      type: input.type,
      fromEntityId: input.fromEntityId,
      toEntityId: input.toEntityId,
      asOf: at - 1,
    });
    const next = this.upsertRelationship({
      type: input.supersededBy.type ?? input.type,
      fromEntityId: input.supersededBy.fromEntityId,
      toEntityId: input.supersededBy.toEntityId,
      sourceMemoryId: input.supersededBy.sourceMemoryId,
      provenance: input.supersededBy.provenance,
      validFrom: input.supersededBy.validFrom ?? at,
      validUntil: input.supersededBy.validUntil,
    });
    for (const old of oldRows) {
      this.stmtInvalidateRelationship.run(at, Date.now(), old.id);
      this.stmtSetRelationshipReplacement.run(next.id, Date.now(), old.id);
    }
    return next;
  }

  neighbors(entityId: string, options: NeighborOptions = {}): Array<{ entity: FabricEntity; relationship: FabricRelationship; direction: 'out' | 'in' }> {
    const rootEntityId = this.resolveTraversalEntityId(entityId);
    const direction = options.direction ?? 'both';
    const rows = this.relationshipRows({ entityId: rootEntityId, type: options.type, asOf: options.asOf });
    const results: Array<{ entity: FabricEntity; relationship: FabricRelationship; direction: 'out' | 'in' }> = [];
    for (const row of rows) {
      const relationship = this.rowToRelationship(row);
      if ((direction === 'out' || direction === 'both') && row.from_entity_id === rootEntityId) {
        const entity = this.getEntity(row.to_entity_id);
        if (entity && this.isEntityValidAt(entity, options.asOf)) results.push({ entity, relationship, direction: 'out' });
      }
      if ((direction === 'in' || direction === 'both') && row.to_entity_id === rootEntityId) {
        const entity = this.getEntity(row.from_entity_id);
        if (entity && this.isEntityValidAt(entity, options.asOf)) results.push({ entity, relationship, direction: 'in' });
      }
    }
    results.sort((a, b) => `${a.relationship.type}:${a.entity.kind}:${a.entity.key}`.localeCompare(`${b.relationship.type}:${b.entity.kind}:${b.entity.key}`));
    return results;
  }

  timeline(entityId: string): FabricRelationship[] {
    return this.relationshipRows({ entityId }).map((row) => this.rowToRelationship(row));
  }

  findPath(fromEntityId: string, toEntityId: string, options: { maxDepth?: number; asOf?: number } = {}): FabricEntity[] {
    const maxDepth = options.maxDepth ?? 4;
    const queue: Array<{ id: string; path: string[] }> = [{ id: fromEntityId, path: [fromEntityId] }];
    const seen = new Set<string>([fromEntityId]);
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.id === toEntityId) {
        return current.path.map((id) => this.getEntity(id)).filter((entity): entity is FabricEntity => !!entity);
      }
      if (current.path.length > maxDepth) continue;
      for (const neighbor of this.neighbors(current.id, { asOf: options.asOf })) {
        if (!seen.has(neighbor.entity.id)) {
          seen.add(neighbor.entity.id);
          queue.push({ id: neighbor.entity.id, path: [...current.path, neighbor.entity.id] });
        }
      }
    }
    return [];
  }

  listCurrentDecisions(): Array<{ entity: FabricEntity; lineage: FabricEntity[] }> {
    return this.listDecisions({ currentOnly: true });
  }

  listDecisions(options: { asOf?: number; currentOnly?: boolean } = {}): Array<{ entity: FabricEntity; lineage: FabricEntity[] }> {
    const entities = this.findEntities({ kind: 'decision' })
      .filter((entity) => this.isEntityValidAt(entity, options.asOf))
      .filter((entity) => !options.currentOnly || this.isDecisionCurrent(entity));
    return entities
      .sort((a, b) => a.validFrom - b.validFrom || a.key.localeCompare(b.key))
      .map((entity) => ({ entity, lineage: this.explainDecisionLineage(entity.id) }));
  }

  explainDecisionLineage(idOrMemoryId: string): FabricEntity[] {
    const start = this.getEntity(idOrMemoryId)
      ?? this.findEntities({ kind: 'decision', sourceMemoryId: idOrMemoryId })[0]
      ?? null;
    if (!start) return [];

    const lineage: FabricEntity[] = [];
    const seen = new Set<string>();
    let current: FabricEntity | null = start;
    while (current && !seen.has(current.id)) {
      lineage.push(current);
      seen.add(current.id);
      const supersedesNeighbors: Array<{ entity: FabricEntity; relationship: FabricRelationship; direction: 'out' | 'in' }> = this.neighbors(current.id, { direction: 'out', type: 'supersedes' });
      const supersedesEntity: FabricEntity | null = supersedesNeighbors.length > 0 ? supersedesNeighbors[0]!.entity : null;
      current = supersedesEntity?.kind === 'decision' ? supersedesEntity : null;
    }
    return lineage;
  }

  exportGraph(destPath: string): { path: string; entityCount: number; relationshipCount: number; bytes: number } {
    mkdirSync(dirname(destPath), { recursive: true });
    const entities = (this.stmtAllEntities.all(this.projectPath) as unknown as EntityRow[]).map((row) => this.rowToEntity(row));
    const relationships = (this.stmtAllRelationships.all(this.projectPath) as unknown as RelationshipRow[]).map((row) => this.rowToRelationship(row));
    writeFileSync(destPath, JSON.stringify({ version: 1, projectPath: this.projectPath, entities, relationships }, null, 2), 'utf8');
    return { path: destPath, entityCount: entities.length, relationshipCount: relationships.length, bytes: statSync(destPath).size };
  }

  importGraph(srcPath: string): { entityCount: number; relationshipCount: number } {
    const payload = JSON.parse(readFileSync(srcPath, 'utf8')) as { entities?: FabricEntity[]; relationships?: FabricRelationship[] };
    let entityCount = 0;
    let relationshipCount = 0;
    this.db.exec('BEGIN');
    try {
      for (const entity of payload.entities ?? []) {
        this.assertEntityKind(entity.kind);
        this.stmtInsertEntity.run(
          entity.id,
          entity.kind,
          entity.key,
          entity.name ?? null,
          this.projectPath,
          entity.sourceMemoryId ?? null,
          JSON.stringify(entity.metadata ?? {}),
          entity.validFrom,
          entity.validUntil ?? null,
          entity.createdAt,
          entity.updatedAt,
        );
        entityCount++;
      }
      for (const relationship of payload.relationships ?? []) {
        this.stmtInsertRelationship.run(
          relationship.id,
          relationship.type,
          relationship.fromEntityId,
          relationship.toEntityId,
          this.projectPath,
          relationship.sourceMemoryId ?? null,
          JSON.stringify(relationship.provenance ?? {}),
          relationship.validFrom,
          relationship.validUntil ?? null,
          relationship.replacedById ?? null,
          relationship.createdAt,
          relationship.updatedAt,
        );
        relationshipCount++;
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return { entityCount, relationshipCount };
  }

  health(options: { memoryExists?: (id: string) => boolean; fileExists?: (path: string) => boolean } = {}): { status: 'ok' | 'degraded'; checks: GraphHealthCheck[] } {
    const checks: GraphHealthCheck[] = [];
    try {
      this.db.prepare('SELECT 1').get();
      checks.push({ name: 'graph.sqlite', status: 'pass' });
    } catch (err) {
      checks.push({ name: 'graph.sqlite', status: 'fail', detail: (err as Error).message });
    }

    const invalid = (this.db.prepare('SELECT COUNT(*) as count FROM fabric_relationships WHERE valid_until IS NOT NULL AND valid_until < valid_from').get() as { count: number }).count;
    checks.push({ name: 'graph.validity_windows', status: invalid > 0 ? 'fail' : 'pass', detail: invalid > 0 ? `${invalid} invalid windows` : undefined });

    const orphans = (this.db.prepare(`
      SELECT COUNT(*) as count
      FROM fabric_relationships r
      LEFT JOIN fabric_entities f ON f.id = r.from_entity_id
      LEFT JOIN fabric_entities t ON t.id = r.to_entity_id
      WHERE f.id IS NULL OR t.id IS NULL
    `).get() as { count: number }).count;
    checks.push({ name: 'graph.orphaned_relationships', status: orphans > 0 ? 'fail' : 'pass', detail: orphans > 0 ? `${orphans} orphaned relationships` : undefined });

    if (options.memoryExists) {
      const memoryIds = new Set<string>();
      for (const entity of this.findEntities()) if (entity.sourceMemoryId) memoryIds.add(entity.sourceMemoryId);
      for (const relationship of (this.stmtAllRelationships.all(this.projectPath) as unknown as RelationshipRow[]).map((row) => this.rowToRelationship(row))) {
        if (relationship.sourceMemoryId) memoryIds.add(relationship.sourceMemoryId);
      }
      const missing = [...memoryIds].filter((id) => !options.memoryExists!(id)).length;
      checks.push({ name: 'graph.memory_links', status: missing > 0 ? 'warn' : 'pass', detail: missing > 0 ? `${missing} missing memory links` : undefined });
    }

    if (options.fileExists) {
      const files = this.findEntities({ kind: 'file' });
      const missing = files.filter((entity) => !options.fileExists!(entity.key.replace(/^file:/, ''))).length;
      checks.push({ name: 'graph.code_links', status: missing > 0 ? 'warn' : 'pass', detail: missing > 0 ? `${missing} missing file links` : undefined });
    }

    const status = checks.some((check) => check.status === 'fail') ? 'degraded' : 'ok';
    return { status, checks };
  }

  close(): void {
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
    try { this.db.close(); } catch { /* ignore */ }
  }

  private initSchema(): void {
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS fabric_entities (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        name TEXT,
        project_path TEXT NOT NULL,
        source_memory_id TEXT,
        metadata TEXT,
        valid_from INTEGER NOT NULL,
        valid_until INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(project_path, kind, entity_key)
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS fabric_relationships (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        from_entity_id TEXT NOT NULL REFERENCES fabric_entities(id) ON DELETE CASCADE,
        to_entity_id TEXT NOT NULL REFERENCES fabric_entities(id) ON DELETE CASCADE,
        project_path TEXT NOT NULL,
        source_memory_id TEXT,
        provenance TEXT,
        valid_from INTEGER NOT NULL,
        valid_until INTEGER,
        replaced_by_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_fabric_entities_kind_key ON fabric_entities(project_path, kind, entity_key)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_fabric_entities_source_memory ON fabric_entities(source_memory_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_fabric_relationships_from ON fabric_relationships(from_entity_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_fabric_relationships_to ON fabric_relationships(to_entity_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_fabric_relationships_type ON fabric_relationships(project_path, type)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_fabric_relationships_source_memory ON fabric_relationships(source_memory_id)');
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_fabric_relationships_unique ON fabric_relationships(project_path, type, from_entity_id, to_entity_id, COALESCE(source_memory_id, \'\'), valid_from)');
  }

  private prepareStatements(): void {
    this.stmtGetEntity = this.db.prepare('SELECT * FROM fabric_entities WHERE kind = ? AND entity_key = ? AND project_path = ?');
    this.stmtGetEntityById = this.db.prepare('SELECT * FROM fabric_entities WHERE id = ?');
    this.stmtInsertEntity = this.db.prepare(`
      INSERT INTO fabric_entities (id, kind, entity_key, name, project_path, source_memory_id, metadata, valid_from, valid_until, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.stmtUpdateEntity = this.db.prepare(`
      UPDATE fabric_entities SET name = ?, source_memory_id = ?, metadata = ?, valid_from = ?, valid_until = ?, updated_at = ? WHERE id = ?
    `);
    this.stmtFindEntities = this.db.prepare('SELECT * FROM fabric_entities WHERE project_path = ? ORDER BY kind, entity_key');
    this.stmtFindEntitiesByKind = this.db.prepare('SELECT * FROM fabric_entities WHERE kind = ? AND project_path = ? ORDER BY entity_key');
    this.stmtFindEntitiesBySourceMemory = this.db.prepare('SELECT * FROM fabric_entities WHERE source_memory_id = ? AND project_path = ? ORDER BY kind, entity_key');
    this.stmtGetRelationship = this.db.prepare(`
      SELECT * FROM fabric_relationships
      WHERE type = ? AND from_entity_id = ? AND to_entity_id = ? AND COALESCE(source_memory_id, '') = COALESCE(?, '') AND valid_from = ? AND project_path = ?
    `);
    this.stmtGetRelationshipById = this.db.prepare('SELECT * FROM fabric_relationships WHERE id = ?');
    this.stmtInsertRelationship = this.db.prepare(`
      INSERT INTO fabric_relationships (id, type, from_entity_id, to_entity_id, project_path, source_memory_id, provenance, valid_from, valid_until, replaced_by_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.stmtUpdateRelationship = this.db.prepare('UPDATE fabric_relationships SET source_memory_id = ?, provenance = ?, valid_until = ?, updated_at = ? WHERE id = ?');
    this.stmtFindRelationships = this.db.prepare('SELECT * FROM fabric_relationships WHERE project_path = ? ORDER BY valid_from ASC, type ASC');
    this.stmtInvalidateRelationship = this.db.prepare('UPDATE fabric_relationships SET valid_until = ?, updated_at = ? WHERE id = ?');
    this.stmtSetRelationshipReplacement = this.db.prepare('UPDATE fabric_relationships SET replaced_by_id = ?, updated_at = ? WHERE id = ?');
    this.stmtBackdateEntityValidFrom = this.db.prepare('UPDATE fabric_entities SET valid_from = ?, updated_at = ? WHERE id = ? AND valid_from > ?');
    this.stmtAllEntities = this.db.prepare('SELECT * FROM fabric_entities WHERE project_path = ? ORDER BY kind, entity_key');
    this.stmtAllRelationships = this.db.prepare('SELECT * FROM fabric_relationships WHERE project_path = ? ORDER BY valid_from, type');
  }

  private resolveTraversalEntityId(entityId: string): string {
    const entity = this.getEntity(entityId) ?? this.findPreferredSourceEntity(entityId);
    if (!entity) return entityId;
    const directRows = this.relationshipRows({ entityId: entity.id });
    if (directRows.length > 0) return entity.id;

    return this.findPreferredSourceEntity(entity.sourceMemoryId)?.id ?? entity.id;
  }

  private findPreferredSourceEntity(sourceMemoryId: string | undefined): FabricEntity | null {
    if (!sourceMemoryId) return null;
    const bySource = this.findEntities({ sourceMemoryId });
    return bySource
      .sort((a, b) => {
        const priority: Record<string, number> = { decision: 1, error: 1, skill: 1, memory: 9 };
        return (priority[a.kind] ?? 5) - (priority[b.kind] ?? 5);
      })[0] ?? null;
  }

  private backdateRelationshipEndpoints(fromEntityId: string, toEntityId: string, validFrom: number, now: number): void {
    this.stmtBackdateEntityValidFrom.run(validFrom, now, fromEntityId, validFrom);
    this.stmtBackdateEntityValidFrom.run(validFrom, now, toEntityId, validFrom);
  }

  private relationshipRows(filter: { entityId?: string; type?: string; asOf?: number; fromEntityId?: string; toEntityId?: string } = {}): RelationshipRow[] {
    const rows = (this.stmtFindRelationships.all(this.projectPath) as unknown as RelationshipRow[]).filter((row) => {
      if (filter.entityId && row.from_entity_id !== filter.entityId && row.to_entity_id !== filter.entityId) return false;
      if (filter.fromEntityId && row.from_entity_id !== filter.fromEntityId) return false;
      if (filter.toEntityId && row.to_entity_id !== filter.toEntityId) return false;
      if (filter.type && row.type !== filter.type) return false;
      if (!this.isRelationshipValidAt(row, filter.asOf)) return false;
      return true;
    });
    return rows;
  }

  private isRelationshipValidAt(row: RelationshipRow, asOf?: number): boolean {
    if (asOf === undefined) return row.valid_until === null;
    return row.valid_from <= asOf && (row.valid_until === null || row.valid_until > asOf);
  }

  private isEntityValidAt(entity: FabricEntity, asOf?: number): boolean {
    if (asOf === undefined) return entity.validUntil === null;
    return entity.validFrom <= asOf && (entity.validUntil === null || entity.validUntil > asOf);
  }

  private isDecisionCurrent(entity: FabricEntity): boolean {
    if (entity.validUntil !== null) return false;
    const inbound = this.neighbors(entity.id, { direction: 'in', type: 'supersedes' });
    return inbound.length === 0;
  }

  private rowToEntity(row: EntityRow): FabricEntity {
    return {
      id: row.id,
      kind: row.kind,
      key: row.entity_key,
      name: row.name ?? undefined,
      projectPath: row.project_path,
      sourceMemoryId: row.source_memory_id ?? undefined,
      metadata: this.parseJson(row.metadata),
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToRelationship(row: RelationshipRow): FabricRelationship {
    return {
      id: row.id,
      type: row.type,
      fromEntityId: row.from_entity_id,
      toEntityId: row.to_entity_id,
      projectPath: row.project_path,
      sourceMemoryId: row.source_memory_id ?? undefined,
      provenance: this.parseJson(row.provenance),
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      replacedById: row.replaced_by_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private parseJson(value: string | null): Record<string, unknown> {
    if (!value) return {};
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private assertEntityKind(kind: string): asserts kind is FabricEntityKind {
    if (!ENTITY_KINDS.has(kind as FabricEntityKind)) {
      throw new Error(`Unsupported fabric entity kind: ${kind}`);
    }
  }
}

export default FabricGraphService;
