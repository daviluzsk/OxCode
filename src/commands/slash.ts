import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import type { Agent } from '../agent/loop.js';
import type { ResolvedConfig } from '../config/types.js';
import type { RepoProfile } from '../context/repo.js';
import type { McpManager } from '../mcp/manager.js';
import type { PermissionManager } from '../permissions/manager.js';
import type { Session } from '../sessions/store.js';
import { Session as SessionClass, type SessionStore } from '../sessions/store.js';
import type { Skill } from '../skills.js';
import { isGitRepo } from '../tools/git.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { SwarmController } from '../swarm/controller.js';
import { openInBrowser } from '../utils/openBrowser.js';
import { pasteClipboardImage } from '../utils/clipboard.js';
import { maskKey } from '../utils/redact.js';
import { estimateTokens } from '../utils/truncate.js';
import { expandCustomCommand, loadCustomCommands } from './custom.js';

/** Side effects the host (UI or headless) must provide. */
export interface CommandHost {
  print(text: string): void;
  clear(): void;
  requestExit(): void;
  setModel(model: string): void;
  /** Show an interactive session picker; returns a session id or null. */
  pickSession(): Promise<string | null>;
  /** Show an interactive model picker; returns a model id or null. */
  pickModel(current: string): Promise<string | null>;
  /** Show a generic single-choice picker; returns the chosen id or null (cancelled). */
  pickChoice(spec: ChoiceSpec): Promise<string | null>;
  /** Toggle the red "Mr Robot" / fsociety theme in the UI. */
  setMrRobot(on: boolean): void;
  /** Replace the active session (used by /resume and --continue). */
  loadSession(session: Session): void;
  /** Fire a side question (/btw) without touching the main conversation. */
  btw(text: string): void;
}

export interface CommandDeps {
  host: CommandHost;
  session: () => Session;
  agent: () => Agent;
  config: ResolvedConfig;
  permissions: PermissionManager;
  sessionStore: SessionStore;
  registry: ToolRegistry;
  mcp: McpManager | null;
  profile: RepoProfile | null;
  skills: Skill[];
  swarm: SwarmController;
}

/** One row in the generic interactive picker (see CommandHost.pickChoice). */
export interface ChoiceOption {
  id: string;
  label?: string;
  note?: string;
}

export interface ChoiceSpec {
  title: string;
  options: ChoiceOption[];
  current?: string;
}

export type CommandOutcome =
  | { kind: 'handled' }
  | { kind: 'prompt'; text: string }
  | { kind: 'unknown'; name: string };

/** Curated models offered by the interactive /model picker. */
// Model /mrrobot auto-switches to. A weak/free model = hours of noise; use a
// strong reasoner. Override with OX_MRROBOT_MODEL.
export const DEFAULT_MRROBOT_MODEL = process.env.OX_MRROBOT_MODEL || 'deepseek/deepseek-v4-pro-0813';

// Curated for pentest reasoning + tool use, cheapest-first within each tier.
// Prices per 1M tokens (in/out), OpenRouter, verified 2026-08. ⚔ = pentest pick.
export const MODEL_PRESETS: Array<{ id: string; note: string }> = [
  // Free — start here
  { id: 'minimax/minimax-m3:free', note: 'MiniMax M3 — free, 1M ctx (default, fast & stable)' },
  { id: 'z-ai/glm-5.2:free', note: 'GLM 5.2 — free, strong reasoning' },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', note: 'Nemotron 3 Ultra 550B — free, big' },
  // Cheap pentest — best value ⚔
  { id: 'z-ai/glm-5.3-flash', note: '⚔ GLM 5.3 Flash — $0.07/$0.25, 1.3M ctx (cheapest strong)' },
  { id: 'qwen/qwen3.8-flash', note: '⚔ Qwen3.8 Flash — $0.15/$0.47, 1M ctx (best cheap pentest)' },
  { id: 'deepseek/deepseek-v4-flash', note: 'DeepSeek V4 Flash — $0.08/$0.16, fast' },
  // Mid — deeper adaptive reasoning ⚔
  { id: 'moonshotai/kimi-k2-thinking', note: '⚔ Kimi K2 Thinking — $0.60/$2.50, 262k (agentic)' },
  { id: 'deepseek/deepseek-v4-pro-0813', note: '⚔ DeepSeek V4 Pro — $0.66/$1.98, 1M ctx (best deep-reason value)' },
  { id: 'qwen/qwen3-max-thinking', note: '⚔ Qwen3 Max Thinking — $0.78/$3.90, 262k (top reasoning)' },
  // Flagship
  { id: 'z-ai/glm-5.3', note: 'GLM 5.3 — $1.40/$4.40, 1.3M ctx (flagship)' },
  { id: 'moonshotai/kimi-k3', note: 'Kimi K3 — NVIDIA API, premium' },
  // NVIDIA API (needs nvidiaApiKey)
  { id: 'deepseek-ai/deepseek-v4-pro-0813', note: 'DeepSeek V4 Pro — NVIDIA API' },
  { id: 'deepseek-ai/deepseek-v4-flash-0731', note: 'DeepSeek V4 Flash — NVIDIA API' },
  { id: 'openrouter/auto', note: 'OpenRouter auto-router' },
];

export const BUILTIN_COMMANDS: Array<{ name: string; description: string }> = [
  { name: 'help', description: 'Show available commands' },
  { name: 'clear', description: 'Start a fresh conversation (repository files are untouched)' },
  { name: 'compact', description: 'Compact conversation history into a state summary' },
  { name: 'context', description: 'Show approximate context usage' },
  { name: 'cost', description: 'Show token usage for this session' },
  { name: 'model', description: 'Show or change the model (/model <name>)' },
  { name: 'effort', description: 'Pick reasoning effort (/effort with no arg opens a menu)' },
  { name: 'system', description: 'Set a custom instruction the agent always follows (/system <text>|off|--save)' },
  { name: 'skills', description: 'List installed skills (.ox/skills)' },
  { name: 'pentest', description: 'Pentest mode on/off (/pentest opens a menu)' },
  { name: 'mrrobot', description: 'fsociety mode: pentest + red "Mr Robot" hacker theme' },
  { name: 'btw', description: 'Side question without interrupting the current run' },
  { name: 'swarm', description: 'Open the 3D swarm office visualization (/swarm off to stop)' },
  { name: 'paste', description: 'Save a clipboard image into the workspace to attach with @' },
  { name: 'update', description: 'Update OxCode to the latest version (git pull + rebuild)' },
  { name: 'status', description: 'Show model, repository, permissions and session info' },
  { name: 'config', description: 'Show the resolved configuration' },
  { name: 'permissions', description: 'Pick the permission mode (/permissions opens a menu)' },
  { name: 'diff', description: 'Show the current Git diff' },
  { name: 'git', description: 'Show Git status' },
  { name: 'init', description: 'Analyze the repository and create OX.md' },
  { name: 'resume', description: 'Resume a previous session' },
  { name: 'doctor', description: 'Diagnose environment, API config and tools' },
  { name: 'mcp', description: 'Show MCP server status' },
  { name: 'exit', description: 'Exit OxCode' },
];

export async function handleSlashCommand(input: string, deps: CommandDeps): Promise<CommandOutcome> {
  const space = input.indexOf(' ');
  const name = (space === -1 ? input.slice(1) : input.slice(1, space)).toLowerCase();
  const arg = space === -1 ? '' : input.slice(space + 1).trim();
  const { host, config, permissions, sessionStore, registry } = deps;

  switch (name) {
    case 'help': {
      const custom = loadCustomCommands(config.cwd);
      const lines = BUILTIN_COMMANDS.map((c) => `  /${c.name.padEnd(14)} ${c.description}`);
      const customLines = [...custom.values()].map((c) => `  /${c.name.padEnd(14)} ${c.description} (custom)`);
      host.print(`Available commands:\n${lines.join('\n')}${customLines.length ? `\n\nCustom commands (.ox/commands/):\n${customLines.join('\n')}` : ''}`);
      return { kind: 'handled' };
    }

    case 'exit':
    case 'quit':
      host.requestExit();
      return { kind: 'handled' };

    case 'clear': {
      host.loadSession(new SessionClass(config.cwd, config.model));
      host.clear();
      host.print('Started a fresh conversation.');
      return { kind: 'handled' };
    }

    case 'compact': {
      host.print('Compacting conversation…');
      const did = await deps.agent().compact();
      host.print(did ? 'Conversation compacted into a state summary.' : 'Conversation is still short — nothing to compact.');
      return { kind: 'handled' };
    }

    case 'context': {
      const msgs = deps.session().messages;
      let total = 0;
      const files = new Set<string>();
      for (const m of msgs) {
        const text = typeof m.content === 'string' ? m.content : '';
        total += estimateTokens(text);
        if (m.role === 'tool') {
          const match = text.match(/<file path="([^"]+)"/);
          if (match?.[1]) files.add(match[1]);
        }
      }
      host.print(
        [
          `Messages: ${msgs.length}`,
          `Estimated context: ~${total.toLocaleString()} tokens (compacts at ${config.compactThreshold.toLocaleString()})`,
          `Compactions so far: ${deps.session().data.compactions}`,
          files.size ? `Files loaded in context:\n${[...files].map((f) => `  ${f}`).join('\n')}` : 'No file contents loaded yet.',
        ].join('\n'),
      );
      return { kind: 'handled' };
    }

    case 'cost': {
      const u = deps.session().data.usage;
      host.print(
        [
          `Session token usage:`,
          `  Requests:      ${u.requests}`,
          `  Input tokens:  ${u.inputTokens.toLocaleString()}${u.cachedTokens ? `  (${u.cachedTokens.toLocaleString()} cached — billed cheaper)` : ''}`,
          `  Output tokens: ${u.outputTokens.toLocaleString()}`,
          `  Cost: pricing for "${config.model}" is not configured — token counts only.`,
        ].join('\n'),
      );
      return { kind: 'handled' };
    }

    case 'model': {
      if (arg) {
        host.setModel(arg);
        host.print(`Model changed to: ${arg}`);
        return { kind: 'handled' };
      }
      const picked = await host.pickModel(config.model);
      if (picked) {
        host.setModel(picked);
        host.print(`Model changed to: ${picked}`);
      } else {
        host.print(`Current model: ${config.model} (unchanged)`);
      }
      return { kind: 'handled' };
    }

    case 'effort': {
      const applyEffort = (value: string): void => {
        if (value === 'off' || value === 'none' || value === 'default') {
          config.reasoningEffort = undefined;
          host.print('Reasoning effort cleared — the provider default will be used.');
        } else if (value === 'low' || value === 'medium' || value === 'high') {
          config.reasoningEffort = value;
          host.print(`Reasoning effort set to: ${value} (applies from the next request).`);
        } else {
          host.print(`Unknown effort "${value}". Expected low, medium or high.`);
        }
      };
      if (arg) {
        applyEffort(arg);
        return { kind: 'handled' };
      }
      const picked = await host.pickChoice({
        title: 'Reasoning effort',
        current: config.reasoningEffort ?? 'off',
        options: [
          { id: 'off', label: 'off', note: 'provider default' },
          { id: 'low', label: 'low', note: 'fastest, cheapest' },
          { id: 'medium', label: 'medium', note: 'balanced' },
          { id: 'high', label: 'high', note: 'most thorough, slowest' },
        ],
      });
      if (picked) applyEffort(picked);
      else host.print(`Reasoning effort: ${config.reasoningEffort ?? '(provider default)'} (unchanged)`);
      return { kind: 'handled' };
    }

    case 'system': {
      if (!arg) {
        host.print(
          config.appendSystemPrompt
            ? `Custom system instructions (active):\n${config.appendSystemPrompt}\n\nClear with: /system off`
            : 'No custom system instructions set.\nUsage: /system <text> — session only · /system --save <text> — persist in .ox/settings.json · /system off — clear',
        );
        return { kind: 'handled' };
      }
      if (arg === 'off') {
        config.appendSystemPrompt = undefined;
        host.print('Custom system instructions cleared (applies from the next message).');
        return { kind: 'handled' };
      }
      const save = arg.startsWith('--save');
      const text = (save ? arg.slice('--save'.length) : arg).trim();
      if (!text) {
        host.print('Usage: /system <text> · /system --save <text> · /system off');
        return { kind: 'handled' };
      }
      config.appendSystemPrompt = text;
      if (save) {
        try {
          const file = saveProjectSetting(config.cwd, 'appendSystemPrompt', text);
          host.print(`Custom instructions saved to ${file} and active from the next message.`);
        } catch (e) {
          host.print(`Active for this session, but saving failed: ${(e as Error).message}`);
        }
      } else {
        host.print('Custom instructions active from the next message (this session only — use /system --save to persist).');
      }
      return { kind: 'handled' };
    }

    case 'skills': {
      if (deps.skills.length === 0) {
        host.print(
          'No skills installed.\nCreate one at .ox/skills/<name>/SKILL.md (project) or ~/.ox/skills/<name>/SKILL.md (user), ' +
            'with optional frontmatter:\n\n---\nname: review\ndescription: Senior code review checklist\n---\n\n# Review\n…instructions…',
        );
      } else {
        const lines = deps.skills.map((s) => `  ${s.name.padEnd(18)} ${s.description} [${s.scope}]`);
        host.print(`Installed skills (agent loads them with the use_skill tool):\n${lines.join('\n')}`);
      }
      return { kind: 'handled' };
    }

    case 'pentest': {
      const announce = (): void =>
        host.print(
          config.pentest
            ? 'Pentest mode ON — security-testing methodology is now in the system prompt, and the pentest toolkit runs without per-call approval prompts.\n⚠ Use only on targets you own or are explicitly authorized to test.'
            : 'Pentest mode OFF.',
        );
      const lc = arg.toLowerCase();
      if (lc === 'on' || lc === 'off') {
        config.pentest = lc === 'on';
        announce();
      } else if (arg) {
        // any other explicit arg keeps the legacy toggle behavior
        config.pentest = !config.pentest;
        announce();
      } else {
        const picked = await host.pickChoice({
          title: 'Pentest mode',
          current: config.pentest ? 'on' : 'off',
          options: [
            { id: 'off', label: 'off', note: 'normal coding assistant' },
            { id: 'on', label: 'on', note: 'authorized security-testing methodology ⚠' },
          ],
        });
        if (picked === 'on' || picked === 'off') {
          config.pentest = picked === 'on';
          announce();
        } else {
          host.print(`Pentest mode: ${config.pentest ? 'on' : 'off'} (unchanged)`);
        }
      }
      return { kind: 'handled' };
    }

    case 'btw': {
      if (!arg) {
        host.print('Usage: /btw <question> — quick side question about what the agent is doing, without interrupting the current run.');
        return { kind: 'handled' };
      }
      host.btw(arg);
      return { kind: 'handled' };
    }

    case 'mrrobot': {
      const on = !config.mrRobot; // toggle fsociety elite mode
      config.pentest = on; // rides on pentest (tools + gating)
      config.mrRobot = on; // + elite offensive-reasoning playbook in the prompt
      config.reasoningEffort = on ? 'high' : undefined; // think hard (reasoning models)
      host.setMrRobot(on);
      // Auto-switch model: a weak model reasons badly and burns hours finding
      // nothing. Stash the current model, run on a strong reasoner, restore on off.
      let modelNote = '';
      if (on) {
        if (config.model !== DEFAULT_MRROBOT_MODEL) {
          config.mrRobotPrevModel = config.model;
          host.setModel(DEFAULT_MRROBOT_MODEL);
          modelNote = `\nModel → ${config.model} (strong reasoning; override with OX_MRROBOT_MODEL or /model).`;
        }
      } else if (config.mrRobotPrevModel) {
        const prev = config.mrRobotPrevModel;
        config.mrRobotPrevModel = undefined;
        host.setModel(prev);
        modelNote = `\nModel → ${config.model}.`;
      }
      host.print(
        on
          ? "Hello, friend. fsociety mode engaged — elite offensive reasoning + full toolkit are live.\nGive me a target and I'll recon it, map the surface, predict the likely flaws, test them in parallel, then hunt the non-obvious ones.\n⚠ Only touch targets you're authorized to test." + modelNote
          : 'fsociety mode disengaged. Back to normal.' + modelNote,
      );
      return { kind: 'handled' };
    }

    case 'update': {
      const { checkForUpdate, applyUpdate } = await import('../updater.js');
      host.print('Checking for updates…');
      const info = await checkForUpdate(config.cwd);
      if (!info) { host.print('Not a git clone or offline — cannot auto-update. Reinstall from https://github.com/daviluzsk/OxCode'); return { kind: 'handled' }; }
      if (info.behind === 0) { host.print('Already up to date. ✅'); return { kind: 'handled' }; }
      host.print(`${info.behind} update(s) available (latest ${info.latest}). Updating…`);
      const r = await applyUpdate(config.cwd, (l) => host.print(`  ${l}`));
      host.print(r.ok ? '✅ Updated. Restart OxCode to run the new version.' : `⚠ Update failed:\n${r.log}`);
      return { kind: 'handled' };
    }

    case 'paste': {
      try {
        const rel = await pasteClipboardImage(config.cwd);
        host.print(`🖼  Saved clipboard image → ${rel}\nAttach it in your next message, e.g.  @${rel} what does this show?`);
      } catch (e) {
        host.print(`No image pasted: ${(e as Error).message}`);
      }
      return { kind: 'handled' };
    }

    case 'swarm': {
      const swarm = deps.swarm;
      if (arg === 'off' || arg === 'stop') {
        if (swarm.running) {
          await swarm.stop();
          host.print('Swarm viewer stopped.');
        } else {
          host.print('Swarm viewer is not running.');
        }
        return { kind: 'handled' };
      }
      const url = await swarm.start();
      const opened = arg === 'no-open' ? false : openInBrowser(url);
      host.print(
        `🐝 Swarm office live at ${url}\n` +
          'Parallel subtasks (the agent\'s `task` calls) now appear as workers in a 3D office — ' +
          'they move, talk, share findings on the blackboard and hand results back to the orchestrator.\n' +
          (opened ? 'Opened in your browser.' : `Open it in your browser: ${url}`) +
          '\nTip: ask for something big and say "split the work across parallel agents". /swarm off to stop.',
      );
      return { kind: 'handled' };
    }

    case 'status': {
      const s = deps.session();
      host.print(
        [
          `Model:           ${config.model}${config.reasoningEffort ? ` (${config.reasoningEffort})` : ''}`,
          `Provider:        ${config.provider} (${config.baseUrl})`,
          `Repository:      ${config.cwd}`,
          `Git branch:      ${deps.profile?.gitBranch ?? '(not a git repo)'}`,
          `Permission mode: ${permissions.getMode()}`,
          `Session:         ${s.data.id}`,
          `Messages:        ${s.messages.length}`,
        ].join('\n'),
      );
      return { kind: 'handled' };
    }

    case 'config': {
      host.print(
        [
          `model:            ${config.model}`,
          `provider:         ${config.provider}`,
          `baseUrl:          ${config.baseUrl}`,
          `apiKey:           ${maskKey(config.apiKey)}`,
          `permissionMode:   ${config.permissionMode}`,
          `maxTurns:         ${config.maxTurns}`,
          `stream:           ${config.stream}`,
          `compactThreshold: ${config.compactThreshold}`,
          `cwd:              ${config.cwd}`,
        ].join('\n'),
      );
      return { kind: 'handled' };
    }

    case 'permissions': {
      const isMode = (v: string): v is 'default' | 'askAll' | 'acceptEdits' | 'plan' | 'dangerouslySkipPermissions' =>
        v === 'default' || v === 'askAll' || v === 'acceptEdits' || v === 'plan' || v === 'dangerouslySkipPermissions';
      const applyMode = (mode: string): void => {
        if (!isMode(mode)) {
          host.print(`Unknown mode "${mode}". Expected: default | askAll | acceptEdits | plan | dangerouslySkipPermissions`);
          return;
        }
        permissions.setMode(mode);
        host.print(`Permission mode set to: ${mode}${mode === 'dangerouslySkipPermissions' ? ' — every tool now runs without asking. Be careful.' : ''}${mode === 'askAll' ? ' — every action will ask first. Use "Yes, and allow similar this session" to reduce friction.' : ''}`);
      };
      if (arg) {
        applyMode(arg);
        return { kind: 'handled' };
      }
      const picked = await host.pickChoice({
        title: 'Permission mode',
        current: permissions.getMode(),
        options: [
          { id: 'default', label: 'default', note: 'reads free; edits/clicks/risky commands ask' },
          { id: 'askAll', label: 'askAll', note: 'every action asks first' },
          { id: 'acceptEdits', label: 'acceptEdits', note: 'edits/clicks auto; destructive shell asks' },
          { id: 'plan', label: 'plan', note: 'inspect & plan only — no mutations' },
          { id: 'dangerouslySkipPermissions', label: 'dangerouslySkipPermissions', note: 'everything runs without asking ⚠' },
        ],
      });
      if (picked) applyMode(picked);
      else host.print(`Permission mode: ${permissions.getMode()} (unchanged)`);
      return { kind: 'handled' };
    }

    case 'diff':
    case 'git': {
      const tool = registry.get(name === 'diff' ? 'git_diff' : 'git_status');
      if (!tool) return { kind: 'unknown', name };
      const res = await tool.execute({} as never, { cwd: config.cwd });
      host.print(res.content);
      return { kind: 'handled' };
    }

    case 'init': {
      return {
        kind: 'prompt',
        text:
          'Analyze this repository and create an OX.md instruction file at the repository root. ' +
          'Explore the structure, read key configuration and entry files, then write a concise OX.md ' +
          'covering: project purpose, tech stack, build/test commands, directory layout, code conventions, ' +
          'and anything an AI coding agent must know to work here safely. If OX.md already exists, ' +
          'review and improve it instead of overwriting blindly.',
      };
    }

    case 'resume': {
      const id = await host.pickSession();
      if (!id) {
        host.print('Resume cancelled.');
        return { kind: 'handled' };
      }
      const session = sessionStore.load(id);
      if (!session) {
        host.print(`Could not load session ${id}.`);
        return { kind: 'handled' };
      }
      host.loadSession(session);
      host.print(`Resumed session ${session.data.id} (${session.messages.length} messages).`);
      return { kind: 'handled' };
    }

    case 'doctor': {
      host.print(await runDoctor(deps));
      return { kind: 'handled' };
    }

    case 'mcp': {
      if (!deps.mcp || deps.mcp.statuses.length === 0) {
        host.print('No MCP servers configured. Add one with: ox mcp add <name> -- <command> [args...]');
      } else {
        const lines = deps.mcp.statuses.map((s) =>
          s.status === 'connected'
            ? `  ✓ ${s.name} — ${s.tools.length} tool${s.tools.length === 1 ? '' : 's'}`
            : `  ✗ ${s.name} — failed: ${s.error}`,
        );
        host.print(`MCP servers:\n${lines.join('\n')}`);
      }
      return { kind: 'handled' };
    }

    default: {
      const custom = loadCustomCommands(config.cwd);
      const cmd = custom.get(name);
      if (cmd) {
        return { kind: 'prompt', text: expandCustomCommand(cmd, arg) };
      }
      return { kind: 'unknown', name };
    }
  }
}

/** Merge a key into the project settings file (<cwd>/.ox/settings.json). */
function saveProjectSetting(cwd: string, key: string, value: unknown): string {
  const dir = path.join(cwd, '.ox');
  const file = path.join(dir, 'settings.json');
  let existing: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  } catch {
    /* missing or invalid file — start fresh */
  }
  existing[key] = value;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(existing, null, 2) + '\n', 'utf8');
  return file;
}

async function check(name: string, fn: () => Promise<string>): Promise<string> {
  try {
    return `  ✓ ${name}: ${await fn()}`;
  } catch (e) {
    return `  ✗ ${name}: ${(e as Error).message}`;
  }
}

async function runDoctor(deps: CommandDeps): Promise<string> {
  const { config } = deps;
  const lines: string[] = ['OxCode doctor'];

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  lines.push(nodeMajor >= 22 ? `  ✓ Node.js: ${process.version}` : `  ✗ Node.js: ${process.version} (Node 22+ required)`);

  lines.push(await check('Git', async () => (await execa('git', ['--version'], { timeout: 5000 })).stdout.trim()));
  lines.push(
    (await check('ripgrep', async () => (await execa('rg', ['--version'], { timeout: 5000 })).stdout.split('\n')[0]!.trim())) +
      ' (optional — Node fallback is used when missing)',
  );
  lines.push(`  ✓ Shell: ${process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'}`);
  lines.push(
    (await isGitRepo(config.cwd)) ? `  ✓ Repository: git repo at ${config.cwd}` : `  ⚠ Repository: ${config.cwd} is not a git repo`,
  );
  lines.push(config.apiKey ? `  ✓ API key: ${maskKey(config.apiKey)}` : '  ✗ API key: not set (set OPENROUTER_API_KEY)');

  if (config.apiKey && config.provider === 'openrouter') {
    lines.push(
      await check('Provider connectivity', async () => {
        const res = await fetch(`${config.baseUrl.replace(/\/$/, '')}/models`, {
          headers: { Authorization: `Bearer ${config.apiKey}` },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return `${config.baseUrl} reachable`;
      }),
    );
  }

  const settingsFile = path.join(config.cwd, '.ox', 'settings.json');
  lines.push(fs.existsSync(settingsFile) ? `  ✓ Project settings: ${settingsFile}` : '  · Project settings: none (using defaults)');
  return lines.join('\n');
}
