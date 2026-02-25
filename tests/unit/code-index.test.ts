import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CodeIndex, type CodeIndexOptions } from '../../src/indexer/code-index.js';
import type { FabricConfig } from '../../src/types.js';

const DEFAULT_CODE_INDEX_CONFIG: FabricConfig['codeIndex'] = {
  enabled: true,
  maxFileSizeBytes: 1_048_576,
  maxFiles: 10_000,
  chunkLines: 150,
  chunkOverlap: 10,
  debounceMs: 500,
  watchEnabled: false, // disable watcher in tests
  excludePatterns: [],
};

function createTempProject(): string {
  const dir = join(tmpdir(), `code-index-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('CodeIndex', () => {
  let tempDir: string;
  let codeIndex: CodeIndex;

  beforeEach(() => {
    tempDir = createTempProject();
  });

  afterEach(() => {
    codeIndex?.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createIndex(opts?: Partial<CodeIndexOptions>): CodeIndex {
    codeIndex = new CodeIndex({
      projectPath: tempDir,
      embeddingService: null,
      config: DEFAULT_CODE_INDEX_CONFIG,
      isEphemeral: true,
      ...opts,
    });
    return codeIndex;
  }

  // ========================================================================
  // Basic lifecycle
  // ========================================================================
  describe('lifecycle', () => {
    it('should create and close without errors', () => {
      const idx = createIndex();
      expect(idx.getStatus().totalFiles).toBe(0);
      idx.close();
    });

    it('should report empty status initially', () => {
      const idx = createIndex();
      const status = idx.getStatus();
      expect(status.totalFiles).toBe(0);
      expect(status.totalSymbols).toBe(0);
      expect(status.totalChunks).toBe(0);
      expect(status.isStale).toBe(true);
    });
  });

  // ========================================================================
  // Indexing
  // ========================================================================
  describe('indexing', () => {
    it('should index a TypeScript file', async () => {
      writeFileSync(join(tempDir, 'index.ts'), `
export function hello(name: string): string {
  return \`Hello, \${name}!\`;
}

export class Greeter {
  greet(name: string): string {
    return hello(name);
  }
}
`);

      const idx = createIndex();
      await idx.reindexFile('index.ts');

      const status = idx.getStatus();
      expect(status.totalFiles).toBe(1);
      expect(status.totalSymbols).toBeGreaterThan(0);
      expect(status.totalChunks).toBeGreaterThan(0);
    });

    it('should index a Python file', async () => {
      writeFileSync(join(tempDir, 'main.py'), `
def process(data):
    """Process the input data."""
    return data.strip()

class DataProcessor:
    def __init__(self):
        self.cache = {}

    def run(self, input):
        return process(input)
`);

      const idx = createIndex();
      await idx.reindexFile('main.py');

      const status = idx.getStatus();
      expect(status.totalFiles).toBe(1);
      expect(status.totalSymbols).toBeGreaterThan(0);
    });

    it('should handle file deletion during reindex', async () => {
      writeFileSync(join(tempDir, 'temp.ts'), 'export const x = 1;');

      const idx = createIndex();
      await idx.reindexFile('temp.ts');
      expect(idx.getStatus().totalFiles).toBe(1);

      // Delete the file and reindex
      rmSync(join(tempDir, 'temp.ts'));
      await idx.reindexFile('temp.ts');
      expect(idx.getStatus().totalFiles).toBe(0);
    });

    it('should perform incremental update', async () => {
      mkdirSync(join(tempDir, 'src'), { recursive: true });
      writeFileSync(join(tempDir, 'src/a.ts'), 'export const a = 1;');
      writeFileSync(join(tempDir, 'src/b.ts'), 'export const b = 2;');

      const idx = createIndex();
      await idx.incrementalUpdate();

      const status = idx.getStatus();
      expect(status.totalFiles).toBe(2);
    });

    it('should re-index changed files during incremental update', async () => {
      writeFileSync(join(tempDir, 'file.ts'), 'export const x = 1;');

      const idx = createIndex();
      await idx.incrementalUpdate();
      expect(idx.getStatus().totalFiles).toBe(1);

      // Modify the file (must change mtime)
      await new Promise(r => setTimeout(r, 50)); // small delay to ensure mtime changes
      writeFileSync(join(tempDir, 'file.ts'), 'export const x = 2;\nexport function newFunc() { return 42; }');

      await idx.incrementalUpdate();
      expect(idx.getStatus().totalFiles).toBe(1);
      expect(idx.getStatus().totalSymbols).toBeGreaterThanOrEqual(1);
    });
  });

  // ========================================================================
  // Search modes
  // ========================================================================
  describe('search', () => {
    beforeEach(async () => {
      writeFileSync(join(tempDir, 'auth.ts'), `
/**
 * Authentication middleware.
 */
export function authenticateUser(token: string): boolean {
  return token.length > 0;
}

export class AuthService {
  private tokens: Map<string, string> = new Map();

  validateToken(token: string): boolean {
    return this.tokens.has(token);
  }

  revokeToken(token: string): void {
    this.tokens.delete(token);
  }
}

export interface AuthConfig {
  secret: string;
  expiresIn: number;
}
`);

      writeFileSync(join(tempDir, 'user.ts'), `
export interface User {
  id: string;
  name: string;
  email: string;
}

export function createUser(name: string, email: string): User {
  return { id: crypto.randomUUID(), name, email };
}

export class UserRepository {
  private users: User[] = [];

  findById(id: string): User | undefined {
    return this.users.find(u => u.id === id);
  }

  save(user: User): void {
    this.users.push(user);
  }
}
`);

      codeIndex = createIndex();
      await codeIndex.reindexFile('auth.ts');
      await codeIndex.reindexFile('user.ts');
    });

    describe('text search', () => {
      it('should find text matches in file content', () => {
        const results = codeIndex.searchText('authenticateUser');
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].filePath).toBe('auth.ts');
      });

      it('should be case-insensitive', () => {
        const results = codeIndex.searchText('authservice');
        expect(results.length).toBeGreaterThan(0);
      });

      it('should filter by language', () => {
        const results = codeIndex.searchText('function', { language: 'typescript' });
        expect(results.length).toBeGreaterThan(0);

        const noResults = codeIndex.searchText('function', { language: 'python' });
        expect(noResults.length).toBe(0);
      });

      it('should respect limit', () => {
        const results = codeIndex.searchText('function', { limit: 1 });
        expect(results.length).toBeLessThanOrEqual(1);
      });
    });

    describe('symbol search', () => {
      it('should find symbols by name', () => {
        const results = codeIndex.searchSymbols('authenticateUser');
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].symbol?.name).toBe('authenticateUser');
        expect(results[0].symbol?.kind).toBe('function');
      });

      it('should find symbols by partial name', () => {
        const results = codeIndex.searchSymbols('User');
        expect(results.length).toBeGreaterThan(0);
        const names = results.map(r => r.symbol?.name);
        expect(names.some(n => n?.includes('User'))).toBe(true);
      });

      it('should filter by symbol kind', () => {
        const classes = codeIndex.searchSymbols('', { symbolKind: 'class' });
        expect(classes.length).toBeGreaterThan(0);
        classes.forEach(r => expect(r.symbol?.kind).toBe('class'));

        const interfaces = codeIndex.searchSymbols('', { symbolKind: 'interface' });
        expect(interfaces.length).toBeGreaterThan(0);
        interfaces.forEach(r => expect(r.symbol?.kind).toBe('interface'));
      });

      it('should include signature and doc comment', () => {
        const results = codeIndex.searchSymbols('authenticateUser');
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].symbol?.signature).toContain('authenticateUser');
        expect(results[0].symbol?.docComment).toContain('Authentication middleware');
      });
    });

    describe('semantic search', () => {
      it('should return empty when no embedding service', async () => {
        const results = await codeIndex.searchSemantic('authentication');
        expect(results).toEqual([]);
      });
    });
  });

  // ========================================================================
  // File symbols helper
  // ========================================================================
  describe('getFileSymbols', () => {
    it('should return symbols for a specific file', async () => {
      writeFileSync(join(tempDir, 'service.ts'), `
export class MyService {
  doWork(): void {}
}

export function helper(): string {
  return 'help';
}
`);

      const idx = createIndex();
      await idx.reindexFile('service.ts');

      const symbols = idx.getFileSymbols('service.ts');
      expect(symbols.length).toBeGreaterThan(0);
      const names = symbols.map(s => s.name);
      expect(names).toContain('MyService');
      expect(names).toContain('helper');
    });

    it('should return empty array for non-indexed file', () => {
      const idx = createIndex();
      const symbols = idx.getFileSymbols('nonexistent.ts');
      expect(symbols).toEqual([]);
    });
  });

  // ========================================================================
  // Chunking behavior
  // ========================================================================
  describe('chunking', () => {
    it('should create multiple chunks for large files', async () => {
      // Create a file with 200+ lines
      const lines: string[] = [];
      for (let i = 0; i < 250; i++) {
        lines.push(`export const var${i} = ${i};`);
      }
      writeFileSync(join(tempDir, 'large.ts'), lines.join('\n'));

      const idx = createIndex({ config: { ...DEFAULT_CODE_INDEX_CONFIG, chunkLines: 50, chunkOverlap: 5 } });
      await idx.reindexFile('large.ts');

      const status = idx.getStatus();
      expect(status.totalChunks).toBeGreaterThan(1);
    });
  });
});
