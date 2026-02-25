/**
 * Unit tests for Config module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getConfig,
  loadConfig,
  resetConfigCache,
  getStoragePaths,
  getEmbeddingConfig,
  getTTLConfig,
} from '../../src/config.js';

describe('Config Module', () => {
  beforeEach(() => {
    resetConfigCache();
  });

  afterEach(() => {
    resetConfigCache();
  });

  // ==========================================================================
  // loadConfig
  // ==========================================================================

  describe('loadConfig', () => {
    it('should return a config object with all required sections', () => {
      const config = loadConfig();

      expect(config.storage).toBeDefined();
      expect(config.ttl).toBeDefined();
      expect(config.embedding).toBeDefined();
      expect(config.context).toBeDefined();
      expect(config.cli).toBeDefined();
    });

    it('should have valid storage paths', () => {
      const config = loadConfig();
      expect(typeof config.storage.l2Path).toBe('string');
      expect(typeof config.storage.l3Path).toBe('string');
      expect(config.storage.l2Path.length).toBeGreaterThan(0);
      expect(config.storage.l3Path.length).toBeGreaterThan(0);
    });

    it('should have valid TTL defaults', () => {
      const config = loadConfig();
      expect(config.ttl.l1Default).toBeGreaterThan(0);
      expect(config.ttl.l3DecayDays).toBeGreaterThan(0);
      expect(config.ttl.l3AccessThreshold).toBeGreaterThan(0);
    });

    it('should have valid embedding config', () => {
      const config = loadConfig();
      expect(typeof config.embedding.model).toBe('string');
      expect(config.embedding.dimension).toBe(384);
      expect(config.embedding.batchSize).toBeGreaterThan(0);
    });

    it('should have valid context limits', () => {
      const config = loadConfig();
      expect(config.context.maxWorkingMemories).toBeGreaterThan(0);
      expect(config.context.maxRelevantMemories).toBeGreaterThan(0);
      expect(config.context.maxPatterns).toBeGreaterThan(0);
      expect(config.context.maxSuggestions).toBeGreaterThan(0);
      expect(config.context.maxGhostMessages).toBeGreaterThan(0);
    });

    it('should have CLI defaults', () => {
      const config = loadConfig();
      expect(config.cli.defaultCapabilities).toBeDefined();
      expect(typeof config.cli.defaultCapabilities.autoCapturePatterns).toBe(
        'boolean'
      );
      expect(typeof config.cli.defaultCapabilities.maxContextMemories).toBe(
        'number'
      );
    });
  });

  // ==========================================================================
  // getConfig (singleton)
  // ==========================================================================

  describe('getConfig', () => {
    it('should return same instance on repeated calls', () => {
      const first = getConfig();
      const second = getConfig();
      expect(first).toBe(second);
    });

    it('should return fresh instance after resetConfigCache', () => {
      const first = getConfig();
      resetConfigCache();
      const second = getConfig();
      // Deep equal but not same reference
      expect(first).not.toBe(second);
      expect(first.storage.l2Path).toBe(second.storage.l2Path);
    });
  });

  // ==========================================================================
  // resetConfigCache
  // ==========================================================================

  describe('resetConfigCache', () => {
    it('should not throw', () => {
      expect(() => resetConfigCache()).not.toThrow();
    });

    it('should cause getConfig to reload', () => {
      const before = getConfig();
      resetConfigCache();
      const after = getConfig();
      expect(before).not.toBe(after);
    });
  });

  // ==========================================================================
  // getStoragePaths
  // ==========================================================================

  describe('getStoragePaths', () => {
    it('should return l2Path and l3Path', () => {
      const paths = getStoragePaths();
      expect(typeof paths.l2Path).toBe('string');
      expect(typeof paths.l3Path).toBe('string');
    });

    it('should match the config values', () => {
      const config = getConfig();
      const paths = getStoragePaths();
      expect(paths.l2Path).toBe(config.storage.l2Path);
      expect(paths.l3Path).toBe(config.storage.l3Path);
    });
  });

  // ==========================================================================
  // getEmbeddingConfig
  // ==========================================================================

  describe('getEmbeddingConfig', () => {
    it('should return embedding config with model, dimension, batchSize', () => {
      const emb = getEmbeddingConfig();
      expect(typeof emb.model).toBe('string');
      expect(typeof emb.dimension).toBe('number');
      expect(typeof emb.batchSize).toBe('number');
    });

    it('should match the config values', () => {
      const config = getConfig();
      const emb = getEmbeddingConfig();
      expect(emb).toEqual(config.embedding);
    });
  });

  // ==========================================================================
  // getTTLConfig
  // ==========================================================================

  describe('getTTLConfig', () => {
    it('should return TTL config with l1Default, l3DecayDays, l3AccessThreshold', () => {
      const ttl = getTTLConfig();
      expect(typeof ttl.l1Default).toBe('number');
      expect(typeof ttl.l3DecayDays).toBe('number');
      expect(typeof ttl.l3AccessThreshold).toBe('number');
    });

    it('should match the config values', () => {
      const config = getConfig();
      const ttl = getTTLConfig();
      expect(ttl).toEqual(config.ttl);
    });

    it('should have reasonable defaults', () => {
      const ttl = getTTLConfig();
      expect(ttl.l1Default).toBe(3600); // 1 hour
      expect(ttl.l3DecayDays).toBe(14); // aggressive 14-day window (v0.5.4)
      expect(ttl.l3DecayThreshold).toBe(0.2);
      expect(ttl.l3AccessThreshold).toBe(3);
    });
  });
});
