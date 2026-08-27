import { execa } from 'execa';
import { z } from 'zod';
import type { ResolvedConfig } from '../config/types.js';
import { truncateMiddle } from '../utils/truncate.js';
import { rawHttp } from './offsec.js';
import { err, ok, type ToolDefinition, type ToolResult } from './types.js';

/**
 * Real-tool bridge: run the actual industry-standard offensive binaries the
 * user has installed (nmap, sqlmap, nikto, gobuster/ffuf, nuclei, wpscan,
 * hydra, amass/subfinder, testssl.sh, …) and drive a real Burp Suite via its
 * REST API. AUTHORIZED ENGAGEMENTS ONLY — pentest mode gated, approval gated.
 *
 * Only binaries in the curated CATALOG can be launched (no arbitrary shell),
 * and each run is time-bounded.
 */

const GATE = 'Pentest mode is OFF. Real security tools only run in authorized security-testing mode — enable it with /pentest.';
function gate(config: ResolvedConfig): ToolResult | null {
  return config.pentest ? null : err(GATE);
}
const MAX_OUTPUT = 24_000;

interface CatalogItem { name: string; bin: string; group: string; desc: string; }
const CATALOG: CatalogItem[] = [
  // --- port / network scanning ---
  { name: 'nmap', bin: 'nmap', group: 'scan', desc: 'Port/service/version scanning, NSE scripts' },
  { name: 'masscan', bin: 'masscan', group: 'scan', desc: 'Very fast Internet-scale port scanner' },
  { name: 'naabu', bin: 'naabu', group: 'scan', desc: 'Fast port scanner (ProjectDiscovery)' },
  { name: 'rustscan', bin: 'rustscan', group: 'scan', desc: 'Fast port scanner, pipes to nmap' },
  // --- web content / vuln ---
  { name: 'nikto', bin: 'nikto', group: 'web', desc: 'Web server misconfiguration/vuln scanner' },
  { name: 'whatweb', bin: 'whatweb', group: 'web', desc: 'Web technology fingerprinting' },
  { name: 'wafw00f', bin: 'wafw00f', group: 'web', desc: 'WAF detection' },
  { name: 'gobuster', bin: 'gobuster', group: 'web', desc: 'Directory/DNS/vhost brute forcing' },
  { name: 'feroxbuster', bin: 'feroxbuster', group: 'web', desc: 'Recursive content discovery' },
  { name: 'dirb', bin: 'dirb', group: 'web', desc: 'Classic web content scanner' },
  { name: 'ffuf', bin: 'ffuf', group: 'web', desc: 'Fast web fuzzer (paths, params, vhosts)' },
  { name: 'wpscan', bin: 'wpscan', group: 'web', desc: 'WordPress vulnerability scanner' },
  { name: 'nuclei', bin: 'nuclei', group: 'web', desc: 'Template-based vulnerability scanner' },
  { name: 'dalfox', bin: 'dalfox', group: 'web', desc: 'XSS scanner/parameter analysis' },
  { name: 'sqlmap', bin: 'sqlmap', group: 'web', desc: 'Automated SQL injection exploitation' },
  { name: 'katana', bin: 'katana', group: 'web', desc: 'Web crawler (ProjectDiscovery)' },
  { name: 'gospider', bin: 'gospider', group: 'web', desc: 'Web spider' },
  { name: 'httpx', bin: 'httpx', group: 'web', desc: 'HTTP probing/tech detection at scale' },
  { name: 'arjun', bin: 'arjun', group: 'web', desc: 'HTTP parameter discovery' },
  // --- dns / subdomains ---
  { name: 'amass', bin: 'amass', group: 'dns', desc: 'Attack-surface / subdomain enumeration' },
  { name: 'subfinder', bin: 'subfinder', group: 'dns', desc: 'Passive subdomain enumeration' },
  { name: 'dnsx', bin: 'dnsx', group: 'dns', desc: 'Fast DNS toolkit/resolver' },
  { name: 'dnsrecon', bin: 'dnsrecon', group: 'dns', desc: 'DNS enumeration incl. zone transfer' },
  { name: 'dnsenum', bin: 'dnsenum', group: 'dns', desc: 'DNS enumeration' },
  { name: 'fierce', bin: 'fierce', group: 'dns', desc: 'DNS reconnaissance' },
  // --- tls ---
  { name: 'testssl', bin: 'testssl.sh', group: 'tls', desc: 'Thorough TLS/SSL configuration testing' },
  { name: 'sslscan', bin: 'sslscan', group: 'tls', desc: 'TLS/SSL cipher and protocol scan' },
  { name: 'sslyze', bin: 'sslyze', group: 'tls', desc: 'TLS configuration analyzer' },
  // --- auth / cracking ---
  { name: 'hydra', bin: 'hydra', group: 'brute', desc: 'Network login brute forcer' },
  { name: 'medusa', bin: 'medusa', group: 'brute', desc: 'Parallel network login brute forcer' },
  { name: 'john', bin: 'john', group: 'crack', desc: 'John the Ripper password cracker' },
  { name: 'hashcat', bin: 'hashcat', group: 'crack', desc: 'GPU password/hash cracker' },
  { name: 'hashid', bin: 'hashid', group: 'crack', desc: 'Hash type identifier' },
  // --- osint / misc ---
  { name: 'theharvester', bin: 'theHarvester', group: 'osint', desc: 'Email/subdomain/host OSINT' },
  { name: 'nrich', bin: 'nrich', group: 'osint', desc: 'Enrich IPs with open ports/CVEs (Shodan)' },
];
const byName = new Map(CATALOG.map((c) => [c.name, c] as const));

async function installed(bin: string): Promise<boolean> {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  try {
    const r = await execa(probe, [bin], { reject: false });
    return r.exitCode === 0;
  } catch {
    return false;
  }
}

export function createSecurityToolTools(config: ResolvedConfig): ToolDefinition[] {
  // ---- catalog / availability ----
  const listSchema = z.object({ group: z.string().optional().describe('Filter by group: scan, web, dns, tls, brute, crack, osint.') });
  const list: ToolDefinition<z.infer<typeof listSchema>> = {
    name: 'security_tools',
    category: 'pentest',
    description: '[TOOLS] List the real offensive-security binaries OxCode can launch (nmap, sqlmap, nikto, gobuster, ffuf, nuclei, wpscan, hydra, amass, testssl.sh…) and which are installed on this machine. Pentest mode must be ON.',
    parameters: { type: 'object', properties: { group: { type: 'string' } }, required: [] },
    schema: listSchema,
    kind: 'execute',
    mutating: false,
    summarize: () => 'list security tools',
    async execute(a) {
      const g = gate(config); if (g) return g;
      const items = a.group ? CATALOG.filter((c) => c.group === a.group) : CATALOG;
      const checks = await Promise.all(items.map(async (c) => ({ c, ok: await installed(c.bin) })));
      const groups = [...new Set(items.map((c) => c.group))];
      const lines: string[] = [];
      for (const gr of groups) {
        lines.push(`\n[${gr}]`);
        for (const { c, ok: has } of checks.filter((x) => x.c.group === gr)) lines.push(`  ${has ? '✅' : '· '} ${c.name.padEnd(13)} ${c.desc}`);
      }
      const missing = checks.filter((x) => !x.ok).length;
      return ok(
        `Real security tools (✅ = installed here):\n${lines.join('\n')}\n\n${checks.length - missing}/${checks.length} installed. ` +
          `Run one with run_security_tool. Missing ones install via your package manager (Kali: sudo apt install <name>; ProjectDiscovery: go install …).`,
        { kind: 'info', title: 'Toolbox' },
      );
    },
  };

  // ---- run a real tool ----
  const runSchema = z.object({
    tool: z.string().min(1).describe('Catalog name, e.g. nmap, sqlmap, nuclei, gobuster.'),
    args: z.array(z.string()).max(60).describe('Full argument list for the tool, including the target, e.g. ["-sV","-p-","10.0.0.5"].'),
    timeoutSec: z.number().int().positive().max(1800).optional().describe('Kill after N seconds (default 300).'),
    input: z.string().max(20_000).optional().describe('Optional text piped to the tool\'s stdin.'),
  });
  const run: ToolDefinition<z.infer<typeof runSchema>> = {
    name: 'run_security_tool',
    category: 'pentest',
    description:
      '[TOOLS] Launch a real installed security binary from the catalog with your arguments, capture its output, and return it. Use for the genuine tools — nmap, sqlmap, nikto, gobuster/ffuf, nuclei, wpscan, hydra, amass, testssl.sh, etc. Only authorized targets. Pentest mode must be ON. See security_tools for what is installed.',
    parameters: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'catalog tool name' },
        args: { type: 'array', items: { type: 'string' }, description: 'argument list incl. target' },
        timeoutSec: { type: 'number' },
        input: { type: 'string' },
      },
      required: ['tool', 'args'],
    },
    schema: runSchema,
    kind: 'execute',
    mutating: true,
    summarize: (a) => `${a.tool} ${a.args.join(' ')}`.slice(0, 90),
    async execute(a, ctx) {
      const g = gate(config); if (g) return g;
      const item = byName.get(a.tool.toLowerCase());
      if (!item) return err(`Unknown tool "${a.tool}". Run security_tools to see the catalog (only catalog tools can be launched).`);
      if (!(await installed(item.bin))) {
        return err(`"${item.name}" (${item.bin}) is not installed on this machine. Install it (Kali: sudo apt install ${item.bin}) or pick another. security_tools shows what is available.`);
      }
      const timeout = (a.timeoutSec ?? 300) * 1000;
      try {
        const sub = execa(item.bin, a.args, {
          cwd: ctx.cwd,
          timeout,
          reject: false,
          all: true,
          input: a.input,
          killSignal: 'SIGKILL',
        });
        ctx.signal?.addEventListener('abort', () => sub.kill('SIGKILL'), { once: true });
        const r = await sub;
        const out = (r.all ?? `${r.stdout ?? ''}\n${r.stderr ?? ''}`).trim();
        const header = `$ ${item.bin} ${a.args.join(' ')}\n[exit ${r.exitCode ?? 'signal ' + r.signal}${r.timedOut ? ', TIMED OUT' : ''}]\n`;
        return ok(header + '\n' + truncateMiddle(out || '(no output)', { maxChars: MAX_OUTPUT }).text, { kind: 'bash', title: item.name, detail: a.args.join(' ') });
      } catch (e) {
        return err(`Failed to run ${item.bin}: ${(e as Error).message}`);
      }
    },
  };

  // ---- real Burp Suite via REST API ----
  const burpBase = () => process.env.BURP_API_URL || '';
  const burpKey = () => process.env.BURP_API_KEY || '';
  function burpUrl(path: string): string {
    const base = burpBase().replace(/\/+$/, '');
    const key = burpKey();
    // Burp Pro REST puts the API key in the path: <base>/<key>/v0.1/...
    return key ? `${base}/${key}${path}` : `${base}${path}`;
  }

  const burpScanSchema = z.object({
    url: z.string().min(1).describe('Target URL to scan.'),
    scope: z.array(z.string()).optional().describe('Optional in-scope URL prefixes.'),
  });
  const burpScan: ToolDefinition<z.infer<typeof burpScanSchema>> = {
    name: 'burp_scan',
    category: 'pentest',
    description: '[BURP] Start a scan on a real Burp Suite Professional/Enterprise instance via its REST API (needs BURP_API_URL, and BURP_API_KEY for Pro). Returns the scan task id. Pentest mode must be ON.',
    parameters: { type: 'object', properties: { url: { type: 'string' }, scope: { type: 'array', items: { type: 'string' } } }, required: ['url'] },
    schema: burpScanSchema,
    kind: 'execute',
    mutating: true,
    summarize: (a) => `burp scan ${a.url.slice(0, 60)}`,
    async execute(a) {
      const g = gate(config); if (g) return g;
      if (!burpBase()) return err('Burp REST API not configured. Start Burp with the REST API enabled (Suite → REST API), then set BURP_API_URL (e.g. http://127.0.0.1:1337) and BURP_API_KEY.');
      try {
        const body = JSON.stringify({ urls: [a.url], ...(a.scope ? { scope: { include: a.scope.map((p) => ({ rule: p })) } } : {}) });
        const r = await rawHttp('POST', burpUrl('/v0.1/scan'), { headers: { 'Content-Type': 'application/json' }, body, timeout: 20_000 });
        const loc = r.headers['location'];
        const id = loc ? loc.split('/').pop() : undefined;
        if (r.status >= 200 && r.status < 300) return ok(`Burp scan started (HTTP ${r.status}). Task id: ${id ?? '(see Location header: ' + (loc ?? 'none') + ')'}\nPoll it with burp_scan_status.`, { kind: 'info', title: 'Burp' });
        return err(`Burp REST returned ${r.status}: ${truncateMiddle(r.body, { maxChars: 800 }).text}`);
      } catch (e) { return err(`Burp scan failed: ${(e as Error).message}`); }
    },
  };

  const burpStatusSchema = z.object({ id: z.string().min(1).describe('Scan task id from burp_scan.') });
  const burpStatus: ToolDefinition<z.infer<typeof burpStatusSchema>> = {
    name: 'burp_scan_status',
    category: 'pentest',
    description: '[BURP] Read the status and issues of a running Burp REST scan by task id. Pentest mode must be ON.',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    schema: burpStatusSchema,
    kind: 'execute',
    mutating: false,
    summarize: (a) => `burp status ${a.id}`,
    async execute(a) {
      const g = gate(config); if (g) return g;
      if (!burpBase()) return err('Burp REST API not configured (set BURP_API_URL / BURP_API_KEY).');
      try {
        const r = await rawHttp('GET', burpUrl(`/v0.1/scan/${encodeURIComponent(a.id)}`), { timeout: 20_000 });
        if (r.status !== 200) return err(`Burp REST returned ${r.status}: ${truncateMiddle(r.body, { maxChars: 600 }).text}`);
        try {
          const data = JSON.parse(r.body) as { scan_status?: string; scan_metrics?: Record<string, unknown>; issue_events?: Array<{ issue?: { name?: string; severity?: string; path?: string } }> };
          const issues = (data.issue_events ?? []).map((e) => `  [${e.issue?.severity}] ${e.issue?.name} — ${e.issue?.path}`);
          return ok(`Scan ${a.id}: ${data.scan_status ?? '?'}\nMetrics: ${JSON.stringify(data.scan_metrics ?? {})}\nIssues (${issues.length}):\n${issues.slice(0, 60).join('\n') || '  none yet'}`.slice(0, MAX_OUTPUT), { kind: 'info', title: 'Burp' });
        } catch { return ok(truncateMiddle(r.body, { maxChars: MAX_OUTPUT }).text, { kind: 'info', title: 'Burp' }); }
      } catch (e) { return err(`Burp status failed: ${(e as Error).message}`); }
    },
  };

  return [list, run, burpScan, burpStatus];
}

export const _toolrunnerInternal = { CATALOG, installed };
