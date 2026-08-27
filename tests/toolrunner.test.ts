import { describe, expect, it } from 'vitest';
import { createSecurityToolTools, _toolrunnerInternal } from '../src/tools/toolrunner.js';
import { defaultConfig, type ResolvedConfig } from '../src/config/types.js';
import type { ToolDefinition } from '../src/tools/types.js';

const cwd = process.cwd();
const on: ResolvedConfig = { ...defaultConfig, cwd, apiKey: undefined, pentest: true };
const off: ResolvedConfig = { ...defaultConfig, cwd, apiKey: undefined, pentest: false };
const tool = (cfg: ResolvedConfig, name: string): ToolDefinition => createSecurityToolTools(cfg).find((t) => t.name === name) as ToolDefinition;
const run = (name: string, args: unknown) => tool(on, name).execute(args, { cwd });

describe('real security-tool runner', () => {
  it('installed() detects a present binary and rejects a missing one', async () => {
    expect(await _toolrunnerInternal.installed('node')).toBe(true);
    expect(await _toolrunnerInternal.installed('definitely-not-a-real-bin-zzz9')).toBe(false);
  });

  it('security_tools lists the real catalog', async () => {
    const res = await run('security_tools', {});
    expect(res.isError).toBeFalsy();
    expect(res.content).toMatch(/nmap/);
    expect(res.content).toMatch(/sqlmap/);
    expect(res.content).toMatch(/nuclei/);
  });

  it('run_security_tool rejects a tool that is not in the catalog', async () => {
    const res = await run('run_security_tool', { tool: 'rm', args: ['-rf', '/'] });
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/Unknown tool/);
  });

  it('run_security_tool reports when a catalog tool is not installed', async () => {
    // sqlmap is very unlikely on this host; if it happens to be installed, it still must not error out
    const res = await run('run_security_tool', { tool: 'sqlmap', args: ['--version'], timeoutSec: 20 });
    if (res.isError) expect(res.content).toMatch(/not installed/);
    else expect(res.content).toMatch(/\$ sqlmap/);
  });

  it('burp tools explain configuration when the REST API is not set', async () => {
    const prevUrl = process.env.BURP_API_URL;
    delete process.env.BURP_API_URL;
    try {
      const scan = await run('burp_scan', { url: 'https://example.com' });
      expect(scan.isError).toBe(true);
      expect(scan.content).toMatch(/BURP_API_URL/);
    } finally {
      if (prevUrl !== undefined) process.env.BURP_API_URL = prevUrl;
    }
  });

  it('everything is category "pentest" and gated when pentest mode is OFF', async () => {
    for (const t of createSecurityToolTools(off)) {
      expect(t.category).toBe('pentest');
      const args: Record<string, unknown> =
        t.name === 'run_security_tool' ? { tool: 'nmap', args: ['-V'] }
        : t.name === 'burp_scan' ? { url: 'https://x' }
        : t.name === 'burp_scan_status' ? { id: '1' }
        : {};
      const res = await t.execute(args, { cwd });
      expect(res.isError, `${t.name} gated`).toBe(true);
      expect(res.content).toMatch(/Pentest mode is OFF/);
    }
  });
});
