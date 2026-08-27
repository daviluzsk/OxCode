import type { z } from 'zod';
import type { DiffSummary } from '../utils/diffView.js';

export interface ToolResult {
  /** Text sent back to the model. */
  content: string;
  isError?: boolean;
  /**
   * Images sent to the model right after this result (e.g. screenshots).
   * Transient: included in the next model request only, never persisted
   * to the session on disk.
   */
  images?: Array<{ /** base64-encoded bytes */ data: string; mimeType: string }>;
  /** Extra structured info used by the UI (never required by the model). */
  ui?: {
    kind: 'read' | 'search' | 'edit' | 'write' | 'delete' | 'move' | 'bash' | 'git' | 'todo' | 'task' | 'info';
    title?: string;
    detail?: string;
    diff?: DiffSummary;
    diffPath?: string;
  };
}

export interface ToolContext {
  cwd: string;
  signal?: AbortSignal;
}

export type ToolKind = 'read' | 'write' | 'execute';

export interface ToolDefinition<A = unknown> {
  readonly name: string;
  readonly description: string;
  /** JSON Schema for the provider's tool spec. */
  readonly parameters: Record<string, unknown>;
  /** Zod schema used to validate raw model arguments. */
  readonly schema: z.ZodType<A>;
  /** read = side-effect free; write = mutates files; execute = runs processes. */
  readonly kind: ToolKind;
  readonly mutating: boolean;
  /**
   * Optional grouping. `'pentest'` marks the authorized security-testing
   * toolkit: when pentest mode is active the operator is the target's owner,
   * so these run without per-call approval prompts (except in `plan` mode).
   */
  readonly category?: 'pentest';
  /** One-line summary of a call for display (e.g. path or command). */
  summarize(args: A): string;
  execute(args: A, ctx: ToolContext): Promise<ToolResult>;
}

export function err(content: string): ToolResult {
  return { content, isError: true };
}

export function ok(content: string, ui?: ToolResult['ui']): ToolResult {
  return { content, ui };
}

/** Validate raw JSON arguments against a tool's schema. */
export function validateArgs<A>(
  tool: ToolDefinition<A>,
  argumentsJson: string,
): { ok: true; args: A } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = argumentsJson.trim() === '' ? {} : JSON.parse(argumentsJson);
  } catch (e) {
    return { ok: false, error: `Malformed JSON arguments: ${(e as Error).message}` };
  }
  const parsed = tool.schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    return { ok: false, error: `Invalid arguments for ${tool.name}: ${issues}` };
  }
  return { ok: true, args: parsed.data };
}
