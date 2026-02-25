import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CodeIndex } from '../../src/indexer/code-index.js';
import type { FabricConfig } from '../../src/types.js';

const DEFAULT_CODE_INDEX_CONFIG: FabricConfig['codeIndex'] = {
  enabled: true,
  maxFileSizeBytes: 1_048_576,
  maxFiles: 10_000,
  chunkLines: 150,
  chunkOverlap: 10,
  debounceMs: 500,
  watchEnabled: false,
  excludePatterns: [],
};

function createTempProject(): string {
  const dir = join(tmpdir(), `code-index-integ-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('CodeIndex Integration', () => {
  let tempDir: string;
  let codeIndex: CodeIndex;

  beforeEach(() => {
    tempDir = createTempProject();
  });

  afterEach(() => {
    codeIndex?.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should build a full index and search across multiple files', async () => {
    // Create a mini project
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    mkdirSync(join(tempDir, 'src/services'), { recursive: true });

    writeFileSync(join(tempDir, 'src/index.ts'), `
export { AuthService } from './services/auth.js';
export { UserService } from './services/user.js';
`);

    writeFileSync(join(tempDir, 'src/services/auth.ts'), `
/**
 * AuthService handles authentication and token management.
 */
export class AuthService {
  private secret: string;

  constructor(secret: string) {
    this.secret = secret;
  }

  /**
   * Verify a JWT token.
   */
  verifyToken(token: string): boolean {
    return token.startsWith('valid_');
  }

  /**
   * Create a new session token.
   */
  createToken(userId: string): string {
    return 'valid_' + userId + '_' + Date.now();
  }
}
`);

    writeFileSync(join(tempDir, 'src/services/user.ts'), `
export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
}

export class UserService {
  private users: Map<string, User> = new Map();

  createUser(name: string, email: string): User {
    const user: User = {
      id: crypto.randomUUID(),
      name,
      email,
      role: 'user',
    };
    this.users.set(user.id, user);
    return user;
  }

  findUser(id: string): User | undefined {
    return this.users.get(id);
  }

  listUsers(): User[] {
    return Array.from(this.users.values());
  }
}
`);

    codeIndex = new CodeIndex({
      projectPath: tempDir,
      embeddingService: null,
      config: DEFAULT_CODE_INDEX_CONFIG,
      isEphemeral: true,
    });

    // Run incremental update (full scan since empty)
    await codeIndex.incrementalUpdate();

    // Verify status
    const status = codeIndex.getStatus();
    expect(status.totalFiles).toBe(3);
    expect(status.totalSymbols).toBeGreaterThan(5);
    expect(status.totalChunks).toBeGreaterThan(0);
    expect(status.lastIndexedAt).not.toBeNull();

    // Text search
    const textResults = codeIndex.searchText('verifyToken');
    expect(textResults.length).toBeGreaterThan(0);
    expect(textResults[0].filePath).toContain('auth.ts');

    // Symbol search
    const symbolResults = codeIndex.searchSymbols('UserService');
    expect(symbolResults.length).toBeGreaterThan(0);
    expect(symbolResults[0].symbol?.kind).toBe('class');

    // Search by kind
    const interfaces = codeIndex.searchSymbols('', { symbolKind: 'interface' });
    expect(interfaces.length).toBeGreaterThan(0);
    expect(interfaces.some(r => r.symbol?.name === 'User')).toBe(true);

    // Search functions
    const functions = codeIndex.searchSymbols('create', { symbolKind: 'method' });
    expect(functions.length).toBeGreaterThan(0);
  });

  it('should handle incremental updates after file changes', async () => {
    writeFileSync(join(tempDir, 'app.ts'), 'export const version = "1.0.0";');

    codeIndex = new CodeIndex({
      projectPath: tempDir,
      embeddingService: null,
      config: DEFAULT_CODE_INDEX_CONFIG,
      isEphemeral: true,
    });

    await codeIndex.incrementalUpdate();
    expect(codeIndex.getStatus().totalFiles).toBe(1);

    // Add a new file
    writeFileSync(join(tempDir, 'utils.ts'), `
export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
`);

    // Modify existing file (with small delay to ensure mtime differs)
    await new Promise(r => setTimeout(r, 50));
    writeFileSync(join(tempDir, 'app.ts'), `
export const version = "2.0.0";
export function getVersion(): string {
  return version;
}
`);

    await codeIndex.incrementalUpdate();

    expect(codeIndex.getStatus().totalFiles).toBe(2);
    const results = codeIndex.searchSymbols('capitalize');
    expect(results.length).toBeGreaterThan(0);

    const versionResults = codeIndex.searchSymbols('getVersion');
    expect(versionResults.length).toBeGreaterThan(0);
  });

  it('should handle file deletion during incremental update', async () => {
    writeFileSync(join(tempDir, 'keep.ts'), 'export const keep = true;');
    writeFileSync(join(tempDir, 'remove.ts'), 'export const remove = true;');

    codeIndex = new CodeIndex({
      projectPath: tempDir,
      embeddingService: null,
      config: DEFAULT_CODE_INDEX_CONFIG,
      isEphemeral: true,
    });

    await codeIndex.incrementalUpdate();
    expect(codeIndex.getStatus().totalFiles).toBe(2);

    // Delete one file
    rmSync(join(tempDir, 'remove.ts'));

    await codeIndex.incrementalUpdate();
    expect(codeIndex.getStatus().totalFiles).toBe(1);

    // Searching for removed content should return no results
    const results = codeIndex.searchText('remove');
    expect(results.length).toBe(0);
  });

  it('should handle mixed language project', async () => {
    mkdirSync(join(tempDir, 'backend'), { recursive: true });
    mkdirSync(join(tempDir, 'frontend'), { recursive: true });

    writeFileSync(join(tempDir, 'backend/server.py'), `
from flask import Flask

app = Flask(__name__)

def create_app():
    """Create and configure the Flask app."""
    return app

class APIHandler:
    def handle_request(self, request):
        return {"status": "ok"}
`);

    writeFileSync(join(tempDir, 'frontend/App.tsx'), `
import React from 'react';

interface AppProps {
  title: string;
}

export function App({ title }: AppProps): JSX.Element {
  return <h1>{title}</h1>;
}

export default App;
`);

    codeIndex = new CodeIndex({
      projectPath: tempDir,
      embeddingService: null,
      config: DEFAULT_CODE_INDEX_CONFIG,
      isEphemeral: true,
    });

    await codeIndex.incrementalUpdate();

    const status = codeIndex.getStatus();
    expect(status.totalFiles).toBe(2);

    // Search Python symbols
    const pyResults = codeIndex.searchSymbols('create_app', { language: 'python' });
    expect(pyResults.length).toBeGreaterThan(0);

    // Search TypeScript symbols
    const tsResults = codeIndex.searchSymbols('App', { language: 'typescript' });
    expect(tsResults.length).toBeGreaterThan(0);

    // Search with file pattern
    const backendResults = codeIndex.searchText('Flask', { filePattern: 'backend/**' });
    expect(backendResults.length).toBeGreaterThan(0);
  });

  it('should correctly extract and return file symbols', async () => {
    writeFileSync(join(tempDir, 'module.ts'), `
export interface Config {
  debug: boolean;
  port: number;
}

export class Server {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  start(): void {
    console.log('Starting on port', this.config.port);
  }

  stop(): void {
    console.log('Stopping');
  }
}

export function createServer(config: Config): Server {
  return new Server(config);
}
`);

    codeIndex = new CodeIndex({
      projectPath: tempDir,
      embeddingService: null,
      config: DEFAULT_CODE_INDEX_CONFIG,
      isEphemeral: true,
    });

    await codeIndex.reindexFile('module.ts');

    const symbols = codeIndex.getFileSymbols('module.ts');
    const names = symbols.map(s => s.name);

    expect(names).toContain('Config');
    expect(names).toContain('Server');
    expect(names).toContain('createServer');

    // Check kinds
    const configSym = symbols.find(s => s.name === 'Config');
    expect(configSym?.kind).toBe('interface');

    const serverSym = symbols.find(s => s.name === 'Server');
    expect(serverSym?.kind).toBe('class');

    const createServerSym = symbols.find(s => s.name === 'createServer');
    expect(createServerSym?.kind).toBe('function');
  });
});
