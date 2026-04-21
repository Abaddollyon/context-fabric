import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VERSION } from '../../src/version.js';

describe('VERSION single source of truth (v0.9)', () => {
  it('matches package.json', () => {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });

  it('is a semver-ish string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
