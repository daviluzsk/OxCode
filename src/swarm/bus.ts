import { EventEmitter } from 'node:events';
import type { AgentStatus, SwarmEvent, SwarmSnapshot } from './types.js';

const MAX_BUFFER = 1000;
const MAX_BLACKBOARD = 200;

/**
 * In-process pub/sub for swarm activity. The task tool and orchestrator push
 * events; the HTTP server streams them to the 3D viewer. Keeps a bounded
 * replay buffer so a browser that connects late still sees the whole run,
 * plus the shared blackboard (the hive's common memory).
 */
export class SwarmBus extends EventEmitter {
  readonly startedAt = Date.now();
  private readonly buffer: SwarmEvent[] = [];
  private readonly board: Array<{ id: string; note: string; t: number }> = [];
  /** id -> {label, role} for every worker that has joined (target resolution). */
  private readonly roster = new Map<string, { label: string; role: string }>();
  /** Recent things workers said to each other (for hive_read). */
  private readonly chat: Array<{ from: string; to: string; text: string; t: number }> = [];

  emitEvent(event: SwarmEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > MAX_BUFFER) this.buffer.shift();
    if (event.type === 'blackboard') {
      this.board.push({ id: event.id, note: event.note, t: event.t });
      if (this.board.length > MAX_BLACKBOARD) this.board.shift();
    }
    if (event.type === 'agent_spawned') this.roster.set(event.id, { label: event.label, role: event.role });
    if ((event.type === 'communication' || event.type === 'agent_message') && 'text' in event && event.text) {
      const from = event.type === 'communication' ? event.from : event.id;
      const to = event.type === 'communication' ? event.to : 'all';
      this.chat.push({ from, to, text: event.text, t: event.t });
      if (this.chat.length > MAX_BLACKBOARD) this.chat.shift();
    }
    this.emit('event', event);
  }

  /** All joined workers. */
  members(): Array<{ id: string; label: string; role: string }> {
    return [...this.roster.entries()].map(([id, v]) => ({ id, ...v }));
  }

  /** Resolve a free-text recipient (exact label, substring, or role) to an id. */
  resolveTarget(name: string, exclude?: string): string {
    const q = name.trim().toLowerCase();
    if (q === 'all' || q === 'everyone' || q === '*' || q === '') return 'all';
    const list = this.members().filter((m) => m.id !== exclude);
    return (
      list.find((m) => m.label.toLowerCase() === q)?.id ??
      list.find((m) => m.role.toLowerCase() === q)?.id ??
      list.find((m) => m.label.toLowerCase().includes(q))?.id ??
      list.find((m) => m.role.toLowerCase().includes(q))?.id ??
      'all'
    );
  }

  /** Recent inter-agent chatter (for hive_read). */
  chatter(limit = 20): Array<{ from: string; to: string; text: string; t: number }> {
    return this.chat.slice(-limit);
  }

  labelOf(id: string): string {
    return this.roster.get(id)?.label ?? id;
  }

  /** Subscribe to live events; returns an unsubscribe function. */
  subscribe(listener: (event: SwarmEvent) => void): () => void {
    this.on('event', listener);
    return () => this.off('event', listener);
  }

  snapshot(): SwarmSnapshot {
    return { startedAt: this.startedAt, events: [...this.buffer], blackboard: [...this.board] };
  }

  /** Current blackboard notes (hive shared memory), most recent last. */
  blackboard(): Array<{ id: string; note: string; t: number }> {
    return [...this.board];
  }
}

/** Convenience helpers so callers don't hand-build timestamps everywhere. */
export function makeEmitter(bus: SwarmBus) {
  return {
    spawned: (id: string, label: string, role: string, parent?: string) =>
      bus.emitEvent({ type: 'agent_spawned', id, label, role, parent, t: Date.now() }),
    status: (id: string, status: AgentStatus, detail?: string) =>
      bus.emitEvent({ type: 'agent_status', id, status, detail, t: Date.now() }),
    tool: (id: string, tool: string, summary: string, phase: 'start' | 'end', ok?: boolean) =>
      bus.emitEvent({ type: 'agent_tool', id, tool, summary, phase, ok, t: Date.now() }),
    say: (id: string, text: string) => bus.emitEvent({ type: 'agent_message', id, text, t: Date.now() }),
    comm: (from: string, to: string | 'all', text?: string) =>
      bus.emitEvent({ type: 'communication', from, to, text, t: Date.now() }),
    board: (id: string, note: string) => bus.emitEvent({ type: 'blackboard', id, note, t: Date.now() }),
    done: (id: string, status: 'done' | 'error') => bus.emitEvent({ type: 'agent_done', id, status, t: Date.now() }),
  };
}
