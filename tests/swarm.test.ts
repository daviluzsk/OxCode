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

  it('tracks the roster and resolves message recipients by label or role', () => {
    const bus = new SwarmBus();
    bus.emitEvent({ type: 'agent_spawned', id: 'w1', label: 'plan the SaaS', role: 'planner', t: 1 });
    bus.emitEvent({ type: 'agent_spawned', id: 'w2', label: 'engineer: build API', role: 'coder', t: 2 });
    expect(bus.resolveTarget('planner')).toBe('w1');       // by role
    expect(bus.resolveTarget('engineer: build API')).toBe('w2'); // exact label
    expect(bus.resolveTarget('build API')).toBe('w2');     // substring
    expect(bus.resolveTarget('all')).toBe('all');
    expect(bus.resolveTarget('nobody-here')).toBe('all');  // fallback
    expect(bus.resolveTarget('planner', 'w1')).toBe('all'); // exclude self -> no match
    expect(bus.labelOf('w2')).toBe('engineer: build API');
  });

  it('records inter-agent chatter for hive_read', () => {
    const bus = new SwarmBus();
    bus.emitEvent({ type: 'agent_spawned', id: 'w1', label: 'a', role: 'coder', t: 1 });
    bus.emitEvent({ type: 'communication', from: 'w1', to: 'w2', text: 'is the token check off-by-one?', t: 2 });
    bus.emitEvent({ type: 'communication', from: 'w1', to: 'all', t: 3 }); // no text -> ignored
    const chat = bus.chatter();
    expect(chat).toHaveLength(1);
    expect(chat[0]).toMatchObject({ from: 'w1', to: 'w2', text: 'is the token check off-by-one?' });
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
