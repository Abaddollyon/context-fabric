/**
 * v0.12 MCP integration tests — Resources & Prompts end-to-end via the
 * InMemory transport. Verifies the server speaks MCP correctly for the new
 * primitives, not just that the handlers exist.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, __resetEnginesForTests } from '../../src/server.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { resetConfigCache } from '../../src/config.js';

async function connectPair(): Promise<{ client: Client; server: Server; cleanup: () => Promise<void> }> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = await createServer();
  await server.connect(serverT);
  const client = new Client({ name: 'test', version: '0.0.0' }, {
    capabilities: { resources: {}, prompts: {}, tools: {} },
  });
  await client.connect(clientT);
  return {
    client,
    server,
    cleanup: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe('MCP Resources & Prompts (v0.12)', () => {
  let tmpDir: string;

  beforeEach(() => {
    __resetEnginesForTests();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-mcp-test-'));
    process.env.CONTEXT_FABRIC_HOME = path.join(tmpDir, '.cf');
    process.env.CONTEXT_FABRIC_DEFAULT_PROJECT = tmpDir;
    resetConfigCache();
  });

  afterEach(() => {
    __resetEnginesForTests();
    delete process.env.CONTEXT_FABRIC_HOME;
    delete process.env.CONTEXT_FABRIC_DEFAULT_PROJECT;
    resetConfigCache();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it('lists default resources including memory://skills, memory://recent, memory://conventions, memory://decisions', async () => {
    const { client, cleanup } = await connectPair();
    try {
      const res = await client.listResources();
      const uris = res.resources.map(r => r.uri);
      expect(uris).toContain('memory://skills');
      expect(uris).toContain('memory://recent');
      expect(uris).toContain('memory://conventions');
      expect(uris).toContain('memory://decisions');
    } finally {
      await cleanup();
    }
  });

  it('lists resource templates for per-skill and per-memory lookup', async () => {
    const { client, cleanup } = await connectPair();
    try {
      const res = await client.listResourceTemplates();
      const patterns = res.resourceTemplates.map(t => t.uriTemplate);
      expect(patterns).toContain('memory://skill/{slug}');
      expect(patterns).toContain('memory://memory/{id}');
    } finally {
      await cleanup();
    }
  });

  it('reads memory://skills returning a JSON body with a skills array', async () => {
    const { client, cleanup } = await connectPair();
    try {
      // Seed a skill via tools.
      await client.callTool({
        name: 'context.skill.create',
        arguments: {
          slug: 'sanity',
          name: 'Sanity Skill',
          description: 'just checking',
          instructions: 'be sensible',
          projectPath: tmpDir,
        },
      });
      const res = await client.readResource({ uri: 'memory://skills' });
      expect(res.contents).toHaveLength(1);
      const body = JSON.parse(res.contents[0].text as string);
      expect(body.count).toBe(1);
      expect(body.skills[0].slug).toBe('sanity');
    } finally {
      await cleanup();
    }
  });

  it('reads memory://skill/{slug} returning markdown', async () => {
    const { client, cleanup } = await connectPair();
    try {
      await client.callTool({
        name: 'context.skill.create',
        arguments: {
          slug: 'mdtest',
          name: 'MD Test',
          description: 'markdown render',
          instructions: 'Step 1. Step 2.',
          triggers: ['hello'],
          projectPath: tmpDir,
        },
      });
      const res = await client.readResource({ uri: 'memory://skill/mdtest' });
      expect(res.contents[0].mimeType).toBe('text/markdown');
      const text = res.contents[0].text as string;
      expect(text).toContain('# MD Test');
      expect(text).toContain('Step 1. Step 2.');
      expect(text).toContain('`hello`');
    } finally {
      await cleanup();
    }
  });

  it('returns an error for unknown resource uris', async () => {
    const { client, cleanup } = await connectPair();
    try {
      await expect(
        client.readResource({ uri: 'memory://nope/xxx' })
      ).rejects.toThrow();
    } finally {
      await cleanup();
    }
  });

  it('lists all 5 prompts and returns text for cf-orient', async () => {
    const { client, cleanup } = await connectPair();
    try {
      const list = await client.listPrompts();
      const names = list.prompts.map(p => p.name).sort();
      expect(names).toEqual(['cf-capture-decision', 'cf-invoke-skill', 'cf-orient', 'cf-review-session', 'cf-search-code']);

      const orient = await client.getPrompt({ name: 'cf-orient', arguments: {} });
      expect(orient.messages.length).toBeGreaterThan(0);
      const t = (orient.messages[0].content as { type: string; text: string }).text;
      expect(t).toMatch(/context\.orient/);
    } finally {
      await cleanup();
    }
  });

  it('interpolates arguments into cf-capture-decision', async () => {
    const { client, cleanup } = await connectPair();
    try {
      const res = await client.getPrompt({
        name: 'cf-capture-decision',
        arguments: { topic: 'auth backend' },
      });
      const t = (res.messages[0].content as { type: string; text: string }).text;
      expect(t).toContain('auth backend');
      expect(t).toContain('auth-backend'); // kebab version in the tag suggestion
    } finally {
      await cleanup();
    }
  });

  it('rejects an unknown prompt name', async () => {
    const { client, cleanup } = await connectPair();
    try {
      await expect(
        client.getPrompt({ name: 'nope', arguments: {} })
      ).rejects.toThrow();
    } finally {
      await cleanup();
    }
  });
});
