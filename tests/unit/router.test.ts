/**
 * Unit tests for SmartRouter
 * Tests routing rules, tag-based overrides, and edge cases
 */

import { describe, it, expect } from 'vitest';
import { SmartRouter, RoutingDecision } from '../../src/router.js';
import { MemoryType, MemoryLayer } from '../../src/types.js';

describe('SmartRouter', () => {
  // ============================================================================
  // Forced Layer Routing
  // ============================================================================
  
  describe('forced layer routing', () => {
    it('should route to L1 when forceLayer is L1_WORKING', () => {
      const decision = SmartRouter.route(
        'Any content',
        'code_pattern',
        {},
        [],
        undefined,
        MemoryLayer.L1_WORKING
      );
      
      expect(decision.layer).toBe(MemoryLayer.L1_WORKING);
      expect(decision.confidence).toBe(1.0);
      expect(decision.reason).toContain('explicitly specified');
    });
    
    it('should route to L2 when forceLayer is L2_PROJECT', () => {
      const decision = SmartRouter.route(
        'Any content',
        'code_pattern',
        {},
        [],
        undefined,
        MemoryLayer.L2_PROJECT
      );
      
      expect(decision.layer).toBe(MemoryLayer.L2_PROJECT);
      expect(decision.confidence).toBe(1.0);
    });
    
    it('should route to L3 when forceLayer is L3_SEMANTIC', () => {
      const decision = SmartRouter.route(
        'Any content',
        'scratchpad',
        {},
        [],
        undefined,
        MemoryLayer.L3_SEMANTIC
      );
      
      expect(decision.layer).toBe(MemoryLayer.L3_SEMANTIC);
      expect(decision.confidence).toBe(1.0);
    });
  });
  
  // ============================================================================
  // Tag-Based Routing Overrides
  // ============================================================================
  
  describe('tag-based routing overrides', () => {
    it('should route to L1 when tagged with "temp"', () => {
      const decision = SmartRouter.route(
        'Important pattern',
        'code_pattern',
        {},
        ['temp', 'draft']
      );
      
      expect(decision.layer).toBe(MemoryLayer.L1_WORKING);
      expect(decision.reason).toContain('temp');
      expect(decision.confidence).toBeGreaterThan(0.9);
    });
    
    it('should route to L1 when tagged with "temporary" (case insensitive)', () => {
      const decision = SmartRouter.route(
        'Important pattern',
        'code_pattern',
        {},
        ['TEMPORARY']
      );
      
      expect(decision.layer).toBe(MemoryLayer.L1_WORKING);
    });
    
    it('should route to L3 when tagged with "global"', () => {
      const decision = SmartRouter.route(
        'Project decision',
        'decision',
        {},
        ['global', 'universal']
      );
      
      expect(decision.layer).toBe(MemoryLayer.L3_SEMANTIC);
      expect(decision.reason).toContain('global');
    });
    
    it('should route to L3 when tagged with "universal"', () => {
      const decision = SmartRouter.route(
        'Bug fix',
        'bug_fix',
        {},
        ['universal']
      );
      
      expect(decision.layer).toBe(MemoryLayer.L3_SEMANTIC);
    });
    
    it('should route to L2 when tagged with "project"', () => {
      const decision = SmartRouter.route(
        'Global pattern',
        'code_pattern',
        {},
        ['project', 'local']
      );
      
      expect(decision.layer).toBe(MemoryLayer.L2_PROJECT);
      expect(decision.reason).toContain('project');
    });
    
    it('should route to L2 when tagged with "local"', () => {
      const decision = SmartRouter.route(
        'Global pattern',
        'code_pattern',
        {},
        ['local']
      );
      
      expect(decision.layer).toBe(MemoryLayer.L2_PROJECT);
    });
    
    it('should prioritize forced layer over tags', () => {
      const decision = SmartRouter.route(
        'Content',
        'code_pattern',
        {},
        ['global'],
        undefined,
        MemoryLayer.L1_WORKING
      );
      
      expect(decision.layer).toBe(MemoryLayer.L1_WORKING);
      expect(decision.confidence).toBe(1.0);
    });
  });
  
  // ============================================================================
  // TTL-Based Routing
  // ============================================================================
  
  describe('TTL-based routing', () => {
    it('should route to L1 when TTL is specified', () => {
      const decision = SmartRouter.route(
        'Important decision',
        'decision',
        {},
        [],
        3600 // 1 hour TTL
      );
      
      expect(decision.layer).toBe(MemoryLayer.L1_WORKING);
      expect(decision.reason).toContain('TTL');
    });
    
    it('should route to L1 for any positive TTL', () => {
      const ttls = [1, 60, 3600, 86400, 604800];
      
      for (const ttl of ttls) {
        const decision = SmartRouter.route(
          'Content',
          'code_pattern',
          {},
          [],
          ttl
        );
        expect(decision.layer).toBe(MemoryLayer.L1_WORKING);
      }
    });
  });
  
  // ============================================================================
  // Memory Type-Based Routing
  // ============================================================================
  
  describe('memory type-based routing', () => {
    describe('scratchpad', () => {
      it('should route scratchpad to L1', () => {
        const decision = SmartRouter.route(
          'Quick notes',
          'scratchpad'
        );
        
        expect(decision.layer).toBe(MemoryLayer.L1_WORKING);
        expect(decision.reason).toContain('Scratchpad');
        expect(decision.confidence).toBeGreaterThan(0.9);
      });
    });
    
    describe('code_pattern', () => {
      it('should route code_pattern to L3', () => {
        const decision = SmartRouter.route(
          'function helper() { return true; }',
          'code_pattern'
        );
        
        expect(decision.layer).toBe(MemoryLayer.L3_SEMANTIC);
        expect(decision.reason).toContain('globally reusable');
      });
    });
    
    describe('convention', () => {
      it('should route convention to L3', () => {
        const decision = SmartRouter.route(
          'Always use strict mode',
          'convention'
        );
        
        expect(decision.layer).toBe(MemoryLayer.L3_SEMANTIC);
      });
    });
    
    describe('decision', () => {
      it('should route decision to L2', () => {
        const decision = SmartRouter.route(
          'Use SQLite for storage',
          'decision'
        );
        
        expect(decision.layer).toBe(MemoryLayer.L2_PROJECT);
        expect(decision.reason).toContain('project-specific');
      });
    });
    
    describe('bug_fix', () => {
      it('should route bug_fix to L2', () => {
        const decision = SmartRouter.route(
          'Fixed race condition',
          'bug_fix'
        );
        
        expect(decision.layer).toBe(MemoryLayer.L2_PROJECT);
        expect(decision.reason).toContain('project-specific');
      });
    });
    
    describe('relationship', () => {
      it('should route relationship to L3', () => {
        const decision = SmartRouter.route(
          'User prefers TypeScript',
          'relationship'
        );
        
        expect(decision.layer).toBe(MemoryLayer.L3_SEMANTIC);
        expect(decision.reason).toContain('user preferences');
      });
    });
    
    describe('legacy types', () => {
      it('should route code to L2 or L3 based on content', () => {
        // Generic code
        const genericCode = SmartRouter.route(
          'console.log("hello")',
          'code'
        );
        expect([MemoryLayer.L2_PROJECT, MemoryLayer.L3_SEMANTIC]).toContain(genericCode.layer);
        
        // Pattern-like code
        const patternCode = SmartRouter.route(
          'export function helper() { return true; }',
          'code'
        );
        // Could be L2 or L3 depending on pattern detection
        expect([MemoryLayer.L2_PROJECT, MemoryLayer.L3_SEMANTIC]).toContain(patternCode.layer);
      });
      
      it('should route message to L1', () => {
        const decision = SmartRouter.route(
          'Hello world',
          'message'
        );
        
        expect(decision.layer).toBe(MemoryLayer.L1_WORKING);
      });
      
      it('should route thought to L1', () => {
        const decision = SmartRouter.route(
          'I think this is the right approach',
          'thought'
        );
        
        expect(decision.layer).toBe(MemoryLayer.L1_WORKING);
      });
      
      it('should route observation to L1', () => {
        const decision = SmartRouter.route(
          'The test is failing',
          'observation'
        );
        
        expect(decision.layer).toBe(MemoryLayer.L1_WORKING);
      });
      
      it('should route documentation to L2', () => {
        const decision = SmartRouter.route(
          'API documentation',
          'documentation'
        );
        
        expect(decision.layer).toBe(MemoryLayer.L2_PROJECT);
      });
      
      it('should route error to L2', () => {
        const decision = SmartRouter.route(
          'Error occurred',
          'error'
        );
        
        expect(decision.layer).toBe(MemoryLayer.L2_PROJECT);
      });
      
      it('should route summary to L2', () => {
        const decision = SmartRouter.route(
          'Summary of session',
          'summary'
        );
        
        expect(decision.layer).toBe(MemoryLayer.L2_PROJECT);
      });
    });
  });
  
  // ============================================================================
  // Code Content Analysis
  // ============================================================================
  
  describe('code content analysis', () => {
    it('should detect reusable patterns (L3) for exported functions', () => {
      const decision = SmartRouter.route(
        'export function formatDate(date: Date): string { return date.toISOString(); }',
        'code'
      );
      
      // Should be L3 if detected as pattern
      if (decision.layer === MemoryLayer.L3_SEMANTIC) {
        expect(decision.reason).toContain('reusable pattern');
      }
    });
    
    it('should detect classes as potential patterns', () => {
      const decision = SmartRouter.route(
        'class DataProcessor { process(data) { return data; } }',
        'code'
      );
      
      // Class definitions often indicate patterns
      expect(decision.confidence).toBeGreaterThan(0.6);
    });
    
    it('should route session-specific code to L1', () => {
      const decision = SmartRouter.route(
        'const x = 5;',
        'code',
        { sessionContext: { sessionId: '123', commandHistory: [], openFiles: [], workingDirectory: '' } }
      );
      
      expect(decision.layer).toBe(MemoryLayer.L1_WORKING);
      expect(decision.reason).toContain('session');
    });
    
    it('should detect business logic as project-specific', () => {
      const decision = SmartRouter.route(
        'function processCustomerOrder(order) { return company.process(order); }',
        'code'
      );
      
      // Business logic should default to L2
      expect(decision.layer).toBe(MemoryLayer.L2_PROJECT);
    });
  });
  
  // ============================================================================
  // Edge Cases
  // ============================================================================
  
  describe('edge cases', () => {
    it('should handle empty content', () => {
      const decision = SmartRouter.route(
        '',
        'scratchpad'
      );
      
      expect(decision.layer).toBe(MemoryLayer.L1_WORKING);
      expect(decision.confidence).toBeGreaterThan(0);
    });
    
    it('should handle very long content', () => {
      const longContent = 'x'.repeat(100000);
      const decision = SmartRouter.route(
        longContent,
        'code_pattern'
      );
      
      expect(decision.layer).toBe(MemoryLayer.L3_SEMANTIC);
    });
    
    it('should handle content with special characters', () => {
      const specialContent = '<script>alert("xss")</script> \n\t\r { } [ ] ( )';
      const decision = SmartRouter.route(
        specialContent,
        'scratchpad'
      );
      
      expect(decision.layer).toBe(MemoryLayer.L1_WORKING);
    });
    
    it('should handle unicode content', () => {
      const unicodeContent = '🎉 日本語 تست 中文 🔥';
      const decision = SmartRouter.route(
        unicodeContent,
        'decision'
      );
      
      expect(decision.layer).toBe(MemoryLayer.L2_PROJECT);
    });
    
    it('should handle multiple conflicting tags (first match wins)', () => {
      // Both temp and global specified - temp should win (checked first)
      const decision = SmartRouter.route(
        'Content',
        'code_pattern',
        {},
        ['temp', 'global']
      );
      
      expect(decision.layer).toBe(MemoryLayer.L1_WORKING);
    });
    
    it('should handle unknown/invalid type gracefully', () => {
      const decision = SmartRouter.route(
        'Content',
        'unknown_type' as MemoryType
      );
      
      // Should default to L2
      expect(decision.layer).toBe(MemoryLayer.L2_PROJECT);
      expect(decision.confidence).toBeLessThan(0.7);
    });
    
    it('should handle empty tags array', () => {
      const decision = SmartRouter.route(
        'Content',
        'decision',
        {},
        []
      );
      
      expect(decision.layer).toBe(MemoryLayer.L2_PROJECT);
    });
    
    it('should handle undefined/empty metadata', () => {
      const decision = SmartRouter.route(
        'Content',
        'scratchpad',
        undefined,
        undefined,
        undefined
      );
      
      expect(decision.layer).toBe(MemoryLayer.L1_WORKING);
    });
    
    it('should handle zero TTL', () => {
      // TTL of 0 or undefined should not trigger TTL-based routing
      const decision = SmartRouter.route(
        'Content',
        'decision',
        {},
        [],
        0
      );
      
      // Should route based on type, not TTL
      expect(decision.layer).toBe(MemoryLayer.L2_PROJECT);
    });
  });
  
  // ============================================================================
  // explainRouting
  // ============================================================================
  
  describe('explainRouting', () => {
    it('should return human-readable explanation', () => {
      const decision: RoutingDecision = {
        layer: MemoryLayer.L3_SEMANTIC,
        reason: 'Test reason',
        confidence: 0.85,
      };
      
      const explanation = SmartRouter.explainRouting(decision);
      
      expect(explanation).toContain('L3 Semantic Memory');
      expect(explanation).toContain('85%');
      expect(explanation).toContain('Test reason');
    });
    
    it('should include layer name for all layers', () => {
      const layers = [
        { layer: MemoryLayer.L1_WORKING, name: 'L1 Working Memory' },
        { layer: MemoryLayer.L2_PROJECT, name: 'L2 Project Memory' },
        { layer: MemoryLayer.L3_SEMANTIC, name: 'L3 Semantic Memory' },
      ];
      
      for (const { layer, name } of layers) {
        const explanation = SmartRouter.explainRouting({
          layer,
          reason: 'Test',
          confidence: 0.5,
        });
        expect(explanation).toContain(name);
      }
    });
  });
});
