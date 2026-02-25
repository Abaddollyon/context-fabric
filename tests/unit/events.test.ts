/**
 * Unit tests for EventHandler
 * Tests each event type, event batching, and error capture
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventHandler, EventResult } from '../../src/events.js';
import { ContextEngine } from '../../src/engine.js';
import { CLIEvent, MemoryLayer, MemoryType } from '../../src/types.js';
import {
  createTestContext,
  createMockEvent,
  generateSessionId,
  assertValidMemory,
  sleep,
} from '../utils.js';

describe('EventHandler', () => {
  let context: Awaited<ReturnType<typeof createTestContext>>;
  let handler: EventHandler;
  
  beforeEach(async () => {
    context = await createTestContext({ logLevel: 'error' });
    handler = context.engine.eventHandler;
  });
  
  afterEach(async () => {
    await context.cleanup();
  });
  
  // ============================================================================
  // Event Type: file_opened
  // ============================================================================
  
  describe('file_opened event', () => {
    it('should create L1 scratchpad memory for file_opened', async () => {
      const event = createMockEvent('file_opened', {
        path: '/project/src/index.ts',
        content: 'console.log("hello");',
      });
      
      const result = await handler.handleEvent(event);
      
      expect(result.processed).toBe(true);
      expect(result.memoryId).toBeDefined();
      expect(result.triggeredActions).toContain('stored_scratchpad');
      
      // Verify memory was created in L1
      const memory = context.engine.l1.get(result.memoryId!);
      expect(memory).toBeDefined();
      expect(memory!.type).toBe('scratchpad');
      expect(memory!.content).toContain('/project/src/index.ts');
      expect(memory!.metadata?.fileContext?.path).toBe('/project/src/index.ts');
    });
    
    it('should detect language from file extension', async () => {
      const testCases = [
        { path: 'test.ts', expected: 'typescript' },
        { path: 'test.tsx', expected: 'typescript' },
        { path: 'test.js', expected: 'javascript' },
        { path: 'test.py', expected: 'python' },
        { path: 'test.rs', expected: 'rust' },
        { path: 'test.go', expected: 'go' },
      ];
      
      for (const { path, expected } of testCases) {
        const event = createMockEvent('file_opened', { path, content: '// test' });
        const result = await handler.handleEvent(event);
        
        const memory = context.engine.l1.get(result.memoryId!);
        expect(memory?.metadata?.codeBlock?.language).toBe(expected);
      }
    });
    
    it('should truncate long file content in codeBlock', async () => {
      const longContent = 'x'.repeat(2000);
      const event = createMockEvent('file_opened', {
        path: '/test/file.ts',
        content: longContent,
      });
      
      const result = await handler.handleEvent(event);
      const memory = context.engine.l1.get(result.memoryId!);
      
      expect(memory?.metadata?.codeBlock?.code.length).toBeLessThanOrEqual(1000);
    });
    
    it('should handle file_opened without content', async () => {
      const event = createMockEvent('file_opened', {
        path: '/project/config.yaml',
      });
      
      const result = await handler.handleEvent(event);
      
      expect(result.processed).toBe(true);
      const memory = context.engine.l1.get(result.memoryId!);
      expect(memory?.metadata?.codeBlock).toBeUndefined();
    });
  });
  
  // ============================================================================
  // Event Type: command_executed
  // ============================================================================
  
  describe('command_executed event', () => {
    it('should create L1 scratchpad for command', async () => {
      const event = createMockEvent('command_executed', {
        command: 'npm test',
        output: 'Tests passed',
      });
      
      const result = await handler.handleEvent(event);
      
      expect(result.processed).toBe(true);
      expect(result.triggeredActions).toContain('stored_command');
      
      const memory = context.engine.l1.get(result.memoryId!);
      expect(memory?.type).toBe('scratchpad');
      expect(memory?.content).toContain('npm test');
    });
    
    it('should detect errors in command output', async () => {
      const event = createMockEvent('command_executed', {
        command: 'npm test',
        output: 'Error: Test failed with exit code 1',
      });
      
      const result = await handler.handleEvent(event);
      
      expect(result.processed).toBe(true);
      expect(result.triggeredActions).toContain('stored_command');
      expect(result.triggeredActions).toContain('stored_error');
      
      // Verify error was also stored in L2
      const l2Memories = await context.engine.l2.getRecent(10);
      const errorMemory = l2Memories.find(m => m.type === 'bug_fix');
      expect(errorMemory).toBeDefined();
      expect(errorMemory?.content).toContain('npm test');
    });
    
    it('should detect various error patterns', async () => {
      const errorPatterns = [
        'error: something went wrong',
        'Exception in thread',
        'Failed to connect',
        'Fatal error occurred',
        'panic: runtime error',
        'Traceback (most recent call last)',
        'command not found',
        'exit code 1',
        'non-zero exit',
        'ENOENT: no such file',
        'EACCES: permission denied',
        'SyntaxError: unexpected token',
        'Compilation failed',
      ];
      
      for (const pattern of errorPatterns) {
        const event = createMockEvent('command_executed', {
          command: 'test',
          output: pattern,
        });
        
        const result = await handler.handleEvent(event);
        expect(result.triggeredActions).toContain('stored_error');
        
        // Clean up for next iteration
        context.engine.l1.clear();
      }
    });
    
    it('should truncate long command output', async () => {
      const longOutput = 'output\n'.repeat(200);
      const event = createMockEvent('command_executed', {
        command: 'long-command',
        output: longOutput,
      });
      
      const result = await handler.handleEvent(event);
      const memory = context.engine.l1.get(result.memoryId!);
      
      // Output should be truncated in memory content
      expect(memory!.content.length).toBeLessThan(longOutput.length + 100);
    });
  });
  
  // ============================================================================
  // Event Type: error_occurred
  // ============================================================================
  
  describe('error_occurred event', () => {
    it('should create L2 bug_fix memory for error', async () => {
      const event = createMockEvent('error_occurred', {
        error: 'TypeError: Cannot read property of undefined',
        context: 'At line 42 in user.service.ts',
      });
      
      const result = await handler.handleEvent(event);
      
      expect(result.processed).toBe(true);
      expect(result.triggeredActions).toContain('stored_bug_fix');
      
      // Error should be in L2
      const l2Memories = await context.engine.l2.getRecent(5);
      const errorMemory = l2Memories.find(m => m.id === result.memoryId);
      expect(errorMemory).toBeDefined();
      expect(errorMemory?.type).toBe('bug_fix');
      expect(errorMemory?.content).toContain('TypeError');
      expect(errorMemory?.content).toContain('user.service.ts');
    });
    
    it('should handle error without context', async () => {
      const event = createMockEvent('error_occurred', {
        error: 'Network timeout',
      });
      
      const result = await handler.handleEvent(event);
      
      expect(result.processed).toBe(true);
      
      const l2Memories = await context.engine.l2.getRecent(5);
      const errorMemory = l2Memories.find(m => m.id === result.memoryId);
      expect(errorMemory?.content).toBe('Error: Network timeout');
    });
  });
  
  // ============================================================================
  // Event Type: decision_made
  // ============================================================================
  
  describe('decision_made event', () => {
    it('should create L2 decision memory', async () => {
      const event = createMockEvent('decision_made', {
        decision: 'Use PostgreSQL for production database',
        rationale: 'Better JSON support and ACID compliance',
      });
      
      const result = await handler.handleEvent(event);
      
      expect(result.processed).toBe(true);
      expect(result.triggeredActions).toContain('stored_decision');
      
      const l2Memories = await context.engine.l2.getRecent(5);
      const decisionMemory = l2Memories.find(m => m.id === result.memoryId);
      expect(decisionMemory).toBeDefined();
      expect(decisionMemory?.type).toBe('decision');
      expect(decisionMemory?.content).toContain('PostgreSQL');
      expect(decisionMemory?.content).toContain('ACID compliance');
    });
    
    it('should handle decision without rationale', async () => {
      const event = createMockEvent('decision_made', {
        decision: 'Use TypeScript',
      });
      
      const result = await handler.handleEvent(event);
      
      expect(result.processed).toBe(true);
      
      const l2Memories = await context.engine.l2.getRecent(5);
      const decisionMemory = l2Memories.find(m => m.id === result.memoryId);
      expect(decisionMemory?.content).toBe('Decision: Use TypeScript');
    });
  });
  
  // ============================================================================
  // Event Type: session_start
  // ============================================================================
  
  describe('session_start event', () => {
    it('should create L1 memory for session start', async () => {
      const event = createMockEvent('session_start', {
        projectPath: '/my/project',
        cliType: 'claude',
      });
      
      const result = await handler.handleEvent(event);
      
      expect(result.processed).toBe(true);
      expect(result.triggeredActions).toContain('initialized_session');
      expect(result.triggeredActions).toContain('ghost_ready');
      
      const memory = context.engine.l1.get(result.memoryId!);
      expect(memory?.type).toBe('scratchpad');
      expect(memory?.content).toContain('/my/project');
      expect(memory?.content).toContain('claude');
    });
    
    it('should use 24 hour TTL for session_start', async () => {
      const event = createMockEvent('session_start', {
        projectPath: '/test',
        cliType: 'kimi',
      });
      
      const result = await handler.handleEvent(event);
      const memory = context.engine.l1.get(result.memoryId!);
      
      expect(memory?.ttl).toBe(86400);
    });
  });
  
  // ============================================================================
  // Event Type: session_end
  // ============================================================================
  
  describe('session_end event', () => {
    it('should create L1 memory for session end', async () => {
      const event = createMockEvent('session_end', {});
      
      const result = await handler.handleEvent(event);
      
      expect(result.processed).toBe(true);
      expect(result.triggeredActions).toContain('session_closed');
      
      const memory = context.engine.l1.get(result.memoryId!);
      expect(memory?.type).toBe('scratchpad');
      expect(memory?.content).toBe('Session ended');
    });
  });
  
  // ============================================================================
  // Event Type: pattern_detected
  // ============================================================================
  
  describe('pattern_detected event', () => {
    it('should create L3 code_pattern memory', async () => {
      const event = createMockEvent('pattern_detected', {
        pattern: 'Error handling with try-catch',
        code: 'try { riskyOp(); } catch (e) { handle(e); }',
      });
      
      const result = await handler.handleEvent(event);
      
      expect(result.processed).toBe(true);
      expect(result.triggeredActions).toContain('stored_pattern');
      
      // Pattern should be in L3
      const l3Results = await context.engine.l3.recall('Error handling', 5);
      const patternMemory = l3Results.find(r => r.id === result.memoryId);
      expect(patternMemory).toBeDefined();
      expect(patternMemory?.type).toBe('code_pattern');
    });
    
    it('should handle pattern without code', async () => {
      const event = createMockEvent('pattern_detected', {
        pattern: 'Always validate inputs',
      });
      
      const result = await handler.handleEvent(event);
      
      expect(result.processed).toBe(true);
      
      const l3Results = await context.engine.l3.recall('validate inputs', 5);
      expect(l3Results.length).toBeGreaterThan(0);
    });
  });
  
  // ============================================================================
  // Event Type: user_feedback
  // ============================================================================
  
  describe('user_feedback event', () => {
    it('should create L3 relationship memory with rating', async () => {
      const event = createMockEvent('user_feedback', {
        feedback: 'Prefer shorter variable names',
        rating: 4,
      });
      
      const result = await handler.handleEvent(event);
      
      expect(result.processed).toBe(true);
      expect(result.triggeredActions).toContain('stored_feedback');
      
      const l3Results = await context.engine.l3.recall('shorter variable names', 5);
      const feedbackMemory = l3Results.find(r => r.id === result.memoryId);
      expect(feedbackMemory).toBeDefined();
      expect(feedbackMemory?.type).toBe('relationship');
      expect(feedbackMemory?.content).toContain('rating: 4');
    });
    
    it('should handle feedback without rating', async () => {
      const event = createMockEvent('user_feedback', {
        feedback: 'Dark mode is better',
      });
      
      const result = await handler.handleEvent(event);
      
      expect(result.processed).toBe(true);
      
      const l3Results = await context.engine.l3.recall('Dark mode', 5);
      const feedbackMemory = l3Results.find(r => r.id === result.memoryId);
      expect(feedbackMemory?.content).not.toContain('rating');
    });
  });
  
  // ============================================================================
  // Unknown Event Type
  // ============================================================================
  
  describe('unknown event type', () => {
    it('should return unprocessed for unknown event type', async () => {
      const event = {
        type: 'unknown_event' as const,
        payload: {},
        timestamp: new Date(),
        sessionId: generateSessionId(),
        cliType: 'kimi' as const,
      } as unknown as CLIEvent;
      
      const result = await handler.handleEvent(event);
      
      expect(result.processed).toBe(false);
      expect(result.message).toContain('Unknown event type');
      expect(result.triggeredActions).toHaveLength(0);
    });
  });
  
  // ============================================================================
  // Event Metadata
  // ============================================================================
  
  describe('event metadata', () => {
    it('should include sessionId in memory metadata', async () => {
      const sessionId = generateSessionId();
      const event = createMockEvent('file_opened', { path: '/test.ts' }, sessionId);
      
      const result = await handler.handleEvent(event);
      const memory = context.engine.l1.get(result.memoryId!);
      
      expect(memory?.metadata?.sessionId).toBe(sessionId);
    });
    
    it('should include cliType in memory metadata', async () => {
      const event = createMockEvent('file_opened', { path: '/test.ts' });
      event.cliType = 'codex';
      
      const result = await handler.handleEvent(event);
      const memory = context.engine.l1.get(result.memoryId!);
      
      expect(memory?.metadata?.cliType).toBe('codex');
    });
    
    it('should set source based on event type - auto events', async () => {
      const autoEvent = createMockEvent('file_opened', { path: '/test.ts' });
      const autoResult = await handler.handleEvent(autoEvent);
      const autoMemory = context.engine.l1.get(autoResult.memoryId!);
      expect(autoMemory?.metadata?.source).toBe('system_auto');
    });
    
    it('should set source based on event type - ai inferred events', async () => {
      const decisionEvent = createMockEvent('decision_made', { decision: 'test' });
      const decisionResult = await handler.handleEvent(decisionEvent);
      const decisionMemory = await context.engine.l2.get(decisionResult.memoryId!);
      expect(decisionMemory?.metadata?.source).toBe('ai_inferred');
    });
    
    it('should set source based on event type - user explicit events', async () => {
      const feedbackEvent = createMockEvent('user_feedback', { feedback: 'test' });
      const feedbackResult = await handler.handleEvent(feedbackEvent);
      await sleep(200);
      const feedbackMemories = await context.engine.l3.recall('test', 5);
      const feedbackMemory = feedbackMemories.find(m => m.id === feedbackResult.memoryId);
      expect(feedbackMemory?.metadata?.source).toBe('user_explicit');
    });
  });
  
  // ============================================================================
  // Event Batching (Multiple Events)
  // ============================================================================
  
  describe('event handling with multiple events', () => {
    it('should handle multiple events in sequence', async () => {
      const events = [
        createMockEvent('session_start', { projectPath: '/test', cliType: 'kimi' }),
        createMockEvent('file_opened', { path: '/test/file.ts' }),
        createMockEvent('decision_made', { decision: 'Use Vitest' }),
      ];
      
      const results: EventResult[] = [];
      for (const event of events) {
        results.push(await handler.handleEvent(event));
      }
      
      expect(results.every(r => r.processed)).toBe(true);
      
      // Check memories were stored
      expect(context.engine.l1.getAll().length).toBeGreaterThanOrEqual(2);
      expect((await context.engine.l2.getRecent(10)).length).toBeGreaterThanOrEqual(1);
    });
    
    it('should handle rapid successive events', async () => {
      const sessionId = generateSessionId();
      const promises = [];
      
      for (let i = 0; i < 10; i++) {
        promises.push(
          handler.handleEvent(
            createMockEvent('file_opened', { path: `/test/file${i}.ts` }, sessionId)
          )
        );
      }
      
      const results = await Promise.all(promises);
      
      expect(results.every(r => r.processed)).toBe(true);
      expect(results.every(r => r.memoryId)).toBe(true);
      
      // All memories should be in L1
      expect(context.engine.l1.getAll().length).toBe(10);
    });
  });
  
  // ============================================================================
  // Error Handling
  // ============================================================================
  
  describe('error capture', () => {
    it('should handle events with malformed payload gracefully', async () => {
      const event = createMockEvent('file_opened', {
        // Missing required 'path' but should still create memory
        content: null,
      });
      
      const result = await handler.handleEvent(event);
      
      // Should still process (path will be undefined)
      expect(result.processed).toBe(true);
    });
    
    it('should handle very long payloads', async () => {
      const event = createMockEvent('command_executed', {
        command: 'test',
        output: 'x'.repeat(100000),
      });
      
      const result = await handler.handleEvent(event);
      
      expect(result.processed).toBe(true);
    });
    
    it('should handle special characters in payload', async () => {
      const event = createMockEvent('error_occurred', {
        error: '<script>alert("xss")</script>',
        context: '{ "key": "value" }',
      });
      
      const result = await handler.handleEvent(event);
      
      expect(result.processed).toBe(true);
      
      const l2Memories = await context.engine.l2.getRecent(5);
      const errorMemory = l2Memories.find(m => m.id === result.memoryId);
      expect(errorMemory?.content).toContain('<script>');
    });
  });
});
