import fs from 'node:fs';
import { execa, execaSync, ExecaError } from 'execa';
import { z } from 'zod';
import { redactSecrets } from '../utils/redact.js';
import { truncateMiddle } from '../utils/truncate.js';
import { err, ok, type ToolDefinition } from './types.js';

const MAX_OUTPUT_CHARS = 30_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;

interface Shell {
  file: string;
  buildArgs: (cmd: string) => string[];
  label: string;
}
let cachedShell: Shell | undefined;

/**
 * Pick the shell. On Windows, prefer Git Bash (so the model's unix-style
 * commands — ls, grep, cat, &&, pipes — actually work instead of failing on
 * cmd.exe); fall back to cmd.exe. Override with OX_SHELL. Detected once.
 */
function resolveShell(): Shell {
  if (cachedShell) return cachedShell;
  if (process.platform !== 'win32') {
    cachedShell = { file: '/bin/sh', buildArgs: (c) => ['-c', c], label: '/bin/sh' };
    return cachedShell;
  }
  const bashArgs = (c: string) => ['-lc', c];
  const candidates = [
    process.env.OX_SHELL,
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ].filter((x): x is string => !!x);
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        cachedShell = { file: c, buildArgs: bashArgs, label: c.toLowerCase().endsWith('bash.exe') ? 'Git Bash' : c };
        return cachedShell;
      }
    } catch { /* keep looking */ }
  }
  // bash.exe on PATH?
  try {
    const r = execaSync('where', ['bash'], { reject: false });
    const p = (r.stdout ?? '').split(/\r?\n/).map((s) => s.trim()).find((s) => /bash\.exe$/i.test(s) && fs.existsSync(s));
    if (p) {
      cachedShell = { file: p, buildArgs: bashArgs, label: 'Git Bash' };
      return cachedShell;
    }
  } catch { /* no bash on PATH */ }
  cachedShell = { file: 'cmd.exe', buildArgs: (c) => ['/d', '/s', '/c', c], label: 'cmd.exe' };
  return cachedShell;
}

/** Human label of the active shell, for the system prompt. */
export function shellLabel(): string {
  return resolveShell().label;
}

const schema = z.object({
  command: z.string().min(1).describe('Shell command to execute in the project root.'),
  timeout: z.number().int().min(1000).max(MAX_TIMEOUT_MS).optional().describe('Timeout in ms.'),
});
type Args = z.infer<typeof schema>;

/**
 * Cross-platform shell execution. On Windows it prefers Git Bash when
 * present (so unix-style commands work), else cmd.exe; elsewhere /bin/sh.
 * Captures stdout, stderr, exit code and duration, with truncation.
 */
export const bashTool: ToolDefinition<Args> = {
  name: 'bash',
  description:
    `Run a shell command in the project root. Shell: ${shellLabel()}. ` +
    'Returns stdout, stderr and exit code. Long output is truncated keeping head and tail. ' +
    'A non-zero exit code is a normal result, not a tool error — read stderr and adapt.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The command to run.' },
      timeout: { type: 'number', description: `Timeout ms (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}).` },
    },
    required: ['command'],
  },
  schema,
  kind: 'execute',
  mutating: false, // risk is assessed per-command by the permission layer
  summarize: (a) => a.command,
  async execute(args, ctx) {
    const timeout = args.timeout ?? DEFAULT_TIMEOUT_MS;
    const start = Date.now();
    const sh = resolveShell();
    try {
      const result = await execa(sh.file, sh.buildArgs(args.command), {
        cwd: ctx.cwd,
        timeout,
        maxBuffer: 16 * 1024 * 1024,
        cancelSignal: ctx.signal,
        env: { ...process.env, NO_COLOR: '1', CI: process.env.CI ?? '' },
        stripFinalNewline: false,
      });
      const duration = Date.now() - start;
      const stdout = truncateMiddle(redactSecrets(result.stdout ?? ''), { maxChars: MAX_OUTPUT_CHARS });
      const stderr = truncateMiddle(redactSecrets(result.stderr ?? ''), { maxChars: MAX_OUTPUT_CHARS });
      const parts = [`exit code: 0`, `duration: ${(duration / 1000).toFixed(1)}s`];
      if (stdout.text) parts.push(`--- stdout ---\n${stdout.text}`);
      if (stderr.text.trim()) parts.push(`--- stderr ---\n${stderr.text}`);
      if (!stdout.text && !stderr.text.trim()) parts.push('(no output)');
      return ok(parts.join('\n'), {
        kind: 'bash',
        title: 'Bash',
        detail: args.command,
      });
    } catch (e) {
      const duration = Date.now() - start;
      if (e instanceof ExecaError) {
        if (e.timedOut) {
          return err(`Command timed out after ${(timeout / 1000).toFixed(0)}s: ${args.command}\n${redactSecrets(String(e.shortMessage ?? ''))}`);
        }
        if (e.isCanceled || e.signal === 'SIGTERM') {
          return err(`Command was cancelled: ${args.command}`);
        }
        const stdout = truncateMiddle(redactSecrets(e.stdout ?? ''), { maxChars: MAX_OUTPUT_CHARS });
        const stderr = truncateMiddle(redactSecrets(e.stderr ?? ''), { maxChars: MAX_OUTPUT_CHARS });
        const parts = [
          `exit code: ${e.exitCode ?? 'unknown'}`,
          `duration: ${(duration / 1000).toFixed(1)}s`,
        ];
        if (stdout.text) parts.push(`--- stdout ---\n${stdout.text}`);
        if (stderr.text.trim()) parts.push(`--- stderr ---\n${stderr.text}`);
        if (!stdout.text && !stderr.text.trim()) parts.push(redactSecrets(e.shortMessage ?? '(no output)'));
        const res = err(parts.join('\n'));
        res.ui = { kind: 'bash', title: 'Bash', detail: args.command };
        return res;
      }
      return err(`Failed to execute command: ${(e as Error).message}`);
    }
  },
};
