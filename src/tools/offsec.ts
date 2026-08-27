import net from 'node:net';
import tls from 'node:tls';
import { z } from 'zod';
import type { ResolvedConfig } from '../config/types.js';
import { truncateMiddle } from '../utils/truncate.js';
import { err, ok, type ToolDefinition, type ToolResult } from './types.js';

/**
 * Offensive-security toolkit for AUTHORIZED engagements — external recon,
 * misconfiguration analysis, and manual-exploitation helpers a real pentester
 * uses on a black-box target. Same rules as the rest of the pentest toolkit:
 * pentest mode must be ON, and every call is approval-gated (auto-allowed while
 * pentest mode is active). Everything here is read/analysis oriented and
 * PoC-level — no DoS, no mass exploitation, no destructive payloads.
 *
 * All HTTP goes through a tiny dependency-free client that can tunnel through
 * an intercepting proxy (Burp Suite / OWASP ZAP), so a tester can watch, log,
 * and replay every request. Set the proxy with one of these env vars:
 *   OX_PROXY, BURP_PROXY, HTTPS_PROXY, HTTP_PROXY   (e.g. http://127.0.0.1:8080)
 */

const GATE =
  'Pentest mode is OFF. Offensive-security tools only run in authorized security-testing mode — ' +
  'enable it with /pentest (or ox --pentest) and confirm you are authorized for the target.';
function gate(config: ResolvedConfig): ToolResult | null {
  return config.pentest ? null : err(GATE);
}
const MAX_OUTPUT = 20_000;

export function activeProxy(): string {
  return (
    process.env.OX_PROXY ||
    process.env.BURP_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    ''
  );
}

export interface RawResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  proxied: boolean;
}

/**
 * Minimal HTTP/1.1 client over raw sockets. Forces `Connection: close` and
 * `Accept-Encoding: identity` so the whole response can be read to EOF without
 * chunked/gzip handling. Tunnels through an intercepting proxy via CONNECT when
 * one is configured (TLS verification is relaxed then, since Burp/ZAP re-sign).
 */
export interface RawHttpResponse extends RawResponse {}
export function rawHttp(
  method: string,
  urlStr: string,
  opts: { headers?: Record<string, string>; body?: string; timeout?: number } = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(urlStr);
    } catch {
      return reject(new Error(`Invalid URL: ${urlStr}`));
    }
    const isHttps = u.protocol === 'https:';
    const port = u.port ? Number(u.port) : isHttps ? 443 : 80;
    const host = u.hostname;
    const path = (u.pathname || '/') + u.search;
    const timeout = opts.timeout ?? 15_000;
    const proxy = activeProxy();
    const body = opts.body ?? '';

    const headers: Record<string, string> = {
      Host: u.host,
      'User-Agent': 'OxCode-Offsec/1.0',
      Accept: '*/*',
      'Accept-Encoding': 'identity',
      Connection: 'close',
      ...(opts.headers ?? {}),
    };
    if (body) headers['Content-Length'] = String(Buffer.byteLength(body));

    const buildReq = (target: string) =>
      [`${method.toUpperCase()} ${target} HTTP/1.1`, ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`), '', body].join('\r\n');

    const chunks: Buffer[] = [];
    let settled = false;
    const fail = (e: Error) => {
      if (!settled) {
        settled = true;
        reject(e);
      }
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      const buf = Buffer.concat(chunks);
      const sep = buf.indexOf('\r\n\r\n');
      const head = (sep >= 0 ? buf.slice(0, sep) : buf).toString('latin1');
      const bodyStr = sep >= 0 ? buf.slice(sep + 4).toString('utf8') : '';
      const lines = head.split('\r\n');
      const m = /^HTTP\/1\.[01]\s+(\d+)\s*(.*)$/.exec(lines[0] ?? '');
      const respHeaders: Record<string, string> = {};
      for (const line of lines.slice(1)) {
        const i = line.indexOf(':');
        if (i > 0) respHeaders[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
      }
      resolve({
        status: m ? Number(m[1]) : 0,
        statusText: m ? (m[2] ?? '') : '',
        headers: respHeaders,
        body: bodyStr,
        proxied: !!proxy,
      });
    };
    const attach = (sock: net.Socket | tls.TLSSocket, target: string) => {
      sock.setTimeout(timeout, () => sock.destroy(new Error('timeout')));
      sock.on('data', (d) => chunks.push(d));
      sock.on('error', fail);
      sock.on('close', finish);
      sock.write(buildReq(target));
    };

    if (proxy) {
      let p: URL;
      try {
        p = new URL(proxy);
      } catch {
        return reject(new Error(`Invalid proxy URL: ${proxy}`));
      }
      const pPort = p.port ? Number(p.port) : 8080;
      if (isHttps) {
        const sock = net.connect(pPort, p.hostname, () => {
          sock.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
        });
        let established = false;
        let hbuf = Buffer.alloc(0);
        const onData = (d: Buffer) => {
          if (established) return;
          hbuf = Buffer.concat([hbuf, d]);
          const idx = hbuf.indexOf('\r\n\r\n');
          if (idx < 0) return;
          const line = hbuf.slice(0, idx).toString().split('\r\n')[0] ?? '';
          if (!/^HTTP\/1\.[01]\s+200/.test(line)) return fail(new Error(`proxy CONNECT failed: ${line}`));
          established = true;
          sock.removeListener('data', onData);
          const tsock = tls.connect({ socket: sock, servername: host, rejectUnauthorized: false }, () => attach(tsock, path));
          tsock.on('error', fail);
        };
        sock.on('data', onData);
        sock.on('error', fail);
        sock.setTimeout(timeout, () => sock.destroy(new Error('proxy timeout')));
      } else {
        const sock = net.connect(pPort, p.hostname, () => attach(sock, urlStr)); // absolute-form for forward proxy
        sock.on('error', fail);
      }
    } else if (isHttps) {
      const tsock = tls.connect({ host, port, servername: host }, () => attach(tsock, path));
      tsock.on('error', fail);
    } else {
      const sock = net.connect(port, host, () => attach(sock, path));
      sock.on('error', fail);
    }
  });
}

const strip = (html: string) => html.replace(/<[^>]+>/g, ' ');

export function createOffsecTools(config: ResolvedConfig): ToolDefinition[] {
  // --- recon: certificate-transparency subdomains ---
  const crtSchema = z.object({ domain: z.string().min(1).describe('Apex domain, e.g. example.com') });
  const subdomainsCrt: ToolDefinition<z.infer<typeof crtSchema>> = {
    name: 'subdomains_crt',
    category: 'pentest',
    description:
      '[PENTEST] Passive subdomain enumeration via crt.sh certificate-transparency logs. External recon, no packets to the target itself. Pentest mode must be ON.',
    parameters: { type: 'object', properties: { domain: { type: 'string' } }, required: ['domain'] },
    schema: crtSchema,
    kind: 'execute',
    mutating: true,
    summarize: (a) => `crt.sh ${a.domain}`,
    async execute(a) {
      const g = gate(config);
      if (g) return g;
      try {
        const res = await rawHttp('GET', `https://crt.sh/?q=%25.${encodeURIComponent(a.domain)}&output=json`, { timeout: 25_000 });
        let rows: Array<{ name_value?: string }> = [];
        try {
          rows = JSON.parse(res.body || '[]');
        } catch {
          return err('crt.sh returned non-JSON (it is often rate-limited — retry in a moment).');
        }
        const set = new Set<string>();
        for (const r of rows) for (const n of (r.name_value ?? '').split('\n')) if (n && !n.startsWith('*')) set.add(n.trim().toLowerCase());
        const list = [...set].sort();
        return ok(`Found ${list.length} unique subdomains for ${a.domain} (crt.sh):\n\n${list.join('\n') || '(none)'}`.slice(0, MAX_OUTPUT), { kind: 'info', title: 'crt.sh' });
      } catch (e) {
        return err(`crt.sh lookup failed: ${(e as Error).message}`);
      }
    },
  };

  // --- recon: historical URLs from the Wayback Machine ---
  const wbSchema = z.object({
    domain: z.string().min(1).describe('Domain, e.g. example.com'),
    limit: z.number().int().positive().max(5000).optional().describe('Max URLs (default 500).'),
  });
  const waybackUrls: ToolDefinition<z.infer<typeof wbSchema>> = {
    name: 'wayback_urls',
    category: 'pentest',
    description:
      '[PENTEST] Pull historical URLs (endpoints, parameters, old paths) for a domain from the Wayback Machine CDX index. Great for discovering forgotten attack surface. Pentest mode must be ON.',
    parameters: { type: 'object', properties: { domain: { type: 'string' }, limit: { type: 'number' } }, required: ['domain'] },
    schema: wbSchema,
    kind: 'execute',
    mutating: true,
    summarize: (a) => `wayback ${a.domain}`,
    async execute(a) {
      const g = gate(config);
      if (g) return g;
      const limit = a.limit ?? 500;
      try {
        const res = await rawHttp(
          'GET',
          `https://web.archive.org/cdx/search/cdx?url=*.${encodeURIComponent(a.domain)}/*&output=text&fl=original&collapse=urlkey&limit=${limit}`,
          { timeout: 25_000 },
        );
        const urls = res.body.split('\n').map((l) => l.trim()).filter(Boolean);
        const withParams = urls.filter((u) => u.includes('?'));
        const out = [
          `${urls.length} historical URLs for ${a.domain} (Wayback CDX). ${withParams.length} have query parameters (prime targets):`,
          '',
          ...urls.slice(0, 800),
        ].join('\n');
        return ok(truncateMiddle(out, { maxChars: MAX_OUTPUT }).text, { kind: 'info', title: 'Wayback' });
      } catch (e) {
        return err(`Wayback lookup failed: ${(e as Error).message}`);
      }
    },
  };

  // --- passive tech fingerprint ---
  const fpSchema = z.object({ url: z.string().min(1).describe('Full URL of the target.') });
  const techFingerprint: ToolDefinition<z.infer<typeof fpSchema>> = {
    name: 'tech_fingerprint',
    category: 'pentest',
    description:
      '[PENTEST] Passively fingerprint a web target: server, frameworks, languages, CMS, WAF/CDN, and analytics from headers, cookies and HTML. Pentest mode must be ON.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    schema: fpSchema,
    kind: 'execute',
    mutating: true,
    summarize: (a) => `fingerprint ${a.url.slice(0, 60)}`,
    async execute(a) {
      const g = gate(config);
      if (g) return g;
      try {
        const res = await rawHttp('GET', a.url, { timeout: 15_000 });
        const h = res.headers;
        const body = res.body;
        const found: string[] = [];
        const add = (label: string, cond: unknown) => { if (cond) found.push(label); };
        add(`Server: ${h['server']}`, h['server']);
        add(`X-Powered-By: ${h['x-powered-by']}`, h['x-powered-by']);
        add(`Backend: ASP.NET`, h['x-aspnet-version'] || /asp\.net/i.test(h['x-powered-by'] ?? ''));
        add(`Framework: Express`, /express/i.test(h['x-powered-by'] ?? ''));
        add(`Language: PHP`, /php/i.test(h['x-powered-by'] ?? '') || /phpsessid/i.test(h['set-cookie'] ?? ''));
        add(`CMS: WordPress`, /wp-content|wp-json/i.test(body));
        add(`CMS: Drupal`, /drupal-settings-json|\/sites\/default\//i.test(body) || /drupal/i.test(h['x-generator'] ?? ''));
        add(`CMS: Joomla`, /joomla/i.test(body));
        add(`JS: React`, /data-reactroot|__NEXT_DATA__|react/i.test(body));
        add(`JS: Next.js`, /__NEXT_DATA__|\/_next\//i.test(body) || /next\.js/i.test(h['x-powered-by'] ?? ''));
        add(`JS: Vue/Nuxt`, /__NUXT__|data-v-/i.test(body));
        add(`JS: Angular`, /ng-version|angular/i.test(body));
        add(`CDN/WAF: Cloudflare`, h['cf-ray'] || /cloudflare/i.test(h['server'] ?? ''));
        add(`CDN: Fastly`, /fastly/i.test((h['via'] ?? '') + (h['x-served-by'] ?? '')));
        add(`CDN: Akamai`, h['x-akamai-transformed'] !== undefined);
        add(`WAF: Sucuri`, h['x-sucuri-id'] !== undefined);
        add(`Generator: ${h['x-generator']}`, h['x-generator']);
        const cookies = (h['set-cookie'] ?? '').split(/,(?=[^;]+=)/).map((c) => c.split('=')[0]?.trim()).filter(Boolean);
        const out = [
          `${res.status} ${res.statusText}  ${res.proxied ? '(via proxy)' : ''}`,
          '',
          'Detected:',
          ...(found.length ? found.map((f) => `  • ${f}`) : ['  (nothing conclusive from passive signals)']),
          cookies.length ? `\nCookies set: ${cookies.join(', ')}` : '',
          h['content-security-policy'] ? `\nCSP present (review with security_headers-style analysis).` : `\nNo Content-Security-Policy header.`,
        ].join('\n');
        return ok(out.slice(0, MAX_OUTPUT), { kind: 'info', title: 'Fingerprint' });
      } catch (e) {
        return err(`Fingerprint failed: ${(e as Error).message}`);
      }
    },
  };

  // --- CORS misconfiguration audit ---
  const corsSchema = z.object({ url: z.string().min(1).describe('Full URL (an API/endpoint that may return CORS headers).') });
  const corsAudit: ToolDefinition<z.infer<typeof corsSchema>> = {
    name: 'cors_audit',
    category: 'pentest',
    description:
      '[PENTEST] Test a target for CORS misconfigurations: reflected arbitrary Origin, null origin, and Access-Control-Allow-Credentials with a wildcard/reflected origin (account-takeover risk). Pentest mode must be ON.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    schema: corsSchema,
    kind: 'execute',
    mutating: true,
    summarize: (a) => `cors ${a.url.slice(0, 60)}`,
    async execute(a) {
      const g = gate(config);
      if (g) return g;
      const evil = 'https://evil.oxcode-test.example';
      const probes: Array<{ label: string; origin: string }> = [
        { label: 'arbitrary origin reflected', origin: evil },
        { label: 'null origin', origin: 'null' },
      ];
      const findings: string[] = [];
      try {
        for (const p of probes) {
          const res = await rawHttp('GET', a.url, { headers: { Origin: p.origin }, timeout: 12_000 });
          const acao = res.headers['access-control-allow-origin'];
          const acac = res.headers['access-control-allow-credentials'];
          let verdict = 'ok';
          if (acao === p.origin || acao === '*') {
            const cred = acac === 'true';
            verdict = acao === '*' ? 'wildcard ACAO' : `reflects ${p.origin}`;
            if (cred && acao !== '*') findings.push(`VULNERABLE: reflects Origin "${p.origin}" AND allows credentials — cross-origin account data theft.`);
            else if (acao === p.origin) findings.push(`Weak: reflects arbitrary Origin "${p.origin}" (ACAC=${acac ?? 'unset'}).`);
          }
          findings.push(`  [${p.label}] ACAO=${acao ?? '-'} ACAC=${acac ?? '-'} → ${verdict}`);
        }
        return ok(`CORS audit for ${a.url}:\n\n${findings.join('\n')}`, { kind: 'info', title: 'CORS' });
      } catch (e) {
        return err(`CORS audit failed: ${(e as Error).message}`);
      }
    },
  };

  // --- HTTP methods / verbs ---
  const methodsSchema = z.object({ url: z.string().min(1).describe('Full URL.') });
  const httpMethods: ToolDefinition<z.infer<typeof methodsSchema>> = {
    name: 'http_methods',
    category: 'pentest',
    description:
      '[PENTEST] Enumerate allowed HTTP methods (OPTIONS Allow header) and safely probe for dangerous verbs (TRACE, PUT, DELETE, PATCH) and method-override support. Pentest mode must be ON.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    schema: methodsSchema,
    kind: 'execute',
    mutating: true,
    summarize: (a) => `methods ${a.url.slice(0, 60)}`,
    async execute(a) {
      const g = gate(config);
      if (g) return g;
      try {
        const opt = await rawHttp('OPTIONS', a.url, { timeout: 12_000 });
        const allow = opt.headers['allow'] || opt.headers['access-control-allow-methods'] || '(no Allow header)';
        const out: string[] = [`OPTIONS ${a.url} → ${opt.status}`, `Advertised: ${allow}`, ''];
        for (const verb of ['TRACE', 'PUT', 'DELETE', 'PATCH']) {
          try {
            const r = await rawHttp(verb, a.url, { timeout: 10_000 });
            const notable = r.status < 400 || r.status === 405 ? r.status : r.status;
            const flag = verb === 'TRACE' && r.status < 400 ? '  ⚠ TRACE enabled (XST risk)' : r.status < 400 ? '  ⚠ accepted' : '';
            out.push(`${verb} → ${notable}${flag}`);
          } catch (e) {
            out.push(`${verb} → error (${(e as Error).message})`);
          }
        }
        return ok(out.join('\n'), { kind: 'info', title: 'Methods' });
      } catch (e) {
        return err(`Method probe failed: ${(e as Error).message}`);
      }
    },
  };

  // --- GraphQL introspection ---
  const gqlSchema = z.object({ url: z.string().min(1).describe('GraphQL endpoint URL, e.g. https://target/graphql') });
  const graphqlIntrospect: ToolDefinition<z.infer<typeof gqlSchema>> = {
    name: 'graphql_introspect',
    category: 'pentest',
    description:
      '[PENTEST] Check whether a GraphQL endpoint exposes introspection and, if so, list its query/mutation fields and types — a common information-disclosure and attack-surface finding. Pentest mode must be ON.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    schema: gqlSchema,
    kind: 'execute',
    mutating: true,
    summarize: (a) => `graphql ${a.url.slice(0, 60)}`,
    async execute(a) {
      const g = gate(config);
      if (g) return g;
      const query = JSON.stringify({ query: '{__schema{queryType{name} mutationType{name} types{name kind fields{name}}}}' });
      try {
        const res = await rawHttp('POST', a.url, { headers: { 'Content-Type': 'application/json' }, body: query, timeout: 15_000 });
        let data: { data?: { __schema?: { queryType?: { name?: string }; mutationType?: { name?: string }; types?: Array<{ name: string; kind: string; fields?: Array<{ name: string }> }> } } };
        try {
          data = JSON.parse(res.body);
        } catch {
          return ok(`GraphQL introspection appears DISABLED (non-JSON / ${res.status}). Good hardening.\nFirst bytes: ${res.body.slice(0, 200)}`, { kind: 'info', title: 'GraphQL' });
        }
        const schema = data.data?.__schema;
        if (!schema) return ok(`Introspection blocked or endpoint not GraphQL (${res.status}).`, { kind: 'info', title: 'GraphQL' });
        const types = (schema.types ?? []).filter((t) => !t.name.startsWith('__'));
        const q = types.find((t) => t.name === schema.queryType?.name);
        const mut = schema.mutationType ? types.find((t) => t.name === schema.mutationType?.name) : undefined;
        const out = [
          '⚠ GraphQL introspection is ENABLED (information disclosure).',
          `Query fields: ${(q?.fields ?? []).map((f) => f.name).join(', ') || '-'}`,
          `Mutation fields: ${(mut?.fields ?? []).map((f) => f.name).join(', ') || '-'}`,
          `Types (${types.length}): ${types.map((t) => t.name).slice(0, 120).join(', ')}`,
        ].join('\n');
        return ok(truncateMiddle(out, { maxChars: MAX_OUTPUT }).text, { kind: 'info', title: 'GraphQL' });
      } catch (e) {
        return err(`GraphQL introspection failed: ${(e as Error).message}`);
      }
    },
  };

  // --- .well-known / recon files ---
  const wkSchema = z.object({ url: z.string().min(1).describe('Base URL, e.g. https://target') });
  const wellKnown: ToolDefinition<z.infer<typeof wkSchema>> = {
    name: 'recon_files',
    category: 'pentest',
    description:
      '[PENTEST] Probe common recon and /.well-known files (security.txt, robots.txt, sitemap.xml, .git/HEAD, .env, openid config, etc.) and report which exist. Pentest mode must be ON.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    schema: wkSchema,
    kind: 'execute',
    mutating: true,
    summarize: (a) => `recon-files ${a.url.slice(0, 50)}`,
    async execute(a) {
      const g = gate(config);
      if (g) return g;
      const base = a.url.replace(/\/+$/, '');
      const paths = [
        '/robots.txt', '/sitemap.xml', '/security.txt', '/.well-known/security.txt',
        '/.well-known/openid-configuration', '/.well-known/change-password', '/humans.txt',
        '/.git/HEAD', '/.env', '/.env.local', '/config.json', '/wp-json', '/graphql',
        '/api', '/swagger.json', '/openapi.json', '/.well-known/assetlinks.json', '/crossdomain.xml',
      ];
      const rows: string[] = [];
      for (const p of paths) {
        try {
          const r = await rawHttp('GET', base + p, { timeout: 8_000 });
          const interesting = r.status < 400 || r.status === 401 || r.status === 403;
          const flag = (p === '/.git/HEAD' && /^ref:/.test(r.body)) || (p.startsWith('/.env') && /=/.test(r.body) && r.status < 400) ? '  🚨 SENSITIVE EXPOSED' : '';
          if (interesting) rows.push(`${String(r.status).padEnd(3)}  ${p}${flag}`);
        } catch {
          /* unreachable path, skip */
        }
      }
      return ok(`Recon files on ${base}:\n\n${rows.join('\n') || '(none of the common paths responded)'}`, { kind: 'info', title: 'ReconFiles' });
    },
  };

  // --- redirect chain / open redirect ---
  const redirSchema = z.object({
    url: z.string().min(1).describe('URL to follow, e.g. https://target/redirect?next=https://evil.com'),
    max: z.number().int().positive().max(10).optional().describe('Max hops (default 6).'),
  });
  const redirectChain: ToolDefinition<z.infer<typeof redirSchema>> = {
    name: 'redirect_chain',
    category: 'pentest',
    description:
      '[PENTEST] Follow a redirect chain hop by hop and flag open-redirect behavior (the target sending you to an external/attacker-controlled host). Pentest mode must be ON.',
    parameters: { type: 'object', properties: { url: { type: 'string' }, max: { type: 'number' } }, required: ['url'] },
    schema: redirSchema,
    kind: 'execute',
    mutating: true,
    summarize: (a) => `redirects ${a.url.slice(0, 60)}`,
    async execute(a) {
      const g = gate(config);
      if (g) return g;
      const max = a.max ?? 6;
      const startHost = (() => { try { return new URL(a.url).host; } catch { return ''; } })();
      const hops: string[] = [];
      let current = a.url;
      try {
        for (let i = 0; i < max; i++) {
          const r = await rawHttp('GET', current, { timeout: 10_000 });
          const loc = r.headers['location'];
          hops.push(`${r.status} ${current}`);
          if (r.status < 300 || r.status >= 400 || !loc) break;
          const next = new URL(loc, current).toString();
          const nextHost = new URL(next).host;
          if (nextHost && nextHost !== startHost) {
            hops.push(`  ⚠ OPEN REDIRECT to external host: ${nextHost}`);
            break; // note it; do not actually follow off-site
          }
          current = next;
        }
        return ok(`Redirect chain from ${a.url}:\n\n${hops.join('\n')}`, { kind: 'info', title: 'Redirects' });
      } catch (e) {
        return err(`Redirect follow failed: ${(e as Error).message}`);
      }
    },
  };

  // --- hash identification (offline) ---
  const hashSchema = z.object({ hash: z.string().min(3).describe('A hash string to identify.') });
  const hashIdentify: ToolDefinition<z.infer<typeof hashSchema>> = {
    name: 'hash_identify',
    category: 'pentest',
    description:
      '[PENTEST] Identify the likely algorithm(s) of a captured hash by shape/prefix (MD5, SHA-1/256/512, bcrypt, NTLM, MySQL, Argon2, JWT, etc.) to guide cracking. Offline, no network. Pentest mode must be ON.',
    parameters: { type: 'object', properties: { hash: { type: 'string' } }, required: ['hash'] },
    schema: hashSchema,
    kind: 'read',
    mutating: false,
    summarize: (a) => `identify ${a.hash.slice(0, 24)}…`,
    async execute(a) {
      const g = gate(config);
      if (g) return g;
      const h = a.hash.trim();
      const guesses: string[] = [];
      const hexLen = /^[a-f0-9]+$/i.test(h) ? h.length : 0;
      if (h.startsWith('$2a$') || h.startsWith('$2b$') || h.startsWith('$2y$')) guesses.push('bcrypt');
      if (h.startsWith('$argon2')) guesses.push('Argon2');
      if (h.startsWith('$6$')) guesses.push('sha512crypt (Unix)');
      if (h.startsWith('$5$')) guesses.push('sha256crypt (Unix)');
      if (h.startsWith('$1$')) guesses.push('md5crypt (Unix)');
      if (/^[a-f0-9]{3,}:[a-f0-9]{32}$/i.test(h)) guesses.push('salted MD5 (hash:salt)');
      if (h.split('.').length === 3 && h.startsWith('eyJ')) guesses.push('JWT (base64url, use jwt_decode)');
      if (hexLen === 32) guesses.push('MD5', 'NTLM', 'MD4');
      if (hexLen === 40) guesses.push('SHA-1', 'MySQL5 (with * prefix)');
      if (hexLen === 56) guesses.push('SHA-224');
      if (hexLen === 64) guesses.push('SHA-256', 'SHA3-256');
      if (hexLen === 96) guesses.push('SHA-384');
      if (hexLen === 128) guesses.push('SHA-512', 'SHA3-512', 'Whirlpool');
      if (h.startsWith('*') && /^\*[A-F0-9]{40}$/i.test(h)) guesses.push('MySQL 4.1+ (SHA1(SHA1(pw)))');
      const uniq = [...new Set(guesses)];
      return ok(
        uniq.length
          ? `Likely: ${uniq.join(', ')}\n\nNext: crack with a wordlist (hashcat/john) — this tool only classifies, it does not crack. Only proceed on hashes from an authorized engagement.`
          : `Could not confidently classify (length ${h.length}). Provide more context (source, encoding).`,
        { kind: 'info', title: 'HashID' },
      );
    },
  };

  // --- proxy / Burp status ---
  const proxyInfo: ToolDefinition<Record<string, never>> = {
    name: 'proxy_status',
    category: 'pentest',
    description:
      '[PENTEST] Show whether offensive HTTP traffic is being routed through an intercepting proxy (Burp Suite / OWASP ZAP), and how to enable it. Pentest mode must be ON.',
    parameters: { type: 'object', properties: {}, required: [] },
    schema: z.object({}),
    kind: 'read',
    mutating: false,
    summarize: () => 'proxy status',
    async execute() {
      const g = gate(config);
      if (g) return g;
      const p = activeProxy();
      return ok(
        p
          ? `Intercepting proxy ACTIVE: ${p}\nAll offensive HTTP tools (subdomains_crt, wayback_urls, tech_fingerprint, cors_audit, http_methods, graphql_introspect, recon_files, redirect_chain) tunnel through it — watch and replay every request in Burp/ZAP. TLS verification is relaxed so Burp's CA works.`
          : `No intercepting proxy set. To route everything through Burp Suite or ZAP, start it (default 127.0.0.1:8080) and set one of:\n  Windows PowerShell:  $env:BURP_PROXY="http://127.0.0.1:8080"\n  bash/zsh:            export BURP_PROXY=http://127.0.0.1:8080\nThen re-run the tools — requests will appear in the proxy's HTTP history.`,
        { kind: 'info', title: 'Proxy' },
      );
    },
  };

  return [
    subdomainsCrt,
    waybackUrls,
    techFingerprint,
    corsAudit,
    httpMethods,
    graphqlIntrospect,
    wellKnown,
    redirectChain,
    hashIdentify,
    proxyInfo,
  ];
}

export const _internal = { rawHttp, activeProxy, strip };
