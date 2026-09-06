import crypto from 'node:crypto';
import { z } from 'zod';
import type { ResolvedConfig } from '../config/types.js';
import { truncateMiddle } from '../utils/truncate.js';
import { err, ok, type ToolDefinition, type ToolResult } from './types.js';
import { rawHttp } from './offsec.js';

/**
 * Disposable-inbox integration (mail.tm — free, keyless) so the agent can
 * register on a target and READ the verification/OTP email itself, instead of
 * stalling at an email-gated login. Authorized-testing aid; gated behind
 * pentest mode. HTTP tunnels through Burp/ZAP when a proxy is configured.
 */

const GATE =
  'Pentest mode is OFF. This tool only runs in authorized security-testing mode — enable it with /pentest.';
function gate(config: ResolvedConfig): ToolResult | null {
  return config.pentest ? null : err(GATE);
}
const MAX_OUTPUT = 15_000;
const API = 'https://api.mail.tm';

/** In-memory token store per address (survives the process/session). */
const TOKENS = new Map<string, string>();

function parse(body: string): unknown {
  try { return JSON.parse(body); } catch { return null; }
}
async function jget(path: string, token?: string): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await rawHttp('GET', API + path, { headers, timeout: 15_000 });
  return { status: r.status, json: parse(r.body) };
}
async function jpost(path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const r = await rawHttp('POST', API + path, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    timeout: 15_000,
  });
  return { status: r.status, json: parse(r.body) };
}
function members(json: unknown): Array<Record<string, unknown>> {
  // mail.tm returns a plain array with Accept: application/json, or a JSON-LD
  // object with "hydra:member" — handle both.
  if (Array.isArray(json)) return json as Array<Record<string, unknown>>;
  const m = (json as { 'hydra:member'?: unknown })?.['hydra:member'];
  return Array.isArray(m) ? (m as Array<Record<string, unknown>>) : [];
}
function extractSignals(text: string): { codes: string[]; links: string[] } {
  const codes = [...new Set((text.match(/\b\d{4,8}\b/g) ?? []))].slice(0, 10);
  const links = [...new Set((text.match(/https?:\/\/[^\s"'<>)\]]+/g) ?? []))].slice(0, 15);
  return { codes, links };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function createInbox(): Promise<{ address: string; token: string } | { error: string }> {
  const dom = await jget('/domains?page=1');
  const domain = members(dom.json).find((d) => d.isActive !== false)?.domain as string | undefined;
  if (!domain) return { error: `mail.tm: could not fetch a domain (status ${dom.status}).` };
  const address = `ox${crypto.randomBytes(6).toString('hex')}@${domain}`;
  const password = crypto.randomBytes(12).toString('base64url');
  const acc = await jpost('/accounts', { address, password });
  if (acc.status !== 201 && acc.status !== 200) return { error: `mail.tm: account create failed (status ${acc.status}).` };
  const tok = await jpost('/token', { address, password });
  const token = (tok.json as { token?: string })?.token;
  if (!token) return { error: `mail.tm: token request failed (status ${tok.status}).` };
  TOKENS.set(address, token);
  return { address, token };
}

async function listMessages(address: string): Promise<{ status: number; list: Array<Record<string, unknown>> }> {
  const token = TOKENS.get(address);
  if (!token) return { status: 0, list: [] };
  const r = await jget('/messages?page=1', token);
  return { status: r.status, list: members(r.json) };
}

export function createTempmailTools(config: ResolvedConfig): ToolDefinition[] {
  const schema = z.object({
    action: z.enum(['create', 'inbox', 'read', 'wait']).describe('create a new inbox, list the inbox, read one message, or wait for a new message.'),
    address: z.string().optional().describe('The inbox address (from a prior create). Required for inbox/read/wait.'),
    id: z.string().optional().describe('Message id (from inbox), for action=read.'),
    timeoutSec: z.number().int().min(5).max(180).optional().describe('For action=wait: how long to poll for a new message (default 60).'),
  });

  const tool: ToolDefinition = {
    name: 'tempmail',
    description:
      '[PENTEST] Disposable email inbox (mail.tm, free/keyless) so you can register on a target and read ' +
      'its verification/OTP email yourself — no operator email needed. Actions: create (new random inbox → ' +
      'returns an address to use as the registration email), inbox (list received mail), read (full body of ' +
      'one message with any codes/links auto-extracted), wait (poll until the verification mail arrives, then ' +
      'read it). Typical flow: create → register on the target with that address → wait → use the extracted ' +
      'OTP/link → auth_session with the resulting token. Pentest mode ON.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'inbox', 'read', 'wait'] },
        address: { type: 'string' },
        id: { type: 'string' },
        timeoutSec: { type: 'number' },
      },
      required: ['action'],
    },
    schema,
    category: 'pentest',
    kind: 'execute',
    mutating: false,
    summarize: (a: z.infer<typeof schema>) => `tempmail ${a.action}${a.address ? ' ' + a.address : ''}`,
    async execute(a: z.infer<typeof schema>) {
      const g = gate(config);
      if (g) return g;
      try {
        if (a.action === 'create') {
          const r = await createInbox();
          if ('error' in r) return err(r.error);
          return ok(`New disposable inbox:\n  address: ${r.address}\nUse it as the registration email, then tempmail wait ${r.address} to read the verification message.`, { kind: 'info', title: 'tempmail' });
        }
        if (!a.address) return err('address is required for inbox/read/wait (create one first with action=create).');
        if (!TOKENS.has(a.address)) return err(`No session for ${a.address} in this run — create the inbox here first (action=create). Disposable inboxes only live in the session that made them.`);

        if (a.action === 'inbox') {
          const { status, list } = await listMessages(a.address);
          if (status !== 200) return err(`mail.tm inbox fetch failed (status ${status}).`);
          if (list.length === 0) return ok(`Inbox ${a.address} is empty.`, { kind: 'info', title: 'tempmail' });
          const lines = list.map((m) => `  #${m.id}  from ${(m.from as { address?: string })?.address ?? '?'}  —  ${m.subject ?? '(no subject)'}`);
          return ok(`Inbox ${a.address} (${list.length}):\n${lines.join('\n')}\n\nRead one with action=read, id=<#id>.`, { kind: 'info', title: 'tempmail' });
        }

        if (a.action === 'read') {
          if (!a.id) return err('id is required for action=read (get it from action=inbox).');
          const token = TOKENS.get(a.address)!;
          const r = await jget(`/messages/${encodeURIComponent(a.id)}`, token);
          if (r.status !== 200) return err(`mail.tm read failed (status ${r.status}).`);
          const msg = r.json as { subject?: string; text?: string; html?: string[] | string };
          const bodyText = msg.text ?? (Array.isArray(msg.html) ? msg.html.join('\n') : msg.html ?? '');
          const { codes, links } = extractSignals(bodyText);
          const out =
            `Subject: ${msg.subject ?? '(none)'}\n` +
            (codes.length ? `Codes found: ${codes.join(', ')}\n` : '') +
            (links.length ? `Links found:\n  ${links.join('\n  ')}\n` : '') +
            `\n--- body ---\n${bodyText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`;
          return ok(truncateMiddle(out, { maxChars: MAX_OUTPUT }).text, { kind: 'info', title: 'tempmail' });
        }

        // action === 'wait'
        const timeout = (a.timeoutSec ?? 60) * 1000;
        const start = Date.now();
        const before = (await listMessages(a.address)).list.length;
        while (Date.now() - start < timeout) {
          await sleep(3000);
          const { status, list } = await listMessages(a.address);
          if (status === 200 && list.length > before) {
            const newest = list[0]!;
            const token = TOKENS.get(a.address)!;
            const r = await jget(`/messages/${encodeURIComponent(String(newest.id))}`, token);
            const msg = r.json as { subject?: string; text?: string; html?: string[] | string };
            const bodyText = msg?.text ?? (Array.isArray(msg?.html) ? msg.html.join('\n') : msg?.html ?? String(newest.intro ?? ''));
            const { codes, links } = extractSignals(bodyText);
            const out =
              `Mail arrived in ${Math.round((Date.now() - start) / 1000)}s.\n` +
              `Subject: ${msg?.subject ?? newest.subject ?? '(none)'}\n` +
              (codes.length ? `Codes found: ${codes.join(', ')}\n` : '') +
              (links.length ? `Links found:\n  ${links.join('\n  ')}\n` : '') +
              `\n--- body ---\n${bodyText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`;
            return ok(truncateMiddle(out, { maxChars: MAX_OUTPUT }).text, { kind: 'info', title: 'tempmail' });
          }
        }
        return ok(`No new mail in ${a.timeoutSec ?? 60}s for ${a.address}. Trigger the send (register/resend) and wait again, or check with action=inbox.`, { kind: 'info', title: 'tempmail' });
      } catch (e) {
        return err(`tempmail failed: ${(e as Error).message}`);
      }
    },
  };

  return [tool];
}
