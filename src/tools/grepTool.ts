import fs from 'node:fs/promises';
import path from 'node:path';
import { execa, ExecaError } from 'execa';
import { z } from 'zod';
import { buildIgnoreList } from '../context/ignore.js';
import { isBlockedFromModel } from '../security/sensitive.js';
import { isInsideRoot, resolveInCwd, toPosix } from '../utils/paths.js';
import { err, ok, type ToolDefinition } from './types.js';
import { listRepoFiles } from './globTool.js';

const MAX_RESULTS_DEFAULT = 100;
const MAX_LINE = 300;

const schema = z.object({
  query: z.string().min(1).describe('Search text or regular expression.'),
  path: z.string().optional().describe('Directory or file to search. Default: project root.'),
  glob: z.string().optional().describe('File filter, e.g. "*.ts".'),
  caseSensitive: z.boolean().optional().describe('Default false.'),
  maxResults: z.number().int().min(1).max(500).optional(),
  regex: z.boolean().optional().describe('Treat query as a regex. Default true; set false for literal search.'),
});
type Args = z.infer<typeof schema>;

async function hasRipgrep(): Promise<boolean> {
  try {
    await execa('rg', ['--version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function clip(line: string): string {
  return line.length > MAX_LINE ? line.slice(0, MAX_LINE) + '…' : line;
}

async function grepWithRipgrep(base: string, args: Args, max: number): Promise<string[] | null> {
  const rgArgs = ['--line-number', '--no-heading', '--color=never', '--with-filename'];
  if (!args.caseSensitive) rgArgs.push('--ignore-case');
  if (!args.regex && args.regex !== undefined) rgArgs.push('--fixed-strings');
  if (args.glob) rgArgs.push('--glob', args.glob);
  rgArgs.push('--max-count', String(max));
  rgArgs.push('--', args.query, base);
  try {
    const { stdout } = await execa('rg', rgArgs, { timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    return stdout.split(/\r?\n/).filter(Boolean);
  } catch (e) {
    if (e instanceof ExecaError && e.exitCode === 1) return []; // no matches
    return null; // fall back
  }
}

async function grepWithNode(base: string, args: Args, max: number): Promise<string[]> {
  const stat = await fs.stat(base).catch(() => null);
  const files = stat?.isFile() ? [base] : (await listRepoFiles(stat ? path.dirname(base) : base)).map((f) => path.join(stat ? path.dirname(base) : base, f));
  let re: RegExp;
  try {
    const source = args.regex === false ? args.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : args.query;
    re = new RegExp(source, args.caseSensitive ? '' : 'i');
  } catch {
    return [`Invalid regular expression: ${args.query}`];
  }
  const results: string[] = [];
  for (const file of files) {
    if (results.length >= max) break;
    if (isBlockedFromModel(file)) continue;
    if (args.glob) {
      // simple *.ext filter support in fallback mode
      const ext = args.glob.replace(/^\*\./, '.');
      if (args.glob.startsWith('*.') && !file.endsWith(ext)) continue;
    }
    let text: string;
    try {
      const buf = await fs.readFile(file);
      if (buf.includes(0)) continue; // binary
      if (buf.length > 512 * 1024) continue;
      text = buf.toString('utf8');
    } catch {
      continue;
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (re.test(line)) {
        results.push(`${toPosix(file)}:${i + 1}:${clip(line)}`);
        if (results.length >= max) break;
      }
    }
  }
  return results;
}

export const grepTool: ToolDefinition<Args> = {
  name: 'grep',
  description:
    'Search file contents across the repository (uses ripgrep when available). ' +
    'Returns matching lines as path:line:text. Skips heavy directories and sensitive files.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Text or regex to search for.' },
      path: { type: 'string', description: 'Directory or file to search (default: project root).' },
      glob: { type: 'string', description: 'File filter such as "*.ts".' },
      caseSensitive: { type: 'boolean', description: 'Default false.' },
      maxResults: { type: 'number', description: `Default ${MAX_RESULTS_DEFAULT}.` },
      regex: { type: 'boolean', description: 'Set false for a literal string search.' },
    },
    required: ['query'],
  },
  schema,
  kind: 'read',
  mutating: false,
  summarize: (a) => `"${a.query}"${a.path ? ` in ${a.path}` : ''}`,
  async execute(args, ctx) {
    const base = resolveInCwd(ctx.cwd, args.path ?? '.');
    if (!isInsideRoot(ctx.cwd, base)) {
      return err(`Refusing to search outside the workspace: ${args.path}`);
    }
    const max = args.maxResults ?? MAX_RESULTS_DEFAULT;
    // validate regex early for clear errors
    if (args.regex !== false) {
      try {
        new RegExp(args.query);
      } catch {
        return err(`Invalid regular expression: ${args.query}`);
      }
    }
    let results: string[] | null = null;
    if (await hasRipgrep()) {
      results = await grepWithRipgrep(base, args, max);
    }
    if (results === null) {
      try {
        results = await grepWithNode(base, args, max);
      } catch (e) {
        return err(`Search failed: ${(e as Error).message}`);
      }
    }
    const shown = results.slice(0, max);
    const body = shown.length === 0 ? 'No matches found.' : shown.join('\n');
    const suffix = results.length > shown.length ? `\n[more results — narrow the query]` : '';
    return ok(body + suffix, {
      kind: 'search',
      title: 'Search',
      detail: `"${args.query}"${args.path ? ` in ${args.path}` : ''}`,
    });
  },
};
