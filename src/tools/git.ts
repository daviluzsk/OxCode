import { execa, ExecaError } from 'execa';
import { z } from 'zod';
import { truncateLines } from '../utils/truncate.js';
import { err, ok, type ToolDefinition, type ToolResult } from './types.js';

async function runGit(cwd: string, args: string[]): Promise<ToolResult> {
  try {
    const { stdout } = await execa('git', args, { cwd, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    return { content: stdout };
  } catch (e) {
    if (e instanceof ExecaError) {
      if ((e.stderr ?? '').includes('not a git repository')) {
        return err('This directory is not a Git repository.');
      }
      return err(`git ${args[0]} failed: ${(e.stderr || e.shortMessage || e.message).trim()}`);
    }
    return err(`git ${args[0]} failed: ${(e as Error).message}`);
  }
}

export async function gitBranch(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 5000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await execa('git', ['rev-parse', '--is-inside-work-tree'], { cwd, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

const statusSchema = z.object({});
export const gitStatusTool: ToolDefinition<Record<string, never>> = {
  name: 'git_status',
  description: 'Show structured Git status: current branch, staged/unstaged/untracked files.',
  parameters: { type: 'object', properties: {} },
  schema: statusSchema,
  kind: 'read',
  mutating: false,
  summarize: () => 'status',
  async execute(_args, ctx) {
    const branch = await gitBranch(ctx.cwd);
    const res = await runGit(ctx.cwd, ['status', '--porcelain=v1', '--branch']);
    if (res.isError) return res;
    const lines = res.content.split('\n').filter(Boolean);
    const counts = { staged: 0, modified: 0, untracked: 0, other: 0 };
    for (const line of lines) {
      if (line.startsWith('##')) continue;
      const x = line[0];
      const y = line[1];
      if (x === '?' || y === '?') counts.untracked++;
      else if (x !== ' ' && x !== undefined) counts.staged++;
      else if (y === 'M' || y === 'D') counts.modified++;
      else counts.other++;
    }
    const summary = `branch: ${branch ?? '(unknown)'}\nstaged: ${counts.staged}, modified: ${counts.modified}, untracked: ${counts.untracked}`;
    return ok(`${summary}\n\n${res.content || '(clean)'}`, {
      kind: 'git',
      title: 'Git',
      detail: 'status',
    });
  },
};

const diffSchema = z.object({
  staged: z.boolean().optional().describe('Show staged changes instead of working-tree changes.'),
  path: z.string().optional().describe('Restrict diff to a path.'),
});
type DiffArgs = z.infer<typeof diffSchema>;

export const gitDiffTool: ToolDefinition<DiffArgs> = {
  name: 'git_diff',
  description: 'Show the current Git diff (working tree by default, staged with staged=true). Large diffs are truncated.',
  parameters: {
    type: 'object',
    properties: {
      staged: { type: 'boolean', description: 'Diff the index instead of the working tree.' },
      path: { type: 'string', description: 'Limit to a specific path.' },
    },
  },
  schema: diffSchema,
  kind: 'read',
  mutating: false,
  summarize: (a) => (a.staged ? 'diff --staged' : 'diff') + (a.path ? ` ${a.path}` : ''),
  async execute(args, ctx) {
    const gitArgs = ['diff'];
    if (args.staged) gitArgs.push('--staged');
    if (args.path) gitArgs.push('--', args.path);
    const res = await runGit(ctx.cwd, gitArgs);
    if (res.isError) return res;
    if (!res.content.trim()) return ok('No changes.', { kind: 'git', title: 'Git', detail: 'diff' });
    const t = truncateLines(res.content, 600);
    return ok(t.text, { kind: 'git', title: 'Git', detail: 'diff' });
  },
};

const logSchema = z.object({
  count: z.number().int().min(1).max(50).optional().describe('Number of commits. Default 10.'),
});
type LogArgs = z.infer<typeof logSchema>;

export const gitLogTool: ToolDefinition<LogArgs> = {
  name: 'git_log',
  description: 'Show recent commits (one line each: hash, date, author, subject).',
  parameters: {
    type: 'object',
    properties: { count: { type: 'number', description: 'Number of commits (default 10).' } },
  },
  schema: logSchema,
  kind: 'read',
  mutating: false,
  summarize: (a) => `log -${a.count ?? 10}`,
  async execute(args, ctx) {
    const res = await runGit(ctx.cwd, [
      'log',
      `--max-count=${args.count ?? 10}`,
      '--pretty=format:%h %ad %an: %s',
      '--date=short',
    ]);
    if (res.isError) return res;
    return ok(res.content || '(no commits yet)', { kind: 'git', title: 'Git', detail: 'log' });
  },
};
