import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  detectLanguage,
  isIndexableExtension,
  discoverFiles,
  computeDiff,
  isBinary,
  type ExistingFileInfo,
} from '../../src/indexer/scanner.js';

describe('detectLanguage', () => {
  it('should detect TypeScript', () => {
    expect(detectLanguage('src/index.ts')).toBe('typescript');
    expect(detectLanguage('component.tsx')).toBe('typescript');
  });

  it('should detect JavaScript', () => {
    expect(detectLanguage('app.js')).toBe('javascript');
    expect(detectLanguage('module.mjs')).toBe('javascript');
  });

  it('should detect Python', () => {
    expect(detectLanguage('main.py')).toBe('python');
  });

  it('should detect Rust', () => {
    expect(detectLanguage('lib.rs')).toBe('rust');
  });

  it('should detect Go', () => {
    expect(detectLanguage('server.go')).toBe('go');
  });

  it('should return text for unknown extensions', () => {
    expect(detectLanguage('file.xyz')).toBe('text');
    expect(detectLanguage('noextension')).toBe('text');
  });
});

describe('isIndexableExtension', () => {
  it('should accept common source extensions', () => {
    expect(isIndexableExtension('file.ts')).toBe(true);
    expect(isIndexableExtension('file.py')).toBe(true);
    expect(isIndexableExtension('file.rs')).toBe(true);
    expect(isIndexableExtension('file.go')).toBe(true);
  });

  it('should reject non-source extensions', () => {
    expect(isIndexableExtension('image.png')).toBe(false);
    expect(isIndexableExtension('data.bin')).toBe(false);
    expect(isIndexableExtension('archive.zip')).toBe(false);
  });
});

describe('discoverFiles', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `scanner-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should discover files with indexable extensions', () => {
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src/index.ts'), 'export const x = 1;');
    writeFileSync(join(tempDir, 'src/utils.py'), 'def hello(): pass');
    writeFileSync(join(tempDir, 'README.md'), '# Hello');
    writeFileSync(join(tempDir, 'logo.png'), 'binary data');

    const files = discoverFiles(tempDir);
    expect(files).toContain('src/index.ts');
    expect(files).toContain('src/utils.py');
    expect(files).toContain('README.md');
    // png is not indexable
    expect(files).not.toContain('logo.png');
  });

  it('should respect maxFiles limit', () => {
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(tempDir, `file${i}.ts`), `export const x${i} = ${i};`);
    }

    const files = discoverFiles(tempDir, 3);
    expect(files.length).toBeLessThanOrEqual(3);
  });

  it('should ignore common directories', () => {
    mkdirSync(join(tempDir, 'node_modules/foo'), { recursive: true });
    mkdirSync(join(tempDir, '.git/objects'), { recursive: true });
    mkdirSync(join(tempDir, 'src'), { recursive: true });

    writeFileSync(join(tempDir, 'node_modules/foo/index.js'), 'module.exports = {}');
    writeFileSync(join(tempDir, '.git/objects/abc'), 'git object');
    writeFileSync(join(tempDir, 'src/main.ts'), 'const x = 1;');

    const files = discoverFiles(tempDir);
    expect(files).toContain('src/main.ts');
    expect(files.every(f => !f.startsWith('node_modules'))).toBe(true);
    expect(files.every(f => !f.startsWith('.git'))).toBe(true);
  });
});

describe('computeDiff', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `diff-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should detect new files', () => {
    writeFileSync(join(tempDir, 'new.ts'), 'export const x = 1;');

    const { diffs, deleted } = computeDiff(
      tempDir,
      ['new.ts'],
      new Map(),
      1_048_576,
    );

    expect(diffs).toHaveLength(1);
    expect(diffs[0].action).toBe('new');
    expect(diffs[0].path).toBe('new.ts');
    expect(deleted).toHaveLength(0);
  });

  it('should detect deleted files', () => {
    const existing = new Map<string, ExistingFileInfo>();
    existing.set('old.ts', { mtime_ms: 1000, hash: 'abc123' });

    const { diffs, deleted } = computeDiff(
      tempDir,
      [], // file no longer discovered
      existing,
      1_048_576,
    );

    expect(deleted).toContain('old.ts');
  });

  it('should detect changed files', () => {
    writeFileSync(join(tempDir, 'file.ts'), 'export const x = 2;');

    const existing = new Map<string, ExistingFileInfo>();
    existing.set('file.ts', { mtime_ms: 1000, hash: 'oldhash' });

    const { diffs } = computeDiff(tempDir, ['file.ts'], existing, 1_048_576);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].action).toBe('changed');
  });

  it('should skip files larger than maxFileSizeBytes', () => {
    const bigContent = 'x'.repeat(100);
    writeFileSync(join(tempDir, 'big.ts'), bigContent);

    const { diffs } = computeDiff(tempDir, ['big.ts'], new Map(), 10); // 10 bytes max
    expect(diffs).toHaveLength(0);
  });
});

describe('isBinary', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `binary-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should detect text files as non-binary', () => {
    const file = join(tempDir, 'text.ts');
    writeFileSync(file, 'export const x = 1;');
    expect(isBinary(file)).toBe(false);
  });

  it('should detect binary files with null bytes', () => {
    const file = join(tempDir, 'binary.dat');
    const buf = Buffer.from([0x48, 0x65, 0x6c, 0x00, 0x6f]); // 'Hel\0o'
    writeFileSync(file, buf);
    expect(isBinary(file)).toBe(true);
  });
});
