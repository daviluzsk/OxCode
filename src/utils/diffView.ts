import { structuredPatch } from 'diff';

export interface DiffSummary {
  added: number;
  removed: number;
  hunks: Array<{
    oldStart: number;
    lines: Array<{ type: 'add' | 'del' | 'ctx'; text: string }>;
  }>;
}

/** Build a compact structured diff between two file versions. */
export function computeDiff(filename: string, oldText: string, newText: string, contextLines = 2): DiffSummary {
  const patch = structuredPatch(filename, filename, oldText, newText, undefined, undefined, { context: contextLines });
  let added = 0;
  let removed = 0;
  const hunks: DiffSummary['hunks'] = [];
  for (const h of patch.hunks) {
    const lines: DiffSummary['hunks'][number]['lines'] = [];
    for (const raw of h.lines) {
      const tag = raw[0];
      const text = raw.slice(1).replace(/\n$/, '');
      if (tag === '+') {
        added++;
        lines.push({ type: 'add', text });
      } else if (tag === '-') {
        removed++;
        lines.push({ type: 'del', text });
      } else {
        lines.push({ type: 'ctx', text });
      }
    }
    hunks.push({ oldStart: h.oldStart, lines });
  }
  return { added, removed, hunks };
}

/** Render a unified-ish diff as plain text (for headless output / model context). */
export function renderDiffText(summary: DiffSummary, maxLines = 200): string {
  const out: string[] = [];
  let count = 0;
  for (const h of summary.hunks) {
    out.push(`@@ line ${h.oldStart} @@`);
    count++;
    for (const l of h.lines) {
      if (count >= maxLines) {
        out.push('… [diff truncated] …');
        return out.join('\n');
      }
      const prefix = l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' ';
      out.push(prefix + l.text);
      count++;
    }
  }
  return out.join('\n');
}
