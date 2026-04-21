/**
 * v0.12 importDocs — seeds project memory from onboarding docs.
 * Tests cover discovery defaults, dryRun, truncation, and idempotency.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, __resetEnginesForTests } from '../../src/server.js';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { resetConfigCache } from '../../src/config.js';

async function connectPair() {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = await createServer();
  await server.connect(serverT);
  const client = new Client({ name: 'test', version: '0.0.0' }, {
    capabilities: { resources: {}, prompts: {}, tools: {} },
  });
  await client.connect(clientT);
  return { client, cleanup: async () => { await client.close(); await server.close(); } };
}

function parseToolResult<T = unknown>(res: { content: Array<{ text: string }> }): T {
  return JSON.parse(res.content[0].text);
}

describe('context.importDocs (v0.12)', () => {
  let tmpDir: string;
  const prevCwd = process.cwd();

  beforeEach(() => {
    __resetEnginesForTests();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-docs-test-'));
    process.chdir(tmpDir);
    process.env.CONTEXT_FABRIC_HOME = path.join(tmpDir, '.cf');
    process.env.CONTEXT_FABRIC_DEFAULT_PROJECT = tmpDir;
    resetConfigCache();
  });

  afterEach(() => {
    __resetEnginesForTests();
    process.chdir(prevCwd);
    delete process.env.CONTEXT_FABRIC_HOME;
    delete process.env.CONTEXT_FABRIC_DEFAULT_PROJECT;
    resetConfigCache();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('discovers README.md and CLAUDE.md at project root', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Project\nhello');
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# Agent notes\nbe nice');

    const { client, cleanup } = await connectPair();
    try {
      const raw = await client.callTool({
        name: 'context.importDocs',
        arguments: { projectPath: tmpDir },
      });
      const res = parseToolResult<{ summary: { stored: number; total: number } }>(raw as any);
      expect(res.summary.stored).toBe(2);
      expect(res.summary.total).toBeGreaterThanOrEqual(2);
    } finally {
      await cleanup();
    }
  });

  it('dryRun lists files without storing', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'hi');
    const { client, cleanup } = await connectPair();
    try {
      const raw = await client.callTool({
        name: 'context.importDocs',
        arguments: { projectPath: tmpDir, dryRun: true },
      });
      const res = parseToolResult<{ summary: { stored: number }; imported: Array<{ status: string }> }>(raw as any);
      expect(res.summary.stored).toBe(0);
      expect(res.imported.some(i => i.status === 'would-import')).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('is idempotent — running twice does not duplicate', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'stable content');
    const { client, cleanup } = await connectPair();
    try {
      const first = parseToolResult<{ summary: { stored: number } }>(
        (await client.callTool({ name: 'context.importDocs', arguments: { projectPath: tmpDir } })) as any,
      );
      expect(first.summary.stored).toBe(1);

      const second = parseToolResult<{ summary: { stored: number; skipped: number } }>(
        (await client.callTool({ name: 'context.importDocs', arguments: { projectPath: tmpDir } })) as any,
      );
      expect(second.summary.stored).toBe(0);
      expect(second.summary.skipped).toBeGreaterThanOrEqual(1);
    } finally {
      await cleanup();
    }
  });

  it('truncates files longer than maxChars', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'x'.repeat(2000));
    const { client, cleanup } = await connectPair();
    try {
      const raw = await client.callTool({
        name: 'context.importDocs',
        arguments: { projectPath: tmpDir, maxChars: 500 },
      });
      const res = parseToolResult<{ summary: { truncated: number } }>(raw as any);
      expect(res.summary.truncated).toBe(1);
    } finally {
      await cleanup();
    }
  });

  it('accepts an explicit file list', async () => {
    fs.writeFileSync(path.join(tmpDir, 'notes.md'), '# custom');
    const { client, cleanup } = await connectPair();
    try {
      const raw = await client.callTool({
        name: 'context.importDocs',
        arguments: { projectPath: tmpDir, files: ['notes.md'] },
      });
      const res = parseToolResult<{ imported: Array<{ file: string; status: string }> }>(raw as any);
      expect(res.imported).toHaveLength(1);
      expect(res.imported[0].file).toBe('notes.md');
      expect(res.imported[0].status).toBe('stored');
    } finally {
      await cleanup();
    }
  });

  it('marks missing files as skipped-missing', async () => {
    const { client, cleanup } = await connectPair();
    try {
      const raw = await client.callTool({
        name: 'context.importDocs',
        arguments: { projectPath: tmpDir, files: ['DOES_NOT_EXIST.md'] },
      });
      const res = parseToolResult<{ imported: Array<{ status: string }> }>(raw as any);
      expect(res.imported[0].status).toBe('skipped-missing');
    } finally {
      await cleanup();
    }
  });
});
