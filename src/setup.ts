/**
 * context.setup — self-configure Context Fabric into any supported CLI
 *
 * Reads the CLI's existing config, merges in the context-fabric MCP entry,
 * and writes it back. Safe to call multiple times (idempotent).
 *
 * Two transport modes:
 *   Local  — spawns `node dist/server.js` directly (requires Node.js 22.5+)
 *   Docker — spawns `docker run --rm -i ...` (cross-platform, no Node.js needed on host)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// ============================================================================
// Types
// ============================================================================

export type SupportedCLI =
  | 'opencode'
  | 'claude'
  | 'claude-code'
  | 'codex'
  | 'gemini'
  | 'cursor'
  | 'kimi'
  | 'docker'    // generic cross-platform Docker config snippet
  | 'generic';

export interface SetupResult {
  success: boolean;
  cli: SupportedCLI;
  configPath: string;
  message: string;
  snippet?: string;
  restartRequired: boolean;
}

// ============================================================================
// Server Path Detection
// ============================================================================

export function detectServerPath(): string {
  const argv1 = process.argv[1];
  if (argv1) return path.resolve(argv1);
  return path.join(process.cwd(), 'dist', 'server.js');
}

// ============================================================================
// Docker image name (single source of truth)
// ============================================================================

const DOCKER_IMAGE = 'context-fabric';
const DOCKER_VOLUME = 'context-fabric-data';
// /data/.context-fabric matches ENV HOME=/data in the Dockerfile
const DOCKER_DATA_PATH = '/data/.context-fabric';

// ============================================================================
// Config Entry Generators — Local (node)
// ============================================================================

/** OpenCode: { type, command, enabled } */
function openCodeEntry(serverPath: string) {
  return {
    type: 'local' as const,
    command: ['node', serverPath],
    enabled: true,
  };
}

/** Standard stdio MCP entry — Claude Desktop, Kimi, Gemini, Cursor */
function stdMcpEntry(serverPath: string) {
  return {
    command: 'node',
    args: [serverPath],
  };
}

/** Claude Code CLI MCP entry */
function claudeCodeEntry(serverPath: string) {
  return {
    type: 'stdio' as const,
    command: 'node',
    args: [serverPath],
    env: {},
  };
}

/**
 * Codex TOML block.
 * Produces:
 *   [mcp_servers.context-fabric]
 *   command = "node"
 *   args = ["/path/to/server.js"]
 *   enabled = true
 */
function codexTomlBlock(serverPath: string): string {
  const escaped = serverPath.replace(/\\/g, '\\\\');
  return [
    '[mcp_servers.context-fabric]',
    'command = "node"',
    `args = ["${escaped}"]`,
    'enabled = true',
  ].join('\n');
}

// ============================================================================
// Config Entry Generators — Docker (cross-platform)
// ============================================================================

const dockerArgs = [
  'run', '--rm', '-i',
  '-v', `${DOCKER_VOLUME}:${DOCKER_DATA_PATH}`,
  DOCKER_IMAGE,
];

/** OpenCode docker entry */
function openCodeDockerEntry() {
  return {
    type: 'local' as const,
    command: ['docker', ...dockerArgs],
    enabled: true,
  };
}

/** Standard stdio docker entry — Claude Desktop, Kimi, Gemini, Cursor */
function stdMcpDockerEntry() {
  return {
    command: 'docker',
    args: dockerArgs,
  };
}

/** Claude Code CLI docker entry */
function claudeCodeDockerEntry() {
  return {
    type: 'stdio' as const,
    command: 'docker',
    args: dockerArgs,
    env: {},
  };
}

/** Codex docker TOML block */
function codexDockerTomlBlock(): string {
  const argsToml = dockerArgs.map(a => `"${a}"`).join(', ');
  return [
    '[mcp_servers.context-fabric]',
    'command = "docker"',
    `args = [${argsToml}]`,
    'enabled = true',
  ].join('\n');
}

// ============================================================================
// JSON config helpers
// ============================================================================

function readJsonConfig(configPath: string): Record<string, unknown> | null {
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonConfig(configPath: string, config: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

/** Merge an entry into config.mcpServers and write. */
function setupStdJsonMcp(
  cli: SupportedCLI,
  configPath: string,
  entry: object,
  restartNote: string,
): SetupResult {
  const config = readJsonConfig(configPath);
  if (config === null) {
    return {
      success: false, cli, configPath, restartRequired: false,
      message: `Could not parse ${configPath} — check it is valid JSON.`,
    };
  }

  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
  servers['context-fabric'] = entry;
  config.mcpServers = servers;

  writeJsonConfig(configPath, config);

  return {
    success: true, cli, configPath, restartRequired: true,
    message: `context-fabric added to ${configPath}. ${restartNote}`,
  };
}

// ============================================================================
// Claude Code CLI  (~/.claude.json)
// ============================================================================

function claudeCodeConfigPath(): string {
  return path.join(os.homedir(), '.claude.json');
}

function setupClaudeCode(serverPath: string, docker: boolean): SetupResult {
  const configPath = claudeCodeConfigPath();
  const config = readJsonConfig(configPath);
  if (config === null) {
    return { success: false, cli: 'claude-code', configPath, restartRequired: false,
      message: `Could not parse ${configPath} — check it is valid JSON.` };
  }

  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
  servers['context-fabric'] = docker ? claudeCodeDockerEntry() : claudeCodeEntry(serverPath);
  config.mcpServers = servers;

  writeJsonConfig(configPath, config);

  const modeNote = docker
    ? 'Uses Docker (cross-platform). Ensure the image is built: docker build -t context-fabric .'
    : 'Uses local Node.js installation.';

  return {
    success: true, cli: 'claude-code', configPath, restartRequired: true,
    message: `context-fabric added to ${configPath}. ${modeNote} Restart Claude Code to apply.`,
  };
}

// ============================================================================
// OpenCode
// ============================================================================

function openCodeConfigPath(): string {
  return path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
}

function setupOpenCode(serverPath: string, docker: boolean): SetupResult {
  const configPath = openCodeConfigPath();
  const config = readJsonConfig(configPath);
  if (config === null) {
    return { success: false, cli: 'opencode', configPath, restartRequired: false,
      message: `Could not parse ${configPath} — check it is valid JSON.` };
  }

  const mcp = (config.mcp ?? {}) as Record<string, unknown>;
  mcp['context-fabric'] = docker ? openCodeDockerEntry() : openCodeEntry(serverPath);
  config.mcp = mcp;

  writeJsonConfig(configPath, config);

  return {
    success: true, cli: 'opencode', configPath, restartRequired: true,
    message: `context-fabric added to ${configPath}. Restart OpenCode to apply.`,
  };
}

// ============================================================================
// Claude Desktop
// ============================================================================

function claudeDesktopConfigPath(): string {
  switch (process.platform) {
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    case 'win32':
      return path.join(process.env.APPDATA ?? os.homedir(), 'Claude', 'claude_desktop_config.json');
    default:
      return path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
  }
}

function setupClaude(serverPath: string, docker: boolean): SetupResult {
  return setupStdJsonMcp(
    'claude',
    claudeDesktopConfigPath(),
    docker ? stdMcpDockerEntry() : stdMcpEntry(serverPath),
    'Restart Claude Desktop to apply.',
  );
}

// ============================================================================
// Kimi
// ============================================================================

function kimiConfigPath(): string {
  return path.join(os.homedir(), '.kimi', 'mcp.json');
}

function setupKimi(serverPath: string, docker: boolean): SetupResult {
  return setupStdJsonMcp(
    'kimi',
    kimiConfigPath(),
    docker ? stdMcpDockerEntry() : stdMcpEntry(serverPath),
    'Restart Kimi to apply.',
  );
}

// ============================================================================
// OpenAI Codex CLI  (~/.codex/config.toml)
// ============================================================================

function codexConfigPath(): string {
  return path.join(os.homedir(), '.codex', 'config.toml');
}

function upsertCodexSection(existing: string, block: string): string {
  const header = '[mcp_servers.context-fabric]';

  const sectionStart = existing.indexOf(header);
  if (sectionStart === -1) {
    const sep = existing.length > 0 && !existing.endsWith('\n\n') ? '\n\n' : '';
    return existing + sep + block + '\n';
  }

  const afterHeader = sectionStart + header.length;
  const nextSection = existing.slice(afterHeader).search(/\n\[(?!\[)/);
  const sectionEnd = nextSection === -1
    ? existing.length
    : afterHeader + nextSection;

  return existing.slice(0, sectionStart) + block + '\n' + existing.slice(sectionEnd).trimStart();
}

function setupCodex(serverPath: string, docker: boolean): SetupResult {
  const configPath = codexConfigPath();

  let existing = '';
  if (fs.existsSync(configPath)) {
    existing = fs.readFileSync(configPath, 'utf8');
  }

  const block = docker ? codexDockerTomlBlock() : codexTomlBlock(serverPath);
  const updated = upsertCodexSection(existing, block);

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, updated, 'utf8');

  return {
    success: true, cli: 'codex', configPath, restartRequired: true,
    message: `context-fabric added to ${configPath}. Restart Codex CLI to apply.`,
  };
}

// ============================================================================
// Google Gemini CLI  (~/.gemini/settings.json)
// ============================================================================

function geminiConfigPath(): string {
  return path.join(os.homedir(), '.gemini', 'settings.json');
}

function setupGemini(serverPath: string, docker: boolean): SetupResult {
  return setupStdJsonMcp(
    'gemini',
    geminiConfigPath(),
    docker ? stdMcpDockerEntry() : stdMcpEntry(serverPath),
    'Reload with /mcp enable context-fabric inside Gemini CLI, or restart.',
  );
}

// ============================================================================
// Cursor  (~/.cursor/mcp.json)
// ============================================================================

function cursorConfigPath(): string {
  return path.join(os.homedir(), '.cursor', 'mcp.json');
}

function setupCursor(serverPath: string, docker: boolean): SetupResult {
  return setupStdJsonMcp(
    'cursor',
    cursorConfigPath(),
    docker ? stdMcpDockerEntry() : stdMcpEntry(serverPath),
    'Save and Cursor will reload MCP tools automatically.',
  );
}

// ============================================================================
// Docker — return a generic cross-platform snippet (no file write)
// ============================================================================

function setupDocker(): SetupResult {
  const snippet = [
    '# Cross-platform stdio MCP entry (works on Linux, macOS, Windows)',
    '# Build the image first: docker build -t context-fabric .',
    '#',
    '# For JSON-based CLIs (Claude Desktop, Kimi, Gemini, Cursor):',
    JSON.stringify({ 'context-fabric': stdMcpDockerEntry() }, null, 2),
    '',
    '# For Claude Code (.claude.json):',
    JSON.stringify({ 'context-fabric': claudeCodeDockerEntry() }, null, 2),
    '',
    '# For OpenCode (~/.config/opencode/opencode.json) — add under "mcp":',
    JSON.stringify({ 'context-fabric': openCodeDockerEntry() }, null, 2),
    '',
    '# For Codex (~/.codex/config.toml):',
    codexDockerTomlBlock(),
  ].join('\n');

  return {
    success: true,
    cli: 'docker',
    configPath: '(manual)',
    restartRequired: true,
    message: 'Docker config snippets generated. Build the image first, then add the snippet for your CLI.',
    snippet,
  };
}

// ============================================================================
// Generic — return local snippet only (no file write)
// ============================================================================

function setupGeneric(serverPath: string): SetupResult {
  const snippet = JSON.stringify(
    { 'context-fabric': stdMcpEntry(serverPath) },
    null,
    2
  );

  return {
    success: true,
    cli: 'generic',
    configPath: '(manual)',
    restartRequired: true,
    message: "Add the following snippet to your MCP client's server config.",
    snippet,
  };
}

// ============================================================================
// Public entry points
// ============================================================================

/**
 * Configure context-fabric into the given CLI's MCP config.
 *
 * useDocker=true  → writes a `docker run --rm -i` entry (cross-platform,
 *                   requires the image to be built first)
 * useDocker=false → writes a `node dist/server.js` entry (local install)
 * cli='docker'    → returns Docker config snippets for ALL CLIs, no file write
 */
export function setupForCLI(cli: SupportedCLI, serverPathOverride?: string, useDocker = false): SetupResult {
  const serverPath = serverPathOverride ?? detectServerPath();

  switch (cli) {
    case 'opencode':    return setupOpenCode(serverPath, useDocker);
    case 'claude':      return setupClaude(serverPath, useDocker);
    case 'claude-code': return setupClaudeCode(serverPath, useDocker);
    case 'kimi':        return setupKimi(serverPath, useDocker);
    case 'codex':       return setupCodex(serverPath, useDocker);
    case 'gemini':      return setupGemini(serverPath, useDocker);
    case 'cursor':      return setupCursor(serverPath, useDocker);
    case 'docker':      return setupDocker();
    case 'generic':     return setupGeneric(serverPath);
    default:            return setupGeneric(serverPath);
  }
}

/**
 * Return the config snippet for a given CLI without writing anything.
 */
export function previewConfig(cli: SupportedCLI, serverPath?: string): string {
  const sp = serverPath ?? detectServerPath();

  switch (cli) {
    case 'opencode':
      return JSON.stringify({ 'context-fabric': openCodeEntry(sp) }, null, 2);
    case 'claude-code':
      return JSON.stringify({ 'context-fabric': claudeCodeEntry(sp) }, null, 2);
    case 'codex':
      return codexTomlBlock(sp);
    case 'docker':
      return setupDocker().snippet ?? '';
    case 'claude':
    case 'kimi':
    case 'gemini':
    case 'cursor':
    default:
      return JSON.stringify({ 'context-fabric': stdMcpEntry(sp) }, null, 2);
  }
}
