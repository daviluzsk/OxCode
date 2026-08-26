import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { computeDiff } from '../utils/diffView.js';
import { displayPath, isInsideRoot, resolveInCwd } from '../utils/paths.js';
import { estimateTokens } from '../utils/truncate.js';
import { err, ok, type ToolDefinition } from './types.js';

const MAX_CONTENT_CHARS = 400_000;

const schema = z.object({
  path: z.string().min(1).describe('Target file path relative to the project root.'),
  content: z.string().describe('Complete file content. Parent directories are created as needed.'),
  overwrite: z.boolean().optional().describe('Allow replacing an existing file. Default false.'),
});
type Args = z.infer<typeof schema>;

export const writeFileTool: ToolDefinition<Args> = {
  name: 'write_file',
  description:
    'Create a new file with the given content (parent directories are created). ' +
    'Refuses to overwrite an existing file unless overwrite=true. ' +
    'For changes to existing files prefer apply_patch.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the project root.' },
      content: { type: 'string', description: 'Full file content.' },
      overwrite: { type: 'boolean', description: 'Replace existing file. Default false.' },
    },
    required: ['path', 'content'],
  },
  schema,
  kind: 'write',
  mutating: true,
  summarize: (a) => a.path,
  async execute(args, ctx) {
    const absolute = resolveInCwd(ctx.cwd, args.path);
    if (!isInsideRoot(ctx.cwd, absolute)) {
      return err(`Refusing to write outside the workspace: ${args.path}`);
    }
    if (args.content.length > MAX_CONTENT_CHARS) {
      return err(`Content too large (~${estimateTokens(args.content)} tokens). Write the file in smaller pieces with apply_patch.`);
    }
    let existed = false;
    let oldText = '';
    try {
      oldText = await fs.readFile(absolute, 'utf8');
      existed = true;
    } catch {
      /* new file */
    }
    if (existed && !args.overwrite) {
      return err(`File already exists: ${args.path}. Use apply_patch for edits, or pass overwrite=true to replace it entirely.`);
    }
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, args.content, 'utf8');
    const lines = args.content.split('\n').length;
    const diff = computeDiff(args.path, oldText, args.content);
    return ok(
      `${existed ? 'Overwrote' : 'Created'} ${displayPath(ctx.cwd, absolute)} (${lines} lines).`,
      { kind: 'write', title: 'Write', detail: displayPath(ctx.cwd, absolute), diff, diffPath: args.path },
    );
  },
};
