/**
 * Configuration manager for Context Fabric
 * Loads from ~/.context-fabric/config.yaml with sensible defaults
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import YAML from "js-yaml";
import type { FabricConfig, UserPreferences } from "./types.js";

const CONFIG_DIR = join(homedir(), ".context-fabric");
const CONFIG_FILE = join(CONFIG_DIR, "config.yaml");
const DEFAULT_L2_PATH = join(CONFIG_DIR, "l2-project.db");
const DEFAULT_L3_PATH = join(CONFIG_DIR, "l3-semantic");

const DEFAULT_USER_PREFERENCES: UserPreferences = {
  autoCapturePatterns: true,
  autoCaptureDecisions: true,
  scratchpadRetentionHours: 24,
  maxContextMemories: 20,
  preferredEmbeddingModel: "fastembed-js",
};

const DEFAULT_CONFIG: FabricConfig = {
  storage: {
    l2Path: DEFAULT_L2_PATH,
    l3Path: DEFAULT_L3_PATH,
    backupIntervalHours: 24,
  },
  ttl: {
    l1Default: 3600, // 1 hour in seconds
    l3DecayDays: 14,
    l3AccessThreshold: 3,
    l3DecayThreshold: 0.2,
  },
  embedding: {
    model: "Xenova/all-MiniLM-L6-v2",
    dimension: 384,
    batchSize: 32,
    timeoutMs: 30_000, // 30 seconds — prevents ONNX from hanging the MCP process
  },
  context: {
    maxWorkingMemories: 10,
    maxRelevantMemories: 10,
    maxPatterns: 5,
    maxSuggestions: 5,
    maxGhostMessages: 5,
  },
  cli: {
    defaultCapabilities: DEFAULT_USER_PREFERENCES,
  },
  codeIndex: {
    enabled: true,
    maxFileSizeBytes: 1_048_576, // 1MB
    maxFiles: 10_000,
    chunkLines: 150,
    chunkOverlap: 10,
    debounceMs: 500,
    watchEnabled: true,
    excludePatterns: [],
  },
};

/**
 * Generate default config file content
 */
function generateDefaultConfigYaml(): string {
  return `# Context Fabric Configuration
# Generated automatically - modify as needed

storage:
  l2Path: ${DEFAULT_L2_PATH}
  l3Path: ${DEFAULT_L3_PATH}
  backupIntervalHours: 24

ttl:
  l1Default: 3600       # 1 hour in seconds
  l3DecayDays: 14       # L3 memories decay over 14 days (aggressive — use context.update pinned:true to exempt)
  l3AccessThreshold: 3
  l3DecayThreshold: 0.2 # relevance score below which an L3 memory is deleted

embedding:
  model: "Xenova/all-MiniLM-L6-v2"
  dimension: 384
  batchSize: 32

context:
  maxWorkingMemories: 10
  maxRelevantMemories: 10
  maxPatterns: 5
  maxSuggestions: 5
  maxGhostMessages: 3

cli:
  defaultCapabilities:
    autoCapturePatterns: true
    autoCaptureDecisions: true
    scratchpadRetentionHours: 24
    maxContextMemories: 20
    preferredEmbeddingModel: "fastembed-js"

codeIndex:
  enabled: true
  maxFileSizeBytes: 1048576  # 1MB
  maxFiles: 10000
  chunkLines: 150
  chunkOverlap: 10
  debounceMs: 500
  watchEnabled: true
  excludePatterns: []
`;
}

/**
 * Ensure the config directory and default config file exist
 */
export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  if (!existsSync(CONFIG_FILE)) {
    const yaml = generateDefaultConfigYaml();
    writeFileSync(CONFIG_FILE, yaml, "utf-8");
  }

  // Ensure storage directories exist
  const config = loadConfig();
  const l3Dir = config.storage.l3Path;
  if (!existsSync(l3Dir)) {
    mkdirSync(l3Dir, { recursive: true });
  }
}

/**
 * Load configuration from file or return defaults
 */
export function loadConfig(): FabricConfig {
  if (!existsSync(CONFIG_FILE)) {
    return DEFAULT_CONFIG;
  }

  try {
    const content = readFileSync(CONFIG_FILE, "utf-8");
    const parsed = YAML.load(content) as Partial<FabricConfig>;

    return mergeConfig(DEFAULT_CONFIG, parsed);
  } catch (error) {
    console.warn(
      `Warning: Failed to load config from ${CONFIG_FILE}, using defaults:`,
      error
    );
    return DEFAULT_CONFIG;
  }
}

/**
 * Merge partial config with defaults
 */
function mergeConfig(
  defaults: FabricConfig,
  override: Partial<FabricConfig>
): FabricConfig {
  return {
    storage: { ...defaults.storage, ...override.storage },
    ttl: { ...defaults.ttl, ...override.ttl },
    embedding: { ...defaults.embedding, ...override.embedding },
    context: { ...defaults.context, ...override.context },
    cli: {
      defaultCapabilities: {
        ...defaults.cli.defaultCapabilities,
        ...override.cli?.defaultCapabilities,
      },
    },
    codeIndex: { ...defaults.codeIndex, ...override.codeIndex },
  };
}

/**
 * Get config singleton
 */
let configInstance: FabricConfig | null = null;

export function getConfig(): FabricConfig {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

/**
 * Reset config cache (useful for testing)
 */
export function resetConfigCache(): void {
  configInstance = null;
}

/**
 * Get specific config paths
 */
export function getStoragePaths(): { l2Path: string; l3Path: string } {
  const config = getConfig();
  return {
    l2Path: config.storage.l2Path,
    l3Path: config.storage.l3Path,
  };
}

/**
 * Get embedding configuration
 */
export function getEmbeddingConfig(): FabricConfig["embedding"] {
  return getConfig().embedding;
}

/**
 * Get TTL configuration
 */
export function getTTLConfig(): FabricConfig["ttl"] {
  return getConfig().ttl;
}

/**
 * Initialize configuration
 * Creates directories and default config if needed
 */
export function initialize(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  if (!existsSync(CONFIG_FILE)) {
    const yaml = generateDefaultConfigYaml();
    writeFileSync(CONFIG_FILE, yaml, "utf-8");
  }

  // Ensure L3 storage directory exists
  const config = getConfig();
  if (!existsSync(config.storage.l3Path)) {
    mkdirSync(config.storage.l3Path, { recursive: true });
  }
}

// Auto-initialize when imported in Node.js/Bun environment
if (typeof process !== "undefined") {
  try {
    initialize();
  } catch (err) {
    console.warn("Failed to auto-initialize config:", err);
  }
}
