// Graceful shutdown coordinator (v0.8).
//
// Tracks in-flight MCP tool calls so SIGTERM/SIGINT can wait for them
// to finish before engines are closed. Prevents partial writes, orphan
// transactions, and dropped responses.
//
// Contract:
//   - begin() / end() bracket each tool call. Symmetric usage is required
//     (end() in a finally block).
//   - drain(timeoutMs) marks the controller as shutting down and resolves
//     as soon as the in-flight counter reaches 0 OR the timeout elapses.
//   - After drain() is called, further begin() calls throw. This ensures
//     we don't accept new work while shutting down.

export interface DrainResult {
  drained: boolean; // true if all in-flight calls finished in time
  remaining: number; // number still running when drain() returned
}

export class ShutdownController {
  private inFlight = 0;
  private isShuttingDown = false;
  private drainResolvers: Array<() => void> = [];

  get shuttingDown(): boolean {
    return this.isShuttingDown;
  }

  get inFlightCount(): number {
    return this.inFlight;
  }

  /** Mark the start of a tool call. Throws if shutdown has begun. */
  begin(): void {
    if (this.isShuttingDown) {
      throw new Error('server is shutting down; rejecting new tool call');
    }
    this.inFlight++;
  }

  /** Mark the end of a tool call. MUST be paired with begin() in a finally. */
  end(): void {
    if (this.inFlight > 0) this.inFlight--;
    if (this.isShuttingDown && this.inFlight === 0) {
      const resolvers = this.drainResolvers;
      this.drainResolvers = [];
      for (const r of resolvers) r();
    }
  }

  /**
   * Transition to shutting-down and wait up to timeoutMs for in-flight
   * calls to finish. Resolves earlier if the counter hits 0.
   */
  async drain(timeoutMs = 5000): Promise<DrainResult> {
    this.isShuttingDown = true;
    if (this.inFlight === 0) {
      return { drained: true, remaining: 0 };
    }

    return await new Promise<DrainResult>((resolve) => {
      const timer = setTimeout(() => {
        // Remove our resolver so a late end() doesn't double-resolve.
        const idx = this.drainResolvers.indexOf(onDrained);
        if (idx >= 0) this.drainResolvers.splice(idx, 1);
        resolve({ drained: this.inFlight === 0, remaining: this.inFlight });
      }, timeoutMs);

      const onDrained = () => {
        clearTimeout(timer);
        resolve({ drained: true, remaining: 0 });
      };
      this.drainResolvers.push(onDrained);
    });
  }
}
