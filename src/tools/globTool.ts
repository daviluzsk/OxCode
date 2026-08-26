import path from 'node:path';
import { glob } from 'tinyglobby';
import { z } from 'zod';
import { buildIgnoreList, toGlobIgnores } from '../context/ignore.js';
import { isInsideRoot, resolveInCwd } from '../utils/paths.js';
import { err, ok, type ToolDefinition } from './types.js';

const MAX_RESULTS = 300;

const schema = z.object({
  pattern: z.string().min(1).describe('Glob pattern, e.g. "**/*.ts" or "src/**/*.tsx".'),
  path: z.string().optional().describe('Base directory. Defaults to the project root.'),
});
type Args = z.infer<typeof schema>;

export const globTool: ToolDefinition<Args> = {
  name: 'glob',
  description: 'Find files by glob pattern (e.g. "**/*.ts"). Respects .gitignore and default ignores.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern such as "**/*.ts".' },
      path: { type: 'string', description: 'Base directory (default: project root).' },
    },
    required: ['pattern'],
  },
  schema,
  kind: 'read',
  mutating: false,
  summarize: (a) => a.pattern,
  async execute(args, ctx) {
    const base = resolveInCwd(ctx.cwd, args.path ?? '.');
    if (!isInsideRoot(ctx.cwd, base)) {
      return err(`Refusing to glob outside the workspace: ${args.path}`);
    }
    try {
      const matches = await glob(args.pattern, {
        cwd: base,
        ignore: toGlobIgnores(buildIgnoreList(ctx.cwd)),
        dot: false,
        onlyFiles: true,
        absolute: false,
      });
      matches.sort();
      const shown = matches.slice(0, MAX_RESULTS);
      const suffix =
        matches.length > MAX_RESULTS
          ? `\n[${matches.length - MAX_RESULTS} more matches not shown — narrow the pattern.]`
          : '';
      const body = shown.length === 0 ? 'No files matched.' : shown.join('\n');
      return ok(body + suffix, {
        kind: 'search',
        title: 'Glob',
        detail: `${args.pattern}${args.path ? ` in ${args.path}` : ''}`,
      });
    } catch (e) {
      return err(`Glob failed: ${(e as Error).message}`);
    }
  },
};

/** Shared helper so other modules can enumerate repository files. */
export async function listRepoFiles(cwd: string, extraIgnore: string[] = []): Promise<string[]> {
  const matches = await glob('**/*', {
    cwd,
    ignore: toGlobIgnores(buildIgnoreList(cwd, extraIgnore)),
    dot: false,
    onlyFiles: true,
    absolute: false,
  });
  return matches.sort().map((m) => m.split(path.sep).join('/'));
}
