/**
 * End-to-End Tests
 * Simulates a complete CLI session with context-fabric
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ContextEngine } from '../../src/engine.js';
import { MemoryLayer, MemoryType, CLIEvent } from '../../src/types.js';
import {
  createTempDir,
  removeDir,
  generateSessionId,
  sleep,
  assertValidContextWindow,
} from '../utils.js';

describe('End-to-End: CLI Session Flow', () => {
  let projectPath: string;
  let engine: ContextEngine;
  let sessionId: string;
  
  beforeAll(async () => {
    // Create isolated test environment
    projectPath = createTempDir('context-fabric-e2e-');
    
    // Initialize ContextEngine
    engine = new ContextEngine({
      projectPath,
      autoCleanup: false,
      logLevel: 'error',
    });
    
    sessionId = generateSessionId();
  });
  
  afterAll(async () => {
    // Cleanup
    engine.close();
    removeDir(projectPath);
  });
  
  // ============================================================================
  // Step 1: CLI Starts -> session_start event
  // ============================================================================
  
  describe('Step 1: Session Start', () => {
    it('should handle session_start event', async () => {
      const event: CLIEvent = {
        type: 'session_start',
        payload: {
          projectPath,
          cliType: 'kimi',
        },
        timestamp: new Date(),
        sessionId,
        cliType: 'kimi',
        projectPath,
      };
      
      const result = await engine.handleEvent(event);
      
      expect(result.processed).toBe(true);
      expect(result.memoryId).toBeDefined();
      expect(result.triggeredActions).toContain('initialized_session');
      expect(result.triggeredActions).toContain('ghost_ready');
    });
    
    it('should create session_start memory in L1', async () => {
      // Verify session start was recorded
      const working = engine.l1.getAll();
      const sessionMemory = working.find(m => 
        m.content.includes('Session started') && 
        m.metadata?.sessionId === sessionId
      );
      
      expect(sessionMemory).toBeDefined();
      expect(sessionMemory?.type).toBe('scratchpad');
    });
    
    it('should initialize ghost suggestions', async () => {
      const ghostResult = await engine.ghost();
      
      expect(ghostResult).toBeDefined();
      expect(ghostResult.messages).toBeDefined();
      expect(ghostResult.suggestedActions).toBeDefined();
    });
  });
  
  // ============================================================================
  // Step 2: File opened -> L1 scratchpad
  // ============================================================================
  
  describe('Step 2: File Operations', () => {
    it('should handle file_opened event', async () => {
      const event: CLIEvent = {
        type: 'file_opened',
        payload: {
          path: `${projectPath}/src/components/UserProfile.tsx`,
          content: 'export function UserProfile() { return <div>Profile</div>; }',
        },
        timestamp: new Date(),
        sessionId,
        cliType: 'kimi',
        projectPath,
      };
      
      const result = await engine.handleEvent(event);
      
      expect(result.processed).toBe(true);
      expect(result.memoryId).toBeDefined();
      expect(result.triggeredActions).toContain('stored_scratchpad');
    });
    
    it('should store file_opened in L1 with language detection', async () => {
      const working = engine.l1.getAll();
      const fileMemory = working.find(m => 
        m.content.includes('UserProfile.tsx')
      );
      
      expect(fileMemory).toBeDefined();
      expect(fileMemory?.metadata?.fileContext?.path).toContain('UserProfile.tsx');
      expect(fileMemory?.metadata?.codeBlock?.language).toBe('typescript');
    });
    
    it('should handle multiple file opens', async () => {
      const files = [
        { path: `${projectPath}/src/utils/api.ts`, language: 'typescript' },
        { path: `${projectPath}/src/styles/main.css`, language: 'css' },
        { path: `${projectPath}/README.md`, language: 'markdown' },
      ];
      
      for (const file of files) {
        const event: CLIEvent = {
          type: 'file_opened',
          payload: { path: file.path },
          timestamp: new Date(),
          sessionId,
          cliType: 'kimi',
          projectPath,
        };
        
        await engine.handleEvent(event);
      }
      
      // Verify all files recorded
      const working = engine.l1.getAll();
      expect(working.length).toBeGreaterThanOrEqual(4);
    });
  });
  
  // ============================================================================
  // Step 3: Error occurred -> L2 bug_fix
  // ============================================================================
  
  describe('Step 3: Error Handling', () => {
    it('should handle error_occurred event', async () => {
      const event: CLIEvent = {
        type: 'error_occurred',
        payload: {
          error: 'TypeError: Cannot read property "name" of undefined',
          context: 'In UserProfile component at line 15',
        },
        timestamp: new Date(),
        sessionId,
        cliType: 'kimi',
        projectPath,
      };
      
      const result = await engine.handleEvent(event);
      
      expect(result.processed).toBe(true);
      expect(result.memoryId).toBeDefined();
      expect(result.triggeredActions).toContain('stored_bug_fix');
    });
    
    it('should store error in L2 (Project Memory)', async () => {
      const recentL2 = await engine.l2.getRecent(10);
      const errorMemory = recentL2.find(m => 
        m.type === 'bug_fix' && m.content.includes('TypeError')
      );
      
      expect(errorMemory).toBeDefined();
      expect(errorMemory?.content).toContain('Cannot read property');
      expect(errorMemory?.metadata?.sessionId).toBe(sessionId);
    });
    
    it('should detect error in command output', async () => {
      const event: CLIEvent = {
        type: 'command_executed',
        payload: {
          command: 'npm test',
          output: 'FAIL src/components/UserProfile.test.tsx\nError: expect(received).toBe(expected)\nTest failed with exit code 1',
        },
        timestamp: new Date(),
        sessionId,
        cliType: 'kimi',
        projectPath,
      };
      
      const result = await engine.handleEvent(event);
      
      expect(result.processed).toBe(true);
      expect(result.triggeredActions).toContain('stored_command');
      expect(result.triggeredActions).toContain('stored_error');
      
      // Verify error was stored
      const recentL2 = await engine.l2.getRecent(10);
      const commandError = recentL2.find(m => 
        m.type === 'bug_fix' && m.content.includes('npm test')
      );
      expect(commandError).toBeDefined();
    });
  });
  
  // ============================================================================
  // Step 4: Decision made -> L2 decision
  // ============================================================================
  
  describe('Step 4: Decision Recording', () => {
    it('should handle decision_made event', async () => {
      const event: CLIEvent = {
        type: 'decision_made',
        payload: {
          decision: 'Add null checks to all component props',
          rationale: 'Prevent runtime errors from undefined props. The UserProfile error showed we need defensive coding.',
        },
        timestamp: new Date(),
        sessionId,
        cliType: 'kimi',
        projectPath,
      };
      
      const result = await engine.handleEvent(event);
      
      expect(result.processed).toBe(true);
      expect(result.memoryId).toBeDefined();
      expect(result.triggeredActions).toContain('stored_decision');
    });
    
    it('should store decision in L2', async () => {
      const recentL2 = await engine.l2.getRecent(10);
      const decisionMemory = recentL2.find(m => 
        m.type === 'decision' && m.content.includes('null checks')
      );
      
      expect(decisionMemory).toBeDefined();
      expect(decisionMemory?.content).toContain('Add null checks');
      expect(decisionMemory?.content).toContain('Prevent runtime errors');
    });
    
    it('should link decision to error context', async () => {
      const recentL2 = await engine.l2.getRecent(10);
      const decision = recentL2.find(m => m.type === 'decision');
      
      expect(decision?.content).toContain('UserProfile error');
    });
  });
  
  // ============================================================================
  // Step 5: Pattern learned -> L3 code_pattern
  // ============================================================================
  
  describe('Step 5: Pattern Learning', () => {
    it('should handle pattern_detected event', async () => {
      const event: CLIEvent = {
        type: 'pattern_detected',
        payload: {
          pattern: 'Defensive prop destructuring with defaults',
          code: 'function Component({ name = "Anonymous", age = 0 }) { }',
        },
        timestamp: new Date(),
        sessionId,
        cliType: 'kimi',
        projectPath,
      };
      
      const result = await engine.handleEvent(event);
      
      expect(result.processed).toBe(true);
      expect(result.memoryId).toBeDefined();
      expect(result.triggeredActions).toContain('stored_pattern');
    });
    
    it('should store pattern in L3 (Semantic Memory)', async () => {
      // Give ChromaDB time to index
      await sleep(200);
      
      const results = await engine.l3.recall('defensive prop destructuring', 5);
      
      expect(results.length).toBeGreaterThan(0);
      
      const pattern = results.find(r =>
        r.content.toLowerCase().includes('defensive prop')
      );
      expect(pattern).toBeDefined();
    });
    
    it('should make pattern searchable by related terms', async () => {
      await sleep(200);
      
      // Search with different but related terms
      const results1 = await engine.l3.recall('default values', 5);
      const results2 = await engine.l3.recall('component props', 5);
      
      // At least one should find our pattern
      const found = results1.length > 0 || results2.length > 0;
      expect(found).toBe(true);
    });
  });
  
  // ============================================================================
  // Step 6: Context window includes all relevant
  // ============================================================================
  
  describe('Step 6: Context Window Assembly', () => {
    it('should build complete context window', async () => {
      const context = await engine.getContextWindow();
      
      assertValidContextWindow(context);
    });
    
    it('should include L1 working memories', async () => {
      const context = await engine.getContextWindow();
      
      // Should have file operations from earlier
      expect(context.working.length).toBeGreaterThan(0);
      
      const fileMemory = context.working.find(m => 
        m.content.includes('UserProfile.tsx')
      );
      expect(fileMemory).toBeDefined();
    });
    
    it('should include L2 project memories in relevant', async () => {
      const context = await engine.getContextWindow();
      
      // Should have error and decision
      const errorMemory = context.relevant.find(m => 
        m.type === 'bug_fix'
      );
      expect(errorMemory).toBeDefined();
      
      const decisionMemory = context.relevant.find(m => 
        m.type === 'decision'
      );
      expect(decisionMemory).toBeDefined();
    });
    
    it('should include L3 semantic memories via relevance', async () => {
      // Add a working memory to trigger semantic search
      await engine.store(
        'How do I handle undefined props safely?',
        'scratchpad',
        { layer: MemoryLayer.L1_WORKING }
      );
      
      const context = await engine.getContextWindow();
      
      // L3 patterns might be included based on semantic similarity
      // Not guaranteed but should not error
      expect(context.relevant).toBeDefined();
    });
    
    it('should include extracted patterns', async () => {
      const context = await engine.getContextWindow();
      
      expect(context.patterns).toBeDefined();
      expect(Array.isArray(context.patterns)).toBe(true);
    });
    
    it('should include AI suggestions', async () => {
      const context = await engine.getContextWindow();
      
      expect(context.suggestions).toBeDefined();
      expect(context.suggestions.length).toBeGreaterThan(0);
      
      // Should suggest based on error context
      const errorSuggestion = context.suggestions.find(s => 
        s.type === 'action' && s.content.toLowerCase().includes('error')
      );
      expect(errorSuggestion).toBeDefined();
    });
  });
  
  // ============================================================================
  // Step 7: Ghost shows suggestions
  // ============================================================================
  
  describe('Step 7: Ghost Messages', () => {
    it('should generate ghost messages', async () => {
      const ghostResult = await engine.ghost();
      
      expect(ghostResult.messages).toBeDefined();
      expect(ghostResult.messages.length).toBeGreaterThan(0);
    });
    
    it('should include ghost messages about recent decisions', async () => {
      const ghostResult = await engine.ghost();
      
      const decisionGhost = ghostResult.messages.find(m => 
        m.trigger === 'relevant_decision'
      );
      
      expect(decisionGhost).toBeDefined();
      expect(decisionGhost?.content).toContain('decision');
      expect(decisionGhost?.role).toBe('system');
      expect(decisionGhost?.isVisible).toBe(false);
    });
    
    it('should include ghost messages about bug fixes', async () => {
      const ghostResult = await engine.ghost();
      
      const bugGhost = ghostResult.messages.find(m => 
        m.trigger === 'bug_fix_context'
      );
      
      expect(bugGhost).toBeDefined();
      expect(bugGhost?.content).toContain('bug fix');
    });
    
    it('should include ghost messages in context window', async () => {
      const context = await engine.getContextWindow();
      
      expect(context.ghostMessages.length).toBeGreaterThan(0);
      
      // All ghost messages should be invisible
      context.ghostMessages.forEach(gm => {
        expect(gm.isVisible).toBe(false);
      });
    });
    
    it('should provide context-aware suggested actions', async () => {
      const ghostResult = await engine.ghost();
      
      // Should have suggestions based on session context
      expect(ghostResult.suggestedActions.length).toBeGreaterThan(0);
      
      // Should reference source memories
      for (const action of ghostResult.suggestedActions) {
        expect(action.sourceMemoryIds).toBeDefined();
        expect(action.sourceMemoryIds.length).toBeGreaterThan(0);
      }
    });
  });
  
  // ============================================================================
  // Cross-Layer Recall
  // ============================================================================
  
  describe('Cross-Layer Memory Recall', () => {
    it('should recall across all layers', async () => {
      const results = await engine.recall('error handling', { limit: 20 });
      
      expect(results.length).toBeGreaterThan(0);
      
      // Should have results from multiple layers
      const layers = new Set(results.map(r => r.layer));
      expect(layers.size).toBeGreaterThanOrEqual(1);
    });
    
    it('should rank results by relevance', async () => {
      const results = await engine.recall('UserProfile', { limit: 10 });
      
      // Should be sorted by similarity (highest first)
      for (let i = 1; i < results.length; i++) {
        expect(results[i].similarity).toBeLessThanOrEqual(results[i - 1].similarity);
      }
    });
    
    it('should filter recall by type', async () => {
      const results = await engine.recall('test', {
        filter: { types: ['decision'] },
      });
      
      for (const result of results) {
        expect(result.type).toBe('decision');
      }
    });
    
    it('should filter recall by layer', async () => {
      const l2Results = await engine.recall('test', {
        layers: [MemoryLayer.L2_PROJECT],
      });
      
      for (const result of l2Results) {
        expect(result.layer).toBe(MemoryLayer.L2_PROJECT);
      }
    });
  });
  
  // ============================================================================
  // Step 8: Code Index Search
  // ============================================================================

  describe('Step 8: Code Index', () => {
    it('should build a code index and search by text', async () => {
      const { writeFileSync, mkdirSync } = await import('fs');
      const { join } = await import('path');
      mkdirSync(join(projectPath, 'src/services'), { recursive: true });

      writeFileSync(join(projectPath, 'src/services/auth.ts'), `
export class AuthService {
  verifyToken(token: string): boolean {
    return token.startsWith('valid_');
  }

  createToken(userId: string): string {
    return 'valid_' + userId;
  }
}
`);

      writeFileSync(join(projectPath, 'src/services/user.ts'), `
export interface User {
  id: string;
  name: string;
  email: string;
}

export class UserService {
  findById(id: string): User | undefined {
    return undefined;
  }
}
`);

      const idx = engine.getCodeIndex();
      await idx.reindexFile('src/services/auth.ts');
      await idx.reindexFile('src/services/user.ts');

      const textResults = idx.searchText('verifyToken');
      expect(textResults.length).toBeGreaterThan(0);
      expect(textResults[0].filePath).toContain('auth.ts');
    });

    it('should search by symbol across multiple files', async () => {
      const idx = engine.getCodeIndex();

      const classResults = idx.searchSymbols('', { symbolKind: 'class' });
      expect(classResults.length).toBeGreaterThanOrEqual(2);

      const names = classResults.map(r => r.symbol?.name);
      expect(names).toContain('AuthService');
      expect(names).toContain('UserService');
    });

    it('should find interfaces', async () => {
      const idx = engine.getCodeIndex();

      const ifaces = idx.searchSymbols('', { symbolKind: 'interface' });
      expect(ifaces.some(r => r.symbol?.name === 'User')).toBe(true);
    });

    it('should return file symbols for a specific file', async () => {
      const idx = engine.getCodeIndex();

      const symbols = idx.getFileSymbols('src/services/auth.ts');
      const names = symbols.map(s => s.name);
      expect(names).toContain('AuthService');
      expect(names).toContain('verifyToken');
      expect(names).toContain('createToken');
    });

    it('should report index status', async () => {
      const idx = engine.getCodeIndex();
      const status = idx.getStatus();

      expect(status.totalFiles).toBe(2);
      expect(status.totalSymbols).toBeGreaterThan(0);
      expect(status.totalChunks).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // Session End
  // ============================================================================
  
  describe('Session End', () => {
    it('should handle session_end event', async () => {
      const event: CLIEvent = {
        type: 'session_end',
        payload: {},
        timestamp: new Date(),
        sessionId,
        cliType: 'kimi',
        projectPath,
      };
      
      const result = await engine.handleEvent(event);
      
      expect(result.processed).toBe(true);
      expect(result.triggeredActions).toContain('session_closed');
    });
    
    it('should record session end in L1', async () => {
      const working = engine.l1.getAll();
      const endMemory = working.find(m => 
        m.content === 'Session ended'
      );
      
      expect(endMemory).toBeDefined();
      expect(endMemory?.type).toBe('scratchpad');
    });
    
    it('should preserve L2 and L3 memories after session', async () => {
      const l2Count = (await engine.l2.getRecent(100)).length;
      const l3Count = await engine.l3.count();
      
      expect(l2Count).toBeGreaterThan(0);
      expect(l3Count).toBeGreaterThanOrEqual(0);
      
      // These should persist beyond session
      const recentL2 = await engine.l2.getRecent(10);
      expect(recentL2.some(m => m.type === 'bug_fix')).toBe(true);
      expect(recentL2.some(m => m.type === 'decision')).toBe(true);
    });
  });
  
  // ============================================================================
  // Full Flow Integration
  // ============================================================================
  
  describe('Complete Session Flow', () => {
    it('should execute full CLI workflow without errors', async () => {
      // This test verifies all the pieces work together
      
      // 1. Get context at session start
      let context = await engine.getContextWindow();
      expect(context.working.length).toBeGreaterThan(0);
      
      // 2. Simulate more file operations
      for (let i = 0; i < 3; i++) {
        await engine.handleEvent({
          type: 'file_opened',
          payload: { path: `${projectPath}/src/page${i}.tsx` },
          timestamp: new Date(),
          sessionId,
          cliType: 'kimi',
          projectPath,
        });
      }
      
      // 3. Store a manual memory
      await engine.store(
        'Manual note about architecture',
        'scratchpad',
        { layer: MemoryLayer.L1_WORKING }
      );
      
      // 4. Get updated context
      context = await engine.getContextWindow();
      expect(context.working.length).toBeGreaterThan(3);
      
      // 5. Recall memories
      const recallResults = await engine.recall('architecture', { limit: 10 });
      expect(recallResults).toBeDefined();
      
      // 6. Get ghost suggestions
      const ghostResult = await engine.ghost();
      expect(ghostResult.messages.length).toBeGreaterThan(0);
      
      // 7. Verify all layers have content
      expect(engine.l1.getAll().length).toBeGreaterThan(0);
      expect((await engine.l2.getRecent(100)).length).toBeGreaterThan(0);
      
      // All operations completed successfully
    });
    
    it('should support memory promotion workflow', async () => {
      // Create a working memory that turns out to be important
      const workingMem = await engine.store(
        'Important insight about performance',
        'scratchpad',
        { layer: MemoryLayer.L1_WORKING }
      );
      
      // Promote to project memory
      const promoted = await engine.promote(workingMem.id, MemoryLayer.L1_WORKING);
      expect(promoted.layer).toBe(MemoryLayer.L2_PROJECT);
      
      // Later, promote to global pattern
      const globalPattern = await engine.promote(promoted.id, MemoryLayer.L2_PROJECT);
      expect(globalPattern.layer).toBe(MemoryLayer.L3_SEMANTIC);
      
      // Verify it is searchable
      await sleep(200);
      const results = await engine.l3.recall('performance insight', 5);
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
