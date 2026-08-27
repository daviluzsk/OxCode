import { execa } from 'execa';
import { z } from 'zod';
import type { ResolvedConfig } from '../config/types.js';
import { truncateMiddle } from '../utils/truncate.js';
import { err, ok, type ToolDefinition, type ToolResult } from './types.js';

/**
 * Kali Box — give the AI its own disposable Kali Linux machine (a Docker
 * container) to work in, like its own pentesting desktop. It boots
 * kalilinux/kali-rolling, mounts the workspace at /work, installs a top set of
 * tools on first run, and lets the agent run commands inside via `docker exec`.
 *
 * AUTHORIZED ENGAGEMENTS ONLY — pentest-mode gated, approval gated. The box is
 * isolated from the host; only the workspace directory is shared.
 */

const GATE = 'Pentest mode is OFF. The Kali box only runs in authorized security-testing mode — enable it with /pentest.';
function gate(config: ResolvedConfig): ToolResult | null {
  return config.pentest ? null : err(GATE);
}
const MAX_OUTPUT = 24_000;
const NAME = 'oxcode-kali';
const IMAGE = 'kalilinux/kali-rolling';
const READY = '/root/.oxcode_ready';
// Top set installed on first boot; anything else via kali_install on demand.
const TOP_TOOLS = [
  'nmap', 'sqlmap', 'nikto', 'gobuster', 'ffuf', 'whatweb', 'wpscan', 'hydra',
  'dnsrecon', 'dnsutils', 'netcat-traditional', 'curl', 'wget', 'git', 'python3',
  'python3-pip', 'seclists', 'dirb', 'masscan', 'net-tools', 'iputils-ping', 'jq',
];

async function docker(args: string[], opts: { timeout?: number; input?: string } = {}) {
  return execa('docker', args, { reject: false, all: true, timeout: opts.timeout ?? 60_000, input: opts.input });
}
async function dockerReady(): Promise<{ ok: boolean; msg: string }> {
  try {
    const r = await docker(['version', '--format', '{{.Server.Version}}'], { timeout: 15_000 });
    if (r.exitCode === 0 && (r.stdout ?? '').trim()) return { ok: true, msg: (r.stdout ?? '').trim() };
    return { ok: false, msg: 'Docker is installed but the daemon is not reachable — start Docker Desktop / the docker service.' };
  } catch {
    return { ok: false, msg: 'Docker is not installed. Install Docker (Desktop on Windows/macOS, docker.io on Linux) to give the AI a Kali box.' };
  }
}
async function containerState(): Promise<'running' | 'stopped' | 'absent'> {
  const r = await docker(['inspect', '-f', '{{.State.Running}}', NAME], { timeout: 15_000 });
  if (r.exitCode !== 0) return 'absent';
  return (r.stdout ?? '').trim() === 'true' ? 'running' : 'stopped';
}
async function execIn(cmd: string, timeout: number, signal?: AbortSignal) {
  const sub = execa('docker', ['exec', '-w', '/work', NAME, 'bash', '-lc', cmd], { reject: false, all: true, timeout, killSignal: 'SIGKILL' });
  signal?.addEventListener('abort', () => sub.kill('SIGKILL'), { once: true });
  return sub;
}

export function createKaliBoxTools(config: ResolvedConfig): ToolDefinition[] {
  // ---- bring the box up (create + provision) ----
  const upSchema = z.object({ reinstall: z.boolean().optional().describe('Force re-running the tool install.') });
  const up: ToolDefinition<z.infer<typeof upSchema>> = {
    name: 'kali_up',
    category: 'pentest',
    description:
      '[KALI BOX] Boot the AI\'s own Kali Linux machine (a Docker container mounting the workspace at /work) and install the core tools on first run. Idempotent — call it before kali_run. First run downloads the image and can take several minutes. Pentest mode must be ON.',
    parameters: { type: 'object', properties: { reinstall: { type: 'boolean' } }, required: [] },
    schema: upSchema,
    kind: 'execute',
    mutating: true,
    summarize: () => 'boot kali box',
    async execute(a, ctx) {
      const g = gate(config); if (g) return g;
      const dr = await dockerReady();
      if (!dr.ok) return err(dr.msg);
      const log: string[] = [`Docker ${dr.msg}`];
      let state = await containerState();
      if (state === 'absent') {
        log.push('Creating container (pulling kalilinux/kali-rolling if needed)…');
        const run = await docker(['run', '-d', '--name', NAME, '-v', `${config.cwd}:/work`, '-w', '/work', IMAGE, 'sleep', 'infinity'], { timeout: 600_000 });
        if (run.exitCode !== 0) return err(`Failed to create the Kali box:\n${truncateMiddle(run.all ?? '', { maxChars: 2000 }).text}`);
        state = 'running';
      } else if (state === 'stopped') {
        await docker(['start', NAME], { timeout: 30_000 });
        log.push('Started existing container.');
      } else {
        log.push('Container already running.');
      }
      const ready = await execIn(`test -f ${READY} && echo yes || echo no`, 15_000);
      if (a.reinstall || (ready.stdout ?? '').includes('no')) {
        log.push(`Installing core tools (${TOP_TOOLS.length} packages) — this can take a while…`);
        const install = await execIn(`apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ${TOP_TOOLS.join(' ')}; touch ${READY}`, 1_200_000, ctx.signal);
        log.push(`apt exit ${install.exitCode}${install.timedOut ? ' (timed out — rerun kali_up to continue)' : ''}`);
        log.push(truncateMiddle(install.all ?? '', { maxChars: 4000 }).text);
      } else {
        log.push('Core tools already installed.');
      }
      log.push('\nBox is ready. Run commands in it with kali_run (they execute in /work, your shared workspace).');
      return ok(truncateMiddle(log.join('\n'), { maxChars: MAX_OUTPUT }).text, { kind: 'bash', title: 'KaliBox' });
    },
  };

  // ---- run a command inside the box ----
  const runSchema = z.object({
    command: z.string().min(1).describe('Shell command to run inside the Kali box (bash -lc). Runs in /work.'),
    timeoutSec: z.number().int().positive().max(3600).optional().describe('Kill after N seconds (default 600).'),
  });
  const run: ToolDefinition<z.infer<typeof runSchema>> = {
    name: 'kali_run',
    category: 'pentest',
    description:
      '[KALI BOX] Run a command inside the AI\'s Kali machine and capture the output — this is how the agent "works on the desktop": scans, tool runs, scripts, file ops in /work. Call kali_up first. Pentest mode must be ON.',
    parameters: { type: 'object', properties: { command: { type: 'string' }, timeoutSec: { type: 'number' } }, required: ['command'] },
    schema: runSchema,
    kind: 'execute',
    mutating: true,
    summarize: (a) => `kali: ${a.command.slice(0, 70)}`,
    async execute(a, ctx) {
      const g = gate(config); if (g) return g;
      const dr = await dockerReady(); if (!dr.ok) return err(dr.msg);
      if ((await containerState()) !== 'running') return err('The Kali box is not running. Call kali_up first.');
      const r = await execIn(a.command, (a.timeoutSec ?? 600) * 1000, ctx.signal);
      const out = (r.all ?? '').trim();
      const header = `kali$ ${a.command}\n[exit ${r.exitCode ?? 'signal ' + r.signal}${r.timedOut ? ', TIMED OUT' : ''}]\n`;
      return ok(header + '\n' + truncateMiddle(out || '(no output)', { maxChars: MAX_OUTPUT }).text, { kind: 'bash', title: 'KaliBox', detail: a.command.slice(0, 60) });
    },
  };

  // ---- install extra tools on demand ----
  const instSchema = z.object({ packages: z.array(z.string().min(1)).min(1).max(40).describe('apt package names, e.g. ["amass","subfinder","nuclei"].') });
  const install: ToolDefinition<z.infer<typeof instSchema>> = {
    name: 'kali_install',
    category: 'pentest',
    description: '[KALI BOX] Install extra Kali packages into the box on demand (apt). Pentest mode must be ON.',
    parameters: { type: 'object', properties: { packages: { type: 'array', items: { type: 'string' } } }, required: ['packages'] },
    schema: instSchema,
    kind: 'execute',
    mutating: true,
    summarize: (a) => `apt install ${a.packages.join(' ').slice(0, 60)}`,
    async execute(a, ctx) {
      const g = gate(config); if (g) return g;
      const dr = await dockerReady(); if (!dr.ok) return err(dr.msg);
      if ((await containerState()) !== 'running') return err('The Kali box is not running. Call kali_up first.');
      const pkgs = a.packages.map((p) => p.replace(/[^a-z0-9.+-]/gi, '')).filter(Boolean);
      const r = await execIn(`apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y ${pkgs.join(' ')}`, 900_000, ctx.signal);
      return ok(`apt install ${pkgs.join(' ')} → exit ${r.exitCode}\n\n${truncateMiddle(r.all ?? '', { maxChars: MAX_OUTPUT }).text}`, { kind: 'bash', title: 'KaliBox' });
    },
  };

  // ---- status ----
  const status: ToolDefinition<Record<string, never>> = {
    name: 'kali_status',
    category: 'pentest',
    description: '[KALI BOX] Show whether Docker is available, the box state, and which core tools are installed. Pentest mode must be ON.',
    parameters: { type: 'object', properties: {}, required: [] },
    schema: z.object({}),
    kind: 'execute',
    mutating: false,
    summarize: () => 'kali status',
    async execute() {
      const g = gate(config); if (g) return g;
      const dr = await dockerReady();
      if (!dr.ok) return ok(dr.msg, { kind: 'info', title: 'KaliBox' });
      const state = await containerState();
      const lines = [`Docker: ${dr.msg}`, `Box "${NAME}": ${state}`];
      if (state === 'running') {
        const which = await execIn('for t in nmap sqlmap nikto gobuster ffuf wpscan hydra whatweb nuclei amass subfinder; do command -v $t >/dev/null && echo "  ✅ $t" || echo "  ·  $t"; done', 20_000);
        lines.push('Tools:', (which.stdout ?? '').trim());
      } else {
        lines.push('Run kali_up to create/start it.');
      }
      return ok(lines.join('\n'), { kind: 'info', title: 'KaliBox' });
    },
  };

  // ---- tear down ----
  const downSchema = z.object({ remove: z.boolean().optional().describe('Also delete the container (default just stop).') });
  const down: ToolDefinition<z.infer<typeof downSchema>> = {
    name: 'kali_down',
    category: 'pentest',
    description: '[KALI BOX] Stop (or with remove:true, delete) the Kali box. Pentest mode must be ON.',
    parameters: { type: 'object', properties: { remove: { type: 'boolean' } }, required: [] },
    schema: downSchema,
    kind: 'execute',
    mutating: true,
    summarize: (a) => (a.remove ? 'remove kali box' : 'stop kali box'),
    async execute(a) {
      const g = gate(config); if (g) return g;
      const dr = await dockerReady(); if (!dr.ok) return err(dr.msg);
      if (a.remove) { const r = await docker(['rm', '-f', NAME], { timeout: 30_000 }); return ok(r.exitCode === 0 ? 'Kali box removed.' : `Nothing to remove (${(r.all ?? '').trim()}).`, { kind: 'info', title: 'KaliBox' }); }
      const r = await docker(['stop', NAME], { timeout: 30_000 });
      return ok(r.exitCode === 0 ? 'Kali box stopped (state preserved; kali_up restarts it).' : `Nothing to stop (${(r.all ?? '').trim()}).`, { kind: 'info', title: 'KaliBox' });
    },
  };

  return [up, run, install, status, down];
}

export const _kaliboxInternal = { dockerReady, NAME, TOP_TOOLS };
