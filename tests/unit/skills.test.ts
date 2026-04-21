/**
 * v0.12 Skills layer — procedural memory tests.
 *
 * Covers create/list/get/invoke over SkillService, slug uniqueness, invocation
 * counter bumps, and round-trip through the L2 memory table.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../utils.js';

describe('Skills layer (v0.12)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('creates a skill and makes it retrievable by slug', async () => {
    const created = await ctx.engine.skills.create({
      slug: 'commit-message',
      name: 'Write a commit message',
      description: 'Draft a conventional-commits message from a diff.',
      instructions: 'Given a diff, output a type(scope): subject line...',
    });

    expect(created.id).toBeTruthy();
    expect(created.metadata?.skill?.slug).toBe('commit-message');
    expect(created.type).toBe('skill');

    const got = await ctx.engine.skills.getBySlug('commit-message');
    expect(got?.id).toBe(created.id);
    expect(got?.metadata?.skill?.name).toBe('Write a commit message');
  });

  it('rejects duplicate slug', async () => {
    await ctx.engine.skills.create({
      slug: 'dup',
      name: 'Dup 1',
      description: 'first',
      instructions: 'body',
    });
    await expect(
      ctx.engine.skills.create({
        slug: 'dup',
        name: 'Dup 2',
        description: 'second',
        instructions: 'body',
      }),
    ).rejects.toThrow(/already exists/i);
  });

  it('lists skills with slug, name, description projection', async () => {
    await ctx.engine.skills.create({
      slug: 'a',
      name: 'Alpha',
      description: 'first skill',
      instructions: 'do a',
    });
    await ctx.engine.skills.create({
      slug: 'b',
      name: 'Beta',
      description: 'second skill',
      instructions: 'do b',
    });

    const list = await ctx.engine.skills.list();
    expect(list.length).toBe(2);
    const slugs = list.map(s => s.slug).sort();
    expect(slugs).toEqual(['a', 'b']);
    for (const s of list) {
      expect(s.name).toBeTruthy();
      expect(s.description).toBeTruthy();
    }
  });

  it('invoke() returns instructions and bumps invocationCount', async () => {
    await ctx.engine.skills.create({
      slug: 'greet',
      name: 'Greet',
      description: 'say hi',
      instructions: 'Say hello warmly.',
    });

    const first = await ctx.engine.skills.invoke('greet');
    expect(first.instructions).toBe('Say hello warmly.');
    expect(first.invocationCount).toBe(1);

    const second = await ctx.engine.skills.invoke('greet');
    expect(second.invocationCount).toBe(2);
    expect(second.lastInvokedAt).toBeGreaterThan(0);
  });

  it('invoke on missing slug throws', async () => {
    await expect(ctx.engine.skills.invoke('does-not-exist')).rejects.toThrow(/not found/i);
  });

  it('skills persist triggers and parameters', async () => {
    await ctx.engine.skills.create({
      slug: 'pr-review',
      name: 'Review PR',
      description: 'Summarize a pull request diff.',
      instructions: 'Given a diff and title...',
      triggers: ['review pr', 'analyze pull request'],
      parameters: [
        { name: 'diff', description: 'Unified diff', required: true },
        { name: 'title', description: 'PR title', required: false },
      ],
    });

    const got = await ctx.engine.skills.getBySlug('pr-review');
    expect(got?.metadata?.skill?.triggers).toEqual(['review pr', 'analyze pull request']);
    expect(got?.metadata?.skill?.parameters).toHaveLength(2);
    expect(got?.metadata?.skill?.parameters?.[0].required).toBe(true);
  });

  it('updating a skill bumps version if instructions change', async () => {
    const s = await ctx.engine.skills.create({
      slug: 'vt',
      name: 'Versioned',
      description: 'desc',
      instructions: 'v1',
    });
    expect(s.metadata?.skill?.version).toBe(1);

    const updated = await ctx.engine.skills.update('vt', { instructions: 'v2' });
    expect(updated.metadata?.skill?.version).toBe(2);
    expect(updated.content).toBe('v2');
  });

  it('delete removes a skill by slug', async () => {
    await ctx.engine.skills.create({
      slug: 'tmp',
      name: 'Temp',
      description: 'temp',
      instructions: 'ephemeral',
    });
    const deleted = await ctx.engine.skills.deleteBySlug('tmp');
    expect(deleted).toBe(true);
    const list = await ctx.engine.skills.list();
    expect(list).toHaveLength(0);
  });
});
