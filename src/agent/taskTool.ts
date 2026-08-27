import { z } from 'zod';
import type { ModelProvider } from '../api/index.js';
import type { ResolvedConfig } from '../config/types.js';
import type { PermissionManager } from '../permissions/manager.js';
import { Session } from '../sessions/store.js';
import { ToolRegistry } from '../tools/registry.js';
import { err, ok, type ToolDefinition, type ToolResult } from '../tools/types.js';
import { truncateMiddle } from '../utils/truncate.js';
import { Agent, type AgentHooks } from './loop.js';
import { ORCHESTRATOR_ID, type SwarmController } from '../swarm/controller.js';

let AGENT_SEQ = 0;

/** Guess a worker "role" from the subtask description for the office viewer. */
function roleFor(description: string): string {
  const d = description.toLowerCase();
  if (/(review|audit|lint)/.test(d)) return 'reviewer';
  if (/(test|spec|coverage)/.test(d)) return 'tester';
  if (/(security|pentest|vuln|exploit|attack)/.test(d)) return 'security';
  if (/(explore|find|locate|search|map|investigate|read|understand)/.test(d)) return 'explorer';
  if (/(write|implement|build|add|fix|refactor|edit|code)/.test(d)) return 'coder';
  return 'worker';
}

const MAX_DEPTH = 2;
const SUBAGENT_MAX_TURNS = 30;

const schema = z.object({
  description: z.string().min(1).max(120).describe('Short label for the subtask.'),
  prompt: z.string().min(1).describe('Complete, self-contained instructions for the subagent.'),
  allowedTools: z.array(z.string()).optional().describe('Restrict the subagent to these tools.'),
});
type Args = z.infer<typeof schema>;

export interface TaskToolDeps {
  provider: ModelProvider;
  config: ResolvedConfig;
  registry: ToolRegistry;
  permissions: PermissionManager;
  /** Resolves the current base system prompt (reflects /system and /pentest changes). */
  getSystemPrompt: () => string;
  depth: number;
  /** Forward subtask activity to the UI. */
  hooks?: Pick<AgentHooks, 'onToolStart' | 'onToolEnd'>;
  /** Optional swarm bus: when the viewer is running, subtasks appear as workers. */
  swarm?: SwarmController;
}

/**
 * Bounded subtask/subagent support. A subtask gets a fresh conversation,
 * a restricted tool set (no recursive task spawning beyond MAX_DEPTH),
 * and returns a concise result to the parent agent.
 */
export function createTaskTool(deps: TaskToolDeps): ToolDefinition<Args> {
  return {
    name: 'task',
    description:
      'Run an isolated subtask with its own bounded context (e.g. repository exploration, ' +
      'test-failure investigation, code review). The subagent can use tools and returns a ' +
      'concise result. Give it complete, self-contained instructions. ' +
      'You may call task multiple times in a single turn to run several subagents in PARALLEL ' +
      '(e.g. one explores the backend, another explores the frontend) — keep it to ~4 at a time.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Short label.' },
        prompt: { type: 'string', description: 'Self-contained instructions.' },
        allowedTools: { type: 'array', items: { type: 'string' }, description: 'Optional tool allowlist.' },
      },
      required: ['description', 'prompt'],
    },
    schema,
    kind: 'read',
    mutating: false,
    summarize: (a) => a.description,
    async execute(args, ctx): Promise<ToolResult> {
      if (deps.depth >= MAX_DEPTH) {
        return err('Subtask depth limit reached — complete this work directly instead of delegating.');
      }
      const subRegistry = new ToolRegistry();
      for (const tool of deps.registry.all()) {
        if (tool.name === 'task') continue; // no unbounded recursion
        if (args.allowedTools && !args.allowedTools.includes(tool.name)) continue;
        subRegistry.register(tool);
      }
      const subSession = new Session(ctx.cwd, deps.config.model);
      const subConfig: ResolvedConfig = {
        ...deps.config,
        maxTurns: Math.min(deps.config.maxTurns, SUBAGENT_MAX_TURNS),
      };

      // --- Swarm wiring: register this subtask as a worker in the office ---
      const swarm = deps.swarm?.running ? deps.swarm : undefined;
      const agentId = `w${++AGENT_SEQ}`;
      const role = roleFor(args.description);
      let hivePrompt = '';
      if (swarm) {
        swarm.emit.spawned(agentId, args.description, role, ORCHESTRATOR_ID);
        swarm.emit.comm(ORCHESTRATOR_ID, agentId, `delegated: ${args.description}`);
        swarm.emit.status(agentId, 'thinking');
        // Hive memory: share what earlier workers already found.
        const notes = deps.swarm?.bus.blackboard() ?? [];
        if (notes.length > 0) {
          hivePrompt =
            '\n\n# Hive shared memory\n\nOther agents working in parallel have already shared these findings — build on them, do not repeat their work:\n' +
            notes.slice(-12).map((n) => `- ${n.note}`).join('\n');
        }
      }

      const agent = new Agent({
        provider: deps.provider,
        config: subConfig,
        registry: subRegistry,
        permissions: deps.permissions,
        session: subSession,
        systemPrompt:
          deps.getSystemPrompt() +
          '\n\n# Subtask Mode\n\nYou are a subtask of a larger agent. Complete the assignment below and return a concise, factual result — the parent agent only sees your final message.' +
          hivePrompt,
        depth: deps.depth + 1,
        hooks: {
          onTextDelta: () => {},
          onToolStart: (call, summary) => {
            if (swarm) {
              swarm.emit.status(agentId, 'working');
              swarm.emit.tool(agentId, call.name, summary, 'start');
            }
            deps.hooks?.onToolStart(call, `↳ ${summary}`);
          },
          onToolEnd: (call, result) => {
            if (swarm) swarm.emit.tool(agentId, call.name, '', 'end', !result.isError);
            deps.hooks?.onToolEnd(call, result);
          },
          onCompact: () => {},
          onError: (message) => {
            if (swarm) swarm.emit.say(agentId, `error: ${message}`);
          },
        },
        signal: ctx.signal,
      });
      const result = await agent.run(args.prompt);

      if (swarm) {
        // Post a short finding to the shared blackboard and report back.
        const summary = truncateMiddle(result.finalText || '(no output)', { maxChars: 160 }).text.replace(/\s+/g, ' ');
        swarm.emit.board(agentId, `${args.description} → ${summary}`);
        swarm.emit.comm(agentId, ORCHESTRATOR_ID, 'reporting results');
        swarm.emit.done(agentId, result.status === 'error' ? 'error' : 'done');
      }
      const t = truncateMiddle(result.finalText || '(subtask produced no text output)', { maxChars: 8000 });
      const header = `[subtask "${args.description}" finished: ${result.status}]\n\n`;
      if (result.status === 'error') {
        return err(header + (result.errorText ?? 'unknown error') + '\n\n' + t.text);
      }
      return ok(header + t.text, { kind: 'task', title: 'Task', detail: args.description });
    },
  };
}
