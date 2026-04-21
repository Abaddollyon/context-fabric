/**
 * Single version source of truth — read from package.json at runtime.
 * Roadmap v0.9: prevent version drift across src/index.ts, src/server.ts, package.json.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function readVersion(): string {
  // When compiled to dist/, we're one level deep; when run from src/ (tests,
  // tsx), we're also one level deep. In both cases package.json is at ../.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '..', 'package.json'),
    resolve(here, '..', '..', 'package.json'),
  ];
  for (const path of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(path, 'utf8')) as { version?: string };
      if (typeof pkg.version === 'string' && pkg.version.length > 0) {
        return pkg.version;
      }
    } catch {
      /* try next */
    }
  }
  // Fallback — should never hit in a packaged install.
  return '0.0.0-unknown';
}

export const VERSION: string = readVersion();
