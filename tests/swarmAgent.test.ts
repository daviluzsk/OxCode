import { afterEach, describe, expect, it } from 'vitest';
import { createTaskTool } from '../src/agent/taskTool.js';
import { MockProvider } from '../src/api/index.js';
import { TodoStore } from '../src/agent/todo.js';
import { defaultConfig, type ResolvedConfig } from '../src/config/types.js';
import { PermissionManager } from '../src/permissions/manager.js';
import { createBuiltinRegistry } from '../src/tools/index.js';
import { SwarmController } from '../src/swarm/controller.js';
import type { SwarmEvent } from '../src/swarm/types.js';
import { cleanup, makeTempDir } from './helpers.js';

let dir = '';
afterEach(() => { if (dir) cleanup(dir); dir = ''; });

describe('task tool + swarm wiring', () => {
  it('registers hive tools and streams the crew activity to the bus', async () => {
    dir = makeTempDir();
    const swarm = new SwarmController();
    await swarm.start(); // needed so the task tool treats the swarm as live
    const events: SwarmEvent[] = [];
    swarm.bus.subscribe((e) => events.push(e));

    // Scripted subagent: it talks to the crew, then finishes.
    const provider = new MockProvider([
      { text: 'Looking at the login flow.', toolCalls: [{ name: 'hive_message', arguments: { to: 'all', message: 'reflected input echoed at /search' } }] },
      { text: 'Assessment done: 1 reflected-input finding.' },
    ]);
    const config: ResolvedConfig = { ...defaultConfig, cwd: dir, apiKey: undefined, maxTurns: 6, compactThreshold: 1_000_000 };
    const registry = createBuiltinRegistry(new TodoStore());
    const permissions = new PermissionManager('default', async () => 'yes');

    const task = createTaskTool({
      provider, config, registry, permissions,
      getSystemPrompt: () => 'test',
      depth: 0,
      swarm,
    });

    try {
      const res = await task.execute(
        { description: 'security: assess the login', prompt: 'Assess the login page from outside.' },
        { cwd: dir },
      );
      expect(res.isError).toBeFalsy();

      const types = events.map((e) => e.type);
      expect(types).toContain('agent_spawned');   // worker joined the office
      expect(types).toContain('agent_done');       // and left when finished

      const spawn = events.find((e) => e.type === 'agent_spawned');
      expect(spawn && spawn.role).toBe('security'); // role inferred from description

      // the hive_message tool actually delivered a real message with our text
      const comm = events.find((e) => e.type === 'communication' && 'text' in e && e.text === 'reflected input echoed at /search');
      expect(comm, 'hive_message should emit a communication event').toBeTruthy();

      // and the worker posted its result to the shared blackboard
      expect(events.some((e) => e.type === 'blackboard')).toBe(true);
    } finally {
      await swarm.stop();
    }
  });
});
