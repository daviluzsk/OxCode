import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { McpServerConfig } from './config.js';
import { logger } from '../utils/logger.js';

/**
 * Minimal MCP stdio client (newline-delimited JSON-RPC 2.0).
 * Supports initialize, tools/list and tools/call — enough to expose
 * MCP server tools to the agent. Failures are isolated per server.
 */

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

const REQUEST_TIMEOUT_MS = 20_000;

export class McpClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private buffer = '';
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private closed = false;

  constructor(
    readonly serverName: string,
    private readonly config: McpServerConfig,
    private readonly cwd?: string,
  ) {}

  async connect(): Promise<void> {
    const child = spawn(this.config.command, this.config.args ?? [], {
      env: { ...process.env, ...(this.config.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.cwd,
    });
    this.child = child;
    child.on('error', (e) => this.failAll(new Error(`MCP server "${this.serverName}" failed to start: ${e.message}`)));
    child.on('exit', (code) => {
      if (!this.closed) this.failAll(new Error(`MCP server "${this.serverName}" exited (code ${code ?? '?'})`));
    });
    child.stderr.on('data', (d: Buffer) => {
      logger.log('mcp.stderr', { server: this.serverName, text: d.toString('utf8').slice(0, 300) });
    });
    child.stdout.on('data', (d: Buffer) => this.onData(d.toString('utf8')));

    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'oxcode', version: '0.1.0' },
    });
    this.notify('notifications/initialized', {});
  }

  private onData(text: string): void {
    this.buffer += text;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg: JsonRpcResponse;
      try {
        msg = JSON.parse(line) as JsonRpcResponse;
      } catch {
        continue; // ignore non-JSON noise
      }
      if (msg.id === undefined) continue; // notification
      const id = typeof msg.id === 'string' ? Number(msg.id) : msg.id;
      const entry = this.pending.get(id);
      if (!entry) continue;
      this.pending.delete(id);
      clearTimeout(entry.timer);
      if (msg.error) entry.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
      else entry.resolve(msg.result);
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (!this.child || this.closed) return Promise.reject(new Error(`MCP server "${this.serverName}" is not connected`));
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request "${method}" to "${this.serverName}" timed out`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(payload, (e) => {
        if (e) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(e);
        }
      });
    });
  }

  private notify(method: string, params: unknown): void {
    if (!this.child || this.closed) return;
    try {
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
    } catch {
      /* ignore */
    }
  }

  async listTools(): Promise<McpToolInfo[]> {
    const result = (await this.request('tools/list', {})) as { tools?: McpToolInfo[] };
    return result.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = (await this.request('tools/call', { name, arguments: args })) as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    const text = (result.content ?? [])
      .map((c) => (c.type === 'text' ? (c.text ?? '') : `[${c.type} content]`))
      .join('\n');
    if (result.isError) throw new Error(text || 'MCP tool reported an error');
    return text || '(no output)';
  }

  private failAll(error: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.failAll(new Error('MCP client closed'));
    const child = this.child;
    this.child = null;
    if (child) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* ignore */
          }
          resolve();
        }, 3000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        try {
          child.stdin.end();
          child.kill();
        } catch {
          clearTimeout(timer);
          resolve();
        }
      });
    }
  }
}
