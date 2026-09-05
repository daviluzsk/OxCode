import { z } from 'zod';
import type { ResolvedConfig } from '../config/types.js';
import { truncateMiddle } from '../utils/truncate.js';
import { err, ok, type ToolDefinition, type ToolResult } from './types.js';
import { rawHttp } from './offsec.js';

/**
 * OSINT toolkit — open-source intelligence from PUBLIC sources only: DNS/mail
 * posture, public account presence across sites, and public code footprint.
 * No authentication bypass, no scraping behind logins, no private data. Same
 * gate as the rest of the toolkit (pentest mode ON) and HTTP tunnels through
 * an intercepting proxy when configured.
 */

const GATE =
  'Pentest mode is OFF. OSINT tools only run in authorized security-testing mode — ' +
  'enable it with /pentest (or ox --pentest).';
function gate(config: ResolvedConfig): ToolResult | null {
  return config.pentest ? null : err(GATE);
}
const MAX_OUTPUT = 20_000;
const UA = 'Mozilla/5.0 (compatible; OxCode-OSINT/1.0)';

/** DNS-over-HTTPS lookup (works through proxies and where raw DNS/UDP is blocked). */
async function doh(name: string, type: string): Promise<string[]> {
  try {
    const res = await rawHttp('GET', `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, {
      headers: { Accept: 'application/dns-json', 'User-Agent': UA },
      timeout: 12_000,
    });
    if (res.status !== 200) return [];
    const j = JSON.parse(res.body) as { Answer?: Array<{ data?: string; type?: number }> };
    return (j.Answer ?? []).map((a) => (a.data ?? '').replace(/^"|"$/g, '')).filter(Boolean);
  } catch {
    return [];
  }
}

async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
  return out;
}

// Public sites checked for account presence. {url template, notFound marker(s)}.
const SITES: Array<{ name: string; url: (u: string) => string; soft404?: RegExp }> = [
  { name: 'GitHub', url: (u) => `https://github.com/${u}` },
  { name: 'GitLab', url: (u) => `https://gitlab.com/${u}` },
  { name: 'X/Twitter', url: (u) => `https://twitter.com/${u}` },
  { name: 'Instagram', url: (u) => `https://www.instagram.com/${u}/` },
  { name: 'Reddit', url: (u) => `https://www.reddit.com/user/${u}` },
  { name: 'TikTok', url: (u) => `https://www.tiktok.com/@${u}` },
  { name: 'YouTube', url: (u) => `https://www.youtube.com/@${u}` },
  { name: 'Twitch', url: (u) => `https://www.twitch.tv/${u}` },
  { name: 'Steam', url: (u) => `https://steamcommunity.com/id/${u}` },
  { name: 'Telegram', url: (u) => `https://t.me/${u}` },
  { name: 'Medium', url: (u) => `https://medium.com/@${u}` },
  { name: 'Dev.to', url: (u) => `https://dev.to/${u}` },
  { name: 'Keybase', url: (u) => `https://keybase.io/${u}` },
  { name: 'Pinterest', url: (u) => `https://www.pinterest.com/${u}/` },
  { name: 'SoundCloud', url: (u) => `https://soundcloud.com/${u}` },
  { name: 'Spotify', url: (u) => `https://open.spotify.com/user/${u}` },
  { name: 'Replit', url: (u) => `https://replit.com/@${u}` },
  { name: 'HackerNews', url: (u) => `https://news.ycombinator.com/user?id=${u}` },
  { name: 'Patreon', url: (u) => `https://www.patreon.com/${u}` },
  { name: 'Roblox', url: (u) => `https://www.roblox.com/user.aspx?username=${u}` },
  { name: 'PyPI', url: (u) => `https://pypi.org/user/${u}/` },
  { name: 'npm', url: (u) => `https://www.npmjs.com/~${u}` },
  { name: 'Docker Hub', url: (u) => `https://hub.docker.com/u/${u}` },
  { name: 'Gravatar', url: (u) => `https://gravatar.com/${u}` },
];

export function createOsintTools(config: ResolvedConfig): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  // ---- dns_osint ----
  const dnsSchema = z.object({ domain: z.string().min(1).describe('Domain, e.g. example.com') });
  tools.push({
    name: 'dns_osint',
    description:
      '[OSINT] Full public DNS + mail posture for a domain: A/AAAA, MX (mail provider), NS, TXT, SOA, ' +
      'CAA, plus SPF, DMARC (_dmarc) and common DKIM selectors — useful for mapping infrastructure and ' +
      'spotting missing email-auth controls. Public data only. Pentest mode ON.',
    parameters: { type: 'object', properties: { domain: { type: 'string' } }, required: ['domain'] },
    schema: dnsSchema,
    category: 'pentest',
    kind: 'execute',
    mutating: false,
    summarize: (a: z.infer<typeof dnsSchema>) => `dns_osint ${a.domain}`,
    async execute(a: z.infer<typeof dnsSchema>) {
      const g = gate(config);
      if (g) return g;
      const d = a.domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
      const out: string[] = [`DNS OSINT for ${d}  (via DNS-over-HTTPS)\n`];
      const grab = async (label: string, name: string, type: string) => {
        const recs = await doh(name, type);
        out.push(`${label}: ${recs.length ? recs.join(', ') : '(none)'}`);
        return recs;
      };
      await grab('A', d, 'A');
      await grab('AAAA', d, 'AAAA');
      const mx = await grab('MX', d, 'MX');
      await grab('NS', d, 'NS');
      const txt = await grab('TXT', d, 'TXT');
      await grab('SOA', d, 'SOA');
      await grab('CAA', d, 'CAA');
      const dmarc = await grab('DMARC (_dmarc)', `_dmarc.${d}`, 'TXT');
      // DKIM common selectors
      for (const sel of ['default', 'google', 'selector1', 'selector2', 'k1', 'dkim', 'mail']) {
        const r = await doh(`${sel}._domainkey.${d}`, 'TXT');
        if (r.some((x) => /v=dkim1|p=/i.test(x))) out.push(`DKIM (${sel}): present`);
      }
      // quick posture notes
      const notes: string[] = [];
      if (!txt.some((t) => /v=spf1/i.test(t))) notes.push('⚠ No SPF record — domain can be more easily spoofed in email.');
      if (!dmarc.some((t) => /v=DMARC1/i.test(t))) notes.push('⚠ No DMARC record — no policy against spoofed mail.');
      if (mx.length) notes.push(`Mail handled by: ${mx.map((m) => m.replace(/^\d+\s*/, '')).join(', ')}`);
      if (notes.length) out.push(`\n--- notes ---\n${notes.join('\n')}`);
      return ok(truncateMiddle(out.join('\n'), { maxChars: MAX_OUTPUT }).text, { kind: 'info', title: 'dns_osint' });
    },
  } as ToolDefinition);

  // ---- username_lookup ----
  const userSchema = z.object({
    username: z.string().min(1).max(64).describe('The username/handle to search for.'),
  });
  tools.push({
    name: 'username_lookup',
    description:
      '[OSINT] Check whether a username exists across ~25 popular public sites (GitHub, social, dev, ' +
      'gaming, package registries…) by requesting each public profile URL — Sherlock-style presence ' +
      'mapping from public pages only. Pentest mode ON.',
    parameters: { type: 'object', properties: { username: { type: 'string' } }, required: ['username'] },
    schema: userSchema,
    category: 'pentest',
    kind: 'execute',
    mutating: false,
    summarize: (a: z.infer<typeof userSchema>) => `username_lookup ${a.username}`,
    async execute(a: z.infer<typeof userSchema>) {
      const g = gate(config);
      if (g) return g;
      const u = encodeURIComponent(a.username.trim());
      const results = await pool(SITES, 10, async (site) => {
        const url = site.url(u);
        try {
          const res = await rawHttp('GET', url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, timeout: 12_000 });
          let verdict: 'found' | 'not' | 'maybe';
          if (res.status === 200) verdict = site.soft404 && site.soft404.test(res.body) ? 'not' : 'found';
          else if (res.status === 404) verdict = 'not';
          else if (res.status >= 300 && res.status < 400) verdict = 'maybe';
          else verdict = 'maybe';
          return { name: site.name, url, status: res.status, verdict };
        } catch (e) {
          return { name: site.name, url, status: 0, verdict: 'maybe' as const, err: String((e as Error).message) };
        }
      });
      const found = results.filter((r) => r.verdict === 'found');
      const maybe = results.filter((r) => r.verdict === 'maybe');
      const lines = [
        `Username OSINT for "${a.username}" — ${found.length} likely hits, ${maybe.length} inconclusive.\n`,
        '--- FOUND ---',
        ...(found.length ? found.map((r) => `  ✓ ${r.name.padEnd(12)} ${r.url}`) : ['  (none)']),
        '\n--- INCONCLUSIVE (status ≠ 200/404, verify manually) ---',
        ...(maybe.length ? maybe.map((r) => `  ? ${r.name.padEnd(12)} ${r.status || 'ERR'}  ${r.url}`) : ['  (none)']),
      ];
      return ok(truncateMiddle(lines.join('\n'), { maxChars: MAX_OUTPUT }).text, { kind: 'info', title: 'username_lookup' });
    },
  } as ToolDefinition);

  // ---- github_osint ----
  const ghSchema = z.object({
    user: z.string().min(1).describe('GitHub username or organization.'),
  });
  tools.push({
    name: 'github_osint',
    description:
      "[OSINT] Public GitHub footprint for a user/org via the public API: profile, public email if set, " +
      'company/location/bio, and top public repositories (name, language, stars). Unauthenticated (rate-limited). ' +
      'Public data only. Pentest mode ON.',
    parameters: { type: 'object', properties: { user: { type: 'string' } }, required: ['user'] },
    schema: ghSchema,
    category: 'pentest',
    kind: 'execute',
    mutating: false,
    summarize: (a: z.infer<typeof ghSchema>) => `github_osint ${a.user}`,
    async execute(a: z.infer<typeof ghSchema>) {
      const g = gate(config);
      if (g) return g;
      const u = encodeURIComponent(a.user.trim());
      const headers = { 'User-Agent': UA, Accept: 'application/vnd.github+json' };
      try {
        const prof = await rawHttp('GET', `https://api.github.com/users/${u}`, { headers, timeout: 12_000 });
        if (prof.status === 404) return ok(`No public GitHub account "${a.user}".`, { kind: 'info', title: 'github_osint' });
        if (prof.status === 403) return err('GitHub API rate limit hit (unauthenticated 60/hr). Try again later or set a token.');
        if (prof.status !== 200) return err(`GitHub API returned ${prof.status}.`);
        const p = JSON.parse(prof.body) as Record<string, unknown>;
        const out: string[] = [`GitHub OSINT — ${a.user}`];
        const field = (k: string, label: string) => { if (p[k]) out.push(`  ${label}: ${p[k]}`); };
        field('name', 'Name');
        field('email', 'Public email');
        field('company', 'Company');
        field('location', 'Location');
        field('blog', 'Blog');
        field('twitter_username', 'Twitter');
        field('bio', 'Bio');
        out.push(`  Public repos: ${p.public_repos ?? '?'} · Followers: ${p.followers ?? '?'} · Created: ${String(p.created_at ?? '').slice(0, 10)}`);
        // top repos by stars
        const reposRes = await rawHttp('GET', `https://api.github.com/users/${u}/repos?per_page=100&sort=updated`, { headers, timeout: 12_000 });
        if (reposRes.status === 200) {
          const repos = (JSON.parse(reposRes.body) as Array<Record<string, unknown>>) ?? [];
          const top = repos
            .filter((r) => !r.fork)
            .sort((x, y) => Number(y.stargazers_count ?? 0) - Number(x.stargazers_count ?? 0))
            .slice(0, 15);
          if (top.length) {
            out.push(`\n--- top public repos (${repos.length} total) ---`);
            for (const r of top) out.push(`  ${String(r.name).padEnd(28)} ${String(r.language ?? '—').padEnd(12)} ★${r.stargazers_count ?? 0}`);
          }
        }
        return ok(truncateMiddle(out.join('\n'), { maxChars: MAX_OUTPUT }).text, { kind: 'info', title: 'github_osint' });
      } catch (e) {
        return err(`github_osint failed: ${(e as Error).message}`);
      }
    },
  } as ToolDefinition);

  return tools;
}
