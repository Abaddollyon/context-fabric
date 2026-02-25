/**
 * Context Fabric - Basic Usage Example
 * 
 * This example demonstrates how to use Context Fabric programmatically
 * without the MCP server.
 */

import {
  ContextEngine,
  MemoryLayer,
  WorkingMemoryLayer,
  ProjectMemoryLayer,
  SemanticMemoryLayer,
  SmartRouter,
  initialize,
} from '../src/index.js';

// ============================================================================
// Example 1: Basic Context Engine Usage
// ============================================================================

async function basicContextEngineExample() {
  console.log('=== Example 1: Context Engine ===\n');

  // Initialize configuration (creates ~/.context-fabric if needed)
  initialize();

  // Create a context engine for your project
  const engine = new ContextEngine({
    projectPath: '/path/to/your/project',
    autoCleanup: true,
    logLevel: 'info',
  });

  // Store different types of memories
  
  // L1: Working memory (temporary scratchpad)
  await engine.store(
    'Remember to refactor the auth middleware',
    'scratchpad',
    { ttl: 3600 } // expires in 1 hour
  );

  // L2: Project memory (bug fix)
  await engine.store(
    'Fixed null pointer in user service by adding optional chaining operator',
    'bug_fix',
    {
      metadata: {
        title: 'User service null fix',
        tags: ['bug', 'user-service', 'null-safety'],
        fileContext: {
          path: 'src/services/user.ts',
          lineStart: 45,
          lineEnd: 52,
        },
        confidence: 0.95,
      },
    }
  );

  // L3: Semantic memory (code pattern)
  await engine.store(
    'Use Result<T,E> type for error handling instead of throwing exceptions. ' +
    'This makes error handling explicit and composable.',
    'code_pattern',
    {
      metadata: {
        title: 'Result Type Pattern',
        tags: ['typescript', 'error-handling', 'pattern'],
        codeBlock: {
          code: `type Result<T, E> = 
  | { ok: true; value: T }
  | { ok: false; error: E };

function divide(a: number, b: number): Result<number, string> {
  if (b === 0) return { ok: false, error: 'Division by zero' };
  return { ok: true, value: a / b };
}`,
          language: 'typescript',
        },
        confidence: 0.9,
      },
    }
  );

  // Get current context window
  const context = await engine.getContextWindow();
  console.log('Context Window:');
  console.log(`  Working memories: ${context.working.length}`);
  console.log(`  Relevant memories: ${context.relevant.length}`);
  console.log(`  Patterns: ${context.patterns.length}`);
  console.log(`  Suggestions: ${context.suggestions.length}`);
  console.log(`  Ghost messages: ${context.ghostMessages.length}`);

  // Recall memories semantically
  const results = await engine.recall('error handling pattern', {
    limit: 5,
    layers: [MemoryLayer.L2_PROJECT, MemoryLayer.L3_SEMANTIC],
  });

  console.log('\nRecall Results:');
  for (const result of results) {
    console.log(`  [L${result.layer}] ${result.type} (similarity: ${result.similarity.toFixed(2)})`);
    console.log(`    ${result.content.substring(0, 100)}...`);
  }

  // Clean up
  engine.close();
  console.log('\n✓ Example 1 complete\n');
}

// ============================================================================
// Example 2: Direct Layer Usage
// ============================================================================

async function directLayerExample() {
  console.log('=== Example 2: Direct Layer Usage ===\n');

  // L1: Working Memory
  const l1 = new WorkingMemoryLayer({
    maxSize: 100,
    defaultTTL: 1800, // 30 minutes
  });

  const memory1 = l1.store(
    'Current task: Implement user authentication',
    'scratchpad',
    { tags: ['auth', 'current-task'] },
    3600 // 1 hour TTL
  );

  console.log('L1 Memory stored:', memory1.id);
  console.log('L1 Size:', l1.size());

  // Get all working memories
  const workingMemories = l1.getAll();
  console.log('Working memories:', workingMemories.length);

  // L2: Project Memory (SQLite-backed)
  const l2 = new ProjectMemoryLayer('/tmp/example-project');

  const memory2 = await l2.store(
    'Decision: Use PostgreSQL instead of MongoDB for transactional integrity',
    'decision',
    {
      title: 'Database choice',
      tags: ['database', 'architecture', 'postgres'],
    },
    ['database', 'architecture']
  );

  console.log('\nL2 Memory stored:', memory2.id);

  // Search project memory
  const searchResults = await l2.search('database');
  console.log('Search results:', searchResults.length);

  // Get by tags
  const taggedMemories = await l2.findByTags(['architecture']);
  console.log('Tagged memories:', taggedMemories.length);

  // L3: Semantic Memory (ChromaDB-backed)
  // Note: Requires ChromaDB to be running
  const l3 = new SemanticMemoryLayer({
    baseDir: '/tmp/semantic-memory',
    decayDays: 30,
    collectionName: 'example_memories',
    chromaUrl: process.env.CHROMA_URL, // Optional: for external ChromaDB
  });

  try {
    const memory3 = await l3.store(
      'Dependency Injection pattern: Constructor injection is preferred over ' +
      'property injection for better testability and immutability.',
      'code_pattern',
      {
        title: 'Constructor Injection Pattern',
        tags: ['di', 'pattern', 'testing'],
        language: 'typescript',
      }
    );

    console.log('\nL3 Memory stored:', memory3.id);

    // Semantic search
    const similar = await l3.recall('how to handle dependencies in tests', 3);
    console.log('Semantic search results:', similar.length);
    for (const result of similar) {
      console.log(`  Similarity: ${result.similarity.toFixed(2)}`);
    }
  } catch (error) {
    console.log('\nL3 example skipped (ChromaDB not available)');
  }

  // Clean up
  l1.clear();
  l2.close();
  l3.close();

  console.log('\n✓ Example 2 complete\n');
}

// ============================================================================
// Example 3: Smart Router
// ============================================================================

async function smartRouterExample() {
  console.log('=== Example 3: Smart Router ===\n');

  // SmartRouter automatically determines the best layer for content

  // Example 1: Scratchpad → L1
  const decision1 = SmartRouter.route(
    'Quick note about the API endpoint',
    'scratchpad',
    {},
    [],
    undefined
  );
  console.log('Scratchpad routing:', SmartRouter.explainRouting(decision1));

  // Example 2: Code pattern → L3
  const decision2 = SmartRouter.route(
    'export const validateEmail = (email: string): boolean => { ... }',
    'code_pattern',
    {},
    [],
    undefined
  );
  console.log('Pattern routing:', SmartRouter.explainRouting(decision2));

  // Example 3: Bug fix → L2
  const decision3 = SmartRouter.route(
    'Fixed race condition in user cache by adding mutex lock',
    'bug_fix',
    { fileContext: { path: 'src/cache.ts' } },
    [],
    undefined
  );
  console.log('Bug fix routing:', SmartRouter.explainRouting(decision3));

  // Example 4: Tagged as temp → L1
  const decision4 = SmartRouter.route(
    'Meeting notes from standup',
    'documentation',
    {},
    ['temp', 'meeting'],
    undefined
  );
  console.log('Tagged temp routing:', SmartRouter.explainRouting(decision4));

  // Example 5: Tagged as global → L3
  const decision5 = SmartRouter.route(
    'Always use strict equality (===) instead of loose equality (==)',
    'convention',
    {},
    ['global', 'javascript', 'best-practice'],
    undefined
  );
  console.log('Tagged global routing:', SmartRouter.explainRouting(decision5));

  // Example 6: With TTL → L1
  const decision6 = SmartRouter.route(
    'Temporary workaround for API rate limiting',
    'code',
    {},
    [],
    7200 // 2 hour TTL
  );
  console.log('TTL routing:', SmartRouter.explainRouting(decision6));

  console.log('\n✓ Example 3 complete\n');
}

// ============================================================================
// Example 4: Event Handling
// ============================================================================

async function eventHandlingExample() {
  console.log('=== Example 4: Event Handling ===\n');

  const engine = new ContextEngine({
    projectPath: '/tmp/example-project',
    logLevel: 'warn',
  });

  // Simulate CLI events

  // File opened event
  const fileEvent = await engine.handleEvent({
    type: 'file_opened',
    payload: {
      path: 'src/auth/middleware.ts',
      language: 'typescript',
    },
    timestamp: new Date(),
    sessionId: 'example-session',
    cliType: 'kimi',
  });
  console.log('File event processed:', fileEvent.processed);

  // Error occurred event
  const errorEvent = await engine.handleEvent({
    type: 'error_occurred',
    payload: {
      error: 'TypeError: Cannot read property \'id\' of undefined',
      stack: 'at UserService.getUser (src/services/user.ts:42)',
      file: 'src/services/user.ts',
      line: 42,
    },
    timestamp: new Date(),
    sessionId: 'example-session',
    cliType: 'kimi',
  });
  console.log('Error event processed:', errorEvent.processed);
  if (errorEvent.memoryId) {
    console.log('Error stored as memory:', errorEvent.memoryId);
  }

  // Decision made event
  const decisionEvent = await engine.handleEvent({
    type: 'decision_made',
    payload: {
      decision: 'Use Redis for session storage',
      rationale: 'Better performance than file-based sessions',
      alternatives: ['File storage', 'Database storage'],
    },
    timestamp: new Date(),
    sessionId: 'example-session',
    cliType: 'kimi',
  });
  console.log('Decision event processed:', decisionEvent.processed);

  // Get ghost messages
  const ghostResult = await engine.ghost();
  console.log('\nGhost messages:', ghostResult.messages.length);
  for (const msg of ghostResult.messages) {
    console.log(`  [${msg.trigger}] ${msg.content.substring(0, 80)}...`);
  }

  console.log('Suggested actions:', ghostResult.suggestedActions.length);

  engine.close();
  console.log('\n✓ Example 4 complete\n');
}

// ============================================================================
// Example 5: Memory Promotion
// ============================================================================

async function memoryPromotionExample() {
  console.log('=== Example 5: Memory Promotion ===\n');

  const engine = new ContextEngine({
    projectPath: '/tmp/example-project',
    logLevel: 'warn',
  });

  // Store a memory in L1 (working)
  const l1Memory = await engine.store(
    'Found a neat trick with TypeScript mapped types',
    'code_pattern',
    { layer: MemoryLayer.L1_WORKING }
  );
  console.log('Stored in L1:', l1Memory.id);

  // Later, decide it's valuable enough for L2
  const l2Memory = await engine.promote(l1Memory.id, MemoryLayer.L1_WORKING);
  console.log('Promoted to L2:', l2Memory.id);

  // Even later, promote to L3 as a global pattern
  const l3Memory = await engine.promote(l2Memory.id, MemoryLayer.L2_PROJECT);
  console.log('Promoted to L3:', l3Memory.id);

  console.log('\nMemory lifecycle: L1 → L2 → L3');
  console.log('(Working → Project → Semantic)');

  engine.close();
  console.log('\n✓ Example 5 complete\n');
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('Context Fabric - Basic Usage Examples\n');
  console.log('=====================================\n');

  try {
    await basicContextEngineExample();
    await directLayerExample();
    await smartRouterExample();
    await eventHandlingExample();
    await memoryPromotionExample();

    console.log('=====================================');
    console.log('All examples completed successfully!');
  } catch (error) {
    console.error('Example failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export {
  basicContextEngineExample,
  directLayerExample,
  smartRouterExample,
  eventHandlingExample,
  memoryPromotionExample,
};
