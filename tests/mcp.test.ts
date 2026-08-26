import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, makeTempDir, writeFile } from './helpers.js';
import { McpClient } from '../src/mcp/client.js';
import { McpManager } from '../src/mcp/manager.js';
import { addMcpServer, loadMcpConfig, removeMcpServer } from '../src/mcp/config.js';
import { ToolRegistry } from '../src/tools/registry.js';

const FAKE_SERVER = `
let buffer = '';
process.stdin.on('data', (d) => {
  buffer += d.toString('utf8');
  let idx;
  while ((idx = buffer.indexOf('\\n')) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.method === 'initialize') {
      reply(msg.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '0.0.1' } });
    } else if (msg.method === 'tools/list') {
      reply(msg.id, { tools: [{ name: 'ping', description: 'Replies pong', inputSchema: { type: 'object', properties: {} } }] });
    } else if (msg.method === 'tools/call') {
      reply(msg.id, { content: [{ type: 'text', text: 'pong:' + (msg.params?.name ?? '?') }] });
    }
  }
});
function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
}
`;

let dir = '';
afterEach(() => {
  if (dir) cleanup(dir);
  dir = '';
});

describe('MCP stdio client', () => {
  it('connects, lists tools and calls a tool', async () => {
    dir = makeTempDir();
    writeFile(dir, 'server.js', FAKE_SERVER);
    const client = new McpClient('fake', { command: process.execPath, args: ['server.js'] }, dir);
    await client.connect();
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['ping']);
    const out = await client.callTool('ping', {});
    expect(out).toBe('pong:ping');
    await client.close();
  });

  it('spawns the server with the project cwd (regression: relative script paths must work)', async () => {
    dir = makeTempDir();
    writeFile(dir, 'server.js', FAKE_SERVER);
    writeFile(dir, '.mcp.json', JSON.stringify({ mcpServers: { fake: { command: process.execPath, args: ['server.js'] } } }));
    const registry = new ToolRegistry();
    const mcp = new McpManager();
    await mcp.connectAll(dir, registry);
    expect(mcp.statuses[0]).toMatchObject({ name: 'fake', status: 'connected', tools: ['mcp__fake__ping'] });
    const tool = registry.get('mcp__fake__ping');
    expect(tool).toBeDefined();
    const res = await tool!.execute({}, { cwd: dir });
    expect(res.isError).toBeFalsy();
    expect(res.content).toContain('pong');
    await mcp.closeAll();
  });

  it('a failing server is reported, not fatal', async () => {
    dir = makeTempDir();
    writeFile(dir, '.mcp.json', JSON.stringify({ mcpServers: { ghost: { command: 'definitely-not-a-real-binary-xyz' } } }));
    const registry = new ToolRegistry();
    const mcp = new McpManager();
    await mcp.connectAll(dir, registry);
    expect(mcp.statuses[0]!.status).toBe('failed');
    await mcp.closeAll();
  });

  it('config add/list/remove round-trip', () => {
    dir = makeTempDir();
    addMcpServer(dir, 'one', { command: 'node', args: ['a.js'] });
    addMcpServer(dir, 'two', { command: 'python', args: ['b.py'], env: { X: '1' } });
    const cfg = loadMcpConfig(dir);
    expect(Object.keys(cfg).sort()).toEqual(['one', 'two']);
    expect(cfg['two']!.env).toEqual({ X: '1' });
    expect(removeMcpServer(dir, 'one')).toBe(true);
    expect(removeMcpServer(dir, 'one')).toBe(false);
    expect(Object.keys(loadMcpConfig(dir))).toEqual(['two']);
  });
});
