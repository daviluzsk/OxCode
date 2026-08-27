import { SwarmBus, makeEmitter } from './bus.js';
import { startSwarmServer, type SwarmServer } from './server.js';

/** Fixed id for the main agent loop, shown as the "orchestrator" worker. */
export const ORCHESTRATOR_ID = 'orchestrator';

/**
 * Owns the swarm event bus and the (lazily started) visualization server.
 * The bus always exists so events are cheap to emit; the HTTP server only
 * spins up when the user runs `/swarm` or launches with `--swarm`.
 */
export class SwarmController {
  readonly bus = new SwarmBus();
  readonly emit = makeEmitter(this.bus);
  private server: SwarmServer | null = null;

  get url(): string | null {
    return this.server?.url ?? null;
  }
  get running(): boolean {
    return this.server !== null;
  }

  /** Start the viewer server (idempotent). Returns its URL. */
  async start(): Promise<string> {
    if (!this.server) {
      this.server = await startSwarmServer(this.bus);
      this.emit.spawned(ORCHESTRATOR_ID, 'Orchestrator', 'orchestrator');
      this.emit.status(ORCHESTRATOR_ID, 'thinking');
    }
    return this.server.url;
  }

  async stop(): Promise<void> {
    if (this.server) {
      await this.server.close();
      this.server = null;
    }
  }
}
