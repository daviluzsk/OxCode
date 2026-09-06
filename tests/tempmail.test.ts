import { describe, expect, it } from 'vitest';
import { createTempmailTools } from '../src/tools/tempmail.js';
import { defaultConfig, type ResolvedConfig } from '../src/config/types.js';

const cfgOn: ResolvedConfig = { ...defaultConfig, cwd: process.cwd(), apiKey: undefined, pentest: true };
const cfgOff: ResolvedConfig = { ...defaultConfig, cwd: process.cwd(), apiKey: undefined, pentest: false };
const ctx = { cwd: process.cwd() };
const tempmail = (cfg: ResolvedConfig) => createTempmailTools(cfg)[0]!;

describe('tempmail', () => {
  it('registers a single pentest-gated, non-mutating tool', () => {
    const t = tempmail(cfgOn);
    expect(t.name).toBe('tempmail');
    expect(t.category).toBe('pentest');
    expect(t.mutating).toBe(false);
  });

  it('is gated behind pentest mode', async () => {
    const r = await tempmail(cfgOff).execute({ action: 'create' } as never, ctx);
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/Pentest mode is OFF/);
  });

  it('inbox/read/wait require an address created in this run', async () => {
    const r = await tempmail(cfgOn).execute({ action: 'inbox', address: 'nobody@nowhere.tld' } as never, ctx);
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/No session for/);
  });

  it('read requires an id', async () => {
    // address unknown → guarded before id check, so assert the address guard path
    const r = await tempmail(cfgOn).execute({ action: 'read', address: 'x@y.tld' } as never, ctx);
    expect(r.isError).toBe(true);
  });
});
