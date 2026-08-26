import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { buildIgnoreList } from '../context/ignore.js';
import { displayPath, isInsideRoot, resolveInCwd } from '../utils/paths.js';
import { err, ok, type ToolDefinition } from './types.js';

const MAX_ENTRIES = 400;

const schema = z.object({
  path: z.string().min(1).describe('Directory path relative to the project root.'),
  depth: z.number().int().min(1).max(4).optional().describe('Tree depth. Default 2.'),
});
type Args = z.infer<typeof schema>;

interface TreeOptions {
  root: string;
  maxDepth: number;
  ignore: Set<string>;
}

async function buildTree(dir: string, opts: TreeOptions, prefix: string, depth: number, counter: { n: number }): Promise<string[]> {
  if (depth > opts.maxDepth || counter.n >= MAX_ENTRIES) return [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const lines: string[] = [];
  for (const e of entries) {
    if (counter.n >= MAX_ENTRIES) {
      lines.push(prefix + '… (truncated)');
      return lines;
    }
    if (opts.ignore.has(e.name)) continue;
    counter.n++;
    const isDir = e.isDirectory();
    lines.push(prefix + (isDir ? e.name + '/' : e.name));
    if (isDir) {
      const sub = await buildTree(path.join(dir, e.name), opts, prefix + '  ', depth + 1, counter);
      lines.push(...sub);
    }
  }
  return lines;
}

export const listDirectoryTool: ToolDefinition<Args> = {
  name: 'list_directory',
  description: 'List a directory tree with bounded depth. Ignores heavy/generated directories.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path relative to the project root.' },
      depth: { type: 'number', description: 'Tree depth (1-4). Default 2.' },
    },
    required: ['path'],
  },
  schema,
  kind: 'read',
  mutating: false,
  summarize: (a) => a.path,
  async execute(args, ctx) {
    const absolute = resolveInCwd(ctx.cwd, args.path);
    if (!isInsideRoot(ctx.cwd, absolute)) {
      return err(`Refusing to list outside the workspace: ${args.path}`);
    }
    let stat;
    try {
      stat = await fs.stat(absolute);
    } catch (e) {
      return err(`Directory not found: ${args.path} (${(e as Error).message})`);
    }
    if (!stat.isDirectory()) return err(`Not a directory: ${args.path}`);
    const ignore = new Set(buildIgnoreList(ctx.cwd));
    const counter = { n: 0 };
    const lines = await buildTree(absolute, { root: absolute, maxDepth: args.depth ?? 2, ignore }, '', 1, counter);
    const header = `${displayPath(ctx.cwd, absolute)}/\n`;
    return ok(header + (lines.length ? lines.join('\n') : '(empty)'), {
      kind: 'read',
      title: 'List',
      detail: displayPath(ctx.cwd, absolute),
    });
  },
};
