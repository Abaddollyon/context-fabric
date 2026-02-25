/**
 * Unit tests for Setup module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { setupForCLI, previewConfig, detectServerPath } from '../../src/setup.js';
import type { SupportedCLI } from '../../src/setup.js';
import { createTempDir, removeDir } from '../utils.js';

describe('Setup Module', () => {
  // ==========================================================================
  // detectServerPath
  // ==========================================================================

  describe('detectServerPath', () => {
    it('should return a string', () => {
      const p = detectServerPath();
      expect(typeof p).toBe('string');
      expect(p.length).toBeGreaterThan(0);
    });

    it('should return an absolute path', () => {
      const p = detectServerPath();
      expect(path.isAbsolute(p)).toBe(true);
    });
  });

  // ==========================================================================
  // previewConfig
  // ==========================================================================

  describe('previewConfig', () => {
    const serverPath = '/test/dist/server.js';

    it('should return JSON for opencode', () => {
      const snippet = previewConfig('opencode', serverPath);
      const parsed = JSON.parse(snippet);
      expect(parsed['context-fabric']).toBeDefined();
      expect(parsed['context-fabric'].type).toBe('local');
      expect(parsed['context-fabric'].command).toEqual(['node', serverPath]);
      expect(parsed['context-fabric'].enabled).toBe(true);
    });

    it('should return JSON for claude-code', () => {
      const snippet = previewConfig('claude-code', serverPath);
      const parsed = JSON.parse(snippet);
      expect(parsed['context-fabric']).toBeDefined();
      expect(parsed['context-fabric'].type).toBe('stdio');
      expect(parsed['context-fabric'].command).toBe('node');
      expect(parsed['context-fabric'].args).toEqual([serverPath]);
    });

    it('should return TOML for codex', () => {
      const snippet = previewConfig('codex', serverPath);
      expect(snippet).toContain('[mcp_servers.context-fabric]');
      expect(snippet).toContain('command = "node"');
      expect(snippet).toContain(serverPath);
      expect(snippet).toContain('enabled = true');
    });

    it('should return JSON for claude (desktop)', () => {
      const snippet = previewConfig('claude', serverPath);
      const parsed = JSON.parse(snippet);
      expect(parsed['context-fabric']).toBeDefined();
      expect(parsed['context-fabric'].command).toBe('node');
      expect(parsed['context-fabric'].args).toEqual([serverPath]);
    });

    it('should return JSON for kimi', () => {
      const snippet = previewConfig('kimi', serverPath);
      const parsed = JSON.parse(snippet);
      expect(parsed['context-fabric'].command).toBe('node');
    });

    it('should return JSON for gemini', () => {
      const snippet = previewConfig('gemini', serverPath);
      const parsed = JSON.parse(snippet);
      expect(parsed['context-fabric'].command).toBe('node');
    });

    it('should return JSON for cursor', () => {
      const snippet = previewConfig('cursor', serverPath);
      const parsed = JSON.parse(snippet);
      expect(parsed['context-fabric'].command).toBe('node');
    });

    it('should return Docker snippets for docker cli type', () => {
      const snippet = previewConfig('docker');
      expect(snippet).toContain('docker');
      expect(snippet).toContain('context-fabric');
    });

    it('should return JSON for generic', () => {
      const snippet = previewConfig('generic' as SupportedCLI, serverPath);
      const parsed = JSON.parse(snippet);
      expect(parsed['context-fabric'].command).toBe('node');
    });
  });

  // ==========================================================================
  // setupForCLI — file-writing tests (using temp dirs)
  // ==========================================================================

  describe('setupForCLI', () => {
    it('should return success for docker (no file write)', () => {
      const result = setupForCLI('docker');

      expect(result.success).toBe(true);
      expect(result.cli).toBe('docker');
      expect(result.snippet).toBeDefined();
      expect(result.snippet!.length).toBeGreaterThan(0);
      expect(result.configPath).toBe('(manual)');
    });

    it('should return success for generic (no file write)', () => {
      const result = setupForCLI('generic', '/test/server.js');

      expect(result.success).toBe(true);
      expect(result.cli).toBe('generic');
      expect(result.snippet).toBeDefined();
      expect(result.configPath).toBe('(manual)');
    });

    it('should include docker run in docker snippet', () => {
      const result = setupForCLI('docker');

      expect(result.snippet).toContain('docker');
      expect(result.snippet).toContain('run');
      expect(result.snippet).toContain('--rm');
      expect(result.snippet).toContain('-i');
    });

    it('should set restartRequired flag', () => {
      const result = setupForCLI('generic', '/test/server.js');
      expect(typeof result.restartRequired).toBe('boolean');
    });
  });

  // ==========================================================================
  // setupForCLI — local transport vs Docker transport
  // ==========================================================================

  describe('transport modes via preview', () => {
    const serverPath = '/test/dist/server.js';

    it('should generate node-based entries by default', () => {
      const snippet = previewConfig('opencode', serverPath);
      expect(snippet).toContain('node');
      expect(snippet).not.toContain('docker');
    });

    it('should reference the provided server path', () => {
      const snippet = previewConfig('claude-code', serverPath);
      expect(snippet).toContain(serverPath);
    });
  });
});
