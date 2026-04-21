import { describe, it, expect, vi } from 'vitest';
import { ShutdownController } from '../../src/shutdown.js';

function defer<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('ShutdownController', () => {
  it('drain resolves immediately when no calls in flight', async () => {
    const c = new ShutdownController();
    const result = await c.drain(100);
    expect(result).toEqual({ drained: true, remaining: 0 });
    expect(c.shuttingDown).toBe(true);
  });

  it('drain waits for in-flight calls to finish', async () => {
    const c = new ShutdownController();
    c.begin();
    const d = c.drain(1000);

    // Still running after 50ms
    await new Promise((r) => setTimeout(r, 50));
    c.end();

    const result = await d;
    expect(result).toEqual({ drained: true, remaining: 0 });
  });

  it('drain times out when in-flight calls outlast the deadline', async () => {
    const c = new ShutdownController();
    c.begin();
    c.begin();
    const result = await c.drain(50);
    expect(result.drained).toBe(false);
    expect(result.remaining).toBe(2);
  });

  it('begin() throws after drain() has been called', async () => {
    const c = new ShutdownController();
    await c.drain(10);
    expect(() => c.begin()).toThrow(/shutting down/);
  });

  it('counts in-flight correctly with concurrent calls', async () => {
    const c = new ShutdownController();
    c.begin(); c.begin(); c.begin();
    expect(c.inFlightCount).toBe(3);
    c.end();
    expect(c.inFlightCount).toBe(2);
    c.end(); c.end();
    expect(c.inFlightCount).toBe(0);
  });

  it('end() is idempotent when counter is already zero', () => {
    const c = new ShutdownController();
    c.end(); c.end();
    expect(c.inFlightCount).toBe(0);
  });
});
