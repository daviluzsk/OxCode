import { z } from 'zod';
import type { ModelProvider } from '../api/index.js';
import type { ResolvedConfig } from '../config/types.js';
import type { PermissionManager } from '../permissions/manager.js';
import { Session } from '../sessions/store.js';
import { ToolRegistry } from '../tools/registry.js';
import { err, ok, type ToolDefinition, type ToolResult } from '../tools/types.js';
import { truncateMiddle } from '../utils/truncate.js';
import { Agent, type AgentHooks } from './loop.js';

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
      const agent = new Agent({
        provider: deps.provider,
        config: subConfig,
        registry: subRegistry,
        permissions: deps.permissions,
        session: subSession,
        systemPrompt: deps.getSystemPrompt() + '\n\n# Subtask Mode\n\nYou are a subtask of a larger agent. Complete the assignment below and return a concise, factual result — the parent agent only sees your final message.',
        depth: deps.depth + 1,
        hooks: {
          onTextDelta: () => {},
          onToolStart: (call, summary) => deps.hooks?.onToolStart(call, `↳ ${summary}`),
          onToolEnd: (call, result) => deps.hooks?.onToolEnd(call, result),
          onCompact: () => {},
          onError: () => {},
        },
        signal: ctx.signal,
      });
      const result = await agent.run(args.prompt);
      const t = truncateMiddle(result.finalText || '(subtask produced no text output)', { maxChars: 8000 });
      const header = `[subtask "${args.description}" finished: ${result.status}]\n\n`;
      if (result.status === 'error') {
        return err(header + (result.errorText ?? 'unknown error') + '\n\n' + t.text);
      }
      return ok(header + t.text, { kind: 'task', title: 'Task', detail: args.description });
    },
  };
}
