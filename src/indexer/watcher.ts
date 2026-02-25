/**
 * File watcher using Node.js built-in fs.watch with per-file debouncing.
 * Works on Linux kernel 5.9+ with Node 22.5+ (recursive watch support).
 */

import { watch, type FSWatcher } from 'fs';
import { relative, sep } from 'path';

/** Directories to ignore during file watching. */
const IGNORE_SEGMENTS = new Set([
  '.git', 'node_modules', '.context-fabric', 'dist', 'build',
  '__pycache__', '.venv', 'venv', '.tox', '.mypy_cache',
  'target', '.next', '.nuxt', 'coverage', '.cache',
]);

export interface FileWatcherOptions {
  projectPath: string;
  debounceMs?: number;
  onChanged: (relativePath: string) => void;
  onDeleted: (relativePath: string) => void;
}

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private pendingChanges: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private projectPath: string;
  private debounceMs: number;
  private onChanged: (relativePath: string) => void;
  private onDeleted: (relativePath: string) => void;

  constructor(opts: FileWatcherOptions) {
    this.projectPath = opts.projectPath;
    this.debounceMs = opts.debounceMs ?? 500;
    this.onChanged = opts.onChanged;
    this.onDeleted = opts.onDeleted;
  }

  start(): void {
    if (this.watcher) return;

    try {
      this.watcher = watch(this.projectPath, { recursive: true }, (eventType, filename) => {
        if (!filename) return;

        // Normalize path separators
        const relPath = filename.split(sep).join('/');

        // Check if any path segment is in the ignore list
        const segments = relPath.split('/');
        if (segments.some(s => IGNORE_SEGMENTS.has(s))) return;

        // Debounce per file
        const existing = this.pendingChanges.get(relPath);
        if (existing) clearTimeout(existing);

        this.pendingChanges.set(relPath, setTimeout(() => {
          this.pendingChanges.delete(relPath);

          if (eventType === 'rename') {
            // 'rename' can mean created or deleted — caller checks existence
            // We emit as changed; if the file was deleted, the reindex will detect it
            this.onChanged(relPath);
          } else {
            this.onChanged(relPath);
          }
        }, this.debounceMs));
      });

      this.watcher.on('error', (_err) => {
        // Gracefully handle errors (EMFILE, etc.)
        // Fall back to mtime-only on next query — just stop watching
        this.stop();
      });
    } catch {
      // fs.watch not supported or other error — silently degrade
      this.watcher = null;
    }
  }

  stop(): void {
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        // ignore close errors
      }
      this.watcher = null;
    }

    // Clear all pending timers
    for (const timer of this.pendingChanges.values()) {
      clearTimeout(timer);
    }
    this.pendingChanges.clear();
  }
}
