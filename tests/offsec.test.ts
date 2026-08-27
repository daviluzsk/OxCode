import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOffsecTools } from '../src/tools/offsec.js';
import { defaultConfig, type ResolvedConfig } from '../src/config/types.js';
import type { ToolDefinition } from '../src/tools/types.js';

const cfgOn: ResolvedConfig = { ...defaultConfig, cwd: process.cwd(), apiKey: undefined, pentest: true };
const cfgOff: ResolvedConfig = { ...defaultConfig, cwd: process.cwd(), apiKey: undefined, pentest: false };
const tool = (cfg: ResolvedConfig, name: string): ToolDefinition =>
  createOffsecTools(cfg).find((t) => t.name === name) as ToolDefinition;
const run = (cfg: ResolvedConfig, name: string, args: unknown) => tool(cfg, name).execute(args, { cwd: process.cwd() });

let server: http.Server;
let base = '';
beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, { Allow: 'GET,POST,OPTIONS,TRACE' }); return res.end(); }
    if (req.method === 'TRACE') { res.writeHead(200); return res.end('trace'); }
    if (['PUT', 'DELETE', 'PATCH'].includes(req.method ?? '')) { res.writeHead(405); return res.end(); }
    const url = req.url ?? '/';
    if (url === '/cors') { res.writeHead(200, { 'Access-Control-Allow-Origin': req.headers.origin ?? '', 'Access-Control-Allow-Credentials': 'true' }); return res.end('{}'); }
    if (url === '/redir') { res.writeHead(302, { Location: 'http://evil.example/' }); return res.end(); }
    if (url === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('User-agent: *'); }
    res.writeHead(200, { Server: 'nginx/1.25.1', 'X-Powered-By': 'PHP/8.2', 'Set-Cookie': 'PHPSESSID=abc' });
    res.end('<html data-reactroot>hi</html>');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('offsec toolkit', () => {
  it('every tool is tagged category "pentest" and refuses when pentest mode is OFF', async () => {
    for (const t of createOffsecTools(cfgOff)) {
      expect(t.category).toBe('pentest');
      const res = await t.execute(t.name === 'hash_identify' ? { hash: 'x'.repeat(32) } : t.name === 'proxy_status' ? {} : t.name.includes('crt') || t.name.includes('wayback') ? { domain: 'e.com' } : { url: base }, { cwd: process.cwd() });
      expect(res.isError, `${t.name} should be gated`).toBe(true);
      expect(res.content).toMatch(/Pentest mode is OFF/);
    }
  });

  it('tech_fingerprint detects server, language and framework', async () => {
    const res = await run(cfgOn, 'tech_fingerprint', { url: base });
    expect(res.isError).toBeFalsy();
    expect(res.content).toMatch(/nginx/);
    expect(res.content).toMatch(/PHP/);
    expect(res.content).toMatch(/React/);
  });

  it('http_methods reports advertised verbs and flags TRACE', async () => {
    const res = await run(cfgOn, 'http_methods', { url: base });
    expect(res.content).toMatch(/TRACE/);
    expect(res.content).toMatch(/XST risk|accepted/);
  });

  it('cors_audit catches reflected origin with credentials', async () => {
    const res = await run(cfgOn, 'cors_audit', { url: `${base}/cors` });
    expect(res.content).toMatch(/VULNERABLE/);
  });

  it('redirect_chain flags an open redirect to an external host', async () => {
    const res = await run(cfgOn, 'redirect_chain', { url: `${base}/redir` });
    expect(res.content).toMatch(/OPEN REDIRECT to external host: evil\.example/);
  });

  it('recon_files finds exposed common paths', async () => {
    const res = await run(cfgOn, 'recon_files', { url: base });
    expect(res.content).toMatch(/\/robots\.txt/);
  });

  it('hash_identify classifies common hash shapes', async () => {
    expect((await run(cfgOn, 'hash_identify', { hash: 'd41d8cd98f00b204e9800998ecf8427e' })).content).toMatch(/MD5/);
    expect((await run(cfgOn, 'hash_identify', { hash: '$2b$12$abcdefghijklmnopqrstuv' })).content).toMatch(/bcrypt/);
    expect((await run(cfgOn, 'hash_identify', { hash: 'eyJhbGciOi.eyJzdWIiOi.sig' })).content).toMatch(/JWT/);
  });

  it('proxy_status reflects the BURP_PROXY env var', async () => {
    const prev = process.env.BURP_PROXY;
    process.env.BURP_PROXY = 'http://127.0.0.1:8080';
    try {
      const res = await run(cfgOn, 'proxy_status', {});
      expect(res.content).toMatch(/ACTIVE/);
      expect(res.content).toMatch(/127\.0\.0\.1:8080/);
    } finally {
      if (prev === undefined) delete process.env.BURP_PROXY; else process.env.BURP_PROXY = prev;
    }
  });
});
