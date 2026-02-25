/**
 * File discovery, language detection, and incremental diffing for code indexing.
 */

import { execSync } from 'child_process';
import { statSync, readdirSync, readFileSync, existsSync } from 'fs';
import { join, extname, relative } from 'path';
import { createHash } from 'crypto';

// ============================================================================
// Language Detection (shared with events.ts)
// ============================================================================

const LANG_MAP: Record<string, string> = {
  'ts': 'typescript',
  'tsx': 'typescript',
  'js': 'javascript',
  'jsx': 'javascript',
  'mjs': 'javascript',
  'cjs': 'javascript',
  'py': 'python',
  'pyw': 'python',
  'rs': 'rust',
  'go': 'go',
  'java': 'java',
  'rb': 'ruby',
  'php': 'php',
  'cs': 'csharp',
  'cpp': 'cpp',
  'cc': 'cpp',
  'cxx': 'cpp',
  'c': 'c',
  'h': 'c',
  'hpp': 'cpp',
  'hxx': 'cpp',
  'swift': 'swift',
  'kt': 'kotlin',
  'scala': 'scala',
  'md': 'markdown',
  'json': 'json',
  'yaml': 'yaml',
  'yml': 'yaml',
  'toml': 'toml',
  'sh': 'bash',
  'bash': 'bash',
  'zsh': 'zsh',
  'sql': 'sql',
  'html': 'html',
  'css': 'css',
  'scss': 'scss',
  'less': 'less',
  'vue': 'vue',
  'svelte': 'svelte',
};

/** Set of extensions that are worth indexing for code search. */
const INDEXABLE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'pyw',
  'rs',
  'go',
  'java',
  'rb',
  'php',
  'cs',
  'cpp', 'cc', 'cxx', 'c', 'h', 'hpp', 'hxx',
  'swift',
  'kt',
  'scala',
  'sh', 'bash', 'zsh',
  'sql',
  'html', 'css', 'scss', 'less',
  'vue', 'svelte',
  'md',
  'json', 'yaml', 'yml', 'toml',
]);

/** Directories to always skip during recursive scan. */
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '__pycache__',
  '.context-fabric', '.venv', 'venv', '.tox', '.mypy_cache',
  'target', '.next', '.nuxt', 'coverage', '.cache',
]);

/**
 * Detect programming language from a file path.
 */
export function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return LANG_MAP[ext || ''] || 'text';
}

/**
 * Check whether an extension is indexable for code search.
 */
export function isIndexableExtension(filePath: string): boolean {
  const ext = extname(filePath).replace('.', '').toLowerCase();
  return INDEXABLE_EXTENSIONS.has(ext);
}

// ============================================================================
// File Discovery
// ============================================================================

/**
 * Discover files in a project directory.
 * Tries `git ls-files` first, falls back to recursive readdir.
 */
export function discoverFiles(projectPath: string, maxFiles: number = 10_000): string[] {
  let files: string[];

  try {
    files = discoverViaGit(projectPath);
  } catch {
    files = discoverViaReaddir(projectPath);
  }

  // Filter to indexable extensions and cap at maxFiles
  return files.filter(isIndexableExtension).slice(0, maxFiles);
}

function discoverViaGit(projectPath: string): string[] {
  const stdout = execSync(
    'git ls-files --cached --others --exclude-standard -z',
    { cwd: projectPath, maxBuffer: 10 * 1024 * 1024 },
  );
  return stdout.toString('utf-8').split('\0').filter(Boolean);
}

function discoverViaReaddir(projectPath: string, prefix = ''): string[] {
  const results: string[] = [];
  const fullDir = prefix ? join(projectPath, prefix) : projectPath;

  let entries;
  try {
    entries = readdirSync(fullDir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      const sub = prefix ? join(prefix, entry.name) : entry.name;
      results.push(...discoverViaReaddir(projectPath, sub));
    } else if (entry.isFile()) {
      results.push(prefix ? join(prefix, entry.name) : entry.name);
    }
  }

  return results;
}

// ============================================================================
// Incremental Diff
// ============================================================================

export type DiffAction = 'new' | 'changed' | 'touched' | 'skip';

export interface DiffResult {
  path: string;
  action: DiffAction;
  mtimeMs: number;
  sizeBytes: number;
  hash?: string;
}

export interface ExistingFileInfo {
  mtime_ms: number;
  hash: string;
}

/**
 * Compute the diff between the discovered files on disk and the
 * previously-indexed state (provided as a map of path → info).
 *
 * Also returns paths that exist in `existing` but not on disk (deleted).
 */
export function computeDiff(
  projectPath: string,
  discoveredPaths: string[],
  existing: Map<string, ExistingFileInfo>,
  maxFileSizeBytes: number,
): { diffs: DiffResult[]; deleted: string[] } {
  const diffs: DiffResult[] = [];
  const discoveredSet = new Set(discoveredPaths);

  for (const relPath of discoveredPaths) {
    const fullPath = join(projectPath, relPath);

    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue; // file vanished between discovery and stat
    }

    if (stat.size > maxFileSizeBytes) continue;
    if (isBinary(fullPath)) continue;

    const prev = existing.get(relPath);
    if (!prev) {
      const hash = hashFile(fullPath);
      diffs.push({ path: relPath, action: 'new', mtimeMs: stat.mtimeMs, sizeBytes: stat.size, hash });
    } else if (stat.mtimeMs !== prev.mtime_ms) {
      const hash = hashFile(fullPath);
      if (hash === prev.hash) {
        diffs.push({ path: relPath, action: 'touched', mtimeMs: stat.mtimeMs, sizeBytes: stat.size, hash });
      } else {
        diffs.push({ path: relPath, action: 'changed', mtimeMs: stat.mtimeMs, sizeBytes: stat.size, hash });
      }
    }
    // else: mtime unchanged → skip
  }

  const deleted = [...existing.keys()].filter(p => !discoveredSet.has(p));

  return { diffs, deleted };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Simple binary detection: read first 8KB and check for null bytes.
 */
export function isBinary(filePath: string): boolean {
  try {
    const fd = readFileSync(filePath, { flag: 'r' });
    const sample = fd.subarray(0, 8192);
    return sample.includes(0);
  } catch {
    return true; // can't read → treat as binary
  }
}

function hashFile(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}
