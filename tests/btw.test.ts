import { afterEach, describe, expect, it } from 'vitest';
import { handleSlashCommand, type CommandDeps, type CommandHost } from '../src/commands/slash.js';
import { defaultConfig, type ResolvedConfig } from '../src/config/types.js';
import { PermissionManager } from '../src/permissions/manager.js';
import { Session, SessionStore } from '../src/sessions/store.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { SwarmController } from '../src/swarm/controller.js';
import { cleanup, makeTempDir } from './helpers.js';

let dir = '';
afterEach(() => {
  if (dir) cleanup(dir);
  dir = '';
});

function makeDeps(host: Partial<CommandHost> & Pick<CommandHost, 'btw'>): { deps: CommandDeps; printed: string[] } {
  const printed: string[] = [];
  const session = new Session(dir, 'test-model');
  const config: ResolvedConfig = { ...defaultConfig, cwd: dir, apiKey: undefined };
  const deps: CommandDeps = {
    host: {
      print: (t) => printed.push(t),
      clear: () => {},
      requestExit: () => {},
      setModel: () => {},
      pickSession: async () => null,
      pickModel: async () => null,
      pickChoice: async () => null,
      loadSession: () => {},
      ...host,
    },
    session: () => session,
    agent: () => {
      throw new Error('not needed');
    },
    config,
    permissions: new PermissionManager('default', async () => 'yes'),
    sessionStore: new SessionStore(),
    registry: new ToolRegistry(),
    mcp: null,
    profile: null,
    skills: [],
    swarm: new SwarmController(),
  };
  return { deps, printed };
}

describe('/btw command', () => {
  it('forwards the question to the host without touching the session', async () => {
    dir = makeTempDir();
    const seen: string[] = [];
    const { deps } = makeDeps({ btw: (t) => seen.push(t) });
    const outcome = await handleSlashCommand('/btw o que você está fazendo?', deps);
    expect(outcome.kind).toBe('handled');
    expect(seen).toEqual(['o que você está fazendo?']);
    expect(deps.session().messages).toHaveLength(0);
  });

  it('shows usage when no question is given', async () => {
    dir = makeTempDir();
    const seen: string[] = [];
    const { deps, printed } = makeDeps({ btw: (t) => seen.push(t) });
    const outcome = await handleSlashCommand('/btw', deps);
    expect(outcome.kind).toBe('handled');
    expect(seen).toHaveLength(0);
    expect(printed.join('\n')).toContain('/btw');
  });
});
