import { describe, expect, it } from 'vitest';
import { createKaliBoxTools, _kaliboxInternal } from '../src/tools/kalibox.js';
import { defaultConfig, type ResolvedConfig } from '../src/config/types.js';
import type { ToolDefinition } from '../src/tools/types.js';

const cwd = process.cwd();
const on: ResolvedConfig = { ...defaultConfig, cwd, apiKey: undefined, pentest: true };
const off: ResolvedConfig = { ...defaultConfig, cwd, apiKey: undefined, pentest: false };
const tool = (cfg: ResolvedConfig, name: string): ToolDefinition => createKaliBoxTools(cfg).find((t) => t.name === name) as ToolDefinition;

describe('Kali box', () => {
  it('exposes the expected tools, all category "pentest"', () => {
    const names = createKaliBoxTools(on).map((t) => t.name).sort();
    expect(names).toEqual(['kali_down', 'kali_install', 'kali_run', 'kali_status', 'kali_up']);
    for (const t of createKaliBoxTools(on)) expect(t.category).toBe('pentest');
  });

  it('is gated when pentest mode is OFF', async () => {
    for (const t of createKaliBoxTools(off)) {
      const args = t.name === 'kali_run' ? { command: 'id' } : t.name === 'kali_install' ? { packages: ['nmap'] } : {};
      const res = await t.execute(args, { cwd });
      expect(res.isError, `${t.name} gated`).toBe(true);
      expect(res.content).toMatch(/Pentest mode is OFF/);
    }
  });

  it('dockerReady() reports a boolean and a helpful message', async () => {
    const dr = await _kaliboxInternal.dockerReady();
    expect(typeof dr.ok).toBe('boolean');
    expect(dr.msg.length).toBeGreaterThan(0);
  });

  it('degrades gracefully when Docker is unavailable', async () => {
    const dr = await _kaliboxInternal.dockerReady();
    if (dr.ok) return; // a machine with Docker — skip the offline assertions
    const status = await tool(on, 'kali_status').execute({}, { cwd });
    expect(status.isError).toBeFalsy();
    expect(status.content).toMatch(/Docker is not installed|daemon is not reachable/);
    const run = await tool(on, 'kali_run').execute({ command: 'id' }, { cwd });
    expect(run.isError).toBe(true);
    expect(run.content).toMatch(/Docker/);
  });
});
