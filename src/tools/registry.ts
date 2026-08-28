import type { ToolSpec } from '../api/types.js';
import type { ToolDefinition } from './types.js';

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Duplicate tool registration: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  /** Register or replace (used for MCP tools which can reconnect). */
  upsert(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  remove(name: string): boolean {
    return this.tools.delete(name);
  }

  all(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /**
   * Tool specs advertised to the model. The offensive/pentest toolkit is a large
   * set of schemas (~40 tools) — advertising it every turn inflates input tokens
   * (and cost) on ordinary coding sessions. So it's only sent when pentest mode
   * is ON. The tools stay registered either way (and refuse to run when off).
   */
  specs(opts: { includePentest?: boolean } = {}): ToolSpec[] {
    const include = opts.includePentest ?? false;
    return this.all()
      .filter((t) => include || t.category !== 'pentest')
      .map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));
  }
}
