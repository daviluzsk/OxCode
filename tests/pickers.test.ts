import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleSlashCommand, type ChoiceSpec, type CommandDeps, type CommandHost } from '../src/commands/slash.js';
import { defaultConfig, type ResolvedConfig } from '../src/config/types.js';
import { PermissionManager } from '../src/permissions/manager.js';
import { Session, SessionStore } from '../src/sessions/store.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { SwarmController } from '../src/swarm/controller.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ox-pick-'));

function makeDeps(pick: (spec: ChoiceSpec) => string | null): {
  deps: CommandDeps;
  printed: string[];
  config: ResolvedConfig;
  permissions: PermissionManager;
  specs: ChoiceSpec[];
} {
  const printed: string[] = [];
  const specs: ChoiceSpec[] = [];
  const session = new Session(dir, 'test-model');
  const config: ResolvedConfig = { ...defaultConfig, cwd: dir, apiKey: undefined };
  const permissions = new PermissionManager('default', async () => 'yes');
  const host: CommandHost = {
    print: (t) => printed.push(t),
    clear: () => {},
    requestExit: () => {},
    setModel: () => {},
    pickSession: async () => null,
    pickModel: async () => null,
    setMrRobot: () => {},
    pickChoice: async (spec) => {
      specs.push(spec);
      return pick(spec);
    },
    loadSession: () => {},
    btw: () => {},
  };
  const deps: CommandDeps = {
    host,
    session: () => session,
    agent: () => {
      throw new Error('not needed');
    },
    config,
    permissions,
    sessionStore: new SessionStore(),
    registry: new ToolRegistry(),
    mcp: null,
    profile: null,
    skills: [],
    swarm: new SwarmController(),
  };
  return { deps, printed, config, permissions, specs };
}

describe('interactive pickers', () => {
  it('/effort with no arg opens a menu and applies the choice', async () => {
    const { deps, config, specs } = makeDeps(() => 'high');
    await handleSlashCommand('/effort', deps);
    expect(specs[0]?.title).toBe('Reasoning effort');
    expect(config.reasoningEffort).toBe('high');
  });

  it('/effort keeps the current value when the menu is cancelled', async () => {
    const { deps, config } = makeDeps(() => null);
    config.reasoningEffort = 'low';
    await handleSlashCommand('/effort', deps);
    expect(config.reasoningEffort).toBe('low');
  });

  it('/effort with an explicit arg skips the menu', async () => {
    const { deps, config, specs } = makeDeps(() => 'high');
    await handleSlashCommand('/effort medium', deps);
    expect(specs).toHaveLength(0);
    expect(config.reasoningEffort).toBe('medium');
  });

  it('/permissions with no arg opens a menu and applies the mode', async () => {
    const { deps, permissions, specs } = makeDeps(() => 'plan');
    await handleSlashCommand('/permissions', deps);
    expect(specs[0]?.title).toBe('Permission mode');
    expect(permissions.getMode()).toBe('plan');
  });

  it('/pentest with no arg opens a menu and toggles via choice', async () => {
    const { deps, config } = makeDeps(() => 'on');
    await handleSlashCommand('/pentest', deps);
    expect(config.pentest).toBe(true);
  });
});
