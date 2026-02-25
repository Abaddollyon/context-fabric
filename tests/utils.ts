/**
 * Test utilities for context-fabric
 * Provides setup/cleanup helpers, mock data generators, and test helpers
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { Memory, MemoryType, MemoryLayer, MemoryMetadata, CLIEvent, CLIEventType, CLICapability, ContextWindow } from '../src/types.js';
import { ContextEngine } from '../src/engine.js';
import { resetConfigCache } from '../src/config.js';

// ============================================================================
// Types
// ============================================================================

export interface TestContext {
  projectPath: string;
  engine: ContextEngine;
  sessionId: string;
  cleanup: () => Promise<void>;
}

export interface MockMemoryOptions {
  type?: MemoryType;
  layer?: MemoryLayer;
  content?: string;
  tags?: string[];
  metadata?: Partial<MemoryMetadata>;
  ttl?: number;
}

// ============================================================================
// Temporary Directory Helpers
// ============================================================================

/**
 * Create a temporary directory for testing
 */
export function createTempDir(prefix: string = 'context-fabric-test-'): string {
  const tempDir = path.join(os.tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

/**
 * Remove a directory recursively
 */
export function removeDir(dirPath: string): void {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

/**
 * Clean up all test artifacts
 */
export async function cleanupTestEnvironment(tempDirs: string[]): Promise<void> {
  for (const dir of tempDirs) {
    removeDir(dir);
  }
  // Reset config cache to avoid pollution between tests
  resetConfigCache();
}

// ============================================================================
// Mock Data Generators
// ============================================================================

/**
 * Generate a unique session ID
 */
export function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create a mock memory object
 */
export function createMockMemory(options: MockMemoryOptions = {}): Memory {
  const now = new Date();
  const id = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  
  return {
    id,
    type: options.type || 'code_pattern',
    layer: options.layer,
    content: options.content || 'Mock memory content',
    metadata: {
      tags: options.tags || ['test', 'mock'],
      relationships: [],
      confidence: 0.8,
      source: 'ai_inferred',
      cliType: 'generic',
      projectPath: '/test/project',
      ...options.metadata,
    } as MemoryMetadata,
    tags: options.tags || ['test', 'mock'],
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
    ttl: options.ttl,
  };
}

/**
 * Create mock code pattern content
 */
export function createMockCodePattern(language: string = 'typescript'): string {
  const patterns: Record<string, string> = {
    typescript: `
export function validateInput<T>(input: unknown, validator: (val: unknown) => val is T): T {
  if (!validator(input)) {
    throw new Error('Invalid input');
  }
  return input;
}
    `.trim(),
    python: `
def validate_input(data, validator):
    if not validator(data):
        raise ValueError("Invalid input")
    return data
    `.trim(),
    rust: `
pub fn validate_input<T>(input: T) -> Result<T, Error> {
    if is_valid(&input) {
        Ok(input)
    } else {
        Err(Error::new("Invalid input"))
    }
}
    `.trim(),
  };
  
  return patterns[language] || patterns.typescript;
}

/**
 * Create mock bug fix content
 */
export function createMockBugFix(): string {
  return `
Bug: Race condition in async data loading
Fix: Added mutex lock around shared state access

Before:
async function loadData() {
  sharedState.data = await fetchData();
}

After:
async function loadData() {
  await mutex.acquire();
  try {
    sharedState.data = await fetchData();
  } finally {
    mutex.release();
  }
}
  `.trim();
}

/**
 * Create mock decision content
 */
export function createMockDecision(): string {
  return `
Decision: Use SQLite for L2 storage instead of JSON files

Rationale:
- ACID compliance for data integrity
- Better query performance for large datasets
- Built-in indexing capabilities
- Smaller memory footprint

Date: ${new Date().toISOString()}
Status: Active
  `.trim();
}

/**
 * Create mock scratchpad content
 */
export function createMockScratchpad(): string {
  return `Session notes: Currently working on authentication module. Need to implement JWT refresh tokens.`;
}

/**
 * Create a mock CLI event
 */
export function createMockEvent(
  type: CLIEventType,
  payload: Record<string, unknown> = {},
  sessionId?: string
): CLIEvent {
  return {
    type,
    payload,
    timestamp: new Date(),
    sessionId: sessionId || generateSessionId(),
    cliType: 'kimi',
    projectPath: '/test/project',
  };
}

/**
 * Create mock CLI capabilities
 */
export function createMockCLICapabilities(): CLICapability {
  return {
    cliType: 'kimi',
    version: '1.0.0',
    maxContextTokens: 8000,
    supportedFeatures: ['context_fabric', 'ghost_messages', 'pattern_extraction'],
    preferences: {
      autoCapturePatterns: true,
      autoCaptureDecisions: true,
      scratchpadRetentionHours: 24,
      maxContextMemories: 20,
      preferredEmbeddingModel: 'fastembed-js',
    },
  };
}

// ============================================================================
// Context Engine Test Helpers
// ============================================================================

/**
 * Create a test context with isolated engine
 */
export async function createTestContext(options: {
  projectPath?: string;
  autoCleanup?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
} = {}): Promise<TestContext> {
  const projectPath = options.projectPath || createTempDir();
  const sessionId = generateSessionId();

  // Ensure project directory exists
  if (!fs.existsSync(projectPath)) {
    fs.mkdirSync(projectPath, { recursive: true });
  }

  const engine = new ContextEngine({
    projectPath,
    autoCleanup: options.autoCleanup ?? false,
    logLevel: options.logLevel || 'error',
    isEphemeral: true, // use in-memory L3 to avoid concurrent SQLite conflicts
  });
  
  const tempDirs = [projectPath];
  
  return {
    projectPath,
    engine,
    sessionId,
    cleanup: async () => {
      // Wait for any pending operations
      await sleep(100);
      engine.close();
      await sleep(100);
      await cleanupTestEnvironment(tempDirs);
    },
  };
}

/**
 * Seed memories across all layers for testing
 */
export async function seedTestMemories(
  engine: ContextEngine,
  sessionId: string
): Promise<{
  l1Memories: Memory[];
  l2Memories: Memory[];
  l3Memories: Memory[];
}> {
  // L1: Working memories (scratchpad entries)
  const l1Memories: Memory[] = [];
  for (let i = 0; i < 3; i++) {
    const memory = await engine.store(
      `Working note ${i + 1}: ${createMockScratchpad()}`,
      'scratchpad',
      {
        layer: MemoryLayer.L1_WORKING,
        tags: ['test', 'scratchpad', `note-${i + 1}`],
        ttl: 3600,
        metadata: {
          sessionId,
          cliType: 'kimi',
        },
      }
    );
    l1Memories.push(memory);
  }
  
  // L2: Project memories (decisions and bug fixes)
  const l2Memories: Memory[] = [];
  const decision = await engine.store(
    createMockDecision(),
    'decision',
    {
      layer: MemoryLayer.L2_PROJECT,
      tags: ['test', 'decision', 'architecture'],
      metadata: {
        cliType: 'kimi',
        title: 'Storage Architecture Decision',
      },
    }
  );
  l2Memories.push(decision);
  
  const bugFix = await engine.store(
    createMockBugFix(),
    'bug_fix',
    {
      layer: MemoryLayer.L2_PROJECT,
      tags: ['test', 'bug_fix', 'async'],
      metadata: {
        cliType: 'kimi',
        title: 'Race Condition Fix',
      },
    }
  );
  l2Memories.push(bugFix);
  
  // L3: Semantic memories (code patterns)
  const l3Memories: Memory[] = [];
  for (let i = 0; i < 3; i++) {
    const memory = await engine.store(
      createMockCodePattern(['typescript', 'python', 'rust'][i]),
      'code_pattern',
      {
        layer: MemoryLayer.L3_SEMANTIC,
        tags: ['test', 'pattern', 'global'],
        metadata: {
          cliType: 'kimi',
          title: `Pattern ${i + 1}`,
        },
      }
    );
    l3Memories.push(memory);
  }
  
  return { l1Memories, l2Memories, l3Memories };
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Validate that a memory has required fields
 */
export function assertValidMemory(memory: Memory): void {
  if (!memory.id) throw new Error('Memory missing id');
  if (!memory.type) throw new Error('Memory missing type');
  if (!memory.content) throw new Error('Memory missing content');
  if (!memory.createdAt) throw new Error('Memory missing createdAt');
  if (!memory.updatedAt) throw new Error('Memory missing updatedAt');
}

/**
 * Validate context window structure
 */
export function assertValidContextWindow(context: ContextWindow): void {
  if (!Array.isArray(context.working)) throw new Error('Context working not an array');
  if (!Array.isArray(context.relevant)) throw new Error('Context relevant not an array');
  if (!Array.isArray(context.patterns)) throw new Error('Context patterns not an array');
  if (!Array.isArray(context.suggestions)) throw new Error('Context suggestions not an array');
  if (!Array.isArray(context.ghostMessages)) throw new Error('Context ghostMessages not an array');
}

// ============================================================================
// Timing Helpers
// ============================================================================

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait for a condition to be true (with timeout)
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number = 5000,
  intervalMs: number = 100
): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    if (await condition()) {
      return;
    }
    await sleep(intervalMs);
  }
  
  throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
}

// ============================================================================
// Export all utilities
// ============================================================================

export default {
  createTempDir,
  removeDir,
  cleanupTestEnvironment,
  generateSessionId,
  createMockMemory,
  createMockCodePattern,
  createMockBugFix,
  createMockDecision,
  createMockScratchpad,
  createMockEvent,
  createMockCLICapabilities,
  createTestContext,
  seedTestMemories,
  assertValidMemory,
  assertValidContextWindow,
  sleep,
  waitFor,
};
