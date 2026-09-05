import { describe, expect, it } from 'vitest';
import { createOsintTools } from '../src/tools/osint.js';
import { defaultConfig, type ResolvedConfig } from '../src/config/types.js';

const cfgOn: ResolvedConfig = { ...defaultConfig, cwd: process.cwd(), apiKey: undefined, pentest: true };
const cfgOff: ResolvedConfig = { ...defaultConfig, cwd: process.cwd(), apiKey: undefined, pentest: false };
const ctx = { cwd: process.cwd() };
const names = (cfg: ResolvedConfig) => createOsintTools(cfg).map((t) => t.name);

describe('osint toolkit', () => {
  it('registers the OSINT tools', () => {
    const n = names(cfgOn);
    expect(n).toEqual(expect.arrayContaining(['dns_osint', 'username_lookup', 'github_osint']));
  });

  it('all OSINT tools are gated behind pentest mode', async () => {
    for (const t of createOsintTools(cfgOff)) {
      const r = await t.execute({ domain: 'x.com', username: 'x', user: 'x' } as never, ctx);
      expect(r.isError).toBe(true);
      expect(r.content).toMatch(/Pentest mode is OFF/);
    }
  });

  it('tools are read-only and pentest-category', () => {
    for (const t of createOsintTools(cfgOn)) {
      expect(t.category).toBe('pentest');
      expect(t.mutating).toBe(false);
    }
  });
});
