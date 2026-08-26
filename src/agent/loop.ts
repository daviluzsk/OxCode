import { ApiError, collectStream, type ChatMessage, type ContentPart, type ModelProvider, type ToolCallRequest, type UsageInfo } from '../api/index.js';
import type { ResolvedConfig } from '../config/types.js';
import type { PermissionManager } from '../permissions/manager.js';
import type { ToolRegistry } from '../tools/registry.js';
import { err as toolErr, validateArgs, type ToolResult } from '../tools/types.js';
import type { Session } from '../sessions/store.js';
import { estimateTokens } from '../utils/truncate.js';
import { logger } from '../utils/logger.js';

export type RunStatus = 'completed' | 'cancelled' | 'error' | 'max-turns';

export interface RunResult {
  status: RunStatus;
  finalText: string;
  errorText?: string;
}

export interface AgentHooks {
  onTextDelta(text: string): void;
  onToolStart(call: ToolCallRequest, summary: string): void;
  onToolEnd(call: ToolCallRequest, result: ToolResult): void;
  onCompact(beforeMessages: number, afterMessages: number): void;
  onError(message: string): void;
}

export const nullHooks: AgentHooks = {
  onTextDelta: () => {},
  onToolStart: () => {},
  onToolEnd: () => {},
  onCompact: () => {},
  onError: () => {},
};

export interface AgentDeps {
  provider: ModelProvider;
  config: ResolvedConfig;
  registry: ToolRegistry;
  permissions: PermissionManager;
  session: Session;
  systemPrompt: string;
  hooks?: AgentHooks;
  signal?: AbortSignal;
  /** Internal: subtask recursion guard. */
  depth?: number;
}

function messageText(m: ChatMessage): string {
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) {
    return m.content.map((p) => (p.type === 'text' ? p.text : '[image]')).join('');
  }
  return '';
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    total += estimateTokens(messageText(m));
    if (m.tool_calls) {
      for (const tc of m.tool_calls) total += estimateTokens(tc.argumentsJson) + 10;
    }
  }
  return total;
}

const COMPACTION_PROMPT = `You are compacting a long coding-agent conversation to preserve its state in limited space.

Produce a compact state summary with exactly these sections:

OBJECTIVE: what the user asked for, in one or two sentences.
COMPLETED: concrete work already done.
MODIFIED FILES: paths that were created or changed, with one-line notes.
DECISIONS: important implementation decisions and why.
PROBLEMS: unresolved issues, failing tests, blockers.
CODE LOCATIONS: relevant files/symbols the next steps depend on.
NEXT: the most likely next actions.

Be dense and factual. Preserve exact file paths, identifiers, command outputs that matter, and error messages. Do not include pleasantries.`;

/**
 * The OxCode agent: an iterative model ↔ tool loop that keeps working
 * until the model stops requesting tools, the user cancels, or the turn
 * budget is exhausted.
 */
export class Agent {
  private readonly deps: AgentDeps;
  private readonly hooks: AgentHooks;
  /**
   * Images produced by tool results (screenshots), delivered to the model as
   * one transient user message on the next request only — never persisted.
   */
  private pendingImageMessage: ChatMessage | null = null;

  constructor(deps: AgentDeps) {
    this.deps = deps;
    this.hooks = deps.hooks ?? nullHooks;
  }

  private requestMessages(): ChatMessage[] {
    return [
      { role: 'system', content: this.deps.systemPrompt },
      ...this.deps.session.messages,
      ...(this.pendingImageMessage ? [this.pendingImageMessage] : []),
    ];
  }

  /** Run one user request to completion (possibly many tool rounds). */
  async run(userContent: string | ContentPart[]): Promise<RunResult> {
    const { provider, config, session, registry, permissions } = this.deps;
    session.messages.push({ role: 'user', content: userContent });
    let turns = 0;
    let lastText = '';

    while (turns < config.maxTurns) {
      if (this.deps.signal?.aborted) return { status: 'cancelled', finalText: lastText };
      turns++;

      await this.maybeCompact();

      let response;
      try {
        response = await collectStream(
          provider.stream({
            model: config.model,
            messages: this.requestMessages(),
            tools: registry.specs(),
            signal: this.deps.signal,
            reasoningEffort: config.reasoningEffort,
          }),
          (delta) => this.hooks.onTextDelta(delta),
        );
      } catch (e) {
        if (e instanceof ApiError && e.kind === 'cancelled') {
          return { status: 'cancelled', finalText: lastText };
        }
        const msg = e instanceof Error ? e.message : String(e);
        this.hooks.onError(msg);
        // Give the model the error as context once, so a transient tool-arg
        // mistake can be repaired; provider errors end the run.
        return { status: 'error', finalText: lastText, errorText: msg };
      }
      // The transient image message (if any) was included in this request —
      // deliver it exactly once.
      this.pendingImageMessage = null;

      if (response.usage) session.addUsage(response.usage);
      if (response.finishReason === 'cancelled') return { status: 'cancelled', finalText: lastText };

      lastText = response.text || lastText;
      session.messages.push({
        role: 'assistant',
        content: response.text || null,
        ...(response.toolCalls.length > 0 ? { tool_calls: response.toolCalls } : {}),
      });

      if (response.toolCalls.length === 0) {
        return { status: 'completed', finalText: response.text };
      }

      // Execute tool calls: consecutive read-only calls run in parallel,
      // mutating/executing calls run sequentially in order.
      const results: ToolResult[] = new Array(response.toolCalls.length);
      let i = 0;
      while (i < response.toolCalls.length) {
        const call = response.toolCalls[i]!;
        const tool = registry.get(call.name);
        const isParallelRead = tool && tool.kind === 'read' && !tool.mutating;
        if (isParallelRead) {
          // gather the run of consecutive read-only calls
          let j = i;
          while (j < response.toolCalls.length) {
            const c = response.toolCalls[j]!;
            const t = registry.get(c.name);
            if (!t || t.kind !== 'read' || t.mutating) break;
            j++;
          }
          const group = response.toolCalls.slice(i, j);
          const groupResults = await Promise.all(
            group.map((c) => this.executeCall(c, registry.get(c.name)!)),
          );
          groupResults.forEach((r, k) => (results[i + k] = r));
          i = j;
          continue;
        }
        results[i] = await this.executeCall(call, tool ?? null);
        i++;
      }

      for (let k = 0; k < response.toolCalls.length; k++) {
        const call = response.toolCalls[k]!;
        const res = results[k] ?? toolErr('Internal error: missing tool result.');
        session.messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.name,
          content: res.content.slice(0, 60_000),
        });
      }

      // Screenshots and other image outputs ride along as one transient
      // user message on the next request (not persisted to the session).
      const images = results.flatMap((r) => r?.images ?? []);
      if (images.length > 0) {
        this.pendingImageMessage = {
          role: 'user',
          content: [
            { type: 'text', text: '[Image output from the tool result(s) above — look at it and continue.]' },
            ...images.map((img) => ({
              type: 'image_url' as const,
              image_url: { url: `data:${img.mimeType};base64,${img.data}` },
            })),
          ],
        };
      }

      if (this.deps.signal?.aborted) return { status: 'cancelled', finalText: lastText };
    }

    return { status: 'max-turns', finalText: lastText };
  }

  /** Validate → permission-check → execute one tool call. Never throws. */
  private async executeCall(call: ToolCallRequest, tool: ReturnType<ToolRegistry['get']> | null): Promise<ToolResult> {
    if (!tool) {
      const res = toolErr(
        `Unknown tool "${call.name}". Available tools: ${this.deps.registry.all().map((t) => t.name).join(', ')}.`,
      );
      this.hooks.onToolStart(call, call.name);
      this.hooks.onToolEnd(call, res);
      return res;
    }

    const parsed = validateArgs(tool, call.argumentsJson);
    if (!parsed.ok) {
      const res = toolErr(`${parsed.error}\nCorrect the arguments and call the tool again.`);
      this.hooks.onToolStart(call, tool.name);
      this.hooks.onToolEnd(call, res);
      return res;
    }

    const summary = safeSummarize(tool, parsed.args);
    this.hooks.onToolStart(call, summary);

    const permission = await this.deps.permissions.check(tool, parsed.args, summary);
    if (!permission.allowed) {
      const res = toolErr(`Permission denied (${permission.reason}). Do not retry this exact call; adapt your plan.`);
      this.hooks.onToolEnd(call, res);
      return res;
    }

    const start = Date.now();
    try {
      const result = await tool.execute(parsed.args, {
        cwd: this.deps.config.cwd,
        signal: this.deps.signal,
      });
      logger.log('tool.end', { tool: tool.name, ms: Date.now() - start, isError: result.isError });
      this.hooks.onToolEnd(call, result);
      return result;
    } catch (e) {
      const res = toolErr(`Tool "${tool.name}" crashed: ${(e as Error).message}`);
      this.hooks.onToolEnd(call, res);
      return res;
    }
  }

  /** Compact history when it exceeds the configured token threshold. */
  private async maybeCompact(): Promise<void> {
    const { config, session } = this.deps;
    if (estimateMessagesTokens(session.messages) < config.compactThreshold) return;
    await this.compact();
  }

  /** Manual + automatic compaction. Returns true when compaction happened. */
  async compact(): Promise<boolean> {
    const { provider, config, session } = this.deps;
    const messages = session.messages;
    if (messages.length <= 10) return false;

    const tail = messages.slice(-6);
    const head = messages.slice(0, -6);
    const headText = head
      .map((m) => {
        const text = messageText(m);
        const clipped = text.length > 4000 ? text.slice(0, 4000) + '…' : text;
        return `[${m.role}] ${clipped}`;
      })
      .join('\n\n');

    let summary: string;
    try {
      const res = await collectStream(
        provider.stream({
          model: config.model,
          messages: [
            { role: 'system', content: COMPACTION_PROMPT },
            { role: 'user', content: headText },
          ],
          tools: [],
          signal: this.deps.signal,
          maxTokens: 2500,
          reasoningEffort: config.reasoningEffort,
        }),
      );
      summary = res.text.trim();
      if (res.usage) session.addUsage(res.usage);
    } catch (e) {
      logger.log('compact.failed', { error: (e as Error).message });
      // Fallback: drop the oldest half, keep a marker.
      const kept = messages.slice(Math.floor(messages.length / 2));
      session.data.messages = [
        { role: 'user', content: '[Earlier conversation history was truncated to free context space.]' },
        ...kept,
      ];
      session.data.compactions++;
      this.hooks.onCompact(messages.length, session.messages.length);
      return true;
    }

    session.data.messages = [
      {
        role: 'user',
        content: `[Compacted summary of the earlier conversation — treat it as ground truth]\n\n${summary}`,
      },
      ...tail,
    ];
    session.data.compactions++;
    this.hooks.onCompact(messages.length, session.messages.length);
    return true;
  }
}

function safeSummarize(tool: { summarize(a: never): string }, args: unknown): string {
  try {
    return tool.summarize(args as never);
  } catch {
    return tool.constructor.name;
  }
}
