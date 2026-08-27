import fs from 'node:fs';
import { z } from 'zod';
import type { ResolvedConfig } from '../config/types.js';
import { resolveInCwd } from '../utils/paths.js';
import { truncateMiddle } from '../utils/truncate.js';
import { err, ok, type ToolDefinition, type ToolResult } from './types.js';
import { activeProxy, rawHttp, type RawResponse } from './offsec.js';

/**
 * OxProxy — a Burp-Suite-style web-security workbench built for the AI to drive
 * with tools instead of a GUI. Every request the agent sends is captured in an
 * in-memory history and addressable by id, so it can Repeat (Repeater), fuzz
 * (Intruder), Compare, and Decode — the core Burp workflow, fully scriptable.
 *
 * AUTHORIZED ENGAGEMENTS ONLY: pentest mode must be ON (gated + auto-approved),
 * and requests still tunnel through Burp/ZAP too if BURP_PROXY is set.
 */

const GATE =
  'Pentest mode is OFF. OxProxy only runs in authorized security-testing mode — enable it with /pentest.';
function gate(config: ResolvedConfig): ToolResult | null {
  return config.pentest ? null : err(GATE);
}
const MAX_OUTPUT = 20_000;
const MAX_HISTORY = 500;

interface Entry {
  id: number;
  ts: number;
  req: { method: string; url: string; headers: Record<string, string>; body?: string };
  res: { status: number; statusText: string; headers: Record<string, string>; body: string; ms: number; length: number; proxied: boolean };
  note?: string;
}

/** Session-lived capture store (the "Proxy history"). */
const HISTORY: Entry[] = [];
let SEQ = 0;

function record(req: Entry['req'], res: RawResponse, ms: number, note?: string): Entry {
  const e: Entry = {
    id: ++SEQ,
    ts: Date.now(),
    req,
    res: { status: res.status, statusText: res.statusText, headers: res.headers, body: res.body, ms, length: res.body.length, proxied: res.proxied },
    note,
  };
  HISTORY.push(e);
  if (HISTORY.length > MAX_HISTORY) HISTORY.shift();
  return e;
}
function get(id: number): Entry | undefined {
  return HISTORY.find((e) => e.id === id);
}
function line(e: Entry): string {
  const host = (() => { try { return new URL(e.req.url).host; } catch { return e.req.url; } })();
  return `#${e.id}  ${e.req.method.padEnd(6)} ${e.res.status}  ${String(e.res.length).padStart(6)}b  ${String(e.res.ms).padStart(5)}ms  ${host}${new URL(e.req.url).pathname}`.slice(0, 160);
}
function fullView(e: Entry): string {
  const reqHdrs = Object.entries(e.req.headers).map(([k, v]) => `${k}: ${v}`).join('\n');
  const resHdrs = Object.entries(e.res.headers).map(([k, v]) => `${k}: ${v}`).join('\n');
  return [
    `#${e.id}  ${e.res.proxied ? '(via proxy)' : ''}  ${e.res.ms}ms`,
    '',
    `--- request ---`,
    `${e.req.method} ${e.req.url}`,
    reqHdrs || '(default headers)',
    e.req.body ? `\n${e.req.body}` : '',
    '',
    `--- response: ${e.res.status} ${e.res.statusText} (${e.res.length} bytes) ---`,
    resHdrs || '(none)',
    '',
    truncateMiddle(e.res.body, { maxChars: 10_000 }).text,
  ].join('\n');
}

async function timedSend(method: string, url: string, headers: Record<string, string>, body?: string): Promise<{ res: RawResponse; ms: number }> {
  const t0 = Date.now();
  const res = await rawHttp(method, url, { headers, body, timeout: 20_000 });
  return { res, ms: Date.now() - t0 };
}

// ---- Intruder helpers ----
function applyPayload(template: string, payload: string): string {
  return template.split('FUZZ').join(payload);
}
function loadPayloads(cwd: string, inline?: string[], file?: string): string[] {
  if (inline && inline.length) return inline.slice(0, 5000);
  if (file) {
    const raw = fs.readFileSync(resolveInCwd(cwd, file), 'utf8');
    return raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).slice(0, 5000);
  }
  return [];
}

export function createOxProxyTools(config: ResolvedConfig): ToolDefinition[] {
  // ---- Repeater: send + capture ----
  const sendSchema = z.object({
    method: z.string().max(10).optional().describe('HTTP method (default GET).'),
    url: z.string().min(1).describe('Full URL.'),
    headers: z.record(z.string()).optional().describe('Request headers.'),
    body: z.string().max(200_000).optional().describe('Request body.'),
    note: z.string().max(120).optional().describe('Optional label for the history entry.'),
  });
  const send: ToolDefinition<z.infer<typeof sendSchema>> = {
    name: 'proxy_send',
    category: 'pentest',
    description:
      '[OXPROXY] Send an HTTP request and capture it in the proxy history (returns an #id you can Repeat/Compare later). This is the workbench entry point — like sending a request in Burp. Pentest mode must be ON.',
    parameters: { type: 'object', properties: { method: { type: 'string' }, url: { type: 'string' }, headers: { type: 'object', additionalProperties: { type: 'string' } }, body: { type: 'string' }, note: { type: 'string' } }, required: ['url'] },
    schema: sendSchema,
    kind: 'execute',
    mutating: true,
    summarize: (a) => `${(a.method ?? 'GET').toUpperCase()} ${a.url.slice(0, 70)}`,
    async execute(a) {
      const g = gate(config); if (g) return g;
      const method = (a.method ?? 'GET').toUpperCase();
      try {
        const { res, ms } = await timedSend(method, a.url, a.headers ?? {}, a.body);
        const e = record({ method, url: a.url, headers: a.headers ?? {}, body: a.body }, res, ms, a.note);
        return ok(`Captured ${line(e)}\n\n${fullView(e)}`.slice(0, MAX_OUTPUT), { kind: 'info', title: 'OxProxy' });
      } catch (err2) { return err(`Request failed: ${(err2 as Error).message}`); }
    },
  };

  // ---- History ----
  const histSchema = z.object({ limit: z.number().int().positive().max(200).optional(), filter: z.string().optional().describe('Only show entries whose URL contains this.') });
  const history: ToolDefinition<z.infer<typeof histSchema>> = {
    name: 'proxy_history',
    category: 'pentest',
    description: '[OXPROXY] List captured requests (id, method, status, size, time, path). Like Burp\'s Proxy HTTP history. Pentest mode must be ON.',
    parameters: { type: 'object', properties: { limit: { type: 'number' }, filter: { type: 'string' } }, required: [] },
    schema: histSchema,
    kind: 'read',
    mutating: false,
    summarize: () => 'proxy history',
    async execute(a) {
      const g = gate(config); if (g) return g;
      let items = HISTORY;
      if (a.filter) items = items.filter((e) => e.req.url.includes(a.filter!));
      const rows = items.slice(-(a.limit ?? 50)).map(line);
      return ok(rows.length ? `${items.length} captured (showing ${rows.length}):\n\n${rows.join('\n')}` : 'History is empty. Use proxy_send first.', { kind: 'info', title: 'History' });
    },
  };

  // ---- View one ----
  const viewSchema = z.object({ id: z.number().int().positive().describe('History entry id (#N).') });
  const view: ToolDefinition<z.infer<typeof viewSchema>> = {
    name: 'proxy_view',
    category: 'pentest',
    description: '[OXPROXY] Show the full request and response of a captured entry by id. Pentest mode must be ON.',
    parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    schema: viewSchema,
    kind: 'read',
    mutating: false,
    summarize: (a) => `view #${a.id}`,
    async execute(a) {
      const g = gate(config); if (g) return g;
      const e = get(a.id); if (!e) return err(`No history entry #${a.id}.`);
      return ok(fullView(e).slice(0, MAX_OUTPUT), { kind: 'info', title: 'OxProxy' });
    },
  };

  // ---- Repeater: resend a captured request with tweaks ----
  const repeatSchema = z.object({
    id: z.number().int().positive().describe('Entry to resend.'),
    method: z.string().max(10).optional(),
    url: z.string().optional(),
    setHeaders: z.record(z.string()).optional().describe('Headers to add/override.'),
    removeHeaders: z.array(z.string()).optional().describe('Header names to drop.'),
    body: z.string().max(200_000).optional().describe('Replace the body.'),
  });
  const repeat: ToolDefinition<z.infer<typeof repeatSchema>> = {
    name: 'proxy_repeat',
    category: 'pentest',
    description:
      '[OXPROXY] Repeater: resend a captured request with modifications (method, url, headers, body) and see how the response changes. Great for IDOR, auth bypass, and tampering. Pentest mode must be ON.',
    parameters: { type: 'object', properties: { id: { type: 'number' }, method: { type: 'string' }, url: { type: 'string' }, setHeaders: { type: 'object', additionalProperties: { type: 'string' } }, removeHeaders: { type: 'array', items: { type: 'string' } }, body: { type: 'string' } }, required: ['id'] },
    schema: repeatSchema,
    kind: 'execute',
    mutating: true,
    summarize: (a) => `repeat #${a.id}`,
    async execute(a) {
      const g = gate(config); if (g) return g;
      const base = get(a.id); if (!base) return err(`No history entry #${a.id}.`);
      const headers = { ...base.req.headers, ...(a.setHeaders ?? {}) };
      for (const h of a.removeHeaders ?? []) { delete headers[h]; delete headers[h.toLowerCase()]; }
      const method = (a.method ?? base.req.method).toUpperCase();
      const url = a.url ?? base.req.url;
      const body = a.body !== undefined ? a.body : base.req.body;
      try {
        const { res, ms } = await timedSend(method, url, headers, body);
        const e = record({ method, url, headers, body }, res, ms, `repeat of #${a.id}`);
        const dStatus = e.res.status !== base.res.status ? `status ${base.res.status} → ${e.res.status}` : `status ${e.res.status} (same)`;
        const dLen = e.res.length - base.res.length;
        return ok(`Repeated #${a.id} → ${line(e)}\nΔ ${dStatus}, length ${dLen >= 0 ? '+' : ''}${dLen}\n\n${fullView(e)}`.slice(0, MAX_OUTPUT), { kind: 'info', title: 'Repeater' });
      } catch (err2) { return err(`Repeat failed: ${(err2 as Error).message}`); }
    },
  };

  // ---- Intruder: fuzz a FUZZ marker ----
  const intrSchema = z.object({
    method: z.string().max(10).optional(),
    url: z.string().min(1).describe('URL template — put FUZZ where the payload goes, e.g. /user/FUZZ.'),
    headers: z.record(z.string()).optional().describe('Header template (may contain FUZZ).'),
    body: z.string().max(50_000).optional().describe('Body template (may contain FUZZ).'),
    payloads: z.array(z.string()).max(2000).optional().describe('Inline payload list.'),
    wordlistFile: z.string().optional().describe('Payload file (one per line), relative to the workspace.'),
    maxRequests: z.number().int().positive().max(1000).optional().describe('Cap (default 150).'),
    delayMs: z.number().int().min(0).max(2000).optional().describe('Delay between requests (default 60).'),
  });
  const intruder: ToolDefinition<z.infer<typeof intrSchema>> = {
    name: 'proxy_intruder',
    category: 'pentest',
    description:
      '[OXPROXY] Intruder: replace the FUZZ marker (in url/headers/body) with each payload, send them (rate-limited, bounded), and cluster the responses by status/length to surface anomalies (auth bypass, IDOR hits, error leaks, valid values). Pentest mode must be ON. Authorized targets only.',
    parameters: { type: 'object', properties: { method: { type: 'string' }, url: { type: 'string' }, headers: { type: 'object', additionalProperties: { type: 'string' } }, body: { type: 'string' }, payloads: { type: 'array', items: { type: 'string' } }, wordlistFile: { type: 'string' }, maxRequests: { type: 'number' }, delayMs: { type: 'number' } }, required: ['url'] },
    schema: intrSchema,
    kind: 'execute',
    mutating: true,
    summarize: (a) => `intruder ${a.url.slice(0, 60)}`,
    async execute(a, ctx) {
      const g = gate(config); if (g) return g;
      let payloads: string[];
      try { payloads = loadPayloads(ctx.cwd, a.payloads, a.wordlistFile); } catch (e) { return err(`Could not load payloads: ${(e as Error).message}`); }
      if (!payloads.length) return err('Provide payloads[] or wordlistFile.');
      const marker = a.url.includes('FUZZ') || (a.body ?? '').includes('FUZZ') || Object.values(a.headers ?? {}).some((v) => v.includes('FUZZ'));
      if (!marker) return err('No FUZZ marker found in url/body/headers. Put FUZZ where the payload should go.');
      const method = (a.method ?? 'GET').toUpperCase();
      const cap = Math.min(payloads.length, a.maxRequests ?? 150);
      const delay = a.delayMs ?? 60;
      const results: Array<{ p: string; status: number; len: number; ms: number; err?: string }> = [];
      for (let i = 0; i < cap; i++) {
        if (ctx.signal?.aborted) break;
        const p = payloads[i]!;
        const url = applyPayload(a.url, p);
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(a.headers ?? {})) headers[k] = applyPayload(v, p);
        const body = a.body !== undefined ? applyPayload(a.body, p) : undefined;
        try {
          const { res, ms } = await timedSend(method, url, headers, body);
          results.push({ p, status: res.status, len: res.body.length, ms });
        } catch (e) { results.push({ p, status: 0, len: 0, ms: 0, err: (e as Error).message }); }
        if (delay) await new Promise((r) => setTimeout(r, delay));
      }
      // baseline = most common (status,len-bucket); flag outliers
      const key = (r: { status: number; len: number }) => `${r.status}:${Math.round(r.len / 32)}`;
      const counts = new Map<string, number>();
      for (const r of results) counts.set(key(r), (counts.get(key(r)) ?? 0) + 1);
      const baseKey = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
      const anomalies = results.filter((r) => key(r) !== baseKey);
      const fmt = (r: { p: string; status: number; len: number; ms: number; err?: string }) => `  ${String(r.status).padEnd(3)} ${String(r.len).padStart(6)}b ${String(r.ms).padStart(5)}ms  ${r.err ? 'ERR ' + r.err : JSON.stringify(r.p).slice(0, 60)}`;
      const out = [
        `Intruder: ${results.length}/${payloads.length} payloads sent (${method}).`,
        `Baseline cluster: ${baseKey} (${counts.get(baseKey ?? '') ?? 0} responses).`,
        anomalies.length ? `\n⚑ ${anomalies.length} anomalies (different status/size — investigate these):\n${anomalies.slice(0, 60).map(fmt).join('\n')}` : '\nNo anomalies — all responses clustered together.',
      ].join('\n');
      return ok(truncateMiddle(out, { maxChars: MAX_OUTPUT }).text, { kind: 'info', title: 'Intruder' });
    },
  };

  // ---- Comparer ----
  const cmpSchema = z.object({ a: z.number().int().positive(), b: z.number().int().positive() });
  const compare: ToolDefinition<z.infer<typeof cmpSchema>> = {
    name: 'proxy_compare',
    category: 'pentest',
    description: '[OXPROXY] Comparer: diff two captured responses (status, length, and line-level added/removed). Pentest mode must be ON.',
    parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
    schema: cmpSchema,
    kind: 'read',
    mutating: false,
    summarize: (a) => `compare #${a.a} vs #${a.b}`,
    async execute(a) {
      const g = gate(config); if (g) return g;
      const ea = get(a.a), eb = get(a.b);
      if (!ea || !eb) return err(`Need two valid history ids (have #${a.a}=${!!ea}, #${a.b}=${!!eb}).`);
      const la = new Set(ea.res.body.split('\n'));
      const lb = new Set(eb.res.body.split('\n'));
      const added = [...lb].filter((l) => !la.has(l)).slice(0, 40);
      const removed = [...la].filter((l) => !lb.has(l)).slice(0, 40);
      const out = [
        `#${a.a} vs #${a.b}`,
        `status: ${ea.res.status} → ${eb.res.status}`,
        `length: ${ea.res.length} → ${eb.res.length} (${eb.res.length - ea.res.length >= 0 ? '+' : ''}${eb.res.length - ea.res.length})`,
        added.length ? `\n+ only in #${a.b}:\n${added.map((l) => '  + ' + l).join('\n')}` : '',
        removed.length ? `\n- only in #${a.a}:\n${removed.map((l) => '  - ' + l).join('\n')}` : '',
      ].join('\n');
      return ok(truncateMiddle(out, { maxChars: MAX_OUTPUT }).text, { kind: 'info', title: 'Comparer' });
    },
  };

  // ---- Decoder ----
  const decSchema = z.object({
    action: z.enum(['encode', 'decode']),
    codec: z.enum(['base64', 'base64url', 'url', 'hex', 'html', 'jwt']),
    input: z.string().min(1),
  });
  const decoder: ToolDefinition<z.infer<typeof decSchema>> = {
    name: 'proxy_decode',
    category: 'pentest',
    description: '[OXPROXY] Decoder: encode/decode a value (base64, base64url, url, hex, html entities) or decode a JWT into header+payload JSON. Pentest mode must be ON.',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ['encode', 'decode'] }, codec: { type: 'string', enum: ['base64', 'base64url', 'url', 'hex', 'html', 'jwt'] }, input: { type: 'string' } }, required: ['action', 'codec', 'input'] },
    schema: decSchema,
    kind: 'read',
    mutating: false,
    summarize: (a) => `${a.action} ${a.codec}`,
    async execute(a) {
      const g = gate(config); if (g) return g;
      const s = a.input;
      try {
        let out = '';
        if (a.codec === 'jwt') {
          const parts = s.split('.');
          if (parts.length < 2) return err('Not a JWT (need at least header.payload).');
          const dec = (p: string) => Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
          out = `header:\n${dec(parts[0]!)}\n\npayload:\n${dec(parts[1]!)}`;
        } else if (a.codec === 'base64') {
          out = a.action === 'encode' ? Buffer.from(s, 'utf8').toString('base64') : Buffer.from(s, 'base64').toString('utf8');
        } else if (a.codec === 'base64url') {
          out = a.action === 'encode'
            ? Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
            : Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
        } else if (a.codec === 'url') {
          out = a.action === 'encode' ? encodeURIComponent(s) : decodeURIComponent(s);
        } else if (a.codec === 'hex') {
          out = a.action === 'encode' ? Buffer.from(s, 'utf8').toString('hex') : Buffer.from(s, 'hex').toString('utf8');
        } else {
          out = a.action === 'encode'
            ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
            : s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
        }
        return ok(out.slice(0, MAX_OUTPUT), { kind: 'info', title: 'Decoder' });
      } catch (e) { return err(`Decode failed: ${(e as Error).message}`); }
    },
  };

  // ---- Clear ----
  const clear: ToolDefinition<Record<string, never>> = {
    name: 'proxy_clear',
    category: 'pentest',
    description: '[OXPROXY] Clear the captured request history. Pentest mode must be ON.',
    parameters: { type: 'object', properties: {}, required: [] },
    schema: z.object({}),
    kind: 'read',
    mutating: false,
    summarize: () => 'clear history',
    async execute() {
      const g = gate(config); if (g) return g;
      const n = HISTORY.length; HISTORY.length = 0;
      return ok(`Cleared ${n} captured requests.${activeProxy() ? ' (upstream proxy ' + activeProxy() + ' still active)' : ''}`, { kind: 'info', title: 'OxProxy' });
    },
  };

  return [send, history, view, repeat, intruder, compare, decoder, clear];
}

export const _oxproxyInternal = { HISTORY, record, get };
