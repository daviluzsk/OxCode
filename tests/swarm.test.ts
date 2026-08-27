import { describe, expect, it } from 'vitest';
import { SwarmBus } from '../src/swarm/bus.js';
import { SwarmController } from '../src/swarm/controller.js';
import { startSwarmServer } from '../src/swarm/server.js';

describe('SwarmBus', () => {
  it('buffers events for replay and streams live to subscribers', () => {
    const bus = new SwarmBus();
    bus.emitEvent({ type: 'agent_spawned', id: 'w1', label: 'x', role: 'coder', t: 1 });
    const seen: string[] = [];
    const off = bus.subscribe((e) => seen.push(e.type));
    bus.emitEvent({ type: 'agent_status', id: 'w1', status: 'working', t: 2 });
    off();
    bus.emitEvent({ type: 'agent_done', id: 'w1', status: 'done', t: 3 });

    // subscriber only saw events after it subscribed and before it unsubscribed
    expect(seen).toEqual(['agent_status']);
    // replay buffer has everything
    const snap = bus.snapshot();
    expect(snap.events.map((e) => e.type)).toEqual(['agent_spawned', 'agent_status', 'agent_done']);
  });

  it('collects blackboard notes separately', () => {
    const bus = new SwarmBus();
    bus.emitEvent({ type: 'blackboard', id: 'w1', note: 'found the bug', t: 1 });
    bus.emitEvent({ type: 'blackboard', id: 'w2', note: 'wrote a test', t: 2 });
    expect(bus.blackboard().map((n) => n.note)).toEqual(['found the bug', 'wrote a test']);
  });
});

describe('SwarmController', () => {
  it('is not running until started, then serves and stops', async () => {
    const c = new SwarmController();
    expect(c.running).toBe(false);
    expect(c.url).toBeNull();
    const url = await c.start();
    expect(c.running).toBe(true);
    expect(url).toMatch(/^http:\/\/localhost:\d+$/);
    // starting an orchestrator worker is part of start()
    expect(c.bus.snapshot().events.some((e) => e.type === 'agent_spawned')).toBe(true);
    await c.stop();
    expect(c.running).toBe(false);
  });
});

describe('swarm HTTP server', () => {
  it('serves the viewer and a JSON snapshot', async () => {
    const bus = new SwarmBus();
    bus.emitEvent({ type: 'agent_spawned', id: 'w1', label: 'x', role: 'coder', t: 1 });
    const server = await startSwarmServer(bus, 0);
    try {
      const html = await (await fetch(`${server.url}/`)).text();
      expect(html).toContain('OxCode Swarm');
      const state = (await (await fetch(`${server.url}/state`)).json()) as { events: unknown[] };
      expect(state.events).toHaveLength(1);
    } finally {
      await server.close();
    }
  });
});
