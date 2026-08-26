import { execa, ExecaError } from 'execa';
import { z } from 'zod';
import { redactSecrets } from '../utils/redact.js';
import { truncateMiddle } from '../utils/truncate.js';
import { err, ok, type ToolDefinition } from './types.js';

const MAX_OUTPUT_CHARS = 30_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;

const schema = z.object({
  command: z.string().min(1).describe('Shell command to execute in the project root.'),
  timeout: z.number().int().min(1000).max(MAX_TIMEOUT_MS).optional().describe('Timeout in ms.'),
});
type Args = z.infer<typeof schema>;

function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * Cross-platform shell execution. On Windows commands run through
 * cmd.exe; elsewhere through /bin/sh. Captures stdout, stderr, exit
 * code and duration, with intelligent output truncation.
 */
export const bashTool: ToolDefinition<Args> = {
  name: 'bash',
  description:
    'Run a shell command in the project root (cross-platform: cmd.exe on Windows, ' +
    'sh elsewhere). Returns stdout, stderr and exit code. Long output is truncated ' +
    'keeping head and tail.',
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
    const shell = isWindows() ? 'cmd.exe' : '/bin/sh';
    const shellArgs = isWindows() ? ['/d', '/s', '/c', args.command] : ['-c', args.command];
    try {
      const result = await execa(shell, shellArgs, {
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
