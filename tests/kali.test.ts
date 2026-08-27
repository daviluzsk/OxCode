import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createKaliTools } from '../src/tools/kali.js';
import { defaultConfig, type ResolvedConfig } from '../src/config/types.js';
import type { ToolDefinition } from '../src/tools/types.js';
import { cleanup, makeTempDir, writeFile } from './helpers.js';

const on = (cwd: string): ResolvedConfig => ({ ...defaultConfig, cwd, apiKey: undefined, pentest: true });
const off = (cwd: string): ResolvedConfig => ({ ...defaultConfig, cwd, apiKey: undefined, pentest: false });
const tool = (cfg: ResolvedConfig, name: string): ToolDefinition => createKaliTools(cfg).find((t) => t.name === name) as ToolDefinition;

let dir = '';
afterEach(() => { if (dir) cleanup(dir); dir = ''; });

let server: http.Server;
let base = '';
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const p = url.pathname;
    if (p === '/admin') { res.writeHead(200); return res.end('admin panel'); }
    if (p === '/') { res.writeHead(200); return res.end('<html><meta name="generator" content="WordPress 6.4.1"><div class="wp-content">hi</div></html>'); }
    if (p === '/wp-json/wp/v2/users') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify([{ id: 1, name: 'Admin', slug: 'admin' }])); }
    if (p === '/favicon.ico') { res.writeHead(200); return res.end('FAKEICONDATA'); }
    if (p === '/lfi') { const f = url.searchParams.get('file') ?? ''; if (/passwd|\.\.\//.test(f)) { res.writeHead(200); return res.end('root:x:0:0:root:/root:/bin/bash'); } res.writeHead(200); return res.end('ok'); }
    if (p === '/ssti') { const q = url.searchParams.get('q') ?? ''; if (q.includes('7*7')) { res.writeHead(200); return res.end('<p>49</p>'); } res.writeHead(200); return res.end('nope'); }
    if (p === '/cmd') { const c = url.searchParams.get('c') ?? ''; const m = /echo\s+(\S+)/.exec(c); res.writeHead(200); return res.end(m ? 'out: ' + m[1] : 'no'); }
    res.writeHead(404); res.end('nf');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('kali toolkit', () => {
  it('dir_bruteforce finds a live path from the built-in list', async () => {
    dir = makeTempDir();
    const res = await tool(on(dir), 'dir_bruteforce').execute({ url: base, maxRequests: 400, delayMs: 0 }, { cwd: dir });
    expect(res.content).toMatch(/\/admin/);
  });

  it('wpscan detects version and enumerates REST users', async () => {
    dir = makeTempDir();
    const res = await tool(on(dir), 'wpscan').execute({ url: base }, { cwd: dir });
    expect(res.content).toMatch(/6\.4\.1/);
    expect(res.content).toMatch(/1:admin/);
  });

  it('inject_probe detects LFI, SSTI and command injection', async () => {
    dir = makeTempDir();
    const lfi = await tool(on(dir), 'inject_probe').execute({ url: `${base}/lfi?file=FUZZ`, kind: 'lfi' }, { cwd: dir });
    expect(lfi.content).toMatch(/VULNERABLE \(LFI\)/);
    const ssti = await tool(on(dir), 'inject_probe').execute({ url: `${base}/ssti?q=FUZZ`, kind: 'ssti' }, { cwd: dir });
    expect(ssti.content).toMatch(/VULNERABLE \(SSTI\)/);
    const cmdi = await tool(on(dir), 'inject_probe').execute({ url: `${base}/cmd?c=FUZZ`, kind: 'cmdi' }, { cwd: dir });
    expect(cmdi.content).toMatch(/VULNERABLE \(CMDI\)/);
  });

  it('hash_crack recovers a password from a wordlist (md5 auto)', async () => {
    dir = makeTempDir();
    writeFile(dir, 'words.txt', 'apple\nbanana\ns3cr3t\ncarrot\n');
    const crypto = await import('node:crypto');
    const target = crypto.createHash('md5').update('s3cr3t').digest('hex');
    const res = await tool(on(dir), 'hash_crack').execute({ hash: target, wordlistFile: 'words.txt' }, { cwd: dir });
    expect(res.content).toMatch(/CRACKED/);
    expect(res.content).toMatch(/s3cr3t/);
  });

  it('favicon_hash returns a Shodan mmh3 value', async () => {
    dir = makeTempDir();
    const res = await tool(on(dir), 'favicon_hash').execute({ url: base }, { cwd: dir });
    expect(res.content).toMatch(/mmh3 = -?\d+/);
    expect(res.content).toMatch(/http\.favicon\.hash:/);
  });

  it('every tool is category "pentest" and gated when pentest mode is OFF', async () => {
    dir = makeTempDir();
    for (const t of createKaliTools(off(dir))) {
      expect(t.category).toBe('pentest');
      const args: Record<string, unknown> =
        t.name === 'whois' ? { query: 'example.com' }
        : t.name === 'dns_axfr' ? { domain: 'example.com', nameserver: '127.0.0.1' }
        : t.name === 'takeover_check' ? { host: 'x.example.com' }
        : t.name === 's3_check' ? { bucket: 'x' }
        : t.name === 'hash_crack' ? { hash: 'x'.repeat(32), wordlistFile: 'w.txt' }
        : t.name === 'inject_probe' ? { url: `${base}/a?x=FUZZ`, kind: 'lfi' }
        : { url: base };
      const res = await t.execute(args, { cwd: dir });
      expect(res.isError, `${t.name} gated`).toBe(true);
      expect(res.content).toMatch(/Pentest mode is OFF/);
    }
  });
});
