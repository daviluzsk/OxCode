import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../src/tools/registry.js';
import type { ToolDefinition } from '../src/tools/types.js';

const mk = (name: string, category?: 'pentest'): ToolDefinition => ({
  name,
  description: 'x',
  parameters: { type: 'object', properties: {} },
  schema: z.object({}),
  kind: 'read',
  mutating: false,
  category,
  summarize: () => name,
  async execute() {
    return { content: '' };
  },
});

describe('ToolRegistry.specs pentest gating', () => {
  it('hides pentest tools from the model unless pentest mode is on', () => {
    const r = new ToolRegistry();
    r.register(mk('read_file'));
    r.register(mk('bash'));
    r.register(mk('net_scan', 'pentest'));
    r.register(mk('sqlmap-ish', 'pentest'));

    const off = r.specs().map((s) => s.name);
    expect(off).toEqual(['read_file', 'bash']); // pentest schemas not advertised

    const on = r.specs({ includePentest: true }).map((s) => s.name);
    expect(on).toContain('net_scan');
    expect(on).toContain('sqlmap-ish');
    expect(on).toHaveLength(4);
  });
});
