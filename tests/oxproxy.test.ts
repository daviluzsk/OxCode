import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOxProxyTools, _oxproxyInternal } from '../src/tools/oxproxy.js';
import { defaultConfig, type ResolvedConfig } from '../src/config/types.js';
import type { ToolDefinition } from '../src/tools/types.js';

const cfgOn: ResolvedConfig = { ...defaultConfig, cwd: process.cwd(), apiKey: undefined, pentest: true };
const cfgOff: ResolvedConfig = { ...defaultConfig, cwd: process.cwd(), apiKey: undefined, pentest: false };
const tool = (cfg: ResolvedConfig, name: string): ToolDefinition => createOxProxyTools(cfg).find((t) => t.name === name) as ToolDefinition;
const run = (name: string, args: unknown) => tool(cfgOn, name).execute(args, { cwd: process.cwd() });
const lastId = () => _oxproxyInternal.HISTORY[_oxproxyInternal.HISTORY.length - 1]!.id;

let server: http.Server;
let base = '';
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const u = req.url ?? '/';
    if (u.startsWith('/user/')) { const id = u.slice(6); if (id === '999') { res.writeHead(404); return res.end('not found'); } res.writeHead(200); return res.end('user ' + id); }
    if (u === '/role') { res.writeHead(200); return res.end('role=' + (req.headers['x-role'] ?? 'guest')); }
    res.writeHead(200); res.end('home page');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('OxProxy (AI Burp)', () => {
  it('proxy_send captures a request and history/view can read it back', async () => {
    const res = await run('proxy_send', { url: `${base}/user/1` });
    expect(res.isError).toBeFalsy();
    expect(res.content).toMatch(/user 1/);
    const id = lastId();
    const hist = await run('proxy_history', {});
    expect(hist.content).toMatch(new RegExp('#' + id));
    const view = await run('proxy_view', { id });
    expect(view.content).toMatch(/--- request ---/);
    expect(view.content).toMatch(/user 1/);
  });

  it('proxy_repeat resends with a modified header and reflects the change', async () => {
    await run('proxy_send', { url: `${base}/role` });
    const id = lastId();
    const rep = await run('proxy_repeat', { id, setHeaders: { 'X-Role': 'admin' } });
    expect(rep.content).toMatch(/role=admin/);
    expect(rep.content).toMatch(/Repeated #/);
  });

  it('proxy_intruder fuzzes a FUZZ marker and flags the anomaly', async () => {
    const res = await run('proxy_intruder', { url: `${base}/user/FUZZ`, payloads: ['1', '2', '3', '4', '999'], delayMs: 0 });
    expect(res.content).toMatch(/Intruder: 5\/5/);
    expect(res.content).toMatch(/anomal/i);
    expect(res.content).toMatch(/404/); // the /user/999 -> 404 outlier
  });

  it('proxy_compare diffs two captured responses', async () => {
    await run('proxy_send', { url: `${base}/user/1` }); const a = lastId();
    await run('proxy_send', { url: `${base}/` }); const b = lastId();
    const cmp = await run('proxy_compare', { a, b });
    expect(cmp.content).toMatch(/length:/);
    expect(cmp.content).toMatch(new RegExp('#' + a + ' vs #' + b));
  });

  it('proxy_decode handles base64, url and jwt', async () => {
    expect((await run('proxy_decode', { action: 'encode', codec: 'base64', input: 'hi' })).content.trim()).toBe('aGk=');
    expect((await run('proxy_decode', { action: 'decode', codec: 'base64', input: 'aGk=' })).content.trim()).toBe('hi');
    expect((await run('proxy_decode', { action: 'decode', codec: 'url', input: 'a%20b' })).content.trim()).toBe('a b');
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig';
    const dec = await run('proxy_decode', { action: 'decode', codec: 'jwt', input: jwt });
    expect(dec.content).toMatch(/"sub":"123"/);
  });

  it('is gated when pentest mode is OFF', async () => {
    for (const t of createOxProxyTools(cfgOff)) {
      const args = t.name === 'proxy_decode' ? { action: 'encode', codec: 'base64', input: 'x' }
        : t.name === 'proxy_view' || t.name === 'proxy_repeat' ? { id: 1 }
        : t.name === 'proxy_compare' ? { a: 1, b: 2 }
        : t.name === 'proxy_send' || t.name === 'proxy_intruder' ? { url: base }
        : {};
      const res = await t.execute(args, { cwd: process.cwd() });
      expect(res.isError, `${t.name} gated`).toBe(true);
      expect(res.content).toMatch(/Pentest mode is OFF/);
    }
  });
});
