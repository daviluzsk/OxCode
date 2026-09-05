import { createProvider, type ModelProvider } from './api/index.js';
import { Agent, nullHooks, type AgentHooks } from './agent/loop.js';
import { createTaskTool } from './agent/taskTool.js';
import { TodoStore } from './agent/todo.js';
import { buildSystemPrompt } from './agent/systemPrompt.js';
import { BrowserManager } from './browser/manager.js';
import type { CliOverrides } from './config/loader.js';
import { resolveConfig } from './config/loader.js';
import type { ResolvedConfig } from './config/types.js';
import { formatInstructions, loadInstructions } from './context/instructions.js';
import { detectRepoProfile, type RepoProfile } from './context/repo.js';
import { McpManager } from './mcp/manager.js';
import { PermissionManager, type Approver } from './permissions/manager.js';
import { Session, SessionStore } from './sessions/store.js';
import { createUseSkillTool, discoverSkills, formatSkillsForPrompt, type Skill } from './skills.js';
import { createBrowserTools } from './tools/browser.js';
import { createBuiltinRegistry } from './tools/index.js';
import { createPentestTools } from './tools/pentest.js';
import { createPentestProTools } from './tools/pentestPro.js';
import { createOffsecTools } from './tools/offsec.js';
import { createOsintTools } from './tools/osint.js';
import { createOxProxyTools } from './tools/oxproxy.js';
import { createKaliTools } from './tools/kali.js';
import { createSecurityToolTools } from './tools/toolrunner.js';
import { createKaliBoxTools } from './tools/kalibox.js';
import { ToolRegistry } from './tools/registry.js';
import { SwarmController } from './swarm/controller.js';

export interface Runtime {
  config: ResolvedConfig;
  provider: ModelProvider;
  registry: ToolRegistry;
  permissions: PermissionManager;
  session: Session;
  sessionStore: SessionStore;
  todoStore: TodoStore;
  profile: RepoProfile;
  skills: Skill[];
  mcp: McpManager | null;
  swarm: SwarmController;
  abort: AbortController;
  makeAgent(hooks?: AgentHooks, signal?: AbortSignal): Agent;
  /**
   * Throwaway side-conversation agent for /btw: fresh unsaved session,
   * read-only tools only, small turn budget. Safe to run while the main
   * agent is busy.
   */
  makeSideAgent(contextNote: string, hooks?: AgentHooks, signal?: AbortSignal): Agent;
  setModel(model: string): void;
  replaceSession(session: Session): void;
  dispose(): void;
}

export interface RuntimeOptions {
  cwd: string;
  cli?: CliOverrides;
  approver: Approver;
  hooks?: AgentHooks;
  /** Pre-loaded session (for --continue / --resume). */
  session?: Session;
  connectMcp?: boolean;
  env?: NodeJS.ProcessEnv;
}

export async function createRuntime(opts: RuntimeOptions): Promise<Runtime> {
  const config = resolveConfig({ cwd: opts.cwd, cli: opts.cli, env: opts.env });
  const provider = createProvider(config);
  const todoStore = new TodoStore();
  const registry = createBuiltinRegistry(todoStore);
  const permissions = new PermissionManager(config.permissionMode, opts.approver, () => config.pentest);
  const sessionStore = new SessionStore();
  const swarm = new SwarmController();
  const abort = new AbortController();

  const mcp = new McpManager();
  if (opts.connectMcp !== false) {
    await mcp.connectAll(config.cwd, registry);
  }

  const profile = await detectRepoProfile(config.cwd);
  const instructions = loadInstructions(config.cwd);
  const skills = discoverSkills(config.cwd);
  if (skills.length > 0) {
    registry.register(createUseSkillTool(skills));
  }

  const browser = new BrowserManager();
  for (const tool of createBrowserTools(browser)) {
    registry.register(tool);
  }
  // Pentest toolkit: registered always, but each tool refuses to run unless
  // config.pentest is ON (so /pentest toggling works without a restart).
  for (const tool of createPentestTools(config)) {
    registry.register(tool);
  }
  for (const tool of createPentestProTools(config)) {
    registry.register(tool);
  }
  for (const tool of createOffsecTools(config)) {
    registry.register(tool);
  }
  for (const tool of createOsintTools(config)) {
    registry.register(tool);
  }
  for (const tool of createOxProxyTools(config)) {
    registry.register(tool);
  }
  for (const tool of createKaliTools(config)) {
    registry.register(tool);
  }
  for (const tool of createSecurityToolTools(config)) {
    registry.register(tool);
  }
  for (const tool of createKaliBoxTools(config)) {
    registry.register(tool);
  }

  // Rebuilt on every agent creation so /system and /pentest take effect
  // from the next message without a restart.
  const buildPrompt = () =>
    buildSystemPrompt({
      cwd: config.cwd,
      profile,
      instructionsBlock: formatInstructions(instructions, config.cwd),
      permissionMode: config.permissionMode,
      appendSystemPrompt: config.appendSystemPrompt,
      pentest: config.pentest,
      mrRobot: config.mrRobot,
      swarmActive: swarm.running,
      skillsBlock: formatSkillsForPrompt(skills),
    });

  let session = opts.session ?? new Session(config.cwd, config.model);

  registry.register(
    createTaskTool({
      provider,
      config,
      registry,
      permissions,
      getSystemPrompt: buildPrompt,
      depth: 0,
      hooks: opts.hooks,
      swarm,
    }),
  );

  const runtime: Runtime = {
    config,
    provider,
    registry,
    permissions,
    get session() {
      return session;
    },
    sessionStore,
    todoStore,
    profile,
    skills,
    mcp,
    swarm,
    abort,
    makeAgent(hooks?: AgentHooks, signal?: AbortSignal) {
      return new Agent({
        provider,
        config,
        registry,
        permissions,
        session,
        systemPrompt: buildPrompt(),
        hooks: hooks ?? nullHooks,
        signal: signal ?? abort.signal,
      });
    },
    makeSideAgent(contextNote: string, hooks?: AgentHooks, signal?: AbortSignal) {
      const sideRegistry = new ToolRegistry();
      for (const t of registry.all()) {
        // read-only, non-mutating tools only — the side channel answers
        // questions, it never changes files, runs commands or spawns tasks.
        if (t.kind === 'read' && !t.mutating && t.name !== 'task') sideRegistry.register(t);
      }
      const sidePrompt =
        buildPrompt() +
        '\n\n# Side Conversation (/btw)\n\n' +
        'The user is asking a quick side question while the main task continues separately. ' +
        'Nothing you say here changes the main task, and this conversation is not saved.\n\n' +
        'Current state of the main task:\n' +
        contextNote +
        '\n\nAnswer briefly and factually from the state above, using read-only tools if needed. ' +
        'Do not start new work. If the user asks for an action, tell them to send it in the main input ' +
        '(or wait for the current run to finish).';
      return new Agent({
        provider,
        config: { ...config, maxTurns: Math.min(config.maxTurns, 10) },
        registry: sideRegistry,
        permissions,
        session: new Session(config.cwd, config.model),
        systemPrompt: sidePrompt,
        hooks: hooks ?? nullHooks,
        signal: signal ?? abort.signal,
      });
    },
    setModel(model: string) {
      config.model = model;
      session.data.model = model;
    },
    replaceSession(next: Session) {
      session = next;
    },
    dispose() {
      void mcp.closeAll();
      void browser.close();
      void swarm.stop();
    },
  };
  return runtime;
}
