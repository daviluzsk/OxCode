import fs from 'node:fs/promises';
import { z } from 'zod';
import { isBlockedFromModel } from '../security/sensitive.js';
import { displayPath, isInsideRoot, resolveInCwd } from '../utils/paths.js';
import { err, ok, type ToolDefinition } from './types.js';

const MAX_FILE_BYTES = 512 * 1024; // 512 KB safety cap
const MAX_LINE_LENGTH = 2000;
const DEFAULT_LIMIT = 400;

const schema = z.object({
  path: z.string().min(1).describe('File path, relative to the project root or absolute.'),
  offset: z.number().int().min(1).optional().describe('1-based line number to start from.'),
  limit: z.number().int().min(1).max(2000).optional().describe('Maximum number of lines to return.'),
});
type Args = z.infer<typeof schema>;

async function looksBinary(absolute: string): Promise<boolean> {
  const fh = await fs.open(absolute, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await fh.read(buf, 0, 8192, 0);
    return buf.subarray(0, bytesRead).includes(0);
  } finally {
    await fh.close();
  }
}

export const readFileTool: ToolDefinition<Args> = {
  name: 'read_file',
  description:
    'Read a UTF-8 text file with line numbers. Supports ranged reads via offset/limit. ' +
    'Large files are truncated with a clear marker — follow up with ranged reads.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the project root (or absolute).' },
      offset: { type: 'number', description: '1-based starting line. Default 1.' },
      limit: { type: 'number', description: `Max lines to return. Default ${DEFAULT_LIMIT}.` },
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
      return err(`Refusing to read outside the workspace: ${args.path}`);
    }
    if (isBlockedFromModel(absolute)) {
      return err(
        `Refusing to read sensitive file "${displayPath(ctx.cwd, absolute)}". ` +
          'It may contain credentials and is protected by OxCode policy.',
      );
    }
    let stat;
    try {
      stat = await fs.stat(absolute);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      return err(code === 'ENOENT' ? `File not found: ${args.path}` : `Cannot read ${args.path}: ${(e as Error).message}`);
    }
    if (!stat.isFile()) return err(`Not a regular file: ${args.path}`);
    if (stat.size > MAX_FILE_BYTES) {
      return err(
        `File is too large (${(stat.size / 1024 / 1024).toFixed(1)} MB). ` +
          'Use grep to find relevant sections, then read specific ranges with offset/limit.',
      );
    }
    if (await looksBinary(absolute)) {
      return err(`File appears to be binary and cannot be displayed as text: ${args.path}`);
    }
    const text = await fs.readFile(absolute, 'utf8');
    const allLines = text.split('\n');
    const offset = args.offset ?? 1;
    const limit = args.limit ?? DEFAULT_LIMIT;
    const slice = allLines.slice(offset - 1, offset - 1 + limit);
    const numbered = slice
      .map((line, i) => {
        const n = offset + i;
        const clipped = line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) + '…' : line;
        return `${String(n).padStart(6)}\t${clipped}`;
      })
      .join('\n');
    const remaining = allLines.length - (offset - 1 + slice.length);
    const suffix =
      remaining > 0
        ? `\n[${remaining} more lines. Use offset=${offset + slice.length} to continue.]`
        : '';
    const header = `<file path="${displayPath(ctx.cwd, absolute)}" lines="${allLines.length}">\n`;
    return ok(header + numbered + suffix, {
      kind: 'read',
      title: 'Read',
      detail: displayPath(ctx.cwd, absolute),
    });
  },
};
