import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Server } from 'node:http';

export interface DrainOptions {
  timeoutMs?: number;
  checkIntervalMs?: number;
}

export class ActiveRequestsTracker {
  private inFlight = 0;
  private isDraining = false;
  private trackedResponses = new WeakSet<ServerResponse>();

  /**
   * Track an incoming HTTP request/response cycle.
   */
  public track(req: IncomingMessage, res: ServerResponse): void {
    if (this.trackedResponses.has(res)) return;
    this.trackedResponses.add(res);

    this.inFlight++;

    const cleanup = () => {
      if (this.trackedResponses.has(res)) {
        this.trackedResponses.delete(res);
        this.inFlight = Math.max(0, this.inFlight - 1);
      }
    };

    res.once('finish', cleanup);
    res.once('close', cleanup);
  }

  public getInFlightCount(): number {
    return this.inFlight;
  }

  public isShuttingDown(): boolean {
    return this.isDraining;
  }

  /**
   * Initiates graceful draining:
   * 1. Closes idle keep-alive connections
   * 2. Stops accepting new connections on the server
   * 3. Waits until inFlight reaches 0 or timeout expires
   */
  public async startGracefulDrain(
    server: Server,
    options: DrainOptions = {}
  ): Promise<{ drainedCleanly: boolean; remainingRequests: number }> {
    this.isDraining = true;
    const timeoutMs = options.timeoutMs ?? 120000;
    const checkIntervalMs = options.checkIntervalMs ?? 250;
    const startedAt = Date.now();

    // 1. Close idle keep-alive sockets immediately so new requests don't queue on dead sockets
    if (typeof (server as any).closeIdleConnections === 'function') {
      try {
        (server as any).closeIdleConnections();
      } catch {
        // ignore
      }
    }

    // 2. Stop accepting new connections
    await new Promise<void>((resolve) => {
      server.close((_err) => {
        resolve();
      });
    });

    // 3. Poll until in-flight requests finish or timeout
    while (this.inFlight > 0) {
      if (Date.now() - startedAt >= timeoutMs) {
        console.warn(`[DrainTracker] Drain timeout of ${timeoutMs}ms exceeded. ${this.inFlight} requests still active.`);
        return { drainedCleanly: false, remainingRequests: this.inFlight };
      }
      await new Promise((r) => setTimeout(r, checkIntervalMs));
    }

    return { drainedCleanly: true, remainingRequests: 0 };
  }
}

export const drainTracker = new ActiveRequestsTracker();
