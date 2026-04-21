/**
 * Structured logger tests — v0.10.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createLogger, setLogLevel, getLogLevel } from '../../src/logger.js';

describe('Structured logger', () => {
  let writes: string[];
  let original: typeof process.stderr.write;

  beforeEach(() => {
    writes = [];
    original = process.stderr.write.bind(process.stderr);
    // @ts-expect-error — test stub
    process.stderr.write = (chunk: string) => {
      writes.push(String(chunk));
      return true;
    };
    setLogLevel('debug');
  });

  afterEach(() => {
    process.stderr.write = original;
    setLogLevel('info');
  });

  it('emits one JSON object per line', () => {
    const log = createLogger('test');
    log.info('hello', { foo: 1 });
    expect(writes.length).toBe(1);
    const line = writes[0]!.trimEnd();
    expect(line.endsWith('}')).toBe(true);
    const obj = JSON.parse(line);
    expect(obj.level).toBe('info');
    expect(obj.module).toBe('test');
    expect(obj.msg).toBe('hello');
    expect(obj.foo).toBe(1);
    expect(typeof obj.ts).toBe('string');
  });

  it('suppresses messages below current level', () => {
    setLogLevel('warn');
    const log = createLogger('t');
    log.debug('skip');
    log.info('skip');
    log.warn('keep');
    log.error('keep');
    expect(writes.length).toBe(2);
  });

  it('child appends submodule', () => {
    const log = createLogger('parent').child('child');
    log.info('m');
    const obj = JSON.parse(writes[0]!.trim());
    expect(obj.module).toBe('parent:child');
  });

  it('reserved keys cannot be overwritten', () => {
    const log = createLogger('t');
    log.info('m', { ts: 'HACKED', level: 'HACKED', module: 'HACKED', msg: 'HACKED', ok: true });
    const obj = JSON.parse(writes[0]!.trim());
    expect(obj.ts).not.toBe('HACKED');
    expect(obj.level).toBe('info');
    expect(obj.module).toBe('t');
    expect(obj.msg).toBe('m');
    expect(obj.ok).toBe(true);
  });

  it('getLogLevel reflects setLogLevel', () => {
    setLogLevel('error');
    expect(getLogLevel()).toBe('error');
  });
});
