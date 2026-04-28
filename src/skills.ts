/**
 * SkillService — v0.12 procedural memory layer.
 *
 * Skills are stored as regular L2 memory rows with type='skill'. The skill's
 * instruction body lives in Memory.content and structured meta (slug, name,
 * description, triggers, parameters, version, invocationCount) in
 * metadata.skill. Slugs are globally unique per project and enforced on create.
 *
 * This module deliberately avoids adding a new table — piggybacking on L2 means
 * skills automatically benefit from backup, export/import, FTS5 search, and
 * the existing ops surface.
 */
import type { Memory, SkillMeta, SkillParameter } from './types.js';
import type { ProjectMemoryLayer } from './layers/project.js';
import type { FabricGraphService } from './fabric-graph.js';

export interface CreateSkillInput {
  slug: string;
  name: string;
  description: string;
  instructions: string;
  triggers?: string[];
  parameters?: SkillParameter[];
  tags?: string[];
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  instructions?: string;
  triggers?: string[];
  parameters?: SkillParameter[];
}

export interface SkillListItem {
  slug: string;
  name: string;
  description: string;
  version: number;
  invocationCount: number;
  lastInvokedAt: number | null;
  triggers: string[];
  id: string;
}

export interface InvokeResult {
  slug: string;
  name: string;
  description: string;
  instructions: string;
  parameters: SkillParameter[];
  version: number;
  invocationCount: number;
  lastInvokedAt: number;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function validateSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) {
    throw new Error(
      `Invalid skill slug "${slug}". Must be lowercase kebab-case, 1–64 chars, ` +
      `start with [a-z0-9], only contain [a-z0-9-].`,
    );
  }
}

export class SkillService {
  constructor(
    private readonly l2: ProjectMemoryLayer,
    private readonly graph?: FabricGraphService,
  ) {}

  /** Create a new skill. Throws if slug already exists. */
  async create(input: CreateSkillInput): Promise<Memory> {
    validateSlug(input.slug);
    const existing = await this.getBySlug(input.slug);
    if (existing) {
      throw new Error(`Skill with slug "${input.slug}" already exists`);
    }

    const skill: SkillMeta = {
      slug: input.slug,
      name: input.name,
      description: input.description,
      triggers: input.triggers ?? [],
      parameters: input.parameters ?? [],
      version: 1,
      invocationCount: 0,
    };

    const tags = Array.from(new Set([
      'skill',
      `skill:${input.slug}`,
      ...(input.tags ?? []),
    ]));

    const memory = await this.l2.store(
      input.instructions,
      'skill',
      {
        title: input.name,
        tags,
        skill,
        confidence: 1.0,
        source: 'user_explicit',
        cliType: 'generic',
      },
      tags,
      true, // pinned — skills are procedural knowledge, exempt from decay
    );
    this.projectSkillToGraph(memory);
    return memory;
  }

  /** Look up a skill by slug. Returns null if not found. */
  async getBySlug(slug: string): Promise<Memory | null> {
    const hits = await this.l2.findByTags([`skill:${slug}`]);
    for (const m of hits) {
      if (m.type === 'skill' && m.metadata?.skill?.slug === slug) {
        return m;
      }
    }
    return null;
  }

  /** List all skills with their display/operational fields. */
  async list(): Promise<SkillListItem[]> {
    const rows = await this.l2.findByType('skill');
    const items: SkillListItem[] = [];
    for (const m of rows) {
      const sk = m.metadata?.skill;
      if (!sk) continue;
      items.push({
        id: m.id,
        slug: sk.slug,
        name: sk.name,
        description: sk.description,
        version: sk.version ?? 1,
        invocationCount: sk.invocationCount ?? 0,
        lastInvokedAt: sk.lastInvokedAt ?? null,
        triggers: sk.triggers ?? [],
      });
    }
    // Stable ordering: most recently invoked first, then alphabetical.
    items.sort((a, b) => {
      const at = a.lastInvokedAt ?? 0;
      const bt = b.lastInvokedAt ?? 0;
      if (at !== bt) return bt - at;
      return a.slug.localeCompare(b.slug);
    });
    return items;
  }

  /**
   * Mark a skill as invoked and return its instruction payload. Bumps
   * invocationCount and stamps lastInvokedAt so `list()` can surface
   * frequently-used skills first.
   */
  async invoke(slug: string, context: { sessionId?: string; agent?: string } = {}): Promise<InvokeResult> {
    const mem = await this.getBySlug(slug);
    if (!mem) throw new Error(`Skill not found: ${slug}`);
    const sk = mem.metadata!.skill!;
    const updatedSkill: SkillMeta = {
      ...sk,
      invocationCount: (sk.invocationCount ?? 0) + 1,
      lastInvokedAt: Date.now(),
    };
    await this.l2.update(mem.id, {
      metadata: { ...mem.metadata!, skill: updatedSkill },
    });
    this.projectSkillInvocationToGraph(mem, updatedSkill, context);
    return {
      slug: updatedSkill.slug,
      name: updatedSkill.name,
      description: updatedSkill.description,
      instructions: mem.content,
      parameters: updatedSkill.parameters ?? [],
      version: updatedSkill.version ?? 1,
      invocationCount: updatedSkill.invocationCount ?? 1,
      lastInvokedAt: updatedSkill.lastInvokedAt!,
    };
  }

  /** Update a skill. Bumps version when instructions/name/description change. */
  async update(slug: string, updates: UpdateSkillInput): Promise<Memory> {
    const mem = await this.getBySlug(slug);
    if (!mem) throw new Error(`Skill not found: ${slug}`);
    const sk = mem.metadata!.skill!;

    const nextInstructions = updates.instructions ?? mem.content;
    const instructionsChanged = updates.instructions !== undefined && updates.instructions !== mem.content;
    const nameChanged = updates.name !== undefined && updates.name !== sk.name;
    const descChanged = updates.description !== undefined && updates.description !== sk.description;
    const bump = instructionsChanged || nameChanged || descChanged;

    const nextSkill: SkillMeta = {
      ...sk,
      name: updates.name ?? sk.name,
      description: updates.description ?? sk.description,
      triggers: updates.triggers ?? sk.triggers,
      parameters: updates.parameters ?? sk.parameters,
      version: bump ? (sk.version ?? 1) + 1 : (sk.version ?? 1),
    };

    const updated = await this.l2.update(mem.id, {
      content: nextInstructions,
      metadata: {
        ...mem.metadata!,
        skill: nextSkill,
        title: nextSkill.name,
      },
    });
    this.projectSkillToGraph(updated);
    return updated;
  }

  /** Delete a skill by slug. Returns true if something was removed. */
  async deleteBySlug(slug: string): Promise<boolean> {
    const mem = await this.getBySlug(slug);
    if (!mem) return false;
    return this.l2.delete(mem.id);
  }

  private projectSkillToGraph(mem: Memory): void {
    if (!this.graph || !mem.metadata?.skill) return;
    const skill = mem.metadata.skill;
    const skillEntity = this.graph.upsertEntity({
      kind: 'skill',
      key: `skill:${skill.slug}`,
      name: skill.name,
      sourceMemoryId: mem.id,
      metadata: { description: skill.description, version: skill.version ?? 1 },
    });
    const memoryEntity = this.graph.upsertEntity({
      kind: 'memory',
      key: `memory:${mem.id}`,
      name: skill.name,
      sourceMemoryId: mem.id,
      metadata: { type: 'skill' },
    });
    this.graph.upsertRelationship({ type: 'recorded_as', fromEntityId: skillEntity.id, toEntityId: memoryEntity.id, sourceMemoryId: mem.id });
  }

  private projectSkillInvocationToGraph(mem: Memory, skill: SkillMeta, context: { sessionId?: string; agent?: string }): void {
    if (!this.graph) return;
    const skillEntity = this.graph.upsertEntity({
      kind: 'skill',
      key: `skill:${skill.slug}`,
      name: skill.name,
      sourceMemoryId: mem.id,
      metadata: { description: skill.description, version: skill.version ?? 1, invocationCount: skill.invocationCount ?? 0 },
    });
    if (context.sessionId) {
      const session = this.graph.upsertEntity({ kind: 'session', key: `session:${context.sessionId}`, name: context.sessionId, metadata: { sessionId: context.sessionId } });
      this.graph.upsertRelationship({ type: 'invoked_in', fromEntityId: skillEntity.id, toEntityId: session.id, sourceMemoryId: mem.id });
    }
    if (context.agent) {
      const agent = this.graph.upsertEntity({ kind: 'agent', key: `agent:${context.agent}`, name: context.agent, metadata: { cliType: context.agent } });
      this.graph.upsertRelationship({ type: 'invoked_by', fromEntityId: skillEntity.id, toEntityId: agent.id, sourceMemoryId: mem.id });
    }
  }
}
