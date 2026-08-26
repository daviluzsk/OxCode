import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { displayPath, isInsideRoot, resolveInCwd } from '../utils/paths.js';
import { err, ok, type ToolDefinition } from './types.js';

const deleteSchema = z.object({
  path: z.string().min(1).describe('File or empty directory to delete.'),
  recursive: z.boolean().optional().describe('Delete a directory and its contents. Default false.'),
});
type DeleteArgs = z.infer<typeof deleteSchema>;

export const deletePathTool: ToolDefinition<DeleteArgs> = {
  name: 'delete_path',
  description: 'Delete a file, or a directory when recursive=true. Destructive — requires approval in default mode.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path relative to the project root.' },
      recursive: { type: 'boolean', description: 'Delete directories recursively. Default false.' },
    },
    required: ['path'],
  },
  schema: deleteSchema,
  kind: 'write',
  mutating: true,
  summarize: (a) => a.path,
  async execute(args, ctx) {
    const absolute = resolveInCwd(ctx.cwd, args.path);
    if (!isInsideRoot(ctx.cwd, absolute) || path.resolve(absolute) === path.resolve(ctx.cwd)) {
      return err(`Refusing to delete outside the workspace or the workspace root: ${args.path}`);
    }
    try {
      const stat = await fs.stat(absolute);
      if (stat.isDirectory()) {
        if (!args.recursive) return err(`"${args.path}" is a directory. Pass recursive=true to delete it.`);
        await fs.rm(absolute, { recursive: true, force: false });
      } else {
        await fs.unlink(absolute);
      }
    } catch (e) {
      return err(`Delete failed: ${(e as Error).message}`);
    }
    return ok(`Deleted ${displayPath(ctx.cwd, absolute)}.`, {
      kind: 'delete',
      title: 'Delete',
      detail: displayPath(ctx.cwd, absolute),
    });
  },
};

const moveSchema = z.object({
  source: z.string().min(1),
  destination: z.string().min(1),
});
type MoveArgs = z.infer<typeof moveSchema>;

export const movePathTool: ToolDefinition<MoveArgs> = {
  name: 'move_path',
  description: 'Move or rename a file or directory within the workspace.',
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', description: 'Current path relative to the project root.' },
      destination: { type: 'string', description: 'New path relative to the project root.' },
    },
    required: ['source', 'destination'],
  },
  schema: moveSchema,
  kind: 'write',
  mutating: true,
  summarize: (a) => `${a.source} → ${a.destination}`,
  async execute(args, ctx) {
    const src = resolveInCwd(ctx.cwd, args.source);
    const dst = resolveInCwd(ctx.cwd, args.destination);
    if (!isInsideRoot(ctx.cwd, src) || !isInsideRoot(ctx.cwd, dst)) {
      return err('Refusing to move paths outside the workspace.');
    }
    try {
      await fs.stat(dst);
      return err(`Destination already exists: ${args.destination}`);
    } catch {
      /* destination free — good */
    }
    try {
      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.rename(src, dst);
    } catch (e) {
      return err(`Move failed: ${(e as Error).message}`);
    }
    return ok(`Moved ${displayPath(ctx.cwd, src)} → ${displayPath(ctx.cwd, dst)}.`, {
      kind: 'move',
      title: 'Move',
      detail: `${displayPath(ctx.cwd, src)} → ${displayPath(ctx.cwd, dst)}`,
    });
  },
};
