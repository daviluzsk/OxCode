import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { userDataDir } from '../utils/paths.js';

const serverSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});

const mcpFileSchema = z.object({
  mcpServers: z.record(serverSchema).default({}),
});

export type McpServerConfig = z.infer<typeof serverSchema>;
export type McpConfig = Record<string, McpServerConfig>;

function readMcpFile(file: string): McpConfig {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = mcpFileSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return {};
    return parsed.data.mcpServers;
  } catch {
    return {};
  }
}

export function projectMcpPath(cwd: string): string {
  return path.join(cwd, '.mcp.json');
}

export function userMcpPath(): string {
  return path.join(userDataDir(), 'mcp.json');
}

/** Merge user-level and project-level MCP configs (project wins). */
export function loadMcpConfig(cwd: string): McpConfig {
  return { ...readMcpFile(userMcpPath()), ...readMcpFile(projectMcpPath(cwd)) };
}

export function addMcpServer(cwd: string, name: string, server: McpServerConfig): void {
  const file = projectMcpPath(cwd);
  const config = readMcpFile(file);
  config[name] = server;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ mcpServers: config }, null, 2), 'utf8');
}

export function removeMcpServer(cwd: string, name: string): boolean {
  const file = projectMcpPath(cwd);
  const config = readMcpFile(file);
  if (!(name in config)) return false;
  delete config[name];
  fs.writeFileSync(file, JSON.stringify({ mcpServers: config }, null, 2), 'utf8');
  return true;
}
