import fs from 'node:fs/promises';
import { z } from 'zod';
import { computeDiff } from '../utils/diffView.js';
import { displayPath, isInsideRoot, resolveInCwd } from '../utils/paths.js';
import { err, ok, type ToolDefinition } from './types.js';

/**
 * apply_patch: precise find-and-replace editing.
 * Each edit locates an exact block of text and replaces it. This avoids
 * whole-file rewrites and produces actionable errors when context drifts.
 */

const editSchema = z.object({
  old_text: z.string().describe('Exact text to find (must match the file byte-for-byte, including indentation).'),
  new_text: z.string().describe('Replacement text. Use an empty string to delete the block.'),
  occurrence: z.enum(['first', 'all']).optional().describe('Replace first occurrence (default) or all occurrences.'),
});

const schema = z.object({
  path: z.string().min(1).describe('File to edit, relative to the project root.'),
  edits: z.array(editSchema).min(1).max(20).describe('Ordered list of replacements applied in sequence.'),
});
type Args = z.infer<typeof schema>;

export interface PatchFailure {
  index: number;
  reason: string;
}

/**
 * Apply edits to text. Pure function — exported for tests.
 * Returns the patched text or a descriptive failure.
 */
export function applyEdits(
  original: string,
  edits: Array<{ old_text: string; new_text: string; occurrence?: 'first' | 'all' }>,
): { ok: true; text: string; applied: number } | { ok: false; failure: PatchFailure } {
  let text = original;
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]!;
    if (edit.old_text === '') {
      return { ok: false, failure: { index: i, reason: 'old_text must not be empty (cannot anchor an insertion). Include surrounding context.' } };
    }
    if (edit.old_text === edit.new_text) {
      return { ok: false, failure: { index: i, reason: 'old_text and new_text are identical — nothing to change.' } };
    }
    const occurrences = text.split(edit.old_text).length - 1;
    if (occurrences === 0) {
      return {
        ok: false,
        failure: {
          index: i,
          reason:
            'old_text was not found in the file. Re-read the file to get its current exact content ' +
            '(whitespace and indentation must match).',
        },
      };
    }
    if (occurrences > 1 && edit.occurrence !== 'all') {
      return {
        ok: false,
        failure: {
          index: i,
          reason: `old_text occurs ${occurrences} times. Add more surrounding context to make it unique, or set occurrence="all".`,
        },
      };
    }
    text = edit.occurrence === 'all' ? text.split(edit.old_text).join(edit.new_text) : text.replace(edit.old_text, edit.new_text);
  }
  return { ok: true, text, applied: edits.length };
}

export const applyPatchTool: ToolDefinition<Args> = {
  name: 'apply_patch',
  description:
    'Edit an existing file with exact find-and-replace blocks. Each edit replaces an ' +
    'exact `old_text` block with `new_text` (empty string deletes). Fails with a clear ' +
    'error when the anchor text is missing or ambiguous — re-read the file and retry.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the project root.' },
      edits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            old_text: { type: 'string', description: 'Exact existing text to replace.' },
            new_text: { type: 'string', description: 'Replacement text (empty to delete).' },
            occurrence: { type: 'string', enum: ['first', 'all'], description: 'Default "first".' },
          },
          required: ['old_text', 'new_text'],
        },
        description: 'Ordered replacements.',
      },
    },
    required: ['path', 'edits'],
  },
  schema,
  kind: 'write',
  mutating: true,
  summarize: (a) => `${a.path} (${a.edits.length} edit${a.edits.length === 1 ? '' : 's'})`,
  async execute(args, ctx) {
    const absolute = resolveInCwd(ctx.cwd, args.path);
    if (!isInsideRoot(ctx.cwd, absolute)) {
      return err(`Refusing to edit outside the workspace: ${args.path}`);
    }
    let original: string;
    try {
      original = await fs.readFile(absolute, 'utf8');
    } catch (e) {
      return err(`Cannot read ${args.path}: ${(e as Error).message}. Use write_file to create new files.`);
    }
    const result = applyEdits(original, args.edits);
    if (!result.ok) {
      return err(`Patch failed on edit #${result.failure.index + 1}: ${result.failure.reason}`);
    }
    if (result.text === original) {
      return err('Patch produced no changes.');
    }
    await fs.writeFile(absolute, result.text, 'utf8');
    const diff = computeDiff(args.path, original, result.text);
    return ok(
      `Patched ${displayPath(ctx.cwd, absolute)} (${args.edits.length} edit${args.edits.length === 1 ? '' : 's'}, +${diff.added} -${diff.removed}).`,
      { kind: 'edit', title: 'Edit', detail: displayPath(ctx.cwd, absolute), diff, diffPath: args.path },
    );
  },
};
