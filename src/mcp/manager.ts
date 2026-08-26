import { z } from 'zod';
import type { ToolRegistry } from '../tools/registry.js';
import { err, ok, type ToolDefinition } from '../tools/types.js';
import { McpClient } from './client.js';
import { loadMcpConfig } from './config.js';
import { logger } from '../utils/logger.js';

export interface McpServerStatus {
  name: string;
  status: 'connected' | 'failed';
  tools: string[];
  error?: string;
}

/**
 * Connects configured MCP servers and exposes their tools to the agent,
 * namespaced as mcp__<server>__<tool>. A failing server never crashes
 * the agent — it is reported and skipped.
 */
export class McpManager {
  private readonly clients: McpClient[] = [];
  readonly statuses: McpServerStatus[] = [];

  async connectAll(cwd: string, registry: ToolRegistry): Promise<void> {
    const config = loadMcpConfig(cwd);
    const names = Object.keys(config);
    await Promise.all(
      names.map(async (name) => {
        const client = new McpClient(name, config[name]!, cwd);
        try {
          await client.connect();
          const tools = await client.listTools();
          this.clients.push(client);
          const toolNames: string[] = [];
          for (const t of tools) {
            const fullName = `mcp__${name}__${t.name}`;
            registry.upsert(this.wrapTool(client, fullName, t.name, t.description, t.inputSchema));
            toolNames.push(fullName);
          }
          this.statuses.push({ name, status: 'connected', tools: toolNames });
          logger.log('mcp.connected', { server: name, tools: toolNames.length });
        } catch (e) {
          client.close();
          this.statuses.push({ name, status: 'failed', tools: [], error: (e as Error).message });
          logger.log('mcp.failed', { server: name, error: (e as Error).message });
        }
      }),
    );
  }

  private wrapTool(
    client: McpClient,
    fullName: string,
    originalName: string,
    description: string | undefined,
    inputSchema: Record<string, unknown> | undefined,
  ): ToolDefinition<Record<string, unknown>> {
    return {
      name: fullName,
      description: `[MCP: ${client.serverName}] ${description ?? originalName}`,
      parameters: inputSchema ?? { type: 'object', properties: {} },
      schema: z.record(z.unknown()),
      kind: 'execute',
      mutating: false,
      summarize: (a) => `${originalName}(${Object.keys(a).join(', ')})`,
      async execute(args): Promise<ReturnType<typeof ok>> {
        try {
          const text = await client.callTool(originalName, args);
          return ok(text, { kind: 'info', title: 'MCP', detail: `${client.serverName}/${originalName}` });
        } catch (e) {
          return err(`MCP tool ${fullName} failed: ${(e as Error).message}`);
        }
      },
    };
  }

  async closeAll(): Promise<void> {
    await Promise.all(this.clients.map((c) => c.close()));
    this.clients.length = 0;
  }
}
