/**
 * Context Fabric - MCP Server for Agentic CLI Memory
 * 
 * Main exports for the library
 */

// Types
export * from './types.js';

// Layers
export { WorkingMemoryLayer } from './layers/working.js';
export { ProjectMemoryLayer } from './layers/project.js';
export { SemanticMemoryLayer, ScoredMemory } from './layers/semantic.js';

// Engine and Core
export { 
  ContextEngine, 
  type StoreOptions, 
  type RecallOptions, 
  type RankedMemory,
  type GhostResult,
  type SuggestedAction,
  type SummaryResult,
  type EngineOptions,
} from './engine.js';

// Router
export { 
  SmartRouter, 
  type RoutingCriteria, 
  type RoutingDecision,
} from './router.js';

// Patterns
export { 
  PatternExtractor, 
  type Violation, 
  type ExtractedPattern,
} from './patterns.js';

// Events
export { 
  EventHandler, 
  type EventResult,
} from './events.js';

// Embedding
export { EmbeddingService } from './embedding.js';

// Config
export { 
  getConfig, 
  initialize, 
  getStoragePaths, 
  getEmbeddingConfig, 
  getTTLConfig,
  resetConfigCache,
} from './config.js';

// Version
export const VERSION = '0.4.0';
